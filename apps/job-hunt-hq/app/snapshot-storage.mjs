import { createSnapshotBackup } from "./snapshot-backup.mjs";
import {
  nextSnapshotShardGeneration,
  projectSnapshotShardDescriptors,
} from "./snapshot-sharding-model.mjs";

/**
 * Write private, create-only shards before comparing and replacing the root.
 * A stale writer can leave unreachable files, but can never modify a generation
 * another root references. Do not garbage-collect here: other readers may still
 * hold an older root.
 */
export async function writeProjectSnapshotDocuments(
  prepared,
  { scope, previousSnapshot = null, beforeShard = async () => {}, backupRequired = false, previousSnapshotArchived = false },
) {
  if (prepared.shards.length && prepared.root.artifactStorage?.schemaVersion !== 2) {
    throw new Error("旧分片格式只允许读取，不能覆盖写入");
  }
  let operation = 0;
  const beforeOperation = async () => {
    await beforeShard(operation++);
    scope.check();
  };
  const previousRoot = previousSnapshot && !previousSnapshotArchived ? JSON.parse(previousSnapshot.content) : null;
  if (
    previousRoot &&
    (backupRequired ||
      previousRoot.schemaVersion === 1 ||
      previousRoot.artifactStorage?.schemaVersion === 1)
  ) {
    await createSnapshotBackup(previousSnapshot, { scope, beforeOperation });
  }
  if (previousRoot?.artifactStorage?.schemaVersion === 1) {
    projectSnapshotShardDescriptors(previousRoot);
    // Preserve the exact legacy root before upgrading, including when the new
    // snapshot becomes small enough to be stored directly. Legacy A/B shards
    // are never modified by this writer, so this root remains recoverable.
    const generation = prepared.generation || nextSnapshotShardGeneration();
    await beforeOperation();
    await scope.call("workspace.writeText", {
      path: `career-data/panel-shards/${generation}/previous-root.json`,
      content: previousSnapshot.content,
      expectedModifiedAt: null,
    });
  }
  for (const shard of prepared.shards) {
    await beforeOperation();
    await scope.call("workspace.writeText", {
      path: shard.path,
      content: shard.content,
      expectedModifiedAt: null,
    });
  }
  await beforeOperation();
  return scope.call("workspace.writeText", {
    path: "job-hunt-panel.json",
    content: prepared.rootContent,
    expectedModifiedAt: previousSnapshot?.modifiedAt ?? null,
    ...(previousSnapshot?.revision ? { expectedRevision: previousSnapshot.revision } : {}),
  });
}
