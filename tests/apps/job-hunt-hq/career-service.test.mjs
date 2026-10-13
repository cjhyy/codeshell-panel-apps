import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  runCareerCandidateOperation,
  previewCareerLibrary,
  invalidateCareerEvidenceState,
} from "../../../apps/job-hunt-hq/app/career-service.mjs";
import { readCareerLibraryVersion } from "../../../apps/job-hunt-hq/app/career-library-version-store.mjs";

const now = "2026-10-13T00:00:00.000Z";
const updatePath = "career-data/updates/session.json";
const source = { id: "career-source-one", provider: "slack", connectionId: "connection-one", externalId: "thread-one", excerpt: "Synthetic source" };
const episode = { id: "career-episode-one", title: "Synthetic decision", sourceIds: [source.id], reason: "Synthetic reason" };
const qa = { id: "career-qa-one", episodeId: episode.id, question: "Why?", answer: "Candidate's actual answer", draftAnswer: "AI wording", sourceIds: [source.id] };

function initial() {
  return { schemaVersion: 2, sourceMaterials: [], careerEpisodes: [], careerQa: [], careerLibraryVersions: [],
    careerLibraryMigrationVersion: 1, profile: { name: "Synthetic candidate" },
    resume: { markdown: "Existing requested resume", claimEvidence: [] }, versions: [],
    futureProjectField: { preserved: true } };
}

function host() {
  const files = new Map(), calls = [];
  let active = true, failPath = "", onCall = null;
  const scope = {
    check() { if (!active) throw Error("project changed"); },
    async call(method, args) {
      scope.check();
      calls.push({ method, ...args });
      if (onCall) await onCall(method, args);
      if (args.path === failPath) throw Error("disk unavailable");
      if (method === "workspace.readText") {
        if (!files.has(args.path)) throw Object.assign(Error("ENOENT"), { code: "ENOENT" });
        const content = files.get(args.path);
        return { content, size: Buffer.byteLength(content), revision: `sha256:${createHash("sha256").update(content).digest("hex")}` };
      }
      assert.equal(method, "workspace.writeText");
      assert.notEqual(args.path, "job-hunt-panel.json", "the service must leave the root transaction to its caller");
      assert.equal(args.expectedModifiedAt, null);
      if (files.has(args.path)) throw Error("already exists");
      files.set(args.path, args.content);
      return {};
    },
  };
  return { scope, files, calls, options: { scope, projectKey: "stable-project-one", sessionId: "session-one", now },
    fail(path) { failPath = path; }, deactivate() { active = false; }, intercept(fn) { onCall = fn; } };
}

function document(overrides = {}) {
  return { format: "codeshell.career-update", schemaVersion: 1,
    version: { id: "career-version-json", title: "Synthetic chat version", summary: "Unknowns remain unknown" },
    sources: [source], episodes: [episode], qa: [qa], ...overrides };
}

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

async function applyDocument(current, value, fixture = host()) {
  fixture.files.set(updatePath, JSON.stringify(value));
  const preview = await runCareerCandidateOperation(current, { career_update: { action: "preview", path: updatePath } }, fixture.options);
  const applied = await runCareerCandidateOperation(current, { career_update: { action: "apply", path: updatePath, preview_token: preview.result.preview_token } }, fixture.options);
  return { preview, applied, fixture };
}

test("single-record chat writes run without DOM and preserve actual answers and unrelated project data", async () => {
  assert.equal(typeof globalThis.window, "undefined");
  const fixture = host();
  let current = freeze(initial());
  for (const [mode, input] of [["source", source], ["episode", episode], ["qa", qa]]) {
    const before = JSON.stringify(current);
    const operation = await runCareerCandidateOperation(current, { [mode]: input, trace_id: "opaque-trace" }, fixture.options);
    assert.equal(JSON.stringify(current), before);
    assert.equal(operation.changed, true);
    assert.equal(operation.result[mode].status, "draft");
    assert.deepEqual(operation.state.futureProjectField, { preserved: true });
    current = freeze(operation.state);
  }
  assert.equal(current.careerQa[0].answer, qa.answer);
  assert.equal(current.careerQa[0].draftAnswer, qa.draftAnswer);
  assert.equal(current.resume.markdown, initial().resume.markdown);
  assert.equal(current.careerLibraryVersions.length, 0);
  assert.equal(fixture.calls.length, 0);
});

