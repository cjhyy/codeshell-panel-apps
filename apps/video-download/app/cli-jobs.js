// This view reads independent CLI records. Closing it never owns or cancels a CLI worker.
export function mountCliJobs({ root, panel, processes, assertCurrent = () => {} }) {
  const button = root.querySelector("[data-cli-refresh]");
  const status = root.querySelector("[data-cli-status]");
  const list = root.querySelector("[data-cli-list]");
  let closed = false;
  let busy = false;
  let loaded = false;
  let active = false;
  const labels = {
    queued: "等待开始",
    running: "下载中",
    cancelling: "正在取消",
    succeeded: "已完成",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
  };
  async function refresh() {
    if (closed || busy) return;
    busy = true;
    button.disabled = true;
    status.textContent = "正在读取 CLI 任务…";
    try {
      assertCurrent();
      if (!panel) throw new Error("CLI 任务需要在 CodeShell 中读取。");
      const directory = await panel.call("filesystem.getKnownDirectory", { name: "project" });
      assertCurrent();
      if (closed) return;
      const result = await processes.cliJobs(directory);
      assertCurrent();
      if (closed) return;
      list.replaceChildren();
      active = false;
      for (const job of result.jobs) {
        const row = document.createElement("article");
        row.className = "cli-job";
        row.dataset.cliId = job.id;
        const title = document.createElement("strong");
        title.textContent = job.title || job.url || job.id;
        const details = document.createElement("p");
        const fraction = Number(job.progress?.fraction);
        details.textContent = [
          labels[job.status] || job.status,
          Number.isFinite(fraction)
            ? `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`
            : "",
          job.files?.length ? `${job.files.length} 个文件` : "",
          `任务 ${job.id}`,
        ]
          .filter(Boolean)
          .join(" · ");
        row.append(title, details);
        if (job.error?.message) {
          const error = document.createElement("p");
          error.textContent = job.error.message;
          row.append(error);
        }
        if (job.outputDirectory || job.files?.length) {
          const disclosure = document.createElement("details");
          const summary = document.createElement("summary");
          summary.textContent = "查看文件与保存位置";
          disclosure.append(summary);
          if (job.outputDirectory) {
            const directory = document.createElement("p");
            directory.textContent = job.outputDirectory;
            disclosure.append(directory);
          }
          for (const file of (job.files || []).slice(0, 128)) {
            const filename = document.createElement("p");
            filename.textContent = file.name || file.path || "下载文件";
            disclosure.append(filename);
          }
          row.append(disclosure);
        }
        list.append(row);
        active ||= ["queued", "running", "cancelling"].includes(job.status);
      }
      loaded = true;
      status.textContent = result.jobs.length
        ? `${result.jobs.length} 项 CLI 任务${result.truncated ? "（仅显示最近记录）" : ""}；面板下载队列单独保留。`
        : "当前项目还没有 CLI 下载任务。可在聊天中要求搜索或下载视频，无需保持面板打开。";
      if (result.warnings?.length)
        status.textContent += ` ${result.warnings.length} 条记录无法读取，请通过 CLI 检查；原文件未修改。`;
    } catch (error) {
      if (!closed) status.textContent = `无法读取 CLI 任务：${error.message || String(error)}`;
    } finally {
      busy = false;
      if (!closed) button.disabled = false;
    }
  }
  button.addEventListener("click", refresh);
  const timer = setInterval(() => {
    if (loaded && active && !document.hidden && !root.closest("[hidden]")) void refresh();
  }, 5000);
  return {
    refresh,
    destroy() {
      closed = true;
      clearInterval(timer);
      button.removeEventListener("click", refresh);
      list.replaceChildren();
    },
  };
}
