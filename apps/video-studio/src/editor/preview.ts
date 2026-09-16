import { FrameCompositor } from "./compositor";
import { prepareEvaluator } from "./evaluate";
import { EditorMediaPool, type EditorMediaPoolOptions } from "./media-pool";
import { frameToTicks, ticksToFrame, ticksToSeconds, secondsToTicks, type Tick } from "./time";
import type { EditorDocument, EditorSequence } from "./types";
import { sequenceDuration, validateEditorDocument } from "./validation";
import { StreamingPreviewAudio, type PreviewPcmStream } from "./stream-audio";
import {
  editorFontWarnings,
  resetFontAvailabilityCache,
  type EditorFontWarning,
} from "./font-availability";

export type PreviewAudio = {
  documentId: string;
  revision: number;
  sequenceId: string;
} & (
  | {
      /** Short full-sequence PCM from the shared audio renderer. */ buffer: AudioBuffer;
      stream?: never;
    }
  | { /** Long PCM is read only near the playhead. */ stream: PreviewPcmStream; buffer?: never }
);
export interface EditorPreviewOptions extends EditorMediaPoolOptions {
  onFrame?(time: Tick): void;
  onPlaybackChange?(playing: boolean): void;
  onBuffering?(buffering: boolean): void;
  onError?(error: unknown): void;
  /** Non-blocking, heuristic local-font warnings; an empty list clears the previous warning. */
  onWarning?(warnings: EditorFontWarning[]): void;
}

function hasPotentialAudio(
  document: EditorDocument,
  sequence: EditorSequence,
  seen = new Set<string>(),
): boolean {
  if (seen.has(sequence.id)) return false;
  seen.add(sequence.id);
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  return sequence.clips.some((clip) => {
    const track = sequence.tracks.find((item) => item.id === clip.trackId)!;
    if (track.muted || track.volume === 0 || !("audio" in clip) || clip.audio.volume === 0)
      return false;
    if (clip.kind === "sequence")
      return hasPotentialAudio(
        document,
        document.sequences.find((item) => item.id === clip.sequenceId)!,
        new Set(seen),
      );
    if (clip.kind === "multicam") return true;
    return ["audio", "video"].includes(assets.get(clip.assetId)!.kind);
  });
}

/** The playhead belongs to the sequence clock, independent of every decoder. */
export class EditorPreview {
  private readonly pool: EditorMediaPool;
  private readonly compositor = new FrameCompositor();
  private document?: EditorDocument;
  private sequence?: EditorSequence;
  private evaluator?: ReturnType<typeof prepareEvaluator>;
  private audioContext?: AudioContext;
  private audioSource?: AudioBufferSourceNode;
  private audioStream?: StreamingPreviewAudio;
  private buffering = false;
  private request?: AbortController;
  private generation = 0;
  private disposed = false;
  private isPlaying = false;
  private playhead = 0;
  private animationFrame?: number;
  private frameWork: Promise<void> = Promise.resolve();
  private fontWarningSignature = "";
  private fontsLoaded = () => {
    resetFontAvailabilityCache();
    this.checkFonts();
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: EditorPreviewOptions,
  ) {
    this.pool = new EditorMediaPool(options);
    document.fonts?.addEventListener("loadingdone", this.fontsLoaded);
  }
  private checkFonts(): void {
    if (this.disposed || !this.document || !this.sequence) return;
    const warnings = editorFontWarnings(this.document, this.sequence.id);
    const signature = JSON.stringify(warnings);
    if (signature === this.fontWarningSignature) return;
    this.fontWarningSignature = signature;
    this.options.onWarning?.(warnings);
  }
  get playing(): boolean {
    return this.isPlaying;
  }
  get time(): Tick {
    return this.playhead;
  }
  private active(): void {
    if (this.disposed) throw new Error("预览已关闭");
  }

