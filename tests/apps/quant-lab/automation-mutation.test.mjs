import assert from "node:assert/strict";
import test from "node:test";
import { mutateAutomation } from "../../../apps/quant-lab/app/modules/automation-mutation.mjs";

const task = { id: "job", revision: "a".repeat(64) };
const context = () => ({
  availableMethods: ["automations.updateIfRevision", "automations.deleteIfRevision"],
});
test("both mutation paths send the observed revision and treat conflict without a legacy retry", async () => {
  for (const action of ["update", "delete"]) {
    const calls = [];
    await assert.rejects(
      mutateAutomation(
        async (method, params) => {
          calls.push({ method, params });
          return { ok: false, conflict: true };
        },
        context,
        action,
        task,
        action === "update" ? { prompt: "new" } : {},
      ),
      { code: "AUTOMATION_CONFLICT" },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, `automations.${action}IfRevision`);
    assert.equal(calls[0].params.expectedRevision, task.revision);
  }
});
test("advertised support with a missing revision refuses dispatch, and uncertain writes are never repeated", async () => {
  let calls = 0;
  const host = async () => {
    calls++;
    throw Error("reply lost");
  };
  await assert.rejects(mutateAutomation(host, context, "delete", { id: "job" }), {
    code: "AUTOMATION_CONFLICT",
  });
  assert.equal(calls, 0);
  await assert.rejects(
    mutateAutomation(host, context, "update", task, { prompt: "new" }),
    /reply lost/u,
  );
  assert.equal(calls, 1);
});
test("a legacy Host retains its explicit old contract", async () => {
  const result = await mutateAutomation(
    async (method, params) => ({ method, params }),
    () => ({}),
    "delete",
    task,
  );
  assert.deepEqual(result, { method: "automations.delete", params: { id: "job" } });
});

test("market pulse preserves a conflicting task and requires a read before a new decision", async () => {
  const { createMarketPulseAutomationController, buildMarketPulseAutomation } =
    await import("../../../apps/quant-lab/app/modules/market-insights-ui.mjs");
  const element = () => ({ dataset: {}, addEventListener() {}, setAttribute() {} });
  let current = { ...buildMarketPulseAutomation(), ...task };
  let writes = 0;
  const controller = createMarketPulseAutomationController({
    elements: { root: element(), schedule: element(), status: element(), action: element() },
    getContext: context,
    hostCall: async (method, params) => {
      if (method === "automations.list") return { automations: [structuredClone(current)] };
      assert.equal(method, "automations.deleteIfRevision");
      assert.equal(params.expectedRevision, task.revision);
      writes++;
      current = { ...current, prompt: "from another device", revision: "b".repeat(64) };
      return { ok: false, conflict: true };
    },
  });
  await controller.load();
  await controller.toggle();
  assert.equal(controller.state.retryIntent, "read");
  assert.match(controller.state.error, /其他页面/u);
  await controller.toggle();
  assert.equal(writes, 1);
  assert.equal(controller.state.task.prompt, "from another device");
  assert.equal(controller.state.retryIntent, null);
});
