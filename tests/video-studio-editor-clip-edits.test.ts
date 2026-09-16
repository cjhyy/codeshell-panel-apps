import assert from "node:assert/strict";
import test from "node:test";
import {
  duplicateClipsInPlace,
  planCutClips,
} from "../apps/video-studio/src/editor/clipboard-edits";
import {
  ClipboardDependencyError,
  copyClips,
  duplicateSelectedClips,
  freezeClip,
  groupClips,
  pasteClips,
  reverseClip,
  setClipSpeed,
  setClipSpeedCurve,
  splitClip,
  trimClip,
  ungroupClips,
  type ClipIdFactory,
} from "../apps/video-studio/src/editor/clip-edits";
import { evaluateAnimatedNumber } from "../apps/video-studio/src/editor/animation";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { prepareEvaluator } from "../apps/video-studio/src/editor/evaluate";
import {
  applyEditorOperations,
  type EditorOperation,
} from "../apps/video-studio/src/editor/operations";
import { frameToTicks, sourceTimeAt, TICKS_PER_SECOND } from "../apps/video-studio/src/editor/time";
import type {
  EditorClip,
  EditorDocument,
  EditorSequence,
  MediaClip,
  MulticamClip,
  TextClip,
} from "../apps/video-studio/src/editor/types";
import { validateEditorDocument } from "../apps/video-studio/src/editor/validation";

const sec = (value: number) => value * TICKS_PER_SECOND;
const main = "main";
const ntsc = { numerator: 30000, denominator: 1001 };
function sequence(id = main): EditorSequence {
  return {
    id,
    name: id,
    width: 1920,
    height: 1080,
    frameRate: ntsc,
    background: "#000000",
    timelineMode: "free",
    tracks: [
      createTrack("v1", "video"),
      createTrack("v2", "video"),
      createTrack("v3", "video"),
      createTrack("a1", "audio"),
      createTrack("a2", "audio"),
      createTrack("t1", "text"),
    ],
    clips: [],
    transitions: [],
    markers: [],
  };
}
function picture(id = "owner", start = sec(2), duration = sec(4), trackId = "v1"): MediaClip {
  return {
    id,
    kind: "media",
    label: id,
    start,
    duration,
    trackId,
    assetId: "video",
    timeMap: {
      points: [
        { time: 0, source: sec(1) },
        { time: duration, source: sec(1) + duration },
      ],
    },
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    audio: defaultAudioMix(),
  };
}
function caption(owner: MediaClip, id = "caption"): TextClip {
  return {
    id,
    kind: "text",
    label: id,
    role: "subtitle",
    trackId: "t1",
    start: owner.start,
    duration: owner.duration,
    text: "one two three four",
    words: ["one", "two", "three", "four"].map((text, index) => ({
      text,
      start: (index * owner.duration) / 4,
      end: ((index + 1) * owner.duration) / 4,
    })),
    style: defaultTextStyle(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    sourceBinding: {
      clipId: owner.id,
      sourceStart: owner.timeMap.points[0]!.source,
      sourceEnd: owner.timeMap.points.at(-1)!.source,
    },
  };
}
function document(clips: EditorClip[] = [picture()]): EditorDocument {
  const first = sequence();
  first.clips = clips;
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: TICKS_PER_SECOND,
    id: "project",
    name: "编辑测试",
    revision: 7,
    assets: [
      {
        id: "video",
        name: "画面",
        kind: "video",
        duration: sec(60),
        width: 1920,
        height: 1080,
        resourceId: "resource-video",
      },
      { id: "audio", name: "配音", kind: "audio", duration: sec(60), resourceId: "resource-audio" },
    ],
    sequences: [first],
    activeSequenceId: main,
    exportProfiles: [],
  });
}
function ids(prefix = "new"): ClipIdFactory {
  let index = 0;
  return (kind) => `${prefix}-${kind}-${++index}`;
}
function apply(value: EditorDocument, operations: EditorOperation[]): EditorDocument {
  return applyEditorOperations(value, operations, value.revision);
}
function clip<T extends EditorClip = MediaClip>(value: EditorDocument, id = "owner"): T {
  return value.sequences[0]!.clips.find((clip) => clip.id === id) as T;
}
function near(actual: number, expected: number, error = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= error,
    `${actual} differs from ${expected} by ${Math.abs(actual - expected)}`,
  );
}

