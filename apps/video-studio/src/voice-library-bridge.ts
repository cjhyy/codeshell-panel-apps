import type { PanelBridge } from "./host";
import { cancelled, createVoiceProcessClient } from "./local-voice-process";
import { createPanelRuntime } from "./sdk/panel-runtime";
import { validVoiceRecipe, type LibraryVoiceRecipe } from "./voice-library";

type Audio = { sha256: string; bytes: number; mimeType: string };
type Entry = { schemaVersion: 1; recipe: LibraryVoiceRecipe; reference: Audio; sample: Audio };
export interface VoiceLibraryProgress {
  fraction: number;
  message: string;
}
interface Options {
  onProgress?(progress: VoiceLibraryProgress): void;
}
const MAX_AUDIO = 16 * 1024 * 1024;
const PARTS = ["reference", "sample"] as const;
const HEX = /^[a-f0-9]{64}$/;
const ASSET = /^(?:asset|external)-[a-f0-9]{64}$/;
const chunks = (value: string) => {
  const chars = Array.from(value),
    result: string[] = [];
  for (let i = 0; i < chars.length; i += 3000) result.push(chars.slice(i, i + 3000).join(""));
  return result;
};
function base64(data: Uint8Array) {
  let raw = "";
  for (const byte of data) raw += String.fromCharCode(byte);
  return btoa(raw);
}
function decode(value: unknown, maximum: number) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(maximum / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new Error("声音文件分块无效");
  const data = Uint8Array.from(atob(value), (item) => item.charCodeAt(0));
  if (!data.length || data.length > maximum || base64(data) !== value)
    throw new Error("声音文件分块不完整");
  return data;
}
function metadata(value: any): Audio {
  if (
    !value ||
    !HEX.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > MAX_AUDIO ||
    typeof value.mimeType !== "string" ||
    !/^audio\/[a-z0-9.+-]{1,80}$/.test(value.mimeType)
  )
    throw new Error("声音库只接受完整的音频文件，每段不超过 16 MB");
  return { sha256: value.sha256, bytes: value.bytes, mimeType: value.mimeType };
}
function entry(value: any): Entry {
  if (value?.schemaVersion !== 1 || !validVoiceRecipe(value.recipe, true))
    throw new Error("声音库记录无效，原记录已保留");
  return {
    schemaVersion: 1,
    recipe: structuredClone(value.recipe) as LibraryVoiceRecipe,
    reference: metadata(value.reference),
    sample: metadata(value.sample),
  };
}

