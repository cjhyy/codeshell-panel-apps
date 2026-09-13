import type { Asset, EditOperation, Project, RoughCut } from "./model";
import {
  createRoughCut,
  exportRoughCutsCsv,
  invertRoughCuts,
  roughCutOperations,
  splitRoughCut,
} from "./rough-cut";
import { escapeHtml as esc, html, icon } from "./icons";

export interface RoughCutContext {
  project(): Project;
  assetId(): string;
  frame(): number;
  playing(): boolean;
  available(id: string): boolean;
  changed(): void;
  edit(operations: EditOperation[]): void;
  selectAsset(id: string): Promise<void>;
  seek(frame: number): Promise<void>;
  play(inFrame?: number, outFrame?: number): Promise<void>;
  toast(message: string): void;
  downloadCsv(name: string, contents: string): void;
  extractReference?(assetId: string, inFrame: number, outFrame: number): Promise<void>;
  canExtractReference?(): boolean;
}

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Draft = {
  inFrame: number;
  outFrame: number;
  name: string;
  selectedId: string;
  inText: string;
  outText: string;
  savedSignature: string;
  dirty: boolean;
};
const FPS = 30;

/** Frame-accurate timecode. Out points name the first frame after the retained range. */
export function roughCutTimecode(frame: number): string {
  const value = Math.max(0, Math.round(frame));
  return [
    Math.floor(value / 108000),
    Math.floor(value / 1800) % 60,
    Math.floor(value / 30) % 60,
    value % 30,
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/** Accept seconds, MM:SS.mmm, HH:MM:SS.mmm, or the displayed HH:MM:SS:FF. */
export function parseRoughCutTime(value: string): number | undefined {
  const text = value.trim();
  if (/^\d+(?:\.\d{1,6})?$/.test(text)) {
    const frame = Math.round(Number(text) * FPS);
    return Number.isSafeInteger(frame) ? frame : undefined;
  }
  const timecode = /^(\d{1,3}):(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (timecode) {
    const [, hours, minutes, seconds, frames] = timecode.map(Number);
    if (minutes! >= 60 || seconds! >= 60 || frames! >= FPS) return undefined;
    return ((hours! * 60 + minutes!) * 60 + seconds!) * FPS + frames!;
  }
  const parts = text.split(":");
  if ((parts.length !== 2 && parts.length !== 3) || !/^\d{1,3}$/.test(parts[0]!)) return undefined;
  if (parts.length === 3 && !/^\d{2}$/.test(parts[1]!)) return undefined;
  if (!/^\d{2}(?:\.\d{1,6})?$/.test(parts.at(-1)!)) return undefined;
  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  if (seconds >= 60 || (parts.length === 3 && minutes >= 60)) return undefined;
  return Math.round(
    ((parts.length === 3 ? Number(parts[0]) * 3600 : 0) + minutes * 60 + seconds) * FPS,
  );
}

const durationText = (frames: number) => `${(frames / FPS).toFixed(2)} 秒`;
const signature = (cut: RoughCut) => JSON.stringify([cut.inFrame, cut.outFrame, cut.name]);
const button = (
  action: string,
  text: string,
  glyph = "",
  options: { id?: string; disabled?: boolean; className?: string; title?: string } = {},
) =>
  `<button type="button" data-action="roughcut-${action}"${options.id ? ` data-id="${esc(options.id)}"` : ""} class="${options.className ?? ""}"${options.disabled ? " disabled" : ""}${options.title ? ` title="${esc(options.title)}" aria-label="${esc(options.title)}"` : ""}>${glyph ? icon(glyph, 15) : ""}<span>${esc(text)}</span></button>`;

export function createRoughCutUI(context: RoughCutContext) {
  const drafts = new Map<string, Draft>();
  const asset = () =>
    context
      .project()
      .assets.find(
        (item) => item.id === context.assetId() && ["video", "audio"].includes(item.kind),
      );
  const cuts = () => context.project().roughCuts ?? [];
  const sourceCuts = () => cuts().filter((cut) => cut.assetId === context.assetId());
  const frame = (source: Asset) =>
    Math.max(0, Math.min(source.durationFrames, Math.round(context.frame())));

  function draft(source = asset()): Draft | undefined {
    if (!source) return undefined;
    const key = JSON.stringify([context.project().id, source.id]);
    let result = drafts.get(key);
    if (!result) {
      result = {
        inFrame: 0,
        outFrame: source.durationFrames,
        name: "",
        selectedId: "",
        inText: roughCutTimecode(0),
        outText: roughCutTimecode(source.durationFrames),
        savedSignature: "",
        dirty: false,
      };
      drafts.set(key, result);
    }
    const selected = cuts().find(
      (cut) => cut.id === result!.selectedId && cut.assetId === source.id,
    );
    if (result.selectedId && !selected) {
      result.selectedId = "";
      result.savedSignature = "";
    }
    // An undo or another committed edit invalidates this selection's editing baseline.
    if (selected && signature(selected) !== result.savedSignature) loadCut(result, selected);
    return result;
  }

  function loadCut(target: Draft, cut: RoughCut) {
    Object.assign(target, {
      inFrame: cut.inFrame,
      outFrame: cut.outFrame,
      name: cut.name,
      selectedId: cut.id,
      inText: roughCutTimecode(cut.inFrame),
      outText: roughCutTimecode(cut.outFrame),
      savedSignature: signature(cut),
      dirty: false,
    });
  }

  function selectedRange(): { inFrame: number; outFrame: number } | undefined {
    const source = asset(),
      current = draft(source);
    if (!source || !current) return undefined;
    const inFrame = parseRoughCutTime(current.inText),
      outFrame = parseRoughCutTime(current.outText);
    if (
      inFrame === undefined ||
      outFrame === undefined ||
      inFrame < 0 ||
      outFrame > source.durationFrames ||
      outFrame <= inFrame
    )
      return undefined;
    return { inFrame, outFrame };
  }

  function saveCuts(next: RoughCut[]) {
    context.edit([{ type: "rough-cuts", cuts: next }]);
  }
  function errorMessage(error: unknown) {
    context.toast(error instanceof Error ? error.message : "粗剪操作未完成，请重试");
  }
  function fire(work: Promise<unknown>) {
    void work.catch(errorMessage);
  }

  function mark(which: "in" | "out") {
    const source = asset(),
      current = draft(source);
    if (!source || !current) return;
    if (which === "in") {
      current.inFrame = Math.min(source.durationFrames - 1, frame(source));
      if (current.outFrame <= current.inFrame) current.outFrame = source.durationFrames;
    } else {
      current.outFrame = Math.min(source.durationFrames, frame(source) + 1);
      if (current.inFrame >= current.outFrame) current.inFrame = 0;
    }
    current.inText = roughCutTimecode(current.inFrame);
    current.outText = roughCutTimecode(current.outFrame);
    current.dirty = true;
    context.changed();
  }

  function render(): string {
    const project = context.project();
    const sources = project.assets.filter((item) => ["video", "audio"].includes(item.kind));
    const source = asset(),
      current = draft(source);
    const entries = sourceCuts();
    const enabled = entries.filter((cut) => cut.enabled);
    const range = selectedRange();
    const usable = !!source && context.available(source.id);
    return html`<section class="roughcut-panel" data-roughcut-panel aria-label="素材粗剪">
      <div class="section-title">
        <h2>素材粗剪</h2>
        <span class="roughcut-tag">先挑段，再成片</span>
      </div>
      <p class="section-description">素材先挑段，加入成片后继续剪辑。</p>
      <label class="roughcut-source-label" for="roughcut-source">当前素材</label>
      <select id="roughcut-source" data-roughcut-field="asset" aria-label="选择粗剪素材">
        <option value="" ${!source ? "selected" : ""}>选择一段视频或音频</option>
        ${sources
          .map(
            (item) =>
              `<option value="${esc(item.id)}"${source?.id === item.id ? " selected" : ""}>${esc(item.name)} · ${durationText(item.durationFrames)}${context.available(item.id) ? "" : " · 素材未连接"}</option>`,
          )
          .join("")}
      </select>
      ${!source || !current
        ? `<div class="roughcut-empty">${icon("cut", 28)}<h3>${sources.length ? "选好素材，就能开始挑段" : "先导入视频或录音"}</h3><p>预览原素材，按 I 记开始、按 O 记结束，保留喜欢的部分。</p>${!sources.length ? '<button type="button" data-action="import" class="primary">导入素材</button>' : ""}</div>`
        : html`
            ${!usable
              ? `<p class="roughcut-notice">原片尚未连接，已保存的保留段仍在。请选择原文件，保存后会自动恢复。<button type="button" class="quiet" data-action="reconnect-media" data-id="${esc(source.id)}">重新连接原文件</button></p>`
              : ""}
            <div class="roughcut-transport">
              <div class="roughcut-time-readout">
                <strong data-roughcut-current>${roughCutTimecode(frame(source))}</strong
                ><span>/ ${roughCutTimecode(source.durationFrames)}</span>
              </div>
              <div class="roughcut-transport-buttons">
                ${button("back", "", "back", {
                  disabled: !usable,
                  className: "roughcut-icon",
                  title: "前一帧 · ←",
                })}
                <button
                  type="button"
                  data-action="roughcut-play"
                  data-roughcut-play
                  ${!usable ? "disabled" : ""}
                  aria-label="${context.playing() ? "暂停" : "播放原素材"}"
                  title="播放 / 暂停 · 空格"
                >
                  ${icon(context.playing() ? "pause" : "play", 16)}
                </button>
                ${button("next", "", "next", {
                  disabled: !usable,
                  className: "roughcut-icon",
                  title: "后一帧 · →",
                })}
              </div>
            </div>
            <div class="roughcut-source-track" aria-label="源素材时间范围">
              <div class="roughcut-track-line">
                ${entries
                  .filter((cut) => cut.enabled)
                  .map(
                    (cut) =>
                      `<span class="roughcut-saved-range" style="left:${(cut.inFrame / source.durationFrames) * 100}%;width:${((cut.outFrame - cut.inFrame) / source.durationFrames) * 100}%" title="${esc(cut.name || "保留段")}"></span>`,
                  )
                  .join("")}
                <span
                  class="roughcut-draft-range"
                  data-roughcut-range
                  style="left:${((range?.inFrame ?? 0) / source.durationFrames) *
                  100}%;width:${range
                    ? ((range.outFrame - range.inFrame) / source.durationFrames) * 100
                    : 0}%"
                ></span>
                <span
                  class="roughcut-playhead"
                  data-roughcut-playhead
                  style="left:${(frame(source) / source.durationFrames) * 100}%"
                ></span>
              </div>
              <input
                type="range"
                data-roughcut-field="seek"
                data-roughcut-scrub
                min="0"
                max="${source.durationFrames}"
                step="1"
                value="${frame(source)}"
                aria-label="定位原素材帧"
                aria-valuetext="${roughCutTimecode(frame(source))}"
                ${!usable ? "disabled" : ""}
              />
            </div>
            <div class="roughcut-range-editor">
              <div class="roughcut-mark-field">
                <div>
                  <label for="roughcut-in">入点 · 首帧</label>${button("mark-in", "I 标入点", "", {
                    disabled: !usable,
                  })}
                </div>
                <input
                  id="roughcut-in"
                  data-roughcut-field="in"
                  value="${esc(current.inText)}"
                  aria-label="保留段入点，秒或时码"
                  spellcheck="false"
                  maxlength="24"
                />
              </div>
              <div class="roughcut-mark-field">
                <div>
                  <label for="roughcut-out">出点 · 末帧之后</label>${button(
                    "mark-out",
                    "O 标出点",
                    "",
                    { disabled: !usable },
                  )}
                </div>
                <input
                  id="roughcut-out"
                  data-roughcut-field="out"
                  value="${esc(current.outText)}"
                  aria-label="保留段出点，秒或时码"
                  spellcheck="false"
                  maxlength="24"
                />
              </div>
              <p class="roughcut-time-help">
                可输入秒数或 时:分:秒:帧。O 会保留当前帧，出点记在下一帧。
              </p>
              <label class="roughcut-name-field"
                >片段名称<input
                  data-roughcut-field="name"
                  value="${esc(current.name)}"
                  placeholder="例如：开场、精彩片段、结尾"
                  maxlength="200"
              /></label>
              <div class="roughcut-draft-summary">
                <span data-roughcut-duration
                  >${range
                    ? `保留 ${durationText(range.outFrame - range.inFrame)}`
                    : "请填写有效范围，出点需要晚于入点"}</span
                >${button("new", "新范围", "plus", { className: "quiet" })}
              </div>
              <div class="roughcut-draft-actions">
                ${button("preview", "预览这一段", "play", { disabled: !usable || !range })}${button(
                  "save",
                  current.selectedId ? "更新保留段" : "保存保留段",
                  "check",
                  { className: "primary", disabled: !range },
                )}
              </div>
              ${context.extractReference
                ? button("reference", "提取这段，用作本人声音参考", "volume", {
                    className: "quiet full",
                    disabled:
                      !usable ||
                      !range ||
                      context.canExtractReference?.() === false ||
                      range.outFrame - range.inFrame < 90 ||
                      range.outFrame - range.inFrame > 900,
                    title: "提取 3–30 秒真实音频；视频必须包含声音",
                  })
                : ""}
            </div>
            <div class="roughcut-list-heading">
              <h3>保留段 <span>${entries.length}</span></h3>
              ${button("invert", "反选保留", "", { title: "把当前勾选范围以外的部分设为保留段" })}
            </div>
            <div class="roughcut-list" aria-label="当前素材的保留段">
              ${entries
                .map((cut, index) =>
                  renderCut(cut, index, entries.length, current.selectedId, usable),
                )
                .join("") ||
              '<div class="roughcut-list-empty">还没有保留段。标记入点和出点后，点击「保存保留段」。</div>'}
            </div>
            <div class="roughcut-batch">
              <p>
                <strong>${enabled.length} 段已勾选</strong
                ><span
                  >共
                  ${durationText(
                    enabled.reduce((sum, cut) => sum + cut.outFrame - cut.inFrame, 0),
                  )}，按列表顺序加入</span
                >
              </p>
              ${button("append", `加入 ${enabled.length} 段到成片`, "plus", {
                className: "primary full",
                disabled: !enabled.length,
              })}${button("csv", "下载 LosslessCut CSV", "download", {
                className: "full",
                disabled: !enabled.length,
              })}
            </div>
            <details class="roughcut-help">
              <summary>快捷键与保存方式</summary>
              <p>
                <kbd>I</kbd> 入点　<kbd>O</kbd> 出点　<kbd>+</kbd> 保存保留段<br /><kbd>B</kbd>
                切开选中段　<kbd>Delete</kbd> 删除选中标记<br /><kbd>←</kbd> <kbd>→</kbd> 逐帧　<kbd
                  >Shift</kbd
                >
                + 方向键 1 秒<br /><kbd>空格</kbd> 播放 / 暂停
              </p>
              <p>
                保留标记随工程保存，不修改原素材。加入成片后可继续调整；最终视频仍通过工作台导出。
              </p>
              ${source.kind === "audio"
                ? "<p>音频段会连续加入独立音轨；请先为成片准备足够长的画面。</p>"
                : ""}
            </details>
          `}
    </section>`;
  }

  function renderCut(
    cut: RoughCut,
    index: number,
    count: number,
    selectedId: string,
    usable: boolean,
  ): string {
    return html`<article
      class="roughcut-row ${cut.id === selectedId ? "selected" : ""} ${cut.enabled
        ? ""
        : "excluded"}"
      data-roughcut-row="${esc(cut.id)}"
    >
      <div class="roughcut-row-heading">
        <input
          type="checkbox"
          data-roughcut-field="enabled"
          data-cut-id="${esc(cut.id)}"
          ${cut.enabled ? "checked" : ""}
          aria-label="${esc(`保留第 ${index + 1} 段：${cut.name || "未命名"}`)}"
        /><button
          type="button"
          class="roughcut-row-select"
          data-action="roughcut-select"
          data-id="${esc(cut.id)}"
          aria-pressed="${cut.id === selectedId}"
        >
          <span class="roughcut-order">${String(index + 1).padStart(2, "0")}</span
          ><strong>${esc(cut.name || `保留段 ${index + 1}`)}</strong></button
        ><span class="roughcut-cut-duration">${durationText(cut.outFrame - cut.inFrame)}</span>
      </div>
      <div class="roughcut-row-times">
        <span>${roughCutTimecode(cut.inFrame)}</span><span>→</span
        ><span>${roughCutTimecode(cut.outFrame)}</span>
      </div>
      <div class="roughcut-row-actions">
        ${button("preview-cut", "预览", "play", { id: cut.id, disabled: !usable })}${button(
          "split",
          "切段 B",
          "cut",
          { id: cut.id, disabled: !usable, title: "在原素材当前帧切开这一段" },
        )}<span></span>${button("up", "↑", "", {
          id: cut.id,
          disabled: index === 0,
          title: "上移一段",
          className: "roughcut-icon",
        })}${button("down", "↓", "", {
          id: cut.id,
          disabled: index === count - 1,
          title: "下移一段",
          className: "roughcut-icon",
        })}${button("delete", "", "trash", {
          id: cut.id,
          className: "roughcut-icon danger",
          title: "删除这个保留标记",
        })}
      </div>
    </article>`;
  }

  function updateDraftDOM() {
    if (typeof document === "undefined") return;
    const source = asset();
    if (!source) return;
    const root = document.querySelector<HTMLElement>("[data-roughcut-panel]");
    if (!root) return;
    const range = selectedRange();
    const overlay = root.querySelector<HTMLElement>("[data-roughcut-range]");
    if (overlay) {
      overlay.style.left = `${((range?.inFrame ?? 0) / source.durationFrames) * 100}%`;
      overlay.style.width = `${range ? ((range.outFrame - range.inFrame) / source.durationFrames) * 100 : 0}%`;
    }
    const duration = root.querySelector("[data-roughcut-duration]");
    if (duration)
      duration.textContent = range
        ? `保留 ${durationText(range.outFrame - range.inFrame)}`
        : "请填写有效范围，出点需要晚于入点";
    for (const action of ["save", "preview", "reference"]) {
      const control = root.querySelector<HTMLButtonElement>(`[data-action="roughcut-${action}"]`);
      if (control)
        control.disabled =
          !range ||
          (["preview", "reference"].includes(action) && !context.available(source.id)) ||
          (action === "reference" &&
            (context.canExtractReference?.() === false ||
              (!!range &&
                (range.outFrame - range.inFrame < 90 || range.outFrame - range.inFrame > 900))));
    }
  }

  function input(target: Field): boolean {
    const field = target.dataset.roughcutField;
    if (!field) return false;
    if (field === "asset") {
      if (target.value !== context.assetId()) fire(context.selectAsset(target.value));
      return true;
    }
    const source = asset(),
      current = draft(source);
    if (!source || !current) return true;
    if (field === "seek") {
      const position = Number(target.value);
      if (Number.isFinite(position) && context.available(source.id))
        fire(context.seek(Math.max(0, Math.min(source.durationFrames, Math.round(position)))));
    } else if (field === "name") {
      current.name = target.value.slice(0, 200);
      current.dirty = true;
    } else if (field === "in" || field === "out") {
      const parsed = parseRoughCutTime(target.value);
      current[field === "in" ? "inText" : "outText"] = target.value;
      if (parsed !== undefined) current[field === "in" ? "inFrame" : "outFrame"] = parsed;
      current.dirty = true;
      target.setCustomValidity?.(selectedRange() ? "" : "请输入有效的秒数或时码，且入点早于出点");
      updateDraftDOM();
    } else if (field === "enabled") {
      const cut = cuts().find(
        (item) => item.id === target.dataset.cutId && item.assetId === source.id,
      );
      const enabled = (target as HTMLInputElement).checked;
      if (cut && cut.enabled !== enabled) {
        try {
          saveCuts(cuts().map((item) => (item.id === cut.id ? { ...item, enabled } : item)));
        } catch (error) {
          errorMessage(error);
        }
      }
    }
    return true;
  }

  async function action(name: string, id?: string): Promise<boolean> {
    if (!name.startsWith("roughcut-")) return false;
    const source = asset(),
      current = draft(source);
    if (!source || !current) return true;
    const verb = name.slice("roughcut-".length);
    const cut = cuts().find(
      (item) => item.id === (id ?? current.selectedId) && item.assetId === source.id,
    );
    try {
      if (
        ["play", "preview", "preview-cut", "back", "next", "mark-in", "mark-out", "split"].includes(
          verb,
        ) &&
        !context.available(source.id)
      )
        throw new Error("请先重新连接这段素材，再预览和标记");
      if (verb === "reference") {
        const range = selectedRange();
        if (!range || !context.extractReference) throw new Error("请先选择可提取的参考范围。");
        if (range.outFrame - range.inFrame < 90 || range.outFrame - range.inFrame > 900)
          throw new Error("本人声音参考需要 3–30 秒，请调整范围。");
        await context.extractReference(source.id, range.inFrame, range.outFrame);
      } else if (verb === "mark-in" || verb === "mark-out") mark(verb === "mark-in" ? "in" : "out");
      else if (verb === "back" || verb === "next")
        await context.seek(
          Math.max(0, Math.min(source.durationFrames, frame(source) + (verb === "back" ? -1 : 1))),
        );
      else if (verb === "play") await context.play();
      else if (verb === "preview") {
        const range = selectedRange();
        if (!range) throw new Error("请先设置有效的入点和出点");
        await context.play(range.inFrame, range.outFrame);
      } else if (verb === "select" || verb === "preview-cut") {
        if (!cut) throw new Error("这个保留段已不存在");
        loadCut(current, cut);
        context.changed();
        if (verb === "preview-cut") await context.play(cut.inFrame, cut.outFrame);
        else if (context.available(source.id)) await context.seek(cut.inFrame);
      } else if (verb === "new") {
        Object.assign(current, {
          inFrame: 0,
          outFrame: source.durationFrames,
          inText: roughCutTimecode(0),
          outText: roughCutTimecode(source.durationFrames),
          selectedId: "",
          name: "",
          savedSignature: "",
          dirty: false,
        });
        context.changed();
      } else if (verb === "save") {
        const range = selectedRange();
        if (!range) throw new Error("请设置有效范围：入点早于出点，且不超过素材时长");
        const previousDraft = { ...current };
        const next = cut
          ? { ...cut, ...range, name: current.name }
          : createRoughCut(
              context.project(),
              source.id,
              range.inFrame,
              range.outFrame,
              current.name,
            );
        if (cut) loadCut(current, next);
        else {
          // Saving a new range starts the next draft; only an explicit list selection edits a saved range.
          const nextIn = range.outFrame < source.durationFrames ? range.outFrame : 0;
          Object.assign(current, {
            inFrame: nextIn,
            outFrame: source.durationFrames,
            inText: roughCutTimecode(nextIn),
            outText: roughCutTimecode(source.durationFrames),
            name: "",
            selectedId: "",
            savedSignature: "",
            dirty: false,
          });
        }
        try {
          saveCuts(
            cut ? cuts().map((item) => (item.id === cut.id ? next : item)) : [...cuts(), next],
          );
        } catch (error) {
          Object.assign(current, previousDraft);
          context.changed();
          throw error;
        }
        context.toast(cut ? "保留段已更新" : "已保存保留段，可继续标记下一段");
      } else if (verb === "delete") {
        if (!cut) throw new Error("先在列表中选择要删除的保留段");
        if (current.selectedId === cut.id) {
          current.selectedId = "";
          current.savedSignature = "";
        }
        saveCuts(cuts().filter((item) => item.id !== cut.id));
      } else if (verb === "split") {
        if (!cut) throw new Error("先选择一个已保存的保留段，再定位到切点");
        const next = splitRoughCut(context.project(), cut.id, frame(source));
        current.dirty = false;
        saveCuts(next);
      } else if (verb === "up" || verb === "down") {
        if (!cut) return true;
        const sourceEntries = sourceCuts();
        const index = sourceEntries.findIndex((item) => item.id === cut.id);
        const neighbor = sourceEntries[index + (verb === "up" ? -1 : 1)];
        if (neighbor) {
          const next = [...cuts()];
          const from = next.findIndex((item) => item.id === cut.id),
            to = next.findIndex((item) => item.id === neighbor.id);
          [next[from], next[to]] = [next[to]!, next[from]!];
          saveCuts(next);
        }
      } else if (verb === "invert") {
        current.selectedId = "";
        current.savedSignature = "";
        current.dirty = false;
        saveCuts(invertRoughCuts(context.project(), source.id));
      } else if (verb === "append") {
        const enabled = sourceCuts().filter((item) => item.enabled);
        if (!enabled.length) throw new Error("先勾选要加入成片的保留段");
        context.edit(
          roughCutOperations(
            context.project(),
            enabled.map((item) => item.id),
          ),
        );
        context.toast(
          `已按列表顺序加入 ${enabled.length} 个${source.kind === "audio" ? "音频" : "视频"}片段`,
        );
      } else if (verb === "csv") {
        if (!sourceCuts().some((item) => item.enabled)) throw new Error("先勾选要导出的保留段");
        context.downloadCsv(
          `${source.name.replace(/\.[^.]+$/, "")}-保留段.csv`,
          exportRoughCutsCsv(context.project(), source.id),
        );
      } else return false;
    } catch (error) {
      errorMessage(error);
    }
    return true;
  }

  function key(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      target?.closest?.(
        "input,select,textarea,[contenteditable]:not([contenteditable='false']),dialog,[role='dialog']",
      )
    )
      return false;
    const source = asset();
    if (!source) return false;
    const name = event.key.toLowerCase();
    if (!["i", "o", "b", "+", "delete", "backspace", "arrowleft", "arrowright", " "].includes(name))
      return false;
    event.preventDefault();
    if (event.repeat && !["arrowleft", "arrowright"].includes(name)) return true;
    if (name === "arrowleft" || name === "arrowright") {
      if (context.available(source.id))
        fire(
          context.seek(
            Math.max(
              0,
              Math.min(
                source.durationFrames,
                frame(source) + (name === "arrowleft" ? -1 : 1) * (event.shiftKey ? FPS : 1),
              ),
            ),
          ),
        );
    } else
      fire(
        action(
          `roughcut-${({ i: "mark-in", o: "mark-out", b: "split", "+": "save", delete: "delete", backspace: "delete", " ": "play" } as Record<string, string>)[name]}`,
        ),
      );
    return true;
  }

  /** Playback ticks only touch the playhead and transport, preserving focused editors. */
  function sync(): void {
    if (typeof document === "undefined") return;
    const source = asset();
    if (!source) return;
    const root = document.querySelector<HTMLElement>("[data-roughcut-panel]");
    if (!root) return;
    const position = frame(source),
      text = roughCutTimecode(position);
    const readout = root.querySelector("[data-roughcut-current]");
    if (readout) readout.textContent = text;
    const scrub = root.querySelector<HTMLInputElement>("[data-roughcut-scrub]");
    if (scrub && document.activeElement !== scrub) scrub.value = String(position);
    scrub?.setAttribute("aria-valuetext", text);
    const playhead = root.querySelector<HTMLElement>("[data-roughcut-playhead]");
    if (playhead) playhead.style.left = `${(position / source.durationFrames) * 100}%`;
    const play = root.querySelector<HTMLButtonElement>("[data-roughcut-play]");
    if (play && play.dataset.playing !== String(context.playing())) {
      play.innerHTML = icon(context.playing() ? "pause" : "play", 16);
      play.setAttribute("aria-label", context.playing() ? "暂停" : "播放原素材");
      play.dataset.playing = String(context.playing());
    }
  }

  function setAsset(id: string): void {
    if (!id) {
      drafts.clear();
      return;
    }
    const source = context
      .project()
      .assets.find((item) => item.id === id && ["video", "audio"].includes(item.kind));
    if (source) draft(source);
  }

  return { render, input, action, key, selectedRange, setAsset, sync };
}
