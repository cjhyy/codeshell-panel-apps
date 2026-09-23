import { randomId } from "./ids.js";
import type { Asset, Project } from "./model";
import type { FolderEntry, createDesktopFolderSource } from "./folder-source";
import { FolderCaptureTimeoutError } from "./folder-source";
import { escapeHtml as esc } from "./icons";
import type { ImportMode } from "./external-media";

type DesktopSource = ReturnType<typeof createDesktopFolderSource>;
type Source = Omit<DesktopSource, "referenceAvailable"> & {
  referenceAvailable?: DesktopSource["referenceAvailable"];
};
type Receipt = { path: string; bytes: number; lastModified: number; assetId: string };
type Folder = {
  id: string;
  name: string;
  automatic: boolean;
  receipts: Receipt[];
  importMode?: ImportMode;
};
interface FolderDocument {
  schemaVersion: 1;
  projectId: string;
  folders: Folder[];
}
interface Context {
  project(): Project;
  identity(): string;
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  ready(): boolean;
  publish(
    resource: Awaited<ReturnType<Source["capture"]>>,
    file: FolderEntry,
    current: () => boolean,
  ): Promise<Asset>;
  changed(): void;
}
const fingerprint = (file: { bytes: number; lastModified: number }) =>
  `${file.bytes}:${file.lastModified}`;
const formatBytes = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
const safePath = (path: unknown): path is string =>
  typeof path === "string" &&
  path.length > 0 &&
  path.length <= 1024 &&
  !/[\\:\x00-\x1f\x7f]/.test(path) &&
  !path.startsWith("/") &&
  path.split("/").length <= 16 &&
  path.split("/").every((p) => !!p && p !== "." && p !== ".." && p.length <= 240);

export function validateFolderDocument(value: unknown, projectId: string): FolderDocument {
  if (value == null) return { schemaVersion: 1, projectId, folders: [] };
  const doc = value as FolderDocument;
  const bad = () => {
    throw new Error("素材文件夹记录无法恢复，原记录已保留。请重试读取。");
  };
  if (
    !doc ||
    doc.schemaVersion !== 1 ||
    doc.projectId !== projectId ||
    !Array.isArray(doc.folders) ||
    doc.folders.length > 8
  )
    bad();
  const ids = new Set<string>();
  for (const folder of doc.folders) {
    if (
      !folder ||
      typeof folder.id !== "string" ||
      !/^[\w-]{1,80}$/.test(folder.id) ||
      ids.has(folder.id) ||
      typeof folder.name !== "string" ||
      !folder.name ||
      folder.name.length > 240 ||
      typeof folder.automatic !== "boolean" ||
      (folder.importMode !== undefined && !["reference", "copy"].includes(folder.importMode)) ||
      !Array.isArray(folder.receipts) ||
      folder.receipts.length > 1000
    )
      bad();
    ids.add(folder.id);
    const paths = new Set<string>();
    for (const receipt of folder.receipts) {
      if (
        !receipt ||
        !safePath(receipt.path) ||
        paths.has(receipt.path) ||
        !Number.isSafeInteger(receipt.bytes) ||
        receipt.bytes < 1 ||
        !Number.isSafeInteger(receipt.lastModified) ||
        receipt.lastModified < 0 ||
        typeof receipt.assetId !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(receipt.assetId)
      )
        bad();
      paths.add(receipt.path);
    }
  }
  // Persist only the reviewed record fields; temporary directory grants never enter storage.
  return {
    schemaVersion: 1,
    projectId,
    folders: doc.folders.map((f) => ({
      id: f.id,
      name: f.name,
      automatic: f.automatic,
      ...(f.importMode ? { importMode: f.importMode } : {}),
      receipts: f.receipts.map((r) => ({
        path: r.path,
        bytes: r.bytes,
        lastModified: r.lastModified,
        assetId: r.assetId,
      })),
    })),
  };
}

