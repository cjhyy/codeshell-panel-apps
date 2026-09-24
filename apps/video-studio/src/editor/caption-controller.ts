import { sameIdentity, type EditorSession, type SessionIdentity } from "./session";
import type { EditorDocument, TextStyle } from "./types";
import type { EditorOperation } from "./operations";
import { applyEditorOperations } from "./operations";
import {
  captionTranslationItems,
  compileCaptionSources,
  planAddCaption,
  planCaptionStyle,
  planCaptionTiming,
  planDetachCaptions,
  planRemoveCaptions,
  planCaptionText,
  planCaptionTranslation,
  planSrtImport,
  planTranscriptCaptions,
  validateCaptionTranscript,
  type CaptionPlan,
  type CaptionTranscriptSegment,
} from "./captions";
import { planCaptionPreset, type CaptionPreset } from "./caption-presets";
import { narrationDraftClipIds, recordedNarrationClipIds } from "./narration-edits";

/** Temporary narration captions: the narration workflow replaces them, so they never block. */
function workflowCaptions(doc: EditorDocument, sequenceId: string): Set<string> {
  return new Set([
    ...narrationDraftClipIds(doc, sequenceId),
    ...recordedNarrationClipIds(doc, sequenceId),
  ]);
}

export interface CaptionControllerContext {
  session(): EditorSession;
  apply(operations: EditorOperation[], identity: SessionIdentity, label: string): Promise<unknown>;
  transcript?(request: {
    assetId: string;
    offset: number;
    limit: number;
    signal: AbortSignal;
  }): Promise<{
    assetId: string;
    total: number;
    offset: number;
    segments: CaptionTranscriptSegment[];
    revision?: string;
  }>;
  prepare?(request: { assetIds: string[]; signal: AbortSignal }): Promise<void>;
  translate?(request: {
    language: string;
    items: Array<{ id: string; text: string }>;
    signal: AbortSignal;
  }): Promise<Array<{ id: string; text: string }>>;
  idFactory?: () => string;
}
export interface CaptionCandidate {
  identity: SessionIdentity;
  sequenceId: string;
  label: string;
  operations: EditorOperation[];
  rows: Array<{
    id: string;
    before?: string;
    text: string;
    start: number;
    duration: number;
    wordCount: number;
  }>;
  notices: string[];
  added: number;
  skipped: number;
}
export interface CaptionControllerState {
  phase:
    | "idle"
    | "preparing"
    | "transcribing"
    | "translating"
    | "preview"
    | "applying"
    | "error"
    | "cancelled"
    | "stale";
  message: string;
  completed: number;
  total: number;
  candidate?: CaptionCandidate;
  canTranscribe: boolean;
  canTranslate: boolean;
}
export function createCaptionController(context: CaptionControllerContext) {
  let state: CaptionControllerState = {
    phase: "idle",
    message: "选择声音来源生成字幕，或导入 SRT",
    completed: 0,
    total: 0,
    canTranscribe: !!context.transcript,
    canTranslate: !!context.translate,
  };
  let work: AbortController | undefined,
    disposed = false,
    serial = 0,
    pendingSession: EditorSession | undefined;
  let unwatch: (() => void) | undefined;
  const listeners = new Set<(state: CaptionControllerState) => void>();
  const notify = () => {
    if (!disposed) for (const listener of listeners) listener(structuredClone(state));
  };
  const set = (patch: Partial<CaptionControllerState>) => {
    state = { ...state, ...patch };
    notify();
  };
  const read = () => {
    if (disposed) throw new Error("字幕面板已关闭");
    const session = context.session(),
      current = session.getState();
    if (current.phase !== "ready") throw new Error("工程正在保存或切换");
    return { session, identity: current.identity, document: session.read() };
  };
  const check = (snapshot: ReturnType<typeof read>, token: number, signal?: AbortSignal) => {
    if (disposed || token !== serial || signal?.aborted)
      throw new DOMException("字幕操作已取消", "AbortError");
    if (
      context.session() !== snapshot.session ||
      !sameIdentity(context.session().getState().identity, snapshot.identity)
    )
      throw new Error("生成期间工程已变化，请重新读取后生成字幕");
  };
  const start = () => {
    if (work || state.phase === "applying") throw new Error("请等待当前字幕操作完成或取消");
    const snapshot = read(),
      controller = new AbortController(),
      token = ++serial;
    work = controller;
    pendingSession = snapshot.session;
    unwatch?.();
    unwatch = snapshot.session.subscribe((current) => {
      if (disposed || state.phase === "applying" || sameIdentity(current.identity, snapshot.identity))
        return;
      serial++;
      work?.abort();
      work = undefined;
      pendingSession = undefined;
      set({
        phase: "stale",
        message: "工程已变化，字幕候选已失效，请重新生成",
        candidate: undefined,
      });
    });
    state.candidate = undefined;
    return { snapshot, controller, token };
  };
  const preview = (snapshot: ReturnType<typeof read>, plan: CaptionPlan, label: string) => {
    const after = applyEditorOperations(
      snapshot.document,
      plan.operations,
      snapshot.document.revision,
    );
    const beforeSeq = snapshot.document.sequences.find((seq) => seq.id === plan.sequenceId)!,
      afterSeq = after.sequences.find((seq) => seq.id === plan.sequenceId)!;
    const ids = new Set(
      plan.operations.flatMap((op) =>
        op.type === "clip.add" ? [op.clip.id] : op.type === "clip.update" ? [op.clipId] : [],
      ),
    );
    const candidate: CaptionCandidate = {
      identity: structuredClone(snapshot.identity),
      sequenceId: plan.sequenceId,
      label,
      operations: structuredClone(plan.operations),
      notices: [...plan.notices],
      added: plan.added,
      skipped: plan.skipped,
      rows: afterSeq.clips.flatMap((clip) =>
        clip.kind === "text" && ids.has(clip.id)
          ? [
              {
                id: clip.id,
                text: clip.text,
                start: clip.start,
                duration: clip.duration,
                wordCount: clip.words.length,
                ...(beforeSeq.clips.some((old) => old.id === clip.id)
                  ? { before: (beforeSeq.clips.find((old) => old.id === clip.id) as any).text }
                  : {}),
              },
            ]
          : [],
      ),
    };
    set({
      phase: "preview",
      candidate,
      message: plan.operations.length
        ? `${candidate.rows.length} 条字幕等待应用`
        : `没有新增内容，已保留 ${plan.skipped} 条既有字幕`,
    });
  };
  const failure = (error: unknown, token: number) => {
    if (disposed || token !== serial) return;
    set({
      phase:
        (error as Error)?.name === "AbortError"
          ? "cancelled"
          : /工程已变化|身份/.test(String(error))
            ? "stale"
            : "error",
      message: (error as Error)?.message ?? String(error),
    });
  };
  const run = async (task: (run: ReturnType<typeof start>) => Promise<void>) => {
    const running = start();
    try {
      await task(running);
    } catch (error) {
      failure(error, running.token);
      throw error;
    } finally {
      if (work === running.controller) work = undefined;
    }
  };
  const api = {
    getState: () => structuredClone(state),
    setCapabilities(value: { canTranscribe: boolean; canTranslate: boolean }) {
      if (typeof value.canTranscribe !== "boolean" || typeof value.canTranslate !== "boolean")
        throw new Error("字幕能力状态无效");
      set({
        canTranscribe: value.canTranscribe && !!context.transcript,
        canTranslate: value.canTranslate && !!context.translate,
      });
    },
    subscribe(listener: (state: CaptionControllerState) => void) {
      listeners.add(listener);
      listener(structuredClone(state));
      return () => listeners.delete(listener);
    },
    sources(sequenceId: string) {
      return compileCaptionSources(read().document, sequenceId).map(
        ({ assetId, name, instanceId, ownerClipId, ranges }) => ({
          assetId,
          name,
          instanceId,
          ownerClipId,
          ranges,
        }),
      );
    },
    async generate(options: {
      sequenceId: string;
      trackId?: string;
      assetIds?: string[];
      wordHighlight?: boolean;
    }) {
      options = structuredClone(options);
      if (!context.transcript || !state.canTranscribe)
        throw new Error("当前环境没有接入真实语音转写，可导入 SRT");
      await run(async ({ snapshot, controller, token }) => {
        const available = [
          ...new Set(
            compileCaptionSources(snapshot.document, options.sequenceId).map(
              (source) => source.assetId,
            ),
          ),
        ];
        const assetIds = options.assetIds ?? available;
        if (
          !assetIds.length ||
          new Set(assetIds).size !== assetIds.length ||
          assetIds.some((id) => !available.includes(id))
        )
          throw new Error("请选择当前序列中可听见的声音来源");
        set({
          phase: context.prepare ? "preparing" : "transcribing",
          message: "准备所选声音的真实转写",
          completed: 0,
          total: assetIds.length,
        });
        if (context.prepare)
          await context.prepare({ assetIds: [...assetIds], signal: controller.signal });
        check(snapshot, token, controller.signal);
        const transcripts = new Map<string, CaptionTranscriptSegment[]>();
        const names = new Map(
          snapshot.document.assets.map((asset) => [asset.id, asset.name] as const),
        );
        let transcriptCharacters = 0;
        for (const assetId of assetIds) {
          try {
            set({
              phase: "transcribing",
              message: `读取转写 ${transcripts.size + 1}/${assetIds.length}`,
            });
            const segments: CaptionTranscriptSegment[] = [];
            let offset = 0,
              total: number | undefined,
              revision: string | undefined;
            const seen = new Set<string>();
            do {
              const page = await context.transcript!({
                assetId,
                offset,
                limit: 100,
                signal: controller.signal,
              });
              check(snapshot, token, controller.signal);
              if (
                !page ||
                page.assetId !== assetId ||
                page.offset !== offset ||
                !Number.isSafeInteger(page.total) ||
                page.total < 0 ||
                page.total > 100000 ||
                (total !== undefined && page.total !== total) ||
                !Array.isArray(page.segments) ||
                page.segments.length > 100 ||
                offset + page.segments.length > page.total ||
                (!page.segments.length && offset < page.total)
              )
                throw new Error("转写分页不完整或身份变化，未写入字幕");
              if (
                page.revision !== undefined &&
                (typeof page.revision !== "string" || !page.revision || page.revision.length > 256)
              )
                throw new Error("转写版本无效");
              if (offset === 0) revision = page.revision;
              else if (page.revision !== revision)
                throw new Error("转写版本在分页期间变化，未写入字幕");
              const validated = validateCaptionTranscript(page.segments);
              for (const segment of validated) {
                const key = JSON.stringify([segment.start, segment.end, segment.text]);
                if (seen.has(key)) throw new Error("转写分页重复段落，未写入字幕");
                seen.add(key);
                transcriptCharacters +=
                  segment.text.length +
                  (segment.words ?? []).reduce((sum, word) => sum + word.text.length, 0);
                if (transcriptCharacters > 16 * 1024 * 1024)
                  throw new Error("此次转写超过16 MiB，请缩小素材选择");
              }
              total = page.total;
              segments.push(...validated);
              offset += page.segments.length;
            } while (offset < total!);
            transcripts.set(assetId, segments);
            set({ completed: transcripts.size });
          } catch (error) {
            // Cancellation and project changes are not this source's fault.
            if (
              (error as Error)?.name === "AbortError" ||
              /工程已变化/.test(String((error as Error)?.message ?? error))
            )
              throw error;
            const message = (error as Error)?.message ?? String(error);
            throw new Error(
              `声音来源「${names.get(assetId) ?? assetId}」：${message}。可取消勾选这个来源后重试。`,
            );
          }
        }
        check(snapshot, token, controller.signal);
        const plan = planTranscriptCaptions(snapshot.document, options.sequenceId, transcripts, {
          ...options,
          idFactory: context.idFactory,
          avoidOverlaps: true,
          overlapExempt: workflowCaptions(snapshot.document, options.sequenceId),
        });
        if ([...transcripts.values()].every((segments) => !segments.length))
          plan.notices.push("所选素材没有识别到语音，未生成虚构字幕");
        preview(snapshot, plan, "从真实声音生成字幕");
      });
    },
    importSrt(options: { sequenceId: string; text: string; trackId?: string }) {
      const running = start();
      try {
        preview(
          running.snapshot,
          planSrtImport(running.snapshot.document, options.sequenceId, options.text, {
            trackId: options.trackId,
            idFactory: context.idFactory,
            avoidOverlaps: true,
            overlapExempt: workflowCaptions(running.snapshot.document, options.sequenceId),
          }),
          "导入 SRT 字幕",
        );
      } catch (error) {
        failure(error, running.token);
        throw error;
      } finally {
        work = undefined;
      }
    },
    async translate(options: {
      sequenceId: string;
      clipIds: string[];
      language: string;
      mode: "bilingual" | "translated";
    }) {
      options = structuredClone(options);
      if (!context.translate || !state.canTranslate)
        throw new Error("当前环境没有连接翻译服务，原字幕已保留");
      await run(async ({ snapshot, controller, token }) => {
        const items = captionTranslationItems(
            snapshot.document,
            options.sequenceId,
            options.clipIds,
          ),
          result: Array<{ id: string; text: string }> = [];
        if (
          !options.language.trim() ||
          options.language.length > 80 ||
          !["bilingual", "translated"].includes(options.mode)
        )
          throw new Error("翻译语言或显示模式无效");
        set({
          phase: "translating",
          message: "正在翻译所选字幕",
          completed: 0,
          total: items.length,
        });
        let offset = 0;
        while (offset < items.length) {
          const batch: typeof items = [];
          let chars = 0;
          while (offset + batch.length < items.length && batch.length < 50) {
            const item = items[offset + batch.length]!;
            if (batch.length && chars + item.text.length > 12000) break;
            batch.push(item);
            chars += item.text.length;
          }
          const translated = await context.translate!({
            language: options.language,
            items: structuredClone(batch),
            signal: controller.signal,
          });
          check(snapshot, token, controller.signal);
          // Validate each batch before accepting another service response.
          planCaptionTranslation(
            snapshot.document,
            options.sequenceId,
            batch.map((item) => item.id),
            options.language,
            options.mode,
            translated,
          );
          result.push(...translated.map((item) => ({ ...item })));
          offset += batch.length;
          set({ completed: offset });
        }
        preview(
          snapshot,
          planCaptionTranslation(
            snapshot.document,
            options.sequenceId,
            options.clipIds,
            options.language,
            options.mode,
            result,
          ),
          "应用字幕翻译",
        );
      });
    },
    async apply() {
      if (work || state.phase === "applying") throw new Error("字幕任务尚未完成");
      const candidate = state.candidate;
      if (!candidate) throw new Error("没有待应用的字幕");
      const snapshot = read(),
        token = ++serial;
      if (snapshot.session !== pendingSession || !sameIdentity(snapshot.identity, candidate.identity)) {
        set({ phase: "stale", message: "工程已变化，请重新生成预览", candidate: undefined });
        throw new Error(state.message);
      }
      set({ phase: "applying", message: "保存字幕" });
      try {
        await context.apply(
          structuredClone(candidate.operations),
          candidate.identity,
          candidate.label,
        );
        unwatch?.();
        unwatch = undefined;
        if (!disposed && token === serial)
          set({ phase: "idle", candidate: undefined, message: "字幕已保存" });
      } catch (error) {
        failure(error, token);
        throw error;
      }
    },
    async updateText(sequenceId: string, clipId: string, text: string) {
      const snapshot = read();
      if (work || state.phase === "applying") throw new Error("请先完成或取消当前字幕任务");
      await context.apply(
        planCaptionText(snapshot.document, sequenceId, clipId, text),
        snapshot.identity,
        "修改字幕文字",
      );
    },
    /** Adds one plain subtitle and returns its clip ID. */
    async add(
      sequenceId: string,
      options: { start: number; duration?: number; text: string; trackId?: string },
    ): Promise<string> {
      const snapshot = read();
      if (work || state.phase === "applying") throw new Error("请先完成或取消当前字幕任务");
      const operations = planAddCaption(snapshot.document, sequenceId, {
        ...options,
        ...(context.idFactory ? { idFactory: context.idFactory } : {}),
      });
      const added = operations.find((op) => op.type === "clip.add");
      await context.apply(operations, snapshot.identity, "添加字幕");
      return added?.type === "clip.add" ? added.clip.id : "";
    },
    async updateTiming(sequenceId: string, clipId: string, timing: { start: number; end: number }) {
      const snapshot = read();
      if (work || state.phase === "applying") throw new Error("请先完成或取消当前字幕任务");
      const operations = planCaptionTiming(snapshot.document, sequenceId, clipId, timing);
      if (operations.length) await context.apply(operations, snapshot.identity, "调整字幕时间");
    },
    async remove(sequenceId: string, clipIds: string[]) {
      const snapshot = read();
      if (work || state.phase === "applying") throw new Error("请先完成或取消当前字幕任务");
      await context.apply(
        planRemoveCaptions(snapshot.document, sequenceId, clipIds),
        snapshot.identity,
        "删除字幕",
      );
    },
    async applyPreset(sequenceId: string, preset: CaptionPreset) {
      const snapshot = read();
      if (work || state.phase === "applying") throw new Error("请先完成或取消当前字幕任务");
      const operations = planCaptionPreset(snapshot.document, sequenceId, preset);
      if (operations.length) await context.apply(operations, snapshot.identity, "套用字幕样式");
    },
    async updateStyle(sequenceId: string, clipIds: string[], patch: Partial<TextStyle>) {
      const snapshot = read();
      if (work || state.phase === "applying") throw new Error("请先完成或取消当前字幕任务");
      await context.apply(
        planCaptionStyle(snapshot.document, sequenceId, clipIds, patch),
        snapshot.identity,
        "调整字幕样式",
      );
    },
    async detach(sequenceId: string, clipIds: string[]) {
      const snapshot = read();
      if (work || state.phase === "applying") throw new Error("请先完成或取消当前字幕任务");
      await context.apply(
        planDetachCaptions(snapshot.document, sequenceId, clipIds),
        snapshot.identity,
        "解除字幕来源绑定",
      );
    },
    cancel() {
      if (state.phase === "applying") return false;
      serial++;
      work?.abort();
      work = undefined;
      pendingSession = undefined;
      unwatch?.();
      unwatch = undefined;
      set({ phase: "cancelled", candidate: undefined, message: "已取消字幕操作" });
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      serial++;
      work?.abort();
      work = undefined;
      unwatch?.();
      unwatch = undefined;
      listeners.clear();
    },
  };
  return api;
}
export type CaptionController = ReturnType<typeof createCaptionController>;
