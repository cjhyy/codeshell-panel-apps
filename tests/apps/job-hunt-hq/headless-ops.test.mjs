import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createNodeWorkspaceScope } from "../../../apps/job-hunt-hq/app/tools/node-workspace-scope.mjs";
import { hydrateProjectSnapshotDocuments, prepareProjectSnapshotDocuments, projectSnapshotShardDescriptors } from "../../../apps/job-hunt-hq/app/snapshot-sharding-model.mjs";
import { writeProjectSnapshotDocuments } from "../../../apps/job-hunt-hq/app/snapshot-storage.mjs";
import { applyOp, emptyProjectSnapshot } from "../../../apps/job-hunt-hq/app/snapshot-codec.mjs";
import { jobHuntOperations } from "../../../apps/job-hunt-hq/app/ops/index.mjs";
import { candidateInput, cli, cliPath, fileInventory, resumeInput, run, snapshotPath, tempProject } from "./fixtures/headless-runtime.mjs";

const exec = promisify(execFile);

test("CLI runs through a symbolic directory alias and emits the same operation JSON", async t => {
  const project = await tempProject(t);
  const packageAlias = join(project, "package-alias");
  await symlink(dirname(dirname(dirname(cliPath))), packageAlias, process.platform === "win32" ? "junction" : "dir");
  const direct = await exec(process.execPath, [cliPath, "ops"], { cwd: project });
  assert.equal(JSON.parse(direct.stdout).ok, true);
  assert.equal(direct.stderr, "");
  for (const flags of [[], ["--preserve-symlinks-main"]]) {
    const aliased = await exec(process.execPath, [...flags, join(packageAlias, "app/tools/job-hunt.mjs"), "ops"], { cwd: project });
    assert.equal(aliased.stdout, direct.stdout, "a path alias must execute rather than silently exit");
    assert.equal(aliased.stderr, "");
  }
});

test("async CLI imports never execute main with another, absent or unreadable entry path", async t => {
  const project = await tempProject(t);
  const driver = join(project, "import-driver.mjs");
  const moduleUrl = pathToFileURL(cliPath).href;
  await writeFile(driver, `
    const mode = process.argv[2];
    if (mode === "absent") process.argv.splice(1);
    if (mode === "missing") process.argv[1] = ${JSON.stringify(join(project, "missing-entry.mjs"))};
    if (mode === "invalid") process.argv[1] = "\\0";
    const cli = await import(${JSON.stringify(moduleUrl)});
    if (typeof cli.main !== "function") throw new Error("CLI export missing");
    process.stdout.write("imported\\n");
  `);
  for (const mode of ["driver", "absent", "missing", "invalid"]) {
    const imported = await exec(process.execPath, ["--unhandled-rejections=strict", driver, mode], { cwd: project });
    assert.equal(imported.stdout, "imported\n", mode);
    assert.equal(imported.stderr, "", mode);
  }
});

async function snapshot(project) {
  const root = JSON.parse(await readFile(join(project, snapshotPath), "utf8"));
  const documents = new Map();
  for (const descriptor of projectSnapshotShardDescriptors(root)) documents.set(descriptor.path, JSON.parse(await readFile(join(project, descriptor.path), "utf8")));
  return hydrateProjectSnapshotDocuments(root, documents);
}

test("CLI lists the shared manifest operations and reading an absent project never initializes it", async t => {
  const project = await tempProject(t);
  const manifest = JSON.parse(await readFile(new URL("../../../apps/job-hunt-hq/.codeshell-panel/panel.json", import.meta.url), "utf8"));
  const result = (await cli(["ops"], { cwd: project })).json;
  assert.equal(result.ok, true);
  assert.deepEqual(result.result.map(item => item.name).sort(), ["get_job_search_context", "save_candidate_context", "save_resume_draft", "save_resume_qa_answer", "save_job_opportunities", "save_job_research", "get_job_research_digest"].sort());
  for (const item of result.result) {
    const declared = manifest.agent.tools.find(tool => tool.name === item.name);
    assert.deepEqual(item.inputSchema, (declared || jobHuntOperations[item.name]).inputSchema);
    assert.equal(item.readOnly, declared ? declared.readOnly : !jobHuntOperations[item.name].mutates);
  }
  const missing = await run(project, "get_job_search_context", { scope: "candidate" }, { expectedExit: 1 });
  assert.equal(missing.json.ok, false);
  assert.deepEqual(await fileInventory(project), {});
});

