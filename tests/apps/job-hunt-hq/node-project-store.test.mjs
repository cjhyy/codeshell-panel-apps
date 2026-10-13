import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createNodeProjectStore } from "../../../apps/job-hunt-hq/app/node-project-store.mjs";
import { createNodeWorkspaceScope } from "../../../apps/job-hunt-hq/app/tools/node-workspace-scope.mjs";
import {
  hydrateProjectSnapshotDocuments,
  prepareProjectSnapshotDocuments,
} from "../../../apps/job-hunt-hq/app/snapshot-sharding-model.mjs";
import { writeProjectSnapshotDocuments } from "../../../apps/job-hunt-hq/app/snapshot-storage.mjs";

const ROOT_FILE = "job-hunt-panel.json";
const WRITE_LIMIT = 384 * 1024;
const READ_LIMIT = 480 * 1024;
const revision = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const code = (expected) => (error) => error.code === expected;
const sharedLock = (project, path = ROOT_FILE) => join(project, dirname(path), `.codeshell-workspace-write-${createHash("sha256").update(path.split("/").at(-1).normalize("NFC").toLowerCase()).digest("hex")}.lock`);

function fixture(t) {
  // macOS aliases /var and /tmp; the store intentionally requires a real path.
  const home = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "job-hunt-store-test-"));
  const project = join(home, "project");
  fs.mkdirSync(project);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, project, store: createNodeProjectStore(project) };
}

