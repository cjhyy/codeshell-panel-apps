import { randomId } from "../ids.js";
import { planMarkerEdit, type MarkerEditRequest } from "./marker-edits";
import type { EditorOperation } from "./operations";
import { sameIdentity, type SessionIdentity } from "./session";
import { secondsToTicks, ticksToSeconds, type Tick } from "./time";
import type { EditorDocument, TimelineMarker } from "./types";
import { MAX_EDITOR_TICK } from "./validation";

export interface EditorMarkersContext {
  read(): EditorDocument;
  identity(): SessionIdentity;
  selection(): { sequenceId: string; clipIds: string[] };
  time(): Tick;
  seek(time: Tick): void | Promise<void>;
  apply(operations: EditorOperation[], label: string): void | Promise<void>;
  onSelection(markerId: string | undefined): void;
  onError(error: unknown): void;
}
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const seconds = (tick: Tick) => String(Number(ticksToSeconds(tick).toFixed(6)));
const field = (name: string, control: HTMLElement) => {
  const label = element("label");
  label.append(element("span", name), control);
  control.setAttribute("aria-label", name);
  return label;
};
type MarkerForm = {
  node: HTMLFormElement;
  baseline: TimelineMarker;
  creating: boolean;
  identity: SessionIdentity;
  sequenceId: string;
  dirty(): boolean;
  request(): MarkerEditRequest;
  update(identity: SessionIdentity, marker?: TimelineMarker): void;
};
const equalMarker = (a: TimelineMarker | undefined, b: TimelineMarker) => !!a &&
  a.id === b.id && Object.is(a.time, b.time) && Object.is(a.duration, b.duration) &&
  a.name === b.name && a.note === b.note && a.color === b.color;

