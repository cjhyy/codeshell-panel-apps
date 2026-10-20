import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { prepareFigmaImport } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { auditDesignPages } from "../../../apps/design-studio/app/audit.mjs";
import {
  normalizeDesignState,
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import { currentTextMetrics, measuredWrap } from "../../../apps/design-studio/app/text-metrics.mjs";

test("word fitting lets trailing spaces hang while preserving explicit lines, leading spaces and every source byte", () => {
  const measure = (value) => ({ width: Array.from(value).length });
  assert.deepEqual(measuredWrap("one two three", 7, measure), ["one two ", "three"]);
  assert.deepEqual(measuredWrap("  one\n\n two\tthree  ", 30, measure), ["  one", "", " two\tthree  "]);
  const source = "  one  two\t three  ";
  assert.equal(measuredWrap(source, 7, measure).join(""), source);
  assert.equal(measuredWrap("     ", 2, measure).join(""), "     ");
});

const source = (
  text,
  { width = 100, height = 100, autoResize = "HEIGHT", family = "Arial" } = {},
) => ({
  type: "CANVAS",
  id: "0:1",
  name: "Text fixture",
  children: [
    {
      type: "TEXT",
      id: "1:1",
      name: "Measured copy",
      characters: text,
      absoluteBoundingBox: { x: 10, y: 10, width, height },
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      style: {
        fontFamily: family,
        fontSize: 20,
        fontWeight: 400,
        lineHeightPx: 28,
        textAutoResize: autoResize,
      },
    },
  ],
});

async function browserFixture(t) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const root = resolve("apps/design-studio/app");
  await page.route("https://metrics.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body></body></html>",
      });
    const file = resolve(root, `.${path}`);
    if (!file.startsWith(root + sep)) return route.abort();
    try {
      await route.fulfill({ contentType: "text/javascript", body: await readFile(file) });
    } catch {
      await route.fulfill({ status: 404, body: "missing" });
    }
  });
  await page.goto("https://metrics.test/");
  return page;
}

test("Node imports retain conservative checks until a real browser measurement exists", async () => {
  const result = await prepareFigmaImport(source("MMMMMMMMMMMM", { width: 20 }));
  assert.equal(result.textMeasurement.measured, 0);
  assert.equal(result.document.nodes[0].textMetrics, undefined);
  assert.ok(
    auditDesignPages(result.document).some((issue) => issue.code === "layout.text-width-overflow"),
  );
});

test("normal and pre-wrap browser line fits agree on hanging spaces without changing explicit whitespace", async (t) => {
  const page = await browserFixture(t);
  const observed = await page.evaluate(async () => {
    const { measuredWrap, createBrowserTextMeasurer } = await import("/text-metrics.mjs");
    const results = [];
    for (const [whiteSpace, source] of [["normal", "one two three"], ["pre-wrap", "  one two  three\n\n four five  "]]) {
      const element = document.createElement("div");
      Object.assign(element.style, { font: "20px/28px monospace", width: "85px", whiteSpace });
      element.textContent = source;
      document.body.append(element);
      const measure = createBrowserTextMeasurer(document);
      measure.configure({ fontFamily: "monospace", fontSize: 20, fontWeight: 400, width: element.getBoundingClientRect().width, textFlow: "wrap" });
      const lines = measuredWrap(source, element.getBoundingClientRect().width, (value) => measure.measure(value));
      measure.close();
      const range = document.createRange();
      range.setStart(element.firstChild, 0);
      range.setEnd(element.firstChild, 1);
      const top = range.getBoundingClientRect().top;
      let offset = 0;
      const positions = [];
      for (const [lineIndex, line] of lines.entries()) {
        for (const character of line) {
          if (/\S/u.test(character)) {
            range.setStart(element.firstChild, offset);
            range.setEnd(element.firstChild, offset + 1);
            positions.push({ expected: lineIndex, actual: Math.round((range.getBoundingClientRect().top - top) / 28) });
          }
          if (source[offset] !== character) throw Error("Wrapping changed a source character");
          offset++;
        }
        if (source[offset] === "\n") offset++;
      }
      results.push({ whiteSpace, lines, positions, consumed: offset, length: source.length });
      element.remove();
    }
    return results;
  });
  for (const result of observed) {
    assert.equal(result.consumed, result.length);
    assert(result.positions.every((position) => position.actual === position.expected), JSON.stringify(result));
  }
  assert.deepEqual(observed[0].lines, ["one two ", "three"]);
  assert(observed[1].lines.some((line) => line === ""));
  assert(observed[1].lines[0].startsWith("  "));
  assert(observed[1].lines.at(-1).endsWith("  "));
});

