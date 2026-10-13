import test from "node:test";
import assert from "node:assert/strict";
import { prepareProjectSnapshotDocuments, hydrateProjectSnapshotDocuments } from "../../../apps/job-hunt-hq/app/snapshot-sharding-model.mjs";
import {
  CAREER_LIBRARY_VERSION_LIMIT,
  createCareerLibrarySnapshot,
  normalizeCareerLibraryVersion,
  normalizeCareerLibraryVersions,
  compareCareerLibrarySnapshots,
  prepareCareerLibraryVersion,
} from "../../../apps/job-hunt-hq/app/career-library-version-model.mjs";

const createdAt = "2026-10-12T00:00:00.000Z";
const metadata = { id: "career-version-first", title: "第一次聊天整理", summary: "整理一次真实选择", createdAt, sessionId: "session-current" };

function library() {
  return {
    sourceMaterials: [{ id: "s1", status: "draft", excerpt: "原始材料", history: [{ content: { excerpt: "旧材料全文" } }], pendingRevision: { content: { excerpt: "待审材料全文" } } }],
    careerEpisodes: [{ id: "e1", status: "draft", title: "方案选择", sourceIds: ["s1"], actions: ["本人行动"], revisions: [{ content: { reason: "原来的理由" } }] }],
    careerQa: [{ id: "q1", episodeId: "e1", status: "draft", question: "为什么选择？", answer: "本人聊天原话", draftAnswer: "AI表达草稿", revisions: [{ content: { answer: "最早的原话" } }], pendingRevision: null }],
  };
}

test("immutable snapshots clone all career facts, history and pending content without other project data", () => {
  const state = { ...library(), schemaVersion: 2, profile: { name: "无关资料" }, jobs: [{ private: "不是经历库内容" }], careerLibraryVersions: [metadata] };
  const snapshot = createCareerLibrarySnapshot(state);
  assert.deepEqual(Object.keys(snapshot), ["schemaVersion", "sourceMaterials", "careerEpisodes", "careerQa"]);
  assert.equal(snapshot.schemaVersion, 1);
  assert.deepEqual(snapshot.careerQa[0].revisions, state.careerQa[0].revisions);
  assert.deepEqual(snapshot.sourceMaterials[0].pendingRevision, state.sourceMaterials[0].pendingRevision);
  state.careerQa[0].answer = "后续聊天的新回答";
  state.sourceMaterials[0].history[0].content.excerpt = "后来修改的材料";
  state.careerEpisodes[0].actions.push("另一次行动");
  assert.equal(snapshot.careerQa[0].answer, "本人聊天原话");
  assert.equal(snapshot.sourceMaterials[0].history[0].content.excerpt, "旧材料全文");
  assert.deepEqual(snapshot.careerEpisodes[0].actions, ["本人行动"]);
  assert.throws(() => { snapshot.careerQa[0].answer = "不允许覆盖历史版本"; }, TypeError);
  assert.throws(() => snapshot.careerEpisodes.push({ id: "e2" }), TypeError);
});

test("snapshot capture rejects duplicate IDs and non-JSON data instead of silently losing facts", () => {
  assert.throws(() => createCareerLibrarySnapshot({ careerQa: [{ question: "没有ID" }] }), /稳定 ID/);
  assert.throws(() => createCareerLibrarySnapshot({ careerQa: [{ id: "q1" }, { id: "q1" }] }), /重复 ID/);
  assert.throws(() => createCareerLibrarySnapshot({ careerQa: [{ id: "q1", answer: undefined }] }), /JSON/);
  assert.throws(() => createCareerLibrarySnapshot({ sourceMaterials: [{ id: "s1", fetchedAt: new Date(createdAt) }] }), /JSON/);
  const cyclic = { id: "q1" }; cyclic.cycle = cyclic;
  assert.throws(() => createCareerLibrarySnapshot({ careerQa: [cyclic] }), /循环引用/);
});

test("a historical career snapshot round-trips existing shards without acquiring unrelated project collections", () => {
  const state = library();
  state.sourceMaterials = Array.from({ length: 30 }, (_, index) => ({ ...state.sourceMaterials[0], id: `s${index}`, excerpt: "合成原始材料".repeat(3000) }));
  const snapshot = createCareerLibrarySnapshot(state);
  const documents = prepareProjectSnapshotDocuments(snapshot);
  assert.ok(documents.shards.length > 1);
  const hydrated = hydrateProjectSnapshotDocuments(documents.root, new Map(documents.shards.map((shard) => [shard.path, JSON.parse(shard.content)])));
  assert.deepEqual(createCareerLibrarySnapshot(hydrated), snapshot);
  assert.equal(JSON.stringify(createCareerLibrarySnapshot(hydrated)), JSON.stringify(snapshot));
  assert.equal(Object.hasOwn(snapshot, "interviewSets"), false);
  assert.equal(Object.hasOwn(snapshot, "jobs"), false);
});

