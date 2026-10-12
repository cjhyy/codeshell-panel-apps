import { assertTick, frameToTicks, secondsToTicks, type FrameRate, type Tick } from "./time";

/** Explicit seconds or zero-based frame numbers; this is not a SMPTE/drop-frame timecode. */
export function resolvePlayheadPosition(
  value: string,
  unit: string,
  rate: FrameRate,
  duration: Tick,
): Tick {
  assertTick(duration, "序列时长");
  if (!duration) throw new Error("当前序列没有可定位的内容，请先添加片段");
  const text = value.trim();
  if (unit !== "seconds" && unit !== "frames") throw new Error("请选择秒数或帧序号");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))
    throw new Error(unit === "frames" ? "帧序号必须是从 0 开始的整数" : "请输入非负秒数，可包含小数");
  const number = Number(text);
  if (unit === "frames" && !Number.isSafeInteger(number))
    throw new Error("帧序号必须是从 0 开始的整数");
  const time = unit === "frames" ? frameToTicks(number, rate) : secondsToTicks(number);
  if (time >= duration) throw new Error("位置超出当前序列，请输入结束位置之前的时间或帧");
  return time;
}
