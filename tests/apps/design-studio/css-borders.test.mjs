import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import {
  normalizeStrokeSides,
  designStrokePaths,
  designStrokeOutset,
  nativeDesignStroke,
  editDesignStrokeColor,
  editDesignStrokeWidth,
} from "../../../apps/design-studio/app/stroke.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
  exportDesignSvg,
  replaceDesignColors,
} from "../../../apps/design-studio/app/document.mjs";
import { compareDesignDocuments } from "../../../apps/design-studio/app/design-compare.mjs";
import {
  importFigmaJson,
  createFigmaTransfer,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import {
  runProductionFidelity,
  comparePixels,
} from "../../../scripts/design-studio-production-fidelity.mjs";

const side = (width, color = "#1d70b8", opacity = 1) => ({ width, color, opacity });
const bottom = [side(0), side(0), side(1), side(0)];
function fixture(sides = bottom, align = "inside", radius = 0) {
  return normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: "Border",
    canvas: { width: 320, height: 160, background: "#ffffff" },
    tokens: { colors: [] },
    resources: [],
    activePageId: "page-1",
    pages: [
      {
        id: "page-1",
        name: "Border",
        children: [
          {
            id: "border",
            name: "Border",
            type: "rectangle",
            x: 20,
            y: 20,
            width: 240,
            height: 100,
            fill: "#ffffff",
            stroke: "#1d70b8",
            strokeWidth: 1,
            strokeSides: sides,
            strokeAlign: align,
            opacity: 1,
            rotation: 0,
            cornerRadius: radius,
            visible: true,
            locked: false,
          },
        ],
      },
    ],
  });
}

test("solid sides preserve editable RGB/alpha/widths, comparison and palette semantics through v3", () => {
  const doc = fixture(),
    saved = JSON.parse(serializeDesignDocument(doc)),
    reopened = normalizeDesignDocument(saved);
  assert.deepEqual(reopened.nodes[0].strokeSides, bottom);
  assert.equal(designStrokeOutset(reopened.nodes[0]), 0);
  assert.equal(designStrokeOutset({ ...reopened.nodes[0], strokeAlign: "center" }), 0.5);
  assert.equal(designStrokeOutset({ ...reopened.nodes[0], strokeAlign: "outside" }), 1);
  const changed = structuredClone(saved);
  changed.pages[0].children[0].strokeSides[2].width = 2;
  assert.equal(compareDesignDocuments(saved, changed).passed, false);
  assert.equal(replaceDesignColors(reopened, new Map([["#1d70b8", "#ff0000"]])), 5);
  assert(reopened.nodes[0].strokeSides.every((s) => s.color === "#ff0000"));
  const legacy = { ...reopened.nodes[0] };
  delete legacy.strokeSides;
  delete legacy.strokeAlign;
  assert.equal(designStrokeOutset(legacy), 0.5, "old centered strokes retain their extent");
  assert(
    !exportDesignSvg(
      normalizeDesignDocument({ ...saved, pages: [{ ...saved.pages[0], children: [legacy] }] }),
    ).includes('fill-rule="evenodd"'),
  );
});

test("runtime rejects unsafe descriptors and unsupported joins, while native rejects multicolor before transfer", () => {
  for (const sides of [
    [],
    bottom.slice(1),
    [...bottom, side(1)],
    new Array(4),
    bottom.map((s, i) => (i ? s : { ...s, width: Infinity })),
    bottom.map((s, i) => (i ? s : { ...s, width: 101 })),
    bottom.map((s, i) => (i ? s : { ...s, opacity: -1 })),
    bottom.map((s, i) => (i ? s : { ...s, path: "M0 0" })),
  ])
    assert.throws(() => normalizeStrokeSides(sides));
  assert.throws(() => fixture(bottom, "evil"));
  assert.throws(() => fixture(bottom, "inside", 12), /圆角/u);
  assert.throws(
    () => fixture([side(2, "#ff0000", 0.5), side(2, "#ff0000", 1), side(0), side(0)]),
    /透明度/u,
  );
  const multicolor = [
    side(2, "#ff0000"),
    side(4, "#00ff00"),
    side(6, "#0000ff"),
    side(8, "#ff8000"),
  ];
  const doc = fixture(multicolor);
  assert.doesNotThrow(() => exportDesignSvg(doc));
  assert.throws(() => createFigmaTransfer(doc), /多色/u);
  assert.deepEqual(nativeDesignStroke(fixture().nodes[0]).weights, [0, 0, 1, 0]);
});

