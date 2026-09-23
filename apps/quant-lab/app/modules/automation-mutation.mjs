/** Conditional changes never fall back after a rejected or uncertain request. */
export async function mutateAutomation(hostCall, getContext, action, task, patch = {}) {
  if (!["update", "delete"].includes(action) || !task?.id) throw new Error("提醒操作无效");
  const method = `automations.${action}IfRevision`;
  if (!getContext().availableMethods?.includes(method)) {
    return hostCall(`automations.${action}`, { ...patch, id: task.id });
  }
  if (typeof task.revision !== "string" || !/^[a-f0-9]{64}$/u.test(task.revision)) {
    const error = new Error("无法核对提醒版本，请重新读取后再操作。");
    error.code = "AUTOMATION_CONFLICT";
    throw error;
  }
  const result = await hostCall(method, { ...patch, id: task.id, expectedRevision: task.revision });
  if (result?.ok === false && result.conflict === true) {
    const error = new Error(
      "提醒已在其他页面修改或删除，本次操作未保存。请重新读取并核对后再操作。",
    );
    error.code = "AUTOMATION_CONFLICT";
    throw error;
  }
  if (result?.ok !== true) throw new Error("未确认提醒操作结果，请重新读取核对。");
  return action === "update" ? result.automation : result;
}
