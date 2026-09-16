import { validateExportProfile, type ExportProfile } from "./export-settings";
import type { EditorDocument } from "./types";
import { sequenceDuration, validateEditorDocument } from "./validation";

export interface ExportBatchProgress {
  completed: number;
  total: number;
  sequence: string;
  profile: string;
}

/** One frozen submission plan. Successfully accepted tasks are never submitted twice on retry. */
export class EditorExportBatch {
  private readonly document: EditorDocument;
  private readonly items: { sequenceId: string; sequence: string; profile: ExportProfile }[];
  private completed = 0;
  private running = false;

  constructor(document: EditorDocument, sequenceIds: string[], profiles: ExportProfile[]) {
    this.document = validateEditorDocument(document);
    for (const values of [sequenceIds, profiles]) {
      if (Array.isArray(values) && values.length > 512)
        throw new Error("每批最多提交 512 个成片，请分批选择");
      if (
        !Array.isArray(values) ||
        Array.from({ length: values.length }, (_, index) => index).some(
          (index) => !Object.hasOwn(values, index),
        )
      )
        throw new Error("导出选择须为完整数组，不能遗漏项目");
    }
    if (!sequenceIds.length || new Set(sequenceIds).size !== sequenceIds.length)
      throw new Error("请选择要导出的序列");
    if (!profiles.length || new Set(profiles.map((profile) => profile.id)).size !== profiles.length)
      throw new Error("请选择不同的导出预设");
    if (sequenceIds.length * profiles.length > 512)
      throw new Error("每批最多提交 512 个成片，请分批选择");
    const valid = profiles.map(validateExportProfile);
    this.items = sequenceIds.flatMap((id) => {
      const sequence = this.document.sequences.find((item) => item.id === id);
      if (!sequence) throw new Error("所选序列已不存在");
      if (sequenceDuration(sequence) <= 0)
        throw new Error(`序列“${sequence.name}”没有可导出的内容`);
      return valid.map((profile) => ({ sequenceId: id, sequence: sequence.name, profile }));
    });
  }

  get progress(): { completed: number; total: number } {
    return { completed: this.completed, total: this.items.length };
  }

  async submit(
    accept: (
      doc: EditorDocument,
      sequenceId: string,
      profile: ExportProfile,
      signal: AbortSignal,
    ) => Promise<void>,
    signal: AbortSignal,
    changed?: (progress: ExportBatchProgress) => void,
  ): Promise<void> {
    if (this.running) throw new Error("此批导出正在提交");
    this.running = true;
    try {
      while (this.completed < this.items.length) {
        if (signal.aborted)
          throw new DOMException("已取消剩余导出提交；已进入后台的任务会继续", "AbortError");
        const item = this.items[this.completed]!;
        changed?.({ ...this.progress, sequence: item.sequence, profile: item.profile.name });
        await accept(
          structuredClone(this.document),
          item.sequenceId,
          structuredClone(item.profile),
          signal,
        );
        // The adapter's resolved receipt means accepted, even when cancellation arrives at this boundary.
        this.completed++;
        changed?.({ ...this.progress, sequence: item.sequence, profile: item.profile.name });
      }
    } finally {
      this.running = false;
    }
  }
}
