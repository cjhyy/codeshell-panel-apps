import { validateAnimatedNumber, type AnimatedNumber } from "./animation";
import { validateExportProfile } from "./export-settings";
import {
  sourceTimeAt,
  validateFrameRate,
  validateTimeMap,
  TICKS_PER_SECOND,
  type Tick,
  type TimeMap,
} from "./time";
import type {
  AudioMix,
  ColorAdjustment,
  EditorAsset,
  EditorClip,
  EditorDocument,
  EditorSequence,
  EditorTrack,
  JsonData,
  Mask,
  MulticamClip,
  TextStyle,
  Transform,
  Transition,
  VisualProperties,
} from "./types";

export const MAX_EDITOR_TICK = 24 * 60 * 60 * TICKS_PER_SECOND;
const MAX_DOCUMENT_NODES = 1_000_000;
const MAX_DOCUMENT_CHARACTERS = 16 * 1024 * 1024;
const controls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/** Reject getters, symbols, cycles and dangerous keys before reading any user-provided property. */
function copyData(value: unknown): unknown {
  let nodes = 0,
    characters = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): unknown {
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
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (
      array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
    )
      throw new Error("工程数据必须是普通对象或数组");
    ancestors.add(item);
    try {
      const result: any = array ? [] : {};
      const keys = Reflect.ownKeys(item);
      if (array && keys.length !== (item as unknown[]).length + 1)
        throw new Error("工程数组不能有空洞或额外属性");
      for (const key of keys) {
        if (array && key === "length") continue;
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key))
          throw new Error("工程包含不安全的数据键");
        characters += key.length;
        if (characters > MAX_DOCUMENT_CHARACTERS) throw new Error("工程文字超过容量限制");
        if (array && !/^(0|[1-9]\d*)$/.test(key)) throw new Error("工程数组包含额外属性");
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
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

function object(value: unknown, allowed: readonly string[], label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}必须是对象`);
  const data = value as Record<string, any>;
  for (const key of Object.keys(data))
    if (!allowed.includes(key)) throw new Error(`${label}包含未知字段：${key}`);
  return data;
}
function list(value: unknown, limit: number, label: string, minimum = 0): any[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > limit)
    throw new Error(`${label}需要 ${minimum} 至 ${limit} 项`);
  return value;
}
function number(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${label}必须在 ${min} 至 ${max} 之间`);
  return value;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  const result = number(value, min, max, label);
  if (!Number.isSafeInteger(result)) throw new Error(`${label}必须是安全整数`);
  return result;
}
function tick(value: unknown, label: string, positive = false): Tick {
  return integer(value, positive ? 1 : 0, MAX_EDITOR_TICK, label);
}
function text(
  value: unknown,
  max: number,
  label: string,
  empty = false,
  multiline = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    controls.test(value) ||
    (!multiline && /[\n\r\t]/.test(value))
  )
    throw new Error(`${label}文字无效或超过 ${max} 字符`);
  return value;
}
function id(value: unknown, label: string): string {
  const result = text(value, 128, label);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(result)) throw new Error(`${label}无效`);
  return result;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}必须是布尔值`);
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${label}无效`);
  return value as T;
}
function color(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !(value === "transparent" || /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))
  )
    throw new Error(`${label}须为十六进制颜色或 transparent`);
  return value;
}
function unique<T extends { id: string }>(items: T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) throw new Error(`${label} ID 重复：${item.id}`);
    result.set(item.id, item);
  }
  return result;
}
function dataObject(value: unknown, label: string): { [key: string]: JsonData } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}必须是对象`);
  return value as { [key: string]: JsonData };
}

function animated(
  value: unknown,
  duration: Tick,
  min: number,
  max: number,
  label: string,
): AnimatedNumber {
  if (typeof value === "number") return number(value, min, max, label);
  const data = object(value, ["keyframes"], label);
  for (const raw of list(data.keyframes, 10_000, `${label}关键帧`, 1)) {
    const frame = object(raw, ["time", "value", "easing"], "关键帧");
    number(frame.value, min, max, label);
    if (typeof frame.easing === "object")
      object(frame.easing, ["type", "x1", "y1", "x2", "y2"], "缓动曲线");
  }
  return validateAnimatedNumber(data, duration);
}
function timeMap(value: unknown, duration: Tick, sourceDuration: Tick): TimeMap {
  const data = object(value, ["points"], "时间映射");
  for (const point of list(data.points, 10_000, "时间映射节点", 2))
    object(point, ["time", "source"], "时间映射节点");
  return validateTimeMap(data, duration, sourceDuration);
}
function assertNoEmptyHold(map: TimeMap, sourceDuration: Tick, label: string): void {
  if (
    map.points.some(
      (point, index) =>
        index > 0 &&
        point.source === sourceDuration &&
        map.points[index - 1]!.source === sourceDuration,
    )
  )
    throw new Error(`${label}不能在素材结束边界定格`);
}
function transform(value: unknown, duration: Tick): Transform {
  const data = object(
    value,
    ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "flipX", "flipY", "fit", "crop"],
    "构图",
  );
  const crop = object(data.crop, ["left", "top", "right", "bottom"], "裁切");
  const bounds = {
    left: number(crop.left, 0, 1, "左裁切"),
    top: number(crop.top, 0, 1, "上裁切"),
    right: number(crop.right, 0, 1, "右裁切"),
    bottom: number(crop.bottom, 0, 1, "下裁切"),
  };
  if (bounds.left + bounds.right >= 1 || bounds.top + bounds.bottom >= 1)
    throw new Error("裁切后必须保留有效画面");
  return {
    x: animated(data.x, duration, -10, 10, "水平位置"),
    y: animated(data.y, duration, -10, 10, "垂直位置"),
    scaleX: animated(data.scaleX, duration, 0, 100, "水平缩放"),
    scaleY: animated(data.scaleY, duration, 0, 100, "垂直缩放"),
    rotation: animated(data.rotation, duration, -360000, 360000, "旋转"),
    opacity: animated(data.opacity, duration, 0, 1, "不透明度"),
    flipX: bool(data.flipX, "水平翻转"),
    flipY: bool(data.flipY, "垂直翻转"),
    fit: choice(data.fit, ["contain", "cover", "stretch"], "画面适配"),
    crop: bounds,
  };
}
function adjustment(value: unknown, duration: Tick): ColorAdjustment {
  const data = object(
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
      "hsl",
    ],
    "调色",
  );
  const channels = new Set<string>();
  const curves: ColorAdjustment["curves"] = list(data.curves, 4, "调色曲线").map((raw) => {
    const curve = object(raw, ["channel", "points"], "调色曲线");
    const channel = choice(curve.channel, ["rgb", "red", "green", "blue"], "曲线通道");
    if (channels.has(channel)) throw new Error("调色曲线通道重复");
    channels.add(channel);
    let last = -1;
    const points = list(curve.points, 256, "曲线节点", 2).map((entry) => {
      const point = object(entry, ["x", "y"], "曲线节点");
      const x = number(point.x, 0, 1, "曲线输入"),
        y = number(point.y, 0, 1, "曲线输出");
      if (x <= last) throw new Error("调色曲线输入必须严格递增");
      last = x;
      return { x, y };
    });
    if (points[0]!.x !== 0 || points.at(-1)!.x !== 1) throw new Error("调色曲线必须覆盖 0 至 1");
    return { channel, points };
  });
  const hsl: ColorAdjustment["hsl"] = list(data.hsl, 24, "HSL 调整").map((raw) => {
    const band = object(raw, ["hue", "width", "hueShift", "saturation", "lightness"], "HSL 调整");
    return {
      hue: number(band.hue, 0, 360, "HSL 色相"),
      width: number(band.width, 0.001, 360, "HSL 范围"),
      hueShift: number(band.hueShift, -180, 180, "HSL 色相偏移"),
      saturation: number(band.saturation, -1, 1, "HSL 饱和度"),
      lightness: number(band.lightness, -1, 1, "HSL 明度"),
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
    hsl,
  };
}
function mask(value: unknown): Mask {
  const data = object(
    value,
    ["kind", "x", "y", "width", "height", "rotation", "feather", "inverted", "points"],
    "蒙版",
  );
  const kind = choice(data.kind, ["rectangle", "ellipse", "linear", "path"], "蒙版类型");
  let points: Mask["points"];
  if (kind === "path") {
    points = list(data.points, 256, "蒙版顶点", 3).map((raw) => {
      const point = object(raw, ["x", "y"], "蒙版顶点");
      return { x: number(point.x, 0, 1, "蒙版顶点 x"), y: number(point.y, 0, 1, "蒙版顶点 y") };
    });
    if (new Set(points.map((point) => `${point.x}:${point.y}`)).size < 3)
      throw new Error("路径蒙版至少需要三个不同顶点");
  } else if (data.points !== undefined) throw new Error("只有路径蒙版可以保存顶点");
  return {
    kind,
    x: number(data.x, -2, 2, "蒙版 x"),
    y: number(data.y, -2, 2, "蒙版 y"),
    width: number(data.width, 0.001, 4, "蒙版宽度"),
    height: number(data.height, 0.001, 4, "蒙版高度"),
    rotation: number(data.rotation, -360000, 360000, "蒙版旋转"),
    feather: number(data.feather, 0, 1, "蒙版羽化"),
    inverted: bool(data.inverted, "蒙版反转"),
    ...(points ? { points } : {}),
  };
}
function visual(data: Record<string, any>, duration: Tick): VisualProperties {
  return {
    transform: transform(data.transform, duration),
    color: adjustment(data.color, duration),
    blendMode: choice(
      data.blendMode,
      ["normal", "multiply", "screen", "overlay", "darken", "lighten"],
      "混合模式",
    ),
    ...(data.mask === undefined ? {} : { mask: mask(data.mask) }),
  };
}
function audio(value: unknown, duration: Tick): AudioMix {
  const data = object(
    value,
    ["volume", "pan", "fadeIn", "fadeOut", "pitchSemitones", "preservePitch", "ducking"],
    "音频混音",
  );
  let ducking: AudioMix["ducking"];
  if (data.ducking !== undefined) {
    const sidechain = object(
      data.ducking,
      ["sidechainTrackIds", "thresholdDb", "attenuationDb", "attack", "release"],
      "自动压低背景声",
    );
    const sidechainTrackIds = list(sidechain.sidechainTrackIds, 64, "参考音轨", 1).map((value) =>
      id(value, "参考音轨 ID"),
    );
    if (new Set(sidechainTrackIds).size !== sidechainTrackIds.length)
      throw new Error("参考音轨重复");
    ducking = {
      sidechainTrackIds,
      thresholdDb: number(sidechain.thresholdDb, -96, 0, "压低触发电平"),
      attenuationDb: number(sidechain.attenuationDb, 0, 60, "压低分贝"),
      attack: integer(sidechain.attack, 0, TICKS_PER_SECOND * 10, "压低启动时间"),
      release: integer(sidechain.release, 0, TICKS_PER_SECOND * 30, "压低恢复时间"),
    };
  }
  return {
    volume: animated(data.volume, duration, 0, 4, "音量"),
    pan: animated(data.pan, duration, -1, 1, "声像"),
    fadeIn: integer(data.fadeIn, 0, duration, "声音淡入"),
    fadeOut: integer(data.fadeOut, 0, duration, "声音淡出"),
    pitchSemitones: number(data.pitchSemitones, -24, 24, "音高"),
    preservePitch: bool(data.preservePitch, "保持音高"),
    ...(ducking ? { ducking } : {}),
  };
}
function textStyle(value: unknown): TextStyle {
  const data = object(
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
      "animation",
    ],
    "文字样式",
  );
  const shadow = object(data.shadow, ["color", "blur", "x", "y"], "文字阴影");
  return {
    layout: choice(data.layout, ["box", "caption-stack"], "文字布局"),
    fontFamily: text(data.fontFamily, 200, "字体"),
    fontSize: number(data.fontSize, 1, 2048, "字号"),
    fontWeight: integer(data.fontWeight, 1, 1000, "字重"),
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
    ...(data.keywords === undefined
      ? {}
      : {
          keywords: list(data.keywords, 32, "关键词强调").map((value) => {
            const keyword = object(value, ["text", "color"], "关键词强调");
            return {
              text: text(keyword.text, 200, "关键词"),
              color: color(keyword.color, "关键词颜色"),
            };
          }),
        }),
    shadow: {
      color: color(shadow.color, "文字阴影颜色"),
      blur: number(shadow.blur, 0, 256, "文字阴影模糊"),
      x: number(shadow.x, -2048, 2048, "文字阴影水平偏移"),
      y: number(shadow.y, -2048, 2048, "文字阴影垂直偏移"),
    },
    animation: choice(data.animation, ["none", "fade", "typewriter", "word-highlight"], "文字动画"),
  };
}
function asset(value: unknown): EditorAsset {
  const data = object(
    value,
    ["id", "name", "kind", "duration", "width", "height", "resourceId", "fingerprint", "metadata"],
    "素材",
  );
  const kind = choice(data.kind, ["video", "audio", "image", "demo"], "素材类型");
  let resourceId: string | undefined;
  if (data.resourceId !== undefined) {
    resourceId = text(data.resourceId, 256, "素材资源 ID");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(resourceId))
      throw new Error("素材资源 ID 无效");
  }
  if (
    data.fingerprint !== undefined &&
    (typeof data.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.fingerprint))
  )
    throw new Error("素材指纹须为 SHA-256");
  return {
    id: id(data.id, "素材 ID"),
    name: text(data.name, 256, "素材名称"),
    kind,
    duration: tick(data.duration, "素材时长", kind !== "image"),
    ...(data.width === undefined ? {} : { width: integer(data.width, 1, 32768, "素材宽度") }),
    ...(data.height === undefined ? {} : { height: integer(data.height, 1, 32768, "素材高度") }),
    ...(resourceId === undefined ? {} : { resourceId }),
    ...(data.fingerprint === undefined ? {} : { fingerprint: data.fingerprint }),
    ...(data.metadata === undefined ? {} : { metadata: dataObject(data.metadata, "素材元数据") }),
  };
}
function track(value: unknown): EditorTrack {
  const data = object(
    value,
    ["id", "name", "kind", "locked", "hidden", "muted", "volume", "pan"],
    "轨道",
  );
  return {
    id: id(data.id, "轨道 ID"),
    name: text(data.name, 200, "轨道名称"),
    kind: choice(data.kind, ["video", "audio", "text"], "轨道类型"),
    locked: bool(data.locked, "锁定轨道"),
    hidden: bool(data.hidden, "隐藏轨道"),
    muted: bool(data.muted, "静音轨道"),
    volume: number(data.volume, 0, 4, "轨道音量"),
    pan: number(data.pan, -1, 1, "轨道声像"),
  };
}

const clipKeys = [
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
  "mask",
];
function clip(value: unknown, assets: Map<string, EditorAsset>): EditorClip {
  const raw = object(
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
      "audioAngleId",
    ],
    "片段",
  );
  const kind = choice(raw.kind, ["media", "text", "shape", "sequence", "multicam"], "片段类型");
  const keys = {
    media: ["assetId", "timeMap", "audio"],
    text: ["role", "text", "style", "words", "sourceBinding", "translation"],
    shape: ["shape", "fill", "stroke", "strokeWidth"],
    sequence: ["sequenceId", "timeMap", "audio"],
    multicam: ["timeMap", "angles", "switches", "audioAngleId", "audio"],
  };
  const data = object(raw, [...clipKeys, ...keys[kind]], "片段");
  const start = tick(data.start, "片段起点"),
    duration = tick(data.duration, "片段时长", true);
  if (start + duration > MAX_EDITOR_TICK) throw new Error("片段末端超过 24 小时");
  const base = {
    id: id(data.id, "片段 ID"),
    trackId: id(data.trackId, "片段轨道 ID"),
    start,
    duration,
    label: text(data.label, 256, "片段名称", true),
    ...(data.groupId === undefined ? {} : { groupId: id(data.groupId, "分组 ID") }),
    ...(data.linkGroupId === undefined ? {} : { linkGroupId: id(data.linkGroupId, "关联组 ID") }),
    ...visual(data, duration),
  };
  if (kind === "media") {
    const assetId = id(data.assetId, "片段素材 ID"),
      source = assets.get(assetId);
    if (!source) throw new Error(`片段引用不存在的素材：${assetId}`);
    const mapping = timeMap(data.timeMap, duration, source.duration);
    if (source.kind !== "image") assertNoEmptyHold(mapping, source.duration, "媒体片段");
    return { ...base, kind, assetId, timeMap: mapping, audio: audio(data.audio, duration) };
  }
  if (kind === "sequence")
    return {
      ...base,
      kind,
      sequenceId: id(data.sequenceId, "嵌套序列 ID"),
      timeMap: timeMap(data.timeMap, duration, MAX_EDITOR_TICK),
      audio: audio(data.audio, duration),
    };
  if (kind === "shape")
    return {
      ...base,
      kind,
      shape: choice(data.shape, ["rectangle", "ellipse", "line"], "图形类型"),
      fill: color(data.fill, "图形填充"),
      stroke: color(data.stroke, "图形描边"),
      strokeWidth: number(data.strokeWidth, 0, 1024, "图形描边宽度"),
    };
  if (kind === "multicam") {
    const angles = list(data.angles, 32, "多机位", 2).map((raw) => {
      const angle = object(raw, ["id", "name", "assetId", "offset"], "机位");
      const assetId = id(angle.assetId, "机位素材 ID");
      if (assets.get(assetId)?.kind !== "video") throw new Error("多机位须引用有效的视频素材");
      return {
        id: id(angle.id, "机位 ID"),
        name: text(angle.name, 200, "机位名称"),
        assetId,
        offset: integer(angle.offset, -MAX_EDITOR_TICK, MAX_EDITOR_TICK, "机位同步偏移"),
      };
    });
    const anglesById = unique(angles, "机位");
    let previous = -1;
    const switches = list(data.switches, 10_000, "机位切换", 1).map((raw) => {
      const change = object(raw, ["time", "angleId"], "机位切换");
      const time = integer(change.time, 0, duration - 1, "机位切换时间");
      if (time <= previous) throw new Error("机位切换时间必须严格递增");
      previous = time;
      const angleId = id(change.angleId, "切换机位 ID");
      if (!anglesById.has(angleId)) throw new Error("切换引用不存在的机位");
      return { time, angleId };
    });
    if (switches[0]!.time !== 0) throw new Error("多机位须从零时刻指定画面");
    const audioAngleId = id(data.audioAngleId, "主声音机位 ID");
    if (!anglesById.has(audioAngleId)) throw new Error("主声音引用不存在的机位");
    return {
      ...base,
      kind,
      timeMap: timeMap(data.timeMap, duration, MAX_EDITOR_TICK),
      angles,
      switches,
      audioAngleId,
      audio: audio(data.audio, duration),
    };
  }
  let previousStart = -1,
    previousEnd = -1;
  const words = list(data.words, 10_000, "逐字字幕").map((raw) => {
    const word = object(raw, ["text", "start", "end"], "字幕词");
    const start = integer(word.start, 0, duration - 1, "字幕词入点");
    const end = integer(word.end, start + 1, duration, "字幕词出点");
    if (start < previousStart || end < previousEnd) throw new Error("字幕词时间必须按顺序排列");
    previousStart = start;
    previousEnd = end;
    return { text: text(word.text, 1000, "字幕词"), start, end };
  });
  let sourceBinding: Extract<EditorClip, { kind: "text" }>["sourceBinding"];
  if (data.sourceBinding !== undefined) {
    const binding = object(
      data.sourceBinding,
      ["clipId", "sourceStart", "sourceEnd", "provenance"],
      "字幕来源",
    );
    const sourceStart = tick(binding.sourceStart, "字幕源入点"),
      sourceEnd = tick(binding.sourceEnd, "字幕源出点");
    if (sourceEnd <= sourceStart) throw new Error("字幕来源须有有效时长");
    sourceBinding = { clipId: id(binding.clipId, "字幕来源片段 ID"), sourceStart, sourceEnd };
    if (binding.provenance !== undefined) {
      const raw = object(binding.provenance, ["path", "assetId", "start", "end"], "字幕实际音源");
      const start = tick(raw.start, "转写素材入点"),
        end = tick(raw.end, "转写素材出点");
      if (end <= start) throw new Error("字幕实际音源须有正时长");
      sourceBinding.provenance = {
        path: list(raw.path, 50, "嵌套音源路径").map((value) => id(value, "嵌套来源片段 ID")),
        assetId: id(raw.assetId, "转写素材 ID"),
        start,
        end,
      };
    }
  }
  let translation: Extract<EditorClip, { kind: "text" }>["translation"];
  if (data.translation !== undefined) {
    const translated = object(
      data.translation,
      ["original", "language", "mode", "originalWords"],
      "字幕翻译",
    );
    translation = {
      original: text(translated.original, 10000, "字幕原文", false, true),
      language: text(translated.language, 80, "字幕语言"),
      mode: choice(translated.mode, ["bilingual", "translated"], "字幕翻译模式"),
    };
    if (translated.originalWords !== undefined) {
      let previousStart = -1,
        previousEnd = -1;
      translation.originalWords = list(translated.originalWords, 10000, "字幕原文词时间").map(
        (raw) => {
          const word = object(raw, ["text", "start", "end"], "原文词");
          const start = integer(word.start, 0, duration - 1, "原文词入点"),
            end = integer(word.end, start + 1, duration, "原文词出点");
          if (start < previousStart || end < previousEnd)
            throw new Error("原文词时间必须按顺序排列");
          previousStart = start;
          previousEnd = end;
          return { text: text(word.text, 1000, "原文词"), start, end };
        },
      );
    }
  }
  return {
    ...base,
    kind: "text",
    role: choice(data.role, ["title", "subtitle"], "文字用途"),
    text: text(data.text, 10000, "文字内容", true, true),
    style: textStyle(data.style),
    words,
    ...(sourceBinding ? { sourceBinding } : {}),
    ...(translation ? { translation } : {}),
  };
}

/** Markers do not silently extend a sequence; an empty sequence has duration zero. */
export function sequenceDuration(sequence: Pick<EditorSequence, "clips">): Tick {
  let duration = 0;
  for (const clip of sequence.clips) {
    const end = tick(clip.start, "片段起点") + tick(clip.duration, "片段时长", true);
    if (end > MAX_EDITOR_TICK) throw new Error("序列超过 24 小时");
    duration = Math.max(duration, end);
  }
  return duration;
}

function sequence(value: unknown, assets: Map<string, EditorAsset>): EditorSequence {
  const data = object(
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
      "markers",
    ],
    "序列",
  );
  object(data.frameRate, ["numerator", "denominator"], "序列帧率");
  const tracks = list(data.tracks, 128, "轨道").map(track);
  unique(tracks, "轨道");
  const magneticTrackId =
    data.magneticTrackId === undefined ? undefined : id(data.magneticTrackId, "磁吸主轨 ID");
  if (
    magneticTrackId !== undefined &&
    !tracks.some((track) => track.id === magneticTrackId && track.kind === "video")
  )
    throw new Error("磁吸主轨必须引用现有画面轨");
  const clips = list(data.clips, 2000, "片段").map((value) => clip(value, assets));
  unique(clips, "片段");
  const transitions: Transition[] = list(data.transitions, 2000, "转场").map((raw) => {
    const transition = object(
      raw,
      ["id", "fromClipId", "toClipId", "start", "duration", "kind"],
      "转场",
    );
    const start = tick(transition.start, "转场起点"),
      duration = tick(transition.duration, "转场时长", true);
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
        "转场类型",
      ),
    };
  });
  unique(transitions, "转场");
  const markers = list(data.markers, 10_000, "时间轴标记").map((raw) => {
    const marker = object(raw, ["id", "time", "duration", "name", "note", "color"], "时间轴标记");
    const time = tick(marker.time, "标记时间"),
      duration = tick(marker.duration, "标记范围");
    if (time + duration > MAX_EDITOR_TICK) throw new Error("标记范围超过 24 小时");
    return {
      id: id(marker.id, "标记 ID"),
      time,
      duration,
      name: text(marker.name, 200, "标记名称"),
      note: text(marker.note, 10000, "标记备注", true, true),
      color: color(marker.color, "标记颜色"),
    };
  });
  unique(markers, "标记");
  return {
    id: id(data.id, "序列 ID"),
    name: text(data.name, 200, "序列名称"),
    width: integer(data.width, 16, 8192, "序列宽度"),
    height: integer(data.height, 16, 8192, "序列高度"),
    frameRate: validateFrameRate(data.frameRate),
    background: color(data.background, "序列背景"),
    timelineMode: choice(data.timelineMode, ["magnetic", "free"], "排列方式"),
    ...(magneticTrackId === undefined ? {} : { magneticTrackId }),
    tracks,
    clips,
    transitions,
    markers,
  };
}

function compatibleTrack(
  clip: EditorClip,
  track: EditorTrack,
  assets: Map<string, EditorAsset>,
): boolean {
  if (clip.kind === "text") return track.kind === "text";
  if (clip.kind === "shape" || clip.kind === "multicam") return track.kind === "video";
  if (clip.kind === "sequence") return track.kind !== "text";
  const source = assets.get(clip.assetId)!;
  return source.kind === "audio"
    ? track.kind === "audio"
    : source.kind === "video"
      ? track.kind !== "text"
      : track.kind === "video";
}
function multicamBounds(clip: MulticamClip, assets: Map<string, EditorAsset>): void {
  const angles = new Map(clip.angles.map((angle) => [angle.id, angle]));
  function range(angleId: string, start: Tick, end: Tick) {
    const angle = angles.get(angleId)!,
      source = assets.get(angle.assetId)!;
    const coordinates = [
      sourceTimeAt(clip.timeMap, start),
      ...clip.timeMap.points
        .filter((point) => point.time > start && point.time < end)
        .map((point) => point.source),
      sourceTimeAt(clip.timeMap, end),
    ];
    if (
      coordinates.some(
        (position) => position + angle.offset < 0 || position + angle.offset > source.duration,
      )
    )
      throw new Error(`机位 ${angle.name} 的画面或声音范围超出素材`);
    if (
      coordinates.some(
        (position, index) =>
          index > 0 &&
          position + angle.offset === source.duration &&
          coordinates[index - 1]! + angle.offset === source.duration,
      )
    )
      throw new Error(`机位 ${angle.name} 不能在素材结束边界定格`);
  }
  for (const [index, change] of clip.switches.entries())
    range(change.angleId, change.time, clip.switches[index + 1]?.time ?? clip.duration);
  const volume = clip.audio.volume;
  if (typeof volume === "number" ? volume > 0 : volume.keyframes.some((frame) => frame.value > 0))
    range(clip.audioAngleId, 0, clip.duration);
}
function checkSequenceReferences(
  sequence: EditorSequence,
  assets: Map<string, EditorAsset>,
  sequences: Map<string, EditorSequence>,
): void {
  const tracks = new Map(sequence.tracks.map((track) => [track.id, track]));
  const clips = new Map(sequence.clips.map((clip) => [clip.id, clip]));
  for (const clip of sequence.clips) {
    const track = tracks.get(clip.trackId);
    if (!track) throw new Error(`片段引用不存在的轨道：${clip.trackId}`);
    if (!compatibleTrack(clip, track, assets)) throw new Error(`片段 ${clip.id} 与轨道类型不兼容`);
    if (clip.kind === "sequence") {
      const source = sequences.get(clip.sequenceId);
      if (!source) throw new Error(`嵌套引用不存在的序列：${clip.sequenceId}`);
      const sourceDuration = sequenceDuration(source);
      if (!sourceDuration) throw new Error("嵌套片段不能引用空序列");
      validateTimeMap(clip.timeMap, clip.duration, sourceDuration);
      assertNoEmptyHold(clip.timeMap, sourceDuration, "嵌套片段");
    }
    if (clip.kind === "multicam") multicamBounds(clip, assets);
    if ("audio" in clip && clip.audio.ducking)
      for (const trackId of clip.audio.ducking.sidechainTrackIds) {
        const source = tracks.get(trackId);
        if (!source || source.kind === "text" || source.id === clip.trackId)
          throw new Error("压低背景声须引用其他有效声音轨道");
      }
    if (clip.kind === "text" && clip.sourceBinding) {
      const binding = clip.sourceBinding,
        source = clips.get(binding.clipId);
      if (!source || !("timeMap" in source)) throw new Error("字幕来源须引用有效的媒体或序列片段");
      const sourceSequence =
        source.kind === "sequence" ? sequences.get(source.sequenceId) : undefined;
      if (source.kind === "sequence" && !sourceSequence)
        throw new Error("字幕来源引用不存在的嵌套序列");
      const sourceDuration =
        source.kind === "media"
          ? assets.get(source.assetId)!.duration
          : source.kind === "sequence"
            ? sequenceDuration(sourceSequence!)
            : MAX_EDITOR_TICK;
      if (binding.sourceEnd > sourceDuration) throw new Error("字幕来源范围超出素材");
      if (binding.provenance) {
        let leaf = source;
        for (const clipId of binding.provenance.path) {
          if (leaf.kind !== "sequence") throw new Error("字幕嵌套音源路径须经过序列片段");
          const child = sequences.get(leaf.sequenceId)?.clips.find((item) => item.id === clipId);
          if (!child || !("timeMap" in child)) throw new Error("字幕嵌套音源不存在");
          leaf = child;
        }
        const assetId =
          leaf.kind === "media"
            ? leaf.assetId
            : leaf.kind === "multicam"
              ? leaf.angles.find((angle) => angle.id === leaf.audioAngleId)?.assetId
              : undefined;
        const asset = assets.get(binding.provenance.assetId);
        if (
          assetId !== binding.provenance.assetId ||
          !asset ||
          !["audio", "video"].includes(asset.kind) ||
          binding.provenance.end > asset.duration
        )
          throw new Error("字幕实际音源或转写范围与来源片段不一致");
      }
    }
  }
  const pairs = new Set<string>();
  for (const transition of sequence.transitions) {
    const from = clips.get(transition.fromClipId),
      to = clips.get(transition.toClipId);
    if (
      !from ||
      !to ||
      from.id === to.id ||
      from.trackId !== to.trackId ||
      tracks.get(from.trackId)?.kind !== "video"
    )
      throw new Error("转场两端须为同一画面轨的两个有效片段");
    const end = from.start + from.duration;
    if (
      from.start >= to.start ||
      end >= to.start + to.duration ||
      to.start >= end ||
      transition.start !== to.start ||
      transition.duration !== end - to.start
    )
      throw new Error("转场时间须精确覆盖前后片段的重叠范围");
    const key = JSON.stringify([from.id, to.id]);
    if (pairs.has(key)) throw new Error("同一片段交界不能重复设置转场");
    pairs.add(key);
  }
  for (const track of sequence.tracks.filter((track) => track.kind === "video")) {
    const placed = sequence.clips
      .filter((clip) => clip.trackId === track.id)
      .sort((a, b) => a.start - b.start || a.duration - b.duration);
    let active: EditorClip[] = [];
    for (const clip of placed) {
      active = active.filter((previous) => previous.start + previous.duration > clip.start);
      if (active.length > 1) throw new Error("同一画面轨不能同时重叠三个片段");
      for (const previous of active)
        if (!pairs.has(JSON.stringify([previous.id, clip.id])))
          throw new Error("同轨画面重叠需要明确的转场");
      active.push(clip);
    }
  }
}

export function validateEditorDocument(value: unknown): EditorDocument {
  const data = object(
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
      "production",
    ],
    "工程",
  );
  if (data.schemaVersion !== 2 || data.timebase !== TICKS_PER_SECOND)
    throw new Error("不支持此工程版本或时间基准");
  const assets = list(data.assets, 1000, "素材").map(asset),
    assetsById = unique(assets, "素材");
  const sequences = list(data.sequences, 50, "序列", 1).map((value) => sequence(value, assetsById));
  const sequencesById = unique(sequences, "序列");
  const activeSequenceId = id(data.activeSequenceId, "活动序列 ID");
  if (!sequencesById.has(activeSequenceId)) throw new Error("活动序列不存在");
  for (const sequence of sequences) checkSequenceReferences(sequence, assetsById, sequencesById);
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function acyclic(id: string) {
    if (visiting.has(id)) throw new Error("嵌套序列不能循环引用");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const clip of sequencesById.get(id)!.clips)
      if (clip.kind === "sequence") acyclic(clip.sequenceId);
    visiting.delete(id);
    visited.add(id);
  }
  for (const sequence of sequences) acyclic(sequence.id);
  const exportProfiles = list(data.exportProfiles, 64, "导出配置").map(validateExportProfile);
  unique(exportProfiles, "导出配置");
  return {
    schemaVersion: 2,
    timebase: TICKS_PER_SECOND,
    id: id(data.id, "工程 ID"),
    name: text(data.name, 200, "工程名称"),
    revision: integer(data.revision, 0, Number.MAX_SAFE_INTEGER - 1, "修订号"),
    assets,
    sequences,
    activeSequenceId,
    exportProfiles,
    ...(data.production === undefined
      ? {}
      : { production: dataObject(data.production, "制作记录") }),
  };
}
