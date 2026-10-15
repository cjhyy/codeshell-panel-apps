import { cleanConfiguration, videoUrl } from "./download-library.js";

const jobId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const statuses = new Set([
  "pending",
  "queued",
  "running",
  "cancelling",
  "paused",
  "restored",
  "interrupted",
  "completed",
  "failed",
  "cancelled",
]);
export const FINISHED_DOWNLOAD_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const text = (value, limit = 4096) => (typeof value === "string" ? value.slice(0, limit) : "");
const timestamp = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
const sourceNames = { chat: "聊天", cli: "终端", terminal: "终端", panel: "面板" };

export function downloadSourceLabel(record) {
  return record?.backend === "cli" ? sourceNames[record.source] || "终端" : "面板";
}

// This is a display model, never a persisted Host queue item. In particular, a
// CLI task cannot obtain a Host task, resource or Cookie grant by naming one.
export function normalizeCliRecord(record) {
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    !jobId.test(record.id) ||
    !statuses.has(record.status) ||
    !videoUrl(record.url)
  )
    return null;
  const inputFiles = Array.isArray(record.files) ? record.files : [];
  const files = inputFiles
    .slice(0, 200)
    .filter((file) => file && typeof file === "object" && text(file.path))
    .map((file) => ({
      path: text(file.path),
      ...(text(file.name, 500) ? { name: text(file.name, 500) } : {}),
      ...(Number.isSafeInteger(file.bytes) && file.bytes >= 0 ? { bytes: file.bytes } : {}),
      ...(timestamp(file.modifiedAt) !== null ? { modifiedAt: Math.trunc(file.modifiedAt) } : {}),
      ...(timestamp(file.checkedAt) !== null ? { checkedAt: file.checkedAt } : {}),
      ...(/^[a-f0-9]{64}$/.test(file.sha256) ? { sha256: file.sha256 } : {}),
      status: ["present", "missing", "empty", "changed", "unavailable"].includes(file.status)
        ? file.status
        : "unavailable",
    }));
  const fraction = record.progress?.fraction;
  const configuration = cleanConfiguration(record.configuration);
  const path = text(record.outputDirectory);
  const createdAt = timestamp(record.createdAt);
  return {
    queueId: `cli:${record.id}`,
    backend: "cli",
    cliJobId: record.id,
    id: record.id,
    url: videoUrl(record.url),
    title: text(record.title, 500) || videoUrl(record.url),
    status: record.status,
    canStart: record.status === "pending",
    percent: Number.isFinite(fraction) ? Math.min(100, Math.max(0, fraction * 100)) : null,
    configuration: { ...configuration, cookieAccount: null },
    progress: {
      stage: text(record.progress?.stage, 80),
      message: text(record.progress?.message, 500),
    },
    directory: {
      path,
      name: path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) || "下载目录",
      kind: "cli",
    },
    files,
    filesComplete: record.filesComplete !== false && files.length === inputFiles.length,
    addedAt: createdAt ?? 0,
    createdAt,
    updatedAt: timestamp(record.updatedAt),
    finishedAt: timestamp(record.finishedAt),
    ...(timestamp(record.checkedAt) !== null ? { checkedAt: record.checkedAt } : {}),
    ...(timestamp(record.archivedAt) !== null ? { archivedAt: record.archivedAt } : {}),
    ...(record.archived === true ? { archived: true } : {}),
    attempt: Number.isSafeInteger(record.attempt) && record.attempt >= 1 ? record.attempt : 1,
    source: Object.hasOwn(sourceNames, record.source) ? record.source : "cli",
    error: text(typeof record.error === "string" ? record.error : record.error?.message, 500),
    running: ["running", "cancelling"].includes(record.status),
    cancelRequested: Boolean(record.cancelRequestedAt) || record.status === "cancelling",
    ...(text(record.requestKey, 160) ? { requestKey: text(record.requestKey, 160) } : {}),
  };
}

const visible = (record) => record && record.archived !== true && !(record.archivedAt > 0);
const updated = (record) => record.updatedAt ?? record.finishedAt ?? record.addedAt ?? 0;

function cliRecords(jobs) {
  const records = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const record = normalizeCliRecord(job);
    if (!record) continue;
    const previous = records.get(record.queueId);
    if (!previous || updated(record) > updated(previous)) records.set(record.queueId, record);
  }
  return [...records.values()].filter(visible);
}

function combine(hostRecords, jobs, predicate) {
  // Host objects keep their identity and process fields for the existing durable
  // coordinator. Their IDs and storage remain separate from CLI ownership.
  const seen = new Set(),
    result = [];
  for (const record of Array.isArray(hostRecords) ? hostRecords : []) {
    if (!record || typeof record.queueId !== "string" || seen.has(`host:${record.queueId}`))
      continue;
    seen.add(`host:${record.queueId}`);
    result.push(record);
  }
  for (const record of cliRecords(jobs)) if (predicate(record)) result.push(record);
  return result;
}

export function getTaskRecords(hostQueue, jobs, { includeFinished = false } = {}) {
  return combine(
    hostQueue,
    jobs,
    (record) => includeFinished || !FINISHED_DOWNLOAD_STATUSES.has(record.status),
  );
}

export function getHistoryRecords(hostHistory, jobs) {
  return combine(hostHistory, jobs, (record) => FINISHED_DOWNLOAD_STATUSES.has(record.status)).sort(
    (a, b) =>
      (b.finishedAt ?? b.updatedAt ?? b.addedAt ?? 0) -
        (a.finishedAt ?? a.updatedAt ?? a.addedAt ?? 0) || a.queueId.localeCompare(b.queueId),
  );
}
