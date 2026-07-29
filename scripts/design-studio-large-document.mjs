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

function baseRectangle(index) {
  return {
    id: `large-layer-${index + 1}`,
    type: "rectangle",
    name: `Large layer ${index + 1}`,
    notes: `Repository-scale design metadata ${index + 1} `.repeat(10).slice(0, 360),
    x: (index % 25) * 72,
    y: Math.floor(index / 25) * 72,
    width: 64,
    height: 64,
    fill: index % 2 === 0 ? "#5b5bd6" : "#f0f0ff",
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
    pages: [
      {
        id: "page-1",
        name: "Large page",
        children: Array.from({ length: 500 }, (_, index) => baseRectangle(index)),
      },
    ],
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
        return JSON.parse(source).format === "codeshell.design.bundle";
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
    const parts = manifest.parts.map((part) => ({
      ...part,
      content: localStorage.getItem(`${prefix}file:${part.path}`),
    }));
    return {
      format: manifest.format,
      bytes: manifest.bytes,
      partCount: parts.length,
      maximumPartBytes: Math.max(...parts.map((part) => part.bytes)),
      reconstructed: parts.map((part) => part.content).join("") === expectedSource,
    };
  }, { path: DESIGN_PATH, expectedSource: documentSource });
  if (!persisted.reconstructed) throw new Error("Saved design bundle did not reconstruct exactly");
  const removedPartPath = await page.evaluate((path) => {
    const prefix = "codeshell-design-studio:";
    const manifest = JSON.parse(localStorage.getItem(`${prefix}file:${path}`));
    const partPath = manifest.parts.at(-1).path;
    localStorage.removeItem(`${prefix}file:${partPath}`);
    localStorage.removeItem(`${prefix}mtime:${partPath}`);
    return partPath;
  }, DESIGN_PATH);
  await page.locator("#save").click();
  await page.waitForFunction(
    (path) => localStorage.getItem(`codeshell-design-studio:file:${path}`) != null,
    removedPartPath,
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    (path) =>
      document.querySelector("#document-path")?.value === path &&
      document.querySelector("#save-state")?.dataset.kind === "saved",
    DESIGN_PATH,
  );
  await page.locator("#layers-tab-button").click();
  const layerCount = await page.locator("#layers-list .layer-row").count();
  if (layerCount !== 500) {
    throw new Error(`Reloaded bundle exposed ${layerCount} layers instead of 500`);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        passed: true,
        sourceBytes,
        ...persisted,
        interruptedSaveRecovered: true,
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
