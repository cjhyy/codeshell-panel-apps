import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { test } from "node:test";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { canvasKitTextRangePlan } from "../../../apps/design-studio/app/canvas/canvaskit-text.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { createRendererController } from "../../../apps/design-studio/app/renderer-controller.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";

const app = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const evidenceRoot = process.env.DESIGN_STUDIO_TEXT_RANGES_RENDERER_EVIDENCE;
async function retainEvidence(name, bytes) {
  if (!evidenceRoot) return;
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(resolve(evidenceRoot, name), bytes, { flag: "wx" });
}
const base = (text, ranges = [{ start: 1, end: 2, fill: "#123456" }]) => ({
  id: "copy", name: "Editable paragraph", type: "text", x: 20, y: 20, width: 630, height: 120,
  text, fill: "#123456", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0,
  visible: true, locked: false, cornerRadius: 0, fontFamily: "Inter", fontRef: "inter",
  fontSize: 24, fontWeight: 400, lineHeight: 1.25, textAlign: "left",
  textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges },
});
const common = { stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false };
const doc = node => ({ format: "codeshell.design", version: 3, name: "Ranged text", resources: [],
  canvas: { width: 760, height: 350, background: "#ffffff" }, tokens: { colors: [] }, activePageId: "page",
  pages: [{ id: "page", name: "Page", children: [{ ...common, id: "owner", name: "Owner", type: "frame", x: 20, y: 20,
    width: 630, height: 120, fill: "transparent", layout: "vertical", gap: 0, padding: 0, alignItems: "start", justifyContent: "start",
    layoutSizingVertical: "hug", children: [{ ...node, layoutSizingHorizontal: "fill", layoutSizingVertical: "hug" }] }] }] });

