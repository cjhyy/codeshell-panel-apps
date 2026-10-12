import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const failure = (code, message) => Object.assign(new Error(message), { code });
const revision = (content) => createHash("sha256").update(content).digest("hex");

export async function createNodeWorkspaceScope(projectRoot) {
  const suppliedRoot = resolve(projectRoot);
  if (lstatSync(suppliedRoot).isSymbolicLink())
    throw failure("UNSAFE_PATH", "项目目录不能是符号链接");
  const root = realpathSync(suppliedRoot);
  const rootIdentity = lstatSync(root);
  if (!rootIdentity.isDirectory()) throw failure("UNSAFE_PATH", "项目路径必须是目录");

  const check = () => {
    const current = lstatSync(root);
    if (
      current.isSymbolicLink() ||
      realpathSync(root) !== root ||
      current.dev !== rootIdentity.dev ||
      current.ino !== rootIdentity.ino
    ) {
      throw failure("UNSAFE_PATH", "项目目录已改变");
    }
  };
  const pathFor = (path, { allowRoot = false, createParents = false } = {}) => {
    check();
    if (allowRoot && path === ".") return root;
    if (typeof path !== "string" || !path || isAbsolute(path) || /[\\\x00:]/u.test(path)) {
      throw failure("UNSAFE_PATH", "只允许项目内的相对路径");
    }
    const parts = path.split("/");
    if (parts.some((part) => !part || part.startsWith(".") || part === "..")) {
      throw failure("UNSAFE_PATH", "不允许隐藏路径或越界路径");
    }
    let current = root;
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      let info;
      try {
        info = lstatSync(current);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (createParents && index < parts.length - 1) {
          try {
            mkdirSync(current);
          } catch (mkdirError) {
            if (mkdirError.code !== "EEXIST") throw mkdirError;
          }
          info = lstatSync(current);
        }
      }
      if (info?.isSymbolicLink()) throw failure("UNSAFE_PATH", "不允许符号链接");
      if (info && index < parts.length - 1 && !info.isDirectory()) {
        throw failure("UNSAFE_PATH", "父路径必须是目录");
      }
    }
    return current;
  };
  const read = (path) => {
    const absolute = pathFor(path);
    const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.size > 16 * 1024 * 1024)
        throw failure("INVALID_FILE", "文件过大或不是普通文件");
      const content = readFileSync(fd, "utf8");
      return {
        path,
        content,
        modifiedAt: info.mtimeMs,
        revision: revision(content),
        size: Buffer.byteLength(content),
      };
    } finally {
      closeSync(fd);
    }
  };
  const compare = (params) => {
    let current;
    try {
      current = read(params.path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      Object.hasOwn(params, "expectedModifiedAt") &&
      (params.expectedModifiedAt === null
        ? Boolean(current)
        : !current || current.modifiedAt !== params.expectedModifiedAt)
    ) {
      throw failure("REVISION_CONFLICT", "文件修改时间已变化，请重新读取");
    }
    if (
      Object.hasOwn(params, "expectedRevision") &&
      current?.revision !== params.expectedRevision
    ) {
      throw failure("REVISION_CONFLICT", "文件版本已变化，请重新读取");
    }
  };
  const write = (params) => {
    if (typeof params.content !== "string" || Buffer.byteLength(params.content) > 384 * 1024) {
      throw failure("INVALID_ARGUMENT", "写入必须是最多 384 KiB 的文本");
    }
    const absolute = pathFor(params.path, { createParents: true });
    compare(params);
    const temporary = join(dirname(absolute), `.job-hunt-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = openSync(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(fd, params.content, "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      pathFor(params.path);
      compare(params);
      if (params.expectedModifiedAt === null) {
        try {
          linkSync(temporary, absolute);
        } catch (error) {
          if (error.code === "EEXIST") throw failure("REVISION_CONFLICT", "文件已存在，不能覆盖");
          throw error;
        }
      } else renameSync(temporary, absolute);
      return read(params.path);
    } finally {
      if (fd !== undefined) closeSync(fd);
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  };
  return {
    root,
    check,
    active: () => true,
    async call(method, params = {}) {
      check();
      if (method === "workspace.readText") return read(params.path);
      if (method === "workspace.writeText") return write(params);
      if (method === "workspace.info") return { name: basename(root), cwd: root };
      if (method === "workspace.list") {
        const absolute = pathFor(params.path || ".", { allowRoot: true });
        return {
          entries: readdirSync(absolute, { withFileTypes: true })
            .filter((entry) => !entry.name.startsWith(".") && !entry.isSymbolicLink())
            .map((entry) => ({
              name: entry.name,
              isDirectory: entry.isDirectory(),
              type: entry.isDirectory() ? "directory" : "file",
            })),
        };
      }
      throw failure("UNSUPPORTED_METHOD", `不支持的方法：${method}`);
    },
    async withWriteLock(fn) {
      // CLI peers cooperate; the Host still uses its own revision protocol.
      const lock = join(root, ".job-hunt-write.lock");
      const deadline = Date.now() + 5_000;
      for (;;) {
        check();
        try {
          mkdirSync(lock, { mode: 0o700 });
          break;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          if (Date.now() >= deadline)
            throw failure("REVISION_CONFLICT", "另一个 CLI 写入仍在进行；请确认后重试");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      try {
        return await fn();
      } finally {
        check();
        rmdirSync(lock);
      }
    },
  };
}

export async function findJobHuntProject(start) {
  let directory = resolve(start);
  for (;;) {
    if (existsSync(join(directory, "job-hunt-panel.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory)
      throw failure(
        "PROJECT_NOT_INITIALIZED",
        "找不到 job-hunt-panel.json，请先在项目目录执行 init",
      );
    directory = parent;
  }
}