test("browser soft wrapping retains every source character and agrees with the exported SVG", async (t) => {
  const page = await browserFixture(t);
  const original = "An editable paragraph with  two spaces, 中文换行 and explicit\nsecond line.";
  const result = await page.evaluate(
    async (input) => {
      const { prepareFigmaImport } = await import("/figma-bridge.mjs");
      const { exportDesignSvg } = await import("/document.mjs");
      const result = await prepareFigmaImport(input);
      document.body.innerHTML = exportDesignSvg(result.document);
      const widths = [...document.querySelectorAll("svg text")].map((node) => {
        const trailing = / +$/u.exec(node.textContent)?.[0].length ?? 0;
        // Hanging line-end spaces retain their source bytes but paint no ink.
        return node.getComputedTextLength() - (trailing
          ? node.getSubStringLength(node.getNumberOfChars() - trailing, trailing) : 0);
      });
      return { result, widths };
    },
    source(original, { width: 135 }),
  );
  const node = result.result.document.nodes[0];
  assert.equal(node.textSource, original);
  assert.equal(node.text.replaceAll("\n", ""), original.replaceAll("\n", ""));
  assert.ok(node.text.split("\n").length > 2);
  assert.equal(node.textMetrics.fontAvailable, true);
  assert.ok(result.widths.every((width) => width <= node.width + 0.5));
  assert.ok(
    !auditDesignPages(result.result.document).some((issue) =>
      issue.code.startsWith("layout.text-"),
    ),
  );
  assert.ok(currentTextMetrics(node));
  node.textSource = `${original} Edited original source.`;
  assert.equal(currentTextMetrics(node), null);
  node.textSource = original;
  assert.ok(currentTextMetrics(node));
  const reopened = normalizeDesignState(result.result.document);
  assert.ok(currentTextMetrics(reopened.nodes[0]));
  assert.ok(serializeDesignDocument(reopened).includes('"textMetrics"'));
});

test("hug text uses real width and ink height; shrinking or editing still produces audit failures", async (t) => {
  const page = await browserFixture(t);
  const result = await page.evaluate(
    async (input) => {
      const { prepareFigmaImport } = await import("/figma-bridge.mjs");
      const { exportDesignSvg } = await import("/document.mjs");
      const result = await prepareFigmaImport(input);
      const svg = exportDesignSvg(result.document);
      document.body.innerHTML = svg;
      const image = new Image();
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = result.document.canvas.width;
      canvas.height = result.document.canvas.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let inkBottom = 0;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          const index = (y * canvas.width + x) * 4;
          if (Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 128)
            inkBottom = y + 1;
        }
      return { result, inkBottom };
    },
    source("Welcome to text measurement!", { width: 1, height: 1, autoResize: "WIDTH_AND_HEIGHT" }),
  );
  const documentValue = result.result.document,
    node = documentValue.nodes[0];
  assert.equal(node.text, node.textSource);
  assert.equal(node.textFlow, undefined);
  assert.ok(node.width > 100);
  assert.ok(result.inkBottom > node.y);
  assert.ok(node.y + node.height + 0.5 >= result.inkBottom);
  assert.ok(
    !auditDesignPages(documentValue).some((issue) => issue.code.startsWith("layout.text-")),
  );
  const originalNode = structuredClone(node);
  node.width = 20;
  node.height = 1;
  let issues = auditDesignPages(documentValue);
  assert.ok(issues.some((issue) => issue.code === "layout.text-width-overflow"));
  assert.ok(issues.some((issue) => issue.code === "layout.text-overflow"));
  node.text += " Much longer changed content";
  assert.equal(currentTextMetrics(node), null);
  issues = auditDesignPages(documentValue);
  assert.ok(issues.some((issue) => issue.code === "layout.text-width-overflow"));
  for (const property of [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
  ]) {
    const copy = structuredClone(originalNode);
    copy[property] = typeof copy[property] === "number" ? copy[property] + 1 : "changed";
    assert.equal(currentTextMetrics(copy), null, property);
  }
});

