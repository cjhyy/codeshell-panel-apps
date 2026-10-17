import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import { createDesignIndexPersistencePlan } from "../../../apps/design-studio/app/document-index.mjs";
import { createDesignResourcePersistencePlan } from "../../../apps/design-studio/app/resource-store.mjs";

const root = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const origin = "https://gpu-renderer.test";
const path = "designs/gpu-renderer.codesign.json";
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; object-src 'none'; base-uri 'none'";
const hash = (value) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const node = (id, type, x, y, width, height, extra = {}) => ({
  id, type, name: id, x, y, width, height,
  fill: "#000000", stroke: "transparent", strokeWidth: 0,
  opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false,
  ...(["frame", "component", "group"].includes(type)
    ? { layout: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start" }
    : {}),
  ...extra,
});

function designFixture({ large = false } = {}) {
  return normalizeDesignDocument({
    format: "codeshell.design", version: 3, name: "GPU editor fixture",
    canvas: { width: 1000, height: 700, background: "#ffffff" },
    tokens: { colors: [] }, resources: [], activePageId: "page-1",
    pages: [
      { id: "page-1", name: "Shapes", children: [
        node("red", "rectangle", 100, 100, 100, 80, { fill: "#ff0000" }),
        node("rotated", "rectangle", 330, 100, 100, 24, { fill: "#0000ff", rotation: 90 }),
        node("heading", "text", 120, 300, 280, 60, {
          text: "WWWWWW", fontFamily: "Arial", fontSize: 40, fontWeight: 700,
          lineHeight: 1.2, textAlign: "left",
        }),
        node("clip", "frame", 560, 100, 200, 130, {
          fill: "transparent", opacity: 0.5, clipContent: true,
          children: [node("orange", "rectangle", 520, 80, 300, 180, { fill: "#ff8000", opacity: 0.5 })],
        }),
        node("gradient", "rectangle", 350, 450, 120, 70, {
          fillPaints: [{ type: "GRADIENT_LINEAR", opacity: 1,
            handles: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }],
            stops: [{ position: 0, color: "#000000", opacity: 1 }, { position: 1, color: "#ffffff", opacity: 1 }],
          }],
        }),
        node("far", "ellipse", 760, 500, 100, 80, { fill: "#00cc00" }),
        ...(large ? Array.from({ length: 300 }, (_, i) =>
          node(`bulk-${i}`, "rectangle", 20 + i % 100, 650, 1, 1, { fill: "#777777" })) : []),
      ] },
      { id: "page-2", name: "Other colors", children: [
        node("cyan", "rectangle", 100, 100, 100, 80, { fill: "#00aaff" }),
        node("magenta", "ellipse", 760, 500, 100, 80, { fill: "#ff00ff" }),
      ] },
    ],
  });
}