test("in-place duplicate retains exact time, track mix, caption binding and sidechain routing on new parallel tracks", () => {
  const source = picture(),
    text = caption(source),
    voice = picture("voice", sec(2), sec(4), "a1");
  voice.assetId = "audio";
  voice.linkGroupId = source.linkGroupId = "linked";
  source.audio.ducking = {
    sidechainTrackIds: ["a1", "a2"],
    thresholdDb: -30,
    attenuationDb: 12,
    attack: sec(0.1),
    release: sec(0.3),
  };
  const original = document([source, voice, text]);
  original.sequences[0]!.tracks[0]!.volume = 0.6;
  original.sequences[0]!.tracks[0]!.pan = -0.3;
  let serial = 0;
  const operations = duplicateClipsInPlace(original, main, [source.id], {
      idFactory: (kind) => `dup-${kind}-${++serial}`,
    }),
    after = apply(original, operations),
    seq = after.sequences[0]!,
    copied = seq.clips.filter((item) => item.id.startsWith("dup-"));
  assert.equal(copied.length, 3);
  const video = copied.find(
      (item): item is MediaClip => item.kind === "media" && item.assetId === "video",
    )!,
    sound = copied.find(
      (item): item is MediaClip => item.kind === "media" && item.assetId === "audio",
    )!,
    subtitle = copied.find((item): item is TextClip => item.kind === "text")!;
  assert.equal(video.start, source.start);
  assert.deepEqual(video.timeMap, source.timeMap);
  assert.notEqual(video.trackId, source.trackId);
  assert.equal(seq.tracks.find((track) => track.id === video.trackId)!.volume, 0.6);
  assert.equal(seq.tracks.find((track) => track.id === video.trackId)!.pan, -0.3);
  assert.deepEqual(video.audio.ducking!.sidechainTrackIds, [sound.trackId, "a2"]);
  assert.equal(subtitle.sourceBinding!.clipId, video.id);
  assert.equal(video.linkGroupId, sound.linkGroupId);
  original.sequences[0]!.tracks[0]!.locked = true;
  assert.throws(
    () =>
      duplicateClipsInPlace(original, main, [source.id], { idFactory: (kind) => `locked-${kind}` }),
    /锁定/,
  );
});

test("free cut rejects subtitle-only graph expansion and cuts complete linked sources and captions atomically", () => {
  const source = picture(),
    text = caption(source),
    voice = picture("voice", sec(2), sec(4), "a1");
  voice.assetId = "audio";
  source.linkGroupId = voice.linkGroupId = "link";
  const original = document([source, voice, text]),
    before = structuredClone(original);
  assert.throws(() => planCutClips(original, main, [text.id]), /同时选择来源/);
  assert.deepEqual(original, before);
  const cut = planCutClips(original, main, [source.id]);
  assert.equal(cut.payload.document.sequences[0]!.clips.length, 3);
  assert.equal(apply(original, cut.operations).sequences[0]!.clips.length, 0);
});

test("NTSC split uses an exact interior tick, preserves both halves and does not ripple following clips", () => {
  const source = picture("owner", frameToTicks(13, ntsc), frameToTicks(103, ntsc));
  const original = document([source, picture("following", sec(12))]),
    before = structuredClone(original);
  const cut = source.start + frameToTicks(37, ntsc);
  const result = apply(original, splitClip(original, main, source.id, cut, ids()));
  const left = clip(result),
    right = result.sequences[0]!.clips.find((item) => item.id.startsWith("new-")) as MediaClip;
  assert.equal(left.duration, frameToTicks(37, ntsc));
  assert.equal(right.start, cut);
  assert.equal(left.duration + right.duration, source.duration);
  assert.equal(clip(result, "following").start, sec(12));
  for (const tick of [0, 1, frameToTicks(20, ntsc), source.duration - 1]) {
    const part = tick < left.duration ? left : right;
    const local = tick < left.duration ? tick : tick - left.duration;
    assert.equal(sourceTimeAt(part.timeMap, local), sourceTimeAt(source.timeMap, tick));
  }
  assert.equal(
    prepareEvaluator(result)
      .evaluate(main, cut)
      .layers.filter((item) => item.kind === "media").length,
    1,
  );
  assert.equal(result.revision, original.revision + 1);
  assert.deepEqual(original, before);
  for (const boundary of [source.start, source.start + source.duration, -1, 1.5, NaN])
    assert.throws(() => splitClip(original, main, source.id, boundary, ids()));
  assert.throws(() => splitClip(original, main, source.id, cut, () => source.id), /ID/);
});

