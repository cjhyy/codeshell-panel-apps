import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import {
  importFigmaJson,
  createFigmaTransfer,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
  exportDesignSvg,
  replaceDesignColors,
} from "../../../apps/design-studio/app/document.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { auditDesignPages, readableTextContrast } from "../../../apps/design-studio/app/audit.mjs";
import {
  normalizeDesignPaints,
  sampleDesignFill,
  designPaintsToFigma,
  figmaFillPaints,
} from "../../../apps/design-studio/app/paint.mjs";

const solid = (r, g, b, a = 1) => ({ type: "SOLID", color: { r, g, b, a } });
const gradient = {
  type: "GRADIENT_LINEAR",
  gradientHandlePositions: [
    { x: 0, y: 0.5 },
    { x: 1, y: 0.5 },
    { x: 0, y: 1 },
  ],
  gradientStops: [
    { position: 0, color: { r: 0, g: 0.25, b: 1, a: 1 } },
    { position: 1, color: { r: 1, g: 0.1, b: 0.2, a: 1 } },
  ],
};
const node = (id, type, x, y, width, height, fills, extra = {}) => ({
  id,
  type,
  name: id,
  absoluteBoundingBox: { x, y, width, height },
  fills,
  ...extra,
});
function fixture() {
  const source = {
    type: "CANVAS",
    id: "0:1",
    name: "Paint fixture",
    children: [
      node("1:1", "FRAME", 0, 0, 400, 260, [solid(1, 1, 1), solid(10 / 255, 14 / 255, 39 / 255)], {
        children: [],
      }),
      node("1:2", "TEXT", 20, 20, 350, 45, [solid(1, 1, 1)], {
        characters: "Readable heading",
        style: { fontFamily: "Arial", fontSize: 32, fontWeight: 700, lineHeightPx: 40 },
      }),
      node("1:3", "RECTANGLE", 20, 100, 150, 80, [gradient]),
      node("1:4", "TEXT", 195, 100, 195, 60, [gradient], {
        characters: "GRAD",
        style: { fontFamily: "Arial", fontSize: 48, fontWeight: 700, lineHeightPx: 58 },
      }),
      node("1:5", "RECTANGLE", 20, 200, 150, 40, [solid(1, 1, 1), solid(1, 0, 0, 0.5)]),
    ],
  };
  const result = importFigmaJson(source);
  result.document.canvas = { width: 400, height: 260, background: "#ffffff" };
  return result;
}
const pixelAt = (png, x, y) => [
  ...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3),
];
function close(actual, expected) {
  assert(
    actual.every((channel, i) => Math.abs(channel - expected[i]) <= 3),
    `${actual} != ${expected}`,
  );
}

test("REST paint stacks preserve order, alpha and bounded gradient text through schema/transfer", () => {
  const { document, warnings } = fixture();
  const [bg, heading, rect, text, alpha] = document.nodes;
  assert.equal(bg.fill, "#0a0e27");
  assert.equal(bg.fillPaints.length, 2);
  assert.equal(rect.fillPaints[0].type, "GRADIENT_LINEAR");
  assert.equal(text.fillPaints[0].type, "GRADIENT_LINEAR");
  assert.equal(alpha.fillPaints[1].opacity, 0.5);
  const saved = serializeDesignDocument(document),
    reopened = normalizeDesignDocument(JSON.parse(saved));
  assert.deepEqual(
    reopened.nodes.map((n) => n.fillPaints),
    document.nodes.map((n) => n.fillPaints),
  );
  const transfer = createFigmaTransfer(reopened);
  assert.deepEqual(transfer.pages[0].children[3].fillPaints, text.fillPaints);
  assert(
    !warnings.some((w) =>
      ["multiple-paints", "unsupported-paint", "paint-opacity"].includes(w.code),
    ),
  );
  const issues = auditDesignPages(document);
  assert(!issues.some((issue) => issue.code === "content.invisible-text"));
  const contrast = readableTextContrast(document, heading);
  assert(contrast.ratio > 15);
  assert.equal(contrast.required, 3);
});

test("gradient transform and color-stop alpha round trip to the Figma plugin API", () => {
  const source = {
    ...gradient,
    opacity: 0.6,
    gradientStops: gradient.gradientStops.map((s, i) => ({
      ...s,
      color: { ...s.color, a: i ? 0.2 : 0.8 },
    })),
  };
  const paints = figmaFillPaints([source]);
  const native = designPaintsToFigma({ fillPaints: paints });
  assert.equal(native[0].opacity, 0.6);
  assert.equal(native[0].gradientStops[1].color.a, 0.2);
  const imported = figmaFillPaints(native);
  assert.deepEqual(imported, paints);
  const sample = sampleDesignFill({ fillPaints: paints }, { x: 0.5, y: 0.5 });
  assert(Math.abs(sample.alpha - 0.3) < 1e-6);
});

