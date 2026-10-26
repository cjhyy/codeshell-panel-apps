import {
  AUDIO_SAMPLE_RATE,
  audioLaneNeedsSource,
  sampleAudioLane,
  type AudioPlan,
  type AudioPlanLane,
} from "./audio-plan";
import { ticksToSeconds } from "./time";

/** A preview mix played from the sources themselves: no prepared PCM, so edits need no
 * native task. Export keeps the native renderer; both read gain and pan from the plan. */
export interface LivePreviewAudio {
  plan: AudioPlan;
  /** Same-origin playable source URL for every audible asset. */
  sources: ReadonlyMap<string, string>;
}

const MAX_LIVE_LANES = 24;
const unity = (rate: number) => Math.abs(rate - 1) < 1e-9;

/** Media elements play forward at their own rate. Anything else keeps the prerendered mix. */
export function liveAudioUnsupported(plan: AudioPlan): string | undefined {
  if (plan.ducking.length) return "自动压低背景声需要预渲染混音";
  const lanes = plan.lanes.filter(audioLaneNeedsSource);
  if (lanes.length > MAX_LIVE_LANES) return "同时发声的片段过多，需要预渲染混音";
  for (const lane of lanes) {
    if (lane.spans.some((span) => span.playbackRate < 0)) return "倒放需要预渲染混音";
    if (lane.spans.some((span) => span.playbackRate && !unity(span.playbackRate)))
      return "变速需要预渲染混音";
    if (lane.stages.some((stage) => stage.audio.pitchSemitones !== 0)) return "变调需要预渲染混音";
  }
  return undefined;
}

/** Only a source this browser can open may play live; others keep the prepared mix. */
export function canPlayLiveAudio(url: string, signal: AbortSignal, timeoutMs = 8_000): Promise<boolean> {
  return new Promise((resolve) => {
    const element = new Audio();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      element.removeAttribute("src");
      element.load();
      resolve(ok);
    };
    const abort = () => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);
    element.crossOrigin = "anonymous";
    element.preload = "metadata";
    element.addEventListener("loadedmetadata", () => done(true), { once: true });
    element.addEventListener("error", () => done(false), { once: true });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else element.src = url;
  });
}

/** A live mix needs every audible source to open in this browser; any miss keeps the
 * prepared mix. Muted, silent and held clips need no source. */
export async function resolveLivePreviewAudio(
  plan: AudioPlan,
  resolveUrl: (assetId: string, signal: AbortSignal) => Promise<string>,
  signal: AbortSignal,
  canPlay: (url: string, signal: AbortSignal) => Promise<boolean> = canPlayLiveAudio,
): Promise<LivePreviewAudio | undefined> {
  if (liveAudioUnsupported(plan)) return undefined;
  const sources = new Map<string, string>();
  for (const assetId of new Set(plan.lanes.filter(audioLaneNeedsSource).map((lane) => lane.assetId))) {
    let url: string;
    try {
      url = await resolveUrl(assetId, signal);
    } catch {
      return undefined;
    }
    if (signal.aborted || !(await canPlay(url, signal))) return undefined;
    sources.set(assetId, url);
  }
  return { plan, sources };
}

// Media sync follows HyperFrames: small drift is inaudible, moderate drift is corrected by
// nudging the element's rate, and only a large jump seeks (which is audible).
const DRIFT_IGNORE = 0.04,
  DRIFT_SETTLED = 0.01,
  DRIFT_SEEK = 0.5,
  RATE_NUDGE = 0.03;
/** Gain and pan are scheduled this far ahead, so a late timer cannot step the level. */
const LOOKAHEAD = 0.05;
const TICK_MS = 25;

interface Voice {
  lane: AudioPlanLane;
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  panner: StereoPannerNode;
  span: number;
}
const cancelled = () => new DOMException("声音播放已取消", "AbortError");

function ready(element: HTMLAudioElement, seconds: number, signal: AbortSignal, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const events = ["loadedmetadata", "seeked", "canplay", "canplaythrough"];
    let sought = false;
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      for (const event of events) element.removeEventListener(event, inspect);
      element.removeEventListener("error", failed);
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    const inspect = () => {
      if (element.readyState >= HTMLMediaElement.HAVE_METADATA && !sought) {
        sought = true;
        element.currentTime = seconds;
      }
      if (sought && !element.seeking && element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) finish();
    };
    const failed = () => finish(new Error("浏览器无法播放这段声音素材"));
    const abort = () => finish(cancelled());
    const timer = setTimeout(() => finish(new Error("声音素材加载超时")), timeoutMs);
    for (const event of events) element.addEventListener(event, inspect);
    element.addEventListener("error", failed);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else inspect();
  });
}

