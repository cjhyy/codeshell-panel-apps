export const JD_INBOX_PATH = "career-data/jd/inbox";

export const JD_INTAKE_STATUS_IDS = [
  "staged",
  "processing",
  "imported",
  "needs_review",
  "duplicate",
  "failed",
];

export const JD_INTAKE_SOURCE_KIND_IDS = [
  "pasted_text",
  "image",
  "pdf",
  "document",
  "file",
  "project_file",
  "project_scan",
  "chat_export",
];

const STATUS_SET = new Set(JD_INTAKE_STATUS_IDS);
const SOURCE_KIND_SET = new Set(JD_INTAKE_SOURCE_KIND_IDS);

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function textList(value, maxItems, maxLength) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item, maxLength)).filter(Boolean))].slice(0, maxItems)
    : [];
}

export function normalizeJdIntakeItem(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const id = text(source.id, 100);
  const sourcePath = text(source.sourcePath, 1000);
  const originalName = text(source.originalName, 240);
  if (!id || (!sourcePath && !originalName)) return null;
  const status = text(source.status, 40);
  const sourceKind = text(source.sourceKind, 40);
  return {
    id,
    sourceKind: SOURCE_KIND_SET.has(sourceKind) ? sourceKind : "file",
    originalName: originalName || sourcePath.split("/").at(-1) || "JD 文件",
    sourcePath,
    status: STATUS_SET.has(status) ? status : "staged",
    summary: text(source.summary, 2000),
    jobIds: textList(source.jobIds, 20, 100),
    receivedAt: text(source.receivedAt, 80),
    updatedAt: text(source.updatedAt, 80),
    error: text(source.error, 2000),
  };
}

export function normalizeJdIntakeItems(input = []) {
  if (!Array.isArray(input)) return [];
  const items = new Map();
  for (const value of input) {
    const item = normalizeJdIntakeItem(value);
    if (item) items.set(item.id, item);
  }
  return [...items.values()].slice(-120);
}

export function upsertJdIntakeItems(existing = [], incoming = []) {
  const items = new Map(
    normalizeJdIntakeItems(existing).map((item) => [item.id, item]),
  );
  for (const value of incoming) {
    const item = normalizeJdIntakeItem(value);
    if (!item) continue;
    const current = items.get(item.id);
    items.set(item.id, current ? { ...current, ...item } : item);
  }
  return [...items.values()].slice(-120);
}

export function jdIntakeCounts(items = []) {
  const normalized = normalizeJdIntakeItems(items);
  return {
    total: normalized.length,
    pending: normalized.filter((item) => ["staged", "processing"].includes(item.status)).length,
    imported: normalized.filter((item) => item.status === "imported").length,
    attention: normalized.filter((item) => ["needs_review", "failed"].includes(item.status)).length,
  };
}
