/* Snap-grid probe: which pixel grid (CSS/world px before the zoom/DPR transform, or device
 * px after it) does a given Chromium environment use for Design Studio's HTML route?
 *
 * Pure module, no side effects. The browser-side sources run unchanged in every environment
 * (Electron guest via executeJavaScript, headless Chromium via page.evaluate). They mount the
 * installed frontend-export markup in a probe-owned *open* shadow root (never the app's closed
 * renderer roots), read layout (DOM rects, baseline markers) and report it separately from paint
 * (pixels captured by the caller). No user agent, no network, no production debug surface.
 */
export const SNAP_THRESHOLDS = Object.freeze({ edgeDevicePx: 0.25, centroidDevicePx: 0.15, inkBias: 0.03 });
export const LAYOUT_OFFSETS = Object.freeze([0.01, 1 / 128, 1 / 64, 0.3, 0.51, 0.75]);
export const SNAP_PROBE_SIZE = Object.freeze({ width: 860, height: 360 });
export const SNAP_CAMERAS = Object.freeze([
  { label: "z1", zoom: 1, panX: 10.3, panY: 10.3 },
  { label: "z2", zoom: 2, panX: 10.3, panY: 10.3 },
  { label: "fit", zoom: 0.615, panX: 5.3, panY: 5.3 },
].map(camera => Object.freeze(camera)));

const base = (id, type, x, y, width, height, extra = {}) => ({ id, type, name: id, x, y, width, height, fill: "#1f2328", stroke: "transparent",
  strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false, ...extra });
const text = (id, x, y, width, height, value, extra) => base(id, "text", x, y, width, height, { text: value, fontSize: 14, fontWeight: 400,
  lineHeight: 1.2, textAlign: "left", fontFamily: "Arial", ...extra });
/** The six review cases (world coordinates, fractional phases as in the real fixtures). */
export const SNAP_CASES = Object.freeze([
  { id: "default-inter", kind: "text", node: text("default-inter", 20.3, 20.3, 300, 38, "Default Inter HMI", { fontFamily: "Inter", fontSize: 32, fontWeight: 600, lineHeight: 1.15 }) },
  { id: "finite", kind: "text", node: text("finite", 20.25, 70.5, 184, 20, "Finite 有限 offset", { layoutBaselineOffset: 3.5 }) },
  { id: "menlo-prompt", kind: "text", node: text("menlo-prompt", 230.25, 70.5, 22, 20, ">_", { fontFamily: "Menlo, monospace", fontSize: 13 }) },
  { id: "arial-button", kind: "text", node: text("arial-button", 270, 70, 104, 20, "Continue 继续", { fontWeight: 600, lineHeight: 1.4 }) },
  { id: "gray-strip", kind: "strip", node: base("gray-strip", "rectangle", 50.6, 109.42, 9.6, 1.12, { fill: "#6b7280", rotation: 45, cornerRadius: 0.56 }) },
  { id: "small-rect", kind: "rect", node: base("small-rect", "rectangle", 28.3, 120.4, 1.26, 7.2, { fill: "#686e67" }) },
].map(value => Object.freeze(value)));

export function snapProbeDocument() {
  return { format: "codeshell.design", version: 3, name: "Snap grid probe", canvas: { width: 400, height: 160, background: "#ffffff" },
    tokens: { colors: [] }, resources: [], activePageId: "main", pages: [{ id: "main", name: "Main", children: SNAP_CASES.map(value => structuredClone(value.node)) }] };
}

/** Smallest layout unit and rounding rule that reproduce every measured offset exactly. */
export function inferLayoutQuantum(samples) {
  for (const denominator of [64, 128, 256]) for (const rule of ["floor", "round"]) {
    const unit = 1 / denominator;
    if (samples.every(({ requested, measured }) => Math.abs(Math[rule](requested * denominator) / denominator - measured) < 1e-9))
      return { unit, denominator, rule, consistent: true };
  }
  return { unit: null, denominator: null, rule: null, consistent: false };
}