test("trim preserves keyframe easing, held values, crops, masks, grade recipes and exact audible gain through overlapping fades", () => {
  const source = picture();
  source.audio.fadeIn = sec(3);
  source.audio.fadeOut = sec(3);
  source.audio.volume = {
    keyframes: [
      { time: 0, value: 0.4, easing: "ease-in-out" },
      { time: source.duration, value: 1.6 },
    ],
  };
  source.audio.pan = {
    keyframes: [
      { time: 0, value: -1 },
      { time: source.duration, value: 1 },
    ],
  };
  source.audio.pitchSemitones = 3;
  source.audio.preservePitch = false;
  source.transform.x = {
    keyframes: [
      { time: 0, value: -0.3, easing: "ease-in" },
      { time: source.duration, value: 0.4 },
    ],
  };
  source.transform.rotation = {
    keyframes: [
      { time: 0, value: 10, easing: "hold" },
      { time: sec(2), value: 90 },
    ],
  };
  source.transform.crop = { left: 0.1, top: 0, right: 0.05, bottom: 0 };
  source.mask = {
    kind: "ellipse",
    x: 0.5,
    y: 0.5,
    width: 0.8,
    height: 0.8,
    rotation: 0,
    feather: 0.1,
    inverted: false,
  };
  source.color.curves = [
    {
      channel: "rgb",
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.6 },
        { x: 1, y: 1 },
      ],
    },
  ];
  const original = document([source]),
    start = sec(0.7),
    end = sec(3.6);
  const result = apply(original, trimClip(original, main, source.id, start, end)),
    trimmed = clip(result);
  const before = prepareEvaluator(original),
    after = prepareEvaluator(result);
  assert.equal(trimmed.start, source.start + start);
  assert.equal(trimmed.duration, end - start);
  assert.equal(trimmed.audio.fadeIn, 0);
  assert.equal(trimmed.audio.fadeOut, 0);
  assert.deepEqual(trimmed.mask, source.mask);
  assert.deepEqual(trimmed.color.curves, source.color.curves);
  assert.deepEqual(trimmed.transform.crop, source.transform.crop);
  for (let local = 0; local < trimmed.duration; local += 1739) {
    const time = trimmed.start + local,
      a = before.evaluate(main, time),
      b = after.evaluate(main, time);
    const av = a.layers[0]!,
      bv = b.layers[0]!;
    assert.ok(av.kind === "media" && bv.kind === "media");
    assert.equal(bv.sourceTime, av.sourceTime);
    near(bv.transform.x, av.transform.x);
    near(bv.transform.rotation, av.transform.rotation);
    near(b.audio[0]!.gain, a.audio[0]!.gain, 1.05e-6);
    near(b.audio[0]!.pan, a.audio[0]!.pan);
    assert.equal(b.audio[0]!.pitchSemitones, 3);
    assert.equal(b.audio[0]!.preservePitch, false);
  }
  assert.deepEqual(after.evaluate(main, trimmed.start - 1).layers, []);
  assert.deepEqual(after.evaluate(main, trimmed.start + trimmed.duration).layers, []);
});

test("splits keep fades at original edges with no extra dip at an interior cut", () => {
  const source = picture();
  source.audio.fadeIn = sec(0.5);
  source.audio.fadeOut = sec(0.75);
  const original = document([source]),
    cut = source.start + sec(2);
  const result = apply(original, splitClip(original, main, source.id, cut, ids()));
  const parts = result.sequences[0]!.clips as MediaClip[];
  assert.deepEqual(
    parts.map((part) => [part.audio.fadeIn, part.audio.fadeOut]),
    [
      [sec(0.5), 0],
      [0, sec(0.75)],
    ],
  );
  const before = prepareEvaluator(original),
    after = prepareEvaluator(result);
  for (const time of [
    source.start,
    source.start + 1,
    cut - 1,
    cut,
    cut + 1,
    source.start + source.duration - 1,
  ])
    near(after.evaluate(main, time).audio[0]!.gain, before.evaluate(main, time).audio[0]!.gain);
});

test("reverse maps, turning points and frozen spans survive slicing at tick boundaries", () => {
  const source = picture("owner", 100, 1000);
  source.timeMap = {
    points: [
      { time: 0, source: 8000 },
      { time: 400, source: 4000 },
      { time: 600, source: 4000 },
      { time: 1000, source: 6000 },
    ],
  };
  const original = document([source]);
  for (const cut of [101, 333, 500, 501, 650, 999, 1099]) {
    const result = apply(original, splitClip(original, main, source.id, cut, ids()));
    for (let time = source.start; time < source.start + source.duration; time++) {
      const part = result.sequences[0]!.clips.find(
        (item) => time >= item.start && time < item.start + item.duration,
      ) as MediaClip;
      near(
        sourceTimeAt(part.timeMap, time - part.start),
        sourceTimeAt(source.timeMap, time - source.start),
        1,
      );
    }
  }
  const held = apply(original, trimClip(original, main, source.id, 400, 600));
  assert.deepEqual(clip(held).timeMap.points, [
    { time: 0, source: 4000 },
    { time: 200, source: 4000 },
  ]);
  assert.equal(prepareEvaluator(held).evaluate(main, 550).audio[0]!.gain, 0);
  assert.equal(prepareEvaluator(held).evaluate(main, 550).audio[0]!.playbackRate, 0);
});

