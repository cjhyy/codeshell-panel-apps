import type { PanelBridge } from "../host";
import { runtimeCancelled, type BridgeResult } from "./panel-runtime";

/** One admission budget at the actual Host boundary, shared by every Panel module.
 * Context checks remain fresh; only capability limits are retained. Domain bridges
 * can expand one logical operation into many calls, all of which pass this queue. */
export function createBridgeTraffic(
  raw: PanelBridge,
  timing: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    beforeDispatch?: () => void;
  } = {},
): { bridge: PanelBridge; dispose(): void } {
  const now = timing.now ?? Date.now;
  const sleep = timing.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  let limits: Record<string, number> = {},
    boot: Promise<unknown> | undefined,
    disposed = false;
  const ordinary: number[] = [],
    transfer: number[] = [];
  let ordinaryAdmission = Promise.resolve(),
    transferAdmission = Promise.resolve();
  const learn = (context: any) => {
    limits = context?.capabilities?.bridge ?? context?.capabilities?.limits ?? {};
    return context;
  };
  const check = () => {
    if (disposed) throw runtimeCancelled();
    timing.beforeDispatch?.();
  };
  async function initialize() {
    check();
    boot ??= raw.getContext().then((value) => {
      ordinary.push(now());
      return learn(value);
    });
    await boot;
    check();
  }
  async function reserve(method: string) {
    await initialize();
    const starts = [
      "resources.read",
      "resources.upload.write",
      "process.get",
      "process.write",
      "media.recording.write",
      "media.assets.read",
    ].includes(method)
      ? transfer
      : ordinary;
    const operation = (starts === transfer ? transferAdmission : ordinaryAdmission)
      .catch(() => {})
      .then(async () => {
        for (;;) {
          check();
          const windowMs = limits.rateWindowMs;
          const advertised =
            starts === transfer ? limits.maxTransferCallsPerWindow : limits.maxCallsPerWindow;
          // Old Hosts without an advertised window retain their existing behavior.
          if (
            !(
              windowMs > 0 &&
              Number.isFinite(windowMs) &&
              advertised > 0 &&
              Number.isFinite(advertised)
            )
          )
            return;
          const capacity = Math.max(1, Math.floor(advertised * 0.7));
          while (starts.length && starts[0]! <= now() - windowMs) starts.shift();
          if (starts.length < capacity) {
            starts.push(now());
            return;
          }
          await sleep(Math.min(250, Math.max(1, starts[0]! + windowMs - now() + 1)));
        }
      });
    if (starts === transfer) transferAdmission = operation;
    else ordinaryAdmission = operation;
    await operation;
    check();
  }
  async function send<T>(method: string, action: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (method === "tasks.cancel" || method === "process.cancel") {
        check();
        ordinary.push(now());
      } else await reserve(method);
      check();
      try {
        return await action();
      } catch (error) {
        const refusal = error as { code?: string; retryAfterMs?: number };
        // This structured Host refusal precedes dispatch. Never replay network,
        // storage, timeout or unknown errors that may follow an accepted mutation.
        if (
          attempt >= 2 ||
          refusal?.code !== "RATE_LIMITED" ||
          !Number.isFinite(refusal.retryAfterMs) ||
          refusal.retryAfterMs! < 1 ||
          refusal.retryAfterMs! > 60000
        )
          throw error;
        const end = now() + refusal.retryAfterMs!;
        while (now() < end) {
          check();
          await sleep(Math.min(250, end - now()));
        }
      }
    }
  }
  const call = (method: string, params?: unknown) => {
    const input = structuredClone(params);
    return send(method, async () => {
      if (!raw.callResult) return raw.call(method, input);
      const result = await raw.callResult(method, input);
      if (result.ok) return result.value;
      throw Object.assign(new Error(result.error.message), result.error, {
        name: "PanelBridgeError",
      });
    });
  };
  return {
    bridge: {
      getContext: () => send("context.get", async () => learn(await raw.getContext())),
      call,
      async callResult(method, params): Promise<BridgeResult> {
        try {
          return { ok: true, value: await call(method, params) };
        } catch (error) {
          if (error && typeof error === "object" && typeof (error as any).code === "string")
            return {
              ok: false,
              error: {
                code: (error as any).code,
                message: error instanceof Error ? error.message : String(error),
                ...(Number.isFinite((error as any).retryAfterMs)
                  ? { retryAfterMs: (error as any).retryAfterMs }
                  : {}),
              },
            };
          throw error;
        }
      },
      on: (event, handler) => raw.on(event, handler),
      registerTool: (name, handler) => raw.registerTool(name, handler),
    },
    dispose() {
      disposed = true;
    },
  };
}