const hex = value => [1, 3, 5].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
/** Coverage by projection onto the background→foreground line; area, centroid and edges in capture pixels. */
export function coverageStats(image, rect, { foreground, background }) {
  const fg = typeof foreground === "string" ? hex(foreground) : foreground, bg = typeof background === "string" ? hex(background) : background;
  const denominator = (fg[0] - bg[0]) ** 2 + (fg[1] - bg[1]) ** 2 + (fg[2] - bg[2]) ** 2;
  const left = Math.max(0, rect.x), top = Math.max(0, rect.y), right = Math.min(image.width, rect.x + rect.width), bottom = Math.min(image.height, rect.y + rect.height);
  const columns = new Float64Array(right - left), rows = new Float64Array(bottom - top), rowMax = new Float64Array(bottom - top), columnMax = new Float64Array(right - left);
  let area = 0, sx = 0, sy = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const o = (y * image.width + x) * 4;
    let dot = 0;
    for (let c = 0; c < 3; c++) dot += (image.data[o + c] - bg[c]) * (fg[c] - bg[c]);
    const a = Math.max(0, Math.min(1, dot / denominator));
    area += a; sx += a * (x + 0.5); sy += a * (y + 0.5);
    columns[x - left] += a; rows[y - top] += a;
    rowMax[y - top] = Math.max(rowMax[y - top], a); columnMax[x - left] = Math.max(columnMax[x - left], a);
  }
  // Box-filter edges: a partially covered first/last line contributes its covered fraction.
  const areaEdges = (profile, origin) => {
    const max = Math.max(...profile); if (!(max > 0)) return [null, null];
    const first = profile.findIndex(value => value > 1e-6), last = profile.length - 1 - [...profile].reverse().findIndex(value => value > 1e-6);
    return [origin + first + (1 - profile[first] / max), origin + last + profile[last] / max];
  };
  // 50% crossings of the per-line maximum coverage (for glyphs), at pixel centres.
  const halfEdges = (profile, origin) => {
    const crossing = (from, to, step) => { let previous = 0;
      for (let index = from; index !== to; index += step) { const value = profile[index];
        if (value >= 0.5) return origin + index + 0.5 - step * (value - 0.5) / Math.max(1e-9, value - previous);
        previous = value; }
      return null; };
    return [crossing(0, profile.length, 1), crossing(profile.length - 1, -1, -1)];
  };
  const [l, r] = areaEdges(columns, left), [t, b] = areaEdges(rows, top);
  const [l50, r50] = halfEdges(columnMax, left), [t50, b50] = halfEdges(rowMax, top);
  return { area, centroid: area ? [sx / area, sy / area] : null, edges: { left: l, right: r, top: t, bottom: b },
    edges50: { left: l50, right: r50, top: t50, bottom: b50 } };
}

/** Device-pixel edges of an axis-aligned box under a CSS-px (s=1) or device-px (s=dpr) snapping grid. */
export function predictBoxEdges(box, camera, dpr, grid) {
  const toDevice = (value, pan) => (camera.zoom * value + pan) * dpr;
  if (grid === "css") return { left: toDevice(Math.round(box.x), camera.panX), right: toDevice(Math.round(box.x + box.width), camera.panX),
    top: toDevice(Math.round(box.y), camera.panY), bottom: toDevice(Math.round(box.y + box.height), camera.panY) };
  return { left: Math.round(toDevice(box.x, camera.panX)), right: Math.round(toDevice(box.x + box.width, camera.panX)),
    top: Math.round(toDevice(box.y, camera.panY)), bottom: Math.round(toDevice(box.y + box.height, camera.panY)) };
}
/** Device baseline from a layout baseline in world units under each grid. */
export function predictBaselineDevice(layoutBaselineWorld, camera, dpr, grid) {
  return grid === "css" ? (camera.zoom * Math.round(layoutBaselineWorld) + camera.panY) * dpr
    : Math.round((camera.zoom * layoutBaselineWorld + camera.panY) * dpr);
}

