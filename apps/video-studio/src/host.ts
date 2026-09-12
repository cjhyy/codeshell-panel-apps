import type { BridgeResult } from "./sdk/panel-runtime";
import { validateProject, type Project, type EditOperation } from "./model";

export interface PanelTask {
  id: string;
  status: "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
  result?: { text: string };
  error?: string;
  activity?: { message: string }[];
}

export interface PanelBridge {
  getContext(): Promise<{ cwd?: string; theme?: string }>;
  call(method: string, params?: unknown): Promise<unknown>;
  callResult?(method: string, params?: unknown): Promise<BridgeResult>;
  registerTool(name: string, handler: (args: Record<string, unknown>) => unknown): () => void;
  on(name: string, callback: (payload: unknown) => void): () => void;
}

export let panel =
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { codeshellPanel?: PanelBridge }).codeshellPanel;
export function setPanelBridge(bridge: PanelBridge): void {
  panel = bridge;
}
const STORAGE_KEY = "video-studio-project-v1";
const ARCHIVE_KEY = "video-studio-recent-v1";
const MAX_ARCHIVED_PROJECTS = 10;
const MAX_ARCHIVE_BYTES = 128 * 1024;
// The CodeShell desktop host currently defaults to 256 KiB for the complete
// storage namespace, shared by autosave and this archive (not per key).
const DEFAULT_STORAGE_BYTES = 256 * 1024;

interface ProjectStorage {
  read(): Promise<unknown>;
  write(project: Project, label?: string): Promise<void>;
}

/**
 * A failed initial restore locks this store against writes for the session. In
 * particular, editing a fresh fallback project must not erase unreadable data.
 * Writes are ordered, validated snapshots; one failed write does not stall later
 * saves. The adapter makes these persistence guarantees testable without a host.
 */
export function createProjectStore(storage: ProjectStorage): {
  load(): Promise<Project | null>;
  save(project: Project, label?: string): Promise<void>;
} {
  let loaded: Promise<Project | null> | undefined;
  let saveQueue = Promise.resolve();

  function load(): Promise<Project | null> {
    loaded ??= storage
      .read()
      .then((stored) => (stored === null || stored === undefined ? null : validateProject(stored)));
    return loaded.then((project) => (project ? validateProject(project) : null));
  }

  async function save(project: Project, label?: string): Promise<void> {
    // Capture before entering the async queue, so a later UI edit cannot change
    // the data associated with this save or turn valid data into a corrupt file.
    const snapshot = validateProject(project);
    const operation = saveQueue
      .catch(() => {})
      .then(async () => {
        try {
          await load();
        } catch {
          throw new Error(
            "原有工程恢复失败，已阻止自动覆盖。请下载当前工程 JSON 备份，并检查原存储。",
          );
        }
        await storage.write(snapshot, label);
        loaded = Promise.resolve(snapshot);
      });
    saveQueue = operation;
    await operation;
  }

  return { load, save };
}

let persistentStorage = false;
let documentRevision = 0;
const DOCUMENT_KEY = "video-studio-current";
export function enablePersistentStorage(enabled: boolean): void {
  persistentStorage = enabled;
}
export function hasPersistentStorage(): boolean {
  return persistentStorage;
}
export interface ProjectVersion {
  revision: number;
  updatedAt: number;
  label: string;
}
export async function listProjectVersions(): Promise<ProjectVersion[]> {
  if (!panel || !persistentStorage) return [];
  return panel.call("media.document.versions", { key: DOCUMENT_KEY }) as Promise<ProjectVersion[]>;
}
export async function readProjectVersion(revision: number): Promise<Project> {
  if (!panel || !persistentStorage) throw new Error("历史版本需要新版 CodeShell");
  const result = (await panel.call("media.document.get", { key: DOCUMENT_KEY, revision })) as {
    data: unknown;
  };
  return validateProject(result.data);
}

