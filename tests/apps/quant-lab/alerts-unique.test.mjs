import assert from "node:assert/strict";
import test from "node:test";
import { createAlertsController } from "../../../apps/quant-lab/app/modules/alerts-ui.mjs";
import { panelHostCallPriority } from "../../../apps/quant-lab/app/modules/panel-host-call-scheduler.mjs";

const watchlist = () => [
  { id: "rule", symbol: "AAPL", rule: { type: "price-above", threshold: 200 } },
];
function page(hostCall, unique = true) {
  const node = () => ({ dataset: {}, addEventListener() {} });
  const row = () => ({ root: node(), status: node(), button: node(), time: node() });
  const elements = { master: node(), summary: node(), markets: { cn: row(), us: row() } };
  const controller = createAlertsController({
    hostCall,
    elements,
    watchlist,
    getContext: () => ({ availableMethods: unique ? ["automations.createUnique"] : [] }),
  });
  return { controller, elements };
}

test("two pages dispatch the same market identity when both initially see no task", async () => {
  const tasks = [],
    calls = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const hostCall = async (method, params) => {
    calls.push({ method, params });
    if (method === "automations.list") return structuredClone(tasks);
    assert.equal(method, "automations.createUnique");
    if (calls.filter((call) => call.method === method).length === 2) release();
    await gate;
    if (!tasks.length) tasks.push({ id: "one", ...params });
    else assert.deepEqual(params, calls.find((call) => call.method === method).params);
    return tasks[0];
  };
  const a = page(hostCall),
    b = page(hostCall);
  await Promise.all([a.controller.toggleMarket("us"), b.controller.toggleMarket("us")]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].key, "market-alert.us");
  for (const p of [a, b]) {
    assert.equal(p.controller.state.tasks.us.id, "one");
    assert.equal(p.controller.state.errors.us, null);
    assert.doesNotMatch(p.elements.summary.textContent, /不能保证/);
  }
  assert.equal(calls.filter((call) => call.method === "automations.createUnique").length, 2);
  assert.equal(panelHostCallPriority("automations.createUnique"), "interactive");
});

test("lost creation response is reconciled by reads, and manual retry neither deletes nor recreates", async () => {
  const tasks = [],
    calls = [];
  const p = page(async (method, params) => {
    calls.push(method);
    if (method === "automations.list") return structuredClone(tasks);
    assert.equal(method, "automations.createUnique");
    tasks.push({ id: "persisted-before-timeout", ...params });
    throw Error("response lost");
  });
  await p.controller.toggleMarket("us");
  assert.equal(tasks.length, 1);
  assert.match(p.controller.state.errors.us, /未确认.*response lost/);
  assert.equal(p.controller.state.retryIntent.us, "read");
  assert.equal(p.elements.master.disabled, true);
  await p.controller.toggleAll();
  assert.equal(calls.filter((method) => method !== "automations.list").length, 1);
  await p.controller.toggleMarket("us");
  assert.equal(p.controller.state.errors.us, null);
  assert.equal(p.controller.state.tasks.us.id, "persisted-before-timeout");
  assert.equal(calls.filter((method) => method !== "automations.list").length, 1);
});

test("unique creation rejection never falls back to ordinary creation", async () => {
  const calls = [];
  const p = page(async (method) => {
    calls.push(method);
    if (method === "automations.list") return [];
    throw Error("definition conflict");
  });
  await p.controller.toggleMarket("us");
  assert.deepEqual(
    calls.filter((method) => method !== "automations.list"),
    ["automations.createUnique"],
  );
  assert.match(p.controller.state.errors.us, /definition conflict/);
});

test("legacy hosts receive the original request without an ignored identity and show the limitation", async () => {
  const tasks = [],
    calls = [];
  const p = page(async (method, params) => {
    calls.push({ method, params });
    if (method === "automations.list") return structuredClone(tasks);
    assert.equal(method, "automations.create");
    assert.equal(Object.hasOwn(params, "key"), false);
    tasks.push({ id: "legacy", ...params });
  }, false);
  await p.controller.toggleMarket("us");
  assert.equal(p.controller.state.tasks.us.id, "legacy");
  assert.match(p.elements.summary.textContent, /不能保证多个页面同时开启时不重复/);
});
