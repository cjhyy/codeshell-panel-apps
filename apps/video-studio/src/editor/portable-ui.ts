import { createPanelRuntime, runtimeCancelled, type RuntimeBridge } from "../sdk/panel-runtime";
import type { EditorSession, SessionIdentity } from "./session";
import type { EditorDocument } from "./types";
import type {
  createEditorTaskBridge,
  EditorProjectImportReceipt,
  EditorTaskArtifact,
  EditorTaskSnapshot,
} from "./task-bridge";
import { uploadEditorResource, type UploadedEditorResource } from "./resource-upload";
import { validateEditorDocument } from "./validation";
import { isResourceId } from "../external-media";

export type EditorPortableRequest =
  | { action: "export"; requestId: string }
  | { action: "import"; requestId: string; resourceId: string }
  | { action: "continue" | "apply" | "save" | "cancel"; requestId: string; pendingId: string };

type Tasks = Pick<
  ReturnType<typeof createEditorTaskBridge>,
  "importProjectBundle" | "exportProjectBundle" | "discardProjectImport"
>;
interface Options {
  panel: RuntimeBridge;
  tasks: Tasks;
  session(): EditorSession;
  /** Owns saving/archiving the current project and one durable atomic replacement. */
  replace(document: EditorDocument, expectedIdentity: SessionIdentity): Promise<void>;
  assertEditable(): void;
  onError(error: unknown): void;
  container?: HTMLElement;
}
interface Pending {
  id: string;
  mode: "import" | "export";
  identity: SessionIdentity;
  session: EditorSession;
  cwd: string;
  file?: File;
  resource?: UploadedEditorResource;
  requestedResourceId?: string;
  receipt?: EditorProjectImportReceipt;
  candidate?: EditorDocument;
  document?: EditorDocument;
  bundle?: EditorTaskArtifact;
  snapshot?: EditorTaskSnapshot;
  applied?: boolean;
  discardRequested?: boolean;
  saved?: boolean;
  applyAttempted?: boolean;
}
const sameIdentity = (a: SessionIdentity, b: SessionIdentity, revisions = true) =>
  a.documentId === b.documentId &&
  a.generation === b.generation &&
  (!revisions || a.revision === b.revision);
const sizeLabel = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
      : `${Math.ceil(bytes / 1024)} KB`;

/** File exchange UI. Holds proposals across failures; only the injected replace callback changes the editor. */
export class EditorPortableUI {
  private readonly runtime;
  private readonly input = document.createElement("input");
  private readonly dialog = document.createElement("dialog");
  private readonly title = document.createElement("h2");
  private readonly message = document.createElement("p");
  private readonly summary = document.createElement("section");
  private readonly primary = document.createElement("button");
  private readonly cancel = document.createElement("button");
  private readonly close = document.createElement("button");
  private pending?: Pending;
  private controller?: AbortController;
  private active?: Promise<void>;
  private disposed = false;
  private busy = false;
  private uninterruptible = false;
  private commands = new Map<
    string,
    { fingerprint: string; operationId: string; status: string }
  >();
  private activeResult?: { status: "running" | "completed" | "cancelled" | "failed" };
  private cancelRequested = false;
  private publicStatus?: string;

