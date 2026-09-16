import { planMarkerEdit, type MarkerEditRequest } from "./marker-edits";
import type { EditorOperation } from "./operations";
import type { SessionIdentity } from "./session";
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
const sameIdentity = (a: SessionIdentity, b: SessionIdentity) =>
  a.documentId === b.documentId && a.generation === b.generation && a.revision === b.revision;
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
  constructor(
    container: HTMLElement,
    private readonly context: EditorMarkersContext,
  ) {
    this.root.className = "editor-markers";
    this.root.setAttribute("aria-label", "标记与范围");
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
    button.addEventListener("click", action);
    return button;
  }
  begin(kind: "point" | "range" = "point"): void {
    if (this.pending || this.disposed) return;
    const selection = this.context.selection();
    const clips = this.sequence().clips.filter((clip) => selection.clipIds.includes(clip.id));
    const time =
      kind === "range" && clips.length
        ? Math.min(...clips.map((clip) => clip.start))
        : this.context.time();
    const end =
      kind === "range"
        ? clips.length
          ? Math.max(...clips.map((clip) => clip.start + clip.duration))
          : Math.min(MAX_EDITOR_TICK, time + 240000)
        : time;
    this.selectedId = undefined;
    this.draft = {
      id: `marker-${crypto.randomUUID()}`,
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
    this.root.querySelector<HTMLInputElement>('[aria-label="标记名称"]')?.focus();
  }
  select(markerId: string): void {
    if (this.pending || this.disposed) return;
    const marker = this.sequence().markers.find((m) => m.id === markerId);
    if (!marker) return;
    this.selectedId = markerId;
    this.draft = undefined;
    this.error = "";
    this.context.onSelection(markerId);
    this.signature = "";
    this.render();
    try {
      void Promise.resolve(this.context.seek(marker.time)).catch((error) => this.report(error));
    } catch (error) {
      this.report(error);
    }
  }
  private async commit(request: MarkerEditRequest, identity: SessionIdentity, sequenceId: string) {
    if (this.pending || this.disposed) return;
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
      const plan = planMarkerEdit(this.context.read(), sequenceId, request);
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
      if (
        current.documentId !== identity.documentId ||
        current.generation !== identity.generation ||
        sequenceId !== this.context.selection().sequenceId
      )
        return;
      this.draft = undefined;
      this.selectedId = request.action === "remove" ? undefined : plan.markerId;
      this.context.onSelection(this.selectedId);
    } catch (error) {
      if (!this.disposed) this.report(error);
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
    // Any external document change invalidates an unsaved form. Its captured identity also rejects detached submits.
    if (
      this.renderedIdentity &&
      (!sameIdentity(this.renderedIdentity, identity) || this.renderedSequence !== seq.id)
    ) {
      this.draft = undefined;
      if (
        this.renderedIdentity.documentId !== identity.documentId ||
        this.renderedIdentity.generation !== identity.generation ||
        this.renderedSequence !== seq.id
      )
        this.selectedId = undefined;
    }
    this.renderedIdentity = { ...identity };
    this.renderedSequence = seq.id;
    if (this.selectedId && !seq.markers.some((marker) => marker.id === this.selectedId)) {
      this.selectedId = undefined;
      this.context.onSelection(undefined);
    }
    this.signature = signature;
    this.root.replaceChildren(element("h3", "标记与范围"));
    const tools = element("div");
    tools.className = "emarker-tools";
    tools.append(
      this.button("添加点标记", () => this.begin("point")),
      this.button("添加范围", () => this.begin("range")),
    );
    this.root.append(tools);
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
    this.root.append(list);
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
      this.root.append(pages);
    }
    const marker = this.draft ?? seq.markers.find((m) => m.id === this.selectedId);
    if (marker) this.form(marker, !!this.draft, identity, seq.id);
    else this.root.append(element("p", "选择时间轴标记可定位并编辑；范围结束位置不包含在范围内。"));
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
    if (!creating)
      footer.append(
        this.button("定位开始", () => this.select(marker.id)),
        ...(marker.duration
          ? [
              this.button("定位结束", () => {
                try {
                  void Promise.resolve(this.context.seek(marker.time + marker.duration)).catch(
                    (error) => this.report(error),
                  );
                } catch (error) {
                  this.report(error);
                }
              }),
            ]
          : []),
        this.button(
          "删除标记",
          () => void this.commit({ action: "remove", markerId: marker.id }, identity, sequenceId),
        ),
      );
    else
      footer.append(
        this.button("取消添加", () => {
          this.draft = undefined;
          this.signature = "";
          this.render();
        }),
      );
    form.append(footer);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const time = readTime(start, originalStart, marker.time);
        const stop =
          kind.value === "point" ? time : readTime(end, originalEnd, marker.time + marker.duration);
        if (kind.value === "range" && stop <= time) throw new Error("范围结束必须晚于开始");
        const patch = {
          time,
          duration: stop - time,
          name: name.value,
          note: note.value,
          color: color.value,
        };
        void this.commit(
          creating
            ? { action: "add", marker: { id: marker.id, ...patch } }
            : { action: "update", markerId: marker.id, patch },
          identity,
          sequenceId,
        );
      } catch (error) {
        this.report(error);
        this.root.querySelector(".emarker-error")!.textContent = this.error;
      }
    });
    this.root.append(form);
  }
  dispose(): void {
    this.disposed = true;
    this.root.remove();
  }
}
