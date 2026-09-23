import { randomId } from "./ids.js";
// Serializable download metadata. Executable, directory and Cookie grants never
// cross a panel lifetime; restored records must obtain fresh Host handles.
export const LIBRARY_VERSION = 2;
export const MAX_QUEUE = 100;
export const MAX_HISTORY = 300;
// Leave room in the Host's 256 KiB app quota for saved video searches and preferences.
const MAX_BYTES = 190 * 1024;
const formats = new Set(["best", "2160", "1440", "1080", "720", "480", "360", "audio"]);
const text = (value, limit = 4096) => (typeof value === "string" ? value.slice(0, limit) : "");

export function videoUrl(value) {
  try {
    const url = new URL(text(value).trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

export function mediaIdentity(value, { playlist = false } = {}) {
  const normalized = videoUrl(value);
  if (!normalized) return "";
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
    if (playlist && url.searchParams.get("list"))
      return `youtube:list:${url.searchParams.get("list")}`;
    const id =
      host === "youtu.be"
        ? url.pathname.split("/")[1]
        : url.searchParams.get("v") || /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1];
    if (id) return `youtube:${id}`;
  }
  if (["bilibili.com", "m.bilibili.com"].includes(host)) {
    const id = /\/video\/(BV[a-zA-Z0-9]+|av\d+)/.exec(url.pathname)?.[1];
    if (id) return `bilibili:${id}${playlist ? ":all" : `:p${url.searchParams.get("p") || 1}`}`;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ["spm_id_from", "vd_source", "si", "feature"].includes(key))
      url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href;
}

export function parseVideoLinks(value) {
  const input = text(value, 80_000);
  const matches = input.match(/https?:\/\/[^\s<>"'，。；！？【】]+/gi) || [];
  const urls = [],
    duplicates = [],
    invalid = [];
  const seen = new Set();
  for (const raw of matches) {
    const url = videoUrl(raw.replace(/[),.;!\]）】]+$/, ""));
    if (!url) {
      invalid.push(raw);
      continue;
    }
    const identity = mediaIdentity(url);
    if (seen.has(identity)) {
      duplicates.push(url);
      continue;
    }
    seen.add(identity);
    urls.push(url);
  }
  if (!matches.length && input.trim()) invalid.push(input.trim());
  return {
    urls: urls.slice(0, MAX_QUEUE),
    duplicates,
    invalid,
    overflow: Math.max(0, urls.length - MAX_QUEUE),
  };
}

export function cleanConfiguration(value = {}) {
  return {
    format: formats.has(value.format) ? value.format : "best",
    playlist: value.playlist === true,
    playlistItems: text(value.playlistItems, 120),
    playlistEnd:
      Number.isInteger(value.playlistEnd) && value.playlistEnd > 0 && value.playlistEnd <= 500
        ? value.playlistEnd
        : null,
    subtitles: value.subtitles === true,
    subtitleMode: ["manual", "auto", "both"].includes(value.subtitleMode)
      ? value.subtitleMode
      : "manual",
    subtitleLanguages: text(value.subtitleLanguages, 120) || "zh-Hans,zh-Hant,en.*",
    subtitleLanguagePreset: text(value.subtitleLanguagePreset, 20) || "zh-en",
    embedSubtitles: value.embedSubtitles === true,
    cookieAccount: text(value.cookieAccount, 120) || null,
  };
}

export function configurationKey(value) {
  const c = cleanConfiguration(value);
  return JSON.stringify([
    c.format,
    c.playlist,
    c.playlist ? c.playlistItems : "",
    c.playlist && !c.playlistItems ? c.playlistEnd : null,
    c.subtitles,
    c.subtitles ? [c.subtitleMode, c.subtitleLanguages, c.embedSubtitles] : null,
  ]);
}

export function directoryIdentity(directory) {
  return text(directory?.path).replace(/\\/g, "/").replace(/\/$/, "");
}

export function duplicateCandidates(candidate, queue, history) {
  const key = mediaIdentity(candidate.url, candidate.configuration);
  const config = configurationKey(candidate.configuration);
  const directory = directoryIdentity(candidate.directory);
  const matches = (item) =>
    mediaIdentity(item.url, item.configuration) === key &&
    configurationKey(item.configuration) === config;
  return {
    queued: queue.find(
      (item) =>
        ["pending", "queued", "running", "paused", "restored", "interrupted"].includes(
          item.status,
        ) &&
        matches(item) &&
        directoryIdentity(item.directory) === directory,
    ),
    // Historical matches are only candidates. The caller must inspect every
    // actual output before showing a download as present or deciding to skip.
    history: history.filter((item) => (item.status || item.state) === "completed" && matches(item)),
  };
}

export function fileInventoryState(record) {
  if (!record.filesComplete || !record.files?.length) return "unknown";
  const states = record.files.map((file) => file.status);
  if (states.every((state) => state === "present")) return "present";
  if (states.some((state) => ["missing", "empty", "changed"].includes(state))) return "missing";
  return "unknown";
}

export function resourceFileFields(file) {
  return typeof file?.assetId === "string" && /^asset-[a-f0-9]{64}$/.test(file.assetId)
    ? { assetId: file.assetId }
    : {};
}

// The Host resolves the directory grant and checks containment again. Never send
// an absolute host path as a resource request or accept a traversal from history.
export function resourceRelativeFile(directory, file) {
  const base = String(directory?.path || "").replace(/\\/g, "/").replace(/(.)\/+$/, "$1");
  const path = String(file?.path || "").replace(/\\/g, "/");
  const prefix = base.endsWith("/") ? base : base + "/";
  const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  if (
    !base || !relative || /^(?:\/|[A-Za-z]:)/.test(relative) ||
    relative.split("/").some((part) =>
      !part || part === "." || part === ".." || /[:\u0000-\u001f\u007f]/.test(part),
    )
  )
    throw new Error("文件不在原下载目录内，请检查记录后重试。");
  return relative;
}

export function taskPackageReference(value) {
  if (
    !value || typeof value.version !== "string" || !value.version ||
    value.version.length > 128 || /[\u0000-\u001f\u007f]/.test(value.version) ||
    typeof value.packageDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.packageDigest)
  ) return undefined;
  return { version: value.version, packageDigest: value.packageDigest };
}

