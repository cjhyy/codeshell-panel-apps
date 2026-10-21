import { freezeHtmlFlowObligations, evaluateHtmlFlowAudit } from "../apps/design-studio/app/html-flow-audit.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, relative, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import {
  normalizeDesignDocument,
  exportDesignSvg,
  serializeDesignDocument,
} from "../apps/design-studio/app/document.mjs";
import { preparePluginFile } from "../apps/design-studio/app/figma-plugin/v3-input.mjs";
import { createPortableDesign } from "../apps/design-studio/app/portable-backup.mjs";
import { loadFidelityLocalFixture } from "./design-studio-fidelity-local-assets.mjs";

// Frozen folder: --fixture-dir <selected-folder> [--html relative/source.html]
// [--selector '#fixture']. Reports archive that exact local snapshot; external
// URLs remain blocked. --html alone keeps the original self-contained workflow.
// --resize-mode viewport-only resizes only the outer imported viewport frame.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = join(root, "apps/design-studio/app");
const fixtures = [
  {
    id: "flex-fill",
    html: `<main id="fixture"><div id="fixed"></div><div id="fluid"></div></main>`,
    css: `#fixture{display:flex;width:100%;height:240px;padding:20px;gap:16px;background:#e2e8f0}#fixed{width:100px;height:120px;background:#2563eb}#fluid{flex:1;height:120px;background:#f97316}`,
  },
  {
    id: "nested-card",
    html: `<main id="fixture"><section id="card"><h1>Editable Auto Layout</h1><p>Content should reflow when the frame gets narrower.</p><div id="actions"><span>Save</span><span>Share</span></div></section></main>`,
    css: `#fixture{display:flex;width:100%;height:240px;padding:20px;background:#e2e8f0}#card{display:flex;flex-direction:column;flex:1;gap:12px;padding:16px;background:#ffffff}h1,p{margin:0}h1{font-size:24px;line-height:30px}p{font-size:16px;line-height:24px}#actions{display:flex;gap:8px}span{padding:6px 12px;background:#dbeafe;font-size:14px;line-height:20px}`,
  },
  {
    id: "flex-margins",
    html: `<main id="fixture"><div id="first"></div><div id="second"></div></main>`,
    css: `#fixture{display:flex;width:100%;height:240px;padding:20px;gap:12px;background:#e2e8f0}#first,#second{width:100px;height:100px;background:#2563eb;margin-right:8px}`,
  },
];

/** Every pixel is counted; tolerance affects the gate, never the exact metric. */
export function comparePixels(leftBytes, rightBytes, channelTolerance = 0) {
  const left = PNG.sync.read(leftBytes),
    right = PNG.sync.read(rightBytes);
  assert.equal(right.width, left.width, "Screenshot widths differ");
  assert.equal(right.height, left.height, "Screenshot heights differ");
  const diff = new PNG({ width: left.width, height: left.height });
  let changed = 0,
    outsideTolerance = 0,
    sum = 0,
    maximum = 0;
  for (let offset = 0; offset < left.data.length; offset += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel++) {
      const difference = Math.abs(left.data[offset + channel] - right.data[offset + channel]);
      delta = Math.max(delta, difference);
      sum += difference;
      if (channel < 3) diff.data[offset + channel] = Math.min(255, difference * 6);
    }
    diff.data[offset + 3] = 255;
    if (delta) changed++;
    if (delta > channelTolerance) outsideTolerance++;
    maximum = Math.max(maximum, delta);
  }
  const count = left.width * left.height;
  return {
    diff: PNG.sync.write(diff),
    metrics: {
      width: left.width,
      height: left.height,
      pixelCount: count,
      changedPixels: changed,
      changedPixelRatio: changed / count,
      pixelsOutsideTolerance: outsideTolerance,
      outsideToleranceRatio: outsideTolerance / count,
      maximumChannelDelta: maximum,
      meanAbsoluteChannelError: sum / (count * 4),
    },
  };
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw Error(`${name} requires a value`);
  return value;
}

