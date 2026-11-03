import {
  AUDIO_SAMPLE_RATE,
  audioLaneNeedsSource,
  sampleAudioLane,
  type AudioPlan,
  type AudioPlanLane,
} from "./audio-plan";
import { ticksToSeconds } from "./time";
import { DUCKING_PROCESSOR, duckingCoefficients } from "./ducking";

/** A preview mix played from the sources themselves: no prepared PCM, so edits need no
 * native task. Export keeps the native renderer; both read gain and pan from the plan. */
export interface LivePreviewAudio {
  plan: AudioPlan;
  /** Same-origin playable source URL for every audible asset. */
  sources: ReadonlyMap<string, string>;
  /** Packaged AudioWorklet module running the shared ducking detector, when loadable. */
  duckingModule?: string;
}

const MAX_LIVE_LANES = 24;
const unity = (rate: number) => Math.abs(rate - 1) < 1e-9;
/** A forward unit-rate clip with an open source keeps its element even while silent, so
 * raising its level during playback needs no load or seek. */
const voiced = (lane: AudioPlanLane, sources: ReadonlyMap<string, string>) =>
  sources.has(lane.assetId) &&
  lane.spans.some((span) => span.playbackRate !== 0) &&
  lane.spans.every((span) => span.playbackRate === 0 || unity(span.playbackRate));

