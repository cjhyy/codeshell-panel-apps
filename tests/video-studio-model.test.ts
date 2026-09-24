import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyOperations,
  createDemoProject,
  createProject,
  formatTime,
  timelineClips,
  timelineDuration,
  validateProject,
  type EditOperation,
  type AudioClip,
  type Project,
} from "../apps/video-studio/src/model.ts";

function fixture(): Project {
  const project = createProject("测试工程");
  project.assets = [
    { id: "asset-a", name: "A", kind: "video", durationFrames: 300 },
    { id: "asset-b", name: "B", kind: "video", durationFrames: 300 },
    { id: "asset-c", name: "C", kind: "image", durationFrames: 300 },
  ];
  project.clips = [
    { id: "clip-a", assetId: "asset-a", inFrame: 30, outFrame: 120, volume: 0.4 },
    { id: "clip-b", assetId: "asset-b", inFrame: 0, outFrame: 90, volume: 1 },
    { id: "clip-c", assetId: "asset-c", inFrame: 0, outFrame: 90, volume: 1 },
  ];
  project.captions = [
    { id: "caption-a", startFrame: 15, endFrame: 75, text: "A 的字幕" },
    { id: "caption-b", startFrame: 105, endFrame: 165, text: "B 的字幕" },
    { id: "caption-c", startFrame: 195, endFrame: 255, text: "C 的字幕" },
  ];
  return validateProject(project);
}

test("LAN browsers can create portable projects without randomUUID", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined });
  try {
    const first = createProject("手机项目");
    const second = createDemoProject();
    assert.notEqual(first.id, second.id);
    for (const project of [first, second]) {
      assert.match(
        project.id,
        /^project-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      );
      assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
    }
  } finally {
    if (original) Object.defineProperty(globalThis.crypto, "randomUUID", original);
    else Reflect.deleteProperty(globalThis.crypto, "randomUUID");
  }
});

test("new and demo projects are valid portable 30 fps data", () => {
  assert.equal(timelineDuration(createProject()), 0);
  const demo = createDemoProject();
  assert.equal(demo.fps, 30);
  assert.equal(demo.assets.length, 3);
  assert.equal(timelineDuration(demo), 720);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(demo))), demo);
  assert.deepEqual(
    timelineClips(demo).map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    [
      [0, 180],
      [180, 480],
      [480, 720],
    ],
  );
});

test("split uses source frames, preserves volume and captions, and rejects empty sides", () => {
  const before = fixture();
  const after = applyOperations(before, [{ type: "split", clipId: "clip-a", atFrame: 60 }], 0);
  assert.deepEqual(
    after.clips.slice(0, 2).map(({ inFrame, outFrame, volume }) => ({ inFrame, outFrame, volume })),
    [
      { inFrame: 30, outFrame: 60, volume: 0.4 },
      { inFrame: 60, outFrame: 120, volume: 0.4 },
    ],
  );
  assert.equal(new Set(after.clips.map((clip) => clip.id)).size, 4);
  assert.equal(timelineDuration(after), 270);
  assert.deepEqual(after.captions, before.captions);
  for (const atFrame of [30, 120, 15, 60.5]) {
    assert.throws(() => applyOperations(before, [{ type: "split", clipId: "clip-a", atFrame }], 0));
  }
});

test("patches are atomic and increment revision once, with stale edit rejection", () => {
  const before = fixture();
  const snapshot = structuredClone(before);
  const after = applyOperations(
    before,
    [
      { type: "volume", clipId: "clip-a", volume: 0 },
      { type: "settings", name: "已修改", width: 1080, height: 1920 },
    ],
    0,
  );
  assert.equal(after.revision, 1);
  assert.equal(after.clips[0]!.volume, 0);
  assert.equal(after.name, "已修改");
  assert.deepEqual(before, snapshot);
  assert.throws(
    () => applyOperations(after, [{ type: "remove", clipId: "clip-b" }], 0),
    /工程已更新/,
  );
  assert.throws(() =>
    applyOperations(
      before,
      [
        { type: "remove", clipId: "clip-a" },
        { type: "trim", clipId: "clip-b", inFrame: 100, outFrame: 100 },
      ],
      0,
    ),
  );
  assert.deepEqual(before, snapshot);
  assert.equal(applyOperations(after, [], 1).revision, 1);
});

