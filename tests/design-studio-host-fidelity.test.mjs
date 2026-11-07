// Offline unit tests for the Design Studio real-Host fidelity harness.
// Nothing here launches Electron, Chromium, a Host build or a Panel install.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DESIGN_STUDIO_FIDELITY_FLAG,
  REQUIRED_HOST_FILES,
  FIDELITY_HOST_FILES,
  parsePanelDesktopArguments,
  preflightPanelDesktopHost,
  copyDesignStudioSample,
  isAllowedFidelityRequest,
} from "../scripts/design-studio-host-fidelity.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const studioModules = async () => ({
  codec: await import("../apps/design-studio/app/document.mjs"),
  textMetrics: await import("../apps/design-studio/app/text-metrics.mjs"),
  documentIndex: await import("../apps/design-studio/app/document-index.mjs"),
});
async function loadFixtures() {
  const { buildDesignStudioFidelityFixtures } = await import("../scripts/design-studio-host-fidelity.mjs");
  return buildDesignStudioFidelityFixtures(await studioModules());
}
async function scratch(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  assert.ok(!directory.startsWith(repository), "unit scratch must stay outside the repository");
  return directory;
}

test("default desktop arguments keep the existing gate and never enable fidelity", () => {
  const parsed = parsePanelDesktopArguments(["/host", "/tmp/report.json", "--app", "quant-lab"]);
  assert.deepEqual(parsed, { hostArgument: "/host", reportArgument: "/tmp/report.json", selectedApp: "quant-lab",
    designStudioFidelity: null });
  assert.equal(parsePanelDesktopArguments(["/host"]).designStudioFidelity, null);
});

test("environment variables cannot opt in or stand for user approval", () => {
  const environment = { DESIGN_STUDIO_FIDELITY: "1", CODESHELL_DESIGN_STUDIO_FIDELITY: "approved",
    DESIGN_STUDIO_FIDELITY_APPROVED: "true", USER_APPROVED_HOST_WINDOW: "yes" };
  const parsed = parsePanelDesktopArguments(["/host", "/tmp/report.json"], environment);
  assert.equal(parsed.designStudioFidelity, null);
  assert.equal(parsed.selectedApp, undefined);
});

test("fidelity opt-in requires a built Host and refuses any user-chosen report path (outputs are harness-owned)", () => {
  assert.throws(() => parsePanelDesktopArguments([DESIGN_STUDIO_FIDELITY_FLAG]), /built Host/);
  assert.throws(() => parsePanelDesktopArguments(["/host", "/tmp/new-report.json", DESIGN_STUDIO_FIDELITY_FLAG]), /report path/);
  assert.equal(parsePanelDesktopArguments(["/host", "/tmp/new-report.json"]).reportArgument, "/tmp/new-report.json", "the existing desktop gate keeps its report path");
  const parsed = parsePanelDesktopArguments(["/host", DESIGN_STUDIO_FIDELITY_FLAG]);
  assert.equal(parsed.selectedApp, "design-studio", "fidelity runs only the Design Studio package case");
  assert.deepEqual(parsed.designStudioFidelity, { samplePath: null });
});

test("fidelity opt-in rejects other Panels and stray sample flags", () => {
  assert.throws(() => parsePanelDesktopArguments(["/host", DESIGN_STUDIO_FIDELITY_FLAG, "--app", "quant-lab"]), /design-studio/);
  assert.throws(() => parsePanelDesktopArguments(["/host", "/tmp/r.json", "--design-studio-sample", "/tmp/a.codesign.json"]), /requires --design-studio-fidelity/);
  assert.throws(() => parsePanelDesktopArguments(["/host", DESIGN_STUDIO_FIDELITY_FLAG, "--design-studio-sample"]), /sample path/);
  assert.throws(() => parsePanelDesktopArguments(["/host", "/tmp/r.json", "--unknown"]), /unexpected argument/);
  const parsed = parsePanelDesktopArguments(["/host", DESIGN_STUDIO_FIDELITY_FLAG, "--app", "design-studio",
    "--design-studio-sample", "/tmp/sample.codesign.json"]);
  assert.deepEqual(parsed.designStudioFidelity, { samplePath: "/tmp/sample.codesign.json" });
});

async function fakeHost(host, paths, { electron = true } = {}) {
  for (const path of paths) {
    await mkdir(join(host, dirname(path)), { recursive: true });
    await writeFile(join(host, path), path.endsWith(".json") ? '{"version":"0.0.0-fixture"}' : "built");
  }
  if (electron) {
    await mkdir(join(host, "packages/desktop/node_modules/electron/dist"), { recursive: true });
    await writeFile(join(host, "packages/desktop/node_modules/electron/package.json"), '{"name":"electron","version":"0.0.0-fixture"}');
  }
}

test("preflight reports every missing built Host file without building or downloading", async () => {
  const host = await scratch("ds-fidelity-host-");
  try {
    await fakeHost(host, REQUIRED_HOST_FILES.filter(path => !path.includes("managed-runtimes")));
    const before = await stat(host);
    const missingRuntime = await preflightPanelDesktopHost(host, { fidelity: false });
    assert.equal(missingRuntime.ok, false);
    assert.deepEqual(missingRuntime.missing, ["packages/desktop/out/managed-runtimes/node/bin/node"]);
    assert.deepEqual(missingRuntime.actionsTaken, [], "preflight must never install, download or build");
    assert.match(missingRuntime.message, /managed-runtimes\/node\/bin\/node/);
    assert.match(missingRuntime.message, /not built|missing/i);
    const fidelity = await preflightPanelDesktopHost(host, { fidelity: true });
    for (const path of FIDELITY_HOST_FILES.filter(path => !REQUIRED_HOST_FILES.includes(path)))
      assert.ok(fidelity.missing.includes(path) || fidelity.present.includes(path));
    assert.equal((await stat(host)).mtimeMs, before.mtimeMs, "preflight wrote into the Host checkout");
    const nothing = await preflightPanelDesktopHost(join(host, "absent"), { fidelity: true });
    assert.equal(nothing.ok, false);
    assert.ok(nothing.missing.length >= FIDELITY_HOST_FILES.length);
  } finally { await rm(host, { recursive: true, force: true }); }
});

test("preflight passes only when every required file is present and records staleness evidence", async () => {
  const host = await scratch("ds-fidelity-host-ok-");
  try {
    await fakeHost(host, FIDELITY_HOST_FILES);
    const result = await preflightPanelDesktopHost(host, { fidelity: true });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.missing, []);
    for (const path of FIDELITY_HOST_FILES) assert.equal(typeof result.mtimes[path], "number");
    assert.ok(Array.isArray(result.warnings));
    assert.equal(result.electron.version, "0.0.0-fixture");
    await rm(join(host, "packages/desktop/node_modules/electron/dist"), { recursive: true });
    const noBinary = await preflightPanelDesktopHost(host, { fidelity: true });
    assert.equal(noBinary.ok, false);
    assert.match(noBinary.missing.join(), /Electron binary not installed/);
  } finally { await rm(host, { recursive: true, force: true }); }
});