test("paint schema rejects unbounded/active/degenerate input; unsupported Figma geometry is explicit", () => {
  const paints = figmaFillPaints([gradient]);
  for (const bad of [
    [...Array(9)].map(() => paints[0]),
    [{ ...paints[0], url: "https://invalid" }],
    [
      {
        ...paints[0],
        handles: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    ],
    [{ ...paints[0], stops: [...paints[0].stops].reverse() }],
  ])
    assert.throws(() => normalizeDesignPaints(bad));
  const warnings = [];
  const fallback = figmaFillPaints(
    [
      {
        ...gradient,
        gradientHandlePositions: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    ],
    (warning) => warnings.push(warning),
  );
  assert.equal(fallback[0].type, "SOLID");
  assert.equal(fallback[0].color, "#ff1a33");
  assert.match(warnings[0], /退化/u);
});

test("real Chromium pixels prove bottom-to-top fills, gradient backgrounds and gradient glyph visibility in SVG and HTML", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 400, height: 260 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const network = [];
  await context.route("**/*", (route) => {
    network.push(route.request().url());
    return route.abort();
  });
  const { document } = fixture();
  for (const [kind, content] of [
    ["svg", `<style>body{margin:0}</style>${exportDesignSvg(document)}`],
    ["html", exportDesignFrontend(JSON.parse(serializeDesignDocument(document)))],
  ]) {
    await page.setContent(content);
    await page.evaluate(() => document.fonts.ready);
    const png = PNG.sync.read(await page.screenshot());
    close(pixelAt(png, 390, 240), [10, 14, 39]);
    const left = pixelAt(png, 30, 135),
      right = pixelAt(png, 160, 135);
    assert(left[2] > left[0] + 80, `${kind} left gradient`);
    assert(right[0] > right[2] + 80, `${kind} right gradient`);
    close(pixelAt(png, 90, 220), [255, 128, 128]);
    let visibleGlyphPixels = 0,
      blueGlyph = 0,
      redGlyph = 0;
    for (let y = 105; y < 160; y++)
      for (let x = 195; x < 390; x++) {
        const [r, g, b] = pixelAt(png, x, y);
        if (r > 60 || g > 60 || b > 80) {
          visibleGlyphPixels++;
          if (b > r + 40) blueGlyph++;
          if (r > b + 40) redGlyph++;
        }
      }
    assert(visibleGlyphPixels > 500, `${kind} gradient text disappeared`);
    assert(blueGlyph > 30 && redGlyph > 30, `${kind} glyphs must keep multiple gradient colors`);
  }
  assert.deepEqual(network, []);
});

test("readableTextContrast uses real alpha/background sampling and keeps genuine weak contrast visible", () => {
  const { document } = fixture();
  const heading = document.nodes[1];
  heading.fill = "#303747";
  const before = readableTextContrast(document, heading);
  assert(before.ratio < 3);
  assert(
    auditDesignPages(document).some(
      (issue) => issue.nodeId === heading.id && issue.code === "a11y.text-contrast",
    ),
  );
  heading.fill = "#ffffff";
  heading.fillPaints = [{ type: "SOLID", color: "#ffffff", opacity: 0.1 }];
  assert(readableTextContrast(document, heading).ratio < 3);
});

test("palette replacement changes actual solid/gradient stops and recomputes the compatibility fill", () => {
  const { document } = fixture();
  const rectangle = document.nodes[2];
  assert(
    replaceDesignColors(document, [
      ["#0040ff", "#00ff00"],
      ["#0a0e27", "#111111"],
    ]) > 0,
  );
  assert.equal(rectangle.fillPaints[0].stops[0].color, "#00ff00");
  assert.equal(document.nodes[0].fillPaints[1].color, "#111111");
  assert.equal(document.nodes[0].fill, "#111111");
  const sample = sampleDesignFill(rectangle);
  assert.equal(
    rectangle.fill,
    `#${[sample.red, sample.green, sample.blue]
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`,
  );
});

test("real Chromium alpha interpolation matches the contrast sampler rather than a guessed premultiplied gradient", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 400, height: 260 } });
  const { document } = fixture();
  const rect = document.nodes[2];
  rect.fillPaints[0].stops[1].opacity = 0;
  await page.setContent(`<style>body{margin:0}</style>${exportDesignSvg(document)}`);
  const png = PNG.sync.read(await page.screenshot());
  const x = 95,
    y = 135;
  const sample = sampleDesignFill(rect, {
    x: (x + 0.5 - rect.x) / rect.width,
    y: (y + 0.5 - rect.y) / rect.height,
  });
  const expected = [sample.red, sample.green, sample.blue].map((v, index) =>
    Math.round((v * sample.alpha + ([10, 14, 39][index] / 255) * (1 - sample.alpha)) * 255),
  );
  close(pixelAt(png, x, y), expected);
});
