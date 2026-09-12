import type { PanelBridge } from "./host";
import type { MediaJob, VoiceCatalog, VoiceModel } from "./production";
import { cancelled, createVoiceProcessClient, VOICE_IO, VOICE_LAUNCH } from "./local-voice-process";

const ENGINES = ["audio8-tts", "qwen3-tts"] as const;
const KEY = "video-studio-local-voice-v1";
const MAX_REFERENCE_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1800 * 48000 * 2 + 4096;
const active = (job: MediaJob) => ["queued", "running"].includes(job.status);
const localId = (id: unknown): id is string =>
  typeof id === "string" && /^job-panel-[a-f0-9-]{36}$/.test(id);
const engineId = (id: unknown): id is (typeof ENGINES)[number] => ENGINES.includes(id as any);
const assetId = (id: unknown): id is string =>
  typeof id === "string" && /^asset-[a-f0-9]{64}$/.test(id);
interface Input {
  action: "setup" | "generate";
  engine: (typeof ENGINES)[number];
  text?: string;
  referenceAssetId?: string;
  referenceText?: string;
  rate?: number;
}
interface Entry {
  job: MediaJob;
  input: Input;
}
interface Scope {
  cwd: string;
  key: string;
  revision: number;
  entries: Entry[];
  controllers: Map<string, AbortController>;
  writes: Promise<void>;
  ready: Promise<void>;
}
interface NativePackage {
  source: string;
  sha256: string;
}
const chunks = (text: string) => {
  const characters = Array.from(text),
    result: string[] = [];
  // Never split a surrogate pair when Node encodes each argv item separately.
  for (let offset = 0; offset < characters.length; offset += 3000)
    result.push(characters.slice(offset, offset + 3000).join(""));
  return result;
};
function base64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}
function bytes64(value: unknown, maxBytes = 32768): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(maxBytes / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new Error("本地音频分块无效");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
function validateInput(value: any): Input {
  if (!value || !["setup", "generate"].includes(value.action) || !engineId(value.engine))
    throw new Error("本地声音任务参数无效");
  if (value.action === "setup") return { action: "setup", engine: value.engine };
  const readable = (text: unknown, max: number) =>
    typeof text === "string" &&
    text.trim() &&
    Array.from(text).length <= max &&
    /[\p{L}\p{N}]/u.test(text) &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
  if (
    !readable(value.text, 2000) ||
    !readable(value.referenceText, 1000) ||
    !assetId(value.referenceAssetId) ||
    (value.rate !== undefined &&
      (!Number.isFinite(value.rate) || value.rate < 0.5 || value.rate > 2))
  )
    throw new Error("请提供 1–2000 字文稿、当前工程参考录音和准确逐字稿，语速为 0.5–2 倍");
  return {
    action: "generate",
    engine: value.engine,
    text: value.text.trim(),
    referenceText: value.referenceText.trim(),
    referenceAssetId: value.referenceAssetId,
    rate: value.rate ?? 1,
  };
}
function restored(value: unknown): Entry[] {
  if (value === null || value === undefined) return [];
  const data = value as { schemaVersion?: number; entries?: Entry[] };
  if (data.schemaVersion !== 1 || !Array.isArray(data.entries) || data.entries.length > 120)
    throw new Error("本地声音记录恢复失败，已保留原记录");
  const ids = new Set<string>();
  return data.entries.map((entry) => {
    const job = entry?.job,
      input = validateInput(entry?.input);
    if (
      !job ||
      !localId(job.id) ||
      ids.has(job.id) ||
      !["tts-setup", "tts-clone"].includes(job.type) ||
      !["queued", "running", "succeeded", "failed", "cancelled"].includes(job.status) ||
      !Number.isSafeInteger(job.attempt) ||
      job.attempt < 1 ||
      !Number.isFinite(job.createdAt) ||
      !Number.isFinite(job.updatedAt)
    )
      throw new Error("本地声音任务记录损坏，已保留原记录");
    ids.add(job.id);
    const copy = structuredClone(job);
    if (active(copy)) {
      copy.status = "failed";
      copy.updatedAt = Date.now();
      copy.error = {
        code: "PANEL_CLOSED",
        message: "面板关闭或重新载入，声音任务已中断，可以重试",
        retryable: true,
      };
    }
    return { job: copy, input };
  });
}

/** Model-specific execution belongs to this Panel. Host calls below are generic IO/jobs only. */
export function createLocalVoiceBridge(
  raw: PanelBridge,
  native: NativePackage,
): PanelBridge & { dispose(): void } {
  const processClient = createVoiceProcessClient(raw);
  const listeners = new Set<(payload: unknown) => void>();
  const scopes = new Map<string, Scope>();
  let disposed = false;
  let staging: Promise<void> | undefined;
  let executionQueue = Promise.resolve();
  let catalogCache: { at: number; models: VoiceModel[] } | undefined;
  let catalogPending: Promise<VoiceModel[]> | undefined;
  const lifetime = new AbortController();
  const emitted = new Map<string, { status: string; at: number }>();
  const emit = (job: MediaJob) => {
    const last = emitted.get(job.id),
      now = Date.now();
    if (active(job) && last?.status === job.status && now - last.at < 1000) return;
    emitted.set(job.id, { status: job.status, at: now });
    listeners.forEach((listener) => listener(structuredClone(job)));
  };
  async function current(scope: Scope, signal?: AbortSignal) {
    if (disposed || signal?.aborted || (await raw.getContext()).cwd !== scope.cwd)
      throw cancelled();
  }
  async function save(scope: Scope) {
    const snapshot = structuredClone({ schemaVersion: 1, entries: scope.entries });
    const archived: Entry[] = [];
    while (
      snapshot.entries.length > 120 ||
      new TextEncoder().encode(JSON.stringify(snapshot)).length > 1536 * 1024
    ) {
      let index = snapshot.entries.length - 1;
      while (index >= 0 && active(snapshot.entries[index]!.job)) index--;
      if (index < 0) throw new Error("待处理声音任务记录超出存储空间，请先完成或取消任务");
      archived.push(snapshot.entries.splice(index, 1)[0]!);
    }
    const operation = scope.writes
      .catch(() => {})
      .then(async () => {
        await current(scope);
        // Keep completed receipts addressable for saved voice recipes even after list pruning.
        for (const entry of archived) {
          const key = `${KEY}-${entry.job.id}`;
          const previous = (await raw.call("media.document.get", { key })) as any;
          await current(scope);
          await raw.call("media.document.set", {
            key,
            baseRevision: previous.revision,
            data: { schemaVersion: 1, entries: [entry] },
            label: "声音任务历史",
          });
        }
        await current(scope);
        const result = (await raw.call("media.document.set", {
          key: KEY,
          baseRevision: scope.revision,
          data: snapshot,
          label: "本地声音任务",
        })) as any;
        if (!Number.isSafeInteger(result?.revision)) throw new Error("声音任务保存失败");
        scope.revision = result.revision;
        scope.entries = scope.entries.filter(
          (entry) =>
            !archived.some(
              (old) =>
                old.job.id === entry.job.id &&
                old.job.attempt === entry.job.attempt &&
                old.job.updatedAt === entry.job.updatedAt &&
                !active(entry.job),
            ),
        );
      });
    scope.writes = operation;
    return operation;
  }
  async function scopeState(): Promise<Scope> {
    const { cwd } = await raw.getContext();
    if (!cwd || disposed) throw new Error("请先将视频面板绑定到当前项目");
    let scope = scopes.get(cwd);
    if (!scope) {
      const key = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cwd))),
      )
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      scope = scopes.get(cwd);
      if (!scope) {
        scope = {
          cwd,
          key,
          revision: 0,
          entries: [],
          controllers: new Map(),
          writes: Promise.resolve(),
          ready: Promise.resolve(),
        };
        scopes.set(cwd, scope);
        const target = scope;
        target.ready = (async () => {
          await current(target);
          const document = (await raw.call("media.document.get", { key: KEY })) as any;
          if (!Number.isSafeInteger(document?.revision) || document.revision < 0)
            throw new Error("声音任务版本无效");
          target.revision = document.revision;
          target.entries = restored(document.data);
          // Persist interruptions once, so subsequent refreshes are stable.
          if (document.data?.entries?.some((entry: Entry) => active(entry.job))) await save(target);
        })().catch((error) => {
          if (scopes.get(cwd) === target) scopes.delete(cwd);
          throw error;
        });
      }
    }
    await scope.ready;
    return scope;
  }
  async function io(request: object, data: string | undefined, signal: AbortSignal): Promise<any> {
    const result = await processClient.run(
      VOICE_IO,
      [JSON.stringify(request), ...chunks(data ?? "")],
      signal,
    );
    let value: any;
    try {
      value = JSON.parse(result.stdout.trim());
    } catch {
      throw new Error("本地声音工具未返回完整文件结果");
    }
    if (result.code !== 0 || value.error) throw new Error(value.error || "本地声音文件操作失败");
    return value;
  }
  async function stage() {
    staging ??= (async () => {
      if (
        !/^[a-f0-9]{64}$/.test(native.sha256) ||
        new TextEncoder().encode(native.source).length > 1024 * 1024
      )
        throw new Error("面板声音工具包无效，请重新安装面板");
      if (
        (
          await io(
            { kind: "tool", action: "check", hash: native.sha256 },
            undefined,
            lifetime.signal,
          )
        ).valid
      )
        return;
      const data = new TextEncoder().encode(native.source),
        token = crypto.randomUUID();
      for (let offset = 0; offset < data.length; offset += 32768)
        await io(
          { kind: "tool", action: "write", hash: native.sha256, token, offset },
          base64(data.subarray(offset, offset + 32768)),
          lifetime.signal,
        );
      await io(
        { kind: "tool", action: "commit", hash: native.sha256, token },
        undefined,
        lifetime.signal,
      );
    })().catch((error) => {
      staging = undefined;
      throw error;
    });
    return staging;
  }
  async function execute(
    request: object,
    signal: AbortSignal,
    progress?: (value: any) => void,
  ): Promise<any> {
    await stage();
    if (signal.aborted) throw cancelled();
    let buffer = "",
      result: any,
      error = "";
    const parse = (text: string) => {
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      if (buffer.length > 64 * 1024) throw new Error("本地声音工具输出无效");
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "progress") progress?.(event.progress);
        else if (event.type === "result") {
          if (result !== undefined) throw new Error("本地声音工具重复返回结果");
          result = event.result;
        } else if (event.type === "error")
          error = typeof event.message === "string" ? event.message : "本地声音生成失败";
      }
    };
    const output = await processClient.run(
      VOICE_LAUNCH,
      [native.sha256, ...chunks(JSON.stringify(request))],
      signal,
      parse,
    );
    if (buffer.trim()) parse("\n");
    if (output.code !== 0 || error || result === undefined)
      throw new Error(error || "本地声音工具未完成，请重新初始化或重试");
    return result;
  }
  async function models(): Promise<VoiceModel[]> {
    if (catalogCache && Date.now() - catalogCache.at < 5000)
      return structuredClone(catalogCache.models);
    catalogPending ??= (async () => {
      let prerequisite = "";
      try {
        const status = (await raw.call("media.status", {})) as any;
        if (!status?.assetRead?.available)
          prerequisite =
            "当前桌面缺少通用素材分块读取能力；需更新一次基础接口，后续语音引擎随面板更新";
      } catch (error) {
        prerequisite = error instanceof Error ? error.message : String(error);
      }
      const results: VoiceModel[] = [];
      for (const engine of ENGINES) {
        let value: any;
        try {
          if (prerequisite) throw new Error(prerequisite);
          value = await execute(
            { action: "status", engine, scopeKey: "0".repeat(64), jobId: "status" },
            lifetime.signal,
          );
        } catch (error) {
          value = {
            available: false,
            state: "unavailable",
            reason: error instanceof Error ? error.message : String(error),
          };
        }
        results.push({
          id: engine,
          name:
            engine === "audio8-tts" ? "Audio8 0.6B · 本地中文声音克隆" : "Qwen3-TTS · 本人声音克隆",
          provider: "video-studio",
          mode: "offline",
          available: value.available === true,
          state: value.state,
          installable: !prerequisite && value.state !== "unavailable",
          reason: value.reason,
          voices: [{ id: "reference", name: "我的声音 · 参考录音", language: "zh-CN" }],
          defaultVoiceId: "reference",
          maxTextLength: 2000,
          supportsInstructions: false,
          supportsVoiceCloning: true,
        });
      }
      catalogCache = { at: Date.now(), models: results };
      return results;
    })().finally(() => {
      catalogPending = undefined;
    });
    return structuredClone(await catalogPending);
  }
  async function copyReference(
    scope: Scope,
    jobId: string,
    id: string,
    signal: AbortSignal,
    progress: (fraction: number) => void,
  ) {
    let offset = 0,
      total = 0;
    do {
      await current(scope, signal);
      const chunk = (await raw.call("media.assets.read", {
        assetId: id,
        offset,
        length: 32768,
      })) as any;
      if (
        chunk.assetId !== id ||
        chunk.offset !== offset ||
        !Number.isSafeInteger(chunk.totalBytes) ||
        chunk.totalBytes < 1 ||
        chunk.totalBytes > MAX_REFERENCE_BYTES ||
        (total && total !== chunk.totalBytes) ||
        typeof chunk.mimeType !== "string" ||
        !chunk.mimeType.startsWith("audio/")
      )
        throw new Error("参考录音须为当前工程音频，且不超过 16 MB");
      total = chunk.totalBytes;
      const bytes = bytes64(chunk.dataBase64);
      if (
        !bytes.length ||
        bytes.length > 32768 ||
        offset + bytes.length > total ||
        chunk.eof !== (offset + bytes.length === total)
      )
        throw new Error("参考录音传输不完整，请重新导入");
      await current(scope, signal);
      await io({ action: "write", scopeKey: scope.key, jobId, offset }, chunk.dataBase64, signal);
      offset += bytes.length;
      progress(offset / total);
    } while (offset < total);
  }
  async function publish(
    scope: Scope,
    jobId: string,
    nativeResult: any,
    signal: AbortSignal,
    progress: (fraction: number) => void,
  ): Promise<any> {
    if (
      nativeResult?.file !== "output.wav" ||
      !Number.isSafeInteger(nativeResult.bytes) ||
      nativeResult.bytes < 44 ||
      nativeResult.bytes > MAX_OUTPUT_BYTES ||
      !Number.isFinite(nativeResult.durationSeconds) ||
      nativeResult.durationSeconds <= 0 ||
      nativeResult.durationSeconds > 1800
    )
      throw new Error("本地声音结果不完整，未加入素材库");
    await current(scope, signal);
    const upload = (await raw.call("media.recording.begin", {
      mimeType: "audio/wav",
      name: "我的声音配音.wav",
      expectedBytes: nativeResult.bytes,
    })) as any;
    if (
      typeof upload?.sessionId !== "string" ||
      !Number.isSafeInteger(upload.maxChunkBytes) ||
      upload.maxChunkBytes < 1
    )
      throw new Error("配音保存通道无效");
    let finished = false;
    try {
      let offset = 0,
        sequence = 0;
      while (offset < nativeResult.bytes) {
        await current(scope, signal);
        const chunk = await io(
          { action: "read", scopeKey: scope.key, jobId, offset },
          undefined,
          signal,
        );
        const bytes = bytes64(chunk.dataBase64, 524288);
        if (
          chunk.offset !== offset ||
          chunk.bytes !== nativeResult.bytes ||
          !bytes.length ||
          offset + bytes.length > nativeResult.bytes
        )
          throw new Error("配音文件读取不完整");
        for (let at = 0; at < bytes.length; at += upload.maxChunkBytes) {
          await current(scope, signal);
          const part = bytes.subarray(at, at + upload.maxChunkBytes);
          await raw.call("media.recording.write", {
            sessionId: upload.sessionId,
            sequence: sequence++,
            offset: offset + at,
            dataBase64: base64(part),
          });
        }
        offset += bytes.length;
        progress(offset / nativeResult.bytes);
      }
      await current(scope, signal);
      const result = (await raw.call("media.recording.finish", {
        sessionId: upload.sessionId,
      })) as any;
      finished = true;
      if (
        !assetId(result?.asset?.id) ||
        result?.inspection?.kind !== "audio" ||
        !Number.isFinite(result.inspection.durationSeconds) ||
        Math.abs(result.inspection.durationSeconds - nativeResult.durationSeconds) > 0.05
      )
        throw new Error("生成音频的实际时长校验失败");
      return result;
    } finally {
      if (!finished && (await raw.getContext()).cwd === scope.cwd)
        await raw.call("media.recording.cancel", { sessionId: upload.sessionId }).catch(() => {});
    }
  }
  function schedule(scope: Scope, entry: Entry) {
    const controller = new AbortController();
    scope.controllers.set(entry.job.id, controller);
    const work = executionQueue
      .catch(() => {})
      .then(async () => {
        const { job, input } = entry,
          signal = controller.signal;
        try {
          await current(scope, signal);
          job.status = "running";
          job.updatedAt = Date.now();
          delete job.error;
          await save(scope);
          emit(job);
          if (input.action === "generate") {
            await io({ action: "cleanup", scopeKey: scope.key, jobId: job.id }, undefined, signal);
            await copyReference(scope, job.id, input.referenceAssetId!, signal, (fraction) => {
              job.progress = { stage: "reference", message: "正在准备参考录音", fraction };
              job.updatedAt = Date.now();
              emit(job);
            });
          }
          const result = await execute(
            {
              action: input.action,
              engine: input.engine,
              scopeKey: scope.key,
              jobId: job.id,
              ...(input.action === "generate"
                ? {
                    text: input.text,
                    referenceText: input.referenceText,
                    rate: input.rate,
                    referenceFile: "reference.bin",
                  }
                : {}),
            },
            signal,
            (progress) => {
              if (!signal.aborted && progress && typeof progress.message === "string") {
                job.progress = {
                  message: progress.message.slice(0, 1000),
                  ...(typeof progress.stage === "string"
                    ? { stage: progress.stage.slice(0, 80) }
                    : {}),
                  ...(Number.isFinite(progress.fraction)
                    ? { fraction: Math.max(0, Math.min(1, progress.fraction)) }
                    : {}),
                };
                job.updatedAt = Date.now();
                emit(job);
              }
            },
          );
          await current(scope, signal);
          if (input.action === "generate") {
            job.progress = { stage: "saving", message: "正在将配音保存到素材库", fraction: 0 };
            job.updatedAt = Date.now();
            emit(job);
            const publication = await publish(scope, job.id, result, signal, (fraction) => {
              job.progress = { stage: "saving", message: "正在将配音保存到素材库", fraction };
              job.updatedAt = Date.now();
              emit(job);
            });
            await current(scope, signal);
            job.result = {
              ...publication,
              speech: {
                text: input.text,
                modelId: input.engine,
                engine: input.engine,
                voiceId: "reference",
                rate: input.rate,
                referenceAssetId: input.referenceAssetId,
                referenceText: input.referenceText,
              },
            };
          } else {
            if (result?.available !== true)
              throw new Error(result?.reason || "声音环境检查尚未通过");
            job.result = result;
          }
          job.status = "succeeded";
          job.progress = { fraction: 1, message: "完成" };
        } catch (error) {
          job.status =
            signal.aborted || (error instanceof Error && error.name === "AbortError")
              ? "cancelled"
              : "failed";
          job.error = {
            code: job.status === "cancelled" ? "CANCELLED" : "LOCAL_VOICE_FAILED",
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          };
        } finally {
          job.updatedAt = Date.now();
          catalogCache = undefined;
          scope.controllers.delete(job.id);
          if (!disposed && (await raw.getContext()).cwd === scope.cwd) {
            try {
              await save(scope);
            } catch {
              job.status = "failed";
              job.error = {
                code: "SAVE_FAILED",
                message: "声音任务记录保存失败，请重新打开面板检查",
                retryable: true,
              };
            }
            emit(job);
          }
          if (!disposed)
            await io(
              { action: "cleanup", scopeKey: scope.key, jobId: job.id },
              undefined,
              lifetime.signal,
            ).catch(() => {});
        }
      });
    executionQueue = work.catch(() => {});
  }
  async function start(input: Input): Promise<MediaJob> {
    const scope = await scopeState();
    if (input.action === "setup") {
      const existing = scope.entries.find(
        (entry) =>
          active(entry.job) &&
          entry.input.action === "setup" &&
          entry.input.engine === input.engine,
      );
      if (existing) return structuredClone(existing.job);
    }
    if (scope.entries.filter((entry) => active(entry.job)).length >= 8)
      throw new Error("本地声音任务队列已满，请等待或取消已有任务");
    const now = Date.now();
    const entry: Entry = {
      input,
      job: {
        id: `job-panel-${crypto.randomUUID()}`,
        type: input.action === "setup" ? "tts-setup" : "tts-clone",
        status: "queued",
        attempt: 1,
        createdAt: now,
        updatedAt: now,
        progress: { message: "等待面板本地声音工具" },
      },
    };
    scope.entries = [entry, ...scope.entries];
    try {
      await save(scope);
    } catch (error) {
      scope.entries = scope.entries.filter((item) => item !== entry);
      throw error;
    }
    schedule(scope, entry);
    return structuredClone(entry.job);
  }
  const unsubscribeContext = raw.on("context.changed", () => {
    void raw.getContext().then(({ cwd }) => {
      for (const scope of scopes.values())
        if (scope.cwd !== cwd)
          for (const controller of scope.controllers.values()) controller.abort();
    });
  });
  const bridge: PanelBridge & { dispose(): void } = {
    getContext: () => raw.getContext(),
    registerTool: (name, handler) => raw.registerTool(name, handler),
    on(event, listener) {
      if (event !== "media.job.changed") return raw.on(event, listener);
      listeners.add(listener);
      const unsubscribe = raw.on(event, listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
    async call(method, params?: any): Promise<any> {
      if (method === "media.tts.voices") {
        const catalog = (await raw.call(method, params)) as VoiceCatalog;
        const local = await models();
        return {
          ...catalog,
          available: catalog.available || local.some((model) => model.available),
          models: [...(catalog.models ?? []).filter((model) => !engineId(model.id)), ...local],
        };
      }
      if (method === "media.status") {
        const status = (await raw.call(method, params)) as any;
        return {
          ...status,
          tts: {
            ...status.tts,
            available:
              status.tts?.available ||
              catalogCache?.models.some((model) => model.available) ||
              false,
          },
        };
      }
      if (method === "media.tts.providers") {
        const result = (await raw.call(method, params)) as any;
        return {
          ...result,
          providers: [
            ...(result.providers ?? []).filter((provider: any) => !engineId(provider.id)),
            ...(await models()),
          ],
        };
      }
      if (method === "media.tts.setup" && engineId(params?.providerId))
        return start(validateInput({ action: "setup", engine: params.providerId }));
      if (method === "media.tts" && engineId(params?.modelId)) {
        if (
          (params.voiceId !== undefined && params.voiceId !== "reference") ||
          (params.instructions !== undefined && params.instructions !== "") ||
          Object.keys(params).some(
            (key) =>
              ![
                "text",
                "modelId",
                "voiceId",
                "rate",
                "referenceAssetId",
                "referenceText",
                "instructions",
              ].includes(key),
          )
        )
          throw new Error("本人声音克隆参数无效");
        return start(validateInput({ ...params, action: "generate", engine: params.modelId }));
      }
      if (method === "media.jobs.list") {
        const result = (await raw.call(method, params)) as any;
        const scope = await scopeState();
        const jobs = [
          ...result.jobs,
          ...scope.entries.map((entry) => structuredClone(entry.job)),
        ].sort((a: MediaJob, b: MediaJob) => b.createdAt - a.createdAt);
        return { ...result, jobs: jobs.slice(0, Math.min(200, params?.limit ?? 50)) };
      }
      if (
        ["media.jobs.get", "media.jobs.cancel", "media.jobs.retry"].includes(method) &&
        localId(params?.id)
      ) {
        const scope = await scopeState();
        let entry = scope.entries.find((item) => item.job.id === params.id);
        if (!entry) {
          const archive = (await raw.call("media.document.get", {
            key: `${KEY}-${params.id}`,
          })) as any;
          if (archive?.data !== null && archive?.data !== undefined) {
            const found = restored(archive.data);
            if (found.length !== 1 || found[0]!.job.id !== params.id)
              throw new Error("声音任务历史记录无效");
            entry = scope.entries.find((item) => item.job.id === params.id) ?? found[0];
          }
        }
        if (!entry) throw new Error("当前项目没有这条本地声音任务");
        if (method === "media.jobs.cancel" && active(entry.job)) {
          scope.controllers.get(entry.job.id)?.abort();
          entry.job.status = "cancelled";
          entry.job.updatedAt = Date.now();
          await save(scope);
          emit(entry.job);
        }
        if (method === "media.jobs.retry") {
          if (!["failed", "cancelled"].includes(entry.job.status))
            throw new Error("只有失败或中断的本地声音任务可以重试");
          if (scope.controllers.has(entry.job.id))
            throw new Error("正在停止上一次任务，请稍后重试");
          const previous = structuredClone(entry.job);
          if (!scope.entries.some((item) => item.job.id === entry!.job.id))
            scope.entries.unshift(entry);
          entry.job.status = "queued";
          entry.job.attempt++;
          entry.job.updatedAt = Date.now();
          delete entry.job.error;
          delete entry.job.result;
          try {
            await save(scope);
          } catch (error) {
            entry.job = previous;
            throw error;
          }
          schedule(scope, entry);
        }
        return structuredClone(entry.job);
      }
      return raw.call(method, params);
    },
    dispose() {
      disposed = true;
      lifetime.abort();
      unsubscribeContext();
      for (const scope of scopes.values())
        for (const controller of scope.controllers.values()) controller.abort();
      processClient.dispose();
      listeners.clear();
    },
  };
  return bridge;
}
