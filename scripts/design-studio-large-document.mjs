import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../apps/design-studio/app/document.mjs";
import { createDesignResourcePersistencePlan } from "../apps/design-studio/app/resource-store.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const DESIGN_PATH = "designs/large-document.codesign.json";
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
        MIME_TYPES.get(extname(filePath)) ?? "application/octet-stream",
      );
      response.setHeader("cache-control", "no-store");
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
  resolve(
    REPOSITORY_ROOT,
    "node_modules/playwright-core/lib/vite/traceViewer/codicon.DCmgc-ay.ttf",
  ),
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
                imageRef: "large-pixel",
                objectFit: "cover",
                fill: "transparent",
              },
              {
                ...baseRectangle(10, 1),
                id: "large-font-text",
                type: "text",
                name: "Content-addressed font",
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
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1_280, height: 800 } });
try {
  await page.addInitScript(
    ({ path, source, resourceParts }) => {
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
    waitUntil: "networkidle",
  });
  await page.waitForFunction(
    (path) =>
      document.querySelector("#document-path")?.value === path &&
      document.querySelector("#save-state")?.dataset.kind === "saved",
    DESIGN_PATH,
  );
  await page.locator("#save").click();
  await page.waitForFunction(
    (path) => {
      const source = localStorage.getItem(`codeshell-design-studio:file:${path}`);
      if (!source) return false;
      try {
        return JSON.parse(source).format === "codeshell.design.index";
      } catch {
        return false;
      }
    },
    DESIGN_PATH,
  );
  const persisted = await page.evaluate(({ path, expectedSource }) => {
    const prefix = "codeshell-design-studio:";
    const primary = localStorage.getItem(`${prefix}file:${path}`);
    const manifest = JSON.parse(primary);
    const partPath = (sha256, index) =>
      `designs/codesign-data/pages/${sha256.slice(0, 16)}/${sha256}-${String(index + 1).padStart(4, "0")}.txt`;
    const pageRecords = manifest.pages.map((descriptor) => {
      const parts = Array.from({ length: descriptor.partCount }, (_, index) => {
        const path = partPath(descriptor.sha256, index);
        return {
          path,
          content: localStorage.getItem(`${prefix}file:${path}`),
          modifiedAt: localStorage.getItem(`${prefix}mtime:${path}`),
        };
      });
      return { descriptor, parts, page: JSON.parse(parts.map((part) => part.content).join("")) };
    });
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
        item.parts.map((part) => [part.path, part.modifiedAt]),
      ),
      reconstructed: reconstructed === expectedSource,
    };
  }, { path: DESIGN_PATH, expectedSource: documentSource });
  if (!persisted.reconstructed) throw new Error("Saved design index did not reconstruct exactly");
  await page.waitForTimeout(20);
  const primaryModifiedAtBeforeSecondSave = await page.evaluate((path) =>
    localStorage.getItem(`codeshell-design-studio:mtime:${path}`),
  DESIGN_PATH);
  await page.locator("#save").click();
  await page.waitForFunction(
    ({ path, previousModifiedAt }) =>
      localStorage.getItem(`codeshell-design-studio:mtime:${path}`) !==
        previousModifiedAt &&
      document.querySelector("#save-state")?.dataset.kind === "saved",
    { path: DESIGN_PATH, previousModifiedAt: primaryModifiedAtBeforeSecondSave },
  );
  const unchangedPartsReused = await page.evaluate((previousEntries) => {
    const prefix = "codeshell-design-studio:";
    return previousEntries.every(
      ([path, modifiedAt]) =>
        localStorage.getItem(`${prefix}mtime:${path}`) === modifiedAt,
    );
  }, persisted.partModifiedAt);
  if (!unchangedPartsReused) {
    throw new Error("Unchanged indexed pages were rewritten");
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    (path) =>
      document.querySelector("#document-path")?.value === path &&
      document.querySelector("#save-state")?.dataset.kind === "saved",
    DESIGN_PATH,
  );
  const lazyOpen = await page.evaluate((path) => {
    const prefix = "codeshell-design-studio:";
    const manifest = JSON.parse(localStorage.getItem(`${prefix}file:${path}`));
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
  await page.locator("#layers-tab-button").click();
  const layerCount = await page.locator("#layers-list .layer-row").count();
  if (layerCount !== 352) {
    throw new Error(`Reloaded index exposed ${layerCount} active-page layers instead of 352`);
  }
  const renderedResourceImage = await page
    .locator('image[data-node-id="large-image"]')
    .getAttribute("href");
  if (!renderedResourceImage?.startsWith("data:image/png;base64,")) {
    throw new Error("Content-addressed image did not render from its resource reference");
  }
  const renderedResourceFont = await page.evaluate(() => {
    const text = document.querySelector('text[data-node-id="large-font-text"]');
    return {
      family: text?.getAttribute("font-family"),
      loaded: document.fonts.check('400 16px "CodeShell Resource Test"'),
    };
  });
  if (
    renderedResourceFont.family !== "CodeShell Resource Test" ||
    renderedResourceFont.loaded !== true
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
  const switchedLayerCount = await page.locator("#layers-list .layer-row").count();
  if (switchedLayerCount !== 350) {
    throw new Error(
      `Lazy page switch exposed ${switchedLayerCount} layers instead of 350`,
    );
  }
  await page.locator('.layer-row[data-id="large-layer-351"]').click();
  await page.locator("#design-tab-button").click();
  await page.locator("#prop-name").fill("Recovered layer 351");
  await page.locator("#prop-name").blur();
  await page.waitForFunction(
    () => document.querySelector("#save-state")?.dataset.kind === "dirty",
  );
  await page.waitForFunction(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.includes("storage:recovery.")) continue;
      const value = JSON.parse(localStorage.getItem(key));
      return (
        value?.format === "codeshell.design.recovery" &&
        value.design === undefined &&
        value.record?.operations?.length > 0
      );
    }
    return false;
  });
  const recoveryLog = await page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.includes("storage:recovery.")) continue;
      const source = localStorage.getItem(key);
      const value = JSON.parse(source);
      if (value?.format === "codeshell.design.recovery") {
        return {
          bytes: new TextEncoder().encode(source).length,
          operationCount: value.record.operations.length,
          containsWholeDesign: Object.hasOwn(value, "design"),
        };
      }
    }
    return null;
  });
  if (!recoveryLog || recoveryLog.containsWholeDesign) {
    throw new Error("Recovery persisted a whole-document snapshot instead of operations");
  }
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    (path) =>
      document.querySelector("#document-path")?.value === path &&
      document.querySelector("#save-state")?.dataset.kind === "dirty" &&
      document.querySelector("#active-page")?.value === "page-2",
    DESIGN_PATH,
  );
  await page.locator("#layers-tab-button").click();
  await page.locator('.layer-row[data-id="large-layer-351"]').click();
  await page.locator("#design-tab-button").click();
  if ((await page.locator("#prop-name").inputValue()) !== "Recovered layer 351") {
    throw new Error("Operation-log recovery did not restore the cross-page node edit");
  }
  await page.locator("#stage").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    () => document.querySelector("#active-page")?.value === "page-1",
  );
  await page.keyboard.press("Control+Shift+z");
  await page.waitForFunction(
    () => document.querySelector("#active-page")?.value === "page-2",
  );
  await page.locator("#layers-tab-button").click();
  await page.locator('.layer-row[data-id="large-layer-351"]').click();
  await page.locator("#design-tab-button").click();
  if ((await page.locator("#prop-name").inputValue()) !== "Recovered layer 351") {
    throw new Error("Redo did not replay the recovered operation record");
  }
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
} finally {
  await page.close();
  await browser.close();
  await server.close();
}
