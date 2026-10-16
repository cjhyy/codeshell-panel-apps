import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { link, lstat, mkdir, open, realpath, rename, rm, rmdir, unlink } from "node:fs/promises";

export const PROJECT_FILE = "video-studio-cli.json";
export const DOCUMENT_BYTES = 32 * 1024 * 1024;
export const REQUEST_BYTES = 256 * 1024;
export const OUTPUT_BYTES = 64 * 1024;
export const cliError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });
export const contentRevision = (bytes: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Explicit CLI inputs may be outside the project; they are never Host resource paths. */
export async function readJsonFile(
  path: string,
  limit: number,
): Promise<{ data: unknown; content: string }> {
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit)
      throw cliError("INPUT_LIMIT", `JSON 输入须为最多 ${limit} 字节的普通文件`);
    const bytes = Buffer.alloc(Math.min(info.size + 1, limit + 1));
    let count = 0;
    while (count < bytes.length) {
      const { bytesRead } = await file.read(bytes, count, bytes.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    const after = await file.stat();
    if (
      count !== info.size ||
      count > limit ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs
    )
      throw cliError("INPUT_CHANGED", "JSON 文件在读取时变化，请重新读取");
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count));
      return { data: JSON.parse(content), content };
    } catch {
      throw cliError("INVALID_INPUT", "文件不是有效 JSON");
    }
  } finally {
    await file.close();
  }
}

/** One independent project slot. Lock ownership and CAS protect concurrent CLI commands. */
export async function createProjectStore(project: string) {
  const supplied = resolve(project),
    suppliedInfo = await lstat(supplied);
  if (!suppliedInfo.isDirectory() || suppliedInfo.isSymbolicLink())
    throw cliError("UNSAFE_PATH", "CLI 项目须为真实目录，不能是符号链接");
  const root = await realpath(supplied),
    identity = await lstat(root);
  const checkRoot = async () => {
    const current = await lstat(root);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino ||
      (await realpath(root)) !== root
    )
      throw cliError("UNSAFE_PATH", "CLI 项目目录已改变");
  };
  const pathFor = async (path: string, createParents = false) => {
    await checkRoot();
    if (
      typeof path !== "string" ||
      !path ||
      path.length > 512 ||
      isAbsolute(path) ||
      /[\\\x00:]/u.test(path)
    )
      throw cliError("UNSAFE_PATH", "输出须为项目内的相对路径");
    const parts = path.split("/");
    if (parts.some((part) => !part || part.startsWith(".")))
      throw cliError("UNSAFE_PATH", "不允许隐藏路径、空路径或越界路径");
    let current = root;
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (createParents && index < parts.length - 1) {
          await mkdir(current, { mode: 0o700 }).catch(async (failure) => {
            if (failure.code !== "EEXIST") throw failure;
          });
          info = await lstat(current);
        }
      }
      if (info?.isSymbolicLink() || (info && index < parts.length - 1 && !info.isDirectory()))
        throw cliError("UNSAFE_PATH", "项目文件路径包含符号链接或无效父目录");
    }
    await checkRoot();
    return current;
  };
  const read = async () => {
    const path = await pathFor(PROJECT_FILE);
    try {
      const file = await readJsonFile(path, DOCUMENT_BYTES);
      return { ...file, revision: contentRevision(file.content) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return null;
    }
  };
  const lock = join(root, ".video-studio-cli-write.lock");
  const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const deadline = Date.now() + 5000;
    let owned;
    for (;;) {
      await checkRoot();
      try {
        await mkdir(lock, { mode: 0o700 });
        owned = await lstat(lock);
        if (!owned.isDirectory() || owned.isSymbolicLink())
          throw cliError("UNSAFE_PATH", "CLI 写入锁无效");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() >= deadline)
          throw cliError("PROJECT_BUSY", "另一个 CLI 正在写入；请确认写入者状态后重试");
        await new Promise((done) => setTimeout(done, 25));
      }
    }
    let result: T | undefined, failed: unknown, release: unknown;
    try {
      await checkRoot();
      result = await operation();
    } catch (error) {
      failed = error;
    }
    try {
      await checkRoot();
      const current = await lstat(lock);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        current.dev !== owned.dev ||
        current.ino !== owned.ino
      )
        throw cliError("UNSAFE_PATH", "CLI 写入锁所有者已改变，保留该锁");
      await rmdir(lock);
    } catch (error) {
      release = error;
    }
    if (failed && release) throw new AggregateError([failed, release], "操作与写入锁释放均未完成");
    if (failed) throw failed;
    if (release) throw release;
    return result!;
  };
  const publish = async (
    path: string,
    content: string,
    expected: string | null,
    replace: boolean,
  ) => {
    if (Buffer.byteLength(content) > DOCUMENT_BYTES)
      throw cliError("INPUT_LIMIT", "工程超过 32 MiB");
    const destination = await pathFor(path, true),
      parent = dirname(destination),
      parentIdentity = await lstat(parent);
    const check = async () => {
      await pathFor(path);
      const info = await lstat(parent);
      if (info.dev !== parentIdentity.dev || info.ino !== parentIdentity.ino)
        throw cliError("UNSAFE_PATH", "输出父目录已改变");
      if (replace && ((await read())?.revision ?? null) !== expected)
        throw cliError("REVISION_CONFLICT", "工程已变化，请重新读取并重新规划");
    };
    const temporary = join(parent, `.video-studio-${randomUUID()}.tmp`);
    let ownedTemporary = false;
    try {
      const file = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      ownedTemporary = true;
      try {
        await file.writeFile(content, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await check();
      if (replace && expected !== null) await rename(temporary, destination);
      else {
        try {
          await link(temporary, destination);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST")
            throw cliError("REVISION_CONFLICT", "输出已存在，保留原文件");
          throw error;
        }
        await unlink(temporary);
      }
      return { path, revision: contentRevision(content), bytes: Buffer.byteLength(content) };
    } finally {
      if (ownedTemporary) await rm(temporary, { force: true });
    }
  };
  return {
    root,
    read,
    withLock,
    write: (data: unknown, expected: string | null) =>
      publish(PROJECT_FILE, `${JSON.stringify(data)}\n`, expected, true),
    export: (path: string, data: unknown) => {
      if (path === PROJECT_FILE) throw cliError("INVALID_INPUT", "导出路径不能覆盖 CLI 工程文件");
      return publish(path, `${JSON.stringify(data, null, 2)}\n`, null, false);
    },
  };
}