test("native independent weights/alpha/INSIDE import without centered-stroke loss, with effective included padding", () => {
  const input = {
    type: "FRAME",
    id: "1:1",
    name: "Native",
    absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 160 },
    layoutMode: "VERTICAL",
    paddingTop: 8,
    paddingRight: 8,
    paddingBottom: 8,
    paddingLeft: 8,
    strokesIncludedInLayout: true,
    strokeAlign: "INSIDE",
    individualStrokeWeights: { top: 0, right: 0, bottom: 1, left: 0 },
    strokes: [{ type: "SOLID", color: { r: 29 / 255, g: 112 / 255, b: 184 / 255 }, opacity: 0.5 }],
    children: [],
  };
  const imported = importFigmaJson(input),
    node = imported.document.nodes[0];
  assert.equal(node.strokeAlign, "inside");
  assert.deepEqual(
    node.strokeSides.map((s) => s.width),
    [0, 0, 1, 0],
  );
  assert(node.strokeSides.every((s) => s.opacity === 0.5));
  assert.deepEqual(
    [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft],
    [8, 8, 9, 8],
  );
  assert(!imported.warnings.some((w) => w.code === "stroke-alignment"));
  assert(!imported.warnings.some((w) => w.code === "paint-opacity"));
});

test("published v3 and Host schemas share bounded side descriptors", async () => {
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
  const validate = new Ajv2020({ strict: false }).compile(schema),
    source = JSON.parse(serializeDesignDocument(fixture()));
  assert(validate(source), JSON.stringify(validate.errors));
  const manifest = JSON.parse(
    await readFile(
      new URL("../../../apps/design-studio/.codeshell-panel/panel.json", import.meta.url),
      "utf8",
    ),
  );
  const tool = manifest.agent.tools.find((t) => t.name === "use_design"),
    { validateToolArgsStrict } = await import("@cjhyy/code-shell-core");
  const request = {
    expected_state_revision: "borders",
    operations: [
      {
        op: "update_node",
        node_id: "border",
        changes: { strokeSides: source.pages[0].children[0].strokeSides, strokeAlign: "inside" },
      },
    ],
  };
  assert.equal(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
  source.pages[0].children[0].strokeSides[0].width = 101;
  assert.equal(validate(source), false);
  assert.notEqual(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
});

const source = (border) =>
  `<!doctype html><style>*{box-sizing:border-box}body{margin:0;background:white}#fixture{display:flex;width:100%;height:240px;padding:20px;gap:16px;background:#eee}.tile{display:flex;flex:1;height:100px;padding:8px;background:#fff;${border}}.inner{flex:1;height:40px;background:#eaeaea}</style><main id="fixture"><div class="tile"><div class="inner"></div></div><div class="tile"><div class="inner"></div></div></main>`;

test("real capture/portable/Auto Layout resize and CSS export preserve inside borders and avoid double padding", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "css-border-production-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const overlaySource = source("border:4px solid #1d70b8;position:relative")
    .replace(
      ".inner{",
      ".overlay{position:absolute;left:0;top:0;width:8px;height:8px;background:red}.inner{",
    )
    .replaceAll(
      '<div class="inner"></div>',
      '<div class="inner"></div><div class="overlay"></div>',
    );
  const cases = [
    { id: "bottom", source: source("border-bottom:1px solid #cecece") },
    { id: "uniform", source: source("border:4px solid #1d70b8") },
    { id: "alpha", source: source("border:4px solid rgba(29,112,184,.5)") },
    { id: "absolute-overlay", source: overlaySource },
  ];
  const report = await runProductionFidelity({ output, cases });
  assert.equal(report.passed, true, JSON.stringify(report.cases.map((c) => c.comparisons)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 640, height: 240 },
    deviceScaleFactor: 1,
  });
  await context.route("**/*", (r) => r.abort());
  const page = await context.newPage();
  for (const c of report.cases) {
    assert.deepEqual(c.semanticIssues, []);
    assert.deepEqual(
      c.comparisons.map((x) => x.changedPixels),
      [0, 0, 0],
    );
    const data = normalizeDesignDocument(
      JSON.parse(await readFile(join(output, c.id, "imported.codesign.json"), "utf8")),
    );
    assert(data.nodes.filter((n) => n.strokeSides).every((n) => n.strokeAlign === "inside"));
    const expected = await readFile(join(output, c.id, "imported-source.png"));
    await page.setContent(exportDesignFrontend(JSON.parse(serializeDesignDocument(data))));
    assert.equal(
      comparePixels(expected, await page.screenshot()).metrics.changedPixels,
      0,
      "CSS export removes the already-accounted border inset from padding",
    );
    const root = data.nodes.find((n) => n.parentId === "html-viewport");
    data.canvas.width = 400;
    for (const n of data.nodes) if (n.id === "html-viewport" || n.id === root.id) n.width = 400;
    applyAllAutoLayouts(data.nodes);
    await page.setViewportSize({ width: 400, height: 240 });
    await page.setContent(exportDesignFrontend(JSON.parse(serializeDesignDocument(data))));
    assert.equal(
      comparePixels(
        await readFile(join(output, c.id, "narrow-source.png")),
        await page.screenshot(),
      ).metrics.changedPixels,
      0,
    );
    await page.setViewportSize({ width: 640, height: 240 });
  }
});

