import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  launchCanvasBrowser,
  canvasCsp,
  canvasContentType,
  observeCanvasPage,
  assertCanvasClean,
  waitForCanvas,
  canvasNode,
  canvasPoint,
} from "../tests/apps/design-studio/canvas-ui-fixture.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../apps/design-studio/app/document.mjs";
import { createDesignResourcePersistencePlan } from "../apps/design-studio/app/resource-store.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const DESIGN_PATH = "designs/large-document.codesign.json";
async function saveFromToolbar(page) {
  if (await page.locator("#compact-actions").getAttribute("open") === null) {
    await page.locator("#compact-actions summary").click();
  }
  await page.locator("#save").click();
}
// IDB probes return Promises: poll their resolved values explicitly. A
// Promise itself is truthy even when a page wait's first result resolves false.
async function waitForBrowserValue(page, probe, argument) {
  const deadline = Date.now() + 30000;
  let last;
  while (Date.now() < deadline) {
    last = await page.evaluate(probe, argument);
    if (last) return last;
    await page.waitForTimeout(25);
  }
  throw new Error(`Browser persistence probe timed out: ${JSON.stringify(last)}`);
}
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
]);

function safeFilePath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl ?? "/", "http://localhost").pathname);
  const candidate = resolve(REPOSITORY_ROOT, `.${pathname}`);
  if (candidate !== REPOSITORY_ROOT && !candidate.startsWith(`${REPOSITORY_ROOT}${sep}`)) {
    return null;
  }
  return candidate;
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    const filePath = safeFilePath(request.url);
    if (!filePath) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const content = await readFile(filePath);
      response.setHeader(
        "content-type",
        MIME_TYPES.get(extname(filePath)) ?? canvasContentType(filePath),
      );
      response.setHeader("cache-control", "no-store");
      response.setHeader("content-security-policy", canvasCsp);
      response.end(content);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("Not found");
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Static server did not bind");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function baseRectangle(pageIndex, index) {
  const sequence = pageIndex * 350 + index + 1;
  return {
    id: `large-layer-${sequence}`,
    type: "rectangle",
    name: `Large layer ${sequence}`,
    notes: `Repository-scale design metadata ${sequence} `.repeat(6).slice(0, 180),
    x: (index % 25) * 72,
    y: Math.floor(index / 25) * 72,
    width: 64,
    height: 64,
    fill: sequence % 2 === 0 ? "#5b5bd6" : "#f0f0ff",
    stroke: "transparent",
    strokeWidth: 0,
    opacity: 1,
    rotation: 0,
    cornerRadius: 8,
    visible: true,
    locked: false,
  };
}

const pixelBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const pixelResourcePlan = await createDesignResourcePersistencePlan({
  id: "large-pixel",
  kind: "image",
  mime: "image/png",
  base64: pixelBase64,
  sha256Bytes: async (bytes) => createHash("sha256").update(bytes).digest("hex"),
});
const fontBytes = await readFile(
  resolve(REPOSITORY_ROOT, "apps/design-studio/app/fonts/Roboto-Variable.ttf"),
);
const fontResourcePlan = await createDesignResourcePersistencePlan({
  id: "large-font",
  kind: "font",
  mime: "font/ttf",
  base64: fontBytes.toString("base64"),
  family: "CodeShell Resource Test",
  weight: 400,
  style: "normal",
  sha256Bytes: async (bytes) => createHash("sha256").update(bytes).digest("hex"),
});
const documentSource = serializeDesignDocument(
  normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: "Large repository design",
    canvas: { width: 1_800, height: 1_440, background: "#ffffff" },
    tokens: { colors: [] },
    resources: [pixelResourcePlan.descriptor, fontResourcePlan.descriptor],
    activePageId: "page-1",
    pages: Array.from({ length: 2 }, (_, pageIndex) => ({
      id: `page-${pageIndex + 1}`,
      name: `Large page ${pageIndex + 1}`,
      children: [
        ...(pageIndex === 0
          ? [
              {
                ...baseRectangle(10, 0),
                id: "large-image",
                type: "image",
                name: "Content-addressed image",
                x: 20,
                y: 1_100,
                imageRef: "large-pixel",
                objectFit: "cover",
                fill: "transparent",
              },
              {
                ...baseRectangle(10, 1),
                id: "large-font-text",
                type: "text",
                name: "Content-addressed font",
                x: 140,
                y: 1_100,
                text: "A",
                fontSize: 16,
                fontWeight: 400,
                fontFamily: "sans-serif",
                fontRef: "large-font",
                fontStyle: "normal",
                lineHeight: 1.2,
                letterSpacing: 0,
                textDecoration: "none",
                textAlign: "left",
                cornerRadius: 0,
                fill: "#111111",
              },
            ]
          : []),
        ...Array.from({ length: 350 }, (_, index) =>
          baseRectangle(pageIndex, index),
        ),
      ],
    })),
  }),
);
const sourceBytes = new TextEncoder().encode(documentSource).length;
if (sourceBytes <= 384 * 1024) throw new Error("Large-document fixture did not exceed 384 KiB");
if (sourceBytes > 480 * 1024) {
  throw new Error("Large-document migration fixture exceeded the Host read budget");
}

