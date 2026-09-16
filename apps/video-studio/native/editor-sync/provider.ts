import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, opendir, rm } from "node:fs/promises";
import { join } from "node:path";
import { PortableProjectError } from "../../src/editor/portable-project";
import { importPortableProject } from "../editor-runtime/bundle";
import { openSyncDirectory, openSyncFile, sameIdentity, type SyncDirectory } from "./directory";
import {
  analyzeSnapshotGraph,
  snapshotBundlePath,
  snapshotCanonical,
  snapshotDigest,
  syncHash,
  syncObject,
  syncToken,
  verifySnapshot,
  SYNC_LIMITS,
  SnapshotSyncError,
  type EditorSnapshot,
  type BundlePresence,
  type SyncHistoryEntry,
} from "../../src/editor/snapshot-sync";

export interface SyncHistoryPage {
  inventory: string;
  total: number;
  entries: SyncHistoryEntry[];
  issues: Array<{ snapshotId: string; code: string }>;
  nextAfter: string | null;
}
export type SyncRequest =
  | { action: "history"; projectId: string; after: string | null; inventory: string | null }
  | { action: "publish"; snapshot: EditorSnapshot; incomingToken: string | null }
  | { action: "publication-status"; snapshot: EditorSnapshot; incomingToken: string }
  | { action: "pull"; projectId: string; snapshotId: string }
  | { action: "discard-incoming"; token: string };
