import {
  evaluateAnimatedNumber,
  type AnimatedNumber,
  type Easing,
  type Keyframe,
} from "./animation";
import { TICKS_PER_SECOND, type Tick } from "./time";
import { planCaptionText } from "./captions";
import { unavailableFontFamilies, fontWarningMessage } from "./font-availability";
import type { EditorClipPatch, EditorOperation } from "./operations";
import type { EditorClip, EditorDocument, EditorSequence, Mask } from "./types";

export interface EditorInspectorContext {
  read(): EditorDocument;
  selection(): { sequenceId: string; clipIds: string[] };
  apply(operations: EditorOperation[], label: string): unknown | Promise<unknown>;
  time(): Tick;
  onError(error: Error): void;
}
interface Scope {
  revision: number;
  sequence: EditorSequence;
  selectionIds: string[];
  clips: EditorClip[];
}
type Path = Array<string | number>;
interface NumberField {
  label: string;
  path: Path;
  min: number;
  max: number;
  factor?: number;
  step?: number;
  animated?: boolean;
  integer?: boolean;
}
type Tab = "visual" | "color" | "mask" | "text" | "audio";
const TABS: Array<[Tab, string]> = [
  ["visual", "画面"],
  ["color", "调色"],
  ["mask", "蒙版"],
  ["text", "文字"],
  ["audio", "音频"],
];
const EASINGS: Array<[string, string]> = [
  ["linear", "匀速"],
  ["hold", "保持"],
  ["ease-in", "缓入"],
  ["ease-out", "缓出"],
  ["ease-in-out", "缓入缓出"],
  ["cubic-bezier", "自定义曲线"],
];
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function at(value: unknown, path: Path): any {
  for (const key of path) value = (value as Record<string | number, unknown>)[key];
  return value;
}
/** Paths are fixed by this component; only the containing top-level property is replaced. */
function patchAt(clip: EditorClip, path: Path, value: unknown): EditorClipPatch {
  const head = path[0]!;
  if (path.length === 1) return { [head]: value } as EditorClipPatch;
  const root = structuredClone(at(clip, [head]));
  const parent = at(root, path.slice(1, -1));
  parent[path.at(-1)!] = value;
  return { [head]: root } as EditorClipPatch;
}
function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function common<T>(values: T[]): T | undefined {
  return values.every((value) => equal(value, values[0])) ? values[0] : undefined;
}
function localTime(clip: EditorClip, time: Tick): Tick {
  return Math.max(0, Math.min(clip.duration, Math.round(time - clip.start)));
}
function replaceKey(value: AnimatedNumber, time: Tick, number: number): AnimatedNumber {
  if (typeof value === "number") return number;
  const keyframes = structuredClone(value.keyframes);
  const existing = keyframes.find((key) => key.time === time);
  if (existing) existing.value = number;
  else keyframes.push({ time, value: number, easing: "linear" });
  keyframes.sort((a, b) => a.time - b.time);
  return { keyframes };
}
function display(value: number): string {
  return String(Number(value.toFixed(6)));
}
function defaultMask(kind: Mask["kind"]): Mask {
  return {
    kind,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    feather: 0,
    inverted: false,
    ...(kind === "path"
      ? {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
        }
      : {}),
  };
}

