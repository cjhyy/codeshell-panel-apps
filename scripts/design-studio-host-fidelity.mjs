/* Design Studio real-Host fidelity acceptance: pure planning, fixtures and verdicts.
 *
 * This module is imported by scripts/check-panel-desktop.mjs only when the explicit
 * --design-studio-fidelity flag is given. It never launches Electron, Chromium or a
 * Host build itself, never installs, downloads or builds anything, and has no
 * top-level side effects. Electron-specific steps receive already-owned handles.
 *
 * The CLI flag is only a technical opt-in. It is not user approval to open a Host
 * window; that approval must be obtained separately before anyone runs the command.
 */
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DESIGN_STUDIO_FIDELITY_FLAG = "--design-studio-fidelity";
export const DESIGN_STUDIO_SAMPLE_FLAG = "--design-studio-sample";
export const DESIGN_STUDIO_PROBE_FLAG = "--design-studio-probe";
const USAGE = "usage: node scripts/check-panel-desktop.mjs <built-host-checkout> [new-report.json] [--app <panel-id>] | " +
  `<built-host-checkout> ${DESIGN_STUDIO_FIDELITY_FLAG} [${DESIGN_STUDIO_SAMPLE_FLAG} <absolute.codesign.json>]`;

/** Build outputs hashed by the existing desktop gate (unchanged list). */
export const HASHED_HOST_BUILD_FILES = Object.freeze([
  "packages/desktop/out/main/index.mjs", "packages/desktop/out/preload/index.cjs",
  "packages/desktop/out/preload/panel-app.cjs", "packages/desktop/out/renderer/index.html",
  "packages/desktop/out/managed-runtimes/node/bin/node",
  "packages/core/dist/panel-apps/installer.js", "packages/server/dist/panels/runtime-services.js",
]);
/** Every Host file the existing desktop gate reads or imports. */
export const REQUIRED_HOST_FILES = Object.freeze([
  ...HASHED_HOST_BUILD_FILES,
  "packages/desktop/package.json",
  "packages/core/dist/index.js",
  "packages/core/dist/panel-apps/package-content.js",
  "scripts/bun-test-completion.mjs",
  "packages/desktop/scripts/confined-electron-fixture.mjs",
  "packages/desktop/scripts/owned-electron-control.mjs",
  "packages/desktop/scripts/electron-harness.mjs",
  "packages/desktop/scripts/runtime-cost-gui-guard.mjs",
]);
/** Fidelity reads the same Host files; Electron is resolved separately (see preflight). */
export const FIDELITY_HOST_FILES = Object.freeze([...REQUIRED_HOST_FILES]);

/**
 * Parse check-panel-desktop arguments. Environment variables are deliberately
 * ignored: no variable can enable fidelity or represent user approval.
 */
export function parsePanelDesktopArguments(argv, _environment = {}) {
  const [hostArgument, ...rest] = argv;
  let reportArgument, selectedApp, fidelity = false, samplePath = null, sampleSeen = false, probe = false;
  if (!hostArgument || hostArgument.startsWith("--"))
    throw new Error(`a built Host checkout path is required; ${USAGE}`);
  for (let index = 0; index < rest.length; index++) {
    const value = rest[index];
    if (value === "--app") {
      if (selectedApp || !rest[index + 1] || rest[index + 1].startsWith("--")) throw new Error("--app requires one Panel id");
      selectedApp = rest[++index];
    } else if (value === DESIGN_STUDIO_FIDELITY_FLAG) {
      if (fidelity) throw new Error(`${DESIGN_STUDIO_FIDELITY_FLAG} given twice`);
      fidelity = true;
    } else if (value === DESIGN_STUDIO_PROBE_FLAG) {
      if (probe) throw new Error(`${DESIGN_STUDIO_PROBE_FLAG} given twice`);
      probe = true;
    } else if (value === DESIGN_STUDIO_SAMPLE_FLAG) {
      if (sampleSeen || !rest[index + 1] || rest[index + 1].startsWith("--"))
        throw new Error(`${DESIGN_STUDIO_SAMPLE_FLAG} requires one sample path`);
      sampleSeen = true;
      samplePath = rest[++index];
    } else if (!value.startsWith("--") && !reportArgument) {
      reportArgument = value;
    } else throw new Error(`unexpected argument: ${value}; ${USAGE}`);
  }
  if (sampleSeen && !fidelity) throw new Error(`${DESIGN_STUDIO_SAMPLE_FLAG} requires ${DESIGN_STUDIO_FIDELITY_FLAG}`);
  if (probe && !fidelity) throw new Error(`${DESIGN_STUDIO_PROBE_FLAG} requires ${DESIGN_STUDIO_FIDELITY_FLAG}`);
  if (!fidelity) return { hostArgument, reportArgument, selectedApp, designStudioFidelity: null };
  // Breaking for this opt-in only: outputs are created by the harness itself in the
  // root-owned system temp directory and written through held handles.
  if (reportArgument) throw new Error(`${DESIGN_STUDIO_FIDELITY_FLAG} does not accept a report path (${reportArgument}); ` +
    "its report and artifact bundle are harness-owned files in the root-owned system temp directory, printed at start");
  if (selectedApp && selectedApp !== "design-studio")
    throw new Error(`${DESIGN_STUDIO_FIDELITY_FLAG} only runs --app design-studio, not ${selectedApp}`);
  return { hostArgument, reportArgument, selectedApp: "design-studio", designStudioFidelity: { samplePath, probe } };
}

/**
 * Read-only preflight. Uses stat/resolve only; it never installs, downloads,
 * builds or writes inside the Host checkout. Missing outputs are reported exactly.
 */
export async function preflightPanelDesktopHost(hostRoot, { fidelity = false } = {}) {
  const root = resolve(hostRoot);
  const wanted = fidelity ? FIDELITY_HOST_FILES : REQUIRED_HOST_FILES;
  const present = [], missing = [], mtimes = {}, warnings = [];
  for (const path of wanted) {
    try {
      const value = await stat(join(root, path));
      if (!value.isFile()) throw new Error("not a file");
      present.push(path);
      mtimes[path] = value.mtimeMs;
    } catch { missing.push(path); }
  }
  let electron = null;
  if (!missing.includes("packages/desktop/scripts/electron-harness.mjs")) {
    try {
      const resolveFrom = createRequire(join(root, "packages/desktop/scripts/electron-harness.mjs"));
      const packagePath = resolveFrom.resolve("electron/package.json");
      const version = JSON.parse(await readFile(packagePath, "utf8")).version;
      const distribution = join(dirname(packagePath), "dist");
      const distStat = await stat(distribution).catch(() => null);
      electron = { packagePath, version, distributionPresent: Boolean(distStat?.isDirectory()) };
      if (!electron.distributionPresent) missing.push("electron/dist (Electron binary not installed for the Host)");
    } catch { missing.push("electron/package.json (not resolvable from packages/desktop/scripts)"); }
  }
  const desktopOut = mtimes["packages/desktop/out/main/index.mjs"];
  for (const path of ["packages/core/dist/panel-apps/installer.js", "packages/server/dist/panels/runtime-services.js"]) {
    if (desktopOut !== undefined && mtimes[path] !== undefined && mtimes[path] > desktopOut)
      warnings.push(`${path} is newer than packages/desktop/out/main/index.mjs; the Desktop out/ may be stale relative to Core/Server dist`);
  }
  const ok = missing.length === 0;
  const message = ok
    ? `Host preflight passed for ${root}${warnings.length ? ` with warnings: ${warnings.join("; ")}` : ""}`
    : `Host preflight failed for ${root}: missing or not built: ${missing.join(", ")}. ` +
      "This harness never builds, downloads or installs Host outputs; build them separately in an authorized Host checkout.";
  return { ok, hostRoot: root, present, missing, mtimes, warnings, electron, message, actionsTaken: [] };
}

