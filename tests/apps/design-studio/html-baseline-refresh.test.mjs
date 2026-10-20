import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { runInNewContext } from "node:vm";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import {
  createFigmaTransfer,
  importFigmaJson,
  prepareFigmaImport,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import {
  createFigmaBinding,
  createFigmaPatch,
} from "../../../apps/design-studio/app/figma-binding.mjs";

const nativeSource = {
  type: "CANVAS",
  id: "0:1",
  name: "Source",
  children: [
    {
      type: "TEXT",
      id: "1:1",
      name: "Text",
      characters: "Alpha Beta",
      absoluteBoundingBox: { x: 20, y: 20, width: 200, height: 25 },
      style: {
        fontFamily: "Arial",
        fontSize: 19,
        fontWeight: 400,
        lineHeightPx: 25,
        textAutoResize: "HEIGHT",
      },
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
    },
  ],
};

test("HTML provenance survives Node-only flow and schema/save/reopen without retagging manual/native text", async () => {
  const imported = importFigmaJson(nativeSource),
    node = imported.document.nodes[0];
  Object.assign(node, { y: 21.9, layoutBaselineOffset: 1.9, layoutBaselineSource: "html" });
  node.fontSize = 24;
  applyAllAutoLayouts(imported.document.nodes, { textMeasurer: null });
  assert.equal(node.y, 21.9);
  assert.equal(node.layoutBaselineSource, "html");
  const canonical = JSON.parse(serializeDesignDocument(imported.document));
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../../../apps/design-studio/app/formats/codeshell-design-v3.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(canonical), true, JSON.stringify(validate.errors));
  const reopened = normalizeDesignDocument(canonical),
    text = reopened.nodes[0];
  const measure = { configure() {}, lineBoxOffset: (n) => n.fontSize / 10 };
  applyAllAutoLayouts(reopened.nodes, { textMeasurer: measure });
  assert.equal(text.y, 22.4);
  assert.equal(text.layoutBaselineOffset, 2.4);
  assert.equal(text.y - text.layoutBaselineOffset, 20);
  assert.equal(text.layoutBaselineSource, "html");
  for (const invalid of ["HTML", "browser", null, true]) {
    const value = structuredClone(canonical);
    value.pages[0].children[0].layoutBaselineSource = invalid;
    assert.equal(validate(value), false);
    assert.throws(() => normalizeDesignDocument(value), /文字属性无效/u);
  }
  const manual = { ...text, id: "manual", y: 37, layoutBaselineOffset: 7 };
  delete manual.layoutBaselineSource;
  const native = { ...text, id: "native", y: 22.4, layoutBaselineSource: "native" };
  const rotated = { ...text, id: "rotated", y: 42, rotation: 20 };
  applyAllAutoLayouts([manual, native, rotated], { textMeasurer: measure });
  assert.equal(manual.y, 37);
  assert.equal(manual.layoutBaselineSource, undefined);
  assert.equal(native.layoutBaselineSource, "native");
  assert.equal(rotated.y, 42);
});

test("native transfer drops HTML provenance and source binding projects baseline-only changes to no-op", async () => {
  const imported = await prepareFigmaImport(nativeSource),
    text = imported.document.nodes[0];
  Object.assign(text, { y: 25.41, layoutBaselineOffset: 5.41, layoutBaselineSource: "html" });
  const binding = createFigmaBinding(imported);
  const transfer = createFigmaTransfer(imported.document);
  assert.equal(transfer.pages[0].children[0].layoutBaselineSource, undefined);
  assert.equal(transfer.pages[0].children[0].layoutBaselineOffset, 5.41);
  text.y = 26.2;
  text.layoutBaselineOffset = 6.2;
  assert.equal(createFigmaPatch(binding, imported.document).operations.length, 0);
  text.fontSize = 24;
  const patch = createFigmaPatch(binding, imported.document);
  assert(patch.operations[0].changed.includes("fontSize"));
  assert(!patch.operations[0].changed.includes("y"));
  assert(!patch.operations[0].changed.includes("layoutBaselineSource"));
});

