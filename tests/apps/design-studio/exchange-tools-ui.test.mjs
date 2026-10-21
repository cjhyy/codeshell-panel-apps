import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import {
  launchCanvasBrowser,
  canvasMime,
  gpuActive,
  readNode,
  worldPixel,
  nearColor,
} from "./fixtures/canvas-test-observations.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
  MAX_LOCAL_SVG_EXPORT_BYTES,
} from "../../../apps/design-studio/app/document.mjs";
import { MAX_WORKSPACE_DESIGN_TEXT_BYTES } from "../../../apps/design-studio/app/document-bundle.mjs";
import { parseFigmaBinding } from "../../../apps/design-studio/app/figma-binding.mjs";
import { planPortableDesign } from "../../../apps/design-studio/app/portable-backup.mjs";
import { preparePluginFile } from "../../../apps/design-studio/app/figma-plugin/v3-input.mjs";
import { htmlFontResources } from "../../../apps/design-studio/app/html-import-assets.mjs";
import { nativeTextContent } from "../../../apps/design-studio/app/text-content.mjs";
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
  const browser = await launchCanvasBrowser();
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
    pauses = new Map(),
    writeFailures = new Map(),
    ackLosses = new Map();
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
        contentType: canvasMime[extname(file)],
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
      if (ackLosses.get(fileKey)?.published && ackLosses.get(fileKey)?.unreadable)
        throw Error("Injected unavailable observation after publication");
      if (!files.has(fileKey))
        throw Error(`ENOENT: no such file or directory, open '${params.path}'`);
      const content = files.get(fileKey);
      result = { path: params.path, content, modifiedAt: 1, revision: revision(content) };
    } else if (method === "workspace.writeText") {
      const failure = writeFailures.get(fileKey);
      if (failure) {
        writeFailures.delete(fileKey);
        failure.enter();
        await failure.gate;
        throw Error("Injected HTML primary save failure");
      }
      const previous = files.get(fileKey);
      if (params.expectedModifiedAt === null && previous !== undefined) throw Error("file exists");
      if (
        params.expectedRevision !== undefined &&
        params.expectedRevision !== (previous === undefined ? null : revision(previous))
      )
        throw Error("workspace file changed since it was opened");
      files.set(fileKey, params.content);
      const lost = ackLosses.get(fileKey);
      if (lost && !lost.published) {
        lost.published = true;
        throw Error("Lost primary write acknowledgement");
      }
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
        capabilities: { packageAssets: { wasm: true } },
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
    loseWriteAcknowledgement(path, { unreadable = false } = {}) {
      ackLosses.set(`A:${path}`, { unreadable, published: false });
    },
    failWrite(path, scope = "A") {
      let enter, release;
      const entered = new Promise((resolve) => {
        enter = resolve;
      });
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      writeFailures.set(`${scope}:${path}`, { enter, gate });
      t.after(release);
      return { entered, release };
    },
  };
}

async function startPausedHtmlImport(f) {
  const sourcePath = "pages/pending-import.html";
  f.files.set(
    `A:${sourcePath}`,
    "<!doctype html><title>Pending HTML</title><style>body{margin:0;font-family:Arial}h1{margin:0;font-size:24px;line-height:30px}</style><main><h1>Import pending text</h1></main>",
  );
  const metadata = await f.metadata(),
    pause = f.failWrite(designPath);
  await f.page.evaluate(
    ({ sourcePath, state }) => {
      window.pendingHtmlImport = window.tools
        .import_html({
          path: sourcePath,
          save: true,
          viewport_width: 600,
          viewport_height: 400,
          expected_state_revision: state,
        })
        .then(
          (result) => ({ result }),
          (error) => ({ error: error.message }),
        );
    },
    { sourcePath, state: metadata.stateRevision },
  );
  await pause.entered;
  return pause;
}

async function assertRenderedImage(f) {
  const state = await f.metadata(),
    image = state.layers.find((node) => node.type === "image");
  assert.ok(image, "imported image remains in the public model");
  const node = await readNode(f.page, image.id);
  assert.ok(
    state.resources.some((resource) => resource.id === node.imageRef && resource.kind === "image"),
  );
  await gpuActive(f.page);
  nearColor(
    await worldPixel(f.page, { x: node.x + node.width / 2, y: node.y + node.height / 2 }),
    [0, 0, 0],
  );
}

test("HTML save waits make the actual UI inert and a failed untouched import restores the prior canvas", async (t) => {
  const f = await fixture(t),
    pause = await startPausedHtmlImport(f);
  assert.equal(
    await f.page.evaluate(() => document.body.inert),
    true,
    "Agent mutations block inspector/new-document UI until they settle",
  );
  pause.release();
  assert.match(
    (await f.page.evaluate(() => window.pendingHtmlImport)).error,
    /Injected HTML primary save failure/u,
  );
  const metadata = await f.metadata();
  assert.equal(metadata.name, "A original");
  assert.equal((await readNode(f.page, "heading")).text, "A original heading");
  assert.equal(await f.page.evaluate(() => document.body.inert), false);
  assert.equal(f.files.get(`A:${designPath}`), initialDocument("A"));
  assert.deepEqual(f.errors, []);
});

test("broken HTML fonts and CSS backgrounds fail before replacing the canvas or writing resource/design data", async (t) => {
  const f = await fixture(t);
  const cases = [
    [
      "font",
      '<!doctype html><style>@font-face{font-family:Broken;src:url("data:font/woff2;base64,AA==");font-weight:400}body{font-family:Broken}</style><main><p>Bad font must not replace the design</p></main>',
    ],
    [
      "background",
      '<!doctype html><style>.photo{width:40px;height:40px;background-image:url("data:image/png;base64,iVBORw0KGgo=")}</style><main><div class="photo"></div></main>',
    ],
  ];
  for (const [label, html] of cases) {
    const path = `pages/bad-${label}.html`;
    f.files.set(`A:${path}`, html);
    const before = await f.metadata(),
      start = f.calls.length;
    await assert.rejects(
      () =>
        f.tool("import_html", { path, save: true, expected_state_revision: before.stateRevision }),
      /字体|font|图片|image|资源|解码/iu,
    );
    const after = await f.metadata();
    assert.equal(
      after.stateRevision,
      before.stateRevision,
      `${label}: failed preflight must not change the canvas or history`,
    );
    assert.equal(after.name, "A original");
    assert.equal(
      f.calls.slice(start).filter((call) => call.method === "workspace.writeText").length,
      0,
      `${label}: no resource or design file may be written before decode succeeds`,
    );
    assert.equal(f.files.get(`A:${designPath}`), initialDocument("A"));
  }
  assert.deepEqual(f.errors, []);
});

test("HTML @font-face normal and bold weights retain font resources instead of silently omitting them", () => {
  for (const [source, expected] of [
    ["normal", 400],
    ["bold", 700],
  ]) {
    const fonts = htmlFontResources(
      `@font-face{font-family:Fixture;src:url("data:font/woff2;base64,AA==");font-weight:${source};font-style:normal}`,
    );
    assert.equal(fonts.length, 1, source);
    assert.equal(fonts[0].weight, expected);
  }
});

