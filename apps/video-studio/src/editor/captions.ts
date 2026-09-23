import { randomId } from "../ids.js";
import { evaluateAnimatedNumber, type AnimatedNumber } from "./animation";
import { compileAudioPlan, type AudioPlanLane, type AudioPlanStage } from "./audio-plan";
import {
  createTrack,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "./defaults";
import { applyEditorOperations, type EditorOperation } from "./operations";
import {
  sourceRangesToTimeline,
  sourceTimeAt,
  secondsToTicks,
  TICKS_PER_SECOND,
  type Tick,
  type TimeRange,
} from "./time";
import { MAX_EDITOR_TICK, validateEditorDocument } from "./validation";
import type { EditorDocument, EditorSequence, TextClip, TextStyle } from "./types";

export interface CaptionTranscriptWord {
  text: string;
  start: number;
  end: number;
  probability?: number;
}
export interface CaptionTranscriptSegment {
  id?: number | string;
  text: string;
  start: number;
  end: number;
  words?: CaptionTranscriptWord[];
}
export interface CaptionSource {
  assetId: string;
  name: string;
  instanceId: string;
  ownerClipId: string;
  lane: AudioPlanLane;
  ranges: TimeRange[];
}
export interface CaptionPlan {
  sequenceId: string;
  operations: EditorOperation[];
  added: number;
  skipped: number;
  notices: string[];
}
export interface CaptionPlanOptions {
  trackId?: string;
  assetIds?: string[];
  wordHighlight?: boolean;
  idFactory?: () => string;
}
const MAX_RANGES = 100000,
  MAX_CAPTIONS = 2000;
const uniqueId = () => randomId();
function sequence(doc: EditorDocument, id: string): EditorSequence {
  const result = doc.sequences.find((item) => item.id === id);
  if (!result) throw new Error("字幕时间线不存在");
  return result;
}
function merge(ranges: TimeRange[]): TimeRange[] {
  if (ranges.length > MAX_RANGES) throw new Error("字幕映射范围过多，请拆分序列后生成");
  const result: TimeRange[] = [];
  for (const item of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (item.start >= item.end) continue;
    const last = result.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else result.push({ ...item });
  }
  return result;
}
function intersect(a: TimeRange[], b: TimeRange[]): TimeRange[] {
  const result: TimeRange[] = [];
  let j = 0;
  for (const x of a) {
    while (j < b.length && b[j]!.end <= x.start) j++;
    for (let i = j; i < b.length && b[i]!.start < x.end; i++) {
      const y = b[i]!,
        start = Math.max(x.start, y.start),
        end = Math.min(x.end, y.end);
      if (start < end) result.push({ start, end });
    }
  }
  return merge(result);
}
function toRoot(ranges: TimeRange[], stages: AudioPlanStage[], before: number): TimeRange[] {
  for (let index = before - 1; index >= 0; index--) {
    const stage = stages[index]!;
    ranges = merge(
      ranges.flatMap((range) =>
        sourceRangesToTimeline(stage.timeMap, range.start, range.end).map((item) => ({
          start: item.start + stage.start,
          end: item.end + stage.start,
        })),
      ),
    );
  }
  return ranges;
}
function first(start: number, end: number, test: (tick: number) => boolean): number {
  while (start < end) {
    const middle = start + Math.floor((end - start) / 2);
    if (test(middle)) end = middle;
    else start = middle + 1;
  }
  return start;
}
/** Exact integral gain > 0 intervals, including held keys and cubic overshoot clamped by the mixer. */
function positive(value: AnimatedNumber, duration: Tick): TimeRange[] {
  if (typeof value === "number") return value > 0 ? [{ start: 0, end: duration }] : [];
  const boundaries = new Set([0, duration]);
  const add = (time: number) => {
    for (const t of [Math.floor(time) - 1, Math.floor(time), Math.ceil(time), Math.ceil(time) + 1])
      if (t >= 0 && t <= duration) boundaries.add(t);
  };
  const keys = value.keyframes;
  for (let index = 0; index < keys.length; index++) {
    const a = keys[index]!,
      b = keys[index + 1];
    add(a.time);
    if (!b || typeof a.easing !== "object") continue;
    const c = a.easing,
      A = 3 * (1 + 3 * c.y1 - 3 * c.y2),
      B = 6 * (c.y2 - 2 * c.y1),
      C = 3 * c.y1;
    const roots =
      Math.abs(A) < 1e-12
        ? Math.abs(B) < 1e-12
          ? []
          : [-C / B]
        : B * B - 4 * A * C < 0
          ? []
          : [
              (-B - Math.sqrt(B * B - 4 * A * C)) / (2 * A),
              (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A),
            ];
    for (const t of roots.filter((t) => t > 0 && t < 1)) {
      const x = 3 * (1 - t) * (1 - t) * t * c.x1 + 3 * (1 - t) * t * t * c.x2 + t * t * t;
      add(a.time + (b.time - a.time) * x);
    }
  }
  const ordered = [...boundaries].sort((a, b) => a - b),
    result: TimeRange[] = [];
  const audible = (time: number) => evaluateAnimatedNumber(value, time) > 0;
  for (let i = 0; i + 1 < ordered.length; i++) {
    const start = ordered[i]!,
      end = ordered[i + 1]!;
    if (start === end) continue;
    const left = audible(start),
      right = audible(end - 1);
    if (left === right) {
      if (left) result.push({ start, end });
    } else if (left) result.push({ start, end: first(start, end, (t) => !audible(t)) });
    else result.push({ start: first(start, end, audible), end });
  }
  return merge(result);
}
function sourceRange(lane: AudioPlanLane, start: Tick, end: Tick): TimeRange[] {
  start = Math.max(0, start - lane.sourceOffset);
  end = Math.max(0, end - lane.sourceOffset);
  const leaf = lane.stages.at(-1)!;
  return toRoot(
    sourceRangesToTimeline(leaf.timeMap, start, end).map((range) => ({
      start: range.start + leaf.start,
      end: range.end + leaf.start,
    })),
    lane.stages,
    lane.stages.length - 1,
  );
}
/** Uses the same audible graph as native mixing; hidden video is still audible, freeze and zero gain are silent. */
export function compileCaptionSources(value: EditorDocument, sequenceId: string): CaptionSource[] {
  const doc = validateEditorDocument(value),
    plan = compileAudioPlan(doc, sequenceId);
  const result: CaptionSource[] = [];
  for (const lane of plan.lanes) {
    const asset = doc.assets.find((item) => item.id === lane.assetId)!;
    const inspection = asset.metadata?.editorInspection;
    if (
      inspection &&
      typeof inspection === "object" &&
      !Array.isArray(inspection) &&
      !inspection.audio
    )
      continue;
    let ranges = sourceRange(lane, 0, lane.sourceDuration);
    for (let index = 0; index < lane.stages.length && ranges.length; index++) {
      const stage = lane.stages[index]!;
      if (stage.track.muted || stage.track.volume <= 0) {
        ranges = [];
        break;
      }
      const moving = stage.timeMap.points
        .slice(0, -1)
        .flatMap((point, i) =>
          point.source === stage.timeMap.points[i + 1]!.source
            ? []
            : [{ start: point.time, end: stage.timeMap.points[i + 1]!.time }],
        );
      let local = intersect(positive(stage.audio.volume, stage.duration), merge(moving));
      if (stage.audio.fadeIn) local = intersect(local, [{ start: 1, end: stage.duration }]);
      ranges = intersect(
        ranges,
        toRoot(
          local.map((range) => ({
            start: range.start + stage.start,
            end: range.end + stage.start,
          })),
          lane.stages,
          index,
        ),
      );
    }
    if (ranges.length)
      result.push({
        assetId: asset.id,
        name: asset.name,
        instanceId: lane.instanceId,
        ownerClipId: lane.stages[0]!.clipId,
        lane,
        ranges,
      });
  }
  return result;
}
export function mapCaptionSourceRange(source: CaptionSource, start: Tick, end: Tick): TimeRange[] {
  return intersect(sourceRange(source.lane, start, end), source.ranges);
}
function cleanText(value: unknown, label: string, max = 10000): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
  )
    throw new Error(`${label}无效`);
  return value.replace(/\r\n?/g, "\n");
}
function seconds(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value * TICKS_PER_SECOND > MAX_EDITOR_TICK
  )
    throw new Error("转写源时间无效");
  return value;
}
export function validateCaptionTranscript(value: unknown): CaptionTranscriptSegment[] {
  if (!Array.isArray(value) || value.length > 100000) throw new Error("转写段落数量无效");
  let wordsCount = 0,
    characters = 0;
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("转写段落无效");
    const start = seconds(raw.start),
      end = seconds(raw.end),
      text = cleanText(raw.text, "转写文字");
    characters += text.length;
    if (characters > 16 * 1024 * 1024) throw new Error("转写文本超过16 MiB容量，请拆分素材");
    if (end <= start) throw new Error("转写段落必须有正时长");
    const result: CaptionTranscriptSegment = { start, end, text };
    if (raw.id !== undefined) {
      if (!["string", "number"].includes(typeof raw.id) || String(raw.id).length > 128)
        throw new Error("转写段落ID无效");
      result.id = raw.id;
    }
    if (raw.words !== undefined) {
      if (!Array.isArray(raw.words) || (wordsCount += raw.words.length) > 100000)
        throw new Error("转写词数量无效");
      let previousStart = -1,
        previousEnd = -1;
      result.words = raw.words.map((word: any) => {
        const from = seconds(word?.start),
          to = seconds(word?.end);
        if (
          to <= from ||
          from < start - 1 / TICKS_PER_SECOND ||
          to > end + 1 / TICKS_PER_SECOND ||
          from < previousStart ||
          to < previousEnd
        )
          throw new Error("真实词时间越界或顺序无效，不能伪造对齐");
        previousStart = from;
        previousEnd = to;
        return {
          text: cleanText(word.text, "转写词", 1000),
          start: Math.max(start, from),
          end: Math.min(end, to),
        };
      });
    }
    return result;
  });
}
function hash(value: string): string {
  let a = 2166136261,
    b = 2246822519;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b ^ value.charCodeAt(i), 3266489917);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