test("explicit init creates the project once and context reads leave every persisted byte alone", async t => {
  const project = await tempProject(t);
  assert.equal((await cli(["init", "--project", project])).json.ok, true);
  const initial = await fileInventory(project);
  assert.equal(JSON.parse(initial[snapshotPath]).schemaVersion, 2);
  await cli(["init", "--project", project]);
  assert.deepEqual(await fileInventory(project), initial, "repeated initialization must not overwrite existing source files or root");
  const template = Object.keys(initial).find(path => path.startsWith("career-data/") && path.endsWith(".md"));
  assert.ok(template, "initialization includes candidate source templates");
  await rm(join(project, template));
  await cli(["init", "--project", project]);
  assert.deepEqual(await fileInventory(project), initial, "partial initialization resumes by creating only missing scaffolding");
  await run(project, "save_candidate_context", candidateInput);
  const beforeRead = await fileInventory(project);
  const result = (await run(project, "get_job_search_context", { scope: "candidate" })).json;
  assert.equal(result.ok, true);
  assert.equal(result.result.profile.name, candidateInput.profile.name);
  assert.deepEqual(await fileInventory(project), beforeRead);
});

test("invalid schema arguments fail before durable writes, including nested and unknown fields", async t => {
  const project = await tempProject(t);
  await cli(["init", "--project", project]);
  const before = await fileInventory(project);
  const cases = [
    ["get_job_search_context", { scope: "not-a-scope" }],
    ["get_job_search_context", { limit: 0 }],
    ["get_job_search_context", { unexpected: true }],
    ["save_candidate_context", { ...candidateInput, profile: { name: 42 } }],
    ["save_candidate_context", { ...candidateInput, profile: { ...candidateInput.profile, name: "😀".repeat(51) } }],
    ["save_candidate_context", { ...candidateInput, work_history: [{ ...candidateInput.work_history[0], achievements: ["😀".repeat(501)] }] }],
    ["save_candidate_context", { ...candidateInput, repositories: [{ name: "missing summary" }] }],
    ["save_candidate_context", { ...candidateInput, profile: { ...candidateInput.profile, api_key: "must-not-write" } }],
    ["save_resume_draft", { ...resumeInput, resume_kind: "made-up" }],
    ["save_resume_draft", { ...resumeInput, candidate_questions: [{ ...resumeInput.candidate_questions[0], category: "made-up" }] }],
    ["save_resume_qa_answer", { resume_id: "unknown", question_id: "unknown", status: "answered", answer: "a", source_refs: [] }],
  ];
  for (const [op, input] of cases) {
    const result = await run(project, op, input, { expectedExit: 2 });
    assert.equal(result.json.ok, false, op);
    assert.deepEqual(await fileInventory(project), before, `${op} must fail without modifying durable data`);
  }
  await cli(["run", "unmigrated-operation", "--project", project], { input: {}, expectedExit: 2 });
  await cli(["run", "save_candidate_context", "--project", project, "--trace", "trace-a"], { input: { ...candidateInput, trace_id: "trace-b" }, expectedExit: 2 });
  assert.deepEqual(await fileInventory(project), before);
});

test("resume decision answers stay private and concurrent CLI updates retain both questions", async t => {
  const project = await tempProject(t);
  await cli(["init", "--project", project]);
  await run(project, "save_candidate_context", candidateInput);
  await run(project, "save_resume_draft", resumeInput);
  const original = await snapshot(project);
  const answer = question_id => ({ resume_id: original.resume.versionId, question_id, status: "answered", answer: `Candidate confirmed ${question_id}.`, source_refs: [`user:resume-qa:${question_id}`], suggested_change: "Keep this proposed change private." });
  await Promise.all([run(project, "save_resume_qa_answer", answer("qa-decision")), run(project, "save_resume_qa_answer", answer("qa-scope"))]);
  const updated = await snapshot(project);
  assert.equal(updated.resume.markdown, original.resume.markdown);
  assert.equal(updated.resume.candidateQuestions.filter(item => item.status === "answered").length, 2);
  assert.equal(updated.resume.candidateQuestions.find(item => item.id === "qa-decision").category, "decision");
  assert.doesNotMatch(updated.resume.markdown, /Candidate confirmed|proposed change/);
  assert.equal(updated.resume.source, "cli");
  assert.equal(updated.resume.sessionId, "fixture-session");
});

