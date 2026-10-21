import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { cssGridTracks } from "../../../apps/design-studio/app/html-grid.mjs";
import { designNodeToV3 } from "../../../apps/design-studio/app/design-node-adapter.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";

const runtime = await readFile(
  new URL("../../../apps/design-studio/app/vendor/html2figma-browser.mjs", import.meta.url),
  "utf8",
);
const equal = `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white}#fixture{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:80px 80px;gap:12px;padding:20px;width:100%;height:240px;background:#e2e8f0}.tile{height:80px;background:#2563eb}.tile:nth-child(2n){background:#f97316}</style><main id="fixture">${'<div class="tile"></div>'.repeat(6)}</main>`;
const geometry = (node) => [node.x, node.y, node.width, node.height];
const code = (result) => result.report.warnings.map((warning) => warning.code);

async function browserFixture(t, source = equal) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 640, height: 240 } });
  const page = await context.newPage();
  await page.setContent(source);
  const capture = () =>
    page.evaluate(async (runtime) => {
      const { convertToDesignDSL } = await import(
        URL.createObjectURL(new Blob([runtime], { type: "text/javascript" }))
      );
      const root = document.querySelector("#fixture");
      return {
        tree: convertToDesignDSL(root),
        boxes: [...root.children].map((child) => {
          const { x, y, width, height } = child.getBoundingClientRect();
          return [x, y, width, height];
        }),
      };
    }, runtime);
  return { page, capture };
}

test("CSS Grid track parsing preserves bounded fixed/FLEX/HUG intent and diagnoses unsupported grammar", () => {
  assert.deepEqual(cssGridTracks("80px repeat(2, minmax(0px, 2fr) max-content)"), [
    { type: "fixed", value: 80 },
    { type: "flex", value: 2 },
    { type: "hug" },
    { type: "flex", value: 2 },
    { type: "hug" },
  ]);
  for (const value of [
    "repeat(9999999,1fr)",
    "repeat(auto-fit,1fr)",
    "minmax(20px,1fr)",
    "[name] 20px",
    "25%",
    "subgrid",
    "0fr",
    "repeat(24,repeat(24,1fr))",
  ])
    assert.throws(() => cssGridTracks(value), /Grid/u, value);
});

test("real CSS Grid capture retains original direct items, Fill sizing and native tracks through 640→400 reflow", async (t) => {
  const f = await browserFixture(t);
  const captured = await f.capture();
  assert.equal(captured.tree.layout.display, "grid");
  assert.equal(captured.tree.children.length, 6);
  assert.ok(captured.tree.children.every((child) => child.name === "div.tile"));
  assert.equal(captured.tree.cssLayout["grid-template-columns"], "repeat(3, minmax(0px, 1fr))");
  assert.equal(captured.tree.children[0].cssLayout.width, "auto");
  const result = await designNodeToV3(captured.tree);
  assert.deepEqual(result.report.warnings, []);
  const state = normalizeDesignDocument(result.document),
    root = state.nodes[0];
  assert.equal(root.layout, "grid");
  assert.equal(root.gridItemsPositioning, "row-auto-flow");
  assert.deepEqual(
    root.gridColumnSizes,
    Array.from({ length: 3 }, () => ({ type: "flex", value: 1 })),
  );
  assert.deepEqual(
    root.gridRowSizes,
    Array.from({ length: 2 }, () => ({ type: "fixed", value: 80 })),
  );
  assert.ok(
    state.nodes
      .slice(1)
      .every(
        (node) => node.layoutSizingHorizontal === "fill" && node.layoutSizingVertical === "fixed",
      ),
  );
  for (const width of [640, 400]) {
    await f.page.setViewportSize({ width, height: 240 });
    const expected = await f.capture();
    const sourcePixels = PNG.sync.read(await f.page.screenshot());
    root.width = width;
    applyAllAutoLayouts(state.nodes);
    assert.deepEqual(state.nodes.slice(1).map(geometry), expected.boxes);
    const doc = JSON.parse(serializeDesignDocument(state));
    doc.canvas.width = width;
    const transferred = createFigmaTransfer(doc).pages[0].children[0];
    assert.equal(transferred.layout, "grid");
    assert.deepEqual(transferred.gridColumnSizes, root.gridColumnSizes);
    assert.ok(transferred.children.every((node) => node.layoutSizingHorizontal === "fill"));
    const output = await f.page.context().newPage();
    await output.setViewportSize({ width, height: 240 });
    await output.setContent(exportDesignFrontend(doc));
    const outputPixels = PNG.sync.read(await output.screenshot());
    assert.deepEqual(outputPixels.data, sourcePixels.data, `${width}px source/export pixels`);
    await output.close();
  }
});

