import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { cssLinearBackgroundPaints } from "../../../apps/design-studio/app/css-linear-gradient.mjs";
import {
  normalizeDesignPaints,
  designFillPaints,
  designPaintsToFigma,
  figmaFillPaints,
  cssLinearSourceSnapshot,
  restoreCssLinearSource,
  normalizeCssLinearSource,
  inverseGradientMatrix,
  cssLinearNeedsNativeWarning,
} from "../../../apps/design-studio/app/paint.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
  exportDesignSvg,
  replaceDesignColors,
} from "../../../apps/design-studio/app/document.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { compareDesignDocuments } from "../../../apps/design-studio/app/design-compare.mjs";
import {
  createFigmaTransfer,
  importFigmaJson,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import {
  comparePixels,
  runProductionFidelity,
} from "../../../scripts/design-studio-production-fidelity.mjs";

const style = (image) => ({ "background-image": image, "background-color": "rgb(255,255,255)" });
const paints = (image, width = 640, height = 160) =>
  cssLinearBackgroundPaints(style(image), width, height);
function fixture(fillPaints, width = 640, height = 160) {
  return normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: "Responsive gradient",
    canvas: { width, height, background: "#ffffff" },
    tokens: { colors: [] },
    resources: [],
    activePageId: "page-1",
    pages: [
      {
        id: "page-1",
        name: "Gradient",
        children: [
          {
            id: "gradient",
            name: "Gradient",
            type: "rectangle",
            x: 0,
            y: 0,
            width,
            height,
            fill: "#ffffff",
            fillPaints,
            stroke: "transparent",
            strokeWidth: 0,
            opacity: 1,
            rotation: 0,
            cornerRadius: 0,
            visible: true,
            locked: false,
          },
        ],
      },
    ],
  });
}
const round = (value) =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "number" ? Math.round(v * 1e9) / 1e9 : v)),
  );
const signature = (paint) =>
  paint.type === "SOLID"
    ? paint
    : { matrix: inverseGradientMatrix(paint.handles)[0], stops: paint.stops };

test("authored angle, corners, mixed-unit stop fixup and transparent aliases resolve from current non-square size", () => {
  for (const image of [
    "linear-gradient(45deg, rgb(0,0,0), rgb(255,255,255))",
    "linear-gradient(-30deg, rgb(255,0,0) -40px, rgb(0,255,0), rgb(0,0,255) 80%, rgb(255,255,255) 900px)",
    "linear-gradient(to bottom left, rgb(0,0,0) 60%, rgb(20,20,20), rgb(40,40,40) 20%, rgb(255,255,255))",
    "linear-gradient(45deg, rgb(255,0,0), transparent, rgb(0,0,255))",
  ]) {
    const original = paints(image);
    for (const [width, height] of [
      [640, 160],
      [400, 160],
      [200, 440],
    ]) {
      const resolved = designFillPaints({ fillPaints: original, width, height });
      const fresh = paints(image, width, height);
      assert.deepEqual(round(resolved.map(signature)), round(fresh.map(signature)));
    }
  }
});

test("v3 save, color edits and semantic paint comparison retain intent without stale snapshot false positives", () => {
  const image = "linear-gradient(-45deg, rgb(255,0,0) 20px, rgb(0,0,255) 80%)";
  const original = fixture(paints(image)),
    saved = JSON.parse(serializeDesignDocument(original));
  const reopened = normalizeDesignDocument(saved);
  assert.deepEqual(reopened.nodes[0].fillPaints, original.nodes[0].fillPaints);
  reopened.nodes[0].width = 400;
  reopened.canvas.width = 400;
  const before = JSON.parse(serializeDesignDocument(reopened));
  const fresh = structuredClone(before);
  fresh.pages[0].children[0].fillPaints = paints(image, 400, 160);
  assert.equal(compareDesignDocuments(before, fresh).passed, true);
  fresh.pages[0].children[0].fillPaints[1].cssLinear.direction.angle = 90;
  assert.equal(compareDesignDocuments(before, fresh).passed, false);
  const changed = replaceDesignColors(reopened, new Map([["#ff0000", "#00ff00"]]));
  assert.equal(changed, 1);
  assert.equal(reopened.nodes[0].fillPaints[1].stops[0].color, "#00ff00");
  assert.deepEqual(
    reopened.nodes[0].fillPaints[1].cssLinear,
    original.nodes[0].fillPaints[1].cssLinear,
  );
});