function put(project, path, content) {
  const absolute = join(project, path);
  fs.mkdirSync(dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

function putPrepared(project, prepared) {
  for (const shard of prepared.shards) put(project, shard.path, shard.content);
  put(project, ROOT_FILE, prepared.rootContent);
}

function snapshot(label) {
  return {
    schemaVersion: 2,
    profile: { name: "Synthetic candidate", summary: label },
    sourceMaterials: [{ id: "source-test", excerpt: `${label} source` }],
    careerEpisodes: [{ id: "episode-test", title: label, extension: { retained: true } }],
    careerQa: [{ id: "qa-test", question: label, answer: `${label} answer` }],
    questionBank: Array.from({ length: 12 }, (_, index) => ({
      id: `question-${index}`,
      notes: label.repeat(3000),
    })),
    extensionOwnedByAnotherFeature: { nested: [{ exact: "保留原文" }], enabled: true },
  };
}

const prepare = (label, generation) => prepareProjectSnapshotDocuments(snapshot(label), {}, {
  ...(generation ? { generation } : {}),
  safeBytes: 32 * 1024,
  shardTargetBytes: 16 * 1024,
});

test("an empty project loads without creating a snapshot or runtime files", async (t) => {
  const { project, store } = fixture(t);
  assert.deepEqual(await store.load(), { file: null, state: { schemaVersion: 2 } });
  assert.deepEqual(fs.readdirSync(project), []);
  assert.equal(store.scope.active(), true);
});

test("root create-only and revision CAS preserve the winning bytes", async (t) => {
  const { project, store } = fixture(t);
  const initial = '{"schemaVersion":2,"extension":{"value":"原始"}}\n';
  const first = await store.write({ path: ROOT_FILE, content: initial, expectedRevision: null });
  assert.equal(first.revision, revision(initial));
  assert.equal(first.size, Buffer.byteLength(initial));
  assert.equal(store.read(ROOT_FILE).content, initial);
  await assert.rejects(store.write({ path: ROOT_FILE, content: "replacement", expectedRevision: null }), code("REVISION_CONFLICT"));

  const next = '{"schemaVersion":2,"extension":{"value":"winner"}}\n';
  const saved = await store.write({ path: ROOT_FILE, content: next, expectedRevision: first.revision, expectedModifiedAt: -1 });
  assert.equal(saved.revision, revision(next), "revision is authoritative over the legacy mtime");
  await assert.rejects(store.write({ path: ROOT_FILE, content: "stale", expectedRevision: first.revision }), code("REVISION_CONFLICT"));
  assert.equal(fs.readFileSync(join(project, ROOT_FILE), "utf8"), next);
  assert.equal(fs.existsSync(sharedLock(project)), false, "completed and failed commits release their shared lock");
  assert.equal(fs.existsSync(join(project, "career-data/panel-runtime")), false, "the compatibility writer creates no separate locking protocol");
  assert.equal(fs.readdirSync(project).some((name) => name.endsWith(".tmp")), false);
});

test("writes require valid CAS preconditions and immutable files remain create-only", async (t) => {
  const { store } = fixture(t);
  for (const extra of [{}, { expectedRevision: "sha256:bad" }, { expectedRevision: 1 }]) {
    await assert.rejects(store.write({ path: ROOT_FILE, content: "{}", ...extra }), code("INVALID_INPUT"));
  }
  const path = "career-data/library-versions/career-version-one.json";
  const first = await store.write({ path, content: "original", expectedRevision: null });
  assert.equal(store.read(path).revision, first.revision);
  await assert.rejects(store.write({ path, content: "changed", expectedModifiedAt: null }), code("REVISION_CONFLICT"));
  assert.equal(store.read(path).content, "original");
});

test("legacy mtime CAS tolerates Host sub-millisecond rounding but rejects real changes", async (t) => {
  const { store } = fixture(t);
  const first = await store.write({ path: ROOT_FILE, content: "first", expectedModifiedAt: null });
  const nearby = first.modifiedAt + 0.0005;
  assert.ok(Math.abs(nearby - first.modifiedAt) < 0.001);
  await store.write({ path: ROOT_FILE, content: "rounded", expectedModifiedAt: nearby });
  const current = store.read(ROOT_FILE);
  await assert.rejects(store.write({ path: ROOT_FILE, content: "stale", expectedModifiedAt: current.modifiedAt + 0.002 }), code("REVISION_CONFLICT"));
  await assert.rejects(store.write({ path: ROOT_FILE, content: "create again", expectedModifiedAt: null }), code("REVISION_CONFLICT"));
  assert.equal(store.read(ROOT_FILE).content, "rounded");
  await assert.rejects(store.write({ path: "career-data/missing.json", content: "{}", expectedModifiedAt: 1 }), code("REVISION_CONFLICT"));
});

test("write ceilings count UTF-8 bytes and leave previous content intact", async (t) => {
  const { store } = fixture(t);
  const path = "career-data/materials/unicode.txt";
  const content = "汉".repeat(WRITE_LIMIT / 3);
  const first = await store.write({ path, content, expectedRevision: null });
  assert.equal(first.size, WRITE_LIMIT);
  assert.equal(store.read(path).content, content);
  await assert.rejects(store.write({ path, content: `${content}汉`, expectedRevision: first.revision }), code("FILE_TOO_LARGE"));
  assert.equal(store.read(path).revision, first.revision);
});

test("reads accept the exact byte ceiling and reject oversized or invalid UTF-8 files", (t) => {
  const { project, store } = fixture(t);
  const path = "career-data/materials/read-limit.txt";
  put(project, path, "汉".repeat(READ_LIMIT / 3));
  assert.equal(store.read(path).size, READ_LIMIT);
  fs.appendFileSync(join(project, path), "a");
  assert.throws(() => store.read(path), code("FILE_TOO_LARGE"));
  put(project, "career-data/materials/invalid.txt", Buffer.from([0xc3, 0x28]));
  assert.throws(() => store.read("career-data/materials/invalid.txt"), /encoded data|UTF-8|utf-8/i);
});

test("invalid root documents fail without resetting or replacing the user's bytes", async (t) => {
  const { project, store } = fixture(t);
  for (const content of ["{broken json", "[]", "null", '{"schemaVersion":3}', '{"schemaVersion":"2"}']) {
    put(project, ROOT_FILE, content);
    await assert.rejects(store.load());
    assert.equal(fs.readFileSync(join(project, ROOT_FILE), "utf8"), content);
  }
});

test("unsharded legacy and current roots preserve unknown extension fields", async (t) => {
  const { project, store } = fixture(t);
  for (const schemaVersion of [1, 2]) {
    const state = { schemaVersion, extension: { nested: ["原话", { raw: true }] }, profile: { name: "Synthetic" } };
    const content = `${JSON.stringify(state)}\n`;
    put(project, ROOT_FILE, content);
    const loaded = await store.load();
    assert.deepEqual(loaded.state, state);
    assert.equal(loaded.file.content, content);
  }
});

test("actual sharded persistence hydrates all collections and root extensions", async (t) => {
  const { store } = fixture(t);
  const prepared = prepare("initial");
  assert.ok(prepared.shards.length > 1);
  await writeProjectSnapshotDocuments(prepared, { scope: store.scope });
  const loaded = await store.load();
  assert.deepEqual(loaded.state, { ...snapshot("initial"), artifactStorage: prepared.root.artifactStorage });
  assert.equal(loaded.file.revision, revision(prepared.rootContent));
  for (const shard of prepared.shards) assert.equal(store.read(shard.path).content, shard.content);
});

test("two stores sharing a project cannot replace a winning root or its immutable shards", async (t) => {
  const { project, store } = fixture(t);
  const initial = prepare("initial");
  await writeProjectSnapshotDocuments(initial, { scope: store.scope });
  const previousSnapshot = store.read(ROOT_FILE);
  const other = createNodeProjectStore(project);
  const winner = prepare("winning");
  const loser = prepare("losing");
  await writeProjectSnapshotDocuments(winner, { scope: store.scope, previousSnapshot });
  await assert.rejects(writeProjectSnapshotDocuments(loser, { scope: other.scope, previousSnapshot }), code("REVISION_CONFLICT"));
  assert.deepEqual((await other.load()).state, { ...snapshot("winning"), artifactStorage: winner.root.artifactStorage });
  for (const shard of winner.shards) assert.equal(store.read(shard.path).content, shard.content);
  const oldDocuments = new Map(initial.shards.map((shard) => [shard.path, JSON.parse(store.read(shard.path).content)]));
  assert.deepEqual(hydrateProjectSnapshotDocuments(initial.root, oldDocuments), { ...snapshot("initial"), artifactStorage: initial.root.artifactStorage });
});

test("compatibility and canonical writers share the same per-file lock and CAS", async (t) => {
  const { project, store } = fixture(t);
  const canonical = await createNodeWorkspaceScope(project);
  const original = await store.write({ path: ROOT_FILE, content: "original", expectedRevision: null });
  const lock = sharedLock(project);
  fs.mkdirSync(lock);
  let settled = false;
  const waiting = store.write({ path: ROOT_FILE, content: "stale compatibility write", expectedRevision: original.revision })
    .finally(() => { settled = true; });
  const rejected = assert.rejects(waiting, code("REVISION_CONFLICT"));
  // Represent a Host writer already holding the canonical file lock. The
  // compatibility writer must wait, then compare again after this publication.
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(settled, false);
  put(project, ROOT_FILE, "Host winner");
  fs.rmdirSync(lock);
  await rejected;
  assert.equal(store.read(ROOT_FILE).content, "Host winner");
  assert.equal(fs.existsSync(lock), false);
  const current = await canonical.call("workspace.readText", { path: ROOT_FILE });
  const next = await store.write({ path: ROOT_FILE, content: "compatible successor", expectedRevision: `sha256:${current.revision}` });
  assert.equal((await canonical.call("workspace.readText", { path: ROOT_FILE })).revision, next.revision.slice("sha256:".length));
});

test("compatibility writes honor the canonical lock for case aliases", async (t) => {
  const { project, store } = fixture(t);
  const path = "career-data/materials/Upper.json";
  put(project, path, "original");
  const lock = sharedLock(project, "career-data/materials/upper.json");
  fs.mkdirSync(lock);
  let settled = false;
  const waiting = store.write({ path, content: "changed", expectedRevision: store.read(path).revision })
    .finally(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(settled, false);
  assert.equal(store.read(path).content, "original");
  fs.rmdirSync(lock);
  await waiting;
  assert.equal(store.read(path).content, "changed");
});

for (const generation of ["a", "b"]) {
  test(`legacy ${generation} shards remain readable and intact after a current-format save`, async (t) => {
    const { project, store } = fixture(t);
    const legacy = prepare("legacy", generation);
    putPrepared(project, legacy);
    const previousSnapshot = store.read(ROOT_FILE);
    assert.deepEqual((await store.load()).state, { ...snapshot("legacy"), artifactStorage: legacy.root.artifactStorage });
    const next = prepare("current");
    await writeProjectSnapshotDocuments(next, { scope: store.scope, previousSnapshot });
    assert.deepEqual((await store.load()).state, { ...snapshot("current"), artifactStorage: next.root.artifactStorage });
    assert.equal(store.read(`career-data/panel-shards/${next.generation}/previous-root.json`).content, legacy.rootContent);
    for (const shard of legacy.shards) assert.equal(store.read(shard.path).content, shard.content);
  });
}

test("missing and mismatched shards fail closed instead of returning partial state", async (t) => {
  const { project, store } = fixture(t);
  const prepared = prepare("sharded");
  putPrepared(project, prepared);
  const missing = prepared.shards[0];
  fs.unlinkSync(join(project, missing.path));
  await assert.rejects(store.load(), code("ENOENT"));
  put(project, missing.path, JSON.stringify({ ...missing.payload, generation: "g-" + "0".repeat(32) }));
  await assert.rejects(store.load(), /无效或缺失/);
  assert.equal(store.read(ROOT_FILE).content, prepared.rootContent);
});

test("unsafe paths cannot read or write outside the store's allowlist", async (t) => {
  const { home, store } = fixture(t);
  const outside = join(home, "outside.json");
  fs.writeFileSync(outside, "untouched");
  for (const path of [
    "../outside.json", outside, "other.json", "career-data/../outside.json", "career-data//a.json",
    "career-data/.hidden.json", "career-data/node_modules/a.json", "career-data/a./b.json",
    "career-data/a.exe", "career-data\\outside.json", `career-data/${"a".repeat(510)}.json`,
  ]) {
    assert.throws(() => store.read(path), code("INVALID_PATH"), path);
    await assert.rejects(store.write({ path, content: "changed", expectedRevision: null }), code("INVALID_PATH"), path);
  }
  assert.equal(fs.readFileSync(outside, "utf8"), "untouched");
});

test("project roots and ancestor aliases cannot be opened through symlinks", (t) => {
  const { home, project } = fixture(t);
  const alias = join(home, "alias");
  fs.symlinkSync(project, alias, "dir");
  assert.throws(() => createNodeProjectStore(alias), code("INVALID_PROJECT"));
  const ancestorAlias = join(home, "home-alias");
  fs.symlinkSync(home, ancestorAlias, "dir");
  assert.throws(() => createNodeProjectStore(join(ancestorAlias, "project")), code("INVALID_PROJECT"));
});

test("symlinked directories, leaf files and nonregular leaves are rejected", async (t) => {
  const { home, project, store } = fixture(t);
  const outside = join(home, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(join(outside, "material.json"), "untouched");
  fs.symlinkSync(outside, join(project, "career-data"), "dir");
  assert.throws(() => store.read("career-data/material.json"), code("INVALID_PATH"));
  await assert.rejects(store.write({ path: "career-data/material.json", content: "changed", expectedRevision: null }), code("INVALID_PATH"));
  fs.unlinkSync(join(project, "career-data"));
  fs.mkdirSync(join(project, "career-data"));
  fs.symlinkSync(join(outside, "material.json"), join(project, "career-data/leaf.json"));
  fs.mkdirSync(join(project, "career-data/directory.json"));
  for (const path of ["career-data/leaf.json", "career-data/directory.json"]) {
    assert.throws(() => store.read(path), code("INVALID_PATH"));
    await assert.rejects(store.write({ path, content: "changed", expectedRevision: null }), code("INVALID_PATH"));
  }
  assert.equal(fs.readFileSync(join(outside, "material.json"), "utf8"), "untouched");
});

test("replacing the project directory invalidates previously captured scopes", async (t) => {
  const { home, project, store } = fixture(t);
  fs.renameSync(project, join(home, "previous-project"));
  fs.mkdirSync(project);
  assert.equal(store.scope.active(), false);
  assert.throws(() => store.scope.check(), code("PROJECT_CHANGED"));
  await assert.rejects(store.scope.call("workspace.writeText", { path: ROOT_FILE, content: "{}", expectedRevision: null }), code("PROJECT_CHANGED"));
  assert.deepEqual(fs.readdirSync(project), []);
});

test("replacing a parent before delegated publication preserves both directories", async (t) => {
  const { project, store } = fixture(t);
  const path = "career-data/materials/record.json";
  put(project, path, "original");
  const pending = store.write({ path, content: "changed", expectedRevision: store.read(path).revision });
  const parent = join(project, "career-data/materials");
  const previousParent = join(project, "career-data/previous-materials");
  fs.renameSync(parent, previousParent);
  fs.mkdirSync(parent);
  put(project, path, "replacement directory");
  await assert.rejects(pending, code("PROJECT_CHANGED"));
  assert.equal(fs.readFileSync(join(previousParent, "record.json"), "utf8"), "original");
  assert.equal(store.read(path).content, "replacement directory");
});

for (const aggregate of [false, true]) {
  test(`a real CLI ${aggregate ? "aggregate cleanup" : "lock-release"} failure can follow publication and is never an input-rejection receipt`, (t) => {
    const { home, project, store } = fixture(t);
    put(project, ROOT_FILE, JSON.stringify({ schemaVersion: 2, profile: { name: "before" } }));
    const expectedRevision = store.read(ROOT_FILE).revision;
    const content = JSON.stringify({ schemaVersion: 2, profile: { name: "published" } });
    const path = `career-data/panel-commits/g-${"d".repeat(32)}.json`;
    put(project, path, content);
    const preload = join(home, "fail-cleanup.mjs");
    // Isolate builtin fault injection in the owned child. The real canonical
    // writer still acquires its lock and publishes through rename before this
    // synthetic filesystem failure prevents the normal cleanup receipt.
    fs.writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const rmdir = fs.rmdirSync, unlink = fs.unlinkSync;
const failed = () => Object.assign(new Error("synthetic cleanup failure"), { code: "EACCES" });
fs.rmdirSync = (path, ...args) => {
  if (String(path).includes(".codeshell-workspace-write-")) throw failed();
  return rmdir(path, ...args);
};
${aggregate ? `fs.unlinkSync = (path, ...args) => {
  if (/\\.job-hunt-[^/]+\\.tmp$/.test(String(path))) throw failed();
  return unlink(path, ...args);
};` : ""}
syncBuiltinESMExports();
`);
    const entry = fileURLToPath(new URL("../../../apps/job-hunt-hq/app/tools/job-hunt-cli.mjs", import.meta.url));
    const child = spawnSync(process.execPath, ["--import", preload, entry], {
      cwd: project, encoding: "utf8", timeout: 10_000,
      env: { PATH: dirname(process.execPath), HOME: project, TMPDIR: project, LANG: "C.UTF-8" },
      input: JSON.stringify({ operation: "snapshot.commit", input: { path, expectedRevision } }),
    });
    assert.equal(child.error, undefined); assert.equal(child.status, 1); assert.equal(child.signal, null);
    assert.equal(child.stderr, "");
    const response = JSON.parse(child.stdout);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, aggregate ? "OPERATION_FAILED" : "EACCES");
    assert.equal(store.read(ROOT_FILE).content, content);
    assert.ok(fs.lstatSync(sharedLock(project)).isDirectory(), "the failed cleanup never silently removes a lock");
  });
}

for (const owner of [null, "{partially-written", JSON.stringify({ pid: 2147483647, nonce: "another-owner", createdAt: "1970-01-01T00:00:00.000Z" })]) {
  test(`an abandoned-looking ${owner === null ? "empty" : owner.startsWith("{partially") ? "partial" : "old"} shared lock is never automatically broken`, async (t) => {
    const { project, store } = fixture(t);
    put(project, ROOT_FILE, "original");
    const lock = sharedLock(project);
    fs.mkdirSync(lock, { recursive: true });
    if (owner !== null) fs.writeFileSync(join(lock, "owner.json"), owner);
    const original = store.read(ROOT_FILE);
    await assert.rejects(store.write({ path: ROOT_FILE, content: "replacement", expectedRevision: original.revision }), code("REVISION_CONFLICT"));
    assert.equal(store.read(ROOT_FILE).content, "original");
    assert.ok(fs.statSync(lock).isDirectory());
    assert.deepEqual(fs.readdirSync(lock), owner === null ? [] : ["owner.json"]);
    if (owner !== null) assert.equal(fs.readFileSync(join(lock, "owner.json"), "utf8"), owner);
  });
}

test("scope exposes only explicit workspace text operations", async (t) => {
  const { store } = fixture(t);
  await assert.rejects(store.scope.call("workspace.deleteFile", { path: ROOT_FILE }), code("UNSUPPORTED"));
  const written = await store.scope.call("workspace.writeText", { path: "career-data/test.md", content: "# 合成资料", expectedRevision: null });
  const read = await store.scope.call("workspace.readText", { path: "career-data/test.md" });
  assert.equal(read.revision, written.revision);
  assert.equal(read.content, "# 合成资料");
});
