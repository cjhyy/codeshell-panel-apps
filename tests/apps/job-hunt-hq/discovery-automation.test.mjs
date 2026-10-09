import test from "node:test";
import assert from "node:assert/strict";
import { DISCOVERY_AUTOMATION_KEY as marker, discoveryAutomationMethod, readDiscoveryAutomation, saveDiscoveryAutomationTask, controlDiscoveryAutomationTask } from "../../../apps/job-hunt-hq/app/discovery-automation.mjs";
import { createDiscoveryAutomationHost } from "./fixtures/discovery-automation-host.mjs";

const legacyActions = ["list", "create", "update", "delete", "pause", "resume", "runNow"];
const modern = { availableMethods: [...legacyActions, "createUnique", "updateIfRevision", "deleteIfRevision"].map(action => `automations.${action}`) };
const legacy = { apiVersion: 5 };
const patch = { name: "scheduled JD", schedule: "0 9 * * *", prompt: `${marker}\nTARGET_FULL_JDS=8`, timezone: "Asia/Singapore" };
const task = { ...patch, id: "original", enabled: true, runCount: 0 };
const writes = host => host.calls.filter(call => call.method !== "automations.list");

test("unreadable, malformed and duplicate lists never become an empty schedule", async () => {
  for (const failure of ["failRead", "malformedList"]) {
    const host = createDiscoveryAutomationHost(); host[failure] = true;
    await assert.rejects(saveDiscoveryAutomationTask(host.call, modern, null, patch));
    assert.equal(writes(host).length, 0);
  }
  for (const tasks of [[{ prompt: marker }], [task, { ...task, id: "duplicate" }]]) {
    const host = createDiscoveryAutomationHost({ a: tasks });
    await assert.rejects(readDiscoveryAutomation(host.call));
    await assert.rejects(saveDiscoveryAutomationTask(host.call, modern, null, patch));
    assert.equal(writes(host).length, 0);
  }
});

test("simultaneous pages create only one task with the stable discovery key", async () => {
  const host = createDiscoveryAutomationHost();
  const [one, two] = await Promise.all([
    saveDiscoveryAutomationTask(host.call, modern, null, patch),
    saveDiscoveryAutomationTask(host.call, modern, null, patch),
  ]);
  assert.equal(one.id, two.id);
  assert.equal(host.tasks.a.length, 1);
  assert.deepEqual(writes(host).map(call => [call.method, call.params.key]), [
    ["automations.createUnique", marker], ["automations.createUnique", marker],
  ]);
});

test("a unique-create race does not claim the losing page's different form was saved", async () => {
  const host = createDiscoveryAutomationHost();
  const results = await Promise.allSettled([
    saveDiscoveryAutomationTask(host.call, modern, null, patch),
    saveDiscoveryAutomationTask(host.call, modern, null, { ...patch, schedule: "30 10 * * *" }),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].reason.code, "AUTOMATION_UNCERTAIN");
  assert.equal(host.tasks.a[0].schedule, patch.schedule);
});

test("a unique create returning an existing different definition requires review without updating it", async () => {
  const calls = [];
  await assert.rejects(saveDiscoveryAutomationTask(async (method, params) => {
    calls.push({ method, params });
    if (method === "automations.list") return { automations: [] };
    return { ...task, schedule: "30 10 * * *" };
  }, modern, null, patch), { code: "AUTOMATION_CONFLICT" });
  assert.deepEqual(calls.map(call => call.method), ["automations.list", "automations.createUnique"]);
});

test("pre-key legacy discovery tasks are reused rather than duplicated after upgrade", async () => {
  const host = createDiscoveryAutomationHost({ a: [task] });
  await assert.rejects(saveDiscoveryAutomationTask(host.call, modern, null, patch), { code: "AUTOMATION_CONFLICT" });
  assert.equal(writes(host).length, 0);
  const existing = await readDiscoveryAutomation(host.call);
  const updated = await saveDiscoveryAutomationTask(host.call, modern, existing, { ...patch, schedule: "30 10 * * *" });
  assert.equal(updated.id, task.id);
  assert.equal(host.tasks.a.length, 1);
});

test("conditional edit and delete reject another page's changed definition", async () => {
  const host = createDiscoveryAutomationHost({ a: [task] });
  const stale = await readDiscoveryAutomation(host.call);
  const fresh = await saveDiscoveryAutomationTask(host.call, modern, stale, { ...patch, schedule: "30 10 * * *" });
  assert.notEqual(fresh.revision, stale.revision);
  await assert.rejects(saveDiscoveryAutomationTask(host.call, modern, stale, patch), { code: "AUTOMATION_CONFLICT" });
  await assert.rejects(controlDiscoveryAutomationTask(host.call, modern, stale, "delete"), { code: "AUTOMATION_CONFLICT" });
  assert.equal(host.tasks.a[0].schedule, "30 10 * * *");
  assert.equal(await controlDiscoveryAutomationTask(host.call, modern, fresh, "delete"), null);
  assert.equal(host.tasks.a.length, 0);
  assert.equal(writes(host).some(call => ["automations.update", "automations.delete"].includes(call.method)), false);
});

