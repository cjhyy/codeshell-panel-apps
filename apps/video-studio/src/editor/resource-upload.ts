import { createPanelRuntime, runtimeCancelled } from "../sdk/panel-runtime";
import { isResourceId } from "../external-media";
export interface UploadedEditorResource {
  id: string;
  bytes: number;
  sha256: string;
  mimeType: string;
}
/** Uploads one File without buffering the whole source, and always releases unfinished tickets. */
export async function uploadEditorResource(
  runtime: ReturnType<typeof createPanelRuntime>,
  file: File,
  options: {
    signal: AbortSignal;
    mimeType: string;
    guard(): void | Promise<void>;
    onProgress?(fraction: number): void;
  },
): Promise<UploadedEditorResource> {
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 20 * 1024 ** 3)
    throw new Error("工程包为空或超过当前 20GiB 大小限制");
  const check = async () => {
    if (options.signal.aborted) throw runtimeCancelled();
    await options.guard();
    if (options.signal.aborted) throw runtimeCancelled();
  };
  await runtime.requireMethods([
    "resources.upload.begin",
    "resources.upload.write",
    "resources.upload.finish",
    "resources.upload.cancel",
    "resources.get",
  ]);
  await check();
  let sessionId: string | undefined,
    finished = false;
  try {
    const begin: any = await runtime.call(
      "resources.upload.begin",
      {
        name: file.name.replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 240) || "工程包.mimiproject",
        mimeType: options.mimeType,
        expectedBytes: file.size,
      },
      options.signal,
    );
    if (typeof begin?.sessionId === "string" && /^upload-[a-f0-9-]{36}$/.test(begin.sessionId))
      sessionId = begin.sessionId;
    await check();
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
      throw new Error("工程包上传会话无效");
    const chunkSize = Math.min(32768, begin.maxChunkBytes);
    for (let offset = 0, sequence = 0; offset < file.size; sequence++) {
      await check();
      const length = Math.min(chunkSize, file.size - offset),
        data = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
      await check();
      if (data.length !== length) throw new Error("工程包文件读取不完整");
      let binary = "";
      for (const byte of data) binary += String.fromCharCode(byte);
      const written: any = await runtime.call(
        "resources.upload.write",
        { sessionId, sequence, offset, dataBase64: btoa(binary) },
        options.signal,
      );
      await check();
      if (
        written?.sessionId !== sessionId ||
        written.state !== "uploading" ||
        written.receivedBytes !== offset + length ||
        written.nextSequence !== sequence + 1
      )
        throw new Error("工程包上传回执与原始字节不一致");
      offset += length;
      options.onProgress?.(offset / file.size);
    }
    const response: any = await runtime.call(
        "resources.upload.finish",
        { sessionId },
        options.signal,
      ),
      item = response?.asset ?? response;
    if (
      !item ||
      !isResourceId(item.id) ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      (item.id.startsWith("asset-") && item.id !== `asset-${item.sha256}`) ||
      item.bytes !== file.size ||
      item.mimeType !== options.mimeType
    )
      throw new Error("工程包尚未完整保存");
    finished = true;
    await check();
    const responseStored: any = await runtime.call(
        "resources.get",
        { id: item.id },
        options.signal,
      ),
      stored = responseStored?.asset ?? responseStored;
    await check();
    if (
      stored?.id !== item.id ||
      stored.bytes !== item.bytes ||
      stored.sha256 !== item.sha256 ||
      stored.mimeType !== item.mimeType ||
      (stored.state && stored.state !== "available")
    )
      throw new Error("保存后的工程包资源已变化");
    return { id: item.id, bytes: item.bytes, sha256: item.sha256, mimeType: item.mimeType };
  } finally {
    if (sessionId && !finished)
      await runtime.call("resources.upload.cancel", { sessionId }).catch(() => {});
  }
}
