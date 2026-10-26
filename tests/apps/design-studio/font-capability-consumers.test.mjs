import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";
import { ensureBuiltinDesignFonts } from "../../../apps/design-studio/app/builtin-fonts.mjs";
import { createOwnedFontManager } from "../../../apps/design-studio/app/owned-fonts.mjs";
import { designFontFaceCss } from "../../../apps/design-studio/app/font-css.mjs";
import { measureFigmaTextDocument } from "../../../apps/design-studio/app/text-metrics.mjs";

const app = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const font = async (file, id) => {
  const bytes = await readFile(resolve(app, "fonts", file));
  const descriptor = { id, kind: "font", family: id, weight: 400, style: "normal",
    mime: file.endsWith(".ttf") ? "font/ttf" : "font/woff2", bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), partCount: 1 };
  return { bytes, descriptor, dataUrl: `data:${descriptor.mime};base64,${bytes.toString("base64")}` };
};

test("measurement FontFaces expose only byte-proven weight ranges, independent of resource ID", async () => {
  const faces = await Promise.all([font("Roboto-Variable.ttf", "external-variable"), font("fa-regular-400.woff2", "static")]);
  const loaded = [], fontSet = { add() {}, ready: Promise.resolve() };
  class Face {
    constructor(family, _bytes, descriptors) { loaded.push({ family, ...descriptors }); }
    async load() { return this; }
  }
  await ensureBuiltinDesignFonts({}, { faces, fontSet, FontFaceConstructor: Face });
  assert.deepEqual(loaded, [{ family: "external-variable", weight: "100 900", style: "normal" },
    { family: "static", weight: "400", style: "normal" }]);
  assert.equal(faces[0].descriptor.weight, 400, "runtime axes do not rewrite the supplied descriptor");
});

test("owned document fonts use the same verified variable range without altering resource data", async () => {
  const resources = await Promise.all([font("Roboto-Variable.ttf", "external-variable"), font("fa-regular-400.woff2", "static")]);
  const before = JSON.stringify(resources.map(({ descriptor, dataUrl }) => ({ descriptor, dataUrl }))), loaded = [];
  const manager = createOwnedFontManager({ fontSet: new Set(), createFace(family, _source, descriptors) {
    const value = { family, ...descriptors }; loaded.push(value); return { async load() { return this; } };
  } });
  const token = manager.begin(), prepared = await manager.prepare(token, resources); manager.commit(token, prepared);
  assert.deepEqual(loaded, [{ family: "external-variable", weight: "100 900", style: "normal" },
    { family: "static", weight: "400", style: "normal" }]);
  assert.equal(JSON.stringify(resources.map(({ descriptor, dataUrl }) => ({ descriptor, dataUrl }))), before);
  manager.reset();
});

test("portable font CSS derives external variable capability from bytes and never expands static fonts", async () => {
  const resources = await Promise.all([font("Roboto-Variable.ttf", "external-variable"), font("fa-regular-400.woff2", "builtin-inter-forged")]);
  const css = designFontFaceCss(resources.map(font => font.descriptor), new Map(resources.map(font => [font.descriptor.id, font.dataUrl])))
    .replace(/src:url\("[^"]*"\);/gu, "");
  assert.match(css, /font-family:"external-variable";[^}]*font-weight:100 900;/u);
  assert.match(css, /font-family:"builtin-inter-forged";[^}]*font-weight:400;/u);
});

test("unsupported supplied range weights never acquire synthesized measurement receipts or altered geometry", async () => {
  const face = await font("fa-regular-400.woff2", "static");
  const { textRangeSourceSignature } = await import("../../../apps/design-studio/app/text-ranges.mjs");
  const node = { id: "copy", type: "text", text: "\uf004", x: 20, y: 30, width: 80, height: 40,
    fontFamily: "static", fontRef: "static", fontWeight: 400, fontSize: 24, fontStyle: "normal", lineHeight: 1.5,
    textRanges: { version: 1, sourceSignature: textRangeSourceSignature("\uf004"), ranges: [{ start: 0, end: 1, fontWeight: 700 }] } };
  const before = JSON.stringify(node), document = { nodes: [node] };
  const result = await measureFigmaTextDocument(document, { fontFaces: [face], nativeLineBoxes: true,
    measurer: { configure() { throw Error("unavailable weights cannot be measured as supported"); }, close() {} } });
  assert.equal(result.measured, 0); assert.equal(JSON.stringify(node), before);
  assert.deepEqual(result.unsupportedFontRequests, [{ nodeId: "copy", family: "static", weight: 700, style: "normal" }]);
  assert.equal(node.textMetrics, undefined);
});

