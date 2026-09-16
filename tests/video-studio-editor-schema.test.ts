import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { createExportPresets } from "../apps/video-studio/src/editor/export-settings";
import { TICKS_PER_SECOND as T } from "../apps/video-studio/src/editor/time";
import type {
  EditorClip,
  EditorDocument,
  EditorSequence,
  MediaClip,
  MulticamClip,
  SequenceClip,
  TextClip,
} from "../apps/video-studio/src/editor/types";
import {
  MAX_EDITOR_TICK,
  sequenceDuration,
  validateEditorDocument,
} from "../apps/video-studio/src/editor/validation";

function visual() {
  return {
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal" as const,
  };
}
function media(id = "clip", changes: Partial<MediaClip> = {}): MediaClip {
  return {
    id,
    kind: "media",
    trackId: "picture",
    start: 0,
    duration: 10 * T,
    label: "原片",
    assetId: "camera-a",
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: 10 * T, source: 10 * T },
      ],
    },
    audio: defaultAudioMix(),
    ...visual(),
    ...changes,
  };
}
function subtitle(changes: Partial<TextClip> = {}): TextClip {
  return {
    id: "caption",
    kind: "text",
    trackId: "text",
    start: T,
    duration: 3 * T,
    label: "字幕",
    role: "subtitle",
    text: "保留实际中文字幕",
    style: defaultTextStyle(),
    words: [
      { text: "保留", start: 0, end: T },
      { text: "实际中文字幕", start: T, end: 3 * T },
    ],
    sourceBinding: { clipId: "clip", sourceStart: T, sourceEnd: 4 * T },
    ...visual(),
    ...changes,
  };
}
function sequence(id = "main", clips: EditorClip[] = [media()]): EditorSequence {
  return {
    id,
    name: "主序列",
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30000, denominator: 1001 },
    background: "#0a0e10",
    timelineMode: "free",
    tracks: [
      createTrack("picture", "video"),
      createTrack("audio", "audio"),
      createTrack("text", "text"),
    ],
    clips,
    transitions: [],
    markers: [],
  };
}
function document(): EditorDocument {
  return {
    schemaVersion: 2,
    timebase: 240000,
    id: "project",
    name: "完整工程",
    revision: 7,
    assets: [
      {
        id: "camera-a",
        name: "第一机位.mp4",
        kind: "video",
        duration: 20 * T,
        resourceId: `asset-${"a".repeat(64)}`,
        fingerprint: "a".repeat(64),
        width: 1920,
        height: 1080,
        metadata: { sourcePath: "旅行/原片.mp4", data: [1, true, null] },
      },
      {
        id: "camera-b",
        name: "第二机位.mp4",
        kind: "video",
        duration: 15 * T,
        resourceId: `external-${"b".repeat(64)}`,
      },
      { id: "voice", name: "本人录音.wav", kind: "audio", duration: 20 * T },
      { id: "still", name: "封面.png", kind: "image", duration: 0 },
    ],
    sequences: [sequence()],
    activeSequenceId: "main",
    exportProfiles: createExportPresets(),
    production: {
      workflow: { brief: "真实工作流记录", stage: "review" },
      speechRecipe: { model: "local" },
    },
  };
}
const picture = (value: EditorDocument) => value.sequences[0]!.clips[0] as MediaClip;
function rejects(change: (value: any) => void, pattern?: RegExp): void {
  const value = document();
  change(value);
  assert.throws(() => validateEditorDocument(value), pattern);
}

test("v2 validation makes a complete independent copy preserving media references, production and rational frame rate", () => {
  const original = document();
  const before = structuredClone(original);
  const result = validateEditorDocument(original);
  assert.deepEqual(result, original);
  assert.notEqual(result, original);
  assert.notEqual(result.assets[0]!.metadata, original.assets[0]!.metadata);
  assert.notEqual(
    result.sequences[0]!.clips[0]!.transform,
    original.sequences[0]!.clips[0]!.transform,
  );
  assert.notEqual(result.exportProfiles[0]!.quality, original.exportProfiles[0]!.quality);
  result.assets[0]!.metadata!.sourcePath = "改后的显示名";
  result.sequences[0]!.clips[0]!.transform.crop.left = 0.25;
  assert.deepEqual(original, before);
});

