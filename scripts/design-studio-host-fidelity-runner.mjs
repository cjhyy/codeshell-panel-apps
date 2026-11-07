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
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import {
  FIDELITY_FIXTURE_PATHS, FIDELITY_STATUS, INTERACTION_PLAN, OPEN_WAIT_MIN_MS, ZOOM_TOLERANCE, expectedStateAfterEdits, guardPreEdit, pageCropRect,
  readFixtureDocument, zoomMatches,
  judgeImmediateClick, judgeLowZoomPerformance, judgeOpenWithoutEdit, judgeSaveReopen, judgeSvgCornerProbe,
  judgeVisualCaptureGroup, planDesignStudioFidelityScenarios, summarizeFidelityReport, svgReferenceGeometry,
} from "./design-studio-host-fidelity.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const SEVERITY = [FIDELITY_STATUS.PASS, FIDELITY_STATUS.EVIDENCE_ONLY, FIDELITY_STATUS.UNVERIFIED, FIDELITY_STATUS.FAIL];
const worst = statuses => statuses.reduce((a, b) => (SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a), FIDELITY_STATUS.PASS);
const REFERENCE_PROTOCOLS = ["data:", "blob:", "about:"];

/**
 * Run one owned operation with a local deadline that covers the operation, its
 * cancellation and the wait for settlement together: it returns or throws within
 * timeoutMs + settleTimeoutMs even if both the operation and cancel() hang. On
 * timeout the error carries `cleanup: { operationSettled, cancelState }`; it is
 * `unsettled` when the operation is still pending or cancel did not resolve, and
 * the caller must then abort and hand over to the existing owned-process cleanup.
 * Never signals any process itself.
 */
export async function boundedOwnedOperation(operation, { label, timeoutMs, settleTimeoutMs, cancel }) {
  let operationSettled = false;
  const pending = Promise.resolve().then(operation).finally(() => { operationSettled = true; });
  const first = await raceTimer(pending.then(value => ({ value }), error => ({ error })), timeoutMs);
  if (first !== TIMED_OUT) {
    if ("error" in first) throw first.error;
    return first.value;
  }
  const error = new Error(`${label} timed out after ${timeoutMs}ms`);
  error.timedOut = true;
  let cancelState = cancel ? "pending" : "resolved";
  const cancelled = cancel ? Promise.resolve().then(cancel).then(() => { cancelState = "resolved"; },
    cancelError => { cancelState = `rejected: ${cancelError?.message ?? cancelError}`; }) : Promise.resolve();
  await raceTimer(Promise.allSettled([cancelled, pending]), settleTimeoutMs);
  error.cleanup = { operationSettled, cancelState };
  error.unsettled = !operationSettled || cancelState !== "resolved";
  if (error.unsettled) error.message += `; cleanup incomplete within ${settleTimeoutMs}ms (operation ${operationSettled ? "settled" : "pending"}, cancel ${cancelState})`;
  throw error;
}
async function raceTimer(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), ms); })]); }
  finally { clearTimeout(timer); }
}

/**
 * Idempotent, bounded removal of the one owned fidelity guest. The runner (on a
 * timeout) and the caller's finally share this instance, so remove() is invoked at
 * most once; a remove() that hangs on the same renderer channel is reported as
 * pending (requiresOwnedHostCleanup) instead of blocking.
 */
export function createOwnedGuestCleanup(guest, { timeoutMs = 5_000 } = {}) {
  let result = null, removeCalls = 0, removeState = "not-started";
  const state = () => ({ removeCalls, removeState,
    requiresOwnedHostCleanup: removeState === "pending" || removeState.startsWith("rejected") });
  return {
    state,
    remove() {
      if (!result) {
        removeCalls++;
        removeState = "pending";
        const removal = Promise.resolve().then(() => guest.remove?.()).then(() => { removeState = "resolved"; },
          error => { removeState = `rejected: ${error?.message ?? error}`; });
        result = raceTimer(removal, timeoutMs).then(() => state());
      }
      return result;
    },
  };
}
const TIMED_OUT = Symbol("timed-out");

/**
 * Guest DOM probes for file identity, bound to the installed app's real DOM:
 * the design path field is <input id="document-path"> (apps/design-studio/app/
 * index.html, app.js elements.path). Tests run these against a document built
 * only from ids that exist in that index.html.
 */
