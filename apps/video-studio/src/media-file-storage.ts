import type { PanelBridge } from "./host";
import type { Asset } from "./model";
import { cacheMediaFile } from "./recording-cache";
import { createPanelRuntime } from "./sdk/panel-runtime";

const UPLOAD_METHODS = [
  "resources.upload.begin",
  "resources.upload.write",
  "resources.upload.finish",
  "resources.upload.cancel",
];
const SESSION_ID = /^upload-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MIME_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const CHUNK_BYTES = 32 * 1024;

function cancelled(): Error {
  return Object.assign(new Error("工程已切换，素材未加入当前工程"), { name: "AbortError" });
}
function base64(bytes: Uint8Array): string {
  // Each input is bounded to 32 KiB; avoid spreading the entire source file.
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Save source bytes before publishing project metadata; desktop storage needs no media engine. */
export async function persistMediaFile(
  bridge: PanelBridge | undefined,
  file: File,
  asset: Asset,
  options: { isCurrent?: () => boolean; progress?: (fraction: number) => void } = {},
): Promise<Asset> {
  const current = () => {
    if (options.isCurrent && !options.isCurrent()) throw cancelled();
  };
  const progress = (fraction: number) => {
    current();
    options.progress?.(fraction);
    current();
  };
  current();
  if (!Number.isSafeInteger(file.size) || file.size < 1)
    throw new Error("素材文件为空，无法保存。请重新选择完整原文件。");
  const snapshot = structuredClone(asset);
  const metadata = {
    ...snapshot,
    size: file.size,
    lastModified: snapshot.lastModified ?? file.lastModified,
  };
  progress(0);
  if (!bridge) {
    await cacheMediaFile(snapshot.id, file);
    current();
    progress(1);
    return metadata;
  }

  const runtime = createPanelRuntime(bridge);
  let sessionId: string | undefined;
  try {
    const context = await runtime.discover();
    current();
    if (
      !Array.isArray(context.availableMethods) ||
      UPLOAD_METHODS.some((method) => !context.availableMethods.includes(method))
    )
      throw Object.assign(
        new Error("当前面板没有素材持久保存权限或上传接口。请检查面板的资源权限后重新导入。"),
        { code: "RESOURCE_UPLOAD_UNAVAILABLE" },
      );
    const mimeType = (file.type || snapshot.mimeType || "application/octet-stream")
      .split(";", 1)[0]!
      .trim()
      .toLowerCase();
    if (mimeType.length > 200 || !MIME_TYPE.test(mimeType)) throw new Error("素材文件类型无效");
    const begin: any = await runtime.call("resources.upload.begin", {
      name: file.name.replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 240) || "素材",
      mimeType,
      expectedBytes: file.size,
    });
    // Capture the authorized session before checking identity so a stale begin is cancelled.
    if (typeof begin?.sessionId === "string" && SESSION_ID.test(begin.sessionId))
      sessionId = begin.sessionId;
    current();
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
      throw new Error("素材上传会话或文件大小限制无效");
    const chunkBytes = Math.min(CHUNK_BYTES, begin.maxChunkBytes);
    let offset = 0;
    let sequence = 0;
    while (offset < file.size) {
      current();
      const bytes = new Uint8Array(await file.slice(offset, offset + chunkBytes).arrayBuffer());
      current();
      if (bytes.length !== Math.min(chunkBytes, file.size - offset))
        throw new Error("素材原文件读取不完整");
      const written: any = await runtime.call("resources.upload.write", {
        sessionId,
        sequence,
        offset,
        dataBase64: base64(bytes),
      });
      current();
      if (
        written?.sessionId !== sessionId ||
        written.state !== "uploading" ||
        written.receivedBytes !== offset + bytes.length ||
        written.nextSequence !== sequence + 1
      )
        throw new Error("素材上传进度与已保存字节不一致");
      offset += bytes.length;
      sequence += 1;
      // Leave the final portion for Host integrity verification and durable capture.
      progress((offset / file.size) * 0.95);
    }
    current();
    const finished: any = await runtime.call("resources.upload.finish", { sessionId });
    current();
    const stored = finished?.asset;
    if (
      !stored ||
      typeof stored.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(stored.sha256) ||
      stored.id !== `asset-${stored.sha256}` ||
      stored.bytes !== file.size ||
      typeof stored.mimeType !== "string" ||
      stored.mimeType.length > 200 ||
      !MIME_TYPE.test(stored.mimeType)
    )
      throw new Error("素材保存结果未通过文件身份与大小检查");
    progress(1);
    return { ...metadata, mediaId: stored.id, mimeType: stored.mimeType };
  } catch (error) {
    if (sessionId) await runtime.call("resources.upload.cancel", { sessionId }).catch(() => {});
    if ((error as Error)?.name === "AbortError") throw error;
    if ((error as { code?: string })?.code === "RESOURCE_UPLOAD_UNAVAILABLE") throw error;
    throw new Error(
      "素材持久保存失败，尚未加入工程。请检查资源权限、可用空间后重新导入，并保留原文件。",
      {
        cause: error,
      },
    );
  } finally {
    runtime.dispose();
  }
}
