import { normalizeDesignDocument, serializeDesignDocument, isSafeDesignPath } from "./document.mjs";
import {
  createDesignPersistencePlan,
  MAX_WORKSPACE_DESIGN_TEXT_BYTES,
} from "./document-bundle.mjs";
import { createDesignIndexPersistencePlan } from "./document-index.mjs";
import { createDesignResourcePersistencePlan, resolveDesignResource } from "./resource-store.mjs";
import {
  isMissingReviewFile,
  parseReviewComments,
  reviewCommentsPath,
} from "./review-comments.mjs";
import {
  createDesignSidecarPlan,
  readDesignSidecar,
  MAX_DESIGN_SIDECAR_BYTES,
} from "./design-sidecar.mjs";
import { parseFigmaBinding } from "./figma-binding.mjs";
import { normalizePrototype } from "./prototype.mjs";

export const PORTABLE_DESIGN_FORMAT = "codeshell.design.portable-backup";
export const MAX_PORTABLE_DESIGN_BYTES = 128 * 1024 * 1024;
const bytes = (value) => new TextEncoder().encode(value).length;
const MAX_ATTACHMENTS = 32;
const MAX_ATTACHMENT_BYTES = MAX_DESIGN_SIDECAR_BYTES;
const safeSuffix = (value) =>
  typeof value === "string" &&
  /^\.[a-z0-9][a-z0-9.-]{0,78}$/u.test(value) &&
  !value.includes("..") &&
  value !== ".codesign.json";
