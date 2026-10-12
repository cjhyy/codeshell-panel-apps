import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot } from "./panel-projects.mjs";
import { candidateInput, fileInventory, resumeInput } from "../tests/apps/job-hunt-hq/fixtures/headless-runtime.mjs";

if (process.argv.length !== 3)
  throw new Error("Usage: node scripts/check-panel-host-storage.mjs <built-server-package-directory>");
assert.equal(process.env.PANEL_TEST_ISOLATED_HOME, process.env.HOME, "run this check through the isolated Host storage gate");
assert.ok(process.env.PANEL_TEST_NETWORK_GUARD, "the worker and its Node children must have the gate's network guard");
const serverRoot = resolve(process.argv[2]);
assert.equal(JSON.parse(await readFile(join(serverRoot, "package.json"), "utf8")).name, "@cjhyy/code-shell-server");
const coreRoot = resolve(serverRoot, "../core");
assert.equal(JSON.parse(await readFile(join(coreRoot, "package.json"), "utf8")).name, "@cjhyy/code-shell-core");
const core = await import(pathToFileURL(join(coreRoot, "dist/index.js")).href);
const { skillTool } = await import(pathToFileURL(join(coreRoot, "dist/tool-system/builtin/skill.js")).href);
const { bashTool } = await import(pathToFileURL(join(coreRoot, "dist/tool-system/builtin/bash.js")).href);
const { PanelRuntimeServices } = await import(pathToFileURL(join(serverRoot, "dist/panels/runtime-services.js")).href);

