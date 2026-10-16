import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import { parseFigmaBinding } from "../../../apps/design-studio/app/figma-binding.mjs";
import { planPortableDesign } from "../../../apps/design-studio/app/portable-backup.mjs";
import {
  createDesignSidecarPlan,
  readDesignSidecar,
  DESIGN_SIDECAR_PART_BYTES,
} from "../../../apps/design-studio/app/design-sidecar.mjs";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const manifest = JSON.parse(
  await readFile(
    new URL("../../../apps/design-studio/.codeshell-panel/panel.json", import.meta.url),
  ),
);
const designPath = "designs/exchange.codesign.json",
  inputPath = "designs/source.figma.json";
const commentsPath = "designs/exchange.comments.json",
  prototypePath = "designs/exchange.prototype.json";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const revision = (value) =>
  `sha256:${hash(typeof value === "string" ? value : JSON.stringify(value))}`;
const pixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function initialDocument(scope) {
  return serializeDesignDocument(
    normalizeDesignDocument({
      format: "codeshell.design",
      version: 3,
      name: `${scope} original`,
      canvas: { width: 600, height: 400, background: "#ffffff" },
      activePageId: "page-1",
      tokens: { colors: [] },
      resources: [],
      pages: [
        {
          id: "page-1",
          name: "Home",
          children: [
            {
              id: "heading",
              type: "text",
              name: "Heading",
              x: 30,
              y: 30,
              width: 300,
              height: 50,
              fill: "#111111",
              stroke: "transparent",
              strokeWidth: 0,
              opacity: 1,
              rotation: 0,
              cornerRadius: 0,
              visible: true,
              locked: false,
              text: `${scope} original heading`,
              fontSize: 24,
              fontWeight: 600,
              lineHeight: 1.2,
              textAlign: "left",
            },
          ],
        },
        { id: "page-2", name: "Details", children: [] },
      ],
    }),
  );
}
function figmaSource({ image = false } = {}) {
  return {
    name: "Imported product",
    fileKey: "fixture-file",
    ...(image ? { assets: { photo: { mime: "image/png", base64: pixel } } } : {}),
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          name: "Landing",
          children: [
            {
              id: "1:1",
              type: "FRAME",
              name: "Card",
              absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 400 },
              fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
              children: [
                {
                  id: "1:2",
                  type: "TEXT",
                  name: "Imported heading",
                  characters: "Original Figma heading",
                  absoluteBoundingBox: { x: 30, y: 30, width: 350, height: 50 },
                  fills: [{ type: "SOLID", color: { r: 0.05, g: 0.05, b: 0.05 } }],
                  style: {
                    fontFamily: "Inter",
                    fontSize: 24,
                    fontWeight: 600,
                    textAlignHorizontal: "LEFT",
                  },
                  pluginData: { preserved: "opaque Figma metadata" },
                },
                ...(image
                  ? [
                      {
                        id: "1:3",
                        type: "RECTANGLE",
                        name: "Imported image",
                        absoluteBoundingBox: { x: 30, y: 120, width: 80, height: 60 },
                        fills: [{ type: "IMAGE", imageRef: "photo", scaleMode: "FIT" }],
                      },
                    ]
                  : []),
              ],
            },
          ],
        },
        { id: "0:2", type: "CANVAS", name: "Details", children: [] },
      ],
    },
  };
}

