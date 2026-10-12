import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cleanupUpgradeFixture, runOwnedUpgradeWorker, UpgradeBrowserCustody } from "../scripts/panel-upgrade-process.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const allErrors = error => [error.message, ...(error.errors ?? []).flatMap(allErrors)].join(" | ");
const helperURL = new URL("../scripts/panel-upgrade-process.mjs", import.meta.url).href;

async function fixture(t, mode = "normal") {
  const sandbox = await mkdtemp(join(tmpdir(), "panel-upgrade-custody-test-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const entry = join(sandbox, "worker.mjs");
  await writeFile(entry, `
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UpgradeBrowserCustody, installUpgradeWorkerShutdown } from ${JSON.stringify(helperURL)};
const [root, mode] = process.argv.slice(2);
if (mode === 'missing') { process.disconnect(); process.exit(0); }
if (mode === 'unresponsive') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else {
  const custody = new UpgradeBrowserCustody({ closeTimeoutMs: 80 });
  const worker = installUpgradeWorkerShutdown(custody);
  await worker.run(async () => {
    let connected = true;
    await custody.withBrowser(async () => ({
      isConnected: () => connected,
      close: async () => {
        if (mode === 'close-failure' || mode === 'double-failure') throw Error('injected browser close failure');
        if (mode === 'hung-close') await new Promise(() => {});
        await new Promise(resolve => setTimeout(resolve, 30));
        connected = false;
        await writeFile(join(root, 'closed'), 'awaited close completed');
      },
    }), async () => {
      await writeFile(join(root, 'ready'), 'ready');
      if (mode === 'double-failure') throw Error('primary Panel assertion failure');
      if (mode !== 'normal') await new Promise(() => {});
    });
  });
}
`);
  return { sandbox, entry, options: { args: [entry, sandbox, mode], env: {}, timeoutMs: 500,
    graceMs: 600, killMs: 150 } };
}

test("normal browser operation awaits close and produces complete custody evidence", async () => {
  const custody = new UpgradeBrowserCustody();
  let connected = true;
  const value = await custody.withBrowser(async () => ({ isConnected: () => connected,
    close: async () => { await delay(5); connected = false; } }), async () => 42);
  assert.equal(value, 42);
  assert.deepEqual(await custody.shutdown(), { complete: true, browsersOpened: 1, browsersClosed: 1,
    pendingLaunches: 0, activeBrowsers: 0, errors: [] });
  await assert.rejects(custody.withBrowser(() => assert.fail("launch must not run"), () => {}), /shutting down/);
});

test("Panel assertion and close errors are both preserved, with a permanently incomplete receipt", async () => {
  const custody = new UpgradeBrowserCustody();
  await assert.rejects(custody.withBrowser(async () => ({ isConnected: () => true,
    close: async () => { throw Error("close failed"); } }), async () => { throw Error("Panel assertion failed"); }),
  error => /Panel assertion failed/.test(allErrors(error)) && /close failed/.test(allErrors(error)));
  const receipt = await custody.shutdown();
  assert.equal(receipt.complete, false);
  assert.equal(receipt.activeBrowsers, 1);
  assert.equal(receipt.errors.length, 1);
});

test("fulfilled close still connected and hung close cannot claim shutdown complete", async () => {
  for (const hang of [false, true]) {
    const custody = new UpgradeBrowserCustody({ closeTimeoutMs: 20 });
    await assert.rejects(custody.withBrowser(async () => ({ isConnected: () => true,
      close: async () => { if (hang) await new Promise(() => {}); } }), async () => {}),
    hang ? /timed out/ : /still connected/);
    assert.equal((await custody.shutdown()).complete, false);
  }
});

test("shutdown waits for an in-flight launch and closes it before receipt; operation never begins", async () => {
  const custody = new UpgradeBrowserCustody({ closeTimeoutMs: 200 });
  let release;
  let connected = true;
  const operation = custody.withBrowser(() => new Promise(resolve => { release = resolve; }), () => assert.fail("operation after stop"));
  await delay(0);
  const shutdown = custody.shutdown();
  release({ isConnected: () => connected, close: async () => { connected = false; } });
  await assert.rejects(operation, /stopped during browser launch/);
  assert.equal((await shutdown).complete, true);
});

test("a launch that misses the shutdown bound cannot receive a complete receipt", async () => {
  const custody = new UpgradeBrowserCustody({ closeTimeoutMs: 20 });
  let release;
  const operation = custody.withBrowser(() => new Promise(resolve => { release = resolve; }), () => assert.fail());
  await delay(0);
  const receipt = await custody.shutdown();
  assert.equal(receipt.complete, false);
  assert.equal(receipt.pendingLaunches, 1);
  release({ isConnected: () => false, close: async () => {} });
  await assert.rejects(operation, /stopped during browser launch/);
  assert.equal((await custody.shutdown()).complete, false);
});

test("real owned Node worker sends nonce-bound close receipt before exit and HOME deletion", async t => {
  const { sandbox, options } = await fixture(t);
  const worker = await runOwnedUpgradeWorker(options);
  assert.deepEqual(worker.errors, []);
  assert.equal(worker.receipt.browsersClosed, 1);
  assert.equal(worker.exited, true);
  assert.equal(await readFile(join(sandbox, "closed"), "utf8"), "awaited close completed");
  const result = await cleanupUpgradeFixture({ sandbox, worker });
  assert.equal(result.workerExited, true);
  assert.equal(result.homeRemoved, true);
  assert.equal(result.token, undefined);
  await assert.rejects(access(sandbox), /ENOENT/);
});

test("real worker timeout requests async close, preserves timeout failure and deletes only after acknowledgement", async t => {
  const { sandbox, options } = await fixture(t, "timeout");
  const worker = await runOwnedUpgradeWorker(options);
  assert.equal(worker.receipt.reason, "parent-timeout");
  assert.equal(worker.receipt.complete, true);
  assert.equal(await readFile(join(sandbox, "closed"), "utf8"), "awaited close completed");
  await assert.rejects(cleanupUpgradeFixture({ sandbox, worker }), error => /timed out/.test(allErrors(error)));
  await assert.rejects(access(sandbox), /ENOENT/);
});

test("actual captured worker SIGTERM awaits close and sends a receipt", async t => {
  const { sandbox, options } = await fixture(t, "signal");
  let child;
  const running = runOwnedUpgradeWorker({ ...options, timeoutMs: 5_000, onChild: owned => { child = owned; } });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await access(join(sandbox, "ready")).then(() => true, () => false)) break;
    await delay(10);
  }
  await access(join(sandbox, "ready"));
  child.kill("SIGTERM");
  const worker = await running;
  assert.equal(worker.receipt.reason, "SIGTERM");
  assert.equal(worker.receipt.complete, true);
  await assert.rejects(cleanupUpgradeFixture({ sandbox, worker }), error => /SIGTERM|worker failed/.test(allErrors(error)));
  await assert.rejects(access(sandbox), /ENOENT/);
});

