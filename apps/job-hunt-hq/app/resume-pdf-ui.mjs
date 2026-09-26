import { createResumePdfTasks, resumePdfReceipt } from "./resume-pdf-tasks.mjs";

export function createResumePdfUI({ root, scope, saveReceipts, notify }) {
  const tasks = createResumePdfTasks({ call: scope.call, check: scope.check });
  const section = document.createElement("section");
  section.className = "resume-pdf-tasks";
  const title = document.createElement("h3"); title.textContent = "PDF 导出任务";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const refreshButton = document.createElement("button"); refreshButton.type = "button"; refreshButton.textContent = "刷新任务";
  refreshButton.className = "button button-quiet";
  const list = document.createElement("div");
  const more = document.createElement("button"); more.type = "button"; more.textContent = "更早的任务"; more.hidden = true;
  more.className = "button button-quiet";
  section.append(title, status, refreshButton, list, more); root.append(section);
  let closed = false, timer, pending, nextOffset = null;
  const jobs = new Map();
  const labels = { queued: "排队中", running: "正在生成", cancelling: "正在取消", succeeded: "已保存到项目", failed: "生成失败", cancelled: "已取消", interrupted: "已中断，可重试" };
  const active = () => !closed && scope.active();
  async function action(run) {
    try { await run(); if (active()) await refresh(); }
    catch (error) { if (active()) { status.textContent = error.message; notify(error.message, "error"); } }
  }
  function button(text, run) {
    const element = document.createElement("button"); element.type = "button"; element.textContent = text;
    element.className = "button button-quiet";
    element.addEventListener("click", () => { element.disabled = true; void action(run).finally(() => { if (active()) element.disabled = false; }); });
    return element;
  }
  function render() {
    list.replaceChildren();
    for (const job of jobs.values()) {
      const row = document.createElement("article"); row.dataset.pdfTaskId = job.id;
      const text = document.createElement("p");
      text.textContent = `${new Date(job.createdAt).toLocaleString()} · ${labels[job.status] || job.status}${job.error?.message ? `：${job.error.message}` : ""}`;
      row.append(text);
      if (job.status === "succeeded") row.append(button("打开／下载 PDF", () => tasks.open(job.id)));
      else if (["queued", "running"].includes(job.status)) row.append(button("取消导出", () => tasks.cancel(job.id)));
      else if (["failed", "cancelled", "interrupted"].includes(job.status) && !job.readOnly && job.error?.retryable !== false)
        row.append(button("重试本次导出", () => tasks.retry(job.id)));
      list.append(row);
    }
    more.hidden = nextOffset === null;
  }
  function refresh({ older = false } = {}) {
    if (pending) return pending;
    if (!active()) return Promise.resolve();
    clearTimeout(timer);
    pending = (async () => {
      const page = await tasks.list({ offset: older ? nextOffset || 0 : 0, limit: 20 });
      if (!active()) return;
      if (!older) jobs.clear();
      for (const job of page.jobs) jobs.set(job.id, job);
      nextOffset = page.nextOffset;
      render();
      const receipts = page.jobs.map(resumePdfReceipt).filter(Boolean);
      await saveReceipts(receipts);
      if (active()) status.textContent = jobs.size ? "关闭页面后任务仍由项目执行；中断的任务需要手动重试。" : "暂无云端 PDF 任务。";
    })().catch((error) => { if (active()) status.textContent = `读取或保存任务记录失败：${error.message}。可刷新重试。`; })
      .finally(() => {
        pending = null;
        if (active() && [...jobs.values()].some((job) => ["queued", "running", "cancelling"].includes(job.status)))
          timer = setTimeout(() => void refresh(), 5000);
      });
    return pending;
  }
  refreshButton.addEventListener("click", () => void refresh());
  more.addEventListener("click", () => void refresh({ older: true }));
  return {
    refresh,
    async submit(prepared) {
      const job = await tasks.submit(prepared);
      if (!active()) return;
      jobs.set(job.id, job); render();
      await refresh();
      return job;
    },
    close() { closed = true; clearTimeout(timer); section.remove(); },
  };
}
