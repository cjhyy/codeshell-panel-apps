import { captureSnapshotBundle, persistSnapshotBundle, rawSnapshotBundle, readSnapshotBackup, readPortableSnapshotBackup } from "./snapshot-backup.mjs";
import { nextSnapshotShardGeneration, prepareProjectSnapshotDocuments } from "./snapshot-sharding-model.mjs";
import { writeProjectSnapshotDocuments } from "./snapshot-storage.mjs";

const ROOT = "job-hunt-panel.json";
const missing = error => /ENOENT|no such file|file not found/i.test(String(error?.message || error));
async function currentSnapshot(scope) {
  scope.check();
  try {
    const value = await scope.call("workspace.readText", { path: ROOT });
    scope.check();
    if (typeof value?.content !== "string" || typeof value.revision !== "string" || !value.revision)
      throw new Error("无法确认当前主文件版本，已停止恢复");
    return value;
  } catch (error) {
    scope.check();
    if (missing(error)) return null;
    throw error;
  }
}

export async function reviewSnapshotRestore(path, { scope, beforeOperation = async () => {}, clientState }) {
  let operation = 0;
  const before = () => beforeOperation(operation++);
  const backup = /^career-data\/panel-backups\/g-[0-9a-f]{32}\/manifest\.json$/.test(path)
    ? await readSnapshotBackup(path, { scope, beforeOperation: before })
    : await readPortableSnapshotBackup(path);
  scope.check();
  if (backup.raw) return { path, backup, restorable: false };
  await before();
  const previousSnapshot = await currentSnapshot(scope);
  const { unsavedProject, ...draftClientState } = clientState || {};
  const unsavedBundle = clientState?.dirty && unsavedProject
    ? await captureSnapshotBundle({ content: JSON.stringify(unsavedProject) }, { scope, beforeOperation: before, clientState: draftClientState }) : null;
  let previousBundle;
  let previousStatus = previousSnapshot ? "valid" : "missing";
  if (!previousSnapshot) previousBundle = rawSnapshotBundle("", draftClientState);
  else {
    try {
      previousBundle = await captureSnapshotBundle(previousSnapshot, { scope, beforeOperation: before, clientState: draftClientState });
    } catch (error) {
      scope.check();
      // Only malformed/incomplete snapshot data can use raw preservation.
      // Permission, connectivity and unknown read failures still stop review.
      if (!(error instanceof SyntaxError) && !missing(error) &&
          !/快照.*(?:无效|不受支持|不完整|无关分片|重复)/.test(String(error?.message || error))) throw error;
      previousStatus = "damaged";
      previousBundle = rawSnapshotBundle(previousSnapshot.content, draftClientState);
    }
  }
  const payload = { ...structuredClone(backup.hydrated), schemaVersion: 2,
    snapshotRestoreId: nextSnapshotShardGeneration() };
  const prepared = prepareProjectSnapshotDocuments(payload);
  return { path, backup, previousSnapshot, previousBundle, unsavedBundle, previousStatus, prepared, restorable: true };
}

export async function applySnapshotRestore(review, { scope, beforeOperation = async () => {} }) {
  if (!review?.restorable) throw new Error("原文备份只能下载，不能直接恢复为项目快照");
  let operation = 0;
  const before = () => beforeOperation(operation++);
  await before();
  const current = await currentSnapshot(scope);
  const previous = review.previousSnapshot;
  if ((current?.content ?? null) !== (previous?.content ?? null) ||
      (current?.revision ?? null) !== (previous?.revision ?? null) ||
      (current?.modifiedAt ?? null) !== (previous?.modifiedAt ?? null))
    throw new Error("当前项目已变化，请重新选择备份并预览后恢复");
  const unsavedPreserved = review.unsavedBundle ? await persistSnapshotBundle(review.unsavedBundle, {
    scope, beforeOperation: before, reason: "before-restore-unsaved",
  }) : null;
  const preserved = await persistSnapshotBundle(review.previousBundle, {
    scope, beforeOperation: before, reason: "before-restore",
  });
  scope.check();
  let result;
  try {
    result = await writeProjectSnapshotDocuments(review.prepared, {
      scope, previousSnapshot: previous, previousSnapshotArchived: true, beforeShard: before,
    });
  } catch (error) {
    scope.check();
    // A lost acknowledgement must not repeat a root write. The unique restore
    // marker makes an exact read-back evidence that this specific write landed.
    let observed;
    try { await before(); observed = await currentSnapshot(scope); }
    catch {
      scope.check();
      throw Object.assign(new Error("无法确认恢复结果，请重新读取项目后检查；不要重复提交恢复"), { code: "RESTORE_UNCERTAIN" });
    }
    if (observed?.content !== review.prepared.rootContent) throw error;
    result = observed;
  }
  scope.check();
  return { result, preserved, unsavedPreserved, snapshotRestoreId: review.prepared.root.snapshotRestoreId };
}
