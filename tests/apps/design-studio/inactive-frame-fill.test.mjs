import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { importFigmaJson, prepareFigmaImport, createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { createFigmaBinding, createFigmaPatch, parseFigmaBinding } from "../../../apps/design-studio/app/figma-binding.mjs";
import { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts, distributeFillSizes } from "../../../apps/design-studio/app/layout.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";

const fixture = JSON.parse(await readFile(new URL("../../fixtures/design-studio-inactive-frame-fill.json", import.meta.url), "utf8"));
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = value => structuredClone(value);
const save = value => JSON.parse(serializeDesignDocument(value));
const source = entry => ({ id: "0:1", type: "CANVAS", name: "Actual inactive Frame Fill", children: [clone(entry.source)] });
const geometry = document => document.nodes.map(({ id, parentId, x, y, width, height }) => ({ id, parentId, x, y, width, height }));
const positiveCases = fixture.cases.filter(entry => entry.childKind === "FRAME_NONE_RETAINED_PADDING" && entry.maximum === "none");
const borderCases = positiveCases.filter(entry => entry.live.requestedWeights[0] > 0);

function atStage(entry, stage) {
  const raw = source(entry), live = new Map(stage.live.map(node => [node.id, node]));
  function update(node) {
    const current = live.get(node.id);
    if (current) for (const key of ["absoluteBoundingBox", "absoluteRenderBounds"]) node[key] = clone(current[key]);
    node.children?.forEach(update);
  }
  raw.children.forEach(update);
  return raw;
}

test("inactive native fixture retains exact official subtrees and live getter provenance", () => {
  assert.equal(fixture.provenance.rawResultSha256, "2ece3bfe65c19b266cf76d14aa6dc0861c3b113234a7cc08b0aa9e814ef46a7a");
  assert.equal(fixture.provenance.officialJsonSha256, "bfdf90aa2f3e4047c2c4ee83270452b5bbcd712605b47163320ece6c2f071143");
  for (const entry of fixture.cases) {
    assert.equal(digest(entry.source), entry.officialSubtreeSha256);
    assert.equal(digest(entry.live), entry.liveCaseSha256);
    if (entry.childKind !== "FRAME_NONE_RETAINED_PADDING") continue;
    for (const [index, child] of entry.source.children.entries()) {
      assert.equal(child.layoutMode, undefined, "REST omits inactive layout mode");
      for (const key of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]) {
        assert.equal(child[key], undefined, "REST omits inactive padding");
        assert.equal(entry.live.snapshots[0].live[index + 1][key], index === 0 ? 8 : 20, "live SDK retains latent padding");
      }
    }
  }
});

test("actual inactive Frame Fill retains IDs and geometry through resize, source binding and reopen", async () => {
  for (const entry of positiveCases) {
    const prepared = await prepareFigmaImport(source(entry)), document = prepared.document;
    assert.deepEqual(prepared.warnings, [], entry.name);
    const binding = parseFigmaBinding(JSON.parse(JSON.stringify(createFigmaBinding(prepared))));
    const baseline = geometry(document);
    assert.equal(applyAllAutoLayouts(document.nodes), false, entry.name);
    assert.deepEqual(geometry(document), baseline);
    assert.deepEqual(createFigmaPatch(binding, document).operations, [], "unchanged native source must remain a no-op");
    for (const stage of [...entry.live.snapshots, entry.live.snapshots.at(-1)]) {
      const horizontal = entry.direction === "HORIZONTAL", size = horizontal ? "width" : "height";
      document.nodes[0][size] = stage.parentMainExtent;
      applyAllAutoLayouts(document.nodes);
      const measured = importFigmaJson(atStage(entry, stage)).document;
      assert.deepEqual(geometry(document), geometry(measured), `${entry.name}/${stage.parentMainExtent}`);
      const reopened = normalizeDesignDocument(save(document));
      assert.equal(applyAllAutoLayouts(reopened.nodes), false, "reopened measured geometry must already be settled");
      assert.deepEqual(geometry(reopened), geometry(document));
      assert.deepEqual(document.nodes.map(node => node.id).sort(), prepared.mapping.map(entry => entry.designId).sort());
      assert.ok(document.nodes.slice(1).every(node => node.layout === "none" && node.strokeLayoutExcluded === undefined));
    }
    assert.deepEqual(createFigmaPatch(binding, document).operations, [], "resize roundtrip back to native baseline remains a no-op");
    const transferred = createFigmaTransfer(document).pages[0].children[0];
    assert.equal(transferred.layout, entry.direction.toLowerCase());
    assert.ok(transferred.children.every(node => node.layout === "none" && node.strokeLayoutExcluded === undefined));
  }
});

