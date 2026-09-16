import type { RuntimeBridge } from "../sdk/panel-runtime";
import { createEditorMediaImporter, type EditorImportResult } from "./import-media";
import type { EditorSession } from "./session";
import type { EditorOperation } from "./operations";

/** Native metadata import with a retained publish proposal when project persistence fails. */
export class EditorImportUI {
  private readonly input = document.createElement("input");
  private readonly root = document.createElement("section");
  private readonly message = document.createElement("p");
  private readonly details = document.createElement("ul");
  private readonly cancel = document.createElement("button");
  private readonly retry = document.createElement("button");
  private readonly importer;
  private pending?: EditorImportResult;
  private controller?: AbortController;
  private disposed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly session: EditorSession,
    panel: RuntimeBridge,
    container: HTMLElement,
  ) {
    this.input.type = "file";
    this.input.multiple = true;
    this.input.accept = "video/*,audio/*,image/*,.mkv,.mov,.mxf,.mts,.m2ts,.avi,.flac,.aiff,.wav";
    this.input.hidden = true;
    this.input.dataset.editorMediaInput = "";
    this.root.className = "editor-import-status";
    this.root.setAttribute("aria-label", "导入进度");
    this.root.hidden = true;
    this.message.setAttribute("role", "status");
    for (const button of [this.cancel, this.retry]) button.type = "button";
    this.cancel.textContent = "取消此次导入";
    this.retry.textContent = "重试加入工程";
    this.retry.hidden = true;
    this.root.append(this.message, this.details, this.cancel, this.retry);
    container.append(this.input, this.root);
    this.importer = createEditorMediaImporter(panel, {
      getIdentity: () => (this.disposed ? null : session.getState().identity),
      onProgress: (progress) => {
        if (this.disposed) return;
        this.message.textContent = `${progress.index + 1}/${progress.total} · ${progress.name} · ${progress.phase === "upload" ? `保存原文件 ${Math.round((progress.fraction ?? 0) * 100)}%` : "检测画面与声音"}`;
      },
    });
    this.input.addEventListener("change", () => {
      const files = [...(this.input.files ?? [])];
      this.input.value = "";
      if (files.length) void this.import(files);
    });
    this.cancel.addEventListener("click", () => {
      this.controller?.abort();
      if (!this.controller) {
        this.pending = undefined;
        this.root.hidden = true;
      }
    });
    this.retry.addEventListener("click", () => {
      void this.publish();
    });
    this.unsubscribe = session.subscribe((state) => {
      if (
        this.pending &&
        (this.pending.identity.documentId !== state.identity.documentId ||
          this.pending.identity.generation !== state.identity.generation)
      ) {
        this.pending = undefined;
        this.root.hidden = true;
      }
    });
  }
  choose(): void {
    if (this.disposed) return;
    if (this.controller || this.pending) {
      this.root.scrollIntoView({ block: "nearest" });
      return;
    }
    this.input.click();
  }
  private async import(files: File[]): Promise<void> {
    if (this.controller || this.pending || this.disposed) return;
    const controller = new AbortController();
    this.controller = controller;
    this.root.hidden = false;
    this.cancel.hidden = false;
    this.retry.hidden = true;
    this.details.replaceChildren();
    try {
      this.pending = await this.importer.importFiles(files, { signal: controller.signal });
      if (!controller.signal.aborted && !this.disposed) {
        this.details.replaceChildren(
          ...this.pending.errors.map((error) => {
            const item = document.createElement("li");
            item.textContent = `${error.name}：${error.message}`;
            return item;
          }),
        );
      }
    } catch (error) {
      this.pending = undefined;
      if (!this.disposed)
        this.message.textContent =
          controller.signal.aborted || (error instanceof Error && error.name === "AbortError")
            ? "此次导入已取消"
            : `导入失败：${String(error)}`;
    } finally {
      if (this.controller === controller) this.controller = undefined;
      this.cancel.hidden = true;
    }
    if (this.pending && !this.disposed) await this.publish();
  }
  private async publish(): Promise<void> {
    const pending = this.pending;
    if (!pending || this.controller || this.disposed) return;
    const controller = new AbortController();
    this.controller = controller;
    this.retry.disabled = true;
    this.cancel.hidden = false;
    try {
      const identity = this.session.getState().identity;
      if (
        identity.documentId !== pending.identity.documentId ||
        identity.generation !== pending.identity.generation
      )
        throw new Error("工程已切换，请重新导入素材");
      const existing = new Set(this.session.read().assets.map((asset) => asset.resourceId));
      const operations: EditorOperation[] = [];
      for (const asset of pending.assets) {
        if (asset.resourceId && existing.has(asset.resourceId)) continue;
        operations.push({ type: "asset.add", asset });
        existing.add(asset.resourceId);
      }
      await this.session.dispatchDurable(
        operations,
        identity,
        "导入原始素材",
        "user",
        controller.signal,
      );
      if (this.disposed) return;
      this.message.textContent = `已导入 ${operations.length} 个素材${pending.errors.length ? `，${pending.errors.length} 个文件未导入，详情如下` : ""}。`;
      this.pending = undefined;
      this.retry.hidden = true;
    } catch (error) {
      if (!this.disposed) {
        this.message.textContent = `素材尚未加入工程：${String(error)}`;
        this.retry.hidden = false;
      }
    } finally {
      if (this.controller === controller) this.controller = undefined;
      this.retry.disabled = false;
      this.cancel.hidden = !this.pending;
    }
  }
  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
    this.importer.dispose();
    this.unsubscribe();
    this.root.remove();
    this.input.remove();
  }
}