test("defaults are independent and default text preserves a safe editable box layout", () => {
  const first = defaultTransform(),
    second = defaultTransform();
  first.crop.left = 0.2;
  assert.equal(second.crop.left, 0);
  const a = defaultColorAdjustment(),
    b = defaultColorAdjustment();
  a.curves.push({
    channel: "rgb",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  });
  assert.deepEqual(b.curves, []);
  assert.equal(defaultTextStyle().layout, "box");
  assert.equal(defaultTextStyle().maxWidth, 0.85);
  assert.deepEqual(createTrack("music", "audio"), {
    id: "music",
    name: "声音",
    kind: "audio",
    hidden: false,
    muted: false,
    locked: false,
    volume: 1,
    pan: 0,
  });
});

test("strict unknown-field rejection covers top level, clip discriminants and every delegated envelope", () => {
  const changes = [
    (d: any) => {
      d.hiddenEditor = {};
    },
    (d: any) => {
      d.sequences[0].clips[0].text = "media cannot masquerade as text";
    },
    (d: any) => {
      d.sequences[0].frameRate.rounding = "silent";
    },
    (d: any) => {
      d.sequences[0].clips[0].timeMap.speed = 2;
    },
    (d: any) => {
      d.sequences[0].clips[0].timeMap.points[0].extra = true;
    },
    (d: any) => {
      d.sequences[0].clips[0].transform.opacity = {
        keyframes: [{ time: 0, value: 1 }],
        code: "bad",
      };
    },
    (d: any) => {
      d.sequences[0].clips[0].transform.opacity = { keyframes: [{ time: 0, value: 1, extra: 1 }] };
    },
    (d: any) => {
      d.sequences[0].clips[0].transform.opacity = {
        keyframes: [
          {
            time: 0,
            value: 1,
            easing: { type: "cubic-bezier", x1: 0, y1: 0, x2: 1, y2: 1, run: "bad" },
          },
        ],
      };
    },
    (d: any) => {
      d.exportProfiles[0].quality.extra = true;
    },
  ];
  for (const change of changes) rejects(change, /未知|无效/);
});

test("untrusted JSON rejects prototype pollution, accessors, symbols, sparse arrays and cycles without invoking getters", () => {
  const polluted = JSON.parse(JSON.stringify(document()));
  polluted.production = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => validateEditorDocument(polluted), /不安全/);
  assert.equal(({} as any).polluted, undefined);
  rejects((d) => {
    d.assets[0].metadata = Object.create({ inherited: true });
  }, /普通对象/);
  let read = 0;
  const accessor = document();
  Object.defineProperty(accessor, "name", {
    enumerable: true,
    get() {
      read++;
      return "不要读取";
    },
  });
  assert.throws(() => validateEditorDocument(accessor), /访问器/);
  assert.equal(read, 0);
  rejects((d) => {
    d[Symbol("extra")] = true;
  }, /不安全/);
  rejects((d) => {
    delete d.assets[0];
  }, /空洞/);
  rejects((d) => {
    d.production.self = d.production;
  }, /循环/);
  rejects((d) => {
    d.production.missing = undefined;
  }, /JSON 数据/);
});

test("number, text, size and tick bounds reject nonfinite, fractional, oversized or unsafe data", () => {
  const changes = [
    (d: any) => {
      d.revision = Number.MAX_SAFE_INTEGER;
    },
    (d: any) => {
      d.sequences[0].width = 9000;
    },
    (d: any) => {
      d.sequences[0].clips[0].duration = 0;
    },
    (d: any) => {
      d.sequences[0].clips[0].start = 0.5;
    },
    (d: any) => {
      d.sequences[0].clips[0].start = MAX_EDITOR_TICK;
    },
    (d: any) => {
      d.sequences[0].clips[0].audio.pan = Infinity;
    },
    (d: any) => {
      d.sequences[0].clips[0].transform.scaleX = NaN;
    },
    (d: any) => {
      d.sequences[0].clips[0].groupId = "../other";
    },
    (d: any) => {
      d.name = "x".repeat(201);
    },
    (d: any) => {
      d.assets[0].resourceId = "/private/source.mp4";
    },
    (d: any) => {
      d.assets[0].fingerprint = "fake";
    },
  ];
  for (const change of changes) rejects(change);
});

