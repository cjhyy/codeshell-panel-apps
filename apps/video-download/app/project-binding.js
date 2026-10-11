import { projectStorageMode } from "./project-storage.js";

// A reviewed Host projectScope identifies project data independently of the
// selected chat. Older Hosts keep their conservative session binding.
const projectKeys = ["cwd", "host", "appId"];
const changedMessage =
  "项目或执行位置已变化，请先复制未保存内容，再重新打开面板。已接收的后台任务请回原项目核对。";
const sessionMessage = "当前会话已变化，请重新打开面板后再提交会话任务或修改自动化。";
const sessionMethod = (method) =>
  method === "agent.submitPrompt" || method.startsWith("automations.");

function projectIdentity(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope) || scope.version !== 1)
    return undefined;
  const fields = [scope.environmentId, scope.projectId, scope.rootId];
  if (
    fields.some(
      (value) =>
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 256 ||
        /[\u0000-\u001f\u007f]/u.test(value),
    )
  )
    return undefined;
  return JSON.stringify([1, ...fields]);
}

export function createProjectBinding(host, { onInvalidated = () => {} } = {}) {
  let context = {};
  let contextVersion = 0;
  const fieldVersions = new Map();
  let invalidated = false;
  let identityMode, identity, storageMode;
  let sessionInvalidated = false;

  function assertCurrent(method = "") {
    if (invalidated) throw Object.assign(new Error(changedMessage), { code: "PROJECT_CHANGED" });
    if (sessionInvalidated && sessionMethod(method))
      throw Object.assign(new Error(sessionMessage), { code: "SESSION_CHANGED" });
  }

  function observe(next, complete = false) {
    if (!next || typeof next !== "object" || Array.isArray(next)) return context;
    const previous = context;
    const merged = complete ? { ...next } : { ...context, ...next };
    const nextIdentity = projectIdentity(merged.projectScope);
    if (!identityMode && (nextIdentity || complete)) {
      identityMode = nextIdentity ? "project" : "legacy";
      identity = nextIdentity;
    }
    const keys = identityMode === "project" ? projectKeys : [...projectKeys, "sessionId"];
    const nextStorageMode = projectStorageMode(merged);
    if (!storageMode && complete) storageMode = nextStorageMode;
    const changed =
      keys.some(
        (key) =>
          typeof previous[key] === "string" &&
          (complete || Object.hasOwn(next, key)) &&
          merged[key] !== previous[key],
      ) ||
      (identityMode === "project" &&
        (complete || Object.hasOwn(next, "projectScope")) &&
        nextIdentity !== identity) ||
      (storageMode &&
        (complete ||
          Object.hasOwn(next, "availableMethods") ||
          Object.hasOwn(next, "apiVersion")) &&
        nextStorageMode !== storageMode);
    if (
      typeof previous.sessionId === "string" &&
      (complete || Object.hasOwn(next, "sessionId")) &&
      merged.sessionId !== previous.sessionId
    )
      sessionInvalidated = true;
    context = merged;
    contextVersion++;
    for (const key of Object.keys(next)) fieldVersions.set(key, contextVersion);
    if (changed && !invalidated) {
      // Irreversible for this page, including A -> B -> A. Late receipts cannot
      // authorize their old follow-up against another project or execution root.
      invalidated = true;
      onInvalidated(changedMessage);
    }
    return context;
  }

  async function readContext() {
    assertCurrent();
    const version = contextVersion;
    const initial = await host.getContext();
    assertCurrent();
    // Only fields actually published during discovery override its snapshot.
    // Old fields must not hide a complete context losing its project proof.
    const latest = { ...initial };
    for (const [key, changedAt] of fieldVersions)
      if (changedAt > version && Object.hasOwn(context, key)) latest[key] = context[key];
    const value = observe(latest, true);
    assertCurrent();
    return value;
  }

  return {
    get invalidated() {
      return invalidated;
    },
    assertCurrent,
    panel: {
      getContext: readContext,
      async call(method, params) {
        assertCurrent(method);
        if (sessionMethod(method)) await readContext();
        assertCurrent(method);
        try {
          const result = await host.call(method, params);
          assertCurrent(method);
          return result;
        } catch (error) {
          assertCurrent(method);
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
        return host.registerTool(name, (...args) => {
          assertCurrent();
          let result;
          try {
            result = handler(...args);
          } catch (error) {
            assertCurrent();
            throw error;
          }
          if (result && typeof result.then === "function")
            return Promise.resolve(result).then(
              (value) => {
                assertCurrent();
                return value;
              },
              (error) => {
                assertCurrent();
                throw error;
              },
            );
          assertCurrent();
          return result;
        });
      },
    },
  };
}
