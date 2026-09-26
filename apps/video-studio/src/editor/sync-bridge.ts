import { randomId } from "../ids.js";
import { createPanelRuntime, runtimeCancelled, type RuntimeBridge } from "../sdk/panel-runtime";
import { isResourceId } from "../external-media";
import {
  analyzeSnapshotGraph,
  snapshotBundlePath,
  snapshotIncomingPath,
  syncArray,
  syncHash,
  syncObject,
  syncToken,
  verifySnapshot,
  SYNC_LIMITS,
  SnapshotSyncError,
  type EditorSnapshot,
  type SnapshotGraph,
  type BundlePresence,
  type SyncHistoryEntry,
} from "./snapshot-sync";
import type { EditorTaskArtifact } from "./task-bridge";
export interface EditorSyncDirectory {
  handle: string;
  name: string;
}
export interface EditorSyncPublicationReceipt {
  snapshot: EditorSnapshot;
  token: string;
  bundle: EditorTaskArtifact;
  supersededTokens: string[];
}
export interface EditorSyncOptions {
  signal?: AbortSignal;
}
export interface EditorSyncPublishOptions extends EditorSyncOptions {
  onReceipt?(receipt: EditorSyncPublicationReceipt): void | Promise<void>;
}
export interface EditorSyncHistory {
  graph: SnapshotGraph;
  entries: SyncHistoryEntry[];
  issues: Array<{ snapshotId: string; code: string }>;
  inventory: string;
}
const METHODS = [
  "filesystem.pickDirectory",
  "process.find",
  "process.resolveEntry",
  "process.spawn",
  "process.get",
  "process.cancel",
  "process.write",
  "process.end",
  "resources.materialize",
  "resources.capture",
  "resources.get",
];
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function invalid(): never {
  throw new SnapshotSyncError("INVALID_SYNC_RESPONSE", "同步工具返回了无效或不完整的结果");
}
const bytes = (value: string) => new TextEncoder().encode(value).length;
function artifact(value: unknown): EditorTaskArtifact {
  const data = syncObject(value, [
    "id",
    "sha256",
    "bytes",
    "mimeType",
    ...(value && typeof value === "object" && Object.hasOwn(value, "name") ? ["name"] : []),
  ]);
  if (
    !isResourceId(data.id) ||
    !syncHash(data.sha256) ||
    !Number.isSafeInteger(data.bytes) ||
    Number(data.bytes) < 1 ||
    Number(data.bytes) > SYNC_LIMITS.bundleBytes ||
    data.mimeType !== "application/zip" ||
    (data.name !== undefined && (typeof data.name !== "string" || data.name.length > 240))
  )
    invalid();
  return {
    id: data.id as string,
    sha256: data.sha256 as string,
    bytes: data.bytes as number,
    mimeType: "application/zip",
    ...(typeof data.name === "string" ? { name: data.name } : {}),
  };
}
export function validateEditorSyncPublicationReceipt(value: unknown): EditorSyncPublicationReceipt {
  const data = syncObject(value, ["snapshot", "token", "bundle", "supersededTokens"]);
  if (!syncToken(data.token)) invalid();
  const supersededTokens = syncArray(data.supersededTokens, 16).map((token) => {
    if (!syncToken(token) || token === data.token) invalid();
    return token;
  });
  if (new Set(supersededTokens).size !== supersededTokens.length) invalid();
  return {
    snapshot: data.snapshot as EditorSnapshot,
    token: data.token as string,
    bundle: artifact(data.bundle),
    supersededTokens,
  };
}
function pause(signal: AbortSignal, ms = 350) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(runtimeCancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
/** Directory handles are deliberately ephemeral. Only pickDirectory() can register one in this client. */
export function createEditorSyncBridge(panel: RuntimeBridge, options: { guard?(): void } = {}) {
  const runtime = createPanelRuntime(panel),
    grants = new Map<string, { name: string; cwd: string }>(),
    operations = new Set<AbortController>();
  let disposed = false,
    running = false,
    executable: Promise<{ executableHandle: string; entryHandle: string }> | undefined;
  function stopped(signal?: AbortSignal) {
    if (disposed || signal?.aborted) throw runtimeCancelled();
    options.guard?.();
  }
  async function authorized(directory: EditorSyncDirectory, signal?: AbortSignal) {
    stopped(signal);
    const grant = grants.get(directory.handle);
    if (!grant || grant.name !== directory.name)
      throw new SnapshotSyncError("DIRECTORY_GRANT_EXPIRED", "请在当前面板重新选择同步文件夹");
    const context = await panel.getContext();
    stopped(signal);
    if (String(context.cwd ?? "") !== grant.cwd)
      throw new SnapshotSyncError("WORKSPACE_CHANGED", "当前工作区已切换，请重新连接同步文件夹");
  }
  async function tools() {
    executable ??= (async () => {
      let handle: string | undefined;
      for (const name of ["node", "nodejs"]) {
        const found = await runtime.call("process.find", { name });
        if (!object(found) || typeof found.available !== "boolean") invalid();
        if (found.available) {
          if (!syncToken(found.handle)) invalid();
          handle = found.handle;
          break;
        }
      }
      if (!handle)
        throw new SnapshotSyncError("NODE_MISSING", "同步文件夹需要本地 Node.js 20 或更高版本");
      const entry = await runtime.call("process.resolveEntry", {
        name: "editor-sync",
        executableHandle: handle,
      });
      if (
        !object(entry) ||
        entry.name !== "editor-sync" ||
        !syncToken(entry.handle) ||
        !syncHash(entry.sha256)
      )
        invalid();
      return { executableHandle: handle, entryHandle: entry.handle };
    })().catch((cause) => {
      executable = undefined;
      throw cause;
    });
    return executable;
  }
  async function cancel(processId: string) {
    try {
      const request = panel.callResult
        ? panel.callResult("process.cancel", { processId })
        : panel.call("process.cancel", { processId });
      await request;
    } catch {
      /* Host also stops owned processes when the panel closes. */
    }
  }
  async function run(
    directory: EditorSyncDirectory,
    request: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    await authorized(directory, signal);
    const handles = await tools();
    await authorized(directory, signal);
    const input = JSON.stringify(request);
    if (bytes(input) > 32 * 1024) throw new SnapshotSyncError("LIMIT_EXCEEDED", "同步请求超过限制");
    let processId: string | undefined,
      completed = false,
      cursor = 0,
      stdout = "",
      stderr = "";
    const abort = () => {
      if (processId) void cancel(processId);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const pending = runtime.call(
        "process.spawn",
        { ...handles, directoryHandle: directory.handle, args: [], stdin: "pipe" },
        signal,
      );
      // An approval dialog may finish after cancel/dispose. Always reclaim that late process.
      void pending
        .then((value) => {
          if ((signal.aborted || disposed) && object(value) && syncToken(value.processId))
            void cancel(value.processId);
        })
        .catch(() => {});
      const started = await pending;
      if (!object(started) || !syncToken(started.processId)) invalid();
      processId = started.processId;
      await authorized(directory, signal);
      let total = 0;
      for (let offset = 0; offset < input.length; ) {
        let end = Math.min(input.length, offset + 4096);
        if (end < input.length && /[\uD800-\uDBFF]/.test(input[end - 1]!)) end--;
        const text = input.slice(offset, end),
          written = await runtime.call("process.write", { processId, text }, signal);
        total += bytes(text);
        if (
          !object(written) ||
          written.bytesWritten !== bytes(text) ||
          written.totalBytes !== total
        )
          invalid();
        offset = end;
      }
      const ended = await runtime.call("process.end", { processId }, signal);
      if (!object(ended) || ended.ended !== true || ended.totalBytes !== total) invalid();
      const deadline = Date.now() + 2 * 60 * 60 * 1000;
      for (;;) {
        await authorized(directory, signal);
        const page = await runtime.call(
          "process.get",
          { processId, afterSequence: cursor, limit: 128 },
          signal,
        );
        if (
          !object(page) ||
          page.found !== true ||
          page.processId !== processId ||
          page.truncated !== false ||
          !["running", "stopping", "exited"].includes(page.status) ||
          !Array.isArray(page.events) ||
          page.events.length > 128 ||
          !Number.isSafeInteger(page.nextSequence) ||
          page.nextSequence < cursor ||
          !Number.isSafeInteger(page.sequence) ||
          page.sequence < page.nextSequence ||
          typeof page.hasMore !== "boolean"
        )
          invalid();
        for (const event of page.events) {
          if (!object(event) || event.sequence !== cursor + 1 || !object(event.payload)) invalid();
          if (event.event === "process.output") {
            if (
              !["stdout", "stderr"].includes(event.payload.stream) ||
              typeof event.payload.text !== "string" ||
              event.payload.text.length > 16384
            )
              invalid();
            if (event.payload.stream === "stdout") stdout += event.payload.text;
            else stderr += event.payload.text;
            if (bytes(stdout) + bytes(stderr) > 240 * 1024) invalid();
          } else if (event.event !== "process.exit") invalid();
          cursor = event.sequence;
        }
        if (
          page.nextSequence !== cursor ||
          page.hasMore !== cursor < page.sequence ||
          (page.hasMore && !page.events.length)
        )
          invalid();
        if (page.hasMore) continue;
        if (page.status === "exited") {
          completed = true;
          stopped(signal);
          if (page.cancelRequested === true) throw runtimeCancelled();
          let result: unknown;
          try {
            result = JSON.parse(stdout);
          } catch {
            invalid();
          }
          if (!object(result) || typeof result.ok !== "boolean") invalid();
          if (!result.ok) {
            if (
              !object(result.error) ||
              typeof result.error.code !== "string" ||
              !/^[A-Z_]{1,64}$/.test(result.error.code) ||
              typeof result.error.message !== "string" ||
              result.error.message.length > 500
            )
              invalid();
            throw new SnapshotSyncError(result.error.code, result.error.message);
          }
          if (page.code !== 0 || (page.signal !== null && page.signal !== undefined)) invalid();
          return result.value;
        }
        if (Date.now() > deadline)
          throw new SnapshotSyncError(
            "SYNC_TIMEOUT",
            "同步仍未完成，已停止本次操作；可重新检查不可变快照后重试",
          );
        await pause(signal);
      }
    } finally {
      signal.removeEventListener("abort", abort);
      if (processId && !completed) await cancel(processId);
    }
  }
  async function operation<T>(
    directory: EditorSyncDirectory,
    external: AbortSignal | undefined,
    callback: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    stopped(external);
    if (running) throw new SnapshotSyncError("SYNC_BUSY", "已有同步操作正在进行，请等待完成或取消");
    running = true;
    const controller = new AbortController(),
      abort = () => controller.abort();
    operations.add(controller);
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) abort();
    try {
      await runtime.requireMethods(METHODS);
      await authorized(directory, controller.signal);
      return await callback(controller.signal);
    } finally {
      external?.removeEventListener("abort", abort);
      operations.delete(controller);
      running = false;
    }
  }
  async function history(
    directory: EditorSyncDirectory,
    projectId: string,
    opts: EditorSyncOptions = {},
  ): Promise<EditorSyncHistory> {
    return operation(directory, opts.signal, async (signal) => {
      const entries: SyncHistoryEntry[] = [],
        issues: EditorSyncHistory["issues"] = [];
      let after: string | null = null,
        inventory: string | null = null,
        total: number | undefined;
      for (;;) {
        const value = await run(
            directory,
            { action: "history", projectId, after, inventory },
            signal,
          ),
          page = syncObject(value, ["inventory", "total", "entries", "issues", "nextAfter"]);
        if (
          !syncHash(page.inventory) ||
          !Number.isSafeInteger(page.total) ||
          Number(page.total) < 0 ||
          Number(page.total) > SYNC_LIMITS.snapshots ||
          (inventory !== null && page.inventory !== inventory) ||
          (total !== undefined && page.total !== total) ||
          (page.nextAfter !== null &&
            (!syncHash(page.nextAfter) || (after !== null && page.nextAfter <= after)))
        )
          invalid();
        inventory = page.inventory as string;
        total = page.total as number;
        const ids: string[] = [];
        for (const raw of syncArray(page.entries, SYNC_LIMITS.pageSize)) {
          const item = syncObject(raw, ["snapshot", "bundleState"]),
            snapshot = await verifySnapshot(item.snapshot);
          if (
            snapshot.projectId !== projectId ||
            !["present-unverified", "missing", "size-mismatch", "unsafe"].includes(
              item.bundleState as string,
            )
          )
            invalid();
          ids.push(snapshot.id);
          entries.push({ snapshot, bundleState: item.bundleState as BundlePresence });
        }
        for (const raw of syncArray(page.issues, SYNC_LIMITS.pageSize)) {
          const issue = syncObject(raw, ["snapshotId", "code"]);
          if (
            !syncHash(issue.snapshotId) ||
            typeof issue.code !== "string" ||
            !/^[A-Z_]{1,64}$/.test(issue.code)
          )
            invalid();
          ids.push(issue.snapshotId);
          issues.push({ snapshotId: issue.snapshotId, code: issue.code });
        }
        if (
          ids.length > SYNC_LIMITS.pageSize ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => after !== null && id <= after) ||
          entries.length + issues.length > total
        )
          invalid();
        if (page.nextAfter === null) break;
        if (!ids.length || [...ids].sort().at(-1) !== page.nextAfter) invalid();
        after = page.nextAfter as string;
      }
      if (
        entries.length + issues.length !== total ||
        new Set([
          ...entries.map((item) => item.snapshot.id),
          ...issues.map((item) => item.snapshotId),
        ]).size !== total
      )
        invalid();
      await authorized(directory, signal);
      const graph = analyzeSnapshotGraph(entries.map((item) => item.snapshot));
      if (issues.length) graph.complete = false;
      return { graph, entries, issues, inventory: inventory! };
    });
  }
  async function publish(
    directory: EditorSyncDirectory,
    input: {
      snapshot: EditorSnapshot;
      bundle: EditorTaskArtifact;
      receipt?: EditorSyncPublicationReceipt;
    },
    opts: EditorSyncPublishOptions = {},
  ) {
    return operation(directory, opts.signal, async (signal) => {
      const snapshot = await verifySnapshot(input.snapshot),
        bundle = artifact(input.bundle),
        receipt = input.receipt
          ? validateEditorSyncPublicationReceipt(input.receipt)
          : { snapshot, token: randomId(), bundle, supersededTokens: [] };
      receipt.snapshot = await verifySnapshot(receipt.snapshot);
      if (
        receipt.snapshot.id !== snapshot.id ||
        receipt.bundle.sha256 !== bundle.sha256 ||
        receipt.bundle.bytes !== bundle.bytes ||
        receipt.bundle.id !== bundle.id ||
        snapshot.bundle.sha256 !== bundle.sha256 ||
        snapshot.bundle.bytes !== bundle.bytes
      )
        throw new SnapshotSyncError("RECEIPT_MISMATCH", "续传记录与冻结工程包不一致");
      await opts.onReceipt?.(structuredClone(receipt));
      await authorized(directory, signal);
      const status = await run(
        directory,
        { action: "publication-status", snapshot, incomingToken: receipt.token },
        signal,
      );
      if (
        !object(status) ||
        !["published", "bundle-ready", "incoming-ready", "incoming-invalid", "missing"].includes(
          status.state,
        )
      )
        invalid();
      if (status.state === "published") return { snapshot, receipt: structuredClone(receipt) };
      if (status.state === "incoming-invalid") {
        if (receipt.supersededTokens.length >= 16)
          throw new SnapshotSyncError(
            "RECOVERY_LIMIT",
            "暂存恢复次数达到限制，请清理本次暂存后重新发布",
          );
        receipt.supersededTokens.push(receipt.token);
        receipt.token = randomId();
        await opts.onReceipt?.(structuredClone(receipt));
        await authorized(directory, signal);
      }
      if (status.state === "missing" || status.state === "incoming-invalid") {
        const source = await runtime.call("resources.get", { id: bundle.id }, signal);
        const saved = object(source) ? source.asset : undefined;
        if (
          !object(saved) ||
          saved.id !== bundle.id ||
          saved.bytes !== bundle.bytes ||
          saved.sha256 !== bundle.sha256
        )
          invalid();
        const copied = await runtime.call(
          "resources.materialize",
          {
            assetId: bundle.id,
            directoryHandle: directory.handle,
            path: snapshotIncomingPath(receipt.token),
          },
          signal,
        );
        if (
          !object(copied) ||
          copied.assetId !== bundle.id ||
          copied.path !== snapshotIncomingPath(receipt.token) ||
          copied.bytes !== bundle.bytes ||
          copied.sha256 !== bundle.sha256
        )
          invalid();
      }
      // Resume verified bytes; absent staging is rebuilt only from the exact sealed resource hash.
      const value = await run(
          directory,
          { action: "publish", snapshot, incomingToken: receipt.token },
          signal,
        ),
        result = syncObject(value, ["snapshot", "bundle", "published"]);
      const publishedBundle = syncObject(result.bundle, ["path", "sha256", "bytes"]);
      if (
        result.published !== true ||
        (await verifySnapshot(result.snapshot)).id !== snapshot.id ||
        publishedBundle.path !== snapshotBundlePath(snapshot.bundle.sha256) ||
        publishedBundle.sha256 !== snapshot.bundle.sha256 ||
        publishedBundle.bytes !== snapshot.bundle.bytes
      )
        invalid();
      await authorized(directory, signal);
      return { snapshot, receipt: structuredClone(receipt) };
    });
  }
  async function readSnapshot(
    directory: EditorSyncDirectory,
    projectId: string,
    snapshotId: string,
    opts: EditorSyncOptions = {},
  ) {
    return operation(directory, opts.signal, async (signal) => {
      if (!syncHash(snapshotId)) throw new SnapshotSyncError("INVALID_REQUEST", "快照标识无效");
      const raw = await run(directory, { action: "pull", projectId, snapshotId }, signal),
        value = syncObject(raw, ["snapshot", "bundle"]),
        snapshot = await verifySnapshot(value.snapshot),
        remote = syncObject(value.bundle, ["path", "sha256", "bytes"]);
      if (
        snapshot.id !== snapshotId ||
        snapshot.projectId !== projectId ||
        remote.path !== snapshotBundlePath(snapshot.bundle.sha256) ||
        remote.sha256 !== snapshot.bundle.sha256 ||
        remote.bytes !== snapshot.bundle.bytes
      )
        invalid();
      await authorized(directory, signal);
      const captured = await runtime.call(
        "resources.capture",
        {
          directoryHandle: directory.handle,
          path: snapshotBundlePath(snapshot.bundle.sha256),
          name: `${snapshot.id}.mimiproject`,
          mimeType: "application/zip",
          expectedBytes: snapshot.bundle.bytes,
          expectedSha256: snapshot.bundle.sha256,
        },
        signal,
      );
      if (!object(captured)) invalid();
      if (!object(captured.asset)) invalid();
      const bundle = artifact({
        id: captured.asset.id,
        sha256: captured.asset.sha256,
        bytes: captured.asset.bytes,
        mimeType: captured.asset.mimeType,
        ...(typeof captured.asset.name === "string" ? { name: captured.asset.name } : {}),
      });
      if (bundle.sha256 !== snapshot.bundle.sha256 || bundle.bytes !== snapshot.bundle.bytes)
        invalid();
      await authorized(directory, signal);
      return { snapshot, bundle };
    });
  }
  return {
    async pickDirectory(signal?: AbortSignal): Promise<EditorSyncDirectory | undefined> {
      stopped(signal);
      await runtime.requireMethods(METHODS);
      const before = await panel.getContext(),
        selected = await runtime.call("filesystem.pickDirectory", {}, signal);
      stopped(signal);
      if (
        selected === null ||
        selected === undefined ||
        (object(selected) && selected.cancelled === true)
      )
        return undefined;
      if (
        !object(selected) ||
        !syncToken(selected.handle) ||
        typeof selected.name !== "string" ||
        !selected.name ||
        selected.name.length > 240 ||
        /[\\/\u0000-\u001f\u007f]/.test(selected.name)
      )
        invalid();
      const after = await panel.getContext();
      stopped(signal);
      if (String(before.cwd ?? "") !== String(after.cwd ?? ""))
        throw new SnapshotSyncError("WORKSPACE_CHANGED", "选择期间工作区已切换，请重新连接");
      grants.set(selected.handle, { name: selected.name, cwd: String(after.cwd ?? "") });
      return { handle: selected.handle, name: selected.name };
    },
    history,
    publish,
    readSnapshot,
    async discardPublication(
      directory: EditorSyncDirectory,
      value: EditorSyncPublicationReceipt,
      opts: EditorSyncOptions = {},
    ) {
      return operation(directory, opts.signal, async (signal) => {
        const receipt = validateEditorSyncPublicationReceipt(value);
        await verifySnapshot(receipt.snapshot);
        for (const token of [...receipt.supersededTokens, receipt.token]) {
          const result = await run(directory, { action: "discard-incoming", token }, signal);
          if (!object(result) || result.discarded !== true) invalid();
        }
        return { discarded: true as const };
      });
    },
    dispose() {
      disposed = true;
      for (const controller of operations) controller.abort();
      grants.clear();
      runtime.dispose();
    },
  };
}