const RENDERER_READY = `document.querySelector("#stage-wrap")?.dataset.rendererStatus === "active"`;
const FILE_ROWS = `[...document.querySelectorAll("#files-list .file-row")]`;
export const DESIGN_STUDIO_PROBES = Object.freeze({
  currentPath: () => `document.querySelector("#document-path")?.value.trim() ?? null`,
  fileRowListed: path => `${FILE_ROWS}.some(row => row.textContent.includes(${JSON.stringify(path)}))`,
  clickFileRow: path => `(() => { const row = ${FILE_ROWS}.find(row => row.textContent.includes(${JSON.stringify(path)}));
    if (!row) return false; row.click(); return true; })()`,
  fileOpened: path => `document.querySelector("#document-path")?.value.trim() === ${JSON.stringify(path)} && ` +
    `document.querySelector("#save-state")?.textContent !== "打开中…" && !document.querySelector("#files-dialog")?.open && ${RENDERER_READY}`,
  reloadedFile: path => `Boolean(window.codeshellPanel) && document.querySelector("#document-path")?.value.trim() === ${JSON.stringify(path)} && ${RENDERER_READY}`,
  dialogState: () => `(() => { const list = document.querySelector("#files-list");
    return { filesDialogOpen: Boolean(document.querySelector("#files-dialog")?.open), filesListText: (list?.textContent ?? "").slice(0, 600),
      fileRowCount: [...document.querySelectorAll("#files-list .file-row")].length,
      fileSwitchStatus: document.querySelector("#file-switch-status")?.textContent ?? null,
      workspaceSummary: document.querySelector("#workspace-summary")?.textContent ?? null }; })()`,
  // One structured bridge call, only after a missing row, to record the exact Host error code.
  workspaceListResult: path => `(async () => { const panel = window.codeshellPanel;
    if (!panel?.callResult) return { available: false };
    const result = await panel.callResult("workspace.list", { path: "designs" });
    if (result?.ok) { const entries = result.value?.entries ?? [];
      return { ok: true, entries: entries.length, includesTarget: entries.some(entry => entry.path === ${JSON.stringify(path)}) }; }
    return { ok: false, code: result?.error?.code ?? null, message: result?.error?.message ?? null, retryAfterMs: result?.error?.retryAfterMs ?? null }; })()`,
  closeFilesDialog: () => `(() => { const dialog = document.querySelector("#files-dialog"); if (dialog?.open) dialog.close(); return true; })()`,
  textLayerCount: () => `document.querySelectorAll('#layers-list .layer-row[data-id^="large-text-"]').length`,
  wheelInstall: () => `(() => { if (!window.__designStudioFidelityWheel) { const seen = window.__designStudioFidelityWheel = [];
    document.querySelector("#stage")?.addEventListener("wheel", event => seen.push({ deltaX: event.deltaX, deltaY: event.deltaY,
      deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, metaKey: event.metaKey }), { capture: true, passive: true }); } return true; })()`,
  wheelRead: () => `(window.__designStudioFidelityWheel ?? []).splice(0)`,
  overlayRects: () => `(() => { const stage = document.querySelector("#stage")?.getBoundingClientRect(); if (!stage) return null;
    return [".canvas-meta", "#renderer-message", "#infinite-canvas-hint", "#selection-size", "#inline-text-editor", "#toast"].flatMap(name => {
      const element = document.querySelector(name); if (!element || element.hidden) return [];
      const style = getComputedStyle(element); if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return [];
      const rect = element.getBoundingClientRect(); if (!(rect.width > 0 && rect.height > 0)) return [];
      return [{ name, x: rect.x - stage.x, y: rect.y - stage.y, width: rect.width, height: rect.height }]; }); })()`,
  environment: () => `({ devicePixelRatio: window.devicePixelRatio, innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    userAgent: typeof navigator === "undefined" ? null : navigator.userAgent })`,
  openState: () => `(() => { const wrap = document.querySelector("#stage-wrap"), save = document.querySelector("#save-state");
    return { documentPath: document.querySelector("#document-path")?.value ?? null, saveKind: save?.dataset.kind ?? null, saveText: save?.textContent ?? null,
      filesDialogOpen: Boolean(document.querySelector("#files-dialog")?.open), rendererStatus: wrap?.dataset.rendererStatus ?? null,
      rendererMode: wrap?.dataset.rendererMode ?? null }; })()`,
});

export { ZOOM_TOLERANCE };

/**
 * Open a design through the real files dialog. When the row never appears, record the
 * dialog's own text and one structured workspace.list result (exact Host error code).
 * Retry once only when the Host reports RATE_LIMITED with a bounded retryAfterMs.
 */
export async function openDesignFileWithDiagnostics({ execute, relativePath, timeoutMs, now = () => performance.now(),
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), maxRetryAfterMs = 65_000 }) {
  const poll = async source => {
    const deadline = now() + timeoutMs;
    for (;;) {
      if (await execute(source) === true) return true;
      if (now() >= deadline) return false;
      await wait(50);
    }
  };
  const diagnostics = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    await execute(`document.querySelector("#open-files")?.click(), true`);
    if (await poll(DESIGN_STUDIO_PROBES.fileRowListed(relativePath))) {
      if (await execute(DESIGN_STUDIO_PROBES.clickFileRow(relativePath)) !== true) throw new Error(`file row for ${relativePath} disappeared before its click`);
      if (!await poll(DESIGN_STUDIO_PROBES.fileOpened(relativePath))) {
        const state = await execute(DESIGN_STUDIO_PROBES.openState()).catch(error => ({ unavailable: String(error?.message ?? error) }));
        const error = new Error(`timed out waiting for open ${relativePath}; observed ${JSON.stringify(state)}`);
        error.diagnostics = diagnostics;
        throw error;
      }
      return { attempts: attempt, diagnostics };
    }
    const dialog = await execute(DESIGN_STUDIO_PROBES.dialogState()).catch(error => ({ unavailable: String(error?.message ?? error) }));
    const bridge = await execute(DESIGN_STUDIO_PROBES.workspaceListResult(relativePath)).catch(error => ({ unavailable: String(error?.message ?? error) }));
    diagnostics.push({ attempt, dialog, bridge });
    const retryAfterMs = bridge?.retryAfterMs;
    if (attempt === 1 && bridge?.code === "RATE_LIMITED" && Number.isFinite(retryAfterMs) && retryAfterMs >= 0 && retryAfterMs <= maxRetryAfterMs) {
      await execute(DESIGN_STUDIO_PROBES.closeFilesDialog());
      await wait(retryAfterMs + 250);
      continue;
    }
    break;
  }
  const error = new Error(`timed out waiting for file row ${relativePath}; observed ${JSON.stringify(diagnostics)}`);
  error.diagnostics = diagnostics;
  throw error;
}

