import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { observe, OBSERVATION_MAX_DURATION_MS } from "../shared/observation-runner.mjs";

async function fixture(t, overrides = {}) {
  const project = await mkdtemp(join(tmpdir(), "panel-observation-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  let time = new Date("2026-10-21T04:00:00Z"), calls = 0;
  const options = { project, app: "fixture", package: { version: "1", codeSha256: "fixture", toolPath: "/fixture/tool.mjs" }, clock: () => time, execute: async () => { calls++; return { readOnly: true }; }, ...overrides };
  const run = (action, extra = {}) => observe({ action, runId: "fixture", ...extra }, options);
  await run("plan", { task: {}, intervalSeconds: 10, maxTicks: 3, backoffBaseSeconds: 5, backoffMaxSeconds: 20 });
  return { project, options, run, calls: () => calls, setTime: value => { time = new Date(value); } };
}

test("one-shot ticks honor interval, absolute deadline and max rounds with final receipts", async t => {
  const f = await fixture(t);
  const first = await f.run("tick"); assert.equal(first.state.ticks, 1);
  assert.equal((await f.run("tick")).skipped, "not_due"); assert.equal(f.calls(), 1);
  f.setTime("2026-10-21T04:00:10Z"); await f.run("tick");
  f.setTime("2026-10-21T04:00:20Z"); assert.equal((await f.run("tick")).state.status, "completed");
  f.setTime(new Date(Date.parse("2026-10-21T04:00:00Z") + OBSERVATION_MAX_DURATION_MS).toISOString());
  assert.equal((await f.run("tick")).state.status, "expired"); assert.equal(f.calls(), 3);
  assert.match(await readFile(join(f.project, "observations/fixture/final.md"), "utf8"), /不代表已运行满 24 小时/);
});

test("status is read-only; stop is durable and prevents future work", async t => {
  const f = await fixture(t);
  assert.equal((await f.run("status")).effectiveStatus, "scheduled");
  await assert.rejects(readFile(join(f.project, "observations/fixture/state.json")), e => e.code === "ENOENT");
  await f.run("stop");
  assert.equal((await f.run("status")).effectiveStatus, "stopped");
  assert.equal((await f.run("tick")).state.status, "stopped"); assert.equal(f.calls(), 0);
});

test("overlapping ticks and live locks skip without deleting ownership; only dead owners are reclaimed", async t => {
  let resume, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { execute: async () => { entered(); await new Promise(resolve => { resume = resolve; }); return {}; } });
  const first = f.run("tick"); await started;
  assert.equal((await f.run("tick")).skipped, "overlap");
  resume(); await first;
  const lock = join(f.project, "observations/fixture/tick.lock");
  await mkdir(lock); await writeFile(join(lock, `owner-${process.pid}-live.json`), JSON.stringify({ pid: process.pid, token: "live" }));
  f.setTime("2026-10-21T05:00:00Z");
  assert.equal((await f.run("tick")).skipped, "overlap");
  assert.equal(JSON.parse(await readFile(join(lock, `owner-${process.pid}-live.json`))).token, "live");
  f.options.alive = () => false; f.options.execute = async () => ({});
  assert.equal((await f.run("tick")).state.ticks, 2);
});

test("failure backoff and consecutive failure cap are deterministic", async t => {
  const f = await fixture(t, { execute: async () => { throw new Error("fixture failure"); } });
  const first = await f.run("tick"); assert.equal(first.state.nextEligibleAt, "2026-10-21T04:00:05.000Z");
  assert.equal((await f.run("tick")).skipped, "not_due");
  f.setTime(first.state.nextEligibleAt); const second = await f.run("tick"); assert.equal(second.state.nextEligibleAt, "2026-10-21T04:00:15.000Z");
  f.setTime(second.state.nextEligibleAt); assert.equal((await f.run("tick")).state.status, "failed");
  f.setTime("2026-10-21T06:00:00Z"); assert.equal((await f.run("tick")).state.ticks, 3);
});

test("plan cutoff, package identity, path traversal, bad state and symlinks fail visibly", async t => {
  const f = await fixture(t);
  await assert.rejects(observe({ action: "plan", runId: "other", task: {}, deadline: "2026-10-23T00:00:00Z" }, f.options), /deadline/);
  await assert.rejects(observe({ action: "status", runId: "../outside" }, f.options), /runId/);
  f.options.package = { ...f.options.package, version: "2" };
  assert.equal((await f.run("tick")).state.status, "package_changed"); assert.equal(f.calls(), 0);
  const state = join(f.project, "observations/fixture/state.json");
  await writeFile(state, "{bad"); await assert.rejects(f.run("status"), /损坏/);
  await rm(state); await symlink(join(f.project, "outside"), state);
  await assert.rejects(f.run("tick"), e => e.code === "INVALID_PATH");
  const other = await mkdtemp(join(tmpdir(), "panel-observation-symlink-")); t.after(() => rm(other, { force: true, recursive: true }));
  await symlink(other, join(other, "observations"));
  await assert.rejects(observe({ action: "plan", runId: "nope", task: {} }, { ...f.options, project: other }), e => e.code === "INVALID_PATH");
});

test("receipt recovers state after an interrupted commit without executing another round", async t => {
  const f = await fixture(t); await f.run("tick");
  await writeFile(join(f.project, "observations/fixture/state.json"), JSON.stringify({ status: "scheduled", ticks: 0, consecutiveFailures: 0, startedAt: "2026-10-21T04:00:00Z" }));
  assert.equal((await f.run("tick")).recovered, true); assert.equal(f.calls(), 1);
  assert.equal((await f.run("status")).state.ticks, 1);
});

test("concurrent dead-owner recovery keeps the new live owner and commits one tick", async t => {
  const f = await fixture(t);
  const lock = join(f.project, "observations/fixture/tick.lock");
  await mkdir(lock); await writeFile(join(lock, "owner-999999-dead.json"), JSON.stringify({ pid: 999999, token: "dead" }));
  f.options.alive = pid => pid === process.pid;
  const results = await Promise.all([f.run("tick"), f.run("tick"), f.run("tick")]);
  assert.equal(f.calls(), 1);
  assert.equal(results.filter(result => result.state.ticks === 1 && !result.skipped).length, 1);
});

test("recovering the final failed receipt still honors the failure cap before more work", async t => {
  const f = await fixture(t, { execute: async () => { throw new Error("failure"); } });
  for (const time of ["2026-10-21T04:00:00Z", "2026-10-21T04:00:05Z", "2026-10-21T04:00:15Z"]) { f.setTime(time); await f.run("tick"); }
  const receipt = JSON.parse(await readFile(join(f.project, "observations/fixture/ticks/0003.json")));
  await writeFile(join(f.project, "observations/fixture/state.json"), JSON.stringify({ ...receipt.nextState, ticks: 2, consecutiveFailures: 2 }));
  assert.equal((await f.run("tick")).state.status, "failed");
});

test("ending again preserves the original finish time instead of extending observation duration", async t => {
  const f = await fixture(t); await f.run("tick"); await f.run("stop");
  const first = await f.run("tick");
  f.setTime("2026-10-21T06:00:00Z");
  const second = await f.run("tick"); assert.equal(second.state.finishedAt, first.state.finishedAt);
  assert.match(await readFile(join(f.project, "observations/fixture/final.md"), "utf8"), /实际经过：0 秒/);
});


test("a new plan remains usable after the original task date and is capped at its own 24 hours", async t => {
  const f = await fixture(t); f.setTime("2027-01-03T10:00:00Z");
  const plan = await observe({ action: "plan", runId: "future", task: {} }, f.options);
  assert.equal(plan.plan.deadline, "2027-01-04T10:00:00.000Z");
  await assert.rejects(observe({ action: "plan", runId: "too-long", task: {}, deadline: "2027-01-04T10:00:00.001Z" }, f.options), /deadline/);
  assert.equal((await observe({ action: "tick", runId: "future" }, f.options)).state.ticks, 1);
  f.setTime(plan.plan.deadline);
  assert.equal((await observe({ action: "tick", runId: "future" }, f.options)).state.status, "expired");
  assert.equal(f.calls(), 1);
});
