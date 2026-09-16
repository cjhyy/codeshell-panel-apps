import { EditorMediaPool, type EditorMediaPoolOptions } from "./media-pool";
import { FrameCompositor } from "./compositor";
import {
  prepareEvaluator,
  type PreparedEvaluator,
  type EvaluatedFrame,
  type EvaluatedLayer,
  type EvaluatedVisualLayer,
} from "./evaluate";
import { compileAudioPlan, sampleAudioLane, type AudioPlanLane } from "./audio-plan";
import { evaluateAnimatedNumber } from "./animation";
import { type Tick } from "./time";
import type { EditorClip, EditorDocument, EditorSequence } from "./types";
import { waveformEnvelope, type EditorWaveform } from "./waveform";
export type { EditorWaveform } from "./waveform";
export interface EditorTimelineMediaOptions {
  resolveAsset?: EditorMediaPoolOptions["resolveAsset"];
  loadWaveform?(assetId: string, signal: AbortSignal): Promise<EditorWaveform>;
  /** Receives a bounded, deduplicated notification. Each affected strip also shows the error. */
  onError?(error: unknown): void;
}
export interface TimelineMediaStrip {
  clipId: string;
  canvas: HTMLCanvasElement;
  localStart: Tick;
  localEnd: Tick;
  width: number;
  height: number;
}
export const TIMELINE_MEDIA_LIMITS = Object.freeze({
  strips: 96,
  width: 2048,
  thumbnailWidth: 72,
  thumbnails: 160,
  waveformBytes: 8 * 1024 * 1024,
  audioLanes: 256,
});
const aborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
};
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const cleanup = () => signal.removeEventListener("abort", cancel);
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) cancel();
  });
}
const disposeCanvas = (canvas: HTMLCanvasElement) => {
  canvas.width = 1;
  canvas.height = 1;
};
const layerFor = (frame: EvaluatedFrame, id: string): EvaluatedVisualLayer | undefined => {
  for (const layer of frame.layers) {
    if (layer.kind === "transition") {
      if (layer.from?.clipId === id) return layer.from;
      if (layer.to?.clipId === id) return layer.to;
    } else if (layer.clipId === id) return layer;
  }
};
/** Scale only pixel-valued style fields; all geometry/masks remain normalized. */
function smallLayer(layer: EvaluatedLayer, ratio: number): EvaluatedLayer {
  if (layer.kind === "transition")
    return {
      ...layer,
      from: layer.from ? (smallLayer(layer.from, ratio) as EvaluatedVisualLayer) : null,
      to: layer.to ? (smallLayer(layer.to, ratio) as EvaluatedVisualLayer) : null,
    };
  if (layer.kind === "group")
    return {
      ...layer,
      width: Math.max(1, Math.round(layer.width * ratio)),
      height: Math.max(1, Math.round(layer.height * ratio)),
      layers: layer.layers.map((item) => smallLayer(item, ratio)),
    };
  if (layer.kind === "text")
    return {
      ...layer,
      style: {
        ...layer.style,
        fontSize: layer.style.fontSize * ratio,
        strokeWidth: layer.style.strokeWidth * ratio,
        backgroundRadius: layer.style.backgroundRadius * ratio,
        padding: layer.style.padding * ratio,
        letterSpacing: layer.style.letterSpacing * ratio,
        shadow: {
          ...layer.style.shadow,
          blur: layer.style.shadow.blur * ratio,
          x: layer.style.shadow.x * ratio,
          y: layer.style.shadow.y * ratio,
        },
      },
    };
  if (layer.kind === "shape") return { ...layer, strokeWidth: layer.strokeWidth * ratio };
  return layer;
}
/** True source envelope mapped through every constant-rate span, including reverse and nested maps.
 * It deliberately describes pre-mix source peaks: pitch effects, ducking and phase cancellation belong to rendered audio. */
export function timelineWaveformEnvelope(
  lane: AudioPlanLane,
  waveform: EditorWaveform,
  start: Tick,
  end: Tick,
): { min: number; max: number } {
  let min = 0,
    max = 0,
    lo = 0,
    hi = lane.spans.length;
  const first = Math.floor(start / 5),
    last = Math.max(first + 1, Math.ceil(end / 5));
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lane.spans[mid]!.endSample <= first) lo = mid + 1;
    else hi = mid;
  }
  for (let index = lo; index < lane.spans.length; index++) {
    const span = lane.spans[index]!;
    if (span.startSample >= last) break;
    if (!span.playbackRate) continue;
    const a = Math.max(first, span.startSample),
      b = Math.min(last, span.endSample);
    const left = sampleAudioLane(lane, a),
      right = sampleAudioLane(lane, b - 1);
    if (!left || !right) continue;
    const direction = Math.sign(span.playbackRate);
    const envelope = waveformEnvelope(
      waveform,
      Math.max(0, Math.min(left.sourceTime, right.sourceTime)),
      Math.min(
        lane.sourceDuration,
        Math.max(left.sourceTime, right.sourceTime) +
          Math.max(1, Math.round(Math.abs(span.playbackRate) * 5)),
      ),
    );
    if (direction) {
      min = Math.min(min, envelope.min);
      max = Math.max(max, envelope.max);
    }
  }
  return { min, max };
}

