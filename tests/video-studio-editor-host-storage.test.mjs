import assert from "node:assert/strict";
import test, { before, after, beforeEach, afterEach } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

let browser,
  context,
  page,
  server,
  origin,
  bundle,
  temporary,
  hostStore,
  hostScope,
  hostSource,
  count = 0;
let legacyValues, calls, failure;
class MemoryHostStore {
  values = new Map();
  async get(_scope, key, revision) {
    const versions = this.values.get(key) ?? [];
    const value =
      revision === undefined ? versions[0] : versions.find((value) => value.revision === revision);
    if (!value) {
      if (revision !== undefined) throw new Error("Media document version not found");
      return { revision: 0, data: null };
    }
    return structuredClone({
      revision: value.revision,
      updatedAt: value.updatedAt,
      data: value.data,
    });
  }
  async set(_scope, key, input) {
    assert.match(key, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/);
    assert.ok(Buffer.byteLength(JSON.stringify(input.data)) <= 2 * 1024 * 1024);
    const previous = this.values.get(key) ?? [];
    if ((previous[0]?.revision ?? 0) !== input.baseRevision)
      throw new Error("Media document changed in another window. Reload before writing.");
    const value = {
      revision: input.baseRevision + 1,
      updatedAt: Date.now(),
      label: input.label,
      data: structuredClone(input.data),
    };
    this.values.set(key, [value, ...previous].slice(0, 20));
    return { revision: value.revision, updatedAt: value.updatedAt, label: value.label };
  }
  async versions(_scope, key) {
    return (this.values.get(key) ?? []).map(({ data, ...value }) => value);
  }
}
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "video-studio-editor-storage-"));
  const repository = fileURLToPath(new URL("../", import.meta.url));
  const output = await build({
    stdin: {
      contents: `export * from './apps/video-studio/src/editor/host-storage';export {migrateLegacyProject} from './apps/video-studio/src/editor/migration';`,
      resolveDir: repository,
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "api",
    platform: "browser",
    target: "chrome120",
  });
  bundle = output.outputFiles[0].text;
  const root =
    process.env.VIDEO_STUDIO_REAL_HOST_SOURCE ?? "/private/tmp/codeshell-plugin-runtime-20260913";
  try {
    await access(join(root, "packages/desktop/src/main/media/media-documents.ts"));
    hostSource = root;
  } catch {}
  if (hostSource) {
    const target = join(temporary, "actual-host-store.mjs");
    await build({
      entryPoints: [join(root, "packages/desktop/src/main/media/media-documents.ts")],
      outfile: target,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      alias: {
        "@cjhyy/code-shell-server/panels": join(
          root,
          "packages/server/src/panels/resources/storage.ts",
        ),
      },
    });
    globalThis.ActualHostStore = (await import(pathToFileURL(target).href)).MediaDocumentStore;
  }
  server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end("<!doctype html><html><body>Storage test</body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
  await rm(temporary, { recursive: true, force: true });
});
beforeEach(async () => {
  hostScope = { appId: "video-studio", projectPath: join(temporary, `project-${++count}`) };
  hostStore = globalThis.ActualHostStore
    ? new globalThis.ActualHostStore(join(temporary, `host-${count}`))
    : new MemoryHostStore();
  legacyValues = new Map();
  calls = [];
  failure = null;
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(() => localStorage.clear());
  await page.exposeFunction("hostCall", async (method, params) => {
    calls.push({ method, params: structuredClone(params) });
    const fail =
      failure && failure.method === method && (!failure.key || failure.key === params.key)
        ? failure
        : null;
    if (fail?.once) failure = null;
    if (fail && fail.mode !== "after")
      throw new Error(fail.message ?? "injected host storage failure");
    let result;
    if (method === "storage.get") result = legacyValues.get(params.key) ?? null;
    else if (method === "media.document.get")
      result = await hostStore.get(hostScope, params.key, params.revision);
    else if (method === "media.document.set")
      result = await hostStore.set(hostScope, params.key, params);
    else if (method === "media.document.versions")
      result = await hostStore.versions(hostScope, params.key);
    else throw new Error(`Unexpected bridge method: ${method}`);
    if (fail && fail.mode === "after") throw new Error(fail.message ?? "lost host success reply");
    return result;
  });
  await page.addScriptTag({ content: bundle });
  await page.addScriptTag({
    content: `
    globalThis.old={schemaVersion:1,id:'project',name:'旧工程',revision:3,width:1920,height:1080,fps:30,assets:[{id:'video',kind:'video',name:'原片',durationFrames:90}],clips:[{id:'clip',assetId:'video',inFrame:0,outFrame:90,volume:1}],captions:[],script:'完整旧稿'};
    globalThis.doc=api.migrateLegacyProject(old);
    globalThis.host=()=>api.createEditorHostStorage({call:hostCall},{persistent:true});
    globalThis.local=()=>api.createEditorHostStorage(undefined,{persistent:false,scopeKey:'test-${count}'});
  `,
  });
});
afterEach(async () => {
  await context?.close();
});

