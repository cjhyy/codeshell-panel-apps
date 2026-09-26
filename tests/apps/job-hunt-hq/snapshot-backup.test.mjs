import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import {
  createSnapshotBackup,
  readSnapshotBackup,
} from "../../../apps/job-hunt-hq/app/snapshot-backup.mjs";
import {
  prepareProjectSnapshotDocuments,
  PROJECT_SNAPSHOT_WRITE_LIMIT_BYTES,
} from "../../../apps/job-hunt-hq/app/snapshot-sharding-model.mjs";
import { writeProjectSnapshotDocuments } from "../../../apps/job-hunt-hq/app/snapshot-storage.mjs";

const hash = (content) => createHash("sha256").update(content).digest("hex");
const legacy = () => ({
  schemaVersion: 1,
  unknownLegacyField: { original: "keep me" },
  questionBank: Array.from({ length: 60 }, (_, i) => ({
    id: String(i),
    notes: "中🙂".repeat(1600),
  })),
});
async function fixture(t, original) {
  const directory = await mkdtemp(join(tmpdir(), "job-hunt-backup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "job-hunt-panel.json"), original);
  const reads = [],
    writes = [];
  const read = async (path) => {
    const content = await readFile(join(directory, path), "utf8");
    return { content, revision: hash(content), modifiedAt: 1 };
  };
  const scope = {
    check() {},
    async call(method, params) {
      if (method === "workspace.readText") {
        reads.push(params.path);
        return read(params.path);
      }
      assert.equal(method, "workspace.writeText");
      assert.ok(Buffer.byteLength(params.content) <= PROJECT_SNAPSHOT_WRITE_LIMIT_BYTES);
      if (params.expectedRevision && (await read(params.path)).revision !== params.expectedRevision)
        throw new Error("revision conflict");
      await mkdir(dirname(join(directory, params.path)), { recursive: true });
      await writeFile(join(directory, params.path), params.content, {
        flag: params.expectedModifiedAt === null ? "wx" : "w",
      });
      writes.push(params.path);
      return read(params.path);
    },
  };
  return { directory, reads, writes, read, scope };
}

test("oversized v1 migration backs up exact UTF-8 bytes and unknown fields before replacing the root", async (t) => {
  const raw = JSON.stringify(legacy(), null, 2) + "\n\n";
  assert.ok(Buffer.byteLength(raw) > PROJECT_SNAPSHOT_WRITE_LIMIT_BYTES);
  const host = await fixture(t, raw);
  const migrated = legacy();
  migrated.schemaVersion = 2;
  delete migrated.unknownLegacyField;
  await writeProjectSnapshotDocuments(prepareProjectSnapshotDocuments(migrated), {
    scope: host.scope,
    previousSnapshot: await host.read("job-hunt-panel.json"),
    backupRequired: true,
  });
  const manifestPath = host.writes.find((path) => path.endsWith("/manifest.json"));
  assert.ok(manifestPath);
  assert.equal(host.writes.at(-1), "job-hunt-panel.json");
  const recovered = await readSnapshotBackup(manifestPath, { scope: host.scope });
  assert.equal(recovered.bundle.root, raw);
  assert.deepEqual(recovered.hydrated, legacy());
  assert.ok(recovered.manifest.parts > 1);
  assert.equal(JSON.parse((await host.read("job-hunt-panel.json")).content).schemaVersion, 2);
});

test("sharded backups reconstruct from disk after the original root and shards are removed", async (t) => {
  const source = prepareProjectSnapshotDocuments(
    { ...legacy(), schemaVersion: 2 },
    {},
    { generation: "a" },
  );
  const host = await fixture(t, source.rootContent);
  for (const shard of source.shards) {
    await mkdir(dirname(join(host.directory, shard.path)), { recursive: true });
    await writeFile(join(host.directory, shard.path), shard.content);
  }
  const saved = await createSnapshotBackup(await host.read("job-hunt-panel.json"), {
    scope: host.scope,
  });
  await rm(join(host.directory, "career-data/panel-shards"), { recursive: true });
  await rm(join(host.directory, "job-hunt-panel.json"));
  const restored = await readSnapshotBackup(saved.path, { scope: host.scope });
  assert.equal(restored.bundle.root, source.rootContent);
  assert.deepEqual(
    restored.bundle.shards,
    source.shards.map(({ path, content }) => ({ path, content })),
  );
  assert.deepEqual(restored.hydrated.questionBank, legacy().questionBank);
});

test("failure writing a part or the completion manifest never commits a migrated root", async (t) => {
  for (const failingSuffix of ["part-0002.txt", "manifest.json"]) {
    const raw = JSON.stringify(legacy());
    const host = await fixture(t, raw);
    const scope = {
      check() {},
      call(method, params) {
        if (method === "workspace.writeText" && params.path.endsWith(failingSuffix))
          throw new Error("disk full");
        return host.scope.call(method, params);
      },
    };
    await assert.rejects(
      writeProjectSnapshotDocuments(
        prepareProjectSnapshotDocuments({ ...legacy(), schemaVersion: 2 }),
        {
          scope,
          previousSnapshot: await host.read("job-hunt-panel.json"),
        },
      ),
      /disk full/,
    );
    assert.equal((await host.read("job-hunt-panel.json")).content, raw);
    assert.equal(
      host.writes.some((path) => path.endsWith("/manifest.json")),
      false,
    );
  }
});

test("corrupt, missing, oversized and unsafe backup inputs cannot be reconstructed", async (t) => {
  const raw = JSON.stringify(legacy());
  const host = await fixture(t, raw);
  const saved = await createSnapshotBackup(await host.read("job-hunt-panel.json"), {
    scope: host.scope,
  });
  const base = dirname(saved.path);
  const part = join(base, "part-0001.txt");
  const originalPart = await readFile(join(host.directory, part), "utf8");
  await writeFile(
    join(host.directory, part),
    originalPart.replace("snapshot-backup", "snapshot-backuq"),
  );
  await assert.rejects(readSnapshotBackup(saved.path, { scope: host.scope }), /校验失败/);
  await rm(join(host.directory, part));
  await assert.rejects(readSnapshotBackup(saved.path, { scope: host.scope }), /ENOENT/);
  for (const patch of [
    { parts: 4097 },
    { bytes: 129 * 1024 * 1024 },
    { generation: "../escape" },
    { version: 99 },
  ]) {
    await writeFile(
      join(host.directory, saved.path),
      JSON.stringify({ ...saved.manifest, ...patch }),
    );
    const calls = host.reads.length;
    await assert.rejects(readSnapshotBackup(saved.path, { scope: host.scope }), /索引无效/);
    assert.equal(host.reads.length, calls + 1);
  }
  const calls = host.reads.length;
  await assert.rejects(
    readSnapshotBackup("career-data/panel-backups/../private/manifest.json", { scope: host.scope }),
    /路径无效/,
  );
  assert.equal(host.reads.length, calls);
});

test("missing legacy shards prevent both backup publication and migration", async (t) => {
  const initial = prepareProjectSnapshotDocuments(legacy(), {}, { generation: "b" });
  const host = await fixture(t, initial.rootContent);
  await assert.rejects(
    writeProjectSnapshotDocuments(
      prepareProjectSnapshotDocuments({ ...legacy(), schemaVersion: 2 }),
      {
        scope: host.scope,
        previousSnapshot: await host.read("job-hunt-panel.json"),
      },
    ),
    /ENOENT/,
  );
  assert.deepEqual(host.writes, []);
  assert.equal((await host.read("job-hunt-panel.json")).content, initial.rootContent);
});

test("switching projects during backup stops before publishing it or replacing the root", async (t) => {
  const raw = JSON.stringify(legacy());
  const host = await fixture(t, raw);
  let active = true;
  const scope = {
    check() {
      if (!active) throw new Error("project changed");
    },
    call: (...args) => host.scope.call(...args),
  };
  await assert.rejects(
    writeProjectSnapshotDocuments(
      prepareProjectSnapshotDocuments({ ...legacy(), schemaVersion: 2 }),
      {
        scope,
        previousSnapshot: await host.read("job-hunt-panel.json"),
        beforeShard(index) {
          if (index === 1) active = false;
        },
      },
    ),
    /project changed/,
  );
  assert.equal(host.writes.length, 1);
  assert.equal((await host.read("job-hunt-panel.json")).content, raw);
});

test("a competing edit after the backup commits wins the root revision check", async (t) => {
  const raw = JSON.stringify({ schemaVersion: 1, resume: { markdown: "original" } });
  const host = await fixture(t, raw);
  const other = JSON.stringify({ schemaVersion: 2, resume: { markdown: "other window" } });
  const scope = {
    check() {},
    async call(method, params) {
      if (method === "workspace.writeText" && params.path === "job-hunt-panel.json") {
        await writeFile(join(host.directory, "job-hunt-panel.json"), other);
      }
      return host.scope.call(method, params);
    },
  };
  await assert.rejects(
    writeProjectSnapshotDocuments(
      prepareProjectSnapshotDocuments({ schemaVersion: 2, resume: { markdown: "migration" } }),
      {
        scope,
        previousSnapshot: await host.read("job-hunt-panel.json"),
      },
    ),
    /revision conflict/,
  );
  assert.equal((await host.read("job-hunt-panel.json")).content, other);
  const manifest = host.writes.find((path) => path.endsWith("manifest.json"));
  assert.equal((await readSnapshotBackup(manifest, { scope: host.scope })).bundle.root, raw);
});

test("a requested storage migration archives a v2 direct root as well", async (t) => {
  const raw =
    '{ "schemaVersion": 2, "interviewSets": [], "legacyContent": "preserve exact bytes" }\n';
  const host = await fixture(t, raw);
  await writeProjectSnapshotDocuments(
    prepareProjectSnapshotDocuments({ schemaVersion: 2, interviewSets: [] }),
    {
      scope: host.scope,
      previousSnapshot: await host.read("job-hunt-panel.json"),
      backupRequired: true,
    },
  );
  const saved = host.writes.find((path) => path.endsWith("manifest.json"));
  assert.equal((await readSnapshotBackup(saved, { scope: host.scope })).bundle.root, raw);
});
