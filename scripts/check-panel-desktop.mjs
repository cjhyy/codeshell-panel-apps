/* Real installed packages in Electron's production main/preload/renderer/webview.
 * Requires an already-built, compatible Host checkout; never builds that checkout.
 * Synthetic project data only. No provider/model tasks or credential configuration.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { cleanupPanelDesktopFixture, closeOwnedPanelElectron } from "./panel-desktop-cleanup.mjs";
import { preparePanelDesktopNativeFixture, waitForPanelDesktopIdle } from "./panel-desktop-native-fixture.mjs";
import { prepareManagedNodeNetworkFixture } from "./panel-desktop-managed-node-fixture.mjs";
import { prepareNativeEntryParentObservation, verifyNativeEntryExit } from "./panel-desktop-native-parent.mjs";
import { createOwnedGuestCleanup, prepareFidelityGuest, runDesignStudioHostFidelity, withOwnedFidelityGuest } from "./design-studio-host-fidelity-runner.mjs";
import { HASHED_HOST_BUILD_FILES, buildDesignStudioFidelityFixtures, buildFidelityFailurePartial, claimFidelityOutputs, copyDesignStudioSample,
  describeOwnedCleanup, desktopFixtureSettings, EXTERNAL_AGENT_RUNTIME_BOUNDARY, writeFidelityPartialOnce,
  parsePanelDesktopArguments, preflightPanelDesktopHost } from "./design-studio-host-fidelity.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// --design-studio-fidelity is a technical opt-in only. It is not user approval to
// open a Host window, and no environment variable can enable it.
const { hostArgument, reportArgument, selectedApp, designStudioFidelity } = parsePanelDesktopArguments(process.argv.slice(2));
const packageCases = ["apps/design-studio", "apps/job-hunt-hq", "apps/quant-lab", "apps/video-download", "panels/video-studio", "templates/starter"];
const cases = [];
for (const packagePath of packageCases) {
  const manifest = JSON.parse(await readFile(join(repository, packagePath, ".codeshell-panel/panel.json"), "utf8"));
  if (!selectedApp || manifest.id === selectedApp) cases.push({ packagePath, manifest });
}
assert.ok(cases.length, `unknown --app: ${selectedApp}`);
const hostRoot = resolve(hostArgument);
// Read-only: report every missing built output before any temporary HOME or launch.
// Never builds, downloads or installs Host outputs or managed runtimes.
const hostPreflight = await preflightPanelDesktopHost(hostRoot, { fidelity: Boolean(designStudioFidelity) });
if (!hostPreflight.ok) {
  console.error(hostPreflight.message);
  process.exit(2);
}
for (const warning of hostPreflight.warnings) console.warn(`Host preflight warning: ${warning}`);
// Harness-owned outputs: two O_EXCL|O_NOFOLLOW files in the root-owned system temp
// directory, held open and written only through their handles (no user path).
const fidelityOutputs = designStudioFidelity ? await claimFidelityOutputs() : null;
if (fidelityOutputs) console.log(`Design Studio fidelity outputs: ${fidelityOutputs.reportPath} ${fidelityOutputs.bundlePath}`);
const appDir = join(hostRoot, "packages/desktop");
const hostModule = path => import(pathToFileURL(join(hostRoot, path)).href);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const files = HASHED_HOST_BUILD_FILES;
const buildHashes = Object.fromEntries(await Promise.all(files.map(async path =>
  [path, sha256(await readFile(join(hostRoot, path)))])));
const gitHead = cwd => {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const panelCommit = gitHead(repository), hostSourceCommit = gitHead(hostRoot);
const runnerSha256 = sha256(await readFile(fileURLToPath(import.meta.url)));
const hostSourceManifestVersion = JSON.parse(await readFile(join(appDir, "package.json"), "utf8")).version;
const directory = await mkdtemp(join(tmpdir(), "panel-desktop-ipc-"));
let app, ownedChildProcess, win, report, cleanupReceipt, failure, nativeFixture, nativeParentFixture, managedFixture, launchStarted = false, stage = "initialize";
let fidelityReport = null;
const results = [], rendererErrors = [], busyRejections = [], readRateRejections = [];
try {
  // Scrub arbitrary inherited provider credentials before loading any Host module.
  const { createBunTestEnvironment } = await hostModule("scripts/bun-test-completion.mjs");
  const environment = createBunTestEnvironment(process.env, directory);
  // Host safeProcessEnv deliberately excludes NODE_OPTIONS. Its real NativeEntry
  // executable must enforce the OS boundary itself, including for descendants.
  const fixtureBin = join(environment.HOME, "fixture-bin");
  nativeFixture = await preparePanelDesktopNativeFixture({ directory, binDirectory: fixtureBin,
    nodeExecutable: process.execPath, environment });
  console.log(`NativeEntry OS network self-test: ${JSON.stringify(nativeFixture.selfTest)}`);
  managedFixture = await prepareManagedNodeNetworkFixture({ directory,
    executable: join(appDir, "out/managed-runtimes/node/bin/node") });
  environment.PATH = `${fixtureBin}:${environment.PATH}`;
  for (const key of ["DBUS_SESSION_BUS_ADDRESS", "GNOME_KEYRING_CONTROL", "SECURITYSESSIONID"])
    if (process.env[key]) environment[key] = process.env[key];
  for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
  Object.assign(process.env, environment);
  const isolated = { home: environment.HOME, codeShellHome: environment.CODE_SHELL_HOME,
    userDataDir: join(environment.HOME, "electron-user-data") };
  const nativePaths = Object.fromEntries(["home", "downloads", "documents", "desktop"].map(name =>
    [name, name === "home" ? isolated.home : join(isolated.home, `fixture-${name}`)]));
  for (const path of Object.values(nativePaths)) await mkdir(path, { recursive: true, mode: 0o700 });
  await cp(fixtureBin, join(isolated.userDataDir, "bin"), { recursive: true });
  const nativeNamespace = join(isolated.codeShellHome, "panel-apps");
  await mkdir(nativeNamespace, { recursive: true, mode: 0o700 });
  nativeParentFixture = await prepareNativeEntryParentObservation({ directory, receiptFile: nativeFixture.receiptFile,
    executablePaths: [nativeFixture.wrapper, join(isolated.userDataDir, "bin/node")], namespaceRoot: nativeNamespace,
    packageContentModule: pathToFileURL(join(hostRoot, "packages/core/dist/panel-apps/package-content.js")).href,
    entries: (await Promise.all(cases.map(async ({ packagePath, manifest }) => {
      const manifestSha256 = sha256(await readFile(join(repository, packagePath, ".codeshell-panel/panel.json")));
      return Object.values(manifest.nativeEntries ?? {}).map(entry =>
        ({ appId: manifest.id, entry: entry.entry, sha256: entry.sha256, manifestSha256 }));
    }))).flat() });
  const { prepareConfinedElectronFixture } = await hostModule("packages/desktop/scripts/confined-electron-fixture.mjs");
  const { prepareOwnedElectronControl } = await hostModule("packages/desktop/scripts/owned-electron-control.mjs");
  const { launchCodeShellElectron, findCodeShellWindow } = await hostModule("packages/desktop/scripts/electron-harness.mjs");
  const origin = "http://127.0.0.1:9";
  const guardUrl = pathToFileURL(join(hostRoot, "packages/desktop/scripts/runtime-cost-gui-guard.mjs")).href;
  const fixture = await prepareConfinedElectronFixture({ appDir, isolated, origin, guardModule: guardUrl });
  const guardLog = join(isolated.home, "cost-gui-guard.jsonl");
  fixture.env.CODESHELL_COST_GUI_GUARD_LOG = guardLog;
  Object.assign(process.env, { CODESHELL_COST_SMOKE_ORIGIN: origin,
    CODESHELL_COST_SMOKE_HOME_ID: sha256(isolated.home), CODESHELL_COST_GUI_GUARD_LOG: guardLog });
  // Only inspector endpoints observed from this exact owned Electron child may bypass
  // the parent's deny-all HTTP guard. No general localhost exemption.
  const inspectorLog = join(isolated.home, "owned-control.jsonl");
  const control = prepareOwnedElectronControl({ appDir, mainEntry: fixture.mainEntry,
    home: isolated.home, receiptFile: inspectorLog });
  await import(guardUrl);
  control.activate();
  // Chromium is separate from the Node guard. Cancel HTTP(S) for every newly-created
  // Electron session before production Main loads; cspanel/file assets remain real.
  let bootstrap = await readFile(fixture.mainEntry, "utf8");
  const mainImport = `await import(${JSON.stringify(pathToFileURL(join(appDir, "out/main/index.mjs")).href)});`;
  assert.ok(bootstrap.includes(mainImport), "Host fixture bootstrap contract changed");
  // Install inside Main before the existing confined fixture captures spawn.
  // Its worker guard then calls this OS seam with the original Node argv.
  const captureSpawn = "const spawn = children.spawn;";
  assert.equal(bootstrap.split(captureSpawn).length, 2, "Host fixture spawn seam changed");
  bootstrap = bootstrap.replace(captureSpawn, nativeParentFixture.bootstrap + managedFixture.bootstrap + captureSpawn);
  bootstrap = bootstrap.replace(mainImport, `for (const [name, path] of Object.entries(${JSON.stringify(nativePaths)})) app.setPath(name, path);
app.on("session-created", session => {
  session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, done) => done({ cancel: true }));
});\n${mainImport}`);
  await writeFile(fixture.mainEntry, bootstrap);
  const projects = [join(isolated.home, "desktop-A"), join(isolated.home, "desktop-B")];
  // Design Studio fidelity uses its own private project so the generic A/B
  // storage, update and restore assertions are unchanged.
  const fidelityProject = designStudioFidelity ? join(isolated.home, "desktop-fidelity") : null;
  if (fidelityProject) projects.push(fidelityProject);
  for (const project of projects) await mkdir(project);
  let fidelitySeed = null;
  if (fidelityProject) {
    stage = "design-studio fidelity: seed synthetic fixtures";
    // Same source bytes that the reviewed install below copies from apps/design-studio.
    const studioApp = join(repository, "apps/design-studio/app");
    const fixtures = await buildDesignStudioFidelityFixtures({
      codec: await import(pathToFileURL(join(studioApp, "document.mjs")).href),
      textMetrics: await import(pathToFileURL(join(studioApp, "text-metrics.mjs")).href),
      documentIndex: await import(pathToFileURL(join(studioApp, "document-index.mjs")).href) });
    const seededStates = {};
    // Every file (single documents, index manifests and page parts) fits one Host readText.
    for (const fixture of fixtures) for (const file of fixture.files) {
      const path = join(fidelityProject, file.relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.bytes, { flag: "wx" });
      const value = await stat(path);
      seededStates[file.relativePath] = { sha256: file.sha256, mtimeMs: value.mtimeMs, size: value.size };
    }
    const sampleReceipt = designStudioFidelity.samplePath
      ? await copyDesignStudioSample({ samplePath: designStudioFidelity.samplePath, projectDirectory: fidelityProject }) : null;
    if (sampleReceipt) {
      const value = await stat(join(fidelityProject, sampleReceipt.relativePath));
      seededStates[sampleReceipt.relativePath] = { sha256: sampleReceipt.copySha256, mtimeMs: value.mtimeMs, size: value.size };
    }
    fidelitySeed = { fixtures, seededStates, sampleReceipt };
  }
  await mkdir(join(isolated.codeShellHome, "desktop"), { recursive: true });
  await writeFile(join(isolated.codeShellHome, "desktop/recents.json"), JSON.stringify(
    projects.map(path => ({ path, name: path.split("/").at(-1), lastOpenedAt: Date.now(), pinned: true }))));
  // Legacy gate: exactly { autoUpdates: false }. Fidelity additionally turns off the Host's
  // own external-agent-runtime discovery (see EXTERNAL_AGENT_RUNTIME_BOUNDARY).
  await writeFile(join(isolated.codeShellHome, "settings.json"), JSON.stringify(desktopFixtureSettings({ fidelity: Boolean(designStudioFidelity) })));
  stage = "launch production Electron";
  launchStarted = true;
  app = await launchCodeShellElectron({ appDir, ...isolated, env: fixture.env,
    mainEntry: fixture.mainEntry, runtimeTimeoutMs: 300_000 });
  ownedChildProcess = app.process();
  win = await findCodeShellWindow(app);
  const actualNativePaths = await app.evaluate(({ app }) => Object.fromEntries(
    ["home", "downloads", "documents", "desktop", "userData"].map(name => [name, app.getPath(name)])));
  assert.deepEqual(actualNativePaths, { ...nativePaths, userData: isolated.userDataDir });
  win.on("pageerror", error => rendererErrors.push(error.message));
  await win.setViewportSize({ width: 1440, height: 980 });
  await fixture.assertWorker(app, { requireWorker: false });
  const viewOnly = win.getByRole("button", { name: /仅查看|View only/i });
  if (await viewOnly.waitFor({ state: "visible", timeout: 2000 }).then(() => true, () => false))
    await viewOnly.click();
  for (const project of projects) await win.evaluate(cwd => window.codeshell.setTrust(cwd, "trusted"), project);
  if (await viewOnly.isVisible()) await viewOnly.click();
  await win.getByText("desktop-A", { exact: true }).first().click();
  await fixture.assertWorker(app, { requireWorker: false });

  const ipc = (method, ...args) => win.evaluate(({ method, args }) => window.codeshell[method](...args), { method, args });
  async function whenIdle(id, operation) {
    // Reuse the exact token and preserve refusal fields. An exception is not a
    // structured undispatched BUSY receipt and must never be replayed.
    return waitForPanelDesktopIdle({ id, operation,
      nativeReceipts: async () => (await nativeFixture.receipts()).slice(-24),
      onBusy: async observation => {
        const signature = JSON.stringify(observation.result);
        const previous = busyRejections.find(value => value.id === id && value.stage === stage && value.signature === signature);
        if (previous) { previous.attempts++; previous.lastAt = observation.at; }
        else {
          busyRejections.push({ id, stage, signature, firstAt: observation.at, lastAt: observation.at,
            attempts: 1, result: observation.result, nativeReceipts: observation.nativeReceipts });
          console.log(`Panel change BUSY: ${JSON.stringify({ stage, ...observation })}`);
          await fixture.assertWorker(app, { requireWorker: false });
        }
      },
    });
  }
  const untilGuest = async (guest, source) => {
    const deadline = Date.now() + 30_000;
    while (await guest.execute(source) !== true) {
      if (Date.now() >= deadline) throw new Error(`Guest condition timed out: ${source}; ${await guest.execute("document.body.innerText.slice(-1000)")}`);
      await new Promise(done => setTimeout(done, 100));
    }
  };
  const installWhenIdle = input => whenIdle(input.id, () => ipc("installPanelAppUpdate", input));
  const binding = async (cwd, id) => (await ipc("getPanelAppBindings", cwd)).find(value => value.appId === id);
  async function descriptor(cwd, id) {
    const value = (await ipc("listPanelApps", cwd, "en")).find(value => value.appId === id);
    assert.ok(value, `${id} missing from real Desktop descriptor list`);
    return value;
  }
  async function attach(cwd, id, suffix) {
    const panel = await descriptor(cwd, id);
    const prepared = await ipc("preparePanelApp", panel.id, cwd);
    const elementId = `acceptance-${id}-${suffix}`;
    await win.evaluate(({ prepared, elementId }) => {
      const view = document.createElement("webview");
      view.id = elementId;
      view.setAttribute("partition", prepared.partition);
      view.setAttribute("src", prepared.src);
      Object.assign(view.style, { width: "1024px", height: "720px", position: "fixed", top: "0", left: "0", zIndex: "9999" });
      document.body.appendChild(view);
    }, { prepared, elementId });
    const view = win.locator(`#${elementId}`);
    await win.waitForFunction(elementId => {
      const view = document.getElementById(elementId);
      return typeof view?.getWebContentsId === "function" && view.getWebContentsId() > 0;
    }, elementId);
    const guestId = await view.evaluate(view => view.getWebContentsId());
    await ipc("bindPanelApp", { guestId, appDescriptorId: panel.id, tabId: elementId,
      bucket: "desktop-panel-acceptance", sessionId: "synthetic-acceptance", projectPath: cwd,
      // Quant's visible home automatically starts public live-market collectors.
      // Keep its production lifecycle hidden for this offline package/IPC fixture.
      cwd, visible: id !== "quant-lab", busy: false, theme: "dark", locale: "en" });
    const execute = source => view.evaluate((view, source) => view.executeJavaScript(source), source);
    // A real Main/preload context and the package's own browser module must both load.
    await win.waitForFunction(async elementId => {
      const view = document.getElementById(elementId);
      try { return await view.executeJavaScript("!!window.codeshellPanel && document.readyState === 'complete' && document.body.innerText.length > 20"); }
      catch { return false; }
    }, elementId);
    const context = await execute("window.codeshellPanel.getContext()");
    assert.equal(context.cwd, cwd);
    assert.equal(context.appId, id);
    assert.equal(context.trusted, true);
    const globals = await execute("({node:typeof process,require:typeof require,html:document.documentElement.outerHTML.length, title:document.title})");
    assert.equal(globals.node, "undefined");
    assert.equal(globals.require, "undefined");
    const call = async (method, params) => {
      const deadline = Date.now() + 12_000;
      for (let attempt = 0; ; attempt++) {
        const result = await execute(`window.codeshellPanel.callResult(${JSON.stringify(method)}, ${JSON.stringify(params ?? {})})`);
        const retryAfterMs = result?.error?.retryAfterMs;
        // Read-only assertions share the guest's real startup budget. A structured
        // rate rejection is undispatched; never retry revocation, unknown receipts,
        // other methods or weaken any authority/data assertion below.
        if (method !== "storage.getSnapshot" || result.ok || result.error?.code !== "RATE_LIMITED" ||
            !Number.isFinite(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > 10_000 || attempt >= 3)
          return result;
        const waitMs = Math.max(25, Math.ceil(retryAfterMs) + 25);
        if (Date.now() + waitMs > deadline) return result;
        readRateRejections.push({ appId: id, guest: elementId, method, attempt: attempt + 1, retryAfterMs });
        await new Promise(done => setTimeout(done, waitMs));
      }
    };
    const remove = () => view.evaluate(view => view.remove());
    return { view, execute, call, remove, context, globals, panel, prepared };
  }

  for (const { packagePath, manifest } of cases) {
    const id = manifest.id, [projectA, projectB] = projects;
    stage = `${id}: reviewed install`;
    console.log(stage);
    const source = join(isolated.home, "stable-sources", id);
    await cp(join(repository, packagePath), source, { recursive: true });
    const sourceInput = { kind: "dir", path: source };
    const review = await ipc("previewLocalPanelApp", sourceInput, projectA);
    assert.equal(review.ok, true, JSON.stringify(review));
    assert.deepEqual(review.preview.permissions, manifest.permissions);
    assert.equal(await binding(projectA, id), undefined, "preview changed project binding");
    const installed = await ipc("installLocalPanelApp", { cwd: projectA, source: sourceInput, reviewToken: review.preview.reviewToken });
    assert.equal(installed.ok, true, JSON.stringify(installed));
    const originalA = await binding(projectA, id);
    assert.ok(originalA.bound && originalA.packageDigest);
    const unboundB = await binding(projectB, id);
    assert.equal(unboundB.bound, false);
    await assert.rejects(ipc("preparePanelApp", (await descriptor(projectA, id)).id, projectB), /not bound|未绑定/);
    await ipc("setPanelAppProjectBinding", projectB, id, true, unboundB.revision);
    const originalB = await binding(projectB, id);
    assert.equal(originalB.packageDigest, originalA.packageDigest);
    let jobHuntCli;
    if (id === "job-hunt-hq") {
      // Execute retained, installed Panel bytes before creating any webview.
      // The CLI package owns its own imports and needs no development modules.
      jobHuntCli = (operation, input, revision) => {
        const request = { operation, input, ...(revision === undefined ? {} : { expectedRevision: revision }) };
        const cli = join(isolated.codeShellHome, "panel-apps/.versions", id, originalA.packageDigest, "app/tools/job-hunt-cli.mjs");
        const child = spawnSync(nativeFixture.wrapper, [cli, "--project", projectA], { input: JSON.stringify(request), encoding: "utf8", timeout: 30_000, env: environment });
        assert.equal(child.status, 0, child.stderr + child.stdout);
        const receipt = JSON.parse(child.stdout);
        assert.equal(receipt.ok, true, child.stdout);
        return receipt;
      };
      const initial = jobHuntCli("get_job_search_context", { scope: "summary" });
      assert.equal(initial.revision, null);
      const sourceSaved = jobHuntCli("save_candidate_context", { source: { id: "career-source-desktop", provider: "user", title: "CLI saved before UI", excerpt: "Synthetic account of a recoverable save decision." } }, null);
      jobHuntCli("save_candidate_context", { library_version: { action: "save", id: "career-version-desktop", title: "Headless library version" } }, sourceSaved.revision);
      const raw = JSON.parse(await readFile(join(projectA, "job-hunt-panel.json"), "utf8"));
      assert.equal(raw.careerLibraryVersions.length, 1);
      assert.equal(raw.resume?.markdown || "", "");
    }
    stage = `${id}: installed Main/preload/browser entry`;
    const first = await attach(projectA, id, "original-A");
    const second = await attach(projectB, id, "original-B");
    assert.notEqual(first.prepared.partition, second.prepared.partition, "projects reused guest partition");
    let gpuCanvas, emptyManagedService, historyGuestTask;
    if (id === "design-studio") {
      stage = "design-studio: installed CanvasKit under production cspanel CSP";
      assert.equal(first.context.capabilities?.packageAssets?.wasm, true);
      for (const guest of [first, second])
        await untilGuest(guest, 'document.querySelector("#stage-wrap").dataset.rendererStatus === "active"');
      gpuCanvas = await first.execute(`(async () => {
        const response = await fetch(new URL('./canvas/vendor/canvaskit.wasm', location.href));
        const bytes = await response.arrayBuffer();
        let jsEvalRejected = false;
        try { new Function('return 1')(); } catch { jsEvalRejected = true; }
        return { wasmBytes: bytes.byteLength, mime: response.headers.get('content-type'),
          wasmValid: WebAssembly.validate(bytes), jsEvalRejected,
          sceneSvgCount: document.querySelectorAll('#stage-wrap svg').length,
          renderer: document.querySelector('#renderer-state').textContent };
      })()`);
      assert.equal(gpuCanvas.wasmBytes, 7317345);
      assert.equal(gpuCanvas.mime, "application/wasm");
      assert.equal(gpuCanvas.wasmValid, true);
      assert.equal(gpuCanvas.jsEvalRejected, true);
      assert.equal(gpuCanvas.sceneSvgCount, 0);
      assert.equal(gpuCanvas.renderer, "CanvasKit GPU");
      const guestId = await first.view.evaluate(view => view.getWebContentsId());
      const captured = await app.evaluate(async ({ webContents }, guestId) =>
        (await webContents.fromId(guestId).capturePage()).toPNG().toString("base64"), guestId);
      const pixels = PNG.sync.read(Buffer.from(captured, "base64"));
      const colors = new Set();
      for (let i = 0; i < pixels.data.length; i += 4)
        colors.add(pixels.data.readUInt32BE(i));
      assert.ok(colors.size > 32, "installed GPU panel must present nonblank pixels");
      gpuCanvas.capture = { sha256: sha256(Buffer.from(captured, "base64")),
        width: pixels.width, height: pixels.height, distinctColors: colors.size };
      if (designStudioFidelity && fidelityProject) {
        stage = "design-studio fidelity: real Host scenarios";
        const unboundFidelity = await binding(fidelityProject, id);
        await ipc("setPanelAppProjectBinding", fidelityProject, id, true, unboundFidelity.revision);
        const fidelityGuest = await attach(fidelityProject, id, "fidelity");
        // Shared, idempotent and bounded: the runner's timeout path and this finally.
        const guestCleanup = createOwnedGuestCleanup(fidelityGuest);
        // Unsettled guest/reference work or a failed/pending remove is handed to the existing
        // owned Electron cleanup (captured ChildProcess only); any original failure is kept.
        // The single partial (with the real owned-cleanup outcome) is written after it.
        await withOwnedFidelityGuest(guestCleanup, async () => {
          // Bounded readiness and webContents id; a hung guest goes to the shared cleanup.
          const { guestWebContentsId } = await prepareFidelityGuest({ guest: fidelityGuest, guestCleanup,
            readySource: 'document.querySelector("#stage-wrap").dataset.rendererStatus === "active"' });
          const core = await hostModule("packages/core/dist/index.js");
          const selected = (await core.listProjectPanelApps(fidelityProject, id)).find(value => value.id === id);
          assert.ok(selected?.installPath, "installed Design Studio package path not found for the fidelity project");
          fidelityReport = await runDesignStudioHostFidelity({ enabled: true, guest: fidelityGuest, guestCleanup,
            guestWebContentsId, app,
            projectDirectory: fidelityProject, packageDirectory: selected.installPath, fixtures: fidelitySeed.fixtures,
            seededStates: fidelitySeed.seededStates, sampleReceipt: fidelitySeed.sampleReceipt,
            artifactSink: fidelityOutputs, probe: designStudioFidelity.probe, log: message => console.log(message) });
          fidelityReport.installedPackageDigest = selected.packageDigest;
          console.log(`Design Studio fidelity summary: ${JSON.stringify(fidelityReport.summary)}`);
        }, { requiresOwnedHostCleanup: () => Boolean(fidelityReport?.cleanup?.requiresOwnedHostCleanup) });
        if (fidelityReport) Object.assign(fidelityReport, { guestCleanup: guestCleanup.state(), boundaries: { externalAgentRuntime: EXTERNAL_AGENT_RUNTIME_BOUNDARY } });
      }
    }
    const interaction = {
      "design-studio": `(() => { const label = document.getElementById("zoom-value"); const before = label.textContent; document.getElementById("zoom-in").click(); return label.textContent !== before; })()`,
      "job-hunt-hq": `(() => { const tab = document.querySelector('[data-view-target="resumes"]'); tab.click(); return tab.classList.contains("active"); })()`,
      "quant-lab": `(() => { const tab = document.getElementById("module-tab-holdings"); tab.click(); return tab.getAttribute("aria-selected") === "true"; })()`,
      "video-download": `(() => { const tab = document.getElementById("tab-history"); tab.click(); return tab.getAttribute("aria-selected") === "true"; })()`,
      "video-studio": `document.getElementById("studio").children.length > 0`,
      "starter-panel": `(() => { document.getElementById("increment").click(); return document.getElementById("count").textContent.includes("1"); })()`,
    }[id];
    // Static HTML plus the bridge is insufficient evidence that package modules ran.
    await win.waitForFunction(async ({ elementId, interaction }) => {
      try { return await document.getElementById(elementId).executeJavaScript(interaction); }
      catch { return false; }
    }, { elementId: `acceptance-${id}-original-A`, interaction });
    if (id === "job-hunt-hq") {
      stage = "job-hunt-hq: retained CLI and real UI share native commits";
      await first.execute("document.querySelector('[data-view-target=career]').click()");
      await untilGuest(first, "document.querySelector('#career-list').textContent.includes('CLI saved before UI') && !document.querySelector('.app-shell').inert");
      await first.execute(`(() => {
        document.querySelector('[data-career-record="career-source-desktop"]').click();
        const field = document.querySelector('[data-career-field="title"]');
        field.value = 'UI saved through native CLI'; field.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-career-action="save"]').click();
      })()`);
      await untilGuest(first, "document.querySelector('#career-message').textContent.startsWith('已保存到项目')");
      const fromUi = jobHuntCli("get_job_search_context", { scope: "career_sources", source_id: "career-source-desktop" });
      assert.equal(fromUi.result.sourceMaterials.items[0].title, "UI saved through native CLI", JSON.stringify({ record: fromUi.result.sourceMaterials.items[0], guest: await first.execute("({message:document.querySelector('#career-message').textContent,title:document.querySelector('[data-career-field=title]').value,sync:document.querySelector('#project-snapshot-state').textContent})") }));
      jobHuntCli("save_candidate_context", { qa: { id: "career-qa-desktop", question: "CLI update after UI", answer: "Synthetic actual answer remains separate from its draft expression." } }, fromUi.revision);
      await first.execute("window.dispatchEvent(new Event('focus'))");
      await untilGuest(first, "document.body.innerText.includes('检测到项目数据更新')");
      await first.execute("document.querySelector('[data-career-kind=qa]').click()");
      assert.equal(await first.execute("document.querySelector('#career-list').textContent.includes('CLI update after UI')"), true);
    }
    if (id === "quant-lab") {
      stage = "quant-lab: actual managed service with empty subscriptions";
      assert.equal(first.context.capabilities?.services?.version, 1);
      assert.ok(first.context.availableMethods?.includes("services.setDesired"));
      const serviceCall = async (method, params) => {
        const receipt = await first.call(`services.${method}`, { name: "market-feed", ...params });
        assert.equal(receipt.ok, true, JSON.stringify(receipt));
        return receipt.value;
      };
      // The normal worker config has no symbols, so its quote round cannot
      // invoke a provider. desired=always deliberately exercises service drain
      // during the unchanged publication failure/update/exact restore sequence.
      const before = await serviceCall("get", {});
      const config = { format: "quant.market-feed.config/1", subscriptions: [],
        cadence: { open: 15000, closed: 300000 },
        budgets: { batch: 4, batchDeadlineMs: 8000, perSourceMs: 6000, roundBudgetMs: 30000 } };
      const configured = await serviceCall("configure", { config,
        expectedConfigRevision: before.configRevision, requestKey: "desktop-empty-config" });
      const attached = await serviceCall("attach", {});
      assert.equal(typeof attached.attachId, "string");
      await first.execute(`(() => {
        window.__desktopEmptyService = { state: null };
        window.__desktopEmptyService.unsubscribe = window.codeshellPanel.on("services.changed", event => {
          if (event.name === "market-feed") window.__desktopEmptyService.state = event.state;
        });
        return true;
      })()`);
      const desired = await serviceCall("setDesired", { desired: "always",
        expectedRevision: before.desiredRevision, requestKey: "desktop-empty-always" });
      await untilGuest(first, 'window.__desktopEmptyService.state?.phase === "running"');
      const running = await first.execute(`(() => {
        const value = window.__desktopEmptyService;
        value.unsubscribe(); delete window.__desktopEmptyService;
        return value.state;
      })()`);
      assert.equal(running.desired, "always");
      assert.ok(running.generation > 0);
      emptyManagedService = { config, before, configured, attached, desired, running };

      stage = "quant-lab: real Guest bounded local history repair task";
      // Use B's existing Guest so this extra task proof has its own real call
      // budget while A retains the always service and the original assertions.
      const historyGuest = second, historyProject = projectB;
      for (const permission of ["process", "resources", "storage"])
        assert.ok(manifest.permissions.includes(permission), `reviewed Quant is missing ${permission}`);
      const requiredMethods = ["filesystem.getKnownDirectory", "tasks.start", "tasks.find", "tasks.get", "tasks.list", "tasks.cancel",
        "storage.getSnapshot", "storage.compareAndSet"];
      for (const method of requiredMethods)
        assert.ok(historyGuest.context.availableMethods.includes(method), `real Quant Guest is missing ${method}`);
      const directoryReceipt = await historyGuest.call("filesystem.getKnownDirectory", { name: "app-data" });
      assert.equal(directoryReceipt.ok, true, JSON.stringify(directoryReceipt));
      assert.equal(typeof directoryReceipt.value.handle, "string");
      // Only the actual Guest authority supplies this path. Never infer the
      // Host's app-data layout, even inside a private fixture.
      const dataRoot = await realpath(directoryReceipt.value.path);
      const userDataRoot = await realpath(actualNativePaths.userData);
      const insideUserData = relative(userDataRoot, dataRoot);
      assert.ok(insideUserData && insideUserData !== ".." && !insideUserData.startsWith(`..${sep}`) && !isAbsolute(insideUserData),
        "Guest app-data grant escaped the actual private Electron userData");
      const core = await hostModule("packages/core/dist/index.js");
      const selected = (await core.listProjectPanelApps(historyProject, id)).find(value => value.id === id);
      assert.equal(selected?.packageDigest, originalB.packageDigest);
      const cacheModule = join(selected.installPath, "app/tools/a-share-history-cache.mjs");
      const cache = await import(pathToFileURL(cacheModule).href);
      const { resolveLibraryRoot } = await import(pathToFileURL(join(selected.installPath, "app/tools/native-data-context.mjs")).href);
      // A fresh Panel-owned library keeps the repair separate from the default
      // library and startup observers. No symbol or provider input is seeded.
      const libraryId = sha256(`desktop-offline-history:${directory}`).slice(0, 32);
      const libraryRoot = await resolveLibraryRoot(dataRoot, libraryId, { create: true });
      assert.equal(await cache.readHistoryManifest(libraryRoot), null);
      assert.equal(await cache.readActiveHistoryRunState(libraryRoot), null);
      const seedManifest = { schemaVersion: 1, kind: "a-share-history-library", scope: "core", limit: 120,
        source: "tencent-ifzq", adjust: "qfq", updatedAt: "2026-10-28T00:00:00Z", marketDate: "2026-10-28",
        total: 120, ready: 0, failed: 0, bars: 0, storageBytes: 0, records: [] };
      const seedReceipt = await cache.writeHistoryManifest(seedManifest, libraryRoot);
      const client = await historyGuest.execute(`(async () => {
        const { createHistoryBatchClient } = await import(new URL("./modules/history-batch-client.mjs", location.href).href);
        const context = await window.codeshellPanel.getContext(), calls = [];
        const history = createHistoryBatchClient({ contextState: () => context, currentEpoch: () => 1,
          hostCall: async (method, params) => {
            calls.push({ method, params });
            const receipt = await window.codeshellPanel.callResult(method, params);
            if (!receipt.ok) throw new Error(JSON.stringify(receipt));
            return receipt.value;
          } });
        const supported = history.supports();
        const restored = await history.restore({ libraryId: ${JSON.stringify(libraryId)} });
        const state = window.__desktopHistoryTask = { events: [], startedId: null };
        state.unsubscribe = window.codeshellPanel.on("tasks.changed", event => {
          if (event.entry?.name === "quant-history-batch") state.events.push(event);
        });
        return { supported, restored, calls };
      })()`);
      assert.equal(client.supported, true, "actual history client rejected the real Guest capabilities");
      assert.equal(client.restored, null, "fresh local repair library already had a task intent");
      assert.deepEqual(client.calls.map(value => value.method), ["storage.getSnapshot"]);
      const taskCall = async (method, params) => {
        const receipt = await historyGuest.call(`tasks.${method}`, params);
        assert.equal(receipt.ok, true, JSON.stringify(receipt));
        return receipt.value;
      };
      const request = { entry: "quant-history-batch", requestKey: `desktop-offline-history:${libraryId}`, recovery: "retry",
        input: { request: { scope: "core", source: "tencent-ifzq", maxItems: 20, repair: true, libraryId },
          directoryArguments: [{ argumentName: "--data-dir", directory: "app-data" }] } };
      assert.equal(await taskCall("find", { requestKey: request.requestKey }), null);
      const historyStarts = async () => (await nativeFixture.receipts()).filter(value =>
        value.event === "entry-start" && value.entry?.endsWith("/app/tools/history-batch.mjs"));
      const startsBefore = await historyStarts();
      const started = await taskCall("start", request);
      assert.equal(typeof started.id, "string");
      await historyGuest.execute(`window.__desktopHistoryTask.startedId = ${JSON.stringify(started.id)}; true`);
      await untilGuest(historyGuest, 'window.__desktopHistoryTask.events.some(event => event.id === window.__desktopHistoryTask.startedId && ["succeeded", "failed", "cancelled", "interrupted"].includes(event.status))');
      const terminal = await taskCall("get", { id: started.id });
      assert.equal(terminal.status, "succeeded", JSON.stringify(terminal));
      assert.equal(terminal.attempt, 1);
      assert.ok(Number.isFinite(terminal.completedAt));
      assert.equal(terminal.error, undefined);
      assert.deepEqual(terminal.scope, { appId: id, projectPath: historyProject, revision: historyGuest.panel.revision });
      assert.deepEqual(terminal.package, { version: manifest.version, packageDigest: originalB.packageDigest });
      assert.deepEqual(terminal.entry, { name: request.entry, sha256: manifest.nativeEntries[request.entry].sha256 });
      assert.equal(terminal.input.request.repair, true);
      assert.equal(terminal.result.batchLimit, 20);
      assert.equal(terminal.result.scope, "core");
      assert.equal(terminal.result.source, "tencent-ifzq");
      assert.equal(terminal.result.running, false);
      const found = await taskCall("find", { requestKey: request.requestKey });
      const reused = await taskCall("start", request);
      for (const receipt of [started, terminal, found, reused]) {
        assert.equal(receipt.id, started.id);
        assert.equal(receipt.requestKey, request.requestKey);
      }
      assert.equal(reused.status, "succeeded");
      assert.equal(reused.attempt, 1);
      const listed = await taskCall("list", { limit: 50 });
      assert.equal(listed.filter(value => value.requestKey === request.requestKey).length, 1);
      const startsAfter = await historyStarts();
      assert.equal(startsAfter.length, startsBefore.length + 1, "same requestKey spawned another NativeEntry");
      const execution = startsAfter.at(-1);
      assert.equal(execution.entrySha256, terminal.entry.sha256);
      const exit = (await nativeFixture.receipts()).find(value => value.event === "entry-exit" && value.pid === execution.pid);
      assert.equal(exit?.code, 0, "successful Guest task lacks its actual NativeEntry exit receipt");
      const persisted = await cache.readHistoryManifest(libraryRoot);
      assert.equal(persisted.scope, "core");
      assert.deepEqual(persisted.records, []);
      assert.equal(persisted.bars, 0);
      assert.equal(await cache.readActiveHistoryRunState(libraryRoot), null);
      const events = await historyGuest.execute(`(() => {
        const value = window.__desktopHistoryTask;
        value.unsubscribe(); delete window.__desktopHistoryTask;
        return value.events;
      })()`);
      historyGuestTask = { requiredMethods, directoryReceipt, actualUserData: actualNativePaths.userData, libraryId,
        seedManifest, seedReceipt, seedModuleSha256: sha256(await readFile(cacheModule)), client, request,
        started, terminal, found, reused, listed, events, execution, exit, nativeExecutions: 1,
        limitation: "Actual client supports/empty restore and Guest tasks repair only; client.run/maintenance UI and online initialization are not exercised" };
    }
    const markerKey = "desktop-acceptance-marker";
    if (manifest.permissions.includes("storage")) {
      const saved = await first.call("storage.compareAndSet", { key: markerKey, expectedRevision: null, value: { project: "A", synthetic: true }, cwd: projectB, projectPath: projectB });
      assert.equal(saved.ok, true, JSON.stringify(saved));
      assert.equal(saved.value.updated, true);
      const empty = await second.call("storage.getSnapshot", { key: markerKey });
      assert.equal(empty.ok, true);
      assert.equal(empty.value.revision, null, "guest-supplied project override escaped storage scope");
      const stale = await first.call("storage.compareAndSet", { key: markerKey, expectedRevision: null, value: "must not overwrite" });
      assert.equal(stale.ok, true);
      assert.equal(stale.value.updated, false);
    } else {
      const denied = await first.call("storage.get", { key: markerKey });
      assert.equal(denied.ok, false, "undeclared storage permission was granted");
    }
    const permissionDenied = await first.call("acceptance.unsupported", {});
    assert.equal(permissionDenied.ok, false);
    const networkDenied = await first.execute("fetch('https://example.invalid/desktop-acceptance').then(()=>false,()=>true)");
    assert.equal(networkDenied, true);
    if (id === "starter-panel") {
      assert.equal(await first.execute("document.getElementById('workspace').textContent"), projectA);
    }
    stage = `${id}: failed update preserves authority and data`;
    const updateReview = await ipc("previewPanelAppUpdate", id, projectA, originalA.revision);
    assert.equal(updateReview.ok, true, JSON.stringify(updateReview));
    const entryFile = join(source, manifest.entry), originalEntry = await readFile(entryFile, "utf8");
    await writeFile(entryFile, `${originalEntry}\n<!-- synthetic acceptance candidate: changed after review -->\n`);
    const rejected = await installWhenIdle({ cwd: projectA, id, reviewToken: updateReview.preview.reviewToken });
    assert.equal(rejected.ok, false, "changed reviewed source update succeeded");
    assert.match(rejected.error, /review|审阅|变化|改变|重新/i, "update failed for an unrelated reason");
    assert.equal((await binding(projectA, id)).packageDigest, originalA.packageDigest);
    assert.equal((await binding(projectB, id)).packageDigest, originalB.packageDigest);
    if (manifest.permissions.includes("storage")) {
      const retained = await first.call("storage.getSnapshot", { key: markerKey });
      assert.equal(retained.ok, true, "failed update revoked live old guest");
      assert.equal(retained.value.value.project, "A");
    }
    // Same-version package changes exercise digest isolation without changing any
    // checked-in manifest, version or permission. The candidate is private only.
    stage = `${id}: project update and exact-package restore`;
    const candidateReview = await ipc("previewPanelAppUpdate", id, projectA, (await binding(projectA, id)).revision);
    assert.equal(candidateReview.ok, true, JSON.stringify(candidateReview));
    // A real filesystem publication failure after package staging must preserve
    // both selected versions and the old live guest. Only this owned store is chmod'd.
    assert.notEqual(process.getuid?.(), 0, "filesystem failure fixture must not run as root");
    const versionStore = join(isolated.codeShellHome, "panel-apps/.versions", id);
    await chmod(versionStore, 0o500);
    let diskFailure;
    try {
      diskFailure = await installWhenIdle({ cwd: projectA, id, reviewToken: candidateReview.preview.reviewToken });
    } finally {
      await chmod(versionStore, 0o700);
    }
    assert.equal(diskFailure.ok, false, "read-only retained store update unexpectedly succeeded");
    assert.match(diskFailure.error, /EACCES.*rename/, "publication failed before the staged rename");
    assert.equal((await binding(projectA, id)).packageDigest, originalA.packageDigest);
    assert.equal((await binding(projectB, id)).packageDigest, originalB.packageDigest);
    if (manifest.permissions.includes("storage"))
      assert.equal((await first.call("storage.getSnapshot", { key: markerKey })).value.value.project, "A");
    const updated = await installWhenIdle({ cwd: projectA, id, reviewToken: candidateReview.preview.reviewToken });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    assert.match(updated.packageDigest, /^[a-f0-9]{64}$/u, "reviewed update must return its exact installed payload");
    const currentA = await binding(projectA, id);
    const currentB = await binding(projectB, id);
    assert.equal(currentA.packageDigest, updated.packageDigest);
    assert.notEqual(currentA.packageDigest, originalA.packageDigest);
    assert.equal(currentA.version, originalA.version);
    // Current Host contract: a catalog install/update supersedes every older
    // project pin. A later reviewed restore pins only that selected project.
    // Assert exact payloads on both sides of each transition, including B.
    assert.equal(currentB.packageDigest, updated.packageDigest);
    assert.equal(currentB.version, originalB.version);
    const current = await attach(projectA, id, "candidate-A");
    const advancedB = await attach(projectB, id, "candidate-B");
    assert.notEqual(current.prepared.partition, first.prepared.partition);
    assert.notEqual(advancedB.prepared.partition, second.prepared.partition);
    if (manifest.permissions.includes("storage")) {
      const revoked = await first.call("storage.get", { key: markerKey }).catch(error => ({ ok: false, destroyed: String(error) }));
      assert.equal(revoked.ok, false, "updated project's old guest kept authority");
      const revokedB = await second.call("storage.get", { key: markerKey }).catch(error => ({ ok: false, destroyed: String(error) }));
      assert.equal(revokedB.ok, false, "global update left the other project's old guest authorized");
      assert.equal((await current.call("storage.getSnapshot", { key: markerKey })).value.value.project, "A");
      assert.equal((await advancedB.call("storage.getSnapshot", { key: markerKey })).value.revision, null, "global package update contaminated the other project's storage");
    }
    const restoreReviewB = await ipc("previewPanelAppRestore", projectB, id, originalB.packageDigest, currentB.revision);
    assert.equal(restoreReviewB.packageDigest, originalB.packageDigest);
    const restoredB = await whenIdle(id, () => ipc("restorePanelAppPackage", projectB, restoreReviewB.reviewToken));
    assert.equal(restoredB.ok, true, JSON.stringify(restoredB));
    assert.equal(restoredB.id, id);
    assert.equal(restoredB.packageDigest, originalB.packageDigest);
    assert.equal((await binding(projectB, id)).packageDigest, originalB.packageDigest);
    assert.equal((await binding(projectA, id)).packageDigest, updated.packageDigest, "restoring B changed A's exact candidate selection");
    const retainedB = await attach(projectB, id, "restored-B");
    if (manifest.permissions.includes("storage")) {
      const revokedB = await advancedB.call("storage.get", { key: markerKey }).catch(error => ({ ok: false, destroyed: String(error) }));
      assert.equal(revokedB.ok, false, "B's candidate guest survived its reviewed restore");
      assert.equal((await retainedB.call("storage.getSnapshot", { key: markerKey })).value.revision, null);
      assert.equal((await current.call("storage.getSnapshot", { key: markerKey })).value.value.project, "A", "B's restore revoked or contaminated A");
    }
    const history = await ipc("getPanelAppPackageHistory", projectA, id, currentA.revision);
    assert.ok(history.versions.some(value => value.packageDigest === originalA.packageDigest));
    const restoreReview = await ipc("previewPanelAppRestore", projectA, id, originalA.packageDigest, currentA.revision);
    assert.equal(restoreReview.packageDigest, originalA.packageDigest);
    const restored = await whenIdle(id, () => ipc("restorePanelAppPackage", projectA, restoreReview.reviewToken));
    assert.equal(restored.ok, true, JSON.stringify(restored));
    assert.equal(restored.id, id);
    assert.equal(restored.packageDigest, originalA.packageDigest);
    assert.equal((await binding(projectA, id)).packageDigest, originalA.packageDigest);
    assert.equal((await binding(projectB, id)).packageDigest, originalB.packageDigest);
    const rolledBack = await attach(projectA, id, "restored-A");
    if (manifest.permissions.includes("storage")) {
      const revokedA = await current.call("storage.get", { key: markerKey }).catch(error => ({ ok: false, destroyed: String(error) }));
      assert.equal(revokedA.ok, false, "A's candidate guest survived its reviewed restore");
      assert.equal((await rolledBack.call("storage.getSnapshot", { key: markerKey })).value.value.project, "A");
      assert.equal((await retainedB.call("storage.getSnapshot", { key: markerKey })).value.revision, null, "restoring A revoked or contaminated B");
    }
    results.push({ id, version: manifest.version, permissions: manifest.permissions,
      ...(gpuCanvas ? { gpuCanvas } : {}),
      ...(emptyManagedService ? { emptyManagedService } : {}),
      ...(historyGuestTask ? { historyGuestTask } : {}),
      originalDigest: originalA.packageDigest, privateCandidateDigest: currentA.packageDigest,
      restoreReceipts: { projectA: restored, projectB: restoredB },
      rejectedUpdateError: rejected.error,
      stagedPublicationError: diskFailure.error,
      hostVisibleContext: id !== "quant-lab",
      loadedTitle: first.globals.title, actualEntryHtmlBytes: first.globals.html,
      checks: ["review-install-ipc", "unbound-project-denied", "real-sandboxed-entry-and-package-module", "project-partition-isolation",
        manifest.permissions.includes("storage") ? "real-storage-cas-and-project-authority" : "undeclared-storage-denied",
        "changed-review-update-rejected-old-guest-and-data-preserved", "same-version-global-update-exact-digest-in-both-projects",
        "reviewed-other-project-restore-preserves-current-project-digest-and-authority",
        "staged-package-rename-eacces-preserves-old-guest-and-data",
        "exact-retained-package-restore-ipc", "chromium-http-denied",
        ...(historyGuestTask ? ["real-guest-reviewed-history-repair-task-and-request-key-reuse"] : []),
        ...(id === "job-hunt-hq" ? ["headless-retained-package-cli-before-webview", "ui-native-cli-root-commit", "external-cli-update-focus-reload"] : [])] });
    for (const guest of [first, second, current, advancedB, retainedB, rolledBack]) await guest.remove().catch(() => {});
    console.log(`PASS ${id}: real Electron install/load/IPC, project isolation, rejected update, digest update and restore`);
    await fixture.assertWorker(app, { requireWorker: false });
  }
  assert.deepEqual(rendererErrors, []);
  const guardReceipts = (await readFile(guardLog, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(guardReceipts.some(value => value.pid === process.pid && value.negativeProbes === 7));
  assert.ok(guardReceipts.some(value => value.pid === app.process().pid && value.negativeProbes === 7));
  const keychainReceipt = JSON.parse(await readFile(join(isolated.home, "electron-keychain-context.json"), "utf8"));
  const runtime = await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch }));
  await closeOwnedPanelElectron({ app, ownedChildProcess }); app = undefined;
  const nativeReceipts = await nativeFixture.receipts();
  const managedReceipts = await managedFixture.receipts();
  const managedSpawns = managedReceipts.filter(value => value.event === "spawn");
  const managedCustody = managedReceipts.filter(value => value.event === "custody" && value.frame.t === "custody");
  const managedMembers = managedReceipts.filter(value => value.event === "custody" && value.frame.t === "member");
  const managedCloses = managedReceipts.filter(value => value.event === "close");
  if (cases.some(({ manifest }) => manifest.id === "quant-lab")) {
    for (const [name, values] of Object.entries({ managedSpawns, managedCustody, managedMembers, managedCloses }))
      assert.ok(values.length > 0, `${name} must exercise an actual managed guardian, not only Node probes`);
  }
  for (const value of managedMembers) {
    assert.ok(managedCustody.some(guardian => guardian.pid === value.pid && guardian.frame.pid === value.pid));
    let absent = false;
    try { process.kill(value.frame.pid, 0); } catch (error) { if (error.code === "ESRCH") absent = true; else throw error; }
    assert.equal(absent, true, `Managed member PID remains live or unverified after Electron shutdown: ${value.frame.pid}`);
  }
  const managedExecutionEvidence = { spawns: managedSpawns.length, custody: managedCustody.length,
    members: managedMembers.length, closes: managedCloses.length, membersAbsentAfterShutdown: true };
  for (const launch of managedReceipts.filter(value => value.event === "spawn")) {
    assert.ok(managedReceipts.some(value => value.event === "close" && value.pid === launch.pid),
      `Managed Node guardian lacks its captured close receipt: ${JSON.stringify(launch)}`);
    for (const value of managedReceipts.filter(value => value.event === "custody" && value.pid === launch.pid)) {
      if (value.frame.t === "custody") assert.equal(value.frame.pid, launch.pid, "sandbox exec changed guardian PID");
      if (value.frame.t === "member") assert.notEqual(value.frame.pid, launch.pid);
    }
  }
  stage = "final NativeEntry parent-close and OS-exit verification";
  const nativeExitEvidence = [];
  for (const started of nativeReceipts.filter(value => value.event === "entry-start")) {
    assert.equal(started.nodeOptionsPresent, false, "NativeEntry unexpectedly depended on inherited NODE_OPTIONS");
    const evidence = verifyNativeEntryExit({ started, receipts: nativeReceipts, observation: nativeParentFixture.spec,
      mainPid: ownedChildProcess.pid, selfTest: { pid: nativeFixture.selfTest.pid, entrySha256: nativeFixture.boundary.selfTestScriptSha256 } });
    assert.ok(evidence.exit || evidence.proof === "parent-signal-close", `NativeEntry lacks an exit receipt: ${JSON.stringify(started)}`);
    nativeExitEvidence.push(evidence);
    const selected = cases.find(({ manifest }) => [join(isolated.codeShellHome, "panel-apps/.versions", manifest.id), join(isolated.codeShellHome, "panel-apps", manifest.id)]
      .some(prefix => started.entry?.startsWith(prefix + "/")));
    if (selected) assert.ok(Object.values(selected.manifest.nativeEntries ?? {}).some(entry => started.entry.endsWith(`/${entry.entry}`) && entry.sha256 === started.entrySha256),
      `Executed installed NativeEntry differs from reviewed bytes: ${JSON.stringify(started)}`);
  }
  for (const child of nativeReceipts.filter(value => value.event === "child-start"))
    assert.ok(nativeReceipts.some(value => value.event === "child-exit" && value.pid === child.pid && value.childPid === child.childPid),
      `Observed native child lacks a close receipt: ${JSON.stringify(child)}`);
  if (cases.some(({ manifest }) => manifest.id === "video-download"))
    for (const name of ["service.mjs", "environment.mjs"])
      assert.ok(nativeReceipts.some(value => value.event === "entry-start" && value.entry?.endsWith(`/app/tools/${name}`)), `Video Download did not execute its actual ${name} through the network sandbox`);
  const inspectorReceipts = (await readFile(inspectorLog, "utf8")).trim().split("\n").map(JSON.parse);
  for (const path of files) assert.equal(sha256(await readFile(join(hostRoot, path))), buildHashes[path], `shared build changed: ${path}`);
  report = { schemaVersion: 1, panelCommit, runnerSha256, hostSourceCommit, hostSourceManifestVersion,
    hostBuildProvenance: "Record the independently established build commit alongside these file hashes; source HEAD/version do not identify existing outputs.",
    buildHashes, runtime, actualNativePaths, guardReceipts, inspectorReceipts, keychainReceipt, busyRejections, readRateRejections,
    selectedApp: selectedApp ?? null, selectedCaseCount: cases.length, hostPreflight,
    ...(designStudioFidelity ? { designStudioFidelity: fidelityReport ?? { status: "NOT_RUN" } } : {}),
    nativeBoundary: nativeFixture.boundary, nativeNetworkSelfTest: nativeFixture.selfTest, nativeReceipts,
    nativeParentBoundary: nativeParentFixture.spec, nativeExitEvidence,
    managedNodeBoundary: managedFixture.spec, managedReceipts, managedExecutionEvidence, results,
    limitations: ["controlled synthetic Desktop acceptance only", "no physical phone or deployed Cloud", "no real provider/account/native media work", "owned curl/wget/yt-dlp/ffmpeg fixtures; NativeEntry Node and descendants use verified macOS deny(network*) wrapper; Quant uses visible:false to suppress live collectors", "Main JS guard and Chromium request denial are separate; both process.find NativeEntry and actual managed Node spawns receive kernel network denial", "package update candidate differs only by a private HTML comment; full historical domain migrations are a separate gate"] };
} catch (error) {
  failure = { error };
  console.error(`Desktop acceptance failed at ${stage}:`, error);
  console.error(`Desktop fixture diagnostics: ${JSON.stringify({ stage, selectedApp: selectedApp ?? null, busyRejections, completedResults: results,
    nativeBoundary: nativeFixture?.boundary, nativeNetworkSelfTest: nativeFixture?.selfTest,
    nativeReceipts: await nativeFixture?.receipts(), nativeParentBoundary: nativeParentFixture?.spec, managedNodeBoundary: managedFixture?.spec,
    managedReceipts: await managedFixture?.receipts() })}`);
  console.error(await win?.locator("body").innerText().catch(() => "renderer unavailable"));
} finally {
  // Owned Electron/HOME cleanup first; a fidelity partial then records its real outcome.
  let ownedCleanupError;
  try { cleanupReceipt = await cleanupPanelDesktopFixture({ app, ownedChildProcess, launchStarted, directory, failure }); }
  catch (error) { ownedCleanupError = error; }
  if (fidelityOutputs && (failure || ownedCleanupError)) {
    const partial = buildFidelityFailurePartial({ stage, failure: failure?.error, fidelityReport, artifacts: fidelityOutputs.artifacts(),
      boundaries: { externalAgentRuntime: EXTERNAL_AGENT_RUNTIME_BOUNDARY },
      cleanup: describeOwnedCleanup({ receipt: cleanupReceipt, error: ownedCleanupError, primaryFailure: failure?.error }) });
    const written = await writeFidelityPartialOnce(fidelityOutputs, partial);
    console.error(`Design Studio fidelity partial report: ${JSON.stringify({ path: fidelityOutputs.reportPath, ...written })}`);
    await fidelityOutputs.close();
  }
  if (ownedCleanupError) throw ownedCleanupError;
}
report.completedAt = new Date().toISOString();
report.cleanup = cleanupReceipt;
if (fidelityOutputs) {
  report.designStudioFidelityOutputs = { reportPath: fidelityOutputs.reportPath, bundlePath: fidelityOutputs.bundlePath,
    identity: fidelityOutputs.identity, rootChain: fidelityOutputs.rootChain, artifacts: fidelityOutputs.artifacts() };
  await fidelityOutputs.writeReport(`${JSON.stringify(report, null, 2)}\n`);
  await fidelityOutputs.close();
} else if (reportArgument) await writeFile(resolve(reportArgument), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(`PASS: ${results.length}/${cases.length} selected real installed Panel Desktop IPC scenarios${selectedApp ? ` (${selectedApp} only)` : " (all six packages)"}; owned Electron exit and HOME cleanup verified`);
if (designStudioFidelity) {
  // Not goal completion: FAIL exits 1; any UNVERIFIED/EVIDENCE_ONLY/not-run exits 3.
  const overall = fidelityReport?.summary?.overall ?? "NOT_RUN";
  console.log(`Design Studio real-Host fidelity: ${overall} (goalComplete=false); see ${fidelityOutputs.reportPath}`);
  if (overall !== "PASS") process.exitCode = overall === "FAIL" ? 1 : 3;
}
