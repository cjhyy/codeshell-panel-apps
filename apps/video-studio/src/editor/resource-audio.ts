import { createPanelRuntime, type RuntimeBridge } from "../sdk/panel-runtime";
import type { PreviewAudio } from "./preview";

export interface PreparedAudioResource {
  id: string;
  bytes: number;
  mimeType: string;
  sha256: string;
}
export interface FloatWaveHeader {
  dataOffset: number;
  sampleCount: number;
  dataBytes: number;
}
const BUFFER_LIMIT = 32 * 1024 * 1024;
const FILE_LIMIT = 64 * 1024 ** 3;
const CHUNK = 32768;
const abort = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("声音预览准备已取消", "AbortError");
};

/** Inspect only the format emitted by the shared native mixer. No resampling or normalization occurs. */
export function readFloatWaveHeader(bytes: Uint8Array, totalBytes: number): FloatWaveHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  const rf64 = tag(0) === "RF64";
  if (
    bytes.length < 12 ||
    (!rf64 && tag(0) !== "RIFF") ||
    tag(8) !== "WAVE" ||
    (rf64 ? view.getUint32(4, true) !== 0xffffffff : view.getUint32(4, true) + 8 !== totalBytes)
  )
    throw new Error("声音预览不是完整的 WAV 文件");
  let large: { dataBytes: number; samples: number } | undefined;
  let format = false;
  for (let at = 12; at + 8 <= bytes.length; ) {
    let length = view.getUint32(at + 4, true);
    const start = at + 8;
    // EBU Tech 3306 §3 / Annex A.2. The shared FFmpeg renderer emits a single
    // data chunk with an empty ds64 table; no sample-rate conversion is involved.
    if (rf64 && at === 12) {
      if (tag(at) !== "ds64" || length !== 28 || start + length > bytes.length)
        throw new Error("RF64 声音预览缺少完整的长度声明");
      const riffSize = Number(view.getBigUint64(start, true)),
        dataBytes = Number(view.getBigUint64(start + 8, true)),
        samples = Number(view.getBigUint64(start + 16, true));
      if (
        ![riffSize, dataBytes, samples].every(Number.isSafeInteger) ||
        riffSize + 8 !== totalBytes ||
        dataBytes < 8 ||
        dataBytes % 8 ||
        samples !== dataBytes / 8 ||
        view.getUint32(start + 24, true) !== 0
      )
        throw new Error("RF64 声音预览的长度或采样数量无效");
      large = { dataBytes, samples };
    } else if (tag(at) === "ds64") throw new Error("声音预览包含重复或错位的 RF64 长度声明");
    if (length === 0xffffffff) {
      if (tag(at) !== "data" || !large) throw new Error("声音预览区块长度无效");
      length = large.dataBytes;
    }
    if (start + length > totalBytes) throw new Error("声音预览区块超出文件范围");
    if (tag(at) === "data") {
      if (
        !format ||
        !length ||
        length % 8 ||
        (large && (length !== large.dataBytes || length / 8 !== large.samples))
      )
        throw new Error("声音预览的采样格式无效");
      return { dataOffset: start, sampleCount: length / 8, dataBytes: length };
    }
    if (start + length > bytes.length) throw new Error("声音预览文件头超过读取范围");
    if (tag(at) === "fmt ") {
      if (format || length < 16) throw new Error("声音预览格式区块无效");
      let codec = view.getUint16(start, true);
      if (codec === 65534) {
        const floatGuid = [3, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];
        if (
          length < 40 ||
          view.getUint16(start + 16, true) < 22 ||
          view.getUint16(start + 18, true) !== 32 ||
          !floatGuid.every((value, index) => bytes[start + 24 + index] === value)
        )
          throw new Error("声音预览的扩展采样格式无效");
        codec = 3;
      }
      if (
        codec !== 3 ||
        view.getUint16(start + 2, true) !== 2 ||
        view.getUint32(start + 4, true) !== 48000 ||
        view.getUint32(start + 8, true) !== 384000 ||
        view.getUint16(start + 12, true) !== 8 ||
        view.getUint16(start + 14, true) !== 32
      )
        throw new Error("声音预览需要 48 kHz 双声道浮点 PCM");
      format = true;
    }
    at = start + length + (length % 2);
  }
  throw new Error("声音预览缺少采样区块");
}

/** Short mixes use a buffer; long mixes retain only a range reader and the WAV header.
 * Both paths read the exact float samples emitted by the shared native renderer. */
