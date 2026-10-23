import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { normalizeFigmaSource } from "../../../apps/design-studio/app/figma-assets.mjs";
import { importFigmaJson, prepareFigmaImport, createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { createFigmaBinding, createFigmaPatch, registerFigmaBinding, readFigmaBinding } from "../../../apps/design-studio/app/figma-binding.mjs";
import { serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";

const clone = value => JSON.parse(JSON.stringify(value));
const sha256Bytes = async bytes => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  return { format: "codeshell.figma.source", version: 1, nodes: { "0:1": { document: {
    id: "0:1", type: "CANVAS", name: "Notes", children: [{ id: "1:2", type: "RECTANGLE", name: "Card",
      absoluteBoundingBox: { x: 1.2345678901234567, y: 2, width: 100, height: 50 },
      pluginData: { foreign: { codeshellNotes: "arbitrary raw data", proof: "never authority" } },
      futureRaw: { keep: [0.0000001, "opaque", { exact: true }] } }] } } }, assets: {}, previews: {},
    nativeNotes: { version: 1, pluginId: "fixture-codeshell-notes", nodes: {
      "0:1": { type: "CANVAS", notes: { kind: "absent" } },
      "1:2": { type: "RECTANGLE", notes: { kind: "value", value: "req-signin" } } } } };
}

test("owned notes envelope imports exact ordinary strings and retains every raw official field through binding/reopen", async () => {
  for (const value of ["req-signin", " ", String.fromCodePoint(0xa0) + "req-profile", "<script>fake()</script>",
    JSON.stringify({ nativeTextRanges: { authorized: true }, ownMixedPreview: true, nativeWrite: true })]) {
    const source = fixture(); source.nativeNotes.nodes["1:2"].notes.value = value;
    const raw = JSON.stringify(source.nodes), normalized = normalizeFigmaSource(source);
    assert.equal(JSON.stringify(normalized.nodes), raw);
    const imported = await prepareFigmaImport(normalized, { sha256Bytes });
    assert.equal(imported.document.nodes[0].notes, value);
    assert.equal(imported.document.nodes[0].textRanges, undefined);
    assert.equal(JSON.stringify(createFigmaBinding(imported).source.nodes), raw);
    const reopened = JSON.parse(serializeDesignDocument(JSON.parse(serializeDesignDocument(imported.document))));
    assert.equal(reopened.pages[0].children[0].notes, value);
    assert.equal(createFigmaTransfer(reopened).pages[0].children[0].notes, value);
  }
});

test("observed absence and legacy missing metadata do not invent canonical empty-string presence", () => {
  const absent = fixture(); absent.nativeNotes.nodes["1:2"].notes = { kind: "absent" };
  assert.equal(Object.hasOwn(importFigmaJson(absent).document.nodes[0], "notes"), false);
  const legacy = fixture(); delete legacy.nativeNotes;
  legacy.nodes["0:1"].document.children[0].pluginData.codeshellNotes = "spoofed req-admin";
  assert.equal(Object.hasOwn(importFigmaJson(legacy).document.nodes[0], "notes"), false);
  const empty = fixture(); empty.nativeNotes.nodes["1:2"].notes.value = "";
  assert.throws(() => normalizeFigmaSource(empty), error => error.code === "NATIVE_NOTES_ENTRY");
});

test("direct source import and outer normalization refuse notes accessors/toJSON before execution", () => {
  for (const entry of [normalizeFigmaSource, importFigmaJson]) {
    let reads = 0; const accessor = fixture(); delete accessor.nativeNotes;
    Object.defineProperty(accessor, "nativeNotes", { enumerable: true, get() { reads++; return fixture().nativeNotes; } });
    assert.throws(() => entry(accessor)); assert.equal(reads, 0);
    const hidden = fixture(); hidden.nativeNotes.toJSON = () => { reads++; return {}; };
    assert.throws(() => entry(hidden)); assert.equal(reads, 0);
  }
});

test("notes source owner validation compares full unknown raw data and duplicate parent/order", () => {
  for (const mutate of [source => source.nativeNotes.nodes["1:2"].type = "TEXT",
    source => source.nativeNotes.nodes["absent"] = { type: "FRAME", notes: { kind: "absent" } },
    source => { source.nodes["1:2"] = { document: clone(source.nodes["0:1"].document.children[0]) }; source.nodes["1:2"].document.futureRaw.keep[0] = 0.0000002; },
    source => { const node = clone(source.nodes["0:1"].document.children[0]); source.nodes["0:1"].document.children.push(node); }]) {
    const source = fixture(); mutate(source); assert.throws(() => normalizeFigmaSource(source));
  }
  const overlap = fixture(); overlap.nodes["1:2"] = { document: clone(overlap.nodes["0:1"].document.children[0]) };
  assert.equal(normalizeFigmaSource(overlap).nativeNotes.nodes["1:2"].notes.value, "req-signin");
  assert.throws(() => importFigmaJson(overlap), /分别导出页面与选中的图层/u,
    "the existing mixed page/selection import boundary remains closed");
});

test("combined notes/raw envelope observes exact UTF8 budget on object and serialized public routes", () => {
  const source = fixture(); source.nodes["0:1"].document.futurePayload = "x".repeat(15 * 1024 * 1024);
  for (let index = 0; index < 300; index++) {
    const id = "note-" + index;
    source.nodes["0:1"].document.children.push({ id, type: "RECTANGLE" });
    source.nativeNotes.nodes[id] = { type: "RECTANGLE", notes: { kind: "value", value: String.fromCodePoint(0x9700).repeat(2000) } };
  }
  assert(Buffer.byteLength(JSON.stringify(source)) > 16 * 1024 * 1024);
  for (const input of [source, JSON.stringify(source)]) {
    assert.throws(() => normalizeFigmaSource(input)); assert.throws(() => importFigmaJson(input));
  }
});

test("local source binding save/reopen retains the explicit notes baseline and complete child catalog", async () => {
  const imported = await prepareFigmaImport(fixture(), { sha256Bytes }), binding = createFigmaBinding(imported);
  const sourceContent = serializeDesignDocument(imported.document), files = new Map(); let serial = 0;
  const call = async (method, params) => {
    const previous = files.get(params.path);
    if (method === "workspace.readText") {
      if (!previous) throw Object.assign(Error("missing"), { code: "ENOENT" });
      return previous;
    }
    assert.equal(method, "workspace.writeText");
    if (params.expectedModifiedAt === null && previous || params.expectedRevision && params.expectedRevision !== previous?.revision)
      throw Error("conflict");
    const saved = { content: params.content, revision: "v" + ++serial, modifiedAt: serial }; files.set(params.path, saved); return saved;
  };
  const options = { path: "designs/notes.codesign.json", sourceContent, call, check() {}, sha256: sha256Bytes };
  await registerFigmaBinding({ ...options, binding });
  const reopened = await readFigmaBinding(options);
  assert.deepEqual(reopened.source.nativeNotes, binding.source.nativeNotes);
  assert.equal(reopened.baseline.pages[0].children[0].notes, "req-signin");
  const current = JSON.parse(sourceContent); current.pages[0].children[0].notes = "req-profile";
  const patch = createFigmaPatch(reopened, current);
  assert.equal(patch.nativeNotesBefore.nodes["1:2"].notes.value, "req-signin");
  assert.deepEqual(patch.nativeNotesBefore.nodes["1:2"].children, []);
  assert.equal(patch.operations[0].before.nativeNotes, undefined);
});

test("explicit raw own-plugin notes are consistency-only and cannot contradict or supply observations", () => {
  const source = fixture(), raw = source.nodes["0:1"].document.children[0];
  raw.pluginData[source.nativeNotes.pluginId] = { codeshellNotes: "req-signin", opaque: "retained" };
  assert.equal(normalizeFigmaSource(source).nativeNotes.nodes["1:2"].notes.value, "req-signin");
  raw.pluginData[source.nativeNotes.pluginId].codeshellNotes = "different raw note";
  assert.throws(() => normalizeFigmaSource(source), error => error.code === "NATIVE_NOTES_RAW_CONFLICT");
  const absent = clone(source); absent.nativeNotes.nodes["1:2"].notes = { kind: "absent" };
  assert.throws(() => importFigmaJson(absent), error => error.code === "NATIVE_NOTES_RAW_CONFLICT");
  delete raw.pluginData[source.nativeNotes.pluginId].codeshellNotes;
  assert.equal(importFigmaJson(source).document.nodes[0].notes, "req-signin", "a missing raw key does not infer absence");
  const legacy = clone(source); delete legacy.nativeNotes;
  raw.pluginData[source.nativeNotes.pluginId].codeshellNotes = "req-signin";
  assert.equal(importFigmaJson(legacy).document.nodes[0].notes, undefined);
});
