import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { createHash } from "node:crypto";
import { createPortableDesign, planPortableDesign } from "../../../apps/design-studio/app/portable-backup.mjs";
import { createDesignResourcePersistencePlan } from "../../../apps/design-studio/app/resource-store.mjs";
import { cssCornerRadii, effectiveCornerRadii, insideRoundedRect } from "../../../apps/design-studio/app/corner-radii.mjs";
import { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { designNodeToV3 } from "../../../apps/design-studio/app/design-node-adapter.mjs";
import { importFigmaJson, createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { hitTestCanvasNode } from "../../../apps/design-studio/app/canvas-interaction.mjs";

const shape = (extra = {}) => ({ id: "shape", type: "rectangle", name: "shape", x: 20, y: 20, width: 160, height: 100, fill: "#2563eb", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false, ...extra });
const documentFor = (node) => ({ format: "codeshell.design", version: 3, name: "Corners", canvas: { width: 240, height: 160, background: "#ffffff" }, tokens: { colors: [] }, resources: [], activePageId: "page", pages: [{ id: "page", name: "page", children: [node] }] });
const runtime = await readFile(new URL("../../../apps/design-studio/app/vendor/html2figma-browser.mjs", import.meta.url), "utf8");
const source = `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:#fff}#fixture{display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;align-content:flex-start;gap:20px;padding:20px;width:100%;height:300px;background:#e2e8f0}#clip{position:relative;height:100px;flex-shrink:0;border-radius:8px 24px 0 16px;background:#2563eb;overflow:hidden}#ink{position:absolute;left:0;top:0;width:700px;height:36px;background:#f97316}#plain{height:100px;flex-shrink:0;border-radius:0 12px 28px 4px;background:#059669}</style><main id="fixture"><div id="clip"><div id="ink"></div></div><div id="plain"></div></main>`;

test("four circular radii validate, survive save/transfer and use common CSS overlap scaling", () => {
  assert.deepEqual(cssCornerRadii(["8px", "24px 24px", "0px", "16px"]), [8, 24, 0, 16]);
  for (const value of ["50%", "10px 20px", "calc(5px + 1%)", "-2px", "10"]) assert.throws(() => cssCornerRadii([value, "0px", "0px", "0px"]));
  const doc = normalizeDesignDocument(documentFor(shape({ cornerRadii: [80, 40, 0, 20], width: 100, height: 70 })));
  assert.deepEqual(effectiveCornerRadii(doc.nodes[0]), [56, 28, 0, 14]);
  assert.deepEqual(normalizeDesignDocument(JSON.parse(serializeDesignDocument(doc))).nodes[0].cornerRadii, [80, 40, 0, 20]);
  assert.deepEqual(createFigmaTransfer(doc).pages[0].children[0].cornerRadii, [80, 40, 0, 20]);
  assert.ok(createFigmaTransfer(doc).warnings.some((warning) => warning.code === "corner-overlap-export"));
  // Actual native Figma retains a lone 80px corner on a 100px square. The
  // representability warning concerns adjacent overlap, not half-edge size.
  const lone = normalizeDesignDocument(documentFor(shape({ width: 100, height: 100, cornerRadii: [80, 0, 0, 0] })));
  assert.ok(!createFigmaTransfer(lone).warnings.some((warning) => warning.code === "corner-overlap-export"));
  const overlapping = normalizeDesignDocument(documentFor(shape({ width: 100, height: 100, cornerRadii: [80, 80, 20, 0] })));
  assert.deepEqual(effectiveCornerRadii(overlapping.nodes[0]), [50, 50, 12.5, 0]);
  assert.ok(createFigmaTransfer(overlapping).warnings.some((warning) => warning.code === "corner-overlap-export"));
  for (const radii of [Array(4), [1, 2, 3], [1, 2, 3, 4, 5], [0, -1, 0, 0], [0, Infinity, 0, 0], [0, 10000, 0, 0]])
    assert.throws(() => normalizeDesignDocument(documentFor(shape({ cornerRadii: radii }))));
  for (const type of ["text", "ellipse", "group", "instance"])
    assert.throws(() => normalizeDesignDocument(documentFor(shape({ type, cornerRadii: [1, 2, 3, 4] }))));
});

test("Figma independent circular corners import without the old uniform approximation warning", () => {
  const result = importFigmaJson({ id: "1:1", type: "RECTANGLE", name: "Corners", absoluteBoundingBox: { x: 0, y: 0, width: 160, height: 100 }, rectangleCornerRadii: [8, 24, 0, 16] });
  assert.deepEqual(result.document.nodes[0].cornerRadii, [8, 24, 0, 16]);
  assert.ok(!result.warnings.some((warning) => warning.code === "corner-shape"));
  const rounded = shape({ cornerRadii: [24, 0, 0, 0] });
  assert.equal(insideRoundedRect(rounded, { x: 20, y: 20 }), false);
  assert.equal(insideRoundedRect(rounded, { x: 180, y: 20 }), true);
  assert.equal(hitTestCanvasNode({ nodes: [rounded] }, { x: 20, y: 20 }), null);
  assert.equal(hitTestCanvasNode({ nodes: [rounded] }, { x: 179, y: 21 }).id, "shape");
});

test("real HTML asymmetric shapes and clipped child stay editable through resize, save, SVG and CSS", async (t) => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 640, height: 300 } });
  await page.setContent(source);
  const capture = () => page.evaluate(async (runtime) => {
    const api = await import(URL.createObjectURL(new Blob([runtime], { type: "text/javascript" })));
    return api.convertToDesignDSL(document.querySelector("#fixture"));
  }, runtime);
  const result = await designNodeToV3(await capture());
  assert.deepEqual(result.report.warnings, []);
  const state = normalizeDesignDocument(result.document), root = state.nodes[0];
  assert.deepEqual(state.nodes.find((node) => node.name === "div#clip").cornerRadii, [8, 24, 0, 16]);
  assert.equal(root.layout, "vertical");
  for (const width of [640, 400]) {
    await page.setViewportSize({ width, height: 300 });
    const expected = PNG.sync.read(await page.screenshot());
    root.width = width; state.canvas.width = width; applyAllAutoLayouts(state.nodes);
    const repository = JSON.parse(serializeDesignDocument(state));
    const saved = normalizeDesignDocument(repository);
    for (const [kind, output] of [["CSS", exportDesignFrontend(repository)], ["SVG", exportDesignSvg(saved)]]) {
      const rendered = await browser.newPage({ viewport: { width, height: 300 } });
      await rendered.setContent(kind === "SVG" ? `<style>body{margin:0}</style>${output}` : output);
      const pixels = PNG.sync.read(await rendered.screenshot()).data;
      const different = pixels.reduce((count, byte, index) => count + (byte !== expected.data[index] ? 1 : 0), 0);
      assert.equal(different, 0, `${width}px ${kind} differing channels`);
      await rendered.close();
    }
  }
  for (const radius of ["50%", "10px 20px"]) {
    await page.locator("#clip").evaluate((element, radius) => element.style.borderTopLeftRadius = radius, radius);
    const unsupported = await designNodeToV3(await capture());
    assert.ok(unsupported.report.warnings.some((warning) => warning.code === "unsupported-corner-radii"));
    assert.equal(normalizeDesignDocument(unsupported.document).nodes.find((node) => node.name === "div#clip").cornerRadius, 0);
  }
});


