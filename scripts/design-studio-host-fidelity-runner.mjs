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
  FIDELITY_FIXTURE_PATHS, FIDELITY_STATUS, INTERACTION_PLAN, OPEN_WAIT_MIN_MS, expectedStateAfterEdits, guardPreEdit, readFixtureDocument,
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
    sampleReceipt = null, artifactSink = null, log = () => {}, onlyScenarios = null } = options;
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

  const results = [];
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
    const pathBeforeSave = await dom(`document.querySelector("#path")?.value.trim() ?? null`);
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
    await until(`Boolean(window.codeshellPanel) && document.querySelector("#path")?.value.trim() === ${JSON.stringify(P)} && ${rendererReady}`, "reopen after reload");
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
      const reference = await referenceBound({ html: referenceHtml(design, cam), width: Math.round(rect.width), height: Math.round(rect.height) });
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
    terminatedGuest: guestTerminated, abortReason,
    cleanup: { guest: guestCleanup.state(), unsettled,
      requiresOwnedHostCleanup: unsettled.length > 0 || guestCleanup.state().requiresOwnedHostCleanup },
    fixtures: fixtures.map(({ relativePath, purpose, storage, sha256: digest, logicalSha256, files }) => ({ relativePath, purpose, storage, sha256: digest, logicalSha256,
      files: files.map(file => ({ relativePath: file.relativePath, sha256: file.sha256, bytes: Buffer.byteLength(file.bytes) })) })),
    approval: "The --design-studio-fidelity flag is a technical opt-in only; it is not user approval to open a Host window." };
}