test("metadata validates finite bounded numeric grammar, stop correspondence and inactive provenance", () => {
  const gradient = paints("linear-gradient(45deg, rgb(0,0,0), rgb(255,255,255))")[1];
  for (const cssLinear of [
    { ...gradient.cssLinear, url: "javascript:evil" },
    { ...gradient.cssLinear, direction: { angle: Infinity } },
    { ...gradient.cssLinear, direction: { angle: 360 } },
    { ...gradient.cssLinear, direction: { angle: 45, corner: [1, 1] } },
    { ...gradient.cssLinear, direction: { corner: [1, 0] } },
    { ...gradient.cssLinear, positions: [null] },
    { ...gradient.cssLinear, positions: Array(17).fill(null) },
    { ...gradient.cssLinear, positions: [{ unit: "px", value: 20001 }, null] },
    { ...gradient.cssLinear, positions: [{ unit: "url", value: 1 }, null] },
    { ...gradient.cssLinear, positions: ["previous", null] },
    { ...gradient.cssLinear, positions: [null, "previous"] },
    { ...gradient.cssLinear, positions: new Array(2) },
    { ...gradient.cssLinear, sourceOnly: false },
  ])
    assert.throws(() => normalizeDesignPaints([{ ...gradient, cssLinear }]));
  const inactive = {
    ...gradient,
    cssLinear: { ...gradient.cssLinear, positions: [null, null, null], sourceOnly: true },
  };
  assert.deepEqual(designFillPaints({ fillPaints: [inactive], width: 400, height: 320 }), [
    inactive,
  ]);
  assert.throws(() =>
    normalizeCssLinearSource({ version: 1, width: NaN, height: 100, paints: [gradient] }),
  );
  assert.throws(() =>
    normalizeCssLinearSource({
      version: 1,
      width: 100,
      height: 100,
      paints: [gradient],
      css: "evil",
    }),
  );
});

test("native current-size snapshots restore active source only while geometry agrees; native edits remain sourceOnly", () => {
  const stack = paints("linear-gradient(45deg, rgb(0,0,0) 20px, rgb(255,255,255) 80%)");
  const node = { fillPaints: stack, width: 400, height: 160 };
  const native = figmaFillPaints(designPaintsToFigma(node));
  const source = cssLinearSourceSnapshot(node),
    warnings = [];
  assert.deepEqual(
    round(
      designFillPaints({
        fillPaints: restoreCssLinearSource(native, source, 400, 160),
        width: 400,
        height: 160,
      }),
    ),
    round(designFillPaints(node)),
  );
  const resized = restoreCssLinearSource(native, source, 200, 160, (w) => warnings.push(w));
  assert.equal(resized[1].cssLinear.sourceOnly, true);
  assert.equal(warnings.length, 1);
  assert.deepEqual(designFillPaints({ fillPaints: resized, width: 800, height: 400 }), resized);
  assert.equal(
    restoreCssLinearSource(resized, source, 400, 160)[1].cssLinear.sourceOnly,
    true,
    "inactive intent cannot reactivate itself when dimensions happen to match again",
  );
  const inactiveSource = cssLinearSourceSnapshot({ fillPaints: resized, width: 200, height: 160 });
  assert.equal(
    restoreCssLinearSource(resized, inactiveSource, 400, 160)[1].cssLinear.sourceOnly,
    true,
    "inactive intent never reactivates itself",
  );
  const legacy = native.map((p) => structuredClone(p));
  assert.deepEqual(designFillPaints({ fillPaints: legacy, width: 200, height: 160 }), legacy);
  assert(cssLinearNeedsNativeWarning(stack[1]));
  assert.equal(
    cssLinearNeedsNativeWarning(
      paints("linear-gradient(to top right, rgb(0,0,0), rgb(255,255,255))")[1],
    ),
    false,
  );
  const transfer = createFigmaTransfer(fixture(stack, 400, 160));
  assert(transfer.warnings.some((w) => w.code === "css-gradient-native-resize"));
  const imported = importFigmaJson({
    id: "1:1",
    type: "RECTANGLE",
    name: "Native",
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 160 },
    fills: designPaintsToFigma(node),
    codeshellCssLinearSource: source,
  });
  assert.equal(imported.document.nodes[0].fillPaints[1].cssLinear.sourceOnly, true);
  assert(imported.warnings.some((w) => w.code === "css-gradient-native-source"));
});

