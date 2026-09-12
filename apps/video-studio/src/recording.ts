export type RecordingMode = "microphone" | "camera" | "screen";
export type CapturePhase =
  | "idle"
  | "preparing"
  | "preview"
  | "recording"
  | "paused"
  | "stopping"
  | "ready"
  | "error";
export interface RecordingOptions {
  mode: RecordingMode;
  microphoneId?: string;
  cameraId?: string;
}
export interface RecordedTake {
  blob: Blob;
  kind: "audio" | "video";
  mimeType: string;
  durationSeconds: number;
  systemAudio: boolean;
}
export interface CaptureSnapshot {
  phase: CapturePhase;
  stream: MediaStream | null;
  systemAudio: boolean;
  elapsedSeconds: number;
  error: string;
  result: RecordedTake | null;
}
export interface RecordingDevice {
  id: string;
  name: string;
}
export interface RecordingDevices {
  microphones: RecordingDevice[];
  cameras: RecordingDevice[];
}
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_SECONDS = 20 * 60;
export const recordingLimits = { maxBytes: MAX_BYTES, maxSeconds: MAX_SECONDS };

export function captureError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return "未获得录制权限或已取消选择。请允许麦克风、摄像头或屏幕共享后重试。";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "没有找到所选麦克风或摄像头，请检查设备并刷新列表。";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "设备暂时无法使用，可能被其他应用占用。请关闭占用后重试。";
  if (name === "OverconstrainedError") return "所选设备已不可用，请重新选择设备。";
  return error instanceof Error ? error.message : String(error);
}
function mediaDevices(): MediaDevices {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("当前环境不支持录制。请使用允许麦克风权限的 CodeShell 桌面版或 HTTPS 浏览器。");
  return navigator.mediaDevices;
}
export async function listRecordingDevices(): Promise<RecordingDevices> {
  const devices = await mediaDevices().enumerateDevices();
  const list = (kind: MediaDeviceKind, fallback: string) =>
    devices
      .filter((device) => device.kind === kind && device.deviceId)
      .map((device, index) => ({
        id: device.deviceId,
        name: device.label || `${fallback} ${index + 1}`,
      }));
  return { microphones: list("audioinput", "麦克风"), cameras: list("videoinput", "摄像头") };
}
function preferredMime(kind: "audio" | "video"): string {
  if (typeof MediaRecorder === "undefined")
    throw new Error("当前环境不支持录制编码，请使用新版 CodeShell 或 Chromium 浏览器。");
  const candidates =
    kind === "audio"
      ? ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
      : ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm", "video/mp4"];
  const mime = candidates.find((value) => MediaRecorder.isTypeSupported(value));
  if (!mime) throw new Error("没有可用的录制编码器，请更换浏览器后重试。");
  return mime;
}

/** Owns every capture track. Preview, encoder errors, cancellation and late permission
 * responses all pass through the same cleanup; a result never owns live devices. */