async function fixture(t, { image = false } = {}) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1500, height: 960 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const files = new Map(),
    records = new Map(),
    calls = [],
    errors = [],
    pauses = new Map();
  for (const scope of ["A", "B"]) {
    files.set(`${scope}:${designPath}`, initialDocument(scope));
    files.set(`${scope}:${inputPath}`, JSON.stringify(figmaSource({ image })));
  }
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url()),
      file = resolve(root, `.${url.pathname}`);
    if (url.origin !== "https://panel.test" || !file.startsWith(root + sep)) return route.abort();
    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: {
          ".html": "text/html",
          ".mjs": "text/javascript",
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
        }[extname(file)],
      });
    } catch {
      await route.fulfill({ status: 404, body: "missing" });
    }
  });
  await page.exposeFunction("exchangeHostBridge", async (scope, method, params = {}) => {
    calls.push({ scope, method, ...structuredClone(params) });
    const key = `${scope}:${params.key}`,
      fileKey = `${scope}:${params.path}`;
    const storageSnapshot = () =>
      records.has(key)
        ? {
            exists: true,
            value: structuredClone(records.get(key)),
            revision: revision(records.get(key)),
          }
        : { exists: false, value: null, revision: null };
    let result;
    if (method === "workspace.info")
      result = { root: "/workspace", name: scope, trusted: true, gitBranch: "test" };
    else if (method === "workspace.list") result = { entries: [], truncated: false };
    else if (method === "workspace.readText") {
      if (!files.has(fileKey))
        throw Error(`ENOENT: no such file or directory, open '${params.path}'`);
      const content = files.get(fileKey);
      result = { path: params.path, content, modifiedAt: 1, revision: revision(content) };
    } else if (method === "workspace.writeText") {
      const previous = files.get(fileKey);
      if (params.expectedModifiedAt === null && previous !== undefined) throw Error("file exists");
      if (
        params.expectedRevision !== undefined &&
        params.expectedRevision !== (previous === undefined ? null : revision(previous))
      )
        throw Error("workspace file changed since it was opened");
      files.set(fileKey, params.content);
      result = { path: params.path, modifiedAt: 1, revision: revision(params.content) };
    } else if (method === "storage.get")
      result = params.key.startsWith("lastPath.")
        ? { workspaceRoot: "/workspace", path: designPath }
        : (records.get(key) ?? null);
    else if (method === "storage.set") {
      records.set(key, structuredClone(params.value));
      result = true;
    } else if (method === "storage.delete") {
      records.delete(key);
      result = true;
    } else if (method === "storage.getSnapshot") result = storageSnapshot();
    else if (method === "storage.compareAndSet") {
      if (params.expectedRevision !== storageSnapshot().revision)
        result = { updated: false, snapshot: storageSnapshot() };
      else {
        if (params.remove) records.delete(key);
        else records.set(key, structuredClone(params.value));
        result = { updated: true, snapshot: storageSnapshot() };
      }
    } else if (method === "agent.submitPrompt") result = { accepted: true };
    else throw Error(`Unsupported ${method}`);
    const pause = pauses.get(`${scope}:${method}`);
    if (pause) {
      pauses.delete(`${scope}:${method}`);
      pause.enter();
      await pause.gate;
    }
    return result;
  });
  await page.addInitScript(
    ({ permissions }) => {
      let scope = "A",
        listener;
      const context = {
        trusted: true,
        visible: true,
        busy: false,
        ...(permissions.includes("context.workspace") ? { cwd: "/workspace" } : {}),
        ...(permissions.includes("context.session") ? { sessionId: "same-session" } : {}),
        projectScope: { version: 1, environmentId: "test", projectId: "A", rootId: "same-root" },
        availableMethods: [
          "workspace.info",
          "workspace.list",
          "workspace.readText",
          "workspace.writeText",
          "storage.get",
          "storage.set",
          "storage.delete",
          "storage.getSnapshot",
          "storage.compareAndSet",
          "agent.submitPrompt",
        ],
      };
      window.tools = {};
      window.codeshellPanel = {
        getContext: async () => structuredClone(context),
        on(name, callback) {
          if (name === "context.changed") listener = callback;
        },
        call: (method, params) => window.exchangeHostBridge(scope, method, params),
        registerTool(name, callback) {
          window.tools[name] = callback;
        },
      };
      window.switchExchangeProject = (target) => {
        scope = target;
        context.projectScope = { ...context.projectScope, projectId: target };
        listener?.(structuredClone(context));
      };
    },
    { permissions: manifest.permissions },
  );
  async function loaded() {
    await page.waitForFunction(
      () => !document.querySelector(".workspace").inert && Boolean(window.tools.exchange_figma),
    );
    return page.evaluate(() => window.tools.get_design_metadata({}));
  }
  await page.goto("https://panel.test/index.html");
  await loaded();
  const tool = (name, args = {}) =>
    page.evaluate(({ name, args }) => window.tools[name](args), { name, args });
  return {
    page,
    files,
    records,
    calls,
    errors,
    tool,
    metadata: () => tool("get_design_metadata"),
    async reload() {
      await page.reload();
      return loaded();
    },
    async import() {
      const metadata = await tool("get_design_metadata");
      return tool("exchange_figma", {
        action: "import",
        path: inputPath,
        save: true,
        expected_state_revision: metadata.stateRevision,
      });
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

test("declared exchange tools import, save, reopen, edit and export a source-bound Figma patch", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    await f.page.evaluate(() => Object.keys(window.tools).sort()),
    manifest.agent.tools.map((tool) => tool.name).sort(),
  );
  const imported = await f.import();
  assert.equal(imported.saved, true);
  let metadata = await f.metadata();
  assert.equal(metadata.pages.length, 2);
  assert.equal(metadata.name, "Imported product");
  assert.equal(imported.stateRevision, metadata.stateRevision);
  assert.equal(imported.revision, metadata.revision);
  const heading = metadata.layers.find((node) => node.name === "Imported heading");
  assert(heading);
  assert.match(f.files.get(`A:${designPath}`), /Original Figma heading/);
  await f.reload();
  metadata = await f.metadata();
  await f.tool("use_design", {
    expected_state_revision: metadata.stateRevision,
    save: true,
    operations: [
      { op: "update_node", node_id: heading.id, changes: { text: "Edited in Design Studio" } },
    ],
  });
  await f.reload();
  metadata = await f.metadata();
  const receipt = await f.tool("exchange_figma", {
    action: "export",
    path: "designs/out.figma-transfer.json",
    expected_state_revision: metadata.stateRevision,
  });
  const output = JSON.parse(f.files.get("A:designs/out.figma-transfer.json"));
  assert.equal(receipt.patch.updates, 1);
  const update = output.patch.operations.find((operation) => operation.sourceId === "1:2");
  assert.equal(update.after.text, "Edited in Design Studio");
  assert.equal(update.before.pluginData.preserved, "opaque Figma metadata");
  await assert.rejects(
    f.tool("exchange_figma", {
      action: "export",
      path: designPath,
      expected_state_revision: metadata.stateRevision,
    }),
    /不能覆盖/,
  );
  assert.deepEqual(f.errors, []);
});

