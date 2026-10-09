import { compileAudioPlan, sampleAudioLane, type AudioPlanLane } from "./audio-plan";
import { FrameCompositor } from "./compositor";
import { prepareEvaluator } from "./evaluate";
import { EditorMediaPool, type ResolvedMediaResource } from "./media-pool";
import { frameToTicks, secondsToTicks, ticksToFrame, ticksToSeconds, type Tick } from "./time";
import type { EditorDocument } from "./types";
import { sequenceDuration, validateEditorDocument } from "./validation";

export interface BrowserExportOptions {
  document: EditorDocument;
  sequenceId: string;
  resolveAsset(assetId: string, signal: AbortSignal): Promise<string | ResolvedMediaResource>;
  signal: AbortSignal;
  assertCurrent(): void;
  onProgress?(time: Tick, duration: Tick): void;
}

/** The old browser path only admitted normal forward 1x audio. Keep that entire
 * subset, and reject advanced DSP before acquiring/playing any source. Native
 * export remains responsible for pitch-preserving stretch and ducking. */
export function browserExportReason(
  document: EditorDocument,
  sequenceId: string,
): string | undefined {
  const sequence = document.sequences.find((sequence) => sequence.id === sequenceId);
  if (!sequence || !sequenceDuration(sequence)) return "时间轴为空，请先添加素材";
  if (sequenceDuration(sequence) > secondsToTicks(600))
    return "浏览器实时导出当前支持 10 分钟内的序列";
  const plan = compileAudioPlan(document, sequenceId);
  if (
    plan.ducking.length ||
    plan.lanes.some(
      (lane) =>
        lane.stages.some((stage) => stage.audio.pitchSemitones !== 0) ||
        lane.spans.some((span) => span.playbackRate !== 1),
    )
  )
    return "此工程的变速、变调或闪避混音需要原生导出，请在已连接的 CodeShell 工作区导出";
}

const cancelled = () => new DOMException("导出已取消", "AbortError");
function waitForEvent(
  target: EventTarget,
  name: string,
  signal: AbortSignal,
  start: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      target.removeEventListener(name, ready);
      target.removeEventListener("error", failed);
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    const ready = () => finish(),
      failed = () => finish(new Error("原始素材读取或编码失败")),
      abort = () => finish(cancelled());
    const timer = setTimeout(() => finish(new Error("原始素材读取或编码超时")), 15000);
    target.addEventListener(name, ready, { once: true });
    target.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else {
      try {
        start();
      } catch (error) {
        finish(error);
      }
    }
  });
}
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
function waitFor<T>(promise: Promise<T>, signal: AbortSignal, check: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown, value?: T) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearInterval(authority);
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value!);
    };
    const abort = () => finish(cancelled());
    const timeout = setTimeout(() => finish(new Error("原始素材读取或播放超时")), 15000);
    const authority = setInterval(() => {
      try {
        check();
      } catch (error) {
        finish(error);
      }
    }, 25);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(
      (value) => {
        if (!finished) {
          try {
            check();
            finish(undefined, value);
          } catch (error) {
            finish(error || new Error("原始素材读取或播放失败"));
          }
        }
      },
      (error) => finish(error || new Error("原始素材读取或播放失败")),
    );
  });
}
interface Voice {
  media: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  timelineOffset: Tick;
}

/** Independent decoders preserve overlapping uses of the same source. Nothing
 * is copied through a 30fps projection, nor decoded wholesale into unbounded PCM. */