test("inactive stored padding stays ignored for Frame/Component and inside stroke alone supplies basis", () => {
  for (const entry of borderCases) for (const type of ["frame", "component"]) {
    const document = importFigmaJson(source(entry)).document, parent = document.nodes[0], children = document.nodes.slice(1);
    const size = entry.direction === "HORIZONTAL" ? "width" : "height";
    for (const [index, child] of children.entries()) Object.assign(child, { type, padding: 1000, paddingTop: 8, paddingRight: 20, paddingBottom: 40, paddingLeft: index ? 999 : 100 });
    parent[size] = 400;
    applyAllAutoLayouts(document.nodes);
    assert.deepEqual(children.map(child => child[size]), [182, 190]);
    for (const child of children) child[size === "width" ? "maxWidth" : "maxHeight"] = 1;
    assert.deepEqual([...distributeFillSizes(children, entry.direction.toLowerCase(), 372).values()], [1, 1], "no CSS padding or stroke floor is added to inactive canonical boxes");
    assert.ok(children.every(child => child.strokeLayoutExcluded === undefined));
    assert.doesNotThrow(() => normalizeDesignDocument(save(document)));
  }
});

test("actual Rectangle controls retain their existing basis and measured resize geometry", () => {
  for (const entry of fixture.cases.filter(entry => entry.childKind === "RECTANGLE")) {
    const document = importFigmaJson(source(entry)).document;
    assert.equal(applyAllAutoLayouts(document.nodes), false);
    for (const stage of entry.live.snapshots) {
      document.nodes[0][entry.direction === "HORIZONTAL" ? "width" : "height"] = stage.parentMainExtent;
      applyAllAutoLayouts(document.nodes);
      assert.deepEqual(geometry(document), geometry(importFigmaJson(atStage(entry, stage)).document));
    }
  }
});

test("center/outside/legacy strokes keep existing basis rules and unsupported borders do not enable native flow", () => {
  for (const entry of borderCases) for (const align of ["CENTER", "OUTSIDE"]) {
    const raw = source(entry);
    for (const child of raw.children[0].children) child.strokeAlign = align;
    // This is a derived guard control, not a claimed new native capture.
    const document = importFigmaJson(raw).document, children = document.nodes.slice(1);
    assert.deepEqual([...distributeFillSizes(children, entry.direction.toLowerCase(), 612).values()], [306, 306]);
  }
  const raw = source(borderCases[0]);
  raw.children[0].children[0].dashPattern = [4, 4];
  const result = importFigmaJson(raw);
  assert.ok(result.warnings.some(warning => warning.code === "unsupported-native-border"));
  assert.ok(result.warnings.some(warning => warning.code === "native-stroke-fill-model"));
  assert.equal(result.document.nodes[0].layout, "none");
  const gradient = source(borderCases[0]);
  gradient.children[0].children[0].strokes.push({ type: "GRADIENT_LINEAR", gradientStops: [] });
  assert.equal(importFigmaJson(gradient).document.nodes[0].layout, "none", "unsupported paint fallback cannot certify a physical stroke basis");
});

test("unverified native limits and content exhaustion preserve measured geometry with an explicit flow diagnostic", () => {
  for (const entry of fixture.cases.filter(entry => entry.childKind === "FRAME_NONE_RETAINED_PADDING" && entry.maximum !== "none")) {
    const result = importFigmaJson(source(entry)), document = result.document, before = geometry(document);
    assert.ok(result.warnings.some(warning => warning.code === "native-stroke-fill-model"), entry.name);
    assert.equal(document.nodes[0].layout, "none");
    assert.ok(document.nodes.slice(1).every(node => node.layoutSizingHorizontal !== "fill" && node.layoutSizingVertical !== "fill" && node.layoutAlignSelf === undefined));
    assert.equal(applyAllAutoLayouts(document.nodes), false);
    assert.deepEqual(geometry(document), before);
    assert.equal(document.nodes[0].padding, 0);
    assert.equal(document.nodes[0].strokeLayoutExcluded, undefined);
  }
  for (const modify of [
    parent => { parent.children[0].minWidth = 20; },
    parent => { parent.absoluteBoundingBox.width = 52; },
    parent => { parent.absoluteBoundingBox.width = 36; },
    parent => { parent.children[0].absoluteBoundingBox.width -= 1; },
    parent => { parent.children.push({ ...clone(parent.children[0]), id: "derived-extra-child" }); },
    parent => { parent.primaryAxisAlignItems = "CENTER"; },
    parent => { parent.layoutWrap = "WRAP"; },
    parent => { parent.layoutSizingHorizontal = "HUG"; },
    parent => { parent.rotation = .1; parent.size = { x: parent.absoluteBoundingBox.width, y: parent.absoluteBoundingBox.height }; },
  ]) {
    const raw = source(borderCases[0]); modify(raw.children[0]);
    const result = importFigmaJson(raw), before = geometry(result.document);
    assert.equal(result.document.nodes[0].layout, "none");
    assert.ok(result.warnings.some(warning => warning.code === "native-stroke-fill-model"));
    assert.equal(applyAllAutoLayouts(result.document.nodes), false);
    assert.deepEqual(geometry(result.document), before);
  }
});