test("comment tools persist create, paginated replies and status, rejecting stale design revisions", async (t) => {
  const f = await fixture(t);
  let metadata = await f.metadata();
  await f.tool("update_design_comments", {
    action: "create",
    page_id: "page-1",
    node_id: "heading",
    text: "Review the heading",
    expected_state_revision: metadata.stateRevision,
  });
  const all = await f.tool("get_design_comments", { status: "all" });
  assert.equal(all.total, 1);
  const threadId = all.threads[0].id;
  for (let index = 0; index < 7; index++)
    await f.tool("update_design_comments", {
      action: "reply",
      thread_id: threadId,
      text: `Reply ${index}`,
      expected_state_revision: (await f.metadata()).stateRevision,
    });
  const first = await f.tool("get_design_comments", { thread_id: threadId });
  assert.equal(first.replyCount, 7);
  assert.equal(first.thread.replies.length, 5);
  assert.equal(first.nextReplyOffset, 5);
  const second = await f.tool("get_design_comments", { thread_id: threadId, reply_offset: 5 });
  assert.equal(second.thread.replies.length, 2);
  metadata = await f.metadata();
  await f.tool("use_design", {
    save: false,
    expected_state_revision: metadata.stateRevision,
    operations: [
      { op: "update_node", node_id: "heading", changes: { text: "New design revision" } },
    ],
  });
  const before = f.files.get(`A:${commentsPath}`);
  await assert.rejects(
    f.tool("update_design_comments", {
      action: "status",
      thread_id: threadId,
      resolved: true,
      expected_state_revision: metadata.stateRevision,
    }),
    /状态已变化/,
  );
  assert.equal(f.files.get(`A:${commentsPath}`), before);
  await f.tool("update_design_comments", {
    action: "status",
    thread_id: threadId,
    resolved: true,
    expected_state_revision: (await f.metadata()).stateRevision,
  });
  await f.reload();
  const resolved = await f.tool("get_design_comments", { status: "resolved" });
  assert.equal(resolved.threads[0].id, threadId);
  assert.equal(resolved.threads[0].replyCount, 7);
  assert.deepEqual(f.errors, []);
});

