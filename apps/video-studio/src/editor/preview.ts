import { FrameCompositor, type PreviewResolution } from "./compositor";
import { prepareEvaluator } from "./evaluate";
import {
  EditorMediaPool,
  PREVIEW_PREPARATION_TIMEOUT_MS,
  type EditorMediaPoolOptions,
} from "./media-pool";
import { frameToTicks, ticksToFrame, ticksToSeconds, secondsToTicks, type Tick } from "./time";
import type { EditorDocument, EditorSequence } from "./types";
import { sequenceDuration, validateEditorDocument } from "./validation";
import { StreamingPreviewAudio, type PreviewPcmStream } from "./stream-audio";
import { LiveAudioMixer, type LivePreviewAudio } from "./live-audio";
import { editorVisualSourceKey } from "./playback-cache";
import type { EditorAudioMixReport } from "./audio-mix-report";
import {
  editorFontWarnings,
  resetFontAvailabilityCache,
  type EditorFontWarning,
} from "./font-availability";

export type PreviewAudio = {
  documentId: string;
  revision: number;
  sequenceId: string;
  mix?: EditorAudioMixReport;
} & (
  | {
      /** Short full-sequence PCM from the shared audio renderer. */ buffer: AudioBuffer;
      stream?: never;
      live?: never;
    }
  | {
      /** Long PCM is read only near the playhead. */ stream: PreviewPcmStream;
      buffer?: never;
      live?: never;
    }
  | { /** Mixed while playing from the sources; nothing is prepared. */ live: LivePreviewAudio;
      buffer?: never;
      stream?: never;
    }
);
export interface EditorPreviewOptions extends EditorMediaPoolOptions {
  onFrame?(time: Tick): void;
  onPlaybackChange?(playing: boolean): void;
  /** `video` means a picture source is still being prepared; both clocks hold until it is ready. */
  onBuffering?(buffering: boolean, reason?: "audio" | "video"): void;
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
  private readonly compositor = new FrameCompositor({ gpuColor: true });
  private document?: EditorDocument;
  private sequence?: EditorSequence;
  private evaluator?: ReturnType<typeof prepareEvaluator>;
  private audioContext?: AudioContext;
  private audioSource?: AudioBufferSourceNode;
  private audioStream?: StreamingPreviewAudio;
  private liveMixer?: LiveAudioMixer;
  private auditionGain?: GainNode;
  private buffering?: "audio" | "video";
  private request?: AbortController;
  private generation = 0;
  private disposed = false;
  private isPlaying = false;
  private playhead = 0;
  /** Only a committed frame can be reused when resuming; pointer drafts cannot. */
  private renderedTime?: Tick;
  private resolution: PreviewResolution = 1;
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
    this.pool = new EditorMediaPool({
      ...options,
      resolveTimeoutMs: options.resolveTimeoutMs ?? PREVIEW_PREPARATION_TIMEOUT_MS,
    });
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
  private setBuffering(reason?: "audio" | "video"): void {
    if (reason === this.buffering) return;
    this.buffering = reason;
    this.options.onBuffering?.(reason !== undefined, reason);
  }
  private active(): void {
    if (this.disposed) throw new Error("预览已关闭");
  }

