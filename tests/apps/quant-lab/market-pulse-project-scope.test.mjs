import assert from "node:assert/strict";
import test from "node:test";
import {
  createMarketPulseAutomationController,
  buildMarketPulseAutomation,
} from "../../../apps/quant-lab/app/modules/market-insights-ui.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fixture({ pauseAt = -1, existing = false, drift = false, fail = false } = {}) {
  let epoch = 1;
  const gate = deferred(),
    entered = deferred(),
    calls = [],
    notices = [];
  const node = () => ({ dataset: {}, addEventListener() {}, setAttribute() {} });
  const elements = { root: node(), schedule: node(), status: node(), action: node() };
  let tasks = existing
    ? [
        {
          ...buildMarketPulseAutomation(),
          id: "old-task",
          revision: "a".repeat(64),
          ...(drift ? { prompt: "old-definition" } : {}),
        },
      ]
    : [];
  const controller = createMarketPulseAutomationController({
    elements,
    currentEpoch: () => epoch,
    getContext: () => ({
      availableMethods: ["automations.updateIfRevision", "automations.deleteIfRevision"],
    }),
    notify: (...args) => notices.push(args),
    hostCall: async (method, params) => {
      const index = calls.length;
      calls.push({ method, params, epoch });
      let result;
      if (method === "automations.list") result = structuredClone(tasks);
      else if (method === "automations.create") {
        tasks = [{ ...params, id: "new-task" }];
        result = tasks[0];
      } else if (method === "automations.updateIfRevision") {
        tasks = [{ ...tasks[0], ...params }];
        result = { ok: true, automation: tasks[0] };
      } else if (method === "automations.deleteIfRevision") {
        tasks = [];
        result = { ok: true };
      } else throw Error(method);
      if (index === pauseAt) {
        entered.resolve();
        await gate.promise;
        if (fail) throw Error("old connection closed");
      }
      return result;
    },
  });
  const switchProject = (changeEpoch = true) => {
    if (changeEpoch) epoch++;
    controller.reset();
    controller.state.inFlight = true;
    controller.state.error = "new project error";
  };
  return { controller, calls, notices, gate, entered, elements, switchProject };
}
for (const action of ["create", "update", "delete"]) {
  test(`market pulse ${action}: every pending Host result is scoped to its starting project`, async () => {
    const options = { existing: action !== "create", drift: action === "update" };
    const baseline = fixture(options);
    await baseline.controller.toggle();
    assert.equal(baseline.controller.state.error, null);
    assert.equal(baseline.notices.length, 1);
    assert.ok(
      baseline.calls.some(
        ({ method }) =>
          method ===
          (action === "create" ? "automations.create" : `automations.${action}IfRevision`),
      ),
    );
    for (let pauseAt = 0; pauseAt < baseline.calls.length; pauseAt++) {
      for (const fail of [false, true]) {
        const f = fixture({ ...options, pauseAt, fail });
        const pending = f.controller.toggle();
        await f.entered.promise;
        f.switchProject(pauseAt % 2 === 0);
        const expected = structuredClone(f.controller.state);
        const count = f.calls.length;
        f.gate.resolve();
        await pending;
        assert.deepEqual(f.controller.state, expected, `${action} at ${pauseAt}`);
        assert.equal(f.calls.length, count);
        assert.deepEqual(f.notices, []);
      }
    }
  });
}

test("market pulse: old load settlement cannot erase a new in-flight load or populate its state", async () => {
  for (const reject of [false, true]) {
    const first = deferred(),
      second = deferred();
    let calls = 0,
      epoch = 1;
    const node = () => ({ dataset: {}, addEventListener() {}, setAttribute() {} });
    const controller = createMarketPulseAutomationController({
      elements: { root: node(), schedule: node(), status: node(), action: node() },
      currentEpoch: () => epoch,
      hostCall: () => (++calls === 1 ? first.promise : second.promise),
    });
    const oldLoad = controller.load();
    epoch++;
    controller.reset();
    const newLoad = controller.load();
    if (reject) first.reject(Error("old host offline"));
    else first.resolve([{ ...buildMarketPulseAutomation(), id: "old-project" }]);
    await oldLoad;
    assert.equal(controller.state.loaded, false);
    assert.equal(controller.state.error, null);
    assert.equal(controller.load(), newLoad);
    assert.equal(calls, 2);
    second.resolve([{ ...buildMarketPulseAutomation(), id: "new-project" }]);
    await newLoad;
    assert.equal(controller.state.task.id, "new-project");
  }
});