/** Window-owned media strips. Requests are serialized and superseded atomically; no live video per timeline clip. */
export class EditorTimelineMedia {
  private pool: EditorMediaPool;
  private compositor = new FrameCompositor();
  private thumbnails = new Map<string, HTMLCanvasElement>();
  private waveforms = new Map<string, EditorWaveform>();
  private waveformBytes = 0;
  private errors = new Set<string>();
  private pending?: AbortController;
  private work: Promise<void> = Promise.resolve();
  private evaluator?: PreparedEvaluator;
  private documentKey = "";
  private disposed = false;
  constructor(private readonly options: EditorTimelineMediaOptions = {}) {
    this.pool = new EditorMediaPool({
      resolveAsset:
        options.resolveAsset ??
        (() => {
          throw new Error("尚未连接素材预览");
        }),
      maxInstances: 32,
    });
  }
  get stats() {
    return {
      thumbnails: this.thumbnails.size,
      waveformBytes: this.waveformBytes,
      waveforms: this.waveforms.size,
    };
  }
  cancel(): void {
    this.pending?.abort();
    this.pending = undefined;
    this.pool.reset();
  }
  render(
    document: EditorDocument,
    sequenceId: string,
    strips: readonly TimelineMediaStrip[],
  ): Promise<void> {
    this.cancel();
    if (this.disposed) return Promise.resolve();
    const controller = new AbortController();
    this.pending = controller;
    const requests = strips.slice(0, TIMELINE_MEDIA_LIMITS.strips);
    this.work = this.work
      .catch(() => {})
      .then(async () => {
        aborted(controller.signal);
        const sequence = document.sequences.find((item) => item.id === sequenceId);
        if (!sequence) throw new Error("时间轴序列不存在");
        const key = `${document.id}:${document.revision}`;
        if (this.documentKey !== key) {
          this.evaluator = prepareEvaluator(document);
          this.documentKey = key;
          for (const canvas of this.thumbnails.values()) disposeCanvas(canvas);
          this.thumbnails.clear();
          this.errors.clear();
        }
        const selectedIds = new Set(requests.map((strip) => strip.clipId));
        // Expand only visible roots. Long projects never compile off-screen audio graphs.
        let lanes: AudioPlanLane[] = [],
          audioError: unknown;
        if (this.options.loadWaveform && requests.length) {
          try {
            lanes = compileAudioPlan(
              {
                ...document,
                sequences: document.sequences.map((item) =>
                  item.id === sequenceId
                    ? {
                        ...item,
                        clips: item.clips.filter(
                          (clip) =>
                            selectedIds.has(clip.id) &&
                            ["media", "sequence", "multicam"].includes(clip.kind),
                        ),
                        transitions: [],
                      }
                    : item,
                ),
              },
              sequenceId,
              { maxLanes: TIMELINE_MEDIA_LIMITS.audioLanes },
            ).lanes;
          } catch (error) {
            audioError = error;
          }
        }
        for (const strip of requests) {
          aborted(controller.signal);
          const clip = sequence.clips.find((item) => item.id === strip.clipId),
            track = clip && sequence.tracks.find((item) => item.id === clip.trackId);
          if (
            !clip ||
            !track ||
            track.hidden ||
            strip.localStart < 0 ||
            strip.localEnd > clip.duration ||
            strip.localEnd <= strip.localStart
          )
            continue;
          strip.canvas.width = Math.min(
            TIMELINE_MEDIA_LIMITS.width,
            Math.max(1, Math.ceil(strip.width)),
          );
          strip.canvas.height = Math.min(48, Math.max(1, Math.ceil(strip.height)));
          strip.canvas.dataset.etMediaState = "loading";
          const context = strip.canvas.getContext("2d")!;
          context.clearRect(0, 0, strip.canvas.width, strip.canvas.height);
          const picture =
            track.kind !== "audio" &&
            !(
              clip.kind === "media" &&
              document.assets.find((asset) => asset.id === clip.assetId)?.kind === "audio"
            );
          if (
            picture &&
            ["media", "sequence", "multicam"].includes(clip.kind) &&
            (this.options.resolveAsset ||
              (clip.kind === "media" &&
                document.assets.find((asset) => asset.id === clip.assetId)?.kind === "demo"))
          ) {
            try {
              await this.drawThumbnails(strip, clip, sequence, controller.signal);
            } catch (error) {
              aborted(controller.signal);
              this.fail(strip, error);
            }
          }
          aborted(controller.signal);
          const clipLanes = lanes.filter((lane) => lane.stages[0]?.clipId === clip.id);
          const available = new Map<string, EditorWaveform>();
          if (audioError) this.fail(strip, audioError);
          for (const lane of clipLanes) {
            const asset = document.assets.find((item) => item.id === lane.assetId)!;
            const cacheKey = `${document.id}:${asset.id}:${asset.resourceId ?? ""}:${asset.fingerprint ?? (asset.resourceId?.startsWith("asset-") ? "" : document.revision)}:${asset.duration}`;
            try {
              let waveform = this.waveforms.get(cacheKey);
              if (!waveform) {
                waveform = await withAbort(
                  this.options.loadWaveform!(asset.id, controller.signal),
                  controller.signal,
                );
                aborted(controller.signal);
                if (!(waveform.data instanceof Int16Array) || waveform.data.byteLength > 65536 * 6)
                  throw new Error("波形数据超过缓存上限");
                const expectedHash =
                  asset.fingerprint ??
                  (asset.resourceId?.startsWith("asset-") ? asset.resourceId.slice(6) : undefined);
                if (expectedHash && waveform.sourceHash !== expectedHash)
                  throw new Error("波形内容与当前素材不匹配，请重新准备");
                this.waveformBytes += waveform.data.byteLength;
                this.waveforms.set(cacheKey, waveform);
                while (
                  this.waveformBytes > TIMELINE_MEDIA_LIMITS.waveformBytes ||
                  this.waveforms.size > 128
                ) {
                  const oldest = this.waveforms.keys().next().value!;
                  this.waveformBytes -= this.waveforms.get(oldest)!.data.byteLength;
                  this.waveforms.delete(oldest);
                }
              } else {
                this.waveforms.delete(cacheKey);
                this.waveforms.set(cacheKey, waveform);
              }
              if (
                !available.has(lane.assetId) &&
                [...available.values()].reduce((sum, item) => sum + item.data.byteLength, 0) +
                  waveform.data.byteLength >
                  TIMELINE_MEDIA_LIMITS.waveformBytes
              )
                throw new Error("此片段的波形数据超过 8 MiB 视图预算，请拆分嵌套序列");
              available.set(lane.assetId, waveform);
            } catch (error) {
              aborted(controller.signal);
              this.fail(strip, error);
            }
          }
          aborted(controller.signal);
          this.drawAudio(strip, clip, clipLanes, available, picture);
          if (strip.canvas.dataset.etMediaState !== "error")
            strip.canvas.dataset.etMediaState = "ready";
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          for (const strip of requests) this.fail(strip, error);
        }
      });
    return this.work;
  }
  private fail(strip: TimelineMediaStrip, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    strip.canvas.dataset.etMediaState = "error";
    strip.canvas.title = message;
    strip.canvas.setAttribute("aria-label", `媒体预览暂不可用：${message}`);
    // Keep a visible explanation even in tiny clips; do not represent failure as silence.
    const context = strip.canvas.getContext("2d")!;
    context.fillStyle = "#ffc582";
    context.font = "10px system-ui";
    context.fillText("预览未就绪", 4, 12);
    if (!this.errors.has(message)) {
      if (this.errors.size < 64) {
        this.errors.add(message);
        this.options.onError?.(error);
      }
    }
  }
  private async drawThumbnails(
    strip: TimelineMediaStrip,
    clip: EditorClip,
    sequence: EditorSequence,
    signal: AbortSignal,
  ) {
    const width = strip.canvas.width,
      height = strip.canvas.height,
      context = strip.canvas.getContext("2d")!;
    const tileWidth = TIMELINE_MEDIA_LIMITS.thumbnailWidth,
      pixelsPerTick = width / (strip.localEnd - strip.localStart);
    const offset = strip.localStart * pixelsPerTick,
      first = Math.floor(offset / tileWidth),
      last = Math.ceil((offset + width) / tileWidth);
    for (let index = first; index < last; index++) {
      aborted(signal);
      const x = index * tileWidth - offset,
        drawnWidth = Math.min(tileWidth, width - x);
      const tileStart = (index * tileWidth) / pixelsPerTick,
        tileEnd = Math.min(clip.duration, ((index + 1) * tileWidth) / pixelsPerTick);
      const local = Math.min(clip.duration - 1, Math.floor((tileStart + tileEnd) / 2));
      const key = `${this.documentKey}:${sequence.id}:${clip.id}:${local}:${height}`;
      let tile = this.thumbnails.get(key);
      if (!tile) {
        const frame = this.evaluator!.evaluate(sequence.id, clip.start + local),
          layer = layerFor(frame, clip.id);
        if (!layer) throw new Error("所选源时刻没有可显示的画面");
        const ratio = Math.min(tileWidth / frame.width, height / frame.height);
        const small = {
          ...frame,
          width: Math.max(1, Math.round(frame.width * ratio)),
          height: Math.max(1, Math.round(frame.height * ratio)),
          layers: [smallLayer(layer, ratio)],
          audio: [],
        };
        const media = await this.pool.prepare(small, signal);
        aborted(signal);
        tile = globalThis.document.createElement("canvas");
        this.compositor.draw(tile, small, media);
        this.thumbnails.set(key, tile);
        while (this.thumbnails.size > TIMELINE_MEDIA_LIMITS.thumbnails) {
          const oldest = this.thumbnails.keys().next().value!;
          disposeCanvas(this.thumbnails.get(oldest)!);
          this.thumbnails.delete(oldest);
        }
      } else {
        this.thumbnails.delete(key);
        this.thumbnails.set(key, tile);
      }
      aborted(signal);
      context.fillStyle = "#10151b";
      context.fillRect(x, 0, drawnWidth, height);
      context.drawImage(
        tile,
        0,
        0,
        tile.width,
        tile.height,
        x,
        (height - tile.height) / 2,
        tileWidth,
        tile.height,
      );
    }
  }
  private drawAudio(
    strip: TimelineMediaStrip,
    clip: EditorClip,
    lanes: AudioPlanLane[],
    waveforms: Map<string, EditorWaveform>,
    picture: boolean,
  ) {
    if (!("audio" in clip)) return;
    const ctx = strip.canvas.getContext("2d")!,
      width = strip.canvas.width,
      height = strip.canvas.height;
    const start = clip.start + strip.localStart,
      duration = strip.localEnd - strip.localStart;
    const middle = picture ? height * 0.78 : height / 2,
      amplitude = picture ? height * 0.2 : height * 0.46;
    if (waveforms.size) {
      if (picture) {
        ctx.fillStyle = "#101720b0";
        ctx.fillRect(0, height * 0.55, width, height * 0.45);
      }
      ctx.strokeStyle = "#8ac7df";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const from = Math.floor(start + (x / width) * duration),
          to = Math.ceil(start + ((x + 1) / width) * duration);
        let min = 0,
          max = 0;
        for (const lane of lanes) {
          const waveform = waveforms.get(lane.assetId);
          if (!waveform) continue;
          const envelope = timelineWaveformEnvelope(lane, waveform, from, to);
          min = Math.min(min, envelope.min);
          max = Math.max(max, envelope.max);
        }
        ctx.moveTo(x + 0.5, middle - Math.min(1, max) * amplitude);
        ctx.lineTo(x + 0.5, middle - Math.max(-1, min) * amplitude);
      }
      ctx.stroke();
      strip.canvas.title ||= `源音频包络（混音前，分辨率 ${Math.max(...[...waveforms.values()].map((waveform) => waveform.samplesPerBin / waveform.sampleRate)).toFixed(3)} 秒）；音量线 0–400%，关键帧可在属性面板编辑`;
    }
    const y = (value: number) => height - 2 - (Math.max(0, Math.min(4, value)) / 4) * (height - 4);
    ctx.strokeStyle = "#e5ed97";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= width; x++) {
      const t = Math.min(clip.duration, Math.round(strip.localStart + (x / width) * duration));
      const value = evaluateAnimatedNumber(clip.audio.volume, t);
      if (x) ctx.lineTo(x, y(value));
      else ctx.moveTo(x, y(value));
    }
    ctx.stroke();
    if (typeof clip.audio.volume !== "number") {
      ctx.fillStyle = "#fff1a8";
      for (const key of clip.audio.volume.keyframes)
        if (key.time >= strip.localStart && key.time <= strip.localEnd) {
          const x = ((key.time - strip.localStart) / duration) * width;
          ctx.beginPath();
          ctx.arc(x, y(key.value), 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.pool.dispose();
    this.compositor.dispose();
    for (const canvas of this.thumbnails.values()) disposeCanvas(canvas);
    this.thumbnails.clear();
    this.waveforms.clear();
    this.waveformBytes = 0;
    this.evaluator = undefined;
  }
}
