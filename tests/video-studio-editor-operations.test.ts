import assert from "node:assert/strict";
import test from "node:test";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { createExportPresets } from "../apps/video-studio/src/editor/export-settings";
import {
  applyEditorOperations,
  prepareEditorOperationPreview,
  type EditorOperation,
} from "../apps/video-studio/src/editor/operations";
import { TICKS_PER_SECOND } from "../apps/video-studio/src/editor/time";
import type {
  EditorDocument,
  EditorSequence,
  MediaClip,
  SequenceClip,
  TextClip,
} from "../apps/video-studio/src/editor/types";
import { validateEditorDocument } from "../apps/video-studio/src/editor/validation";

const seconds = (value: number) => value * TICKS_PER_SECOND;

test("asset import/reconnection and sequence settings use the same atomic revision", () => {
  const original = document();
  const before = structuredClone(original);
  const newClip = picture("new");
  newClip.assetId = "imported";
  const changed = applyEditorOperations(
    original,
    [
      {
        type: "asset.add",
        asset: {
          id: "imported",
          name: "Imported",
          kind: "video",
          duration: seconds(3),
          width: 1280,
          height: 720,
        },
      },
      { type: "asset.update", assetId: "imported", patch: { resourceId: "resource-1" } },
      { type: "clip.add", sequenceId: main, clip: newClip },
      {
        type: "sequence.update",
        sequenceId: main,
        patch: { width: 1080, height: 1920, frameRate: { numerator: 30000, denominator: 1001 } },
      },
      { type: "project.production", data: { script: "保留制作注释" } },
    ],
    original.revision,
  );
  assert.equal(changed.revision, original.revision + 1);
  assert.equal(changed.assets.find((asset) => asset.id === "imported")?.resourceId, "resource-1");
  assert.deepEqual(
    changed.sequences[0]!.clips.find((clip) => clip.id === "new"),
    newClip,
  );
  assert.deepEqual(original, before);
  assert.throws(() =>
    applyEditorOperations(
      changed,
      [{ type: "asset.remove", assetId: "imported" }],
      changed.revision,
    ),
  );
  const removed = applyEditorOperations(
    changed,
    [
      { type: "asset.remove", assetId: "imported" },
      { type: "clip.remove", sequenceId: main, clipIds: ["new"] },
      { type: "project.production", data: null },
    ],
    changed.revision,
  );
  assert.equal(
    removed.assets.some((asset) => asset.id === "imported"),
    false,
  );
  assert.equal(removed.production, undefined);
});
const main = "sequence-main";
test("operation results and caller patches remain detached after validation's graph copy", () => {
  const original = document();
  original.sequences[0]!.clips.push(picture("detached"));
  const before = structuredClone(original),
    color = defaultColorAdjustment();
  const operations: EditorOperation[] = [{
    type: "clip.update",
    sequenceId: main,
    clipId: "detached",
    patch: { color },
  }];
  const after = applyEditorOperations(original, operations, original.revision);
  color.curves.push({ channel: "rgb", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
  const result = after.sequences[0]!.clips[0] as MediaClip;
  result.transform.crop.left = 0.1;
  result.timeMap.points[0]!.source = 100;
  result.color.hsl.push({ hue: 0, width: 10, hueShift: 0, saturation: 1, lightness: 0 });
  assert.deepEqual(original, before);
  assert.equal(result.color.curves.length, 0, "Mutating a caller patch cannot alter the committed graph");
});
function sequence(id = main): EditorSequence {
  return {
    id,
    name: id,
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30, denominator: 1 },
    background: "#000000",
    timelineMode: "free",
    tracks: [
      createTrack("v1", "video"),
      createTrack("v2", "video"),
      createTrack("v3", "video"),
      createTrack("v4", "video"),
      createTrack("audio", "audio"),
      createTrack("text", "text"),
    ],
    clips: [],
    transitions: [],
    markers: [],
  };
}
function picture(id: string, trackId = "v1", start = 0, duration = seconds(1)): MediaClip {
  return {
    id,
    kind: "media",
    label: id,
    trackId,
    start,
    duration,
    assetId: "source-video",
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: duration, source: duration },
      ],
    },
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    audio: defaultAudioMix(),
  };
}
function caption(id: string, owner?: string): TextClip {
  return {
    id,
    kind: "text",
    role: "subtitle",
    text: id,
    label: id,
    trackId: "text",
    start: 0,
    duration: seconds(1),
    words: [],
    style: defaultTextStyle(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    ...(owner ? { sourceBinding: { clipId: owner, sourceStart: 0, sourceEnd: seconds(1) } } : {}),
  };
}
function nested(id: string, source: string): SequenceClip {
  const { assetId: _assetId, ...base } = picture(id, "v2");
  return { ...base, kind: "sequence", sequenceId: source };
}
function document(): EditorDocument {
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: TICKS_PER_SECOND,
    id: "test-project",
    name: "剪辑工程",
    revision: 4,
    assets: [
      {
        id: "source-video",
        name: "原片",
        kind: "video",
        duration: seconds(20),
        width: 1920,
        height: 1080,
      },
      { id: "source-audio", name: "配音", kind: "audio", duration: seconds(20) },
    ],
    sequences: [sequence()],
    activeSequenceId: main,
    exportProfiles: createExportPresets(),
  });
}
function apply(value: EditorDocument, operations: readonly EditorOperation[]) {
  return applyEditorOperations(value, operations, value.revision);
}