test("frontend ranges survive normalized flat state, save/reopen and inherited scalar edits", () => {
  const value = base("AV office e\u0301", [{ start: 1, end: 2, fill: "#991122", href: "#" }]);
  delete value.fontRef;
  const state = normalizeDesignDocument(doc(value));
  const saved = serializeDesignDocument(state), reopened = normalizeDesignDocument(JSON.parse(saved));
  const html = exportDesignFrontend(state);
  assert.equal(exportDesignFrontend(reopened), html);
  assert.equal(exportDesignFrontend(JSON.parse(saved)), html);
  assert.match(html, /href="#"/);
  assert.match(html, /color:inherit/);
  assert.match(html, /color:#991122/);
  state.nodes.find(node => node.id === "copy").fill = "#554433";
  const edited = exportDesignFrontend(state);
  assert.match(edited, /color:#554433/);
  assert.match(edited, /color:#991122/);
});

test("CanvasKit range capability refuses exact custom decoration and fallback shaping without mutating data", () => {
  const node = base("AV office e\u0301");
  assert.equal(canvasKitTextRangePlan({ ...node, textRanges: undefined }, { suppliedFont: false }), null);
  assert.equal(canvasKitTextRangePlan(node).map(run => run.text).join(""), node.text);
  for (const [candidate, options] of [
    [node, { suppliedFont: false }], [node, { missingGlyphs: 1 }],
    [{ ...node, stroke: "#000000", strokeWidth: 1 }],
    ...["textDecorationThickness", "textUnderlineOffset", "textDecorationSkipInk"].map(key => [base(node.text, [{ start: 0, end: 2,
      textDecoration: "underline", [key]: key === "textDecorationSkipInk" ? "auto" : { unit: "auto" } }])]),
  ]) {
    const before = structuredClone(candidate);
    assert.throws(() => canvasKitTextRangePlan(candidate, options), error => error.code === "TEXT_RANGES_UNSUPPORTED");
    assert.deepEqual(candidate, before);
  }
  assert.throws(() => canvasKitTextRangePlan({ ...node, fillPaints: [{ type: "SOLID", color: "#123456", opacity: 1 }] }),
    error => error.code === "TEXT_RANGES_UNSUPPORTED_BASE_PAINT", "shared model rejects base paint stacks before renderer capability selection");
  const stale = { ...node, textSource: "Other source" };
  assert.throws(() => canvasKitTextRangePlan(stale), error => error.code === "TEXT_RANGES_STALE");
});

test("range capability failure reaches actual app status text through the controller failure path", async () => {
  const source = await readFile(resolve(app, "app.js"), "utf8");
  assert.match(source,/onState\(state\) \{ rendererStateChanged\("gpu", state\); \}/u);
  const start = source.indexOf("function rendererStateChanged(");
  const end = source.indexOf("\nfunction chooseRenderer(", start);
  assert(start >= 0 && end > start);
  const elements = Object.fromEntries(["gpuCanvas", "browserSurface", "stageWrap", "rendererState", "rendererMessage", "retryRenderer", "rendererMessageText"]
    .map(key => [key, { dataset: {}, hidden: false, textContent: "", title: "" }]));
  const onState = new vm.Script(`${source.slice(start,end)}\n(state) => rendererStateChanged("gpu",state)`).runInContext(vm.createContext({ elements,rendererMode:"gpu" }));
  let disposed = 0;
  const controller = createRendererController({ canvas: new EventTarget(), capability: true, onState,
    loadRenderer: async () => ({ createRenderer: async () => ({
      resize() {},
      render() {},
      setScene() { canvasKitTextRangePlan(base("AV", [{ start: 0, end: 2, textDecoration: "underline", textUnderlineOffset: { unit: "em", value: 0.1578 } }])); },
      dispose() { disposed++; },
    }) }) });
  const design = { nodes: [base("AV")] }, before = structuredClone(design);
  await controller.update({ key: "ranges", revision: 1, design, getResources: () => new Map(),
    viewport: { width: 760, height: 350, dpr: 1, zoom: 1, pan: { x: 0, y: 0 } } });
  assert.equal(controller.state().status, "error");
  assert.match(controller.state().reason, /TEXT_RANGES_UNSUPPORTED/);
  assert.equal(elements.rendererState.textContent, "范围文字不支持");
  assert.match(elements.rendererMessageText.textContent, /范围下划线/);
  assert.equal(elements.rendererMessage.hidden, false);
  assert.equal(elements.gpuCanvas.hidden, true);
  assert.equal(disposed, 1);
  assert.deepEqual(design, before);
  await controller.dispose();
});

async function cpuBrowser(t) {
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  return browser.newContext({ viewport: { width: 760, height: 350 }, deviceScaleFactor: 1 });
}

test("frontend source ranges keep authored LF/NBSP, exact CSS underline and links through direct width/copy/font edits", async t => {
  const context = await cpuBrowser(t), page = await context.newPage(), reference = await context.newPage();
  const font = await readFile(resolve(app, "fonts/InterVariable.woff2"));
  const fontCss = `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font.toString("base64")}) format('woff2');font-weight:100 900;font-display:block}`;
  const text = "Before linked copy after.\nNBSP\u00a0keeps  spaces";
  const range = { start: 7, end: 18, fill: "#1a65a6", textDecoration: "underline", textDecorationThickness: { unit: "px", value: 1 },
    textUnderlineOffset: { unit: "em", value: 0.1578 }, textDecorationSkipInk: "auto", href: "#" };
  const node = { ...base(text, [range]), text: "Before linked \ncopy after.\nNBSP\u00a0keeps  spaces", textSource: text, textFlow: "wrap" };
  const design = doc(node), before = JSON.stringify(design);
  const html = exportDesignFrontend(design).replace("<head>", `<head><style>${fontCss}</style>`);
  await page.setContent(html);
  assert.equal(await page.locator('[data-codeshell-source-id="copy"]').textContent(), text);
  assert.equal(await page.locator('a').getAttribute("href"), "#");
  assert.equal(await page.locator('[data-codeshell-source-id="copy"] [style*="position:absolute"]').count(), 0);
  let stage = 0;
  for (const [width, linkText, size, color = "#123456"] of [[630, "linked copy", 24], [390, "linked copy", 24], [630, "linked copy", 24],
    [390, "a longer authored linked copy", 24], [390, "a longer authored linked copy", 21], [390, "linked copy", 21, "#880000"], [630, "linked copy", 24]]) {
    await page.locator('[data-codeshell-source-id="owner"]').evaluate((element, width) => { element.style.width = `${width}px`; }, width);
    await page.locator('[data-codeshell-source-id="copy"]').evaluate((element, { size, color }) => {
      element.style.fontSize = `${size}px`; element.style.color = color;
    }, { size, color });
    await page.locator("a").evaluate((element, text) => { element.textContent = text; }, linkText);
    await reference.setContent(`<!doctype html><style>${fontCss}*{box-sizing:border-box}html,body{margin:0;background:white}.owner{position:absolute;left:20px;top:20px;width:${width}px;display:flex;flex-direction:column}.copy{width:100%;color:${color};font:400 ${size}px/1.25 Inter;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#1a65a6;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.1578em;text-decoration-skip-ink:auto}</style><div class="owner"><div class="copy">Before <a href="#"></a> after.\nNBSP\u00a0keeps  spaces</div></div>`);
    await reference.locator("a").evaluate((element, text) => { element.textContent = text; }, linkText);
    await Promise.all([page.evaluate(() => document.fonts.ready), reference.evaluate(() => document.fonts.ready)]);
    const actualPng = await page.screenshot(), expectedPng = await reference.screenshot();
    const actual = PNG.sync.read(actualPng), expected = PNG.sync.read(expectedPng);
    const prefix = `frontend-${stage++}-${width}-${size}`;
    await retainEvidence(`${prefix}-exported.png`, actualPng);
    await retainEvidence(`${prefix}-source.png`, expectedPng);
    await retainEvidence(`${prefix}-exported.html`, await page.content());
    await retainEvidence(`${prefix}-source.html`, await reference.content());
    assert(actual.data.equals(expected.data), `${width}/${size}/${linkText}: strict frontend pixels after direct DOM edit`);
    assert.equal(await page.locator('[data-codeshell-source-id="copy"]').textContent(), `Before ${linkText} after.\nNBSP\u00a0keeps  spaces`);
  }
  assert.equal(JSON.stringify(design), before);
  assert.equal(exportDesignFrontend(JSON.parse(before)), exportDesignFrontend(design));
  assert.throws(() => exportDesignFrontend(doc({ ...node, textRanges: { ...node.textRanges, sourceSignature: '["stale"]' } })), /签名/);
});

test("frontend effective range none cancels a scalar base underline without changing legacy output", async t => {
  const context = await cpuBrowser(t), page = await context.newPage(), reference = await context.newPage();
  const node = { ...base("AV office e\u0301", [{ start: 0, end: 3, textDecoration: "none" }]), textDecoration: "underline", fontFamily: "Arial" };
  const design = doc(node), html = exportDesignFrontend(design);
  await page.setContent(html);
  await reference.setContent('<!doctype html><style>html,body{margin:0;background:white}.owner{position:absolute;left:20px;top:20px;width:630px}.copy{font:400 24px/30px Arial;color:#123456;white-space:pre}<\/style><div class="owner"><div class="copy"><span>AV </span><span style="text-decoration:underline">office é</span></div></div>'.replace('<\\/style>', '</style>'));
  assert(PNG.sync.read(await page.screenshot()).data.equals(PNG.sync.read(await reference.screenshot()).data));
  assert.match(html, /text-decoration:none/);
  const legacy = { ...node }; delete legacy.textRanges;
  assert(!exportDesignFrontend(doc(legacy)).includes("<span"), "legacy uniform text stays one unchanged text child");
  assert.throws(() => exportDesignFrontend(doc({ ...node, stroke: "#000000", strokeWidth: 1 })), /TEXT_RANGES_UNSUPPORTED/);
  const multiLineLink = base("A\nB", [{ start: 0, end: 3, href: "#", fill: "#123456" }]);
  await page.setContent(exportDesignFrontend(doc(multiLineLink)));
  assert.equal(await page.locator("a").count(), 1, "authored LF does not manufacture extra anchors/tab stops");
  assert.equal(await page.locator("a").textContent(), "A\nB");
});

test("software CanvasKit supplied Paragraph preserves AV/fi/combining shaping across paint boundaries and rejects custom geometry", async t => {
  const context = await cpuBrowser(t), page = await context.newPage(), errors = [], blocked = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://range-renderer.test") { blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8">' });
    const path = resolve(app, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(app + sep)) { blocked.push(url.href); return route.abort(); }
    return route.fulfill({ body: await readFile(path), contentType: { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2" }[extname(path)] });
  });
  await page.goto("https://range-renderer.test");
  await page.addScriptTag({ url: "/canvas/vendor/canvaskit.js" });
  const result = await page.evaluate(async (includeEvidence) => {
    const CK = await CanvasKitInit({ locateFile: file => "/canvas/vendor/" + file });
    const { createCanvasKitText } = await import("/canvas/canvaskit-text.mjs");
    const { textRangeSourceSignature } = await import("/text-ranges.mjs");
    const bytes = new Uint8Array(await (await fetch("/fonts/InterVariable.woff2")).arrayBuffer());
    const make = (text, ranges) => ({ id: "copy", name: "copy", type: "text", x: 20, y: 20, width: 600, height: 100,
      text, fill: "#123456", stroke: "transparent", strokeWidth: 0, fontFamily: "Inter", fontRef: "inter", fontSize: 24,
      fontWeight: 400, lineHeight: 1.25, textAlign: "left", ...(ranges ? { textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges } } : {}) });
    const rows = [];
    for (const [text, start, end] of [["AVATAR", 1, 2], ["office", 2, 3], ["e\u0301lan", 1, 2], ["A\u00a0V\nExplicit LF", 2, 5]]) {
      const nodes = [make(text), make(text, [{ start, end, fill: "#123456" }]), make(text, [{ start, end, fill: "#991122" }])];
      const design = { nodes: [nodes[0]], resources: [{ id: "inter", kind: "font", family: "Inter" }] }, before = JSON.stringify(design);
      const resources = new Map([["inter", { bytes, mimeType: "font/woff2", descriptor: design.resources[0] }]]);
      const counters = { textLines: 0, rasterTextNodes: 0, nativeTextNodes: 0, gradientPaints: 0 }, warnings = [];
      const renderer = await createCanvasKitText({ CK, design, resources, document, fallbackFontUrls: new Map(), counters,
        unsupportedNode: (_node, code) => warnings.push(code), makePaint: (_node, fill) => { const paint = new CK.Paint(); paint.setAntiAlias(true); paint.setColor(CK.Color(...[1,3,5].map(i => parseInt(fill.color.slice(i,i+2),16)), fill.opacity)); return paint; } });
      const outputs = [];
      try {
        for (const node of nodes) {
          const surface = CK.MakeSurface(760, 350), canvas = surface.getCanvas(), shapes = [];
          try {
            canvas.clear(CK.WHITE);
            renderer.draw({ drawParagraph(paragraph, x, y) {
              shapes.push({ x, y, width: paragraph.getLongestLine(), baseline: paragraph.getAlphabeticBaseline(),
                glyphs: Array.from({ length: String(node.text).split("\n")[shapes.length].length }, (_, index) => {
                  const glyph = paragraph.getGlyphInfoAt(index); return glyph ? { bounds: Array.from(glyph.graphemeLayoutBounds), range: glyph.graphemeClusterTextRange } : null;
                }) });
              canvas.drawParagraph(paragraph, x, y);
            } }, node);
            surface.flush();
            const image = surface.makeImageSnapshot();
            try { outputs.push({ shapes, pixels: Array.from(image.readPixels(0,0,{width:760,height:350,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB})),
              ...(includeEvidence ? { png: Array.from(image.encodeToBytes(CK.ImageFormat.PNG, 100)) } : {}) }); }
            finally { image.delete(); }
          } finally { surface.delete(); }
        }
        const unsupported = make(text, [{ start, end, textDecoration: "underline", textUnderlineOffset: { unit: "em", value: 0.1578 } }]);
        let refusal;
        try { renderer.draw({ drawParagraph() { throw Error("must refuse before drawing"); } }, unsupported); } catch (error) { refusal = error.code; }
        rows.push({ text, samePixels: outputs[0].pixels.every((v,i) => v === outputs[1].pixels[i]),
          sameShaping: JSON.stringify(outputs[0].shapes) === JSON.stringify(outputs[1].shapes) && JSON.stringify(outputs[1].shapes) === JSON.stringify(outputs[2].shapes),
          actualColorChangedPixels: outputs[0].pixels.reduce((sum,v,i) => sum + (v !== outputs[2].pixels[i]), 0),
          refusal, stats: renderer.stats(), warnings, counters: { ...counters }, stateUnchanged: JSON.stringify(design) === before,
          bytesUnchanged: resources.get("inter").bytes === bytes,
          ...(includeEvidence ? { outputEvidence: outputs.map(output => ({ shapes: output.shapes, png: output.png })) } : {}) });
      } finally { renderer.dispose(); }
    }
    return rows;
  }, Boolean(evidenceRoot));
  assert.equal(result.length, 4);
  for (const row of result) {
    assert.equal(row.samePixels, true, row.text);
    assert.equal(row.sameShaping, true, row.text);
    assert(row.actualColorChangedPixels > 0, row.text);
    assert.equal(row.refusal, "TEXT_RANGES_UNSUPPORTED");
    assert.equal(row.stats.rasterTextImages, 0);
    assert.equal(row.stats.rasterTextCacheBytes, 0);
    assert.equal(row.counters.rasterTextNodes, 0);
    assert.equal(row.counters.nativeTextNodes, 3);
    assert.equal(row.stateUnchanged, true);
    assert.equal(row.bytesUnchanged, true);
    assert.deepEqual(row.warnings, []);
  }
  for (let index = 0; index < result.length; index++) {
    const row = result[index];
    for (let variant = 0; variant < (row.outputEvidence?.length ?? 0); variant++) {
      const png = Buffer.from(row.outputEvidence[variant].png);
      await retainEvidence(`software-${index}-${variant}.png`, png);
      await retainEvidence(`software-${index}-${variant}.rgba`, PNG.sync.read(png).data);
      delete row.outputEvidence[variant].png;
    }
  }
  await retainEvidence("software-report.json", JSON.stringify({ researchScope: "CPU software Surface shaping/paint regression; no WebGL/editor/DOM pixel parity claim", result }, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
});