test("split and trim move bound subtitles and preserve actual word text, interior whitespace and source intervals", () => {
  const source = picture(),
    text = caption(source);
  text.text = "one  two\nthree four";
  text.style.animation = "word-highlight";
  const original = document([source, text]),
    cut = source.start + sec(2);
  const result = apply(original, splitClip(original, main, source.id, cut, ids()));
  const captions = result.sequences[0]!.clips.filter(
    (item): item is TextClip => item.kind === "text",
  ).sort((a, b) => a.start - b.start);
  assert.deepEqual(
    captions.map((item) => item.text),
    ["one  two", "three four"],
  );
  assert.equal(captions[0]!.sourceBinding!.sourceEnd, sec(3));
  assert.equal(captions[1]!.sourceBinding!.sourceStart, sec(3));
  assert.equal(
    captions[1]!.sourceBinding!.clipId,
    result.sequences[0]!.clips.find((item) => item.kind === "media" && item.id !== source.id)!.id,
  );
  assert.deepEqual(
    captions[1]!.words.map((word) => [word.start, word.end]),
    [
      [0, sec(1)],
      [sec(1), sec(2)],
    ],
  );
  const trimmed = apply(original, trimClip(original, main, source.id, sec(1), sec(3)));
  assert.equal(clip<TextClip>(trimmed, text.id).text, "two\nthree");
  assert.equal(clip<TextClip>(trimmed, text.id).start, source.start + sec(1));
  assert.deepEqual(clip<TextClip>(trimmed, text.id).sourceBinding, {
    clipId: source.id,
    sourceStart: sec(2),
    sourceEnd: sec(4),
  });
});

test("owner trim removes excluded caption instances and refuses locked affected captions atomically", () => {
  const source = picture(),
    first = caption(source, "first"),
    last = caption(source, "last");
  first.duration = sec(1);
  first.words = [];
  first.sourceBinding!.sourceEnd = sec(2);
  last.start = source.start + sec(3);
  last.duration = sec(1);
  last.words = [];
  last.sourceBinding!.sourceStart = sec(4);
  const original = document([source, first, last]);
  const result = apply(original, trimClip(original, main, source.id, sec(2), sec(4)));
  assert.deepEqual(
    result.sequences[0]!.clips.map((item) => item.id),
    [source.id, last.id],
  );
  original.sequences[0]!.tracks.find((track) => track.id === "t1")!.locked = true;
  const before = structuredClone(original);
  assert.throws(() => trimClip(original, main, source.id, sec(2), sec(4)), /锁定/);
  assert.deepEqual(original, before);
});

test("edited or translated word text and typewriter phase require explicit resolution before destructive slicing", () => {
  const source = picture(),
    text = caption(source);
  for (const change of [
    (item: TextClip) => {
      item.text = "manually corrected content";
    },
    (item: TextClip) => {
      item.translation = { original: "一二三四", language: "en", mode: "translated" };
    },
    (item: TextClip) => {
      item.style.animation = "typewriter";
    },
  ]) {
    const edited = structuredClone(text);
    change(edited);
    const original = document([source, edited]),
      before = structuredClone(original);
    assert.throws(
      () => splitClip(original, main, source.id, source.start + sec(2), ids()),
      /校对|译文|打字机/,
    );
    assert.deepEqual(original, before);
  }
});