const sha256 = value => createHash("sha256").update(value).digest("hex");
function inside(parent, child) {
  const value = relative(parent, child);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

/** Copy an explicitly supplied design into the temporary project; the original is only read. */
export async function copyDesignStudioSample({ samplePath, projectDirectory, afterCopy }) {
  if (!samplePath || !isAbsolute(samplePath)) throw new Error("the Design Studio sample path must be absolute");
  const project = resolve(projectDirectory);
  if (inside(project, resolve(samplePath))) throw new Error("the sample must be outside the temporary project");
  const before = await readFile(samplePath);
  const beforeStat = await stat(samplePath);
  const relativePath = "designs/host-fidelity-sample.codesign.json";
  const destination = join(project, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(samplePath, destination);
  if (afterCopy) await afterCopy();
  const after = await readFile(samplePath);
  const afterStat = await stat(samplePath);
  const copy = await readFile(destination);
  const receipt = { samplePath, relativePath, bytes: before.length,
    sourceSha256Before: sha256(before), sourceSha256After: sha256(after), copySha256: sha256(copy),
    sourceMtimeMsBefore: beforeStat.mtimeMs, sourceMtimeMsAfter: afterStat.mtimeMs };
  if (receipt.sourceSha256After !== receipt.sourceSha256Before || receipt.sourceMtimeMsAfter !== receipt.sourceMtimeMsBefore)
    throw new Error(`Design Studio sample changed while it was copied: ${JSON.stringify(receipt)}`);
  if (receipt.copySha256 !== receipt.sourceSha256Before) throw new Error("temporary sample copy differs from the original");
  return receipt;
}

/** Only in-memory and the Panel protocol may load; every network and file URL is denied. */
const ALLOWED_PROTOCOLS = new Set(["data:", "blob:", "about:", "cspanel:"]);
export function isAllowedFidelityRequest(url) {
  if (typeof url !== "string" || !url) return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  return ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase());
}

/* ---------------------------------------------------------------------------
 * Synthetic fixtures. All bytes are canonical output of the supplied (installed)
 * codec, so the Host opens exactly what a real save would have produced. Personal
 * designs are never copied unless explicitly passed as --design-studio-sample.
 * ------------------------------------------------------------------------- */
export const FIDELITY_FIXTURE_PATHS = Object.freeze({
  legacyReceipts: "designs/host-fidelity-legacy-receipts.codesign.json",
  interaction: "designs/host-fidelity-interaction.codesign.json",
  rotationStrips: "designs/host-fidelity-rotation-strips.codesign.json",
  svgCornerAa: "designs/host-fidelity-svg-corner-aa.codesign.json",
  largeText: "designs/host-fidelity-large-text.codesign.json",
});
const CONTAINERS = new Set(["frame", "component", "group"]);
function fixtureNode(id, type, x, y, width, height, extra = {}) {
  return { id, type, name: id, x, y, width, height, fill: "#1f2328", stroke: "transparent", strokeWidth: 0,
    opacity: 1, rotation: 0, cornerRadius: 0, visible: true, locked: false,
    ...(CONTAINERS.has(type) ? { layout: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start", children: [] } : {}),
    ...extra };
}
function fixtureText(id, x, y, width, height, text, extra = {}) {
  return fixtureNode(id, "text", x, y, width, height, { text, fontFamily: "Arial", fontSize: 14, fontWeight: 400,
    lineHeight: 1.4, textAlign: "left", fill: "#1f2328", ...extra });
}
function fixtureDocument(name, children, { width = 1280, height = 800, background = "#f6f7f5" } = {}) {
  return { format: "codeshell.design", version: 3, name, canvas: { width, height, background },
    tokens: { colors: [] }, resources: [], activePageId: "main", pages: [{ id: "main", name: "Main", children }] };
}
/** A receipt in the shape the browser measurer records, for an explicit signature. */
function receiptFor(node, signature) {
  const lines = node.text.split("\n");
  const lineHeight = node.fontSize * node.lineHeight;
  const lineWidths = lines.map(line => Math.round(Math.min(node.width, [...line].length * node.fontSize * 0.56) * 64) / 64);
  return { version: 1, signature, lineWidths,
    lineInkBounds: lineWidths.map(width => ({ x: 0, y: Math.round(node.fontSize * 0.18 * 64) / 64, width, height: node.fontSize })),
    height: Math.round(lines.length * lineHeight * 64) / 64, fontAvailable: true };
}
/** Pre-line-box receipts: the current signature without the line-box-v1 origin marker. */
function legacySignature(textMetrics, node) {
  const value = JSON.parse(textMetrics.textMetricsSignature(node));
  const origin = value.at(-1);
  if (origin && typeof origin === "object" && !Array.isArray(origin) && origin.origin === "line-box-v1") value.pop();
  return JSON.stringify(value);
}

/** Real Host workspace.readText limit (CodeShell server, 480 KiB per text file). */
export const HOST_READ_TEXT_MAX_BYTES = 480 * 1024;
const byteLength = value => Buffer.byteLength(value, "utf8");
const fixtureFile = (relativePath, bytes) => {
  if (byteLength(bytes) > HOST_READ_TEXT_MAX_BYTES) throw new Error(`${relativePath} exceeds the Host readText budget`);
  return { relativePath, bytes, sha256: sha256(bytes) };
};

export async function buildDesignStudioFidelityFixtures({ codec, textMetrics, documentIndex }) {
  const canonical = (relativePath, purpose, raw) => {
    const bytes = codec.serializeDesignDocument(codec.normalizeDesignDocument(raw));
    return { relativePath, purpose, storage: "single", bytes, sha256: sha256(bytes), logicalSource: bytes, logicalSha256: sha256(bytes),
      files: [fixtureFile(relativePath, bytes)] };
  };
  // A document larger than one Host readText is stored exactly as the app saves it:
  // the installed index codec writes a manifest plus digest-named page parts.
  const indexed = async (relativePath, purpose, raw) => {
    const document = codec.normalizeDesignDocument(raw);
    const logicalSource = codec.serializeDesignDocument(document);
    const plan = await documentIndex.createDesignIndexPersistencePlan({ document, sha256: async value => sha256(value) });
    const files = [fixtureFile(relativePath, plan.primarySource), ...plan.parts.map(part => fixtureFile(part.path, part.content))];
    return { relativePath, purpose, storage: "indexed", bytes: plan.primarySource, sha256: sha256(plan.primarySource),
      logicalSource, logicalSha256: sha256(logicalSource), logicalBytes: byteLength(logicalSource), files };
  };
  const withLegacy = node => ({ ...node, textMetrics: receiptFor(node, legacySignature(textMetrics, node)) });
  const withCurrent = node => ({ ...node, textMetrics: receiptFor(node, textMetrics.textMetricsSignature(node)) });

  const legacyChildren = [
    withLegacy(fixtureText("legacy-latin-line-box", 40.25, 40.5, 260, 44, "Legacy receipt HMI\nSecond line")),
    withLegacy(fixtureText("legacy-cjk-line-box", 340.5, 40.25, 260, 44, "旧版测量回执\n中文第二行", { fontFamily: '"PingFang SC", sans-serif' })),
    withCurrent(fixtureText("finite-offset-latin", 40.25, 120.75, 260, 24, "Imported finite 5.25", { layoutBaselineOffset: 5.25 })),
    withCurrent(fixtureText("finite-zero-cjk", 340.5, 120.5, 260, 24, "导入零偏移 Zero", { layoutBaselineOffset: 0, fontFamily: '"PingFang SC", sans-serif' })),
    withLegacy(fixtureText("wrap-legacy", 40.25, 180.25, 150, 44, "Wrapped legacy \ncopy text", { textSource: "Wrapped legacy copy text",
      textFlow: "wrap", textFlowWidth: 150 })),
    fixtureNode("hug-row", "frame", 340.5, 180.5, 220, 40, { layout: "horizontal", gap: 8, padding: 8, alignItems: "center", fill: "#ffffff",
      children: [withLegacy(fixtureText("hug-label", 348.5, 190.5, 96, 20, "Hug 文字 label", { layoutSizingHorizontal: "hug" }))] }),
    fixtureText("unmeasured-line-box", 40.25, 260.25, 260, 24, "No receipt line box"),
  ];
  // Paint/hit order is children order; hitTestCanvasNode walks it last-to-first, so
  // move-target must follow underlay to be the top-most node where they overlap.
  const interactionChildren = [
    fixtureNode("underlay", "rectangle", 400, 140, 160, 120, { fill: "#d9dde3" }),
    fixtureNode("move-target", "rectangle", 120, 140, 120, 80, { fill: "#2f6fb2", cornerRadius: 6 }),
    fixtureText("edit-target", 120, 320, 220, 24, "Edit me HMI"),
  ];
  const rotationChildren = [
    fixtureNode("chevron-group", "frame", 40, 40, 32, 32, { fill: "#ffffff", children: [
      fixtureNode("chevron-upper", "rectangle", 50.6, 49.42, 9.6, 1.12, { fill: "#6b7280", rotation: 45, cornerRadius: 0.56 }),
      fixtureNode("chevron-lower", "rectangle", 50.6, 57.42, 9.6, 1.12, { fill: "#6b7280", rotation: -45, cornerRadius: 0.56 }),
    ] }),
    fixtureNode("prompt-glyph-group", "frame", 96, 40, 48, 32, { fill: "#ffffff", children: [
      fixtureNode("prompt-glyph-stroke-a", "rectangle", 104.42, 50.49, 7.8, 1.19, { fill: "#686e67", rotation: 40, cornerRadius: 0.595 }),
      fixtureNode("prompt-glyph-stroke-b", "rectangle", 104.42, 55.49, 7.8, 1.19, { fill: "#686e67", rotation: -40, cornerRadius: 0.595 }),
      fixtureText("prompt-glyph", 118.25, 46.5, 22, 20, ">_", { fontFamily: "Menlo, monospace", fontSize: 13, lineHeight: 1.2 }),
    ] }),
    fixtureNode("button-frame", "frame", 168, 40, 120, 32, { fill: "#2f6fb2", cornerRadius: 6, layout: "horizontal", padding: 8, alignItems: "center",
      children: [fixtureText("button-label", 176, 46, 104, 20, "Continue 继续", { fill: "#ffffff", fontWeight: 600, layoutSizingHorizontal: "hug" })] }),
    fixtureNode("finite-sample", "frame", 312, 40, 200, 32, { fill: "#ffffff", children: [
      fixtureText("finite-sample-text", 320.25, 46.5, 184, 20, "Finite 有限 offset", { layoutBaselineOffset: 3.5, lineHeight: 1.2 })] }),
  ];
  // One page only: switching pages through #active-page marks the document dirty.
  // Authored fractional phases match the audited rows (x .3/.4, y .4/.3).
  const svgSurface = (id, x0) => fixtureNode(`${id}-surface`, "frame", x0, 80, 80, 260, { fill: "#f3f4f1", children: [
    fixtureNode(`svg-corner-${id}-vertical`, "rectangle", x0 + 28.3, 303.4, 1.26, 7.2, { fill: "#686e67" }),
    fixtureNode(`svg-corner-${id}-horizontal`, "rectangle", x0 + 27.4, 97.3, 7.2, 1.17, { fill: "#686e67" }),
  ] });
  const largeChildren = [];
  const samples = ["Dashboard HMI 1024", "设计渲染 文字缓存", "Mixed 中文 Latin 42", "Status: ready ✓", "低缩放 fractional pan"];
  for (let index = 0; index < 1200; index++) {
    const column = index % 30, row = Math.floor(index / 30);
    largeChildren.push(fixtureText(`large-text-${index}`, 20.25 + column * 132.5, 16.375 + row * 30.25, 128, 22,
      `${samples[index % samples.length]} #${index}`, { fontSize: 12 + (index % 3), fontFamily: index % 2 ? '"PingFang SC", sans-serif' : "Arial" }));
  }
  return [
    canonical(FIDELITY_FIXTURE_PATHS.legacyReceipts, "open without editing must not rewrite bytes/mtime or become dirty",
      fixtureDocument("Host fidelity legacy receipts", legacyChildren)),
    canonical(FIDELITY_FIXTURE_PATHS.interaction, "move/edit then immediate click selects the actual node at the new geometry",
      fixtureDocument("Host fidelity interaction", interactionChildren)),
    canonical(FIDELITY_FIXTURE_PATHS.rotationStrips, "GPU/browser/HTML captures of chevron, >_, button and finite text",
      fixtureDocument("Host fidelity rotation strips", rotationChildren, { width: 600, height: 120, background: "#ffffff" })),
    canonical(FIDELITY_FIXTURE_PATHS.svgCornerAa, "real-Host original-size captures for the four DPR1 SVG corner-AA FAIL geometries",
      fixtureDocument("Host fidelity SVG corner AA", [svgSurface("chat", 0), svgSurface("panels", 120)], { width: 400, height: 400 })),
    await indexed(FIDELITY_FIXTURE_PATHS.largeText, "1000+ real text nodes at fractional low zoom/pan for device sampling and tile bypass",
      fixtureDocument("Host fidelity large text", largeChildren, { width: 4000, height: 1240 })),
  ];
}

/** Read a seeded/saved design exactly as the app does: single file or real index + parts. */
export async function readFixtureDocument({ projectDirectory, relativePath, codec, documentIndex }) {
  const project = resolve(projectDirectory);
  const read = async path => {
    if (typeof path !== "string" || !path.startsWith("designs/") || path.split("/").includes("..")) throw new Error(`unsafe design path: ${path}`);
    return readFile(join(project, path), "utf8");
  };
  const primary = await read(relativePath);
  if (!documentIndex.parseDesignIndexSource(primary)) return codec.normalizeDesignDocument(JSON.parse(primary));
  const resolved = await documentIndex.resolveDesignIndexDocument({ primarySource: primary, readText: read, sha256: async value => sha256(value) });
  return codec.normalizeDesignDocument(resolved.document);
}

/* ---------------------------------------------------------------------------
 * Interaction plan. World coordinates are checked offline against the real
 * hitTestCanvasNode on the canonical fixture (tests), and every edit is only
 * performed after the DOM selection and inspector geometry match the plan.
 * ------------------------------------------------------------------------- */
export const INTERACTION_PLAN = Object.freeze([
  // run2: the app snaps a move to its 8-unit grid and then to stationary node edges
  // within 6/zoom (app.js:2994-3010, geometry.mjs snapValue/snapBoundsToNodes). x=400
  // is on the grid and on underlay's left edge, so the result is exact at any zoom.
  { operation: "drag", targetId: "move-target", before: { x: 120, y: 140 }, selectAt: { x: 180, y: 180 },
    grab: { x: 180, y: 180 }, drop: { x: 460, y: 180 }, after: { x: 400, y: 140 }, tolerance: 0,
    clicks: [{ label: "new-position", world: { x: 440, y: 180 }, expected: ["move-target"] },
      { label: "old-position", world: { x: 180, y: 180 }, expected: [] },
      { label: "underlay-only", world: { x: 545, y: 250 }, expected: ["underlay"] }] },
  { operation: "inspector-x", targetId: "move-target", before: { x: 400, y: 140 }, selectAt: { x: 440, y: 180 },
    set: { x: 200 }, after: { x: 200, y: 140 }, tolerance: 0,
    clicks: [{ label: "new-position", world: { x: 260, y: 180 }, expected: ["move-target"] },
      { label: "old-position", world: { x: 470, y: 180 }, expected: ["underlay"] }] },
  { operation: "text-edit", targetId: "edit-target", before: { x: 120, y: 320 }, selectAt: { x: 160, y: 332 },
    text: "Edited HMI 已编辑", after: { x: 120, y: 320 }, tolerance: 0,
    clicks: [{ label: "new-position", world: { x: 160, y: 332 }, expected: ["edit-target"] },
      { label: "old-position", world: { x: 160, y: 420 }, expected: [] }] },
].map(step => Object.freeze(step)));
const INSPECTOR_PRECISION = 0.01;
const near = (value, expected, tolerance) => finite(value) && Math.abs(value - expected) <= Math.max(tolerance ?? 0, INSPECTOR_PRECISION);

/** Reasons not to edit: the DOM must select exactly the planned target at its planned geometry. */
export function guardPreEdit(step, { selectedIds, geometry } = {}) {
  const reasons = [];
  if (!Array.isArray(selectedIds)) reasons.push("DOM selection not observed");
  else if (selectedIds.length !== 1 || selectedIds[0] !== step.targetId)
    reasons.push(`selected ${JSON.stringify(selectedIds)} instead of ${step.targetId}`);
  if (!geometry || !near(geometry.x, step.before.x, step.beforeTolerance) || !near(geometry.y, step.before.y, step.beforeTolerance))
    reasons.push(`inspector geometry ${JSON.stringify(geometry ?? null)} is not the planned ${JSON.stringify(step.before)}`);
  return reasons;
}

/** Node state expected on disk and in the DOM after every planned edit succeeded. */
export function expectedStateAfterEdits() {
  const state = new Map();
  for (const step of INTERACTION_PLAN)
    state.set(step.targetId, { ...(state.get(step.targetId) ?? { id: step.targetId }), x: step.after.x, y: step.after.y, ...(step.text ? { text: step.text } : {}) });
  return [...state.values()];
}

/* ---------------------------------------------------------------------------
 * Verdicts. PASS needs concrete measured evidence; an absent or boolean-only
 * observation is UNVERIFIED. Performance and visual captures have no approved
 * numeric budget, so they are EVIDENCE_ONLY at best and never auto-pass.
 * ------------------------------------------------------------------------- */
export const FIDELITY_STATUS = Object.freeze({ PASS: "PASS", FAIL: "FAIL", UNVERIFIED: "UNVERIFIED", EVIDENCE_ONLY: "EVIDENCE_ONLY" });
export const OPEN_WAIT_MIN_MS = 2000;
export const IMMEDIATE_CLICK_MAX_MS = 250;
const isSha = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const finite = value => typeof value === "number" && Number.isFinite(value);
const validFileState = value => Boolean(value && isSha(value.sha256) && finite(value.mtimeMs) && finite(value.size));
const sameFileState = (a, b) => a.sha256 === b.sha256 && a.mtimeMs === b.mtimeMs && a.size === b.size;
const verdict = (status, reasons = [], extra = {}) => ({ status, reasons, ...extra });
const BUSY_SAVE_TEXT = /正在自动保存|保存中|有修改|外部变更|失败/u;

export function judgeOpenWithoutEdit(observation) {
  const missing = [];
  if (!observation || typeof observation !== "object") return verdict(FIDELITY_STATUS.UNVERIFIED, ["no observation"]);
  if (!validFileState(observation.before)) missing.push("before{sha256,mtimeMs,size}");
  if (!validFileState(observation.after)) missing.push("after{sha256,mtimeMs,size}");
  if (!finite(observation.waitedMs)) missing.push("waitedMs");
  const states = Array.isArray(observation.saveStates) ? observation.saveStates : [];
  if (states.length < 2) missing.push("at least two #save-state samples");
  if (states.some(state => typeof state?.kind !== "string" || !finite(state?.atMs))) missing.push("each #save-state sample needs kind and atMs");
  if (missing.length) return verdict(FIDELITY_STATUS.UNVERIFIED, [`missing ${missing.join(", ")}`]);
  const failures = [];
  if (!sameFileState(observation.before, observation.after)) failures.push("design bytes, mtime or size changed without an edit");
  for (const state of states)
    if (["dirty", "error"].includes(state.kind) || BUSY_SAVE_TEXT.test(state.text ?? ""))
      failures.push(`#save-state became ${state.kind} "${state.text ?? ""}" at ${state.atMs}ms`);
  if (failures.length) return verdict(FIDELITY_STATUS.FAIL, failures);
  if (observation.waitedMs < OPEN_WAIT_MIN_MS || Math.max(...states.map(state => state.atMs)) < OPEN_WAIT_MIN_MS)
    return verdict(FIDELITY_STATUS.UNVERIFIED, [`observed ${observation.waitedMs}ms; at least ${OPEN_WAIT_MIN_MS}ms after open is required`]);
  return verdict(FIDELITY_STATUS.PASS);
}

export function judgeImmediateClick(observation) {
  if (!observation || !Array.isArray(observation.clicks)) return verdict(FIDELITY_STATUS.UNVERIFIED, ["no click observations"]);
  const reasons = [];
  const step = INTERACTION_PLAN.find(value => value.operation === observation.operation && value.targetId === observation.targetId);
  if (!step) return verdict(FIDELITY_STATUS.UNVERIFIED, [`operation ${observation.operation} is not in the interaction plan`]);
  if (!observation.preEdit) reasons.push("pre-edit DOM selection/geometry was not verified");
  else reasons.push(...guardPreEdit(step, observation.preEdit).map(reason => `pre-edit: ${reason}`));
  const before = observation.geometryBefore, after = observation.geometryAfter;
  if (!before || !after || ![before.x, before.y, after.x, after.y].every(finite)) reasons.push("missing committed geometry before/after");
  else if (observation.operation !== "text-edit" && before.x === after.x && before.y === after.y) reasons.push("the edit did not change geometry");
  else if (!near(after.x, step.after.x, step.tolerance) || !near(after.y, step.after.y, step.tolerance))
    reasons.push(`committed geometry ${JSON.stringify(after)} is outside the planned ${JSON.stringify(step.after)} ±${step.tolerance}; the click oracle no longer applies`);
  const labels = new Set(observation.clicks.map(click => click?.label));
  for (const label of ["new-position", "old-position"]) if (!labels.has(label)) reasons.push(`missing ${label} click`);
  for (const click of observation.clicks) {
    if (!Array.isArray(click?.actualSelectedIds) || !Array.isArray(click?.expectedSelectedIds))
      reasons.push(`${click?.label}: actual DOM selection was not observed`);
    else if (!finite(click.elapsedSinceCommitMs)) reasons.push(`${click.label}: missing elapsedSinceCommitMs`);
    else if (click.elapsedSinceCommitMs > IMMEDIATE_CLICK_MAX_MS)
      reasons.push(`${click.label}: click ${click.elapsedSinceCommitMs}ms after commit is not immediate (<=${IMMEDIATE_CLICK_MAX_MS}ms)`);
  }
  if (reasons.length) return verdict(FIDELITY_STATUS.UNVERIFIED, reasons);
  const failures = observation.clicks.filter(click =>
    JSON.stringify([...click.actualSelectedIds].sort()) !== JSON.stringify([...click.expectedSelectedIds].sort()))
    .map(click => `${click.label}: selected ${JSON.stringify(click.actualSelectedIds)}, expected ${JSON.stringify(click.expectedSelectedIds)}`);
  return failures.length ? verdict(FIDELITY_STATUS.FAIL, failures) : verdict(FIDELITY_STATUS.PASS);
}

const RENDERER_COUNTERS = ["deviceTextSamplingBuilds", "deviceSamplingMisses", "tileBypassFrames", "cpuPrepMs"];
export function judgeLowZoomPerformance(observation) {
  if (!observation || typeof observation !== "object") return verdict(FIDELITY_STATUS.UNVERIFIED, ["no observation"]);
  const evidence = { frames: observation.frames, cpu: observation.cpu, renderer: observation.renderer ?? null, camera: observation.camera };
  const reasons = [];
  if (!(observation.textNodeCount >= 1000)) reasons.push(`fixture has ${observation.textNodeCount} text nodes; 1000+ real text nodes are required`);
  if (!(observation.openedTextLayerCount >= 1000))
    reasons.push(`large document is not open in the DOM (${observation.openedTextLayerCount ?? "no"} text layers listed)`);
  const camera = observation.camera;
  if (!camera || ![camera.zoom, camera.panX, camera.panY, camera.dpr].every(finite)) reasons.push("camera was not observed");
  else {
    if (!(camera.zoom < 1) || Number.isInteger(camera.zoom * camera.dpr)) reasons.push(`zoom ${camera.zoom} is not a non-integer low zoom`);
    if (Number.isInteger(camera.panX * camera.dpr) && Number.isInteger(camera.panY * camera.dpr)) reasons.push("pan has no fractional device phase");
  }
  if (!(observation.frames?.count > 0) || !Array.isArray(observation.frames?.intervalsMs) || !observation.frames.intervalsMs.length)
    reasons.push("no real frame timing was recorded");
  const renderer = observation.renderer;
  if (!renderer || !RENDERER_COUNTERS.every(key => finite(renderer[key])))
    reasons.push("renderer device sampling builds/misses, tile bypass and CPU prep counters are not observable in the installed app");
  if (reasons.length) return verdict(FIDELITY_STATUS.UNVERIFIED, reasons, { evidence });
  return verdict(FIDELITY_STATUS.EVIDENCE_ONLY, ["no approved performance budget; recorded for review"], { evidence });
}

const nodeMatches = (actual, expected) => Boolean(actual) && near(actual.x, expected.x, 0) && near(actual.y, expected.y, 0) &&
  (expected.text === undefined || actual.text === expected.text);
export function judgeSaveReopen(observation) {
  if (!observation || typeof observation !== "object") return verdict(FIDELITY_STATUS.UNVERIFIED, ["no observation"]);
  const o = observation, plannedOperations = INTERACTION_PLAN.map(step => step.operation);
  // Preconditions: every planned edit verified, and the edited document is still the open one.
  const edits = o.editsVerified;
  if (!edits || !Array.isArray(edits.operations) || !Array.isArray(edits.statuses) ||
      edits.operations.join() !== plannedOperations.join() || edits.statuses.some(status => status !== FIDELITY_STATUS.PASS))
    return verdict(FIDELITY_STATUS.UNVERIFIED, ["the planned edits were not all verified (PASS) before saving"]);
  if (typeof o.path !== "string" || o.pathBeforeSave !== o.path)
    return verdict(FIDELITY_STATUS.UNVERIFIED, [`the edited document was not the open document before save (${o.pathBeforeSave})`]);
  const missing = [], failures = [];
  const expected = Array.isArray(o.expected) && o.expected.length ? o.expected : null;
  if (!expected) missing.push("expected nodes");
  if (!Array.isArray(o.baselineNodes) || !o.baselineNodes.length) missing.push("baseline nodes");
  const saveObserved = save => save && typeof save.kind === "string" && validFileState(save.file);
  if (!saveObserved(o.firstSave)) missing.push("first save state and file");
  else if (o.firstSave.kind !== "saved") failures.push(`first save ended as ${o.firstSave.kind}`);
  if (!Array.isArray(o.diskNodesAfterFirstSave)) missing.push("disk nodes after first save");
  else if (expected && Array.isArray(o.baselineNodes)) {
    const disk = new Map(o.diskNodesAfterFirstSave.map(node => [node.id, node]));
    for (const node of expected) {
      if (!disk.has(node.id)) missing.push(`disk node ${node.id}`);
      else if (!nodeMatches(disk.get(node.id), node)) failures.push(`disk ${node.id} ${JSON.stringify(disk.get(node.id))} is not the expected ${JSON.stringify(node)}`);
    }
    for (const node of o.baselineNodes.filter(value => !expected.some(target => target.id === value.id))) {
      if (!disk.has(node.id)) missing.push(`disk node ${node.id}`);
      else if (!nodeMatches(disk.get(node.id), node)) failures.push(`non-target ${node.id} changed on disk: ${JSON.stringify(disk.get(node.id))}`);
    }
  }
  if (!Array.isArray(o.domAfterReload)) missing.push("reloaded DOM nodes");
  else if (expected) {
    const dom = new Map(o.domAfterReload.map(node => [node.id, node]));
    for (const node of expected) {
      if (!dom.has(node.id)) missing.push(`reloaded DOM node ${node.id}`);
      else if (!nodeMatches(dom.get(node.id), node)) failures.push(`reloaded DOM ${node.id} ${JSON.stringify(dom.get(node.id))} is not the expected ${JSON.stringify(node)}`);
    }
  }
  if (!Array.isArray(o.layerIdsBefore) || !Array.isArray(o.layerIdsAfterReopen)) missing.push("layer ids");
  else if (JSON.stringify(o.layerIdsBefore) !== JSON.stringify(o.layerIdsAfterReopen)) failures.push("layer identity/order changed after reopen");
  // Reload must not write or dirty the saved document: every sample counts, and the
  // file must still be the first save's bytes, mtime and size before the second save.
  const samples = o.reopenSaveStates;
  if (!Array.isArray(samples) || samples.length < 2 || samples.some(sample => typeof sample?.kind !== "string" || !finite(sample?.atMs)))
    missing.push("complete #save-state samples after reload");
  else for (const sample of samples)
    if (["dirty", "error"].includes(sample.kind) || BUSY_SAVE_TEXT.test(sample.text ?? ""))
      failures.push(`after reload #save-state was ${sample.kind} "${sample.text ?? ""}" at ${sample.atMs}ms`);
  if (!finite(o.reopenWaitedMs)) missing.push("reload observation duration");
  else if (o.reopenWaitedMs < OPEN_WAIT_MIN_MS || (Array.isArray(samples) && Math.max(...samples.map(sample => sample?.atMs ?? 0)) < OPEN_WAIT_MIN_MS))
    missing.push(`at least ${OPEN_WAIT_MIN_MS}ms of reload observation (observed ${o.reopenWaitedMs}ms)`);
  if (!validFileState(o.reopenedBeforeSecondSave)) missing.push("file snapshot after reload, before the second save");
  else if (saveObserved(o.firstSave) && !sameFileState(o.reopenedBeforeSecondSave, o.firstSave.file))
    failures.push(`reload changed the saved file before the second save: ${JSON.stringify(o.firstSave.file)} → ${JSON.stringify(o.reopenedBeforeSecondSave)}`);
  if (!saveObserved(o.secondSave)) missing.push("second save state and file");
  else {
    if (o.secondSave.kind !== "saved") failures.push(`second save ended as ${o.secondSave.kind}`);
    if (saveObserved(o.firstSave) && o.secondSave.file.sha256 !== o.firstSave.file.sha256) failures.push("second save changed bytes");
  }
  if (!isSha(o.canonicalSha256)) missing.push("canonical sha256");
  else if (saveObserved(o.firstSave) && o.canonicalSha256 !== o.firstSave.file.sha256)
    failures.push("saved bytes are not the installed codec's canonical serialization");
  if (failures.length) return verdict(FIDELITY_STATUS.FAIL, failures);
  if (missing.length) return verdict(FIDELITY_STATUS.UNVERIFIED, [`missing ${missing.join(", ")}`]);
  return verdict(FIDELITY_STATUS.PASS);
}

const REQUIRED_VISUAL_ROUTES = ["gpu", "browser", "html"];
/** Readback of the overlay transform is float32; this is its precision, not a visual allowance. */
export const ZOOM_TOLERANCE = 1e-6;
export const zoomMatches = (actual, target) => finite(actual) && finite(target) && target > 0 && Math.abs(actual / target - 1) <= ZOOM_TOLERANCE;

/**
 * Device-pixel crop of the design page for one capture: world page bounds through the
 * shared camera (CSS = zoom*world + pan; device = CSS*dpr), clipped to the capture.
 * Visible app overlays (toolbar, toast, hints; CSS px relative to the stage) that touch
 * the crop make it ineligible for comparison rather than being mixed in.
 */
export function pageCropRect({ camera, pageBounds, capture, overlays = [] }) {
  const { zoom, panX, panY, dpr } = camera;
  const x0 = (zoom * pageBounds.x + panX) * dpr, y0 = (zoom * pageBounds.y + panY) * dpr;
  const x1 = (zoom * (pageBounds.x + pageBounds.width) + panX) * dpr, y1 = (zoom * (pageBounds.y + pageBounds.height) + panY) * dpr;
  const left = Math.max(0, Math.floor(x0)), top = Math.max(0, Math.floor(y0));
  const right = Math.min(capture.width, Math.ceil(x1)), bottom = Math.min(capture.height, Math.ceil(y1));
  const touching = overlays.filter(overlay => overlay.x * dpr < right && (overlay.x + overlay.width) * dpr > left &&
    overlay.y * dpr < bottom && (overlay.y + overlay.height) * dpr > top).map(overlay => overlay.name);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top),
    clipped: left > Math.floor(x0) || top > Math.floor(y0) || right < Math.ceil(x1) || bottom < Math.ceil(y1),
    comparisonEligible: right > left && bottom > top && touching.length === 0, overlays: touching,
    transform: { deviceScale: zoom * dpr, originX: x0, originY: y0 } };
}
export function judgeVisualCaptureGroup(group) {
  const captures = Array.isArray(group?.captures) ? group.captures : [];
  const reasons = [];
  for (const route of REQUIRED_VISUAL_ROUTES) if (!captures.some(capture => capture.route === route)) reasons.push(`missing ${route} capture`);
  for (const capture of captures) {
    if (!isSha(capture.png?.sha256) || !(capture.png?.width > 0) || !(capture.png?.height > 0)) reasons.push(`${capture.route}: no PNG`);
    else if (!(capture.png.distinctColors > 1)) reasons.push(`${capture.route}: blank capture`);
    if (![capture.camera?.zoom, capture.camera?.panX, capture.camera?.panY, capture.camera?.dpr].every(finite)) reasons.push(`${capture.route}: camera not observed`);
  }
  const first = captures[0]?.camera;
  if (first && captures.some(capture => ["zoom", "panX", "panY", "dpr"].some(key => Math.abs(capture.camera?.[key] - first[key]) > 1e-9)))
    reasons.push("routes do not share one camera");
  // run2: the "100"/"200" groups were captured at zoom 0.1. A labelled target must be reached.
  if (finite(group?.targetZoom)) {
    if (group.zoom?.reached !== true) reasons.push(`target zoom ${group.targetZoom} was not reached: ${JSON.stringify(group.zoom?.reasons ?? null)}`);
    for (const capture of captures)
      if (!zoomMatches(capture.camera?.zoom, group.targetZoom))
        reasons.push(`${capture.route}: camera zoom ${capture.camera?.zoom} is not the target zoom ${group.targetZoom}`);
  }
  const crop = captures[0]?.pageCrop;
  for (const capture of captures) {
    const value = capture.pageCrop;
    if (!value || ![value.x, value.y, value.width, value.height].every(finite)) reasons.push(`${capture.route}: no page crop`);
    else {
      if (value.comparisonEligible !== true) reasons.push(`${capture.route}: page crop overlaps app overlays ${JSON.stringify(value.overlays ?? [])}`);
      if (crop && ["x", "y", "width", "height"].some(key => value[key] !== crop[key])) reasons.push(`${capture.route}: page crop differs from the other routes`);
    }
  }
  if (reasons.length) return verdict(FIDELITY_STATUS.UNVERIFIED, reasons);
  return verdict(FIDELITY_STATUS.EVIDENCE_ONLY, ["visual equivalence needs reviewed comparison; captures are evidence only"]);
}

export function judgeSvgCornerProbe(observation) {
  const notes = [];
  if (observation?.dpr !== 1) notes.push(`captured at DPR${observation?.dpr}; the four FAIL rows were DPR1/z1`);
  const status = observation?.semantic?.status;
  if (status === "PASS") return verdict(FIDELITY_STATUS.PASS, [], { notes });
  if (status === "FAIL_SVG_GEOMETRY") return verdict(FIDELITY_STATUS.FAIL, [observation.semantic.reason ?? "SVG coverage outside the authored geometry contract"], { notes });
  return verdict(FIDELITY_STATUS.UNVERIFIED, [`semantic status ${status ?? "missing"}`], { notes });
}

export function planDesignStudioFidelityScenarios({ sample = false } = {}) {
  const P = FIDELITY_FIXTURE_PATHS;
  return [
    { id: "low-zoom-fractional-performance", fixture: P.largeText, fixtures: [P.largeText],
      steps: ["Ctrl+wheel to a non-integer zoom < 1", "fractional wheel pans", "record rAF frame intervals and CDP Performance.getMetrics deltas"],
      observables: ["requestAnimationFrame intervals in the guest", "CDP Performance.getMetrics ScriptDuration/TaskDuration/LayoutDuration"],
      knownGaps: ["CanvasKit renderer stats() (deviceTextSamplingBuilds, tile builds/hits, renderMode, lastRenderSubmitMs) are not exposed to DOM/window in the installed app; device sampling misses and tile bypass remain UNVERIFIED without a reviewed read-only surface"] },
    { id: "open-without-edit", fixture: P.legacyReceipts, fixtures: [P.legacyReceipts, ...(sample ? ["sample"] : [])],
      steps: ["open via #open-files → #files-dialog .file-row", `sample #save-state and file bytes/mtime for >= ${OPEN_WAIT_MIN_MS}ms without input`],
      observables: ["file sha256/mtime/size (Node, temp project)", "#save-state[data-kind] + text", "#path value"],
      knownGaps: ["Host storage writes for lastPath/recent/recovery are not design bytes and are not gated here"] },
    { id: "immediate-click-after-edit", fixture: P.interaction, fixtures: [P.interaction],
      steps: ["before each edit: DOM selection and inspector geometry must equal INTERACTION_PLAN", "real drag via webContents.sendInputEvent", "immediate click at new and old geometry", "inspector #prop-x edit then immediate click",
        "inline text edit (Enter, type, Cmd/Ctrl+Enter) then immediate click"],
      observables: ["#layers-list .layer-row[aria-selected=true][data-id]", "#prop-x/#prop-y", "#stage 2D transform (camera)"],
      knownGaps: ["hitTest is synchronous on cached scene geometry; the GPU scene rebuild timing itself is not exposed"] },
    { id: "save-reopen-stable", fixture: P.interaction, fixtures: [P.interaction],
      steps: ["directly after the verified edits (same open document): explicit #save and confirm saved",
        "read disk with the installed codec: expected node id/text/x/y, non-targets unchanged", "reload the guest (lastPath reopen) and read the same nodes from the DOM inspector",
        "second #save confirmed saved; bytes stable and canonical"],
      observables: ["file sha256/mtime/size", "installed codec read of disk", "#prop-x/#prop-y/#prop-text after reload", "layer ids/order", "#save-state"],
      knownGaps: ["whether webview reload keeps the Host binding is unverified; a failed reload is UNVERIFIED"] },
    { id: "same-camera-visual", fixture: P.rotationStrips, fixtures: [P.rotationStrips],
      steps: ["GPU and browser renderer captures at ~100%, ~200% (Ctrl+wheel) and fit", "HTML reference from installed frontend-export in an owned hidden BrowserWindow of the same Electron"],
      observables: ["capturePage PNG + sha256", "#stage transform for every route"],
      knownGaps: ["no 100%/200% preset exists; zoom is reached by Ctrl+wheel within float tolerance", "visual equivalence requires review; no automatic pass"] },
    { id: "svg-corner-aa-host", fixture: P.svgCornerAa, fixtures: [P.svgCornerAa],
      steps: ["installed exportDesignSvg rendered at original size in the owned reference window", "GPU/browser captures at zoom 1", "SVG semantic oracle on the SVG capture"],
      observables: ["capturePage PNG", "tests/apps/design-studio/svg-semantic-metrics.mjs compareSvgSemantics"],
      knownGaps: ["a Retina Host captures DPR2; the four FAIL rows were DPR1/z1 and need a DPR1 display to reproduce"] },
  ];
}

export function summarizeFidelityReport(results, plan = planDesignStudioFidelityScenarios()) {
  const byId = new Map(results.map(result => [result.id, result]));
  const counts = Object.fromEntries(Object.values(FIDELITY_STATUS).map(status => [status, 0]));
  const notRun = [];
  for (const scenario of plan) {
    const result = byId.get(scenario.id);
    if (!result) { notRun.push(scenario.id); continue; }
    counts[result.status] = (counts[result.status] ?? 0) + 1;
  }
  const ids = status => plan.map(value => value.id).filter(id => byId.get(id)?.status === status);
  const overall = counts.FAIL ? "FAIL" : counts.PASS === plan.length ? "PASS" : "INCOMPLETE";
  return { overall, goalComplete: false, counts, notRun, failed: ids("FAIL"), unverified: ids("UNVERIFIED"), evidenceOnly: ids("EVIDENCE_ONLY"),
    note: "A PASS here covers only these synthetic real-Host scenarios; it is not overall visual acceptance or goal completion." };
}

/*
 * Output contract (breaking for --design-studio-fidelity only). Node has no openat,
 * so any path-based write below a user-chosen directory can be redirected by
 * replacing a parent with a symlink between a check and the write. Instead:
 *   - the only output root is the system temp directory whose whole path chain is
 *     root-owned, non-symlink and (where writable by others) sticky; a non-root
 *     process cannot replace any component of it;
 *   - exactly two files are created directly in it with O_CREAT|O_EXCL|O_NOFOLLOW
 *     (no directory is ever created), and their handles are held;
 *   - every PNG and the report are written only through those handles, so later
 *     renames/symlink swaps of the paths cannot redirect a single byte.
 * Unsupported platforms (no such root) are refused rather than given a weaker check.
 */
export const SYSTEM_OUTPUT_ROOTS = Object.freeze({ darwin: "/private/tmp", linux: "/tmp" });
const ROOT_CHAIN_ERROR = "fidelity output root must be a root-owned, non-symlink directory chain";
export async function verifyRootOwnedOutputRoot(root) {
  if (typeof root !== "string" || !isAbsolute(root) || resolve(root) !== root) throw new Error(`${ROOT_CHAIN_ERROR}: ${root} is not a normalized absolute path`);
  const chain = [], parts = root.split(sep).filter(Boolean);
  for (let index = 0; index <= parts.length; index++) {
    const path = sep + parts.slice(0, index).join(sep);
    const value = await lstat(path);
    if (value.isSymbolicLink()) throw new Error(`${ROOT_CHAIN_ERROR}: ${path} is a symlink`);
    if (!value.isDirectory()) throw new Error(`${ROOT_CHAIN_ERROR}: ${path} is not a directory`);
    if (value.uid !== 0) throw new Error(`${ROOT_CHAIN_ERROR}: ${path} is owned by uid ${value.uid}, not root-owned`);
    if ((value.mode & 0o022) && !(value.mode & 0o1000)) throw new Error(`${ROOT_CHAIN_ERROR}: ${path} is writable by others without the sticky bit`);
    chain.push({ path, uid: value.uid, mode: (value.mode & 0o7777).toString(8), symlink: false });
  }
  return chain;
}

const OUTPUT_FLAGS = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_CLOEXEC ?? 0);
const ARTIFACT_LABEL = /^[a-z0-9][a-z0-9-]{0,80}$/u;
export async function claimFidelityOutputs({ root = SYSTEM_OUTPUT_ROOTS[process.platform], name } = {}) {
  if (!root) throw new Error(`no root-owned output root is defined for ${process.platform}; Design Studio fidelity outputs are refused`);
  const chain = await verifyRootOwnedOutputRoot(root);
  const outputName = name ?? `ds-host-fidelity-${Date.now()}-${randomBytes(8).toString("hex")}`;
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/u.test(outputName)) throw new Error(`invalid output name: ${outputName}`);
  const reportPath = join(root, `${outputName}.report.json`), bundlePath = join(root, `${outputName}.artifacts.bin`);
  const report = await open(reportPath, OUTPUT_FLAGS, 0o600);
  let bundle;
  try { bundle = await open(bundlePath, OUTPUT_FLAGS, 0o600); }
  catch (error) {
    // Remove only our own just-created report: the path must still name the held inode.
    const held = await report.stat();
    await report.close();
    const current = await lstat(reportPath).catch(() => null);
    if (current && current.dev === held.dev && current.ino === held.ino) await unlink(reportPath);
    throw error;
  }
  const identity = { report: await report.stat(), bundle: await bundle.stat() };
  const artifacts = [];
  let offset = 0, queue = Promise.resolve(), reportWritten = false, closed = false;
  const serial = task => (queue = queue.then(task, task));
  return {
    name: outputName, root, rootChain: chain, reportPath, bundlePath,
    identity: { report: { dev: identity.report.dev, ino: identity.report.ino }, bundle: { dev: identity.bundle.dev, ino: identity.bundle.ino } },
    artifacts: () => artifacts.map(value => ({ ...value })),
    reportWritten: () => reportWritten,
    writeArtifact: (label, buffer) => serial(async () => {
      if (closed) throw new Error("fidelity outputs are closed");
      if (typeof label !== "string" || !ARTIFACT_LABEL.test(label)) throw new Error(`invalid artifact label: ${label}`);
      if (artifacts.some(value => value.label === label)) throw new Error(`duplicate artifact label: ${label}`);
      const bytes = Buffer.from(buffer);
      const { bytesWritten } = await bundle.write(bytes, 0, bytes.length, offset);
      if (bytesWritten !== bytes.length) throw new Error(`short artifact write for ${label}`);
      const record = { label, offset, length: bytes.length, sha256: sha256(bytes) };
      offset += bytes.length;
      artifacts.push(record);
      return { ...record };
    }),
    writeReport: text => serial(async () => {
      if (closed) throw new Error("fidelity outputs are closed");
      if (reportWritten) throw new Error("the fidelity report is written once");
      reportWritten = true;
      const bytes = Buffer.from(text, "utf8");
      const { bytesWritten } = await report.write(bytes, 0, bytes.length, 0);
      if (bytesWritten !== bytes.length) throw new Error("short report write");
      await report.sync();
      await bundle.sync();
    }),
    close: () => serial(async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled([report.close(), bundle.close()]);
    }),
  };
}

