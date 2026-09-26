import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createSelectionSignalLabController } from "../../../apps/quant-lab/app/modules/selection-signal-lab.mjs";
class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.value = "";
    this.textContent = "";
  }
  append(...items) {
    this.children.push(...items);
  }
  replaceChildren(...items) {
    this.children = items;
  }
  setAttribute() {}
  addEventListener(name, action) {
    this.listeners[name] = action;
  }
  querySelectorAll() {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll()]);
  }
  closest(selector) {
    return selector === "[data-signal-value]" && this.dataset.signalValue !== undefined
      ? this
      : null;
  }
  click() {
    return this.listeners.click?.({ target: this });
  }
}
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
function fixture(original = null) {
  const values = new Map([["A", original]]),
    calls = [];
  let failRead = false,
    lose = false;
  const snapshot = (key) => {
    const value = values.get(key) ?? null;
    return {
      exists: value !== null,
      value: structuredClone(value),
      revision:
        value === null
          ? null
          : `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`,
    };
  };
  const host = async (method, params) => {
    calls.push({ method, params: structuredClone(params) });
    if (["storage.get", "storage.getSnapshot"].includes(method)) {
      if (failRead) throw Error("read failed");
      return method === "storage.get" ? snapshot(params.key).value : snapshot(params.key);
    }
    if (method === "storage.set") {
      values.set(params.key, structuredClone(params.value));
      return {};
    }
    assert.equal(method, "storage.compareAndSet");
    const updated = snapshot(params.key).revision === params.expectedRevision;
    if (updated) values.set(params.key, structuredClone(params.value));
    if (lose) throw Error("lost receipt");
    return { updated, snapshot: snapshot(params.key) };
  };
  function client(options = {}) {
    let epoch = 0,
      key = "A";
    const elements = Object.fromEntries(
      [
        "mode",
        "add",
        "export",
        "reset",
        "conditions",
        "count",
        "summary",
        "results",
        "status",
        "reload",
        "backup",
        "warning",
      ].map((name) => [name, new Element()]),
    );
    const controller = createSelectionSignalLabController({
      hostCall: host,
      storageKey: () => key,
      currentEpoch: () => epoch,
      getContext: () => ({
        cwd: "/workspace",
        sessionId: key,
        availableMethods: ["storage.getSnapshot", "storage.compareAndSet"],
      }),
      getSnapshot: () => null,
      onStock() {},
      elements,
      ...options,
    });
    return {
      controller,
      elements,
      switchProject() {
        epoch++;
        key = "B";
        controller.reset();
      },
      async mode(value) {
        elements.mode.value = value;
        elements.mode.listeners.change();
        await flush();
      },
    };
  }
  return {
    values,
    calls,
    client,
    host,
    failRead(value) {
      failRead = value;
    },
    lose(value) {
      lose = value;
    },
  };
}
const originalDocument = globalThis.document;
test.before(() => {
  globalThis.document = { createElement: (tag) => new Element(tag) };
});
test.after(() => {
  globalThis.document = originalDocument;
});

test("another device's signal is preserved, local draft remains and reload is explicit", async () => {
  const f = fixture(),
    a = f.client(),
    b = f.client();
  await Promise.all([a.controller.load(), b.controller.load()]);
  await a.mode("or");
  b.elements.add.click();
  await flush();
  assert.equal(f.values.get("A").mode, "or");
  assert.equal(b.controller.signal.conditions.length, 4);
  assert.match(b.elements.status.textContent, /其他页面或设备/);
  const writes = f.calls.filter(
    (call) => call.method.includes("Set") || call.method === "storage.set",
  ).length;
  b.elements.reset.click();
  await flush();
  assert.equal(
    f.calls.filter((call) => call.method.includes("Set") || call.method === "storage.set").length,
    writes,
  );
  await b.elements.reload.click();
  await flush();
  assert.equal(b.controller.signal.mode, "or");
  await b.mode("and");
  assert.equal(f.values.get("A").mode, "and");
});

test("failed or malformed reads cannot become an empty record that is automatically overwritten", async () => {
  for (const bad of [
    { version: 2, mode: "and", conditions: [] },
    { version: 1, mode: "oops", conditions: [{ field: "return20", operator: ">", value: 0 }] },
    {
      version: 1,
      mode: "and",
      conditions: [{ field: "return20", operator: ">", value: 0 }],
      future: "keep",
    },
  ]) {
    const f = fixture(bad),
      a = f.client();
    await a.controller.load();
    await a.mode("or");
    assert.deepEqual(f.values.get("A"), bad);
    assert.equal(
      f.calls.some(
        (call) => call.method === "storage.set" || call.method === "storage.compareAndSet",
      ),
      false,
    );
  }
  const f = fixture(),
    a = f.client();
  f.failRead(true);
  await a.controller.load();
  await a.mode("or");
  assert.equal(
    f.calls.some((call) => call.method === "storage.compareAndSet"),
    false,
  );
});

