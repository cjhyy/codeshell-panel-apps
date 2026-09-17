import assert from "node:assert/strict";
import {
  createPanelHostCallScheduler,
  normalizePanelHostCallError,
  panelHostCallCacheKey,
} from "../apps/quant-lab/app/modules/panel-host-call-scheduler.mjs";
import { selectMarketInsightPaths } from "../apps/quant-lab/app/modules/market-insights-ui.mjs";

const timerOptions = {
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancelSchedule: (timer) => clearTimeout(timer),
};

assert.equal(panelHostCallCacheKey("process.find", { name: "node" }), "process.find:node");
assert.equal(
  panelHostCallCacheKey("filesystem.getKnownDirectory", { name: "app-data" }),
  "filesystem.getKnownDirectory:app-data",
);
assert.equal(panelHostCallCacheKey("storage.get", { key: "x" }), "");
assert.match(
  normalizePanelHostCallError(new Error("Panel App rate limit exceeded")).message,
  /自动排队重试/u,
);

{
  const calls = [];
  const scheduler = createPanelHostCallScheduler({
    ...timerOptions,
    invoke: async (method, params) => {
      calls.push({ method, params });
      return { available: true, handle: "runtime:node" };
    },
    maxCalls: 6,
    backgroundCalls: 5,
    windowMs: 30,
  });
  const [first, second] = await Promise.all([
    scheduler.call("process.find", { name: "node" }),
    scheduler.call("process.find", { name: "node" }),
  ]);
  const third = await scheduler.call("process.find", { name: "node" });
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.equal(calls.length, 1, "runtime discovery should be coalesced and cached");
}

{
  const calls = [];
  const scheduler = createPanelHostCallScheduler({
    ...timerOptions,
    invoke: async (method, params) => {
      calls.push({ method, key: params?.key, at: Date.now() });
      return params?.key ?? method;
    },
    maxCalls: 4,
    backgroundCalls: 3,
    windowMs: 35,
    cacheTtlMs: 0,
  });
  const background = Array.from({ length: 6 }, (_, index) =>
    scheduler.call("storage.get", { key: `background-${index}` }),
  );
  const interactive = scheduler.call("workspace.writeText", {
    path: "data/test.json",
    content: "{}",
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls.length, 4, "background restore should leave one immediate interactive slot");
  assert.equal(calls.some((call) => call.method === "workspace.writeText"), true);
  await Promise.all([...background, interactive]);
  assert.equal(calls.length, 7);
  for (const [index, call] of calls.entries()) {
    const withinWindow = calls.filter(
      (candidate, candidateIndex) =>
        candidateIndex >= index && candidate.at - call.at < 35,
    );
    assert.equal(withinWindow.length <= 4, true, "scheduler must stay below the host rolling-window cap");
  }
}

{
  let attempts = 0;
  const scheduler = createPanelHostCallScheduler({
    ...timerOptions,
    invoke: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Panel App rate limit exceeded");
      return "recovered";
    },
    maxCalls: 3,
    backgroundCalls: 2,
    windowMs: 15,
  });
  assert.equal(await scheduler.call("storage.get", { key: "retry" }), "recovered");
  assert.equal(attempts, 2, "a host-side limit response should be retried once after the window");
}

{
  const entries = Array.from({ length: 24 }, (_, index) => ({
    kind: "file",
    path: `data/market-insights/202608${String(31 - index).padStart(2, "0")}T040000000Z-${index % 5 === 4 ? `stock-SH600${String(index).padStart(3, "0")}` : "market-overview"}.json`,
  }));
  const selected = selectMarketInsightPaths(entries);
  assert.equal(selected.total, 24);
  assert.equal(selected.paths.length <= 11, true);
  assert.equal(selected.paths.filter((path) => path.includes("-stock-")).length, 3);
  assert.deepEqual(selected.paths.slice(0, 8), entries.map((entry) => entry.path).sort().reverse().slice(0, 8));
}

console.log("✓ Quant Lab Panel Host call scheduling, recovery and bounded research restore");
