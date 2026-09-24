import type { PanelBridge, ProjectVersion } from "../host";
import { migrateLegacyProject } from "./migration";
import { EditorStorageConflictError, type EditorSessionStorage } from "./session";
import type { EditorDocument } from "./types";
import { validateEditorDocument } from "./validation";

export interface EditorHostStorage extends EditorSessionStorage {
  versions(): Promise<ProjectVersion[]>;
  readVersion(revision: number): Promise<unknown>;
  archive(document: EditorDocument): Promise<void>;
  listArchived(): Promise<EditorDocument[]>;
  upgradeBackups(): Promise<EditorUpgradeBackup[]>;
  readUpgradeBackup(digest: string): Promise<unknown>;
}
export interface EditorUpgradeBackup {
  digest: string;
  documentId: string;
  name: string;
  revision: number;
  createdAt: number;
}
export interface EditorHostStorageOptions {
  persistent: boolean;
  scopeKey?: string;
}
type Bridge = Pick<PanelBridge, "call">;
interface Stored {
  revision: number;
  data: unknown | null;
  updatedAt?: number;
}
interface Backend {
  get(key: string, revision?: number): Promise<Stored>;
  set(key: string, data: unknown, baseRevision: number, label: string): Promise<ProjectVersion>;
  versions(key: string): Promise<ProjectVersion[]>;
}
interface Packed {
  format: "video-studio-packed-document";
  version: 1;
  sha256: string;
  bytes: number;
  data?: unknown;
  chunks?: Array<{ key: string; sha256: string; bytes: number }>;
}
interface ArchiveEntry {
  documentId: string;
  name: string;
  snapshotKey: string;
  updatedAt: number;
}
interface ArchiveIndex {
  format: "video-studio-archive-index";
  version: 1;
  entries: ArchiveEntry[];
}
const CURRENT = "video-studio-current";
const LEGACY = "video-studio-project-v1";
const OLD_ARCHIVE = "video-studio-recent-v1";
const ARCHIVE = "video-studio-recent-v2";
const UPGRADES = "video-studio-upgrade-backups";
const MAX_BYTES = 32 * 1024 * 1024;
const INLINE_BYTES = 704 * 1024;
const CHUNK_BYTES = 704 * 1024; // Base64 + JSON envelope stays below 1 MiB IPC payloads.
const MAX_ENTRIES = 1000; // Fail at the bound; never silently evict an archived project.
const encoder = new TextEncoder();
const hashPattern = /^[a-f0-9]{64}$/;
const plain = (value: unknown): value is Record<string, any> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${label}无效，原存储已保留`);
  return value;
}
function label(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new Error("保存说明须为 1 至 200 个字符");
  return value;
}
/** Retain exact legacy JSON fields and omissions without invoking accessors or toJSON. */
function exactJSON(value: unknown): unknown {
  const ancestors = new Set<object>();
  let nodes = 0,
    characters = 0;
  const copy = (item: unknown, depth: number): unknown => {
    if (++nodes > 1_000_000 || depth > 64) throw new Error("工程 JSON 结构超过容量限制");
    if (
      item === null ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    )
      return item;
    if (typeof item === "string") {
      characters += item.length;
      if (characters > MAX_BYTES) throw new Error("工程超过 32 MiB 存储上限");
      return item;
    }
    if (!item || typeof item !== "object" || ancestors.has(item))
      throw new Error("工程必须是普通 JSON 数据");
    const array = Array.isArray(item),
      keys = Reflect.ownKeys(item);
    if (
      array
        ? Object.getPrototypeOf(item) !== Array.prototype || keys.length !== item.length + 1
        : !plain(item)
    )
      throw new Error("工程必须是完整 JSON 对象或数组");
    ancestors.add(item);
    const result: any = array ? [] : {};
    try {
      for (const key of keys) {
        if (array && key === "length") continue;
        if (
          typeof key !== "string" ||
          ["__proto__", "constructor", "prototype"].includes(key) ||
          (array && !/^(0|[1-9]\d*)$/.test(key))
        )
          throw new Error("工程包含不安全数据键");
        characters += key.length;
        if (characters > MAX_BYTES) throw new Error("工程超过 32 MiB 存储上限");
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!descriptor.enumerable || !("value" in descriptor))
          throw new Error("工程不能包含访问器");
        result[key] = copy(descriptor.value, depth + 1);
      }
    } finally {
      ancestors.delete(item);
    }
    return result;
  };
  return copy(value, 0);
}
function serialize(value: unknown): { data: unknown; bytes: Uint8Array } {
  const data = exactJSON(value),
    bytes = encoder.encode(JSON.stringify(data));
  if (bytes.byteLength > MAX_BYTES)
    throw new Error("工程超过 32 MiB 存储上限，尚未写入任何项目数据");
  return { data, bytes };
}
async function sha(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error("当前环境无法安全校验工程存储，请使用受支持的主机或本地安全页面");
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let index = 0; index < bytes.length; index += 8192)
    parts.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
  return btoa(parts.join(""));
}
function decode64(text: unknown): Uint8Array {
  if (
    typeof text !== "string" ||
    text.length > Math.ceil(CHUNK_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(text)
  )
    throw new Error("工程分块编码损坏");
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new Error("工程分块编码损坏");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function stored(value: unknown): Stored {
  if (!plain(value) || !Object.hasOwn(value, "data"))
    throw new Error("存储读取回执无效，已阻止覆盖");
  const revision = integer(value.revision, "存储版本");
  if (revision > 0 && value.data === null) throw new Error("已有版本的工程内容为空，原存储已保留");
  if (revision === 0 && value.data !== null) throw new Error("工程版本与内容不一致，原存储已保留");
  return {
    revision,
    data: value.data,
    ...(value.updatedAt === undefined ? {} : { updatedAt: integer(value.updatedAt, "保存时间") }),
  };
}
function version(value: unknown): ProjectVersion {
  // Historical Host documents may have an empty label; new writes require a useful label.
  if (!plain(value) || typeof value.label !== "string" || value.label.length > 200)
    throw new Error("存储版本回执无效");
  return {
    revision: integer(value.revision, "存储版本", 1),
    updatedAt: integer(value.updatedAt, "保存时间"),
    label: value.label,
  };
}
function conflict(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : plain(error) && typeof error.message === "string"
        ? error.message
        : "";
  return (
    error instanceof EditorStorageConflictError ||
    /Media document changed in another window/.test(message)
  );
}
function hostBackend(panel: Bridge): Backend {
  return {
    async get(key, revision) {
      return stored(
        await panel.call("media.document.get", {
          key,
          ...(revision === undefined ? {} : { revision }),
        }),
      );
    },
    async set(key, data, baseRevision, text) {
      try {
        return version(
          await panel.call("media.document.set", { key, data, baseRevision, label: text }),
        );
      } catch (error) {
        if (conflict(error)) throw new EditorStorageConflictError();
        throw error;
      }
    },
    async versions(key) {
      const values = await panel.call("media.document.versions", { key });
      if (!Array.isArray(values) || values.length > 20)
        throw new Error("版本索引损坏，原存储已保留");
      const result = values.map(version);
      if (
        result.some((item, index) => index > 0 && item.revision !== result[index - 1]!.revision - 1)
      )
        throw new Error("版本索引顺序损坏");
      return result;
    },
  };
}
interface BrowserRecord {
  key: string;
  versions: Array<ProjectVersion & { data: unknown }>;
}
function indexedBackend(scope: string): Backend {
  let connection: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> =>
    (connection ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("当前浏览器无法打开工程数据库，原数据已保留"));
        return;
      }
      const request = indexedDB.open("video-studio-editor-v2", 1);
      let settled = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("documents"))
          request.result.createObjectStore("documents", { keyPath: "key" });
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        request.result.onversionchange = () => {
          request.result.close();
          connection = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        settled = true;
        reject(request.error ?? new Error("无法读取工程数据库"));
      };
      request.onblocked = () => {
        settled = true;
        reject(new Error("工程数据库升级被其他窗口占用，请关闭其他编辑窗口后重试"));
      };
    }));
  const record = (value: unknown): BrowserRecord | undefined => {
    if (value === undefined) return;
    if (
      !plain(value) ||
      typeof value.key !== "string" ||
      !Array.isArray(value.versions) ||
      !value.versions.length ||
      value.versions.length > 20
    )
      throw new Error("本地工程版本索引损坏");
    value.versions.forEach((item: unknown, index: number) => {
      const result = version(item);
      if (
        !plain(item) ||
        !Object.hasOwn(item, "data") ||
        item.data === null ||
        (index > 0 && result.revision !== value.versions[index - 1].revision - 1)
      )
        throw new Error("本地工程版本损坏");
    });
    return value as BrowserRecord;
  };
  const access = async <T>(
    key: string,
    writable: boolean,
    run: (current: BrowserRecord | undefined, store: IDBObjectStore, key: string) => T,
  ): Promise<T> => {
    const db = await open(),
      id = JSON.stringify([scope, key]);
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("documents", writable ? "readwrite" : "readonly"),
        store = transaction.objectStore("documents");
      let result: T, failure: unknown;
      transaction.oncomplete = () => resolve(result!);
      transaction.onabort = transaction.onerror = () =>
        reject(failure ?? transaction.error ?? new Error("工程数据库操作未提交"));
      const request = store.get(id);
      request.onerror = () => {
        failure = request.error;
      };
      request.onsuccess = () => {
        try {
          result = run(record(request.result), store, id);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
    });
  };
  return {
    async get(key, revision) {
      if (revision !== undefined) integer(revision, "版本", 1);
      return access(key, false, (current) => {
        const item =
          revision === undefined
            ? current?.versions[0]
            : current?.versions.find((item) => item.revision === revision);
        if (!item) {
          if (revision !== undefined) throw new Error("此工程历史版本不存在");
          return { revision: 0, data: null };
        }
        return stored({
          revision: item.revision,
          data: structuredClone(item.data),
          updatedAt: item.updatedAt,
        });
      });
    },
    async set(key, data, baseRevision, text) {
      const snapshot = exactJSON(data);
      integer(baseRevision, "基础存储版本");
      label(text);
      return access(key, true, (current, store, id) => {
        if ((current?.versions[0]?.revision ?? 0) !== baseRevision)
          throw new EditorStorageConflictError(undefined, current?.versions[0]?.revision ?? 0);
        const result = { revision: baseRevision + 1, updatedAt: Date.now(), label: text };
        integer(result.revision, "新存储版本", 1);
        store.put({
          key: id,
          versions: [{ ...result, data: snapshot }, ...(current?.versions ?? [])].slice(0, 20),
        });
        return result;
      });
    },
    async versions(key) {
      return access(key, false, (current) =>
        (current?.versions ?? []).map(({ data: _data, ...entry }) => entry),
      );
    },
  };
}

/** Host scope is supplied by the trusted bridge; scopeKey only namespaces fallback IndexedDB. */
export function createEditorHostStorage(
  panel?: Bridge,
  options: EditorHostStorageOptions = { persistent: false },
): EditorHostStorage {
  if (
    !options ||
    typeof options.persistent !== "boolean" ||
    (options.scopeKey !== undefined &&
      (typeof options.scopeKey !== "string" || !options.scopeKey || options.scopeKey.length > 4096))
  )
    throw new Error("工程存储范围无效");
  const host = !!panel && options.persistent;
  const backend = host ? hostBackend(panel!) : indexedBackend(options.scopeKey ?? "browser");
  let initialRead: Promise<Stored> | undefined;
  const legacy = async (key: string): Promise<unknown | null> => {
    const value = panel
      ? await panel.call("storage.get", { key })
      : JSON.parse(localStorage.getItem(key) ?? "null");
    return value === undefined ? null : exactJSON(value);
  };
  const immutable = async (key: string, data: unknown, text: string): Promise<void> => {
    const expected = JSON.stringify(data),
      current = await backend.get(key);
    if (current.data !== null) {
      if (JSON.stringify(current.data) !== expected)
        throw new Error("不可变工程快照内容不一致，已保留原文件");
      return;
    }
    try {
      await backend.set(key, data, 0, text);
    } catch (error) {
      // Immutable content-addressed writes are idempotent, including a lost success reply.
      const latest = await backend.get(key).catch(() => null);
      if (latest?.data !== null && latest && JSON.stringify(latest.data) === expected) return;
      throw error;
    }
  };
  const pack = async (raw: unknown): Promise<Packed> => {
    const { data, bytes } = serialize(raw),
      hash = await sha(bytes);
    if (bytes.length <= INLINE_BYTES)
      return {
        format: "video-studio-packed-document",
        version: 1,
        sha256: hash,
        bytes: bytes.length,
        data,
      };
    const chunks: NonNullable<Packed["chunks"]> = [];
    for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
      const part = bytes.slice(start, start + CHUNK_BYTES),
        hash = await sha(part),
        key = `video-studio-chunk-${hash}`;
      await immutable(
        key,
        {
          format: "video-studio-document-chunk",
          version: 1,
          sha256: hash,
          bytes: part.length,
          encoding: "base64",
          data: base64(part),
        },
        "工程数据分块",
      );
      chunks.push({ key, sha256: hash, bytes: part.length });
    }
    return {
      format: "video-studio-packed-document",
      version: 1,
      sha256: hash,
      bytes: bytes.length,
      chunks,
    };
  };
  const unpack = async (value: unknown): Promise<unknown> => {
    if (!plain(value) || value.format !== "video-studio-packed-document") return exactJSON(value);
    if (
      Object.keys(value).some(
        (key) => !["format", "version", "sha256", "bytes", "data", "chunks"].includes(key),
      ) ||
      value.version !== 1 ||
      !hashPattern.test(value.sha256) ||
      integer(value.bytes, "工程字节数", 1) > MAX_BYTES ||
      Object.hasOwn(value, "data") === Object.hasOwn(value, "chunks")
    )
      throw new Error("工程清单损坏，原存储已保留");
    let bytes: Uint8Array;
    if (Object.hasOwn(value, "data")) bytes = serialize(value.data).bytes;
    else {
      if (
        !Array.isArray(value.chunks) ||
        !value.chunks.length ||
        value.chunks.length > Math.ceil(MAX_BYTES / CHUNK_BYTES)
      )
        throw new Error("工程分块清单损坏");
      bytes = new Uint8Array(value.bytes);
      let offset = 0;
      for (const item of value.chunks) {
        if (
          !plain(item) ||
          Object.keys(item).some((key) => !["key", "sha256", "bytes"].includes(key)) ||
          !hashPattern.test(item.sha256) ||
          item.key !== `video-studio-chunk-${item.sha256}` ||
          integer(item.bytes, "分块字节数", 1) > CHUNK_BYTES ||
          offset + item.bytes > bytes.length
        )
          throw new Error("工程分块引用损坏");
        const chunk = (await backend.get(item.key)).data;
        if (
          !plain(chunk) ||
          chunk.format !== "video-studio-document-chunk" ||
          chunk.version !== 1 ||
          chunk.sha256 !== item.sha256 ||
          chunk.bytes !== item.bytes ||
          chunk.encoding !== "base64"
        )
          throw new Error("工程数据分块缺失或损坏");
        const part = decode64(chunk.data);
        if (part.length !== item.bytes || (await sha(part)) !== item.sha256)
          throw new Error("工程数据分块校验失败，原存储已保留");
        bytes.set(part, offset);
        offset += part.length;
      }
      if (offset !== value.bytes) throw new Error("工程分块总长度不一致");
    }
    if (bytes.length !== value.bytes || (await sha(bytes)) !== value.sha256)
      throw new Error("工程完整性校验失败，原存储已保留");
    try {
      return exactJSON(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    } catch {
      throw new Error("工程 JSON 内容损坏，原存储已保留");
    }
  };
  const validated = (raw: unknown): unknown => {
    const copy = exactJSON(raw);
    if (plain(copy) && copy.schemaVersion === 1) {
      // Validate every supported v1 format, but return the exact JSON for immutable backup.
      migrateLegacyProject(copy);
      return copy;
    }
    return validateEditorDocument(copy);
  };
  const readCurrent = async (): Promise<Stored> => {
    const current = await backend.get(CURRENT);
    if (current.data !== null) return { ...current, data: validated(await unpack(current.data)) };
    // A rejected read, corrupt manifest, or missing chunk never reaches migration fallback.
    const old = await legacy(LEGACY);
    return { revision: current.revision, data: old === null ? null : validated(old) };
  };
  const ensureRead = async () => {
    initialRead ??= readCurrent();
    return initialRead;
  };
  const upgradeIndex = async () => {
    const stored = await backend.get(UPGRADES);
    if (stored.data === null)
      return { revision: stored.revision, entries: [] as EditorUpgradeBackup[] };
    const raw = stored.data;
    if (
      !plain(raw) ||
      raw.format !== UPGRADES ||
      raw.version !== 1 ||
      Object.keys(raw).some((key) => !["format", "version", "entries"].includes(key)) ||
      !Array.isArray(raw.entries) ||
      raw.entries.length > MAX_ENTRIES
    )
      throw new Error("升级前备份目录损坏，原备份已保留");
    const digests = new Set<string>();
    const entries = raw.entries.map((entry: unknown): EditorUpgradeBackup => {
      if (
        !plain(entry) ||
        Object.keys(entry).some(
          (key) => !["digest", "documentId", "name", "revision", "createdAt"].includes(key),
        ) ||
        typeof entry.digest !== "string" ||
        !hashPattern.test(entry.digest) ||
        digests.has(entry.digest) ||
        typeof entry.documentId !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(entry.documentId) ||
        typeof entry.name !== "string" ||
        entry.name.length > 200
      )
        throw new Error("升级前备份记录损坏，原备份已保留");
      digests.add(entry.digest);
      return {
        digest: entry.digest,
        documentId: entry.documentId,
        name: entry.name,
        revision: integer(entry.revision, "原工程版本"),
        createdAt: integer(entry.createdAt, "备份时间"),
      };
    });
    return { revision: stored.revision, entries };
  };
  const backupLegacy = async (raw: unknown): Promise<void> => {
    const exact = exactJSON(raw);
    if (!plain(exact) || exact.schemaVersion !== 1)
      throw new Error("旧工程备份必须是完整的版本 1 JSON");
    const document = migrateLegacyProject(exact);
    const packed = await pack(exact);
    await immutable(`video-studio-legacy-${packed.sha256}`, packed, "升级前原始工程备份");
    // Publish discoverability before v2 can replace the current document. A lost
    // response is verified by reading, and concurrent imports only add entries.
    const entry: EditorUpgradeBackup = {
      digest: packed.sha256,
      documentId: document.id,
      name: document.name,
      revision: integer(exact.revision, "原工程版本"),
      createdAt: Date.now(),
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await upgradeIndex();
      const found = current.entries.find((value) => value.digest === entry.digest);
      if (found) {
        if (
          found.documentId !== entry.documentId ||
          found.name !== entry.name ||
          found.revision !== entry.revision
        )
          throw new Error("升级前备份身份与目录不一致");
        return;
      }
      if (current.entries.length >= MAX_ENTRIES)
        throw new Error("升级前备份目录已满，请先导出整理；原工程未替换");
      try {
        await backend.set(
          UPGRADES,
          { format: UPGRADES, version: 1, entries: [entry, ...current.entries] },
          current.revision,
          "登记升级前原始工程备份",
        );
        return;
      } catch (error) {
        const latest = await upgradeIndex().catch(() => undefined);
        if (
          latest?.entries.some(
            (value) =>
              value.digest === entry.digest &&
              value.documentId === entry.documentId &&
              value.name === entry.name &&
              value.revision === entry.revision,
          )
        )
          return;
        if (!conflict(error) || attempt === 3) throw error;
      }
    }
  };
  const snapshot = async (document: EditorDocument): Promise<string> => {
    const packed = await pack(validateEditorDocument(document)),
      key = `video-studio-snapshot-${packed.sha256}`;
    await immutable(key, packed, "工程归档快照");
    return key;
  };
  const parseIndex = (raw: unknown): ArchiveIndex => {
    if (
      !plain(raw) ||
      raw.format !== "video-studio-archive-index" ||
      raw.version !== 1 ||
      Object.keys(raw).some((key) => !["format", "version", "entries"].includes(key)) ||
      !Array.isArray(raw.entries) ||
      raw.entries.length > MAX_ENTRIES
    )
      throw new Error("最近工程索引损坏，原归档已保留");
    const ids = new Set<string>();
    const entries = raw.entries.map((item: unknown) => {
      if (
        !plain(item) ||
        Object.keys(item).some(
          (key) => !["documentId", "name", "snapshotKey", "updatedAt"].includes(key),
        ) ||
        typeof item.documentId !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(item.documentId) ||
        ids.has(item.documentId) ||
        typeof item.name !== "string" ||
        item.name.length > 200 ||
        typeof item.snapshotKey !== "string" ||
        !/^video-studio-snapshot-[a-f0-9]{64}$/.test(item.snapshotKey)
      )
        throw new Error("最近工程引用损坏，原归档已保留");
      ids.add(item.documentId);
      return {
        documentId: item.documentId,
        name: item.name,
        snapshotKey: item.snapshotKey,
        updatedAt: integer(item.updatedAt, "归档时间"),
      };
    });
    return { format: "video-studio-archive-index", version: 1, entries };
  };
  const archiveIndex = async (): Promise<{ index: ArchiveIndex; revision: number }> => {
    const current = await backend.get(ARCHIVE);
    if (current.data !== null)
      return { index: parseIndex(current.data), revision: current.revision };
    const oldDocument = await backend.get(OLD_ARCHIVE);
    const old = oldDocument.data === null ? await legacy(OLD_ARCHIVE) : oldDocument.data;
    const index: ArchiveIndex = { format: "video-studio-archive-index", version: 1, entries: [] };
    if (old === null) return { index, revision: current.revision };
    if (!Array.isArray(old) || old.length > MAX_ENTRIES)
      throw new Error("旧最近工程记录损坏，原数据已保留");
    const prepared: Array<{ document: EditorDocument; raw: unknown }> = [];
    const ids = new Set<string>();
    for (const value of old) {
      const raw = validated(value),
        document =
          plain(raw) && raw.schemaVersion === 1
            ? migrateLegacyProject(raw)
            : validateEditorDocument(raw);
      if (ids.has(document.id)) throw new Error("旧最近工程包含重复 ID，原数据已保留");
      ids.add(document.id);
      prepared.push({ document, raw });
    }
    for (const { document, raw } of prepared) {
      if (plain(raw) && raw.schemaVersion === 1) await backupLegacy(raw);
      index.entries.push({
        documentId: document.id,
        name: document.name,
        snapshotKey: await snapshot(document),
        updatedAt: Date.now(),
      });
    }
    try {
      const receipt = await backend.set(ARCHIVE, index, current.revision, "升级旧工程归档");
      return { index, revision: receipt.revision };
    } catch (error) {
      if (!conflict(error)) throw error;
      const latest = await backend.get(ARCHIVE);
      if (latest.data === null) throw error;
      return { index: parseIndex(latest.data), revision: latest.revision };
    }
  };
  return {
    async read() {
      const result = readCurrent();
      initialRead ??= result;
      return result;
    },
    async write(value, baseRevision, text) {
      const document = validateEditorDocument(value);
      integer(baseRevision, "基础存储版本");
      label(text);
      await ensureRead();
      const current = await readCurrent();
      if (current.revision !== baseRevision)
        throw new EditorStorageConflictError(undefined, current.revision);
      if (plain(current.data) && current.data.schemaVersion === 1) await backupLegacy(current.data);
      const packed = await pack(document);
      const receipt = await backend.set(CURRENT, packed, baseRevision, text);
      if (receipt.revision !== baseRevision + 1)
        throw new EditorStorageConflictError("保存回执版本无效，请保留当前修改并重新检查存储");
      return { revision: receipt.revision };
    },
    backupLegacy,
    async upgradeBackups() {
      const existing = await upgradeIndex();
      if (existing.entries.length) return existing.entries;
      // Earlier releases retained exact payloads without a directory. Recover
      // discoverable v1 sources; never invent a v1 document from migrated v2.
      const source = await legacy(LEGACY);
      if (plain(source) && source.schemaVersion === 1) await backupLegacy(source);
      for (const version of await backend.versions(CURRENT)) {
        const raw = await unpack((await backend.get(CURRENT, version.revision)).data);
        if (plain(raw) && raw.schemaVersion === 1) await backupLegacy(raw);
      }
      return (await upgradeIndex()).entries;
    },
    async readUpgradeBackup(digest) {
      if (typeof digest !== "string" || !hashPattern.test(digest))
        throw new Error("升级前备份标识无效");
      const entry = (await upgradeIndex()).entries.find((value) => value.digest === digest);
      if (!entry) throw new Error("找不到这份升级前备份，请重新打开历史版本");
      const packed = (await backend.get(`video-studio-legacy-${digest}`)).data;
      if (
        !plain(packed) ||
        packed.format !== "video-studio-packed-document" ||
        packed.sha256 !== digest
      )
        throw new Error("升级前备份缺失或内容地址不一致，当前工程保持不变");
      const raw = await unpack(packed);
      if (!plain(raw) || raw.schemaVersion !== 1) throw new Error("升级前备份不是原始旧版工程");
      const document = migrateLegacyProject(raw);
      if (
        document.id !== entry.documentId ||
        document.name !== entry.name ||
        raw.revision !== entry.revision
      )
        throw new Error("升级前备份身份与目录不一致，当前工程保持不变");
      return raw;
    },
    async versions() {
      return backend.versions(CURRENT);
    },
    async readVersion(revision) {
      integer(revision, "历史版本", 1);
      return validated(await unpack((await backend.get(CURRENT, revision)).data));
    },
    async archive(value) {
      const document = validateEditorDocument(value);
      await ensureRead();
      const { index, revision } = await archiveIndex();
      if (
        index.entries.length >= MAX_ENTRIES &&
        !index.entries.some((item) => item.documentId === document.id)
      )
        throw new Error("归档索引已达容量上限，已保留所有现有项目，请先导出或整理归档");
      const key = await snapshot(document);
      const next: ArchiveIndex = {
        ...index,
        entries: [
          { documentId: document.id, name: document.name, snapshotKey: key, updatedAt: Date.now() },
          ...index.entries.filter((item) => item.documentId !== document.id),
        ],
      };
      await backend.set(ARCHIVE, next, revision, "切换工程前归档");
    },
    async listArchived() {
      await ensureRead();
      const { index } = await archiveIndex(),
        result: EditorDocument[] = [];
      for (const entry of index.entries) {
        const current = await backend.get(entry.snapshotKey);
        if (current.data === null) throw new Error("工程归档快照缺失，已保留归档索引");
        if (
          !plain(current.data) ||
          current.data.format !== "video-studio-packed-document" ||
          entry.snapshotKey !== `video-studio-snapshot-${current.data.sha256}`
        )
          throw new Error("工程归档快照与内容地址不一致");
        const document = validateEditorDocument(await unpack(current.data));
        if (document.id !== entry.documentId || document.name !== entry.name)
          throw new Error("工程归档身份与索引不一致");
        result.push(document);
      }
      return result;
    },
  };
}
