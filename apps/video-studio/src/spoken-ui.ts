import type { TranscriptSegment } from "./production";
import type { SpokenSource } from "./spoken-edit";
import type { SessionIdentity } from "./editor/session";
import {
  findEditorSpokenCandidates,
  locateSourceRange,
  planEditorSpokenEdit,
  type EditorSpokenCandidate,
  type EditorSpokenPlan,
} from "./editor/spoken-edits";
import { TICKS_PER_SECOND, type Tick, type TimeRange } from "./editor/time";
import type { EditorDocument } from "./editor/types";
import { escapeHtml as esc, html } from "./icons";
import { button } from "./views";
import { setAnnouncedDisabled } from "./disabled-reason";

export interface SpokenContext {
  /** The authoritative editor document; null until the project is restored. */
  document(): EditorDocument | null;
  sequenceId(): string;
  identity(): SessionIdentity | null;
  prepare?(assetId: string): Promise<void>;
  fetchTranscript(assetId: string): Promise<TranscriptSegment[]>;
  fetchSilence(assetId: string): Promise<{ start: number; end: number }[]>;
  apply(plan: EditorSpokenPlan): Promise<void>;
  undo(): void;
  canUndo(): boolean;
  /** Timeline ticks of the current sequence. */
  preview(range: TimeRange): Promise<void>;
  polish(text: string): void | Promise<void>;
  enhance?(input: {
    assetId: string;
    preset: "light" | "balanced";
    denoise: boolean;
    normalize: boolean;
  }): Promise<void>;
  changed(): void;
  toast?(message: string): void;
}
const labels = { pause: "长停顿", filler: "口头词", repetition: "重复句" };
const precisionLabels = { detector: "静音检测", word: "词时间戳", segment: "整段时间戳" };
/** About 0.4 s of context on each side of a previewed moment. */
const PREVIEW_CONTEXT = 96_000;
const time = (tick: Tick) => {
  const seconds = tick / TICKS_PER_SECOND;
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
};
const seconds = (tick: Tick) => (tick / TICKS_PER_SECOND).toFixed(2);
const length = (ranges: readonly TimeRange[]) =>
  ranges.reduce((sum, range) => sum + range.end - range.start, 0);
const sameIdentity = (a: SessionIdentity | null, b: SessionIdentity | null) =>
  !!a &&
  !!b &&
  a.documentId === b.documentId &&
  a.generation === b.generation &&
  a.revision === b.revision;