async function current() {
  return hostStore.get(hostScope, "video-studio-current");
}

test("actual Host MediaDocumentStore is exercised when the configured source checkout exists", () => {
  if (hostSource) assert.ok(globalThis.ActualHostStore);
  else assert.ok(new MemoryHostStore());
});

test("legacy fallback is read only after a successful empty current read and exact backup precedes v2 publication", async () => {
  const raw = await page.evaluate(() => old);
  legacyValues.set("video-studio-project-v1", raw);
  const result = await page.evaluate(async () => {
    const storage = host(),
      read = await storage.read();
    const written = await storage.write(doc, read.revision, "升级工程");
    return { read, written, restored: await host().read() };
  });
  assert.deepEqual(result.read, { revision: 0, data: raw });
  assert.equal(result.written.revision, 1);
  assert.equal(result.restored.data.schemaVersion, 2);
  const backup = calls.find(
    (call) =>
      call.method === "media.document.set" && call.params.key.startsWith("video-studio-legacy-"),
  );
  assert.ok(backup);
  assert.deepEqual(backup.params.data.data, raw);
  assert.equal(Object.hasOwn(backup.params.data.data, "audioClips"), false);
  assert.equal(backup.params.baseRevision, 0);
  const publication = calls.findIndex(
    (call) => call.method === "media.document.set" && call.params.key === "video-studio-current",
  );
  assert.ok(calls.indexOf(backup) < publication);
  assert.deepEqual(legacyValues.get("video-studio-project-v1"), raw);
});

test("a failed initial read never falls back or permits writes, even after the bridge recovers", async () => {
  legacyValues.set("video-studio-project-v1", await page.evaluate(() => old));
  failure = {
    method: "media.document.get",
    key: "video-studio-current",
    once: true,
    message: "disk read failed",
  };
  const result = await page.evaluate(async () => {
    const storage = host();
    let readError, writeError;
    try {
      await storage.read();
    } catch (error) {
      readError = error.message;
    }
    try {
      await storage.write(doc, 0, "不能覆盖");
    } catch (error) {
      writeError = error.message;
    }
    return { readError, writeError };
  });
  assert.match(result.readError, /disk read failed/);
  assert.match(result.writeError, /disk read failed/);
  assert.equal(
    calls.some((call) => call.method === "storage.get"),
    false,
  );
  assert.equal(
    calls.some((call) => call.method === "media.document.set"),
    false,
  );
});

