import "./sync-ui.css";
import type { RuntimeBridge } from "../sdk/panel-runtime";
import { runtimeCancelled } from "../sdk/panel-runtime";
import type { EditorDocument } from "./types";
import type { EditorSession, SessionIdentity } from "./session";
import type { createEditorTaskBridge, EditorTaskArtifact } from "./task-bridge";
import {
  createEditorSyncBridge,
  type EditorSyncDirectory,
  type EditorSyncHistory,
} from "./sync-bridge";
import {
  createSnapshot,
  describeWorkingCopy,
  planSnapshotMerge,
  resolveSnapshotMerge,
  snapshotRelationship,
  snapshotCanonical,
  syncObject,
  syncHash,
  syncToken,
  SnapshotSyncError,
  type EditorSnapshot,
  type SnapshotMergePlan,
} from "./snapshot-sync";
import {
  createEditorSyncStorage,
  editorSyncContentHash,
  type EditorSyncState,
  type SyncApplyRecord,
  type SyncImportRecord,
} from "./sync-storage";

type Tasks = Pick<
  ReturnType<typeof createEditorTaskBridge>,
  "exportProjectBundle" | "importProjectBundle" | "discardProjectImport"
>;
type Sync = ReturnType<typeof createEditorSyncBridge>;
export interface EditorSyncUIOptions {
  panel: RuntimeBridge;
  tasks: Tasks;
  session(): EditorSession;
  replace(document: EditorDocument, identity: SessionIdentity): Promise<void>;
  assertEditable(): void;
  onError(error: unknown): void;
  container?: HTMLElement;
  /** Optional transport injection for tests or a compatible future provider. */ sync?: Sync;
}
export type EditorSyncRequest =
  | { action: "connect" | "refresh" | "publish" | "recover"; requestId: string }
  | { action: "preview" | "merge"; requestId: string; snapshotId: string }
  | { action: "apply"; requestId: string; reviewId: string }
  | {
      action: "choose";
      requestId: string;
      reviewId: string;
      conflictKey: string;
      choice: "base" | "left" | "right";
    }
  | { action: "keep-current"; requestId: string; expectedApplyId: string }
  | { action: "cancel"; operationId: string };
export interface EditorSyncOperation {
  id: string;
  requestId?: string;
  action: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  message: string;
  error?: { code: string; message: string };
}
function syncRequest(value: unknown): EditorSyncRequest {
  const descriptor =
    value && typeof value === "object"
      ? Object.getOwnPropertyDescriptor(value, "action")
      : undefined;
  if (!descriptor || !("value" in descriptor))
    throw new SnapshotSyncError("INVALID_SYNC_REQUEST", "同步动作无效");
  const action = descriptor.value;
  const keys =
    action === "cancel"
      ? ["action", "operationId"]
      : action === "keep-current"
        ? ["action", "requestId", "expectedApplyId"]
        : action === "preview" || action === "merge"
          ? ["action", "requestId", "snapshotId"]
          : action === "choose"
            ? ["action", "requestId", "reviewId", "conflictKey", "choice"]
            : action === "apply"
              ? ["action", "requestId", "reviewId"]
              : ["action", "requestId"];
  const data = syncObject(value, keys);
  if (action === "cancel") {
    if (!syncToken(data.operationId))
      throw new SnapshotSyncError("INVALID_SYNC_REQUEST", "取消必须指定本次操作 ID");
    return { action, operationId: data.operationId };
  }
  if (
    ![
      "connect",
      "refresh",
      "publish",
      "preview",
      "merge",
      "choose",
      "apply",
      "recover",
      "keep-current",
    ].includes(action) ||
    !syncToken(data.requestId)
  )
    throw new SnapshotSyncError("INVALID_SYNC_REQUEST", "同步动作需要有效 requestId UUID");
  if ((action === "preview" || action === "merge") && !syncHash(data.snapshotId))
    throw new SnapshotSyncError("INVALID_SYNC_REQUEST", "快照 ID 无效");
  if (
    action === "choose" &&
    (typeof data.conflictKey !== "string" ||
      !data.conflictKey ||
      data.conflictKey.length > 512 ||
      !["base", "left", "right"].includes(data.choice as string))
  )
    throw new SnapshotSyncError("INVALID_SYNC_REQUEST", "合并选择无效");
  if ((action === "choose" || action === "apply") && !syncToken(data.reviewId))
    throw new SnapshotSyncError("INVALID_SYNC_REQUEST", "选择或采用必须指定已审核的 reviewId");
  if (action === "keep-current" && !syncToken(data.expectedApplyId))
    throw new SnapshotSyncError("INVALID_SYNC_REQUEST", "保留当前工程必须绑定待采用记录 ID");
  return { ...data } as unknown as EditorSyncRequest;
}
interface Review {
  id: string;
  identity: SessionIdentity;
  session: EditorSession;
  beforeHash: string;
  kind: "version" | "merge";
  parents: string[];
  snapshotIds: string[];
  choices: Record<string, "base" | "left" | "right">;
  document?: EditorDocument;
  plan?: SnapshotMergePlan;
  applied: boolean;
}
const same = (a: SessionIdentity, b: SessionIdentity, revision = true) =>
  a.documentId === b.documentId &&
  a.generation === b.generation &&
  (!revision || a.revision === b.revision);