test("clipboard closure includes group, linked audio and source-bound captions, remapping new IDs without shared objects", () => {
  const source = picture();
  source.groupId = "group";
  source.linkGroupId = "av";
  const overlay = picture("overlay", source.start + sec(1), sec(1), "v2");
  overlay.groupId = "group";
  const audio = picture("voice", source.start, source.duration, "a1");
  audio.assetId = "audio";
  audio.linkGroupId = "av";
  const text = caption(source),
    original = document([source, overlay, audio, text]);
  const payload = copyClips(original, main, [text.id]);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.document.sequences[0]!.clips.length, 4);
  const before = structuredClone(payload);
  const operations = pasteClips(original, main, payload, { at: sec(10), idFactory: ids() });
  const result = apply(original, operations),
    added = result.sequences[0]!.clips.filter((item) => item.id.startsWith("new-"));
  assert.equal(added.length, 4);
  const owner = added.find((item) => item.label === source.label)!;
  const clonedText = added.find((item): item is TextClip => item.kind === "text")!;
  assert.equal(clonedText.sourceBinding!.clipId, owner.id);
  assert.notEqual(owner.groupId, source.groupId);
  assert.notEqual(owner.linkGroupId, source.linkGroupId);
  assert.equal(added.find((item) => item.label === overlay.label)!.groupId, owner.groupId);
  assert.equal(added.find((item) => item.label === audio.label)!.linkGroupId, owner.linkGroupId);
  assert.deepEqual(
    added.map((item) => [item.trackId, item.start]),
    [
      ["v1", sec(10)],
      ["v2", sec(11)],
      ["a1", sec(10)],
      ["t1", sec(10)],
    ],
  );
  assert.deepEqual(payload, before);
  payload.document.sequences[0]!.clips[0]!.transform.x = 9;
  clonedText.words[0]!.text = "mutated";
  assert.equal(source.transform.x, 0);
  assert.equal(clip(original).transform.x, 0);
  assert.equal(text.words[0]!.text, "one");
  assert.equal(
    (
      operations.find(
        (operation) => operation.type === "clip.add" && operation.clip.kind === "text",
      ) as Extract<EditorOperation, { type: "clip.add" }>
    ).clip.kind,
    "text",
  );
});

test("paste offsets multiple video tracks and duplicate appends without ripple; track locks and collisions fail before applying", () => {
  const a = picture("a", sec(1), sec(2)),
    b = picture("b", sec(2), sec(1), "v2");
  const original = document([a, b]),
    copied = copyClips(original, main, ["a", "b"]);
  const pasted = apply(
    original,
    pasteClips(original, main, copied, { at: sec(8), trackId: "v2", idFactory: ids() }),
  );
  assert.deepEqual(
    pasted.sequences[0]!.clips.slice(2).map((item) => [item.trackId, item.start]),
    [
      ["v2", sec(8)],
      ["v3", sec(9)],
    ],
  );
  const duplicated = apply(
    original,
    duplicateSelectedClips(original, main, ["a", "b"], { idFactory: ids() }),
  );
  assert.deepEqual(
    duplicated.sequences[0]!.clips.slice(2).map((item) => item.start),
    [sec(3), sec(4)],
  );
  assert.throws(
    () => pasteClips(original, main, copied, { at: sec(1), idFactory: ids() }),
    /重叠|转场/,
  );
  assert.throws(
    () => pasteClips(original, main, copied, { at: sec(8), trackId: "v3", idFactory: ids() }),
    /轨道/,
  );
  original.sequences[0]!.tracks[1]!.locked = true;
  assert.throws(
    () => pasteClips(original, main, copied, { at: sec(8), trackId: "v2", idFactory: ids() }),
    /锁定/,
  );
});

test("cross-project clipboard requires imported assets, remaps compatible asset IDs, and strictly rejects malformed payloads", () => {
  const original = document(),
    payload = copyClips(original, main, ["owner"]),
    destination = document([]);
  destination.id = "other-project";
  destination.assets = [];
  assert.throws(
    () => pasteClips(destination, main, payload, { at: 0, idFactory: ids() }),
    (error: unknown) => {
      assert.ok(error instanceof ClipboardDependencyError);
      assert.deepEqual(error.assetIds, ["video"]);
      assert.deepEqual(error.sequenceIds, []);
      assert.equal(error.code, "CLIPBOARD_DEPENDENCIES_MISSING");
      return true;
    },
  );
  destination.assets = [{ ...original.assets[0]!, id: "imported" }];
  const result = apply(
    destination,
    pasteClips(destination, main, payload, { at: 0, idFactory: ids() }),
  );
  assert.equal((result.sequences[0]!.clips[0] as MediaClip).assetId, "imported");
  let getterRead = false;
  for (const malformed of [
    { ...payload, extra: 1 },
    { ...payload, schemaVersion: 2 },
    { ...payload, origin: 99 },
    Object.assign(Object.create({ bad: true }), payload),
    {
      ...payload,
      get document() {
        getterRead = true;
        return original;
      },
    },
    { ...payload, document: { ...payload.document, unexpected: true } },
    JSON.parse('{"schemaVersion":1,"__proto__":{"polluted":true}}'),
  ])
    assert.throws(() => pasteClips(destination, main, malformed, { at: 0, idFactory: ids() }));
  assert.equal(getterRead, false);
  assert.equal(({} as any).polluted, undefined);
});

