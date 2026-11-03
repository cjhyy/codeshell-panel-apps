const KEY = "quant.history.library.v2";
const validId = value => typeof value === "string" && /^[a-f0-9]{32}$/u.test(value);
function validate(snapshot) {
  if (!snapshot || typeof snapshot.exists !== "boolean" || (snapshot.exists ? typeof snapshot.revision !== "string" : snapshot.revision !== null || snapshot.value !== null)) throw new Error("历史库位置回执无效");
  if (snapshot.exists && (snapshot.value?.format !== "quant.history.library/1" || !validId(snapshot.value.libraryId) || Object.keys(snapshot.value).some(key => !["format", "libraryId"].includes(key))))
    throw new Error("历史库位置格式不受支持，已保留原记录");
  return snapshot;
}

export function createHistoryLibrarySelection({ hostCall, currentEpoch }) {
  let selected = null, loaded = false, flight = null, generation = 0;
  const identity = () => `${currentEpoch()}:${generation}`;
  async function call(token, method, params) {
    if (token !== identity()) throw new Error("项目已切换，历史库位置未修改");
    const result = await hostCall(method, params);
    if (token !== identity()) throw new Error("项目已切换，历史库位置回执未应用");
    return result;
  }
  async function restore() {
    if (loaded) return selected;
    if (flight) return flight;
    const token = identity();
    const pending = (async () => {
      const snapshot = validate(await call(token, "storage.getSnapshot", { key: KEY }));
      selected = snapshot.exists ? snapshot.value.libraryId : null;
      loaded = true;
      return selected;
    })().finally(() => { if (flight === pending) flight = null; });
    flight = pending;
    return pending;
  }
  return {
    restore,
    async select() {
      const token = identity();
      const previous = validate(await call(token, "storage.getSnapshot", { key: KEY }));
      if (previous.exists) { selected = previous.value.libraryId; loaded = true; return selected; }
      const value = { format: "quant.history.library/1", libraryId: crypto.randomUUID().replaceAll("-", "") };
      let result;
      try { result = await call(token, "storage.compareAndSet", { key: KEY, expectedRevision: previous.revision, value }); }
      catch (error) {
        const actual = validate(await call(token, "storage.getSnapshot", { key: KEY }));
        if (!actual.exists) throw error;
        result = { snapshot: actual };
      }
      const actual = validate(result.snapshot);
      if (!actual.exists) throw new Error("历史库位置发生冲突，请重新选择");
      selected = actual.value.libraryId; loaded = true;
      return selected;
    },
    reset() { generation++; selected = null; loaded = false; flight = null; },
    get id() { return selected; },
  };
}