test("an explicit sample is hashed, copied into the temporary project and never modified", async () => {
  const directory = await scratch("ds-fidelity-sample-");
  try {
    const sample = join(directory, "personal.codesign.json"), project = join(directory, "project");
    await writeFile(sample, '{"version":1}\n');
    await chmod(sample, 0o444);
    const before = await stat(sample);
    const receipt = await copyDesignStudioSample({ samplePath: sample, projectDirectory: project });
    assert.equal(receipt.sourceSha256Before, sha256('{"version":1}\n'));
    assert.equal(receipt.sourceSha256After, receipt.sourceSha256Before);
    assert.equal(receipt.copySha256, receipt.sourceSha256Before);
    assert.equal(receipt.relativePath, "designs/host-fidelity-sample.codesign.json");
    assert.equal(await readFile(join(project, receipt.relativePath), "utf8"), '{"version":1}\n');
    assert.equal((await stat(sample)).mtimeMs, before.mtimeMs);
    assert.equal((await stat(sample)).mode & 0o777, 0o444);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("sample copy fails when the original changes during the copy or is inside the project", async () => {
  const directory = await scratch("ds-fidelity-sample-change-");
  try {
    const sample = join(directory, "personal.codesign.json"), project = join(directory, "project");
    await writeFile(sample, '{"a":1}');
    await assert.rejects(copyDesignStudioSample({ samplePath: sample, projectDirectory: project,
      afterCopy: () => writeFile(sample, '{"a":2}') }), /sample changed/);
    await mkdir(project, { recursive: true });
    const inside = join(project, "x.codesign.json");
    await writeFile(inside, "{}");
    await assert.rejects(copyDesignStudioSample({ samplePath: inside, projectDirectory: project }), /outside the temporary project/);
    await assert.rejects(copyDesignStudioSample({ samplePath: "relative.codesign.json", projectDirectory: project }), /absolute/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("external network is denied for every reference/capture request", () => {
  for (const url of ["http://127.0.0.1:9/x", "https://example.com/a.woff2", "ws://localhost/x", "wss://a.b", "ftp://a/b",
    "HTTPS://EXAMPLE.COM", "//example.com/a.png", "http:/relative-bypass"])
    assert.equal(isAllowedFidelityRequest(url), false, url);
  for (const url of ["data:text/html,<p>x</p>", "blob:cspanel://x/1", "about:blank", "cspanel://design-studio/index.html"])
    assert.equal(isAllowedFidelityRequest(url), true, url);
  assert.equal(isAllowedFidelityRequest("file:///etc/passwd"), false, "reference windows have no file access");
  assert.equal(isAllowedFidelityRequest(""), false);
  assert.equal(isAllowedFidelityRequest(undefined), false);
});

test("the default offline catalog never launches Electron or the fidelity entry", async () => {
  const { suites } = await import("../tests/suites.mjs");
  const argv = suites.flatMap(suite => suite.commands.flat());
  for (const value of argv) {
    assert.doesNotMatch(value, /check-panel-desktop\.mjs|--design-studio-fidelity/);
  }
  const packageJson = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  for (const [name, command] of Object.entries(packageJson.scripts)) {
    if (name === "test:desktop") continue;
    assert.doesNotMatch(command, /check-panel-desktop|design-studio-fidelity/, name);
  }
  assert.ok(argv.includes("tests/design-studio-host-fidelity.test.mjs"), "these unit tests are part of the offline gate");
});

test("the fidelity module is side-effect free and does not import Electron or Playwright", async () => {
  const source = await readFile(join(repository, "scripts/design-studio-host-fidelity.mjs"), "utf8");
  assert.doesNotMatch(source, /from\s+["'](?:playwright|electron)["']|import\(["'](?:playwright|electron)["']\)/);
  assert.doesNotMatch(source, /node:child_process/);
  assert.doesNotMatch(source, /^(?:await|process\.argv)/m, "no top-level execution");
});

test("synthetic fixtures are canonical codec documents covering the real-Host risk surfaces", async () => {
  const { FIDELITY_FIXTURE_PATHS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const { codec, textMetrics: metrics } = await studioModules();
  const fixtures = await loadFixtures();
  assert.deepEqual(fixtures.map(value => value.relativePath).sort(), Object.values(FIDELITY_FIXTURE_PATHS).sort());
  for (const fixture of fixtures) {
    assert.match(fixture.relativePath, /^designs\/host-fidelity-[a-z0-9-]+\.codesign\.json$/);
    assert.equal(codec.serializeDesignDocument(codec.normalizeDesignDocument(JSON.parse(fixture.logicalSource))), fixture.logicalSource,
      `${fixture.relativePath} logical document is not canonical codec output`);
    assert.equal(fixture.sha256, sha256(fixture.bytes));
    assert.equal(fixture.files[0].relativePath, fixture.relativePath);
    assert.equal(fixture.files[0].bytes, fixture.bytes);
    if (fixture.storage === "single") assert.equal(fixture.bytes, fixture.logicalSource);
  }
  const byPath = new Map(fixtures.map(value => [value.relativePath, codec.normalizeDesignDocument(JSON.parse(value.logicalSource))]));
  const nodes = document => document.pages.flatMap(page => page.nodes ?? []);
  const flat = path => {
    const document = byPath.get(path);
    const result = [];
    const visit = node => { result.push(node); for (const child of node.children ?? []) visit(child); };
    for (const page of JSON.parse(fixtures.find(value => value.relativePath === path).logicalSource).pages) page.children.forEach(visit);
    return { document, nodes: result.length ? result : nodes(document) };
  };

  const legacy = flat(FIDELITY_FIXTURE_PATHS.legacyReceipts).nodes.filter(node => node.type === "text");
  const stale = legacy.filter(node => node.textMetrics && metrics.currentTextMetrics(node) === null);
  const valid = legacy.filter(node => node.textMetrics && metrics.currentTextMetrics(node) !== null);
  assert.ok(stale.length >= 2, "legacy hanging receipts without the line-box-v1 marker must be present and stale");
  assert.ok(stale.some(node => /[一-鿿]/u.test(node.text)) && stale.some(node => /^[\x20-\x7e\n]+$/u.test(node.text)));
  assert.ok(valid.some(node => Number.isFinite(node.layoutBaselineOffset) && node.layoutBaselineOffset !== 0));
  assert.ok(valid.some(node => node.layoutBaselineOffset === 0));
  assert.ok(legacy.some(node => node.textFlow === "wrap" && node.textFlowWidth > 0));
  assert.ok(legacy.some(node => node.layoutSizingHorizontal === "hug"));
  assert.ok(legacy.some(node => !Number.isFinite(node.layoutBaselineOffset)), "line-box (no offset) nodes are present");

  const rotation = flat(FIDELITY_FIXTURE_PATHS.rotationStrips).nodes;
  const strips = rotation.filter(node => node.rotation && node.rotation % 90 !== 0 && Math.min(node.width, node.height) < 2);
  assert.ok(strips.length >= 4);
  assert.ok(strips.every(node => node.cornerRadius > 0 && /^#[0-9a-f]{6}$/u.test(node.fill)));
  for (const id of ["chevron", "prompt-glyph", "button-label"]) assert.ok(rotation.some(node => node.id.includes(id)), id);
  assert.ok(rotation.some(node => node.type === "text" && node.text === ">_"));

  const svg = flat(FIDELITY_FIXTURE_PATHS.svgCornerAa).nodes;
  const probes = svg.filter(node => node.id.startsWith("svg-corner-"));
  assert.equal(probes.length, 4, "one synthetic equivalent for each of the four SVG FAIL rows");
  assert.deepEqual(probes.map(node => [node.width, node.height, node.fill, node.cornerRadius]).sort(),
    [[1.26, 7.2, "#686e67", 0], [1.26, 7.2, "#686e67", 0], [7.2, 1.17, "#686e67", 0], [7.2, 1.17, "#686e67", 0]]);

  const large = flat(FIDELITY_FIXTURE_PATHS.largeText).nodes.filter(node => node.type === "text");
  assert.ok(large.length >= 1000, `large text fixture has ${large.length} text nodes`);
  assert.ok(large.some(node => /[一-鿿]/u.test(node.text)) && large.some(node => /[A-Za-z]/u.test(node.text)));
  assert.ok(large.some(node => !Number.isInteger(node.x) || !Number.isInteger(node.y)), "fractional phases are present");

  const interaction = flat(FIDELITY_FIXTURE_PATHS.interaction).nodes;
  assert.ok(interaction.some(node => node.id === "move-target") && interaction.some(node => node.id === "edit-target" && node.type === "text"));
});

const hex = character => character.repeat(64);
const fileState = (character, mtimeMs = 1000, size = 10) => ({ sha256: hex(character), mtimeMs, size });

test("open-without-edit passes only from bytes, mtime and repeated dirty observations over >=2s", async () => {
  const { judgeOpenWithoutEdit, FIDELITY_STATUS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const good = { path: "designs/a.codesign.json", waitedMs: 2100, before: fileState("a"), after: fileState("a"),
    saveStates: [{ atMs: 0, kind: "idle", text: "" }, { atMs: 1000, kind: "idle", text: "" }, { atMs: 2100, kind: "idle", text: "" }] };
  assert.equal(judgeOpenWithoutEdit(good).status, FIDELITY_STATUS.PASS);
  assert.equal(judgeOpenWithoutEdit({ ...good, after: fileState("b") }).status, FIDELITY_STATUS.FAIL);
  assert.equal(judgeOpenWithoutEdit({ ...good, after: fileState("a", 2000) }).status, FIDELITY_STATUS.FAIL);
  assert.equal(judgeOpenWithoutEdit({ ...good, saveStates: [...good.saveStates, { atMs: 2100, kind: "dirty", text: "有修改" }] }).status, FIDELITY_STATUS.FAIL);
  assert.equal(judgeOpenWithoutEdit({ ...good, saveStates: [...good.saveStates, { atMs: 1500, kind: "idle", text: "正在自动保存…" }] }).status, FIDELITY_STATUS.FAIL);
  const short = judgeOpenWithoutEdit({ ...good, waitedMs: 1999 });
  assert.equal(short.status, FIDELITY_STATUS.UNVERIFIED);
  assert.match(short.reasons.join(), /2000/);
  for (const broken of [{ ...good, after: undefined }, { ...good, saveStates: [] }, { ...good, before: { sha256: "x", mtimeMs: 1, size: 1 } },
    { unchanged: true }, { ...good, saveStates: [{ atMs: 0, kind: undefined }, { atMs: 2100, kind: "idle" }] }])
    assert.equal(judgeOpenWithoutEdit(broken).status, FIDELITY_STATUS.UNVERIFIED, JSON.stringify(broken));
});

test("immediate click after move/edit requires actual DOM selection at the new and old geometry", async () => {
  const { judgeImmediateClick, FIDELITY_STATUS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const good = { operation: "drag", targetId: "move-target", geometryBefore: { x: 120, y: 140 }, geometryAfter: { x: 380, y: 140 },
    preEdit: { selectedIds: ["move-target"], geometry: { x: 120, y: 140 } },
    clicks: [
      { label: "new-position", elapsedSinceCommitMs: 12, expectedSelectedIds: ["move-target"], actualSelectedIds: ["move-target"] },
      { label: "old-position", elapsedSinceCommitMs: 30, expectedSelectedIds: [], actualSelectedIds: [] },
    ] };
  assert.equal(judgeImmediateClick(good).status, FIDELITY_STATUS.PASS);
  const stale = structuredClone(good); stale.clicks[0].actualSelectedIds = ["underlay"];
  assert.equal(judgeImmediateClick(stale).status, FIDELITY_STATUS.FAIL);
  const ghost = structuredClone(good); ghost.clicks[1].actualSelectedIds = ["move-target"];
  assert.equal(judgeImmediateClick(ghost).status, FIDELITY_STATUS.FAIL);
  const late = structuredClone(good); late.clicks[0].elapsedSinceCommitMs = 900;
  assert.equal(judgeImmediateClick(late).status, FIDELITY_STATUS.UNVERIFIED, "a late click does not test the async window");
  const unmoved = { ...structuredClone(good), geometryAfter: { x: 120, y: 140 } };
  assert.equal(judgeImmediateClick(unmoved).status, FIDELITY_STATUS.UNVERIFIED);
  const engineOnly = structuredClone(good); delete engineOnly.clicks[0].actualSelectedIds; engineOnly.clicks[0].hitTestId = "move-target";
  assert.equal(judgeImmediateClick(engineOnly).status, FIDELITY_STATUS.UNVERIFIED, "engine geometry is not UI selection evidence");
  assert.equal(judgeImmediateClick({ ...good, clicks: good.clicks.slice(0, 1) }).status, FIDELITY_STATUS.UNVERIFIED);
  assert.equal(judgeImmediateClick({ selected: true }).status, FIDELITY_STATUS.UNVERIFIED);
  const wrongTarget = { ...structuredClone(good), preEdit: { selectedIds: ["underlay"], geometry: { x: 400, y: 140 } } };
  assert.equal(judgeImmediateClick(wrongTarget).status, FIDELITY_STATUS.UNVERIFIED, "the edit was applied to an unverified selection");
  const { preEdit: _omitted, ...noPreEdit } = structuredClone(good);
  assert.equal(judgeImmediateClick(noPreEdit).status, FIDELITY_STATUS.UNVERIFIED);
  const offPlan = { ...structuredClone(good), geometryAfter: { x: 300, y: 140 } };
  assert.equal(judgeImmediateClick(offPlan).status, FIDELITY_STATUS.UNVERIFIED, "geometry outside the planned tolerance invalidates the click oracle");
});

test("low-zoom performance separates renderer counters from frame timing and never auto-passes", async () => {
  const { judgeLowZoomPerformance, FIDELITY_STATUS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const base = { textNodeCount: 1200, camera: { zoom: 0.3711, panX: -103.375, panY: 41.625, dpr: 2 },
    frames: { count: 60, intervalsMs: Array(60).fill(16.7), p50Ms: 16.7, p95Ms: 18, maxMs: 20 },
    cpu: { scriptDurationMs: 120, taskDurationMs: 400, layoutDurationMs: 3 }, renderer: null };
  const missing = judgeLowZoomPerformance(base);
  assert.equal(missing.status, FIDELITY_STATUS.UNVERIFIED);
  assert.match(missing.reasons.join(), /device sampling|tile/i);
  assert.deepEqual(missing.evidence.frames, base.frames, "real frame timing stays recorded separately");
  const counters = { deviceTextSamplingBuilds: 4, deviceSamplingMisses: 1, tileBypassFrames: 3, cpuPrepMs: 8 };
  assert.equal(judgeLowZoomPerformance({ ...base, renderer: counters }).status, FIDELITY_STATUS.EVIDENCE_ONLY);
  assert.equal(judgeLowZoomPerformance({ ...base, renderer: counters, textNodeCount: 999 }).status, FIDELITY_STATUS.UNVERIFIED);
  assert.equal(judgeLowZoomPerformance({ ...base, renderer: counters, camera: { ...base.camera, zoom: 1 } }).status, FIDELITY_STATUS.UNVERIFIED);
  assert.equal(judgeLowZoomPerformance({ ...base, renderer: counters, camera: { ...base.camera, panX: -103, panY: 41 } }).status, FIDELITY_STATUS.UNVERIFIED);
  assert.equal(judgeLowZoomPerformance({ ...base, renderer: counters, frames: { count: 0, intervalsMs: [] } }).status, FIDELITY_STATUS.UNVERIFIED);
});

test("save/reopen requires verified edits, a saved disk with the expected nodes, the same DOM after reload and a stable second save", async () => {
  const { judgeSaveReopen, expectedStateAfterEdits, FIDELITY_STATUS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const expected = expectedStateAfterEdits();
  assert.deepEqual(expected.map(node => node.id).sort(), ["edit-target", "move-target"]);
  const baseline = [{ id: "underlay", x: 400, y: 140 }, { id: "move-target", x: 120, y: 140 }, { id: "edit-target", x: 120, y: 320, text: "Edit me HMI" }];
  const final = baseline.map(node => ({ ...node, ...(expected.find(value => value.id === node.id) ?? {}) }));
  const good = { path: "designs/a.codesign.json", editsVerified: { operations: ["drag", "inspector-x", "text-edit"], statuses: ["PASS", "PASS", "PASS"] },
    pathBeforeSave: "designs/a.codesign.json", expected, baselineNodes: baseline,
    firstSave: { kind: "saved", file: fileState("a", 5) }, diskNodesAfterFirstSave: final,
    domAfterReload: expected.map(node => ({ ...node })), layerIdsBefore: ["underlay", "move-target", "edit-target"],
    layerIdsAfterReopen: ["underlay", "move-target", "edit-target"],
    reopenSaveStates: [{ atMs: 0, kind: "idle", text: "" }, { atMs: 1000, kind: "saved", text: "已保存" }, { atMs: 2200, kind: "saved", text: "已保存" }],
    reopenWaitedMs: 2200, reopenedBeforeSecondSave: fileState("a", 5),
    secondSave: { kind: "saved", file: fileState("a", 9) }, canonicalSha256: hex("a") };
  assert.equal(judgeSaveReopen(good).status, FIDELITY_STATUS.PASS);
  // Real negative controls
  assert.equal(judgeSaveReopen({ ...good, firstSave: { kind: "error", file: fileState("a", 5) } }).status, FIDELITY_STATUS.FAIL, "save failure");
  assert.equal(judgeSaveReopen({ ...good, diskNodesAfterFirstSave: baseline }).status, FIDELITY_STATUS.FAIL, "disk still holds the old unsaved draft");
  const otherEdited = final.map(node => node.id === "underlay" ? { ...node, x: 200 } : node);
  assert.equal(judgeSaveReopen({ ...good, diskNodesAfterFirstSave: otherEdited }).status, FIDELITY_STATUS.FAIL, "a non-target node was edited");
  assert.equal(judgeSaveReopen({ ...good, secondSave: { kind: "error", file: fileState("a", 9) } }).status, FIDELITY_STATUS.FAIL, "second save error");
  assert.equal(judgeSaveReopen({ ...good, secondSave: { kind: "saved", file: fileState("b", 9) } }).status, FIDELITY_STATUS.FAIL, "second save changed bytes");
  assert.equal(judgeSaveReopen({ ...good, domAfterReload: expected.map(node => node.id === "edit-target" ? { ...node, text: "Edit me HMI" } : node) }).status,
    FIDELITY_STATUS.FAIL, "reloaded DOM shows other text");
  assert.equal(judgeSaveReopen({ ...good, canonicalSha256: hex("c") }).status, FIDELITY_STATUS.FAIL);
  // Reload must not write: Codex's in-memory counterexample (dirty → autosave → saved, same SHA, new mtime).
  assert.equal(judgeSaveReopen({ ...good, reopenedBeforeSecondSave: fileState("a", 7) }).status, FIDELITY_STATUS.FAIL, "same sha, changed mtime");
  assert.equal(judgeSaveReopen({ ...good, reopenedBeforeSecondSave: fileState("b", 5) }).status, FIDELITY_STATUS.FAIL, "reload rewrote bytes");
  assert.equal(judgeSaveReopen({ ...good, reopenSaveStates: [good.reopenSaveStates[0], { atMs: 400, kind: "dirty", text: "有修改" }, ...good.reopenSaveStates.slice(1)] }).status,
    FIDELITY_STATUS.FAIL, "transient dirty in any sample");
  assert.equal(judgeSaveReopen({ ...good, reopenSaveStates: [good.reopenSaveStates[0], { atMs: 900, kind: "idle", text: "正在自动保存…" }, ...good.reopenSaveStates.slice(1)] }).status,
    FIDELITY_STATUS.FAIL, "autosave in progress before the second save");
  assert.equal(judgeSaveReopen({ ...good, reopenSaveStates: [{ atMs: 2200, kind: "saved", text: "" }] }).status, FIDELITY_STATUS.UNVERIFIED, "too few samples");
  assert.equal(judgeSaveReopen({ ...good, reopenWaitedMs: 1500 }).status, FIDELITY_STATUS.UNVERIFIED, "observation too short");
  assert.equal(judgeSaveReopen({ ...good, reopenSaveStates: [{ atMs: 0 }, { atMs: 2200, kind: "saved" }] }).status, FIDELITY_STATUS.UNVERIFIED, "sample without kind");
  assert.equal(judgeSaveReopen({ ...good, reopenedBeforeSecondSave: undefined }).status, FIDELITY_STATUS.UNVERIFIED, "no reopened snapshot");
  assert.equal(judgeSaveReopen({ ...good, reopenSaveStates: undefined }).status, FIDELITY_STATUS.UNVERIFIED, "no samples is never a pass");
  assert.equal(judgeSaveReopen({ ...good, layerIdsAfterReopen: ["move-target", "underlay", "edit-target"] }).status, FIDELITY_STATUS.FAIL);
  // Unobserved steps are never a pass
  assert.equal(judgeSaveReopen({ ...good, editsVerified: { operations: ["drag"], statuses: ["UNVERIFIED"] } }).status, FIDELITY_STATUS.UNVERIFIED);
  assert.equal(judgeSaveReopen({ ...good, editsVerified: true }).status, FIDELITY_STATUS.UNVERIFIED);
  assert.equal(judgeSaveReopen({ ...good, pathBeforeSave: "designs/other.codesign.json" }).status, FIDELITY_STATUS.UNVERIFIED);
  assert.equal(judgeSaveReopen({ ...good, domAfterReload: undefined }).status, FIDELITY_STATUS.UNVERIFIED);
  assert.equal(judgeSaveReopen({ ...good, secondSave: undefined }).status, FIDELITY_STATUS.UNVERIFIED);
  assert.equal(judgeSaveReopen({ ...good, diskNodesAfterFirstSave: final.filter(node => node.id !== "edit-target") }).status, FIDELITY_STATUS.UNVERIFIED);
  assert.equal(judgeSaveReopen({ stable: true }).status, FIDELITY_STATUS.UNVERIFIED);
});

test("same-camera visual captures are evidence for review, never an automatic pass", async () => {
  const { judgeVisualCaptureGroup, FIDELITY_STATUS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const camera = { zoom: 2, panX: 40, panY: 40, dpr: 2 };
  const capture = route => ({ route, camera, png: { sha256: hex("d"), width: 400, height: 200, distinctColors: 90 }, rect: { x: 0, y: 0, width: 200, height: 100 } });
  const group = { label: "200", captures: ["gpu", "browser", "html"].map(capture) };
  assert.equal(judgeVisualCaptureGroup(group).status, FIDELITY_STATUS.EVIDENCE_ONLY);
  const moved = structuredClone(group); moved.captures[2].camera = { ...camera, panX: 41 };
  assert.equal(judgeVisualCaptureGroup(moved).status, FIDELITY_STATUS.UNVERIFIED, "routes must share one camera");
  const blank = structuredClone(group); blank.captures[0].png.distinctColors = 1;
  assert.equal(judgeVisualCaptureGroup(blank).status, FIDELITY_STATUS.UNVERIFIED);
  const missingHtml = { ...group, captures: group.captures.slice(0, 2) };
  assert.equal(judgeVisualCaptureGroup(missingHtml).status, FIDELITY_STATUS.UNVERIFIED);
});

test("SVG corner-AA probes map only real semantic statuses and require the exact authored geometry", async () => {
  const { judgeSvgCornerProbe, FIDELITY_STATUS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const base = { nodeId: "svg-corner-chat-vertical", route: "svg", dpr: 1, zoom: 1, authored: { width: 1.26, height: 7.2 } };
  assert.equal(judgeSvgCornerProbe({ ...base, semantic: { status: "PASS" } }).status, FIDELITY_STATUS.PASS);
  assert.equal(judgeSvgCornerProbe({ ...base, semantic: { status: "FAIL_SVG_GEOMETRY" } }).status, FIDELITY_STATUS.FAIL);
  for (const status of ["SAMPLE_CONTAMINATED", "DATA_MISSING", "UNOBSERVABLE", "UNSUPPORTED_GEOMETRY", undefined])
    assert.equal(judgeSvgCornerProbe({ ...base, semantic: { status } }).status, FIDELITY_STATUS.UNVERIFIED);
  assert.equal(judgeSvgCornerProbe({ ...base, semantic: undefined }).status, FIDELITY_STATUS.UNVERIFIED);
  const dpr2 = judgeSvgCornerProbe({ ...base, dpr: 2, semantic: { status: "PASS" } });
  assert.equal(dpr2.status, FIDELITY_STATUS.PASS);
  assert.match(dpr2.notes.join(), /DPR1/, "a DPR2 Host does not reproduce the DPR1 FAIL rows");
});

test("report summary never declares the goal complete and keeps gaps visible", async () => {
  const { summarizeFidelityReport, planDesignStudioFidelityScenarios, FIDELITY_STATUS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const plan = planDesignStudioFidelityScenarios({ sample: false });
  assert.deepEqual(plan.map(value => value.id), ["open-without-edit", "immediate-click-after-edit", "save-reopen-stable",
    "low-zoom-fractional-performance", "same-camera-visual", "svg-corner-aa-host"]);
  for (const scenario of plan) {
    assert.ok(scenario.fixture && scenario.steps.length && scenario.observables.length, scenario.id);
  }
  assert.ok(plan.find(value => value.id === "low-zoom-fractional-performance").knownGaps.some(gap => /stats\(\)/.test(gap)));
  assert.ok(planDesignStudioFidelityScenarios({ sample: true }).find(value => value.id === "open-without-edit").fixtures.includes("sample"));
  const all = plan.map(value => ({ id: value.id, status: FIDELITY_STATUS.PASS }));
  const passing = summarizeFidelityReport(all);
  assert.equal(passing.overall, "PASS");
  assert.equal(passing.goalComplete, false);
  const mixed = summarizeFidelityReport([...all.slice(1), { id: plan[0].id, status: FIDELITY_STATUS.UNVERIFIED, reasons: ["x"] }]);
  assert.equal(mixed.overall, "INCOMPLETE");
  assert.deepEqual(mixed.unverified, ["open-without-edit"]);
  const failed = summarizeFidelityReport([...all.slice(1), { id: plan[0].id, status: FIDELITY_STATUS.FAIL }]);
  assert.equal(failed.overall, "FAIL");
  assert.equal(summarizeFidelityReport(all.slice(1)).overall, "INCOMPLETE", "a missing scenario cannot pass");
  assert.equal(summarizeFidelityReport([...all, { id: "same-camera-visual", status: FIDELITY_STATUS.EVIDENCE_ONLY }]).overall, "INCOMPLETE");
});

test("every fixture has one page because switching pages marks the document dirty", async () => {
  for (const fixture of await loadFixtures()) assert.equal(JSON.parse(fixture.logicalSource).pages.length, 1, fixture.relativePath);
});

/* ---- Electron-specific runner: exercised only with fake owned handles ---- */
function fakeElectron({ failCapture = false } = {}) {
  const windows = [], partitions = new Map();
  class FakeWindow {
    constructor(options) {
      this.options = options; this.destroyed = false; windows.push(this);
      const listeners = new Map();
      this.webContents = {
        once: (name, callback) => listeners.set(name, callback),
        loadURL: async url => {
          this.url = url;
          const session = partitions.get(options.webPreferences.partition);
          for (const request of ["https://fonts.example/a.woff2", "http://127.0.0.1:9/x", "data:image/png;base64,AA==", "file:///etc/hosts"])
            session.handler({ url: request }, response => session.decisions.push({ url: request, cancel: response.cancel }));
          listeners.get("did-finish-load")?.();
        },
        capturePage: async () => {
          if (failCapture) throw new Error("capture failed");
          return { toPNG: () => Buffer.from("png"), getSize: () => ({ width: 20, height: 10 }) };
        },
      };
    }
    destroy() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  const electron = { BrowserWindow: FakeWindow, session: { fromPartition: name => {
    const value = { decisions: [], handler: null, webRequest: { onBeforeRequest: (_filter, handler) => { value.handler = handler; } } };
    partitions.set(name, value); return value;
  } } };
  return { app: { evaluate: async (fn, argument) => fn(electron, argument) }, windows, partitions };
}

test("runner refuses to touch any handle unless fidelity was explicitly enabled", async () => {
  const { runDesignStudioHostFidelity } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  const calls = [];
  const guest = { execute: async source => { calls.push(source); return null; } };
  const app = { evaluate: async () => { calls.push("evaluate"); } };
  for (const enabled of [undefined, false, "true", 1, null])
    await assert.rejects(runDesignStudioHostFidelity({ enabled, guest, app, projectDirectory: "/tmp/x", fixtures: [] }), /explicit/);
  assert.deepEqual(calls, []);
});

test("owned reference window denies network/file loads and is destroyed even when capture fails", async () => {
  const { captureReferenceHtml } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  const ok = fakeElectron();
  const result = await captureReferenceHtml(ok.app, { html: "<p>x</p>", width: 20, height: 10 });
  assert.equal(result.pngBase64, Buffer.from("png").toString("base64"));
  assert.equal(ok.windows.length, 1);
  assert.equal(ok.windows[0].destroyed, true);
  assert.equal(ok.windows[0].options.show, false);
  assert.equal(ok.windows[0].options.webPreferences.javascript, false);
  assert.equal(ok.windows[0].options.webPreferences.sandbox, true);
  assert.ok(ok.windows[0].url.startsWith("data:text/html"));
  const decisions = [...ok.partitions.values()][0].decisions;
  assert.deepEqual(decisions.map(value => value.cancel), [true, true, false, true]);
  assert.deepEqual(result.blockedRequests.sort(), ["file:///etc/hosts", "http://127.0.0.1:9/x", "https://fonts.example/a.woff2"]);
  const failing = fakeElectron({ failCapture: true });
  await assert.rejects(captureReferenceHtml(failing.app, { html: "<p>x</p>", width: 20, height: 10 }), /capture failed/);
  assert.equal(failing.windows[0].destroyed, true, "owned reference window leaked after failure");
});

test("scenarios with absent DOM observables are UNVERIFIED rather than filled with true", async () => {
  const { runDesignStudioHostFidelity } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  const directory = await scratch("ds-fidelity-runner-");
  try {
    const fixtures = await loadFixtures();
    for (const fixture of fixtures) for (const file of fixture.files) {
      await mkdir(join(directory, dirname(file.relativePath)), { recursive: true });
      await writeFile(join(directory, file.relativePath), file.bytes, { flag: "wx" });
    }
    const waits = [];
    const guest = { execute: async () => null, view: { evaluate: async () => null } };
    const report = await runDesignStudioHostFidelity({ enabled: true, guest, guestWebContentsId: 7, app: fakeElectron().app,
      projectDirectory: directory, packageDirectory: join(repository, "apps/design-studio"), fixtures,
      wait: async ms => { waits.push(ms); }, timeoutMs: 50 });
    assert.equal(report.summary.goalComplete, false);
    assert.notEqual(report.summary.overall, "PASS");
    for (const result of report.results) assert.notEqual(result.status, "PASS", result.id);
    assert.ok(report.results.every(result => ["UNVERIFIED", "FAIL"].includes(result.status)));
    assert.ok(waits.every(ms => ms <= 1000), "unit runner must not sleep for real");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("check-panel-desktop wires fidelity only behind the explicit flag inside the owned cleanup", async () => {
  const source = await readFile(join(repository, "scripts/check-panel-desktop.mjs"), "utf8");
  assert.match(source, /parsePanelDesktopArguments\(process\.argv\.slice\(2\)\)/);
  const preflight = source.indexOf("preflightPanelDesktopHost(");
  const temporary = source.indexOf("mkdtemp(");
  assert.ok(preflight > 0 && preflight < temporary, "preflight must run before any temporary HOME is created");
  assert.ok(source.indexOf("preflightPanelDesktopHost(") < source.indexOf("launchCodeShellElectron("));
  const run = source.indexOf("runDesignStudioHostFidelity(");
  const tryStart = source.indexOf("\ntry {"), finallyStart = source.indexOf("} finally {\n  // Owned Electron/HOME cleanup first");
  assert.ok(run > tryStart && run < finallyStart, "fidelity must run inside the existing owned-cleanup try/finally");
  assert.match(source.slice(source.lastIndexOf("if (", run), run), /designStudioFidelity/);
  assert.match(source, /HASHED_HOST_BUILD_FILES/);
  const outputs = source.indexOf("claimFidelityOutputs()");
  assert.ok(outputs > 0 && outputs < temporary, "harness-owned outputs must be claimed before any temporary HOME");
  assert.match(source, /fidelityOutputs\.writeReport\(/, "the fidelity report is written only through the held handle");
  assert.match(source, /createOwnedGuestCleanup\(/);
  assert.match(source, /requiresOwnedHostCleanup/);
  assert.doesNotMatch(source, /process\.env\.[A-Z_]*FIDELITY/);
});

test("installed SVG export of the corner-AA fixture maps every probe to exact device geometry", async () => {
  const { svgReferenceGeometry, FIDELITY_FIXTURE_PATHS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const { codec } = await studioModules();
  const fixture = (await loadFixtures()).find(value => value.relativePath === FIDELITY_FIXTURE_PATHS.svgCornerAa);
  const svg = codec.exportDesignSvg(codec.normalizeDesignDocument(JSON.parse(fixture.bytes)));
  const geometry = svgReferenceGeometry(svg);
  assert.deepEqual(geometry.viewport, { width: 400, height: 400 });
  const toDevice = (node, dpr) => geometry.toDevice(node, dpr);
  assert.deepEqual(toDevice({ x: 28.3, y: 303.4, width: 1.26, height: 7.2 }, 1), { x: 28.3, y: 303.4, width: 1.26, height: 7.2 });
  assert.deepEqual(toDevice({ x: 27.4, y: 97.3, width: 7.2, height: 1.17 }, 2), { x: 54.8, y: 194.6, width: 14.4, height: 2.34 });
  for (const id of ["chat-vertical", "chat-horizontal", "panels-vertical", "panels-horizontal"])
    assert.match(svg, new RegExp(`data-node-id="svg-corner-${id}"`));
  assert.equal(svgReferenceGeometry("<svg></svg>"), null);
});


/* ---- Review fixes: I1 real hit-test oracle on the canonical fixture ---- */
test("interaction plan expectations match the real hitTestCanvasNode on the canonical fixture at planned geometry", async () => {
  const { INTERACTION_PLAN, FIDELITY_FIXTURE_PATHS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const { hitTestCanvasNode } = await import("../apps/design-studio/app/canvas-interaction.mjs");
  const { codec } = await studioModules();
  const fixture = (await loadFixtures()).find(value => value.relativePath === FIDELITY_FIXTURE_PATHS.interaction);
  const page = codec.normalizeDesignDocument(JSON.parse(fixture.logicalSource)).pages[0];
  const order = page.nodes.map(node => node.id);
  assert.ok(order.indexOf("move-target") > order.indexOf("underlay"), "move-target must paint (and hit) above underlay");
  let nodes = page.nodes;
  const at = (overrides, point) => hitTestCanvasNode({ ...page, nodes: nodes.map(node => overrides[node.id] ? { ...node, ...overrides[node.id] } : node) }, point)?.id ?? null;
  for (const step of INTERACTION_PLAN) {
    const target = nodes.find(node => node.id === step.targetId);
    assert.ok(Math.abs(target.x - step.before.x) <= (step.beforeTolerance ?? 0) && Math.abs(target.y - step.before.y) <= (step.beforeTolerance ?? 0), step.operation);
    const offsets = step.tolerance ? [-step.tolerance, 0, step.tolerance] : [0];
    for (const dx of offsets) for (const click of step.clicks) {
      const actual = at({ [step.targetId]: { x: step.after.x + dx, y: step.after.y } }, click.world);
      assert.equal(actual, click.expected[0] ?? null, `${step.operation} ${click.label} dx=${dx}`);
    }
    nodes = nodes.map(node => node.id === step.targetId ? { ...node, x: step.after.x, y: step.after.y, ...(step.text ? { text: step.text } : {}) } : node);
  }
});

test("pre-edit guard refuses an edit unless the DOM selection and geometry are the planned target", async () => {
  const { INTERACTION_PLAN, guardPreEdit } = await import("../scripts/design-studio-host-fidelity.mjs");
  const [drag, inspector] = INTERACTION_PLAN;
  assert.deepEqual(guardPreEdit(drag, { selectedIds: ["move-target"], geometry: { x: 120, y: 140 } }), []);
  assert.deepEqual(guardPreEdit(inspector, { selectedIds: ["move-target"], geometry: { x: 391, y: 140 } }), []);
  assert.ok(guardPreEdit(inspector, { selectedIds: ["underlay"], geometry: { x: 400, y: 140 } }).length);
  assert.ok(guardPreEdit(inspector, { selectedIds: ["move-target", "underlay"], geometry: { x: 380, y: 140 } }).length);
  assert.ok(guardPreEdit(inspector, { selectedIds: ["move-target"], geometry: { x: 120, y: 140 } }).length, "drag never happened");
  assert.ok(guardPreEdit(drag, { selectedIds: null, geometry: null }).length);
});

/* ---- I2 byte budgets and the real indexed protocol ---- */
test("every fixture file fits the real Host readText budget; large text uses the real index codec and reconstructs canonically", async () => {
  const { HOST_READ_TEXT_MAX_BYTES, FIDELITY_FIXTURE_PATHS, readFixtureDocument } = await import("../scripts/design-studio-host-fidelity.mjs");
  const { codec, documentIndex } = await studioModules();
  const bundle = await import("../apps/design-studio/app/document-bundle.mjs");
  assert.equal(HOST_READ_TEXT_MAX_BYTES, 480 * 1024);
  const fixtures = await loadFixtures();
  for (const fixture of fixtures) for (const file of fixture.files) {
    const bytes = Buffer.byteLength(file.bytes);
    assert.ok(bytes <= HOST_READ_TEXT_MAX_BYTES, `${file.relativePath} is ${bytes} bytes`);
    assert.equal(file.sha256, sha256(file.bytes));
    if (file.relativePath === fixture.relativePath) assert.ok(bytes <= bundle.MAX_WORKSPACE_DESIGN_TEXT_BYTES, `${file.relativePath} primary exceeds the app budget`);
    else assert.ok(bytes <= bundle.MAX_DESIGN_BUNDLE_PART_BYTES && bytes >= 1, `${file.relativePath} part is ${bytes} bytes`);
  }
  const large = fixtures.find(value => value.relativePath === FIDELITY_FIXTURE_PATHS.largeText);
  assert.equal(large.storage, "indexed");
  assert.ok(Buffer.byteLength(large.logicalSource) > HOST_READ_TEXT_MAX_BYTES, "the logical document really exceeds one readText");
  assert.ok(large.files.length >= 3, "manifest plus at least two page parts");
  assert.ok(large.files.slice(1).every(file => file.relativePath.startsWith("designs/codesign-data/pages/")));
  const memory = new Map(large.files.map(file => [file.relativePath, file.bytes]));
  const resolved = await documentIndex.resolveDesignIndexDocument({ primarySource: large.bytes,
    readText: async path => { assert.ok(memory.has(path), path); return memory.get(path); },
    sha256: async value => sha256(value) });
  assert.equal(codec.serializeDesignDocument(codec.normalizeDesignDocument(resolved.document)), large.logicalSource);
  const texts = codec.normalizeDesignDocument(resolved.document).pages[0].nodes.filter(node => node.type === "text");
  assert.ok(texts.length >= 1000);
  const directory = await scratch("ds-fidelity-indexed-");
  try {
    for (const file of large.files) {
      await mkdir(join(directory, dirname(file.relativePath)), { recursive: true });
      await writeFile(join(directory, file.relativePath), file.bytes, { flag: "wx" });
    }
    const read = await readFixtureDocument({ projectDirectory: directory, relativePath: large.relativePath, codec, documentIndex });
    assert.equal(codec.serializeDesignDocument(read), large.logicalSource);
    await writeFile(join(directory, large.files[1].relativePath), large.files[1].bytes.replace("Dashboard", "Dashboarx"));
    await assert.rejects(readFixtureDocument({ projectDirectory: directory, relativePath: large.relativePath, codec, documentIndex }), /摘要|sha|digest/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

/* ---- I3 output paths: real symlinks, dangling links, races, create-only ---- */
/* ---- M bounded local timeouts with owned cancellation ---- */
test("a pending guest call times out locally, terminates only the owned guest and waits for settlement", async () => {
  const { runDesignStudioHostFidelity } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  const directory = await scratch("ds-fidelity-timeout-");
  try {
    const fixtures = await loadFixtures();
    for (const fixture of fixtures) for (const file of fixture.files) {
      await mkdir(join(directory, dirname(file.relativePath)), { recursive: true });
      await writeFile(join(directory, file.relativePath), file.bytes, { flag: "wx" });
    }
    const pending = new Set();
    let removed = 0, settled = 0;
    const guest = {
      execute: () => new Promise((_resolve, reject) => { const entry = { reject }; pending.add(entry); }).finally(() => { settled++; }),
      remove: async () => { removed++; for (const entry of pending) entry.reject(new Error("guest destroyed")); pending.clear(); },
      view: { evaluate: async () => null },
    };
    const started = Date.now();
    const report = await runDesignStudioHostFidelity({ enabled: true, guest, guestWebContentsId: 7, app: fakeElectron().app,
      projectDirectory: directory, packageDirectory: join(repository, "apps/design-studio"), fixtures,
      wait: async () => {}, timeoutMs: 40, settleTimeoutMs: 40 });
    assert.ok(Date.now() - started < 5000, "runner must return within a local bound");
    assert.equal(removed, 1, "only the owned guest is terminated, once");
    assert.equal(pending.size, 0);
    assert.ok(settled >= 1, "the pending operation settled before the runner continued");
    assert.match(report.results[0].reasons.join(), /timed out/);
    assert.ok(report.results.slice(1).every(result => result.status === "UNVERIFIED" && /aborted/.test(result.reasons.join())));
    assert.equal(report.terminatedGuest, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("an operation that never settles after cancellation is reported unsettled without hanging", async () => {
  const { boundedOwnedOperation } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  let cancelled = 0;
  const started = Date.now();
  await assert.rejects(boundedOwnedOperation(() => new Promise(() => {}), { label: "stuck", timeoutMs: 20, settleTimeoutMs: 20,
    cancel: async () => { cancelled++; } }), error => error.unsettled === true && /stuck/.test(error.message));
  assert.equal(cancelled, 1);
  assert.ok(Date.now() - started < 2000);
  assert.equal(await boundedOwnedOperation(async () => 5, { label: "fast", timeoutMs: 20, settleTimeoutMs: 20, cancel: async () => { cancelled++; } }), 5);
  assert.equal(cancelled, 1, "no cancellation for an operation that finished in time");
});

test("reference load/capture have a local deadline that destroys the owned window before settling", async () => {
  const { captureReferenceHtml } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  const windows = [];
  let loadSettled = false;
  class HangingWindow {
    constructor(options) {
      this.options = options; this.destroyed = false; windows.push(this);
      let rejectLoad;
      this.webContents = { once: () => {}, loadURL: () => new Promise((_resolve, reject) => { rejectLoad = reject; }).finally(() => { loadSettled = true; }),
        capturePage: async () => { throw new Error("unreachable"); } };
      this.destroy = () => { this.destroyed = true; rejectLoad?.(new Error("ERR_ABORTED")); };
    }
    isDestroyed() { return this.destroyed; }
  }
  const electron = { BrowserWindow: HangingWindow, session: { fromPartition: () => ({ webRequest: { onBeforeRequest: () => {} } }) } };
  const started = Date.now();
  await assert.rejects(captureReferenceHtml({ evaluate: async (fn, argument) => fn(electron, argument) },
    { html: "<p>x</p>", width: 10, height: 10, timeoutMs: 30, settleTimeoutMs: 30 }), /timed out/);
  assert.ok(Date.now() - started < 2000);
  assert.equal(windows[0].destroyed, true);
  assert.equal(loadSettled, true, "the pending load settled after the owned window was destroyed");
});


/* ---- Third review: I3 handle-bound outputs in a root-owned sticky temp root ---- */
const systemRoot = process.platform === "darwin" ? "/private/tmp" : "/tmp";
const unixOnly = { skip: !["darwin", "linux"].includes(process.platform) };
const repoSentinel = () => join(repository, ".tmp", `fidelity-never-written-${process.pid}-${Math.random().toString(16).slice(2)}`);
async function removeOwned(paths) {
  const { lstat, unlink } = await import("node:fs/promises");
  for (const path of paths) if (await lstat(path).then(() => true, () => false)) await unlink(path);
}

test("only a root-owned, non-symlink, sticky system temp chain is accepted as the output root", unixOnly, async () => {
  const { verifyRootOwnedOutputRoot } = await import("../scripts/design-studio-host-fidelity.mjs");
  const { symlink } = await import("node:fs/promises");
  const chain = await verifyRootOwnedOutputRoot(systemRoot);
  assert.equal(chain.at(-1).path, systemRoot);
  assert.ok(chain.every(entry => entry.uid === 0 && !entry.symlink));
  const directory = await scratch("ds-fidelity-root-");
  try {
    await assert.rejects(verifyRootOwnedOutputRoot(directory), /root-owned/, "a user-owned directory can be swapped by the user");
    const link = join(directory, "link");
    await symlink(systemRoot, link);
    await assert.rejects(verifyRootOwnedOutputRoot(link), /symlink|root-owned/);
    if (process.platform === "darwin") await assert.rejects(verifyRootOwnedOutputRoot("/tmp"), /symlink/, "/tmp is a symlink on macOS");
    await assert.rejects(verifyRootOwnedOutputRoot(join(repository, ".tmp")), /root-owned/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("claim creates exactly two O_EXCL|O_NOFOLLOW files in the system root and never a directory", unixOnly, async () => {
  const { claimFidelityOutputs } = await import("../scripts/design-studio-host-fidelity.mjs");
  const { lstat, readdir } = await import("node:fs/promises");
  const outputs = await claimFidelityOutputs();
  try {
    assert.equal(dirname(outputs.reportPath), systemRoot);
    assert.equal(dirname(outputs.bundlePath), systemRoot);
    for (const path of [outputs.reportPath, outputs.bundlePath]) {
      const value = await lstat(path);
      assert.ok(value.isFile() && !value.isSymbolicLink());
      assert.equal(value.mode & 0o777, 0o600);
    }
    assert.equal((await readdir(systemRoot)).filter(name => name.startsWith(outputs.name)).length, 2, "no extra entries or directories");
    await assert.rejects(claimFidelityOutputs({ root: join(repository, ".tmp") }), /root-owned/, "callers cannot redirect outputs into the repository");
  } finally { await outputs.close(); await removeOwned([outputs.reportPath, outputs.bundlePath]); }
});

test("pre-existing entries (dangling symlink, file) at the claimed names are refused and never followed", unixOnly, async () => {
  const { claimFidelityOutputs } = await import("../scripts/design-studio-host-fidelity.mjs");
  const { symlink, lstat } = await import("node:fs/promises");
  const name = `ds-host-fidelity-test-${process.pid}-${Date.now()}`;
  const sentinel = repoSentinel();
  const reportPath = join(systemRoot, `${name}.report.json`), bundlePath = join(systemRoot, `${name}.artifacts.bin`);
  try {
    await symlink(sentinel, reportPath);
    await assert.rejects(claimFidelityOutputs({ name }), /EEXIST/);
    await assert.rejects(lstat(sentinel), /ENOENT/, "the dangling link target (inside the repository) was never created");
    await removeOwned([reportPath]);
    await writeFile(bundlePath, "existing", { flag: "wx", mode: 0o600 });
    await assert.rejects(claimFidelityOutputs({ name }), /EEXIST/);
    assert.equal(await readFile(bundlePath, "utf8"), "existing");
    await assert.rejects(lstat(reportPath), /ENOENT/, "a failed claim closes and removes only its own just-created file");
  } finally { await removeOwned([reportPath, bundlePath]); }
});

test("writes stay bound to the claimed inodes after the paths are swapped for symlinks into the repository", unixOnly, async () => {
  const { claimFidelityOutputs } = await import("../scripts/design-studio-host-fidelity.mjs");
  const { rename, symlink, lstat } = await import("node:fs/promises");
  const outputs = await claimFidelityOutputs();
  const movedReport = `${outputs.reportPath}.moved`, movedBundle = `${outputs.bundlePath}.moved`;
  const reportSentinel = repoSentinel(), bundleSentinel = repoSentinel();
  try {
    await rename(outputs.reportPath, movedReport);
    await symlink(reportSentinel, outputs.reportPath);
    await rename(outputs.bundlePath, movedBundle);
    await symlink(bundleSentinel, outputs.bundlePath);
    const first = await outputs.writeArtifact("visual-100-gpu", Buffer.from("PNG-A"));
    const second = await outputs.writeArtifact("visual-100-html", Buffer.from("PNG-BB"));
    assert.deepEqual([first.offset, first.length, second.offset, second.length], [0, 5, 5, 6]);
    assert.equal(first.sha256, sha256(Buffer.from("PNG-A")));
    await assert.rejects(outputs.writeArtifact("visual-100-gpu", Buffer.from("x")), /duplicate/);
    await assert.rejects(outputs.writeArtifact("../escape", Buffer.from("x")), /label/);
    await outputs.writeReport('{"ok":true}\n');
    await assert.rejects(outputs.writeReport("{}"), /once/);
    assert.equal(await readFile(movedBundle, "utf8"), "PNG-APNG-BB");
    assert.equal(await readFile(movedReport, "utf8"), '{"ok":true}\n');
    await assert.rejects(lstat(reportSentinel), /ENOENT/, "repository sentinel never written");
    await assert.rejects(lstat(bundleSentinel), /ENOENT/, "repository sentinel never written");
    assert.deepEqual(outputs.artifacts().map(value => value.label), ["visual-100-gpu", "visual-100-html"]);
  } finally {
    await outputs.close(); await outputs.close();
    await removeOwned([outputs.reportPath, outputs.bundlePath, movedReport, movedBundle]);
  }
});

test("runner captures go only through the held artifact sink", async () => {
  const { writeArtifactPng } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  const { PNG } = await import("pngjs");
  const records = [];
  const sink = { writeArtifact: async (label, buffer) => { records.push(label); return { label, offset: 0, length: buffer.length, sha256: sha256(buffer) }; } };
  const image = new PNG({ width: 2, height: 1 }); image.data = Buffer.from([0, 0, 0, 255, 255, 255, 255, 255]);
  const evidence = await writeArtifactPng(sink, "visual-fit-gpu", PNG.sync.write(image));
  assert.equal(evidence.summary.distinctColors, 2);
  assert.equal(evidence.summary.artifact.label, "visual-fit-gpu");
  assert.deepEqual(records, ["visual-fit-gpu"]);
  const source = await readFile(join(repository, "scripts/design-studio-host-fidelity-runner.mjs"), "utf8");
  assert.doesNotMatch(source, /writeFile|mkdir/, "the runner never writes by path");
});

/* ---- Third review: M deadline covers cancel + settle; cleanup state propagates ---- */
test("operation and cancel both pending: bounded return, unsettled, cancel state reported", async () => {
  const { boundedOwnedOperation } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  const started = Date.now();
  await assert.rejects(boundedOwnedOperation(() => new Promise(() => {}), { label: "both pending", timeoutMs: 10, settleTimeoutMs: 10,
    cancel: () => new Promise(() => {}) }), error => {
    assert.equal(error.unsettled, true);
    assert.deepEqual(error.cleanup, { operationSettled: false, cancelState: "pending" });
    return true;
  });
  assert.ok(Date.now() - started < 200, `returned after ${Date.now() - started}ms; bound is timeout+settle`);
  await assert.rejects(boundedOwnedOperation(() => new Promise(() => {}), { label: "cancel rejects", timeoutMs: 10, settleTimeoutMs: 10,
    cancel: async () => { throw new Error("remove failed"); } }), error => {
    assert.equal(error.unsettled, true);
    assert.match(error.cleanup.cancelState, /^rejected: remove failed/);
    return true;
  });
  // Operation settles after cancel, but cancel itself failed: still reported for owned cleanup.
  let release;
  await assert.rejects(boundedOwnedOperation(() => new Promise(resolve => { release = resolve; }), { label: "cancel fails, op settles", timeoutMs: 10, settleTimeoutMs: 50,
    cancel: async () => { release(); throw new Error("renderer channel closed"); } }), error => {
    assert.equal(error.cleanup.operationSettled, true);
    assert.equal(error.unsettled, true, "a failed cancel needs the owned process cleanup");
    return true;
  });
});

test("owned guest cleanup is idempotent and bounded even when remove itself hangs", async () => {
  const { createOwnedGuestCleanup } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  let calls = 0;
  const cleanup = createOwnedGuestCleanup({ remove: () => { calls++; return new Promise(() => {}); } }, { timeoutMs: 15 });
  const started = Date.now();
  const first = await cleanup.remove(), second = await cleanup.remove();
  assert.ok(Date.now() - started < 200);
  assert.equal(calls, 1, "remove is invoked once across runner and caller");
  assert.deepEqual(first, second);
  assert.equal(first.removeState, "pending");
  assert.equal(cleanup.state().requiresOwnedHostCleanup, true);
  const ok = createOwnedGuestCleanup({ remove: async () => {} }, { timeoutMs: 15 });
  assert.equal((await ok.remove()).removeState, "resolved");
  assert.equal(ok.state().requiresOwnedHostCleanup, false);
});

test("guest call and guest remove both pending: runner returns, aborts the rest and requires owned Host cleanup", async () => {
  const { runDesignStudioHostFidelity, createOwnedGuestCleanup } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  const directory = await scratch("ds-fidelity-double-pending-");
  try {
    const fixtures = await loadFixtures();
    for (const fixture of fixtures) for (const file of fixture.files) {
      await mkdir(join(directory, dirname(file.relativePath)), { recursive: true });
      await writeFile(join(directory, file.relativePath), file.bytes, { flag: "wx" });
    }
    let removes = 0;
    const guest = { execute: () => new Promise(() => {}), remove: () => { removes++; return new Promise(() => {}); }, view: { evaluate: async () => null } };
    const guestCleanup = createOwnedGuestCleanup(guest, { timeoutMs: 20 });
    const started = Date.now();
    const report = await runDesignStudioHostFidelity({ enabled: true, guest, guestCleanup, guestWebContentsId: 7, app: fakeElectron().app,
      projectDirectory: directory, packageDirectory: join(repository, "apps/design-studio"), fixtures, wait: async () => {}, timeoutMs: 20, settleTimeoutMs: 20 });
    assert.ok(Date.now() - started < 3000);
    await guestCleanup.remove(); // the caller's finally
    assert.equal(removes, 1);
    assert.equal(report.cleanup.requiresOwnedHostCleanup, true);
    assert.equal(report.cleanup.guest.removeState, "pending");
    assert.ok(report.cleanup.unsettled.some(value => /guest DOM probe/.test(value.label)));
    assert.ok(report.results.slice(1).every(result => /aborted/.test(result.reasons.join())));
    assert.notEqual(report.summary.overall, "PASS");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a reference evaluation that never settles is not swallowed: rest aborted and owned cleanup required", async () => {
  const { runDesignStudioHostFidelity } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  const directory = await scratch("ds-fidelity-reference-pending-");
  try {
    const fixtures = await loadFixtures();
    for (const fixture of fixtures) for (const file of fixture.files) {
      await mkdir(join(directory, dirname(file.relativePath)), { recursive: true });
      await writeFile(join(directory, file.relativePath), file.bytes, { flag: "wx" });
    }
    // Only the reference path is reached directly: the referenceCapture hook is the real captureReferenceHtml bound to a Main that never answers.
    const { captureReferenceHtml } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
    const stuckApp = { evaluate: () => new Promise(() => {}) };
    const started = Date.now();
    await assert.rejects(captureReferenceHtml(stuckApp, { html: "<p>x</p>", width: 4, height: 4, timeoutMs: 10, settleTimeoutMs: 10 }),
      error => error.unsettled === true && error.cleanup.operationSettled === false);
    assert.ok(Date.now() - started < 3000);
    // A guest whose DOM answers (camera at zoom 1) so the SVG scenario reaches its reference capture.
    const camera = { zoom: 1, panX: 0, panY: 0, dpr: 1, canvasRatio: 1, rect: { x: 0, y: 0, width: 400, height: 400 } };
    const guest = { execute: async source => source.includes("getTransform") ? camera : true, remove: async () => {}, view: { evaluate: async () => null } };
    const report = await runDesignStudioHostFidelity({ enabled: true, guest, guestWebContentsId: 7, app: stuckApp, projectDirectory: directory,
      packageDirectory: join(repository, "apps/design-studio"), fixtures, wait: async () => {}, timeoutMs: 20, settleTimeoutMs: 20,
      onlyScenarios: ["svg-corner-aa-host"] });
    assert.equal(report.cleanup.requiresOwnedHostCleanup, true);
    assert.ok(report.cleanup.unsettled.some(value => value.label === "reference window evaluation" && value.cleanup.operationSettled === false));
    assert.match(report.abortReason, /reference window evaluation timed out/, "later scenarios would be aborted");
    assert.deepEqual(report.results.map(result => [result.id, result.status]), [["svg-corner-aa-host", "UNVERIFIED"]]);
    assert.equal(report.summary.notRun.length, 5, "filtered scenarios stay visible as not run");
    assert.notEqual(report.summary.overall, "PASS");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

/* ---- Fourth review: bounded pre-run setup, evidence-preserving failure partials ---- */
test("pre-run guest setup is bounded and hands a hung guest to the shared owned cleanup", async () => {
  const { prepareFidelityGuest, createOwnedGuestCleanup } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  const ready = 'document.querySelector("#stage-wrap").dataset.rendererStatus === "active"';
  // 1. A readiness probe that never returns; remove settles it.
  let removes = 0, rejectPending;
  const hung = { execute: () => new Promise((_resolve, reject) => { rejectPending = reject; }),
    remove: async () => { removes++; rejectPending?.(new Error("guest destroyed")); }, view: { evaluate: async () => 9 } };
  const cleanup = createOwnedGuestCleanup(hung, { timeoutMs: 20 });
  let started = Date.now();
  await assert.rejects(prepareFidelityGuest({ guest: hung, guestCleanup: cleanup, readySource: ready, timeoutMs: 20, settleTimeoutMs: 20, wait: async () => {} }),
    error => error.timedOut === true && error.unsettled === false && /readiness/.test(error.message));
  assert.ok(Date.now() - started < 1000);
  await cleanup.remove(); // the caller's finally
  assert.equal(removes, 1, "runner path and caller finally share one remove");
  // 2. Probe and remove both hang: still bounded, unsettled, owned Host cleanup required.
  const stuck = { execute: () => new Promise(() => {}), remove: () => new Promise(() => {}), view: { evaluate: async () => 9 } };
  const stuckCleanup = createOwnedGuestCleanup(stuck, { timeoutMs: 20 });
  started = Date.now();
  await assert.rejects(prepareFidelityGuest({ guest: stuck, guestCleanup: stuckCleanup, readySource: ready, timeoutMs: 20, settleTimeoutMs: 20, wait: async () => {} }),
    error => error.unsettled === true);
  assert.ok(Date.now() - started < 1000);
  assert.equal(stuckCleanup.state().requiresOwnedHostCleanup, true);
  // 3. getWebContentsId hangs after readiness.
  const idHangs = { execute: async () => true, remove: async () => {}, view: { evaluate: () => new Promise(() => {}) } };
  await assert.rejects(prepareFidelityGuest({ guest: idHangs, guestCleanup: createOwnedGuestCleanup(idHangs, { timeoutMs: 20 }), readySource: ready,
    timeoutMs: 20, settleTimeoutMs: 20, wait: async () => {} }), /webContents id/);
  // 4. A ready guest that never becomes ready within the poll budget is a plain bounded failure.
  let polls = 0;
  const notReady = { execute: async () => { polls++; return false; }, remove: async () => {}, view: { evaluate: async () => 9 } };
  await assert.rejects(prepareFidelityGuest({ guest: notReady, guestCleanup: createOwnedGuestCleanup(notReady), readySource: ready,
    timeoutMs: 30, settleTimeoutMs: 20, wait: () => new Promise(resolve => setTimeout(resolve, 5)) }), /not ready/);
  assert.ok(polls >= 2);
  // 5. Normal path.
  const fine = { execute: async () => true, remove: async () => {}, view: { evaluate: async () => 42 } };
  assert.deepEqual(await prepareFidelityGuest({ guest: fine, guestCleanup: createOwnedGuestCleanup(fine), readySource: ready, timeoutMs: 20, settleTimeoutMs: 20,
    wait: async () => {} }), { guestWebContentsId: 42 });
});

test("failure partial keeps completed fidelity evidence and the actual cleanup outcome, never as complete or PASS", async () => {
  const { buildFidelityFailurePartial, describeOwnedCleanup } = await import("../scripts/design-studio-host-fidelity.mjs");
  const fidelityReport = { summary: { overall: "INCOMPLETE", goalComplete: false }, results: [{ id: "open-without-edit", status: "PASS" }] };
  const artifacts = [{ label: "visual-100-gpu", offset: 0, length: 5, sha256: hex("a") }];
  const primary = new Error("generic restore assertion failed");
  const cleanupError = new AggregateError([primary, new Error("Fixture HOME retained for an unverified live Electron: /x")], "cleanup failed");
  const cleanup = describeOwnedCleanup({ error: cleanupError, primaryFailure: primary });
  assert.deepEqual(cleanup, { completed: false, receipt: null, receiptUnavailableReason: "owned cleanup reported errors besides the primary failure",
    homeRetained: true, errors: ["Fixture HOME retained for an unverified live Electron: /x"] });
  const partial = buildFidelityFailurePartial({ stage: "design-studio: project update and exact-package restore", failure: primary, fidelityReport, artifacts, cleanup });
  assert.equal(partial.partial, true);
  assert.equal(partial.complete, false);
  assert.equal(partial.goalComplete, false);
  assert.notEqual(partial.overall, "PASS");
  assert.equal(partial.failure.message, "generic restore assertion failed");
  assert.deepEqual(partial.designStudioFidelity, fidelityReport, "completed fidelity evidence is kept");
  assert.deepEqual(partial.artifacts, artifacts, "the bundle index is kept");
  assert.equal(partial.cleanup.homeRetained, true);
  const ok = describeOwnedCleanup({ receipt: { exited: true, homeRemoved: true } });
  assert.deepEqual(ok, { completed: true, receipt: { exited: true, homeRemoved: true }, homeRetained: false, errors: [] });
  const notRun = buildFidelityFailurePartial({ stage: "launch production Electron", failure: new Error("x"), fidelityReport: null, artifacts: [], cleanup: ok });
  assert.equal(notRun.designStudioFidelity.status, "NOT_RUN");
  assert.equal(notRun.overall, "NOT_COMPLETE");
});

test("the failure partial is written at most once and a write error never replaces the original failure", async () => {
  const { writeFidelityPartialOnce } = await import("../scripts/design-studio-host-fidelity.mjs");
  const writes = [];
  let written = false;
  const outputs = { reportWritten: () => written, writeReport: async text => { writes.push(text); written = true; } };
  assert.deepEqual(await writeFidelityPartialOnce(outputs, { partial: true }), { written: true });
  assert.deepEqual(await writeFidelityPartialOnce(outputs, { partial: true }), { written: false, reason: "report already written" });
  assert.equal(writes.length, 1);
  assert.ok(writes[0].endsWith("\n") && JSON.parse(writes[0]).partial === true);
  const broken = { reportWritten: () => false, writeReport: async () => { throw new Error("EIO"); } };
  assert.deepEqual(await writeFidelityPartialOnce(broken, { partial: true }), { written: false, error: "EIO" });
  assert.deepEqual(await writeFidelityPartialOnce(null, { partial: true }), { written: false, reason: "no fidelity outputs" });
});

test("claimed outputs expose whether the single report write already happened", unixOnly, async () => {
  const { claimFidelityOutputs } = await import("../scripts/design-studio-host-fidelity.mjs");
  const outputs = await claimFidelityOutputs();
  try {
    assert.equal(outputs.reportWritten(), false);
    await outputs.writeReport("{}\n");
    assert.equal(outputs.reportWritten(), true);
  } finally { await outputs.close(); await removeOwned([outputs.reportPath, outputs.bundlePath]); }
});

test("check-panel-desktop bounds fidelity setup and writes one partial after the owned cleanup on any failure", async () => {
  const source = await readFile(join(repository, "scripts/check-panel-desktop.mjs"), "utf8");
  assert.doesNotMatch(source, /untilGuest\(fidelityGuest/, "the unbounded generic poll is not used for the fidelity guest");
  assert.doesNotMatch(source, /fidelityGuest\.view\.evaluate/);
  const cleanupCreated = source.indexOf("createOwnedGuestCleanup(fidelityGuest)");
  const prepare = source.indexOf("prepareFidelityGuest(");
  assert.ok(cleanupCreated > 0 && prepare > cleanupCreated, "setup runs after the shared cleanup exists");
  const guarded = source.indexOf("withOwnedFidelityGuest(guestCleanup");
  assert.ok(guarded > cleanupCreated && prepare > guarded, "setup runs inside the guarded body whose finally removes the guest");
  const ownedCleanup = source.indexOf("cleanupPanelDesktopFixture({ app, ownedChildProcess");
  const partial = source.indexOf("writeFidelityPartialOnce(");
  assert.ok(partial > ownedCleanup, "the partial is written after the owned cleanup so it records its actual outcome");
  assert.equal(source.match(/fidelityOutputs\.writeReport\(/g)?.length, 1, "only the success path writes the full report directly");
  assert.match(source.slice(partial - 600, partial + 400), /describeOwnedCleanup/);
});


/* ---- Fifth review: cleanup outcome with a primary failure; original startup error preserved ---- */
test("primary-only AggregateError from the owned cleanup helper means cleanup succeeded (no receipt is fabricated)", async () => {
  const { describeOwnedCleanup, buildFidelityFailurePartial } = await import("../scripts/design-studio-host-fidelity.mjs");
  const primary = new Error("generic restore assertion failed");
  // cleanupPanelDesktopFixture always rethrows the primary failure, even after Electron exited and HOME was removed.
  const cleanup = describeOwnedCleanup({ error: new AggregateError([primary], "Panel Desktop acceptance or cleanup failed"), primaryFailure: primary });
  assert.equal(cleanup.completed, true);
  assert.equal(cleanup.receipt, null, "the helper returns no receipt when it throws");
  assert.match(cleanup.receiptUnavailableReason, /primary failure/);
  assert.deepEqual(cleanup.inferredFromHelperSemantics, { ownedElectronClosedOrNotLaunched: true, homeRemoved: true });
  assert.equal(cleanup.homeRetained, false);
  assert.deepEqual(cleanup.errors, []);
  const partial = buildFidelityFailurePartial({ stage: "restore", failure: primary, fidelityReport: null, artifacts: [], cleanup });
  assert.equal(partial.overall, "NOT_COMPLETE", "successful cleanup never turns a failed run into a pass");
  assert.equal(partial.complete, false);
  const home = describeOwnedCleanup({ error: new AggregateError([primary, new Error("Fixture HOME retained for an unverified live Electron: /h")]), primaryFailure: primary });
  assert.equal(home.completed, false);
  assert.equal(home.homeRetained, true);
  assert.equal(home.inferredFromHelperSemantics, undefined);
  const close = describeOwnedCleanup({ error: new AggregateError([primary, new Error("Owned Electron close timed out")]), primaryFailure: primary });
  assert.equal(close.completed, false);
  assert.deepEqual(close.errors, ["Owned Electron close timed out"]);
  const noPrimary = describeOwnedCleanup({ error: new Error("remove failure") });
  assert.equal(noPrimary.completed, false);
  assert.deepEqual(describeOwnedCleanup({ receipt: { exited: true, homeRemoved: true } }),
    { completed: true, receipt: { exited: true, homeRemoved: true }, homeRetained: false, errors: [] });
});

test("a startup timeout plus unsettled guest cleanup keeps the original timeout in the thrown failure and the partial", async () => {
  const { prepareFidelityGuest, createOwnedGuestCleanup, withOwnedFidelityGuest } = await import("../scripts/design-studio-host-fidelity-runner.mjs");
  const { buildFidelityFailurePartial } = await import("../scripts/design-studio-host-fidelity.mjs");
  const stuck = { execute: () => new Promise(() => {}), remove: () => new Promise(() => {}), view: { evaluate: async () => 9 } };
  const guestCleanup = createOwnedGuestCleanup(stuck, { timeoutMs: 20 });
  const started = Date.now();
  let thrown;
  try {
    await withOwnedFidelityGuest(guestCleanup, () => prepareFidelityGuest({ guest: stuck, guestCleanup, readySource: "true",
      timeoutMs: 20, settleTimeoutMs: 20, wait: async () => {} }));
  } catch (error) { thrown = error; }
  assert.ok(Date.now() - started < 1000, "every step stays bounded");
  assert.ok(thrown instanceof AggregateError, "the unsettled cleanup error does not replace the original failure");
  assert.match(thrown.errors[0].message, /fidelity guest readiness probe timed out/);
  assert.equal(thrown.errors[0].unsettled, true);
  assert.match(thrown.errors[1].message, /unsettled owned work/);
  assert.match(thrown.message, /readiness probe timed out/);
  const partial = buildFidelityFailurePartial({ stage: "design-studio fidelity: real Host scenarios", failure: thrown, fidelityReport: null, artifacts: [],
    cleanup: { completed: true } });
  assert.match(partial.failure.message, /readiness probe timed out/);
  assert.deepEqual(partial.failure.errors.map(value => value.message.split(";")[0]),
    ["fidelity guest readiness probe timed out after 20ms", "Design Studio fidelity left unsettled owned work: {\"guest\":{\"removeCalls\":1,\"removeState\":\"pending\",\"requiresOwnedHostCleanup\":true}}"]);
  // Without unsettled work the original error is rethrown unchanged; with no error the body result is returned.
  const fine = { execute: async () => true, remove: async () => {}, view: { evaluate: async () => 5 } };
  const original = new Error("plain failure");
  await assert.rejects(withOwnedFidelityGuest(createOwnedGuestCleanup(fine), async () => { throw original; }), error => error === original);
  assert.equal(await withOwnedFidelityGuest(createOwnedGuestCleanup(fine), async () => 7), 7);
  // Unsettled work without an original error is reported on its own.
  await assert.rejects(withOwnedFidelityGuest(createOwnedGuestCleanup(fine), async () => 1, { requiresOwnedHostCleanup: () => true }),
    error => !(error instanceof AggregateError) && /unsettled owned work/.test(error.message));
});
