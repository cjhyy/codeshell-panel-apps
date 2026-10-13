import * as fs from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { projectSnapshotShardDescriptors, hydrateProjectSnapshotDocuments } from "./snapshot-sharding-model.mjs";
import { createNodeWorkspaceScope } from "./tools/node-workspace-scope.mjs";

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
  // The compatibility store retains its narrower file/UTF-8 contract. Every
  // publication uses the same per-file lock and CAS as Host and the public CLI.
  let workspaceScope;
  const workspace = () => workspaceScope ||= createNodeWorkspaceScope(root);
  async function write(params) {
    const { path } = params;
    const file = target(path, true);
    const parentIdentity = identity(fs.lstatSync(dirname(file)));
    if (typeof params.content !== "string" || Buffer.byteLength(params.content) > WRITE_LIMIT) throw projectStoreError("FILE_TOO_LARGE", "项目写入最多384 KiB");
    const hasRevision = Object.hasOwn(params, "expectedRevision");
    if (hasRevision && params.expectedRevision !== null && !/^sha256:[a-f0-9]{64}$/.test(params.expectedRevision || "")) throw projectStoreError("INVALID_INPUT", "expectedRevision必须是sha256 revision或null");
    if (!hasRevision && !Object.hasOwn(params, "expectedModifiedAt")) throw projectStoreError("INVALID_INPUT", "写入必须携带预期版本");
    let current = null;
    try { current = read(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const conflict = hasRevision ? (current?.revision ?? null) !== params.expectedRevision
      : params.expectedModifiedAt === null ? current !== null : !current || !Number.isFinite(params.expectedModifiedAt) || Math.abs(current.modifiedAt - params.expectedModifiedAt) >= 0.001;
    if (conflict) throw projectStoreError("REVISION_CONFLICT", "项目数据已变化，请重新读取后保存；已有内容没有覆盖");
    const writer = await workspace();
    check();
    target(path);
    if (identity(fs.lstatSync(dirname(file))) !== parentIdentity)
      throw projectStoreError("PROJECT_CHANGED", "提交目录已改变");
    const receipt = await writer.call("workspace.writeText", {
      path, content: params.content,
      // Canonical revisions omit the legacy prefix. A revision precondition
      // remains authoritative when older callers also supply an mtime.
      ...(hasRevision && params.expectedRevision !== null
        ? { expectedRevision: params.expectedRevision.slice("sha256:".length) }
        : current
          ? { expectedModifiedAt: current.modifiedAt, expectedRevision: current.revision.slice("sha256:".length) }
          : { expectedModifiedAt: null }),
    });
    check();
    return { path: receipt.path, size: receipt.size, modifiedAt: receipt.modifiedAt, revision: `sha256:${receipt.revision}` };
  }
  const scope = { check, active: () => { try { check(); return true; } catch { return false; } },
    withWriteLock: async operation => {
      const writer = await workspace();
      check();
      return writer.withWriteLock(operation);
    },
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