test("public manual offset edits retire only HTML baseline refresh", async () => {
  const source = await readFile(
    new URL("../../../apps/design-studio/app/app.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("function applyAgentNodePatch("),
    end = source.indexOf("\nfunction applyAgentDocumentTokens(", start);
  assert(start > 0 && end > start);
  const apply = runInNewContext(`(${source.slice(start, end)})`, {
    AGENT_NODE_PATCH_FIELDS: new Set(["layoutBaselineOffset", "fontSize"]),
    GRID_CONTAINER_FIELDS: [],
    GRID_CHILD_FIELDS: [],
  });
  for (const provenance of ["html", "native", undefined]) {
    const node = { type: "text", layoutBaselineSource: provenance, layoutBaselineOffset: 5.41 };
    apply(node, { layoutBaselineOffset: 7 });
    assert.equal(node.layoutBaselineOffset, 7);
    assert.equal(node.layoutBaselineSource, provenance === "html" ? undefined : provenance);
  }
  const text = { type: "text", layoutBaselineSource: "html", layoutBaselineOffset: 5.41 };
  apply(text, { fontSize: 24 });
  assert.equal(text.layoutBaselineSource, "html");
  apply(text, { layoutBaselineOffset: null });
  assert.equal(text.layoutBaselineSource, undefined);
  assert.equal(text.layoutBaselineOffset, undefined);
});

const html = ({
  fontSize = 19,
  family = "Arial",
  lineHeight = "1.3157894737",
  extra = "",
  content = "Alpha Beta",
} = {}) =>
  `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0}#fixture{display:flex;flex-direction:column;width:100%;height:400px;padding:20px;background:white;font:${fontSize}px ${family};line-height:${lineHeight}}.copy{margin:0;${extra}}</style><main id="fixture"><p class="copy">${content}</p></main>`;

async function fixture(t) {
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 640, height: 400 },
    deviceScaleFactor: 1,
  });
  const root = resolve("apps/design-studio/app"),
    blocked = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url()),
      file = resolve(root, "." + url.pathname);
    if (url.href === "https://html-baseline.test/")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><body style='margin:0'>",
      });
    if (
      url.origin === "https://html-baseline.test" &&
      file.startsWith(root + sep) &&
      file.endsWith(".mjs")
    )
      return route.fulfill({ contentType: "text/javascript", body: await readFile(file) });
    blocked.push(url.href);
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto("https://html-baseline.test/");
  t.after(() => assert.deepEqual(blocked, []));
  return { page, context };
}

test("verified HTML typography edits refresh SVG baselines exactly through font/lineheight/width/save/reopen", async (t) => {
  const { page, context } = await fixture(t);
  const snapshots = await page.evaluate(async (source) => {
    const { captureWorkspaceHtmlResult } = await import("/html-import.mjs"),
      { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } =
        await import("/document.mjs"),
      { applyAllAutoLayouts } = await import("/layout.mjs"),
      { createBrowserTextMeasurer } = await import("/text-metrics.mjs"),
      { exportDesignFrontend } = await import("/frontend-export.mjs");
    const captured = await captureWorkspaceHtmlResult({
      sourcePath: "source.html",
      html: source,
      readText: async () => "",
      rootSelector: "#fixture",
      viewportWidth: 640,
      viewportHeight: 400,
    });
    let value = normalizeDesignDocument(captured.document);
    const initialGeometry = value.nodes.map((n) => [n.id, n.x, n.y, n.width, n.height]);
    const measurement = createBrowserTextMeasurer();
    const records = [];
    try {
      for (const [fontSize, family, lineHeight, width] of [
        [19, "Arial", 1.3157894897460938, 640],
        [24, "Arial", 1.3157894897460938, 640],
        [19, "Arial", 1.3157894897460938, 640],
        [24, "Courier New", 1.5, 400],
        [19, "Arial", 1.3157894897460938, 640],
      ]) {
        const text = value.nodes.find((n) => n.type === "text");
        Object.assign(text, { fontSize, fontFamily: family, lineHeight });
        value.canvas.width = width;
        for (const node of value.nodes)
          if (node.id === "html-viewport" || node.parentId === "html-viewport") node.width = width;
        applyAllAutoLayouts(value.nodes, { textMeasurer: measurement });
        const saved = serializeDesignDocument(value);
        records.push({
          fontSize,
          family,
          lineHeight,
          width,
          text: structuredClone(text),
          svg: exportDesignSvg(value),
          frontend: exportDesignFrontend(JSON.parse(saved)),
          geometry: value.nodes.map((n) => [n.id, n.x, n.y, n.width, n.height]),
        });
        value = normalizeDesignDocument(JSON.parse(saved));
      }
    } finally {
      measurement.close();
    }
    return { initialGeometry, records, warnings: captured.report.warnings };
  }, html());
  assert.deepEqual(
    snapshots.records[0].geometry,
    snapshots.initialGeometry,
    "initial layout geometry must stay exact",
  );
  for (const record of snapshots.records) {
    assert.equal(record.text.layoutBaselineSource, "html");
    assert.equal(record.text.y - record.text.layoutBaselineOffset, 20);
    const refPage = await context.newPage();
    await refPage.setViewportSize({ width: record.width, height: 400 });
    await refPage.setContent(html({ ...record, family: JSON.stringify(record.family) }));
    const expected = PNG.sync.read(await refPage.screenshot());
    await refPage.close();
    for (const [kind, contents] of [
      ["svg", record.svg],
      ["frontend", record.frontend],
    ]) {
      const actualPage = await context.newPage();
      await actualPage.setViewportSize({ width: record.width, height: 400 });
      await actualPage.setContent(
        kind === "svg" ? `<style>body{margin:0}</style>${contents}` : contents,
      );
      const actual = PNG.sync.read(await actualPage.screenshot());
      await actualPage.close();
      assert.equal(
        actual.data.compare(expected.data),
        0,
        `${kind} ${record.fontSize}/${record.family}/${record.lineHeight}@${record.width}`,
      );
    }
  }
});