test("unequal fixed/FLEX/HUG tracks, row-auto spans and item alignments match Chromium after resize", async (t) => {
  const source = `<!doctype html><style>*{box-sizing:border-box}body{margin:0}#fixture{display:grid;width:100%;height:160px;padding:10px;gap:10px;grid-template-columns:80px minmax(0,1fr) max-content;grid-template-rows:60px 60px;justify-content:start;align-content:start}.tile{height:40px;background:blue}.wide{grid-column:span 2}.hug{width:50px;justify-self:end}.center{width:30px;justify-self:center;align-self:center}</style><main id="fixture"><div class="tile wide"></div><div class="tile hug"></div><div class="tile center"></div><div class="tile"></div><div class="tile hug"></div></main>`;
  const f = await browserFixture(t, source),
    captured = await f.capture();
  const result = await designNodeToV3(captured.tree),
    state = normalizeDesignDocument(result.document),
    root = state.nodes[0];
  assert.deepEqual(result.report.warnings, []);
  assert.deepEqual(root.gridColumnSizes, [
    { type: "fixed", value: 80 },
    { type: "flex", value: 1 },
    { type: "hug" },
  ]);
  assert.equal(state.nodes[1].gridColumnSpan, 2);
  assert.equal(state.nodes[3].gridChildHorizontalAlign, "center");
  assert.equal(state.nodes[3].gridChildVerticalAlign, "center");
  for (const width of [640, 400]) {
    await f.page.setViewportSize({ width, height: 240 });
    root.width = width;
    applyAllAutoLayouts(state.nodes);
    assert.deepEqual(state.nodes.slice(1).map(geometry), (await f.capture()).boxes);
  }
});

test("manual numeric lines and nested Grid retain real hierarchy and parent-relative geometry", async (t) => {
  const source = `<!doctype html><style>*{box-sizing:border-box}body{margin:0}#fixture{position:relative;display:grid;width:100%;height:200px;padding:10px;gap:10px;grid-template-columns:80px minmax(0,1fr);grid-template-rows:60px 60px}#a{grid-area:2/2/3/3;width:40px;height:20px;background:red;justify-self:end;align-self:center}#b{grid-area:1/1/2/3;display:grid;grid-template-columns:30px minmax(0,1fr);grid-template-rows:30px;gap:5px;padding:5px;background:blue}#b>div{background:yellow}#abs{position:absolute;left:3px;top:5px;width:7px;height:9px}</style><main id="fixture"><div id="a"></div><div id="b"><div></div><div></div></div><div id="abs"></div></main>`;
  const f = await browserFixture(t, source),
    captured = await f.capture();
  const result = await designNodeToV3(captured.tree),
    state = normalizeDesignDocument(result.document),
    root = state.nodes[0];
  assert.deepEqual(result.report.warnings, []);
  assert.equal(root.gridItemsPositioning, "manual");
  const a = state.nodes.find((node) => node.name === "div#a"),
    b = state.nodes.find((node) => node.name === "div#b"),
    abs = state.nodes.find((node) => node.name === "div#abs");
  assert.equal(b.layout, "grid");
  assert.deepEqual([a.gridRowAnchorIndex, a.gridColumnAnchorIndex, b.gridColumnSpan], [1, 1, 2]);
  assert.equal(abs.layoutPositioning, "absolute");
  for (const width of [640, 400]) {
    await f.page.setViewportSize({ width, height: 240 });
    root.width = width;
    applyAllAutoLayouts(state.nodes);
    const measured = await f.page.locator("#fixture, #fixture *").evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return [x, y, width, height];
      }),
    );
    assert.deepEqual(state.nodes.map(geometry), measured);
  }
});

