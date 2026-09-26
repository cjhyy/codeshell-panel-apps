import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareProjectSnapshotDocuments,
  nextSnapshotShardGeneration,
  hydrateProjectSnapshotDocuments,
} from "../../../apps/job-hunt-hq/app/snapshot-sharding-model.mjs";

const payload = (label) => ({
  schemaVersion: 2,
  questionBank: Array.from({ length: 80 }, (_, i) => ({
    id: `question-${i}`,
    notes: label.repeat(6000),
  })),
});
const prepare = (label, previous) =>
  prepareProjectSnapshotDocuments(
    payload(label),
    {},
    {
      generation: nextSnapshotShardGeneration(previous),
    },
  );
const put = (store, prepared) => {
  for (const shard of prepared.shards) store.set(shard.path, shard.payload);
};

test("a writer losing root CAS cannot alter the winning snapshot's data", () => {
  const initial = prepare("initial", "");
  const files = new Map();
  put(files, initial);
  // Both windows captured the same root. A commits before B starts its shard
  // writes; B's root compare-and-set subsequently fails.
  const winner = prepare("winner", initial.generation);
  const loser = prepare("losing", initial.generation);
  put(files, winner);
  const committedRoot = winner.root;
  put(files, loser);
  assert.deepEqual(
    hydrateProjectSnapshotDocuments(committedRoot, files).questionBank,
    payload("winner").questionBank,
  );
});

test("a reader holding an older root survives three later saves", () => {
  const first = prepare("first", "");
  const files = new Map();
  put(files, first);
  let current = first;
  for (const label of ["second", "third", "fourth"]) {
    current = prepare(label, current.generation);
    put(files, current);
  }
  assert.deepEqual(
    hydrateProjectSnapshotDocuments(first.root, files).questionBank,
    payload("first").questionBank,
  );
});

import { createHash } from "node:crypto";
import { writeProjectSnapshotDocuments } from "../../../apps/job-hunt-hq/app/snapshot-storage.mjs";
import { projectSnapshotShardDescriptors } from "../../../apps/job-hunt-hq/app/snapshot-sharding-model.mjs";

function host(initial) {
  const files = new Map(initial.shards.map((shard) => [shard.path, shard.content]));
  files.set("job-hunt-panel.json", initial.rootContent);
  const writes = [];
  const read = (path = "job-hunt-panel.json") => ({
    content: files.get(path),
    modifiedAt: 1,
    revision: createHash("sha256").update(files.get(path)).digest("hex"),
  });
  const scope = {
    check() {},
    async call(method, params) {
      if (method === "workspace.readText") return read(params.path);
      assert.equal(method, "workspace.writeText");
      if (params.expectedModifiedAt === null && files.has(params.path))
        throw new Error("already exists");
      if (params.expectedRevision && read(params.path).revision !== params.expectedRevision)
        throw new Error("revision conflict");
      writes.push(params);
      files.set(params.path, params.content);
      return read(params.path);
    },
  };
  return {
    files,
    writes,
    read,
    scope,
    hydrate: (root = JSON.parse(read().content)) =>
      hydrateProjectSnapshotDocuments(
        root,
        new Map(
          [...files]
            .filter(([path]) => !path.endsWith(".txt"))
            .map(([path, content]) => [path, JSON.parse(content)]),
        ),
      ),
  };
}

test("actual persistence rejects the stale root after writing independent shards", async () => {
  const initial = prepare("initial");
  const store = host(initial);
  const previousSnapshot = store.read();
  const winner = prepare("winner", initial.generation);
  const loser = prepare("losing", initial.generation);
  await writeProjectSnapshotDocuments(winner, { scope: store.scope, previousSnapshot });
  await assert.rejects(
    writeProjectSnapshotDocuments(loser, { scope: store.scope, previousSnapshot }),
    /revision conflict/,
  );
  assert.deepEqual(store.hydrate().questionBank, payload("winner").questionBank);
  assert.deepEqual(store.hydrate(initial.root).questionBank, payload("initial").questionBank);
});

test("failed midway through shards leaves the committed root and old readers intact", async () => {
  const initial = prepare("initial");
  const store = host(initial);
  const previousSnapshot = store.read();
  const next = prepare("update", initial.generation);
  assert.ok(next.shards.length > 1);
  await assert.rejects(
    writeProjectSnapshotDocuments(next, {
      scope: store.scope,
      previousSnapshot,
      beforeShard(index) {
        if (index === 1) throw new Error("host stopped");
      },
    }),
    /host stopped/,
  );
  assert.equal(store.read().content, previousSnapshot.content);
  assert.deepEqual(store.hydrate().questionBank, payload("initial").questionBank);
});

