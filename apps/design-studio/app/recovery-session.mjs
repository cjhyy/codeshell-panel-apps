function failure(message, code) {
  return Object.assign(new Error(message), { code });
}

function snapshot(value) {
  if (
    !value ||
    typeof value.exists !== "boolean" ||
    !Object.hasOwn(value, "value") ||
    (value.exists
      ? typeof value.revision !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.revision)
      : value.revision !== null || value.value !== null)
  )
    throw failure("无法读取恢复草稿版本，已停止自动覆盖。", "RECOVERY_INVALID");
  return value;
}

// One loaded project, one observed revision. Conflicts never advance the revision
// or authorize a blind retry. Only an explicit load starts a new editing basis.
export function createRecoverySession({ call, key, epoch, currentEpoch, getContext }) {
  const supports = () =>
    ["storage.getSnapshot", "storage.compareAndSet"].every((method) =>
      getContext().availableMethods?.includes(method),
    );
  const versioned = supports();
  let loaded = false,
    revision = null,
    blocked = null,
    tail = Promise.resolve();
  const check = () => {
    if (epoch !== currentEpoch())
      throw failure("项目已切换，旧项目操作已停止。", "PROJECT_CHANGED");
    if (supports() !== versioned)
      throw failure("恢复能力已变化，请重新打开面板。", "RECOVERY_MODE_CHANGED");
  };
  const serial = (action) => {
    const result = tail
      .catch(() => {})
      .then(() => {
        check();
        return action();
      });
    tail = result;
    return result;
  };
  const read = async () => {
    check();
    const result = await call("storage.getSnapshot", { key });
    check();
    return snapshot(result);
  };
  const uncertain = () =>
    failure(
      "无法确认恢复草稿是否已保存；当前画布已保留，请下载备份后读取最新记录。",
      "RECOVERY_UNCERTAIN",
    );
  async function change(copy, remove) {
    if (blocked) throw blocked;
    if (!loaded) throw failure("恢复草稿尚未成功读取，已阻止覆盖。", "RECOVERY_NOT_LOADED");
    if (!versioned) {
      try {
        await call(
          remove ? "storage.delete" : "storage.set",
          remove ? { key } : { key, value: copy },
        );
        check();
      } catch (error) {
        blocked = error;
        throw error;
      }
      return;
    }
    const matches = (record) =>
      remove
        ? !record.exists
        : record.exists && JSON.stringify(record.value) === JSON.stringify(copy);
    let result;
    try {
      result = await call("storage.compareAndSet", {
        key,
        expectedRevision: revision,
        ...(remove ? { remove: true } : { value: copy }),
      });
    } catch {
      // Observe a lost acknowledgement; never issue the write again.
      const record = await read().catch(() => null);
      check();
      if (record && matches(record)) {
        revision = record.revision;
        return;
      }
      blocked = uncertain();
      throw blocked;
    }
    check();
    try {
      const record = snapshot(result?.snapshot);
      if (result.updated === false)
        throw failure(
          "其他窗口或设备已修改恢复草稿；当前画布已保留，自动覆盖已停止。请下载备份后读取最新记录。",
          "RECOVERY_CONFLICT",
        );
      if (result.updated !== true || !matches(record)) throw uncertain();
      revision = record.revision;
    } catch (error) {
      blocked = error;
      throw error;
    }
  }
  return {
    versioned,
    get blocked() {
      return blocked;
    },
    block(error) {
      blocked = error;
    },
    load() {
      return serial(async () => {
        loaded = false;
        try {
          const record = versioned ? await read() : { value: await call("storage.get", { key }) };
          check();
          revision = record.revision ?? null;
          loaded = true;
          blocked = null;
          return structuredClone(record.value);
        } catch (error) {
          blocked = error;
          throw error;
        }
      });
    },
    save(value) {
      const copy = structuredClone(value);
      return serial(() => change(copy, false));
    },
    clear() {
      return serial(() => change(undefined, true));
    },
  };
}
