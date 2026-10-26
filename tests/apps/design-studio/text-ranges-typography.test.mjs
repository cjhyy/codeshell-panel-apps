import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { normalizeDesignDocument, serializeDesignDocument, designPageBounds } from "../../../apps/design-studio/app/document.mjs";
import { projectTextRanges, textRangeSourceSignature, validateTextRanges, setTextRangeStyle } from "../../../apps/design-studio/app/text-ranges.mjs";
import { currentTextMetrics, textMetricsSignature, measuredWrapSource } from "../../../apps/design-studio/app/text-metrics.mjs";
import { designTextFontResourceIds } from "../../../apps/design-studio/app/font-css.mjs";

const root = resolve("apps/design-studio/app");
const text = "Example title (example.com) More";
const domainStart = text.indexOf("example.com"), domainEnd = domainStart + "example.com".length;
const base = (ranges = [{ start: domainStart, end: domainEnd, fontSize: 10.6667, fill: "#828282" }]) => ({
  id: "copy", name: "Editable mixed typography", type: "text", x: 20, y: 20, width: 550, height: 60,
  text, fontFamily: "Inter", fontSize: 13.3333, fontWeight: 400, fontStyle: "normal", lineHeight: 16,
  lineHeightUnit: "pixels", textAlign: "left", fill: "#000000", stroke: "transparent", strokeWidth: 0,
  opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false,
  textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges },
});
const doc = node => ({ format: "codeshell.design", version: 3, name: "Typography ranges", resources: [],
  canvas: { width: 600, height: 180, background: "#ffffff" }, tokens: { colors: [] }, activePageId: "main",
  pages: [{ id: "main", name: "Main", children: [node] }] });

test("typography ranges are strict, editable and lossless across document/public schemas and save/reopen", async () => {
  const value = base([{ start: domainStart, end: domainEnd, fontSize: 10.6667, fontFamily: "Roboto", fontWeight: 700, fontStyle: "italic" }]);
  const state = normalizeDesignDocument(doc(value)), saved = serializeDesignDocument(state);
  assert.equal(serializeDesignDocument(normalizeDesignDocument(JSON.parse(saved))), saved);
  assert.deepEqual(projectTextRanges(value).find(run => run.sourceStart === domainStart).style,
    { fontFamily: "Roboto", fontSize: 10.6667, fontWeight: 700, fontStyle: "italic", fill: "#000000", textDecoration: "none" });
  for (const fontSize of [1, 5, 7, 240]) {
    const small = base([{ start: domainStart, end: domainEnd, fontSize }]); small.fontSize = fontSize;
    assert.doesNotThrow(() => normalizeDesignDocument(doc(small)));
  }
  for (const style of [{ fontSize: 0.9 }, { fontSize: 241 }, { fontSize: Infinity }, { fontWeight: 750 },
    { fontStyle: "oblique" }, { fontFamily: "inherit" }, { fontFamily: "x".repeat(121) }])
    assert.throws(() => validateTextRanges(base([{ start: 0, end: 1, ...style }])));
  const { default: Ajv } = await import("ajv/dist/2020.js");
  const schema = JSON.parse(await readFile(resolve(root, "formats/codeshell-design-v3.schema.json")));
  assert(new Ajv({ strict: false }).compile(schema)(doc(value)));
  const manifest = JSON.parse(await readFile(resolve(root, "../.codeshell-panel/panel.json")));
  const inputSchema = manifest.agent.tools.find(tool => tool.name === "use_design").inputSchema;
  const { validateToolArgsStrict } = await import("@cjhyy/code-shell-core");
  assert.equal(validateToolArgsStrict("use_design", { expected_state_revision: "typography", operations: [
    { op: "update_node", node_id: "copy", changes: { fontSize: 1, textRanges: value.textRanges } },
  ] }, inputSchema), null);
});

test("font edits invalidate metric receipts while paint edits keep them; range font resources stay portable", () => {
  const value = base();
  value.textMetrics = { version: 1, signature: textMetricsSignature(value), lineWidths: [200],
    lineInkBounds: [{ x: 0, y: 0, width: 200, height: 14 }], height: 14, fontAvailable: true };
  assert(currentTextMetrics(value));
  const edit = style => setTextRangeStyle(value, { start: domainStart, end: domainEnd, style,
    expectedSourceSignature: value.textRanges.sourceSignature });
  assert(currentTextMetrics(edit({ fill: "#333333" })));
  assert.equal(edit({ fontSize: 11 }).textMetrics, undefined);
  const changed = structuredClone(value); changed.textRanges.ranges[0].fontSize = 11;
  assert.equal(currentTextMetrics(changed), null);
  const resources = [{ id: "inter", kind: "font", family: "Inter" }, { id: "roboto", kind: "font", family: "Roboto" }];
  assert.deepEqual(designTextFontResourceIds({ ...value, fontRef: "inter", textRanges: {
    ...value.textRanges, ranges: [{ start: 0, end: 1, fontFamily: "Roboto" }],
  } }, resources), ["inter", "roboto"]);
});