test("collection limits bound imported projects before editing or rendering", () => {
  rejects((d) => {
    d.assets = Array.from({ length: 1001 }, (_, i) => ({ ...d.assets[0], id: `asset-${i}` }));
  }, /1000/);
  rejects((d) => {
    d.sequences = Array.from({ length: 51 }, (_, i) => ({ ...d.sequences[0], id: `seq-${i}` }));
  }, /50/);
  rejects((d) => {
    d.sequences[0].clips = Array.from({ length: 2001 }, (_, i) => ({
      ...d.sequences[0].clips[0],
      id: `clip-${i}`,
    }));
  }, /2000/);
  rejects((d) => {
    d.sequences[0].tracks = Array.from({ length: 129 }, (_, i) =>
      createTrack(`track-${i}`, "video"),
    );
  }, /128/);
});

test("unique IDs and live references are required within their declared scopes", () => {
  const changes = [
    (d: any) => {
      d.assets[1].id = d.assets[0].id;
    },
    (d: any) => {
      d.sequences.push(structuredClone(d.sequences[0]));
    },
    (d: any) => {
      d.sequences[0].tracks.push(structuredClone(d.sequences[0].tracks[0]));
    },
    (d: any) => {
      d.sequences[0].clips.push(structuredClone(d.sequences[0].clips[0]));
    },
    (d: any) => {
      d.activeSequenceId = "missing";
    },
    (d: any) => {
      d.sequences[0].clips[0].trackId = "missing";
    },
    (d: any) => {
      d.sequences[0].clips[0].assetId = "missing";
    },
  ];
  for (const change of changes) rejects(change, /重复|不存在/);
});

test("track kinds accept extracted video audio and reject incompatible picture and text placements", () => {
  const value = document();
  value.sequences[0]!.clips.push(media("sound", { trackId: "audio" }));
  value.sequences[0]!.clips.push(subtitle());
  assert.equal(validateEditorDocument(value).sequences[0]!.clips.length, 3);
  rejects((d) => {
    d.sequences[0].clips[0].assetId = "voice";
  }, /不兼容/);
  rejects((d) => {
    d.sequences[0].clips[0].trackId = "text";
  }, /不兼容/);
  rejects((d) => {
    d.sequences[0].clips.push(subtitle({ trackId: "picture" }));
  }, /不兼容/);
});

test("time maps preserve reverse and valid freeze while rejecting source overflow and end-of-file freeze", () => {
  const reverse = document();
  picture(reverse).timeMap.points = [
    { time: 0, source: 20 * T },
    { time: 10 * T, source: 10 * T },
  ];
  assert.deepEqual(picture(validateEditorDocument(reverse)).timeMap, picture(reverse).timeMap);
  const frozen = document();
  picture(frozen).timeMap.points = [
    { time: 0, source: 5 * T },
    { time: 10 * T, source: 5 * T },
  ];
  validateEditorDocument(frozen);
  rejects((d) => {
    d.sequences[0].clips[0].timeMap.points[1].source = 21 * T;
  }, /素材时长/);
  rejects((d) => {
    d.sequences[0].clips[0].timeMap.points[1].time = 9 * T;
  }, /完整时长/);
  rejects((d) => {
    d.sequences[0].clips[0].timeMap.points = [
      { time: 0, source: 20 * T },
      { time: 10 * T, source: 20 * T },
    ];
  }, /定格/);
  const still = document();
  picture(still).assetId = "still";
  picture(still).timeMap.points = [
    { time: 0, source: 0 },
    { time: 10 * T, source: 0 },
  ];
  validateEditorDocument(still);
});

