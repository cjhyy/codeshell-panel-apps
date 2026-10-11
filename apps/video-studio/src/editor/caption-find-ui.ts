import type { CaptionController } from "./caption-controller";
import { findCaptionText, type CaptionTextMatch } from "./captions";
import { sameIdentity, type EditorSession } from "./session";

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  return value;
};
export interface CaptionFindContext {
  session(): EditorSession;
  controller: CaptionController;
  sequenceId(): string;
  selected(): string[];
  assertSaved(clipIds: string[]): void;
  reveal(match: CaptionTextMatch, query: string): void | Promise<void>;
  run(task: () => void | Promise<void>): void;
}

/** Search is view state; replacements use the workbench's existing durable candidate boundary. */
export class CaptionFindUI {
  readonly element = node("section");
  private readonly query = node("textarea");
  private readonly replacement = node("textarea");
  private readonly scope = node("select");
  private readonly count = node("p");
  private readonly previous = node("button", "上一条匹配");
  private readonly next = node("button", "下一条匹配");
  private readonly single = node("button", "预览替换此条");
  private readonly all = node("button", "预览全部替换");
  private matches: CaptionTextMatch[] = [];
  private current?: string;
  private busy = false;
  constructor(private readonly context: CaptionFindContext) {
    this.element.className = "ec-find";
    this.element.setAttribute("aria-label", "字幕查找与替换");
    this.element.append(node("h3", "查找与替换"));
    for (const [input, label] of [[this.query, "查找字幕文字"], [this.replacement, "替换为"]] as const) {
      input.rows = 2;
      input.maxLength = 10000;
      input.placeholder = label;
      input.setAttribute("aria-label", label);
      this.element.append(input);
    }
    this.scope.setAttribute("aria-label", "查找替换范围");
    for (const [value, title] of [["sequence", "当前序列全部字幕"], ["selected", "仅所选字幕"]]) {
      const option = node("option", title);
      option.value = value!;
      this.scope.append(option);
    }
    this.count.className = "ec-find-count";
    this.count.setAttribute("role", "status");
    const controls = node("div");
    controls.className = "ec-find-actions";
    controls.append(this.scope, this.previous, this.next, this.single, this.all);
    this.element.append(controls, this.count, node("small", "按字面查找已保存文字，区分大小写；Shift+Enter 输入换行。只改词间标点或空白可保留词时间；改词后需要重新对齐。修改后的旧译文会清除。"));
    for (const button of [this.previous, this.next, this.single, this.all]) button.type = "button";
    this.query.addEventListener("input", () => { this.current = undefined; this.invalidate(); });
    this.replacement.addEventListener("input", () => this.invalidate());
    this.scope.addEventListener("change", () => { this.current = undefined; this.invalidate(); });
    this.previous.addEventListener("click", () => this.navigate(-1));
    this.next.addEventListener("click", () => this.navigate(1));
    this.single.addEventListener("click", () => this.preview(false));
    this.all.addEventListener("click", () => this.preview(true));
    this.query.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      this.navigate(1);
    });
  }
  private ids(): string[] | undefined {
    return this.scope.value === "selected" ? this.context.selected() : undefined;
  }
  private invalidate(): void {
    if (this.context.controller.getState().candidate?.replacement) this.context.controller.cancel();
    this.render();
  }
  selectionChanged(): void {
    if (this.scope.value === "selected") this.invalidate();
    else this.render();
  }
  render(busy = this.busy): void {
    this.busy = busy;
    this.query.disabled = this.replacement.disabled = this.scope.disabled = busy;
    let error = "";
    this.matches = [];
    if (this.query.value) {
      try {
        this.matches = findCaptionText(this.context.session().read(), this.context.sequenceId(), this.query.value, this.ids());
      } catch (failure) {
        error = (failure as Error).message;
      }
    }
    if (!this.matches.some((match) => match.clipId === this.current)) this.current = undefined;
    const occurrences = this.matches.reduce((total, match) => total + match.occurrences, 0),
      current = this.matches.findIndex((match) => match.clipId === this.current),
      scope = this.scope.value === "selected" ? `仅所选 ${this.context.selected().length} 条字幕` : "当前序列全部字幕";
    this.count.textContent = error || `${scope} · ${this.matches.length} 条字幕 / ${occurrences} 处匹配${current < 0 ? "" : ` · 第 ${current + 1}/${this.matches.length} 条`}`;
    for (const button of [this.previous, this.next, this.single, this.all])
      button.disabled = busy || !this.matches.length;
  }
  private navigate(direction: number): void {
    if (this.busy || !this.matches.length) return;
    const index = this.matches.findIndex((match) => match.clipId === this.current),
      next = index < 0 ? (direction < 0 ? this.matches.length - 1 : 0) : (index + direction + this.matches.length) % this.matches.length,
      match = this.matches[next]!;
    this.current = match.clipId;
    this.render();
    const session = this.context.session(), identity = session.getState().identity,
      sequenceId = this.context.sequenceId(), query = this.query.value, scope = this.scope.value;
    this.context.run(() => {
      if (this.busy || this.context.session() !== session ||
          !sameIdentity(session.getState().identity, identity, false) ||
          this.context.sequenceId() !== sequenceId || this.query.value !== query || this.scope.value !== scope)
        return;
      // A later revision may legitimately retime this match; reveal its current saved row and tick.
      this.render();
      const current = this.matches.find((item) => item.clipId === match.clipId);
      if (current) return this.context.reveal(current, query);
    });
  }
  private preview(all: boolean): void {
    this.context.run(() => {
      this.render();
      const match = this.matches.find((item) => item.clipId === this.current) ?? this.matches[0];
      if (!match) throw new Error("当前范围没有匹配的字幕");
      const ids = all ? this.matches.map((item) => item.clipId) : [match.clipId];
      this.context.assertSaved(ids);
      this.context.controller.previewReplace({
        sequenceId: this.context.sequenceId(),
        query: this.query.value,
        text: this.replacement.value,
        clipIds: ids,
        scope: all ? (this.scope.value === "selected" ? "selected" : "sequence") : "current",
      });
    });
  }
}
