import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { designFrontendCss, exportDesignFrontend, renderDesignFrontendPage } from "../../../apps/design-studio/app/frontend-export.mjs";
import { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { compareCornerRadius, compareShadowGeometry } from "./render-fidelity-geometry.mjs";
import { strokeEdgeScans, symmetricPixelDifference } from "./render-fidelity.metrics.mjs";

const shadow = { color: "#000000", opacity: .25, x: 3, y: 5, blur: 8 };
const shape = (id, extra = {}) => ({ id, type: "rectangle", name: id, x: 20, y: 20,
  width: 100, height: 60, fill: "#ffffff", stroke: "#dc2626", strokeWidth: 4,
  opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false, ...extra });
const documentFor = children => ({ format: "codeshell.design", version: 3, name: "Shadow roundtrip",
  canvas: { width: 400, height: 240, background: "#ffffff" }, tokens: { colors: [] }, resources: [],
  activePageId: "page", pages: [{ id: "page", name: "Page", children }] });
const styleFor = (html, id) => html.match(new RegExp(`data-codeshell-id="${id}"[^>]*style="([^"]*)"`, "u"))[1];
const stack = { basis: "css-box", layers: [
  { kind: "outer", color: "#000000", opacity: .25, x: 3, y: 5, blur: 8, spread: 0, visible: true },
  { kind: "inner", color: "#2563eb", opacity: .5, x: 2, y: 1, blur: 4, spread: 0, visible: true },
] };

test("rounded leaf centered strokes use one exact ring only when CSS can represent its offset", () => {
  for (const strokeAlign of [undefined, "center"]) for (const strokeWidth of [2, 4, 6]) {
    const html = exportDesignFrontend(documentFor([shape("ring", { cornerRadius: 14, strokeWidth, strokeAlign, shadow })]));
    const css = styleFor(html, "ring");
    assert.match(css, new RegExp(`outline:${strokeWidth}px solid`, "u"));
    assert.match(css, new RegExp(`outline-offset:-${strokeWidth / 2}px`, "u"));
    assert.match(html, new RegExp(`data-codeshell-stroke="${strokeAlign ?? "legacy"}-outline-v1"`, "u"));
    assert.doesNotMatch(css, /inset 0 0 0/u);
    assert.match(css, /box-shadow:3px 5px 8px/u, "the authored shadow remains an ordinary shadow");
  }
  for (const extra of [{ strokeWidth: 1 }, { strokeWidth: 3 }, { strokeWidth: 4.5 },
    { cornerRadius: 0 }, { cornerRadii: [14, 10, 14, 10] },
    { children: [shape("opaque-child", { x: 20, y: 20, width: 10, height: 10 })] }]) {
    const html = exportDesignFrontend(documentFor([shape("ring", { cornerRadius: 14, ...extra })]));
    assert.match(styleFor(html, "ring"), /inset 0 0 0/u, "unsupported width or child paint order keeps the established path");
    assert.doesNotMatch(html, /outline-v1/u);
  }
});

test("outer CSS shadow masks include visible stroke outset without changing inner or text shadows", () => {
  for (const [strokeAlign, spread] of [[undefined, 2], ["center", 2], ["outside", 4], ["inside", 0]]) {
    const node = shape("shape", { ...(strokeAlign ? { strokeAlign } : {}), shadow });
    const input = documentFor([node]), before = JSON.stringify(input);
    const css = styleFor(exportDesignFrontend(input), node.id);
    assert.match(css, new RegExp(`3px 5px 8px ${spread}px rgba\\(0,0,0,0\\.25\\)`, "u"), `scalar ${strokeAlign ?? "legacy"}`);
    assert.equal(JSON.stringify(input), before);
    // Export is also a direct renderer: this checks its bounded paint conversion,
    // without admitting unsupported center/outside stacks into the document codec.
    const stackCss = styleFor(exportDesignFrontend(documentFor([shape("stack", {
      ...(strokeAlign ? { strokeAlign } : {}), shadowStack: stack,
    })])), "stack");
    assert.match(stackCss, new RegExp(`3px 5px 8px ${spread}px rgba\\(0,0,0,0\\.25\\)`, "u"), `stack ${strokeAlign ?? "legacy"}`);
    assert.match(stackCss, /inset 2px 1px 4px 0px rgba\(37,99,235,0\.5\)/u);
  }
  const transparent = styleFor(exportDesignFrontend(documentFor([shape("transparent", { stroke: "transparent", shadow })])), "transparent");
  assert.match(transparent, /3px 5px 8px 0px rgba\(0,0,0,0\.25\)/u);
  const text = styleFor(exportDesignFrontend(documentFor([shape("text", { type: "text", text: "Text", fontFamily: "Arial", fontSize: 16, lineHeight: 1.5, fontWeight: 400, shadow })])), "text");
  assert.match(text, /text-shadow:3px 5px 8px rgba\(0,0,0,0\.25\)/u);
});

async function captureFixture(t) {
  const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-lcd-text"] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 400, height: 240 }, deviceScaleFactor: 1 });
  const appRoot = fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url));
  const rejected = [];
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.href === "https://shadow-roundtrip.test/") return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
    if (url.origin === "https://shadow-roundtrip.test" && url.pathname.startsWith("/app/") && url.pathname.endsWith(".mjs")) {
      const path = resolve(appRoot, url.pathname.slice(5));
      if (path.startsWith(`${appRoot.replace(/\/$/u, "")}${sep}`)) return route.fulfill({ contentType: "text/javascript", body: await readFile(path) });
    }
    rejected.push(url.href);
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto("https://shadow-roundtrip.test/");
  const capture = async html => {
    await page.setContent(html);
    return page.evaluate(async () => {
      const { captureHtmlToDesign } = await import("/app/html-capture.mjs");
      return captureHtmlToDesign(document.querySelector(".cs-page"), { name: "Roundtrip" });
    });
  };
  t.after(() => assert.deepEqual(rejected, [], "all fixture requests stayed local"));
  return { page, capture };
}