async function fixture(t, { capable = true, large = false, design = designFixture({ large }),
  primarySource = serializeDesignDocument(design), parts = [], allowMemoryRecovery = false } = {}) {
  // This is a correctness test. SwiftShader is allowed as the WebGL driver; no physical-GPU speed is claimed.
  const browser = await chromium.launch({ headless: true, args: ["--enable-webgl", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const source = primarySource;
  const files = new Map([[path, source], ...parts.map((part) => [part.path, part.content])]);
  const savedFiles = new Map(files);
  const records = new Map(), calls = [], errors = [], vendorRequests = [], blockedRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    try {
      assert.deepEqual(errors, [], "uncaught browser errors");
      assert.deepEqual(blockedRequests, [], "all fixture requests stay in the exact package origin");
      assert.deepEqual(await page.evaluate(() => window.cspViolations), [], "Wasm-specific CSP must suffice without unsafe-eval");
      assert.equal(calls.filter((call) => call.method === "workspace.writeText" &&
        (!allowMemoryRecovery || !call.path.startsWith("designs/codesign-data/recovery/"))).length, 0);
      for (const [savedPath, savedSource] of savedFiles) assert.equal(files.get(savedPath), savedSource);
    } finally { await browser.close(); }
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (url.origin !== origin || !file.startsWith(root + sep)) {
      blockedRequests.push(url.href);
      return route.abort();
    }
    if (url.pathname.startsWith("/canvas/vendor/")) vendorRequests.push(url.pathname);
    try {
      await route.fulfill({ body: await readFile(file), headers: { "Content-Security-Policy": csp },
        contentType: { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript",
          ".css": "text/css", ".wasm": "application/wasm", ".ttf": "font/ttf", ".woff2": "font/woff2" }[extname(file)],
      });
    } catch {
      await route.fulfill({ status: 404, body: "missing", headers: { "Content-Security-Policy": csp } });
    }
  });
  await page.exposeFunction("hostBridge", async (method, params = {}) => {
    calls.push({ method, ...structuredClone(params) });
    const snapshot = () => ({ exists: records.has(params.key), value: records.get(params.key) ?? null,
      revision: records.has(params.key) ? hash(records.get(params.key)) : null });
    if (method === "workspace.info") return { root: "/gpu-fixture", cwd: "/gpu-fixture", name: "Fixture" };
    if (method === "workspace.list") return { entries: [], truncated: false };
    if (method === "workspace.readText") {
      if (!files.has(params.path)) throw Error("ENOENT");
      const content = files.get(params.path);
      return { content, modifiedAt: 1, revision: hash(content) };
    }
    // The source design is immutable. All recovery/preferences live in this in-memory fake Host.
    if (method === "workspace.writeText") {
      if (!allowMemoryRecovery || !params.path.startsWith("designs/codesign-data/recovery/") || savedFiles.has(params.path))
        throw Error("Test must not write the saved source design");
      files.set(params.path, params.content);
      return { modifiedAt: 1, revision: hash(params.content) };
    }
    if (method === "storage.get") return params.key.startsWith("lastPath.")
      ? { workspaceRoot: "/gpu-fixture", path } : records.get(params.key) ?? null;
    if (method === "storage.set") { records.set(params.key, structuredClone(params.value)); return null; }
    if (method === "storage.delete") { records.delete(params.key); return null; }
    if (method === "storage.getSnapshot") return snapshot();
    if (method === "storage.compareAndSet") {
      if (params.expectedRevision !== snapshot().revision) return { updated: false, snapshot: snapshot() };
      if (params.remove) records.delete(params.key); else records.set(params.key, structuredClone(params.value));
      return { updated: true, snapshot: snapshot() };
    }
    throw Error(`Unsupported ${method}`);
  });
  await page.addInitScript(({ capable }) => {
    window.tools = {};
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
    window.codeshellPanel = {
      getContext: async () => ({ trusted: true, busy: false, cwd: "/gpu-fixture", sessionId: "gpu-fixture",
        capabilities: { packageAssets: { wasm: capable, fetch: "package" } },
        availableMethods: ["workspace.info", "workspace.list", "workspace.readText", "workspace.writeText",
          "storage.get", "storage.set", "storage.delete", "storage.getSnapshot", "storage.compareAndSet"],
      }),
      on() {},
      registerTool(name, callback) { window.tools[name] = callback; },
      call: (method, params) => window.hostBridge(method, params),
    };
  }, { capable });
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(async (name) => !document.querySelector(".workspace").inert &&
    Boolean(window.tools.get_design_metadata) && (await window.tools.get_design_metadata({})).name === name, design.name);
  assert.equal(await page.locator("#stage-wrap svg").count(), 0, "the editor uses only Canvas surfaces");
  const f = { page, source, records, calls, errors, vendorRequests, blockedRequests };
  return f;
}

async function frames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function active(page, expected = true, reason) {
  await page.waitForFunction(({ expected, reason }) =>
    document.querySelector("#stage-wrap").dataset.gpuActive === String(expected) &&
    (!reason || document.querySelector("#renderer-state").title.includes(reason)), { expected, reason });
  if (expected) assert.equal(await page.locator("#gpu-canvas").isVisible(), true);
  assert.equal(await page.locator("#stage-wrap svg").count(), 0, "there is no SVG scene or interaction fallback");
  await frames(page);
}
async function shot(page) { return PNG.sync.read(await page.locator("#gpu-canvas").screenshot()); }
const pixel = (png, x, y) => {
  assert(x >= 0 && x < png.width && y >= 0 && y < png.height, `pixel ${x},${y} is within ${png.width}x${png.height}`);
  return [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
};
function near(actual, expected, tolerance = 6) {
  assert(actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance), `${actual} != ${expected}`);
}
function colorBounds(png, rgb) {
  let left = png.width, top = png.height, right = -1, bottom = -1, count = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const offset = (y * png.width + x) * 4;
    if (!rgb.every((value, channel) => Math.abs(png.data[offset + channel] - value) <= 3)) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
  }
  assert(count > 10, `${rgb} has visible Canvas pixels`);
  return { left, top, right, bottom, count };
}
async function calibration(page, { color = [255, 0, 0], x = 100, y = 100 } = {}) {
  const png = await shot(page), b = colorBounds(png, color);
  // Derive the viewport from real pixels rather than private renderer state or hit DOM.
  const zoom = ((b.right - b.left + 1) / 100 + (b.bottom - b.top + 1) / 80) / 2;
  const pan = { x: (b.left + b.right) / 2 - (x + 50) * zoom,
    y: (b.top + b.bottom) / 2 - (y + 40) * zoom };
  const canvas = await page.locator("#gpu-canvas").boundingBox();
  return { zoom, pan, canvas };
}
function point(view, x, y) {
  const px = Math.round(view.pan.x + x * view.zoom), py = Math.round(view.pan.y + y * view.zoom);
  return { px, py, x: view.canvas.x + px, y: view.canvas.y + py };
}
function at(view, png, x, y) { const p = point(view, x, y); return pixel(png, p.px, p.py); }
function textInk(view, png) {
  const a = point(view, 120, 300), b = point(view, 400, 360);
  let count = 0;
  for (let y = a.py; y < b.py; y++) for (let x = a.px; x < b.px; x++)
    if (pixel(png, x, y).every((value) => value < 100)) count++;
  return count;
}
async function readNode(page, id) {
  return page.evaluate(async (id) => (await window.tools.get_design_context({ node_id: id })).node, id);
}
async function metadata(page) { return page.evaluate(() => window.tools.get_design_metadata({})); }
async function interactionPixels(page) {
  return page.locator("#stage").evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw Error("The interaction surface must be a Canvas");
    const ctx = canvas.getContext("2d"), pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let checksum = 0, painted = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]) painted++;
      checksum = (checksum + pixels[i] * 3 + pixels[i + 1] * 5 + pixels[i + 2] * 7 + pixels[i + 3] * 11) % 2147483647;
    }
    return { checksum, painted };
  });
}
async function selectLayer(page, id) { await page.locator(`.layer-row[data-id="${id}"]`).click(); }
async function editText(page, value) {
  await selectLayer(page, "heading");
  await page.locator("#stage").press("Enter");
  const editor = page.locator("#inline-text-editor");
  await editor.fill(value);
  await editor.press("Control+Enter");
}