/** Preregistered explanatory fit of one case under each grid; a misfit stays a misfit. */
export function fitSnapCase({ kind, measured, predicted }) {
  const result = {};
  for (const [grid, value] of Object.entries(predicted)) {
    const misses = [];
    let edge = null, centroid = null, inkBias = null;
    if (kind === "rect" || kind === "text") {
      const keys = kind === "rect" ? ["left", "right", "top", "bottom"] : ["top", "bottom"];
      const edges = kind === "rect" ? measured.edges : measured.edges50;
      edge = Math.max(...keys.map(key => Math.abs(edges[key] - value[key])));
      if (!(edge <= SNAP_THRESHOLDS.edgeDevicePx)) misses.push(`edge ${edge.toFixed(3)}`);
    }
    if (kind === "rect" || kind === "strip") {
      const center = kind === "rect" ? [(value.left + value.right) / 2, (value.top + value.bottom) / 2] : value.centroid;
      const area = kind === "rect" ? (value.right - value.left) * (value.bottom - value.top) : value.area;
      centroid = Math.hypot(measured.centroid[0] - center[0], measured.centroid[1] - center[1]);
      inkBias = measured.area / area - 1;
      if (!(centroid <= SNAP_THRESHOLDS.centroidDevicePx)) misses.push(`centroid ${centroid.toFixed(3)}`);
      if (!(Math.abs(inkBias) <= SNAP_THRESHOLDS.inkBias)) misses.push(`ink ${(inkBias * 100).toFixed(1)}%`);
    }
    result[grid] = { fits: misses.length === 0, edge, centroid, inkBias, misses };
  }
  const fitting = Object.keys(predicted).filter(grid => result[grid].fits);
  return { ...result, best: fitting.length === 1 ? fitting[0] : null,
    note: fitting.length === 0 ? "neither grid fits within the preregistered thresholds" : fitting.length > 1 ? "both grids fit; this case does not discriminate" : `only ${fitting[0]} fits` };
}

const rotate = ([x, y], [cx, cy], degrees) => { const r = degrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]; };
/**
 * Measure and fit every case in one capture. `collect` and `mount` come from the browser
 * sources below; the capture origin is the probe host's top-left corner.
 */
export function analyzeSnapCapture({ image, camera, dpr, collect, mount }) {
  const world = (x, y) => [(camera.zoom * x + camera.panX) * dpr, (camera.zoom * y + camera.panY) * dpr];
  const rows = [];
  for (const { id, kind, node } of SNAP_CASES) {
    const margin = 4 + 2 / Math.max(camera.zoom, 0.25);
    const [x0, y0] = world(node.x - margin, node.y - margin), [x1, y1] = world(node.x + node.width + margin, node.y + node.height + margin);
    const roi = { x: Math.floor(x0), y: Math.floor(y0), width: Math.ceil(x1) - Math.floor(x0), height: Math.ceil(y1) - Math.floor(y0) };
    const measured = coverageStats(image, roi, { foreground: node.fill, background: "#ffffff" });
    const gpu = collect.gpu?.[id] ?? null, dom = mount.cases?.[id] ?? null;
    let predicted = null, inputs = null;
    if (kind === "rect") {
      predicted = { css: predictBoxEdges(node, camera, dpr, "css"), device: predictBoxEdges(node, camera, dpr, "device") };
    } else if (kind === "strip" && gpu?.paintBox && gpu?.pivot) {
      const scale = camera.zoom * dpr, exactCenter = [node.x + node.width / 2, node.y + node.height / 2];
      const box = gpu.paintBox, boxCenter = rotate([box.x + box.width / 2, box.y + box.height / 2], [gpu.pivot.x, gpu.pivot.y], node.rotation);
      predicted = { css: { centroid: world(...boxCenter), area: box.width * box.height * scale * scale },
        device: { centroid: world(...exactCenter), area: node.width * node.height * scale * scale } };
      inputs = { paintBox: { x: box.x, y: box.y, width: box.width, height: box.height }, pivot: gpu.pivot };
    } else if (kind === "text" && Number.isFinite(dom?.markerBaselineClientY) && gpu?.inkAscent !== undefined) {
      const layoutBaselineWorld = (dom.markerBaselineClientY - mount.host.y - camera.panY) / camera.zoom;
      const ink = grid => { const baseline = predictBaselineDevice(layoutBaselineWorld, camera, dpr, grid);
        return { top: baseline - gpu.inkAscent * camera.zoom * dpr, bottom: baseline + gpu.inkDescent * camera.zoom * dpr, baseline }; };
      predicted = { css: ink("css"), device: ink("device") };
      inputs = { layoutBaselineWorld, gpuBaselineWorld: gpu.gpuBaselineWorld, gpuBaselineDevice: (camera.zoom * gpu.gpuBaselineWorld + camera.panY) * dpr,
        inkAscent: gpu.inkAscent, inkDescent: gpu.inkDescent };
    }
    rows.push({ id, kind, camera: camera.label, roi, measured, dom, inputs, predicted,
      fit: predicted && measured.area > 0 ? fitSnapCase({ kind, measured, predicted }) : null });
  }
  return rows;
}

