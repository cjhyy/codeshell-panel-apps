import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import {
  html2figmaCases,
  html2figmaCatalog,
} from "../tests/fixtures/design-studio-html2figma-cases/cases.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const FIXTURE_PATH = "/tests/fixtures/design-studio-html2figma-cases/index.html";
const THRESHOLDS = {
  windowedSsim: 0.94,
  changedPixelRatio24: 0.08,
  reflowWindowedSsim: 0.87,
  reflowChangedPixelRatio24: 0.12,
  blockingIssueCount: 0,
};
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
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

async function captureMode(page, origin, testCase, mode) {
  const url = new URL(FIXTURE_PATH, origin);
  url.searchParams.set("case", testCase.id);
  url.searchParams.set("mode", mode);
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.dataset.qaReady === "true");
  const state = await page.evaluate(() => ({
    error: document.documentElement.dataset.qaError ?? null,
    nodeCount: Number(document.documentElement.dataset.qaNodeCount ?? 0),
    issueCount: Number(document.documentElement.dataset.qaIssueCount ?? 0),
    blockingIssueCount: Number(document.documentElement.dataset.qaBlockingIssueCount ?? 0),
    autoLayoutCount: Number(document.documentElement.dataset.qaAutoLayoutCount ?? 0),
    gridLayoutCount: Number(document.documentElement.dataset.qaGridLayoutCount ?? 0),
    wrapLayoutCount: Number(document.documentElement.dataset.qaWrapLayoutCount ?? 0),
    absoluteAutoChildCount: Number(
      document.documentElement.dataset.qaAbsoluteAutoChildCount ?? 0,
    ),
    issueCodes: JSON.parse(document.documentElement.dataset.qaIssueCodes ?? "{}"),
  }));
  if (state.error) throw new Error(`${testCase.id} ${mode} failed:\n${state.error}`);
  const locator =
    mode === "source" || mode === "source-reflow"
      ? page.locator("#fixture")
      : page.locator("svg[data-qa-render]");
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
      windowedSsim:
        windowScores.reduce((total, score) => total + score, 0) / windowScores.length,
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

function meetsExpectedCounts(state, expected = {}) {
  return (
    state.autoLayoutCount >= (expected.autoLayouts ?? 0) &&
    state.gridLayoutCount >= (expected.gridLayouts ?? 0) &&
    state.wrapLayoutCount >= (expected.wrapLayouts ?? 0) &&
    state.absoluteAutoChildCount >= (expected.absoluteAutoChildren ?? 0)
  );
}

async function writeCaseArtifacts(outputDir, testCase, captures, comparisons) {
  const caseDir = join(outputDir, testCase.id);
  await mkdir(caseDir, { recursive: true });
  await Promise.all([
    writeFile(join(caseDir, "source.png"), captures.source.screenshot),
    writeFile(join(caseDir, "converted.png"), captures.converted.screenshot),
    writeFile(join(caseDir, "source-reflow.png"), captures.sourceReflow.screenshot),
    writeFile(join(caseDir, "converted-reflow.png"), captures.convertedReflow.screenshot),
    writeFile(join(caseDir, "converted.codesign.json"), captures.converted.designSource),
    writeFile(join(caseDir, "converted-reflow.codesign.json"), captures.convertedReflow.designSource),
    writeFile(join(caseDir, "diff.png"), PNG.sync.write(comparisons.standard.diff)),
    writeFile(join(caseDir, "reflow-diff.png"), PNG.sync.write(comparisons.reflow.diff)),
    writeFile(
      join(caseDir, "side-by-side.png"),
      PNG.sync.write(sideBySide(comparisons.standard.source, comparisons.standard.converted)),
    ),
    writeFile(
      join(caseDir, "reflow-side-by-side.png"),
      PNG.sync.write(sideBySide(comparisons.reflow.source, comparisons.reflow.converted)),
    ),
  ]);
}

const outputArgument = argumentValue("--output");
const caseArgument = argumentValue("--case");
const outputDir = outputArgument
  ? resolve(process.cwd(), outputArgument)
  : await mkdtemp(join(tmpdir(), "design-html2figma-cases-"));
const selectedCases = caseArgument
  ? html2figmaCases.filter((testCase) => testCase.id === caseArgument)
  : html2figmaCases;
if (selectedCases.length === 0) throw new Error(`Unknown --case ${caseArgument}`);

const server = await startStaticServer();
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 1,
  });
  for (const testCase of selectedCases) {
    try {
      const source = await captureMode(page, server.origin, testCase, "source");
      const converted = await captureMode(page, server.origin, testCase, "converted");
      const sourceReflow = await captureMode(page, server.origin, testCase, "source-reflow");
      const convertedReflow = await captureMode(
        page,
        server.origin,
        testCase,
        "converted-reflow",
      );
      const standard = comparePngBuffers(source.screenshot, converted.screenshot);
      const reflow = comparePngBuffers(sourceReflow.screenshot, convertedReflow.screenshot);
      const metrics = roundedMetrics(standard.metrics);
      const reflowMetrics = roundedMetrics(reflow.metrics);
      const passed =
        metrics.windowedSsim >= THRESHOLDS.windowedSsim &&
        metrics.changedPixelRatio24 <= THRESHOLDS.changedPixelRatio24 &&
        reflowMetrics.windowedSsim >= THRESHOLDS.reflowWindowedSsim &&
        reflowMetrics.changedPixelRatio24 <= THRESHOLDS.reflowChangedPixelRatio24 &&
        converted.state.blockingIssueCount === THRESHOLDS.blockingIssueCount &&
        convertedReflow.state.blockingIssueCount === THRESHOLDS.blockingIssueCount &&
        meetsExpectedCounts(converted.state, testCase.expected);
      results.push({
        id: testCase.id,
        name: testCase.name,
        category: testCase.category,
        sourceTemplate: testCase.sourceTemplate,
        width: testCase.width,
        reflowWidth: testCase.reflowWidth,
        passed,
        metrics,
        reflowMetrics,
        capture: converted.state,
        reflowCapture: convertedReflow.state,
        expected: testCase.expected,
      });
      if (outputArgument || !passed) {
        await writeCaseArtifacts(
          outputDir,
          testCase,
          { source, converted, sourceReflow, convertedReflow },
          { standard, reflow },
        );
      }
    } catch (error) {
      results.push({
        id: testCase.id,
        name: testCase.name,
        category: testCase.category,
        sourceTemplate: testCase.sourceTemplate,
        passed: false,
        error: error instanceof Error ? error.stack : String(error),
      });
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const passedCount = results.filter((result) => result.passed).length;
const report = {
  passed: passedCount === results.length,
  summary: {
    passed: passedCount,
    failed: results.length - passedCount,
    total: results.length,
  },
  catalog: html2figmaCatalog,
  thresholds: THRESHOLDS,
  fixture: relative(REPOSITORY_ROOT, resolve(REPOSITORY_ROOT, `.${FIXTURE_PATH}`)),
  results,
};
await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...report, outputDir }, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