test("CLI preserves unrelated sharded data and rejects damaged or future roots without overwriting them", async t => {
  const project = await tempProject(t);
  await cli(["init", "--project", project]);
  const scope = await createNodeWorkspaceScope(project);
  const previousSnapshot = await scope.call("workspace.readText", { path: snapshotPath });
  const initial = JSON.parse(previousSnapshot.content);
  // Valid durable items with a large total payload force real shard hydration.
  const questionBank = Array.from({ length: 80 }, (_, index) => ({ id: `question-${index}`, question: `Question ${index}?`, status: "ready", notes: "fixture".repeat(2000) }));
  const prepared = prepareProjectSnapshotDocuments({ ...initial, questionBank });
  assert.ok(prepared.shards.length > 1);
  await writeProjectSnapshotDocuments(prepared, { scope, previousSnapshot });
  await run(project, "save_candidate_context", candidateInput);
  assert.deepEqual((await snapshot(project)).questionBank, questionBank);
  const shardedRoot = JSON.parse(await readFile(join(project, snapshotPath), "utf8"));
  const shardPath = projectSnapshotShardDescriptors(shardedRoot)[0].path;
  const shardContent = await readFile(join(project, shardPath), "utf8");
  await writeFile(join(project, shardPath), "{damaged-shard");
  const damaged = await fileInventory(project);
  await run(project, "save_candidate_context", candidateInput, { expectedExit: 1 });
  assert.deepEqual(await fileInventory(project), damaged, "unreadable shards cannot become an empty writable state");
  await writeFile(join(project, shardPath), shardContent);
  for (const content of ["{broken-json", ...[
    { schemaVersion: 999, profile: { name: "future" } },
    { schemaVersion: 2, profile: "wrong shape" },
    { schemaVersion: 2, resume: [] },
    { schemaVersion: 2, jobs: {} },
    { schemaVersion: 2, versions: "wrong shape" },
  ].map(value => JSON.stringify(value))]) {
    await writeFile(join(project, snapshotPath), content);
    const before = await fileInventory(project);
    await run(project, "save_candidate_context", candidateInput, { expectedExit: 1 });
    assert.deepEqual(await fileInventory(project), before);
  }
});

test("one root conflict replays the operation on fresh data and a second conflict remains visible", async () => {
  for (const alwaysConflict of [false, true]) {
    let data = emptyProjectSnapshot(), attempts = 0, runs = 0;
    const current = () => ({ content: JSON.stringify(data), modifiedAt: attempts + 1, revision: `revision-${attempts}` });
    const scope = {
      check() {},
      async call(method, params) {
        assert.equal(params.path, snapshotPath);
        if (method === "workspace.readText") return current();
        assert.equal(method, "workspace.writeText");
        attempts += 1;
        if (attempts === 1 || alwaysConflict) {
          data = { ...data, jobLeads: [{ id: "concurrent-lead", title: "Winner's independently saved lead" }] };
          throw Object.assign(new Error("concurrent root write"), { code: "REVISION_CONFLICT" });
        }
        data = JSON.parse(params.content);
        return current();
      },
    };
    const operation = { ...jobHuntOperations.save_candidate_context, run(...args) { runs += 1; return jobHuntOperations.save_candidate_context.run(...args); } };
    const pending = applyOp(scope, operation, candidateInput, { now: "2026-10-13T00:00:00Z", uid: prefix => `${prefix}-fixture`, source: "cli", sessionId: "fixture-session" });
    if (alwaysConflict) await assert.rejects(pending, error => error.code === "REVISION_CONFLICT");
    else {
      const result = await pending;
      assert.equal(result.result.projectSaved, true);
      assert.equal(data.profile.name, candidateInput.profile.name);
      assert.equal(data.jobLeads[0].id, "concurrent-lead");
    }
    assert.equal(attempts, 2, "one retry is bounded");
    assert.equal(runs, 2, "business operation is recomputed after the conflict");
  }
});