  /** Replace a frozen snapshot after every committed edit; old decode results cannot overwrite it. */
  setDocument(value: EditorDocument, sequenceId = value.activeSequenceId): void {
    this.active();
    const valid = validateEditorDocument(value);
    const sequence = valid.sequences.find((item) => item.id === sequenceId);
    if (!sequence) throw new Error("预览序列不存在");
    this.pause();
    this.pool.reset();
    this.document = valid;
    this.sequence = sequence;
    this.evaluator = prepareEvaluator(valid);
    this.checkFonts();
    this.playhead = Math.min(this.playhead, Math.max(0, sequenceDuration(sequence) - 1));
  }
  private snapshot() {
    this.active();
    if (!this.document || !this.sequence || !this.evaluator) throw new Error("请先打开剪辑工程");
    return { document: this.document, sequence: this.sequence, evaluator: this.evaluator };
  }
  private snap(time: Tick, sequence: EditorSequence): Tick {
    if (!Number.isSafeInteger(time) || time < 0) throw new Error("预览时间无效");
    const bounded = Math.min(time, Math.max(0, sequenceDuration(sequence) - 1));
    return frameToTicks(ticksToFrame(bounded, sequence.frameRate, "floor"), sequence.frameRate);
  }
  private async draw(
    time: Tick,
    signal: AbortSignal,
    generation: number,
    draft?: ReturnType<typeof prepareEvaluator>,
  ): Promise<void> {
    const { sequence, evaluator } = this.snapshot();
    const frame = (draft ?? evaluator).evaluate(sequence.id, time);
    const media = await this.pool.prepare(frame, signal);
    if (signal.aborted || generation !== this.generation || this.disposed) return;
    this.compositor.draw(this.canvas, frame, media);
    this.playhead = time;
    this.options.onFrame?.(time);
  }
  /** A pointer gesture previews a candidate using the existing decoders; it never becomes
   * the playback document or modifies history. seek() restores the committed frame. */
  async previewDraft(value: EditorDocument): Promise<void> {
    const snapshot = this.snapshot();
    const valid = validateEditorDocument(value);
    if (
      valid.id !== snapshot.document.id ||
      JSON.stringify(valid.assets) !== JSON.stringify(snapshot.document.assets)
    )
      throw new Error("画布手势不能切换工程或素材来源");
    const candidate = valid.sequences.find((item) => item.id === snapshot.sequence.id);
    if (
      !candidate ||
      candidate.width !== snapshot.sequence.width ||
      candidate.height !== snapshot.sequence.height
    )
      throw new Error("画布尺寸已变化，请重新开始调整");
    this.pause();
    const request = new AbortController(),
      generation = this.generation;
    this.request = request;
    const work = this.draw(this.playhead, request.signal, generation, prepareEvaluator(valid));
    this.frameWork = work.catch(() => {});
    try {
      await work;
    } catch (error) {
      if (!request.signal.aborted && generation === this.generation) throw error;
    }
  }
  async seek(time: Tick): Promise<void> {
    const { sequence } = this.snapshot();
    const target = this.snap(time, sequence);
    this.pause();
    const request = new AbortController();
    const generation = this.generation;
    this.request = request;
    const operation = this.draw(target, request.signal, generation);
    this.frameWork = operation.catch(() => {});
    try {
      await operation;
    } catch (error) {
      if (!request.signal.aborted) throw error;
    }
  }
  async play(audio?: PreviewAudio): Promise<void> {
    const { document, sequence } = this.snapshot();
    const duration = sequenceDuration(sequence);
    if (!duration) throw new Error("时间轴没有可播放的内容");
    this.pause();
    const needsAudio = hasPotentialAudio(document, sequence);
    if (
      audio &&
      (audio.documentId !== document.id ||
        audio.revision !== document.revision ||
        audio.sequenceId !== sequence.id ||
        (audio.buffer ?? audio.stream).sampleRate !== 48000 ||
        (audio.buffer ?? audio.stream).numberOfChannels !== 2 ||
        Math.abs(
          (audio.buffer?.duration ?? audio.stream!.sampleCount / 48000) - ticksToSeconds(duration),
        ) >
          1 / 48000 + 0.000001)
    )
      throw new Error("声音预览与当前工程版本不一致，请重新准备声音");
    if (needsAudio && !audio) throw new Error("请先完成当前工程的声音预览准备");
    const request = new AbortController();
    const generation = this.generation;
    this.request = request;
    try {
      if (audio) {
        this.audioContext ??= new AudioContext({ sampleRate: 48000 });
        await this.audioContext.resume();
        if (this.audioContext.state !== "running") throw new Error("请点击播放按钮启用声音");
      }
      const start = this.playhead >= duration ? 0 : this.snap(this.playhead, sequence);
      await this.draw(start, request.signal, generation);
      if (request.signal.aborted || generation !== this.generation) return;
      const clock = audio ? () => this.audioContext!.currentTime : () => performance.now() / 1000;
      // The audio and image clock share this origin; decoder currentTime is never a clock.
      const origin = clock();
      if (audio?.buffer) {
        this.audioSource = this.audioContext!.createBufferSource();
        this.audioSource.buffer = audio.buffer;
        this.audioSource.connect(this.audioContext!.destination);
        this.audioSource.start(origin, ticksToSeconds(start));
      }
      const startSample = Math.floor(ticksToSeconds(start) * 48000);
      if (audio?.stream) {
        const stream = new StreamingPreviewAudio(
          this.audioContext!,
          audio.stream,
          startSample,
          request.signal,
          (error) => {
            if (request.signal.aborted || generation !== this.generation) return;
            this.pause();
            this.options.onError?.(error);
          },
        );
        this.audioStream = stream;
        await stream.start();
        if (request.signal.aborted || generation !== this.generation) return;
      }
      this.isPlaying = true;
      this.options.onPlaybackChange?.(true);
      let last = start;
      const next = () => {
        if (request.signal.aborted || generation !== this.generation) return;
        const stream = this.audioStream;
        const elapsed = stream
          ? stream.sample >= audio!.stream!.sampleCount
            ? duration
            : start + (stream.sample - startSample) * 5
          : start + secondsToTicks(Math.max(0, clock() - origin));
        const buffering = stream?.buffering ?? false;
        if (buffering !== this.buffering) {
          this.buffering = buffering;
          this.options.onBuffering?.(buffering);
        }
        if (elapsed >= duration) {
          this.frameWork = (async () => {
            await this.draw(this.snap(duration - 1, sequence), request.signal, generation);
            if (request.signal.aborted || generation !== this.generation) return;
            this.pause();
            this.playhead = duration;
            this.options.onFrame?.(duration);
          })().catch((error) => {
            if (request.signal.aborted || generation !== this.generation) return;
            this.pause();
            this.options.onError?.(error);
          });
          return;
        }
        const target = this.snap(elapsed, sequence);
        const work = async () => {
          if (target !== last) {
            await this.draw(target, request.signal, generation);
            last = target;
          }
          if (!request.signal.aborted && generation === this.generation)
            this.animationFrame = requestAnimationFrame(next);
        };
        this.frameWork = work().catch((error) => {
          if (request.signal.aborted || generation !== this.generation) return;
          this.pause();
          this.options.onError?.(error);
        });
      };
      this.animationFrame = requestAnimationFrame(next);
    } catch (error) {
      if (request.signal.aborted || generation !== this.generation) return;
      this.pause();
      throw error;
    }
  }
  pause(): void {
    this.generation++;
    this.request?.abort();
    this.request = undefined;
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    if (this.audioSource) {
      this.audioSource.stop();
      this.audioSource.disconnect();
      this.audioSource = undefined;
    }
    this.audioStream?.stop();
    this.audioStream = undefined;
    if (this.buffering) {
      this.buffering = false;
      this.options.onBuffering?.(false);
    }
    const wasPlaying = this.isPlaying;
    this.isPlaying = false;
    if (wasPlaying) this.options.onPlaybackChange?.(false);
  }
  async dispose(): Promise<void> {
    document.fonts?.removeEventListener("loadingdone", this.fontsLoaded);
    if (this.disposed) return;
    this.pause();
    this.disposed = true;
    this.pool.dispose();
    await this.frameWork;
    this.compositor.dispose();
    await this.audioContext?.close();
    this.canvas.width = this.canvas.height = 1;
  }
}