test("large Unicode projects stream through bounded immutable chunks and reconstruct historical versions exactly", async () => {
  const result = await page.evaluate(async () => {
    const storage = host();
    doc.production.big = "中文💠".repeat(350000);
    const text = doc.production.big;
    await storage.read();
    await storage.write(doc, 0, "大工程");
    doc.production.big = "新版本";
    doc.revision++;
    await storage.write(doc, 1, "新版本");
    return {
      historical: await storage.readVersion(1),
      latest: await storage.read(),
      versions: await storage.versions(),
      expectedLength: text.length,
    };
  });
  assert.equal(result.historical.production.big.length, result.expectedLength);
  assert.equal(result.historical.production.big, "中文💠".repeat(350000));
  assert.equal(result.latest.data.production.big, "新版本");
  assert.deepEqual(
    result.versions.map((value) => value.revision),
    [2, 1],
  );
  const chunks = calls.filter(
    (call) =>
      call.method === "media.document.set" && call.params.key.startsWith("video-studio-chunk-"),
  );
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.equal(chunk.params.baseRevision, 0);
    assert.ok(Buffer.byteLength(JSON.stringify(chunk.params)) < 1024 * 1024);
  }
  const first = calls.find(
    (call) => call.method === "media.document.set" && call.params.key === "video-studio-current",
  );
  assert.ok(first.params.data.chunks.length > 1);
  assert.equal(Object.hasOwn(first.params.data, "data"), false);
});

test("missing or corrupted chunks fail closed and do not fall back to a tempting old project", async () => {
  await page.evaluate(async () => {
    doc.production.big = "海".repeat(400000);
    const storage = host();
    await storage.read();
    await storage.write(doc, 0, "分块工程");
  });
  const manifest = (await current()).data,
    reference = manifest.chunks[0],
    chunk = await hostStore.get(hostScope, reference.key);
  await hostStore.set(hostScope, reference.key, {
    baseRevision: chunk.revision,
    data: { ...chunk.data, data: "AAAA" },
    label: "损坏测试",
  });
  legacyValues.set("video-studio-project-v1", await page.evaluate(() => old));
  calls = [];
  const result = await page.evaluate(async () => {
    const storage = host();
    let readError, writeError;
    try {
      await storage.read();
    } catch (error) {
      readError = error.message;
    }
    try {
      await storage.write(doc, 1, "不应覆盖");
    } catch (error) {
      writeError = error.message;
    }
    return { readError, writeError };
  });
  assert.match(result.readError, /分块校验失败/);
  assert.match(result.writeError, /分块校验失败/);
  assert.equal((await current()).revision, 1);
  assert.equal(
    calls.some((call) => call.method === "storage.get"),
    false,
  );
  assert.equal(
    calls.some((call) => call.method === "media.document.set"),
    false,
  );
});

test("chunk creation failure leaves the previous current document and storage revision intact", async () => {
  await page.evaluate(async () => {
    const storage = host();
    await storage.read();
    await storage.write(doc, 0, "小工程");
  });
  failure = { method: "media.document.set", message: "quota reached" };
  const error = await page.evaluate(async () => {
    const storage = host();
    await storage.read();
    doc.production.big = "文".repeat(500000);
    try {
      await storage.write(doc, 1, "大工程");
      return null;
    } catch (error) {
      return error.message;
    }
  });
  assert.match(error, /quota reached/);
  assert.equal((await current()).revision, 1);
  assert.equal((await current()).data.data.production.big, undefined);
});

test("two Host writers cannot replace each other through CAS and a lost current-write reply is not retried blindly", async () => {
  const result = await page.evaluate(async () => {
    const a = host(),
      b = host();
    await Promise.all([a.read(), b.read()]);
    const second = structuredClone(doc);
    second.name = "另一窗口";
    const values = await Promise.allSettled([
      a.write(doc, 0, "窗口 A"),
      b.write(second, 0, "窗口 B"),
    ]);
    return values.map((value) =>
      value.status === "fulfilled"
        ? { status: value.status, revision: value.value.revision }
        : { status: value.status, name: value.reason.name, code: value.reason.code },
    );
  });
  assert.equal(result.filter((value) => value.status === "fulfilled").length, 1);
  assert.equal(result.find((value) => value.status === "rejected").code, "STORAGE_CONFLICT");
  assert.equal((await current()).revision, 1);
  failure = {
    method: "media.document.set",
    key: "video-studio-current",
    mode: "after",
    once: true,
  };
  const lost = await page.evaluate(async () => {
    const storage = host();
    await storage.read();
    let first, second;
    try {
      await storage.write(doc, 1, "失去回执");
    } catch (error) {
      first = error.message;
    }
    try {
      await storage.write(doc, 1, "重试旧版本");
    } catch (error) {
      second = error.code;
    }
    return { first, second };
  });
  assert.match(lost.first, /lost host success reply/);
  assert.equal(lost.second, "STORAGE_CONFLICT");
  assert.equal((await current()).revision, 2);
});