test("remove ripples later captions and removes only deleted source coverage", () => {
  const before = fixture();
  before.captions.push({ id: "cross", startFrame: 60, endFrame: 210, text: "跨片段字幕" });
  const after = applyOperations(before, [{ type: "remove", clipId: "clip-b" }], 0);
  assert.equal(timelineDuration(after), 180);
  assert.deepEqual(
    after.captions.map(({ id, startFrame, endFrame }) => ({ id, startFrame, endFrame })),
    [
      { id: "caption-a", startFrame: 15, endFrame: 75 },
      { id: "cross", startFrame: 60, endFrame: 120 },
      { id: "caption-c", startFrame: 105, endFrame: 165 },
    ],
  );
});

test("trim clips captions to surviving source, while extension adds uncaptioned time", () => {
  const project = fixture();
  const trimmed = applyOperations(
    project,
    [{ type: "trim", clipId: "clip-a", inFrame: 60, outFrame: 90 }],
    0,
  );
  assert.equal(timelineDuration(trimmed), 210);
  assert.deepEqual(
    trimmed.captions.map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    [
      [0, 30],
      [45, 105],
      [135, 195],
    ],
  );
  const extended = applyOperations(
    project,
    [{ type: "trim", clipId: "clip-a", inFrame: 0, outFrame: 150 }],
    0,
  );
  assert.deepEqual(
    extended.captions.map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    [
      [45, 105],
      [165, 225],
      [255, 315],
    ],
  );
  const disjoint = applyOperations(
    project,
    [{ type: "trim", clipId: "clip-a", inFrame: 150, outFrame: 240 }],
    0,
  );
  assert.equal(
    disjoint.captions.some((caption) => caption.id === "caption-a"),
    false,
  );
});

test("move carries captions with clip instances and splits spans around moved material", () => {
  const before = fixture();
  before.captions.push({ id: "cross", startFrame: 60, endFrame: 120, text: "跨 A 与 B" });
  const after = applyOperations(before, [{ type: "move", clipId: "clip-a", toIndex: 2 }], 0);
  assert.deepEqual(
    after.clips.map((clip) => clip.id),
    ["clip-b", "clip-c", "clip-a"],
  );
  assert.deepEqual(
    after.captions
      .filter((caption) => caption.text === "跨 A 与 B")
      .map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    [
      [0, 30],
      [240, 270],
    ],
  );
  assert.deepEqual(
    after.captions.find((caption) => caption.id === "caption-a"),
    { id: "caption-a", startFrame: 195, endFrame: 255, text: "A 的字幕" },
  );
  assert.equal(new Set(after.captions.map((caption) => caption.id)).size, after.captions.length);
});

test("repeated assets remain separate clip instances during caption ripple", () => {
  const before = fixture();
  const added = applyOperations(
    before,
    [{ type: "add", assetId: "asset-a", inFrame: 30, outFrame: 120 }],
    0,
  );
  assert.equal(added.clips.length, 4);
  assert.deepEqual(added.captions, before.captions);
  const moved = applyOperations(
    added,
    [{ type: "move", clipId: added.clips[3]!.id, toIndex: 0 }],
    1,
  );
  assert.equal(moved.captions[0]!.startFrame, 105);
  assert.equal(moved.captions.length, 3);
});

test("captions can be inserted, replaced and removed with range validation", () => {
  const project = fixture();
  const updated = applyOperations(
    project,
    [
      {
        type: "caption",
        caption: { id: "caption-a", startFrame: 0, endFrame: 30, text: "替换字幕" },
      },
    ],
    0,
  );
  assert.equal(updated.captions.length, 3);
  assert.equal(updated.captions[0]!.text, "替换字幕");
  const removed = applyOperations(updated, [{ type: "remove-caption", captionId: "caption-a" }], 1);
  assert.equal(removed.captions.length, 2);
  assert.throws(() =>
    applyOperations(
      project,
      [
        {
          type: "caption",
          caption: { id: "outside", startFrame: 260, endFrame: 280, text: "越界" },
        },
      ],
      0,
    ),
  );
  const emptied = applyOperations(
    project,
    project.clips.map((clip) => ({ type: "remove", clipId: clip.id })),
    0,
  );
  assert.deepEqual(emptied.captions, []);
});

