import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

const SHUTDOWN = "panel-upgrade.shutdown";
const RECEIPT = "panel-upgrade.shutdown.complete";
const combine = (errors, message) => errors.length === 1 ? errors[0] : new AggregateError(errors, message);
export const errorDetails = error => ({ name: error?.name ?? "Error", message: String(error?.message ?? error),
  ...(error instanceof AggregateError ? { errors: [...error.errors].map(errorDetails) } : {}) });
const fromDetails = error => Array.isArray(error?.errors)
  ? new AggregateError(error.errors.map(fromDetails), error.message) : Error(error?.message ?? "worker failure");

function bounded(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(`${label} timed out after ${ms}ms`)), ms);
  })]).finally(() => clearTimeout(timer));
}

// Track the actual Playwright Browsers, including launches still in flight when
// shutdown begins. A close timeout/rejection is permanent evidence, even if a
// later disconnection happens; worker exit alone never proves browser closure.
export class UpgradeBrowserCustody {
  constructor({ closeTimeoutMs = 5_000 } = {}) {
    this.closeTimeoutMs = closeTimeoutMs;
    this.browsers = new Map();
    this.launches = new Set();
    this.errors = [];
    this.stopping = false;
  }

  async withBrowser(launch, operation) {
    if (this.stopping) throw Error("upgrade worker is shutting down");
    const pending = Promise.resolve().then(() => {
      if (this.stopping) throw Error("upgrade worker stopped before browser launch");
      return launch();
    }).then(browser => {
      this.browsers.set(browser, { closed: false, closing: null });
      return browser;
    }).catch(error => { this.errors.push(error); throw error; });
    this.launches.add(pending);
    let browser;
    try { browser = await pending; } finally { this.launches.delete(pending); }
    let failure;
    let value;
    try {
      if (this.stopping) throw Error("upgrade worker stopped during browser launch");
      value = await operation(browser);
    } catch (error) { failure = error; }
    try { await this.close(browser); } catch (error) {
      failure = failure ? combine([failure, error], "Panel assertion and browser close failed") : error;
    }
    if (failure) throw failure;
    return value;
  }

  close(browser) {
    const record = this.browsers.get(browser);
    if (!record) return Promise.reject(Error("browser is not owned by this worker"));
    if (!record.closing) record.closing = bounded(Promise.resolve().then(() => browser.close()),
      this.closeTimeoutMs, "owned Chromium close").then(() => {
      if (browser.isConnected()) throw Error("owned Chromium is still connected after close");
      record.closed = true;
    }).catch(error => { this.errors.push(error); throw error; });
    return record.closing;
  }

  shutdown() {
    this.stopping = true;
    if (!this.shutdownPromise) this.shutdownPromise = (async () => {
      try {
        await bounded(Promise.allSettled([...this.launches]), this.closeTimeoutMs, "owned Chromium launch settlement");
      } catch (error) { this.errors.push(error); }
      await Promise.allSettled([...this.browsers.keys()].map(browser => this.close(browser)));
      const browsersClosed = [...this.browsers.values()].filter(record => record.closed).length;
      return { complete: this.errors.length === 0 && this.launches.size === 0 && browsersClosed === this.browsers.size,
        browsersOpened: this.browsers.size, browsersClosed, pendingLaunches: this.launches.size,
        activeBrowsers: this.browsers.size - browsersClosed, errors: this.errors.map(errorDetails) };
    })();
    return this.shutdownPromise;
  }
}

// Install before the worker's asynchronous imports/work. Both timeout IPC and
// SIGTERM await the same close barrier. A single nonce-bound receipt is flushed
// before disconnect/exit; interrupted work cannot resume after this receipt.
export function installUpgradeWorkerShutdown(browsers) {
  const token = process.env.PANEL_UPGRADE_WORKER_TOKEN;
  if (!token || !process.send) throw Error("upgrade worker requires its parent's private IPC channel");
  let finishing;
  function finish(reason, failure, interrupted = false) {
    if (!finishing) finishing = (async () => {
      const result = await browsers.shutdown();
      const receipt = { type: RECEIPT, schemaVersion: 1, token, pid: process.pid, reason,
        ...result, ...(failure ? { failure: errorDetails(failure) } : {}) };
      let deliveryError;
      try {
        await bounded(new Promise((resolve, reject) => process.send(receipt,
          error => error ? reject(error) : resolve())), 1_000, "shutdown receipt delivery");
      } catch (error) { deliveryError = error; }
      if (failure) console.error(failure);
      if (result.errors.length) console.error(JSON.stringify(result.errors));
      if (deliveryError) console.error(deliveryError);
      if (process.connected) process.disconnect();
      const exitCode = failure || interrupted || !result.complete || deliveryError ? 1 : 0;
      if (interrupted) process.exit(exitCode);
      process.exitCode = exitCode;
      return receipt;
    })();
    return finishing;
  }
  process.on("message", message => {
    if (message?.type === SHUTDOWN && message.token === token)
      void finish("parent-timeout", Error("parent requested upgrade worker shutdown"), true);
  });
  process.on("SIGTERM", () => { void finish("SIGTERM", Error("upgrade worker received SIGTERM"), true); });
  return { async run(operation) {
    let failure;
    try { await operation(); } catch (error) { failure = error; }
    return finish("completed", failure);
  } };
}

