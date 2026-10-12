import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  compileCaptionSources,
  mapCaptionSourceRange,
  planTranscriptCaptions,
  parseEditorSrt,
  parseEditorVtt,
  planVttImport,
  exportEditorVtt,
  planSrtImport,
  exportEditorSrt,
  planCaptionTranslation,
  captionTranslationItems,
  planCaptionStyle,
  planCaptionText,
  findCaptionText,
  planCaptionReplace,
  listCaptions,
  planAddCaption,
  planCaptionTiming,
  planRemoveCaptions,
} from "../apps/video-studio/src/editor/captions";
import {
  captionPresetStyle,
  planCaptionPreset,
  captionTemplate,
} from "../apps/video-studio/src/editor/caption-presets";
import { projectLegacyView } from "../apps/video-studio/src/editor/legacy-adapter";
import {
  createCaptionController,
  type CaptionControllerContext,
} from "../apps/video-studio/src/editor/caption-controller";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import {
  sequenceDuration,
  validateEditorDocument,
} from "../apps/video-studio/src/editor/validation";
import { secondsToTicks, sourceRangesToTimeline } from "../apps/video-studio/src/editor/time";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import { EditorSession } from "../apps/video-studio/src/editor/session";
import {
  setClipSpeed,
  splitClip,
  copyClips,
  pasteClips,
} from "../apps/video-studio/src/editor/clip-edits";
import { evaluateAnimatedNumber } from "../apps/video-studio/src/editor/animation";
import { planCaptionMerge, planCaptionSplit } from "../apps/video-studio/src/editor/caption-sentence-edits";
import { sliceCaptionBinding } from "../apps/video-studio/src/editor/caption-bindings";
import type {
  EditorDocument,
  MediaClip,
  TextClip,
  SequenceClip,
  MulticamClip,
} from "../apps/video-studio/src/editor/types";
const T = 240000;
function media(
  id: string,
  trackId: string,
  start = 0,
  duration = 4 * T,
  assetId = "voice",
): MediaClip {
  return {
    id,
    trackId,
    start,
    duration,
    assetId,
    label: id,
    kind: "media",
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    audio: defaultAudioMix(),
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: duration, source: duration },
      ],
    },
  };
}
function fixture(): EditorDocument {
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: T,
    id: "project",
    revision: 0,
    name: "字幕",
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [
      { id: "voice", name: "旁白", kind: "audio", duration: 20 * T },
      { id: "video", name: "原声画面", kind: "video", duration: 20 * T, width: 640, height: 360 },
    ],
    sequences: [
      {
        id: "main",
        name: "主序列",
        width: 640,
        height: 360,
        frameRate: { numerator: 30000, denominator: 1001 },
        background: "#000000",
        timelineMode: "free",
        tracks: [createTrack("v", "video"), createTrack("a", "audio"), createTrack("t", "text")],
        clips: [media("sound", "a")],
        transitions: [],
        markers: [],
      },
    ],
  });
}
const transcript = [
  {
    start: 1,
    end: 3,
    text: "你好 世界",
    words: [
      { start: 1, end: 2, text: "你好" },
      { start: 2, end: 3, text: " 世界" },
    ],
  },
];
const captions = (doc: EditorDocument, sequenceId = "main") =>
  doc.sequences
    .find((seq) => seq.id === sequenceId)!
    .clips.filter((clip): clip is TextClip => clip.kind === "text");
const generated = (doc = fixture()) => {
  const plan = planTranscriptCaptions(doc, "main", new Map([["voice", transcript]]), {
    wordHighlight: true,
  });
  return applyEditorOperations(doc, plan.operations, doc.revision);
};

test("caption caret split preserves exact subframe words, punctuation, source provenance and detached input", () => {
  const doc = generated(), clip = captions(doc)[0]!;
  clip.words[0]!.end = T - 9;
  clip.words[1]!.start = T + 13;
  const before = structuredClone(doc), plan = planCaptionSplit(doc, "main", clip.id, { caret: 3, idFactory: () => "sentence-right" });
  assert.deepEqual(doc, before);
  assert.deepEqual(plan.affectedIds, [clip.id]);
  const result = applyEditorOperations(doc, plan.operations, doc.revision), [left, right] = captions(result);
  assert.equal(left!.text, "你好 ");
  assert.equal(right!.text, "世界");
  assert.equal(left!.duration, T + 13);
  assert.equal(right!.start, 2 * T + 13);
  assert.deepEqual(left!.words, [{ text: "你好", start: 0, end: T - 9 }]);
  assert.deepEqual(right!.words, [{ text: "世界", start: 0, end: T - 13 }]);
  assert.equal(left!.sourceBinding!.provenance!.end, right!.sourceBinding!.provenance!.start);
  assert.equal(left!.sourceBinding!.sourceEnd, right!.sourceBinding!.sourceStart);
  assert.deepEqual(result.sequences[0]!.clips.find((item) => item.id === "sound"), before.sequences[0]!.clips.find((item) => item.id === "sound"));
  const add = plan.operations.find((op) => op.type === "clip.add")!;
  if (add.type === "clip.add" && add.clip.kind === "text") add.clip.style.fontSize = 99;
  assert.deepEqual(doc, before);
});

test("caption caret split requires an explicit manual time without a reliable boundary and never cuts a grapheme", () => {
  const doc = generated(), clip = captions(doc)[0]!;
  delete clip.sourceBinding;
  clip.text = "A👩‍💻B";
  clip.words = [];
  assert.throws(() => planCaptionSplit(doc, "main", clip.id, { caret: 6 }), /手动|分割时间/);
  for (const caret of [0, 2, 3, 4, 5, 7])
    assert.throws(() => planCaptionSplit(doc, "main", clip.id, { caret, time: 2 * T }), /完整字符|两侧/);
  const result = applyEditorOperations(doc, planCaptionSplit(doc, "main", clip.id, { caret: 6, time: 2 * T + 17 }).operations, doc.revision);
  assert.deepEqual(captions(result).map((item) => [item.text, item.start, item.duration, item.words]), [["A👩‍💻", T, T + 17, []], ["B", 2 * T + 17, T - 17, []]]);
  for (const time of [T, 3 * T, T - 1, NaN])
    assert.throws(() => planCaptionSplit(doc, "main", clip.id, { caret: 6, time }), /分割时间/);
});

test("manual caption split retains only whole words whose side and exact times can be proved", () => {
  const doc = generated(), clip = captions(doc)[0]!;
  delete clip.sourceBinding;
  clip.start = 0;
  clip.duration = 3 * T;
  clip.text = "one two three";
  clip.words = [{ text: "one", start: 0, end: T }, { text: "two", start: T, end: 2 * T }, { text: "three", start: 2 * T, end: 3 * T }];
  const plan = planCaptionSplit(doc, "main", clip.id, { caret: 4, time: 1.5 * T });
  const [left, right] = captions(applyEditorOperations(doc, plan.operations, doc.revision));
  assert.deepEqual(left!.words, [{ text: "one", start: 0, end: T }]);
  assert.deepEqual(right!.words, [{ text: "three", start: .5 * T, end: 1.5 * T }]);
  assert.equal(left!.style.animation, "word-highlight");
  assert.equal(right!.style.animation, "none");
  assert.ok(plan.notices.some((notice) => notice.includes("1 个词时间")));
  const insideWord = planCaptionSplit(doc, "main", clip.id, { caret: 5, time: 1.5 * T });
  const halves = captions(applyEditorOperations(doc, insideWord.operations, doc.revision));
  assert.deepEqual(halves.map((item) => item.words.map((word) => word.text)), [["one"], ["three"]]);
  assert.ok(halves.every((item) => item.style.animation === "none"));
  clip.text = "独立校对文字";
  const unaligned = planCaptionSplit(doc, "main", clip.id, { caret: 2, time: T });
  assert.ok(captions(applyEditorOperations(doc, unaligned.operations, doc.revision)).every((item) => !item.words.length));
});

test("adjacent caption merge preserves ordered local word times, exact binding and same group/link membership", () => {
  const doc = generated(), clip = captions(doc)[0]!;
  clip.groupId = "group";
  clip.linkGroupId = "link";
  const split = planCaptionSplit(doc, "main", clip.id, { caret: 3, idFactory: () => "right" });
  const parted = applyEditorOperations(doc, split.operations, doc.revision), before = structuredClone(parted);
  const merge = planCaptionMerge(parted, "main", ["right", clip.id]);
  assert.deepEqual(parted, before);
  const [joined] = captions(applyEditorOperations(parted, merge.operations, parted.revision));
  assert.equal(joined!.id, clip.id);
  assert.equal(joined!.text, "你好 \n世界");
  assert.equal(joined!.duration, clip.duration);
  assert.deepEqual(joined!.words, clip.words);
  assert.deepEqual(joined!.sourceBinding, clip.sourceBinding);
  assert.equal(joined!.groupId, "group");
  assert.equal(joined!.linkGroupId, "link");
  assert.deepEqual(new Set(merge.affectedIds), new Set([clip.id, "right"]));
});

test("unbound caption merge preserves real offsets across an explicit gap without fabricating missing timing", () => {
  const doc = generated(), left = captions(doc)[0]!;
  delete left.sourceBinding;
  left.style.animation = "none";
  const right = structuredClone(left);
  right.id = "right";
  right.start = 4 * T;
  right.duration = T;
  right.text = "没有词时";
  right.words = [];
  doc.sequences[0]!.clips.push(right);
  const plan = planCaptionMerge(doc, "main", [right.id, left.id]), [joined] = captions(applyEditorOperations(doc, plan.operations, doc.revision));
  assert.equal(joined!.duration, 4 * T);
  assert.deepEqual(joined!.words, left.words);
  assert.ok(plan.notices.some((notice) => notice.includes("空白时间")));
  assert.ok(plan.notices.some((notice) => notice.includes("没有补造")));
});