const digest = async (content, sha256Bytes) => {
  const input = new TextEncoder().encode(content);
  if (sha256Bytes) return sha256Bytes(input);
  const value = await globalThis.crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
function counts(attachments) {
  let threads = 0,
    replies = 0;
  for (const attachment of attachments)
    if (attachment.kind === "comments") {
      const value = JSON.parse(attachment.content);
      threads += value.threads.length;
      replies += value.threads.reduce((sum, thread) => sum + thread.replies.length, 0);
    }
  return { attachments: attachments.length, threads, replies };
}
async function attachmentRecord(entry, designPath, sha256Bytes, verified = false, document) {
  exact(
    entry,
    verified ? ["kind", "suffix", "content", "bytes", "sha256"] : ["kind", "suffix", "content"],
    "备份附件",
  );
  if (
    typeof entry.kind !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/u.test(entry.kind) ||
    !safeSuffix(entry.suffix) ||
    typeof entry.content !== "string" ||
    !entry.content.length ||
    bytes(entry.content) > MAX_ATTACHMENT_BYTES
  )
    throw Error("备份附件名称、路径或内容无效");
  if ((entry.kind === "comments") !== (entry.suffix === ".comments.json"))
    throw Error("评论附件路径无效");
  if (entry.kind === "comments") parseReviewComments(entry.content, designPath);
  else if (entry.kind === "figma-binding" && entry.suffix === ".figma-source.json")
    parseFigmaBinding(entry.content);
  else if (entry.kind === "prototype" && entry.suffix === ".prototype.json") {
    if (!document) throw Error("验证原型附件需要完整设计");
    normalizePrototype(JSON.parse(entry.content), document);
  } else throw Error("备份包含不支持的附件类型或路径");
  const hash = await digest(entry.content, sha256Bytes),
    length = bytes(entry.content);
  if (
    !/^[a-f0-9]{64}$/u.test(hash) ||
    (verified && (entry.sha256 !== hash || entry.bytes !== length))
  )
    throw Error(`备份附件校验失败：${entry.kind}`);
  return {
    kind: entry.kind,
    suffix: entry.suffix,
    content: entry.content,
    bytes: length,
    sha256: hash,
  };
}

async function verifyAttachments(entries, designPath, sha256Bytes, verified, document) {
  if (!Array.isArray(entries) || entries.length > MAX_ATTACHMENTS) throw Error("备份附件数量无效");
  const suffixes = new Set(),
    kinds = new Set(),
    result = [];
  for (const entry of entries) {
    const value = await attachmentRecord(entry, designPath, sha256Bytes, verified, document);
    if (suffixes.has(value.suffix) || kinds.has(value.kind)) throw Error("备份附件重复");
    suffixes.add(value.suffix);
    kinds.add(value.kind);
    result.push(value);
  }
  return result;
}
function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw Error(`${label} 格式无效`);
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
export async function createPortableDesign({
  document,
  source,
  readText,
  sha256Bytes,
  includeComments = false,
  attachments = [],
}) {
  const normalized = normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
  const backup = {
    format: PORTABLE_DESIGN_FORMAT,
    version: 1,
    source: origin(source),
    document: JSON.parse(serializeDesignDocument(normalized)),
    resources: [],
  };
  let size = bytes(JSON.stringify(backup));
  for (const descriptor of normalized.resources ?? []) {
    size += Math.ceil(descriptor.bytes / 3) * 4 + descriptor.id.length + 40;
    if (size > MAX_PORTABLE_DESIGN_BYTES) throw Error("完整设计备份超过 128 MiB");
    const resource = await resolveDesignResource({ descriptor, readText, sha256Bytes });
    backup.resources.push({ id: descriptor.id, base64: resource.base64 });
  }
  if (includeComments || attachments.length) {
    const records = [...attachments];
    if (records.some((entry) => entry.kind === "comments"))
      throw Error("评论附件由当前项目读取，不能通过其他附件替换");
    let comments = "not-captured";
    if (includeComments) {
      const path = reviewCommentsPath(source.path);
      let root;
      try {
        root = await readText(path);
      } catch (error) {
        if (!isMissingReviewFile(error)) throw error;
        comments = "absent";
      }
      if (comments !== "absent") {
        const result = await readDesignSidecar({
          path,
          sha256: (content) => digest(content, sha256Bytes),
          call: async (_method, params) => {
            const value = params.path === path ? root : await readText(params.path);
            return typeof value === "string" ? { content: value } : value;
          },
        });
        const content = result.content;
        parseReviewComments(content, source.path);
        records.unshift({ kind: "comments", suffix: ".comments.json", content });
        comments = "included";
      }
    }
    backup.version = 2;
    backup.attachments = await verifyAttachments(
      records,
      source.path,
      sha256Bytes,
      false,
      backup.document,
    );
    backup.coverage = { comments };
    backup.counts = counts(backup.attachments);
  }
  return bounded(backup);
}

// Validation and reconstruction are read-only. Imported paths never become write
// targets: all part paths are generated from verified resource/document hashes.
export async function planPortableDesign(text, { sha256, sha256Bytes }) {
  if (typeof text !== "string" || bytes(text) > MAX_PORTABLE_DESIGN_BYTES)
    throw Error("请选择不超过 128 MiB 的完整设计备份");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error("设计备份不是有效 JSON");
  }
  exact(
    value,
    value?.version === 2
      ? [
          "format",
          "version",
          "source",
          "document",
          "resources",
          "attachments",
          "coverage",
          "counts",
        ]
      : ["format", "version", "source", "document", "resources"],
    "完整设计备份",
  );
  if (value.format !== PORTABLE_DESIGN_FORMAT || ![1, 2].includes(value.version))
    throw Error("请选择完整设计备份；旧草稿日志仍需要原项目基线与资源，不能作为完整备份导入");
  const source = origin(value.source);
  const document = normalizeDesignDocument(value.document);
  const attachments =
    value.version === 2
      ? await verifyAttachments(value.attachments, source.path, sha256Bytes, true, value.document)
      : [];
  if (value.version === 2) {
    exact(value.coverage, ["comments"], "评论备份覆盖记录");
    if (
      !["included", "absent", "not-captured"].includes(value.coverage.comments) ||
      (value.coverage.comments === "included") !==
        attachments.some((entry) => entry.kind === "comments")
    )
      throw Error("评论备份覆盖记录不一致");
    exact(value.counts, ["attachments", "threads", "replies"], "备份附件数量");
    const expected = counts(attachments);
    if (Object.keys(expected).some((key) => value.counts[key] !== expected[key]))
      throw Error("备份附件数量记录不一致");
  }
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
    const plan = await createDesignResourcePersistencePlan({
      ...descriptor,
      base64: entries.get(descriptor.id),
      sha256Bytes,
    });
    if (JSON.stringify(plan.descriptor) !== JSON.stringify(descriptor))
      throw Error(`备份资源校验失败：${descriptor.id}`);
    for (const part of plan.parts) parts.set(part.path, part.content);
  }
  const documentSource = serializeDesignDocument(document);
  const persistence =
    bytes(documentSource) > MAX_WORKSPACE_DESIGN_TEXT_BYTES
      ? await createDesignIndexPersistencePlan({ document, sha256 })
      : createDesignPersistencePlan({ source: documentSource, name: document.name });
  for (const part of persistence.parts) parts.set(part.path, part.content);
  return {
    source,
    name: document.name,
    pageCount: document.pages.length,
    resourceCount: descriptors.length,
    primarySource: persistence.primarySource,
    parts: [...parts].map(([path, content]) => ({ path, content })),
    attachments,
    ...(attachments.some((entry) => entry.kind === "prototype")
      ? { attachmentDocument: value.document }
      : {}),
    attachmentCounts: counts(attachments),
    commentsCoverage: value.coverage?.comments ?? "legacy-unknown",
  };
}

