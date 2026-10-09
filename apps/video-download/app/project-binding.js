// The public Host context has no stable project ID. Its session is an execution
// binding, never a storage namespace: reopening in another session keeps the
// project's existing download records.
const identityKeys = ["cwd", "sessionId", "host"];
const changedMessage =
  "项目或会话绑定已变化，请先复制未保存内容，再重新打开面板。已接收的后台任务请回原项目核对。";

export function createProjectBinding(host, { onInvalidated = () => {} } = {}) {
  let context = {};
  let contextVersion = 0;
  let invalidated = false;

  function assertCurrent() {
    if (invalidated)
      throw Object.assign(new Error(changedMessage), { code: "PROJECT_CHANGED" });
  }

  function observe(next) {
    if (!next || typeof next !== "object") return context;
    const changed = identityKeys.some(
      (key) =>
        typeof context[key] === "string" &&
        Object.hasOwn(next, key) &&
        next[key] !== context[key],
    );
    context = { ...context, ...next };
    contextVersion++;
    if (changed && !invalidated) {
      // Irreversible for this page, including A -> B -> A. A late receipt cannot
      // authorize its old follow-up against a newly bound Host.
      invalidated = true;
      onInvalidated(changedMessage);
    }
    return context;
  }

  return {
    get invalidated() {
      return invalidated;
    },
    assertCurrent,
    panel: {
      async getContext() {
        assertCurrent();
        const version = contextVersion;
        const initial = await host.getContext();
        assertCurrent();
        // Events received during the initial read are newer, including partial
        // events. Hydrate missing fields without replacing their newer values.
        return observe(version === contextVersion ? initial : { ...initial, ...context });
      },
      async call(method, params) {
        assertCurrent();
        try {
          const result = await host.call(method, params);
          assertCurrent();
          return result;
        } catch (error) {
          assertCurrent();
          throw error;
        }
      },
      on(name, handler) {
        return host.on(name, (payload) => {
          if (name === "context.changed") handler(observe(payload));
          else if (!invalidated) handler(payload);
        });
      },
      registerTool(name, handler) {
        return host.registerTool(name, async (...args) => {
          assertCurrent();
          const result = await handler(...args);
          assertCurrent();
          return result;
        });
      },
    },
  };
}