test("keyframes obey clip duration, order and property-specific ranges including nested easing", () => {
  const value = document();
  picture(value).transform.opacity = {
    keyframes: [
      { time: 0, value: 0 },
      { time: 10 * T, value: 1, easing: "hold" },
    ],
  };
  validateEditorDocument(value);
  rejects((d) => {
    d.sequences[0].clips[0].transform.opacity = { keyframes: [{ time: 11 * T, value: 1 }] };
  }, /时长内/);
  rejects((d) => {
    d.sequences[0].clips[0].transform.opacity = { keyframes: [{ time: 0, value: 2 }] };
  }, /不透明度/);
  rejects((d) => {
    d.sequences[0].clips[0].audio.volume = {
      keyframes: [
        { time: T, value: 1 },
        { time: T, value: 0 },
      ],
    };
  }, /递增/);
  rejects((d) => {
    d.sequences[0].clips[0].transform.x = {
      keyframes: [
        { time: 0, value: 0, easing: { type: "cubic-bezier", x1: 2, y1: 0, x2: 1, y2: 1 } },
      ],
    };
  }, /贝塞尔/);
});

test("curves, HSL, masks and crop validate full renderable geometry", () => {
  const value = document();
  picture(value).color.curves = [
    {
      channel: "rgb",
      points: [
        { x: 0, y: 0.1 },
        { x: 0.5, y: 0.6 },
        { x: 1, y: 1 },
      ],
    },
  ];
  picture(value).color.hsl = [
    { hue: 120, width: 30, hueShift: 10, saturation: 0.2, lightness: -0.1 },
  ];
  picture(value).mask = {
    kind: "path",
    x: 0.5,
    y: 0.5,
    width: 1,
    height: 1,
    rotation: 0,
    feather: 0.1,
    inverted: false,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
    ],
  };
  validateEditorDocument(value);
  rejects((d) => {
    d.sequences[0].clips[0].transform.crop = { left: 0.6, right: 0.4, top: 0, bottom: 0 };
  }, /有效画面/);
  rejects((d) => {
    d.sequences[0].clips[0].color.curves = [
      {
        channel: "rgb",
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
        ],
      },
    ];
  }, /递增/);
  rejects((d) => {
    d.sequences[0].clips[0].color.hsl = [
      { hue: 30, width: 0, hueShift: 0, saturation: 0, lightness: 0 },
    ];
  }, /HSL 范围/);
  rejects((d) => {
    d.sequences[0].clips[0].mask = {
      ...picture(value).mask,
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    };
  }, /不同顶点/);
});

test("same-track video requires an exact explicit transition, while other picture tracks and audio may overlap", () => {
  rejects((d) => {
    d.sequences[0].clips.push(media("overlap", { start: 8 * T }));
  }, /转场/);
  const value = document();
  value.sequences[0]!.clips.push(media("later", { start: 8 * T }));
  value.sequences[0]!.transitions.push({
    id: "cross",
    fromClipId: "clip",
    toClipId: "later",
    start: 8 * T,
    duration: 2 * T,
    kind: "dissolve",
  });
  validateEditorDocument(value);
  const wrong = structuredClone(value);
  wrong.sequences[0]!.transitions[0]!.duration = T;
  assert.throws(() => validateEditorDocument(wrong), /重叠范围/);
  const multi = document();
  multi.sequences[0]!.tracks.push(createTrack("overlay", "video"));
  multi.sequences[0]!.clips.push(media("overlay", { trackId: "overlay" }));
  multi.sequences[0]!.clips.push(
    media("audio-one", { trackId: "audio" }),
    media("audio-two", { trackId: "audio", start: T }),
  );
  validateEditorDocument(multi);
});

