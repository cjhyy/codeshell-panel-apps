import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import {
  validTextLineHeight,
  textLineHeightPixels,
  textLineHeightCss,
  nativeTextLineHeight,
} from "../../../apps/design-studio/app/text-line-height.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import {
  importFigmaJson,
  prepareFigmaImport,
  createFigmaTransfer,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import {
  createFigmaBinding,
  createFigmaPatch,
} from "../../../apps/design-studio/app/figma-binding.mjs";
import { applyAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { nativeGridPlan } from "../../../apps/design-studio/app/grid.mjs";
import { textMetricsSignature } from "../../../apps/design-studio/app/text-metrics.mjs";
import {
  captureDesignOperationState,
  createDesignOperationRecord,
  applyDesignOperationRecord,
} from "../../../apps/design-studio/app/operation-log.mjs";
import { createPortableDesign } from "../../../apps/design-studio/app/portable-backup.mjs";
import { preparePluginFile } from "../../../apps/design-studio/app/figma-plugin/v3-input.mjs";
import { plainFixture } from "./fixtures/figma-plugin-v3.mjs";

const actual = JSON.parse(
  await readFile(
    new URL(
      "../../fixtures/design-studio-grid-text-intrinsic-height/native-source.json",
      import.meta.url,
    ),
  ),
);
const copy = (value) => structuredClone(value);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const leaf = (raw) => raw.pages[0].children[0].children[0];
const measure = {
  configure() {},
  measure: (value) => ({
    width: value.length * 8,
    bottom: 16,
    ink: { x: 0, y: 0, width: value.length * 8, height: 16 },
  }),
  fontAvailable: () => true,
};

test("pixel bounds derive from legacy font/ratio envelope and absence keeps exact ratio signatures", async () => {
  const ratio = {
    text: "Alpha\nBeta",
    fontFamily: "Inter",
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.25,
  };
  assert.equal(
    textMetricsSignature(ratio),
    JSON.stringify(["Alpha\nBeta", "Inter", "", 16, 400, "normal", 0, 1.25]),
  );
  const pixels = { ...ratio, lineHeight: 20, lineHeightUnit: "pixels" };
  for (const fontSize of [16, 24, 16]) {
    assert.equal(textLineHeightPixels({ ...pixels, fontSize }), 20);
    assert.equal(textLineHeightPixels({ ...ratio, fontSize }), fontSize * 1.25);
  }
  assert.equal(textLineHeightCss(pixels), "20px");
  assert.equal(textLineHeightCss(ratio), "1.25");
  assert.deepEqual(nativeTextLineHeight(pixels), { unit: "PIXELS", value: 20 });
  assert.deepEqual(nativeTextLineHeight(ratio), { unit: "PERCENT", value: 125 });
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const validate = new Ajv2020({ strict: false }).compile(
    JSON.parse(
      await readFile(
        new URL(
          "../../../apps/design-studio/app/formats/codeshell-design-v3.schema.json",
          import.meta.url,
        ),
      ),
    ),
  );
  for (const lineHeight of [0.7, 4.2, 20, 720]) {
    const raw = plainFixture();
    Object.assign(leaf(raw), { lineHeight, lineHeightUnit: "pixels" });
    assert.equal(validate(raw), true, JSON.stringify(validate.errors));
    assert.doesNotThrow(() => normalizeDesignDocument(raw));
  }
  for (const change of [
    { lineHeight: 0.6999, lineHeightUnit: "pixels" },
    { lineHeight: 720.001, lineHeightUnit: "pixels" },
    { lineHeight: 20 },
    { lineHeight: 1.2, lineHeightUnit: "ratio" },
    { lineHeight: 20, lineHeightUnit: null },
  ]) {
    const raw = plainFixture();
    Object.assign(leaf(raw), change);
    assert.equal(validate(raw), false);
    assert.throws(() => normalizeDesignDocument(raw));
  }
  const nonText = plainFixture();
  nonText.pages[0].children[0].lineHeightUnit = "pixels";
  assert.equal(validate(nonText), false);
  assert.throws(() => normalizeDesignDocument(nonText));
  for (const value of [NaN, Infinity, "20"])
    assert.equal(validTextLineHeight({ lineHeightUnit: "pixels", lineHeight: value }), false);
});

test("actual native pixel units survive save, portable input and unchanged source binding", async () => {
  const prepared = await prepareFigmaImport(actual),
    doc = prepared.document;
  assert.deepEqual(prepared.warnings, []);
  const texts = doc.nodes.filter((n) => n.type === "text");
  assert.equal(texts.length, 24);
  for (const text of texts) {
    assert.equal(text.lineHeightUnit, "pixels");
    assert([20, 30].includes(text.lineHeight));
  }
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(doc)));
  assert.deepEqual(createFigmaPatch(createFigmaBinding(prepared), reopened).operations, []);
  const portable = await createPortableDesign({
    document: reopened,
    source: {
      workspaceRoot: "/line-height",
      sessionId: "fixture",
      path: "designs/source.codesign.json",
    },
    readText: async () => {
      throw Error("No resources expected");
    },
    sha256Bytes: async (bytes) => hash(bytes),
  });
  const transfer = await preparePluginFile(portable);
  const flatten = (n) => [n, ...(n.children ?? []).flatMap(flatten)];
  const returned = transfer.transfer.pages
    .flatMap((p) => p.children.flatMap(flatten))
    .filter((n) => n.type === "text");
  assert.equal(returned.length, 24);
  assert(returned.every((n) => n.lineHeightUnit === "pixels" && [20, 30].includes(n.lineHeight)));
});