test("grouped multi-track movement preserves relative time and track offsets across every selected group", () => {
  const original = document();
  original.sequences[0]!.clips = [
    { ...picture("a", "v1", seconds(1)), groupId: "group" },
    { ...picture("b", "v2", seconds(3)), groupId: "group" },
    { ...picture("independent", "v1", seconds(7)), linkGroupId: "group" },
  ];
  const second = sequence("another-sequence");
  second.clips = [{ ...picture("separate", "v1", 0), groupId: "group" }];
  original.sequences.push(second);
  const before = structuredClone(original);
  const result = apply(original, [
    { type: "clip.move", sequenceId: main, clipIds: ["a"], delta: seconds(2), trackId: "v2" },
  ]);
  assert.deepEqual(
    result.sequences[0]!.clips.map((item) => [item.id, item.trackId, item.start]),
    [
      ["a", "v2", seconds(3)],
      ["b", "v3", seconds(5)],
      ["independent", "v1", seconds(7)],
    ],
  );
  assert.equal(result.sequences[1]!.clips[0]!.start, 0);
  assert.equal(result.revision, original.revision + 1);
  assert.deepEqual(original, before, "A move must leave the caller's undo snapshot intact");
  assert.throws(() =>
    apply(original, [{ type: "clip.move", sequenceId: main, clipIds: ["a"], delta: -seconds(2) }]),
  );
  assert.throws(() =>
    apply(original, [
      { type: "clip.move", sequenceId: main, clipIds: ["a"], delta: 0, trackId: "text" },
    ]),
  );
});

test("source movement carries linked clips and bound subtitles with separate namespaces and stable subtitle tracks", () => {
  const original = document();
  original.sequences[0]!.clips = [
    { ...picture("owner"), linkGroupId: "link", groupId: "group" },
    { ...picture("linked", "v2"), linkGroupId: "link" },
    { ...picture("unrelated", "v4"), groupId: "link" },
    caption("bound", "owner"),
  ];
  const moved = apply(original, [
    { type: "clip.move", sequenceId: main, clipIds: ["owner"], delta: seconds(1), trackId: "v2" },
  ]);
  assert.deepEqual(
    moved.sequences[0]!.clips.map((item) => [item.id, item.start, item.trackId]),
    [
      ["owner", seconds(1), "v2"],
      ["linked", seconds(1), "v3"],
      ["unrelated", 0, "v4"],
      ["bound", seconds(1), "text"],
    ],
  );
  original.sequences[0]!.tracks.find((track) => track.id === "text")!.locked = true;
  assert.throws(
    () =>
      apply(original, [
        { type: "clip.move", sequenceId: main, clipIds: ["owner"], delta: seconds(1) },
      ]),
    /锁定/,
  );
});