test("unsupported Grid keeps the original measured items and explains lost track semantics", async (t) => {
  const f = await browserFixture(t);
  for (const properties of [
    { gridTemplateColumns: "repeat(3,minmax(90px,1fr))" },
    { gridAutoFlow: "row dense" },
    { gridTemplateColumns: "repeat(3,1fr)", childWidth: "200px" },
    { gridTemplateColumns: "repeat(3,auto)" },
    { childWidth: "50%" },
    { childColumn: "2" },
    { gridTemplateColumns: "repeat(auto-fit,minmax(40px,1fr))" },
    { gap: "5%" },
    { rowGap: "10%" },
    { childWidth: "100%", childPadding: "10px", childBoxSizing: "content-box" },
    { childTransform: "translateX(5px)" },
    { childWidth: "auto", childJustifySelf: "start", childMinWidth: "20px" },
  ]) {
    await f.page.setContent(equal);
    await f.page.evaluate((properties) => {
      const root = document.querySelector("#fixture");
      for (const [key, value] of Object.entries(properties)) {
        if (key === "childWidth") root.firstElementChild.style.width = value;
        else if (key === "childColumn") root.firstElementChild.style.gridColumnStart = value;
        else if (key === "childPadding") root.firstElementChild.style.padding = value;
        else if (key === "childBoxSizing") root.firstElementChild.style.boxSizing = value;
        else if (key === "childTransform") root.firstElementChild.style.transform = value;
        else if (key === "childJustifySelf") root.firstElementChild.style.justifySelf = value;
        else if (key === "childMinWidth") root.firstElementChild.style.minWidth = value;
        else root.style[key] = value;
      }
    }, properties);
    const captured = await f.capture(),
      result = await designNodeToV3(captured.tree);
    const nodes = normalizeDesignDocument(result.document).nodes;
    assert.equal(nodes[0].layout, "none", JSON.stringify(properties));
    assert.ok(code(result).includes("grid-fixed-geometry"), JSON.stringify(properties));
    assert.deepEqual(nodes.slice(1).map(geometry), captured.boxes);
    assert.equal(captured.tree.children.length, 6);
    assert.ok(nodes.slice(1).every((node) => node.gridRowAnchorIndex === undefined));
  }
});

test("implicit intrinsic rows remain native automatic rows and fixed implicit row counts are diagnosed", async (t) => {
  const source = `<!doctype html><style>body{margin:0}#fixture{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:400px}#fixture>div{height:60px}</style><main id="fixture"><div></div><div></div><div></div></main>`;
  const f = await browserFixture(t, source),
    captured = await f.capture();
  const result = await designNodeToV3(captured.tree),
    state = normalizeDesignDocument(result.document);
  assert.deepEqual(result.report.warnings, []);
  assert.equal(state.nodes[0].gridAutoTracks, "rows");
  assert.equal(state.nodes[0].layoutSizingVertical, "hug");
  applyAllAutoLayouts(state.nodes);
  assert.deepEqual(state.nodes.slice(1).map(geometry), captured.boxes);
  await f.page.locator("#fixture").evaluate((root) => {
    root.style.gridAutoRows = "80px";
  });
  const fixed = await designNodeToV3((await f.capture()).tree);
  assert.ok(code(fixed).includes("grid-implicit-row-count"));
  assert.equal(normalizeDesignDocument(fixed.document).nodes[0].layout, "grid");
});

