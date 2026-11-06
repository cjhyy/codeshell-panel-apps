import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { compareShadowGeometry } from "./render-fidelity-geometry.mjs";

const shadow = { color: "#000000", opacity: .25, x: 3, y: 5, blur: 8 };
const shape = (id, extra = {}) => ({ id, type: "rectangle", name: id, x: 20, y: 20,
  width: 100, height: 60, fill: "#ffffff", stroke: "#dc2626", strokeWidth: 4,
  opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false, ...extra });
const documentFor = children => ({ format: "codeshell.design", version: 3, name: "Shadow roundtrip",
  canvas: { width: 400, height: 240, background: "#ffffff" }, tokens: { colors: [] }, resources: [],
  activePageId: "page", pages: [{ id: "page", name: "Page", children }] });
const styleFor = (html, id) => html.match(new RegExp(`data-codeshell-id="${id}"[^>]*style="([^"]*)"`, "u"))[1];
const stack = { basis: "css-box", layers: [
  { kind: "outer", color: "#000000", opacity: .25, x: 3, y: 5, blur: 8, spread: 0, visible: true },
  { kind: "inner", color: "#2563eb", opacity: .5, x: 2, y: 1, blur: 4, spread: 0, visible: true },
] };

test("outer CSS shadow masks include visible stroke outset without changing inner or text shadows", () => {
  for (const [strokeAlign, spread] of [[undefined, 2], ["center", 2], ["outside", 4], ["inside", 0]]) {
    const node = shape("shape", { ...(strokeAlign ? { strokeAlign } : {}), shadow });
    const input = documentFor([node]), before = JSON.stringify(input);
    const css = styleFor(exportDesignFrontend(input), node.id);
    assert.match(css, new RegExp(`3px 5px 8px ${spread}px rgba\\(0,0,0,0\\.25\\)`, "u"), `scalar ${strokeAlign ?? "legacy"}`);
    assert.equal(JSON.stringify(input), before);
    // Export is also a direct renderer: this checks its bounded paint conversion,
    // without admitting unsupported center/outside stacks into the document codec.
    const stackCss = styleFor(exportDesignFrontend(documentFor([shape("stack", {
      ...(strokeAlign ? { strokeAlign } : {}), shadowStack: stack,
    })])), "stack");
    assert.match(stackCss, new RegExp(`3px 5px 8px ${spread}px rgba\\(0,0,0,0\\.25\\)`, "u"), `stack ${strokeAlign ?? "legacy"}`);
    assert.match(stackCss, /inset 2px 1px 4px 0px rgba\(37,99,235,0\.5\)/u);
  }
  const transparent = styleFor(exportDesignFrontend(documentFor([shape("transparent", { stroke: "transparent", shadow })])), "transparent");
  assert.match(transparent, /3px 5px 8px 0px rgba\(0,0,0,0\.25\)/u);
  const text = styleFor(exportDesignFrontend(documentFor([shape("text", { type: "text", text: "Text", fontFamily: "Arial", fontSize: 16, lineHeight: 1.5, fontWeight: 400, shadow })])), "text");
  assert.match(text, /text-shadow:3px 5px 8px rgba\(0,0,0,0\.25\)/u);
});

async function captureFixture(t) {
  const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-lcd-text"] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 400, height: 240 }, deviceScaleFactor: 1 });
  const appRoot = fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url));
  const rejected = [];
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.href === "https://shadow-roundtrip.test/") return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
    if (url.origin === "https://shadow-roundtrip.test" && url.pathname.startsWith("/app/") && url.pathname.endsWith(".mjs")) {
      const path = resolve(appRoot, url.pathname.slice(5));
      if (path.startsWith(`${appRoot.replace(/\/$/u, "")}${sep}`)) return route.fulfill({ contentType: "text/javascript", body: await readFile(path) });
    }
    rejected.push(url.href);
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto("https://shadow-roundtrip.test/");
  const capture = async html => {
    await page.setContent(html);
    return page.evaluate(async () => {
      const { captureHtmlToDesign } = await import("/app/html-capture.mjs");
      return captureHtmlToDesign(document.querySelector(".cs-page"), { name: "Roundtrip" });
    });
  };
  t.after(() => assert.deepEqual(rejected, [], "all fixture requests stayed local"));
  return { page, capture };
}

test("generated center stroke roundtrip restores stroke and retains the actual scalar shadow", async t => {
  const { page, capture } = await captureFixture(t), rows = [];
  for (const strokeAlign of [undefined, "center"]) for (const effect of [undefined, shadow]) {
    const source = documentFor([shape("shape", { ...(strokeAlign ? { strokeAlign } : {}), ...(effect ? { shadow: effect } : {}) })]);
    const before = serializeDesignDocument(normalizeDesignDocument(source));
    const html = exportDesignFrontend(source), captured = await capture(html);
    const actual = normalizeDesignDocument(captured).nodes.find(node => node.id === "shape");
    rows.push({ strokeAlign: strokeAlign ?? "legacy", shadow: !!effect, actual });
    if (process.env.DESIGN_SHADOW_EVIDENCE_DIR) {
      await mkdir(process.env.DESIGN_SHADOW_EVIDENCE_DIR, { recursive: true });
      await writeFile(resolve(process.env.DESIGN_SHADOW_EVIDENCE_DIR, "roundtrip.json"), `${JSON.stringify(rows, null, 2)}\n`);
      await page.screenshot({ path: resolve(process.env.DESIGN_SHADOW_EVIDENCE_DIR, `${strokeAlign ?? "legacy"}-${effect ? "shadow" : "plain"}.png`) });
    }
    assert.equal(actual.stroke, "#dc2626", `${strokeAlign ?? "legacy"}: generated stroke must survive capture`);
    assert.equal(actual.strokeWidth, 4);
    assert.equal(actual.strokeAlign, strokeAlign);
    assert.deepEqual(actual.shadow, effect, "the generated pair must not become a phantom zero-blur shadow or hide the authored shadow");
    assert.equal(serializeDesignDocument(normalizeDesignDocument(source)), before, "capture/export never mutate the source document");
  }
});

