import { validateEditorDocument } from "./validation";
import type { EditorDocument } from "./types";

export const SNAPSHOT_FORMAT = "mimi-video-snapshot";
export const SNAPSHOT_VERSION = 1;
export const SYNC_LIMITS = Object.freeze({
  snapshots: 10000,
  parents: 16,
  recordBytes: 8192,
  bundleBytes: 20 * 1024 ** 3,
  pageSize: 64,
});
export interface SnapshotInput {
  projectId: string;
  bundle: { sha256: string; bytes: number };
  parents: string[];
  deviceId: string;
  createdAt: string;
  note: string;
}
export interface EditorSnapshot extends SnapshotInput {
  format: typeof SNAPSHOT_FORMAT;
  formatVersion: typeof SNAPSHOT_VERSION;
  id: string;
}
export type BundlePresence = "present-unverified" | "missing" | "size-mismatch" | "unsafe";
export interface SyncHistoryEntry {
  snapshot: EditorSnapshot;
  bundleState: BundlePresence;
}
export class SnapshotSyncError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SnapshotSyncError";
  }
}
export const syncHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const syncToken = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const fail = (message: string): never => {
  throw new SnapshotSyncError("INVALID_SNAPSHOT", message);
};
export function syncObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail("同步记录必须是普通对象");
  const own = Reflect.ownKeys(value as object);
  if (own.length !== keys.length || keys.some((key) => !own.includes(key)))
    fail("同步记录字段缺失或不支持");
  for (const key of own) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (
      typeof key !== "string" ||
      !keys.includes(key) ||
      !property.enumerable ||
      !("value" in property)
    )
      fail("同步记录不能包含额外字段或访问器");
  }
  return value as Record<string, unknown>;
}
export function syncArray(value: unknown, maximum: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    fail("同步记录数组超限或含空洞");
  const list = value as unknown[];
  for (let i = 0; i < list.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(list, String(i));
    if (!descriptor?.enumerable || !("value" in descriptor)) fail("同步记录数组含访问器或空洞");
  }
  return list;
}
/** Canonical UTF-8 JSON: recursively sorted object keys, array order preserved, no insignificant whitespace. */
export function snapshotCanonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(snapshotCanonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${snapshotCanonical((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}
export async function snapshotDigest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export function validateSnapshot(value: unknown): EditorSnapshot {
  const data = syncObject(value, [
    "format",
    "formatVersion",
    "id",
    "projectId",
    "bundle",
    "parents",
    "deviceId",
    "createdAt",
    "note",
  ]);
  if (data.format !== SNAPSHOT_FORMAT) fail("不是 Mimi 工程快照");
  if (data.formatVersion !== SNAPSHOT_VERSION)
    throw new SnapshotSyncError("UNSUPPORTED_SYNC_VERSION", "不支持的同步快照版本");
  if (
    !syncHash(data.id) ||
    typeof data.projectId !== "string" ||
    !data.projectId ||
    data.projectId.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(data.projectId)
  )
    fail("快照或工程标识无效");
  const bundle = syncObject(data.bundle, ["sha256", "bytes"]);
  if (
    !syncHash(bundle.sha256) ||
    !Number.isSafeInteger(bundle.bytes) ||
    Number(bundle.bytes) < 1 ||
    Number(bundle.bytes) > SYNC_LIMITS.bundleBytes
  )
    fail("工程包摘要或大小无效");
  const parents = syncArray(data.parents, SYNC_LIMITS.parents).map((parent) => {
    if (!syncHash(parent) || parent === data.id) fail("父快照标识无效");
    return parent as string;
  });
  if (
    new Set(parents).size !== parents.length ||
    parents.some((parent, index) => index > 0 && parents[index - 1]! >= parent)
  )
    fail("父快照必须去重并按摘要排序");
  if (
    !syncToken(data.deviceId) ||
    typeof data.createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.createdAt) ||
    !Number.isFinite(Date.parse(data.createdAt)) ||
    new Date(data.createdAt).toISOString() !== data.createdAt ||
    typeof data.note !== "string" ||
    data.note.length > 240 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data.note)
  )
    fail("快照设备、时间或备注无效");
  return {
    format: SNAPSHOT_FORMAT,
    formatVersion: SNAPSHOT_VERSION,
    id: data.id as string,
    projectId: data.projectId as string,
    bundle: { sha256: bundle.sha256 as string, bytes: bundle.bytes as number },
    parents,
    deviceId: data.deviceId as string,
    createdAt: data.createdAt as string,
    note: data.note as string,
  };
}
function payload(snapshot: EditorSnapshot) {
  const { id: _, ...rest } = snapshot;
  return rest;
}
export async function createSnapshot(input: SnapshotInput): Promise<EditorSnapshot> {
  const data = syncObject(input, [
    "projectId",
    "bundle",
    "parents",
    "deviceId",
    "createdAt",
    "note",
  ]);
  const parents = syncArray(data.parents, SYNC_LIMITS.parents)
    .map((value) => {
      if (!syncHash(value)) fail("父快照标识无效");
      return value as string;
    })
    .sort();
  const checked = validateSnapshot({
    ...data,
    parents,
    id: "0".repeat(64),
    format: SNAPSHOT_FORMAT,
    formatVersion: SNAPSHOT_VERSION,
  });
  return { ...checked, id: await snapshotDigest(snapshotCanonical(payload(checked))) };
}
export async function verifySnapshot(value: unknown): Promise<EditorSnapshot> {
  const checked = validateSnapshot(value);
  if ((await snapshotDigest(snapshotCanonical(payload(checked)))) !== checked.id)
    throw new SnapshotSyncError("SNAPSHOT_HASH_MISMATCH", "快照内容与摘要不一致");
  return checked;
}
export const snapshotBundlePath = (hash: string): string => {
  if (!syncHash(hash)) fail("工程包摘要无效");
  return `mimi-sync/v1/bundles/${hash}.mimiproject`;
};
export const snapshotIncomingPath = (token: string): string => {
  if (!syncToken(token)) fail("传输标识无效");
  return `mimi-sync/v1/incoming/${token}.mimiproject`;
};
export async function snapshotRecordPath(snapshot: EditorSnapshot): Promise<string> {
  const checked = validateSnapshot(snapshot);
  return `mimi-sync/v1/projects/${await snapshotDigest(checked.projectId)}/snapshots/${checked.id}.json`;
}
export interface SnapshotGraph {
  snapshots: EditorSnapshot[];
  heads: string[];
  missingParents: string[];
  /** Incomplete propagation prevents a conclusive ahead/behind/conflict decision. */
  complete: boolean;
}
export function analyzeSnapshotGraph(values: readonly EditorSnapshot[]): SnapshotGraph {
  const snapshots = syncArray(values, SYNC_LIMITS.snapshots).map(validateSnapshot),
    byId = new Map<string, EditorSnapshot>();
  for (const snapshot of snapshots) {
    if (byId.has(snapshot.id)) fail("快照摘要重复");
    if (snapshots[0] && snapshot.projectId !== snapshots[0].projectId) fail("快照属于不同工程");
    byId.set(snapshot.id, snapshot);
  }
  const pending = new Set<string>(),
    referenced = new Set<string>(),
    done = new Set<string>();
  // Iterative DFS avoids overflowing the JS stack on long linear histories.
  for (const snapshot of snapshots) {
    if (done.has(snapshot.id)) continue;
    const stack: Array<{ id: string; exit: boolean }> = [{ id: snapshot.id, exit: false }],
      active = new Set<string>();
    while (stack.length) {
      const frame = stack.pop()!;
      if (frame.exit) {
        active.delete(frame.id);
        done.add(frame.id);
        continue;
      }
      if (active.has(frame.id)) fail("快照父关系包含循环");
      if (done.has(frame.id)) continue;
      const item = byId.get(frame.id);
      if (!item) {
        pending.add(frame.id);
        continue;
      }
      active.add(frame.id);
      stack.push({ id: frame.id, exit: true });
      for (const parent of item.parents) {
        referenced.add(parent);
        stack.push({ id: parent, exit: false });
      }
    }
  }
  return {
    snapshots: [...snapshots].sort((a, b) => a.id.localeCompare(b.id)),
    heads: snapshots
      .filter((snapshot) => !referenced.has(snapshot.id))
      .map((snapshot) => snapshot.id)
      .sort(),
    missingParents: [...pending].sort(),
    complete: pending.size === 0,
  };
}
export function snapshotRelationship(
  graph: SnapshotGraph,
  left: string,
  right: string,
): { kind: "same" | "ahead" | "behind" | "conflict" | "incomplete"; commonAncestors: string[] } {
  const checked = analyzeSnapshotGraph(graph.snapshots),
    byId = new Map(checked.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  if (!byId.has(left) || !byId.has(right))
    throw new SnapshotSyncError("MISSING_SNAPSHOT", "比较所需的快照还没有同步完成");
  const ancestors = (start: string) => {
    const found = new Set<string>(),
      queue = [start];
    while (queue.length) {
      const id = queue.pop()!;
      if (found.has(id)) continue;
      found.add(id);
      queue.push(...(byId.get(id)?.parents ?? []));
    }
    return found;
  };
  if (!graph.complete) return { kind: "incomplete", commonAncestors: [] };
  const l = ancestors(left),
    r = ancestors(right);
  if ([...l, ...r].some((id) => !byId.has(id))) return { kind: "incomplete", commonAncestors: [] };
  const common = [...l].filter((id) => r.has(id)),
    candidates = new Set(common);
  for (const id of common) for (const parent of byId.get(id)!.parents) candidates.delete(parent);
  return {
    kind: left === right ? "same" : l.has(right) ? "ahead" : r.has(left) ? "behind" : "conflict",
    commonAncestors: [...candidates].sort(),
  };
}

export interface MergeValue {
  present: boolean;
  value?: unknown;
}
export interface SnapshotMergeUnit {
  key: string;
  label: string;
  base: MergeValue;
  left: MergeValue;
  right: MergeValue;
  status: "unchanged" | "left" | "right" | "both" | "conflict";
}
export interface SnapshotMergePlan {
  base: EditorDocument;
  left: EditorDocument;
  right: EditorDocument;
  units: SnapshotMergeUnit[];
}
const equal = (a: MergeValue, b: MergeValue) =>
  a.present === b.present &&
  (!a.present || snapshotCanonical(a.value) === snapshotCanonical(b.value));
/** Granularity is explicit: an entire sequence is one unit, never a pretend clip-level merge. */
export function planSnapshotMerge(
  baseValue: unknown,
  leftValue: unknown,
  rightValue: unknown,
): SnapshotMergePlan {
  const base = validateEditorDocument(baseValue),
    left = validateEditorDocument(leftValue),
    right = validateEditorDocument(rightValue);
  if (base.id !== left.id || base.id !== right.id)
    throw new SnapshotSyncError("PROJECT_MISMATCH", "只能合并同一工程的版本");
  const units: SnapshotMergeUnit[] = [];
  const add = (key: string, label: string, b: MergeValue, l: MergeValue, r: MergeValue) => {
    const status = equal(l, r)
      ? equal(b, l)
        ? "unchanged"
        : "both"
      : equal(b, l)
        ? "right"
        : equal(b, r)
          ? "left"
          : "conflict";
    units.push({ key, label, base: b, left: l, right: r, status });
  };
  const field = (doc: EditorDocument, key: keyof EditorDocument): MergeValue =>
    Object.hasOwn(doc, key)
      ? { present: true, value: structuredClone(doc[key]) }
      : { present: false };
  for (const key of ["name", "activeSequenceId", "production"] as const)
    add(key, key, field(base, key), field(left, key), field(right, key));
  for (const collection of ["assets", "sequences", "exportProfiles"] as const) {
    const arrays = [base[collection], left[collection], right[collection]],
      maps = arrays.map((array) => new Map(array.map((value) => [value.id, value])));
    for (const id of [
      ...new Set(arrays.flatMap((array) => array.map((value) => value.id))),
    ].sort()) {
      const values = maps.map((map) =>
        map.has(id) ? { present: true, value: structuredClone(map.get(id)) } : { present: false },
      );
      add(
        `${collection}/${encodeURIComponent(id)}`,
        `${collection}: ${id}`,
        values[0]!,
        values[1]!,
        values[2]!,
      );
    }
    add(
      `${collection}/@order`,
      `${collection} 顺序`,
      ...(arrays.map((array) => ({ present: true, value: array.map((value) => value.id) })) as [
        MergeValue,
        MergeValue,
        MergeValue,
      ]),
    );
  }
  return { base, left, right, units };
}
/** Every conflict needs a choice. Originals remain in the plan and their immutable snapshots are retained. */
export function resolveSnapshotMerge(
  plan: SnapshotMergePlan,
  choices: Readonly<Record<string, "base" | "left" | "right">>,
): EditorDocument {
  const fresh = planSnapshotMerge(plan.base, plan.left, plan.right),
    result = structuredClone(fresh.base);
  if (
    !choices ||
    typeof choices !== "object" ||
    Array.isArray(choices) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(choices))
  )
    fail("合并选择无效");
  for (const key of Reflect.ownKeys(choices)) {
    const descriptor = Object.getOwnPropertyDescriptor(choices, key)!;
    if (
      typeof key !== "string" ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      !["base", "left", "right"].includes(descriptor.value) ||
      !fresh.units.some((unit) => unit.key === key && unit.status === "conflict")
    )
      fail("合并选择包含不支持的冲突项");
  }
  const selected = new Map<string, MergeValue>();
  for (const unit of fresh.units) {
    const choice =
      unit.status === "conflict" ? choices[unit.key] : unit.status === "right" ? "right" : "left";
    if (!choice)
      throw new SnapshotSyncError("UNRESOLVED_CONFLICT", `请明确选择冲突项：${unit.label}`);
    selected.set(unit.key, unit[choice]);
  }
  for (const key of ["name", "activeSequenceId", "production"] as const) {
    const value = selected.get(key)!;
    if (value.present)
      (result as unknown as Record<string, unknown>)[key] = structuredClone(value.value);
    else delete (result as unknown as Record<string, unknown>)[key];
  }
  for (const collection of ["assets", "sequences", "exportProfiles"] as const) {
    const values = new Map<string, unknown>();
    for (const [key, value] of selected)
      if (key.startsWith(`${collection}/`) && key !== `${collection}/@order` && value.present)
        values.set(
          decodeURIComponent(key.slice(collection.length + 1)),
          structuredClone(value.value),
        );
    const order = selected.get(`${collection}/@order`)!.value as string[];
    // Chosen ordering controls shared items; independent additions are retained in deterministic ID order.
    (result as unknown as Record<string, unknown>)[collection] = [
      ...order.filter((id) => values.has(id)),
      ...[...values.keys()].filter((id) => !order.includes(id)).sort(),
    ].map((id) => values.get(id));
  }
  result.revision = Math.max(fresh.base.revision, fresh.left.revision, fresh.right.revision) + 1;
  return validateEditorDocument(result);
}

export function describeWorkingCopy(
  graph: SnapshotGraph,
  baseSnapshotId: string | null,
  dirty: boolean,
): {
  state: "unpublished" | "incomplete" | "current" | "behind" | "conflict";
  dirty: boolean;
  heads: string[];
  canFastForward: boolean;
} {
  const checked = analyzeSnapshotGraph(graph.snapshots);
  if (
    !graph.complete ||
    !checked.complete ||
    (baseSnapshotId !== null && !checked.snapshots.some((item) => item.id === baseSnapshotId))
  )
    return { state: "incomplete", dirty, heads: checked.heads, canFastForward: false };
  if (baseSnapshotId === null)
    return {
      state: checked.heads.length ? "conflict" : "unpublished",
      dirty,
      heads: checked.heads,
      canFastForward: false,
    };
  const current = checked.heads.length === 1 && checked.heads[0] === baseSnapshotId;
  const behind =
    checked.heads.length === 1 &&
    snapshotRelationship(checked, baseSnapshotId, checked.heads[0]!).kind === "behind";
  return {
    state: current ? "current" : behind ? "behind" : "conflict",
    dirty,
    heads: checked.heads,
    canFastForward: behind && !dirty,
  };
}
