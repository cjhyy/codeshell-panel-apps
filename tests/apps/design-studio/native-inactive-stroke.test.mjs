import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { compareDesignDocuments } from "../../../apps/design-studio/app/design-compare.mjs";
import { clearInvalidStrokeLayoutExclusion } from "../../../apps/design-studio/app/stroke.mjs";
import { GRID_CHILD_FIELDS, GRID_CONTAINER_FIELDS } from "../../../apps/design-studio/app/grid.mjs";
import {
  captureDesignOperationState,
  createDesignOperationRecord,
  applyDesignOperationRecord,
} from "../../../apps/design-studio/app/operation-log.mjs";
import { readFile } from "node:fs/promises";
import {
  importFigmaJson,
  prepareFigmaImport,
  createFigmaTransfer,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
  exportDesignSvg,
} from "../../../apps/design-studio/app/document.mjs";
import {
  createFigmaBinding,
  createFigmaPatch,
} from "../../../apps/design-studio/app/figma-binding.mjs";
import {
  normalizeNativeStrokeInactive,
  nativeInactiveStrokePlan,
  inactiveStrokeWidth,
  editDesignStrokeColor,
  editDesignStrokeWidth,
  editDesignStrokeAlignment,
  applyDesignStrokeEdits,
  validateDesignStroke,
} from "../../../apps/design-studio/app/stroke.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL(
      "../../fixtures/design-studio-native-padded-row-grid/native-source.json",
      import.meta.url,
    ),
  ),
);
const flat = (node) => [node, ...(node.children ?? []).flatMap(flat)];
const id = (source) => `figma-${source.replace(":", "-")}`;
const empty = (properties = {}) => ({
  type: "frame",
  layout: "vertical",
  stroke: "transparent",
  strokeWidth: 0,
  paddingTop: 10,
  paddingRight: 20,
  paddingBottom: 10,
  paddingLeft: 0,
  nativeStrokeInactive: { strokeAlign: "INSIDE", strokeWeight: 1, strokesIncludedInLayout: true },
  ...properties,
});

test("all64 actual empty native styles survive save/transfer/binding without changing67-layer geometry", async () => {
  const result = await prepareFigmaImport(fixture),
    raw = flat(fixture.document),
    document = result.document;
  assert.deepEqual(result.warnings, []);
  const emptyRaw = raw.filter((node) => Array.isArray(node.strokes) && node.strokes.length === 0);
  assert.equal(emptyRaw.length, 64);
  assert.equal(document.nodes.length, 67);
  assert.equal(document.nodes.filter((node) => node.nativeStrokeInactive).length, 64);
  for (const source of emptyRaw) {
    const node = document.nodes.find((n) => n.id === id(source.id)),
      saved = node.nativeStrokeInactive;
    assert.equal(node.stroke, "transparent");
    assert.equal(node.strokeWidth, 0);
    for (const key of [
      "strokeAlign",
      "strokeWeight",
      "individualStrokeWeights",
      "strokesIncludedInLayout",
    ])
      assert.deepEqual(saved[key], source[key], `${source.id}/${key}`);
    if (
      ["HORIZONTAL", "VERTICAL", "GRID"].includes(source.layoutMode) &&
      !Object.hasOwn(source, "strokesIncludedInLayout")
    )
      assert.equal(saved.strokesIncludedInLayoutDefault, false);
    for (const key of ["x", "y", "width", "height"])
      assert.equal(node[key], source.absoluteBoundingBox[key], `${source.id}/${key}`);
  }
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
  assert.deepEqual(
    reopened.nodes.filter((n) => n.nativeStrokeInactive).map((n) => n.nativeStrokeInactive),
    document.nodes.filter((n) => n.nativeStrokeInactive).map((n) => n.nativeStrokeInactive),
  );
  assert.equal(createFigmaPatch(createFigmaBinding(result), reopened).operations.length, 0);
  const transfer = createFigmaTransfer(reopened);
  assert.equal(transfer.stats.exportedNodes, 67);
  assert.deepEqual(transfer.warnings, []);
  assert.equal(
    transfer.pages.flatMap((p) => p.children.flatMap(flat)).filter((n) => n.nativeStrokeInactive)
      .length,
    64,
  );
});

