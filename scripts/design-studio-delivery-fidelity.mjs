import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { compareDesignDocuments } from "../apps/design-studio/app/design-compare.mjs";
import { exportDesignFrontend } from "../apps/design-studio/app/frontend-export.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const FIXTURE_PATH = "/tests/fixtures/design-studio-html-capture/index.html";
const VIEWPORT = { width: 960, height: 640 };
const THRESHOLDS = {
  similarity: 0.88,
  changedPixelRatio24: 0.18,
  stableIdCoverage: 0.9,
  maximumGeometryDelta: 24,
};
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

function outputArgument() {
  const index = process.argv.indexOf("--output");
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--output requires a directory");
  return resolve(process.cwd(), value);
}

function safeFilePath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl ?? "/", "http://localhost").pathname);
  const candidate = resolve(REPOSITORY_ROOT, `.${pathname}`);
  if (candidate !== REPOSITORY_ROOT && !candidate.startsWith(`${REPOSITORY_ROOT}${sep}`)) {
    return null;
  }
  return candidate;
}

async function startStaticServer(generatedSource) {
  const server = createServer(async (request, response) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname === "/__delivery.html") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(generatedSource());
      return;
    }
    const filePath = safeFilePath(request.url);
    if (!filePath) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const content = await readFile(filePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": MIME_TYPES.get(extname(filePath)) ?? "application/octet-stream",
      });
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

function comparePngBuffers(expectedBuffer, actualBuffer) {
  const expected = PNG.sync.read(expectedBuffer);
  const actual = PNG.sync.read(actualBuffer);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(
      `Screenshot dimensions differ: ${expected.width}×${expected.height} vs ${actual.width}×${actual.height}`,
    );
  }
  const pixels = expected.width * expected.height;
  const diff = new PNG({ width: expected.width, height: expected.height });
  let absoluteDifference = 0;
  let changed24 = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const red = Math.abs(expected.data[offset] - actual.data[offset]);
    const green = Math.abs(expected.data[offset + 1] - actual.data[offset + 1]);
    const blue = Math.abs(expected.data[offset + 2] - actual.data[offset + 2]);
    const delta = Math.max(red, green, blue);
    absoluteDifference += red + green + blue;
    if (delta > 24) changed24 += 1;
    diff.data[offset] = delta > 24 ? Math.min(255, delta * 4) : 246;
    diff.data[offset + 1] = delta > 24 ? 40 : 246;
    diff.data[offset + 2] = delta > 24 ? Math.min(255, delta * 2) : 246;
    diff.data[offset + 3] = 255;
  }
  return {
    expected,
    actual,
    diff,
    metrics: {
      width: expected.width,
      height: expected.height,
      meanAbsoluteChannelError: absoluteDifference / pixels / 3,
      changedPixelRatio24: changed24 / pixels,
      similarity: 1 - absoluteDifference / pixels / 3 / 255,
    },
  };
}

function sideBySide(expected, actual) {
  const gap = 24;
  const result = new PNG({
    width: expected.width + gap + actual.width,
    height: Math.max(expected.height, actual.height),
    fill: true,
    colorType: 6,
  });
  result.data.fill(255);
  PNG.bitblt(expected, result, 0, 0, expected.width, expected.height, 0, 0);
  PNG.bitblt(
    actual,
    result,
    0,
    0,
    actual.width,
    actual.height,
    expected.width + gap,
    0,
  );
  return result;
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

const outputDir =
  outputArgument() ?? (await mkdtemp(join(tmpdir(), "design-delivery-fidelity-")));
let generatedHtml = "";
const server = await startStaticServer(() => generatedHtml);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(`${server.origin}${FIXTURE_PATH}?mode=converted&delivery=1`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => document.documentElement.dataset.qaReady === "true");
  const fixtureError = await page.evaluate(
    () => document.documentElement.dataset.qaError ?? null,
  );
  if (fixtureError) throw new Error(fixtureError);
  const sourceText = await page.locator("#qa-design").textContent();
  const sourceDesign = JSON.parse(sourceText);
  const designScreenshot = await page
    .locator("svg[data-qa-render]")
    .screenshot({ animations: "disabled", caret: "hide" });

  generatedHtml = exportDesignFrontend(sourceDesign);
  await page.goto(`${server.origin}/__delivery.html`, { waitUntil: "networkidle" });
  const frontendScreenshot = await page
    .locator(".cs-page")
    .screenshot({ animations: "disabled", caret: "hide" });
  const roundTripDesign = await page.evaluate(async () => {
    const { captureHtmlToDesign } = await import(
      "/apps/design-studio/app/html-capture.mjs?delivery=1"
    );
    const root = document.querySelector(".cs-page");
    return captureHtmlToDesign(root, {
      name: "Generated frontend round trip",
      captureBounds: {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      },
    });
  });
  const pixels = comparePngBuffers(designScreenshot, frontendScreenshot);
  const structure = compareDesignDocuments(sourceDesign, roundTripDesign);
  const metrics = {
    ...Object.fromEntries(
      Object.entries(pixels.metrics).map(([key, value]) => [
        key,
        typeof value === "number" ? rounded(value) : value,
      ]),
    ),
    stableIdCoverage: structure.coverage,
    stableIdCloseRate: structure.closeRate,
    maximumGeometryDelta: structure.maximumGeometryDelta,
    missingNodeCount: structure.missingNodeCount,
    unexpectedNodeCount: structure.unexpectedNodeCount,
    styleDifferenceCount: structure.styleDifferenceCount,
  };
  const passed =
    metrics.similarity >= THRESHOLDS.similarity &&
    metrics.changedPixelRatio24 <= THRESHOLDS.changedPixelRatio24 &&
    metrics.stableIdCoverage >= THRESHOLDS.stableIdCoverage &&
    metrics.maximumGeometryDelta <= THRESHOLDS.maximumGeometryDelta;
  const report = {
    passed,
    thresholds: THRESHOLDS,
    metrics,
    sourceNodeCount: structure.expectedNodeCount,
    roundTripNodeCount: structure.actualNodeCount,
    generatedBytes: new TextEncoder().encode(generatedHtml).length,
    fixture: relative(REPOSITORY_ROOT, resolve(REPOSITORY_ROOT, `.${FIXTURE_PATH}`)),
  };

  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(join(outputDir, "design.png"), designScreenshot),
    writeFile(join(outputDir, "frontend.png"), frontendScreenshot),
    writeFile(join(outputDir, "pixel-diff.png"), PNG.sync.write(pixels.diff)),
    writeFile(
      join(outputDir, "side-by-side.png"),
      PNG.sync.write(sideBySide(pixels.expected, pixels.actual)),
    ),
    writeFile(join(outputDir, "generated.html"), generatedHtml),
    writeFile(
      join(outputDir, "round-trip.codesign.json"),
      `${JSON.stringify(roundTripDesign, null, 2)}\n`,
    ),
    writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`),
  ]);
  process.stdout.write(`${JSON.stringify({ ...report, outputDir }, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