/**
 * Closed-loop Ctrl+wheel zoom using the app's own formula (app.js: zoom *= exp(-deltaY*0.006)).
 * The delivered DOM deltaY is measured by a passive capture listener, so the mapping from the
 * sent input event to the DOM event (sign, scale) is observed, not assumed. The target is
 * reached only within ZOOM_TOLERANCE (float32 readback precision); otherwise reached:false.
 */
export async function closedLoopZoom({ target, readZoom, sendWheel, readDomDeltas, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  maxSteps = 6, settleMs = 250 }) {
  const trace = [];
  const fail = (reasons, zoom) => ({ reached: false, target, zoom, reasons, trace });
  await readDomDeltas();
  let k = null;
  for (let step = 0; step < maxSteps; step++) {
    const before = await readZoom();
    if (!(Number.isFinite(before) && before > 0)) return fail(["camera zoom not observable"], before);
    if (zoomMatches(before, target)) return { reached: true, target, zoom: before, reasons: [], trace, scale: k };
    const domNeeded = -Math.log(target / before) / 0.006;
    const kind = k === null ? "calibration" : "correction";
    const sentDeltaY = k === null ? Math.sign(domNeeded) * Math.min(Math.abs(domNeeded), 40) : domNeeded / k;
    await sendWheel(sentDeltaY);
    await wait(settleMs);
    const events = (await readDomDeltas() ?? []).filter(event => event.ctrlKey || event.metaKey);
    const after = await readZoom();
    const domDeltaY = events.map(event => event.deltaY), total = domDeltaY.reduce((sum, value) => sum + value, 0);
    trace.push({ kind, zoomBefore: before, sentDeltaY, domDeltaY, deltaModes: events.map(event => event.deltaMode), zoomAfter: after,
      expectedZoomAfter: before * Math.exp(-total * 0.006) });
    if (!events.length) return fail([`no wheel event reached the stage for sent deltaY ${sentDeltaY}`], after);
    if (events.some(event => event.deltaMode !== 0)) return fail([`wheel deltaMode ${events.map(event => event.deltaMode)} is not pixels`], after);
    if (total === 0) return fail([`delivered DOM deltaY was 0 for sent ${sentDeltaY}: delivery appears quantized; target ${target} not reached`], after);
    k = total / sentDeltaY;
  }
  const final = await readZoom();
  if (zoomMatches(final, target)) return { reached: true, target, zoom: final, reasons: [], trace, scale: k };
  return fail([`target zoom ${target} not reached after ${maxSteps} steps (last ${final}); the delivered deltas may be quantized`], final);
}

/**
 * Bounded pre-run setup for the fidelity guest: readiness polling and the guest
 * webContents id. Each guest call uses boundedOwnedOperation with the shared
 * guest cleanup as cancel, so a hung renderer cannot block before the caller's
 * finally; unsettled errors propagate to the existing owned Electron cleanup.
 */
export async function prepareFidelityGuest({ guest, guestCleanup, readySource, timeoutMs = 30_000, settleTimeoutMs = 5_000,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => performance.now() }) {
  const cancel = async () => {
    const state = await guestCleanup.remove();
    if (state.removeState !== "resolved") throw new Error(`owned guest remove ${state.removeState}`);
  };
  const deadline = now() + timeoutMs;
  for (;;) {
    const ready = await boundedOwnedOperation(() => guest.execute(readySource),
      { label: "fidelity guest readiness probe", timeoutMs: Math.max(1, Math.ceil(deadline - now())), settleTimeoutMs, cancel });
    if (ready === true) break;
    if (now() >= deadline) throw new Error(`fidelity guest not ready within ${timeoutMs}ms`);
    await wait(100);
  }
  const guestWebContentsId = await boundedOwnedOperation(() => guest.view.evaluate(view => view.getWebContentsId()),
    { label: "fidelity guest webContents id", timeoutMs, settleTimeoutMs, cancel });
  if (!Number.isInteger(guestWebContentsId) || guestWebContentsId <= 0) throw new Error(`invalid fidelity guest webContents id: ${guestWebContentsId}`);
  return { guestWebContentsId };
}

/**
 * Run the fidelity guest phase with the shared owned cleanup in finally. If the
 * cleanup (or the runner) reports unsettled owned work, that error is thrown
 * together with any original failure (AggregateError), never instead of it, so the
 * partial keeps e.g. the original startup timeout label.
 */
export async function withOwnedFidelityGuest(guestCleanup, body, { requiresOwnedHostCleanup = () => false } = {}) {
  let original = null;
  try { return await body(); }
  catch (error) { original = error; throw error; }
  finally {
    const removal = await guestCleanup.remove();
    if (requiresOwnedHostCleanup() || removal.requiresOwnedHostCleanup) {
      const unsettled = new Error(`Design Studio fidelity left unsettled owned work: ${JSON.stringify({ guest: removal })}`);
      unsettled.removal = removal;
      // eslint-disable-next-line no-unsafe-finally
      throw original ? new AggregateError([original, unsettled], `${original.message}; ${unsettled.message}`) : unsettled;
    }
  }
}

/**
 * Render static HTML in an owned hidden BrowserWindow of the same Electron/Chromium,
 * with JavaScript disabled and every non data/blob/about request cancelled. Load and
 * capture have a local deadline inside Main: on timeout the owned window is destroyed
 * (which settles its pending load/capture) and settlement is awaited for a bounded
 * time. The window is destroyed in finally in every case.
 */