const projectStore = createProjectStore({
  async read() {
    if (panel && persistentStorage) {
      const document = (await panel.call("media.document.get", { key: DOCUMENT_KEY })) as {
        revision: number;
        data: unknown;
      };
      documentRevision = document.revision;
      if (document.data !== null) return document.data;
      // Migrate only after a successful empty document read. A failed restore
      // keeps the existing save protection intact.
    }
    return panel
      ? panel.call("storage.get", { key: STORAGE_KEY })
      : JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  },
  async write(snapshot, label) {
    if (panel && persistentStorage) {
      const result = (await panel.call("media.document.set", {
        key: DOCUMENT_KEY,
        baseRevision: documentRevision,
        data: snapshot,
        label: label || "自动保存",
      })) as ProjectVersion;
      documentRevision = result.revision;
    } else if (panel) await panel.call("storage.set", { key: STORAGE_KEY, value: snapshot });
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  },
});

export const loadProject = projectStore.load;
export const saveProject = projectStore.save;

interface ProjectArchiveStorage {
  read(): Promise<unknown>;
  write(projects: Project[]): Promise<void>;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Keep the latest snapshot of up to ten distinct projects, newest first. Evict
 * older snapshots until both the 128 KiB archive budget and the host's default
 * total quota fit. A single project that cannot fit is never silently dropped.
 * Adapter writes must be atomic, as storage.set and localStorage.setItem are.
 */
export function createProjectArchiveStore(
  storage: ProjectArchiveStorage,
  ensureRestored: () => Promise<Project | null>,
): { archive(project: Project): Promise<void>; list(): Promise<Project[]> } {
  let loaded: Promise<Project[]> | undefined;
  let writeQueue = Promise.resolve();

  function readArchive(): Promise<Project[]> {
    loaded ??= storage.read().then((stored) => {
      if (stored === undefined || stored === null) return [];
      if (!Array.isArray(stored) || stored.length > MAX_ARCHIVED_PROJECTS) {
        throw new Error("最近工程记录格式错误，已保留原数据，请先下载当前工程 JSON 备份。");
      }
      const projects = Array.from(stored, validateProject);
      if (new Set(projects.map((project) => project.id)).size !== projects.length) {
        throw new Error("最近工程记录包含重复 ID，已保留原数据，请先下载当前工程 JSON 备份。");
      }
      if (jsonBytes(projects) > MAX_ARCHIVE_BYTES) {
        throw new Error("最近工程记录超过 128 KiB，已保留原数据，请先下载当前工程 JSON 备份。");
      }
      return projects;
    });
    return loaded;
  }

  async function archive(project: Project): Promise<void> {
    const snapshot = validateProject(project);
    const operation = writeQueue
      .catch(() => {})
      .then(async () => {
        let current: Project | null;
        try {
          // Archiving must never provide a back door around a failed autosave
          // restore. The UI only replaces its project after this promise resolves.
          current = await ensureRestored();
        } catch {
          throw new Error(
            "原有工程恢复失败，已阻止切换工程。请下载当前工程 JSON 备份，并检查原存储。",
          );
        }
        const previous = await readArchive();
        // A pending autosave may still contain the departing project's snapshot.
        // Reserve for whichever is larger, not only for the last completed save.
        const reserved = current && jsonBytes(current) > jsonBytes(snapshot) ? current : snapshot;
        const fits = (projects: Project[]) =>
          jsonBytes(projects) <= MAX_ARCHIVE_BYTES &&
          jsonBytes({ [STORAGE_KEY]: reserved, [ARCHIVE_KEY]: projects }) + 1 <=
            DEFAULT_STORAGE_BYTES;
        if (!fits([snapshot])) {
          throw new Error(
            "当前工程超过最近工程的可用空间（归档上限 128 KiB），无法安全切换。请先下载工程 JSON 备份。",
          );
        }
        const next = [snapshot, ...previous.filter((item) => item.id !== snapshot.id)].slice(
          0,
          MAX_ARCHIVED_PROJECTS,
        );
        while (!fits(next)) next.pop();
        // Neither the cache nor the caller's project changes on an adapter error.
        await storage.write(structuredClone(next));
        loaded = Promise.resolve(next);
      });
    writeQueue = operation;
    await operation;
  }

  async function list(): Promise<Project[]> {
    await writeQueue.catch(() => {});
    return (await readArchive()).map(validateProject);
  }

  return { archive, list };
}

const projectArchive = createProjectArchiveStore(
  {
    async read() {
      return panel
        ? panel.call("storage.get", { key: ARCHIVE_KEY })
        : JSON.parse(localStorage.getItem(ARCHIVE_KEY) ?? "null");
    },
    async write(projects) {
      if (panel) await panel.call("storage.set", { key: ARCHIVE_KEY, value: projects });
      else localStorage.setItem(ARCHIVE_KEY, JSON.stringify(projects));
    },
  },
  loadProject,
);

let persistentArchiveRevision = 0;
let persistentArchiveCache: Promise<Project[]> | undefined;
let persistentArchiveQueue = Promise.resolve();
async function readPersistentArchive(): Promise<Project[]> {
  persistentArchiveCache ??= panel!.call("media.document.get", { key: ARCHIVE_KEY }).then((raw) => {
    const document = raw as { revision: number; data: unknown };
    persistentArchiveRevision = document.revision;
    if (document.data === null) return [];
    if (!Array.isArray(document.data) || document.data.length > 10)
      throw new Error("最近工程恢复失败，已保留原数据");
    return document.data.map(validateProject);
  });
  return persistentArchiveCache;
}
export async function archiveProject(project: Project): Promise<void> {
  if (!persistentStorage || !panel) return projectArchive.archive(project);
  const snapshot = validateProject(project);
  const operation = persistentArchiveQueue
    .catch(() => {})
    .then(async () => {
      await loadProject();
      const previous = await readPersistentArchive();
      const next = [snapshot, ...previous.filter((item) => item.id !== snapshot.id)].slice(0, 10);
      while (next.length > 1 && jsonBytes(next) > 1900 * 1024) next.pop();
      if (jsonBytes(next) > 1900 * 1024)
        throw new Error("当前工程超过归档容量，请先下载 JSON 备份");
      const result = (await panel!.call("media.document.set", {
        key: ARCHIVE_KEY,
        baseRevision: persistentArchiveRevision,
        data: next,
        label: "切换工程前归档",
      })) as ProjectVersion;
      persistentArchiveRevision = result.revision;
      persistentArchiveCache = Promise.resolve(next);
    });
  persistentArchiveQueue = operation;
  await operation;
}
export async function listArchivedProjects(): Promise<Project[]> {
  if (!persistentStorage || !panel) return projectArchive.list();
  await persistentArchiveQueue.catch(() => {});
  return (await readPersistentArchive()).map(validateProject);
}

export interface Proposal {
  baseRevision: number;
  title: string;
  explanation: string;
  operations: EditOperation[];
  projectId?: string;
  requestToken?: string;
}

export function parseProposal(value: unknown): Proposal {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error("剪辑方案必须是一个 JSON 对象");
  const allowed = [
    "baseRevision",
    "title",
    "explanation",
    "operations",
    "projectId",
    "requestToken",
  ];
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`方案包含未知字段：${key}`);
  const raw = value as Partial<Proposal>;
  if (
    !Number.isSafeInteger(raw.baseRevision) ||
    raw.baseRevision! < 0 ||
    raw.baseRevision! >= Number.MAX_SAFE_INTEGER ||
    typeof raw.title !== "string" ||
    !raw.title.trim() ||
    raw.title.length > 200 ||
    /[\u0000-\u001f]/.test(raw.title) ||
    !Array.isArray(raw.operations) ||
    raw.operations.length === 0 ||
    raw.operations.length > 100
  )
    throw new Error("方案需要有效的 baseRevision、title 和 1–100 条 operations");
  if (
    raw.explanation !== undefined &&
    (typeof raw.explanation !== "string" ||
      raw.explanation.length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw.explanation))
  )
    throw new Error("方案说明格式错误或过长");
  const proposal: Proposal = {
    baseRevision: raw.baseRevision!,
    title: raw.title,
    explanation: raw.explanation || "",
    operations: structuredClone(raw.operations),
  };
  for (const key of ["projectId", "requestToken"] as const) {
    const field = raw[key];
    if (field === undefined) continue;
    if (typeof field !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(field))
      throw new Error(`方案 ${key} 格式不正确`);
    proposal[key] = field;
  }
  return proposal;
}

export function parseTaskProposal(text: string): Proposal {
  if (typeof text !== "string" || text.length > 1_000_000)
    throw new Error("任务结果格式错误或过长");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return parseProposal(JSON.parse(fenced ? fenced[1]! : text.trim()));
}

export function download(blob: Blob, filename: string): void {
  if (!blob.size) throw new Error("没有可下载的内容");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
