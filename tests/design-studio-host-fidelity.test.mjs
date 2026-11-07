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

test("fidelity opt-in requires an explicit built Host and a report path", () => {
  assert.throws(() => parsePanelDesktopArguments([DESIGN_STUDIO_FIDELITY_FLAG]), /built Host/);
  assert.throws(() => parsePanelDesktopArguments(["/host", DESIGN_STUDIO_FIDELITY_FLAG]), /report path/);
  const parsed = parsePanelDesktopArguments(["/host", "/tmp/new-report.json", DESIGN_STUDIO_FIDELITY_FLAG]);
  assert.equal(parsed.selectedApp, "design-studio", "fidelity runs only the Design Studio package case");
  assert.deepEqual(parsed.designStudioFidelity, { samplePath: null });
});

test("fidelity opt-in rejects other Panels and stray sample flags", () => {
  assert.throws(() => parsePanelDesktopArguments(["/host", "/tmp/r.json", DESIGN_STUDIO_FIDELITY_FLAG, "--app", "quant-lab"]), /design-studio/);
  assert.throws(() => parsePanelDesktopArguments(["/host", "/tmp/r.json", "--design-studio-sample", "/tmp/a.codesign.json"]), /requires --design-studio-fidelity/);
  assert.throws(() => parsePanelDesktopArguments(["/host", "/tmp/r.json", DESIGN_STUDIO_FIDELITY_FLAG, "--design-studio-sample"]), /sample path/);
  assert.throws(() => parsePanelDesktopArguments(["/host", "/tmp/r.json", "--unknown"]), /unexpected argument/);
  const parsed = parsePanelDesktopArguments(["/host", "/tmp/r.json", DESIGN_STUDIO_FIDELITY_FLAG, "--app", "design-studio",
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
  const { buildDesignStudioFidelityFixtures, FIDELITY_FIXTURE_PATHS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const codec = await import("../apps/design-studio/app/document.mjs");
  const metrics = await import("../apps/design-studio/app/text-metrics.mjs");
  const fixtures = buildDesignStudioFidelityFixtures({ codec, textMetrics: metrics });
  assert.deepEqual(fixtures.map(value => value.relativePath).sort(), Object.values(FIDELITY_FIXTURE_PATHS).sort());
  for (const fixture of fixtures) {
    assert.match(fixture.relativePath, /^designs\/host-fidelity-[a-z0-9-]+\.codesign\.json$/);
    const parsed = JSON.parse(fixture.bytes);
    const reserialized = codec.serializeDesignDocument(codec.normalizeDesignDocument(parsed));
    assert.equal(reserialized, fixture.bytes, `${fixture.relativePath} is not canonical codec output`);
    assert.equal(fixture.sha256, sha256(fixture.bytes));
  }
  const byPath = new Map(fixtures.map(value => [value.relativePath, codec.normalizeDesignDocument(JSON.parse(value.bytes))]));
  const nodes = document => document.pages.flatMap(page => page.nodes ?? []);
  const flat = path => {
    const document = byPath.get(path);
    const result = [];
    const visit = node => { result.push(node); for (const child of node.children ?? []) visit(child); };
    for (const page of JSON.parse(fixtures.find(value => value.relativePath === path).bytes).pages) page.children.forEach(visit);
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

test("save/reopen stability compares exact serialized bytes and layer identity", async () => {
  const { judgeSaveReopen, FIDELITY_STATUS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const good = { path: "designs/a.codesign.json", saved: fileState("a", 5), resaved: fileState("a", 5), reopened: fileState("a", 5),
    canonicalSha256: hex("a"), saveStateAfterSave: "saved", layerIdsBefore: ["a", "b"], layerIdsAfterReopen: ["a", "b"], dirtyAfterReopen: "idle" };
  assert.equal(judgeSaveReopen(good).status, FIDELITY_STATUS.PASS);
  assert.equal(judgeSaveReopen({ ...good, resaved: fileState("b", 6) }).status, FIDELITY_STATUS.FAIL);
  assert.equal(judgeSaveReopen({ ...good, canonicalSha256: hex("c") }).status, FIDELITY_STATUS.FAIL);
  assert.equal(judgeSaveReopen({ ...good, layerIdsAfterReopen: ["b", "a"] }).status, FIDELITY_STATUS.FAIL);
  assert.equal(judgeSaveReopen({ ...good, dirtyAfterReopen: "dirty" }).status, FIDELITY_STATUS.FAIL);
  assert.equal(judgeSaveReopen({ ...good, saveStateAfterSave: "error" }).status, FIDELITY_STATUS.FAIL);
  assert.equal(judgeSaveReopen({ ...good, reopened: undefined }).status, FIDELITY_STATUS.UNVERIFIED);
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
  assert.deepEqual(plan.map(value => value.id), ["open-without-edit", "immediate-click-after-edit", "low-zoom-fractional-performance",
    "save-reopen-stable", "same-camera-visual", "svg-corner-aa-host"]);
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
  const { buildDesignStudioFidelityFixtures } = await import("../scripts/design-studio-host-fidelity.mjs");
  const fixtures = buildDesignStudioFidelityFixtures({ codec: await import("../apps/design-studio/app/document.mjs"),
    textMetrics: await import("../apps/design-studio/app/text-metrics.mjs") });
  for (const fixture of fixtures) assert.equal(JSON.parse(fixture.bytes).pages.length, 1, fixture.relativePath);
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
    const codec = await import("../apps/design-studio/app/document.mjs");
    const { buildDesignStudioFidelityFixtures } = await import("../scripts/design-studio-host-fidelity.mjs");
    const fixtures = buildDesignStudioFidelityFixtures({ codec, textMetrics: await import("../apps/design-studio/app/text-metrics.mjs") });
    for (const fixture of fixtures) {
      await mkdir(join(directory, dirname(fixture.relativePath)), { recursive: true });
      await writeFile(join(directory, fixture.relativePath), fixture.bytes);
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
  const tryStart = source.indexOf("\ntry {"), finallyStart = source.indexOf("} finally {\n  cleanupReceipt");
  assert.ok(run > tryStart && run < finallyStart, "fidelity must run inside the existing owned-cleanup try/finally");
  assert.match(source.slice(source.lastIndexOf("if (", run), run), /designStudioFidelity/);
  assert.match(source, /HASHED_HOST_BUILD_FILES/);
  const outputs = source.indexOf("assertFidelityOutputsAbsent(reportArgument)");
  assert.ok(outputs > 0 && outputs < temporary, "create-only report/artifact check must precede any temporary HOME");
  assert.doesNotMatch(source, /process\.env\.[A-Z_]*FIDELITY/);
});

test("fidelity outputs are create-only: an existing report or artifacts directory is refused before launch", async () => {
  const { assertFidelityOutputsAbsent } = await import("../scripts/design-studio-host-fidelity.mjs");
  const directory = await scratch("ds-fidelity-output-");
  try {
    const report = join(directory, "report.json");
    assert.deepEqual(await assertFidelityOutputsAbsent(report), { reportPath: report, artifactsDirectory: `${report}.artifacts` });
    await mkdir(`${report}.artifacts`);
    await assert.rejects(assertFidelityOutputsAbsent(report), /already exists/);
    await rm(`${report}.artifacts`, { recursive: true });
    await writeFile(report, "{}");
    await assert.rejects(assertFidelityOutputsAbsent(report), /already exists/);
    await assert.rejects(assertFidelityOutputsAbsent(join(repository, ".tmp/x.json")), /outside the repository/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("installed SVG export of the corner-AA fixture maps every probe to exact device geometry", async () => {
  const { buildDesignStudioFidelityFixtures, svgReferenceGeometry, FIDELITY_FIXTURE_PATHS } = await import("../scripts/design-studio-host-fidelity.mjs");
  const codec = await import("../apps/design-studio/app/document.mjs");
  const fixture = buildDesignStudioFidelityFixtures({ codec, textMetrics: await import("../apps/design-studio/app/text-metrics.mjs") })
    .find(value => value.relativePath === FIDELITY_FIXTURE_PATHS.svgCornerAa);
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