// Agent entry points keep the real body inert (tested above). Exercise the actual
// replacement function separately so future callers/reentrant events cannot let
// a failed save roll back a newer edit or a different document in the same project.
for (const action of ["edit", "new-document"])
  for (const noOp of [false, true]) {
    test(`HTML ${noOp ? "no-op " : ""}replacement save failure preserves newer ${action} state under reentrancy`, async () => {
      const app = await readFile(resolve(root, "app.js"), "utf8");
      const start = app.indexOf("function captureImportRollback()");
      const end = app.indexOf("async function importHtmlFromWorkspace(", start);
      assert.ok(start >= 0 && end > start);
      const rendererResets = [];
      const renderer = (mode) => ({
        update: async (update) => {
          rendererResets.push({ mode, ...structuredClone(update) });
          return { active: false };
        },
      });
      const state = {
        design: { name: "Before", nodes: [{ id: "old" }], pages: [] },
        workspaceEpoch: 1,
        documentEpoch: 1,
        designStateSequence: 0,
        history: [],
        historyIndex: 0,
        historyState: {},
        selectedId: null,
        selectedIds: new Set(),
        collapsedLayerIds: new Set(),
        lastAgentTransaction: null,
        currentPageCache: null,
        currentResourceCache: null,
        resourceDataUrls: new Map(),
        ownedFonts: { captureLease: () => ({}), restoreLease: () => true, invalidatePending() {} },
        fontResourcesReady: true,
        fontPageHidden: false,
        currentModifiedAt: 1,
        currentRevision: "old",
        currentSourcePath: designPath,
        currentSourceModifiedAt: 1,
        currentSourceRevision: "old",
        currentDesignIndexManifest: null,
        currentPersistenceMode: "single",
        savedSnapshot: "old",
        savedOperationState: {},
        recoveryBaseDocument: null,
        stagedFigmaBinding: null,
        loadedFigmaBinding: null,
        warnedExternalVersion: null,
        designPublicationSequence: 0,
        pristineBlankSnapshot: null,
        clone: structuredClone,
        normalizeDocument: (value) => value,
        normalizeDesignState: (value) => value,
        cancelInteraction() {},
        async ensureAllDesignPagesLoaded() {},
        async loadReferencedDesignResources() {},
        assertWorkspaceEpoch() {},
        serializeDocument: JSON.stringify,
        measureDesignDocumentBytes: () => 1,
        DesignResourceCache: class {},
        sha256Bytes() {},
        bundleHostCall() {},
        clearSelection() {},
        commitHistory() {},
        markChanged() {},
        updateDirtyState() {},
        renderAll() {},
        queueRecovery() {},
        requestAnimationFrame() {},
        gpuRenderer: renderer("gpu"),
        browserRenderer: renderer("browser"),
        elements: { path: { value: designPath } },
      };
      state.serializeDesign = () => JSON.stringify(state.design);
      state.allDesignNodes = (value = state.design) => value.nodes;
      state.currentDesignStateRevision = () =>
        `${state.documentEpoch}:${state.designStateSequence}:${state.elements.path.value}:${JSON.stringify(state.design)}`;
      let newer;
      state.saveDocument = async () => {
        if (action === "edit") state.design.nodes[0].text = "Newer user edit";
        else {
          state.design = { name: "New document", nodes: [{ id: "new-document-node" }], pages: [] };
          state.documentEpoch += 1;
          state.elements.path.value = "designs/new.codesign.json";
        }
        state.designStateSequence += 1;
        state.history = [{ label: action }];
        state.historyIndex = 1;
        state.selectedId = state.design.nodes[0].id;
        state.selectedIds = new Set([state.selectedId]);
        state.resourceDataUrls.set("newer-resource", "data:image/png;base64,AA==");
        newer = structuredClone({
          design: state.design,
          documentEpoch: state.documentEpoch,
          history: state.history,
          selectedId: state.selectedId,
          sequence: state.designStateSequence,
        });
        throw Error("Failed save after newer state");
      };
      const context = createContext(state);
      const epochStart = app.indexOf("function advanceDocumentEpoch()");
      const epochEnd = app.indexOf("function rendererResources()", epochStart);
      assert.ok(epochStart >= 0 && epochEnd > epochStart);
      runInContext(app.slice(epochStart, epochEnd), context);
      runInContext(app.slice(start, end), context);
      await assert.rejects(
        () =>
          runInContext(
            noOp
              ? "replaceDesignWithHtmlImport(design,{save:true})"
              : 'replaceDesignWithHtmlImport({name:"Imported",nodes:[{id:"imported-node"}],pages:[]},{save:true})',
            context,
          ),
        /Failed save after newer state/u,
      );
      assert.deepEqual(structuredClone(state.design), newer.design);
      assert.equal(state.documentEpoch, newer.documentEpoch);
      assert.equal(state.designStateSequence, newer.sequence);
      assert.deepEqual(state.history, newer.history);
      assert.equal(state.selectedId, newer.selectedId);
      assert.equal(state.resourceDataUrls.has("newer-resource"), true);
      assert.deepEqual(rendererResets.map((reset) => reset.mode), noOp ? [] : ["gpu", "browser"]);
      for (const reset of rendererResets) {
        assert.equal(reset.design, null);
        assert.equal(reset.suspended, true);
      }
    });
  }