test("generated center stroke roundtrip restores stroke and retains the actual scalar shadow", async t => {
  const { page, capture } = await captureFixture(t), rows = [];
  for (const strokeAlign of [undefined, "center"]) for (const effect of [undefined, shadow]) {
    const source = documentFor([shape("shape", { ...(strokeAlign ? { strokeAlign } : {}), ...(effect ? { shadow: effect } : {}) })]);
    const before = serializeDesignDocument(normalizeDesignDocument(source));
    const html = exportDesignFrontend(source), captured = await capture(html);
    const actual = normalizeDesignDocument(captured).nodes.find(node => node.id === "shape");
    rows.push({ strokeAlign: strokeAlign ?? "legacy", shadow: !!effect, actual });
    if (process.env.DESIGN_SHADOW_EVIDENCE_DIR) {
      await mkdir(process.env.DESIGN_SHADOW_EVIDENCE_DIR, { recursive: true });
      await writeFile(resolve(process.env.DESIGN_SHADOW_EVIDENCE_DIR, "roundtrip.json"), `${JSON.stringify(rows, null, 2)}\n`);
      await page.screenshot({ path: resolve(process.env.DESIGN_SHADOW_EVIDENCE_DIR, `${strokeAlign ?? "legacy"}-${effect ? "shadow" : "plain"}.png`) });
    }
    assert.equal(actual.stroke, "#dc2626", `${strokeAlign ?? "legacy"}: generated stroke must survive capture`);
    assert.equal(actual.strokeWidth, 4);
    assert.equal(actual.strokeAlign, strokeAlign);
    assert.deepEqual(actual.shadow, effect, "the generated pair must not become a phantom zero-blur shadow or hide the authored shadow");
    assert.equal(serializeDesignDocument(normalizeDesignDocument(source)), before, "capture/export never mutate the source document");
  }
});