test("raw pixel units do not depend on rounded ratios and the public partial patch schema accepts coherent edits", async () => {
  for (const [fontSize, lineHeightPx] of [
    [19, 20],
    [19, 20.125],
    [40, 20],
  ]) {
    const raw = copy(actual),
      row = raw.document.children[0].children.find((n) => n.name === "equal-HUG-cellFILL");
    // Standalone text proves physical units independently of the bounded Grid ratio exception.
    const original = row.children[0].children[0];
    Object.assign(original.style, { fontSize, lineHeightPx, lineHeightUnit: "PIXELS" });
    raw.document.children = [original];
    const prepared = await prepareFigmaImport(raw),
      text = prepared.document.nodes[0];
    assert.equal(text.lineHeightUnit, "pixels");
    assert.equal(text.lineHeight, lineHeightPx);
    assert(!prepared.warnings.some((w) => w.code === "line-height-unit-fixed"));
    assert.deepEqual(
      createFigmaPatch(
        createFigmaBinding(prepared),
        normalizeDesignDocument(JSON.parse(serializeDesignDocument(prepared.document))),
      ).operations,
      [],
    );
  }
  const manifest = JSON.parse(
    await readFile(
      new URL("../../../apps/design-studio/.codeshell-panel/panel.json", import.meta.url),
    ),
  );
  const schema = manifest.agent.tools.find((t) => t.name === "use_design").inputSchema;
  const { validateToolArgsStrict } = await import("@cjhyy/code-shell-core");
  const request = (changes) => ({
    expected_state_revision: "lineheight",
    operations: [{ op: "update_node", node_id: "copy", changes }],
  });
  for (const changes of [
    { lineHeight: 20, lineHeightUnit: "pixels" },
    { lineHeight: 4.2, lineHeightUnit: "pixels" },
    { lineHeight: 1.25, lineHeightUnit: "pixels" },
    { lineHeight: 720, lineHeightUnit: "pixels" },
    { lineHeight: 1.25, lineHeightUnit: null },
    { lineHeight: 20 },
  ])
    assert.equal(validateToolArgsStrict("use_design", request(changes), schema), null);
  for (const changes of [
    { lineHeight: 0.6999, lineHeightUnit: "pixels" },
    { lineHeight: 721, lineHeightUnit: "pixels" },
    { lineHeight: 20, lineHeightUnit: null },
    { lineHeightUnit: "ratio" },
  ])
    assert.notEqual(validateToolArgsStrict("use_design", request(changes), schema), null);
});