test("infinite content bounds retain measured mixed-size line offsets at far world coordinates", () => {
  const node = base([{ start: 6, end: 9, fontSize: 48 }]);
  Object.assign(node, { text: "small\nBIG", x: -500, y: 65000, width: 100, height: 20, fontSize: 12, lineHeight: 1.5 });
  delete node.lineHeightUnit;
  node.textRanges.sourceSignature = textRangeSourceSignature(node.text);
  // A bounded synthetic measurement receipt exercises the public document
  // bounds contract; this does not claim real font or pixel equivalence.
  node.textMetrics = { version: 1, signature: textMetricsSignature(node),
    lineWidths: [28, 95], lineInkBounds: [{ x: 0, y: 0, width: 28, height: 10 }, { x: 0, y: -2, width: 95, height: 50 }],
    lineHeights: [18, 72], lineOffsets: [0, 60], alphabeticBaseline: 9,
    height: 108, fontAvailable: true };
  const raw = doc(node); raw.canvas.mode = "infinite";
  const state = normalizeDesignDocument(raw), before = serializeDesignDocument(state);
  assert.deepEqual(designPageBounds(state), { x: -500, y: 65000, width: 100, height: 108 });
  const reopened = normalizeDesignDocument(JSON.parse(before));
  assert.deepEqual(designPageBounds(reopened), designPageBounds(state));
  assert.equal(serializeDesignDocument(reopened), before);
});

test("source-aware wrapping passes exact offsets for repeated substrings and hard lines", () => {
  const source = "same same same\nsame same", calls = [];
  const result = measuredWrapSource(source, 6, (value, start) => {
    assert.equal(source.slice(start, start + value.length), value);
    calls.push(start);
    return { width: [...value].reduce((width, _char, index) => width + (start + index < 5 ? 2 : 1), 0) };
  });
  assert(calls.some(start => start >= 15));
  assert.equal(result.lines.map(line => source.slice(line.sourceStart, line.sourceEnd) + (line.breakAfter === "hard" ? "\n" : "")).join(""), source);
});

async function browserFixture(t) {
  const browser = await chromium.launch({ args: ["--disable-gpu"] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 600, height: 180 }, deviceScaleFactor: 1 });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url()), path = resolve(root, "." + decodeURIComponent(url.pathname));
    if (url.origin !== "https://typography.test") return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" });
    if (!path.startsWith(root + sep)) return route.abort();
    return route.fulfill({ body: await readFile(path), contentType: { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2" }[extname(path)] });
  });
  await page.goto("https://typography.test/"); return page;
}

test("13.3333px title and 10.6667px domain use exact browser widths and editable SVG/frontend pixels", async t => {
  const page = await browserFixture(t);
  const observed = await page.evaluate(async node => {
    const fontCss = '@font-face{font-family:Inter;src:url(/fonts/InterVariable.woff2);font-weight:100 900;font-display:block}';
    const { measureFigmaTextDocument, createBrowserTextMeasurer, currentTextMetrics } = await import("/text-metrics.mjs");
    const { exportDesignSvg, normalizeDesignDocument } = await import("/document.mjs");
    const { exportDesignFrontend } = await import("/frontend-export.mjs");
    const style = document.createElement("style"); style.textContent = fontCss; document.head.append(style);
    await document.fonts.load("400 13.3333px Inter"); await document.fonts.ready;
    const range = node.textRanges.ranges[0], prefix = node.text.slice(0, range.start), middle = node.text.slice(range.start, range.end), suffix = node.text.slice(range.end);
    const reference = `<!doctype html><style>${fontCss}body{margin:0;background:white}p{position:absolute;left:20px;top:20px;margin:0;font:400 13.3333px/16px Inter;white-space:pre}span{font-size:10.6667px;color:#828282}</style><p>${prefix}<span>${middle}</span>${suffix}</p>`;
    const documentValue = { format: "codeshell.design", version: 3, name: "Mixed", resources: [], canvas: { width: 600, height: 180, background: "#ffffff" },
      tokens: { colors: [] }, activePageId: "main", pages: [{ id: "main", name: "Main", children: [node] }] };
    const state = normalizeDesignDocument(documentValue);
    await measureFigmaTextDocument(state, { nativeLineBoxes: true });
    const actual = state.nodes[0], measurer = createBrowserTextMeasurer(); measurer.configure(actual);
    const realWidth = measurer.measure(actual.textSource ?? actual.text, 0).width; measurer.close();
    return { reference, actual, svg: exportDesignSvg(state), frontend: exportDesignFrontend(state).replace("<head>", `<head><style>${fontCss}</style>`),
      width: currentTextMetrics(actual).lineWidths[0], realWidth, ranges: actual.textRanges, source: actual.textSource ?? actual.text };
  }, base());
  assert.equal(observed.width, observed.realWidth);
  assert.equal(observed.source, text);
  assert.equal(observed.ranges.ranges[0].fontSize, 10.6667);
  await page.setContent(observed.reference); await page.evaluate(() => document.fonts.ready);
  const expected = PNG.sync.read(await page.screenshot());
  for (const [label, source] of [["svg", `<style>@font-face{font-family:Inter;src:url(/fonts/InterVariable.woff2);font-weight:100 900}body{margin:0}svg{display:block}</style>${observed.svg}`], ["frontend", observed.frontend]]) {
    await page.setContent(source); await page.evaluate(() => document.fonts.ready);
    const actual = PNG.sync.read(await page.screenshot());
    if (process.env.DESIGN_STUDIO_TYPOGRAPHY_EVIDENCE) {
      const directory = resolve(process.env.DESIGN_STUDIO_TYPOGRAPHY_EVIDENCE); await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, "source.png"), PNG.sync.write(expected));
      await writeFile(resolve(directory, label + ".png"), PNG.sync.write(actual));
      await writeFile(resolve(directory, "observations.json"), JSON.stringify(observed, null, 2));
    }
    assert(actual.data.equals(expected.data), `${label}: mixed-size typography pixels differ`);
  }
});

