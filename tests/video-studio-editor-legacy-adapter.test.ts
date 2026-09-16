import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOperations,
  validateProject,
  timelineClips,
  type Project,
} from "../apps/video-studio/src/model";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import {
  projectLegacyView,
  applyLegacyProjectChange,
  LEGACY_FRAME_TICKS,
} from "../apps/video-studio/src/editor/legacy-adapter";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { evaluateAnimatedNumber } from "../apps/video-studio/src/editor/animation";
import { validateEditorDocument } from "../apps/video-studio/src/editor/validation";
import type { EditorDocument, MediaClip, TextClip } from "../apps/video-studio/src/editor/types";

const T = LEGACY_FRAME_TICKS;
function legacy(): Project {
  return validateProject({
    schemaVersion: 1,
    id: "project",
    name: "口播制作",
    revision: 4,
    width: 1920,
    height: 1080,
    fps: 30,
    captionStyle: "bold",
    assets: [
      {
        id: "video",
        kind: "video",
        name: "原片",
        durationFrames: 300,
        mediaId: `asset-${"a".repeat(64)}`,
        proxyId: `asset-${"b".repeat(64)}`,
        thumbnailId: `asset-${"c".repeat(64)}`,
        sourcePath: "camera/take.mp4",
        size: 2048,
        lastModified: 1700000000,
      },
      {
        id: "voice",
        kind: "audio",
        name: "本人录音",
        durationFrames: 180,
        mediaId: `asset-${"d".repeat(64)}`,
        speech: { text: "你好，世界。", voiceId: "me", engine: "audio8", rate: 1 },
      },
    ],
    clips: [
      { id: "same", assetId: "video", inFrame: 0, outFrame: 90, volume: 1 },
      { id: "second", assetId: "video", inFrame: 100, outFrame: 190, volume: 0.8 },
    ],
    audioClips: [
      { id: "same", assetId: "voice", inFrame: 0, outFrame: 120, startFrame: 0, volume: 0.5 },
    ],
    captions: [
      { id: "same", text: "第一句", startFrame: 30, endFrame: 60 },
      { id: "caption-two", text: "第二句", startFrame: 100, endFrame: 140 },
    ],
    script: "你好，世界。",
    narration: { phase: "draft", captionBasis: "draft", draftCaptionIds: ["same"] },
    workflow: {
      stage: "sound",
      brief: "制作口播",
      outline: "开场与结尾",
      sources: [{ assetId: "video", role: "main", note: "主镜头" }],
      nextSteps: ["字幕"],
      blockers: [],
    },
    roughCuts: [
      { id: "cut", assetId: "video", inFrame: 10, outFrame: 50, name: "保留开场", enabled: true },
    ],
  });
}
function document(): EditorDocument {
  return migrateLegacyProject(legacy());
}
function change(doc: EditorDocument, after: Project) {
  const view = projectLegacyView(doc);
  const operations = applyLegacyProjectChange(
    doc,
    view,
    structuredClone(view.project),
    after,
    doc.revision,
  );
  return { operations, document: applyEditorOperations(doc, operations, doc.revision) };
}
function media(doc: EditorDocument, id = "same"): MediaClip {
  return doc.sequences[0]!.clips.find((clip) => clip.id === id) as MediaClip;
}
function caption(doc: EditorDocument, id = "same-migrated-2"): TextClip {
  return doc.sequences[0]!.clips.find((clip) => clip.id === id) as TextClip;
}