test("empty metadata is strictly typed and never accepts an active/hidden/alpha-zero paint as empty", () => {
  const node = empty();
  for (const bad of [
    {},
    null,
    [],
    { strokeWeight: NaN },
    { strokeWeight: 101 },
    { strokeAlign: "inside" },
    { sourceOnly: true },
    { strokesIncludedInLayoutDefault: true },
    { strokeWeight: 1, extra: 0 },
    { individualStrokeWeights: { top: 1, right: 1, bottom: 1 } },
  ])
    assert.throws(() => normalizeNativeStrokeInactive(bad, node));
  for (const change of [
    { stroke: "#ff0000" },
    { strokeWidth: 1 },
    { strokeSides: [] },
    { strokeAlign: "inside" },
    { type: "ellipse" },
  ])
    assert.throws(() => validateDesignStroke({ ...node, ...change }));
  for (const paint of [
    { type: "SOLID", visible: false, color: { r: 1, g: 0, b: 0 } },
    { type: "SOLID", opacity: 0, color: { r: 1, g: 0, b: 0 } },
  ]) {
    const source = structuredClone(fixture);
    source.document.children = [];
    source.document.children.push({
      id: "2:1",
      type: "TEXT",
      name: "Not empty",
      characters: "Alpha",
      strokes: [paint],
      strokeAlign: "OUTSIDE",
      strokeWeight: 1,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
      style: { fontFamily: "Arial", fontSize: 16, fontWeight: 400, lineHeightPx: 20 },
    });
    const imported = importFigmaJson(source);
    assert.equal(imported.document.nodes[0].nativeStrokeInactive, undefined);
    assert(imported.warnings.some((w) => w.code === "native-inactive-stroke"));
  }
});

test("Frame activation and explicit removal carry native style and add/subtract included INSIDE insets once", () => {
  for (const layout of ["horizontal", "vertical", "none"]) {
    const node = empty({
        layout,
        ...(layout === "none"
          ? { nativeStrokeInactive: { strokeAlign: "INSIDE", strokeWeight: 1 } }
          : {}),
      }),
      original = structuredClone(node);
    editDesignStrokeWidth(node, 3);
    assert.equal(node.strokeWidth, 0);
    assert.equal(inactiveStrokeWidth(node), 3);
    editDesignStrokeColor(node, "#ff0000");
    assert.equal(node.nativeStrokeInactive, undefined);
    assert.equal(node.strokeWidth, 3);
    assert.equal(node.strokeAlign, "inside");
    for (const side of ["Top", "Right", "Bottom", "Left"])
      assert.equal(
        node[`padding${side}`],
        original[`padding${side}`] + (layout === "none" ? 0 : 3),
      );
    editDesignStrokeColor(node, "transparent");
    assert.equal(node.strokeWidth, 0);
    assert.equal(node.stroke, "transparent");
    assert.equal(node.nativeStrokeInactive.strokeWeight, 3);
    for (const side of ["Top", "Right", "Bottom", "Left"])
      assert.equal(node[`padding${side}`], original[`padding${side}`]);
    editDesignStrokeColor(node, "#00ff00");
    assert.equal(node.paddingTop, original.paddingTop + (layout === "none" ? 0 : 3));
  }
  for (const align of ["CENTER", "OUTSIDE"]) {
    const node = empty({
      nativeStrokeInactive: { strokeAlign: align, strokeWeight: 2, strokesIncludedInLayout: false },
    });
    editDesignStrokeColor(node, "#123456");
    assert.equal(node.paddingTop, 10);
    assert.equal(node.strokeAlign, align.toLowerCase());
  }
  const excluded = empty({
    nativeStrokeInactive: {
      strokeAlign: "INSIDE",
      strokeWeight: 2,
      strokesIncludedInLayoutDefault: false,
    },
  });
  editDesignStrokeColor(excluded, "#123456");
  assert.equal(excluded.strokeLayoutExcluded, true);
  assert.equal(excluded.paddingTop, 10);
});