test("untrusted engineering files reject malformed, excessive, or unknown data", () => {
  const invalid: unknown[] = [
    null,
    [],
    {},
    { ...fixture(), fps: 24 },
    { ...fixture(), revision: -1 },
    { ...fixture(), extra: true },
  ];
  for (const value of invalid) assert.throws(() => validateProject(value));
  const missingAsset = fixture();
  missingAsset.clips[0]!.assetId = "missing";
  assert.throws(() => validateProject(missingAsset));
  const duplicate = fixture();
  duplicate.assets.push({ ...duplicate.assets[0]! });
  assert.throws(() => validateProject(duplicate), /ID 重复/);
  const sparse = fixture();
  sparse.clips = Array(2);
  assert.throws(() => validateProject(sparse));
  const tooMany = fixture();
  tooMany.assets = Array.from({ length: 1_001 }, (_, index) => ({
    ...tooMany.assets[0]!,
    id: `asset-${index}`,
  }));
  assert.throws(() => validateProject(tooMany), /最多/);
  const tooLong = fixture();
  tooLong.assets[0]!.durationFrames = 2_592_000;
  tooLong.clips[0]!.outFrame = 2_592_000;
  assert.throws(() => validateProject(tooLong), /时间线总时长/);
  const dirty = fixture();
  Object.assign(dirty.assets[0]!, { path: "/private/file.mp4" });
  assert.throws(() => validateProject(dirty), /未知字段/);
  const copy = validateProject(fixture());
  const detached = validateProject(copy);
  detached.clips[0]!.volume = 0;
  assert.equal(copy.clips[0]!.volume, 0.4);
});

test("runtime operations reject nonfinite values, unknown fields and invalid positions", () => {
  const project = fixture();
  const invalid: unknown[] = [
    { type: "constructor" },
    { type: "volume", clipId: "clip-a", volume: NaN },
    { type: "volume", clipId: "clip-a", volume: Infinity },
    { type: "volume", clipId: "clip-a", volume: 2.01 },
    { type: "move", clipId: "clip-a", toIndex: 3 },
    { type: "remove", clipId: "missing" },
    { type: "remove", clipId: "clip-a", command: "ignored" },
    { type: "add", assetId: "asset-a", inFrame: 299, outFrame: 301 },
    { type: "add", assetId: "missing" },
  ];
  for (const operation of invalid) {
    assert.throws(() => applyOperations(project, [operation as EditOperation], 0));
  }
  assert.throws(() => applyOperations(project, Array(1_001).fill({ type: "settings" }), 0));
});

test("timecodes preserve frame precision and hour rollover", () => {
  assert.equal(formatTime(0), "00:00:00:00");
  assert.equal(formatTime(29), "00:00:00:29");
  assert.equal(formatTime(30), "00:00:01:00");
  assert.equal(formatTime(108_031), "01:00:01:01");
  assert.throws(() => formatTime(-1));
  assert.throws(() => formatTime(0.1));
});

function audioFixture(): Project {
  const project = fixture();
  project.assets.push({ id: "music", name: "背景音乐", kind: "audio", durationFrames: 900 });
  project.assets.push({ id: "voice", name: "旁白", kind: "audio", durationFrames: 600 });
  return project;
}

function audioRanges(project: Project): number[][] {
  return (project.audioClips ?? []).map(({ startFrame, inFrame, outFrame }) => [
    startFrame,
    inFrame,
    outFrame,
  ]);
}

