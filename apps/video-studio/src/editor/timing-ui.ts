import type { EditorInspectorContext } from "./inspector-ui";
import {
  planClipTiming,
  isMagneticTrack,
  planTimelineArrangement,
  planTransition,
  type ClipTimingAction,
  type ClipTimingOptions,
} from "./timing-edits";
import type { EditorOperation } from "./operations";
import { secondsToTicks, TICKS_PER_SECOND, type Tick, type TimeMap } from "./time";
import type { EditorClip, EditorDocument, EditorSequence, Transition } from "./types";

export type EditorTimingContext = EditorInspectorContext;
const kinds: Array<[Transition["kind"], string]> = [
  ["dissolve", "叠化"],
  ["fade-black", "黑场淡入淡出"],
  ["wipe-left", "向左擦除"],
  ["wipe-right", "向右擦除"],
  ["push-left", "向左推移"],
  ["push-right", "向右推移"],
];
const fmt = (value: number) => String(Number(value.toFixed(6)));
const seconds = (value: Tick) => fmt(value / TICKS_PER_SECOND);
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
function numberInput(
  label: string,
  value: number | string,
  min = 0,
  step = "0.001",
): HTMLInputElement {
  const input = element("input");
  input.type = "number";
  input.setAttribute("aria-label", label);
  input.value = String(value);
  input.min = String(min);
  input.step = step;
  return input;
}
function field(label: string, control: HTMLElement): HTMLLabelElement {
  const row = element("label", "etime-field");
  row.append(element("span", "", label), control);
  return row;
}
function checked(
  label: string,
  value: boolean,
): { input: HTMLInputElement; node: HTMLLabelElement } {
  const input = element("input");
  input.type = "checkbox";
  input.checked = value;
  input.setAttribute("aria-label", label);
  const node = element("label", "etime-check");
  node.append(input, element("span", "", label));
  return { input, node };
}
function select(label: string, options: Array<[string, string]>, value: string): HTMLSelectElement {
  const node = element("select");
  node.setAttribute("aria-label", label);
  for (const [id, text] of options) {
    const option = element("option", "", text);
    option.value = id;
    node.append(option);
  }
  node.value = value;
  return node;
}
function numeric(input: HTMLInputElement): number {
  if (!input.value.trim() || !Number.isFinite(input.valueAsNumber))
    throw new Error("请填写有效的数字");
  return input.valueAsNumber;
}
interface Scope {
  document: EditorDocument;
  sequence: EditorSequence;
  clips: EditorClip[];
  selectedIds: string[];
}

