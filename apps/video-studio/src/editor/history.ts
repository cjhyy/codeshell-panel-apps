import { applyEditorOperations, type EditorOperation } from "./operations";
import type { EditorDocument } from "./types";
import { validateEditorDocument } from "./validation";

export interface EditReceipt {
  label: string;
  actor: "user" | "agent";
  before: EditorDocument;
  after: EditorDocument;
}

/** The same history boundary is used for mouse edits, keyboard actions and AI batches. */
export class EditorHistory {
  private value: EditorDocument;
  private past: EditReceipt[] = [];
  private future: EditReceipt[] = [];

  constructor(
    document: EditorDocument,
    private readonly limit = 50,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw new Error("撤销历史数量须为 1–200");
    this.value = validateEditorDocument(document);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get revision(): number {
    return this.value.revision;
  }

  read(): EditorDocument {
    return structuredClone(this.value);
  }

  apply(
    operations: readonly EditorOperation[],
    baseRevision: number,
    label = "编辑",
    actor: EditReceipt["actor"] = "user",
  ): EditorDocument {
    return this.prepare(operations, baseRevision, label, actor).commit();
  }

  /** Validate before I/O, then publish exactly the prepared change after its durable receipt. */
  prepare(
    operations: readonly EditorOperation[],
    baseRevision: number,
    label = "编辑",
    actor: EditReceipt["actor"] = "user",
  ): { document: EditorDocument; commit(): EditorDocument } {
    const before = this.value;
    const after = applyEditorOperations(this.value, operations, baseRevision);
    return {
      document: structuredClone(after),
      commit: () => {
        if (this.value !== before) throw new Error("工程版本已变化，请重新操作");
        if (after.revision !== before.revision) {
          this.past.push({ label, actor, before, after });
          this.past = this.past.slice(-this.limit);
          this.future = [];
          this.value = after;
        }
        return this.read();
      },
    };
  }

  private restored(snapshot: EditorDocument): EditorDocument {
    // Undo must not reuse an old revision: an AI request planned before undo remains stale.
    return validateEditorDocument({ ...snapshot, revision: this.value.revision + 1 });
  }

  undo(): EditorDocument {
    const receipt = this.past.at(-1);
    if (!receipt) return this.read();
    const restored = this.restored(receipt.before);
    this.past.pop();
    this.future.push(receipt);
    this.value = restored;
    return this.read();
  }

  redo(): EditorDocument {
    const receipt = this.future.at(-1);
    if (!receipt) return this.read();
    const restored = this.restored(receipt.after);
    this.future.pop();
    this.past.push(receipt);
    this.value = restored;
    return this.read();
  }

  /** Replace only after an import/restore has been fully validated; never preserve foreign undo. */
  replace(document: EditorDocument): EditorDocument {
    const next = validateEditorDocument(document);
    this.value = next;
    this.past = [];
    this.future = [];
    return this.read();
  }
}