test("legacy files normalize empty audio tracks and portable media and scene data survive copies", () => {
  const project = fixture();
  delete project.audioClips;
  assert.deepEqual(validateProject(project).audioClips, []);
  const hash = "a".repeat(64);
  Object.assign(project.assets[0]!, {
    mediaId: `asset-${hash}`,
    proxyId: `asset-${"b".repeat(64)}`,
    thumbnailId: `asset-${"c".repeat(64)}`,
    scene: {
      kind: "hyperframes",
      sourceHash: hash,
      params: {
        title: "章节",
        bullets: ["第一点"],
        palette: { accent: "#ff0000" },
        nested: [null, true, 1],
      },
    },
  });
  const copied = validateProject(project);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(copied))), copied);
  (copied.assets[0]!.scene!.params.bullets as string[]).push("第二点");
  assert.deepEqual(project.assets[0]!.scene!.params.bullets, ["第一点"]);
  for (const id of ["asset-short", "/Users/private/movie.mp4", `asset-${"A".repeat(64)}`]) {
    const invalid = structuredClone(project);
    invalid.assets[0]!.mediaId = id;
    assert.throws(() => validateProject(invalid), /持久素材 ID/);
  }
  for (const params of [
    { invalid: NaN },
    { invalid: () => 1 },
    { invalid: new Date() },
    { huge: "中".repeat(30_000) },
    JSON.parse('{"__proto__":{}}'),
  ]) {
    const invalid = structuredClone(project);
    Object.assign(invalid.assets[0]!.scene!, { params });
    assert.throws(() => validateProject(invalid), /场景参数/);
  }
  const invalid = structuredClone(project);
  Object.assign(invalid.assets[0]!.scene!, { sourcePath: "/private/source" });
  assert.throws(() => validateProject(invalid), /未知字段/);
});

test("overlapping music and voice tracks add independently and default to remaining picture length", () => {
  const project = audioFixture();
  const after = applyOperations(
    project,
    [
      { type: "audio-add", assetId: "music", inFrame: 100, volume: 0.25 },
      { type: "audio-add", assetId: "voice", startFrame: 90, inFrame: 30, outFrame: 150 },
    ],
    0,
  );
  assert.equal(after.revision, 1);
  assert.deepEqual(audioRanges(after), [
    [0, 100, 370],
    [90, 30, 150],
  ]);
  assert.equal(after.audioClips![0]!.volume, 0.25);
  assert.deepEqual(after.clips, project.clips);
  assert.deepEqual(after.captions, project.captions);
  assert.equal(timelineDuration(after), 270);
  assert.equal(after.audioClips![1]!.volume, 1);
  assert.deepEqual(project.audioClips, []);
  const extracted = applyOperations(
    project,
    [{ type: "audio-add", assetId: "asset-a", outFrame: 60 }],
    0,
  );
  assert.equal(extracted.audioClips![0]!.assetId, "asset-a");
});

test("audio trim, move, volume, and remove are bounded atomic operations", () => {
  const project = applyOperations(
    audioFixture(),
    [{ type: "audio-add", assetId: "voice", outFrame: 90 }],
    0,
  );
  const id = project.audioClips![0]!.id;
  const snapshot = structuredClone(project);
  const after = applyOperations(
    project,
    [
      { type: "audio-trim", clipId: id, inFrame: 30, outFrame: 90 },
      { type: "audio-move", clipId: id, startFrame: 180 },
      { type: "audio-volume", clipId: id, volume: 0.6 },
    ],
    1,
  );
  assert.deepEqual(audioRanges(after), [[180, 30, 90]]);
  assert.equal(after.audioClips![0]!.volume, 0.6);
  assert.equal(after.revision, 2);
  assert.deepEqual(project, snapshot);
  const failed: unknown[] = [
    { type: "audio-trim", clipId: id, inFrame: 30, outFrame: 400 },
    { type: "audio-trim", clipId: id, inFrame: 0, outFrame: 601 },
    { type: "audio-move", clipId: id, startFrame: 181 },
    { type: "audio-volume", clipId: id, volume: Infinity },
    { type: "audio-remove", clipId: "missing" },
    { type: "audio-remove", clipId: id, surprise: true },
    { type: "audio-add", assetId: "music", startFrame: 270 },
    { type: "audio-add", assetId: "music", startFrame: null },
    { type: "audio-add", assetId: "music", volume: null },
    { type: "audio-add", assetId: "music", outFrame: 271 },
  ];
  for (const operation of failed) {
    assert.throws(() =>
      applyOperations(
        project,
        [{ type: "audio-volume", clipId: id, volume: 0 }, operation as EditOperation],
        1,
      ),
    );
    assert.deepEqual(project, snapshot);
  }
  assert.throws(
    () => applyOperations(after, [{ type: "audio-remove", clipId: id }], 1),
    /工程已更新/,
  );
  const removed = applyOperations(after, [{ type: "audio-remove", clipId: id }], 2);
  assert.deepEqual(removed.audioClips, []);
});