const root = await mkdtemp(join(tmpdir(), "job-hunt-host-headless-"));
const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
try {
  const source = join(repositoryRoot, "apps/job-hunt-hq"), project = join(root, "workspace");
  await mkdir(join(project, ".code-shell"), { recursive: true });
  const install = async (path, overwrite = false) => {
    const input = { kind: "dir", path };
    const preview = await core.previewLocalPanelApp(input);
    return core.installReviewedLocalPanelApp(input, preview.reviewToken, new Date().toISOString(), { overwrite });
  };
  const installed = await install(source);
  assert.equal(installed.version, "4.2.0");
  const pin = async (cwd, selected) => {
    await mkdir(join(cwd, ".code-shell"), { recursive: true });
    await writeFile(join(cwd, ".code-shell/settings.json"), JSON.stringify({
      panelAppBindings: ["job-hunt-hq"],
      panelAppPins: { "job-hunt-hq": { version: selected.version, packageDigest: selected.packageDigest } },
    }));
  };
  await pin(project, installed);

  const resolveRuntime = async (cwd, selected) => {
    const skill = core.scanSkills(cwd).find(item => item.name === "job-hunt-hq:project-runtime");
    assert.equal(skill?.source, "panel-app");
    const instructions = await skillTool({ skill: skill.name }, { cwd });
    assert.doesNotMatch(instructions, /\$\{CODESHELL_SKILL_DIR\}/);
    const base = instructions.match(/^Base directory for this skill: (.+)$/m)?.[1];
    assert.ok(base);
    assert.match(instructions, /without opening the panel|direct Chat or TUI/i);
    const packageRoot = resolve(base, "../../..");
    assert.equal(packageRoot, await realpath(core.panelAppPackageDir("job-hunt-hq", selected.packageDigest)));
    const manifest = JSON.parse(await readFile(join(packageRoot, ".codeshell-panel/panel.json"), "utf8"));
    assert.equal(manifest.id, "job-hunt-hq");
    assert.equal(manifest.version, selected.version);
    const path = join(packageRoot, "app/tools/job-hunt.mjs");
    await readFile(path);
    return { packageRoot, path };
  };
  const runtime = await resolveRuntime(project, installed);
  const command = async (args, cwd = project, entry = runtime.path) => {
    const result = await bashTool({
      command: [process.execPath, entry, ...args].map(shellQuote).join(" "),
      timeout: 15_000,
    }, {
      cwd, sessionId: "headless-host-fixture", allowBackgroundShells: false,
      shellEnv: { NODE_OPTIONS: `--import=${pathToFileURL(process.env.PANEL_TEST_NETWORK_GUARD).href}` },
    });
    assert.equal(typeof result, "object");
    assert.equal(result.ok, true, result.error);
    assert.equal(result.result.trim().split("\n").length, 1);
    const receipt = JSON.parse(result.result);
    assert.equal(receipt.ok, true);
    return receipt.result;
  };
  let requestId = 0;
  const run = async (op, input) => {
    const path = join(root, `request-${++requestId}.json`);
    await writeFile(path, JSON.stringify(input));
    return command(["run", op, "--input-file", path, "--project", project, "--session", "headless-host-fixture"]);
  };
  const operations = await command(["ops"]);
  assert.equal(operations.length, 4);
  assert.equal((await command(["init", "--project", project])).initialized, true);
  await run("save_candidate_context", candidateInput);
  assert.equal((await run("save_resume_draft", resumeInput)).projectSaved, true);

  const services = new PanelRuntimeServices({ dataDir: join(root, "host-data") });
  const hostScope = {
    appId: "job-hunt-hq", cwd: project, projectPath: project,
    permissions: ["context.workspace", "workspace.read", "workspace.write"], isAuthorized: async () => true,
  };
  const readHost = () => services.call(hostScope, "workspace.readText", { path: "job-hunt-panel.json" });
  const previous = await readHost(), before = JSON.parse(previous.content);
  assert.equal(before.resume.source, "cli");
  assert.equal(before.resume.sessionId, "headless-host-fixture");
  const answer = "The candidate chose immutable generations for concurrent readers.";
  await run("save_resume_qa_answer", { resume_id: before.resume.versionId, question_id: "qa-decision", status: "answered", answer, source_refs: ["user:resume-qa:qa-decision"] });
  const after = JSON.parse((await readHost()).content);
  assert.equal(after.resume.markdown, before.resume.markdown);
  assert.equal(after.resume.candidateQuestions.find(item => item.id === "qa-decision").answer, answer);
  await assert.rejects(services.call(hostScope, "workspace.writeText", {
    path: "job-hunt-panel.json", content: previous.content, expectedRevision: previous.revision,
  }), /changed since it was opened/);

  const beforeRead = await fileInventory(project);
  assert.equal((await run("get_job_search_context", { scope: "candidate" })).profile.name, candidateInput.profile.name);
  assert.deepEqual(await fileInventory(project), beforeRead);
  const latest = await readHost();
  const hostUpdated = { ...JSON.parse(latest.content), profile: { ...after.profile, summary: "Host write visible to the installed CLI." } };
  await services.call(hostScope, "workspace.writeText", { path: "job-hunt-panel.json", content: JSON.stringify(hostUpdated), expectedRevision: latest.revision });
  assert.equal((await run("get_job_search_context", { scope: "candidate" })).profile.summary, hostUpdated.profile.summary);

  const { readProjectSnapshot, projectSnapshotPayload } = await import(pathToFileURL(join(runtime.packageRoot, "app/snapshot-codec.mjs")).href);
  const { prepareProjectSnapshotDocuments } = await import(pathToFileURL(join(runtime.packageRoot, "app/snapshot-sharding-model.mjs")).href);
  const { writeProjectSnapshotDocuments } = await import(pathToFileURL(join(runtime.packageRoot, "app/snapshot-storage.mjs")).href);
  const { normalizeResumeRecord } = await import(pathToFileURL(join(runtime.packageRoot, "app/resume-model.mjs")).href);
  const { createNodeWorkspaceScope } = await import(pathToFileURL(join(runtime.packageRoot, "app/tools/node-workspace-scope.mjs")).href);
  const sharedScope = { check() {}, call: (method, params) => services.call(hostScope, method, params) };
  const previousBundle = await readProjectSnapshot(sharedScope);
  const versions = Array.from({ length: 18 }, (_, index) => normalizeResumeRecord({
    versionId: `host-history-${index}`, kind: "base", category: `History ${index}`,
    title: `Historical fixture ${index}`, updatedAt: "2025-01-01T00:00:00Z",
    markdown: "# Historical fixture\n\n## Experience\n\n- " + "Public synthetic fixture detail. ".repeat(800),
  }));
  const prepared = prepareProjectSnapshotDocuments(projectSnapshotPayload({ ...previousBundle.snapshot, versions }));
  assert.ok(prepared.shards.length > 1);
  await writeProjectSnapshotDocuments(prepared, { scope: sharedScope, previousSnapshot: previousBundle.previousSnapshot });
  await run("save_candidate_context", candidateInput);
  const updatedBundle = await readProjectSnapshot(sharedScope);
  assert.deepEqual(updatedBundle.snapshot.versions.map(record => record.markdown), versions.map(record => record.markdown));
  assert.equal(updatedBundle.snapshot.resume.candidateQuestions.find(item => item.id === "qa-decision").answer, answer);
  assert.ok(JSON.parse((await readHost()).content).artifactStorage.shards.length > 1);
  const nodeScope = await createNodeWorkspaceScope(project);
  const nodePrevious = await nodeScope.call("workspace.readText", { path: "job-hunt-panel.json" });
  const hostPrevious = await readHost();
  const hostWinner = JSON.parse(hostPrevious.content);
  hostWinner.profile.summary = "A newer Host root must survive a stale CLI adapter.";
  await services.call(hostScope, "workspace.writeText", { path: "job-hunt-panel.json", content: JSON.stringify(hostWinner), expectedRevision: hostPrevious.revision });
  await assert.rejects(nodeScope.call("workspace.writeText", { path: "job-hunt-panel.json", content: nodePrevious.content, expectedRevision: nodePrevious.revision }), error => error.code === "REVISION_CONFLICT");
  assert.equal((await run("get_job_search_context", { scope: "candidate" })).profile.summary, hostWinner.profile.summary);

  // A catalog update must not redirect an already pinned project's Skill/CLI.
  const newerSource = join(root, "newer-package");
  await cp(source, newerSource, { recursive: true });
  const manifestPath = join(newerSource, ".codeshell-panel/panel.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, version: "4.2.1" }));
  const newer = await install(newerSource, true);
  core.invalidateSkillCache();
  assert.equal((await resolveRuntime(project, installed)).path, runtime.path);
  assert.equal((await command(["ops"])).length, 4);
  const second = join(root, "new-project");
  await pin(second, newer);
  const newerRuntime = await resolveRuntime(second, newer);
  assert.notEqual(newerRuntime.path, runtime.path);
  assert.equal((await command(["ops"], second, newerRuntime.path)).length, 4);
  await rm(newerRuntime.path);
  core.invalidateSkillCache();
  assert.match(await skillTool({ skill: "job-hunt-hq:project-runtime" }, { cwd: second }), /not found/);
  assert.equal((await resolveRuntime(project, installed)).path, runtime.path);

  console.log("PASS: real reviewed package installation, project-pinned Skill interpolation and Bash execution of four installed Job Hunt operations with no Panel; real Host direct/sharded data, bidirectional stale-write rejection and retained-package isolation");
} finally {
  core.invalidateSkillCache();
  await rm(root, { recursive: true, force: true });
}