test("pure operations leave caller-owned state and arguments intact even when validation fails", () => {
  const freeze = value => {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  let id = 0;
  const ctx = { now: "2026-10-13T00:00:00Z", uid: prefix => `${prefix}-${++id}`, source: "cli", sessionId: "fixture-session" };
  let state = emptyProjectSnapshot();
  const execute = (name, args) => {
    const before = structuredClone(state), input = structuredClone(args);
    freeze(state); freeze(args);
    const output = jobHuntOperations[name].run(state, args, ctx);
    assert.deepEqual(state, before, name);
    assert.deepEqual(args, input, name);
    assert.notEqual(output.snapshot, state);
    return output;
  };
  state = execute("save_candidate_context", structuredClone(candidateInput)).snapshot;
  state = execute("save_resume_draft", structuredClone(resumeInput)).snapshot;
  state = execute("save_resume_qa_answer", { resume_id: state.resume.versionId, question_id: "qa-decision", status: "answered", answer: "I chose immutable generations.", source_refs: ["user:resume-qa:qa-decision"] }).snapshot;
  const before = structuredClone(state);
  assert.throws(() => jobHuntOperations.save_candidate_context.run(freeze(state), { ...candidateInput, repositories: [{ name: "invalid missing summary" }] }, ctx));
  assert.deepEqual(state, before);
  const read = execute("get_job_search_context", { scope: "candidate" });
  read.result.profile.name = "Caller mutated its own returned object";
  assert.equal(state.profile.name, candidateInput.profile.name);
});

test("Node workspace rejects escapes and symlinks before reading or changing outside files", async t => {
  const project = await tempProject(t), outside = await tempProject(t);
  const secret = join(outside, "outside.txt");
  await writeFile(secret, "outside bytes");
  const scope = await createNodeWorkspaceScope(project);
  for (const path of [secret, "../outside.txt", "career-data/../../outside.txt", "career-data\\outside.txt", ".hidden/file.json", "career-data/.hidden.json"]) {
    await assert.rejects(scope.call("workspace.readText", { path }));
    await assert.rejects(scope.call("workspace.writeText", { path, content: "changed", expectedModifiedAt: null }));
  }
  await symlink(outside, join(project, "linked"));
  await symlink(secret, join(project, "leaf.txt"));
  for (const path of ["linked/outside.txt", "leaf.txt"]) {
    await assert.rejects(scope.call("workspace.readText", { path }));
    await assert.rejects(scope.call("workspace.writeText", { path, content: "changed", expectedModifiedAt: null }));
  }
  assert.equal(await readFile(secret, "utf8"), "outside bytes");
  const outsideBefore = await fileInventory(outside);
  await assert.rejects(scope.call("workspace.writeText", { path: "linked/new.json", content: "{}", expectedModifiedAt: null }));
  assert.deepEqual(await fileInventory(outside), outsideBefore);
  await symlink(project, join(outside, "project-link"));
  await assert.rejects(createNodeWorkspaceScope(join(outside, "project-link")), error => error.code === "UNSAFE_PATH");
});

test("Node workspace stops using a project root after its directory is replaced", async t => {
  const project = await tempProject(t), moved = project + "-moved";
  t.after(() => rm(moved, { recursive: true, force: true }));
  await writeFile(join(project, "existing.txt"), "original project bytes");
  const scope = await createNodeWorkspaceScope(project);
  await rename(project, moved);
  await mkdir(project);
  await writeFile(join(project, "existing.txt"), "replacement project bytes");
  assert.throws(() => scope.check(), error => error.code === "UNSAFE_PATH");
  await assert.rejects(scope.call("workspace.readText", { path: "existing.txt" }), error => error.code === "UNSAFE_PATH");
  await assert.rejects(scope.call("workspace.writeText", { path: "new.json", content: "{}", expectedModifiedAt: null }), error => error.code === "UNSAFE_PATH");
  assert.deepEqual(await fileInventory(project), { "existing.txt": "replacement project bytes" });
  assert.deepEqual(await fileInventory(moved), { "existing.txt": "original project bytes" });
});

test("Node workspace create-only and root compare-and-set preserve a competing winner", async t => {
  const project = await tempProject(t);
  const first = await createNodeWorkspaceScope(project), second = await createNodeWorkspaceScope(project);
  await first.call("workspace.writeText", { path: snapshotPath, content: "initial", expectedModifiedAt: null });
  await assert.rejects(second.call("workspace.writeText", { path: snapshotPath, content: "clobber", expectedModifiedAt: null }));
  const previous = await first.call("workspace.readText", { path: snapshotPath });
  await first.call("workspace.writeText", { path: snapshotPath, content: "winner", expectedRevision: previous.revision, expectedModifiedAt: previous.modifiedAt });
  await assert.rejects(second.call("workspace.writeText", { path: snapshotPath, content: "loser", expectedRevision: previous.revision, expectedModifiedAt: previous.modifiedAt }), error => error.code === "REVISION_CONFLICT");
  assert.equal(await readFile(join(project, snapshotPath), "utf8"), "winner");
  const beforeRace = await first.call("workspace.readText", { path: snapshotPath });
  const competing = await Promise.allSettled([first, second].map((scope, index) => scope.call("workspace.writeText", { path: snapshotPath, content: `race-${index}`, expectedRevision: beforeRace.revision, expectedModifiedAt: beforeRace.modifiedAt })));
  assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(competing.filter(result => result.status === "rejected").length, 1);
  await mkdir(join(project, "career-data", "panel-shards"), { recursive: true });
  await first.call("workspace.writeText", { path: "career-data/panel-shards/example.json", content: "{}", expectedModifiedAt: null });
  assert.equal((await first.call("workspace.list", { path: "career-data/panel-shards" })).entries[0].name, "example.json");
});

test("Node workspace waits for the common Host file lock before checking the revision", async t => {
  const project = await tempProject(t), path = "Concurrent.JSON";
  const scope = await createNodeWorkspaceScope(project);
  await scope.call("workspace.writeText", { path, content: "before", expectedModifiedAt: null });
  const previous = await scope.call("workspace.readText", { path });
  const hash = createHash("sha256").update(path.normalize("NFC").toLowerCase()).digest("hex");
  const lock = join(project, `.codeshell-workspace-write-${hash}.lock`);
  await mkdir(lock);
  let settled = false;
  const writing = scope.call("workspace.writeText", { path, content: "stale writer", expectedRevision: previous.revision });
  const receipt = writing.then(value => { settled = true; return value; }, error => { settled = true; return error; });
  try {
    await new Promise(done => setTimeout(done, 75));
    assert.equal(settled, false, "a Host-held lock blocks the CLI commit without blocking the event loop");
    assert.equal((await scope.call("workspace.readText", { path })).content, "before");
    await writeFile(join(project, path), "Host winner");
  } finally {
    await rm(lock, { recursive: true });
  }
  assert.equal((await receipt).code, "REVISION_CONFLICT");
  assert.equal((await scope.call("workspace.readText", { path })).content, "Host winner");
  assert.deepEqual(Object.keys(await fileInventory(project)), [path], "a rejected writer releases only its own lock");
});

test("Node write locks preserve the operation failure and never remove a replacement owner", async t => {
  const project = await tempProject(t), scope = await createNodeWorkspaceScope(project);
  const originalError = new Error("original operation failure");
  const lock = join(project, ".job-hunt-write.lock");
  await assert.rejects(scope.withWriteLock(async () => { throw originalError; }), error => error === originalError);
  await assert.rejects(access(lock), error => error.code === "ENOENT", "normal release preserves the original thrown value");
  await assert.rejects(scope.withWriteLock(async () => {
    await rename(lock, join(project, ".old-owner.lock"));
    await mkdir(lock);
    throw originalError;
  }), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, originalError);
    assert.equal(error.errors[0], originalError);
    assert.equal(error.errors[1].code, "UNSAFE_PATH");
    return true;
  });
  assert.equal((await lstat(lock)).isDirectory(), true, "the replacement owner's lock remains untouched");
});
