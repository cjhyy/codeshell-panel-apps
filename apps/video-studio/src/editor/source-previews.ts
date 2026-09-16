import type { EditorAsset } from "./types";
import type { EditorStageOptions, EditorTaskArtifact, EditorVideoSource } from "./task-bridge";

export interface SourceVideoPreview {
  resourceId: string;
  sourceHash: string;
  proxy: EditorTaskArtifact;
  recipe: EditorVideoSource["recipe"];
}
interface SourcePreviewTasks {
  prepareSourceVideo(
    resourceId: string,
    options: EditorStageOptions & { sourceDuration: number },
  ): Promise<SourceVideoPreview>;
}
interface Work {
  controller: AbortController;
  consumers: number;
  promise: Promise<SourceVideoPreview>;
}
const cancelled = () => new DOMException("取消素材预览准备", "AbortError");
/** The player and visible timeline strips share source proxies. One leaving consumer must
 * not cancel another; at most two native preparations run and completed entries stay bounded. */
export class EditorSourcePreviews {
  private readonly pending = new Map<string, Work>();
  private readonly cache = new Map<string, SourceVideoPreview>();
  private readonly queue: Array<() => void> = [];
  private running = 0;
  private disposed = false;
  constructor(private readonly tasks: SourcePreviewTasks) {}
  private async slot<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        cleanup();
        if (signal.aborted || this.disposed) {
          reject(cancelled());
          return;
        }
        this.running++;
        resolve();
      };
      const abort = () => {
        cleanup();
        const index = this.queue.indexOf(start);
        if (index >= 0) this.queue.splice(index, 1);
        reject(cancelled());
      };
      const cleanup = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted || this.disposed) abort();
      else if (this.running < 2) start();
      else this.queue.push(start);
    });
    try {
      return await work();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
  prepare(asset: EditorAsset, signal: AbortSignal): Promise<SourceVideoPreview> {
    if (this.disposed || signal.aborted) return Promise.reject(cancelled());
    if (asset.kind !== "video" || !asset.resourceId)
      return Promise.reject(new Error("视频源尚未连接"));
    const resourceId = asset.resourceId,
      sourceDuration = asset.duration;
    const key = JSON.stringify([resourceId, asset.fingerprint ?? "", sourceDuration]);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(structuredClone(cached));
    }
    let entry = this.pending.get(key);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const created: Work = { controller, consumers: 0, promise: undefined! };
      created.promise = this.slot(
        () =>
          this.tasks.prepareSourceVideo(resourceId, { sourceDuration, signal: controller.signal }),
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted && !this.disposed) {
            this.cache.set(key, structuredClone(result));
            while (this.cache.size > 96) this.cache.delete(this.cache.keys().next().value!);
          }
          return result;
        })
        .finally(() => {
          if (this.pending.get(key) === created) this.pending.delete(key);
        });
      this.pending.set(key, created);
      entry = created;
    }
    const current = entry;
    current.consumers++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        if (finished) return false;
        finished = true;
        signal.removeEventListener("abort", abort);
        current.consumers--;
        return true;
      };
      const abort = () => {
        if (!cleanup()) return;
        if (!current.consumers) current.controller.abort();
        reject(cancelled());
      };
      signal.addEventListener("abort", abort, { once: true });
      current.promise.then(
        (result) => {
          if (cleanup()) resolve(structuredClone(result));
        },
        (error) => {
          if (cleanup()) reject(error);
        },
      );
      if (signal.aborted) abort();
    });
  }
  dispose(): void {
    this.disposed = true;
    for (const entry of this.pending.values()) entry.controller.abort();
    this.pending.clear();
    this.cache.clear();
  }
}
