/* Electron-specific Design Studio fidelity steps.
 *
 * Called by scripts/check-panel-desktop.mjs, behind --design-studio-fidelity, with
 * handles that the existing owned-Electron harness already created: the real Panel
 * guest (installed package, production preload/IPC) and the Playwright Electron app.
 * This module never launches Electron or Chromium, never installs/builds anything
 * and adds no production debug surface. Every observation is real UI/DOM state,
 * on-disk project bytes, real input events, capturePage pixels or CDP metrics.
 * Anything the installed app does not expose is reported UNVERIFIED.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import {
  FIDELITY_FIXTURE_PATHS, FIDELITY_STATUS, OPEN_WAIT_MIN_MS,
  judgeImmediateClick, judgeLowZoomPerformance, judgeOpenWithoutEdit, judgeSaveReopen, judgeSvgCornerProbe,
  judgeVisualCaptureGroup, planDesignStudioFidelityScenarios, summarizeFidelityReport, svgReferenceGeometry,
} from "./design-studio-host-fidelity.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const SEVERITY = [FIDELITY_STATUS.PASS, FIDELITY_STATUS.EVIDENCE_ONLY, FIDELITY_STATUS.UNVERIFIED, FIDELITY_STATUS.FAIL];
const worst = statuses => statuses.reduce((a, b) => (SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a), FIDELITY_STATUS.PASS);
const REFERENCE_PROTOCOLS = ["data:", "blob:", "about:"];

/**
 * Render static HTML in an owned hidden BrowserWindow of the same Electron/Chromium,
 * with JavaScript disabled and every non data/blob/about request cancelled. The
 * window is destroyed in finally, including after a capture failure.
 */
