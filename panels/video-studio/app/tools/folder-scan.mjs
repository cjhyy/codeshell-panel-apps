import { createRequire as __panelCreateRequire } from "node:module"; const require = __panelCreateRequire(import.meta.url);

// native/folder-scan.ts
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
var FOLDER_SCAN_LIMITS = Object.freeze({
  maxFiles: 1e3,
  maxEntries: 2e4,
  maxDirectories: 2e3,
  maxDepth: 16,
  maxOutputBytes: 192 * 1024
});
var types = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".m2v": "video/mpeg",
  ".mts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".ts": "video/mp2t",
  ".3gp": "video/3gpp",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".wave": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".wma": "audio/x-ms-wma",
  ".amr": "audio/amr",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif"
};
var ScanError = class extends Error {
};
var fail = (message) => {
  throw new ScanError(message);
};
var sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
var sameSnapshot = (a, b) => sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
async function scanFolder(root, options = {}) {
  try {
    const limits = { ...FOLDER_SCAN_LIMITS, ...options.limits };
    for (const key of Object.keys(limits)) {
      if (!(key in FOLDER_SCAN_LIMITS) || !Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > FOLDER_SCAN_LIMITS[key])
        fail("文件夹扫描限制无效。");
    }
    const checkCancelled = () => {
      if (options.signal?.aborted) fail("文件夹扫描已取消，未返回不完整的素材清单。");
    };
    checkCancelled();
    const requestedRoot = resolve(root);
    const initial = await lstat(requestedRoot, { bigint: true });
    if (!initial.isDirectory() || initial.isSymbolicLink())
      fail("请选择真实的素材文件夹，不能使用符号链接。");
    const canonicalRoot = await realpath(requestedRoot);
    const canonicalStat = await lstat(canonicalRoot, { bigint: true });
    if (!sameSnapshot(initial, canonicalStat)) fail("文件夹已发生变化，请重新扫描。");
    const observed = [];
    const result = { files: [], skipped: 0 };
    let entries = 0, directories = 0;
    let outputBytes = Buffer.byteLength('{"files":[],"skipped":20000}') + 1;
    const verifyRoot = async () => {
      checkCancelled();
      const now = await lstat(requestedRoot, { bigint: true });
      if (!sameSnapshot(initial, now) || now.isSymbolicLink() || await realpath(requestedRoot) !== canonicalRoot)
        fail("扫描期间文件夹已变化，请等待文件写入完成后重试。");
    };
    const verify = async (item) => {
      checkCancelled();
      const now = await lstat(item.absolute, { bigint: true });
      if (now.isSymbolicLink() || !sameSnapshot(item.snapshot, now) || await realpath(item.absolute) !== item.absolute)
        fail("扫描期间素材或目录已变化，请等待文件写入完成后重试。");
    };
    async function visit(absolute, relative, depth, ancestors) {
      await verifyRoot();
      for (const ancestor of ancestors) await verify(ancestor);
      if (++directories > limits.maxDirectories)
        fail("子文件夹数量超过扫描上限，请选择更小的素材文件夹。");
      if (depth > limits.maxDepth) fail("素材文件夹层级超过扫描上限，请选择更靠近素材的子文件夹。");
      const directory = { absolute, snapshot: await lstat(absolute, { bigint: true }) };
      if (!directory.snapshot.isDirectory() || directory.snapshot.isSymbolicLink())
        fail("扫描期间目录已被替换，请重新选择素材文件夹。");
      await verify(directory);
      observed.push(directory);
      const stream = await opendir(absolute);
      try {
        for await (const entry of stream) {
          checkCancelled();
          if (++entries > limits.maxEntries)
            fail("文件夹条目超过扫描上限，请选择更小的素材文件夹。");
          await verifyRoot();
          for (const ancestor of ancestors) await verify(ancestor);
          await verify(directory);
          const name = entry.name;
          if (name.startsWith(".") || name === "node_modules" || /[\\\x00-\x1f\x7f:]/.test(name) || /[. ]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) {
            result.skipped++;
            continue;
          }
          const path = relative ? `${relative}/${name}` : name;
          if (name.length > 240 || path.length > 1024 || path.split("/").length > 16)
            fail("素材相对路径超过保存上限，请选择更靠近素材的子文件夹或缩短文件名。");
          const child = join(absolute, name);
          const snapshot = await lstat(child, { bigint: true });
          if (snapshot.isSymbolicLink()) {
            result.skipped++;
            continue;
          }
          if (snapshot.isDirectory()) {
            await visit(child, path, depth + 1, [...ancestors, directory]);
          } else if (snapshot.isFile() && types[extname(name).toLowerCase()]) {
            if (snapshot.size === 0n) {
              result.skipped++;
              continue;
            }
            if (result.files.length >= limits.maxFiles)
              fail(`素材数量超过 ${limits.maxFiles} 个，请选择更小的素材文件夹。`);
            const item = { absolute: child, snapshot };
            await verify(item);
            const handle = await open(child, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            try {
              if (!sameSnapshot(snapshot, await handle.stat({ bigint: true })))
                fail("扫描期间素材已被替换，请重新扫描。");
            } finally {
              await handle.close();
            }
            await verify(item);
            const bytes = Number(snapshot.size), lastModified = Number(snapshot.mtimeNs / 1000000n);
            if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(lastModified) || lastModified < 0)
              fail("素材大小或修改时间无效，请检查原文件。");
            const file = {
              path,
              name,
              bytes,
              lastModified,
              mimeType: types[extname(name).toLowerCase()]
            };
            outputBytes += Buffer.byteLength(JSON.stringify(file)) + (result.files.length ? 1 : 0);
            if (outputBytes > limits.maxOutputBytes)
              fail("素材清单超过输出上限，请选择更小的素材文件夹。");
            result.files.push(file);
            observed.push(item);
          } else result.skipped++;
          options.onProgress?.({ entries, files: result.files.length });
        }
      } finally {
        await stream.close().catch((error) => {
          if (error.code !== "ERR_DIR_CLOSED") throw error;
        });
      }
      await verify(directory);
    }
    await visit(canonicalRoot, "", 0, []);
    for (const item of observed) await verify(item);
    await verifyRoot();
    result.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (Buffer.byteLength(JSON.stringify(result)) + 1 > limits.maxOutputBytes)
      fail("素材清单超过输出上限，请选择更小的素材文件夹。");
    return result;
  } catch (error) {
    if (error instanceof ScanError) throw error;
    throw new ScanError(
      "文件夹扫描失败：目录或素材无法读取、权限已变化或文件仍在写入。请检查后重新扫描。",
      { cause: error }
    );
  }
}
async function runFolderScanCli() {
  try {
    if (process.argv.length > 2) fail("文件夹扫描不接受额外路径或参数，请重新选择素材文件夹。");
    const result = await scanFolder(process.cwd());
    process.stdout.write(`${JSON.stringify(result)}
`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof ScanError ? error.message : "文件夹扫描失败，请重试。"}
`
    );
    process.exitCode = 1;
  }
}
var invokedEntry = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => void 0) : void 0;
if (invokedEntry && import.meta.url === pathToFileURL(invokedEntry).href) await runFolderScanCli();
export {
  FOLDER_SCAN_LIMITS,
  runFolderScanCli,
  scanFolder
};