test("a minimal CLI project gains only career state while preserving unknown root fields", async () => {
  const fixture = host(), current = freeze({ schemaVersion: 2, futureField: { preserved: true } });
  const result = await runCareerCandidateOperation(current, { qa: { id: qa.id, question: qa.question, answer: qa.answer } }, fixture.options);
  assert.deepEqual(result.state.futureField, current.futureField);
  assert.equal(Object.hasOwn(result.state, "resume"), false);
  assert.equal(Object.hasOwn(result.state, "versions"), false);
  const saved = await runCareerCandidateOperation(result.state, { library_version: { action: "save", title: "Minimal project" } }, fixture.options);
  assert.equal(saved.state.careerLibraryVersions.length, 1);
});

test("explicit chat confirmation verifies a record and later AI edits remain pending", async () => {
  const fixture = host();
  const verified = await runCareerCandidateOperation(initial(), { qa: { ...qa, episodeId: "", sourceIds: [] }, confirmation: "这些是我本人的实际回答，已经核实。" }, fixture.options);
  assert.equal(verified.state.careerQa[0].status, "confirmed");
  assert.equal(verified.state.careerQa[0].confirmedBy, "user");
  const current = freeze(verified.state);
  const revised = await runCareerCandidateOperation(current, { qa: { id: qa.id, question: qa.question, answer: "New unverified fact", draftAnswer: "New wording" } }, fixture.options);
  assert.equal(revised.state.careerQa[0].answer, qa.answer);
  assert.equal(revised.state.careerQa[0].pendingRevision.content.answer, "New unverified fact");
  assert.equal(revised.state.careerQa[0].draftAnswer, "New wording");
  assert.equal(current.careerQa[0].pendingRevision, null);
});

test("single-record normalization cannot erase untouched or reviewed original extension fields/history", async () => {
  const fixture = host();
  let current = (await runCareerCandidateOperation(initial(), { qa: { id: qa.id, question: qa.question, answer: "Original" }, confirmation: "我确认这个回答。" }, fixture.options)).state;
  const originalAnswer = "X".repeat(13000) + "ORIGINAL_END";
  current.careerQa[0].answer = originalAnswer;
  current.careerQa[0].futureRecordField = { keep: "verbatim" };
  current.careerQa[0].revisions = [{ version: 1, status: "draft", actor: "agent", content: { question: "Before", answer: "History" }, futureHistoryField: "keep" }];
  current.careerQa.push({ id: "future-qa", question: "Unrelated", answer: originalAnswer, futureField: "keep", status: "draft" });
  freeze(current);
  const operation = await runCareerCandidateOperation(current, { qa: { id: qa.id, question: qa.question, draftAnswer: "New expression" } }, fixture.options);
  assert.equal(operation.state.careerQa[0].answer, originalAnswer);
  assert.equal(operation.state.careerQa[0].pendingRevision.content.answer, originalAnswer);
  assert.deepEqual(operation.state.careerQa[0].futureRecordField, current.careerQa[0].futureRecordField);
  assert.deepEqual(operation.state.careerQa[0].revisions[0], current.careerQa[0].revisions[0]);
  assert.deepEqual(operation.state.careerQa[1], current.careerQa[1]);
});

test("career evidence invalidation returns new current and archived resume claims without mutating either input", () => {
  const previous = freeze({ sourceMaterials: [{ id: source.id, version: 1, status: "confirmed" }] });
  const next = freeze({ sourceMaterials: [{ id: source.id, version: 1, status: "confirmed", pendingRevision: { content: { excerpt: "Changed" } } }],
    resume: { claimEvidence: [{ status: "verified", sourceIds: [source.id] }, { status: "verified", sourceIds: ["other"] }] },
    versions: [{ claimEvidence: [{ status: "verified", sourceIds: [source.id] }] }], future: true });
  const result = invalidateCareerEvidenceState(previous, next);
  assert.equal(result.resume.claimEvidence[0].status, "needs_review");
  assert.equal(result.resume.claimEvidence[1].status, "verified");
  assert.equal(result.versions[0].claimEvidence[0].status, "needs_review");
  assert.equal(next.resume.claimEvidence[0].status, "verified");
  assert.equal(next.versions[0].claimEvidence[0].status, "verified");
});