test("unequal widths and explicit final padding stay atomic while unsupported Text/Grid/unknown plans remain unchanged", () => {
  const node = empty({
    nativeStrokeInactive: {
      strokeAlign: "INSIDE",
      individualStrokeWeights: { top: 1, right: 2, bottom: 3, left: 4 },
      strokesIncludedInLayout: true,
    },
  });
  editDesignStrokeColor(node, "#334455");
  assert.deepEqual(
    node.strokeSides.map((s) => s.width),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft],
    [11, 22, 13, 4],
  );
  editDesignStrokeColor(node, "transparent");
  assert.deepEqual(
    [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft],
    [10, 20, 10, 0],
  );
  const explicit = empty();
  applyDesignStrokeEdits(explicit, { stroke: "#123456", paddingTop: 15 });
  assert.equal(explicit.paddingTop, 15);
  for (const target of [
    empty({
      type: "text",
      layout: undefined,
      nativeStrokeInactive: { strokeAlign: "OUTSIDE", strokeWeight: 1 },
    }),
    empty({ nativeStrokeInactive: { strokeWeight: 1 } }),
    empty({ nativeStrokeInactive: { strokeAlign: "INSIDE", strokeWeight: 1 } }),
    empty({
      nativeStrokeInactive: {
        strokeAlign: "CENTER",
        strokeWeight: 1,
        strokesIncludedInLayout: true,
      },
    }),
    empty({ layout: "none" }),
    empty({
      layout: "none",
      nativeStrokeInactive: {
        strokeAlign: "INSIDE",
        strokeWeight: 1,
        strokesIncludedInLayout: false,
      },
    }),
    empty({
      layout: "none",
      nativeStrokeInactive: {
        strokeAlign: "INSIDE",
        strokeWeight: 1,
        strokesIncludedInLayoutDefault: false,
      },
    }),
    empty({ paddingTop: 2000 }),
    empty({ nativeStrokeInactive: { strokeAlign: "INSIDE", strokeWeight: 1, sourceOnly: true } }),
  ]) {
    const before = structuredClone(target);
    assert.throws(() => editDesignStrokeColor(target, "#123456"));
    assert.deepEqual(target, before);
  }
  const text = empty({
    type: "text",
    layout: undefined,
    nativeStrokeInactive: { strokeAlign: "OUTSIDE", strokeWeight: 1 },
  });
  editDesignStrokeAlignment(text, "center");
  editDesignStrokeColor(text, "#123456");
  assert.equal(text.strokeAlign, undefined);
  assert.equal(text.strokeWidth, 1);
  assert.throws(() => nativeInactiveStrokePlan(empty({ layout: "none" })), /自由布局/u);
  for (const flags of [
    { layoutReverse: true },
    { layoutWrap: "wrap-reverse" },
    { layout: "vertical", layoutWrap: "wrap" },
  ])
    assert.throws(
      () => nativeInactiveStrokePlan(empty(flags)),
      /自由布局/u,
      "manual native fallback must not bypass the NONE setter boundary",
    );
});

test("inactive metadata is inert for layout/SVG/frontend and does not reserve invisible stroke space", () => {
  const document = importFigmaJson(fixture).document;
  const reference = structuredClone(document);
  for (const node of reference.nodes) delete node.nativeStrokeInactive;
  applyAllAutoLayouts(document.nodes, { textMeasurer: null });
  applyAllAutoLayouts(reference.nodes, { textMeasurer: null });
  assert.deepEqual(
    document.nodes.map((n) => [n.id, n.x, n.y, n.width, n.height]),
    reference.nodes.map((n) => [n.id, n.x, n.y, n.width, n.height]),
  );
  assert.equal(exportDesignSvg(document), exportDesignSvg(reference));
  assert.equal(exportDesignFrontend(document), exportDesignFrontend(reference));
});