test("late validation failure rolls back all operations and returned snapshots share no mutable values", () => {
  const original = document(),
    before = structuredClone(original);
  const input = picture("new");
  const operations: EditorOperation[] = [
    { type: "project.rename", name: "已修改" },
    { type: "clip.add", sequenceId: main, clip: input },
    { type: "clip.update", sequenceId: main, clipId: "new", patch: { assetId: "missing" } },
  ];
  const copiedOperations = structuredClone(operations);
  assert.throws(() => apply(original, operations));
  assert.deepEqual(original, before);
  assert.deepEqual(operations, copiedOperations);
  const result = apply(original, operations.slice(0, 2));
  (result.sequences[0]!.clips[0] as MediaClip).timeMap.points[0]!.source = 99;
  result.exportProfiles[0]!.name = "返回值修改";
  assert.equal(input.timeMap.points[0]!.source, 0);
  assert.deepEqual(original, before);
  const empty = apply(original, []);
  assert.equal(empty.revision, original.revision);
  assert.notEqual(empty, original);
  empty.sequences[0]!.tracks[0]!.name = "新名称";
  assert.deepEqual(original, before);
});

test("track locks stop every direct edit route, grouped movement and destructive sequence removal", () => {
  const original = document();
  original.sequences[0]!.clips = [
    { ...picture("locked"), groupId: "both" },
    { ...picture("unlocked", "v2"), groupId: "both" },
  ];
  original.sequences[0]!.tracks[0]!.locked = true;
  const second = sequence("secondary");
  original.sequences.push(second);
  const attempts: EditorOperation[][] = [
    [{ type: "clip.update", sequenceId: main, clipId: "locked", patch: { label: "changed" } }],
    [{ type: "clip.update", sequenceId: main, clipId: "locked", patch: { trackId: "v2" } }],
    [{ type: "clip.move", sequenceId: main, clipIds: ["unlocked"], delta: seconds(1) }],
    [{ type: "clip.remove", sequenceId: main, clipIds: ["locked"] }],
    [{ type: "clip.add", sequenceId: main, clip: picture("added", "v1", seconds(2)) }],
    [{ type: "track.remove", sequenceId: main, trackId: "v1", removeClips: true }],
    [
      {
        type: "track.update",
        sequenceId: main,
        trackId: "v1",
        patch: { locked: false, name: "changed" },
      },
    ],
    [
      { type: "sequence.activate", sequenceId: "secondary" },
      { type: "sequence.remove", sequenceId: main },
    ],
  ];
  const before = structuredClone(original);
  for (const operations of attempts) {
    assert.throws(() => apply(original, operations), /锁定/);
    assert.deepEqual(original, before);
  }
  const unlocked = apply(original, [
    { type: "track.update", sequenceId: main, trackId: "v1", patch: { locked: false } },
    { type: "clip.move", sequenceId: main, clipIds: ["locked"], delta: seconds(1) },
  ]);
  assert.equal(unlocked.sequences[0]!.clips[0]!.start, seconds(1));
  assert.equal(unlocked.sequences[0]!.clips[1]!.start, seconds(1));
  assert.equal(unlocked.revision, original.revision + 1);
});