test("persistent thread handoff saves current edits before submitting the stable thread to Agent", async (t) => {
  const f = await fixture(t);
  let metadata = await f.metadata();
  await f.tool("update_design_comments", {
    action: "create",
    page_id: "page-1",
    node_id: "heading",
    text: "Make title clearer",
    expected_state_revision: metadata.stateRevision,
  });
  metadata = await f.metadata();
  await f.tool("use_design", {
    save: false,
    expected_state_revision: metadata.stateRevision,
    operations: [
      { op: "update_node", node_id: "heading", changes: { text: "Unsaved title before handoff" } },
    ],
  });
  const start = f.calls.length;
  await f.page.locator("#open-review-comments").click();
  await f.page.locator("[data-agent-thread]").click();
  await f.page.waitForFunction(() =>
    document.querySelector("#review-comments-status").textContent.includes("已将讨论交给"),
  );
  const recent = f.calls.slice(start),
    submit = recent.find((call) => call.method === "agent.submitPrompt");
  assert(submit);
  assert(
    recent.findIndex((call) => call.method === "workspace.writeText" && call.path === designPath) <
      recent.indexOf(submit),
  );
  assert.match(f.files.get(`A:${designPath}`), /Unsaved title before handoff/);
  assert.match(submit.prompt, /Make title clearer/);
  assert.match(submit.prompt, /heading/);
  await f.page.getByRole("button", { name: "关闭设计讨论", exact: true }).click();
  metadata = await f.metadata();
  await f.tool("use_design", {
    save: false,
    expected_state_revision: metadata.stateRevision,
    operations: [
      { op: "update_node", node_id: "heading", changes: { text: "A late handoff edit" } },
    ],
  });
  await f.page.locator("#open-review-comments").click();
  const pause = f.pause("workspace.writeText");
  await f.page.locator("[data-agent-thread]").click();
  await pause.entered;
  const count = f.calls.filter((call) => call.method === "agent.submitPrompt").length;
  await f.page.evaluate(() => window.switchExchangeProject("B"));
  pause.release();
  await f.page.waitForFunction(
    () =>
      !document.querySelector(".workspace").inert &&
      document.querySelector('[data-text-node-id="heading"]')?.textContent === "B original heading",
  );
  await f.page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(f.calls.filter((call) => call.method === "agent.submitPrompt").length, count);
  assert.equal(f.files.get(`B:${designPath}`), initialDocument("B"));
  assert.deepEqual(f.errors, []);
});

test("image source bindings survive reopen and complete backup keeps original source, resources and comments", async (t) => {
  const f = await fixture(t, { image: true });
  await f.import();
  await f.reload();
  const metadata = await f.metadata();
  assert.equal(metadata.resources.length, 1);
  assert.equal(await f.page.locator('#scene image[href^="data:image/png;base64,"]').count(), 1);
  const heading = metadata.layers.find((node) => node.type === "text");
  await f.tool("update_design_comments", {
    action: "create",
    page_id: metadata.activePageId,
    node_id: heading.id,
    text: "Keep photo and source",
    expected_state_revision: metadata.stateRevision,
  });
  await f.page.locator("#portable-backup-open").click();
  const pending = f.page.waitForEvent("download");
  await f.page.locator("#portable-backup-export").click();
  const text = await readFile(await (await pending).path(), "utf8"),
    backup = JSON.parse(text);
  assert.equal(backup.version, 2);
  assert.equal(backup.resources[0].base64, pixel);
  assert.equal(backup.counts.threads, 1);
  const attachment = backup.attachments.find((entry) => entry.kind === "figma-binding");
  assert(attachment);
  const binding = parseFigmaBinding(attachment.content);
  assert.equal(binding.source.assets.photo.base64, pixel);
  assert.equal(binding.mapping.find((entry) => entry.sourceId === "1:2").designId, heading.id);
  const plan = await planPortableDesign(text, {
    sha256: async (text) => hash(text),
    sha256Bytes: async (bytes) => hash(bytes),
  });
  assert.equal(plan.resourceCount, 1);
  assert.equal(plan.attachmentCounts.threads, 1);
  assert.deepEqual(f.errors, []);
});

