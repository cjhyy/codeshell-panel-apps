import {
  createPanelRuntime,
  taskValue,
  type RuntimeBridge,
  type RuntimeJob,
} from "../sdk/panel-runtime";

let nextExportJobsId = 0;
/** Remembered export titles; the newest are kept when the bound is reached. */
const MAX_EXPORT_TITLES = 200;

/** Where the panel keeps the titles people saw when they submitted each export. */
export interface ExportTitleStore {
  read(): Promise<unknown>;
  write(titles: Record<string, string>): Promise<void>;
}
/** A readable name for an export found in Host history without a remembered title. */
function historyTitle(request: { profile?: { name?: unknown } }): string {
  const preset = request.profile?.name;
  return typeof preset === "string" && preset.trim()
    ? `视频导出 · ${preset.trim().slice(0, 200)}`
    : "视频导出";
}

/** A view of Host-owned durable exports. Reloads discover the original jobs rather than submitting new work. */
export class EditorExportJobs {
  private readonly sdk;
  private readonly root = document.createElement("section");
  private readonly trigger = document.createElement("button");
  private readonly rows = new Map<string, HTMLElement>();
  private readonly latest = new Map<string, RuntimeJob>();
  private readonly pending = new Set<string>();
  private readonly watching = new Map<string, AbortController>();
  private readonly observationErrors = new Set<string>();
  /** Exports whose completion was already reported through onFinished. */
  private readonly finished = new Set<string>();
  /** Job id → the title shown when it was submitted (project name · preset). */
  private titles = new Map<string, string>();
  private titlesLoaded?: Promise<void>;
  private titleWrite: Promise<void> = Promise.resolve();
  private offset = 0;
  private loading = false;
  private disposed = false;
  constructor(
    private readonly bridge: RuntimeBridge,
    private readonly onError: (error: unknown) => void,
    private readonly options: {
      /** Called once when an export this view saw running reaches a final state. */
      onFinished?(job: RuntimeJob): void;
      /** Keeps submitted titles across reloads; history otherwise names only the preset. */
      titles?: ExportTitleStore;
    } = {},
  ) {
    this.sdk = createPanelRuntime(bridge);
    this.root.className = "editor-export-jobs";
    this.root.id = `editor-export-jobs-${++nextExportJobsId}`;
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "导出任务");
    this.root.innerHTML =
      '<header><div><strong>导出任务</strong><span data-count></span></div><button type="button" data-close aria-label="关闭导出任务" title="关闭导出任务">×</button></header><p class="editor-export-jobs-empty">暂无导出任务</p><div class="editor-export-job-list"></div><button type="button" data-more>加载已有任务</button>';
    this.trigger.type = "button";
    this.trigger.className = "editor-export-jobs-trigger quiet";
    this.trigger.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M7 3H4v18h16V3h-3M9 3h6v4H9zM8 12h8M8 16h5"/></svg><span class="editor-export-jobs-label">导出记录</span><span class="editor-export-jobs-badge" hidden></span>';
    this.trigger.setAttribute("aria-controls", this.root.id);
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.setAttribute("aria-haspopup", "dialog");
    this.trigger.addEventListener("click", () => (this.root.hidden ? this.show() : this.hide()));
    this.root.querySelector("[data-close]")!.addEventListener("click", () => this.hide());
    this.root.addEventListener("keydown", (event) => {
      // Task controls must not also dispatch timeline editing shortcuts underneath this view.
      event.stopPropagation();
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.hide();
    });
    this.root.querySelector("[data-more]")!.addEventListener("click", () => {
      void this.loadMore().catch((error) => {
        if (!this.disposed) onError(error);
      });
    });
    document.body.append(this.root);
    document.addEventListener("pointerdown", this.outsideClick);
    this.updateSummary();
  }
  /** Exports still queued or running in the Host. */
  get activeCount(): number {
    return [...this.latest.values()].filter((job) => ["queued", "running"].includes(job.status))
      .length;
  }
  /** Keep task history beside the editor's export action instead of covering the timeline. */
  mountTrigger(container: HTMLElement, before: ChildNode | null = null): void {
    if (!this.disposed) container.insertBefore(this.trigger, before);
  }
  show(): void {
    if (this.disposed) return;
    this.root.hidden = false;
    this.trigger.setAttribute("aria-expanded", "true");
    this.root.querySelector<HTMLButtonElement>("[data-close]")!.focus();
  }
  hide(restoreFocus = true): void {
    const focusedInside = this.root.contains(document.activeElement);
    this.root.hidden = true;
    this.trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus && focusedInside && this.trigger.isConnected) this.trigger.focus();
  }
  private readonly outsideClick = (event: PointerEvent): void => {
    if (
      !this.root.hidden &&
      event.target instanceof Node &&
      !this.root.contains(event.target) &&
      !this.trigger.contains(event.target)
    )
      this.hide(false);
  };
  private updateSummary(): void {
    const active = [...this.latest.values()].filter((job) =>
      ["queued", "running"].includes(job.status),
    ).length;
    const badge = this.trigger.querySelector<HTMLElement>(".editor-export-jobs-badge")!;
    badge.hidden = active === 0;
    badge.textContent = String(active);
    this.trigger.setAttribute(
      "aria-label",
      active ? `导出记录，${active} 个任务进行中` : "导出记录",
    );
    this.trigger.title = active ? `${active} 个视频正在后台导出` : "查看导出记录";
    this.root.querySelector<HTMLElement>("[data-count]")!.textContent = active
      ? `${active} 个进行中`
      : this.rows.size
        ? `${this.rows.size} 条记录`
        : "";
    this.root.querySelector<HTMLElement>(".editor-export-jobs-empty")!.hidden = this.rows.size > 0;
  }
  private loadTitles(): Promise<void> {
    this.titlesLoaded ??= (async () => {
      const saved = await this.options.titles?.read().catch(() => null);
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
      for (const [id, title] of Object.entries(saved))
        if (typeof title === "string" && title && !this.titles.has(id))
          this.titles.set(id, title.slice(0, 400));
    })();
    return this.titlesLoaded;
  }
  private rememberTitle(id: string, title: string): void {
    const store = this.options.titles;
    if (!store || this.titles.get(id) === title) return;
    this.titleWrite = this.titleWrite
      .then(() => this.loadTitles())
      .then(async () => {
        this.titles.delete(id);
        this.titles.set(id, title);
        while (this.titles.size > MAX_EXPORT_TITLES)
          this.titles.delete(this.titles.keys().next().value!);
        await store.write(Object.fromEntries(this.titles));
      })
      // A title is a convenience; losing one only falls back to the preset name.
      .catch(() => {});
  }
  async loadMore(): Promise<void> {
    if (this.loading || this.disposed) return;
    this.loading = true;
    const more = this.root.querySelector<HTMLButtonElement>("[data-more]")!;
    more.disabled = true;
    try {
      await this.sdk.requireMethods(["tasks.list", "tasks.get"]);
      await this.loadTitles();
      // Preparation may create many small jobs. Each click reads a bounded page, never skips unknown pages.
      const page = await this.sdk.call("tasks.list", { offset: this.offset, limit: 50 });
      if (!Array.isArray(page) || page.length > 50) throw new Error("导出任务列表返回无效数据");
      for (const entry of page) {
        if (this.disposed) return;
        if (entry?.entry?.name !== "editor-runtime" || typeof entry.id !== "string") continue;
        const job = taskValue(await this.sdk.call("tasks.get", { id: entry.id }));
        const request = (job.input as any)?.request;
        if (request?.action === "render")
          this.track(job, this.titles.get(job.id) ?? historyTitle(request), false);
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
    // A submission names its project and preset; history rows reuse that title after a reload.
    if (reveal) this.rememberTitle(job.id, name);
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
    if (reveal) this.show();
    const firstSight = !this.latest.has(job.id);
    this.update(job);
    const accepted = this.latest.get(job.id)!;
    // A submitted or refreshed export can already be done when first seen; history pages are not.
    if (firstSight && reveal && !["queued", "running"].includes(accepted.status))
      this.reportFinished(accepted);
    if (["queued", "running"].includes(accepted.status) && !this.watching.has(job.id)) {
      const controller = new AbortController();
      this.watching.set(job.id, controller);
      void this.sdk
        .wait(job.id, { signal: controller.signal, changed: (value) => this.update(value) })
        .catch((error) => {
          if (!this.disposed && !controller.signal.aborted) {
            this.observationErrors.add(job.id);
            this.update(this.latest.get(job.id)!);
            this.onError(error);
          }
        })
        .finally(() => {
          if (this.watching.get(job.id) === controller) this.watching.delete(job.id);
        });
    }
  }
  private reportFinished(job: RuntimeJob): void {
    // A retried export finishes again as a new attempt.
    const key = `${job.id}:${job.attempt}`;
    if (this.finished.has(key)) return;
    this.finished.add(key);
    this.options.onFinished?.(job);
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
    if (terminal(job)) {
      this.watching.get(job.id)?.abort();
      this.observationErrors.delete(job.id);
      if (previous && !terminal(previous)) this.reportFinished(job);
    }
    row.dataset.status = job.status;
    row.querySelector("output")!.textContent = this.observationErrors.has(job.id)
      ? "状态暂未同步，请刷新查看"
      : job.status === "failed"
        ? (job.error?.message ?? "导出失败")
        : (
            {
              queued: "等待导出",
              running: job.progress?.message || "正在导出",
              succeeded: "导出完成",
              cancelled: "已取消",
            } as const
          )[job.status];
    const bar = row.querySelector("progress")!;
    if (job.status === "succeeded") bar.value = 1;
    else if (Number.isFinite(job.progress?.fraction))
      bar.value = Math.max(0, Math.min(1, job.progress!.fraction!));
    else bar.removeAttribute("value");
    bar.hidden =
      job.status === "failed" || job.status === "cancelled" || this.observationErrors.has(job.id);
    const actions = row.querySelector("div")!;
    const focusedAction = actions.contains(document.activeElement)
      ? document.activeElement?.textContent
      : undefined;
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
        if (!this.root.hidden && document.activeElement === control)
          this.root
            .querySelector<HTMLButtonElement>("[data-close]")!
            .focus({ preventScroll: true });
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
    if (this.observationErrors.has(job.id))
      button("刷新状态", async () => {
        const refreshed = taskValue(await this.sdk.call("tasks.get", { id: job.id }));
        this.observationErrors.delete(job.id);
        this.track(refreshed, row.querySelector("strong")!.textContent!, false);
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
    if (focusedAction && !this.root.hidden) {
      const replacement = [...actions.querySelectorAll("button")].find(
        (control) => control.textContent === focusedAction && !control.disabled,
      );
      (replacement ?? this.root.querySelector<HTMLButtonElement>("[data-close]")!).focus({
        preventScroll: true,
      });
    }
    this.updateSummary();
  }
  dispose(): void {
    this.disposed = true;
    for (const controller of this.watching.values()) controller.abort();
    this.watching.clear();
    this.sdk.dispose();
    document.removeEventListener("pointerdown", this.outsideClick);
    this.trigger.remove();
    this.root.remove();
  }
}
