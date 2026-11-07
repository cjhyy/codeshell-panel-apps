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
export const DESIGN_STUDIO_FORCE_DSF_FLAG = "--design-studio-force-dsf";
export const DESIGN_STUDIO_DISABLE_GPU_RASTER_FLAG = "--design-studio-disable-gpu-raster";
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
  let reportArgument, selectedApp, fidelity = false, samplePath = null, sampleSeen = false, probe = false, forceDeviceScaleFactor = null, disableGpuRasterization = false;
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
    } else if (value === DESIGN_STUDIO_FORCE_DSF_FLAG) {
      const factor = Number(rest[index + 1]);
      if (forceDeviceScaleFactor !== null || !rest[index + 1] || !/^\d+(\.\d+)?$/u.test(rest[index + 1]) || !(factor > 0) || factor > 4)
        throw new Error(`${DESIGN_STUDIO_FORCE_DSF_FLAG} requires one positive number (owned Electron only)`);
      forceDeviceScaleFactor = factor;
      index++;
    } else if (value === DESIGN_STUDIO_DISABLE_GPU_RASTER_FLAG) {
      if (disableGpuRasterization) throw new Error(`${DESIGN_STUDIO_DISABLE_GPU_RASTER_FLAG} given twice`);
      disableGpuRasterization = true;
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
  // A forced device scale factor changes only the owned Electron's display scale (a controlled DPR,
  // not a physical display). Allowed for probes and for the fidelity scenarios; reports record it.
  if (forceDeviceScaleFactor !== null && !fidelity) throw new Error(`${DESIGN_STUDIO_FORCE_DSF_FLAG} requires ${DESIGN_STUDIO_FIDELITY_FLAG}`);
  // Single-variable raster-backend control for the owned Electron only; probes only.
  if (disableGpuRasterization && !probe) throw new Error(`${DESIGN_STUDIO_DISABLE_GPU_RASTER_FLAG} requires ${DESIGN_STUDIO_PROBE_FLAG}`);
  if (!fidelity) return { hostArgument, reportArgument, selectedApp, designStudioFidelity: null };
  // Breaking for this opt-in only: outputs are created by the harness itself in the
  // root-owned system temp directory and written through held handles.
  if (reportArgument) throw new Error(`${DESIGN_STUDIO_FIDELITY_FLAG} does not accept a report path (${reportArgument}); ` +
    "its report and artifact bundle are harness-owned files in the root-owned system temp directory, printed at start");
  if (selectedApp && selectedApp !== "design-studio")
    throw new Error(`${DESIGN_STUDIO_FIDELITY_FLAG} only runs --app design-studio, not ${selectedApp}`);
  return { hostArgument, reportArgument, selectedApp: "design-studio", designStudioFidelity: { samplePath, probe, forceDeviceScaleFactor, disableGpuRasterization } };
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
  coverage: "designs/host-fidelity-coverage.codesign.json",
});
/**
 * High-risk coverage matrix (one small document, top-level nodes on white so no frame label
 * band overlaps a region). World regions include a margin around each node's paint.
 * `editable` marks the text nodes whose inline editor overlay is measured.
 */
