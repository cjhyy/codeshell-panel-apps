import test from "node:test";
import assert from "node:assert/strict";
import { selectSnapshotLocalState } from "../../../apps/job-hunt-hq/app/snapshot-recovery-model.mjs";
import { compactPanelLocalState } from "../../../apps/job-hunt-hq/app/storage-model.mjs";
const restored = { snapshotRestoreId: "g-" + "a".repeat(32) };
const stale = { selectedJobId: "old-job", resumeDraft: { markdown: "old text", updatedAt: "2099" },
  interviewDraft: { answer: "old answer", updatedAt: "2099" } };

test("a committed restore root rejects old Host and browser drafts, irrespective of timestamps", () => {
  const selected = selectSnapshotLocalState(restored, stale, [stale]);
  assert.equal(selected.local.resumeDraft, undefined);
  assert.equal(selected.local.interviewDraft, undefined);
  assert.equal(selected.local.selectedJobId, undefined);
  assert.equal(selected.retired.length, 2);
  assert.equal(stale.resumeDraft.markdown, "old text");
});
test("new drafts remain recoverable even when a stale browser record has a later clock", () => {
  const current = { ...restored, resumeDraft: { markdown: "new text", updatedAt: "2026" } };
  const selected = selectSnapshotLocalState(restored, stale, [stale, current]);
  assert.equal(selected.local.resumeDraft.markdown, "new text");
  assert.equal(selected.local.snapshotRestoreId, restored.snapshotRestoreId);
});
test("legacy roots still recover legacy drafts and markers survive cache compaction", () => {
  assert.equal(selectSnapshotLocalState({}, {}, [stale]).local.resumeDraft.markdown, "old text");
  assert.equal(compactPanelLocalState(restored).snapshotRestoreId, restored.snapshotRestoreId);
});
test("invalid root markers fail closed, while malformed cache markers cannot authorize replay", () => {
  assert.throws(() => selectSnapshotLocalState({ snapshotRestoreId: "bad" }, stale), /标识无效/);
  assert.equal(selectSnapshotLocalState({}, { ...stale, snapshotRestoreId: {} }).local.resumeDraft, undefined);
});