test("parent checks distinguish a tall text box from actual hanging-baseline ink escaping its parent", async (t) => {
  const page = await browserFixture(t);
  const input = source("Short text", { width: 140, height: 100 });
  input.children = [
    {
      type: "FRAME",
      id: "1:2",
      name: "Text owner",
      clipsContent: false,
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 50 },
      children: input.children,
    },
  ];
  const result = await page.evaluate(async (input) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    return prepareFigmaImport(input);
  }, input);
  const node = result.document.nodes.find((node) => node.type === "text");
  assert.equal(node.height, 100);
  assert.ok(
    !auditDesignPages(result.document).some(
      (issue) => issue.nodeId === node.id && issue.code === "layout.parent-overflow",
    ),
  );
  node.y = 40;
  assert.ok(
    auditDesignPages(result.document).some(
      (issue) => issue.nodeId === node.id && issue.code === "layout.parent-overflow",
    ),
  );
});

test("a valid glyph receipt never exempts rotated ink that escapes its parent", async (t) => {
  const page = await browserFixture(t);
  const input = source("W", { width: 100, height: 20 });
  input.children[0].absoluteBoundingBox.x = 0;
  input.children[0].absoluteBoundingBox.y = 0;
  input.children = [
    {
      type: "FRAME",
      id: "1:2",
      name: "Owner",
      clipsContent: false,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 30 },
      children: input.children,
    },
  ];
  const result = await page.evaluate(async (input) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    return prepareFigmaImport(input);
  }, input);
  const node = result.document.nodes.find((node) => node.type === "text");
  assert.ok(currentTextMetrics(node));
  assert.ok(
    !auditDesignPages(result.document).some((issue) => issue.code === "layout.parent-overflow"),
  );
  node.rotation = 90;
  for (const parentRotation of [0, 30]) {
    result.document.nodes[0].rotation = parentRotation;
    assert.ok(
      auditDesignPages(result.document).some(
        (issue) => issue.nodeId === node.id && issue.code === "layout.parent-overflow",
      ),
    );
  }
});

test("missing fonts are reported and an oversized single glyph stays a real error", async (t) => {
  const page = await browserFixture(t);
  const result = await page.evaluate(
    async (input) => {
      const { prepareFigmaImport } = await import("/figma-bridge.mjs");
      return prepareFigmaImport(input);
    },
    source("W", {
      width: 1,
      height: 100,
      autoResize: "NONE",
      family: "Deliberately Missing Fixture Font",
    }),
  );
  const node = result.document.nodes[0];
  assert.equal(node.width, 1);
  assert.equal(node.textMetrics.fontAvailable, false);
  assert.ok(result.warnings.some((warning) => warning.code === "font-fallback"));
  assert.ok(
    auditDesignPages(result.document).some((issue) => issue.code === "layout.text-width-overflow"),
  );
});

test("malformed measurement receipts cannot enter a normalized document", async () => {
  const result = await prepareFigmaImport(source("Text"));
  for (const receipt of [
    null,
    {},
    { version: 1, signature: "x", lineWidths: [NaN], height: 20, fontAvailable: true },
    { version: 1, signature: "x", lineWidths: [20], height: -1, fontAvailable: true },
  ]) {
    const documentValue = structuredClone(result.document);
    documentValue.nodes[0].textMetrics = receipt;
    documentValue.pages[0].nodes = documentValue.nodes;
    assert.throws(() => normalizeDesignState(documentValue), /文字属性无效/u);
  }
});

test("hug text reserves the entire measured glyph width including a leading emoji bearing", async (t) => {
  const page = await browserFixture(t);
  const input = source("✅ Complete editable text", { width: 1, autoResize: "WIDTH_AND_HEIGHT" });
  input.children[0].style.fontSize = 12;
  input.children[0].style.lineHeightPx = 19.2;
  const result = await page.evaluate(async (input) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    return prepareFigmaImport(input);
  }, input);
  const node = result.document.nodes[0];
  assert.equal(node.text, "✅ Complete editable text");
  assert.ok(node.width >= node.textMetrics.lineWidths[0]);
  assert.ok(node.width >= node.textMetrics.lineInkBounds[0].width);
  assert.ok(
    !auditDesignPages(result.document).some((issue) => issue.code === "layout.text-width-overflow"),
  );
});

