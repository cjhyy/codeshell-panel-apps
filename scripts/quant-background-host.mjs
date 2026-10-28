import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { repositoryRoot } from "./panel-projects.mjs";

// Actual reviewed package + Host coordinator + permission-constrained native Node.
// Empty subscriptions exercise the full stream without contacting a supplier.
async function worker(hostRoot, root, nonce) {
  let service, scope, gate, initialized = false, cleanupConfirmed = false, failure;
  let abortReason;
  const waiters = new Set();
  const events = [];
  const abort = () => {
    abortReason ??= new Error("QUANT_HOST_SMOKE_ABORTED");
    for (const waiter of waiters) waiter.reject(abortReason);
    waiters.clear();
  };
  const onMessage = message => { if (message?.type === "shutdown" && message.nonce === nonce) abort(); };
  process.on("message", onMessage);
  process.on("SIGTERM", abort);
  process.on("SIGINT", abort);
  const next = predicate => {
    if (abortReason) return Promise.reject(abortReason);
    const found = events.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolveEvent, reject) => waiters.add({ predicate, resolve: resolveEvent, reject }));
  };
  const receive = (_scope, event) => {
    events.push(event);
    if (events.length > 64) events.shift();
    for (const waiter of [...waiters]) {
      if (waiter.predicate(event)) { waiters.delete(waiter); waiter.resolve(event); }
      else if (["failed", "stop-unconfirmed"].includes(event.state.phase)) {
        waiters.delete(waiter); waiter.reject(new Error(`Native service ${event.state.phase}: ${event.state.lastError}`));
      }
    }
  };
  let report;
  try {
    const core = await import(pathToFileURL(join(hostRoot, "packages/core/dist/index.js")));
    const host = await import(pathToFileURL(join(hostRoot, "packages/server/dist/index.panels.js")));
    assert.equal(typeof host.PanelBackgroundService, "function", "build the candidate Host server exports first");
    assert.equal(typeof host.PanelExecutionGate, "function");
    const candidate = { kind: "dir", path: join(repositoryRoot, "apps/quant-lab") };
    const preview = await core.previewLocalPanelApp(candidate);
    assert(preview.permissions.includes("background.services"));
    const installed = await core.installReviewedLocalPanelApp(candidate, preview.reviewToken, new Date().toISOString());
    const projectPath = join(root, "project");
    await mkdir(projectPath);
    const selected = (await core.listProjectPanelApps(projectPath, "quant-lab")).find(app => app.id === "quant-lab");
    assert.equal(selected?.packageDigest, installed.packageDigest);
    const packageRoot = await realpath(selected.installPath);
    assert(packageRoot.startsWith(`${await realpath(process.env.HOME)}${sep}`), "only the private reviewed installation may execute");
    const definition = selected.backgroundServices["market-feed"];
    const native = selected.nativeEntries[definition.entry];
    const entry = join(packageRoot, native.entry);
    assert.equal(createHash("sha256").update(await readFile(entry)).digest("hex"), native.sha256);
    const cwd = join(root, "native-work");
    await mkdir(cwd);
    gate = new host.PanelExecutionGate();
    scope = { appId: selected.id, projectPath, name: "market-feed" };
    service = new host.PanelBackgroundService({
      rootDir: join(root, "service-store"), gate, onEvent: receive,
      describe: async requested => {
        assert.deepEqual(requested, scope);
        return { revision: selected.packageDigest, definition, executable: process.execPath,
          entry, sha256: native.sha256, packageRoot, cwd };
      },
    });
    await service.initialize();
    initialized = true;
    await service.configure(scope, { config: { format: "quant.market-feed.config/1", subscriptions: [] },
      expectedConfigRevision: 0, requestKey: "smoke-config" });
    const initial = await service.get(scope);
    const enabled = await service.setDesired(scope, { desired: "always", expectedRevision: initial.desiredRevision,
      requestKey: "smoke-enable" });
    await next(event => event.channel === "quotes" && event.seq >= 1);
    const [first, second] = await Promise.all([service.attach(scope, 11), service.attach(scope, 12)]);
    assert.notEqual(first.attachId, second.attachId);
    assert.equal(first.state.generation, enabled.generation);
    assert.equal(second.state.generation, enabled.generation);
    const executors = () => gate.blockers(() => true).filter(blocker => blocker.holder?.kind === "service");
    assert.equal(executors().length, 1);
    assert.equal(executors()[0].count, 1);
    const before = await service.read(scope, "quotes");
    assert.equal(before.value.format, "quant.quotes/2");
    assert.deepEqual(before.value.items, {});

    service.detachGuest(11);
    service.detachGuest(12);
    await service.control(scope, { action: "poke", requestKey: "smoke-no-guests" });
    await next(event => event.channel === "quotes" && event.seq > before.seq);
    const after = await service.read(scope, "quotes");
    assert(after.seq > before.seq);
    assert(after.value.round.roundId > before.value.round.roundId);
    assert.equal(after.generation, enabled.generation);
    assert.equal((await service.get(scope)).desired, "always");
    const reopened = await service.attach(scope, 13);
    assert.equal(reopened.state.generation, enabled.generation);
    assert.equal(executors().length, 1);
    assert.equal(executors()[0].count, 1);
    const stopped = await service.control(scope, { action: "stop", requestKey: "smoke-stop" });
    assert.equal(stopped.phase, "stopped");
    assert.equal(stopped.desired, "off");
    assert.equal(executors().length, 0, "the guardian process group must be confirmed exited");
    report = { app: selected.id, version: selected.version, packageDigest: selected.packageDigest,
      nativeEntry: definition.entry, nativeSha256: native.sha256, generation: enabled.generation,
      seqBeforeClose: before.seq, seqWithoutGuests: after.seq, roundBeforeClose: before.value.round.roundId,
      roundWithoutGuests: after.value.round.roundId, maxExecutors: 1, stopped: stopped.phase };
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (initialized) {
        const stopped = await service.control(scope, { action: "stop", requestKey: "smoke-final-cleanup" });
        assert.equal(stopped.phase, "stopped", "unconfirmed native ownership retains the private directory");
        await service.shutdown();
        assert.equal(gate.blockers(() => true).length, 0);
      }
      cleanupConfirmed = true;
    } catch (error) {
      failure = failure ? new AggregateError([failure, error], "Smoke and native cleanup failed") : error;
    }
    process.removeListener("message", onMessage);
    process.removeListener("SIGTERM", abort);
    process.removeListener("SIGINT", abort);
    if (process.connected) {
      await new Promise(resolveSend => process.send({ type: "shutdown-complete", nonce, cleanupConfirmed }, resolveSend));
      process.disconnect();
    }
  }
  if (failure) throw failure;
  console.log(`PASS real Quant native/Host lifecycle ${JSON.stringify(report)}`);
}

