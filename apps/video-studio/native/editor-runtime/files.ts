import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, relative, sep } from "node:path";
import { EditorTaskError } from "./protocol.js";
import { mediaAbortError } from "../process-runner.js";

export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const bytesHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function abort(signal: AbortSignal): void {
  if (signal.aborted) throw mediaAbortError();
}
export async function sealed(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new EditorTaskError("INVALID_DIRECTORY", "任务目录不是授权的普通目录");
  return realpath(path);
}
export async function directory(root: string, parts: string[]): Promise<string> {
  let path = root;
  for (const part of parts) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part === "." || part === "..")
      throw new EditorTaskError("INVALID_DIRECTORY", "任务子目录无效");
    path = join(path, part);
    await mkdir(path, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(path)) !== path)
      throw new EditorTaskError("INVALID_DIRECTORY", "任务子目录已变化");
  }
  return path;
}
export async function regular(root: string, parts: string[]): Promise<string> {
  let path = root;
  for (const part of parts) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part === "." || part === "..")
      throw new EditorTaskError("INVALID_FILE", "任务文件名无效");
    path = join(path, part);
    if ((await lstat(path)).isSymbolicLink())
      throw new EditorTaskError("INVALID_FILE", "任务材料不能使用符号链接");
  }
  const canonical = await realpath(path);
  if (!canonical.startsWith(root + sep) || !(await stat(canonical)).isFile())
    throw new EditorTaskError("INVALID_FILE", "任务材料不在授权目录内");
  return canonical;
}
export async function fileHash(path: string, signal: AbortSignal): Promise<string> {
  abort(signal);
  const hash = createHash("sha256"),
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)),
    stream = file.createReadStream();
  const stop = () => stream.destroy(mediaAbortError());
  signal.addEventListener("abort", stop, { once: true });
  try {
    for await (const data of stream) {
      abort(signal);
      hash.update(data);
    }
    return hash.digest("hex");
  } finally {
    stream.destroy();
    await file.close();
    signal.removeEventListener("abort", stop);
  }
}
export async function readBytes(root: string, parts: string[], maximum: number): Promise<Buffer> {
  const path = await regular(root, parts),
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if ((await file.stat()).size > maximum)
      throw new EditorTaskError("LIMIT_EXCEEDED", "保存的任务数据超过大小限制");
    return await file.readFile();
  } finally {
    await file.close();
  }
}
export async function readPrefix(root: string, parts: string[], length = 32): Promise<Buffer> {
  const path = await regular(root, parts),
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const result = Buffer.alloc(length),
      { bytesRead } = await file.read(result, 0, length, 0);
    return result.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}
export async function json(root: string, parts: string[], maximum = 65536): Promise<any> {
  return JSON.parse((await readBytes(root, parts, maximum)).toString("utf8"));
}
export async function optionalJson(
  root: string,
  parts: string[],
  maximum?: number,
): Promise<any | undefined> {
  try {
    return await json(root, parts, maximum);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function atomic(path: string, bytes: Uint8Array): Promise<void> {
  const scratch = `${path}.${randomUUID()}.tmp`,
    file = await open(scratch, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(scratch, path);
  } finally {
    await rm(scratch, { force: true });
  }
}
export interface EditorArtifact {
  file: string;
  role: string;
  name: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  assetId: string;
}
export async function publish(
  root: string,
  path: string,
  extension: string,
  mimeType: string,
  role: string,
  signal: AbortSignal,
): Promise<EditorArtifact> {
  abort(signal);
  const sha256 = await fileHash(path, signal),
    bytes = (await stat(path)).size;
  if (bytes < 1 || bytes > 20 * 1024 ** 3)
    throw new EditorTaskError("LIMIT_EXCEEDED", "输出文件超过当前资源接口的 20GiB 限制");
  const outputs = await directory(root, ["outputs"]),
    target = join(outputs, `${sha256}.${extension}`);
  if (path !== target)
    await copyFile(path, target, constants.COPYFILE_EXCL).catch(async (error) => {
      if (
        error.code !== "EEXIST" ||
        (await fileHash(await regular(outputs, [`${sha256}.${extension}`]), signal)) !== sha256
      )
        throw error;
    });
  return {
    file: relative(root, target).split(sep).join("/"),
    role,
    name: `${role}.${extension}`,
    mimeType,
    bytes,
    sha256,
    assetId: `asset-${sha256}`,
  };
}
