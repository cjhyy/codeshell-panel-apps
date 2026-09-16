import {
  createPanelRuntime,
  runtimeCancelled,
  taskValue,
  type RuntimeBridge,
  type RuntimeJob,
} from "../sdk/panel-runtime";
import { isResourceId } from "../external-media";
import {
  audioEnhancementReceipt,
  validateAudioEnhancementSettings,
  type AudioEnhancementSettings,
  type AudioEnhancementCapability,
} from "./audio-enhancement";
export interface AudioEnhancementTaskOptions {
  signal?: AbortSignal;
  onTask?(job: RuntimeJob): void;
  onChanged?(job: RuntimeJob): void;
}
export interface ExistingAudioEnhancementTask {
  id: string;
  status: RuntimeJob["status"];
  createdAt: number;
  retryable: boolean;
  message?: string;
}
/** Generic Host tasks retain progress/results across panel closure. No custom Host media methods. */
export function createAudioEnhancementBridge(raw: RuntimeBridge) {
  const sdk = createPanelRuntime(raw);
  let disposed = false;
  const workspaces = new Map<string, string>();
  const cwd = async () => {
    if (disposed) throw runtimeCancelled();
    const value = await raw.getContext();
    if (typeof value.cwd !== "string" || !value.cwd) throw new Error("请先绑定当前视频工程");
    return value.cwd as string;
  };
  const same = async (key: string) => {
    if ((await cwd()) !== key) throw new Error("工作区已变化，请重新打开优化工具");
  };
  async function stop(id: string) {
    const job = await sdk.cancel(id);
    return ["queued", "running"].includes(job.status) ? sdk.wait(id) : job;
  }
  async function wait(job: RuntimeJob, key: string, options: AudioEnhancementTaskOptions) {
    options.onTask?.(structuredClone(job));
    let cancelling: Promise<unknown> | undefined;
    const cancel = () => {
      cancelling ??= stop(job.id);
      void cancelling.catch(() => {});
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    try {
      const done = await sdk.wait(job.id, { signal: options.signal, changed: options.onChanged });
      await same(key);
      if (done.status !== "succeeded")
        throw Object.assign(new Error(done.error?.message ?? "优化任务未完成"), {
          taskId: done.id,
          retryable: done.error?.retryable,
        });
      return done.result?.result ?? done.result;
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      if (cancelling) await cancelling;
    }
  }
  async function run(request: Record<string, unknown>, options: AudioEnhancementTaskOptions = {}) {
    await sdk.requireMethods(["tasks.start", "tasks.get", "tasks.cancel", "resources.get"]);
    const key = await cwd();
    if (options.signal?.aborted) throw runtimeCancelled();
    const job = await sdk.start({
      entry: "media-runtime",
      recovery: "retry",
      input: {
        request,
        resources:
          request.action === "audio-enhance"
            ? [{ assetId: (request.params as any).assetId, path: "inputs/source.bin" }]
            : [],
        directoryArguments: [
          { argumentName: "--job-dir", directory: "job" },
          {
            argumentName: "--runtime-dir",
            directory: "app-data",
            path: "runtime/media",
          },
        ],
      },
    });
    workspaces.set(job.id, key);
    if (options.signal?.aborted) {
      await stop(job.id);
      throw runtimeCancelled();
    }
    try {
      await same(key);
    } catch (error) {
      await stop(job.id);
      throw error;
    }
    return wait(job, key, options);
  }
  return {
    async status(options?: AudioEnhancementTaskOptions): Promise<AudioEnhancementCapability> {
      const result = await run({ action: "status", params: {} }, options);
      if (typeof result?.ffmpeg?.available !== "boolean") throw new Error("声音处理器状态无效");
      return {
        state: result.ffmpeg.available ? "ready" : "unavailable",
        message: result.ffmpeg.available ? "本地声音优化已就绪" : "请先准备 FFmpeg 声音处理工具",
      };
    },
    async enhance(
      sourceResourceId: string,
      duration: number,
      settings: AudioEnhancementSettings,
      options?: AudioEnhancementTaskOptions,
    ) {
      if (
        !isResourceId(sourceResourceId) ||
        !Number.isSafeInteger(duration) ||
        duration < 1 ||
        duration > 86400 * 240000
      )
        throw new Error("请选择有效的原始音频");
      const selected = validateAudioEnhancementSettings(settings);
      const result = audioEnhancementReceipt(
        await run(
          {
            action: "audio-enhance",
            params: { assetId: sourceResourceId, ...selected },
            inputs: { [sourceResourceId]: "inputs/source.bin" },
          },
          options,
        ),
      );
      if (
        result.sourceResourceId !== sourceResourceId ||
        JSON.stringify(result.settings) !== JSON.stringify(selected)
      )
        throw new Error("声音优化结果与本次请求不匹配");
      return result;
    },
    async list(sourceResourceId: string, offset = 0) {
      if (!isResourceId(sourceResourceId) || !Number.isSafeInteger(offset) || offset < 0)
        throw new Error("优化任务分页无效");
      const key = await cwd();
      await sdk.requireMethods(["tasks.list", "tasks.get"]);
      const page = await sdk.call("tasks.list", { offset, limit: 50 });
      if (!Array.isArray(page) || page.length > 50) throw new Error("优化任务列表返回无效数据");
      const jobs: ExistingAudioEnhancementTask[] = [];
      for (const item of page) {
        if (item?.entry?.name !== "media-runtime" || typeof item.id !== "string") continue;
        const job = taskValue(await sdk.call("tasks.get", { id: item.id })),
          request = (job.input as any)?.request;
        if (request?.action !== "audio-enhance" || request.params?.assetId !== sourceResourceId)
          continue;
        jobs.push({
          id: job.id,
          status: job.status,
          createdAt: job.createdAt,
          retryable: job.error?.retryable === true,
          ...(job.error?.message ? { message: job.error.message } : {}),
        });
        workspaces.set(job.id, key);
      }
      await same(key);
      return { jobs, nextOffset: offset + page.length, complete: page.length < 50 };
    },
    async resume(
      id: string,
      options: AudioEnhancementTaskOptions & { retry?: boolean; sourceResourceId?: string } = {},
    ) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error("任务编号无效");
      const key = await cwd();
      const job = await sdk.call("tasks.get", { id });
      let current = taskValue(job);
      // Host scopes get to the active workspace; a foreign task cannot authorize editor application.
      if ((current.entry as { name?: string })?.name !== "media-runtime")
        throw new Error("这不是声音优化任务");
      const request = (current.input as any)?.request;
      if (
        request?.action !== "audio-enhance" ||
        !isResourceId(request.params?.assetId) ||
        (options.sourceResourceId && request.params?.assetId !== options.sourceResourceId)
      )
        throw new Error("这份任务不属于所选原始素材");
      await same(key);
      if (options.retry && ["failed", "cancelled"].includes(current.status)) {
        if (!current.error?.retryable) throw new Error("这个任务不能重试，请重新优化");
        if (options.signal?.aborted) throw runtimeCancelled();
        current = await sdk.retry(id);
      }
      workspaces.set(id, key);
      const result = audioEnhancementReceipt(await wait(current, key, options));
      if (result.sourceResourceId !== request.params.assetId)
        throw new Error("声音优化结果与原始任务不匹配");
      return result;
    },
    async cancel(id: string) {
      const key = workspaces.get(id);
      if (!key) throw new Error("请先打开这个优化任务");
      await same(key);
      return stop(id);
    },
    dispose() {
      disposed = true;
      sdk.dispose();
    },
  };
}
