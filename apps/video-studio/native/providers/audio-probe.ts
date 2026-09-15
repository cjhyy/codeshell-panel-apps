import { runMediaProcess, mediaAbortError } from "../process-runner.js";
import { combineAbortSignals } from "../signals.js";

export const AUDIO_PROBE_MESSAGES = [
  "参考素材中没有可用音轨，请选择音频或带声音的视频",
  "无法解析这段声音，请先提取为 WAV 参考录音后重试",
  "暂时无法测量这段录音时长，请先提取为 WAV 参考录音后重试",
  "声音时长检查超时，请先裁剪或提取参考录音后重试",
] as const;
const [NO_AUDIO, UNSUPPORTED, NO_DURATION, TIMEOUT] = AUDIO_PROBE_MESSAGES;
const number = (value: unknown): number | undefined => {
  if ((typeof value !== "string" && typeof value !== "number") || value === "") return;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
};
const duration = (value: unknown) => {
  const result = number(value);
  return result !== undefined && result > 0 ? result : undefined;
};

/** Audio-only packet inspection covers unfinalized MediaRecorder WebM without decoding it. */
export async function probeVoiceAudio(
  path: string,
  signal: AbortSignal,
  options: { ffprobePath?: string; formats: string },
): Promise<{
  audio: { codec_name?: string; sample_rate?: string; channels?: number };
  durationSeconds: number;
}> {
  const deadline = AbortSignal.timeout(15_000);
  const bounded = combineAbortSignals([signal, deadline]);
  const source = ["-protocol_whitelist", "file,pipe", "-format_whitelist", options.formats];
  try {
    const raw = await runMediaProcess(
      options.ffprobePath ?? "ffprobe",
      [
        "-v",
        "error",
        ...source,
        "-select_streams",
        "a:0",
        "-show_entries",
        "format=duration,start_time:stream=codec_name,sample_rate,channels,duration,start_time",
        "-of",
        "json",
        path,
      ],
      { signal: bounded, maxStdoutBytes: 64 * 1024 },
    );
    const data = JSON.parse(raw.stdout.toString("utf8"));
    const audio = data.streams?.[0];
    if (!audio) throw new Error(NO_AUDIO);
    // A stream's literal "N/A" must not hide a valid container duration.
    let durationSeconds = duration(audio.duration) ?? duration(data.format?.duration);
    if (durationSeconds !== undefined) return { audio, durationSeconds };
    let pending = "",
      bytes = 0,
      packets = 0;
    let firstTime: number | undefined,
      lastTime: number | undefined,
      lastDelta = 0,
      lastEnd = -Infinity;
    const consume = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) throw new Error(NO_DURATION);
      const lines = (pending + chunk.toString("utf8")).split(/\r?\n/);
      pending = lines.pop() ?? "";
      if (pending.length > 4096) throw new Error(NO_DURATION);
      for (const line of lines) {
        if (!line.trim()) continue;
        if (++packets > 20_000) throw new Error(NO_DURATION);
        const fields = Object.fromEntries(line.split("|").map((part) => part.split("=")));
        const time = number(fields.pts_time) ?? number(fields.dts_time);
        if (time === undefined) continue;
        firstTime = firstTime === undefined ? time : Math.min(firstTime, time);
        if (lastTime !== undefined && time > lastTime) lastDelta = time - lastTime;
        lastTime = time;
        lastEnd = Math.max(lastEnd, time + (duration(fields.duration_time) ?? lastDelta));
      }
    };
    await runMediaProcess(
      options.ffprobePath ?? "ffprobe",
      [
        "-v",
        "error",
        ...source,
        "-select_streams",
        "a:0",
        "-read_intervals",
        "%+31",
        "-show_entries",
        "packet=pts_time,dts_time,duration_time",
        "-of",
        "compact=p=0:nk=0",
        path,
      ],
      { signal: bounded, onStdout: consume },
    );
    consume(Buffer.from("\n"));
    const origin = number(audio.start_time) ?? number(data.format?.start_time) ?? firstTime;
    durationSeconds = origin === undefined ? undefined : duration(lastEnd - origin);
    if (durationSeconds === undefined) throw new Error(NO_DURATION);
    // The source's existing 3–30s gate rejects a recording still continuing at the scan bound.
    return { audio, durationSeconds };
  } catch (error) {
    if (signal.aborted) throw mediaAbortError();
    if (deadline.aborted) throw new Error(TIMEOUT, { cause: error });
    if (error instanceof Error && AUDIO_PROBE_MESSAGES.includes(error.message as any)) throw error;
    throw new Error(UNSUPPORTED, { cause: error });
  }
}
