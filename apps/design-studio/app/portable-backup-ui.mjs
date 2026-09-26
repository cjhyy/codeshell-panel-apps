import { createPortableDesign, restorePortableDesign, MAX_PORTABLE_DESIGN_BYTES } from "./portable-backup.mjs";
import { designBackupCandidates, planDesignBackup } from "./legacy-backup.mjs";

export function mountPortableBackup({ getScope, checkScope, capture, call, sha256, sha256Bytes, restored }) {
  const el = id => document.getElementById(id);
  const dialog = el("portable-backup-dialog"), status = el("portable-backup-status");
  let generation = 0, selected = null, busy = false, candidates = [], candidateScope = null;
  const chooser = el("portable-backup-candidate");
  const clearCandidates = () => { el("portable-backup-file").value = ""; candidates = []; candidateScope = null; chooser.replaceChildren(); chooser.hidden = true; };
  const reset = () => { selected = null; el("portable-backup-restore").disabled = true; };
  const state = value => {
    busy = value;
    chooser.disabled = value;
    el("portable-backup-export").disabled = value;
    el("portable-backup-file").disabled = value;
    el("portable-backup-path").disabled = value;
    el("portable-backup-restore").disabled = value || !selected;
  };
  function start(scope = getScope()) {
    const ticket = ++generation;
    checkScope(scope);
    return { scope, ticket, check() {
      if (generation !== ticket || !dialog.open) throw Error("备份操作已取消");
      checkScope(scope);
    } };
  }
  const scopedCall = operation => async (method, params) => {
    operation.check();
    const result = await call(method, params);
    operation.check();
    return result;
  };
  const failed = (operation, error) => {
    if ((!operation || generation === operation.ticket) && dialog.open) status.textContent = error.message;
  };
  el("portable-backup-open").addEventListener("click", () => {
    generation++; reset(); clearCandidates(); state(false);
    el("portable-backup-file").value = "";
    el("portable-backup-preview").textContent = "";
    el("portable-backup-path").value = `designs/restored-${Date.now()}.codesign.json`;
    status.textContent = "下载完整设计备份，或选择备份恢复到当前项目的新文件。当前画布和已有文件会保留。";
    dialog.showModal();
  });
  el("portable-backup-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { generation++; reset(); clearCandidates(); state(false); });
  el("portable-backup-export").addEventListener("click", async () => {
    if (busy) return;
    let operation;
    reset(); clearCandidates(); state(true);
    try {
      operation = start();
      status.textContent = "正在读取全部页面并校验图片和字体…";
      const documentValue = await capture(operation.scope);
      operation.check();
      const text = await createPortableDesign({ document: documentValue, source: operation.scope.source,
        readText: path => scopedCall(operation)("workspace.readText", { path }), sha256Bytes });
      operation.check();
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = "design-complete-backup.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "完整备份已生成，包含全部页面和已校验的项目图片、字体。";
    } catch (error) { failed(operation, error); }
    finally { if (!operation || generation === operation.ticket) state(false); }
  });
  async function prepareCandidate(operation) {
    const candidate = candidates[Number(chooser.value)];
    if (!candidate) throw Error("请选择要恢复的草稿");
    const plan = await planDesignBackup(candidate, { sha256, sha256Bytes,
      readText: path => scopedCall(operation)("workspace.readText", { path }) });
    operation.check();
    selected = { plan, scope: operation.scope };
    el("portable-backup-preview").textContent = `${plan.legacy ? "草稿日志恢复 · " : ""}${plan.name} · ${plan.pageCount} 页 · ${plan.resourceCount} 个资源\n来源：${plan.source.workspaceRoot ?? "未知"} / ${plan.source.path ?? "未保存"}\n来源会话：${plan.source.sessionId ?? "未记录"}\n恢复到：${operation.scope.source.workspaceRoot ?? "当前项目"}（${operation.scope.source.sessionId ?? "当前会话"}）`;
    status.textContent = "校验通过。确认后创建独立设计文件，保留当前画布和原始日志。";
  }
  el("portable-backup-file").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file || busy) return;
    let operation;
    reset(); clearCandidates(); state(true);
    el("portable-backup-preview").textContent = "";
    try {
      operation = start();
      if (file.size > MAX_PORTABLE_DESIGN_BYTES) throw Error("设计备份不能超过 128 MiB");
      status.textContent = "正在校验备份及所需基础文件，尚未写入项目…";
      const text = await file.text();
      operation.check();
      candidates = designBackupCandidates(text); candidateScope = operation.scope;
      chooser.replaceChildren(...candidates.map((candidate, index) => {
        const option = document.createElement("option"); option.value = String(index);
        option.textContent = candidate.label; return option;
      }));
      chooser.hidden = candidates.length === 1;
      chooser.value = "0";
      await prepareCandidate(operation);
    } catch (error) { failed(operation, error); }
    finally { if (!operation || generation === operation.ticket) state(false); }
  });
  chooser.addEventListener("change", async () => {
    if (busy || !candidateScope) return;
    let operation;
    reset(); state(true); el("portable-backup-preview").textContent = "";
    try {
      operation = start(candidateScope);
      status.textContent = "正在核对所选草稿的基础版本和资源…";
      await prepareCandidate(operation);
    } catch (error) { failed(operation, error); }
    finally { if (!operation || generation === operation.ticket) state(false); }
  });
  el("portable-backup-restore").addEventListener("click", async () => {
    if (busy || !selected) return;
    const review = selected, path = el("portable-backup-path").value.trim();
    let operation;
    state(true);
    try {
      operation = start(review.scope);
      status.textContent = "正在恢复资源和设计文件…";
      await restorePortableDesign({ plan: review.plan, path,
        call: scopedCall(operation), check: operation.check });
      operation.check();
      reset();
      status.textContent = `已恢复到 ${path}。当前画布保持不变，可从“打开设计文件”选择该副本。`;
      restored(path);
    } catch (error) { failed(operation, error); }
    finally { if (!operation || generation === operation.ticket) state(false); }
  });
  return { contextChanged() {
    generation++; reset(); clearCandidates(); state(false);
    el("portable-backup-preview").textContent = "";
    if (dialog.open) status.textContent = "项目已切换，旧操作已停止。请重新选择备份并确认目标项目。";
  } };
}