test("nested clipboard dependencies are detached checks and never overwrite target sequences", () => {
  const original = document([]),
    dependency = sequence("child");
  dependency.clips = [picture("nested-source", 0, sec(2))];
  const { assetId: _asset, ...base } = picture("nested", 0, sec(2));
  base.timeMap.points = [
    { time: 0, source: 0 },
    { time: sec(2), source: sec(2) },
  ];
  original.sequences[0]!.clips = [{ ...base, kind: "sequence", sequenceId: dependency.id }];
  original.sequences.push(dependency);
  const payload = copyClips(original, main, ["nested"]),
    target = document([]);
  target.id = "target";
  assert.throws(
    () => pasteClips(target, main, payload, { at: 0, idFactory: ids() }),
    (error: unknown) => {
      assert.ok(error instanceof ClipboardDependencyError);
      assert.deepEqual(error.sequenceIds, ["child"]);
      return true;
    },
  );
  target.sequences.push(structuredClone(dependency));
  const result = apply(target, pasteClips(target, main, payload, { at: 0, idFactory: ids() }));
  assert.equal(result.sequences.length, 2);
  assert.deepEqual(result.sequences[1], dependency);
  target.sequences[1]!.name = "edited target sequence";
  assert.throws(
    () => pasteClips(target, main, payload, { at: sec(3), idFactory: ids() }),
    ClipboardDependencyError,
  );
});

test("transition pairs copy as one valid graph and timing edits reject existing transitions clearly", () => {
  const a = picture("a", 0, sec(2)),
    b = picture("b", sec(1), sec(2)),
    original = document([]);
  original.sequences[0]!.clips = [a, b];
  original.sequences[0]!.transitions = [
    {
      id: "transition",
      fromClipId: "a",
      toClipId: "b",
      start: sec(1),
      duration: sec(1),
      kind: "dissolve",
    },
  ];
  assert.throws(() => copyClips(original, main, ["a"]), /两端/);
  const result = apply(
    original,
    pasteClips(original, main, copyClips(original, main, ["a", "b"]), {
      at: sec(5),
      idFactory: ids(),
    }),
  );
  const transition = result.sequences[0]!.transitions[1]!;
  assert.equal(transition.start, sec(6));
  assert.notEqual(transition.fromClipId, "a");
  assert.notEqual(transition.toClipId, "b");
  for (const operation of [
    () => splitClip(original, main, "a", sec(1), ids()),
    () => trimClip(original, main, "a", 0, sec(1)),
    () => setClipSpeed(original, main, "a", 2),
    () => reverseClip(original, main, "a"),
    () => freezeClip(original, main, "a", 0, sec(1)),
  ])
    assert.throws(operation, /转场/);
});

test("grouping expands source/link selection, ungroup removes whole selected groups while retaining links", () => {
  const source = picture(),
    linked = picture("linked", source.start, source.duration, "a1");
  source.linkGroupId = "av";
  linked.linkGroupId = "av";
  linked.assetId = "audio";
  const original = document([source, linked, caption(source)]);
  const grouped = apply(original, groupClips(original, main, ["owner"], "group"));
  assert.deepEqual(
    grouped.sequences[0]!.clips.map((item) => item.groupId),
    ["group", "group", "group"],
  );
  const ungrouped = apply(grouped, ungroupClips(grouped, main, ["caption"]));
  assert.deepEqual(
    ungrouped.sequences[0]!.clips.map((item) => item.groupId),
    [undefined, undefined, undefined],
  );
  assert.equal(clip(ungrouped).linkGroupId, "av");
  assert.deepEqual(ungroupClips(ungrouped, main, ["owner"]), []);
  original.sequences[0]!.tracks.find((track) => track.id === "a1")!.locked = true;
  assert.throws(() => groupClips(original, main, ["owner"], "group"), /锁定/);
});