test("migration round-trip projects legacy namespaces and production provenance without storing an editable v1 copy", () => {
  const doc = document(),
    original = structuredClone(doc),
    view = projectLegacyView(doc);
  assert.deepEqual(view.project, { ...legacy(), timelineMode: "magnetic" });
  assert.deepEqual(
    view.clips
      .filter((item) => item.legacyId === "same")
      .map((item) => [item.collection, item.clipId]),
    [
      ["clips", "same"],
      ["audioClips", "same-migrated-1"],
      ["captions", "same-migrated-2"],
    ],
  );
  assert.equal(view.timelineComplete, true);
  assert.equal(view.renderSafe, true);
  assert.throws(() => {
    view.project.clips[0]!.volume = 0;
  }, TypeError);
  const operations = applyLegacyProjectChange(
    doc,
    view,
    structuredClone(view.project),
    structuredClone(view.project),
    doc.revision,
  );
  assert.deepEqual(operations, []);
  assert.deepEqual(doc, original);
  assert.equal(Object.hasOwn(doc.production!, "project"), false);
});

test("asset import/update and workflow changes preserve media handles, speech, unknown metadata and all v2 effects", () => {
  const doc = document();
  doc.assets[0]!.duration += 123;
  doc.assets[0]!.fingerprint = "e".repeat(64);
  doc.assets[0]!.metadata!.privateNotes = { take: 8 };
  media(doc).transform.rotation = {
    keyframes: [
      { time: 0, value: 0 },
      { time: 90 * T, value: 60 },
    ],
  };
  media(doc).color.exposure = 0.6;
  doc.production!.custom = { retained: true };
  const view = projectLegacyView(doc),
    after = structuredClone(view.project);
  after.assets[0]!.name = "重新命名";
  after.assets[0]!.proxyId = `asset-${"f".repeat(64)}`;
  after.assets.push({
    id: "recording",
    kind: "audio",
    name: "新录音",
    durationFrames: 60,
    mediaId: `asset-${"1".repeat(64)}`,
    speech: { text: "新录音稿", voiceId: "me", engine: "audio8", rate: 1 },
  });
  after.workflow!.stage = "captions";
  after.narration!.draftCaptionIds.push("caption-two");
  after.script = "更新的口播文稿";
  const result = change(doc, after);
  assert.equal(result.document.revision, doc.revision + 1);
  assert.equal(result.document.assets[0]!.duration, 300 * T + 123);
  assert.equal(result.document.assets[0]!.resourceId, doc.assets[0]!.resourceId);
  assert.equal(result.document.assets[0]!.fingerprint, doc.assets[0]!.fingerprint);
  assert.deepEqual(result.document.assets[0]!.metadata!.privateNotes, { take: 8 });
  assert.equal(result.document.assets[0]!.metadata!.proxyId, after.assets[0]!.proxyId);
  assert.deepEqual(result.document.assets[1]!.metadata!.speech, doc.assets[1]!.metadata!.speech);
  assert.deepEqual(media(result.document).transform, media(doc).transform);
  assert.deepEqual(media(result.document).color, media(doc).color);
  assert.deepEqual(result.document.production!.roughCuts, doc.production!.roughCuts);
  assert.deepEqual(result.document.production!.custom, { retained: true });
  assert.equal(result.document.production!.script, after.script);
});

test("new narration audio and rough-cut clips merge while existing independent audio tracks keep their own identity", () => {
  const doc = document(),
    view = projectLegacyView(doc);
  const after = applyOperations(
    structuredClone(view.project),
    [
      {
        type: "audio-add",
        assetId: "voice",
        inFrame: 30,
        outFrame: 75,
        startFrame: 30,
        volume: 0.7,
      },
      { type: "add", assetId: "video", inFrame: 200, outFrame: 240 },
    ],
    view.project.revision,
  );
  const result = change(doc, after).document,
    sequence = result.sequences[0]!;
  assert.equal(media(result, "same-migrated-1").trackId, "track-audio-1");
  const addedAudio = sequence.clips.find(
    (clip) => clip.kind === "media" && clip.assetId === "voice" && clip.id !== "same-migrated-1",
  ) as MediaClip;
  assert.notEqual(addedAudio.trackId, "track-audio-1");
  assert.equal(addedAudio.start, 30 * T);
  assert.equal(addedAudio.duration, 45 * T);
  assert.equal(addedAudio.audio.volume, 0.7);
  assert.equal(
    sequence.clips.filter((clip) => clip.kind === "media" && clip.assetId === "video").length,
    3,
  );
  assert.deepEqual(projectLegacyView(result).project.clips, after.clips);
});

