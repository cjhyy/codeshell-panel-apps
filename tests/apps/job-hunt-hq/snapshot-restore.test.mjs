import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createSnapshotBackup, readSnapshotBackup, readPortableSnapshotBackup, persistSnapshotBundle, rawSnapshotBundle } from "../../../apps/job-hunt-hq/app/snapshot-backup.mjs";
import { reviewSnapshotRestore, applySnapshotRestore } from "../../../apps/job-hunt-hq/app/snapshot-restore.mjs";
import { prepareProjectSnapshotDocuments, hydrateProjectSnapshotDocuments, PROJECT_SNAPSHOT_WRITE_LIMIT_BYTES } from "../../../apps/job-hunt-hq/app/snapshot-sharding-model.mjs";

const ROOT = "job-hunt-panel.json";
const document = markdown => ({ schemaVersion: 2, resume: { markdown }, jobs: [] });
async function fixture(t, payload = document("backup")) {
  const directory = await mkdtemp(join(tmpdir(), "job-hunt-restore-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  let active = true;
  const read = async path => {
    const content = await readFile(join(directory, path), "utf8");
    return { content, revision: createHash("sha256").update(content).digest("hex"), modifiedAt: 1 };
  };
  const put = async (path, content) => {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content);
  };
  const host = { directory, calls, read, put, before: null, after: null,
    switch() { active = false; }, scope: {
      check() { if (!active) throw new Error("project changed"); },
      async call(method, params) {
        calls.push({ method, params });
        await host.before?.(method, params);
        let result;
        if (method === "workspace.readText") result = await read(params.path);
        else {
          assert.equal(method, "workspace.writeText");
          assert.ok(Buffer.byteLength(params.content) <= PROJECT_SNAPSHOT_WRITE_LIMIT_BYTES);
          if (params.expectedRevision && (await read(params.path)).revision !== params.expectedRevision)
            throw new Error("revision conflict");
          await mkdir(dirname(join(directory, params.path)), { recursive: true });
          await writeFile(join(directory, params.path), params.content, { flag: params.expectedModifiedAt === null ? "wx" : "w" });
          result = await read(params.path);
        }
        await host.after?.(method, params);
        return result;
      },
    } };
  const source = prepareProjectSnapshotDocuments(payload);
  await put(ROOT, source.rootContent);
  for (const shard of source.shards) await put(shard.path, shard.content);
  host.backup = await createSnapshotBackup(await read(ROOT), { scope: host.scope });
  await put(ROOT, JSON.stringify(document("current")));
  calls.length = 0;
  return host;
}
const rootWrites = host => host.calls.filter(c => c.method === "workspace.writeText" && c.params.path === ROOT);
const writes = host => host.calls.filter(c => c.method === "workspace.writeText");
const review = (host, extra = {}) => reviewSnapshotRestore(host.backup.path, { scope: host.scope, ...extra });

test("restore preserves exact current bytes, drafts and unsaved business changes before publishing a new restore marker", async t => {
  const host = await fixture(t);
  const original = '{ "schemaVersion": 2, "resume": {"markdown":"current"}, "unknown":"中🙂" }\n';
  await host.put(ROOT, original);
  const clientState = { dirty: true, drafts: { interviewDraft: { answer: "unsaved" } }, records: [{ raw: "original browser record" }], unsavedProject: document("unsaved project") };
  const plan = await review(host, { clientState });
  assert.equal(writes(host).length, 0, "preview never writes");
  const result = await applySnapshotRestore(plan, { scope: host.scope });
  assert.match(result.snapshotRestoreId, /^g-[a-f0-9]{32}$/);
  const root = JSON.parse((await host.read(ROOT)).content);
  assert.equal(root.resume.markdown, "backup");
  assert.equal(root.snapshotRestoreId, result.snapshotRestoreId);
  const preserved = await readSnapshotBackup(result.preserved.path, { scope: host.scope });
  assert.equal(preserved.bundle.root, original);
  assert.deepEqual(preserved.bundle.clientState.drafts, clientState.drafts);
  assert.deepEqual(preserved.bundle.clientState.records, clientState.records);
  const unsaved = await readSnapshotBackup(result.unsavedPreserved.path, { scope: host.scope });
  assert.equal(unsaved.hydrated.resume.markdown, "unsaved project");
  assert.equal(writes(host).at(-1).params.path, ROOT);
  const second = await reviewSnapshotRestore(result.preserved.path, { scope: host.scope });
  assert.notEqual(second.prepared.root.snapshotRestoreId, result.snapshotRestoreId);
});

test("damaged and missing roots can recover; malformed original text is retained verbatim", async t => {
  for (const content of ['{ damaged 中🙂\n', JSON.stringify({ schemaVersion: 99 }), null]) {
    const host = await fixture(t);
    if (content === null) await rm(join(host.directory, ROOT)); else await host.put(ROOT, content);
    const plan = await review(host);
    assert.equal(plan.previousStatus, content === null ? "missing" : "damaged");
    const result = await applySnapshotRestore(plan, { scope: host.scope });
    const old = await readSnapshotBackup(result.preserved.path, { scope: host.scope });
    assert.equal(old.raw, true);
    assert.equal(old.bundle.root, content ?? "");
    assert.equal(JSON.parse((await host.read(ROOT)).content).resume.markdown, "backup");
    const raw = await reviewSnapshotRestore(result.preserved.path, { scope: host.scope });
    assert.equal(raw.restorable, false);
    await assert.rejects(applySnapshotRestore(raw, { scope: host.scope }), /只能下载/);
  }
});

test("sharded restore reconstructs independent fresh generations after original source files disappear", async t => {
  const payload = { ...document("large backup"), questionBank: Array.from({ length: 70 }, (_, i) => ({ id: String(i), notes: "中🙂".repeat(1000) })) };
  const host = await fixture(t, payload);
  await rm(join(host.directory, "career-data/panel-shards"), { recursive: true });
  const plan = await review(host);
  await applySnapshotRestore(plan, { scope: host.scope });
  assert.ok(plan.prepared.shards.length > 0);
  const docs = new Map();
  for (const shard of plan.prepared.shards) docs.set(shard.path, JSON.parse((await host.read(shard.path)).content));
  assert.deepEqual(hydrateProjectSnapshotDocuments(JSON.parse((await host.read(ROOT)).content), docs).questionBank, payload.questionBank);
});

test("changed target is rejected before archiving; a race during archive cannot overwrite the winner", async t => {
  for (const late of [false, true]) {
    const host = await fixture(t);
    const plan = await review(host);
    const other = JSON.stringify(document("other writer"));
    if (!late) await host.put(ROOT, other);
    else host.before = async (method, params) => {
      if (method === "workspace.writeText" && params.path === ROOT) await host.put(ROOT, other);
    };
    await assert.rejects(applySnapshotRestore(plan, { scope: host.scope }), late ? /revision conflict/ : /项目已变化/);
    assert.equal((await host.read(ROOT)).content, other);
    if (!late) assert.equal(writes(host).length, 0);
  }
});

test("partial backup or root write failures preserve the current document", async t => {
  for (const failing of ["part-0001.txt", "manifest.json", ROOT]) {
    const host = await fixture(t);
    const original = (await host.read(ROOT)).content;
    const plan = await review(host);
    host.before = (method, params) => {
      if (method === "workspace.writeText" && params.path.endsWith(failing)) throw new Error("disk full");
    };
    await assert.rejects(applySnapshotRestore(plan, { scope: host.scope }), /disk full/);
    assert.equal((await host.read(ROOT)).content, original);
    assert.equal(rootWrites(host).length, failing === ROOT ? 1 : 0);
  }
});

test("lost acknowledgement is verified once; an unavailable readback leaves an uncertain result without retry", async t => {
  for (const unavailable of [false, true]) {
    const host = await fixture(t);
    const plan = await review(host);
    let attempted = false, readbacks = 0;
    host.before = (method, params) => {
      if (method === "workspace.readText" && params.path === ROOT && attempted) {
        readbacks++;
        if (unavailable) throw new Error("offline");
      }
    };
    host.after = (method, params) => {
      if (method === "workspace.writeText" && params.path === ROOT) { attempted = true; throw new Error("lost ack"); }
    };
    if (unavailable) await assert.rejects(applySnapshotRestore(plan, { scope: host.scope }), { code: "RESTORE_UNCERTAIN" });
    else await applySnapshotRestore(plan, { scope: host.scope });
    assert.equal(rootWrites(host).length, 1);
    assert.equal(readbacks, 1);
    assert.equal((await host.read(ROOT)).content, plan.prepared.rootContent);
  }
});

test("switching projects during preservation stops before committing the replacement root", async t => {
  const host = await fixture(t);
  const plan = await review(host);
  host.after = (method, params) => {
    if (method === "workspace.writeText" && params.path.endsWith("part-0001.txt")) host.switch();
  };
  await assert.rejects(applySnapshotRestore(plan, { scope: host.scope }), /project changed/);
  assert.equal(rootWrites(host).length, 0);
  assert.equal(JSON.parse((await host.read(ROOT)).content).resume.markdown, "current");
});

test("unreadable target and missing revision fail closed, rather than treating errors as a missing root", async t => {
  for (const failure of ["permission denied", "network offline"]) {
    const host = await fixture(t);
    host.before = (method, params) => { if (params.path === ROOT) throw new Error(failure); };
    await assert.rejects(review(host), new RegExp(failure));
    assert.equal(writes(host).length, 0);
  }
  const host = await fixture(t);
  const scope = { check() {}, async call(method, params) {
    const result = await host.scope.call(method, params);
    if (params.path === ROOT) delete result.revision;
    return result;
  } };
  await assert.rejects(reviewSnapshotRestore(host.backup.path, { scope }), /主文件版本/);
});

test("portable exports verify exact bundle digest; altered content or incomplete raw files cannot restore", async t => {
  const host = await fixture(t);
  const saved = await readSnapshotBackup(host.backup.path, { scope: host.scope });
  const portable = JSON.stringify({ manifest: saved.manifest, bundle: saved.bundle }, null, 2);
  assert.equal((await readPortableSnapshotBackup(portable)).hydrated.resume.markdown, "backup");
  const plan = await reviewSnapshotRestore(portable, { scope: host.scope });
  await applySnapshotRestore(plan, { scope: host.scope });
  await assert.rejects(readPortableSnapshotBackup(portable.replace("backup\\\"", "tampered\\\"")), /校验失败/);
  await assert.rejects(readPortableSnapshotBackup(JSON.stringify(document("raw file"))), /完整备份/);
  const raw = await persistSnapshotBundle(rawSnapshotBundle("broken original", { drafts: { answer: "kept" } }), { scope: host.scope });
  const preserved = await readSnapshotBackup(raw.path, { scope: host.scope });
  assert.equal((await readPortableSnapshotBackup(JSON.stringify(preserved))).raw, true);
});