test("lost successful acknowledgement is read back once without repeating the signal write", async () => {
  const f = fixture(),
    a = f.client();
  await a.controller.load();
  f.lose(true);
  await a.mode("or");
  assert.equal(f.values.get("A").mode, "or");
  assert.equal(f.calls.filter((call) => call.method === "storage.compareAndSet").length, 1);
  assert.match(a.elements.status.textContent, /已保存/);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a delayed old-project read cannot populate the new project's controls", async () => {
  const f = fixture({
    version: 1,
    mode: "or",
    conditions: [{ field: "return20", operator: ">", value: 5 }],
  });
  const hold = deferred();
  let pause = true;
  const a = f.client({
    hostCall: async (method, params) => {
      const result = await f.host(method, params);
      if (pause) {
        pause = false;
        await hold.promise;
      }
      return result;
    },
  });
  const old = a.controller.load();
  await flush();
  a.switchProject();
  await a.controller.load();
  hold.resolve();
  await old;
  assert.equal(a.controller.signal.mode, "and");
  assert.equal(a.elements.mode.value, "and");
  assert.equal(a.elements.mode.disabled, false);
});

test("switching projects stops queued old writes and suppresses the late saved message", async () => {
  const f = fixture(),
    hold = deferred();
  const a = f.client({
    hostCall: async (method, params) => {
      const result = await f.host(method, params);
      if (method === "storage.compareAndSet") await hold.promise;
      return result;
    },
  });
  await a.controller.load();
  await a.mode("or");
  await a.mode("and");
  a.switchProject();
  await a.controller.load();
  const status = a.elements.status.textContent;
  hold.resolve();
  await flush();
  assert.equal(f.calls.filter((call) => call.method === "storage.compareAndSet").length, 1);
  assert.equal(f.values.has("B"), false);
  assert.equal(a.elements.status.textContent, status);
});

test("an earlier save cannot report a later blank threshold as saved", async () => {
  const f = fixture(),
    hold = deferred();
  const a = f.client({
    hostCall: async (method, params) => {
      const result = await f.host(method, params);
      if (method === "storage.compareAndSet") await hold.promise;
      return result;
    },
  });
  await a.controller.load();
  await a.mode("or");
  const input = new Element("input");
  input.dataset.signalValue = "0";
  input.value = "";
  a.elements.conditions.listeners.change({ target: input });
  hold.resolve();
  await flush();
  assert.match(a.elements.status.textContent, /有效阈值/);
  assert.equal(f.calls.filter((call) => call.method === "storage.compareAndSet").length, 1);
});

test("legacy Host keeps its existing storage path with a visible concurrency limitation", async () => {
  const f = fixture(),
    a = f.client({ getContext: () => ({ availableMethods: ["storage.get", "storage.set"] }) });
  await a.controller.load();
  await a.mode("or");
  assert.equal(a.elements.warning.hidden, false);
  assert.equal(f.calls.filter((call) => call.method === "storage.set").length, 1);
  assert.equal(f.values.get("A").mode, "or");
});

test("a delayed export never reads the old path through the newly selected project", async () => {
  const f = fixture(),
    hold = deferred(),
    exports = [],
    notifications = [];
  const a = f.client({
    getSnapshot: () => ({
      marketDate: "2026-09-27",
      sectors: [
        {
          name: "Fixture",
          candidates: [
            {
              symbol: "fixture",
              name: "Fixture",
              relativeScore: 80,
              metrics: { return20: 1, extension20: 1, volumeRatio: 1 },
            },
          ],
        },
      ],
    }),
    notify: (value) => notifications.push(value),
    hostCall: async (method, params) => {
      if (!method.startsWith("workspace.")) return f.host(method, params);
      exports.push({ method, params });
      if (method === "workspace.writeText") {
        await hold.promise;
        return {};
      }
      throw Error("must not read after project switch");
    },
  });
  await a.controller.load();
  const pending = a.elements.export.click();
  await flush();
  a.switchProject();
  hold.resolve();
  await pending;
  assert.deepEqual(
    exports.map((value) => value.method),
    ["workspace.writeText"],
  );
  assert.deepEqual(notifications, []);
});