test("audio input validates source kinds, ranges, duplicate IDs and the 64-clip limit", () => {
  const project = audioFixture();
  assert.throws(
    () => applyOperations(project, [{ type: "audio-add", assetId: "asset-c" }], 0),
    /音轨只能/,
  );
  const empty = audioFixture();
  empty.clips = [];
  empty.captions = [];
  assert.throws(
    () => applyOperations(empty, [{ type: "audio-add", assetId: "voice" }], 0),
    /音轨开始时间/,
  );
  const clip: AudioClip = {
    id: "audio-1",
    assetId: "voice",
    inFrame: 0,
    outFrame: 60,
    startFrame: 0,
    volume: 1,
  };
  const invalid = [
    [{ ...clip, inFrame: -1 }],
    [{ ...clip, outFrame: 601 }],
    [{ ...clip, startFrame: 211 }],
    [{ ...clip, startFrame: 0.5 }],
    [{ ...clip, volume: -0.1 }],
    [{ ...clip, assetId: "missing" }],
    [clip, { ...clip }],
    Array(1),
    null,
  ];
  for (const audioClips of invalid)
    assert.throws(() => validateProject({ ...project, audioClips }));
  project.audioClips = Array.from({ length: 64 }, (_, index) => ({
    ...clip,
    id: `audio-${index + 1}`,
  }));
  assert.equal(validateProject(project).audioClips!.length, 64);
  assert.throws(
    () => applyOperations(project, [{ type: "audio-add", assetId: "voice", outFrame: 60 }], 0),
    /最多 64/,
  );
  assert.equal(project.audioClips.length, 64);
});

test("picture removal ripples audio while skipping deleted source rather than replaying it", () => {
  const project = audioFixture();
  project.audioClips = [
    { id: "bed", assetId: "music", startFrame: 0, inFrame: 10, outFrame: 280, volume: 0.2 },
    { id: "speech", assetId: "voice", startFrame: 60, inFrame: 100, outFrame: 250, volume: 1 },
  ];
  const after = applyOperations(project, [{ type: "remove", clipId: "clip-b" }], 0);
  assert.deepEqual(audioRanges(after), [
    [0, 10, 100],
    [90, 190, 280],
    [60, 100, 130],
    [90, 220, 250],
  ]);
  assert.equal(
    after
      .audioClips!.filter((clip) => clip.assetId === "music")
      .every((clip) => clip.volume === 0.2),
    true,
  );
  assert.equal(new Set(after.audioClips!.map((clip) => clip.id)).size, 4);
  const emptied = applyOperations(
    after,
    after.clips.map((clip) => ({ type: "remove", clipId: clip.id })),
    1,
  );
  assert.deepEqual(emptied.audioClips, []);
});

test("picture trims and extensions preserve audio offsets and leave new picture material silent", () => {
  const project = audioFixture();
  project.audioClips = [
    { id: "bed", assetId: "music", startFrame: 0, inFrame: 100, outFrame: 370, volume: 0.2 },
  ];
  const trimmed = applyOperations(
    project,
    [{ type: "trim", clipId: "clip-a", inFrame: 60, outFrame: 90 }],
    0,
  );
  assert.deepEqual(audioRanges(trimmed), [
    [0, 130, 160],
    [30, 190, 370],
  ]);
  const extended = applyOperations(
    project,
    [{ type: "trim", clipId: "clip-a", inFrame: 0, outFrame: 150 }],
    0,
  );
  assert.deepEqual(audioRanges(extended), [
    [30, 100, 190],
    [150, 190, 370],
  ]);
  const disjoint = applyOperations(
    project,
    [{ type: "trim", clipId: "clip-a", inFrame: 150, outFrame: 240 }],
    0,
  );
  assert.deepEqual(audioRanges(disjoint), [[90, 190, 370]]);
});