test("ordinary external shadows and forged or mismatched paint hints retain their measured CSS meaning", async t => {
  const { capture } = await captureFixture(t);
  const normal = "rgb(12,34,56) 2px 3px 4px 0px";
  const pair = "rgb(220,38,38) 0px 0px 0px 2px,inset rgb(220,38,38) 0px 0px 0px 2px";
  for (const [hint, paint, decoration = ""] of [
    ["", normal], ["", pair],
    [' data-codeshell-stroke="center-shadow-v1"', normal],
    [' data-codeshell-stroke="legacy-shadow-v1"', "rgb(220,38,38) 0px 0px 0px 2px,inset rgb(0,0,0) 0px 0px 0px 2px"],
    [' data-codeshell-stroke="center-shadow-v1"', pair.replaceAll("2px", "51px")],
    [' data-codeshell-stroke="center-shadow-v1"', pair, ";border:1px solid blue"],
    [' data-codeshell-stroke="center-shadow-v1"', pair, ";outline:1px solid blue"],
  ]) {
    const captured = await capture(`<!doctype html><style>body{margin:0}.cs-page{position:relative;width:400px;height:240px;background:white}</style><main class="cs-page"><div data-codeshell-id="external" data-codeshell-node-type="rectangle"${hint} style="position:absolute;left:20px;top:20px;width:100px;height:60px;background:white;box-shadow:${paint}${decoration}"></div></main>`);
    const actual = normalizeDesignDocument(captured).nodes.find(node => node.id === "external");
    assert.equal(actual.stroke, "transparent", "a hint without matching rendered evidence must not invent a stroke");
    assert.equal(actual.strokeWidth, 0);
    assert.deepEqual(actual.shadow, paint === normal ? { color: "#0c2238", opacity: 1, x: 2, y: 3, blur: 4 } : { color: "#dc2626", opacity: 1, x: 0, y: 0, blur: 0 });
  }
});

test("stroke-bearing scalar shadow exterior matches SVG geometry at DPR 1 and 2", async t => {
  const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-lcd-text"] });
  t.after(() => browser.close());
  const rows = [];
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 400, height: 240 }, deviceScaleFactor: dpr });
    await page.route("**/*", route => route.abort());
    try {
      for (const strokeAlign of [undefined, "center", "outside", "inside"]) {
        const document = documentFor([shape("shape", { x: 80, y: 60, width: 115, height: 70,
          fill: "#eeeeee", stroke: "#111111", strokeWidth: 2,
          ...(strokeAlign ? { strokeAlign } : {}),
          shadow: { color: "#000000", opacity: .25, x: 4, y: 6, blur: 8 },
        })]);
        await page.setContent(exportDesignFrontend(document));
        const html = await page.screenshot();
        await page.setContent(`<!doctype html><style>body{margin:0}</style>${exportDesignSvg(normalizeDesignDocument(document))}`);
        const svg = await page.screenshot();
        const outset = (strokeAlign === "inside" ? 0 : strokeAlign === "outside" ? 2 : 1) + 1;
        const metrics = compareShadowGeometry(PNG.sync.read(html), PNG.sync.read(svg), {
          roi: { x: 40 * dpr, y: 20 * dpr, width: 200 * dpr, height: 160 * dpr },
          excludeBounds: { x: (80 - outset) * dpr, y: (60 - outset) * dpr, width: (115 + outset * 2) * dpr, height: (70 + outset * 2) * dpr },
        });
        rows.push({ dpr, strokeAlign: strokeAlign ?? "legacy", ...metrics });
        if (process.env.DESIGN_SHADOW_EVIDENCE_DIR) {
          const directory = process.env.DESIGN_SHADOW_EVIDENCE_DIR;
          await mkdir(directory, { recursive: true });
          await Promise.all([
            writeFile(resolve(directory, `scalar-${strokeAlign ?? "legacy"}-dpr${dpr}-html.png`), html),
            writeFile(resolve(directory, `scalar-${strokeAlign ?? "legacy"}-dpr${dpr}-svg.png`), svg),
            writeFile(resolve(directory, "shadow-geometry.json"), `${JSON.stringify(rows, null, 2)}\n`),
          ]);
        }
      }
    } finally { await page.close(); }
  }
  for (const row of rows) {
    assert.equal(row.measurable, true, JSON.stringify(row));
    assert.deepEqual(row.failures, [], JSON.stringify(row));
  }
});
