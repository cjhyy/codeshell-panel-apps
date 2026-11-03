import { nativeDataRoot } from "./native-data-context.mjs";
import { acquireOwnerLock } from "./owner-lock.mjs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

const STREAM_PATTERN = /^[a-z][a-z0-9-]{0,47}$/u;
const SCOPE_PATTERN = /^(?:global|[0-9a-f]{16}|(?:SH|SZ)\d{6}|US-[A-Z][A-Z0-9.-]{0,14})$/u;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export class LocalSnapshotError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function safeSegment(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new LocalSnapshotError("LOCAL_SNAPSHOT_PATH_INVALID", `${label} is invalid`);
  }
  return value;
}

function snapshotIdentity(snapshot) {
  const marketDate = snapshot?.marketDate;
  const phase = snapshot?.session?.phase;
  if (typeof marketDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(marketDate)) {
    throw new LocalSnapshotError("LOCAL_SNAPSHOT_INVALID", "snapshot marketDate is invalid");
  }
  if (!new Set(["intraday", "close", "previous-close"]).has(phase)) {
    throw new LocalSnapshotError("LOCAL_SNAPSHOT_INVALID", "snapshot phase is invalid");
  }
  return { marketDate, phase };
}

async function safeDirectory(root, stream, scope, namespace = "snapshots-v2", create = true) {
  const rootPath = await realpath(resolve(root));
  const requested = resolve(
    rootPath,
    namespace,
    safeSegment(stream, STREAM_PATTERN, "snapshot stream"),
    safeSegment(scope, SCOPE_PATTERN, "snapshot scope"),
  );
  if (!requested.startsWith(`${rootPath}${sep}`)) {
    throw new LocalSnapshotError("LOCAL_SNAPSHOT_PATH_INVALID", "snapshot path escaped local data root");
  }
  if (create) await mkdir(requested, { recursive: true, mode: 0o700 });
  const resolved = await realpath(requested).catch((error) => { if (!create && error.code === "ENOENT") return requested; throw error; });
  if (resolved !== requested || !resolved.startsWith(`${rootPath}${sep}`)) {
    throw new LocalSnapshotError("LOCAL_SNAPSHOT_PATH_INVALID", "snapshot directory is not local");
  }
  return resolved;
}

async function atomicWrite(path, content) {
  const directory = dirname(path);
  const temporary = resolve(directory, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
    const directoryHandle = await open(directory, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function writeLocalSnapshot({ root = nativeDataRoot(), stream, scope = "global", snapshot, hooks = {} }) {
  const { marketDate, phase } = snapshotIdentity(snapshot);
  const content = `${JSON.stringify(snapshot)}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_SNAPSHOT_BYTES) {
    throw new LocalSnapshotError("LOCAL_SNAPSHOT_TOO_LARGE", "snapshot exceeds local safety limit");
  }
  const directory = await safeDirectory(root, stream, scope);
  const historyDirectory = resolve(directory, "history");
  await mkdir(historyDirectory, { recursive: true, mode: 0o700 });
  const historyRealPath = await realpath(historyDirectory);
  if (historyRealPath !== historyDirectory) {
    throw new LocalSnapshotError("LOCAL_SNAPSHOT_PATH_INVALID", "snapshot history directory is not local");
  }
  const latestPath = resolve(directory, "latest.json");
  const historyPath = resolve(historyDirectory, `${marketDate}-${phase}.json`);
  const lock = await acquireOwnerLock(resolve(directory, "publish.lock"), { hooks });
  // Collection is already complete. A contending publisher must not discard
  // its stdout result, block the active owner, or claim an unwritten path.
  if (!lock.acquired) return Object.freeze({ latestPath: null, historyPath: null,
    bytes: 0, published: false, archivePublished: false, reason: "publisher-busy" });
  try {
    const timestamp = value => { const parsed = Date.parse(value ?? ""); return Number.isFinite(parsed) ? parsed : 0; };
    const rank = (value) => [value.marketDate, value.session?.phase === "intraday" ? 0 : 1,
      timestamp(value.asOf), timestamp(value.generatedAt)];
    const newer = (left, right) => {
      const a = rank(left), b = rank(right);
      for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
      return false;
    };
    const current = await readFile(latestPath, "utf8").then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    const archived = await readFile(historyPath, "utf8").then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    await hooks.beforePublish?.();
    await lock.assertOwned();
    const archivePublished = !archived || newer(snapshot, archived);
    if (archivePublished) await atomicWrite(historyPath, content);
    // Latest is the publication point. A crash after archive is safe: readers
    // continue to see the previous latest, and neither file can regress.
    const published = !current || newer(snapshot, current);
    if (published) await atomicWrite(latestPath, content);
    return Object.freeze({ latestPath: published ? latestPath : null, historyPath: archivePublished ? historyPath : null,
      bytes: published || archivePublished ? Buffer.byteLength(content, "utf8") : 0, published, archivePublished,
      reason: published ? null : "not-newer" });
  } finally { await lock.release(); }

}

export async function readLocalSnapshot({ root = nativeDataRoot(), stream, scope = "global" }) {
  const directory = await safeDirectory(root, stream, scope, "snapshots-v2", false);
  let path = resolve(directory, "latest.json");
  if (!await lstat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; })) path = resolve(await safeDirectory(root, stream, scope, "snapshots", false), "latest.json");
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new LocalSnapshotError("LOCAL_SNAPSHOT_MISSING", "local snapshot is missing");
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_SNAPSHOT_BYTES) {
    throw new LocalSnapshotError("LOCAL_SNAPSHOT_INVALID", "local snapshot file is unsafe");
  }
  const before = await stat(path);
  const content = await readFile(path, "utf8");
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new LocalSnapshotError("LOCAL_SNAPSHOT_CHANGED", "local snapshot changed while reading");
  }
  let snapshot;
  try {
    snapshot = JSON.parse(content);
  } catch {
    throw new LocalSnapshotError("LOCAL_SNAPSHOT_INVALID", "local snapshot is not valid JSON");
  }
  snapshotIdentity(snapshot);
  return snapshot;
}

export async function readLocalSnapshotHistory({ root = nativeDataRoot(), stream, scope = "global", limit = 40 }) {
  const maximum = Number.isInteger(limit) ? Math.min(120, Math.max(1, limit)) : 40;
  const entriesByName = new Map();
  for (const namespace of ["snapshots", "snapshots-v2"]) {
    const directory = await safeDirectory(root, stream, scope, namespace, false);
    const historyDirectory = resolve(directory, "history");
    const entries = await readdir(historyDirectory, { withFileTypes: true }).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
    for (const entry of entries) if (entry.isFile() && /^\d{4}-\d{2}-\d{2}-(?:intraday|close|previous-close)\.json$/u.test(entry.name)) entriesByName.set(entry.name, resolve(historyDirectory, entry.name));
  }
  const names = [...entriesByName.keys()].sort((left, right) => right.localeCompare(left)).slice(0, maximum);
  const snapshots = [];
  for (const name of names) {
    const path = entriesByName.get(name);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_SNAPSHOT_BYTES) continue;
    const before = await stat(path);
    const content = await readFile(path, "utf8");
    const after = await stat(path);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
    try {
      const snapshot = JSON.parse(content);
      snapshotIdentity(snapshot);
      snapshots.push(snapshot);
    } catch {
      // One corrupt archive must not prevent newer valid reviews from loading.
    }
  }
  return Object.freeze(snapshots);
}

export const LOCAL_SNAPSHOT_MAX_BYTES = MAX_SNAPSHOT_BYTES;