test("clipped controls inspect real glyph ink rather than font boxes and still detect a displaced glyph", async (t) => {
  const page = await browserFixture(t);
  // A fixed-height pixel fixture needs the same face on macOS and Linux. System
  // Arial aliases have different ink; use the reviewed bundled font in both the
  // browser measurement and the independently rasterized exported SVG.
  const input = source("Sample text", {
    width: 74,
    height: 16,
    autoResize: "WIDTH_AND_HEIGHT",
    family: "Roboto",
  });
  input.children[0].style.fontSize = 14;
  input.children[0].style.lineHeightPx = 16.0986;
  // A native TEXT bound starts at the control's line-box top. The real font
  // metrics supply its ink inset; the -3px edit below must still overflow.
  input.children[0].absoluteBoundingBox.y = 10;
  input.children = [
    {
      type: "FRAME",
      id: "1:2",
      name: "Input clip",
      clipsContent: true,
      absoluteBoundingBox: { x: 10, y: 10, width: 236, height: 16 },
      children: input.children,
    },
  ];
  const result = await page.evaluate(async (input) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    const { exportDesignSvg } = await import("/document.mjs");
    const { resourceDataUrlsFromPlans } = await import("/builtin-fonts.mjs");
    const result = await prepareFigmaImport(input);
    const resourceDataUrls = resourceDataUrlsFromPlans(result.resourcePlans);
    result.document.canvas = { width: 300, height: 100, background: "#ffffff" };
    const node = result.document.nodes.find((node) => node.type === "text");
    result.document.nodes[0].clipContent = false;
    let outsidePixels = [];
    async function opaqueInkOutside() {
      const image = new Image();
      image.src =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          exportDesignSvg(result.document, {
            resourceDataUrls,
            maxBytes: 4 * 1024 * 1024,
          }),
        );
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 300;
      canvas.height = 100;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, 300, 100).data;
      outsidePixels = [];
      let count = 0;
      for (let y = 0; y < 100; y++)
        for (let x = 0; x < 300; x++) {
          if (x >= 10 && x < 246 && y >= 10 && y < 26) continue;
          const index = (y * 300 + x) * 4;
          if (Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 128) {
            count++;
            if (outsidePixels.length < 20)
              outsidePixels.push({ x, y, rgb: [...pixels.subarray(index, index + 3)] });
          }
        }
      return count;
    }
    const outsideBefore = await opaqueInkOutside();
    const outsideBeforePixels = outsidePixels;
    node.y -= 3;
    const outsideAfter = await opaqueInkOutside();
    node.y += 3;
    result.document.nodes[0].clipContent = true;
    return { result, outsideBefore, outsideAfter, outsideBeforePixels };
  }, input);
  assert.deepEqual(result.result.textMeasurement.unavailableFonts, []);
  assert.equal(
    result.result.document.nodes.find((node) => node.type === "text").fontRef,
    "builtin-roboto-400-normal",
  );
  assert.equal(
    result.outsideBefore,
    0,
    `unclipped raster has no opaque glyph ink beyond the control: ${JSON.stringify({ pixels: result.outsideBeforePixels, text: result.result.document.nodes.find((node) => node.type === "text") })}`,
  );
  assert.ok(result.outsideAfter > 0, "moving text produces a real raster crop");
  const documentValue = result.result.document;
  assert.ok(
    !auditDesignPages(documentValue).some((issue) => issue.code === "layout.parent-overflow"),
  );
  documentValue.nodes.find((node) => node.type === "text").y -= 3;
  assert.ok(
    auditDesignPages(documentValue).some(
      (issue) => issue.code === "layout.parent-overflow" && issue.blocking,
    ),
  );
});

test("a numeric font family measures the loaded icon glyph consistently in SVG and Canvas", async (t) => {
  const page = await browserFixture(t);
  const input = source("\ue586", {
    width: 20,
    height: 24,
    autoResize: "WIDTH_AND_HEIGHT",
    family: "Font Awesome 5 Free",
  });
  input.children[0].style.fontWeight = 900;
  const result = await page.evaluate(async (input) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    const result = await prepareFigmaImport(input);
    const node = result.document.nodes[0];
    const context = document.createElement("canvas").getContext("2d");
    context.font = '900 20px "Font Awesome 5 Free"';
    const advance = context.measureText(node.text).width;
    return { node, advance, measurement: result.textMeasurement };
  }, input);
  assert.deepEqual(result.measurement.unavailableFonts, []);
  assert.equal(result.node.textMetrics.fontAvailable, true);
  assert.ok(
    Math.abs(result.node.textMetrics.lineWidths[0] - result.advance) < 0.01,
    "SVG and Canvas must select the same loaded face rather than an unquoted CSS fallback",
  );
});

