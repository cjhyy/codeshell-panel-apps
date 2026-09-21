// Host storage is scoped to the panel/project. The envelope also guards late
// writes after a workspace switch. Browser storage is only a legacy fallback.
export function createProjectStorage({ panel, key, ready, getContext, getScope }) {
  let initialScope;
  async function location() {
    await ready;
    const scope = getScope();
    const context = getContext();
    if (
      !scope ||
      (initialScope && initialScope !== scope) ||
      (context.cwd && context.cwd !== scope)
    )
      throw new Error("项目已变化，请重新打开面板。");
    initialScope = scope;
    const methods = context.availableMethods;
    const host =
      Boolean(panel) &&
      (Array.isArray(methods)
        ? ["storage.get", "storage.set"].every((method) => methods.includes(method))
        : Number(context.apiVersion) >= 14);
    return { scope, host };
  }
  return {
    async load() {
      const { scope, host } = await location();
      const record = host
        ? await panel.call("storage.get", { key })
        : JSON.parse(localStorage.getItem(`${key}:${scope}`) || "null");
      return record?.scope === scope ? record.value : null;
    },
    async save(value) {
      const { scope, host } = await location();
      const record = { scope, value };
      if (host) await panel.call("storage.set", { key, value: record });
      else localStorage.setItem(`${key}:${scope}`, JSON.stringify(record));
    },
  };
}