function validReceipt(message, child, token) {
  return message?.type === RECEIPT && message.schemaVersion === 1 && message.token === token &&
    message.pid === child.pid && typeof message.complete === "boolean" &&
    [message.browsersOpened, message.browsersClosed, message.pendingLaunches, message.activeBrowsers]
      .every(value => Number.isSafeInteger(value) && value >= 0) &&
    message.browsersClosed + message.activeBrowsers === message.browsersOpened &&
    Array.isArray(message.errors) && (!message.complete || (message.pendingLaunches === 0 &&
      message.activeBrowsers === 0 && message.errors.length === 0));
}

// Only the captured ChildProcess is signalled. Missing/incomplete browser-close
// evidence keeps the private HOME even after this worker has been terminated.
export async function runOwnedUpgradeWorker({ executable = process.execPath, args, cwd, env,
  timeoutMs = 180_000, graceMs = 12_000, killMs = 2_000, maxBuffer = 4 * 1024 * 1024,
  onChild = () => {} }) {
  const token = randomUUID();
  const errors = [];
  let child;
  try { child = spawn(executable, args, { cwd, env: { ...env, PANEL_UPGRADE_WORKER_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe", "ipc"] }); } catch (error) {
    return { errors: [error], exited: true, spawnFailed: true, receipt: null, stdout: "", stderr: "" };
  }
  let exited = false;
  let receipt;
  let status;
  let signal;
  let stdout = "";
  let stderr = "";
  let bytes = 0;
  let abort;
  const interrupted = new Promise(resolve => { abort = resolve; });
  const exit = new Promise(resolve => {
    child.once("exit", (code, exitSignal) => { exited = true; status = code; signal = exitSignal; resolve(); });
    child.once("error", error => {
      errors.push(error);
      // Spawn failure has no worker/browser to reclaim.
      if (!child.pid) { exited = true; resolve(); }
      else abort();
    });
  });
  const signalOwned = name => {
    try { if (!exited) child.kill(name); }
    catch (error) { errors.push(Error(`owned worker ${name} failed: ${error.message}`)); }
  };
  child.on("message", message => {
    if (!validReceipt(message, child, token) || receipt) {
      errors.push(Error("invalid or duplicate upgrade worker shutdown receipt"));
      abort();
    } else receipt = message;
  });
  const capture = field => chunk => {
    bytes += chunk.length;
    if (bytes > maxBuffer) {
      if (!errors.some(error => error.message === "upgrade worker output exceeded its limit"))
        errors.push(Error("upgrade worker output exceeded its limit"));
      abort();
    } else if (field === "stdout") stdout += chunk.toString();
    else stderr += chunk.toString();
  };
  child.stdout.on("data", capture("stdout"));
  child.stderr.on("data", capture("stderr"));
  try { onChild(child); } catch (error) { errors.push(error); abort(); }
  let timer;
  try {
    const result = await Promise.race([exit.then(() => "exit"), interrupted.then(() => "abort"),
      new Promise(resolve => { timer = setTimeout(() => resolve("timeout"), timeoutMs); })]);
    if (result !== "exit" && !exited) {
      if (result === "timeout") errors.push(Error(`upgrade worker timed out after ${timeoutMs}ms`));
      try {
        if (child.connected) child.send({ type: SHUTDOWN, token }, error => {
          if (error) errors.push(Error(`worker shutdown request failed: ${error.message}`));
        });
      } catch (error) { errors.push(Error(`worker shutdown request failed: ${error.message}`)); }
      try { await bounded(exit, graceMs, "graceful upgrade worker shutdown"); } catch (error) {
        errors.push(error);
        signalOwned("SIGTERM");
        try { await bounded(exit, killMs, "owned worker SIGTERM exit"); } catch (termError) {
          errors.push(termError);
          signalOwned("SIGKILL");
          try { await bounded(exit, killMs, "owned worker SIGKILL exit"); } catch (killError) { errors.push(killError); }
        }
      }
    }
  } finally { clearTimeout(timer); }
  if (status !== 0) errors.push(Error(`upgrade worker failed (exit=${status}, signal=${signal})`));
  if (!receipt) errors.push(Error("worker exited without a browser-close receipt; private HOME retained"));
  else {
    if (receipt.failure) errors.push(fromDetails(receipt.failure));
    errors.push(...receipt.errors.map(fromDetails));
    if (!receipt.complete) errors.push(Error("worker browser shutdown incomplete; private HOME retained"));
  }
  return { errors, exited, spawnFailed: !child.pid, receipt, status, signal, pid: child.pid, stdout, stderr };
}

export async function cleanupUpgradeFixture({ sandbox, worker, failure, removeDirectory = rm }) {
  const errors = [...(failure ? [failure] : []), ...(worker?.errors ?? [])];
  const safe = !worker || worker.spawnFailed || (worker.exited && worker.receipt?.complete === true &&
    !worker.errors.some(error => /invalid or duplicate.*receipt/.test(error.message)));
  let homeRemoved = false;
  if (safe) {
    try { await removeDirectory(sandbox, { recursive: true, force: true }); homeRemoved = true; }
    catch (error) { errors.push(error); }
  } else errors.push(Error(`Private upgrade HOME retained at ${sandbox}: browser shutdown was not confirmed`));
  if (errors.length) throw combine(errors, "Panel upgrade assertion, worker shutdown or fixture cleanup failed");
  return { ...worker.receipt, token: undefined, workerExited: worker.exited,
    exitCode: worker.status, signal: worker.signal, homeRemoved };
}
