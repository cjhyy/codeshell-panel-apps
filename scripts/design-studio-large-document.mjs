import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../apps/design-studio/app/document.mjs";

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

const documentSource = serializeDesignDocument(
  normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: "Large repository design",
    canvas: { width: 1_800, height: 1_440, background: "#ffffff" },
    tokens: { colors: [] },
    activePageId: "page-1",
    pages: Array.from({ length: 2 }, (_, pageIndex) => ({
      id: `page-${pageIndex + 1}`,
      name: `Large page ${pageIndex + 1}`,
      children: Array.from({ length: 350 }, (_, index) =>
        baseRectangle(pageIndex, index),
      ),
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
    ({ path, source }) => {
      const prefix = "codeshell-design-studio:";
      localStorage.setItem(`${prefix}file:${path}`, source);
      localStorage.setItem(`${prefix}mtime:${path}`, "1000");
    },
    { path: DESIGN_PATH, source: documentSource },
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
  await page.locator("#save").click();
  await page.waitForFunction(
    () => document.querySelector("#save-state")?.dataset.kind === "saved",
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
  await page.locator("#layers-tab-button").click();
  const layerCount = await page.locator("#layers-list .layer-row").count();
  if (layerCount !== 350) {
    throw new Error(`Reloaded index exposed ${layerCount} active-page layers instead of 350`);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        passed: true,
        sourceBytes,
        ...persisted,
        partModifiedAt: undefined,
        unchangedPagesReused: unchangedPartsReused,
        reloadedLayerCount: layerCount,
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