test("browser close rejection or timeout retains HOME, preserves both failures and leaves unrelated child alive", async t => {
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { env: {}, stdio: "ignore" });
  t.after(async () => { if (unrelated.exitCode === null) { const exited = once(unrelated, "exit"); unrelated.kill("SIGKILL"); await exited; } });
  for (const mode of ["close-failure", "hung-close"]) {
    const { sandbox, options } = await fixture(t, mode);
    const worker = await runOwnedUpgradeWorker(options);
    assert.equal(worker.exited, true);
    assert.equal(worker.receipt.complete, false);
    await assert.rejects(cleanupUpgradeFixture({ sandbox, worker }), error => {
      const details = allErrors(error);
      return /worker timed out/.test(details) && /close failure|Chromium close timed out/.test(details) && /HOME retained/.test(details);
    });
    await access(sandbox);
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
  }
});

test("zero exit without receipt retains HOME; an unresponsive worker is killed only through captured handle", async t => {
  for (const mode of ["missing", "unresponsive"]) {
    const { sandbox, options } = await fixture(t, mode);
    const worker = await runOwnedUpgradeWorker({ ...options, graceMs: 40, killMs: 40 });
    assert.equal(worker.exited, true);
    assert.equal(worker.receipt, undefined);
    if (mode === "unresponsive") assert.equal(worker.signal, "SIGKILL");
    else assert.equal(worker.status, 0);
    await assert.rejects(cleanupUpgradeFixture({ sandbox, worker }), error => /HOME retained/.test(allErrors(error)));
    await access(sandbox);
  }
});

test("real worker sends both assertion and browser-close failure; cleanup never erases either", async t => {
  const { sandbox, options } = await fixture(t, "double-failure");
  const worker = await runOwnedUpgradeWorker(options);
  await assert.rejects(cleanupUpgradeFixture({ sandbox, worker }), error => {
    const details = allErrors(error);
    return /primary Panel assertion failure/.test(details) && /injected browser close failure/.test(details) && /HOME retained/.test(details);
  });
  await access(sandbox);
});

test("directory cleanup failure preserves original assertion and close errors", async t => {
  const { sandbox, options } = await fixture(t);
  const worker = await runOwnedUpgradeWorker(options);
  worker.errors.push(Error("additional worker error"));
  await assert.rejects(cleanupUpgradeFixture({ sandbox, worker, failure: Error("original assertion"),
    removeDirectory: async () => { throw Error("injected rm failure"); } }), error => {
    const details = allErrors(error);
    return /original assertion/.test(details) && /additional worker error/.test(details) && /injected rm failure/.test(details);
  });
  await access(sandbox);
});