test("the Canvas-only GPU scene preserves shapes, clipped alpha, rotation, gradient and glyphs under strict CSP", async (t) => {
  const f = await fixture(t);
  await active(f.page);
  assert(f.vendorRequests.includes("/canvas/vendor/canvaskit.js"));
  assert(f.vendorRequests.includes("/canvas/vendor/canvaskit.wasm"));
  assert.equal(await f.page.locator("#gpu-canvas").evaluate((canvas) => Boolean(canvas.getContext("webgl2"))), true);
  assert.equal(await f.page.locator("#canvas-renderer option[value=svg]").count(), 0);
  const view = await calibration(f.page), png = await shot(f.page);
  near(at(view, png, 150, 140), [255, 0, 0]);
  near(at(view, png, 380, 140), [0, 0, 255]);
  near(at(view, png, 335, 105), [255, 255, 255]);
  near(at(view, png, 600, 150), [255, 223, 191]);
  near(at(view, png, 540, 150), [255, 255, 255]);
  near(at(view, png, 410, 480), [128, 128, 128], 10);
  near(at(view, png, 810, 540), [0, 204, 0]);
  assert(textInk(view, png) > 300, "the complete heading has real glyph pixels");
  for (const [x, y, expected] of [[540, 150, null], [600, 150, "orange"], [380, 140, "rotated"]]) {
    const p = point(view, x, y);
    await f.page.mouse.click(p.x, p.y);
    assert.deepEqual((await metadata(f.page)).selection, expected ? [expected] : [], "Canvas hit testing follows clipping and rotation");
  }
});

test("2D Canvas selection, pointer dragging, inline editing and undo update the GPU picture", async (t) => {
  const { page } = await fixture(t);
  await active(page);
  const view = await calibration(page), unselected = await interactionPixels(page);
  await page.locator("#toggle-snap").click();
  await selectLayer(page, "red");
  assert.deepEqual((await metadata(page)).selection, ["red"]);
  assert.notEqual((await interactionPixels(page)).checksum, unselected.checksum, "selection is painted in the 2D interaction Canvas");
  const start = point(view, 150, 140);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 150, start.y, { steps: 5 });
  await page.mouse.up();
  await active(page);
  const moved = await readNode(page, "red");
  assert(moved.x > 200, `drag changed the model x: ${moved.x}`);
  const dragged = await shot(page);
  near(at(view, dragged, 150, 140), [255, 255, 255]);
  near(at(view, dragged, moved.x + 50, moved.y + 40), [255, 0, 0]);
  await page.locator("#stage").press("Control+z");
  await active(page);
  assert.equal((await readNode(page, "red")).x, 100);
  near(at(view, await shot(page), 150, 140), [255, 0, 0]);
  const originalInk = textInk(view, await shot(page));
  await editText(page, "I");
  await active(page);
  assert.equal((await readNode(page, "heading")).text, "I");
  const changedInk = textInk(view, await shot(page));
  assert(changedInk > 5 && changedInk < originalInk / 3, `${originalInk} heading pixels became ${changedInk}`);
  await page.locator("#stage").press("Control+z");
  await active(page);
  assert.equal((await readNode(page, "heading")).text, "WWWWWW");
  assert(textInk(view, await shot(page)) > originalInk * 0.9, "undo restores GPU glyphs");
});

