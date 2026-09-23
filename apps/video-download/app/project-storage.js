// Host storage belongs to the project. New Hosts support content revisions;
// legacy Hosts keep their original JSON layout and get/set behavior.
const conflictMessage = "其他页面或设备已修改此项目，请重新打开面板读取最新记录，再继续操作。";

function storageError(message, code) {
  return Object.assign(new Error(message), { code });
}

function snapshot(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.exists !== "boolean" ||
    !Object.hasOwn(value, "value") ||
    (value.exists
      ? typeof value.revision !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.revision)
      : value.revision !== null || value.value !== null)
  )
    throw new Error("Host 返回的项目存储版本无效。");
  return value;
}

export function createProjectStorage({ panel, key, ready, getContext, getScope, envelope = true }) {
  let initialScope;
  let storageMode;
  let loaded = false;
  let revision = null;
  let blocked;
  let tail = Promise.resolve();

  function scopeNow() {
    const scope = getScope();
    const context = getContext();
    if (
      !scope ||
      (initialScope && initialScope !== scope) ||
      (context.cwd && context.cwd !== scope)
    )
      throw new Error("项目已变化，请重新打开面板。");
    initialScope = scope;
    return { scope, context };
  }

  async function location() {
    await ready;
    const { scope, context } = scopeNow();
    const methods = context.availableMethods;
    const has = (...names) =>
      Array.isArray(methods) && names.every((method) => methods.includes(method));
    const versioned = Boolean(panel) && has("storage.getSnapshot", "storage.compareAndSet");
    const host =
      Boolean(panel) &&
      (versioned ||
        (Array.isArray(methods)
          ? has("storage.get", "storage.set")
          : Number(context.apiVersion) >= 14));
    const mode = versioned ? "versioned" : host ? "legacy-host" : "browser";
    if (storageMode && storageMode !== mode)
      throw storageError("Host 存储能力已变化，请重新打开面板。", "STORAGE_MODE_CHANGED");
    storageMode = mode;
    return { scope, host, versioned };
  }

  function serial(operation) {
    const result = tail.catch(() => {}).then(operation);
    tail = result;
    return result;
  }

  async function readSnapshot() {
    const current = snapshot(await panel.call("storage.getSnapshot", { key }));
    scopeNow();
    return current;
  }

  return {
    load() {
      return serial(async () => {
        const { scope, host, versioned } = await location();
        let record;
        if (versioned) {
          const current = await readSnapshot();
          revision = current.revision;
          loaded = true;
          blocked = undefined;
          record = current.value;
        } else
          record = host
            ? await panel.call("storage.get", { key })
            : JSON.parse(localStorage.getItem(`${key}:${scope}`) || "null");
        scopeNow();
        return envelope ? (record?.scope === scope ? record.value : null) : record;
      });
    },
    save(value) {
      // Capture now, before another render mutates the caller's draft.
      let copy;
      try {
        copy = JSON.parse(JSON.stringify(value));
      } catch (error) {
        return Promise.reject(error);
      }
      return serial(async () => {
        const { scope, host, versioned } = await location();
        const record = envelope ? { scope, value: copy } : copy;
        if (versioned) {
          if (blocked) throw blocked;
          if (!loaded) {
            const current = await readSnapshot();
            // A new empty document may be created directly, but never overwrite
            // an existing document that this page has not actually loaded.
            if (current.exists) throw storageError(conflictMessage, "STORAGE_CONFLICT");
            loaded = true;
            revision = null;
          }
          let result;
          try {
            result = await panel.call("storage.compareAndSet", {
              key,
              value: record,
              expectedRevision: revision,
            });
          } catch (error) {
            // A timed-out request might have committed. Query once and accept
            // only the exact intended value; never replay an ambiguous write.
            const current = await readSnapshot().catch(() => null);
            if (current?.exists && JSON.stringify(current.value) === JSON.stringify(record)) {
              revision = current.revision;
              return;
            }
            blocked = storageError(
              "无法确认项目记录是否保存，请重新打开面板核对后再继续。",
              "STORAGE_UNCERTAIN",
            );
            blocked.cause = error;
            throw blocked;
          }
          scopeNow();
          if (!result || typeof result.updated !== "boolean") {
            blocked = storageError(
              "无法确认项目记录是否保存，请重新打开面板核对后再继续。",
              "STORAGE_UNCERTAIN",
            );
            throw blocked;
          }
          let current;
          try {
            current = snapshot(result.snapshot);
            if (
              result.updated &&
              (!current.exists || JSON.stringify(current.value) !== JSON.stringify(record))
            )
              throw new Error("Host 返回的项目保存结果不一致，请重新打开面板核对。");
          } catch (error) {
            blocked = error;
            throw error;
          }
          if (!result.updated) {
            // Do not adopt the returned version and retry the old draft.
            blocked = storageError(conflictMessage, "STORAGE_CONFLICT");
            throw blocked;
          }
          revision = current.revision;
        } else if (host) await panel.call("storage.set", { key, value: record });
        else localStorage.setItem(`${key}:${scope}`, JSON.stringify(record));
        scopeNow();
      });
    },
  };
}