/**
 * Failure evidence. After the existing owned Electron/HOME cleanup has run, a
 * failed run writes one partial through the held report handle: completed
 * fidelity results, the artifact-bundle index and the actual cleanup outcome.
 * It is never complete, never PASS, and a write problem never replaces the
 * original failure (the caller still exits non-zero).
 */
export function describeOwnedCleanup({ receipt = null, error = null, primaryFailure = null } = {}) {
  if (!error) return { completed: true, receipt, homeRetained: false, errors: [] };
  // cleanupPanelDesktopFixture always rethrows the primary failure (as AggregateError)
  // and adds an error for every close/exit/HOME problem, so only the other errors
  // describe the cleanup itself. With a primary failure it returns no receipt; none
  // is fabricated here.
  const errors = (error instanceof AggregateError ? error.errors : [error]).filter(value => value !== primaryFailure)
    .map(value => String(value?.message ?? value));
  const completed = errors.length === 0;
  return { completed, receipt: null,
    receiptUnavailableReason: completed
      ? "cleanup helper rethrows the primary failure instead of returning a receipt; success is inferred from it reporting no other error"
      : "owned cleanup reported errors besides the primary failure",
    ...(completed ? { inferredFromHelperSemantics: { ownedElectronClosedOrNotLaunched: true, homeRemoved: true } } : {}),
    homeRetained: errors.some(message => /HOME retained/u.test(message)), errors };
}
/** Serialize a failure with its AggregateError members and cause chain (bounded depth). */
function serializeFailure(failure, depth = 0) {
  if (!failure) return null;
  const value = { name: failure.name ?? "Error", message: String(failure.message ?? failure) };
  if (depth >= 4) return value;
  if (failure instanceof AggregateError) value.errors = failure.errors.map(member => serializeFailure(member, depth + 1));
  if (failure.cause) value.cause = serializeFailure(failure.cause, depth + 1);
  for (const key of ["timedOut", "unsettled", "cleanup"]) if (failure[key] !== undefined) value[key] = failure[key];
  return value;
}
/*
 * Responsibility boundary found by the first real-Host run (2026-11-07): the
 * Host renderer requests external-runtime model discovery at startup
 * (useExternalRuntimeModels → externalRuntime:models → ExternalRuntimeModelService
 * .list → discoverCodexModels), which spawns `codex app-server` from PATH when the
 * user-scope feature flag external_agent_runtime (default true) is on. That is a
 * Host provider integration, not a Design Studio rendering/persistence path, so the
 * fidelity opt-in turns the Host's own flag off in its private CODE_SHELL_HOME.
 * No provider is mocked and no check is skipped: NativeEntry custody still verifies
 * every started entry, and the legacy no-flag gate keeps its settings unchanged.
 */