test("source trimming retains keyframes, color and owned subtitle source binding while legacy ripple remains atomic", () => {
  const doc = document();
  media(doc).transform.x = {
    keyframes: [
      { time: 0, value: 0 },
      { time: 90 * T, value: 0.9 },
    ],
  };
  media(doc).color.saturation = 1.6;
  const text = caption(doc);
  text.sourceBinding = { clipId: "same", sourceStart: 30 * T, sourceEnd: 60 * T };
  const after = applyOperations(
    structuredClone(projectLegacyView(doc).project),
    [{ type: "trim", clipId: "same", inFrame: 15, outFrame: 75 }],
    doc.revision,
  );
  const result = change(doc, after).document;
  assert.equal(media(result).start, 0);
  assert.equal(media(result).duration, 60 * T);
  assert.equal(media(result).timeMap.points[0]!.source, 15 * T);
  assert.ok(Math.abs(evaluateAnimatedNumber(media(result).transform.x, 0) - 0.15) < 1e-9);
  assert.equal(media(result).color.saturation, 1.6);
  assert.equal(caption(result).start, 15 * T);
  assert.deepEqual(caption(result).sourceBinding, text.sourceBinding);
  assert.equal(media(result, "second").start, 60 * T);
  assert.equal(result.revision, doc.revision + 1);
});

test("legacy splits preserve both halves' v2 properties and split bound subtitles through canonical helpers", () => {
  const doc = document();
  media(doc).transform.rotation = {
    keyframes: [
      { time: 0, value: 0 },
      { time: 90 * T, value: 90 },
    ],
  };
  media(doc).mask = {
    kind: "ellipse",
    x: 0.1,
    y: 0,
    width: 0.8,
    height: 1,
    rotation: 0,
    feather: 0.1,
    inverted: false,
  };
  caption(doc).sourceBinding = { clipId: "same", sourceStart: 30 * T, sourceEnd: 60 * T };
  const after = applyOperations(
    structuredClone(projectLegacyView(doc).project),
    [{ type: "split", clipId: "same", atFrame: 45 }],
    doc.revision,
  );
  const rightLegacy = after.clips.find((clip) => clip.id !== "same" && clip.inFrame === 45)!;
  const result = change(doc, after).document,
    right = media(result, rightLegacy.id);
  assert.equal(media(result).duration, 45 * T);
  assert.equal(right.duration, 45 * T);
  assert.equal(right.start, 45 * T);
  assert.deepEqual(right.mask, media(doc).mask);
  assert.equal(evaluateAnimatedNumber(right.transform.rotation, 0), 45);
  const captions = result.sequences[0]!.clips.filter(
    (clip): clip is TextClip => clip.kind === "text" && !!clip.sourceBinding,
  );
  assert.equal(captions.length, 2);
  assert.equal(captions[0]!.duration, 15 * T);
  assert.equal(captions[1]!.sourceBinding!.clipId, right.id);
});

test("namespace collisions for newly generated clips remain stable on the next legacy view", () => {
  const doc = document(),
    after = structuredClone(projectLegacyView(doc).project);
  after.audioClips!.push({
    id: "second",
    assetId: "voice",
    inFrame: 0,
    outFrame: 30,
    startFrame: 90,
    volume: 0.6,
  });
  after.captions.push({ id: "second", text: "新字幕", startFrame: 0, endFrame: 15 });
  const result = change(doc, after).document,
    view = projectLegacyView(result);
  assert.equal(view.project.audioClips!.find((clip) => clip.id === "second")!.volume, 0.6);
  assert.equal(view.project.captions.find((caption) => caption.id === "second")!.text, "新字幕");
  const ids = view.clips.filter((item) => item.legacyId === "second").map((item) => item.clipId);
  assert.equal(new Set(ids).size, 3);
  assert.ok(Array.isArray(result.production!.legacyAliases));
  assert.equal(Object.hasOwn(result.production!, "legacyProject"), false);
});