async function parent(hostPath) {
  if (!hostPath) throw new Error("Usage: node scripts/quant-background-host.mjs /absolute/path/to/built/host");
  const hostRoot = await realpath(resolve(hostPath));
  const root = await realpath(await mkdtemp(join(tmpdir(), "quant-background-host-")));
  const home = join(root, "home");
  await mkdir(home);
  const nonce = randomUUID();
  let receipt = false, timedOut = false, escalation, force;
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker", hostRoot, root, nonce], {
    cwd: root, env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, LANG: "C.UTF-8" },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  child.on("message", message => {
    if (message?.type === "shutdown-complete" && message.nonce === nonce && message.cleanupConfirmed) receipt = true;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.connected) child.send({ type: "shutdown", nonce }, () => {});
    escalation = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      force = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 15000);
    }, 15000);
  }, 60000);
  let result;
  try {
    result = await new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    });
  } finally {
    clearTimeout(timer); clearTimeout(escalation); clearTimeout(force);
    if (receipt) await rm(root, { recursive: true, force: true });
    else process.stderr.write(`Native cleanup was not confirmed; retained private fixture: ${root}\n`);
  }
  assert(receipt, "native shutdown receipt is required before deleting the fixture");
  assert.equal(timedOut, false, "native Host smoke exceeded 60 seconds");
  assert.equal(result.code, 0, `worker failed (${result.signal ?? "no signal"})`);
  console.log("PASS private HOME/project removed after confirmed native shutdown and worker exit");
}

if (process.argv[2] === "--worker") {
  await worker(process.argv[3], process.argv[4], process.argv[5]).catch(error => {
    console.error(error); process.exitCode = 1;
  });
} else await parent(process.argv[2]);
