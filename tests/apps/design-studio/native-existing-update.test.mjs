import assert from "node:assert/strict";
import { test } from "node:test";
import { createNativeExistingUpdateCapture, isNativeExistingUpdateCapture } from "../../../apps/design-studio/app/figma-plugin/existing-update-runtime.mjs";

function fixture({ changed = ["name"], count = 1 } = {}) {
  const children = Array.from({ length: count }, (_, index) => ({ id: `1:${index + 1}`, type: "RECTANGLE", name: "Before", children: [] }));
  const page = { id: "0:1", type: "PAGE", children }, root = { id: "0:0", type: "DOCUMENT", children: [page] };
  page.parent = root; children.forEach(node => { node.parent = page; });
  const target = children[0], patch = { operations: [{ op: "update", sourceId: target.id, designId: "node-1", changed,
    baseline: { type: "rectangle", opacity: 1 }, after: { type: "rectangle", name: "After", opacity: 0.5, notes: "New note", fill: "#0000ff" } }] };
  return { target, page, root, patch, capture: () => createNativeExistingUpdateCapture({ patch, mixed: Symbol("mixed") }) };
}

test("existing update classifier has an exact private brand and excludes structural or unsupported mixed operations", () => {
  const f = fixture(), capture = f.capture(); assert(isNativeExistingUpdateCapture(capture, f.patch));
  assert(!isNativeExistingUpdateCapture({ prepared: true }, f.patch)); assert(!isNativeExistingUpdateCapture(capture, structuredClone(f.patch)));
  for (const key of ["width", "parentId", "pageId", "siblingIndex", "layout", "imageRef", "shadow", "fontRef"]) {
    const g = fixture({ changed: ["notes", key] }); assert.equal(g.capture(), null, key);
  }
  assert.equal(fixture({ changed: ["notes"] }).capture(), null, "Notes-only branch remains separate");
  for (const op of ["create", "delete", "create-page", "delete-page", "rename-page"]) {
    const g = fixture(); g.patch.operations[0].op = op; assert.equal(g.capture(), null, op);
  }
});

test("complete own REST projection rejects hooks without invoking them and keeps untouched subtree outside repeated serialization", () => {
  const f = fixture(), capture = f.capture(); capture.captureTarget(f.target.id, f.target); let calls = 0;
  const raw = { id: f.target.id, type: "RECTANGLE" }; Object.defineProperty(raw, "name", { enumerable: true, get() { calls++; return "Before"; } });
  assert.throws(() => capture.corroborateOwnRest(f.target.id, raw)); assert.equal(calls, 0);
  const valid = { id: f.target.id, type: "RECTANGLE", name: "Before" }; Object.defineProperty(valid, "children", { get() { calls++; throw Error("unrelated subtree"); } });
  capture.corroborateOwnRest(f.target.id, valid); assert.equal(calls, 0); capture.assertCurrent();
  const prepared = capture.compile({}); for (const mutate of prepared.mutations) mutate(); prepared.assertApplied(); assert.equal(f.target.name, "After");
});

test("existing update context refuses cycles duplicates malformed identity and bounded repeated work", () => {
  for (const kind of ["cycle", "duplicate", "bad-id", "non-array"]) {
    const f = fixture(); if (kind === "cycle") f.root.parent = f.page;
    if (kind === "duplicate") f.page.children.push(f.target);
    if (kind === "bad-id") f.page.id = "x".repeat(161);
    if (kind === "non-array") f.page.children = { 0: f.target, length: 1 };
    assert.throws(() => f.capture().captureTarget(f.target.id, f.target), undefined, kind);
  }
  const f = fixture({ count: 10000 }), capture = f.capture(); capture.captureTarget(f.target.id, f.target);
  capture.corroborateOwnRest(f.target.id, { id: f.target.id, type: "RECTANGLE", name: "Before" });
  assert.throws(() => { for (let i = 0; i < 25; i++) capture.assertCurrent(); }, error => error.code === "NATIVE_UPDATE_WORK_BUDGET");
});

test("native update observation and SOLID replacement budgets reject unknown data before mutation", () => {
  const f = fixture(); f.target.name = "n".repeat(256 * 1024);
  assert.throws(() => f.capture().captureTarget(f.target.id, f.target), error => error.code === "NATIVE_UPDATE_BUDGET");
  for (const kind of ["unknown-paint", "missing-style", "variables"]) {
    const g = fixture({ changed: ["fill"] }); Object.assign(g.target, { fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
      fillStyleId: "", boundVariables: {}, getPluginData: () => "" });
    if (kind === "unknown-paint") g.target.fills[0].futurePaint = true;
    if (kind === "missing-style") delete g.target.fillStyleId;
    if (kind === "variables") g.target.boundVariables = { opacity: { id: "var:1" } };
    assert.throws(() => g.capture().captureTarget(g.target.id, g.target), undefined, kind);
  }
});