export function createSpokenUI(context: SpokenContext) {
  let assetId = "",
    candidates: EditorSpokenCandidate[] = [],
    sources: SpokenSource[] = [];
  let selected = new Set<string>(),
    skipped = new Set<string>(),
    notes: string[] = [];
  let analyzed: SessionIdentity | null = null,
    generation = 0,
    disposed = false,
    linked = false,
    counter = 0;
  let pending = "",
    error = "",
    filter = "all",
    visible = 40,
    /** The project (and its replacement generation) the current analysis belongs to. */
    scope = "";
  let preset: "light" | "balanced" = "balanced",
    denoise = true,
    normalize = true;
  const idFactory = (kind: string) =>
    `spoken-${kind}-${Date.now().toString(36)}-${(++counter).toString(36)}`;
  function sequence(doc = context.document()) {
    return doc?.sequences.find((item) => item.id === context.sequenceId());
  }
  function assets() {
    const doc = context.document(),
      used = new Set(
        (sequence(doc)?.clips ?? []).flatMap((clip) =>
          clip.kind === "media" ? [clip.assetId] : [],
        ),
      );
    return (doc?.assets ?? []).filter(
      (asset) => used.has(asset.id) && (asset.kind === "audio" || asset.kind === "video"),
    );
  }
  function currentAssetId() {
    const available = assets();
    if (!available.some((asset) => asset.id === assetId)) assetId = available[0]?.id ?? "";
    return assetId;
  }
  function fresh() {
    return sameIdentity(analyzed, context.identity());
  }
  /** The edit returns approved narration to review; say so before and after applying. */
  function approvalPending() {
    const narration = context.document()?.production?.narration;
    return (
      !!narration &&
      typeof narration === "object" &&
      !Array.isArray(narration) &&
      ["approved", "recorded", "aligned"].includes(String(narration.phase))
    );
  }
  function change() {
    if (!disposed) context.changed();
  }
  function reset() {
    generation++;
    candidates = [];
    sources = [];
    selected.clear();
    skipped.clear();
    analyzed = null;
    notes = [];
    error = "";
    visible = 40;
  }
  /** Analysis, notes and errors belong to one project; opening another starts clean. */
  function followProject() {
    const identity = context.identity();
    const current = identity ? `${identity.documentId}:${identity.generation}` : "";
    if (current === scope) return;
    const first = !scope;
    scope = current;
    if (first) return;
    reset();
    pending = "";
    assetId = "";
  }
  function assertGeneration(version: number, identity: SessionIdentity) {
    if (disposed || version !== generation || !sameIdentity(context.identity(), identity))
      throw new Error("工程已变化，已丢弃旧的口播分析；请重新读取");
  }
  function editingState(doc: EditorDocument) {
    // Preparing may publish proxy/thumbnail metadata. Accept only those revision
    // changes; timeline edits and different source durations invalidate analysis.
    const current = sequence(doc);
    return JSON.stringify({
      id: doc.id,
      sequenceId: context.sequenceId(),
      sequence: current
        ? {
            timelineMode: current.timelineMode,
            tracks: current.tracks,
            clips: current.clips,
            transitions: current.transitions,
            markers: current.markers,
          }
        : null,
      assets: doc.assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        duration: asset.duration,
        resourceId: asset.resourceId,
      })),
    });
  }
  /** The full plan validates and cuts every clip; it is built only when applying. */
  function plan() {
    const doc = context.document(),
      identity = context.identity();
    if (!doc || !identity) throw new Error("工程尚未准备好");
    return planEditorSpokenEdit(doc, identity, candidates, [...selected], {
      scope: linked ? "linked" : "program",
      idFactory,
    });
  }
  /** Removed length of the selection: the union of its timeline moments, without planning. */
  function selectedLength() {
    const ranges = candidates
      .filter((candidate) => selected.has(candidate.id))
      .flatMap((candidate) => candidate.occurrences.flatMap((part) => part.timeline))
      .sort((a, b) => a.start - b.start);
    let total = 0,
      cursor = -1;
    for (const range of ranges) {
      const start = Math.max(range.start, cursor);
      if (range.end > start) total += range.end - start;
      cursor = Math.max(cursor, range.end);
    }
    return total;
  }
  async function analyze(prepare: boolean) {
    if (pending) throw new Error("请等待当前口播操作完成");
    const id = currentAssetId();
    if (!id) throw new Error("请先把口播视频或录音加入时间轴");
    reset();
    const version = generation;
    let snapshot = context.document(),
      identity = context.identity();
    if (!snapshot || !identity) throw new Error("工程尚未准备好");
    pending = prepare ? "正在准备素材和转写，真实任务继续在后台运行…" : "正在读取文稿和静音检测…";
    change();
    try {
      if (prepare) {
        if (!context.prepare) throw new Error("当前工作台不能转写，请在 CodeShell 桌面版打开");
        await context.prepare(id);
        const prepared = context.document(),
          preparedIdentity = context.identity();
        if (
          !prepared ||
          !preparedIdentity ||
          preparedIdentity.documentId !== identity.documentId ||
          preparedIdentity.generation !== identity.generation ||
          editingState(prepared) !== editingState(snapshot)
        )
          throw new Error("准备期间工程已变化，请重新读取口播分析");
        snapshot = prepared;
        identity = preparedIdentity;
        assertGeneration(version, identity);
      }
      pending = "正在读取文稿和静音检测…";
      change();
      const [transcript, silence] = await Promise.allSettled([
        context.fetchTranscript(id),
        context.fetchSilence(id),
      ]);
      assertGeneration(version, identity);
      const source: SpokenSource = { assetId: id };
      if (transcript.status === "fulfilled") source.transcript = transcript.value;
      else
        notes.push(
          `文稿未就绪：${String(transcript.reason instanceof Error ? transcript.reason.message : transcript.reason)}`,
        );
      if (silence.status === "fulfilled") source.silence = silence.value;
      else
        notes.push(
          `静音检测未就绪：${String(silence.reason instanceof Error ? silence.reason.message : silence.reason)}`,
        );
      if (transcript.status === "rejected" && silence.status === "rejected")
        throw new Error("尚无可用分析。请先准备口播，或查看后台任务中的失败原因。");
      sources = [source];
      candidates = findEditorSpokenCandidates(snapshot, context.sequenceId(), identity, sources);
      analyzed = { ...identity };
      if (source.transcript?.length && !source.transcript.some((segment) => segment.words?.length))
        notes.push(
          "这份转写没有词时间戳。包含正文的口头词只能定位试听，不能精确自动删词；长停顿仍使用真实静音检测。",
        );
      if (!source.transcript?.length) notes.push("尚无文稿，当前只显示实际静音检测候选。");
      if (!candidates.length)
        notes.push("没有发现符合保守阈值的候选。你仍可以试听文稿和手动剪辑。");
    } finally {
      if (version === generation) {
        pending = "";
        change();
      }
    }
  }
  function shown() {
    return candidates.filter(
      (candidate) => !skipped.has(candidate.id) && (filter === "all" || candidate.kind === filter),
    );
  }
  function selectionText() {
    if (!selected.size) return "勾选后才会删减；原素材始终保留。";
    return `已选 ${selected.size} 项，预计删去 ${seconds(selectedLength())} 秒`;
  }
  function applyReason() {
    return pending
      ? "请等待当前口播操作完成"
      : !fresh()
        ? "工程已更新，请重新读取分析"
        : "先勾选要删减的候选";
  }
  function updateSelection() {
    const status = document.querySelector("#spoken-selection");
    if (status) status.textContent = selectionText();
    const apply = document.querySelector<HTMLButtonElement>('[data-action="spoken-apply"]');
    if (apply)
      setAnnouncedDisabled(
        apply,
        "spoken-apply-reason",
        !!pending || !fresh() || !selected.size,
        applyReason(),
      );
  }
  function input(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
    if (target.id === "spoken-asset") {
      if (pending) return true;
      assetId = target.value;
      reset();
      change();
      return true;
    }
    if (target.id === "spoken-filter") {
      filter = target.value;
      visible = 40;
      change();
      return true;
    }
    if (target.dataset.spokenCandidate) {
      if (pending || !fresh()) return true;
      const candidate = candidates.find((item) => item.id === target.dataset.spokenCandidate);
      if (candidate?.actionable) {
        if ((target as HTMLInputElement).checked) selected.add(candidate.id);
        else selected.delete(candidate.id);
      }
      updateSelection();
      return true;
    }
    if (target.id === "spoken-linked") {
      if (pending) return true;
      linked = (target as HTMLInputElement).checked;
      change();
      return true;
    }
    if (target.id === "spoken-preset") {
      preset = target.value === "light" ? "light" : "balanced";
      return true;
    }
    if (target.id === "spoken-denoise") {
      denoise = (target as HTMLInputElement).checked;
      return true;
    }
    if (target.id === "spoken-normalize") {
      normalize = (target as HTMLInputElement).checked;
      return true;
    }
    return false;
  }
  async function action(name: string): Promise<boolean> {
    if (!name.startsWith("spoken-")) return false;
    if (disposed) throw new Error("口播编辑器已关闭");
    followProject();
    const started = scope;
    try {
      error = "";
      if (name === "spoken-analyze" || name === "spoken-prepare") {
        await analyze(name === "spoken-prepare");
        return true;
      }
      if (pending) throw new Error("请等待当前口播操作完成");
      if (name === "spoken-undo") {
        context.undo();
        reset();
        change();
        return true;
      }
      if (name === "spoken-enhance") {
        const id = currentAssetId();
        if (!id) throw new Error("请先把口播素材加入时间轴");
        if (!context.enhance) throw new Error("原声优化需要 CodeShell 桌面版");
        if (!denoise && !normalize) throw new Error("请至少选择降噪或响度均衡");
        pending = "正在提交原声优化任务…";
        change();
        try {
          await context.enhance({ assetId: id, preset, denoise, normalize });
        } finally {
          pending = "";
          change();
        }
        return true;
      }
      if (name === "spoken-more") {
        visible += 40;
        change();
        return true;
      }
      if (!fresh()) throw new Error("工程已更新，请重新读取口播分析");
      if (name === "spoken-select-pauses") {
        for (const candidate of shown())
          if (candidate.actionable && candidate.kind === "pause") selected.add(candidate.id);
        change();
        return true;
      }
      if (name === "spoken-clear") {
        selected.clear();
        change();
        return true;
      }
      if (name === "spoken-restore-skipped") {
        skipped.clear();
        change();
        return true;
      }
      if (name.startsWith("spoken-skip:")) {
        const id = name.slice("spoken-skip:".length);
        selected.delete(id);
        skipped.add(id);
        change();
        return true;
      }
      if (name.startsWith("spoken-preview:")) {
        const candidate = candidates.find(
          (item) => item.id === name.slice("spoken-preview:".length),
        );
        if (!candidate) throw new Error("候选不存在");
        const parts = candidate.occurrences,
          clips = sequence()?.clips ?? [];
        const head = clips.find((item) => item.id === parts[0]!.ownerClipId),
          tail = clips.find((item) => item.id === parts.at(-1)!.ownerClipId);
        if (!head || !tail) throw new Error("片段已变化，请重新读取分析");
        const first = parts[0]!.timeline[0]!.start,
          last = parts.at(-1)!.timeline.at(-1)!.end;
        await context.preview({
          start: first - Math.max(0, Math.min(PREVIEW_CONTEXT, first - head.start)),
          end: last + Math.max(0, Math.min(PREVIEW_CONTEXT, tail.start + tail.duration - last)),
        });
        return true;
      }
      if (name.startsWith("spoken-segment:")) {
        const segment = sources[0]?.transcript?.[Number(name.slice("spoken-segment:".length))];
        if (!segment) throw new Error("文稿段落不存在");
        const doc = context.document();
        const found =
          doc && Number.isFinite(segment.start) && segment.end > segment.start && segment.start >= 0
            ? locateSourceRange(doc, context.sequenceId(), currentAssetId(), {
                start: Math.round(segment.start * TICKS_PER_SECOND),
                end: Math.round(segment.end * TICKS_PER_SECOND),
              })[0]
            : undefined;
        if (!found) throw new Error("这一段不在当前时间轴中");
        await context.preview({
          start: found.timeline[0]!.start,
          end: found.timeline.at(-1)!.end,
        });
        return true;
      }
      if (name === "spoken-polish") {
        const text = sources
          .flatMap((source) => source.transcript?.map((segment) => segment.text) ?? [])
          .join("\n");
        if (!text.trim()) throw new Error("请先准备口播文稿");
        pending = "正在提交文稿建议…";
        change();
        try {
          await context.polish(text);
        } finally {
          pending = "";
          change();
        }
        return true;
      }
      if (name === "spoken-apply") {
        const edit = plan(),
          approved = approvalPending();
        pending = "正在保存并应用删减…";
        change();
        try {
          await context.apply(edit);
          reset();
          context.toast?.(
            `已删去 ${seconds(edit.removed)} 秒，可撤销恢复${approved ? "；已确认的口播需要重新审阅" : ""}`,
          );
        } finally {
          pending = "";
          change();
        }
        return true;
      }
      return false;
    } catch (cause) {
      // Work for a project that has since been closed has nothing left to report here.
      if (started !== scope) return true;
      error = cause instanceof Error ? cause.message : String(cause);
      change();
      throw cause;
    }
  }
  function render(): string {
    followProject();
    const available = assets(),
      id = currentAssetId(),
      valid = fresh(),
      items = shown(),
      locked = !!pending;
    const transcript = sources[0]?.transcript ?? [];
    const waiting = "请等待当前口播操作完成";
    const noSource = "先把口播素材加入时间轴";
    const stale = "工程已更新，请重新读取分析";
    return html`<div class="section-heading">
        <h2>口播精剪</h2>
        <span class="tag">保留你的原声</span>
      </div>
      <p class="section-description">用真实文稿整理表达，试听后删掉停顿、口头词和重复句。</p>
      <label class="input-label spoken-field"
        >时间轴中的口播素材<select id="spoken-asset" ${locked ? "disabled" : ""}>
          ${available.length
            ? available
                .map(
                  (asset) =>
                    `<option value="${esc(asset.id)}" ${asset.id === id ? "selected" : ""}>${esc(asset.name)}</option>`,
                )
                .join("")
            : '<option value="">请先加入视频或录音</option>'}
        </select></label
      >
      <div class="spoken-actions">
        ${context.prepare
          ? button(
              "spoken-prepare",
              "准备口播并分析",
              "text",
              "primary full",
              locked || !id,
              locked ? waiting : noSource,
            )
          : ""}${button(
          "spoken-analyze",
          "读取已有结果",
          "undo",
          "quiet full",
          locked || !id,
          locked ? waiting : noSource,
        )}
      </div>
      ${!id
        ? '<p class="small muted">先录制或导入口播，把素材加入时间轴的任意画面或声音轨，再回来整理。</p>'
        : ""}
      ${pending ? `<p class="spoken-progress" role="status">${esc(pending)}</p>` : ""}
      ${error ? `<p class="conflict" role="alert">${esc(error)}</p>` : ""}
      ${analyzed && !valid
        ? '<p class="conflict">工程已更新。请重新读取分析，再应用删减。</p>'
        : ""}
      ${notes.map((note) => `<p class="small muted">${esc(note)}</p>`).join("")}
      <details class="spoken-enhance">
        <summary>原声优化</summary>
        <p class="small muted">降低稳定背景噪声，平衡音量。处理后的完整音频会保留，原片不覆盖。</p>
        <label class="input-label spoken-field"
          >处理强度<select id="spoken-preset" ${locked ? "disabled" : ""}>
            <option value="light" ${preset === "light" ? "selected" : ""}>
              轻度 · 尽量保留环境感
            </option>
            <option value="balanced" ${preset === "balanced" ? "selected" : ""}>
              均衡 · 日常口播
            </option>
          </select></label
        ><label class="spoken-check"
          ><input
            id="spoken-denoise"
            type="checkbox"
            ${denoise ? "checked" : ""}
            ${locked ? "disabled" : ""}
          />降低背景噪声</label
        ><label class="spoken-check"
          ><input
            id="spoken-normalize"
            type="checkbox"
            ${normalize ? "checked" : ""}
            ${locked ? "disabled" : ""}
          />响度均衡</label
        >${button(
          "spoken-enhance",
          "优化这份原声",
          "volume",
          "full",
          locked || !id || !context.enhance,
          locked ? waiting : !id ? noSource : "原声优化需要 CodeShell 桌面版",
        )}
      </details>
      ${analyzed
        ? `<div class="spoken-toolbar"><label class="input-label spoken-field">候选类型<select id="spoken-filter"><option value="all" ${filter === "all" ? "selected" : ""}>全部 · ${candidates.length} 项</option>${Object.entries(
            labels,
          )
            .map(
              ([value, label]) =>
                `<option value="${value}" ${filter === value ? "selected" : ""}>${label}</option>`,
            )
            .join(
              "",
            )}</select></label><div class="spoken-actions">${button("spoken-select-pauses", "勾选长停顿", "check", "quiet", locked || !valid, locked ? waiting : stale)}${button("spoken-clear", "清空选择", undefined, "quiet", locked)}${skipped.size ? button("spoken-restore-skipped", `恢复已跳过 ${skipped.size} 项`, undefined, "quiet", locked) : ""}</div></div>
      <div class="spoken-candidates">${items
        .slice(0, visible)
        .map(
          (candidate) =>
            `<article class="spoken-candidate"><label><input type="checkbox" data-spoken-candidate="${candidate.id}" ${selected.has(candidate.id) ? "checked" : ""} ${!valid || locked || !candidate.actionable ? "disabled" : ""}/><span><strong>${labels[candidate.kind]}</strong><small>${time(candidate.occurrences[0]!.timeline[0]!.start)} · ${seconds(length(candidate.occurrences.flatMap((part) => part.timeline)))} 秒 · ${precisionLabels[candidate.precision]}</small></span></label><p>${esc(candidate.text)}</p><p class="small muted">${esc(candidate.reason)}</p><div class="spoken-actions">${button(`spoken-preview:${candidate.id}`, "试听定位", "play", "quiet", locked || !valid)}${button(`spoken-skip:${candidate.id}`, "跳过", undefined, "quiet", locked || !valid)}</div></article>`,
        )
        .join(
          "",
        )}</div>${items.length > visible ? button("spoken-more", `继续显示（还有 ${items.length - visible} 项）`, undefined, "quiet full") : ""}
      <div class="spoken-apply"><p id="spoken-selection" class="small">${esc(selectionText())}</p><label class="spoken-check"><input id="spoken-linked" type="checkbox" ${linked ? "checked" : ""} ${locked ? "disabled" : ""}/>仅口播及关联轨</label><p class="small muted">${linked ? "只剪口播及与它关联的轨道：这些轨道上同一时刻的其他片段也会一起剪去；空镜、音乐等其他轨道保持原位。" : "整条时间线同步删去这些时刻：画面、声音、音乐和字幕一起前移，其他空隙保持不变。"}</p>${approvalPending() ? '<p class="small conflict">应用后，已确认的口播会回到待审阅，需要重新审阅后再使用。</p>' : ""}${button("spoken-apply", "应用所选删减", "cut", "primary full", locked || !valid || !selected.size, applyReason(), true)}<p class="small muted">长停顿两端保留换气。建议先逐项试听。</p></div>`
        : ""}
      ${button(
        "spoken-undo",
        "撤销上次编辑",
        "undo",
        "quiet full",
        locked || !context.canUndo(),
        locked ? waiting : "没有可撤销的编辑",
      )}
      ${transcript.length
        ? `<details class="spoken-transcript"><summary>原始转写 · ${transcript.length} 段</summary><p class="small muted">点击段落试听。转写可能有错字；文案润色只改变稿件，不改变录音中说出的内容。</p><div>${transcript
            .slice(0, 500)
            .map(
              (segment, index) =>
                `<button type="button" data-action="spoken-segment:${index}" ${locked || !valid ? "disabled" : ""}><time>${time(Math.max(0, segment.start) * TICKS_PER_SECOND)} 源时间</time><span>${esc(segment.text)}</span></button>`,
            )
            .join(
              "",
            )}</div>${transcript.length > 500 ? '<p class="small muted">当前展示前 500 段；候选分析涵盖已读取的全部文稿。</p>' : ""}${button("spoken-polish", "让 AI 提供文稿建议", "spark", "full", locked || !valid, locked ? waiting : stale)}</details>`
        : ""}`;
  }
  return {
    render,
    input,
    action,
    dispose: () => {
      disposed = true;
      generation++;
    },
    get busy() {
      return !!pending;
    },
  };
}
