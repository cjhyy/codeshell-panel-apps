import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAutoLayout, applyAutoLayouts, applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";

const infinite = { mode: "infinite", width: 800, height: 600, background: "#e8e8e8" };
const node = (id, type, extra = {}) => ({ id, type, name: id, x: -350000, y: 450000,
  width: 100, height: 40, fill: "#000000", stroke: "transparent", strokeWidth: 0,
  opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false, ...extra });
const copy = (y = 450000) => node("text", "text", { y, text: "Baseline", fontSize: 20,
  fontWeight: 400, fontFamily: "Arial", lineHeight: 1.2, textAlign: "left",
  layoutBaselineSource: "native", layoutBaselineOffset: 2 });
const measurement = { configure() {}, lineBoxOffset: () => 4 };

for (const y of [-450000, 450000]) test(`infinite baseline refresh retains world coordinates at y=${y}`, () => {
  const text = copy(y);
  assert.equal(applyAllAutoLayouts([text], { canvas: infinite, textMeasurer: measurement }), true);
  assert.equal(text.y, y + 2);
  assert.equal(text.layoutBaselineOffset, 4);
  assert.equal(text.y - text.layoutBaselineOffset, y - 2);
  assert.equal(applyAutoLayouts([text], [], { canvas: infinite, textMeasurer: measurement }), false);
});

test("single-container layout passes the infinite budget through its text refresh", () => {
  const text = copy(450012);
  text.parentId = "frame";
  const frame = node("frame", "frame", { x: -350010, y: 450000, width: 300, height: 200,
    layout: "vertical", gap: 0, padding: 10, alignItems: "start", justifyContent: "start" });
  assert.equal(applyAutoLayout([frame, text], frame.id, { canvas: infinite, textMeasurer: measurement }), true);
  assert.equal(text.y, 450014);
  assert.equal(text.layoutBaselineOffset, 4);
});

test("baseline refresh keeps the bounded default and rejects an infinite coordinate overflow", () => {
  const bounded = copy(20000);
  assert.throws(() => applyAllAutoLayouts([bounded], { textMeasurer: measurement }), /坐标范围/u);
  assert.equal(bounded.y, 20000);
  const edge = copy(1000000);
  assert.throws(() => applyAllAutoLayouts([edge], { canvas: infinite, textMeasurer: measurement }), /坐标范围/u);
  assert.equal(edge.y, 1000000);
});