class BrowserAudioVoices {
  private readonly voices = new Map<string, Voice>();
  private readonly draining = new Map<Voice, ReturnType<typeof setTimeout>>();
  constructor(
    private readonly context: AudioContext,
    private readonly destination: AudioNode,
    private readonly options: BrowserExportOptions,
    private readonly signal: AbortSignal,
    private readonly check: () => void,
  ) {}
  private release(voice: Voice): void {
    voice.media.pause();
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.pan.disconnect();
    voice.media.removeAttribute("src");
    voice.media.load();
  }
  dispose(): void {
    for (const voice of this.voices.values()) this.release(voice);
    this.voices.clear();
    for (const [voice, timer] of this.draining) {
      clearTimeout(timer);
      this.release(voice);
    }
    this.draining.clear();
  }
  pause(): void {
    for (const voice of this.voices.values()) voice.media.pause();
  }
  position(): Tick | undefined {
    const voice = this.voices.values().next().value;
    return voice ? voice.timelineOffset + secondsToTicks(voice.media.currentTime) : undefined;
  }
  private async voice(lane: AudioPlanLane): Promise<Voice> {
    const previous = this.voices.get(lane.instanceId);
    if (previous) return previous;
    const resource = await waitFor(
      Promise.resolve().then(() => {
        this.check();
        return this.options.resolveAsset(lane.assetId, this.signal);
      }),
      this.signal,
      this.check,
    );
    const url = typeof resource === "string" ? resource : resource.url;
    const media = document.createElement("audio");
    if (/^https?:$/.test(new URL(url, location.href).protocol)) media.crossOrigin = "anonymous";
    media.preload = "auto";
    try {
      this.check();
      await waitForEvent(media, "loadeddata", this.signal, () => {
        media.src = url;
      });
      this.check();
      const source = this.context.createMediaElementSource(media),
        gain = this.context.createGain(),
        pan = this.context.createStereoPanner();
      // An explicit stereo bus keeps centered mono at the same gain as the
      // original browser exporter; StereoPanner then follows native stereo semantics.
      gain.channelCount = 2;
      gain.channelCountMode = "explicit";
      source.connect(gain).connect(pan).connect(this.destination);
      const voice = {
        media,
        source,
        gain,
        pan,
        timelineOffset: 0,
      };
      this.voices.set(lane.instanceId, voice);
      return voice;
    } catch (error) {
      media.pause();
      media.removeAttribute("src");
      media.load();
      throw error;
    }
  }
  needsPreparation(lanes: readonly AudioPlanLane[], time: Tick): boolean {
    return lanes.some((lane) => {
      const state = sampleAudioLane(lane, Math.floor(time / 5));
      return state && state.gain > 0 && !this.voices.has(lane.instanceId);
    });
  }
  async sync(lanes: readonly AudioPlanLane[], time: Tick, play = true): Promise<void> {
    this.check();
    const active = new Set<string>();
    const states = lanes
      .map((lane) => ({ lane, state: sampleAudioLane(lane, Math.floor(time / 5)) }))
      .filter((item) => item.state && item.state.gain > 0);
    for (const { lane } of states) active.add(lane.instanceId);
    for (const [id, voice] of this.voices)
      if (!active.has(id)) {
        voice.media.pause();
        this.draining.set(
          voice,
          setTimeout(
            () => {
              this.draining.delete(voice);
              this.release(voice);
            },
            40 + this.context.baseLatency * 1000,
          ),
        );
        this.voices.delete(id);
      }
    const starting: Promise<void>[] = [];
    for (const { lane, state } of states) {
      const voice = await this.voice(lane);
      this.check();
      const seconds = ticksToSeconds(state!.sourceTime);
      if (
        voice.media.ended &&
        seconds >= voice.media.currentTime - 1 / 48000 &&
        sampleAudioLane(lane, Math.floor(time / 5) + 1)
      )
        throw new Error("原始声音已提前结束，未生成导出文件");
      if (voice.media.paused || Math.abs(voice.media.currentTime - seconds) > 0.15) {
        if (Math.abs(voice.media.currentTime - seconds) > 0.000001)
          await waitForEvent(voice.media, "seeked", this.signal, () => {
            voice.media.currentTime = seconds;
          });
        this.check();
        voice.timelineOffset = time - state!.sourceTime;
        voice.gain.gain.setValueAtTime(state!.gain, this.context.currentTime);
        voice.pan.pan.setValueAtTime(state!.pan, this.context.currentTime);
        if (play) starting.push(waitFor(voice.media.play(), this.signal, this.check));
      } else {
        voice.gain.gain.setValueAtTime(state!.gain, this.context.currentTime);
        voice.pan.pan.setValueAtTime(state!.pan, this.context.currentTime);
      }
      if (voice.media.error) throw new Error("原始声音播放失败，未生成导出文件");
    }
    await Promise.all(starting);
    this.check();
  }
}

/** Real-time WebM is an encoder preview, not an offline frame/sample-exact file.
 * Its source/timeline clock is nevertheless the complete immutable tick document.
 * Encoding may add a final video frame/Opus packet; it never changes saved timing. */
