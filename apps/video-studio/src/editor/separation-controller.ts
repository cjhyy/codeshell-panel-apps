import type { EditorSession, SessionIdentity } from "./session";
import type { EditorOperation } from "./operations";
import type { createAudioSeparationBridge } from "./separation-bridge";
import {
  separationSource,
  planApplySeparation,
  type SeparationCapability,
  type SeparationResult,
} from "./separation";
export interface SeparationControllerContext {
  session(): EditorSession;
  bridge: ReturnType<typeof createAudioSeparationBridge>;
  guard(): void;
  apply(operations: EditorOperation[], identity: SessionIdentity, label: string): Promise<unknown>;
  idFactory?: () => string;
}
export interface SeparationState {
  phase:
    | "idle"
    | "checking"
    | "installing"
    | "running"
    | "preview"
    | "applying"
    | "error"
    | "cancelled"
    | "stale";
  message: string;
  fraction?: number;
  taskId?: string;
  capability?: SeparationCapability;
  source?: { sequenceId: string; clipId: string; name: string };
  candidate?: {
    identity: SessionIdentity;
    sequenceId: string;
    clipId: string;
    result: SeparationResult;
  };
}
const identical = (a: SessionIdentity, b: SessionIdentity) =>
  a.documentId === b.documentId && a.generation === b.generation && a.revision === b.revision;