test("picture split keeps audio intact and move carries only the same clip instance's audio", () => {
  const project = audioFixture();
  project.audioClips = [
    { id: "speech", assetId: "voice", startFrame: 60, inFrame: 100, outFrame: 160, volume: 0.8 },
  ];
  const split = applyOperations(project, [{ type: "split", clipId: "clip-a", atFrame: 60 }], 0);
  assert.deepEqual(split.audioClips, project.audioClips);
  const moved = applyOperations(project, [{ type: "move", clipId: "clip-a", toIndex: 2 }], 0);
  assert.deepEqual(audioRanges(moved), [
    [0, 130, 160],
    [240, 100, 130],
  ]);
  const repeated = applyOperations(
    project,
    [{ type: "add", assetId: "asset-a", inFrame: 30, outFrame: 120 }],
    0,
  );
  assert.deepEqual(repeated.audioClips, project.audioClips);
  const repeatedMoved = applyOperations(
    repeated,
    [{ type: "move", clipId: repeated.clips[3]!.id, toIndex: 0 }],
    1,
  );
  assert.deepEqual(audioRanges(repeatedMoved), [[150, 100, 160]]);
});

test("transcript range deletion with split/remove preserves exact surviving picture, speech and caption ranges", () => {
  const project = audioFixture();
  project.audioClips = [
    { id: "voice", assetId: "voice", startFrame: 0, inFrame: 100, outFrame: 190, volume: 1 },
  ];
  // Original clip-a source [30,120): remove the spoken source interval [60,90).
  const after = applyOperations(
    project,
    [
      { type: "split", clipId: "clip-a", atFrame: 90 },
      { type: "split", clipId: "clip-a", atFrame: 60 },
      { type: "remove", clipId: "clip-5" },
    ],
    0,
  );
  assert.deepEqual(
    after.clips.slice(0, 2).map(({ inFrame, outFrame }) => [inFrame, outFrame]),
    [
      [30, 60],
      [90, 120],
    ],
  );
  assert.deepEqual(audioRanges(after), [
    [0, 100, 130],
    [30, 160, 190],
  ]);
  assert.deepEqual(
    after.captions.find((caption) => caption.id === "caption-a"),
    { id: "caption-a", startFrame: 15, endFrame: 45, text: "A 的字幕" },
  );
  assert.equal(timelineDuration(after), 240);
  assert.equal(after.revision, 1);
});

test("picture edits that would exceed the audio fragment budget fail atomically", () => {
  const project = audioFixture();
  project.audioClips = Array.from({ length: 64 }, (_, index) => ({
    id: `audio-${index}`,
    assetId: "music",
    startFrame: 60,
    inFrame: 0,
    outFrame: 150,
    volume: 1,
  }));
  const snapshot = structuredClone(project);
  assert.throws(
    () => applyOperations(project, [{ type: "remove", clipId: "clip-b" }], 0),
    /最多 64/,
  );
  assert.deepEqual(project, snapshot);
});

// The legacy template remains useful to identify safe demo-only migrations.
import {
  createNarratedDemoProject,
  migratePristineDemoProject,
  isDemoNarration,
} from "../apps/video-studio/src/demo";
test("new demos include a complete built-in narration and only pristine legacy demos migrate", () => {
  const narrated = createNarratedDemoProject();
  assert.equal(narrated.audioClips?.length, 1);
  assert.equal(narrated.audioClips?.[0].outFrame, 720);
  assert.equal(narrated.audioClips?.[0].volume, 1);
  assert.equal(narrated.assets.filter(isDemoNarration).length, 1);
  const original = createDemoProject(),
    migrated = migratePristineDemoProject(original);
  assert.ok(migrated);
  assert.equal(migrated.id, original.id);
  assert.equal(migrated.revision, 1);
  assert.deepEqual(migrated.clips, original.clips);
  assert.deepEqual(migrated.captions, original.captions);
  assert.equal(original.assets.length, 3);
  assert.equal(migratePristineDemoProject(migrated), null);
  for (const modify of [
    (value: Project) => {
      value.revision = 1;
    },
    (value: Project) => {
      value.name = "我的工程";
    },
    (value: Project) => {
      value.clips[0]!.volume = 0.5;
    },
    (value: Project) => {
      value.clips[0]!.outFrame = 170;
    },
    (value: Project) => {
      value.captions[0]!.text = "我的句子";
    },
    (value: Project) => {
      value.assets[0]!.name = "我的素材";
    },
  ]) {
    const edited = structuredClone(original);
    modify(edited);
    assert.equal(migratePristineDemoProject(edited), null);
  }
});