test("native line boxes use measured font baselines across families, sizes, line heights, blank lines, resize and copy edits", async (t) => {
  const page = await browserFixture(t);
  await page.setViewportSize({ width: 640, height: 1000 });
  const cases = [
    { family: "Arial", size: 20, height: 24, weight: 400, copy: "Editable line boxes wrap when this native frame becomes narrower." },
    { family: "Courier New", size: 20, height: 30, weight: 700, copy: "Monospace copy\n\nkeeps every explicit blank line." },
    { family: "Georgia", size: 32, height: 48, weight: 400, italic: true, copy: "Italic serif ascenders and descenders: Hg pq." },
    { family: "Times New Roman", size: 12, height: 16, weight: 400, copy: "Small serif copy uses a non-terminating line-height ratio." },
    { family: "system-ui", size: 18, height: 18, weight: 400, copy: "System font with a tight line box: Hg pq." },
  ];
  const output = await page.evaluate(async (cases) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    const { exportDesignSvg, serializeDesignDocument, normalizeDesignDocument } = await import("/document.mjs");
    const { createFigmaBinding, createFigmaPatch } = await import("/figma-binding.mjs");
    const { measureFigmaTextDocument } = await import("/text-metrics.mjs");
    const { applyAllAutoLayouts } = await import("/layout.mjs");
    document.body.style.cssText = "margin:0;background:white";
    const root = document.createElement("main");
    root.style.cssText = "box-sizing:border-box;position:absolute;left:0;top:0;width:640px;height:1000px;display:flex;flex-direction:column;align-items:stretch;gap:12px;padding:20px";
    document.body.append(root);
    for (const specimen of cases) {
      const element = document.createElement("div");
      Object.assign(element.style, { fontFamily: specimen.family, fontSize: `${specimen.size}px`, fontWeight: String(specimen.weight), fontStyle: specimen.italic ? "italic" : "normal", lineHeight: `${specimen.height}px`, whiteSpace: "pre-wrap", flexShrink: "0" });
      element.textContent = specimen.copy; root.append(element);
    }
    const rect = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const input = { id: "0:1", type: "CANVAS", name: "Metrics", children: [{ id: "1:1", type: "FRAME", name: "Root", absoluteBoundingBox: rect(root), layoutMode: "VERTICAL", layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED", primaryAxisSizingMode: "FIXED", counterAxisSizingMode: "FIXED", paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20, itemSpacing: 12, primaryAxisAlignItems: "MIN", counterAxisAlignItems: "MIN", fills: [], children: cases.map((specimen, index) => ({ id: `2:${index + 1}`, type: "TEXT", name: specimen.family, absoluteBoundingBox: rect(root.children[index]), characters: specimen.copy, layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", layoutAlign: "STRETCH", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }], style: { fontFamily: specimen.family, fontSize: specimen.size, fontWeight: specimen.weight, italic: specimen.italic, lineHeightPx: specimen.height, textAutoResize: "HEIGHT", textAlignHorizontal: "LEFT", textAlignVertical: "TOP" } })) }] };
    const imported = await prepareFigmaImport(input);
    imported.document.canvas.background = "#ffffff";
    const binding = createFigmaBinding(imported);
    const noOp = createFigmaPatch(binding, imported.document);
    const moved = normalizeDesignDocument(JSON.parse(serializeDesignDocument(imported.document)));
    for (const node of moved.nodes) node.y += 11;
    const movedPatch = createFigmaPatch(binding, moved);
    const nodes = imported.document.nodes;
    const textNodes = nodes.filter((node) => node.type === "text");
    const initial = serializeDesignDocument(imported.document);
    const sources = new Map(input.children[0].children.map((node) => [node.id, node]));
    await measureFigmaTextDocument(imported.document, { nativeLineBoxes: true, sourceNodes: sources, sourceIds: new Map(imported.mapping.map((entry) => [entry.designId, entry.sourceId])) });
    const idempotent = initial === serializeDesignDocument(imported.document);
    const sortedJson = (value) => JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry);
    const records = [];
    for (const [width, edited, typography] of [[640, false, false], [400, false, false], [400, true, false], [400, false, true]]) {
      root.style.width = `${width}px`;
      if (edited) { root.children[0].textContent += " Editing adds more words while preserving native Hug height and the following text blocks."; textNodes[0].textSource = root.children[0].textContent; }
      if (typography) {
        Object.assign(root.children[0].style, { fontFamily: "Courier New", fontSize: "24px", lineHeight: "36px" });
        Object.assign(textNodes[0], { fontFamily: "Courier New", fontSize: 24, lineHeight: 1.5 });
      }
      nodes[0].width = width; imported.document.canvas.width = width;
      applyAllAutoLayouts(nodes);
      const expected = [...root.children].map(rect);
      const canonical = textNodes.map((node) => ({ x: node.x, y: node.y - node.layoutBaselineOffset, width: node.width, height: node.height, offset: node.layoutBaselineOffset }));
      const svg = exportDesignSvg(imported.document);
      const reference = root.outerHTML;
      const clone = normalizeDesignDocument(JSON.parse(serializeDesignDocument(imported.document)));
      applyAllAutoLayouts(clone.nodes);
      records.push({ width, edited, typography, expected, canonical, svg, reference, stable: sortedJson(JSON.parse(serializeDesignDocument(clone))) === sortedJson(JSON.parse(serializeDesignDocument(imported.document))) });
    }
    root.remove();
    return { records, warnings: imported.warnings, noOp, movedPatch, idempotent };
  }, cases);
  assert.deepEqual(output.warnings, []);
  assert.equal(output.noOp.operations.length, 0);
  assert.equal(output.movedPatch.operations.length, 1, "parent drag retains one source geometry update");
  assert.equal(output.movedPatch.operations[0].designId, "figma-1-1");
  assert.equal(output.idempotent, true);
  for (const record of output.records) {
    assert.equal(record.stable, true, `${record.width} ${record.edited} ${record.typography} save/reopen stability`);
    for (const [index, actual] of record.canonical.entries()) {
      const expected = record.expected[index];
      for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(actual[key] - expected[key]) < 0.02, `${record.width} ${cases[index].family} ${key}: ${actual[key]} vs ${expected[key]}`);
      assert.notEqual(actual.offset, 0);
    }
    await page.setViewportSize({ width: record.width, height: 1000 });
    await page.setContent(`<style>body{margin:0;background:white}</style>${record.reference}`);
    const expected = PNG.sync.read(await page.screenshot());
    await page.setContent(`<style>body{margin:0;background:white}</style>${record.svg}`);
    const actual = PNG.sync.read(await page.screenshot());
    const changed = actual.data.reduce((count, byte, index) => count + Number(byte !== expected.data[index]), 0);
    assert.equal(changed, 0, `${record.width} ${record.edited ? "edited" : "original"} typography=${record.typography} differing channels`);
  }
});