test("rounded outline stroke roundtrip preserves legacy, center, opacity and ordinary shadows", async t => {
  const { capture } = await captureFixture(t);
  for (const strokeAlign of [undefined, "center"]) for (const strokeWidth of [2, 4, 6]) for (const effect of [undefined, shadow]) {
    const source = documentFor([shape("ring", { cornerRadius: 14, strokeAlign, strokeWidth, ...(effect ? { shadow: effect } : {}) })]);
    const before = serializeDesignDocument(normalizeDesignDocument(source));
    const actual = normalizeDesignDocument(await capture(exportDesignFrontend(source))).nodes.find(node => node.id === "ring");
    assert.equal(actual.stroke, "#dc2626"); assert.equal(actual.strokeWidth, strokeWidth); assert.equal(actual.strokeAlign, strokeAlign);
    assert.deepEqual(actual.shadow, effect); assert.equal(actual.cornerRadius, 14);
    assert.equal(serializeDesignDocument(normalizeDesignDocument(source)), before);
  }
  const translucent = shape("ring", { cornerRadius: 14, strokeAlign: "center", strokeSides: Array.from({ length: 4 }, () => ({ width: 4, color: "#dc2626", opacity: .5 })) });
  const actual = normalizeDesignDocument(await capture(exportDesignFrontend(documentFor([translucent])))).nodes.find(node => node.id === "ring");
  assert.deepEqual(actual.strokeSides, translucent.strokeSides);
  // A generated hotspot is a real DOM child even though the source is a leaf.
  // Keep its established shadow hint instead of weakening outline validation.
  const linked = documentFor([shape("linked", { cornerRadius: 14, shadow })]);
  const links = new Map([["linked", { id: "link", href: "#page", label: "Open page" }]]);
  const html = `<!doctype html><style>${designFrontendCss(linked)}.cs-prototype-hotspot{position:absolute;inset:0}</style>${renderDesignFrontendPage(linked, { prototypeLinks: links, prototypeMode: true })}`;
  assert.match(html, /data-codeshell-stroke="legacy-shadow-v1"/u);
  assert.match(html, /class="cs-prototype-hotspot"/u);
  assert.doesNotMatch(styleFor(html, "linked"), /outline:/u);
  const captured = normalizeDesignDocument(await capture(html)).nodes.find(node => node.id === "linked");
  assert.equal(captured.stroke, "#dc2626"); assert.equal(captured.strokeWidth, 4);
  assert.deepEqual(captured.shadow, shadow);
});

test("mismatched outline hints cannot synthesize strokes or consume external shadows", async t => {
  const { capture } = await captureFixture(t);
  for (const [hint, outline, offset, extra = ""] of [
    ["", "4px solid #dc2626", "-2px"],
    ["legacy-outline-v1", "4px solid #dc2626", "0px"],
    ["center-outline-v1", "3px solid #dc2626", "-1px"],
    ["center-outline-v1", "102px solid #dc2626", "-51px"],
    ["legacy-outline-v1", "4px solid rgba(220,38,38,.5)", "-2px"],
    ["center-outline-v1", "4px dashed #dc2626", "-2px"],
    ["center-outline-v1", "4px solid #dc2626", "-2px", "border:1px solid blue"],
    ["center-outline-v1", "4px solid #dc2626", "-2px", "border-radius:10px 14px"],
  ]) {
    const html = `<!doctype html><style>body{margin:0}.cs-page{position:relative;width:400px;height:240px;background:white}</style><main class="cs-page"><div data-codeshell-id="external" data-codeshell-node-type="rectangle" data-codeshell-stroke="${hint}" style="position:absolute;left:20px;top:20px;width:100px;height:60px;background:white;border-radius:14px;outline:${outline};outline-offset:${offset};box-shadow:2px 3px 4px rgb(12,34,56);${extra}"></div></main>`;
    const actual = normalizeDesignDocument(await capture(html)).nodes.find(node => node.id === "external");
    assert.equal(actual.stroke, "transparent"); assert.equal(actual.strokeWidth, 0);
    assert.deepEqual(actual.shadow, { color: "#0c2238", opacity: 1, x: 2, y: 3, blur: 4 });
  }
});

