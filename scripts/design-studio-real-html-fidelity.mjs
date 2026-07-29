import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { auditDesign, summarizeAudit } from "../apps/design-studio/app/audit.mjs";
import {
  exportDesignSvg,
  measureDesignDocumentBytes,
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../apps/design-studio/app/layout.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const CAPTURE_MODULE = resolve(
  REPOSITORY_ROOT,
  "apps/design-studio/app/html-capture.mjs",
);
const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const PRESETS = Object.freeze([
  {
    id: "bootstrap-blog",
    name: "Bootstrap Blog",
    url: "https://getbootstrap.com/docs/5.3/examples/blog/",
    selector: "html",
  },
  {
    id: "hacker-news",
    name: "Hacker News",
    url: "https://news.ycombinator.com/",
    selector: "html",
  },
  {
    id: "w3c-fixed-menu",
    name: "W3C fixed menu",
    url: "https://www.w3.org/Style/Examples/007/menus.en.html",
    selector: "html",
  },
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function positiveIntegerArgument(name, fallback) {
  const value = argument(name);
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 10_000) {
    throw new Error(`${name} must be an integer from 100 to 10000`);
  }
  return parsed;
}

function selectedPresets() {
  const url = argument("--url");
  if (url) {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("--url must use http or https");
    }
    const id = argument("--id") ?? "custom";
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(id)) {
      throw new Error("--id must contain only lowercase letters, digits, and hyphens");
    }
    return [
      {
        id,
        name: argument("--name") ?? parsed.hostname,
        url: parsed.href,
        selector: argument("--selector") ?? "html",
      },
    ];
  }
  const presetId = argument("--preset");
  if (!presetId) return PRESETS;
  const preset = PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) {
    throw new Error(`Unknown preset ${presetId}; use ${PRESETS.map(({ id }) => id).join(", ")}`);
  }
  return [preset];
}

function browserCaptureSource(source) {
  return `${source.replace(/^export\s+/gmu, "")}
globalThis.__codeshellCaptureHtmlToDesign = captureHtmlToDesign;`;
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
    diff: PNG.sync.write(diff),
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

function roundedMetrics(metrics) {
  return Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [
      key,
      typeof value === "number" && !Number.isInteger(value) ? Number(value.toFixed(6)) : value,
    ]),
  );
}

async function prepareSourcePage(page, sample, viewport, injectedCaptureSource) {
  await page.goto(sample.url, { waitUntil: "load", timeout: 30_000 });
  await page.waitForTimeout(1_000);
  await page.addStyleTag({
    content: `html, body {
      animation: none !important;
      caret-color: transparent !important;
      transition: none !important;
    }
    * {
      animation: none !important;
      caret-color: transparent !important;
      transition: none !important;
    }
    ::-webkit-scrollbar { display: none !important; }`,
  });
  await page.evaluate(async ({ selector }) => {
    await document.fonts?.ready;
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
    );
    const root = document.querySelector(selector);
    if (!root) throw new Error(`Root selector not found: ${selector}`);
  }, { selector: sample.selector });
  await page.addScriptTag({ content: injectedCaptureSource });
}

async function renderDesign(page, sample, svg, viewport) {
  await page.goto(sample.url, { waitUntil: "load", timeout: 30_000 });
  await page.evaluate(
    ({ markup, size }) => {
      document.body.innerHTML = markup;
      const style = document.createElement("style");
      style.textContent = `html,body{margin:0!important;padding:0!important;width:${size.width}px!important;height:${size.height}px!important;overflow:hidden!important;background:#fff!important}body>svg{display:block!important;margin:0!important}`;
      document.head.append(style);
    },
    { markup: svg, size: viewport },
  );
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
    );
  });
  return page.locator("body > svg").screenshot({ animations: "disabled", caret: "hide" });
}