test("generate_frontend emits a working multipage prototype with saved review comments", async (t) => {
  const f = await fixture(t);
  const metadata = await f.metadata();
  f.files.set(
    `A:${prototypePath}`,
    JSON.stringify({
      format: "codeshell.design.prototype",
      version: 1,
      startPageId: "page-1",
      links: [
        {
          id: "next",
          pageId: "page-1",
          nodeId: "heading",
          event: "click",
          action: "navigate",
          targetPageId: "page-2",
        },
      ],
    }),
  );
  await f.tool("update_design_comments", {
    action: "create",
    node_id: "heading",
    text: "Prototype review question",
    expected_state_revision: metadata.stateRevision,
  });
  const receipt = await f.tool("generate_frontend", {
    path: "designs/demo.html",
    prototype: true,
    include_comments: true,
    expected_state_revision: (await f.metadata()).stateRevision,
  });
  assert.equal(receipt.prototype, true);
  assert.equal(receipt.pageCount, 2);
  const html = f.files.get("A:designs/demo.html");
  assert.match(html, /Prototype review question/);
  const preview = await f.page.context().newPage();
  await preview.setContent(html);
  assert.equal(
    await preview.locator(".cs-page:not([hidden])").getAttribute("data-codeshell-page-id"),
    "page-1",
  );
  await preview.locator("#prototype-review-toggle").check();
  await preview.locator(".cs-prototype-review-pin").click();
  assert.match(
    await preview.locator("#prototype-review-text").textContent(),
    /Prototype review question/,
  );
  await preview.locator("#prototype-review-close").click();
  await preview.locator('[data-prototype-link="next"]').click();
  assert.equal(
    await preview.locator(".cs-page:not([hidden])").getAttribute("data-codeshell-page-id"),
    "page-2",
  );
  assert.deepEqual(f.errors, []);
});

test("a delayed exchange import cannot mutate or save the next same-path project", async (t) => {
  const f = await fixture(t),
    metadata = await f.metadata(),
    pause = f.pause("workspace.readText");
  await f.page.evaluate(
    ({ path, state }) => {
      window.pendingExchange = window.tools
        .exchange_figma({ action: "import", path, expected_state_revision: state })
        .then(
          (result) => ({ result }),
          (error) => ({ error: error.message }),
        );
    },
    { path: inputPath, state: metadata.stateRevision },
  );
  await pause.entered;
  const start = f.calls.length;
  await f.page.evaluate(() => window.switchExchangeProject("B"));
  pause.release();
  const result = await f.page.evaluate(() => window.pendingExchange);
  assert.match(result.error, /工作区|切换/);
  await f.page.waitForFunction(
    () =>
      !document.querySelector(".workspace").inert &&
      document.querySelector('[data-text-node-id="heading"]')?.textContent === "B original heading",
  );
  assert.equal((await f.metadata()).name, "B original");
  assert.equal(
    f.calls
      .slice(start)
      .filter((call) => call.scope === "B" && call.method === "workspace.writeText").length,
    0,
  );
  assert.equal(f.files.get(`B:${designPath}`), initialDocument("B"));
  assert.deepEqual(f.errors, []);
});