test("inexpressible time maps, nested/multicam/extra visual tracks are reported without invented clip ranges and permit additive workflows", () => {
  const doc = document(),
    sequence = doc.sequences[0]!;
  sequence.tracks.push(createTrack("extra", "video", "画中画"));
  const extra = structuredClone(media(doc));
  extra.id = "extra-clip";
  extra.trackId = "extra";
  sequence.clips.push(extra);
  const nested = structuredClone(sequence);
  nested.id = "nested";
  nested.clips = [];
  nested.tracks = [createTrack("nested-track", "video")];
  nested.clips.push({
    ...structuredClone(media(doc)),
    id: "nested-source",
    trackId: "nested-track",
  });
  nested.transitions = [];
  nested.markers = [];
  doc.sequences.push(nested);
  sequence.tracks.push(createTrack("nested-parent-track", "video"));
  sequence.clips.push({
    id: "nest",
    kind: "sequence",
    sequenceId: "nested",
    label: "嵌套",
    trackId: "nested-parent-track",
    start: 0,
    duration: 30 * T,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: 30 * T, source: 30 * T },
      ],
    },
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    audio: defaultAudioMix(),
  });
  const view = projectLegacyView(doc);
  assert.equal(view.timelineComplete, false);
  assert.equal(view.renderSafe, false);
  assert.ok(view.restrictions.some((item) => item.clipId === "nest" && item.excluded));
  assert.ok(view.restrictions.some((item) => item.clipId === "extra-clip" && item.excluded));
  assert.equal(view.project.clips.length, 2);
  const originalExtras = structuredClone(sequence.clips.filter((clip) => clip.trackId === "extra"));
  const after = applyOperations(
    structuredClone(view.project),
    [{ type: "audio-add", assetId: "voice", inFrame: 0, outFrame: 30, startFrame: 0 }],
    doc.revision,
  );
  const result = change(doc, after).document;
  assert.deepEqual(
    result.sequences[0]!.clips.filter((clip) => clip.trackId === "extra"),
    originalExtras,
  );
  assert.deepEqual(result.sequences[1], doc.sequences[1]);
  const removed = structuredClone(view.project);
  removed.clips.pop();
  removed.audioClips = [];
  removed.captions = [];
  assert.throws(() => change(doc, removed), /未包含全部片段/);
  const fractional = document();
  media(fractional).start = 1;
  media(fractional, "second").start = 91 * T;
  fractional.sequences[0]!.timelineMode = "free";
  const partial = projectLegacyView(fractional);
  assert.ok(
    partial.restrictions.some((item) => item.clipId === "same" && item.code === "time-map"),
  );
  assert.equal(
    partial.project.clips.some((clip) => clip.id === "same"),
    false,
  );
});

test("advanced animated volume remains untouched on unrelated edits and rejects a legacy scalar overwrite", () => {
  const doc = document();
  media(doc).audio.volume = {
    keyframes: [
      { time: 0, value: 0.4 },
      { time: 90 * T, value: 1.4 },
    ],
  };
  media(doc).audio.pan = 0.3;
  const view = projectLegacyView(doc),
    after = structuredClone(view.project);
  after.name = "只改名称";
  const renamed = change(doc, after).document;
  assert.deepEqual(media(renamed).audio, media(doc).audio);
  after.clips[0]!.volume = 0.8;
  assert.throws(() => change(doc, after), /自动化音量/);
});