test("constant speed retains source endpoints, retimes keyframes, fades and bound words, and leaves later clips still", () => {
  const source = picture(),
    text = caption(source);
  source.transform.scaleX = {
    keyframes: [
      { time: 0, value: 1 },
      { time: sec(2), value: 2, easing: "ease-in" },
      { time: sec(4), value: 1 },
    ],
  };
  source.audio.fadeIn = sec(1);
  source.audio.fadeOut = sec(1);
  source.audio.pitchSemitones = -2;
  const original = document([source, text, picture("later", sec(8))]);
  const result = apply(original, setClipSpeed(original, main, "owner", 2)),
    after = clip(result),
    words = clip<TextClip>(result, "caption");
  assert.equal(after.duration, sec(2));
  assert.equal(after.start, source.start);
  assert.deepEqual(after.timeMap.points, [
    { time: 0, source: sec(1) },
    { time: sec(2), source: sec(5) },
  ]);
  assert.deepEqual(
    typeof after.transform.scaleX === "number"
      ? []
      : after.transform.scaleX.keyframes.map((key) => key.time),
    [0, sec(1), sec(2)],
  );
  assert.equal(after.audio.fadeIn, sec(0.5));
  assert.equal(after.audio.fadeOut, sec(0.5));
  assert.equal(after.audio.pitchSemitones, -2);
  assert.equal(words.text, text.text);
  assert.equal(words.start, text.start);
  assert.equal(words.duration, sec(2));
  assert.deepEqual(
    words.words.map((word) => [word.start, word.end]),
    [
      [0, sec(0.5)],
      [sec(0.5), sec(1)],
      [sec(1), sec(1.5)],
      [sec(1.5), sec(2)],
    ],
  );
  assert.equal(clip(result, "later").start, sec(8));
  assert.throws(() => setClipSpeed(original, main, "owner", 0.5), /转场|重叠/);
  for (const invalid of [0, -1, Infinity, NaN, 101])
    assert.throws(() => setClipSpeed(original, main, "owner", invalid), /速度/);
});

test("reverse and freeze retain source content recipes; freeze is silent and bound captions refuse ambiguous word order", () => {
  const source = picture();
  source.timeMap.points = [
    { time: 0, source: sec(1) },
    { time: sec(1), source: sec(1.5) },
    { time: sec(4), source: sec(5) },
  ];
  source.audio.volume = {
    keyframes: [
      { time: 0, value: 0.5 },
      { time: sec(4), value: 1 },
    ],
  };
  const original = document([source]),
    reversed = apply(original, reverseClip(original, main, "owner")),
    reverse = clip(reversed);
  assert.deepEqual(reverse.timeMap.points, [
    { time: 0, source: sec(5) },
    { time: sec(3), source: sec(1.5) },
    { time: sec(4), source: sec(1) },
  ]);
  assert.deepEqual(reverse.audio, source.audio);
  assert.equal(
    prepareEvaluator(reversed).evaluate(main, source.start + sec(1)).audio[0]!.playbackRate,
    -7 / 6,
  );
  const restored = apply(reversed, reverseClip(reversed, main, "owner"));
  assert.deepEqual(clip(restored).timeMap, source.timeMap);
  const held = apply(original, freezeClip(original, main, "owner", source.start + sec(1), sec(3))),
    frozen = clip(held);
  assert.equal(frozen.duration, sec(3));
  assert.deepEqual(frozen.timeMap.points, [
    { time: 0, source: sec(1.5) },
    { time: sec(3), source: sec(1.5) },
  ]);
  assert.equal(prepareEvaluator(held).evaluate(main, source.start + sec(2)).audio[0]!.gain, 0);
  assert.equal(
    prepareEvaluator(held).evaluate(main, source.start + sec(2)).audio[0]!.playbackRate,
    0,
  );
  assert.throws(() => setClipSpeed(held, main, "owner", 2), /定格/);
  assert.throws(
    () => freezeClip(original, main, "owner", source.start + source.duration, sec(1)),
    /内部/,
  );
  const bound = document([source, caption(source)]);
  assert.throws(() => reverseClip(bound, main, "owner"), /解除字幕绑定/);
  assert.throws(() => freezeClip(bound, main, "owner", source.start, sec(1)), /解除字幕绑定/);
});

test("multicam split keeps the active angle, reversal reverses switches, and freeze stays on the chosen camera", () => {
  const { assetId: _asset, ...base } = picture(),
    multi: MulticamClip = {
      ...base,
      kind: "multicam",
      angles: [
        { id: "a", name: "A", assetId: "video", offset: 0 },
        { id: "b", name: "B", assetId: "video", offset: sec(1) },
      ],
      audioAngleId: "a",
      switches: [
        { time: 0, angleId: "a" },
        { time: sec(1), angleId: "b" },
        { time: sec(3), angleId: "a" },
      ],
    };
  const original = document([multi]);
  const split = apply(original, splitClip(original, main, "owner", multi.start + sec(2), ids()));
  assert.deepEqual((split.sequences[0]!.clips[1] as MulticamClip).switches, [
    { time: 0, angleId: "b" },
    { time: sec(1), angleId: "a" },
  ]);
  const held = apply(original, freezeClip(original, main, "owner", multi.start + sec(2), sec(2)));
  assert.deepEqual(clip<MulticamClip>(held).switches, [{ time: 0, angleId: "b" }]);
  const oneTick = apply(original, freezeClip(original, main, "owner", multi.start + sec(2), 1));
  assert.deepEqual(clip<MulticamClip>(oneTick).switches, [{ time: 0, angleId: "b" }]);
  assert.equal(clip<MulticamClip>(oneTick).duration, 1);
  const reversed = apply(original, reverseClip(original, main, "owner"));
  assert.deepEqual(clip<MulticamClip>(reversed).switches, [
    { time: 0, angleId: "a" },
    { time: sec(1), angleId: "b" },
    { time: sec(3), angleId: "a" },
  ]);
});

