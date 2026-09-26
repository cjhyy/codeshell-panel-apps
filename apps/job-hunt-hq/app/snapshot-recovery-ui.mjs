import { MAX_SNAPSHOT_BACKUP_BYTES } from "./snapshot-backup.mjs";
import { reviewSnapshotRestore, applySnapshotRestore } from "./snapshot-restore.mjs";

const DIRECTORY = "career-data/panel-backups";
const manifestPath = path => /^career-data\/panel-backups\/g-[0-9a-f]{32}\/manifest\.json$/.test(path);
export function mountSnapshotRecovery({ getScope, getTarget, captureClient, basis, assertReady, beginApply, endApply, completed, pace }) {
  const el = id => document.getElementById(id);
  const dialog = el("snapshot-recovery-dialog"), status = el("snapshot-recovery-status");
  const chooser = el("snapshot-recovery-source"), input = el("snapshot-recovery-path");
  let ticket = 0, busy = false, selected = null;
  function state(value) {
    busy = value;
    for (const id of ["snapshot-recovery-file", "snapshot-recovery-source", "snapshot-recovery-path", "snapshot-recovery-review", "snapshot-recovery-refresh", "snapshot-recovery-close"])
      el(id).disabled = value;
    el("snapshot-recovery-apply").disabled = value || !selected?.review.restorable;
    el("snapshot-recovery-download").disabled = value || !selected;
    el("snapshot-recovery-drafts").disabled = value || !selected?.review.backup.bundle.clientState;
  }
  function clear() { selected = null; el("snapshot-recovery-preview").textContent = ""; state(false); }
  function start() {
    const id = ++ticket, scope = getScope();
    return { id, scope, check() {
      scope.check();
      if (id !== ticket || !dialog.open) throw new Error("备份操作已取消");
    } };
  }
  const invokeScope = op => ({
    check: op.check,
    async call(method, params) { op.check(); const result = await op.scope.call(method, params); op.check(); return result; },
  });
  const failed = (op, error) => { if (op.id === ticket && dialog.open) status.textContent = error.message; };
  async function refresh() {
    if (busy) return;
    clear(); chooser.replaceChildren(); input.value = "";
    const op = start(); state(true);
    try {
      status.textContent = "正在读取项目内的备份…";
      const scope = invokeScope(op);
      const listing = await scope.call("workspace.list", { path: DIRECTORY });
      const entries = (listing?.entries || []).filter(entry => entry.kind === "directory" &&
        /^career-data\/panel-backups\/g-[0-9a-f]{32}$/.test(entry.path));
      const choices = [];
      for (const [index, entry] of entries.entries()) {
        await pace(index + 1); op.check();
        const path = `${entry.path}/manifest.json`;
        try {
          const file = await scope.call("workspace.readText", { path });
          const metadata = JSON.parse(file.content);
          const date = typeof metadata.createdAt === "string" ? metadata.createdAt : "时间未知";
          const reason = { "before-restore": "恢复前已保存内容", "before-restore-unsaved": "恢复前未保存修改", "retired-drafts": "恢复前草稿", migration: "升级前快照" }[metadata.reason] || "项目备份";
          choices.push({ path, date, label: `${date.replace("T", " ").replace("Z", " UTC")} · ${reason}${metadata.kind === "raw" ? "（原文，可下载）" : ""}` });
        } catch (error) {
          op.check();
          if (!/ENOENT|no such file|file not found/i.test(String(error)))
            choices.push({ path, date: "", label: "备份索引无法读取 · 请预览查看原因" });
        }
      }
      choices.sort((a, b) => b.date.localeCompare(a.date));
      const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "选择一个备份";
      chooser.append(placeholder);
      for (const item of choices) {
        const option = document.createElement("option"); option.value = item.path; option.textContent = item.label; chooser.append(option);
      }
      status.textContent = listing?.truncated
        ? "仅列出部分备份；也可粘贴项目内的备份位置。选择后先预览，不会立即覆盖。"
        : choices.length ? "选择后先预览；确认恢复前会保留当前文件及草稿。" : "项目内还没有完成的快照备份。";
    } catch (error) { failed(op, error); }
    finally { if (op.id === ticket) state(false); }
  }
  async function review(file = null) {
    if (busy) return;
    const path = input.value.trim(); clear();
    const op = start(); state(true);
    try {
      if (!file && !manifestPath(path)) throw new Error("请选择备份，或粘贴项目内的 manifest.json 位置");
      if (file && file.size > MAX_SNAPSHOT_BACKUP_BYTES * 2) throw new Error("备份文件过大");
      const capturedBasis = basis();
      status.textContent = "正在核对备份和当前文件，尚未写入项目…";
      const source = file ? await file.text() : path;
      op.check();
      const plan = await reviewSnapshotRestore(source, {
        scope: invokeScope(op), beforeOperation: pace, clientState: captureClient(),
      });
      op.check();
      if (capturedBasis !== basis()) throw new Error("当前编辑内容已变化，请重新预览");
      selected = { review: plan, scope: op.scope, basis: capturedBasis };
      const data = plan.backup.hydrated;
      el("snapshot-recovery-preview").textContent = plan.restorable
        ? `恢复到：${getTarget()}\n备份时间：${plan.backup.manifest.createdAt}\n岗位：${data.jobs?.length || 0} · 题库：${data.questionBank?.length || 0} · 简历版本：${data.versions?.length || 0}\n简历预览：\n${String(data.resume?.markdown || "（没有简历正文）").slice(0, 2400)}`
        : `原文备份，可下载检查，不能直接作为项目快照恢复。\n${plan.backup.bundle.root.slice(0, 2400)}`;
      status.textContent = !plan.restorable ? "完整性校验通过。可下载保留的原文。"
        : plan.previousStatus === "damaged" ? "当前主文件损坏。确认后先保留其原文和当前草稿，再恢复备份；已有分片和资料文件不会删除。"
        : plan.previousStatus === "missing" ? "当前主文件不存在。确认后保留当前草稿，再重建项目快照。"
        : "校验通过。确认后先备份当前快照和未保存草稿，再恢复所选内容。照片、JD 原件、外部资料及后台任务不随快照回滚。";
    } catch (error) { failed(op, error); }
    finally { if (op.id === ticket) state(false); }
  }
  el("snapshot-recovery-open").addEventListener("click", () => {
    if (dialog.open) return;
    ticket++; clear(); dialog.showModal(); void refresh();
  });
  el("snapshot-recovery-refresh").addEventListener("click", () => void refresh());
  chooser.addEventListener("change", () => { input.value = chooser.value; void review(); });
  input.addEventListener("input", () => { if (!busy) clear(); });
  el("snapshot-recovery-file").addEventListener("change", event => {
    const file = event.target.files?.[0]; event.target.value = ""; if (file) void review(file);
  });
  el("snapshot-recovery-review").addEventListener("click", () => void review());
  el("snapshot-recovery-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { ticket++; clear(); });
  el("snapshot-recovery-drafts").addEventListener("click", () => {
    if (busy || !selected) return;
    try {
      selected.scope.check();
      const client = selected.review.backup.bundle.clientState;
      if (!client) return;
      const value = { format: "codeshell.job-hunt.draft-backup", version: 1,
        current: { drafts: client.drafts || client.local || {} },
        stored: { hostState: client.local || {}, records: client.records || [] } };
      const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "job-hunt-preserved-drafts.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "草稿已导出，可从“恢复草稿备份”明确选择要导入的正文或回答。";
    } catch (error) { status.textContent = error.message; }
  });
  el("snapshot-recovery-download").addEventListener("click", () => {
    if (busy || !selected) return;
    try {
      selected.scope.check();
      const backup = selected.review.backup;
      const content = backup.raw ? backup.bundle.root : JSON.stringify({ manifest: backup.manifest, bundle: backup.bundle }, null, 2);
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = backup.raw ? "job-hunt-preserved-original.json" : "job-hunt-snapshot-backup.json";
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { status.textContent = error.message; }
  });
  el("snapshot-recovery-apply").addEventListener("click", async () => {
    if (busy || !selected?.review.restorable) return;
    const approved = selected, op = start(); state(true);
    let committed = false, started = false;
    try {
      approved.scope.check(); assertReady();
      if (approved.basis !== basis()) throw new Error("当前内容已变化，请重新预览后恢复");
      started = true; await beginApply(); op.check();
      if (approved.basis !== basis()) throw new Error("保存期间内容已变化，请重新预览后恢复");
      status.textContent = "正在保留当前内容并恢复备份…";
      const result = await applySnapshotRestore(approved.review, { scope: invokeScope(op), beforeOperation: pace });
      committed = true; selected = null;
      status.textContent = `项目快照已恢复。恢复前内容保存在：${result.preserved.path}`;
      await completed();
    } catch (error) {
      if (op.id === ticket) selected = null;
      if (op.id === ticket && dialog.open) status.textContent = `${committed ? "文件已经恢复；" : "未确认恢复成功；"}${error.message}`;
    } finally {
      if (started) endApply(op.scope);
      if (op.id === ticket) state(false);
    }
  });
  return { contextChanged() {
    ticket++; clear(); chooser.replaceChildren(); input.value = "";
    if (dialog.open) status.textContent = "项目已切换，旧恢复操作已停止。请刷新并重新选择备份。";
  } };
}