test("archives use immutable full snapshots and a CAS index independent of current autosaves", async () => {
  const result = await page.evaluate(async () => {
    const storage = host();
    await storage.read();
    await storage.write(doc, 0, "当前工程");
    const archived = structuredClone(doc);
    archived.id = "archived";
    archived.name = "完整归档";
    archived.production.big = "归档💠".repeat(220000);
    await storage.archive(archived);
    for (let index = 1; index <= 22; index++) {
      doc.name = "当前 " + index;
      await storage.write(doc, index, "自动保存");
    }
    return {
      archived: await host().listArchived(),
      versions: await storage.versions(),
      current: await storage.read(),
    };
  });
  assert.equal(result.archived.length, 1);
  assert.equal(result.archived[0].name, "完整归档");
  assert.equal(result.archived[0].production.big, "归档💠".repeat(220000));
  assert.equal(result.versions.length, 20);
  assert.equal(result.current.revision, 23);
  const index = (await hostStore.get(hostScope, "video-studio-recent-v2")).data;
  assert.equal(index.entries[0].documentId, "archived");
  assert.ok(index.entries[0].snapshotKey.startsWith("video-studio-snapshot-"));
  assert.equal(Object.hasOwn(index.entries[0], "document"), false);
});

test("legacy archives are backed up exactly before migration and retained when a new project is archived", async () => {
  const raw = await page.evaluate(() => ({ ...old, id: "old-archive", name: "旧归档" }));
  legacyValues.set("video-studio-recent-v1", [raw]);
  const result = await page.evaluate(async () => {
    const storage = host();
    await storage.read();
    const first = await storage.listArchived();
    await storage.archive(doc);
    return { first, second: await storage.listArchived() };
  });
  assert.equal(result.first[0].schemaVersion, 2);
  assert.equal(result.first[0].id, "old-archive");
  assert.deepEqual(
    result.second.map((value) => value.id),
    ["project", "old-archive"],
  );
  assert.deepEqual(legacyValues.get("video-studio-recent-v1"), [raw]);
  const backup = calls.find(
    (call) =>
      call.method === "media.document.set" && call.params.key.startsWith("video-studio-legacy-"),
  );
  assert.deepEqual(backup.params.data.data, raw);
});

test("invalid recent indexes cannot be erased by archive", async () => {
  await hostStore.set(hostScope, "video-studio-recent-v2", {
    baseRevision: 0,
    data: { bad: true },
    label: "损坏索引",
  });
  const error = await page.evaluate(async () => {
    const storage = host();
    await storage.read();
    try {
      await storage.archive(doc);
      return null;
    } catch (error) {
      return error.message;
    }
  });
  assert.match(error, /索引损坏/);
  assert.equal((await hostStore.get(hostScope, "video-studio-recent-v2")).revision, 1);
});

test("duplicate legacy archive IDs fail before writing backups or replacing the recent index", async () => {
  const raw = await page.evaluate(() => old);
  legacyValues.set("video-studio-recent-v1", [raw, { ...raw, name: "重复身份" }]);
  const error = await page.evaluate(async () => {
    const storage = host();
    await storage.read();
    try {
      await storage.listArchived();
      return null;
    } catch (error) {
      return error.message;
    }
  });
  assert.match(error, /重复 ID/);
  assert.equal(
    calls.some((call) => call.method === "media.document.set"),
    false,
  );
  assert.deepEqual(legacyValues.get("video-studio-recent-v1"), [raw, { ...raw, name: "重复身份" }]);
});

