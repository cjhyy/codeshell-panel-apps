// Package-local filesystem adapter. The per-file protocol is shared with Host
// workspace writers; all other paths are ordinary, project-owned design files.
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const fail = (code, message) => Object.assign(new Error(message), { code });
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const MAX_INPUT_BYTES = 16 * 1024 * 1024;
export const MAX_PROJECT_READ_BYTES = 64 * 1024 * 1024;

export function readTextFile(path, limit = MAX_INPUT_BYTES) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) throw fail("INVALID_FILE", "Input must be a regular file.");
    if (info.size > limit) throw fail("INPUT_TOO_LARGE", `Input exceeds ${limit} bytes.`);
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - bytes));
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (count === 0) break;
      bytes += count;
      if (bytes > limit) throw fail("INPUT_TOO_LARGE", `Input exceeds ${limit} bytes.`);
      chunks.push(chunk.subarray(0, count));
    }
    const buffer = Buffer.concat(chunks);
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
    } catch {
      throw fail("INVALID_UTF8", "Input must be valid UTF-8 text.");
    }
    return { content, bytes, revision: sha256(buffer) };
  } finally {
    closeSync(fd);
  }
}

export function isPortableProjectPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 512 &&
    !isAbsolute(path) &&
    !/[\\:\u0000-\u001f\u007f]/u.test(path) &&
    path
      .split("/")
      .every(
        (part) =>
          part &&
          !part.startsWith(".") &&
          !/[. ]$/u.test(part) &&
          part.toLowerCase() !== "node_modules" &&
          !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu.test(part.split(".")[0]),
      )
  );
}

export function createNodeProject(projectRoot) {
  const supplied = resolve(projectRoot);
  if (lstatSync(supplied).isSymbolicLink())
    throw fail("UNSAFE_PATH", "Project cannot be a symlink.");
  const root = realpathSync(supplied);
  const rootIdentity = lstatSync(root);
  if (!rootIdentity.isDirectory()) throw fail("UNSAFE_PATH", "Project must be a directory.");
  const check = () => {
    const current = lstatSync(root);
    if (
      current.isSymbolicLink() ||
      realpathSync(root) !== root ||
      current.dev !== rootIdentity.dev ||
      current.ino !== rootIdentity.ino
    )
      throw fail("UNSAFE_PATH", "Project directory changed.");
  };
  const pathFor = (path, createParents = false) => {
    check();
    if (!isPortableProjectPath(path))
      throw fail("UNSAFE_PATH", "Expected a portable project-relative path.");
    const parts = path.split("/");
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
      if (info?.isSymbolicLink())
        throw fail("UNSAFE_PATH", "Symlinks are not allowed in project paths.");
      if (info && index < parts.length - 1 && !info.isDirectory())
        throw fail("UNSAFE_PATH", "Parent path must be a directory.");
    }
    return current;
  };
  let readBytes = 0;
  const read = (path, limit = MAX_INPUT_BYTES) => {
    const result = readTextFile(pathFor(path), Math.min(limit, MAX_PROJECT_READ_BYTES - readBytes));
    readBytes += result.bytes;
    return { path, ...result };
  };
  const withLock = async (lock, verify, fn) => {
    const deadline = Date.now() + 5_000;
    let identity;
    for (;;) {
      verify();
      try {
        mkdirSync(lock, { mode: 0o700 });
        identity = lstatSync(lock);
        if (identity.isSymbolicLink() || !identity.isDirectory())
          throw fail("UNSAFE_PATH", "New write lock changed.");
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() >= deadline)
          throw fail("REVISION_CONFLICT", "Another writer holds the lock. Reread before retrying.");
        await new Promise((done) => setTimeout(done, 25));
      }
    }
    let result, operationError, releaseError;
    try {
      verify();
      result = await fn();
    } catch (error) {
      operationError = error;
    }
    try {
      verify();
      const current = lstatSync(lock);
      if (
        current.isSymbolicLink() ||
        !current.isDirectory() ||
        current.dev !== identity.dev ||
        current.ino !== identity.ino
      )
        throw fail("UNSAFE_PATH", "Owned write lock changed; refusing removal.");
      rmdirSync(lock);
    } catch (error) {
      releaseError = error;
    }
    if (operationError && releaseError)
      throw new AggregateError(
        [operationError, releaseError],
        `${operationError.message}; ${releaseError.message}`,
        { cause: operationError },
      );
    if (releaseError) throw releaseError;
    if (operationError) throw operationError;
    return result;
  };
  const write = async (path, content, expectedRevision) => {
    if (typeof content !== "string" || Buffer.byteLength(content) > MAX_INPUT_BYTES)
      throw fail("INPUT_TOO_LARGE", "Output exceeds 16 MiB.");
    if (expectedRevision !== null && !/^[0-9a-f]{64}$/u.test(expectedRevision))
      throw fail("INVALID_ARGUMENT", "Writes require null or an exact SHA-256 revision.");
    const absolute = pathFor(path, true);
    const parentPath = dirname(absolute),
      parentIdentity = lstatSync(parentPath);
    const verify = () => {
      pathFor(path);
      const parent = lstatSync(parentPath);
      if (parent.dev !== parentIdentity.dev || parent.ino !== parentIdentity.ino)
        throw fail("UNSAFE_PATH", "Output parent directory changed.");
    };
    const compare = () => {
      let actual = null;
      try {
        actual = readTextFile(pathFor(path)).revision;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (actual !== expectedRevision)
        throw fail(
          "REVISION_CONFLICT",
          "File revision changed. Reread and preserve the current document.",
        );
    };
    const lockName = sha256(basename(absolute).normalize("NFC").toLowerCase());
    const lock = join(parentPath, `.codeshell-workspace-write-${lockName}.lock`);
    return withLock(lock, verify, () => {
      compare();
      const temporary = join(parentPath, `.design-studio-${randomUUID()}.tmp`);
      let fd;
      try {
        fd = openSync(
          temporary,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        writeFileSync(fd, content, "utf8");
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        verify();
        compare();
        if (expectedRevision === null) {
          try {
            linkSync(temporary, absolute);
          } catch (error) {
            if (error.code === "EEXIST") throw fail("REVISION_CONFLICT", "Output already exists.");
            throw error;
          }
        } else renameSync(temporary, absolute);
        return { path, bytes: Buffer.byteLength(content), revision: sha256(content) };
      } finally {
        if (fd !== undefined) closeSync(fd);
        try {
          unlinkSync(temporary);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    });
  };
  return {
    root,
    read,
    write,
    withWriteLock: (fn) => withLock(join(root, ".design-studio-write.lock"), check, fn),
  };
}