async function captureSample(context, sample, viewport, injectedCaptureSource, outputRoot) {
  const sourcePage = await context.newPage();
  const renderPage = await context.newPage();
  try {
    await prepareSourcePage(sourcePage, sample, viewport, injectedCaptureSource);
    const sourceScreenshot = await sourcePage.screenshot({
      animations: "disabled",
      caret: "hide",
    });
    const captured = await sourcePage.evaluate(
      ({ selector, name, size }) =>
        globalThis.__codeshellCaptureHtmlToDesign(document.querySelector(selector), {
          name,
          captureBounds: {
            left: 0,
            top: 0,
            right: size.width,
            bottom: size.height,
          },
        }),
      { selector: sample.selector, name: sample.name, size: viewport },
    );
    const rawSource = `${JSON.stringify(captured, null, 2)}\n`;
    const rawBytes = new TextEncoder().encode(rawSource).length;
    const rawNodeCount = (() => {
      let count = 0;
      const visit = (node) => {
        count += 1;
        node.children?.forEach(visit);
      };
      captured.pages?.forEach((page) => page.children?.forEach(visit));
      return count;
    })();
    const outputDir = join(outputRoot, sample.id);
    await mkdir(outputDir, { recursive: true });
    let normalized;
    let documentBytes;
    try {
      normalized = normalizeDesignDocument(captured);
      documentBytes = measureDesignDocumentBytes(normalized);
    } catch (error) {
      await Promise.all([
        writeFile(join(outputDir, "source-html.png"), sourceScreenshot),
        writeFile(join(outputDir, "raw-capture.codesign.json"), rawSource),
      ]);
      return {
        id: sample.id,
        name: sample.name,
        url: sample.url,
        viewport,
        rawBytes,
        rawNodeCount,
        error: error instanceof Error ? error.message : String(error),
        outputDir,
      };
    }
    const auditIssues = auditDesign(normalized);
    const audit = {
      ...summarizeAudit(auditIssues),
      issueCodes: auditIssues.reduce((counts, issue) => {
        counts[issue.code] = (counts[issue.code] ?? 0) + 1;
        return counts;
      }, {}),
    };
    const convertedScreenshot = await renderDesign(
      renderPage,
      sample,
      exportDesignSvg(normalized),
      viewport,
    );
    const reflowed = structuredClone(normalized);
    applyAllAutoLayouts(reflowed.nodes);
    const reflowedScreenshot = await renderDesign(
      renderPage,
      sample,
      exportDesignSvg(reflowed),
      viewport,
    );
    const comparison = comparePngBuffers(sourceScreenshot, convertedScreenshot);
    const reflowComparison = comparePngBuffers(sourceScreenshot, reflowedScreenshot);
    await Promise.all([
      writeFile(join(outputDir, "source-html.png"), sourceScreenshot),
      writeFile(join(outputDir, "converted-design.png"), convertedScreenshot),
      writeFile(join(outputDir, "reflowed-design.png"), reflowedScreenshot),
      writeFile(join(outputDir, "pixel-diff.png"), comparison.diff),
      writeFile(join(outputDir, "reflow-pixel-diff.png"), reflowComparison.diff),
      writeFile(
        join(outputDir, "captured-design.codesign.json"),
        serializeDesignDocument(normalized),
      ),
      writeFile(
        join(outputDir, "reflowed-design.codesign.json"),
        serializeDesignDocument(reflowed),
      ),
    ]);
    return {
      id: sample.id,
      name: sample.name,
      url: sample.url,
      viewport,
      rawBytes,
      rawNodeCount,
      documentBytes,
      capacityModel: "indexed-pages",
      nodeCount: normalized.nodes.length,
      autoLayoutCount: normalized.nodes.filter((node) =>
        ["horizontal", "vertical", "grid"].includes(node.layout),
      ).length,
      audit,
      metrics: roundedMetrics(comparison.metrics),
      reflowMetrics: roundedMetrics(reflowComparison.metrics),
      outputDir,
    };
  } finally {
    await Promise.all([sourcePage.close(), renderPage.close()]);
  }
}

const viewport = {
  width: positiveIntegerArgument("--width", DEFAULT_VIEWPORT.width),
  height: positiveIntegerArgument("--height", DEFAULT_VIEWPORT.height),
};
const samples = selectedPresets();
const explicitOutput = argument("--output");
const outputRoot = explicitOutput
  ? resolve(process.cwd(), explicitOutput)
  : await mkdtemp(join(tmpdir(), "design-real-html-fidelity-"));
const captureModuleSource = await readFile(CAPTURE_MODULE, "utf8");
const injectedCaptureSource = browserCaptureSource(captureModuleSource);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  bypassCSP: true,
  deviceScaleFactor: 1,
  viewport,
});
try {
  const reports = [];
  for (const sample of samples) {
    reports.push(
      await captureSample(context, sample, viewport, injectedCaptureSource, outputRoot),
    );
  }
  const failedSampleCount = reports.filter((sample) => sample.error).length;
  const report = {
    generatedAt: new Date().toISOString(),
    failedSampleCount,
    samples: reports,
    outputRoot,
  };
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failedSampleCount > 0) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