test("native rotated text reports the unsupported baseline mapping while preserving its source geometry", async (t) => {
  const page = await browserFixture(t);
  const input = source("Rotated text", { width: 100, height: 24 });
  input.children[0].size = { x: 100, y: 24 };
  input.children[0].rotation = Math.PI / 6;
  const result = await page.evaluate(async (input) => (await import("/figma-bridge.mjs")).prepareFigmaImport(input), input);
  const node = result.document.nodes[0];
  assert.equal(node.rotation, 30);
  assert.equal(node.layoutBaselineOffset, undefined);
  assert.ok(result.warnings.some((warning) => warning.code === "text-baseline-mapping"));
});


test("native single-line ellipsis measurement retains authored content and does not restore wrapping", async (t) => {
  const page = await browserFixture(t);
  const original = "Every original native character remains editable after ellipsis.";
  const result = await page.evaluate(async (input) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    const { measureFigmaTextDocument, currentTextMetrics } = await import("/text-metrics.mjs");
    const imported = await prepareFigmaImport(input);
    const node = imported.document.nodes[0]; node.textOverflow = "ellipsis";
    await measureFigmaTextDocument(imported.document, { nativeLineBoxes: true, sourceNodes: new Map([["1:1", input.children[0]]]), sourceIds: new Map([[node.id, "1:1"]]) });
    return { node, valid: !!currentTextMetrics(node) };
  }, source(original, { width: 100, height: 28 }));
  assert.equal(result.node.textSource, original);
  assert.equal(result.node.textFlow, undefined);
  assert.equal(result.node.textOverflow, "ellipsis");
  assert.ok(result.node.text.endsWith("…"));
  assert.ok(result.node.text.length < original.length);
  assert.equal(result.node.text.split("\n").length, 1);
  assert.equal(result.valid, true);
});


