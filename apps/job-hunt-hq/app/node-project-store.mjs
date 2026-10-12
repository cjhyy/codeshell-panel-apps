import * as fs from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { projectSnapshotShardDescriptors, hydrateProjectSnapshotDocuments } from "./snapshot-sharding-model.mjs";

const READ_LIMIT = 480 * 1024;
const WRITE_LIMIT = 384 * 1024;
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const identity = stat => `${stat.dev}:${stat.ino}`;
export function projectStoreError(code, message) { return Object.assign(new Error(message), { code }); }

export function createNodeProjectStore(projectInput) {
  const root = resolve(projectInput);
  const initial = fs.lstatSync(root);
  if (!initial.isDirectory() || initial.isSymbolicLink() || fs.realpathSync(root) !== root) throw projectStoreError("INVALID_PROJECT", "项目必须是实际目录，不能通过符号链接访问");
  const projectIdentity = identity(initial);
  function check() {
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || identity(stat) !== projectIdentity || fs.realpathSync(root) !== root) throw projectStoreError("PROJECT_CHANGED", "项目目录已改变，请重新读取项目");
  }
  function target(path, createParents = false) {
    check();
    if (typeof path !== "string" || path.length > 512 || !(path === "job-hunt-panel.json" || path.startsWith("career-data/")) ||
        !path.split("/").every(part => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part) && !part.endsWith(".") && part !== "node_modules") || !/\.(json|txt|md)$/.test(path))
      throw projectStoreError("INVALID_PATH", "只允许项目的 job-hunt-panel.json 和 career-data 下的安全文件路径");
    const absolute = join(root, path);
    let directory = root;
    for (const part of path.split("/").slice(0, -1)) {
      directory = join(directory, part);
      if (createParents && !fs.existsSync(directory)) { try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; } }
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw projectStoreError("INVALID_PATH", "资料目录包含符号链接或不是目录");
    }
    if (!absolute.startsWith(`${root}${sep}`)) throw projectStoreError("INVALID_PATH", "文件不属于当前项目");
    try { const stat = fs.lstatSync(absolute); if (!stat.isFile() || stat.isSymbolicLink()) throw projectStoreError("INVALID_PATH", "资料文件包含符号链接或不是普通文件"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return absolute;
  }
  function read(path) {
    const file = target(path);
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size > READ_LIMIT) throw projectStoreError("FILE_TOO_LARGE", "项目文件超过480 KiB，请使用面板分片格式");
      const bytes = fs.readFileSync(descriptor);
      if (bytes.length > READ_LIMIT) throw projectStoreError("FILE_TOO_LARGE", "项目文件超过480 KiB");
      if (identity(fs.lstatSync(file)) !== identity(stat)) throw projectStoreError("PROJECT_CHANGED", "读取时文件已替换，请重新读取");
      check();
      return { path, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes), size: bytes.length, modifiedAt: stat.mtimeMs, revision: hash(bytes) };
    } finally { fs.closeSync(descriptor); }
  }
  function withCommitLock(operation) {
    const lockParent = dirname(target("career-data/panel-runtime/owner.json", true));
    const lock = join(lockParent, "commit-lock");
    try { fs.mkdirSync(lock, { mode: 0o700 }); }
    catch (error) {
      if (error.code === "EEXIST") throw projectStoreError("PROJECT_BUSY", "另一个进程正在提交项目。请稍后重新读取；若进程中断，先确认没有写入者再处理 career-data/panel-runtime/commit-lock。");
      throw error;
    }
    const nonce = randomUUID();
    const ownerPath = join(lock, "owner.json");
    try {
      fs.writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, nonce, createdAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
      // The compare and publication are synchronous while the shared Panel
      // lock is held. No awaited work can stall another writer or expire a lease.
      return operation();
    } finally {
      // An interrupted process leaves the lock intact and subsequent writes fail
      // closed. Elapsed time is never treated as proof that its writer is dead.
      if (fs.existsSync(ownerPath) && JSON.parse(fs.readFileSync(ownerPath, "utf8")).nonce === nonce) {
        fs.unlinkSync(ownerPath); fs.rmdirSync(lock);
      }
    }
  }
  function publish(path, params) {
    const file = target(path, true);
    if (typeof params.content !== "string" || Buffer.byteLength(params.content) > WRITE_LIMIT) throw projectStoreError("FILE_TOO_LARGE", "项目写入最多384 KiB");
    const hasRevision = Object.hasOwn(params, "expectedRevision");
    if (hasRevision && params.expectedRevision !== null && !/^sha256:[a-f0-9]{64}$/.test(params.expectedRevision || "")) throw projectStoreError("INVALID_INPUT", "expectedRevision必须是sha256 revision或null");
    if (!hasRevision && !Object.hasOwn(params, "expectedModifiedAt")) throw projectStoreError("INVALID_INPUT", "写入必须携带预期版本");
    let current = null;
    try { current = read(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const conflict = hasRevision ? (current?.revision ?? null) !== params.expectedRevision
      : params.expectedModifiedAt === null ? current !== null : !current || !Number.isFinite(params.expectedModifiedAt) || Math.abs(current.modifiedAt - params.expectedModifiedAt) >= 0.001;
    if (conflict) throw projectStoreError("REVISION_CONFLICT", "项目数据已变化，请重新读取后保存；已有内容没有覆盖");
    const parentIdentity = identity(fs.lstatSync(dirname(file)));
    const temporary = join(dirname(file), `.job-hunt-${randomUUID()}.tmp`);
    const bytes = Buffer.from(params.content, "utf8");
    try {
      const descriptor = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      check(); target(path);
      if (identity(fs.lstatSync(dirname(file))) !== parentIdentity) throw projectStoreError("PROJECT_CHANGED", "提交目录已改变");
      if (!current) {
        try { fs.linkSync(temporary, file); } catch (error) { if (error.code === "EEXIST") throw projectStoreError("REVISION_CONFLICT", "文件已由另一个操作创建"); throw error; }
      } else fs.renameSync(temporary, file);
      return { path, size: bytes.length, modifiedAt: fs.lstatSync(file).mtimeMs, revision: hash(bytes) };
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function write(params) { return params.path === "job-hunt-panel.json" ? withCommitLock(() => publish(params.path, params)) : publish(params.path, params); }
  const scope = { check, active: () => { try { check(); return true; } catch { return false; } },
    call: async (method, params) => {
      if (method === "workspace.readText") return read(params.path);
      if (method === "workspace.writeText") return write(params);
      throw projectStoreError("UNSUPPORTED", `CLI不提供${method}`);
    } };
  async function load() {
    let file;
    try { file = read("job-hunt-panel.json"); } catch (error) { if (error.code === "ENOENT") return { file: null, state: { schemaVersion: 2 } }; throw error; }
    const rootDocument = JSON.parse(file.content);
    if (![1, 2].includes(rootDocument?.schemaVersion) || Array.isArray(rootDocument)) throw projectStoreError("INVALID_PROJECT", "项目快照版本不受支持，未重置原资料");
    const documents = new Map();
    for (const descriptor of projectSnapshotShardDescriptors(rootDocument)) documents.set(descriptor.path, JSON.parse(read(descriptor.path).content));
    return { file, state: hydrateProjectSnapshotDocuments(rootDocument, documents) };
  }
  return { root, projectKey: JSON.stringify({ path: root, identity: projectIdentity }), scope, read, write, load };
}