test("caption sentence edits reject locked, translated, animated and incompatible captions atomically", () => {
  const original = generated();
  for (const change of [
    (doc: EditorDocument) => { doc.sequences[0]!.tracks.find((track) => track.id === "t")!.locked = true; },
    (doc: EditorDocument) => { captions(doc)[0]!.translation = { original: "你好 世界", language: "英语", mode: "translated" }; },
    (doc: EditorDocument) => { captions(doc)[0]!.style.animation = "fade"; },
    (doc: EditorDocument) => { captions(doc)[0]!.transform.x = { keyframes: [{ time: 0, value: 0, easing: "linear" }] }; },
  ]) {
    const doc = structuredClone(original);
    change(doc);
    const before = structuredClone(doc);
    assert.throws(() => planCaptionSplit(doc, "main", captions(doc)[0]!.id, { caret: 3 }), /锁定|译文|动画/);
    assert.deepEqual(doc, before);
  }
  const parted = applyEditorOperations(original, planCaptionSplit(original, "main", captions(original)[0]!.id, { caret: 3, idFactory: () => "right" }).operations, original.revision);
  for (const change of [
    (right: TextClip) => { right.style.fontSize += 1; },
    (right: TextClip) => { right.groupId = "other"; },
    (right: TextClip) => { right.linkGroupId = "other"; },
    (right: TextClip) => { right.start -= 1; },
    (right: TextClip) => { right.start += 1; },
    (right: TextClip) => { delete right.sourceBinding; },
  ]) {
    const doc = structuredClone(parted), right = captions(doc)[1]!;
    change(right);
    const before = structuredClone(doc);
    assert.throws(() => planCaptionMerge(doc, "main", captions(doc).map((item) => item.id)), /样式|关联|重叠|连续|来源/);
    assert.deepEqual(doc, before);
  }
});

test("caption binding proof supports exact nested forward routes and rejects freezes, reverse and repeated output ranges", () => {
  const base = generated();
  base.sequences[0]!.tracks.find((track) => track.id === "a")!.locked = true;
  assert.doesNotThrow(() => planCaptionSplit(base, "main", captions(base)[0]!.id, { caret: 3 }));
  for (const points of [
    [{ time: 0, source: 0 }, { time: 4 * T, source: 0 }],
    [{ time: 0, source: 4 * T }, { time: 4 * T, source: 0 }],
    [{ time: 0, source: 0 }, { time: T, source: 2 * T }, { time: 2 * T, source: T }, { time: 4 * T, source: 4 * T }],
  ]) {
    const doc = structuredClone(base), owner = doc.sequences[0]!.clips[0] as MediaClip;
    owner.timeMap.points = points;
    assert.throws(() => planCaptionSplit(doc, "main", captions(doc)[0]!.id, { caret: 3 }), /解除所选来源绑定/);
  }
  const doc = generated(nested()), clip = captions(doc)[0]!;
  assert.ok(clip.sourceBinding!.provenance!.path.length);
  assert.doesNotThrow(() => planCaptionSplit(doc, "main", clip.id, { caret: 3 }));
});

test("caption merge rejects a skipped row or mismatched word alignment without changing the project", () => {
  const doc = generated(), left = captions(doc)[0]!;
  delete left.sourceBinding;
  left.start = 0;
  left.duration = 2 * T;
  const right = structuredClone(left), middle = structuredClone(left);
  right.id = "right";
  right.start = 4 * T;
  middle.id = "middle";
  middle.start = 2 * T;
  doc.sequences[0]!.clips.push(middle, right);
  const before = structuredClone(doc);
  assert.throws(() => planCaptionMerge(doc, "main", [left.id, right.id]), /真正相邻/);
  assert.deepEqual(doc, before);
  right.text = "与旧词时间不一致";
  assert.throws(() => planCaptionMerge(doc, "main", [middle.id, right.id]), /词时间.*不一致/);
});

test("a caption slice never widens a saved source interval between integral source samples", () => {
  const doc = generated(), owner = doc.sequences[0]!.clips[0] as MediaClip,
    clip = captions(doc)[0]!;
  owner.duration = 10;
  owner.timeMap = { points: [{ time: 0, source: 0 }, { time: 10, source: 20 }] };
  clip.start = 0;
  clip.duration = 10;
  clip.text = "你好";
  clip.words = [{ text: "你", start: 0, end: 5 }, { text: "好", start: 5, end: 10 }];
  clip.sourceBinding = { clipId: owner.id, sourceStart: 0, sourceEnd: 19 };
  const valid = validateEditorDocument(doc), before = structuredClone(valid);
  assert.deepEqual(sourceRangesToTimeline(owner.timeMap, 0, 19), [{ start: 0, end: 10 }]);
  // Both source end 19 and 20 map to the same output end. The saved exclusive end is still 19.
  assert.throws(() => planCaptionSplit(valid, "main", clip.id, { caret: 1 }), /解除所选来源绑定/);
  assert.deepEqual(valid, before);
});

test("a single inverse interval cannot hide a reverse source loop, including within a nested route", () => {
  const doc = generated(), root = doc.sequences[0]!, owner = root.clips[0] as MediaClip,
    clip = captions(doc)[0]!, loop = [{ time: 0, source: 0 }, { time: 3, source: 8 }, { time: 6, source: 2 }, { time: 10, source: 20 }];
  owner.duration = 10;
  owner.timeMap = { points: loop };
  clip.start = 0;
  clip.duration = 9;
  clip.text = "你好";
  clip.words = [{ text: "你", start: 0, end: 3 }, { text: "好", start: 3, end: 9 }];
  clip.sourceBinding = { clipId: owner.id, sourceStart: 0, sourceEnd: 16 };
  const valid = validateEditorDocument(doc);
  assert.deepEqual(sourceRangesToTimeline(owner.timeMap, 0, 16), [{ start: 0, end: 9 }]);
  assert.throws(() => sliceCaptionBinding(valid, "main", captions(valid)[0]!, 0, 9), /解除所选来源绑定/);
  const child = { ...structuredClone(root), id: "child", clips: [{ ...structuredClone(owner), id: "leaf" }] };
  const wrapper: SequenceClip = { id: "wrapper", kind: "sequence", trackId: "a", start: 0, duration: 10,
    sequenceId: "child", label: "嵌套", timeMap: { points: [{ time: 0, source: 0 }, { time: 10, source: 10 }] },
    audio: defaultAudioMix(), transform: defaultTransform(), color: defaultColorAdjustment(), blendMode: "normal" };
  root.clips = [wrapper, clip];
  doc.sequences.push(child);
  clip.sourceBinding = { clipId: wrapper.id, sourceStart: 0, sourceEnd: 9,
    provenance: { path: ["leaf"], assetId: "voice", start: 0, end: 16 } };
  const nestedValid = validateEditorDocument(doc);
  assert.throws(() => sliceCaptionBinding(nestedValid, "main", captions(nestedValid)[0]!, 0, 9), /解除所选来源绑定/);
  // Positive nonlinear curves and slow-motion repeated rounded samples remain supported.
  for (const [points, end] of [
    [[{ time: 0, source: 0 }, { time: 3, source: 4 }, { time: 6, source: 10 }, { time: 10, source: 20 }], 18],
    [[{ time: 0, source: 0 }, { time: 10, source: 5 }], 5],
  ] as const) {
    (child.clips[0] as MediaClip).timeMap = { points: points.map((point) => ({ ...point })) };
    clip.sourceBinding!.provenance!.end = end;
    const forward = validateEditorDocument(doc);
    assert.doesNotThrow(() => sliceCaptionBinding(forward, "main", captions(forward)[0]!, 0, 9));
  }
});
function nested(): EditorDocument {
  const doc = fixture(),
    root = doc.sequences[0]!;
  const child = {
    ...structuredClone(root),
    id: "child",
    name: "子序列",
    clips: [media("leaf", "a", T)],
    tracks: root.tracks.map((track) => ({ ...track })),
  };
  const owner: SequenceClip = {
    ...media("nested", "v", 2 * T, 16 * T),
    kind: "sequence",
    sequenceId: "child",
  } as any;
  delete (owner as any).assetId;
  owner.timeMap = {
    points: [
      { time: 0, source: 0 },
      { time: 16 * T, source: 8 * T },
    ],
  };
  const filler: any = {
    ...media("background", "v", 0, 8 * T),
    kind: "shape",
    shape: "rectangle",
    fill: "#000000",
    stroke: "#000000",
    strokeWidth: 0,
  };
  delete filler.assetId;
  delete filler.audio;
  delete filler.timeMap;
  child.clips.push(filler);
  root.clips = [owner];
  doc.sequences.push(child);
  return validateEditorDocument(doc);
}
function gate() {
  let resolve!: (value?: any) => void;
  const promise = new Promise<any>((done) => (resolve = done));
  return { promise, resolve };
}
async function harness(
  t: TestContext,
  overrides: Partial<CaptionControllerContext> = {},
  doc = fixture(),
) {
  const store = { data: structuredClone(doc), revision: 1, fail: false, writes: 0 };
  const session = await EditorSession.open(
    {
      read: async () => ({ data: store.data, revision: store.revision }),
      write: async (document, base) => {
        assert.equal(base, store.revision);
        store.writes++;
        if (store.fail) throw new Error("保存失败");
        store.data = structuredClone(document);
        return { revision: ++store.revision };
      },
      backupLegacy: async () => {},
    },
    { autosaveDelayMs: 60000 },
  );
  const controller = createCaptionController({
    session: () => session,
    apply: (ops, identity, label) => session.dispatchDurable(ops, identity, label, "user"),
    transcript: async ({ assetId, offset }) => ({
      assetId,
      offset,
      total: transcript.length,
      segments: transcript.slice(offset),
    }),
    ...overrides,
  });
  t.after(async () => {
    controller.dispose();
    await session.close({ save: false });
  });
  return { session, controller, store };
}

test("caption sources use actual independent/main audible media; mute, zero gain, silent video and freeze emit no phantom sources", () => {
  const doc = fixture(),
    seq = doc.sequences[0]!;
  seq.clips.push(media("picture", "v", 0, 4 * T, "video"));
  seq.tracks[0]!.hidden = true;
  assert.equal(compileCaptionSources(doc, "main").length, 2);
  seq.tracks[1]!.muted = true;
  assert.deepEqual(
    compileCaptionSources(doc, "main").map((source) => source.assetId),
    ["video"],
  );
  doc.assets[1]!.metadata = { editorInspection: { video: { codec: "h264" } } };
  assert.equal(compileCaptionSources(doc, "main").length, 0);
  seq.tracks[1]!.muted = false;
  const audio = seq.clips[0] as MediaClip;
  audio.timeMap = {
    points: [
      { time: 0, source: T },
      { time: 4 * T, source: T },
    ],
  };
  assert.equal(compileCaptionSources(doc, "main").length, 0);
  audio.timeMap = {
    points: [
      { time: 0, source: 0 },
      { time: 4 * T, source: 4 * T },
    ],
  };
  audio.audio.volume = {
    keyframes: [
      { time: 0, value: 0 },
      { time: 4 * T, value: 0 },
    ],
  };
  assert.equal(compileCaptionSources(doc, "main").length, 0);
});