export async function loadEditorPreviewAudio(
  bridge: RuntimeBridge,
  resource: PreparedAudioResource,
  identity: { documentId: string; revision: number; sequenceId: string; sampleCount: number },
  signal: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<PreviewAudio> {
  if (
    !/^asset-[a-f0-9]{64}$/.test(resource.id) ||
    resource.id !== `asset-${resource.sha256}` ||
    !Number.isSafeInteger(resource.bytes) ||
    resource.bytes < 44 ||
    resource.bytes > FILE_LIMIT
  )
    throw new Error("声音预览文件无效或超过当前 WAV 文件范围");
  const runtime = createPanelRuntime(bridge);
  let streamed = false;
  try {
    await runtime.requireMethods(["resources.read"]);
    const read = async (
      offset: number,
      length: number,
      readSignal = signal,
    ): Promise<Uint8Array> => {
      abort(readSignal);
      const part: any = await runtime.call(
        "resources.read",
        { assetId: resource.id, offset, length },
        readSignal,
      );
      abort(readSignal);
      if (
        part?.assetId !== resource.id ||
        part.offset !== offset ||
        part.totalBytes !== resource.bytes ||
        typeof part.dataBase64 !== "string" ||
        part.dataBase64.length > Math.ceil(length / 3) * 4 ||
        typeof part.eof !== "boolean"
      )
        throw new Error("声音预览资源身份或读取范围已变化");
      let decoded: string;
      try {
        decoded = atob(part.dataBase64);
      } catch {
        throw new Error("声音预览资源数据损坏");
      }
      if (
        decoded.length !== Math.min(length, resource.bytes - offset) ||
        part.eof !== (offset + decoded.length === resource.bytes)
      )
        throw new Error("声音预览资源读取不完整");
      return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    };
    const header = readFloatWaveHeader(
      await read(0, Math.min(CHUNK, resource.bytes)),
      resource.bytes,
    );
    if (
      header.sampleCount !== identity.sampleCount ||
      !Number.isSafeInteger(identity.sampleCount) ||
      identity.sampleCount < 1
    )
      throw new Error("声音预览时长与当前序列不一致");
    if (resource.bytes > BUFFER_LIMIT) {
      let disposed = false;
      const reads = new Set<AbortController>();
      streamed = true;
      onProgress?.(1);
      return {
        documentId: identity.documentId,
        revision: identity.revision,
        sequenceId: identity.sequenceId,
        stream: {
          sampleRate: 48000,
          numberOfChannels: 2,
          sampleCount: header.sampleCount,
          async read(start, count, signal) {
            if (disposed || signal.aborted) throw new DOMException("声音预览已关闭", "AbortError");
            if (
              !Number.isSafeInteger(start) ||
              start < 0 ||
              !Number.isSafeInteger(count) ||
              count < 1 ||
              count > 192000 ||
              start + count > header.sampleCount
            )
              throw new Error("声音分段读取范围无效");
            const controller = new AbortController(),
              cancel = () => controller.abort();
            reads.add(controller);
            signal.addEventListener("abort", cancel, { once: true });
            try {
              const left = new Float32Array(count),
                right = new Float32Array(count);
              for (let at = 0; at < count * 8; ) {
                const bytes = await read(
                  header.dataOffset + start * 8 + at,
                  Math.min(CHUNK, count * 8 - at),
                  controller.signal,
                );
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                for (let index = 0; index < bytes.length; index += 8) {
                  const l = view.getFloat32(index, true),
                    r = view.getFloat32(index + 4, true);
                  if (!Number.isFinite(l) || !Number.isFinite(r))
                    throw new Error("声音预览包含无效采样");
                  left[(at + index) / 8] = l;
                  right[(at + index) / 8] = r;
                }
                at += bytes.length;
              }
              abort(controller.signal);
              return [left, right];
            } finally {
              signal.removeEventListener("abort", cancel);
              reads.delete(controller);
            }
          },
          dispose() {
            if (disposed) return;
            disposed = true;
            for (const controller of reads) controller.abort();
            runtime.dispose();
          },
        },
      };
    }
    const buffer = new AudioBuffer({
      numberOfChannels: 2,
      sampleRate: 48000,
      length: header.sampleCount,
    });
    const left = buffer.getChannelData(0),
      right = buffer.getChannelData(1);
    for (let at = 0; at < header.dataBytes; ) {
      const bytes = await read(header.dataOffset + at, Math.min(CHUNK, header.dataBytes - at));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let index = 0; index < bytes.length; index += 8) {
        const l = view.getFloat32(index, true),
          r = view.getFloat32(index + 4, true);
        if (!Number.isFinite(l) || !Number.isFinite(r)) throw new Error("声音预览包含无效采样");
        left[(at + index) / 8] = l;
        right[(at + index) / 8] = r;
      }
      at += bytes.length;
      onProgress?.(at / header.dataBytes);
    }
    abort(signal);
    return {
      documentId: identity.documentId,
      revision: identity.revision,
      sequenceId: identity.sequenceId,
      buffer,
    };
  } finally {
    if (!streamed) runtime.dispose();
  }
}