test("published and Host schemas carry the same bounded optional descriptor", async () => {
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
  const source = JSON.parse(
    serializeDesignDocument(
      fixture(paints("linear-gradient(45deg, rgb(0,0,0), rgb(255,255,255))")),
    ),
  );
  assert(validate(source), JSON.stringify(validate.errors));
  const manifest = JSON.parse(
    await readFile(
      new URL("../../../apps/design-studio/.codeshell-panel/panel.json", import.meta.url),
      "utf8",
    ),
  );
  const tool = manifest.agent.tools.find((t) => t.name === "use_design");
  const { validateToolArgsStrict } = await import("@cjhyy/code-shell-core");
  const request = {
    expected_state_revision: "gradient-schema",
    operations: [
      {
        op: "update_node",
        node_id: "gradient",
        changes: { fillPaints: source.pages[0].children[0].fillPaints },
      },
    ],
  };
  assert.equal(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
  source.pages[0].children[0].fillPaints[1].cssLinear.positions[0] = { unit: "px", value: 20001 };
  assert.equal(validate(source), false);
  assert.notEqual(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
});

test("equal capture geometry cannot attach a reordered or ambiguous layer's future CSS intent", () => {
  const angle = paints("linear-gradient(45deg, rgb(255,0,0), rgb(0,0,0))", 200, 200)[1];
  const corner = paints(
    "linear-gradient(to top right, rgb(0,0,255), rgb(255,255,255))",
    200,
    200,
  )[1];
  const node = { fillPaints: [angle, corner], width: 200, height: 200 },
    source = cssLinearSourceSnapshot(node);
  const native = figmaFillPaints(designPaintsToFigma(node));
  assert(restoreCssLinearSource(native, source, 200, 200).every((p) => !p.cssLinear.sourceOnly));
  const reordered = restoreCssLinearSource([...native].reverse(), source, 200, 200);
  assert(reordered.every((p) => p.cssLinear.sourceOnly));
  assert.deepEqual(
    reordered[0].cssLinear.direction,
    corner.cssLinear.direction,
    "moved paint retains its own inactive provenance",
  );
  const identical = { ...corner, stops: structuredClone(angle.stops) };
  const ambiguous = { fillPaints: [angle, identical], width: 200, height: 200 };
  const restored = restoreCssLinearSource(
    figmaFillPaints(designPaintsToFigma(ambiguous)),
    cssLinearSourceSnapshot(ambiguous),
    200,
    200,
  );
  assert(
    restored.every((p) => p.cssLinear.sourceOnly),
    "same colors/geometry cannot prove identity when future directions differ",
  );
  const edited = structuredClone(native);
  edited[0].stops[0].color = "#00ff00";
  assert.equal(
    restoreCssLinearSource(edited, source, 200, 200)[0].cssLinear.sourceOnly,
    true,
    "palette edits with indistinguishable geometry are conservatively inactive",
  );
  const unique = { fillPaints: [angle], width: 200, height: 200 };
  assert.equal(
    restoreCssLinearSource([edited[0]], cssLinearSourceSnapshot(unique), 200, 200)[0].cssLinear
      .sourceOnly,
    undefined,
    "a unique geometry retains editable native palette changes",
  );
});

test("extreme validated CSS stop/aspect edits remain renderable but fail native interchange before mutation", () => {
  const doc = fixture(paints("linear-gradient(45deg, rgb(0,0,0), rgb(255,255,255))"));
  doc.nodes[0].width = 1;
  doc.nodes[0].height = 20000;
  assert.doesNotThrow(() => serializeDesignDocument(doc));
  assert.doesNotThrow(() => exportDesignSvg(doc));
  assert.throws(() => designPaintsToFigma(doc.nodes[0]), /±100/u);
  assert.throws(() => createFigmaTransfer(doc), /±100/u);
  const stopEdit = fixture(paints("linear-gradient(90deg, rgb(0,0,0), rgb(255,255,255))"));
  stopEdit.nodes[0].width = 1;
  stopEdit.nodes[0].height = 1;
  stopEdit.nodes[0].fillPaints[1].cssLinear.positions[1] = { unit: "px", value: 20000 };
  assert.doesNotThrow(() => serializeDesignDocument(stopEdit));
  assert.throws(() => createFigmaTransfer(stopEdit), /±100/u);
});

test("generated frontend CSS keeps physical angle, stops, alpha and layer order during browser-only resizing and source color edits", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 640, height: 160 },
    deviceScaleFactor: 1,
  });
  await context.route("**/*", (route) => route.abort());
  const page = await context.newPage();
  for (const image of [
    "linear-gradient(45deg, rgb(0,0,0), rgb(255,255,255))",
    "linear-gradient(-30deg, rgb(255,0,0) -40px, rgb(0,255,0), rgb(0,0,255) 80%, rgb(255,255,255) 900px)",
    "linear-gradient(to top right, rgba(255,0,0,.5), transparent), linear-gradient(45deg, rgb(0,0,255), rgb(0,0,255))",
    "linear-gradient(45deg, rgb(255,0,0), transparent, rgb(0,0,255))",
  ]) {
    const doc = fixture(paints(image));
    const exported = exportDesignFrontend(JSON.parse(serializeDesignDocument(doc)));
    for (const [width, height] of [
      [640, 160],
      [400, 160],
      [200, 320],
    ]) {
      await page.setViewportSize({ width, height });
      await page.setContent(
        `<style>body{margin:0;background:white}div{width:100%;height:100vh;background-color:white;background-image:${image}}</style><div></div>`,
      );
      const expected = await page.screenshot();
      await page.setContent(exported);
      await page.locator('[data-codeshell-source-id="gradient"]').evaluate(
        (el, { width, height }) => {
          el.style.width = `${width}px`;
          el.style.height = `${height}px`;
          el.closest("main").style.width = `${width}px`;
          el.closest("main").style.height = `${height}px`;
        },
        { width, height },
      );
      const actual = await page.screenshot();
      assert.equal(
        comparePixels(expected, actual).metrics.changedPixels,
        0,
        `${image} ${width}×${height}`,
      );
    }
    replaceDesignColors(doc, new Map([["#ff0000", "#00ff00"]]));
    doc.nodes[0].width = 400;
    doc.canvas.width = 400;
    const edited = image.replaceAll("255,0,0", "0,255,0");
    await page.setViewportSize({ width: 400, height: 160 });
    await page.setContent(
      `<style>body{margin:0;background:white}div{width:100%;height:100vh;background-color:white;background-image:${edited}}</style><div></div>`,
    );
    const expected = await page.screenshot();
    await page.setContent(exportDesignFrontend(JSON.parse(serializeDesignDocument(doc))));
    assert.equal(
      comparePixels(expected, await page.screenshot()).metrics.changedPixels,
      0,
      "source color edit preserves orientation/alpha after resize",
    );
  }
});

test("real maintained capture, portable save/reopen and Auto Layout resize retain CSS 45° at strict zero pixels", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "responsive-gradient-production-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const source =
    '<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white}#fixture{display:flex;width:100%;height:240px;padding:20px;gap:16px;background:linear-gradient(#eeeeee,#ffffff 100px)}#a{width:200px;height:160px;background:linear-gradient(45deg,rgb(0,100,255),rgb(255,100,0))}#b{flex:1;height:160px;background:linear-gradient(45deg,#ff0000,#0000ff)}</style><main id="fixture"><div id="a"></div><div id="b"></div></main>';
  const report = await runProductionFidelity({ output, cases: [{ id: "css45", source }] });
  assert.equal(report.passed, true);
  assert.deepEqual(report.blockedRequests, []);
  assert.deepEqual(report.browserErrors, []);
  assert.deepEqual(report.cases[0].semanticIssues, []);
  assert.deepEqual(
    report.cases[0].comparisons.map((c) => c.changedPixels),
    [0, 0, 0],
  );
});