test("uniform rounded rings remain editable; unsupported unequal rounded/alpha joins and collapsed borders stay diagnosed", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "css-border-subset-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const cases = [
    { id: "rounded", source: source("border:4px solid #1d70b8;border-radius:12px") },
    {
      id: "unsupported-rounded",
      source: source("border-bottom:4px solid #1d70b8;border-radius:12px"),
    },
    {
      id: "unsupported-alpha",
      source: source("border:4px solid red;border-right-color:rgba(255,0,0,.5)"),
    },
    {
      id: "unsupported-image",
      source: source("border:4px solid red;border-image:linear-gradient(red,blue) 1"),
    },
    {
      id: "collapsed",
      source:
        '<!doctype html><style>body{margin:0}#fixture{display:table;border-collapse:collapse;width:100%;height:240px}.row{display:table-row;border-bottom:1px solid #cecece}.cell{display:table-cell;height:40px}</style><main id="fixture"><div class="row"><div class="cell"></div></div><div class="row"><div class="cell"></div></div></main>',
    },
  ];
  const report = await runProductionFidelity({ output, cases, recordOnly: true });
  for (const id of ["unsupported-rounded", "unsupported-alpha", "unsupported-image"])
    assert(
      report.cases
        .find((c) => c.id === id)
        .warnings.some((w) => w.code === "unsupported-css-border"),
    );
  assert(
    report.cases
      .find((c) => c.id === "collapsed")
      .warnings.some((w) => w.code === "collapsed-border"),
  );
  const rounded = normalizeDesignDocument(
    JSON.parse(await readFile(join(output, "rounded/imported.codesign.json"), "utf8")),
  );
  assert(rounded.nodes.some((n) => n.cornerRadius === 12 && n.strokeSides));
  assert(
    designStrokePaths(rounded.nodes.find((n) => n.strokeSides)).some((p) => p.rule === "evenodd"),
  );
});

test("uniform color/width edits preserve side ratios and alpha, and invalid edits remain atomic", () => {
  const node = fixture([
    side(2, "#1d70b8", 0.5),
    side(4, "#1d70b8", 0.5),
    side(6, "#1d70b8", 0.5),
    side(0),
  ]).nodes[0];
  editDesignStrokeColor(node, "#ff0000");
  editDesignStrokeWidth(node, 12);
  assert.deepEqual(
    node.strokeSides.map((s) => s.width),
    [4, 8, 12, 0],
  );
  assert(node.strokeSides.every((s) => s.color === "#ff0000" && s.opacity === (s.width ? 0.5 : 1)));
  const before = structuredClone(node);
  assert.throws(() => editDesignStrokeWidth(node, 101));
  assert.deepEqual(node, before);
  editDesignStrokeColor(node, "transparent");
  assert(node.strokeSides.every((s) => s.opacity === 0));
  editDesignStrokeColor(node, "#00ff00");
  assert(node.strokeSides.every((s) => s.opacity === 1));
  assert.equal(node.strokeSides[3].width, 0);
});

test("structured square center/outside borders retain sharp corners and thick rounded borders close their hole", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 160 } });
  for (const align of ["center", "outside"]) {
    const doc = fixture(
      Array.from({ length: 4 }, () => side(8)),
      align,
    );
    const paths = designStrokePaths(doc.nodes[0]);
    assert(
      !paths.some((p) => p.path.includes("A")),
      "zero radius must stay square for every alignment",
    );
    await page.setContent(
      `<style>body{margin:0;background:white}.box{position:absolute;left:20px;top:20px;width:240px;height:100px;background:white;outline:${align === "center" ? 4 : 8}px solid #1d70b8;${align === "center" ? "box-shadow:inset 0 0 0 4px #1d70b8" : ""}}</style><div class="box"></div>`,
    );
    const reference = await page.screenshot();
    await page.setContent("<style>body{margin:0}</style>" + exportDesignSvg(doc));
    assert.equal(comparePixels(reference, await page.screenshot()).metrics.changedPixels, 0);
    await page.setContent(exportDesignFrontend(JSON.parse(serializeDesignDocument(doc))));
    assert.equal(comparePixels(reference, await page.screenshot()).metrics.changedPixels, 0);
  }
  const tiny = fixture(
    Array.from({ length: 4 }, () => side(40)),
    "inside",
    10,
  );
  tiny.nodes[0].width = 20;
  tiny.nodes[0].height = 20;
  const paths = designStrokePaths(tiny.nodes[0]);
  assert.equal(paths.length, 1);
  assert.equal(
    paths[0].path.split("M").length,
    2,
    "collapsed inner hole must not produce a self-intersecting subpath",
  );
  await page.setContent(
    '<style>body{margin:0;background:white}.box{position:absolute;left:20px;top:20px;width:20px;height:20px;border-radius:10px;background:#1d70b8}</style><div class="box"></div>',
  );
  const reference = await page.screenshot();
  await page.setContent("<style>body{margin:0}</style>" + exportDesignSvg(tiny));
  const metrics = comparePixels(reference, await page.screenshot()).metrics;
  t.diagnostic(`Tiny rounded SVG/CSS edge pixels: ${JSON.stringify(metrics)}`);
  const { PNG } = await import("pngjs"),
    png = PNG.sync.read(await page.screenshot());
  const pixel = (x, y) => [
    ...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3),
  ];
  assert.deepEqual(pixel(30, 30), [29, 112, 184]);
  assert.deepEqual(pixel(20, 20), [255, 255, 255]);
});
