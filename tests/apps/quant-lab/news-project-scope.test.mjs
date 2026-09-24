import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createNewsController } from "../../../apps/quant-lab/app/modules/news-ui.mjs";
import {
  NEWS_PATHS,
  parseNewsSubscriptions,
  buildNewsAutomations,
  parseEastmoneyStock,
  emptyNewsCache,
  mergeNewsCache,
  buildNewsFeed,
  parseNotificationLedger,
} from "../../../apps/quant-lab/app/news-feed.mjs";

function node() {
  return {
    dataset: {},
    value: "",
    checked: false,
    children: [],
    listeners: {},
    textContent: "",
    hidden: false,
    disabled: false,
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    setAttribute() {},
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    querySelectorAll() {
      return [];
    },
    get options() {
      return this.children;
    },
  };
}
globalThis.document = { createElement: node };
const now = "2026-08-26T07:00:00.000Z";
const subscriptions = parseNewsSubscriptions(
  JSON.stringify({
    format: "codeshell.news-subscriptions",
    version: 1,
    enabledSources: ["eastmoney-stock"],
    symbols: [{ symbol: "SH600519", market: "cn", origins: ["watch"] }],
    secContact: null,
    updatedAt: now,
  }),
);
const items = parseEastmoneyStock(
  JSON.parse(
    readFileSync(
      new URL("../../../test-fixtures/quant-lab/news-eastmoney-stock.json", import.meta.url),
      "utf8",
    ),
  ),
  "SH600519",
  now,
);
// Two distinct notifications ensure a project switch stops the rest of a batch.
items.push({
  ...items[0],
  id: "second-item",
  sourceId: "second-item",
  title: "另一个项目资讯标题",
  url: "https://finance.eastmoney.com/a/202608260002.html",
});
const feed = buildNewsFeed(
  mergeNewsCache(
    emptyNewsCache(now),
    [{ source: "eastmoney-stock", status: "ok", items }],
    subscriptions,
    now,
  ),
  subscriptions,
  now,
);
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture({ pauseAt = -1, existing = false, drift = false, reject = false } = {}) {
  let epoch = 1;
  const gate = deferred(),
    entered = deferred(),
    elements = new Map(),
    calls = [],
    notes = [];
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  };
  byId("news-source-stock").checked = true;
  const files = new Map([
    [NEWS_PATHS.subscriptions, JSON.stringify(subscriptions)],
    [NEWS_PATHS.feed, JSON.stringify(feed)],
  ]);
  let tasks = existing
    ? buildNewsAutomations(subscriptions).map((plan) => ({
        ...plan,
        id: "old-task",
        revision: "a".repeat(64),
        ...(drift ? { prompt: "old-definition" } : {}),
      }))
    : [];
  const controller = createNewsController({
    root: { querySelector: (id) => byId(id.slice(1)), querySelectorAll: () => [] },
    currentEpoch: () => epoch,
    subscriptionSymbols: () => subscriptions.symbols,
    now: () => new Date(now),
    onRecordNote: (note) => notes.push(note),
    getContext: () => ({
      availableMethods: ["automations.updateIfRevision", "automations.deleteIfRevision"],
    }),
    hostCall: async (method, params) => {
      const index = calls.length;
      calls.push({ method, params, epoch });
      let result;
      if (method === "workspace.list")
        result = {
          entries: [...files.keys()].map((path) => ({ path, kind: "file", modifiedAt: 1 })),
        };
      else if (method === "workspace.readText")
        result = { content: files.get(params.path), modifiedAt: 1 };
      else if (method === "workspace.writeText") {
        files.set(params.path, params.content);
        result = { modifiedAt: 1 };
      } else if (method === "automations.list") result = structuredClone(tasks);
      else if (method === "automations.create") {
        tasks.push({ ...params, id: "new-task" });
        result = tasks.at(-1);
      } else if (method === "automations.deleteIfRevision") {
        tasks = [];
        result = { ok: true };
      } else if (method === "automations.updateIfRevision") {
        tasks = [{ ...tasks[0], ...params }];
        result = { ok: true, automation: tasks[0] };
      } else if (
        method === "notifications.send" ||
        method === "agent.submitPrompt" ||
        method === "external.open"
      )
        result = true;
      else throw Error(`Unexpected method: ${method}`);
      if (index === pauseAt) {
        entered.resolve();
        await gate.promise;
        if (reject) throw Error("old project connection closed");
      }
      return result;
    },
  });
  function seed() {
    controller.state.subscriptions = structuredClone(subscriptions);
    controller.state.subscriptionFile = { exists: true, modifiedAt: 1 };
  }
  function switchProject(changeEpoch = true) {
    if (changeEpoch) epoch++;
    controller.reset();
    controller.state.inFlight = true; // New project has its own pending operation.
    controller.state.readError = "new project state";
    byId("news-refresh").disabled = true;
    byId("news-refresh-state").textContent = "new project refresh";
  }
  return {
    controller,
    seed,
    switchProject,
    gate,
    entered,
    calls,
    files,
    byId,
    notes,
    holdNext: () => {
      pauseAt = calls.length;
    },
  };
}
const workflows = {
  load: (f) => f.controller.load(),
  enable: (f) => f.controller.enable(),
  update: (f) => {
    f.seed();
    return f.controller.updateSymbols();
  },
  create: (f) => {
    f.seed();
    return f.controller.toggleMarket("cn");
  },
  delete: (f) => {
    f.seed();
    return f.controller.toggleMarket("cn");
  },
  repair: (f) => {
    f.seed();
    return f.controller.toggleMarket("cn");
  },
};
for (const [name, run] of Object.entries(workflows)) {
  test(`news ${name}: switching at every Host boundary stops subsequent calls and preserves the next project`, async () => {
    const options = { existing: ["delete", "repair"].includes(name), drift: name === "repair" };
    const baseline = fixture(options);
    await run(baseline);
    assert.ok(baseline.calls.length > 0);
    assert.equal(baseline.controller.state.readError, null);
    assert.deepEqual(baseline.controller.state.taskErrors, { cn: null, us: null });
    const mutation = {
      create: "create",
      enable: "create",
      update: "create",
      delete: "deleteIfRevision",
      repair: "updateIfRevision",
    }[name];
    if (mutation)
      assert.ok(baseline.calls.some((call) => call.method === `automations.${mutation}`));
    if (name === "load") {
      assert.equal(baseline.calls.filter((call) => call.method === "notifications.send").length, 2);
      const ledger = parseNotificationLedger(baseline.files.get(NEWS_PATHS.notified));
      assert.equal(ledger.records.filter((record) => record.state === "sent").length, 2);
    }
    for (let pauseAt = 0; pauseAt < baseline.calls.length; pauseAt++) {
      for (const reject of [false, true]) {
        const f = fixture({ ...options, pauseAt, reject });
        const pending = run(f);
        await f.entered.promise;
        f.switchProject(pauseAt % 2 === 0); // Also cover reset before the epoch changes.
        const expected = structuredClone(f.controller.state);
        const count = f.calls.length;
        const live = f.byId("news-live-status").textContent;
        f.gate.resolve();
        await pending;
        assert.deepEqual(f.controller.state, expected, `${name} at ${pauseAt}`);
        assert.equal(f.calls.length, count, `extra Host call after ${name} at ${pauseAt}`);
        assert.equal(f.byId("news-live-status").textContent, live);
        assert.equal(f.byId("news-refresh").disabled, true);
      }
    }
  });
}