test("a snapshot stored under the wrong content address cannot be restored even when its project identity matches", async () => {
  await page.evaluate(async () => {
    const storage = host();
    await storage.read();
    await storage.archive(doc);
    doc.production.script = "修改后的内容";
    await storage.archive(doc);
  });
  const snapshots = calls.filter(
    (call) =>
      call.method === "media.document.set" && call.params.key.startsWith("video-studio-snapshot-"),
  );
  assert.equal(snapshots.length, 2);
  const latest = snapshots[1].params.key;
  await hostStore.set(hostScope, latest, {
    baseRevision: 1,
    data: snapshots[0].params.data,
    label: "错误内容地址",
  });
  const error = await page.evaluate(async () => {
    try {
      await host().listArchived();
      return null;
    } catch (error) {
      return error.message;
    }
  });
  assert.match(error, /内容地址不一致/);
});

test("legacy documents with unlabeled Host versions remain readable and are backed up before upgrade", async () => {
  const raw = await page.evaluate(() => old);
  await hostStore.set(hostScope, "video-studio-current", { baseRevision: 0, data: raw, label: "" });
  const result = await page.evaluate(async () => {
    const storage = host(),
      read = await storage.read();
    const versions = await storage.versions();
    await storage.write(doc, read.revision, "升级");
    return { read, versions, oldVersion: await storage.readVersion(1) };
  });
  assert.deepEqual(result.read.data, raw);
  assert.equal(result.versions[0].label, "");
  assert.deepEqual(result.oldVersion, raw);
  assert.equal((await current()).revision, 2);
  assert.ok(
    calls.some(
      (call) =>
        call.method === "media.document.set" && call.params.key.startsWith("video-studio-legacy-"),
    ),
  );
});

test("real IndexedDB transactions provide concurrent CAS, legacy fallback, immutable archives and scope isolation", async () => {
  const raw = await page.evaluate(() => old);
  await page.evaluate(
    (raw) => localStorage.setItem("video-studio-project-v1", JSON.stringify(raw)),
    raw,
  );
  const result = await page.evaluate(async () => {
    const a = local(),
      b = local();
    const reads = await Promise.all([a.read(), b.read()]);
    const second = structuredClone(doc);
    second.name = "并发窗口";
    const races = await Promise.allSettled([
      a.write(doc, 0, "本地 A"),
      b.write(second, 0, "本地 B"),
    ]);
    await a.archive(doc);
    const restored = await local().read(),
      archived = await local().listArchived();
    return {
      reads,
      races: races.map((value) =>
        value.status === "fulfilled" ? value.status : value.reason.code,
      ),
      restored,
      archived,
    };
  });
  assert.deepEqual(result.reads[0].data, raw);
  assert.deepEqual(result.races.sort(), ["STORAGE_CONFLICT", "fulfilled"]);
  assert.equal(result.restored.revision, 1);
  assert.equal(result.archived[0].id, "project");
  const other = await page.evaluate(async () => {
    localStorage.removeItem("video-studio-project-v1");
    return api
      .createEditorHostStorage(undefined, { persistent: false, scopeKey: "other-scope" })
      .read();
  });
  assert.deepEqual(other, { revision: 0, data: null });
});

