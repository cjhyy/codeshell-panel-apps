import type { PanelBridge } from "./host";
import { createPanelRuntime, runtimeCancelled } from "./sdk/panel-runtime";

export interface FolderEntry {
  path: string;
  name: string;
  bytes: number;
  lastModified: number;
  mimeType: string;
}
export interface CapturedFolderAsset {
  id: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  name: string;
}
const METHODS = [
  "filesystem.pickDirectory",
  "process.find",
  "process.resolveEntry",
  "process.spawn",
  "process.get",
  "process.cancel",
  "resources.capture",
];
const HANDLE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_JSON_BYTES = 192 * 1024;
const MAX_FILES = 1000;
const MAX_FILE_BYTES = 20 * 1024 ** 3;
const SCAN_TIMEOUT_MS = 60_000;
const encoder = new TextEncoder();
class FolderSourceError extends Error {}
// Only fixed messages from the reviewed scanner may cross back into the UI. Other stderr stays private.
const SCANNER_MESSAGES = new Set([
  "文件夹扫描限制无效。",
  "文件夹扫描已取消，未返回不完整的素材清单。",
  "请选择真实的素材文件夹，不能使用符号链接。",
  "文件夹已发生变化，请重新扫描。",
  "扫描期间文件夹已变化，请等待文件写入完成后重试。",
  "扫描期间素材或目录已变化，请等待文件写入完成后重试。",
  "子文件夹数量超过扫描上限，请选择更小的素材文件夹。",
  "素材文件夹层级超过扫描上限，请选择更靠近素材的子文件夹。",
  "扫描期间目录已被替换，请重新选择素材文件夹。",
  "文件夹条目超过扫描上限，请选择更小的素材文件夹。",
  "素材相对路径超过保存上限，请选择更靠近素材的子文件夹或缩短文件名。",
  "素材数量超过 1000 个，请选择更小的素材文件夹。",
  "扫描期间素材已被替换，请重新扫描。",
  "素材大小或修改时间无效，请检查原文件。",
  "素材清单超过输出上限，请选择更小的素材文件夹。",
  "文件夹扫描失败：目录或素材无法读取、权限已变化或文件仍在写入。请检查后重新扫描。",
]);
function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function safeInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}
function relativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    value.split("/").length <= 16 &&
    value
      .split("/")
      .every(
        (part) =>
          !!part &&
          part !== "." &&
          part !== ".." &&
          part.length <= 240 &&
          !/[\\\u0000-\u001f\u007f:]/.test(part) &&
          !/[. ]$/.test(part) &&
          !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part),
      )
  );
}
function entry(value: unknown): FolderEntry {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !["path", "name", "bytes", "lastModified", "mimeType"].includes(key),
    ) ||
    !relativePath(value.path) ||
    value.name !== value.path.split("/").at(-1) ||
    !safeInteger(value.bytes) ||
    !safeInteger(value.lastModified) ||
    typeof value.mimeType !== "string" ||
    value.mimeType.length > 200 ||
    !/^(audio|video|image)\/[a-z0-9!#$&^_.+-]+$/.test(value.mimeType)
  )
    throw new FolderSourceError("文件夹扫描返回了无效素材信息，请重新选择文件夹后重试。");
  return {
    path: value.path,
    name: value.name,
    bytes: value.bytes,
    lastModified: value.lastModified,
    mimeType: value.mimeType,
  };
}
function result(text: string): { files: FolderEntry[]; skipped: number } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new FolderSourceError("文件夹扫描结果不完整，请重新扫描。");
  }
  if (
    !record(value) ||
    Object.keys(value).some((key) => !["files", "skipped"].includes(key)) ||
    !Array.isArray(value.files) ||
    value.files.length > MAX_FILES ||
    !safeInteger(value.skipped)
  )
    throw new FolderSourceError("文件夹扫描结果超过限制或格式无效，请选择范围更小的文件夹。");
  const files = value.files.map(entry),
    paths = new Set(files.map((file) => file.path));
  if (paths.size !== files.length)
    throw new FolderSourceError("文件夹扫描包含重复路径，请重新扫描。");
  return { files, skipped: value.skipped };
}
function stopped(signal: AbortSignal): void {
  if (signal.aborted) throw runtimeCancelled();
}
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(runtimeCancelled());
    };
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(runtimeCancelled());
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
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

