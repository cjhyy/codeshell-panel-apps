import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, readdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareProjectSnapshotDocuments } from "../../../apps/job-hunt-hq/app/snapshot-sharding-model.mjs";

const cli = fileURLToPath(new URL("../../../apps/job-hunt-hq/app/tools/job-hunt-cli.mjs", import.meta.url));
const canonicalCli = fileURLToPath(new URL("../../../apps/job-hunt-hq/app/tools/job-hunt.mjs", import.meta.url));
const rootPath = "job-hunt-panel.json";
const digest = text => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const source = { id: "career-source-process", provider: "user", excerpt: "本人实现了可恢复的项目保存。" };
const candidate = input => ({ operation: "save_candidate_context", input });
const context = input => ({ operation: "get_job_search_context", input });

async function project(t, initial) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "job-hunt-cli-test-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  if (initial) await put(directory, rootPath, typeof initial === "string" ? initial : JSON.stringify(initial));
  return directory;
}
async function put(directory, path, text) {
  const destination = join(directory, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, text);
}
async function rootText(directory) { return readFile(join(directory, rootPath), "utf8"); }
async function run(directory, request, args = [], entry = cli, nodeArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...nodeArgs, entry, ...args], { cwd: directory, stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: dirname(process.execPath), HOME: directory, TMPDIR: directory, LANG: "C.UTF-8" } });
    let stdout = "", stderr = "", timedOut = false, oversized = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 10_000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", text => { stdout += text; if (stdout.length > 2 * 1024 * 1024) { oversized = true; child.kill("SIGKILL"); } });
    child.stderr.on("data", text => { stderr += text; });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.stdin.on("error", error => { if (error.code !== "EPIPE") child.kill("SIGKILL"); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut || oversized) return reject(Error(`owned CLI child failed: timeout=${timedOut}, oversized=${oversized}`));
      try { resolve({ code, signal, response: JSON.parse(stdout), stdout, stderr }); }
      catch (error) { reject(Error(`CLI did not return one JSON document: ${stdout}\n${stderr}`, { cause: error })); }
    });
    child.stdin.end(request === undefined ? "" : typeof request === "string" ? request : JSON.stringify(request));
  });
}
async function ok(directory, request, args) {
  const result = await run(directory, request, args);
  assert.equal(result.code, 0, JSON.stringify(result.response));
  assert.equal(result.signal, null); assert.equal(result.response.ok, true);
  assert.equal(result.stderr, "");
  return result.response;
}
async function rejectedWithoutRootChange(directory, request, expectedCode) {
  const before = await rootText(directory);
  const result = await run(directory, request);
  assert.notEqual(result.code, 0); assert.equal(result.response.ok, false);
  if (expectedCode) assert.equal(result.response.error.code, expectedCode);
  assert.equal(await rootText(directory), before);
  return result;
}
async function persistPrepared(directory, prepared) {
  for (const shard of prepared.shards) await put(directory, shard.path, shard.content);
  await put(directory, rootPath, prepared.rootContent);
}
function sharded() {
  const prepared = prepareProjectSnapshotDocuments({ schemaVersion: 2, careerLibraryMigrationVersion: 1,
    profile: {}, sourceMaterials: [], careerEpisodes: [], careerQa: [], resume: {}, versions: [],
    questionBank: Array.from({ length: 80 }, (_, index) => ({ id: `question-${index}`, notes: "fixture".repeat(1000) })),
  });
  assert.ok(prepared.shards.length > 0);
  return prepared;
}

test("real CLI accepts stdin and argv ops with its strict bounded tool contract", async t => {
  const directory = await project(t);
  for (const invocation of [[{ operation: "ops" }, []], [undefined, ["ops"]]]) {
    const { result } = await ok(directory, ...invocation);
    assert.equal(result.format, "codeshell.job-hunt.cli");
    assert.deepEqual(result.operations.map(operation => operation.name).sort(),
      ["get_job_search_context", "save_candidate_context", "save_resume_draft", "save_resume_qa_answer"].sort());
    assert.match(result.writePolicy, /expectedRevision/);
    assert.ok(result.operations.every(operation => operation.inputSchema.additionalProperties === false));
  }
  for (const input of ["{invalid", { operation: "ops", unexpected: true },
    { ...candidate({ source: { ...source, actor: "user" } }), expectedRevision: null }]) {
    const result = await run(directory, input);
    assert.notEqual(result.code, 0); assert.equal(result.response.ok, false);
  }
  assert.deepEqual(await readdir(directory), []);
});