/** Mount with public/editor-timing.css; the parent session owns undo, save and playback. */
export class EditorTiming {
  private root = element("section", "editor-timing");
  private signature = "";
  private pending = false;
  private disposed = false;
  private error = "";
  private activeDetails = new Set(["片段时间"]);
  private curvePage = 0;
  constructor(
    container: HTMLElement,
    private readonly context: EditorTimingContext,
  ) {
    this.root.setAttribute("aria-label", "时间与转场");
    container.append(this.root);
    this.render();
  }
  dispose(): void {
    this.disposed = true;
    this.root.remove();
  }
  private scope(): Scope | undefined {
    const document = this.context.read(),
      selection = this.context.selection(),
      sequence = document.sequences.find((item) => item.id === selection.sequenceId);
    if (!sequence) return;
    return {
      document,
      sequence,
      clips: sequence.clips.filter((item) => selection.clipIds.includes(item.id)),
      selectedIds: [...selection.clipIds],
    };
  }
  private report(error: unknown): void {
    const value = error instanceof Error ? error : new Error(String(error));
    this.error = value.message;
    this.context.onError(value);
  }
  private async submit(
    scope: Scope,
    label: string,
    plan: (fresh: Scope) => EditorOperation[],
  ): Promise<void> {
    if (this.pending || this.disposed) return;
    try {
      const fresh = this.scope();
      if (
        !fresh ||
        fresh.document.revision !== scope.document.revision ||
        fresh.sequence.id !== scope.sequence.id ||
        JSON.stringify(fresh.selectedIds) !== JSON.stringify(scope.selectedIds)
      )
        throw new Error("工程或选择已变化，请检查当前片段后重试");
      const operations = plan(fresh);
      this.pending = true;
      this.root.querySelectorAll("fieldset").forEach((node) => (node.disabled = true));
      if (operations.length) await this.context.apply(operations, label);
      this.error = "";
    } catch (error) {
      this.report(error);
    } finally {
      this.pending = false;
      if (!this.disposed) {
        this.signature = "";
        this.render();
      }
    }
  }
  private button(label: string, action: () => unknown, primary = false): HTMLButtonElement {
    const button = element("button", primary ? "etime-primary" : "", label);
    button.type = "button";
    button.addEventListener("click", () => {
      if (!this.pending && !this.disposed) action();
    });
    return button;
  }
  private section(title: string): HTMLElement {
    const details = element("details", "etime-section");
    details.open = this.activeDetails.has(title);
    const summary = element("summary", "", title);
    summary.addEventListener("click", () => {
      if (!details.open) this.activeDetails.add(title);
      else this.activeDetails.delete(title);
    });
    details.append(summary);
    details.addEventListener("toggle", () => {
      if (!this.root.contains(details)) return;
      if (details.open) this.activeDetails.add(title);
      else this.activeDetails.delete(title);
    });
    const body = element("div", "etime-body");
    details.append(body);
    this.root.append(details);
    return body;
  }
  render(): void {
    if (this.disposed || this.pending) return;
    const scope = this.scope();
    if (!scope) {
      this.root.replaceChildren(element("p", "etime-note", "请选择一个时间线"));
      return;
    }
    const signature = JSON.stringify([
      scope.document.revision,
      scope.sequence.id,
      scope.selectedIds,
    ]);
    if (signature === this.signature) {
      const clock = this.root.querySelector("[data-clock]");
      if (clock) clock.textContent = `播放头 ${seconds(this.context.time())} 秒`;
      return;
    }
    this.signature = signature;
    this.root.replaceChildren();
    const header = element("header", "etime-header");
    header.append(element("strong", "", "时间与转场"));
    const clock = element("span", "", `播放头 ${seconds(this.context.time())} 秒`);
    clock.dataset.clock = "";
    header.append(clock);
    this.root.append(header);
    if (this.error) {
      const error = element("p", "etime-error", this.error);
      error.setAttribute("role", "alert");
      this.root.append(error);
    }
    this.drawTiming(scope, this.section("片段时间"));
    this.drawTransitions(scope, this.section("相邻转场"));
    this.drawArrangement(scope, this.section("时间线排列"));
  }
  private drawTiming(scope: Scope, body: HTMLElement): void {
    if (!scope.clips.length) {
      body.append(
        element("p", "etime-note", "选择媒体片段后，可调整速度、倒放、定格或保留播放头一侧。"),
      );
      return;
    }
    body.append(
      element("p", "etime-selection", scope.clips.map((clip) => clip.label || clip.id).join("、")),
    );
    const locked = scope.clips.some(
      (clip) => scope.sequence.tracks.find((track) => track.id === clip.trackId)?.locked,
    );
    if (locked) body.append(element("p", "etime-note", "所选轨道已锁定，请先解锁。"));
    const controls = element("fieldset");
    controls.disabled = locked;
    controls.append(element("legend", "etime-sr", "片段时间设置"));
    body.append(controls);
    const ripple = checked(
        "联动后续片段",
        scope.clips.some((clip) => isMagneticTrack(scope.sequence, clip.trackId)),
      ),
      remove = checked("移除相关转场并消除重叠", false),
      detach = checked("保留字幕时间并解除来源绑定", false);
    controls.append(
      ripple.node,
      element(
        "p",
        "etime-note",
        "联动保持所编辑轨道的原有间隙；成组、关联声音和来源字幕一起移动。",
      ),
      remove.node,
      detach.node,
    );
    const options = (): ClipTimingOptions => ({
      ripple: ripple.input.checked,
      removeTransitions: remove.input.checked,
      detachCaptions: detach.input.checked,
    });
    const edit = (label: string, action: () => ClipTimingAction) =>
      this.submit(scope, label, (fresh) =>
        planClipTiming(fresh.document, fresh.sequence.id, fresh.selectedIds, action(), options()),
      );
    const source = scope.clips.filter(
      (clip): clip is Extract<EditorClip, { timeMap: TimeMap }> => "timeMap" in clip,
    );
    if (source.length) {
      const rates = source.map(
        (clip) =>
          Math.abs(clip.timeMap.points.at(-1)!.source - clip.timeMap.points[0]!.source) /
          clip.duration,
      );
      const uniform = source.every(
        (clip, index) =>
          clip.timeMap.points.length === 2 && Math.abs(rates[index]! - rates[0]!) < 1e-8,
      );
      const rate = numberInput(
        "恒定速度（倍）",
        uniform && rates[0] ? fmt(rates[0]) : "",
        0.05,
        "0.05",
      );
      rate.max = "100";
      rate.placeholder = "混合或分段速度";
      const pitchValues = source.map((clip) => clip.audio.preservePitch),
        pitch = checked("变速时保持音高", pitchValues.every(Boolean));
      pitch.input.indeterminate = pitchValues.some(Boolean) && !pitchValues.every(Boolean);
      controls.append(
        field("恒定速度（倍）", rate),
        pitch.node,
        this.button(
          "应用恒定速度",
          () =>
            edit("调整恒定速度", () => ({
              kind: "speed",
              rate: numeric(rate),
              preservePitch: pitch.input.indeterminate ? undefined : pitch.input.checked,
            })),
          true,
        ),
      );
      const row = element("div", "etime-actions");
      row.append(this.button("倒放所选片段", () => edit("倒放片段", () => ({ kind: "reverse" }))));
      controls.append(row);
      const freeze = numberInput("定格时长（秒）", "2", 0.000005);
      controls.append(
        field("定格时长（秒）", freeze),
        this.button("用播放头画面定格", () =>
          edit("定格片段", () => ({
            kind: "freeze",
            time: this.context.time(),
            duration: secondsToTicks(numeric(freeze)),
          })),
        ),
      );
      controls.append(
        element(
          "p",
          "etime-note",
          "定格将所选片段替换为播放头处画面，保留画面动画，定格声音静音。倒放或定格带来源字幕时，须先明确解除绑定。",
        ),
      );
    }
    const trims = element("div", "etime-actions");
    trims.append(
      this.button("保留播放头左侧", () =>
        edit("保留播放头左侧", () => ({ kind: "keep-left", time: this.context.time() })),
      ),
      this.button("保留播放头右侧", () =>
        edit("保留播放头右侧", () => ({ kind: "keep-right", time: this.context.time() })),
      ),
    );
    controls.append(trims);
    if (scope.clips.length === 1 && source.length === 1)
      this.drawCurve(scope, source[0]!, controls, options);
    else if (source.length)
      controls.append(element("p", "etime-note", "选中一个来源片段可编辑输出秒与源秒的分段曲线。"));
  }
  private drawCurve(
    scope: Scope,
    clip: Extract<EditorClip, { timeMap: TimeMap }>,
    parent: HTMLElement,
    options: () => ClipTimingOptions,
  ): void {
    const section = element("details", "etime-curve");
    section.append(element("summary", "", "分段速度曲线"));
    parent.append(section);
    const draft = structuredClone(clip.timeMap.points),
      content = element("div", "etime-curve-body");
    section.append(content);
    let rendering = false;
    const render = () => {
      if (rendering) return;
      rendering = true;
      try {
        content.replaceChildren(
          element(
            "p",
            "etime-note",
            "横轴是片段输出秒，纵轴是素材源秒。陡段加速，平段定格，向下段倒放；首个输出点固定为 0。修改最后输出秒会改变片段时长。",
          ),
        );
        const graph = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        graph.setAttribute("viewBox", "0 0 300 150");
        graph.setAttribute("role", "img");
        graph.setAttribute("aria-label", "输出时间与素材时间曲线");
        const maxTime = draft.reduce((max, point) => Math.max(max, point.time), 1),
          minSource = draft.reduce((min, point) => Math.min(min, point.source), Infinity),
          sourceSpan = Math.max(
            1,
            draft.reduce((max, point) => Math.max(max, point.source), 0) - minSource,
          );
        const path = document.createElementNS(graph.namespaceURI, "polyline");
        const stride = Math.max(1, Math.ceil(draft.length / 500));
        path.setAttribute(
          "points",
          draft
            .filter((_point, index) => index % stride === 0 || index === draft.length - 1)
            .map(
              (point) =>
                `${20 + (point.time / maxTime) * 260},${130 - ((point.source - minSource) / sourceSpan) * 110}`,
            )
            .join(" "),
        );
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#73d8ca");
        path.setAttribute("stroke-width", "2");
        graph.append(path);
        for (const [x, y, text] of [
          [5, 12, `源 ${seconds(minSource)}—${seconds(minSource + sourceSpan)} 秒`],
          [155, 146, `输出 0—${seconds(maxTime)} 秒`],
        ] as const) {
          const label = document.createElementNS(graph.namespaceURI, "text");
          label.setAttribute("x", String(x));
          label.setAttribute("y", String(y));
          label.textContent = text;
          graph.append(label);
        }
        content.append(graph);
        const table = element("table");
        table.setAttribute("aria-label", "分段速度节点");
        const head = element("thead"),
          header = element("tr");
        for (const text of ["输出秒", "源秒", "本段速度", "节点"])
          header.append(element("th", "", text));
        head.append(header);
        table.append(head);
        const body = element("tbody");
        table.append(body);
        this.curvePage = Math.min(this.curvePage, Math.floor((draft.length - 1) / 20));
        const first = this.curvePage * 20;
        draft.slice(first, first + 20).forEach((point, offset) => {
          const index = first + offset,
            row = element("tr"),
            time = numberInput(`节点 ${index + 1} 输出（秒）`, seconds(point.time), 0, "any"),
            source = numberInput(`节点 ${index + 1} 来源（秒）`, seconds(point.source), 0, "any");
          time.disabled = index === 0;
          for (const [input, key] of [
            [time, "time"],
            [source, "source"],
          ] as const)
            input.addEventListener("change", () => {
              try {
                point[key] = secondsToTicks(numeric(input));
                render();
              } catch (error) {
                this.report(error);
                input.setCustomValidity(this.error);
                input.reportValidity();
              }
            });
          const timeCell = element("td"),
            sourceCell = element("td"),
            rateCell = element("td"),
            actions = element("td");
          timeCell.append(time);
          sourceCell.append(source);
          const next = draft[index + 1];
          rateCell.textContent = next
            ? `${fmt((next.source - point.source) / (next.time - point.time))}×`
            : "终点";
          if (next) {
            const add = this.button("＋", () => {
              draft.splice(index + 1, 0, {
                time: Math.round((point.time + next.time) / 2),
                source: Math.round((point.source + next.source) / 2),
              });
              render();
            });
            add.setAttribute("aria-label", `在节点 ${index + 1} 后插入`);
            add.disabled = draft.length >= 100000 || next.time - point.time < 2;
            actions.append(add);
          }
          if (index > 0 && index < draft.length - 1) {
            const remove = this.button("−", () => {
              draft.splice(index, 1);
              render();
            });
            remove.setAttribute("aria-label", `删除节点 ${index + 1}`);
            actions.append(remove);
          }
          row.append(timeCell, sourceCell, rateCell, actions);
          body.append(row);
        });
        content.append(table);
        if (draft.length > 20) {
          const nav = element("div", "etime-actions");
          const previous = this.button("上一页节点", () => {
              this.curvePage--;
              render();
            }),
            next = this.button("下一页节点", () => {
              this.curvePage++;
              render();
            });
          previous.disabled = first === 0;
          next.disabled = first + 20 >= draft.length;
          nav.append(
            previous,
            element(
              "span",
              "etime-note",
              `${first + 1}—${Math.min(first + 20, draft.length)} / ${draft.length}`,
            ),
            next,
          );
          content.append(nav);
        }
        content.append(
          this.button(
            "应用分段曲线",
            () =>
              this.submit(scope, "编辑分段速度曲线", (fresh) => {
                const invalid = content.querySelector<HTMLInputElement>("input:invalid");
                if (invalid) throw new Error("节点包含无效秒数，请修正后再应用曲线");
                return planClipTiming(
                  fresh.document,
                  fresh.sequence.id,
                  fresh.selectedIds,
                  { kind: "map", timeMap: { points: structuredClone(draft) } },
                  options(),
                );
              }),
            true,
          ),
        );
      } finally {
        rendering = false;
      }
    };
    render();
  }
  private drawTransitions(scope: Scope, parent: HTMLElement): void {
    const pairs: Array<{ from: EditorClip; to: EditorClip; label: string }> = [];
    for (const track of scope.sequence.tracks.filter((track) => track.kind === "video")) {
      const clips = scope.sequence.clips
        .filter((clip) => clip.trackId === track.id)
        .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
      for (let index = 0; index + 1 < clips.length; index++)
        pairs.push({
          from: clips[index]!,
          to: clips[index + 1]!,
          label: `${track.name}：${clips[index]!.label} → ${clips[index + 1]!.label}`,
        });
    }
    if (!pairs.length) {
      parent.append(element("p", "etime-note", "在同一画面轨放置两个片段后，即可添加转场。"));
      return;
    }
    const initial = Math.max(
      0,
      pairs.findIndex(
        (pair) =>
          scope.selectedIds.includes(pair.from.id) &&
          (scope.selectedIds.length === 1 || scope.selectedIds.includes(pair.to.id)),
      ),
    );
    const pairInput = select(
        "相邻片段",
        pairs.map((pair, index) => [String(index), pair.label]),
        String(initial),
      ),
      body = element("div");
    parent.append(field("相邻片段", pairInput), body);
    const render = () => {
      body.replaceChildren();
      const pair = pairs[Number(pairInput.value)]!,
        existing = scope.sequence.transitions.find(
          (item) => item.fromClipId === pair.from.id && item.toClipId === pair.to.id,
        );
      const controls = element("fieldset");
      controls.disabled = [pair.from, pair.to].some(
        (clip) => scope.sequence.tracks.find((track) => track.id === clip.trackId)?.locked,
      );
      if (controls.disabled)
        body.append(element("p", "etime-note", "相邻片段所在轨道已锁定，请先解锁。"));
      controls.append(element("legend", "etime-sr", "转场设置"));
      body.append(controls);
      const kind = select("转场效果", kinds, existing?.kind ?? "dissolve"),
        duration = numberInput(
          "转场时长（秒）",
          seconds(
            existing?.duration ??
              Math.min(
                TICKS_PER_SECOND / 2,
                Math.floor(Math.min(pair.from.duration, pair.to.duration) / 2),
              ),
          ),
          0.000005,
        ),
        placement = select(
          "重叠安排",
          [
            ["ripple", "联动该轨后续片段"],
            ["overlap", "仅移动后一个片段"],
          ],
          "ripple",
        );
      const note = element("p", "etime-note");
      const update = () => {
        const secondsValue = duration.valueAsNumber;
        const delta =
          pair.from.start +
          pair.from.duration -
          Math.round(secondsValue * TICKS_PER_SECOND) -
          pair.to.start;
        note.textContent = Number.isFinite(delta)
          ? `通过重叠现有画面产生转场。后一个片段${delta < 0 ? "前移" : "后移"} ${seconds(Math.abs(delta))} 秒；成组及来源字幕同步移动。移除转场时接成硬切。`
          : "请输入转场时长。";
      };
      duration.addEventListener("input", update);
      update();
      controls.append(
        field("转场效果", kind),
        field("转场时长（秒）", duration),
        field("重叠安排", placement),
        note,
      );
      const plan = (remove: boolean) =>
        this.submit(
          scope,
          remove ? "移除转场并接成硬切" : existing ? "调整转场" : "添加转场",
          (fresh) =>
            planTransition(fresh.document, fresh.sequence.id, pair.from.id, pair.to.id, {
              id:
                existing?.id ??
                `transition-${Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, "0")).join("")}`,
              kind: kind.value as Transition["kind"],
              duration: secondsToTicks(numeric(duration)),
              placement: placement.value as "ripple" | "overlap",
              remove,
            }),
        );
      controls.append(this.button(existing ? "应用转场调整" : "添加转场", () => plan(false), true));
      if (existing) controls.append(this.button("移除转场并接成硬切", () => plan(true)));
    };
    pairInput.addEventListener("change", render);
    render();
  }
  private drawArrangement(scope: Scope, parent: HTMLElement): void {
    const controls = element("fieldset");
    controls.append(element("legend", "etime-sr", "排列设置"));
    parent.append(controls);
    const tracks = scope.sequence.tracks.filter((track) => track.kind === "video"),
      first =
        scope.clips.find((clip) => tracks.some((track) => track.id === clip.trackId))?.trackId ??
        tracks[0]?.id ??
        "";
    const track = select(
        "整理画面轨",
        tracks.map((track) => [track.id, track.name]),
        first,
      ),
      mode = select(
        "排列方式",
        [
          ["free", "自由排列"],
          ["magnetic", "磁吸排列"],
        ],
        scope.sequence.timelineMode,
      ),
      compact = checked("切换时整理所选画面轨", true);
    if (scope.sequence.magneticTrackId)
      controls.append(
        element(
          "p",
          "etime-note",
          `此旧工程仅“${scope.sequence.tracks.find((track) => track.id === scope.sequence.magneticTrackId)!.name}”自动磁吸；其他画面轨保持独立位置。手动整理只影响所选轨。`,
        ),
      );
    controls.append(
      field("排列方式", mode),
      field("整理画面轨", track),
      compact.node,
      element(
        "p",
        "etime-note",
        "整理按现有先后顺序从 0 秒接齐，保留转场的重叠时长，并同步移动成组片段与来源字幕。锁轨或相互矛盾的分组会阻止整次操作。",
      ),
    );
    mode.addEventListener("change", () =>
      this.submit(scope, "切换时间线排列", (fresh) =>
        planTimelineArrangement(fresh.document, fresh.sequence.id, {
          mode: mode.value as "free" | "magnetic",
          trackId: track.value,
          compact: mode.value === "magnetic" && compact.input.checked,
        }),
      ),
    );
    const button = this.button("整理所选画面轨间隙", () =>
      this.submit(scope, "磁吸整理画面轨", (fresh) =>
        planTimelineArrangement(fresh.document, fresh.sequence.id, {
          mode: fresh.sequence.timelineMode,
          trackId: track.value,
          compact: true,
        }),
      ),
    );
    button.disabled = !tracks.length;
    if (button.disabled) button.title = "序列里还没有画面轨";
    controls.append(button);
  }
}
export function mountEditorTiming(
  container: HTMLElement,
  context: EditorTimingContext,
): EditorTiming {
  return new EditorTiming(container, context);
}