test("tick audibility partition matches shared cubic/hold gain evaluation without frame rounding", () => {
  const doc = fixture(),
    clip = doc.sequences[0]!.clips[0] as MediaClip;
  clip.start = 17;
  clip.duration = 1000;
  clip.timeMap = {
    points: [
      { time: 0, source: 0 },
      { time: 1000, source: 1000 },
    ],
  };
  clip.audio.volume = {
    keyframes: [
      { time: 0, value: 0, easing: { type: "cubic-bezier", x1: 0.15, y1: -3, x2: 0.75, y2: 3 } },
      { time: 700, value: 1, easing: "hold" },
      { time: 800, value: 0 },
      { time: 900, value: 1 },
      { time: 1000, value: 1 },
    ],
  };
  const source = compileCaptionSources(doc, "main")[0]!;
  for (let tick = 0; tick < 1000; tick++)
    assert.equal(
      source.ranges.some((range) => tick + 17 >= range.start && tick + 17 < range.end),
      evaluateAnimatedNumber(clip.audio.volume, tick) > 0,
      `tick ${tick}`,
    );
});

test("NTSC and reverse/held source inversion retain every integral boundary and only real word times", () => {
  const doc = fixture(),
    clip = doc.sequences[0]!.clips[0] as MediaClip;
  clip.start = 8008;
  clip.duration = 4 * T;
  clip.timeMap = {
    points: [
      { time: 0, source: 4 * T },
      { time: 2 * T, source: 2 * T },
      { time: 3 * T, source: 2 * T },
      { time: 4 * T, source: T },
    ],
  };
  const source = compileCaptionSources(doc, "main")[0]!;
  assert.deepEqual(mapCaptionSourceRange(source, 2 * T, 3 * T), [
    { start: 8008 + T + 1, end: 8008 + 2 * T },
    { start: 8008 + 3 * T, end: 8008 + 3 * T + 1 },
  ]);
  const plan = planTranscriptCaptions(doc, "main", new Map([["voice", transcript]]), {
    wordHighlight: true,
  });
  const result = applyEditorOperations(doc, plan.operations, doc.revision);
  assert.deepEqual(result.sequences[0]!.frameRate, { numerator: 30000, denominator: 1001 });
  for (const caption of captions(result)) {
    assert.equal(caption.style.animation, "word-highlight");
    assert.ok(caption.words.every((word) => ["你好", "世界"].includes(word.text)));
    assert.ok(caption.start + caption.duration <= 8008 + 2 * T || caption.start >= 8008 + 3 * T);
  }
});

test("nested instances use root-owned captions, select multicam main audio only, and never write shared child subtitles", () => {
  const doc = nested(),
    child = doc.sequences[1]!;
  doc.assets[0]!.kind = "video";
  doc.assets[0]!.width = 640;
  doc.assets[0]!.height = 360;
  const multicam = {
    ...media("multi", "v", 0, 4 * T),
    kind: "multicam",
    angles: [
      { id: "voice-angle", name: "主声音", assetId: "voice", offset: T },
      { id: "silent-angle", name: "另一个画面", assetId: "video", offset: 0 },
    ],
    audioAngleId: "voice-angle",
    switches: [{ time: 0, angleId: "silent-angle" }],
  } as unknown as MulticamClip;
  delete (multicam as any).assetId;
  child.tracks.push(createTrack("multi-track", "video"));
  multicam.trackId = "multi-track";
  child.clips = [multicam, child.clips[1]!];
  const sources = compileCaptionSources(doc, "main");
  assert.deepEqual(
    sources.map((source) => source.assetId),
    ["voice"],
  );
  const plan = planTranscriptCaptions(doc, "main", new Map([["voice", transcript]]));
  const result = applyEditorOperations(doc, plan.operations, doc.revision),
    caption = captions(result)[0]!;
  assert.equal(captions(result, "child").length, 0);
  assert.equal(caption.start, 2 * T);
  assert.equal(caption.duration, 4 * T - 1);
  assert.deepEqual(caption.sourceBinding!.provenance, {
    path: ["multi"],
    assetId: "voice",
    start: T,
    end: 3 * T,
  });
});

test("generated captions retain words/styles and reruns preserve corrected text without duplicates", () => {
  const first = generated(),
    caption = captions(first)[0]!;
  assert.deepEqual(caption.words, [
    { text: "你好", start: 0, end: T },
    { text: "世界", start: T, end: 2 * T },
  ]);
  const corrected = applyEditorOperations(
    first,
    planCaptionText(first, "main", caption.id, "校对完成"),
    first.revision,
  );
  const again = planTranscriptCaptions(corrected, "main", new Map([["voice", transcript]]), {
    wordHighlight: true,
  });
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 1);
  assert.equal(captions(corrected)[0]!.text, "校对完成");
  assert.equal(captions(corrected)[0]!.words.length, 0);
  assert.throws(
    () => planCaptionStyle(corrected, "main", [caption.id], { animation: "word-highlight" }),
    /真实词时间/,
  );
});

test("separator-only corrections retain proven ordered word times and highlight while clearing old translations", () => {
  const doc = generated(), caption = captions(doc)[0]!;
  caption.translation = { original: caption.text, language: "en", mode: "translated" };
  const before = structuredClone(doc),
    operations = planCaptionText(doc, "main", caption.id, "你好，\n世界！"),
    after = applyEditorOperations(doc, operations, doc.revision),
    corrected = captions(after)[0]!;
  assert.deepEqual(corrected.words, caption.words);
  assert.equal(corrected.style.animation, "word-highlight");
  assert.equal(corrected.translation, undefined);
  assert.deepEqual(corrected.sourceBinding, caption.sourceBinding);
  assert.deepEqual(doc, before);
  assert.notEqual((operations[0] as any).patch.words, caption.words);
  const plan = planCaptionReplace(doc, "main", " ", "，");
  assert.deepEqual(captions(applyEditorOperations(doc, plan.operations, doc.revision))[0]!.words, caption.words);
  assert.ok(plan.notices.some((notice) => /已保留真实词时间/.test(notice)));
});

test("ASR token edge whitespace may move between separators while exact spoken word times remain unchanged", () => {
  const doc = generated(), caption = captions(doc)[0]!;
  caption.text = "Hello world";
  caption.words = [{ text: "Hello", start: 0, end: T }, { text: " world", start: T, end: 2 * T }];
  const after = applyEditorOperations(doc, planCaptionText(doc, "main", caption.id, "Hello,\nworld!"), doc.revision),
    corrected = captions(after)[0]!;
  assert.deepEqual(corrected.words, [{ text: "Hello", start: 0, end: T }, { text: "world", start: T, end: 2 * T }]);
  assert.equal(corrected.style.animation, "word-highlight");
  assert.equal(caption.words[1]!.text, " world");
});

test("new wording, changed timed tokens, missing coverage and ambiguous joiners never reuse stale word alignment", () => {
  for (const [oldText, nextText, wordTexts] of [
    ["你好 世界", "您好 世界", ["你好", "世界"]],
    ["你好， 世界", "你好！ 世界", ["你好，", "世界"]],
    ["你好 未对齐 世界", "你好，未对齐 世界", ["你好", "世界"]],
    ["hello world", "helloworld", ["hello", "world"]],
    ["άλφα βήτα", "άλφαβήτα", ["άλφα", "βήτα"]],
    ["два слова", "дваслова", ["два", "слова"]],
    ["caf\u0065\u0301 noir", "caf\u0065\u0301noir", ["caf\u0065\u0301", "noir"]],
    ["we're", "we re", ["we", "re"]],
    ["state-of", "state of", ["state", "of"]],
    ["1.0", "10", ["1", "0"]],
    ["١.٠", "١ ٠", ["١", "٠"]],
    ["a/b", "a b", ["a", "b"]],
    ["你好 世界", "你好🙂世界", ["你好", "世界"]],
  ] as const) {
    const doc = generated(), caption = captions(doc)[0]!;
    caption.text = oldText;
    caption.words = wordTexts.map((text, index) => ({ text, start: index * T, end: (index + 1) * T }));
    const after = applyEditorOperations(doc, planCaptionText(doc, "main", caption.id, nextText), doc.revision),
      corrected = captions(after)[0]!;
    assert.deepEqual(corrected.words, [], `${oldText} -> ${nextText}`);
    assert.equal(corrected.style.animation, "none");
  }
});

test("repeated words and Unicode separators retain their exact original token times without guessing", async (t) => {
  const doc = generated(), caption = captions(doc)[0]!;
  caption.text = "你好 你好";
  caption.words[1]!.text = "你好";
  const { session, controller, store } = await harness(t, {}, doc), before = session.read();
  controller.previewReplace({ sequenceId: "main", query: " ", text: "，\n" });
  assert.equal(store.writes, 0);
  await controller.apply();
  assert.equal(store.writes, 1);
  assert.deepEqual(captions(session.read())[0]!.words, caption.words);
  assert.equal(captions(session.read())[0]!.text, "你好，\n你好");
  session.undo();
  assert.deepEqual(captions(session.read())[0], captions(before)[0]);
});

test("literal caption search and replacement support Chinese, newlines and special characters without changing titles or another sequence", () => {
  let doc = generated();
  const first = captions(doc)[0]!;
  first.text = "中文.*[$&]\\\n下一行 中文.*[$&]\\\n下一行";
  doc = applyEditorOperations(doc, planAddCaption(doc, "main", { start: 3 * T, text: "中文.*[$&]\\\n下一行", idFactory: () => "second" }), doc.revision);
  const title = { ...structuredClone(first), id: "title", role: "title" as const };
  doc.sequences[0]!.clips.push(title);
  const other = { ...structuredClone(doc.sequences[0]!), id: "other", clips: [{ ...structuredClone(first), id: "other-caption" }] };
  delete other.clips[0]!.sourceBinding;
  doc.sequences.push(other);
  const query = "中文.*[$&]\\\n下一行",
    matches = findCaptionText(doc, "main", query),
    before = structuredClone(doc),
    plan = planCaptionReplace(doc, "main", query, "$&\\替换"),
    after = applyEditorOperations(doc, plan.operations, doc.revision);
  assert.deepEqual(matches.map((match) => [match.clipId, match.occurrences]), [[first.id, 2], ["second", 1]]);
  assert.equal(plan.matched, 2);
  assert.equal(plan.occurrences, 3);
  assert.equal(captions(after).find((clip) => clip.id === first.id)!.text, "$&\\替换 $&\\替换");
  assert.equal(captions(after).find((clip) => clip.id === first.id)!.words.length, 0);
  assert.equal(captions(after).find((clip) => clip.id === first.id)!.style.animation, "none");
  assert.deepEqual(after.sequences[1], doc.sequences[1]);
  assert.deepEqual(after.sequences[0]!.clips.find((clip) => clip.id === title.id), title);
  assert.deepEqual(doc, before);
  const selected = planCaptionReplace(doc, "main", query, "已校对", ["second"]);
  assert.equal(selected.matched, 1);
  assert.deepEqual(selected.operations.map((operation) => operation.type === "clip.update" && operation.clipId), ["second"]);
  assert.throws(() => findCaptionText(doc, "main", ""), /查找文字/);
  assert.throws(() => planCaptionReplace(doc, "main", query, "", ["second"]), /字幕文字/);
});