export function storedRecord(item) {
  if (!item || !videoUrl(item.url)) return null;
  const allFiles = Array.isArray(item.files) ? item.files : item.file ? [{ path: item.file }] : [];
  const files = allFiles
    .slice(0, 200)
    .filter((file) => file && text(file.path))
    .map((file) => ({
      path: text(file.path),
      ...resourceFileFields(file),
      ...(Number.isSafeInteger(file.bytes) && file.bytes >= 0 ? { bytes: file.bytes } : {}),
      ...(Number.isFinite(file.modifiedAt) && file.modifiedAt >= 0
        ? { modifiedAt: Math.trunc(file.modifiedAt) }
        : {}),
      // Cached state is informational, never authority for a future duplicate decision.
      status: ["present", "missing", "empty", "changed", "unavailable"].includes(file.status)
        ? file.status
        : "unavailable",
    }));
  return {
    queueId: text(item.queueId, 100) || randomId(),
    url: videoUrl(item.url),
    title: text(item.title, 500),
    configuration: cleanConfiguration(item.configuration),
    directory: {
      path: text(item.directory?.path),
      name: text(item.directory?.name, 160),
      kind: item.directory?.kind === "project" ? "project" : "chosen",
      ...(typeof item.directory?.bookmark === "string" &&
      /^[a-f0-9-]{36}$/i.test(item.directory.bookmark)
        ? { bookmark: item.directory.bookmark }
        : {}),
    },
    ...(typeof item.nativeTaskId === "string" && /^[a-f0-9-]{36}$/i.test(item.nativeTaskId)
      ? { nativeTaskId: item.nativeTaskId }
      : {}),
    // Display cache only; the Host verifies its own immutable record before retry.
    ...(taskPackageReference(item.nativePackage)
      ? { nativePackage: taskPackageReference(item.nativePackage) }
      : {}),
    ...(typeof item.nativeRequestKey === "string" &&
    /^download:[a-f0-9-]{36}$/i.test(item.nativeRequestKey)
      ? { nativeRequestKey: item.nativeRequestKey }
      : {}),
    ...(item.nativePaused === true ? { nativePaused: true } : {}),
    cookieCredentialId: text(item.cookieCredentialId, 200),
    ...(typeof item.cookieCredentialRevision === "string" &&
    /^[a-f0-9]{64}$/.test(item.cookieCredentialRevision)
      ? { cookieCredentialRevision: item.cookieCredentialRevision }
      : {}),
    ...(typeof item.cookieCredentialUrl === "string" && /^https:\/\//.test(item.cookieCredentialUrl)
      ? { cookieCredentialUrl: text(item.cookieCredentialUrl, 2048) }
      : {}),
    status: text(
      [
        "pending",
        "queued",
        "running",
        "paused",
        "restored",
        "interrupted",
        "completed",
        "failed",
        "cancelled",
      ].includes(item.status)
        ? item.status
        : item.state,
      20,
    ),
    percent: Number.isFinite(item.percent) ? Math.min(100, Math.max(0, item.percent)) : null,
    error: text(item.error, 500),
    finishedAt: Number.isFinite(item.finishedAt) ? item.finishedAt : null,
    addedAt: Number.isFinite(item.addedAt) ? item.addedAt : Date.now(),
    files,
    filesComplete: item.filesComplete === true && allFiles.length <= 200,
    ...(typeof item.copySuffix === "string" && /^[a-zA-Z0-9-]{1,40}$/.test(item.copySuffix)
      ? { copySuffix: item.copySuffix }
      : {}),
    ...(typeof item.overwrite === "boolean" ? { overwrite: item.overwrite } : {}),
  };
}