export class CaptureRecorder {
  private phase: CapturePhase = "idle";
  private stream: MediaStream | null = null;
  private streams = new Set<MediaStream>();
  private audio: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private nodes: AudioNode[] = [];
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private result: RecordedTake | null = null;
  private error = "";
  private systemAudio = false;
  private kind: "audio" | "video" = "audio";
  private generation = 0;
  private startedAt = 0;
  private accumulated = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private stopping: Promise<RecordedTake | null> | null = null;
  private finishStop: ((result: RecordedTake | null) => void) | null = null;
  constructor(private changed: () => void = () => {}) {}
  get snapshot(): CaptureSnapshot {
    return {
      phase: this.phase,
      stream: this.stream,
      systemAudio: this.systemAudio,
      elapsedSeconds: this.elapsed(),
      error: this.error,
      result: this.result,
    };
  }
  private emit(): void {
    this.changed();
  }
  private elapsed(): number {
    return (
      this.accumulated +
      (this.phase === "recording" ? (performance.now() - this.startedAt) / 1000 : 0)
    );
  }
  level(): number {
    if (!this.analyser) return 0;
    const samples = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(samples);
    return Math.min(
      1,
      Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) * 4,
    );
  }
  private own(stream: MediaStream, generation: number): MediaStream {
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException("录制已取消", "AbortError");
    }
    this.streams.add(stream);
    return stream;
  }
  private cleanupTracks(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const tracks = new Set([...this.streams].flatMap((stream) => stream.getTracks()));
    tracks.forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.streams.clear();
    this.stream = null;
    this.nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        /* Already disconnected. */
      }
    });
    this.nodes = [];
    const audio = this.audio;
    this.audio = null;
    this.analyser = null;
    if (audio && audio.state !== "closed") void audio.close().catch(() => {});
  }
  async prepare(options: RecordingOptions): Promise<void> {
    if (["recording", "paused", "stopping"].includes(this.phase))
      throw new Error("请先结束当前录制");
    if (this.result) throw new Error("请先保存或丢弃当前录制，再连接设备");
    this.cancelPreview();
    const generation = ++this.generation;
    this.phase = "preparing";
    this.error = "";
    this.systemAudio = false;
    this.accumulated = 0;
    this.emit();
    try {
      const devices = mediaDevices();
      this.audio = new AudioContext();
      const audioContext = this.audio;
      const resumed = audioContext.resume();
      void resumed.catch(() => {});
      const microphone: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        ...(options.microphoneId ? { deviceId: { exact: options.microphoneId } } : {}),
      };
      let stream: MediaStream;
      if (options.mode === "screen") {
        if (!devices.getDisplayMedia)
          throw new Error("当前环境不能选择共享屏幕，请改用摄像头或麦克风录制。");
        const display = this.own(
          await devices.getDisplayMedia({ video: { frameRate: 30 }, audio: true }),
          generation,
        );
        if (!display.getVideoTracks().length) throw new Error("没有选中可录制的屏幕画面");
        const mic = this.own(
          await devices.getUserMedia({ audio: microphone, video: false }),
          generation,
        );
        if (!mic.getAudioTracks().length) throw new Error("没有获得麦克风音轨");
        this.systemAudio = display.getAudioTracks().length > 0;
        const destination = audioContext.createMediaStreamDestination();
        this.own(destination.stream, generation);
        for (const source of [mic, ...(this.systemAudio ? [display] : [])]) {
          const node = audioContext.createMediaStreamSource(
            new MediaStream(source.getAudioTracks()),
          );
          const gain = audioContext.createGain();
          gain.gain.value = source === mic ? 1 : 0.7;
          node.connect(gain).connect(destination);
          this.nodes.push(node, gain);
        }
        stream = this.own(
          new MediaStream([...display.getVideoTracks(), ...destination.stream.getAudioTracks()]),
          generation,
        );
      } else {
        stream = this.own(
          await devices.getUserMedia({
            audio: microphone,
            video:
              options.mode === "camera"
                ? {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 },
                    ...(options.cameraId ? { deviceId: { exact: options.cameraId } } : {}),
                  }
                : false,
          }),
          generation,
        );
        if (!stream.getAudioTracks().length) throw new Error("没有获得麦克风音轨");
        if (options.mode === "camera" && !stream.getVideoTracks().length)
          throw new Error("没有获得摄像头画面");
      }
      await resumed;
      if (generation !== this.generation) return;
      this.kind = options.mode === "microphone" ? "audio" : "video";
      preferredMime(this.kind);
      this.stream = stream;
      const source = audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      this.analyser = audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);
      this.nodes.push(source, this.analyser);
      for (const track of [...this.streams].flatMap((value) => value.getTracks()))
        track.onended = () => {
          if (generation !== this.generation) return;
          if (this.phase === "recording" || this.phase === "paused") {
            this.error = "设备或屏幕共享已停止，已结束本次录制。";
            void this.stop();
          } else if (this.phase === "preview") {
            this.cancelPreview();
            this.error = "设备或屏幕共享已停止，请重新连接。";
            this.emit();
          }
        };
      this.phase = "preview";
      this.emit();
    } catch (error) {
      if (generation !== this.generation) return;
      this.cleanupTracks();
      this.phase = "error";
      this.error = captureError(error);
      this.emit();
      throw new Error(this.error);
    }
  }
  start(): void {
    if (this.phase !== "preview" || !this.stream) throw new Error("请先连接设备并检查预览");
    if (!this.stream.getTracks().every((track) => track.readyState === "live"))
      throw new Error("录制设备已停止，请重新连接");
    this.chunks = [];
    this.bytes = 0;
    this.error = "";
    this.accumulated = 0;
    try {
      this.recorder = new MediaRecorder(this.stream, {
        mimeType: preferredMime(this.kind),
        ...(this.kind === "video" ? { videoBitsPerSecond: 2500000 } : {}),
        audioBitsPerSecond: 128000,
      });
      const recorder = this.recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          this.chunks.push(event.data);
          this.bytes += event.data.size;
          if (this.bytes >= MAX_BYTES && this.phase !== "stopping") {
            this.error = "录制达到 200 MB，已自动结束并保留结果。";
            void this.stop();
          }
        }
      };
      recorder.onerror = () => {
        this.error = "录制编码中断，设备已释放。若有完整片段，可试听后保存。";
        void this.stop();
      };
      recorder.onstop = () => this.complete();
      recorder.start(500);
      this.startedAt = performance.now();
      this.phase = "recording";
      this.timer = setInterval(() => {
        if (this.elapsed() >= MAX_SECONDS) {
          this.error = "录制达到 20 分钟，已自动结束并保留结果。";
          void this.stop();
        }
      }, 500);
      this.emit();
    } catch (error) {
      this.recorder = null;
      this.cleanupTracks();
      this.phase = "error";
      this.error = captureError(error);
      this.emit();
      throw new Error(this.error);
    }
  }
  pause(): void {
    if (this.phase !== "recording" || !this.recorder) return;
    this.accumulated = this.elapsed();
    this.recorder.pause();
    this.phase = "paused";
    this.emit();
  }
  resume(): void {
    if (this.phase !== "paused" || !this.recorder) return;
    this.recorder.resume();
    this.startedAt = performance.now();
    this.phase = "recording";
    this.emit();
  }
  stop(): Promise<RecordedTake | null> {
    if (this.stopping) return this.stopping;
    if (!this.recorder) {
      this.cancelPreview();
      return Promise.resolve(this.result);
    }
    this.accumulated = this.elapsed();
    this.phase = "stopping";
    const promise = new Promise<RecordedTake | null>((resolve) => {
      this.finishStop = resolve;
    });
    this.stopping = promise;
    try {
      if (this.recorder.state !== "inactive") this.recorder.stop();
      else this.complete();
    } catch (error) {
      this.error = captureError(error);
      this.complete();
    }
    this.cleanupTracks();
    if (this.recorder)
      this.stopTimer = setTimeout(() => {
        this.error ||= "结束编码耗时过长，请试听已保留片段后保存。";
        this.complete();
      }, 3000);
    this.emit();
    return promise;
  }
  private complete(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
    const mimeType = this.recorder?.mimeType || this.chunks[0]?.type || "";
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
    }
    this.recorder = null;
    const blob = new Blob(this.chunks, { type: mimeType });
    this.chunks = [];
    this.result = blob.size
      ? {
          blob,
          kind: this.kind,
          mimeType,
          durationSeconds: this.accumulated,
          systemAudio: this.systemAudio,
        }
      : null;
    this.cleanupTracks();
    this.phase = this.result ? "ready" : "error";
    if (!this.result && !this.error) this.error = "这次录制没有生成可保存内容，请重试。";
    const finish = this.finishStop;
    this.finishStop = null;
    this.stopping = null;
    finish?.(this.result);
    this.emit();
  }
  cancelPreview(): void {
    if (this.recorder) throw new Error("请先停止录制");
    this.generation++;
    this.cleanupTracks();
    this.phase = this.result ? "ready" : "idle";
    this.emit();
  }
  discard(): void {
    if (this.recorder) throw new Error("请先停止录制");
    this.result = null;
    this.error = "";
    this.accumulated = 0;
    this.cancelPreview();
  }
  dispose(): void {
    this.generation++;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
    if (this.recorder) {
      const recorder = this.recorder;
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* Devices still must be released. */
      }
    }
    this.recorder = null;
    this.chunks = [];
    this.result = null;
    this.cleanupTracks();
    this.phase = "idle";
    const finish = this.finishStop;
    this.finishStop = null;
    this.stopping = null;
    finish?.(null);
  }
}