/** Split at real word boundaries; preserve all original punctuation and spaces between those boundaries. */
function readableSegments(segment: CaptionTranscriptSegment): CaptionTranscriptSegment[] {
  const words = segment.words;
  if (!words || words.length < 2) return [segment];
  const offsets: number[] = [];
  let cursor = 0;
  for (const word of words) {
    const at = segment.text.indexOf(word.text.trim(), cursor);
    if (at < 0) return [segment];
    offsets.push(at);
    cursor = at + word.text.trim().length;
  }
  const groups: Array<[number, number]> = [];
  let start = 0,
    characters = 0;
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    if (
      index > start &&
      (characters + [...word.text].length > 28 ||
        word.end - words[start]!.start > 4 ||
        word.start - words[index - 1]!.end >= 0.8)
    ) {
      groups.push([start, index]);
      start = index;
      characters = 0;
    }
    characters += [...word.text].length;
  }
  groups.push([start, words.length]);
  if (groups.length === 1) return [segment];
  return groups.map(([from, to]) => ({
    start: words[from]!.start,
    end: words[to - 1]!.end,
    text: segment.text.slice(
      from === 0 ? 0 : offsets[from],
      to === words.length ? segment.text.length : offsets[to],
    ),
    words: words.slice(from, to),
  }));
}
function captionTrack(
  seq: EditorSequence,
  options: CaptionPlanOptions,
): { id: string; operations: EditorOperation[] } {
  const requested = options.trackId
    ? seq.tracks.find((track) => track.id === options.trackId)
    : undefined;
  if (options.trackId && (!requested || requested.kind !== "text" || requested.locked))
    throw new Error("请选择未锁定的字幕轨道");
  const track = requested ?? seq.tracks.find((track) => track.kind === "text" && !track.locked);
  if (track) return { id: track.id, operations: [] };
  const id = (options.idFactory ?? uniqueId)();
  return {
    id,
    operations: [{ type: "track.add", sequenceId: seq.id, track: createTrack(id, "text", "字幕") }],
  };
}
function textClip(
  id: string,
  trackId: string,
  start: Tick,
  end: Tick,
  text: string,
  seq: EditorSequence,
): TextClip {
  const style = defaultTextStyle();
  style.fontSize = Math.max(12, Math.round(seq.height * 0.05));
  style.strokeWidth = Math.max(1, Math.round(style.fontSize * 0.055));
  const transform = defaultTransform();
  transform.y = 0.38;
  return {
    id,
    trackId,
    start,
    duration: end - start,
    label: "字幕",
    kind: "text",
    role: "subtitle",
    text,
    style,
    words: [],
    transform,
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
}
function finish(doc: EditorDocument, plan: CaptionPlan): CaptionPlan {
  applyEditorOperations(doc, plan.operations, doc.revision);
  return plan;
}
/** Preserve corrected existing captions. Repeated source instances have distinct, deterministic IDs. */
export function planTranscriptCaptions(
  value: EditorDocument,
  sequenceId: string,
  transcripts: ReadonlyMap<string, readonly CaptionTranscriptSegment[]>,
  options: CaptionPlanOptions = {},
): CaptionPlan {
  const doc = validateEditorDocument(value),
    seq = sequence(doc, sequenceId),
    track = captionTrack(seq, options);
  const sources = compileCaptionSources(doc, sequenceId).filter(
    (source) => !options.assetIds || options.assetIds.includes(source.assetId),
  );
  const result: CaptionPlan = { sequenceId, operations: [], added: 0, skipped: 0, notices: [] };
  const existing = new Map(seq.clips.map((clip) => [clip.id, clip])),
    generated = new Set<string>(),
    displayed = new Set(
      seq.clips
        .filter((clip): clip is TextClip => clip.kind === "text" && clip.role === "subtitle")
        .map((clip) => JSON.stringify([clip.start, clip.duration, clip.text])),
    );
  for (const assetId of new Set(sources.map((source) => source.assetId)))
    if (!transcripts.has(assetId))
      result.notices.push(
        `素材尚无转写：${doc.assets.find((asset) => asset.id === assetId)!.name}`,
      );
  for (const source of sources) {
    const segments = validateCaptionTranscript(transcripts.get(source.assetId) ?? []);
    for (const segment of segments.flatMap(readableSegments)) {
      const from = secondsToTicks(segment.start),
        to = secondsToTicks(segment.end);
      if (to > source.lane.sourceDuration) throw new Error(`转写超出素材实际时长：${source.name}`);
      for (const [rangeIndex, range] of mapCaptionSourceRange(source, from, to).entries()) {
        const mapped = (segment.words ?? [])
          .flatMap((word, index) =>
            mapCaptionSourceRange(
              source,
              secondsToTicks(word.start),
              secondsToTicks(word.end),
            ).flatMap((item) => {
              const start = Math.max(range.start, item.start),
                end = Math.min(range.end, item.end);
              return start < end
                ? [{ text: word.text, start: start - range.start, end: end - range.start, index }]
                : [];
            }),
          )
          .sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
        // Overlapping ASR words may be legal; clip word end order must stay monotone.
        if (mapped.some((word, index) => index > 0 && word.end < mapped[index - 1]!.end))
          throw new Error("映射后的词时间相互包裹，请先校准转写");
        const ordered =
          mapped.every((word, index) => word.index === index) &&
          mapped.length === (segment.words?.length ?? 0);
        const content =
          mapped.length && !ordered ? mapped.map((word) => word.text).join("") : segment.text;
        if (
          mapped.some((word, index) => index > 0 && word.index < mapped[index - 1]!.index) &&
          !result.notices.includes("倒放段按播放顺序显示真实转写词语")
        )
          result.notices.push("倒放段按播放顺序显示真实转写词语");
        if (
          !segment.words?.length &&
          !result.notices.includes("部分转写仅有句子时间，字幕未伪造逐字时间；裁剪处请校对句子内容")
        )
          result.notices.push("部分转写仅有句子时间，字幕未伪造逐字时间；裁剪处请校对句子内容");
        const id = `caption-asr-${hash(JSON.stringify([sequenceId, source.instanceId, source.assetId, from, to, rangeIndex]))}`;
        if (generated.has(id)) {
          result.skipped++;
          continue;
        }
        generated.add(id);
        const old = existing.get(id);
        if (old) {
          if (
            old.kind !== "text" ||
            old.role !== "subtitle" ||
            old.sourceBinding?.clipId !== source.ownerClipId
          )
            throw new Error("字幕ID与既有内容冲突，请保留工程并重新选择");
          result.skipped++;
          continue;
        }
        if (
          seq.clips.some(
            (item) =>
              item.kind === "text" &&
              item.sourceBinding?.clipId === source.ownerClipId &&
              item.sourceBinding.provenance?.assetId === source.assetId &&
              item.sourceBinding.provenance.start === from &&
              item.sourceBinding.provenance.end === to &&
              JSON.stringify(item.sourceBinding.provenance.path) ===
                JSON.stringify(source.lane.stages.slice(1).map((stage) => stage.clipId)) &&
              item.start < range.end &&
              item.start + item.duration > range.start,
          )
        ) {
          result.skipped++;
          continue;
        }
        const key = JSON.stringify([range.start, range.end - range.start, content]);
        if (displayed.has(key)) {
          result.skipped++;
          continue;
        }
        displayed.add(key);
        const clip = textClip(id, track.id, range.start, range.end, content, seq),
          owner = source.lane.stages[0]!;
        clip.words = mapped.map(({ index: _, ...word }) => ({ ...word, text: word.text.trim() }));
        if (options.wordHighlight && clip.words.length) clip.style.animation = "word-highlight";
        const a = sourceTimeAt(owner.timeMap, range.start - owner.start),
          b = sourceTimeAt(owner.timeMap, range.end - 1 - owner.start);
        clip.sourceBinding = {
          clipId: owner.clipId,
          sourceStart: Math.min(a, b),
          sourceEnd: Math.max(a, b) + 1,
          provenance: {
            path: source.lane.stages.slice(1).map((stage) => stage.clipId),
            assetId: source.assetId,
            start: from,
            end: to,
          },
        };
        result.operations.push({ type: "clip.add", sequenceId, clip });
        result.added++;
        if (result.added + seq.clips.length > MAX_CAPTIONS)
          throw new Error("字幕超过序列2000片段容量，请缩小选择或拆分序列");
      }
    }
  }
  if (result.added) result.operations.unshift(...track.operations);
  return finish(doc, result);
}

export function parseEditorSrt(text: string): Array<{ start: Tick; end: Tick; text: string }> {
  if (typeof text !== "string" || text.length > 4 * 1024 * 1024)
    throw new Error("SRT 文件过大或不是文字");
  const input = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!input) return [];
  const time = (h: string, m: string, s: string, ms: string) => {
    if (+m > 59 || +s > 59) throw new Error("SRT 时间无效");
    const tick = ((+h * 3600 + +m * 60 + +s) * 1000 + +ms) * 240;
    if (tick > MAX_EDITOR_TICK) throw new Error("SRT 超过24小时");
    return tick;
  };
  const blocks = input.split(/\n[\t ]*\n+/);
  if (blocks.length > MAX_CAPTIONS) throw new Error("SRT 超过2000条容量");
  return blocks.map((block, index) => {
    const lines = block.split("\n");
    if (/^\d+$/.test(lines[0]!.trim())) lines.shift();
    const match =
      /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})\s*$/.exec(
        lines.shift()?.trim() ?? "",
      );
    if (!match) throw new Error(`SRT 第${index + 1}条时间格式无效`);
    const start = time(match[1]!, match[2]!, match[3]!, match[4]!),
      end = time(match[5]!, match[6]!, match[7]!, match[8]!);
    if (end <= start) throw new Error(`SRT 第${index + 1}条没有正时长`);
    return { start, end, text: cleanText(lines.join("\n"), "SRT 字幕") };
  });
}
export function planSrtImport(
  value: EditorDocument,
  sequenceId: string,
  text: string,
  options: CaptionPlanOptions = {},
): CaptionPlan {
  const doc = validateEditorDocument(value),
    seq = sequence(doc, sequenceId),
    track = captionTrack(seq, options),
    cues = parseEditorSrt(text);
  const operations: EditorOperation[] = [],
    keys = new Set(
      seq.clips
        .filter((clip): clip is TextClip => clip.kind === "text" && clip.role === "subtitle")
        .map((clip) => JSON.stringify([clip.start, clip.duration, clip.text])),
    );
  let skipped = 0;
  for (const cue of cues) {
    const key = JSON.stringify([cue.start, cue.end - cue.start, cue.text]);
    if (keys.has(key)) {
      skipped++;
      continue;
    }
    keys.add(key);
    operations.push({
      type: "clip.add",
      sequenceId,
      clip: textClip(
        (options.idFactory ?? uniqueId)(),
        track.id,
        cue.start,
        cue.end,
        cue.text,
        seq,
      ),
    });
  }
  if (operations.length) operations.unshift(...track.operations);
  return finish(doc, {
    sequenceId,
    operations,
    added: cues.length - skipped,
    skipped,
    notices: [],
  });
}
export function exportEditorSrt(
  value: EditorDocument,
  sequenceId: string,
  clipIds?: readonly string[],
): string {
  const doc = validateEditorDocument(value),
    seq = sequence(doc, sequenceId),
    clips = selectedCaptions(seq, clipIds);
  const time = (tick: number) => {
    const ms = Math.round(tick / 240);
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return (
    clips
      .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
      .map((clip, index) => {
        if (Math.round(clip.start / 240) >= Math.round((clip.start + clip.duration) / 240))
          throw new Error("字幕短于SRT毫秒精度，请先调整时长");
        return `${index + 1}\n${time(clip.start)} --> ${time(clip.start + clip.duration)}\n${clip.text}`;
      })
      .join("\n\n") + (clips.length ? "\n" : "")
  );
}
function selectedCaptions(seq: EditorSequence, ids?: readonly string[]): TextClip[] {
  if (
    ids &&
    (new Set(ids).size !== ids.length ||
      ids.some(
        (id) =>
          !seq.clips.some(
            (clip) => clip.id === id && clip.kind === "text" && clip.role === "subtitle",
          ),
      ))
  )
    throw new Error("请选择有效的字幕片段");
  return seq.clips.filter(
    (clip): clip is TextClip =>
      clip.kind === "text" && clip.role === "subtitle" && (!ids || ids.includes(clip.id)),
  );
}
export function captionTranslationItems(
  value: EditorDocument,
  sequenceId: string,
  clipIds: string[],
): Array<{ id: string; text: string }> {
  const doc = validateEditorDocument(value),
    clips = selectedCaptions(sequence(doc, sequenceId), clipIds);
  if (!clips.length) throw new Error("请选择要翻译的字幕");
  return clips.map((clip) => ({ id: clip.id, text: clip.translation?.original ?? clip.text }));
}
export function planCaptionTranslation(
  value: EditorDocument,
  sequenceId: string,
  clipIds: string[],
  language: string,
  mode: "bilingual" | "translated",
  translations: readonly { id: string; text: string }[],
): CaptionPlan {
  const doc = validateEditorDocument(value),
    seq = sequence(doc, sequenceId),
    items = captionTranslationItems(doc, sequenceId, clipIds);
  cleanText(language, "翻译语言", 80);
  if (!["bilingual", "translated"].includes(mode)) throw new Error("请选择双语或仅译文");
  if (
    !Array.isArray(translations) ||
    translations.length !== items.length ||
    new Set(translations.map((item) => item.id)).size !== items.length ||
    translations.some((item) => !items.some((source) => source.id === item.id))
  )
    throw new Error("翻译结果数量或ID不匹配，原字幕已保留");
  const operations: EditorOperation[] = items.map((item) => {
    const clip = seq.clips.find((clip) => clip.id === item.id) as TextClip,
      translated = cleanText(translations.find((result) => result.id === item.id)!.text, "译文");
    const originalWords = structuredClone(clip.translation?.originalWords ?? clip.words);
    return {
      type: "clip.update",
      sequenceId,
      clipId: item.id,
      patch: {
        text: mode === "bilingual" ? `${item.text}\n${translated}` : translated,
        translation: {
          original: item.text,
          language,
          mode,
          ...(originalWords.length ? { originalWords } : {}),
        },
        words: mode === "bilingual" ? originalWords : [],
        style: {
          ...clip.style,
          animation:
            mode === "translated" && clip.style.animation === "word-highlight"
              ? "none"
              : clip.style.animation,
        },
      },
    };
  });
  return finish(doc, { sequenceId, operations, added: 0, skipped: 0, notices: [] });
}
export function planCaptionStyle(
  value: EditorDocument,
  sequenceId: string,
  clipIds: string[],
  patch: Partial<TextStyle>,
): EditorOperation[] {
  const doc = validateEditorDocument(value),
    seq = sequence(doc, sequenceId),
    clips = selectedCaptions(seq, clipIds);
  if (!clips.length) throw new Error("请选择字幕");
  if (patch.animation === "word-highlight" && clips.some((clip) => !clip.words.length))
    throw new Error("逐字高亮需要真实词时间，请先完成词级转写");
  const operations: EditorOperation[] = clips.map((clip) => ({
    type: "clip.update",
    sequenceId,
    clipId: clip.id,
    patch: { style: { ...clip.style, ...patch } },
  }));
  applyEditorOperations(doc, operations, doc.revision);
  return operations;
}
export function planCaptionText(
  value: EditorDocument,
  sequenceId: string,
  clipId: string,
  text: string,
): EditorOperation[] {
  const doc = validateEditorDocument(value),
    clip = sequence(doc, sequenceId).clips.find(
      (item): item is TextClip => item.id === clipId && item.kind === "text",
    );
  if (!clip) throw new Error("请选择有效的字幕或文字片段");
  cleanText(text, "字幕文字");
  if (text === clip.text) return [];
  const operations: EditorOperation[] = [
    {
      type: "clip.update",
      sequenceId,
      clipId,
      patch: {
        text,
        words: [],
        translation: null,
        style: {
          ...clip.style,
          animation: clip.style.animation === "word-highlight" ? "none" : clip.style.animation,
        },
      },
    },
  ];
  applyEditorOperations(doc, operations, doc.revision);
  return operations;
}

/** An explicit user edit preserves text/words/style while ending automatic source following. */
export function planDetachCaptions(
  value: EditorDocument,
  sequenceId: string,
  clipIds: string[],
): EditorOperation[] {
  const doc = validateEditorDocument(value),
    clips = selectedCaptions(sequence(doc, sequenceId), clipIds);
  if (!clips.length) throw new Error("请选择字幕");
  const operations: EditorOperation[] = clips
    .filter((clip) => clip.sourceBinding)
    .map((clip) => ({
      type: "clip.update",
      sequenceId,
      clipId: clip.id,
      patch: { sourceBinding: null },
    }));
  applyEditorOperations(doc, operations, doc.revision);
  return operations;
}