test("anonymous Grid text keeps its parent text style while diagnosing line-box loss", async (t) => {
  const f = await browserFixture(
    t,
    `<!doctype html><style>body{margin:0}#fixture{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:80px;width:640px;height:240px;font:24px/30px Arial;color:rgb(255,0,0)}</style><main id="fixture">Alpha<div></div></main>`,
  );
  const captured = await f.capture(),
    text = captured.tree.children.find((node) => node.nodeType === "text");
  assert.equal(text.content, "Alpha");
  assert.equal(text.textStyle.fontFamily, "Arial");
  assert.equal(text.textStyle.fontSize, 24);
  assert.equal(text.textStyle.color.r, 255);
  const result = await designNodeToV3(captured.tree);
  assert.equal(normalizeDesignDocument(result.document).nodes[0].layout, "none");
  assert.ok(
    result.report.warnings.some(
      (warning) => warning.code === "grid-fixed-geometry" && warning.message.includes("匿名文本"),
    ),
  );
});

test("missing Typed OM diagnoses Grid intent loss without upstream synthetic rows", async (t) => {
  const f = await browserFixture(t);
  await f.page.evaluate(() => {
    Element.prototype.computedStyleMap = undefined;
  });
  const captured = await f.capture(),
    result = await designNodeToV3(captured.tree);
  assert.equal(captured.tree.children.length, 6);
  assert.equal(normalizeDesignDocument(result.document).nodes[0].layout, "none");
  assert.ok(
    result.report.warnings.some(
      (warning) => warning.code === "grid-fixed-geometry" && warning.message.includes("Typed OM"),
    ),
  );
});

test("a late child rejection clears parent placement fields while preserving its own nested Grid", async (t) => {
  const f = await browserFixture(t);
  await f.page.locator("#fixture").evaluate((root) => {
    const last = root.lastElementChild;
    last.id = "nested";
    last.style.cssText =
      "display:grid;grid-template-columns:30px minmax(0,1fr);grid-template-rows:40px;height:50%";
    last.innerHTML = "<div></div><div></div>";
  });
  const result = await designNodeToV3((await f.capture()).tree);
  const root = result.document.pages[0].children[0],
    nested = root.children.at(-1);
  assert.equal(root.layout, "none");
  assert.equal(nested.layout, "grid");
  assert.deepEqual(nested.gridColumnSizes, [
    { type: "fixed", value: 30 },
    { type: "flex", value: 1 },
  ]);
  for (const child of root.children) {
    for (const field of [
      "gridColumnSpan",
      "gridRowSpan",
      "gridRowAnchorIndex",
      "gridColumnAnchorIndex",
      "gridChildHorizontalAlign",
      "gridChildVerticalAlign",
    ])
      assert.equal(child[field], undefined, `${child.name} ${field}`);
    assert.notEqual(child.layoutSizingHorizontal, "fill");
  }
  assert.ok(nested.children.every((child) => child.layoutSizingHorizontal === "fill"));
  assert.ok(code(result).includes("grid-fixed-geometry"));
});

test("inline Grid and explicit max-content container widths preserve Hug intent", async (t) => {
  const f = await browserFixture(
    t,
    `<!doctype html><style>body{margin:0}#fixture{display:inline-grid;grid-template-columns:80px 120px;grid-template-rows:120px;gap:10px}#fixture>div{height:60px}</style><main id="fixture"><div></div><div></div></main>`,
  );
  for (const mode of ["inline", "max-content"]) {
    if (mode === "max-content")
      await f.page.locator("#fixture").evaluate((root) => {
        root.style.display = "grid";
        root.style.width = "max-content";
      });
    const captured = await f.capture(),
      result = await designNodeToV3(captured.tree),
      state = normalizeDesignDocument(result.document);
    assert.deepEqual(result.report.warnings, []);
    assert.equal(state.nodes[0].layoutSizingHorizontal, "hug");
    assert.equal(state.nodes[0].layoutSizingVertical, "hug");
    applyAllAutoLayouts(state.nodes);
    assert.equal(state.nodes[0].width, 210);
    assert.deepEqual(state.nodes.slice(1).map(geometry), captured.boxes);
  }
});