test("baseline coordinate budgets diagnose unsupported origins without rejecting the remaining native document", async (t) => {
  const page = await browserFixture(t);
  const input = source("Bounded baseline", { width: 100, height: 24 });
  input.children[0].absoluteBoundingBox.y = 19999;
  const result = await page.evaluate(async (input) => (await import("/figma-bridge.mjs")).prepareFigmaImport(input), input);
  assert.equal(result.document.nodes[0].y, 19999);
  assert.ok(result.warnings.some((warning) => warning.code === "text-baseline-mapping"));
});

test("native baseline provenance survives Node-only flow and refreshes root and manual text typography", async () => {
  const { applyAllAutoLayouts } = await import("../../../apps/design-studio/app/layout.mjs");
  let probes = 0;
  const measurer = {
    configure() {},
    lineBoxOffset: (node) => { probes += 1; return node.fontSize / 10; },
    measure: (text) => ({ width: text.length * 2, ink: { x: 0, y: 0, width: text.length * 2, height: 10 }, bottom: 10 }),
    fontAvailable: () => true,
  };
  const initiallyUnmeasured = await prepareFigmaImport(source("Native text"));
  assert.equal(initiallyUnmeasured.document.nodes[0].layoutBaselineSource, "native");
  assert.equal(initiallyUnmeasured.document.nodes[0].layoutBaselineOffset, undefined);
  applyAllAutoLayouts(initiallyUnmeasured.document.nodes, { textMeasurer: measurer });
  assert.equal(initiallyUnmeasured.document.nodes[0].y, 12);
  const measuredProbes = probes;
  applyAllAutoLayouts(initiallyUnmeasured.document.nodes, { textMeasurer: measurer });
  assert.equal(probes, measuredProbes, "unchanged native typography reuses its bounded per-node state");
  for (const manual of [false, true]) {
    const input = source("Native text");
    if (manual) input.children = [{ id: "1:2", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 }, children: input.children }];
    const result = await prepareFigmaImport(input, { textMeasurer: measurer });
    const node = result.document.nodes.find((node) => node.type === "text");
    assert.equal(node.y, 12); assert.equal(node.layoutBaselineSource, "native");
    node.fontSize = 40;
    assert.equal(applyAllAutoLayouts(result.document.nodes, { textMeasurer: measurer }), true);
    assert.equal(node.y, 14); assert.equal(node.layoutBaselineOffset, 4);
    assert.equal(node.y - node.layoutBaselineOffset, 10);
  }
  const input = source("Native text");
  input.children = [{ id: "1:2", type: "FRAME", layoutMode: "VERTICAL", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 }, children: input.children }];
  const result = await prepareFigmaImport(input, { textMeasurer: measurer });
  let node = result.document.nodes.find((node) => node.type === "text");
  node.textSource += " with changed source and width";
  applyAllAutoLayouts(result.document.nodes, { textMeasurer: null });
  assert.equal(node.textMetrics, undefined, "unmeasured Node flow drops stale glyph receipts");
  assert.equal(node.layoutBaselineSource, "native");
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(result.document)));
  node = reopened.nodes.find((node) => node.type === "text");
  node.fontSize = 40;
  applyAllAutoLayouts(reopened.nodes, { textMeasurer: measurer });
  assert.equal(node.layoutBaselineSource, "native");
  assert.equal(node.layoutBaselineOffset, 4);
  assert.ok(currentTextMetrics(node));
});

