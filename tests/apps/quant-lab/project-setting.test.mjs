import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createProjectSetting } from "../../../apps/quant-lab/app/modules/project-setting.mjs";
import { createPanelHostCallScheduler } from "../../../apps/quant-lab/app/modules/panel-host-call-scheduler.mjs";

const methods = ["storage.getSnapshot", "storage.compareAndSet"];
function fixture(original = null) {
  let value = structuredClone(original),
    exists = original !== null;
  let epoch = 1;
  const calls = [];
  const snapshot = () => ({
    exists,
    value: structuredClone(value),
    revision: exists
      ? `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
      : null,
  });
  const hostCall = async (method, params) => {
    calls.push({ method, params: structuredClone(params) });
    if (method === "storage.getSnapshot") return snapshot();
    if (method === "storage.get") return structuredClone(value);
    if (method === "storage.set") {
      value = structuredClone(params.value);
      exists = true;
      return true;
    }
    assert.equal(method, "storage.compareAndSet");
    const updated = params.expectedRevision === snapshot().revision;
    if (updated) {
      value = structuredClone(params.value);
      exists = true;
    }
    return { updated, snapshot: snapshot() };
  };
  return {
    calls,
    snapshot,
    hostCall,
    switchProject: () => {
      epoch++;
    },
    store: (extra = {}) =>
      createProjectSetting({
        hostCall,
        key: "source",
        currentEpoch: () => epoch,
        getContext: () => ({ availableMethods: methods }),
        ...extra,
      }),
  };
}

test("two devices preserve the first save and block stale queued writes until an explicit load", async () => {
  const f = fixture({ industry: "auto" });
  const a = f.store(),
    b = f.store();
  await Promise.all([a.load(), b.load()]);
  await a.save({ industry: "sina" });
  await assert.rejects(b.save({ industry: "eastmoney" }), { code: "STORAGE_CONFLICT" });
  const count = f.calls.length;
  await assert.rejects(b.save({ industry: "eastmoney" }), { code: "STORAGE_CONFLICT" });
  assert.equal(
    f.calls.length,
    count,
    "conflict is not automatically retried with a newer revision",
  );
  assert.deepEqual(f.snapshot().value, { industry: "sina" });
  assert.deepEqual(await b.load(), { industry: "sina" });
  await b.save({ industry: "eastmoney" });
  assert.deepEqual(f.snapshot().value, { industry: "eastmoney" });
});

test("missing records also compete by revision and writes require a successful read", async () => {
  const f = fixture();
  const a = f.store(),
    b = f.store();
  await assert.rejects(a.save({ industry: "sina" }), { code: "STORAGE_NOT_LOADED" });
  assert.equal(f.calls.length, 0);
  await Promise.all([a.load(), b.load()]);
  const results = await Promise.allSettled([
    a.save({ industry: "sina" }),
    b.save({ industry: "eastmoney" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
});

test("a lost successful response is reconciled by exact content, without a second write", async () => {
  const f = fixture();
  const store = f.store({
    hostCall: async (method, params) => {
      const result = await f.hostCall(method, params);
      if (method === "storage.compareAndSet") throw Error("response lost");
      return result;
    },
  });
  await store.load();
  await store.save({ industry: "eastmoney" });
  assert.equal(f.calls.filter((call) => call.method === "storage.compareAndSet").length, 1);
  assert.equal(store.blocked, false);
});

test("ambiguous writes and malformed success cannot authorize a later overwrite", async () => {
  for (const behavior of ["reject", "invalid", "wrong-content"]) {
    const f = fixture({ industry: "auto" });
    const store = f.store({
      hostCall: async (method, params) => {
        if (method !== "storage.compareAndSet") return f.hostCall(method, params);
        if (behavior === "reject") throw Error("connection lost");
        if (behavior === "invalid")
          return {
            updated: true,
            snapshot: { exists: true, revision: "invalid", value: params.value },
          };
        return { updated: true, snapshot: f.snapshot() };
      },
    });
    await store.load();
    await assert.rejects(store.save({ industry: "eastmoney" }));
    assert.equal(store.blocked, true);
    await assert.rejects(store.save({ industry: "sina" }));
    assert.deepEqual(f.snapshot().value, { industry: "auto" });
  }
});

test("failed reads protect existing configuration and a failed reload invalidates previous permission to save", async () => {
  const f = fixture({ industry: "sina" });
  let failed = false;
  const store = f.store({
    hostCall: async (method, params) => {
      if (failed) throw Error("offline");
      return f.hostCall(method, params);
    },
  });
  await store.load();
  failed = true;
  await assert.rejects(store.load(), /offline/);
  await assert.rejects(store.save({ industry: "eastmoney" }), { code: "STORAGE_NOT_LOADED" });
  assert.deepEqual(f.snapshot().value, { industry: "sina" });
});

test("queued snapshots detach from caller mutations and a project switch cancels writes before dispatch", async () => {
  const f = fixture();
  const store = f.store();
  await store.load();
  const draft = { industry: "sina" };
  const writing = store.save(draft);
  draft.industry = "eastmoney";
  await writing;
  assert.equal(f.snapshot().value.industry, "sina");
  const switched = store.save(draft);
  f.switchProject();
  await assert.rejects(switched, { code: "PROJECT_CHANGED" });
  assert.equal(f.snapshot().value.industry, "sina");
});

test("legacy hosts preserve existing keys and JSON without claiming conflict protection", async () => {
  const f = fixture({ industry: "sina" });
  const store = f.store({ getContext: () => ({}) });
  assert.equal(store.versioned, false);
  await store.load();
  await store.save({ industry: "eastmoney" });
  assert.deepEqual(
    f.calls.map(({ method }) => method),
    ["storage.get", "storage.set"],
  );
});

const timers = { schedule: setTimeout, cancelSchedule: clearTimeout };
test("scheduler rejects stale queued mutations, partitions discovery cache and rejects stale results", async () => {
  let scope = 1,
    release;
  const calls = [];
  const scheduler = createPanelHostCallScheduler({
    ...timers,
    currentScope: () => scope,
    maxCalls: 1,
    backgroundCalls: 1,
    windowMs: 20,
    invoke: async (method) => {
      calls.push({ method, scope });
      return `scope-${scope}`;
    },
  });
  assert.equal(await scheduler.call("process.find", { name: "node" }), "scope-1");
  const stale = assert.rejects(
    scheduler.call("storage.compareAndSet", { key: "source" }),
    /项目已切换/,
  );
  scope = 2;
  await stale;
  assert.equal(calls.filter(({ method }) => method === "storage.compareAndSet").length, 0);
  assert.equal(await scheduler.call("process.find", { name: "node" }), "scope-2");
  const pending = createPanelHostCallScheduler({
    ...timers,
    currentScope: () => scope,
    invoke: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const result = assert.rejects(pending.call("storage.get", { key: "source" }), /项目已切换/);
  await Promise.resolve();
  scope = 3;
  release({ industry: "old-project" });
  await result;
});

test("rate-limit retries cannot execute after switching projects", async () => {
  let scope = 1,
    calls = 0;
  const scheduler = createPanelHostCallScheduler({
    ...timers,
    currentScope: () => scope,
    windowMs: 10,
    invoke: async () => {
      calls++;
      scope = 2;
      throw Error("Panel App rate limit exceeded");
    },
  });
  await assert.rejects(scheduler.call("storage.compareAndSet", { key: "source" }));
  assert.equal(calls, 1);
  assert.equal(scheduler.snapshot().queued, 0);
});

test("capability changes cannot silently fall back to unconditional writes", async () => {
  const f = fixture({ industry: "sina" });
  let availableMethods = methods;
  const store = f.store({ getContext: () => ({ availableMethods }) });
  await store.load();
  availableMethods = ["storage.get", "storage.set"];
  await assert.rejects(store.save({ industry: "eastmoney" }), { code: "STORAGE_MODE_CHANGED" });
  assert.equal(f.calls.length, 1);
});

test("verifying current data before a dependent operation rejects changes without adopting their revision", async () => {
  const f = fixture({ items: [] });
  const a = f.store({ label: "关注记录" }),
    b = f.store({ label: "关注记录" });
  await Promise.all([a.load(), b.load()]);
  await a.assertCurrent();
  await b.save({ items: [{ symbol: "AAPL" }] });
  await assert.rejects(a.assertCurrent(), /其他页面或设备已修改关注记录/);
  await assert.rejects(a.save({ items: [{ symbol: "MSFT" }] }), { code: "STORAGE_CONFLICT" });
  assert.deepEqual(f.snapshot().value, { items: [{ symbol: "AAPL" }] });
});
