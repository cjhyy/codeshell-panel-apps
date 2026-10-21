import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeNativeNotesSupplement, nativeNotesObservation, nativeNotesPatchBaseline,
  validateNativeNotesOwners } from "../../../apps/design-studio/app/native-notes.mjs";
import { createNativeNotesExportCapture, createNativeNotesPatchCapture } from "../../../apps/design-studio/app/figma-plugin/notes-runtime.mjs";

const pluginId = "test-codeshell-notes", clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const document = { id: "0:0", type: "DOCUMENT", parent: null, children: [] };
  const page = { id: "0:1", type: "PAGE", parent: document, children: [], getPluginData: () => "" };
  document.children.push(page);
  let value = "req-signin", childValue = "unmapped requirement", writes = 0;
  const child = { id: "1:3", type: "VECTOR", children: [], getPluginData: () => childValue };
  const target = { id: "1:2", type: "FRAME", parent: page, children: [child], getPluginData: () => value,
    setPluginData() { writes++; } };
  child.parent = target; page.children.push(target);
  const raw = { id: "0:1", type: "CANVAS", children: [{ id: "1:2", type: "FRAME", children: [{ id: "1:3", type: "VECTOR" }] }] };
  return { document, page, target, child, raw, set: text => { value = text; }, setChild: text => { childValue = text; }, writes: () => writes };
}
const capture = f => {
  const value = createNativeNotesExportCapture({ roots: [f.page], pluginId });
  value.add(f.raw, f.page); return value;
};
const code = expected => error => error.code === expected;

test("native notes are exact inert strings with explicit observed absence", () => {
  const text = " " + String.fromCodePoint(0x1f600) + String.fromCharCode(13, 10) + "req-signin ";
  assert.deepEqual(nativeNotesObservation(text, pluginId), { kind: "value", value: text });
  assert.deepEqual(nativeNotesObservation("", pluginId), { kind: "absent" });
  assert.deepEqual(nativeNotesObservation(" ", pluginId), { kind: "value", value: " " });
  const f = fixture(), before = JSON.stringify(f.raw), result = capture(f).finalize();
  assert.equal(result.nodes["1:2"].notes.value, "req-signin");
  assert.deepEqual(result.nodes["0:1"].notes, { kind: "absent" });
  assert.equal(result.nodes["1:3"].notes.value, "unmapped requirement");
  assert.equal(JSON.stringify(f.raw), before); assert.equal(f.writes(), 0);
  assert.equal(Object.hasOwn(result, "nativeTextRanges"), false);
});

test("notes normalization rejects hooks, malformed absence and orphan owners without invoking data", () => {
  let reads = 0; const accessor = {};
  Object.defineProperty(accessor, "version", { enumerable: true, get() { reads++; return 1; } });
  assert.throws(() => normalizeNativeNotesSupplement(accessor)); assert.equal(reads, 0);
  const f = fixture(), good = capture(f).finalize();
  for (const mutate of [value => value.nodes["1:2"].notes.value = "",
    value => value.nodes["0:1"].notes.value = "invented empty presence",
    value => value.nodes["1:2"].ownMixedPreview = true,
    value => value.pluginId = ""]) {
    const invalid = clone(good); mutate(invalid);
    assert.throws(() => normalizeNativeNotesSupplement(invalid));
  }
  assert.throws(() => validateNativeNotesOwners(good, new Map()), code("NATIVE_NOTES_OWNER"));
  assert.throws(() => validateNativeNotesOwners(good, new Map(Object.entries(good.nodes).map(([id]) => [id, { type: "TEXT" }]))), code("NATIVE_NOTES_OWNER"));
});

test("UTF16 notes and exact whole-envelope budgets do not truncate Unicode or escaped content", () => {
  assert.equal(nativeNotesObservation(String.fromCodePoint(0x1f600).repeat(1000), pluginId).value.length, 2000);
  assert.throws(() => nativeNotesObservation(String.fromCodePoint(0x1f600).repeat(1001), pluginId), code("NATIVE_NOTES_VALUE"));
  const control = String.fromCharCode(0).repeat(2000);
  const bounded = normalizeNativeNotesSupplement({ version: 1, pluginId, nodes: { "1:2": { type: "TEXT", notes: { kind: "value", value: control } } } });
  assert.equal(bounded.nodes["1:2"].notes.value, control);
  const nodes = {}; for (let index = 0; index < 3000; index++) nodes["note-" + index] = {
    type: "TEXT", notes: { kind: "value", value: String.fromCodePoint(0x9700).repeat(2000) } };
  assert.throws(() => normalizeNativeNotesSupplement({ version: 1, pluginId, nodes }));
});

