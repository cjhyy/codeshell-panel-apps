import type { EditorSession, SessionIdentity } from "./session";
import type { EditorOperation } from "./operations";
import type { createAudioEnhancementBridge } from "./audio-enhancement-bridge";
import {
  audioEnhancementSource,
  planApplyAudioEnhancement,
  type AudioEnhancementCapability,
  type AudioEnhancementResult,
  type AudioEnhancementSettings,
  validateAudioEnhancementSettings,
} from "./audio-enhancement";
export interface AudioEnhancementControllerContext {
  session(): EditorSession;
  bridge: ReturnType<typeof createAudioEnhancementBridge>;
  guard(): void;
  apply(operations: EditorOperation[], identity: SessionIdentity, label: string): Promise<unknown>;
  idFactory?: () => string;
}
export interface AudioEnhancementState {
  phase: "idle" | "checking" | "running" | "preview" | "applying" | "error" | "cancelled" | "stale";
  message: string;
  fraction?: number;
  taskId?: string;
  capability?: AudioEnhancementCapability;
  source?: { sequenceId: string; clipId: string; name: string };
  candidate?: {
    identity: SessionIdentity;
    sequenceId: string;
    clipId: string;
    result: AudioEnhancementResult;
  };
}
const identical = (a: SessionIdentity, b: SessionIdentity) =>
  a.documentId === b.documentId && a.generation === b.generation && a.revision === b.revision;
export function createAudioEnhancementController(context: AudioEnhancementControllerContext) {
  let state: AudioEnhancementState = { phase: "idle", message: "检查本地优化处理器" },
    abort: AbortController | undefined,
    disposed = false,
    unsubscribe: (() => void) | undefined;
  const listeners = new Set<(state: AudioEnhancementState) => void>();
  const notify = () => {
    if (!disposed) for (const listener of listeners) listener(structuredClone(state));
  };
  const update = (patch: Partial<AudioEnhancementState>) => {
    state = { ...state, ...patch };
    notify();
  };
  const busy = () => ["checking", "running", "applying"].includes(state.phase);
  const begin = (phase: AudioEnhancementState["phase"], message: string) => {
    if (disposed) throw new Error("优化工具已关闭");
    if (busy()) throw new Error("请等待或取消当前优化任务");
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
          : "声音优化未完成",
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
          message: "工程已更新，优化结果未应用；可从原任务重新打开结果",
        });
      }
    });
  }
  async function processing(
    sequenceId: string,
    clipId: string,
    jobId?: string,
    retry = false,
    settings: AudioEnhancementSettings = { preset: "balanced", denoise: true, normalize: true },
  ) {
    context.guard();
    settings = validateAudioEnhancementSettings(settings);
    const session = context.session(),
      identity = session.getState().identity,
      source = audioEnhancementSource(session.read(), sequenceId, clipId),
      controller = begin("running", "正在优化声音");
    update({ source: { sequenceId, clipId, name: source.asset.name } });
    monitor(session, identity);
    try {
      const result = jobId
        ? await context.bridge.resume(jobId, {
            ...options(controller),
            retry,
            sourceResourceId: source.resourceId,
          })
        : await context.bridge.enhance(
            source.resourceId,
            source.asset.duration,
            settings,
            options(controller),
          );
      if (disposed || controller.signal.aborted || abort !== controller) return;
      if (context.session() !== session || !identical(identity, session.getState().identity))
        throw new Error("工程已更新，请重新打开优化结果");
      if (result.sourceResourceId !== source.resourceId) throw new Error("优化结果不属于所选素材");
      update({
        phase: "preview",
        message: `「${source.asset.name}」优化完成。试听后应用到当前片段，原片会保留`,
        fraction: 1,
        candidate: { identity, sequenceId, clipId, result },
      });
    } catch (error) {
      failure(error, controller);
    }
  }
  async function maintenance() {
    const controller = begin("checking", "正在检查本地声音处理器");
    try {
      const capability = await context.bridge.status(options(controller));
      if (!disposed && !controller.signal.aborted)
        update({ phase: "idle", capability, message: capability.message });
    } catch (error) {
      failure(error, controller);
    }
  }
  function background(work: () => Promise<void>): Promise<{ taskId: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const observe = (state: AudioEnhancementState) => {
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
    subscribe(listener: (state: AudioEnhancementState) => void) {
      listeners.add(listener);
      listener(structuredClone(state));
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: () => maintenance(),
    refreshInBackground: () => background(() => maintenance()),
    startInBackground: (sequenceId: string, clipId: string, settings: AudioEnhancementSettings) =>
      background(() => processing(sequenceId, clipId, undefined, false, settings)),
    resumeInBackground: (sequenceId: string, clipId: string, jobId: string, retry = false) =>
      background(() => processing(sequenceId, clipId, jobId, retry)),
    start: (sequenceId: string, clipId: string, settings: AudioEnhancementSettings) =>
      processing(sequenceId, clipId, undefined, false, settings),
    resume: (sequenceId: string, clipId: string, jobId: string, retry = false) =>
      processing(sequenceId, clipId, jobId, retry),
    jobs(sequenceId: string, clipId: string, offset = 0) {
      const source = audioEnhancementSource(context.session().read(), sequenceId, clipId);
      return context.bridge.list(source.resourceId, offset);
    },
    async apply() {
      if (disposed || busy() || !state.candidate) throw new Error("请先准备并试听优化结果");
      context.guard();
      const candidate = structuredClone(state.candidate),
        session = context.session();
      if (!identical(candidate.identity, session.getState().identity))
        throw new Error("工程已更新，请重新打开优化结果");
      const operations = planApplyAudioEnhancement(
        session.read(),
        candidate.sequenceId,
        candidate.clipId,
        candidate.result,
        context.idFactory,
      );
      update({ phase: "applying", message: "正在保存所选音轨" });
      try {
        await context.apply(operations, candidate.identity, "应用声音优化");
        unsubscribe?.();
        unsubscribe = undefined;
        if (!disposed)
          update({
            phase: "idle",
            candidate: undefined,
            message: "已加入优化音轨，原片仍在，可撤销恢复",
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
export type AudioEnhancementController = ReturnType<typeof createAudioEnhancementController>;