test("replacement preview cancels or goes stale without writes, saves once and undoes all matches, and rejects locked scope atomically", async (t) => {
  let doc = generated();
  doc = applyEditorOperations(doc, planAddCaption(doc, "main", { start: 3 * T, text: "你好 第二条", idFactory: () => "second" }), doc.revision);
  const { controller, session, store } = await harness(t, {}, doc),
    before = session.read();
  controller.previewReplace({ sequenceId: "main", query: "你好", text: "$& 校对" });
  assert.equal(controller.getState().candidate?.replacement?.matched, 2);
  assert.equal(store.writes, 0);
  controller.cancel();
  await assert.rejects(controller.apply(), /没有待应用/);
  assert.deepEqual(session.read(), before);
  controller.previewReplace({ sequenceId: "main", query: "你好", text: "$& 校对" });
  session.dispatch([{ type: "project.rename", name: "外部修改" }], session.getState().identity);
  assert.equal(controller.getState().phase, "stale");
  await assert.rejects(controller.apply());
  assert.ok(captions(session.read()).every((clip) => clip.text.includes("你好")));
  await session.flush();
  controller.previewReplace({ sequenceId: "main", query: "你好", text: "$& 校对" });
  const writes = store.writes;
  await controller.apply();
  assert.equal(store.writes, writes + 1, "All replacements share one durable write");
  assert.ok(captions(session.read()).every((clip) => clip.text.startsWith("$& 校对")));
  session.undo();
  assert.ok(captions(session.read()).every((clip) => clip.text.includes("你好")));
  session.dispatch([{ type: "track.update", sequenceId: "main", trackId: "t", patch: { locked: true } }], session.getState().identity);
  const locked = session.read();
  assert.throws(() => controller.previewReplace({ sequenceId: "main", query: "你好", text: "变化" }), /锁定/);
  assert.deepEqual(session.read(), locked);
});

test("a thousand-caption replacement uses a fixed number of graph checks and retains detached text-edit semantics", () => {
  const doc = generated(),
    template = captions(doc)[0]!;
  template.translation = {
    original: template.text,
    language: "en",
    mode: "translated",
    originalWords: structuredClone(template.words),
  };
  for (let index = 1; index < 1000; index++) {
    const clip = { ...structuredClone(template), id: `caption-${index}`, start: index * 3 * T };
    delete clip.sourceBinding;
    doc.sequences[0]!.clips.push(clip);
  }
  const before = structuredClone(doc),
    descriptor = Object.getOwnPropertyDescriptor;
  let graphChecks = 0;
  // Count whole document graph walks, including validation's own deep copy, rather than just structuredClone.
  Object.getOwnPropertyDescriptor = (object, key) => {
    if (key === "schemaVersion") graphChecks++;
    return descriptor(object, key);
  };
  let plan: ReturnType<typeof planCaptionReplace>;
  try {
    plan = planCaptionReplace(doc, "main", "你好", "校对");
  } finally {
    Object.getOwnPropertyDescriptor = descriptor;
  }
  assert.ok(graphChecks <= 3, `${graphChecks} full graph checks must not grow with the match count`);
  assert.equal(plan.matched, 1000);
  assert.equal(plan.occurrences, 1000);
  const after = applyEditorOperations(doc, plan.operations, doc.revision);
  for (const clip of captions(after)) {
    assert.equal(clip.text, "校对 世界");
    assert.deepEqual(clip.words, []);
    assert.equal(clip.translation, undefined);
    assert.equal(clip.style.animation, "none");
  }
  assert.deepEqual(captions(after)[0]!.sourceBinding, template.sourceBinding);
  const first = plan.operations[0]!;
  assert.equal(first.type, "clip.update");
  if (first.type === "clip.update") (first.patch.style as TextClip["style"]).shadow.blur = 9;
  assert.deepEqual(doc, before, "Plans and their nested style patches remain detached from caller input");
  const locked = createTrack("locked-text", "text");
  locked.locked = true;
  doc.sequences[0]!.tracks.push(locked);
  doc.sequences[0]!.clips.at(-1)!.trackId = locked.id;
  const lockedBefore = structuredClone(doc);
  assert.throws(() => planCaptionReplace(doc, "main", "你好", "校对"), /锁定/);
  assert.deepEqual(doc, lockedBefore, "A locked late match rejects the entire replacement batch");
});

test("SRT roundtrip preserves Unicode/multiline and explicit millisecond quantization without 30fps conversion", () => {
  const source =
    "\uFEFF1\r\n00:00:00,033 --> 00:00:01,067\r\n第一行🙂\r\n第二行\r\n\r\n2\r\n01:00:00,001 --> 01:00:01,234\r\n尾声\r\n";
  const parsed = parseEditorSrt(source);
  assert.equal(parsed[0]!.start, 7920);
  assert.equal(parsed[1]!.start, 864000240);
  const doc = fixture(),
    plan = planSrtImport(doc, "main", source);
  const result = applyEditorOperations(doc, plan.operations, doc.revision);
  assert.deepEqual(parseEditorSrt(exportEditorSrt(result, "main")), parsed);
  assert.equal(planSrtImport(result, "main", source).skipped, 2);
  assert.throws(() => parseEditorSrt("1\n00:61:00,000 --> 00:62:00,000\n坏"), /时间无效/);
  assert.throws(() => parseEditorSrt("1\n00:00:01,000 --> 00:00:01,000\n坏"), /正时长/);
});

test("SRT export rejects only internal blank separator lines with a cue number and preserves the source", () => {
  const base = fixture(),
    doc = applyEditorOperations(
      base,
      planSrtImport(
        base,
        "main",
        "1\n00:00:00,033 --> 00:00:01,067\n第一条\n\n2\n00:00:02,001 --> 00:00:03,234\n第二条\n",
      ).operations,
      base.revision,
    );
  for (const body of [
    "第一段\n\n第二段",
    "第一段\r\n \t\r\n第二段",
    "第一段\r \r第二段",
    "第一段\n\u00a0\n第二段",
  ]) {
    const source = structuredClone(doc);
    captions(source)[1]!.text = body;
    const before = structuredClone(source);
    assert.throws(() => exportEditorSrt(source, "main"), /第2条字幕.*空白分隔行.*删除中间空白行/);
    assert.deepEqual(source, before);
  }
  captions(doc)[1]!.text = "\r\n \t\r\n第一行🙂\r\n第二行\r\n\t\r\n";
  const before = structuredClone(doc),
    output = exportEditorSrt(doc, "main");
  assert.equal(output.includes("\r"), false);
  assert.deepEqual(parseEditorSrt(output), [
    { start: 7920, end: 256080, text: "第一条" },
    { start: 480240, end: 776160, text: "第一行🙂\n第二行" },
  ]);
  assert.deepEqual(doc, before, "File normalization never rewrites stored subtitle text");
});

test("SRT carries visible bilingual or translated text and cue times without inventing lost word or source metadata", () => {
  for (const mode of ["bilingual", "translated"] as const) {
    const original = generated(),
      id = captions(original)[0]!.id,
      translated = applyEditorOperations(
        original,
        planCaptionTranslation(original, "main", [id], "en", mode, [{ id, text: "Hello world" }])
          .operations,
        original.revision,
      ),
      before = structuredClone(translated),
      text = exportEditorSrt(translated, "main"),
      target = fixture(),
      result = applyEditorOperations(
        target,
        planSrtImport(target, "main", text).operations,
        target.revision,
      ),
      imported = captions(result)[0]!;
    assert.ok(captions(translated)[0]!.sourceBinding);
    assert.ok(captions(translated)[0]!.translation?.originalWords?.length);
    assert.deepEqual(parseEditorSrt(text), [
      {
        start: T,
        end: 3 * T,
        text: mode === "bilingual" ? "你好 世界\nHello world" : "Hello world",
      },
    ]);
    assert.equal(imported.text, mode === "bilingual" ? "你好 世界\nHello world" : "Hello world");
    assert.deepEqual(imported.words, []);
    assert.equal(imported.sourceBinding, undefined);
    assert.equal(imported.translation, undefined);
    assert.deepEqual(
      translated,
      before,
      "SRT output leaves all authoritative caption metadata intact",
    );
  }
});

test("translation preserves original timed words through translated-only and bilingual modes; unmatched results never apply", () => {
  const doc = generated(),
    caption = captions(doc)[0]!,
    id = caption.id;
  const translated = applyEditorOperations(
    doc,
    planCaptionTranslation(doc, "main", [id], "en", "translated", [{ id, text: "Hello world" }])
      .operations,
    doc.revision,
  );
  const result = captions(translated)[0]!;
  assert.deepEqual(result.words, []);
  assert.deepEqual(result.translation!.originalWords, caption.words);
  assert.equal(result.style.animation, "none");
  assert.deepEqual(captionTranslationItems(translated, "main", [id]), [{ id, text: "你好 世界" }]);
  const bilingual = applyEditorOperations(
    translated,
    planCaptionTranslation(translated, "main", [id], "fr", "bilingual", [
      { id, text: "Bonjour monde" },
    ]).operations,
    translated.revision,
  );
  assert.equal(captions(bilingual)[0]!.text, "你好 世界\nBonjour monde");
  assert.deepEqual(captions(bilingual)[0]!.words, caption.words);
  assert.throws(
    () =>
      planCaptionTranslation(doc, "main", [id], "en", "bilingual", [{ id: "wrong", text: "x" }]),
    /不匹配/,
  );
});

test("nested leaf moves and speed changes automatically remap root captions and original word metadata atomically; locked outer captions reject", () => {
  const base = nested(),
    generatedPlan = planTranscriptCaptions(base, "main", new Map([["voice", transcript]]));
  let doc = applyEditorOperations(base, generatedPlan.operations, base.revision);
  const caption = captions(doc)[0]!;
  assert.equal(caption.start, 6 * T - 1);
  doc = applyEditorOperations(
    doc,
    [{ type: "clip.move", sequenceId: "child", clipIds: ["leaf"], delta: T }],
    doc.revision,
  );
  assert.equal(captions(doc)[0]!.start, 8 * T - 1);
  assert.deepEqual(captions(doc)[0]!.words, caption.words);
  const blocked = structuredClone(doc);
  blocked.sequences[0]!.tracks.find((track) => track.id === "t")!.locked = true;
  assert.throws(
    () =>
      applyEditorOperations(
        blocked,
        [{ type: "clip.move", sequenceId: "child", clipIds: ["leaf"], delta: -T }],
        blocked.revision,
      ),
    /字幕轨已锁定/,
  );
  const speedDoc = applyEditorOperations(doc, setClipSpeed(doc, "child", "leaf", 2), doc.revision);
  assert.equal(captions(speedDoc)[0]!.duration, 2 * T);
  assert.equal(captions(speedDoc)[0]!.words[0]!.end, T);
});

