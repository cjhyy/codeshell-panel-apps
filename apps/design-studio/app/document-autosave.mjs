// The publisher retains ownership of file CAS, receipts and saved baselines.
// This coordinator only chooses when to publish, and drains newer edits before
// a file switch. A timer never adopts a replacement document or save path.
export function createDocumentAutosave({
  readState,
  save,
  onError = () => {},
  onBlocked = () => {},
  delay = 800,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null, pending = null;

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function assertScope(scope) {
    const state = readState();
    if (state.scope !== scope)
      throw new Error("设计或保存路径已切换；已取消旧稿的自动保存");
    return state;
  }

  async function flush() {
    cancel();
    const initial = readState(), scope = initial.scope;
    if (pending?.scope === scope) return pending.operation;
    if (!initial.dirty) return false;
    const entry = { scope, operation: null };
    const operation = Promise.resolve().then(async () => {
      let saved = false;
      for (;;) {
        const state = assertScope(scope);
        if (!state.dirty) return saved;
        if (state.blockedReason) throw new Error(state.blockedReason);
        if (state.deferred)
          throw new Error("当前编辑操作尚未结束；请完成操作后再切换文件");
        await save();
        saved = true;
        // A successful receipt describes its captured snapshot. Read the live
        // dirty state again instead of treating that receipt as the latest edit.
        assertScope(scope);
      }
    });
    entry.operation = operation;
    pending = entry;
    const clearPending = () => { if (pending === entry) pending = null; };
    void operation.then(clearPending, clearPending);
    return operation;
  }

  function schedule() {
    cancel();
    const state = readState(), scope = state.scope;
    if (!state.dirty) return;
    if (state.blockedReason) { onBlocked(state.blockedReason); return; }
    timer = setTimer(() => {
      timer = null;
      const latest = readState();
      if (latest.scope !== scope || !latest.dirty) return;
      // Agent/import/drag transactions own their publication point. Wait for
      // them to finish instead of publishing an intermediate canvas.
      if (latest.deferred) { schedule(); return; }
      void flush().catch(error => {
        if (readState().scope === scope) onError(error);
      });
    }, delay);
  }

  return { schedule, flush, cancel };
}