test("HTML renderer never labels static selected bytes as a 1..1000 variable font", async t => {
  const browser = await chromium.launch({ args: ["--disable-gpu"] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 600, height: 150 } });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://font-capability.test") return route.abort();
    if (url.pathname === "/") return route.fulfill({ body: '<!doctype html><div id="surface"></div>', contentType: "text/html" });
    const path = resolve(app, "." + url.pathname); if (!path.startsWith(app + sep)) return route.abort();
    return route.fulfill({ body: await readFile(path), contentType: { ".mjs": "text/javascript", ".woff2": "font/woff2" }[extname(path)] });
  });
  await page.goto("https://font-capability.test/");
  const observed = await page.evaluate(async () => {
    const { createBrowserRenderer } = await import("/canvas/browser-renderer.mjs");
    const bytes = new Uint8Array(await (await fetch("/fonts/fa-regular-400.woff2")).arrayBuffer());
    const descriptor = { id: "font", kind: "font", family: "Static Original", weight: 400, style: "normal", mime: "font/woff2",
      bytes: bytes.length, sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join(""), partCount: 1 };
    const node = { id: "text", name: "Text", type: "text", x: 20, y: 20, width: 400, height: 60, text: "\uf004", fontFamily: descriptor.family,
      fontRef: descriptor.id, fontSize: 32, fontWeight: 400, fontStyle: "normal", lineHeight: 1.5, textAlign: "left", fill: "#111111",
      stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false };
    const design = { format: "codeshell.design", version: 3, name: "Static font", canvas: { width: 600, height: 150, background: "#ffffff" },
      tokens: { colors: [] }, resources: [descriptor], activePageId: "main", pages: [{ id: "main", name: "Main", nodes: [node] }], nodes: [node] };
    const NativeFace = FontFace, registrations = [];
    window.FontFace = class extends NativeFace { constructor(family, source, values) { super(family, source, values); registrations.push({ family, weight: this.weight }); } };
    const renderer = createBrowserRenderer({ container: document.querySelector("#surface") });
    try {
      await renderer.setScene(design, { resources: new Map([[descriptor.id, { descriptor, bytes, mimeType: descriptor.mime }]]) });
      const acceptedWidth = renderer.geometry().get("text").width, original = JSON.stringify(design), acceptedFonts = document.fonts.size;
      const { textRangeSourceSignature } = await import("/text-ranges.mjs");
      const refused = [];
      for (const change of [
        { fontWeight: 700 },
        { textRanges: { version: 1, sourceSignature: textRangeSourceSignature(node.text), ranges: [{ start: 0, end: 1, fontWeight: 700 }] } },
      ]) {
        const next = structuredClone(design); Object.assign(next.nodes[0], change);
        try { await renderer.setScene(next, { resources: new Map([[descriptor.id, { descriptor, bytes, mimeType: descriptor.mime }]]) }); refused.push(null); }
        catch (error) { refused.push(error.code); }
      }
      return { registrations, width: acceptedWidth, refused, retainedWidth: renderer.geometry().get("text").width,
        unchanged: original === JSON.stringify(design), noLeak: document.fonts.size === acceptedFonts, stats: renderer.stats() };
    } finally { renderer.dispose(); window.FontFace = NativeFace; }
  });
  assert.equal(observed.width, 400);
  assert.equal(observed.registrations.length, 6);
  assert(observed.registrations.every(face => face.weight === "400"), JSON.stringify(observed));
  assert.deepEqual(observed.refused, ["BROWSER_FONT_UNSUPPORTED", "BROWSER_FONT_UNSUPPORTED"]);
  assert(observed.unchanged && observed.noLeak); assert.equal(observed.retainedWidth, observed.width);
  assert.equal(observed.stats.fontCapabilities[0].proof, "pinned-sha256");
  assert.equal(observed.stats.fontSelections[0].selection, "exact-face");
});
