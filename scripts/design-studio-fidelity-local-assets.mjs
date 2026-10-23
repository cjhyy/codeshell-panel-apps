import { lstat, opendir, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { createHash } from "node:crypto";

const MAX_FILES = 2048;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 12 * 1024 * 1024;
const MIMES = new Map(
  Object.entries({
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
  }),
);

export function safeFidelityFixturePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 512 &&
    !/[\\:?#\u0000-\u001f\u007f]/u.test(path) &&
    !path.startsWith("/") &&
    path
      .split("/")
      .every(
        (part) =>
          part &&
          !part.startsWith(".") &&
          !/[. ]$/u.test(part) &&
          part.toLowerCase() !== "node_modules" &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  );
}

/** Snapshot only an explicitly selected local folder; comparisons never fetch. */
export async function loadFidelityLocalFixture(directory, sourcePath = "source.html") {
  if (!safeFidelityFixturePath(sourcePath) || !/\.html?$/iu.test(sourcePath))
    throw new Error("Fixture source must be a safe relative HTML path");
  const selected = resolve(directory);
  if ((await lstat(selected)).isSymbolicLink())
    throw new Error("Fixture directory cannot be a symlink");
  const root = await realpath(selected);
  if (!(await lstat(root)).isDirectory()) throw new Error("Fixture directory must be a directory");
  const files = new Map();
  let sourceBytes = 0,
    assetBytes = 0,
    directories = 0;
  const walk = async (folder, prefix = "") => {
    if (++directories > MAX_FILES) throw new Error("Fixture exceeds 2048 selected directories");
    for await (const entry of await opendir(folder)) {
      const path = prefix + entry.name;
      if (!safeFidelityFixturePath(path)) throw new Error(`Unsafe fixture path: ${path}`);
      const absolute = join(folder, entry.name),
        stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Fixture symlink is not allowed: ${path}`);
      if (stat.isDirectory()) {
        await walk(absolute, `${path}/`);
        continue;
      }
      if (!stat.isFile()) throw new Error(`Fixture entry is not a regular file: ${path}`);
      if (files.size >= MAX_FILES) throw new Error("Fixture exceeds 2048 selected files");
      const text = /\.(?:html?|css)$/iu.test(path);
      if ((!text && stat.size < 1) || stat.size > (text ? MAX_SOURCE_BYTES : MAX_ASSET_BYTES))
        throw new Error(
          `Fixture ${text ? "source exceeds 512 KiB" : "asset exceeds 8 MiB or is empty"}: ${path}`,
        );
      if (text) sourceBytes += stat.size;
      else assetBytes += stat.size;
      if (sourceBytes > MAX_SOURCE_BYTES)
        throw new Error("Fixture HTML/CSS exceeds 512 KiB combined");
      if (assetBytes > MAX_TOTAL_ASSET_BYTES)
        throw new Error("Fixture assets exceed 12 MiB combined");
      const canonical = await realpath(absolute);
      if (relative(root, canonical).startsWith(`..${sep}`) || canonical === root)
        throw new Error(`Fixture path escapes selected directory: ${path}`);
      const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes;
      try {
        const actual = await handle.stat();
        if (
          !actual.isFile() ||
          actual.dev !== stat.dev ||
          actual.ino !== stat.ino ||
          actual.size !== stat.size
        )
          throw new Error(`Fixture changed during snapshot: ${path}`);
        bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          const result = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (!result.bytesRead) throw new Error(`Fixture changed during snapshot: ${path}`);
          offset += result.bytesRead;
        }
        const after = await handle.stat();
        if (
          after.size !== actual.size ||
          after.mtimeMs !== actual.mtimeMs ||
          after.ctimeMs !== actual.ctimeMs
        )
          throw new Error(`Fixture changed during snapshot: ${path}`);
      } finally {
        await handle.close();
      }
      const extension = path.split(".").at(-1).toLowerCase();
      files.set(path, { bytes, mime: MIMES.get(extension) ?? "application/octet-stream", text });
    }
  };
  await walk(root);
  const get = (path) => {
    if (!safeFidelityFixturePath(path) || !files.has(path))
      throw new Error(`Fixture file unavailable: ${path}`);
    return files.get(path);
  };
  const readText = async (path) => {
    const file = get(path);
    if (!file.text) throw new Error(`Fixture is not HTML/CSS text: ${path}`);
    return new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  };
  return {
    sourcePath,
    html: await readText(sourcePath),
    readText,
    readAsset: async (path) => ({ base64: get(path).bytes.toString("base64") }),
    resource: get,
    manifest: [...files]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, file]) => ({
        path,
        mime: file.mime,
        bytes: file.bytes.length,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
      })),
  };
}
