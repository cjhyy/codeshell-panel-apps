import { createHash } from "node:crypto";

// Shared scheduler fixture: independent browser pages receive cloned summaries.
// Revision changes exclude execution counters, matching the Host contract.
export function createDiscoveryAutomationHost(seed = {}) {
  let sequence = 0;
  const keys = new Map();
  const state = {
    tasks: structuredClone({ a: [], b: [], ...seed }),
    calls: [], failRead: false, malformedList: false, loseResponse: "",
  };
  function summary(task) {
    const revision = createHash("sha256").update(JSON.stringify([
      task.id, task.name, task.schedule, task.prompt, task.timezone, task.enabled,
    ])).digest("hex");
    return structuredClone({ ...task, revision });
  }
  state.call = async (method, params = {}, project = "a") => {
    state.calls.push({ method, params: structuredClone(params), project });
    const tasks = state.tasks[project] ||= [];
    if (method === "automations.list") {
      if (state.failRead) throw Error("scheduler unavailable");
      return state.malformedList ? {} : { automations: tasks.map(summary) };
    }
    let result;
    if (["automations.create", "automations.createUnique"].includes(method)) {
      const key = `${project}:${params.key}`;
      let task = method.endsWith("createUnique") ? tasks.find(task => task.id === keys.get(key)) : null;
      if (task && ["name", "schedule", "prompt", "timezone"].some(key => task[key] !== params[key]))
        throw Error("Automation creation key already has a different definition");
      if (!task) {
        const { key: ignored, ...definition } = params;
        task = { ...definition, id: `automation-${++sequence}`, enabled: true, runCount: 0 };
        tasks.push(task);
        if (method.endsWith("createUnique")) keys.set(key, task.id);
      }
      result = summary(task);
    } else {
      const task = tasks.find(task => task.id === params.id);
      if (method.endsWith("IfRevision") && (!task || summary(task).revision !== params.expectedRevision))
        return { ok: false, conflict: true };
      if (!task) throw Error("task not found");
      if (method.startsWith("automations.update")) {
        const { id: ignored, expectedRevision: ignoredRevision, ...patch } = params;
        Object.assign(task, patch);
        result = method.endsWith("IfRevision") ? { ok: true, automation: summary(task) } : summary(task);
      } else {
        if (method.startsWith("automations.delete")) state.tasks[project] = tasks.filter(item => item !== task);
        else if (method === "automations.pause") task.enabled = false;
        else if (method === "automations.resume") task.enabled = true;
        else if (method === "automations.runNow") task.runCount += 1;
        else throw Error(`unsupported method ${method}`);
        result = { ok: true };
      }
    }
    if (state.loseResponse === method) {
      state.loseResponse = "";
      throw Error("response lost after commit");
    }
    return result;
  };
  return state;
}