/** Mount with public/editor-inspector.css. Parent sessions own persistence, preview and undo. */
export class EditorInspector {
  private readonly root = el("section", "editor-inspector");
  private tab: Tab = "visual";
  private pending = false;
  private disposed = false;
  private error = "";
  private expanded = new Map<string, boolean>();
  private individuals = new Map<string, string>();
  private pages = new Map<string, number>();
  private renderedSignature = "";
  constructor(
    container: HTMLElement,
    private readonly context: EditorInspectorContext,
  ) {
    this.root.setAttribute("aria-label", "片段属性");
    container.append(this.root);
    this.render();
  }
  dispose(): void {
    this.disposed = true;
    this.root.remove();
    this.expanded.clear();
    this.individuals.clear();
    this.pages.clear();
  }
  private scope(): Scope | undefined {
    const selection = this.context.selection();
    const document = this.context.read();
    const sequence = document.sequences.find((item) => item.id === selection.sequenceId);
    if (!sequence) return;
    const selectionIds = [...new Set(selection.clipIds)];
    const clips = selectionIds
      .map((id) => sequence.clips.find((clip) => clip.id === id))
      .filter((clip): clip is EditorClip => !!clip);
    return { revision: document.revision, sequence, selectionIds, clips };
  }
  private locked(scope: Scope): boolean {
    return scope.selectionIds.some((id) => {
      const clip = scope.sequence.clips.find((item) => item.id === id);
      return (
        !clip || scope.sequence.tracks.find((track) => track.id === clip.trackId)?.locked !== false
      );
    });
  }
  private report(error: unknown): void {
    const result = error instanceof Error ? error : new Error(String(error));
    this.error = result.message;
    this.context.onError(result);
  }
  private async edit(
    scope: Scope,
    label: string,
    patch: (clip: EditorClip) => EditorClipPatch,
  ): Promise<void> {
    if (this.disposed || this.pending) return;
    try {
      const fresh = this.scope();
      if (
        !fresh ||
        fresh.sequence.id !== scope.sequence.id ||
        !equal(fresh.selectionIds, scope.selectionIds)
      )
        throw new Error("选择已变化，请重新调整属性");
      if (this.locked(fresh)) throw new Error("所选片段包含已锁定轨道，请先解锁轨道");
      const operations: EditorOperation[] = scope.clips.map((clip) => {
        const current = fresh.clips.find((item) => item.id === clip.id);
        if (!current || current.kind !== clip.kind) throw new Error("片段已变化，请重新选择");
        return {
          type: "clip.update",
          sequenceId: fresh.sequence.id,
          clipId: current.id,
          patch: patch(current),
        };
      });
      if (!operations.length) return;
      this.pending = true;
      this.error = "";
      this.render();
      await this.context.apply(operations, label);
    } catch (error) {
      this.report(error);
    } finally {
      this.pending = false;
      this.render();
    }
  }
  private action(
    parent: HTMLElement,
    text: string,
    run: () => void,
    disabled = false,
  ): HTMLButtonElement {
    const button = el("button", "ei-button", text);
    button.type = "button";
    button.disabled = disabled;
    button.addEventListener("click", () => {
      if (this.disposed || this.pending) return;
      try {
        run();
      } catch (error) {
        this.report(error);
        this.render();
      }
    });
    parent.append(button);
    return button;
  }
  private section(parent: HTMLElement, title: string, hint?: string): HTMLElement {
    const section = el("section", "ei-section");
    section.append(el("h3", "ei-section-title", title));
    if (hint) section.append(el("p", "ei-hint", hint));
    parent.append(section);
    return section;
  }
  private details(parent: HTMLElement, title: string, key: string): HTMLDetailsElement {
    const details = el("details", "ei-details");
    details.dataset.stateKey = key;
    details.open = this.expanded.get(key) ?? false;
    details.append(el("summary", "", title));
    details.addEventListener("toggle", () => {
      if (details.isConnected) this.expanded.set(key, details.open);
    });
    parent.append(details);
    return details;
  }
  private inputRow(parent: HTMLElement, label: string, control: HTMLElement): HTMLElement {
    const row = el("label", "ei-field");
    row.append(el("span", "ei-label", label), control);
    control.setAttribute("aria-label", label);
    parent.append(row);
    return row;
  }
  private numberInput(
    parent: HTMLElement,
    label: string,
    value: number | undefined,
    min: number,
    max: number,
    step: number,
    change: (value: number) => void,
    disabled = false,
  ): HTMLInputElement {
    const input = el("input", "ei-input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = value === undefined ? "" : display(value);
    input.placeholder = value === undefined ? "多个值" : "";
    input.disabled = disabled;
    input.addEventListener("change", () => {
      try {
        if (input.value.trim() === "" || !Number.isFinite(input.valueAsNumber))
          throw new Error(`${label}需要填写数值`);
        if (input.valueAsNumber < min || input.valueAsNumber > max)
          throw new Error(`${label}须在 ${min} 至 ${max} 之间`);
        change(input.valueAsNumber);
      } catch (error) {
        this.report(error);
        this.render();
      }
    });
    this.inputRow(parent, label, input);
    return input;
  }
  private selectInput(
    parent: HTMLElement,
    label: string,
    value: string | undefined,
    choices: Array<[string, string]>,
    change: (value: string) => void,
  ): HTMLSelectElement {
    const input = el("select", "ei-input");
    if (value === undefined) {
      const option = el("option", "", "多个值");
      option.value = "";
      option.disabled = true;
      input.append(option);
    }
    for (const [key, text] of choices) {
      const option = el("option", "", text);
      option.value = key;
      input.append(option);
    }
    input.value = value ?? "";
    input.addEventListener("change", () => {
      try {
        change(input.value);
      } catch (error) {
        this.report(error);
        this.render();
      }
    });
    this.inputRow(parent, label, input);
    return input;
  }
  private check(
    parent: HTMLElement,
    label: string,
    value: boolean | undefined,
    change: (value: boolean) => void,
  ): HTMLInputElement {
    const input = el("input", "ei-check");
    input.type = "checkbox";
    input.checked = value === true;
    input.indeterminate = value === undefined;
    input.addEventListener("change", () => {
      change(input.checked);
    });
    this.inputRow(parent, label, input);
    return input;
  }
  private plain(
    parent: HTMLElement,
    scope: Scope,
    label: string,
    path: Path,
    multiline = false,
  ): void {
    const input = multiline ? el("textarea", "ei-input ei-textarea") : el("input", "ei-input");
    const value = common(scope.clips.map((clip) => String(at(clip, path))));
    input.value = value ?? "";
    input.placeholder = value === undefined ? "多个值" : "";
    if (input instanceof HTMLTextAreaElement) input.rows = 3;
    input.addEventListener("change", () => {
      void this.edit(scope, `修改${label}`, (clip) =>
        this.fieldPatch(scope, clip, path, input.value),
      );
    });
    this.inputRow(parent, label, input);
  }
  private choice(
    parent: HTMLElement,
    scope: Scope,
    label: string,
    path: Path,
    choices: Array<[string, string]>,
  ): void {
    this.selectInput(
      parent,
      label,
      common(scope.clips.map((clip) => at(clip, path))),
      choices,
      (value) => {
        void this.edit(scope, `修改${label}`, (clip) => this.fieldPatch(scope, clip, path, value));
      },
    );
  }
  private boolean(parent: HTMLElement, scope: Scope, label: string, path: Path): void {
    this.check(parent, label, common(scope.clips.map((clip) => at(clip, path))), (value) => {
      void this.edit(scope, `修改${label}`, (clip) => this.fieldPatch(scope, clip, path, value));
    });
  }
  private fieldPatch(scope: Scope, clip: EditorClip, path: Path, value: unknown): EditorClipPatch {
    if (path.length === 1 && path[0] === "text" && clip.kind === "text" && value !== clip.text) {
      if (clip.role === "subtitle") {
        const operation = planCaptionText(
          this.context.read(),
          scope.sequence.id,
          clip.id,
          String(value),
        )[0];
        if (!operation || operation.type !== "clip.update")
          throw new Error("字幕内容已变化，请重新编辑");
        return operation.patch;
      }
      // Timed words and translation belong to the previous wording, even for a title.
      return {
        text: String(value),
        words: [],
        translation: null,
        style: {
          ...clip.style,
          animation: clip.style.animation === "word-highlight" ? "none" : clip.style.animation,
        },
      };
    }
    // Array entries have no stable IDs. An external insert must not redirect an
    // old form row to a different word, mask point or HSL band.
    const index = path.findIndex((key) => typeof key === "number");
    if (index >= 0) {
      const original = scope.clips.find((item) => item.id === clip.id)!;
      const collection = path.slice(0, index);
      if (!equal(at(original, collection), at(clip, collection)))
        throw new Error("列表已变化，请重新编辑这一项");
    }
    return patchAt(clip, path, value);
  }
  private number(parent: HTMLElement, scope: Scope, spec: NumberField): void {
    const factor = spec.factor ?? 1;
    const values = scope.clips.map((clip) => {
      const value = at(clip, spec.path);
      return (
        (spec.animated
          ? evaluateAnimatedNumber(value, localTime(clip, this.context.time()))
          : value) * factor
      );
    });
    const group = el("div", "ei-number");
    parent.append(group);
    this.numberInput(
      group,
      spec.label,
      common(values),
      spec.min * factor,
      spec.max * factor,
      spec.step ?? 0.1,
      (value) => {
        const time = this.context.time();
        void this.edit(scope, `修改${spec.label}`, (clip) => {
          const number = spec.integer ? Math.round(value / factor) : value / factor;
          return this.fieldPatch(
            scope,
            clip,
            spec.path,
            spec.animated ? replaceKey(at(clip, spec.path), localTime(clip, time), number) : number,
          );
        });
      },
    );
    if (spec.animated) {
      const allHere = scope.clips.every((clip) => {
        const value = at(clip, spec.path) as AnimatedNumber;
        return (
          typeof value !== "number" &&
          value.keyframes.some((key) => key.time === localTime(clip, this.context.time()))
        );
      });
      const title = `${allHere ? "移除" : "添加"}${spec.label}当前关键帧`;
      const button = this.action(group, allHere ? "◆" : "◇", () => {
        const now = this.context.time();
        const currentClips = this.scope()?.clips ?? [];
        const remove = scope.clips.every((selected) => {
          const current = currentClips.find((clip) => clip.id === selected.id);
          if (!current) return false;
          const value = at(current, spec.path) as AnimatedNumber;
          return (
            typeof value !== "number" &&
            value.keyframes.some((key) => key.time === localTime(current, now))
          );
        });
        void this.edit(scope, `${remove ? "移除" : "添加"}${spec.label}当前关键帧`, (clip) => {
          const value = at(clip, spec.path) as AnimatedNumber,
            time = localTime(clip, now);
          const current = evaluateAnimatedNumber(value, time);
          const keys = typeof value === "number" ? [] : structuredClone(value.keyframes);
          const keyframes = keys.filter((key) => key.time !== time);
          if (!remove) keyframes.push({ time, value: current, easing: "linear" });
          keyframes.sort((a, b) => a.time - b.time);
          return patchAt(clip, spec.path, keyframes.length ? { keyframes } : current);
        });
      });
      button.classList.add("ei-key-button");
      button.setAttribute("aria-label", title);
      button.title = `${title}；播放头在片段外时使用最近边界`;
      if (scope.clips.some((clip) => typeof at(clip, spec.path) !== "number")) {
        const details = this.details(
          parent,
          `${spec.label} · 关键帧`,
          `keys:${spec.path.join(".")}`,
        );
        this.individual(details, scope, `keys:${spec.path.join(".")}`, (selected) =>
          this.keyframes(details, selected, spec),
        );
      }
    }
  }
  private individual(
    parent: HTMLElement,
    scope: Scope,
    key: string,
    draw: (scope: Scope) => void,
  ): void {
    let id = this.individuals.get(key);
    if (!scope.clips.some((clip) => clip.id === id)) id = scope.clips[0]?.id;
    if (!id) return;
    if (scope.clips.length > 1)
      this.selectInput(
        parent,
        "单独编辑片段",
        id,
        scope.clips.map((clip) => [clip.id, clip.label || "未命名片段"]),
        (value) => {
          this.individuals.set(key, value);
          this.render();
        },
      );
    draw({ ...scope, clips: scope.clips.filter((clip) => clip.id === id) });
  }
  private keyframes(parent: HTMLElement, scope: Scope, spec: NumberField): void {
    const clip = scope.clips[0]!,
      value = at(clip, spec.path) as AnimatedNumber;
    if (typeof value === "number") {
      parent.append(el("p", "ei-hint", "点击菱形按钮，在播放位置添加关键帧。"));
      return;
    }
    const factor = spec.factor ?? 1,
      pageKey = `${clip.id}:${spec.path.join(".")}`;
    const page = Math.min(
      this.pages.get(pageKey) ?? 0,
      Math.floor((value.keyframes.length - 1) / 20),
    );
    const change = (index: number, update: (key: Keyframe) => void) => {
      void this.edit(scope, `修改${spec.label}关键帧`, (current) => {
        const original = at(current, spec.path) as AnimatedNumber;
        if (
          typeof original === "number" ||
          original.keyframes[index]?.time !== value.keyframes[index]?.time
        )
          throw new Error("关键帧已变化，请重新编辑");
        const keyframes = structuredClone(original.keyframes);
        update(keyframes[index]!);
        keyframes.sort((a, b) => a.time - b.time);
        return patchAt(current, spec.path, { keyframes });
      });
    };
    parent.append(el("p", "ei-hint", "时间从片段起点计算；缓动控制它到下一关键帧的变化。"));
    value.keyframes.slice(page * 20, (page + 1) * 20).forEach((key, offset) => {
      const index = page * 20 + offset;
      const row = el("div", "ei-card");
      row.append(el("h4", "", `关键帧 ${index + 1}`));
      parent.append(row);
      this.numberInput(
        row,
        `关键帧 ${index + 1} 时间（秒）`,
        key.time / TICKS_PER_SECOND,
        0,
        clip.duration / TICKS_PER_SECOND,
        0.001,
        (number) =>
          change(index, (frame) => {
            frame.time = Math.round(number * TICKS_PER_SECOND);
          }),
      );
      this.numberInput(
        row,
        `关键帧 ${index + 1} ${spec.label}`,
        key.value * factor,
        spec.min * factor,
        spec.max * factor,
        spec.step ?? 0.1,
        (number) =>
          change(index, (frame) => {
            frame.value = number / factor;
          }),
      );
      this.selectInput(
        row,
        `关键帧 ${index + 1} 缓动`,
        typeof key.easing === "object" ? "cubic-bezier" : (key.easing ?? "linear"),
        EASINGS,
        (easing) =>
          change(index, (frame) => {
            frame.easing =
              easing === "cubic-bezier"
                ? { type: "cubic-bezier", x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }
                : (easing as Easing);
          }),
      );
      if (typeof key.easing === "object") {
        for (const [name, label] of [
          ["x1", "控制点 1 时间"],
          ["y1", "控制点 1 进度"],
          ["x2", "控制点 2 时间"],
          ["y2", "控制点 2 进度"],
        ] as const)
          this.numberInput(
            row,
            `关键帧 ${index + 1} ${label}（%）`,
            key.easing[name] * 100,
            name.startsWith("x") ? 0 : -400,
            name.startsWith("x") ? 100 : 400,
            1,
            (number) =>
              change(index, (frame) => {
                if (typeof frame.easing !== "object") throw new Error("关键帧缓动已变化");
                frame.easing[name] = number / 100;
              }),
          );
      }
      this.preview(
        row,
        Array.from({ length: 41 }, (_, i) => ({
          x: i / 40,
          y: evaluateAnimatedNumber(
            {
              keyframes: [
                { time: 0, value: 0, easing: key.easing },
                { time: TICKS_PER_SECOND, value: 1 },
              ],
            },
            (i * TICKS_PER_SECOND) / 40,
          ),
        })),
        "缓动曲线预览",
      );
      this.action(row, `删除关键帧 ${index + 1}`, () => {
        void this.edit(scope, `删除${spec.label}关键帧`, (current) => {
          const original = at(current, spec.path) as AnimatedNumber;
          if (typeof original === "number" || original.keyframes[index]?.time !== key.time)
            throw new Error("关键帧已变化");
          const keyframes = original.keyframes.filter((_, at) => at !== index);
          return patchAt(
            current,
            spec.path,
            keyframes.length
              ? { keyframes }
              : evaluateAnimatedNumber(original, localTime(current, this.context.time())),
          );
        });
      });
    });
    if (value.keyframes.length > 20) {
      const pages = el("div", "ei-actions");
      parent.append(pages);
      this.action(
        pages,
        "上一页关键帧",
        () => {
          this.pages.set(pageKey, page - 1);
          this.render();
        },
        page === 0,
      );
      pages.append(
        el("span", "ei-hint", `${page + 1} / ${Math.ceil(value.keyframes.length / 20)}`),
      );
      this.action(
        pages,
        "下一页关键帧",
        () => {
          this.pages.set(pageKey, page + 1);
          this.render();
        },
        (page + 1) * 20 >= value.keyframes.length,
      );
    }
  }
  private preview(
    parent: HTMLElement,
    points: Array<{ x: number; y: number }>,
    label: string,
  ): void {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 160 96");
    svg.setAttribute("class", "ei-curve");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute(
      "d",
      points
        .map((point, index) => `${index ? "L" : "M"}${8 + point.x * 144},${88 - point.y * 80}`)
        .join(" "),
    );
    svg.append(path);
    parent.append(svg);
  }
  render(): void {
    if (this.disposed) return;
    const scope = this.scope();
    const signature = JSON.stringify([
      scope?.revision,
      scope?.sequence.id,
      scope?.selectionIds,
      this.tab,
    ]);
    const focused = document.activeElement;
    if (
      !this.pending &&
      !this.error &&
      signature === this.renderedSignature &&
      (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) &&
      this.root.contains(focused) &&
      !focused.disabled
    )
      return; // Playhead refreshes must not erase an in-progress text or number draft.
    this.renderedSignature = signature;
    const scrollTop = this.root.scrollTop;
    // A native details toggle event may still be queued when a form commits.
    // Capture its current state synchronously before rebuilding the controls.
    for (const details of this.root.querySelectorAll<HTMLDetailsElement>("details[data-state-key]"))
      this.expanded.set(details.dataset.stateKey!, details.open);
    this.root.replaceChildren();
    const header = el("header", "ei-header");
    this.root.append(header);
    header.append(
      el("h2", "", "片段属性"),
      el(
        "p",
        "ei-hint",
        scope?.clips.length === 1
          ? scope.clips[0]!.label || "未命名片段"
          : `已选择 ${scope?.clips.length ?? 0} 个片段`,
      ),
    );
    if (!scope?.clips.length) {
      this.root.append(el("p", "ei-empty", "选择时间线中的片段，调整画面、文字与声音。"));
      return;
    }
    const nav = el("div", "ei-tabs");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "属性分类");
    this.root.append(nav);
    for (const [tab, label] of TABS) {
      const button = this.action(nav, label, () => {
        this.tab = tab;
        this.error = "";
        this.render();
      });
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(this.tab === tab));
      button.tabIndex = this.tab === tab ? 0 : -1;
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = TABS.findIndex((item) => item[0] === tab);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
        this.tab = TABS[next]![0];
        this.render();
        this.root.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
      });
    }
    if (this.error) {
      const error = el("p", "ei-error", this.error);
      error.setAttribute("role", "alert");
      this.root.append(error);
    }
    const locked = this.locked(scope);
    if (locked)
      this.root.append(
        el(
          "p",
          "ei-notice",
          "所选片段包含已锁定轨道。解锁后才能编辑；本次选择中的其他片段也不会被单独修改。",
        ),
      );
    if (this.pending) this.root.append(el("p", "ei-hint", "正在应用修改…"));
    const panel = el("fieldset", "ei-panel");
    panel.disabled = locked || this.pending;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-label", TABS.find((item) => item[0] === this.tab)![1]);
    this.root.append(panel);
    if (scope.clips.length > 1)
      panel.append(
        el(
          "p",
          "ei-hint",
          "基础属性批量应用；“多个值”表示各片段不同。曲线、顶点、文字内容和关键帧可逐片段调整。",
        ),
      );
    if (this.tab === "visual") this.visual(panel, scope);
    else if (this.tab === "color") this.color(panel, scope);
    else if (this.tab === "mask") this.mask(panel, scope);
    else if (this.tab === "text") this.text(panel, scope);
    else this.audio(panel, scope);
    this.root.scrollTop = scrollTop;
  }
  private visual(parent: HTMLElement, scope: Scope): void {
    const transform = this.section(
      parent,
      "构图",
      "位置以画布中心为 0%；宽高缩放以原始适配画面为 100%。",
    );
    for (const [name, label, min, max, factor] of [
      ["x", "水平位置（%）", -10, 10, 100],
      ["y", "垂直位置（%）", -10, 10, 100],
      ["scaleX", "水平缩放（%）", 0, 100, 100],
      ["scaleY", "垂直缩放（%）", 0, 100, 100],
      ["rotation", "旋转（度）", -360000, 360000, 1],
      ["opacity", "不透明度（%）", 0, 1, 100],
    ] as const)
      this.number(transform, scope, {
        label,
        path: ["transform", name],
        min,
        max,
        factor,
        animated: true,
      });
    this.boolean(transform, scope, "水平镜像", ["transform", "flipX"]);
    this.boolean(transform, scope, "垂直镜像", ["transform", "flipY"]);
    this.choice(
      transform,
      scope,
      "画面适配",
      ["transform", "fit"],
      [
        ["contain", "完整显示"],
        ["cover", "填满画布"],
        ["stretch", "拉伸铺满"],
      ],
    );
    const crop = this.section(parent, "裁切", "从原素材各边向内裁切；相对的两边必须保留有效画面。");
    for (const [name, label] of [
      ["left", "左侧裁切（%）"],
      ["right", "右侧裁切（%）"],
      ["top", "顶部裁切（%）"],
      ["bottom", "底部裁切（%）"],
    ] as const)
      this.number(crop, scope, {
        label,
        path: ["transform", "crop", name],
        min: 0,
        max: 0.999,
        factor: 100,
      });
    this.choice(
      parent,
      scope,
      "混合模式",
      ["blendMode"],
      [
        ["normal", "正常"],
        ["multiply", "正片叠底"],
        ["screen", "滤色"],
        ["overlay", "叠加"],
        ["darken", "变暗"],
        ["lighten", "变亮"],
      ],
    );
    const shapes = { ...scope, clips: scope.clips.filter((clip) => clip.kind === "shape") };
    if (shapes.clips.length) {
      const shape = this.section(parent, "图形", `应用于 ${shapes.clips.length} 个图形片段`);
      this.choice(
        shape,
        shapes,
        "图形类型",
        ["shape"],
        [
          ["rectangle", "矩形"],
          ["ellipse", "椭圆"],
          ["line", "直线"],
        ],
      );
      this.plain(shape, shapes, "图形填充颜色", ["fill"]);
      this.plain(shape, shapes, "图形描边颜色", ["stroke"]);
      this.number(shape, shapes, {
        label: "图形描边宽度（像素）",
        path: ["strokeWidth"],
        min: 0,
        max: 1024,
      });
    }
  }
  private color(parent: HTMLElement, scope: Scope): void {
    const basic = this.section(
      parent,
      "基础调色",
      "对比度和饱和度的原值为 100%；亮度、色温和色调的原值为 0%。",
    );
    for (const [name, label, min, max, factor] of [
      ["exposure", "曝光（档）", -10, 10, 1],
      ["brightness", "亮度（%）", -1, 1, 100],
      ["contrast", "对比度（%）", 0, 4, 100],
      ["saturation", "饱和度（%）", 0, 4, 100],
      ["temperature", "色温（%）", -1, 1, 100],
      ["tint", "色调（%）", -1, 1, 100],
      ["hue", "色相（度）", -360, 360, 1],
    ] as const)
      this.number(basic, scope, { label, path: ["color", name], min, max, factor, animated: true });
    const advanced = this.section(
      parent,
      "曲线与分色调整",
      "输入和输出用百分比表示。曲线节点按输入值从小到大排列。",
    );
    this.individual(advanced, scope, "color", (selected) => {
      this.colorCurves(advanced, selected);
      this.hsl(advanced, selected);
    });
  }
  private colorCurves(parent: HTMLElement, scope: Scope): void {
    const clip = scope.clips[0]!;
    for (const [channel, label] of [
      ["rgb", "整体 RGB"],
      ["red", "红色"],
      ["green", "绿色"],
      ["blue", "蓝色"],
    ] as const) {
      const curve = clip.color.curves.find((item) => item.channel === channel);
      const details = this.details(
        parent,
        `${label}曲线${curve ? ` · ${curve.points.length} 个节点` : " · 未启用"}`,
        `curve:${channel}`,
      );
      if (!curve) {
        this.action(details, `添加${label}曲线`, () => {
          void this.edit(scope, `添加${label}曲线`, (current) => ({
            color: {
              ...current.color,
              curves: [
                ...current.color.curves,
                {
                  channel,
                  points: [
                    { x: 0, y: 0 },
                    { x: 1, y: 1 },
                  ],
                },
              ],
            },
          }));
        });
        continue;
      }
      const editCurve = (
        label: string,
        update: (points: Array<{ x: number; y: number }>) => void,
      ) => {
        void this.edit(scope, label, (current) => {
          const color = structuredClone(current.color),
            target = color.curves.find((item) => item.channel === channel);
          if (!target) throw new Error("曲线已变化，请重新编辑");
          update(target.points);
          target.points.sort((a, b) => a.x - b.x);
          return { color };
        });
      };
      this.preview(details, curve.points, `${label}调色曲线预览`);
      curve.points.forEach((point, index) => {
        const row = el("div", "ei-card");
        details.append(row);
        for (const [axis, name] of [
          ["x", "输入"],
          ["y", "输出"],
        ] as const)
          this.numberInput(
            row,
            `${label}节点 ${index + 1} ${name}（%）`,
            point[axis] * 100,
            0,
            100,
            0.1,
            (number) =>
              editCurve(`修改${label}曲线节点`, (points) => {
                points[index]![axis] = number / 100;
              }),
            axis === "x" && (index === 0 || index === curve.points.length - 1),
          );
        if (index > 0 && index < curve.points.length - 1)
          this.action(row, `删除${label}节点 ${index + 1}`, () =>
            editCurve(`删除${label}曲线节点`, (points) => {
              points.splice(index, 1);
            }),
          );
      });
      this.action(
        details,
        `添加${label}节点`,
        () =>
          editCurve(`添加${label}曲线节点`, (points) => {
            let index = 0;
            for (let i = 1; i < points.length - 1; i++)
              if (points[i + 1]!.x - points[i]!.x > points[index + 1]!.x - points[index]!.x)
                index = i;
            points.push({
              x: (points[index]!.x + points[index + 1]!.x) / 2,
              y: (points[index]!.y + points[index + 1]!.y) / 2,
            });
          }),
        curve.points.length >= 256,
      );
      this.action(details, `移除${label}曲线`, () => {
        void this.edit(scope, `移除${label}曲线`, (current) => ({
          color: {
            ...current.color,
            curves: current.color.curves.filter((item) => item.channel !== channel),
          },
        }));
      });
    }
  }
  private hsl(parent: HTMLElement, scope: Scope): void {
    const clip = scope.clips[0]!;
    const section = this.section(parent, "HSL 分色", "按目标颜色单独调整色相、饱和度和明度。");
    clip.color.hsl.forEach((_, index) => {
      const row = el("div", "ei-card");
      section.append(row);
      row.append(el("h4", "", `颜色范围 ${index + 1}`));
      for (const [key, label, min, max, factor] of [
        ["hue", "目标色相（度）", 0, 360, 1],
        ["width", "色相范围（度）", 0.001, 360, 1],
        ["hueShift", "色相偏移（度）", -180, 180, 1],
        ["saturation", "分色饱和度（%）", -1, 1, 100],
        ["lightness", "分色明度（%）", -1, 1, 100],
      ] as const)
        this.number(row, scope, {
          label: `范围 ${index + 1} ${label}`,
          path: ["color", "hsl", index, key],
          min,
          max,
          factor,
        });
      this.action(row, `删除颜色范围 ${index + 1}`, () => {
        void this.edit(scope, "删除 HSL 范围", (current) => ({
          color: { ...current.color, hsl: current.color.hsl.filter((_, at) => at !== index) },
        }));
      });
    });
    this.action(
      section,
      "添加颜色范围",
      () => {
        void this.edit(scope, "添加 HSL 范围", (current) => ({
          color: {
            ...current.color,
            hsl: [
              ...current.color.hsl,
              { hue: 0, width: 60, hueShift: 0, saturation: 0, lightness: 0 },
            ],
          },
        }));
      },
      clip.color.hsl.length >= 24,
    );
  }
  private mask(parent: HTMLElement, scope: Scope): void {
    const section = this.section(
      parent,
      "画面蒙版",
      "蒙版位置相对原素材中心，尺寸相对原素材宽高。羽化让边缘逐渐透明。",
    );
    this.selectInput(
      section,
      "蒙版类型",
      common(scope.clips.map((clip) => clip.mask?.kind ?? "none")),
      [
        ["none", "无蒙版"],
        ["rectangle", "矩形"],
        ["ellipse", "椭圆"],
        ["linear", "线性渐变"],
        ["path", "自定义路径"],
      ],
      (kind) => {
        void this.edit(scope, "修改蒙版类型", (current) => {
          if (kind === "none") return { mask: null };
          const mask: Mask = {
            ...(current.mask ?? defaultMask(kind as Mask["kind"])),
            kind: kind as Mask["kind"],
          };
          if (kind === "path") mask.points ??= defaultMask("path").points;
          else delete mask.points;
          return { mask };
        });
      },
    );
    if (!scope.clips.every((clip) => clip.mask)) {
      section.append(el("p", "ei-hint", "选择蒙版类型后可调整尺寸与边缘。"));
      return;
    }
    for (const [name, label, min, max, factor] of [
      ["x", "蒙版水平位置（%）", -2, 2, 100],
      ["y", "蒙版垂直位置（%）", -2, 2, 100],
      ["width", "蒙版宽度（%）", 0.001, 4, 100],
      ["height", "蒙版高度（%）", 0.001, 4, 100],
      ["rotation", "蒙版旋转（度）", -360000, 360000, 1],
      ["feather", "蒙版羽化（%）", 0, 1, 100],
    ] as const)
      this.number(section, scope, { label, path: ["mask", name], min, max, factor });
    this.boolean(section, scope, "反转蒙版", ["mask", "inverted"]);
    const paths = { ...scope, clips: scope.clips.filter((clip) => clip.mask?.kind === "path") };
    if (!paths.clips.length) return;
    const points = this.section(
      parent,
      "路径顶点",
      "坐标从原素材左上角 0% 到右下角 100%，按列表顺序连接为闭合路径。",
    );
    this.individual(points, paths, "mask", (selected) => {
      const clip = selected.clips[0]!;
      clip.mask!.points!.forEach((_, index) => {
        const row = el("div", "ei-card");
        points.append(row);
        for (const [axis, label] of [
          ["x", "水平"],
          ["y", "垂直"],
        ] as const)
          this.number(row, selected, {
            label: `顶点 ${index + 1} ${label}（%）`,
            path: ["mask", "points", index, axis],
            min: 0,
            max: 1,
            factor: 100,
          });
        this.action(
          row,
          `删除顶点 ${index + 1}`,
          () => {
            void this.edit(selected, "删除蒙版顶点", (current) => ({
              mask: {
                ...current.mask!,
                points: current.mask!.points!.filter((_, at) => at !== index),
              },
            }));
          },
          clip.mask!.points!.length <= 3,
        );
      });
      this.action(
        points,
        "添加路径顶点",
        () => {
          void this.edit(selected, "添加蒙版顶点", (current) => {
            const mask = structuredClone(current.mask!);
            const points = mask.points!;
            let at = 0,
              largest = -1;
            points.forEach((point, index) => {
              const next = points[(index + 1) % points.length]!;
              const distance = Math.hypot(point.x - next.x, point.y - next.y);
              if (distance > largest) {
                largest = distance;
                at = index;
              }
            });
            const a = points[at]!,
              b = points[(at + 1) % points.length]!;
            points.splice(at + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            return { mask };
          });
        },
        clip.mask!.points!.length >= 256,
      );
    });
  }
  private text(parent: HTMLElement, full: Scope): void {
    const scope = { ...full, clips: full.clips.filter((clip) => clip.kind === "text") };
    if (!scope.clips.length) {
      parent.append(el("p", "ei-empty", "选择文字或字幕片段以编辑内容和样式。"));
      return;
    }
    const content = this.section(
      parent,
      "文字内容",
      `样式应用于 ${scope.clips.length} 个文字片段；内容和逐词时间单独编辑。修改文字会清除旧词时间和翻译标记，保留来源绑定。`,
    );
    this.individual(content, scope, "text", (selected) => {
      this.plain(content, selected, "文字内容（保留换行）", ["text"], true);
      this.choice(
        content,
        selected,
        "文字用途",
        ["role"],
        [
          ["title", "标题"],
          ["subtitle", "字幕"],
        ],
      );
      this.words(content, selected);
    });
    const style = this.section(
      parent,
      "字体与排版",
      "颜色支持 #RRGGBB 或包含透明度的 #RRGGBBAA。字号与间距使用序列画布像素。",
    );
    this.plain(style, scope, "字体", ["style", "fontFamily"]);
    const missingFonts = new Set(
      scope.clips.flatMap((clip) =>
        clip.kind === "text" ? unavailableFontFamilies(clip.style.fontFamily) : [],
      ),
    );
    for (const family of missingFonts) {
      const warning = el("p", "ei-hint", fontWarningMessage(family));
      warning.setAttribute("role", "status");
      style.append(warning);
    }
    for (const [name, label, min, max, factor] of [
      ["fontSize", "字号（像素）", 1, 2048, 1],
      ["fontWeight", "字重", 1, 1000, 1],
      ["lineHeight", "行高（%）", 0.5, 5, 100],
      ["letterSpacing", "字间距（像素）", -100, 100, 1],
      ["maxWidth", "文字最大宽度（%）", 0.01, 1, 100],
    ] as const)
      this.number(style, scope, {
        label,
        path: ["style", name],
        min,
        max,
        factor,
        integer: name === "fontWeight",
        step: name === "fontWeight" ? 1 : 0.1,
      });
    this.boolean(style, scope, "斜体", ["style", "italic"]);
    this.choice(
      style,
      scope,
      "文字布局",
      ["style", "layout"],
      [
        ["box", "独立文本框"],
        ["caption-stack", "底部字幕堆叠"],
      ],
    );
    this.choice(
      style,
      scope,
      "文字对齐",
      ["style", "align"],
      [
        ["left", "左对齐"],
        ["center", "居中"],
        ["right", "右对齐"],
      ],
    );
    for (const [key, label] of [
      ["color", "文字颜色"],
      ["strokeColor", "文字描边颜色"],
      ["background", "文字背景颜色"],
      ["highlightColor", "逐词高亮颜色"],
    ] as const)
      this.plain(style, scope, label, ["style", key]);
    for (const [name, label, max] of [
      ["strokeWidth", "文字描边宽度（像素）", 100],
      ["backgroundRadius", "背景圆角（像素）", 512],
      ["padding", "背景内边距（像素）", 512],
    ] as const)
      this.number(style, scope, { label, path: ["style", name], min: 0, max });
    this.choice(
      style,
      scope,
      "文字动画",
      ["style", "animation"],
      [
        ["none", "静态"],
        ["fade", "淡入淡出"],
        ["typewriter", "打字机"],
        ["word-highlight", "逐词高亮"],
      ],
    );
    const keywords = this.section(
      parent,
      "关键词强调",
      "匹配完整词句，区分大小写；所有出现位置都会着色。后面的规则优先，播放中的逐词高亮优先于静态色。",
    );
    this.individual(keywords, scope, "keywords", (selected) => this.keywords(keywords, selected));
    const shadow = this.section(parent, "文字阴影");
    this.plain(shadow, scope, "阴影颜色", ["style", "shadow", "color"]);
    for (const [key, label, min, max] of [
      ["blur", "阴影模糊（像素）", 0, 256],
      ["x", "阴影水平偏移（像素）", -2048, 2048],
      ["y", "阴影垂直偏移（像素）", -2048, 2048],
    ] as const)
      this.number(shadow, scope, { label, path: ["style", "shadow", key], min, max });
  }
  private keywords(parent: HTMLElement, scope: Scope): void {
    const clip = scope.clips[0]!;
    if (clip.kind !== "text") return;
    const keywords = clip.style.keywords ?? [];
    const details = this.details(parent, `关键词列表 · ${keywords.length} 项`, "keywords");
    keywords.forEach((keyword, index) => {
      const row = el("div", "ei-card");
      details.append(row);
      this.plain(row, scope, `关键词 ${index + 1}`, ["style", "keywords", index, "text"]);
      this.plain(row, scope, `关键词 ${index + 1} 颜色`, ["style", "keywords", index, "color"]);
      this.action(row, `删除关键词 ${index + 1}`, () => {
        void this.edit(scope, "删除关键词强调", (current) => {
          if (current.kind !== "text" || !equal(current.style.keywords ?? [], keywords))
            throw new Error("关键词列表已变化，请重新编辑");
          return {
            style: { ...current.style, keywords: keywords.filter((_, at) => at !== index) },
          };
        });
      });
    });
    const phrase = el("input", "ei-input"),
      color = el("input", "ei-input");
    phrase.maxLength = 200;
    phrase.placeholder = "输入需要强调的词语或短句";
    color.value = clip.style.highlightColor;
    this.inputRow(parent, "新关键词", phrase);
    this.inputRow(parent, "新关键词颜色", color);
    this.action(
      parent,
      "添加关键词强调",
      () => {
        const text = phrase.value,
          value = color.value;
        if (!text.trim()) throw new Error("请填写要强调的关键词");
        void this.edit(scope, "添加关键词强调", (current) => {
          if (current.kind !== "text") throw new Error("文字片段已变化");
          return {
            style: {
              ...current.style,
              keywords: [...(current.style.keywords ?? []), { text, color: value }],
            },
          };
        });
      },
      keywords.length >= 32,
    );
  }
  private words(parent: HTMLElement, scope: Scope): void {
    const clip = scope.clips[0]!;
    if (clip.kind !== "text") return;
    const details = this.details(parent, `逐词时间 · ${clip.words.length} 项`, "words");
    details.append(el("p", "ei-hint", "时间从文字片段起点计算，按词语顺序排列。"));
    const pageKey = `words:${clip.id}`,
      page = Math.min(
        this.pages.get(pageKey) ?? 0,
        Math.max(0, Math.floor((clip.words.length - 1) / 20)),
      );
    clip.words.slice(page * 20, (page + 1) * 20).forEach((_, offset) => {
      const index = page * 20 + offset,
        row = el("div", "ei-card");
      details.append(row);
      this.plain(row, scope, `词语 ${index + 1}`, ["words", index, "text"]);
      for (const [key, label] of [
        ["start", "开始"],
        ["end", "结束"],
      ] as const)
        this.number(row, scope, {
          label: `词语 ${index + 1} ${label}（秒）`,
          path: ["words", index, key],
          min: 0,
          max: clip.duration,
          factor: 1 / TICKS_PER_SECOND,
          integer: true,
          step: 0.001,
        });
      this.action(row, `删除词语 ${index + 1}`, () => {
        void this.edit(scope, "删除字幕词语", (current) => {
          if (current.kind !== "text") throw new Error("文字片段已变化");
          return { words: current.words.filter((_, at) => at !== index) };
        });
      });
    });
    this.action(
      details,
      "添加字幕词语",
      () => {
        void this.edit(scope, "添加字幕词语", (current) => {
          if (current.kind !== "text") throw new Error("文字片段已变化");
          const start = current.words.at(-1)?.end ?? 0;
          return {
            words: [
              ...current.words,
              {
                text: "词语",
                start,
                end: Math.min(current.duration, start + TICKS_PER_SECOND / 2),
              },
            ],
          };
        });
      },
      (clip.words.at(-1)?.end ?? 0) >= clip.duration || clip.words.length >= 10000,
    );
    if (clip.words.length > 20) {
      this.action(
        details,
        "上一页词语",
        () => {
          this.pages.set(pageKey, page - 1);
          this.render();
        },
        page === 0,
      );
      this.action(
        details,
        "下一页词语",
        () => {
          this.pages.set(pageKey, page + 1);
          this.render();
        },
        (page + 1) * 20 >= clip.words.length,
      );
    }
  }
  private audio(parent: HTMLElement, full: Scope): void {
    const scope = { ...full, clips: full.clips.filter((clip) => "audio" in clip) };
    if (!scope.clips.length) {
      parent.append(el("p", "ei-empty", "选择视频、音频、嵌套序列或多机位片段以调整声音。"));
      return;
    }
    const section = this.section(
      parent,
      "声音",
      `应用于 ${scope.clips.length} 个含声音属性的片段。声像 -100% 为左，100% 为右。`,
    );
    this.number(section, scope, {
      label: "音量（%）",
      path: ["audio", "volume"],
      min: 0,
      max: 4,
      factor: 100,
      animated: true,
    });
    this.number(section, scope, {
      label: "声像（%）",
      path: ["audio", "pan"],
      min: -1,
      max: 1,
      factor: 100,
      animated: true,
    });
    for (const [key, label] of [
      ["fadeIn", "声音淡入（秒）"],
      ["fadeOut", "声音淡出（秒）"],
    ] as const)
      this.number(section, scope, {
        label,
        path: ["audio", key],
        min: 0,
        max: Math.min(...scope.clips.map((clip) => clip.duration)),
        factor: 1 / TICKS_PER_SECOND,
        integer: true,
        step: 0.01,
      });
    this.number(section, scope, {
      label: "音高（半音）",
      path: ["audio", "pitchSemitones"],
      min: -24,
      max: 24,
    });
    this.boolean(section, scope, "变速时保持音高", ["audio", "preservePitch"]);
    const duck = this.section(
      parent,
      "自动压低背景声",
      "选择其他轨道作为参考声。当参考声超过触发电平时，降低当前片段的音量。",
    );
    this.individual(duck, scope, "audio", (selected) => {
      const clip = selected.clips[0]!;
      if (!("audio" in clip)) return;
      const choices = scope.sequence.tracks.filter(
        (track) => track.kind !== "text" && track.id !== clip.trackId,
      );
      const checkbox = this.check(duck, "启用自动压低", !!clip.audio.ducking, (enabled) => {
        void this.edit(selected, "修改自动压低", (current) => {
          if (!("audio" in current)) throw new Error("声音片段已变化");
          const audio = structuredClone(current.audio);
          if (!enabled) delete audio.ducking;
          else {
            if (!choices.length) throw new Error("需要添加另一条声音轨道作为参考");
            audio.ducking = {
              sidechainTrackIds: [choices[0]!.id],
              thresholdDb: -24,
              attenuationDb: 12,
              attack: TICKS_PER_SECOND / 10,
              release: TICKS_PER_SECOND / 2,
            };
          }
          return { audio };
        });
      });
      checkbox.disabled = !choices.length;
      if (!choices.length) duck.append(el("p", "ei-hint", "先添加另一条可播放声音的轨道。"));
      if (!clip.audio.ducking) return;
      for (const track of choices)
        this.check(
          duck,
          `参考轨道：${track.name}`,
          clip.audio.ducking.sidechainTrackIds.includes(track.id),
          (enabled) => {
            void this.edit(selected, "修改压低参考轨道", (current) => {
              if (!("audio" in current) || !current.audio.ducking)
                throw new Error("自动压低设置已变化");
              const audio = structuredClone(current.audio),
                ids = new Set(audio.ducking!.sidechainTrackIds);
              if (enabled) ids.add(track.id);
              else ids.delete(track.id);
              if (!ids.size) throw new Error("至少保留一条参考声音轨道");
              audio.ducking!.sidechainTrackIds = [...ids];
              return { audio };
            });
          },
        );
      for (const [key, label, min, max, factor] of [
        ["thresholdDb", "触发电平（dB）", -96, 0, 1],
        ["attenuationDb", "压低幅度（dB）", 0, 60, 1],
        ["attack", "压低启动（秒）", 0, TICKS_PER_SECOND * 10, 1 / TICKS_PER_SECOND],
        ["release", "音量恢复（秒）", 0, TICKS_PER_SECOND * 30, 1 / TICKS_PER_SECOND],
      ] as const)
        this.number(duck, selected, {
          label,
          path: ["audio", "ducking", key],
          min,
          max,
          factor,
          integer: key === "attack" || key === "release",
          step: 0.01,
        });
    });
  }
}

export function mountEditorInspector(
  container: HTMLElement,
  context: EditorInspectorContext,
): EditorInspector {
  return new EditorInspector(container, context);
}
