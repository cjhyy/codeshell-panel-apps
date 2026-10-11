import {
  planCreateCompound,
  planCreateSequence,
  planDuplicateSequence,
  planNestSequence,
  planRemoveSequence,
  planRenameSequence,
  planUnpackCompound,
  type SequenceEditPlan,
} from "./sequence-edits";
import type { EditorOperation } from "./operations";
import { sameIdentity, type SessionIdentity } from "./session";
import { TICKS_PER_SECOND, type Tick } from "./time";
import type { EditorDocument } from "./types";
import { sequenceDuration } from "./validation";

export interface EditorSequencesContext {
  read(): EditorDocument;
  identity?(): SessionIdentity;
  selection(): { sequenceId: string; clipIds: string[] };
  time(): Tick;
  apply(operations: EditorOperation[], label: string): void | Promise<void>;
  select(selection: { sequenceId: string; clipIds: string[] }): void;
  /** Navigation hook after sequence.activate has already been applied to the shared session. */
  activate(sequenceId: string): void;
  onError(error: unknown): void;
}
interface SequenceRemoval {
  identity?: SessionIdentity;
  documentId: string;
  revision: number;
  targetId: string;
  activeSequenceId: string;
  viewedSequenceId: string;
  name: string;
  clips: number;
  markers: number;
  duration: Tick;
}
const rates: Array<[string, string]> = [
  ["24/1", "24"],
  ["25/1", "25"],
  ["30/1", "30"],
  ["48/1", "48"],
  ["50/1", "50"],
  ["60/1", "60"],
  ["24000/1001", "23.976 (24000/1001)"],
  ["30000/1001", "29.97 (30000/1001)"],
  ["60000/1001", "59.94 (60000/1001)"],
];
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function input(label: string, value: string, numeric = false): HTMLInputElement {
  const node = element("input");
  node.type = numeric ? "number" : "text";
  node.setAttribute("aria-label", label);
  node.value = value;
  if (numeric) {
    node.min = "16";
    node.max = "8192";
    node.step = "1";
  } else node.maxLength = 200;
  return node;
}
function field(label: string, control: HTMLElement): HTMLLabelElement {
  const node = element("label", "eseq-field");
  node.append(element("span", "", label), control);
  return node;
}
function select(label: string, choices: Array<[string, string]>, value: string): HTMLSelectElement {
  const node = element("select");
  node.setAttribute("aria-label", label);
  for (const [id, text] of choices) {
    const option = element("option", "", text);
    option.value = id;
    node.append(option);
  }
  node.value = value;
  return node;
}