const concurrencyLimit = (value) =>
  Number.isInteger(value) && value >= 1 && value <= 4 ? value : 3;

export function serializeLibrary(
  { queue, history, queuePaused, directoryPreference, maxConcurrent },
  scope,
) {
  const result = {
    version: LIBRARY_VERSION,
    scope: text(scope),
    queuePaused: Boolean(queuePaused),
    maxConcurrent: concurrencyLimit(maxConcurrent),
    directoryPreference: directoryPreference?.path
      ? {
          path: text(directoryPreference.path),
          name: text(directoryPreference.name, 160),
          kind: directoryPreference.kind === "project" ? "project" : "chosen",
          ...(typeof directoryPreference.bookmark === "string" &&
          /^[a-f0-9-]{36}$/i.test(directoryPreference.bookmark)
            ? { bookmark: directoryPreference.bookmark }
            : {}),
        }
      : null,
    queue: queue.slice(0, MAX_QUEUE).map(storedRecord).filter(Boolean),
    history: history.slice(0, MAX_HISTORY).map(storedRecord).filter(Boolean),
    truncated: false,
  };
  const bytes = () => new TextEncoder().encode(JSON.stringify(result)).length;
  while (bytes() > MAX_BYTES && result.history.length) {
    result.history.pop();
    result.truncated = true;
  }
  // Keep the complete pending queue: a full store must be visible, not silently
  // drop work. Terminal queue inventories can be dropped with an explicit flag.
  if (bytes() > MAX_BYTES) {
    for (const item of result.queue) {
      if (
        !["pending", "queued", "running", "paused", "restored", "interrupted"].includes(item.status)
      ) {
        item.files = [];
        item.filesComplete = false;
        result.truncated = true;
      }
    }
  }
  if (bytes() > MAX_BYTES) throw new Error("下载记录空间已满，请清除已结束的任务后再添加。");
  return result;
}

export function restoreLibrary(snapshot, scope) {
  if (!snapshot || snapshot.version !== LIBRARY_VERSION || snapshot.scope !== scope) return null;
  const queue = (Array.isArray(snapshot.queue) ? snapshot.queue : [])
    .slice(0, MAX_QUEUE)
    .map(storedRecord)
    .filter(Boolean);
  for (const item of queue) {
    if (["running", "queued", "restored", "interrupted"].includes(item.status)) {
      item.status =
        item.status === "running" || item.status === "interrupted" ? "interrupted" : "restored";
    }
  }
  return {
    queue,
    maxConcurrent: concurrencyLimit(snapshot.maxConcurrent),
    history: (Array.isArray(snapshot.history) ? snapshot.history : [])
      .slice(0, MAX_HISTORY)
      .map(storedRecord)
      .filter(Boolean),
    directoryPreference:
      typeof snapshot.directoryPreference?.path === "string" && snapshot.directoryPreference.path
        ? {
            path: text(snapshot.directoryPreference.path),
            name: text(snapshot.directoryPreference.name, 160),
            kind: snapshot.directoryPreference.kind === "project" ? "project" : "chosen",
            ...(typeof snapshot.directoryPreference.bookmark === "string" &&
            /^[a-f0-9-]{36}$/i.test(snapshot.directoryPreference.bookmark)
              ? { bookmark: snapshot.directoryPreference.bookmark }
              : {}),
          }
        : null,
    queuePaused:
      queue.some((item) => ["restored", "interrupted"].includes(item.status)) ||
      snapshot.queuePaused === true,
    truncated: snapshot.truncated === true,
  };
}