test("destination locks and locked track ordering cannot be bypassed by other operation forms", () => {
  const original = document();
  original.sequences[0]!.clips = [picture("a")];
  original.sequences[0]!.tracks[1]!.locked = true;
  for (const operation of [
    { type: "clip.move", sequenceId: main, clipIds: ["a"], delta: 0, trackId: "v2" },
    { type: "clip.update", sequenceId: main, clipId: "a", patch: { trackId: "v2" } },
    { type: "clip.add", sequenceId: main, clip: picture("b", "v2") },
    {
      type: "track.reorder",
      sequenceId: main,
      trackIds: ["v3", "v2", "v1", "v4", "audio", "text"],
    },
  ] as EditorOperation[])
    assert.throws(() => apply(original, [operation]), /锁定/);
  assert.doesNotThrow(() =>
    apply(original, [
      {
        type: "track.reorder",
        sequenceId: main,
        trackIds: ["v1", "v2", "v4", "v3", "audio", "text"],
      },
    ]),
  );
});

test("removing owners cascades only their bound subtitles and requires permission to remove populated tracks", () => {
  const original = document();
  original.sequences[0]!.clips = [
    picture("owner"),
    picture("other", "v2"),
    caption("owned", "owner"),
    caption("other-caption", "other"),
    caption("free-caption"),
  ];
  assert.throws(
    () => apply(original, [{ type: "track.remove", sequenceId: main, trackId: "v1" }]),
    /仍有片段/,
  );
  const removed = apply(original, [
    { type: "track.remove", sequenceId: main, trackId: "v1", removeClips: true },
  ]);
  assert.deepEqual(
    removed.sequences[0]!.clips.map((item) => item.id),
    ["other", "other-caption", "free-caption"],
  );
  assert.equal(
    removed.sequences[0]!.tracks.some((item) => item.id === "v1"),
    false,
  );
  assert.deepEqual(
    removed.assets,
    original.assets,
    "Editing a timeline must never remove original media",
  );
  original.sequences[0]!.tracks.find((item) => item.id === "text")!.locked = true;
  assert.throws(
    () => apply(original, [{ type: "clip.remove", sequenceId: main, clipIds: ["owner"] }]),
    /锁定/,
  );
  assert.equal(original.sequences[0]!.clips.length, 5);
});

test("transition creation, grouped movement and endpoint deletion remain a valid edit graph", () => {
  const original = document();
  original.sequences[0]!.clips = [
    { ...picture("from", "v1", 0, seconds(2)), groupId: "pair" },
    { ...picture("to", "v1", seconds(2), seconds(2)), groupId: "pair" },
  ];
  const transitioned = apply(original, [
    { type: "clip.update", sequenceId: main, clipId: "to", patch: { start: seconds(1) } },
    {
      type: "transition.add",
      sequenceId: main,
      transition: {
        id: "join",
        fromClipId: "from",
        toClipId: "to",
        start: seconds(1),
        duration: seconds(1),
        kind: "dissolve",
      },
    },
  ]);
  const moved = apply(transitioned, [
    { type: "clip.move", sequenceId: main, clipIds: ["from"], delta: seconds(2) },
  ]);
  assert.equal(moved.sequences[0]!.transitions[0]!.start, seconds(3));
  const removed = apply(moved, [{ type: "clip.remove", sequenceId: main, clipIds: ["from"] }]);
  assert.deepEqual(removed.sequences[0]!.transitions, []);
  assert.deepEqual(
    removed.sequences[0]!.clips.map((item) => item.id),
    ["to"],
  );
  const cut = apply(transitioned, [
    { type: "transition.remove", sequenceId: main, transitionId: "join" },
    { type: "clip.update", sequenceId: main, clipId: "to", patch: { start: seconds(2) } },
  ]);
  assert.equal(cut.sequences[0]!.transitions.length, 0);
  assert.throws(
    () =>
      apply(transitioned, [{ type: "transition.remove", sequenceId: main, transitionId: "join" }]),
    /转场/,
  );
});

