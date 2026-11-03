import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { preparePanelDesktopNativeFixture } from "../scripts/panel-desktop-native-fixture.mjs";
import { installNativeEntryParentObservation, prepareNativeEntryParentObservation, verifyNativeEntryExit } from "../scripts/panel-desktop-native-parent.mjs";

test("actual parent close proves natural, SIGTERM and SIGKILL NativeEntry exits without relying on a child exit callback", { skip: process.platform !== "darwin" }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "panel-native-parent-"));
  let restore;
  const children = [];
  try {
    const env = { HOME: directory, TMPDIR: directory, PATH: "/usr/bin:/bin" };
    const fixture = await preparePanelDesktopNativeFixture({ directory, binDirectory: join(directory, "bin"), nodeExecutable: process.execPath, environment: env });
    const namespaceRoot = join(directory, "panel-apps");
    const entry = join(namespaceRoot, ".versions/fixture-panel", "a".repeat(64), "app/tools/probe.mjs");
    await mkdir(join(entry, ".."), { recursive: true });
    await writeFile(entry, `let input = ""; for await (const chunk of process.stdin) input += chunk;
console.log(JSON.stringify({ pid: process.pid, input: JSON.parse(input) }));
if (process.argv[2] === "hold") setInterval(() => {}, 1000);
`);
    const entrySha256 = createHash("sha256").update(await readFile(entry)).digest("hex");
    const coreRoot = process.env.CODESHELL_PANEL_CORE_PACKAGE;
    assert.ok(coreRoot, "Native parent layout regression requires CODESHELL_PANEL_CORE_PACKAGE pointing at the built Host Core");
    const packageContentModule = pathToFileURL(join(coreRoot, "dist/panel-apps/package-content.js")).href;
    const contract = await import(packageContentModule);
    const { PanelAppManifest } = await import(pathToFileURL(join(coreRoot, "dist/panel-apps/manifest.js")).href);
    const flatRoot = join(namespaceRoot, "flat-panel"), flatEntry = join(flatRoot, "app/tools/probe.mjs");
    await mkdir(join(flatEntry, ".."), { recursive: true });
    await mkdir(join(flatRoot, ".codeshell-panel"));
    await writeFile(flatEntry, await readFile(entry));
    await writeFile(join(flatRoot, "app/index.html"), "<!doctype html><title>Owned flat fixture</title>");
    const flatManifest = { schemaVersion: 2, id: "flat-panel", version: "0.1.0", title: { default: "Flat fixture" },
      entry: "app/index.html", icon: "panel", placement: "right-dock", singleton: false, permissions: ["process"],
      nativeEntries: { probe: { entry: "app/tools/probe.mjs", sha256: entrySha256 } } };
    PanelAppManifest.parse(flatManifest);
    const manifestFile = join(flatRoot, ".codeshell-panel/panel.json"), manifestBytes = JSON.stringify(flatManifest) + "\n";
    await writeFile(manifestFile, manifestBytes);
    await writeFile(join(flatRoot, contract.PANEL_APP_META_FILE), JSON.stringify({ fixtureMetadata: true }));
    const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
    const expected = contract.createPanelPackageHash();
    for (const name of [".codeshell-panel/panel.json", "app/index.html", "app/tools/probe.mjs", contract.PANEL_APP_META_FILE].sort())
      contract.hashPanelPackageFile(expected, name, await readFile(join(flatRoot, name)));
    const expectedFlatDigest = expected.digest("hex");
    const observation = await prepareNativeEntryParentObservation({ directory, receiptFile: fixture.receiptFile,
      executablePaths: [fixture.wrapper], namespaceRoot, packageContentModule,
      entries: [{ appId: "fixture-panel", entry: "app/tools/probe.mjs", sha256: entrySha256 },
        { appId: "flat-panel", entry: "app/tools/probe.mjs", sha256: entrySha256, manifestSha256 }] });
    restore = await installNativeEntryParentObservation(observation.spec);
    for (const layout of ["retained", "flat"]) for (const signal of [null, "SIGTERM", "SIGKILL"]) {
      await t.test(`${layout} ${signal ?? "natural"}`, async st => {
        const targetEntry = layout === "flat" ? flatEntry : entry;
        const child = spawn(fixture.wrapper, [targetEntry, signal ? "hold" : "normal"], { env, stdio: ["pipe", "pipe", "pipe"] });
        children.push(child);
        const closed = new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, observedSignal) => resolve({ code, signal: observedSignal }));
        });
        let stdout = "", stderr = "";
        child.stderr.on("data", bytes => { stderr += bytes; });
        let timer;
        const ready = new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`Owned probe did not become ready: ${stderr}`)), 5000);
          child.once("error", reject);
          child.stdout.on("data", bytes => { stdout += bytes; if (stdout.includes("\n")) resolve(); });
          child.once("close", () => { if (!stdout.includes("\n")) reject(new Error(`Owned probe closed before ready: ${stderr}`)); });
        });
        const request = { action: "offline-parent-observation", signal };
        child.stdin.end(JSON.stringify(request));
        try { await ready; } finally { clearTimeout(timer); }
        assert.deepEqual(JSON.parse(stdout.trim()), { pid: child.pid, input: request });
        if (signal) assert.equal(child.kill(signal), true); // Only this captured owned child.
        assert.deepEqual(await closed, { code: signal ? null : 0, signal }, stderr);
        const receipts = (await fixture.receipts()).filter(value => value.pid === child.pid);
        const started = receipts.find(value => value.event === "entry-start");
        assert.equal(started.pid, child.pid, "sandbox exec must retain the captured child PID");
        const close = receipts.find(value => value.event === "entry-parent-close");
        assert.deepEqual({ code: close.code, signal: close.signal }, { code: signal ? null : 0, signal });
        assert.equal(close.layout, layout);
        if (layout === "flat") {
          assert.equal(close.packageDigest, expectedFlatDigest, "Flat digest must use the actual frozen Host hashing contract");
          assert.equal(close.manifestSha256, manifestSha256);
        }
        const jsExit = receipts.find(value => value.event === "entry-exit");
        assert.equal(Boolean(jsExit), !signal, "default signal termination cannot write a JS exit log");
        const evidence = verifyNativeEntryExit({ started, receipts, observation: observation.spec, mainPid: process.pid });
        assert.equal(evidence.proof, signal ? "parent-signal-close" : "js-exit-and-parent-close");
        assert.equal(evidence.osAbsent, true);
        assert.throws(() => verifyNativeEntryExit({ started, receipts: receipts.filter(value => value.event !== "entry-parent-close"),
          observation: observation.spec, mainPid: process.pid }), /lacks captured parent close custody/,
        "ESRCH alone must never replace an actual parent close receipt");
        const wrongHash = receipts.map(value => value.event === "entry-parent-close" ? { ...value, entrySha256: "0".repeat(64) } : value);
        assert.throws(() => verifyNativeEntryExit({ started, receipts: wrongHash, observation: observation.spec, mainPid: process.pid }));
        st.diagnostic(JSON.stringify({ layout, signal, pid: child.pid, nodeSha256: fixture.boundary.nodeSha256,
          jsExitPresent: Boolean(jsExit), parentStart: receipts.find(value => value.event === "entry-parent-start"),
          parentClose: close, proof: evidence.proof, osAbsent: evidence.osAbsent,
          missingCloseRejectedEvenWhenAbsent: true, mismatchedEntryHashRejected: true }));
      });
    }
    const outside = join(directory, "outside.mjs");
    await writeFile(outside, await readFile(entry));
    const allReceipts = await fixture.receipts();
    assert.throws(() => verifyNativeEntryExit({ started: { pid: children[0].pid, ppid: process.pid,
      entry: outside, entrySha256 }, receipts: allReceipts, observation: observation.spec,
      mainPid: process.pid }), /escaped the owned reviewed namespace/);
    const flatStart = allReceipts.find(value => value.event === "entry-start" && value.entry === flatEntry);
    await writeFile(join(flatRoot, "app/tools/undeclared.mjs"), await readFile(entry));
    assert.throws(() => verifyNativeEntryExit({ started: { ...flatStart, entry: join(flatRoot, "app/tools/undeclared.mjs") },
      receipts: allReceipts, observation: observation.spec, mainPid: process.pid }), /escaped the owned reviewed namespace/);
    await rm(join(flatRoot, "app/tools/undeclared.mjs"));
    await writeFile(manifestFile, manifestBytes + " ");
    assert.throws(() => verifyNativeEntryExit({ started: flatStart, receipts: allReceipts,
      observation: observation.spec, mainPid: process.pid }), /Flat installed manifest differs from reviewed bytes/);
    await writeFile(manifestFile, manifestBytes);
    await writeFile(join(flatRoot, contract.PANEL_APP_META_FILE), JSON.stringify({ changedHostMetadata: true }));
    assert.equal(verifyNativeEntryExit({ started: flatStart, receipts: allReceipts,
      observation: observation.spec, mainPid: process.pid }).osAbsent, true, "Host metadata is excluded by the real payload hash contract");
  } finally {
    restore?.();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise(resolve => child.once("close", resolve));
      child.kill("SIGKILL");
      await closed;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