test("rounded leaf ring matches the SVG contour without a seam at DPR 1, DPR 2 and CSS scale 2", async t => {
  const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-lcd-text"] });
  t.after(() => browser.close()); const rows = [];
  for (const [dpr, zoom] of [[1, 1], [2, 1], [1, 2]]) {
    const page = await browser.newPage({ viewport: { width: 400, height: 240 }, deviceScaleFactor: dpr });
    await page.route("**/*", route => route.abort());
    try {
      for (const strokeWidth of [2, 4, 6]) for (const clipContent of [false, true]) {
        const source = documentFor([shape("ring", { type: "frame", layout: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start", children: [],
          width: 120, height: 75, cornerRadius: 14, strokeWidth, clipContent, fill: "#eeeeee", stroke: "#111111" })]);
        await page.setContent(`${exportDesignFrontend(source)}<style>.cs-page{margin:0;transform:scale(${zoom});transform-origin:0 0}</style>`);
        const html = await page.screenshot();
        await page.setContent(`<!doctype html><style>body{margin:0}svg{transform:scale(${zoom});transform-origin:0 0}</style>${exportDesignSvg(normalizeDesignDocument(source))}`);
        const svg = await page.screenshot(), actual = PNG.sync.read(html), expected = PNG.sync.read(svg), scale = dpr * zoom;
        const bounds = { x: 20 * scale, y: 20 * scale, width: 120 * scale, height: 75 * scale };
        const pixel = symmetricPixelDifference(expected, actual, { roi: { x: 14 * scale, y: 14 * scale, width: 132 * scale, height: 87 * scale } });
        const outset = strokeWidth / 2 * scale;
        const radius = compareCornerRadius(expected, actual, { bounds: { x: bounds.x - outset, y: bounds.y - outset, width: bounds.width + 2 * outset, height: bounds.height + 2 * outset },
          nominalRadius: (14 + strokeWidth / 2) * scale, foreground: [17, 17, 17] });
        const options = { bounds, strokeWidth: strokeWidth * scale, cornerRadius: 14 * scale, foreground: [17, 17, 17], background: [238, 238, 238], outsideBackground: [255, 255, 255] };
        const referenceScans = strokeEdgeScans(expected, options), scans = strokeEdgeScans(actual, options);
        const delta = referenceScans.probes.map((probe, i) => ({ centroid: scans.probes[i]?.centroid - probe.centroid, width: scans.probes[i]?.width - probe.width }));
        rows.push({ dpr, zoom, strokeWidth, clipContent, pixel, radius, referenceScans, scans, delta });
        if (process.env.DESIGN_SHADOW_EVIDENCE_DIR) {
          const directory = resolve(process.env.DESIGN_SHADOW_EVIDENCE_DIR, "rounded-ring"); await mkdir(directory, { recursive: true });
          const name = `dpr${dpr}-zoom${zoom}-w${strokeWidth}-clip${clipContent}`;
          await Promise.all([writeFile(resolve(directory, `${name}-html.png`), html), writeFile(resolve(directory, `${name}-svg.png`), svg),
            writeFile(resolve(directory, "report.json"), JSON.stringify(rows, null, 2))]);
        }
      }
    } finally { await page.close(); }
  }
  for (const row of rows) {
    assert.ok(row.pixel.mismatchRatio <= .001 && row.pixel.largestCluster <= 6, JSON.stringify(row));
    assert.deepEqual(row.radius.failures, [], JSON.stringify(row));
    assert.equal(row.referenceScans.measurable && row.scans.measurable, true, JSON.stringify(row));
    assert.ok(row.delta.every(delta => Math.abs(delta.centroid) <= .35 && Math.abs(delta.width) <= .35), JSON.stringify(row));
  }
});