export function createFolderImport(
  source: Source | undefined,
  context: Context,
  options: { settleMs?: number; intervalMs?: number } = {},
) {
  let document: FolderDocument = { schemaVersion: 1, projectId: context.project().id, folders: [] };
  let identity = "",
    loaded = false,
    locked = false,
    supported = false,
    busy = false,
    disposed = false;
  let status = "",
    active: AbortController | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  let scheduleIndex = 0;
  let importReady = false;
  let referenceSupported = false;
  let importMode: ImportMode = "copy";
  const handles = new Map<string, string>();
  const suspended = new Set<string>();
  // Receipts from previous grants are retained for display, but cannot authorize or identify a new directory.
  const seen = new Map<string, Map<string, Receipt>>();
  const key = () => `video-studio-folders-${document.projectId}`;
  const current = (own = identity) => !disposed && own === identity && own === context.identity();
  const notify = () => {
    if (!disposed) context.changed();
  };
  function assertImportReady() {
    if (locked) throw new Error("素材导入方式无法确认，请重新读取记录后再试");
    if (!importReady || !current()) throw new Error("正在确认素材导入方式，请稍候再导入");
  }
  async function persist(next = document) {
    const own = identity;
    if (!loaded || locked || !current()) throw new Error("文件夹记录尚未安全恢复");
    const snapshot = validateFolderDocument(next, context.project().id);
    await context.write(key(), snapshot);
    if (!current(own)) throw new Error("工程已切换，未应用旧文件夹记录");
    document = snapshot;
  }
  function schedule() {
    clearTimeout(timer);
    if (disposed || !loaded || locked) return;
    timer = setTimeout(() => {
      const folders = document.folders.filter(
        (f) => f.automatic && handles.has(f.id) && !suspended.has(f.id),
      );
      const folder = folders[scheduleIndex % Math.max(1, folders.length)];
      if (!folder || !current()) return;
      if (busy || !context.ready()) {
        schedule();
        return;
      }
      scheduleIndex++;
      void scan(folder.id).catch((error) => {
        status = String(error instanceof Error ? error.message : error);
        notify();
      });
    }, options.intervalMs ?? 15000);
  }
  async function load() {
    active?.abort();
    clearTimeout(timer);
    handles.clear();
    suspended.clear();
    seen.clear();
    identity = context.identity();
    const own = identity;
    loaded = false;
    importReady = false;
    supported = false;
    referenceSupported = false;
    locked = false;
    busy = false;
    status = "";
    document = { schemaVersion: 1, projectId: context.project().id, folders: [] };
    try {
      const stored = await context.read(key());
      if (!current(own)) return;
      document = validateFolderDocument(stored, context.project().id);
      const nextSupported = !!source && (await source.available());
      const nextReferenceSupported = !!source && !!(await source.referenceAvailable?.());
      if (!current(own)) return;
      supported = nextSupported;
      referenceSupported = nextReferenceSupported;
      importMode = referenceSupported ? "reference" : "copy";
      loaded = true;
      importReady = true;
    } catch (error) {
      if (current(own)) {
        locked = true;
        status = error instanceof Error ? error.message : String(error);
      }
    }
    if (current(own)) notify();
  }
  async function connect(automatic: boolean, id?: string) {
    assertImportReady();
    if (!source || !supported || !loaded || locked)
      throw new Error("当前环境支持一次性导入文件夹；持续连接需要桌面目录和资源权限");
    if (busy || !context.ready()) throw new Error("请等待当前操作结束，再选择素材文件夹");
    const own = identity;
    const controller = new AbortController();
    active = controller;
    busy = true;
    notify();
    let folderId: string | undefined;
    try {
      if (!id && document.folders.length >= 8)
        throw new Error("最多保留 8 个文件夹连接，请先移除不用的记录");
      const picked = await source.pick();
      if (!picked || !current(own) || controller.signal.aborted) return;
      const existing = document.folders.find((f) => f.id === id);
      if (id && !existing) throw new Error("文件夹记录已变化，请重新选择");
      const folder: Folder = {
        id: existing?.id ?? randomId(),
        name: picked.name,
        automatic,
        importMode: existing?.importMode ?? importMode,
        receipts: existing?.receipts ?? [],
      };
      await persist({
        ...document,
        folders: existing
          ? document.folders.map((f) => (f.id === id ? folder : f))
          : [...document.folders, folder],
      });
      if (!current(own)) return;
      folderId = folder.id;
      handles.set(folder.id, picked.handle);
      suspended.delete(folder.id);
      seen.set(folder.id, new Map());
    } finally {
      if (current(own)) {
        active = undefined;
        busy = false;
        notify();
      }
    }
    if (folderId) await scan(folderId);
  }
  async function scan(id: string) {
    const folder = document.folders.find((f) => f.id === id),
      handle = handles.get(id);
    if (!folder || !handle || !source || !current() || locked)
      throw new Error("请重新连接素材文件夹");
    if (busy) return;
    if (!context.ready()) throw new Error("当前正在编辑或保存，请稍后检查素材文件夹");
    const own = identity,
      controller = new AbortController();
    active = controller;
    busy = true;
    const valid = () => current(own) && !controller.signal.aborted;
    status = `正在检查「${folder.name}」…`;
    notify();
    let imported = 0,
      skipped = 0,
      unstable = 0,
      oversized = 0;
    let captureTimedOut = false;
    const failures: string[] = [];
    try {
      const before = await source.scan(handle, controller.signal);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, options.settleMs ?? 1200);
        controller.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });
      if (!valid()) return;
      const after = await source.scan(handle, controller.signal);
      if (!valid()) return;
      const previous = new Map(before.files.map((f) => [f.path, fingerprint(f)]));
      const receipts = seen.get(id) ?? new Map<string, Receipt>();
      const persistedReceipts = new Map(folder.receipts.map((receipt) => [receipt.path, receipt]));
      const candidates = after.files.filter((file) => {
        if (file.bytes > 20 * 1024 ** 3) {
          oversized++;
          return false;
        }
        if (previous.get(file.path) !== fingerprint(file) || !file.bytes) {
          unstable++;
          return false;
        }
        const receipt = receipts.get(file.path) ?? persistedReceipts.get(file.path);
        if (
          receipt &&
          fingerprint(receipt) === fingerprint(file) &&
          (receipts.has(file.path) ||
            !context.project().assets.some((asset) => asset.id === receipt.assetId))
        ) {
          skipped++;
          return false;
        }
        return true;
      });
      const knownReceipts = new Map(folder.receipts.map((receipt) => [receipt.path, receipt]));
      const newCandidates = candidates.filter((file) => {
        const known = knownReceipts.get(file.path);
        return (
          !known ||
          fingerprint(known) !== fingerprint(file) ||
          !context.project().assets.some((asset) => asset.id === known.assetId)
        );
      });
      if (context.project().assets.length + newCandidates.length > 1000)
        throw new Error("工程最多保存 1000 个素材，请拆分文件夹或新建工程后导入");
      const totalBytes = candidates.reduce((sum, file) => sum + file.bytes, 0);
      for (const [index, file] of candidates.entries()) {
        if (!valid()) break;
        const position = `${index + 1}/${candidates.length}`;
        const mode = folder.importMode ?? importMode;
        status = `${mode === "reference" ? "正在引用原文件" : "正在保存原片"} ${position} · ${formatBytes(file.bytes)}（本轮共 ${formatBytes(totalBytes)}）：${file.path}`;
        notify();
        try {
          const resource = await source.capture(handle, file, controller.signal, mode);
          if (!valid()) break;
          status = `正在读取预览并保存工程 ${position}：${file.path}`;
          notify();
          const asset = await context.publish(resource, file, valid);
          if (!valid()) break;
          const receipt = {
            path: file.path,
            bytes: file.bytes,
            lastModified: file.lastModified,
            assetId: asset.id,
          };
          // Preserve skipped deletion receipts when another file is published.
          // Only this grant's successful captures enter `seen` below.
          const nextReceipts = new Map([...persistedReceipts, ...receipts]);
          nextReceipts.set(file.path, receipt);
          await persist({
            ...document,
            folders: document.folders.map((f) =>
              f.id === id ? { ...f, receipts: [...nextReceipts.values()].slice(-1000) } : f,
            ),
          });
          receipts.set(file.path, receipt);
          seen.set(id, receipts);
          imported++;
        } catch (error) {
          if (!valid()) break;
          failures.push(`${file.path}：${error instanceof Error ? error.message : String(error)}`);
          // Older Hosts may keep copying after their RPC timer expires. Stop
          // this batch instead of piling up untracked copies of later files.
          if (error instanceof FolderCaptureTimeoutError) {
            captureTimedOut = true;
            break;
          }
          // A record write failure must be retried before silently moving on to another file.
          if (!current(own)) break;
        }
      }
      if (valid()) {
        if (failures.length) suspended.add(id);
        else suspended.delete(id);
        status = `「${folder.name}」已导入 ${imported} 个，跳过 ${skipped + after.skipped} 个${oversized ? `，${oversized} 个超过 20 GiB 保存上限` : ""}${unstable ? `，${unstable} 个仍在写入，稍后再检查` : ""}${captureTimedOut ? `；已停止本轮导入。${failures.at(-1)}` : failures.length ? `；${failures.length} 个失败，点击立即检查重试。${failures[0]}` : ""}`;
      }
    } catch (error) {
      if (valid()) {
        suspended.add(id);
        status = `「${folder.name}」检查失败：${error instanceof Error ? error.message : String(error)}。可点击立即检查重试。`;
      }
    } finally {
      if (current(own)) {
        busy = false;
        active = undefined;
        notify();
        schedule();
      }
    }
  }
  async function action(name: string, id?: string): Promise<boolean> {
    if (!name.startsWith("folder-")) return false;
    if (name === "folder-mode-reference" || name === "folder-mode-copy") {
      assertImportReady();
      if (busy) throw new Error("请先停止当前导入，再切换导入方式");
      if (name === "folder-mode-reference" && !referenceSupported)
        throw new Error("更新 CodeShell 后可引用原文件");
      importMode = name === "folder-mode-reference" ? "reference" : "copy";
      notify();
      return true;
    }
    if (name === "folder-reload") {
      await load();
      return true;
    }
    if (name === "folder-cancel") {
      active?.abort();
      status = "已停止本次检查，已保存的素材仍保留";
      notify();
      return true;
    }
    if (name === "folder-connect") {
      await connect(true);
      return true;
    }
    const folder = document.folders.find((f) => f.id === id);
    if (!folder) throw new Error("文件夹记录不存在");
    if (name === "folder-reconnect") await connect(folder.automatic, id);
    else if (name === "folder-scan") await scan(folder.id);
    else {
      if (busy) throw new Error("请先停止当前检查，再修改文件夹连接");
      if (name === "folder-toggle") {
        await persist({
          ...document,
          folders: document.folders.map((f) =>
            f.id === id ? { ...f, automatic: suspended.has(f.id) || !f.automatic } : f,
          ),
        });
        suspended.delete(folder.id);
      } else if (name === "folder-remove") {
        await persist({ ...document, folders: document.folders.filter((f) => f.id !== id) });
        handles.delete(folder.id);
        suspended.delete(folder.id);
        seen.delete(folder.id);
      } else return false;
      schedule();
      notify();
    }
    return true;
  }
  function render() {
    const button = (name: string, text: string, id = "", disabled = false) =>
      `<button type="button" class="quiet" data-action="${name}" data-id="${esc(id)}" ${disabled ? "disabled" : ""}>${text}</button>`;
    return `<div class="folder-import">${referenceSupported ? `<div class="folder-actions" aria-label="素材导入方式"><button type="button" data-action="folder-mode-reference" aria-pressed="${importMode === "reference"}" ${busy ? "disabled" : ""}>引用原文件${importMode === "reference" ? " · 已选" : ""}</button><button type="button" data-action="folder-mode-copy" aria-pressed="${importMode === "copy"}" ${busy ? "disabled" : ""}>复制保存${importMode === "copy" ? " · 已选" : ""}</button></div>` : ""}<div class="folder-actions">${button("import-folder", "导入文件夹", "", busy)}${button("folder-connect", "连接文件夹 · 自动导入", "", busy || !supported || !loaded || locked)}</div><p class="muted small">${importMode === "reference" ? "引用视频、音频和图片，导入不复制原片。请保留原文件位置；移动后可重新连接。" : "包含子文件夹中的视频、音频和图片；只加入素材库。首次导入会完整保存原片，大文件需要等待复制完成。"}</p>${!supported ? '<p class="muted small">当前可一次性导入。持续连接需要桌面文件夹与资源权限。</p>' : '<p class="muted small">自动导入在面板打开时检查新增或修改文件。重启后重新连接，已导入素材仍保留。</p>'}${document.folders.map((f) => `<article class="folder-connection"><strong>${esc(f.name)}</strong><span class="muted small">${handles.has(f.id) ? (suspended.has(f.id) ? "检查失败，自动导入已暂停" : f.automatic ? "自动检查中" : "已暂停自动检查") : "待重新连接"} · ${(f.importMode ?? importMode) === "reference" ? "引用原文件" : "复制保存"} · 已记录 ${f.receipts.length} 个文件</span><div class="folder-actions">${handles.has(f.id) ? button("folder-scan", "立即检查 / 重试", f.id, busy) + button("folder-toggle", f.automatic && !suspended.has(f.id) ? "暂停" : "开启自动导入", f.id, busy) : button("folder-reconnect", "重新连接", f.id, busy || !supported || locked)}${button("folder-remove", "断开并移除记录", f.id, busy || locked)}</div></article>`).join("")}<p class="folder-status small" role="status">${esc(status)}</p>${busy ? button("folder-cancel", "停止本次检查") : ""}${locked ? button("folder-reload", "重新读取记录") : ""}</div>`;
  }
  return {
    load,
    assertImportReady,
    render,
    action,
    connect,
    scan,
    get supported() {
      return supported;
    },
    get importMode() {
      return importMode;
    },
    get referenceSupported() {
      return referenceSupported;
    },
    get busy() {
      return busy;
    },
    dispose() {
      disposed = true;
      active?.abort();
      clearTimeout(timer);
      source?.dispose();
    },
  };
}