test("source saves survive new processes and stale revisions never overwrite them", async t => {
  const directory = await project(t);
  const empty = await ok(directory, context({ scope: "career_sources" }));
  assert.equal(empty.revision, null); assert.equal(empty.result.sourceMaterials.total, 0);
  const first = await ok(directory, { ...candidate({ source }), expectedRevision: null });
  const saved = JSON.parse(await rootText(directory));
  assert.equal(first.revision, digest(await rootText(directory)));
  assert.equal(saved.sourceMaterials[0].excerpt, source.excerpt);
  assert.equal(saved.sourceMaterials[0].status, "draft");
  const reopened = await ok(directory, context({ scope: "career_sources", source_id: source.id }));
  assert.equal(reopened.result.sourceMaterials.items[0].excerpt, source.excerpt);
  assert.equal(reopened.revision, first.revision);
  const second = await ok(directory, { ...candidate({ source: { ...source, excerpt: "本人补充了故障恢复边界。" } }), expectedRevision: first.revision });
  assert.notEqual(second.revision, first.revision);
  await rejectedWithoutRootChange(directory, { ...candidate({ source: { ...source, excerpt: "过期写入" } }), expectedRevision: first.revision }, "REVISION_CONFLICT");
  await rejectedWithoutRootChange(directory, candidate({ source }), "INVALID_INPUT");
});

test("legacy CLI accepts the canonical complete-candidate mode and preserves existing career facts", async t => {
  const originalSource = { ...source, excerpt: source.excerpt.repeat(1000),
    extension: { exact: "未公开资料必须保持原样" },
  };
  const directory = await project(t, { schemaVersion: 2, careerLibraryMigrationVersion: 1,
    profile: {}, sourceMaterials: [originalSource], careerEpisodes: [], careerQa: [], careerLibraryVersions: [],
    extension: { owner: "another-feature", raw: "保留原文" },
  });
  const input = { profile: { name: "Synthetic candidate", role: "工程", summary: "本人提供的合成资料" },
    repositories: [{ id: "repo-one", name: "Fixture", summary: "只用于临时项目的资料" }],
    work_history: [{ id: "work-one", company: "Fixture company", role: "工程", achievements: ["合成测试经历"] }],
  };
  const saved = await ok(directory, { ...candidate(input), expectedRevision: digest(await rootText(directory)) });
  assert.equal(saved.result.repositories, 1); assert.equal(saved.result.workHistory, 1);
  const state = JSON.parse(await rootText(directory));
  assert.equal(state.profile.name, input.profile.name);
  assert.equal(state.repos[0].id, input.repositories[0].id);
  assert.equal(state.experiences[0].id, input.work_history[0].id);
  assert.deepEqual(state.sourceMaterials, [originalSource]);
  assert.deepEqual(state.extension, { owner: "another-feature", raw: "保留原文" });
});

test("legacy preview tokens and career files interoperate with the canonical public CLI", async t => {
  const directory = await project(t, { schemaVersion: 2, careerLibraryMigrationVersion: 1,
    profile: {}, sourceMaterials: [], careerEpisodes: [], careerQa: [], careerLibraryVersions: [],
  });
  const path = "career-data/updates/shared.json";
  await put(directory, path, JSON.stringify({ format: "codeshell.career-update", schemaVersion: 1,
    version: { id: "career-version-shared-cli", title: "两个入口共用的版本" }, sources: [source], episodes: [], qa: [],
  }));
  const preview = await ok(directory, candidate({ career_update: { action: "preview", path } }));
  const inputPath = "career-data/requests/apply.json";
  await put(directory, inputPath, JSON.stringify({ career_update: { action: "apply", path, preview_token: preview.result.preview_token } }));
  const applied = await run(directory, undefined,
    ["run", "save_candidate_context", "--input-file", inputPath, "--project", directory], canonicalCli);
  assert.equal(applied.code, 0, JSON.stringify(applied.response));
  assert.equal(applied.response.result.libraryVersion.id, "career-version-shared-cli");
  const reopened = await ok(directory, context({ scope: "career_sources", source_id: source.id }));
  assert.equal(reopened.result.sourceMaterials.items[0].excerpt, source.excerpt);
  assert.equal(reopened.revision, digest(await rootText(directory)));
});

