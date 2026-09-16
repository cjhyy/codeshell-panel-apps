import { EditorHistory, type EditReceipt } from "./history";
import { migrateLegacyProject } from "./migration";
import type { EditorOperation } from "./operations";
import type { EditorDocument } from "./types";
import { validateEditorDocument } from "./validation";

/** The adapter owns resource authorization, storage capacity and real compare-and-swap persistence. */
export interface EditorSessionStorage {
  read(): Promise<{ data: unknown | null; revision: number }>;
  write(
    document: EditorDocument,
    baseStorageRevision: number,
    label: string,
  ): Promise<{ revision: number }>;
  backupLegacy(rawV1: unknown): Promise<void>;
}
export interface SessionIdentity {
  documentId: string;
  /** Changes on every open or successful replacement, including same-document version restores. */
  generation: number;
  revision: number;
}
export interface EditorSessionOptions {
  /** Used only after a successful read of an explicitly empty slot. */
  initialDocument?: EditorDocument;
  autosaveDelayMs?: number;
  historyLimit?: number;
}
export interface SessionError {
  kind: "write" | "backup" | "conflict";
  stage: "save" | "replace" | "commit";
  message: string;
}
export interface EditorSessionState {
  identity: SessionIdentity;
  storageRevision: number;
  phase: "ready" | "committing" | "replacing" | "closing" | "closed";
  saveState: "saved" | "pending" | "saving" | "failed" | "conflict";
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  legacyBackupPending: boolean;
  error: SessionError | null;
}
export interface ReplaceDocumentOptions {
  label?: string;
  identity?: SessionIdentity;
  /** Cancellation is honored before the new write starts. A successful committed write always activates its document. */
  signal?: AbortSignal;
}
export class EditorStorageConflictError extends Error {
  readonly code = "STORAGE_CONFLICT";
  constructor(
    message = "工程存储已被其他操作更新，请保留当前修改并解决版本冲突",
    readonly actualRevision?: number,
  ) {
    super(message);
    this.name = "EditorStorageConflictError";
  }
}
interface SaveRequest {
  sequence: number;
  document: EditorDocument;
  label: string;
}
let generationCounter = 0;
function generation(): number {
  if (generationCounter >= Number.MAX_SAFE_INTEGER)
    throw new Error("编辑会话编号已耗尽，请重新启动");
  return ++generationCounter;
}
function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("存储返回了无效版本，已阻止覆盖");
  return value;
}
function label(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new Error("编辑说明须为 1 至 200 个字符");
  return value;
}
function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("工程切换已取消");
    error.name = "AbortError";
    throw error;
  }
}
function isConflict(error: unknown): boolean {
  return (
    error instanceof EditorStorageConflictError ||
    (error !== null &&
      typeof error === "object" &&
      Object.getOwnPropertyDescriptor(error, "code")?.value === "STORAGE_CONFLICT")
  );
}
function failure(
  error: unknown,
  kind: SessionError["kind"],
  stage: SessionError["stage"],
): SessionError {
  return {
    kind: isConflict(error) ? "conflict" : kind,
    stage,
    message:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "保存未完成，请稍后重试",
  };
}

/** Preserve the exact JSON value for the v1 backup; do not invoke imported accessors or normalize old fields. */
function legacyCopy(raw: unknown): unknown {
  const ancestors = new Set<object>();
  let nodes = 0,
    characters = 0;
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > 1_000_000 || depth > 64) throw new Error("旧工程结构超过验证范围");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      characters += value.length;
      if (characters > 16 * 1024 * 1024) throw new Error("旧工程文字超过验证范围");
      return value;
    }
    if (!value || typeof value !== "object" || ancestors.has(value))
      throw new Error("旧工程须为有效 JSON 数据");
    const array = Array.isArray(value),
      prototype = Object.getPrototypeOf(value),
      keys = Reflect.ownKeys(value);
    if (
      (array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null) ||
      (array && keys.length !== value.length + 1)
    )
      throw new Error("旧工程须为普通对象和完整数组");
    ancestors.add(value);
    const result: any = array ? [] : {};
    for (const key of keys) {
      if (array && key === "length") continue;
      if (
        typeof key !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(key) ||
        (array && !/^(0|[1-9]\d*)$/.test(key))
      )
        throw new Error("旧工程包含无效数据键");
      characters += key.length;
      if (characters > 16 * 1024 * 1024) throw new Error("旧工程文字超过验证范围");
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
        throw new Error("旧工程不能包含访问器");
      result[key] = copy(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
    return result;
  }
  return copy(raw, 0);
}
function imported(value: unknown): { document: EditorDocument; legacy?: unknown } {
  if (
    value &&
    typeof value === "object" &&
    Object.getOwnPropertyDescriptor(value, "schemaVersion")?.value === 1
  ) {
    const legacy = legacyCopy(value);
    return { document: migrateLegacyProject(legacy), legacy };
  }
  return { document: validateEditorDocument(value) };
}

