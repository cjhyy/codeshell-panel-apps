import type { SeparationController, SeparationState } from "./separation-controller";
export interface SeparationUIContext {
  controller: SeparationController;
  /** Resolve an authorized Host resource to a revocable preview URL. */
  preview(resourceId: string, signal: AbortSignal): Promise<{ url: string; release(): void }>;
  onError?(error: Error): void;
}
export class EditorSeparationUI {
  readonly dialog: HTMLDialogElement;
  private sequenceId = "";
  private clipId = "";
  private abort?: AbortController;
  private releases: Array<() => void> = [];
  private disposed = false;
  private unsubscribe: () => void;
  private previewKey = "";
  private jobOffset = 0;
  private jobsLoading = false;
  private selectionGeneration = 0;
  constructor(
    container: HTMLElement,
    private context: SeparationUIContext,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "editor-separation";
    this.dialog.setAttribute("aria-label", "人声与伴奏分离");
    this.dialog.innerHTML = `<header><h2>人声与伴奏分离</h2><button type="button" data-separation-close aria-label="关闭">×</button></header><p>本地模型将原素材分成人声和伴奏。分离可能留有残余声音，请先试听。</p><p data-separation-status role="status"></p><progress max="1" hidden></progress><div class="separation-actions"><button type="button" data-separation-install>安装本地分离模型</button><button type="button" data-separation-start>开始分离</button><button type="button" data-separation-cancel>取消任务</button></div><section data-separation-preview hidden><label>原始声音<audio controls preload="metadata" data-stem="original"></audio></label><label>人声<audio controls preload="metadata" data-stem="vocals"></audio></label><label>伴奏<audio controls preload="metadata" data-stem="instrumental"></audio></label><p>应用后保留原片画面和素材，将其原声静音，并加入选中的音轨。</p><label>加入时间线<select data-separation-mode><option value="vocals">人声</option><option value="instrumental">伴奏</option><option value="both">人声与伴奏</option></select></label><button type="button" data-separation-apply>应用所选音轨</button></section>`;
    container.append(this.dialog);
    const history = document.createElement("details");
    history.innerHTML =
      '<summary>已有分离任务</summary><div data-separation-jobs></div><button type="button" data-separation-more>查找这个素材的已有任务</button>';
    this.dialog.append(history);
    this.get<HTMLButtonElement>("[data-separation-more]").onclick = () =>
      this.run(() => this.loadJobs());
    this.get<HTMLButtonElement>("[data-separation-close]").onclick = () => this.close();
    this.get<HTMLButtonElement>("[data-separation-install]").onclick = () =>
      this.run(() => context.controller.install());
    this.get<HTMLButtonElement>("[data-separation-start]").onclick = () =>
      this.run(() => context.controller.start(this.sequenceId, this.clipId));
    this.get<HTMLButtonElement>("[data-separation-cancel]").onclick = () =>
      context.controller.cancel();
    this.get<HTMLButtonElement>("[data-separation-apply]").onclick = () =>
      this.run(() =>
        context.controller.apply(
          this.get<HTMLSelectElement>("[data-separation-mode]").value as
            | "vocals"
            | "instrumental"
            | "both",
        ),
      );
    this.dialog.addEventListener("close", () => this.release());
    this.dialog.addEventListener(
      "play",
      (event) => {
        for (const audio of this.dialog.querySelectorAll("audio"))
          if (audio !== event.target) audio.pause();
      },
      true,
    );
    this.unsubscribe = context.controller.subscribe((state) => this.render(state));
  }
  private get<T extends Element>(selector: string) {
    return this.dialog.querySelector<T>(selector)!;
  }
  private run(work: () => Promise<unknown>) {
    void work().catch((error) => {
      if (this.disposed) return;
      const reason = error instanceof Error ? error : new Error(String(error));
      this.get<HTMLElement>("[role=status]").textContent = reason.message;
      this.context.onError?.(reason);
    });
  }
  private async loadJobs() {
    if (this.jobsLoading || this.disposed) return;
    this.jobsLoading = true;
    const generation = this.selectionGeneration,
      button = this.get<HTMLButtonElement>("[data-separation-more]");
    button.disabled = true;
    try {
      const page = await this.context.controller.jobs(this.sequenceId, this.clipId, this.jobOffset);
      if (this.disposed || generation !== this.selectionGeneration) return;
      const list = this.get<HTMLElement>("[data-separation-jobs]");
      for (const job of page.jobs) {
        const row = document.createElement("div"),
          name = document.createElement("span"),
          control = document.createElement("button");
        const labels = {
          queued: "等待处理",
          running: "正在分离",
          succeeded: "分离完成",
          failed: "分离失败",
          cancelled: "已取消",
        };
        name.textContent = `${new Date(job.createdAt).toLocaleString()} · ${labels[job.status]}`;
        control.type = "button";
        control.textContent =
          job.status === "succeeded"
            ? "重新试听"
            : job.status === "queued" || job.status === "running"
              ? "查看进度"
              : "重试";
        control.disabled = ["failed", "cancelled"].includes(job.status) && !job.retryable;
        control.onclick = () =>
          this.run(() =>
            this.context.controller.resume(
              this.sequenceId,
              this.clipId,
              job.id,
              ["failed", "cancelled"].includes(job.status),
            ),
          );
        row.append(name, control);
        list.append(row);
      }
      this.jobOffset = page.nextOffset;
      button.hidden = page.complete;
      button.textContent = "继续查找更早任务";
      if (page.complete && !list.childElementCount) list.textContent = "这个素材还没有分离任务";
    } finally {
      if (generation === this.selectionGeneration) {
        this.jobsLoading = false;
        if (!this.disposed) button.disabled = false;
      }
    }
  }
  private release() {
    this.abort?.abort();
    this.abort = undefined;
    for (const audio of this.dialog.querySelectorAll("audio")) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    this.releases.splice(0).forEach((release) => release());
    this.previewKey = "";
  }
  private render(state: SeparationState) {
    if (this.disposed) return;
    this.get<HTMLElement>("[data-separation-status]").textContent = state.message;
    const busy = ["checking", "installing", "running", "applying"].includes(state.phase),
      progress = this.get<HTMLProgressElement>("progress");
    progress.hidden = !busy;
    if (state.fraction !== undefined) progress.value = state.fraction;
    else progress.removeAttribute("value");
    const install = this.get<HTMLButtonElement>("[data-separation-install]");
    install.hidden = state.capability?.state === "ready";
    install.disabled = busy || !state.capability?.canInstall;
    this.get<HTMLButtonElement>("[data-separation-start]").disabled =
      busy || state.capability?.state !== "ready";
    this.get<HTMLButtonElement>("[data-separation-cancel]").disabled =
      !busy || state.phase === "applying";
    this.get<HTMLElement>("[data-separation-preview]").hidden = !state.candidate;
    this.get<HTMLButtonElement>("[data-separation-apply]").disabled = busy || !state.candidate;
    if (!state.candidate) {
      if (this.previewKey) this.release();
      return;
    }
    if (!this.dialog.open) return;
    const key = JSON.stringify(state.candidate);
    if (key === this.previewKey) return;
    this.release();
    this.previewKey = key;
    const controller = new AbortController();
    this.abort = controller;
    const result = state.candidate.result;
    for (const [role, id] of [
      ["original", result.sourceResourceId],
      ["vocals", result.stems.vocals.assetId],
      ["instrumental", result.stems.instrumental.assetId],
    ]) {
      this.run(async () => {
        const resolved = await this.context.preview(id!, controller.signal);
        if (this.disposed || controller.signal.aborted || this.abort !== controller) {
          resolved.release();
          return;
        }
        this.releases.push(() => resolved.release());
        this.get<HTMLAudioElement>(`[data-stem="${role}"]`).src = resolved.url;
      });
    }
  }
  open(sequenceId: string, clipId: string) {
    if (this.disposed) return;
    const state = this.context.controller.getState(),
      different =
        state.source && (state.source.sequenceId !== sequenceId || state.source.clipId !== clipId);
    if (different && ["running", "applying"].includes(state.phase))
      throw new Error(`「${state.source!.name}」仍在处理，请先完成或取消当前任务`);
    if (different && state.candidate) this.context.controller.cancel();
    if (this.sequenceId !== sequenceId || this.clipId !== clipId) {
      this.selectionGeneration++;
      this.jobOffset = 0;
      this.jobsLoading = false;
      this.get<HTMLElement>("[data-separation-jobs]").replaceChildren();
      const more = this.get<HTMLButtonElement>("[data-separation-more]");
      more.hidden = false;
      more.disabled = false;
      more.textContent = "查找这个素材的已有任务";
    }
    this.sequenceId = sequenceId;
    this.clipId = clipId;
    if (!this.dialog.open) this.dialog.showModal();
    this.render(this.context.controller.getState());
    if (!this.context.controller.getState().capability)
      this.run(() => this.context.controller.refresh());
  }
  close() {
    this.release();
    if (this.dialog.open) this.dialog.close();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.unsubscribe();
    this.dialog.remove();
  }
}