export function createSeparationController(context: SeparationControllerContext) {
  let state: SeparationState = { phase: "idle", message: "检查本地分离处理器" },
    abort: AbortController | undefined,
    disposed = false,
    unsubscribe: (() => void) | undefined;
  const listeners = new Set<(state: SeparationState) => void>();
  const notify = () => {
    if (!disposed) for (const listener of listeners) listener(structuredClone(state));
  };
  const update = (patch: Partial<SeparationState>) => {
    state = { ...state, ...patch };
    notify();
  };
  const busy = () => ["checking", "installing", "running", "applying"].includes(state.phase);
  const begin = (phase: SeparationState["phase"], message: string) => {
    if (disposed) throw new Error("分离工具已关闭");
    if (busy()) throw new Error("请等待或取消当前分离任务");
    unsubscribe?.();
    unsubscribe = undefined;
    abort = new AbortController();
    update({ phase, message, fraction: undefined, candidate: undefined, taskId: undefined });
    return abort;
  };
  const options = (controller: AbortController) => ({
    signal: controller.signal,
    onTask(job: { id: string }) {
      if (!disposed && abort === controller) update({ taskId: job.id });
    },
    onChanged(job: { progress?: { message?: string; fraction?: number } }) {
      if (!disposed && abort === controller && !controller.signal.aborted)
        update({
          message: job.progress?.message ?? state.message,
          fraction: job.progress?.fraction,
        });
    },
  });
  const failure = (error: unknown, controller: AbortController) => {
    if (disposed || abort !== controller) return;
    if (state.phase === "stale") return;
    update({
      phase: controller.signal.aborted ? "cancelled" : "error",
      message: controller.signal.aborted
        ? "已取消；原始素材保持完整"
        : error instanceof Error
          ? error.message
          : "人声分离未完成",
    });
  };
  function monitor(session: EditorSession, identity: SessionIdentity) {
    unsubscribe?.();
    unsubscribe = session.subscribe(() => {
      if (state.phase === "applying" || disposed) return;
      if (context.session() !== session || !identical(identity, session.getState().identity)) {
        abort?.abort();
        unsubscribe?.();
        unsubscribe = undefined;
        update({
          phase: "stale",
          candidate: undefined,
          message: "工程已更新，分离结果未应用；可从原任务重新打开结果",
        });
      }
    });
  }
  async function processing(sequenceId: string, clipId: string, jobId?: string, retry = false) {
    context.guard();
    const session = context.session(),
      identity = session.getState().identity,
      source = separationSource(session.read(), sequenceId, clipId),
      controller = begin("running", "正在分离人声与伴奏");
    update({ source: { sequenceId, clipId, name: source.asset.name } });
    monitor(session, identity);
    try {
      const result = jobId
        ? await context.bridge.resume(jobId, {
            ...options(controller),
            retry,
            sourceResourceId: source.resourceId,
          })
        : await context.bridge.separate(
            source.resourceId,
            source.asset.duration,
            options(controller),
          );
      if (disposed || controller.signal.aborted || abort !== controller) return;
      if (context.session() !== session || !identical(identity, session.getState().identity))
        throw new Error("工程已更新，请重新打开分离结果");
      if (result.sourceResourceId !== source.resourceId) throw new Error("分离结果不属于所选素材");
      update({
        phase: "preview",
        message: `「${source.asset.name}」分离完成。试听后选择要加入的音轨，原片会保留`,
        fraction: 1,
        candidate: { identity, sequenceId, clipId, result },
      });
    } catch (error) {
      failure(error, controller);
    }
  }
  async function maintenance(install: boolean) {
    if (install) context.guard();
    const controller = begin(
      install ? "installing" : "checking",
      install ? "正在准备本地分离模型与依赖" : "正在检查本地处理器",
    );
    try {
      const capability = await context.bridge[install ? "setup" : "status"](options(controller));
      if (!disposed && !controller.signal.aborted)
        update({ phase: "idle", capability, message: capability.message });
    } catch (error) {
      failure(error, controller);
    }
  }
  function background(work: () => Promise<void>): Promise<{ taskId: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const observe = (state: SeparationState) => {
        if (settled) return;
        if (state.taskId) {
          settled = true;
          listeners.delete(observe);
          resolve({ taskId: state.taskId });
        } else if (["error", "cancelled", "stale"].includes(state.phase)) {
          settled = true;
          listeners.delete(observe);
          reject(new Error(state.message));
        }
      };
      const previous = abort,
        pending = work();
      // Validation or a busy production guard may reject before a new request exists.
      // Never return a previous task's receipt for a rejected new action.
      if (abort !== previous) {
        listeners.add(observe);
        observe(state);
      }
      void pending.then(
        () => {
          if (!settled) {
            settled = true;
            listeners.delete(observe);
            reject(new Error(state.message || "处理器未返回任务编号"));
          }
        },
        (error) => {
          if (!settled) {
            settled = true;
            listeners.delete(observe);
            reject(error);
          }
        },
      );
    });
  }
  return {
    getState: () => structuredClone(state),
    subscribe(listener: (state: SeparationState) => void) {
      listeners.add(listener);
      listener(structuredClone(state));
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: () => maintenance(false),
    install: () => maintenance(true),
    refreshInBackground: () => background(() => maintenance(false)),
    installInBackground: () => background(() => maintenance(true)),
    startInBackground: (sequenceId: string, clipId: string) =>
      background(() => processing(sequenceId, clipId)),
    resumeInBackground: (sequenceId: string, clipId: string, jobId: string, retry = false) =>
      background(() => processing(sequenceId, clipId, jobId, retry)),
    start: (sequenceId: string, clipId: string) => processing(sequenceId, clipId),
    resume: (sequenceId: string, clipId: string, jobId: string, retry = false) =>
      processing(sequenceId, clipId, jobId, retry),
    jobs(sequenceId: string, clipId: string, offset = 0) {
      const source = separationSource(context.session().read(), sequenceId, clipId);
      return context.bridge.list(source.resourceId, offset);
    },
    async apply(mode: "vocals" | "instrumental" | "both") {
      if (disposed || busy() || !state.candidate) throw new Error("请先准备并试听分离结果");
      context.guard();
      const candidate = structuredClone(state.candidate),
        session = context.session();
      if (!identical(candidate.identity, session.getState().identity))
        throw new Error("工程已更新，请重新打开分离结果");
      const operations = planApplySeparation(
        session.read(),
        candidate.sequenceId,
        candidate.clipId,
        candidate.result,
        mode,
        context.idFactory,
      );
      update({ phase: "applying", message: "正在保存所选音轨" });
      try {
        await context.apply(operations, candidate.identity, "应用人声与伴奏分离");
        unsubscribe?.();
        unsubscribe = undefined;
        if (!disposed)
          update({
            phase: "idle",
            candidate: undefined,
            message: "已加入分离音轨，原片仍在，可撤销恢复",
          });
      } catch (error) {
        if (!disposed)
          update({
            phase: "error",
            message: error instanceof Error ? error.message : "保存失败，可重试当前结果",
          });
        throw error;
      }
    },
    cancel() {
      if (state.phase === "applying") return false;
      abort?.abort();
      unsubscribe?.();
      unsubscribe = undefined;
      update({ phase: "cancelled", candidate: undefined, message: "已取消；原始素材保持完整" });
      return true;
    },
    dispose() {
      disposed = true;
      unsubscribe?.();
      listeners.clear();
      context.bridge.dispose(); /* Stops SDK observers; durable native jobs continue. */
    },
  };
}
export type SeparationController = ReturnType<typeof createSeparationController>;
