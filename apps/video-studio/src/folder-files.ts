const types: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  mts: "video/mp2t",
  m2ts: "video/mp2t",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
};
/** Confirm duplicates from actual bytes, with bounded memory even for multi-gigabyte clips. */
export async function sameFileContents(
  left: File,
  right: File,
  current: () => boolean = () => true,
): Promise<boolean> {
  if (left.size !== right.size) return false;
  const chunkBytes = 1024 * 1024;
  for (let offset = 0; offset < left.size; offset += chunkBytes) {
    if (!current()) throw new Error("工程已切换，已停止检查旧素材");
    const [a, b] = await Promise.all([
      left.slice(offset, offset + chunkBytes).arrayBuffer(),
      right.slice(offset, offset + chunkBytes).arrayBuffer(),
    ]);
    if (!current()) throw new Error("工程已切换，已停止检查旧素材");
    const bytesA = new Uint8Array(a),
      bytesB = new Uint8Array(b);
    if (bytesA.length !== bytesB.length) return false;
    for (let index = 0; index < bytesA.length; index++)
      if (bytesA[index] !== bytesB[index]) return false;
  }
  return true;
}
/** File input grants one snapshot only; selecting a folder does not establish a watcher. */
export function prepareFolderFiles(files: File[]): { files: File[]; skipped: number } {
  const selected: File[] = [];
  let skipped = 0;
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const parts = path.split("/");
    if (
      !path ||
      path.length > 1024 ||
      /[\\:\x00-\x1f\x7f]/.test(path) ||
      parts.some((p) => !p || p === "." || p === ".." || p.length > 240)
    )
      throw new Error("素材文件夹包含无效相对路径");
    const mimeType = types[file.name.split(".").pop()!.toLowerCase()];
    if (
      parts.some((p) => p.startsWith(".") || p === "node_modules") ||
      !mimeType ||
      file.size === 0
    ) {
      skipped++;
      continue;
    }
    const normalized = new File([file], file.name, {
      type: mimeType,
      lastModified: file.lastModified,
    });
    Object.defineProperty(normalized, "webkitRelativePath", { value: path });
    selected.push(normalized);
    if (selected.length > 1000) throw new Error("一次最多导入 1000 个素材，请选择较小的文件夹");
  }
  return {
    files: selected.sort((a, b) =>
      a.webkitRelativePath < b.webkitRelativePath
        ? -1
        : a.webkitRelativePath > b.webkitRelativePath
          ? 1
          : 0,
    ),
    skipped,
  };
}
