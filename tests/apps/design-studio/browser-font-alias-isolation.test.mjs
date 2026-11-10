import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";

/* Cross-surface batch (probe reliability). Single-variable fact, forced DSF2 (Chromium 148): after the GPU text module
 * measures its private alias face at the layout size (13px x 2), 13px HTML laid out in that same alias family is
 * 95.60 CSS px wide instead of 101.15 (a fresh page). A separate FontFace with the same bytes (as the browser
 * route's own csbr...-resource-N faces) keeps 101.15. This guards the isolation the browser route relies on; it does
 * not claim a cause inside Chrome. */
const app = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));

test("forced DSF2: GPU layout-size measurement of its alias face leaves a separate same-bytes face's HTML width unchanged", async t => {
  const browser = await chromium.launch({ headless: true, args: ["--force-device-scale-factor=2", "--window-size=800,600"] });
  t.after(() => browser.close());
  const widths = {};
  for (const gpuFirst of [false, true]) {
    const context = await browser.newContext({ viewport: null });
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== "https://alias-isolation.test") return route.abort();
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><body style="margin:0">' });
      const path = resolve(app, "." + decodeURIComponent(url.pathname));
      if (!path.startsWith(app + sep)) return route.abort();
      return route.fulfill({ body: await readFile(path), contentType: { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2" }[extname(path)] ?? "application/octet-stream" });
    });
    const page = await context.newPage();
    await page.goto("https://alias-isolation.test");
    await page.addScriptTag({ url: "/canvas/vendor/canvaskit.js" });
    widths[gpuFirst ? "gpuFirst" : "fresh"] = await page.evaluate(async gpuFirst => {
      const bytes = await (await fetch("/fonts/InterVariable.woff2")).arrayBuffer();
      const browserFace = new FontFace("csbr-test-resource-0", bytes.slice(0), { weight: "100 900" }); await browserFace.load(); document.fonts.add(browserFace);
      const CK = await CanvasKitInit({ locateFile: f => "/canvas/vendor/" + f });
      const { createCanvasKitText } = await import("/canvas/canvaskit-text.mjs");
      const node = { id: "n", name: "n", type: "text", x: 20, y: 20, width: 300, height: 30, text: "gyp quick jumpy", fill: "#000000", stroke: "transparent", strokeWidth: 0,
        opacity: 1, rotation: 0, fontFamily: "Inter", fontRef: "inter", fontSize: 13, fontWeight: 400, lineHeight: 1.3, textAlign: "left" };
      const design = { nodes: [node], resources: [{ id: "inter", kind: "font", family: "Inter" }] };
      const text = await createCanvasKitText({ CK, design, resources: new Map([["inter", { bytes: new Uint8Array(bytes.slice(0)), mimeType: "font/woff2", descriptor: design.resources[0] }]]),
        document, fallbackFontUrls: new Map(), counters: { textLines: 0, rasterTextNodes: 0, nativeTextNodes: 0, gradientPaints: 0 }, unsupportedNode: () => {}, makePaint: () => new CK.Paint() });
      const alias = [...document.fonts].map(f => f.family.replace(/"/g, "")).find(f => f.startsWith("ck-font"));
      if (gpuFirst) { text.beginScene(design, { layoutScale: 2 }); const surface = CK.MakeSurface(400, 100); text.draw(surface.getCanvas(), node); surface.delete(); }
      const width = family => { const d = document.createElement("div"); d.style.cssText = `position:absolute;white-space:pre;font:13px/1.3 "${family}"`; d.innerHTML = "<span>gyp quick jumpy</span>";
        document.body.append(d); const w = d.firstChild.getBoundingClientRect().width; d.remove(); return w; };
      const out = { separateFace: width("csbr-test-resource-0"), gpuAlias: width(alias), alias };
      text.dispose(); return out;
    }, gpuFirst);
    await context.close();
  }
  t.diagnostic(JSON.stringify(widths));
  assert.ok(widths.fresh.separateFace > 0);
  assert.equal(widths.gpuFirst.separateFace, widths.fresh.separateFace, "the browser route's separate face is not affected by GPU measurement");
});
