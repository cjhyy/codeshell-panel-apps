import assert from "node:assert/strict";
import test from "node:test";
import { createNewsController } from "../../../apps/quant-lab/app/modules/news-ui.mjs";
import { createMarketPulseAutomationController } from "../../../apps/quant-lab/app/modules/market-insights-ui.mjs";
import { parseNewsSubscriptions } from "../../../apps/quant-lab/app/news-feed.mjs";

function element() {
  return {
    dataset: {},
    value: "",
    checked: false,
    textContent: "",
    children: [],
    addEventListener() {},
    setAttribute() {},
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    get options() {
      return this.children;
    },
  };
}
globalThis.document = { createElement: element };
function page(kind, hostCall, unique = true) {
  const methods = unique ? ["automations.createUnique"] : [];
  const getContext = () => ({ availableMethods: methods });
  if (kind === "pulse") {
    const elements = { root: element(), status: element(), schedule: element(), action: element() };
    const controller = createMarketPulseAutomationController({ hostCall, getContext, elements });
    return {
      toggle: () => controller.toggle(),
      error: () => controller.state.error,
      intent: () => controller.state.retryIntent,
      task: () => controller.state.task,
      status: () => elements.status.textContent,
    };
  }
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const market = kind === "news-us" ? "us" : "cn";
  const subscriptions = parseNewsSubscriptions(
    JSON.stringify({
      format: "codeshell.news-subscriptions",
      version: 1,
      enabledSources: market === "us" ? ["sec-edgar"] : ["eastmoney-stock"],
      symbols: [{ symbol: market === "us" ? "AAPL" : "SH600519", market, origins: ["watch"] }],
      secContact: market === "us" ? "Test app test@example.com" : null,
      updatedAt: "2026-09-24T00:00:00.000Z",
    }),
  );
  const controller = createNewsController({
    hostCall,
    getContext,
    currentEpoch: () => 1,
    root: { querySelector: (id) => byId(id.slice(1)), querySelectorAll: () => [] },
    subscriptionSymbols: () => subscriptions.symbols,
  });
  controller.state.subscriptions = subscriptions;
  return {
    toggle: () => controller.toggleMarket(market),
    error: () => controller.state.taskErrors[market],
    intent: () => controller.state.taskRetryIntent[market],
    task: () => controller.state.tasks[0],
    status: () => byId(`news-automation-${market}-status`).textContent,
  };
}
const kinds = { "news-cn": "news-sync.cn", "news-us": "news-sync.us", pulse: "market-pulse.daily" };
for (const [kind, key] of Object.entries(kinds)) {
  test(`${kind}: two simultaneous pages use the same unique identity and retain one task`, async () => {
    const tasks = [],
      calls = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const host = async (method, params) => {
      calls.push({ method, params });
      if (method === "automations.list") return structuredClone(tasks);
      assert.equal(method, "automations.createUnique");
      assert.equal(params.key, key);
      if (calls.filter((call) => call.method === method).length === 2) release();
      await gate;
      if (!tasks.length) tasks.push({ id: "one-task", ...params });
      else assert.deepEqual(params, calls.find((call) => call.method === method).params);
      return structuredClone(tasks[0]);
    };
    const a = page(kind, host),
      b = page(kind, host);
    await Promise.all([a.toggle(), b.toggle()]);
    assert.equal(tasks.length, 1);
    for (const p of [a, b]) {
      assert.equal(p.task().id, "one-task");
      assert.equal(p.error(), null);
      assert.equal(p.intent(), null);
      assert.doesNotMatch(p.status(), /不能保证/);
    }
  });

  for (const failure of ["response-lost", "verification-lost", "definition-conflict"]) {
    test(`${kind}: ${failure} only permits a read on the first retry, preserving another device's edit`, async () => {
      const tasks = [],
        writes = [];
      let failRead = false;
      const p = page(kind, async (method, params) => {
        if (method === "automations.list") {
          if (failRead) {
            failRead = false;
            throw Error("verification unavailable");
          }
          return structuredClone(tasks);
        }
        writes.push({ method, params });
        assert.equal(method, "automations.createUnique");
        assert.equal(params.key, key);
        tasks.push({ id: "retained", ...params, prompt: "Other device definition" });
        if (failure === "verification-lost") {
          failRead = true;
          return structuredClone(tasks[0]);
        }
        throw Error(failure);
      });
      await p.toggle();
      assert.equal(p.intent(), "read");
      assert.ok(p.error());
      await p.toggle();
      assert.equal(p.intent(), null);
      assert.equal(p.error(), null);
      assert.equal(p.task().prompt, "Other device definition");
      assert.equal(writes.length, 1);
    });
  }

  test(`${kind}: a successful create with a mismatched verification cannot trigger an automatic update`, async () => {
    const tasks = [],
      writes = [];
    const p = page(kind, async (method, params) => {
      if (method === "automations.list") return structuredClone(tasks);
      writes.push(method);
      assert.equal(method, "automations.createUnique");
      tasks.push({ id: "retained", ...params, schedule: "0 0 * * *" });
      return structuredClone(tasks[0]);
    });
    await p.toggle();
    assert.equal(p.intent(), "read");
    await p.toggle();
    assert.equal(p.task().schedule, "0 0 * * *");
    assert.equal(writes.length, 1);
  });

  test(`${kind}: absent tasks after an uncertain creation are read before an explicit new attempt`, async () => {
    const writes = [];
    const p = page(kind, async (method) => {
      if (method === "automations.list") return [];
      writes.push(method);
      throw Error("request lost");
    });
    await p.toggle();
    await p.toggle();
    assert.deepEqual(writes, ["automations.createUnique"]);
    assert.equal(p.error(), null);
    await p.toggle();
    assert.deepEqual(writes, ["automations.createUnique", "automations.createUnique"]);
  });

  test(`${kind}: legacy creation retains the old contract and displays its concurrency limit`, async () => {
    const tasks = [];
    const p = page(
      kind,
      async (method, params) => {
        if (method === "automations.list") return structuredClone(tasks);
        assert.equal(method, "automations.create");
        assert.equal(Object.hasOwn(params, "key"), false);
        tasks.push({ id: "legacy", ...params });
        return tasks[0];
      },
      false,
    );
    await p.toggle();
    assert.equal(p.error(), null);
    assert.equal(p.task().id, "legacy");
    assert.match(p.status(), /不能保证多个页面同时开启时不重复/);
  });
}
