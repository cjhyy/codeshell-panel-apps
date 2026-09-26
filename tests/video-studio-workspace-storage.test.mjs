import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
let directory, api;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "video-workspace-storage-"));
  const outfile = join(directory, "api.mjs");
  await build({
    stdin: {
      contents: `export {workspaceDocumentBackend} from './apps/video-studio/src/editor/workspace-storage'; export {createEditorHostStorage} from './apps/video-studio/src/editor/host-storage'; export {migrateLegacyProject} from './apps/video-studio/src/editor/migration';`,
      resolveDir: process.cwd(),
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
  });
  api = await import(pathToFileURL(outfile));
});
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
const revision = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
function host() {
  const files = new Map(),
    calls = [],
    legacy = new Map();
  let intercept;
  return {
    files,
    calls,
    legacy,
    intercept(fn) {
      intercept = fn;
    },
    bridge: {
      async call(method, p) {
        calls.push({ method, ...p });
        if (method === "storage.get") return structuredClone(legacy.get(p.key) ?? null);
        if (method === "workspace.list")
          return {
            path: p.path,
            truncated: false,
            entries: [...files.keys()]
              .filter(
                (path) =>
                  path.startsWith(p.path + "/") && !path.slice(p.path.length + 1).includes("/"),
              )
              .map((path) => ({ path, kind: "file" })),
          };
        if (method === "workspace.readText") {
          if (!files.has(p.path)) throw new Error("ENOENT");
          return {
            path: p.path,
            content: files.get(p.path),
            revision: revision(files.get(p.path)),
          };
        }
        assert.equal(method, "workspace.writeText");
        assert.ok(Buffer.byteLength(p.content) <= 384 * 1024, "Within actual Cloud write limit");
        const stage = intercept;
        await stage?.("before", p);
        if (
          p.expectedModifiedAt === null
            ? files.has(p.path)
            : revision(files.get(p.path) ?? "") !== p.expectedRevision
        )
          throw new Error("workspace file changed since it was opened");
        files.set(p.path, p.content);
        await stage?.("after", p);
        return { path: p.path, revision: revision(p.content) };
      },
    },
  };
}
const indexPath = (key) => `video-studio-data/documents/indexes/${key}/index.json`;
const seed = {
  schemaVersion: 1,
  id: "cloud-video",
  name: "原工程",
  revision: 7,
  width: 640,
  height: 360,
  fps: 30,
  timelineMode: "free",
  script: "原始文稿",
  assets: [],
  clips: [],
  captions: [],
};
test("cloud workspace documents persist large Unicode data across clients and isolate projects", async () => {
  const h = host(),
    a = api.workspaceDocumentBackend(h.bridge),
    b = api.workspaceDocumentBackend(h.bridge);
  const data = { unicode: "内容🙂".repeat(160000) };
  await a.set("video-studio-current", data, 0, "first");
  assert.deepEqual((await b.get("video-studio-current")).data, data);
  assert.ok(h.calls.filter((c) => c.method === "workspace.writeText").length > 2);
  assert.deepEqual(await api.workspaceDocumentBackend(host().bridge).get("video-studio-current"), {
    revision: 0,
    data: null,
  });
});
test("a competing write cannot replace another client, including a race after initial read", async () => {
  const h = host(),
    a = api.workspaceDocumentBackend(h.bridge),
    b = api.workspaceDocumentBackend(h.bridge);
  await a.set("current", { saved: 1 }, 0, "first");
  let raced = false;
  h.intercept(async (stage, p) => {
    if (!raced && stage === "before" && p.path === indexPath("current")) {
      raced = true;
      h.intercept(undefined);
      await b.set("current", { saved: 2 }, 1, "winner");
    }
  });
  await assert.rejects(a.set("current", { saved: 3 }, 1, "stale"), /another|冲突|changed/i);
  assert.deepEqual((await a.get("current")).data, { saved: 2 });
  await assert.rejects(a.set("current", { saved: 4 }, 1, "stale"), /another|冲突|changed/i);
});
test("lost index acknowledgement is read back without a duplicate revision; failed parts preserve current", async () => {
  const h = host(),
    a = api.workspaceDocumentBackend(h.bridge);
  h.intercept((stage, p) => {
    if (stage === "after" && p.path === indexPath("current")) throw new Error("lost reply");
  });
  assert.equal((await a.set("current", { saved: 1 }, 0, "first")).revision, 1);
  assert.equal((await a.versions("current")).length, 1);
  h.intercept((stage, p) => {
    if (stage === "before" && p.path.includes("/parts/")) throw new Error("disk full");
  });
  await assert.rejects(a.set("current", { saved: 2 }, 1, "second"), /disk full/);
  assert.deepEqual((await a.get("current")).data, { saved: 1 });
});
test("unknown indexes, missing parts, altered bytes and truncated listings fail closed", async () => {
  const h = host(),
    a = api.workspaceDocumentBackend(h.bridge);
  await a.set("current", { saved: 1 }, 0, "first");
  const source = h.files.get(indexPath("current"));
  h.files.set(indexPath("current"), source.replace('"version":1', '"version":2'));
  await assert.rejects(a.get("current"), /目录损坏/);
  await assert.rejects(a.set("current", { saved: 2 }, 1, "second"), /目录损坏/);
  h.files.set(indexPath("current"), source);
  const part = [...h.files.keys()].find((k) => k.includes("/parts/"));
  const bytes = h.files.get(part);
  h.files.set(part, btoa("changed"));
  await assert.rejects(a.get("current"), /分块校验失败/);
  h.files.delete(part);
  await assert.rejects(a.get("current"), /ENOENT/);
  h.files.set(part, bytes);
  const bad = api.workspaceDocumentBackend({
    async call(method, p) {
      if (method === "workspace.list") return { entries: [], truncated: true };
      return h.bridge.call(method, p);
    },
  });
  await assert.rejects(bad.set("current", {}, 0, "bad"), /不完整/);
  assert.equal(h.files.get(indexPath("current")), source);
});
test("full editor migration preserves exact legacy backup beyond 20 history revisions and supports archive restoration", async () => {
  const h = host();
  h.legacy.set("video-studio-project-v1", seed);
  let storage = api.createEditorHostStorage(h.bridge, { persistent: false, workspace: true });
  assert.deepEqual((await storage.read()).data, seed);
  await storage.backupLegacy(seed);
  const migrated = api.migrateLegacyProject(seed);
  for (let i = 0; i < 23; i++)
    await storage.write({ ...migrated, name: `修订${i}`, revision: i + 1 }, i, "change");
  storage = api.createEditorHostStorage(h.bridge, { persistent: false, workspace: true });
  const latest = await storage.read();
  assert.equal(latest.data.name, "修订22");
  assert.equal((await storage.versions()).length, 20);
  const backups = await storage.upgradeBackups();
  assert.equal(backups.length, 1);
  assert.deepEqual(await storage.readUpgradeBackup(backups[0].digest), seed);
  await storage.archive(latest.data);
  assert.deepEqual(await storage.listArchived(), [latest.data]);
  assert.equal((await storage.readVersion(4)).name, "修订3");
  await assert.rejects(storage.readVersion(1), /不存在/);
});