test("undo and redo of saved nested Figma imports restore the matching source without false deletion patches", async (t) => {
  const f = await fixture(t);
  await f.import();
  const first = await f.metadata(),
    secondSource = figmaSource();
  secondSource.name = "Second imported product";
  const replaceIds = (node) => {
    node.id = node.id.replace(/^0:/u, "10:").replace(/^1:/u, "11:");
    for (const child of node.children ?? []) replaceIds(child);
  };
  replaceIds(secondSource.document);
  secondSource.document.children[0].children[0].children[0].characters = "Second Figma heading";
  f.files.set("A:designs/second-source.figma.json", JSON.stringify(secondSource));
  await f.tool("exchange_figma", {
    action: "import",
    path: "designs/second-source.figma.json",
    save: true,
    expected_state_revision: first.stateRevision,
  });
  async function exported(label) {
    const metadata = await f.metadata(),
      path = `designs/history-${label}.figma-transfer.json`;
    const receipt = await f.tool("exchange_figma", {
      action: "export",
      path,
      expected_state_revision: metadata.stateRevision,
    });
    return { receipt, value: JSON.parse(f.files.get(`A:${path}`)), metadata };
  }
  let output = await exported("second");
  assert(output.value.patch.mapping.some((entry) => entry.sourceId === "11:2"));
  await f.page.keyboard.press("Control+z");
  output = await exported("first-undone-second");
  assert.equal(output.metadata.name, "Imported product");
  assert(output.value.patch.mapping.some((entry) => entry.sourceId === "1:2"));
  assert.equal(output.value.patch.operations.length, 0);
  await f.page.keyboard.press("Control+z");
  output = await exported("original");
  assert.equal(output.metadata.name, "A original");
  assert.equal(output.receipt.patch, null);
  assert.equal(output.value.patch, undefined);
  await f.page.keyboard.press("Control+Shift+z");
  output = await exported("redo-first");
  assert.equal(output.metadata.name, "Imported product");
  assert(output.value.patch.mapping.some((entry) => entry.sourceId === "1:2"));
  assert.equal(output.value.patch.operations.length, 0);
  await f.page.keyboard.press("Control+Shift+z");
  output = await exported("redo-second");
  assert.equal(output.metadata.name, "Second imported product");
  assert(output.value.patch.mapping.some((entry) => entry.sourceId === "11:2"));
  assert.equal(output.value.patch.operations.length, 0);
  assert.deepEqual(f.errors, []);
});

test("saving an undone import records no-source provenance and remains editable after reload", async (t) => {
  const f = await fixture(t);
  await f.import();
  await f.page.keyboard.press("Control+z");
  assert.equal((await f.metadata()).name, "A original");
  await f.page.locator("#save").click();
  await f.page.waitForFunction(
    () => document.querySelector("#save-state").textContent === "已保存",
  );
  await f.reload();
  await f.page.locator("#save").click();
  await f.page.waitForFunction(
    () => document.querySelector("#save-state").textContent === "已保存",
  );
  const metadata = await f.metadata();
  assert.equal(metadata.name, "A original");
  const receipt = await f.tool("exchange_figma", {
    action: "export",
    path: "designs/no-source.figma-transfer.json",
    expected_state_revision: metadata.stateRevision,
  });
  assert.equal(receipt.patch, null);
  assert.equal(JSON.parse(f.files.get("A:designs/no-source.figma-transfer.json")).patch, undefined);
  assert.deepEqual(f.errors, []);
});