const label = (hash: string) => hash.slice(0, 10);
/** Explicit snapshot exchange. Directory transport never silently replaces the active editor document. */
export class EditorSyncUI {
  private readonly dialog = document.createElement("dialog");
  private readonly message = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly actions = document.createElement("div");
  private readonly body = document.createElement("section");
  private readonly sync: Sync;
  private store?: ReturnType<typeof createEditorSyncStorage>;
  private state?: EditorSyncState;
  private directory?: EditorSyncDirectory;
  private history?: EditorSyncHistory;
  private review?: Review;
  private session?: EditorSession;
  private identity?: SessionIdentity;
  private cwd?: string;
  private contentHash?: string;
  private hashedIdentity?: SessionIdentity;
  private draft?: { snapshot: EditorSnapshot; bundle: EditorTaskArtifact; contentHash: string };
  private documents = new Map<string, EditorDocument>();
  private records = new Map<string, SyncImportRecord>();
  private controller?: AbortController;
  private active?: Promise<void>;
  private disposed = false;
  private busy = false;
  private uninterruptible = false;
  private historyCount = 30;
  private mergeCount = 30;
  private operation?: EditorSyncOperation;
  private inspection?: { reviewId: string; key: string; side: string; json: string };
  private readonly requests = new Map<
    string,
    { fingerprint: string; operation: EditorSyncOperation }
  >();
  constructor(private readonly options: EditorSyncUIOptions) {
    this.sync = options.sync ?? createEditorSyncBridge(options.panel);
    this.dialog.className = "editor-sync-dialog";
    this.dialog.dataset.editorSync = "";
    this.dialog.setAttribute("aria-label", "工程同步");
    const heading = document.createElement("h2");
    heading.textContent = "工程同步";
    const note = document.createElement("p");
    note.className = "editor-sync-note";
    note.textContent =
      "使用开放的 .mimiproject 工程包。可选择网盘或共享文件夹；文件的跨设备传输由对应客户端完成。工程包保留字体名称但不包含系统字体，其他设备可能需要自行安装。";
    this.status.dataset.syncStatus = "";
    this.message.dataset.syncMessage = "";
    this.message.setAttribute("role", "status");
    this.actions.className = "editor-sync-actions";
    this.body.dataset.syncBody = "";
    this.dialog.append(heading, note, this.status, this.message, this.actions, this.body);
    (options.container ?? document.body).append(this.dialog);
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!this.uninterruptible) {
        this.controller?.abort();
        if (!this.busy) this.dialog.close();
      }
    });
  }
  open(): Promise<void> {
    if (!this.disposed && !this.dialog.open) this.dialog.showModal();
    return this.launch(async () => {
      this.options.assertEditable();
      await this.load();
      await this.refreshLocal();
      this.render();
    });
  }
  getState(options: { offset?: number; limit?: number } = {}) {
    syncObject(options, [
      ...(Object.hasOwn(options, "offset") ? ["offset"] : []),
      ...(Object.hasOwn(options, "limit") ? ["limit"] : []),
    ]);
    const offset = options.offset ?? 0,
      requestedLimit = options.limit ?? 30;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 50
    )
      throw new SnapshotSyncError(
        "INVALID_SYNC_REQUEST",
        "状态分页需要非负 offset 和 1–50 的 limit",
      );
    const encoder = new TextEncoder(),
      short = (value: string, maximum = 200) => {
        let text = "",
          size = 0;
        for (const character of value) {
          const next = encoder.encode(character).length;
          if (size + next > maximum) break;
          text += character;
          size += next;
        }
        return { text, truncated: text !== value };
      };
    const graph = this.history?.graph,
      review = this.review,
      conflicts = review?.plan?.units.filter((unit) => unit.status === "conflict") ?? [],
      message = short(this.message.textContent ?? ""),
      directory = short(this.directory?.name ?? ""),
      reviewName = short(review?.document?.name ?? "");
    const maximumTotal = Math.max(
      graph?.heads.length ?? 0,
      graph?.missingParents.length ?? 0,
      this.history?.issues.length ?? 0,
      this.history?.entries.length ?? 0,
      conflicts.length,
    );
    const build = (limit: number) => ({
      projectId: this.options.session().getState().identity.documentId,
      stateProjectId: this.state?.projectId ?? null,
      connected: !!this.directory,
      directoryName: this.directory ? directory.text : null,
      directoryNameTruncated: directory.truncated,
      busy: !!this.active,
      operation: this.operation
        ? {
            id: this.operation.id,
            requestId: this.operation.requestId,
            action: this.operation.action,
            status: this.operation.status,
            message: message.text,
            messageTruncated: message.truncated,
            ...(this.operation.error
              ? {
                  error: {
                    code: short(this.operation.error.code, 64).text,
                    message: short(this.operation.error.message).text,
                    messageTruncated: short(this.operation.error.message).truncated,
                  },
                }
              : {}),
          }
        : null,
      message: message.text,
      messageTruncated: message.truncated,
      pendingPublication: !!this.state?.pendingPublication,
      pendingApply: this.state?.pendingApply?.phase ?? null,
      pendingApplyId: this.state?.pendingApply?.id ?? null,
      canKeepCurrent: this.canKeepCurrent(),
      needsPublish: this.state?.base?.needsPublish ?? false,
      dirty: this.state
        ? !this.hashedIdentity ||
          !same(this.options.session().getState().identity, this.hashedIdentity) ||
          this.contentHash !== this.state.base?.contentHash
        : null,
      page: {
        offset,
        requestedLimit,
        limit,
        reduced: limit !== requestedLimit,
        nextOffset: offset + limit < maximumTotal ? offset + limit : null,
      },
      history: graph
        ? {
            complete: graph.complete,
            headCount: graph.heads.length,
            heads: graph.heads.slice(offset, offset + limit),
            missingParentCount: graph.missingParents.length,
            missingParents: graph.missingParents.slice(offset, offset + limit),
            issueCount: this.history!.issues.length,
            issues: this.history!.issues.slice(offset, offset + limit).map((issue) => ({
              snapshotId: issue.snapshotId,
              code: short(issue.code, 64).text,
            })),
            total: this.history!.entries.length,
            offset,
            limit,
            records: this.history!.entries.slice(offset, offset + limit).map((item) => {
              const note = short(item.snapshot.note);
              return {
                id: item.snapshot.id,
                parents: item.snapshot.parents.slice(0, 4),
                parentCount: item.snapshot.parents.length,
                parentsTruncated: item.snapshot.parents.length > 4,
                createdAt: item.snapshot.createdAt,
                note: note.text,
                noteTruncated: note.truncated,
                bundleState: item.bundleState,
              };
            }),
          }
        : null,
      review: review
        ? {
            reviewId: review.id,
            kind: review.kind,
            applied: review.applied,
            snapshotIds: review.snapshotIds,
            parents: review.parents.slice(0, 4),
            parentCount: review.parents.length,
            parentsTruncated: review.parents.length > 4,
            document: review.document
              ? {
                  id: review.document.id,
                  name: reviewName.text,
                  nameTruncated: reviewName.truncated,
                  sequenceCount: review.document.sequences.length,
                  assetCount: review.document.assets.length,
                }
              : null,
            conflictCount: conflicts.length,
            unresolvedCount: conflicts.filter((unit) => !review.choices[unit.key]).length,
            offset,
            limit,
            conflicts: conflicts.slice(offset, offset + limit).map((unit) => {
              const label = short(unit.label);
              return {
                key: unit.key,
                label: label.text,
                labelTruncated: label.truncated,
                choice: review.choices[unit.key] ?? null,
              };
            }),
            canApply:
              !this.active &&
              (review.applied ||
                (!!graph?.complete &&
                  this.cleanPublished() &&
                  !!(review.document || review.plan) &&
                  !conflicts.some((unit) => !review.choices[unit.key]))),
          }
        : null,
    });
    let limit = requestedLimit,
      result = build(limit);
    while (encoder.encode(JSON.stringify(result)).length > 44 * 1024 && limit > 1) {
      limit--;
      result = build(limit);
    }
    if (encoder.encode(JSON.stringify(result)).length > 44 * 1024)
      throw new SnapshotSyncError("SYNC_STATUS_LIMIT", "同步状态超过摘要大小限制");
    return structuredClone(result);
  }

  async inspectConflict(
    request: {
      expectedReviewId: string;
      conflictKey: string;
      side: "base" | "left" | "right";
      offset?: number;
      limit?: number;
    },
    identity: SessionIdentity,
  ) {
    const data = syncObject(request, [
      "expectedReviewId",
      "conflictKey",
      "side",
      ...(Object.hasOwn(request, "offset") ? ["offset"] : []),
      ...(Object.hasOwn(request, "limit") ? ["limit"] : []),
    ]);
    const checkedIdentity = syncObject(identity, ["documentId", "generation", "revision"]);
    if (
      typeof checkedIdentity.documentId !== "string" ||
      !Number.isSafeInteger(checkedIdentity.generation) ||
      !Number.isSafeInteger(checkedIdentity.revision) ||
      !syncToken(data.expectedReviewId) ||
      typeof data.conflictKey !== "string" ||
      !data.conflictKey ||
      data.conflictKey.length > 512 ||
      !["base", "left", "right"].includes(data.side as string)
    )
      throw new SnapshotSyncError("INVALID_SYNC_REQUEST", "冲突读取请求无效");
    const offset = data.offset ?? 0,
      limit = data.limit ?? 4096;
    if (
      !Number.isSafeInteger(offset) ||
      Number(offset) < 0 ||
      !Number.isSafeInteger(limit) ||
      Number(limit) < 2 ||
      Number(limit) > 4096
    )
      throw new SnapshotSyncError(
        "INVALID_SYNC_REQUEST",
        "JSON 分块 offset 必须非负，limit 为 2–4096 UTF-16 单位",
      );
    if (this.active)
      throw new SnapshotSyncError("SYNC_BUSY", "请等待当前同步操作结束后读取审核内容");
    const review = this.review;
    if (!review || review.applied || review.id !== data.expectedReviewId || !review.plan)
      throw new SnapshotSyncError("SYNC_REVIEW_CHANGED", "审核候选已变化或尚未准备好");
    if (!same(this.options.session().getState().identity, identity))
      throw new SnapshotSyncError("EDITOR_CHANGED", "工程身份已变化");
    await this.guard(true, review.identity);
    if (this.review !== review)
      throw new SnapshotSyncError("SYNC_REVIEW_CHANGED", "读取期间审核候选已变化");
    const unit = review.plan.units.find(
      (item) => item.key === data.conflictKey && item.status === "conflict",
    );
    if (!unit) throw new SnapshotSyncError("UNKNOWN_MERGE_CONFLICT", "该冲突不在当前审核方案中");
    const side = data.side as "base" | "left" | "right";
    if (
      this.inspection?.reviewId !== review.id ||
      this.inspection.key !== unit.key ||
      this.inspection.side !== side
    ) {
      const json = JSON.stringify(unit[side]);
      if (json.length > 32 * 1024 * 1024)
        throw new SnapshotSyncError(
          "SYNC_INSPECTION_LIMIT",
          "单个审核实体 JSON 超过 32 Mi UTF-16 单位读取上限",
        );
      this.inspection = { reviewId: review.id, key: unit.key, side, json };
    }
    const json = this.inspection.json,
      start = Number(offset);
    if (start > json.length)
      throw new SnapshotSyncError("INVALID_SYNC_OFFSET", "JSON 分块起点超出完整长度");
    const high = (code: number) => code >= 0xd800 && code <= 0xdbff,
      low = (code: number) => code >= 0xdc00 && code <= 0xdfff;
    if (start > 0 && low(json.charCodeAt(start)) && high(json.charCodeAt(start - 1)))
      throw new SnapshotSyncError(
        "INVALID_SYNC_OFFSET",
        "分块起点不能截开 Unicode 代理项，请使用上次 nextOffset",
      );
    let end = Math.min(json.length, start + Number(limit));
    if (end < json.length && high(json.charCodeAt(end - 1)) && low(json.charCodeAt(end))) end--;
    return {
      reviewId: review.id,
      conflictKey: unit.key,
      side,
      present: unit[side].present,
      encoding: "json-utf16" as const,
      offset: start,
      limit: Number(limit),
      length: json.length,
      text: json.slice(start, end),
      nextOffset: end < json.length ? end : null,
    };
  }
  execute(
    value: EditorSyncRequest,
    identity: SessionIdentity,
  ): { accepted: true; operationId: string; operation: EditorSyncOperation } {
    if (this.disposed) throw runtimeCancelled();
    const request = syncRequest(value),
      frozenIdentity = syncObject(identity, ["documentId", "generation", "revision"]);
    if (
      typeof frozenIdentity.documentId !== "string" ||
      !Number.isSafeInteger(frozenIdentity.generation) ||
      Number(frozenIdentity.generation) < 0 ||
      !Number.isSafeInteger(frozenIdentity.revision) ||
      Number(frozenIdentity.revision) < 0 ||
      !same(this.options.session().getState().identity, identity)
    )
      throw new SnapshotSyncError("EDITOR_CHANGED", "同步请求的工程身份已经变化");
    if (request.action === "cancel") {
      if (!this.active || !this.operation || this.operation.id !== request.operationId)
        throw new SnapshotSyncError("SYNC_OPERATION_MISMATCH", "指定操作不是当前活跃同步操作");
      if (this.uninterruptible)
        throw new SnapshotSyncError("SYNC_COMMITTING", "正在提交工程替换，请等待完成后再操作");
      this.controller?.abort();
      return {
        accepted: true,
        operationId: this.operation.id,
        operation: structuredClone(this.operation),
      };
    }
    const fingerprint = snapshotCanonical(request),
      prior = this.requests.get(request.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new SnapshotSyncError("SYNC_REQUEST_REUSED", "requestId 已用于另一个同步请求");
      return {
        accepted: true,
        operationId: prior.operation.id,
        operation: structuredClone(prior.operation),
      };
    }
    if (this.active)
      throw new SnapshotSyncError("SYNC_BUSY", "已有同步操作正在进行，请查询当前 operationId");
    if (this.requests.size >= 1024)
      throw new SnapshotSyncError(
        "SYNC_REQUEST_LIMIT",
        "当前面板已保留 1024 个结构化同步回执，请完成本次工作后重新打开面板",
      );
    const operation: EditorSyncOperation = {
      id: crypto.randomUUID(),
      requestId: request.requestId,
      action: request.action,
      status: "running",
      message: "同步操作已接受",
    };
    this.requests.set(request.requestId, { fingerprint, operation });
    const expected = structuredClone(identity);
    void this.launch(async () => {
      await this.load();
      if (!same(this.options.session().getState().identity, expected))
        throw new SnapshotSyncError("EDITOR_CHANGED", "载入同步记录期间工程已变化，未执行请求");
      await this.guard(true, expected);
      await this.refreshLocal();
      await this.guard(true, expected);
      if (
        (request.action === "choose" || request.action === "apply") &&
        this.review?.id !== request.reviewId
      )
        throw new SnapshotSyncError(
          "SYNC_REVIEW_CHANGED",
          "审核候选已变化，请重新读取后再选择或采用",
        );
      if (request.action === "connect") {
        const selected = await this.sync.pickDirectory(this.controller?.signal);
        if (selected) {
          this.directory = selected;
          await this.refresh();
        }
      } else if (request.action === "refresh") await this.refresh();
      else if (request.action === "publish") await this.publish();
      else if (request.action === "preview") await this.preview(request.snapshotId);
      else if (request.action === "merge") await this.merge(request.snapshotId);
      else if (request.action === "choose") {
        const review = this.review,
          unit = review?.plan?.units.find(
            (unit) => unit.key === request.conflictKey && unit.status === "conflict",
          );
        if (!review || !unit || review.applied)
          throw new SnapshotSyncError("UNKNOWN_MERGE_CONFLICT", "该冲突不在当前审核方案中");
        await this.guard(true, review.identity);
        review.choices[request.conflictKey] = request.choice;
      } else if (request.action === "apply") {
        if (!this.review)
          throw new SnapshotSyncError("NO_SYNC_REVIEW", "请先预览并审核要采用的版本");
        await this.apply();
      } else if (request.action === "keep-current") await this.keepCurrent(request.expectedApplyId);
      else await this.recover();
    }, operation);
    return { accepted: true, operationId: operation.id, operation: structuredClone(operation) };
  }
  private async load() {
    const session = this.options.session(),
      identity = session.getState().identity,
      cwd = String((await this.options.panel.getContext()).cwd ?? "");
    if (
      this.session === session &&
      this.identity &&
      same(this.identity, identity, false) &&
      this.state?.projectId === identity.documentId &&
      this.cwd === cwd
    )
      return;
    if (this.cwd !== undefined && this.cwd !== cwd) this.directory = undefined;
    this.store?.dispose();
    this.store = createEditorSyncStorage(this.options.panel, identity.documentId);
    const state = await this.store.read();
    if (this.disposed) throw runtimeCancelled();
    this.state = state;
    this.session = session;
    this.identity = structuredClone(identity);
    this.cwd = cwd;
    this.history = undefined;
    this.review = undefined;
    this.inspection = undefined;
    this.draft = undefined;
    this.documents.clear();
    this.records = new Map(state.imports.map((item) => [item.snapshot.id, structuredClone(item)]));
    if (state.pendingApply)
      this.message.textContent =
        state.pendingApply.phase === "committed"
          ? "工程已切换，仍有收尾记录需要确认。"
          : "有上次采用版本的恢复记录，请先检查结果。";
  }
  private async guard(revision = false, identity = this.identity) {
    if (this.disposed || this.controller?.signal.aborted) throw runtimeCancelled();
    this.options.assertEditable();
    if (
      this.options.session() !== this.session ||
      !identity ||
      !same(this.options.session().getState().identity, identity, revision)
    )
      throw new SnapshotSyncError("EDITOR_CHANGED", "当前工程已切换或修改，请重新打开同步面板核对");
    if (String((await this.options.panel.getContext()).cwd ?? "") !== this.cwd)
      throw new SnapshotSyncError("WORKSPACE_CHANGED", "工作区已切换，本次同步已停止");
    if (this.disposed || this.controller?.signal.aborted) throw runtimeCancelled();
    if (
      this.options.session() !== this.session ||
      !identity ||
      !same(this.options.session().getState().identity, identity, revision)
    )
      throw new SnapshotSyncError("EDITOR_CHANGED", "等待授权信息期间工程已变化，操作已停止");
  }
  private async refreshLocal() {
    if (this.session) {
      const identity = structuredClone(this.session.getState().identity),
        document = this.session.read();
      this.contentHash = await editorSyncContentHash(document);
      this.hashedIdentity = identity;
    }
  }
  private async save(change: (state: EditorSyncState) => void) {
    if (!this.store || !this.state) throw new Error("同步状态尚未载入");
    const state = structuredClone(this.state);
    change(state);
    const saved = await this.store.write(state);
    this.state = saved;
  }
  private launch(action: () => Promise<void>, supplied?: EditorSyncOperation): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.active) return this.active;
    const operation: EditorSyncOperation = supplied ?? {
      id: crypto.randomUUID(),
      action: "interface",
      status: "running" as const,
      message: "同步操作已接受",
    };
    this.operation = operation;
    this.busy = true;
    this.controller = new AbortController();
    const pending = Promise.resolve()
      .then(async () => {
        if (this.disposed || this.controller?.signal.aborted) throw runtimeCancelled();
        this.render();
        await action();
      })
      .catch((error) => {
        operation.status = (error as Error)?.name === "AbortError" ? "cancelled" : "failed";
        operation.error = {
          code: typeof (error as any)?.code === "string" ? (error as any).code : "SYNC_FAILED",
          message: error instanceof Error ? error.message.slice(0, 2000) : "同步未完成",
        };
        if (this.disposed) return;
        this.message.textContent =
          (error as Error)?.name === "AbortError"
            ? "操作已取消；已完成的不可变快照和恢复记录仍然保留。"
            : `${this.review?.applied || this.state?.pendingApply?.phase === "committed" ? "工程已切换，收尾未完成" : "操作未完成"}：${error instanceof Error ? error.message : String(error)}`;
        if ((error as Error)?.name !== "AbortError") this.options.onError(error);
      })
      .finally(() => {
        if (this.active === pending) this.active = undefined;
        if (operation.status === "running") operation.status = "succeeded";
        operation.message = this.message.textContent?.slice(0, 2000) ?? "";
        this.busy = false;
        this.uninterruptible = false;
        this.controller = undefined;
        if (!this.disposed) this.render();
      });
    this.active = pending;
    return pending;
  }
  private button(
    text: string,
    key: string,
    action: () => Promise<void>,
    parent: HTMLElement = this.actions,
    disabled = false,
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.dataset[key] = "";
    button.disabled = this.busy || disabled;
    button.addEventListener("click", () => void this.launch(action));
    parent.append(button);
    return button;
  }
  private render() {
    if (this.disposed) return;
    this.actions.replaceChildren();
    this.body.replaceChildren();
    const state = this.state;
    this.status.textContent = this.directory
      ? `已连接：${this.directory.name}`
      : "尚未连接同步文件夹。目录授权只在当前面板有效。";
    this.button(this.directory ? "重新选择文件夹" : "连接同步文件夹", "syncConnect", async () => {
      await this.guard();
      const selected = await this.sync.pickDirectory(this.controller?.signal);
      if (selected) {
        this.directory = selected;
        await this.refresh();
      }
    });
    this.button("刷新版本", "syncRefresh", () => this.refresh(), this.actions, !this.directory);
    this.button(
      state?.pendingPublication || this.draft ? "继续发布冻结版本" : "发布当前工程",
      "syncPublish",
      () => this.publish(),
      this.actions,
      !this.directory || !!state?.pendingApply,
    );
    if (this.busy) {
      const cancel = document.createElement("button");
      cancel.textContent = "取消此次操作";
      cancel.dataset.syncCancel = "";
      cancel.disabled = this.uninterruptible;
      cancel.onclick = () => this.controller?.abort();
      this.actions.append(cancel);
    } else {
      const close = document.createElement("button");
      close.textContent = "关闭";
      close.dataset.syncClose = "";
      close.onclick = () => this.dialog.close();
      this.actions.append(close);
    }
    if (!state) return;
    if (state.pendingApply)
      this.button("检查上次采用结果 / 继续收尾", "syncRecover", () => this.recover(), this.body);
    if (state.pendingApply && this.canKeepCurrent())
      this.button(
        "保留当前工程，结束上次采用记录",
        "syncKeepCurrent",
        () => this.keepCurrent(state.pendingApply!.id),
        this.body,
      );
    if (state.imports.length && !this.review)
      this.button(
        "清理已准备的临时素材",
        "syncCleanup",
        () => this.cleanupImports(),
        this.body,
        !!state.pendingApply,
      );
    if (state.pendingPublication)
      this.button(
        "放弃本次待发布记录",
        "syncDiscardPublication",
        async () => {
          await this.guard();
          if (!this.directory) throw new Error("请重新连接原同步目录");
          await this.sync.discardPublication(this.directory, state.pendingPublication!.receipt, {
            signal: this.controller?.signal,
          });
          await this.save((value) => {
            value.pendingPublication = null;
          });
          this.draft = undefined;
          this.message.textContent = "待发布的暂存记录已清理。已经发布的完整快照仍然保留。";
        },
        this.body,
      );
    if (this.history) {
      const paragraph = document.createElement("p"),
        dirty = this.contentHash !== state.base?.contentHash;
      const working = describeWorkingCopy(
        this.history.graph,
        state.base?.parents.length === 1 ? state.base.parents[0]! : null,
        dirty,
      );
      paragraph.className = this.history.graph.complete ? "" : "editor-sync-warning";
      paragraph.textContent = !this.history.graph.complete
        ? "文件尚未传播完整或记录损坏，暂时不能判断版本关系。"
        : this.history.graph.heads.length > 1
          ? `发现 ${this.history.graph.heads.length} 个分支，需要明确选择或合并。`
          : state.base?.needsPublish
            ? "本机已采用审核结果，仍需发布一个新快照。"
            : working.state === "behind"
              ? "其他设备有新版本，请预览后再采用。"
              : dirty
                ? "本机有尚未发布的修改。"
                : "本机内容与上次采用或发布的版本一致。";
      this.body.append(paragraph);
      if (this.history.graph.missingParents.length) {
        const missing = document.createElement("p");
        missing.textContent = `缺少 ${this.history.graph.missingParents.length} 个父快照，等待同步客户端补齐。`;
        this.body.append(missing);
      }
      if (this.history.issues.length) {
        const issues = document.createElement("p");
        issues.textContent = `${this.history.issues.length} 条快照记录无法校验；原文件保留。`;
        this.body.append(issues);
      }
    }
    if (this.review) {
      this.renderReview(this.review);
      return;
    }
    if (this.history) {
      const heads = new Set(this.history.graph.heads),
        entries = [...this.history.entries].sort(
          (a, b) =>
            Number(heads.has(b.snapshot.id)) - Number(heads.has(a.snapshot.id)) ||
            b.snapshot.createdAt.localeCompare(a.snapshot.createdAt) ||
            a.snapshot.id.localeCompare(b.snapshot.id),
        );
      const title = document.createElement("h3");
      title.textContent = `版本历史（${entries.length} 条）`;
      this.body.append(title);
      for (const entry of entries.slice(0, this.historyCount)) {
        const card = document.createElement("article");
        card.className = "editor-sync-card";
        card.dataset.head = String(heads.has(entry.snapshot.id));
        card.dataset.syncSnapshot = entry.snapshot.id;
        const description = document.createElement("p");
        description.textContent = `${heads.has(entry.snapshot.id) ? "分支 · " : ""}${label(entry.snapshot.id)} · ${entry.snapshot.createdAt}\n${entry.snapshot.note || "工程快照"}\n${entry.bundleState === "present-unverified" ? "工程包已到达，打开时会完整校验" : entry.bundleState === "missing" ? "工程包还没有传到此设备" : entry.bundleState === "size-mismatch" ? "工程包尚未传完或大小不符" : "工程包不是安全的普通文件"}`;
        card.append(description);
        const actions = document.createElement("div");
        actions.className = "editor-sync-actions";
        this.button(
          "预览此版本",
          "syncPreview",
          () => this.preview(entry.snapshot.id),
          actions,
          !!state.pendingApply,
        );
        this.button(
          "与本机版本合并",
          "syncMerge",
          () => this.merge(entry.snapshot.id),
          actions,
          !this.canMerge(entry.snapshot.id),
        );
        card.append(actions);
        this.body.append(card);
      }
      if (entries.length > this.historyCount)
        this.button(
          `继续显示（还剩 ${entries.length - this.historyCount} 条）`,
          "syncMore",
          async () => {
            this.historyCount += 30;
          },
          this.body,
        );
    }
  }
  private cleanPublished() {
    return (
      !!this.state?.base &&
      !!this.hashedIdentity &&
      same(this.options.session().getState().identity, this.hashedIdentity) &&
      !this.state.base.needsPublish &&
      this.contentHash === this.state.base.contentHash
    );
  }
  private canMerge(id: string) {
    return (
      !!this.history?.graph.complete &&
      this.cleanPublished() &&
      this.state!.base!.parents.length === 1 &&
      this.state!.base!.parents[0] !== id &&
      !this.state?.pendingApply
    );
  }
  private async refresh() {
    await this.guard();
    if (!this.directory) throw new Error("请连接同步文件夹");
    this.history = await this.sync.history(this.directory, this.state!.projectId, {
      signal: this.controller?.signal,
    });
    await this.guard();
    await this.refreshLocal();
    this.message.textContent = this.history.graph.complete
      ? "已读取目录中的版本记录；文件实际传输仍由网盘或共享盘客户端负责。"
      : "发现尚未到达的父快照或损坏记录，请等待同步客户端补齐后刷新。";
  }
  private async publish() {
    await this.guard();
    if (!this.directory) throw new Error("请连接同步文件夹");
    if (this.state!.pendingApply) throw new Error("请先完成上次采用版本的收尾");
    const prior = this.state!.pendingPublication;
    if (!prior && !this.draft) {
      await this.refreshLocal();
      if (this.cleanPublished()) {
        this.message.textContent = "当前内容已经发布，无需重复创建快照。";
        return;
      }
      const document = this.session!.read(),
        identity = structuredClone(this.session!.getState().identity),
        contentHash = await editorSyncContentHash(document);
      await this.session!.flush();
      await this.guard(false, identity);
      this.message.textContent = "正在打包完整工程和原始素材…";
      const result = await this.options.tasks.exportProjectBundle(document, {
        signal: this.controller?.signal,
      });
      await this.guard(false, identity);
      const snapshot = await createSnapshot({
        projectId: document.id,
        bundle: { sha256: result.bundle.sha256, bytes: result.bundle.bytes },
        parents: this.state!.base?.parents ?? [],
        deviceId: this.state!.deviceId,
        createdAt: new Date().toISOString(),
        note: `${document.name} · ${this.state!.base?.needsPublish ? "审核后合并" : "本机编辑"}`.slice(
          0,
          240,
        ),
      });
      this.draft = { snapshot, bundle: result.bundle, contentHash };
    }
    const prepared = prior
      ? {
          snapshot: prior.receipt.snapshot,
          bundle: prior.receipt.bundle,
          contentHash: prior.contentHash,
        }
      : this.draft!;
    this.message.textContent = "正在校验并发布冻结的完整工程包…";
    await this.sync.publish(
      this.directory,
      {
        snapshot: prepared.snapshot,
        bundle: prepared.bundle,
        ...(prior ? { receipt: prior.receipt } : {}),
      },
      {
        signal: this.controller?.signal,
        onReceipt: async (receipt) => {
          await this.guard();
          await this.save((value) => {
            value.pendingPublication = { receipt, contentHash: prepared.contentHash };
          });
        },
      },
    );
    // Publishing is already committed to the shared directory. Retain the receipt until local CAS succeeds.
    await this.save((value) => {
      value.base = {
        parents: [prepared.snapshot.id],
        contentHash: prepared.contentHash,
        needsPublish: false,
      };
      value.pendingPublication = null;
    });
    this.draft = undefined;
    await this.refresh();
    this.message.textContent = "完整快照已发布。其他设备何时收到文件由所选目录的同步客户端决定。";
  }
  private async importSnapshot(snapshotId: string): Promise<EditorDocument> {
    const cached = this.documents.get(snapshotId);
    if (cached) return structuredClone(cached);
    await this.guard();
    let record =
      this.records.get(snapshotId) ??
      this.state!.imports.find((item) => item.snapshot.id === snapshotId);
    if (!record) {
      if (!this.directory) throw new Error("请连接同步文件夹");
      if (this.state!.imports.length >= 16) throw new Error("已有 16 个准备记录，请先清理临时素材");
      this.message.textContent = "正在校验完整工程包和所有原始素材…";
      const captured = await this.sync.readSnapshot(
        this.directory,
        this.state!.projectId,
        snapshotId,
        { signal: this.controller?.signal },
      );
      await this.guard();
      record = {
        snapshot: captured.snapshot,
        bundle: captured.bundle,
        transferId: `editor-${crypto.randomUUID()}`,
        receipt: null,
      };
      this.records.set(snapshotId, record);
      await this.save((state) => {
        state.imports.push(structuredClone(record!));
      });
    }
    const frozen = record;
    const result = await this.options.tasks.importProjectBundle(frozen.bundle.id, {
      signal: this.controller?.signal,
      transferId: frozen.transferId,
      ...(frozen.receipt ? { receipt: frozen.receipt } : {}),
      onImportReceipt: async (receipt) => {
        frozen.receipt = receipt;
        this.records.set(snapshotId, frozen);
        await this.guard();
        await this.save((state) => {
          const index = state.imports.findIndex((item) => item.snapshot.id === snapshotId);
          if (index < 0) state.imports.push(structuredClone(frozen));
          else state.imports[index] = structuredClone(frozen);
        });
      },
    });
    await this.guard();
    this.documents.set(snapshotId, result.document);
    return structuredClone(result.document);
  }
  private async startReview(
    kind: Review["kind"],
    ids: string[],
    parents: string[],
  ): Promise<Review> {
    await this.guard();
    await this.refreshLocal();
    const review: Review = {
      id: crypto.randomUUID(),
      identity: structuredClone(this.session!.getState().identity),
      session: this.session!,
      beforeHash: this.contentHash!,
      kind,
      parents: [...new Set(parents)].sort(),
      snapshotIds: ids,
      choices: {},
      applied: false,
    };
    this.review = review;
    this.inspection = undefined;
    this.mergeCount = 30;
    return review;
  }
  private async preview(id: string) {
    const parents = [...(this.state?.base?.parents ?? []), id];
    const review = await this.startReview("version", [id], parents);
    review.document = await this.importSnapshot(id);
    await this.guard(true, review.identity);
    this.message.textContent = "请审核该版本。采用前必须先发布本机修改，双方完整快照都会保留。";
  }
  private async merge(id: string) {
    await this.refreshLocal();
    if (!this.canMerge(id)) throw new Error("请先发布当前本机内容，并等待父链完整后再合并");
    const left = this.state!.base!.parents[0]!,
      relationship = snapshotRelationship(this.history!.graph, left, id);
    if (relationship.commonAncestors.length !== 1)
      throw new Error(
        relationship.commonAncestors.length
          ? "存在多个最近共同起点，请分别预览后明确选择整版；本次未自动选择合并起点。"
          : "找不到共同起点，可预览后明确采用完整版本；本次未推断合并关系。",
      );
    const base = relationship.commonAncestors[0]!,
      review = await this.startReview("merge", [base, left, id], [left, id]);
    const baseDocument = await this.importSnapshot(base),
      leftDocument = await this.importSnapshot(left),
      rightDocument = await this.importSnapshot(id);
    await this.guard(true, review.identity);
    review.plan = planSnapshotMerge(baseDocument, leftDocument, rightDocument);
    this.message.textContent =
      "不同实体的独立改动会组合；同一完整序列同时修改时必须明确选一方。每份原始快照都会保留。";
  }
  private renderReview(review: Review) {
    const title = document.createElement("h3");
    title.textContent = review.applied
      ? "工程已采用，等待完成收尾"
      : review.kind === "merge"
        ? "审核三方合并"
        : "审核完整版本";
    this.body.append(title);
    if (review.document) {
      const summary = document.createElement("p");
      summary.textContent = `${review.document.name}\n${review.document.sequences.length} 个序列 · ${review.document.assets.length} 个素材\n${review.document.sequences.map((sequence) => sequence.name).join("、")}`;
      summary.dataset.syncReview = "";
      this.body.append(summary);
    }
    if (review.plan) {
      const changed = review.plan.units.filter((unit) => unit.status !== "unchanged"),
        conflicts = changed.filter((unit) => unit.status === "conflict"),
        summary = document.createElement("p");
      summary.textContent = `${changed.length} 项变化，其中 ${conflicts.length} 项必须选择。序列按完整实体审核。`;
      this.body.append(summary);
      for (const unit of changed.slice(0, this.mergeCount)) {
        const row = document.createElement("section");
        row.className = "editor-sync-conflict";
        const label = document.createElement("strong");
        label.textContent = unit.label;
        row.append(label);
        if (unit.status === "conflict") {
          const select = document.createElement("select");
          select.dataset.syncConflict = unit.key;
          select.setAttribute("aria-label", `${unit.label} 的取舍`);
          for (const [value, text] of [
            ["", "请选择"],
            ["left", "保留本机版本"],
            ["right", "保留另一版本"],
            ["base", "保留共同起点"],
          ]) {
            const option = document.createElement("option");
            option.value = value!;
            option.textContent = text!;
            select.append(option);
          }
          select.value = review.choices[unit.key] ?? "";
          select.disabled = this.busy;
          select.onchange = () => {
            if (select.value) review.choices[unit.key] = select.value as "left" | "right" | "base";
            else delete review.choices[unit.key];
            this.render();
          };
          row.append(select);
        } else {
          const info = document.createElement("span");
          info.textContent =
            unit.status === "left"
              ? "采用本机改动"
              : unit.status === "right"
                ? "采用另一版本改动"
                : "双方一致";
          row.append(info);
        }
        const details = document.createElement("details"),
          caption = document.createElement("summary"),
          content = document.createElement("pre");
        caption.textContent = "查看三份完整记录";
        details.addEventListener("toggle", () => {
          if (details.open && !content.textContent)
            content.textContent = JSON.stringify(
              { 共同起点: unit.base, 本机: unit.left, 另一版本: unit.right },
              null,
              2,
            );
        });
        details.append(caption, content);
        row.append(details);
        this.body.append(row);
      }
      if (changed.length > this.mergeCount)
        this.button(
          `继续审核（还剩 ${changed.length - this.mergeCount} 项）`,
          "syncMoreMerge",
          async () => {
            this.mergeCount += 30;
          },
          this.body,
        );
    }
    const unresolved =
      review.plan?.units.some((unit) => unit.status === "conflict" && !review.choices[unit.key]) ??
      false;
    if (!this.cleanPublished() && !review.applied) {
      const warning = document.createElement("p");
      warning.className = "editor-sync-warning";
      warning.textContent = "本机内容尚未完整发布。请先返回并发布本机版本，再审核采用。";
      this.body.append(warning);
    }
    this.button(
      review.applied ? "重试收尾" : "采用审核结果",
      "syncApply",
      () => this.apply(review),
      this.body,
      !review.applied &&
        (!this.history?.graph.complete ||
          !this.cleanPublished() ||
          unresolved ||
          (!review.document && !review.plan)),
    );
    this.button(
      "返回版本列表",
      "syncBack",
      async () => {
        this.review = undefined;
        await this.refreshLocal();
      },
      this.body,
      review.applied || !!this.state?.pendingApply,
    );
  }
  private async apply(expectedReview: Review | undefined = this.review) {
    const review = this.review;
    if (!review || review !== expectedReview)
      throw new SnapshotSyncError("SYNC_REVIEW_CHANGED", "审核候选已变化，请重新确认");
    if (review.applied) {
      await this.finishApplied();
      return;
    }
    await this.guard(true, review.identity);
    await this.refreshLocal();
    if (!this.history?.graph.complete)
      throw new Error("父快照还没有完整到达，请先连接并刷新目录再采用");
    if (!this.cleanPublished() || this.contentHash !== review.beforeHash)
      throw new Error("本机内容发生变化，请先发布并重新审核");
    const candidate = review.plan
      ? resolveSnapshotMerge(review.plan, review.choices)
      : review.document!;
    await this.session!.flush();
    await this.guard(true, review.identity);
    const candidateHash = await editorSyncContentHash(candidate),
      record: SyncApplyRecord = {
        id: this.state?.pendingApply?.id ?? crypto.randomUUID(),
        candidateHash,
        beforeHash: review.beforeHash,
        beforeStorageRevision: this.session!.getState().storageRevision,
        parents: review.parents,
        kind: review.kind,
        snapshotIds: review.snapshotIds,
        choices: review.choices,
        phase: "prepared",
      };
    await this.save((state) => {
      state.pendingApply = record;
    });
    await this.guard(true, review.identity);
    this.uninterruptible = true;
    this.render();
    try {
      await this.options.replace(candidate, review.identity);
      review.applied = true;
    } catch (error) {
      if (
        !same(this.session!.getState().identity, review.identity, false) &&
        (await editorSyncContentHash(this.session!.read())) === candidateHash
      )
        review.applied = true;
      throw error;
    }
    this.identity = structuredClone(this.session!.getState().identity);
    this.documents.clear();
    await this.finishApplied();
  }
  private async finishApplied() {
    const record = this.state?.pendingApply;
    if (!record) throw new Error("找不到采用版本的恢复记录");
    await this.save((state) => {
      state.pendingApply!.phase = "committed";
      state.base = {
        parents: record.parents,
        contentHash: record.candidateHash,
        needsPublish: record.parents.length > 1 || record.kind === "merge",
      };
    });
    await this.cleanupImports();
    await this.save((state) => {
      state.pendingApply = null;
    });
    this.review = undefined;
    this.identity = structuredClone(this.session!.getState().identity);
    await this.refreshLocal();
    this.message.textContent = "工程已经采用，原版本均已保留。需要合并分支时，请发布当前审核结果。";
  }
  private async recover() {
    await this.guard();
    const record = this.state?.pendingApply;
    if (!record) return;
    const current = await editorSyncContentHash(this.session!.read()),
      storageRevision = this.session!.getState().storageRevision;
    if (record.phase === "committed" || current === record.candidateHash) {
      this.identity = structuredClone(this.session!.getState().identity);
      if (this.review) this.review.applied = true;
      await this.finishApplied();
      return;
    }
    if (current !== record.beforeHash || storageRevision !== record.beforeStorageRevision)
      throw new Error("上次采用期间工程存储已变化，不能重复替换；请保留当前内容并核对历史版本");
    const review = await this.startReview(record.kind, record.snapshotIds, record.parents);
    review.choices = record.choices;
    if (record.kind === "version")
      review.document = await this.importSnapshot(record.snapshotIds[0]!);
    else {
      const documents = [];
      for (const id of record.snapshotIds) documents.push(await this.importSnapshot(id));
      review.plan = planSnapshotMerge(documents[0], documents[1], documents[2]);
    }
    const candidate = review.plan
      ? resolveSnapshotMerge(review.plan, review.choices)
      : review.document!;
    if ((await editorSyncContentHash(candidate)) !== record.candidateHash)
      throw new Error("恢复候选与上次审核内容不一致，未替换当前工程");
    this.message.textContent = "上次替换尚未写入；已恢复审核内容，可重试采用。";
  }
  private canKeepCurrent() {
    const record = this.state?.pendingApply;
    if (
      !record ||
      record.phase === "committed" ||
      !this.session ||
      !this.hashedIdentity ||
      !same(this.session.getState().identity, this.hashedIdentity) ||
      this.contentHash === record.candidateHash
    )
      return false;
    return (
      this.contentHash !== record.beforeHash ||
      this.session.getState().storageRevision !== record.beforeStorageRevision
    );
  }
  private async keepCurrent(expectedApplyId: string) {
    await this.guard();
    await this.refreshLocal();
    const record = this.state?.pendingApply;
    if (!record || record.id !== expectedApplyId)
      throw new SnapshotSyncError("SYNC_APPLY_CHANGED", "待采用记录已变化，未清理其他操作的记录");
    if (record.phase === "committed" || this.contentHash === record.candidateHash) {
      await this.recover();
      return;
    }
    if (!this.canKeepCurrent())
      throw new SnapshotSyncError(
        "SYNC_APPLY_RECOVERABLE",
        "上次审核仍可准确恢复，请先使用检查上次采用结果",
      );
    await this.save((state) => {
      if (state.pendingApply?.id !== expectedApplyId)
        throw new SnapshotSyncError("SYNC_APPLY_CHANGED", "待采用记录已变化");
      state.pendingApply = null;
      if (state.base) state.base.needsPublish = true;
    });
    this.review = undefined;
    this.inspection = undefined;
    this.identity = structuredClone(this.session!.getState().identity);
    this.message.textContent =
      "已保留当前工程并结束上次采用记录。完整快照和已准备素材仍然保留，当前内容需要重新发布。";
  }
  private async cleanupImports() {
    for (const stored of [...(this.state?.imports ?? [])]) {
      const record = this.records.get(stored.snapshot.id) ?? stored;
      if (record.receipt)
        await this.options.tasks.discardProjectImport(record.receipt, {
          signal: this.controller?.signal,
        });
      await this.save((state) => {
        state.imports = state.imports.filter((item) => item.snapshot.id !== stored.snapshot.id);
      });
      this.records.delete(stored.snapshot.id);
      this.documents.delete(stored.snapshot.id);
    }
    if (!this.state?.pendingApply)
      this.message.textContent = "临时解包缓存已清理；完整快照和已发布素材仍然保留。";
  }
  dispose() {
    this.disposed = true;
    this.controller?.abort();
    this.sync.dispose();
    this.store?.dispose();
    this.inspection = undefined;
    this.dialog.remove();
  }
}