/** Explicit saves publish app-wide copies; imports register them in the current Host workspace. */
export function createVoiceLibraryBridge(panel: PanelBridge, options: Options = {}) {
  const processClient = createVoiceProcessClient(panel);
  const runtime = createPanelRuntime(panel);
  const lifetime = new AbortController();
  const operations = new Map<AbortController, string | undefined>();
  let disposed = false;
  const unsubscribe = panel.on("context.changed", (payload) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      !Object.prototype.hasOwnProperty.call(payload, "cwd")
    )
      return;
    const cwd = (payload as { cwd?: unknown }).cwd;
    for (const [controller, previous] of operations)
      if (previous !== undefined && previous !== cwd) controller.abort();
  });
  let latestProgress: VoiceLibraryProgress = { fraction: 0, message: "正在连接本机声音库" };
  const progress = (fraction: number, message: string) => {
    latestProgress = { fraction, message };
    options.onProgress?.(latestProgress);
  };
  async function current(cwd: string, signal: AbortSignal) {
    if (disposed || signal.aborted || (await panel.getContext()).cwd !== cwd) throw cancelled();
  }
  async function invoke(request: object, signal: AbortSignal): Promise<any> {
    const waiting = setInterval(
      () =>
        options.onProgress?.({
          ...latestProgress,
          message: `${latestProgress.message}，仍在处理，请稍候`,
        }),
      3000,
    );
    let result;
    try {
      if (signal.aborted || disposed) throw cancelled();
      result = await processClient.runEntry(
        "voice-runtime",
        chunks(JSON.stringify({ action: "library", ...request })),
        signal,
      );
    } finally {
      clearInterval(waiting);
    }
    let value: any,
      found = false;
    for (const line of result.stdout.split("\n").filter((item) => item.trim())) {
      const event = JSON.parse(line);
      if (event.type === "error") throw new Error("声音库文件操作失败，原有声音已保留，请重试");
      if (event.type === "result") {
        if (found) throw new Error("声音库返回重复结果");
        found = true;
        value = event.result;
      }
    }
    if (result.code !== 0 || !found) throw new Error("声音库未完成操作，请重试");
    return value;
  }
  async function scoped<T>(
    operation: (cwd: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    operations.set(controller, undefined);
    try {
      const cwd = (await panel.getContext()).cwd;
      if (!cwd) throw new Error("请先打开一个视频工程");
      operations.set(controller, cwd);
      await current(cwd, controller.signal);
      const value = await operation(cwd, controller.signal);
      await current(cwd, controller.signal);
      return value;
    } finally {
      operations.delete(controller);
    }
  }
  async function sourceMeta(cwd: string, id: string, signal: AbortSignal) {
    if (!ASSET.test(id)) throw new Error("参考声音没有有效素材编号");
    await current(cwd, signal);
    const result: any = await runtime.call("media.assets.get", { id }, signal);
    await current(cwd, signal);
    if (result?.asset?.id !== id) throw new Error("声音素材已失效，请重新导入");
    return metadata(result.asset);
  }
  async function saveVoice(recipe: LibraryVoiceRecipe): Promise<LibraryVoiceRecipe> {
    if (!validVoiceRecipe(recipe, true)) throw new Error("声音配方不完整，请重新准备声音");
    const snapshot = structuredClone(recipe);
    return scoped(async (cwd, signal) => {
      progress(0, "正在保存声音到本机声音库");
      const reference = await sourceMeta(cwd, snapshot.referenceMediaId, signal);
      const sample = await sourceMeta(cwd, snapshot.sampleMediaId, signal);
      const saved: Entry = { schemaVersion: 1, recipe: snapshot, reference, sample };
      const token = crypto.randomUUID();
      let begun = false,
        committed = false,
        total = 0;
      try {
        await current(cwd, signal);
        await invoke({ operation: "begin", token, entry: saved }, signal);
        begun = true;
        for (const part of PARTS) {
          const meta = saved[part],
            id = part === "reference" ? snapshot.referenceMediaId : snapshot.sampleMediaId;
          let offset = 0;
          while (offset < meta.bytes) {
            await current(cwd, signal);
            const value: any = await runtime.call(
              "media.assets.read",
              { assetId: id, offset, length: 32768 },
              signal,
            );
            await current(cwd, signal);
            const data = decode(value?.dataBase64, 32768);
            if (
              value.assetId !== id ||
              value.offset !== offset ||
              value.totalBytes !== meta.bytes ||
              value.mimeType !== meta.mimeType ||
              offset + data.length > meta.bytes ||
              value.eof !== (offset + data.length === meta.bytes)
            )
              throw new Error("原始声音文件在保存时发生变化，请重试");
            const written = await invoke(
              { operation: "write", token, part, offset, dataBase64: value.dataBase64 },
              signal,
            );
            await current(cwd, signal);
            if (written?.offset !== offset + data.length) throw new Error("声音库文件写入不完整");
            offset += data.length;
            total += data.length;
            progress(
              (0.95 * total) / (reference.bytes + sample.bytes),
              `正在保存${part === "reference" ? "参考录音" : "试听音频"}`,
            );
          }
        }
        await current(cwd, signal);
        const result = await invoke({ operation: "commit", token }, signal);
        committed = true;
        if (
          !validVoiceRecipe(result, true) ||
          Object.keys(snapshot).some(
            (key) =>
              (result as unknown as Record<string, unknown>)[key] !==
              snapshot[key as keyof LibraryVoiceRecipe],
          )
        )
          throw new Error("声音库保存结果无效");
        progress(1, "已保存到本机声音库");
        return result as LibraryVoiceRecipe;
      } finally {
        if (begun && !committed && !disposed)
          await invoke({ operation: "cancel", token }, lifetime.signal).catch(() => {});
      }
    });
  }
  async function listVoices(): Promise<LibraryVoiceRecipe[]> {
    progress(0, "正在读取本机声音库");
    const result = await invoke({ operation: "list" }, lifetime.signal);
    if (
      !Array.isArray(result) ||
      result.length > 20 ||
      result.some((value) => !validVoiceRecipe(value, true)) ||
      new Set(result.map((v) => v.id)).size !== result.length
    )
      throw new Error("声音库无法恢复，原记录已保留");
    progress(1, result.length ? `已读取 ${result.length} 个本机声音` : "本机声音库已就绪");
    return structuredClone(result) as LibraryVoiceRecipe[];
  }
  async function importVoice(recipeId: string) {
    return scoped(async (cwd, signal) => {
      progress(0, "正在将声音导入当前工程");
      const saved = entry(await invoke({ operation: "get", id: recipeId }, signal));
      if (saved.recipe.id !== recipeId) throw new Error("声音库编号不匹配");
      const context = await runtime.discover(true);
      await current(cwd, signal);
      const prefix = ["begin", "write", "finish", "cancel"].every((method) =>
        context.availableMethods?.includes(`resources.upload.${method}`),
      )
        ? "resources.upload"
        : "media.recording";
      const ids: string[] = [];
      let total = 0;
      for (const part of PARTS) {
        const meta = saved[part];
        await current(cwd, signal);
        const upload: any = await runtime.call(
          `${prefix}.begin`,
          {
            name: part === "reference" ? saved.recipe.referenceName : `${saved.recipe.name}试听`,
            mimeType: meta.mimeType,
            expectedBytes: meta.bytes,
          },
          signal,
        );
        const sessionId = typeof upload?.sessionId === "string" ? upload.sessionId : undefined;
        let finished = false;
        try {
          await current(cwd, signal);
          if (!sessionId || !Number.isSafeInteger(upload.maxChunkBytes) || upload.maxChunkBytes < 1)
            throw new Error("声音素材保存通道无效");
          let offset = 0,
            sequence = 0;
          const digestParts: Uint8Array[] = [];
          while (offset < meta.bytes) {
            await current(cwd, signal);
            const chunk = await invoke({ operation: "read", id: recipeId, part, offset }, signal);
            await current(cwd, signal);
            const data = decode(chunk?.dataBase64, 512 * 1024);
            if (
              chunk.offset !== offset ||
              chunk.bytes !== meta.bytes ||
              chunk.sha256 !== meta.sha256 ||
              chunk.mimeType !== meta.mimeType ||
              offset + data.length > meta.bytes ||
              chunk.eof !== (offset + data.length === meta.bytes)
            )
              throw new Error("声音库音频校验失败");
            digestParts.push(data);
            const max = Math.min(32768, upload.maxChunkBytes);
            for (let at = 0; at < data.length; at += max) {
              await current(cwd, signal);
              const bytes = data.subarray(at, at + max);
              const written: any = await runtime.call(
                `${prefix}.write`,
                { sessionId, sequence, offset: offset + at, dataBase64: base64(bytes) },
                signal,
              );
              await current(cwd, signal);
              if (
                written?.sessionId !== sessionId ||
                written.receivedBytes !== offset + at + bytes.length ||
                written.nextSequence !== sequence + 1
              )
                throw new Error("声音素材上传结果不完整");
              sequence++;
              total += bytes.length;
              progress(
                (0.95 * total) / (saved.reference.bytes + saved.sample.bytes),
                `正在导入${part === "reference" ? "参考录音" : "试听音频"}`,
              );
            }
            offset += data.length;
          }
          const all = new Uint8Array(meta.bytes);
          let at = 0;
          for (const data of digestParts) {
            all.set(data, at);
            at += data.length;
          }
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", all)), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
          if (hash !== meta.sha256) throw new Error("导入的声音文件校验失败");
          await current(cwd, signal);
          const result: any = await runtime.call(`${prefix}.finish`, { sessionId }, signal);
          finished = true;
          await current(cwd, signal);
          const asset = result?.asset;
          if (
            asset?.id !== `asset-${meta.sha256}` ||
            asset.sha256 !== meta.sha256 ||
            asset.bytes !== meta.bytes ||
            !asset.mimeType?.startsWith("audio/")
          )
            throw new Error("声音素材保存后校验失败");
          ids.push(asset.id);
        } finally {
          // A session handle belongs to its original scope. Never submit it after rebinding.
          if (!finished && sessionId && !disposed && (await panel.getContext()).cwd === cwd)
            await runtime.call(`${prefix}.cancel`, { sessionId }).catch(() => {});
        }
      }
      progress(1, "声音已导入当前工程");
      return {
        referenceMediaId: ids[0]!,
        sampleMediaId: ids[1]!,
        durationSeconds: saved.recipe.referenceDurationSeconds,
      };
    });
  }
  return {
    listVoices,
    saveVoice,
    importVoice,
    dispose() {
      disposed = true;
      lifetime.abort();
      operations.forEach((_cwd, controller) => controller.abort());
      unsubscribe();
      processClient.dispose();
      runtime.dispose();
    },
  };
}