test("separate browser windows share one atomic IndexedDB CAS boundary", async () => {
  const other = await page.context().newPage();
  try {
    await other.goto(origin);
    await other.addScriptTag({ content: bundle });
    const document = await page.evaluate(() => doc),
      scopeKey = `windows-${count}`;
    for (const window of [page, other])
      await window.evaluate(
        async ({ document, scopeKey }) => {
          globalThis.windowDocument = document;
          globalThis.windowStorage = api.createEditorHostStorage(undefined, {
            persistent: false,
            scopeKey,
          });
          await windowStorage.read();
        },
        { document, scopeKey },
      );
    const results = await Promise.all(
      [page, other].map((window, index) =>
        window.evaluate(async (index) => {
          windowDocument.name = `窗口 ${index}`;
          try {
            return {
              revision: (await windowStorage.write(windowDocument, 0, "独立窗口保存")).revision,
            };
          } catch (error) {
            return { code: error.code };
          }
        }, index),
      ),
    );
    assert.equal(results.filter((value) => value.revision === 1).length, 1);
    assert.equal(results.filter((value) => value.code === "STORAGE_CONFLICT").length, 1);
    const reads = await Promise.all(
      [page, other].map((window) => window.evaluate(() => windowStorage.read())),
    );
    assert.deepEqual(reads[0], reads[1]);
    assert.equal(reads[0].revision, 1);
  } finally {
    await other.close();
  }
});

test("an aborted IndexedDB transaction never acknowledges a put and leaves the previous revision readable", async () => {
  const result = await page.evaluate(async () => {
    const storage = local();
    await storage.read();
    await storage.write(doc, 0, "已保存");
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = original.apply(this, args);
      this.transaction.abort();
      return request;
    };
    let error;
    try {
      doc.name = "事务未提交";
      await storage.write(doc, 1, "不应成功");
    } catch (value) {
      error = value.message;
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    return { error, read: await local().read() };
  });
  assert.ok(result.error);
  assert.equal(result.read.revision, 1);
  assert.equal(result.read.data.name, "旧工程");
});

test("oversized JSON and accessor-backed legacy objects are rejected before any document writes", async () => {
  const result = await page.evaluate(async () => {
    const storage = host();
    await storage.read();
    let large,
      accessor,
      invoked = false;
    doc.production.big = "文".repeat(12 * 1024 * 1024);
    try {
      await storage.write(doc, 0, "过大");
    } catch (error) {
      large = error.message;
    }
    const raw = { ...old };
    Object.defineProperty(raw, "script", {
      enumerable: true,
      get() {
        invoked = true;
        return "不能读取";
      },
    });
    try {
      await storage.backupLegacy(raw);
    } catch (error) {
      accessor = error.message;
    }
    return { large, accessor, invoked };
  });
  assert.match(result.large, /32 MiB/);
  assert.match(result.accessor, /访问器/);
  assert.equal(result.invoked, false);
  assert.equal(
    calls.some((call) => call.method === "media.document.set"),
    false,
  );
});

const installedFixture = () =>
  readFile(new URL("./fixtures/video-studio/project-0.5.16.json", import.meta.url), "utf8").then(
    JSON.parse,
  );

test("0.5.16 current and archived documents remain exact through Host read, backup, save and version restore", async () => {
  const raw = await installedFixture();
  await hostStore.set(hostScope, "video-studio-current", {
    baseRevision: 0,
    data: raw,
    label: "0.5.16",
  });
  legacyValues.set("video-studio-recent-v1", [raw]);
  const result = await page.evaluate(async () => {
    const storage = host(),
      read = await storage.read();
    const upgraded = api.migrateLegacyProject(read.data);
    await storage.write(upgraded, read.revision, "升级多轨工程");
    return {
      read,
      restored: await host().read(),
      version: await storage.readVersion(1),
      archived: await storage.listArchived(),
    };
  });
  assert.deepEqual(result.read.data, raw);
  assert.deepEqual(result.version, raw);
  assert.equal(result.restored.data.sequences[0].magneticTrackId, "video-main");
  assert.deepEqual(result.archived[0].sequences, result.restored.data.sequences);
  const backups = calls.filter(
    (call) =>
      call.method === "media.document.set" && call.params.key.startsWith("video-studio-legacy-"),
  );
  assert.equal(backups.length, 1, "archive and current reuse the same immutable exact backup");
  assert.deepEqual(backups[0].params.data.data, raw);
  assert.ok(
    calls.indexOf(backups[0]) <
      calls.findIndex(
        (call) =>
          call.method === "media.document.set" && call.params.key === "video-studio-current",
      ),
  );
});