test("transitions reject missing endpoints, duplicate pairs, cross-track references and triple overlaps", () => {
  const base = document();
  base.sequences[0]!.clips.push(media("later", { start: 8 * T }));
  base.sequences[0]!.transitions = [
    {
      id: "cross",
      fromClipId: "clip",
      toClipId: "later",
      start: 8 * T,
      duration: 2 * T,
      kind: "dissolve",
    },
  ];
  for (const change of [
    (d: EditorDocument) => {
      d.sequences[0]!.transitions[0]!.toClipId = "missing";
    },
    (d: EditorDocument) => {
      d.sequences[0]!.transitions.push({ ...d.sequences[0]!.transitions[0]!, id: "twice" });
    },
    (d: EditorDocument) => {
      d.sequences[0]!.tracks.push(createTrack("overlay", "video"));
      d.sequences[0]!.clips[1]!.trackId = "overlay";
    },
    (d: EditorDocument) => {
      d.sequences[0]!.clips.push(media("third", { start: 9 * T }));
      d.sequences[0]!.transitions.push({
        id: "second",
        fromClipId: "later",
        toClipId: "third",
        start: 9 * T,
        duration: 9 * T,
        kind: "dissolve",
      });
    },
  ]) {
    const value = structuredClone(base);
    change(value);
    assert.throws(() => validateEditorDocument(value), /转场|重叠/);
  }
});

function nested(sequenceId: string): SequenceClip {
  const { assetId: _asset, kind: _kind, ...base } = media();
  return { ...base, id: "nested", kind: "sequence", sequenceId };
}
test("keyword emphasis is optional, strictly bounded and preserved by validated JSON roundtrips", () => {
  const value = document(),
    caption = subtitle();
  caption.style.keywords = [
    { text: "实际中文", color: "#ffaa00" },
    { text: "字幕", color: "#12ab34" },
  ];
  value.sequences[0]!.clips.push(caption);
  const restored = validateEditorDocument(JSON.parse(JSON.stringify(value)));
  assert.deepEqual(
    (restored.sequences[0]!.clips[1] as TextClip).style.keywords,
    caption.style.keywords,
  );
  for (const keywords of [
    [{ text: "", color: "#fff" }],
    [{ text: "x\ny", color: "#fff" }],
    [{ text: "x", color: "url(secret)" }],
    [{ text: "x", color: "#fff", unknown: 1 }],
    Array.from({ length: 33 }, () => ({ text: "x", color: "#fff" })),
  ]) {
    const invalid = structuredClone(value);
    (invalid.sequences[0]!.clips[1] as TextClip).style.keywords = keywords;
    assert.throws(() => validateEditorDocument(invalid), /关键词|未知/);
  }
  assert.equal(subtitle().style.keywords, undefined);
});
test("nested sequences preserve references and reject missing, empty, cyclic and out-of-range dependencies", () => {
  const value = document();
  value.sequences.push(sequence("nested-source"));
  value.sequences[0]!.clips = [nested("nested-source")];
  validateEditorDocument(value);
  assert.equal(sequenceDuration(value.sequences[0]!), 10 * T);
  for (const change of [
    (d: EditorDocument) => {
      (d.sequences[0]!.clips[0] as SequenceClip).sequenceId = "missing";
    },
    (d: EditorDocument) => {
      d.sequences[1]!.clips = [];
    },
    (d: EditorDocument) => {
      d.sequences[1]!.clips = [nested("main")];
    },
    (d: EditorDocument) => {
      (d.sequences[0]!.clips[0] as SequenceClip).timeMap.points[1]!.source = 11 * T;
    },
  ]) {
    const changed = structuredClone(value);
    change(changed);
    assert.throws(() => validateEditorDocument(changed), /不存在|空序列|循环|素材时长/);
  }
});

test("free empty sequences remain valid and markers never extend duration beyond actual clips", () => {
  const value = document();
  value.sequences[0]!.clips = [];
  value.sequences[0]!.markers = [
    {
      id: "note",
      time: 20 * T,
      duration: T,
      name: "待补镜头",
      note: "下一行\n说明",
      color: "#eebb00",
    },
  ];
  const result = validateEditorDocument(value);
  assert.equal(sequenceDuration(result.sequences[0]!), 0);
  value.sequences[0]!.markers[0]!.time = MAX_EDITOR_TICK;
  assert.throws(() => validateEditorDocument(value), /24 小时/);
});