test("news: stale explicit load makes no calls", async () => {
  const f = fixture();
  await f.controller.load(0);
  assert.deepEqual(f.calls, []);
});

test("news: a late task failure cannot clear the next project's refresh state", async () => {
  const f = fixture({ pauseAt: 0 });
  f.seed();
  f.byId("news-refresh").listeners.click();
  await f.entered.promise;
  f.switchProject();
  f.gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.byId("news-refresh-state").textContent, "new project refresh");
  assert.equal(f.byId("news-refresh").disabled, true);
  assert.equal(f.controller.state.inFlight, true);
});

test("news: a detached article cannot open an old link or create a note in the new project", async () => {
  const f = fixture();
  await f.controller.load();
  const card = f.byId("news-feed-list").children[0];
  const [open, record] = card.children[0].children[1].children;
  const count = f.calls.length;
  f.switchProject();
  await open.listeners.click();
  record.listeners.click();
  assert.equal(f.calls.length, count);
  assert.deepEqual(f.notes, []);
});

test("news: a late old load cannot replace a successfully loaded new project", async () => {
  const f = fixture({ pauseAt: 0 });
  const oldLoad = f.controller.load();
  await f.entered.promise;
  f.switchProject();
  f.controller.state.inFlight = false;
  f.files.set(
    NEWS_PATHS.subscriptions,
    JSON.stringify({
      ...subscriptions,
      symbols: [{ symbol: "SH600036", market: "cn", origins: ["watch"] }],
    }),
  );
  await f.controller.load();
  const expected = structuredClone(f.controller.state);
  assert.equal(expected.subscriptions.symbols[0].symbol, "SH600036");
  assert.equal(expected.readError, null);
  f.gate.resolve();
  await oldLoad;
  assert.deepEqual(f.controller.state, expected);
});

test("news: switching while an external link confirmation is pending keeps the new status", async () => {
  const f = fixture({ reject: true });
  await f.controller.load();
  const card = f.byId("news-feed-list").children[0];
  const open = card.children[0].children[1].children[0];
  f.holdNext();
  const pending = open.listeners.click();
  await f.entered.promise;
  f.switchProject();
  const expected = f.byId("news-live-status").textContent;
  f.gate.resolve();
  await pending;
  assert.equal(f.byId("news-live-status").textContent, expected);
});