  /** Replace a frozen snapshot after every committed edit; old decode results cannot overwrite it. */
  setDocument(value: EditorDocument, sequenceId = value.activeSequenceId, options: { preserveMedia?: boolean } = {}): void {
    this.active();
    const valid = validateEditorDocument(value);
    const sequence = valid.sequences.find((item) => item.id === sequenceId);
    if (!sequence) throw new Error("预览序列不存在");
    const preserveMedia = options.preserveMedia && this.document?.id === valid.id &&
      this.sequence?.id === sequenceId &&
      editorVisualSourceKey(this.document, sequenceId) === editorVisualSourceKey(valid, sequenceId);
    this.pause();
    if (!preserveMedia) this.pool.reset();
    this.renderedTime = undefined;
    this.document = valid;
    this.sequence = sequence;
    this.evaluator = prepareEvaluator(valid);
    this.checkFonts();
    this.playhead = Math.min(this.playhead, Math.max(0, sequenceDuration(sequence) - 1));
  }
  /** Applies a committed edit without stopping playback. The picture sources, canvas,
   * frame rate and duration must be unchanged; a sound edit needs a live mix whose
   * sources are already playing. Returns false when playback has to restart. */
  updatePlayback(value: EditorDocument, sequenceId: string, audio?: PreviewAudio): boolean {
    if (!this.isPlaying || !this.document || !this.sequence || this.disposed) return false;
    const valid = validateEditorDocument(value),
      sequence = valid.sequences.find((item) => item.id === sequenceId),
      current = this.sequence;
    if (
      !sequence ||
      valid.id !== this.document.id ||
      sequence.id !== current.id ||
      sequence.width !== current.width ||
      sequence.height !== current.height ||
      sequence.frameRate.numerator !== current.frameRate.numerator ||
      sequence.frameRate.denominator !== current.frameRate.denominator ||
      sequenceDuration(sequence) !== sequenceDuration(current) ||
      editorVisualSourceKey(valid, sequenceId) !== editorVisualSourceKey(this.document, sequenceId)
    )
      return false;
    if (audio) {
      if (!this.liveMixer || !audio.live || audio.documentId !== valid.id ||
          audio.revision !== valid.revision || audio.live.plan.sequenceId !== sequenceId ||
          audio.live.plan.sampleCount !== Math.ceil(sequenceDuration(sequence) / 5))
        return false;
      try {
        this.liveMixer.update(audio.live);
      } catch {
        return false;
      }
    }
    this.document = valid;
    this.sequence = sequence;
    this.evaluator = prepareEvaluator(valid);
    this.renderedTime = undefined;
    this.checkFonts();
    return true;
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
    this.compositor.draw(this.canvas, frame, media, this.resolution);
    this.renderedTime = draft ? undefined : time;
    this.playhead = time;
    this.options.onFrame?.(time);
  }
  /** A viewer setting only; reports whether this request committed a frame. */
  async setResolution(value: PreviewResolution, time = this.playhead): Promise<boolean> {
    this.active();
    if (![1, 0.5, 0.25].includes(value)) throw new Error("预览质量无效");
    if (value === this.resolution) return false;
    this.pause();
    this.resolution = value;
    this.renderedTime = undefined;
    this.compositor.dispose();
    const operation = this.seek(time, { exact: true }),
      generation = this.generation;
    await operation;
    return !this.disposed && generation === this.generation && this.renderedTime !== undefined;
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
  /** Shows the frame containing `time`; `exact` draws that very tick (e.g. a clip's start). */
  async seek(time: Tick, options: { exact?: boolean } = {}): Promise<void> {
    const { sequence } = this.snapshot();
    const snapped = this.snap(time, sequence),
      target = options.exact ? Math.min(time, Math.max(0, sequenceDuration(sequence) - 1)) : snapped;
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
  /** Capture one committed composition at the viewer resolution; superseded work never returns PNG. */
  async captureFrame(time: Tick, signal: AbortSignal): Promise<{ blob: Blob; time: Tick; width: number; height: number }> {
    const { document, sequence } = this.snapshot(), duration = sequenceDuration(sequence);
    if (!duration) throw new Error("时间轴没有可保存的画面");
    if (signal.aborted) throw new DOMException("已取消保存画面", "AbortError");
    const target = Math.min(time, duration - 1), resolution = this.resolution,
      work = this.seek(target, { exact: true }), generation = this.generation;
    const abort = () => { if (generation === this.generation) this.pause(); };
    signal.addEventListener("abort", abort, { once: true });
    const current = () => !signal.aborted && !this.disposed && generation === this.generation &&
      this.document === document && this.sequence === sequence && this.resolution === resolution &&
      this.renderedTime === target;
    try {
      await work;
      if (!current()) throw new DOMException("画面已变化，请重新保存", "AbortError");
      const width = this.canvas.width, height = this.canvas.height,
        blob = await new Promise<Blob>((resolve, reject) => this.canvas.toBlob(
          (value) => value?.size ? resolve(value) : reject(new Error("无法编码画面 PNG")), "image/png"));
      if (!current()) throw new DOMException("画面已变化，请重新保存", "AbortError");
      return { blob, time: target, width, height };
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  /** Signed additive stem gain; the full mix remains at unity. */
  setAuditionGain(delta: number): void {
    if (!Number.isFinite(delta) || delta < -4 || delta > 4) throw new Error("试听音量无效");
    if (this.auditionGain && this.audioContext) this.auditionGain.gain.setValueAtTime(delta, this.audioContext.currentTime);
  }
  async play(audio?: PreviewAudio, correction?: { audio: PreviewAudio; gain: number }): Promise<void> {
    const { document, sequence } = this.snapshot();
    const duration = sequenceDuration(sequence);
    if (!duration) throw new Error("时间轴没有可播放的内容");
    this.pause();
    const needsAudio = hasPotentialAudio(document, sequence);
    const shape = (value: PreviewAudio) => value.live
      ? { rate: 48000, channels: 2, seconds: value.live.plan.sampleCount / 48000, sequenceId: value.live.plan.sequenceId }
      : { rate: (value.buffer ?? value.stream).sampleRate, channels: (value.buffer ?? value.stream).numberOfChannels,
          seconds: value.buffer?.duration ?? value.stream!.sampleCount / 48000, sequenceId: value.sequenceId };
    if (
      [audio, correction?.audio].some((audio) => audio &&
      (audio.documentId !== document.id ||
        audio.revision !== document.revision ||
        audio.sequenceId !== sequence.id ||
        shape(audio).sequenceId !== sequence.id ||
        shape(audio).rate !== 48000 ||
        shape(audio).channels !== 2 ||
        Math.abs(shape(audio).seconds - ticksToSeconds(duration)) > 1 / 48000 + 0.000001))
    )
      throw new Error("声音预览与当前工程版本不一致，请重新准备声音");
    if (correction && (!audio || !Number.isFinite(correction.gain) || Math.abs(correction.gain) > 4))
      throw new Error("调音试听声音无效");
    if (correction && (audio?.live || correction.audio.live))
      throw new Error("调音试听需要预渲染的声音，请重新开始试听");
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
      const startSample = Math.floor(ticksToSeconds(start) * 48000);
      // Sources heard at the start load while the first frame draws.
      const mixer = audio?.live ? new LiveAudioMixer(this.audioContext!, audio.live) : undefined;
      this.liveMixer = mixer;
      await Promise.all([
        this.renderedTime !== start ? this.draw(start, request.signal, generation) : undefined,
        mixer?.prepare(startSample, request.signal),
      ]);
      if (request.signal.aborted || generation !== this.generation) return;
      const clock = audio ? () => this.audioContext!.currentTime : () => performance.now() / 1000;
      // The audio and image clock share this origin; decoder currentTime is never a clock.
      let origin = clock();
      if (audio?.buffer && !correction) {
        this.audioSource = this.audioContext!.createBufferSource();
        this.audioSource.buffer = audio.buffer;
        this.audioSource.connect(this.audioContext!.destination);
        this.audioSource.start(origin, ticksToSeconds(start));
      }
      mixer?.start(origin, startSample);
      // Live audio never reaches here: it has no PCM and is rejected with an audition.
      const asStream = (value: PreviewAudio): PreviewPcmStream => value.stream ?? {
        sampleRate: 48000, numberOfChannels: 2, sampleCount: value.buffer!.length,
        read: async (offset, count, signal) => {
          if (signal.aborted) throw new DOMException("声音播放已取消", "AbortError");
          return [value.buffer!.getChannelData(0).slice(offset, offset + count), value.buffer!.getChannelData(1).slice(offset, offset + count)];
        }, dispose() {},
      };
      if (correction) {
        this.auditionGain = this.audioContext!.createGain();
        this.auditionGain.connect(this.audioContext!.destination);
        this.setAuditionGain(correction.gain);
      }
      if (audio && (audio.stream || correction)) {
        const stream = new StreamingPreviewAudio(
          this.audioContext!,
          asStream(audio),
          startSample,
          request.signal,
          (error) => {
            if (request.signal.aborted || generation !== this.generation) return;
            this.pause();
            this.options.onError?.(error);
          },
          correction ? { pcm: asStream(correction.audio), destination: this.auditionGain! } : undefined,
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
          ? stream.sample >= (audio!.stream?.sampleCount ?? audio!.buffer!.length)
            ? duration
            : start + (stream.sample - startSample) * 5
          : start + secondsToTicks(Math.max(0, clock() - origin));
        this.setBuffering(stream?.buffering ? "audio" : undefined);
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
            // A source still being prepared holds both clocks; sound must not run ahead of
            // the picture, and the waiting time must not be skipped when it arrives.
            const drawStarted = clock();
            let stalled = false;
            const stall = setTimeout(() => {
              if (request.signal.aborted || generation !== this.generation) return;
              stalled = true;
              // Sound already heard cannot be taken back; it stays the master clock.
              if (audio) void this.audioContext!.suspend();
              this.liveMixer?.hold();
              this.setBuffering("video");
            }, 400);
            try {
              await this.draw(target, request.signal, generation);
            } finally {
              clearTimeout(stall);
              if (stalled && !request.signal.aborted && generation === this.generation) {
                if (audio) await this.audioContext!.resume();
                else origin += clock() - drawStarted;
                this.liveMixer?.resume();
                this.setBuffering(undefined);
              }
            }
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
    this.liveMixer?.stop();
    this.liveMixer = undefined;
    this.auditionGain?.disconnect();
    this.auditionGain = undefined;
    this.setBuffering(undefined);
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