test("knowledge JSON preview/apply is idempotent and never implicitly creates a resume", async t => {
  const directory = await project(t);
  const path = "career-data/updates/chat.json";
  const document = { format: "codeshell.career-update", schemaVersion: 1,
    version: { id: "career-version-process-chat", title: "真实进程中的聊天整理" }, sources: [source],
    episodes: [{ id: "career-episode-process", title: "可恢复保存", sourceIds: [source.id], decision: "先持久化再公开成功" }],
    qa: [{ id: "career-qa-process", episodeId: "career-episode-process", question: "为什么这样选择？", answer: "我需要让失败后仍可核对原始输入。", sourceIds: [source.id], category: "decision" }] };
  await put(directory, path, JSON.stringify(document));
  const preview = await ok(directory, candidate({ career_update: { action: "preview", path } }));
  assert.equal(preview.revision, null); assert.equal(preview.result.saved, false);
  assert.match(preview.result.preview_token, /^[a-f0-9]{64}$/);
  assert.equal((await readdir(directory)).includes(rootPath), false);
  const request = { ...candidate({ career_update: { action: "apply", path, preview_token: preview.result.preview_token } }), expectedRevision: null };
  const applied = await ok(directory, request);
  const state = JSON.parse(await rootText(directory));
  assert.equal(state.careerLibraryVersions.length, 1); assert.equal(state.careerEpisodes.length, 1); assert.equal(state.careerQa.length, 1);
  assert.equal(state.resume.markdown || "", ""); assert.deepEqual(state.versions, []);
  assert.equal(state.sourceMaterials[0].status, "draft");
  const changed = await ok(directory, { ...candidate({ source: { ...source, excerpt: "保存版本后新增的事实，不得被旧JSON重放覆盖。" } }), expectedRevision: applied.revision });
  const before = await rootText(directory);
  // The already attached exact file may return its immutable version even with
  // the original stale CAS/token. It must not republish or reapply old facts.
  const repeated = await ok(directory, request);
  assert.equal(repeated.result.idempotent, true); assert.equal(repeated.revision, changed.revision);
  assert.equal(await rootText(directory), before);
  const historical = await ok(directory, context({ scope: "career_sources", source_id: source.id, version_id: document.version.id }));
  assert.equal(historical.result.historical, true);
  assert.equal(historical.result.sourceMaterials.items[0].excerpt, source.excerpt);
  assert.equal(JSON.parse(before).careerLibraryVersions.length, 1);
});

test("two real CLI processes with one revision produce exactly one root winner", async t => {
  const directory = await project(t);
  const initial = await ok(directory, { ...candidate({ source }), expectedRevision: null });
  const contenders = ["writer-a", "writer-b"].map(id => ({
    ...candidate({ source: { id: `career-source-${id}`, provider: "user", excerpt: `${id}的独立事实` } }), expectedRevision: initial.revision,
  }));
  const results = await Promise.all(contenders.map(request => run(directory, request)));
  assert.equal(results.filter(result => result.response.ok).length, 1, JSON.stringify(results));
  const loser = results.find(result => !result.response.ok);
  assert.ok(["REVISION_CONFLICT", "PROJECT_BUSY"].includes(loser.response.error.code));
  assert.ok([3, 4].includes(loser.code));
  const winner = contenders[results.findIndex(result => result.response.ok)].input.source;
  const state = JSON.parse(await rootText(directory));
  assert.equal(state.sourceMaterials.length, 2);
  assert.equal(state.sourceMaterials.find(item => item.id === winner.id).excerpt, winner.excerpt);
});

test("interrupted shared workspace lock fails closed without expiring or modifying the root", async t => {
  const directory = await project(t);
  const initial = await ok(directory, { ...candidate({ source }), expectedRevision: null });
  const lock = `.codeshell-workspace-write-${createHash("sha256").update(rootPath.normalize("NFC").toLowerCase()).digest("hex")}.lock`;
  await put(directory, `${lock}/owner.json`, JSON.stringify({ pid: 99999999, nonce: "old-owner", createdAt: "2000-01-01T00:00:00Z" }));
  await rejectedWithoutRootChange(directory, { ...candidate({ source: { ...source, excerpt: "应被阻止" } }), expectedRevision: initial.revision }, "REVISION_CONFLICT");
  assert.equal(JSON.parse(await readFile(join(directory, lock, "owner.json"), "utf8")).nonce, "old-owner");
});