test("text edits preserve custom v2 styling, while timed words and incompatible global presets require v2 decisions", () => {
  const doc = document();
  caption(doc).style.fontSize = 62;
  caption(doc).transform.rotation = 12;
  const after = structuredClone(projectLegacyView(doc).project);
  after.captions[0]!.text = "新的中文\n保留换行";
  const result = change(doc, after).document;
  assert.deepEqual(caption(result).style, caption(doc).style);
  assert.deepEqual(caption(result).transform, caption(doc).transform);
  assert.equal(caption(result).text, after.captions[0]!.text);
  after.captionStyle = "minimal";
  assert.throws(() => change(doc, after), /自定义/);
  caption(doc).words = [{ text: "第一句", start: 0, end: 30 * T }];
  delete after.captionStyle;
  after.captionStyle = projectLegacyView(doc).project.captionStyle;
  assert.throws(() => change(doc, after), /逐词时间/);
});

test("stale before snapshots, locked tracks, grouped partial movement and animated extensions fail atomically", () => {
  const doc = document(),
    view = projectLegacyView(doc),
    copy = structuredClone(doc),
    after = structuredClone(view.project);
  after.clips[0]!.volume = 0.6;
  assert.throws(
    () => applyLegacyProjectChange(doc, view, view.project, after, doc.revision - 1),
    /工程已更新/,
  );
  const forged = structuredClone(view.project);
  forged.name = "不是基础快照";
  assert.throws(() => applyLegacyProjectChange(doc, view, forged, after, doc.revision), /基础视图/);
  const locked = document();
  locked.sequences[0]!.tracks[0]!.locked = true;
  assert.throws(() => change(locked, after), /已锁定/);
  const extended = structuredClone(view.project);
  extended.clips[0]!.outFrame = 100;
  extended.captions = [];
  extended.audioClips = [];
  const animated = structuredClone(doc);
  media(animated).transform.x = {
    keyframes: [
      { time: 0, value: 0 },
      { time: 90 * T, value: 1 },
    ],
  };
  assert.throws(() => change(animated, extended), /延长或滑移/);
  const grouped = document();
  grouped.sequences[0]!.timelineMode = "free";
  media(grouped).groupId = "group";
  media(grouped, "second").groupId = "group";
  media(grouped, "second").start = 120 * T;
  const moved = structuredClone(projectLegacyView(grouped).project);
  moved.clips[0]!.startFrame = 10;
  assert.throws(() => change(grouped, moved));
  assert.deepEqual(doc, copy);
});

test("legacy media extension moves magnetic followers first and preserves static v2 effects in one revision", () => {
  const original = legacy();
  original.clips.push({ id: "third", assetId: "video", inFrame: 200, outFrame: 290, volume: 1 });
  const doc = migrateLegacyProject(original),
    clip = media(doc);
  clip.transform.rotation = 18;
  clip.transform.crop.left = 0.1;
  clip.color.exposure = 0.5;
  clip.color.curves = [
    {
      channel: "red",
      points: [
        { x: 0, y: 0.1 },
        { x: 1, y: 0.9 },
      ],
    },
  ];
  clip.mask = {
    kind: "ellipse",
    x: 0.5,
    y: 0.5,
    width: 0.8,
    height: 0.7,
    rotation: 20,
    feather: 0.1,
    inverted: false,
  };
  clip.audio.pan = -0.3;
  clip.audio.pitchSemitones = 2;
  const before = structuredClone(doc),
    after = structuredClone(projectLegacyView(doc).project);
  after.clips[0]!.outFrame = 150;
  const result = change(doc, after).document;
  assert.equal(result.revision, doc.revision + 1);
  assert.deepEqual(media(result), {
    ...clip,
    duration: 150 * T,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: 150 * T, source: 150 * T },
      ],
    },
  });
  assert.deepEqual(
    [media(result, "second").start, media(result, "third").start],
    [150 * T, 240 * T],
  );
  assert.deepEqual(caption(result), caption(doc));
  assert.deepEqual(doc, before);
});