test("even a generation collision cannot overwrite an existing shard", async () => {
  const initial = prepare("initial");
  const store = host(initial);
  const colliding = prepareProjectSnapshotDocuments(
    payload("replace"),
    {},
    { generation: initial.generation },
  );
  await assert.rejects(
    writeProjectSnapshotDocuments(colliding, {
      scope: store.scope,
      previousSnapshot: store.read(),
    }),
    /already exists/,
  );
  assert.equal(store.writes.length, 0);
  assert.deepEqual(store.hydrate().questionBank, payload("initial").questionBank);
});

for (const legacyGeneration of ["a", "b"]) {
  for (const small of [false, true]) {
    test(`legacy ${legacyGeneration} remains readable and backed up on ${small ? "direct" : "sharded"} save`, async () => {
      const initial = prepareProjectSnapshotDocuments(
        payload("legacy"),
        {},
        { generation: legacyGeneration },
      );
      const store = host(initial);
      const previousSnapshot = store.read();
      assert.deepEqual(store.hydrate().questionBank, payload("legacy").questionBank);
      const next = small
        ? prepareProjectSnapshotDocuments({ schemaVersion: 2, questionBank: [] })
        : prepare("update");
      await writeProjectSnapshotDocuments(next, { scope: store.scope, previousSnapshot });
      const backup = store.writes.find((write) => write.path.endsWith("/previous-root.json"));
      assert.match(backup.path, /^career-data\/panel-shards\/g-[0-9a-f]{32}\/previous-root.json$/);
      assert.equal(backup.content, previousSnapshot.content);
      assert.equal(backup.expectedModifiedAt, null);
      assert.deepEqual(
        store.hydrate(JSON.parse(backup.content)).questionBank,
        payload("legacy").questionBank,
      );
      assert.deepEqual(store.hydrate().questionBank, small ? [] : payload("update").questionBank);
    });
  }
}

test("legacy backup failure prevents committing or writing shards", async () => {
  const initial = prepareProjectSnapshotDocuments(payload("legacy"), {}, { generation: "a" });
  const store = host(initial);
  await assert.rejects(
    writeProjectSnapshotDocuments(prepare("update"), {
      scope: {
        check() {},
        async call() {
          throw new Error("disk full");
        },
      },
      previousSnapshot: store.read(),
    }),
    /disk full/,
  );
  assert.equal(store.read().content, initial.rootContent);
});

test("legacy generation writes are forbidden; future, mismatched and unsafe generations are rejected", async () => {
  const legacy = prepareProjectSnapshotDocuments(payload("legacy"), {}, { generation: "a" });
  const store = host(legacy);
  await assert.rejects(writeProjectSnapshotDocuments(legacy, { scope: store.scope }), /只允许读取/);
  for (const generation of ["../escape", "g-short", "g-" + "f".repeat(33), "a/../b"]) {
    assert.throws(
      () => prepareProjectSnapshotDocuments(payload("bad"), {}, { generation }),
      /代号无效/,
    );
  }
  const valid = prepare("valid");
  for (const schemaVersion of [1, 3]) {
    const root = structuredClone(valid.root);
    root.artifactStorage.schemaVersion = schemaVersion;
    assert.throws(() => projectSnapshotShardDescriptors(root), /索引无效/);
  }
  const docs = new Map(valid.shards.map((shard) => [shard.path, structuredClone(shard.payload)]));
  docs.get(valid.shards[0].path).schemaVersion = 1;
  assert.throws(() => hydrateProjectSnapshotDocuments(valid.root, docs), /无效或缺失/);
});

test("switching projects between shard writes prevents further files and root commit", async () => {
  const initial = prepare("initial");
  const store = host(initial);
  let active = true;
  const scope = {
    check() {
      if (!active) throw new Error("project changed");
    },
    async call(method, params) {
      this.check();
      return store.scope.call(method, params);
    },
  };
  await assert.rejects(
    writeProjectSnapshotDocuments(prepare("update"), {
      scope,
      previousSnapshot: store.read(),
      beforeShard(index) {
        if (index === 1) active = false;
      },
    }),
    /project changed/,
  );
  assert.equal(store.writes.length, 1);
  assert.equal(store.read().content, initial.rootContent);
});