// Commit the primary document last. Failures leave only immutable parts, so the
// same reviewed plan can be retried without overwriting existing files or drafts.
export async function restorePortableDesign({ plan, path, call, check, sha256Bytes }) {
  if (!isSafeDesignPath(path)) throw Error("恢复路径需位于 designs/，并以 .codesign.json 结尾");
  // Revalidate every attachment before the first write, including plans retained
  // across a UI review. Archive paths never become workspace write targets.
  const attachments = await verifyAttachments(
    plan.attachments ?? [],
    plan.source.path,
    sha256Bytes,
    true,
    plan.attachmentDocument,
  );
  check();
  const companionParts = [],
    attachmentParts = [];
  for (const entry of attachments) {
    let content = entry.content;
    if (entry.kind === "comments") {
      const value = parseReviewComments(content, plan.source.path);
      value.designPath = path;
      content = `${JSON.stringify(value, null, 2)}\n`;
      parseReviewComments(content, path);
    }
    const persistence = await createDesignSidecarPlan(content, {
      sha256: (content) => digest(content, sha256Bytes),
    });
    check();
    companionParts.push({
      path: path.replace(/\.codesign\.json$/u, entry.suffix),
      content: persistence.primarySource,
    });
    attachmentParts.push(
      ...persistence.parts.map((part) => ({ path: part.path, content: part.content })),
    );
  }
  async function create(part) {
    check();
    try {
      await call("workspace.writeText", { ...part, expectedModifiedAt: null });
    } catch (error) {
      check();
      let existing;
      try {
        existing = await call("workspace.readText", { path: part.path });
      } catch {
        check();
        throw error;
      }
      check();
      if (existing.content !== part.content) throw Error(`文件已存在或内容冲突：${part.path}`);
    }
    check();
  }
  if (companionParts.length) {
    for (const part of [...companionParts, { path, content: plan.primarySource }]) {
      check();
      try {
        const existing = await call("workspace.readText", { path: part.path });
        check();
        if (existing.content !== part.content) throw Error(`文件已存在或内容冲突：${part.path}`);
      } catch (error) {
        check();
        if (!isMissingReviewFile(error) && error?.message !== "missing") throw error;
      }
    }
  }
  for (const part of plan.parts) await create(part);
  for (const part of attachmentParts) await create(part);
  for (const part of companionParts) await create(part);
  await create({ path, content: plan.primarySource });
  return {
    path,
    attachments: companionParts.map((part) => part.path),
    attachmentCounts: counts(attachments),
  };
}