test("sequence removal protects active and nested references while accepting a final repaired graph", () => {
  const original = document(),
    second = sequence("secondary");
  second.clips = [picture("source")];
  original.sequences[0]!.clips = [nested("nested", second.id)];
  original.sequences.push(second);
  const before = structuredClone(original);
  assert.throws(() => apply(original, [{ type: "sequence.remove", sequenceId: main }]), /切换/);
  assert.throws(
    () => apply(original, [{ type: "sequence.remove", sequenceId: second.id }]),
    /不存在/,
  );
  assert.deepEqual(original, before);
  const removed = apply(original, [
    { type: "sequence.remove", sequenceId: second.id },
    { type: "clip.remove", sequenceId: main, clipIds: ["nested"] },
  ]);
  assert.equal(removed.sequences.length, 1);
  assert.equal(removed.activeSequenceId, main);
  assert.deepEqual(removed.assets, original.assets);
  const switched = apply(original, [
    { type: "sequence.rename", sequenceId: second.id, name: "镜头备选" },
    { type: "sequence.activate", sequenceId: second.id },
    { type: "sequence.remove", sequenceId: main },
  ]);
  assert.equal(switched.activeSequenceId, second.id);
  assert.equal(switched.sequences[0]!.name, "镜头备选");
});

test("sequence cycles introduced late in a transaction fail without changing the previous project", () => {
  const original = document();
  original.sequences[0]!.clips = [picture("a")];
  const second = sequence("secondary");
  second.clips = [picture("b")];
  const before = structuredClone(original);
  assert.throws(
    () =>
      apply(original, [
        { type: "sequence.add", sequence: second },
        { type: "clip.add", sequenceId: main, clip: nested("to-second", "secondary") },
        { type: "clip.add", sequenceId: "secondary", clip: nested("to-main", main) },
      ]),
    /循环/,
  );
  assert.deepEqual(original, before);
  assert.equal(second.clips.length, 1);
});

test("track, marker and profile operations compose into one revision and preserve full replacements", () => {
  const original = document();
  const added = createTrack("new-track", "audio", "背景音");
  const profiles = createExportPresets().slice(1);
  const result = apply(original, [
    { type: "track.add", sequenceId: main, track: added, index: 1 },
    {
      type: "track.update",
      sequenceId: main,
      trackId: added.id,
      patch: { name: "配乐", volume: 0.5, muted: true },
    },
    {
      type: "track.reorder",
      sequenceId: main,
      trackIds: ["v1", "v2", "v3", "v4", "new-track", "audio", "text"],
    },
    {
      type: "marker.add",
      sequenceId: main,
      marker: {
        id: "note",
        time: 0,
        duration: 0,
        name: "开场",
        note: "检查声音",
        color: "#ff0000",
      },
    },
    {
      type: "marker.update",
      sequenceId: main,
      markerId: "note",
      patch: { name: "确认开场", time: seconds(1) },
    },
    { type: "project.rename", name: "新工程" },
    { type: "project.exportProfiles", profiles },
  ]);
  assert.equal(result.revision, original.revision + 1);
  assert.equal(result.sequences[0]!.tracks[4]!.name, "配乐");
  assert.equal(result.sequences[0]!.markers[0]!.time, seconds(1));
  assert.equal(result.name, "新工程");
  assert.equal(result.exportProfiles.length, 2);
  assert.equal(added.name, "背景音");
  const cleaned = apply(result, [
    { type: "marker.remove", sequenceId: main, markerId: "note" },
    { type: "track.remove", sequenceId: main, trackId: added.id },
  ]);
  assert.equal(cleaned.sequences[0]!.markers.length, 0);
  assert.equal(cleaned.sequences[0]!.tracks.length, original.sequences[0]!.tracks.length);
  assert.throws(
    () =>
      apply(original, [{ type: "project.exportProfiles", profiles: [profiles[0]!, profiles[0]!] }]),
    /重复/,
  );
});