test("published schema and Host changes agree on bounded per-corner tuples", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const schema = JSON.parse(await readFile(new URL("../../../apps/design-studio/app/formats/codeshell-design-v3.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const doc = documentFor(shape({ cornerRadii: [8, 24, 0, 16] }));
  assert.ok(validate(doc), JSON.stringify(validate.errors));
  for (const type of ["text", "ellipse", "group", "instance"]) {
    const candidate = structuredClone(doc); candidate.pages[0].children[0].type = type;
    assert.equal(validate(candidate), false, type);
  }
  for (const radii of [[1, 2, 3], [1, 2, 3, 4, 5], [0, -1, 0, 0], [0, 10000, 0, 0]]) {
    const candidate = structuredClone(doc); candidate.pages[0].children[0].cornerRadii = radii;
    assert.equal(validate(candidate), false);
  }
  const manifest = JSON.parse(await readFile(new URL("../../../apps/design-studio/.codeshell-panel/panel.json", import.meta.url), "utf8"));
  const tool = manifest.agent.tools.find((entry) => entry.name === "use_design");
  const { validateToolArgsStrict } = await import("@cjhyy/code-shell-core");
  const request = { expected_state_revision: "corners", operations: [{ op: "update_node", node_id: "shape", changes: { cornerRadii: [8, 24, 0, 16] } }] };
  assert.equal(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
  request.operations[0].changes.cornerRadii = [1, 2, 3];
  assert.ok(validateToolArgsStrict("use_design", request, tool.inputSchema));
  request.operations[0].changes.cornerRadii = null;
  assert.equal(validateToolArgsStrict("use_design", request, tool.inputSchema), null);
  const hash = async (bytes) => createHash("sha256").update(bytes).digest("hex");
  const portable = await createPortableDesign({ document: normalizeDesignDocument(doc), source: { workspaceRoot: "/fixture", sessionId: "fixture", path: "designs/corners.codesign.json" }, sha256Bytes: hash });
  const plan = await planPortableDesign(portable, { sha256: hash, sha256Bytes: hash });
  assert.deepEqual(JSON.parse(plan.primarySource).pages[0].children[0].cornerRadii, [8, 24, 0, 16]);
});

test("rounded SVG image self-clipping retains its external shadow", async (t) => {
  const image = new PNG({ width: 1, height: 1 }); image.data.set([255, 0, 0, 255]);
  const dataUrl = `data:image/png;base64,${PNG.sync.write(image).toString("base64")}`;
  const hash = async (bytes) => createHash("sha256").update(bytes).digest("hex");
  const resource = await createDesignResourcePersistencePlan({ id: "image", kind: "image", mime: "image/png", base64: dataUrl.split(",")[1], sha256Bytes: hash });
  const repository = documentFor(shape({ type: "image", imageRef: "image", objectFit: "fill", fill: "transparent", cornerRadii: [24, 0, 16, 0], shadow: { color: "#000000", opacity: 1, x: 20, y: 0, blur: 0 } }));
  repository.resources = [resource.descriptor];
  const state = normalizeDesignDocument(repository);
  const svg = exportDesignSvg(state, { resourceDataUrls: new Map([["image", dataUrl]]) });
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 240, height: 160 } });
  await page.setContent(`<style>body{margin:0}</style>${svg}`);
  const pixels = PNG.sync.read(await page.screenshot());
  const rgb = (x, y) => [...pixels.data.subarray((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 3)];
  assert.deepEqual(rgb(190, 70), [0, 0, 0], "shadow outside image bounds survives own clip");
  assert.deepEqual(rgb(21, 21), [255, 255, 255], "asymmetric corner clips image pixels");
  assert.deepEqual(rgb(178, 21), [255, 0, 0], "square corner keeps image pixels");
});


test("nonuniform CSS scaling diagnoses elliptical corners instead of averaging their radii", async () => {
  const result = await designNodeToV3({ nodeType: "container", name: "Scaled", bounds: { x: 0, y: 0, width: 160, height: 100 }, visible: true, opacity: 1, positioning: { mode: "static" }, layout: { display: "block" }, transform: { scale: { x: 2, y: 1 } }, border: { radius: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 } }, children: [] });
  assert.ok(result.report.warnings.some((warning) => warning.code === "unsupported-corner-radii"));
  assert.equal(normalizeDesignDocument(result.document).nodes[0].cornerRadius, 0);
});