test("comparisons identify added, updated, archived and physically missing records with full local details", () => {
  const before = library();
  before.careerQa.push({ id: "q-missing", status: "draft", question: "旧版仍可追溯的问题", answer: "旧回答" });
  const after = library();
  after.sourceMaterials.push({ id: "s2", status: "confirmed", excerpt: "新的材料" });
  after.careerEpisodes[0].status = "archived";
  after.careerQa[0].answer = "后续聊天补充原话";
  const result = compareCareerLibrarySnapshots(before, after);
  assert.deepEqual(result.counts, { added: 1, updated: 1, archived: 2 });
  assert.equal(result.changes.find((item) => item.id === "s2").before, null);
  assert.equal(result.changes.find((item) => item.id === "e1").after.status, "archived");
  assert.equal(result.changes.find((item) => item.id === "q1").before.answer, "本人聊天原话");
  assert.equal(result.changes.find((item) => item.id === "q1").after.answer, "后续聊天补充原话");
  assert.equal(result.changes.find((item) => item.id === "q-missing").after, null);
  assert.equal(result.changes.find((item) => item.id === "q-missing").missing, true);
  assert.deepEqual(result.unresolved, { sources: 1, episodes: 0, qa: 1, total: 2, pending: 1 });
  after.careerQa[0].answer = "再次改动";
  assert.equal(result.changes.find((item) => item.id === "q1").after.answer, "后续聊天补充原话");
});

test("comparison ignores object key and collection order while pending and missing factual answers remain unresolved", () => {
  const before = { careerQa: [{ id: "q1", status: "confirmed", answer: "本人原话", question: "问题" }, { id: "q2", status: "archived", answer: "", pendingRevision: { content: {} } }] };
  const reordered = { careerQa: [{ pendingRevision: { content: {} }, answer: "", status: "archived", id: "q2" }, { question: "问题", answer: "本人原话", status: "confirmed", id: "q1" }] };
  assert.equal(compareCareerLibrarySnapshots(before, reordered).changes.length, 0);
  const pending = { careerQa: [{ id: "q1", status: "confirmed", answer: "本人原话", pendingRevision: { content: { answer: "新原话" } } }, { id: "q2", status: "confirmed", answer: "" }] };
  assert.deepEqual(compareCareerLibrarySnapshots({}, pending).unresolved, { sources: 0, episodes: 0, qa: 2, total: 2, pending: 1 });
});

test("preparing a saved library version computes bounded metadata without confirming any factual drafts", () => {
  const state = library();
  const prepared = prepareCareerLibraryVersion(state, { ...metadata, counts: { total: 999 }, snapshot: { leaked: "不得内嵌资料" }, status: "confirmed" });
  assert.equal(prepared.version.path, "career-data/library-versions/career-version-first.json");
  assert.deepEqual(prepared.version.counts, { sources: 1, episodes: 1, qa: 1, total: 3, unresolved: 3, pending: 1 });
  assert.equal(prepared.version.status, "saved");
  assert.equal(prepared.version.snapshot, undefined);
  assert.ok(prepared.snapshot.careerQa.every((record) => record.status === "draft"));
  assert.equal(prepared.snapshot.careerQa[0].answer, "本人聊天原话");
  assert.equal(prepared.snapshot.careerQa[0].draftAnswer, "AI表达草稿");
  assert.equal(prepared.version.sessionId, "session-current");
  assert.deepEqual(prepared.comparison.counts, { added: 3, updated: 0, archived: 0 });
  assert.equal(state.careerLibraryVersions, undefined);
});

test("version IDs, manifest paths, hashes and ancestry cannot be silently cleaned or redirected", () => {
  const normalized = normalizeCareerLibraryVersion({ ...metadata, sha256: "AB".repeat(32), unexpected: "ignored" });
  assert.equal(normalized.sha256, "ab".repeat(32));
  assert.equal(normalized.unexpected, undefined);
  for (const id of ["first", " career-version-first", "career-version-first ", "career-version-../escape", "career-version-", `career-version-${"a".repeat(81)}`]) assert.throws(() => normalizeCareerLibraryVersion({ ...metadata, id }), /ID/);
  assert.throws(() => normalizeCareerLibraryVersion({ ...metadata, path: "../job-hunt-panel.json" }), /路径/);
  assert.throws(() => normalizeCareerLibraryVersion({ ...metadata, path: "career-data/library-versions/career-version-other.json" }), /路径/);
  for (const sha256 of [null, false, 0, "a".repeat(63), "g".repeat(64)]) assert.throws(() => normalizeCareerLibraryVersion({ ...metadata, sha256 }), /SHA-256/);
  assert.throws(() => prepareCareerLibraryVersion(library(), { ...metadata, baseVersionId: "career-version-missing" }), /基础版本不存在/);
  const prior = normalizeCareerLibraryVersion(metadata);
  const next = prepareCareerLibraryVersion(library(), { ...metadata, id: "career-version-second", baseVersionId: prior.id }, { versions: [prior], previousSnapshot: library() });
  assert.equal(next.version.baseVersionId, prior.id);
  assert.equal(next.comparison.changes.length, 0);
});

test("the 100-version cap refuses new saves and duplicate IDs without truncating any existing history", () => {
  const versions = Array.from({ length: CAREER_LIBRARY_VERSION_LIMIT }, (_, index) => normalizeCareerLibraryVersion({ ...metadata, id: `career-version-${index}` }));
  const original = JSON.stringify(versions);
  assert.throws(() => prepareCareerLibraryVersion({ ...library(), careerLibraryVersions: versions }, metadata), /100 个/);
  assert.throws(() => prepareCareerLibraryVersion(library(), versions[0], { versions }), /已存在/);
  assert.equal(JSON.stringify(versions), original);
  assert.throws(() => normalizeCareerLibraryVersions([versions[0], versions[0]]), /ID 重复/);
  const oversized = [...versions, normalizeCareerLibraryVersion(metadata)];
  assert.equal(normalizeCareerLibraryVersions(oversized).length, 101, "normalization never silently drops a saved history entry");
  assert.equal(prepareCareerLibraryVersion(library(), metadata, { versions: versions.slice(0, 99) }).version.id, metadata.id);
});