/* ------------------------------ browser-side sources ------------------------------ */
const PROBE_HOST_ID = "ds-snap-probe-host";
/** P1 layout precision, P2 font metrics (1x and dpr x), GPU pure-function inputs, markup. */
export function snapProbeCollectSource({ logicalSource, moduleBase }) {
  return `(async () => {
    const base = new URL(${JSON.stringify(moduleBase)}, location.href);
    const load = path => import(new URL(path, base).href);
    const [exporter, documentModule, lineBox, fontCss, paintBox] = await Promise.all([load("frontend-export.mjs"), load("document.mjs"),
      load("text-line-box.mjs"), load("font-css.mjs"), load("canvas/browser-paint-box.mjs")]);
    let inter = { alias: "DSSnapProbeInter", loaded: false };
    try { const face = new FontFace(inter.alias, "url(" + JSON.stringify(new URL("fonts/InterVariable.woff2", base).href) + ")", { weight: "100 900" });
      await face.load(); document.fonts.add(face); inter.loaded = true; } catch (error) { inter.error = String(error && error.message || error); }
    await document.fonts.ready;
    const dpr = window.devicePixelRatio;
    const env = { devicePixelRatio: dpr, screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth },
      innerWidth, innerHeight, outerWidth, outerHeight,
      resolution: [1, 1.5, 2, 3].filter(value => matchMedia("(resolution: " + value + "dppx)").matches) };
    // P1: layout positions of fractional offsets, plain and inside scale(2).
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:400px;height:60px;visibility:hidden;pointer-events:none;contain:layout";
    const layout = { plain: [], scaled: [] };
    for (const [key, transform] of [["plain", "none"], ["scaled", "scale(2)"]]) {
      const box = document.createElement("div"); box.style.cssText = "position:absolute;left:0;top:0;width:200px;height:20px;transform-origin:0 0;transform:" + transform;
      for (const offset of ${JSON.stringify(LAYOUT_OFFSETS)}) { const child = document.createElement("div");
        child.style.cssText = "position:absolute;top:0;height:1px;width:10.3px;left:" + offset + "px"; child.dataset.offset = String(offset); box.append(child); }
      host.append(box);
    }
    document.body.append(host);
    for (const [index, key] of ["plain", "scaled"].entries()) { const box = host.children[index], origin = box.getBoundingClientRect();
      for (const child of box.children) { const rect = child.getBoundingClientRect();
        layout[key].push({ requested: Number(child.dataset.offset), left: rect.left - origin.left, width: rect.width }); } }
    host.remove();
    // P2: Canvas2D metrics at 1x and dpr x (font size scaled) for the review fonts.
    const measure = document.createElement("canvas").getContext("2d");
    const fontSpecs = [["menlo-13", "400", 13, '"Menlo", monospace'], ["arial-600-14", "600", 14, '"Arial"'], ["arial-14", "400", 14, '"Arial"'],
      ["inter-app-600-32", "600", 32, fontCss.designFontFamilyCss("Inter")], ["inter-bytes-600-32", "600", 32, '"' + inter.alias + '"']];
    const fonts = fontSpecs.map(([id, weight, size, family]) => ({ id, family, checked: document.fonts.check(weight + " " + size + "px " + family, "Hg"),
      scales: [1, dpr].map(scale => { measure.font = weight + " " + size * scale + "px " + family; measure.textBaseline = "alphabetic";
        const a = measure.measureText("Hg"); measure.textBaseline = "hanging"; const h = measure.measureText("Hg");
        return { scale, fontSize: size * scale, fontAscent: a.fontBoundingBoxAscent, fontDescent: a.fontBoundingBoxDescent,
          inkAscent: a.actualBoundingBoxAscent, inkDescent: a.actualBoundingBoxDescent, hangingToAlphabetic: a.actualBoundingBoxAscent - h.actualBoundingBoxAscent }; }) }));
    // GPU pure-function inputs for the same nodes (installed modules).
    const design = documentModule.normalizeDesignDocument(JSON.parse(${JSON.stringify(logicalSource)}));
    const nodes = design.pages[0].nodes, boxes = paintBox.browserPaintBoxes(nodes), gpu = {};
    for (const node of nodes) {
      if (node.type === "text") {
        const font = (node.fontStyle || "normal") + " " + node.fontWeight + " " + node.fontSize + "px " + fontCss.designFontFamilyCss(node.fontFamily);
        measure.font = font; measure.textBaseline = "alphabetic";
        const hg = measure.measureText("Hg"), own = measure.measureText(node.text); measure.textBaseline = "hanging"; const hanging = measure.measureText("Hg");
        const metrics = { ascent: hg.fontBoundingBoxAscent, descent: hg.fontBoundingBoxDescent, hangingToAlphabetic: hg.actualBoundingBoxAscent - hanging.actualBoundingBoxAscent };
        const lineBoxOrigin = lineBox.textHasLineBoxOrigin(node), offset = lineBoxOrigin ? lineBox.textLineBoxAlphabeticOffset(node, metrics) : null;
        gpu[node.id] = { font, metrics, lineBoxOrigin, alphabeticOffset: offset, inkAscent: own.actualBoundingBoxAscent, inkDescent: own.actualBoundingBoxDescent,
          gpuBaselineWorld: lineBoxOrigin ? lineBox.textLineBoxBaselineY(node, 0, offset) : lineBox.textFiniteBaselineY(node, 0, metrics) };
      } else gpu[node.id] = { paintBox: boxes.nodes.get(node.id) ?? null, pivot: boxes.rotationPivots.get(node.id) ?? null, fallback: boxes.fallbackReasons.get(node.id) ?? null };
    }
    const markup = { css: exporter.designFrontendCss(design, { preserveWorldOrigin: true }), body: exporter.renderDesignFrontendPage(design, { preserveWorldOrigin: true }) };
    return { env, layout, fonts, inter, gpu, markup };
  })()`;
}