test("corrupt roots and missing or invalid shards never turn into empty writable state", async t => {
  for (const corruption of ["invalid-root", "invalid-schema", "missing-shard", "invalid-shard-json", "invalid-shard-envelope"]) {
    const directory = await project(t), prepared = sharded();
    await persistPrepared(directory, prepared);
    if (corruption === "invalid-root") await put(directory, rootPath, "{broken-json");
    if (corruption === "invalid-schema") await put(directory, rootPath, JSON.stringify({ schemaVersion: 99 }));
    if (corruption === "missing-shard") await rm(join(directory, prepared.shards[0].path));
    if (corruption === "invalid-shard-json") await put(directory, prepared.shards[0].path, "{broken-shard");
    if (corruption === "invalid-shard-envelope") await put(directory, prepared.shards[0].path, JSON.stringify({ ...prepared.shards[0].payload, field: "careerQa" }));
    const before = await rootText(directory);
    await rejectedWithoutRootChange(directory, { ...candidate({ source }), expectedRevision: digest(before) });
    const reading = await run(directory, context({ scope: "summary" }));
    assert.equal(reading.response.ok, false); assert.equal(await rootText(directory), before);
  }
});

test("a shard read failure never initializes an empty root after the previously read root disappears", async t => {
  const directory = await project(t), prepared = sharded();
  prepared.root.profile = { name: "preserved original profile" };
  await persistPrepared(directory, { ...prepared, rootContent: JSON.stringify(prepared.root) });
  const expectedRevision = digest(await rootText(directory));
  const originalShard = await readFile(join(directory, prepared.shards[0].path), "utf8");
  const preload = join(directory, "fail-shard-read.mjs");
  await writeFile(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
const open = fs.openSync;
let removed = false;
fs.openSync = (path, ...args) => {
  if (!removed && String(path).includes("career-data/panel-shards/")) {
    removed = true;
    fs.unlinkSync(join(process.cwd(), "job-hunt-panel.json"));
    throw Object.assign(new Error("ENOENT synthetic interrupted shard read"), { code: "ENOENT" });
  }
  return open(path, ...args);
};
syncBuiltinESMExports();
`);
  const result = await run(directory, { ...candidate({ source }), expectedRevision }, [], cli, ["--import", preload]);
  assert.notEqual(result.code, 0); assert.equal(result.response.ok, false);
  assert.equal(result.response.error.code, "ENOENT");
  await assert.rejects(rootText(directory), error => error.code === "ENOENT", "the failed shard read must not grant create permission");
  assert.equal(await readFile(join(directory, prepared.shards[0].path), "utf8"), originalShard);
});

test("snapshot.commit refuses newly staged roots that reference missing or corrupt shards", async t => {
  for (const corruption of ["missing", "broken", "wrong-envelope"]) {
    const directory = await project(t, { schemaVersion: 2, profile: { name: "original" } });
    const prepared = sharded();
    for (const shard of prepared.shards) await put(directory, shard.path, shard.content);
    if (corruption === "missing") await rm(join(directory, prepared.shards[0].path));
    if (corruption === "broken") await put(directory, prepared.shards[0].path, "{broken");
    if (corruption === "wrong-envelope") await put(directory, prepared.shards[0].path, JSON.stringify({ ...prepared.shards[0].payload, part: 999 }));
    const path = `career-data/panel-commits/g-${"a".repeat(32)}.json`;
    await put(directory, path, prepared.rootContent);
    await rejectedWithoutRootChange(directory, { operation: "snapshot.commit", input: { path, expectedRevision: digest(await rootText(directory)) } });
  }
});

test("snapshot.commit returns exact byte receipts and preserves revision/mtime CAS semantics", async t => {
  const directory = await project(t, { schemaVersion: 2, profile: { name: "original" } });
  const originalRevision = digest(await rootText(directory));
  const content = JSON.stringify({ schemaVersion: 2, profile: { name: "临时用户" }, extension: { retained: true } }, null, 2);
  const path = `career-data/panel-commits/g-${"b".repeat(32)}.json`;
  await put(directory, path, content);
  const committed = await ok(directory, { operation: "snapshot.commit", input: { path, expectedRevision: originalRevision, expectedModifiedAt: -1 } });
  assert.deepEqual(committed.result, { path: rootPath, size: Buffer.byteLength(content), modifiedAt: committed.result.modifiedAt, revision: digest(content) });
  assert.ok(Number.isFinite(committed.result.modifiedAt)); assert.equal(await rootText(directory), content);
  await rejectedWithoutRootChange(directory, { operation: "snapshot.commit", input: { path, expectedRevision: originalRevision } }, "REVISION_CONFLICT");
  await rejectedWithoutRootChange(directory, { operation: "snapshot.commit", input: { path, expectedRevision: null } }, "REVISION_CONFLICT");
  const nextContent = JSON.stringify({ schemaVersion: 2, profile: { name: "旧mtime兼容" } });
  const nextPath = `career-data/panel-commits/g-${"c".repeat(32)}.json`;
  await put(directory, nextPath, nextContent);
  await rejectedWithoutRootChange(directory, { operation: "snapshot.commit", input: { path: nextPath, expectedModifiedAt: 0 } }, "REVISION_CONFLICT");
  const next = await ok(directory, { operation: "snapshot.commit", input: { path: nextPath, expectedModifiedAt: committed.result.modifiedAt } });
  assert.equal(next.result.revision, digest(nextContent)); assert.equal(await rootText(directory), nextContent);
  await rejectedWithoutRootChange(directory, { operation: "snapshot.commit", input: { path: "career-data/panel-commits/../bad.json", expectedRevision: next.result.revision } }, "INVALID_PATH");
});

test("snapshot.commit cannot turn a stale revision or missing guard into create permission", async t => {
  const directory = await project(t);
  const path = `career-data/panel-commits/g-${"e".repeat(32)}.json`;
  const content = JSON.stringify({ schemaVersion: 2, profile: { name: "create-only fixture" } });
  await put(directory, path, content);
  for (const [guards, expectedCode] of [
    [{ expectedRevision: digest("old root"), expectedModifiedAt: null }, "REVISION_CONFLICT"],
    [{}, "INVALID_INPUT"],
    [{ expectedModifiedAt: 1 }, "REVISION_CONFLICT"],
  ]) {
    const result = await run(directory, { operation: "snapshot.commit", input: { path, ...guards } });
    assert.equal(result.response.ok, false); assert.equal(result.response.error.code, expectedCode);
    await assert.rejects(rootText(directory), error => error.code === "ENOENT");
  }
  const created = await ok(directory, { operation: "snapshot.commit", input: { path, expectedRevision: null } });
  assert.equal(created.revision, digest(content));
  await rejectedWithoutRootChange(directory, { operation: "snapshot.commit", input: { path, expectedRevision: null } }, "REVISION_CONFLICT");
});

test("explicit job_id and resume_id reads override UI selections in a new process", async t => {
  const directory = await project(t, { schemaVersion: 2, careerLibraryMigrationVersion: 1,
    selectedJobId: "job-a", selectedBaseResumeId: "resume-a", profile: {},
    jobs: [{ id: "job-a", company: "A", title: "Role A" }, { id: "job-b", company: "B", title: "Role B" }],
    resume: { versionId: "resume-a", kind: "base", title: "Base A", category: "工程", markdown: "# Base A" },
    versions: [{ versionId: "resume-b", kind: "base", title: "Base B", category: "工程", markdown: "# Base B" }],
  });
  const before = await rootText(directory);
  const job = await ok(directory, context({ scope: "job", job_id: "job-b" }));
  assert.equal(job.result.job.id, "job-b");
  const resume = await ok(directory, context({ scope: "resume", resume_id: "resume-b" }));
  assert.equal(resume.result.resume.versionId, "resume-b");
  for (const input of [{ scope: "job", job_id: "missing" }, { scope: "resume", resume_id: "missing" }]) {
    const result = await run(directory, context(input)); assert.equal(result.response.ok, false);
  }
  assert.equal(await rootText(directory), before);
});

test("real resume and private QA writes use explicit job/base/resume identities", async t => {
  const directory = await project(t, { schemaVersion: 2, careerLibraryMigrationVersion: 1, profile: {}, selectedJobId: "job-a",
    jobs: [{ id: "job-a", company: "A", title: "Role A" }, { id: "job-b", company: "B", title: "Role B" }],
    resume: {}, versions: [], sourceMaterials: [], careerEpisodes: [], careerQa: [], careerLibraryVersions: [],
  });
  const claim = "设计可恢复的保存流程，让每次修改都有清晰的来源，并在保存失败时保留输入；通过分阶段发布验证迁移、恢复和版本之间的关联，明确记录每次选择的理由、适用范围和后续复盘，帮助团队核对真实结果。";
  const input = { resume_kind: "base", category: "工程", title: "工程基础简历", markdown: `# Example Candidate\n\n## 项目经验\n\n- ${claim}`,
    claim_evidence: [{ claim, status: "needs_review", importance: "core", why_it_matters: "保留可核对的恢复行为",
      sources: [{ kind: "user", label: "临时测试事实", locator: "user:fixture", evidence: "由合成fixture提供的候选人记录" }],
      interview_questions: [{ question: "为什么选择这个恢复方案？" }] }],
    candidate_questions: ["ownership", "decision", "impact"].map(category => ({ id: `private-${category}`, category,
      priority: "high", question: `${category}方面本人承担了什么？`, why: "补齐尚待核实的真实信息" })),
  };
  const base = await ok(directory, { operation: "save_resume_draft", input, expectedRevision: digest(await rootText(directory)) });
  assert.equal(base.result.resumeKind, "base");
  const variant = await ok(directory, { operation: "save_resume_draft", input: { ...input,
    resume_kind: "variant", title: "B岗位简历", job_id: "job-b", base_resume_id: base.result.resumeId,
  }, expectedRevision: base.revision });
  const state = JSON.parse(await rootText(directory));
  assert.equal(state.resume.jobId, "job-b"); assert.equal(state.resume.baseResumeId, base.result.resumeId);
  assert.equal(state.jobs.find(job => job.id === "job-b").status, "tailoring");
  assert.equal(state.jobs.find(job => job.id === "job-a").status, undefined);
  const answer = { question_id: "private-ownership", status: "answered", answer: "本人实现了本地恢复，并核对失败后的原始输入。", source_refs: ["user:fixture"] };
  await rejectedWithoutRootChange(directory, { operation: "save_resume_qa_answer",
    input: { ...answer, resume_id: "missing-resume" }, expectedRevision: variant.revision });
  const answered = await ok(directory, { operation: "save_resume_qa_answer",
    input: { ...answer, resume_id: variant.result.resumeId }, expectedRevision: variant.revision });
  assert.equal(answered.result.resumeId, variant.result.resumeId);
  const after = JSON.parse(await rootText(directory));
  assert.equal(after.resume.markdown, state.resume.markdown);
  assert.equal(after.resume.candidateQuestions.find(question => question.id === answer.question_id).answer, answer.answer);
  assert.equal(after.versions.find(resume => resume.versionId === base.result.resumeId).candidateQuestions.find(question => question.id === answer.question_id).answer, "");
  assert.ok(after.careerQa.some(qa => qa.answer === answer.answer && qa.status === "draft"));
});

test("copied installed package runs in isolation without development node_modules", async t => {
  const directory = await project(t), installed = join(directory, "installed-panel"), workspace = join(directory, "workspace");
  await mkdir(workspace);
  await cp(fileURLToPath(new URL("../../../apps/job-hunt-hq", import.meta.url)), installed, { recursive: true });
  assert.equal((await readdir(installed)).includes("node_modules"), false);
  const entry = join(installed, "app/tools/job-hunt-cli.mjs");
  const inventory = await run(workspace, { operation: "ops" }, [], entry);
  assert.equal(inventory.code, 0); assert.equal(inventory.response.ok, true);
  const saved = await run(workspace, { ...candidate({ source }), expectedRevision: null }, [], entry);
  assert.equal(saved.code, 0, JSON.stringify(saved.response)); assert.equal(saved.response.ok, true);
  const reopened = await run(workspace, context({ scope: "career_sources", source_id: source.id }), [], entry);
  assert.equal(reopened.code, 0); assert.equal(reopened.response.result.sourceMaterials.items[0].excerpt, source.excerpt);
  assert.equal(reopened.response.revision, saved.response.revision);
});
