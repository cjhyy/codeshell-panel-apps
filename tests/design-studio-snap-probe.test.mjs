// Offline tests for the snap-grid probe (no browser, no Electron, no network).
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  SNAP_CASES, SNAP_CAMERAS, LAYOUT_OFFSETS, SNAP_THRESHOLDS, snapProbeDocument, inferLayoutQuantum, coverageStats,
  predictBoxEdges, predictBaselineDevice, fitSnapCase, snapProbeCollectSource, snapProbeMountSource, snapProbeUnmountSource,
  SNAP_INTER, GPU_HTML_THRESHOLDS, snapProbeSources, compareGpuToHtml, snapProbeGpuMountSource, snapProbeGpuUnmountSource,
} from "../scripts/design-studio-snap-probe.mjs";
import { createHash } from "node:crypto";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("six probe cases form one canonical codec document with fractional phases", async () => {
  const codec = await import("../apps/design-studio/app/document.mjs");
  assert.deepEqual(SNAP_CASES.map(value => value.id), ["inter-resource", "finite", "menlo-prompt", "arial-button", "gray-strip", "small-rect"]);
  const source = codec.serializeDesignDocument(codec.normalizeDesignDocument(snapProbeDocument()));
  assert.equal(codec.serializeDesignDocument(codec.normalizeDesignDocument(JSON.parse(source))), source);
  const nodes = codec.normalizeDesignDocument(JSON.parse(source)).pages[0].nodes;
  assert.ok(nodes.find(node => node.id === "finite").layoutBaselineOffset === 3.5);
  assert.ok(nodes.find(node => node.id === "gray-strip").rotation === 45);
  assert.deepEqual(SNAP_CAMERAS.map(camera => camera.label), ["z1", "z2", "fit", "z1-pan"]);
  assert.ok(SNAP_CAMERAS.every(camera => !Number.isInteger(camera.panX) && !Number.isInteger(camera.panY)), "fractional pans");
  assert.deepEqual(LAYOUT_OFFSETS, [0.01, 1 / 128, 1 / 64, 0.3, 0.51, 0.75]);
  assert.deepEqual(SNAP_THRESHOLDS, { edgeDevicePx: 0.25, centroidDevicePx: 0.15, inkBias: 0.03 });
});

test("layout quantum inference distinguishes 1/64 from 1/128 and rounding modes from raw rects", () => {
  const sample = unit => LAYOUT_OFFSETS.map(requested => ({ requested, measured: Math.floor(requested / unit) * unit }));
  assert.deepEqual(inferLayoutQuantum(sample(1 / 64)), { unit: 1 / 64, denominator: 64, rule: "floor", consistent: true });
  assert.deepEqual(inferLayoutQuantum(sample(1 / 128)), { unit: 1 / 128, denominator: 128, rule: "floor", consistent: true });
  const rounded = LAYOUT_OFFSETS.map(requested => ({ requested, measured: Math.round(requested * 64) / 64 }));
  assert.equal(inferLayoutQuantum(rounded).rule, "round");
  assert.equal(inferLayoutQuantum([{ requested: 0.3, measured: 0.123 }]).consistent, false);
});

function rectPng(width, height, box, { fg = [0x68, 0x6e, 0x67], bg = [255, 255, 255] } = {}) {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cover = Math.max(0, Math.min(x + 1, box.x + box.w) - Math.max(x, box.x)) * Math.max(0, Math.min(y + 1, box.y + box.h) - Math.max(y, box.y));
    const o = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) image.data[o + c] = Math.round(bg[c] + cover * (fg[c] - bg[c]));
    image.data[o + 3] = 255;
  }
  return image;
}

test("coverage stats recover exact area, centroid and 50% edges of an anti-aliased box", () => {
  const image = rectPng(40, 40, { x: 10.3, y: 5.5, w: 2.52, h: 14.4 });
  const stats = coverageStats(image, { x: 0, y: 0, width: 40, height: 40 }, { foreground: [0x68, 0x6e, 0x67], background: [255, 255, 255] });
  assert.ok(Math.abs(stats.area - 2.52 * 14.4) < 0.15);
  assert.ok(Math.abs(stats.centroid[0] - (10.3 + 1.26)) < 0.02 && Math.abs(stats.centroid[1] - (5.5 + 7.2)) < 0.02);
  assert.ok(Math.abs(stats.edges.left - 10.3) < 0.02 && Math.abs(stats.edges.right - 12.82) < 0.02);
  assert.ok(Math.abs(stats.edges.top - 5.5) < 0.02 && Math.abs(stats.edges.bottom - 19.9) < 0.02);
});