export async function recordEditorSequence(input: BrowserExportOptions): Promise<Blob> {
  const frozen = validateEditorDocument(structuredClone(input.document));
  const ownedUrls = new Set<string>();
  let mediaReleased = false;
  const options: BrowserExportOptions = {
    ...input,
    document: frozen,
    resolveAsset: async (id, requestSignal) => {
      check();
      const result = await input.resolveAsset(id, requestSignal);
      const resource = typeof result === "string" ? { url: result, owned: false } : result;
      if (
        !resource ||
        typeof resource.url !== "string" ||
        !resource.url.trim() ||
        (resource.owned !== undefined && typeof resource.owned !== "boolean") ||
        (resource.owned && !resource.url.startsWith("blob:"))
      )
        throw new Error("素材资源 URL 或所有权无效");
      if (resource.owned) {
        const first = !ownedUrls.has(resource.url);
        ownedUrls.add(resource.url);
        if (mediaReleased) {
          if (first) URL.revokeObjectURL(resource.url);
          throw cancelled();
        }
      }
      check();
      // Picture and sound can share one owned URL. The export owns their common
      // lifetime; both decoder pools receive borrowed URLs until final cleanup.
      return resource.url;
    },
  };
  const reason = browserExportReason(frozen, options.sequenceId);
  if (reason) throw new Error(reason);
  if (document.visibilityState !== "visible") throw new Error("请保持视频工作台可见，再开始导出");
  if (typeof MediaRecorder === "undefined")
    throw new Error("此浏览器不支持视频导出，请使用新版 Chromium");
  const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(
    (type) => MediaRecorder.isTypeSupported(type),
  );
  if (!mimeType) throw new Error("此环境没有可用的 WebM 编码器");
  const controller = new AbortController(),
    signal = controller.signal;
  let visibilityError: Error | undefined, authorityError: unknown;
  const abort = () => controller.abort(),
    visibility = () => {
      if (document.visibilityState !== "visible") {
        visibilityError = new Error("工作台已进入后台，导出已停止");
        abort();
      }
    };
  input.signal.addEventListener("abort", abort, { once: true });
  document.addEventListener("visibilitychange", visibility);
  if (input.signal.aborted) abort();
  const check = () => {
    if (signal.aborted) throw authorityError ?? visibilityError ?? cancelled();
    options.assertCurrent();
  };
  // Ownership can be replaced while a decoder, resolver or encoder await is pending.
  const authority = setInterval(() => {
    try {
      check();
    } catch (error) {
      authorityError = error;
      abort();
    }
  }, 25);
  const sequence = frozen.sequences.find((sequence) => sequence.id === options.sequenceId)!;
  const duration = sequenceDuration(sequence),
    audioPlan = compileAudioPlan(frozen, sequence.id);
  const evaluator = prepareEvaluator(frozen),
    compositor = new FrameCompositor();
  const pool = new EditorMediaPool({ resolveAsset: options.resolveAsset });
  const canvas = document.createElement("canvas");
  let context: AudioContext | undefined,
    voices: BrowserAudioVoices | undefined,
    stream: MediaStream | undefined,
    recorder: MediaRecorder | undefined;
  let destinationStream: MediaStream | undefined;
  let silence: ConstantSourceNode | undefined;
  let recordingError: Error | undefined;
  const chunks: Blob[] = [];
  let stopped: Promise<void> | undefined;
  const draw = async (time: Tick) => {
    check();
    const frame = evaluator.evaluate(sequence.id, time);
    const media = await pool.prepare(frame, signal);
    check();
    compositor.draw(canvas, frame, media);
    (stream?.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined)?.requestFrame();
  };
  try {
    check();
    await draw(0);
    check();
    context = new AudioContext();
    await waitFor(context.resume(), signal, check);
    check();
    if (context.state !== "running") throw new Error("请点击导出按钮启用声音");
    const destination = context.createMediaStreamDestination();
    destinationStream = destination.stream;
    // Keep the capture audio clock alive through fully muted/silent sequences.
    // Chromium otherwise waits for the first rendered audio block indefinitely.
    silence = context.createConstantSource();
    silence.offset.value = 0;
    silence.connect(destination);
    silence.start();
    voices = new BrowserAudioVoices(context, destination, options, signal, check);
    await voices.sync(audioPlan.lanes, 0, false);
    check();
    stream = canvas.captureStream(sequence.frameRate.numerator / sequence.frameRate.denominator);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6000000 });
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => {
      recordingError = new Error("视频编码失败，请降低画布尺寸后重试");
      abort();
    };
    stopped = new Promise((resolve) => {
      recorder!.onstop = () => resolve();
    });
    // Preload/start the initial voices before starting the capture clock. While a
    // source is audible its decoded clock keeps the full tail (including Opus
    // pre-roll); silent spans advance from the AudioContext clock.
    recorder.start(1000);
    await voices.sync(audioPlan.lanes, 0);
    check();
    let previousClock = context.currentTime,
      elapsed = 0;
    let lastFrame = -1,
      lastDraw = previousClock,
      lastAdvance = performance.now();
    while (true) {
      check();
      const now = context.currentTime;
      const next = Math.max(
        elapsed,
        voices.position() ?? elapsed + secondsToTicks(Math.max(0, now - previousClock)),
      );
      if (next > elapsed) lastAdvance = performance.now();
      else if (performance.now() - lastAdvance > 15000)
        throw new Error("原始声音播放已停滞，未生成导出文件");
      elapsed = next;
      previousClock = now;
      const time = Math.min(duration - 1, elapsed);
      if (elapsed >= duration) break;
      if (voices.needsPreparation(audioPlan.lanes, time)) {
        await waitForEvent(recorder, "pause", signal, () => recorder!.pause());
        check();
        voices.pause();
        await voices.sync(audioPlan.lanes, time, false);
        check();
        await waitForEvent(recorder, "resume", signal, () => recorder!.resume());
        check();
        previousClock = context.currentTime;
      }
      await voices.sync(audioPlan.lanes, time);
      check();
      const frame = ticksToFrame(time, sequence.frameRate, "floor");
      if (frame !== lastFrame) {
        await draw(frameToTicks(frame, sequence.frameRate));
        check();
        lastFrame = frame;
        lastDraw = context.currentTime;
      }
      options.onProgress?.(time, duration);
      await delay(8, signal);
      check();
    }
    voices.pause();
    // Ensure the last partial frame is actually presented to the encoder before stop.
    const finalFrame = ticksToFrame(duration - 1, sequence.frameRate, "floor");
    if (lastFrame !== finalFrame) {
      await draw(frameToTicks(finalFrame, sequence.frameRate));
      lastDraw = context.currentTime;
    }
    const frameSeconds = sequence.frameRate.denominator / sequence.frameRate.numerator;
    await delay(Math.max(0, (lastDraw + frameSeconds - context.currentTime) * 1000), signal);
    check();
    // MediaElementAudioSource and the real-time Opus encoder retain queued audio
    // after the element reaches its end. Keep the graph connected through two
    // 20ms Opus packets plus the context's reported render latency before stop.
    await delay(40 + context.baseLatency * 1000, signal);
    check();
    options.onProgress?.(duration, duration);
  } finally {
    clearInterval(authority);
    input.signal.removeEventListener("abort", abort);
    document.removeEventListener("visibilitychange", visibility);
    const cleanupErrors: unknown[] = [];
    const release = (action: () => void) => {
      try {
        action();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    try {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const completed = await Promise.race([
          stopped!.then(() => true),
          new Promise<false>((resolve) => {
            timeout = setTimeout(() => resolve(false), 3000);
          }),
        ]);
        clearTimeout(timeout);
        if (!completed) recordingError ??= new Error("编码器未完成收尾，未生成导出文件");
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    release(() => voices?.dispose());
    release(() => silence?.stop());
    release(() => silence?.disconnect());
    for (const track of new Set([
      ...(stream?.getTracks() ?? []),
      ...(destinationStream?.getTracks() ?? []),
    ]))
      release(() => track.stop());
    try {
      await context?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    release(() => pool.dispose());
    release(() => compositor.dispose());
    canvas.width = canvas.height = 1;
    mediaReleased = true;
    for (const url of ownedUrls) release(() => URL.revokeObjectURL(url));
    if (cleanupErrors.length)
      recordingError ??= new Error("导出资源清理失败，未生成导出文件", { cause: cleanupErrors[0] });
  }
  check();
  if (recordingError) throw recordingError;
  if (!chunks.length) throw new Error("编码器没有生成有效视频");
  return new Blob(chunks, { type: mimeType });
}
