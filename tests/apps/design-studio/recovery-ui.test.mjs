import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";
import { chromium } from "playwright";
import { createDesignIndexPersistencePlan } from "../../../apps/design-studio/app/document-index.mjs";
import { createDesignResourcePersistencePlan } from "../../../apps/design-studio/app/resource-store.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const hash = (value) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
async function fixture(t) {
  const files = new Map();
  const records = new Map(),
    calls = [],
    contexts = [];
  let failedRead = false, seededRecovery;
  const pauses = new Map();
  const deliver = async (scope, method, value) => {
    const key = `${scope}:${method}`, pause = pauses.get(key);
    if (pause) { pauses.delete(key); pause.enter(); await pause.gate; }
    return value;
  };
  const server = createServer(async (request, response) => {
    const path = resolve(root, `.${new URL(request.url, "http://test").pathname}`);
    if (!path.startsWith(root + sep) && path !== root) return response.writeHead(403).end();
    try {
      const contents = await readFile(
        path.endsWith(sep) || path === root ? resolve(root, "index.html") : path,
      );
      response
        .writeHead(200, {
          "content-type":
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".mjs": "text/javascript",
              ".css": "text/css",
            }[extname(path)] ?? "text/html",
        })
        .end(contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function page({ cwd = "/project/A", scope = cwd, sessionId = scope, deferContext = false, initialPath = null, sharedInitialPath = false } = {}) {
    const initialScope = scope;
    const context = await browser.newContext({ acceptDownloads: true });
    contexts.push(context);
    const page = await context.newPage();
    await page.exposeFunction("hostBridge", async (scope, method, params = {}) => {
      calls.push({ scope, method, ...structuredClone(params) });
      const key = `${scope}:${params.key}`;
      const snapshot = () =>
        records.has(key)
          ? {
              exists: true,
              value: structuredClone(records.get(key)),
              revision: hash(records.get(key)),
            }
          : { exists: false, value: null, revision: null };
      if (method === "storage.getSnapshot") {
        if (failedRead) throw Error("无法读取恢复记录");
        if (seededRecovery !== undefined && !records.has(key)) records.set(key, structuredClone(seededRecovery));
        return deliver(scope, method, snapshot());
      }
      if (method === "storage.compareAndSet") {
        if (params.expectedRevision !== snapshot().revision)
          return { updated: false, snapshot: snapshot() };
        if (params.remove) records.delete(key);
        else records.set(key, structuredClone(params.value));
        return deliver(scope, method, { updated: true, snapshot: snapshot() });
      }
      if (method === "storage.get") {
        if (initialPath && (sharedInitialPath || scope === initialScope) && params.key.startsWith("lastPath.")) return { workspaceRoot: cwd, path: initialPath };
        return records.get(key) ?? null;
      }
      if (method === "storage.set") {
        records.set(key, structuredClone(params.value));
        return null;
      }
      if (method === "workspace.info") return { name: scope.split("/").at(-1), cwd: scope };
      if (method === "workspace.list") return { entries: [], truncated: false };
      if (method === "workspace.readText") {
        const content = files.get(`${scope}:${params.path}`);
        if (content === undefined) throw Error("file missing");
        return { content, modifiedAt: 1, revision: hash(content) };
      }
      if (method === "workspace.writeText") {
        const path = `${scope}:${params.path}`;
        if (params.expectedModifiedAt === null && files.has(path)) throw Error("file exists");
        files.set(path, params.content);
        return deliver(scope, method, { modifiedAt: 1, revision: hash(params.content) });
      }
      throw Error(`Unsupported ${method}`);
    });
    await page.addInitScript(({ cwd, scope, sessionId, deferContext }) => {
      let hostScope = scope;
      const context = {
        cwd,
        sessionId,
        trusted: true,
        visible: true,
        busy: false,
        availableMethods: ["storage.getSnapshot", "storage.compareAndSet"],
      };
      let listener;
      window.tools = {};
      window.codeshellPanel = {
        getContext: async () => {
          const captured = { ...context };
          if (deferContext) await new Promise(resolve => { window.releaseInitialContext = resolve; });
          return captured;
        },
        call: (method, params) => window.hostBridge(hostScope, method, params),
        on: (name, callback) => {
          if (name === "context.changed") listener = callback;
        },
        registerTool: (name, callback) => {
          window.tools[name] = callback;
        },
      };
      window.switchProject = (cwd, scope = cwd, sessionId = scope) => {
        hostScope = scope;
        context.cwd = cwd;
        context.sessionId = sessionId;
        listener?.({ ...context });
      };
    }, { cwd, scope, sessionId, deferContext });
    await page.goto(`${origin}/index.html`);
    if (!deferContext) await page.waitForFunction(() =>
      /新设计|已打开|已恢复/.test(document.querySelector("#repo-link-state")?.textContent ?? ""),
    );
    return page;
  }
  return {
    page,
    records,
    files,
    calls,
    pauseResponse(scope, method) {
      let enter, release;
      const entered = new Promise(resolve => { enter = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      pauses.set(`${scope}:${method}`, { enter, gate });
      t.after(() => release());
      return { entered, release };
    },
    seedRecovery: value => { seededRecovery = value; },
    failRead: () => {
      failedRead = true;
    },
  };
}

test("actual design windows preserve conflicting drafts, download backups and explicitly reload the latest recovery", async (t) => {
  const f = await fixture(t),
    a = await f.page(),
    b = await f.page();
  await a.locator("#add-page").click();
  await a.locator("#add-page").click();
  await a.waitForFunction(() => document.querySelectorAll("#active-page option").length === 3);
  const deadline = Date.now() + 5000;
  while (![...f.records.keys()].some(k => k.includes("recovery"))) {
    assert.ok(Date.now() < deadline, "autosave did not reach Host storage");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const recoveryKey = [...f.records.keys()].find((k) => k.includes("recovery"));
  assert.ok(recoveryKey);
  const saved = structuredClone(f.records.get(recoveryKey));
  await b.locator("#add-page").click();
  await b.locator("#recovery-message").filter({ hasText: "其他窗口" }).waitFor();
  assert.deepEqual(f.records.get(recoveryKey), saved);
  const downloadPromise = b.waitForEvent("download");
  await b.locator("#recovery-backup").click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(backup.drafts[0].workspaceRoot, "/project/A");
  assert.ok(backup.drafts[0].record.operations.length > 0);
  b.once("dialog", (dialog) => dialog.accept());
  await b.locator("#recovery-reload").click();
  await b.waitForFunction(() => document.querySelectorAll("#active-page option").length === 3);
  assert.deepEqual(f.records.get(recoveryKey), saved);
});

test("switching project before autosave never submits the previous draft to the new Host scope", async (t) => {
  const f = await fixture(t),
    page = await f.page();
  await page.locator("#add-page").click();
  await page.evaluate(() => window.switchProject("/project/B"));
  await page.locator("#recovery-message").filter({ hasText: "切换前项目" }).waitFor();
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(
    f.calls.some((c) => c.scope === "/project/B" && c.value?.workspaceRoot === "/project/A"),
    false,
  );
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#recovery-backup").click();
  const backup = JSON.parse(await readFile(await (await downloadPromise).path(), "utf8"));
  assert.deepEqual(backup.drafts.map((d) => d.workspaceRoot).sort(), ["/project/A", "/project/B"]);
});

test("failed recovery reads remain visible and cannot be overwritten by subsequent editing", async (t) => {
  const f = await fixture(t);
  f.failRead();
  const page = await f.page();
  await page.locator("#recovery-message").filter({ hasText: "无法读取" }).waitFor();
  await page.locator("#add-page").click();
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(
    f.calls.some((c) => c.method === "storage.compareAndSet"),
    false,
  );
  await page.locator("#recovery-backup").waitFor();
});


test("malformed recovery remains stored and is included in an explicit backup", async t => {
  const f = await fixture(t);
  const damaged = { format: "invalid-recovery", retainedUserData: "keep" };
  f.seedRecovery(damaged);
  const page = await f.page();
  await page.locator("#recovery-message").filter({ hasText: "原记录已保留" }).waitFor();
  await page.locator("#add-page").click();
  const pending = page.waitForEvent("download");
  await page.locator("#recovery-backup").click();
  const backup = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  assert.deepEqual(backup.storedRecovery.value, damaged);
  assert.equal(f.calls.some(c => c.method === "storage.compareAndSet" || c.method === "storage.delete"), false);
  assert.deepEqual([...f.records.values()], [damaged]);
});


test("same-path cloud projects cancel pending drafts and retain both project backups", async t => {
  const f = await fixture(t);
  const page = await f.page({ cwd: "/workspace", scope: "cloud-A" });
  await page.locator("#add-page").click();
  await page.evaluate(() => window.switchProject("/workspace", "cloud-B"));
  await page.waitForFunction(() => document.querySelectorAll("#active-page option").length === 1);
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(f.calls.some(c => c.scope === "cloud-B" && c.method === "storage.compareAndSet"), false);
  await page.locator("#add-page").click();
  await page.evaluate(() => window.switchProject("/workspace", "cloud-C"));
  await page.waitForFunction(() => document.querySelectorAll("#active-page option").length === 1);
  const pending = page.waitForEvent("download");
  await page.locator("#recovery-backup").click();
  const backup = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  assert.equal(backup.drafts.length, 3, "same cwd must not collapse separate cloud drafts");
  assert.deepEqual(backup.drafts.map(d => d.sourceContext.sessionId).sort(), ["cloud-A", "cloud-B", "cloud-C"]);
});


test("a context event during initial read wins over the stale initial project", async t => {
  const f = await fixture(t);
  const page = await f.page({ cwd: "/workspace", scope: "cloud-A", deferContext: true });
  await page.waitForFunction(() => typeof window.releaseInitialContext === "function");
  await page.evaluate(() => {
    window.switchProject("/workspace", "cloud-B");
    window.releaseInitialContext();
  });
  await page.waitForFunction(() => document.querySelector("#repo-link-state")?.textContent.includes("新设计"));
  await page.locator("#add-page").click();
  await page.evaluate(() => window.switchProject("/workspace", "cloud-C"));
  await page.locator("#recovery-message").filter({ hasText: "切换前项目" }).waitFor();
  const pending = page.waitForEvent("download");
  await page.locator("#recovery-backup").click();
  const backup = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  assert.deepEqual(backup.drafts.map(d => d.sourceContext.sessionId).sort(), ["cloud-B", "cloud-C"]);
});

test("late recovery reads from a same-path old project cannot restore its canvas or request its baseline from the new project", async t => {
  const f = await fixture(t);
  f.seedRecovery({ format: "damaged" });
  const page = await f.page({ cwd: "/workspace", scope: "cloud-A" });
  await page.locator("#add-page").click();
  const pending = page.waitForEvent("download");
  await page.locator("#recovery-backup").click();
  const backup = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  const key = [...f.records.keys()].find(k => k.startsWith("cloud-A:"));
  f.records.set(key, backup.drafts[0]);
  f.seedRecovery(undefined);
  const hold = f.pauseResponse("cloud-A", "storage.getSnapshot");
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#recovery-reload").click();
  await hold.entered;
  await page.evaluate(() => window.switchProject("/workspace", "cloud-B"));
  await page.waitForFunction(() => document.querySelector("#repo-link-state")?.textContent.includes("新设计"));
  const count = f.calls.length;
  hold.release();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(f.calls.slice(count).some(c => c.method === "workspace.readText"), false);
  assert.equal(await page.locator("#active-page option").count(), 1);
});

test("a saved old-project response cannot clear or overwrite the same-path new project", async t => {
  const f = await fixture(t);
  const page = await f.page({ cwd: "/workspace", scope: "cloud-A" });
  const hold = f.pauseResponse("cloud-A", "storage.compareAndSet");
  await page.locator("#add-page").click();
  await hold.entered;
  await page.evaluate(() => window.switchProject("/workspace", "cloud-B"));
  await page.waitForFunction(() => document.querySelectorAll("#active-page option").length === 1);
  hold.release();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(f.calls.some(c => c.scope === "cloud-B" && ["storage.compareAndSet", "storage.delete"].includes(c.method)), false);
  await page.locator("#add-page").click();
  const deadline = Date.now() + 5000;
  while (![...f.records.keys()].some(k => k.startsWith("cloud-B:"))) {
    assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal([...f.records.keys()].filter(k => k.includes("recovery")).length, 2);
});


test("editing stays unavailable while the new same-path project is loading and backup never labels the old canvas as new", async t => {
  const f = await fixture(t);
  const page = await f.page({ cwd: "/workspace", scope: "cloud-A" });
  await page.locator("#add-page").click();
  const hold = f.pauseResponse("cloud-B", "storage.getSnapshot");
  await page.evaluate(() => window.switchProject("/workspace", "cloud-B"));
  await hold.entered;
  assert.equal(await page.locator(".topbar").evaluate(element => element.inert), true);
  assert.equal(await page.locator(".workspace").evaluate(element => element.inert), true);
  const pending = page.waitForEvent("download");
  await page.locator("#recovery-backup").click();
  const backup = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  assert.deepEqual(backup.drafts.map(d => d.sourceContext.sessionId), ["cloud-A"]);
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(f.calls.some(c => c.scope === "cloud-B" && c.method === "storage.compareAndSet"), false);
  hold.release();
  await page.waitForFunction(() => !document.querySelector(".topbar").inert);
  assert.equal(await page.locator("#active-page option").count(), 1);
});


async function downloadComplete(page) {
  await page.locator("#portable-backup-open").click();
  const pending = page.waitForEvent("download");
  await page.locator("#portable-backup-export").click();
  const result = await readFile(await (await pending).path());
  await page.locator("#portable-backup-close").click();
  return result;
}
async function selectComplete(page, buffer) {
  await page.locator("#portable-backup-open").click();
  await page.locator("#portable-backup-file").setInputFiles({ name: "complete.json", mimeType: "application/json", buffer });
  await page.waitForFunction(() => !document.querySelector("#portable-backup-restore").disabled);
}

test("complete backup moves all canvas pages to a new project file without replacing its current canvas", async t => {
  const f = await fixture(t), page = await f.page({ cwd: "/workspace", scope: "cloud-A" });
  await page.locator("#add-page").click();
  const buffer = await downloadComplete(page);
  assert.equal(JSON.parse(buffer).document.pages.length, 2);
  await page.evaluate(() => window.switchProject("/workspace", "cloud-B"));
  await page.waitForFunction(() => !document.querySelector(".topbar").inert);
  await selectComplete(page, buffer);
  assert.match(await page.locator("#portable-backup-preview").textContent(), /cloud-A[\s\S]*cloud-B/);
  await page.locator("#portable-backup-path").fill("designs/imported.codesign.json");
  await page.locator("#portable-backup-restore").click();
  await page.locator("#portable-backup-status").filter({ hasText: "已恢复到" }).waitFor();
  assert.equal(await page.locator("#active-page option").count(), 1);
  assert.equal(JSON.parse(f.files.get("cloud-B:designs/imported.codesign.json")).pages.length, 2);
  assert.equal(f.calls.some(c => c.scope === "cloud-B" && c.method === "storage.compareAndSet"), false);
});

test("complete backup preview is invalidated by project changes and cancel writes nothing", async t => {
  const f = await fixture(t), page = await f.page();
  const buffer = await downloadComplete(page);
  await selectComplete(page, buffer);
  await page.evaluate(() => window.switchProject("/project/B"));
  await page.locator("#portable-backup-status").filter({ hasText: "项目已切换" }).waitFor();
  assert.equal(await page.locator("#portable-backup-restore").isDisabled(), true);
  await page.locator("#portable-backup-close").click();
  assert.equal(f.calls.some(c => c.method === "workspace.writeText"), false);
});

test("complete backup restoration preserves an existing destination and permits retry to a new path", async t => {
  const f = await fixture(t), page = await f.page();
  const buffer = await downloadComplete(page);
  f.files.set("/project/A:designs/existing.codesign.json", "original bytes");
  await selectComplete(page, buffer);
  await page.locator("#portable-backup-path").fill("designs/existing.codesign.json");
  await page.locator("#portable-backup-restore").click();
  await page.locator("#portable-backup-status").filter({ hasText: "冲突" }).waitFor();
  assert.equal(f.files.get("/project/A:designs/existing.codesign.json"), "original bytes");
  await page.locator("#portable-backup-path").fill("designs/new.codesign.json");
  await page.locator("#portable-backup-restore").click();
  await page.locator("#portable-backup-status").filter({ hasText: "已恢复到" }).waitFor();
  assert.equal(f.files.has("/project/A:designs/new.codesign.json"), true);
});


test("complete backup materializes twelve indexed pages including pages not yet viewed", async t => {
  const f = await fixture(t);
  const document = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "Indexed fixture", canvas: { width: 800, height: 600, background: "#ffffff" }, tokens: { colors: [] }, resources: [], activePageId: "page-1", pages: Array.from({ length: 12 }, (_, i) => ({ id: `page-${i + 1}`, name: `Page ${i + 1}`, children: [] })) });
  const plan = await createDesignIndexPersistencePlan({ document, sha256: async value => createHash("sha256").update(value).digest("hex") });
  const initialPath = "designs/indexed.codesign.json";
  f.files.set(`/project/A:${initialPath}`, plan.primarySource);
  for (const part of plan.parts) f.files.set(`/project/A:${part.path}`, part.content);
  const page = await f.page({ initialPath });
  const initialReads = f.calls.filter(c => c.method === "workspace.readText").length;
  const buffer = await downloadComplete(page), backup = JSON.parse(buffer);
  assert.equal(backup.document.pages.length, 12);
  assert.deepEqual(backup.document.pages.map(p => p.name), document.pages.map(p => p.name));
  assert.ok(f.calls.filter(c => c.method === "workspace.readText").length > initialReads);
  assert.equal(await page.locator("#active-page option").count(), 12);
});


test("a legacy backup lets the user choose a valid draft after a damaged entry and restores only a new file", async t => {
  const f = await fixture(t), page = await f.page();
  await page.locator("#add-page").click();
  await page.evaluate(() => window.switchProject("/project/B"));
  await page.locator("#recovery-message").filter({ hasText: "切换前项目" }).waitFor();
  const pending = page.waitForEvent("download");
  await page.locator("#recovery-backup").click();
  const backup = JSON.parse(await readFile(await (await pending).path()));
  backup.drafts.unshift({ format: "damaged", retained: "keep original" });
  await page.locator("#portable-backup-open").click();
  await page.locator("#portable-backup-file").setInputFiles({ name: "old-drafts.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await page.locator("#portable-backup-status").filter({ hasText: "草稿格式" }).waitFor();
  assert.equal(await page.locator("#portable-backup-restore").isDisabled(), true);
  await page.locator("#portable-backup-candidate").selectOption("1");
  await page.waitForFunction(() => !document.querySelector("#portable-backup-restore").disabled);
  await page.locator("#portable-backup-path").fill("designs/legacy-copy.codesign.json");
  await page.locator("#portable-backup-restore").click();
  await page.locator("#portable-backup-status").filter({ hasText: "已恢复到" }).waitFor();
  assert.equal(JSON.parse(f.files.get("/project/B:designs/legacy-copy.codesign.json")).pages.length, 2);
  assert.equal(await page.locator("#active-page option").count(), 1);
  assert.equal(f.calls.some(c => c.scope === "/project/B" && c.method === "storage.compareAndSet"), false);
});


test("a save-as draft reopens with its original file baseline and writes only the new destination", async t => {
  const f = await fixture(t), initialPath = "designs/original.codesign.json";
  const base = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "Original saved design", canvas: { width: 800, height: 600, background: "#ffffff" }, tokens: { colors: [] }, resources: [], activePageId: "page-1", pages: [{ id: "page-1", name: "One", children: [] }, { id: "page-2", name: "Two", children: [] }] });
  const originalBytes = serializeDesignDocument(base);
  f.files.set(`/project/A:${initialPath}`, originalBytes);
  const page = await f.page({ initialPath });
  await page.locator("#add-page").click();
  await page.locator("#document-path").fill("designs/copy.codesign.json");
  await page.locator("#document-path").press("Tab");
  const deadline = Date.now() + 5000;
  while (![...f.records.values()].some(value => value?.path === "designs/copy.codesign.json" && value?.record)) {
    assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 20));
  }
  const reopened = await f.page({ initialPath });
  assert.equal(await reopened.locator("#active-page option").count(), 3);
  assert.equal(await reopened.locator("#document-path").inputValue(), "designs/copy.codesign.json");
  await reopened.locator("#save").click();
  await reopened.locator("#save-state").filter({ hasText: "已保存" }).waitFor();
  assert.equal(JSON.parse(f.files.get("/project/A:designs/copy.codesign.json")).pages.length, 3);
  assert.equal(f.files.get(`/project/A:${initialPath}`), originalBytes);
});


test("save-as recovery refuses a changed original baseline and retains both the journal and existing destination", async t => {
  const f = await fixture(t), initialPath = "designs/source.codesign.json";
  const base = { format: "codeshell.design", version: 3, name: "Original", canvas: { width: 800, height: 600, background: "#ffffff" }, tokens: { colors: [] }, resources: [], activePageId: "page-1", pages: [{ id: "page-1", name: "One", children: [] }] };
  f.files.set(`/project/A:${initialPath}`, JSON.stringify(base));
  f.files.set("/project/A:designs/existing.codesign.json", "keep destination bytes");
  const page = await f.page({ initialPath });
  await page.locator("#add-page").click();
  await page.locator("#document-path").fill("designs/existing.codesign.json");
  await page.locator("#document-path").press("Tab");
  const deadline = Date.now() + 5000;
  while (![...f.records.values()].some(v => v?.version === 2 && v?.record)) {
    assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 20));
  }
  const [key, saved] = [...f.records].find(([, value]) => value?.record);
  const snapshot = structuredClone(saved);
  f.files.set(`/project/A:${initialPath}`, JSON.stringify({ ...base, name: "New external version" }));
  const reopened = await f.page({ initialPath });
  await reopened.locator("#recovery-message").filter({ hasText: "基础设计已变化" }).waitFor();
  assert.deepEqual(f.records.get(key), snapshot);
  assert.equal(f.files.get("/project/A:designs/existing.codesign.json"), "keep destination bytes");
  assert.equal(await reopened.locator("#active-page option").count(), 1);
});

test("an unsaved draft keeps its embedded baseline through repeated recovery and editing", async t => {
  const f = await fixture(t), a = await f.page();
  await a.locator("#add-page").click();
  const waitForPages = async count => {
    const deadline = Date.now() + 5000;
    while (![...f.records.values()].some(v => v?.record?.operations.filter(op => op.type === "add-page").length === count)) {
      assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  await waitForPages(1);
  const b = await f.page();
  assert.equal(await b.locator("#active-page option").count(), 2);
  await b.locator("#add-page").click();
  await waitForPages(2);
  const c = await f.page();
  assert.equal(await c.locator("#active-page option").count(), 3);
  const saved = [...f.records.values()].find(v => v?.record);
  assert.ok(saved.baseDocument);
  assert.equal(saved.baseRevision, null);
});


test("late agent save failure cannot roll the new project back to the old canvas", async t => {
  const f = await fixture(t), page = await f.page({ cwd: "/workspace", scope: "cloud-A" });
  await page.locator("#add-page").click();
  const hold = f.pauseResponse("cloud-A", "workspace.writeText");
  await page.evaluate(async () => {
    const metadata = await window.tools.get_design_metadata();
    window.pendingAgent = window.tools.use_design({
      expected_state_revision: metadata.stateRevision,
      operations: [{ op: "create_page", id: "agent-page", name: "Agent page" }],
      save: true,
    }).then(value => ({ value }), error => ({ error: error.message }));
  });
  await hold.entered;
  await page.evaluate(() => window.switchProject("/workspace", "cloud-B"));
  await page.waitForFunction(() => !document.querySelector(".topbar").inert);
  assert.equal(await page.locator("#active-page option").count(), 1);
  hold.release();
  const outcome = await page.evaluate(() => window.pendingAgent);
  assert.match(outcome.error, /工作区.*切换/);
  const metadata = await page.evaluate(() => window.tools.get_design_metadata());
  assert.equal(metadata.pages.length, 1, "old transaction must not replace new project's canvas");
  assert.equal(f.calls.some(call => call.scope === "cloud-B" && call.method === "workspace.writeText"), false);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(f.calls.some(call => call.scope === "cloud-B" && call.method === "storage.compareAndSet"), false);
});


for (const action of ["resource", "html", "rollback"]) {
  test(`late ${action} transaction cannot change the next project or probe its files`, async t => {
    const f = await fixture(t), page = await f.page({ cwd: "/workspace", scope: "cloud-A" });
    await page.locator("#add-page").click();
    f.files.set("cloud-A:designs/import.html", '<html><body><div style="width:100px;height:100px;background:red">Imported</div></body></html>');
    if (action === "rollback") await page.evaluate(async () => {
      const metadata = await window.tools.get_design_metadata();
      window.transaction = await window.tools.use_design({ expected_state_revision: metadata.stateRevision,
        operations: [{ op: "create_page", id: "agent-page", name: "Agent page" }], save: false });
    });
    const hold = f.pauseResponse("cloud-A", "workspace.writeText");
    await page.evaluate(async action => {
      const metadata = await window.tools.get_design_metadata();
      const operation = action === "resource"
        ? window.tools.put_design_resource({ expected_state_revision: metadata.stateRevision,
            id: "pixel", kind: "image", mime: "image/png", save: true,
            base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" })
        : action === "html"
          ? window.tools.import_html({ expected_state_revision: metadata.stateRevision, path: "designs/import.html", save: true })
          : window.tools.rollback_design({ transaction_id: window.transaction.transactionId, save: true });
      window.pendingAgent = operation.then(value => ({ value }), error => ({ error: error.message }));
    }, action);
    await hold.entered;
    await page.evaluate(() => window.switchProject("/workspace", "cloud-B"));
    await page.waitForFunction(() => !document.querySelector(".topbar").inert);
    const readsBeforeRelease = f.calls.filter(call => call.scope === "cloud-B" && call.method === "workspace.readText").length;
    hold.release();
    assert.match((await page.evaluate(() => window.pendingAgent)).error, /工作区.*切换/);
    const metadata = await page.evaluate(() => window.tools.get_design_metadata());
    assert.equal(metadata.pages.length, 1);
    assert.deepEqual(metadata.resources, []);
    assert.equal(f.calls.filter(call => call.scope === "cloud-B" && call.method === "workspace.readText").length, readsBeforeRelease);
    assert.equal(f.calls.some(call => call.scope === "cloud-B" && call.method === "workspace.writeText"), false);
  });
}


for (const indexed of [false, true]) {
  test(`editing during a ${indexed ? "page-indexed" : "single-file"} save retains dirty state and recovers newer pages`, async t => {
    const f = await fixture(t), initialPath = "designs/concurrent.codesign.json";
    const document = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "Concurrent save", canvas: { width: 800, height: 600, background: "#ffffff" }, tokens: { colors: [] }, resources: [], activePageId: "page-1", pages: [{ id: "page-1", name: "One", children: [] }] });
    if (indexed) {
      const plan = await createDesignIndexPersistencePlan({ document, sha256: async value => createHash("sha256").update(value).digest("hex") });
      f.files.set(`/project/A:${initialPath}`, plan.primarySource);
      for (const part of plan.parts) f.files.set(`/project/A:${part.path}`, part.content);
    } else f.files.set(`/project/A:${initialPath}`, serializeDesignDocument(document));
    const page = await f.page({ initialPath });
    await page.locator("#add-page").click();
    const hold = f.pauseResponse("/project/A", "workspace.writeText");
    await page.locator("#save").click();
    await hold.entered;
    await page.locator("#add-page").click();
    hold.release();
    await page.waitForFunction(() => !document.querySelector("#save").disabled);
    assert.equal(await page.locator("#active-page option").count(), 3);
    assert.match(await page.locator("#save-state").textContent(), /有修改/);
    const deadline = Date.now() + 5000;
    while (![...f.records.values()].some(value => value?.baseRevision === hash(f.files.get(`/project/A:${initialPath}`)) && value?.record?.operations?.some(op => op.type === "add-page"))) {
      assert.ok(Date.now() < deadline, "newer edits need a recovery journal");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const reopened = await f.page({ initialPath });
    assert.equal(await reopened.locator("#active-page option").count(), 3);
    await reopened.locator("#save").click();
    await reopened.locator("#save-state").filter({ hasText: "已保存" }).waitFor();
    const final = await f.page({ initialPath });
    assert.equal(await final.locator("#active-page option").count(), 3);
  });
}


test("a page loaded and renamed during an indexed save survives recovery and the next save", async t => {
  const f = await fixture(t), initialPath = "designs/lazy.codesign.json";
  const document = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "Lazy save", canvas: { width: 800, height: 600, background: "#ffffff" }, tokens: { colors: [] }, resources: [], activePageId: "page-1", pages: Array.from({ length: 12 }, (_, i) => ({ id: `page-${i+1}`, name: `Page ${i+1}`, children: [] })) });
  const plan = await createDesignIndexPersistencePlan({ document, sha256: async value => createHash("sha256").update(value).digest("hex") });
  f.files.set(`/project/A:${initialPath}`, plan.primarySource);
  for (const part of plan.parts) f.files.set(`/project/A:${part.path}`, part.content);
  const page = await f.page({ initialPath });
  const hold = f.pauseResponse("/project/A", "workspace.writeText");
  await page.locator("#save").click();
  await hold.entered;
  await page.locator("#manage-pages").click();
  const name = page.getByRole("textbox", { name: "Page 12 页面名称", exact: true });
  await name.fill("Changed while saving");
  await name.press("Enter");
  await page.getByRole("textbox", { name: "Changed while saving 页面名称", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  hold.release();
  await page.waitForFunction(() => !document.querySelector("#save").disabled);
  assert.match(await page.locator("#save-state").textContent(), /有修改/);
  const deadline = Date.now()+5000;
  while (![...f.records.values()].some(v => v?.baseRevision === hash(f.files.get(`/project/A:${initialPath}`)) && v?.record?.operations?.some(op => op.type === "rename-page"))) {
    assert.ok(Date.now()<deadline); await new Promise(resolve => setTimeout(resolve,20));
  }
  const reopened = await f.page({ initialPath });
  assert.equal(await reopened.locator('#active-page option[value="page-12"]').textContent(), "Changed while saving");
  await reopened.locator("#save").click();
  await reopened.locator("#save-state").filter({ hasText: "已保存" }).waitFor();
  const final = await f.page({ initialPath });
  assert.equal(await final.locator('#active-page option[value="page-12"]').textContent(), "Changed while saving");
});



for (const stage of ["page", "image", "font", "same-project-document"]) {
  test(`late ${stage} loading cannot change the replacement canvas`, async t => {
    const f = await fixture(t), initialPath = "designs/pages.codesign.json";
    const font = stage === "font";
    const resource = await createDesignResourcePersistencePlan({
      id: "asset", kind: font ? "font" : "image", mime: font ? "font/woff2" : "image/png",
      ...(font ? { family: "Deferred font" } : {}),
      base64: font ? Buffer.from("controlled decoder fixture").toString("base64") : "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      sha256Bytes: async value => createHash("sha256").update(value).digest("hex"),
    });
    const node = { id: "asset-node", type: font ? "text" : "image", name: "Asset", x: 0, y: 0, width: 20, height: 20,
      strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, fill: "#000000", stroke: "transparent", visible: true, locked: false,
      ...(font ? { text: "Hello", fontSize: 16, fontWeight: 400, lineHeight: 1, textAlign: "left", fontRef: "asset" }
        : { imageRef: "asset", objectFit: "contain" }),
    };
    for (const part of resource.parts) f.files.set(`cloud-A:${part.path}`, part.content);
    for (const scope of ["cloud-A", "cloud-B"]) {
      const doc = normalizeDesignDocument({ format: "codeshell.design", version: 3, name: scope,
        canvas: { width: 800, height: 600, background: "#ffffff" }, tokens: { colors: [] },
        resources: scope === "cloud-A" ? [resource.descriptor] : [], activePageId: "page-1",
        pages: Array.from({ length: 12 }, (_, i) => ({ id: `page-${i+1}`, name: `${scope} ${i+1}`,
          children: scope === "cloud-A" && i === 11 ? [node] : [] })),
      });
      const plan = await createDesignIndexPersistencePlan({ document: doc, sha256: async value => createHash("sha256").update(value).digest("hex") });
      f.files.set(`${scope}:${initialPath}`, plan.primarySource);
      for (const part of plan.parts) f.files.set(`${scope}:${part.path}`, part.content);
    }
    const page = await f.page({ cwd: "/workspace", scope: "cloud-A", initialPath, sharedInitialPath: true });
    await page.evaluate(stage => {
      const hold = async () => {
        window.loadEntered = true;
        await new Promise(resolve => { window.releaseLoad = resolve; });
      };
      window.installedDeferredFonts = [];
      if (stage === "font") {
        // Exercise the asynchronous decoder boundary; this is not a font fidelity test.
        window.FontFace = class {
          constructor(family) { this.family = family; }
          async load() { await hold(); return this; }
        };
        document.fonts.add = face => { window.installedDeferredFonts.push(face.family); };
      } else {
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        let calls = 0;
        crypto.subtle.digest = async (...args) => {
          const result = await digest(...args);
          if (++calls === (stage === "page" ? 1 : 2)) await hold();
          return result;
        };
      }
    }, stage);
    await page.locator("#active-page").selectOption("page-12");
    await page.waitForFunction(() => window.loadEntered);
    if (stage === "same-project-document") {
      await page.locator("#open-files").click();
      await page.locator("#new-document").click();
    }
    else await page.evaluate(() => window.switchProject("/workspace", "cloud-B"));
    await page.waitForFunction(() => !document.querySelector(".topbar").inert);
    const scope = stage === "same-project-document" ? "cloud-A" : "cloud-B";
    const before = await page.evaluate(() => window.tools.get_design_metadata());
    const writesBefore = f.calls.filter(call => call.scope === scope && call.method === "storage.compareAndSet").length;
    await page.evaluate(() => window.releaseLoad());
    await page.waitForTimeout(650);
    const result = await page.evaluate(() => window.tools.get_design_metadata());
    assert.equal(result.name, before.name);
    assert.equal(result.activePageId, before.activePageId);
    assert.equal(result.dirty, before.dirty);
    assert.equal(result.runtime.loadedResourceCount, 0);
    assert.deepEqual(await page.evaluate(() => window.installedDeferredFonts), []);
    if (stage !== "same-project-document")
      assert.equal(f.calls.filter(call => call.scope === scope && call.method === "storage.compareAndSet").length, writesBefore);
  });
}