test("published schema and Host tools retain bounded inactive styles while rejecting ambiguous/malformed fields", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js"),
    schema = JSON.parse(
      await readFile(
        new URL(
          "../../../apps/design-studio/app/formats/codeshell-design-v3.schema.json",
          import.meta.url,
        ),
      ),
    );
  const validate = new Ajv2020({ strict: false }).compile(schema),
    saved = JSON.parse(serializeDesignDocument(importFigmaJson(fixture).document));
  assert.equal(validate(saved), true, JSON.stringify(validate.errors));
  const manifest = JSON.parse(
      await readFile(
        new URL("../../../apps/design-studio/.codeshell-panel/panel.json", import.meta.url),
      ),
    ),
    rule = manifest.agent.tools.find((t) => t.name === "use_design").inputSchema;
  const { validateToolArgsStrict } = await import("@cjhyy/code-shell-core");
  for (const metadata of [
    null,
    { strokeWeight: 0, strokeAlign: "OUTSIDE" },
    { strokeWeight: 1, strokesIncludedInLayoutDefault: false },
  ]) {
    const request = {
      expected_state_revision: "inactive-stroke",
      operations: [
        { op: "update_node", node_id: "target", changes: { nativeStrokeInactive: metadata } },
      ],
    };
    assert.equal(validateToolArgsStrict("use_design", request, rule), null);
  }
  for (const metadata of [
    { sourceOnly: true },
    { strokeWeight: 101 },
    { strokeWeight: 1, strokesIncludedInLayoutDefault: true },
    { strokeWeight: 1, strokesIncludedInLayout: false, strokesIncludedInLayoutDefault: false },
  ]) {
    const invalid = structuredClone(saved);
    invalid.pages[0].children[0].nativeStrokeInactive = metadata;
    assert.equal(validate(invalid), false, JSON.stringify(metadata));
    assert.throws(() => normalizeDesignDocument(invalid));
  }
  const lost = structuredClone(saved);
  delete lost.pages[0].children[0].nativeStrokeInactive;
  assert.equal(
    compareDesignDocuments(saved, lost).passed,
    false,
    "unchanged pixels do not hide inactive semantic loss",
  );
});

test("public stroke edits preserve latent intent through real operation-log undo/reopen and reject failed transitions atomically", async () => {
  const app = await readFile(
      new URL("../../../apps/design-studio/app/app.js", import.meta.url),
      "utf8",
    ),
    doc = importFigmaJson(fixture).document;
  const node = doc.nodes.find(
      (n) =>
        n.type === "frame" && n.layout === "vertical" && n.nativeStrokeInactive?.strokeWeight === 1,
    ),
    before = captureDesignOperationState(doc);
  const context = vm.createContext({
    design: doc,
    applyDesignStrokeEdits,
    editDesignStrokeColor,
    editDesignStrokeWidth,
    clearInvalidStrokeLayoutExclusion,
    GRID_CHILD_FIELDS,
    GRID_CONTAINER_FIELDS,
    nodeById: (id) => doc.nodes.find((n) => n.id === id),
    target: node,
  });
  const start = app.indexOf("const AGENT_NODE_PATCH_FIELDS ="),
    end = app.indexOf("const AGENT_OPERATION_FIELDS", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(app.slice(start, end), context);
  const begin = app.indexOf("function applyAgentNodePatch("),
    finish = app.indexOf("function applyAgentDocumentTokens(", begin);
  vm.runInContext(app.slice(begin, finish), context);
  vm.runInContext("applyAgentNodePatch(target,{strokeWidth:3})", context);
  assert.equal(node.strokeWidth, 0);
  assert.equal(node.nativeStrokeInactive.strokeWeight, 3);
  vm.runInContext('applyAgentNodePatch(target,{stroke:"#123456"})', context);
  assert.equal(node.strokeWidth, 3);
  assert.equal(node.nativeStrokeInactive, undefined);
  const active = structuredClone(node),
    record = createDesignOperationRecord(before, captureDesignOperationState(doc));
  applyDesignOperationRecord(doc, record, "reverse");
  assert.equal(doc.nodes.find((n) => n.id === node.id).nativeStrokeInactive.strokeWeight, 1);
  applyDesignOperationRecord(doc, record, "forward");
  assert.deepEqual(
    doc.nodes.find((n) => n.id === node.id),
    active,
  );
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(doc)));
  assert.deepEqual(
    reopened.nodes.find((n) => n.id === node.id).strokeSides.map((s) => s.width),
    [3, 3, 3, 3],
  );
  context.target = doc.nodes.find((n) => n.id === node.id);
  vm.runInContext('applyAgentNodePatch(target,{stroke:"transparent"})', context);
  assert.equal(context.target.nativeStrokeInactive.strokeWeight, 3);
  const snapshot = structuredClone(context.target);
  for (const expression of [
    '{stroke:"not-a-color"}',
    '{stroke:"#123456",paddingTop:-1}',
    '{stroke:"#123456",forbiddenField:1}',
  ]) {
    assert.throws(() => vm.runInContext(`applyAgentNodePatch(target,${expression})`, context));
    assert.deepEqual(context.target, snapshot);
  }
});