test("an unsaved imported source survives recovery, reopen and its first later save", async (t) => {
  const f = await fixture(t),
    metadata = await f.metadata();
  await f.tool("exchange_figma", {
    action: "import",
    path: inputPath,
    save: false,
    expected_state_revision: metadata.stateRevision,
  });
  let recovery;
  for (let attempt = 0; attempt < 150; attempt++) {
    recovery = [...f.records.values()].find(
      (value) => value?.format === "codeshell.design.recovery" && value.figmaBindingRef,
    );
    if (recovery) break;
    await f.page.waitForTimeout(25);
  }
  assert(
    recovery?.figmaBindingRef,
    "unsaved import must persist a verifiable source reference with its recovery journal",
  );
  assert.match(f.files.get(`A:${designPath}`), /A original heading/);
  await f.reload();
  const restored = await f.metadata();
  assert.equal(restored.name, "Imported product");
  assert.equal(restored.dirty, true);
  const receipt = await f.tool("exchange_figma", {
    action: "export",
    path: "designs/recovered.figma-transfer.json",
    expected_state_revision: restored.stateRevision,
  });
  assert.deepEqual(receipt.patch, { updates: 0, creates: 0, deletes: 0 });
  assert(
    JSON.parse(f.files.get("A:designs/recovered.figma-transfer.json")).patch.mapping.some(
      (entry) => entry.sourceId === "1:2",
    ),
  );
  await f.page.locator("#save").click();
  await f.page.waitForFunction(
    () => document.querySelector("#save-state").textContent === "已保存",
  );
  const saved = await f.reload();
  const next = await f.tool("exchange_figma", {
    action: "export",
    path: "designs/recovered-saved.figma-transfer.json",
    expected_state_revision: saved.stateRevision,
  });
  assert.deepEqual(next.patch, { updates: 0, creates: 0, deletes: 0 });
  assert.deepEqual(f.errors, []);
});

test("Figma provenance remains available after its import leaves the 200-entry undo history", async (t) => {
  const f = await fixture(t);
  await f.import();
  const metadata = await f.metadata(),
    heading = metadata.layers.find((node) => node.type === "text");
  await f.page.evaluate(async (id) => {
    for (let index = 0; index < 205; index++) {
      const metadata = await window.tools.get_design_metadata({});
      await window.tools.use_design({
        save: false,
        expected_state_revision: metadata.stateRevision,
        operations: [
          { op: "update_node", node_id: id, changes: { text: `History edit ${index}` } },
        ],
      });
    }
  }, heading.id);
  const current = await f.metadata();
  const receipt = await f.tool("exchange_figma", {
    action: "export",
    path: "designs/long-history.figma-transfer.json",
    expected_state_revision: current.stateRevision,
  });
  assert.equal(receipt.patch.updates, 1);
  const patch = JSON.parse(f.files.get("A:designs/long-history.figma-transfer.json")).patch;
  assert.equal(
    patch.operations.find((operation) => operation.sourceId === "1:2").after.text,
    "History edit 204",
  );
  assert.deepEqual(f.errors, []);
});

test("evicting a previous import preserves its source when undo returns through a later import", async (t) => {
  const f = await fixture(t);
  await f.import();
  const second = figmaSource();
  second.name = "Later source";
  const replaceIds = (node) => {
    node.id = node.id.replace(/^0:/u, "20:").replace(/^1:/u, "21:");
    for (const child of node.children ?? []) replaceIds(child);
  };
  replaceIds(second.document);
  f.files.set("A:designs/later-source.figma.json", JSON.stringify(second));
  await f.tool("exchange_figma", {
    action: "import",
    path: "designs/later-source.figma.json",
    save: true,
    expected_state_revision: (await f.metadata()).stateRevision,
  });
  const metadata = await f.metadata(),
    heading = metadata.layers.find((node) => node.type === "text");
  await f.page.evaluate(async (id) => {
    for (let index = 0; index < 199; index++) {
      const metadata = await window.tools.get_design_metadata({});
      await window.tools.use_design({
        save: false,
        expected_state_revision: metadata.stateRevision,
        operations: [
          { op: "update_node", node_id: id, changes: { text: `Later history ${index}` } },
        ],
      });
    }
    for (let index = 0; index < 200; index++)
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
      );
  }, heading.id);
  const prior = await f.metadata();
  assert.equal(prior.name, "Imported product");
  await f.tool("exchange_figma", {
    action: "export",
    path: "designs/evicted-prior.figma-transfer.json",
    expected_state_revision: prior.stateRevision,
  });
  const patch = JSON.parse(f.files.get("A:designs/evicted-prior.figma-transfer.json")).patch;
  assert(patch.mapping.some((entry) => entry.sourceId === "1:2"));
  assert.equal(patch.operations.length, 0);
  await f.page.keyboard.press("Control+Shift+z");
  const later = await f.metadata();
  assert.equal(later.name, "Later source");
  await f.tool("exchange_figma", {
    action: "export",
    path: "designs/evicted-redo.figma-transfer.json",
    expected_state_revision: later.stateRevision,
  });
  const redone = JSON.parse(f.files.get("A:designs/evicted-redo.figma-transfer.json")).patch;
  assert(redone.mapping.some((entry) => entry.sourceId === "21:2"));
  assert.equal(redone.operations.length, 0);
  assert.deepEqual(f.errors, []);
});

