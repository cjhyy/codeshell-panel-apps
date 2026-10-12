import { rm } from "node:fs/promises";

const exited = child => child?.exitCode != null || child?.signalCode != null;

function waitForExit(child, timeoutMs) {
  if (exited(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = value => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(exited(child)), timeoutMs);
    child.once("exit", onExit);
    if (exited(child)) finish(true);
  });
}

async function boundedClose(app, timeoutMs) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => app.close()),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Owned Electron close timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The only signaling authority is the captured ChildProcess from app.process(). */
export async function closeOwnedPanelElectron({
  app,
  ownedChildProcess,
  launchStarted = Boolean(app || ownedChildProcess),
  closeTimeoutMs = 15_000,
  exitTimeoutMs = 2_000,
}) {
  const errors = [];
  if (app) {
    try { await boundedClose(app, closeTimeoutMs); }
    catch (error) { errors.push(error); }
  }
  if (launchStarted && !ownedChildProcess)
    errors.push(new Error("Cannot verify Electron exit without its captured ChildProcess"));
  if (ownedChildProcess && !await waitForExit(ownedChildProcess, exitTimeoutMs)) {
    errors.push(new Error("Owned Electron remained active after close"));
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      if (exited(ownedChildProcess)) break;
      try {
        if (!ownedChildProcess.kill(signal) && !exited(ownedChildProcess))
          errors.push(new Error(`Owned Electron rejected ${signal}`));
      } catch (error) { errors.push(error); }
      if (await waitForExit(ownedChildProcess, exitTimeoutMs)) break;
    }
  }
  if (ownedChildProcess && !exited(ownedChildProcess))
    errors.push(new Error("Owned Electron is still active; its fixture HOME must be retained"));
  if (errors.length) throw new AggregateError(errors, "Panel Desktop Electron shutdown failed");
  return ownedChildProcess ? {
    pid: ownedChildProcess.pid,
    exitCode: ownedChildProcess.exitCode,
    signalCode: ownedChildProcess.signalCode,
    exited: true,
  } : { launched: false };
}

/** Preserve the primary failure and every cleanup failure, and never remove a live HOME. */
export async function cleanupPanelDesktopFixture({
  app,
  ownedChildProcess,
  launchStarted = Boolean(app || ownedChildProcess),
  directory,
  failure,
  removeDirectory = rm,
  ...timeouts
}) {
  const errors = failure ? [failure.error] : [];
  let shutdown;
  try { shutdown = await closeOwnedPanelElectron({ app, ownedChildProcess, launchStarted, ...timeouts }); }
  catch (error) {
    errors.push(...(error instanceof AggregateError ? error.errors : [error]));
  }
  const safeToRemove = ownedChildProcess ? exited(ownedChildProcess) : !launchStarted && !app;
  if (safeToRemove) {
    try {
      await removeDirectory(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (error) { errors.push(error); }
  } else errors.push(new Error(`Fixture HOME retained for an unverified live Electron: ${directory}`));
  if (errors.length) throw new AggregateError(errors, "Panel Desktop acceptance or cleanup failed");
  return { ...shutdown, homeRemoved: true };
}