test("Grid activation validates assembled descendants without relaxing the proven intrinsic cycle subset", () => {
  const doc = importFigmaJson(fixture).document,
    row = doc.nodes.find((n) => n.layout === "grid" && n.nativeStrokeInactive);
  assert.ok(row);
  const original = structuredClone(row);
  assert.throws(
    () =>
      applyDesignStrokeEdits(
        row,
        { strokeWidth: 1, strokeLayoutExcluded: null, stroke: "#123456" },
        { nodes: doc.nodes, parent: doc.nodes.find((n) => n.id === row.parentId) },
      ),
    /FILL|HUG/u,
  );
  assert.deepEqual(row, original, "a new stroke cannot expand the accepted Grid cycle grammar");
  const cell = doc.nodes.find((n) => n.parentId === row.id && n.type === "frame"),
    cellBefore = structuredClone(cell);
  assert.throws(
    () => editDesignStrokeColor(cell, "#123456", { nodes: doc.nodes, parent: row }),
    /FILL|HUG/u,
  );
  assert.deepEqual(cell, cellBefore, "cell stroke activation must preflight the HUG Grid ancestor");
  const withUnknown = empty({
      nativeStrokeInactive: { strokeAlign: "INSIDE", strokeWeight: 1, sourceOnly: true },
    }),
    snapshot = structuredClone(withUnknown);
  assert.throws(() =>
    applyDesignStrokeEdits(withUnknown, {
      strokeSides: Array(4).fill({ width: 1, color: "#123456", opacity: 1 }),
    }),
  );
  assert.deepEqual(withUnknown, snapshot);
  applyDesignStrokeEdits(withUnknown, {
    nativeStrokeInactive: { strokeAlign: "CENTER", strokeWeight: 2 },
  });
  assert.equal(
    withUnknown.nativeStrokeInactive.sourceOnly,
    true,
    "replacing metadata does not silently clear an unknown native style",
  );
});

test("simultaneous public NONE-to-AutoLayout activation uses final applicability and keeps source raw padding", async () => {
  const app = await readFile(
    new URL("../../../apps/design-studio/app/app.js", import.meta.url),
    "utf8",
  );
  for (const layout of ["horizontal", "vertical"]) {
    const target = empty({
        id: "target",
        layout: "none",
        nativeStrokeInactive: {
          strokeAlign: "INSIDE",
          strokeWeight: 4,
          strokesIncludedInLayout: true,
        },
      }),
      design = { nodes: [target] };
    const context = vm.createContext({
      design,
      target,
      applyDesignStrokeEdits,
      editDesignStrokeColor,
      editDesignStrokeWidth,
      clearInvalidStrokeLayoutExclusion,
      GRID_CHILD_FIELDS,
      GRID_CONTAINER_FIELDS,
      nodeById: () => undefined,
    });
    vm.runInContext(
      app.slice(
        app.indexOf("const AGENT_NODE_PATCH_FIELDS ="),
        app.indexOf("const AGENT_OPERATION_FIELDS"),
      ),
      context,
    );
    vm.runInContext(
      app.slice(
        app.indexOf("function applyAgentNodePatch("),
        app.indexOf("function applyAgentDocumentTokens("),
      ),
      context,
    );
    vm.runInContext(`applyAgentNodePatch(target,{layout:"${layout}",stroke:"#123456"})`, context);
    assert.equal(target.layout, layout);
    assert.deepEqual(
      [target.paddingTop, target.paddingRight, target.paddingBottom, target.paddingLeft],
      [14, 24, 14, 4],
    );
  }
});