test("CanvasKit uses one shaped paragraph with supplied range size/weight/style/family and refuses missing range faces", async t => {
  const page = await browserFixture(t); await page.addScriptTag({ url: "/canvas/vendor/canvaskit.js" });
  const result = await page.evaluate(async node => {
    const CK = await CanvasKitInit({ locateFile: file => "/canvas/vendor/" + file });
    const { createCanvasKitText } = await import("/canvas/canvaskit-text.mjs");
    const definitions = [
      ["builtin-inter-400-normal", "Inter", 400, "normal", "InterVariable.woff2"],
      ["builtin-inter-700-italic", "Inter", 700, "italic", "InterVariable-Italic.woff2"],
      ["builtin-roboto-400-normal", "Roboto", 400, "normal", "Roboto-Variable.ttf"],
    ];
    const resources = new Map();
    for (const [id, family, weight, style, file] of definitions) resources.set(id, { bytes: new Uint8Array(await (await fetch("/fonts/" + file)).arrayBuffer()),
      mimeType: "font/woff2", descriptor: { id, kind: "font", family, weight, style } });
    node.fontRef = definitions[0][0];
    const design = { nodes: [node], resources: [...resources.values()].map(resource => resource.descriptor) }, before = JSON.stringify(node);
    const counters = { textLines: 0, rasterTextNodes: 0, nativeTextNodes: 0, gradientPaints: 0 }, warnings = [], shapes = [];
    const renderer = await createCanvasKitText({ CK, design, resources, document, fallbackFontUrls: new Map(), counters,
      unsupportedNode: (_node, code) => warnings.push(code), makePaint: (_node, fill) => { const paint = new CK.Paint(); paint.setColor(CK.Color(...[1,3,5].map(i => parseInt(fill.color.slice(i,i+2),16)), 1)); return paint; } });
    try {
      for (const fields of [{}, { fontWeight: 700, fontStyle: "italic" }, { fontFamily: "Roboto" }]) {
        const copy = structuredClone(node); Object.assign(copy.textRanges.ranges[0], fields);
        renderer.draw({ drawParagraph(paragraph) {
          const title = paragraph.getGlyphInfoAt(0), domain = paragraph.getGlyphInfoAt(copy.textRanges.ranges[0].start);
          shapes.push({ width: paragraph.getLongestLine(), title: Array.from(title.graphemeLayoutBounds), domain: Array.from(domain.graphemeLayoutBounds) });
        } }, copy);
      }
      const missing = structuredClone(node); missing.textRanges.ranges[0].fontFamily = "Unprovided Face";
      let missingCode; try { renderer.draw({ drawParagraph() { throw Error("missing font must refuse before paint"); } }, missing); } catch (error) { missingCode = error.code; }
      return { shapes, stats: renderer.stats(), counters, warnings, missingCode, unchanged: before === JSON.stringify(node) };
    } finally { renderer.dispose(); }
  }, base());
  assert.equal(result.shapes.length, 3);
  assert.equal(result.counters.nativeTextNodes, 3);
  assert.equal(result.counters.rasterTextNodes, 0);
  assert.equal(result.stats.rasterTextImages, 0);
  assert.equal(result.missingCode, "TEXT_RANGES_UNSUPPORTED");
  assert.equal(result.unchanged, true);
  assert.deepEqual(result.warnings, []);
  assert(new Set(result.shapes.map(shape => shape.width)).size === 3, "weight/style/family change the actual paragraph advances");
  const original = result.shapes[0];
  assert(original.domain[3] - original.domain[1] < original.title[3] - original.title[1], "the smaller domain keeps smaller actual glyph bounds");
});