test("single-record source changes invalidate dependent facts and linked resume claims", async () => {
  const fixture = host();
  let current = initial();
  for (const [mode, input] of [["source", source], ["episode", episode], ["qa", qa]]) {
    current = (await runCareerCandidateOperation(current, { [mode]: input, confirmation: "我确认这条事实。" }, fixture.options)).state;
  }
  current.resume.claimEvidence = [{ status: "verified", qaIds: [qa.id] }];
  const operation = await runCareerCandidateOperation(freeze(current), { source: { ...source, excerpt: "New source version" } }, fixture.options);
  assert.equal(operation.state.careerQa[0].status, "needs_review");
  assert.equal(operation.state.careerEpisodes[0].status, "needs_review");
  assert.equal(operation.state.resume.claimEvidence[0].status, "needs_review");
});

test("library preview is bounded, immutable and does not write", async () => {
  const fixture = host(), current = initial();
  current.careerQa = Array.from({ length: 55 }, (_, index) => ({ id: `career-qa-${index}`, question: `Synthetic ${index}`, answer: "Private actual answer", status: "draft" }));
  freeze(current);
  const operation = await runCareerCandidateOperation(current, { library_version: { action: "preview" } }, fixture.options);
  assert.equal(operation.changed, false);
  assert.equal(operation.result.totalChanges, 55);
  assert.equal(operation.result.changes.length, 50);
  assert.equal(operation.result.changesTruncated, true);
  assert.equal(JSON.stringify(operation.result).includes("Private actual answer"), false);
  assert.equal(fixture.calls.length, 0);
});

test("named library save creates immutable history without writing the root or generating a resume", async () => {
  const fixture = host();
  const current = (await runCareerCandidateOperation(initial(), { qa: { id: qa.id, question: qa.question, answer: qa.answer } }, fixture.options)).state;
  const operation = await runCareerCandidateOperation(freeze(current), { library_version: { action: "save", id: "career-version-single", title: "Chat facts" } }, fixture.options);
  assert.equal(operation.changed, true);
  assert.equal(operation.state.careerLibraryVersions.length, 1);
  assert.equal(current.careerLibraryVersions.length, 0);
  assert.equal(operation.state.careerQa[0].status, "draft");
  assert.deepEqual(operation.state.resume, current.resume);
  const historical = await previewCareerLibrary(operation.state, "career-version-single", fixture.options);
  assert.equal(historical.snapshot.careerQa[0].answer, qa.answer);
  assert.equal(historical.snapshot.resume, undefined);
  const retry = await runCareerCandidateOperation(operation.state, { library_version: { action: "save", id: "career-version-single", title: "Chat facts" } }, fixture.options);
  assert.equal(retry.changed, false);
  assert.equal(retry.result.libraryVersion.id, operation.result.libraryVersion.id);
  await assert.rejects(runCareerCandidateOperation(operation.state, { library_version: { action: "save", title: "No changes" } }, fixture.options), /没有新的知识库改动/);
});

test("library save rejects changing an immutable version ID and detects absent history instead of reading current facts", async () => {
  const fixture = host();
  const current = { ...initial(), careerQa: [{ id: qa.id, question: qa.question, answer: "Original" }] };
  const saved = await runCareerCandidateOperation(current, { library_version: { action: "save", id: "career-version-fixed", title: "Original" } }, fixture.options);
  const changed = structuredClone(saved.state); changed.careerQa[0].answer = "Later";
  await assert.rejects(runCareerCandidateOperation(changed, { library_version: { action: "save", id: "career-version-fixed", title: "Original" } }, fixture.options), /已保存另一份内容/);
  fixture.files.delete(saved.result.libraryVersion.path);
  await assert.rejects(previewCareerLibrary(saved.state, "career-version-fixed", fixture.options), /ENOENT/);
});

test("an internal UI snapshot guard rejects intervening facts before writing a named version", async () => {
  const fixture = host(), current = { ...initial(), careerQa: [{ id: qa.id, question: qa.question, answer: "Before preview" }] };
  const preview = await previewCareerLibrary(current, "", fixture.options);
  current.careerQa[0].answer = "Intervening edit";
  await assert.rejects(runCareerCandidateOperation(current, { library_version: { action: "save", title: "Previewed facts" } }, { ...fixture.options, expectedSnapshot: preview.snapshot }), /已有新的改动/);
  assert.equal(fixture.calls.some(call => call.method === "workspace.writeText"), false);
  await assert.rejects(runCareerCandidateOperation(current, { library_version: { action: "save", title: "Not an Agent field", expectedSnapshot: preview.snapshot } }, fixture.options), /不支持的字段/);
});

