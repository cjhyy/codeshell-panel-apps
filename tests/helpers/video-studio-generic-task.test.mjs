import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { installGenericMediaTaskMock } from "./video-studio-generic-task.mjs";

function fixture(seed = []) {
  const storage = new Map(seed), calls = [];
  let context = { cwd: "/project/a", capabilities: { tasks: { executionRevision: "r1" } } };
  let holdStatus = null;
  const raw = {
    getContext: async () => structuredClone(context),
    on: () => () => {},
    async call(method, args) {
      calls.push({ method, args: structuredClone(args) });
      if (method === "media.status") {
        if (holdStatus) await holdStatus;
        return { available: true };
      }
      throw Error("Unexpected raw method " + method);
    },
  };
  const reload = () => {
    const window = { codeshellPanel: raw };
    runInNewContext(`(${installGenericMediaTaskMock.toString()})()`, {
      window, structuredClone, crypto: webcrypto, TextDecoder, atob, btoa,
      localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    });
    return window.codeshellPanel;
  };
  return {
    reload, calls,
    context: value => { context = { ...context, ...value }; },
    revision: revision => { context.capabilities.tasks.executionRevision = revision; },
    holdStatus: promise => { holdStatus = promise; },
  };
}
const request = (requestKey = "same-intent") => ({
  entry: "media-runtime", requestKey, recovery: "retry",
  input: { request: { action: "status", params: {} }, resources: [] },
});
const json = value => JSON.parse(JSON.stringify(value));

test("generic task adapter advertises find and retains keyed receipts across reload", async () => {
  const f = fixture();
  let bridge = f.reload();
  assert((await bridge.getContext()).availableMethods.includes("tasks.find"));
  assert.equal(await bridge.call("tasks.find", { requestKey: "same-intent" }), null);
  const task = await bridge.call("tasks.start", request());
  assert.equal(task.requestKey, "same-intent");
  assert.deepEqual(json(task.input), request().input);
  assert.equal((await bridge.call("tasks.start", request())).id, task.id);
  bridge = f.reload();
  assert.equal((await bridge.call("tasks.find", { requestKey: "same-intent" })).id, task.id);
  assert.equal((await bridge.call("tasks.get", { id: task.id })).requestKey, "same-intent");
  assert.equal((await bridge.call("tasks.list"))[0].requestKey, "same-intent");
  assert.equal(f.calls.filter(call => call.method === "media.status").length, 1);
  await assert.rejects(bridge.call("tasks.start", { ...request(), input: { changed: true } }), /different input/);
  await assert.rejects(bridge.call("tasks.start", { ...request(), recovery: "manual" }), /different input/);
});

test("same-scope concurrent starts share preparation and reject a changed request", async () => {
  const f = fixture(), bridge = f.reload();
  let release;
  f.holdStatus(new Promise(resolve => { release = resolve; }));
  const first = bridge.call("tasks.start", request());
  const second = bridge.call("tasks.start", request());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await bridge.call("tasks.find", { requestKey: "same-intent" }), null,
    "an in-flight preparation is not yet an admitted receipt");
  await assert.rejects(bridge.call("tasks.start", { ...request(), input: { changed: true } }), /different input/);
  assert.equal(f.calls.filter(call => call.method === "media.status").length, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.id, b.id);
  assert.equal((await bridge.call("tasks.find", { requestKey: "same-intent" })).id, a.id);
});

test("find is revision-scoped, retained get/list are project-scoped and old revisions are read-only", async () => {
  const f = fixture(), bridge = f.reload();
  const original = await bridge.call("tasks.start", request());
  f.context({ sessionId: "another-session" });
  assert.equal((await bridge.call("tasks.find", { requestKey: "same-intent" })).id, original.id);
  f.revision("r2");
  assert.equal(await bridge.call("tasks.find", { requestKey: "same-intent" }), null);
  assert.equal((await bridge.call("tasks.get", { id: original.id })).readOnly, true);
  await assert.rejects(bridge.call("tasks.cancel", { id: original.id }), /execution revision/);
  const upgraded = await bridge.call("tasks.start", request());
  assert.notEqual(upgraded.id, original.id);
  assert.equal((await bridge.call("tasks.list")).length, 2);
  f.context({ cwd: "/project/b" });
  assert.equal(await bridge.call("tasks.find", { requestKey: "same-intent" }), null);
  await assert.rejects(bridge.call("tasks.get", { id: original.id }), /not found/);
  assert.equal((await bridge.call("tasks.list")).length, 0);
  const otherProject = await bridge.call("tasks.start", request());
  assert.notEqual(otherProject.id, upgraded.id);
  f.context({ cwd: "/project/a" });
  assert.equal((await bridge.call("tasks.find", { requestKey: "same-intent" })).id, upgraded.id);
});

test("editor-runtime receipts also retain keys and enforce full request identity", async () => {
  const f = fixture(), bridge = f.reload();
  const input = {
    entry: "editor-runtime", requestKey: "editor-intent", recovery: "retry",
    input: { request: {
      action: "stage-status", transferId: "editor-00000000-0000-4000-8000-000000000000",
      documentHash: "a".repeat(64), resourceIds: [],
    } },
  };
  const original = await bridge.call("tasks.start", input);
  assert.equal(original.requestKey, "editor-intent");
  assert.equal((await bridge.call("tasks.start", input)).id, original.id);
  assert.equal((await f.reload().call("tasks.find", { requestKey: "editor-intent" })).id, original.id);
  await assert.rejects(bridge.call("tasks.start", { ...input, input: { ...input.input, resources: [] } }), /different input/);
});

test("legacy unkeyed fixtures remain readable in their initial project and new unkeyed starts remain distinct", async () => {
  const meta = { action: "status", request: { action: "status", params: {} }, recovery: "retry" };
  const f = fixture([
    ["test-generic-media-tasks", JSON.stringify({ legacy: meta })],
    ["test-generic-local-media-jobs", JSON.stringify({ legacy: { id: "legacy", status: "succeeded", createdAt: 1, updatedAt: 1, result: { available: true } } })],
  ]);
  const bridge = f.reload();
  f.context({ cwd: "/project/b" });
  await assert.rejects(bridge.call("tasks.get", { id: "legacy" }), /not found/);
  f.context({ cwd: "/project/a" });
  assert.equal((await bridge.call("tasks.get", { id: "legacy" })).requestKey, undefined);
  const unkeyed = request(); delete unkeyed.requestKey;
  const first = await bridge.call("tasks.start", unkeyed);
  const second = await bridge.call("tasks.start", unkeyed);
  assert.notEqual(first.id, second.id);
  await assert.rejects(bridge.call("tasks.find", { requestKey: "" }), /request key/);
  await assert.rejects(bridge.call("tasks.start", { ...request(), requestKey: "x".repeat(161) }), /request key/);
});