/** One element per audible clip instance, routed element → gain → pan → destination. */
export class LiveAudioMixer {
  private voices: Voice[] = [];
  private origin = 0;
  private startSample = 0;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(
    private readonly context: AudioContext,
    private readonly live: LivePreviewAudio,
    private readonly destination: AudioNode = context.destination,
  ) {}

  private spanAt(lane: AudioPlanLane, sample: number): number {
    return lane.spans.findIndex((span) => sample >= span.startSample && sample < span.endSample);
  }

  /** Only sources heard at the start delay playback; later clips load while playing. */
  async prepare(startSample: number, signal: AbortSignal, timeoutMs = 15_000): Promise<void> {
    if (this.voices.length || this.stopped) throw new Error("实时混音只能准备一次");
    for (const lane of this.live.plan.lanes.filter(audioLaneNeedsSource)) {
      const url = this.live.sources.get(lane.assetId);
      if (!url) throw new Error(`声音素材暂不可用：${lane.assetId}`);
      const element = new Audio();
      element.crossOrigin = "anonymous";
      element.preload = "auto";
      element.src = url;
      const source = this.context.createMediaElementSource(element),
        gain = this.context.createGain(),
        panner = this.context.createStereoPanner();
      gain.gain.value = 0;
      source.connect(gain).connect(panner).connect(this.destination);
      this.voices.push({ lane, element, source, gain, panner, span: -1 });
    }
    await Promise.all(
      this.voices.map((voice) => {
        const state = sampleAudioLane(voice.lane, startSample);
        return state ? ready(voice.element, ticksToSeconds(state.sourceTime), signal, timeoutMs) : undefined;
      }),
    );
    if (signal.aborted || this.stopped) throw cancelled();
  }

  private sampleNow(): number {
    return Math.max(0, this.startSample + Math.floor((this.context.currentTime - this.origin) * AUDIO_SAMPLE_RATE));
  }

  private tick = () => {
    if (this.stopped) return;
    const now = this.sampleNow(),
      ahead = now + Math.round(LOOKAHEAD * AUDIO_SAMPLE_RATE),
      at = this.context.currentTime + LOOKAHEAD;
    for (const voice of this.voices) {
      const { element, lane } = voice,
        future = sampleAudioLane(lane, ahead);
      voice.gain.gain.linearRampToValueAtTime(future?.gain ?? 0, at);
      voice.panner.pan.linearRampToValueAtTime(future?.pan ?? 0, at);
      const state = sampleAudioLane(lane, now);
      if (!state) {
        if (!element.paused) element.pause();
        voice.span = -1;
        continue;
      }
      const target = ticksToSeconds(state.sourceTime),
        span = this.spanAt(lane, now),
        drift = target - element.currentTime;
      // A new span may start anywhere in the source; never glide into it.
      if (span !== voice.span || Math.abs(drift) > DRIFT_SEEK || element.paused) {
        if (span !== voice.span || Math.abs(drift) > DRIFT_IGNORE) element.currentTime = target;
        element.playbackRate = 1;
        voice.span = span;
        if (element.paused) void element.play().catch(() => {});
      } else if (Math.abs(drift) > DRIFT_IGNORE)
        element.playbackRate = 1 + Math.sign(drift) * RATE_NUDGE;
      else if (Math.abs(drift) <= DRIFT_SETTLED && element.playbackRate !== 1) element.playbackRate = 1;
    }
  };

  /** `contextTime` is the AudioContext time at which `startSample` is heard. */
  start(contextTime: number, startSample: number): void {
    if (this.stopped) throw cancelled();
    this.origin = contextTime;
    this.startSample = startSample;
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      const state = sampleAudioLane(voice.lane, startSample);
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(state?.gain ?? 0, now);
      voice.panner.pan.cancelScheduledValues(now);
      voice.panner.pan.setValueAtTime(state?.pan ?? 0, now);
      voice.span = -1;
    }
    this.tick();
    clearInterval(this.timer);
    this.timer = setInterval(this.tick, TICK_MS);
  }

  /** Holds every source while the picture waits and the AudioContext clock is suspended. */
  hold(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const voice of this.voices) voice.element.pause();
  }
  /** After `hold`, the clock continues where it froze; paused sources seek and play again. */
  resume(): void {
    if (this.stopped || this.timer) return;
    this.tick();
    this.timer = setInterval(this.tick, TICK_MS);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    for (const voice of this.voices) {
      voice.element.pause();
      try { voice.source.disconnect(); } catch {}
      try { voice.gain.disconnect(); } catch {}
      try { voice.panner.disconnect(); } catch {}
      voice.element.removeAttribute("src");
      voice.element.load();
    }
    this.voices = [];
  }
}