/** Mount with public/editor-sequences.css. All edits, history and persistence belong to the parent session. */
export class EditorSequences {
  private readonly root = element("section", "editor-sequences");
  private signature = "";
  private renderedIdentity?: SessionIdentity;
  private managedId = "";
  private pending = false;
  private disposed = false;
  private error = "";
  private status = "";
  private removal?: SequenceRemoval;
  private open = new Set(["序列管理", "复合片段"]);
  constructor(
    container: HTMLElement,
    private readonly context: EditorSequencesContext,
  ) {
    this.root.setAttribute("aria-label", "序列与复合片段");
    container.append(this.root);
    this.render();
  }
  dispose(): void {
    this.disposed = true;
    this.removal = undefined;
    this.root.remove();
  }
  private report(error: unknown): void {
    const value = error instanceof Error ? error : new Error(String(error));
    this.error = value.message;
    this.context.onError(value);
  }
  private async run(
    label: string,
    make: (doc: EditorDocument) => SequenceEditPlan,
    navigate = false,
  ): Promise<void> {
    if (this.pending || this.disposed) return;
    const before = this.context.read(),
      identity = this.context.identity?.(),
      sequenceId = this.context.selection().sequenceId;
    let activatedSequenceId: string | undefined;
    const owns = () => {
      const current = this.context.selection().sequenceId;
      return (
        !this.disposed &&
        (!identity || sameIdentity(identity, this.context.identity?.(), false)) &&
        (current === sequenceId || current === activatedSequenceId)
      );
    };
    try {
      const plan = make(before);
      for (const operation of plan.operations)
        if (operation.type === "sequence.activate") activatedSequenceId = operation.sequenceId;
      this.pending = true;
      this.error = "";
      this.status = "";
      this.root.querySelectorAll("fieldset").forEach((node) => {
        node.disabled = true;
      });
      await this.context.apply(plan.operations, label);
      if (!owns()) return;
      const after = this.context.read();
      if (
        after.id !== before.id ||
        after.revision !== before.revision + 1 ||
        !after.sequences.some((seq) => seq.id === plan.sequenceId) ||
        (navigate && after.activeSequenceId !== plan.sequenceId)
      )
        return;
      if (plan.createdSequenceId) this.managedId = plan.createdSequenceId;
      if (after.activeSequenceId === plan.sequenceId)
        this.context.select({ sequenceId: plan.sequenceId, clipIds: plan.clipIds });
      if (navigate) this.context.activate(plan.sequenceId);
      this.status = plan.includedClipIds
        ? `已将 ${plan.includedClipIds.length} 个相关片段放入复合序列，可打开继续编辑。`
        : `${label}已完成，可在工程历史中撤销。`;
    } catch (error) {
      if (owns()) this.report(error);
    } finally {
      this.pending = false;
      if (!this.disposed) {
        this.signature = "";
        this.render();
      }
    }
  }
  private button(
    text: string,
    action: () => void,
    disabled = false,
    prominent = false,
  ): HTMLButtonElement {
    const node = element("button", prominent ? "eseq-primary" : "", text);
    node.type = "button";
    node.disabled = disabled;
    const identity = this.context.identity?.();
    node.addEventListener("click", () => {
      if (
        !this.pending &&
        !this.disposed &&
        this.root.contains(node) &&
        (!identity || sameIdentity(identity, this.context.identity?.(), false))
      )
        action();
    });
    return node;
  }
  private section(title: string): HTMLDivElement {
    const details = element("details", "eseq-section");
    details.open = this.open.has(title);
    details.append(element("summary", "", title));
    details.addEventListener("toggle", () => {
      if (details.open) this.open.add(title);
      else this.open.delete(title);
    });
    const body = element("div", "eseq-body");
    details.append(body);
    this.root.querySelector("fieldset")!.append(details);
    return body;
  }
  private removalCurrent(request: SequenceRemoval, doc: EditorDocument, revision = request.revision,
    active = request.activeSequenceId, viewed = [request.viewedSequenceId]): boolean {
    const identity = this.context.identity?.(), selected = this.context.selection().sequenceId;
    return !this.disposed && this.removal === request && this.managedId === request.targetId &&
      doc.id === request.documentId && doc.revision === revision && doc.activeSequenceId === active && viewed.includes(selected) &&
      (!request.identity || (request.identity.documentId === request.documentId && request.identity.revision === request.revision &&
        sameIdentity(request.identity, identity, false))) &&
      (!identity || (identity.documentId === doc.id && identity.revision === doc.revision));
  }
  private requestRemoval(request: SequenceRemoval): void {
    if (this.pending || this.disposed) return;
    this.removal = request;
    try {
      if (!this.removalCurrent(request, this.context.read())) throw new Error("序列或工程版本已变化，请重新确认删除");
      this.error = this.status = "";
      if (!request.clips && !request.markers) { void this.removeSequence(request); return; }
      this.signature = "";
      this.render();
    } catch (error) {
      if (this.removal !== request || this.disposed) return;
      this.removal = undefined;
      this.report(error);
      this.signature = "";
      this.render();
    }
  }
  /** Deletion alone requires an exact version; ordinary sequence forms still merge as before. */
  private async removeSequence(request: SequenceRemoval): Promise<void> {
    if (this.pending || this.disposed || this.removal !== request) return;
    let applying = false;
    try {
      const before = this.context.read();
      if (!this.removalCurrent(request, before)) throw new Error("序列或工程版本已变化，请重新确认删除");
      const plan = planRemoveSequence(before, request.targetId);
      if (!this.removalCurrent(request, before)) return;
      this.pending = applying = true;
      this.error = this.status = "";
      this.root.querySelectorAll("fieldset").forEach((node) => { node.disabled = true; });
      await this.context.apply(plan.operations, "删除序列");
      const after = this.context.read(), viewed = request.activeSequenceId === request.targetId
        ? [request.viewedSequenceId, plan.sequenceId] : [request.viewedSequenceId];
      if (!this.removalCurrent(request, after, request.revision + 1, plan.sequenceId, viewed) ||
        after.sequences.some((seq) => seq.id === request.targetId)) return;
      if (request.activeSequenceId === request.targetId) {
        this.context.select({ sequenceId: plan.sequenceId, clipIds: [] });
        if (!this.removalCurrent(request, this.context.read(), request.revision + 1, plan.sequenceId, viewed)) return;
        this.context.activate(plan.sequenceId);
        if (!this.removalCurrent(request, this.context.read(), request.revision + 1, plan.sequenceId, viewed)) return;
      }
      this.status = `已删除“${request.name}”（${request.clips} 个片段、${request.markers} 个标记），可在工程历史中撤销。`;
      this.removal = undefined;
    } catch (error) {
      if (this.removal === request && !this.disposed) {
        try {
          const fresh = this.context.read();
          if (this.removal !== request || this.disposed) return;
          const current = this.removalCurrent(request, fresh);
          if (this.removal !== request || this.disposed) return;
          if (current) this.report(error);
          else {
            this.removal = undefined;
            if (!applying) this.error = "序列或工程版本已变化，请重新确认删除";
          }
        } catch { if (this.removal === request) this.removal = undefined; }
      }
    } finally {
      if (applying) this.pending = false;
      if (!this.disposed) { this.signature = ""; this.render(); }
    }
  }
  render(): void {
    if (this.disposed) return;
    const identity = this.context.identity?.();
    if (this.renderedIdentity && !sameIdentity(this.renderedIdentity, identity, false)) {
      this.managedId = "";
      this.error = "";
      this.status = "";
      this.removal = undefined;
      this.signature = "";
    }
    this.renderedIdentity = identity;
    if (this.pending) return;
    const renderedRemoval = this.removal;
    const doc = this.context.read(), selection = this.context.selection();
    if (this.disposed || this.removal !== renderedRemoval) return;
    const current =
        doc.sequences.find((seq) => seq.id === selection.sequenceId) ??
        doc.sequences.find((seq) => seq.id === doc.activeSequenceId)!;
    const managed = doc.sequences.find((seq) => seq.id === this.managedId) ?? current;
    this.managedId = managed.id;
    const removalCurrent = !renderedRemoval || this.removalCurrent(renderedRemoval, doc);
    if (this.disposed || this.removal !== renderedRemoval) return;
    if (!removalCurrent) this.removal = undefined;
    const signature = JSON.stringify([
      identity?.documentId,
      identity?.generation,
      doc.id,
      doc.revision,
      selection,
      this.managedId,
      this.error,
      this.status,
      !!this.removal,
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.root.replaceChildren(element("header", "eseq-header", "序列与复合片段"));
    const content = element("fieldset");
    this.root.append(content);
    const manage = this.section("序列管理"),
      picker = select(
        "待管理序列",
        doc.sequences.map((seq) => [
          seq.id,
          `${seq.id === doc.activeSequenceId ? "● " : ""}${seq.name}`,
        ]),
        managed.id,
      );
    picker.addEventListener("change", () => {
      if (
        !this.root.contains(picker) ||
        (identity && !sameIdentity(identity, this.context.identity?.(), false))
      )
        return;
      this.managedId = picker.value;
      this.removal = undefined;
      this.error = "";
      this.status = "";
      this.signature = "";
      this.render();
    });
    manage.append(field("待管理序列", picker));
    const duration = (sequenceDuration(managed) / TICKS_PER_SECOND).toFixed(2),
      rate =
        rates.find(
          ([id]) => id === `${managed.frameRate.numerator}/${managed.frameRate.denominator}`,
        )?.[1] ?? "";
    manage.append(
      element(
        "p",
        "eseq-meta",
        `${managed.width} × ${managed.height} · ${rate} 帧/秒 · ${duration} 秒 · ${managed.clips.length} 个片段`,
      ),
    );
    const name = input("序列名称", managed.name),
      actions = element("div", "eseq-actions");
    manage.append(field("序列名称", name));
    actions.append(
      this.button(
        "重命名序列",
        () =>
          void this.run("重命名序列", (document) =>
            planRenameSequence(document, managed.id, name.value),
          ),
      ),
      this.button(
        "打开序列",
        () =>
          void this.run(
            "打开序列",
            () => ({
              operations: [{ type: "sequence.activate", sequenceId: managed.id }],
              sequenceId: managed.id,
              clipIds: [],
            }),
            true,
          ),
        managed.id === doc.activeSequenceId,
      ),
    );
    manage.append(actions);
    const copyName = input("副本名称", `${managed.name} 副本`);
    manage.append(
      field("副本名称", copyName),
      this.button(
        "复制完整序列",
        () =>
          void this.run(
            "复制序列",
            (document) => planDuplicateSequence(document, managed.id, { name: copyName.value }),
            true,
          ),
      ),
    );
    manage.append(
      element("p", "eseq-note", "副本包含内部嵌套序列；画面和声音可独立编辑，素材文件共用。"),
    );
    const referenced = doc.sequences.some((seq) =>
      seq.clips.some((clip) => clip.kind === "sequence" && clip.sequenceId === managed.id),
    );
    const locked = managed.tracks.some((track) => track.locked);
    const removal: SequenceRemoval = {
      identity: identity ? { ...identity } : undefined, documentId: doc.id, revision: doc.revision,
      targetId: managed.id, activeSequenceId: doc.activeSequenceId, viewedSequenceId: selection.sequenceId,
      name: managed.name, clips: managed.clips.length, markers: managed.markers.length, duration: sequenceDuration(managed),
    };
    manage.append(
      this.button(
        "删除空闲序列",
        () => this.requestRemoval(removal),
        doc.sequences.length === 1 || referenced || locked,
      ),
    );
    if (this.removal && (this.removal.clips || this.removal.markers)) {
      const request = this.removal, confirmation = element("div", "eseq-remove-confirmation"), actions = element("div", "eseq-actions");
      confirmation.dataset.sequenceRemoveConfirmation = "";
      confirmation.setAttribute("role", "group");
      confirmation.setAttribute("aria-label", "确认删除序列");
      confirmation.append(element("p", "", `删除“${request.name}”？`),
        element("p", "eseq-meta", `${request.clips} 个片段 · ${request.markers} 个标记 · ${(request.duration / TICKS_PER_SECOND).toFixed(2)} 秒`),
        element("p", "eseq-note", "确认后仅移除此序列，可在工程历史中撤销。"));
      actions.append(this.button("取消删除", () => {
        if (this.removal !== request) return;
        this.removal = undefined; this.signature = ""; this.render();
      }), this.button("确认删除", () => { void this.removeSequence(request); }));
      confirmation.append(actions);
      manage.append(confirmation);
    }
    if (referenced)
      manage.append(element("p", "eseq-note", "此序列被复合片段引用，移除引用后才能删除。"));
    else if (locked) manage.append(element("p", "eseq-note", "序列含锁定轨道，解锁后才能删除。"));

    const nest = this.section("加入当前时间轴"),
      nestTrack = select(
        "嵌套目标轨道",
        [
          ["", "新建独立画面轨道"],
          ...current.tracks
            .filter((track) => track.kind === "video")
            .map(
              (track) =>
                [track.id, `${track.name}${track.locked ? "（已锁定）" : ""}`] as [string, string],
            ),
        ],
        "",
      );
    nest.append(
      element(
        "p",
        "eseq-note",
        `将“${managed.name}”作为一个片段放入“${current.name}”。位置使用点击时的播放头。`,
      ),
      field("嵌套目标轨道", nestTrack),
      this.button(
        "在播放头加入序列",
        () =>
          void this.run("加入嵌套序列", (document) =>
            planNestSequence(document, current.id, managed.id, {
              at: this.context.time(),
              ...(nestTrack.value ? { trackId: nestTrack.value } : {}),
            }),
          ),
        managed.id === current.id || !managed.clips.length,
      ),
    );

    const compound = this.section("复合片段"),
      selected = current.clips.filter((clip) => selection.clipIds.includes(clip.id)),
      selectionLocked = selected.some(
        (clip) => current.tracks.find((track) => track.id === clip.trackId)?.locked,
      ),
      compoundName = input("复合片段名称", `${current.name} 复合`);
    compound.append(
      element(
        "p",
        "eseq-meta",
        `当前选中 ${selected.length} 个片段${selectionLocked ? " · 含锁定轨道" : ""}`,
      ),
      field("复合片段名称", compoundName),
    );
    compound.append(
      element(
        "p",
        "eseq-note",
        "分组、链接声音、绑定字幕和相连转场会一起加入。原始轨道效果和所有时间节点保留。",
      ),
    );
    compound.append(
      this.button(
        "创建复合片段",
        () =>
          void this.run("创建复合片段", (document) =>
            planCreateCompound(document, current.id, selection.clipIds, {
              name: compoundName.value,
            }),
          ),
        !selected.length || selectionLocked,
        true,
      ),
    );
    const only =
      selected.length === 1 && selected[0]!.kind === "sequence" ? selected[0] : undefined;
    const compoundActions = element("div", "eseq-actions");
    compoundActions.append(
      this.button(
        "编辑复合内容",
        () => {
          if (!only || only.kind !== "sequence") return;
          void this.run(
            "打开复合序列",
            () => ({
              operations: [{ type: "sequence.activate", sequenceId: only.sequenceId }],
              sequenceId: only.sequenceId,
              clipIds: [],
            }),
            true,
          );
        },
        !only,
      ),
      this.button(
        "解除复合片段",
        () =>
          void this.run("解除复合片段", (document) =>
            planUnpackCompound(document, current.id, only!.id),
          ),
        !only || selectionLocked,
      ),
    );
    compound.append(
      compoundActions,
      element(
        "p",
        "eseq-note",
        "解除复合支持完整、原速、无整体效果的实例；内部序列仍保留。裁剪、变速或额外整体效果需要先恢复后再解除。",
      ),
    );

    const create = this.section("新建空白序列"),
      newName = input("新序列名称", "新序列"),
      width = input("画布宽度（像素）", String(current.width), true),
      height = input("画布高度（像素）", String(current.height), true),
      fps = select(
        "新序列帧率",
        rates,
        `${current.frameRate.numerator}/${current.frameRate.denominator}`,
      );
    create.append(
      field("新序列名称", newName),
      field("宽度（像素）", width),
      field("高度（像素）", height),
      field("帧率（帧/秒）", fps),
      this.button(
        "创建并打开空白序列",
        () =>
          void this.run(
            "创建序列",
            (document) => {
              const [numerator, denominator] = fps.value.split("/").map(Number);
              return planCreateSequence(document, {
                name: newName.value,
                width: width.valueAsNumber,
                height: height.valueAsNumber,
                frameRate: { numerator: numerator!, denominator: denominator! },
              });
            },
            true,
          ),
      ),
    );
    if (this.error) {
      const error = element("p", "eseq-error", this.error);
      error.setAttribute("role", "alert");
      this.root.append(error);
    }
    if (this.status) {
      const status = element("p", "eseq-status", this.status);
      status.setAttribute("role", "status");
      this.root.append(status);
    }
  }
}
export function mountEditorSequences(
  container: HTMLElement,
  context: EditorSequencesContext,
): EditorSequences {
  return new EditorSequences(container, context);
}