test("JSON preview/apply shares one library plan and preserves new facts as drafts", async () => {
  const current = freeze(initial());
  const { preview, applied, fixture } = await applyDocument(current, document());
  assert.equal(preview.changed, false);
  assert.equal(preview.result.incoming.total, 3);
  assert.match(preview.result.preview_token, /^[a-f0-9]{64}$/);
  assert.equal(applied.changed, true);
  assert.equal(applied.result.idempotent, false);
  assert.equal(applied.state.careerLibraryVersions.length, 1);
  assert.equal(applied.state.careerQa[0].answer, qa.answer);
  assert.equal(applied.state.careerQa[0].draftAnswer, qa.draftAnswer);
  assert.equal(applied.state.careerQa[0].status, "draft");
  assert.deepEqual(applied.state.resume, current.resume);
  assert.deepEqual(applied.state.futureProjectField, current.futureProjectField);
  assert.equal(fixture.calls.filter(call => call.method === "workspace.writeText" && call.path.endsWith("career-version-json.json")).length, 1);
});

test("JSON natural source identity remaps same-batch references to the stored source", async () => {
  const fixture = host();
  const current = (await runCareerCandidateOperation(initial(), { source }, fixture.options)).state;
  const alias = "career-source-alias";
  const { applied } = await applyDocument(current, document({ sources: [{ ...source, id: alias }],
    episodes: [{ ...episode, sourceIds: [alias] }], qa: [{ ...qa, sourceIds: [alias] }] }), fixture);
  assert.equal(applied.state.sourceMaterials.length, 1);
  assert.deepEqual(applied.state.careerEpisodes[0].sourceIds, [source.id]);
  assert.deepEqual(applied.state.careerQa[0].sourceIds, [source.id]);
});

test("JSON token rejects a changed file, library or stable project before creating history", async () => {
  for (const change of ["file", "library", "project", "index"]) {
    const fixture = host(), current = initial();
    fixture.files.set(updatePath, JSON.stringify(document()));
    const preview = await runCareerCandidateOperation(current, { career_update: { action: "preview", path: updatePath } }, fixture.options);
    if (change === "file") fixture.files.set(updatePath, JSON.stringify(document()) + "\n");
    if (change === "library") current.careerQa.push({ id: "career-qa-other", question: "Other" });
    if (change === "project") fixture.options.projectKey = "stable-project-two";
    if (change === "index") current.careerLibraryVersions.push({ id: "career-version-unrelated" });
    await assert.rejects(runCareerCandidateOperation(current, { career_update: { action: "apply", path: updatePath, preview_token: preview.result.preview_token } }, fixture.options), /已变化/);
    assert.equal(fixture.calls.some(call => call.method === "workspace.writeText"), false);
  }
});

test("JSON idempotent retry preserves subsequent working edits and does not rewrite history", async () => {
  const { applied, fixture } = await applyDocument(initial(), document());
  const current = structuredClone(applied.state); current.careerQa[0].answer = "Later working edit";
  const writes = fixture.calls.filter(call => call.method === "workspace.writeText").length;
  const retry = await runCareerCandidateOperation(freeze(current), { career_update: { action: "apply", path: updatePath, preview_token: "0".repeat(64) } }, fixture.options);
  assert.equal(retry.changed, false);
  assert.equal(retry.result.idempotent, true);
  assert.equal(retry.state.careerQa[0].answer, "Later working edit");
  assert.equal(fixture.calls.filter(call => call.method === "workspace.writeText").length, writes);
  fixture.files.set(updatePath, JSON.stringify(document()) + "\n");
  await assert.rejects(runCareerCandidateOperation(current, { career_update: { action: "preview", path: updatePath } }, fixture.options), /已用于另一份内容/);
});

test("JSON orphan recovery reuses timestamps after the caller's root CAS fails", async () => {
  const current = freeze(initial()), fixture = host();
  const first = await applyDocument(current, document(), fixture);
  const files = new Map(fixture.files);
  // Caller deliberately does not adopt first.applied.state, simulating a failed root CAS.
  const preview = await runCareerCandidateOperation(current, { career_update: { action: "preview", path: updatePath } }, { ...fixture.options, now: "2026-10-14T00:00:00.000Z" });
  const recovered = await runCareerCandidateOperation(current, { career_update: { action: "apply", path: updatePath, preview_token: preview.result.preview_token } }, { ...fixture.options, now: "2026-10-14T00:00:00.000Z" });
  assert.deepEqual(recovered.state, first.applied.state);
  assert.deepEqual(fixture.files, files);
  assert.equal(recovered.result.libraryVersion.createdAt, now);
});