test("legacy magnetic reordering validates the final transaction and retains per-clip effects", () => {
  const doc = document();
  media(doc).color.exposure = 0.7;
  media(doc, "second").transform.rotation = -25;
  const before = structuredClone(projectLegacyView(doc).project);
  const after = applyOperations(
    before,
    [{ type: "move", clipId: "same", toIndex: 1 }],
    doc.revision,
  );
  const result = change(doc, after).document;
  assert.equal(result.revision, doc.revision + 1);
  assert.equal(media(result).start, 90 * T);
  assert.equal(media(result, "second").start, 0);
  assert.deepEqual(media(result).color, media(doc).color);
  assert.deepEqual(media(result, "second").transform, media(doc, "second").transform);
  assert.deepEqual(
    projectLegacyView(result).project.clips.map((clip) => clip.id),
    ["second", "same"],
  );
});

test("legacy image and independent audio extensions honor the original asset bounds including a restored head", () => {
  const original = legacy();
  original.assets[0]!.kind = "image";
  original.roughCuts = [];
  original.clips[0]!.inFrame = 30;
  original.clips[0]!.outFrame = 120;
  const doc = migrateLegacyProject(original),
    after = structuredClone(projectLegacyView(doc).project);
  after.clips[0]!.inFrame = 0;
  after.clips[0]!.outFrame = 240;
  after.audioClips[0]!.outFrame = 180;
  const result = change(doc, after).document;
  assert.equal(media(result).duration, 240 * T);
  assert.deepEqual(media(result).timeMap.points, [
    { time: 0, source: 0 },
    { time: 240 * T, source: 240 * T },
  ]);
  assert.equal(media(result, "same-migrated-1").duration, 180 * T);
  assert.deepEqual(media(result, "same-migrated-1").audio, media(doc, "same-migrated-1").audio);
  const pastSource = structuredClone(after);
  pastSource.audioClips[0]!.outFrame = 181;
  assert.throws(() => change(doc, pastSource), /范围|时长|出点/);
  const slipped = structuredClone(projectLegacyView(doc).project);
  slipped.clips[0]!.inFrame = 0;
  slipped.clips[0]!.outFrame = 90;
  assert.throws(() => change(doc, slipped), /滑移/);
});

test("media extension rejects local fades, audio automation, linked groups, and source-bound captions without mutation", () => {
  const cases: Array<(doc: EditorDocument) => void> = [
    (doc) => {
      media(doc).audio.fadeOut = 10 * T;
    },
    (doc) => {
      media(doc).audio.pan = {
        keyframes: [
          { time: 0, value: 0 },
          { time: 90 * T, value: 1 },
        ],
      };
    },
    (doc) => {
      media(doc).groupId = "group";
      media(doc, "second").groupId = "group";
    },
    (doc) => {
      media(doc).linkGroupId = "linked";
      media(doc, "same-migrated-1").linkGroupId = "linked";
    },
    (doc) => {
      caption(doc).sourceBinding = { clipId: "same", sourceStart: 30 * T, sourceEnd: 60 * T };
    },
  ];
  for (const setup of cases) {
    const doc = document();
    setup(doc);
    const before = structuredClone(doc),
      after = structuredClone(projectLegacyView(doc).project);
    after.clips[0]!.outFrame = 120;
    assert.throws(() => change(doc, after), /延长|绑定|分组/);
    assert.deepEqual(doc, before);
  }
  const transition = document();
  transition.sequences[0]!.timelineMode = "free";
  media(transition, "second").start = 80 * T;
  transition.sequences[0]!.transitions.push({
    id: "transition",
    fromClipId: "same",
    toClipId: "second",
    start: 80 * T,
    duration: 10 * T,
    kind: "dissolve",
  });
  const view = projectLegacyView(transition);
  assert.equal(
    view.project.clips.length,
    0,
    "Overlapping transition clips cannot be trimmed through an incomplete legacy projection",
  );
  const renamed = structuredClone(view.project);
  renamed.name = "只改工程名";
  assert.deepEqual(
    change(transition, renamed).document.sequences[0]!.clips,
    transition.sequences[0]!.clips,
  );
});

