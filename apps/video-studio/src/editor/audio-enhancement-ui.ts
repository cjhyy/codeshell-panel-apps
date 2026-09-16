import type {
  AudioEnhancementController,
  AudioEnhancementState,
} from "./audio-enhancement-controller";
export interface AudioEnhancementUIContext {
  controller: AudioEnhancementController;
  /** Resolve an authorized Host resource to a revocable preview URL. */
  preview(resourceId: string, signal: AbortSignal): Promise<{ url: string; release(): void }>;
  onError?(error: Error): void;
}
export class EditorAudioEnhancementUI {
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
    private context: AudioEnhancementUIContext,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "editor-audio-enhancement";
    this.dialog.setAttribute("aria-label", "声音优化");
    this.dialog.innerHTML = `<header><h2>声音优化</h2><button type="button" data-audio-enhancement-close aria-label="关闭">×</button></header><p>选择降噪和响度统一，仅应用到当前选中的片段。请先试听优化前后的声音。</p><p data-audio-enhancement-status role="status"></p><progress max="1" hidden></progress><div class="audio-enhancement-actions"><label><input type="checkbox" data-enhancement-denoise checked>降噪</label><label><input type="checkbox" data-enhancement-normalize checked>响度统一</label><select data-enhancement-preset aria-label="处理强度"><option value="light">轻度</option><option value="balanced" selected>均衡</option></select><button type="button" data-audio-enhancement-refresh>检查处理器</button><button type="button" data-audio-enhancement-start>开始优化</button><button type="button" data-audio-enhancement-cancel>取消任务</button></div><section data-audio-enhancement-preview hidden><label>原始声音<audio controls preload="metadata" data-stem="original"></audio></label><label>优化声音<audio controls preload="metadata" data-stem="enhanced"></audio></label><p>应用后保留原片与原来的时序、淡入淡出和音量动画，新增优化音轨并静音原声。</p><button type="button" data-audio-enhancement-apply>应用优化声音</button></section>`;
    container.append(this.dialog);
    const history = document.createElement("details");
    history.innerHTML =
      '<summary>已有优化任务</summary><div data-audio-enhancement-jobs></div><button type="button" data-audio-enhancement-more>查找这个素材的已有任务</button>';
    this.dialog.append(history);
    this.get<HTMLButtonElement>("[data-audio-enhancement-more]").onclick = () =>
      this.run(() => this.loadJobs());
    this.get<HTMLButtonElement>("[data-audio-enhancement-close]").onclick = () => this.close();
    this.get<HTMLButtonElement>("[data-audio-enhancement-refresh]").onclick = () =>
      this.run(() => context.controller.refresh());
    this.get<HTMLButtonElement>("[data-audio-enhancement-start]").onclick = () =>
      this.run(() =>
        context.controller.start(this.sequenceId, this.clipId, {
          preset: this.get<HTMLSelectElement>("[data-enhancement-preset]").value as
            | "light"
            | "balanced",
          denoise: this.get<HTMLInputElement>("[data-enhancement-denoise]").checked,
          normalize: this.get<HTMLInputElement>("[data-enhancement-normalize]").checked,
        }),
      );
    this.get<HTMLButtonElement>("[data-audio-enhancement-cancel]").onclick = () =>
      context.controller.cancel();
    this.get<HTMLButtonElement>("[data-audio-enhancement-apply]").onclick = () =>
      this.run(() => context.controller.apply());
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
      button = this.get<HTMLButtonElement>("[data-audio-enhancement-more]");
    button.disabled = true;
    try {
      const page = await this.context.controller.jobs(this.sequenceId, this.clipId, this.jobOffset);
      if (this.disposed || generation !== this.selectionGeneration) return;
      const list = this.get<HTMLElement>("[data-audio-enhancement-jobs]");
      for (const job of page.jobs) {
        const row = document.createElement("div"),
          name = document.createElement("span"),
          control = document.createElement("button");
        const labels = {
          queued: "等待处理",
          running: "正在优化",
          succeeded: "优化完成",
          failed: "优化失败",
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
      if (page.complete && !list.childElementCount) list.textContent = "这个素材还没有优化任务";
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
  private render(state: AudioEnhancementState) {
    if (this.disposed) return;
    const settings = state.candidate?.result.settings;
    this.get<HTMLElement>("[data-audio-enhancement-status]").textContent =
      state.message +
      (settings
        ? ` · 本次结果：${settings.preset === "light" ? "轻度" : "均衡"}${settings.denoise ? "降噪" : ""}${settings.denoise && settings.normalize ? "＋" : ""}${settings.normalize ? "响度统一" : ""}`
        : "");
    for (const input of this.dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "[data-enhancement-denoise],[data-enhancement-normalize],[data-enhancement-preset]",
    ))
      input.disabled = ["checking", "running", "applying"].includes(state.phase);
    const busy = ["checking", "running", "applying"].includes(state.phase),
      progress = this.get<HTMLProgressElement>("progress");
    progress.hidden = !busy;
    this.get<HTMLButtonElement>("[data-audio-enhancement-refresh]").disabled = busy;
    if (state.fraction !== undefined) progress.value = state.fraction;
    else progress.removeAttribute("value");
    this.get<HTMLButtonElement>("[data-audio-enhancement-start]").disabled =
      busy || state.capability?.state !== "ready";
    this.get<HTMLButtonElement>("[data-audio-enhancement-cancel]").disabled =
      !busy || state.phase === "applying";
    this.get<HTMLElement>("[data-audio-enhancement-preview]").hidden = !state.candidate;
    this.get<HTMLButtonElement>("[data-audio-enhancement-apply]").disabled =
      busy || !state.candidate;
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
      ["enhanced", result.assetId],
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
      this.get<HTMLElement>("[data-audio-enhancement-jobs]").replaceChildren();
      const more = this.get<HTMLButtonElement>("[data-audio-enhancement-more]");
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
