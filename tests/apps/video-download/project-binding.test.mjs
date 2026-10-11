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
  assert.throws(() => f.tools.get("start")(), { code: "PROJECT_CHANGED" });
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

const projectScope = (changes = {}) => ({
  version: 1, environmentId: "host-a", projectId: "project-a", rootId: "root-a", ...changes,
});
const stableContext = () => ({
  cwd: "/workspace", sessionId: "session-a", host: "hub", appId: "video-download",
  projectScope: projectScope(),
});

test("a stable project keeps storage, native tasks and independent Agent tasks across chat changes", async () => {
  const f = fixture(stableContext());
  await f.binding.panel.getContext();
  const receipt = deferred();
  f.host.call = async (method) => {
    f.calls.push({ method });
    return method === "tasks.start" ? receipt.promise : true;
  };
  const work = f.binding.panel.call("tasks.start", {}).then(() => f.binding.panel.call("storage.set", {}));
  f.emit("context.changed", { sessionId: "session-b" });
  receipt.resolve({ id: "same-project-task" });
  await work;
  await f.binding.panel.call("agent.task.start", {});
  await f.binding.panel.call("process.get", {});
  assert.equal(f.invalidations, 0);
  assert.deepEqual(f.calls.map(({ method }) => method), ["tasks.start", "storage.set", "agent.task.start", "process.get"]);
});

for (const method of ["agent.submitPrompt", "automations.create", "automations.list"]) {
  test(`${method} stays bound to its original chat while project operations remain usable`, async () => {
    const f = fixture(stableContext());
    await f.binding.panel.getContext();
    const receipt = deferred();
    f.host.call = async () => receipt.promise;
    const work = f.binding.panel.call(method, {});
    f.emit("context.changed", { sessionId: "session-b" });
    f.emit("context.changed", { sessionId: "session-a" });
    receipt.resolve({ ok: true });
    await assert.rejects(work, { code: "SESSION_CHANGED" });
    await assert.rejects(f.binding.panel.call(method, {}), { code: "SESSION_CHANGED" });
    f.host.call = async () => true;
    await f.binding.panel.call("storage.set", {});
    assert.equal(f.binding.invalidated, false);
  });
}

for (const change of [
  { projectScope: projectScope({ environmentId: "host-b" }) },
  { projectScope: projectScope({ projectId: "project-b" }) },
  { projectScope: projectScope({ rootId: "root-b" }) },
  { projectScope: projectScope({ version: 2 }) },
  { projectScope: null },
  { projectScope: projectScope({ rootId: undefined }) },
  { projectScope: projectScope({ environmentId: "" }) },
  { projectScope: projectScope({ rootId: "root\u0000other" }) },
  { cwd: "/other-root" },
  { host: "desktop" },
  { appId: "other-panel" },
]) {
  test(`stable project changes cannot revive after switching back: ${JSON.stringify(change)}`, async () => {
    const f = fixture(stableContext());
    await f.binding.panel.getContext();
    f.emit("context.changed", change);
    f.emit("context.changed", stableContext());
    await assert.rejects(f.binding.panel.call("tasks.start", {}), { code: "PROJECT_CHANGED" });
    assert.equal(f.invalidations, 1);
    assert.deepEqual(f.calls, []);
  });
}

test("partial events retain project proof, while a complete context cannot silently lose it", async () => {
  const f = fixture(stableContext());
  await f.binding.panel.getContext();
  f.emit("context.changed", { sessionId: "session-b", visible: false });
  await f.binding.panel.call("storage.get", {});
  f.host.getContext = async () => ({ cwd: "/workspace", sessionId: "session-b", host: "hub", appId: "video-download" });
  await assert.rejects(f.binding.panel.getContext(), { code: "PROJECT_CHANGED" });
  await assert.rejects(f.binding.panel.call("storage.set", {}), { code: "PROJECT_CHANGED" });
});

for (const invalidScope of [undefined, {}, projectScope({ rootId: undefined }), projectScope({ version: 2 })]) {
  test(`partial or unknown proof preserves legacy session protection: ${JSON.stringify(invalidScope)}`, async () => {
    const f = fixture({ ...stableContext(), projectScope: invalidScope });
    await f.binding.panel.getContext();
    f.emit("context.changed", { sessionId: "session-b" });
    await assert.rejects(f.binding.panel.call("tasks.start", {}), { code: "PROJECT_CHANGED" });
  });
}

for (const method of ["agent.submitPrompt", "automations.create"]) {
  test(`${method} refreshes the actual chat before dispatch even when an event was lost`, async () => {
    const f = fixture(stableContext());
    await f.binding.panel.getContext();
    f.host.getContext = async () => ({ ...stableContext(), sessionId: "session-b" });
    await assert.rejects(f.binding.panel.call(method, {}), { code: "SESSION_CHANGED" });
    assert.deepEqual(f.calls, []);
    await f.binding.panel.call("storage.set", {});
    assert.equal(f.binding.invalidated, false);
  });
}

test("a partial event during a complete context read cannot conceal missing project proof", async () => {
  const f = fixture(stableContext());
  await f.binding.panel.getContext();
  const receipt = deferred();
  f.host.getContext = () => receipt.promise;
  const load = f.binding.panel.getContext();
  f.emit("context.changed", { visible: false });
  const { projectScope: _scope, ...withoutProof } = stableContext();
  receipt.resolve(withoutProof);
  await assert.rejects(load, { code: "PROJECT_CHANGED" });
});

test("storage backend changes invalidate the project page even if methods later switch back", async () => {
  const initial = { ...stableContext(), availableMethods: ["storage.getSnapshot", "storage.compareAndSet"] };
  const f = fixture(initial);
  await f.binding.panel.getContext();
  f.emit("context.changed", { availableMethods: ["storage.get", "storage.set"] });
  f.emit("context.changed", { availableMethods: initial.availableMethods });
  await assert.rejects(f.binding.panel.call("storage.compareAndSet", {}), { code: "PROJECT_CHANGED" });
  assert.deepEqual(f.calls, []);
});

test("registered tools preserve synchronous receipts and original synchronous/asynchronous errors", async () => {
  const f = fixture(stableContext());
  await f.binding.panel.getContext();
  const receipt = { identity: "current-project" }, failure = new Error("owned tool failure");
  f.binding.panel.registerTool("read", () => receipt);
  f.binding.panel.registerTool("fail", () => { throw failure; });
  f.binding.panel.registerTool("fail-async", () => Promise.reject(failure));
  assert.equal(f.tools.get("read")(), receipt, "synchronous project tools must stay synchronous");
  assert.throws(() => f.tools.get("fail")(), (error) => error === failure);
  await assert.rejects(f.tools.get("fail-async")(), (error) => error === failure);
  f.emit("context.changed", { sessionId: "session-b" });
  assert.equal(f.tools.get("read")(), receipt);
});

for (const outcome of ["resolve", "reject"]) {
  test(`registered tool ${outcome} cannot publish a late receipt after root A -> B -> A`, async () => {
    const f = fixture(stableContext()), pending = deferred();
    const original = await f.binding.panel.getContext();
    f.binding.panel.registerTool("read-async", () => pending.promise);
    const work = f.tools.get("read-async")();
    f.emit("context.changed", { projectScope: { ...original.projectScope, rootId: "root-b" } });
    f.emit("context.changed", { projectScope: original.projectScope });
    pending[outcome](outcome === "resolve" ? { identity: "old-project" } : new Error("old failure"));
    await assert.rejects(work, { code: "PROJECT_CHANGED" });
    assert.throws(() => f.tools.get("read-async")(), { code: "PROJECT_CHANGED" });
  });
}
