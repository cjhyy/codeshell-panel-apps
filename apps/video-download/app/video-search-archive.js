export const SEARCH_ARCHIVE_VERSION = 1;
export const MAX_SEARCH_RECORDS = 30;
const MAX_ARCHIVE_BYTES = 48 * 1024;
const bounded = (value, limit) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "";

export function cleanSearchRecord(value, normalizeCandidates) {
  if (!value || typeof value !== "object" || !Array.isArray(value.platforms)) return null;
  const query = bounded(value.query, 1200);
  const platforms = [...new Set(value.platforms.filter((item) => ["youtube", "bilibili"].includes(item)))];
  if (!query || !platforms.length) return null;
  const safe = normalizeCandidates(value.candidates, platforms).slice(0, 8);
  const reasons = new Map(
    (Array.isArray(value.candidates) ? value.candidates : []).map((item) => [item?.url, bounded(item?.reason, 400)]),
  );
  const indexed = new Set(
    (Array.isArray(value.candidates) ? value.candidates : [])
      .filter((item) => ["search-index", "historical-index"].includes(item?.evidence))
      .map((item) => item.url),
  );
  return {
    id: bounded(value.id, 100) || crypto.randomUUID(),
    query,
    platforms,
    modelId: bounded(value.modelId, 256),
    provider: bounded(value.provider, 120),
    createdAt: Number.isFinite(value.createdAt) && value.createdAt > 0 ? value.createdAt : Date.now(),
    status: ["ready", "empty", "error"].includes(value.status) ? value.status : "ready",
    summary: bounded(value.summary, 500),
    candidates: safe.map((candidate) => ({ ...candidate, reason: reasons.get(candidate.url) || candidate.reason, evidence: indexed.has(candidate.url) ? "historical-index" : "historical" })),
  };
}

export function readSearchArchive(raw, scope, normalizeCandidates) {
  if (!raw || raw.version !== SEARCH_ARCHIVE_VERSION || raw.scope !== scope) {
    return { records: [], modelId: "" };
  }
  return {
    records: (Array.isArray(raw.records) ? raw.records : [])
      .slice(0, MAX_SEARCH_RECORDS)
      .map((item) => cleanSearchRecord(item, normalizeCandidates))
      .filter(Boolean),
    modelId: bounded(raw.modelId, 256),
  };
}

export function writeSearchArchive(records, modelId, scope, normalizeCandidates) {
  const snapshot = {
    version: SEARCH_ARCHIVE_VERSION,
    scope: bounded(scope, 4096),
    modelId: bounded(modelId, 256),
    records: records.slice(0, MAX_SEARCH_RECORDS).map((item) => cleanSearchRecord(item, normalizeCandidates)).filter(Boolean),
  };
  const size = () => new TextEncoder().encode(JSON.stringify(snapshot)).length;
  while (size() > MAX_ARCHIVE_BYTES && snapshot.records.length > 1) snapshot.records.pop();
  if (size() > MAX_ARCHIVE_BYTES) throw new Error("查询记录过大，请删除部分结果后重试。");
  return snapshot;
}