export const EXTERNAL_AGENT_RUNTIME_BOUNDARY = Object.freeze({
  status: "NOT_APPLICABLE",
  setting: "featureFlags.external_agent_runtime=false in the private fixture CODE_SHELL_HOME/settings.json (Host user scope)",
  reason: "Host startup model discovery spawns `codex app-server` from PATH; external agent runtimes are a Host provider integration, not a Design Studio fidelity surface",
  legacyGate: "the no-flag desktop gate is unchanged and still exercises (and reports) this Host behaviour",
});
export function desktopFixtureSettings({ fidelity = false } = {}) {
  return fidelity ? { autoUpdates: false, featureFlags: { external_agent_runtime: false } } : { autoUpdates: false };
}

export function buildFidelityFailurePartial({ stage, failure, fidelityReport, artifacts = [], cleanup, boundaries = null }) {
  return { schemaVersion: 1, partial: true, complete: false, goalComplete: false, overall: "NOT_COMPLETE", stage: stage ?? null,
    failure: serializeFailure(failure),
    designStudioFidelity: fidelityReport ?? { status: "NOT_RUN" }, artifacts, cleanup, ...(boundaries ? { boundaries } : {}),
    note: "Partial evidence from a failed run: completed scenario results and artifacts only; not acceptance and not a PASS." };
}
export async function writeFidelityPartialOnce(outputs, partial) {
  if (!outputs) return { written: false, reason: "no fidelity outputs" };
  if (outputs.reportWritten()) return { written: false, reason: "report already written" };
  try {
    await outputs.writeReport(`${JSON.stringify(partial, null, 2)}\n`);
    return { written: true };
  } catch (error) { return { written: false, error: String(error?.message ?? error) }; }
}

/** Map authored world geometry into the exported SVG's original-size device pixels. */
export function svgReferenceGeometry(svg) {
  const root = /<svg\b[^>]*>/u.exec(svg)?.[0];
  const viewBox = root && /\sviewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/u.exec(root);
  const width = root && /\swidth="([\d.]+)"/u.exec(root), height = root && /\sheight="([\d.]+)"/u.exec(root);
  if (!viewBox || !width || !height) return null;
  const [minX, minY, boxWidth] = viewBox.slice(1).map(Number);
  const scale = Number(width[1]) / boxWidth;
  const round = value => Math.round(value * 1e9) / 1e9;
  return { viewport: { width: Number(width[1]), height: Number(height[1]) }, minX, minY, scale,
    toDevice: (node, dpr) => ({ x: round(dpr * scale * (node.x - minX)), y: round(dpr * scale * (node.y - minY)),
      width: round(dpr * scale * node.width), height: round(dpr * scale * node.height) }) };
}