test("Agent imports multipart Figma sources and exports verified multipart transfers with complete panel downloads", async (t) => {
  const f = await fixture(t),
    source = figmaSource(),
    payload = "x".repeat(360 * 1024);
  source.document.children[0].children[0].children[0].pluginData.opaqueLargePayload = payload;
  const sourcePath = "designs/large-source.figma.json",
    outputPath = "designs/large-output.figma-transfer.json";
  const plan = await createDesignSidecarPlan(JSON.stringify(source), {
    sha256: async (value) => hash(value),
  });
  assert(plan.parts.length > 1);
  f.files.set(`A:${sourcePath}`, plan.primarySource);
  for (const part of plan.parts) f.files.set(`A:${part.path}`, part.content);
  await f.tool("exchange_figma", {
    action: "import",
    path: sourcePath,
    expected_state_revision: (await f.metadata()).stateRevision,
  });
  let metadata = await f.metadata();
  assert.equal(metadata.name, "Imported product");
  const heading = metadata.layers.find((node) => node.type === "text");
  await f.tool("use_design", {
    save: true,
    expected_state_revision: metadata.stateRevision,
    operations: [
      { op: "update_node", node_id: heading.id, changes: { text: "Edited multipart source" } },
    ],
  });
  metadata = await f.metadata();
  const receipt = await f.tool("exchange_figma", {
    action: "export",
    path: outputPath,
    expected_state_revision: metadata.stateRevision,
  });
  assert.equal(receipt.storage, "multipart");
  const manifest = JSON.parse(f.files.get(`A:${outputPath}`));
  assert.equal(manifest.format, "codeshell.design.sidecar");
  assert(manifest.parts.length > 1);
  const assembled = await readDesignSidecar({
    path: outputPath,
    sha256: async (value) => hash(value),
    call: async (method, params) => {
      assert.equal(method, "workspace.readText");
      return { content: f.files.get(`A:${params.path}`) };
    },
  });
  const transfer = JSON.parse(assembled.content),
    operation = transfer.patch.operations.find((item) => item.sourceId === "1:2");
  assert.equal(operation.after.text, "Edited multipart source");
  assert.equal(operation.before.pluginData.opaqueLargePayload, payload);
  assert(Buffer.byteLength(assembled.content) > DESIGN_SIDECAR_PART_BYTES);
  assert(
    f.calls
      .filter((call) => call.method === "workspace.writeText")
      .every((call) => Buffer.byteLength(call.content) <= 384 * 1024),
  );
  await f.page.locator("#open-figma-workflow").click();
  const pending = f.page.waitForEvent("download");
  await f.page.locator("#figma-transfer-download").click();
  const download = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  assert.equal(download.format, transfer.format);
  assert.notEqual(download.format, "codeshell.design.sidecar");
  assert.equal(
    download.patch.operations.find((item) => item.sourceId === "1:2").before.pluginData
      .opaqueLargePayload,
    payload,
  );
  await f.page.locator("#figma-workflow-close").click();
  const saved = f.files.get(`A:${designPath}`);
  f.files.set(`A:${plan.parts[0].path}`, "tampered chunk");
  await assert.rejects(
    f.tool("exchange_figma", {
      action: "import",
      path: sourcePath,
      expected_state_revision: (await f.metadata()).stateRevision,
    }),
    /分片|校验/,
  );
  assert.equal(f.files.get(`A:${designPath}`), saved);
  assert.deepEqual(f.errors, []);
});