/** Folder grants belong only to this open Panel instance; saved projects never retain them. */
export function createDesktopFolderSource(panel: PanelBridge) {
  const runtime = createPanelRuntime(panel);
  const grants = new Map<string, Map<string, FolderEntry>>();
  const operations = new Set<AbortController>();
  const cancellations = new Set<string>();
  let disposed = false,
    scanning = false;
  let executableEntry: Promise<{ executableHandle: string; entryHandle: string }> | undefined;
  function operation(signal?: AbortSignal) {
    if (disposed) throw runtimeCancelled();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    operations.add(controller);
    return {
      controller,
      finish() {
        signal?.removeEventListener("abort", abort);
        operations.delete(controller);
      },
    };
  }
  async function available(): Promise<boolean> {
    if (disposed) return false;
    try {
      const context = await runtime.discover();
      return (
        !disposed &&
        Array.isArray(context.availableMethods) &&
        METHODS.every((method) => context.availableMethods.includes(method))
      );
    } catch {
      return false;
    }
  }
  async function requireAvailable() {
    if (disposed) throw runtimeCancelled();
    if (!(await available()))
      throw new FolderSourceError(
        "当前面板没有文件夹授权、扫描或素材保存权限，请检查面板权限后重试。",
      );
  }
  function requireGrant(handle: string): Map<string, FolderEntry> {
    if (disposed) throw runtimeCancelled();
    const files = grants.get(handle);
    if (!HANDLE.test(handle) || !files)
      throw new FolderSourceError("文件夹授权已失效，请在当前面板重新选择文件夹。");
    return files;
  }
  async function pick(): Promise<{ handle: string; name: string } | undefined> {
    await requireAvailable();
    let selected: unknown;
    try {
      selected = await runtime.call("filesystem.pickDirectory", {});
    } catch (cause) {
      throw new FolderSourceError("无法选择文件夹，请检查目录权限后重试。", { cause });
    }
    if (disposed) throw runtimeCancelled();
    if (record(selected) && selected.cancelled === true) return undefined;
    if (
      !record(selected) ||
      typeof selected.handle !== "string" ||
      !HANDLE.test(selected.handle) ||
      typeof selected.name !== "string" ||
      !selected.name ||
      selected.name.length > 240 ||
      /[\\/\u0000-\u001f\u007f]/.test(selected.name)
    )
      throw new FolderSourceError("文件夹授权返回无效结果，请重新选择。");
    grants.set(selected.handle, new Map());
    return { handle: selected.handle, name: selected.name };
  }
  async function tools() {
    executableEntry ??= (async () => {
      let executableHandle: string | undefined;
      for (const name of ["node", "nodejs"]) {
        const found = await runtime.call("process.find", { name });
        if (!record(found) || typeof found.available !== "boolean")
          throw new FolderSourceError("本地运行环境返回无效结果。");
        if (!found.available) continue;
        if (typeof found.handle !== "string" || !HANDLE.test(found.handle))
          throw new FolderSourceError("本地运行环境授权无效。");
        executableHandle = found.handle;
        break;
      }
      if (!executableHandle)
        throw new FolderSourceError("未找到 Node.js，暂时无法扫描文件夹。仍可直接导入素材文件。");
      const resolved = await runtime.call("process.resolveEntry", {
        name: "folder-scan",
        executableHandle,
      });
      if (
        !record(resolved) ||
        typeof resolved.handle !== "string" ||
        !HANDLE.test(resolved.handle) ||
        resolved.name !== "folder-scan" ||
        typeof resolved.sha256 !== "string" ||
        !HASH.test(resolved.sha256)
      )
        throw new FolderSourceError("文件夹扫描工具尚未获得有效授权，请重新打开面板后再试。");
      return { executableHandle, entryHandle: resolved.handle };
    })().catch((error) => {
      executableEntry = undefined;
      throw error;
    });
    return executableEntry;
  }
  async function cancelProcess(processId: string): Promise<void> {
    if (cancellations.has(processId)) return;
    cancellations.add(processId);
    // Cancellation is exempt from ordinary admission and must remain possible after dispose().
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = panel.callResult
        ? panel.callResult("process.cancel", { processId })
        : panel.call("process.cancel", { processId });
      await Promise.race([
        request,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 5000);
        }),
      ]);
    } catch {
      /* The Host also terminates this guest's processes when the Panel closes. */
    } finally {
      if (timer) clearTimeout(timer);
      if (cancellations.size > 256) cancellations.delete(cancellations.values().next().value!);
    }
  }
  async function scan(
    handle: string,
    signal?: AbortSignal,
  ): Promise<{ files: FolderEntry[]; skipped: number }> {
    requireGrant(handle);
    if (scanning) throw new FolderSourceError("文件夹正在扫描，请等待本次完成或取消后重试。");
    const own = operation(signal),
      current = own.controller.signal;
    let processId: string | undefined,
      complete = false,
      timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    scanning = true;
    try {
      stopped(current);
      await abortable(requireAvailable(), current);
      const handles = await abortable(tools(), current);
      stopped(current);
      const pending = runtime.call(
        "process.spawn",
        { ...handles, directoryHandle: handle, args: [] },
        current,
      );
      // A user may cancel while an approval dialog is open. A late spawn must still be stopped.
      void pending
        .then((value) => {
          if (
            current.aborted &&
            record(value) &&
            typeof value.processId === "string" &&
            HANDLE.test(value.processId)
          )
            void cancelProcess(value.processId);
        })
        .catch(() => {});
      const started = await abortable(pending, current);
      if (
        !record(started) ||
        typeof started.processId !== "string" ||
        !HANDLE.test(started.processId)
      )
        throw new FolderSourceError("文件夹扫描没有返回有效进程。");
      processId = started.processId;
      timer = setTimeout(() => {
        timedOut = true;
        own.controller.abort();
      }, SCAN_TIMEOUT_MS);
      let cursor = 0,
        stdout = "",
        stderr = "";
      for (;;) {
        stopped(current);
        const page: unknown = await abortable(
          runtime.call("process.get", { processId, afterSequence: cursor, limit: 128 }, current),
          current,
        );
        if (!record(page) || page.found !== true || page.processId !== processId)
          throw new FolderSourceError("文件夹扫描记录已失效，请重新扫描。");
        if (page.truncated === true)
          throw new FolderSourceError("文件夹扫描输出已丢失，请选择范围更小的文件夹重试。");
        if (
          page.truncated !== false ||
          !["running", "stopping", "exited"].includes(page.status) ||
          !Array.isArray(page.events) ||
          page.events.length > 128 ||
          !safeInteger(page.nextSequence, cursor) ||
          !safeInteger(page.sequence, page.nextSequence) ||
          typeof page.hasMore !== "boolean"
        )
          throw new FolderSourceError("文件夹扫描进度格式无效。");
        for (const event of page.events) {
          if (!record(event) || event.sequence !== cursor + 1 || !record(event.payload))
            throw new FolderSourceError("文件夹扫描输出不连续，请重新扫描。");
          if (event.event === "process.output") {
            const payload = event.payload;
            if (
              !["stdout", "stderr"].includes(payload.stream) ||
              typeof payload.text !== "string" ||
              payload.text.length > 16384
            )
              throw new FolderSourceError("文件夹扫描输出格式无效。");
            if (payload.stream === "stdout") stdout += payload.text;
            else stderr += payload.text;
            // Rejoin chunks before counting UTF-8 so a split surrogate pair is not counted twice.
            if (encoder.encode(stdout).length + encoder.encode(stderr).length > MAX_JSON_BYTES)
              throw new FolderSourceError("文件夹扫描输出超过限制，请选择范围更小的文件夹。");
          } else if (event.event !== "process.exit")
            throw new FolderSourceError("文件夹扫描事件无效。");
          cursor = event.sequence;
        }
        if (
          page.nextSequence !== cursor ||
          page.hasMore !== cursor < page.sequence ||
          (page.hasMore && !page.events.length)
        )
          throw new FolderSourceError("文件夹扫描游标无效，已停止读取。");
        if (page.hasMore) continue;
        if (page.status === "exited") {
          if (page.cancelRequested === true) throw runtimeCancelled();
          if (page.code !== 0 || (page.signal !== undefined && page.signal !== null))
            throw new FolderSourceError(
              SCANNER_MESSAGES.has(stderr.trim())
                ? stderr.trim()
                : "文件夹扫描未正常完成。请检查目录是否可读、仍在变化或超出扫描上限后重试。",
            );
          const found = result(stdout);
          stopped(current);
          grants.set(handle, new Map(found.files.map((file) => [file.path, { ...file }])));
          complete = true;
          return found;
        }
        await pause(750, current);
      }
    } catch (cause) {
      if (timedOut) throw new FolderSourceError("文件夹扫描超时，请选择范围更小的文件夹重试。");
      if (current.aborted || (cause as Error)?.name === "AbortError") throw runtimeCancelled();
      if (cause instanceof FolderSourceError) throw cause;
      // Refusing a launch does not revoke the reviewed handles. Re-resolve only when
      // the Host explicitly reports that the executable or package entry became stale.
      if (
        cause instanceof Error &&
        /^(?:executable handle is invalid or belongs to another Panel App|package entry handle is invalid or belongs to another Panel App|package entry is bound to a different executable|Panel App process handles were revoked|resolved executable changed; find it and approve it again|package entry executable changed; resolve the entry again|reviewed package entry changed; resolve it again|reviewed package entry was replaced; resolve it again)$/.test(
          cause.message,
        )
      )
        executableEntry = undefined;
      throw new FolderSourceError("无法扫描文件夹，请检查本地工具与目录权限后重试。", { cause });
    } finally {
      if (timer) clearTimeout(timer);
      own.finish();
      scanning = false;
      if (!complete && processId) await cancelProcess(processId);
    }
  }
  async function capture(
    handle: string,
    file: FolderEntry,
    signal?: AbortSignal,
  ): Promise<CapturedFolderAsset> {
    const files = requireGrant(handle),
      checked = entry(file),
      previous = files.get(checked.path);
    if (
      !previous ||
      Object.keys(checked).some(
        (key) => checked[key as keyof FolderEntry] !== previous[key as keyof FolderEntry],
      )
    )
      throw new FolderSourceError("素材不在这次文件夹扫描清单中，请重新扫描后导入。");
    if (checked.bytes < 1 || checked.bytes > MAX_FILE_BYTES)
      throw new FolderSourceError(
        "这个素材为空或超过单文件 20 GiB 保存上限，请完成文件写入或选择更小的文件。",
      );
    const own = operation(signal),
      current = own.controller.signal;
    try {
      stopped(current);
      const captured = await abortable(
        runtime.call(
          "resources.capture",
          {
            directoryHandle: handle,
            path: checked.path,
            name: checked.name,
            mimeType: checked.mimeType,
            expectedBytes: checked.bytes,
          },
          current,
        ),
        current,
      );
      stopped(current);
      const asset = record(captured) ? captured.asset : undefined;
      if (
        !record(asset) ||
        typeof asset.sha256 !== "string" ||
        !HASH.test(asset.sha256) ||
        asset.id !== `asset-${asset.sha256}` ||
        asset.bytes !== checked.bytes ||
        asset.mimeType !== checked.mimeType ||
        asset.name !== checked.name
      )
        throw new FolderSourceError("文件夹素材保存结果未通过文件身份与大小检查。");
      return {
        id: asset.id,
        sha256: asset.sha256,
        bytes: asset.bytes,
        mimeType: asset.mimeType,
        name: asset.name,
      };
    } catch (cause) {
      if (current.aborted || (cause as Error)?.name === "AbortError") throw runtimeCancelled();
      if (cause instanceof FolderSourceError) throw cause;
      throw new FolderSourceError("文件夹素材未能保存，请重新扫描并检查文件是否仍在写入。", {
        cause,
      });
    } finally {
      own.finish();
    }
  }
  return {
    available,
    pick,
    scan,
    capture,
    dispose() {
      if (disposed) return;
      disposed = true;
      grants.clear();
      for (const operation of operations) operation.abort();
      operations.clear();
      runtime.dispose();
    },
  };
}