test("rejecting an unverified mixed parent clears only direct Fill relationships and preserves nested own layout", () => {
  const raw = source(borderCases[0]), nested = raw.children[0].children[1];
  Object.assign(nested, { layoutMode: "VERTICAL", paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 });
  nested.children = [{ id: "derived-nested-content", name: "Nested fixed content", type: "RECTANGLE", absoluteBoundingBox: { x: nested.absoluteBoundingBox.x, y: nested.absoluteBoundingBox.y, width: 10, height: 10 } }];
  raw.children[0].children.push({ ...clone(raw.children[0].children[0]), id: "derived-hidden-sibling", visible: false, layoutAlign: "STRETCH", layoutSizingVertical: "FILL" });
  const result = importFigmaJson(raw), document = result.document;
  assert.equal(document.nodes[0].layout, "none");
  assert.equal(document.nodes[2].layout, "vertical");
  assert.equal(document.nodes[2].layoutSizingHorizontal, "fixed");
  assert.equal(document.nodes[3].parentId, document.nodes[2].id);
  assert.equal(document.nodes[2].strokeLayoutExcluded, true, "nested child's own active inside-stroke semantics remain intact");
  assert.ok(document.nodes.filter(node => node.parentId === document.nodes[0].id).every(node =>
    node.layoutSizingHorizontal !== "fill" && node.layoutSizingVertical !== "fill" && node.layoutAlignSelf === undefined));
  assert.ok(result.warnings.some(warning => warning.code === "native-stroke-fill-model"));
});

test("CPU browser matches independent CSS and native-derived SVG/frontend at640 and400 without inactive padding", async () => {
  const evidence = process.env.INACTIVE_FRAME_FILL_EVIDENCE_DIR;
  if (evidence) await mkdir(evidence, { recursive: true });
  const comparisons = [];
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  try {
    for (const entry of borderCases) for (const extent of [640, 400]) {
      const document = importFigmaJson(source(entry)).document, parent = document.nodes[0], horizontal = entry.direction === "HORIZONTAL";
      const offset = { x: parent.x, y: parent.y };
      for (const node of document.nodes) { node.x -= offset.x; node.y -= offset.y; }
      parent[horizontal ? "width" : "height"] = extent;
      document.canvas.width = parent.width; document.canvas.height = parent.height; document.canvas.background = "#ffffff";
      applyAllAutoLayouts(document.nodes);
      const page = await browser.newPage({ viewport: { width: parent.width, height: parent.height }, deviceScaleFactor: 1 });
      try {
        const child = (stroke, color) => `<section style="flex:1 1 0;min-width:0;min-height:0;${horizontal ? "height:100px" : "width:100px"};border:${stroke}px solid #dc2626;background:${color}"></section>`;
        const reference = `<style>*{box-sizing:border-box}html,body{margin:0;background:#fff}main{display:flex;flex-direction:${horizontal ? "row" : "column"};width:${parent.width}px;height:${parent.height}px;padding:8px;gap:12px;align-items:flex-start;background:#f1f5f9}</style><main>${child(4, "#2563eb")}${child(8, "#f97316")}</main>`;
        await page.setContent(reference); const referencePng = await page.screenshot(), expected = PNG.sync.read(referencePng);
        if (evidence) await writeFile(join(evidence, `${entry.direction}-${extent}-reference.png`), referencePng);
        for (const [mode, markup] of [["SVG", `<style>body{margin:0}svg{display:block}</style>${exportDesignSvg(document)}`], ["frontend", exportDesignFrontend(save(document))]]) {
          await page.setContent(markup);
          const png = await page.screenshot(), actual = PNG.sync.read(png);
          if (evidence) await writeFile(join(evidence, `${entry.direction}-${extent}-${mode}.png`), png);
          assert.equal(Buffer.compare(actual.data, expected.data), 0, `${entry.name}/${extent}/${mode}`);
          comparisons.push({ direction: entry.direction, extent, mode, changedPixels: 0, maximumChannelDifference: 0 });
        }
        if (extent === 400) {
          parent[horizontal ? "width" : "height"] = 640;
          applyAllAutoLayouts(document.nodes);
          await page.setContent(exportDesignFrontend(save(document)));
          await page.locator(`[data-codeshell-id="${parent.id}"]`).evaluate((node, dimension) => { node.style[dimension] = "400px"; }, horizontal ? "width" : "height");
          const png = await page.screenshot(), actual = PNG.sync.read(png);
          assert.equal(Buffer.compare(actual.data, expected.data), 0, `${entry.name}/edited-frontend640-to400`);
          comparisons.push({ direction: entry.direction, extent: 400, mode: "edited-frontend640-to400", changedPixels: 0, maximumChannelDifference: 0 });
          if (evidence) await writeFile(join(evidence, `${entry.direction}-edited-frontend.png`), png);
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  if (evidence) await writeFile(join(evidence, "browser-report.json"), JSON.stringify({
    derivedOutputs: true, nativePngAcceptance: false, renderer: "CPU Chromium --disable-gpu DPR1", comparisons,
  }, null, 2) + "\n");
});
