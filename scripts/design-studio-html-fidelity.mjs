import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const FIXTURE_PATH = "/tests/fixtures/design-studio-html-capture/index.html";
const VIEWPORT = { width: 960, height: 640 };
const THRESHOLDS = {
  windowedSsim: 0.99,
  changedPixelRatio8: 0.01,
  changedPixelRatio24: 0.006,
  reflowWindowedSsim: 0.97,
  reflowChangedPixelRatio8: 0.02,
  reflowChangedPixelRatio24: 0.015,
  blockingIssueCount: 0,
  minimumAutoLayoutCount: 20,
  minimumGridLayoutCount: 1,
  minimumWrapLayoutCount: 1,
  minimumAbsoluteAutoChildCount: 1,
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

async function startStaticServer() {
  const server = createServer(async (request, response) => {
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

async function captureMode(page, origin, mode) {
  await page.goto(`${origin}${FIXTURE_PATH}?mode=${mode}&fidelity=1`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => document.documentElement.dataset.qaReady === "true");
  const state = await page.evaluate(() => ({
    error: document.documentElement.dataset.qaError ?? null,
    nodeCount: Number(document.documentElement.dataset.qaNodeCount ?? 0),
    serializedBytes: Number(document.documentElement.dataset.qaSerializedBytes ?? 0),
    issueCount: Number(document.documentElement.dataset.qaIssueCount ?? 0),
    blockingIssueCount: Number(document.documentElement.dataset.qaBlockingIssueCount ?? 0),
    autoLayoutCount: Number(document.documentElement.dataset.qaAutoLayoutCount ?? 0),
    gridLayoutCount: Number(document.documentElement.dataset.qaGridLayoutCount ?? 0),
    wrapLayoutCount: Number(document.documentElement.dataset.qaWrapLayoutCount ?? 0),
    absoluteAutoChildCount: Number(
      document.documentElement.dataset.qaAbsoluteAutoChildCount ?? 0,
    ),
    manualContainerCount: Number(document.documentElement.dataset.qaManualContainerCount ?? 0),
    issueCodes: JSON.parse(document.documentElement.dataset.qaIssueCodes ?? "{}"),
  }));
  if (state.error) throw new Error(`Fixture ${mode} failed:\n${state.error}`);
  const locator =
    mode === "source" ? page.locator("#fixture") : page.locator("svg[data-qa-render]");
  const screenshot = await locator.screenshot({ animations: "disabled", caret: "hide" });
  const designSource = await page.locator("#qa-design").textContent();
  return { screenshot, state, designSource };
}

function luminance(data, pixelIndex) {
  const offset = pixelIndex * 4;
  return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
}

function ssimForIndices(left, right, indices) {
  const count = indices.length;
  let leftMean = 0;
  let rightMean = 0;
  for (const index of indices) {
    leftMean += luminance(left, index);
    rightMean += luminance(right, index);
  }
  leftMean /= count;
  rightMean /= count;
  let leftVariance = 0;
  let rightVariance = 0;
  let covariance = 0;
  for (const index of indices) {
    const leftDelta = luminance(left, index) - leftMean;
    const rightDelta = luminance(right, index) - rightMean;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
    covariance += leftDelta * rightDelta;
  }
  const denominator = Math.max(1, count - 1);
  leftVariance /= denominator;
  rightVariance /= denominator;
  covariance /= denominator;
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  return (
    ((2 * leftMean * rightMean + c1) * (2 * covariance + c2)) /
    ((leftMean ** 2 + rightMean ** 2 + c1) * (leftVariance + rightVariance + c2))
  );
}

function comparePngBuffers(sourceBuffer, convertedBuffer) {
  const source = PNG.sync.read(sourceBuffer);
  const converted = PNG.sync.read(convertedBuffer);
  if (source.width !== converted.width || source.height !== converted.height) {
    throw new Error(
      `Screenshot dimensions differ: ${source.width}×${source.height} vs ${converted.width}×${converted.height}`,
    );
  }
  const pixelCount = source.width * source.height;
  const diff = new PNG({ width: source.width, height: source.height });
  let absoluteError = 0;
  let changed8 = 0;
  let changed24 = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const red = Math.abs(source.data[offset] - converted.data[offset]);
    const green = Math.abs(source.data[offset + 1] - converted.data[offset + 1]);
    const blue = Math.abs(source.data[offset + 2] - converted.data[offset + 2]);
    absoluteError += red + green + blue;
    const maximum = Math.max(red, green, blue);
    if (maximum > 8) changed8 += 1;
    if (maximum > 24) changed24 += 1;
    diff.data[offset] = Math.min(255, red * 6);
    diff.data[offset + 1] = Math.min(255, green * 6);
    diff.data[offset + 2] = Math.min(255, blue * 6);
    diff.data[offset + 3] = 255;
  }

  const allIndices = Array.from({ length: pixelCount }, (_, index) => index);
  const globalSsim = ssimForIndices(source.data, converted.data, allIndices);
  const windowScores = [];
  const windowSize = 8;
  for (let top = 0; top < source.height; top += windowSize) {
    for (let left = 0; left < source.width; left += windowSize) {
      const indices = [];
      for (let y = top; y < Math.min(top + windowSize, source.height); y += 1) {
        for (let x = left; x < Math.min(left + windowSize, source.width); x += 1) {
          indices.push(y * source.width + x);
        }
      }
      windowScores.push(ssimForIndices(source.data, converted.data, indices));
    }
  }
  const windowedSsim =
    windowScores.reduce((total, score) => total + score, 0) / windowScores.length;
  return {
    source,
    converted,
    diff,
    metrics: {
      width: source.width,
      height: source.height,
      meanAbsoluteError: absoluteError / (pixelCount * 3),
      changedPixelRatio8: changed8 / pixelCount,
      changedPixelRatio24: changed24 / pixelCount,
      globalSsim,
      windowedSsim,
    },
  };
}

function sideBySide(source, converted) {
  const gap = 24;
  const result = new PNG({
    width: source.width + gap + converted.width,
    height: Math.max(source.height, converted.height),
    fill: true,
    colorType: 6,
  });
  result.data.fill(255);
  PNG.bitblt(source, result, 0, 0, source.width, source.height, 0, 0);
  PNG.bitblt(converted, result, 0, 0, converted.width, converted.height, source.width + gap, 0);
  return result;
}

function roundedMetrics(metrics) {
  return Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [
      key,
      typeof value === "number" && !Number.isInteger(value) ? Number(value.toFixed(6)) : value,
    ]),
  );
}

const explicitOutput = outputArgument();
const outputDir = explicitOutput ?? (await mkdtemp(join(tmpdir(), "design-fidelity-")));
const server = await startStaticServer();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const source = await captureMode(page, server.origin, "source");
  const converted = await captureMode(page, server.origin, "converted");
  const reflowed = await captureMode(page, server.origin, "converted-reflow");
  const comparison = comparePngBuffers(source.screenshot, converted.screenshot);
  const reflowComparison = comparePngBuffers(source.screenshot, reflowed.screenshot);
  const metrics = roundedMetrics(comparison.metrics);
  const reflowMetrics = roundedMetrics(reflowComparison.metrics);
  const passed =
    metrics.windowedSsim >= THRESHOLDS.windowedSsim &&
    metrics.changedPixelRatio8 <= THRESHOLDS.changedPixelRatio8 &&
    metrics.changedPixelRatio24 <= THRESHOLDS.changedPixelRatio24 &&
    reflowMetrics.windowedSsim >= THRESHOLDS.reflowWindowedSsim &&
    reflowMetrics.changedPixelRatio8 <= THRESHOLDS.reflowChangedPixelRatio8 &&
    reflowMetrics.changedPixelRatio24 <= THRESHOLDS.reflowChangedPixelRatio24 &&
    source.state.blockingIssueCount === THRESHOLDS.blockingIssueCount &&
    reflowed.state.blockingIssueCount === THRESHOLDS.blockingIssueCount &&
    source.state.autoLayoutCount >= THRESHOLDS.minimumAutoLayoutCount &&
    source.state.gridLayoutCount >= THRESHOLDS.minimumGridLayoutCount &&
    source.state.wrapLayoutCount >= THRESHOLDS.minimumWrapLayoutCount &&
    source.state.absoluteAutoChildCount >= THRESHOLDS.minimumAbsoluteAutoChildCount;
  const report = {
    passed,
    thresholds: THRESHOLDS,
    metrics,
    reflowMetrics,
    capture: source.state,
    reflowCapture: reflowed.state,
    fixture: relative(REPOSITORY_ROOT, resolve(REPOSITORY_ROOT, `.${FIXTURE_PATH}`)),
  };

  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(join(outputDir, "source-html.png"), source.screenshot),
    writeFile(join(outputDir, "converted-design.png"), converted.screenshot),
    writeFile(join(outputDir, "captured-design.codesign.json"), converted.designSource),
    writeFile(join(outputDir, "pixel-diff.png"), PNG.sync.write(comparison.diff)),
    writeFile(join(outputDir, "reflowed-design.png"), reflowed.screenshot),
    writeFile(join(outputDir, "reflowed-design.codesign.json"), reflowed.designSource),
    writeFile(join(outputDir, "reflow-pixel-diff.png"), PNG.sync.write(reflowComparison.diff)),
    writeFile(
      join(outputDir, "side-by-side.png"),
      PNG.sync.write(sideBySide(comparison.source, comparison.converted)),
    ),
    writeFile(
      join(outputDir, "reflow-side-by-side.png"),
      PNG.sync.write(sideBySide(reflowComparison.source, reflowComparison.converted)),
    ),
    writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`),
  ]);
  process.stdout.write(`${JSON.stringify({ ...report, outputDir }, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
