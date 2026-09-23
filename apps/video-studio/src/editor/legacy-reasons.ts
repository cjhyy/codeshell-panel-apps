import type { LegacyProjectView, LegacyRestriction } from "./legacy-adapter";

/** Plain reasons for the 30 fps compatibility view's restriction codes. */
const REASONS: Readonly<Record<string, string>> = {
  "time-map": "包含变速或非整帧时间",
  "additional-track": "包含附加画面轨或文字",
  "primary-overlap": "主画面有互相重叠的片段",
  "clip-kind": "包含嵌套序列、多机位或图形",
  "caption-range": "包含超出主画面或非整帧时间的字幕",
  "independent-audio-range": "音频超出主画面范围或数量较多",
  "missing-legacy-asset": "片段的素材不可用",
  "asset-unavailable": "有素材无法在这里显示",
  "volume-automation": "包含音量自动化或超过 200% 的音量",
  "advanced-properties": "包含构图、调色、蒙版或混音设置",
  "advanced-caption": "包含自定义字幕样式、逐词时间或翻译",
  "sequence-rendering": "使用了其他帧率、背景色、转场或轨道混音",
  "annotation-unavailable": "制作记录无法在这里显示",
  "asset-tail": "素材末尾不足一整帧",
};
const FALLBACK = "包含这里无法显示的内容";

export function legacyRestrictionReason(code: string): string {
  return Object.hasOwn(REASONS, code) ? REASONS[code]! : FALLBACK;
}

/** Distinct reasons, in order; only rows the view leaves out unless `all` is set. */
export function legacyRestrictionReasons(
  restrictions: readonly Pick<LegacyRestriction, "code" | "excluded">[],
  { all = false }: { all?: boolean } = {},
): string[] {
  return [
    ...new Set(
      restrictions
        .filter((item) => all || item.excluded)
        .map((item) => legacyRestrictionReason(item.code)),
    ),
  ];
}

export interface LegacyClipIssue {
  /** The clip is not in the compatibility view, so frame-based actions cannot reach it. */
  excluded: boolean;
  reason: string | null;
  /** Why its volume cannot be written through the compatibility view. */
  volume?: string;
}

/** What the frame-based inspector cannot do with this clip (by editor or old ID), before any click. */
export function legacyClipIssue(view: LegacyProjectView, id: string): LegacyClipIssue | null {
  const excluded = view.restrictions.find((item) => item.clipId === id && item.excluded);
  if (excluded) return { excluded: true, reason: legacyRestrictionReason(excluded.code) };
  const mapping =
    view.clips.find((item) => item.clipId === id) ??
    view.clips.find((item) => item.legacyId === id && item.collection !== "captions");
  if (!mapping) return null;
  return {
    excluded: false,
    reason: null,
    ...(mapping.collection !== "captions" && !mapping.volumeWritable
      ? { volume: REASONS["volume-automation"]! }
      : {}),
  };
}

const EDIT_DIRECTLY = "请在时间线中直接编辑";
const RULES: ReadonlyArray<readonly [RegExp, string | ((...groups: string[]) => string)]> = [
  [
    /^.*旧视图未包含全部片段.*$/,
    `这个工程有片段无法在这里显示，不能在这里删除、移动或裁剪；${EDIT_DIRECTLY}`,
  ],
  [/^.*旧视图不完整.*时间线模式.*$/, "这个工程有片段无法在这里显示，请在时间线中切换磁吸排列"],
  [/^旧流程的基础视图已变化.*$/, "工程已变化，请刷新后重试"],
  [
    /([，,；;]\s*)?请使用新版方案格式/g,
    (_, mark) => `${mark ? "；" : ""}请改用 editor.steps 格式的方案`,
  ],
  [/(请?在)新版(属性面板|文字面板|流程界面)/g, "$1$2"],
  [/([，,；;]\s*)?请使用新版[^，。；;]*/g, (_, mark) => `${mark ? "；" : ""}${EDIT_DIRECTLY}`],
  [/在旧(?:流程|投影)中/g, "在这里"],
  [/^旧流程/, "这里"],
  [/按旧方案/g, "在这里"],
  [/旧方案/g, "旧格式方案"],
  [/旧版全局样式/g, "全局字幕样式"],
  [/(?:未|没有)完整投影/g, "无法在这里完整显示"],
  [/新版(构图|片段|字幕样式)/g, "$1"],
  [/新版编辑器/g, "属性面板"],
  [/新版渲染器/g, "完整成片渲染"],
  [/新版界面/g, "制作页面"],
  [/旧流程|旧视图|旧投影/g, "这里"],
];
const INTERNAL = /旧视图|旧流程|旧投影|旧方案|旧版全局|完整投影|新版(?!本| CodeShell| Chromium)/;

/** Compatibility refusals are written for the agent tools; people get the same fact in plain words. */
export function userFacingMessage(message: string): string {
  if (!INTERNAL.test(message)) return message;
  let plain = message;
  for (const [pattern, replacement] of RULES)
    plain = plain.replace(pattern, replacement as (substring: string, ...args: string[]) => string);
  return /旧视图|旧流程|旧投影|新版时间线/.test(plain)
    ? `这个操作无法在这里完成，${EDIT_DIRECTLY}`
    : plain;
}
