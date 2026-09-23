import {
  createPanelRuntime,
  runtimeCancelled,
  type RuntimeBridge,
  type RuntimeJob,
} from "../sdk/panel-runtime";
import { createEditorTaskBridge } from "./task-bridge";
import { isResourceId } from "../external-media";
import type { EditorAsset, JsonData } from "./types";
import { sameIdentity, type SessionIdentity } from "./session";

export interface EditorSourceInspection {
  resourceId: string;
  sha256: string;
  bytes: number;
  kind: "video" | "audio" | "image";
  /** Rounded once from rational source time to the 240000 tick clock; never via a video frame rate. */
  duration: number;
  width?: number;
  height?: number;
  mimeType: string;
  inspection: {
    schemaVersion: 1;
    format: string;
    timing: {
      origin: { numerator: string; denominator: string };
      duration: { numerator: string; denominator: string };
      tickRounding: "nearest";
      basis: "decoded-frames" | "decoded-frames-and-stream-duration" | "static-image";
      [key: string]: JsonData;
    };
    video?: { [key: string]: JsonData };
    audio?: { [key: string]: JsonData };
    compatibility: {
      preview: "native-proxy" | "prepared-audio" | "static-image" | "unsupported";
      export: "supported" | "unsupported";
      limitations: Array<{ code: string; message: string }>;
    };
  };
}
export interface EditorImportResource {
  id: string;
  name?: string;
  lastModified?: number;
}
export interface EditorImportProgress {
  index: number;
  total: number;
  name: string;
  phase: "upload" | "inspect";
  fraction?: number;
}
export interface EditorImportResult {
  assets: EditorAsset[];
  errors: Array<{ name: string; resourceId?: string; code?: string; message: string }>;
  identity: SessionIdentity;
}
export interface EditorImporterOptions {
  getIdentity(): SessionIdentity | null;
  onProgress?(value: EditorImportProgress): void;
  onJobChanged?(job: RuntimeJob): void;
}
const uploadMethods = [
  "resources.upload.begin",
  "resources.upload.write",
  "resources.upload.finish",
  "resources.upload.cancel",
];
const cleanName = (value: string) =>
  value.replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 240) || "素材";
const mime = (value: unknown) =>
  typeof value === "string" &&
  value.length <= 200 &&
  /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value);
const base64 = (bytes: Uint8Array) => {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
};
function resource(value: any) {
  const item = value?.asset ?? value;
  if (
    !item ||
    !isResourceId(item.id) ||
    !Number.isSafeInteger(item.bytes) ||
    item.bytes < 1 ||
    item.bytes > 20 * 1024 ** 3 ||
    !mime(item.mimeType) ||
    (item.id.startsWith("asset-") && item.sha256 !== item.id.slice(6)) ||
    (item.state && item.state !== "available")
  )
    throw new Error("素材资源尚未完整保存或原文件已变化");
  return {
    id: item.id,
    bytes: item.bytes,
    mimeType: item.mimeType,
    sha256: item.sha256,
    name: typeof item.name === "string" ? cleanName(item.name) : "素材",
  };
}