/** The parent Session owns all mutations, save and undo; this module holds only view/form state. */
export class EditorMarkers {
  private root = element("section");
  private selectedId?: string;
  private draft?: TimelineMarker;
  private signature = "";
  private renderedIdentity?: SessionIdentity;
  private renderedSequence?: string;
  private pending = false;
  private disposed = false;
  private error = "";
  private page = 0;
  private formState?: MarkerForm;
  private shortcutKeyHeld = false;
  constructor(
    container: HTMLElement,
    private readonly context: EditorMarkersContext,
  ) {
    this.root.className = "editor-markers";
    this.root.setAttribute("aria-label", "标记与范围");
    this.root.addEventListener("keydown", (event) => {
      if (this.shortcutKeyHeld && event.repeat && !event.isComposing &&
        event.key.toLowerCase() === "m" && !event.ctrlKey && !event.metaKey && !event.altKey)
        event.preventDefault();
    });
    window.addEventListener("keyup", this.releaseShortcutKey);
    window.addEventListener("blur", this.releaseShortcutKey);
    container.append(this.root);
    this.render();
  }
  get selected(): string | undefined {
    return this.selectedId;
  }
  private sequence() {
    return this.context.read().sequences.find((s) => s.id === this.context.selection().sequenceId)!;
  }
  private report(error: unknown) {
    this.error = error instanceof Error ? error.message : String(error);
    this.context.onError(error);
  }
  private button(text: string, action: () => void, disabled = false) {
    const button = element("button", text);
    button.type = "button";
    button.disabled = disabled || this.pending;
    const identity = this.context.identity(),
      sequenceId = this.context.selection().sequenceId;
    button.addEventListener("click", () => {
      if (
        !this.disposed &&
        !this.pending &&
        !button.disabled &&
        this.root.contains(button) &&
        sameIdentity(identity, this.context.identity(), false) &&
        sequenceId === this.context.selection().sequenceId
      )
        action();
    });
    return button;
  }
  begin(kind: "point" | "range" = "point"): void {
    this.beginDraft(kind, false);
  }
  /** Keyboard creation never replaces a retained form or invents an unselected range. */
  beginShortcut(kind: "point" | "range"): void {
    this.beginDraft(kind, true);
  }
  private releaseShortcutKey = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || event.key.toLowerCase() === "m")
      this.shortcutKeyHeld = false;
  };
  private beginDraft(kind: "point" | "range", shortcut: boolean): void {
    if (this.pending || this.disposed) return;
    const owner = this.formState, previousDraft = this.draft, previousSelected = this.selectedId,
      identity = this.context.identity(), selection = this.context.selection(),
      clock = this.context.time(), document = this.context.read(),
      currentSelection = this.context.selection(), currentTime = this.context.time(),
      currentIdentity = this.context.identity();
    if (this.pending || this.disposed || this.formState !== owner || this.draft !== previousDraft ||
      this.selectedId !== previousSelected || !sameIdentity(identity, currentIdentity) ||
      document.id !== identity.documentId || document.revision !== identity.revision ||
      selection.sequenceId !== currentSelection.sequenceId || clock !== currentTime ||
      JSON.stringify(selection.clipIds) !== JSON.stringify(currentSelection.clipIds)) return;
    const sequence = document.sequences.find((item) => item.id === selection.sequenceId);
    if (!sequence) return;
    const clips = sequence.clips.filter((clip) => selection.clipIds.includes(clip.id));
    if (shortcut) {
      const retained = this.formState && this.formOwned(this.formState, identity, sequence.id) && this.formState.dirty();
      if (retained || (kind === "range" && !clips.length)) {
        this.error = retained ? "已有未保存的标记草稿，请先保存或取消；快捷键不会覆盖草稿。"
          : "请先在时间轴选择片段，再按 Shift+M 创建范围草稿。";
        const notice = this.root.querySelector(".emarker-error");
        if (notice) notice.textContent = this.error;
        return;
      }
    }
    const time =
      kind === "range" && clips.length
        ? Math.min(...clips.map((clip) => clip.start))
        : clock;
    const end =
      kind === "range"
        ? clips.length
          ? Math.max(...clips.map((clip) => clip.start + clip.duration))
          : Math.min(MAX_EDITOR_TICK, time + 240000)
        : time;
    this.selectedId = undefined;
    const draft = this.draft = {
      id: `marker-${randomId()}`,
      time,
      duration: end - time,
      name: kind === "range" ? "新范围" : "新标记",
      note: "",
      color: "#e5c879",
    };
    this.error = "";
    this.context.onSelection(undefined);
    this.signature = "";
    this.render();
    const form = this.formState, afterSelection = this.context.selection(), afterIdentity = this.context.identity();
    if (this.disposed || this.draft !== draft || this.formState !== form || !form?.node.isConnected ||
      !sameIdentity(identity, afterIdentity) || selection.sequenceId !== afterSelection.sequenceId) return;
    if (shortcut && kind === "range") this.formState?.node.append(element("p", "范围覆盖所选片段的最早开始至最晚结束，包含中间空隙；保存后才会添加标记。"));
    this.shortcutKeyHeld = shortcut;
    this.root.querySelector<HTMLInputElement>('[aria-label="标记名称"]')?.focus();
  }
  select(markerId: string): void {
    if (this.pending || this.disposed) return;
    const identity = this.context.identity(),
      sequenceId = this.context.selection().sequenceId;
    const marker = this.sequence().markers.find((m) => m.id === markerId);
    if (!marker) return;
    // Keep the connected form and native IME when only navigating the current marker.
    const reselecting = this.selectedId === markerId && !this.draft &&
      this.renderedIdentity && sameIdentity(this.renderedIdentity, identity) &&
      this.renderedSequence === sequenceId;
    if (!reselecting) {
      this.selectedId = markerId;
      this.draft = undefined;
      this.error = "";
    }
    this.context.onSelection(markerId);
    if (!reselecting) {
      this.signature = "";
      this.render();
    }
    if (this.disposed || !sameIdentity(identity, this.context.identity()) ||
      sequenceId !== this.context.selection().sequenceId || this.selectedId !== markerId) return;
    const report = (error: unknown) => {
      if (
        !this.disposed &&
        sameIdentity(identity, this.context.identity(), false) &&
        sequenceId === this.context.selection().sequenceId
      )
        this.report(error);
    };
    try {
      void Promise.resolve(this.context.seek(marker.time)).catch(report);
    } catch (error) {
      report(error);
    }
  }
  private formOwned(state: MarkerForm, identity: SessionIdentity, sequenceId: string): boolean {
    return !this.disposed && this.formState === state &&
      this.root.contains(state.node) &&
      sameIdentity(state.identity, identity, false) && state.sequenceId === sequenceId &&
      (state.creating ? this.draft?.id === state.baseline.id : !this.draft && this.selectedId === state.baseline.id);
  }
  private async commit(request: MarkerEditRequest, identity: SessionIdentity, sequenceId: string,
    rebased?: MarkerForm) {
    if (this.pending || this.disposed) return;
    const owner = this.formState;
    try {
      if (
        !sameIdentity(identity, this.context.identity()) ||
        sequenceId !== this.context.selection().sequenceId
      )
        throw new Error("工程已变化，请重新选择标记后重试");
      if (
        request.action === "add"
          ? this.draft?.id !== request.marker.id
          : this.selectedId !== request.markerId
      )
        throw new Error("标记选择已变化，请重新选择后编辑");
      const document = this.context.read(), sequence = document.sequences.find((seq) => seq.id === sequenceId);
      if (rebased) {
        if (!this.formOwned(rebased, identity, sequenceId)) throw new Error("标记草稿已变化，请重新操作");
        const marker = sequence?.markers.find((marker) => marker.id === rebased.baseline.id);
        if (rebased.creating ? !!marker : !equalMarker(marker, rebased.baseline))
          throw new Error(marker ? "标记已被其他编辑修改，草稿已保留，请载入最新后重新编辑" : "标记已删除，草稿已保留，不能覆盖或重新添加");
      }
      const plan = planMarkerEdit(document, sequenceId, request);
      if (document.id !== identity.documentId || document.revision !== identity.revision ||
        !sameIdentity(identity, this.context.identity()) || sequenceId !== this.context.selection().sequenceId)
        throw new Error("工程已变化，请重新选择标记后重试");
      if (!owner || !this.formOwned(owner, identity, sequenceId))
        throw new Error("标记选择已变化，请重新选择后编辑");
      this.pending = true;
      this.error = "";
      this.root
        .querySelectorAll("button,input,textarea,select")
        .forEach((control) => ((control as HTMLInputElement).disabled = true));
      await this.context.apply(
        plan.operations,
        request.action === "add"
          ? "添加标记"
          : request.action === "update"
            ? "更新标记"
            : "删除标记",
      );
      if (this.disposed) return;
      const current = this.context.identity();
      if (!sameIdentity(current, identity, false) || sequenceId !== this.context.selection().sequenceId)
        return;
      this.draft = undefined;
      this.selectedId = request.action === "remove" ? undefined : plan.markerId;
      this.formState = undefined;
      this.context.onSelection(this.selectedId);
    } catch (error) {
      if (
        !this.disposed &&
        sameIdentity(identity, this.context.identity(), false) &&
        sequenceId === this.context.selection().sequenceId
      )
        this.report(error);
    } finally {
      this.pending = false;
      if (!this.disposed) {
        this.signature = "";
        this.render();
      }
    }
  }
  render(): void {
    if (this.disposed) return;
    const identity = this.context.identity(),
      seq = this.sequence();
    const signature = `${identity.documentId}:${identity.generation}:${identity.revision}:${seq.id}:${this.selectedId}:${this.draft?.id}:${this.page}`;
    if (signature === this.signature) return;
    const state = this.formState, preserve = state && this.formOwned(state, identity, seq.id) &&
      (this.pending || state.dirty());
    // A new document generation or sequence ends ownership. An ordinary revision retains
    // the connected dirty form, but never silently changes its captured submit identity.
    if (
      this.renderedIdentity &&
      (!sameIdentity(this.renderedIdentity, identity) || this.renderedSequence !== seq.id)
    ) {
      if (!preserve) this.draft = undefined;
      if (!sameIdentity(this.renderedIdentity, identity, false) || this.renderedSequence !== seq.id) {
        this.selectedId = undefined;
        this.formState = undefined;
      }
    }
    this.renderedIdentity = { ...identity };
    this.renderedSequence = seq.id;
    if (!preserve && this.selectedId && !seq.markers.some((marker) => marker.id === this.selectedId)) {
      this.selectedId = undefined;
      this.context.onSelection(undefined);
    }
    this.signature = signature;
    const view = element("div");
    view.append(element("h3", "标记与范围"));
    const tools = element("div");
    tools.className = "emarker-tools";
    tools.append(
      this.button("添加点标记", () => this.begin("point")),
      this.button("添加范围", () => this.begin("range")),
    );
    view.append(tools);
    const ordered = [...seq.markers].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    this.page = Math.min(this.page, Math.max(0, Math.ceil(ordered.length / 30) - 1));
    const list = element("div");
    list.className = "emarker-list";
    for (const marker of ordered.slice(this.page * 30, (this.page + 1) * 30)) {
      const button = this.button(
        `${marker.duration ? "范围" : "点"} · ${marker.name} · ${seconds(marker.time)}${marker.duration ? ` — ${seconds(marker.time + marker.duration)}` : ""} 秒`,
        () => this.select(marker.id),
      );
      button.dataset.emarkerId = marker.id;
      button.setAttribute("aria-pressed", String(this.selectedId === marker.id));
      button.style.borderLeftColor = marker.color;
      list.append(button);
    }
    view.append(list);
    if (ordered.length > 30) {
      const pages = element("div");
      pages.className = "emarker-tools";
      pages.append(
        this.button(
          "上一页标记",
          () => {
            this.page--;
            this.render();
          },
          this.page === 0,
        ),
        element(
          "span",
          `${this.page + 1}/${Math.ceil(ordered.length / 30)} · 共 ${ordered.length} 项`,
        ),
        this.button(
          "下一页标记",
          () => {
            this.page++;
            this.render();
          },
          (this.page + 1) * 30 >= ordered.length,
        ),
      );
      view.append(pages);
    }
    const marker = this.draft ?? seq.markers.find((m) => m.id === this.selectedId);
    if (preserve) {
      // Leave the form attached throughout; moving it through replaceChildren ends native IME.
      for (const child of [...this.root.children]) if (child !== state.node) child.remove();
      this.root.insertBefore(view, state.node);
      state.update(identity, seq.markers.find((marker) => marker.id === state.baseline.id));
    } else {
      this.formState = undefined;
      this.root.replaceChildren(view);
      if (marker) this.form(marker, !!this.draft, identity, seq.id);
      else this.root.append(element("p", "选择时间轴标记可定位并编辑；范围结束位置不包含在范围内。"));
    }
    const error = element("p", this.error);
    error.className = "emarker-error";
    error.setAttribute("role", "alert");
    this.root.append(error);
  }
  private form(
    marker: TimelineMarker,
    creating: boolean,
    identity: SessionIdentity,
    sequenceId: string,
  ) {
    const owns = () =>
      !this.disposed && sameIdentity(identity, this.context.identity(), false) &&
      sequenceId === this.context.selection().sequenceId;
    const form = element("form");
    form.className = "emarker-form";
    const kind = element("select");
    for (const [value, text] of [
      ["point", "点标记"],
      ["range", "范围标记"],
    ]) {
      const option = element("option", text);
      option.value = value!;
      kind.append(option);
    }
    kind.value = marker.duration ? "range" : "point";
    const name = element("input");
    name.value = marker.name;
    name.required = true;
    name.maxLength = 200;
    const note = element("textarea");
    note.value = marker.note;
    note.maxLength = 10000;
    note.rows = 3;
    // Text color accepts every schema-supported hex color without silently dropping alpha.
    const color = element("input");
    color.value = marker.color;
    color.required = true;
    const picker = element("input");
    picker.type = "color";
    picker.setAttribute("aria-label", "选择标记颜色");
    const expandedColor = (value: string) =>
      /^#[0-9a-f]{3,4}$/i.test(value)
        ? "#" + [...value.slice(1)].map((char) => char + char).join("")
        : value;
    const initialColor = expandedColor(marker.color);
    picker.value = /^#[0-9a-f]{6,8}$/i.test(initialColor) ? initialColor.slice(0, 7) : "#000000";
    picker.addEventListener("input", () => {
      const previous = expandedColor(color.value);
      color.value = picker.value + (/^#[0-9a-f]{8}$/i.test(previous) ? previous.slice(7) : "");
    });
    color.addEventListener("input", () => {
      const expanded = expandedColor(color.value);
      if (/^#[0-9a-f]{6,8}$/i.test(expanded)) picker.value = expanded.slice(0, 7);
    });
    const colorRow = element("div");
    colorRow.className = "emarker-color";
    colorRow.append(field("标记颜色", color), picker);
    const start = element("input"),
      end = element("input");
    for (const input of [start, end]) {
      input.type = "number";
      input.min = "0";
      input.max = "86400";
      input.step = "any";
      input.required = true;
    }
    start.value = seconds(marker.time);
    end.value = seconds(marker.time + marker.duration);
    const originalStart = start.value,
      originalEnd = end.value;
    end.disabled = kind.value === "point";
    kind.addEventListener("change", () => {
      end.disabled = kind.value === "point";
      if (!end.disabled && Number(end.value) <= Number(start.value))
        end.value = String(Math.min(86400, Number(start.value) + 1));
    });
    const readTime = (input: HTMLInputElement, original: string, ticks: Tick) => {
      if (!input.value.trim() || !Number.isFinite(input.valueAsNumber))
        throw new Error("请输入有效时间");
      return input.value === original ? ticks : secondsToTicks(input.valueAsNumber);
    };
    form.append(
      field("标记类型", kind),
      field("标记名称", name),
      field("开始（秒）", start),
      field("结束（秒）", end),
      colorRow,
      field("标记备注", note),
    );
    const footer = element("div");
    footer.className = "emarker-tools";
    const save = element("button", creating ? "添加标记" : "保存标记");
    save.type = "submit";
    footer.append(save);
    const navigation: HTMLButtonElement[] = [];
    let remove: HTMLButtonElement | undefined;
    if (!creating) {
      navigation.push(this.button("定位开始", () => this.select(marker.id)));
      if (marker.duration)
        navigation.push(this.button("定位结束", () => {
          try {
            void Promise.resolve(this.context.seek(marker.time + marker.duration)).catch(
              (error) => { if (owns()) this.report(error); },
            );
          } catch (error) { if (owns()) this.report(error); }
        }));
      remove = this.button("删除标记",
        () => void this.commit({ action: "remove", markerId: marker.id }, identity, sequenceId));
      footer.append(
        ...navigation,
        remove,
      );
    } else
      footer.append(
        this.button("取消添加", () => {
          this.draft = undefined;
          this.signature = "";
          this.render();
        }),
      );
    const notice = element("p"), updates = element("div");
    notice.setAttribute("role", "status");
    updates.className = "emarker-tools";
    notice.hidden = updates.hidden = true;
    form.append(notice, updates, footer);
    const request = (): MarkerEditRequest => {
      const time = readTime(start, originalStart, marker.time);
      const stop = kind.value === "point" ? time : readTime(end, originalEnd, marker.time + marker.duration);
      if (kind.value === "range" && stop <= time) throw new Error("范围结束必须晚于开始");
      const patch = { time, duration: stop - time, name: name.value, note: note.value, color: color.value };
      return creating ? { action: "add", marker: { id: marker.id, ...patch } }
        : { action: "update", markerId: marker.id, patch };
    };
    const values = () => JSON.stringify([kind.value, name.value, start.value, end.value, color.value, note.value]),
      initial = values();
    let composing = false;
    form.addEventListener("compositionstart", () => { composing = true; });
    form.addEventListener("compositionend", () => { composing = false; });
    const state: MarkerForm = {
      node: form, baseline: { ...marker }, creating, identity: { ...identity }, sequenceId,
      dirty: () => creating || composing || values() !== initial,
      request,
      update: (currentIdentity, currentMarker) => {
        const stale = !sameIdentity(identity, currentIdentity),
          conflict = creating ? !!currentMarker : !equalMarker(currentMarker, state.baseline);
        for (const control of [kind, name, start, end, color, picker, note])
          control.disabled = this.pending || (control === end && kind.value === "point");
        for (const button of footer.querySelectorAll<HTMLButtonElement>("button")) button.disabled = this.pending;
        save.disabled = this.pending || stale;
        if (remove) remove.disabled = this.pending || stale;
        for (const button of navigation) button.disabled = this.pending || conflict;
        notice.hidden = updates.hidden = !stale;
        updates.replaceChildren();
        if (!stale) return;
        notice.textContent = conflict
          ? creating ? "同一标记 ID 已存在，草稿已保留，不能覆盖。请载入最新。"
            : currentMarker ? "标记已被其他编辑修改，草稿已保留。请载入最新后重新编辑。"
              : "标记已删除，草稿已保留，不能覆盖或重新添加。"
          : "工程已更新，草稿已保留。请明确选择载入最新或保存当前草稿。";
        updates.append(
          this.button("载入最新（放弃草稿）", () => {
            if (!this.formOwned(state, this.context.identity(), this.context.selection().sequenceId)) return;
            this.formState = undefined;
            this.draft = undefined;
            this.error = "";
            this.signature = "";
            this.render();
          }),
          this.button("保存当前草稿", () => {
            if (!this.formOwned(state, this.context.identity(), this.context.selection().sequenceId)) return;
            try { void this.commit(state.request(), { ...this.context.identity() }, sequenceId, state); }
            catch (error) { this.report(error); this.signature = ""; this.render(); }
          }, conflict),
        );
      },
    };
    this.formState = state;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (
        this.disposed ||
        !sameIdentity(identity, this.context.identity(), false) ||
        sequenceId !== this.context.selection().sequenceId
      )
        return;
      try {
        if (!this.formOwned(state, this.context.identity(), sequenceId))
          throw new Error("标记选择已变化，请重新选择后编辑");
        void this.commit(request(), identity, sequenceId);
      } catch (error) {
        this.report(error);
        this.root.querySelector(".emarker-error")!.textContent = this.error;
      }
    });
    this.root.append(form);
    state.update(identity, creating ? undefined : marker);
  }
  dispose(): void {
    this.disposed = true;
    window.removeEventListener("keyup", this.releaseShortcutKey);
    window.removeEventListener("blur", this.releaseShortcutKey);
    this.formState = undefined;
    this.root.remove();
  }
}
