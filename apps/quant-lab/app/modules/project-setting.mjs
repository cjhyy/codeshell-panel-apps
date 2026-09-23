function failure(message, code) {
  return Object.assign(new Error(message), { code });
}

function snapshot(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.exists !== "boolean" ||
    !Object.hasOwn(raw, "value") ||
    (raw.exists
      ? typeof raw.revision !== "string" || !/^sha256:[0-9a-f]{64}$/.test(raw.revision)
      : raw.revision !== null || raw.value !== null)
  )
    throw failure("无法读取配置版本，请重新读取后再保存。", "STORAGE_INVALID");
  return raw;
}

// One instance belongs to one loaded project setting. Reloading is explicit:
// a conflict response must never authorize an automatic retry of an old draft.
export function createProjectSetting({ hostCall, key, currentEpoch, getContext }) {
  const epoch = currentEpoch();
  const methods = getContext().availableMethods;
  const versioned =
    Array.isArray(methods) &&
    ["storage.getSnapshot", "storage.compareAndSet"].every((method) => methods.includes(method));
  let loaded = false;
  let revision = null;
  let blocked;
  let tail = Promise.resolve();

  function check() {
    if (epoch !== currentEpoch())
      throw failure("项目已切换，请在当前项目重新操作。", "PROJECT_CHANGED");
    const available = getContext().availableMethods;
    const nowVersioned =
      Array.isArray(available) &&
      ["storage.getSnapshot", "storage.compareAndSet"].every((method) =>
        available.includes(method),
      );
    if (nowVersioned !== versioned)
      throw failure("执行环境的保存能力已变化，请重新打开面板。", "STORAGE_MODE_CHANGED");
  }
  function serial(action) {
    const next = tail
      .catch(() => {})
      .then(() => {
        check();
        return action();
      });
    tail = next;
    return next;
  }
  async function readSnapshot() {
    check();
    const value = await hostCall("storage.getSnapshot", { key });
    check();
    return snapshot(value);
  }
  function uncertain() {
    return failure(
      "无法确认配置是否已保存。当前填写内容已保留，请先备份，再读取最新配置核对。",
      "STORAGE_UNCERTAIN",
    );
  }
  return {
    versioned,
    get blocked() {
      return Boolean(blocked);
    },
    load() {
      return serial(async () => {
        loaded = false;
        if (versioned) {
          const record = await readSnapshot();
          revision = record.revision;
          loaded = true;
          blocked = undefined;
          return structuredClone(record.value);
        }
        const value = await hostCall("storage.get", { key });
        check();
        loaded = true;
        blocked = undefined;
        return value;
      });
    },
    save(value) {
      // Detach before waiting behind a previous request.
      const copy = JSON.parse(JSON.stringify(value));
      return serial(async () => {
        if (blocked) throw blocked;
        if (!loaded) throw failure("配置尚未成功读取，已阻止覆盖原记录。", "STORAGE_NOT_LOADED");
        if (!versioned) {
          await hostCall("storage.set", { key, value: copy });
          check();
          return;
        }
        let result;
        try {
          result = await hostCall("storage.compareAndSet", {
            key,
            expectedRevision: revision,
            value: copy,
          });
        } catch {
          // A response can be lost after commit. Query, never resend the write.
          const record = await readSnapshot().catch(() => null);
          check();
          if (record?.exists && JSON.stringify(record.value) === JSON.stringify(copy)) {
            revision = record.revision;
            return;
          }
          blocked = uncertain();
          throw blocked;
        }
        check();
        try {
          const record = snapshot(result?.snapshot);
          if (result.updated === false) {
            blocked = failure(
              "其他页面或设备已修改数据源配置。当前填写内容已保留，请先备份，再读取最新配置。",
              "STORAGE_CONFLICT",
            );
            throw blocked;
          }
          if (
            result.updated !== true ||
            !record.exists ||
            JSON.stringify(record.value) !== JSON.stringify(copy)
          )
            throw uncertain();
          revision = record.revision;
        } catch (error) {
          blocked = error;
          throw error;
        }
      });
    },
  };
}
