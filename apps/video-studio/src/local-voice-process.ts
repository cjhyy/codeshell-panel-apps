import type { PanelBridge } from "./host";

export function cancelled(): Error {
  return Object.assign(new Error("本地声音任务已取消"), { name: "AbortError" });
}
export interface ProcessResult {
  stdout: string;
  code: number | null;
  signal?: string;
}
interface Pending {
  output: string;
  bytes: number;
  onOutput?: (text: string) => void;
  finish: (error?: Error, result?: ProcessResult) => void;
  stop: (error: Error) => void;
}

/** Subscribe before spawning: very short processes can finish before their handle arrives. */
export function createVoiceProcessClient(bridge: PanelBridge) {
  const pending = new Map<string, Pending>();
  const early = new Map<string, { event: string; data: any }[]>();
  let spawning = 0,
    closed = false;
  const starts: number[] = [];
  let admission = Promise.resolve();
  async function reserve(signal: AbortSignal) {
    const turn = admission
      .catch(() => {})
      .then(async () => {
        for (;;) {
          if (closed || signal.aborted) throw cancelled();
          const now = Date.now();
          while (starts.length && starts[0]! <= now - 10000) starts.shift();
          // Leave most of the Host's ordinary request budget for UI and cancellation.
          if (starts.length < 12) {
            starts.push(now);
            return;
          }
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(250, starts[0]! + 10001 - now)),
          );
        }
      });
    admission = turn;
    await turn;
  }
  let environment: Promise<{ executableHandle: string; directoryHandle: string }> | undefined;
  const entries = new Map<string, Promise<string>>();
  const dispatch = (event: string, data: any) => {
    if (typeof data?.processId !== "string") return;
    const entry = pending.get(data.processId);
    if (!entry) {
      if (spawning && early.size < 16) {
        const events = early.get(data.processId) ?? [];
        if (events.length < 128 || event === "process.exit") events.push({ event, data });
        early.set(data.processId, events);
      }
      return;
    }
    if (event === "process.exit") {
      entry.finish(undefined, { stdout: entry.output, code: data.code, signal: data.signal });
    } else if (typeof data.text === "string") {
      entry.bytes += data.text.length;
      if (entry.bytes > 1024 * 1024) {
        entry.stop(new Error("本地声音工具返回内容超出限制"));
      } else if (data.stream === "stdout") {
        entry.output += data.text;
        try {
          entry.onOutput?.(data.text);
        } catch (error) {
          entry.stop(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
  };
  const unsubscribes = ["process.output", "process.exit"].map((event) =>
    bridge.on(event, (data) => dispatch(event, data)),
  );
  async function prepare() {
    environment ??= (async () => {
      let executable: any;
      for (const name of ["node", "nodejs"]) {
        executable = await bridge.call("process.find", { name });
        if (executable?.available && executable.handle) break;
      }
      if (!executable?.available || !executable.handle)
        throw new Error("本地声音工具需要 Node.js 20 或更高版本，请安装后重新检查");
      const directory = (await bridge.call("filesystem.getKnownDirectory", {
        name: "app-data",
      })) as any;
      if (typeof directory?.handle !== "string") throw new Error("面板本地数据目录不可用");
      return { executableHandle: executable.handle, directoryHandle: directory.handle };
    })().catch((error) => {
      environment = undefined;
      throw error;
    });
    return environment;
  }
  async function runProcess(
    args: string[],
    signal: AbortSignal,
    onOutput?: (text: string) => void,
    entryName?: string,
  ): Promise<ProcessResult> {
    if (closed || signal.aborted) throw cancelled();
    const handles = await prepare();
    if (closed || signal.aborted) throw cancelled();
    let entryHandle: string | undefined;
    if (entryName) {
      let entry = entries.get(entryName);
      if (!entry) {
        entry = bridge
          .call("process.resolveEntry", {
            name: entryName,
            executableHandle: handles.executableHandle,
          })
          .then((value: any) => {
            if (typeof value?.handle !== "string" || !value.handle || value.name !== entryName)
              throw new Error("声音库工具尚未获得有效授权，请重新打开面板后再试");
            return value.handle as string;
          })
          .catch((error) => {
            entries.delete(entryName);
            throw error;
          });
        entries.set(entryName, entry);
      }
      entryHandle = await entry;
      if (closed || signal.aborted) throw cancelled();
    }
    await reserve(signal);
    return new Promise((resolve, reject) => {
      let id = "",
        settled = false,
        abortRequested = false,
        stopping = false;
      let failure: Error | undefined;
      const stop = async () => {
        if (!id || stopping || settled) return;
        stopping = true;
        while (!settled && !closed) {
          try {
            await bridge.call("process.cancel", { processId: id });
            return;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      };
      const abort = () => {
        abortRequested = true;
        // Wait for exit before callers delete job files or admit a retry.
        void stop();
      };
      const timer = setTimeout(
        () => {
          failure = new Error("本地声音任务超时，请重试");
          void stop();
        },
        90 * 60 * 1000,
      );
      const finish = (error?: Error, result?: ProcessResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (id) pending.delete(id);
        if (error) reject(error);
        else if (failure) reject(failure);
        else if (abortRequested) reject(cancelled());
        else resolve(result!);
      };
      const entry: Pending = {
        output: "",
        bytes: 0,
        finish,
        onOutput,
        stop(error) {
          failure = error;
          void stop();
        },
      };
      signal.addEventListener("abort", abort, { once: true });
      spawning++;
      void bridge
        .call("process.spawn", {
          ...handles,
          ...(entryHandle ? { entryHandle } : {}),
          args,
        })
        .then((value: any) => {
          id = value?.processId;
          if (typeof id !== "string" || !id) throw new Error("本地声音进程没有返回有效编号");
          if (settled || closed) {
            void bridge.call("process.cancel", { processId: id }).catch(() => {});
            finish(cancelled());
          } else {
            pending.set(id, entry);
            for (const event of early.get(id) ?? []) dispatch(event.event, event.data);
            if (signal.aborted) abort();
          }
          early.delete(id);
        })
        .catch((error) => finish(error instanceof Error ? error : new Error(String(error))))
        .finally(() => {
          spawning--;
          if (!spawning) early.clear();
        });
    });
  }
  return {
    run(code: string, args: string[], signal: AbortSignal, onOutput?: (text: string) => void) {
      return runProcess(["--input-type=module", "--eval", code, ...args], signal, onOutput);
    },
    runEntry(name: string, args: string[], signal: AbortSignal, onOutput?: (text: string) => void) {
      return runProcess(args, signal, onOutput, name);
    },
    dispose() {
      closed = true;
      for (const [id, entry] of pending) {
        void bridge.call("process.cancel", { processId: id }).catch(() => {});
        entry.finish(cancelled());
      }
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      early.clear();
    },
  };
}
