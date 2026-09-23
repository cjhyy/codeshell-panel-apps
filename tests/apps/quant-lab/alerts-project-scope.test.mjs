import assert from "node:assert/strict";
import test from "node:test";
import {
  createAlertsController,
  buildDeskAutomations,
} from "../../../apps/quant-lab/app/modules/alerts-ui.mjs";

const items = [
  { id: "rule", symbol: "AAPL", rule: { type: "rsi-oversold", period: 14, threshold: 30 } },
];
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(extra = {}) {
  let epoch = 1;
  const node = () => ({ dataset: {}, addEventListener() {} });
  const row = () => ({ root: node(), status: node(), button: node(), time: node() });
  const elements = {
    master: node(),
    summary: node(),
    markets: { cn: row(), us: row() },
    legacy: node(),
    legacyState: node(),
    legacyRemove: node(),
  };
  const calls = [],
    notices = [],
    tasks = [];
  const hostCall = async (method, params) => {
    calls.push({ method, params, epoch });
    if (method === "automations.list") return structuredClone(tasks);
    if (method === "automations.create") {
      tasks.push({ ...params, id: "new-task" });
      return tasks.at(-1);
    }
    if (method === "automations.delete") {
      tasks.splice(
        tasks.findIndex((task) => task.id === params.id),
        1,
      );
      return { ok: true };
    }
    throw Error(method);
  };
  const controller = createAlertsController({
    hostCall,
    elements,
    watchlist: () => items,
    currentEpoch: () => epoch,
    notify: (...args) => notices.push(args),
    ...extra,
  });
  return {
    controller,
    calls,
    notices,
    tasks,
    hostCall,
    switchProject: () => {
      epoch++;
      controller.reset();
    },
  };
}

test("failed saved-record verification blocks automation changes, including programmatic legacy removal", async () => {
  const f = fixture({
    beforeChange: async () => {
      throw Error("关注记录有冲突");
    },
  });
  f.tasks.push(...buildDeskAutomations(items).map((plan) => ({ ...plan, id: "current" })), {
    id: "legacy",
    name: "Quant Lab · 每日盯盘（1 个标的）",
  });
  await f.controller.load();
  await f.controller.toggleAll();
  await f.controller.toggleMarket("us");
  await f.controller.removeLegacy();
  assert.equal(
    f.calls.some(({ method }) => method !== "automations.list"),
    false,
  );
  assert.equal(f.tasks.length, 2);
  assert.equal(f.notices.length, 3);
  assert.equal(f.controller.state.inFlight, false);
});

test("switching projects while checking saved records prevents even the first automation request", async () => {
  const gate = deferred();
  const f = fixture({ beforeChange: () => gate.promise });
  const toggling = f.controller.toggleAll();
  f.switchProject();
  gate.resolve();
  await toggling;
  assert.equal(f.calls.length, 0);
  assert.equal(f.notices.length, 0);
  assert.equal(f.controller.state.loaded, false);
});

test("a list response from the previous project cannot create tasks or populate the new project", async () => {
  const gate = deferred(),
    entered = deferred();
  const calls = [];
  const f = fixture({
    hostCall: async (method) => {
      calls.push(method);
      entered.resolve();
      return gate.promise;
    },
  });
  const toggling = f.controller.toggleAll();
  await entered.promise;
  f.switchProject();
  gate.resolve(buildDeskAutomations(items).map((plan) => ({ ...plan, id: "old-project-task" })));
  await toggling;
  assert.deepEqual(calls, ["automations.list"]);
  assert.equal(f.controller.state.tasks.us, null);
  assert.equal(f.controller.state.errors.us, null);
  assert.equal(f.notices.length, 0);
});

test("already dispatched creation is not followed by verification or mutations in the next project", async () => {
  const gate = deferred(),
    entered = deferred();
  const calls = [];
  const f = fixture({
    hostCall: async (method, params) => {
      calls.push({ method, params });
      if (method === "automations.list") return [];
      assert.equal(method, "automations.create");
      entered.resolve();
      return gate.promise;
    },
  });
  const toggling = f.controller.toggleAll();
  await entered.promise;
  f.switchProject();
  const count = calls.length;
  gate.resolve({ id: "created-in-old-project" });
  await toggling;
  assert.equal(calls.length, count);
  assert.equal(f.controller.state.tasks.us, null);
  assert.equal(f.controller.state.retryIntent.us, null);
  assert.equal(f.notices.length, 0);
});

test("a late load cannot overwrite the next project's successful state", async () => {
  const gate = deferred();
  let calls = 0;
  const tasks = buildDeskAutomations(items).map((plan) => ({ ...plan, id: "new-project-task" }));
  const f = fixture({ hostCall: async () => (++calls === 1 ? gate.promise : tasks) });
  const oldLoad = f.controller.load();
  f.switchProject();
  await f.controller.load();
  gate.resolve([{ id: "old-task", name: tasks[0].name }]);
  await oldLoad;
  assert.equal(f.controller.state.tasks.us.id, "new-project-task");
  assert.equal(f.controller.state.errors.us, null);
  assert.equal(f.controller.state.retryIntent.us, null);
});

test("saved records are checked again after the asynchronous task lookup, before mutation", async () => {
  let checks = 0;
  const f = fixture({
    beforeChange: async () => {
      if (++checks > 1) throw Error("changed while loading tasks");
    },
  });
  await f.controller.toggleMarket("us");
  assert.equal(checks, 2);
  assert.equal(
    f.calls.some(({ method }) => method !== "automations.list"),
    false,
  );
  assert.match(f.controller.state.errors.us, /changed while loading/);
});

test("a conditional conflict never falls back and retry only reads the other device's task", async () => {
  const [plan] = buildDeskAutomations(items);
  let current = { ...plan, id: "shared", prompt: "previous definition", revision: "a".repeat(64) };
  const writes = [];
  const f = fixture({
    getContext: () => ({
      availableMethods: ["automations.updateIfRevision", "automations.deleteIfRevision"],
    }),
    hostCall: async (method, params) => {
      if (method === "automations.list") return [structuredClone(current)];
      writes.push({ method, params });
      assert.equal(method, "automations.updateIfRevision");
      assert.equal(params.expectedRevision, "a".repeat(64));
      current = { ...current, prompt: "other device", revision: "b".repeat(64) };
      return { ok: false, conflict: true };
    },
  });
  await f.controller.load();
  await f.controller.toggleMarket("us");
  assert.equal(f.controller.state.retryIntent.us, "read");
  assert.match(f.controller.state.errors.us, /其他页面/u);
  assert.equal(writes.length, 1);
  await f.controller.toggleMarket("us");
  assert.equal(writes.length, 1);
  assert.equal(f.controller.state.tasks.us.prompt, "other device");
  assert.equal(f.controller.state.errors.us, null);
});