test("nested source removal removes only dependent captions; trim that changes source selection rejects instead of leaving stale provenance", () => {
  const base = nested(),
    plan = planTranscriptCaptions(base, "main", new Map([["voice", transcript]]));
  const doc = applyEditorOperations(base, plan.operations, base.revision);
  const leaf = doc.sequences[1]!.clips[0] as MediaClip;
  assert.throws(
    () =>
      applyEditorOperations(
        doc,
        [
          {
            type: "clip.update",
            sequenceId: "child",
            clipId: "leaf",
            patch: {
              duration: 2 * T,
              timeMap: {
                points: [
                  { time: 0, source: 0 },
                  { time: 2 * T, source: 2 * T },
                ],
              },
            },
          },
        ],
        doc.revision,
      ),
    /裁掉嵌套音源/,
  );
  const removed = applyEditorOperations(
    doc,
    [{ type: "clip.remove", sequenceId: "child", clipIds: ["leaf"] }],
    doc.revision,
  );
  assert.equal(captions(removed).length, 0);
  assert.equal(doc.sequences[1]!.clips[0]!.id, leaf.id);
});

test("provenance validates complete graph and survives JSON roundtrip and root split without sharing state", () => {
  const doc = generated();
  assert.deepEqual(validateEditorDocument(JSON.parse(JSON.stringify(doc))), doc);
  const bad = structuredClone(doc);
  captions(bad)[0]!.sourceBinding!.provenance!.assetId = "video";
  assert.throws(() => validateEditorDocument(bad), /实际音源/);
  const split = applyEditorOperations(
    doc,
    splitClip(doc, "main", "sound", 2 * T, () => crypto.randomUUID()),
    doc.revision,
  );
  assert.equal(captions(split).length, 2);
  assert.ok(
    captions(split).every((caption) => caption.sourceBinding!.provenance!.assetId === "voice"),
  );
});

test("controller obtains complete real pages and selected source list, previews before a single durable save, and retains failed candidate for retry", async (t) => {
  const seen: string[][] = [];
  const h = await harness(t, {
    prepare: async ({ assetIds }) => {
      seen.push(assetIds);
    },
  });
  await h.controller.generate({ sequenceId: "main", assetIds: ["voice"], wordHighlight: true });
  assert.deepEqual(seen, [["voice"]]);
  assert.equal(captions(h.session.read()).length, 0);
  assert.equal(h.controller.getState().phase, "preview");
  h.store.fail = true;
  await assert.rejects(h.controller.apply(), /保存失败/);
  assert.equal(h.session.read().revision, 0);
  assert.ok(h.controller.getState().candidate);
  h.store.fail = false;
  await h.controller.apply();
  assert.equal(captions(h.session.read()).length, 1);
  assert.equal(h.session.read().revision, 1);
  h.session.undo();
  assert.equal(captions(h.session.read()).length, 0);
});

test("controller rejects changed transcript revision, incomplete/repeated pages and missing capability without fabricating cues", async (t) => {
  const many = Array.from({ length: 101 }, (_, i) => ({
    start: i / 100,
    end: (i + 1) / 100,
    text: `词${i}`,
  }));
  const h = await harness(t, {
    transcript: async ({ assetId, offset }) => ({
      assetId,
      offset,
      total: 101,
      revision: offset ? "new" : "old",
      segments: many.slice(offset, offset + 100),
    }),
  });
  await assert.rejects(h.controller.generate({ sequenceId: "main" }), /版本.*变化/);
  assert.equal(captions(h.session.read()).length, 0);
  const missing = await harness(t, { transcript: undefined });
  await assert.rejects(missing.controller.generate({ sequenceId: "main" }), /没有接入/);
  const empty = await harness(t, {
    transcript: async ({ assetId, offset }) => ({ assetId, offset, total: 1, segments: [] }),
  });
  await assert.rejects(empty.controller.generate({ sequenceId: "main" }), /分页不完整/);
});

