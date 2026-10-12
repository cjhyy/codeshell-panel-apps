import assert from "node:assert/strict";
import test from "node:test";
import { prepareProjectSnapshotDocuments, hydrateProjectSnapshotDocuments } from "../../../apps/job-hunt-hq/app/snapshot-sharding-model.mjs";
import { normalizeClaimEvidence } from "../../../apps/job-hunt-hq/app/resume-model.mjs";
import { normalizeCareerLibrary } from "../../../apps/job-hunt-hq/app/career-library-model.mjs";
import { compactPanelLocalState } from "../../../apps/job-hunt-hq/app/storage-model.mjs";
import { selectSnapshotLocalState } from "../../../apps/job-hunt-hq/app/snapshot-recovery-model.mjs";

test("a growing private library round-trips through independent snapshot shards", () => {
  const library = normalizeCareerLibrary({
    sourceMaterials: Array.from({ length: 40 }, (_, index) => ({ id: `source-${index}`, provider: "slack", externalId: `C1:${index}`, excerpt: `真实上下文${index}。`.repeat(1600), status: "draft", version: 1 })),
    careerEpisodes: [{ id: "episode", title: "设计取舍", sourceIds: ["source-0", "source-39"], status: "confirmed", version: 1 }],
    careerQa: [{ id: "qa", episodeId: "episode", question: "为什么这样选？", answer: "我的真实选择。", sourceIds: ["source-0"], status: "confirmed", version: 1 }],
  });
  const payload = { schemaVersion: 2, careerLibraryMigrationVersion: 1, ...library };
  const documents = prepareProjectSnapshotDocuments(payload);
  assert.ok(documents.shards.length > 1);
  assert.ok(documents.shards.some(shard => shard.field === "sourceMaterials"));
  const hydrated = hydrateProjectSnapshotDocuments(documents.root, new Map(documents.shards.map(shard => [shard.path, JSON.parse(shard.content)])));
  for (const field of ["sourceMaterials", "careerEpisodes", "careerQa"]) assert.deepEqual(hydrated[field], payload[field]);
});

test("project-local career drafts survive cache compaction and stale restore markers cannot replay them", () => {
  const careerDraft = { kind: "episodes", id: "", dirty: true, updatedAt: "2026-10-12T00:00:00Z", record: { title: "未提交的经历", reason: "真实原因。".repeat(500), sourceIds: ["source-1"] } };
  const compacted = compactPanelLocalState({ careerDraft });
  assert.equal(compacted.careerDraft.record.reason, careerDraft.record.reason);
  assert.equal(compacted.careerDraft.record.status, "draft");
  const selected = selectSnapshotLocalState({ snapshotRestoreId: "g-" + "a".repeat(32) }, compacted);
  assert.equal(selected.local.careerDraft, undefined);
  assert.equal(selected.retired[0].careerDraft.record.reason, careerDraft.record.reason);
});

test("resume wording retains stable library references through evidence normalization and merging", () => {
  const evidence = normalizeClaimEvidence([
    { claim: "实现可恢复任务", status: "verified", source_ids: ["s1"], episode_ids: ["e1"], qa_ids: ["q1"], sources: [{ kind: "user", label: "本人确认", locator: "user:fact", evidence: "我的真实经历" }] },
    { claim: "实现可恢复任务", sourceIds: ["s2"], episodeIds: ["e2"], sources: [{ kind: "file", label: "设计文档", locator: "career-data/design.md", evidence: "决策记录" }] },
  ]);
  assert.deepEqual(evidence[0].sourceIds, ["s1", "s2"]);
  assert.deepEqual(evidence[0].episodeIds, ["e1", "e2"]);
  assert.deepEqual(evidence[0].qaIds, ["q1"]);
});
