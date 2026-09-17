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

async function safeDirectory(root, stream, scope) {
  const rootPath = await realpath(resolve(root));
  const requested = resolve(
    rootPath,
    "snapshots",
    safeSegment(stream, STREAM_PATTERN, "snapshot stream"),
    safeSegment(scope, SCOPE_PATTERN, "snapshot scope"),
  );
  if (!requested.startsWith(`${rootPath}${sep}`)) {
    throw new LocalSnapshotError("LOCAL_SNAPSHOT_PATH_INVALID", "snapshot path escaped local data root");
  }
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const resolved = await realpath(requested);
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
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function writeLocalSnapshot({ root = process.cwd(), stream, scope = "global", snapshot }) {
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
  await atomicWrite(historyPath, content);
  // Commit latest last: a failed archive write must never advertise a newer
  // latest snapshot that has no matching daily history entry.
  await atomicWrite(latestPath, content);
  return Object.freeze({ latestPath, historyPath, bytes: Buffer.byteLength(content, "utf8") });
}

export async function readLocalSnapshot({ root = process.cwd(), stream, scope = "global" }) {
  const directory = await safeDirectory(root, stream, scope);
  const path = resolve(directory, "latest.json");
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

export async function readLocalSnapshotHistory({ root = process.cwd(), stream, scope = "global", limit = 40 }) {
  const maximum = Number.isInteger(limit) ? Math.min(120, Math.max(1, limit)) : 40;
  const directory = await safeDirectory(root, stream, scope);
  const historyDirectory = resolve(directory, "history");
  let entries;
  try {
    entries = await readdir(historyDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze([]);
    throw error;
  }
  const names = entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}-(?:intraday|close|previous-close)\.json$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left))
    .slice(0, maximum);
  const snapshots = [];
  for (const name of names) {
    const path = resolve(historyDirectory, name);
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