test("0.5.16 legacy fallback survives IndexedDB publication and preserves its untouched localStorage source", async () => {
  const raw = await installedFixture();
  const result = await page.evaluate(async (raw) => {
    localStorage.setItem("video-studio-project-v1", JSON.stringify(raw));
    const storage = local(),
      read = await storage.read();
    const doc = api.migrateLegacyProject(read.data);
    await storage.backupLegacy(read.data);
    await storage.write(doc, read.revision, "升级多轨工程");
    return {
      read,
      restored: await local().read(),
      original: JSON.parse(localStorage.getItem("video-studio-project-v1")),
    };
  }, raw);
  assert.deepEqual(result.read.data, raw);
  assert.deepEqual(result.original, raw);
  assert.equal(result.restored.data.schemaVersion, 2);
  assert.equal(
    result.restored.data.sequences[0].clips.find((clip) => clip.id === "tail").start,
    880000,
  );
});

test("0.5.16 strict validation rejects unknown fields before Host backup or fallback writes", async () => {
  const raw = await installedFixture();
  raw.clips[1].transform.unreviewedEffect = true;
  await hostStore.set(hostScope, "video-studio-current", {
    baseRevision: 0,
    data: raw,
    label: "invalid",
  });
  legacyValues.set("video-studio-project-v1", await page.evaluate(() => old));
  const result = await page.evaluate(async (raw) => {
    const storage = host(),
      errors = [];
    for (const action of [() => storage.read(), () => storage.backupLegacy(raw)])
      try {
        await action();
      } catch (error) {
        errors.push(error.message);
      }
    return errors;
  }, raw);
  assert.equal(result.length, 2);
  assert.ok(result.every((message) => /未知字段/.test(message)));
  assert.equal(calls.filter((call) => call.method === "media.document.set").length, 0);
  assert.equal(calls.filter((call) => call.method === "storage.get").length, 0);
  assert.deepEqual((await current()).data, raw);
});

test("upgrade backups survive more than twenty saves and read exact v1 after reopening", async () => {
  const raw = await installedFixture();
  legacyValues.set("video-studio-project-v1", raw);
  const result = await page.evaluate(async () => {
    const storage = host(),
      first = await storage.read();
    const document = api.migrateLegacyProject(first.data);
    for (let revision = 0; revision < 23; revision++) {
      document.name = `New edit ${revision}`;
      await storage.write(document, revision, "继续编辑");
    }
    const reopened = host(),
      backups = await reopened.upgradeBackups();
    return {
      backups,
      original: await reopened.readUpgradeBackup(backups[0].digest),
      current: await reopened.read(),
      versions: await reopened.versions(),
    };
  });
  assert.equal(result.backups.length, 1);
  assert.deepEqual(result.original, raw);
  assert.equal(result.current.data.name, "New edit 22");
  assert.equal(result.versions.length, 20);
  assert.ok(result.versions.every((version) => version.revision > 1));
});

test("a failed backup directory write prevents migration and lost acknowledgement is recovered", async () => {
  legacyValues.set("video-studio-project-v1", await page.evaluate(() => old));
  failure = { method: "media.document.set", key: "video-studio-upgrade-backups" };
  const error = await page.evaluate(async () => {
    try {
      await host().write(doc, 0, "升级");
    } catch (error) {
      return error.message;
    }
  });
  assert.match(error, /injected/);
  assert.equal((await current()).data, null);
  failure = {
    method: "media.document.set",
    key: "video-studio-upgrade-backups",
    mode: "after",
    once: true,
  };
  const result = await page.evaluate(async () => {
    await host().write(doc, 0, "重试升级");
    return host().upgradeBackups();
  });
  assert.equal(result.length, 1);
  assert.equal((await current()).revision, 1);
});

