// Real SVG-input negative controls. The isolated SVG is exported, the target
// element's markup is actually edited (stroke-width +.5, width +1, height +1),
// and the edited SVG is rasterised by headless Chromium under the original R007
// capture conditions. Every result is judged against the UNCHANGED authored
// oracle; the oracle is never used to synthesise the controls. Usage:
//   node tests/apps/design-studio/svg-semantic-markup-controls.mjs R008_EVIDENCE REAL_BACKUP OUTPUT
// Offline: only page.setContent; any network request is aborted. No Electron/Host.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {chromium} from "playwright";
import {PNG} from "pngjs";
import {designPageBounds, exportDesignSvg, normalizeDesignDocument, serializeDesignDocument} from "../../../apps/design-studio/app/document.mjs";
import {isolateFidelityDesign} from "./render-fidelity-attribution.mjs";
import {ancestorsOf, specFor} from "./svg-semantic-audit.mjs";
import {compareSvgSemantics} from "./svg-semantic-metrics.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const LAUNCH_ARGS = ["--enable-webgl", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"]; // R007 report.launchArgs
const MATRIX = {"dpr1-zoom1": {dpr: 1, zoom: 1}};
// Few rows on purpose: two strokes, two fills (edited), and the four audit FAIL rows (unedited).
const PLAN = [
  {id: "android-chat-11", edits: ["strokeWidthPlusHalf"]},
  {id: "android-chat-92", edits: ["strokeWidthPlusHalf"]},
  {id: "android-chat-35", edits: ["fillWidthPlus1", "fillHeightPlus1"]},
  {id: "android-chat-93", edits: ["fillWidthPlus1", "fillHeightPlus1"]},
  {id: "web-chat-138", edits: []}, {id: "web-panels-141", edits: []},
  {id: "web-chat-107", edits: []}, {id: "web-panels-110", edits: []},
];

function editMarkup(svg, id, edit) {
  const pattern = new RegExp(`<rect data-node-id="${id}"[^>]*/>`, "gu"), tags = svg.match(pattern) ?? [];
  assert.equal(tags.length, 1, `exactly one SVG element for ${id}`);
  const tag = tags[0], number = name => Number(tag.match(new RegExp(` ${name}="([^"]+)"`, "u"))[1]);
  const set = (name, value) => tag.replace(new RegExp(` ${name}="[^"]+"`, "u"), ` ${name}="${value}"`);
  const edited = edit === "strokeWidthPlusHalf" ? set("stroke-width", number("stroke-width") + .5)
    : edit === "fillWidthPlus1" ? set("width", number("width") + 1)
    : edit === "fillHeightPlus1" ? set("height", number("height") + 1) : tag;
  return {svg: svg.replace(tag, edited), before: tag, after: edited};
}

function pixelDifference(a, b) {
  if (a.width !== b.width || a.height !== b.height) return {sameSize: false};
  let bytes = 0, max = 0;
  for (let i = 0; i < a.data.length; i++) { const d = Math.abs(a.data[i] - b.data[i]); if (d) bytes++; max = Math.max(max, d); }
  return {sameSize: true, differingBytes: bytes, maxChannelDifference: max};
}

