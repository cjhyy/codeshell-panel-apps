import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const fixtureDocument = {
  format: "codeshell.design",
  version: 3,
  name: "Prototype fixture",
  canvas: { width: 1000, height: 800, background: "#ffffff" },
  tokens: { colors: [] },
  resources: [],
  activePageId: "home",
  pages: [
    {
      id: "home",
      name: "首页",
      children: [
        {
          id: "next",
          type: "rectangle",
          name: "详情按钮",
          x: 30,
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
        },
      ],
    },
    { id: "detail", name: "详情", children: [] },
    { id: "mobile", name: "手机首页", children: [] },
  ],
};
const defaultPrototype = {
  format: "codeshell.design.prototype",
  version: 1,
  startPageId: "home",
  links: [],
};

async function fixture(t, { mobile = false, commentsCallback = false } = {}) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: mobile ? 390 : 1280, height: 844 },
  });
  const page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(4000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://panel.test") return route.abort();
    if (url.pathname === "/prototype-harness.html")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./style.css"></head><body><header class="topbar"><div class="top-actions"><button id="open-ai">Agent</button><details id="compact-actions"><summary>更多</summary><div class="compact-actions-list"></div></details></div></header><script type="module">
      import { mountPrototypeEditor } from './prototype-ui.mjs';
      window.prototypeUI = mountPrototypeEditor({getSnapshot:()=>window.prototypeSnapshot,
        capture:async (_,check)=>{check();return {document:window.prototypeDocument,resourceDataUrls:new Map()}},
        captureComments:window.prototypeUseCommentsCallback?window.prototypeCaptureComments:undefined,
        call:window.prototypeCall,sha256:async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('')});
      document.querySelector('.compact-actions-list').addEventListener('click',event=>{const id=event.target.closest('[data-toolbar-action]')?.dataset.toolbarAction;if(id)document.getElementById(id).click()});
    </script></body></html>`,
      });
    const path = resolve(root, `.${url.pathname}`);
    if (!path.startsWith(`${root}${sep}`)) return route.abort();
    try {
      await route.fulfill({
        body: await readFile(path),
        contentType:
          { ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css" }[
            extname(path)
          ] ?? "application/octet-stream",
      });
    } catch {
      await route.fulfill({ status: 404, body: "missing" });
    }
  });
  await page.addInitScript(
    ({ documentValue, commentsCallback }) => {
      window.prototypeDocument = documentValue;
      window.prototypeUseCommentsCallback = commentsCallback;
      window.prototypeCommentCaptureCalls = [];
      window.prototypeCaptureComments = async (snapshot, check) => {
        window.prototypeCommentCaptureCalls.push(snapshot.context.projectScope.projectId);
        if (window.prototypePauseComments) {
          window.prototypePauseComments = false;
          await new Promise((resolve) => {
            window.prototypeResumeComments = resolve;
          });
        }
        check();
        return {
          threads: [
            {
              id: "callback-review",
              pageId: "home",
              nodeId: "next",
              text: "Review from callback",
              author: "Reviewer",
              replies: [],
            },
          ],
        };
      };
      window.prototypeSnapshot = {
        context: {
          cwd: "/project",
          sessionId: "chat",
          trusted: true,
          projectScope: { version: 1, environmentId: "local", projectId: "A", rootId: "root" },
        },
        path: "designs/demo.codesign.json",
        workspaceEpoch: 1,
        documentEpoch: 1,
        stateRevision: "state-1",
        ready: true,
        pageId: "home",
        selectedNode: { id: "next", name: "详情按钮" },
      };
      window.prototypeFiles = {};
      window.prototypeCalls = [];
      let revision = 0;
      window.prototypeCall = async (method, params) => {
        const key = `${window.prototypeSnapshot.context.projectScope.projectId}:${params.path}`;
        window.prototypeCalls.push({ method, ...params, key });
        if (method === "workspace.readText") {
          const stored = window.prototypeFiles[key];
          if (window.prototypePauseRead === key) {
            window.prototypePauseRead = null;
            await new Promise((resolve) => {
              window.prototypeResumeRead = resolve;
            });
          }
          if (!stored) throw Object.assign(Error("missing"), { code: "ENOENT" });
          return { path: params.path, ...stored };
        }
        const old = window.prototypeFiles[key];
        if (
          (params.expectedModifiedAt === null && old) ||
          (params.expectedRevision !== undefined && params.expectedRevision !== old?.revision)
        )
          throw Object.assign(Error("file changed since review"), { code: "CONFLICT" });
        const value = { content: params.content, revision: `revision-${++revision}` };
        window.prototypeFiles[key] = value;
        return { path: params.path, revision: value.revision };
      };
      window.switchPrototypeProject = (id) => {
        window.prototypeSnapshot.context.projectScope.projectId = id;
        window.prototypeSnapshot.workspaceEpoch++;
        window.prototypeUI.contextChanged();
      };
    },
    { documentValue: fixtureDocument, commentsCallback },
  );
  await page.goto("https://panel.test/prototype-harness.html");
  await page.waitForFunction(() => Boolean(window.prototypeUI));
  async function open() {
    if (mobile) {
      await page.locator("#compact-actions summary").click();
      await page.locator('[data-toolbar-action="open-prototype-editor"]').click();
    } else await page.locator("#open-prototype-editor").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#prototype-editor-dialog").getAttribute("aria-busy") === "false" &&
        !document.querySelector("#prototype-action").disabled,
    );
  }
  async function linkToDetail() {
    await page.locator("#prototype-target-page").selectOption("detail");
    await page.locator("#prototype-add-link").click();
  }
  return { page, errors, open, linkToDetail };
}

test("prototype editor saves selected-layer links and start page, previews and downloads all pages", async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.linkToDetail();
  assert.match(await f.page.locator("#prototype-links").textContent(), /详情按钮.*跳转到 详情/);
  await f.page.locator("#prototype-start-page").selectOption("home");
  await f.page.locator("#prototype-save").click();
  await f.page.waitForFunction(() =>
    document.querySelector("#prototype-editor-status").textContent.includes("已保存"),
  );
  const saved = await f.page.evaluate(() =>
    JSON.parse(window.prototypeFiles["A:designs/demo.prototype.json"].content),
  );
  assert.equal(saved.links[0].targetPageId, "detail");
  assert.equal(saved.links[0].nodeId, "next");
  assert.equal(await f.page.locator("#prototype-save").isDisabled(), true);
  await f.page.locator("#prototype-preview").click();
  const preview = f.page.frameLocator("#prototype-preview-frame");
  await preview.locator("[data-prototype-link]").click();
  assert.equal(
    await preview.locator("main:not([hidden])").getAttribute("data-codeshell-page-id"),
    "detail",
  );
  await preview.locator("#prototype-back").click();
  assert.equal(
    await preview.locator("main:not([hidden])").getAttribute("data-codeshell-page-id"),
    "home",
  );
  await f.page.evaluate(() => {
    window.prototypeFiles["A:designs/demo.comments.json"] = {
      revision: "comment-1",
      content: JSON.stringify({
        format: "codeshell.design.comments",
        version: 1,
        designPath: "designs/demo.codesign.json",
        threads: [
          {
            id: "review-1",
            text: "Actual review text",
            author: "Reviewer",
            createdAt: "2026-10-16T08:00:00.000Z",
            updatedAt: "2026-10-16T08:00:00.000Z",
            pageId: "home",
            nodeId: "next",
            status: "open",
            replies: [],
          },
        ],
      }),
    };
  });
  await f.page.locator("#prototype-include-comments").check();
  const event = f.page.waitForEvent("download");
  await f.page.locator("#prototype-download").click();
  const download = await event,
    html = await readFile(await download.path(), "utf8");
  assert.equal(download.suggestedFilename(), "design-interactive-prototype.html");
  assert.match(html, /data-codeshell-page-id="mobile"/);
  assert.match(html, /Actual review text/);
  await f.page.locator('[aria-label^="移除交互"]').click();
  await f.page.locator("#prototype-save").click();
  await f.page.waitForFunction(
    () =>
      JSON.parse(window.prototypeFiles["A:designs/demo.prototype.json"].content).links.length === 0,
  );
  assert.deepEqual(f.errors, []);
});

test("URL allowlist and responsive overlapping ranges reject invalid drafts, and CAS preserves outside edits", async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.page.locator("#prototype-action").selectOption("open-url");
  await f.page.locator("#prototype-url").fill("javascript:alert(1)");
  await f.page.locator("#prototype-add-link").click();
  assert.match(await f.page.locator("#prototype-editor-status").textContent(), /URL/);
  assert.equal(await f.page.locator('[aria-label^="移除交互"]').count(), 0);
  await f.page.locator("#prototype-action").selectOption("navigate");
  await f.linkToDetail();
  await f.page.locator(".prototype-section summary").click();
  await f.page.locator("#prototype-max-width").fill("600");
  await f.page.locator("#prototype-breakpoint-page").selectOption("mobile");
  await f.page.locator("#prototype-add-breakpoint").click();
  await f.page.locator("#prototype-min-width").fill("600");
  await f.page.locator("#prototype-max-width").fill("");
  await f.page.locator("#prototype-add-breakpoint").click();
  assert.match(await f.page.locator("#prototype-editor-status").textContent(), /重叠/);
  assert.equal(await f.page.locator('[aria-label^="移除断点"]').count(), 1);
  await f.page.evaluate(
    (value) => {
      window.prototypeFiles["A:designs/demo.prototype.json"] = {
        content: JSON.stringify(value),
        revision: "outside",
      };
    },
    { ...defaultPrototype, startPageId: "mobile" },
  );
  await f.page.locator("#prototype-save").click();
  await f.page.waitForFunction(
    () => document.querySelector("#prototype-editor-status").dataset.kind === "error",
  );
  assert.match(await f.page.locator("#prototype-editor-status").textContent(), /changed/);
  assert.equal(
    await f.page.evaluate(
      () => JSON.parse(window.prototypeFiles["A:designs/demo.prototype.json"].content).startPageId,
    ),
    "mobile",
  );
  assert.equal(await f.page.locator('[aria-label^="移除交互"]').count(), 1);
  assert.deepEqual(f.errors, []);
});

test("project switching cancels stale reads and restores drafts under separate proven project identities", async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.linkToDetail();
  await f.page.evaluate(() => {
    window.prototypePauseRead = "A:designs/demo.prototype.json";
  });
  await f.page.locator("#prototype-refresh").click();
  await f.page.waitForFunction(() => typeof window.prototypeResumeRead === "function");
  await f.page.evaluate(() => window.switchPrototypeProject("B"));
  await f.page.waitForFunction(() => !document.querySelector("#prototype-action").disabled);
  assert.equal(await f.page.locator('[aria-label^="移除交互"]').count(), 0);
  await f.page.evaluate(() => window.prototypeResumeRead());
  await f.page.waitForFunction(
    () => document.querySelector("#prototype-editor-dialog").getAttribute("aria-busy") === "false",
  );
  assert.equal(await f.page.locator('[aria-label^="移除交互"]').count(), 0);
  await f.page.evaluate(() => window.switchPrototypeProject("A"));
  await f.page.waitForFunction(
    () => document.querySelectorAll('[aria-label^="移除交互"]').length === 1,
  );
  await f.page.locator("#prototype-save").click();
  await f.page.waitForFunction(() =>
    Boolean(window.prototypeFiles["A:designs/demo.prototype.json"]),
  );
  assert.equal(
    await f.page.evaluate(() =>
      window.prototypeCalls.some(
        (call) => call.method === "workspace.writeText" && call.key.startsWith("B:"),
      ),
    ),
    false,
  );
  assert.deepEqual(f.errors, []);
});

test("orphaned prototype targets show repair diagnostics and remain unchanged until explicit repair and save", async (t) => {
  const f = await fixture(t);
  const model = {
    ...defaultPrototype,
    startPageId: "deleted",
    links: [{ id: "old-link", pageId: "home", nodeId: "deleted", event: "click", action: "back" }],
    breakpoints: [{ id: "old-point", minWidth: 0, pageId: "deleted" }],
  };
  await f.page.evaluate((value) => {
    window.prototypeFiles["A:designs/demo.prototype.json"] = {
      content: JSON.stringify(value),
      revision: "old",
    };
  }, model);
  await f.open();
  assert.match(await f.page.locator("#prototype-diagnostic-text").textContent(), /3 项关联已失效/);
  await f.page.locator("#prototype-preview").click();
  await f.page.waitForFunction(
    () => document.querySelector("#prototype-editor-status").dataset.kind === "error",
  );
  assert.equal(
    await f.page.evaluate(
      () => JSON.parse(window.prototypeFiles["A:designs/demo.prototype.json"].content).links.length,
    ),
    1,
  );
  await f.page.locator("#prototype-repair").click();
  assert.equal(await f.page.locator("#prototype-diagnostics").isVisible(), false);
  assert.equal(
    await f.page.evaluate(
      () => JSON.parse(window.prototypeFiles["A:designs/demo.prototype.json"].content).startPageId,
    ),
    "deleted",
  );
  await f.page.locator("#prototype-save").click();
  await f.page.waitForFunction(
    () =>
      JSON.parse(window.prototypeFiles["A:designs/demo.prototype.json"].content).startPageId ===
      "home",
  );
  const saved = await f.page.evaluate(() =>
    JSON.parse(window.prototypeFiles["A:designs/demo.prototype.json"].content),
  );
  assert.deepEqual(saved.links, []);
  assert.deepEqual(saved.breakpoints, []);
  assert.deepEqual(f.errors, []);
});

test("comment callback only runs for opted-in previews and stale callback results cannot cross projects", async (t) => {
  const f = await fixture(t, { commentsCallback: true });
  await f.open();
  await f.linkToDetail();
  await f.page.locator("#prototype-preview").click();
  await f.page.waitForFunction(() =>
    document.querySelector("#prototype-editor-status").textContent.includes("预览已生成"),
  );
  assert.deepEqual(await f.page.evaluate(() => window.prototypeCommentCaptureCalls), []);
  await f.page.locator("#prototype-include-comments").check();
  await f.page.locator("#prototype-preview").click();
  await f.page.waitForFunction(
    () => document.querySelector("#prototype-editor-dialog").getAttribute("aria-busy") === "false",
  );
  assert.equal(
    await f.page
      .locator("#prototype-preview-frame")
      .evaluate((frame) => frame.srcdoc.includes("Review from callback")),
    true,
    JSON.stringify(
      await f.page.evaluate(() => ({
        calls: window.prototypeCommentCaptureCalls,
        status: document.querySelector("#prototype-editor-status").textContent,
      })),
    ),
  );
  const preview = f.page.frameLocator("#prototype-preview-frame");
  assert.equal(
    await preview.locator("#prototype-review-toggle").evaluate((node) => node.parentElement.hidden),
    false,
    JSON.stringify(
      await preview
        .locator("body")
        .evaluate((node) => ({
          text: node.innerText,
          pins: node.querySelectorAll("[data-review-id]").length,
        })),
    ),
  );
  await preview.locator("#prototype-review-toggle").check();
  await preview.locator('[data-review-id="callback-review"]').click();
  assert.match(
    await preview.locator("#prototype-review-text").textContent(),
    /Review from callback/,
  );
  assert.deepEqual(await f.page.evaluate(() => window.prototypeCommentCaptureCalls), ["A"]);
  await f.page.evaluate(() => {
    window.prototypePauseComments = true;
  });
  await f.page.locator("#prototype-preview").click();
  await f.page.waitForFunction(() => typeof window.prototypeResumeComments === "function");
  await f.page.evaluate(() => window.switchPrototypeProject("B"));
  await f.page.waitForFunction(() => !document.querySelector("#prototype-action").disabled);
  await f.page.evaluate(() => window.prototypeResumeComments());
  await f.page.waitForFunction(
    () => document.querySelector("#prototype-editor-dialog").getAttribute("aria-busy") === "false",
  );
  assert.equal(await f.page.locator("#prototype-preview-section").isVisible(), false);
  assert.equal(await f.page.locator("#prototype-preview-frame").getAttribute("srcdoc"), null);
  assert.deepEqual(await f.page.evaluate(() => window.prototypeCommentCaptureCalls), ["A", "A"]);
  assert.deepEqual(f.errors, []);
});

test("mobile compact menu opens prototype controls without horizontal overflow", async (t) => {
  const f = await fixture(t, { mobile: true });
  await f.open();
  await f.linkToDetail();
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth), 390);
  await f.page.locator("#prototype-editor-close").click();
  assert.equal(
    await f.page.locator("#prototype-editor-dialog").evaluate((dialog) => dialog.open),
    false,
  );
  assert.deepEqual(f.errors, []);
});
