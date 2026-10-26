import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { inspectFontCapabilities, fontCapabilitiesFromDataUrl, fontFaceWeight, fontSupportsRequest, selectFontEntry } from "../../../apps/design-studio/app/font-capabilities.mjs";

const read = file => readFile(new URL(`../../../apps/design-studio/app/fonts/${file}`, import.meta.url));
const fixed = value => Math.round(value * 65536);
// Minimal parser fixtures have no outlines and are never rendered as fonts.
function sfnt({ axes = [{ tag: "wght", min: 100, default: 400, max: 900 }], italic = false } = {}) {
  const count = axes === null ? 1 : 2, directory = 12 + count * 16, os2Length = 64;
  const fvarLength = axes === null ? 0 : 16 + axes.length * 20;
  const bytes = new Uint8Array(directory + os2Length + fvarLength), view = new DataView(bytes.buffer);
  const tag = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  view.setUint32(0, 0x00010000); view.setUint16(4, count);
  tag(12, "OS/2"); view.setUint32(20, directory); view.setUint32(24, os2Length); view.setUint16(directory + 4, 400); view.setUint16(directory + 62, italic ? 1 : 0);
  if (axes !== null) {
    tag(28, "fvar"); view.setUint32(36, directory + os2Length); view.setUint32(40, fvarLength);
    const at = directory + os2Length; view.setUint16(at, 1); view.setUint16(at + 4, 16); view.setUint16(at + 6, 2); view.setUint16(at + 8, axes.length); view.setUint16(at + 10, 20); view.setUint16(at + 14, 4 + axes.length * 4);
    axes.forEach((axis, index) => { const start = at + 16 + index * 20; tag(start, axis.tag); for (const [i, key] of ["min", "default", "max"].entries()) view.setInt32(start + 4 + i * 4, fixed(axis[key])); });
  }
  return bytes;
}

test("external SFNT variable axes use actual 16.16 values and byte view offsets", async () => {
  const bytes = await read("Roboto-Variable.ttf"), result = inspectFontCapabilities(bytes);
  assert.equal(result.proof, "sfnt-fvar"); assert.equal(result.weight, 400); assert.equal(result.style, "normal");
  assert.deepEqual(result.axes, [{ tag: "wght", min: 100, default: 400, max: 900 }, { tag: "wdth", min: 75, default: 100, max: 100 }]);
  const fractional = sfnt({ axes: [{ tag: "wdth", min: 62.5, default: 100, max: 125 }, { tag: "slnt", min: -14, default: 0, max: 14 }] });
  const padded = new Uint8Array(fractional.length + 7); padded.set(fractional, 7);
  assert.deepEqual(inspectFontCapabilities(padded.subarray(7)).axes, [{ tag: "wdth", min: 62.5, default: 100, max: 125 }, { tag: "slnt", min: -14, default: 0, max: 14 }]);
});

test("static SFNT and hash-pinned compressed fonts cannot be widened by resource naming", async () => {
  assert.deepEqual(inspectFontCapabilities(sfnt({ axes: null })), { format: "ttf", status: "verified", proof: "sfnt-static", axes: [], weight: 400, style: "normal" });
  const inter = await read("InterVariable.woff2"), capability = inspectFontCapabilities(inter);
  assert.equal(capability.proof, "pinned-sha256"); assert.equal(fontFaceWeight(capability, { weight: 400 }), "100 900");
  const staticFace = inspectFontCapabilities(await read("fa-regular-400.woff2"));
  assert.deepEqual(staticFace.axes, []); assert.equal(fontFaceWeight(staticFace, { id: "builtin-inter-forged", weight: 400 }), "400");
  assert.equal(fontFaceWeight(staticFace, { weight: 700 }), "700", "an authored static CSS face label is separate from its native weight class");
  assert.equal(staticFace.weight, 400);
  const changed = Uint8Array.from(inter); changed[changed.length - 1] ^= 1;
  assert.equal(inspectFontCapabilities(changed).status, "unsupported");
  assert.equal(fontFaceWeight(inspectFontCapabilities(changed), { weight: 400 }), "400");
});

for (const [name, mutate] of [
  ["truncated directory", bytes => bytes.subarray(0, 20)],
  ["out-of-file table", bytes => { new DataView(bytes.buffer).setUint32(36, bytes.length + 1); return bytes; }],
  ["duplicate table", bytes => { bytes.set(new TextEncoder().encode("OS/2"), 28); return bytes; }],
  ["short fvar", bytes => { new DataView(bytes.buffer).setUint32(40, 10); return bytes; }],
  ["short axis record", bytes => { new DataView(bytes.buffer).setUint16(108 + 10, 19); return bytes; }],
  ["axis min exceeds default", bytes => { new DataView(bytes.buffer).setInt32(108 + 16 + 4, fixed(500)); return bytes; }],
  ["unbounded axis count", bytes => { new DataView(bytes.buffer).setUint16(108 + 8, 65535); return bytes; }],
  ["missing instance records", bytes => { new DataView(bytes.buffer).setUint16(108 + 12, 1); return bytes; }],
]) test(`malformed font refuses capability: ${name}`, () => {
  const result = inspectFontCapabilities(mutate(sfnt())); assert.equal(result.status, "invalid"); assert.deepEqual(result.axes, []);
});

test("duplicate axis tags, unknown compressed fonts and budgets never grant a variable face", () => {
  const axis = { tag: "wght", min: 100, default: 400, max: 900 };
  assert.equal(inspectFontCapabilities(sfnt({ axes: [axis, axis] })).status, "invalid");
  for (const tag of ["wOF2", "wOFF", "ttcf", "oops"]) { const bytes = new Uint8Array(48); bytes.set(new TextEncoder().encode(tag)); assert.equal(inspectFontCapabilities(bytes).status, "unsupported"); }
  assert.equal(inspectFontCapabilities(new Uint8Array(16 * 1024 * 1024 + 1)).status, "invalid");
  assert.equal(fontCapabilitiesFromDataUrl("https://font.test/Roboto-Variable.ttf").status, "unsupported");
});

test("one strict resource resolver admits actual variable instances and rejects missing/style/out-of-range requests", () => {
  const descriptor = { id: "external", family: "Case Font", weight: 400, style: "normal" }, capabilities = inspectFontCapabilities(sfnt());
  const variable = { descriptor, capabilities };
  assert.equal(selectFontEntry([variable], { family: "case font", weight: 700 }), variable);
  for (const request of [{ family: "Missing", weight: 400 }, { family: "Case Font", weight: 901 }, { family: "Case Font", weight: 99 }, { family: "Case Font", weight: 400, style: "italic" }]) assert.equal(selectFontEntry([variable], request), undefined);
  const staticFace = { descriptor: { ...descriptor, id: "static700", weight: 700 }, capabilities: { status: "verified", axes: [], weight: 700 } };
  assert.equal(selectFontEntry([variable, staticFace], { family: "Case Font", weight: 700 }), staticFace);
  assert.equal(selectFontEntry([variable, staticFace], { family: "Case Font", weight: 700, preferredId: "external" }), variable);
  assert.equal(fontSupportsRequest(descriptor, inspectFontCapabilities(sfnt({ axes: null })), 700), false);
  assert.equal(descriptor.weight, 400);
});
