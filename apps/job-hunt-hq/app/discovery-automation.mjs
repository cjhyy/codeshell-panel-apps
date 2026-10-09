import { supportsHostMethod } from "./host-capabilities.mjs";

export const DISCOVERY_AUTOMATION_KEY = "job-hunt-hq:scheduled-discovery:v1";

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function hasMarker(task) {
  return String(task?.prompt || "").split(/\r?\n/u).includes(DISCOVERY_AUTOMATION_KEY);
}

function isDiscoveryTask(task) {
  return typeof task?.id === "string" && Boolean(task.id.trim()) && hasMarker(task);
}

export async function readDiscoveryAutomation(call) {
  const result = await call("automations.list", {});
  if (!Array.isArray(result?.automations)) throw new Error("定时任务列表无法确认，请重新读取。");
  const tasks = result.automations.filter(hasMarker);
  if (tasks.some(task => !isDiscoveryTask(task))) throw new Error("定时任务记录不完整，请在 CodeShell 的定时任务管理中核对后重新读取。");
  if (tasks.length > 1) throw problem("AUTOMATION_DUPLICATE", "发现多个定时抓取任务，请先在 CodeShell 的定时任务管理中核对并清理重复项，再重新读取。");
  return tasks[0] || null;
}

export function discoveryAutomationMethod(context, action) {
  const preferred = { create: "createUnique", update: "updateIfRevision", delete: "deleteIfRevision" }[action];
  return `automations.${preferred && supportsHostMethod(context, `automations.${preferred}`) ? preferred : action}`;
}

function definition(task) {
  return [task.id, task.name ?? "", task.schedule ?? "", task.prompt ?? "", task.timezone ?? "UTC", task.enabled === true];
}

function sameTask(left, right) {
  if (!left || !right || left.id !== right.id) return false;
  if (typeof left.revision === "string" || typeof right.revision === "string")
    return typeof left.revision === "string" && left.revision === right.revision;
  return JSON.stringify(definition(left)) === JSON.stringify(definition(right));
}

function conflict() {
  return problem("AUTOMATION_CONFLICT", "定时任务已在其他页面修改或删除，本次操作未保存。请重新读取并核对后再操作。");
}

async function requireCurrent(call, task) {
  const current = await readDiscoveryAutomation(call);
  if (!sameTask(task, current)) throw conflict();
}

function revision(task) {
  if (typeof task?.revision !== "string" || !/^[a-f0-9]{64}$/u.test(task.revision))
    throw problem("AUTOMATION_CONFLICT", "无法核对定时任务的版本，请重新读取后再操作。");
  return task.revision;
}

// A rejected response may follow a committed write. Never downgrade the method
// or replay it; require a read-only refresh before another explicit action.
async function write(call, method, params) {
  try {
    return await call(method, params);
  } catch (cause) {
    throw problem("AUTOMATION_UNCERTAIN", `未确认定时任务操作结果，请重新读取核对；不会自动重发。${cause instanceof Error ? cause.message : ""}`);
  }
}

function requireTask(task, expectedId, patch) {
  if (!isDiscoveryTask(task) || (expectedId && task.id !== expectedId) ||
    (patch && Object.keys(patch).some(key => task[key] !== patch[key])))
    throw problem("AUTOMATION_UNCERTAIN", "未确认定时任务保存结果，请重新读取核对；不会自动重发。");
  return task;
}

export async function saveDiscoveryAutomationTask(call, context, task, patch) {
  const method = discoveryAutomationMethod(context, task ? "update" : "create");
  if (!supportsHostMethod(context, method)) throw new Error("当前项目不能保存定时任务。");
  if (task) {
    if (method.endsWith("IfRevision")) {
      const result = await write(call, method, { ...patch, id: task.id, expectedRevision: revision(task) });
      if (result?.ok === false && result.conflict === true) throw conflict();
      if (result?.ok !== true) throw problem("AUTOMATION_UNCERTAIN", "未确认定时任务保存结果，请重新读取核对。");
      return requireTask(result.automation, task.id, patch);
    }
    await requireCurrent(call, task);
    return requireTask(await write(call, method, { ...patch, id: task.id }), task.id, patch);
  }
  // Check legacy tasks too: earlier app versions did not create with a key.
  if (await readDiscoveryAutomation(call)) throw conflict();
  const saved = requireTask(await write(call, method, {
    ...patch,
    ...(method.endsWith("createUnique") ? { key: DISCOVERY_AUTOMATION_KEY } : {}),
  }));
  // A simultaneous unique create can return the other device's definition.
  // Do not say that this form was saved, or overwrite that definition for it.
  if (["name", "schedule", "prompt", "timezone"].some(key => saved[key] !== patch[key]))
    throw conflict();
  return saved;
}

export async function controlDiscoveryAutomationTask(call, context, task, action) {
  if (!["pause", "resume", "delete", "runNow"].includes(action) || !isDiscoveryTask(task)) throw new Error("定时任务操作无效。");
  const method = discoveryAutomationMethod(context, action);
  if (!supportsHostMethod(context, method)) throw new Error("当前项目不提供这个定时任务操作。");
  const conditional = method.endsWith("IfRevision");
  const expectedRevision = conditional ? revision(task) : undefined;
  if (!conditional) await requireCurrent(call, task);
  const result = await write(call, method, { id: task.id, ...(conditional ? { expectedRevision } : {}) });
  if (result?.ok === false && result.conflict === true) throw conflict();
  if (result?.ok !== true) throw problem("AUTOMATION_UNCERTAIN", "未确认定时任务操作结果，请重新读取核对；不会自动重发。");
  if (action === "delete") return null;
  // Pause/resume do not offer conditional mutations yet. Read the actual state
  // and new revision rather than inverting a stale page's cached enabled flag.
  try {
    return await readDiscoveryAutomation(call);
  } catch {
    throw problem("AUTOMATION_UNCERTAIN", "操作已提交，但当前任务状态无法读取。请重新读取核对；不会自动重发。");
  }
}
