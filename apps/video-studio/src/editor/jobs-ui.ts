import {
  createPanelRuntime,
  taskValue,
  type RuntimeBridge,
  type RuntimeJob,
} from "../sdk/panel-runtime";

/** A view of Host-owned durable exports. Reloads discover the original jobs rather than submitting new work. */
export class EditorExportJobs {
  private readonly sdk;
  private readonly root = document.createElement("details");
  private readonly rows = new Map<string, HTMLElement>();
  private readonly latest = new Map<string, RuntimeJob>();
  private readonly pending = new Set<string>();
  private readonly watching = new Map<string, AbortController>();
  private offset = 0;
  private loading = false;
  private disposed = false;
  constructor(
    private readonly bridge: RuntimeBridge,
    private readonly onError: (error: unknown) => void,
  ) {
    this.sdk = createPanelRuntime(bridge);
    this.root.className = "editor-export-jobs";
    this.root.innerHTML =
      '<summary>导出任务</summary><div class="editor-export-job-list"></div><button type="button" data-more>加载已有任务</button>';
    this.root.querySelector("[data-more]")!.addEventListener("click", () => {
      void this.loadMore().catch((error) => {
        if (!this.disposed) onError(error);
      });
    });
    document.body.append(this.root);
  }
  async loadMore(): Promise<void> {
    if (this.loading || this.disposed) return;
    this.loading = true;
    const more = this.root.querySelector<HTMLButtonElement>("[data-more]")!;
    more.disabled = true;
    try {
      await this.sdk.requireMethods(["tasks.list", "tasks.get"]);
      // Preparation may create many small jobs. Each click reads a bounded page, never skips unknown pages.
      const page = await this.sdk.call("tasks.list", { offset: this.offset, limit: 50 });
      if (!Array.isArray(page) || page.length > 50) throw new Error("导出任务列表返回无效数据");
      for (const entry of page) {
        if (this.disposed) return;
        if (entry?.entry?.name !== "editor-runtime" || typeof entry.id !== "string") continue;
        const job = taskValue(await this.sdk.call("tasks.get", { id: entry.id }));
        const request = (job.input as any)?.request;
        if (request?.action === "render")
          this.track(job, `视频导出 · ${request.sequenceId ?? "序列"}`, false);
      }
      this.offset += page.length;
      more.hidden = page.length < 50;
      more.textContent = "继续加载更早任务";
    } finally {
      this.loading = false;
      if (!this.disposed) more.disabled = false;
    }
  }
  track(job: RuntimeJob, name: string, reveal = true): void {
    if (this.disposed) return;
    if (!this.rows.has(job.id)) {
      const row = document.createElement("section");
      row.dataset.jobId = job.id;
      const title = document.createElement("strong");
      title.textContent = name;
      row.append(title);
      const output = document.createElement("output");
      output.setAttribute("role", "status");
      row.append(output);
      const progress = document.createElement("progress");
      progress.max = 1;
      row.append(progress);
      const actions = document.createElement("div");
      row.append(actions);
      this.root.querySelector(".editor-export-job-list")!.prepend(row);
      this.rows.set(job.id, row);
    }
    this.rows.get(job.id)!.dataset.createdAt = String(Number(job.createdAt) || 0);
    const list = this.root.querySelector(".editor-export-job-list")!;
    for (const row of [...this.rows.values()].sort(
      (a, b) =>
        Number(b.dataset.createdAt) - Number(a.dataset.createdAt) ||
        a.dataset.jobId!.localeCompare(b.dataset.jobId!),
    ))
      list.append(row);
    if (reveal) this.root.open = true;
    this.update(job);
    const accepted = this.latest.get(job.id)!;
    if (["queued", "running"].includes(accepted.status) && !this.watching.has(job.id)) {
      const controller = new AbortController();
      this.watching.set(job.id, controller);
      void this.sdk
        .wait(job.id, { signal: controller.signal, changed: (value) => this.update(value) })
        .catch((error) => {
          if (!this.disposed && !controller.signal.aborted) this.onError(error);
        })
        .finally(() => {
          if (this.watching.get(job.id) === controller) this.watching.delete(job.id);
        });
    }
  }
  private update(job: RuntimeJob): void {
    if (this.disposed) return;
    const row = this.rows.get(job.id);
    if (!row) return;
    const previous = this.latest.get(job.id);
    const terminal = (value: RuntimeJob) => !["queued", "running"].includes(value.status);
    if (
      previous &&
      (job.attempt < previous.attempt ||
        (job.attempt === previous.attempt &&
          (job.updatedAt < previous.updatedAt ||
            (terminal(previous) && !terminal(job)) ||
            (terminal(previous) &&
              terminal(job) &&
              previous.status !== job.status &&
              job.updatedAt <= previous.updatedAt))))
    )
      return;
    this.latest.set(job.id, job);
    if (terminal(job)) this.watching.get(job.id)?.abort();
    row.querySelector("output")!.textContent =
      job.status === "failed"
        ? (job.error?.message ?? "导出失败")
        : (
            {
              queued: "等待导出",
              running: "正在导出",
              succeeded: "导出完成",
              cancelled: "已取消",
            } as const
          )[job.status];
    const bar = row.querySelector("progress")!;
    if (job.status === "succeeded") bar.value = 1;
    else if (Number.isFinite(job.progress?.fraction))
      bar.value = Math.max(0, Math.min(1, job.progress!.fraction!));
    else bar.removeAttribute("value");
    bar.hidden = job.status === "failed" || job.status === "cancelled";
    const actions = row.querySelector("div")!;
    actions.replaceChildren();
    const button = (label: string, work: () => Promise<unknown>) => {
      const control = document.createElement("button");
      control.type = "button";
      control.textContent = label;
      const key = `${job.id}:${label}`;
      control.disabled = this.pending.has(key);
      control.addEventListener("click", () => {
        if (this.disposed || this.pending.has(key)) return;
        this.pending.add(key);
        control.disabled = true;
        void work()
          .catch((error) => {
            if (!this.disposed) this.onError(error);
          })
          .finally(() => {
            this.pending.delete(key);
            const current = this.latest.get(job.id);
            if (!this.disposed && current) this.update(current);
          });
      });
      actions.append(control);
    };
    if (["queued", "running"].includes(job.status))
      button("取消", async () => {
        this.update(await this.sdk.cancel(job.id));
      });
    if (job.status === "failed" && job.error?.retryable)
      button("重试", async () => {
        const retried = await this.sdk.retry(job.id);
        this.watching.get(job.id)?.abort();
        this.watching.delete(job.id);
        this.track(retried, row.querySelector("strong")!.textContent!);
      });
    const result = job.result?.result ?? job.result;
    if (
      job.status === "succeeded" &&
      result?.verified === true &&
      /^asset-[a-f0-9]{64}$/.test(result.video?.id ?? "")
    ) {
      button("保存视频", () => this.sdk.call("media.export", { assetId: result.video.id }));
      button("在文件夹中显示", () => this.sdk.call("media.reveal", { assetId: result.video.id }));
    }
  }
  dispose(): void {
    this.disposed = true;
    for (const controller of this.watching.values()) controller.abort();
    this.watching.clear();
    this.sdk.dispose();
    this.root.remove();
  }
}