test("missing modern revisions block mutation instead of silently downgrading", async () => {
  const host = createDiscoveryAutomationHost({ a: [task] });
  await assert.rejects(saveDiscoveryAutomationTask(host.call, modern, task, patch), { code: "AUTOMATION_CONFLICT" });
  await assert.rejects(controlDiscoveryAutomationTask(host.call, modern, task, "delete"), { code: "AUTOMATION_CONFLICT" });
  assert.equal(writes(host).length, 0);
});

test("malformed successful edit receipts stay uncertain and never fall back", async () => {
  const host = createDiscoveryAutomationHost({ a: [task] });
  const current = await readDiscoveryAutomation(host.call);
  let requests = 0;
  for (const automation of [null, { ...task, id: "foreign" }, { ...task, schedule: "30 10 * * *" }]) {
    await assert.rejects(saveDiscoveryAutomationTask(async () => {
      requests += 1;
      return { ok: true, automation };
    }, modern, current, patch), { code: "AUTOMATION_UNCERTAIN" });
  }
  assert.equal(requests, 3);
});

test("lost create, edit and delete responses never retry or fall back", async () => {
  for (const action of ["create", "update", "delete"]) {
    const host = createDiscoveryAutomationHost({ a: action === "create" ? [] : [task] });
    const original = await readDiscoveryAutomation(host.call);
    host.loseResponse = discoveryAutomationMethod(modern, action);
    await assert.rejects(action === "delete"
      ? controlDiscoveryAutomationTask(host.call, modern, original, action)
      : saveDiscoveryAutomationTask(host.call, modern, original, { ...patch, schedule: "30 10 * * *" }), { code: "AUTOMATION_UNCERTAIN" });
    const count = writes(host).length;
    const confirmed = await readDiscoveryAutomation(host.call);
    assert.equal(writes(host).length, count);
    assert.equal(count, 1);
    if (action === "delete") assert.equal(confirmed, null);
    else assert.equal(confirmed.schedule, "30 10 * * *");
  }
});

test("legacy operations preflight stale pages and still support explicit fresh operations", async () => {
  const host = createDiscoveryAutomationHost({ a: [task] });
  const stale = await readDiscoveryAutomation(host.call);
  host.tasks.a[0].prompt += "\npeer change";
  await assert.rejects(saveDiscoveryAutomationTask(host.call, legacy, stale, patch), { code: "AUTOMATION_CONFLICT" });
  for (const action of ["delete", "pause", "resume", "runNow"])
    await assert.rejects(controlDiscoveryAutomationTask(host.call, legacy, stale, action), { code: "AUTOMATION_CONFLICT" });
  assert.equal(writes(host).length, 0);
  const current = await readDiscoveryAutomation(host.call);
  const saved = await saveDiscoveryAutomationTask(host.call, legacy, current, patch);
  const paused = await controlDiscoveryAutomationTask(host.call, legacy, saved, "pause");
  assert.equal(paused.enabled, false);
  assert.notEqual(paused.revision, saved.revision);
  const resumed = await controlDiscoveryAutomationTask(host.call, legacy, paused, "resume");
  assert.equal(resumed.enabled, true);
  const ran = await controlDiscoveryAutomationTask(host.call, legacy, resumed, "runNow");
  assert.equal(ran.runCount, 1);
  assert.equal(ran.revision, resumed.revision);
});

test("an uncertain manual run is only read back and is never automatically run again", async () => {
  const host = createDiscoveryAutomationHost({ a: [task] });
  const current = await readDiscoveryAutomation(host.call);
  host.loseResponse = "automations.runNow";
  await assert.rejects(controlDiscoveryAutomationTask(host.call, modern, current, "runNow"), { code: "AUTOMATION_UNCERTAIN" });
  assert.equal((await readDiscoveryAutomation(host.call)).runCount, 1);
  assert.equal(writes(host).length, 1);
});

test("explicit permissions also gate modern conditional methods", async () => {
  const host = createDiscoveryAutomationHost();
  await assert.rejects(saveDiscoveryAutomationTask(host.call, { ...modern, permissions: [] }, null, patch));
  assert.equal(host.calls.length, 0);
});