/** Media elements play forward at their own rate. Anything else keeps the prerendered mix. */
export function liveAudioUnsupported(
  plan: AudioPlan,
  options: { ducking?: boolean } = {},
): string | undefined {
  if (plan.ducking.length && !options.ducking) return "自动压低背景声需要预渲染混音";
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

/** An edited plan can keep playing live only with sources that are already open. */
export function liveAudioWithSources(
  plan: AudioPlan,
  sources: ReadonlyMap<string, string>,
  duckingModule?: string,
): LivePreviewAudio | undefined {
  if (liveAudioUnsupported(plan, { ducking: !!duckingModule })) return undefined;
  if (plan.lanes.filter(audioLaneNeedsSource).some((lane) => !sources.has(lane.assetId))) return undefined;
  return { plan, sources, ...(duckingModule ? { duckingModule } : {}) };
}

/** A live mix needs every audible source to open in this browser; any miss keeps the
 * prepared mix. Muted, silent and held clips need no source. */
export async function resolveLivePreviewAudio(
  plan: AudioPlan,
  resolveUrl: (assetId: string, signal: AbortSignal) => Promise<string>,
  signal: AbortSignal,
  canPlay: (url: string, signal: AbortSignal) => Promise<boolean> = canPlayLiveAudio,
  duckingModule?: string,
): Promise<LivePreviewAudio | undefined> {
  if (liveAudioUnsupported(plan, { ducking: !!duckingModule })) return undefined;
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
  return { plan, sources, ...(duckingModule ? { duckingModule } : {}) };
}

const duckingModules = new Map<string, Promise<boolean>>();
/** Whether this page may load the packaged ducking worklet; checked once per URL. */
export function canLoadDuckingModule(url: string): Promise<boolean> {
  let known = duckingModules.get(url);
  if (!known) {
    known = new OfflineAudioContext(1, 128, AUDIO_SAMPLE_RATE).audioWorklet
      .addModule(url)
      .then(() => true, () => false);
    duckingModules.set(url, known);
  }
  return known;
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
  /** Ducking gains and sidechain weights owned by this voice's current wiring. */
  ducks: AudioNode[];
  span: number;
}
interface Detector {
  key: string;
  input: GainNode;
  node: AudioWorkletNode;
}
const loadedModules = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();
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
  private detectors = new Map<string, Detector>();
  constructor(
    private readonly context: AudioContext,
    private live: LivePreviewAudio,
    private readonly destination: AudioNode = context.destination,
  ) {}

  private voice(lane: AudioPlanLane): Voice {
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
    source.connect(gain).connect(panner);
    return { lane, element, source, gain, panner, ducks: [], span: -1 };
  }
  private release(voice: Voice): void {
    voice.element.pause();
    try { voice.source.disconnect(); } catch {}
    try { voice.gain.disconnect(); } catch {}
    try { voice.panner.disconnect(); } catch {}
    for (const node of voice.ducks) try { node.disconnect(); } catch {}
    voice.element.removeAttribute("src");
    voice.element.load();
  }

  private spanAt(lane: AudioPlanLane, sample: number): number {
    return lane.spans.findIndex((span) => sample >= span.startSample && sample < span.endSample);
  }

  private async loadDucking(signal: AbortSignal): Promise<void> {
    const url = this.live.duckingModule;
    if (!url) {
      if (this.live.plan.ducking.length) throw new Error("自动压低背景声需要预渲染混音");
      return;
    }
    let modules = loadedModules.get(this.context);
    if (!modules) loadedModules.set(this.context, (modules = new Map()));
    let loading = modules.get(url);
    if (!loading) modules.set(url, (loading = this.context.audioWorklet.addModule(url)));
    await loading;
    if (signal.aborted || this.stopped) throw cancelled();
  }

  /** Voice → [ducking gains] → destination; ducked by detectors fed from the sidechain
   * voices before their own ducking, as the native renderer's dry buses are. */
  private wire(): void {
    const context = this.context,
      requests = this.live.plan.ducking,
      next = new Map<string, Detector>();
    for (const request of requests) {
      const coefficients = duckingCoefficients(request),
        key = JSON.stringify(coefficients),
        kept = this.detectors.get(request.id);
      if (kept && kept.key === key) {
        kept.node.disconnect();
        next.set(request.id, kept);
        continue;
      }
      if (kept) { kept.input.disconnect(); kept.node.disconnect(); }
      const input = context.createGain(),
        node = new AudioWorkletNode(context, DUCKING_PROCESSOR, {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          channelCount: 2, channelCountMode: "explicit", processorOptions: coefficients,
        });
      input.connect(node);
      next.set(request.id, { key, input, node });
    }
    for (const [id, detector] of this.detectors)
      if (!next.has(id)) { detector.input.disconnect(); detector.node.disconnect(); }
    this.detectors = next;
    for (const voice of this.voices) {
      voice.panner.disconnect();
      for (const node of voice.ducks) node.disconnect();
      voice.ducks = [];
      let output: AudioNode = voice.panner;
      for (const id of voice.lane.duckingIds) {
        const detector = this.detectors.get(id);
        if (!detector) continue;
        const ducked = context.createGain();
        ducked.gain.value = 0;
        detector.node.connect(ducked.gain);
        output.connect(ducked);
        voice.ducks.push(ducked);
        output = ducked;
      }
      output.connect(this.destination);
      for (const request of requests) {
        // A clip on several sidechain buses of one request counts once per bus.
        const buses = request.sidechainTrackInstanceIds.filter((id) => voice.lane.trackInstancePath.includes(id)).length;
        if (!buses) continue;
        const input = this.detectors.get(request.id)!.input;
        if (buses === 1) voice.panner.connect(input);
        else {
          const weight = context.createGain();
          weight.gain.value = buses;
          voice.panner.connect(weight).connect(input);
          voice.ducks.push(weight);
        }
      }
    }
  }

  /** Only sources heard at the start delay playback; later clips load while playing. */
  async prepare(startSample: number, signal: AbortSignal, timeoutMs = 15_000): Promise<void> {
    if (this.voices.length || this.stopped) throw new Error("实时混音只能准备一次");
    for (const lane of this.live.plan.lanes) {
      if (voiced(lane, this.live.sources)) this.voices.push(this.voice(lane));
      else if (audioLaneNeedsSource(lane)) throw new Error(`声音素材暂不可用：${lane.assetId}`);
    }
    await this.loadDucking(signal);
    this.wire();
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

  /** Applies an edited plan while playing. A clip instance keeps its element and, when
   * its source mapping is unchanged, its position: a level change must not seek. */
  update(live: LivePreviewAudio): void {
    if (this.stopped) throw cancelled();
    if (live.plan.ducking.length && (!live.duckingModule || live.duckingModule !== this.live.duckingModule ||
        !loadedModules.get(this.context)?.has(live.duckingModule)))
      throw new Error("自动压低背景声需要重新开始播放");
    const previous = this.live;
    this.live = live;
    const existing = new Map(this.voices.map((voice) => [voice.lane.instanceId, voice])),
      next: Voice[] = [];
    try {
      for (const lane of live.plan.lanes) {
        if (!voiced(lane, live.sources)) continue;
        const voice = existing.get(lane.instanceId);
        if (voice && voice.lane.assetId === lane.assetId &&
            live.sources.get(lane.assetId) === previous.sources.get(lane.assetId)) {
          existing.delete(lane.instanceId);
          if (JSON.stringify(voice.lane.spans) !== JSON.stringify(lane.spans)) voice.span = -1;
          voice.lane = lane;
          next.push(voice);
        } else next.push(this.voice(lane));
      }
    } catch (error) {
      for (const voice of next) if (!this.voices.includes(voice)) this.release(voice);
      this.live = previous;
      throw error;
    }
    for (const voice of existing.values()) this.release(voice);
    this.voices = next;
    this.wire();
    if (this.timer) this.tick();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    for (const voice of this.voices) this.release(voice);
    this.voices = [];
    for (const detector of this.detectors.values()) { detector.input.disconnect(); detector.node.disconnect(); }
    this.detectors.clear();
  }
}
