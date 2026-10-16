import { createRequire as __panelCreateRequire } from "node:module"; const require = __panelCreateRequire(import.meta.url);

// native/project-cli.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { resolve as resolve2 } from "node:path";

// src/ids.ts
function randomId() {
  const source2 = globalThis.crypto;
  if (typeof source2?.randomUUID === "function") return source2.randomUUID();
  if (typeof source2?.getRandomValues !== "function")
    throw new Error("当前浏览器无法安全创建任务标识，请使用支持安全随机数的浏览器。");
  const bytes = source2.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// src/editor/time.ts
var TICKS_PER_SECOND = 24e4;
var MAX_TICK = BigInt(Number.MAX_SAFE_INTEGER);
var SUPPORTED_RATES = /* @__PURE__ */ new Set([
  "24/1",
  "25/1",
  "30/1",
  "48/1",
  "50/1",
  "60/1",
  "24000/1001",
  "30000/1001",
  "60000/1001"
]);
function assertTick(value, label3 = "时间") {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label3}必须是非负安全整数刻度`);
  return value;
}
function object(value, label3, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label3}必须是对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error(`${label3}必须是普通对象`);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw new Error(`${label3}包含不支持的字段`);
  return value;
}
function validateFrameRate(value) {
  const data = object(value, "帧率", ["numerator", "denominator"]);
  let numerator = assertTick(data.numerator, "帧率分子");
  let denominator = assertTick(data.denominator, "帧率分母");
  if (!numerator || !denominator) throw new Error("帧率分子和分母必须大于零");
  let a = numerator, b = denominator;
  while (b) [a, b] = [b, a % b];
  numerator /= a;
  denominator /= a;
  if (!SUPPORTED_RATES.has(`${numerator}/${denominator}`)) throw new Error("不支持此工程帧率");
  return { numerator, denominator };
}
function secondsToTicks(seconds2) {
  if (!Number.isFinite(seconds2) || seconds2 < 0) throw new Error("秒数必须是非负有限数");
  return assertTick(Math.round(seconds2 * TICKS_PER_SECOND));
}
function ticksToSeconds(tick2) {
  return assertTick(tick2) / TICKS_PER_SECOND;
}
function frameTicks(rate2) {
  const { numerator, denominator } = validateFrameRate(rate2);
  return TICKS_PER_SECOND * denominator / numerator;
}
function tickFromBigInt(value) {
  if (value < 0n || value > MAX_TICK) throw new Error("时间超过安全整数刻度范围");
  return Number(value);
}
function frameToTicks(frame2, rate2) {
  return tickFromBigInt(BigInt(assertTick(frame2, "帧序号")) * BigInt(frameTicks(rate2)));
}
function ticksToFrame(tick2, rate2, mode = "round") {
  const value = BigInt(assertTick(tick2));
  const unit = BigInt(frameTicks(rate2));
  if (!["floor", "ceil", "round"].includes(mode)) throw new Error("未知帧取整方式");
  const offset = mode === "ceil" ? unit - 1n : mode === "round" ? unit / 2n : 0n;
  return Number((value + offset) / unit);
}
function validateTimeMap(value, duration, sourceDuration) {
  assertTick(duration, "片段时长");
  assertTick(sourceDuration, "素材时长");
  if (!duration) throw new Error("片段时长必须大于零");
  const data = object(value, "时间映射", ["points"]);
  if (!Array.isArray(data.points) || data.points.length < 2 || data.points.length > 1e5)
    throw new Error("时间映射需要 2 至 100000 个节点");
  if (Object.getPrototypeOf(data.points) !== Array.prototype || Reflect.ownKeys(data.points).length !== data.points.length + 1)
    throw new Error("时间映射节点必须是连续的普通数组");
  for (let index2 = 0; index2 < data.points.length; index2++)
    if (!Object.hasOwn(data.points, index2)) throw new Error("时间映射节点不能留空");
  let previous = -1;
  const points = data.points.map((raw) => {
    const point = object(raw, "时间映射节点", ["time", "source"]);
    const time = assertTick(point.time, "局部时间");
    const source2 = assertTick(point.source, "源时间");
    if (time <= previous || time > duration) throw new Error("时间映射的局部时间必须严格递增");
    if (source2 > sourceDuration) throw new Error("时间映射超出素材时长");
    previous = time;
    return { time, source: source2 };
  });
  if (points[0].time !== 0 || points.at(-1).time !== duration)
    throw new Error("时间映射必须覆盖片段的完整时长");
  return { points };
}
function interpolateSource(a, b, time) {
  const width = BigInt(b.time - a.time);
  const elapsed = BigInt(time - a.time);
  const numerator = BigInt(a.source) * (width - elapsed) + BigInt(b.source) * elapsed;
  return tickFromBigInt((2n * numerator + width) / (2n * width));
}
function sourceTimeAt(map2, time) {
  assertTick(time, "局部时间");
  if (map2.points.length < 2) throw new Error("时间映射缺少节点");
  if (time <= map2.points[0].time) return map2.points[0].source;
  if (time >= map2.points.at(-1).time) return map2.points.at(-1).source;
  let left = 0, right = map2.points.length - 1;
  while (left + 1 < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (map2.points[middle].time <= time) left = middle;
    else right = middle;
  }
  return interpolateSource(map2.points[left], map2.points[right], time);
}
function firstTick(start, end, test) {
  let left = start, right = end;
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (test(middle)) right = middle;
    else left = middle + 1;
  }
  return left;
}
function sourceRangesToTimeline(map2, start, end) {
  assertTick(start, "源范围入点");
  assertTick(end, "源范围出点");
  if (end < start) throw new Error("源范围出点不能早于入点");
  if (start === end) return [];
  const ranges = [];
  for (let i = 0; i + 1 < map2.points.length; i++) {
    const a = map2.points[i], b = map2.points[i + 1];
    const at = (time) => interpolateSource(a, b, time);
    let range;
    if (a.source === b.source) {
      if (a.source < start || a.source >= end) continue;
      range = { start: a.time, end: b.time };
    } else if (b.source > a.source) {
      range = {
        start: firstTick(a.time, b.time, (time) => at(time) >= start),
        end: firstTick(a.time, b.time, (time) => at(time) >= end)
      };
    } else {
      range = {
        start: firstTick(a.time, b.time, (time) => at(time) < end),
        end: firstTick(a.time, b.time, (time) => at(time) < start)
      };
    }
    if (range.start >= range.end) continue;
    const previous = ranges.at(-1);
    if (previous?.end === range.start) previous.end = range.end;
    else ranges.push(range);
  }
  return ranges;
}
function sliceTimeMap(map2, start, end) {
  assertTick(start, "裁剪入点");
  assertTick(end, "裁剪出点");
  if (start >= end || end > map2.points.at(-1).time)
    throw new Error("裁剪范围必须位于时间映射内且具有正时长");
  return {
    points: [
      { time: 0, source: sourceTimeAt(map2, start) },
      ...map2.points.filter((point) => point.time > start && point.time < end).map((point) => ({ time: point.time - start, source: point.source })),
      { time: end - start, source: sourceTimeAt(map2, end) }
    ]
  };
}
function constantTimeMap(inTick, outTick, rate2 = 1) {
  assertTick(inTick, "源入点");
  assertTick(outTick, "源出点");
  if (!Number.isFinite(rate2) || rate2 <= 0) throw new Error("速度必须是正有限数");
  if (inTick === outTick) throw new Error("定格请使用独立的定格时间映射");
  const duration = assertTick(Math.round(Math.abs(outTick - inTick) / rate2), "片段时长");
  if (!duration) throw new Error("变速后时长不能小于一个刻度");
  return {
    duration,
    timeMap: {
      points: [
        { time: 0, source: inTick },
        { time: duration, source: outTick }
      ]
    }
  };
}
function freezeTimeMap(sourceTick, duration) {
  assertTick(sourceTick, "定格源时间");
  assertTick(duration, "定格时长");
  if (!duration) throw new Error("定格时长必须大于零");
  return {
    points: [
      { time: 0, source: sourceTick },
      { time: duration, source: sourceTick }
    ]
  };
}

// src/editor/animation.ts
function finite(value, label3) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label3}必须是有限数`);
  return value;
}
function object2(value, allowed, label3) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label3}必须是对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error(`${label3}必须是普通对象`);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw new Error(`${label3}包含不支持的字段`);
  return value;
}
function validateEasing(value) {
  if (typeof value === "string" && ["linear", "hold", "ease-in", "ease-out", "ease-in-out"].includes(value))
    return value;
  const data = object2(value, ["type", "x1", "y1", "x2", "y2"], "关键帧缓动");
  if (data.type !== "cubic-bezier") throw new Error("未知关键帧缓动");
  const result = {
    type: "cubic-bezier",
    x1: finite(data.x1, "贝塞尔 x1"),
    y1: finite(data.y1, "贝塞尔 y1"),
    x2: finite(data.x2, "贝塞尔 x2"),
    y2: finite(data.y2, "贝塞尔 y2")
  };
  if (result.x1 < 0 || result.x1 > 1 || result.x2 < 0 || result.x2 > 1 || result.y1 < -4 || result.y1 > 4 || result.y2 < -4 || result.y2 > 4)
    throw new Error("贝塞尔横轴控制点须在 0–1，纵轴控制点须在 -4–4");
  return result;
}
function validateKeyframes(value, duration) {
  if (duration !== void 0) assertTick(duration, "动画时长");
  if (!Array.isArray(value) || !value.length || value.length > 1e5)
    throw new Error("动画需要 1 至 100000 个关键帧");
  if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1)
    throw new Error("关键帧必须是连续的普通数组");
  for (let index2 = 0; index2 < value.length; index2++)
    if (!Object.hasOwn(value, index2)) throw new Error("关键帧不能留空");
  let previous = -1;
  return value.map((raw) => {
    const data = object2(raw, ["time", "value", "easing"], "关键帧");
    const time = assertTick(data.time, "关键帧时间");
    if (time <= previous || duration !== void 0 && time > duration)
      throw new Error("关键帧时间必须严格递增且位于动画时长内");
    previous = time;
    return {
      time,
      value: finite(data.value, "关键帧数值"),
      ...data.easing === void 0 ? {} : { easing: validateEasing(data.easing) }
    };
  });
}
function validateAnimatedNumber(value, duration) {
  if (duration !== void 0) assertTick(duration, "动画时长");
  if (typeof value === "number") return finite(value, "动画数值");
  const data = object2(value, ["keyframes"], "动画数值");
  return { keyframes: validateKeyframes(data.keyframes, duration) };
}
function cubicFor(easing) {
  if (typeof easing === "object") return easing;
  if (easing === "ease-in") return { type: "cubic-bezier", x1: 0.42, y1: 0, x2: 1, y2: 1 };
  if (easing === "ease-out") return { type: "cubic-bezier", x1: 0, y1: 0, x2: 0.58, y2: 1 };
  if (easing === "ease-in-out") return { type: "cubic-bezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
  return void 0;
}
function coordinate(t, p1, p2) {
  const rest = 1 - t;
  return 3 * rest * rest * t * p1 + 3 * rest * t * t * p2 + t * t * t;
}
function parameterAtX(cubic, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let left = 0, right = 1;
  for (let i = 0; i < 56; i++) {
    const middle = (left + right) / 2;
    if (coordinate(middle, cubic.x1, cubic.x2) < x) left = middle;
    else right = middle;
  }
  return (left + right) / 2;
}
function progress(easing, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (easing === "hold") return 0;
  const cubic = cubicFor(easing);
  return cubic ? coordinate(parameterAtX(cubic, x), cubic.y1, cubic.y2) : x;
}
function preceding(keys3, time) {
  let left = 0, right = keys3.length - 1;
  while (left + 1 < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (keys3[middle].time <= time) left = middle;
    else right = middle;
  }
  return left;
}
function evaluateAnimatedNumber(value, time) {
  assertTick(time, "动画时间");
  if (typeof value === "number") return value;
  const keys3 = value.keyframes;
  if (!keys3.length) throw new Error("动画缺少关键帧");
  if (time <= keys3[0].time) return keys3[0].value;
  if (time >= keys3.at(-1).time) return keys3.at(-1).value;
  const index2 = preceding(keys3, time), left = keys3[index2], right = keys3[index2 + 1];
  if (time === left.time || left.value === right.value) return left.value;
  const amount = progress(left.easing ?? "linear", (time - left.time) / (right.time - left.time));
  return left.value * (1 - amount) + right.value * amount;
}
function mix(a, b, t) {
  return { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t };
}
function split(points, t) {
  const a = mix(points[0], points[1], t), b = mix(points[1], points[2], t), c = mix(points[2], points[3], t);
  const d = mix(a, b, t), e = mix(b, c, t), f = mix(d, e, t);
  return [
    [points[0], a, d, f],
    [f, e, c, points[3]]
  ];
}
function restrictCubic(cubic, from, to) {
  if (from === 0 && to === 1) return { ...cubic };
  const first2 = parameterAtX(cubic, from), last = parameterAtX(cubic, to);
  const points = [
    { x: 0, y: 0 },
    { x: cubic.x1, y: cubic.y1 },
    { x: cubic.x2, y: cubic.y2 },
    { x: 1, y: 1 }
  ];
  const prefix = split(points, last)[0];
  const part2 = first2 === 0 ? prefix : split(prefix, first2 / last)[1];
  const width = part2[3].x - part2[0].x, height = part2[3].y - part2[0].y;
  if (!width || !height) return void 0;
  const result = {
    type: "cubic-bezier",
    x1: Math.max(0, Math.min(1, (part2[1].x - part2[0].x) / width)),
    y1: (part2[1].y - part2[0].y) / height,
    x2: Math.max(0, Math.min(1, (part2[2].x - part2[0].x) / width)),
    y2: (part2[2].y - part2[0].y) / height
  };
  if (![result.y1, result.y2].every(
    (number3) => Number.isFinite(number3) && number3 >= -4 && number3 <= 4
  ))
    return void 0;
  return result;
}
function turningParameters(cubic) {
  const a = 1 - 3 * cubic.y2 + 3 * cubic.y1;
  const b = 2 * (cubic.y2 - 2 * cubic.y1), c = cubic.y1;
  if (Math.abs(a) < 1e-14) return Math.abs(b) < 1e-14 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}
function sliceAnimatedNumber(value, start, end) {
  assertTick(start, "动画裁剪入点");
  assertTick(end, "动画裁剪出点");
  if (start >= end) throw new Error("动画裁剪范围必须具有正时长");
  if (typeof value === "number") return value;
  const keys3 = value.keyframes;
  if (!keys3.length) throw new Error("动画缺少关键帧");
  const times = /* @__PURE__ */ new Set([start, end]);
  for (const key of keys3) if (key.time > start && key.time < end) times.add(key.time);
  for (let i = 0; i + 1 < keys3.length; i++) {
    const left = keys3[i], right = keys3[i + 1], cubic = cubicFor(left.easing ?? "linear");
    if (!cubic || right.time <= start || left.time >= end || left.value === right.value) continue;
    for (const parameter of turningParameters(cubic)) {
      if (parameter <= 0 || parameter >= 1) continue;
      const time = left.time + coordinate(parameter, cubic.x1, cubic.x2) * (right.time - left.time);
      for (const tick2 of [Math.floor(time), Math.ceil(time)])
        if (tick2 > start && tick2 < end) times.add(tick2);
    }
  }
  const sorted = [...times].sort((a, b) => a - b);
  const result = [];
  function segment(from, to) {
    const initial = evaluateAnimatedNumber(value, from), final = evaluateAnimatedNumber(value, to);
    let easing = "linear";
    if (from >= keys3[0].time && from < keys3.at(-1).time) {
      const index2 = preceding(keys3, from), left = keys3[index2], right = keys3[index2 + 1];
      const original = left.easing ?? "linear", cubic = cubicFor(original);
      if (original === "hold") easing = "hold";
      else if (cubic && left.value !== right.value && to - from > 1) {
        const adjusted = restrictCubic(
          cubic,
          (from - left.time) / (right.time - left.time),
          (to - left.time) / (right.time - left.time)
        );
        if (!adjusted) {
          const middle = from + Math.floor((to - from) / 2);
          segment(from, middle);
          segment(middle, to);
          return;
        }
        easing = adjusted;
      }
    }
    result.push({ time: from - start, value: initial, easing });
    if (to === end) result.push({ time: end - start, value: final });
  }
  for (let i = 0; i + 1 < sorted.length; i++) segment(sorted[i], sorted[i + 1]);
  return { keyframes: result };
}

// src/editor/export-settings.ts
var VIDEO_ENCODERS = {
  h264: "libx264",
  hevc: "libx265",
  vp9: "libvpx-vp9",
  prores: "prores_ks"
};
var AUDIO_ENCODERS = { aac: "aac", opus: "libopus", pcm: "pcm_s16le" };
var PROFILE_KEYS = [
  "id",
  "name",
  "width",
  "height",
  "frameRate",
  "container",
  "videoCodec",
  "audioCodec",
  "quality",
  "audioBitrate",
  "sampleRate",
  "includeCaptions"
];
function object3(value, keys3, label3) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some((key) => !keys3.includes(key)))
    throw new Error(`${label3}格式无效或包含未知字段`);
  return value;
}
function integer(value, min, max, label3) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    throw new Error(`${label3}必须是 ${min}–${max} 范围内的整数`);
  return Number(value);
}
function label(value, max, name) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    throw new Error(`${name}无效`);
  return value;
}
function rate(value) {
  const data = object3(value, ["numerator", "denominator"], "导出帧率");
  return validateFrameRate(data);
}
function validateExportProfile(value) {
  const data = object3(value, PROFILE_KEYS, "导出配置");
  const id5 = label(data.id, 128, "导出配置 ID");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id5)) throw new Error("导出配置 ID 无效");
  const name = label(data.name, 200, "导出配置名称");
  const width = integer(data.width, 16, 8192, "导出宽度");
  const height = integer(data.height, 16, 8192, "导出高度");
  if (width % 2 || height % 2) throw new Error("导出画面宽高必须是偶数");
  const frameRate = rate(data.frameRate);
  if (!["mp4", "mov", "webm"].includes(data.container)) throw new Error("不支持此导出容器");
  if (!Object.hasOwn(VIDEO_ENCODERS, data.videoCodec)) throw new Error("不支持此视频编码");
  if (!Object.hasOwn(AUDIO_ENCODERS, data.audioCodec)) throw new Error("不支持此音频编码");
  const container = data.container;
  const videoCodec = data.videoCodec;
  const audioCodec = data.audioCodec;
  const compatible = container === "webm" ? videoCodec === "vp9" && audioCodec === "opus" : container === "mp4" ? ["h264", "hevc"].includes(videoCodec) && audioCodec === "aac" : ["h264", "hevc"].includes(videoCodec) && audioCodec === "aac" || videoCodec === "prores" && audioCodec === "pcm";
  if (!compatible) throw new Error("所选容器与音视频编码不兼容");
  const rawQuality = object3(data.quality, ["mode", "value", "bitsPerSecond"], "导出质量");
  let quality;
  if (rawQuality.mode === "quality") {
    if (Object.hasOwn(rawQuality, "bitsPerSecond")) throw new Error("质量模式不能同时指定码率");
    quality = { mode: "quality", value: integer(rawQuality.value, 0, 100, "导出质量") };
  } else if (rawQuality.mode === "bitrate") {
    if (Object.hasOwn(rawQuality, "value")) throw new Error("码率模式不能同时指定质量");
    if (videoCodec === "prores")
      throw new Error("ProRes 请使用质量模式，编码器不支持此目标码率控制");
    quality = {
      mode: "bitrate",
      bitsPerSecond: integer(rawQuality.bitsPerSecond, 1e5, 5e8, "视频目标码率")
    };
  } else throw new Error("导出质量模式无效");
  const audioBitrate = audioCodec === "pcm" ? integer(data.audioBitrate, 1536e3, 1536e3, "PCM 音频码率") : integer(data.audioBitrate, 32e3, audioCodec === "opus" ? 51e4 : 512e3, "音频目标码率");
  if (data.sampleRate !== 48e3) throw new Error("导出音频采样率必须为 48000 Hz");
  if (typeof data.includeCaptions !== "boolean") throw new Error("请明确是否导出字幕");
  return {
    id: id5,
    name,
    width,
    height,
    frameRate,
    container,
    videoCodec,
    audioCodec,
    quality,
    audioBitrate,
    sampleRate: 48e3,
    includeCaptions: data.includeCaptions
  };
}
function createExportPresets() {
  return [
    { id: "landscape-1080p", name: "横屏 1080p", width: 1920, height: 1080 },
    { id: "portrait-1080p", name: "竖屏 1080p", width: 1080, height: 1920 },
    { id: "landscape-4k", name: "横屏 4K", width: 3840, height: 2160 }
  ].map(
    (preset2) => validateExportProfile({
      ...preset2,
      frameRate: { numerator: 30, denominator: 1 },
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      quality: { mode: "quality", value: 62 },
      audioBitrate: 192e3,
      sampleRate: 48e3,
      includeCaptions: true
    })
  );
}
function requiredExportEncoders(profile) {
  const valid = validateExportProfile(profile);
  return [VIDEO_ENCODERS[valid.videoCodec], AUDIO_ENCODERS[valid.audioCodec]];
}

// src/editor/validation.ts
var MAX_EDITOR_TICK = 24 * 60 * 60 * TICKS_PER_SECOND;
var MAX_DOCUMENT_NODES = 1e6;
var MAX_DOCUMENT_CHARACTERS = 16 * 1024 * 1024;
var controls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function copyData(value) {
  let nodes = 0, characters = 0;
  const ancestors = /* @__PURE__ */ new Set();
  function visit(item, depth) {
    if (++nodes > MAX_DOCUMENT_NODES || depth > 64) throw new Error("工程结构超过容量限制");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("工程不能包含非有限数字");
      return item;
    }
    if (typeof item === "string") {
      characters += item.length;
      if (characters > MAX_DOCUMENT_CHARACTERS) throw new Error("工程文字超过容量限制");
      return item;
    }
    if (!item || typeof item !== "object") throw new Error("工程必须只包含 JSON 数据");
    if (ancestors.has(item)) throw new Error("工程 JSON 数据不能循环引用");
    const array2 = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array2 ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      throw new Error("工程数据必须是普通对象或数组");
    ancestors.add(item);
    try {
      const result = array2 ? [] : {};
      const keys3 = Reflect.ownKeys(item);
      if (array2 && keys3.length !== item.length + 1)
        throw new Error("工程数组不能有空洞或额外属性");
      for (const key of keys3) {
        if (array2 && key === "length") continue;
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key))
          throw new Error("工程包含不安全的数据键");
        characters += key.length;
        if (characters > MAX_DOCUMENT_CHARACTERS) throw new Error("工程文字超过容量限制");
        if (array2 && !/^(0|[1-9]\d*)$/.test(key)) throw new Error("工程数组包含额外属性");
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor.enumerable || !("value" in descriptor))
          throw new Error("工程不接受隐藏属性或访问器");
        result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(item);
    }
  }
  return visit(value, 0);
}
function object4(value, allowed, label3) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label3}必须是对象`);
  const data = value;
  for (const key of Object.keys(data))
    if (!allowed.includes(key)) throw new Error(`${label3}包含未知字段：${key}`);
  return data;
}
function list(value, limit, label3, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > limit)
    throw new Error(`${label3}需要 ${minimum} 至 ${limit} 项`);
  return value;
}
function number(value, min, max, label3) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${label3}必须在 ${min} 至 ${max} 之间`);
  return value;
}
function integer2(value, min, max, label3) {
  const result = number(value, min, max, label3);
  if (!Number.isSafeInteger(result)) throw new Error(`${label3}必须是安全整数`);
  return result;
}
function tick(value, label3, positive2 = false) {
  return integer2(value, positive2 ? 1 : 0, MAX_EDITOR_TICK, label3);
}
function text(value, max, label3, empty = false, multiline = false) {
  if (typeof value !== "string" || value.length > max || !empty && !value.trim() || controls.test(value) || !multiline && /[\n\r\t]/.test(value))
    throw new Error(`${label3}文字无效或超过 ${max} 字符`);
  return value;
}
function id(value, label3) {
  const result = text(value, 128, label3);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(result)) throw new Error(`${label3}无效`);
  return result;
}
function bool(value, label3) {
  if (typeof value !== "boolean") throw new Error(`${label3}必须是布尔值`);
  return value;
}
function choice(value, allowed, label3) {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label3}无效`);
  return value;
}
function color(value, label3) {
  if (typeof value !== "string" || !(value === "transparent" || /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)))
    throw new Error(`${label3}须为十六进制颜色或 transparent`);
  return value;
}
function unique(items, label3) {
  const result = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (result.has(item.id)) throw new Error(`${label3} ID 重复：${item.id}`);
    result.set(item.id, item);
  }
  return result;
}
function dataObject(value, label3) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label3}必须是对象`);
  return value;
}
function animated(value, duration, min, max, label3) {
  if (typeof value === "number") return number(value, min, max, label3);
  const data = object4(value, ["keyframes"], label3);
  for (const raw of list(data.keyframes, 1e4, `${label3}关键帧`, 1)) {
    const frame2 = object4(raw, ["time", "value", "easing"], "关键帧");
    number(frame2.value, min, max, label3);
    if (typeof frame2.easing === "object")
      object4(frame2.easing, ["type", "x1", "y1", "x2", "y2"], "缓动曲线");
  }
  return validateAnimatedNumber(data, duration);
}
function timeMap(value, duration, sourceDuration) {
  const data = object4(value, ["points"], "时间映射");
  for (const point of list(data.points, 1e4, "时间映射节点", 2))
    object4(point, ["time", "source"], "时间映射节点");
  return validateTimeMap(data, duration, sourceDuration);
}
function assertNoEmptyHold(map2, sourceDuration, label3) {
  if (map2.points.some(
    (point, index2) => index2 > 0 && point.source === sourceDuration && map2.points[index2 - 1].source === sourceDuration
  ))
    throw new Error(`${label3}不能在素材结束边界定格`);
}
function transform(value, duration) {
  const data = object4(
    value,
    ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "flipX", "flipY", "fit", "crop"],
    "构图"
  );
  const crop = object4(data.crop, ["left", "top", "right", "bottom"], "裁切");
  const bounds = {
    left: number(crop.left, 0, 1, "左裁切"),
    top: number(crop.top, 0, 1, "上裁切"),
    right: number(crop.right, 0, 1, "右裁切"),
    bottom: number(crop.bottom, 0, 1, "下裁切")
  };
  if (bounds.left + bounds.right >= 1 || bounds.top + bounds.bottom >= 1)
    throw new Error("裁切后必须保留有效画面");
  return {
    x: animated(data.x, duration, -10, 10, "水平位置"),
    y: animated(data.y, duration, -10, 10, "垂直位置"),
    scaleX: animated(data.scaleX, duration, 0, 100, "水平缩放"),
    scaleY: animated(data.scaleY, duration, 0, 100, "垂直缩放"),
    rotation: animated(data.rotation, duration, -36e4, 36e4, "旋转"),
    opacity: animated(data.opacity, duration, 0, 1, "不透明度"),
    flipX: bool(data.flipX, "水平翻转"),
    flipY: bool(data.flipY, "垂直翻转"),
    fit: choice(data.fit, ["contain", "cover", "stretch"], "画面适配"),
    crop: bounds
  };
}
function adjustment(value, duration) {
  const data = object4(
    value,
    [
      "exposure",
      "brightness",
      "contrast",
      "saturation",
      "temperature",
      "tint",
      "hue",
      "curves",
      "hsl"
    ],
    "调色"
  );
  const channels = /* @__PURE__ */ new Set();
  const curves = list(data.curves, 4, "调色曲线").map((raw) => {
    const curve = object4(raw, ["channel", "points"], "调色曲线");
    const channel = choice(curve.channel, ["rgb", "red", "green", "blue"], "曲线通道");
    if (channels.has(channel)) throw new Error("调色曲线通道重复");
    channels.add(channel);
    let last = -1;
    const points = list(curve.points, 256, "曲线节点", 2).map((entry) => {
      const point = object4(entry, ["x", "y"], "曲线节点");
      const x = number(point.x, 0, 1, "曲线输入"), y = number(point.y, 0, 1, "曲线输出");
      if (x <= last) throw new Error("调色曲线输入必须严格递增");
      last = x;
      return { x, y };
    });
    if (points[0].x !== 0 || points.at(-1).x !== 1) throw new Error("调色曲线必须覆盖 0 至 1");
    return { channel, points };
  });
  const hsl = list(data.hsl, 24, "HSL 调整").map((raw) => {
    const band = object4(raw, ["hue", "width", "hueShift", "saturation", "lightness"], "HSL 调整");
    return {
      hue: number(band.hue, 0, 360, "HSL 色相"),
      width: number(band.width, 1e-3, 360, "HSL 范围"),
      hueShift: number(band.hueShift, -180, 180, "HSL 色相偏移"),
      saturation: number(band.saturation, -1, 1, "HSL 饱和度"),
      lightness: number(band.lightness, -1, 1, "HSL 明度")
    };
  });
  return {
    exposure: animated(data.exposure, duration, -10, 10, "曝光"),
    brightness: animated(data.brightness, duration, -1, 1, "亮度"),
    contrast: animated(data.contrast, duration, 0, 4, "对比度"),
    saturation: animated(data.saturation, duration, 0, 4, "饱和度"),
    temperature: animated(data.temperature, duration, -1, 1, "色温"),
    tint: animated(data.tint, duration, -1, 1, "色调"),
    hue: animated(data.hue, duration, -360, 360, "色相"),
    curves,
    hsl
  };
}
function mask(value) {
  const data = object4(
    value,
    ["kind", "x", "y", "width", "height", "rotation", "feather", "inverted", "points"],
    "蒙版"
  );
  const kind = choice(data.kind, ["rectangle", "ellipse", "linear", "path"], "蒙版类型");
  let points;
  if (kind === "path") {
    points = list(data.points, 256, "蒙版顶点", 3).map((raw) => {
      const point = object4(raw, ["x", "y"], "蒙版顶点");
      return { x: number(point.x, 0, 1, "蒙版顶点 x"), y: number(point.y, 0, 1, "蒙版顶点 y") };
    });
    if (new Set(points.map((point) => `${point.x}:${point.y}`)).size < 3)
      throw new Error("路径蒙版至少需要三个不同顶点");
  } else if (data.points !== void 0) throw new Error("只有路径蒙版可以保存顶点");
  return {
    kind,
    x: number(data.x, -2, 2, "蒙版 x"),
    y: number(data.y, -2, 2, "蒙版 y"),
    width: number(data.width, 1e-3, 4, "蒙版宽度"),
    height: number(data.height, 1e-3, 4, "蒙版高度"),
    rotation: number(data.rotation, -36e4, 36e4, "蒙版旋转"),
    feather: number(data.feather, 0, 1, "蒙版羽化"),
    inverted: bool(data.inverted, "蒙版反转"),
    ...points ? { points } : {}
  };
}
function visual(data, duration) {
  return {
    transform: transform(data.transform, duration),
    color: adjustment(data.color, duration),
    blendMode: choice(
      data.blendMode,
      ["normal", "multiply", "screen", "overlay", "darken", "lighten"],
      "混合模式"
    ),
    ...data.mask === void 0 ? {} : { mask: mask(data.mask) }
  };
}
function audio(value, duration) {
  const data = object4(
    value,
    ["volume", "pan", "fadeIn", "fadeOut", "pitchSemitones", "preservePitch", "ducking"],
    "音频混音"
  );
  let ducking;
  if (data.ducking !== void 0) {
    const sidechain = object4(
      data.ducking,
      ["sidechainTrackIds", "thresholdDb", "attenuationDb", "attack", "release"],
      "自动压低背景声"
    );
    const sidechainTrackIds = list(sidechain.sidechainTrackIds, 64, "参考音轨", 1).map(
      (value2) => id(value2, "参考音轨 ID")
    );
    if (new Set(sidechainTrackIds).size !== sidechainTrackIds.length)
      throw new Error("参考音轨重复");
    ducking = {
      sidechainTrackIds,
      thresholdDb: number(sidechain.thresholdDb, -96, 0, "压低触发电平"),
      attenuationDb: number(sidechain.attenuationDb, 0, 60, "压低分贝"),
      attack: integer2(sidechain.attack, 0, TICKS_PER_SECOND * 10, "压低启动时间"),
      release: integer2(sidechain.release, 0, TICKS_PER_SECOND * 30, "压低恢复时间")
    };
  }
  return {
    volume: animated(data.volume, duration, 0, 4, "音量"),
    pan: animated(data.pan, duration, -1, 1, "声像"),
    fadeIn: integer2(data.fadeIn, 0, duration, "声音淡入"),
    fadeOut: integer2(data.fadeOut, 0, duration, "声音淡出"),
    pitchSemitones: number(data.pitchSemitones, -24, 24, "音高"),
    preservePitch: bool(data.preservePitch, "保持音高"),
    ...ducking ? { ducking } : {}
  };
}
function textStyle(value) {
  const data = object4(
    value,
    [
      "layout",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "italic",
      "color",
      "strokeColor",
      "strokeWidth",
      "background",
      "backgroundRadius",
      "padding",
      "align",
      "lineHeight",
      "letterSpacing",
      "maxWidth",
      "highlightColor",
      "keywords",
      "shadow",
      "animation"
    ],
    "文字样式"
  );
  const shadow = object4(data.shadow, ["color", "blur", "x", "y"], "文字阴影");
  return {
    layout: choice(data.layout, ["box", "caption-stack"], "文字布局"),
    fontFamily: text(data.fontFamily, 200, "字体"),
    fontSize: number(data.fontSize, 1, 2048, "字号"),
    fontWeight: integer2(data.fontWeight, 1, 1e3, "字重"),
    italic: bool(data.italic, "斜体"),
    color: color(data.color, "文字颜色"),
    strokeColor: color(data.strokeColor, "文字描边颜色"),
    strokeWidth: number(data.strokeWidth, 0, 100, "文字描边宽度"),
    background: color(data.background, "文字背景"),
    backgroundRadius: number(data.backgroundRadius, 0, 512, "文字背景圆角"),
    padding: number(data.padding, 0, 512, "文字背景内边距"),
    align: choice(data.align, ["left", "center", "right"], "文字对齐"),
    lineHeight: number(data.lineHeight, 0.5, 5, "文字行高"),
    letterSpacing: number(data.letterSpacing, -100, 100, "字间距"),
    maxWidth: number(data.maxWidth, 0.01, 1, "文字最大宽度比例"),
    highlightColor: color(data.highlightColor, "文字高亮颜色"),
    ...data.keywords === void 0 ? {} : {
      keywords: list(data.keywords, 32, "关键词强调").map((value2) => {
        const keyword = object4(value2, ["text", "color"], "关键词强调");
        return {
          text: text(keyword.text, 200, "关键词"),
          color: color(keyword.color, "关键词颜色")
        };
      })
    },
    shadow: {
      color: color(shadow.color, "文字阴影颜色"),
      blur: number(shadow.blur, 0, 256, "文字阴影模糊"),
      x: number(shadow.x, -2048, 2048, "文字阴影水平偏移"),
      y: number(shadow.y, -2048, 2048, "文字阴影垂直偏移")
    },
    animation: choice(data.animation, ["none", "fade", "typewriter", "word-highlight"], "文字动画")
  };
}
function asset(value) {
  const data = object4(
    value,
    ["id", "name", "kind", "duration", "width", "height", "resourceId", "fingerprint", "metadata"],
    "素材"
  );
  const kind = choice(data.kind, ["video", "audio", "image", "demo"], "素材类型");
  let resourceId;
  if (data.resourceId !== void 0) {
    resourceId = text(data.resourceId, 256, "素材资源 ID");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(resourceId))
      throw new Error("素材资源 ID 无效");
  }
  if (data.fingerprint !== void 0 && (typeof data.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.fingerprint)))
    throw new Error("素材指纹须为 SHA-256");
  return {
    id: id(data.id, "素材 ID"),
    name: text(data.name, 256, "素材名称"),
    kind,
    duration: tick(data.duration, "素材时长", kind !== "image"),
    ...data.width === void 0 ? {} : { width: integer2(data.width, 1, 32768, "素材宽度") },
    ...data.height === void 0 ? {} : { height: integer2(data.height, 1, 32768, "素材高度") },
    ...resourceId === void 0 ? {} : { resourceId },
    ...data.fingerprint === void 0 ? {} : { fingerprint: data.fingerprint },
    ...data.metadata === void 0 ? {} : { metadata: dataObject(data.metadata, "素材元数据") }
  };
}
function track(value) {
  const data = object4(
    value,
    ["id", "name", "kind", "locked", "hidden", "muted", "volume", "pan"],
    "轨道"
  );
  return {
    id: id(data.id, "轨道 ID"),
    name: text(data.name, 200, "轨道名称"),
    kind: choice(data.kind, ["video", "audio", "text"], "轨道类型"),
    locked: bool(data.locked, "锁定轨道"),
    hidden: bool(data.hidden, "隐藏轨道"),
    muted: bool(data.muted, "静音轨道"),
    volume: number(data.volume, 0, 4, "轨道音量"),
    pan: number(data.pan, -1, 1, "轨道声像")
  };
}
var clipKeys = [
  "id",
  "kind",
  "trackId",
  "start",
  "duration",
  "label",
  "groupId",
  "linkGroupId",
  "transform",
  "color",
  "blendMode",
  "mask"
];
function clip(value, assets) {
  const raw = object4(
    value,
    [
      ...clipKeys,
      "assetId",
      "timeMap",
      "audio",
      "role",
      "text",
      "style",
      "words",
      "sourceBinding",
      "translation",
      "shape",
      "fill",
      "stroke",
      "strokeWidth",
      "sequenceId",
      "angles",
      "switches",
      "audioAngleId"
    ],
    "片段"
  );
  const kind = choice(raw.kind, ["media", "text", "shape", "sequence", "multicam"], "片段类型");
  const keys3 = {
    media: ["assetId", "timeMap", "audio"],
    text: ["role", "text", "style", "words", "sourceBinding", "translation"],
    shape: ["shape", "fill", "stroke", "strokeWidth"],
    sequence: ["sequenceId", "timeMap", "audio"],
    multicam: ["timeMap", "angles", "switches", "audioAngleId", "audio"]
  };
  const data = object4(raw, [...clipKeys, ...keys3[kind]], "片段");
  const start = tick(data.start, "片段起点"), duration = tick(data.duration, "片段时长", true);
  if (start + duration > MAX_EDITOR_TICK) throw new Error("片段末端超过 24 小时");
  const base = {
    id: id(data.id, "片段 ID"),
    trackId: id(data.trackId, "片段轨道 ID"),
    start,
    duration,
    label: text(data.label, 256, "片段名称", true),
    ...data.groupId === void 0 ? {} : { groupId: id(data.groupId, "分组 ID") },
    ...data.linkGroupId === void 0 ? {} : { linkGroupId: id(data.linkGroupId, "关联组 ID") },
    ...visual(data, duration)
  };
  if (kind === "media") {
    const assetId = id(data.assetId, "片段素材 ID"), source2 = assets.get(assetId);
    if (!source2) throw new Error(`片段引用不存在的素材：${assetId}`);
    const mapping = timeMap(data.timeMap, duration, source2.duration);
    if (source2.kind !== "image") assertNoEmptyHold(mapping, source2.duration, "媒体片段");
    return { ...base, kind, assetId, timeMap: mapping, audio: audio(data.audio, duration) };
  }
  if (kind === "sequence")
    return {
      ...base,
      kind,
      sequenceId: id(data.sequenceId, "嵌套序列 ID"),
      timeMap: timeMap(data.timeMap, duration, MAX_EDITOR_TICK),
      audio: audio(data.audio, duration)
    };
  if (kind === "shape")
    return {
      ...base,
      kind,
      shape: choice(data.shape, ["rectangle", "ellipse", "line"], "图形类型"),
      fill: color(data.fill, "图形填充"),
      stroke: color(data.stroke, "图形描边"),
      strokeWidth: number(data.strokeWidth, 0, 1024, "图形描边宽度")
    };
  if (kind === "multicam") {
    const angles = list(data.angles, 32, "多机位", 2).map((raw2) => {
      const angle = object4(raw2, ["id", "name", "assetId", "offset"], "机位");
      const assetId = id(angle.assetId, "机位素材 ID");
      if (assets.get(assetId)?.kind !== "video") throw new Error("多机位须引用有效的视频素材");
      return {
        id: id(angle.id, "机位 ID"),
        name: text(angle.name, 200, "机位名称"),
        assetId,
        offset: integer2(angle.offset, -MAX_EDITOR_TICK, MAX_EDITOR_TICK, "机位同步偏移")
      };
    });
    const anglesById = unique(angles, "机位");
    let previous = -1;
    const switches = list(data.switches, 1e4, "机位切换", 1).map((raw2) => {
      const change = object4(raw2, ["time", "angleId"], "机位切换");
      const time = integer2(change.time, 0, duration - 1, "机位切换时间");
      if (time <= previous) throw new Error("机位切换时间必须严格递增");
      previous = time;
      const angleId = id(change.angleId, "切换机位 ID");
      if (!anglesById.has(angleId)) throw new Error("切换引用不存在的机位");
      return { time, angleId };
    });
    if (switches[0].time !== 0) throw new Error("多机位须从零时刻指定画面");
    const audioAngleId = id(data.audioAngleId, "主声音机位 ID");
    if (!anglesById.has(audioAngleId)) throw new Error("主声音引用不存在的机位");
    return {
      ...base,
      kind,
      timeMap: timeMap(data.timeMap, duration, MAX_EDITOR_TICK),
      angles,
      switches,
      audioAngleId,
      audio: audio(data.audio, duration)
    };
  }
  let previousStart = -1, previousEnd = -1;
  const words = list(data.words, 1e4, "逐字字幕").map((raw2) => {
    const word = object4(raw2, ["text", "start", "end"], "字幕词");
    const start2 = integer2(word.start, 0, duration - 1, "字幕词入点");
    const end = integer2(word.end, start2 + 1, duration, "字幕词出点");
    if (start2 < previousStart || end < previousEnd) throw new Error("字幕词时间必须按顺序排列");
    previousStart = start2;
    previousEnd = end;
    return { text: text(word.text, 1e3, "字幕词"), start: start2, end };
  });
  let sourceBinding;
  if (data.sourceBinding !== void 0) {
    const binding = object4(
      data.sourceBinding,
      ["clipId", "sourceStart", "sourceEnd", "provenance"],
      "字幕来源"
    );
    const sourceStart = tick(binding.sourceStart, "字幕源入点"), sourceEnd = tick(binding.sourceEnd, "字幕源出点");
    if (sourceEnd <= sourceStart) throw new Error("字幕来源须有有效时长");
    sourceBinding = { clipId: id(binding.clipId, "字幕来源片段 ID"), sourceStart, sourceEnd };
    if (binding.provenance !== void 0) {
      const raw2 = object4(binding.provenance, ["path", "assetId", "start", "end"], "字幕实际音源");
      const start2 = tick(raw2.start, "转写素材入点"), end = tick(raw2.end, "转写素材出点");
      if (end <= start2) throw new Error("字幕实际音源须有正时长");
      sourceBinding.provenance = {
        path: list(raw2.path, 50, "嵌套音源路径").map((value2) => id(value2, "嵌套来源片段 ID")),
        assetId: id(raw2.assetId, "转写素材 ID"),
        start: start2,
        end
      };
    }
  }
  let translation;
  if (data.translation !== void 0) {
    const translated = object4(
      data.translation,
      ["original", "language", "mode", "originalWords"],
      "字幕翻译"
    );
    translation = {
      original: text(translated.original, 1e4, "字幕原文", false, true),
      language: text(translated.language, 80, "字幕语言"),
      mode: choice(translated.mode, ["bilingual", "translated"], "字幕翻译模式")
    };
    if (translated.originalWords !== void 0) {
      let previousStart2 = -1, previousEnd2 = -1;
      translation.originalWords = list(translated.originalWords, 1e4, "字幕原文词时间").map(
        (raw2) => {
          const word = object4(raw2, ["text", "start", "end"], "原文词");
          const start2 = integer2(word.start, 0, duration - 1, "原文词入点"), end = integer2(word.end, start2 + 1, duration, "原文词出点");
          if (start2 < previousStart2 || end < previousEnd2)
            throw new Error("原文词时间必须按顺序排列");
          previousStart2 = start2;
          previousEnd2 = end;
          return { text: text(word.text, 1e3, "原文词"), start: start2, end };
        }
      );
    }
  }
  return {
    ...base,
    kind: "text",
    role: choice(data.role, ["title", "subtitle"], "文字用途"),
    text: text(data.text, 1e4, "文字内容", true, true),
    style: textStyle(data.style),
    words,
    ...sourceBinding ? { sourceBinding } : {},
    ...translation ? { translation } : {}
  };
}
function sequenceDuration(sequence5) {
  let duration = 0;
  for (const clip3 of sequence5.clips) {
    const end = tick(clip3.start, "片段起点") + tick(clip3.duration, "片段时长", true);
    if (end > MAX_EDITOR_TICK) throw new Error("序列超过 24 小时");
    duration = Math.max(duration, end);
  }
  return duration;
}
function sequence(value, assets) {
  const data = object4(
    value,
    [
      "id",
      "name",
      "width",
      "height",
      "frameRate",
      "background",
      "timelineMode",
      "magneticTrackId",
      "tracks",
      "clips",
      "transitions",
      "markers"
    ],
    "序列"
  );
  object4(data.frameRate, ["numerator", "denominator"], "序列帧率");
  const tracks = list(data.tracks, 128, "轨道").map(track);
  unique(tracks, "轨道");
  const magneticTrackId = data.magneticTrackId === void 0 ? void 0 : id(data.magneticTrackId, "磁吸主轨 ID");
  if (magneticTrackId !== void 0 && !tracks.some((track3) => track3.id === magneticTrackId && track3.kind === "video"))
    throw new Error("磁吸主轨必须引用现有画面轨");
  const clips = list(data.clips, 2e3, "片段").map((value2) => clip(value2, assets));
  unique(clips, "片段");
  const transitions = list(data.transitions, 2e3, "转场").map((raw) => {
    const transition = object4(
      raw,
      ["id", "fromClipId", "toClipId", "start", "duration", "kind"],
      "转场"
    );
    const start = tick(transition.start, "转场起点"), duration = tick(transition.duration, "转场时长", true);
    if (start + duration > MAX_EDITOR_TICK) throw new Error("转场超过 24 小时");
    return {
      id: id(transition.id, "转场 ID"),
      fromClipId: id(transition.fromClipId, "转场起始片段"),
      toClipId: id(transition.toClipId, "转场结束片段"),
      start,
      duration,
      kind: choice(
        transition.kind,
        ["dissolve", "fade-black", "wipe-left", "wipe-right", "push-left", "push-right"],
        "转场类型"
      )
    };
  });
  unique(transitions, "转场");
  const markers = list(data.markers, 1e4, "时间轴标记").map((raw) => {
    const marker = object4(raw, ["id", "time", "duration", "name", "note", "color"], "时间轴标记");
    const time = tick(marker.time, "标记时间"), duration = tick(marker.duration, "标记范围");
    if (time + duration > MAX_EDITOR_TICK) throw new Error("标记范围超过 24 小时");
    return {
      id: id(marker.id, "标记 ID"),
      time,
      duration,
      name: text(marker.name, 200, "标记名称"),
      note: text(marker.note, 1e4, "标记备注", true, true),
      color: color(marker.color, "标记颜色")
    };
  });
  unique(markers, "标记");
  return {
    id: id(data.id, "序列 ID"),
    name: text(data.name, 200, "序列名称"),
    width: integer2(data.width, 16, 8192, "序列宽度"),
    height: integer2(data.height, 16, 8192, "序列高度"),
    frameRate: validateFrameRate(data.frameRate),
    background: color(data.background, "序列背景"),
    timelineMode: choice(data.timelineMode, ["magnetic", "free"], "排列方式"),
    ...magneticTrackId === void 0 ? {} : { magneticTrackId },
    tracks,
    clips,
    transitions,
    markers
  };
}
function compatibleTrack(clip3, track3, assets) {
  if (clip3.kind === "text") return track3.kind === "text";
  if (clip3.kind === "shape" || clip3.kind === "multicam") return track3.kind === "video";
  if (clip3.kind === "sequence") return track3.kind !== "text";
  const source2 = assets.get(clip3.assetId);
  return source2.kind === "audio" ? track3.kind === "audio" : source2.kind === "video" ? track3.kind !== "text" : track3.kind === "video";
}
function multicamBounds(clip3, assets) {
  const angles = new Map(clip3.angles.map((angle) => [angle.id, angle]));
  function range(angleId, start, end) {
    const angle = angles.get(angleId), source2 = assets.get(angle.assetId);
    const coordinates = [
      sourceTimeAt(clip3.timeMap, start),
      ...clip3.timeMap.points.filter((point) => point.time > start && point.time < end).map((point) => point.source),
      sourceTimeAt(clip3.timeMap, end)
    ];
    if (coordinates.some(
      (position) => position + angle.offset < 0 || position + angle.offset > source2.duration
    ))
      throw new Error(`机位 ${angle.name} 的画面或声音范围超出素材`);
    if (coordinates.some(
      (position, index2) => index2 > 0 && position + angle.offset === source2.duration && coordinates[index2 - 1] + angle.offset === source2.duration
    ))
      throw new Error(`机位 ${angle.name} 不能在素材结束边界定格`);
  }
  for (const [index2, change] of clip3.switches.entries())
    range(change.angleId, change.time, clip3.switches[index2 + 1]?.time ?? clip3.duration);
  const volume2 = clip3.audio.volume;
  if (typeof volume2 === "number" ? volume2 > 0 : volume2.keyframes.some((frame2) => frame2.value > 0))
    range(clip3.audioAngleId, 0, clip3.duration);
}
function checkSequenceReferences(sequence5, assets, sequences) {
  const tracks = new Map(sequence5.tracks.map((track3) => [track3.id, track3]));
  const clips = new Map(sequence5.clips.map((clip3) => [clip3.id, clip3]));
  for (const clip3 of sequence5.clips) {
    const track3 = tracks.get(clip3.trackId);
    if (!track3) throw new Error(`片段引用不存在的轨道：${clip3.trackId}`);
    if (!compatibleTrack(clip3, track3, assets)) throw new Error(`片段 ${clip3.id} 与轨道类型不兼容`);
    if (clip3.kind === "sequence") {
      const source2 = sequences.get(clip3.sequenceId);
      if (!source2) throw new Error(`嵌套引用不存在的序列：${clip3.sequenceId}`);
      const sourceDuration = sequenceDuration(source2);
      if (!sourceDuration) throw new Error("嵌套片段不能引用空序列");
      validateTimeMap(clip3.timeMap, clip3.duration, sourceDuration);
      assertNoEmptyHold(clip3.timeMap, sourceDuration, "嵌套片段");
    }
    if (clip3.kind === "multicam") multicamBounds(clip3, assets);
    if ("audio" in clip3 && clip3.audio.ducking)
      for (const trackId of clip3.audio.ducking.sidechainTrackIds) {
        const source2 = tracks.get(trackId);
        if (!source2 || source2.kind === "text" || source2.id === clip3.trackId)
          throw new Error("压低背景声须引用其他有效声音轨道");
      }
    if (clip3.kind === "text" && clip3.sourceBinding) {
      const binding = clip3.sourceBinding, source2 = clips.get(binding.clipId);
      if (!source2 || !("timeMap" in source2)) throw new Error("字幕来源须引用有效的媒体或序列片段");
      const sourceSequence = source2.kind === "sequence" ? sequences.get(source2.sequenceId) : void 0;
      if (source2.kind === "sequence" && !sourceSequence)
        throw new Error("字幕来源引用不存在的嵌套序列");
      const sourceDuration = source2.kind === "media" ? assets.get(source2.assetId).duration : source2.kind === "sequence" ? sequenceDuration(sourceSequence) : MAX_EDITOR_TICK;
      if (binding.sourceEnd > sourceDuration) throw new Error("字幕来源范围超出素材");
      if (binding.provenance) {
        let leaf = source2;
        for (const clipId of binding.provenance.path) {
          if (leaf.kind !== "sequence") throw new Error("字幕嵌套音源路径须经过序列片段");
          const child = sequences.get(leaf.sequenceId)?.clips.find((item) => item.id === clipId);
          if (!child || !("timeMap" in child)) throw new Error("字幕嵌套音源不存在");
          leaf = child;
        }
        const assetId = leaf.kind === "media" ? leaf.assetId : leaf.kind === "multicam" ? leaf.angles.find((angle) => angle.id === leaf.audioAngleId)?.assetId : void 0;
        const asset2 = assets.get(binding.provenance.assetId);
        if (assetId !== binding.provenance.assetId || !asset2 || !["audio", "video"].includes(asset2.kind) || binding.provenance.end > asset2.duration)
          throw new Error("字幕实际音源或转写范围与来源片段不一致");
      }
    }
  }
  const pairs = /* @__PURE__ */ new Set();
  for (const transition of sequence5.transitions) {
    const from = clips.get(transition.fromClipId), to = clips.get(transition.toClipId);
    if (!from || !to || from.id === to.id || from.trackId !== to.trackId || tracks.get(from.trackId)?.kind !== "video")
      throw new Error("转场两端须为同一画面轨的两个有效片段");
    const end = from.start + from.duration;
    if (from.start >= to.start || end >= to.start + to.duration || to.start >= end || transition.start !== to.start || transition.duration !== end - to.start)
      throw new Error("转场时间须精确覆盖前后片段的重叠范围");
    const key = JSON.stringify([from.id, to.id]);
    if (pairs.has(key)) throw new Error("同一片段交界不能重复设置转场");
    pairs.add(key);
  }
  for (const track3 of sequence5.tracks.filter((track4) => track4.kind === "video")) {
    const placed = sequence5.clips.filter((clip3) => clip3.trackId === track3.id).sort((a, b) => a.start - b.start || a.duration - b.duration);
    let active = [];
    for (const clip3 of placed) {
      active = active.filter((previous) => previous.start + previous.duration > clip3.start);
      if (active.length > 1) throw new Error("同一画面轨不能同时重叠三个片段");
      for (const previous of active)
        if (!pairs.has(JSON.stringify([previous.id, clip3.id])))
          throw new Error("同轨画面重叠需要明确的转场");
      active.push(clip3);
    }
  }
}
function validateEditorDocument(value) {
  const data = object4(
    copyData(value),
    [
      "schemaVersion",
      "timebase",
      "id",
      "name",
      "revision",
      "assets",
      "sequences",
      "activeSequenceId",
      "exportProfiles",
      "production"
    ],
    "工程"
  );
  if (data.schemaVersion !== 2 || data.timebase !== TICKS_PER_SECOND)
    throw new Error("不支持此工程版本或时间基准");
  const assets = list(data.assets, 1e3, "素材").map(asset), assetsById = unique(assets, "素材");
  const sequences = list(data.sequences, 50, "序列", 1).map((value2) => sequence(value2, assetsById));
  const sequencesById = unique(sequences, "序列");
  const activeSequenceId = id(data.activeSequenceId, "活动序列 ID");
  if (!sequencesById.has(activeSequenceId)) throw new Error("活动序列不存在");
  for (const sequence5 of sequences) checkSequenceReferences(sequence5, assetsById, sequencesById);
  const visiting = /* @__PURE__ */ new Set(), visited = /* @__PURE__ */ new Set();
  function acyclic(id5) {
    if (visiting.has(id5)) throw new Error("嵌套序列不能循环引用");
    if (visited.has(id5)) return;
    visiting.add(id5);
    for (const clip3 of sequencesById.get(id5).clips)
      if (clip3.kind === "sequence") acyclic(clip3.sequenceId);
    visiting.delete(id5);
    visited.add(id5);
  }
  for (const sequence5 of sequences) acyclic(sequence5.id);
  const exportProfiles = list(data.exportProfiles, 64, "导出配置").map(validateExportProfile);
  unique(exportProfiles, "导出配置");
  return {
    schemaVersion: 2,
    timebase: TICKS_PER_SECOND,
    id: id(data.id, "工程 ID"),
    name: text(data.name, 200, "工程名称"),
    revision: integer2(data.revision, 0, Number.MAX_SAFE_INTEGER - 1, "修订号"),
    assets,
    sequences,
    activeSequenceId,
    exportProfiles,
    ...data.production === void 0 ? {} : { production: dataObject(data.production, "制作记录") }
  };
}

// src/editor/caption-bindings.ts
function route(document, sequenceId, binding) {
  const sequences = new Map(document.sequences.map((seq2) => [seq2.id, seq2]));
  let seq = sequences.get(sequenceId), clip3 = seq?.clips.find((item) => item.id === binding.clipId);
  const stages = [];
  if (!clip3 || !("timeMap" in clip3)) return null;
  stages.push({ clip: clip3, sequenceId });
  for (const id5 of binding.provenance?.path ?? []) {
    if (clip3.kind !== "sequence") return null;
    seq = sequences.get(clip3.sequenceId);
    clip3 = seq?.clips.find((item) => item.id === id5);
    if (!seq || !clip3 || !("timeMap" in clip3)) return null;
    stages.push({ clip: clip3, sequenceId: seq.id });
  }
  if (clip3.kind === "media") return { stages, assetId: clip3.assetId, offset: 0 };
  if (clip3.kind === "multicam") {
    const angle = clip3.angles.find((item) => item.id === clip3.audioAngleId);
    return angle ? { stages, assetId: angle.assetId, offset: angle.offset } : null;
  }
  return null;
}
function merge(ranges) {
  if (ranges.length > 1e5) throw new Error("嵌套字幕映射过大，请先拆分序列");
  const result = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = result.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else if (range.start < range.end) result.push({ ...range });
  }
  return result;
}
function map(path, from, to) {
  let ranges = [{ start: Math.max(0, from - path.offset), end: Math.max(0, to - path.offset) }];
  for (const stage of path.stages.slice().reverse())
    ranges = merge(
      ranges.flatMap(
        (range) => sourceRangesToTimeline(stage.clip.timeMap, range.start, range.end).map((item) => ({
          start: item.start + stage.clip.start,
          end: item.end + stage.clip.start
        }))
      )
    );
  return ranges;
}
function sample(path, tick2) {
  for (const { clip: clip3 } of path.stages) {
    const local = tick2 - clip3.start;
    if (local < 0 || local > clip3.duration) throw new Error("字幕词超出嵌套音源，请先校准字幕");
    tick2 = sourceTimeAt(clip3.timeMap, local);
  }
  return tick2 + path.offset;
}
var signature = (path) => JSON.stringify([
  path.assetId,
  path.offset,
  path.stages.map(({ clip: clip3, sequenceId }) => [
    sequenceId,
    clip3.id,
    clip3.start,
    clip3.duration,
    clip3.timeMap
  ])
]);
function normalized(path) {
  let shift = 0;
  const chain = [];
  for (const { clip: clip3 } of path.stages) {
    const points = clip3.timeMap.points;
    if (points.every(
      (point, index2) => index2 === 0 || point.source - points[index2 - 1].source === point.time - points[index2 - 1].time
    ))
      shift += points[0].source - clip3.start;
    else {
      chain.push({ offset: shift - clip3.start, points });
      shift = 0;
    }
  }
  return JSON.stringify({ chain, outputOffset: shift + path.offset });
}
function stretch(value, oldDuration, duration) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => stretch(item, oldDuration, duration));
  if (Object.hasOwn(value, "keyframes")) {
    const keys3 = value.keyframes.map((key) => ({
      ...key,
      time: Math.round(key.time * duration / oldDuration)
    }));
    if (new Set(keys3.map((key) => key.time)).size !== keys3.length)
      throw new Error("字幕动画变速后过密，请先调整关键帧");
    return { keyframes: keys3 };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, stretch(child, oldDuration, duration)])
  );
}
function reconcileDependentCaptions(before, after) {
  for (const oldSequence of before.sequences)
    for (const oldCaption of oldSequence.clips) {
      if (oldCaption.kind !== "text" || !oldCaption.sourceBinding?.provenance) continue;
      const nextSequence = after.sequences.find((seq) => seq.id === oldSequence.id);
      const current = nextSequence?.clips.find((clip3) => clip3.id === oldCaption.id);
      if (!nextSequence || !current || current.kind !== "text" || !current.sourceBinding?.provenance)
        continue;
      const oldPath = route(before, oldSequence.id, oldCaption.sourceBinding), nextPath = route(after, nextSequence.id, current.sourceBinding);
      if (!oldPath) throw new Error("既有字幕音源无效");
      const locked = () => {
        if (nextSequence.tracks.find((track3) => track3.id === current.trackId)?.locked)
          throw new Error("嵌套来源关联的字幕轨已锁定，请先解锁字幕轨");
      };
      if (!nextPath) {
        locked();
        nextSequence.clips = nextSequence.clips.filter((clip3) => clip3.id !== current.id);
        continue;
      }
      if (signature(oldPath) === signature(nextPath)) continue;
      if (oldPath.assetId !== nextPath.assetId || oldPath.offset !== nextPath.offset)
        throw new Error("实际字幕音源已变化，请先解除关联字幕或重新生成，不能沿用旧转写");
      locked();
      const sameInner = JSON.stringify(oldPath.stages.slice(1).map((stage) => stage.clip)) === JSON.stringify(nextPath.stages.slice(1).map((stage) => stage.clip));
      if (sameInner && (current.start !== oldCaption.start || current.duration !== oldCaption.duration))
        continue;
      const provenance = current.sourceBinding.provenance;
      const oldRanges = map(oldPath, provenance.start, provenance.end), newRanges = map(nextPath, provenance.start, provenance.end);
      if (!newRanges.length) {
        nextSequence.clips = nextSequence.clips.filter((clip3) => clip3.id !== current.id);
        continue;
      }
      const index2 = oldRanges.findIndex(
        (range2) => range2.start === oldCaption.start && range2.end === oldCaption.start + oldCaption.duration
      );
      if (index2 < 0 || newRanges.length !== oldRanges.length)
        throw new Error("嵌套字幕范围已独立调整或分成多段，请先解绑或重新生成");
      const range = newRanges[index2];
      const pathRewritten = JSON.stringify(oldCaption.sourceBinding.provenance?.path) !== JSON.stringify(provenance.path) || oldCaption.sourceBinding.clipId !== current.sourceBinding.clipId;
      const sameOutput = oldRanges.length === newRanges.length && oldRanges.every(
        (range2, i) => range2.start === newRanges[i].start && range2.end === newRanges[i].end
      );
      const pureWrappers = pathRewritten && sameOutput && normalized(oldPath) === normalized(nextPath);
      if (provenance.path.length && !pureWrappers && oldPath.stages.some((stage, i) => {
        const old = stage.clip.timeMap.points.map((point) => point.source), next = nextPath.stages[i]?.clip.timeMap.points.map((point) => point.source);
        return !next || Math.min(...old) !== Math.min(...next) || Math.max(...old) !== Math.max(...next);
      }))
        throw new Error("裁掉嵌套音源会改变外层字幕内容，请先解绑或重新生成外层字幕");
      const duration = range.end - range.start;
      const remapWords = (input, originals) => input.map((word, wordIndex) => {
        const original = originals[wordIndex];
        if (!original) throw new Error("同批修改逐字内容和嵌套时间，请分步处理");
        const a2 = sample(oldPath, oldCaption.start + original.start), b2 = sample(oldPath, oldCaption.start + original.end - 1);
        const mapped = map(nextPath, Math.min(a2, b2), Math.max(a2, b2) + 1).map((item) => ({
          start: Math.max(item.start, range.start),
          end: Math.min(item.end, range.end)
        })).filter((item) => item.start < item.end);
        if (mapped.length !== 1) throw new Error("嵌套变速后的词时间不连续，请先解绑或重新生成");
        return {
          ...word,
          start: mapped[0].start - range.start,
          end: mapped[0].end - range.start
        };
      });
      const words = remapWords(current.words, oldCaption.words);
      const originalWords = current.translation?.originalWords ? remapWords(
        current.translation.originalWords,
        oldCaption.translation?.originalWords ?? oldCaption.words
      ) : void 0;
      if ([words, originalWords ?? []].some(
        (list5) => list5.some(
          (word, i) => i > 0 && (word.start < list5[i - 1].start || word.end < list5[i - 1].end)
        )
      ))
        throw new Error("倒放改变字幕词顺序，请先解绑或重新生成");
      const updated = stretch(current, current.duration, duration);
      updated.start = range.start;
      updated.duration = duration;
      updated.words = words;
      if (originalWords) updated.translation.originalWords = originalWords;
      const owner = nextPath.stages[0].clip, a = sourceTimeAt(owner.timeMap, range.start - owner.start), b = sourceTimeAt(owner.timeMap, range.end - 1 - owner.start);
      updated.sourceBinding = {
        ...current.sourceBinding,
        sourceStart: Math.min(a, b),
        sourceEnd: Math.max(a, b) + 1
      };
      nextSequence.clips[nextSequence.clips.indexOf(current)] = updated;
    }
}

// src/editor/operations.ts
var OPERATION_KEYS = {
  "asset.add": ["type", "asset"],
  "asset.update": ["type", "assetId", "patch"],
  "asset.remove": ["type", "assetId"],
  "sequence.add": ["type", "sequence", "index"],
  "sequence.update": ["type", "sequenceId", "patch"],
  "sequence.remove": ["type", "sequenceId"],
  "sequence.rename": ["type", "sequenceId", "name"],
  "sequence.activate": ["type", "sequenceId"],
  "track.add": ["type", "sequenceId", "track", "index"],
  "track.update": ["type", "sequenceId", "trackId", "patch"],
  "track.remove": ["type", "sequenceId", "trackId", "removeClips"],
  "track.reorder": ["type", "sequenceId", "trackIds"],
  "clip.add": ["type", "sequenceId", "clip"],
  "clip.update": ["type", "sequenceId", "clipId", "patch"],
  "clip.remove": ["type", "sequenceId", "clipIds"],
  "clip.move": ["type", "sequenceId", "clipIds", "delta", "trackId"],
  "marker.add": ["type", "sequenceId", "marker"],
  "marker.update": ["type", "sequenceId", "markerId", "patch"],
  "marker.remove": ["type", "sequenceId", "markerId"],
  "transition.add": ["type", "sequenceId", "transition"],
  "transition.remove": ["type", "sequenceId", "transitionId"],
  "project.rename": ["type", "name"],
  "project.production": ["type", "data"],
  "project.exportProfiles": ["type", "profiles"]
};
var BASE_CLIP_KEYS = ["trackId", "start", "duration", "label", "groupId", "linkGroupId"];
var VISUAL_KEYS = ["transform", "color", "blendMode", "mask"];
var CLIP_PATCH_KEYS = {
  media: [...BASE_CLIP_KEYS, ...VISUAL_KEYS, "assetId", "timeMap", "audio"],
  sequence: [...BASE_CLIP_KEYS, ...VISUAL_KEYS, "sequenceId", "timeMap", "audio"],
  multicam: [
    ...BASE_CLIP_KEYS,
    ...VISUAL_KEYS,
    "timeMap",
    "angles",
    "switches",
    "audioAngleId",
    "audio"
  ],
  text: [
    ...BASE_CLIP_KEYS,
    ...VISUAL_KEYS,
    "role",
    "text",
    "style",
    "words",
    "sourceBinding",
    "translation"
  ],
  shape: [...BASE_CLIP_KEYS, ...VISUAL_KEYS, "shape", "fill", "stroke", "strokeWidth"]
};
var OPTIONAL_CLIP_KEYS = /* @__PURE__ */ new Set([
  "groupId",
  "linkGroupId",
  "mask",
  "sourceBinding",
  "translation"
]);
var TRACK_PATCH_KEYS = ["name", "kind", "locked", "hidden", "muted", "volume", "pan"];
var MARKER_PATCH_KEYS = ["time", "duration", "name", "note", "color"];
function object5(value, allowed, label3) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(
    (key) => typeof key !== "string" || allowed && !allowed.includes(key) || !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")
  ))
    throw new Error(`${label3}格式无效或包含未知字段`);
  return value;
}
function array(value, min, max, label3) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1)
    throw new Error(`${label3}必须是包含 ${min} 至 ${max} 项的普通数组`);
  for (let position = 0; position < value.length; position++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(position));
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
      throw new Error(`${label3}不能包含空项或动态属性`);
  }
  return value;
}
function id2(value, label3) {
  if (typeof value !== "string" || !value || value.length > 128) throw new Error(`${label3}无效`);
  return value;
}
function ids(value) {
  const result = array(value, 1, 1e4, "片段选择").map((item) => id2(item, "片段 ID"));
  if (new Set(result).size !== result.length) throw new Error("片段 ID 不能重复");
  return result;
}
function index(value, length) {
  if (value === void 0) return length;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > length)
    throw new Error("插入位置超出范围");
  return Number(value);
}
function sequence2(document, sequenceId) {
  const found = document.sequences.find((item) => item.id === id2(sequenceId, "时间线 ID"));
  if (!found) throw new Error(`时间线不存在：${sequenceId}`);
  return found;
}
function track2(sequence5, trackId) {
  const found = sequence5.tracks.find((item) => item.id === id2(trackId, "轨道 ID"));
  if (!found) throw new Error(`轨道不存在：${trackId}`);
  return found;
}
function clip2(sequence5, clipId) {
  const found = sequence5.clips.find((item) => item.id === id2(clipId, "片段 ID"));
  if (!found) throw new Error(`片段不存在：${clipId}`);
  return found;
}
function unlocked(item) {
  if (item.locked) throw new Error(`轨道“${item.name}”已锁定，请先解锁`);
}
function checkClipTracks(sequence5, clips) {
  for (const item of clips) unlocked(track2(sequence5, item.trackId));
}
function checkTransitionTracks(sequence5, transition) {
  checkClipTracks(sequence5, [
    clip2(sequence5, transition.fromClipId),
    clip2(sequence5, transition.toClipId)
  ]);
}
function patch(target, updates, clearKeys = /* @__PURE__ */ new Set()) {
  const destination = target;
  for (const key of Object.keys(updates)) {
    if (updates[key] === null && clearKeys.has(key)) delete destination[key];
    else destination[key] = structuredClone(updates[key]);
  }
}
function removeClips(sequence5, selectedIds2) {
  const removing = new Set(selectedIds2);
  for (const clipId of removing) clip2(sequence5, clipId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of sequence5.clips) {
      if (item.kind === "text" && item.role === "subtitle" && item.sourceBinding && removing.has(item.sourceBinding.clipId) && !removing.has(item.id)) {
        removing.add(item.id);
        changed = true;
      }
    }
  }
  checkClipTracks(
    sequence5,
    sequence5.clips.filter((item) => removing.has(item.id))
  );
  const removedTransitions = sequence5.transitions.filter(
    (item) => removing.has(item.fromClipId) || removing.has(item.toClipId)
  );
  for (const transition of removedTransitions) checkTransitionTracks(sequence5, transition);
  sequence5.transitions = sequence5.transitions.filter((item) => !removedTransitions.includes(item));
  sequence5.clips = sequence5.clips.filter((item) => !removing.has(item.id));
}
function moveClips(sequence5, data) {
  const selection = ids(data.clipIds).map((clipId) => clip2(sequence5, clipId));
  if (!Number.isSafeInteger(data.delta)) throw new Error("移动距离必须是安全整数刻度");
  const chosen = new Set(selection.map((item) => item.id));
  for (; ; ) {
    const size2 = chosen.size;
    const members = sequence5.clips.filter((item) => chosen.has(item.id));
    const groups = new Set(members.map((item) => item.groupId).filter(Boolean));
    const links = new Set(members.map((item) => item.linkGroupId).filter(Boolean));
    for (const item of sequence5.clips)
      if (item.groupId && groups.has(item.groupId) || item.linkGroupId && links.has(item.linkGroupId))
        chosen.add(item.id);
    if (chosen.size === size2) break;
  }
  const moving = sequence5.clips.filter(
    (item) => chosen.has(item.id) || item.kind === "text" && item.sourceBinding && chosen.has(item.sourceBinding.clipId)
  );
  checkClipTracks(sequence5, moving);
  const anchorIndex = sequence5.tracks.findIndex((item) => item.id === selection[0].trackId);
  const trackShift = data.trackId === void 0 ? 0 : sequence5.tracks.indexOf(track2(sequence5, data.trackId)) - anchorIndex;
  const positions = moving.map((item) => {
    const start = item.start + data.delta;
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(start + item.duration))
      throw new Error("移动后的片段超出时间范围");
    const destination = !chosen.has(item.id) ? track2(sequence5, item.trackId) : sequence5.tracks[sequence5.tracks.findIndex((candidate) => candidate.id === item.trackId) + trackShift];
    if (!destination) throw new Error("成组移动超出轨道范围");
    unlocked(destination);
    return { item, start, trackId: destination.id };
  });
  const movedIds = new Set(moving.map((item) => item.id));
  for (const transition of sequence5.transitions) {
    const fromMoved = movedIds.has(transition.fromClipId), toMoved = movedIds.has(transition.toClipId);
    if (fromMoved || toMoved) checkTransitionTracks(sequence5, transition);
    if (fromMoved && toMoved) {
      const start = transition.start + data.delta;
      if (!Number.isSafeInteger(start) || start < 0) throw new Error("移动后的转场超出时间范围");
      transition.start = start;
    }
  }
  for (const position of positions) {
    position.item.start = position.start;
    position.item.trackId = position.trackId;
  }
}
function applyEditorOperations(document, operations, baseRevision) {
  return applyOperationsToDraft(document, validateEditorDocument(document), operations, baseRevision);
}
function applyOperationsToDraft(document, next, operations, baseRevision) {
  "use strict";
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || next.revision !== baseRevision)
    throw new Error(`工程已更新（当前修订 ${next.revision}），请刷新后重试`);
  for (const raw of array(operations, 0, 1e4, "编辑操作")) {
    const candidate = object5(raw, void 0, "编辑操作");
    if (typeof candidate.type !== "string" || !Object.hasOwn(OPERATION_KEYS, candidate.type))
      throw new Error("不支持此编辑操作");
    const type = candidate.type;
    const data = object5(candidate, OPERATION_KEYS[type], "编辑操作");
    if (type === "project.rename") next.name = data.name;
    else if (type === "project.production") {
      if (data.data === null) delete next.production;
      else next.production = structuredClone(object5(data.data, void 0, "制作流程数据"));
    } else if (type === "project.exportProfiles")
      next.exportProfiles = structuredClone(data.profiles);
    else if (type === "asset.add") {
      const added = structuredClone(object5(data.asset, void 0, "新素材"));
      if (next.assets.some((item) => item.id === id2(added.id, "素材 ID")))
        throw new Error("素材 ID 已存在");
      next.assets.push(added);
    } else if (type === "asset.update" || type === "asset.remove") {
      const target = next.assets.find((item) => item.id === id2(data.assetId, "素材 ID"));
      if (!target) throw new Error("素材不存在");
      if (type === "asset.remove") next.assets.splice(next.assets.indexOf(target), 1);
      else
        patch(
          target,
          object5(
            data.patch,
            [
              "name",
              "kind",
              "duration",
              "width",
              "height",
              "resourceId",
              "fingerprint",
              "metadata"
            ],
            "素材修改"
          )
        );
    } else if (type === "sequence.add") {
      const added = structuredClone(object5(data.sequence, void 0, "新时间线"));
      if (next.sequences.some((item) => item.id === id2(added.id, "时间线 ID")))
        throw new Error("时间线 ID 已存在");
      next.sequences.splice(index(data.index, next.sequences.length), 0, added);
    } else {
      const current = sequence2(next, data.sequenceId);
      if (type === "sequence.rename") current.name = data.name;
      else if (type === "sequence.update")
        patch(
          current,
          object5(
            data.patch,
            [
              "name",
              "width",
              "height",
              "frameRate",
              "background",
              "timelineMode",
              "magneticTrackId"
            ],
            "时间线设置"
          )
        );
      else if (type === "sequence.activate") next.activeSequenceId = current.id;
      else if (type === "sequence.remove") {
        if (current.id === next.activeSequenceId)
          throw new Error("请先切换到其他时间线再删除当前时间线");
        for (const item of current.tracks) unlocked(item);
        next.sequences.splice(next.sequences.indexOf(current), 1);
      } else if (type === "track.add") {
        const added = structuredClone(object5(data.track, void 0, "新轨道"));
        if (current.tracks.some((item) => item.id === id2(added.id, "轨道 ID")))
          throw new Error("轨道 ID 已存在");
        current.tracks.splice(index(data.index, current.tracks.length), 0, added);
      } else if (type === "track.update") {
        const target = track2(current, data.trackId), updates = object5(data.patch, TRACK_PATCH_KEYS, "轨道修改");
        if (target.locked && !(Object.keys(updates).length === 1 && updates.locked === false))
          unlocked(target);
        patch(target, updates);
      } else if (type === "track.remove") {
        const target = track2(current, data.trackId);
        unlocked(target);
        if (data.removeClips !== void 0 && typeof data.removeClips !== "boolean")
          throw new Error("删除片段选项无效");
        const contents = current.clips.filter((item) => item.trackId === target.id);
        if (contents.length && data.removeClips !== true)
          throw new Error("轨道仍有片段，请明确同时删除轨道内片段");
        if (contents.length)
          removeClips(
            current,
            contents.map((item) => item.id)
          );
        current.tracks.splice(current.tracks.indexOf(target), 1);
      } else if (type === "track.reorder") {
        const trackIds = array(
          data.trackIds,
          current.tracks.length,
          current.tracks.length,
          "轨道排序"
        );
        if (new Set(trackIds).size !== current.tracks.length)
          throw new Error("轨道排序必须完整且不能重复");
        const ordered2 = trackIds.map((trackId) => track2(current, trackId));
        for (const locked of current.tracks.filter((item) => item.locked)) {
          const previous = current.tracks.indexOf(locked), nextIndex = ordered2.indexOf(locked);
          if (current.tracks.some(
            (item, i) => item !== locked && i < previous !== ordered2.indexOf(item) < nextIndex
          ))
            unlocked(locked);
        }
        current.tracks = ordered2;
      } else if (type === "clip.add") {
        const added = structuredClone(object5(data.clip, void 0, "新片段"));
        if (current.clips.some((item) => item.id === id2(added.id, "片段 ID")))
          throw new Error("片段 ID 已存在");
        unlocked(track2(current, added.trackId));
        current.clips.push(added);
      } else if (type === "clip.update") {
        const target = clip2(current, data.clipId);
        if (!Object.hasOwn(CLIP_PATCH_KEYS, target.kind)) throw new Error("片段类型无效");
        const updates = object5(data.patch, CLIP_PATCH_KEYS[target.kind], "片段修改");
        unlocked(track2(current, target.trackId));
        if (Object.hasOwn(updates, "trackId")) unlocked(track2(current, updates.trackId));
        patch(target, updates, OPTIONAL_CLIP_KEYS);
      } else if (type === "clip.remove") removeClips(current, ids(data.clipIds));
      else if (type === "clip.move") moveClips(current, data);
      else if (type === "marker.add") {
        const added = structuredClone(object5(data.marker, void 0, "新标记"));
        if (current.markers.some((item) => item.id === id2(added.id, "标记 ID")))
          throw new Error("标记 ID 已存在");
        current.markers.push(added);
      } else if (type === "marker.update" || type === "marker.remove") {
        const target = current.markers.find((item) => item.id === id2(data.markerId, "标记 ID"));
        if (!target) throw new Error("时间线标记不存在");
        if (type === "marker.update")
          patch(target, object5(data.patch, MARKER_PATCH_KEYS, "标记修改"));
        else current.markers.splice(current.markers.indexOf(target), 1);
      } else if (type === "transition.add") {
        const added = structuredClone(object5(data.transition, void 0, "新转场"));
        if (current.transitions.some((item) => item.id === id2(added.id, "转场 ID")))
          throw new Error("转场 ID 已存在");
        checkTransitionTracks(current, added);
        current.transitions.push(added);
      } else if (type === "transition.remove") {
        const target = current.transitions.find(
          (item) => item.id === id2(data.transitionId, "转场 ID")
        );
        if (!target) throw new Error("转场不存在");
        checkTransitionTracks(current, target);
        current.transitions.splice(current.transitions.indexOf(target), 1);
      }
    }
  }
  if (operations.length) {
    reconcileDependentCaptions(document, next);
    if (!Number.isSafeInteger(next.revision + 1)) throw new Error("工程修订号已超出范围");
    next.revision += 1;
  }
  return validateEditorDocument(next);
}

// src/editor/clip-edits.ts
var transformKeys = ["x", "y", "scaleX", "scaleY", "rotation", "opacity"];
var colorKeys = [
  "exposure",
  "brightness",
  "contrast",
  "saturation",
  "temperature",
  "tint",
  "hue"
];
var transformBounds = {
  x: [-10, 10],
  y: [-10, 10],
  scaleX: [0, 100],
  scaleY: [0, 100],
  rotation: [-36e4, 36e4],
  opacity: [0, 1]
};
var colorBounds = {
  exposure: [-10, 10],
  brightness: [-1, 1],
  contrast: [0, 4],
  saturation: [0, 4],
  temperature: [-1, 1],
  tint: [-1, 1],
  hue: [-360, 360]
};
var clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
var MAX_KEYS = 1e4;
var GAIN_TOLERANCE = 1e-6;
function context(document, sequenceId) {
  const snapshot = validateEditorDocument(document);
  const sequence5 = snapshot.sequences.find((sequence6) => sequence6.id === sequenceId);
  if (!sequence5) throw new Error("时间线不存在，请刷新后重试");
  return { document: snapshot, sequence: sequence5 };
}
function findClip(sequence5, clipId) {
  const clip3 = sequence5.clips.find((clip4) => clip4.id === clipId);
  if (!clip3) throw new Error("所选片段不存在，请刷新后重试");
  return clip3;
}
function sourceClip(clip3) {
  if (!("timeMap" in clip3)) throw new Error("变速、倒放与定格需要媒体或嵌套序列片段");
  return clip3;
}
function selectedIds(sequence5, values) {
  if (!Array.isArray(values) || !values.length || values.length > 2e3 || new Set(values).size !== values.length || values.some((id5) => typeof id5 !== "string"))
    throw new Error("请选择有效且不重复的片段");
  for (const id5 of values) findClip(sequence5, id5);
  return new Set(values);
}
function allocate(document, factory) {
  if (typeof factory !== "function") throw new Error("需要新片段 ID 生成器");
  const used = new Set(
    document.sequences.flatMap((sequence5) => [
      sequence5.id,
      ...sequence5.tracks.map((track3) => track3.id),
      ...sequence5.transitions.map((transition) => transition.id),
      ...sequence5.clips.flatMap((clip3) => [clip3.id, clip3.groupId ?? "", clip3.linkGroupId ?? ""])
    ])
  );
  return (kind) => {
    const id5 = factory(kind);
    if (typeof id5 !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id5) || used.has(id5))
      throw new Error("新片段或分组 ID 无效或已存在，请重新操作");
    used.add(id5);
    return id5;
  };
}
function finish(document, operations) {
  applyEditorOperations(document, operations, document.revision);
  return structuredClone(operations);
}
function update(sequenceId, before, after) {
  const { id: _id, kind: _kind, ...patch2 } = structuredClone(after);
  const updates = patch2;
  for (const key of ["groupId", "linkGroupId", "mask", "sourceBinding", "translation"])
    if (Object.hasOwn(before, key) && !Object.hasOwn(after, key)) updates[key] = null;
  return { type: "clip.update", sequenceId, clipId: before.id, patch: updates };
}
function assertNoTransition(sequence5, ids3) {
  if (sequence5.transitions.some(
    (transition) => ids3.has(transition.fromClipId) || ids3.has(transition.toClipId)
  ))
    throw new Error("所选片段连接着转场，请先移除转场，再切分、裁剪或变速");
}
function boundText(sequence5, owner) {
  return sequence5.clips.filter(
    (clip3) => clip3.kind === "text" && clip3.sourceBinding?.clipId === owner.id
  );
}
function approximate(sample2, start, end, anchors, tolerance = GAIN_TOLERANCE) {
  const points = [
    .../* @__PURE__ */ new Set([start, end, ...anchors.filter((time) => time > start && time < end)])
  ].sort((a, b) => a - b);
  const result = [];
  function add(time, value) {
    if (result.length >= MAX_KEYS) throw new Error("保留声音或动画需要过多关键帧，请先缩短片段");
    result.push({ time: time - start, value, easing: "linear" });
  }
  function segment(a, b, av, bv) {
    const checks = [
      ...new Set([1, 2, 3].map((part2) => a + Math.floor((b - a) * part2 / 4)))
    ].filter((t) => t > a && t < b);
    if (checks.some(
      (time) => Math.abs(sample2(time) - (av + (bv - av) * (time - a) / (b - a))) > tolerance
    )) {
      const middle = a + Math.floor((b - a) / 2), value = sample2(middle);
      segment(a, middle, av, value);
      segment(middle, b, value, bv);
    } else add(a, av);
  }
  for (let i = 0; i + 1 < points.length; i++)
    segment(points[i], points[i + 1], sample2(points[i]), sample2(points[i + 1]));
  add(end, sample2(end));
  return { keyframes: result };
}
function keyTimes(value) {
  return typeof value === "number" ? [] : value.keyframes.map((key) => key.time);
}
function sliceProperty(value, start, end, min, max) {
  const sliced = sliceAnimatedNumber(value, start, end);
  if (typeof sliced === "number" || sliced.keyframes.every((key) => key.value >= min && key.value <= max))
    return sliced;
  return approximate(
    (time) => clamp(evaluateAnimatedNumber(value, time), min, max),
    start,
    end,
    keyTimes(sliced).map((time) => time + start)
  );
}
function sliceText(clip3, start, end) {
  const next = structuredClone(clip3);
  if (start === 0 && end === clip3.duration) return next;
  if (clip3.translation?.originalWords?.length) {
    if (clip3.translation.originalWords.some((word) => word.start < start || word.end > end))
      throw new Error("裁剪将截断已翻译的原文词时间，请先校准字幕或解除翻译");
    next.translation.originalWords = clip3.translation.originalWords.map((word) => ({
      ...word,
      start: word.start - start,
      end: word.end - start
    }));
  }
  if (clip3.style.animation === "typewriter")
    throw new Error("打字机文字不能直接裁掉动画中段，请先关闭打字机效果再剪切");
  next.words = clip3.words.filter((word) => word.end > start && word.start < end).map((word) => ({
    ...word,
    start: Math.max(start, word.start) - start,
    end: Math.min(end, word.end) - start
  }));
  const retained = clip3.words.map((word, index2) => ({ word, index: index2 })).filter(({ word }) => word.end > start && word.start < end);
  if (clip3.words.length && retained.length !== clip3.words.length) {
    const compactWords = clip3.words.map((word) => word.text.replace(/\s/g, ""));
    if (clip3.translation || clip3.text.replace(/\s/g, "") !== compactWords.join(""))
      throw new Error("这条字幕含译文或独立校对文字，请先校准逐字稿再按词剪切，以保留已编辑内容");
    const offsets = Array.from({ length: clip3.text.length }, (_, index2) => index2).filter(
      (index2) => !/\s/.test(clip3.text[index2])
    );
    const first2 = retained[0]?.index ?? 0, last = retained.at(-1)?.index ?? -1;
    const from = compactWords.slice(0, first2).reduce((sum, word) => sum + word.length, 0);
    const to = compactWords.slice(0, last + 1).reduce((sum, word) => sum + word.length, 0);
    next.text = retained.length ? clip3.text.slice(offsets[from], offsets[to - 1] + 1) : "";
  }
  return next;
}
function sliceClip(clip3, start, end) {
  assertTick(start);
  assertTick(end);
  if (start >= end || end > clip3.duration) throw new Error("裁剪范围须位于片段内并保留正时长");
  const next = clip3.kind === "text" ? sliceText(clip3, start, end) : structuredClone(clip3);
  next.start = clip3.start + start;
  next.duration = end - start;
  for (const key of transformKeys)
    next.transform[key] = sliceProperty(
      clip3.transform[key],
      start,
      end,
      transformBounds[key][0],
      transformBounds[key][1]
    );
  for (const key of colorKeys)
    next.color[key] = sliceProperty(
      clip3.color[key],
      start,
      end,
      colorBounds[key][0],
      colorBounds[key][1]
    );
  if ("timeMap" in clip3 && "timeMap" in next) {
    next.timeMap = sliceTimeMap(clip3.timeMap, start, end);
    next.audio.pan = sliceProperty(clip3.audio.pan, start, end, -1, 1);
    const fadeIn = clip3.audio.fadeIn, fadeOut = clip3.audio.fadeOut;
    const preserveIn = !fadeIn || start === 0 && end >= fadeIn || start >= fadeIn;
    const preserveOut = !fadeOut || end === clip3.duration && start <= clip3.duration - fadeOut || end <= clip3.duration - fadeOut;
    if (preserveIn && preserveOut) {
      next.audio.volume = sliceProperty(clip3.audio.volume, start, end, 0, 4);
      next.audio.fadeIn = start === 0 ? Math.min(fadeIn, next.duration) : 0;
      next.audio.fadeOut = end === clip3.duration ? Math.min(fadeOut, next.duration) : 0;
    } else {
      const gain = (time) => clamp(evaluateAnimatedNumber(clip3.audio.volume, time), 0, 4) * (fadeIn ? clamp(time / fadeIn) : 1) * (fadeOut ? clamp((clip3.duration - time) / fadeOut) : 1);
      next.audio.volume = approximate(gain, start, end, [
        ...keyTimes(clip3.audio.volume),
        fadeIn,
        clip3.duration - fadeOut
      ]);
      next.audio.fadeIn = 0;
      next.audio.fadeOut = 0;
    }
    if (clip3.kind === "multicam" && next.kind === "multicam") {
      const active = clip3.switches.filter((change) => change.time <= start).at(-1);
      next.switches = [
        { time: 0, angleId: active.angleId },
        ...clip3.switches.filter((change) => change.time > start && change.time < end).map((change) => ({ ...change, time: change.time - start }))
      ];
    }
  }
  if (clip3.kind === "text" && next.kind === "text" && clip3.style.animation === "fade") {
    next.transform.opacity = approximate(
      (time) => clamp(evaluateAnimatedNumber(clip3.transform.opacity, time)) * clamp(
        Math.min(time / (clip3.duration * 0.1), (clip3.duration - time) / (clip3.duration * 0.1))
      ),
      start,
      end,
      [
        ...keyTimes(clip3.transform.opacity),
        Math.round(clip3.duration * 0.1),
        Math.round(clip3.duration * 0.9)
      ]
    );
    next.style.animation = "none";
  }
  return next;
}
function tightenBinding(text5, owner) {
  if (!text5.sourceBinding) return;
  const start = text5.start - owner.start, end = start + text5.duration;
  if (start < 0 || end > owner.duration)
    throw new Error("关联字幕与源片段尚未对齐，请先修正字幕时间再剪切");
  const points = sliceTimeMap(owner.timeMap, start, end).points.map((point) => point.source);
  const first2 = Math.max(text5.sourceBinding.sourceStart, Math.min(...points));
  const last = Math.min(text5.sourceBinding.sourceEnd, Math.max(...points));
  if (first2 < last) {
    text5.sourceBinding.sourceStart = first2;
    text5.sourceBinding.sourceEnd = last;
  } else if (!points.every(
    (point) => point >= text5.sourceBinding.sourceStart && point < text5.sourceBinding.sourceEnd
  ))
    throw new Error("字幕来源与保留片段不一致，请先重新对齐字幕");
}
function trimClip(value, sequenceId, clipId, localStart, localEnd) {
  const { document, sequence: sequence5 } = context(value, sequenceId), operations = trimOperations(sequence5, sequenceId, clipId, localStart, localEnd);
  return operations.length ? finish(document, operations) : operations;
}
function trimOperations(sequence5, sequenceId, clipId, localStart, localEnd) {
  const before = findClip(sequence5, clipId);
  if (localStart === 0 && localEnd === before.duration) return [];
  assertNoTransition(sequence5, /* @__PURE__ */ new Set([clipId]));
  const after = sliceClip(before, localStart, localEnd);
  if (after.kind === "text" && after.sourceBinding)
    tightenBinding(after, sourceClip(findClip(sequence5, after.sourceBinding.clipId)));
  const operations = [update(sequenceId, before, after)];
  for (const caption of boundText(sequence5, before)) {
    if (caption.start < before.start || caption.start + caption.duration > before.start + before.duration)
      throw new Error("关联字幕与源片段尚未对齐，请先修正字幕时间再裁剪");
    const start = Math.max(after.start, caption.start), end = Math.min(after.start + after.duration, caption.start + caption.duration);
    if (start >= end) operations.push({ type: "clip.remove", sequenceId, clipIds: [caption.id] });
    else {
      const trimmed = sliceClip(caption, start - caption.start, end - caption.start);
      tightenBinding(trimmed, sourceClip(after));
      operations.push(update(sequenceId, caption, trimmed));
    }
  }
  return operations;
}
function splitClip(value, sequenceId, clipId, timelineTick, idFactory) {
  const { document, sequence: sequence5 } = context(value, sequenceId), before = findClip(sequence5, clipId);
  assertTick(timelineTick);
  return finish(
    document,
    splitOperations(sequence5, before, timelineTick, allocate(document, idFactory))
  );
}
function splitOperations(sequence5, before, timelineTick, newId) {
  const sequenceId = sequence5.id, clipId = before.id;
  const local = timelineTick - before.start;
  if (local <= 0 || local >= before.duration) throw new Error("播放头须位于片段内部才能切分");
  assertNoTransition(sequence5, /* @__PURE__ */ new Set([clipId]));
  const left = sliceClip(before, 0, local), right = sliceClip(before, local, before.duration);
  right.id = newId("clip");
  if (before.kind === "text" && before.sourceBinding) {
    const owner = sourceClip(findClip(sequence5, before.sourceBinding.clipId));
    tightenBinding(left, owner);
    tightenBinding(right, owner);
  }
  const operations = [
    update(sequenceId, before, left),
    { type: "clip.add", sequenceId, clip: right }
  ];
  for (const caption of boundText(sequence5, before)) {
    if (caption.start < before.start || caption.start + caption.duration > before.start + before.duration)
      throw new Error("关联字幕与源片段尚未对齐，请先修正字幕时间再切分");
    const parts = [];
    for (const owner of [left, right]) {
      const start = Math.max(caption.start, owner.start), end = Math.min(caption.start + caption.duration, owner.start + owner.duration);
      if (start >= end) continue;
      const part2 = sliceClip(caption, start - caption.start, end - caption.start);
      part2.sourceBinding.clipId = owner.id;
      tightenBinding(part2, sourceClip(owner));
      if (parts.length) part2.id = newId("clip");
      parts.push(part2);
    }
    if (parts.length) {
      operations.push(update(sequenceId, caption, parts[0]));
      for (const part2 of parts.slice(1))
        operations.push({ type: "clip.add", sequenceId, clip: part2 });
    }
  }
  return operations;
}
function selectionClosure(sequence5, ids3) {
  const selected3 = selectedIds(sequence5, ids3);
  let changed = true;
  while (changed) {
    changed = false;
    const clips = sequence5.clips.filter((clip3) => selected3.has(clip3.id));
    const groups = new Set(clips.flatMap((clip3) => clip3.groupId ? [clip3.groupId] : []));
    const links = new Set(clips.flatMap((clip3) => clip3.linkGroupId ? [clip3.linkGroupId] : []));
    const owners = new Set(
      clips.flatMap(
        (clip3) => clip3.kind === "text" && clip3.sourceBinding ? [clip3.sourceBinding.clipId] : []
      )
    );
    for (const clip3 of sequence5.clips) {
      if (!selected3.has(clip3.id) && (owners.has(clip3.id) || clip3.groupId && groups.has(clip3.groupId) || clip3.linkGroupId && links.has(clip3.linkGroupId) || clip3.kind === "text" && clip3.sourceBinding && selected3.has(clip3.sourceBinding.clipId))) {
        selected3.add(clip3.id);
        changed = true;
      }
    }
  }
  return selected3;
}
function dependencySnapshot(document, source2, selected3) {
  const clips = source2.clips.filter((clip3) => selected3.has(clip3.id));
  for (const transition of source2.transitions)
    if (selected3.has(transition.fromClipId) !== selected3.has(transition.toClipId))
      throw new Error("复制带转场的片段时，请同时选择转场两端片段");
  const root = {
    ...source2,
    clips,
    transitions: source2.transitions.filter((transition) => selected3.has(transition.fromClipId)),
    markers: []
  };
  const sequences = [root], seen = /* @__PURE__ */ new Set([source2.id]);
  for (let index2 = 0; index2 < sequences.length; index2++)
    for (const clip3 of sequences[index2].clips)
      if (clip3.kind === "sequence" && !seen.has(clip3.sequenceId)) {
        seen.add(clip3.sequenceId);
        sequences.push(document.sequences.find((sequence5) => sequence5.id === clip3.sequenceId));
      }
  const assets = new Set(
    sequences.flatMap(
      (sequence5) => sequence5.clips.flatMap(
        (clip3) => clip3.kind === "media" ? [clip3.assetId] : clip3.kind === "multicam" ? clip3.angles.map((angle) => angle.assetId) : []
      )
    )
  );
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: document.timebase,
    id: document.id,
    name: document.name,
    revision: document.revision,
    assets: document.assets.filter((asset2) => assets.has(asset2.id)),
    sequences,
    activeSequenceId: source2.id,
    exportProfiles: []
  });
}
function copyClips(value, sequenceId, clipIds) {
  const { document, sequence: sequence5 } = context(value, sequenceId), selected3 = selectionClosure(sequence5, clipIds);
  const snapshot = dependencySnapshot(document, sequence5, selected3);
  return {
    schemaVersion: 1,
    sequenceId,
    origin: Math.min(...snapshot.sequences[0].clips.map((clip3) => clip3.start)),
    document: snapshot
  };
}
function validateClipClipboard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(
    (key) => typeof key !== "string" || !["schemaVersion", "origin", "sequenceId", "document"].includes(key) || !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")
  ))
    throw new Error("片段剪贴板格式无效");
  const raw = value;
  if (raw.schemaVersion !== 1) throw new Error("不支持此片段剪贴板版本");
  const document = validateEditorDocument(raw.document), sequence5 = document.sequences.find((sequence6) => sequence6.id === raw.sequenceId);
  assertTick(raw.origin);
  if (!sequence5 || document.activeSequenceId !== sequence5.id || !sequence5.clips.length || raw.origin !== Math.min(...sequence5.clips.map((clip3) => clip3.start)))
    throw new Error("片段剪贴板缺少有效选择或起点");
  return { schemaVersion: 1, origin: raw.origin, sequenceId: raw.sequenceId, document };
}
function sameAsset(source2, target, sameDocument) {
  return source2.kind === target.kind && source2.duration === target.duration && (source2.resourceId !== void 0 && source2.resourceId === target.resourceId || source2.fingerprint !== void 0 && source2.fingerprint === target.fingerprint || sameDocument && source2.id === target.id && source2.resourceId === void 0 && target.resourceId === void 0);
}
var ClipboardDependencyError = class extends Error {
  constructor(assetIds, sequenceIds) {
    super("素材或嵌套序列尚未导入到目标工程，请先准备缺失依赖再粘贴");
    this.assetIds = assetIds;
    this.sequenceIds = sequenceIds;
    this.name = "ClipboardDependencyError";
  }
  assetIds;
  sequenceIds;
  code = "CLIPBOARD_DEPENDENCIES_MISSING";
};
function pasteClips(value, sequenceId, payload, options) {
  const { document, sequence: sequence5 } = context(value, sequenceId), copied = validateClipClipboard(payload);
  assertTick(options.at);
  const source2 = copied.document.sequences.find((sequence6) => sequence6.id === copied.sequenceId);
  const sameDocument = document.id === copied.document.id, assets = /* @__PURE__ */ new Map(), missingAssets = [], missingSequences = [];
  for (const asset2 of copied.document.assets) {
    const target = document.assets.find(
      (candidate) => candidate.id === asset2.id && sameAsset(asset2, candidate, sameDocument)
    ) ?? document.assets.find((candidate) => sameAsset(asset2, candidate, sameDocument));
    if (target) assets.set(asset2.id, target.id);
    else missingAssets.push(asset2.id);
  }
  for (const dependency of copied.document.sequences.filter((item) => item.id !== source2.id)) {
    const target = document.sequences.find((item) => item.id === dependency.id);
    if (!target || !sameDocument && JSON.stringify(target) !== JSON.stringify(dependency))
      missingSequences.push(dependency.id);
  }
  if (missingAssets.length || missingSequences.length)
    throw new ClipboardDependencyError(missingAssets, missingSequences);
  const usedTracks = source2.tracks.filter(
    (track3) => source2.clips.some((clip3) => clip3.trackId === track3.id)
  );
  const sourceAnchor = source2.tracks.indexOf(usedTracks[0]);
  const targetAnchor = options.trackId === void 0 ? sequence5.tracks.findIndex((track3) => track3.id === usedTracks[0].id) : sequence5.tracks.findIndex((track3) => track3.id === options.trackId);
  if (!options.trackMap && targetAnchor < 0) throw new Error("请选择对应的目标轨道后粘贴");
  const tracks = /* @__PURE__ */ new Map();
  for (const track3 of source2.tracks) {
    const target = options.trackMap ? sequence5.tracks.find((candidate) => candidate.id === options.trackMap[track3.id]) : sequence5.tracks[targetAnchor + source2.tracks.indexOf(track3) - sourceAnchor];
    if (target && target.kind === track3.kind) tracks.set(track3.id, target.id);
  }
  if (usedTracks.some((track3) => !tracks.has(track3.id)))
    throw new Error("目标轨道不足或类型不匹配，请先准备对应轨道");
  const newId = allocate(document, options.idFactory), clipIds = new Map(source2.clips.map((clip3) => [clip3.id, newId("clip")]));
  const groups = /* @__PURE__ */ new Map(), links = /* @__PURE__ */ new Map();
  function remapGroup(id5, values, kind) {
    if (!values.has(id5)) values.set(id5, newId(kind));
    return values.get(id5);
  }
  const operations = source2.clips.map((original) => {
    const clip3 = structuredClone(original);
    clip3.id = clipIds.get(original.id);
    clip3.start = options.at + original.start - copied.origin;
    clip3.trackId = tracks.get(original.trackId);
    if (clip3.groupId) clip3.groupId = remapGroup(clip3.groupId, groups, "group");
    if (clip3.linkGroupId) clip3.linkGroupId = remapGroup(clip3.linkGroupId, links, "link");
    if (clip3.kind === "media") clip3.assetId = assets.get(clip3.assetId);
    if (clip3.kind === "multicam")
      clip3.angles = clip3.angles.map((angle) => ({ ...angle, assetId: assets.get(angle.assetId) }));
    if (clip3.kind === "text" && clip3.sourceBinding) {
      const owner = clipIds.get(clip3.sourceBinding.clipId);
      if (!owner) throw new Error("复制关联字幕时必须包含其来源片段");
      clip3.sourceBinding.clipId = owner;
      if (clip3.sourceBinding.provenance) {
        const asset2 = assets.get(clip3.sourceBinding.provenance.assetId);
        if (!asset2) throw new Error("粘贴字幕缺少实际音源素材");
        clip3.sourceBinding.provenance.assetId = asset2;
      }
    }
    if ("audio" in clip3 && clip3.audio.ducking)
      clip3.audio.ducking.sidechainTrackIds = clip3.audio.ducking.sidechainTrackIds.map((id5) => {
        const target = tracks.get(id5);
        if (!target) throw new Error("目标时间线缺少压低背景声所需的参考轨道");
        return target;
      });
    return { type: "clip.add", sequenceId, clip: clip3 };
  });
  for (const original of source2.transitions) {
    const transition = {
      ...original,
      id: newId("transition"),
      fromClipId: clipIds.get(original.fromClipId),
      toClipId: clipIds.get(original.toClipId),
      start: options.at + original.start - copied.origin
    };
    operations.push({ type: "transition.add", sequenceId, transition });
  }
  return finish(document, operations);
}
function groupClips(value, sequenceId, clipIds, groupId) {
  const { document, sequence: sequence5 } = context(value, sequenceId), selected3 = selectionClosure(sequence5, clipIds);
  if (selected3.size < 2) throw new Error("至少选择两个片段才能编组");
  if (typeof groupId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(groupId) || sequence5.clips.some((clip3) => clip3.groupId === groupId && !selected3.has(clip3.id)))
    throw new Error("请使用有效且未被其他片段占用的分组 ID");
  return finish(
    document,
    [...selected3].map((clipId) => ({
      type: "clip.update",
      sequenceId,
      clipId,
      patch: { groupId }
    }))
  );
}
function ungroupClips(value, sequenceId, clipIds) {
  const { document, sequence: sequence5 } = context(value, sequenceId), selected3 = selectedIds(sequence5, clipIds);
  const groups = new Set(
    sequence5.clips.filter((clip3) => selected3.has(clip3.id)).flatMap((clip3) => clip3.groupId ? [clip3.groupId] : [])
  );
  return finish(
    document,
    sequence5.clips.filter((clip3) => clip3.groupId && groups.has(clip3.groupId)).map((clip3) => ({
      type: "clip.update",
      sequenceId,
      clipId: clip3.id,
      patch: { groupId: null }
    }))
  );
}
function scaleTick(value, oldDuration, duration) {
  const n = BigInt(value) * BigInt(duration), d = BigInt(oldDuration);
  return Number((2n * n + d) / (2n * d));
}
function stretchProperty(value, from, duration) {
  if (typeof value === "number") return value;
  let previous = -1;
  return {
    keyframes: value.keyframes.map((key) => {
      const time = scaleTick(key.time, from, duration);
      if (time <= previous) throw new Error("变速后关键帧落在同一刻度，请降低速度或先整理关键帧");
      previous = time;
      return { ...structuredClone(key), time };
    })
  };
}
function stretchDecorations(clip3, duration, stretchSwitches = true) {
  const next = structuredClone(clip3);
  next.duration = duration;
  for (const key of transformKeys)
    next.transform[key] = stretchProperty(clip3.transform[key], clip3.duration, duration);
  for (const key of colorKeys)
    next.color[key] = stretchProperty(clip3.color[key], clip3.duration, duration);
  if ("audio" in clip3 && "audio" in next) {
    next.audio.volume = stretchProperty(clip3.audio.volume, clip3.duration, duration);
    next.audio.pan = stretchProperty(clip3.audio.pan, clip3.duration, duration);
    next.audio.fadeIn = scaleTick(clip3.audio.fadeIn, clip3.duration, duration);
    next.audio.fadeOut = scaleTick(clip3.audio.fadeOut, clip3.duration, duration);
  }
  if (stretchSwitches && clip3.kind === "multicam" && next.kind === "multicam") {
    next.switches = clip3.switches.map((change) => ({
      ...change,
      time: scaleTick(change.time, clip3.duration, duration)
    }));
    if (new Set(next.switches.map((change) => change.time)).size !== next.switches.length || next.switches.at(-1).time >= duration)
      throw new Error("变速后机位切点过密，请降低速度");
  }
  if (clip3.kind === "text" && next.kind === "text")
    next.words = clip3.words.map((word) => ({
      ...word,
      start: scaleTick(word.start, clip3.duration, duration),
      end: scaleTick(word.end, clip3.duration, duration)
    }));
  if (clip3.kind === "text" && next.kind === "text" && clip3.translation?.originalWords)
    next.translation.originalWords = clip3.translation.originalWords.map((word) => ({
      ...word,
      start: scaleTick(word.start, clip3.duration, duration),
      end: scaleTick(word.end, clip3.duration, duration)
    }));
  return next;
}
function forward(map2) {
  return map2.points.every(
    (point, index2) => index2 === 0 || point.source > map2.points[index2 - 1].source
  );
}
function retimeBoundCaption(caption, before, after) {
  if (!forward(before.timeMap) || !forward(after.timeMap))
    throw new Error("带来源字幕的倒放、定格或往返变速需要先解除字幕绑定，避免改变文字顺序");
  const binding = caption.sourceBinding;
  const ranges = sourceRangesToTimeline(after.timeMap, binding.sourceStart, binding.sourceEnd);
  if (ranges.length !== 1) throw new Error("字幕来源无法连续映射到变速片段，请先重新对齐字幕");
  const range = ranges[0], next = stretchDecorations(caption, range.end - range.start);
  next.start = after.start + range.start;
  const mapWord = (word) => {
    const start = caption.start - before.start + word.start, end = caption.start - before.start + word.end;
    if (start < 0 || end > before.duration)
      throw new Error("逐字字幕与原片段未对齐，请先校准再变速");
    const wordRanges = sourceRangesToTimeline(
      after.timeMap,
      sourceTimeAt(before.timeMap, start),
      sourceTimeAt(before.timeMap, end)
    );
    if (wordRanges.length !== 1) throw new Error("变速后字幕词无法保留，请降低速度或重新对齐");
    const first2 = Math.max(range.start, wordRanges[0].start) - range.start;
    const last = Math.min(range.end, wordRanges[0].end) - range.start;
    if (first2 >= last) throw new Error("变速后字幕词短于一个刻度，请降低速度");
    return { ...word, start: first2, end: last };
  };
  next.words = caption.words.map(mapWord);
  if (caption.translation?.originalWords)
    next.translation.originalWords = caption.translation.originalWords.map(mapWord);
  return next;
}
function retime(document, sequence5, before, duration, timeMap2, adjust) {
  assertNoTransition(sequence5, /* @__PURE__ */ new Set([before.id]));
  const after = stretchDecorations(before, duration, !adjust);
  after.timeMap = timeMap2;
  adjust?.(after);
  const operations = [update(sequence5.id, before, after)];
  for (const caption of boundText(sequence5, before))
    operations.push(update(sequence5.id, caption, retimeBoundCaption(caption, before, after)));
  return finish(document, operations);
}
function speed(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.05 || value > 100)
    throw new Error("播放速度须在 0.05 至 100 倍之间");
  return value;
}
function sourceEndpoints(clip3) {
  const points = clip3.timeMap.points, start = points[0].source, end = points.at(-1).source;
  const sign = Math.sign(end - start);
  if (!sign || points.some(
    (point, index2) => index2 > 0 && Math.sign(point.source - points[index2 - 1].source) !== sign
  ))
    throw new Error("定格或往返时间映射不能直接改为单一速度，请先切分为单向片段");
  return [start, end];
}
function setClipSpeed(value, sequenceId, clipId, rate2) {
  const { document, sequence: sequence5 } = context(value, sequenceId), clip3 = sourceClip(findClip(sequence5, clipId));
  const [start, end] = sourceEndpoints(clip3), result = constantTimeMap(start, end, speed(rate2));
  return retime(document, sequence5, clip3, result.duration, result.timeMap);
}
function setClipTimeMap(value, sequenceId, clipId, mapping) {
  const { document, sequence: sequence5 } = context(value, sequenceId), clip3 = sourceClip(findClip(sequence5, clipId));
  const duration = assertTick(mapping?.points?.at(-1)?.time, "曲线输出时长");
  const sourceDuration = clip3.kind === "media" ? document.assets.find((asset2) => asset2.id === clip3.assetId).duration : clip3.kind === "sequence" ? sequenceDuration(document.sequences.find((item) => item.id === clip3.sequenceId)) : MAX_EDITOR_TICK;
  return retime(
    document,
    sequence5,
    clip3,
    duration,
    validateTimeMap(mapping, duration, sourceDuration)
  );
}
function reverseClip(value, sequenceId, clipId) {
  const { document, sequence: sequence5 } = context(value, sequenceId), clip3 = sourceClip(findClip(sequence5, clipId));
  const timeMap2 = {
    points: [...clip3.timeMap.points].reverse().map((point) => ({ time: clip3.duration - point.time, source: point.source }))
  };
  return retime(document, sequence5, clip3, clip3.duration, timeMap2, (after) => {
    if (clip3.kind === "multicam" && after.kind === "multicam")
      after.switches = [
        { time: 0, angleId: clip3.switches.at(-1).angleId },
        ...clip3.switches.slice(1).map((change, index2) => ({
          time: clip3.duration - change.time,
          angleId: clip3.switches[index2].angleId
        })).reverse()
      ];
  });
}
function freezeClip(value, sequenceId, clipId, timelineTick, duration) {
  const { document, sequence: sequence5 } = context(value, sequenceId), clip3 = sourceClip(findClip(sequence5, clipId));
  assertTick(timelineTick);
  assertTick(duration);
  if (timelineTick < clip3.start || timelineTick >= clip3.start + clip3.duration)
    throw new Error("定格位置须位于所选片段内部");
  return retime(
    document,
    sequence5,
    clip3,
    duration,
    freezeTimeMap(sourceTimeAt(clip3.timeMap, timelineTick - clip3.start), duration),
    (after) => {
      if (clip3.kind === "multicam" && after.kind === "multicam")
        after.switches = [
          {
            time: 0,
            angleId: clip3.switches.filter((change) => change.time <= timelineTick - clip3.start).at(-1).angleId
          }
        ];
    }
  );
}

// src/editor/timing-edits.ts
function isMagneticTrack(sequence5, trackId) {
  return sequence5.timelineMode === "magnetic" && magneticTrackMatches(sequence5, trackId);
}
function magneticTrackMatches(sequence5, trackId) {
  return sequence5.magneticTrackId === void 0 || sequence5.magneticTrackId === trackId;
}
var equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function scope(value, sequenceId) {
  const document = validateEditorDocument(value), sequence5 = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence5) throw new Error("时间线不存在");
  return { document, sequence: sequence5 };
}
function find(sequence5, id5) {
  const clip3 = sequence5.clips.find((item) => item.id === id5);
  if (!clip3) throw new Error("片段不存在，请重新选择");
  return clip3;
}
function components(sequence5, includeBindings = true, includeTransitions = false) {
  const parents = new Map(sequence5.clips.map((clip3) => [clip3.id, clip3.id]));
  const root = (id5) => {
    let current = id5;
    while (parents.get(current) !== current) current = parents.get(current);
    while (id5 !== current) {
      const next = parents.get(id5);
      parents.set(id5, current);
      id5 = next;
    }
    return current;
  };
  const join2 = (a, b) => parents.set(root(a), root(b));
  const groupIds = /* @__PURE__ */ new Map(), linkIds = /* @__PURE__ */ new Map();
  for (const clip3 of sequence5.clips) {
    for (const [id5, ids3] of [
      [clip3.groupId, groupIds],
      [clip3.linkGroupId, linkIds]
    ])
      if (id5) {
        const other = ids3.get(id5);
        if (other) join2(clip3.id, other);
        else ids3.set(id5, clip3.id);
      }
    if (includeBindings && clip3.kind === "text" && clip3.sourceBinding)
      join2(clip3.id, clip3.sourceBinding.clipId);
  }
  if (includeTransitions)
    for (const transition of sequence5.transitions) join2(transition.fromClipId, transition.toClipId);
  const result = /* @__PURE__ */ new Map();
  for (const clip3 of sequence5.clips) {
    const id5 = root(clip3.id);
    if (!result.has(id5)) result.set(id5, /* @__PURE__ */ new Set());
    result.get(id5).add(clip3.id);
  }
  return [...result.values()];
}
function selected(sequence5, ids3) {
  if (!Array.isArray(ids3) || !ids3.length || ids3.length > 2e3 || new Set(ids3).size !== ids3.length)
    throw new Error("请选择有效且不重复的片段");
  ids3.forEach((id5) => find(sequence5, id5));
  const chosen = new Set(ids3), groups = components(sequence5, false);
  for (; ; ) {
    const size2 = chosen.size;
    for (const group of groups)
      if ([...group].some((id5) => chosen.has(id5))) group.forEach((id5) => chosen.add(id5));
    for (const clip3 of sequence5.clips)
      if (clip3.kind === "text" && clip3.sourceBinding && chosen.has(clip3.sourceBinding.clipId))
        chosen.add(clip3.id);
    if (size2 === chosen.size) return chosen;
  }
}
function unlocked2(sequence5, ids3, index2) {
  for (const id5 of ids3)
    if ((index2 ? index2.tracks.get(index2.clips.get(id5).trackId) : sequence5.tracks.find((track3) => track3.id === find(sequence5, id5).trackId))?.locked !== false)
      throw new Error("操作涉及已锁定轨道，请先解锁；所有片段均未修改");
}
function ordered(sequence5, trackId) {
  return sequence5.clips.filter((clip3) => clip3.trackId === trackId).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
function pairTransition(sequence5, from, to) {
  return sequence5.transitions.find((item) => item.fromClipId === from && item.toClipId === to);
}
function moveTargets(before, after, targets) {
  const shifts = /* @__PURE__ */ new Map(), afterClips = new Map(after.clips.map((clip3) => [clip3.id, clip3])), beforeIndex = {
    clips: new Map(before.clips.map((clip3) => [clip3.id, clip3])),
    tracks: new Map(before.tracks.map((track3) => [track3.id, track3]))
  };
  for (const group of components(before)) {
    const requests = [...group].filter((id5) => targets.has(id5) && afterClips.has(id5)).map((id5) => targets.get(id5) - afterClips.get(id5).start);
    if (!requests.length) continue;
    if (requests.some((delta2) => delta2 !== requests[0]))
      throw new Error("成组或关联片段需要不同位移，无法保持相对位置；请先调整分组或间隙");
    const delta = requests[0];
    if (!delta) continue;
    unlocked2(before, group, beforeIndex);
    for (const id5 of group) {
      const clip3 = afterClips.get(id5);
      if (clip3) {
        clip3.start += delta;
        assertTick(clip3.start, "移动后起点");
        shifts.set(id5, delta);
      }
    }
  }
  for (const transition of after.transitions) {
    const fromShift = shifts.get(transition.fromClipId) ?? 0, toShift = shifts.get(transition.toClipId) ?? 0;
    if (fromShift !== toShift)
      throw new Error("移动会改变另一处转场，请同时整理其两端片段或先移除该转场");
    transition.start += fromShift;
  }
  return shifts;
}
function finish2(document, before, after, shifts = /* @__PURE__ */ new Map()) {
  const operations = [], sequenceId = before.id, beforeClips = new Map(before.clips.map((clip3) => [clip3.id, clip3])), afterClips = new Map(after.clips.map((clip3) => [clip3.id, clip3])), beforeTransitions = new Map(before.transitions.map((item) => [item.id, item])), afterTransitions = new Map(after.transitions.map((item) => [item.id, item]));
  for (const transition of before.transitions)
    if (!equal(afterTransitions.get(transition.id), transition))
      operations.push({ type: "transition.remove", sequenceId, transitionId: transition.id });
  const removed = before.clips.filter((item) => !afterClips.has(item.id)).map((item) => item.id), removedIds = new Set(removed);
  if (removed.length) operations.push({ type: "clip.remove", sequenceId, clipIds: removed });
  for (const next of after.clips) {
    const original = beforeClips.get(next.id), unshifted = { ...next, start: next.start - (shifts.get(next.id) ?? 0) };
    if (!original) throw new Error("片段不存在，请重新选择");
    if (equal(original, unshifted)) continue;
    const { id: _id, kind: _kind, ...rest } = structuredClone(unshifted);
    const patch2 = rest;
    for (const key of ["groupId", "linkGroupId", "mask", "sourceBinding", "translation"])
      if (Object.hasOwn(original, key) && !Object.hasOwn(next, key)) patch2[key] = null;
    operations.push({
      type: "clip.update",
      sequenceId,
      clipId: next.id,
      patch: patch2
    });
  }
  const movement = /* @__PURE__ */ new Map();
  for (const group of components(before)) {
    const members = [...group].filter((id5) => shifts.has(id5) && !removedIds.has(id5));
    if (!members.length) continue;
    const delta = shifts.get(members[0]);
    if (!movement.has(delta)) movement.set(delta, []);
    movement.get(delta).push(...members);
  }
  for (const [delta, members] of movement) {
    operations.push({
      type: "clip.move",
      sequenceId,
      clipIds: members,
      delta
    });
  }
  for (const transition of after.transitions)
    if (!equal(beforeTransitions.get(transition.id), transition))
      operations.push({ type: "transition.add", sequenceId, transition });
  if (before.timelineMode !== after.timelineMode)
    operations.push({
      type: "sequence.update",
      sequenceId,
      patch: { timelineMode: after.timelineMode }
    });
  applyEditorOperations(document, operations, document.revision);
  return structuredClone(operations);
}
function isolated(document, sequence5, clip3) {
  const ids3 = /* @__PURE__ */ new Set([sequence5.id]), sequences = [
    {
      ...sequence5,
      transitions: [],
      markers: [],
      clips: sequence5.clips.filter(
        (item) => item.id === clip3.id || item.kind === "text" && item.sourceBinding?.clipId === clip3.id || clip3.kind === "text" && clip3.sourceBinding?.clipId === item.id
      )
    }
  ];
  for (let index2 = 0; index2 < sequences.length; index2++)
    for (const item of sequences[index2].clips)
      if (item.kind === "sequence" && !ids3.has(item.sequenceId)) {
        ids3.add(item.sequenceId);
        sequences.push(document.sequences.find((sequence6) => sequence6.id === item.sequenceId));
      }
  return validateEditorDocument({ ...document, activeSequenceId: sequence5.id, sequences });
}
function planClipTiming(value, sequenceId, clipIds, action, options = {}) {
  const { document, sequence: before } = scope(value, sequenceId), chosen = selected(before, clipIds), after = structuredClone(before);
  unlocked2(before, chosen);
  const affected = before.transitions.filter(
    (item) => chosen.has(item.fromClipId) || chosen.has(item.toClipId)
  );
  if (affected.length && !options.removeTransitions)
    throw new Error("所选片段带有转场；如需修改时间，请明确选择移除相关转场");
  after.transitions = after.transitions.filter(
    (item) => !affected.some((original) => original.id === item.id)
  );
  if (options.detachCaptions) {
    for (const clip3 of after.clips)
      if (clip3.kind === "text" && clip3.sourceBinding && chosen.has(clip3.sourceBinding.clipId))
        delete clip3.sourceBinding;
  }
  const owners = [...chosen].filter((id5) => {
    const clip3 = find(before, id5);
    return !(clip3.kind === "text" && clip3.sourceBinding && chosen.has(clip3.sourceBinding.clipId));
  });
  if (action.kind === "map" && owners.length > 1) {
    const anchor = find(before, owners[0]);
    if (!("timeMap" in anchor) || owners.some((id5) => {
      const member = find(before, id5);
      return !("timeMap" in member) || member.start !== anchor.start || member.duration !== anchor.duration || !equal(member.timeMap, anchor.timeMap);
    }))
      throw new Error(
        "共同编辑点表需要成组片段具有相同的起点、时长和来源映射；请先单独整理不同步片段"
      );
  }
  for (const id5 of owners) {
    const clip3 = find(after, id5), input = isolated(document, after, clip3);
    let operations;
    if (action.kind === "speed") operations = setClipSpeed(input, sequenceId, id5, action.rate);
    else if (action.kind === "map") {
      operations = setClipTimeMap(input, sequenceId, id5, action.timeMap);
    } else if (action.kind === "reverse") operations = reverseClip(input, sequenceId, id5);
    else if (action.kind === "freeze")
      operations = freezeClip(input, sequenceId, id5, action.time, action.duration);
    else {
      assertTick(action.time, "播放头时间");
      const start = action.kind === "keep-right" ? Math.max(0, action.time - clip3.start) : 0;
      const end = action.kind === "keep-left" ? Math.min(clip3.duration, action.time - clip3.start) : clip3.duration;
      operations = start >= end ? [{ type: "clip.remove", sequenceId, clipIds: [id5] }] : trimClip(input, sequenceId, id5, start, end);
    }
    const edited = applyEditorOperations(input, operations, input.revision).sequences.find(
      (item) => item.id === sequenceId
    );
    const included = input.sequences.find((item) => item.id === sequenceId).clips.map((item) => item.id);
    after.clips = after.clips.filter((item) => !included.includes(item.id)).concat(edited.clips);
    if (action.kind === "speed" && action.preservePitch !== void 0) {
      const next = find(after, id5);
      if ("audio" in next) next.audio.preservePitch = action.preservePitch;
    }
  }
  const targets = /* @__PURE__ */ new Map();
  if (options.ripple ?? before.timelineMode === "magnetic") {
    const tracks = new Set(
      owners.map((id5) => find(before, id5).trackId).filter(
        (id5) => before.tracks.find((track3) => track3.id === id5)?.kind !== "text" && (options.ripple !== void 0 || isMagneticTrack(before, id5))
      )
    );
    const afterClips = new Map(after.clips.map((clip3) => [clip3.id, clip3]));
    for (const trackId of tracks) {
      const trackClips = ordered(before, trackId);
      let cursor = trackClips[0]?.start ?? 0, previousOriginal, previousNext;
      for (const original of trackClips) {
        if (previousOriginal)
          cursor += Math.max(
            0,
            original.start - previousOriginal.start - previousOriginal.duration
          );
        const next = afterClips.get(original.id);
        if (next) {
          const overlap = previousNext ? pairTransition(after, previousNext.id, next.id)?.duration ?? 0 : 0;
          targets.set(next.id, cursor - overlap);
          cursor = cursor - overlap + next.duration;
          previousNext = next;
        }
        previousOriginal = original;
      }
    }
  } else if (affected.length) throw new Error("移除转场需要联动后续片段以消除重叠，请开启联动排列");
  const shifts = moveTargets(before, after, targets);
  return finish2(document, before, after, shifts);
}
function planTransition(value, sequenceId, fromClipId, toClipId, options) {
  const { document, sequence: before } = scope(value, sequenceId), from = find(before, fromClipId), to = find(before, toClipId), after = structuredClone(before);
  if (from.trackId !== to.trackId || before.tracks.find((track3) => track3.id === from.trackId)?.kind !== "video")
    throw new Error("转场需要同一画面轨的相邻片段");
  const clips = ordered(before, from.trackId), fromIndex = clips.findIndex((item) => item.id === from.id);
  if (clips[fromIndex + 1]?.id !== to.id) throw new Error("请选择从前到后相邻的两个画面片段");
  unlocked2(before, [from.id, to.id]);
  const existing = pairTransition(before, from.id, to.id), duration = options.remove ? 0 : assertTick(options.duration, "转场时长");
  if (!options.remove && (!duration || duration >= Math.min(from.duration, to.duration)))
    throw new Error("转场须短于前后两个片段的时长，且大于零");
  if (options.remove && !existing) throw new Error("这两个片段之间没有转场");
  after.transitions = after.transitions.filter((item) => item.id !== existing?.id);
  const target = from.start + from.duration - duration, delta = target - to.start, targets = /* @__PURE__ */ new Map([[from.id, from.start]]);
  const suffix = options.placement === "overlap" ? [to] : clips.slice(fromIndex + 1);
  suffix.forEach((clip3) => targets.set(clip3.id, clip3.start + delta));
  const shifts = moveTargets(before, after, targets);
  if (!options.remove)
    after.transitions.push({
      id: existing?.id ?? options.id,
      fromClipId: from.id,
      toClipId: to.id,
      start: find(after, to.id).start,
      duration,
      kind: options.kind
    });
  return finish2(document, before, after, shifts);
}
function planTimelineArrangement(value, sequenceId, options) {
  const { document, sequence: before } = scope(value, sequenceId), after = structuredClone(before);
  if (!["magnetic", "free"].includes(options.mode)) throw new Error("排列方式无效");
  after.timelineMode = options.mode;
  let shifts = /* @__PURE__ */ new Map();
  if (options.compact) {
    const trackId = options.trackId ?? before.magneticTrackId ?? before.tracks.find((track3) => track3.kind === "video")?.id;
    if (!trackId || before.tracks.find((track3) => track3.id === trackId)?.kind !== "video")
      throw new Error("请选择需要整理的画面轨");
    const clips = ordered(before, trackId), targets = /* @__PURE__ */ new Map();
    for (let index2 = 0; index2 < clips.length; index2++) {
      const clip3 = clips[index2], previous = clips[index2 - 1];
      targets.set(
        clip3.id,
        previous ? targets.get(previous.id) + previous.duration - (pairTransition(before, previous.id, clip3.id)?.duration ?? 0) : 0
      );
    }
    shifts = moveTargets(before, after, targets);
  }
  return finish2(document, before, after, shifts);
}
function blocks(sequence5, trackId, ids3) {
  const groups = components(sequence5, true, true), groupByClip = new Map(groups.flatMap((group, index2) => [...group].map((id5) => [id5, index2]))), values = groups.map(() => ({ clips: [], start: 0, duration: 0 }));
  for (const clip3 of ordered(sequence5, trackId)) {
    if (ids3 && !ids3.has(clip3.id)) continue;
    const block = values[groupByClip.get(clip3.id)];
    if (!block.clips.length) block.start = clip3.start;
    block.clips.push(clip3);
    block.duration = Math.max(block.duration, clip3.start + clip3.duration - block.start);
  }
  return values.filter((block) => block.clips.length).sort((a, b) => a.start - b.start);
}
function packBlocks(values, targets) {
  let cursor = 0;
  for (const block of values) {
    for (const clip3 of block.clips) targets.set(clip3.id, cursor + clip3.start - block.start);
    cursor += block.duration;
  }
}
function planMagneticMove(value, sequenceId, clipIds, options) {
  const { document, sequence: before } = scope(value, sequenceId), after = structuredClone(before);
  if (!Number.isSafeInteger(options.delta)) throw new Error("移动距离必须为有效刻度");
  const anchor = find(before, options.anchorClipId ?? clipIds[0]);
  if (!clipIds.includes(anchor.id)) throw new Error("移动锚点必须是所选片段");
  const destinationId = options.trackId ?? anchor.trackId;
  if (before.tracks.find((track3) => track3.id === anchor.trackId)?.kind !== "video" || !magneticTrackMatches(before, anchor.trackId) && !magneticTrackMatches(before, destinationId)) {
    const operations = [
      {
        type: "clip.move",
        sequenceId,
        clipIds: [...clipIds],
        delta: options.delta,
        ...options.trackId === void 0 ? {} : { trackId: options.trackId }
      }
    ];
    applyEditorOperations(document, operations, document.revision);
    return operations;
  }
  const initial = selected(before, clipIds);
  const chosen = new Set(
    components(before, true, true).filter((group) => [...group].some((id5) => initial.has(id5))).flatMap((group) => [...group])
  );
  unlocked2(before, chosen);
  const fromIndex = before.tracks.findIndex((track3) => track3.id === anchor.trackId), toIndex = options.trackId === void 0 ? fromIndex : before.tracks.findIndex((track3) => track3.id === options.trackId), trackShift = toIndex - fromIndex;
  if (toIndex < 0 || before.tracks[toIndex].kind !== "video")
    throw new Error("请选择有效的画面目标轨道");
  const destination = before.tracks[toIndex].id;
  for (const clip3 of after.clips.filter((clip4) => chosen.has(clip4.id))) {
    if (clip3.kind === "text" && clip3.sourceBinding && chosen.has(clip3.sourceBinding.clipId))
      continue;
    const sourceIndex = before.tracks.findIndex((track4) => track4.id === clip3.trackId), track3 = before.tracks[sourceIndex + trackShift];
    if (!track3 || track3.kind !== before.tracks[sourceIndex].kind)
      throw new Error("成组片段移动后轨道类型不匹配或超出范围");
    if (track3.locked) throw new Error("目标轨道已锁定，所有片段均未修改");
    clip3.trackId = track3.id;
  }
  const targets = /* @__PURE__ */ new Map();
  const kept = new Set(after.clips.filter((clip3) => !chosen.has(clip3.id)).map((clip3) => clip3.id));
  if (destination !== anchor.trackId && magneticTrackMatches(before, anchor.trackId))
    packBlocks(blocks(after, anchor.trackId, kept), targets);
  const movingClips = ordered(after, destination).filter((clip3) => chosen.has(clip3.id)), start = movingClips[0].start;
  const moving = {
    clips: movingClips,
    start,
    duration: Math.max(...movingClips.map((clip3) => clip3.start + clip3.duration)) - start
  };
  const remaining = blocks(after, destination, kept);
  const desired = start + options.delta;
  let index2 = remaining.filter((block) => desired >= block.start + block.duration / 2).length;
  if (options.direction && destination === anchor.trackId) {
    const oldIndex = remaining.filter((block) => block.start < start).length;
    index2 = Math.max(
      0,
      Math.min(remaining.length, oldIndex + (options.direction === "previous" ? -1 : 1))
    );
  }
  if (magneticTrackMatches(before, destination)) {
    remaining.splice(index2, 0, moving);
    packBlocks(remaining, targets);
  } else {
    for (const clip3 of moving.clips) targets.set(clip3.id, clip3.start + options.delta);
  }
  const shifts = moveTargets(before, after, targets);
  return finish2(document, before, after, shifts);
}
function planMagneticRemove(value, sequenceId, clipIds) {
  const { document, sequence: before } = scope(value, sequenceId), chosen = selected(before, clipIds), after = structuredClone(before);
  unlocked2(before, chosen);
  const tracks = new Set(
    [...chosen].map((id5) => find(before, id5).trackId).filter(
      (id5) => before.tracks.find((track3) => track3.id === id5)?.kind === "video" && magneticTrackMatches(before, id5)
    )
  );
  after.clips = after.clips.filter((clip3) => !chosen.has(clip3.id));
  after.transitions = after.transitions.filter(
    (transition) => !chosen.has(transition.fromClipId) && !chosen.has(transition.toClipId)
  );
  const targets = /* @__PURE__ */ new Map();
  for (const trackId of tracks) packBlocks(blocks(after, trackId), targets);
  const shifts = moveTargets(before, after, targets);
  return finish2(document, before, after, shifts);
}

// src/editor/clipboard-edits.ts
function planCutClips(value, sequenceId, clipIds) {
  const document = validateEditorDocument(value), sequence5 = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence5) throw new Error("序列不存在");
  const payload = copyClips(document, sequenceId, clipIds);
  const selected3 = new Set(clipIds);
  for (; ; ) {
    const count = selected3.size, members = sequence5.clips.filter((clip3) => selected3.has(clip3.id)), groups = new Set(members.map((clip3) => clip3.groupId).filter(Boolean)), links = new Set(members.map((clip3) => clip3.linkGroupId).filter(Boolean));
    for (const clip3 of sequence5.clips)
      if (clip3.groupId && groups.has(clip3.groupId) || clip3.linkGroupId && links.has(clip3.linkGroupId))
        selected3.add(clip3.id);
    if (count === selected3.size) break;
  }
  const operations = sequence5.timelineMode === "magnetic" ? planMagneticRemove(document, sequenceId, [...selected3]) : [{ type: "clip.remove", sequenceId, clipIds: [...selected3] }];
  const after = applyEditorOperations(document, operations, document.revision), remaining = new Set(
    after.sequences.find((item) => item.id === sequenceId).clips.map((clip3) => clip3.id)
  );
  if (payload.document.sequences.find((item) => item.id === sequenceId).clips.some((clip3) => remaining.has(clip3.id)))
    throw new Error("剪切来源字幕时，请同时选择来源片段，或先明确解除字幕绑定");
  return { operations, payload };
}
function duplicateClipsInPlace(value, sequenceId, clipIds, options) {
  const document = validateEditorDocument(value), sequence5 = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence5) throw new Error("序列不存在");
  const payload = copyClips(document, sequenceId, clipIds), source2 = payload.document.sequences.find((item) => item.id === sequenceId), usedTracks = new Set(source2.clips.map((clip3) => clip3.trackId)), trackMap = Object.fromEntries(
    sequence5.tracks.map((track3) => [track3.id, track3.id])
  ), operations = [];
  for (const track3 of sequence5.tracks.filter((item) => usedTracks.has(item.id))) {
    if (track3.locked) throw new Error(`轨道“${track3.name}”已锁定，请先解锁`);
    const id5 = options.idFactory("track");
    trackMap[track3.id] = id5;
    operations.push({
      type: "track.add",
      sequenceId,
      track: { ...structuredClone(track3), id: id5, name: `${track3.name.slice(0, 190)} 副本` }
    });
  }
  const draft = applyEditorOperations(document, operations, document.revision);
  operations.push(
    ...pasteClips(draft, sequenceId, payload, {
      at: payload.origin,
      trackMap,
      idFactory: options.idFactory
    })
  );
  applyEditorOperations(document, operations, document.revision);
  return operations;
}

// src/editor/marker-edits.ts
function planMarkerEdit(document, sequenceId, request) {
  if (!request || typeof request !== "object" || Array.isArray(request) || ![Object.prototype, null].includes(Object.getPrototypeOf(request)))
    throw new Error("标记操作格式无效");
  if (Reflect.ownKeys(request).some(
    (key) => typeof key !== "string" || !Object.getOwnPropertyDescriptor(request, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(request, key), "value")
  ))
    throw new Error("标记操作包含动态属性");
  const allowed = request.action === "add" ? ["action", "marker"] : request.action === "update" ? ["action", "markerId", "patch"] : request.action === "remove" ? ["action", "markerId"] : [];
  if (!allowed.length || Reflect.ownKeys(request).some(
    (key) => typeof key !== "string" || !allowed.includes(key) || !Object.getOwnPropertyDescriptor(request, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(request, key), "value")
  ))
    throw new Error("标记操作包含未知字段或动态属性");
  const operation = request.action === "add" ? { type: "marker.add", sequenceId, marker: request.marker } : request.action === "update" ? { type: "marker.update", sequenceId, markerId: request.markerId, patch: request.patch } : { type: "marker.remove", sequenceId, markerId: request.markerId };
  applyEditorOperations(document, [operation], document.revision);
  return {
    operations: structuredClone([operation]),
    sequenceId,
    markerId: request.action === "add" ? request.marker.id : request.markerId
  };
}

// src/editor/export-submissions.ts
function createExportSubmissions() {
  const entries = /* @__PURE__ */ new Map();
  const active = (status) => status === "preparing" || status === "cancelling";
  return {
    list() {
      return structuredClone([...entries.values()].map((entry) => entry.receipt));
    },
    accept(request, start, cancelJob) {
      const fingerprint = JSON.stringify([
        request.identity.documentId,
        request.identity.generation,
        request.identity.revision,
        request.sequenceId,
        request.profileId
      ]);
      const key = request.requestId ? JSON.stringify([
        request.identity.documentId,
        request.identity.generation,
        request.requestId
      ]) : fingerprint;
      const previous = [...entries.values()].find((entry2) => entry2.key === key);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error("导出 requestId 已用于另一个版本或预设，请重新规划");
        return structuredClone(previous.receipt);
      }
      if ([...entries.values()].filter((entry2) => active(entry2.receipt.status)).length >= 8)
        throw new Error("已有 8 个导出正在准备，请等待或取消后再提交");
      while (entries.size >= 64) {
        const oldest = [...entries].find(([, entry2]) => !active(entry2.receipt.status));
        if (!oldest) break;
        entries.delete(oldest[0]);
      }
      const receipt = {
        ...structuredClone(request),
        accepted: true,
        operationId: `export-${randomId()}`,
        status: "preparing"
      };
      const entry = { key, fingerprint, receipt, abort: new AbortController(), cancelJob };
      entries.set(receipt.operationId, entry);
      void Promise.resolve().then(async () => {
        if (entry.abort.signal.aborted) throw new DOMException("已取消导出准备", "AbortError");
        const result = await start(entry.abort.signal);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(result.jobId))
          throw new Error("导出任务回执无效");
        receipt.jobId = result.jobId;
        if (entry.abort.signal.aborted) {
          if (!cancelJob) throw new Error("导出已提交，请在任务列表中取消");
          await cancelJob(result.jobId);
          receipt.status = "cancelled";
        } else receipt.status = "submitted";
      }).catch((error) => {
        receipt.status = entry.abort.signal.aborted && !receipt.jobId ? "cancelled" : "failed";
        receipt.error = (error instanceof Error ? error.message : String(error)).slice(0, 2e3);
      });
      return structuredClone(receipt);
    },
    cancel(operationId, identity2) {
      const entry = entries.get(operationId);
      if (!entry || entry.receipt.identity.documentId !== identity2.documentId || entry.receipt.identity.generation !== identity2.generation)
        throw new Error("这不是当前工程会话的导出回执");
      const receipt = entry.receipt;
      if (receipt.status === "cancelled" || receipt.status === "cancelling")
        return structuredClone(receipt);
      if (receipt.jobId) {
        if (!entry.cancelJob) throw new Error("请在后台任务列表中取消此导出");
        receipt.status = "cancelling";
        void entry.cancelJob(receipt.jobId).then(() => {
          receipt.status = "cancelled";
          delete receipt.error;
        }).catch((error) => {
          receipt.status = "failed";
          receipt.error = (error instanceof Error ? error.message : String(error)).slice(0, 2e3);
        });
      } else if (receipt.status === "preparing") {
        receipt.status = "cancelling";
        entry.abort.abort();
      }
      return structuredClone(receipt);
    }
  };
}

// src/editor/defaults.ts
function defaultTransform() {
  return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
    fit: "contain",
    crop: { left: 0, top: 0, right: 0, bottom: 0 }
  };
}
function defaultColorAdjustment() {
  return {
    exposure: 0,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    hue: 0,
    curves: [],
    hsl: []
  };
}
function defaultAudioMix() {
  return { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, pitchSemitones: 0, preservePitch: true };
}
function defaultTextStyle() {
  return {
    layout: "box",
    fontFamily: "system-ui",
    fontSize: 48,
    fontWeight: 600,
    italic: false,
    color: "#ffffff",
    strokeColor: "#000000",
    strokeWidth: 0,
    background: "#00000000",
    backgroundRadius: 0,
    padding: 0,
    align: "center",
    lineHeight: 1.4,
    letterSpacing: 0,
    maxWidth: 0.85,
    highlightColor: "#ffe46b",
    shadow: { color: "#00000000", blur: 0, x: 0, y: 0 },
    animation: "none"
  };
}
function createTrack(id5, kind, name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id5)) throw new Error("轨道 ID 无效");
  if (!["video", "audio", "text"].includes(kind)) throw new Error("轨道类型无效");
  const label3 = name ?? { video: "画面", audio: "声音", text: "文字" }[kind];
  if (typeof label3 !== "string" || !label3.trim() || label3.length > 200 || /[\x00-\x1f\x7f]/.test(label3))
    throw new Error("轨道名称无效");
  return { id: id5, kind, name: label3, locked: false, hidden: false, muted: false, volume: 1, pan: 0 };
}

// src/external-media.ts
var isResourceId = (id5) => typeof id5 === "string" && /^(?:asset|external)-[a-f0-9]{64}$/.test(id5);

// src/editor/audio-enhancement.ts
function readSettings(raw, requireEffect) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) || Reflect.ownKeys(raw).some(
    (key) => typeof key !== "string" || !["preset", "denoise", "normalize"].includes(String(key))
  ))
    throw new Error("声音优化设置无效");
  const data = raw;
  if (!["light", "balanced"].includes(data.preset) || typeof data.denoise !== "boolean" || typeof data.normalize !== "boolean" || requireEffect && !data.denoise && !data.normalize)
    throw new Error("请选择降噪或响度统一");
  return { preset: data.preset, denoise: data.denoise, normalize: data.normalize };
}
function validateAudioEnhancementSettings(raw) {
  return readSettings(raw, true);
}

// src/editor/sequence-edits.ts
var clone = (value) => structuredClone(value);
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function sequence3(doc, id5) {
  const result = doc.sequences.find((item) => item.id === id5);
  if (!result) throw new Error("序列不存在");
  return result;
}
function fresh(doc, factory) {
  const used = /* @__PURE__ */ new Set([doc.id, ...doc.assets.map((asset2) => asset2.id)]);
  for (const seq of doc.sequences) {
    used.add(seq.id);
    [...seq.tracks, ...seq.clips, ...seq.transitions, ...seq.markers].forEach(
      (item) => used.add(item.id)
    );
    seq.clips.forEach((clip3) => {
      if (clip3.groupId) used.add(clip3.groupId);
      if (clip3.linkGroupId) used.add(clip3.linkGroupId);
      if (clip3.kind === "multicam") clip3.angles.forEach((angle) => used.add(angle.id));
    });
  }
  return (kind) => {
    const id5 = factory ? factory(kind) : `${kind}-${randomId()}`;
    if (typeof id5 !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id5) || used.has(id5))
      throw new Error("新对象标识无效或重复");
    used.add(id5);
    return id5;
  };
}
function finish3(doc, plan2) {
  applyEditorOperations(doc, plan2.operations, doc.revision);
  return clone(plan2);
}
function unlocked3(seq, clip3) {
  if (seq.tracks.find((track3) => track3.id === clip3.trackId)?.locked)
    throw new Error(`“${clip3.label}”所在轨道已锁定`);
}
function neutralClip(clip3) {
  return !clip3.mask && clip3.blendMode === "normal" && same(clip3.transform, defaultTransform()) && same(clip3.color, defaultColorAdjustment()) && same(clip3.audio, defaultAudioMix());
}
function wrapper(id5, child, trackId, start) {
  const duration = sequenceDuration(child);
  if (!duration) throw new Error("空序列不能作为复合片段加入时间轴");
  return {
    id: id5,
    kind: "sequence",
    sequenceId: child.id,
    label: child.name,
    trackId,
    start,
    duration,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: duration, source: duration }
      ]
    },
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    audio: defaultAudioMix()
  };
}
function planCreateSequence(document, options) {
  const doc = validateEditorDocument(document), ids3 = fresh(doc, options.idFactory), id5 = ids3("sequence");
  const seq = {
    id: id5,
    name: options.name,
    width: options.width,
    height: options.height,
    frameRate: clone(options.frameRate),
    background: options.background ?? "#000000",
    timelineMode: "free",
    tracks: [
      createTrack(ids3("track"), "video", "画面"),
      createTrack(ids3("track"), "audio", "声音"),
      createTrack(ids3("track"), "text", "文字")
    ],
    clips: [],
    transitions: [],
    markers: []
  };
  return finish3(doc, {
    operations: [
      { type: "sequence.add", sequence: seq },
      ...options.activate === false ? [] : [{ type: "sequence.activate", sequenceId: id5 }]
    ],
    sequenceId: id5,
    clipIds: [],
    createdSequenceId: id5
  });
}
function planRenameSequence(document, sequenceId, name) {
  const doc = validateEditorDocument(document);
  sequence3(doc, sequenceId);
  return finish3(doc, {
    operations: [{ type: "sequence.rename", sequenceId, name }],
    sequenceId,
    clipIds: []
  });
}
function planRemoveSequence(document, sequenceId, replacementId) {
  const doc = validateEditorDocument(document);
  sequence3(doc, sequenceId);
  if (doc.sequences.length === 1) throw new Error("工程至少保留一个序列");
  if (doc.sequences.some(
    (seq) => seq.clips.some((clip3) => clip3.kind === "sequence" && clip3.sequenceId === sequenceId)
  ))
    throw new Error("此序列仍被复合片段引用，请先移除引用");
  const nextId = doc.activeSequenceId === sequenceId ? replacementId ?? doc.sequences.find((seq) => seq.id !== sequenceId).id : doc.activeSequenceId;
  if (nextId === sequenceId) throw new Error("请选择另一个当前序列");
  sequence3(doc, nextId);
  return finish3(doc, {
    operations: [
      ...doc.activeSequenceId === sequenceId ? [{ type: "sequence.activate", sequenceId: nextId }] : [],
      { type: "sequence.remove", sequenceId }
    ],
    sequenceId: nextId,
    clipIds: []
  });
}
function copyMap(seq, sequenceId, ids3) {
  const groups = /* @__PURE__ */ new Map(), links = /* @__PURE__ */ new Map();
  seq.clips.forEach((clip3) => {
    if (clip3.groupId && !groups.has(clip3.groupId)) groups.set(clip3.groupId, ids3("group"));
    if (clip3.linkGroupId && !links.has(clip3.linkGroupId)) links.set(clip3.linkGroupId, ids3("link"));
  });
  return {
    sequenceId,
    tracks: new Map(seq.tracks.map((track3) => [track3.id, ids3("track")])),
    clips: new Map(seq.clips.map((clip3) => [clip3.id, ids3("clip")])),
    groups,
    links
  };
}
function copyClip(doc, original, raw, maps, ids3, shift = 0) {
  const map2 = maps.get(original.id), clip3 = clone(raw);
  clip3.id = map2.clips.get(raw.id);
  clip3.trackId = map2.tracks.get(raw.trackId);
  clip3.start += shift;
  if (clip3.groupId) clip3.groupId = map2.groups.get(clip3.groupId);
  if (clip3.linkGroupId) clip3.linkGroupId = map2.links.get(clip3.linkGroupId);
  if ("audio" in clip3 && clip3.audio.ducking)
    clip3.audio.ducking.sidechainTrackIds = clip3.audio.ducking.sidechainTrackIds.map(
      (id5) => map2.tracks.get(id5)
    );
  if (clip3.kind === "sequence")
    clip3.sequenceId = maps.get(clip3.sequenceId)?.sequenceId ?? clip3.sequenceId;
  if (clip3.kind === "multicam") {
    const angles = new Map(clip3.angles.map((angle) => [angle.id, ids3("angle")]));
    clip3.angles.forEach((angle) => {
      angle.id = angles.get(angle.id);
    });
    clip3.switches.forEach((item) => {
      item.angleId = angles.get(item.angleId);
    });
    clip3.audioAngleId = angles.get(clip3.audioAngleId);
  }
  if (clip3.kind === "text" && clip3.sourceBinding) {
    const binding = clip3.sourceBinding;
    let owner = original.clips.find((item) => item.id === binding.clipId);
    binding.clipId = map2.clips.get(binding.clipId);
    if (binding.provenance)
      binding.provenance.path = binding.provenance.path.map((id5) => {
        if (owner.kind !== "sequence") throw new Error("字幕来源路径无效");
        const child = sequence3(doc, owner.sequenceId);
        owner = child.clips.find((item) => item.id === id5);
        return maps.get(child.id)?.clips.get(id5) ?? id5;
      });
  }
  return clip3;
}
function planDuplicateSequence(document, sequenceId, options = {}) {
  const doc = validateEditorDocument(document), source2 = sequence3(doc, sequenceId), ids3 = fresh(doc, options.idFactory), closure = [], visited = /* @__PURE__ */ new Set();
  const visit = (seq) => {
    if (visited.has(seq.id)) return;
    visited.add(seq.id);
    closure.push(seq);
    seq.clips.forEach((clip3) => {
      if (clip3.kind === "sequence") visit(sequence3(doc, clip3.sequenceId));
    });
  };
  visit(source2);
  const maps = new Map(closure.map((seq) => [seq.id, copyMap(seq, ids3("sequence"), ids3)]));
  const operations = closure.map((seq) => {
    const map2 = maps.get(seq.id);
    return {
      type: "sequence.add",
      sequence: {
        ...clone(seq),
        id: map2.sequenceId,
        ...seq.magneticTrackId ? { magneticTrackId: map2.tracks.get(seq.magneticTrackId) } : {},
        name: seq.id === source2.id ? options.name ?? `${seq.name} 副本` : `${seq.name} 副本`,
        tracks: seq.tracks.map((track3) => ({ ...clone(track3), id: map2.tracks.get(track3.id) })),
        clips: seq.clips.map((clip3) => copyClip(doc, seq, clip3, maps, ids3)),
        transitions: seq.transitions.map((item) => ({
          ...clone(item),
          id: ids3("transition"),
          fromClipId: map2.clips.get(item.fromClipId),
          toClipId: map2.clips.get(item.toClipId)
        })),
        markers: seq.markers.map((item) => ({ ...clone(item), id: ids3("marker") }))
      }
    };
  });
  const id5 = maps.get(source2.id).sequenceId;
  if (options.activate !== false) operations.push({ type: "sequence.activate", sequenceId: id5 });
  return finish3(doc, { operations, sequenceId: id5, clipIds: [], createdSequenceId: id5 });
}
function planNestSequence(document, parentId, childId, options) {
  const doc = validateEditorDocument(document), parent = sequence3(doc, parentId), child = sequence3(doc, childId), ids3 = fresh(doc, options.idFactory);
  assertTick(options.at);
  const operations = [];
  const trackId = options.trackId ?? ids3("track");
  if (!options.trackId)
    operations.push({
      type: "track.add",
      sequenceId: parentId,
      track: createTrack(trackId, "video", child.name)
    });
  else if (parent.tracks.find((track3) => track3.id === trackId)?.kind !== "video")
    throw new Error("嵌套序列需要画面轨道");
  const clip3 = wrapper(ids3("clip"), child, trackId, options.at);
  operations.push({ type: "clip.add", sequenceId: parentId, clip: clip3 });
  return finish3(doc, { operations, sequenceId: parentId, clipIds: [clip3.id] });
}
function expanded(seq, requested) {
  if (!requested.length || requested.length > 2e3 || new Set(requested).size !== requested.length)
    throw new Error("请选择 1 至 2000 个不同片段");
  const selected3 = new Set(requested);
  if (requested.some((id5) => !seq.clips.some((clip3) => clip3.id === id5)))
    throw new Error("选中片段已不存在");
  let changed = true;
  while (changed) {
    const previous = selected3.size, groups = /* @__PURE__ */ new Set(), links = /* @__PURE__ */ new Set();
    for (const clip3 of seq.clips)
      if (selected3.has(clip3.id)) {
        if (clip3.groupId) groups.add(clip3.groupId);
        if (clip3.linkGroupId) links.add(clip3.linkGroupId);
        if (clip3.kind === "text" && clip3.sourceBinding) selected3.add(clip3.sourceBinding.clipId);
      }
    for (const clip3 of seq.clips)
      if (clip3.groupId && groups.has(clip3.groupId) || clip3.linkGroupId && links.has(clip3.linkGroupId) || clip3.kind === "text" && clip3.sourceBinding && selected3.has(clip3.sourceBinding.clipId))
        selected3.add(clip3.id);
    for (const transition of seq.transitions)
      if (selected3.has(transition.fromClipId) || selected3.has(transition.toClipId)) {
        selected3.add(transition.fromClipId);
        selected3.add(transition.toClipId);
      }
    changed = previous !== selected3.size;
  }
  if (selected3.size > 2e3) throw new Error("联动片段超过 2000 个，请分批创建复合片段");
  return selected3;
}
var overlaps = (clip3, start, end) => clip3.start < end && clip3.start + clip3.duration > start;
function checkIsolation(seq, selected3, start, end) {
  const inside = seq.clips.filter((clip3) => selected3.has(clip3.id)), outside = seq.clips.filter((clip3) => !selected3.has(clip3.id));
  const visual2 = inside.filter(
    (clip3) => seq.tracks.find((track3) => track3.id === clip3.trackId).kind !== "audio"
  );
  const indices = visual2.map((clip3) => seq.tracks.findIndex((track3) => track3.id === clip3.trackId));
  const low = Math.min(...indices), high = Math.max(...indices);
  if (outside.some((clip3) => {
    const index2 = seq.tracks.findIndex((track3) => track3.id === clip3.trackId);
    return seq.tracks[index2].kind !== "audio" && index2 >= low && index2 <= high && overlaps(clip3, start, end);
  }))
    throw new Error("选中画面之间夹有其他片段；请一起选择，保持原有叠放顺序");
  if (visual2.some((clip3) => clip3.blendMode !== "normal"))
    throw new Error("混合模式依赖外层画面，当前不能无损创建复合片段");
  if (visual2.some((clip3) => clip3.kind === "text" && clip3.style.layout === "caption-stack") && outside.some(
    (clip3) => clip3.kind === "text" && clip3.style.layout === "caption-stack" && overlaps(clip3, start, end)
  ))
    throw new Error("上下叠放字幕需要一起创建复合片段，避免改变字幕位置");
  for (const clip3 of seq.clips) {
    if (!("audio" in clip3) || !clip3.audio.ducking) continue;
    const isInside = selected3.has(clip3.id);
    if (seq.clips.some(
      (other) => selected3.has(other.id) !== isInside && clip3.audio.ducking.sidechainTrackIds.includes(other.trackId)
    ))
      throw new Error("自动压低音量跨越了所选范围，请一起选择相关声音片段");
  }
  return indices.length ? high + 1 : seq.tracks.length;
}
function route2(doc, seq, caption) {
  if (!caption.sourceBinding) return [];
  let owner = seq.clips.find((clip3) => clip3.id === caption.sourceBinding.clipId);
  const result = [{ sequenceId: seq.id, clip: owner }];
  for (const id5 of caption.sourceBinding.provenance?.path ?? []) {
    if (owner.kind !== "sequence") throw new Error("字幕来源路径无效");
    seq = sequence3(doc, owner.sequenceId);
    owner = seq.clips.find((clip3) => clip3.id === id5);
    result.push({ sequenceId: seq.id, clip: owner });
  }
  return result;
}
function planCreateCompound(document, sequenceId, clipIds, options) {
  const doc = validateEditorDocument(document), parent = sequence3(doc, sequenceId), ids3 = fresh(doc, options.idFactory), selected3 = expanded(parent, clipIds);
  const clips = parent.clips.filter((clip3) => selected3.has(clip3.id));
  clips.forEach((clip3) => unlocked3(parent, clip3));
  const start = Math.min(...clips.map((clip3) => clip3.start)), end = Math.max(...clips.map((clip3) => clip3.start + clip3.duration));
  const trackIndex = checkIsolation(parent, selected3, start, end), tracks = new Map(parent.tracks.map((track3) => [track3.id, ids3("track")]));
  const child = {
    ...clone(parent),
    id: ids3("sequence"),
    name: options.name,
    background: "#00000000",
    timelineMode: "free",
    ...parent.magneticTrackId ? { magneticTrackId: tracks.get(parent.magneticTrackId) } : {},
    tracks: parent.tracks.map((track3) => ({ ...clone(track3), id: tracks.get(track3.id) })),
    clips: clips.map((original) => {
      const clip3 = clone(original);
      clip3.start -= start;
      clip3.trackId = tracks.get(clip3.trackId);
      if ("audio" in clip3 && clip3.audio.ducking)
        clip3.audio.ducking.sidechainTrackIds = clip3.audio.ducking.sidechainTrackIds.map(
          (id5) => tracks.get(id5)
        );
      return clip3;
    }),
    transitions: parent.transitions.filter((item) => selected3.has(item.fromClipId)).map((item) => ({ ...clone(item), start: item.start - start })),
    markers: []
  };
  const trackId = ids3("track"), nested = wrapper(ids3("clip"), child, trackId, start), operations = [
    { type: "sequence.add", sequence: child },
    {
      type: "track.add",
      sequenceId,
      track: createTrack(
        trackId,
        clips.every(
          (clip3) => parent.tracks.find((track3) => track3.id === clip3.trackId).kind === "audio"
        ) ? "audio" : "video",
        options.name
      ),
      index: trackIndex
    }
  ];
  for (const seq of doc.sequences)
    for (const caption of seq.clips) {
      if (caption.kind !== "text" || !caption.sourceBinding || seq.id === sequenceId && selected3.has(caption.id))
        continue;
      const stages = route2(doc, seq, caption), index2 = stages.findIndex(
        (stage) => stage.sequenceId === sequenceId && selected3.has(stage.clip.id)
      );
      if (index2 < 0) continue;
      if (!caption.sourceBinding.provenance || index2 === 0)
        throw new Error("此字幕缺少跨序列来源记录，不能安全改写复合结构");
      unlocked3(seq, caption);
      const sourceBinding = clone(caption.sourceBinding);
      sourceBinding.provenance.path.splice(index2 - 1, 0, nested.id);
      operations.push({
        type: "clip.update",
        sequenceId: seq.id,
        clipId: caption.id,
        patch: { sourceBinding }
      });
    }
  operations.push(
    { type: "clip.remove", sequenceId, clipIds: [...selected3] },
    { type: "clip.add", sequenceId, clip: nested }
  );
  return finish3(doc, {
    operations,
    sequenceId,
    clipIds: [nested.id],
    includedClipIds: [...selected3],
    createdSequenceId: child.id
  });
}
function planUnpackCompound(document, sequenceId, clipId, options = {}) {
  const doc = validateEditorDocument(document), parent = sequence3(doc, sequenceId), raw = parent.clips.find((clip3) => clip3.id === clipId);
  if (!raw || raw.kind !== "sequence") throw new Error("请选择一个复合片段");
  const nested = raw, child = sequence3(doc, nested.sequenceId), duration = sequenceDuration(child), ids3 = fresh(doc, options.idFactory);
  unlocked3(parent, nested);
  const track3 = parent.tracks.find((item) => item.id === nested.trackId);
  if (track3.kind === "audio" && (!/^#[0-9a-f]{6}00$/i.test(child.background) || child.clips.some(
    (clip3) => child.tracks.find((item) => item.id === clip3.trackId).kind !== "audio"
  )))
    throw new Error("声音轨道中的复合包含不可见画面，请先移到画面轨道后解除复合");
  if (!neutralClip(nested) || track3.hidden || track3.muted || track3.volume !== 1 || track3.pan !== 0)
    throw new Error("复合片段或所在轨道已有整体效果，请先恢复默认效果后解除复合");
  if (nested.groupId || nested.linkGroupId)
    throw new Error("请先解除复合片段与其他片段的分组或链接");
  if (nested.duration !== duration || nested.timeMap.points.some((point) => point.source !== point.time))
    throw new Error("已裁剪、变速、倒放或定格的复合片段暂不能无损解除");
  if (parent.width !== child.width || parent.height !== child.height)
    throw new Error("不同画布尺寸的复合片段暂不能无损解除");
  if (parent.transitions.some((item) => item.fromClipId === clipId || item.toClipId === clipId))
    throw new Error("请先移除复合片段两端的转场");
  child.clips.forEach((clip3) => unlocked3(child, clip3));
  if (parent.clips.some(
    (clip3) => "audio" in clip3 && clip3.audio.ducking?.sidechainTrackIds.includes(track3.id)
  ))
    throw new Error("其他片段正在依据此复合轨道压低音量，暂不能解除复合");
  const opaque = /^#[0-9a-f]{6}(ff)?$/i.test(child.background);
  if (!opaque && child.clips.some(
    (clip3) => child.tracks.find((item) => item.id === clip3.trackId).kind !== "audio" && clip3.blendMode !== "normal"
  ))
    throw new Error("透明复合中的混合模式依赖独立画布，暂不能无损解除");
  if (child.clips.some((clip3) => clip3.kind === "text" && clip3.style.layout === "caption-stack") && parent.clips.some(
    (clip3) => clip3.kind === "text" && clip3.style.layout === "caption-stack" && overlaps(clip3, nested.start, nested.start + nested.duration)
  ))
    throw new Error("解除后会改变上下叠放字幕的布局，请先调整字幕布局");
  const map2 = copyMap(child, parent.id, ids3), maps = /* @__PURE__ */ new Map([[child.id, map2]]);
  const copied = child.clips.map((clip3) => copyClip(doc, child, clip3, maps, ids3, nested.start));
  const operations = [], index2 = parent.tracks.findIndex((item) => item.id === track3.id);
  let insertion = index2;
  if (!/^#[0-9a-f]{6}00$/i.test(child.background)) {
    const backgroundTrack = createTrack(ids3("track"), "video", `${child.name} 背景`);
    operations.push(
      { type: "track.add", sequenceId, track: backgroundTrack, index: insertion++ },
      {
        type: "clip.add",
        sequenceId,
        clip: {
          id: ids3("clip"),
          kind: "shape",
          shape: "rectangle",
          label: `${child.name} 背景`,
          trackId: backgroundTrack.id,
          start: nested.start,
          duration: nested.duration,
          transform: defaultTransform(),
          color: defaultColorAdjustment(),
          blendMode: "normal",
          fill: child.background,
          stroke: "#00000000",
          strokeWidth: 0
        }
      }
    );
  }
  for (const original of child.tracks)
    operations.push({
      type: "track.add",
      sequenceId,
      track: { ...clone(original), id: map2.tracks.get(original.id) },
      index: insertion++
    });
  copied.forEach((clip3) => operations.push({ type: "clip.add", sequenceId, clip: clip3 }));
  child.transitions.forEach(
    (item) => operations.push({
      type: "transition.add",
      sequenceId,
      transition: {
        ...clone(item),
        id: ids3("transition"),
        start: item.start + nested.start,
        fromClipId: map2.clips.get(item.fromClipId),
        toClipId: map2.clips.get(item.toClipId)
      }
    })
  );
  child.markers.forEach(
    (item) => operations.push({
      type: "marker.add",
      sequenceId,
      marker: { ...clone(item), id: ids3("marker"), time: item.time + nested.start }
    })
  );
  for (const seq of doc.sequences)
    for (const caption of seq.clips) {
      if (caption.kind !== "text" || !caption.sourceBinding) continue;
      const stages = route2(doc, seq, caption), stageIndex = stages.findIndex(
        (stage) => stage.sequenceId === sequenceId && stage.clip.id === clipId
      );
      if (stageIndex < 0) continue;
      const nextStage = stages[stageIndex + 1];
      if (!nextStage || !caption.sourceBinding.provenance)
        throw new Error("复合片段绑定字幕缺少具体素材来源，请先重新绑定或解除字幕绑定");
      unlocked3(seq, caption);
      const sourceBinding = clone(caption.sourceBinding), newId = map2.clips.get(nextStage.clip.id);
      if (stageIndex === 0) {
        const owner = copied.find((clip3) => clip3.id === newId);
        if (!("timeMap" in owner)) throw new Error("字幕来源没有素材时间映射");
        sourceBinding.clipId = newId;
        sourceBinding.provenance.path.shift();
        const a = sourceTimeAt(owner.timeMap, Math.max(0, caption.start - owner.start)), b = sourceTimeAt(
          owner.timeMap,
          Math.min(owner.duration, caption.start + caption.duration - owner.start)
        );
        sourceBinding.sourceStart = Math.min(a, b);
        sourceBinding.sourceEnd = Math.max(a, b);
        if (sourceBinding.sourceStart === sourceBinding.sourceEnd)
          throw new Error("定格素材的绑定字幕暂不能跨层解除复合");
      } else sourceBinding.provenance.path.splice(stageIndex - 1, 2, newId);
      operations.push({
        type: "clip.update",
        sequenceId: seq.id,
        clipId: caption.id,
        patch: { sourceBinding }
      });
    }
  operations.push({ type: "clip.remove", sequenceId, clipIds: [clipId] });
  return finish3(doc, { operations, sequenceId, clipIds: copied.map((clip3) => clip3.id) });
}

// src/editor/audio-plan.ts
var AUDIO_SAMPLE_RATE = 48e3;
var TICKS_PER_AUDIO_SAMPLE = 5;
var clamp2 = (n, low, high) => Math.max(low, Math.min(high, n));
var part = (kind, id5) => `${kind}:${encodeURIComponent(id5)}`;
var trackPath = (stage) => `${stage.sequencePath}/${part("track", stage.track.id)}`;
function rateAt(map2, tick2) {
  let lo = 0, hi = map2.points.length - 1;
  while (lo + 1 < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (map2.points[mid].time <= tick2) lo = mid;
    else hi = mid;
  }
  const a = map2.points[lo], b = map2.points[hi];
  return (b.source - a.source) / (b.time - a.time);
}
function sampleAudioLane(lane, sample2) {
  if (!Number.isSafeInteger(sample2) || sample2 < 0 || !Number.isSafeInteger(sample2 * TICKS_PER_AUDIO_SAMPLE))
    throw new TypeError("Audio sample must be a nonnegative safe integer within the tick clock");
  let time = sample2 * TICKS_PER_AUDIO_SAMPLE;
  let gain = 1, pan = 0, pitchSemitones = 0, preservePitch = true, playbackRate = 1, fadeGain = 1, local = 0;
  const ducking = [];
  for (const stage of lane.stages) {
    local = time - stage.start;
    if (local < 0 || local >= stage.duration) return null;
    const mix2 = stage.audio;
    const fade = (mix2.fadeIn ? clamp2(local / mix2.fadeIn, 0, 1) : 1) * (mix2.fadeOut ? clamp2((stage.duration - local) / mix2.fadeOut, 0, 1) : 1);
    playbackRate *= rateAt(stage.timeMap, local);
    gain = stage.track.muted || !playbackRate ? 0 : clamp2(evaluateAnimatedNumber(mix2.volume, local), 0, 4) * stage.track.volume * fade * gain;
    pan = clamp2(
      pan + stage.track.pan + clamp2(evaluateAnimatedNumber(mix2.pan, local), -1, 1),
      -1,
      1
    );
    pitchSemitones += mix2.pitchSemitones;
    preservePitch &&= mix2.preservePitch;
    fadeGain *= fade;
    if (mix2.ducking)
      ducking.push({
        ...mix2.ducking,
        sidechainTrackIds: [...mix2.ducking.sidechainTrackIds],
        sequenceId: stage.sequenceId,
        sequenceTime: time,
        trackInstanceId: trackPath(stage),
        sidechainTrackInstanceIds: mix2.ducking.sidechainTrackIds.map(
          (id5) => `${stage.sequencePath}/${part("track", id5)}`
        )
      });
    time = sourceTimeAt(stage.timeMap, local);
  }
  time += lane.sourceOffset;
  if (time < 0 || time >= lane.sourceDuration) return null;
  const leaf = lane.stages[lane.stages.length - 1];
  return {
    instanceId: lane.instanceId,
    sequenceId: leaf.sequenceId,
    clipId: leaf.clipId,
    trackId: leaf.track.id,
    trackInstanceId: trackPath(leaf),
    trackInstancePath: [...lane.trackInstancePath],
    assetId: lane.assetId,
    sourceTime: time,
    localTime: local,
    playbackRate,
    gain,
    pan,
    pitchSemitones,
    preservePitch,
    fadeGain,
    ducking,
    ...lane.angleId ? { angleId: lane.angleId } : {}
  };
}
function merge2(ranges) {
  const result = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = result[result.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else if (range.start < range.end) result.push({ ...range });
  }
  return result;
}
function toRoot(ranges, stages, before) {
  for (let index2 = before - 1; index2 >= 0; index2--) {
    const stage = stages[index2];
    ranges = merge2(
      ranges.flatMap(
        (range) => sourceRangesToTimeline(stage.timeMap, range.start, range.end).map((mapped) => ({
          start: mapped.start + stage.start,
          end: mapped.end + stage.start
        }))
      )
    );
  }
  return ranges;
}
function laneSpans(lane, duration) {
  const stages = lane.stages, leaf = stages[stages.length - 1];
  const lower = Math.max(0, -lane.sourceOffset), upper = lane.sourceDuration - lane.sourceOffset;
  if (upper <= lower) return [];
  const valid = toRoot(
    sourceRangesToTimeline(leaf.timeMap, lower, upper).map((range) => ({
      start: range.start + leaf.start,
      end: range.end + leaf.start
    })),
    stages,
    stages.length - 1
  );
  const boundaries = /* @__PURE__ */ new Set([0, Math.ceil(duration / TICKS_PER_AUDIO_SAMPLE)]);
  const add = (ranges) => {
    for (const range of ranges) {
      boundaries.add(Math.ceil(range.start / TICKS_PER_AUDIO_SAMPLE));
      boundaries.add(Math.ceil(range.end / TICKS_PER_AUDIO_SAMPLE));
    }
    if (boundaries.size > 1e6)
      throw new RangeError("Expanded audio map exceeds one million spans");
  };
  add(valid);
  for (let index2 = 0; index2 < stages.length; index2++) {
    const stage = stages[index2];
    for (let point = 0; point + 1 < stage.timeMap.points.length; point++) {
      add(
        toRoot(
          [
            {
              start: stage.start + stage.timeMap.points[point].time,
              end: stage.start + stage.timeMap.points[point + 1].time
            }
          ],
          stages,
          index2
        )
      );
    }
  }
  const sorted = [...boundaries].sort((a, b) => a - b), spans = [];
  for (let index2 = 0; index2 + 1 < sorted.length; index2++) {
    const startSample = sorted[index2], endSample = sorted[index2 + 1];
    if (startSample >= Math.ceil(duration / TICKS_PER_AUDIO_SAMPLE)) break;
    const first2 = sampleAudioLane(lane, startSample);
    if (!first2 || startSample === endSample) continue;
    const last = sampleAudioLane(lane, endSample - 1);
    if (!last || last.playbackRate !== first2.playbackRate)
      throw new Error("Audio map partition lost a timing boundary");
    spans.push({
      startSample,
      endSample,
      playbackRate: first2.playbackRate,
      sourceStart: first2.sourceTime,
      sourceLast: last.sourceTime
    });
  }
  return spans;
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function compileAudioPlan(value, sequenceId, options = {}) {
  const document = validateEditorDocument(value);
  const sequenceMap = new Map(document.sequences.map((sequence5) => [sequence5.id, sequence5]));
  const assets = new Map(document.assets.map((asset2) => [asset2.id, asset2]));
  const selected3 = sequenceMap.get(sequenceId);
  if (!selected3) throw new Error(`Unknown audio sequence: ${sequenceId}`);
  const maxLanes = options.maxLanes ?? 4096;
  if (!Number.isSafeInteger(maxLanes) || maxLanes < 1 || maxLanes > 16384)
    throw new RangeError("maxLanes must be between 1 and 16384");
  const duration = sequenceDuration(selected3);
  const plan2 = {
    sequenceId,
    duration,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: 2,
    sampleCount: Math.ceil(duration / TICKS_PER_AUDIO_SAMPLE),
    lanes: [],
    ducking: []
  };
  const requests = /* @__PURE__ */ new Map();
  let expanded2 = 0;
  let spanCount = 0;
  const walk = (sequence5, path, ancestors) => {
    for (const track3 of sequence5.tracks)
      for (const clip3 of sequence5.clips.filter((item) => item.trackId === track3.id).sort((a, b) => a.start - b.start)) {
        if (clip3.kind !== "media" && clip3.kind !== "sequence" && clip3.kind !== "multicam") continue;
        if (++expanded2 > 1e5) throw new RangeError("Expanded audio graph exceeds 100000 clips");
        const stage = {
          sequenceId: sequence5.id,
          sequencePath: path,
          clipId: clip3.id,
          start: clip3.start,
          duration: clip3.duration,
          timeMap: clip3.timeMap,
          audio: clip3.audio,
          track: { id: track3.id, volume: track3.volume, pan: track3.pan, muted: track3.muted }
        };
        const stages = [...ancestors, stage], clipPath = `${path}/${part("clip", clip3.id)}`;
        if (clip3.kind === "sequence") {
          walk(
            sequenceMap.get(clip3.sequenceId),
            `${clipPath}/${part("sequence", clip3.sequenceId)}`,
            stages
          );
          continue;
        }
        let asset2, offset = 0, angleId;
        if (clip3.kind === "multicam") {
          const angle = clip3.angles.find((item) => item.id === clip3.audioAngleId);
          asset2 = assets.get(angle.assetId);
          offset = angle.offset;
          angleId = angle.id;
        } else asset2 = assets.get(clip3.assetId);
        if (asset2.kind !== "audio" && asset2.kind !== "video") continue;
        if (plan2.lanes.length >= maxLanes)
          throw new RangeError(`Audio plan exceeds the ${maxLanes} instance capacity`);
        const duckingIds = [];
        for (const ancestor of stages)
          if (ancestor.audio.ducking) {
            const id5 = `${ancestor.sequencePath}/${part("clip", ancestor.clipId)}/ducking`;
            requests.set(id5, {
              ...ancestor.audio.ducking,
              id: id5,
              sidechainTrackInstanceIds: ancestor.audio.ducking.sidechainTrackIds.map(
                (trackId) => `${ancestor.sequencePath}/${part("track", trackId)}`
              )
            });
            duckingIds.push(id5);
          }
        const lane = {
          instanceId: `${clipPath}/audio`,
          assetId: asset2.id,
          assetKind: asset2.kind,
          sourceDuration: asset2.duration,
          sourceOffset: offset,
          stages,
          trackInstancePath: stages.map(trackPath),
          duckingIds,
          spans: [],
          ...angleId ? { angleId } : {}
        };
        lane.spans = laneSpans(lane, duration);
        spanCount += lane.spans.length;
        if (spanCount > 1e6)
          throw new RangeError("Audio plan exceeds one million expanded spans");
        plan2.lanes.push(lane);
      }
  };
  walk(selected3, part("sequence", sequenceId), []);
  plan2.ducking = [...requests.values()];
  return freeze(plan2);
}

// src/workflow.ts
var STAGES = {
  initialized: "整理需求",
  selects: "挑选素材",
  "rough-cut": "编排粗剪",
  sound: "处理声音",
  captions: "整理字幕",
  review: "成片审阅"
};
var ROLES = {
  main: "主线画面",
  broll: "补充画面",
  voice: "口播／旁白",
  music: "背景音乐",
  image: "图片",
  hold: "暂不使用"
};
function record(value, label3, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label3}必须是对象`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label3}必须是普通数据对象`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      throw new Error(`${label3}包含未知字段：${String(key)}`);
    }
  }
  return value;
}
function text2(value, max, label3) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error(`${label3}必须是非空文本，最多 ${max} 个字符`);
  }
  return value;
}
function list2(value, min, max, label3) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${label3}必须是数组，包含 ${min} 到 ${max} 项`);
  }
  return Array.from(value);
}
function frame(value, min, max, label3) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label3}必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}
function validateVideoWorkflow(value, assets) {
  const data = record(value, "制作单", [
    "stage",
    "brief",
    "outline",
    "sources",
    "nextSteps",
    "blockers"
  ]);
  if (typeof data.stage !== "string" || !Object.hasOwn(STAGES, data.stage)) {
    throw new Error("制作单阶段不受支持");
  }
  const byId2 = new Map(assets.map((asset2) => [asset2.id, asset2]));
  const sources = list2(data.sources, 0, 100, "制作单素材").map((value2) => {
    const source2 = record(value2, "制作单素材", ["assetId", "role", "note", "inFrame", "outFrame"]);
    const assetId = source2.assetId;
    if (typeof assetId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(assetId)) {
      throw new Error("制作单素材 ID 格式不正确");
    }
    const asset2 = byId2.get(assetId);
    if (!asset2) throw new Error(`制作单引用了不属于当前工程的素材：${assetId}`);
    if (typeof source2.role !== "string" || !Object.hasOwn(ROLES, source2.role)) {
      throw new Error("制作单素材用途不受支持");
    }
    const result = {
      assetId,
      role: source2.role,
      note: text2(source2.note, 800, "制作单素材说明")
    };
    const hasIn = Object.hasOwn(source2, "inFrame"), hasOut = Object.hasOwn(source2, "outFrame");
    if (hasIn !== hasOut) throw new Error("素材源范围必须同时提供入点和出点");
    if (hasIn) {
      if (!Number.isSafeInteger(asset2.durationFrames) || asset2.durationFrames < 1) {
        throw new Error("制作单素材缺少有效的真实时长");
      }
      result.inFrame = frame(source2.inFrame, 0, asset2.durationFrames - 1, "制作单素材入点");
      result.outFrame = frame(
        source2.outFrame,
        result.inFrame + 1,
        asset2.durationFrames,
        "制作单素材出点"
      );
    }
    return result;
  });
  return {
    stage: data.stage,
    brief: text2(data.brief, 2e3, "制作目标"),
    outline: text2(data.outline, 4e3, "叙事安排"),
    sources,
    nextSteps: list2(data.nextSteps, 1, 12, "后续步骤").map((value2) => text2(value2, 500, "后续步骤")),
    blockers: list2(data.blockers, 0, 12, "缺项").map((value2) => text2(value2, 500, "缺项"))
  };
}

// src/narration.ts
var approvedPhases = /* @__PURE__ */ new Set(["approved", "recorded", "aligned"]);
var idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
function identifier(value, label3) {
  if (typeof value !== "string" || !idPattern.test(value)) throw new Error(`${label3}格式不正确`);
  return value;
}
function script(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 1e4 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    throw new Error("已确认文稿必须是非空文本，最多 10000 个字符");
  return value;
}
function validateNarration(value, assets) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("口播制作状态必须是对象");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("口播制作状态必须是普通数据对象");
  const data = value;
  const allowed = [
    "phase",
    "captionBasis",
    "draftCaptionIds",
    "approvedScript",
    "approvedFingerprint",
    "alignmentFingerprint",
    "recordingAssetId",
    "fingerprintBasis"
  ];
  for (const key of Reflect.ownKeys(data))
    if (typeof key !== "string" || !allowed.includes(key))
      throw new Error(`口播制作状态包含未知字段：${String(key)}`);
  if (typeof data.phase !== "string" || !["draft", "review", "approved", "recorded", "aligned"].includes(data.phase))
    throw new Error("口播制作阶段不受支持");
  if (data.captionBasis !== "draft" && data.captionBasis !== "recording")
    throw new Error("口播字幕依据不受支持");
  if (data.captionBasis === "recording" && data.phase !== "aligned")
    throw new Error("真实录音字幕只能用于已对齐阶段");
  if (!Array.isArray(data.draftCaptionIds) || data.draftCaptionIds.length > 1e3)
    throw new Error("临时字幕 ID 必须是最多 1000 项的数组");
  const draftCaptionIds = Array.from(data.draftCaptionIds, (id5) => identifier(id5, "临时字幕 ID"));
  if (new Set(draftCaptionIds).size !== draftCaptionIds.length)
    throw new Error("临时字幕 ID 不能重复");
  const result = {
    phase: data.phase,
    captionBasis: data.captionBasis,
    draftCaptionIds
  };
  if (approvedPhases.has(result.phase)) {
    result.approvedScript = script(data.approvedScript);
    if (typeof data.approvedFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.approvedFingerprint))
      throw new Error("已确认草稿指纹必须是 SHA-256");
    result.approvedFingerprint = data.approvedFingerprint;
  } else if (Object.hasOwn(data, "approvedScript") || Object.hasOwn(data, "approvedFingerprint"))
    throw new Error("待审阅草稿不能保留已确认状态");
  if (Object.hasOwn(data, "alignmentFingerprint")) {
    if (!["recorded", "aligned"].includes(result.phase) || typeof data.alignmentFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.alignmentFingerprint))
      throw new Error("对齐工作指纹仅用于已录音或已对齐阶段，且必须是 SHA-256");
    result.alignmentFingerprint = data.alignmentFingerprint;
  }
  if (Object.hasOwn(data, "recordingAssetId")) {
    const id5 = identifier(data.recordingAssetId, "本人录音素材 ID");
    const asset2 = assets.find((item) => item.id === id5);
    if (!asset2 || asset2.kind !== "audio" && asset2.kind !== "video")
      throw new Error("本人录音必须引用当前工程的音频或视频素材");
    result.recordingAssetId = id5;
  }
  if (["recorded", "aligned"].includes(result.phase) && !result.recordingAssetId)
    throw new Error("此阶段需要已保存的本人录音素材");
  if (Object.hasOwn(data, "fingerprintBasis")) {
    if (data.fingerprintBasis !== "editor") throw new Error("口播确认指纹依据不受支持");
    result.fingerprintBasis = "editor";
  }
  return result;
}

// src/rough-cut.ts
var MAX_ROUGH_CUTS = 1e3;
var MAX_FRAMES = 24 * 60 * 60 * 30;
var IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
function source(assets, assetId, assetsById) {
  if (typeof assetId !== "string" || !IDENTIFIER.test(assetId))
    throw new Error("粗剪素材 ID 格式不正确");
  const asset2 = assetsById ? assetsById.get(assetId) : assets.find((item) => item.id === assetId);
  if (!asset2 || !["video", "audio"].includes(asset2.kind))
    throw new Error("粗剪只能引用当前工程的视频或音频素材");
  if (!Number.isSafeInteger(asset2.durationFrames) || asset2.durationFrames <= 0 || asset2.durationFrames > MAX_FRAMES)
    throw new Error("粗剪素材时长无效");
  return asset2;
}
function sourceRange(asset2, inFrame, outFrame) {
  if (typeof inFrame !== "number" || typeof outFrame !== "number" || !Number.isSafeInteger(inFrame) || !Number.isSafeInteger(outFrame) || inFrame < 0 || outFrame <= inFrame || outFrame > asset2.durationFrames)
    throw new Error("粗剪范围须为源素材内有效的整数帧，入点须早于出点");
}
function validateRoughCuts(value, assets) {
  if (!Array.isArray(value) || value.length > MAX_ROUGH_CUTS)
    throw new Error(`粗剪片段必须是数组，最多 ${MAX_ROUGH_CUTS} 项`);
  const used = /* @__PURE__ */ new Set();
  const assetsById = new Map(assets.map((asset2) => [asset2.id, asset2]));
  return Array.from(value, (item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      throw new Error("粗剪片段须为普通数据对象");
    const cut = item;
    for (const key of Object.keys(cut))
      if (!["id", "assetId", "inFrame", "outFrame", "name", "enabled"].includes(key))
        throw new Error(`粗剪片段包含未知字段：${key}`);
    if (typeof cut.id !== "string" || !IDENTIFIER.test(cut.id))
      throw new Error("粗剪片段 ID 格式不正确");
    if (used.has(cut.id)) throw new Error(`粗剪片段 ID 重复：${cut.id}`);
    used.add(cut.id);
    const asset2 = source(assets, cut.assetId, assetsById);
    sourceRange(asset2, cut.inFrame, cut.outFrame);
    if (typeof cut.name !== "string" || cut.name.length > 200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(cut.name))
      throw new Error("粗剪片段名称须为文本，最多 200 个字符");
    if (typeof cut.enabled !== "boolean") throw new Error("粗剪片段启用状态须为布尔值");
    return {
      id: cut.id,
      assetId: asset2.id,
      inFrame: cut.inFrame,
      outFrame: cut.outFrame,
      name: cut.name,
      enabled: cut.enabled
    };
  });
}

// src/model.ts
var FPS = 30;
var MAX_FRAMES2 = 24 * 60 * 60 * FPS;
var MAX_ASSETS = 1e3;
var MAX_CLIPS = 2e3;
var MAX_AUDIO_CLIPS = 64;
var MAX_CAPTIONS = 1e4;
var MAX_CAPTION_TEXT = 4e3;
function record2(value, label3) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label3}必须是对象`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label3}必须是普通数据对象`);
  }
  return value;
}
function keys(value, allowed, label3) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label3}包含未知字段：${key}`);
  }
}
function integer3(value, min, max, label3) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label3}必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}
function text3(value, max, label3, multiline = false) {
  if (typeof value !== "string" || !value.trim() || value.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/ : /[\u0000-\u001f]/).test(value)) {
    throw new Error(`${label3}必须是非空文本，最多 ${max} 个字符`);
  }
  return value;
}
function identifier2(value, label3) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label3}格式不正确`);
  }
  return value;
}
function captionStyle(value) {
  if (value !== "classic" && value !== "bold" && value !== "minimal")
    throw new Error("字幕样式须为 classic、bold 或 minimal");
  return value;
}
function list3(value, max, label3) {
  if (!Array.isArray(value) || value.length > max) {
    throw new Error(`${label3}必须是数组，最多 ${max} 项`);
  }
  return Array.from(value);
}
function uniqueIds(items, label3) {
  const seen = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`${label3} ID 重复：${item.id}`);
    seen.add(item.id);
  }
}
function volume(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error("音量必须是 0 到 2 之间的数值");
  }
  return value;
}
function mediaId(value) {
  if (!isResourceId(value)) {
    throw new Error("持久素材 ID 格式不正确");
  }
  return value;
}
function readScene(value) {
  const data = record2(value, "场景");
  keys(data, ["kind", "sourceHash", "params"], "场景");
  if (data.kind !== "hyperframes") throw new Error("不支持此场景类型");
  if (typeof data.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(data.sourceHash)) {
    throw new Error("场景源码摘要格式不正确");
  }
  let remaining = 4096;
  function copyJson(value2, depth) {
    if (--remaining < 0 || depth > 12) throw new Error("场景参数过多或嵌套过深");
    if (value2 === null || typeof value2 === "boolean") return value2;
    if (typeof value2 === "number" && Number.isFinite(value2)) return value2;
    if (typeof value2 === "string" && value2.length <= 65536) return value2;
    if (Array.isArray(value2))
      return list3(value2, 4096, "场景参数").map((item) => copyJson(item, depth + 1));
    const input = record2(value2, "场景参数");
    const result = {};
    for (const [key, item] of Object.entries(input)) {
      if (["__proto__", "constructor", "prototype"].includes(key) || key.length > 240) {
        throw new Error("场景参数字段不受支持");
      }
      result[key] = copyJson(item, depth + 1);
    }
    return result;
  }
  const params = copyJson(record2(data.params, "场景参数"), 0);
  if (new TextEncoder().encode(JSON.stringify(params)).byteLength > 65536) {
    throw new Error("场景参数最多 64 KiB");
  }
  return { kind: "hyperframes", sourceHash: data.sourceHash, params };
}
function readAsset(value) {
  const data = record2(value, "素材");
  keys(
    data,
    [
      "id",
      "name",
      "kind",
      "durationFrames",
      "width",
      "height",
      "size",
      "lastModified",
      "sourcePath",
      "mimeType",
      "mediaId",
      "proxyId",
      "thumbnailId",
      "scene",
      "speech"
    ],
    "素材"
  );
  if (!["video", "audio", "image", "demo"].includes(data.kind)) {
    throw new Error("素材类型不受支持");
  }
  const asset2 = {
    id: identifier2(data.id, "素材 ID"),
    name: text3(data.name, 240, "素材名称"),
    kind: data.kind,
    durationFrames: integer3(data.durationFrames, 1, MAX_FRAMES2, "素材时长")
  };
  if (data.width !== void 0) asset2.width = integer3(data.width, 1, 16384, "素材宽度");
  if (data.height !== void 0) asset2.height = integer3(data.height, 1, 16384, "素材高度");
  if (data.size !== void 0)
    asset2.size = integer3(data.size, 0, Number.MAX_SAFE_INTEGER, "素材大小");
  if (data.lastModified !== void 0) {
    asset2.lastModified = integer3(data.lastModified, 0, Number.MAX_SAFE_INTEGER, "素材修改时间");
  }
  if (data.sourcePath !== void 0) {
    const path = text3(data.sourcePath, 1024, "素材相对路径");
    if (/[\\:\x00-\x1f\x7f]/.test(path) || path.startsWith("/") || path.split("/").some((part2) => !part2 || part2 === "." || part2 === ".."))
      throw new Error("素材相对路径无效");
    asset2.sourcePath = path;
  }
  if (data.mimeType !== void 0) asset2.mimeType = text3(data.mimeType, 128, "素材 MIME 类型");
  if (data.mediaId !== void 0) asset2.mediaId = mediaId(data.mediaId);
  if (data.proxyId !== void 0) asset2.proxyId = mediaId(data.proxyId);
  if (data.thumbnailId !== void 0) asset2.thumbnailId = mediaId(data.thumbnailId);
  if (data.scene !== void 0) asset2.scene = readScene(data.scene);
  if (data.speech !== void 0) {
    const speech = record2(data.speech, "配音");
    keys(
      speech,
      [
        "text",
        "voiceId",
        "engine",
        "modelId",
        "instructions",
        "referenceAssetId",
        "referenceText",
        "rate"
      ],
      "配音"
    );
    if (asset2.kind !== "audio") throw new Error("配音来源必须是音频素材");
    if (speech.referenceAssetId !== void 0 !== (speech.referenceText !== void 0))
      throw new Error("配音参考录音和逐字稿必须同时提供");
    if (speech.referenceText !== void 0 && (typeof speech.referenceText !== "string" || !speech.referenceText.trim() || Array.from(speech.referenceText).length > 1e3))
      throw new Error("配音参考录音逐字稿须为 1 至 1000 个字符");
    if (typeof speech.rate !== "number" || !Number.isFinite(speech.rate) || speech.rate < 0.5 || speech.rate > 2)
      throw new Error("配音速度必须在 0.5 到 2 之间");
    asset2.speech = {
      text: text3(speech.text, 1e4, "配音文稿", true),
      voiceId: text3(speech.voiceId, 256, "配音音色"),
      engine: text3(speech.engine, 128, "配音引擎"),
      ...speech.modelId !== void 0 ? { modelId: text3(speech.modelId, 256, "配音模型") } : {},
      ...speech.instructions !== void 0 ? { instructions: text3(speech.instructions, 2e3, "配音风格", true) } : {},
      ...speech.referenceAssetId !== void 0 ? {
        referenceAssetId: mediaId(speech.referenceAssetId),
        referenceText: text3(speech.referenceText, 2e3, "配音参考录音逐字稿", true)
      } : {},
      rate: speech.rate
    };
  }
  return asset2;
}
function readClip(value, assets) {
  const data = record2(value, "片段");
  keys(data, ["id", "assetId", "inFrame", "outFrame", "volume", "startFrame"], "片段");
  const assetId = identifier2(data.assetId, "片段素材 ID");
  const asset2 = assets.get(assetId);
  if (!asset2) throw new Error(`片段引用了不存在的素材：${assetId}`);
  const inFrame = integer3(data.inFrame, 0, asset2.durationFrames - 1, "片段入点");
  const outFrame = integer3(data.outFrame, inFrame + 1, asset2.durationFrames, "片段出点");
  return {
    id: identifier2(data.id, "片段 ID"),
    assetId,
    inFrame,
    outFrame,
    volume: volume(data.volume),
    ...data.startFrame !== void 0 ? { startFrame: integer3(data.startFrame, 0, MAX_FRAMES2 - outFrame + inFrame, "片段开始时间") } : {}
  };
}
function readCaption(value, duration) {
  const data = record2(value, "字幕");
  keys(data, ["id", "startFrame", "endFrame", "text"], "字幕");
  const startFrame = integer3(data.startFrame, 0, Math.max(0, duration - 1), "字幕开始时间");
  return {
    id: identifier2(data.id, "字幕 ID"),
    startFrame,
    endFrame: integer3(data.endFrame, startFrame + 1, duration, "字幕结束时间"),
    text: text3(data.text, MAX_CAPTION_TEXT, "字幕内容", true).replace(/\r\n?/g, "\n")
  };
}
function readAudioClip(value, assets, duration) {
  const data = record2(value, "音频片段");
  keys(data, ["id", "assetId", "inFrame", "outFrame", "volume", "startFrame"], "音频片段");
  const { startFrame, ...clipData } = data;
  const clip3 = readClip(clipData, assets);
  if (!["audio", "video"].includes(assets.get(clip3.assetId).kind)) {
    throw new Error("音轨只能引用音频或视频素材");
  }
  return {
    ...clip3,
    startFrame: integer3(startFrame, 0, duration - (clip3.outFrame - clip3.inFrame), "音轨开始时间")
  };
}
function validateProject(value) {
  const data = record2(value, "工程");
  keys(
    data,
    [
      "schemaVersion",
      "id",
      "name",
      "revision",
      "width",
      "height",
      "fps",
      "assets",
      "clips",
      "timelineMode",
      "audioClips",
      "captions",
      "captionStyle",
      "script",
      "workflow",
      "narration",
      "roughCuts"
    ],
    "工程"
  );
  if (data.schemaVersion !== 1) throw new Error("不支持此工程版本");
  if (data.fps !== FPS) throw new Error("当前版本只支持 30 fps 工程");
  if (data.timelineMode !== void 0 && data.timelineMode !== "magnetic" && data.timelineMode !== "free")
    throw new Error("时间轴模式须为 magnetic 或 free");
  const timelineMode = data.timelineMode;
  const assets = list3(data.assets, MAX_ASSETS, "素材列表").map(readAsset);
  uniqueIds(assets, "素材");
  const assetsById = new Map(assets.map((asset2) => [asset2.id, asset2]));
  const clips = list3(data.clips, MAX_CLIPS, "片段列表").map((clip3) => readClip(clip3, assetsById));
  uniqueIds(clips, "片段");
  if (timelineMode === "free") {
    let cursor = 0;
    for (const clip3 of clips) {
      clip3.startFrame ??= cursor;
      cursor = clip3.startFrame + clip3.outFrame - clip3.inFrame;
    }
    clips.sort((a, b) => a.startFrame - b.startFrame);
    let end = 0;
    for (const clip3 of clips) {
      if (clip3.startFrame < end) throw new Error("同一画面轨的片段不能重叠，请移到空余位置");
      end = clip3.startFrame + clip3.outFrame - clip3.inFrame;
    }
  } else if (clips.some((clip3) => clip3.startFrame !== void 0)) {
    throw new Error("磁性时间轴不能指定片段开始时间，请先关闭主序列磁性");
  }
  const duration = integer3(
    timelineDuration({ clips, timelineMode }),
    0,
    MAX_FRAMES2,
    "时间线总时长"
  );
  const audioClips = list3(
    data.audioClips === void 0 ? [] : data.audioClips,
    MAX_AUDIO_CLIPS,
    "音轨列表"
  ).map((clip3) => readAudioClip(clip3, assetsById, duration));
  uniqueIds(audioClips, "音轨");
  const captions = list3(data.captions, MAX_CAPTIONS, "字幕列表").map(
    (caption) => readCaption(caption, duration)
  );
  uniqueIds(captions, "字幕");
  captions.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  return {
    schemaVersion: 1,
    id: identifier2(data.id, "工程 ID"),
    name: text3(data.name, 200, "工程名称"),
    revision: integer3(data.revision, 0, Number.MAX_SAFE_INTEGER - 1, "工程修订号"),
    width: integer3(data.width, 16, 8192, "画面宽度"),
    height: integer3(data.height, 16, 8192, "画面高度"),
    fps: FPS,
    ...data.script !== void 0 ? { script: text3(data.script, 1e4, "口播文稿", true) } : {},
    assets,
    clips,
    ...timelineMode !== void 0 ? { timelineMode } : {},
    audioClips,
    captions,
    ...data.captionStyle !== void 0 ? { captionStyle: captionStyle(data.captionStyle) } : {},
    ...data.workflow !== void 0 ? { workflow: validateVideoWorkflow(data.workflow, assets) } : {},
    ...data.narration !== void 0 ? { narration: validateNarration(data.narration, assets) } : {},
    ...data.roughCuts !== void 0 ? { roughCuts: validateRoughCuts(data.roughCuts, assets) } : {}
  };
}
function timelineDuration(project) {
  let cursor = 0;
  let duration = 0;
  for (const clip3 of project.clips) {
    const start = project.timelineMode === "free" ? clip3.startFrame ?? cursor : cursor;
    cursor = start + clip3.outFrame - clip3.inFrame;
    duration = Math.max(duration, cursor);
  }
  return duration;
}
function timelineClips(project) {
  let cursor = 0;
  const result = project.clips.map((clip3) => {
    const startFrame = project.timelineMode === "free" ? clip3.startFrame ?? cursor : cursor;
    cursor = startFrame + clip3.outFrame - clip3.inFrame;
    return { ...clip3, startFrame, endFrame: cursor };
  });
  return project.timelineMode === "free" ? result.sort((a, b) => a.startFrame - b.startFrame) : result;
}

// src/editor/legacy-multitrack-migration.ts
var LEGACY_MAIN_VIDEO_TRACK = "video-main";
var MAIN_AUDIO = "audio-main";
var MAX_FRAMES3 = 24 * 60 * 60 * 30;
function record3(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("旧工程字段须为对象");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("旧工程字段须为普通对象");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor))
      throw new Error("旧工程不能包含访问器或非 JSON 字段");
  }
  return value;
}
function keys2(value, allowed) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`旧工程包含未知字段：${key}`);
}
function list4(value, max) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`旧工程列表最多 ${max} 项`);
  return Array.from(value);
}
function number2(value, min, max, integer5 = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || integer5 && !Number.isSafeInteger(value))
    throw new Error(`旧工程数值须在 ${min} 到 ${max} 之间${integer5 ? "且为整数" : ""}`);
  return value;
}
function id3(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value))
    throw new Error("旧工程 ID 无效");
  return value;
}
function text4(value, max, multiline = false) {
  if (typeof value !== "string" || !value.trim() || value.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/ : /[\u0000-\u001f]/).test(value))
    throw new Error("旧工程文本无效");
  return value;
}
function unique2(values) {
  if (new Set(values.map((value) => value.id)).size !== values.length)
    throw new Error("旧工程 ID 重复");
}
function readTrack(value) {
  const data = record3(value);
  keys2(data, ["id", "kind", "name", "muted", "hidden", "locked"]);
  if (data.kind !== "video" && data.kind !== "audio") throw new Error("旧工程轨道类型无效");
  const track3 = {
    id: id3(data.id),
    kind: data.kind,
    name: text4(data.name, 80)
  };
  if (track3.id === LEGACY_MAIN_VIDEO_TRACK && track3.kind !== "video" || track3.id === MAIN_AUDIO && track3.kind !== "audio")
    throw new Error("旧工程主轨道类型不一致");
  for (const field of ["muted", "hidden", "locked"])
    if (data[field] !== void 0) {
      if (typeof data[field] !== "boolean") throw new Error("旧工程轨道状态须为布尔值");
      track3[field] = data[field];
    }
  return track3;
}
function readClip2(value, assets, audio2) {
  const data = record3(value);
  keys2(data, [
    "id",
    "assetId",
    "inFrame",
    "outFrame",
    "volume",
    "startFrame",
    "trackId",
    ...audio2 ? [] : ["transform"]
  ]);
  const assetId = id3(data.assetId), asset2 = assets.get(assetId);
  if (!asset2) throw new Error("旧工程片段引用不存在的素材");
  if (audio2 ? !["audio", "video"].includes(asset2.kind) : asset2.kind === "audio")
    throw new Error("旧工程片段与轨道类型不一致");
  const inFrame = number2(data.inFrame, 0, asset2.durationFrames - 1, true), outFrame = number2(data.outFrame, inFrame + 1, asset2.durationFrames, true);
  const result = {
    id: id3(data.id),
    assetId,
    inFrame,
    outFrame,
    volume: number2(data.volume, 0, 2),
    ...data.trackId !== void 0 ? { trackId: id3(data.trackId) } : {},
    ...audio2 || data.startFrame !== void 0 ? { startFrame: number2(data.startFrame, 0, MAX_FRAMES3 - outFrame + inFrame, true) } : {}
  };
  if (data.transform !== void 0) {
    const transform2 = record3(data.transform);
    keys2(transform2, ["x", "y", "scale", "opacity"]);
    result.transform = {
      x: number2(transform2.x, -2, 2),
      y: number2(transform2.y, -2, 2),
      scale: number2(transform2.scale, 0.05, 4),
      opacity: number2(transform2.opacity, 0, 1)
    };
  }
  return result;
}
function readLegacyMultitrackProject(value) {
  const data = record3(value);
  const {
    tracks: rawTracks,
    clips: rawClips,
    audioClips: rawAudio,
    captions: rawCaptions,
    ...common
  } = data;
  const project = validateProject({ ...common, clips: [], audioClips: [], captions: [] });
  const declared = rawTracks === void 0 ? [] : list4(rawTracks, 24).map(readTrack);
  unique2(declared);
  const tracks = ["video", "audio"].flatMap((kind) => {
    const group = declared.filter((track3) => track3.kind === kind);
    const main = kind === "video" ? LEGACY_MAIN_VIDEO_TRACK : MAIN_AUDIO;
    if (!group.some((track3) => track3.id === main))
      group.unshift({ id: main, kind, name: kind === "video" ? "主画面" : "音频 1" });
    if (group.length > (kind === "video" ? 8 : 16)) throw new Error("旧工程轨道数量超过范围");
    return group;
  });
  const assets = new Map(project.assets.map((asset2) => [asset2.id, asset2]));
  const pictures = list4(rawClips, 2e3).map((clip3) => readClip2(clip3, assets, false));
  const audio2 = list4(rawAudio === void 0 ? [] : rawAudio, 64).map(
    (clip3) => readClip2(clip3, assets, true)
  );
  unique2([...pictures, ...audio2]);
  const assignments = /* @__PURE__ */ new Map(), ends = [];
  if (rawTracks === void 0)
    for (const clip3 of [...audio2].sort((a, b) => a.startFrame - b.startFrame)) {
      let lane = ends.findIndex((end) => end <= clip3.startFrame);
      if (lane < 0) lane = ends.length;
      ends[lane] = clip3.startFrame + clip3.outFrame - clip3.inFrame;
      const trackId = lane ? `audio-auto-${lane + 1}` : MAIN_AUDIO;
      assignments.set(clip3.id, trackId);
      if (!tracks.some((track3) => track3.id === trackId))
        tracks.push({ id: trackId, kind: "audio", name: `音频 ${lane + 1}` });
    }
  const cursors = /* @__PURE__ */ new Map();
  const clips = pictures.map((clip3) => {
    const trackId = clip3.trackId ?? LEGACY_MAIN_VIDEO_TRACK;
    if (!tracks.some((track3) => track3.id === trackId && track3.kind === "video"))
      throw new Error("旧工程画面轨不存在");
    const magnetic = project.timelineMode !== "free" && trackId === LEGACY_MAIN_VIDEO_TRACK;
    if (magnetic && clip3.startFrame !== void 0) throw new Error("磁性主轨不能指定开始时间");
    if (trackId !== LEGACY_MAIN_VIDEO_TRACK && clip3.startFrame === void 0)
      throw new Error("叠加轨须明确开始时间");
    const startFrame = clip3.startFrame ?? cursors.get(trackId) ?? 0;
    cursors.set(trackId, startFrame + clip3.outFrame - clip3.inFrame);
    return { ...clip3, trackId, startFrame };
  }).sort((a, b) => a.startFrame - b.startFrame);
  const audioClips = audio2.map((clip3) => {
    const trackId = clip3.trackId ?? (rawTracks === void 0 ? assignments.get(clip3.id) : MAIN_AUDIO);
    if (!tracks.some((track3) => track3.id === trackId && track3.kind === "audio"))
      throw new Error("旧工程音频轨不存在");
    return { ...clip3, trackId, startFrame: clip3.startFrame };
  });
  const laneEnds = /* @__PURE__ */ new Map();
  for (const clip3 of [...clips, ...audioClips].sort((a, b) => a.startFrame - b.startFrame)) {
    if (clip3.startFrame < (laneEnds.get(clip3.trackId) ?? 0))
      throw new Error("旧工程同一轨道片段不能重叠");
    laneEnds.set(clip3.trackId, clip3.startFrame + clip3.outFrame - clip3.inFrame);
  }
  const duration = number2(Math.max(0, ...laneEnds.values()), 0, MAX_FRAMES3, true);
  const captions = list4(rawCaptions, 1e4).map((value2) => {
    const caption = record3(value2);
    keys2(caption, ["id", "startFrame", "endFrame", "text"]);
    const startFrame = number2(caption.startFrame, 0, Math.max(0, duration - 1), true);
    return {
      id: id3(caption.id),
      startFrame,
      endFrame: number2(caption.endFrame, startFrame + 1, duration, true),
      text: text4(caption.text, 4e3, true).replace(/\r\n?/g, "\n")
    };
  }).sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  unique2(captions);
  return { ...project, tracks, clips, audioClips, captions };
}
function hasLegacyMultitrackFields(value) {
  const data = record3(value);
  return Object.hasOwn(data, "tracks") || [data.clips, data.audioClips].some(
    (values) => Array.isArray(values) && values.some((value2) => {
      const clip3 = record3(value2);
      return Object.hasOwn(clip3, "trackId") || Object.hasOwn(clip3, "transform");
    })
  );
}

// src/editor/migration.ts
var LEGACY_RATE = { numerator: 30, denominator: 1 };
var ticks = (frame2) => frameToTicks(frame2, LEGACY_RATE);
function migrateAsset(asset2) {
  const { id: id5, name, kind, durationFrames, width, height, mediaId: mediaId2, ...metadata } = asset2;
  return {
    id: id5,
    name,
    kind,
    duration: ticks(durationFrames),
    ...width !== void 0 ? { width } : {},
    ...height !== void 0 ? { height } : {},
    ...mediaId2 !== void 0 ? { resourceId: mediaId2 } : {},
    ...Object.keys(metadata).length ? { metadata: structuredClone(metadata) } : {}
  };
}
function migrateMedia(clip3, trackId, label3) {
  const duration = ticks(clip3.outFrame - clip3.inFrame);
  return {
    kind: "media",
    id: clip3.id,
    label: label3,
    trackId,
    assetId: clip3.assetId,
    start: ticks(clip3.startFrame),
    duration,
    timeMap: {
      points: [
        { time: 0, source: ticks(clip3.inFrame) },
        { time: duration, source: ticks(clip3.outFrame) }
      ]
    },
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    audio: { ...defaultAudioMix(), volume: clip3.volume }
  };
}
function migrateCaptions(project, trackId) {
  const preset2 = project.captionStyle ?? "classic";
  const fontSize = Math.round(Math.min(project.width * 0.035, project.height * 0.05));
  return project.captions.map((caption) => ({
    kind: "text",
    role: "subtitle",
    id: caption.id,
    trackId,
    label: caption.text.replace(/\s+/g, " ").trim().slice(0, 80) || "字幕",
    text: caption.text,
    start: ticks(caption.startFrame),
    duration: ticks(caption.endFrame - caption.startFrame),
    words: [],
    transform: { ...defaultTransform(), y: 0.4 },
    color: defaultColorAdjustment(),
    blendMode: "normal",
    style: {
      ...defaultTextStyle(),
      layout: "caption-stack",
      fontFamily: "system-ui",
      fontSize,
      fontWeight: preset2 === "bold" ? 800 : preset2 === "minimal" ? 500 : 600,
      color: preset2 === "bold" ? "#ffe46b" : "#ffffff",
      strokeColor: "#101010",
      strokeWidth: preset2 === "bold" ? Math.max(2, fontSize * 0.12) : 0,
      background: preset2 === "classic" ? "#050909b8" : "#00000000",
      backgroundRadius: 8,
      padding: fontSize * 0.5,
      align: "center",
      lineHeight: 1.4,
      maxWidth: 0.85,
      shadow: preset2 === "minimal" ? {
        color: "#000000bb",
        blur: Math.max(2, fontSize * 0.08),
        x: 0,
        y: Math.max(1, fontSize * 0.04)
      } : { color: "#00000000", blur: 0, x: 0, y: 0 }
    }
  }));
}
function migrateLegacyProject(value) {
  let multitrack;
  let project;
  if (hasLegacyMultitrackFields(value)) project = multitrack = readLegacyMultitrackProject(value);
  else {
    try {
      project = validateProject(value);
    } catch (originalError) {
      try {
        project = multitrack = readLegacyMultitrackProject(value);
      } catch {
        throw originalError;
      }
    }
  }
  const assets = project.assets.map(migrateAsset);
  const names = new Map(assets.map((asset2) => [asset2.id, asset2.name]));
  const primaryTrack = createTrack("track-video-main", "video", "主画面");
  const primaryAudioTrack = createTrack("track-audio-main", "audio", "主序列声音");
  let textTrackId = "track-captions";
  while (multitrack?.tracks.some((track3) => track3.id === textTrackId)) textTrackId += "-text";
  const textTrack = createTrack(textTrackId, "text", "字幕");
  const hasPrimaryAudio = project.clips.some(
    (clip3) => assets.find((asset2) => asset2.id === clip3.assetId)?.kind === "audio"
  );
  const audioTracks = (project.audioClips ?? []).map(
    (clip3, index2) => createTrack(`track-audio-${index2 + 1}`, "audio", names.get(clip3.assetId) ?? "音频")
  );
  const sequence5 = {
    id: "sequence-main",
    name: project.name,
    width: project.width,
    height: project.height,
    frameRate: LEGACY_RATE,
    background: "#000000",
    timelineMode: project.timelineMode ?? "magnetic",
    ...multitrack ? { magneticTrackId: LEGACY_MAIN_VIDEO_TRACK } : {},
    tracks: multitrack ? [
      ...multitrack.tracks.map((track3) => ({
        ...createTrack(track3.id, track3.kind, track3.name),
        ...track3
      })),
      textTrack
    ] : [primaryTrack, ...hasPrimaryAudio ? [primaryAudioTrack] : [], ...audioTracks, textTrack],
    clips: [
      ...multitrack ? multitrack.clips.map((clip3) => ({
        ...migrateMedia(clip3, clip3.trackId, names.get(clip3.assetId) ?? "画面"),
        ...clip3.transform ? {
          transform: {
            ...defaultTransform(),
            x: clip3.transform.x,
            y: clip3.transform.y,
            scaleX: clip3.transform.scale,
            scaleY: clip3.transform.scale,
            opacity: clip3.transform.opacity
          }
        } : {}
      })) : timelineClips(project).map(
        (clip3) => migrateMedia(
          clip3,
          assets.find((asset2) => asset2.id === clip3.assetId)?.kind === "audio" ? primaryAudioTrack.id : primaryTrack.id,
          names.get(clip3.assetId) ?? "画面"
        )
      ),
      ...(project.audioClips ?? []).map(
        (clip3, index2) => migrateMedia(
          clip3,
          multitrack?.audioClips[index2].trackId ?? audioTracks[index2].id,
          names.get(clip3.assetId) ?? "音频"
        )
      ),
      ...migrateCaptions(project, textTrack.id)
    ],
    transitions: [],
    markers: []
  };
  const used = /* @__PURE__ */ new Set();
  const remapped = [];
  for (const clip3 of sequence5.clips) {
    const original = clip3.id;
    let suffix = 0;
    while (used.has(clip3.id)) clip3.id = `${original.slice(0, 100)}-migrated-${++suffix}`;
    if (clip3.id !== original) remapped.push({ original, id: clip3.id, trackId: clip3.trackId });
    used.add(clip3.id);
  }
  const production = {};
  for (const key of ["script", "workflow", "narration", "roughCuts"]) {
    if (project[key] !== void 0) production[key] = structuredClone(project[key]);
  }
  production.migration = { from: 1, revision: project.revision, sourceTimebase: 30, remapped };
  if (multitrack)
    production.migration = {
      ...production.migration,
      sourceFormat: "0.5.16",
      magneticTrackId: LEGACY_MAIN_VIDEO_TRACK
    };
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: TICKS_PER_SECOND,
    id: project.id,
    name: project.name,
    revision: project.revision,
    assets,
    sequences: [sequence5],
    activeSequenceId: sequence5.id,
    exportProfiles: createExportPresets(),
    production
  });
}

// src/editor/lookup.ts
var isSubtitleClip = (clip3) => clip3.kind === "text" && clip3.role === "subtitle";

// src/editor/caption-presets.ts
var CAPTION_PRESETS = [
  { value: "classic", label: "经典 · 黑底白字" },
  { value: "bold", label: "醒目 · 黄字描边" },
  { value: "minimal", label: "简洁 · 白字无框" }
];
var sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function preset(value) {
  if (!CAPTION_PRESETS.some((item) => item.value === value)) throw new Error("字幕样式无效");
  return value;
}
var templates = /* @__PURE__ */ new Map();
function captionTemplate(project) {
  const key = `${project.width}:${project.height}:${project.captionStyle ?? "classic"}`;
  const cached = templates.get(key);
  if (cached) return structuredClone(cached);
  const document = migrateLegacyProject({
    schemaVersion: 1,
    id: "legacy-caption-template",
    name: "字幕",
    revision: 0,
    fps: 30,
    width: project.width,
    height: project.height,
    captionStyle: project.captionStyle ?? "classic",
    assets: [{ id: "template-source", name: "字幕画布", kind: "demo", durationFrames: 1 }],
    clips: [
      { id: "template-picture", assetId: "template-source", inFrame: 0, outFrame: 1, volume: 1 }
    ],
    captions: [{ id: "template-text", text: "字幕", startFrame: 0, endFrame: 1 }]
  });
  const result = document.sequences[0].clips.find((clip3) => clip3.kind === "text");
  if (templates.size >= 24) templates.clear();
  templates.set(key, result);
  return structuredClone(result);
}
function captionPresetStyle(sequence5, value) {
  return captionTemplate({
    width: sequence5.width,
    height: sequence5.height,
    captionStyle: preset(value)
  }).style;
}
function presetFor(clip3, style) {
  const next = { ...structuredClone(style), animation: clip3.style.animation };
  if (clip3.style.keywords) next.keywords = structuredClone(clip3.style.keywords);
  return next;
}
function currentCaptionPreset(sequence5, clips) {
  if (!clips.length) return void 0;
  return CAPTION_PRESETS.map((item) => item.value).find((value) => {
    const style = captionPresetStyle(sequence5, value);
    return clips.every((clip3) => sameJson(clip3.style, presetFor(clip3, style)));
  });
}
function planCaptionPreset(value, sequenceId, chosen) {
  const doc = validateEditorDocument(value), selected3 = preset(chosen), sequence5 = doc.sequences.find((item) => item.id === sequenceId);
  if (!sequence5) throw new Error("字幕时间线不存在");
  const clips = sequence5.clips.filter(
    isSubtitleClip
  );
  if (clips.some((clip3) => sequence5.tracks.find((track3) => track3.id === clip3.trackId)?.locked))
    throw new Error("字幕轨已锁定，请先解锁后再套用样式");
  const style = captionPresetStyle(sequence5, selected3);
  const operations = clips.filter((clip3) => !sameJson(clip3.style, presetFor(clip3, style))).map((clip3) => ({
    type: "clip.update",
    sequenceId,
    clipId: clip3.id,
    patch: { style: presetFor(clip3, style) }
  }));
  if (doc.production?.legacyCaptionStyle !== selected3)
    operations.push({
      type: "project.production",
      data: { ...structuredClone(doc.production ?? {}), legacyCaptionStyle: selected3 }
    });
  applyEditorOperations(doc, operations, doc.revision);
  return operations;
}

// src/editor/captions.ts
var MAX_RANGES = 1e5;
var MAX_CAPTIONS2 = 2e3;
var uniqueId = () => randomId();
function sequence4(doc, id5) {
  const result = doc.sequences.find((item) => item.id === id5);
  if (!result) throw new Error("字幕时间线不存在");
  return result;
}
function merge3(ranges) {
  if (ranges.length > MAX_RANGES) throw new Error("字幕映射范围过多，请拆分序列后生成");
  const result = [];
  for (const item of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (item.start >= item.end) continue;
    const last = result.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else result.push({ ...item });
  }
  return result;
}
function intersect(a, b) {
  const result = [];
  let j = 0;
  for (const x of a) {
    while (j < b.length && b[j].end <= x.start) j++;
    for (let i = j; i < b.length && b[i].start < x.end; i++) {
      const y = b[i], start = Math.max(x.start, y.start), end = Math.min(x.end, y.end);
      if (start < end) result.push({ start, end });
    }
  }
  return merge3(result);
}
function toRoot2(ranges, stages, before) {
  for (let index2 = before - 1; index2 >= 0; index2--) {
    const stage = stages[index2];
    ranges = merge3(
      ranges.flatMap(
        (range) => sourceRangesToTimeline(stage.timeMap, range.start, range.end).map((item) => ({
          start: item.start + stage.start,
          end: item.end + stage.start
        }))
      )
    );
  }
  return ranges;
}
function first(start, end, test) {
  while (start < end) {
    const middle = start + Math.floor((end - start) / 2);
    if (test(middle)) end = middle;
    else start = middle + 1;
  }
  return start;
}
function positive(value, duration) {
  if (typeof value === "number") return value > 0 ? [{ start: 0, end: duration }] : [];
  const boundaries = /* @__PURE__ */ new Set([0, duration]);
  const add = (time) => {
    for (const t of [Math.floor(time) - 1, Math.floor(time), Math.ceil(time), Math.ceil(time) + 1])
      if (t >= 0 && t <= duration) boundaries.add(t);
  };
  const keys3 = value.keyframes;
  for (let index2 = 0; index2 < keys3.length; index2++) {
    const a = keys3[index2], b = keys3[index2 + 1];
    add(a.time);
    if (!b || typeof a.easing !== "object") continue;
    const c = a.easing, A = 3 * (1 + 3 * c.y1 - 3 * c.y2), B = 6 * (c.y2 - 2 * c.y1), C = 3 * c.y1;
    const roots = Math.abs(A) < 1e-12 ? Math.abs(B) < 1e-12 ? [] : [-C / B] : B * B - 4 * A * C < 0 ? [] : [
      (-B - Math.sqrt(B * B - 4 * A * C)) / (2 * A),
      (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A)
    ];
    for (const t of roots.filter((t2) => t2 > 0 && t2 < 1)) {
      const x = 3 * (1 - t) * (1 - t) * t * c.x1 + 3 * (1 - t) * t * t * c.x2 + t * t * t;
      add(a.time + (b.time - a.time) * x);
    }
  }
  const ordered2 = [...boundaries].sort((a, b) => a - b), result = [];
  const audible = (time) => evaluateAnimatedNumber(value, time) > 0;
  for (let i = 0; i + 1 < ordered2.length; i++) {
    const start = ordered2[i], end = ordered2[i + 1];
    if (start === end) continue;
    const left = audible(start), right = audible(end - 1);
    if (left === right) {
      if (left) result.push({ start, end });
    } else if (left) result.push({ start, end: first(start, end, (t) => !audible(t)) });
    else result.push({ start: first(start, end, audible), end });
  }
  return merge3(result);
}
function sourceRange2(lane, start, end) {
  start = Math.max(0, start - lane.sourceOffset);
  end = Math.max(0, end - lane.sourceOffset);
  const leaf = lane.stages.at(-1);
  return toRoot2(
    sourceRangesToTimeline(leaf.timeMap, start, end).map((range) => ({
      start: range.start + leaf.start,
      end: range.end + leaf.start
    })),
    lane.stages,
    lane.stages.length - 1
  );
}
function compileCaptionSources(value, sequenceId) {
  const doc = validateEditorDocument(value), plan2 = compileAudioPlan(doc, sequenceId);
  const result = [];
  for (const lane of plan2.lanes) {
    const asset2 = doc.assets.find((item) => item.id === lane.assetId);
    const inspection = asset2.metadata?.editorInspection;
    if (inspection && typeof inspection === "object" && !Array.isArray(inspection) && !inspection.audio)
      continue;
    let ranges = sourceRange2(lane, 0, lane.sourceDuration);
    for (let index2 = 0; index2 < lane.stages.length && ranges.length; index2++) {
      const stage = lane.stages[index2];
      if (stage.track.muted || stage.track.volume <= 0) {
        ranges = [];
        break;
      }
      const moving = stage.timeMap.points.slice(0, -1).flatMap(
        (point, i) => point.source === stage.timeMap.points[i + 1].source ? [] : [{ start: point.time, end: stage.timeMap.points[i + 1].time }]
      );
      let local = intersect(positive(stage.audio.volume, stage.duration), merge3(moving));
      if (stage.audio.fadeIn) local = intersect(local, [{ start: 1, end: stage.duration }]);
      ranges = intersect(
        ranges,
        toRoot2(
          local.map((range) => ({
            start: range.start + stage.start,
            end: range.end + stage.start
          })),
          lane.stages,
          index2
        )
      );
    }
    if (ranges.length)
      result.push({
        assetId: asset2.id,
        name: asset2.name,
        instanceId: lane.instanceId,
        ownerClipId: lane.stages[0].clipId,
        lane,
        ranges
      });
  }
  return result;
}
function mapCaptionSourceRange(source2, start, end) {
  return intersect(sourceRange2(source2.lane, start, end), source2.ranges);
}
function cleanText(value, label3, max = 1e4) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw new Error(`${label3}无效`);
  return value.replace(/\r\n?/g, "\n");
}
function seconds(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value * TICKS_PER_SECOND > MAX_EDITOR_TICK)
    throw new Error("转写源时间无效");
  return value;
}
function validateCaptionTranscript(value) {
  if (!Array.isArray(value) || value.length > 1e5) throw new Error("转写段落数量无效");
  let wordsCount = 0, characters = 0;
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("转写段落无效");
    const start = seconds(raw.start), end = seconds(raw.end), text5 = cleanText(raw.text, "转写文字");
    characters += text5.length;
    if (characters > 16 * 1024 * 1024) throw new Error("转写文本超过16 MiB容量，请拆分素材");
    if (end <= start) throw new Error("转写段落必须有正时长");
    const result = { start, end, text: text5 };
    if (raw.id !== void 0) {
      if (!["string", "number"].includes(typeof raw.id) || String(raw.id).length > 128)
        throw new Error("转写段落ID无效");
      result.id = raw.id;
    }
    if (raw.words !== void 0) {
      if (!Array.isArray(raw.words) || (wordsCount += raw.words.length) > 1e5)
        throw new Error("转写词数量无效");
      let previousStart = -1, previousEnd = -1;
      result.words = raw.words.map((word) => {
        const from = seconds(word?.start), to = seconds(word?.end);
        if (to <= from || from < start - 1 / TICKS_PER_SECOND || to > end + 1 / TICKS_PER_SECOND || from < previousStart || to < previousEnd)
          throw new Error("真实词时间越界或顺序无效，不能伪造对齐");
        previousStart = from;
        previousEnd = to;
        return {
          text: cleanText(word.text, "转写词", 1e3),
          start: Math.max(start, from),
          end: Math.min(end, to)
        };
      });
    }
    return result;
  });
}
function hash(value) {
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b ^ value.charCodeAt(i), 3266489917);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
function readableSegments(segment) {
  const words = segment.words;
  if (!words || words.length < 2) return [segment];
  const offsets = [];
  let cursor = 0;
  for (const word of words) {
    const at = segment.text.indexOf(word.text.trim(), cursor);
    if (at < 0) return [segment];
    offsets.push(at);
    cursor = at + word.text.trim().length;
  }
  const groups = [];
  let start = 0, characters = 0;
  for (let index2 = 0; index2 < words.length; index2++) {
    const word = words[index2];
    if (index2 > start && (characters + [...word.text].length > 28 || word.end - words[start].start > 4 || word.start - words[index2 - 1].end >= 0.8)) {
      groups.push([start, index2]);
      start = index2;
      characters = 0;
    }
    characters += [...word.text].length;
  }
  groups.push([start, words.length]);
  if (groups.length === 1) return [segment];
  return groups.map(([from, to]) => ({
    start: words[from].start,
    end: words[to - 1].end,
    text: segment.text.slice(
      from === 0 ? 0 : offsets[from],
      to === words.length ? segment.text.length : offsets[to]
    ),
    words: words.slice(from, to)
  }));
}
function captionTrack(seq, options) {
  const requested = options.trackId ? seq.tracks.find((track4) => track4.id === options.trackId) : void 0;
  if (options.trackId && (!requested || requested.kind !== "text" || requested.locked))
    throw new Error("请选择未锁定的字幕轨道");
  const holds = (trackId, role) => seq.clips.some((clip3) => clip3.trackId === trackId && clip3.kind === "text" && clip3.role === role);
  const usable = seq.tracks.filter((track4) => track4.kind === "text" && !track4.locked);
  const track3 = requested ?? usable.find((track4) => holds(track4.id, "subtitle")) ?? usable.find((track4) => !holds(track4.id, "title"));
  if (track3) return { id: track3.id, operations: [] };
  const id5 = (options.idFactory ?? uniqueId)();
  return {
    id: id5,
    operations: [
      { type: "track.add", sequenceId: seq.id, track: createTrack(id5, "text", subtitleTrackName(seq)) }
    ]
  };
}
function subtitleTrackName(seq) {
  const names = new Set(seq.tracks.map((track3) => track3.name));
  if (!names.has("字幕")) return "字幕";
  let index2 = 2;
  while (names.has(`字幕 ${index2}`)) index2++;
  return `字幕 ${index2}`;
}
function coversSubtitle(seq, trackId, start, end, options) {
  return !!options.avoidOverlaps && seq.clips.some(
    (clip3) => clip3.trackId === trackId && isSubtitleClip(clip3) && !options.overlapExempt?.has(clip3.id) && clip3.start < end && clip3.start + clip3.duration > start
  );
}
var overlapNotice = (count) => `${count} 条字幕与字幕轨上已有字幕时间重叠，已跳过以免互相遮挡；如需替换，请先删除或调整旧字幕`;
function captionLook(doc, seq) {
  const preference = doc.production?.legacyCaptionStyle;
  const subtitles = seq.clips.filter(
    isSubtitleClip
  );
  const preset2 = currentCaptionPreset(seq, subtitles) ?? CAPTION_PRESETS.find((item) => item.value === preference)?.value ?? "classic";
  return captionTemplate({ width: seq.width, height: seq.height, captionStyle: preset2 });
}
function textClip(id5, trackId, start, end, text5, look) {
  return {
    id: id5,
    trackId,
    start,
    duration: end - start,
    label: "字幕",
    kind: "text",
    role: "subtitle",
    text: text5,
    style: structuredClone(look.style),
    words: [],
    transform: structuredClone(look.transform),
    color: structuredClone(look.color),
    blendMode: "normal"
  };
}
function finish4(doc, plan2) {
  applyEditorOperations(doc, plan2.operations, doc.revision);
  return plan2;
}
function planTranscriptCaptions(value, sequenceId, transcripts, options = {}) {
  const doc = validateEditorDocument(value), seq = sequence4(doc, sequenceId), track3 = captionTrack(seq, options), look = captionLook(doc, seq);
  const sources = compileCaptionSources(doc, sequenceId).filter(
    (source2) => (!options.assetIds || options.assetIds.includes(source2.assetId)) && (!options.sourceFilter || options.sourceFilter(source2))
  );
  const result = { sequenceId, operations: [], added: 0, skipped: 0, notices: [] };
  let overlapping = 0;
  const existing = new Map(seq.clips.map((clip3) => [clip3.id, clip3])), generated = /* @__PURE__ */ new Set(), displayed = new Set(
    seq.clips.filter(isSubtitleClip).map((clip3) => JSON.stringify([clip3.start, clip3.duration, clip3.text]))
  );
  for (const assetId of new Set(sources.map((source2) => source2.assetId)))
    if (!transcripts.has(assetId))
      result.notices.push(
        `素材尚无转写：${doc.assets.find((asset2) => asset2.id === assetId).name}`
      );
  for (const source2 of sources) {
    const segments = validateCaptionTranscript(transcripts.get(source2.assetId) ?? []);
    for (const [segmentIndex, segment] of segments.flatMap(readableSegments).entries()) {
      const from = secondsToTicks(segment.start), to = secondsToTicks(segment.end);
      if (to > source2.lane.sourceDuration) throw new Error(`转写超出素材实际时长：${source2.name}`);
      for (const [rangeIndex, range] of mapCaptionSourceRange(source2, from, to).entries()) {
        const mapped = (segment.words ?? []).flatMap(
          (word, index2) => mapCaptionSourceRange(
            source2,
            secondsToTicks(word.start),
            secondsToTicks(word.end)
          ).flatMap((item) => {
            const start = Math.max(range.start, item.start), end = Math.min(range.end, item.end);
            return start < end ? [{ text: word.text, start: start - range.start, end: end - range.start, index: index2 }] : [];
          })
        ).sort((a2, b2) => a2.start - b2.start || a2.end - b2.end || a2.index - b2.index);
        if (segment.words?.length && !mapped.length) continue;
        if (mapped.some((word, index2) => index2 > 0 && word.end < mapped[index2 - 1].end))
          throw new Error("映射后的词时间相互包裹，请先校准转写");
        const ordered2 = mapped.every((word, index2) => word.index === index2) && mapped.length === (segment.words?.length ?? 0);
        const content = mapped.length && !ordered2 ? mapped.map((word) => word.text).join("") : segment.text;
        if (mapped.some((word, index2) => index2 > 0 && word.index < mapped[index2 - 1].index) && !result.notices.includes("倒放段按播放顺序显示真实转写词语"))
          result.notices.push("倒放段按播放顺序显示真实转写词语");
        if (!segment.words?.length && !result.notices.includes("部分转写仅有句子时间，字幕未伪造逐字时间；裁剪处请校对句子内容"))
          result.notices.push("部分转写仅有句子时间，字幕未伪造逐字时间；裁剪处请校对句子内容");
        const id5 = options.captionId ? options.captionId(source2, segmentIndex, rangeIndex) : `caption-asr-${hash(JSON.stringify([sequenceId, source2.instanceId, source2.assetId, from, to, rangeIndex]))}`;
        if (generated.has(id5)) {
          result.skipped++;
          continue;
        }
        generated.add(id5);
        const old = existing.get(id5);
        if (old) {
          if (old.kind !== "text" || old.role !== "subtitle" || old.sourceBinding?.clipId !== source2.ownerClipId)
            throw new Error("字幕ID与既有内容冲突，请保留工程并重新选择");
          result.skipped++;
          continue;
        }
        if (seq.clips.some(
          (item) => item.kind === "text" && item.sourceBinding?.clipId === source2.ownerClipId && item.sourceBinding.provenance?.assetId === source2.assetId && item.sourceBinding.provenance.start === from && item.sourceBinding.provenance.end === to && JSON.stringify(item.sourceBinding.provenance.path) === JSON.stringify(source2.lane.stages.slice(1).map((stage) => stage.clipId)) && item.start < range.end && item.start + item.duration > range.start
        )) {
          result.skipped++;
          continue;
        }
        const key = JSON.stringify([range.start, range.end - range.start, content]);
        if (displayed.has(key)) {
          result.skipped++;
          continue;
        }
        if (coversSubtitle(seq, track3.id, range.start, range.end, options)) {
          result.skipped++;
          overlapping++;
          continue;
        }
        displayed.add(key);
        const clip3 = textClip(id5, track3.id, range.start, range.end, content, look), owner = source2.lane.stages[0];
        clip3.words = mapped.map(({ index: _, ...word }) => ({ ...word, text: word.text.trim() }));
        if (options.wordHighlight && clip3.words.length) clip3.style.animation = "word-highlight";
        const a = sourceTimeAt(owner.timeMap, range.start - owner.start), b = sourceTimeAt(owner.timeMap, range.end - 1 - owner.start);
        clip3.sourceBinding = {
          clipId: owner.clipId,
          sourceStart: Math.min(a, b),
          sourceEnd: Math.max(a, b) + 1,
          provenance: {
            path: source2.lane.stages.slice(1).map((stage) => stage.clipId),
            assetId: source2.assetId,
            start: from,
            end: to
          }
        };
        result.operations.push({ type: "clip.add", sequenceId, clip: clip3 });
        result.added++;
        if (result.added + seq.clips.length > MAX_CAPTIONS2)
          throw new Error("字幕超过序列2000片段容量，请缩小选择或拆分序列");
      }
    }
  }
  if (overlapping) result.notices.push(overlapNotice(overlapping));
  if (result.added) result.operations.unshift(...track3.operations);
  return finish4(doc, result);
}
function parseEditorSrt(text5) {
  if (typeof text5 !== "string" || text5.length > 4 * 1024 * 1024)
    throw new Error("SRT 文件过大或不是文字");
  const input = text5.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!input) return [];
  const time = (h, m, s, ms) => {
    if (+m > 59 || +s > 59) throw new Error("SRT 时间无效");
    const tick2 = ((+h * 3600 + +m * 60 + +s) * 1e3 + +ms) * 240;
    if (tick2 > MAX_EDITOR_TICK) throw new Error("SRT 超过24小时");
    return tick2;
  };
  const blocks2 = input.split(/\n[\t ]*\n+/);
  if (blocks2.length > MAX_CAPTIONS2) throw new Error("SRT 超过2000条容量");
  return blocks2.map((block, index2) => {
    const lines = block.split("\n");
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const match = /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})\s*$/.exec(
      lines.shift()?.trim() ?? ""
    );
    if (!match) throw new Error(`SRT 第${index2 + 1}条时间格式无效`);
    const start = time(match[1], match[2], match[3], match[4]), end = time(match[5], match[6], match[7], match[8]);
    if (end <= start) throw new Error(`SRT 第${index2 + 1}条没有正时长`);
    return { start, end, text: cleanText(lines.join("\n"), "SRT 字幕") };
  });
}
function planSrtImport(value, sequenceId, text5, options = {}) {
  return planImportedCaptions(value, sequenceId, parseEditorSrt(text5), options);
}
function planImportedCaptions(value, sequenceId, cues, options, notices = []) {
  const doc = validateEditorDocument(value), seq = sequence4(doc, sequenceId), track3 = captionTrack(seq, options), look = captionLook(doc, seq);
  const operations = [], keys3 = new Set(
    seq.clips.filter(isSubtitleClip).map((clip3) => JSON.stringify([clip3.start, clip3.duration, clip3.text]))
  );
  let skipped = 0, overlapping = 0;
  for (const cue of cues) {
    const key = JSON.stringify([cue.start, cue.end - cue.start, cue.text]);
    if (keys3.has(key)) {
      skipped++;
      continue;
    }
    if (coversSubtitle(seq, track3.id, cue.start, cue.end, options)) {
      skipped++;
      overlapping++;
      continue;
    }
    keys3.add(key);
    operations.push({
      type: "clip.add",
      sequenceId,
      clip: textClip(
        (options.idFactory ?? uniqueId)(),
        track3.id,
        cue.start,
        cue.end,
        cue.text,
        look
      )
    });
  }
  if (operations.length) operations.unshift(...track3.operations);
  return finish4(doc, {
    sequenceId,
    operations,
    added: cues.length - skipped,
    skipped,
    notices: [...notices, ...overlapping ? [overlapNotice(overlapping)] : []]
  });
}
function selectedCaptions(seq, ids3) {
  if (ids3 && (new Set(ids3).size !== ids3.length || ids3.some(
    (id5) => !seq.clips.some(
      (clip3) => clip3.id === id5 && isSubtitleClip(clip3)
    )
  )))
    throw new Error("请选择有效的字幕片段");
  return seq.clips.filter(
    (clip3) => isSubtitleClip(clip3) && (!ids3 || ids3.includes(clip3.id))
  );
}
function captionTranslationItems(value, sequenceId, clipIds) {
  const doc = validateEditorDocument(value), clips = selectedCaptions(sequence4(doc, sequenceId), clipIds);
  if (!clips.length) throw new Error("请选择要翻译的字幕");
  return clips.map((clip3) => ({ id: clip3.id, text: clip3.translation?.original ?? clip3.text }));
}
function planCaptionTranslation(value, sequenceId, clipIds, language, mode, translations) {
  const doc = validateEditorDocument(value), seq = sequence4(doc, sequenceId), items = captionTranslationItems(doc, sequenceId, clipIds);
  cleanText(language, "翻译语言", 80);
  if (!["bilingual", "translated"].includes(mode)) throw new Error("请选择双语或仅译文");
  if (!Array.isArray(translations) || translations.length !== items.length || new Set(translations.map((item) => item.id)).size !== items.length || translations.some((item) => !items.some((source2) => source2.id === item.id)))
    throw new Error("翻译结果数量或ID不匹配，原字幕已保留");
  const operations = items.map((item) => {
    const clip3 = seq.clips.find((clip4) => clip4.id === item.id), translated = cleanText(translations.find((result) => result.id === item.id).text, "译文");
    const originalWords = structuredClone(clip3.translation?.originalWords ?? clip3.words);
    return {
      type: "clip.update",
      sequenceId,
      clipId: item.id,
      patch: {
        text: mode === "bilingual" ? `${item.text}
${translated}` : translated,
        translation: {
          original: item.text,
          language,
          mode,
          ...originalWords.length ? { originalWords } : {}
        },
        words: mode === "bilingual" ? originalWords : [],
        style: {
          ...clip3.style,
          animation: mode === "translated" && clip3.style.animation === "word-highlight" ? "none" : clip3.style.animation
        }
      }
    };
  });
  return finish4(doc, { sequenceId, operations, added: 0, skipped: 0, notices: [] });
}
function planCaptionStyle(value, sequenceId, clipIds, patch2) {
  const doc = validateEditorDocument(value), seq = sequence4(doc, sequenceId), clips = selectedCaptions(seq, clipIds);
  if (!clips.length) throw new Error("请选择字幕");
  if (patch2.animation === "word-highlight" && clips.some((clip3) => !clip3.words.length))
    throw new Error("逐字高亮需要真实词时间，请先完成词级转写");
  const operations = clips.map((clip3) => ({
    type: "clip.update",
    sequenceId,
    clipId: clip3.id,
    patch: { style: { ...clip3.style, ...patch2 } }
  }));
  applyEditorOperations(doc, operations, doc.revision);
  return operations;
}
function retainedCaptionWords(clip3, text5) {
  if (clip3.role !== "subtitle" || !clip3.words.length) return void 0;
  const gaps = (value, words) => {
    let cursor = 0;
    const result = [];
    for (const word of words) {
      if (!word.text) return void 0;
      const start = value.indexOf(word.text, cursor);
      if (start < 0) return void 0;
      const gap = value.slice(cursor, start);
      if (!/^[\s\p{P}]*$/u.test(gap)) return void 0;
      result.push(gap);
      cursor = start + word.text.length;
    }
    const tail = value.slice(cursor);
    if (!/^[\s\p{P}]*$/u.test(tail)) return void 0;
    return [...result, tail];
  };
  for (const words of [clip3.words, clip3.words.map((word) => ({ ...word, text: word.text.trim() }))]) {
    const before = gaps(clip3.text, words), after = gaps(text5, words);
    if (!before || !after) continue;
    const safe = before.every((gap, index2) => {
      if (gap === after[index2]) return true;
      if (/['’ʼ‐‑/\\-]/u.test(gap + after[index2])) return false;
      const left = words[index2 - 1]?.text ?? "", right = words[index2]?.text ?? "";
      if (new RegExp("\\p{N}$", "u").test(left) && new RegExp("^\\p{N}", "u").test(right)) return false;
      return !(/[\p{L}\p{N}\p{M}]$/u.test(left) && /^[\p{L}\p{N}\p{M}]/u.test(right) && (!gap || !after[index2]));
    });
    if (safe) return structuredClone(words);
  }
  return void 0;
}
function captionTextOperations(sequenceId, clip3, text5) {
  cleanText(text5, "字幕文字");
  if (text5 === clip3.text) return [];
  const retained = retainedCaptionWords(clip3, text5);
  return [
    {
      type: "clip.update",
      sequenceId,
      clipId: clip3.id,
      patch: {
        text: text5,
        words: retained ?? [],
        translation: null,
        style: {
          ...clip3.style,
          animation: !retained && clip3.style.animation === "word-highlight" ? "none" : clip3.style.animation
        }
      }
    }
  ];
}
function planCaptionText(value, sequenceId, clipId, text5) {
  const doc = validateEditorDocument(value), clip3 = sequence4(doc, sequenceId).clips.find(
    (item) => item.id === clipId && item.kind === "text"
  );
  if (!clip3) throw new Error("请选择有效的字幕或文字片段");
  const operations = captionTextOperations(sequenceId, clip3, text5);
  if (!operations.length) return [];
  applyEditorOperations(doc, operations, doc.revision);
  return operations;
}
function planDetachCaptions(value, sequenceId, clipIds) {
  const doc = validateEditorDocument(value), clips = selectedCaptions(sequence4(doc, sequenceId), clipIds);
  if (!clips.length) throw new Error("请选择字幕");
  const operations = clips.filter((clip3) => clip3.sourceBinding).map((clip3) => ({
    type: "clip.update",
    sequenceId,
    clipId: clip3.id,
    patch: { sourceBinding: null }
  }));
  applyEditorOperations(doc, operations, doc.revision);
  return operations;
}
var DEFAULT_CAPTION_DURATION = 3 * TICKS_PER_SECOND;
function planAddCaptions(value, sequenceId, items, options = {}) {
  const doc = validateEditorDocument(value), seq = sequence4(doc, sequenceId), limit = sequenceDuration(seq), look = captionLook(doc, seq);
  if (!Array.isArray(items) || !items.length) throw new Error("请提供要添加的字幕");
  if (seq.clips.length + items.length > MAX_CAPTIONS2)
    throw new Error("字幕超过序列2000片段容量，请先整理时间线片段");
  const used = new Set(seq.clips.map((clip3) => clip3.id)), operations = [], tracks = /* @__PURE__ */ new Map();
  for (const item of items) {
    const text5 = cleanText(item?.text, "字幕文字"), start = assertTick(item.start, "字幕开始时间"), requested = assertTick(item.end, "字幕结束时间");
    if (requested <= start) throw new Error("字幕结束时间必须晚于开始时间");
    if (start >= limit) throw new Error("字幕开始时间超出画面范围，请放在画面时长之内");
    const id5 = item.id ?? (options.idFactory ?? uniqueId)();
    if (typeof id5 !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id5))
      throw new Error("字幕 ID 格式不正确");
    if (used.has(id5)) throw new Error(`字幕 ID 已被时间线片段使用：${id5}`);
    used.add(id5);
    const key = item.trackId ?? options.trackId ?? "";
    let trackId = tracks.get(key);
    if (trackId === void 0) {
      const track3 = captionTrack(seq, {
        ...key ? { trackId: key } : {},
        ...options.idFactory ? { idFactory: options.idFactory } : {}
      });
      operations.push(...track3.operations);
      tracks.set(key, trackId = track3.id);
    }
    operations.push({
      type: "clip.add",
      sequenceId,
      clip: textClip(id5, trackId, start, Math.min(requested, limit), text5, look)
    });
  }
  applyEditorOperations(doc, operations, doc.revision);
  return operations;
}

// src/editor/multicam-edits.ts
function selected2(doc, sequenceId, clipId) {
  const sequence5 = doc.sequences.find((seq) => seq.id === sequenceId);
  if (!sequence5) throw new Error("序列不存在");
  if (clipId === void 0) return { sequence: sequence5 };
  const clip3 = sequence5.clips.find((clip4) => clip4.id === clipId);
  if (!clip3 || clip3.kind !== "multicam") throw new Error("请选择一个多机位片段");
  if (sequence5.tracks.find((track3) => track3.id === clip3.trackId)?.locked)
    throw new Error("多机位片段所在轨道已锁定");
  return { sequence: sequence5, clip: clip3 };
}
function finish5(document, operations) {
  applyEditorOperations(document, operations, document.revision);
  return structuredClone(operations);
}
function planCreateMulticam(value, sequenceId, options) {
  const document = validateEditorDocument(value), { sequence: sequence5 } = selected2(document, sequenceId);
  if (!Array.isArray(options.assetIds) || options.assetIds.length < 2 || options.assetIds.length > 32 || new Set(options.assetIds).size !== options.assetIds.length)
    throw new Error("多机位需要 2 至 32 个不同视频素材");
  const assets = options.assetIds.map((id6) => {
    const asset2 = document.assets.find((asset3) => asset3.id === id6);
    if (!asset2 || asset2.kind !== "video") throw new Error("多机位须使用工程中的视频素材");
    return asset2;
  });
  const offsets = options.offsets ?? {};
  if (![Object.prototype, null].includes(Object.getPrototypeOf(offsets)) || Object.keys(offsets).some((id6) => !options.assetIds.includes(id6)))
    throw new Error("机位偏移包含未知素材");
  for (const offset of Object.values(offsets))
    if (!Number.isSafeInteger(offset) || Math.abs(offset) > 86400 * 24e4)
      throw new Error("机位偏移无效");
  assertTick(options.at);
  const used = /* @__PURE__ */ new Set();
  for (const seq of document.sequences) {
    seq.tracks.forEach((track3) => used.add(track3.id));
    seq.clips.forEach((clip4) => {
      used.add(clip4.id);
      if (clip4.kind === "multicam") clip4.angles.forEach((angle) => used.add(angle.id));
    });
  }
  const id5 = (kind) => {
    const result = options.idFactory?.(kind) ?? `${kind}-${randomId()}`;
    if (used.has(result)) throw new Error("多机位对象编号重复");
    used.add(result);
    return result;
  };
  const start = Math.max(0, ...assets.map((asset2) => -(offsets[asset2.id] ?? 0))), end = Math.min(...assets.map((asset2) => asset2.duration - (offsets[asset2.id] ?? 0)));
  if (end <= start) throw new Error("机位没有共同有效的时间范围，请调整同步偏移");
  const angles = assets.map((asset2) => ({
    id: id5("angle"),
    name: asset2.name,
    assetId: asset2.id,
    offset: offsets[asset2.id] ?? 0
  }));
  const audio2 = angles.find((angle) => angle.assetId === (options.audioAssetId ?? assets[0].id));
  if (!audio2) throw new Error("请选择有效的主声音机位");
  const trackId = options.trackId ?? id5("track"), ops = [];
  if (options.trackId) {
    if (sequence5.tracks.find((track3) => track3.id === trackId)?.kind !== "video")
      throw new Error("多机位需要画面轨道");
  } else
    ops.push({ type: "track.add", sequenceId, track: createTrack(trackId, "video", options.name) });
  const clip3 = {
    id: id5("clip"),
    kind: "multicam",
    label: options.name,
    trackId,
    start: options.at,
    duration: end - start,
    angles,
    audioAngleId: audio2.id,
    switches: [{ time: 0, angleId: angles[0].id }],
    timeMap: {
      points: [
        { time: 0, source: start },
        { time: end - start, source: end }
      ]
    },
    audio: defaultAudioMix(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal"
  };
  ops.push({ type: "clip.add", sequenceId, clip: clip3 });
  return finish5(document, ops);
}
function planUpdateMulticamAngles(value, sequenceId, clipId, patch2, options = {}) {
  const document = validateEditorDocument(value), { clip: clip3, sequence: sequence5 } = selected2(document, sequenceId, clipId);
  if (!patch2 || ![Object.prototype, null].includes(Object.getPrototypeOf(patch2)) || Object.keys(patch2).some((key) => !["angles", "audioAngleId"].includes(key)))
    throw new Error("机位更新字段无效");
  const operations = [];
  if (options.trimToCommonRange && patch2.angles) {
    const sourceStart = clip3.timeMap.points[0].source;
    if (clip3.timeMap.points.some((point) => point.source - point.time !== sourceStart))
      throw new Error("变速或倒放机位请先手动裁剪到共同范围，再修改偏移");
    const minimum = Math.max(0, ...patch2.angles.map((angle) => -angle.offset)), maximum = Math.min(
      ...patch2.angles.map((angle) => {
        const asset2 = document.assets.find((asset3) => asset3.id === angle.assetId);
        if (!asset2 || asset2.kind !== "video") throw new Error("机位素材无效");
        return asset2.duration - angle.offset;
      })
    );
    const start = Math.max(0, minimum - sourceStart), end = Math.min(clip3.duration, maximum - sourceStart);
    if (start >= end) throw new Error("机位没有共同有效的时间范围");
    if ((start !== 0 || end !== clip3.duration) && sequence5.clips.some(
      (other) => other.id !== clipId && (clip3.groupId && other.groupId === clip3.groupId || clip3.linkGroupId && other.linkGroupId === clip3.linkGroupId)
    ))
      throw new Error("共同范围裁剪会影响分组或链接片段，请先解除分组或链接");
    operations.push(...trimClip(document, sequenceId, clipId, start, end));
  }
  operations.push({ type: "clip.update", sequenceId, clipId, patch: structuredClone(patch2) });
  return finish5(document, operations);
}
function planMulticamSwitches(value, sequenceId, clipId, switches) {
  const document = validateEditorDocument(value);
  selected2(document, sequenceId, clipId);
  return finish5(document, [
    { type: "clip.update", sequenceId, clipId, patch: { switches: structuredClone(switches) } }
  ]);
}
function compress(switches) {
  return switches.filter(
    (item, index2) => index2 === 0 || item.angleId !== switches[index2 - 1].angleId
  );
}
function planMulticamCut(value, sequenceId, clipId, time, angleId) {
  const document = validateEditorDocument(value), clip3 = selected2(document, sequenceId, clipId).clip;
  assertTick(time);
  if (time >= clip3.duration) throw new Error("切换点必须位于多机位片段内");
  const switches = clip3.switches.filter((item) => item.time !== time);
  switches.push({ time, angleId });
  switches.sort((a, b) => a.time - b.time);
  return planMulticamSwitches(document, sequenceId, clipId, compress(switches));
}
function planRecordMulticamSwitches(value, sequenceId, clipId, start, end, cuts) {
  const document = validateEditorDocument(value), clip3 = selected2(document, sequenceId, clipId).clip;
  assertTick(start);
  assertTick(end);
  if (start >= end || end > clip3.duration || !cuts.length || cuts[0].time !== start || cuts.some(
    (cut, i) => cut.time < start || cut.time >= end || i > 0 && cut.time <= cuts[i - 1].time
  ))
    throw new Error("录制切点范围无效，请重新录制");
  return planMulticamSwitches(
    document,
    sequenceId,
    clipId,
    compress([
      ...clip3.switches.filter((cut) => cut.time < start),
      ...structuredClone(cuts),
      ...clip3.switches.filter((cut) => cut.time >= end)
    ])
  );
}

// src/editor/agent-tools.ts
var EDITOR_AGENT_LIMITS = Object.freeze({
  inputBytes: 256 * 1024,
  responseBytes: 48 * 1024,
  pageItems: 100,
  steps: 100,
  operations: 1e3
});
var encoder = new TextEncoder();
var size = (value) => encoder.encode(JSON.stringify(value)).byteLength;
function json(value, max = EDITOR_AGENT_LIMITS.inputBytes) {
  let count = 0;
  const parents = /* @__PURE__ */ new Set();
  const copy = (item, depth) => {
    if (++count > 1e5 || depth > 64) throw new Error("工具输入结构过大");
    if (item === null || typeof item === "boolean" || typeof item === "string") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (!item || typeof item !== "object" || parents.has(item))
      throw new Error("工具参数必须是有限 JSON 数据");
    const array2 = Array.isArray(item), prototype = Object.getPrototypeOf(item), keys3 = Reflect.ownKeys(item);
    if (array2 ? prototype !== Array.prototype || keys3.length !== item.length + 1 : prototype !== Object.prototype && prototype !== null)
      throw new Error("工具参数须为普通对象或完整数组");
    parents.add(item);
    const result2 = array2 ? [] : {};
    for (const key of keys3) {
      if (array2 && key === "length") continue;
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key) || array2 && !/^(0|[1-9]\d*)$/.test(key))
        throw new Error("工具参数含不安全字段");
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor.enumerable || !("value" in descriptor))
        throw new Error("工具参数不能包含访问器");
      result2[key] = copy(descriptor.value, depth + 1);
    }
    parents.delete(item);
    return result2;
  };
  const result = copy(value, 0);
  if (size(result) > max) throw new Error(`工具输入超过 ${max} 字节，请拆分请求`);
  return result;
}
function object6(value, keys3) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("工具参数必须是对象");
  for (const key of Object.keys(value))
    if (!keys3.includes(key)) throw new Error(`工具参数包含未知字段：${key}`);
  return value;
}
function integer4(value, min, max, label3) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${label3}须为 ${min} 至 ${max} 的整数`);
  return value;
}
function id4(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value))
    throw new Error("标识符无效");
  return value;
}
function ids2(value) {
  if (!Array.isArray(value) || !value.length || value.length > 2e3)
    throw new Error("选择须包含 1 至 2000 个片段 ID");
  const result = value.map(id4);
  if (new Set(result).size !== result.length) throw new Error("选择不能含重复 ID");
  return result;
}
function identity(value) {
  const data = object6(value, ["documentId", "generation", "revision"]);
  return {
    documentId: id4(data.documentId),
    generation: integer4(data.generation, 1, Number.MAX_SAFE_INTEGER, "会话代数"),
    revision: integer4(data.revision, 0, Number.MAX_SAFE_INTEGER, "版本")
  };
}
function grant(value) {
  if (value === void 0) return void 0;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("自动制作授权须为 {projectId, requestToken} 对象");
  const data = object6(value, ["projectId", "requestToken"]);
  for (const key of ["projectId", "requestToken"])
    if (typeof data[key] !== "string" || !data[key] || data[key].length > 128)
      throw new Error("自动制作授权须包含当前 projectId 和 requestToken");
  return { projectId: data.projectId, requestToken: data.requestToken };
}
function rejectGrant(value) {
  if (value && typeof value === "object" && Object.hasOwn(value, "grant"))
    throw new Error("此功能在自动制作中不可用；自动制作中只能用授权进行时间线编辑与剪贴板操作");
}
function sameIdentity(session, expected2, requireReady = true) {
  const current = session.getState().identity;
  if (current.documentId !== expected2.documentId || current.generation !== expected2.generation || current.revision !== expected2.revision)
    throw new Error("工程身份或版本已变化，请重新读取并重新规划，不能只替换版本号重放");
  if (requireReady && session.getState().phase !== "ready")
    throw new Error("工程正在保存、切换或关闭，请稍后重读");
}
function frozen(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
var pointer = (base, key) => `${base}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
function readPage(root, pathValue, offsetValue, limitValue, format = "tree") {
  if (!["tree", "json"].includes(format)) throw new Error("读取格式无效");
  const path = pathValue ?? "";
  if (typeof path !== "string" || path.length > 4096 || path && !path.startsWith("/"))
    throw new Error("path 须为工具返回的 JSON pointer");
  let value = root;
  for (const encoded of path ? path.slice(1).split("/") : []) {
    if (/~(?![01])/u.test(encoded)) throw new Error("JSON pointer 转义无效");
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (["__proto__", "constructor", "prototype"].includes(key) || !value || typeof value !== "object" || !Object.hasOwn(value, key) || Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))
      throw new Error("读取路径不存在或不安全");
    value = value[key];
  }
  if (format === "json") value = JSON.stringify(value);
  const offset = integer4(offsetValue ?? 0, 0, Number.MAX_SAFE_INTEGER, "分页偏移"), limit = integer4(limitValue ?? 20, 1, EDITOR_AGENT_LIMITS.pageItems, "分页数量");
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (typeof value === "string") {
    if (offset > value.length || offset && /[\uDC00-\uDFFF]/.test(value[offset] ?? ""))
      throw new Error("字符串分页偏移越界或切断字符");
    let end = Math.min(value.length, offset + 4096);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
    return {
      path,
      type,
      unit: "utf16",
      offset,
      total: value.length,
      value: value.slice(offset, end),
      nextOffset: end < value.length ? end : null
    };
  }
  if (!value || typeof value !== "object") {
    if (offset) throw new Error("标量没有此分页位置");
    return { path, type, value, nextOffset: null };
  }
  const keys3 = Object.keys(value);
  if (offset > keys3.length) throw new Error("分页偏移超出范围");
  const entries = [];
  const budget = EDITOR_AGENT_LIMITS.responseBytes - 4096 - size({ path, type, offset, total: keys3.length, nextOffset: keys3.length });
  let consumed = 0;
  for (const key of keys3.slice(offset, offset + limit)) {
    const child = value[key], entryPath = pointer(path, key), bytes = size(child);
    let entry = entryPath.length > 4096 || size({ key, path: entryPath }) > budget / 2 ? {
      index: offset + consumed,
      keyPreview: key.slice(0, 100),
      keyLength: key.length,
      expanded: false,
      readAs: "json"
    } : bytes < 16e3 ? { key, path: entryPath, value: child } : {
      key,
      path: entryPath,
      expanded: false,
      type: Array.isArray(child) ? "array" : typeof child,
      total: typeof child === "string" ? child.length : Object.keys(child).length
    };
    if (size(entries) + size(entry) > budget) {
      if (entries.length) break;
      entry = { key, path: entryPath, expanded: false, type: typeof child, total: bytes };
    }
    entries.push(entry);
    consumed++;
  }
  return {
    path,
    type,
    offset,
    total: keys3.length,
    entries,
    nextOffset: offset + consumed < keys3.length ? offset + consumed : null
  };
}
function rawOperations(value) {
  if (!Array.isArray(value) || !value.length || value.length > EDITOR_AGENT_LIMITS.operations)
    throw new Error("操作批次须包含 1 至 1000 项");
  for (const op of value) {
    if (!op || typeof op !== "object" || Array.isArray(op)) throw new Error("编辑操作必须是对象");
    if (["project.production", "asset.add", "asset.remove"].includes(op.type))
      throw new Error("制作审批与素材导入/删除须使用对应流程，不能由通用编辑工具重写");
    if (op.type === "asset.update") object6(op.patch, ["name"]);
    if (op.type === "clip.update" && ["text", "words", "translation"].some((key) => Object.hasOwn(op.patch ?? {}, key)))
      throw new Error("文字、词时间与翻译请使用字幕 planner，保留同一清理和来源规则");
    if (op.type === "track.update" && Object.hasOwn(op.patch ?? {}, "locked"))
      throw new Error("AI 编辑不能绕过轨道锁，请使用轨道锁定控件");
    if (op.type === "clip.update" && [
      "start",
      "duration",
      "timeMap",
      "trackId",
      "groupId",
      "linkGroupId",
      "sourceBinding",
      "assetId",
      "sequenceId",
      "angles",
      "switches",
      "audioAngleId"
    ].some((key) => Object.hasOwn(op.patch ?? {}, key)))
      throw new Error("片段时间、来源、轨道或绑定编辑须使用同一时间线 planner");
    if (["clip.move", "clip.remove", "transition.add", "transition.remove"].includes(op.type))
      throw new Error("移动、删除、转场须使用 planner，保证磁吸与绑定规则一致");
    if (op.type === "sequence.update" && Object.hasOwn(op.patch ?? {}, "timelineMode"))
      throw new Error("时间线排列须使用 arrange planner");
  }
  return value;
}
function plan(document, raw, factory) {
  const kind = raw.kind;
  if (kind === "operations") return rawOperations(object6(raw, ["kind", "operations"]).operations);
  if (kind === "sequence") return planSequenceStep(document, raw, factory);
  if (kind === "captions") return planCaptionsStep(document, raw, factory);
  if (kind === "multicam") return planMulticamStep(document, raw, factory);
  if (kind === "marker") {
    const step2 = object6(raw, ["kind", "sequenceId", "action"]);
    return planMarkerEdit(document, id4(step2.sequenceId), step2.action).operations;
  }
  const keys3 = {
    split: ["clipId", "time"],
    trim: ["clipId", "localStart", "localEnd"],
    timing: ["clipIds", "action", "options"],
    move: ["clipIds", "options"],
    remove: ["clipIds"],
    transition: ["fromClipId", "toClipId", "options"],
    arrange: ["options"],
    group: ["clipIds"],
    ungroup: ["clipIds"],
    duplicate: ["clipIds"]
  };
  if (typeof kind !== "string" || !Object.hasOwn(keys3, kind)) throw new Error("未知编辑 planner");
  const step = object6(raw, ["kind", "sequenceId", ...keys3[kind]]), sequenceId = id4(step.sequenceId);
  const tick2 = (value) => integer4(value, 0, Number.MAX_SAFE_INTEGER, "时间刻度");
  if (kind === "split")
    return splitClip(document, sequenceId, id4(step.clipId), tick2(step.time), factory);
  if (kind === "trim")
    return trimClip(
      document,
      sequenceId,
      id4(step.clipId),
      tick2(step.localStart),
      tick2(step.localEnd)
    );
  if (kind === "duplicate")
    return duplicateClipsInPlace(document, sequenceId, ids2(step.clipIds), { idFactory: factory });
  if (kind === "group")
    return groupClips(document, sequenceId, ids2(step.clipIds), factory("group"));
  if (kind === "ungroup") return ungroupClips(document, sequenceId, ids2(step.clipIds));
  if (kind === "timing") {
    const action = object6(step.action, [
      "kind",
      "rate",
      "preservePitch",
      "timeMap",
      "time",
      "duration"
    ]);
    const actionKeys = {
      speed: ["rate", "preservePitch"],
      map: ["timeMap"],
      reverse: [],
      freeze: ["time", "duration"],
      "keep-left": ["time"],
      "keep-right": ["time"]
    };
    if (!Object.hasOwn(actionKeys, action.kind)) throw new Error("未知时间编辑");
    object6(action, ["kind", ...actionKeys[action.kind]]);
    const options2 = object6(step.options ?? {}, ["ripple", "removeTransitions", "detachCaptions"]);
    for (const value of Object.values(options2))
      if (typeof value !== "boolean") throw new Error("时间编辑选项须为布尔值");
    if (action.preservePitch !== void 0 && typeof action.preservePitch !== "boolean")
      throw new Error("preservePitch 须为布尔值");
    return planClipTiming(document, sequenceId, ids2(step.clipIds), action, options2);
  }
  const sequence5 = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence5) throw new Error("序列不存在");
  if (kind === "move") {
    const options2 = object6(step.options, ["delta", "trackId", "anchorClipId", "direction"]), selected3 = ids2(step.clipIds);
    integer4(options2.delta, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "移动刻度");
    if (options2.direction !== void 0 && !["previous", "next"].includes(options2.direction))
      throw new Error("移动方向无效");
    if (sequence5.timelineMode === "magnetic")
      return planMagneticMove(document, sequenceId, selected3, options2);
    if (options2.direction !== void 0)
      throw new Error("自由时间线请使用精确 delta，不能隐式磁吸重排");
    return [
      {
        type: "clip.move",
        sequenceId,
        clipIds: selected3,
        delta: options2.delta,
        ...options2.trackId === void 0 ? {} : { trackId: id4(options2.trackId) }
      }
    ];
  }
  if (kind === "remove") {
    if (sequence5.timelineMode === "magnetic")
      return planMagneticRemove(document, sequenceId, ids2(step.clipIds));
    const chosen = new Set(ids2(step.clipIds));
    for (; ; ) {
      const previous = chosen.size, members = sequence5.clips.filter((clip3) => chosen.has(clip3.id));
      const groups = new Set(members.map((clip3) => clip3.groupId).filter(Boolean)), links = new Set(members.map((clip3) => clip3.linkGroupId).filter(Boolean));
      for (const clip3 of sequence5.clips)
        if (clip3.groupId && groups.has(clip3.groupId) || clip3.linkGroupId && links.has(clip3.linkGroupId))
          chosen.add(clip3.id);
      if (chosen.size === previous) break;
    }
    return [{ type: "clip.remove", sequenceId, clipIds: [...chosen] }];
  }
  if (kind === "transition") {
    const options2 = object6(step.options, ["id", "kind", "duration", "placement", "remove"]);
    if (options2.remove !== void 0 && typeof options2.remove !== "boolean")
      throw new Error("remove 须为布尔值");
    if (options2.placement !== void 0 && !["ripple", "overlap"].includes(options2.placement))
      throw new Error("转场放置方式无效");
    return planTransition(
      document,
      sequenceId,
      id4(step.fromClipId),
      id4(step.toClipId),
      options2
    );
  }
  const options = object6(step.options, ["mode", "trackId", "compact"]);
  if (options.compact !== void 0 && typeof options.compact !== "boolean")
    throw new Error("compact 须为布尔值");
  return planTimelineArrangement(document, sequenceId, options);
}
function planMulticamStep(document, raw, factory) {
  const step = object6(raw, ["kind", "sequenceId", "action"]), sequenceId = id4(step.sequenceId), action = object6(step.action, [
    "kind",
    "clipId",
    "assetIds",
    "at",
    "name",
    "offsets",
    "audioAssetId",
    "trackId",
    "angles",
    "audioAngleId",
    "trimToCommonRange",
    "switches",
    "time",
    "angleId",
    "start",
    "end",
    "cuts"
  ]);
  const tick2 = (value) => integer4(value, 0, Number.MAX_SAFE_INTEGER, "时间刻度");
  if (action.kind === "create") {
    object6(action, ["kind", "assetIds", "at", "name", "offsets", "audioAssetId", "trackId"]);
    return planCreateMulticam(document, sequenceId, {
      assetIds: ids2(action.assetIds),
      at: tick2(action.at),
      name: action.name,
      ...action.offsets === void 0 ? {} : { offsets: object6(action.offsets, Object.keys(action.offsets ?? {})) },
      ...action.audioAssetId === void 0 ? {} : { audioAssetId: id4(action.audioAssetId) },
      ...action.trackId === void 0 ? {} : { trackId: id4(action.trackId) },
      idFactory: factory
    });
  }
  const clipId = id4(action.clipId);
  if (action.kind === "angles") {
    object6(action, ["kind", "clipId", "angles", "audioAngleId", "trimToCommonRange"]);
    if (action.trimToCommonRange !== void 0 && typeof action.trimToCommonRange !== "boolean")
      throw new Error("trimToCommonRange 须为布尔值");
    if (action.angles !== void 0) {
      if (!Array.isArray(action.angles)) throw new Error("机位须为数组");
      action.angles.forEach((angle) => object6(angle, ["id", "name", "assetId", "offset"]));
    }
    return planUpdateMulticamAngles(
      document,
      sequenceId,
      clipId,
      {
        ...action.angles === void 0 ? {} : { angles: action.angles },
        ...action.audioAngleId === void 0 ? {} : { audioAngleId: id4(action.audioAngleId) }
      },
      { trimToCommonRange: action.trimToCommonRange }
    );
  }
  if (action.kind === "cut") {
    object6(action, ["kind", "clipId", "time", "angleId"]);
    return planMulticamCut(document, sequenceId, clipId, tick2(action.time), id4(action.angleId));
  }
  if (action.kind === "switches" || action.kind === "record") {
    object6(
      action,
      action.kind === "switches" ? ["kind", "clipId", "switches"] : ["kind", "clipId", "start", "end", "cuts"]
    );
    const cuts = action.kind === "switches" ? action.switches : action.cuts;
    if (!Array.isArray(cuts) || !cuts.length || cuts.length > 2e3)
      throw new Error("切点须包含 1 至 2000 项");
    for (const cut of cuts) object6(cut, ["time", "angleId"]);
    return action.kind === "switches" ? planMulticamSwitches(document, sequenceId, clipId, cuts) : planRecordMulticamSwitches(
      document,
      sequenceId,
      clipId,
      tick2(action.start),
      tick2(action.end),
      cuts
    );
  }
  throw new Error("未知多机位编辑");
}
function planSequenceStep(document, raw, factory) {
  const step = object6(raw, ["kind", "sequenceId", "action"]), action = object6(step.action, [
    "kind",
    "name",
    "width",
    "height",
    "frameRate",
    "background",
    "activate",
    "childSequenceId",
    "at",
    "trackId",
    "clipIds",
    "clipId"
  ]);
  if (action.activate !== void 0 && typeof action.activate !== "boolean")
    throw new Error("activate 须为布尔值");
  if (action.kind === "create") {
    if (step.sequenceId !== void 0) throw new Error("新建序列不能指定既有 sequenceId");
    object6(action, ["kind", "name", "width", "height", "frameRate", "background", "activate"]);
    object6(action.frameRate, ["numerator", "denominator"]);
    return planCreateSequence(document, {
      name: action.name,
      width: action.width,
      height: action.height,
      frameRate: action.frameRate,
      background: action.background,
      activate: action.activate,
      idFactory: factory
    }).operations;
  }
  const sequenceId = id4(step.sequenceId);
  switch (action.kind) {
    case "rename":
      object6(action, ["kind", "name"]);
      return planRenameSequence(document, sequenceId, action.name).operations;
    case "duplicate":
      object6(action, ["kind", "name", "activate"]);
      return planDuplicateSequence(document, sequenceId, {
        name: action.name,
        activate: action.activate,
        idFactory: factory
      }).operations;
    case "nest":
      object6(action, ["kind", "childSequenceId", "at", "trackId"]);
      return planNestSequence(document, sequenceId, id4(action.childSequenceId), {
        at: integer4(action.at, 0, Number.MAX_SAFE_INTEGER, "嵌套起点"),
        ...action.trackId === void 0 ? {} : { trackId: id4(action.trackId) },
        idFactory: factory
      }).operations;
    case "compound":
      object6(action, ["kind", "clipIds", "name"]);
      return planCreateCompound(document, sequenceId, ids2(action.clipIds), {
        name: action.name,
        idFactory: factory
      }).operations;
    case "unpack":
      object6(action, ["kind", "clipId"]);
      return planUnpackCompound(document, sequenceId, id4(action.clipId), {
        idFactory: factory
      }).operations;
    case "remove":
      object6(action, ["kind"]);
      return planRemoveSequence(document, sequenceId).operations;
    default:
      throw new Error("未知序列编辑");
  }
}
function planCaptionsStep(document, raw, factory) {
  const step = object6(raw, ["kind", "sequenceId", "action"]), sequenceId = id4(step.sequenceId), action = object6(step.action, [
    "kind",
    "text",
    "trackId",
    "clipId",
    "clipIds",
    "patch",
    "language",
    "mode",
    "translations",
    "transcripts",
    "assetIds",
    "wordHighlight",
    "preset",
    "start",
    "end"
  ]);
  switch (action.kind) {
    case "add":
      object6(action, ["kind", "text", "start", "end", "trackId"]);
      return planAddCaptions(
        document,
        sequenceId,
        [
          {
            text: action.text,
            start: action.start,
            end: action.end,
            ...action.trackId === void 0 ? {} : { trackId: id4(action.trackId) }
          }
        ],
        { idFactory: () => factory("clip") }
      );
    case "import-srt":
      object6(action, ["kind", "text", "trackId"]);
      return planSrtImport(document, sequenceId, action.text, {
        ...action.trackId === void 0 ? {} : { trackId: id4(action.trackId) },
        idFactory: () => factory("clip")
      }).operations;
    case "from-transcripts": {
      object6(action, ["kind", "transcripts", "trackId", "assetIds", "wordHighlight"]);
      if (action.wordHighlight !== void 0 && typeof action.wordHighlight !== "boolean")
        throw new Error("wordHighlight 须为布尔值");
      if (!Array.isArray(action.transcripts) || !action.transcripts.length || action.transcripts.length > 2e3)
        throw new Error("请选择真实转写来源");
      const transcripts = /* @__PURE__ */ new Map();
      for (const value of action.transcripts) {
        const item = object6(value, ["assetId", "segments"]), assetId = id4(item.assetId);
        if (transcripts.has(assetId)) throw new Error("转写来源不能重复");
        if (!document.assets.some((asset2) => asset2.id === assetId))
          throw new Error("转写素材不存在");
        if (!Array.isArray(item.segments)) throw new Error("转写段落须为数组");
        for (const segment of item.segments) {
          object6(segment, ["id", "start", "end", "text", "words"]);
          if (segment.words !== void 0) {
            if (!Array.isArray(segment.words)) throw new Error("转写词须为数组");
            for (const word of segment.words) object6(word, ["text", "start", "end", "probability"]);
          }
        }
        transcripts.set(assetId, validateCaptionTranscript(item.segments));
      }
      return planTranscriptCaptions(document, sequenceId, transcripts, {
        ...action.trackId === void 0 ? {} : { trackId: id4(action.trackId) },
        ...action.assetIds === void 0 ? {} : { assetIds: ids2(action.assetIds) },
        wordHighlight: action.wordHighlight,
        idFactory: () => factory("clip")
      }).operations;
    }
    case "text":
      object6(action, ["kind", "clipId", "text"]);
      return planCaptionText(document, sequenceId, id4(action.clipId), action.text);
    case "style":
      object6(action, ["kind", "clipIds", "patch"]);
      return planCaptionStyle(
        document,
        sequenceId,
        ids2(action.clipIds),
        object6(action.patch, [...Object.keys(defaultTextStyle()), "keywords"])
      );
    case "translate":
      object6(action, ["kind", "clipIds", "language", "mode", "translations"]);
      if (!Array.isArray(action.translations)) throw new Error("译文须为数组");
      for (const translation of action.translations) object6(translation, ["id", "text"]);
      return planCaptionTranslation(
        document,
        sequenceId,
        ids2(action.clipIds),
        action.language,
        action.mode,
        action.translations
      ).operations;
    case "detach":
      object6(action, ["kind", "clipIds"]);
      return planDetachCaptions(document, sequenceId, ids2(action.clipIds));
    case "preset":
      object6(action, ["kind", "preset"]);
      return planCaptionPreset(document, sequenceId, action.preset);
    default:
      throw new Error("未知字幕编辑");
  }
}
function compileEditorSteps(document, steps, factory) {
  if (!Array.isArray(steps) || !steps.length || steps.length > EDITOR_AGENT_LIMITS.steps)
    throw new Error("编辑须包含 1 至 100 个步骤");
  let draft = document;
  const operations = [];
  for (const raw of json(steps)) {
    const batch = plan(draft, object6(raw, Object.keys(raw ?? {})), factory);
    if (operations.length + batch.length > EDITOR_AGENT_LIMITS.operations)
      throw new Error("展开后的编辑超过 1000 项，请拆分范围");
    draft = applyEditorOperations(draft, batch, draft.revision);
    operations.push(...batch);
  }
  return operations;
}
function createEditorAgentTools(context2) {
  if (typeof context2.authorize !== "function") throw new Error("v2 工具必须连接制作与录制权限检查");
  const factory = context2.idFactory ?? ((kind) => `${kind}-${randomId()}`);
  const exportSubmissions = createExportSubmissions();
  const current = (expected2) => {
    const session = context2.session(), found = session.getState().identity;
    sameIdentity(session, expected2 === void 0 ? found : identity(expected2), false);
    return { session, identity: found, document: session.read() };
  };
  const recheck = (snapshot) => {
    if (context2.session() !== snapshot.session) throw new Error("活动编辑会话已切换，请重新读取");
    sameIdentity(snapshot.session, snapshot.identity);
  };
  let clipboard;
  const clipboardWorkflow = async (value) => {
    const args = object6(json(value), ["identity", "clipboard", "grant"]), automatic = grant(args.grant), snapshot = current(identity(args.identity)), request = object6(args.clipboard, [
      "action",
      "sequenceId",
      "clipIds",
      "clipboardId",
      "at",
      "trackId"
    ]);
    recheck(snapshot);
    if (clipboard && (clipboard.session !== snapshot.session || clipboard.generation !== snapshot.identity.generation))
      clipboard = void 0;
    if (!["copy", "cut", "paste"].includes(request.action)) throw new Error("未知剪贴板动作");
    object6(
      request,
      request.action === "paste" ? ["action", "sequenceId", "clipboardId", "at", "trackId"] : ["action", "sequenceId", "clipIds"]
    );
    const sequenceId = id4(request.sequenceId);
    let operations = [], next;
    if (request.action === "paste") {
      if (!clipboard || id4(request.clipboardId) !== clipboard.id)
        throw new Error("剪贴板已变化或工程已切换，请重新复制");
      operations = pasteClips(snapshot.document, sequenceId, clipboard.payload, {
        at: integer4(request.at, 0, Number.MAX_SAFE_INTEGER, "粘贴起点"),
        ...request.trackId === void 0 ? {} : { trackId: id4(request.trackId) },
        idFactory: factory
      });
    } else {
      const selected3 = ids2(request.clipIds), cut = request.action === "cut" ? planCutClips(snapshot.document, sequenceId, selected3) : void 0, payload = cut?.payload ?? copyClips(snapshot.document, sequenceId, selected3);
      operations = cut?.operations ?? [];
      next = {
        id: `clipboard-${randomId()}`,
        session: snapshot.session,
        generation: snapshot.identity.generation,
        payload
      };
    }
    if (operations.length) {
      if (operations.length > EDITOR_AGENT_LIMITS.operations)
        throw new Error("展开后的编辑超过 1000 项，请拆分范围");
      const after = applyEditorOperations(
        snapshot.document,
        operations,
        snapshot.identity.revision
      ), authorization = frozen({
        kind: "edit",
        identity: snapshot.identity,
        before: structuredClone(snapshot.document),
        after,
        ...automatic ? { grant: automatic } : {}
      }), annotations = await context2.authorize(authorization);
      recheck(snapshot);
      if (annotations) {
        if (!Array.isArray(annotations) || annotations.length > 10 || annotations.some((op) => op.type !== "project.production"))
          throw new Error("审批协调器只能补充制作状态");
        operations.push(...annotations);
      }
      context2.assertStillAuthorized?.(authorization);
      await snapshot.session.dispatchDurable(
        operations,
        snapshot.identity,
        request.action === "cut" ? "剪切片段" : "粘贴片段",
        "agent",
        context2.requestSignal?.(authorization)
      );
    }
    if (next) clipboard = next;
    const added = operations.flatMap(
      (op) => op.type === "clip.add" ? [{ sequenceId: op.sequenceId, clipId: op.clip.id }] : []
    );
    return {
      identity: snapshot.session.getState().identity,
      applied: operations.length > 0,
      clipboard: {
        clipboardId: clipboard.id,
        sequenceId: clipboard.payload.sequenceId,
        clipCount: clipboard.payload.document.sequences.find(
          (item) => item.id === clipboard.payload.sequenceId
        ).clips.length
      },
      addedClipIds: added.slice(0, 100),
      addedClipCount: added.length,
      addedClipIdsComplete: added.length <= 100
    };
  };
  const audioWorkflow = async (value, domain) => {
    const args = object6(json(value), ["identity", domain]), snapshot = current(identity(args.identity)), request = object6(args[domain], [
      "action",
      "sequenceId",
      "clipId",
      "jobId",
      "mode",
      "offset",
      "settings"
    ]), controller = domain === "separation" ? context2.separation : context2.enhancement;
    if (!controller) throw new Error("当前环境尚未连接声音处理器");
    const keys3 = {
      status: [],
      refresh: [],
      ...domain === "separation" ? { setup: [] } : {},
      start: ["sequenceId", "clipId", ...domain === "enhancement" ? ["settings"] : []],
      resume: ["sequenceId", "clipId", "jobId"],
      retry: ["sequenceId", "clipId", "jobId"],
      jobs: ["sequenceId", "clipId", "offset"],
      apply: domain === "separation" ? ["mode"] : [],
      cancel: ["jobId"]
    };
    if (typeof request.action !== "string" || !Object.hasOwn(keys3, request.action))
      throw new Error("未知声音处理动作");
    object6(request, ["action", ...keys3[request.action]]);
    const result = (data) => ({
      identity: snapshot.session.getState().identity,
      // Controller state uses optional undefined fields; the transport omits them.
      [domain]: json(JSON.parse(JSON.stringify(data)), EDITOR_AGENT_LIMITS.responseBytes - 1024)
    });
    if (request.action === "status") return result(controller.getState());
    if (request.action === "jobs") {
      const jobs = await controller.jobs(
        id4(request.sequenceId),
        id4(request.clipId),
        integer4(request.offset ?? 0, 0, 1e5, "任务偏移")
      );
      recheck(snapshot);
      return result(jobs);
    }
    recheck(snapshot);
    const annotations = await context2.authorize(
      frozen({
        kind: "edit",
        identity: snapshot.identity,
        before: structuredClone(snapshot.document)
      })
    );
    if (annotations?.length) throw new Error("处理前仍需保存制作状态，请重新读取工程");
    recheck(snapshot);
    if (request.action === "apply") {
      if (domain === "separation") {
        if (!["vocals", "instrumental", "both"].includes(request.mode))
          throw new Error("请选择人声、伴奏或两者");
        await context2.separation.apply(request.mode);
      } else await context2.enhancement.apply();
      return result(controller.getState());
    }
    if (request.action === "cancel") {
      if (id4(request.jobId) !== controller.getState().taskId)
        throw new Error("当前观察的任务已变化，请重新读取处理状态");
      if (!controller.cancel()) throw new Error("保存中的应用不能取消");
      return result(controller.getState());
    }
    const accepted = request.action === "setup" ? await context2.separation.installInBackground() : request.action === "refresh" ? await controller.refreshInBackground() : request.action === "start" ? domain === "separation" ? await context2.separation.startInBackground(
      id4(request.sequenceId),
      id4(request.clipId)
    ) : await context2.enhancement.startInBackground(
      id4(request.sequenceId),
      id4(request.clipId),
      validateAudioEnhancementSettings(request.settings)
    ) : await controller.resumeInBackground(
      id4(request.sequenceId),
      id4(request.clipId),
      id4(request.jobId),
      request.action === "retry"
    );
    return result({ ...accepted, status: "submitted", state: controller.getState() });
  };
  const portable = async (value) => {
    const args = object6(json(value), ["identity", "portable"]), snapshot = current(identity(args.identity)), request = object6(args.portable, [
      "action",
      "requestId",
      "resourceId",
      "pendingId",
      "path",
      "offset",
      "limit",
      "format"
    ]);
    if (!context2.portable) throw new Error("当前环境尚未连接工程包交付");
    recheck(snapshot);
    if (request.action === "status") {
      object6(request, ["action"]);
      return {
        identity: snapshot.identity,
        portable: json(context2.portable.getState(), EDITOR_AGENT_LIMITS.responseBytes - 1024)
      };
    }
    if (request.action === "inspect") {
      object6(request, ["action", "pendingId", "path", "offset", "limit", "format"]);
      return {
        identity: snapshot.identity,
        pendingId: id4(request.pendingId),
        page: readPage(
          context2.portable.readCandidate(id4(request.pendingId)),
          request.path,
          request.offset,
          request.limit,
          request.format
        )
      };
    }
    object6(request, ["action", "requestId", "resourceId", "pendingId"]);
    await context2.authorize(
      frozen({
        kind: "edit",
        identity: snapshot.identity,
        before: structuredClone(snapshot.document)
      })
    );
    recheck(snapshot);
    return {
      identity: snapshot.identity,
      portable: context2.portable.execute(request, snapshot.identity)
    };
  };
  const sync = async (value) => {
    const args = object6(json(value), ["identity", "sync"]), snapshot = current(identity(args.identity)), request = object6(args.sync, [
      "action",
      "requestId",
      "snapshotId",
      "conflictKey",
      "choice",
      "operationId",
      "offset",
      "limit",
      "reviewId",
      "expectedReviewId",
      "side",
      "expectedApplyId"
    ]);
    if (!context2.sync) throw new Error("当前环境尚未连接工程同步");
    if (request.action === "inspect") {
      object6(request, ["action", "expectedReviewId", "conflictKey", "side", "offset", "limit"]);
      const { action: _action, ...inspection } = request;
      const result = await context2.sync.inspectConflict(
        inspection,
        snapshot.identity
      );
      recheck(snapshot);
      return {
        identity: snapshot.identity,
        sync: json(result, EDITOR_AGENT_LIMITS.responseBytes - 1024)
      };
    }
    if (request.action === "status") {
      object6(request, ["action", "offset", "limit"]);
      const state = context2.sync.getState({
        offset: integer4(request.offset ?? 0, 0, 1e5, "状态偏移"),
        limit: integer4(request.limit ?? 20, 1, 50, "状态页大小")
      });
      return {
        identity: snapshot.identity,
        sync: json(JSON.parse(JSON.stringify(state)), EDITOR_AGENT_LIMITS.responseBytes - 1024)
      };
    }
    recheck(snapshot);
    await context2.authorize(
      frozen({
        kind: "edit",
        identity: snapshot.identity,
        before: structuredClone(snapshot.document)
      })
    );
    recheck(snapshot);
    return {
      identity: snapshot.identity,
      sync: context2.sync.execute(request, snapshot.identity)
    };
  };
  const align = async (value) => {
    const args = object6(json(value), ["identity", "alignment"]), snapshot = current(identity(args.identity)), request = object6(args.alignment, [
      "action",
      "requestId",
      "assetIds",
      "referenceAssetId",
      "windowSeconds",
      "maxOffsetSeconds",
      "jobId"
    ]);
    if (!["start", "cancel"].includes(request.action)) throw new Error("未知机位声音对齐动作");
    object6(
      request,
      request.action === "cancel" ? ["action", "jobId"] : [
        "action",
        "requestId",
        "assetIds",
        "referenceAssetId",
        "windowSeconds",
        "maxOffsetSeconds"
      ]
    );
    recheck(snapshot);
    await context2.authorize(
      frozen({
        kind: "edit",
        identity: snapshot.identity,
        before: structuredClone(snapshot.document)
      })
    );
    recheck(snapshot);
    if (request.action === "cancel") {
      if (!context2.cancelAlignment) throw new Error("当前环境未连接对齐任务取消");
      const status = await context2.cancelAlignment(id4(request.jobId), snapshot.identity.documentId);
      return {
        identity: snapshot.identity,
        alignment: {
          cancellationRequested: true,
          job: json(JSON.parse(JSON.stringify(status)), EDITOR_AGENT_LIMITS.responseBytes - 1024)
        }
      };
    }
    if (!context2.alignMulticam) throw new Error("当前环境未连接真实声音对齐");
    const result = await context2.alignMulticam(
      snapshot.document,
      ids2(request.assetIds),
      id4(request.referenceAssetId),
      {
        transferId: id4(request.requestId),
        windowSeconds: integer4(request.windowSeconds ?? 30, 3, 180, "分析秒数"),
        maxOffsetSeconds: integer4(request.maxOffsetSeconds ?? 10, 0, 60, "最大偏移秒数")
      }
    );
    return { identity: snapshot.identity, alignment: { ...result, status: "submitted" } };
  };
  const tools = {
    read_editor_project(value = {}) {
      const args = object6(json(value), ["identity", "view", "path", "offset", "limit", "format"]), snapshot = current(args.identity), state = snapshot.session.getState();
      if (args.view !== void 0 && !["document", "defaults"].includes(args.view))
        throw new Error("读取视图无效");
      const root = args.view === "defaults" ? {
        transform: defaultTransform(),
        color: defaultColorAdjustment(),
        audio: defaultAudioMix(),
        textStyle: defaultTextStyle()
      } : snapshot.document;
      return {
        identity: snapshot.identity,
        timebase: 24e4,
        schemaVersion: 2,
        state: {
          phase: state.phase,
          saveState: state.saveState,
          dirty: state.dirty,
          canUndo: state.canUndo,
          canRedo: state.canRedo
        },
        page: readPage(root, args.path, args.offset, args.limit, args.format)
      };
    },
    async apply_editor_edit(value) {
      if (value && typeof value === "object" && Object.hasOwn(value, "clipboard"))
        return clipboardWorkflow(value);
      if (value && typeof value === "object" && ["separation", "enhancement", "sync", "portable", "alignment"].some(
        (key) => Object.hasOwn(value, key)
      ))
        rejectGrant(value);
      if (value && typeof value === "object" && Object.hasOwn(value, "separation"))
        return audioWorkflow(value, "separation");
      if (value && typeof value === "object" && Object.hasOwn(value, "enhancement"))
        return audioWorkflow(value, "enhancement");
      if (value && typeof value === "object" && Object.hasOwn(value, "sync")) return sync(value);
      if (value && typeof value === "object" && Object.hasOwn(value, "portable"))
        return portable(value);
      if (value && typeof value === "object" && Object.hasOwn(value, "alignment"))
        return align(value);
      const args = object6(json(value), ["identity", "label", "steps", "grant"]), automatic = grant(args.grant), snapshot = current(identity(args.identity));
      recheck(snapshot);
      if (typeof args.label !== "string" || !args.label.trim() || args.label.length > 200)
        throw new Error("编辑说明须为 1 至 200 个字符");
      const operations = compileEditorSteps(snapshot.document, args.steps, factory);
      const after = applyEditorOperations(
        snapshot.document,
        operations,
        snapshot.identity.revision
      );
      const authorization = frozen({
        kind: "edit",
        identity: snapshot.identity,
        before: structuredClone(snapshot.document),
        after,
        steps: args.steps,
        ...automatic ? { grant: automatic } : {}
      });
      const annotations = await context2.authorize(authorization);
      recheck(snapshot);
      if (annotations) {
        if (!Array.isArray(annotations) || annotations.length > 10)
          throw new Error("审批协调器返回的制作状态无效");
        for (const op of annotations)
          if (op.type !== "project.production") throw new Error("审批协调器只能补充制作状态");
        operations.push(...annotations);
      }
      context2.assertStillAuthorized?.(authorization);
      const result = await snapshot.session.dispatchDurable(
        operations,
        snapshot.identity,
        args.label,
        "agent",
        context2.requestSignal?.(authorization)
      );
      const addedClipIds = result.sequences.flatMap(
        (seq) => seq.clips.filter(
          (clip3) => !snapshot.document.sequences.some(
            (old) => old.id === seq.id && old.clips.some((item) => item.id === clip3.id)
          )
        ).map((clip3) => ({ sequenceId: seq.id, clipId: clip3.id }))
      );
      return {
        applied: result.revision !== snapshot.identity.revision,
        identity: snapshot.session.getState().identity,
        operationCount: operations.length,
        addedClipIds: addedClipIds.slice(0, EDITOR_AGENT_LIMITS.pageItems),
        addedClipCount: addedClipIds.length,
        addedClipIdsComplete: addedClipIds.length <= EDITOR_AGENT_LIMITS.pageItems
      };
    },
    async render_editor_sequence(value) {
      rejectGrant(value);
      const args = object6(json(value), [
        "identity",
        "sequenceId",
        "profileId",
        "requestId",
        "action",
        "operationId"
      ]), snapshot = current(identity(args.identity));
      if (args.action === "cancel") {
        object6(args, ["identity", "action", "operationId"]);
        return exportSubmissions.cancel(id4(args.operationId), snapshot.identity);
      }
      object6(args, ["identity", "sequenceId", "profileId", "requestId"]);
      recheck(snapshot);
      const sequenceId = id4(args.sequenceId), profileId = id4(args.profileId);
      if (!snapshot.document.sequences.some((seq) => seq.id === sequenceId))
        throw new Error("导出序列不存在");
      const profile = snapshot.document.exportProfiles.find((item) => item.id === profileId);
      if (!profile) throw new Error("导出预设不存在，请读取 exportProfiles");
      if (!context2.exportSequence) throw new Error("当前环境没有连接新版后台导出");
      const request = frozen({
        kind: "export",
        identity: snapshot.identity,
        before: snapshot.document,
        sequenceId
      });
      const authorize = async () => {
        const updates = await context2.authorize(request);
        if (updates?.length) throw new Error("导出前仍需更新制作审批，请先完成相关编辑");
        recheck(snapshot);
      };
      await authorize();
      await snapshot.session.flush();
      recheck(snapshot);
      await authorize();
      const requestId = args.requestId === void 0 ? void 0 : id4(args.requestId);
      return exportSubmissions.accept(
        {
          identity: snapshot.identity,
          sequenceId,
          profileId,
          ...requestId ? { requestId } : {}
        },
        (signal) => {
          recheck(snapshot);
          return context2.exportSequence(
            frozen({
              identity: snapshot.identity,
              document: snapshot.document,
              sequenceId,
              profile
            }),
            { signal }
          );
        },
        context2.cancelExport
      );
    },
    async read_editor_jobs(value = {}) {
      const args = object6(json(value), [
        "jobIds",
        "offset",
        "limit",
        "path",
        "pageOffset",
        "format"
      ]);
      const submissions = exportSubmissions.list();
      if (typeof args.path === "string" && (args.path === "/submissions" || args.path.startsWith("/submissions/")))
        return { page: readPage({ submissions }, args.path, args.pageOffset, 50, args.format) };
      if (!context2.readJobs) throw new Error("当前环境没有连接后台任务读取");
      const jobIds = args.jobIds === void 0 ? void 0 : ids2(args.jobIds);
      if (jobIds && jobIds.length > 50) throw new Error("单次最多查询 50 个任务");
      const result = await context2.readJobs({
        ...jobIds ? { jobIds } : {},
        offset: integer4(args.offset ?? 0, 0, 1e5, "任务偏移"),
        limit: integer4(args.limit ?? 20, 1, 50, "任务数量")
      });
      return {
        page: readPage(
          { ...json(result, 16 * 1024 * 1024), submissions },
          args.path,
          args.pageOffset,
          50,
          args.format
        )
      };
    }
  };
  return tools;
}

// src/editor/export-range.ts
function validateExportRange(value, sequenceDuration2) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some((key) => key !== "start" && key !== "duration")) throw new Error("导出范围格式无效");
  const range = value;
  assertTick(range.start);
  assertTick(range.duration);
  if (!range.duration || range.start + range.duration > MAX_EDITOR_TICK || sequenceDuration2 !== void 0 && range.start + range.duration > sequenceDuration2) throw new Error("导出范围须位于当前序列内，且结束晚于开始");
  return { start: range.start, duration: range.duration };
}

// src/editor/production-guard.ts
var byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
var record4 = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
function dependencies(document, known = document) {
  const seen = /* @__PURE__ */ new Set(), assets = /* @__PURE__ */ new Set();
  const clip3 = (item) => {
    const base = {
      id: item.id,
      kind: item.kind,
      trackId: item.trackId,
      start: item.start,
      duration: item.duration
    };
    if (item.kind === "media") {
      assets.add(item.assetId);
      return { ...base, assetId: item.assetId, timeMap: item.timeMap, audio: item.audio };
    }
    if (item.kind === "sequence")
      return {
        ...base,
        nested: sequence5(item.sequenceId),
        timeMap: item.timeMap,
        audio: item.audio
      };
    if (item.kind === "multicam") {
      for (const angle of item.angles) assets.add(angle.assetId);
      return {
        ...base,
        angles: item.angles,
        switches: item.switches,
        audioAngleId: item.audioAngleId,
        timeMap: item.timeMap,
        audio: item.audio
      };
    }
    if (isSubtitleClip(item))
      return {
        ...base,
        text: item.text,
        words: item.words,
        translation: item.translation,
        sourceBinding: item.sourceBinding
      };
    return null;
  };
  const sequence5 = (id5) => {
    if (seen.has(id5)) return { reference: id5 };
    seen.add(id5);
    const value = document.sequences.find((item) => item.id === id5);
    return {
      id: id5,
      duration: sequenceDuration(value),
      frameRate: value.frameRate,
      tracks: value.tracks.filter(
        (track3) => value.clips.some(
          (item) => item.trackId === track3.id && (item.kind !== "text" || item.role === "subtitle") && item.kind !== "shape"
        )
      ).map((track3) => ({
        id: track3.id,
        kind: track3.kind,
        muted: track3.muted,
        hidden: track3.hidden,
        volume: track3.volume,
        pan: track3.pan
      })),
      clips: value.clips.slice().sort(byId).map(clip3).filter(Boolean),
      transitions: value.transitions.slice().sort(byId)
    };
  };
  const timeline = sequence5(document.activeSequenceId);
  const active = document.sequences.find((item) => item.id === document.activeSequenceId);
  return JSON.stringify({
    script: document.production?.script ?? "",
    // The recorded narration was approved against this picture size and arrangement,
    // as the old view's approval snapshot also records.
    canvas: { width: active.width, height: active.height, timelineMode: active.timelineMode },
    timeline,
    assets: document.assets.filter((item) => assets.has(item.id)).map((item) => ({
      id: item.id,
      kind: item.kind,
      duration: item.duration,
      resourceId: item.resourceId,
      // A newly computed fingerprint records an existing source; only a change to an
      // already known fingerprint establishes changed bytes. Proxies/analysis are preparation.
      fingerprint: known?.assets.find((asset2) => asset2.id === item.id)?.fingerprint ? item.fingerprint : void 0
    })).sort(byId)
  });
}
function reconcileEditorProduction(beforeValue, afterValue) {
  const before = validateEditorDocument(beforeValue), after = validateEditorDocument(afterValue);
  const narration = record4(before.production?.narration);
  if (!narration || !["approved", "recorded", "aligned"].includes(String(narration.phase)) || dependencies(before) === dependencies(after, before))
    return [];
  const recordingId = narration.recordingAssetId;
  const review = {
    phase: "review",
    captionBasis: "draft",
    draftCaptionIds: narration.draftCaptionIds ?? []
  };
  if (typeof recordingId === "string" && after.assets.some(
    (asset2) => asset2.id === recordingId && ["audio", "video"].includes(asset2.kind)
  ))
    review.recordingAssetId = recordingId;
  const production = structuredClone(after.production ?? {});
  production.narrationPreviousApproval = {
    ...structuredClone(narration),
    documentId: before.id,
    revision: before.revision,
    reason: "文案、字幕、声音或时间安排已改变，需重新审阅"
  };
  production.narration = review;
  return [{ type: "project.production", data: production }];
}

// src/editor/history.ts
var EditorHistory = class {
  constructor(document, limit = 50) {
    this.limit = limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw new Error("撤销历史数量须为 1–200");
    this.value = validateEditorDocument(document);
  }
  limit;
  value;
  past = [];
  future = [];
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get undoLabel() {
    return this.past.at(-1)?.label;
  }
  get redoLabel() {
    return this.future.at(-1)?.label;
  }
  get revision() {
    return this.value.revision;
  }
  get documentId() {
    return this.value.id;
  }
  read() {
    return structuredClone(this.value);
  }
  apply(operations, baseRevision, label3 = "编辑", actor = "user") {
    return this.prepare(operations, baseRevision, label3, actor).commit();
  }
  /** Validate before I/O, then publish exactly the prepared change after its durable receipt. */
  prepare(operations, baseRevision, label3 = "编辑", actor = "user") {
    const before = this.value;
    const after = applyEditorOperations(this.value, operations, baseRevision);
    return {
      document: structuredClone(after),
      commit: () => {
        if (this.value !== before) throw new Error("工程版本已变化，请重新操作");
        if (after.revision !== before.revision) {
          this.past.push({ label: label3, actor, before, after });
          this.past = this.past.slice(-this.limit);
          this.future = [];
          this.value = after;
        }
        return this.read();
      }
    };
  }
  restored(snapshot) {
    return validateEditorDocument({ ...snapshot, revision: this.value.revision + 1 });
  }
  undo() {
    const receipt = this.past.at(-1);
    if (!receipt) return this.read();
    const restored = this.restored(receipt.before);
    this.past.pop();
    this.future.push(receipt);
    this.value = restored;
    return this.read();
  }
  redo() {
    const receipt = this.future.at(-1);
    if (!receipt) return this.read();
    const restored = this.restored(receipt.after);
    this.future.pop();
    this.past.push(receipt);
    this.value = restored;
    return this.read();
  }
  /** Replace only after an import/restore has been fully validated; never preserve foreign undo. */
  replace(document) {
    const next = validateEditorDocument(document);
    this.value = next;
    this.past = [];
    this.future = [];
    return this.read();
  }
};

// src/editor/session.ts
function sameIdentity2(a, b, revisions = true) {
  return !!a && !!b && a.documentId === b.documentId && a.generation === b.generation && (!revisions || a.revision === b.revision);
}
var EditorStorageConflictError = class extends Error {
  constructor(message = "工程存储已被其他操作更新，请保留当前修改并解决版本冲突", actualRevision) {
    super(message);
    this.actualRevision = actualRevision;
    this.name = "EditorStorageConflictError";
  }
  actualRevision;
  code = "STORAGE_CONFLICT";
};
var generationCounter = 0;
function generation() {
  if (generationCounter >= Number.MAX_SAFE_INTEGER)
    throw new Error("编辑会话编号已耗尽，请重新启动");
  return ++generationCounter;
}
function revision(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("存储返回了无效版本，已阻止覆盖");
  return value;
}
function label2(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new Error("编辑说明须为 1 至 200 个字符");
  return value;
}
function cancelled(signal) {
  if (signal?.aborted) {
    const error = new Error("工程切换已取消");
    error.name = "AbortError";
    throw error;
  }
}
function isConflict(error) {
  return error instanceof EditorStorageConflictError || error !== null && typeof error === "object" && Object.getOwnPropertyDescriptor(error, "code")?.value === "STORAGE_CONFLICT";
}
function failure(error, kind, stage) {
  return {
    kind: isConflict(error) ? "conflict" : kind,
    stage,
    message: error instanceof Error ? error.message : typeof error === "string" ? error : "保存未完成，请稍后重试"
  };
}
function legacyCopy(raw) {
  const ancestors = /* @__PURE__ */ new Set();
  let nodes = 0, characters = 0;
  function copy(value, depth) {
    if (++nodes > 1e6 || depth > 64) throw new Error("旧工程结构超过验证范围");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      characters += value.length;
      if (characters > 16 * 1024 * 1024) throw new Error("旧工程文字超过验证范围");
      return value;
    }
    if (!value || typeof value !== "object" || ancestors.has(value))
      throw new Error("旧工程须为有效 JSON 数据");
    const array2 = Array.isArray(value), prototype = Object.getPrototypeOf(value), keys3 = Reflect.ownKeys(value);
    if ((array2 ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) || array2 && keys3.length !== value.length + 1)
      throw new Error("旧工程须为普通对象和完整数组");
    ancestors.add(value);
    const result = array2 ? [] : {};
    for (const key of keys3) {
      if (array2 && key === "length") continue;
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key) || array2 && !/^(0|[1-9]\d*)$/.test(key))
        throw new Error("旧工程包含无效数据键");
      characters += key.length;
      if (characters > 16 * 1024 * 1024) throw new Error("旧工程文字超过验证范围");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
        throw new Error("旧工程不能包含访问器");
      result[key] = copy(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
    return result;
  }
  return copy(raw, 0);
}
function imported(value) {
  if (value && typeof value === "object" && Object.getOwnPropertyDescriptor(value, "schemaVersion")?.value === 1) {
    const legacy = legacyCopy(value);
    return { document: migrateLegacyProject(legacy), legacy };
  }
  return { document: validateEditorDocument(value) };
}
var EditorSession = class _EditorSession {
  constructor(storage, document, storageRevision, delay, historyLimit, legacy) {
    this.storage = storage;
    this.storageRevision = storageRevision;
    this.delay = delay;
    this.history = new EditorHistory(document, historyLimit);
    this.legacy = legacy;
  }
  storage;
  storageRevision;
  delay;
  history;
  generation = generation();
  phase = "ready";
  fault = null;
  pending = null;
  requested = 0;
  saved = 0;
  writing = false;
  worker = null;
  replacement = null;
  timer = null;
  legacy;
  discardOnClose = false;
  listeners = /* @__PURE__ */ new Set();
  static async open(storage, options = {}) {
    const delay = options.autosaveDelayMs ?? 400;
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > 6e4)
      throw new Error("自动保存延迟须为 0 至 60000 毫秒");
    const stored = await storage.read(), base = revision(stored.revision);
    if (stored.data === null && options.initialDocument === void 0)
      throw new Error("尚无工程，请先提供新工程");
    const loaded = stored.data === null ? { document: validateEditorDocument(options.initialDocument) } : imported(stored.data);
    const session = new _EditorSession(
      storage,
      loaded.document,
      base,
      delay,
      options.historyLimit,
      "legacy" in loaded ? loaded.legacy : void 0
    );
    if (stored.data === null || session.legacy !== void 0)
      session.enqueue(stored.data === null ? "新建工程" : "升级旧工程");
    return session;
  }
  read() {
    return this.history.read();
  }
  getState() {
    return {
      identity: {
        documentId: this.history.documentId,
        generation: this.generation,
        revision: this.history.revision
      },
      storageRevision: this.storageRevision,
      phase: this.phase,
      saveState: this.fault?.kind === "conflict" ? "conflict" : this.writing ? "saving" : this.fault ? "failed" : this.requested > this.saved ? "pending" : "saved",
      dirty: this.requested > this.saved,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      undoLabel: this.history.undoLabel,
      redoLabel: this.history.redoLabel,
      legacyBackupPending: this.legacy !== void 0,
      error: this.fault ? { ...this.fault } : null
    };
  }
  subscribe(listener) {
    if (typeof listener !== "function") throw new Error("会话订阅需要回调");
    this.listeners.add(listener);
    this.publish(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  publish(listener) {
    try {
      listener(this.getState());
    } catch {
    }
  }
  notify() {
    for (const listener of [...this.listeners]) this.publish(listener);
  }
  editable() {
    if (this.phase !== "ready")
      throw new Error(
        this.phase === "closed" ? "编辑会话已关闭" : "正在保存并切换工程，请稍候再编辑"
      );
  }
  checkIdentity(identity2) {
    if (!sameIdentity2(identity2, this.getState().identity))
      throw new Error("工程或版本已改变，请基于当前工程重新操作");
  }
  dispatch(operations, baseRevision, editLabel = "编辑", actor = "user") {
    this.editable();
    label2(editLabel);
    if (actor !== "user" && actor !== "agent") throw new Error("未知编辑来源");
    if (actor === "agent" && typeof baseRevision === "number")
      throw new Error("AI 编辑需要工程、会话和版本身份");
    if (typeof baseRevision !== "number") this.checkIdentity(baseRevision);
    const before = this.history.revision;
    const after = this.history.apply(
      operations,
      typeof baseRevision === "number" ? baseRevision : baseRevision.revision,
      editLabel,
      actor
    );
    if (after.revision !== before) this.enqueue(editLabel);
    return after;
  }
  undo(identity2) {
    this.editable();
    if (identity2) this.checkIdentity(identity2);
    const before = this.history.revision, after = this.history.undo();
    if (after.revision !== before) this.enqueue("撤销");
    return after;
  }
  /** Persist an approved proposal before consuming it or making it visible in editing history. */
  async dispatchDurable(operations, identity2, editLabel = "保存编辑", actor = "user", signal) {
    this.editable();
    this.checkIdentity(identity2);
    label2(editLabel);
    if (actor !== "user" && actor !== "agent") throw new Error("未知编辑来源");
    cancelled(signal);
    const prepared = this.history.prepare(operations, identity2.revision, editLabel, actor);
    let complete, reject;
    const completion = new Promise((resolve3, fail) => {
      complete = resolve3;
      reject = fail;
    });
    this.replacement = completion;
    void completion.catch(() => {
    });
    this.phase = "committing";
    this.notify();
    let submitting = false;
    try {
      await this.flushQueue();
      cancelled(signal);
      if (prepared.document.revision !== identity2.revision) {
        submitting = true;
        this.writing = true;
        this.fault = null;
        this.notify();
        const base = this.storageRevision;
        const stored = await this.storage.write(
          structuredClone(prepared.document),
          base,
          editLabel
        );
        this.storageRevision = this.receipt(stored, base);
        prepared.commit();
      }
      this.fault = null;
      complete();
      return this.history.read();
    } catch (error) {
      reject(error);
      if (submitting) this.fault = failure(error, "write", "commit");
      throw error;
    } finally {
      if (this.replacement === completion) this.replacement = null;
      this.writing = false;
      this.phase = "ready";
      this.notify();
    }
  }
  redo(identity2) {
    this.editable();
    if (identity2) this.checkIdentity(identity2);
    const before = this.history.revision, after = this.history.redo();
    if (after.revision !== before) this.enqueue("重做");
    return after;
  }
  clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  enqueue(editLabel) {
    this.pending = { sequence: ++this.requested, document: this.history.read(), label: editLabel };
    this.clearTimer();
    if (this.fault?.kind !== "conflict")
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush().catch(() => {
        });
      }, this.delay);
    this.notify();
  }
  receipt(value, base) {
    try {
      const next = revision(value?.revision);
      if (next <= base) throw new Error("non-incrementing revision");
      return next;
    } catch {
      throw new EditorStorageConflictError(
        "保存回执缺少有效新版本，无法确认存储状态，请保留当前工程并检查存储"
      );
    }
  }
  async drain() {
    while (this.pending && !this.discardOnClose) {
      const request = this.pending;
      this.pending = null;
      this.writing = true;
      this.fault = null;
      this.notify();
      let kind = "backup";
      try {
        if (this.legacy !== void 0) {
          await this.storage.backupLegacy(legacyCopy(this.legacy));
          this.legacy = void 0;
        }
        if (this.discardOnClose) break;
        kind = "write";
        const base = this.storageRevision;
        const stored = await this.storage.write(
          structuredClone(request.document),
          base,
          request.label
        );
        this.storageRevision = this.receipt(stored, base);
        this.saved = request.sequence;
      } catch (error) {
        if (!this.pending && !this.discardOnClose) this.pending = request;
        this.fault = failure(error, kind, "save");
        this.clearTimer();
        throw error;
      } finally {
        this.writing = false;
        this.notify();
      }
    }
  }
  /** Wait for all edits requested before or during this flush. Calls share one strictly ordered writer. */
  async flush() {
    if (this.phase === "closed") throw new Error("编辑会话已关闭");
    do {
      if (this.replacement) await this.replacement;
      await this.flushQueue();
    } while (this.replacement || this.pending || this.worker);
  }
  async flushQueue() {
    this.clearTimer();
    if (this.fault?.kind === "conflict") throw new EditorStorageConflictError(this.fault.message);
    do {
      if (!this.worker && this.pending) {
        const run = Promise.resolve().then(() => this.drain()).finally(() => {
          if (this.worker === run) this.worker = null;
        });
        this.worker = run;
        void run.catch(() => {
        });
      }
      if (this.worker) await this.worker;
    } while (this.pending && !this.discardOnClose);
  }
  async replace(value, options = {}) {
    this.editable();
    if (options.identity) this.checkIdentity(options.identity);
    cancelled(options.signal);
    const editLabel = label2(options.label ?? "打开工程"), loaded = imported(value), current = this.history.read();
    if (loaded.document.id === current.id)
      loaded.document = validateEditorDocument({
        ...loaded.document,
        revision: Math.max(loaded.document.revision, current.revision + 1)
      });
    let complete, reject;
    const completion = new Promise((resolve3, fail) => {
      complete = resolve3;
      reject = fail;
    });
    this.replacement = completion;
    void completion.catch(() => {
    });
    this.phase = "replacing";
    this.notify();
    let stage = "old";
    try {
      await this.flushQueue();
      cancelled(options.signal);
      if (loaded.legacy !== void 0) {
        stage = "backup";
        await this.storage.backupLegacy(legacyCopy(loaded.legacy));
        cancelled(options.signal);
      }
      stage = "write";
      this.writing = true;
      this.notify();
      const base = this.storageRevision;
      const stored = await this.storage.write(structuredClone(loaded.document), base, editLabel);
      this.storageRevision = this.receipt(stored, base);
      this.history.replace(loaded.document);
      this.generation = generation();
      this.pending = null;
      this.saved = this.requested;
      this.legacy = void 0;
      this.fault = null;
      complete();
      return this.history.read();
    } catch (error) {
      reject(error);
      if (stage !== "old" && !(error instanceof Error && error.name === "AbortError"))
        this.fault = failure(error, stage === "backup" ? "backup" : "write", "replace");
      throw error;
    } finally {
      if (this.replacement === completion) this.replacement = null;
      this.writing = false;
      this.phase = "ready";
      this.notify();
    }
  }
  /** Explicitly discard only unsubmitted saves when save:false. In-flight writes always finish before close resolves. */
  async close(options = {}) {
    if (this.phase === "closed") return;
    this.editable();
    this.phase = "closing";
    this.clearTimer();
    this.notify();
    try {
      if (options.save !== false) await this.flush();
      else {
        this.discardOnClose = true;
        this.pending = null;
        await this.worker?.catch(() => {
        });
      }
      this.phase = "closed";
      this.notify();
      this.listeners.clear();
    } catch (error) {
      this.phase = "ready";
      this.notify();
      throw error;
    }
  }
};

// native/project-store.ts
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { link, lstat, mkdir, open, realpath, rename, rm, rmdir, unlink } from "node:fs/promises";
var PROJECT_FILE = "video-studio-cli.json";
var DOCUMENT_BYTES = 32 * 1024 * 1024;
var REQUEST_BYTES = 256 * 1024;
var OUTPUT_BYTES = 64 * 1024;
var cliError = (code, message) => Object.assign(new Error(message), { code });
var contentRevision = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function readJsonFile(path, limit) {
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit)
      throw cliError("INPUT_LIMIT", `JSON 输入须为最多 ${limit} 字节的普通文件`);
    const bytes = Buffer.alloc(Math.min(info.size + 1, limit + 1));
    let count = 0;
    while (count < bytes.length) {
      const { bytesRead } = await file.read(bytes, count, bytes.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    const after = await file.stat();
    if (count !== info.size || count > limit || after.size !== info.size || after.mtimeMs !== info.mtimeMs)
      throw cliError("INPUT_CHANGED", "JSON 文件在读取时变化，请重新读取");
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count));
      return { data: JSON.parse(content), content };
    } catch {
      throw cliError("INVALID_INPUT", "文件不是有效 JSON");
    }
  } finally {
    await file.close();
  }
}
async function createProjectStore(project) {
  const supplied = resolve(project), suppliedInfo = await lstat(supplied);
  if (!suppliedInfo.isDirectory() || suppliedInfo.isSymbolicLink())
    throw cliError("UNSAFE_PATH", "CLI 项目须为真实目录，不能是符号链接");
  const root = await realpath(supplied), identity2 = await lstat(root);
  const checkRoot = async () => {
    const current = await lstat(root);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity2.dev || current.ino !== identity2.ino || await realpath(root) !== root)
      throw cliError("UNSAFE_PATH", "CLI 项目目录已改变");
  };
  const pathFor = async (path, createParents = false) => {
    await checkRoot();
    if (typeof path !== "string" || !path || path.length > 512 || isAbsolute(path) || /[\\\x00:]/u.test(path))
      throw cliError("UNSAFE_PATH", "输出须为项目内的相对路径");
    const parts = path.split("/");
    if (parts.some((part2) => !part2 || part2.startsWith(".")))
      throw cliError("UNSAFE_PATH", "不允许隐藏路径、空路径或越界路径");
    let current = root;
    for (const [index2, part2] of parts.entries()) {
      current = join(current, part2);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (createParents && index2 < parts.length - 1) {
          await mkdir(current, { mode: 448 }).catch(async (failure2) => {
            if (failure2.code !== "EEXIST") throw failure2;
          });
          info = await lstat(current);
        }
      }
      if (info?.isSymbolicLink() || info && index2 < parts.length - 1 && !info.isDirectory())
        throw cliError("UNSAFE_PATH", "项目文件路径包含符号链接或无效父目录");
    }
    await checkRoot();
    return current;
  };
  const read = async () => {
    const path = await pathFor(PROJECT_FILE);
    try {
      const file = await readJsonFile(path, DOCUMENT_BYTES);
      return { ...file, revision: contentRevision(file.content) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return null;
    }
  };
  const lock = join(root, ".video-studio-cli-write.lock");
  const withLock = async (operation) => {
    const deadline = Date.now() + 5e3;
    let owned;
    for (; ; ) {
      await checkRoot();
      try {
        await mkdir(lock, { mode: 448 });
        owned = await lstat(lock);
        if (!owned.isDirectory() || owned.isSymbolicLink())
          throw cliError("UNSAFE_PATH", "CLI 写入锁无效");
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() >= deadline)
          throw cliError("PROJECT_BUSY", "另一个 CLI 正在写入；请确认写入者状态后重试");
        await new Promise((done) => setTimeout(done, 25));
      }
    }
    let result, failed, release;
    try {
      await checkRoot();
      result = await operation();
    } catch (error) {
      failed = error;
    }
    try {
      await checkRoot();
      const current = await lstat(lock);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== owned.dev || current.ino !== owned.ino)
        throw cliError("UNSAFE_PATH", "CLI 写入锁所有者已改变，保留该锁");
      await rmdir(lock);
    } catch (error) {
      release = error;
    }
    if (failed && release) throw new AggregateError([failed, release], "操作与写入锁释放均未完成");
    if (failed) throw failed;
    if (release) throw release;
    return result;
  };
  const publish = async (path, content, expected2, replace) => {
    if (Buffer.byteLength(content) > DOCUMENT_BYTES)
      throw cliError("INPUT_LIMIT", "工程超过 32 MiB");
    const destination = await pathFor(path, true), parent = dirname(destination), parentIdentity = await lstat(parent);
    const check = async () => {
      await pathFor(path);
      const info = await lstat(parent);
      if (info.dev !== parentIdentity.dev || info.ino !== parentIdentity.ino)
        throw cliError("UNSAFE_PATH", "输出父目录已改变");
      if (replace && ((await read())?.revision ?? null) !== expected2)
        throw cliError("REVISION_CONFLICT", "工程已变化，请重新读取并重新规划");
    };
    const temporary = join(parent, `.video-studio-${randomUUID()}.tmp`);
    let ownedTemporary = false;
    try {
      const file = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        384
      );
      ownedTemporary = true;
      try {
        await file.writeFile(content, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await check();
      if (replace && expected2 !== null) await rename(temporary, destination);
      else {
        try {
          await link(temporary, destination);
        } catch (error) {
          if (error.code === "EEXIST")
            throw cliError("REVISION_CONFLICT", "输出已存在，保留原文件");
          throw error;
        }
        await unlink(temporary);
      }
      return { path, revision: contentRevision(content), bytes: Buffer.byteLength(content) };
    } finally {
      if (ownedTemporary) await rm(temporary, { force: true });
    }
  };
  return {
    root,
    read,
    withLock,
    write: (data, expected2) => publish(PROJECT_FILE, `${JSON.stringify(data)}
`, expected2, true),
    export: (path, data) => {
      if (path === PROJECT_FILE) throw cliError("INVALID_INPUT", "导出路径不能覆盖 CLI 工程文件");
      return publish(path, `${JSON.stringify(data, null, 2)}
`, null, false);
    }
  };
}

// native/project-cli.ts
var plain = (value) => !!value && typeof value === "object" && !Array.isArray(value);
function fields(value, allowed) {
  if (!plain(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw cliError("INVALID_INPUT", "请求须为仅包含当前操作字段的 JSON 对象");
  return value;
}
function expected(value) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value))
    throw cliError("INVALID_INPUT", "写入需要 inspect 返回的 expectedRevision");
  return value;
}
function bounded(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > OUTPUT_BYTES)
    throw cliError("OUTPUT_LIMIT", "CLI 结果超过 64 KiB；请使用 inspect 分页读取");
  return value;
}
var revisionSchema = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
var objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});
var stringSchema = { type: "string", minLength: 1 };
var commands = [
  {
    name: "init",
    readOnly: false,
    inputSchema: objectSchema({
      name: stringSchema,
      width: { type: "integer" },
      height: { type: "integer" },
      frameRate: objectSchema(
        { numerator: { type: "integer" }, denominator: { type: "integer" } },
        ["numerator", "denominator"]
      )
    }),
    description: "Create a missing, empty schema-2 CLI project; preserve an existing project."
  },
  {
    name: "inspect",
    readOnly: true,
    inputSchema: objectSchema({
      expectedRevision: revisionSchema,
      view: { enum: ["document", "defaults"] },
      path: { type: "string" },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      format: { enum: ["tree", "json"] }
    }),
    description: "Bounded editor-domain JSON pointer pages; retain expectedRevision across pages."
  },
  {
    name: "validate",
    readOnly: true,
    inputSchema: objectSchema({ documentFile: stringSchema }),
    description: "Validate the saved project, or an explicitly supplied schema-2 JSON file."
  },
  {
    name: "edit",
    readOnly: false,
    inputSchema: objectSchema(
      {
        expectedRevision: revisionSchema,
        label: { type: "string", minLength: 1, maxLength: 200 },
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            required: ["kind"],
            properties: {
              kind: {
                enum: [
                  "operations",
                  "sequence",
                  "captions",
                  "multicam",
                  "marker",
                  "split",
                  "trim",
                  "timing",
                  "move",
                  "remove",
                  "transition",
                  "arrange",
                  "group",
                  "ungroup",
                  "duplicate"
                ]
              }
            },
            description: "The editor-v2 planner step contract; each kind rejects unknown fields."
          }
        }
      },
      ["expectedRevision", "label", "steps"]
    ),
    description: "Compile the same editor-v2 steps and atomically save one transaction. apply is an alias."
  },
  {
    name: "plan",
    readOnly: true,
    inputSchema: objectSchema({
      expectedRevision: revisionSchema,
      sequenceId: stringSchema,
      profileId: stringSchema,
      profile: {
        type: "object",
        description: "A complete editor-v2 ExportProfile, validated by the shared export domain."
      },
      range: objectSchema(
        { start: { type: "integer", minimum: 0 }, duration: { type: "integer", minimum: 1 } },
        ["start", "duration"]
      )
    }),
    description: "Validate export settings, rational frame count, encoder names and the audio-plan summary. Planning produces no media."
  },
  {
    name: "import",
    readOnly: false,
    inputSchema: objectSchema({ expectedRevision: revisionSchema, documentFile: stringSchema }, [
      "expectedRevision",
      "documentFile"
    ]),
    description: "Replace the independent CLI project with explicitly supplied schema-2 JSON after CAS; source media is not copied."
  },
  {
    name: "export",
    readOnly: false,
    inputSchema: objectSchema({ expectedRevision: revisionSchema, output: stringSchema }, [
      "output"
    ]),
    description: "Create a schema-2 project JSON file below this project without overwriting files; this is not video rendering or a media-inclusive .mimiproject bundle."
  }
];
function summary(document) {
  return {
    id: document.id,
    name: document.name,
    documentRevision: document.revision,
    schemaVersion: document.schemaVersion,
    timebase: document.timebase,
    activeSequenceId: document.activeSequenceId,
    assetCount: document.assets.length,
    sequenceCount: document.sequences.length
  };
}
function initialDocument(input) {
  const sequenceId = `sequence-${randomUUID2()}`;
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: 24e4,
    id: `project-${randomUUID2()}`,
    name: input.name ?? "视频工程",
    revision: 0,
    assets: [],
    activeSequenceId: sequenceId,
    sequences: [
      {
        id: sequenceId,
        name: "主序列",
        width: input.width ?? 1920,
        height: input.height ?? 1080,
        frameRate: input.frameRate ?? { numerator: 30, denominator: 1 },
        background: "#000000",
        timelineMode: "free",
        tracks: [
          createTrack(`track-${randomUUID2()}`, "video"),
          createTrack(`track-${randomUUID2()}`, "audio"),
          createTrack(`track-${randomUUID2()}`, "text")
        ],
        clips: [],
        transitions: [],
        markers: []
      }
    ],
    exportProfiles: createExportPresets()
  });
}
function parse(argv) {
  const [raw, ...remaining] = argv, command = raw === "apply" ? "edit" : raw;
  if (command !== "ops" && !commands.some((item) => item.name === command))
    throw cliError(
      "INVALID_ARGUMENT",
      "用法：video-studio.mjs ops | init|inspect|validate|edit|apply|plan|import|export --project <dir> [--input-file <json>]"
    );
  const options = {};
  while (remaining.length) {
    const flag = remaining.shift(), value = remaining.shift();
    if (!["--project", "--input-file"].includes(flag) || options[flag] || !value || value.startsWith("--"))
      throw cliError("INVALID_ARGUMENT", `参数无效：${flag}`);
    options[flag] = value;
  }
  if (command === "ops" && Object.keys(options).length)
    throw cliError("INVALID_ARGUMENT", "ops 不接受项目或请求文件参数");
  if (["edit", "import", "export"].includes(command) && !options["--input-file"])
    throw cliError("INVALID_ARGUMENT", `${command} 需要 --input-file`);
  return { command, options };
}
async function runProjectCli(argv, cwd = process.cwd()) {
  const { command, options } = parse(argv);
  if (command === "ops")
    return {
      ok: true,
      result: {
        format: "codeshell.video-studio.cli",
        schemaVersion: 1,
        commands,
        projectFile: PROJECT_FILE,
        node: ">=20.10",
        limits: {
          requestBytes: REQUEST_BYTES,
          documentBytes: DOCUMENT_BYTES,
          outputBytes: OUTPUT_BYTES
        },
        persistence: "Independent CLI file; explicit schema-2 import/export exchanges data with the panel. No Host storage, task IDs or resource grants are inferred.",
        time: "240000 ticks/second; frameRate is {numerator,denominator}.",
        editExample: {
          expectedRevision: "<inspect revision>",
          label: "重命名",
          steps: [
            { kind: "operations", operations: [{ type: "project.rename", name: "我的视频" }] }
          ]
        }
      }
    };
  const raw = options["--input-file"] ? (await readJsonFile(resolve2(cwd, options["--input-file"]), REQUEST_BYTES)).data : {};
  const allowed = {
    init: ["name", "width", "height", "frameRate"],
    inspect: ["expectedRevision", "view", "path", "offset", "limit", "format"],
    validate: ["documentFile"],
    edit: ["expectedRevision", "label", "steps"],
    plan: ["expectedRevision", "sequenceId", "profileId", "profile", "range"],
    import: ["expectedRevision", "documentFile"],
    export: ["expectedRevision", "output"]
  };
  const input = fields(raw, allowed[command]);
  if (command === "validate" && input.documentFile !== void 0) {
    if (typeof input.documentFile !== "string" || !input.documentFile)
      throw cliError("INVALID_INPUT", "documentFile 须为明确指定的 JSON 文件路径");
    const document = validateEditorDocument(
      (await readJsonFile(resolve2(cwd, input.documentFile), DOCUMENT_BYTES)).data
    );
    return { ok: true, result: { valid: true, ...summary(document), mediaChecked: false } };
  }
  const store = await createProjectStore(resolve2(cwd, options["--project"] ?? "."));
  const result = (value) => bounded({ ok: true, project: store.root, projectFile: PROJECT_FILE, result: value });
  if (command === "init")
    return store.withLock(async () => {
      const existing = await store.read();
      if (existing)
        return result({
          initialized: false,
          revision: existing.revision,
          ...summary(validateEditorDocument(existing.data))
        });
      const document = initialDocument(input), receipt = { initialized: true, ...summary(document) };
      bounded(receipt);
      const saved = await store.write(document, null);
      return result({ ...receipt, revision: saved.revision });
    });
  const execute = async () => {
    const stored = await store.read();
    if (!stored)
      throw cliError("PROJECT_NOT_INITIALIZED", `当前项目缺少 ${PROJECT_FILE}，请先执行 init`);
    const document = validateEditorDocument(stored.data);
    if (input.expectedRevision !== void 0 && expected(input.expectedRevision) !== stored.revision)
      throw cliError("REVISION_CONFLICT", "工程已变化，请重新读取并重新规划");
    if (command === "inspect") {
      const { expectedRevision: _, ...request } = input;
      const session = await EditorSession.open({
        read: async () => ({ data: document, revision: 1 }),
        write: async () => {
          throw new Error("只读");
        },
        backupLegacy: async () => {
          throw new Error("只读");
        }
      });
      try {
        const tools = createEditorAgentTools({
          session: () => session,
          authorize: () => {
            throw new Error("只读");
          }
        });
        const read = tools.read_editor_project(request);
        return result({ revision: stored.revision, ...summary(document), page: read.page });
      } finally {
        await session.close();
      }
    }
    if (command === "validate")
      return result({
        valid: true,
        revision: stored.revision,
        ...summary(document),
        mediaChecked: false
      });
    if (command === "edit") {
      expected(input.expectedRevision);
      if (typeof input.label !== "string" || !input.label.trim() || input.label.length > 200)
        throw cliError("INVALID_INPUT", "编辑说明须为 1 至 200 个字符");
      const operations = compileEditorSteps(
        document,
        input.steps,
        (kind) => `${kind}-${randomUUID2()}`
      ), draft = applyEditorOperations(document, operations, document.revision), annotations = reconcileEditorProduction(document, draft), after = annotations.length ? applyEditorOperations(document, [...operations, ...annotations], document.revision) : draft;
      const receipt = {
        label: input.label,
        operationCount: operations.length,
        productionInvalidated: annotations.length > 0,
        ...summary(after)
      };
      bounded(receipt);
      const saved = await store.write(after, stored.revision);
      return result({ ...receipt, revision: saved.revision });
    }
    if (command === "import") {
      expected(input.expectedRevision);
      if (typeof input.documentFile !== "string" || !input.documentFile)
        throw cliError("INVALID_INPUT", "documentFile 须为明确指定的 JSON 文件路径");
      const imported2 = validateEditorDocument(
        (await readJsonFile(resolve2(cwd, input.documentFile), DOCUMENT_BYTES)).data
      ), receipt = { imported: true, ...summary(imported2), mediaCopied: false };
      bounded(receipt);
      const saved = await store.write(imported2, stored.revision);
      return result({ ...receipt, revision: saved.revision });
    }
    if (command === "export") {
      if (typeof input.output !== "string")
        throw cliError("INVALID_INPUT", "output 须为项目内的相对 JSON 路径");
      const receipt = {
        exported: true,
        mediaIncluded: false,
        ...summary(document),
        revision: stored.revision
      };
      bounded({ ...receipt, output: input.output });
      const saved = await store.export(input.output, document);
      return result({
        ...receipt,
        output: saved.path,
        outputRevision: saved.revision,
        bytes: saved.bytes
      });
    }
    if (input.profile !== void 0 && input.profileId !== void 0)
      throw cliError("INVALID_INPUT", "profile 与 profileId 只能提供一个");
    const sequenceId = input.sequenceId ?? document.activeSequenceId, sequence5 = document.sequences.find((item) => item.id === sequenceId);
    if (!sequence5) throw cliError("INVALID_INPUT", "导出序列不存在");
    const profileValue = input.profile ?? (input.profileId === void 0 ? document.exportProfiles[0] : document.exportProfiles.find((item) => item.id === input.profileId));
    if (!profileValue)
      throw cliError("INVALID_INPUT", "导出配置不存在，请提供完整 profile 或当前 profileId");
    const profile = validateExportProfile(profileValue), fullDuration = sequenceDuration(sequence5), range = validateExportRange(
      input.range ?? { start: 0, duration: fullDuration },
      fullDuration
    ), audio2 = compileAudioPlan(document, sequence5.id), frameCount = ticksToFrame(range.duration, profile.frameRate, "ceil");
    return result({
      planned: true,
      rendered: false,
      revision: stored.revision,
      sequenceId,
      profile,
      range,
      frameCount,
      durationSeconds: ticksToSeconds(range.duration),
      encodedDurationSeconds: frameCount * profile.frameRate.denominator / profile.frameRate.numerator,
      requiredEncoders: requiredExportEncoders(profile),
      dependenciesChecked: false,
      mediaChecked: false,
      audio: {
        sampleRate: audio2.sampleRate,
        channels: audio2.channels,
        requestedRangeSampleCount: Math.ceil((range.start + range.duration) / 5) - Math.ceil(range.start / 5),
        fullSequenceSampleCount: audio2.sampleCount,
        fullSequenceLaneCount: audio2.lanes.length,
        fullSequenceDuckingCount: audio2.ducking.length
      },
      next: "实际媒体导出使用已授权面板流程；CLI export 只导出工程 JSON。"
    });
  };
  return ["edit", "import", "export"].includes(command) ? store.withLock(execute) : execute();
}
try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || major === 20 && minor < 10)
    throw cliError("NODE_VERSION", "Video Studio CLI 需要 Node.js 20.10 或更新版本");
  process.stdout.write(`${JSON.stringify(bounded(await runProjectCli(process.argv.slice(2))))}
`);
} catch (error) {
  const rawCode = error?.code, code = typeof rawCode === "string" ? rawCode.slice(0, 100) : "OPERATION_FAILED";
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: { code, message: error instanceof Error ? error.message.slice(0, 1e3) : "CLI 操作未完成" } })}
`
  );
  process.exitCode = ["INVALID_INPUT", "INVALID_ARGUMENT", "INPUT_LIMIT"].includes(code) ? 2 : code === "REVISION_CONFLICT" ? 3 : code === "PROJECT_BUSY" ? 4 : 1;
}
export {
  runProjectCli
};