test("patches preserve identity, reject prototype or unknown-field payloads, and replace nested values", () => {
  const original = document();
  original.sequences[0]!.clips = [{ ...picture("a"), groupId: "group", linkGroupId: "linked" }];
  for (const patch of [
    { id: "renamed" },
    { kind: "shape" },
    { completelyUnknown: true },
    { transform: { scaleX: 2 } },
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ])
    assert.throws(() =>
      apply(original, [
        { type: "clip.update", sequenceId: main, clipId: "a", patch } as EditorOperation,
      ]),
    );
  const updated = apply(original, [
    {
      type: "clip.update",
      sequenceId: main,
      clipId: "a",
      patch: { groupId: null, linkGroupId: null, transform: { ...defaultTransform(), scaleX: 2 } },
    },
  ]);
  assert.equal(updated.sequences[0]!.clips[0]!.groupId, undefined);
  assert.equal(updated.sequences[0]!.clips[0]!.linkGroupId, undefined);
  assert.equal(updated.sequences[0]!.clips[0]!.transform.scaleX, 2);
  assert.equal(original.sequences[0]!.clips[0]!.transform.scaleX, 1);
  assert.equal(({} as any).polluted, undefined);
  const symbolOperation = { type: "project.rename", name: "x", [Symbol("unknown")]: true };
  assert.throws(() => apply(original, [symbolOperation as EditorOperation]));
  let read = false;
  const accessor = {
    get type() {
      read = true;
      return "project.rename";
    },
    name: "x",
  };
  assert.throws(() => apply(original, [accessor as EditorOperation]));
  assert.equal(read, false);
});

test("stale revisions, invalid selections and duplicate identifiers never apply partial edits", () => {
  const original = document();
  original.sequences[0]!.clips = [picture("a")];
  assert.throws(() => applyEditorOperations(original, [], original.revision - 1), /工程已更新/);
  assert.throws(() => applyEditorOperations(original, [], NaN), /工程已更新/);
  for (const operation of [
    { type: "clip.move", sequenceId: main, clipIds: [], delta: 0 },
    { type: "clip.move", sequenceId: main, clipIds: ["a", "a"], delta: 0 },
    { type: "clip.move", sequenceId: main, clipIds: ["missing"], delta: 0 },
    { type: "clip.move", sequenceId: main, clipIds: ["a"], delta: 1.5 },
    { type: "clip.add", sequenceId: main, clip: picture("a") },
    { type: "track.add", sequenceId: main, track: createTrack("v1", "video") },
    { type: "sequence.add", sequence: sequence() },
    { type: "track.reorder", sequenceId: main, trackIds: ["v1"] },
    { type: "project.rename", name: "x", unexpected: true },
    { type: "project.rename", name: "" },
  ] as EditorOperation[])
    assert.throws(() => apply(original, [operation]));
  const tooMany = Array.from({ length: 10001 }, () => ({ type: "project.rename", name: "x" }));
  assert.throws(() => apply(original, tooMany as EditorOperation[]));
  assert.equal(original.revision, 4);
  assert.equal(original.sequences[0]!.clips[0]!.start, 0);
});

test("owned previews detach caller input, empty results, nested reads and every later candidate", async () => {
  const value = document();
  value.sequences[0]!.clips = [picture("a")];
  value.sequences[0]!.clips[0]!.transform.x = -0;
  value.assets[0]!.metadata = { z: -0, a: { empty: [], none: null, enabled: false, text: "中文😀\n第二行" } };
  const original = structuredClone(value), preview = prepareEditorOperationPreview(value);
  Object.freeze(value);
  value.sequences[0]!.tracks[0]!.locked = true;
  value.assets.length = 0;
  assert.throws(() => apply(value, []), /素材|来源/);
  const empty = preview.preview([]), read = preview.read();
  assert.deepEqual(empty, original);
  assert.equal(empty.revision, original.revision);
  assert.notEqual(empty, read);
  assert.notEqual(empty.sequences[0]!.clips[0]!.transform, read.sequences[0]!.clips[0]!.transform);
  empty.sequences[0]!.clips[0]!.transform.x = 9;
  empty.assets.length = 0;
  read.sequences[0]!.tracks[0]!.locked = true;
  assert.deepEqual(preview.read(), original);
  assert(Object.is(preview.read().sequences[0]!.clips[0]!.transform.x, -0));
  assert(Object.is(preview.read().assets[0]!.metadata!.z, -0));
  assert.deepEqual(Object.keys(preview.read().assets[0]!.metadata!), ["z", "a"]);
  const operations: EditorOperation[] = [{ type: "clip.move", sequenceId: main, clipIds: ["a"], delta: seconds(1) }],
    result = preview.preview(operations);
  assert.deepEqual(result, apply(original, operations));
  queueMicrotask(() => {
    (operations[0] as Extract<EditorOperation, { type: "clip.move" }>).clipIds.push("missing");
    result.sequences[0]!.clips.length = 0;
  });
  await Promise.resolve();
  assert.deepEqual(preview.read(), original);
  assert.equal(preview.preview([]).sequences[0]!.clips.length, 1);
  preview.dispose();
  preview.dispose();
  assert.throws(() => preview.read(), /预览已结束/);
  assert.throws(() => preview.preview([]), /预览已结束/);
});

