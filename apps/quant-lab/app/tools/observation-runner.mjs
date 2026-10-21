// Project-owned, one-shot observation. No timers, network, model calls or OS services.
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

export const OBSERVATION_MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 4 * 1024 * 1024;
const fail = (code, message) => Object.assign(new Error(message), { code });
const terminal = new Set(["expired", "stopped", "failed", "completed", "package_changed"]);
const isAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; } };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const shape = value => value && typeof value === "object" && !Array.isArray(value);
const bounded = (value, fallback, minimum, maximum, key) => {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < minimum || n > maximum) throw fail("INVALID_INPUT", `${key} 需要 ${minimum}..${maximum} 整数`);
  return n;
};

async function files(project, base) {
  const root = await realpath(resolve(project)), rootInfo = await lstat(root);
  if (!rootInfo.isDirectory()) throw fail("INVALID_PATH", "项目必须是目录");
  const checkRoot = async () => { if (!same(rootInfo, await lstat(root))) throw fail("INVALID_PATH", "项目目录已被替换"); };
  async function target(path, createParent = false) {
    await checkRoot();
    if (isAbsolute(path) || path.split("/").some(p => !p || p === "." || p === ".." || /[\\:\u0000-\u001f]/.test(p))) throw fail("INVALID_PATH", "观察路径无效");
    const parts = path.split("/"); let current = root;
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]);
      let info;
      try { info = await lstat(current); }
      catch (e) {
        if (e.code !== "ENOENT") throw e;
        if (i === parts.length - 1) return current;
        if (!createParent) throw e;
        try { await mkdir(current); } catch (error) { if (error.code !== "EEXIST") throw error; }
        info = await lstat(current);
      }
      if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw fail("INVALID_PATH", "观察文件拒绝符号链接及非目录组件");
    }
    const actual = await realpath(current), rel = relative(root, actual);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw fail("INVALID_PATH", "观察路径越过项目");
    return current;
  }
  async function read(path, optional = false) {
    let handle;
    try {
      const full = await target(path);
      handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_BYTES) throw fail("INVALID_PATH", "观察记录不是有界常规文件");
      const value = await handle.readFile({ encoding: "utf8" });
      if (Buffer.byteLength(value) > MAX_BYTES || !same(info, await lstat(await target(path)))) throw fail("INVALID_PATH", "观察文件读取期间变化或超限");
      return value;
    } catch (e) { if (optional && e.code === "ENOENT") return null; throw e; }
    finally { await handle?.close(); }
  }
  async function write(path, value, createOnly = false) {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
    if (Buffer.byteLength(text) > MAX_BYTES) throw fail("OUTPUT_TOO_LARGE", "观察结果超限");
    const full = await target(path, true);
    if (createOnly) {
      const handle = await open(full, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    } else {
      const temp = `${path}.tmp-${randomUUID()}`, tempFull = await target(temp, true);
      const handle = await open(tempFull, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
      try { await target(path); await checkRoot(); await rename(tempFull, full); }
      catch (e) { await unlink(tempFull).catch(() => {}); throw e; }
    }
  }
  return { root, target, read, write, async json(path, optional = false) { const text = await read(path, optional); if (text === null) return null; try { return JSON.parse(text); } catch { throw fail("INVALID_OBSERVATION", `观察 JSON 损坏：${path}`); } }, base };
}

async function lock(fs, alive) {
  const path = `${fs.base}/tick.lock`, full = await fs.target(path, true);
  const token = randomUUID(), ownerName = `owner-${process.pid}-${token}.json`;
  const stage = `${fs.base}/tick-claim-${token}`, stageFull = await fs.target(stage, true);
  await mkdir(stageFull);
  // Publish only a nonempty, complete directory. POSIX rename cannot replace
  // another nonempty directory, so there is no visible owner-creation gap.
  await fs.write(`${stage}/${ownerName}`, { pid: process.pid, token }, true);
  let acquired = false;
  try {
    try { await rename(stageFull, full); acquired = true; }
    catch (e) {
      if (!["EEXIST", "ENOTEMPTY"].includes(e.code)) throw e;
      let entries;
      try { await fs.target(path); entries = await readdir(full); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
      // Empty only while another owner is finishing/reclaiming; never touch it.
      if (!entries.length) return null;
      if (entries.length !== 1 || !/^owner-[0-9]+-[a-zA-Z0-9-]+\.json$/.test(entries[0])) throw fail("INVALID_OBSERVATION", "观察锁记录损坏，未自动移除");
      const name = entries[0];
      let owner;
      try { owner = await fs.json(`${path}/${name}`); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
      if (!Number.isInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== "string" || name !== `owner-${owner.pid}-${owner.token}.json`) throw fail("INVALID_OBSERVATION", "观察锁身份无效");
      if (alive(owner.pid)) return null;
      // Remove only this dead owner's unique file. A contender cannot unlink
      // a new live owner's differently named file. rmdir never removes a
      // nonempty live lock; no rename of an existing lock is used.
      try { await unlink(await fs.target(`${path}/${name}`)); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
      try { await rmdir(full); }
      catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; }
      try { await rename(stageFull, full); acquired = true; }
      catch (error) { if (["EEXIST", "ENOTEMPTY"].includes(error.code)) return null; throw error; }
    }
    const info = await lstat(full);
    return async () => {
      let current;
      try { current = await lstat(full); } catch (e) { if (e.code === "ENOENT") return; throw e; }
      if (!same(info, current)) return;
      try { await unlink(await fs.target(`${path}/${ownerName}`)); }
      catch (e) { if (e.code === "ENOENT") return; throw e; }
      try { await rmdir(full); } catch (e) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(e.code)) throw e; }
    };
  } finally {
    if (!acquired) { await unlink(await fs.target(`${stage}/${ownerName}`)); await rmdir(stageFull); }
  }
}

function validateState(state, plan) {
  if (!shape(state) || !["scheduled", "running", "idle", "backing_off", ...terminal].includes(state.status) || !Number.isInteger(state.ticks) || state.ticks < 0 || state.ticks > plan.maxTicks || !Number.isInteger(state.consecutiveFailures) || state.consecutiveFailures < 0 || state.consecutiveFailures > 10 || (["nextEligibleAt", "firstTickAt", "finishedAt"].some(key => state[key] !== undefined && (!state[key] || !Number.isFinite(Date.parse(state[key])))))) throw fail("INVALID_OBSERVATION", "观察状态损坏");
}

/** execute(task) must be bounded and may only reread existing project data. */
export async function observe(input, { project, app, package: stamp, execute, validateTask = () => {}, clock = () => new Date(), alive = isAlive } = {}) {
  if (!shape(input) || !["plan", "tick", "status", "stop"].includes(input.action) || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(input.runId || "")) throw fail("INVALID_INPUT", "observe 需要 action=plan/tick/status/stop 及安全 runId");
  const allowed = input.action === "plan" ? ["action", "runId", "deadline", "intervalSeconds", "maxTicks", "maxConsecutiveFailures", "backoffBaseSeconds", "backoffMaxSeconds", "task"] : ["action", "runId"];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw fail("INVALID_INPUT", "observe 含未知字段");
  const now = new Date(clock());
  if (!Number.isFinite(+now)) throw fail("INVALID_INPUT", "观察时钟无效");
  const base = `observations/${input.runId}`, fs = await files(project, base);
  const planPath = `${base}/plan.json`, statePath = `${base}/state.json`;
  if (input.action === "plan") {
    const deadline = input.deadline ?? new Date(+now + OBSERVATION_MAX_DURATION_MS).toISOString();
    if (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) > +now + OBSERVATION_MAX_DURATION_MS || Date.parse(deadline) <= +now) throw fail("INVALID_INPUT", "deadline 必须在当前时间之后且不超过创建时起24小时");
    if (!shape(input.task)) throw fail("INVALID_INPUT", "plan 需要 task 对象");
    await validateTask(input.task);
    const plan = { format: "codeshell.observation-plan", version: 1, runId: input.runId, app, createdAt: now.toISOString(), deadline: new Date(deadline).toISOString(), package: stamp, intervalSeconds: bounded(input.intervalSeconds, 3600, 1, 86400, "intervalSeconds"), maxTicks: bounded(input.maxTicks, 30, 1, 100, "maxTicks"), limits: { maxConsecutiveFailures: bounded(input.maxConsecutiveFailures, 3, 1, 10, "maxConsecutiveFailures"), backoffBaseSeconds: bounded(input.backoffBaseSeconds, 60, 1, 86400, "backoffBaseSeconds"), backoffMaxSeconds: bounded(input.backoffMaxSeconds, 3600, 1, 86400, "backoffMaxSeconds") }, task: structuredClone(input.task), capability: "仅重读已有 JD/CSV 生成摘要；没有自动抓取、实时监控或策略验证能力。无 OS 定时器。" };
    await fs.write(planPath, plan, true);
    // A concurrent tick can reconstruct missing state after a plan creation crash.
    return { plan, state: { status: "scheduled", ticks: 0, consecutiveFailures: 0, startedAt: plan.createdAt }, path: base };
  }
  const plan = await fs.json(planPath);
  if (plan?.format !== "codeshell.observation-plan" || plan.version !== 1 || plan.app !== app || plan.runId !== input.runId || !shape(plan.task) || !shape(plan.package) || !Number.isFinite(Date.parse(plan.createdAt)) || !Number.isFinite(Date.parse(plan.deadline)) || (Date.parse(plan.deadline) <= Date.parse(plan.createdAt) || Date.parse(plan.deadline) - Date.parse(plan.createdAt) > OBSERVATION_MAX_DURATION_MS)) throw fail("INVALID_OBSERVATION", "观察计划无效或不属于本应用");
  bounded(plan.intervalSeconds, null, 1, 86400, "intervalSeconds"); bounded(plan.maxTicks, null, 1, 100, "maxTicks");
  if (!shape(plan.limits)) throw fail("INVALID_OBSERVATION", "观察限制缺失");
  bounded(plan.limits.maxConsecutiveFailures, null, 1, 10, "maxConsecutiveFailures"); bounded(plan.limits.backoffBaseSeconds, null, 1, 86400, "backoffBaseSeconds"); bounded(plan.limits.backoffMaxSeconds, null, 1, 86400, "backoffMaxSeconds");
  let state = await fs.json(statePath, true) ?? { status: "scheduled", ticks: 0, consecutiveFailures: 0, startedAt: plan.createdAt };
  validateState(state, plan);
  const stop = `${base}/stop-requested`;
  const stopped = (await fs.read(stop, true)) !== null;
  const effective = stopped ? "stopped" : +now >= Date.parse(plan.deadline) ? "expired" : state.status;
  if (input.action === "status") return { plan, state, effectiveStatus: effective, stopRequested: stopped, path: base };
  if (input.action === "stop") { await fs.write(stop, now.toISOString()); return { state, effectiveStatus: "stopped", stopRequested: true, note: "已写停止标记；后续 tick 不执行任务。没有安装或卸载 OS 定时器。" }; }
  const release = await lock(fs, alive);
  if (!release) return { state, skipped: "overlap" };
  try {
    // Re-read state under the lock, never use a concurrently read stale value.
    state = await fs.json(statePath, true) ?? { status: "scheduled", ticks: 0, consecutiveFailures: 0, startedAt: plan.createdAt };
    validateState(state, plan);
    const recovered = await fs.json(`${base}/ticks/${String(state.ticks + 1).padStart(4, "0")}.json`, true);
    if (recovered) {
      if (recovered.format !== "codeshell.observation-tick" || recovered.version !== 1 || recovered.runId !== plan.runId || recovered.app !== app || recovered.tick !== state.ticks + 1 || recovered.nextState?.ticks !== recovered.tick) throw fail("INVALID_OBSERVATION", "观察回执无法恢复");
      validateState(recovered.nextState, plan);
      state = recovered.nextState;
      await fs.write(statePath, state);
    }
    const stoppedNow = (await fs.read(stop, true)) !== null;
    let status = stoppedNow ? "stopped" : +now >= Date.parse(plan.deadline) ? "expired" : terminal.has(state.status) ? state.status : state.consecutiveFailures >= plan.limits.maxConsecutiveFailures ? "failed" : state.ticks >= plan.maxTicks ? "completed" : null;
    if (!status && JSON.stringify(stamp) !== JSON.stringify(plan.package)) status = "package_changed";
    const finish = async status => {
      state = { ...state, status, finishedAt: state.finishedAt || new Date(clock()).toISOString() };
      await fs.write(statePath, state);
      await fs.write(`${base}/final.md`, `# 有限观察结束\n\n状态：${status}\n计划创建：${plan.createdAt}\n首轮执行：${state.firstTickAt || "未执行"}\n本次检查：${now.toISOString()}\n结束记录：${state.finishedAt}\n绝对截止：${plan.deadline}\n首轮到结束实际经过：${state.firstTickAt ? Math.max(0, Math.min(Date.parse(state.finishedAt), Date.parse(plan.deadline)) - Date.parse(state.firstTickAt)) / 1000 : 0} 秒（仅逐轮重读日志，非连续监控）\n已尝试 ${state.ticks} 轮。仅重读已有 JD/CSV，无自动抓取；这不是策略验证，也不代表已运行满 24 小时。\n`);
      return { state, path: base };
    };
    if (status) return await finish(status);
    if (recovered) return { state, recovered: true };
    if (state.nextEligibleAt && +now < Date.parse(state.nextEligibleAt)) return { state, skipped: "not_due" };
    const tick = state.ticks + 1;
    let outcome, error = null;
    try { await validateTask(plan.task); outcome = await execute(structuredClone(plan.task)); if (Buffer.byteLength(JSON.stringify(outcome)) > MAX_BYTES - 4096) throw fail("OUTPUT_TOO_LARGE", "单轮观察报告超限"); }
    catch (e) { error = { code: String(e.code || "OBSERVATION_FAILED").slice(0, 100), message: String(e.message || e).slice(0, 2000) }; }
    const failures = error ? state.consecutiveFailures + 1 : 0;
    const delay = error ? Math.min(plan.limits.backoffMaxSeconds, plan.limits.backoffBaseSeconds * 2 ** (failures - 1)) : plan.intervalSeconds;
    state = { ...state, status: error ? "backing_off" : "idle", firstTickAt: state.firstTickAt || now.toISOString(), ticks: tick, consecutiveFailures: failures, lastTickAt: now.toISOString(), nextEligibleAt: new Date(+now + delay * 1000).toISOString(), lastError: error };
    const record = { format: "codeshell.observation-tick", version: 1, runId: plan.runId, app, nextState: state, tick, at: now.toISOString(), error, result: error ? null : outcome };
    await fs.write(`${base}/ticks/${String(tick).padStart(4, "0")}.json`, record, true);
    await fs.write(statePath, state);
    let log = await fs.read(`${base}/log.ndjson`, true) || "";
    if (Buffer.byteLength(log) > 1024 * 1024) { await fs.write(`${base}/log.previous.ndjson`, log); log = ""; }
    await fs.write(`${base}/log.ndjson`, log + JSON.stringify({ tick, at: now.toISOString(), status: state.status, error }) + "\n");
    if ((await fs.read(stop, true)) !== null) return await finish("stopped");
    if (+new Date(clock()) >= Date.parse(plan.deadline)) return await finish("expired");
    if (failures >= plan.limits.maxConsecutiveFailures) return await finish("failed");
    if (tick >= plan.maxTicks) return await finish("completed");
    return { state, recordPath: `${base}/ticks/${String(tick).padStart(4, "0")}.json` };
  } finally { await release(); }
}

export function observationInputSchema(taskSchema) {
  return { type: "object", additionalProperties: false, required: ["action", "runId"], properties: {
    action: { type: "string", enum: ["plan", "tick", "status", "stop"] }, runId: { type: "string", minLength: 1, maxLength: 48 },
    deadline: { type: "string", minLength: 1, maxLength: 80 }, task: taskSchema,
    ...Object.fromEntries(["intervalSeconds", "backoffBaseSeconds", "backoffMaxSeconds"].map(key => [key, { type: "integer", minimum: 1, maximum: 86400 }])),
    maxTicks: { type: "integer", minimum: 1, maximum: 100 }, maxConsecutiveFailures: { type: "integer", minimum: 1, maximum: 10 },
  } };
}