  constructor(private readonly options: Options) {
    this.runtime = createPanelRuntime(options.panel);
    this.input.type = "file";
    this.input.accept = ".mimiproject,.zip,application/zip";
    this.input.hidden = true;
    this.input.dataset.editorPortableInput = "";
    this.dialog.className = "editor-portable-dialog";
    this.dialog.setAttribute("aria-labelledby", "editor-portable-title");
    this.title.id = "editor-portable-title";
    this.dialog.style.cssText =
      "box-sizing:border-box;width:min(580px,calc(100vw - 24px));max-height:calc(100dvh - 32px);overflow:auto;background:var(--surface,#20232b);color:var(--text,#eee);border:1px solid #626875;border-radius:12px;padding:24px;font:14px/1.6 system-ui";
    this.title.style.cssText = "margin:0 0 12px;font-size:20px;overflow-wrap:anywhere";
    this.message.setAttribute("role", "status");
    this.message.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere";
    this.summary.dataset.portableSummary = "";
    this.summary.style.cssText = "overflow-wrap:anywhere;margin:16px 0";
    const actions = document.createElement("div");
    actions.style.cssText =
      "display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:20px";
    for (const button of [this.primary, this.cancel, this.close]) {
      button.type = "button";
      button.style.cssText =
        "max-width:100%;border:1px solid #747c8c;border-radius:6px;background:#303642;color:inherit;padding:8px 12px;font:inherit;white-space:normal;cursor:pointer";
    }
    this.primary.style.background = "#235dc5";
    this.primary.dataset.portablePrimary = "";
    this.cancel.textContent = "取消";
    this.close.textContent = "关闭";
    actions.append(this.primary, this.cancel, this.close);
    this.dialog.append(this.title, this.message, this.summary, actions);
    (options.container ?? document.body).append(this.input, this.dialog);
    this.input.addEventListener("change", () => {
      const file = this.input.files?.[0];
      this.input.value = "";
      if (file) this.launch(() => this.beginImport(file));
    });
    this.primary.addEventListener("click", () => this.launch(() => this.primaryAction()));
    this.cancel.addEventListener("click", () => this.cancelAction());
    this.close.addEventListener("click", () => this.closeDialog());
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.closeDialog();
    });
    this.render();
  }
  private show(): void {
    if (!this.disposed && !this.dialog.open) this.dialog.showModal();
  }
  private render(): void {
    const p = this.pending;
    this.title.textContent = p?.mode === "export" ? "打包工程" : "导入工程包";
    this.primary.hidden = this.busy || !p;
    this.primary.disabled = this.busy;
    this.cancel.hidden = !p || p.applied === true || p.saved === true;
    this.cancel.disabled = this.uninterruptible;
    this.close.disabled = this.uninterruptible;
    this.close.hidden = this.busy && !this.uninterruptible;
    if (p?.applied) this.primary.textContent = "重试清理临时文件";
    else if (p?.discardRequested) this.primary.textContent = "重试放弃并清理";
    else if (p?.mode === "export") this.primary.textContent = p.bundle ? "保存工程包" : "重试打包";
    else
      this.primary.textContent = p?.candidate
        ? p.applyAttempted
          ? "重试打开工程"
          : "打开这份工程"
        : "继续导入";
    this.cancel.textContent = this.busy
      ? "取消此次操作"
      : p?.mode === "import"
        ? "放弃此次导入"
        : "取消";
  }
  private launch(action: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.active) {
      this.show();
      return this.active;
    }
    this.cancelRequested = false;
    this.publicStatus = undefined;
    const result = { status: "running" as "running" | "completed" | "cancelled" | "failed" };
    this.activeResult = result;
    const pending = Promise.resolve()
      .then(() => {
        if (this.cancelRequested) throw runtimeCancelled();
        return action();
      })
      .catch((error) => {
        result.status =
          this.cancelRequested ||
          this.controller?.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
            ? "cancelled"
            : "failed";
        this.failure(error);
      })
      .finally(() => {
        if (result.status === "running") result.status = "completed";
        if (this.active === pending) this.active = undefined;
        this.busy = false;
        this.uninterruptible = false;
        this.controller = undefined;
        if (!this.disposed) this.render();
      });
    this.active = pending;
    return pending;
  }
  private failure(error: unknown): void {
    if (this.disposed) return;
    const cancelled =
      this.cancelRequested ||
      this.controller?.signal.aborted ||
      (error instanceof Error && error.name === "AbortError");
    this.message.textContent = cancelled
      ? "操作已取消。已完成的准备会保留，可以继续。"
      : `${this.pending?.applied ? "工程已经打开，临时文件清理未完成" : "操作未完成"}：${error instanceof Error ? error.message : String(error)}`;
    // Native error details can contain private task paths. Keep those in the local
    // UI, while the public receipt reports the outcome and recoverable state.
    this.publicStatus = cancelled
      ? "操作已取消，已完成的准备可继续。"
      : this.pending?.applied
        ? "工程已经打开，临时文件清理未完成，可以重试清理。"
        : "操作未完成；请在工程包面板查看详情，原工程和已完成的准备仍保留。";
    if (!cancelled) this.options.onError(error);
    this.show();
  }
  private async guard(p: Pending, allowRevision = false): Promise<void> {
    const check = () => {
      if (this.disposed || this.cancelRequested || this.controller?.signal.aborted)
        throw runtimeCancelled();
      if (
        this.options.session() !== p.session ||
        !sameIdentity(this.options.session().getState().identity, p.identity, !allowRevision)
      )
        throw new Error("当前工程已变化。此次操作不会替换它，请放弃此次导入，再重新选择工程包。");
    };
    check();
    const cwd = (await this.options.panel.getContext()).cwd;
    check();
    if (cwd !== p.cwd) throw new Error("工作区已切换，此次操作已停止。");
  }
  private async start(
    mode: Pending["mode"],
    source: Pick<Pending, "file" | "requestedResourceId"> = {},
  ): Promise<Pending> {
    this.options.assertEditable();
    const session = this.options.session(),
      identity = structuredClone(session.getState().identity);
    const frozenDocument = mode === "export" ? session.read() : undefined;
    const p: Pending = {
      id: crypto.randomUUID(),
      mode,
      session,
      identity,
      cwd: "",
      ...source,
      ...(frozenDocument ? { document: frozenDocument } : {}),
    };
    this.pending = p;
    this.summary.replaceChildren();
    this.message.textContent = "正在准备…";
    this.show();
    this.beginBusy();
    const cwd = (await this.options.panel.getContext()).cwd;
    if (typeof cwd !== "string" || !cwd) throw new Error("请先打开一个工程");
    p.cwd = cwd;
    await this.guard(p, mode === "export");
    return p;
  }
  getState() {
    const p = this.pending,
      last = [...this.commands.values()].at(-1);
    return {
      busy: this.busy || !!this.active,
      uninterruptible: this.uninterruptible,
      message: (this.publicStatus ?? this.message.textContent ?? "").slice(0, 2000),
      operation: last ? { operationId: last.operationId, status: last.status } : null,
      pending: p
        ? {
            pendingId: p.id,
            mode: p.mode,
            identity: structuredClone(p.identity),
            name: (p.candidate ?? p.document)?.name.slice(0, 200) ?? null,
            sequenceCount: (p.candidate ?? p.document)?.sequences.length ?? 0,
            assetCount: (p.candidate ?? p.document)?.assets.length ?? 0,
            ready: !!(p.candidate || p.bundle),
            applied: p.applied === true,
            saved: p.saved === true,
            bundle: p.bundle
              ? {
                  id: p.bundle.id,
                  bytes: p.bundle.bytes,
                  sha256: p.bundle.sha256,
                  mimeType: p.bundle.mimeType,
                  ...(p.bundle.name
                    ? { name: p.bundle.name.split(/[\\/]/).at(-1)!.slice(0, 200) }
                    : {}),
                }
              : null,
          }
        : null,
    };
  }
  readCandidate(pendingId: string): EditorDocument {
    if (this.disposed || !this.pending || this.pending.id !== pendingId || !this.pending.candidate)
      throw new Error("待审核工程已变化，请重新读取工程包状态");
    return structuredClone(this.pending.candidate);
  }
  /** The same UI state machine, with bounded receipts for background agent calls. */
  execute(request: EditorPortableRequest, expected: SessionIdentity) {
    if (this.disposed) throw new Error("工程包面板已关闭");
    const session = this.options.session();
    if (!sameIdentity(session.getState().identity, expected))
      throw new Error("工程身份或版本已变化");
    if (!request || typeof request !== "object" || Array.isArray(request))
      throw new Error("工程包请求无效");
    const keys =
      request.action === "import"
        ? ["action", "requestId", "resourceId"]
        : request.action === "export"
          ? ["action", "requestId"]
          : ["action", "requestId", "pendingId"];
    if (
      !request ||
      !["export", "import", "continue", "apply", "save", "cancel"].includes(request.action) ||
      Object.keys(request).some((key) => !keys.includes(key)) ||
      typeof request.requestId !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(request.requestId)
    )
      throw new Error("工程包请求无效");
    request = structuredClone(request);
    expected = structuredClone(expected);
    const fingerprint = JSON.stringify([
        request.action,
        request.action === "import" ? request.resourceId : null,
        "pendingId" in request ? request.pendingId : null,
        expected.documentId,
        expected.generation,
        expected.revision,
      ]),
      existing = this.commands.get(request.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("请求编号已被另一工程包操作使用");
      return { accepted: true, operationId: existing.operationId };
    }
    if (this.commands.size >= 256) throw new Error("本次会话工程包请求已达上限，请重新打开面板");
    this.options.assertEditable();
    const p = this.pending;
    if (request.action === "export" || request.action === "import") {
      if (this.active || p) throw new Error("请先完成或放弃当前工程包操作");
      if (request.action === "import" && !isResourceId(request.resourceId))
        throw new Error("工程包资源编号无效");
    } else {
      if (!p || request.pendingId !== p.id) throw new Error("待处理工程包已变化，请重新读取状态");
      if (this.active && request.action !== "cancel") throw new Error("工程包操作仍在进行");
      if (request.action === "cancel" && this.uninterruptible)
        throw new Error("正在保存工程或文件，此步骤不能取消");
      if (
        request.action === "apply" &&
        (p.mode !== "import" || !p.candidate || p.applied || p.discardRequested)
      )
        throw new Error("当前工程包尚不可应用");
      if (request.action === "save" && (p.mode !== "export" || !p.bundle))
        throw new Error("当前工程包尚不可保存");
      // Continue resumes preparation or cleanup; adoption always requires explicit apply.
      if (request.action === "continue" && p.candidate && !p.applied && !p.discardRequested)
        throw new Error("请先审核候选工程，再明确应用");
    }
    const command = { fingerprint, operationId: request.requestId, status: "running" };
    this.commands.set(request.requestId, command);
    if (request.action === "cancel") {
      this.cancelAction();
      const result = this.activeResult;
      command.status = this.active ? "cancelling" : "completed";
      void this.active?.finally(() => {
        command.status = result?.status === "failed" ? "failed" : "completed";
      });
    } else {
      const work = this.launch(async () => {
        if (
          this.options.session() !== session ||
          !sameIdentity(session.getState().identity, expected)
        )
          throw new Error("工程身份或版本已变化");
        if (request.action === "export") return this.exportPending(await this.start("export"));
        if (request.action === "import") {
          const imported = await this.start("import", { requestedResourceId: request.resourceId });
          return this.importPending(imported);
        }
        if (this.pending !== p) throw new Error("待处理工程包已变化");
        if (request.action === "apply") return this.apply(p!);
        if (request.action === "save") {
          await this.guard(p!, true);
          return this.saveBundle(p!);
        }
        return this.primaryAction();
      });
      const outcome = this.activeResult;
      void work.then(() => {
        command.status = outcome?.status ?? "failed";
      });
    }
    return { accepted: true, operationId: command.operationId };
  }
  chooseImport(): void {
    if (this.disposed) return;
    if (this.active || this.pending) {
      this.show();
      return;
    }
    try {
      this.options.assertEditable();
      this.input.click();
    } catch (error) {
      this.failure(error);
    }
  }
  exportCurrent(): Promise<void> {
    if (this.pending || this.active) {
      this.show();
      return this.active ?? Promise.resolve();
    }
    return this.launch(async () => {
      const p = await this.start("export");
      await this.exportPending(p);
    });
  }
  private async beginImport(file: File): Promise<void> {
    if (this.pending) {
      this.show();
      return;
    }
    const p = await this.start("import", { file });
    await this.importPending(p);
  }
  private beginBusy(): AbortController {
    if (this.cancelRequested || this.disposed) throw runtimeCancelled();
    const controller = new AbortController();
    this.controller = controller;
    this.busy = true;
    this.render();
    return controller;
  }
  private async importPending(p: Pending): Promise<void> {
    const controller = this.beginBusy();
    await this.guard(p);
    if (!p.resource && p.requestedResourceId) {
      await this.runtime.requireMethods(["resources.get"]);
      const response: any = await this.runtime.call("resources.get", {
        assetId: p.requestedResourceId,
      });
      await this.guard(p);
      const asset = response?.asset;
      if (
        asset?.id !== p.requestedResourceId ||
        !Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 1 ||
        asset.bytes > 20 * 1024 ** 3
      )
        throw new Error("工程包资源不存在、为空或超过 20GiB");
      p.resource = {
        id: asset.id,
        bytes: asset.bytes,
        sha256: asset.sha256 ?? asset.id.slice(6),
        mimeType: "application/zip",
      };
    }
    if (!p.resource) {
      if (!p.file) throw new Error("请选择工程包文件");
      this.message.textContent = "正在保存工程包原文件…";
      p.resource = await uploadEditorResource(this.runtime, p.file, {
        signal: controller.signal,
        mimeType: "application/zip",
        guard: () => this.guard(p),
        onProgress: (fraction) => {
          if (
            !this.disposed &&
            this.pending === p &&
            this.controller === controller &&
            !controller.signal.aborted
          )
            this.message.textContent = `保存工程包 ${Math.round(fraction * 100)}%`;
        },
      });
      p.file = undefined;
    }
    await this.guard(p);
    this.message.textContent = "正在检查工程和素材…";
    const result = await this.options.tasks.importProjectBundle(p.resource.id, {
      signal: controller.signal,
      ...(p.receipt ? { receipt: p.receipt } : {}),
      onImportReceipt: (receipt) => {
        p.receipt = structuredClone(receipt);
      },
      onProgress: (progress) => {
        if (
          !this.disposed &&
          this.pending === p &&
          this.controller === controller &&
          !controller.signal.aborted
        )
          this.message.textContent = `准备素材 ${progress.completed}/${progress.total}`;
      },
    });
    p.receipt = structuredClone(result.receipt);
    p.candidate = validateEditorDocument(result.document);
    this.review(p);
    await this.guard(p);
    this.message.textContent =
      "工程和素材已准备好。打开后切换到这份工程，当前工程会先保存并保留历史版本。";
  }
  private review(p: Pending): void {
    const doc = p.candidate ?? p.document;
    if (!doc) return;
    const heading = document.createElement("strong");
    heading.textContent = doc.name;
    const info = document.createElement("p");
    info.textContent = `${doc.sequences.length} 个序列 · ${doc.assets.length} 个素材${p.resource ? ` · 工程包 ${sizeLabel(p.resource.bytes)}` : ""}。工程包不包含系统字体，换设备需安装同名字体；缺失字体可能使用替代显示。`;
    const list = document.createElement("ul");
    list.style.cssText = "max-height:180px;overflow:auto;padding-left:22px";
    for (const sequence of doc.sequences) {
      const item = document.createElement("li");
      item.textContent = sequence.name;
      list.append(item);
    }
    this.summary.replaceChildren(heading, info, list);
  }
  private async exportPending(p: Pending): Promise<void> {
    const controller = this.beginBusy();
    await this.guard(p, true);
    if (!p.bundle) {
      this.message.textContent = "正在保存当前工程…";
      await p.session.flush();
      await this.guard(p, true);
      this.message.textContent = "正在打包完整工程与原始素材…";
      const result = await this.options.tasks.exportProjectBundle(p.document!, {
        signal: controller.signal,
        ...(p.snapshot ? { snapshot: p.snapshot } : {}),
        onSnapshot: (snapshot) => {
          p.snapshot = structuredClone(snapshot);
        },
        onProgress: (progress) => {
          if (
            !this.disposed &&
            this.pending === p &&
            this.controller === controller &&
            !controller.signal.aborted
          )
            this.message.textContent =
              progress.phase === "resources"
                ? `准备原始素材 ${progress.completed}/${progress.total}`
                : "准备完整工程数据…";
        },
      });
      p.bundle = structuredClone(result.bundle);
      p.snapshot = structuredClone(result.snapshot);
    }
    await this.guard(p, true);
    this.review(p);
    await this.saveBundle(p);
  }
  private async saveBundle(p: Pending): Promise<void> {
    this.uninterruptible = true;
    this.busy = true;
    this.render();
    this.message.textContent = "工程包已准备好，请在保存窗口选择位置。";
    await this.runtime.requireMethods(["media.export"]);
    const result: any = await this.runtime.call("media.export", { assetId: p.bundle!.id });
    if (this.disposed) return;
    if (result?.cancelled === true)
      this.message.textContent = "已取消保存。工程包仍然可用，可以再次选择保存位置。";
    else if (result?.saved === true) {
      p.saved = true;
      this.message.textContent = `工程包已保存${typeof result.name === "string" ? `：${result.name.split(/[\\/]/).at(-1)!.slice(0, 200)}` : ""}。`;
      this.primary.hidden = true;
    } else throw new Error("没有收到保存完成回执，可以重试保存同一工程包");
  }
  private async apply(p: Pending): Promise<void> {
    this.beginBusy();
    await this.guard(p);
    this.options.assertEditable();
    this.uninterruptible = true;
    this.render();
    this.message.textContent = "正在保存并切换工程…";
    p.applyAttempted = true;
    await this.options.replace(structuredClone(p.candidate!), structuredClone(p.identity));
    p.applied = true;
    p.file = undefined;
    p.candidate = undefined;
    if (this.disposed) return;
    this.message.textContent = "工程已打开，正在清理临时文件…";
    await this.cleanup(p);
  }
  private async cleanup(p: Pending): Promise<void> {
    this.beginBusy();
    this.uninterruptible = true;
    this.render();
    if (p.receipt) await this.options.tasks.discardProjectImport(p.receipt);
    if (this.disposed) return;
    if (p.applied) {
      this.message.textContent = "工程已打开。";
      this.pending = undefined;
    } else {
      this.pending = undefined;
      this.dialog.close();
    }
  }
  private async primaryAction(): Promise<void> {
    const p = this.pending;
    if (!p) return;
    if (p.applied || p.discardRequested) return this.cleanup(p);
    if (p.mode === "export") return this.exportPending(p);
    if (p.candidate) return this.apply(p);
    return this.importPending(p);
  }
  private cancelAction(): void {
    if (this.uninterruptible) return;
    if (this.busy || this.active) {
      this.cancelRequested = true;
      this.controller?.abort();
      return;
    }
    const p = this.pending;
    if (!p) {
      this.dialog.close();
      return;
    }
    if (p.mode === "import") {
      p.discardRequested = true;
      this.launch(() => this.cleanup(p));
    } else {
      this.pending = undefined;
      this.dialog.close();
    }
  }
  private closeDialog(): void {
    if (this.uninterruptible) return;
    if (this.busy || this.active) {
      this.cancelRequested = true;
      this.controller?.abort();
      return;
    }
    if (this.pending?.mode === "export" && this.pending.saved) this.pending = undefined;
    this.dialog.close();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller?.abort();
    this.dialog.close();
    this.dialog.remove();
    this.input.remove();
    // A late upload.begin may still return a ticket that must be cancelled using this runtime.
    if (this.active) void this.active.finally(() => this.runtime.dispose());
    else this.runtime.dispose();
  }
}
