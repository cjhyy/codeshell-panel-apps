import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { repositoryRoot } from "./panel-projects.mjs";

// The real durable task stack transports the same request/directoryArguments shape
// as history-batch-client. repair:true only reconciles a seeded local library.
async function historyTask(host, selected, projectPath, root, signal, cleanupState) {
  const scope = { appId: selected.id, projectPath, revision: selected.packageDigest };
  const owners = new Map();
  let nextOwner = 100, executions = 0, directoryGrants = 0, stdout = "";
  const authorize = async requested => {
    assert.deepEqual(requested, scope);
    const current = (await cleanupState.core.listProjectPanelApps(projectPath, selected.id)).find(app => app.id === selected.id);
    assert.equal(current?.packageDigest, selected.packageDigest, "task must retain the reviewed project selection");
    assert(current.permissions.includes("process"));
  };
  const appData = join(root, "authorized-app-data", selected.id);
  await mkdir(appData, { recursive: true });
  const cache = await import(pathToFileURL(join(selected.installPath, "app/tools/a-share-history-cache.mjs")));
  await cache.writeHistoryManifest({ schemaVersion: 1, kind: "a-share-history-library", scope: "core", limit: 120,
    source: "tencent-ifzq", adjust: "qfq", updatedAt: "2026-10-28T00:00:00Z", marketDate: "2026-10-28",
    total: 120, ready: 0, failed: 0, bars: 0, storageBytes: 0, records: [] }, appData);
  const processes = new host.PanelAppProcessService({
    env: { PATH: process.env.PATH, HOME: process.env.HOME }, extraPathDirectories: () => [dirname(process.execPath)],
    confirmExecution: async approval => { assert.equal(approval.appId, scope.appId); assert.equal(owners.get(approval.guestId)?.revision, scope.revision); return true; },
    isOwnerAuthorized: async owner => { if (!owners.has(owner.guestId)) return false; await authorize(scope); return true; },
    resolvePackageEntry: async (owner, name) => {
      assert(owners.has(owner.guestId)); await authorize(scope);
      assert.equal(name, "quant-history-batch");
      const native = selected.nativeEntries[name];
      return { path: join(selected.installPath, native.entry), sha256: native.sha256 };
    },
  });
  const resources = new host.PanelResourceService({ rootDirectory: join(root, "history-resources"),
    isScopeAuthorized: async requested => { await authorize(requested); return true; } });
  let jobs;
  cleanupState.started = true;
  try {
    const executor = host.createPanelToolExecutor({
      processes, resources, sealedRoot: join(root, "history-sealed"), authorize,
      authorizeConnections: async () => { throw new Error("No account access in offline history smoke"); },
      owner: (job, send) => {
        assert.deepEqual(job.scope, scope); executions++;
        const owner = { guestId: nextOwner++, appId: scope.appId, revision: scope.revision, appTitle: selected.title,
          send(event, payload) {
            if (event === "process.output" && payload.stream === "stdout") {
              stdout += payload.text; assert(Buffer.byteLength(stdout) < 128 * 1024);
            }
            send(event, payload);
          } };
        owners.set(owner.guestId, owner); return owner;
      },
      releaseOwner: owner => { owners.delete(owner.guestId); },
      appDataDirectory: async requested => { await authorize(requested); directoryGrants++; return appData; },
    });
    jobs = new host.PanelToolJobService({ rootDir: join(root, "history-jobs"), ...executor,
      isAuthorized: async requested => { await authorize(requested); return true; },
      describePackage: async requested => { await authorize(requested); return { version: selected.version, packageDigest: selected.packageDigest }; },
    });
    let complete, fail;
    const finished = new Promise((resolveTask, reject) => { complete = resolveTask; fail = reject; });
    const onAbort = () => fail(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const unsubscribe = jobs.subscribe(scope, task => { if (["succeeded", "failed", "cancelled", "interrupted"].includes(task.status)) complete(task); });
    try {
      signal.throwIfAborted();
      const request = { entry: { name: "quant-history-batch", sha256: selected.nativeEntries["quant-history-batch"].sha256 },
        requestKey: "offline-history-repair", recovery: "retry",
        input: { request: { scope: "core", source: "tencent-ifzq", maxItems: 20, repair: true },
          directoryArguments: [{ argumentName: "--data-dir", directory: "app-data" }] } };
      const [started, terminal] = await Promise.all([jobs.start(scope, request, signal), finished]);
      assert.equal(terminal.id, started.id);
      assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.error));
      const receipt = await jobs.get(scope, started.id);
      assert.equal(receipt.result.batchLimit, 20);
      assert.equal(receipt.result.scope, "core");
      assert.equal(receipt.result.source, "tencent-ifzq");
      assert.equal(receipt.result.running, false);
      const lines = stdout.trim().split("\n").map(line => JSON.parse(line));
      assert.equal(lines.length, 1);
      assert.equal(lines[0].type, "result");
      assert.deepEqual(lines[0].result, receipt.result);
      assert.equal((await jobs.find(scope, request.requestKey)).id, started.id);
      assert.equal((await jobs.start(scope, request)).id, started.id, "lost-start retry must reuse the durable receipt");
      assert.equal(executions, 1);
      assert.equal(directoryGrants, 1);
      assert.equal(owners.size, 0, "task completion must retire its process owner");
      const persisted = await cache.readHistoryManifest(appData);
      assert.equal(persisted.scope, "core");
      return { entry: request.entry.name, status: receipt.status, batchLimit: receipt.result.batchLimit,
        ndjsonResults: lines.length, requestKeyReused: true, executions, authorizedDirectoryGrants: directoryGrants };
    } finally { unsubscribe(); signal.removeEventListener("abort", onAbort); }
  } finally {
    await jobs?.shutdown();
    await processes.close();
    await resources.shutdown();
    cleanupState.confirmed = true;
  }
}

// Actual reviewed package + Host coordinator + permission-constrained native Node.
// Empty subscriptions exercise the full stream without contacting a supplier.
async function worker(hostRoot, root, nonce) {
  let service, scope, gate, initialized = false, cleanupConfirmed = false, failure;
  let abortReason;
  const abortController = new AbortController();
  const historyCleanup = { started: false, confirmed: false };
  const waiters = new Set();
  const events = [];
  const abort = () => {
    abortReason ??= new Error("QUANT_HOST_SMOKE_ABORTED");
    abortController.abort(abortReason);
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
    historyCleanup.core = core;
    const history = await historyTask(host, selected, projectPath, root, abortController.signal, historyCleanup);
    report = { historyTask: history, app: selected.id, version: selected.version, packageDigest: selected.packageDigest,
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
      assert(!historyCleanup.started || historyCleanup.confirmed, "history task native cleanup must be confirmed");
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
