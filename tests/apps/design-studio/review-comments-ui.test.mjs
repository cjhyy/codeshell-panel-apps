import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { REVIEW_COMMENTS_FORMAT } from "../../../apps/design-studio/app/review-comments.mjs";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const path = "designs/product.codesign.json",
  commentsPath = "designs/product.comments.json";
const date = "2026-10-16T08:00:00.000Z";
const hash = (value) => createHash("sha256").update(value).digest("hex");
function seed(text, id = "seed") {
  return JSON.stringify({
    format: REVIEW_COMMENTS_FORMAT,
    version: 1,
    designPath: path,
    threads: [
      {
        id,
        text,
        author: "Reviewer",
        createdAt: date,
        updatedAt: date,
        pageId: "page-1",
        nodeId: "card",
        targetName: "Card",
        status: "open",
        replies: [],
      },
    ],
  });
}

async function fixture(
  t,
  { mobile = false, preview = false, persistentHost = false, agent = false } = {},
) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: mobile ? 390 : 1280, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const files = new Map(),
    calls = [],
    errors = [],
    pauses = new Map(),
    readErrors = new Map(),
    records = new Map();
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://panel.test") return route.abort();
    if (url.pathname === "/review-harness.html")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html>
      <html lang="zh"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./style.css"></head>
      <body><header class="topbar"><div class="top-actions"><button id="portable-backup-open">备份</button>
      <details id="compact-actions"><summary>更多</summary><div class="compact-actions-list"></div></details></div></header>
      <script type="module">
        import { mountReviewComments } from './review-comments-ui.mjs';
        import './toolbar-menu.mjs';
        window.reviewUI = mountReviewComments({ getSnapshot: () => window.reviewSnapshot,
          call: window.reviewCall, focusTarget: async target => {
            window.reviewFocused.push(target); return !window.reviewMissingTarget;
          }, notify: text => window.reviewNotices.push(text),
          canSubmitThread: () => window.reviewAgentAvailable,
          submitThread: async (thread, {snapshot, check}) => {
            check(); window.reviewHandoffEntered = true;
            if (window.reviewDelayHandoff) await new Promise(resolve => { window.reviewReleaseHandoff = resolve; });
            check(); window.reviewAgentSubmissions.push({thread, snapshot});
          } });
        window.switchReviewProject = target => {
          window.reviewUI.contextChanged();
          window.reviewSnapshot.context.projectScope.projectId = target;
          window.reviewSnapshot.workspaceEpoch++;
          window.reviewSnapshot.selectedNode = { id: 'card', name: target + ' Card' };
          window.reviewUI.update();
        };
        window.switchReviewDocument = path => {
          window.reviewSnapshot.documentEpoch++; window.reviewSnapshot.path = path;
          window.reviewUI.update();
        };
      </script></body></html>`,
      });
    const file = resolve(root, `.${url.pathname}`);
    if (!file.startsWith(root + sep)) return route.abort();
    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: {
          ".html": "text/html",
          ".mjs": "text/javascript",
          ".js": "text/javascript",
          ".css": "text/css",
        }[extname(file)],
      });
    } catch {
      await route.fulfill({ status: 404, body: "missing" });
    }
  });
  await page.exposeFunction("reviewHostBridge", async (scope, method, params) => {
    calls.push({ scope, method, ...structuredClone(params) });
    const key = `${scope}:${params.path}`;
    if (readErrors.has(scope) && method === "workspace.readText")
      throw Error(readErrors.get(scope));
    let result;
    if (method.startsWith("storage.")) {
      const recordKey = `${scope}:${params.key}`;
      const snapshot = () =>
        records.has(recordKey)
          ? {
              exists: true,
              value: structuredClone(records.get(recordKey)),
              revision: `sha256:${hash(JSON.stringify(records.get(recordKey)))}`,
            }
          : { exists: false, value: null, revision: null };
      if (method === "storage.getSnapshot") result = snapshot();
      else if (method === "storage.compareAndSet") {
        if (params.expectedRevision !== snapshot().revision)
          result = { updated: false, snapshot: snapshot() };
        else {
          records.set(recordKey, structuredClone(params.value));
          result = { updated: true, snapshot: snapshot() };
        }
      } else throw Error(`Unsupported ${method}`);
    } else if (method === "workspace.readText") {
      const content = files.get(key);
      if (content === undefined) throw Error("file missing");
      result = { path: params.path, content, modifiedAt: 1, revision: hash(content) };
    } else if (method === "workspace.writeText") {
      const previous = files.get(key);
      if (params.expectedModifiedAt === null && previous !== undefined) throw Error("file exists");
      if (params.expectedRevision && params.expectedRevision !== hash(previous))
        throw Error("file changed since read");
      files.set(key, params.content);
      result = { modifiedAt: 1, revision: hash(params.content) };
    } else throw Error(`Unsupported ${method}`);
    const pauseKey = `${scope}:${method}`,
      pause = pauses.get(pauseKey);
    if (pause) {
      pauses.delete(pauseKey);
      pause.enter();
      await pause.gate;
    }
    return result;
  });
  await page.addInitScript(
    ({ path, preview, persistentHost, agent }) => {
      window.reviewSnapshot = {
        context: {
          cwd: "/workspace",
          sessionId: "same-session",
          trusted: true,
          projectScope: { version: 1, environmentId: "cloud", projectId: "A", rootId: "root" },
          ...(persistentHost
            ? { availableMethods: ["storage.getSnapshot", "storage.compareAndSet"] }
            : {}),
        },
        workspaceEpoch: 1,
        documentEpoch: 1,
        path,
        ready: true,
        pageId: "page-1",
        pageName: "Home",
        selectedNode: { id: "card", name: "A Card" },
      };
      window.reviewFocused = [];
      window.reviewNotices = [];
      window.reviewAgentAvailable = agent;
      window.reviewAgentSubmissions = [];
      window.reviewCall = (method, params) => {
        if (!preview)
          return window.reviewHostBridge(
            window.reviewSnapshot.context.projectScope.projectId,
            method,
            params,
          );
        const key = `codeshell-design-studio:file:${params.path}`,
          mtimeKey = `codeshell-design-studio:mtime:${params.path}`;
        const old = localStorage.getItem(key),
          modifiedAt = Number(localStorage.getItem(mtimeKey));
        if (method === "workspace.readText") {
          if (old === null) return Promise.reject(Error("file not found"));
          return Promise.resolve({ content: old, modifiedAt, revision: `preview:${modifiedAt}` });
        }
        const oldRevision = old === null ? null : `preview:${modifiedAt}`;
        if (
          (params.expectedRevision !== undefined && params.expectedRevision !== oldRevision) ||
          (params.expectedModifiedAt === null && old !== null)
        )
          return Promise.reject(Error("file changed since read"));
        const next = Date.now();
        localStorage.setItem(key, params.content);
        localStorage.setItem(mtimeKey, String(next));
        return Promise.resolve({ modifiedAt: next, revision: `preview:${next}` });
      };
      if (persistentHost) window.codeshellPanel = { call: window.reviewCall };
    },
    { path, preview, persistentHost, agent },
  );
  await page.goto("https://panel.test/review-harness.html");
  await page.waitForFunction(() => Boolean(window.reviewUI));
  return {
    page,
    files,
    calls,
    errors,
    readErrors,
    records,
    async open() {
      await page.locator("#compact-actions summary").click();
      await page.locator("#open-review-comments").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#review-comments-dialog").getAttribute("aria-busy") === "false",
      );
    },
    pause(method, scope = "A") {
      let enter, release;
      const entered = new Promise((resolve) => {
          enter = resolve;
        }),
        gate = new Promise((resolve) => {
          release = resolve;
        });
      pauses.set(`${scope}:${method}`, { enter, gate });
      t.after(release);
      return { entered, release };
    },
  };
}

test("review UI persists a layer discussion, safe text, reply and resolve lifecycle across reload", async (t) => {
  const f = await fixture(t),
    { page } = f;
  await f.open();
  const unsafe = '<img src=x onerror="window.commentInjected=true"> Please check this card';
  await page.locator("#review-comments-text").fill(unsafe);
  await page.locator("#review-comments-submit").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".review-comment-thread").length === 1,
  );
  assert.equal(await page.locator(".review-comment-text").textContent(), unsafe);
  assert.equal(await page.locator(".review-comment-thread img").count(), 0);
  const created = JSON.parse(f.files.get(`A:${commentsPath}`)).threads[0];
  assert.equal(created.pageId, "page-1");
  assert.equal(created.nodeId, "card");
  await page.locator("[data-reply-thread]").fill("Adjusted the spacing");
  await page.locator(".review-comment-reply-form button[type=submit]").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".review-comment-message").length === 2,
  );
  await page.locator("[data-resolve-thread]").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".review-comment-thread").length === 0,
  );
  await page.locator("#review-comments-filter").selectOption("resolved");
  assert.equal(await page.locator(".review-comment-badge").textContent(), "已解决");
  await page.reload();
  await page.waitForFunction(() => Boolean(window.reviewUI));
  await f.open();
  await page.locator("#review-comments-filter").selectOption("all");
  assert.equal(
    await page.locator(".review-comment-reply .review-comment-text").textContent(),
    "Adjusted the spacing",
  );
  await page.locator("[data-resolve-thread]").click();
  await page.waitForFunction(
    () => document.querySelector(".review-comment-badge")?.textContent === "待解决",
  );
  await page.locator("[data-review-target]").click();
  assert.deepEqual(await page.evaluate(() => window.reviewFocused), [
    { pageId: "page-1", nodeId: "card" },
  ]);
  assert.equal(await page.locator("#review-comments-dialog").isVisible(), false);
  assert.deepEqual(f.errors, []);
});

test("mobile comments support a page target and report a deleted target without losing the discussion", async (t) => {
  const f = await fixture(t, { mobile: true }),
    { page } = f;
  await f.open();
  await page.locator("#review-comments-use-page").click();
  await page.locator("#review-comments-text").fill("Review this entire page");
  await page.locator("#review-comments-submit").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".review-comment-thread").length === 1,
  );
  assert.equal(JSON.parse(f.files.get(`A:${commentsPath}`)).threads[0].nodeId, null);
  await page.evaluate(() => {
    window.reviewMissingTarget = true;
  });
  await page.locator("[data-review-target]").click();
  await page.waitForFunction(() =>
    document.querySelector("#review-comments-status").textContent.includes("已移除"),
  );
  assert.equal(await page.locator(".review-comment-thread").count(), 1);
  const bounds = await page.locator("#review-comments-dialog").boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.deepEqual(f.errors, []);
});

test("failed saves retain text; a delayed read cannot save an old draft into a new project at the same cwd", async (t) => {
  const f = await fixture(t),
    { page } = f;
  f.files.set(`A:${commentsPath}`, seed("A discussion"));
  f.files.set(`B:${commentsPath}`, seed("B discussion"));
  await f.open();
  await page.locator("#review-comments-text").fill("A draft survives");
  f.readErrors.set("A", "permission denied");
  await page.locator("#review-comments-submit").click();
  await page.waitForFunction(() =>
    document.querySelector("#review-comments-status").textContent.includes("草稿已保留"),
  );
  assert.equal(await page.locator("#review-comments-text").inputValue(), "A draft survives");
  assert.equal(f.calls.filter((item) => item.method === "workspace.writeText").length, 0);
  f.readErrors.delete("A");
  const pause = f.pause("workspace.readText");
  await page.locator("#review-comments-submit").click();
  await pause.entered;
  await page.evaluate(() => window.switchReviewProject("B"));
  await page.waitForFunction(
    () => document.querySelector(".review-comment-text")?.textContent === "B discussion",
  );
  assert.equal(await page.locator("#review-comments-text").inputValue(), "");
  pause.release();
  await page.evaluate(() => window.switchReviewProject("A"));
  await page.waitForFunction(
    () => document.querySelector(".review-comment-text")?.textContent === "A discussion",
  );
  assert.equal(await page.locator("#review-comments-text").inputValue(), "A draft survives");
  await page.locator("#review-comments-submit").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".review-comment-thread").length === 2,
  );
  assert(
    f.calls
      .filter((item) => item.method === "workspace.writeText")
      .every((item) => item.scope === "A"),
  );
  assert.equal(JSON.parse(f.files.get(`B:${commentsPath}`)).threads.length, 1);
  assert.deepEqual(f.errors, []);
});

test("a late refresh or write result cannot replace the next project's threads or draft", async (t) => {
  const f = await fixture(t),
    { page } = f;
  f.files.set(`A:${commentsPath}`, seed("A discussion"));
  f.files.set(`B:${commentsPath}`, seed("B discussion"));
  await f.open();
  const readPause = f.pause("workspace.readText");
  await page.locator("#review-comments-refresh").click();
  await readPause.entered;
  await page.evaluate(() => window.switchReviewProject("B"));
  await page.waitForFunction(
    () => document.querySelector(".review-comment-text")?.textContent === "B discussion",
  );
  readPause.release();
  await page.evaluate(() => window.switchReviewProject("A"));
  await page.waitForFunction(
    () => document.querySelector(".review-comment-text")?.textContent === "A discussion",
  );
  await page.locator("#review-comments-text").fill("A committed feedback");
  const writePause = f.pause("workspace.writeText");
  await page.locator("#review-comments-submit").click();
  await writePause.entered;
  await page.evaluate(() => window.switchReviewProject("B"));
  await page.waitForFunction(
    () => document.querySelector(".review-comment-text")?.textContent === "B discussion",
  );
  await page.locator("#review-comments-text").fill("B draft remains");
  writePause.release();
  await page.waitForFunction(
    () => document.querySelector("#review-comments-dialog").getAttribute("aria-busy") === "false",
  );
  assert.equal(await page.locator("#review-comments-text").inputValue(), "B draft remains");
  assert.equal(await page.locator(".review-comment-text").textContent(), "B discussion");
  assert.equal(JSON.parse(f.files.get(`A:${commentsPath}`)).threads.length, 2);
  assert.equal(JSON.parse(f.files.get(`B:${commentsPath}`)).threads.length, 1);
  assert.deepEqual(f.errors, []);
});

test("document path changes retain separate drafts and imported text keeps the selected stable target", async (t) => {
  const f = await fixture(t),
    { page } = f;
  await page.evaluate(() =>
    window.reviewUI.open({ text: "From layer action", pageId: "page-1", nodeId: "card" }),
  );
  await page.waitForFunction(
    () => document.querySelector("#review-comments-dialog").getAttribute("aria-busy") === "false",
  );
  await page.evaluate(() => window.switchReviewDocument("designs/second.codesign.json"));
  await page.waitForFunction(
    () => document.querySelector("#review-comments-dialog").getAttribute("aria-busy") === "false",
  );
  await page.locator("#review-comments-text").fill("Second design draft");
  await page.evaluate((path) => window.switchReviewDocument(path), path);
  await page.waitForFunction(
    () => document.querySelector("#review-comments-dialog").getAttribute("aria-busy") === "false",
  );
  assert.equal(await page.locator("#review-comments-text").inputValue(), "From layer action");
  assert.match(await page.locator("#review-comments-target").textContent(), /card/);
  await page.locator("#review-comments-submit").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".review-comment-thread").length === 1,
  );
  assert.equal(JSON.parse(f.files.get(`A:${commentsPath}`)).threads[0].nodeId, "card");
  assert.equal(f.files.has("A:designs/second.comments.json"), false);
  assert.deepEqual(f.errors, []);
});

test("browser preview uses the same local workspace keys and survives reopening", async (t) => {
  const f = await fixture(t, { preview: true }),
    { page } = f;
  await f.open();
  await page.locator("#review-comments-text").fill("Browser preview discussion");
  await page.locator("#review-comments-submit").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".review-comment-thread").length === 1,
  );
  assert.equal(
    await page.evaluate(
      async (path) => { const {createBrowserStore}=await import("/browser-store.mjs");
        return JSON.parse((await createBrowserStore().call("workspace.readText",{path})).content).threads[0].text; },
      commentsPath,
    ),
    "Browser preview discussion",
  );
  await page.reload();
  await page.waitForFunction(() => Boolean(window.reviewUI));
  await f.open();
  assert.equal(
    await page.locator(".review-comment-text").textContent(),
    "Browser preview discussion",
  );
  assert.deepEqual(f.errors, []);
});

test("Host CAS drafts survive reload and a concurrent draft blocks autosave without replacement", async (t) => {
  const f = await fixture(t, { persistentHost: true }),
    { page } = f;
  await f.open();
  await page.waitForFunction(() =>
    document.querySelector("#review-comments-draft-state").textContent.includes("恢复"),
  );
  await page.locator("#review-comments-text").fill("Persistent unfinished comment");
  await page.evaluate(() => window.reviewUI.flushDraft());
  assert.equal([...f.records.values()][0].text, "Persistent unfinished comment");
  await page.reload();
  await page.waitForFunction(() => Boolean(window.reviewUI));
  await f.open();
  await page.waitForFunction(
    () => document.querySelector("#review-comments-text").value === "Persistent unfinished comment",
  );
  const [key, record] = [...f.records.entries()][0];
  f.records.set(key, { ...record, text: "Other window's draft" });
  await page.locator("#review-comments-text").fill("My concurrent change");
  await page.evaluate(() => window.reviewUI.flushDraft());
  await page.waitForFunction(() =>
    document.querySelector("#review-comments-draft-state").textContent.includes("自动保存已停止"),
  );
  assert.equal(f.records.get(key).text, "Other window's draft");
  assert.equal(await page.locator("#review-comments-text").inputValue(), "My concurrent change");
  assert.deepEqual(f.errors, []);
});
test("late Host draft loading cannot replace the new project input or persist into its scope", async (t) => {
  const f = await fixture(t, { persistentHost: true }),
    { page } = f;
  await f.open();
  await page.locator("#review-comments-text").fill("A draft");
  await page.evaluate(() => window.reviewUI.flushDraft());
  const pause = f.pause("storage.getSnapshot");
  await page.reload();
  await page.waitForFunction(() => Boolean(window.reviewUI));
  await f.open();
  await pause.entered;
  await page.evaluate(() => window.switchReviewProject("B"));
  await page.waitForFunction(
    () => document.querySelector("#review-comments-dialog").getAttribute("aria-busy") === "false",
  );
  await page.locator("#review-comments-text").fill("B draft");
  pause.release();
  await page.evaluate(() => window.reviewUI.flushDraft());
  assert.equal(await page.locator("#review-comments-text").inputValue(), "B draft");
  assert(
    [...f.records.entries()]
      .filter(([key]) => key.startsWith("B:"))
      .every(([, value]) => value.text !== "A draft"),
  );
  assert.deepEqual(f.errors, []);
});
test("Agent handoff uses the latest replies and cancels dispatch when the project changes during preparation", async (t) => {
  const f = await fixture(t, { agent: true }),
    { page } = f;
  f.files.set(`A:${commentsPath}`, seed("Handle this question"));
  f.files.set(`B:${commentsPath}`, seed("B question"));
  await f.open();
  const updated = JSON.parse(f.files.get(`A:${commentsPath}`));
  updated.threads[0].replies.push({
    id: "recent",
    text: "Latest clarification",
    author: "Reviewer",
    createdAt: date,
  });
  f.files.set(`A:${commentsPath}`, JSON.stringify(updated));
  await page.locator("[data-agent-thread]").click();
  await page.waitForFunction(() => window.reviewAgentSubmissions.length === 1);
  assert.equal(
    await page.evaluate(() => window.reviewAgentSubmissions[0].thread.replies[0].text),
    "Latest clarification",
  );
  await page.evaluate(() => {
    window.reviewDelayHandoff = true;
    window.reviewHandoffEntered = false;
  });
  await page.locator("[data-agent-thread]").click();
  await page.waitForFunction(() => window.reviewHandoffEntered);
  await page.evaluate(() => window.switchReviewProject("B"));
  await page.waitForFunction(
    () => document.querySelector(".review-comment-text")?.textContent === "B question",
  );
  await page.evaluate(() => window.reviewReleaseHandoff());
  assert.equal(await page.evaluate(() => window.reviewAgentSubmissions.length), 1);
  assert.equal(await page.locator(".review-comment-text").textContent(), "B question");
  assert.deepEqual(f.errors, []);
});