/** Mount the markup in a probe-owned open shadow root at the top-left corner; return layout rects. */
export function snapProbeMountSource({ markup, camera, size }) {
  return `(async () => {
    document.getElementById(${JSON.stringify(PROBE_HOST_ID)})?.remove();
    const host = document.createElement("div"); host.id = ${JSON.stringify(PROBE_HOST_ID)};
    host.style.cssText = "all:initial;position:fixed;left:0;top:0;width:${size.width}px;height:${size.height}px;overflow:hidden;background:#ffffff;z-index:2147483647;contain:strict";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = "<style>" + ${JSON.stringify(markup.css)} + "\\n.cs-page{margin:0!important;overflow:visible!important}</style>" +
      '<div class="snap-world" style="position:absolute;left:0;top:0;transform-origin:0 0;transform:translate(${camera.panX}px,${camera.panY}px) scale(${camera.zoom})">' +
      ${JSON.stringify(markup.body)} + "</div>";
    document.body.append(host);
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const hostRect = host.getBoundingClientRect(), cases = {};
    for (const element of root.querySelectorAll("[data-codeshell-id]")) {
      const id = element.getAttribute("data-codeshell-id"), rect = element.getBoundingClientRect(), value = { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); const first = walker.nextNode();
      if (first && first.textContent.trim()) {
        const range = document.createRange(); range.selectNodeContents(first);
        value.textRects = [...range.getClientRects()].map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
        const marker = document.createElement("span"); marker.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
        first.parentNode.insertBefore(marker, first); value.markerBaselineClientY = marker.getBoundingClientRect().top; marker.remove();
      }
      cases[id] = value;
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { host: { x: hostRect.x, y: hostRect.y, width: hostRect.width, height: hostRect.height }, dpr: window.devicePixelRatio, cases };
  })()`;
}
export function snapProbeUnmountSource() {
  return `(() => { document.getElementById(${JSON.stringify(PROBE_HOST_ID)})?.remove(); return true; })()`;
}
