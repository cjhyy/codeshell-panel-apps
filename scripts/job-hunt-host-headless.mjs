import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
const activeWorkers = new Map();
let runError, runFailed = false;
const stopWorkers = async () => {
  const pending = [...activeWorkers.entries()];
  for (const [child] of pending) child.kill("SIGKILL");
  if (pending.length) await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Acceptance workers did not close; temporary files retained at ${root}`)), 5_000);
    Promise.all(pending.map(([, closed]) => closed)).then(() => {
      clearTimeout(timeout);
      done();
    }, error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
};
try {
  const source = join(repositoryRoot, "apps/job-hunt-hq"), project = join(root, "workspace");
  await mkdir(join(project, ".code-shell"), { recursive: true });
  const install = async (path, overwrite = false) => {
    const input = { kind: "dir", path };
    const preview = await core.previewLocalPanelApp(input);
    return core.installReviewedLocalPanelApp(input, preview.reviewToken, new Date().toISOString(), { overwrite });
  };
  const installed = await install(source);
  assert.equal(installed.version, "4.2.1");
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
  const protocol = await bashTool({
    command: [process.execPath, "-e", "process.stdout.write(JSON.stringify({protocol:process.env.CODESHELL_WORKSPACE_WRITE_PROTOCOL})+'\\n')"].map(shellQuote).join(" "),
    timeout: 15_000,
  }, {
    cwd: project, sessionId: "headless-host-fixture", allowBackgroundShells: false,
    shellEnv: {
      NODE_OPTIONS: `--import=${pathToFileURL(process.env.PANEL_TEST_NETWORK_GUARD).href}`,
      CODESHELL_WORKSPACE_WRITE_PROTOCOL: "0",
    },
  });
  assert.equal(protocol.ok, true, protocol.error);
  assert.equal(JSON.parse(protocol.result).protocol, "1", "the real Host Bash path supplies its authoritative workspace protocol capability");
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

  // Hold real commits after their last CAS check, in independent processes.
  // Both directions would silently overwrite a winner without the common lock.
  let workerId = 0;
  const launchWriter = async options => {
    const prefix = join(root, `writer-${++workerId}`);
    const config = {
      project, serverRoot, packageRoot: runtime.packageRoot, dataDir: join(root, "host-data"),
      startedMarker: prefix + "-started", contendedMarker: prefix + "-contended",
      readMarker: prefix + "-read", ...options,
    };
    if (options.pause) Object.assign(config, { stageMarker: prefix + "-stage", releaseMarker: prefix + "-release" });
    const inputPath = prefix + ".json";
    await writeFile(inputPath, JSON.stringify(config));
    const child = spawn(process.execPath, [
      "--import", pathToFileURL(process.env.PANEL_TEST_NETWORK_GUARD).href,
      join(repositoryRoot, "scripts/fixtures/job-hunt-workspace-writer.mjs"), inputPath,
    ], {
      cwd: project, stdio: ["ignore", "pipe", "pipe"], timeout: 15_000,
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: "C.UTF-8",
        PANEL_TEST_ISOLATED_HOME: process.env.PANEL_TEST_ISOLATED_HOME,
        PANEL_TEST_NETWORK_GUARD: process.env.PANEL_TEST_NETWORK_GUARD,
      },
    });
    let resolveClosed;
    const closed = new Promise(done => { resolveClosed = done; });
    activeWorkers.set(child, closed);
    let stdout = "", stderr = "";
    child.stdout.on("data", value => { stdout += value; });
    child.stderr.on("data", value => { stderr += value; });
    const done = new Promise((resolveDone, reject) => {
      child.once("error", reject);
      child.once("close", code => {
        activeWorkers.delete(child);
        resolveClosed();
        try {
          assert.equal(code, 0, stderr);
          resolveDone(JSON.parse(stdout));
        } catch (error) { reject(error); }
      });
    });
    done.catch(() => {});
    return { child, config, done, output: () => stdout + stderr };
  };
  const waitForMarker = async (writer, marker) => {
    const deadline = Date.now() + 4_000;
    for (;;) {
      try { await access(marker); return; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      assert.equal(writer.child.exitCode, null, `writer exited before its test barrier: ${writer.output()}`);
      assert.ok(Date.now() < deadline, `writer did not reach its test barrier: ${writer.output()}`);
      await new Promise(done => setTimeout(done, 10));
    }
  };
  for (const firstRole of ["host", "node"]) {
    const hostBefore = await readHost();
    const nodeBefore = await nodeScope.call("workspace.readText", { path: "job-hunt-panel.json" });
    const params = role => ({
      path: "job-hunt-panel.json",
      content: JSON.stringify({ ...JSON.parse(hostBefore.content), profile: { ...JSON.parse(hostBefore.content).profile, summary: `Concurrent ${role} writer` } }),
      expectedRevision: role === "host" ? hostBefore.revision : nodeBefore.revision,
    });
    const first = await launchWriter({ role: firstRole, params: params(firstRole), pause: true });
    let second;
    try {
      await waitForMarker(first, first.config.stageMarker);
      const secondRole = firstRole === "host" ? "node" : "host";
      second = await launchWriter({ role: secondRole, params: params(secondRole) });
      await waitForMarker(second, second.config.contendedMarker);
      assert.equal(second.child.exitCode, null, "competing writer waits while the first is between its CAS and rename");
    } finally { await writeFile(first.config.releaseMarker, "release"); }
    const [winner, loser] = await Promise.all([first.done, second.done]);
    assert.equal(winner.ok, true);
    assert.equal(loser.ok, false);
    if (second.config.role === "node") assert.equal(loser.error.code, "REVISION_CONFLICT");
    else assert.match(loser.error.message, /changed since it was opened/);
    assert.equal(JSON.parse((await readHost()).content).profile.summary, `Concurrent ${firstRole} writer`);
  }
  const replayBefore = await readHost(), replayRoot = JSON.parse(replayBefore.content);
  const concurrentSummary = "A Host edit at the final commit barrier survives CLI replay.";
  const concurrentAnswer = "The concurrent CLI answer is preserved after rereading the Host winner.";
  const holdingHost = await launchWriter({ role: "host", pause: true, params: {
    path: "job-hunt-panel.json", expectedRevision: replayBefore.revision,
    content: JSON.stringify({ ...replayRoot, profile: { ...replayRoot.profile, summary: concurrentSummary } }),
  } });
  let replayingCli;
  try {
    await waitForMarker(holdingHost, holdingHost.config.stageMarker);
    const requestPath = join(root, "concurrent-qa.json");
    await writeFile(requestPath, JSON.stringify({
      resume_id: updatedBundle.snapshot.resume.versionId, question_id: "qa-scope", status: "answered",
      answer: concurrentAnswer, source_refs: ["user:resume-qa:qa-scope"],
    }));
    replayingCli = await launchWriter({ role: "cli", args: ["run", "save_resume_qa_answer", "--input-file", requestPath, "--project", project, "--session", "headless-host-fixture"] });
    await waitForMarker(replayingCli, replayingCli.config.readMarker);
    await waitForMarker(replayingCli, replayingCli.config.contendedMarker);
  } finally { await writeFile(holdingHost.config.releaseMarker, "release"); }
  const [hostReceipt, cliReceipt] = await Promise.all([holdingHost.done, replayingCli.done]);
  assert.equal(hostReceipt.ok, true);
  assert.equal(cliReceipt.ok, true);
  assert.equal(cliReceipt.result.result.projectSaved, true);
  const replayed = (await readProjectSnapshot(sharedScope)).snapshot;
  assert.equal(replayed.profile.summary, concurrentSummary);
  assert.equal(replayed.resume.candidateQuestions.find(item => item.id === "qa-scope").answer, concurrentAnswer);
  assert.equal(replayed.resume.candidateQuestions.find(item => item.id === "qa-decision").answer, answer);

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

  // Exercise the same shutdown used after failed acceptance while a real child
  // still holds a lock and has not committed. Delete fixtures only after close.
  const beforeShutdown = await readHost();
  const shutdownProbe = await launchWriter({ role: "host", pause: true, params: {
    path: "job-hunt-panel.json", expectedRevision: beforeShutdown.revision, content: beforeShutdown.content,
  } });
  await waitForMarker(shutdownProbe, shutdownProbe.config.stageMarker);
  await stopWorkers();
  assert.equal(activeWorkers.size, 0);
  assert.equal(shutdownProbe.child.signalCode, "SIGKILL");
  assert.equal((await readHost()).content, beforeShutdown.content, "killing an uncommitted fixture worker preserves the root");

  console.log("PASS: real reviewed package installation, project-pinned Skill interpolation and Bash execution of four installed Job Hunt operations with no Panel; real Host direct/sharded data, bidirectional stale-write rejection, cross-process commit exclusion and CLI conflict replay, retained-package isolation");
} catch (error) {
  runFailed = true;
  runError = error;
}
core.invalidateSkillCache();
let cleanupError, cleanupFailed = false;
try {
  await stopWorkers();
  await rm(root, { recursive: true, force: true });
} catch (error) {
  cleanupFailed = true;
  cleanupError = error;
}
if (runFailed && cleanupFailed)
  throw new AggregateError([runError, cleanupError], `${String(runError)}; ${String(cleanupError)}`, { cause: runError });
if (cleanupFailed) throw cleanupError;
if (runFailed) throw runError;