test("css-grid and device-grid predictions match the run4 1.26x7.2 observations and differ where they should", () => {
  const camera = { zoom: 1, panX: 0, panY: 0 }, box = { x: 28.3, y: 120.4, width: 1.26, height: 7.2 };
  assert.deepEqual(predictBoxEdges(box, camera, 2, "css"), { left: 56, right: 60, top: 240, bottom: 256 }, "148-like: 2 world px wide = 4 device px");
  assert.deepEqual(predictBoxEdges(box, camera, 2, "device"), { left: 57, right: 59, top: 241, bottom: 255 }, "130-like: 2.52 -> 2 device px");
  assert.equal(predictBaselineDevice(58.5, { zoom: 1, panX: 0, panY: 0.3 }, 2, "css"), (59 + 0.3) * 2);
  assert.equal(predictBaselineDevice(58.5, { zoom: 1, panX: 0, panY: 0.3 }, 2, "device"), Math.round((58.5 + 0.3) * 2));
});

test("fit verdicts use the preregistered thresholds and never call a misfit AA", () => {
  const predicted = { css: { left: 56, right: 60, top: 240, bottom: 256 }, device: { left: 57, right: 59, top: 241, bottom: 255 } };
  const measured = { edges: { left: 57.05, right: 58.98, top: 241.1, bottom: 254.9 }, area: 2 * 14 * 1.01, centroid: [58.01, 248.0] };
  const fit = fitSnapCase({ kind: "rect", measured, predicted });
  assert.equal(fit.device.fits, true);
  assert.equal(fit.css.fits, false);
  assert.equal(fit.best, "device");
  const neither = fitSnapCase({ kind: "rect", measured: { ...measured, edges: { ...measured.edges, left: 56.5 } }, predicted });
  assert.equal(neither.best, null);
  assert.match(neither.note, /neither grid fits/);
});

