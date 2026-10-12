/** An immutable 48 kHz stereo source, addressed in exact sample frames. */
export interface PreviewPcmStream {
  sampleRate: 48000;
  numberOfChannels: 2;
  sampleCount: number;
  read(start: number, count: number, signal: AbortSignal): Promise<[Float32Array, Float32Array]>;
  dispose(): void;
}
interface ScheduledChunk {
  source: AudioBufferSourceNode;
  correction?: AudioBufferSourceNode;
  start: number;
  end: number;
  sample: number;
  count: number;
}
const RATE = 48000,
  CHUNK = RATE * 2,
  AHEAD = 6,
  LEAD = 0.035;
const cancelled = () => new DOMException("声音播放已取消", "AbortError");

/** Schedules bounded contiguous PCM blocks. The clock advances only through scheduled
 * audio: if a read stalls, video holds at the last heard sample instead of skipping sound. */
export class StreamingPreviewAudio {
  private readonly abort = new AbortController();
  private readonly chunks: ScheduledChunk[] = [];
  private nextSample: number;
  private nextTime = 0;
  private position: number;
  private timer?: ReturnType<typeof setTimeout>;
  private work?: Promise<void>;
  private stopped = false;
  private ready = false;
  private readonly detach: () => void;
  constructor(
    private readonly context: AudioContext,
    private readonly pcm: PreviewPcmStream,
    startSample: number,
    signal: AbortSignal,
    private readonly onError: (error: unknown) => void,
    private readonly correction?: { pcm: PreviewPcmStream; destination: AudioNode },
  ) {
    if (!Number.isSafeInteger(startSample) || startSample < 0 || startSample >= pcm.sampleCount)
      throw new Error("声音播放起点无效");
    if (correction && (correction.pcm.sampleCount !== pcm.sampleCount || correction.pcm.sampleRate !== RATE || correction.pcm.numberOfChannels !== 2))
      throw new Error("调音试听声音长度不一致");
    this.nextSample = this.position = startSample;
    const stop = () => this.stop();
    this.detach = () => signal.removeEventListener("abort", stop);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) this.stop();
  }
  private check(): void {
    if (this.stopped) throw cancelled();
  }
  get sample(): number {
    const now = this.context.currentTime;
    for (const chunk of this.chunks) {
      if (now < chunk.start) break;
      this.position = Math.max(
        this.position,
        chunk.sample +
          Math.min(chunk.count, Math.max(0, Math.floor((now - chunk.start) * RATE + 1e-6))),
      );
    }
    while (this.chunks.length && this.chunks[0]!.end <= now) {
      const chunk = this.chunks.shift()!;
      this.position = Math.max(this.position, chunk.sample + chunk.count);
      chunk.source.disconnect();
      chunk.correction?.disconnect();
    }
    return Math.min(this.pcm.sampleCount, this.position);
  }
  get buffering(): boolean {
    const sample = this.sample;
    return (
      sample < this.pcm.sampleCount &&
      !this.chunks.some(
        (chunk) => this.context.currentTime >= chunk.start && this.context.currentTime < chunk.end,
      )
    );
  }
  private async enqueue(): Promise<void> {
    this.check();
    const count = Math.min(CHUNK, this.pcm.sampleCount - this.nextSample),
      start = this.nextSample;
    if (count <= 0) return;
    // Both sources must be ready before scheduling either: slow reads cannot drift the stem.
    const blocks = await Promise.all([
      this.pcm.read(start, count, this.abort.signal),
      ...(this.correction ? [this.correction.pcm.read(start, count, this.abort.signal)] : []),
    ]);
    this.check();
    for (const block of blocks) {
      if (block.length !== 2 || block.some((channel) => !(channel instanceof Float32Array) || channel.length !== count))
        throw new Error("分段声音采样不完整");
      for (const channel of block) for (const value of channel)
        if (!Number.isFinite(value)) throw new Error("分段声音包含无效采样");
    }
    // Slow reads start a new contiguous interval; the clock freezes through the gap.
    const at = Math.max(this.nextTime, this.context.currentTime + LEAD), end = at + count / RATE;
    const sources = blocks.map(([left, right], index) => {
      const buffer = this.context.createBuffer(2, count, RATE);
      buffer.getChannelData(0).set(left!);
      buffer.getChannelData(1).set(right!);
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(index ? this.correction!.destination : this.context.destination);
      return source;
    });
    this.chunks.push({ source: sources[0]!, correction: sources[1], start: at, end, sample: start, count });
    for (const source of sources) source.start(at);
    this.nextSample += count;
    this.nextTime = end;
  }
  private fill(): Promise<void> {
    if (this.work) return this.work;
    const work = (async () => {
      // Reading the clock also releases consumed buffers, keeping memory independent of duration.
      void this.sample;
      while (
        !this.stopped &&
        this.nextSample < this.pcm.sampleCount &&
        this.nextTime - this.context.currentTime < AHEAD
      ) {
        await this.enqueue();
        void this.sample;
      }
    })();
    this.work = work;
    return work.finally(() => {
      if (this.work === work) this.work = undefined;
    });
  }
  private schedule(): void {
    if (this.stopped || this.nextSample >= this.pcm.sampleCount) return;
    this.timer = setTimeout(() => {
      void this.fill()
        .then(() => this.schedule())
        .catch((error) => {
          if (this.stopped) return;
          this.stop();
          this.onError(error);
        });
    }, 150);
  }
  async start(): Promise<void> {
    if (this.ready) throw new Error("分段声音已开始播放");
    this.ready = true;
    try {
      // Wait for the first block, then let later reads proceed without delaying playback.
      await this.enqueue();
      this.check();
      void this.fill()
        .then(() => this.schedule())
        .catch((error) => {
          if (this.stopped) return;
          this.stop();
          this.onError(error);
        });
    } catch (error) {
      this.stop();
      throw error;
    }
  }
  stop(): void {
    if (this.stopped) return;
    void this.sample;
    this.stopped = true;
    this.abort.abort();
    this.detach();
    clearTimeout(this.timer);
    for (const chunk of this.chunks.splice(0)) {
      chunk.source.stop();
      chunk.correction?.stop();
      chunk.source.disconnect();
      chunk.correction?.disconnect();
    }
  }
}
