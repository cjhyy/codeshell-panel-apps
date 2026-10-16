import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  createPrototype,
  createPrototypeStore,
  exportDesignPrototype,
  normalizePrototype,
  prototypeDiagnostics,
  repairPrototype,
  isSafePrototypeUrl,
  prototypePath,
} from "../../../apps/design-studio/app/prototype.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";

export function fixtureDocument() {
  const rect = (id, name, x = 30) => ({
    id,
    type: "rectangle",
    name,
    x,
    y: 40,
    width: 180,
    height: 80,
    rotation: 0,
    fill: "#334455",
    stroke: "transparent",
    strokeWidth: 0,
    cornerRadius: 8,
    opacity: 1,
    visible: true,
    locked: false,
  });
  return {
    format: "codeshell.design",
    version: 3,
    name: "Demo",
    canvas: { width: 1200, height: 800, background: "#ffffff" },
    tokens: { colors: [] },
    resources: [],
    activePageId: "home",
    pages: [
      {
        id: "home",
        name: "首页",
        children: [rect("next", "查看详情"), rect("external", "外部链接", 260)],
      },
      { id: "detail", name: "详情", children: [rect("previous", "返回首页")] },
      { id: "mobile", name: "手机首页", children: [rect("mobile-next", "手机详情")] },
    ],
  };
}
function fixturePrototype() {
  return {
    ...createPrototype(fixtureDocument()),
    links: [
      {
        id: "next-link",
        pageId: "home",
        nodeId: "next",
        event: "click",
        action: "navigate",
        targetPageId: "detail",
      },
      {
        id: "external-link",
        pageId: "home",
        nodeId: "external",
        event: "click",
        action: "open-url",
        url: "https://example.com/path?q=1&x=2",
      },
      { id: "back-link", pageId: "detail", nodeId: "previous", event: "click", action: "back" },
      {
        id: "mobile-link",
        pageId: "mobile",
        nodeId: "mobile-next",
        event: "click",
        action: "navigate",
        targetPageId: "detail",
      },
    ],
    breakpoints: [
      { id: "phone", minWidth: 0, maxWidth: 600, pageId: "mobile" },
      { id: "desktop", minWidth: 601, pageId: "home" },
    ],
  };
}
const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = async (value) => createHash("sha256").update(value).digest("hex");

test("prototype schema validates references, unique click actions, responsive ranges and URL protocols", () => {
  const document = fixtureDocument(),
    model = fixturePrototype(),
    before = JSON.stringify(model);
  assert.deepEqual(normalizePrototype(model, document), model);
  assert.equal(JSON.stringify(model), before);
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///tmp/x",
    "https://example.com/\n",
    "/relative",
  ])
    assert.equal(isSafePrototypeUrl(url), false);
  for (const url of [
    "https://example.com",
    "http://localhost:3000",
    "mailto:review@example.com",
    "tel:+123456",
  ])
    assert.equal(isSafePrototypeUrl(url), true);
  assert.throws(() => normalizePrototype({ ...model, script: "alert(1)" }, document), /未知/);
  assert.throws(
    () =>
      normalizePrototype(
        { ...model, links: [...model.links, { ...model.links[0], id: "another" }] },
        document,
      ),
    /同一图层/,
  );
  assert.throws(
    () => normalizePrototype({ ...model, startPageId: "deleted" }, document),
    /起始页面/,
  );
  assert.throws(
    () =>
      normalizePrototype(
        { ...model, links: [{ ...model.links[0], targetPageId: "deleted" }] },
        document,
      ),
    /目标页面/,
  );
  assert.throws(
    () =>
      normalizePrototype(
        {
          ...model,
          breakpoints: [
            { id: "a", minWidth: 0, maxWidth: 600, pageId: "home" },
            { id: "b", minWidth: 600, pageId: "detail" },
          ],
        },
        document,
      ),
    /重叠/,
  );
  assert.throws(() => prototypePath("../unsafe.codesign.json"), /路径/);
});