test("page changes replace the GPU scene and every supported zoom retains the GPU renderer", async (t) => {
  const { page } = await fixture(t, { large: true });
  await active(page);
  await page.locator("#active-page").selectOption("page-2");
  await page.waitForFunction(async () => (await window.tools.get_design_metadata({})).activePageId === "page-2");
  await active(page);
  const otherView = await calibration(page, { color: [0, 170, 255] }), other = await shot(page);
  near(at(otherView, other, 150, 140), [0, 170, 255]);
  near(at(otherView, other, 810, 540), [255, 0, 255]);
  await page.locator("#active-page").selectOption("page-1");
  await page.waitForFunction(async () => (await window.tools.get_design_metadata({})).activePageId === "page-1");
  await active(page);
  near(at(await calibration(page), await shot(page), 150, 140), [255, 0, 0]);
  await selectLayer(page, "red");
  await page.locator("#stage").press("Shift+Digit2");
  await active(page);
  assert(parseFloat(await page.locator("#zoom-value").textContent()) > 100);
  await page.locator("#stage").press("Escape");
  await active(page);
  const high = colorBounds(await shot(page), [255, 0, 0]);
  while (parseFloat(await page.locator("#zoom-value").textContent()) > 10) {
    await page.locator("#zoom-out").click();
    await active(page);
  }
  const low = colorBounds(await shot(page), [255, 0, 0]);
  assert(high.count > low.count * 100, "real painted geometry scales from high zoom to 10%");
});
test("an unavailable Wasm capability fetches no renderer and presents an explicit unavailable state", async (t) => {
  const f = await fixture(t, { capable: false, large: true });
  await active(f.page, false, "wasm-unavailable");
  assert.deepEqual(f.vendorRequests, [], "neither CanvasKit JS nor Wasm is fetched without Host capability");
  assert.match(await f.page.locator("#renderer-state").textContent(), /不可用|不支持|unavailable/iu);
  assert.equal(await f.page.locator("#stage-wrap svg").count(), 0);
});

test("real WebGL context loss is explicit, never installs an SVG scene, and manual retry draws current edits", async (t) => {
  const { page, vendorRequests } = await fixture(t, { large: true });
  await active(page);
  await editText(page, "I");
  await active(page);
  assert.equal(await page.locator("#gpu-canvas").evaluate((canvas) => {
    const extension = canvas.getContext("webgl2").getExtension("WEBGL_lose_context");
    if (!extension) return false;
    window.lostContextExtension = extension;
    window.contextRestored = false;
    canvas.addEventListener("webglcontextrestored", () => { window.contextRestored = true; }, { once: true });
    extension.loseContext();
    return true;
  }), true, "the WebGL driver must support a real context-loss event");
  await active(page, false, "context-lost");
  assert.match(await page.locator("#renderer-state").textContent(), /丢失|不可用|失败|lost|unavailable/iu);
  const requestsBeforeZoom = vendorRequests.length;
  await page.locator("#zoom-in").click();
  await page.locator("#zoom-out").click();
  await active(page, false, "context-lost");
  assert.equal(vendorRequests.length, requestsBeforeZoom, "viewport changes do not silently retry a lost context");
  assert.equal((await readNode(page, "heading")).text, "I");
  await page.evaluate(() => window.lostContextExtension.restoreContext());
  await page.waitForFunction(() => window.contextRestored);
  await page.locator("#retry-renderer").click();
  await active(page);
  assert.equal((await readNode(page, "heading")).text, "I");
  const view = await calibration(page), currentInk = textInk(view, await shot(page));
  assert(currentInk > 5 && currentInk < 600, "retry draws the edited glyph instead of an old picture");
  await page.locator("#stage").press("Control+z");
  await active(page);
  assert.equal((await readNode(page, "heading")).text, "WWWWWW");
  assert(textInk(view, await shot(page)) > currentInk * 3);
});