test("static draft subtitles can extend with custom styling but timed words, translations and animations require v2 editing", () => {
  const doc = document();
  caption(doc).style.fontSize = 67;
  caption(doc).transform.rotation = 9;
  caption(doc).color.brightness = 0.1;
  const after = structuredClone(projectLegacyView(doc).project);
  after.captions[0]!.endFrame = 90;
  after.captions[0]!.text = "延长后的审稿字幕";
  const result = change(doc, after).document;
  assert.equal(caption(result).duration, 60 * T);
  assert.equal(caption(result).text, after.captions[0]!.text);
  assert.deepEqual(caption(result).style, caption(doc).style);
  assert.deepEqual(caption(result).transform, caption(doc).transform);
  assert.deepEqual(caption(result).color, caption(doc).color);
  for (const setup of [
    (clip: TextClip) => {
      clip.words = [{ text: clip.text, start: 0, end: clip.duration }];
    },
    (clip: TextClip) => {
      clip.style.animation = "fade";
    },
    (clip: TextClip) => {
      clip.translation = { original: "hello", language: "zh", mode: "translated" };
    },
    (clip: TextClip) => {
      clip.sourceBinding = { clipId: "same", sourceStart: 30 * T, sourceEnd: 60 * T };
    },
  ]) {
    const constrained = structuredClone(doc);
    setup(caption(constrained));
    const extended = structuredClone(projectLegacyView(constrained).project);
    extended.captions[0]!.endFrame = 90;
    assert.throws(() => change(constrained, extended), /延长|绑定/);
  }
});

test("a split and right-half volume edit in one legacy batch preserves the split effects and requested gain", () => {
  const doc = document();
  media(doc).transform.rotation = 20;
  const first = applyOperations(
    structuredClone(projectLegacyView(doc).project),
    [{ type: "split", clipId: "same", atFrame: 45 }],
    doc.revision,
  );
  const id = first.clips.find((clip) => clip.inFrame === 45)!.id;
  const after = applyOperations(
    first,
    [{ type: "volume", clipId: id, volume: 0.25 }],
    first.revision,
  );
  const result = change(doc, after).document;
  assert.equal(media(result, id).audio.volume, 0.25);
  assert.equal(media(result, id).transform.rotation, 20);
  assert.equal(media(result).audio.volume, 1);
});

test("non-30-fps frames, fractional ticks and multicam are never normalized away by unrelated legacy work", () => {
  const doc = document(),
    sequence = doc.sequences[0]!;
  sequence.frameRate = { numerator: 24, denominator: 1 };
  sequence.timelineMode = "free";
  media(doc).start = 1;
  media(doc, "second").start = 91 * T;
  sequence.tracks.push(createTrack("multicam-track", "video"));
  sequence.clips.push({
    id: "multicam",
    kind: "multicam",
    trackId: "multicam-track",
    label: "两机位",
    start: 0,
    duration: 30 * T,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: 30 * T, source: 30 * T },
      ],
    },
    angles: [
      { id: "angle-a", name: "A", assetId: "video", offset: 0 },
      { id: "angle-b", name: "B", assetId: "video", offset: T },
    ],
    switches: [
      { time: 0, angleId: "angle-a" },
      { time: 15 * T, angleId: "angle-b" },
    ],
    audioAngleId: "angle-a",
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    audio: defaultAudioMix(),
  });
  const original = structuredClone(sequence),
    view = projectLegacyView(doc);
  assert.ok(view.restrictions.some((item) => item.clipId === "same" && item.excluded));
  assert.ok(view.restrictions.some((item) => item.clipId === "multicam" && item.excluded));
  assert.equal(
    view.project.clips.some((clip) => clip.id === "same" || clip.id === "multicam"),
    false,
  );
  const after = structuredClone(view.project);
  after.assets[0]!.name = "素材名称修改";
  after.script = "新增口播文稿";
  const result = change(doc, after).document;
  assert.deepEqual(result.sequences[0], original);
  assert.equal(media(result).start, 1);
  assert.deepEqual(result.sequences[0]!.frameRate, { numerator: 24, denominator: 1 });
});