const error = (code: string, message: string): never => {
  throw new SnapshotSyncError(code, message);
};
const id = (value: unknown) => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    error("INVALID_REQUEST", "工程标识无效");
  return value as string;
};
export function validateSyncRequest(value: unknown): SyncRequest {
  if (!value || typeof value !== "object") return error("INVALID_REQUEST", "同步请求无效");
  const action = Object.getOwnPropertyDescriptor(value, "action");
  if (!action || !("value" in action)) return error("INVALID_REQUEST", "同步请求无效");
  if (action.value === "history") {
    const data = syncObject(value, ["action", "projectId", "after", "inventory"]);
    if (
      (data.after !== null && !syncHash(data.after)) ||
      (data.inventory !== null && !syncHash(data.inventory))
    )
      return error("INVALID_REQUEST", "同步分页标识无效");
    return {
      action: "history",
      projectId: id(data.projectId),
      after: data.after as string | null,
      inventory: data.inventory as string | null,
    };
  }
  if (action.value === "pull") {
    const data = syncObject(value, ["action", "projectId", "snapshotId"]);
    if (!syncHash(data.snapshotId)) return error("INVALID_REQUEST", "快照标识无效");
    return { action: "pull", projectId: id(data.projectId), snapshotId: data.snapshotId };
  }
  if (action.value === "publication-status") {
    const data = syncObject(value, ["action", "snapshot", "incomingToken"]);
    if (!syncToken(data.incomingToken)) return error("INVALID_REQUEST", "传输标识无效");
    return {
      action: "publication-status",
      snapshot: data.snapshot as EditorSnapshot,
      incomingToken: data.incomingToken,
    };
  }
  if (action.value === "publish") {
    const data = syncObject(value, ["action", "snapshot", "incomingToken"]);
    if (data.incomingToken !== null && !syncToken(data.incomingToken))
      return error("INVALID_REQUEST", "传输标识无效");
    return {
      action: "publish",
      snapshot: data.snapshot as EditorSnapshot,
      incomingToken: data.incomingToken as string | null,
    };
  }
  if (action.value === "discard-incoming") {
    const data = syncObject(value, ["action", "token"]);
    if (!syncToken(data.token)) return error("INVALID_REQUEST", "传输标识无效");
    return { action: "discard-incoming", token: data.token };
  }
  return error("INVALID_REQUEST", "不支持的同步操作");
}
const prefix = ["mimi-sync", "v1"];
async function digestFile(
  directory: SyncDirectory,
  name: string,
  expectedBytes: number,
  signal: AbortSignal,
) {
  const opened = await openSyncFile(directory, name),
    hash = createHash("sha256"),
    buffer = Buffer.allocUnsafe(256 * 1024);
  let position = 0;
  try {
    if (opened.info.size !== expectedBytes)
      error("BUNDLE_SIZE_MISMATCH", "同步工程包大小不一致，可能尚未下载完成");
    while (position < expectedBytes) {
      signal.throwIfAborted();
      await directory.verify();
      const read = await opened.file.read(
        buffer,
        0,
        Math.min(buffer.length, expectedBytes - position),
        position,
      );
      if (!read.bytesRead) error("BUNDLE_SIZE_MISMATCH", "同步工程包被截断");
      hash.update(buffer.subarray(0, read.bytesRead));
      position += read.bytesRead;
    }
    const end = await opened.file.stat(),
      named = await lstat(opened.path);
    if (
      !sameIdentity(end, named) ||
      end.size !== opened.info.size ||
      end.mtimeMs !== opened.info.mtimeMs ||
      end.ctimeMs !== opened.info.ctimeMs
    )
      error("FILE_CHANGED", "同步文件在校验时发生变化");
    await directory.verify();
    return { sha256: hash.digest("hex"), info: end };
  } finally {
    await opened.file.close();
  }
}
async function readSnapshot(directory: SyncDirectory, snapshotId: string, projectId: string) {
  if (!syncHash(snapshotId)) error("INVALID_REQUEST", "快照标识无效");
  const opened = await openSyncFile(directory, `${snapshotId}.json`);
  try {
    if (opened.info.size > SYNC_LIMITS.recordBytes) error("LIMIT_EXCEEDED", "快照记录超过大小限制");
    // One bounded read: a concurrent writer cannot grow readFile() without bound.
    const buffer = Buffer.alloc(SYNC_LIMITS.recordBytes + 1),
      { bytesRead } = await opened.file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== opened.info.size || bytesRead > SYNC_LIMITS.recordBytes)
      error("FILE_CHANGED", "同步快照尚未完整写入");
    const snapshot = await verifySnapshot(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead))),
    );
    if (snapshot.id !== snapshotId || snapshot.projectId !== projectId)
      error("PROJECT_MISMATCH", "快照文件名或工程标识不一致");
    await directory.verify();
    return snapshot;
  } finally {
    await opened.file.close();
  }
}
async function presence(
  directory: SyncDirectory,
  snapshot: EditorSnapshot,
): Promise<BundlePresence> {
  try {
    await directory.verify();
    const info = await lstat(directory.location(`${snapshot.bundle.sha256}.mimiproject`));
    return !info.isFile() || info.isSymbolicLink()
      ? "unsafe"
      : info.size !== snapshot.bundle.bytes
        ? "size-mismatch"
        : "present-unverified";
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw cause;
  }
}
async function noClobberBytes(directory: SyncDirectory, name: string, bytes: Uint8Array) {
  const scratch = `pending-${randomUUID()}.tmp`,
    path = directory.location(scratch),
    file = await open(path, "wx", 0o600);
  try {
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await directory.verify();
    try {
      await link(path, directory.location(name));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      const existing = await openSyncFile(directory, name);
      try {
        if (existing.info.size !== bytes.length)
          error("IMMUTABLE_CONFLICT", "同步对象已经存在但内容不同，未覆盖");
        const read = Buffer.alloc(bytes.length + 1),
          result = await existing.file.read(read, 0, read.length, 0);
        if (result.bytesRead !== bytes.length || !read.subarray(0, result.bytesRead).equals(bytes))
          error("IMMUTABLE_CONFLICT", "同步对象已经存在但内容不同，未覆盖");
      } finally {
        await existing.file.close();
      }
    }
    await directory.sync();
  } finally {
    await file.close().catch(() => {});
    await directory.verify(true);
    await rm(path, { force: true });
  }
}
async function validateBundle(
  root: string,
  directory: SyncDirectory,
  name: string,
  snapshot: EditorSnapshot,
  signal: AbortSignal,
) {
  const checked = await digestFile(directory, name, snapshot.bundle.bytes, signal);
  if (checked.sha256 !== snapshot.bundle.sha256)
    error("BUNDLE_HASH_MISMATCH", "同步工程包摘要不一致，请等待下载完成或从另一台设备补回");
  const scratch = await openSyncDirectory(root, [...prefix, "scratch"], true, signal),
    own = `verify-${randomUUID()}`,
    ownPath = scratch.location(own);
  try {
    await mkdir(ownPath, { mode: 0o700 });
    await directory.verify();
    const imported = await importPortableProject({
      inputPath: join(directory.path, name),
      workDir: join(scratch.path, own),
      sourceRoots: [root],
      signal,
    });
    if (imported.document.id !== snapshot.projectId)
      error("PROJECT_MISMATCH", "工程包与快照属于不同工程");
    const current = await lstat(directory.location(name));
    if (
      !sameIdentity(current, checked.info) ||
      current.size !== checked.info.size ||
      current.mtimeMs !== checked.info.mtimeMs ||
      current.ctimeMs !== checked.info.ctimeMs
    )
      error("FILE_CHANGED", "工程包在校验时被替换");
    await directory.verify();
    return checked;
  } catch (cause) {
    if (cause instanceof PortableProjectError)
      throw new SnapshotSyncError(cause.code, cause.message);
    throw cause;
  } finally {
    try {
      await scratch.verify(true);
      await rm(ownPath, { recursive: true, force: true });
    } finally {
      await scratch.close();
    }
  }
}
export async function runSyncRequest(
  root: string,
  value: unknown,
  signal: AbortSignal = new AbortController().signal,
): Promise<unknown> {
  const request = validateSyncRequest(value);
  if (request.action === "discard-incoming") {
    const incoming = await openSyncDirectory(root, [...prefix, "incoming"], true, signal);
    try {
      await incoming.verify();
      const name = `${request.token}.mimiproject`;
      const info = await lstat(incoming.location(name)).catch((cause) => {
        if (cause.code === "ENOENT") return undefined;
        throw cause;
      });
      if (info && (!info.isFile() || info.isSymbolicLink()))
        error("UNSAFE_FILE", "暂存对象不是普通文件");
      if (info) await rm(incoming.location(name));
      return { discarded: true };
    } finally {
      await incoming.close();
    }
  }
  const snapshot =
      request.action === "publish" || request.action === "publication-status"
        ? await verifySnapshot(request.snapshot)
        : undefined,
    projectId = snapshot?.projectId ?? (request as { projectId: string }).projectId;
  const projectKey = await snapshotDigest(projectId),
    records = await openSyncDirectory(
      root,
      [...prefix, "projects", projectKey, "snapshots"],
      true,
      signal,
    ),
    bundles = await openSyncDirectory(root, [...prefix, "bundles"], true, signal).catch(
      async (cause) => {
        await records.close();
        throw cause;
      },
    );
  try {
    if (request.action === "history") {
      // Immutable filenames are the stable inventory; replacing content never authorizes a different digest.
      const names: string[] = [];
      let scanned = 0;
      const listing = await opendir(records.path);
      for await (const entry of listing) {
        signal.throwIfAborted();
        if (++scanned > SYNC_LIMITS.snapshots * 2)
          error("LIMIT_EXCEEDED", "同步目录记录过多，超过本次扫描限制");
        if (/^pending-[a-f0-9-]+\.tmp$/.test(entry.name)) continue;
        if (!entry.isFile() || entry.isSymbolicLink() || !/^([a-f0-9]{64})\.json$/.test(entry.name))
          error("UNSAFE_FILE", "快照目录包含不支持的文件或链接");
        if (names.length >= SYNC_LIMITS.snapshots)
          error("LIMIT_EXCEEDED", "工程快照超过 10000 条，未返回截断历史");
        names.push(entry.name);
      }
      await records.verify();
      const ids = names.map((name) => name.slice(0, -5)).sort(),
        inventory = await snapshotDigest(ids.join("\n"));
      if (request.inventory !== null && request.inventory !== inventory)
        error("INVENTORY_CHANGED", "同步目录新增了快照，请刷新完整历史");
      const page = ids
          .filter((value) => request.after === null || value > request.after)
          .slice(0, SYNC_LIMITS.pageSize),
        entries: SyncHistoryEntry[] = [],
        issues: SyncHistoryPage["issues"] = [];
      for (const snapshotId of page) {
        signal.throwIfAborted();
        try {
          const item = await readSnapshot(records, snapshotId, projectId);
          entries.push({ snapshot: item, bundleState: await presence(bundles, item) });
        } catch (cause) {
          if (signal.aborted) throw cause;
          issues.push({
            snapshotId,
            code: cause instanceof SnapshotSyncError ? cause.code : "INVALID_SNAPSHOT",
          });
        }
      }
      await records.verify();
      return {
        inventory,
        total: ids.length,
        entries,
        issues,
        nextAfter: page.length && page.at(-1) !== ids.at(-1) ? page.at(-1)! : null,
      } satisfies SyncHistoryPage;
    }
    if (request.action === "pull") {
      const item = await readSnapshot(records, request.snapshotId, projectId);
      await validateBundle(root, bundles, `${item.bundle.sha256}.mimiproject`, item, signal);
      return {
        snapshot: item,
        bundle: {
          path: snapshotBundlePath(item.bundle.sha256),
          sha256: item.bundle.sha256,
          bytes: item.bundle.bytes,
        },
      };
    }
    const item = snapshot!;
    if (request.action === "publication-status") {
      const existing = await readSnapshot(records, item.id, projectId).catch((cause) => {
        if (cause.code === "ENOENT") return undefined;
        throw cause;
      });
      const present = await presence(bundles, item);
      if (present === "present-unverified") {
        await validateBundle(root, bundles, `${item.bundle.sha256}.mimiproject`, item, signal);
        return { state: existing ? "published" : "bundle-ready" };
      }
      if (present !== "missing")
        error("IMMUTABLE_CONFLICT", "已有工程包不完整或损坏，未覆盖；请从可信设备恢复");
      const incoming = await openSyncDirectory(root, [...prefix, "incoming"], true, signal);
      try {
        const found = await lstat(incoming.location(`${request.incomingToken}.mimiproject`)).catch(
          (cause) => {
            if (cause.code === "ENOENT") return undefined;
            throw cause;
          },
        );
        if (!found) return { state: "missing" };
        if (!found.isFile() || found.isSymbolicLink())
          error("UNSAFE_FILE", "同步暂存对象不是普通文件");
        if (found.size !== item.bundle.bytes) return { state: "incoming-invalid" };
        const checked = await digestFile(
          incoming,
          `${request.incomingToken}.mimiproject`,
          item.bundle.bytes,
          signal,
        );
        return {
          state: checked.sha256 === item.bundle.sha256 ? "incoming-ready" : "incoming-invalid",
        };
      } finally {
        await incoming.close();
      }
    }
    // Publishing a child requires the full parent DAG locally. External propagation may still arrive in any order.
    const parents: EditorSnapshot[] = [],
      queued = [...item.parents],
      seen = new Set<string>();
    while (queued.length) {
      signal.throwIfAborted();
      const parent = queued.pop()!;
      if (seen.has(parent)) continue;
      seen.add(parent);
      if (seen.size >= SYNC_LIMITS.snapshots) error("LIMIT_EXCEEDED", "快照历史超过发布限制");
      let value: EditorSnapshot;
      try {
        value = await readSnapshot(records, parent, projectId);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT")
          error("MISSING_PARENT", "父快照尚未同步完成，未发布新版本");
        throw cause;
      }
      parents.push(value);
      queued.push(...value.parents);
    }
    analyzeSnapshotGraph([...parents, item]);
    const incoming = request.incomingToken
      ? await openSyncDirectory(root, [...prefix, "incoming"], true, signal)
      : undefined;
    try {
      const staged = incoming
        ? await lstat(incoming.location(`${request.incomingToken}.mimiproject`)).catch((cause) => {
            if (cause.code === "ENOENT") return undefined;
            throw cause;
          })
        : undefined;
      const source = staged ? incoming! : bundles,
        sourceName = staged
          ? `${request.incomingToken}.mimiproject`
          : `${item.bundle.sha256}.mimiproject`;
      const verified = await validateBundle(root, source, sourceName, item, signal),
        target = `${item.bundle.sha256}.mimiproject`;
      if (incoming && staged) {
        await incoming.verify();
        await bundles.verify();
        await link(incoming.location(sourceName), bundles.location(target)).catch(async (cause) => {
          if (cause.code !== "EEXIST") throw cause;
          const old = await digestFile(bundles, target, item.bundle.bytes, signal);
          if (old.sha256 !== item.bundle.sha256)
            error("IMMUTABLE_CONFLICT", "已有工程包损坏，未覆盖；请从可信设备恢复该摘要文件");
        });
        await bundles.sync();
        const present = await digestFile(bundles, target, item.bundle.bytes, signal);
        if (present.sha256 !== item.bundle.sha256)
          error("BUNDLE_HASH_MISMATCH", "发布后的工程包校验失败");
      }
      signal.throwIfAborted();
      await noClobberBytes(
        records,
        `${item.id}.json`,
        new TextEncoder().encode(snapshotCanonical(item)),
      );
      if (incoming && staged) {
        await incoming.verify();
        const current = await lstat(incoming.location(sourceName));
        if (sameIdentity(current, verified.info)) await rm(incoming.location(sourceName));
      }
      return {
        snapshot: item,
        bundle: { path: snapshotBundlePath(item.bundle.sha256), ...item.bundle },
        published: true,
      };
    } finally {
      await incoming?.close();
    }
  } finally {
    await Promise.all([records.close(), bundles.close()]);
  }
}
