import { normalizeDesignDocument, serializeDesignDocument, isSafeDesignPath } from "./document.mjs";
import { createDesignPersistencePlan, MAX_WORKSPACE_DESIGN_TEXT_BYTES } from "./document-bundle.mjs";
import { createDesignIndexPersistencePlan } from "./document-index.mjs";
import { createDesignResourcePersistencePlan, resolveDesignResource } from "./resource-store.mjs";

export const PORTABLE_DESIGN_FORMAT = "codeshell.design.portable-backup";
export const MAX_PORTABLE_DESIGN_BYTES = 128 * 1024 * 1024;
const bytes = value => new TextEncoder().encode(value).length;
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key))) throw Error(`${label} 格式无效`);
}
function origin(value) {
  exact(value, ["workspaceRoot", "sessionId", "path"], "备份来源");
  for (const key of ["workspaceRoot", "sessionId", "path"])
    if (value[key] !== null && (typeof value[key] !== "string" || value[key].length > 4096))
      throw Error("备份来源无效");
  return structuredClone(value);
}
function bounded(value) {
  const text = JSON.stringify(value);
  if (bytes(text) > MAX_PORTABLE_DESIGN_BYTES) throw Error("完整设计备份超过 128 MiB");
  return text;
}

// Capture a fully materialized document. All resource bytes are verified before
// the caller offers a download; no project-relative resource reference is omitted.
export async function createPortableDesign({ document, source, readText, sha256Bytes }) {
  const normalized = normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
  const backup = {
    format: PORTABLE_DESIGN_FORMAT, version: 1, source: origin(source),
    document: JSON.parse(serializeDesignDocument(normalized)), resources: [],
  };
  let size = bytes(JSON.stringify(backup));
  for (const descriptor of normalized.resources ?? []) {
    size += Math.ceil(descriptor.bytes / 3) * 4 + descriptor.id.length + 40;
    if (size > MAX_PORTABLE_DESIGN_BYTES) throw Error("完整设计备份超过 128 MiB");
    const resource = await resolveDesignResource({ descriptor, readText, sha256Bytes });
    backup.resources.push({ id: descriptor.id, base64: resource.base64 });
  }
  return bounded(backup);
}

// Validation and reconstruction are read-only. Imported paths never become write
// targets: all part paths are generated from verified resource/document hashes.
export async function planPortableDesign(text, { sha256, sha256Bytes }) {
  if (typeof text !== "string" || bytes(text) > MAX_PORTABLE_DESIGN_BYTES)
    throw Error("请选择不超过 128 MiB 的完整设计备份");
  let value;
  try { value = JSON.parse(text); } catch { throw Error("设计备份不是有效 JSON"); }
  exact(value, ["format", "version", "source", "document", "resources"], "完整设计备份");
  if (value.format !== PORTABLE_DESIGN_FORMAT || value.version !== 1)
    throw Error("请选择完整设计备份；旧草稿日志仍需要原项目基线与资源，不能作为完整备份导入");
  const source = origin(value.source);
  const document = normalizeDesignDocument(value.document);
  const descriptors = document.resources ?? [];
  if (!Array.isArray(value.resources) || value.resources.length !== descriptors.length)
    throw Error("备份缺少资源或包含额外资源");
  const entries = new Map();
  for (const entry of value.resources) {
    exact(entry, ["id", "base64"], "备份资源");
    if (typeof entry.id !== "string" || typeof entry.base64 !== "string" || entries.has(entry.id))
      throw Error("备份资源重复或无效");
    entries.set(entry.id, entry.base64);
  }
  const parts = new Map();
  for (const descriptor of descriptors) {
    if (!entries.has(descriptor.id)) throw Error(`备份缺少资源：${descriptor.id}`);
    const plan = await createDesignResourcePersistencePlan({ ...descriptor,
      base64: entries.get(descriptor.id), sha256Bytes });
    if (JSON.stringify(plan.descriptor) !== JSON.stringify(descriptor))
      throw Error(`备份资源校验失败：${descriptor.id}`);
    for (const part of plan.parts) parts.set(part.path, part.content);
  }
  const documentSource = serializeDesignDocument(document);
  const persistence = bytes(documentSource) > MAX_WORKSPACE_DESIGN_TEXT_BYTES
    ? await createDesignIndexPersistencePlan({ document, sha256 })
    : createDesignPersistencePlan({ source: documentSource, name: document.name });
  for (const part of persistence.parts) parts.set(part.path, part.content);
  return { source, name: document.name, pageCount: document.pages.length,
    resourceCount: descriptors.length, primarySource: persistence.primarySource,
    parts: [...parts].map(([path, content]) => ({ path, content })) };
}

// Commit the primary document last. Failures leave only immutable parts, so the
// same reviewed plan can be retried without overwriting existing files or drafts.
export async function restorePortableDesign({ plan, path, call, check }) {
  if (!isSafeDesignPath(path)) throw Error("恢复路径需位于 designs/，并以 .codesign.json 结尾");
  async function create(part) {
    check();
    try {
      await call("workspace.writeText", { ...part, expectedModifiedAt: null });
    } catch (error) {
      check();
      let existing;
      try { existing = await call("workspace.readText", { path: part.path }); }
      catch { check(); throw error; }
      check();
      if (existing.content !== part.content) throw Error(`文件已存在或内容冲突：${part.path}`);
    }
    check();
  }
  for (const part of plan.parts) await create(part);
  await create({ path, content: plan.primarySource });
  return { path };
}