async function settleFontsAndPaint(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function resizeDocument(page, document, width, rootId, resizeMode) {
  const source = await page.evaluate(
    async ({ source, width, rootId, resizeMode }) => {
      const { normalizeDesignDocument, serializeDesignDocument } =
        await import("/app/document.mjs");
      const { applyAllAutoLayouts } = await import("/app/layout.mjs");
      const resized = normalizeDesignDocument(JSON.parse(source));
      resized.canvas.width = width;
      for (const node of resized.nodes) {
        if (node.id === "html-viewport" ||
            (resizeMode === "viewport-and-root" && node.id === rootId)) node.width = width;
      }
      applyAllAutoLayouts(resized.nodes);
      return serializeDesignDocument(resized);
    },
    { source: serializeDesignDocument(document), width, rootId, resizeMode },
  );
  return normalizeDesignDocument(JSON.parse(source));
}

export async function runProductionFidelity({
  output,
  cases = fixtures,
  recordOnly = false,
  channelTolerance = 0,
  maximumChangedRatio = 0,
  width = 640,
  height = 240,
  narrowWidth = 400,
  resizeMode = "viewport-and-root",
  cpuOnly = false,
} = {}) {
  assert(["viewport-only", "viewport-and-root"].includes(resizeMode), "Unknown resize mode");
  output ??= await mkdtemp(join(tmpdir(), "design-production-fidelity-"));
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch(cpuOnly ? {args:["--disable-gpu"]} : {});
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const blocked = [],
    errors = [];
  const localFixtures = new Map();
  try {
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.href === "https://fidelity.test/")
        return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
      const fixtureUrl =
        url.origin === "https://fidelity.test" &&
        /^\/fixtures\/([a-z0-9-]+)\/(.+)$/u.exec(url.pathname);
      if (fixtureUrl && localFixtures.has(fixtureUrl[1])) {
        try {
          const resource = localFixtures
            .get(fixtureUrl[1])
            .resource(decodeURIComponent(fixtureUrl[2]));
          return route.fulfill({
            body: resource.bytes,
            contentType: resource.mime,
            headers: {
              "Content-Security-Policy":
                "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch {
          blocked.push(url.href);
          return route.abort();
        }
      }
      if (url.origin === "https://fidelity.test" && url.pathname.startsWith("/app/")) {
        const path = resolve(appRoot, url.pathname.slice(5));
        if (
          relative(appRoot, path).startsWith(`..${sep}`) ||
          path === appRoot ||
          !path.endsWith(".mjs")
        )
          return route.abort();
        try {
          return await route.fulfill({
            contentType: "text/javascript",
            body: await readFile(path),
          });
        } catch {
          return route.abort();
        }
      }
      blocked.push(url.href);
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const localReferencePage = await context.newPage();
    localReferencePage.on("pageerror", (error) => errors.push(error.message));
    let activeFixture;
    await page.exposeFunction("__fidelityReadText", async (path) => {
      if (!activeFixture) throw new Error("Fixture requires self-contained HTML/CSS");
      return activeFixture.readText(path);
    });
    await page.exposeFunction("__fidelityReadAsset", async (path) => {
      if (!activeFixture) throw new Error("Fixture requires self-contained HTML/CSS");
      return activeFixture.readAsset(path);
    });
    const report = {
      version: 1,
      engine: "captureWorkspaceHtmlResult:html2figma",
      realFigmaExecuted: false,
      browserGpuDisabled: cpuOnly,
      startedAt: new Date().toISOString(),
      thresholds: { channelTolerance, maximumChangedRatio },
      viewport: { width, height, narrowWidth },
      resizeMode,
      rendering: "exportDesignSvg in Chromium; layout uses browser text metrics when available",
      cases: [],
    };
    for (const fixture of cases) {
      assert(
        /^[a-z0-9][a-z0-9-]{0,63}$/u.test(fixture.id),
        "Fixture id must be a safe lowercase slug",
      );
      assert(!report.cases.some((entry) => entry.id === fixture.id), "Fixture ids must be unique");
      activeFixture = fixture.directory
        ? await loadFidelityLocalFixture(fixture.directory, fixture.sourcePath)
        : null;
      localFixtures.clear();
      if (activeFixture) localFixtures.set(fixture.id, activeFixture);
      const directory = join(output, fixture.id);
      await mkdir(directory, { recursive: true });
      const html =
        activeFixture?.html ??
        fixture.source ??
        `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;background:white;font-family:Arial;color:#0f172a}${fixture.css}</style>${fixture.html}`;
      await writeFile(join(directory, "source.html"), html);
      if (activeFixture)
        for (const file of activeFixture.manifest) {
          const archived = join(directory, "local-fixture", file.path);
          await mkdir(dirname(archived), { recursive: true });
          await writeFile(archived, activeFixture.resource(file.path).bytes);
        }
      await page.setViewportSize({ width, height });
      await page.goto("https://fidelity.test/");
      const referencePage = activeFixture ? localReferencePage : page;
      const sourceUrl = activeFixture
        ? `https://fidelity.test/fixtures/${fixture.id}/${activeFixture.sourcePath.split("/").map(encodeURIComponent).join("/")}`
        : null;
      const showSource = async (frameWidth) => {
        await referencePage.setViewportSize({ width: frameWidth, height });
        if (sourceUrl) await referencePage.goto(sourceUrl);
        else await referencePage.setContent(html);
        await settleFontsAndPaint(referencePage);
      };
      await showSource(width);
      const original = await referencePage.screenshot({ animations: "disabled" });
      const rootSelector = fixture.rootSelector ?? "#fixture";
      const sourceLayout = await referencePage.evaluate(
        (selector) => getComputedStyle(document.querySelector(selector)).display,
        rootSelector,
      );
      const captured = await page.evaluate(
        async ({ html, width, height, sourcePath, rootSelector, local }) => {
          const { captureWorkspaceHtmlResult } = await import("/app/html-import.mjs");
          return captureWorkspaceHtmlResult({
            html,
            sourcePath,
            readText: async (path) => window.__fidelityReadText(path),
            ...(local ? { readAsset: async (path) => window.__fidelityReadAsset(path) } : {}),
            rootSelector,
            includeFlowAudit: true,
            viewportWidth: width,
            viewportHeight: height,
          });
        },
        {
          html,
          width,
          height,
          sourcePath: activeFixture?.sourcePath ?? "source.html",
          rootSelector,
          local: Boolean(activeFixture),
        },
      );
      assert.equal(captured.report.engine, "html2figma");
      const document = normalizeDesignDocument(captured.document);
      await writeFile(join(directory, "imported.codesign.json"), serializeDesignDocument(document));
      const files = new Map(
        (captured.resourcePlans ?? []).flatMap((plan) =>
          plan.parts.map((part) => [part.path, part.content]),
        ),
      );
      const portable = await createPortableDesign({
        document,
        source: {
          workspaceRoot: "/fidelity-fixture",
          sessionId: "production-fidelity",
          path: "fixture.codesign.json",
        },
        readText: async (path) => {
          assert(files.has(path), `Missing fixture resource: ${path}`);
          return files.get(path);
        },
        sha256Bytes: async (bytes) => createHash("sha256").update(bytes).digest("hex"),
      });
      await writeFile(join(directory, "complete.portable.json"), portable);
      let prepared, nativeTransferError = null;
      try { prepared = await preparePluginFile(portable); }
      catch (error) {
        if (!["NATIVE_NEGATIVE_SPACING","NATIVE_CSS_SHADOW_MASK","NATIVE_CSS_FONT_FAMILY"].includes(error.code)) throw error;
        nativeTransferError = { code: error.code, message: String(error.message).slice(0, 2000),
          stage: "production-v3-transfer", status: "unsupported" };
        await rm(join(directory, "figma-transfer.json"), { force: true });
        await writeFile(join(directory, "native-transfer-error.json"), JSON.stringify(nativeTransferError, null, 2) + "\n");
      }
      if (prepared) await rm(join(directory, "native-transfer-error.json"), { force: true });
      const backup = JSON.parse(portable);
      const descriptors = new Map(document.resources.map((resource) => [resource.id, resource]));
      const resourceDataUrls = new Map(
        backup.resources.map((resource) => [
          resource.id,
          `data:${descriptors.get(resource.id).mime};base64,${resource.base64}`,
        ]),
      );
      if (prepared) await writeFile(
        join(directory, "figma-transfer.json"),
        JSON.stringify(prepared.transfer, null, 2),
      );
      const main = document.nodes.find((node) => node.parentId === "html-viewport");
      const flowObligations = freezeHtmlFlowObligations(captured.report.flowObligations);
      await writeFile(join(directory, "flow-obligations.json"), JSON.stringify(flowObligations, null, 2) + "\n");
      const sourcePositions = Object.fromEntries(flowObligations.bindings.map(binding => [binding.designId, binding.position]));
      const semanticIssues = [];
      if (nativeTransferError) semanticIssues.push(`Native transfer rejected: ${nativeTransferError.message}`);
      if (
        !main ||
        (["flex", "inline-flex", "grid", "inline-grid"].includes(sourceLayout) &&
          main.layout === "none")
      )
        semanticIssues.push("Source flex/grid root lost Auto Layout");
      const result = {
        id: fixture.id,
        nodes: document.nodes.length,
        sourcePositioning: sourcePositions,
        semanticIssues,
        nativeTransfer: nativeTransferError ? { supported: false, status: "unsupported", stage: "production-v3-transfer", error: nativeTransferError }
          : { supported: true, status: "prepared", stage: "production-v3-transfer" },
        warnings: captured.report.warnings,
        ...(activeFixture
          ? {
              localFixture: {
                sourcePath: activeFixture.sourcePath,
                archiveDirectory: "local-fixture",
                files: activeFixture.manifest,
              },
            }
          : {}),
        comparisons: [],
        flowAudits: [],
      };
      for (const [mode, frameWidth] of [
        ["imported", width],
        ["relayout", width],
        ["narrow", narrowWidth],
      ]) {
        const candidate =
          mode === "imported"
            ? document
            : await resizeDocument(page, document, frameWidth, main?.id, resizeMode);
        const flowAudit = evaluateHtmlFlowAudit(candidate, flowObligations);
        result.flowAudits.push({ mode, ...flowAudit });
        if (!flowAudit.passed) semanticIssues.push(`${mode}: source flow audit ${flowAudit.status} (${flowAudit.failures} broken, ${flowAudit.unresolved} unresolved relationships)`);
        await page.setViewportSize({ width: frameWidth, height });
        let source = original;
        if (mode === "narrow") {
          await showSource(frameWidth);
          source = await referencePage.screenshot({ animations: "disabled" });
        }
        const svg = exportDesignSvg(candidate, { resourceDataUrls, maxBytes: 4 * 1024 * 1024 });
        await writeFile(join(directory, `${mode}.codesign.json`), serializeDesignDocument(candidate));
        await page.setContent(
          `<!doctype html><style>html,body{margin:0;background:white}svg{display:block}</style>${svg}`,
        );
        await settleFontsAndPaint(page);
        const converted = await page.screenshot({ animations: "disabled" });
        const comparison = comparePixels(source, converted, channelTolerance);
        await writeFile(join(directory, `${mode}-source.png`), source);
        await writeFile(join(directory, `${mode}-converted.png`), converted);
        await writeFile(join(directory, `${mode}-diff.png`), comparison.diff);
        await writeFile(join(directory, `${mode}.svg`), svg);
        result.comparisons.push({
          mode,
          ...comparison.metrics,
          passed: comparison.metrics.outsideToleranceRatio <= maximumChangedRatio,
        });
      }
      result.passed =
        semanticIssues.length === 0 && result.comparisons.every((item) => item.passed);
      report.cases.push(result);
    }
    report.blockedRequests = blocked;
    report.browserErrors = errors;
    report.passed =
      errors.length === 0 && blocked.length === 0 && report.cases.every((item) => item.passed);
    report.finishedAt = new Date().toISOString();
    await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    return { output, recordOnly, ...report };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const channelTolerance = Number(argument("--channel-tolerance", "0"));
  const maximumChangedRatio = Number(argument("--max-changed-ratio", "0"));
  assert(Number.isInteger(channelTolerance) && channelTolerance >= 0 && channelTolerance <= 255);
  assert(
    Number.isFinite(maximumChangedRatio) && maximumChangedRatio >= 0 && maximumChangedRatio <= 1,
  );
  const input = argument("--html", null);
  const fixtureDirectory = argument("--fixture-dir", null);
  const width = Number(argument("--width", "640")),
    height = Number(argument("--height", "240")),
    narrowWidth = Number(argument("--narrow-width", "400"));
  for (const value of [width, height, narrowWidth])
    assert(Number.isInteger(value) && value >= 100 && value <= 10000);
  const selected = argument("--case", null);
  const cases = fixtureDirectory
    ? [
        {
          id: "custom",
          directory: resolve(fixtureDirectory),
          sourcePath: input
            ? input.startsWith("/")
              ? relative(resolve(fixtureDirectory), resolve(input)).split(sep).join("/")
              : input
            : "source.html",
          rootSelector: argument("--selector", "#fixture"),
        },
      ]
    : input
      ? [{ id: "custom", source: await readFile(resolve(input), "utf8") }]
      : selected
        ? fixtures.filter((fixture) => fixture.id === selected)
        : fixtures;
  assert(cases.length > 0, `Unknown case: ${selected}`);
  const result = await runProductionFidelity({
    output: argument("--output", null),
    cases,
    recordOnly: process.argv.includes("--record-only"),
    channelTolerance,
    maximumChangedRatio,
    width,
    height,
    narrowWidth,
    resizeMode: argument("--resize-mode", "viewport-and-root"),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed && !result.recordOnly) process.exitCode = 1;
}
