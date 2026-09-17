/** Domain-neutral helpers for reviewed package tasks, capability discovery and bounded IPC. */
export type BridgeResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; retryAfterMs?: number } };
export interface RuntimeBridge {
  getContext(): Promise<any>;
  call(method: string, params?: unknown): Promise<unknown>;
  callResult?(method: string, params?: unknown): Promise<BridgeResult>;
  on(event: string, listener: (value: any) => void): () => void;
}
export interface RuntimeJob {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempt: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  progress?: { fraction?: number; stage?: string; message?: string };
  result?: any;
  error?: { code: string; message: string; retryable: boolean };
  [key: string]: unknown;
}
export function panelRuntimeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message === "Installed tool task version or permissions changed"
    ? "面板版本或权限已更新，当前页面已过期。请确认工程已保存后，关闭并重新打开视频工作台，再重试。"
    : message;
}
export function taskValue(value: any): RuntimeJob {
  let job = value?.job ?? value?.task ?? value;
  if (job?.status === "interrupted")
    job = {
      ...job,
      status: "failed",
      error: {
        ...job.error,
        code: job.error?.code || "INTERRUPTED",
        message:
          job.error?.message ||
          (job.recovery === "retry"
            ? "上次运行已中断，可以重试"
            : "上次运行已中断，请检查结果后重新创建任务"),
        retryable:
          job.error?.retryable === true ||
          (job.error?.retryable === undefined && job.recovery === "retry"),
      },
    };
  if (job?.status === "cancelling")
    job = {
      ...job,
      status: "running",
      progress: { ...job.progress, message: "正在停止任务并清理产物" },
    };
  if (
    !job ||
    typeof job.id !== "string" ||
    !["queued", "running", "succeeded", "failed", "cancelled"].includes(job.status)
  )
    throw new Error("本地任务返回无效状态");
  return job;
}
export function runtimeCancelled(): Error {
  return Object.assign(new Error("操作已取消"), { name: "AbortError" });
}
function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(runtimeCancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
export function createPanelRuntime(bridge: RuntimeBridge) {
  let context: any,
    loading: Promise<any> | undefined,
    disposed = false;
  const ordinary: number[] = [],
    transfer: number[] = [];
  let ordinaryAdmission = Promise.resolve(),
    transferAdmission = Promise.resolve();
  async function discover(refresh = false) {
    if (disposed) throw runtimeCancelled();
    if (refresh) context = undefined;
    if (context) return context;
    loading ??= bridge
      .getContext()
      .then((value) => {
        context = value;
        return value;
      })
      .finally(() => {
        loading = undefined;
      });
    return loading;
  }
  async function requireMethods(methods: string[]) {
    const current = await discover();
    if (
      !Array.isArray(current.availableMethods) ||
      methods.some((method) => !current.availableMethods.includes(method))
    )
      throw new Error(
        "当前 CodeShell 缺少通用本地任务或资源接口，请更新主程序后重新打开面板；媒体引擎由视频面板管理",
      );
    return current;
  }
  async function invoke(method: string, params?: unknown) {
    try {
      if (!bridge.callResult) return await bridge.call(method, params);
      const result = await bridge.callResult(method, params);
      if (result.ok) return result.value;
      throw Object.assign(new Error(result.error.message), {
        name: "PanelBridgeError",
        code: result.error.code,
        ...(Number.isFinite(result.error.retryAfterMs)
          ? { retryAfterMs: result.error.retryAfterMs }
          : {}),
      });
    } catch (error) {
      const message = panelRuntimeErrorMessage(error);
      if (error instanceof Error && message !== error.message)
        throw Object.assign(new Error(message, { cause: error }), error, {
          name: error.name,
          message,
        });
      throw error;
    }
  }
  async function call(method: string, params?: unknown, signal?: AbortSignal) {
    const current = await discover(),
      limits = current.capabilities?.bridge ?? current.capabilities?.limits ?? {};
    if (disposed || signal?.aborted) throw runtimeCancelled();
    if (method === "tasks.cancel" || method === "process.cancel") return invoke(method, params);
    const bytes = new TextEncoder().encode(JSON.stringify(params ?? {})).length;
    // Some capability methods have larger method-specific envelopes. The Host
    // remains authoritative when it has not advertised their exact limit.
    const maximum =
      method === "tasks.start"
        ? current.capabilities?.tasks?.maxInputBytes
        : ["media.document.set", "storage.set", "workspace.writeText"].includes(method)
          ? undefined
          : limits.maxParamsBytes;
    if (Number.isFinite(maximum) && bytes > maximum)
      throw Object.assign(new Error("请求超过主程序允许的大小，请分批处理"), {
        code: "PARAMS_TOO_LARGE",
      });
    const isTransfer = [
      "resources.read",
      "resources.upload.write",
      "media.recording.write",
      "media.assets.read",
      "process.get",
      "process.write",
    ].includes(method);
    const starts = isTransfer ? transfer : ordinary;
    const windowMs = Math.max(1000, Number(limits.rateWindowMs) || 10000);
    const capacity = Math.max(
      1,
      Math.floor(
        (Number(isTransfer ? limits.maxTransferCallsPerWindow : limits.maxCallsPerWindow) ||
          (isTransfer ? 512 : 30)) * 0.7,
      ),
    );
    const reserve = (isTransfer ? transferAdmission : ordinaryAdmission)
      .catch(() => {})
      .then(async () => {
        for (;;) {
          if (disposed || signal?.aborted) throw runtimeCancelled();
          const now = Date.now();
          while (starts.length && starts[0]! <= now - windowMs) starts.shift();
          if (starts.length < capacity) {
            starts.push(now);
            return;
          }
          await pause(Math.min(250, starts[0]! + windowMs - now + 1), signal);
        }
      });
    if (isTransfer) transferAdmission = reserve;
    else ordinaryAdmission = reserve;
    await reserve;
    if (disposed || signal?.aborted) throw runtimeCancelled();
    return invoke(method, params);
  }
  async function wait(
    id: string,
    options: { signal?: AbortSignal; timeoutMs?: number; changed?(job: RuntimeJob): void } = {},
  ) {
    const deadline = Date.now() + (options.timeoutMs ?? 2 * 60 * 60_000);
    let wake: (() => void) | undefined;
    const unsubscribe = bridge.on("tasks.changed", (value) => {
      if ((value?.job ?? value)?.id === id) wake?.();
    });
    try {
      for (;;) {
        if (disposed || options.signal?.aborted) throw runtimeCancelled();
        const job = taskValue(await call("tasks.get", { id }, options.signal));
        options.changed?.(job);
        if (!["queued", "running"].includes(job.status)) return job;
        if (Date.now() >= deadline) throw new Error("任务仍在处理，可稍后在任务列表查看");
        await Promise.race([
          pause(1500, options.signal),
          new Promise<void>((resolve) => {
            wake = resolve;
          }),
        ]);
        wake = undefined;
      }
    } finally {
      unsubscribe();
    }
  }
  return {
    call,
    discover,
    requireMethods,
    wait,
    async start(input: unknown) {
      await requireMethods(["tasks.start", "tasks.get", "resources.get"]);
      return taskValue(await call("tasks.start", input));
    },
    async cancel(id: string) {
      return taskValue(await call("tasks.cancel", { id }));
    },
    async retry(id: string) {
      return taskValue(await call("tasks.retry", { id }));
    },
    /** Cursor-based process output for tools that do not need durable task receipts. */
    async processOutput(processId: string, afterSeq = 0) {
      await requireMethods(["process.get"]);
      return call("process.get", { processId, afterSequence: afterSeq });
    },
    dispose() {
      disposed = true;
    },
  };
}
/** Shared, bounded decoder for standalone tool protocols; chunks need not end at newlines. */
export function createNdjsonDecoder(onValue: (value: unknown) => void, maxLineBytes = 1024 * 1024) {
  let pending = "";
  return {
    push(chunk: string) {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines) {
        if (new TextEncoder().encode(line).length > maxLineBytes)
          throw new Error("工具返回内容超过限制");
        if (line.trim()) onValue(JSON.parse(line));
      }
      if (new TextEncoder().encode(pending).length > maxLineBytes)
        throw new Error("工具返回内容超过限制");
    },
    finish() {
      if (pending.trim()) {
        const value = JSON.parse(pending);
        pending = "";
        onValue(value);
      }
    },
  };
}