export async function captureReferenceHtml(app, { html, width, height }) {
  return app.evaluate(async ({ BrowserWindow, session }, { html, width, height, allowed, partition }) => {
    const blockedRequests = [];
    const reference = session.fromPartition(partition);
    reference.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, done) => {
      let protocol = "";
      try { protocol = new URL(details.url).protocol.toLowerCase(); } catch { protocol = ""; }
      const cancel = !allowed.includes(protocol);
      if (cancel) blockedRequests.push(details.url);
      done({ cancel });
    });
    const window = new BrowserWindow({ show: false, width, height, useContentSize: true, frame: false,
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false,
        paintWhenInitiallyHidden: true, backgroundThrottling: false } });
    try {
      const loaded = new Promise(resolve => window.webContents.once("did-finish-load", resolve));
      await window.webContents.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`);
      await loaded;
      await new Promise(resolve => setTimeout(resolve, 300));
      const image = await window.webContents.capturePage();
      return { pngBase64: image.toPNG().toString("base64"), size: image.getSize(), blockedRequests };
    } finally {
      if (!window.isDestroyed()) window.destroy();
    }
  }, { html, width, height, allowed: REFERENCE_PROTOCOLS, partition: `ds-fidelity-reference-${Date.now()}-${Math.random().toString(16).slice(2)}` });
}

function pngEvidence(buffer) {
  const image = PNG.sync.read(buffer);
  const colors = new Set();
  for (let index = 0; index < image.data.length; index += 4) colors.add(image.data.readUInt32BE(index));
  return { image, summary: { sha256: sha256(buffer), width: image.width, height: image.height, distinctColors: colors.size, bytes: buffer.length } };
}

const hexRgb = value => [1, 3, 5].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));

export async function runDesignStudioHostFidelity(options) {
  if (options?.enabled !== true) throw new Error("Design Studio fidelity requires explicit --design-studio-fidelity opt-in");
  const { guest, guestWebContentsId, app, projectDirectory, packageDirectory, fixtures, seededStates = {},
    sampleReceipt = null, artifactsDirectory = null, log = () => {} } = options;
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? (() => performance.now());
  const timeoutMs = options.timeoutMs ?? 30_000;
  const plan = planDesignStudioFidelityScenarios({ sample: Boolean(sampleReceipt) });
  const module = path => import(pathToFileURL(join(packageDirectory, "app", path)).href);
  const codec = await module("document.mjs");
  const textMetrics = await module("text-metrics.mjs");
  const frontend = await module("frontend-export.mjs");
  const svgMetrics = await import(new URL("../tests/apps/design-studio/svg-semantic-metrics.mjs", import.meta.url).href);
  const packageModules = {};
  for (const path of ["document.mjs", "text-metrics.mjs", "frontend-export.mjs"])
    packageModules[path] = sha256(await readFile(join(packageDirectory, "app", path)));

  const dom = source => guest.execute(source);
  const fileState = async relativePath => {
    const path = join(projectDirectory, relativePath);
    const [bytes, value] = await Promise.all([readFile(path), stat(path)]);
    return { sha256: sha256(bytes), mtimeMs: value.mtimeMs, size: value.size };
  };
  const evaluateMain = (fn, argument) => app.evaluate(fn, argument);
  const sendInput = events => evaluateMain(({ webContents }, { id, events }) => {
    const contents = webContents.fromId(id);
    for (const event of events) contents.sendInputEvent(event);
    return true;
  }, { id: guestWebContentsId, events });
  const click = (x, y, modifiers = []) => sendInput([
    { type: "mouseDown", x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1, modifiers },
    { type: "mouseUp", x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1, modifiers }]);
  const keys = (keyCode, modifiers = []) => sendInput([{ type: "keyDown", keyCode, modifiers }, { type: "keyUp", keyCode, modifiers }]);
  const until = async (source, label) => {
    const deadline = now() + timeoutMs;
    for (;;) {
      if (await dom(source) === true) return true;
      if (now() >= deadline) throw new Error(`timed out waiting for ${label}`);
      await wait(50);
    }
  };
  const saveState = () => dom(`(() => { const e = document.querySelector("#save-state");
    return e ? { kind: e.dataset.kind ?? null, text: e.textContent ?? "" } : null; })()`);
  const selectedIds = () => dom(`(() => { const list = document.querySelector("#layers-list");
    return list ? [...list.querySelectorAll('.layer-row[aria-selected="true"]')].map(row => row.dataset.id) : null; })()`);
  const layerIds = () => dom(`(() => { const list = document.querySelector("#layers-list");
    return list ? [...list.querySelectorAll(".layer-row[data-id]")].map(row => row.dataset.id) : null; })()`);
  const inspectorXY = () => dom(`(() => { const x = document.querySelector("#prop-x"), y = document.querySelector("#prop-y");
    return x && y && x.value !== "" ? { x: Number(x.value), y: Number(y.value) } : null; })()`);
  // The overlay 2D context keeps [dpr*zoom, 0, 0, dpr*zoom, dpr*pan.x, dpr*pan.y].
  const camera = () => dom(`(() => { const stage = document.querySelector("#stage"); if (!stage) return null;
    const rect = stage.getBoundingClientRect(); const ratio = stage.width / rect.width; const t = stage.getContext("2d").getTransform();
    if (!(ratio > 0) || !(t.a > 0)) return null;
    return { zoom: t.a / ratio, panX: t.e / ratio, panY: t.f / ratio, dpr: window.devicePixelRatio, canvasRatio: ratio,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }; })()`);
  const toClient = (cam, x, y) => ({ x: cam.rect.x + cam.zoom * x + cam.panX, y: cam.rect.y + cam.zoom * y + cam.panY });
  const rendererReady = `document.querySelector("#stage-wrap")?.dataset.rendererStatus === "active"`;
  const chooseRenderer = async mode => {
    await dom(`(() => { const select = document.querySelector("#renderer-mode"); if (!select) return false;
      if (select.value !== ${JSON.stringify(mode)}) { select.value = ${JSON.stringify(mode)}; select.dispatchEvent(new Event("change", { bubbles: true })); }
      return true; })()`);
    await until(`document.querySelector("#stage-wrap")?.dataset.rendererMode === ${JSON.stringify(mode)} && ${rendererReady}`, `${mode} renderer`);
    await wait(400); // beyond the 150ms device-phase resampling idle
  };
  const openFile = async relativePath => {
    await dom(`document.querySelector("#open-files")?.click(), true`);
    await until(`[...document.querySelectorAll("#files-list .file-row")].some(row => row.textContent.includes(${JSON.stringify(relativePath)}))`, `file row ${relativePath}`);
    await dom(`[...document.querySelectorAll("#files-list .file-row")].find(row => row.textContent.includes(${JSON.stringify(relativePath)}))?.click(), true`);
    await until(`document.querySelector("#path")?.value.trim() === ${JSON.stringify(relativePath)} && document.querySelector("#save-state")?.textContent !== "打开中…" && !document.querySelector("#files-dialog")?.open && ${rendererReady}`, `open ${relativePath}`);
  };
  const zoomTo = async target => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const cam = await camera();
      if (!cam) return null;
      if (Math.abs(cam.zoom - target) <= 1e-6) return cam;
      const center = { x: Math.round(cam.rect.x + cam.rect.width / 2), y: Math.round(cam.rect.y + cam.rect.height / 2) };
      // App zoom: zoom * exp(-deltaY * 0.006) around the cursor.
      const deltaY = -Math.log(target / cam.zoom) / 0.006;
      await sendInput([{ type: "mouseWheel", x: center.x, y: center.y, deltaX: 0, deltaY, modifiers: ["control"], canScroll: true }]);
      await wait(250);
    }
    return camera();
  };
  const capture = async (cam, label) => {
    const result = await evaluateMain(async ({ webContents }, { id, rect }) => {
      const image = await webContents.fromId(id).capturePage(rect);
      return { pngBase64: image.toPNG().toString("base64"), size: image.getSize() };
    }, { id: guestWebContentsId, rect: { x: Math.round(cam.rect.x), y: Math.round(cam.rect.y), width: Math.round(cam.rect.width), height: Math.round(cam.rect.height) } });
    return saveArtifact(label, Buffer.from(result.pngBase64, "base64"));
  };
  const saveArtifact = async (label, buffer) => {
    const evidence = pngEvidence(buffer);
    if (artifactsDirectory) {
      await mkdir(artifactsDirectory, { recursive: true });
      const path = join(artifactsDirectory, `${label}.png`);
      await writeFile(path, buffer, { flag: "wx", mode: 0o600 });
      evidence.summary.path = path;
    }
    return evidence;
  };
  const documentAt = async relativePath => codec.normalizeDesignDocument(JSON.parse(await readFile(join(projectDirectory, relativePath), "utf8")));
  const referenceHtml = (design, cam) => {
    const css = frontend.designFrontendCss(design, { preserveWorldOrigin: true });
    const body = frontend.renderDesignFrontendPage(design, { preserveWorldOrigin: true });
    return `<!doctype html><meta charset="utf-8"><style>${css}\nhtml,body{margin:0;background:${design.canvas.background};overflow:hidden}` +
      `#export-world{position:absolute;left:0;top:0;transform-origin:0 0;transform:translate(${cam.panX}px,${cam.panY}px) scale(${cam.zoom})}` +
      `.cs-page{margin:0!important;overflow:visible!important}</style><div id="export-world">${body}</div>`;
  };

  const results = [];
  async function scenario(id, body) {
    log(`design-studio fidelity: ${id}`);
    try { results.push({ id, ...(await body()) }); }
    catch (error) { results.push({ id, status: FIDELITY_STATUS.UNVERIFIED, reasons: [`harness step failed: ${error?.message ?? error}`] }); }
  }
  const sampleSaveStates = async () => {
    const started = now(), samples = [];
    for (;;) {
      const elapsed = now() - started;
      const state = await saveState();
      samples.push({ atMs: Math.round(elapsed), kind: state?.kind, text: state?.text });
      if (elapsed >= OPEN_WAIT_MIN_MS + 200) break;
      await wait(250);
    }
    return { samples, waitedMs: Math.round(now() - started) };
  };

  await scenario("open-without-edit", async () => {
    const targets = [FIDELITY_FIXTURE_PATHS.legacyReceipts, ...(sampleReceipt ? [sampleReceipt.relativePath] : [])];
    const opened = [];
    for (const relativePath of targets) {
      const before = seededStates[relativePath] ?? await fileState(relativePath);
      await openFile(relativePath);
      const { samples, waitedMs } = await sampleSaveStates();
      const after = await fileState(relativePath);
      const verdict = judgeOpenWithoutEdit({ path: relativePath, waitedMs, before, after, saveStates: samples });
      const design = await documentAt(relativePath);
      const staleReceipts = design.pages.flatMap(page => page.nodes).filter(node => node.type === "text" && node.textMetrics &&
        textMetrics.currentTextMetrics(node) === null).map(node => node.id);
      opened.push({ path: relativePath, before, after, waitedMs, saveStates: samples, staleReceiptsRetained: staleReceipts, ...verdict });
    }
    return { status: worst(opened.map(value => value.status)), opened };
  });

  const P = FIDELITY_FIXTURE_PATHS.interaction;
  let interactionEdited = false;
  await scenario("immediate-click-after-edit", async () => {
    await openFile(P);
    await chooseRenderer("gpu");
    await dom(`document.querySelector("#zoom-value")?.click(), true`);
    await wait(400);
    const cam = await camera();
    if (!cam) return { status: FIDELITY_STATUS.UNVERIFIED, reasons: ["#stage camera transform not observable"] };
    const centre = (x, y) => toClient(cam, x, y);
    const operations = [];
    const clickAndRead = async (label, point, expectedSelectedIds, committedAt) => {
      const sentAt = now();
      await click(point.x, point.y);
      const actualSelectedIds = await selectedIds();
      return { label, point, expectedSelectedIds, actualSelectedIds, elapsedSinceCommitMs: Math.round(sentAt - committedAt) };
    };
    // 1. Real drag: select, then drag +260 world px (onto the underlay; target is on top).
    const start = centre(180, 180);
    await click(start.x, start.y);
    const geometryBefore = await inspectorXY();
    const end = centre(440, 180), steps = 8, moves = [];
    for (let step = 1; step <= steps; step++)
      moves.push({ type: "mouseMove", x: Math.round(start.x + (end.x - start.x) * step / steps), y: Math.round(start.y), button: "left", modifiers: [] });
    await sendInput([{ type: "mouseDown", x: Math.round(start.x), y: Math.round(start.y), button: "left", clickCount: 1, modifiers: [] }, ...moves,
      { type: "mouseUp", x: Math.round(end.x), y: Math.round(end.y), button: "left", clickCount: 1, modifiers: [] }]);
    let committedAt = now();
    const dragClicks = [await clickAndRead("new-position", end, ["move-target"], committedAt),
      await clickAndRead("old-position", start, [], committedAt)];
    await click(end.x, end.y);
    const geometryAfter = await inspectorXY();
    dragClicks.push(await clickAndRead("underlay-only", centre(545, 250), ["underlay"], committedAt));
    operations.push({ operation: "drag", targetId: "move-target", geometryBefore, geometryAfter, clicks: dragClicks });
    // 2. Inspector x edit back to 120, then immediate clicks.
    await click(end.x, end.y);
    const inspectorBefore = await inspectorXY();
    await dom(`(() => { const input = document.querySelector("#prop-x"); if (!input) return false; input.value = "120";
      input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    committedAt = now();
    const inspectorClicks = [await clickAndRead("new-position", centre(180, 180), ["move-target"], committedAt),
      await clickAndRead("old-position", centre(480, 180), ["underlay"], committedAt)];
    await click(centre(180, 180).x, centre(180, 180).y);
    operations.push({ operation: "inspector-x", targetId: "move-target", geometryBefore: inspectorBefore, geometryAfter: await inspectorXY(), clicks: inspectorClicks });
    // 3. Inline text edit: Enter opens the editor, insertText, Cmd/Ctrl+Enter commits.
    const text = centre(160, 332);
    await click(text.x, text.y);
    const textBefore = await inspectorXY();
    await keys("Enter");
    await until(`(() => { const e = document.querySelector("#inline-text-editor"); return Boolean(e && !e.hidden && document.activeElement === e); })()`, "inline text editor");
    await evaluateMain(({ webContents }, { id }) => { const contents = webContents.fromId(id); contents.selectAll(); contents.insertText("Edited HMI 已编辑"); return true; }, { id: guestWebContentsId });
    await keys("Enter", [process.platform === "darwin" ? "meta" : "control"]);
    committedAt = now();
    const textClicks = [await clickAndRead("new-position", text, ["edit-target"], committedAt),
      await clickAndRead("old-position", centre(160, 420), [], committedAt)];
    await click(text.x, text.y);
    const committedText = await dom(`document.querySelector("#prop-text")?.value ?? null`);
    operations.push({ operation: "text-edit", targetId: "edit-target", geometryBefore: textBefore, geometryAfter: await inspectorXY(), clicks: textClicks, committedText });
    interactionEdited = true;
    const verdicts = operations.map(operation => ({ ...operation, ...judgeImmediateClick(operation) }));
    if (committedText !== "Edited HMI 已编辑") verdicts.at(-1).status = worst([verdicts.at(-1).status, FIDELITY_STATUS.UNVERIFIED]);
    return { status: worst(verdicts.map(value => value.status)), camera: cam, operations: verdicts };
  });

  await scenario("low-zoom-fractional-performance", async () => {
    const relativePath = FIDELITY_FIXTURE_PATHS.largeText;
    await openFile(relativePath);
    await chooseRenderer("gpu");
    const design = await documentAt(relativePath);
    const textNodeCount = design.pages.flatMap(page => page.nodes).filter(node => node.type === "text").length;
    await zoomTo(0.3711);
    await dom(`(() => { const state = window.__designStudioHostFidelityFrames = { times: [], running: true };
      const tick = time => { if (!state.running) return; state.times.push(time); requestAnimationFrame(tick); };
      requestAnimationFrame(tick); return true; })()`);
    const metrics = () => evaluateMain(async ({ webContents }, { id }) => {
      const contents = webContents.fromId(id);
      const attached = contents.debugger.isAttached();
      if (!attached) contents.debugger.attach("1.3");
      try {
        await contents.debugger.sendCommand("Performance.enable");
        return Object.fromEntries((await contents.debugger.sendCommand("Performance.getMetrics")).metrics.map(value => [value.name, value.value]));
      } finally { if (!attached) contents.debugger.detach(); }
    }, { id: guestWebContentsId });
    const before = await metrics();
    const cam0 = await camera();
    for (let index = 0; index < 30; index++) {
      await sendInput([{ type: "mouseWheel", x: Math.round(cam0.rect.x + cam0.rect.width / 2), y: Math.round(cam0.rect.y + cam0.rect.height / 2),
        deltaX: index % 2 ? 3 : -2, deltaY: index % 3 ? 5 : -4, canScroll: true }]);
      await wait(16);
    }
    await wait(400);
    const after = await metrics();
    const times = await dom(`(() => { const state = window.__designStudioHostFidelityFrames; state.running = false;
      delete window.__designStudioHostFidelityFrames; return state.times; })()`);
    const intervalsMs = Array.isArray(times) ? times.slice(1).map((time, index) => time - times[index]) : [];
    const sorted = [...intervalsMs].sort((a, b) => a - b), pick = q => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
    const cam = await camera();
    const delta = key => before && after && Number.isFinite(after[key] - before[key]) ? (after[key] - before[key]) * 1000 : null;
    const observation = { textNodeCount, camera: cam && { zoom: cam.zoom, panX: cam.panX, panY: cam.panY, dpr: cam.canvasRatio },
      frames: { count: intervalsMs.length, intervalsMs, p50Ms: pick(.5), p95Ms: pick(.95), maxMs: sorted.at(-1) ?? null },
      cpu: { scriptDurationMs: delta("ScriptDuration"), taskDurationMs: delta("TaskDuration"), layoutDurationMs: delta("LayoutDuration"),
        recalcStyleDurationMs: delta("RecalcStyleDuration") },
      // The installed app keeps CanvasKit stats() private; no reviewed read-only surface exists.
      renderer: null };
    return { ...judgeLowZoomPerformance(observation), observation };
  });

  await scenario("save-reopen-stable", async () => {
    if (!interactionEdited) return { status: FIDELITY_STATUS.UNVERIFIED, reasons: ["edit scenario did not complete"] };
    await openFile(P);
    const save = async () => {
      await dom(`(() => { const menu = document.querySelector("#compact-actions"); if (menu && !menu.open) menu.querySelector("summary")?.click();
        document.querySelector("#save")?.click(); return true; })()`);
      await until(`["saved", "error"].includes(document.querySelector("#save-state")?.dataset.kind)`, "save completion");
      return (await saveState())?.kind ?? null;
    };
    const layerIdsBefore = await layerIds();
    const saveStateAfterSave = await save();
    const saved = await fileState(P);
    await save();
    const resaved = await fileState(P);
    const canonicalSha256 = sha256(codec.serializeDesignDocument(await documentAt(P)));
    await guest.view.evaluate(view => view.reload());
    await until(`Boolean(window.codeshellPanel) && document.querySelector("#path")?.value.trim() === ${JSON.stringify(P)} && ${rendererReady}`, "reopen after reload");
    const { samples, waitedMs } = await sampleSaveStates();
    const reopened = await fileState(P);
    const observation = { path: P, saved, resaved, reopened, canonicalSha256, saveStateAfterSave, layerIdsBefore,
      layerIdsAfterReopen: await layerIds(), dirtyAfterReopen: samples.at(-1)?.kind ?? null, reopenSaveStates: samples, waitedMs };
    return { ...judgeSaveReopen(observation), observation };
  });

  await scenario("same-camera-visual", async () => {
    const relativePath = FIDELITY_FIXTURE_PATHS.rotationStrips;
    await openFile(relativePath);
    const design = await documentAt(relativePath);
    const samples = Object.fromEntries(["chevron-group", "prompt-glyph-group", "button-frame", "finite-sample"].map(id => {
      const node = design.pages[0].nodes.find(value => value.id === id);
      return [id, { x: node.x, y: node.y, width: node.width, height: node.height }];
    }));
    const groups = [];
    for (const target of [{ label: "100", zoom: 1 }, { label: "200", zoom: 2 }, { label: "fit" }]) {
      await chooseRenderer("gpu");
      if (target.zoom) await zoomTo(target.zoom); else { await dom(`document.querySelector("#zoom-value")?.click(), true`); await wait(400); }
      const captures = [];
      for (const route of ["gpu", "browser"]) {
        await chooseRenderer(route);
        const cam = await camera();
        const evidence = await capture(cam, `visual-${target.label}-${route}`);
        captures.push({ route, camera: { zoom: cam.zoom, panX: cam.panX, panY: cam.panY, dpr: cam.canvasRatio }, png: evidence.summary,
          rect: cam.rect, crops: Object.fromEntries(Object.entries(samples).map(([id, box]) => {
            const origin = { x: cam.zoom * box.x + cam.panX, y: cam.zoom * box.y + cam.panY };
            return [id, { x: origin.x * cam.canvasRatio, y: origin.y * cam.canvasRatio, width: box.width * cam.zoom * cam.canvasRatio, height: box.height * cam.zoom * cam.canvasRatio }];
          })) });
      }
      const cam = captures[0].camera, rect = captures[0].rect;
      const reference = await captureReferenceHtml(app, { html: referenceHtml(design, cam), width: Math.round(rect.width), height: Math.round(rect.height) });
      const evidence = await saveArtifact(`visual-${target.label}-html`, Buffer.from(reference.pngBase64, "base64"));
      captures.push({ route: "html", camera: { ...cam, dpr: evidence.summary.width / Math.round(rect.width) }, png: evidence.summary, rect,
        blockedRequests: reference.blockedRequests, crops: captures[0].crops });
      groups.push({ label: target.label, captures, ...judgeVisualCaptureGroup({ label: target.label, captures }) });
    }
    await chooseRenderer("gpu");
    return { status: worst(groups.map(group => group.status)), groups };
  });

  await scenario("svg-corner-aa-host", async () => {
    const relativePath = FIDELITY_FIXTURE_PATHS.svgCornerAa;
    await openFile(relativePath);
    await chooseRenderer("gpu");
    await zoomTo(1);
    const design = await documentAt(relativePath);
    const nodes = design.pages[0].nodes;
    const probes = nodes.filter(node => node.id.startsWith("svg-corner-"));
    const svg = codec.exportDesignSvg(design);
    const geometry = svgReferenceGeometry(svg);
    if (!geometry) return { status: FIDELITY_STATUS.UNVERIFIED, reasons: ["exported SVG has no parsable viewBox/width/height"] };
    const viewport = { width: Math.ceil(geometry.viewport.width), height: Math.ceil(geometry.viewport.height) };
    const reference = await captureReferenceHtml(app, { html: `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${design.canvas.background}}svg{display:block}</style>${svg.replace(/^<\?xml[^>]*>\s*/u, "")}`,
      ...viewport });
    const svgEvidence = await saveArtifact("svg-corner-aa-svg", Buffer.from(reference.pngBase64, "base64"));
    const svgDpr = svgEvidence.summary.width / viewport.width;
    const rows = [];
    const background = hexRgb("#f3f4f1");
    for (const node of probes) {
      const shape = { type: "rectangle", ...geometry.toDevice(node, svgDpr), radius: 0 };
      const semantic = svgMetrics.compareSvgSemantics(svgEvidence.image, { shape, paint: "fill" }, { foreground: hexRgb(node.fill), background });
      const { rasters: _rasters, ...semanticSummary } = semantic;
      rows.push({ nodeId: node.id, route: "svg", dpr: svgDpr, zoom: 1, authored: { x: node.x, y: node.y, width: node.width, height: node.height },
        deviceShape: shape, semantic: semanticSummary, ...judgeSvgCornerProbe({ dpr: svgDpr, semantic }) });
    }
    const hostRoutes = [];
    for (const route of ["gpu", "browser"]) {
      await chooseRenderer(route);
      const cam = await camera();
      const evidence = await capture(cam, `svg-corner-aa-${route}`);
      const descriptive = probes.map(node => {
        const shape = { type: "rectangle", x: cam.canvasRatio * (cam.zoom * node.x + cam.panX), y: cam.canvasRatio * (cam.zoom * node.y + cam.panY),
          width: cam.canvasRatio * cam.zoom * node.width, height: cam.canvasRatio * cam.zoom * node.height, radius: 0 };
        const { rasters: _rasters, ...semantic } = svgMetrics.compareSvgSemantics(evidence.image, { shape, paint: "fill" }, { foreground: hexRgb(node.fill), background });
        return { nodeId: node.id, semantic };
      });
      hostRoutes.push({ route, camera: { zoom: cam.zoom, panX: cam.panX, panY: cam.panY, dpr: cam.canvasRatio }, png: evidence.summary,
        descriptiveOnly: "GPU/browser rows use the SVG oracle descriptively; the approved contract gates only exported SVG", rows: descriptive });
    }
    await chooseRenderer("gpu");
    return { status: worst(rows.map(row => row.status)), svg: { png: svgEvidence.summary, blockedRequests: reference.blockedRequests, rows }, hostRoutes };
  });

  return { plan, packageModules, sampleReceipt, results, summary: summarizeFidelityReport(results, plan),
    fixtures: fixtures.map(({ relativePath, purpose, sha256: digest }) => ({ relativePath, purpose, sha256: digest })),
    approval: "The --design-studio-fidelity flag is a technical opt-in only; it is not user approval to open a Host window." };
}