test("mixed/pseudo/bordered/vertical capture paths do not gain HTML provenance", async (t) => {
  const { page } = await fixture(t);
  const records = await page.evaluate(
    async (sources) => {
      const { captureWorkspaceHtmlResult } = await import("/html-import.mjs"),
        { normalizeDesignDocument } = await import("/document.mjs");
      const out = [];
      for (const html of sources) {
        const result = await captureWorkspaceHtmlResult({
          sourcePath: "source.html",
          html,
          readText: async () => "",
          rootSelector: "#fixture",
          viewportWidth: 640,
          viewportHeight: 400,
        });
        out.push(normalizeDesignDocument(result.document).nodes.filter((n) => n.type === "text"));
      }
      return out;
    },
    [
      html({ content: "Alpha <b>Beta</b>" }),
      html() + "<style>.copy::first-line{line-height:48px}</style>",
      html({ extra: "border:1px solid black" }),
      html({ extra: "writing-mode:vertical-rl" }),
    ],
  );
  for (const [index, texts] of records.entries())
    assert(
      texts.every((n) => n.layoutBaselineSource === undefined),
      JSON.stringify({ index, texts }),
    );
});

test("pre and nowrap certify only their real captured single-Text line-box origin", async (t) => {
  const { page } = await fixture(t);
  const records = await page.evaluate(
    async (sources) => {
      const { captureWorkspaceHtmlResult } = await import("/html-import.mjs"),
        { normalizeDesignDocument } = await import("/document.mjs"),
        { applyAllAutoLayouts } = await import("/layout.mjs"),
        { createBrowserTextMeasurer } = await import("/text-metrics.mjs");
      const out = [];
      for (const html of sources) {
        const captured = await captureWorkspaceHtmlResult({
          sourcePath: "source.html",
          html,
          readText: async () => "",
          rootSelector: "#fixture",
          viewportWidth: 640,
          viewportHeight: 400,
        });
        const value = normalizeDesignDocument(captured.document),
          text = value.nodes.find((n) => n.type === "text");
        const initial = {
          y: text.y,
          offset: text.layoutBaselineOffset,
          source: text.layoutBaselineSource,
        };
        const measurement = createBrowserTextMeasurer();
        try {
          text.fontSize = 24;
          applyAllAutoLayouts(value.nodes, { textMeasurer: measurement });
          measurement.configure(text);
          out.push({
            initial,
            text: structuredClone(text),
            expectedY:
              Math.round((initial.y - initial.offset + measurement.lineBoxOffset(text)) * 100) /
              100,
          });
        } finally {
          measurement.close();
        }
      }
      return out;
    },
    [
      html({ extra: "white-space:pre", content: "Alpha\nBeta" }),
      html({ extra: "white-space:nowrap;overflow:hidden;text-overflow:ellipsis" }),
    ],
  );
  for (const record of records) {
    assert.equal(record.initial.source, "html");
    assert.equal(record.text.layoutBaselineSource, "html");
    assert.equal(record.text.y, record.expectedY);
    assert.equal(
      record.text.y - record.text.layoutBaselineOffset,
      record.initial.y - record.initial.offset,
    );
    assert.notEqual(record.text.layoutBaselineOffset, record.initial.offset);
  }
});