/** Persists raw files first. No browser media decoder and no legacy 30fps Asset are involved. */
export function createEditorMediaImporter(panel: RuntimeBridge, options: EditorImporterOptions) {
  const runtime = createPanelRuntime(panel),
    tasks = createEditorTaskBridge(panel);
  let disposed = false;
  const active = new Set<AbortController>();
  async function run(
    inputs: Array<File | EditorImportResource>,
    files: boolean,
    signal?: AbortSignal,
  ): Promise<EditorImportResult> {
    if (inputs.length > 1000) throw new Error("单次最多导入 1000 个素材，请分批选择");
    const currentIdentity = options.getIdentity();
    if (!currentIdentity) throw runtimeCancelled();
    const identity = structuredClone(currentIdentity),
      context = await panel.getContext(),
      cwd = context.cwd;
    const controller = new AbortController();
    active.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const check = () => {
      const now = options.getIdentity();
      if (
        disposed ||
        controller.signal.aborted ||
        !sameIdentity(now, identity, false)
      ) {
        controller.abort();
        throw runtimeCancelled();
      }
    };
    const guard = async () => {
      check();
      if (typeof cwd !== "string" || !cwd || (await panel.getContext()).cwd !== cwd) {
        controller.abort();
        throw runtimeCancelled();
      }
      check();
    };
    const result: EditorImportResult = { assets: [], errors: [], identity };
    try {
      await guard();
      await runtime.requireMethods(["resources.get", ...(files ? uploadMethods : [])]);
      for (let index = 0; index < inputs.length; index++) {
        await guard();
        const input = inputs[index]!;
        let id: string | undefined,
          sessionId: string | undefined,
          finished = false;
        let name = cleanName(input instanceof File ? input.name : (input.name ?? input.id));
        const progress = (phase: "upload" | "inspect", fraction?: number) => {
          check();
          options.onProgress?.({
            index,
            total: inputs.length,
            name,
            phase,
            ...(fraction === undefined ? {} : { fraction }),
          });
          check();
        };
        try {
          let uploaded: any;
          if (files) {
            const file = input as File;
            if (!Number.isSafeInteger(file.size) || file.size < 1)
              throw new Error("素材文件为空，无法导入");
            if (file.size > 20 * 1024 ** 3) throw new Error("素材超过当前 20GiB 资源大小限制");
            const mimeType = (file.type || "application/octet-stream")
              .split(";", 1)[0]!
              .toLowerCase();
            if (!mime(mimeType)) throw new Error("素材 MIME 类型无效");
            progress("upload", 0);
            const begin: any = await runtime.call(
              "resources.upload.begin",
              { name, mimeType, expectedBytes: file.size },
              controller.signal,
            );
            // Retain the issued ticket before identity checks so stale begins are cancelled.
            if (
              typeof begin?.sessionId === "string" &&
              /^upload-[a-f0-9-]{36}$/.test(begin.sessionId)
            )
              sessionId = begin.sessionId;
            await guard();
            if (
              !sessionId ||
              begin.state !== "uploading" ||
              begin.receivedBytes !== 0 ||
              begin.nextSequence !== 0 ||
              !Number.isSafeInteger(begin.maxChunkBytes) ||
              begin.maxChunkBytes < 1 ||
              !Number.isSafeInteger(begin.maxFileBytes) ||
              begin.maxFileBytes < file.size
            )
              throw new Error("素材上传会话无效");
            const chunkSize = Math.min(32 * 1024, begin.maxChunkBytes);
            let offset = 0,
              sequence = 0;
            while (offset < file.size) {
              check();
              const bytes = new Uint8Array(
                await file.slice(offset, offset + chunkSize).arrayBuffer(),
              );
              check();
              if (bytes.length !== Math.min(chunkSize, file.size - offset))
                throw new Error("素材原文件读取不完整");
              const written: any = await runtime.call(
                "resources.upload.write",
                { sessionId, sequence, offset, dataBase64: base64(bytes) },
                controller.signal,
              );
              check();
              if (
                written?.sessionId !== sessionId ||
                written.state !== "uploading" ||
                written.receivedBytes !== offset + bytes.length ||
                written.nextSequence !== sequence + 1
              )
                throw new Error("素材上传回执与真实字节不一致");
              offset += bytes.length;
              sequence++;
              progress("upload", (offset / file.size) * 0.95);
              await guard();
            }
            const receipt: any = await runtime.call(
              "resources.upload.finish",
              { sessionId },
              controller.signal,
            );
            uploaded = resource(receipt);
            finished = true;
            id = uploaded.id;
            await guard();
            if (uploaded.bytes !== file.size) throw new Error("持久素材大小与原文件不一致");
            progress("upload", 1);
          } else {
            id = (input as EditorImportResource).id;
            if (!isResourceId(id)) throw new Error("已授权素材资源编号无效");
          }
          const stored = resource(await runtime.call("resources.get", { id }, controller.signal));
          await guard();
          if (!files && !(input as EditorImportResource).name) name = stored.name;
          if (
            stored.id !== id ||
            (uploaded && (stored.bytes !== uploaded.bytes || stored.sha256 !== uploaded.sha256))
          )
            throw new Error("持久素材身份在分析前发生变化");
          progress("inspect");
          const inspected = await tasks.inspectSource(id!, {
            signal: controller.signal,
            onJobChanged: (job) => {
              check();
              options.onJobChanged?.(job);
              check();
            },
          });
          await guard();
          if (
            inspected.resourceId !== id ||
            inspected.bytes !== stored.bytes ||
            (stored.sha256 && stored.sha256 !== inspected.sha256)
          )
            throw new Error("原生分析与持久素材内容不一致");
          const asset: EditorAsset = {
            id: crypto.randomUUID(),
            resourceId: id!,
            name,
            kind: inspected.kind,
            duration: inspected.duration,
            ...(inspected.width === undefined
              ? {}
              : { width: inspected.width, height: inspected.height }),
            fingerprint: inspected.sha256,
            metadata: {
              mimeType: inspected.mimeType,
              sourceMimeType: stored.mimeType,
              size: stored.bytes,
              bytes: stored.bytes,
              lastModified: Math.max(0, Math.floor(Number(input.lastModified) || 0)),
              editorInspection: structuredClone(inspected.inspection) as unknown as JsonData,
            },
          };
          result.assets.push(asset);
          progress("inspect", 1);
        } catch (error) {
          if (sessionId && !finished)
            await runtime.call("resources.upload.cancel", { sessionId }).catch(() => {});
          if ((error as Error)?.name === "AbortError" || controller.signal.aborted)
            throw runtimeCancelled();
          result.errors.push({
            name,
            ...(id ? { resourceId: id } : {}),
            ...((error as any)?.code ? { code: String((error as any).code) } : {}),
            message: error instanceof Error ? error.message : "素材导入失败",
          });
        }
      }
      await guard();
      return result;
    } finally {
      signal?.removeEventListener("abort", abort);
      active.delete(controller);
      if (disposed && !active.size) {
        tasks.dispose();
        runtime.dispose();
      }
    }
  }
  return {
    importFiles(files: Iterable<File>, options: { signal?: AbortSignal } = {}) {
      return run([...files], true, options.signal);
    },
    importResources(
      resources: Iterable<EditorImportResource>,
      options: { signal?: AbortSignal } = {},
    ) {
      return run([...resources], false, options.signal);
    },
    dispose() {
      disposed = true;
      for (const controller of active) controller.abort();
      if (!active.size) {
        tasks.dispose();
        runtime.dispose();
      }
    },
  };
}