test("text bindings, word timings and translations preserve editable content and reject dangling sources", () => {
  const value = document();
  value.sequences[0]!.clips.push(
    subtitle({ translation: { original: "真实原文", language: "English", mode: "bilingual" } }),
  );
  const result = validateEditorDocument(value);
  assert.deepEqual(result.sequences[0]!.clips[1], value.sequences[0]!.clips[1]);
  for (const change of [
    (c: TextClip) => {
      c.sourceBinding!.clipId = "missing";
    },
    (c: TextClip) => {
      c.sourceBinding!.sourceEnd = 21 * T;
    },
    (c: TextClip) => {
      c.words[1]!.end = 4 * T;
    },
    (c: TextClip) => {
      c.style.maxWidth = 2;
    },
    (c: TextClip) => {
      c.style.shadow.color = "url(remote)";
    },
  ]) {
    const changed = structuredClone(value);
    change(changed.sequences[0]!.clips[1] as TextClip);
    assert.throws(() => validateEditorDocument(changed));
  }
});

test("audio envelopes and ducking reference other playable tracks and preserve explicit controls", () => {
  const value = document();
  value.sequences[0]!.clips.push(media("music", { trackId: "audio", assetId: "voice" }));
  const music = value.sequences[0]!.clips[1] as MediaClip;
  music.audio.fadeIn = T;
  music.audio.fadeOut = 2 * T;
  music.audio.pan = {
    keyframes: [
      { time: 0, value: -1 },
      { time: 10 * T, value: 1 },
    ],
  };
  music.audio.ducking = {
    sidechainTrackIds: ["picture"],
    thresholdDb: -30,
    attenuationDb: 12,
    attack: T / 10,
    release: T / 2,
  };
  validateEditorDocument(value);
  for (const trackId of ["audio", "text", "missing"]) {
    const changed = structuredClone(value);
    (changed.sequences[0]!.clips[1] as MediaClip).audio.ducking!.sidechainTrackIds = [trackId];
    assert.throws(() => validateEditorDocument(changed), /其他有效声音轨道/);
  }
  rejects((d) => {
    d.sequences[0].clips[0].audio.fadeOut = 11 * T;
  }, /声音淡出/);
});

function multicam(): MulticamClip {
  const { assetId: _asset, kind: _kind, ...base } = media();
  return {
    ...base,
    kind: "multicam",
    angles: [
      { id: "a", name: "主机位", assetId: "camera-a", offset: 0 },
      { id: "b", name: "晚开机", assetId: "camera-b", offset: -5 * T },
    ],
    switches: [
      { time: 0, angleId: "a" },
      { time: 5 * T, angleId: "b" },
    ],
    audioAngleId: "a",
  };
}
test("multicam validates active angle ranges and continuous main audio without requiring unused early frames", () => {
  const value = document();
  value.sequences[0]!.clips = [multicam()];
  validateEditorDocument(value);
  const selectedTooEarly = structuredClone(value);
  (selectedTooEarly.sequences[0]!.clips[0] as MulticamClip).switches[1]!.time = 4 * T;
  assert.throws(() => validateEditorDocument(selectedTooEarly), /范围超出/);
  const invalidAudio = structuredClone(value);
  (invalidAudio.sequences[0]!.clips[0] as MulticamClip).audioAngleId = "b";
  assert.throws(() => validateEditorDocument(invalidAudio), /范围超出/);
  const muted = structuredClone(invalidAudio);
  (muted.sequences[0]!.clips[0] as MulticamClip).audio.volume = 0;
  validateEditorDocument(muted);
});

test("multicam rejects missing first switch, unknown angles and non-video angle sources", () => {
  for (const change of [
    (c: MulticamClip) => {
      c.switches[0]!.time = T;
    },
    (c: MulticamClip) => {
      c.switches[0]!.angleId = "missing";
    },
    (c: MulticamClip) => {
      c.angles[1]!.id = "a";
    },
    (c: MulticamClip) => {
      c.angles[1]!.assetId = "voice";
    },
  ]) {
    const value = document(),
      clip = multicam();
    change(clip);
    value.sequences[0]!.clips = [clip];
    assert.throws(() => validateEditorDocument(value), /多机位|机位/);
  }
});
