// The Host resolves the current project's selected and reviewed package. A
// missing method is a capability failure, never a reason to search HOME.
export async function reviewedEntry(hostCall, name, executableHandle) {
  let resolved;
  try { resolved = await hostCall("process.resolveEntry", { name, executableHandle }); }
  catch (cause) { throw new Error("当前 CodeShell 无法校验所选面板的执行入口；请更新 CodeShell。已保留本地快照。", { cause }); }
  if (typeof resolved?.handle !== "string") throw new Error("已授权执行入口不可用，请更新 CodeShell 或重新审查当前项目的面板授权");
  return resolved.handle;
}