/** One editable history; immutable queued snapshots only represent pending persistence, never a second editing authority. */
export class EditorSession {
  private readonly history: EditorHistory;
  private generation = generation();
  private phase: EditorSessionState["phase"] = "ready";
  private fault: SessionError | null = null;
  private pending: SaveRequest | null = null;
  private requested = 0;
  private saved = 0;
  private writing = false;
  private worker: Promise<void> | null = null;
  private replacement: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private legacy: unknown | undefined;
  private discardOnClose = false;
  private listeners = new Set<(state: EditorSessionState) => void>();

  private constructor(
    private readonly storage: EditorSessionStorage,
    document: EditorDocument,
    private storageRevision: number,
    private readonly delay: number,
    historyLimit: number | undefined,
    legacy?: unknown,
  ) {
    this.history = new EditorHistory(document, historyLimit);
    this.legacy = legacy;
  }

  static async open(
    storage: EditorSessionStorage,
    options: EditorSessionOptions = {},
  ): Promise<EditorSession> {
    const delay = options.autosaveDelayMs ?? 400;
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > 60000)
      throw new Error("自动保存延迟须为 0 至 60000 毫秒");
    // A rejected read is never treated as an empty project. No writable session exists until validation succeeds.
    const stored = await storage.read(),
      base = revision(stored.revision);
    if (stored.data === null && options.initialDocument === undefined)
      throw new Error("尚无工程，请先提供新工程");
    const loaded =
      stored.data === null
        ? { document: validateEditorDocument(options.initialDocument) }
        : imported(stored.data);
    const session = new EditorSession(
      storage,
      loaded.document,
      base,
      delay,
      options.historyLimit,
      "legacy" in loaded ? loaded.legacy : undefined,
    );
    if (stored.data === null || session.legacy !== undefined)
      session.enqueue(stored.data === null ? "新建工程" : "升级旧工程");
    return session;
  }

  read(): EditorDocument {
    return this.history.read();
  }
  getState(): EditorSessionState {
    const value = this.history.read();
    return {
      identity: { documentId: value.id, generation: this.generation, revision: value.revision },
      storageRevision: this.storageRevision,
      phase: this.phase,
      saveState:
        this.fault?.kind === "conflict"
          ? "conflict"
          : this.writing
            ? "saving"
            : this.fault
              ? "failed"
              : this.requested > this.saved
                ? "pending"
                : "saved",
      dirty: this.requested > this.saved,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      legacyBackupPending: this.legacy !== undefined,
      error: this.fault ? { ...this.fault } : null,
    };
  }
  subscribe(listener: (state: EditorSessionState) => void): () => void {
    if (typeof listener !== "function") throw new Error("会话订阅需要回调");
    this.listeners.add(listener);
    this.publish(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(listener: (state: EditorSessionState) => void): void {
    // A view failure cannot interrupt an already committed history change or prevent its autosave.
    try {
      listener(this.getState());
    } catch {
      /* The caller owns view error reporting. */
    }
  }
  private notify(): void {
    for (const listener of [...this.listeners]) this.publish(listener);
  }
  private editable(): void {
    if (this.phase !== "ready")
      throw new Error(
        this.phase === "closed" ? "编辑会话已关闭" : "正在保存并切换工程，请稍候再编辑",
      );
  }
  private checkIdentity(identity: SessionIdentity): void {
    const current = this.getState().identity;
    if (
      !identity ||
      identity.documentId !== current.documentId ||
      identity.generation !== current.generation ||
      identity.revision !== current.revision
    )
      throw new Error("工程或版本已改变，请基于当前工程重新操作");
  }
  dispatch(
    operations: readonly EditorOperation[],
    baseRevision: number | SessionIdentity,
    editLabel = "编辑",
    actor: EditReceipt["actor"] = "user",
  ): EditorDocument {
    this.editable();
    label(editLabel);
    if (actor !== "user" && actor !== "agent") throw new Error("未知编辑来源");
    if (actor === "agent" && typeof baseRevision === "number")
      throw new Error("AI 编辑需要工程、会话和版本身份");
    if (typeof baseRevision !== "number") this.checkIdentity(baseRevision);
    const before = this.history.revision;
    const after = this.history.apply(
      operations,
      typeof baseRevision === "number" ? baseRevision : baseRevision.revision,
      editLabel,
      actor,
    );
    if (after.revision !== before) this.enqueue(editLabel);
    return after;
  }
  undo(identity?: SessionIdentity): EditorDocument {
    this.editable();
    if (identity) this.checkIdentity(identity);
    const before = this.history.revision,
      after = this.history.undo();
    if (after.revision !== before) this.enqueue("撤销");
    return after;
  }
  /** Persist an approved proposal before consuming it or making it visible in editing history. */
  async dispatchDurable(
    operations: readonly EditorOperation[],
    identity: SessionIdentity,
    editLabel = "保存编辑",
    actor: EditReceipt["actor"] = "user",
    signal?: AbortSignal,
  ): Promise<EditorDocument> {
    this.editable();
    this.checkIdentity(identity);
    label(editLabel);
    if (actor !== "user" && actor !== "agent") throw new Error("未知编辑来源");
    cancelled(signal);
    const prepared = this.history.prepare(operations, identity.revision, editLabel, actor);
    let complete!: () => void, reject!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, fail) => {
      complete = resolve;
      reject = fail;
    });
    this.replacement = completion;
    void completion.catch(() => {});
    this.phase = "committing";
    this.notify();
    let submitting = false;
    try {
      await this.flushQueue();
      cancelled(signal);
      if (prepared.document.revision !== identity.revision) {
        submitting = true;
        this.writing = true;
        this.fault = null;
        this.notify();
        const base = this.storageRevision;
        const stored = await this.storage.write(
          structuredClone(prepared.document),
          base,
          editLabel,
        );
        this.storageRevision = this.receipt(stored, base);
        // A committed write activates even if the caller cancels while waiting for its receipt.
        prepared.commit();
      }
      this.fault = null;
      complete();
      return this.history.read();
    } catch (error) {
      reject(error);
      if (submitting) this.fault = failure(error, "write", "commit");
      throw error;
    } finally {
      if (this.replacement === completion) this.replacement = null;
      this.writing = false;
      this.phase = "ready";
      this.notify();
    }
  }
  redo(identity?: SessionIdentity): EditorDocument {
    this.editable();
    if (identity) this.checkIdentity(identity);
    const before = this.history.revision,
      after = this.history.redo();
    if (after.revision !== before) this.enqueue("重做");
    return after;
  }
  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  private enqueue(editLabel: string): void {
    this.pending = { sequence: ++this.requested, document: this.history.read(), label: editLabel };
    this.clearTimer();
    if (this.fault?.kind !== "conflict")
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush().catch(() => {
          /* State retains the failed snapshot and actionable error. */
        });
      }, this.delay);
    this.notify();
  }
  private receipt(value: { revision: number }, base: number): number {
    try {
      const next = revision(value?.revision);
      if (next <= base) throw new Error("non-incrementing revision");
      return next;
    } catch {
      throw new EditorStorageConflictError(
        "保存回执缺少有效新版本，无法确认存储状态，请保留当前工程并检查存储",
      );
    }
  }
  private async drain(): Promise<void> {
    while (this.pending && !this.discardOnClose) {
      const request = this.pending;
      this.pending = null;
      this.writing = true;
      this.fault = null;
      this.notify();
      let kind: SessionError["kind"] = "backup";
      try {
        if (this.legacy !== undefined) {
          await this.storage.backupLegacy(legacyCopy(this.legacy));
          this.legacy = undefined;
        }
        // A close/discard received during backup cancels the still-unsubmitted write.
        if (this.discardOnClose) break;
        kind = "write";
        const base = this.storageRevision;
        const stored = await this.storage.write(
          structuredClone(request.document),
          base,
          request.label,
        );
        this.storageRevision = this.receipt(stored, base);
        this.saved = request.sequence;
      } catch (error) {
        if (!this.pending && !this.discardOnClose) this.pending = request;
        this.fault = failure(error, kind, "save");
        this.clearTimer();
        throw error;
      } finally {
        this.writing = false;
        this.notify();
      }
    }
  }
  /** Wait for all edits requested before or during this flush. Calls share one strictly ordered writer. */
  async flush(): Promise<void> {
    if (this.phase === "closed") throw new Error("编辑会话已关闭");
    do {
      if (this.replacement) await this.replacement;
      await this.flushQueue();
    } while (this.replacement || this.pending || this.worker);
  }
  private async flushQueue(): Promise<void> {
    this.clearTimer();
    if (this.fault?.kind === "conflict") throw new EditorStorageConflictError(this.fault.message);
    do {
      if (!this.worker && this.pending) {
        const run = Promise.resolve()
          .then(() => this.drain())
          .finally(() => {
            if (this.worker === run) this.worker = null;
          });
        this.worker = run;
        // Autosave may have no explicit waiter; flush still returns the original rejection to explicit callers.
        void run.catch(() => {});
      }
      if (this.worker) await this.worker;
    } while (this.pending && !this.discardOnClose);
  }

  async replace(value: unknown, options: ReplaceDocumentOptions = {}): Promise<EditorDocument> {
    this.editable();
    if (options.identity) this.checkIdentity(options.identity);
    cancelled(options.signal);
    const editLabel = label(options.label ?? "打开工程"),
      loaded = imported(value),
      current = this.history.read();
    if (loaded.document.id === current.id)
      loaded.document = validateEditorDocument({
        ...loaded.document,
        revision: Math.max(loaded.document.revision, current.revision + 1),
      });
    let complete!: () => void, reject!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, fail) => {
      complete = resolve;
      reject = fail;
    });
    this.replacement = completion;
    void completion.catch(() => {});
    this.phase = "replacing";
    this.notify();
    let stage: "old" | "backup" | "write" = "old";
    try {
      await this.flushQueue();
      cancelled(options.signal);
      if (loaded.legacy !== undefined) {
        stage = "backup";
        await this.storage.backupLegacy(legacyCopy(loaded.legacy));
        cancelled(options.signal);
      }
      stage = "write";
      this.writing = true;
      this.notify();
      const base = this.storageRevision;
      const stored = await this.storage.write(structuredClone(loaded.document), base, editLabel);
      this.storageRevision = this.receipt(stored, base);
      // Once storage commits, cancellation cannot leave the old active document pointing at new stored data.
      this.history.replace(loaded.document);
      this.generation = generation();
      this.pending = null;
      this.saved = this.requested;
      this.legacy = undefined;
      this.fault = null;
      complete();
      return this.history.read();
    } catch (error) {
      reject(error);
      if (stage !== "old" && !(error instanceof Error && error.name === "AbortError"))
        this.fault = failure(error, stage === "backup" ? "backup" : "write", "replace");
      throw error;
    } finally {
      if (this.replacement === completion) this.replacement = null;
      this.writing = false;
      this.phase = "ready";
      this.notify();
    }
  }

  /** Explicitly discard only unsubmitted saves when save:false. In-flight writes always finish before close resolves. */
  async close(options: { save?: boolean } = {}): Promise<void> {
    if (this.phase === "closed") return;
    this.editable();
    this.phase = "closing";
    this.clearTimer();
    this.notify();
    try {
      if (options.save !== false) await this.flush();
      else {
        this.discardOnClose = true;
        this.pending = null;
        await this.worker?.catch(() => {});
      }
      this.phase = "closed";
      this.notify();
      this.listeners.clear();
    } catch (error) {
      this.phase = "ready";
      this.notify();
      throw error;
    }
  }
}