test("failed immutable write or project switch never mutates caller state or reports success", async () => {
  const fixture = host(), current = freeze(initial());
  fixture.files.set(updatePath, JSON.stringify(document()));
  const preview = await runCareerCandidateOperation(current, { career_update: { action: "preview", path: updatePath } }, fixture.options);
  fixture.fail("career-data/library-versions/career-version-json.json");
  await assert.rejects(runCareerCandidateOperation(current, { career_update: { action: "apply", path: updatePath, preview_token: preview.result.preview_token } }, fixture.options), /disk unavailable/);
  assert.equal(current.careerQa.length, 0);
  fixture.fail(""); fixture.intercept(() => fixture.deactivate());
  await assert.rejects(runCareerCandidateOperation(current, { career_update: { action: "preview", path: updatePath } }, fixture.options), /project changed/);
});

test("mixed modes, internal confirmation, invalid tokens and manual unsaved drafts fail closed", async () => {
  const fixture = host();
  for (const args of [
    {}, { source, qa }, { profile: {}, source }, { qa: { ...qa, actor: "user" } },
    { qa: { ...qa, status: "confirmed" } }, { qa, confirmation: " " }, { qa, confirmation: "X".repeat(1001) },
    { library_version: { action: "preview" }, confirmation: "I confirm" },
    { library_version: { action: "preview", id: "career-version-invalid-preview" } },
    { career_update: { action: "preview", path: updatePath, preview_token: "a".repeat(64) } },
    { career_update: { action: "apply", path: updatePath } },
    { career_update: { action: "apply", path: updatePath, preview_token: "A".repeat(64) } },
    { career_update: { action: "apply", path: updatePath, preview_token: "a".repeat(64) }, confirmation: "I confirm" },
  ]) await assert.rejects(runCareerCandidateOperation(initial(), args, fixture.options));
  const dirty = { ...initial(), careerDraft: { dirty: true } };
  await assert.rejects(runCareerCandidateOperation(dirty, { career_update: { action: "preview", path: updatePath } }, fixture.options), /未保存的手工编辑/);
  await assert.rejects(runCareerCandidateOperation(dirty, { library_version: { action: "save", title: "Blocked" } }, fixture.options), /未保存的手工编辑/);
  assert.equal(fixture.calls.length, 0);
});

test("history comparison rejects broken base chains and corrupted immutable files", async () => {
  const { applied, fixture } = await applyDocument(initial(), document());
  const current = structuredClone(applied.state);
  current.careerLibraryVersions[0].baseVersionId = "career-version-missing";
  await assert.rejects(previewCareerLibrary(current, current.careerLibraryVersions[0].id, fixture.options), /前一版索引缺失/);
  const version = applied.result.libraryVersion;
  const manifest = JSON.parse(fixture.files.get(version.path));
  manifest.root.careerQa[0].answer = "Tampered";
  fixture.files.set(version.path, JSON.stringify(manifest));
  await assert.rejects(readCareerLibraryVersion(version, fixture.options), /校验失败/);
});

test("single-record astral text and list items reject truncating storage bounds before any mutation", async () => {
  for (const input of [
    { source: { provider: "manual", excerpt: "😀".repeat(8001) } },
    { episode: { title: "Synthetic", background: "😀".repeat(6001) } },
    { episode: { title: "Synthetic", actions: ["😀".repeat(501)] } },
    { qa: { question: "Why?", answer: "😀".repeat(6001) } },
  ]) {
    const fixture = host(), current = freeze(initial()), before = JSON.stringify(current);
    await assert.rejects(runCareerCandidateOperation(current, input, fixture.options), /超过/);
    assert.equal(JSON.stringify(current), before);
    assert.equal(fixture.calls.length, 0);
  }
  const fixture = host();
  const excerpt = "😀".repeat(8000);
  const operation = await runCareerCandidateOperation(initial(), { source: { provider: "manual", excerpt } }, fixture.options);
  assert.equal(operation.result.source.excerpt, excerpt, "an exact storage-boundary fact is never shortened");
});
