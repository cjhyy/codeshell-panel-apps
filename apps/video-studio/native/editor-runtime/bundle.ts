/*! Bundled ZIP dependencies: yauzl / yazl (Copyright (c) 2014 Josh Wolfe),
 * buffer-crc32 (Copyright (c) 2013-2024 Brian J. Brennan), and pend / fd-slicer
 * (Copyright (c) 2014 Andrew Kelley). MIT License:
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import {
  constants,
  createWriteStream,
  open as openFd,
  close as closeFd,
  fstat as statFd,
} from "node:fs";
import { link, lstat, open, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { EventEmitter } from "node:events";
// Upstream JS packages do not ship declarations. Keep this small boundary typed below.
// @ts-expect-error -- pinned JS dependency; static import is bundled into the native entry.
import * as yauzl from "yauzl";
// @ts-expect-error -- pinned JS dependency; static import is bundled into the native entry.
import * as yazl from "yazl";
import type { EditorAsset, EditorDocument } from "../../src/editor/types.js";
import { validateEditorDocument } from "../../src/editor/validation.js";
import {
  MAX_PORTABLE_MEDIA,
  PORTABLE_PROJECT_FORMAT,
  PORTABLE_PROJECT_VERSION,
  PortableProjectError,
  portableMediaPath,
  validatePortableProjectManifest,
  type PortableMedia,
  type PortableProjectManifest,
} from "../../src/editor/portable-project.js";
import { directory, regular, sealed } from "./files.js";

export interface PortableBundleLimits {
  maxManifestBytes: number;
  maxMedia: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxArchiveBytes: number;
  maxCompressionRatio: number;
}
/** Operational limits, not integer limits of the open ZIP64 format. Callers can lower them. */
export const PORTABLE_BUNDLE_LIMITS: Readonly<PortableBundleLimits> = Object.freeze({
  maxManifestBytes: 32 * 1024 ** 2,
  maxMedia: MAX_PORTABLE_MEDIA,
  maxFileBytes: 20 * 1024 ** 3,
  maxTotalBytes: 20 * 1024 ** 3,
  maxArchiveBytes: 20 * 1024 ** 3,
  maxCompressionRatio: 1000,
});
export interface PortableBundleProgress {
  phase: "checking" | "packing" | "unpacking";
  completed: number;
  total: number;
  bytes: number;
}
interface CommonOptions {
  /** Sealed Host task directory; output/extraction paths must remain inside this directory. */
  workDir: string;
  /** Host-supplied allowlist, never read from a request or archive manifest. */
  sourceRoots: readonly string[];
  signal: AbortSignal;
  limits?: Partial<PortableBundleLimits>;
  onProgress?: (progress: PortableBundleProgress) => void;
}
export interface ExportPortableProjectOptions extends CommonOptions {
  document: unknown;
  outputPath: string;
  resolveAsset: (
    asset: EditorAsset,
    signal: AbortSignal,
  ) => Promise<{ path: string; sha256?: string; bytes?: number }>;
}
export interface VerifiedPortableMedia extends PortableMedia {
  path: string;
}
export interface ImportedPortableProject {
  manifest: PortableProjectManifest;
  document: EditorDocument;
  /** Caller owns this directory and removes it after Host publication, or on cancellation. */
  directory: string;
  media: VerifiedPortableMedia[];
}
interface ZipEntry {
  fileName: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  generalPurposeBitFlag: number;
  externalFileAttributes: number;
  relativeOffsetOfLocalHeader: number;
  crc32: number;
}
interface ZipReader extends EventEmitter {
  entryCount: number;
  readEntryCursor: number;
  eachEntry(): AsyncIterable<ZipEntry>;
  openReadStreamPromise(entry: ZipEntry): Promise<Readable>;
  readLocalFileHeaderPromise(
    entry: ZipEntry,
    options: { minimal: false },
  ): Promise<{
    fileName: Buffer;
    compressionMethod: number;
    generalPurposeBitFlag: number;
    fileDataStart: number;
  }>;
  close(): void;
}
interface ZipWriter extends EventEmitter {
  outputStream: Readable;
  addBuffer(bytes: Buffer, name: string, options: object): void;
  addReadStreamLazy(
    name: string,
    options: object,
    callback: (provide: (error: Error | null, stream?: Readable) => void) => void,
  ): void;
  end(): void;
}
const readerApi = yauzl as { fromFdPromise(fd: number, options: object): Promise<ZipReader> };
const writerApi = yazl as { ZipFile: new () => ZipWriter };
const fail = (code: string, message: string): never => {
  throw new PortableProjectError(code, message);
};
function abort(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("工程包任务已取消", "AbortError");
}
function limitsFor(value: Partial<PortableBundleLimits> = {}): PortableBundleLimits {
  for (const key of Object.keys(value))
    if (!(key in PORTABLE_BUNDLE_LIMITS)) fail("INVALID_LIMIT", `未知工程包限制：${key}`);
  const result = { ...PORTABLE_BUNDLE_LIMITS, ...value };
  for (const key of Object.keys(result) as Array<keyof PortableBundleLimits>)
    if (
      !Number.isSafeInteger(result[key]) ||
      result[key] < 1 ||
      result[key] > PORTABLE_BUNDLE_LIMITS[key]
    )
      fail("INVALID_LIMIT", `工程包限制无效：${key}`);
  return result;
}
async function rootsFor(options: CommonOptions): Promise<{ root: string; roots: string[] }> {
  abort(options.signal);
  if (!options.sourceRoots.length || options.sourceRoots.length > 16)
    fail("INVALID_DIRECTORY", "必须提供 Host 材料目录白名单");
  return {
    root: await sealed(options.workDir),
    roots: await Promise.all(options.sourceRoots.map(sealed)),
  };
}
async function sourcePath(path: string, roots: string[]): Promise<string> {
  if (!isAbsolute(path)) fail("INVALID_FILE", "材料路径必须由 Host 物化");
  for (const root of roots) {
    const part = relative(root, path);
    if (part && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`))
      return regular(root, part.split(sep));
  }
  return fail("INVALID_FILE", "材料路径不在 Host 授权目录中");
}
async function outputPath(path: string, root: string): Promise<string> {
  if (!isAbsolute(path)) fail("INVALID_FILE", "输出路径必须位于任务目录");
  const part = relative(root, path);
  if (!part || isAbsolute(part) || part === ".." || part.startsWith(`..${sep}`))
    fail("INVALID_FILE", "输出路径不在任务目录内");
  const parts = part.split(sep),
    name = parts.pop()!;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) fail("INVALID_FILE", "输出文件名无效");
  const parent = await directory(root, parts),
    target = join(parent, name);
  try {
    await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return target;
    throw error;
  }
  return fail("OUTPUT_EXISTS", "工程包输出文件已经存在");
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let n = index;
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crcUpdate(crc: number, bytes: Buffer): number {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return crc;
}
async function inspectFile(
  path: string,
  maximum: number,
  signal: AbortSignal,
): Promise<{ sha256: string; bytes: number }> {
  abort(signal);
  const hash = createHash("sha256");
  let bytes = 0;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const stream = handle.createReadStream({ highWaterMark: 128 * 1024 });
  const stop = () => stream.destroy(new DOMException("工程包任务已取消", "AbortError"));
  signal.addEventListener("abort", stop, { once: true });
  try {
    for await (const chunk of stream) {
      abort(signal);
      bytes += chunk.length;
      if (bytes > maximum) fail("LIMIT_EXCEEDED", "原始素材超过工程包单文件限制");
      hash.update(chunk);
    }
    if (!bytes) fail("INVALID_MEDIA", "原始素材为空文件");
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    stream.destroy();
    await handle.close();
    signal.removeEventListener("abort", stop);
  }
}

/** Preflights every original before creating a ZIP. No incomplete bundle is published. */
export async function exportPortableProject(options: ExportPortableProjectOptions): Promise<{
  manifest: PortableProjectManifest;
  path: string;
  bytes: number;
  sha256: string;
}> {
  const document = validateEditorDocument(options.document),
    limits = limitsFor(options.limits);
  if (document.assets.length > limits.maxMedia)
    fail("LIMIT_EXCEEDED", "工程素材数量超过工程包限制");
  const { root, roots } = await rootsFor(options),
    target = await outputPath(options.outputPath, root);
  const originals = document.assets.filter((asset) => asset.kind !== "demo");
  const blobs = new Map<string, VerifiedPortableMedia>(),
    issues: Array<{ assetId: string; message: string }> = [];
  let total = 0,
    checked = 0;
  for (const asset of originals) {
    abort(options.signal);
    try {
      const source = await options.resolveAsset(structuredClone(asset), options.signal);
      abort(options.signal);
      const path = await sourcePath(source.path, roots),
        actual = await inspectFile(path, limits.maxFileBytes, options.signal);
      if (
        (source.bytes !== undefined && source.bytes !== actual.bytes) ||
        (source.sha256 !== undefined && source.sha256 !== actual.sha256) ||
        (asset.fingerprint && asset.fingerprint !== actual.sha256)
      )
        fail("HASH_MISMATCH", "原始素材已变化或摘要不符");
      const previous = blobs.get(actual.sha256);
      if (previous) previous.assetIds.push(asset.id);
      else {
        total += actual.bytes;
        blobs.set(actual.sha256, { ...actual, path, assetIds: [asset.id] });
      }
    } catch (error) {
      abort(options.signal);
      issues.push({
        assetId: asset.id,
        message: `${asset.name}：${error instanceof Error ? error.message : String(error)}`,
      });
    }
    options.onProgress?.({
      phase: "checking",
      completed: ++checked,
      total: originals.length,
      bytes: total,
    });
    if (total > limits.maxTotalBytes) fail("LIMIT_EXCEEDED", "工程素材总大小超过工程包限制");
  }
  if (issues.length)
    throw new PortableProjectError("MISSING_MEDIA", "原始素材不可用，未生成工程包", issues);
  if (total > limits.maxTotalBytes) fail("LIMIT_EXCEEDED", "工程素材总大小超过工程包限制");
  const files = [...blobs.values()].sort((a, b) => a.sha256.localeCompare(b.sha256));
  const manifest = validatePortableProjectManifest({
    format: PORTABLE_PROJECT_FORMAT,
    formatVersion: PORTABLE_PROJECT_VERSION,
    document,
    media: files.map(({ path: _, ...item }) => item),
  });
  const json = Buffer.from(JSON.stringify(manifest));
  if (json.length > limits.maxManifestBytes || total + json.length > limits.maxTotalBytes)
    fail("LIMIT_EXCEEDED", "工程清单或展开后总大小超过工程包限制");
  const scratch = join(dirname(target), `bundle-${randomUUID()}.partial`),
    zip = new writerApi.ZipFile();
  const active = new Set<Readable>();
  const stopStreams = (error?: Error) => {
    for (const stream of active) stream.destroy(error);
  };
  const zipError = (error: Error) => {
    zip.outputStream.destroy(error);
    stopStreams(error);
  };
  zip.on("error", zipError);
  const stop = () => zipError(new DOMException("工程包任务已取消", "AbortError"));
  options.signal.addEventListener("abort", stop, { once: true });
  let completed = 0,
    packed = 0,
    archiveBytes = 0;
  const output = createWriteStream(scratch, { flags: "wx", mode: 0o600 });
  try {
    const counter = new Transform({
      transform(chunk, _encoding, done) {
        archiveBytes += chunk.length;
        if (archiveBytes > limits.maxArchiveBytes)
          done(new PortableProjectError("LIMIT_EXCEEDED", "工程包超过输出大小限制"));
        else done(null, chunk);
      },
    });
    const finished = pipeline(zip.outputStream, counter, output, { signal: options.signal });
    // Attach the rejection handler before lazy stream setup can fail.
    void finished.catch(() => {});
    const entryOptions = {
      compress: false,
      mtime: new Date("2000-01-01T00:00:00Z"),
      mode: 0o100600,
      forceDosTimestamp: true,
    };
    zip.addBuffer(json, "manifest.json", entryOptions);
    for (const file of files)
      zip.addReadStreamLazy(
        portableMediaPath(file.sha256),
        { ...entryOptions, size: file.bytes },
        (provide) => {
          void (async () => {
            abort(options.signal);
            const path = await sourcePath(file.path, roots),
              hash = createHash("sha256");
            let size = 0;
            const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            const source = handle.createReadStream({ highWaterMark: 128 * 1024 });
            const verify = new Transform({
              transform(chunk, _encoding, done) {
                size += chunk.length;
                if (size > file.bytes)
                  done(new PortableProjectError("HASH_MISMATCH", "打包期间原始素材大小发生变化"));
                else {
                  hash.update(chunk);
                  done(null, chunk);
                }
              },
              flush(done) {
                if (size !== file.bytes || hash.digest("hex") !== file.sha256)
                  done(new PortableProjectError("HASH_MISMATCH", "打包期间原始素材发生变化"));
                else {
                  try {
                    packed += size;
                    options.onProgress?.({
                      phase: "packing",
                      completed: ++completed,
                      total: files.length,
                      bytes: packed,
                    });
                    done();
                  } catch (error) {
                    done(error as Error);
                  }
                }
              },
            });
            active.add(source);
            active.add(verify);
            for (const stream of [source, verify]) {
              stream.on("error", zipError);
              stream.once("close", () => active.delete(stream));
            }
            source.pipe(verify);
            provide(null, verify);
          })().catch((error) => {
            provide(error);
            zipError(error);
          });
        },
      );
    zip.end();
    await finished;
    abort(options.signal);
    const persisted = await open(scratch, constants.O_RDWR | constants.O_NOFOLLOW);
    try {
      await persisted.sync();
    } finally {
      await persisted.close();
    }
    const actual = await inspectFile(scratch, limits.maxArchiveBytes, options.signal);
    abort(options.signal);
    // Atomic, exclusive publication. An existing user file is never overwritten.
    await link(scratch, target);
    return { manifest, path: target, ...actual };
  } finally {
    options.signal.removeEventListener("abort", stop);
    stopStreams();
    zip.outputStream.destroy();
    await new Promise<void>((resolve) => {
      if (output.closed) resolve();
      else {
        output.once("close", resolve);
        output.destroy();
      }
    });
    await rm(scratch, { force: true });
  }
}

async function readEntry(
  zip: ZipReader,
  entry: ZipEntry,
  signal: AbortSignal,
  consume: (chunk: Buffer) => Promise<void>,
): Promise<void> {
  abort(signal);
  const stream = await zip.openReadStreamPromise(entry);
  let bytes = 0,
    crc = 0xffffffff;
  const stop = () => stream.destroy(new DOMException("工程包任务已取消", "AbortError"));
  signal.addEventListener("abort", stop, { once: true });
  try {
    for await (const chunk of stream) {
      abort(signal);
      bytes += chunk.length;
      if (bytes > entry.uncompressedSize) fail("INVALID_ZIP", "ZIP 实际解压大小超过清单");
      crc = crcUpdate(crc, chunk);
      await consume(chunk);
    }
    if (bytes !== entry.uncompressedSize || (crc ^ 0xffffffff) >>> 0 !== entry.crc32)
      fail("INVALID_ZIP", "ZIP 内容大小或 CRC 校验失败");
  } finally {
    stream.destroy();
    signal.removeEventListener("abort", stop);
  }
}

/** Reads no paths from JSON. All extracted files use verified SHA-derived names in a new directory. */
export async function importPortableProject(
  options: CommonOptions & { inputPath: string },
): Promise<ImportedPortableProject> {
  const limits = limitsFor(options.limits),
    { root, roots } = await rootsFor(options);
  const input = await sourcePath(options.inputPath, roots);
  const fd = await new Promise<number>((resolve, reject) =>
    openFd(input, constants.O_RDONLY | constants.O_NOFOLLOW, (error, fd) =>
      error ? reject(error) : resolve(fd),
    ),
  );
  let zip: ZipReader | undefined,
    extraction: string | undefined,
    succeeded = false;
  try {
    const inputInfo = await new Promise<import("node:fs").Stats>((resolve, reject) =>
      statFd(fd, (error, info) => (error ? reject(error) : resolve(info))),
    );
    if (!inputInfo.isFile()) fail("INVALID_FILE", "工程包必须是普通文件");
    if (inputInfo.size > limits.maxArchiveBytes) fail("LIMIT_EXCEEDED", "工程包文件超过大小限制");
    zip = await readerApi.fromFdPromise(fd, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      decodeStrings: true,
      validateEntrySizes: true,
    });
    // Keep a listener after lazy iteration; close/read failures must not become unhandled events.
    let readerError: Error | undefined;
    zip.on("error", (error) => {
      readerError = error;
    });
    const centralStart = zip.readEntryCursor;
    if (zip.entryCount > limits.maxMedia + 1) fail("LIMIT_EXCEEDED", "ZIP 条目数量超过限制");
    const entries = new Map<string, ZipEntry>(),
      ranges: Array<[number, number]> = [];
    let expanded = 0;
    for await (const entry of zip.eachEntry()) {
      abort(options.signal);
      if (entries.size >= limits.maxMedia + 1) fail("LIMIT_EXCEEDED", "ZIP 条目数量超过限制");
      if (entry.fileName !== "manifest.json" && !/^media\/[a-f0-9]{64}$/.test(entry.fileName))
        fail("INVALID_ZIP", `ZIP 包含不支持的路径：${entry.fileName}`);
      if (entries.has(entry.fileName)) fail("INVALID_ZIP", `ZIP 路径重复：${entry.fileName}`);
      const type = (entry.externalFileAttributes >>> 16) & 0xf000;
      if ((type !== 0 && type !== 0x8000) || entry.externalFileAttributes & 0x10)
        fail("INVALID_ZIP", "ZIP 只能包含普通文件，不能包含符号链接或目录");
      if (entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod))
        fail("INVALID_ZIP", "不支持加密或此压缩方式的 ZIP");
      const maximum =
        entry.fileName === "manifest.json" ? limits.maxManifestBytes : limits.maxFileBytes;
      if (
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize < 1 ||
        entry.uncompressedSize > maximum ||
        !Number.isSafeInteger(entry.compressedSize) ||
        entry.compressedSize < 1 ||
        entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio
      )
        fail("LIMIT_EXCEEDED", "ZIP 文件大小或压缩比超过限制");
      expanded += entry.uncompressedSize;
      if (expanded > limits.maxTotalBytes) fail("LIMIT_EXCEEDED", "ZIP 展开后总大小超过限制");
      const local = await zip.readLocalFileHeaderPromise(entry, { minimal: false });
      if (
        !local.fileName.equals(Buffer.from(entry.fileName)) ||
        local.compressionMethod !== entry.compressionMethod ||
        local.generalPurposeBitFlag !== entry.generalPurposeBitFlag
      )
        fail("INVALID_ZIP", "ZIP 本地头与目录记录不一致");
      const end = local.fileDataStart + entry.compressedSize;
      if (!Number.isSafeInteger(end) || entry.relativeOffsetOfLocalHeader < 0 || end > centralStart)
        fail("INVALID_ZIP", "ZIP 文件数据边界无效");
      ranges.push([entry.relativeOffsetOfLocalHeader, end]);
      entries.set(entry.fileName, entry);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    if (ranges.some((range, index) => index > 0 && range[0] < ranges[index - 1]![1]))
      fail("INVALID_ZIP", "ZIP 文件内容区间重叠");
    const manifestEntry = entries.get("manifest.json");
    if (!manifestEntry) fail("INVALID_BUNDLE", "ZIP 缺少根 manifest.json");
    const chunks: Buffer[] = [];
    await readEntry(zip, manifestEntry!, options.signal, async (chunk) => {
      chunks.push(chunk);
    });
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      fail("INVALID_BUNDLE", "工程包清单不是有效的 UTF-8 JSON");
    }
    const manifest = validatePortableProjectManifest(raw);
    const missing = manifest.media.filter((item) => !entries.has(portableMediaPath(item.sha256)));
    if (missing.length)
      throw new PortableProjectError(
        "MISSING_MEDIA",
        "工程包缺少素材文件",
        missing.map((item) => ({
          sha256: item.sha256,
          message: `缺少 ${portableMediaPath(item.sha256)}`,
        })),
      );
    if (entries.size !== manifest.media.length + 1)
      fail("INVALID_BUNDLE", "ZIP 含有清单未引用的素材");
    for (const item of manifest.media)
      if (entries.get(portableMediaPath(item.sha256))!.uncompressedSize !== item.bytes)
        fail("HASH_MISMATCH", "素材大小与工程清单不符");
    extraction = await directory(root, [`bundle-import-${randomUUID()}`]);
    const mediaRoot = await directory(extraction, ["media"]),
      media: VerifiedPortableMedia[] = [];
    let extracted = 0;
    for (const item of manifest.media) {
      abort(options.signal);
      const path = join(mediaRoot, item.sha256),
        output = await open(path, "wx", 0o600),
        hash = createHash("sha256");
      try {
        await readEntry(
          zip,
          entries.get(portableMediaPath(item.sha256))!,
          options.signal,
          async (chunk) => {
            hash.update(chunk);
            // FileHandle.write may complete partially; writeFile handles the entire bounded chunk.
            await output.writeFile(chunk);
          },
        );
        if (hash.digest("hex") !== item.sha256)
          fail("HASH_MISMATCH", `素材 SHA-256 校验失败：${item.sha256}`);
        await output.sync();
      } finally {
        await output.close();
      }
      media.push({ ...item, assetIds: [...item.assetIds], path });
      extracted += item.bytes;
      options.onProgress?.({
        phase: "unpacking",
        completed: media.length,
        total: manifest.media.length,
        bytes: extracted,
      });
    }
    abort(options.signal);
    if (readerError) throw readerError;
    succeeded = true;
    return { manifest, document: structuredClone(manifest.document), directory: extraction, media };
  } catch (error) {
    if (
      error instanceof PortableProjectError ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw error;
    throw new PortableProjectError(
      "INVALID_ZIP",
      `工程包读取失败：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (zip)
      await new Promise<void>((resolve) => {
        zip!.once("close", resolve);
        zip!.close();
      });
    else await new Promise<void>((resolve) => closeFd(fd, () => resolve()));
    if (!succeeded && extraction) await rm(extraction, { recursive: true, force: true });
  }
}