export async function captureReferenceHtml(app, { html, width, height, timeoutMs = 15_000, settleTimeoutMs = 5_000 }) {
  const argument = { html, width, height, timeoutMs, settleTimeoutMs, allowed: REFERENCE_PROTOCOLS,
    partition: `ds-fidelity-reference-${Date.now()}-${Math.random().toString(16).slice(2)}` };
  return boundedOwnedOperation(() => app.evaluate(async ({ BrowserWindow, session }, { html, width, height, timeoutMs, settleTimeoutMs, allowed, partition }) => {
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
    const step = async (label, operation) => {
      let timer, settled = false;
      const pending = Promise.resolve().then(operation).finally(() => { settled = true; });
      const outcome = await Promise.race([pending.then(value => ({ value })), new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
      clearTimeout(timer);
      if (outcome) return outcome.value;
      if (!window.isDestroyed()) window.destroy();
      await Promise.race([pending.catch(() => {}), new Promise(resolve => setTimeout(resolve, settleTimeoutMs))]);
      throw new Error(`reference ${label} timed out after ${timeoutMs}ms; owned window destroyed; pending ${settled ? "settled" : "unsettled"}`);
    };
    try {
      await step("load", () => {
        const loaded = new Promise(resolve => window.webContents.once("did-finish-load", resolve));
        return Promise.all([window.webContents.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`), loaded]);
      });
      await new Promise(resolve => setTimeout(resolve, 300));
      const image = await step("capture", () => window.webContents.capturePage());
      return { pngBase64: image.toPNG().toString("base64"), size: image.getSize(), blockedRequests };
    } finally {
      if (!window.isDestroyed()) window.destroy();
    }
  }, argument), { label: "reference window evaluation", timeoutMs: 2 * timeoutMs + settleTimeoutMs + 2_000, settleTimeoutMs });
}

/** PNG evidence appended through the held artifact-bundle handle (never by path). */
export async function writeArtifactPng(sink, label, buffer) {
  const evidence = pngEvidence(buffer);
  evidence.summary.artifact = await sink.writeArtifact(label, buffer);
  return evidence;
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
    sampleReceipt = null, artifactSink = null, log = () => {}, probe = false } = options;
  // Probe mode runs only the two diagnostic probes (zoom input, large-file open).
  const onlyScenarios = probe ? [] : options.onlyScenarios ?? null;
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? (() => performance.now());
  const timeoutMs = options.timeoutMs ?? 30_000;
  const settleTimeoutMs = options.settleTimeoutMs ?? 5_000;
  const plan = planDesignStudioFidelityScenarios({ sample: Boolean(sampleReceipt) });
  const module = path => import(pathToFileURL(join(packageDirectory, "app", path)).href);
  const codec = await module("document.mjs");
  const textMetrics = await module("text-metrics.mjs");
  const documentIndex = await module("document-index.mjs");
  const frontend = await module("frontend-export.mjs");
  const svgMetrics = await import(new URL("../tests/apps/design-studio/svg-semantic-metrics.mjs", import.meta.url).href);
  const packageModules = {};
  for (const path of ["document.mjs", "text-metrics.mjs", "document-index.mjs", "frontend-export.mjs"])
    packageModules[path] = sha256(await readFile(join(packageDirectory, "app", path)));

  // Every guest-bound call has a local deadline. Timeout terminates only the owned
  // fidelity guest (guest.remove()), awaits settlement, then aborts later scenarios.
  const guestCleanup = options.guestCleanup ?? createOwnedGuestCleanup(guest, { timeoutMs: settleTimeoutMs });
  let guestTerminated = false, abortReason = null;
  const unsettled = [];
  const terminateGuest = async () => {
    guestTerminated = true;
    const state = await guestCleanup.remove();
    if (state.removeState !== "resolved") throw new Error(`owned guest remove ${state.removeState}`);
  };
  const recordTimeout = (label, error) => {
    if (!error.timedOut) return;
    abortReason = abortReason ?? `${error.message}; owned fidelity guest terminated`;
    if (error.unsettled) unsettled.push({ label, message: error.message, cleanup: error.cleanup });
  };
  const guestBound = (label, operation) => {
    if (abortReason) return Promise.reject(new Error(`aborted: ${abortReason}`));
    return boundedOwnedOperation(operation, { label, timeoutMs, settleTimeoutMs, cancel: terminateGuest }).catch(error => {
      recordTimeout(label, error);
      throw error;
    });
  };
  // Reference windows live in the owned Electron Main: an unsettled evaluation is
  // never swallowed; it aborts the rest and requires the owned process cleanup.
  const referenceBound = async options_ => {
    if (abortReason) throw new Error(`aborted: ${abortReason}`);
    try { return await captureReferenceHtml(app, { ...options_, timeoutMs, settleTimeoutMs }); }
    catch (error) {
      if (error.timedOut) {
        abortReason = abortReason ?? `${error.message}; owned reference evaluation did not finish`;
        if (error.unsettled) unsettled.push({ label: "reference window evaluation", message: error.message, cleanup: error.cleanup });
      }
      throw error;
    }
  };
  const dom = source => guestBound("guest DOM probe", () => guest.execute(source));
  const fileState = async relativePath => {
    const path = join(projectDirectory, relativePath);
    const [bytes, value] = await Promise.all([readFile(path), stat(path)]);
    return { sha256: sha256(bytes), mtimeMs: value.mtimeMs, size: value.size };
  };
  const evaluateMain = (fn, argument) => guestBound("guest Main operation", () => app.evaluate(fn, argument));
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
  // On timeout, keep the observed DOM state as evidence instead of a bare label.
  const untilWithState = async (source, label) => {
    try { return await until(source, label); }
    catch (error) {
      if (!/^timed out waiting/.test(error.message)) throw error;
      const state = await dom(DESIGN_STUDIO_PROBES.openState()).catch(stateError => ({ unavailable: String(stateError?.message ?? stateError) }));
      error.message += `; observed ${JSON.stringify(state)}`;
      throw error;
    }
  };
  const openFile = relativePath => openDesignFileWithDiagnostics({ execute: dom, relativePath, timeoutMs, now, wait });
  const zoomTo = async target => {
    await dom(DESIGN_STUDIO_PROBES.wheelInstall());
    const cam = await camera();
    if (!cam) return { reached: false, target, zoom: null, reasons: ["#stage camera transform not observable"], trace: [] };
    const center = { x: Math.round(cam.rect.x + cam.rect.width / 2), y: Math.round(cam.rect.y + cam.rect.height / 2) };
    return closedLoopZoom({ target, wait, readZoom: async () => (await camera())?.zoom,
      readDomDeltas: async () => (await dom(DESIGN_STUDIO_PROBES.wheelRead())) ?? [],
      sendWheel: deltaY => sendInput([{ type: "mouseWheel", x: center.x, y: center.y, deltaX: 0, deltaY, hasPreciseScrollingDeltas: true,
        canScroll: true, modifiers: ["control"] }]) });
  };
  const waitToastHidden = async () => {
    const deadline = now() + 8_000;
    while (now() < deadline && await dom(`document.querySelector("#toast")?.hidden === false`) === true) await wait(200);
  };
  const pageCrop = async (cam, png, { guestOverlays = true } = {}) => {
    const overlays = guestOverlays ? await dom(DESIGN_STUDIO_PROBES.overlayRects()) : [];
    const crop = pageCropRect({ camera: { zoom: cam.zoom, panX: cam.panX, panY: cam.panY, dpr: cam.dpr ?? cam.canvasRatio },
      pageBounds: currentPageBounds, capture: { width: png.width, height: png.height }, overlays: overlays ?? [] });
    return overlays === null ? { ...crop, comparisonEligible: false, overlays: ["overlay rects unobserved"] } : crop;
  };
  let currentPageBounds = null;
  const capture = async (cam, label) => {
    const result = await evaluateMain(async ({ webContents }, { id, rect }) => {
      const image = await webContents.fromId(id).capturePage(rect);
      return { pngBase64: image.toPNG().toString("base64"), size: image.getSize() };
    }, { id: guestWebContentsId, rect: { x: Math.round(cam.rect.x), y: Math.round(cam.rect.y), width: Math.round(cam.rect.width), height: Math.round(cam.rect.height) } });
    return saveArtifact(label, Buffer.from(result.pngBase64, "base64"));
  };
  const saveArtifact = async (label, buffer) => artifactSink ? writeArtifactPng(artifactSink, label, buffer) : pngEvidence(buffer);
  const documentAt = relativePath => readFixtureDocument({ projectDirectory, relativePath, codec, documentIndex });
  const nodeSummary = node => ({ id: node.id, x: node.x, y: node.y, ...(node.type === "text" ? { text: node.text } : {}) });
  const fixtureById = new Map(fixtures.map(fixture => [fixture.relativePath, fixture]));
  const documentFromFixture = async relativePath => codec.normalizeDesignDocument(JSON.parse(fixtureById.get(relativePath).logicalSource));
  const referenceHtml = (design, cam) => {
    const css = frontend.designFrontendCss(design, { preserveWorldOrigin: true });
    const body = frontend.renderDesignFrontendPage(design, { preserveWorldOrigin: true });
    return `<!doctype html><meta charset="utf-8"><style>${css}\nhtml,body{margin:0;background:${design.canvas.background};overflow:hidden}` +
      `#export-world{position:absolute;left:0;top:0;transform-origin:0 0;transform:translate(${cam.panX}px,${cam.panY}px) scale(${cam.zoom})}` +
      `.cs-page{margin:0!important;overflow:visible!important}</style><div id="export-world">${body}</div>`;
  };

  const results = [], probes = [];
  const environment = await dom(DESIGN_STUDIO_PROBES.environment()).catch(() => null);
  async function probeStep(id, body) {
    if (!probe) return;
    log(`design-studio fidelity probe: ${id}`);
    if (abortReason) { probes.push({ id, status: FIDELITY_STATUS.UNVERIFIED, reasons: [`aborted: ${abortReason}`] }); return; }
    try { probes.push({ id, ...(await body()) }); }
    catch (error) { probes.push({ id, status: FIDELITY_STATUS.UNVERIFIED, reasons: [`probe step failed: ${error?.message ?? error}`], diagnostics: error?.diagnostics ?? null }); }
  }
  // Probe 1 (fresh guest, first action): does the 1200-text indexed document list and open?
  await probeStep("probe-large-open", async () => {
    const relativePath = FIDELITY_FIXTURE_PATHS.largeText, started = now();
    const open = await openFile(relativePath);
    const elapsedMs = Math.round(now() - started);
    await wait(600);
    const openedTextLayerCount = await dom(DESIGN_STUDIO_PROBES.textLayerCount());
    const state = await dom(DESIGN_STUDIO_PROBES.openState());
    return { status: openedTextLayerCount >= 1000 ? FIDELITY_STATUS.EVIDENCE_ONLY : FIDELITY_STATUS.UNVERIFIED, open, elapsedMs, openedTextLayerCount, state };
  });
  // Probe 2: what DOM wheel event does an Electron Ctrl+wheel input produce, and does the closed loop reach 1 and 2?
  await probeStep("probe-zoom-input", async () => {
    await openFile(FIDELITY_FIXTURE_PATHS.rotationStrips);
    await chooseRenderer("gpu");
    await dom(`document.querySelector("#zoom-value")?.click(), true`);
    await wait(400);
    await dom(DESIGN_STUDIO_PROBES.wheelInstall());
    await dom(DESIGN_STUDIO_PROBES.wheelRead());
    const cam = await camera();
    if (!cam) return { status: FIDELITY_STATUS.UNVERIFIED, reasons: ["camera not observable"] };
    const center = { x: Math.round(cam.rect.x + cam.rect.width / 2), y: Math.round(cam.rect.y + cam.rect.height / 2) };
    const raw = [];
    for (const input of [{ deltaY: 60 }, { deltaY: 60, hasPreciseScrollingDeltas: true }, { deltaY: 37.5, hasPreciseScrollingDeltas: true },
      { deltaY: -60, hasPreciseScrollingDeltas: true }]) {
      const before = (await camera())?.zoom;
      await sendInput([{ type: "mouseWheel", x: center.x, y: center.y, deltaX: 0, canScroll: true, modifiers: ["control"], ...input }]);
      await wait(300);
      raw.push({ sent: input, dom: await dom(DESIGN_STUDIO_PROBES.wheelRead()), zoomBefore: before, zoomAfter: (await camera())?.zoom });
    }
    await dom(`document.querySelector("#zoom-value")?.click(), true`);
    await wait(400);
    const fitZoom = (await camera())?.zoom;
    const toOne = await zoomTo(1), toTwo = await zoomTo(2);
    const delivered = raw.every(entry => Array.isArray(entry.dom) && entry.dom.length > 0);
    return { status: delivered ? FIDELITY_STATUS.EVIDENCE_ONLY : FIDELITY_STATUS.UNVERIFIED, raw, fitZoom, toOne, toTwo };
  });
  async function scenario(id, body) {
    log(`design-studio fidelity: ${id}`);
    if (onlyScenarios && !onlyScenarios.includes(id)) return;
    if (abortReason) { results.push({ id, status: FIDELITY_STATUS.UNVERIFIED, reasons: [`aborted: ${abortReason}`] }); return; }
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

  await scenario("low-zoom-fractional-performance", async () => {
    const relativePath = FIDELITY_FIXTURE_PATHS.largeText;
    const open = await openFile(relativePath);
    await chooseRenderer("gpu");
    const design = await documentAt(relativePath);
    const textNodeCount = design.pages.flatMap(page => page.nodes).filter(node => node.type === "text").length;
    const openedTextLayerCount = await dom(DESIGN_STUDIO_PROBES.textLayerCount());
    const zoom = await zoomTo(0.3711);
    if (!zoom.reached) return { status: FIDELITY_STATUS.UNVERIFIED, reasons: [`low zoom not reached; metrics not collected: ${zoom.reasons.join("; ")}`],
      observation: { textNodeCount, openedTextLayerCount, open, zoom } };
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
    const observation = { textNodeCount, openedTextLayerCount, open, zoom, camera: cam && { zoom: cam.zoom, panX: cam.panX, panY: cam.panY, dpr: cam.canvasRatio },
      frames: { count: intervalsMs.length, intervalsMs, p50Ms: pick(.5), p95Ms: pick(.95), maxMs: sorted.at(-1) ?? null },
      cpu: { scriptDurationMs: delta("ScriptDuration"), taskDurationMs: delta("TaskDuration"), layoutDurationMs: delta("LayoutDuration"),
        recalcStyleDurationMs: delta("RecalcStyleDuration") },
      // The installed app keeps CanvasKit stats() private; no reviewed read-only surface exists.
      renderer: null };
    return { ...judgeLowZoomPerformance(observation), observation };
  });

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
  let editResult = null;
  await scenario("immediate-click-after-edit", async () => {
    await openFile(P);
    await chooseRenderer("gpu");
    await dom(`document.querySelector("#zoom-value")?.click(), true`);
    await wait(400);
    const cam = await camera();
    if (!cam) return { status: FIDELITY_STATUS.UNVERIFIED, reasons: ["#stage camera transform not observable"] };
    const centre = point => toClient(cam, point.x, point.y);
    const operations = [];
    const clickAndRead = async (label, world, expectedSelectedIds, committedAt) => {
      const point = centre(world), sentAt = now();
      await click(point.x, point.y);
      const actualSelectedIds = await selectedIds();
      return { label, world, point, expectedSelectedIds, actualSelectedIds, elapsedSinceCommitMs: Math.round(sentAt - committedAt) };
    };
    for (const step of INTERACTION_PLAN) {
      // Select through the UI, then verify the DOM selection and geometry before editing.
      const select = centre(step.selectAt);
      await click(select.x, select.y);
      const preEdit = { selectedIds: await selectedIds(), geometry: await inspectorXY() };
      const guard = guardPreEdit(step, preEdit);
      if (guard.length) {
        operations.push({ operation: step.operation, targetId: step.targetId, preEdit, status: FIDELITY_STATUS.UNVERIFIED,
          reasons: guard.map(reason => `pre-edit: ${reason}; edit not performed`) });
        break; // the remaining plan depends on this edit
      }
      let committedText;
      if (step.operation === "drag") {
        const start = centre(step.grab), end = centre(step.drop), moves = [];
        for (let index = 1; index <= 8; index++)
          moves.push({ type: "mouseMove", x: Math.round(start.x + (end.x - start.x) * index / 8), y: Math.round(start.y + (end.y - start.y) * index / 8), button: "left", modifiers: [] });
        await sendInput([{ type: "mouseDown", x: Math.round(start.x), y: Math.round(start.y), button: "left", clickCount: 1, modifiers: [] }, ...moves,
          { type: "mouseUp", x: Math.round(end.x), y: Math.round(end.y), button: "left", clickCount: 1, modifiers: [] }]);
      } else if (step.operation === "inspector-x") {
        await dom(`(() => { const input = document.querySelector("#prop-x"); if (!input) return false; input.value = ${JSON.stringify(String(step.set.x))};
          input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
      } else if (step.operation === "text-edit") {
        await keys("Enter");
        await until(`(() => { const e = document.querySelector("#inline-text-editor"); return Boolean(e && !e.hidden && document.activeElement === e); })()`, "inline text editor");
        await evaluateMain(({ webContents }, { id, text }) => { const contents = webContents.fromId(id); contents.selectAll(); contents.insertText(text); return true; },
          { id: guestWebContentsId, text: step.text });
        await keys("Enter", [process.platform === "darwin" ? "meta" : "control"]);
      }
      const committedAt = now();
      const clicks = [];
      for (const value of step.clicks) clicks.push(await clickAndRead(value.label, value.world, value.expected, committedAt));
      // Re-select the target at its planned new position and read back what was committed.
      const after = centre(step.clicks[0].world);
      await click(after.x, after.y);
      const selectedAfter = await selectedIds();
      const ownSelection = Array.isArray(selectedAfter) && selectedAfter.length === 1 && selectedAfter[0] === step.targetId;
      const geometryAfter = ownSelection ? await inspectorXY() : null;
      if (step.operation === "text-edit") committedText = ownSelection ? await dom(`document.querySelector("#prop-text")?.value ?? null`) : null;
      const record = { operation: step.operation, targetId: step.targetId, preEdit, geometryBefore: preEdit.geometry, geometryAfter, selectedAfter, clicks,
        ...(committedText === undefined ? {} : { committedText }) };
      const judged = { ...record, ...judgeImmediateClick(record) };
      if (step.operation === "text-edit" && committedText !== step.text && judged.status === FIDELITY_STATUS.PASS)
        Object.assign(judged, { status: FIDELITY_STATUS.UNVERIFIED, reasons: [`committed text ${JSON.stringify(committedText)} was not observed as ${JSON.stringify(step.text)}`] });
      operations.push(judged);
      if (judged.status !== FIDELITY_STATUS.PASS) break; // later steps assume this one
    }
    const status = operations.length === INTERACTION_PLAN.length ? worst(operations.map(value => value.status))
      : worst([...operations.map(value => value.status), FIDELITY_STATUS.UNVERIFIED]);
    editResult = { operations: operations.map(value => value.operation), statuses: operations.map(value => value.status) };
    return { status, camera: cam, operations };
  });

  // Directly after the verified edits, on the same open document (no reopen in between).
  await scenario("save-reopen-stable", async () => {
    const baselineNodes = (await documentFromFixture(P)).pages[0].nodes.map(nodeSummary);
    const pathBeforeSave = await dom(DESIGN_STUDIO_PROBES.currentPath());
    const save = async label => {
      await dom(`(() => { const menu = document.querySelector("#compact-actions"); if (menu && !menu.open) menu.querySelector("summary")?.click();
        document.querySelector("#save")?.click(); return true; })()`);
      await until(`["saved", "error"].includes(document.querySelector("#save-state")?.dataset.kind)`, `${label} completion`);
      return { kind: (await saveState())?.kind ?? null, file: await fileState(P) };
    };
    const observation = { path: P, editsVerified: editResult, pathBeforeSave, expected: expectedStateAfterEdits(), baselineNodes };
    const verdictNow = () => ({ ...judgeSaveReopen(observation), observation });
    const preconditions = judgeSaveReopen({ ...observation, firstSave: undefined });
    if (preconditions.status === FIDELITY_STATUS.UNVERIFIED && /not all verified|not the open document/.test(preconditions.reasons.join()))
      return { ...preconditions, observation }; // never save an unverified or wrong document
    observation.layerIdsBefore = await layerIds();
    observation.firstSave = await save("first save");
    if (observation.firstSave.kind !== "saved") return verdictNow();
    const disk = await documentAt(P);
    observation.diskNodesAfterFirstSave = disk.pages[0].nodes.map(nodeSummary);
    observation.canonicalSha256 = sha256(codec.serializeDesignDocument(disk));
    await guestBound("guest reload", () => guest.view.evaluate(view => view.reload()));
    await untilWithState(DESIGN_STUDIO_PROBES.reloadedFile(P), "reopen after reload");
    const { samples, waitedMs } = await sampleSaveStates();
    Object.assign(observation, { reopenSaveStates: samples, reopenWaitedMs: waitedMs, reopenedAfterSampling: await fileState(P), layerIdsAfterReopen: await layerIds() });
    const domAfterReload = [];
    for (const node of observation.expected) {
      await dom(`document.querySelector('#layers-list .layer-row[data-id=${JSON.stringify(node.id)}]')?.click(), true`);
      const selected = await selectedIds();
      if (!Array.isArray(selected) || selected.length !== 1 || selected[0] !== node.id) continue; // missing → UNVERIFIED
      const geometry = await inspectorXY();
      const text = node.text === undefined ? undefined : await dom(`document.querySelector("#prop-text")?.value ?? null`);
      domAfterReload.push({ id: node.id, x: geometry?.x, y: geometry?.y, ...(text === undefined ? {} : { text }) });
    }
    observation.domAfterReload = domAfterReload;
    // Snapshot immediately before the second save: any reload-triggered autosave shows up here.
    observation.reopenedBeforeSecondSave = await fileState(P);
    observation.secondSave = await save("second save");
    return verdictNow();
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
    currentPageBounds = codec.designPageBounds(design);
    for (const target of [{ label: "100", zoom: 1 }, { label: "200", zoom: 2 }, { label: "fit" }]) {
      await chooseRenderer("gpu");
      let zoom = null;
      if (target.zoom) {
        zoom = await zoomTo(target.zoom);
        if (!zoom.reached) {
          groups.push({ label: target.label, targetZoom: target.zoom, zoom, captures: [], status: FIDELITY_STATUS.UNVERIFIED,
            reasons: [`target zoom ${target.zoom} not reached; captures skipped so no other zoom is labelled ${target.label}`] });
          continue;
        }
      } else { await dom(`document.querySelector("#zoom-value")?.click(), true`); await wait(400); }
      await waitToastHidden();
      const captures = [];
      for (const route of ["gpu", "browser"]) {
        await chooseRenderer(route);
        const cam = await camera();
        const evidence = await capture(cam, `visual-${target.label}-${route}`);
        captures.push({ route, camera: { zoom: cam.zoom, panX: cam.panX, panY: cam.panY, dpr: cam.canvasRatio }, png: evidence.summary,
          pageCrop: await pageCrop(cam, evidence.summary),
          rect: cam.rect, crops: Object.fromEntries(Object.entries(samples).map(([id, box]) => {
            const origin = { x: cam.zoom * box.x + cam.panX, y: cam.zoom * box.y + cam.panY };
            return [id, { x: origin.x * cam.canvasRatio, y: origin.y * cam.canvasRatio, width: box.width * cam.zoom * cam.canvasRatio, height: box.height * cam.zoom * cam.canvasRatio }];
          })) });
      }
      const cam = captures[0].camera, rect = captures[0].rect;
      const reference = await referenceBound({ html: referenceHtml(design, cam), width: Math.round(rect.width), height: Math.round(rect.height) });
      const evidence = await saveArtifact(`visual-${target.label}-html`, Buffer.from(reference.pngBase64, "base64"));
      const htmlCamera = { ...cam, dpr: evidence.summary.width / Math.round(rect.width) };
      captures.push({ route: "html", camera: htmlCamera, png: evidence.summary, rect, pageCrop: await pageCrop(htmlCamera, evidence.summary, { guestOverlays: false }),
        blockedRequests: reference.blockedRequests, crops: captures[0].crops });
      const group = { label: target.label, targetZoom: target.zoom ?? null, zoom, captures };
      groups.push({ ...group, ...judgeVisualCaptureGroup(group) });
    }
    await chooseRenderer("gpu");
    return { status: worst(groups.map(group => group.status)), groups };
  });

  await scenario("svg-corner-aa-host", async () => {
    const relativePath = FIDELITY_FIXTURE_PATHS.svgCornerAa;
    await openFile(relativePath);
    await chooseRenderer("gpu");
    const zoom = await zoomTo(1);
    const design = await documentAt(relativePath);
    const nodes = design.pages[0].nodes;
    const probes = nodes.filter(node => node.id.startsWith("svg-corner-"));
    const svg = codec.exportDesignSvg(design);
    const geometry = svgReferenceGeometry(svg);
    if (!geometry) return { status: FIDELITY_STATUS.UNVERIFIED, reasons: ["exported SVG has no parsable viewBox/width/height"] };
    const viewport = { width: Math.ceil(geometry.viewport.width), height: Math.ceil(geometry.viewport.height) };
    const reference = await referenceBound({ html: `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${design.canvas.background}}svg{display:block}</style>${svg.replace(/^<\?xml[^>]*>\s*/u, "")}`,
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
    if (!zoom.reached) hostRoutes.push({ skipped: true, zoom, reason: "zoom 1 not reached; GPU/browser rows not captured (run2 rows at zoom 0.1 were invalid)" });
    else for (const route of ["gpu", "browser"]) {
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
    return { status: worst(rows.map(row => row.status)), svg: { png: svgEvidence.summary, blockedRequests: reference.blockedRequests, rows }, zoom, hostRoutes };
  });

  return { plan, packageModules, sampleReceipt, environment, probes, results, summary: summarizeFidelityReport(results, plan),
    terminatedGuest: guestTerminated, abortReason,
    cleanup: { guest: guestCleanup.state(), unsettled,
      requiresOwnedHostCleanup: unsettled.length > 0 || guestCleanup.state().requiresOwnedHostCleanup },
    fixtures: fixtures.map(({ relativePath, purpose, storage, sha256: digest, logicalSha256, files }) => ({ relativePath, purpose, storage, sha256: digest, logicalSha256,
      files: files.map(file => ({ relativePath: file.relativePath, sha256: file.sha256, bytes: Buffer.byteLength(file.bytes) })) })),
    approval: "The --design-studio-fidelity flag is a technical opt-in only; it is not user approval to open a Host window." };
}