const [oldArg, realArg, outputArg] = process.argv.slice(2);
assert(oldArg && realArg && outputArg, "usage: node svg-semantic-markup-controls.mjs R008_EVIDENCE REAL_BACKUP OUTPUT");
const output = resolve(outputArg), realBytes = await readFile(resolve(realArg)), startedUtc = new Date().toISOString();
const rows = JSON.parse(await readFile(join(resolve(oldArg), "final-real-rows.json"))).filter(row => row.offline?.blockerClass === "SVG_PRECISE_UNEXPLAINED_STROKE" && row.matrix === "dpr1-zoom1");
const real = normalizeDesignDocument(JSON.parse(realBytes).document);
await mkdir(output, {recursive: true});
const report = {startedUtc, launchArgs: LAUNCH_ARGS, viewport: {width: 1600, height: 1000}, captures: []};
async function capture(browser, launch, plan) {
  for (const {id, edits} of plan) {
    const row = rows.find(entry => entry.id === id);
    assert(row, `${id} dpr1-zoom1 row`);
    const {dpr, zoom} = MATRIX[row.matrix];
    // Same per-page design and isolation transform as render-fidelity-ui.test.mjs.
    const design = normalizeDesignDocument(JSON.parse(serializeDesignDocument(real)));
    design.activePageId = row.page; design.nodes = design.pages.find(page => page.id === row.page).nodes;
    const isolated = isolateFidelityDesign(design, id), bounds = designPageBounds(isolated.design);
    const svg = exportDesignSvg(isolated.design, {maxBytes: 4 * 1024 * 1024});
    const index = new Map(design.nodes.map(node => [node.id, node])), node = index.get(id), plan = specFor(row, node, ancestorsOf(node, index), design.canvas);
    const tile = row.tile, clip = {x: 32, y: 32, width: Math.round(tile.width * zoom), height: Math.round(tile.height * zoom)};
    const context = await browser.newContext({viewport: {width: 1600, height: 1000}, deviceScaleFactor: dpr});
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    try {
      for (const edit of ["original", ...edits]) {
        const variant = edit === "original" ? {svg, before: null, after: null} : editMarkup(svg, id, edit);
        const content = variant.svg.replace("<svg ", `<svg style="position:absolute;left:${bounds.x}px;top:${bounds.y}px" `);
        await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${design.canvas.background};overflow:hidden}#export-world{position:absolute;left:32px;top:32px;width:${Math.max(design.canvas.width, bounds.width)}px;transform-origin:0 0;transform:scale(${zoom}) translate(${-tile.x}px,${-tile.y}px)}.cs-page{margin:0!important;overflow:visible!important}</style><div id="export-world">${content}</div>`);
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        const bytes = await page.screenshot({clip}), image = PNG.sync.read(bytes), path = join(output, `${id}-${edit}${launch.startsWith("--disable-gpu") ? "-disable-gpu" : ""}.png`);
        await writeFile(path, bytes);
        const result = compareSvgSemantics(image, plan.spec, {foreground: plan.foreground, background: plan.background});
        const capture = {launch, id, matrix: row.matrix, edit, markupBefore: variant.before, markupAfter: variant.after, path, sha256: sha(bytes), status: result.status, kind: result.kind,
          error: result.kind === "fill" ? result.error : {maxAbsCentroid: Math.max(...result.probes.filter(p => Number.isFinite(p.error?.centroid)).map(p => Math.abs(p.error.centroid))),
            maxAbsWidth: Math.max(...result.probes.filter(p => Number.isFinite(p.error?.width)).map(p => Math.abs(p.error.width))), counts: result.counts}};
        if (edit === "original") {
          const oldBytes = await readFile(row.paths.svg);
          capture.oldCapture = {path: row.paths.svg, sha256: sha(oldBytes), byteIdenticalPng: sha(oldBytes) === capture.sha256, pixels: pixelDifference(PNG.sync.read(oldBytes), image)};
        }
        report.captures.push(capture);
      }
    } finally { await context.close(); }
  }
}
// Same page, flag variant only for the unedited FAIL rows. A flag is not proof of the backend.
const variant = await chromium.launch({headless: true, args: ["--disable-gpu"]});
try { await capture(variant, "--disable-gpu (flag variant; raster backend not verified)", PLAN.filter(entry => !entry.edits.length).map(entry => ({...entry}))); }
finally { await variant.close(); }
const browser = await chromium.launch({headless: true, args: LAUNCH_ARGS});
report.chromium = browser.version();
try {
  await capture(browser, "R007 launch args", PLAN);
  // Best-effort backend evidence. Flags alone do not prove the raster backend.
  const context = await browser.newContext({viewport: {width: 1600, height: 1000}}), page = await context.newPage();
  try {
    report.webgl = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
      if (!gl) return {available: false};
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return {available: true, vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : null, renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null};
    });
  } catch (error) { report.webgl = {error: String(error)}; }
  try {
    await page.goto("chrome://gpu", {timeout: 10000});
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    report.chromeGpu = {lines: text.split("\n").filter(line => /Rasteriz|Skia|GL_RENDERER|Compositing|Canvas|GPU0|Display type/iu.test(line)).slice(0, 40)};
  } catch (error) { report.chromeGpu = {obtained: false, error: String(error)}; }
  await context.close();
} finally { await browser.close(); }
report.finishedUtc = new Date().toISOString();
await writeFile(join(output, "markup-controls.json"), JSON.stringify(report, null, 2) + "\n");
assert.equal(sha(await readFile(resolve(realArg))), sha(realBytes), "user source changed");
console.log(JSON.stringify({chromium: report.chromium, webgl: report.webgl, chromeGpu: report.chromeGpu,
  captures: report.captures.map(({launch, id, edit, status, error, oldCapture}) => ({launch, id, edit, status, error, oldCapture: oldCapture && {byteIdenticalPng: oldCapture.byteIdenticalPng, ...oldCapture.pixels}}))}, null, 1));