export const COVERAGE_BUILTIN_INTER = Object.freeze({ id: "builtin-inter-400-normal", family: "Inter", file: "fonts/InterVariable.woff2" });
export const COVERAGE_IMAGE_ID = "coverage-png";
export const COVERAGE_CASES = Object.freeze([
  { id: "inter-default", region: [16, 36, 208, 40], note: "fontFamily Inter stack without fontRef (the app's default text)" },
  { id: "inter-bytes", region: [246, 36, 208, 40], note: "Inter bound to the bundled bytes as builtin-inter-400-normal", editable: true },
  { id: "cjk-center", region: [16, 92, 208, 36], note: "CJK + Latin, textAlign center", editable: true },
  { id: "cjk-right", region: [246, 92, 208, 36], note: "CJK + Latin, textAlign right" },
  { id: "ranges-fill-link", region: [16, 144, 208, 36], note: "textRanges: plain fill run + href link run on bundled Inter" },
  { id: "finite-multiline", region: [246, 140, 208, 60], note: "imported finite baseline offset, two lines" },
  { id: "image-cover", region: [16, 216, 104, 64], note: "PNG resource, objectFit cover" },
  { id: "image-contain", region: [136, 216, 104, 64], note: "PNG resource, objectFit contain" },
  { id: "image-cover-rounded", region: [256, 216, 104, 64], note: "PNG resource, objectFit cover, cornerRadius 8 (overflow clip x rounded AA)" },
  // Range text (range-render batch): each case is one text node on the bundled Inter bytes.
  { id: "range-cjk-missing", region: [16, 296, 208, 36], note: "range on Inter whose CJK glyphs are absent from the supplied font", range: true, editable: true },
  { id: "range-typography", region: [246, 296, 208, 40], note: "ranges: weight 700, size 18 on 14, italic (supplied italic bytes)", range: true },
  { id: "range-underline", region: [16, 344, 208, 36], note: "range textDecoration underline", range: true },
  { id: "range-multiline", region: [246, 344, 208, 56], note: "two lines lh 1.3, one fill range spans the newline", range: true },
  { id: "range-finite", region: [16, 392, 208, 36], note: "imported finite origin + fill range", range: true },
  // Range-decoration batch: underline/line-through cases, plus two minimal native-remainder probes.
  { id: "node-underline-color", region: [246, 412, 208, 36], note: "node-level underline with a coloured inner run", range: true, decoration: true },
  { id: "underline-descender-2line", region: [16, 444, 208, 56], note: "underline range across a newline over descenders (skip-ink)", range: true, decoration: true },
  { id: "range-line-through", region: [246, 460, 208, 36], note: "line-through range", range: true, decoration: true },
  { id: "range-mixed-multiline", region: [16, 512, 208, 60], note: "two lines, 18px run on 14px (typography + multiline)", range: true },
  { id: "range-finite-typo", region: [246, 512, 208, 40], note: "finite origin + weight range (HTML lays it out as a plain line box)", range: true },
  // Range-final batch.
  { id: "finite-source-plain", region: [16, 580, 208, 40], note: "plain finite text with layoutBaselineSource html (HTML: plain line box at node.y)" },
  { id: "node-underline-mixed", region: [246, 576, 208, 44], note: "node-level underline over an 18px run on 14px", range: true, decoration: true },
  { id: "arial-underline", region: [16, 624, 208, 36], note: "system font (Arial, no supplied bytes) range underline", range: true, decoration: true },
].map(value => Object.freeze(value)));
export const COVERAGE_BUILTIN_INTER_ITALIC = Object.freeze({ id: "builtin-inter-400-italic", family: "Inter", file: "fonts/InterVariable-Italic.woff2" });
/** Deterministic 64x32 PNG: two colour fields and a dark diagonal, so cover/contain crops differ visibly. */
export function coveragePngBytes() {
  const require = createRequire(import.meta.url), { PNG } = require("pngjs");
  const image = new PNG({ width: 64, height: 32 });
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    const o = (y * 64 + x) * 4, diagonal = Math.abs(x - 2 * y) <= 1;
    const [r, g, b] = diagonal ? [31, 35, 40] : x < 32 ? [37, 99, 235] : [249, 115, 22];
    image.data[o] = r; image.data[o + 1] = g; image.data[o + 2] = b; image.data[o + 3] = 255;
  }
  return PNG.sync.write(image);
}
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

