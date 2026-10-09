import assert from "node:assert/strict";
import test from "node:test";
import { createProjectBinding } from "../../../apps/video-download/app/project-binding.js";
import { createProjectStorage } from "../../../apps/video-download/app/project-storage.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function fixture(context = { cwd: "/workspace", sessionId: "session-a", host: "hub" }) {
  const listeners = new Map(), tools = new Map(), calls = [];
  const host = {
    async getContext() { return structuredClone(context); },
    async call(method, params) { calls.push({ method, params }); return true; },
    on(name, handler) { listeners.set(name, handler); return () => listeners.delete(name); },
    registerTool(name, handler) { tools.set(name, handler); },
  };
  let invalidations = 0;
  const binding = createProjectBinding(host, { onInvalidated() { invalidations++; } });
  binding.panel.on("context.changed", () => {});
  return {
    host, binding, calls, tools,
    emit(name, value) { listeners.get(name)?.(value); },
    get invalidations() { return invalidations; },
  };
}

test("same-path session changes stop saves and tool submissions permanently", async () => {
  const f = fixture();
  await f.binding.panel.getContext();
  f.binding.panel.registerTool("start", () => f.binding.panel.call("tasks.start", {}));
  f.emit("context.changed", { sessionId: "session-b", cwd: "/workspace" });
  f.emit("context.changed", { sessionId: "session-a", cwd: "/workspace" });
  await assert.rejects(f.binding.panel.call("storage.set", {}), { code: "PROJECT_CHANGED" });
  await assert.rejects(f.tools.get("start")(), { code: "PROJECT_CHANGED" });
  assert.equal(f.invalidations, 1);
  assert.deepEqual(f.calls, []);
});

for (const outcome of ["resolve", "reject"]) {
  test(`a late ${outcome} after A -> B -> A cannot deliver a receipt or start a follow-up`, async () => {
    const f = fixture();
    await f.binding.panel.getContext();
    const receipt = deferred();
    f.host.call = async (method) => { f.calls.push({ method }); return receipt.promise; };
    let delivered = false;
    const work = f.binding.panel.call("tasks.start", {}).then(async () => {
      delivered = true;
      return f.binding.panel.call("storage.set", {});
    });
    f.emit("context.changed", { sessionId: "session-b" });
    f.emit("context.changed", { sessionId: "session-a" });
    receipt[outcome](outcome === "reject" ? new Error("old Host failure") : { id: "old-task" });
    await assert.rejects(work, { code: "PROJECT_CHANGED" });
    assert.equal(delivered, false);
    assert.deepEqual(f.calls, [{ method: "tasks.start" }]);
  });
}

test("a newer context event wins over the delayed initial snapshot", async () => {
  const f = fixture();
  const initial = deferred();
  f.host.getContext = () => initial.promise;
  const load = f.binding.panel.getContext();
  f.emit("context.changed", { cwd: "/workspace", sessionId: "session-b", theme: "dark" });
  initial.resolve({ cwd: "/workspace", sessionId: "session-a", theme: "light", apiVersion: 14 });
  assert.deepEqual(await load, {
    cwd: "/workspace", sessionId: "session-b", theme: "dark", apiVersion: 14,
  });
  assert.equal(f.binding.invalidated, false);
  await f.binding.panel.call("storage.get", {});
});

test("partial context events hydrate initial capabilities without changing the binding", async () => {
  const f = fixture();
  const initial = deferred();
  f.host.getContext = () => initial.promise;
  const load = f.binding.panel.getContext();
  f.emit("context.changed", { visible: false });
  initial.resolve({ cwd: "/workspace", sessionId: "session-a", apiVersion: 14, visible: true });
  assert.equal((await load).visible, false);
  f.emit("context.changed", { visible: true, busy: true, theme: "dark" });
  await f.binding.panel.call("storage.get", {});
  assert.equal(f.binding.invalidated, false);
});

test("foreign task and process events stop reaching the old page", async () => {
  const f = fixture();
  await f.binding.panel.getContext();
  const received = [];
  f.binding.panel.on("tasks.changed", (event) => received.push(event));
  f.binding.panel.on("process.exit", (event) => received.push(event));
  f.emit("tasks.changed", { id: "owned" });
  f.emit("context.changed", { cwd: "/elsewhere" });
  f.emit("tasks.changed", { id: "foreign" });
  f.emit("process.exit", { processId: "foreign" });
  assert.deepEqual(received, [{ id: "owned" }]);
});

test("reopening the same project in another session keeps the original storage namespace", async () => {
  let record;
  async function open(sessionId) {
    const f = fixture({ cwd: "/workspace", sessionId, apiVersion: 14 });
    f.host.call = async (method, params) => {
      f.calls.push({ method, params });
      if (method === "storage.set") record = structuredClone(params.value);
      return structuredClone(record);
    };
    const context = await f.binding.panel.getContext();
    const storage = createProjectStorage({
      panel: f.binding.panel, key: "video-download.library.v2", envelope: false,
      getScope: () => "/workspace", getContext: () => context,
    });
    return { f, storage };
  }
  const first = await open("first-session");
  await first.storage.save({ scope: "/workspace", queue: [{ url: "https://example.com/video" }] });
  const second = await open("second-session");
  assert.deepEqual(await second.storage.load(), record);
  assert.equal(second.f.calls[0].params.key, "video-download.library.v2");
  assert.equal(Object.hasOwn(record, "sessionId"), false);
});

test("execution host changes invalidate a same-path, same-session page", async () => {
  const f = fixture();
  await f.binding.panel.getContext();
  f.emit("context.changed", { host: "desktop" });
  await assert.rejects(f.binding.panel.call("process.spawn", {}), { code: "PROJECT_CHANGED" });
});