test("font-size edits preserve pixel row height and retain ratio growth, undo and reopen semantics", () => {
  for (const pixels of [true, false]) {
    const doc = importFigmaJson(actual).document,
      row = doc.nodes.find((n) => n.name === "equal-HUG-cellFILL"),
      cells = doc.nodes.filter((n) => n.parentId === row.id),
      text = doc.nodes.find((n) => n.parentId === cells[0].id);
    if (!pixels) {
      delete text.lineHeightUnit;
      text.lineHeight = 1.25;
    }
    // Establish a measurement receipt before edits, as browser import does.
    delete text.textFlowWidth;
    applyAutoLayouts(doc.nodes, [text.id], { textMeasurer: measure });
    const before = captureDesignOperationState(doc);
    for (const size of [16, 24, 16]) {
      text.fontSize = size;
      applyAutoLayouts(doc.nodes, [text.id], { textMeasurer: measure });
      assert.equal(text.height, pixels ? 40 : size * 2.5);
      assert.equal(row.height, text.height);
      assert.deepEqual(
        cells.map((n) => n.height),
        Array(3).fill(text.height),
      );
      const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(doc)));
      assert.equal(
        reopened.nodes.find((n) => n.id === text.id).lineHeightUnit,
        pixels ? "pixels" : undefined,
      );
    }
    text.fontSize = 24;
    const record = createDesignOperationRecord(before, captureDesignOperationState(doc));
    applyDesignOperationRecord(doc, record, "reverse");
    assert.equal(doc.nodes.find((n) => n.id === text.id).fontSize, 16);
    applyDesignOperationRecord(doc, record, "forward");
    assert.equal(doc.nodes.find((n) => n.id === text.id).fontSize, 24);
    assert.equal(
      doc.nodes.find((n) => n.id === text.id).lineHeightUnit,
      pixels ? "pixels" : undefined,
    );
  }
  const raw = JSON.parse(serializeDesignDocument(importFigmaJson(actual).document));
  const row = raw.pages[0].children[0].children.find((n) => n.name === "equal-HUG-cellFILL");
  row.children[0].children[0].fontSize = 32;
  assert.throws(
    () => nativeGridPlan(row),
    /内在尺寸循环/u,
    "Existing effective-ratio Grid guard is retained",
  );
});

test("unsupported native units/values stay diagnosed and cannot certify intrinsic Grid text", () => {
  for (const change of [
    { lineHeightUnit: "AUTO" },
    { lineHeightUnit: "PIXELS", lineHeightPx: -20 },
    { lineHeightUnit: "PIXELS", lineHeightPx: 721 },
  ]) {
    const raw = copy(actual),
      row = raw.document.children[0].children.find((n) => n.name === "equal-HUG-cellFILL");
    Object.assign(row.children[0].children[0].style, change);
    const imported = importFigmaJson(raw);
    assert(imported.warnings.some((w) => w.code === "line-height-unit-fixed"));
    assert.equal(imported.document.nodes.find((n) => n.name === row.name).layout, "none");
  }
});

