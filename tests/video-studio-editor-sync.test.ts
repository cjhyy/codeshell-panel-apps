import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSnapshot,
  verifySnapshot,
  validateSnapshot,
  analyzeSnapshotGraph,
  snapshotRelationship,
  describeWorkingCopy,
  planSnapshotMerge,
  resolveSnapshotMerge,
  snapshotCanonical,
  snapshotDigest,
  snapshotBundlePath,
  snapshotIncomingPath,
} from "../apps/video-studio/src/editor/snapshot-sync";
import { createDemoProject } from "../apps/video-studio/src/model";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
const make = (parents: string[] = [], note = "") =>
  createSnapshot({
    projectId: "project",
    bundle: { sha256: "a".repeat(64), bytes: 100 },
    parents,
    deviceId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-09-16T00:00:00.000Z",
    note,
  });
test("canonical snapshot hash is deterministic and independent of field insertion order, timestamps never elect a winner", async () => {
  const source = await make(),
    other = Object.fromEntries(Object.entries(source).reverse());
  assert.deepEqual(await verifySnapshot(other), source);
  assert.equal(snapshotCanonical({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(
    await snapshotDigest("hello"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
  await assert.rejects(verifySnapshot({ ...source, note: "forged" }), {
    code: "SNAPSHOT_HASH_MISMATCH",
  });
});
test("strict formats reject unknown version, paths, prototype getters, sparse arrays and invalid hashes", async () => {
  const source = await make();
  assert.throws(() => validateSnapshot({ ...source, formatVersion: 2 }), {
    code: "UNSUPPORTED_SYNC_VERSION",
  });
  for (const value of [
    { ...source, path: "/tmp" },
    { ...source, parents: new Array(1) },
    { ...source, bundle: { ...source.bundle, path: "/tmp" } },
    Object.assign(Object.create({}), source),
    { ...source, createdAt: "2026-02-30T00:00:00.000Z" },
  ])
    assert.throws(() => validateSnapshot(value));
  let read = false;
  const getter = { ...source };
  Object.defineProperty(getter, "note", {
    enumerable: true,
    get() {
      read = true;
      throw Error("read");
    },
  });
  assert.throws(() => validateSnapshot(getter));
  assert.equal(read, false);
  assert.throws(() => snapshotBundlePath("../anything"));
  assert.throws(() => snapshotIncomingPath("/tmp/source"));
});
test("concurrent children remain separate heads; explicit two-parent merge preserves both branches", async () => {
  const base = await make(),
    left = await make([base.id], "left"),
    right = await make([base.id], "right");
  const graph = analyzeSnapshotGraph([right, base, left]);
  assert.deepEqual(graph.heads, [left.id, right.id].sort());
  assert.deepEqual(snapshotRelationship(graph, left.id, right.id), {
    kind: "conflict",
    commonAncestors: [base.id],
  });
  const merged = await make([right.id, left.id], "reviewed merge"),
    joined = analyzeSnapshotGraph([base, left, right, merged]);
  assert.deepEqual(joined.heads, [merged.id]);
  assert.equal(snapshotRelationship(joined, merged.id, left.id).kind, "ahead");
  assert.equal(describeWorkingCopy(joined, left.id, true).canFastForward, false);
  assert.equal(describeWorkingCopy(joined, left.id, false).canFastForward, true);
});
test("out-of-order propagation and unknown base cannot masquerade as a complete history", async () => {
  const base = await make(),
    child = await make([base.id], "child"),
    graph = analyzeSnapshotGraph([child]);
  assert.equal(graph.complete, false);
  assert.deepEqual(graph.missingParents, [base.id]);
  assert.equal(describeWorkingCopy(graph, null, false).state, "incomplete");
  const complete = analyzeSnapshotGraph([base, child]);
  complete.complete = false;
  assert.equal(describeWorkingCopy(complete, base.id, false).state, "incomplete");
  assert.equal(snapshotRelationship(complete, base.id, child.id).kind, "incomplete");
});
test("malformed cyclic histories reject and long valid chains do not recurse the JS stack", async () => {
  const root = await make();
  assert.throws(() =>
    analyzeSnapshotGraph([
      { ...root, id: "a".repeat(64), parents: ["b".repeat(64)] },
      { ...root, id: "b".repeat(64), parents: ["a".repeat(64)] },
    ]),
  );
  const records = Array.from({ length: 9000 }, (_, index) => ({
    ...root,
    id: (index + 1).toString(16).padStart(64, "0"),
    parents: index ? [index.toString(16).padStart(64, "0")] : [],
  }));
  assert.deepEqual(analyzeSnapshotGraph(records).heads, [records.at(-1)!.id]);
});
function documents() {
  const base = migrateLegacyProject(createDemoProject());
  return { base, left: structuredClone(base), right: structuredClone(base) };
}
test("three-way planner keeps full versions and merges independent entities without mutating inputs", () => {
  const { base, left, right } = documents();
  left.name = "左边工程名";
  right.sequences[0]!.name = "右边序列名";
  const plan = planSnapshotMerge(base, left, right),
    candidate = resolveSnapshotMerge(plan, {});
  assert.equal(candidate.name, left.name);
  assert.equal(candidate.sequences[0]!.name, right.sequences[0]!.name);
  assert.equal(candidate.revision, Math.max(base.revision, left.revision, right.revision) + 1);
  assert.notEqual(base.name, left.name);
  assert.notEqual(base.sequences[0]!.name, right.sequences[0]!.name);
});
test("same sequence concurrent edits remain explicit conflicts, even at different clip fields", () => {
  const { base, left, right } = documents();
  left.sequences[0]!.name = "左序列";
  right.sequences[0]!.background = "#112233";
  const plan = planSnapshotMerge(base, left, right),
    conflicts = plan.units.filter((unit) => unit.status === "conflict");
  assert.equal(conflicts.length, 1);
  assert.throws(() => resolveSnapshotMerge(plan, {}), { code: "UNRESOLVED_CONFLICT" });
  const selected = resolveSnapshotMerge(plan, { [conflicts[0]!.key]: "right" });
  assert.deepEqual(selected.sequences, right.sequences);
  assert.deepEqual(plan.left.sequences, left.sequences);
  assert.deepEqual(plan.right.sequences, right.sequences);
});
test("merge refuses dangling references and unknown choices rather than dropping an asset or clip", () => {
  const { base, left, right } = documents();
  const asset = base.assets.find((item) =>
    base.sequences.some((sequence) =>
      sequence.clips.some((clip) => clip.kind === "media" && clip.assetId === item.id),
    ),
  )!;
  left.assets = left.assets.filter((item) => item.id !== asset.id);
  for (const sequence of left.sequences)
    sequence.clips = sequence.clips.filter(
      (clip) => clip.kind !== "media" || clip.assetId !== asset.id,
    );
  right.sequences[0]!.name = "保存右片段";
  const plan = planSnapshotMerge(base, left, right),
    conflict = plan.units.find((unit) => unit.status === "conflict")!;
  assert.throws(() => resolveSnapshotMerge(plan, { [conflict.key]: "right" }));
  assert.throws(() => resolveSnapshotMerge(plan, { unknown: "left" }));
});

import {
  createEditorSyncStorage,
  validateEditorSyncState,
  editorSyncContentHash,
} from "../apps/video-studio/src/editor/sync-storage";
test("content identity ignores counters and a fingerprint-equivalent receiving resource but retains metadata edits", async () => {
  const { base } = documents(),
    asset = base.assets[0]!;
  asset.resourceId = `asset-${"a".repeat(64)}`;
  asset.fingerprint = "a".repeat(64);
  asset.metadata = { sourcePath: "/original/file" };
  const received = structuredClone(base);
  received.revision++;
  received.assets[0]!.resourceId = `asset-${"b".repeat(64)}`;
  assert.equal(await editorSyncContentHash(base), await editorSyncContentHash(received));
  received.assets[0]!.metadata = { sourcePath: "/different/original" };
  assert.notEqual(await editorSyncContentHash(base), await editorSyncContentHash(received));
});
test("sync state uses Host CAS, retains a failed write base, and rejects unknown fields or workspace switches", async () => {
  let data: unknown = null,
    revision = 0,
    cwd = "/scope",
    fail = false;
  const writes: any[] = [];
  const panel = {
    getContext: async () => ({
      cwd,
      availableMethods: ["media.document.get", "media.document.set"],
      capabilities: { bridge: { maxCallsPerWindow: 10000 } },
    }),
    on: () => () => {},
    call: async (method: string, params: any) => {
      if (method === "media.document.get") return { data, revision };
      if (method === "media.document.set") {
        writes.push(params);
        if (fail) throw Error("CAS failed");
        assert.equal(params.baseRevision, revision);
        data = structuredClone(params.data);
        return { revision: ++revision };
      }
      throw Error("unexpected");
    },
  };
  const storage = createEditorSyncStorage(panel, "project"),
    state = await storage.read();
  assert.equal(state.base, null);
  await storage.write(state);
  fail = true;
  await assert.rejects(storage.write(state), /CAS failed/);
  assert.equal(revision, 1);
  fail = false;
  await storage.write(state);
  assert.equal(writes.at(-1).baseRevision, 1);
  assert.throws(() => validateEditorSyncState({ ...state, path: "/arbitrary" }, "project"));
  assert.throws(() => validateEditorSyncState({ ...state, imports: new Array(1) }, "project"));
  cwd = "/other";
  await assert.rejects(storage.write(state), { code: "WORKSPACE_CHANGED" });
  assert.equal(revision, 2);
  storage.dispose();
});
