import assert from "node:assert/strict";
import { test } from "node:test";
import { createEnvironmentClient } from "../../../apps/video-download/app/environment-client.js";

function fixture() {
  const calls = [];
  let invalid = false;
  const result = {
    ready: true,
    cached: true,
    dependencies: {
      "yt-dlp": { available: true, version: "2026.10.01" },
      ffmpeg: { available: true, version: "8.0" },
    },
  };
  const panel = {
    async call(method, input) {
      calls.push({ method, input });
      if (method === "filesystem.getKnownDirectory") return { handle: "project-grant" };
      if (method === "process.find") return { available: true, handle: "node-grant" };
      if (method === "process.resolveEntry") return { handle: "reviewed-environment" };
      throw new Error(method);
    },
  };
  const processes = {
    async run(input) {
      calls.push(input);
      return {
        code: 0,
        stdout: JSON.stringify({
          format: "mimi-download.environment",
          schemaVersion: 1,
          ok: true,
          result,
        }),
      };
    },
  };
  const client = createEnvironmentClient({
    panel,
    processes,
    assertCurrent() {
      if (invalid) throw new Error("project changed");
    },
  });
  return {
    client,
    calls,
    panel,
    processes,
    result,
    invalidate() {
      invalid = true;
    },
  };
}

test("environment requests resolve reviewed entries and reuse grants only within this page", async () => {
  const f = fixture();
  assert.equal((await f.client.read()).cached, true);
  await f.client.read({ refresh: true, includeLatest: true });
  assert.equal(f.calls.filter((call) => call.method === "process.resolveEntry").length, 1);
  assert.deepEqual(
    f.calls.filter((call) => call.input?.action).map((call) => call.input),
    [
      { action: "get", includeLatest: false },
      { action: "refresh", includeLatest: true },
    ],
  );
  assert.equal(f.calls.at(-1).directoryHandle, "project-grant");
});

test("closed page cannot launch a new probe after a late project grant", async () => {
  const f = fixture();
  let resolveGrant;
  f.panel.call = async () =>
    new Promise((resolve) => {
      resolveGrant = resolve;
    });
  const pending = f.client.read();
  await new Promise((resolve) => setImmediate(resolve));
  f.client.destroy();
  resolveGrant({ handle: "old-project" });
  await assert.rejects(pending, /关闭/);
  assert.equal(f.calls.length, 0);
});

test("late environment results cannot cross an invalidated project binding", async () => {
  const f = fixture();
  let release;
  f.processes.run = async () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = f.client.read();
  await new Promise((resolve) => setImmediate(resolve));
  f.invalidate();
  release({
    code: 0,
    stdout: JSON.stringify({
      format: "mimi-download.environment",
      schemaVersion: 1,
      ok: true,
      result: f.result,
    }),
  });
  await assert.rejects(pending, /project changed/);
});