test("ordinary external shadows and forged or mismatched paint hints retain their measured CSS meaning", async t => {
  const { capture } = await captureFixture(t);
  const normal = "rgb(12,34,56) 2px 3px 4px 0px";
  const pair = "rgb(220,38,38) 0px 0px 0px 2px,inset rgb(220,38,38) 0px 0px 0px 2px";
  for (const [hint, paint, decoration = ""] of [
    ["", normal], ["", pair],
    [' data-codeshell-stroke="center-shadow-v1"', normal],
    [' data-codeshell-stroke="legacy-shadow-v1"', "rgb(220,38,38) 0px 0px 0px 2px,inset rgb(0,0,0) 0px 0px 0px 2px"],
    [' data-codeshell-stroke="center-shadow-v1"', pair.replaceAll("2px", "51px")],
    [' data-codeshell-stroke="center-shadow-v1"', pair, ";border:1px solid blue"],
    [' data-codeshell-stroke="center-shadow-v1"', pair, ";outline:1px solid blue"],
  ]) {
    const captured = await capture(`<!doctype html><style>body{margin:0}.cs-page{position:relative;width:400px;height:240px;background:white}</style><main class="cs-page"><div data-codeshell-id="external" data-codeshell-node-type="rectangle"${hint} style="position:absolute;left:20px;top:20px;width:100px;height:60px;background:white;box-shadow:${paint}${decoration}"></div></main>`);
    const actual = normalizeDesignDocument(captured).nodes.find(node => node.id === "external");
    assert.equal(actual.stroke, "transparent", "a hint without matching rendered evidence must not invent a stroke");
    assert.equal(actual.strokeWidth, 0);
    assert.deepEqual(actual.shadow, paint === normal ? { color: "#0c2238", opacity: 1, x: 2, y: 3, blur: 4 } : { color: "#dc2626", opacity: 1, x: 0, y: 0, blur: 0 });
  }
});

test("stroke-bearing scalar shadow exterior matches SVG geometry at DPR 1 and 2", async t => {
  const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-lcd-text"] });
  t.after(() => browser.close());
  const rows = [];
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 400, height: 240 }, deviceScaleFactor: dpr });
    await page.route("**/*", route => route.abort());
    try {
      for (const strokeAlign of [undefined, "center", "outside", "inside"]) {
        const document = documentFor([shape("shape", { x: 80, y: 60, width: 115, height: 70,
          fill: "#eeeeee", stroke: "#111111", strokeWidth: 2,
          ...(strokeAlign ? { strokeAlign } : {}),
          shadow: { color: "#000000", opacity: .25, x: 4, y: 6, blur: 8 },
        })]);
        await page.setContent(exportDesignFrontend(document));
        const html = await page.screenshot();
        await page.setContent(`<!doctype html><style>body{margin:0}</style>${exportDesignSvg(normalizeDesignDocument(document))}`);
        const svg = await page.screenshot();
        const outset = (strokeAlign === "inside" ? 0 : strokeAlign === "outside" ? 2 : 1) + 1;
        const metrics = compareShadowGeometry(PNG.sync.read(html), PNG.sync.read(svg), {
          roi: { x: 40 * dpr, y: 20 * dpr, width: 200 * dpr, height: 160 * dpr },
          excludeBounds: { x: (80 - outset) * dpr, y: (60 - outset) * dpr, width: (115 + outset * 2) * dpr, height: (70 + outset * 2) * dpr },
        });
        rows.push({ dpr, strokeAlign: strokeAlign ?? "legacy", ...metrics });
        if (process.env.DESIGN_SHADOW_EVIDENCE_DIR) {
          const directory = process.env.DESIGN_SHADOW_EVIDENCE_DIR;
          await mkdir(directory, { recursive: true });
          await Promise.all([
            writeFile(resolve(directory, `scalar-${strokeAlign ?? "legacy"}-dpr${dpr}-html.png`), html),
            writeFile(resolve(directory, `scalar-${strokeAlign ?? "legacy"}-dpr${dpr}-svg.png`), svg),
            writeFile(resolve(directory, "shadow-geometry.json"), `${JSON.stringify(rows, null, 2)}\n`),
          ]);
        }
      }
    } finally { await page.close(); }
  }
  for (const row of rows) {
    assert.equal(row.measurable, true, JSON.stringify(row));
    assert.deepEqual(row.failures, [], JSON.stringify(row));
  }
});
