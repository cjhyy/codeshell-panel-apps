const keyFor = request => `quant.history.batch.v1${request?.libraryId ? `.${request.libraryId}` : ""}`;
const terminal = task => ["succeeded", "failed", "cancelled", "interrupted"].includes(task?.status);
const requestValue = value => value && typeof value === "object" && !Array.isArray(value)
  && ["core", "broad", "full"].includes(value.scope)
  && typeof value.source === "string" && value.source.length > 0 && value.source.length <= 64
  && Number.isSafeInteger(value.maxItems) && value.maxItems > 0 && value.maxItems <= 20
  && (value.libraryId == null || typeof value.libraryId === "string" && /^[a-f0-9]{32}$/u.test(value.libraryId))
  && Object.keys(value).every(key => ["scope", "source", "maxItems", "libraryId"].includes(key));
function intentValue(value) {
  if (!value || value.format !== "quant.history.batch/1" || !Number.isSafeInteger(value.sequence) || value.sequence < 1
    || typeof value.requestKey !== "string" || !value.requestKey || value.requestKey.length > 128 || !requestValue(value.request)
    || Object.keys(value).some(key => !["format", "sequence", "requestKey", "request"].includes(key)))
    throw new Error("历史批次格式不受支持或已损坏，请更新面板后重新读取状态");
  return value;
}
function snapshotValue(snapshot) {
  if (!snapshot || typeof snapshot.exists !== "boolean"
    || (snapshot.revision !== null && typeof snapshot.revision !== "string")) throw new Error("历史批次存储回执无效");
  if (snapshot.exists) intentValue(snapshot.value);
  return snapshot;
}
export function createHistoryBatchClient({ hostCall, onHostEvent, contextState, currentEpoch, onTask = () => {} }) {
  let taskId = null, taskEpoch = null;
  const check = epoch => { if (epoch !== currentEpoch()) throw new Error("项目已切换；旧项目历史请求已停止提交"); };
  const call = async (epoch, method, params) => { check(epoch); const result = await hostCall(method, params); check(epoch); return result; };
  const supports = () => ["tasks.start", "tasks.find", "tasks.get", "tasks.cancel", "storage.getSnapshot", "storage.compareAndSet"]
    .every(name => contextState().availableMethods?.includes(name));
  async function find(intent, epoch) {
    const task = await call(epoch,"tasks.find", { requestKey: intent.requestKey });
    if (task) { taskId = task.id; taskEpoch = epoch; onTask(task); }
    return task;
  }
  async function wait(task, epoch) {
    if (terminal(task)) return task;
    return new Promise((resolve, reject) => {
      let timer;
      let stopped = false;
      const done = (error, value) => { if (stopped) return; stopped = true; clearTimeout(timer); off?.(); error ? reject(error) : resolve(value); };
      const receive = async event => {
        if (event?.id !== task.id || stopped) return;
        if (epoch !== currentEpoch()) return done(new Error("项目已切换；历史批次在原项目后台继续"));
        onTask(event);
        if (terminal(event)) {
          try { done(null, await call(epoch, "tasks.get", { id: task.id })); } catch (error) { done(error); }
        }
      };
      const off = onHostEvent?.("tasks.changed", receive);
      const poll = async () => {
        try { await receive(await call(epoch, "tasks.get", { id: task.id })); }
        catch (error) { done(error); }
        if (!stopped) timer = setTimeout(poll, 5000);
      };
      void poll();
    });
  }
  return {
    supports,
    async restore(request = {}) {
      if (!supports()) return null;
      const epoch = currentEpoch();
      const snapshot = snapshotValue(await call(epoch, "storage.getSnapshot", { key: keyFor(request) }));
      return snapshot.exists ? find(snapshot.value, epoch) : null;
    },
    async run(request) {
      if (!supports()) throw new Error("有界后台历史批次需要更新 CodeShell 并授权 tasks；已保留本地历史数据");
      const epoch = currentEpoch();
      if (!requestValue(request)) throw new Error("历史批次请求无效；每批必须限制在 20 项以内");
      const KEY = keyFor(request);
      const previous = snapshotValue(await call(epoch, "storage.getSnapshot", { key: KEY }));
      let task = previous.exists ? await find(previous.value, epoch) : null;
      if (task && !terminal(task)) return wait(task, epoch);
      // Explicit resume reuses an existing unresolved intent after querying it.
      // The Host requestKey atomically deduplicates a lost-start acknowledgement.
      const unresolved = previous.exists && !task ? previous.value : null;
      if (unresolved && ["scope", "source", "maxItems", "libraryId"].some(key => unresolved.request[key] !== request[key]))
        throw new Error("上次历史批次回执尚未确认，请先恢复相同来源与范围的批次");
      const sequence = (previous.value?.sequence ?? 0) + 1;
      if (!unresolved && !Number.isSafeInteger(sequence)) throw new Error("历史批次代际已达上限，请更新面板");
      const intent = unresolved ?? { format: "quant.history.batch/1", sequence,
        requestKey: `quant-history-v2:${sequence}:${globalThis.crypto.randomUUID()}`, request };
      let committed;
      try { committed = unresolved ? { updated: true, snapshot: previous } : await call(epoch, "storage.compareAndSet", { key: KEY, expectedRevision: previous.revision, value: intent }); }
      catch (error) {
        const actual = snapshotValue(await call(epoch, "storage.getSnapshot", { key: KEY }));
        if (actual.value?.requestKey !== intent.requestKey) throw error;
        committed = { updated: true, snapshot: actual };
      }
      if (!committed.updated) {
        task = await find(snapshotValue(committed.snapshot).value, epoch);
        if (!task) throw new Error("另一个页面正在提交历史批次，请读取状态后重试");
        return wait(task, epoch);
      }
      try {
        task = await call(epoch, "tasks.start", { entry: "quant-history-batch", requestKey: intent.requestKey,
          input: { request, directoryArguments: [{ argumentName: "--data-dir", directory: "app-data" }] }, recovery: "retry" });
      } catch (error) { task = await find(intent, epoch); if (!task) throw error; }
      taskId = task.id; taskEpoch = epoch; onTask(task);
      return wait(task, epoch);
    },
    async cancel() { if (taskId) return call(taskEpoch, "tasks.cancel", { id: taskId }); },
  };
}
