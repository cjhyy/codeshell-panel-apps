import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const sha = value => createHash("sha256").update(value).digest("hex");
const methods = ["storage.get", "storage.set", "storage.getSnapshot", "storage.compareAndSet"];
const writeNew = (ctx, path, content) => ctx.call("workspace.writeText", { path, content, expectedModifiedAt: null });
const read = (ctx, path) => ctx.call("workspace.readText", { path });
async function replace(ctx, path, content) {
  const previous = await read(ctx, path);
  return ctx.call("workspace.writeText", { path, content, expectedRevision: previous.revision });
}
async function cas(ctx, key, value) {
  const previous = await ctx.call("storage.getSnapshot", { key });
  const result = await ctx.call("storage.compareAndSet", { key, value, expectedRevision: previous.revision });
  assert.equal(result.updated, true);
}
async function bundle(source, directory, name) {
  const outfile = join(directory, `${name}.mjs`);
  await build({ entryPoints: [source], outfile, bundle: true, platform: "node", format: "esm", target: "node20", logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
}

async function design(old, root) {
  const model = await old.module("app/document.mjs");
  const resources = await old.module("app/resource-store.mjs");
  const image = await resources.createDesignResourcePersistencePlan({ id: "migration-pixel", kind: "image", mime: "image/png",
    base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", sha256Bytes: async value => sha(value) });
  for (const part of image.parts) await writeNew(old, part.path, part.content);
  const state = model.normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "Upgrade fixture",
    canvas: { width: 800, height: 600, background: "#ffffff" }, tokens: { colors: [] }, resources: [image.descriptor],
    activePageId: "page-1", pages: [{ id: "page-1", name: "One", children: [{
      id: "rectangle-1", type: "rectangle", name: "Original rectangle", x: 10, y: 20, width: 100, height: 80,
      fill: "#112233", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false,
    }] }, { id: "page-2", name: "Two", children: [] }] });
  const original = model.serializeDesignDocument(state), path = "designs/upgrade.codesign.json";
  await writeNew(old, path, original);
  let upgraded;
  const validateParts = async ctx => {
    for (const part of image.parts) assert.equal((await read(ctx, part.path)).content, part.content);
  };
  return {
    checks: ["v3 pages/nodes/resource parts", "conditional edit", "upgraded design archive", "old-parser rollback", "resource bytes unchanged"],
    async verifyEmpty(ctx) { assert.deepEqual((await ctx.call("workspace.list", { path: "designs" })).entries, []); },
    async verifyOld(ctx) {
      const text = (await read(ctx, path)).content;
      assert.equal(text, original);
      assert.equal((await ctx.module("app/document.mjs")).normalizeDesignDocument(JSON.parse(text)).pages.length, 2);
      await validateParts(ctx);
    },
    async upgrade(ctx) {
      const current = await ctx.module("app/document.mjs");
      const document = current.normalizeDesignDocument(JSON.parse((await read(ctx, path)).content));
      document.name = "Edited after upgrade";
      document.nodes[0].fill = "#445566";
      upgraded = current.serializeDesignDocument(document);
      assert.equal(model.normalizeDesignDocument(JSON.parse(upgraded)).name, "Edited after upgrade");
      const previous = await read(ctx, path);
      await replace(ctx, path, upgraded);
      await assert.rejects(ctx.call("workspace.writeText", { path, content: original, expectedRevision: previous.revision }), /conflict|changed/i);
    },
    async verifyCurrent(ctx) { assert.equal((await read(ctx, path)).content, upgraded); await validateParts(ctx); },
    async prepareRollback(ctx) {
      await writeNew(ctx, "upgrade-backups/design-upgraded.json", upgraded);
      await replace(ctx, path, original);
    },
    async verifyReupgrade(ctx) {
      assert.equal((await read(ctx, "upgrade-backups/design-upgraded.json")).content, upgraded);
      const current = await ctx.module("app/document.mjs");
      assert.equal(current.normalizeDesignDocument(JSON.parse(upgraded)).name, "Edited after upgrade");
      await validateParts(ctx);
    },
  };
}

async function job(old) {
  const originalModel = await old.module("app/snapshot-sharding-model.mjs");
  const payload = { schemaVersion: 2, savedAt: "2026-10-10T00:00:00.000Z", jobs: [{ id: "job-upgrade", title: "Synthetic job" }],
    resume: { headline: "Synthetic resume" }, versions: [{ id: "resume-v1", text: "A retained version" }],
    questionBank: Array.from({ length: 80 }, (_, i) => ({ id: `question-${i}`, notes: "旧面试素材".repeat(1500) })),
    futureField: { keep: "unknown legacy extension" } };
  const original = originalModel.prepareProjectSnapshotDocuments(payload, {},
    old.selected.version === "4.1.0" ? { generation: "a" } : {});
  assert.ok(original.shards.length > 1);
  for (const shard of original.shards) await writeNew(old, shard.path, shard.content);
  await writeNew(old, "job-hunt-panel.json", original.rootContent);
  const hydrate = async (ctx, model, root) => {
    const docs = new Map();
    for (const part of model.projectSnapshotShardDescriptors(root)) docs.set(part.path, JSON.parse((await read(ctx, part.path)).content));
    const hydrated = model.hydrateProjectSnapshotDocuments(root, docs);
    delete hydrated.artifactStorage;
    return hydrated;
  };
  let upgraded, archivePath;
  return {
    checks: [original.root.artifactStorage.schemaVersion === 1 ? `actual ${old.selected.version} A/B writer` : `actual ${old.selected.version} snapshot writer`,
      "root/shard migration", "interrupted migration preserves root", "exact raw backup", "old-shard rollback", "upgraded bundle archive"],
    async verifyEmpty(ctx) {
      assert.equal((await ctx.call("workspace.list", { path: "." })).entries.some(item => item.path === "job-hunt-panel.json"), false);
      assert.deepEqual((await ctx.call("workspace.list", { path: "career-data" })).entries, []);
    },
    async verifyOld(ctx) {
      const source = await read(ctx, "job-hunt-panel.json");
      assert.equal(source.content, original.rootContent);
      const model = await ctx.module("app/snapshot-sharding-model.mjs");
      assert.deepEqual(await hydrate(ctx, model, JSON.parse(source.content)), payload);
      for (const shard of original.shards) assert.equal((await read(ctx, shard.path)).content, shard.content);
    },
    async upgrade(ctx) {
      const model = await ctx.module("app/snapshot-sharding-model.mjs");
      const storage = await ctx.module("app/snapshot-storage.mjs");
      const previousSnapshot = await read(ctx, "job-hunt-panel.json");
      const previous = await hydrate(ctx, model, JSON.parse(previousSnapshot.content));
      assert.deepEqual(previous, payload);
      const draft = { ...previous, jobs: [...previous.jobs, { id: "job-new", title: "Edited after upgrade" }] };
      const failed = model.prepareProjectSnapshotDocuments(draft);
      assert.ok(failed.shards.length > 1);
      const interrupted = { check: ctx.scope.check, call(method, params) {
        if (method === "workspace.writeText" && params.path === failed.shards[1].path)
          throw Error("simulated interruption before second new shard");
        return ctx.call(method, params);
      } };
      await assert.rejects(storage.writeProjectSnapshotDocuments(failed, { scope: interrupted, previousSnapshot,
        backupRequired: true }), /simulated interruption/);
      assert.equal((await read(ctx, failed.shards[0].path)).content, failed.shards[0].content,
        "first new shard really reached Host disk before the injected failure");
      assert.equal((await read(ctx, "job-hunt-panel.json")).content, previousSnapshot.content);
      assert.deepEqual(await hydrate(ctx, model, JSON.parse(previousSnapshot.content)), payload);
      upgraded = model.prepareProjectSnapshotDocuments(draft);
      await storage.writeProjectSnapshotDocuments(upgraded, { scope: ctx.scope, previousSnapshot, backupRequired: true });
      assert.equal(upgraded.root.artifactStorage.schemaVersion, 2);
      await assert.rejects(hydrate(ctx, originalModel, upgraded.root), /分片/);
      // Find an actual complete backup and decode it through the package's backup reader.
      const listing = await ctx.call("workspace.list", { path: "career-data/panel-backups" });
      assert.equal(listing.truncated, false);
      const backup = await ctx.module("app/snapshot-backup.mjs");
      let verified = false;
      for (const entry of listing.entries.filter(item => item.kind === "directory")) {
        const result = await backup.readSnapshotBackup(`${entry.path}/manifest.json`, { scope: ctx.scope });
        assert.equal(result.bundle.root, original.rootContent);
        assert.deepEqual(result.bundle.shards, original.shards.map(({ path, content }) => ({ path, content })));
        verified = true;
      }
      assert.equal(verified, true, "migration must publish a discoverable complete backup");
    },
    async verifyCurrent(ctx) {
      const model = await ctx.module("app/snapshot-sharding-model.mjs");
      const current = await read(ctx, "job-hunt-panel.json");
      assert.equal(current.content, upgraded.rootContent);
      assert.equal((await hydrate(ctx, model, JSON.parse(current.content))).jobs.at(-1).id, "job-new");
    },
    async prepareRollback(ctx) {
      const backup = await ctx.module("app/snapshot-backup.mjs");
      const current = await read(ctx, "job-hunt-panel.json");
      const bundle = await backup.captureSnapshotBundle(current, { scope: ctx.scope });
      archivePath = (await backup.persistSnapshotBundle(bundle, { scope: ctx.scope, reason: "rollback" })).path;
      await replace(ctx, "job-hunt-panel.json", original.rootContent);
    },
    async verifyReupgrade(ctx) {
      const backup = await ctx.module("app/snapshot-backup.mjs");
      const preserved = await backup.readSnapshotBackup(archivePath, { scope: ctx.scope });
      assert.equal(preserved.bundle.root, upgraded.rootContent);
      assert.equal(preserved.hydrated.jobs.at(-1).id, "job-new");
    },
  };
}

async function quant(old) {
  // Use the real package's scope-key function, avoiding a parallel test key convention.
  const app = await readFile(join(old.selected.installPath, "app/app.js"), "utf8");
  const start = app.indexOf("function scopedStorageKey("), end = app.indexOf("\nfunction activeModuleStorageKey(", start);
  assert.ok(start > 0 && end > start);
  const { scopedStorageKey } = await import(`data:text/javascript,${encodeURIComponent(`export ${app.slice(start, end)}`)}`);
  const key = base => scopedStorageKey(base, old.project);
  const originalConfig = { strategy: { type: "sma-cross", fast: 20, slow: 50 }, initialCapital: 100000, feeBps: 5, slippageBps: 2, stopLossPct: 8 };
  const oldEngine = await old.module("app/engine.mjs");
  const bars = oldEngine.generateDemoBars(260);
  const oldRun = oldEngine.runBacktest(bars, originalConfig);
  const watchUI = await old.module("app/modules/a-share-selection-ui.mjs");
  const originalWatch = { ...watchUI.parseSelectionWatchStorage({ version: 1, stocks: [{ symbol: "600519", name: "Synthetic stock" }], sectors: [] }),
    futureMetadata: { preserved: true } };
  await old.call("storage.set", { key: key("configuration"), value: originalConfig });
  await old.call("storage.set", { key: key("aShareSelectionWatch"), value: originalWatch });
  const store = await old.module("app/portfolio-store.mjs");
  const initialLedger = { format: "codeshell.portfolio-transactions", version: 1, baseCurrency: "CNY",
    accounts: [{ id: "account-1", name: "Synthetic account", broker: "Fixture", currencies: ["CNY"] }], instruments: [], transactions: [] };
  await store.appendTransaction(old.call, { initialLedger, transaction: { id: "deposit-1", type: "cash-in", createdAt: "2026-10-10T00:00:00.000Z",
    accountId: "account-1", currency: "CNY", amount: "1000.00", valuationDate: "2026-10-10", timing: "begin" } }, { derivedAt: "2026-10-10T00:00:00.000Z" });
  const originalLedger = (await read(old, "portfolio/transactions.json")).content;
  const originalHoldings = (await read(old, "portfolio/holdings.json")).content;
  let nextConfig, nextWatch, nextLedger;
  return {
    checks: ["old backtest result reproducible", "real scoped configuration/watch keys", "watch extension retained", "cash ledger append/CAS", "ledger archive and old-parser restore"],
    async verifyEmpty(ctx) {
      assert.equal(await ctx.call("storage.get", { key: key("configuration") }), null);
      assert.equal(await ctx.call("storage.get", { key: key("aShareSelectionWatch") }), null);
      assert.deepEqual((await ctx.call("workspace.list", { path: "portfolio" })).entries, []);
    },
    async verifyOld(ctx) {
      assert.deepEqual(await ctx.call("storage.get", { key: key("configuration") }), originalConfig);
      assert.deepEqual(await ctx.call("storage.get", { key: key("aShareSelectionWatch") }), originalWatch);
      assert.equal((await read(ctx, "portfolio/transactions.json")).content, originalLedger);
      const parser = await ctx.module("app/portfolio.mjs");
      assert.equal(parser.parseTransactions(originalLedger).ledger.transactions.length, 1);
    },
    async upgrade(ctx) {
      const engine = await ctx.module("app/engine.mjs");
      assert.deepEqual(engine.runBacktest(bars, originalConfig).metrics, oldRun.metrics);
      const setting = await ctx.module("app/modules/project-setting.mjs");
      const create = name => setting.createProjectSetting({ hostCall: ctx.call, key: key(name), currentEpoch: () => 0,
        getContext: () => ({ availableMethods: methods }) });
      const config = create("configuration"), competing = create("configuration");
      await config.load(); await competing.load();
      nextConfig = { ...originalConfig, initialCapital: 120000 };
      await config.save(nextConfig);
      await assert.rejects(competing.save(originalConfig), { code: "STORAGE_CONFLICT" });
      const watch = create("aShareSelectionWatch");
      const raw = await watch.load();
      const ui = await ctx.module("app/modules/a-share-selection-ui.mjs");
      const doc = await ctx.module("app/modules/selection-watch-document.mjs");
      const normalized = doc.readSelectionWatchDocument(raw, ui.parseSelectionWatchStorage);
      nextWatch = doc.selectionWatchDocument(raw, { ...normalized, stocks: normalized.stocks.map(item => ({ ...item, priority: "focus" })) }, ui.parseSelectionWatchStorage);
      assert.deepEqual(nextWatch.futureMetadata, originalWatch.futureMetadata);
      await watch.save(nextWatch);
      const ledger = await ctx.module("app/portfolio-store.mjs");
      await ledger.appendTransaction(ctx.call, { transaction: { id: "deposit-2", type: "cash-in", createdAt: "2026-10-11T00:00:00.000Z",
        accountId: "account-1", currency: "CNY", amount: "50.00", valuationDate: "2026-10-11", timing: "end" } }, { derivedAt: "2026-10-11T00:00:00.000Z" });
      nextLedger = (await read(ctx, "portfolio/transactions.json")).content;
      assert.equal((await old.module("app/portfolio.mjs")).parseTransactions(nextLedger).ledger.transactions.length, 2);
    },
    async verifyCurrent(ctx) {
      assert.deepEqual(await ctx.call("storage.get", { key: key("configuration") }), nextConfig);
      assert.deepEqual(await ctx.call("storage.get", { key: key("aShareSelectionWatch") }), nextWatch);
      assert.equal((await read(ctx, "portfolio/transactions.json")).content, nextLedger);
    },
    async prepareRollback(ctx) {
      await writeNew(ctx, "upgrade-backups/quant-ledger.json", nextLedger);
      await writeNew(ctx, "upgrade-backups/quant-settings.json", JSON.stringify({ configuration: nextConfig, watch: nextWatch }));
      await cas(ctx, key("configuration"), originalConfig); await cas(ctx, key("aShareSelectionWatch"), originalWatch);
      await replace(ctx, "portfolio/transactions.json", originalLedger);
      await replace(ctx, "portfolio/holdings.json", originalHoldings);
    },
    async verifyReupgrade(ctx) {
      const parser = await ctx.module("app/portfolio.mjs");
      assert.equal(parser.parseTransactions((await read(ctx, "upgrade-backups/quant-ledger.json")).content).ledger.transactions.length, 2);
      const settings = JSON.parse((await read(ctx, "upgrade-backups/quant-settings.json")).content);
      assert.deepEqual(settings, { configuration: nextConfig, watch: nextWatch });
    },
  };
}

async function download(old, root) {
  const model = await old.module("app/download-library.js");
  const libraryKey = "video-download.library.v2";
  const create = (ctx, module) => module.createProjectStorage({ panel: { call: ctx.call }, key: libraryKey,
    ready: Promise.resolve(), getContext: () => ({ cwd: ctx.project, apiVersion: 14, availableMethods: methods }),
    getScope: () => ctx.project, envelope: false });
  const file = join(root, "project-A/downloads/fixture.bin");
  await mkdir(join(root, "project-A/downloads"), { recursive: true });
  await writeFile(file, "Synthetic completed download bytes; no online download was performed.");
  const fileBytes = await readFile(file), fileHash = sha(fileBytes);
  const item = status => ({ queueId: `item-${status}`, url: "https://www.youtube.com/watch?v=synthetic12", title: `Synthetic ${status}`,
    configuration: { format: "720" }, directory: { path: join(old.project, "downloads"), kind: "project", handle: "stale-directory-handle" }, status,
    filesComplete: status === "completed", files: status === "completed" ? [{ path: file, bytes: fileBytes.length, status: "present" }] : [] });
  const original = model.serializeLibrary({ queue: [item("running"), item("pending")], history: [item("completed")], queuePaused: false, maxConcurrent: 2 }, old.project);
  // 0.22.3 uses the inline storage.set path; project-storage.js was added later.
  await old.call("storage.set", { key: libraryKey, value: original });
  let upgraded;
  return {
    checks: ["tagged v2 queue/library", "legacy set to current CAS", "running tasks become interrupted", "no stale directory handles", "file references retained", "library archive and rollback", "existing file bytes unchanged"],
    async verifyEmpty(ctx) { assert.equal(await ctx.call("storage.get", { key: libraryKey }), null); },
    async verifyOld(ctx) {
      const library = await ctx.module("app/download-library.js");
      const raw = await ctx.call("storage.get", { key: libraryKey });
      assert.deepEqual(raw, original);
      const restored = library.restoreLibrary(raw, ctx.project);
      assert.equal(restored.queue[0].status, "interrupted"); assert.equal(restored.queuePaused, true);
      assert.equal(restored.history[0].files[0].path, file);
      assert.equal(restored.queue[0].directory.handle, undefined);
      assert.equal(sha(await readFile(file)), fileHash);
    },
    async upgrade(ctx) {
      const library = await ctx.module("app/download-library.js"), module = await ctx.module("app/project-storage.js");
      const store = create(ctx, module), competing = create(ctx, module);
      const raw = await store.load(); await competing.load();
      const restored = library.restoreLibrary(raw, ctx.project);
      assert.equal(restored.queue[0].nativePackage, undefined, "legacy records cannot invent durable native task authority");
      restored.queue[1].title = "Edited after upgrade";
      upgraded = library.serializeLibrary(restored, ctx.project);
      await store.save(upgraded);
      await assert.rejects(competing.save(raw), { code: "STORAGE_CONFLICT" });
    },
    async verifyCurrent(ctx) { assert.deepEqual(await ctx.call("storage.get", { key: libraryKey }), upgraded); assert.equal(sha(await readFile(file)), fileHash); },
    async prepareRollback(ctx) { await cas(ctx, "video-download.upgrade-backup", upgraded); await cas(ctx, libraryKey, original); },
    async verifyReupgrade(ctx) {
      const raw = await ctx.call("storage.get", { key: "video-download.upgrade-backup" });
      assert.deepEqual(raw, upgraded);
      assert.equal((await ctx.module("app/download-library.js")).restoreLibrary(raw, ctx.project).queue[1].title, "Edited after upgrade");
      assert.equal(sha(await readFile(file)), fileHash);
    },
  };
}

async function video(old, root) {
  // Verify the exercised old domain source is exactly the source embedded in
  // the actual installed browser bundle, rather than trusting a possibly stale build.
  const installedMain = await readFile(join(old.selected.installPath, "app/main.mjs"), "utf8");
  const sourceMap = installedMain.match(/sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/);
  assert.ok(sourceMap, "old installed package must carry its deterministic inline source map");
  const map = JSON.parse(Buffer.from(sourceMap[1], "base64").toString("utf8"));
  for (const name of ["model.ts", "host.ts"]) {
    const index = map.sources.findIndex(path => path.endsWith(`/src/${name}`));
    assert.ok(index >= 0);
    assert.equal(map.sourcesContent[index], await readFile(join(old.sourceRoot, "src", name), "utf8"));
  }
  const oldModel = await bundle(join(old.sourceRoot, "src/model.ts"), root, "old-video-model");
  const oldHost = await bundle(join(old.sourceRoot, "src/host.ts"), root, "old-video-host");
  oldHost.setPanelBridge({ call: old.call });
  const project = oldModel.createDemoProject();
  project.id = "project-upgrade-fixture"; project.name = "Synthetic old 0.5.12 project";
  await oldHost.loadProject(); await oldHost.saveProject(project, "Old package save");
  const original = await old.call("storage.get", { key: "video-studio-project-v1" });
  assert.deepEqual(original, project);
  let currentAPI, upgraded, backupDigest;
  const currentStorage = async ctx => {
    currentAPI ??= await bundle(join(ctx.sourceRoot, "../../apps/video-studio/src/editor/host-storage.ts"), root, "current-video-storage");
    return currentAPI.createEditorHostStorage({ call: ctx.call }, { persistent: false, workspace: true });
  };
  return {
    checks: ["old source matches installed bundle map", "actual old model/store save", "v1 to v2 workspace fallback", "immutable exact v1 backup", "v2 CAS/history", "v2 archive retained across rollback", "old store reopens original"],
    async verifyEmpty(ctx) { assert.equal(await ctx.call("storage.get", { key: "video-studio-project-v1" }), null); },
    async verifyOld(ctx) {
      const source = await ctx.call("storage.get", { key: "video-studio-project-v1" });
      assert.deepEqual(source, original);
      const store = oldHost.createProjectStore({ read: () => ctx.call("storage.get", { key: "video-studio-project-v1" }), write: value => ctx.call("storage.set", { key: "video-studio-project-v1", value }) });
      assert.deepEqual(await store.load(), original);
    },
    async upgrade(ctx) {
      const migration = await bundle(join(ctx.sourceRoot, "../../apps/video-studio/src/editor/migration.ts"), root, "current-video-migration");
      const storage = await currentStorage(ctx), source = await storage.read();
      assert.deepEqual(source.data, original);
      upgraded = migration.migrateLegacyProject(source.data);
      upgraded.name = "Edited v2 after upgrade";
      assert.throws(() => oldModel.validateProject(upgraded));
      let unsafeWrite = false;
      const incompatibleOldStore = oldHost.createProjectStore({ read: async () => upgraded, write: async () => { unsafeWrite = true; } });
      await assert.rejects(incompatibleOldStore.load());
      await assert.rejects(incompatibleOldStore.save(original), /恢复失败/);
      assert.equal(unsafeWrite, false);
      await storage.write(upgraded, source.revision, "Upgrade old project");
      const backups = await storage.upgradeBackups();
      assert.equal(backups.length, 1); backupDigest = backups[0].digest;
      assert.deepEqual(await storage.readUpgradeBackup(backupDigest), original);
      await assert.rejects(storage.write(upgraded, source.revision, "Stale edit"), /冲突|版本|其他/);
    },
    async verifyCurrent(ctx) {
      const storage = await currentStorage(ctx);
      assert.deepEqual((await storage.read()).data, upgraded);
      assert.deepEqual(await storage.readUpgradeBackup(backupDigest), original);
      assert.ok((await storage.versions()).length >= 1);
    },
    async prepareRollback(ctx) {
      const storage = await currentStorage(ctx);
      await storage.archive(upgraded);
      await writeNew(ctx, "upgrade-backups/video-v1-original.json", JSON.stringify(await storage.readUpgradeBackup(backupDigest)));
      // The old fallback key was never replaced; retain v2 indexes/parts and archive.
      assert.deepEqual(await ctx.call("storage.get", { key: "video-studio-project-v1" }), original);
    },
    async verifyReupgrade(ctx) {
      const storage = await currentStorage(ctx);
      assert.deepEqual((await storage.read()).data, upgraded);
      assert.deepEqual((await storage.listArchived())[0], upgraded);
      assert.deepEqual(await storage.readUpgradeBackup(backupDigest), original);
    },
  };
}

async function starter(old) {
  const verify = async ctx => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PANEL_TEST_CHROMIUM_EXECUTABLE,
      args: ["--disable-background-networking"] });
    try {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        const file = url.pathname.slice(1) || "index.html";
        if (url.origin !== "https://starter.test" || !["index.html", "style.css", "app.js"].includes(file)) return route.abort();
        await route.fulfill({ body: await readFile(join(ctx.selected.installPath, "app", file)),
          contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" });
      });
      const page = await context.newPage();
      await page.exposeFunction("__hostContext", async () => { await ctx.assertAuthorized(); return { cwd: ctx.project, trusted: true }; });
      await page.addInitScript(() => { window.codeshellPanel = { getContext: () => window.__hostContext(), on: () => () => {} }; });
      await page.goto("https://starter.test");
      await page.waitForFunction(project => document.querySelector("#workspace").textContent === project, ctx.project);
      await page.locator("#increment").click();
      assert.equal(await page.locator("#count").textContent(), "1 次点击");
    } finally { await browser.close(); }
  };
  await verify(old);
  return { checks: ["historical untagged template package", "installed old/current Chromium entry", "reviewed project context", "click interaction", "no persistent business data"],
    verifyEmpty: verify, verifyOld: verify, upgrade: verify, verifyCurrent: verify, prepareRollback: async () => {}, verifyReupgrade: verify };
}

export async function dataScenario(id, old, root) {
  const factories = { "design-studio": design, "job-hunt-hq": job, "quant-lab": quant,
    "video-download": download, "video-studio": video, "starter-panel": starter };
  return factories[id](old, root);
}