test("CPU real-font SVG/frontend preserve px versus ratio semantics across font-size edits", async (t) => {
  const { chromium } = await import("playwright"),
    { PNG } = await import("pngjs");
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 760, height: 240 },
    deviceScaleFactor: 1,
  });
  const root = resolve("apps/design-studio/app"),
    font = await readFile(resolve(root, "fonts/InterVariable.woff2")),
    blocked = [];
  const fontCss = `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font.toString("base64")}) format('woff2');font-weight:100 900;font-display:block}`;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url()),
      file = resolve(root, `.${url.pathname}`);
    if (url.href === "https://line-height.test/")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><style>${fontCss}body{margin:0}</style>`,
      });
    if (
      url.origin === "https://line-height.test" &&
      file.startsWith(root + sep) &&
      file.endsWith(".mjs")
    )
      return route.fulfill({ contentType: "text/javascript", body: await readFile(file) });
    blocked.push(url.href);
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto("https://line-height.test/");
  const records = await page.evaluate(
    async ({ actual, fontCss }) => {
      const { importFigmaJson } = await import("/figma-bridge.mjs"),
        { exportDesignSvg, serializeDesignDocument, normalizeDesignDocument } =
          await import("/document.mjs"),
        { measureFigmaTextDocument, createBrowserTextMeasurer } = await import("/text-metrics.mjs"),
        { applyAutoLayouts } = await import("/layout.mjs"),
        { exportDesignFrontend } = await import("/frontend-export.mjs");
      if (!(await document.fonts.load("400 16px Inter")).length)
        throw Error("Exact fixture font not loaded");
      const stable = (value) =>
        JSON.stringify(value, (_key, v) =>
          v && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(
                Object.keys(v)
                  .sort()
                  .map((key) => [key, v[key]]),
              )
            : v,
        );
      const records = [];
      for (const pixels of [true, false]) {
        const raw = structuredClone(actual),
          sourceRow = raw.document.children[0].children.find(
            (n) => n.name === "equal-HUG-cellFILL",
          );
        raw.document.children = [sourceRow];
        const imported = importFigmaJson(raw),
          value = imported.document,
          row = value.nodes[0],
          cells = value.nodes.filter((n) => n.parentId === row.id),
          text = value.nodes.find((n) => n.parentId === cells[0].id);
        const offset = row.y - 20;
        value.nodes.forEach((n) => (n.y -= offset));
        value.canvas = { width: 760, height: 240, background: "#ffffff" };
        const sources = new Map();
        const visit = (n) => {
          sources.set(n.id, n);
          n.children?.forEach(visit);
        };
        visit(sourceRow);
        await measureFigmaTextDocument(value, {
          nativeLineBoxes: true,
          sourceNodes: sources,
          sourceIds: new Map(imported.mapping.map((n) => [n.designId, n.sourceId])),
        });
        if (!pixels) {
          delete text.lineHeightUnit;
          text.lineHeight = 1.25;
        }
        const measurement = createBrowserTextMeasurer();
        try {
          for (const size of [16, 24, 16]) {
            text.fontSize = size;
            applyAutoLayouts(value.nodes, [text.id], { textMeasurer: measurement });
            const saved = serializeDesignDocument(value),
              reopened = normalizeDesignDocument(JSON.parse(saved));
            records.push({
              pixels,
              size,
              height: row.height,
              textHeight: text.height,
              unit: text.lineHeightUnit,
              source: text.textSource,
              stable:
                stable(JSON.parse(serializeDesignDocument(reopened))) === stable(JSON.parse(saved)),
              svg: exportDesignSvg(value),
              html: exportDesignFrontend(JSON.parse(saved)),
              reference: `<!doctype html><style>${fontCss}*{box-sizing:border-box}body{margin:0;background:white}.row{position:absolute;left:20px;top:20px;width:630px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));background:#e2e8f0}.cell{display:flex;flex-direction:column;min-width:0;min-height:0}.copy{width:100%;font:400 16px/20px Inter;white-space:pre-wrap;color:#334155}.a{background:#fecaca}.b{background:#bbf7d0}.c{background:#bfdbfe}.a .copy{font-size:${size}px;line-height:${pixels ? "20px" : "1.25"}}.c .copy{line-height:30px}</style><div class="row"><div class="cell a"><div class="copy">Alpha\nBeta</div></div><div class="cell b"><div class="copy">Peer</div></div><div class="cell c"><div class="copy">Peer</div></div></div>`,
            });
          }
        } finally {
          measurement.close();
        }
      }
      return records;
    },
    { actual, fontCss },
  );
  for (const record of records) {
    assert.equal(record.height, record.pixels ? 40 : record.size * 2.5);
    assert.equal(record.textHeight, record.height);
    assert.equal(record.stable, true);
    assert.equal(record.source, "Alpha\nBeta");
    await page.setContent(record.reference);
    await page.evaluate(() => document.fonts.ready);
    const reference = PNG.sync.read(await page.screenshot());
    for (const html of [
      `<!doctype html><style>${fontCss}body{margin:0}svg{display:block}</style>${record.svg}`,
      record.html.replace("<head>", `<head><style>${fontCss}</style>`),
    ]) {
      await page.setContent(html);
      await page.evaluate(() => document.fonts.ready);
      const pixels = PNG.sync.read(await page.screenshot());
      assert(
        pixels.data.equals(reference.data),
        `${record.pixels ? "pixels" : "ratio"}/${record.size} strict SVG/frontend pixels`,
      );
    }
  }
  assert.deepEqual(blocked, []);
});