test("inactive activation/removal and outer resize retain strict independent CSS/SVG/frontend pixels", async () => {
  const browser = await chromium.launch({ headless: true, args: ["--disable-gpu"] });
  try {
    for (const [align, included] of [
      ["INSIDE", true],
      ["INSIDE", false],
      ["CENTER", false],
      ["OUTSIDE", false],
    ]) {
      const document = importFigmaJson({
        id: "0:1",
        type: "CANVAS",
        name: "Inactive activation",
        children: [
          {
            id: "1:2",
            type: "FRAME",
            name: "Frame",
            layoutMode: "VERTICAL",
            layoutSizingHorizontal: "FIXED",
            layoutSizingVertical: "FIXED",
            strokeAlign: align,
            strokeWeight: 2,
            strokesIncludedInLayout: included,
            strokes: [],
            fills: [{ type: "SOLID", color: { r: 241 / 255, g: 245 / 255, b: 249 / 255 } }],
            paddingTop: 8,
            paddingRight: 8,
            paddingBottom: 8,
            paddingLeft: 8,
            absoluteBoundingBox: { x: 12, y: 12, width: 320, height: 240 },
            children: [
              {
                id: "1:3",
                type: "RECTANGLE",
                name: "Content",
                layoutSizingHorizontal: "FILL",
                layoutSizingVertical: "FIXED",
                absoluteBoundingBox: { x: 20, y: 20, width: 304, height: 40 },
                fills: [{ type: "SOLID", color: { r: 37 / 255, g: 99 / 255, b: 235 / 255 } }],
                strokes: [],
              },
            ],
          },
        ],
      }).document;
      Object.assign(document.canvas, { width: 344, height: 264, background: "#ffffff" });
      const frame = document.nodes[0],
        page = await browser.newPage({
          viewport: { width: 344, height: 264 },
          deviceScaleFactor: 1,
        });
      const stages = [
        () => {},
        () => editDesignStrokeColor(frame, "#dc2626"),
        () => {
          frame.width = 200;
        },
        () => {
          frame.width = 320;
        },
        () => editDesignStrokeColor(frame, "transparent"),
      ];
      for (const [index, edit] of stages.entries()) {
        edit();
        applyAllAutoLayouts(document.nodes);
        const painted = frame.stroke !== "transparent",
          inside = align === "INSIDE",
          width = painted ? 2 : 0,
          pad = 8 - (painted && inside && !included ? 2 : 0),
          factor = align === "OUTSIDE" ? 1 : 0.5;
        await page.setContent(
          `<style>*{box-sizing:border-box}html,body{margin:0;background:white}main{position:absolute;left:12px;top:12px;width:${frame.width}px;height:240px;padding:${pad}px;display:flex;flex-direction:column;background:#f1f5f9;${inside ? `border:${width}px solid #dc2626` : ""}}main::before{content:'';position:absolute;pointer-events:none;inset:${-width * factor}px;border:${!inside ? width : 0}px solid #dc2626}div{height:40px;flex-shrink:0;background:#2563eb}</style><main><div></div></main>`,
        );
        const expected = PNG.sync.read(await page.screenshot()).data,
          bounds = await page.locator("main>div").evaluate((el) => {
            const b = el.getBoundingClientRect();
            return [b.x, b.y, b.width, b.height];
          });
        const child = document.nodes[1];
        assert.deepEqual(
          [child.x, child.y, child.width, child.height],
          bounds,
          `${align}/${included}/${index}/bounds`,
        );
        for (const [mode, markup] of [
          ["SVG", `<style>body{margin:0}svg{display:block}</style>${exportDesignSvg(document)}`],
          ["frontend", exportDesignFrontend(JSON.parse(serializeDesignDocument(document)))],
        ]) {
          await page.setContent(markup);
          assert.equal(
            Buffer.compare(PNG.sync.read(await page.screenshot()).data, expected),
            0,
            `${align}/${included}/${index}/${mode}`,
          );
        }
        const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
        assert.deepEqual(
          reopened.nodes.map((n) => [n.x, n.y, n.width, n.height]),
          document.nodes.map((n) => [n.x, n.y, n.width, n.height]),
        );
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("removal subtracts OLD painted geometry before combined requested latent edits and scalar padding remains explicit", () => {
  const node = empty();
  editDesignStrokeColor(node, "#123456");
  assert.equal(node.paddingTop, 11);
  applyDesignStrokeEdits(node, { stroke: "transparent", strokeWidth: 3, strokeAlign: "outside" });
  assert.equal(node.paddingTop, 10);
  assert.equal(node.nativeStrokeInactive.strokeWeight, 3);
  assert.equal(node.nativeStrokeInactive.strokeAlign, "OUTSIDE");
  const explicit = empty();
  applyDesignStrokeEdits(explicit, { stroke: "#123456", padding: 20 });
  assert.equal(explicit.padding, 20);
  assert.equal(explicit.paddingTop, undefined);
  assert.equal(explicit.paddingLeft, undefined);
  const malformed = empty({
    nativeStrokeInactive: {
      strokeAlign: "INSIDE",
      strokeWeight: 1,
      individualStrokeWeights: { top: 1, right: 2, bottom: 3, left: 4 },
    },
  });
  assert.throws(() => validateDesignStroke(malformed), /混合/u);
});