test("absolute native text font edits keep exact browser glyph baselines without moving manual line boxes", async (t) => {
  const page = await browserFixture(t);
  await page.setViewportSize({ width: 400, height: 240 });
  const result = await page.evaluate(async () => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    const { applyAllAutoLayouts } = await import("/layout.mjs");
    const { exportDesignSvg } = await import("/document.mjs");
    document.body.style.cssText = "margin:0;background:white";
    const reference = document.createElement("main");
    reference.innerHTML = '<div style="position:absolute;left:20px;top:20px;width:300px;height:80px;font:20px/24px Arial">Root Hg pq</div><div style="position:absolute;left:20px;top:120px;width:300px;height:80px"><div style="font:20px/24px Arial">Manual Hg pq</div></div>';
    document.body.append(reference);
    const text = (id, copy, y) => ({ id, type: "TEXT", characters: copy, absoluteBoundingBox: { x: 20, y, width: 300, height: 80 }, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }], style: { fontFamily: "Arial", fontSize: 20, fontWeight: 400, lineHeightPx: 24, textAutoResize: "NONE" } });
    const input = { type: "CANVAS", id: "0:1", name: "Absolute native", children: [text("1:1", "Root Hg pq", 20), { type: "FRAME", id: "1:2", absoluteBoundingBox: { x: 20, y: 120, width: 300, height: 80 }, fills: [], children: [text("1:3", "Manual Hg pq", 120)] }] };
    const imported = await prepareFigmaImport(input);
    imported.document.canvas = { width: 400, height: 240, background: "#ffffff" };
    const texts = imported.document.nodes.filter((node) => node.type === "text");
    const before = texts.map((node) => node.layoutBaselineOffset);
    for (const node of texts) Object.assign(node, { fontFamily: "Courier New", fontSize: 24, lineHeight: 1.5 });
    for (const element of [reference.children[0], reference.children[1].children[0]]) element.style.font = '24px/36px "Courier New"';
    applyAllAutoLayouts(imported.document.nodes);
    return { svg: exportDesignSvg(imported.document), reference: reference.outerHTML, before, offsets: texts.map((node) => node.layoutBaselineOffset), tops: texts.map((node) => node.y - node.layoutBaselineOffset) };
  });
  assert.deepEqual(result.tops, [20, 120]);
  assert.ok(result.offsets.every((offset, index) => offset !== result.before[index]));
  await page.setContent(`<style>body{margin:0;background:white}</style>${result.reference}`);
  const expected = PNG.sync.read(await page.screenshot());
  await page.setContent(`<style>body{margin:0;background:white}</style>${result.svg}`);
  const actual = PNG.sync.read(await page.screenshot());
  assert.deepEqual(actual.data, expected.data);
});

test("native single-line ellipsis diagnoses explicit lines while retaining every authored character", async (t) => {
  const page = await browserFixture(t);
  const exact = "first\nsecond\n\nthird";
  const output = await page.evaluate(async (input) => {
    const { prepareFigmaImport } = await import("/figma-bridge.mjs");
    const { measureFigmaTextDocument, currentTextMetrics } = await import("/text-metrics.mjs");
    const { exportDesignSvg } = await import("/document.mjs");
    const imported = await prepareFigmaImport(input);
    const node = imported.document.nodes[0]; node.textOverflow = "ellipsis";
    const measurement = await measureFigmaTextDocument(imported.document, { nativeLineBoxes: true });
    return { node, measurement, valid: !!currentTextMetrics(node), svg: exportDesignSvg(imported.document) };
  }, source(exact, { width: 300, height: 28 }));
  assert.equal(output.node.textSource, exact);
  assert.equal(output.node.text, "first…");
  assert.equal(output.node.textFlow, undefined);
  assert.equal(output.measurement.unsupportedTruncations.length, 1);
  assert.equal(output.valid, true);
  assert.equal((output.svg.match(/<text /gu) ?? []).length, 1);
});

test("native baseline source is a strict text-only provenance field", async () => {
  const result = await prepareFigmaImport(source("Native"));
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const schema = JSON.parse(await readFile(new URL("../../../apps/design-studio/app/formats/codeshell-design-v3.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const canonical = JSON.parse(serializeDesignDocument(result.document));
  assert.equal(validate(canonical), true, JSON.stringify(validate.errors));
  for (const invalid of [true, "browser", 1, null]) {
    const document = structuredClone(result.document);
    document.nodes[0].layoutBaselineSource = invalid;
    assert.throws(() => normalizeDesignState(document), /文字属性无效/u);
    const candidate = structuredClone(canonical); candidate.pages[0].children[0].layoutBaselineSource = invalid;
    assert.equal(validate(candidate), false);
  }
  const document = structuredClone(result.document);
  for (const key of ["text", "fontSize", "fontWeight", "lineHeight", "textAlign", "fontFamily", "fontStyle", "letterSpacing", "textDecoration", "textSource", "textFlow", "textFlowWidth"])
    delete document.nodes[0][key];
  Object.assign(document.nodes[0], { type: "rectangle", layoutBaselineSource: "native" });
  assert.throws(() => normalizeDesignState(document), /非文字图层/u);
  const candidate = structuredClone(canonical);
  candidate.pages[0].children[0] = { ...document.nodes[0] };
  delete candidate.pages[0].children[0].pageId;
  delete candidate.pages[0].children[0].parentId;
  assert.equal(validate(candidate), false);
  delete candidate.pages[0].children[0].layoutBaselineSource;
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
});
