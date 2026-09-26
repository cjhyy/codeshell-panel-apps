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
  { scope, previousSnapshot = null, beforeShard = async () => {} },
) {
  if (prepared.shards.length && prepared.root.artifactStorage?.schemaVersion !== 2) {
    throw new Error("旧分片格式只允许读取，不能覆盖写入");
  }
  const previousRoot = previousSnapshot ? JSON.parse(previousSnapshot.content) : null;
  if (previousRoot?.artifactStorage?.schemaVersion === 1) {
    projectSnapshotShardDescriptors(previousRoot);
    // Preserve the exact legacy root before upgrading, including when the new
    // snapshot becomes small enough to be stored directly. Legacy A/B shards
    // are never modified by this writer, so this root remains recoverable.
    const generation = prepared.generation || nextSnapshotShardGeneration();
    await scope.call("workspace.writeText", {
      path: `career-data/panel-shards/${generation}/previous-root.json`,
      content: previousSnapshot.content,
      expectedModifiedAt: null,
    });
  }
  for (const [index, shard] of prepared.shards.entries()) {
    await beforeShard(index);
    scope.check();
    await scope.call("workspace.writeText", {
      path: shard.path,
      content: shard.content,
      expectedModifiedAt: null,
    });
  }
  scope.check();
  return scope.call("workspace.writeText", {
    path: "job-hunt-panel.json",
    content: prepared.rootContent,
    expectedModifiedAt: previousSnapshot?.modifiedAt ?? null,
    ...(previousSnapshot?.revision ? { expectedRevision: previousSnapshot.revision } : {}),
  });
}
