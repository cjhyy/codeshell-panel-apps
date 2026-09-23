import { randomId } from "../ids.js";
import { createPanelRuntime, type RuntimeBridge } from "../sdk/panel-runtime";
import { isResourceId } from "../external-media";
import { validateEditorDocument } from "./validation";
import {
  snapshotCanonical,
  snapshotDigest,
  syncObject,
  syncArray,
  syncHash,
  syncToken,
  validateSnapshot,
  SnapshotSyncError,
  type EditorSnapshot,
} from "./snapshot-sync";
import {
  validateEditorSyncPublicationReceipt,
  type EditorSyncPublicationReceipt,
} from "./sync-bridge";
import type { EditorProjectImportReceipt, EditorTaskArtifact } from "./task-bridge";

export interface SyncImportRecord {
  snapshot: EditorSnapshot;
  bundle: EditorTaskArtifact;
  transferId: string;
  receipt: EditorProjectImportReceipt | null;
}
export interface SyncApplyRecord {
  id: string;
  candidateHash: string;
  beforeHash: string;
  beforeStorageRevision: number;
  parents: string[];
  kind: "version" | "merge";
  snapshotIds: string[];
  choices: Record<string, "base" | "left" | "right">;
  phase: "prepared" | "committed";
}
export interface EditorSyncState {
  format: "mimi-video-sync-client";
  version: 1;
  projectId: string;
  deviceId: string;
  base: { parents: string[]; contentHash: string; needsPublish: boolean } | null;
  pendingPublication: { receipt: EditorSyncPublicationReceipt; contentHash: string } | null;
  imports: SyncImportRecord[];
  pendingApply: SyncApplyRecord | null;
}
const fail = (): never => {
  throw new SnapshotSyncError("INVALID_SYNC_STATE", "同步恢复记录损坏或版本不受支持，原记录已保留");
};
function hashes(value: unknown, maximum = 16): string[] {
  const list = syncArray(value, maximum).map((hash) => {
    if (!syncHash(hash)) fail();
    return hash as string;
  });
  if (new Set(list).size !== list.length) fail();
  return list;
}
function artifact(value: unknown, mime: string, maximum: number): EditorTaskArtifact {
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
    Number(data.bytes) > maximum ||
    data.mimeType !== mime ||
    (data.name !== undefined && (typeof data.name !== "string" || data.name.length > 240))
  )
    fail();
  return {
    id: data.id as string,
    sha256: data.sha256 as string,
    bytes: data.bytes as number,
    mimeType: mime,
    ...(typeof data.name === "string" ? { name: data.name } : {}),
  };
}
function importReceipt(value: unknown): EditorProjectImportReceipt {
  const data = syncObject(value, [
    "transferId",
    "bundleHash",
    "sourceResourceId",
    "manifest",
    "mediaCount",
    "workspaceKey",
  ]);
  if (
    typeof data.transferId !== "string" ||
    !/^editor-[a-f0-9-]{36}$/.test(data.transferId) ||
    !syncHash(data.bundleHash) ||
    !isResourceId(data.sourceResourceId) ||
    !Number.isSafeInteger(data.mediaCount) ||
    Number(data.mediaCount) < 0 ||
    Number(data.mediaCount) > 10000 ||
    !syncHash(data.workspaceKey)
  )
    fail();
  return {
    transferId: data.transferId as string,
    bundleHash: data.bundleHash as string,
    sourceResourceId: data.sourceResourceId as string,
    manifest: artifact(data.manifest, "application/json", 32 * 1024 ** 2),
    mediaCount: data.mediaCount as number,
    workspaceKey: data.workspaceKey as string,
  };
}
export function validateEditorSyncState(value: unknown, projectId: string): EditorSyncState {
  const data = syncObject(value, [
    "format",
    "version",
    "projectId",
    "deviceId",
    "base",
    "pendingPublication",
    "imports",
    "pendingApply",
  ]);
  if (
    data.format !== "mimi-video-sync-client" ||
    data.version !== 1 ||
    data.projectId !== projectId ||
    !syncToken(data.deviceId)
  )
    fail();
  let base: EditorSyncState["base"] = null,
    pendingPublication: EditorSyncState["pendingPublication"] = null,
    pendingApply: SyncApplyRecord | null = null;
  if (data.base !== null) {
    const b = syncObject(data.base, ["parents", "contentHash", "needsPublish"]);
    if (!syncHash(b.contentHash) || typeof b.needsPublish !== "boolean") fail();
    const parents = hashes(b.parents);
    if (!parents.length) fail();
    base = {
      parents,
      contentHash: b.contentHash as string,
      needsPublish: b.needsPublish as boolean,
    };
  }
  if (data.pendingPublication !== null) {
    const p = syncObject(data.pendingPublication, ["receipt", "contentHash"]);
    if (!syncHash(p.contentHash)) fail();
    const receipt = validateEditorSyncPublicationReceipt(p.receipt);
    receipt.snapshot = validateSnapshot(receipt.snapshot);
    if (
      receipt.snapshot.projectId !== projectId ||
      receipt.snapshot.bundle.sha256 !== receipt.bundle.sha256 ||
      receipt.snapshot.bundle.bytes !== receipt.bundle.bytes
    )
      fail();
    pendingPublication = { receipt, contentHash: p.contentHash as string };
  }
  const imports = syncArray(data.imports, 16).map((raw) => {
    const record = syncObject(raw, ["snapshot", "bundle", "transferId", "receipt"]),
      snapshot = validateSnapshot(record.snapshot),
      bundle = artifact(record.bundle, "application/zip", 20 * 1024 ** 3),
      receipt = record.receipt === null ? null : importReceipt(record.receipt);
    if (typeof record.transferId !== "string" || !/^editor-[a-f0-9-]{36}$/.test(record.transferId))
      fail();
    if (
      snapshot.projectId !== projectId ||
      snapshot.bundle.sha256 !== bundle.sha256 ||
      snapshot.bundle.bytes !== bundle.bytes ||
      (receipt &&
        (receipt.bundleHash !== bundle.sha256 ||
          receipt.sourceResourceId !== bundle.id ||
          receipt.transferId !== record.transferId))
    )
      fail();
    return { snapshot, bundle, transferId: record.transferId as string, receipt };
  });
  if (new Set(imports.map((item) => item.snapshot.id)).size !== imports.length) fail();
  if (data.pendingApply !== null) {
    const p = syncObject(data.pendingApply, [
      "id",
      "candidateHash",
      "beforeHash",
      "beforeStorageRevision",
      "parents",
      "kind",
      "snapshotIds",
      "choices",
      "phase",
    ]);
    if (
      !syncToken(p.id) ||
      !syncHash(p.candidateHash) ||
      !syncHash(p.beforeHash) ||
      !Number.isSafeInteger(p.beforeStorageRevision) ||
      Number(p.beforeStorageRevision) < 0 ||
      !["version", "merge"].includes(p.kind as string) ||
      !["prepared", "committed"].includes(p.phase as string)
    )
      fail();
    const parents = hashes(p.parents),
      snapshotIds = hashes(p.snapshotIds, 3);
    if (!parents.length || snapshotIds.length !== (p.kind === "version" ? 1 : 3)) fail();
    if (
      !p.choices ||
      typeof p.choices !== "object" ||
      Array.isArray(p.choices) ||
      Object.getPrototypeOf(p.choices) !== Object.prototype ||
      Object.keys(p.choices).length > 30000
    )
      fail();
    const choices: SyncApplyRecord["choices"] = {};
    for (const key of Reflect.ownKeys(p.choices as object)) {
      const d = Object.getOwnPropertyDescriptor(p.choices, key)!;
      if (
        typeof key !== "string" ||
        key.length > 512 ||
        !d.enumerable ||
        !("value" in d) ||
        !["base", "left", "right"].includes(d.value)
      )
        fail();
      choices[key as string] = d.value;
    }
    pendingApply = {
      id: p.id as string,
      candidateHash: p.candidateHash as string,
      beforeHash: p.beforeHash as string,
      beforeStorageRevision: p.beforeStorageRevision as number,
      parents,
      kind: p.kind as "version" | "merge",
      snapshotIds,
      choices,
      phase: p.phase as "prepared" | "committed",
    };
  }
  return {
    format: "mimi-video-sync-client",
    version: 1,
    projectId,
    deviceId: data.deviceId as string,
    base,
    pendingPublication,
    imports,
    pendingApply,
  };
}
/** Revision counters and device-local resource handles are not edits when a known byte fingerprint matches. */
export async function editorSyncContentHash(value: unknown): Promise<string> {
  const document = validateEditorDocument(value);
  document.revision = 0;
  for (const asset of document.assets) {
    const hash =
      asset.fingerprint ??
      (/^asset-[a-f0-9]{64}$/.test(asset.resourceId ?? "")
        ? asset.resourceId!.slice(6)
        : undefined);
    if (hash) {
      asset.fingerprint = hash;
      delete asset.resourceId;
    }
  }
  return snapshotDigest(snapshotCanonical(document));
}
export function createEditorSyncStorage(panel: RuntimeBridge, projectId: string) {
  const runtime = createPanelRuntime(panel);
  let revision: number | undefined, key: string | undefined, cwd: string | undefined;
  async function scope() {
    const context = await panel.getContext(),
      current = String(context.cwd ?? "");
    if (cwd !== undefined && current !== cwd)
      throw new SnapshotSyncError("WORKSPACE_CHANGED", "工作区已切换，同步恢复记录未写入");
    cwd = current;
    await runtime.requireMethods(["media.document.get", "media.document.set"]);
    key ??= `video-studio-sync-${await snapshotDigest(projectId)}`;
  }
  return {
    async read(): Promise<EditorSyncState> {
      await scope();
      const raw = (await runtime.call("media.document.get", { key })) as any;
      await scope();
      if (
        !raw ||
        !Number.isSafeInteger(raw.revision) ||
        raw.revision < 0 ||
        !Object.hasOwn(raw, "data") ||
        (raw.revision === 0) !== (raw.data === null)
      )
        fail();
      revision = raw.revision;
      if (raw.data !== null) return validateEditorSyncState(raw.data, projectId);
      return {
        format: "mimi-video-sync-client",
        version: 1,
        projectId,
        deviceId: randomId(),
        base: null,
        pendingPublication: null,
        imports: [],
        pendingApply: null,
      };
    },
    async write(value: EditorSyncState): Promise<EditorSyncState> {
      await scope();
      if (revision === undefined) throw new Error("同步状态尚未读取");
      const data = validateEditorSyncState(value, projectId);
      if (new TextEncoder().encode(JSON.stringify(data)).length > 512 * 1024)
        throw new SnapshotSyncError(
          "SYNC_STATE_LIMIT",
          "同步恢复记录超过 512 KiB，请先清理已完成的暂存任务",
        );
      const expected = revision;
      const raw = (await runtime.call("media.document.set", {
        key,
        data,
        baseRevision: expected,
        label: "保存同步恢复状态",
      })) as any;
      await scope();
      if (!raw || raw.revision !== expected + 1) fail();
      revision = raw.revision;
      return data;
    },
    dispose() {
      runtime.dispose();
    },
  };
}
