import { normalizeDesignDocument, normalizeDesignState, isSafeDesignPath } from "./document.mjs";
import { resolveDesignIndexDocument } from "./document-index.mjs";
import { resolveDesignPersistenceSource } from "./document-bundle.mjs";
import { resolveRecoveryPersistence, RECOVERY_POINTER_FORMAT } from "./recovery-store.mjs";
import { applyDesignOperationRecord, captureDesignOperationState } from "./operation-log.mjs";
import { createPortableDesign, planPortableDesign, PORTABLE_DESIGN_FORMAT, MAX_PORTABLE_DESIGN_BYTES } from "./portable-backup.mjs";

const byteLength = value => new TextEncoder().encode(value).length;
const same = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
};
const sourceOf = value => ({ workspaceRoot: typeof value?.workspaceRoot === "string" ? value.workspaceRoot : null,
  sessionId: typeof value?.sourceContext?.sessionId === "string" ? value.sourceContext.sessionId : null,
  path: typeof value?.path === "string" ? value.path : null });

export function designBackupCandidates(text) {
  if (typeof text !== "string" || byteLength(text) > MAX_PORTABLE_DESIGN_BYTES) throw Error("备份不能超过 128 MiB");
  let value;
  try { value = JSON.parse(text); } catch { throw Error("备份不是有效 JSON"); }
  if (value?.format === PORTABLE_DESIGN_FORMAT) return [{ label: "完整设计备份", kind: "portable", value }];
  if (value?.format !== "codeshell.design.recovery-backup" || value.version !== 1 || !Array.isArray(value.drafts) || value.drafts.length > 256)
    throw Error("请选择完整设计备份或受支持的草稿日志备份");
  const candidates = value.drafts.map((draft, index) => ({ label: `草稿 ${index + 1} · ${sourceOf(draft).workspaceRoot ?? "未知来源"} · ${sourceOf(draft).path ?? "未知文件"}`, kind: "legacy", value: draft }));
  if (value.storedRecovery?.value != null)
    candidates.push({ label: "主程序保存的恢复记录", kind: "legacy", value: value.storedRecovery.value });
  if (!candidates.length) throw Error("备份没有可选择的草稿");
  return candidates;
}

// Validate all recorded preconditions against the exact original baseline. In
// particular, unknown operations and arbitrary set-document fields cannot turn
// into silently ignored edits or object-property mutations during replay.
function validateRecord(record, baseline) {
  if (record?.version !== 1 || !Array.isArray(record.operations) || record.operations.length > 100000) throw Error("草稿操作日志无效或过大");
  const original = captureDesignOperationState(baseline);
  const pages = new Map(original.pages.map(page => [page.id, page]));
  const fields = ["name", "canvas", "tokens", "resources", "activePageId"];
  const types = ["set-document", "rename-page", "add-page", "remove-page", "reorder-pages", "replace-node", "add-node", "remove-node", "reorder-nodes"];
  for (const op of record.operations) {
    if (!op || !types.includes(op.type)) throw Error("草稿包含不支持的操作");
    const page = pages.get(op.pageId), nodes = page?.nodes ?? [];
    if (["add-page", "remove-page", "add-node", "remove-node"].includes(op.type) &&
        (!Number.isSafeInteger(op.index) || op.index < 0 || op.index > 100000)) throw Error("草稿操作位置无效");
    let matches = true;
    switch (op.type) {
      case "set-document": matches = fields.includes(op.field) && same(original[op.field], op.before); break;
      case "rename-page": matches = !!page && page.name === op.before && typeof op.after === "string"; break;
      case "add-page": matches = !!op.page && !pages.has(op.page.id) && Array.isArray(op.page.nodes); break;
      case "remove-page": {
        const before = pages.get(op.page?.id);
        matches = !!before && before.name === op.page.name &&
          (op.page.nodes === null || same(before.nodes, op.page.nodes)); break;
      }
      case "replace-node": matches = !!page && same(nodes.find(node => node.id === op.nodeId), op.before) && op.after?.id === op.nodeId; break;
      case "add-node": matches = !!page && !!op.node && !nodes.some(node => node.id === op.node.id); break;
      case "remove-node": matches = !!page && !!op.node && same(nodes.find(node => node.id === op.node.id), op.node); break;
      case "reorder-pages": matches = same(original.pages.map(p => p.id), op.before); break;
      case "reorder-nodes": matches = !!page && same(nodes.map(node => node.id), op.before); break;
    }
    if (op.type.startsWith("reorder-") && (!Array.isArray(op.after) || new Set(op.after).size !== op.after.length || op.after.some(id => typeof id !== "string"))) matches = false;
    if (!matches) throw Error(`草稿操作与基础设计不匹配：${op.type}`);
  }
}