export async function buildDesignStudioFidelityFixtures({ codec, textMetrics, documentIndex, resourceStore = null, readAppBytes = null }) {
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
    // Seeded first (oldest mtime): the app auto-opens the newest design at startup (chooseRepoDesignFile),
    // which must stay large-text as in earlier runs; cov-dpr2-c auto-opened this one instead.
    ...(resourceStore && readAppBytes ? [await coverageFixture({ codec, textMetrics, resourceStore, readAppBytes, canonical })] : []),
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

/** Coverage document with two codec resources (bundled Inter bytes, synthetic PNG) and their part files. */
async function coverageFixture({ codec, textMetrics, resourceStore, readAppBytes, canonical }) {
  const plan = (id, kind, mime, bytes, font = {}) => resourceStore.createDesignResourcePersistencePlan({ id, kind, mime,
    base64: Buffer.from(bytes).toString("base64"), ...font, sha256Bytes: async value => sha256(value) });
  const font = await plan(COVERAGE_BUILTIN_INTER.id, "font", "font/woff2", await readAppBytes(COVERAGE_BUILTIN_INTER.file),
    { family: COVERAGE_BUILTIN_INTER.family, weight: 400, style: "normal" });
  const image = await plan(COVERAGE_IMAGE_ID, "image", "image/png", coveragePngBytes());
  const italic = await plan(COVERAGE_BUILTIN_INTER_ITALIC.id, "font", "font/woff2", await readAppBytes(COVERAGE_BUILTIN_INTER_ITALIC.file),
    { family: COVERAGE_BUILTIN_INTER_ITALIC.family, weight: 400, style: "italic" });
  const ranged = (id, x, y, width, height, value, ranges, extra = {}) => fixtureText(id, x, y, width, height, value, { ...bound, lineHeight: 1.3, ...extra,
    textRanges: { version: 1, sourceSignature: textRangesSignature(value), ranges } });
  const cjk = "Inter 中文 mixed 字形", typo = "Bold Big italic run", under = "Under line here", multi = "Line one fill\nLine two link";
  const bound = { fontFamily: "Inter", fontRef: COVERAGE_BUILTIN_INTER.id };
  // Latin only: bundled Inter has every glyph. A CJK run here makes the GPU renderer refuse the whole
  // scene (TEXT_RANGES_UNSUPPORTED, cov-dpr2-b), recorded separately as a finding.
  const linkText = "Plain fill and link run";
  const children = [
    fixtureText("inter-default", 20.3, 44.3, 200, 28, "Inter 默认 Hgx 42", { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", fontSize: 20, lineHeight: 1.3 }),
    fixtureText("inter-bytes", 250.3, 44.3, 200, 28, "Inter 字节 Hgx 42", { ...bound, fontSize: 20, lineHeight: 1.3 }),
    fixtureText("cjk-center", 20.3, 98.3, 200, 24, "居中 Center 中文 Hg", { fontFamily: '"PingFang SC", sans-serif', textAlign: "center", lineHeight: 1.3 }),
    fixtureText("cjk-right", 250.3, 98.3, 200, 24, "右对齐 Right 42", { fontFamily: '"PingFang SC", sans-serif', textAlign: "right", lineHeight: 1.3 }),
    fixtureText("ranges-fill-link", 20.3, 150.3, 200, 24, linkText, { ...bound, lineHeight: 1.3,
      textRanges: { version: 1, sourceSignature: textRangesSignature(linkText), ranges: [
        { start: 6, end: 10, fill: "#b42318" }, { start: 15, end: linkText.length, fill: "#175cd3", href: "https://example.invalid/coverage" }] } }),
    fixtureText("finite-multiline", 250.3, 146.3, 200, 48, "Finite 第一行 Hg\nSecond 第二行 42", { layoutBaselineOffset: 3.5, lineHeight: 1.3 }),
    fixtureNode("image-cover", "image", 20.3, 220.3, 96, 56, { imageRef: COVERAGE_IMAGE_ID, objectFit: "cover", fill: "#ffffff" }),
    fixtureNode("image-contain", "image", 140.3, 220.3, 96, 56, { imageRef: COVERAGE_IMAGE_ID, objectFit: "contain", fill: "#ffffff" }),
    fixtureNode("image-cover-rounded", "image", 260.3, 220.3, 96, 56, { imageRef: COVERAGE_IMAGE_ID, objectFit: "cover", fill: "#ffffff", cornerRadius: 8 }),
    ranged("range-cjk-missing", 20.3, 302.3, 200, 24, cjk, [{ start: 6, end: 8, fill: "#b42318" }, { start: 15, end: cjk.length, fill: "#175cd3" }]),
    ranged("range-typography", 250.3, 302.3, 200, 28, typo, [{ start: 0, end: 4, fontWeight: 700 }, { start: 5, end: 8, fontSize: 18, fill: "#175cd3" },
      { start: 9, end: 15, fontStyle: "italic" }]),
    ranged("range-underline", 20.3, 350.3, 200, 24, under, [{ start: 6, end: 10, textDecoration: "underline", fill: "#175cd3" }]),
    ranged("range-multiline", 250.3, 350.3, 200, 44, multi, [{ start: 9, end: 17, fill: "#b42318" }, { start: 23, end: multi.length, fill: "#175cd3", href: "https://example.invalid/m" }]),
    ranged("range-finite", 20.3, 398.3, 200, 24, "Finite range 范围", [{ start: 7, end: 12, fill: "#b42318" }], { layoutBaselineOffset: 3.5, fontRef: undefined, fontFamily: "Arial" }),
    ranged("node-underline-color", 250.3, 418.3, 200, 24, "Node red word", [{ start: 5, end: 8, fill: "#b42318" }], { textDecoration: "underline" }),
    ranged("underline-descender-2line", 20.3, 450.3, 200, 44, "Typing gap\nspans query", [{ start: 3, end: 17, textDecoration: "underline", fill: "#175cd3" }]),
    ranged("range-line-through", 250.3, 466.3, 200, 24, "Strike this out", [{ start: 7, end: 11, textDecoration: "line-through", fill: "#175cd3" }]),
    ranged("range-mixed-multiline", 20.3, 518.3, 200, 48, "Big first\nsmall second", [{ start: 0, end: 3, fontSize: 18, fill: "#175cd3" }]),
    ranged("range-finite-typo", 250.3, 518.3, 200, 28, "Finite bold run", [{ start: 7, end: 11, fontWeight: 700 }], { layoutBaselineOffset: 3.5 }),
    fixtureText("finite-source-plain", 20.3, 586.3, 200, 24, "Source finite Hg", { layoutBaselineOffset: 3.5, layoutBaselineSource: "html", lineHeight: 1.2 }),
    ranged("node-underline-mixed", 250.3, 582.3, 200, 32, "Node Big under", [{ start: 5, end: 8, fontSize: 18, fill: "#175cd3" }], { textDecoration: "underline" }),
    ranged("arial-underline", 20.3, 630.3, 200, 24, "Arial under line", [{ start: 6, end: 11, textDecoration: "underline", fill: "#175cd3" }], { fontRef: undefined, fontFamily: "Arial" }),
  ];
  const raw = fixtureDocument("Host fidelity coverage", children, { width: 470, height: 680, background: "#ffffff" });
  raw.resources = [font.descriptor, image.descriptor, italic.descriptor];
  const entry = canonical(FIDELITY_FIXTURE_PATHS.coverage, "high-risk coverage: default vs bundled Inter, CJK center/right, ranges, finite multiline, PNG cover/contain, editor overlay", raw);
  entry.files.push(...[...font.parts, ...image.parts, ...italic.parts].map(part => fixtureFile(part.path, part.content)));
  entry.resources = [font.descriptor, image.descriptor, italic.descriptor];
  return entry;
}
// Mirrors text-ranges.mjs textRangeSourceSignature; the codec's normalisation rejects any mismatch.
function textRangesSignature(text) { return JSON.stringify([text]); }

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
/**
 * Focus samples for the rotation-strips fixture. Each region (world x, y, width, height)
 * lies inside its top-level frame and below the frame-label band that the app draws on
 * its overlay canvas at zoom >= 0.65 (canvas-interaction.mjs: label at node.y - 18/zoom,
 * hit box node.y - 30/zoom). Anchors are the frame centres used for anchored zoom.
 */
export const VISUAL_SAMPLES = Object.freeze([
  { id: "chevron", frameId: "chevron-group", region: [42, 42, 28, 28], anchor: [56, 56], nodes: ["chevron-upper", "chevron-lower"] },
  { id: "prompt-strokes", frameId: "prompt-glyph-group", region: [99, 44, 18, 24], anchor: [108, 56], nodes: ["prompt-glyph-stroke-a", "prompt-glyph-stroke-b"] },
  { id: "prompt-text", frameId: "prompt-glyph-group", region: [117, 44, 26, 24], anchor: [130, 56], nodes: ["prompt-glyph"] },
  { id: "button-text", frameId: "button-frame", region: [172, 44, 112, 24], anchor: [228, 56], nodes: ["button-label"] },
  { id: "finite-text", frameId: "finite-sample", region: [318, 44, 190, 24], anchor: [413, 56], nodes: ["finite-sample-text"] },
].map(sample => Object.freeze(sample)));
const FRAME_LABEL_MIN_ZOOM = 0.65;
/** Conservative world-space bands of the app's canvas-drawn frame labels (not DOM). */
export function frameLabelBands(nodes, zoom) {
  if (!(zoom >= FRAME_LABEL_MIN_ZOOM)) return [];
  return nodes.filter(node => !node.parentId && ["frame", "component", "group"].includes(node.type) && node.visible !== false)
    .map(node => ({ id: node.id, x: node.x, y: node.y - 30 / zoom, width: Math.max(node.width, 200 / zoom), height: 30 / zoom }));
}
/** Device crop of one sample region; ineligible when clipped, covered by a DOM overlay or by a frame-label band. */
export function sampleRegionCrop({ camera, region, capture, overlays = [], labelBands = [] }) {
  const { zoom, panX, panY, dpr } = camera;
  const [x, y, width, height] = region;
  const x0 = (zoom * x + panX) * dpr, y0 = (zoom * y + panY) * dpr, x1 = (zoom * (x + width) + panX) * dpr, y1 = (zoom * (y + height) + panY) * dpr;
  const left = Math.floor(x0), top = Math.floor(y0), right = Math.ceil(x1), bottom = Math.ceil(y1);
  const clipped = left < 0 || top < 0 || right > capture.width || bottom > capture.height;
  const touches = (ax, ay, aw, ah) => ax < right && ax + aw > left && ay < bottom && ay + ah > top;
  const covered = [
    ...overlays.filter(o => touches(o.x * dpr, o.y * dpr, o.width * dpr, o.height * dpr)).map(o => o.name),
    ...labelBands.filter(b => touches((zoom * b.x + panX) * dpr, (zoom * b.y + panY) * dpr, b.width * zoom * dpr, b.height * zoom * dpr)).map(b => `frame-label:${b.id}`),
  ];
  return { x: left, y: top, width: right - left, height: bottom - top, clipped, comparisonEligible: !clipped && covered.length === 0,
    overlays: covered, transform: { deviceScale: zoom * dpr, originX: x0, originY: y0 } };
}

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
  // run3: the Node-rendered HTML lacked the browser-measured finite paint offset.
  if (captures.some(capture => capture.route === "html") && group?.reference?.source !== "guest")
    reasons.push(`HTML reference was not generated in the browser guest (${group?.reference?.source ?? "unknown"})`);
  const crop = captures[0]?.pageCrop;
  for (const capture of captures) {
    const value = capture.pageCrop;
    if (!value || ![value.x, value.y, value.width, value.height].every(finite)) reasons.push(`${capture.route}: no page crop`);
    else {
      if (value.clipped) reasons.push(`${capture.route}: page crop clipped by the capture`);
      else if (value.comparisonEligible !== true) reasons.push(`${capture.route}: page crop overlaps app overlays ${JSON.stringify(value.overlays ?? [])}`);
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
    { id: "coverage-matrix", fixture: P.coverage, fixtures: [P.coverage],
      steps: ["open the coverage document (bundled-Inter font + PNG codec resources)", "record document.fonts and Canvas metrics for the default Inter stack and loaded faces",
        "GPU and browser captures at ~100% and fit, each moved to a .3 fractional pan", "per-case regionInk GPU vs browser (strict: centroid 0.15 device px, ink 3%)",
        "inline editor overlay ink vs canvas ink for editable text; real edit, commit, save, reopen"],
      observables: ["capturePage PNG + sha256", "#stage transform", "#inline-text-editor rect/style", "installed codec read of disk after save"],
      knownGaps: ["the textarea caret is not observable as geometry; overlay alignment is measured as rendered ink", "the page's raster backend is not observable"] },
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
export const ARTIFACT_LABEL = /^[a-z0-9][a-z0-9-]{0,80}$/u;
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

/**
 * Probe-only Chromium switches for the owned Electron. They are appended synchronously after the
 * bootstrap's static imports, before its first top-level await (ESM `ready` can fire during an
 * await), and `app.isReady()` at append time is recorded so a late switch is reported, not assumed.
 */
const PROBE_SWITCH_ANCHOR = 'import { syncBuiltinESMExports } from "node:module";\n';
export function designStudioProbeSwitches({ forceDeviceScaleFactor = null, disableGpuRasterization = false } = {}) {
  const switches = [];
  if (forceDeviceScaleFactor) switches.push(["force-device-scale-factor", String(forceDeviceScaleFactor)]);
  if (disableGpuRasterization) switches.push(["disable-gpu-rasterization"]);
  return switches;
}
export function insertProbeSwitches(bootstrap, switches) {
  if (!switches.length) return bootstrap;
  if (bootstrap.split(PROBE_SWITCH_ANCHOR).length !== 2) throw new Error("Host fixture import seam changed; probe switches not applied");
  const head = bootstrap.slice(0, bootstrap.indexOf(PROBE_SWITCH_ANCHOR) + PROBE_SWITCH_ANCHOR.length);
  if (/\bawait\b/u.test(head)) throw new Error("a top-level await precedes the probe switch seam");
  const code = `globalThis.__designStudioProbeSwitches = { readyAtAppend: app.isReady(), appended: ${JSON.stringify(switches)} };\n` +
    switches.map(([name, value]) => value === undefined ? `app.commandLine.appendSwitch(${JSON.stringify(name)});\n`
      : `app.commandLine.appendSwitch(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`).join("") +
    `globalThis.__designStudioProbeSwitches.present = ${JSON.stringify(switches.map(([name]) => name))}.map(name => [name, app.commandLine.hasSwitch(name)]);\n`;
  return head + code + bootstrap.slice(head.length);
}

/**
 * Ink of one device crop for multi-colour content (text runs, images): per-pixel colour distance
 * from the crop border's dominant colour, mass-weighted centroid, and the >=24 distance bbox.
 */
export function regionInk(image, crop, { neutralOnly = false } = {}) {
  const px = (x, y) => { const o = ((crop.y + y) * image.width + crop.x + x) * 4; return [image.data[o], image.data[o + 1], image.data[o + 2]]; };
  const counts = new Map();
  for (let x = 0; x < crop.width; x++) for (const y of [0, crop.height - 1]) { const key = px(x, y).join(); counts.set(key, (counts.get(key) ?? 0) + 1); }
  for (let y = 0; y < crop.height; y++) for (const x of [0, crop.width - 1]) { const key = px(x, y).join(); counts.set(key, (counts.get(key) ?? 0) + 1); }
  const background = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  let mass = 0, sx = 0, sy = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    const [r, g, b] = px(x, y);
    // neutralOnly: glyphs of a neutral text fill; coloured app chrome (selection frame, handles) is not ink.
    if (neutralOnly && Math.max(r, g, b) - Math.min(r, g, b) > 24) continue;
    const distance = Math.hypot(r - background[0], g - background[1], b - background[2]);
    mass += distance; sx += distance * (x + 0.5); sy += distance * (y + 0.5);
    if (distance >= 24) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1); }
  }
  return { background, mass, centroid: mass ? [sx / mass, sy / mass] : null, bbox: maxX >= 0 ? [minX, minY, maxX, maxY] : null };
}
/** Strict GPU-vs-HTML contract for a coverage region (device px): centroid <= 0.15 and ink within ±3%; bbox recorded. */
export const COVERAGE_THRESHOLDS = Object.freeze({ centroidDevicePx: 0.15, inkBias: 0.03 });
export function compareCoverageRegion(reference, candidate) {
  if (!reference?.centroid || !candidate?.centroid) return { status: FIDELITY_STATUS.UNVERIFIED, reasons: ["no ink in one route"] };
  const delta = [candidate.centroid[0] - reference.centroid[0], candidate.centroid[1] - reference.centroid[1]];
  const centroid = Math.hypot(...delta), ink = candidate.mass / reference.mass - 1;
  const bboxDelta = reference.bbox && candidate.bbox ? candidate.bbox.map((value, index) => value - reference.bbox[index]) : null;
  const reasons = [];
  if (!(centroid <= COVERAGE_THRESHOLDS.centroidDevicePx)) reasons.push(`centroid ${centroid.toFixed(3)} device px`);
  if (!(Math.abs(ink) <= COVERAGE_THRESHOLDS.inkBias)) reasons.push(`ink ${(ink * 100).toFixed(2)}%`);
  return { status: reasons.length ? FIDELITY_STATUS.FAIL : FIDELITY_STATUS.PASS, reasons, centroid, centroidDelta: delta, ink, bboxDelta };
}

/** 50% crossings of the neutral (glyph) column/row coverage profile inside a crop, in crop device px. */
export function glyphEdges(image, crop) {
  const columns = new Float64Array(crop.width), rows = new Float64Array(crop.height);
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    const o = ((crop.y + y) * image.width + crop.x + x) * 4, r = image.data[o], g = image.data[o + 1], b = image.data[o + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 24) continue;
    const a = (255 - (r + g + b) / 3) / 255; columns[x] = Math.max(columns[x], a); rows[y] = Math.max(rows[y], a);
  }
  const crossing = (profile, forward) => { let previous = 0;
    for (let step = 0; step < profile.length; step++) { const index = forward ? step : profile.length - 1 - step, value = profile[index];
      if (value >= 0.5) return forward ? index + 0.5 - (value - 0.5) / Math.max(1e-9, value - previous) : index + 0.5 + (value - 0.5) / Math.max(1e-9, value - previous);
      previous = value; }
    return null; };
  return { left: crossing(columns, true), right: crossing(columns, false), top: crossing(rows, true), bottom: crossing(rows, false) };
}

/**
 * Line-height evidence (no app change): plain multi-line divs at a .3 top phase; per line the measured layout baseline
 * (inline-block marker) and the layout scale, plus Canvas font metrics at fontSize x scale for the line-box offset.
 */
export const LINE_HEIGHT_PROBE_CASES = Object.freeze([{ size: 14, lineHeight: 1.3 }, { size: 16, lineHeight: 1.35 }].map(value => Object.freeze(value)));
export function lineHeightProbeSource() {
  return `(() => {
    const host = document.createElement("div"); host.style.cssText = "position:fixed;left:-4000px;top:0;width:600px;height:600px;visibility:hidden;contain:layout";
    document.body.append(host);
    const quantumProbe = document.createElement("div"), child = document.createElement("div");
    quantumProbe.style.cssText = "position:absolute;left:0;top:0"; child.style.cssText = "position:absolute;top:0;width:1px;height:1px;left:" + (1.001 / (64 * devicePixelRatio)) + "px";
    quantumProbe.append(child); host.append(quantumProbe);
    const quantum = child.getBoundingClientRect().left - quantumProbe.getBoundingClientRect().left, scale = quantum > 0 ? Math.round(1 / (64 * quantum) * 1000) / 1000 : 1;
    const ctx = document.createElement("canvas").getContext("2d"), cases = ${JSON.stringify(LINE_HEIGHT_PROBE_CASES)};
    const out = cases.map(({ size, lineHeight }) => {
      const div = document.createElement("div"); div.style.cssText = "position:absolute;left:10px;top:20.3px;white-space:pre;font:" + size + "px/" + lineHeight + " Arial";
      const lines = ["Hg one", "Hg two", "Hg three", "Hg four", "Hg five", "Hg six"];
      div.innerHTML = lines.map(text => '<span class="m" style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>' + text).join("\\n");
      host.append(div);
      const origin = host.getBoundingClientRect().top, baselines = [...div.querySelectorAll(".m")].map(marker => marker.getBoundingClientRect().top - origin);
      div.remove();
      ctx.font = size * scale + "px Arial"; const metrics = ctx.measureText("Hg");
      return { size, lineHeight, top: 20.3, baselines, layoutMetrics: { ascent: metrics.fontBoundingBoxAscent, descent: metrics.fontBoundingBoxDescent } };
    });
    host.remove();
    return { devicePixelRatio, quantum, scale, cases: out };
  })()`;
}
/** Per line: measured layout baseline vs the current (round) and Blink (trunc) LayoutUnit line-height predictions. */
export function lineHeightEvidenceTable(probe) {
  const rows = [];
  for (const item of probe.cases) {
    const s = probe.scale, h = item.size * item.lineHeight, top = Math.trunc(item.top * 64 * s) / 64;
    const alpha = Math.floor((h * s + Math.round(item.layoutMetrics.ascent) - Math.round(item.layoutMetrics.descent)) / 2);
    item.baselines.forEach((measured, index) => {
      const round = top + index * (Math.round(h * s * 64) / 64) + alpha, trunc = top + index * (Math.trunc(h * s * 64) / 64) + alpha;
      rows.push({ size: item.size, lineHeight: item.lineHeight, scale: s, line: index, measuredLayout: measured,
        roundLayout: round / s, truncLayout: trunc / s, roundPaint: Math.round(round) / s, truncPaint: Math.round(trunc) / s,
        paintDiffers: Math.round(round) !== Math.round(trunc), measuredMatches: Math.abs(measured - trunc / s) < 1e-3 ? "trunc" : Math.abs(measured - round / s) < 1e-3 ? "round" : "neither" });
    });
  }
  return rows;
}
