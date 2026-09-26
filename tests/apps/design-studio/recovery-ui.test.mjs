import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";
import { chromium } from "playwright";
import { createDesignIndexPersistencePlan } from "../../../apps/design-studio/app/document-index.mjs";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";

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
  async function page({ cwd = "/project/A", scope = cwd, sessionId = scope, deferContext = false, initialPath = null } = {}) {
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
        if (initialPath && scope === initialScope && params.key.startsWith("lastPath.")) return { workspaceRoot: cwd, path: initialPath };
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
        return { modifiedAt: 1, revision: hash(params.content) };
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
      /新设计|已打开/.test(document.querySelector("#repo-link-state")?.textContent ?? ""),
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