test("local HTML folder becomes editable v3, survives save/reopen and restores into Figma from one complete file", async (t) => {
  const f = await fixture(t);
  const directory = await mkdtemp(resolve(tmpdir(), "codeshell-html-folder-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    resolve(directory, "index.html"),
    '<!doctype html><html><head><title>Local product</title><link rel="stylesheet" href="style.css"></head><body><main id="card"><h1>HTML original title</h1><img src="pixel.png" alt="Local pixel"></main><script>window.htmlPwned=true</script></body></html>',
  );
  await writeFile(
    resolve(directory, "style.css"),
    // Keep this complete-file success path representable in native Figma. A
    // stretched square bitmap has a separate explicit native-fill refusal.
    "body{margin:0}#card{width:500px;height:300px;padding:20px;background:#ffffff;display:flex;flex-direction:column;gap:16px}h1{font:24px/1.2 Arial;margin:0;color:#123456}img{width:80px;height:60px;object-fit:contain}",
  );
  await writeFile(resolve(directory, "pixel.png"), Buffer.from(pixel, "base64"));
  await f.page.locator("#open-html-import").click();
  await f.page.locator("#html-import-files").setInputFiles(directory);
  await f.page.locator("#html-import-width").fill("600");
  await f.page.locator("#html-import-height").fill("400");
  await f.page.locator("#run-html-import").click();
  await f.page.waitForFunction(() => !document.querySelector("#html-import-dialog").open);
  let metadata = await f.metadata();
  assert.equal(metadata.resources.length, 1);
  const heading = metadata.layers.find((node) => node.type === "text");
  assert.ok(heading);
  await assertRenderedImage(f);
  await f.tool("use_design", {
    expected_state_revision: metadata.stateRevision,
    save: true,
    operations: [
      { op: "update_node", node_id: heading.id, changes: { text: "Edited HTML product" } },
    ],
  });
  await f.reload();
  metadata = await f.metadata();
  assert.ok(metadata.layers.some((node) => node.id === heading.id));
  assert.match(f.files.get(`A:${designPath}`), /Edited HTML product/);
  await assertRenderedImage(f);
  await f.page.locator("#portable-backup-open").click();
  const pending = f.page.waitForEvent("download");
  await f.page.locator("#portable-backup-export").click();
  const text = await readFile(await (await pending).path(), "utf8"),
    backup = JSON.parse(text);
  assert.equal(backup.resources[0].base64, pixel);
  const restored = await preparePluginFile(text);
  const walk = (nodes) => nodes.flatMap((node) => [node, ...walk(node.children ?? [])]);
  const flattened = restored.transfer.pages.flatMap((page) => walk(page.children));
  assert.ok(
    flattened.some((node) => node.id === heading.id && node.text === "Edited HTML product"),
  );
  assert.equal(Object.values(restored.transfer.assets)[0].base64, pixel);
  const image = flattened.find((node) => node.type === "image");
  assert.deepEqual([image.width, image.height, image.objectFit], [80, 60, "contain"]);
  assert.equal(await f.page.evaluate(() => window.htmlPwned), undefined);
  assert.deepEqual(f.errors, []);
});

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

test("public text-only edits preserve authored whitespace through reflow, reopen and native patch export", async (t) => {
  const f = await fixture(t);
  await f.import();
  let metadata = await f.metadata();
  const heading = metadata.layers.find((node) => node.name === "Imported heading");
  assert.equal((await readNode(f.page, heading.id)).textSource, "Original Figma heading");
  const authored = "  Edited full authored content that can wrap at its current width  \n\n\tsecond explicit line with trailing spaces  ";
  await f.tool("use_design", {
    expected_state_revision: metadata.stateRevision,
    save: true,
    operations: [{ op: "update_node", node_id: heading.id, changes: { text: authored } }],
  });
  let node = await readNode(f.page, heading.id);
  assert.equal(node.textSource, authored, "Reflow must not resurrect the imported source");
  assert.equal(nativeTextContent(node), authored);
  await f.reload();
  metadata = await f.metadata();
  node = await readNode(f.page, heading.id);
  assert.equal(node.textSource, authored);
  assert.equal(nativeTextContent(node), authored);
  await f.tool("exchange_figma", {
    action: "export", path: "designs/authored.figma-transfer.json",
    expected_state_revision: metadata.stateRevision,
  });
  const output = JSON.parse(f.files.get("A:designs/authored.figma-transfer.json"));
  const update = output.patch.operations.find((operation) => operation.sourceId === "1:2");
  assert(update.changed.includes("text"));
  assert.equal(nativeTextContent(update.after, update.baseline), authored);
  assert.equal(update.before.characters, "Original Figma heading");

  const explicitSource = "  Explicit caller source\n\nretains its spaces  ";
  await f.tool("use_design", {
    expected_state_revision: metadata.stateRevision, save: true,
    operations: [{ op: "update_node", node_id: heading.id,
      changes: { text: "Caller display", textSource: explicitSource } }],
  });
  assert.equal((await readNode(f.page, heading.id)).textSource, explicitSource);
  metadata = await f.metadata();
  await f.tool("use_design", {
    expected_state_revision: metadata.stateRevision, save: true,
    operations: [{ op: "update_node", node_id: heading.id, changes: { text: "" } }],
  });
  node = await readNode(f.page, heading.id);
  assert.equal(node.textSource, "");
  assert.equal(node.textFlow, undefined);
  assert.equal(node.textOverflow, undefined);
  assert.equal(node.textFlowWidth, undefined);
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
    async () =>
      !document.querySelector(".workspace").inert &&
      (await window.tools.get_design_context({ node_id: "heading" })).node.text ===
        "B original heading",
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
  assert.equal(metadata.resources.filter((resource) => resource.kind === "image").length, 1);
  assert.equal(metadata.resources.filter((resource) => resource.kind === "font").length, 1);
  await assertRenderedImage(f);
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
  assert.equal(plan.resourceCount, metadata.resources.length);
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
    async () =>
      !document.querySelector(".workspace").inert &&
      (await window.tools.get_design_context({ node_id: "heading" })).node.text ===
        "B original heading",
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
  const fontProof = () => f.page.evaluate(async () => {
    const metadata = await tools.get_design_metadata(), faces = [...document.fonts];
    return metadata.resources.filter(resource => resource.kind === "font").map(resource => {
      const context = document.createElement("canvas").getContext("2d");
      context.font = `${resource.style} ${resource.weight} 32px ${JSON.stringify(resource.family)}, serif`;
      return {
        id: resource.id, sha256: resource.sha256, family: resource.family,
        registered: faces.some(face => face.family === resource.family && face.weight === String(resource.weight) && face.style === resource.style && face.status === "loaded"),
        width: context.measureText("iiii WWWW 0123456789 Hamburgefontsiv").width,
      };
    });
  });
  const importedFonts = await fontProof();
  assert(importedFonts.length > 0, "the imported fixture must require actual resource fonts");
  assert(importedFonts.every(font => font.registered), "import must install the decoded resource faces");
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
  assert.deepEqual(await fontProof(), importedFonts, "recovery must decode the replayed resource registry and preserve actual font selection");
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

test("large SVG export downloads complete fonts and images without exceeding Host write budgets", async (t) => {
  const f = await fixture(t, { image: true });
  await f.import();
  const downloadEvent = f.page.waitForEvent("download");
  await f.page.locator("#export-svg").click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "exchange.svg");
  const svg = await readFile(await download.path(), "utf8");
  assert.ok(Buffer.byteLength(svg) > MAX_WORKSPACE_DESIGN_TEXT_BYTES);
  assert.ok(Buffer.byteLength(svg) <= MAX_LOCAL_SVG_EXPORT_BYTES);
  assert.match(svg, /@font-face/u);
  assert.match(svg, /data:font\/woff2;base64,/u);
  assert.match(svg, /data:image\/png;base64,/u);
  assert.match(svg, /Original Figma heading/u);
  const rendered = await f.page.evaluate(async (svg) => {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(30, 30, 350, 50).data;
      let darkPixels = 0;
      for (let index = 0; index < pixels.length; index += 4)
        if (pixels[index + 3] > 0 && pixels[index] < 128) darkPixels += 1;
      return {
        parseErrors: parsed.querySelectorAll("parsererror").length,
        width: image.naturalWidth,
        height: image.naturalHeight,
        darkPixels,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, svg);
  assert.equal(rendered.parseErrors, 0);
  assert.ok(rendered.width >= 600 && rendered.height >= 400);
  assert.ok(rendered.darkPixels > 100, "downloaded standalone SVG renders its original heading");
  await f.page.waitForFunction(() => !document.querySelector("#export-svg").disabled);
  assert.match(await f.page.locator("#toast").textContent(), /已下载.*未写入 Repo/u);
  assert.equal(f.files.has("A:designs/exchange.svg"), false);
  assert.equal(
    f.calls.some(
      (call) => call.method === "workspace.writeText" && call.path === "designs/exchange.svg",
    ),
    false,
  );
  assert.ok(
    f.calls
      .filter((call) => call.method === "workspace.writeText")
      .every((call) => Buffer.byteLength(call.content) <= MAX_WORKSPACE_DESIGN_TEXT_BYTES),
  );
  assert.equal((await f.metadata()).dirty, false);
  assert.deepEqual(f.errors, []);
});

test("small SVG export keeps the existing repository compare-and-set behavior", async (t) => {
  const f = await fixture(t);
  const path = "designs/exchange.svg",
    previous = "previous SVG output";
  f.files.set(`A:${path}`, previous);
  let downloads = 0;
  f.page.on("download", () => (downloads += 1));
  await f.page.locator("#export-svg").click();
  await f.page.waitForFunction(() => !document.querySelector("#export-svg").disabled);
  const write = f.calls.find((call) => call.method === "workspace.writeText" && call.path === path);
  assert.ok(write);
  assert.equal(write.expectedRevision, revision(previous));
  assert.equal(write.expectedModifiedAt, 1);
  assert.match(f.files.get(`A:${path}`), /<svg/u);
  assert.ok(Buffer.byteLength(write.content) <= MAX_WORKSPACE_DESIGN_TEXT_BYTES);
  assert.equal(downloads, 0);
  assert.match(await f.page.locator("#toast").textContent(), /SVG 已导出到/u);
  assert.deepEqual(f.errors, []);
});

test("Figma preparation does not write and commits an independently reopenable design", async (t) => {
  const f = await fixture(t, { image: true });
  const before = await f.metadata(),
    original = f.files.get(`A:${designPath}`);
  const target = "designs/independent.codesign.json";
  const prepared = await f.tool("exchange_figma", {
    action: "prepare",
    source_path: inputPath,
    target_path: target,
    expected_state_revision: before.stateRevision,
  });
  assert.equal(prepared.mode, "create");
  assert.equal(prepared.targetPath, target);
  assert.equal((await f.metadata()).stateRevision, before.stateRevision);
  assert.equal(f.files.get(`A:${designPath}`), original);
  assert.equal(f.files.has(`A:${target}`), false);
  const imported = await f.tool("exchange_figma", {
    action: "import",
    source_path: inputPath,
    preparation_id: prepared.preparationId,
    allow_blocking: true,
    expected_state_revision: before.stateRevision,
  });
  assert.equal(imported.path, target);
  assert.equal(imported.saved, true);
  assert.equal(f.files.get(`A:${designPath}`), original);
  await f.reload();
  let current = await f.metadata();
  await f.tool("save_design", {
    action: "open",
    path: target,
    expected_state_revision: current.stateRevision,
  });
  current = await f.metadata();
  assert.equal(current.name, "Imported product");
  assert(current.layers.some((node) => node.name === "Imported image"));
  const exported = await f.tool("exchange_figma", {
    action: "export",
    path: "designs/independent.figma-transfer.json",
    expected_state_revision: current.stateRevision,
  });
  assert.equal(exported.patch.updates, 0);
  assert.deepEqual(f.errors, []);
});

test("Figma preparation rejects changed input and existing targets before mutation", async (t) => {
  const f = await fixture(t),
    before = await f.metadata();
  const target = "designs/guarded.codesign.json";
  const prepared = await f.tool("exchange_figma", {
    action: "prepare",
    source_path: inputPath,
    target_path: target,
    expected_state_revision: before.stateRevision,
  });
  const source = JSON.parse(f.files.get(`A:${inputPath}`));
  source.name = "Changed upstream";
  f.files.set(`A:${inputPath}`, JSON.stringify(source));
  await assert.rejects(
    f.tool("exchange_figma", {
      action: "import",
      source_path: inputPath,
      preparation_id: prepared.preparationId,
      expected_state_revision: before.stateRevision,
    }),
    /输入已在预检后变化/,
  );
  assert.equal((await f.metadata()).stateRevision, before.stateRevision);
  f.files.set(`A:${target}`, "unrelated existing file");
  await assert.rejects(
    f.tool("exchange_figma", {
      action: "import",
      source_path: inputPath,
      target_path: target,
      expected_state_revision: before.stateRevision,
    }),
    /目标设计已存在/,
  );
  assert.equal(f.files.get(`A:${target}`), "unrelated existing file");
});

test("Figma primary save failure restores canvas, target and source binding", async (t) => {
  const f = await fixture(t, { image: true });
  const before = await f.metadata(),
    original = f.files.get(`A:${designPath}`);
  const target = "designs/failed-import.codesign.json",
    failure = f.failWrite(target);
  const result = f
    .tool("exchange_figma", {
      action: "import",
      source_path: inputPath,
      target_path: target,
      allow_blocking: true,
      expected_state_revision: before.stateRevision,
    })
    .then(
      () => null,
      (error) => error,
    );
  await Promise.race([
    failure.entered,
    result.then((error) => {
      throw error ?? Error("Import completed without reaching injected failure");
    }),
  ]);
  failure.release();
  assert.match((await result).message, /Injected HTML primary save failure/);
  const restored = await f.metadata();
  assert.equal(restored.stateRevision, before.stateRevision);
  assert.equal(restored.path, designPath);
  assert.equal(f.files.get(`A:${designPath}`), original);
  assert.equal(f.files.has(`A:${target}`), false);
  await f.tool("exchange_figma", {
    action: "export",
    path: "designs/failed-import.figma-transfer.json",
    expected_state_revision: restored.stateRevision,
  });
  assert.equal(
    JSON.parse(f.files.get("A:designs/failed-import.figma-transfer.json")).patch,
    undefined,
  );
  assert.deepEqual(f.errors, []);
});

test("file management preserves original files and copied review attachments", async (t) => {
  const f = await fixture(t);
  let current = await f.metadata();
  await f.tool("update_design_comments", {
    action: "create",
    text: "Keep review",
    expected_state_revision: current.stateRevision,
  });
  current = await f.metadata();
  const original = f.files.get(`A:${designPath}`),
    copy = "designs/copy.codesign.json";
  await f.tool("save_design", {
    action: "save_as",
    path: copy,
    expected_state_revision: current.stateRevision,
  });
  assert.equal(f.files.get(`A:${designPath}`), original);
  assert.match(f.files.get("A:designs/copy.comments.json"), /Keep review/);
  assert.equal(JSON.parse(f.files.get("A:designs/copy.comments.json")).designPath, copy);
  assert.equal((await f.tool("get_design_comments")).threads[0].text, "Keep review");
  await f.reload();
  current = await f.metadata();
  await f.tool("save_design", {
    action: "open",
    path: copy,
    expected_state_revision: current.stateRevision,
  });
  assert.equal((await f.tool("get_design_comments")).threads[0].text, "Keep review");
  current = await f.metadata();
  await assert.rejects(
    f.tool("save_design", {
      action: "create",
      path: copy,
      expected_state_revision: current.stateRevision,
    }),
    /目标设计已存在/,
  );
  await f.tool("save_design", {
    action: "create",
    path: "designs/blank.codesign.json",
    name: "New clean design",
    expected_state_revision: current.stateRevision,
  });
  current = await f.metadata();
  assert.equal(current.name, "New clean design");
  assert.equal(
    current.pages.reduce((total, page) => total + page.nodeCount, 0),
    0,
  );
  await f.tool("save_design", {
    action: "open",
    path: copy,
    expected_state_revision: current.stateRevision,
  });
  assert.equal((await f.metadata()).name, "A original");
});

test("audit UI and tools expose all grouped issues with filtered pagination", async (t) => {
  const f = await fixture(t);
  const source = figmaSource();
  source.document.children[0].children[0].clipsContent = false;
  source.document.children[0].children[0].children = Array.from({ length: 125 }, (_, index) => ({
    id: `10:${index}`,
    type: "TEXT",
    name: `Narrow text ${index}`,
    characters: "A deliberately long label",
    absoluteBoundingBox: { x: 30, y: 19990, width: 400, height: 30 },
    fills: [{ type: "SOLID", color: { r: 0.05, g: 0.05, b: 0.05 } }],
    style: { fontFamily: "Inter", fontSize: 24, fontWeight: 400 },
  }));
  f.files.set(`A:${inputPath}`, JSON.stringify(source));
  await f.import();
  const audit = await f.tool("validate_design", { code: "layout.canvas-overflow", limit: 50 });
  assert.equal(audit.page.total, 125);
  assert.equal(audit.issues.length, 50);
  assert.equal(audit.page.nextOffset, 50);
  assert.equal(
    audit.issueGroups.find((group) => group.code === "layout.canvas-overflow").count,
    125,
  );
  await f.page.locator("#run-audit").click();
  await f.page.getByLabel("问题类型", { exact: true }).selectOption("layout.canvas-overflow");
  assert.equal(await f.page.locator("#audit-results .audit-issue").count(), 50);
  await f.page.getByRole("button", { name: "下一页问题" }).click();
  assert.match(await f.page.locator("#audit-controls [role=status]").textContent(), /51–100/);
  await f.page.getByRole("button", { name: "下一页问题" }).click();
  assert.equal(await f.page.locator("#audit-results .audit-issue").count(), 25);
  assert.equal(await f.page.getByRole("button", { name: "下一页问题" }).isDisabled(), true);
  await f.page.locator("#audit-results .audit-issue").first().click();
  assert.equal(await f.page.locator("#audit-dialog").evaluate((element) => element.open), false);
  assert.deepEqual(f.errors, []);
});

test("Save As UI creates a new file through the same guarded file workflow", async (t) => {
  const f = await fixture(t),
    original = f.files.get(`A:${designPath}`);
  await f.page.locator("#save-as").click();
  await f.page.locator("#save-as-path").fill("designs/from-ui.codesign.json");
  await f.page.locator("#save-as-confirm").click();
  await f.page.waitForFunction(() => !document.querySelector("#save-as-dialog").open);
  assert.equal(f.files.get(`A:${designPath}`), original);
  assert(f.files.has("A:designs/from-ui.codesign.json"));
  assert.equal((await f.metadata()).path, "designs/from-ui.codesign.json");
});

test("Figma preparation rejects an input colliding with the new binding path", async (t) => {
  const f = await fixture(t),
    before = await f.metadata();
  const source = "designs/same.figma-source.json";
  f.files.set(`A:${source}`, JSON.stringify(figmaSource()));
  await assert.rejects(
    f.tool("exchange_figma", {
      action: "prepare",
      source_path: source,
      target_path: "designs/same.codesign.json",
      expected_state_revision: before.stateRevision,
    }),
    /来源绑定文件重名/,
  );
  assert.equal((await f.metadata()).stateRevision, before.stateRevision);
});

test("a lost successful save acknowledgement is reconciled without another primary write", async (t) => {
  const f = await fixture(t),
    before = await f.metadata(),
    target = "designs/lost-ack.codesign.json";
  f.loseWriteAcknowledgement(target);
  const imported = await f.tool("exchange_figma", {
    action: "import",
    source_path: inputPath,
    target_path: target,
    allow_blocking: true,
    expected_state_revision: before.stateRevision,
  });
  assert.equal(imported.saved, true);
  assert.equal((await f.metadata()).path, target);
  assert.equal((await f.metadata()).name, "Imported product");
  assert.equal(
    f.calls.filter((call) => call.method === "workspace.writeText" && call.path === target).length,
    1,
  );
  assert(f.files.has(`A:${target}`));
});

test("an unobservable save acknowledgement preserves the import and reports uncertainty", async (t) => {
  const f = await fixture(t),
    before = await f.metadata(),
    target = "designs/unknown-ack.codesign.json";
  f.loseWriteAcknowledgement(target, { unreadable: true });
  await assert.rejects(
    f.tool("exchange_figma", {
      action: "import",
      source_path: inputPath,
      target_path: target,
      allow_blocking: true,
      expected_state_revision: before.stateRevision,
    }),
    /保存结果无法确认/,
  );
  const current = await f.metadata();
  assert.equal(current.path, target);
  assert.equal(current.name, "Imported product");
  assert.equal(current.dirty, true);
  assert.equal(
    f.calls.filter((call) => call.method === "workspace.writeText" && call.path === target).length,
    1,
  );
});

test("Save As retries reuse identical attachments after a rejected primary write", async (t) => {
  const f = await fixture(t);
  let current = await f.metadata();
  await f.tool("update_design_comments", {
    action: "create",
    text: "Retry review",
    expected_state_revision: current.stateRevision,
  });
  current = await f.metadata();
  const target = "designs/retry-copy.codesign.json",
    failure = f.failWrite(target);
  const result = f
    .tool("save_design", {
      action: "save_as",
      path: target,
      expected_state_revision: current.stateRevision,
    })
    .then(
      () => null,
      (error) => error,
    );
  await Promise.race([
    failure.entered,
    result.then((error) => {
      throw error ?? Error("No injected write");
    }),
  ]);
  failure.release();
  assert.match((await result).message, /Injected/);
  assert.equal(f.files.has(`A:${target}`), false);
  assert(f.files.has("A:designs/retry-copy.comments.json"));
  current = await f.metadata();
  await f.tool("save_design", {
    action: "save_as",
    path: target,
    expected_state_revision: current.stateRevision,
  });
  assert.equal((await f.tool("get_design_comments")).threads[0].text, "Retry review");
});

test("new Figma files do not discard a meaningful unsaved empty draft", async (t) => {
  const f = await fixture(t);
  let current = await f.metadata();
  await f.tool("save_design", {
    action: "create",
    path: "designs/empty-draft.codesign.json",
    name: "Meaningful empty draft",
    save: false,
    expected_state_revision: current.stateRevision,
  });
  current = await f.metadata();
  await assert.rejects(
    f.tool("exchange_figma", {
      action: "import",
      source_path: inputPath,
      target_path: "designs/another.codesign.json",
      allow_blocking: true,
      expected_state_revision: current.stateRevision,
    }),
    /当前设计有未保存修改/,
  );
  assert.equal((await f.metadata()).name, "Meaningful empty draft");
  assert.equal(f.files.has("A:designs/another.codesign.json"), false);
});

test("the quality repair button preserves locked descendants and one undo restores its unsaved changes", async (t) => {
  const f = await fixture(t);
  const documentValue = JSON.parse(initialDocument("A"));
  const heading = documentValue.pages[0].children[0];
  heading.fill = "#cccccc";
  documentValue.pages[0].children = [
    {
      id: "locked-owner",
      type: "frame",
      name: "Locked owner",
      x: 0,
      y: 0,
      width: 400,
      height: 100,
      fill: "#ffffff",
      stroke: "transparent",
      strokeWidth: 0,
      opacity: 1,
      rotation: 0,
      cornerRadius: 0,
      visible: true,
      locked: true,
      layout: "none",
      gap: 0,
      padding: 0,
      alignItems: "start",
      justifyContent: "start",
      clipContent: false,
      children: [heading],
    },
    { ...heading, id: "free-heading", name: "Editable heading", y: 180 },
  ];
  const original = serializeDesignDocument(normalizeDesignDocument(documentValue));
  f.files.set(`A:${designPath}`, original);
  await f.reload();
  const before = await f.metadata();
  assert.equal((await f.tool("validate_design")).issueCount, 2);
  await f.page.locator("#run-audit").click();
  await f.page.locator("#repair-quality").click();
  await f.page.waitForFunction(() => !document.body.inert);
  const free = await f.tool("get_design_context", { node_id: "free-heading" });
  const locked = await f.tool("get_design_context", { node_id: "heading" });
  assert.notEqual(free.node.fill, "#cccccc");
  assert.equal(locked.node.fill, "#cccccc");
  assert.equal(f.files.get(`A:${designPath}`), original, "repair is an unsaved reversible edit");
  await f.page.locator("#audit-dialog .dialog-close").click();
  await f.page.keyboard.press("Control+z");
  const undone = await f.tool("get_design_context", { node_id: "free-heading" });
  assert.equal(undone.node.fill, "#cccccc");
  assert.equal((await f.metadata()).revision, before.revision);
  assert.equal(f.files.get(`A:${designPath}`), original);
  assert.deepEqual(f.errors, []);
});

test("public HTML ellipsis import saves full editable source and reflows after edit and reopen", async (t) => {
  const f = await fixture(t);
  const full = "Full authored content remains editable when the frame becomes narrower and the visible line ends in an ellipsis.";
  const raw = `  ${full}  `, path = "pages/ellipsis.html";
  f.files.set(`A:${path}`, `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0}#fixture{display:flex;flex-direction:column;width:100%;height:240px;padding:20px}.row{display:flex;min-width:0;width:100%;padding:12px}.copy{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:20px/24px Arial}</style><main id="fixture"><section class="row"><div class="copy">${raw}</div></section></main>`);
  await f.tool("import_html", { path, root_selector: "#fixture", viewport_width: 640, viewport_height: 240, save: true, expected_state_revision: (await f.metadata()).stateRevision });
  let metadata = await f.metadata();
  const textId = metadata.layers.find((node) => node.type === "text").id;
  const rootId = metadata.layers.find((node) => node.name === "main#fixture").id;
  const viewportId = metadata.layers.find((node) => node.id === "html-viewport").id;
  const before = await readNode(f.page, textId);
  assert.equal(before.textSource, full);
  assert.equal(before.textOverflow, "ellipsis");
  assert.equal(before.layoutSizingHorizontal, "fill");
  assert.equal(before.width, 576);
  assert.ok(before.text.endsWith("…"));
  assert.equal(nativeTextContent(before), full);
  assert.equal(JSON.parse(before.notes).htmlText.rawSource, raw);
  const edited = full + " Newly edited words remain complete in the native transfer.";
  await f.tool("use_design", { expected_state_revision: metadata.stateRevision, save: true, operations: [
    { op: "update_node", node_id: viewportId, changes: { width: 400 } },
    { op: "update_node", node_id: textId, changes: { text: edited } },
  ] });
  await f.reload();
  const after = await readNode(f.page, textId);
  const rootAfter = await readNode(f.page, rootId);
  assert.equal(rootAfter.width, 400);
  assert.equal(rootAfter.layoutSizingHorizontal, "fill");
  assert.equal(after.width, 336);
  assert.equal(after.textSource, edited);
  assert.equal(after.textOverflow, "ellipsis");
  assert.ok(after.text.endsWith("…"));
  assert.ok(after.text.length < before.text.length);
  assert.equal(nativeTextContent(after), edited);
  const saved = normalizeDesignDocument(JSON.parse(f.files.get(`A:${designPath}`)));
  assert.equal(saved.nodes.find((node) => node.id === textId).textSource, edited);
  const prepared = await preparePluginFile(serializeDesignDocument(saved));
  const walk = (nodes) => nodes.flatMap((node) => [node, ...walk(node.children ?? [])]);
  const transferText = prepared.transfer.pages.flatMap((page) => walk(page.children)).find((node) => node.id === textId);
  assert.equal(nativeTextContent(transferText), edited);
  assert.equal(JSON.parse(transferText.notes).htmlText.rawSource, raw);
  assert.deepEqual(f.errors, []);
});

test("native stroke exclusion inspector/tool edits reflow siblings and preserve bounded provenance through reopen", async (t) => {
  const f = await fixture(t);
  const native = JSON.parse(await readFile(new URL("../../fixtures/design-studio-native-content-fill.json", import.meta.url), "utf8"));
  const { importFigmaJson } = await import("../../../apps/design-studio/app/figma-bridge.mjs");
  const value = importFigmaJson(native.cases[0].source).document, parent = value.nodes[0];
  const origin = { x: parent.x, y: parent.y };
  for (const node of value.nodes) { node.x -= origin.x; node.y -= origin.y; }
  value.canvas.width = 640; value.canvas.height = 240;
  const [first, second] = value.nodes.filter((node) => node.parentId === parent.id);
  f.files.set(`A:${designPath}`, serializeDesignDocument(value)); await f.reload();
  assert.equal((await readNode(f.page, first.id)).strokeLayoutExcluded, true);
  assert.deepEqual([(await readNode(f.page, first.id)).width, (await readNode(f.page, second.id)).width], [290, 322]);
  await f.page.locator(`.layer-row[data-id="${first.id}"] .layer-title`).click();
  await f.page.locator("#prop-stroke-width").fill("8");
  assert.deepEqual([(await readNode(f.page, first.id)).width, (await readNode(f.page, second.id)).width], [294, 318]);
  await f.page.locator("details.layout-advanced > summary").click();
  await f.page.locator("#prop-layout-padding-left").fill("12");
  await f.page.locator("#prop-layout-padding-left").press("Tab");
  assert.deepEqual([(await readNode(f.page, first.id)).width, (await readNode(f.page, second.id)).width], [296, 316]);
  await f.tool("use_design", { save: true, expected_state_revision: (await f.metadata()).stateRevision,
    operations: [{ op: "update_node", node_id: first.id, changes: { strokeLayoutExcluded: null } }] });
  await f.reload();
  assert.equal((await readNode(f.page, first.id)).strokeLayoutExcluded, undefined);
  assert.deepEqual([(await readNode(f.page, first.id)).width, (await readNode(f.page, second.id)).width], [288, 324]);
  await f.tool("use_design", { expected_state_revision: (await f.metadata()).stateRevision,
    operations: [{ op: "update_node", node_id: first.id, changes: { strokeLayoutExcluded: true } }] });
  await f.page.locator(`.layer-row[data-id="${first.id}"] .layer-title`).click();
  await f.page.locator("details.layout-advanced > summary").click();
  await f.page.locator("#prop-layout").selectOption("none");
  assert.equal((await readNode(f.page, first.id)).strokeLayoutExcluded, undefined, "inspector layout edits clear inapplicable provenance");
  await f.tool("use_design", { save: true, expected_state_revision: (await f.metadata()).stateRevision,
    operations: [{ op: "update_node", node_id: second.id, changes: { strokeAlign: "outside" } }] });
  await f.reload();
  assert.equal((await readNode(f.page, second.id)).strokeLayoutExcluded, undefined, "public alignment edits clear inapplicable provenance");
  await assert.rejects(f.tool("use_design", { expected_state_revision: (await f.metadata()).stateRevision,
    operations: [{ op: "update_node", node_id: second.id, changes: { strokeLayoutExcluded: true } }] }), /strokeLayoutExcluded/u);
  assert.equal((await readNode(f.page, second.id)).strokeLayoutExcluded, undefined);
  assert.deepEqual(f.errors, []);
});

test("public negative spacing edits retain native-safe block insets through outer-only resize and reopen", async (t) => {
  const f = await fixture(t);
  const { negativeMarginFixtures } = await import("../../fixtures/design-studio-negative-margins/source.mjs");
  const fixtureSource = negativeMarginFixtures[0], path = "pages/negative-spacing.html";
  f.files.set(`A:${path}`, `<!doctype html><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}${fixtureSource.css}</style>${fixtureSource.html}`);
  await f.tool("import_html", { path, root_selector: "#fixture", viewport_width: 640, viewport_height: 300,
    save: true, expected_state_revision: (await f.metadata()).stateRevision });
  let metadata = await f.metadata();
  const main = metadata.layers.find((node) => node.name === "main#fixture");
  const row = metadata.layers.find((node) => node.name === "section#row");
  assert.ok(main && row);
  assert.equal(metadata.layers.some((node) => /horizontal margins|flow spacer/u.test(node.name)), false);
  const initialMain = await readNode(f.page, main.id);
  assert.deepEqual([initialMain.paddingLeft, initialMain.paddingRight], [5, 5]);
  assert.equal(row.parentId, main.id, "the real row directly fills the rebased parent");
  await f.page.locator(`.layer-row[data-id="${row.id}"] .layer-title`).click();
  await f.page.locator("details.layout-advanced > summary").click();
  await f.page.locator("#prop-layout-column-gap").fill("");
  await f.page.locator("#prop-layout-gap").fill("-20");
  assert.equal((await readNode(f.page, row.id)).gap, -20);
  const beforeInvalid = await readNode(f.page, row.id);
  const initialCells = metadata.layers.filter((node) => node.parentId === row.id);
  assert.equal(initialCells.length, 2);
  assert.deepEqual(await Promise.all(initialCells.map(async (node) => (await readNode(f.page, node.id)).width)), [325, 325],
    "the inspector's negative main gap must actually reflow both Fill children");
  await f.page.locator("#prop-layout-wrap").selectOption("wrap");
  assert.equal((await readNode(f.page, row.id)).layoutWrap, "none");
  await f.page.locator("#prop-layout-reverse").click();
  assert.equal(Boolean((await readNode(f.page, row.id)).layoutReverse), false);
  await f.page.locator("#prop-layout-sizing-horizontal").selectOption("hug");
  assert.equal((await readNode(f.page, row.id)).layoutSizingHorizontal, "fill");
  const afterInvalid = await readNode(f.page, row.id);
  assert.deepEqual([afterInvalid.x, afterInvalid.width], [beforeInvalid.x, beforeInvalid.width]);
  metadata = await f.metadata();
  await f.tool("use_design", { save: true, expected_state_revision: metadata.stateRevision,
    operations: [{ op: "update_node", node_id: row.id, changes: { gap: -16 } },
      { op: "update_node", node_id: "html-viewport", changes: { width: 400 } }] });
  await f.reload();
  const resized = await readNode(f.page, row.id);
  assert.deepEqual([resized.x, resized.width, resized.layoutSizingHorizontal], [5, 390, "fill"]);
  metadata = await f.metadata();
  await assert.rejects(f.tool("use_design", { expected_state_revision: metadata.stateRevision,
    operations: [{ op: "update_node", node_id: row.id, changes: { layoutWrap: "wrap" } }] }), /负间距/u);
  metadata = await f.metadata();
  await f.tool("exchange_figma", { action: "export", path: "designs/negative-spacing.figma-transfer.json", expected_state_revision: metadata.stateRevision });
  const transfer = JSON.parse(f.files.get("A:designs/negative-spacing.figma-transfer.json"));
  const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
  const exported = transfer.pages.flatMap((page) => page.children.flatMap(flatten));
  assert.equal(exported.find((node) => node.id === row.id).gap, -16);
  assert.equal(exported.find((node) => node.id === row.id).columnGap, undefined);
  const finalMain = exported.find((node) => node.id === main.id);
  assert.equal(finalMain.children.some((node) => node.id === row.id), true, "hierarchical transfer retains the direct row parent");
  assert.deepEqual([finalMain.paddingLeft, finalMain.paddingRight], [5, 5]);
  assert.equal(exported.length, 7, "no old negative-gap spacer wrappers return after edit/reopen/export");
  assert.equal(exported.find((node) => node.id === row.id).layoutSizingHorizontal, "fill");
  assert.deepEqual(f.errors, []);
});

test("CSS shadow layers remain public editable through inspector order, visibility, save and reopen",async t=>{
 const f=await fixture(t),path="pages/shadows.html";
 f.files.set(`A:${path}`,`<!doctype html><style>*{box-sizing:border-box}body{margin:0}main{display:flex;width:100%;height:240px;padding:20px}section{flex:1;height:100px;background:white;box-shadow:inset 8px 0 0 #dc2626,inset 0 8px 0 #2563eb}</style><main><section></section></main>`);
 await f.tool("import_html",{path,root_selector:"body",viewport_width:640,viewport_height:240,save:true,expected_state_revision:(await f.metadata()).stateRevision});
 const metadata=await f.metadata(),target=metadata.layers.find(n=>n.name==="section"),before=await readNode(f.page,target.id),geometry=[before.x,before.y,before.width,before.height];assert.equal(before.shadowStack.layers.length,2);
 await f.tool("use_design",{expected_state_revision:metadata.stateRevision,save:true,operations:[{op:"update_node",node_id:target.id,changes:{shadowStack:{basis:"css-box",layers:[before.shadowStack.layers[0]]}}}]});
 await f.page.locator(`.layer-row[data-id="${target.id}"] .layer-title`).click();await f.page.locator("#shadow-layer-add").click();assert.equal((await readNode(f.page,target.id)).shadowStack.layers.length,2);
 await f.page.locator("#prop-shadow-layer").selectOption("0");await f.page.locator("#shadow-layer-down").click();let node=await readNode(f.page,target.id);assert.equal(node.shadowStack.layers[1].color,"#dc2626");
 await f.page.locator("#prop-shadow-visible").uncheck();node=await readNode(f.page,target.id);assert.equal(node.shadowStack.layers[1].visible,false);
 await f.page.locator("#prop-shadow-opacity").fill("35");node=await readNode(f.page,target.id);assert.equal(node.shadowStack.layers[1].opacity,.35);
 await f.page.locator("#shadow-layer-remove").click();assert.equal((await readNode(f.page,target.id)).shadowStack.layers.length,1);
 await f.tool("use_design",{expected_state_revision:(await f.metadata()).stateRevision,save:true,operations:[{op:"update_node",node_id:target.id,changes:{notes:"Edited shadow layers"}}]});
 const saved=(await readNode(f.page,target.id)).shadowStack;await f.reload();node=await readNode(f.page,target.id);assert.deepEqual(node.shadowStack,saved);assert.deepEqual([node.x,node.y,node.width,node.height],geometry);assert.equal(node.shadow,undefined);
 const revision=(await f.metadata()).stateRevision;await assert.rejects(f.tool("use_design",{expected_state_revision:revision,operations:[{op:"update_node",node_id:target.id,changes:{shadowStack:{basis:"css-box",layers:[{...saved.layers[0],spread:1}]}}}]}),/spread/);assert.deepEqual((await readNode(f.page,target.id)).shadowStack,saved);
 await f.tool("use_design",{expected_state_revision:(await f.metadata()).stateRevision,operations:[{op:"update_node",node_id:target.id,changes:{stroke:"#16a34a",strokeWidth:4,strokeAlign:"inside"}}]});
 await f.page.locator(`.layer-row[data-id="${target.id}"] .layer-title`).click();
 await f.page.locator("#prop-radius").fill("8");
 node=await readNode(f.page,target.id);assert.equal(node.cornerRadius,0,"inspector refuses an unproven rounded border mask atomically");assert.equal(node.strokeWidth,4);assert.deepEqual(node.shadowStack,saved);
 assert.deepEqual(f.errors,[]);
});

test("inactive native stroke inspector/public activation preserves latent width, offers Text Center, and undo/reopen retains intent", async (t) => {
  const f = await fixture(t),
    { importFigmaJson } = await import("../../../apps/design-studio/app/figma-bridge.mjs");
  const doc = importFigmaJson({
    id: "0:1",
    type: "CANVAS",
    name: "Inactive stroke",
    children: [
      {
        id: "1:2",
        type: "FRAME",
        name: "Latent Frame",
        layoutMode: "VERTICAL",
        strokeAlign: "INSIDE",
        strokeWeight: 2,
        strokesIncludedInLayout: true,
        strokes: [],
        paddingTop: 8,
        paddingRight: 8,
        paddingBottom: 8,
        paddingLeft: 8,
        absoluteBoundingBox: { x: 20, y: 20, width: 400, height: 140 },
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
        children: [],
      },
      {
        id: "1:3",
        type: "TEXT",
        name: "Latent Text",
        strokeAlign: "OUTSIDE",
        strokeWeight: 1,
        strokes: [],
        characters: "Original characters",
        fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
        absoluteBoundingBox: { x: 20, y: 180, width: 300, height: 20 },
        style: {
          fontFamily: "Arial",
          fontSize: 16,
          fontWeight: 400,
          lineHeightPx: 20,
          lineHeightUnit: "PIXELS",
        },
      },
    ],
  }).document;
  f.files.set(`A:${designPath}`, serializeDesignDocument(doc));
  await f.reload();
  await f.page.locator('.layer-row[data-id="figma-1-2"] .layer-title').click();
  assert.equal(await f.page.locator("#prop-stroke-width").inputValue(), "2");
  assert.equal(await f.page.locator("#prop-stroke-align").inputValue(), "inside");
  assert.equal(await f.page.locator("#prop-stroke-layout").inputValue(), "included");
  await f.page.locator("#prop-stroke-width").fill("3");
  await f.page.locator("#prop-stroke-width").press("Tab");
  assert.equal((await readNode(f.page, "figma-1-2")).strokeWidth, 0);
  assert.equal((await readNode(f.page, "figma-1-2")).nativeStrokeInactive.strokeWeight, 3);
  assert.equal(await f.page.locator("#prop-stroke-width").inputValue(), "3");
  await f.page.locator("#prop-stroke").fill("#123456");
  assert.equal(await f.page.locator("#prop-stroke").inputValue(), "#123456");
  await f.page.locator("#prop-stroke").press("Tab");
  let frame = await readNode(f.page, "figma-1-2");
  assert.equal(frame.nativeStrokeInactive, undefined);
  assert.equal(frame.paddingTop, 11);
  assert.equal(frame.strokeWidth, 3);
  assert.notEqual(await f.page.locator("#toast").getAttribute("data-kind"), "error", "successful activation must not mask an inspector helper exception");
  await f.page.locator("#prop-stroke-remove").click();
  assert.notEqual(await f.page.locator("#toast").getAttribute("data-kind"), "error", "successful removal must reach history commit");
  frame = await readNode(f.page, "figma-1-2");
  assert.equal(frame.paddingTop, 8);
  assert.equal(frame.nativeStrokeInactive.strokeWeight, 3);
  await f.page.evaluate(() => document.activeElement.blur());
  await f.page.keyboard.press("Control+z");
  assert.equal((await readNode(f.page, "figma-1-2")).nativeStrokeInactive, undefined);
  await f.page.keyboard.press("Control+Shift+z");
  assert.equal((await readNode(f.page, "figma-1-2")).nativeStrokeInactive.strokeWeight, 3);
  await f.tool("use_design", {
    save: true,
    expected_state_revision: (await f.metadata()).stateRevision,
    operations: [{ op: "update_node", node_id: "figma-1-2", changes: { stroke: "#654321" } }],
  });
  await f.reload();
  assert.equal((await readNode(f.page, "figma-1-2")).paddingTop, 11);
  await f.page.locator('.layer-row[data-id="figma-1-3"] .layer-title').click();
  await f.page.locator("#prop-stroke").fill("#123456");
  await f.page.locator("#prop-stroke").press("Tab");
  assert.equal(
    (await readNode(f.page, "figma-1-3")).stroke,
    "transparent",
    "unsupported Text OUTSIDE activation is not silently centered",
  );
  await f.page.locator("#prop-stroke-align").selectOption("center");
  await f.page.locator("#prop-stroke").fill("#123456");
  await f.page.locator("#prop-stroke").press("Tab");
  const text = await readNode(f.page, "figma-1-3");
  assert.equal(text.stroke, "#123456");
  assert.equal(text.nativeStrokeInactive, undefined);
  assert.equal(text.strokeAlign, undefined);
  assert.equal(text.text, "Original characters");
  await f.tool("use_design", {
    save: true,
    expected_state_revision: (await f.metadata()).stateRevision,
    operations: [
      {
        op: "update_node",
        node_id: "figma-1-2",
        changes: { stroke: "transparent", strokeWidth: 4, strokeAlign: "outside" },
      },
    ],
  });
  await f.reload();
  frame = await readNode(f.page, "figma-1-2");
  assert.equal(frame.paddingTop, 8);
  assert.equal(frame.nativeStrokeInactive.strokeWeight, 4);
  assert.equal(frame.nativeStrokeInactive.strokeAlign, "OUTSIDE");
  assert.deepEqual(f.errors, []);
});