export async function planDesignBackup(candidate, { readText, sha256, sha256Bytes }) {
  if (candidate.kind === "portable") return planPortableDesign(JSON.stringify(candidate.value), { sha256, sha256Bytes });
  let bytesRead = 0;
  const boundedRead = async path => {
    const result = await readText(path);
    const content = typeof result === "string" ? result : result?.content;
    if (typeof content !== "string") throw Error("无法读取草稿所需文件");
    bytesRead += byteLength(content);
    if (bytesRead > MAX_PORTABLE_DESIGN_BYTES) throw Error("草稿恢复读取超过 128 MiB");
    return { ...(typeof result === "object" ? result : {}), content };
  };
  const input = structuredClone(candidate.value);
  if (input?.format === RECOVERY_POINTER_FORMAT && input.bytes > MAX_PORTABLE_DESIGN_BYTES) throw Error("草稿分片日志过大");
  const recovery = await resolveRecoveryPersistence({ value: input, readText: boundedRead, sha256 });
  if (recovery?.format !== "codeshell.design.recovery" || ![1, 2].includes(recovery.version) || !isSafeDesignPath(recovery.path)) throw Error("草稿格式或设计路径无效");
  const baselinePath = recovery.version === 2 ? recovery.basePath : recovery.path;
  if (!isSafeDesignPath(baselinePath)) throw Error("草稿基础设计路径无效");
  let baseline;
  if (recovery.baseDocument) {
    if (recovery.baseRevision !== null || recovery.baseModifiedAt !== null) throw Error("草稿内置基础设计与版本记录不一致");
    baseline = Array.isArray(recovery.baseDocument.nodes)
      ? normalizeDesignState(recovery.baseDocument) : normalizeDesignDocument(recovery.baseDocument);
  } else {
    if (typeof recovery.baseRevision !== "string" || !/^sha256:[0-9a-f]{64}$/.test(recovery.baseRevision))
      throw Error("旧草稿没有可校验的基础版本；请提供原版本设计的完整备份，原日志保持不变");
    const primary = await boundedRead(baselinePath);
    if (`sha256:${await sha256(primary.content)}` !== recovery.baseRevision)
      throw Error("基础设计已变化或属于其他版本；请在保留原版本文件的项目中恢复");
    const indexed = await resolveDesignIndexDocument({ primarySource: primary.content, readText: boundedRead, sha256 });
    const resolved = indexed ?? await resolveDesignPersistenceSource({ primarySource: primary.content, readText: boundedRead, sha256 });
    baseline = normalizeDesignDocument(resolved.document ?? JSON.parse(resolved.source));
  }
  validateRecord(recovery.record, baseline);
  const draft = structuredClone(baseline);
  applyDesignOperationRecord(draft, recovery.record, "forward");
  const normalized = normalizeDesignState(draft);
  for (const op of recovery.record.operations) {
    if (op.type === "reorder-pages" && !same(normalized.pages.map(p => p.id), op.after)) throw Error("草稿页面排序不完整");
    if (op.type === "reorder-nodes" && !same(normalized.pages.find(p => p.id === op.pageId)?.nodes.map(n => n.id), op.after)) throw Error("草稿图层排序不完整");
  }
  const text = await createPortableDesign({ document: normalized, source: sourceOf(recovery), readText: boundedRead, sha256Bytes });
  return { ...await planPortableDesign(text, { sha256, sha256Bytes }), legacy: true };
}