// Opt in to private/local data; never commit its bytes, screenshots, or paths as a fixture.
if (process.env.GPU_PORTABLE_FIXTURE) test("an optional real portable design loads every layer/font and supports GPU drag/zoom", async (t) => {
  const original = await readFile(process.env.GPU_PORTABLE_FIXTURE);
  const portable = JSON.parse(original), design = normalizeDesignDocument(portable.document);
  const sha256 = async (value) => createHash("sha256").update(value).digest("hex");
  const plan = await createDesignIndexPersistencePlan({ document: design, sha256 });
  const descriptors = new Map(design.resources.map((resource) => [resource.id, resource])), parts = [...plan.parts];
  for (const resource of portable.resources) {
    const descriptor = descriptors.get(resource.id);
    assert(descriptor, `portable descriptor ${resource.id} exists`);
    const resourcePlan = await createDesignResourcePersistencePlan({ ...descriptor, base64: resource.base64, sha256Bytes: sha256 });
    assert.deepEqual(resourcePlan.descriptor, descriptor, "portable bytes match their original SHA and metadata");
    parts.push(...resourcePlan.parts);
  }
  const { page } = await fixture(t, { design, primarySource: plan.primarySource, parts, allowMemoryRecovery: true });
  await active(page);
  const meta = await metadata(page);
  assert.equal(meta.layers.length, design.nodes.length);
  assert.equal(meta.runtime.loadedResourceCount, design.resources.length);
  const complete = await shot(page);
  let painted = 0;
  for (let i = 0; i < complete.data.length; i += 4)
    if (complete.data[i] < 240 || complete.data[i + 1] < 240 || complete.data[i + 2] < 240) painted++;
  assert(painted > 500, "the real design has a nonblank GPU image");
  const index = new Map(design.nodes.map((n) => [n.id, n]));
  const target = design.nodes.find((n) => {
    if (!["frame", "rectangle", "ellipse", "image"].includes(n.type) || n.width < 80 || n.height < 30 || n.height > 400) return false;
    const seen = new Set();
    for (let current = n; current && !seen.has(current.id); current = index.get(current.parentId)) {
      if (!current.visible || current.locked) return false;
      seen.add(current.id);
    }
    return true;
  });
  assert(target, "the real design contains an unlocked visible shape");
  await page.locator("#layer-filter").fill(target.id);
  await selectLayer(page, target.id);
  await page.locator("#layer-filter").fill("");
  await page.locator("#stage").press("Shift+Digit2");
  await active(page);
  await page.locator("#stage").press("Escape");
  const canvas = await page.locator("#stage").boundingBox(), x = canvas.x + canvas.width / 2, y = canvas.y + canvas.height / 2;
  const before = await shot(page);
  await page.evaluate(() => {
    window.uiFrameSample = { frames: 0, started: performance.now(), running: true };
    const tick = () => { if (window.uiFrameSample.running) { window.uiFrameSample.frames++; requestAnimationFrame(tick); } };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  const selected = (await metadata(page)).selection[0];
  assert(selected, "Canvas geometry hit testing selects a real layer");
  const beforeNode = await readNode(page, selected);
  await page.mouse.move(x + 48, y + 24, { steps: 8 });
  await page.mouse.up();
  await active(page);
  await page.locator("#stage").press("Escape");
  const afterNode = await readNode(page, selected), after = await shot(page);
  assert(beforeNode.x !== afterNode.x || beforeNode.y !== afterNode.y, "real pointer drag changes model geometry");
  let changed = 0;
  for (let i = 0; i < before.data.length; i += 4)
    if ([0, 1, 2].some((channel) => Math.abs(before.data[i + channel] - after.data[i + channel]) > 20)) changed++;
  assert(changed > 100, "a real edit changes the GPU image");
  await page.locator("#zoom-out").click();
  await active(page);
  const sample = await page.evaluate(() => {
    window.uiFrameSample.running = false;
    return { rafCallbacks: window.uiFrameSample.frames, elapsedMs: performance.now() - window.uiFrameSample.started };
  });
  assert(sample.rafCallbacks > 0);
  t.diagnostic(JSON.stringify({ nodes: design.nodes.length, loadedResources: meta.runtime.loadedResourceCount,
    paintedPixels: painted, changedPixels: changed, ...sample,
    measurement: "correctness smoke only; rAF count is not FPS or an engine benchmark" }));
  assert.deepEqual(await readFile(process.env.GPU_PORTABLE_FIXTURE), original, "the saved portable source remains byte-identical");
});
