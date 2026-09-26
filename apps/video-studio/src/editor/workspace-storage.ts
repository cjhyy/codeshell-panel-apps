import type { PanelBridge, ProjectVersion } from "../host";
import { EditorStorageConflictError } from "./session";

const ROOT = "video-studio-data/documents";
const PART_BYTES = 192 * 1024;
const MAX_BYTES = 34 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const plain = (v: any): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const natural = (v: unknown, min = 0): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min;
const digest = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
interface Entry extends ProjectVersion {
  sha256: string;
  bytes: number;
  parts: string[];
}
interface Index {
  format: "video-studio-workspace-document";
  version: 1;
  key: string;
  entries: Entry[];
}

/** Domain-owned document history over Host-authorized conditional workspace writes.
 * Immutable data parts are published before a single CAS index; interrupted writes
 * never replace the previous document. Retained parts are not silently deleted.
 */
export function workspaceDocumentBackend(panel: Pick<PanelBridge, "call">) {
  function directory(key: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(key)) throw new Error("工程存储键无效");
    return `${ROOT}/indexes/${key}`;
  }
  async function readFile(path: string) {
    const value = await panel.call("workspace.readText", { path });
    if (
      !plain(value) ||
      value.path !== path ||
      typeof value.content !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(value.revision)
    )
      throw new Error("工程文件读取回执无效");
    if (`sha256:${await digest(encoder.encode(value.content))}` !== value.revision)
      throw new Error("工程文件摘要不一致");
    return { content: value.content, revision: value.revision as string };
  }
  async function index(key: string): Promise<{ data: Index; revision: string | null }> {
    const dir = directory(key),
      path = `${dir}/index.json`;
    const listing = await panel.call("workspace.list", { path: dir });
    if (!plain(listing) || !Array.isArray(listing.entries) || listing.truncated !== false)
      throw new Error("工程目录读取不完整，已阻止覆盖");
    if (!listing.entries.some((entry: any) => entry.path === path))
      return {
        data: { format: "video-studio-workspace-document", version: 1, key, entries: [] },
        revision: null,
      };
    const file = await readFile(path),
      data = JSON.parse(file.content);
    if (
      !plain(data) ||
      data.format !== "video-studio-workspace-document" ||
      data.version !== 1 ||
      data.key !== key ||
      Object.keys(data).some((k) => !["format", "version", "key", "entries"].includes(k)) ||
      !Array.isArray(data.entries) ||
      !data.entries.length ||
      data.entries.length > 20
    )
      throw new Error("工程版本目录损坏，已保留原文件");
    for (const [i, entry] of data.entries.entries()) {
      if (
        !plain(entry) ||
        Object.keys(entry).some(
          (k) => !["revision", "updatedAt", "label", "sha256", "bytes", "parts"].includes(k),
        ) ||
        !natural(entry.revision, 1) ||
        !natural(entry.updatedAt) ||
        typeof entry.label !== "string" ||
        entry.label.length > 200 ||
        !hashPattern.test(entry.sha256) ||
        !natural(entry.bytes, 1) ||
        entry.bytes > MAX_BYTES ||
        !Array.isArray(entry.parts) ||
        entry.parts.length !== Math.ceil(entry.bytes / PART_BYTES) ||
        entry.parts.some((part: unknown) => typeof part !== "string" || !hashPattern.test(part)) ||
        (i > 0 && entry.revision !== data.entries[i - 1].revision - 1)
      )
        throw new Error("工程版本记录损坏，已保留原文件");
    }
    return { data: data as Index, revision: file.revision };
  }
  async function unpack(entry: Entry) {
    const bytes = new Uint8Array(entry.bytes);
    let offset = 0;
    for (const hash of entry.parts) {
      const file = await readFile(`${ROOT}/parts/${hash}.txt`);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)) throw new Error("工程分块编码损坏");
      const binary = atob(file.content),
        part = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      if (
        part.length !== Math.min(PART_BYTES, entry.bytes - offset) ||
        (await digest(part)) !== hash
      )
        throw new Error("工程分块校验失败，原文件已保留");
      bytes.set(part, offset);
      offset += part.length;
    }
    if (offset !== entry.bytes || (await digest(bytes)) !== entry.sha256)
      throw new Error("工程完整性校验失败");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  async function pack(data: unknown) {
    const content = JSON.stringify(data);
    if (typeof content !== "string") throw new Error("工程必须是 JSON 数据");
    const bytes = encoder.encode(content);
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("工程超过存储上限");
    const sha256 = await digest(bytes),
      parts: string[] = [];
    for (let start = 0; start < bytes.length; start += PART_BYTES) {
      const part = bytes.slice(start, start + PART_BYTES),
        hash = await digest(part),
        path = `${ROOT}/parts/${hash}.txt`;
      let binary = "";
      for (let i = 0; i < part.length; i += 8192)
        binary += String.fromCharCode(...part.subarray(i, i + 8192));
      const content = btoa(binary);
      try {
        await panel.call("workspace.writeText", { path, content, expectedModifiedAt: null });
      } catch (error) {
        const existing = await readFile(path).catch(() => null);
        if (existing?.content !== content) throw error;
      }
      parts.push(hash);
    }
    return { sha256, bytes: bytes.length, parts };
  }
  return {
    async get(key: string, revision?: number) {
      const current = await index(key),
        entry =
          revision === undefined
            ? current.data.entries[0]
            : current.data.entries.find((v) => v.revision === revision);
      if (!entry) {
        if (revision !== undefined) throw new Error("工程历史版本不存在");
        return { revision: 0, data: null };
      }
      return { revision: entry.revision, updatedAt: entry.updatedAt, data: await unpack(entry) };
    },
    async versions(key: string): Promise<ProjectVersion[]> {
      return (await index(key)).data.entries.map(({ revision, updatedAt, label }) => ({
        revision,
        updatedAt,
        label,
      }));
    },
    async set(
      key: string,
      data: unknown,
      baseRevision: number,
      label: string,
    ): Promise<ProjectVersion> {
      if (
        !natural(baseRevision) ||
        baseRevision === Number.MAX_SAFE_INTEGER ||
        typeof label !== "string" ||
        !label.trim() ||
        label.length > 200
      )
        throw new Error("工程保存参数无效");
      const current = await index(key);
      if ((current.data.entries[0]?.revision ?? 0) !== baseRevision)
        throw new EditorStorageConflictError();
      const packed = await pack(data),
        entry = { revision: baseRevision + 1, updatedAt: Date.now(), label, ...packed };
      const next: Index = {
          ...current.data,
          entries: [entry, ...current.data.entries].slice(0, 20),
        },
        content = JSON.stringify(next),
        path = `${directory(key)}/index.json`;
      try {
        await panel.call("workspace.writeText", {
          path,
          content,
          ...(current.revision === null
            ? { expectedModifiedAt: null }
            : { expectedRevision: current.revision }),
        });
      } catch (error) {
        const latest = await readFile(path).catch(() => null);
        if (latest?.content !== content) {
          if (latest && latest.revision !== current.revision)
            throw new EditorStorageConflictError();
          throw error;
        }
      }
      return { revision: entry.revision, updatedAt: entry.updatedAt, label: entry.label };
    },
  };
}