test("curve speed integrates source-space ramps and bounds source interpolation error including rounded ticks", () => {
  const source = picture(),
    original = document([source]);
  const result = apply(
      original,
      setClipSpeedCurve(original, main, "owner", [
        { position: 0, speed: 0.5 },
        { position: 1, speed: 4 },
      ]),
    ),
    after = clip(result);
  const span = sec(4),
    expectedDuration = Math.round((span * Math.log(8)) / 3.5);
  assert.equal(after.duration, expectedDuration);
  assert.ok(after.timeMap.points.length > 10);
  assert.equal(after.timeMap.points[0]!.source, sec(1));
  assert.equal(after.timeMap.points.at(-1)!.source, sec(5));
  for (let time = 0; time < after.duration; time += 331) {
    const exact = sec(1) + (span * 0.5 * Math.expm1((time * 3.5) / span)) / 3.5;
    near(sourceTimeAt(after.timeMap, time), exact, frameToTicks(1, ntsc) / 100 + 3);
  }
  const backward = apply(original, reverseClip(original, main, "owner"));
  const curvedBack = apply(
    backward,
    setClipSpeedCurve(backward, main, "owner", [
      { position: 0, speed: 0.5 },
      { position: 1, speed: 4 },
    ]),
  );
  assert.equal(clip(curvedBack).timeMap.points[0]!.source, sec(5));
  assert.equal(clip(curvedBack).timeMap.points.at(-1)!.source, sec(1));
});

test("curve speed repositions bound words from their actual source times and rejects dense keys instead of dropping them", () => {
  const source = picture(),
    text = caption(source),
    original = document([source, text]);
  const result = apply(
    original,
    setClipSpeedCurve(original, main, "owner", [
      { position: 0, speed: 1 },
      { position: 1, speed: 3 },
    ]),
  );
  const after = clip(result),
    afterText = clip<TextClip>(result, "caption");
  assert.equal(afterText.duration, after.duration);
  assert.equal(afterText.text, text.text);
  for (let index = 0; index < 4; index++) {
    const word = afterText.words[index]!;
    near(sourceTimeAt(after.timeMap, word.start), sec(1 + index), 3);
    near(sourceTimeAt(after.timeMap, word.end), sec(2 + index), 3);
  }
  const dense = picture("dense", 0, 100);
  dense.transform.x = {
    keyframes: [
      { time: 0, value: 0 },
      { time: 1, value: 1 },
      { time: 100, value: 0 },
    ],
  };
  assert.throws(() => setClipSpeed(document([dense]), main, "dense", 100), /关键帧/);
  let read = false;
  const unsafe = [
    { position: 0, speed: 1 },
    {
      get position() {
        read = true;
        return 1;
      },
      speed: 2,
    },
  ];
  assert.throws(() => setClipSpeedCurve(original, main, "owner", unsafe));
  assert.equal(read, false);
  const hole = new Array(2);
  hole[0] = { position: 0, speed: 1 };
  for (const curve of [
    hole,
    [
      { position: 0.1, speed: 1 },
      { position: 1, speed: 2 },
    ],
    [
      { position: 0, speed: 1 },
      { position: 1, speed: 0 },
    ],
    [
      { position: 0, speed: 1 },
      { position: 0, speed: 2 },
      { position: 1, speed: 3 },
    ],
  ])
    assert.throws(() => setClipSpeedCurve(original, main, "owner", curve));
});

test("property bounds are preserved when trimming overshooting cubic animation", () => {
  const source = picture("owner", 0, 1000);
  source.transform.opacity = {
    keyframes: [
      { time: 0, value: 0, easing: { type: "cubic-bezier", x1: 0.1, y1: 3, x2: 0.8, y2: -2 } },
      { time: 1000, value: 1 },
    ],
  };
  const original = document([source]),
    trimmed = apply(original, trimClip(original, main, "owner", 123, 876));
  for (let time = 123; time < 876; time++) {
    const expected = Math.max(
      0,
      Math.min(1, evaluateAnimatedNumber(source.transform.opacity, time)),
    );
    near(evaluateAnimatedNumber(clip(trimmed).transform.opacity, time - 123), expected, 1.05e-6);
  }
});