test("orphaned links and breakpoints remain inspectable and require explicit repair", () => {
  const document = fixtureDocument(),
    model = {
      ...fixturePrototype(),
      startPageId: "removed",
      links: [{ id: "orphan", pageId: "home", nodeId: "removed", event: "click", action: "back" }],
      breakpoints: [{ id: "orphan-point", minWidth: 0, pageId: "removed" }],
    };
  const before = JSON.stringify(model);
  assert.equal(normalizePrototype(model).links.length, 1);
  assert.equal(prototypeDiagnostics(model, document).length, 3);
  assert.throws(() => exportDesignPrototype(document, { prototype: model }), /已移除/);
  const repaired = repairPrototype(model, document);
  assert.equal(repaired.startPageId, "home");
  assert.deepEqual(repaired.links, []);
  assert.deepEqual(repaired.breakpoints, []);
  assert.equal(JSON.stringify(model), before);
});

test("all-page prototype is deterministic, preserves data IDs and rejects remote resources; static export stays static", () => {
  const document = fixtureDocument(),
    model = fixturePrototype();
  const before = JSON.stringify(document),
    html = exportDesignPrototype(document, { prototype: model });
  assert.equal(exportDesignPrototype(document, { prototype: model }), html);
  assert.equal(JSON.stringify(document), before);
  for (const page of document.pages)
    assert.match(html, new RegExp(`data-codeshell-page-id="${page.id}"`));
  assert.match(html, /data-codeshell-id="mobile-next"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.throws(
    () =>
      exportDesignPrototype(document, {
        prototype: model,
        resourceDataUrls: new Map([["image", "https://example.com/private.png"]]),
      }),
    /离线资源/,
  );
  const staticHtml = exportDesignFrontend(document);
  assert.equal(staticHtml.includes("prototypeRuntime"), false);
  assert.equal(staticHtml.includes("cs-prototype-hotspot"), false);
  assert.equal((staticHtml.match(/<main /gu) ?? []).length, 1);
});

function memoryStore() {
  const snapshot = {
    context: {
      cwd: "/project-A",
      sessionId: "chat",
      trusted: true,
      projectScope: { version: 1, environmentId: "local", projectId: "a", rootId: "root" },
    },
    path: "designs/demo.codesign.json",
    workspaceEpoch: 1,
    documentEpoch: 1,
    stateRevision: "state-1",
    ready: true,
  };
  const files = new Map(),
    calls = [];
  let revision = 0,
    beforeRead,
    beforeWrite,
    beforeCapture;
  const call = async (method, params) => {
    const key = `${snapshot.context.cwd}:${params.path}`;
    calls.push({ method, params: clone(params), key });
    if (method === "workspace.readText") {
      const file = files.get(key);
      await beforeRead?.();
      if (!file) throw Object.assign(Error("missing"), { code: "ENOENT" });
      return { path: params.path, ...file };
    }
    await beforeWrite?.();
    const old = files.get(key);
    if (
      (params.expectedModifiedAt === null && old) ||
      (params.expectedRevision !== undefined && params.expectedRevision !== old?.revision)
    )
      throw Object.assign(Error("file changed"), { code: "CONFLICT" });
    const value = { content: params.content, revision: `r-${++revision}` };
    files.set(key, value);
    return { path: params.path, revision: value.revision };
  };
  const store = createPrototypeStore({
    getSnapshot: () => snapshot,
    capture: async (_, check) => {
      await beforeCapture?.();
      check();
      return { document: fixtureDocument(), resourceDataUrls: new Map() };
    },
    call,
    sha256,
  });
  return {
    snapshot,
    files,
    calls,
    store,
    hooks(value) {
      beforeRead = value.read;
      beforeWrite = value.write;
      beforeCapture = value.capture;
    },
  };
}

test("prototype sidecar commits with CAS and rejects concurrent edits without overwriting them", async () => {
  const f = memoryStore(),
    first = await f.store.read();
  assert.equal(first.baseline.expectedModifiedAt, null);
  const saved = await f.store.save(fixturePrototype(), { baseline: first.baseline });
  assert.equal(saved.baseline.expectedRevision, "r-1");
  assert.equal(f.calls.at(-1).params.expectedModifiedAt, null);
  const second = await f.store.read();
  const key = "/project-A:designs/demo.prototype.json",
    external = { ...createPrototype(fixtureDocument()), startPageId: "detail" };
  f.files.set(key, { content: JSON.stringify(external), revision: "external" });
  await assert.rejects(f.store.save(fixturePrototype(), { baseline: second.baseline }), /changed/);
  assert.equal(JSON.parse(f.files.get(key).content).startPageId, "detail");
  await assert.rejects(
    f.store.save(fixturePrototype(), { baseline: { scopeKey: second.baseline.scopeKey } }),
    /版本缺失/,
  );
});

test("project/document changes during read, capture or multipart preparation stop old operations before writes", async () => {
  for (const phase of ["read", "capture"]) {
    const f = memoryStore();
    f.hooks({
      [phase]() {
        f.snapshot.context.cwd = "/project-B";
        f.snapshot.workspaceEpoch++;
      },
    });
    await assert.rejects(f.store.read(), /已切换/);
    assert.equal(
      f.calls.some((call) => call.method.endsWith("writeText")),
      false,
    );
  }
  const f = memoryStore(),
    first = await f.store.read();
  f.snapshot.context.cwd = "/project-B";
  f.snapshot.workspaceEpoch++;
  await assert.rejects(f.store.save(fixturePrototype(), { baseline: first.baseline }), /其他项目/);
  assert.equal(
    f.calls.some((call) => call.method.endsWith("writeText")),
    false,
  );
  f.hooks({
    capture() {
      f.snapshot.stateRevision = "state-2";
    },
  });
  await assert.rejects(f.store.read(), /设计在原型操作期间/);
});

test("real Chromium follows keyboard anchors, back history, responsive routes, and renders review payloads as text offline", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "design-prototype-offline-"));
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith("file:")) return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  const document = fixtureDocument();
  const payload = '</script><img src=x onerror="window.prototypePwned=1">';
  document.name = payload;
  document.pages[0].children[0].name = payload;
  const html = exportDesignPrototype(document, {
    prototype: fixturePrototype(),
    comments: {
      threads: [
        {
          id: "review",
          pageId: "home",
          nodeId: "next",
          text: payload,
          author: payload,
          replies: [{ text: payload, author: "Reply" }],
        },
      ],
    },
  });
  const file = join(directory, "prototype.html");
  await writeFile(file, html);
  await page.goto(pathToFileURL(file).href);
  assert.equal(
    await page.locator("main:not([hidden])").getAttribute("data-codeshell-page-id"),
    "home",
  );
  await page.locator('[data-prototype-link="next-link"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page.locator("main:not([hidden])").getAttribute("data-codeshell-page-id"),
    "detail",
  );
  assert.equal(
    await page.locator('main[data-codeshell-page-id="home"]').evaluate((node) => node.inert),
    true,
  );
  await page.locator('[data-prototype-link="back-link"]').click();
  assert.equal(
    await page.locator("main:not([hidden])").getAttribute("data-codeshell-page-id"),
    "home",
  );
  await page.locator("#prototype-review-toggle").check();
  await page.locator('[data-review-id="review"]').click();
  assert.equal(
    (await page.locator("#prototype-review-text").textContent()).includes(payload),
    true,
  );
  assert.equal(await page.evaluate(() => window.prototypePwned), undefined);
  assert.equal(await page.locator("#prototype-review-text img").count(), 0);
  await page.locator("#prototype-review-close").click();
  const external = page.locator('[data-prototype-link="external-link"]');
  assert.equal(await external.getAttribute("href"), "https://example.com/path?q=1&x=2");
  assert.equal(await external.getAttribute("rel"), "noopener noreferrer");
  // A new offline page selects its mobile entry point; resizing before navigation follows breakpoints.
  await page.goto("about:blank");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pathToFileURL(file).href);
  assert.equal(
    await page.locator("main:not([hidden])").getAttribute("data-codeshell-page-id"),
    "mobile",
  );
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForFunction(
    () => document.querySelector("main:not([hidden])").dataset.codeshellPageId === "home",
  );
  await page.locator('[data-prototype-link="next-link"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.locator("main:not([hidden])").getAttribute("data-codeshell-page-id"),
    "detail",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
});