test("legacy primary audio interleaving and independent audio map to distinct preserved tracks", () => {
  const old = legacy();
  old.clips[1] = { ...old.clips[1]!, assetId: "voice", inFrame: 60, outFrame: 150 };
  old.captions = [];
  const doc = migrateLegacyProject(old),
    view = projectLegacyView(doc);
  assert.equal(view.tracks.primaryAudioTrackId, "track-audio-main");
  assert.equal(
    view.clips.find((item) => item.collection === "clips" && item.legacyId === "second")!.trackId,
    "track-audio-main",
  );
  assert.equal(
    view.clips.find((item) => item.collection === "audioClips")!.trackId,
    "track-audio-1",
  );
  const after = structuredClone(view.project);
  after.clips[1]!.volume = 0.25;
  const result = change(doc, after).document;
  assert.equal(media(result, "second").trackId, "track-audio-main");
  assert.equal(media(result, "second").audio.volume, 0.25);
  assert.equal(media(result, "same-migrated-1").audio.volume, 0.5);
});

test("removing optional legacy metadata keeps opaque v2 metadata and source identity", () => {
  const doc = document();
  doc.assets[0]!.metadata!.custom = { retain: true };
  const after = structuredClone(projectLegacyView(doc).project);
  delete after.assets[0]!.proxyId;
  const result = change(doc, after).document;
  assert.equal(result.assets[0]!.metadata!.proxyId, undefined);
  assert.deepEqual(result.assets[0]!.metadata!.custom, { retain: true });
  assert.equal(result.assets[0]!.resourceId, doc.assets[0]!.resourceId);
  delete after.assets[0]!.mediaId;
  assert.throws(() => change(doc, after), /原始尺寸或资源引用/);
});

test("new primary audio placement remains in the primary collection after the view is reopened", () => {
  const doc = document(),
    view = projectLegacyView(doc);
  const after = applyOperations(
    structuredClone(view.project),
    [{ type: "add", assetId: "voice", inFrame: 0, outFrame: 30 }],
    doc.revision,
  );
  const result = change(doc, after).document,
    reopened = projectLegacyView(result);
  assert.equal(reopened.project.clips.at(-1)!.assetId, "voice");
  assert.equal(reopened.project.clips.at(-1)!.id, after.clips.at(-1)!.id);
  assert.equal(reopened.project.audioClips!.length, after.audioClips!.length);
  assert.equal(reopened.timelineComplete, true);
});

import installed0516 from "./fixtures/video-studio/project-0.5.16.json";

test("rich 0.5.16 projects open in the old production view without dropping their unrepresentable audio tail or overlays", () => {
  const doc = migrateLegacyProject(installed0516),
    before = structuredClone(doc);
  const view = projectLegacyView(doc);
  assert.equal(view.renderSafe, false);
  assert.equal(view.timelineComplete, false);
  assert.deepEqual(
    view.project.clips.map((clip) => clip.id),
    ["main-a", "main-b"],
  );
  assert.ok(
    view.restrictions.some(
      (item) => item.clipId === "tail" && item.code === "independent-audio-range" && item.excluded,
    ),
  );
  assert.ok(
    view.restrictions.some(
      (item) => item.clipId === "tail-caption" && item.code === "caption-range" && item.excluded,
    ),
  );
  assert.ok(
    view.restrictions.some(
      (item) => item.clipId === "overlay-a" && item.code === "additional-track" && item.excluded,
    ),
  );
  const after = { ...structuredClone(view.project), name: "旧制作面板改名" };
  const operations = applyLegacyProjectChange(doc, view, view.project, after, doc.revision);
  const changed = applyEditorOperations(doc, operations, doc.revision);
  assert.equal(changed.name, after.name);
  assert.deepEqual(changed.sequences, before.sequences);
  assert.deepEqual(changed.assets, before.assets);
  assert.deepEqual(doc, before);
});