test("owned previews isolate reentrant nested operation getters and reentrant disposal", () => {
  const value = document();
  value.sequences[0]!.clips = [picture("a")];
  const preview = prepareEditorOperationPreview(value), transform = defaultTransform();
  let calls = 0;
  Object.defineProperty(transform, "x", { enumerable: true, get() {
    calls++;
    const nested = preview.preview([{ type: "clip.move", sequenceId: main, clipIds: ["a"], delta: seconds(1) }]);
    nested.sequences[0]!.tracks[0]!.locked = true;
    return 0;
  } });
  const result = preview.preview([{ type: "clip.update", sequenceId: main, clipId: "a", patch: { transform } }]);
  assert.equal(calls, 1);
  assert.equal(result.sequences[0]!.clips[0]!.start, 0);
  assert.deepEqual(preview.read(), value);
  Object.defineProperty(transform, "y", { enumerable: true, get() { preview.dispose(); return 0; } });
  assert.throws(() => preview.preview([{ type: "clip.update", sequenceId: main, clipId: "a", patch: { transform } }]), /预览已结束/);
  assert.throws(() => preview.preview([]), /预览已结束/);
});

test("owned factory and candidates retain strict malformed data, locks, collision and graph rejection", () => {
  const value = document();
  value.sequences[0]!.clips = [picture("a"), picture("b", "v1", seconds(2))];
  const malformed = structuredClone(value);
  let getterCalls = 0;
  Object.defineProperty(malformed, "name", { enumerable: true, get() { getterCalls++; return "unsafe"; } });
  assert.throws(() => prepareEditorOperationPreview(malformed), /访问器/);
  assert.throws(() => apply(malformed, []), /访问器/);
  assert.equal(getterCalls, 0);
  const undefinedData = structuredClone(value);
  undefinedData.assets[0]!.metadata = { missing: undefined } as any;
  assert.throws(() => prepareEditorOperationPreview(undefinedData), /JSON/);
  const preview = prepareEditorOperationPreview(value), badOp = { type: "clip.move" };
  Object.defineProperty(badOp, "type", { enumerable: true, get() { getterCalls++; return "clip.move"; } });
  assert.throws(() => preview.preview([badOp as EditorOperation]), /格式/);
  assert.equal(getterCalls, 0);
  assert.throws(() => preview.preview([{ type: "clip.move", sequenceId: main, clipIds: ["a"], delta: seconds(2) }]), /重叠/);
  assert.throws(() => preview.preview([{ type: "asset.remove", assetId: "source-video" }]), /素材|来源/);
  assert.deepEqual(preview.read(), value);
  const locked = structuredClone(value);
  locked.sequences[0]!.tracks[0]!.locked = true;
  const lockedPreview = prepareEditorOperationPreview(locked);
  assert.throws(() => lockedPreview.preview([{ type: "clip.move", sequenceId: main, clipIds: ["a"], delta: 1 }]), /锁定/);
  assert.deepEqual(lockedPreview.read(), locked);
  preview.dispose(); lockedPreview.dispose();
});