const server = await startStaticServer();
const browser = await launchCanvasBrowser();
const page = await browser.newPage({ viewport: { width: 1_280, height: 800 } });
const errors = [];
const pendingRequests = new Set();
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => pendingRequests.add(request.url()));
page.on("requestfinished", (request) => pendingRequests.delete(request.url()));
page.on("requestfailed", (request) => pendingRequests.delete(request.url()));
try {
  await observeCanvasPage(page, { offlineTools: true });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort(),
  );
  await page.addInitScript(
    ({ path, source, resourceParts }) => {
      if (window.top !== window) return;
      // Probe the same public browser backend used by the app. Keep the LS
      // seed as an actual old-package migration input; never rewrite it.
      let store;
      globalThis.__largeDocumentReadText = async path => {
        store ??= import("/apps/design-studio/app/browser-store.mjs").then(api => api.createBrowserStore());
        return (await store).call("workspace.readText", { path });
      };
      globalThis.__largeDocumentRecords = () => new Promise((resolve, reject) => {
        const request = indexedDB.open("codeshell-design-studio-v1", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction("records", "readonly"), read = tx.objectStore("records").getAll(IDBKeyRange.bound("storage:recovery.", "storage:recovery.\uffff"));
          let records;
          read.onsuccess = () => { records = read.result; };
          tx.oncomplete = () => { db.close(); resolve(records.filter(record => !record.deleted)); };
          tx.onabort = () => { db.close(); reject(tx.error); };
        };
      });
      const prefix = "codeshell-design-studio:";
      if (localStorage.getItem(`${prefix}file:${path}`) == null) {
        localStorage.setItem(`${prefix}file:${path}`, source);
        localStorage.setItem(`${prefix}mtime:${path}`, "1000");
        for (const part of resourceParts) {
          localStorage.setItem(`${prefix}file:${part.path}`, part.content);
          localStorage.setItem(`${prefix}mtime:${part.path}`, "1000");
        }
      }
    },
    {
      path: DESIGN_PATH,
      source: documentSource,
      resourceParts: [...pixelResourcePlan.parts, ...fontResourcePlan.parts],
    },
  );
  await page.goto(`${server.origin}/apps/design-studio/app/index.html`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    (path) =>
      document.querySelector("#document-path")?.value === path &&
      document.querySelector("#save-state")?.dataset.kind === "saved",
    DESIGN_PATH,
  );
  await waitForCanvas(page);
  await saveFromToolbar(page);
  await waitForBrowserValue(page,
    async (path) => {
      if (document.querySelector("#save-state")?.dataset.kind !== "saved") return false;
      try { return JSON.parse((await __largeDocumentReadText(path)).content).format === "codeshell.design.index"; }
      catch { return false; }
    },
    DESIGN_PATH,
  );
  const persisted = await page.evaluate(async ({ path, expectedSource }) => {
    const prefix = "codeshell-design-studio:";
    if (localStorage.getItem(`${prefix}file:${path}`) !== expectedSource || localStorage.getItem(`${prefix}mtime:${path}`) !== "1000")
      throw Error("Migration changed the original legacy source or mtime");
    const primary = await __largeDocumentReadText(path);
    const manifest = JSON.parse(primary.content);
    const partPath = (sha256, index) =>
      `designs/codesign-data/pages/${sha256.slice(0, 16)}/${sha256}-${String(index + 1).padStart(4, "0")}.txt`;
    const pageRecords = await Promise.all(manifest.pages.map(async (descriptor) => {
      const parts = await Promise.all(Array.from({ length: descriptor.partCount }, async (_, index) => {
        const path = partPath(descriptor.sha256, index), record = await __largeDocumentReadText(path);
        return { path, content: record.content, modifiedAt: record.modifiedAt, revision: record.revision };
      }));
      return { descriptor, parts, page: JSON.parse(parts.map((part) => part.content).join("")) };
    }));
    const reconstructed = `${JSON.stringify(
      {
        format: "codeshell.design",
        version: 3,
        name: manifest.name,
        canvas: manifest.canvas,
        tokens: manifest.tokens,
        resources: manifest.resources ?? [],
        activePageId: manifest.activePageId,
        pages: pageRecords.map(({ page }) => ({
          id: page.id,
          name: page.name,
          children: page.children,
        })),
      },
      null,
      2,
    )}\n`;
    return {
      format: manifest.format,
      pageCount: manifest.pages.length,
      totalNodeCount: manifest.pages.reduce((sum, item) => sum + item.nodeCount, 0),
      partCount: pageRecords.reduce((sum, item) => sum + item.parts.length, 0),
      partModifiedAt: pageRecords.flatMap((item) =>
        item.parts.map((part) => [part.path, part.modifiedAt, part.revision]),
      ),
      reconstructed: reconstructed === expectedSource,
    };
  }, { path: DESIGN_PATH, expectedSource: documentSource });
  if (!persisted.reconstructed) throw new Error("Saved design index did not reconstruct exactly");
  await page.waitForTimeout(20);
  const primaryBeforeSecondSave = await page.evaluate(path => __largeDocumentReadText(path), DESIGN_PATH);
  await saveFromToolbar(page);
  await waitForBrowserValue(page,
    async ({ path, previous }) => {
      if (document.querySelector("#save-state")?.dataset.kind !== "saved") return false;
      const current = await __largeDocumentReadText(path);
      return current.modifiedAt !== previous.modifiedAt && current.revision !== previous.revision;
    },
    { path: DESIGN_PATH, previous: primaryBeforeSecondSave },
  );
  const unchangedPartsReused = await page.evaluate(async (previousEntries) =>
    (await Promise.all(previousEntries.map(async ([path, modifiedAt, revision]) => {
      const current = await __largeDocumentReadText(path);
      return current.modifiedAt === modifiedAt && current.revision === revision;
    }))).every(Boolean), persisted.partModifiedAt);
  if (!unchangedPartsReused) {
    throw new Error("Unchanged indexed pages were rewritten");
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (path) =>
      document.querySelector("#document-path")?.value === path &&
      document.querySelector("#save-state")?.dataset.kind === "saved",
    DESIGN_PATH,
  );
  await waitForCanvas(page);
  const lazyOpen = await page.evaluate(async (path) => {
    const manifest = JSON.parse((await __largeDocumentReadText(path)).content);
    const descriptor = manifest.pages.find((page) => page.id === "page-2");
    if (!descriptor?.sha256) {
      return {
        format: manifest.format,
        pageIds: manifest.pages.map((page) => page.id),
        inactivePartPath: null,
        inactiveReadBeforeSwitch: null,
        reads: [...(globalThis.__designStudioMockReads ?? [])],
      };
    }
    const inactivePartPath =
      `designs/codesign-data/pages/${descriptor.sha256.slice(0, 16)}/` +
      `${descriptor.sha256}-0001.txt`;
    const reads = globalThis.__designStudioMockReads ?? [];
    return {
      inactivePartPath,
      inactiveReadBeforeSwitch: reads.includes(inactivePartPath),
      reads: [...reads],
    };
  }, DESIGN_PATH);
  if (!lazyOpen.inactivePartPath) {
    throw new Error(`Reloaded source was not a two-page index: ${JSON.stringify(lazyOpen)}`);
  }
  if (lazyOpen.inactiveReadBeforeSwitch) {
    throw new Error("Indexed open eagerly read the inactive page");
  }
  const layerCount = await page.locator("#layers-list .layer-row").count();
  if (layerCount !== 352) {
    throw new Error(`Reloaded index exposed ${layerCount} active-page layers instead of 352`);
  }
  // Resources occupy their own uncovered part of the fixture. Inspect the real
  // GPU surface after a public fit-selection action, rather than old SVG nodes.
  async function resourcePixels(id, inset = 1) {
    const node = await canvasNode(page, id);
    await page.locator(`.layer-row[data-id="${id}"]`).click();
    await page.locator("#stage").focus();
    await page.keyboard.press("Shift+Digit2");
    await waitForCanvas(page);
    await page.keyboard.press("Escape");
    await waitForCanvas(page);
    const topLeft = await canvasPoint(page, node.x, node.y);
    const bottomRight = await canvasPoint(page, node.x + node.width, node.y + node.height);
    const bounds = await page.locator("#gpu-canvas").boundingBox();
    const png = PNG.sync.read(await page.locator("#gpu-canvas").screenshot());
    const x = Math.round(((topLeft.x - bounds.x) * png.width) / bounds.width);
    const y = Math.round(((topLeft.y - bounds.y) * png.height) / bounds.height);
    const width = Math.round(((bottomRight.x - topLeft.x) * png.width) / bounds.width);
    const height = Math.round(((bottomRight.y - topLeft.y) * png.height) / bounds.height);
    if (
      width <= 0 ||
      height <= 0 ||
      x < 0 ||
      y < 0 ||
      x + width > png.width ||
      y + height > png.height
    )
      throw new Error(`Resource ${id} is not fully visible on the GPU surface`);
    const colors = [];
    // Selection is cleared above. The image's rounded corners are deliberately
    // outside its central sample; font ink uses the complete node interior.
    const padding = inset < 1 ? Math.ceil(Math.min(width, height) * inset) : inset;
    for (let row = y + padding; row < y + height - padding; row++)
      for (let column = x + padding; column < x + width - padding; column++)
        colors.push([
          ...png.data.subarray((row * png.width + column) * 4, (row * png.width + column) * 4 + 4),
        ]);
    if (!colors.length) throw new Error(`Resource ${id} has no sampled GPU pixels`);
    return { node, colors };
  }
  const imagePixels = await resourcePixels("large-image", 0.25);
  const expectedPixel = [...PNG.sync.read(Buffer.from(pixelBase64, "base64")).data];
  if (
    imagePixels.node.imageRef !== pixelResourcePlan.descriptor.id ||
    !imagePixels.colors.every((pixel) =>
      pixel.every((value, index) => Math.abs(value - expectedPixel[index]) <= 1),
    )
  ) {
    throw new Error(
      `Content-addressed image bytes did not paint the GPU surface: ${JSON.stringify({ reference: imagePixels.node.imageRef, colors: [...new Set(imagePixels.colors.map((pixel) => pixel.join(",")))].slice(0, 20), expectedPixel })}`,
    );
  }
  const fontPixels = await resourcePixels("large-font-text");
  const renderedResourceFont = await page.evaluate(() => {
    return {
      loadedFaces: [...document.fonts].filter(
        (face) =>
          face.family.replaceAll('"', "") === "CodeShell Resource Test" && face.status === "loaded",
      ).length,
      loaded: document.fonts.check('400 16px "CodeShell Resource Test"'),
    };
  });
  if (
    fontPixels.node.fontRef !== fontResourcePlan.descriptor.id ||
    renderedResourceFont.loadedFaces < 1 ||
    renderedResourceFont.loaded !== true ||
    !fontPixels.colors.some((pixel) => pixel.slice(0, 3).every((value) => value < 80))
  ) {
    throw new Error("Content-addressed font did not load and render from fontRef");
  }
  await page.locator("#active-page").selectOption("page-2");
  await page.waitForFunction(
    (inactivePartPath) =>
      (globalThis.__designStudioMockReads ?? []).includes(inactivePartPath) &&
      document.querySelector("#active-page")?.value === "page-2",
    lazyOpen.inactivePartPath,
  );
  await waitForCanvas(page);
  const switchedLayerCount = await page.locator("#layers-list .layer-row").count();
  if (switchedLayerCount !== 350) {
    throw new Error(`Lazy page switch exposed ${switchedLayerCount} layers instead of 350`);
  }
  await page.locator('.layer-row[data-id="large-layer-351"]').click();
  await page.locator("#design-tab-button").click();
  await page.locator("#prop-name").fill("Recovered layer 351");
  await page.locator("#prop-name").blur();
  await page.waitForFunction(() => document.querySelector("#save-state")?.dataset.kind === "dirty");
  const recoveryObservation = await waitForBrowserValue(page, async () => {
    for (const record of await __largeDocumentRecords()) {
      if (!record.key.startsWith("storage:recovery.")) continue;
      const value = JSON.parse(record.content);
      if (value?.format === "codeshell.design.recovery" && value.design === undefined && value.record?.operations?.length > 0) {
        return { key: record.key, source: record.content };
      }
    }
    return false;
  });
  // Retain the exact committed record returned by the predicate, rather than
  // racing autosave with a second database read or sharing poll-world globals.
  if (typeof recoveryObservation?.source !== "string")
    throw new Error(`Missing recovery observation: ${JSON.stringify(recoveryObservation)}`);
  const recoveryValue = JSON.parse(recoveryObservation.source);
  const recoveryLog = {
    bytes: new TextEncoder().encode(recoveryObservation.source).length,
    operationCount: recoveryValue.record.operations.length,
    containsWholeDesign: Object.hasOwn(recoveryValue, "design"),
  };
  if (!recoveryLog || recoveryLog.containsWholeDesign) {
    throw new Error("Recovery persisted a whole-document snapshot instead of operations");
  }
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (path) =>
      document.querySelector("#document-path")?.value === path &&
      document.querySelector("#save-state")?.dataset.kind === "dirty" &&
      document.querySelector("#active-page")?.value === "page-2",
    DESIGN_PATH,
  );
  await waitForCanvas(page);
  await page.locator('.layer-row[data-id="large-layer-351"]').click();
  await page.locator("#design-tab-button").click();
  if ((await page.locator("#prop-name").inputValue()) !== "Recovered layer 351") {
    throw new Error("Operation-log recovery did not restore the cross-page node edit");
  }
  await page.locator("#stage").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => document.querySelector("#active-page")?.value === "page-1");
  await page.keyboard.press("Control+Shift+z");
  await page.waitForFunction(() => document.querySelector("#active-page")?.value === "page-2");
  await page.locator('.layer-row[data-id="large-layer-351"]').click();
  await page.locator("#design-tab-button").click();
  if ((await page.locator("#prop-name").inputValue()) !== "Recovered layer 351") {
    throw new Error("Redo did not replay the recovered operation record");
  }
  await assertCanvasClean(page);
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  process.stdout.write(
    `${JSON.stringify(
      {
        passed: true,
        sourceBytes,
        ...persisted,
        partModifiedAt: undefined,
        unchangedPagesReused: unchangedPartsReused,
        inactivePageDeferredUntilSwitch: true,
        contentAddressedImageRendered: true,
        contentAddressedFontRendered: true,
        gpuRenderer: "CanvasKit WebGL2",
        operationLogRecovery: true,
        recoveryOperationCount: recoveryLog.operationCount,
        recoveryBytes: recoveryLog.bytes,
        reloadedLayerCount: layerCount,
        switchedLayerCount,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  console.error("Large-document browser diagnostics", {
    errors,
    pendingRequests: [...pendingRequests],
  });
  throw error;
} finally {
  await page.close();
  await browser.close();
  await server.close();
}