test("simultaneous old project imports retain both backup references without overwriting", async () => {
  const result = await page.evaluate(async () => {
    const another = { ...old, id: "other", name: "第二个工程" };
    await Promise.all([host().backupLegacy(old), host().backupLegacy(another)]);
    const reopened = host(),
      backups = await reopened.upgradeBackups();
    return {
      backups,
      documents: await Promise.all(
        backups.map((entry) => reopened.readUpgradeBackup(entry.digest)),
      ),
    };
  });
  assert.deepEqual(result.backups.map((entry) => entry.documentId).sort(), ["other", "project"]);
  assert.deepEqual(result.documents.map((entry) => entry.id).sort(), ["other", "project"]);
});

test("corrupt current data does not hide indexed backups, but corrupt backup bytes cannot be restored", async () => {
  const [entry] = await page.evaluate(async () => {
    await host().backupLegacy(old);
    return host().upgradeBackups();
  });
  await hostStore.set(hostScope, "video-studio-current", {
    baseRevision: 0,
    data: { bad: true },
    label: "损坏",
  });
  assert.deepEqual(await page.evaluate(() => host().upgradeBackups()), [entry]);
  const key = `video-studio-legacy-${entry.digest}`,
    packed = await hostStore.get(hostScope, key);
  packed.data.data.name = "changed outside";
  await hostStore.set(hostScope, key, {
    baseRevision: packed.revision,
    data: packed.data,
    label: "损坏",
  });
  const error = await page.evaluate(async (digest) => {
    try {
      await host().readUpgradeBackup(digest);
    } catch (error) {
      return error.message;
    }
  }, entry.digest);
  assert.match(error, /校验失败/);
  assert.deepEqual((await current()).data, { bad: true });
});

test("pre-directory v1 history is indexed without replacing current or discarding extension omissions", async () => {
  const raw = await installedFixture();
  await hostStore.set(hostScope, "video-studio-current", {
    baseRevision: 0,
    data: raw,
    label: "旧版",
  });
  await hostStore.set(hostScope, "video-studio-current", {
    baseRevision: 1,
    data: await page.evaluate(() => doc),
    label: "新版",
  });
  const result = await page.evaluate(async () => {
    const storage = host(),
      backups = await storage.upgradeBackups();
    return { backups, exact: await storage.readUpgradeBackup(backups[0].digest) };
  });
  assert.equal(result.backups.length, 1);
  assert.deepEqual(result.exact, raw);
  assert.equal((await current()).revision, 2);
});

test("browser upgrade backup index survives reopening, stays scoped and preserves chunked exact JSON", async () => {
  const result = await page.evaluate(async () => {
    const raw = {
      ...old,
      captions: Array.from({ length: 1500 }, (_, index) => ({
        id: `caption-${index}`,
        startFrame: 0,
        endFrame: 1,
        text: "字幕".repeat(100),
      })),
    };
    await local().backupLegacy(raw);
    const backups = await local().upgradeBackups();
    const restored = await local().readUpgradeBackup(backups[0].digest);
    const other = api.createEditorHostStorage(undefined, {
      persistent: false,
      scopeKey: "separate-backups",
    });
    return {
      equal: JSON.stringify(raw) === JSON.stringify(restored),
      backups,
      other: await other.upgradeBackups(),
    };
  });
  assert.equal(result.equal, true);
  assert.equal(result.backups.length, 1);
  assert.deepEqual(result.other, []);
});

test("invalid backup index is preserved and cannot be replaced by an upgrade", async () => {
  legacyValues.set("video-studio-project-v1", await page.evaluate(() => old));
  const broken = {
    format: "video-studio-upgrade-backups",
    version: 1,
    entries: [{ digest: "bad" }],
  };
  await hostStore.set(hostScope, "video-studio-upgrade-backups", {
    baseRevision: 0,
    data: broken,
    label: "损坏目录",
  });
  const error = await page.evaluate(async () => {
    try {
      await host().write(doc, 0, "升级");
    } catch (error) {
      return error.message;
    }
  });
  assert.match(error, /备份记录损坏/);
  assert.deepEqual((await hostStore.get(hostScope, "video-studio-upgrade-backups")).data, broken);
  assert.equal((await current()).data, null);
});