test("final export refuses notes mutation, removal, same-ID replacement, movement and contradictory overlap", async () => {
  for (const mutate of [f => f.set("changed"), f => { f.target.removed = true; },
    f => { f.page.children[0] = { ...f.target }; }, f => { f.target.parent = f.document; },
    f => { f.child.id = "changed"; }]) {
    const f = fixture(), staged = capture(f); await Promise.resolve(); mutate(f);
    assert.throws(() => staged.finalize()); assert.equal(f.writes(), 0);
  }
  const f = fixture(), staged = capture(f); const changed = clone(f.raw.children[0]); changed.future = "different";
  assert.throws(() => staged.add(changed, f.target), code("NATIVE_NOTES_OVERLAP"));
});

function patchFixture() {
  const f = fixture(), nativeNotes = capture(f).finalize();
  const operation = { op: "update", sourceId: "1:2", designId: "frame", changed: ["notes"],
    before: clone(f.raw.children[0]), after: { notes: "replacement" } };
  const patch = { operations: [operation], nativeNotesBefore: nativeNotesPatchBaseline({ nativeNotes }, [operation]) };
  const indexes = { mapping: new Map([["frame", { sourceId: "1:2" }]]), baseline: new Map([["frame", { pageId: "page" }]]), sourceIds: new Map(),
    pageMappings: new Map([["page", { sourceId: "0:1" }]]) };
  return { ...f, patch, indexes };
}

test("fresh patch metadata includes unmapped descendants and refuses missing or mixed async plans", () => {
  const f = patchFixture(); assert.equal(f.patch.nativeNotesBefore.nodes["1:3"].notes.value, "unmapped requirement");
  assert.throws(() => nativeNotesPatchBaseline({}, f.patch.operations), code("NATIVE_NOTES_BASELINE_REQUIRED"));
  const missing = clone(f.patch); delete missing.nativeNotesBefore.nodes["1:3"];
  assert.throws(() => createNativeNotesPatchCapture({ patch: missing, indexes: f.indexes, pluginId }), code("NATIVE_NOTES_PATCH_BASELINE"));
  const mixed = clone(f.patch); mixed.operations.push({ op: "create" });
  assert.throws(() => createNativeNotesPatchCapture({ patch: mixed, indexes: f.indexes, pluginId }), code("NATIVE_NOTES_ASYNC_PATCH"));
});

test("notes patch rechecks exact target/subtree after the last await with zero writes on conflict", async () => {
  for (const mutate of [f => f.set("foreign change"), f => f.setChild("foreign unmapped change"),
    f => { f.page.children[0] = { ...f.target }; }, f => { f.target.children[0] = { ...f.child }; }]) {
    const f = patchFixture(), staged = createNativeNotesPatchCapture({ patch: f.patch, indexes: f.indexes, pluginId });
    staged.captureTarget("1:2", f.target); await Promise.resolve(); mutate(f);
    assert.throws(() => staged.assertCurrent()); assert.equal(f.writes(), 0);
  }
  const f = patchFixture(), staged = createNativeNotesPatchCapture({ patch: f.patch, indexes: f.indexes, pluginId });
  staged.captureTarget("1:2", f.target); await Promise.resolve(); staged.assertCurrent(); assert.equal(f.writes(), 0);
});

test("maximum bounded source catalog retains all50000 observations with cached sibling identities", () => {
  const document = { id: "0:0", type: "DOCUMENT", parent: null, children: [] };
  const page = { id: "0:1", type: "PAGE", parent: document, children: [], getPluginData: () => "" };
  document.children.push(page);
  const children = [];
  for (let index = 1; index < 50000; index++) {
    const id = "1:" + index;
    page.children.push({ id, type: "RECTANGLE", parent: page, getPluginData: () => "" });
    children.push({ id, type: "RECTANGLE" });
  }
  const capture = createNativeNotesExportCapture({ roots: [page], pluginId });
  capture.add({ id: page.id, type: "CANVAS", children }, page);
  const source = capture.finalize();
  assert.equal(Object.keys(source.nodes).length, 50000);
  assert.deepEqual(source.nodes["1:49999"].notes, { kind: "absent" });
});