test("cancelled, disposed or stale async translation/ASR completions never publish candidates; autosave state does not cancel valid preview", async (t) => {
  const pending = gate();
  let signal: AbortSignal | undefined;
  const h = await harness(t, {
    transcript: async (request) => {
      signal = request.signal;
      await pending.promise;
      return { assetId: request.assetId, offset: 0, total: 1, segments: transcript };
    },
  });
  const work = h.controller.generate({ sequenceId: "main" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.controller.cancel();
  assert.equal(signal!.aborted, true);
  pending.resolve();
  await assert.rejects(work, /取消/);
  assert.equal(h.controller.getState().candidate, undefined);
  const pending2 = gate(),
    second = await harness(
      t,
      {
        translate: async ({ items }) => {
          await pending2.promise;
          return items.map((item) => ({ id: item.id, text: "Translated" }));
        },
      },
      generated(),
    );
  const translating = second.controller.translate({
    sequenceId: "main",
    clipIds: [captions(second.session.read())[0]!.id],
    language: "en",
    mode: "bilingual",
  });
  second.session.dispatch(
    [{ type: "project.rename", name: "新版本" }],
    second.session.getState().identity,
  );
  pending2.resolve();
  await assert.rejects(translating, /取消|变化/);
  assert.equal(second.controller.getState().phase, "stale");
  assert.equal(second.controller.getState().candidate, undefined);
});

test("translation is batched and previewed with exact IDs, and same-ID restore invalidates a prepared candidate", async (t) => {
  const h = await harness(
    t,
    { translate: async ({ items }) => items.map((item) => ({ id: item.id, text: "Hello" })) },
    generated(),
  );
  const id = captions(h.session.read())[0]!.id;
  await h.controller.translate({
    sequenceId: "main",
    clipIds: [id],
    language: "en",
    mode: "bilingual",
  });
  assert.equal(captions(h.session.read())[0]!.text, "你好 世界");
  assert.equal(h.controller.getState().candidate!.rows[0]!.text, "你好 世界\nHello");
  const restored = h.session.read();
  restored.name = "恢复版本";
  await h.session.replace(restored);
  assert.equal(h.controller.getState().candidate, undefined);
  await assert.rejects(h.controller.apply(), /没有待应用/);
});

test("clipboard and portable project preserve full caption provenance and translated original words without shared references", async () => {
  const { validatePortableProjectManifest } =
    await import("../apps/video-studio/src/editor/portable-project");
  const base = generated(),
    id = captions(base)[0]!.id,
    doc = applyEditorOperations(
      base,
      planCaptionTranslation(base, "main", [id], "en", "translated", [{ id, text: "Hello" }])
        .operations,
      base.revision,
    );
  const manifest = {
    format: "mimi-video-project",
    formatVersion: 1,
    document: doc,
    media: doc.assets.map((asset, index) => ({
      sha256: String(index + 1).repeat(64),
      bytes: 100,
      assetIds: [asset.id],
    })),
  };
  const restored = validatePortableProjectManifest(JSON.parse(JSON.stringify(manifest))).document;
  assert.deepEqual(restored, doc);
  const copied = copyClips(doc, "main", ["sound"]);
  const pasted = applyEditorOperations(
    doc,
    pasteClips(doc, "main", copied, { at: 6 * T, idFactory: () => crypto.randomUUID() }),
    doc.revision,
  );
  const fresh = captions(pasted).find((clip) => clip.id !== id)!;
  assert.notEqual(fresh.sourceBinding!.clipId, "sound");
  assert.deepEqual(fresh.translation!.originalWords, captions(doc)[0]!.translation!.originalWords);
  fresh.sourceBinding!.provenance!.path.push("change");
  assert.deepEqual(captions(doc)[0]!.sourceBinding!.provenance!.path, []);
});

test("callback capability readiness gates actual operations and complete stamped pagination reads every segment", async (t) => {
  const seen: number[] = [],
    segments = Array.from({ length: 201 }, (_, index) => ({
      start: index / 100,
      end: (index + 1) / 100,
      text: `真实${index}`,
    }));
  const h = await harness(t, {
    transcript: async ({ assetId, offset }) => {
      seen.push(offset);
      return {
        assetId,
        offset,
        total: segments.length,
        revision: "stable",
        segments: segments.slice(offset, offset + 100),
      };
    },
  });
  h.controller.setCapabilities({ canTranscribe: false, canTranslate: false });
  await assert.rejects(h.controller.generate({ sequenceId: "main" }), /没有接入/);
  assert.deepEqual(seen, []);
  h.controller.setCapabilities({ canTranscribe: true, canTranslate: false });
  await h.controller.generate({ sequenceId: "main" });
  assert.deepEqual(seen, [0, 100, 200]);
  assert.equal(h.controller.getState().candidate!.rows.length, 201);
  assert.equal(h.session.read().revision, 0);
  h.controller.dispose();
  assert.equal(h.controller.getState().candidate!.rows.length, 201);
});

test("dispose aborts outstanding service work and suppresses all later candidate/state notifications", async (t) => {
  const pending = gate();
  let signal: AbortSignal | undefined;
  const h = await harness(t, {
    transcript: async (request) => {
      signal = request.signal;
      await pending.promise;
      return { assetId: request.assetId, offset: 0, total: 1, segments: transcript };
    },
  });
  let notifications = 0;
  h.controller.subscribe(() => notifications++);
  const work = h.controller.generate({ sequenceId: "main" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.controller.dispose();
  const previous = notifications;
  assert.equal(signal!.aborted, true);
  pending.resolve();
  await assert.rejects(work, /取消/);
  assert.equal(notifications, previous);
  assert.equal(h.controller.getState().candidate, undefined);
});

test("explicit detach preserves complete subtitle content and allows formerly rejected nested source cuts", async (t) => {
  const base = nested(),
    plan = planTranscriptCaptions(base, "main", new Map([["voice", transcript]]));
  const doc = applyEditorOperations(base, plan.operations, base.revision),
    original = captions(doc)[0]!;
  const h = await harness(t, {}, doc);
  await h.controller.detach("main", [original.id]);
  const next = captions(h.session.read())[0]!;
  assert.equal(next.sourceBinding, undefined);
  assert.deepEqual(next.words, original.words);
  assert.deepEqual(next.style, original.style);
  const trimmed = applyEditorOperations(
    h.session.read(),
    [
      {
        type: "clip.update",
        sequenceId: "child",
        clipId: "leaf",
        patch: {
          duration: 2 * T,
          timeMap: {
            points: [
              { time: 0, source: 0 },
              { time: 2 * T, source: 2 * T },
            ],
          },
        },
      },
    ],
    h.session.read().revision,
  );
  assert.equal(captions(trimmed)[0]!.text, original.text);
});

test("long sentences split only at authentic word boundaries while retaining original punctuation and words", () => {
  const doc = fixture(),
    words = Array.from({ length: 8 }, (_, i) => ({
      text: `真实词${i}，`,
      start: i * 0.5,
      end: (i + 1) * 0.5,
    })),
    text = words.map((word) => word.text).join("");
  const plan = planTranscriptCaptions(
    doc,
    "main",
    new Map([["voice", [{ start: 0, end: 4, text, words }]]]),
  );
  const result = applyEditorOperations(doc, plan.operations, doc.revision),
    clips = captions(result).sort((a, b) => a.start - b.start);
  assert.ok(clips.length > 1);
  assert.equal(clips.map((clip) => clip.text).join(""), text);
  assert.deepEqual(
    clips.flatMap((clip) =>
      clip.words.map((word) => ({
        text: word.text,
        start: (clip.start + word.start) / T,
        end: (clip.start + word.end) / T,
      })),
    ),
    words,
  );
});

/** Real camera media: off-frame asset length and placement, which the old frame projection excludes. */
function realMedia(): EditorDocument {
  const doc = fixture(),
    seq = doc.sequences[0]!;
  doc.assets.push({
    id: "camera",
    name: "实拍素材",
    kind: "video",
    duration: 10_000_123,
    width: 640,
    height: 360,
  });
  seq.clips = [media("camera-clip", "v", 1_234_567, 10_000_123, "camera")];
  return validateEditorDocument(doc);
}
test("caption planners edit a real off-frame media timeline with exact ticks and no old projection", () => {
  const doc = realMedia(),
    end = 1_234_567 + 10_000_123;
  assert.equal(projectLegacyView(doc).timelineComplete, false);
  const added = applyEditorOperations(
    doc,
    planAddCaption(doc, "main", {
      start: 2_345_678,
      text: "真实素材字幕",
      idFactory: () => "manual-caption",
    }),
    doc.revision,
  );
  let caption = listCaptions(added, "main")[0]!;
  assert.equal(caption.id, "manual-caption");
  assert.equal(caption.trackId, "t");
  assert.equal(caption.start, 2_345_678);
  assert.equal(caption.duration, 3 * T, "Default duration is three seconds");
  assert.equal(caption.role, "subtitle");
  const tail = applyEditorOperations(
    doc,
    planAddCaption(doc, "main", { start: end - 1000, text: "尾声", idFactory: () => "tail" }),
    doc.revision,
  );
  assert.equal(listCaptions(tail, "main")[0]!.duration, 1000, "Clamped to the sequence end");
  assert.throws(
    () => planAddCaption(doc, "main", { start: end, text: "越界" }),
    /播放头|画面范围/,
  );
  assert.throws(() => planAddCaption(doc, "main", { start: 0, text: " " }), /字幕文字/);
  const moved = applyEditorOperations(
    added,
    planCaptionTiming(added, "main", "manual-caption", { start: 2_400_001, end: 3_100_003 }),
    added.revision,
  );
  caption = listCaptions(moved, "main")[0]!;
  assert.equal(caption.start, 2_400_001);
  assert.equal(caption.duration, 700_002);
  const extended = applyEditorOperations(
    moved,
    planCaptionTiming(moved, "main", "manual-caption", { start: 2_400_001, end: 4_000_007 }),
    moved.revision,
  );
  assert.equal(listCaptions(extended, "main")[0]!.duration, 1_600_006);
  assert.deepEqual(
    planCaptionTiming(extended, "main", "manual-caption", { start: 2_400_001, end: 4_000_007 }),
    [],
  );
  const removed = applyEditorOperations(
    extended,
    planRemoveCaptions(extended, "main", ["manual-caption"]),
    extended.revision,
  );
  assert.deepEqual(listCaptions(removed, "main"), []);
  const srt = "1\n00:00:05,001 --> 00:00:06,999\n导入的字幕\n";
  const imported = applyEditorOperations(
    removed,
    planSrtImport(removed, "main", srt).operations,
    removed.revision,
  );
  assert.equal(listCaptions(imported, "main")[0]!.start, 1_200_240);
  assert.equal(exportEditorSrt(imported, "main"), srt);
  assert.equal(projectLegacyView(imported).timelineComplete, false);
});

test("multitrack captions list every subtitle track in time order and presets keep content and titles", () => {
  const doc = fixture(),
    seq = doc.sequences[0]!;
  seq.tracks = [
    createTrack("v", "video"),
    createTrack("v2", "video"),
    createTrack("a", "audio"),
    createTrack("t", "text"),
    createTrack("t2", "text"),
  ];
  const text = (id: string, trackId: string, start: number, role: "title" | "subtitle") => {
    const clip = captions(
      applyEditorOperations(
        doc,
        planAddCaption(doc, "main", { start, text: id, trackId, idFactory: () => id }),
        doc.revision,
      ),
    ).find((item) => item.id === id)!;
    clip.role = role;
    return clip;
  };
  seq.clips = [
    media("sound", "a"),
    { ...media("picture", "v", 0, 6 * T, "video") },
    { ...media("overlay", "v2", T, 2 * T, "video") },
  ];
  const worded = text("worded", "t", T, "subtitle");
  worded.words = [{ text: "worded", start: 0, end: T }];
  worded.style.animation = "word-highlight";
  worded.translation = { original: "原文", language: "英语", mode: "bilingual" };
  const faded = text("faded", "t2", 2 * T / 3, "subtitle");
  faded.style.animation = "fade";
  const last = text("last", "t2", 3 * T, "subtitle");
  const title = text("title", "t", 0, "title");
  seq.clips.push(worded, faded, last, title);
  const multi = validateEditorDocument(doc);
  assert.deepEqual(
    listCaptions(multi, "main").map((clip) => clip.id),
    ["faded", "worded", "last"],
  );
  const styled = applyEditorOperations(
    multi,
    planCaptionPreset(multi, "main", "bold"),
    multi.revision,
  );
  const bold = captionPresetStyle(styled.sequences[0]!, "bold");
  for (const clip of listCaptions(styled, "main")) {
    const before = captions(multi).find((item) => item.id === clip.id)!;
    assert.deepEqual(clip.style, { ...bold, animation: before.style.animation });
    assert.deepEqual(clip.words, before.words);
    assert.deepEqual(clip.translation, before.translation);
    assert.equal(clip.text, before.text);
  }
  assert.deepEqual(
    captions(styled).find((clip) => clip.id === "title"),
    captions(multi).find((clip) => clip.id === "title"),
  );
  assert.equal(styled.production?.legacyCaptionStyle, "bold");
  assert.equal(projectLegacyView(styled).project.captionStyle, "bold");
  assert.deepEqual(planCaptionPreset(styled, "main", "bold"), []);
});

test("manual caption timing detaches source following, trims real words and respects locks", () => {
  const doc = generated(),
    original = captions(doc)[0]!;
  assert.ok(original.sourceBinding);
  assert.equal(original.start, T);
  const shortened = applyEditorOperations(
    doc,
    planCaptionTiming(doc, "main", original.id, { start: T, end: 2 * T }),
    doc.revision,
  );
  let caption = captions(shortened)[0]!;
  assert.equal(caption.sourceBinding, undefined);
  assert.equal(caption.duration, T);
  assert.deepEqual(caption.words, [{ text: "你好", start: 0, end: T }]);
  assert.equal(caption.text, "你好 世界", "A retime never rewrites the caption text");
  assert.equal(caption.style.animation, "word-highlight");
  const clamped = applyEditorOperations(
    doc,
    planCaptionTiming(doc, "main", original.id, { start: T, end: 2.5 * T }),
    doc.revision,
  );
  assert.deepEqual(captions(clamped)[0]!.words, [
    { text: "你好", start: 0, end: T },
    { text: "世界", start: T, end: 1.5 * T },
  ]);
  const moved = applyEditorOperations(
    doc,
    planCaptionTiming(doc, "main", original.id, { start: 1.5 * T, end: 3.5 * T }),
    doc.revision,
  );
  caption = captions(moved)[0]!;
  assert.equal(caption.start, 1.5 * T);
  assert.equal(caption.duration, 2 * T);
  assert.deepEqual(caption.words, original.words, "Clip-local words move with the caption");
  const sourceMoved = applyEditorOperations(
    moved,
    [{ type: "clip.move", sequenceId: "main", clipIds: ["sound"], delta: T }],
    moved.revision,
  );
  assert.equal(captions(sourceMoved)[0]!.start, 1.5 * T, "A manual time is never snapped back");
  assert.throws(
    () => planCaptionTiming(doc, "main", original.id, { start: 2 * T, end: 2 * T }),
    /结束时间/,
  );
  const locked = applyEditorOperations(
    doc,
    [{ type: "track.update", sequenceId: "main", trackId: "t", patch: { locked: true } }],
    doc.revision,
  );
  assert.throws(
    () => planCaptionTiming(locked, "main", original.id, { start: 0, end: T }),
    /锁定/,
  );
  assert.throws(() => planRemoveCaptions(locked, "main", [original.id]), /锁定/);
  assert.throws(() => planCaptionPreset(locked, "main", "minimal"), /锁定/);
  assert.throws(
    () => planAddCaption(locked, "main", { start: 0, text: "新字幕", trackId: "t" }),
    /锁定/,
  );
});

test("retiming never lengthens the sequence and keeps duration-relative animations", () => {
  const doc = realMedia(),
    end = 1_234_567 + 10_000_123;
  const tail = applyEditorOperations(
    doc,
    planAddCaption(doc, "main", { start: end - 2 * T, text: "尾声", idFactory: () => "tail" }),
    doc.revision,
  );
  const extended = applyEditorOperations(
    tail,
    planCaptionTiming(tail, "main", "tail", { start: end - 2 * T, end: end + 5 * T }),
    tail.revision,
  );
  const caption = listCaptions(extended, "main")[0]!;
  assert.equal(caption.start + caption.duration, end, "Clamped to the picture end");
  assert.equal(sequenceDuration(extended.sequences[0]!), end);
  assert.throws(
    () => planCaptionTiming(tail, "main", "tail", { start: end, end: end + T }),
    /画面范围/,
  );
  const styled = (animation: "typewriter" | "fade") => {
    const added = applyEditorOperations(
      doc,
      planAddCaption(doc, "main", {
        start: 2 * T,
        duration: 2 * T,
        text: "逐字出现的字幕",
        idFactory: () => animation,
      }),
      doc.revision,
    );
    return applyEditorOperations(
      added,
      planCaptionStyle(added, "main", [animation], { animation }),
      added.revision,
    );
  };
  for (const animation of ["typewriter", "fade"] as const) {
    const before = styled(animation);
    const shortened = applyEditorOperations(
      before,
      planCaptionTiming(before, "main", animation, { start: 2.5 * T, end: 3.5 * T }),
      before.revision,
    );
    const clip = listCaptions(shortened, "main")[0]!;
    assert.deepEqual([clip.start, clip.duration], [2.5 * T, T]);
    assert.equal(clip.style.animation, animation, "The animation scales with the new length");
    assert.equal(clip.text, "逐字出现的字幕");
    assert.equal(clip.transform.opacity, 1, "A fade stays a fade, not baked keyframes");
  }
  const keyed = styled("fade");
  const id = listCaptions(keyed, "main")[0]!.id;
  const animated = applyEditorOperations(
    keyed,
    [
      {
        type: "clip.update",
        sequenceId: "main",
        clipId: id,
        patch: {
          transform: {
            ...listCaptions(keyed, "main")[0]!.transform,
            x: {
              keyframes: [
                { time: 0, value: 0 },
                { time: 2 * T, value: 0.2 },
              ],
            },
          },
        },
      },
    ],
    keyed.revision,
  );
  const halved = applyEditorOperations(
    animated,
    planCaptionTiming(animated, "main", id, { start: 2 * T, end: 3 * T }),
    animated.revision,
  );
  assert.deepEqual(listCaptions(halved, "main")[0]!.transform.x, {
    keyframes: [
      { time: 0, value: 0 },
      { time: T, value: 0.2 },
    ],
  });
});

test("new captions from every path follow the project's caption preset", () => {
  const base = fixture(),
    seq = base.sequences[0]!;
  const look = (preset: "classic" | "bold" | "minimal") => {
    const template = captionTemplate({
      width: seq.width,
      height: seq.height,
      captionStyle: preset,
    });
    return { style: template.style, transform: template.transform };
  };
  const added = (doc: EditorDocument) =>
    captions(
      applyEditorOperations(
        doc,
        planAddCaption(doc, "main", { start: T, text: "新字幕", idFactory: () => "fresh" }),
        doc.revision,
      ),
    ).find((clip) => clip.id === "fresh")!;
  const plain = added(base);
  assert.deepEqual({ style: plain.style, transform: plain.transform }, look("classic"));
  const first = applyEditorOperations(
    base,
    planAddCaption(base, "main", { start: 0, text: "第一条", idFactory: () => "first" }),
    base.revision,
  );
  const bold = applyEditorOperations(
    first,
    planCaptionPreset(first, "main", "bold"),
    first.revision,
  );
  const again = added(bold);
  assert.deepEqual({ style: again.style, transform: again.transform }, look("bold"));
  const imported = applyEditorOperations(
    bold,
    planSrtImport(bold, "main", "1\n00:00:05,000 --> 00:00:06,000\n导入\n").operations,
    bold.revision,
  );
  assert.ok(listCaptions(imported, "main").every((clip) => clip.style.color === "#ffe46b"));
  assert.deepEqual(captions(imported).at(-1)!.style, look("bold").style);
  const preferred = fixture();
  preferred.production = { legacyCaptionStyle: "minimal" };
  const transcribed = captions(generated(validateEditorDocument(preferred)))[0]!;
  assert.deepEqual(transcribed.style, { ...look("minimal").style, animation: "word-highlight" });
});

test("word-timed transcripts caption only the words actually played in trimmed or repeated audio", () => {
  const doc = fixture(),
    seq = doc.sequences[0]!;
  const trimmed = media("sound", "a", 4 * T, T);
  trimmed.timeMap = {
    points: [
      { time: 0, source: T },
      { time: T, source: 2 * T },
    ],
  };
  seq.clips = [trimmed];
  const words = [
    { start: 0, end: 1, text: "删除" },
    { start: 1, end: 2, text: "保留" },
    { start: 2, end: 3, text: "删除" },
  ];
  const kept = applyEditorOperations(
    validateEditorDocument(doc),
    planTranscriptCaptions(
      validateEditorDocument(doc),
      "main",
      new Map([["voice", [{ start: 0, end: 3, text: "删除保留删除", words }]]]),
    ).operations,
    doc.revision,
  );
  assert.deepEqual(
    captions(kept).map((clip) => [clip.start, clip.duration, clip.text]),
    [[4 * T, T, "保留"]],
  );
  const unplayed = planTranscriptCaptions(
    validateEditorDocument(doc),
    "main",
    new Map([
      [
        "voice",
        [{ start: 0, end: 3, text: "静音里的完整句子", words: [{ start: 2, end: 3, text: "没有播放" }] }],
      ],
    ]),
  );
  assert.equal(unplayed.added, 0, "Known word times inside unplayed audio never become a caption");
  const repeated = fixture();
  repeated.sequences[0]!.clips = [
    media("first", "a", 3 * T, 2 * T),
    media("again", "a", 14 * T, 2 * T),
    { ...media("muted", "a", 17 * T, 2 * T), audio: { ...defaultAudioMix(), volume: 0 } },
  ];
  const placed = applyEditorOperations(
    validateEditorDocument(repeated),
    planTranscriptCaptions(
      validateEditorDocument(repeated),
      "main",
      new Map([["voice", [{ start: 1, end: 2, text: "画面前的旁白" }]]]),
    ).operations,
    repeated.revision,
  );
  const clips = captions(placed);
  assert.deepEqual(
    clips.map((clip) => [clip.start, clip.duration]),
    [
      [4 * T, T],
      [15 * T, T],
    ],
  );
  assert.notEqual(clips[0]!.id, clips[1]!.id);
});

test("Chinese word timings form readable captions at real word starts across repeated trims", () => {
  const doc = fixture();
  doc.assets[0]!.duration = 20 * T;
  const trim = (id: string, start: number, from: number, to: number) => {
    const clip = media(id, "a", start, to - from);
    clip.timeMap = {
      points: [
        { time: 0, source: from },
        { time: to - from, source: to },
      ],
    };
    return clip;
  };
  doc.sequences[0]!.clips = [trim("a", 0, 3 * T, 10 * T), trim("b", 7 * T, 0, 5 * T)];
  const words = Array.from({ length: 44 }, (_, index) => ({
    start: (index * 13.82) / 44,
    end: ((index + 1) * 13.82) / 44,
    text: "画面",
  }));
  const result = applyEditorOperations(
    validateEditorDocument(doc),
    planTranscriptCaptions(
      validateEditorDocument(doc),
      "main",
      new Map([
        ["voice", [{ start: 0, end: 13.82, text: words.map((w) => w.text).join(""), words }]],
      ]),
    ).operations,
    doc.revision,
  );
  const clips = captions(result).sort((a, b) => a.start - b.start);
  assert.ok(clips.length >= 5);
  assert.ok(clips.every((clip) => [...clip.text].length <= 30));
  assert.ok(clips.every((clip) => clip.duration > 0 && clip.duration <= 4.5 * T));
  assert.equal(clips[0]!.start, 0);
  assert.ok(clips.some((clip) => clip.start === 7 * T));
  const starts = new Set(words.map((word) => secondsToTicks(word.start)));
  for (const clip of clips.filter((clip) => clip.start > 0 && clip.start < 7 * T))
    assert.ok(starts.has(clip.start + 3 * T), `caption starts at a real word: ${clip.start}`);
  const sentence = applyEditorOperations(
    fixture(),
    planTranscriptCaptions(
      fixture(),
      "main",
      new Map([["voice", [{ start: 1, end: 3, text: "没有逐字时间就保留真实整段范围" }]]]),
    ).operations,
    0,
  );
  assert.deepEqual(
    captions(sentence).map((clip) => [clip.start, clip.duration, clip.text]),
    [[T, 2 * T, "没有逐字时间就保留真实整段范围"]],
  );
});

test("new subtitles avoid a title track and join the track that already holds subtitles", () => {
  const title: TextClip = {
    id: "title",
    kind: "text",
    role: "title",
    label: "标题",
    trackId: "t",
    start: 0,
    duration: T,
    text: "标题",
    style: defaultTextStyle(),
    words: [],
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
  const titled = fixture();
  titled.sequences[0]!.clips.push(title);
  const plan = planTranscriptCaptions(titled, "main", new Map([["voice", transcript]]));
  const after = applyEditorOperations(titled, plan.operations, titled.revision);
  const subtitles = captions(after).filter((clip) => clip.role === "subtitle");
  assert.ok(subtitles.length);
  assert.ok(subtitles.every((clip) => clip.trackId !== "t"), "The title track keeps only titles");
  const both = structuredClone(titled);
  both.sequences[0]!.tracks.push(createTrack("subs", "text", "字幕"));
  both.sequences[0]!.clips.push({
    ...structuredClone(title),
    id: "old-sub",
    role: "subtitle",
    trackId: "subs",
    start: 10 * T,
  });
  const again = planSrtImport(both, "main", "1\n00:00:01,000 --> 00:00:02,000\n新字幕\n");
  const imported = applyEditorOperations(both, again.operations, both.revision);
  assert.equal(captions(imported).find((clip) => clip.text === "新字幕")?.trackId, "subs");
});

test("generated and imported subtitles never hide under existing ones on the same track", () => {
  const imported = (() => {
    const doc = fixture();
    const plan = planSrtImport(doc, "main", "1\n00:00:02,500 --> 00:00:03,500\n导入的字幕\n", {
      idFactory: () => "imported",
      avoidOverlaps: true,
    });
    return applyEditorOperations(doc, plan.operations, doc.revision);
  })();
  // The transcript's 1–2 s phrase is free; its 2–3 s phrase would cover the imported cue.
  const plan = planTranscriptCaptions(
    imported,
    "main",
    new Map([
      [
        "voice",
        [
          { start: 1, end: 2, text: "你好" },
          { start: 2, end: 3, text: "世界" },
        ],
      ],
    ]),
    { avoidOverlaps: true },
  );
  const after = applyEditorOperations(imported, plan.operations, imported.revision);
  const subtitles = captions(after).filter((clip) => clip.role === "subtitle");
  for (const a of subtitles)
    for (const b of subtitles)
      if (a !== b && a.trackId === b.trackId)
        assert.ok(
          a.start + a.duration <= b.start || b.start + b.duration <= a.start,
          `${a.text} overlaps ${b.text}`,
        );
  assert.ok(subtitles.some((clip) => clip.text === "导入的字幕"));
  assert.ok(subtitles.some((clip) => clip.text === "你好"));
  assert.ok(plan.notices.some((notice) => /重叠/.test(notice)), plan.notices.join("\n"));
  // Importing an SRT over generated captions reports the same way.
  const srt = planSrtImport(after, "main", "1\n00:00:01,500 --> 00:00:02,200\n盖住\n", {
    avoidOverlaps: true,
  });
  assert.equal(srt.added, 0);
  assert.ok(srt.notices.some((notice) => /重叠/.test(notice)));
});

test("a new subtitle track gets a distinct name and an empty 字幕 track is not taken by titles", async () => {
  const { planTextPlacement } = await import("../apps/video-studio/src/editor/placement");
  const doc = fixture();
  const seq = doc.sequences[0]!;
  seq.tracks = seq.tracks.filter((track) => track.id !== "t");
  seq.tracks.push(createTrack("subs", "text", "字幕"));
  // 添加文字 leaves the empty subtitle track for subtitles.
  const text = planTextPlacement(seq, 0, T, () => "titles");
  assert.notEqual(text.trackId, "subs");
  // When titles already sit on the track named 字幕, the new subtitle track is 字幕 2.
  seq.clips.push({
    id: "title",
    kind: "text",
    role: "title",
    label: "标题",
    trackId: "subs",
    start: 0,
    duration: T,
    text: "标题",
    style: defaultTextStyle(),
    words: [],
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  });
  const valid = validateEditorDocument(doc);
  const operations = planAddCaption(valid, "main", {
    start: 2 * T,
    text: "新字幕",
    idFactory: () => "caption-new",
  });
  const added = operations.find((operation) => operation.type === "track.add");
  assert.ok(added && added.type === "track.add");
  assert.equal(added.track.name, "字幕 2");
});

test("the 字幕 page reports and skips generated or imported subtitles that would hide existing ones", async (t) => {
  const doc = fixture();
  doc.sequences[0]!.clips.push({
    id: "kept",
    kind: "text",
    role: "subtitle",
    label: "字幕",
    trackId: "t",
    start: 2 * T,
    duration: 2 * T,
    text: "已有字幕",
    style: defaultTextStyle(),
    words: [],
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  });
  const h = await harness(t, { prepare: async () => {} }, validateEditorDocument(doc));
  await h.controller.generate({ sequenceId: "main", assetIds: ["voice"] });
  const candidate = h.controller.getState().candidate!;
  assert.equal(candidate.added, 0);
  assert.ok(candidate.notices.some((notice) => /重叠/.test(notice)), candidate.notices.join("\n"));
  h.controller.cancel?.();
});


test("WebVTT consumes headers, identifiers, NOTE/style/region blocks and settings without turning metadata into text", () => {
  const source = "\uFEFFWEBVTT 汉语\r\n\r\nNOTE 注释\r\n00:09.000 --> 00:10.000\r\n伪字幕\r\n\r\nSTYLE\r\n::cue { color: red; }\r\n\r\nREGION\r\nid:top\r\nwidth:50%\r\n\r\n中文 cue id\r\n00:00.033 --> 00:01.067 align:start line:90% position:10%,line-left size:80% region:top\r\n<v.first 小明><b>你好</b> &amp; &lt;b&gt; &#x1f642;\r\n第二行\r\n\r\n尾声\r\n23:59:59.999 --> 24:00:00.000\r\n结束\r\n";
  assert.deepEqual(parseEditorVtt(source), [
    { start: 7920, end: 256080, text: "你好 & <b> 🙂\n第二行" },
    { start: 24 * 3600 * T - 240, end: 24 * 3600 * T, text: "结束" },
  ]);
  const doc = fixture(), before = structuredClone(doc), plan = planVttImport(doc, "main", source);
  assert.equal(plan.added, 2);
  assert.ok(plan.notices.some((notice) => /位置.*不保留/.test(notice)));
  assert.ok(plan.notices.some((notice) => /标识不保留/.test(notice)));
  assert.ok(plan.notices.some((notice) => /行内格式/.test(notice)));
  const after = applyEditorOperations(doc, plan.operations, doc.revision);
  assert.deepEqual(captions(after).map(({ words, sourceBinding, translation }) => [words, sourceBinding, translation]), [[[], undefined, undefined], [[], undefined, undefined]]);
  assert.equal(planVttImport(after, "main", source).skipped, 2);
  assert.deepEqual(doc, before);
  assert.deepEqual(parseEditorVtt("WEBVTT\n \t\ncue\n00:00.001 --> 00:01.001\n文字\n"), [{ start: 240, end: 240240, text: "文字" }]);
  assert.deepEqual(parseEditorVtt("WEBVTT"), []);
  assert.deepEqual(parseEditorVtt("WEBVTT\n\nNOTE only comments\n"), []);
});

test("WebVTT rejects malformed timing, external clocks and unsupported timed/ruby text atomically", () => {
  const cue = (body: string, timing = "00:00.001 --> 00:01.001") => `WEBVTT\n\n${timing}\n${body}\n`;
  for (const bad of [
    "WEBVTTx\n\n00:00.000 --> 00:01.000\n文字", "WEBVTT --> header", "WEBVTT\n00:00.000 --> 00:01.000\n文字",
    "WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n\n00:00.000 --> 00:01.000\n文字",
    cue("文字", "00:60.000 --> 01:01.000"), cue("文字", "00:00,000 --> 00:01,000"),
    cue("文字", "00:00.001 --> 00:00.001"), cue("文字", "24:00:00.000 --> 24:00:00.001"),
    cue("文字", "00:00.00 --> 00:01.000"), cue("文字", "00:00.000-->00:01.000"),
    cue("文字\n00:02.000 --> 00:03.000\n丢了空行"), cue("<ruby>漢<rt>kan</rt></ruby>"),
    cue("文字<00:00.500>更多"), cue("<script>不执行</script>"), cue("未闭合<b"),
    cue("<".repeat(50000)), cue("&copy;"), cue("&amp 未闭合引用"), cue("&#128;"), cue("&#0;"), cue("&#xD800;"), cue("坏\u0000字"),
  ]) assert.throws(() => parseEditorVtt(bad), /VTT|WEBVTT/);
  assert.throws(() => parseEditorVtt("WEBVTT\n\n" + Array.from({ length: 2001 }, () => "00:00.001 --> 00:01.001\n字\n").join("\n")), /2000/);
  const doc = fixture(), before = structuredClone(doc);
  assert.throws(() => planVttImport(doc, "main", cue("文字") + "\n00:02.000 --> 00:03.000\n<ruby>坏</ruby>"), /标签/);
  assert.deepEqual(doc, before);
});

test("WebVTT plain-text export escapes markup and arrows, quantizes ticks once and preserves caption metadata", () => {
  const doc = generated(), selected = captions(doc)[0]!;
  selected.text = '字面 <b>不是粗体</b> &amp; & -- > -->\n"引号"🙂';
  selected.start = T + 13; selected.duration = 2 * T + 240;
  const before = structuredClone(doc), output = exportEditorVtt(doc, "main", [selected.id]);
  assert.match(output, /^WEBVTT\n\n1\n00:00:01\.000 --> 00:00:03\.001\n/);
  assert.match(output, /&lt;b&gt;/);
  assert.match(output, /--&gt;/);
  assert.deepEqual(parseEditorVtt(output), [{ start: T, end: 3 * T + 240, text: selected.text }]);
  assert.deepEqual(doc, before);
  assert.throws(() => exportEditorVtt(doc, "main", [selected.id, selected.id]), /有效/);
  assert.throws(() => exportEditorVtt(doc, "main", ["missing"]), /有效/);
  assert.equal(exportEditorVtt(doc, "main", []), "WEBVTT\n\n");
  selected.words = []; delete selected.sourceBinding;
  selected.duration = 1;
  assert.throws(() => exportEditorVtt(doc, "main"), /毫秒精度/);
  selected.duration = T; selected.text = "第一行\n\n第二行";
  assert.throws(() => exportEditorVtt(doc, "main"), /第1条.*空白分隔行/);
});

test("WebVTT planning uses full graph/lock validation and retains the existing overlap policy", () => {
  const doc = fixture(), source = "WEBVTT\n\n00:01.001 --> 00:02.003\n字幕\n";
  doc.sequences[0]!.tracks.push(createTrack("vtt-text", "text"));
  doc.sequences[0]!.tracks.at(-1)!.locked = true;
  assert.throws(() => planVttImport(doc, "main", source, { trackId: "vtt-text" }), /未锁定/);
  doc.sequences[0]!.tracks.at(-1)!.locked = false;
  const after = applyEditorOperations(doc, planVttImport(doc, "main", source, { trackId: "vtt-text" }).operations, doc.revision);
  const overlap = planVttImport(after, "main", source.replace("字幕", "新文字"), { trackId: "vtt-text", avoidOverlaps: true });
  assert.equal(overlap.added, 0); assert.equal(overlap.skipped, 1);
  assert.match(overlap.notices.join("\n"), /重叠/);
  const malformed = structuredClone(doc); malformed.sequences[0]!.clips[0]!.duration = -1;
  assert.throws(() => planVttImport(malformed, "main", source));
});

test("WebVTT controller previews then durably applies once, retries save failure and rejects stale/cancelled candidates", async (t) => {
  const h = await harness(t), source = "WEBVTT\n\ncue\n00:00.033 --> 00:01.067 align:left\n你好\n";
  h.controller.importVtt({ sequenceId: "main", text: source });
  assert.equal(h.controller.getState().candidate!.label, "导入 VTT 字幕");
  assert.match(h.controller.getState().candidate!.notices.join("\n"), /位置/);
  assert.equal(h.session.read().revision, 0);
  h.store.fail = true; await assert.rejects(h.controller.apply(), /保存失败/);
  h.store.fail = false; await h.controller.apply();
  assert.equal(captions(h.session.read()).length, 1);
  h.session.undo(); assert.equal(captions(h.session.read()).length, 0);
  h.controller.importVtt({ sequenceId: "main", text: source });
  h.controller.cancel(); await assert.rejects(h.controller.apply(), /预览|候选|待应用/);
  h.controller.importVtt({ sequenceId: "main", text: source });
  h.session.dispatch([{ type: "project.rename", name: "更新工程" }], h.session.getState().identity, "rename", "user");
  assert.equal(h.controller.getState().phase, "stale");
  await assert.rejects(h.controller.apply(), /预览|候选|待应用/);
  assert.equal(captions(h.session.read()).length, 0);
});

test("WebVTT import cannot publish a candidate after a synchronous revision during planning", async (t) => {
  let change: (() => void) | undefined, serial = 0;
  const h = await harness(t, { idFactory: () => { change?.(); change = undefined; return `vtt-${++serial}`; } });
  change = () => h.session.dispatch([{ type: "project.rename", name: "规划时更新" }], h.session.getState().identity);
  assert.throws(() => h.controller.importVtt({ sequenceId: "main", text: "WEBVTT\n\n00:00.001 --> 00:01.001\n字幕\n" }), /取消|变化/);
  assert.equal(h.controller.getState().candidate, undefined);
  assert.equal(captions(h.session.read()).length, 0);
  assert.equal(h.session.read().name, "规划时更新");
});
