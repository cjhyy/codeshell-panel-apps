/* Real installed packages in Electron's production main/preload/renderer/webview.
 * Requires an already-built, compatible Host checkout; never builds that checkout.
 * Synthetic project data only. No provider/model tasks or credential configuration.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { cleanupPanelDesktopFixture, closeOwnedPanelElectron } from "./panel-desktop-cleanup.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [hostArgument, reportArgument, ...extra] = process.argv.slice(2);
assert.ok(hostArgument && extra.length === 0,
  "usage: node scripts/check-panel-desktop.mjs <built-host-checkout> [new-report.json]");
const hostRoot = resolve(hostArgument);
const appDir = join(hostRoot, "packages/desktop");
const hostModule = path => import(pathToFileURL(join(hostRoot, path)).href);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const files = ["packages/desktop/out/main/index.mjs", "packages/desktop/out/preload/index.cjs",
  "packages/desktop/out/preload/panel-app.cjs", "packages/desktop/out/renderer/index.html",
  "packages/core/dist/panel-apps/installer.js", "packages/server/dist/panels/runtime-services.js"];
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
let app, ownedChildProcess, win, report, cleanupReceipt, failure, launchStarted = false, stage = "initialize";
const results = [], rendererErrors = [];
try {
  // Scrub arbitrary inherited provider credentials before loading any Host module.
  const { createBunTestEnvironment } = await hostModule("scripts/bun-test-completion.mjs");
  const environment = createBunTestEnvironment(process.env, directory);
  // Download performs native version probes on startup. Owned CLI fixtures prevent
  // curl/wget/yt-dlp from reaching a live provider outside the JavaScript guard.
  // The Host still discovers, authorizes and runs these actual subprocesses.
  const fixtureBin = join(environment.HOME, "fixture-bin");
  await mkdir(fixtureBin);
  for (const name of ["curl", "wget", "yt-dlp"]) {
    const version = name === "yt-dlp" ? `case "$*" in *--version*) echo 2026.10.12; exit 0;; esac\n` : "";
    await writeFile(join(fixtureBin, name), `#!/bin/sh\n${version}echo 'Desktop acceptance denies live native network clients' >&2\nexit 77\n`, { mode: 0o700 });
  }
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
  bootstrap = bootstrap.replace(mainImport, `for (const [name, path] of Object.entries(${JSON.stringify(nativePaths)})) app.setPath(name, path);
app.on("session-created", session => {
  session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, done) => done({ cancel: true }));
});\n${mainImport}`);
  await writeFile(fixture.mainEntry, bootstrap);
  const projects = [join(isolated.home, "desktop-A"), join(isolated.home, "desktop-B")];
  for (const project of projects) await mkdir(project);
  await mkdir(join(isolated.codeShellHome, "desktop"), { recursive: true });
  await writeFile(join(isolated.codeShellHome, "desktop/recents.json"), JSON.stringify(
    projects.map(path => ({ path, name: path.split("/").at(-1), lastOpenedAt: Date.now(), pinned: true }))));
  await writeFile(join(isolated.codeShellHome, "settings.json"), JSON.stringify({ autoUpdates: false }));
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
  const busyRejections = [], readRateRejections = [];
  async function whenIdle(id, operation) {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const result = await operation().catch(error => {
        if (!/还有正在提交、排队或运行的任务/.test(String(error))) throw error;
        return { ok: false, error: String(error) };
      });
      if (result.ok || !/还有正在提交、排队或运行的任务/.test(result.error)) return result;
      const previous = busyRejections.find(value => value.id === id);
      if (previous) previous.attempts++;
      else {
        busyRejections.push({ id, error: result.error, attempts: 1 });
        // A lazy worker remains corked until its exact process receipt is verified.
        await fixture.assertWorker(app, { requireWorker: false });
      }
      if (Date.now() >= deadline) throw new Error(`${id} native startup probes did not settle`);
      // Reuse the exact review token: never re-review changed bytes just to retry.
      await new Promise(done => setTimeout(done, 100));
    }
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

  const cases = ["apps/design-studio", "apps/job-hunt-hq", "apps/quant-lab", "apps/video-download", "panels/video-studio", "templates/starter"];
  for (const packagePath of cases) {
    const manifest = JSON.parse(await readFile(join(repository, packagePath, ".codeshell-panel/panel.json"), "utf8"));
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
        const child = spawnSync(process.execPath, [cli, "--project", projectA], { input: JSON.stringify(request), encoding: "utf8", timeout: 30_000, env: environment });
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
    let gpuCanvas;
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
    const currentA = await binding(projectA, id);
    assert.notEqual(currentA.packageDigest, originalA.packageDigest);
    assert.equal(currentA.version, originalA.version);
    assert.equal((await binding(projectB, id)).packageDigest, originalB.packageDigest);
    const current = await attach(projectA, id, "candidate-A");
    assert.notEqual(current.prepared.partition, first.prepared.partition);
    if (manifest.permissions.includes("storage")) {
      const revoked = await first.call("storage.get", { key: markerKey }).catch(error => ({ ok: false, destroyed: String(error) }));
      assert.equal(revoked.ok, false, "updated project's old guest kept authority");
      assert.equal((await current.call("storage.getSnapshot", { key: markerKey })).value.value.project, "A");
      assert.equal((await second.call("storage.getSnapshot", { key: markerKey })).value.revision, null, "other project's retained guest was revoked or contaminated");
    }
    const history = await ipc("getPanelAppPackageHistory", projectA, id, currentA.revision);
    assert.ok(history.versions.some(value => value.packageDigest === originalA.packageDigest));
    const restoreReview = await ipc("previewPanelAppRestore", projectA, id, originalA.packageDigest, currentA.revision);
    const restored = await whenIdle(id, () => ipc("restorePanelAppPackage", projectA, restoreReview.reviewToken));
    assert.equal(restored.packageDigest, originalA.packageDigest);
    const rolledBack = await attach(projectA, id, "restored-A");
    if (manifest.permissions.includes("storage"))
      assert.equal((await rolledBack.call("storage.getSnapshot", { key: markerKey })).value.value.project, "A");
    results.push({ id, version: manifest.version, permissions: manifest.permissions,
      ...(gpuCanvas ? { gpuCanvas } : {}),
      originalDigest: originalA.packageDigest, privateCandidateDigest: currentA.packageDigest,
      rejectedUpdateError: rejected.error,
      stagedPublicationError: diskFailure.error,
      hostVisibleContext: id !== "quant-lab",
      loadedTitle: first.globals.title, actualEntryHtmlBytes: first.globals.html,
      checks: ["review-install-ipc", "unbound-project-denied", "real-sandboxed-entry-and-package-module", "project-partition-isolation",
        manifest.permissions.includes("storage") ? "real-storage-cas-and-project-authority" : "undeclared-storage-denied",
        "changed-review-update-rejected-old-guest-and-data-preserved", "same-version-digest-update-project-only",
        "staged-package-rename-eacces-preserves-old-guest-and-data",
        "exact-retained-package-restore-ipc", "chromium-http-denied",
        ...(id === "job-hunt-hq" ? ["headless-retained-package-cli-before-webview", "ui-native-cli-root-commit", "external-cli-update-focus-reload"] : [])] });
    for (const guest of [first, second, current, rolledBack]) await guest.remove().catch(() => {});
    console.log(`PASS ${id}: real Electron install/load/IPC, project isolation, rejected update, digest update and restore`);
    await fixture.assertWorker(app, { requireWorker: false });
  }
  assert.deepEqual(rendererErrors, []);
  const guardReceipts = (await readFile(guardLog, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(guardReceipts.some(value => value.pid === process.pid && value.negativeProbes === 7));
  assert.ok(guardReceipts.some(value => value.pid === app.process().pid && value.negativeProbes === 7));
  const keychainReceipt = JSON.parse(await readFile(join(isolated.home, "electron-keychain-context.json"), "utf8"));
  const runtime = await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch }));
  await closeOwnedPanelElectron({ app, ownedChildProcess }); app = undefined;
  const inspectorReceipts = (await readFile(inspectorLog, "utf8")).trim().split("\n").map(JSON.parse);
  for (const path of files) assert.equal(sha256(await readFile(join(hostRoot, path))), buildHashes[path], `shared build changed: ${path}`);
  report = { schemaVersion: 1, panelCommit, runnerSha256, hostSourceCommit, hostSourceManifestVersion,
    hostBuildProvenance: "Record the independently established build commit alongside these file hashes; source HEAD/version do not identify existing outputs.",
    buildHashes, runtime, actualNativePaths, guardReceipts, inspectorReceipts, keychainReceipt, busyRejections, readRateRejections, results,
    limitations: ["controlled synthetic Desktop acceptance only", "no physical phone or deployed Cloud", "no real provider/account/native media work", "owned curl/wget/yt-dlp CLI fixtures deny live native network clients; Quant uses visible:false to suppress live collectors", "JS HTTP guard and Chromium request denial are not an OS sandbox", "package update candidate differs only by a private HTML comment; full historical domain migrations are a separate gate"] };
} catch (error) {
  failure = { error };
  console.error(`Desktop acceptance failed at ${stage}:`, error);
  console.error(await win?.locator("body").innerText().catch(() => "renderer unavailable"));
} finally {
  cleanupReceipt = await cleanupPanelDesktopFixture({ app, ownedChildProcess, launchStarted, directory, failure });
}
report.completedAt = new Date().toISOString();
report.cleanup = cleanupReceipt;
if (reportArgument) await writeFile(resolve(reportArgument), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(`PASS: ${results.length}/6 real installed Panel Desktop IPC scenarios; owned Electron exit and HOME cleanup verified`);
