import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cleanupPanelDesktopFixture } from "../scripts/panel-desktop-cleanup.mjs";

function childFixture({ exited = false, refuse = false } = {}) {
  const child = new EventEmitter();
  Object.assign(child, { pid: 123, exitCode: exited ? 0 : null, signalCode: null });
  const signals = [];
  child.kill = signal => {
    signals.push(signal);
    if (refuse) return false;
    child.signalCode = signal;
    child.emit("exit", null, signal);
    return true;
  };
  return { child, signals };
}
const short = { closeTimeoutMs: 10, exitTimeoutMs: 10 };

test("successful shutdown waits for the captured child exit before removing HOME", async () => {
  const { child, signals } = childFixture();
  let removed = false;
  const result = await cleanupPanelDesktopFixture({
    app: { close: async () => { setTimeout(() => { child.exitCode = 0; child.emit("exit", 0); }, 5); } },
    ownedChildProcess: child, directory: "/owned-fixture", ...short,
    removeDirectory: async () => { assert.equal(child.exitCode, 0); removed = true; },
  });
  assert.equal(removed, true);
  assert.equal(result.exited, true);
  assert.equal(result.homeRemoved, true);
  assert.deepEqual(signals, []);
});

test("primary assertion, close failure and remove failure are preserved together", async () => {
  const primary = new Error("primary assertion"), close = new Error("close failure"), remove = new Error("remove failure");
  const { child } = childFixture({ exited: true });
  await assert.rejects(cleanupPanelDesktopFixture({
    app: { close: async () => { throw close; } }, ownedChildProcess: child,
    directory: "/owned-fixture", failure: { error: primary }, ...short,
    removeDirectory: async () => { throw remove; },
  }), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, close, remove]);
    return true;
  });
});

test("a live child that rejects signals keeps HOME and keeps close failure visible", async () => {
  const { child, signals } = childFixture({ refuse: true });
  const close = new Error("close refused");
  let removed = false;
  await assert.rejects(cleanupPanelDesktopFixture({
    app: { close: async () => { throw close; } }, ownedChildProcess: child,
    directory: "/owned-fixture", ...short,
    removeDirectory: async () => { removed = true; },
  }), error => {
    assert.ok(error.errors.includes(close));
    assert.match(error.errors.map(value => value.message).join("\n"), /HOME retained/);
    return true;
  });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(removed, false);
});

test("a fulfilled close without child exit is a failure even if owned termination succeeds", async () => {
  const { child, signals } = childFixture();
  let removed = false;
  await assert.rejects(cleanupPanelDesktopFixture({
    app: { close: async () => {} }, ownedChildProcess: child,
    directory: "/owned-fixture", ...short,
    removeDirectory: async () => { assert.equal(child.signalCode, "SIGTERM"); removed = true; },
  }), error => error.errors.some(value => /remained active after close/.test(value.message)));
  assert.equal(removed, true);
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("hung close is bounded and is not reported as successful cleanup", async () => {
  const { child } = childFixture({ exited: true });
  let removed = false;
  await assert.rejects(cleanupPanelDesktopFixture({
    app: { close: () => new Promise(() => {}) }, ownedChildProcess: child,
    directory: "/owned-fixture", ...short,
    removeDirectory: async () => { removed = true; },
  }), error => error.errors.some(value => /close timed out/.test(value.message)));
  assert.equal(removed, true);
});

test("a partial launch without a captured child retains HOME rather than guessing a PID", async () => {
  let removed = false;
  await assert.rejects(cleanupPanelDesktopFixture({
    launchStarted: true, directory: "/owned-fixture", ...short,
    removeDirectory: async () => { removed = true; },
  }), error => error.errors.some(value => /captured ChildProcess/.test(value.message)));
  assert.equal(removed, false);
});

test("an initialization failure before launch still removes its owned temporary directory", async () => {
  const primary = new Error("initialization failed");
  let removed = false;
  await assert.rejects(cleanupPanelDesktopFixture({
    directory: "/owned-fixture", failure: { error: primary }, ...short,
    removeDirectory: async () => { removed = true; },
  }), error => { assert.deepEqual(error.errors, [primary]); return true; });
  assert.equal(removed, true);
});

test("real owned Node child exits before disk cleanup, while an unrelated captured child stays alive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "panel-desktop-cleanup-"));
  const open = () => spawn(process.execPath, ["-e", "process.stdin.resume()"], {
    cwd: directory, env: {}, stdio: ["pipe", "ignore", "ignore"],
  });
  const owned = open(), unrelated = open();
  await Promise.all([once(owned, "spawn"), once(unrelated, "spawn")]);
  const close = new Error("synthetic failed Electron close");
  try {
    await assert.rejects(cleanupPanelDesktopFixture({
      app: { close: async () => { throw close; } }, ownedChildProcess: owned,
      directory, closeTimeoutMs: 100, exitTimeoutMs: 100,
      removeDirectory: async (path, options) => {
        assert.ok(owned.exitCode != null || owned.signalCode != null);
        assert.equal(unrelated.exitCode, null);
        assert.equal(unrelated.signalCode, null);
        await rm(path, options);
      },
    }), error => error.errors.includes(close));
    await assert.rejects(access(directory), { code: "ENOENT" });
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
  } finally {
    for (const child of [owned, unrelated]) {
      if (child.exitCode != null || child.signalCode != null) continue;
      const done = once(child, "exit");
      child.kill("SIGKILL");
      await done;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