test("browser-side probe sources stay local and read no user agent", () => {
  const sources = [snapProbeCollectSource({ logicalSource: "{}", moduleBase: "./" }), snapProbeMountSource({ markup: { css: "", body: "" }, camera: SNAP_CAMERAS[0], size: { width: 10, height: 10 } }), snapProbeUnmountSource()];
  for (const source of sources) {
    assert.doesNotMatch(source, /userAgent|fetch\(|XMLHttpRequest|https?:\/\/|WebSocket/u);
  }
  assert.match(sources[0], /fonts\/InterVariable\.woff2/, "the same Inter bytes are loaded under an explicit alias");
  assert.match(sources[0], /document\.fonts\.check/);
});

test("the headless cross-check is offline, bounded and never reads a user profile", async () => {
  const source = await readFile(join(repository, "scripts/design-studio-snap-probe-headless.mjs"), "utf8");
  assert.match(source, /route\.abort\(\)/);
  assert.match(source, /emulated-dsf2/);
  assert.match(source, /forced-dsf2/);
  assert.doesNotMatch(source, /userDataDir|launchPersistentContext/);
  assert.match(source, /timeout/);
});

test("Inter is an actual document font resource (bytes + alias), never the app 'Inter' family name", async () => {
  const codec = await import("../apps/design-studio/app/document.mjs"), resourceStore = await import("../apps/design-studio/app/resource-store.mjs");
  const interBytes = await readFile(join(repository, "apps/design-studio/app", SNAP_INTER.path));
  const { logicalSource, interBase64, interDescriptor } = await snapProbeSources({ codec, resourceStore, interBytes,
    sha256Hex: bytes => createHash("sha256").update(bytes).digest("hex") });
  const design = codec.normalizeDesignDocument(JSON.parse(logicalSource));
  assert.deepEqual(design.resources, [interDescriptor]);
  assert.equal(interDescriptor.family, SNAP_INTER.family);
  assert.equal(interDescriptor.sha256, createHash("sha256").update(interBytes).digest("hex"));
  assert.equal(Buffer.from(interBase64, "base64").length, interBytes.length);
  const node = design.pages[0].nodes.find(value => value.id === "inter-resource");
  assert.equal(node.fontFamily, SNAP_INTER.family);
  assert.equal(node.fontWeight, interDescriptor.weight, "no synthetic bold in either route");
  assert.ok(design.pages[0].nodes.every(value => value.fontFamily !== "Inter"));
  const collect = snapProbeCollectSource({ logicalSource, moduleBase: "./", interBase64 });
  assert.match(collect, /new FontFace\(inter\.alias, Uint8Array\.from\(atob/u, "the HTML route loads the same bytes");
  assert.match(collect, /loadMs/u, "load promise timing is recorded");
});

function solidPng(width, height, boxes, fg = [0x1f, 0x23, 0x28]) {
  const image = new PNG({ width, height }); image.data.fill(255);
  for (const box of boxes) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cover = Math.max(0, Math.min(x + 1, box.x + box.w) - Math.max(x, box.x)) * Math.max(0, Math.min(y + 1, box.y + box.h) - Math.max(y, box.y));
    if (!cover) continue; const o = (y * width + x) * 4, alpha = cover * (box.alpha ?? 1), color = box.fg ?? fg;
    for (let c = 0; c < 3; c++) image.data[o + c] = Math.round(255 + alpha * (color[c] - 255));
  }
  return image;
}

test("GPU/HTML comparison applies centroid, 50% edge and ink limits per case; 4% ink only for real-font text, with a reason", () => {
  assert.deepEqual(GPU_HTML_THRESHOLDS, { centroidDevicePx: 0.15, edge50DevicePx: 0.5, inkBias: 0.03, realFontInkBias: 0.04 });
  const camera = { label: "t", zoom: 1, panX: 0, panY: 0 }, dpr = 1;
  const arial = SNAP_CASES.find(value => value.id === "arial-button").node, rect = SNAP_CASES.find(value => value.id === "small-rect").node;
  // Same geometry, 3.5% lighter HTML ink: only the ink limit differs between text and shapes.
  const box = (node, dy = 0, alpha = 0.965) => ({ x: node.x + 2, y: node.y + 4 + dy, w: 20, h: 10, alpha });
  const html = solidPng(420, 160, [box(arial), { fg: [0x68, 0x6e, 0x67], x: rect.x, y: rect.y, w: 2, h: 7, alpha: 0.965 }]);
  const same = compareGpuToHtml({ htmlImage: html, gpuImage: html, camera, dpr });
  assert.ok(same.filter(row => ["arial-button", "small-rect"].includes(row.id)).every(row => row.pass && row.centroid === 0 && row.ink === 0));
  const shifted = compareGpuToHtml({ htmlImage: html, gpuImage: solidPng(420, 160, [box(arial, 1), { fg: [0x68, 0x6e, 0x67], x: rect.x, y: rect.y, w: 2, h: 7, alpha: 0.965 }]), camera, dpr });
  const row = shifted.find(value => value.id === "arial-button");
  assert.equal(row.pass, false); assert.match(row.misses.join(), /centroid 1\.000/); assert.ok(Math.abs(row.centroidDelta[1] - 1) < 1e-9);
  const inky = compareGpuToHtml({ htmlImage: html, gpuImage: solidPng(420, 160, [box(arial, 0, 1), { fg: [0x68, 0x6e, 0x67], x: rect.x, y: rect.y, w: 2, h: 7 }]), camera, dpr });
  assert.ok(inky.find(value => value.id === "arial-button").ink > 0.03);
  const text = inky.find(value => value.id === "arial-button"), shape = inky.find(value => value.id === "small-rect");
  assert.equal(text.inkLimit, 0.04); assert.match(text.inkReason, /real font/); assert.equal(text.pass, true);
  assert.equal(shape.inkLimit, 0.03); assert.equal(shape.inkReason, null); assert.equal(shape.pass, false);
});

test("the GPU probe source drives only the installed renderer in a probe-owned host and disposes it", () => {
  const mount = snapProbeGpuMountSource({ logicalSource: "{}", moduleBase: "./", camera: SNAP_CAMERAS[0], size: { width: 10, height: 10 } });
  const unmount = snapProbeGpuUnmountSource();
  for (const source of [mount, unmount]) assert.doesNotMatch(source, /userAgent|fetch\(|XMLHttpRequest|https?:\/\/|WebSocket/u);
  assert.match(mount, /canvas\/canvaskit-renderer\.mjs/);
  assert.match(mount, /renderer\.resize\(10, 10, window\.devicePixelRatio\)/);
  assert.match(unmount, /dispose\(\)/);
});
