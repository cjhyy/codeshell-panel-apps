import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyOperations,
  createProject,
  timelineClips,
  timelineDuration,
  validateProject,
  type EditOperation,
  type Project,
} from "../apps/video-studio/src/model";
import { narrationSnapshot, updateNarrationScript } from "../apps/video-studio/src/narration";

const MAX_FRAMES = 30 * 86400;
const edit = (project: Project, operations: EditOperation[]) =>
  applyOperations(project, operations, project.revision);
const positions = (project: Project) =>
  timelineClips(project).map(({ id, startFrame, endFrame }) => [id, startFrame, endFrame]);

function fixture(): Project {
  return validateProject({
    ...createProject("自由时间轴测试"),
    assets: [
      { id: "video-a", name: "A", kind: "video", durationFrames: 600 },
      { id: "video-b", name: "B", kind: "video", durationFrames: 300 },
      { id: "image-c", name: "C", kind: "image", durationFrames: 300 },
      { id: "music", name: "音乐", kind: "audio", durationFrames: 720 },
    ],
    clips: [
      { id: "a", assetId: "video-a", inFrame: 30, outFrame: 120, volume: 0.4 },
      { id: "b", assetId: "video-b", inFrame: 0, outFrame: 90, volume: 1 },
      { id: "c", assetId: "image-c", inFrame: 0, outFrame: 90, volume: 1 },
    ],
    captions: [
      { id: "caption-a", startFrame: 15, endFrame: 75, text: "A 字幕" },
      { id: "caption-b", startFrame: 105, endFrame: 165, text: "B 字幕" },
      { id: "caption-c", startFrame: 195, endFrame: 255, text: "C 字幕" },
    ],
    audioClips: [
      { id: "bed", assetId: "music", startFrame: 0, inFrame: 10, outFrame: 280, volume: 0.2 },
    ],
  });
}

function freeFixture(): Project {
  return edit(fixture(), [{ type: "settings", timelineMode: "free" }]);
}

function gappedFixture(): Project {
  return edit(freeFixture(), [{ type: "video-move", clipId: "b", startFrame: 360 }]);
}

test("legacy projects retain their original portable data and become free without moving content", () => {
  const before = fixture();
  assert.equal(before.timelineMode, undefined);
  assert.ok(before.clips.every((clip) => !Object.hasOwn(clip, "startFrame")));
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(before))), before);
  const after = edit(before, [{ type: "settings", timelineMode: "free" }]);
  assert.equal(after.timelineMode, "free");
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(positions(after), positions(before));
  assert.deepEqual(after.captions, before.captions);
  assert.deepEqual(after.audioClips, before.audioClips);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(after))), after);
});

test("video movement creates gaps, reorders by time and moves only the video's source captions", () => {
  const before = freeFixture();
  const after = edit(before, [{ type: "video-move", clipId: "b", startFrame: 360 }]);
  assert.deepEqual(positions(after), [
    ["a", 0, 90],
    ["c", 180, 270],
    ["b", 360, 450],
  ]);
  assert.equal(timelineDuration(after), 450);
  assert.deepEqual(
    after.captions.find((caption) => caption.id === "caption-b"),
    {
      id: "caption-b",
      startFrame: 375,
      endFrame: 435,
      text: "B 字幕",
    },
  );
  assert.deepEqual(after.audioClips, before.audioClips);
  assert.deepEqual(
    after.clips.find((clip) => clip.id === "b"),
    {
      ...before.clips.find((clip) => clip.id === "b"),
      startFrame: 360,
    },
  );
});

test("captions and independent audio inside existing picture gaps survive unrelated edits", () => {
  const before = edit(gappedFixture(), [
    { type: "caption", caption: { id: "gap", startFrame: 110, endFrame: 140, text: "空隙字幕" } },
    {
      type: "caption",
      caption: { id: "spanning", startFrame: 60, endFrame: 210, text: "跨画面和空隙" },
    },
    { type: "audio-add", assetId: "music", startFrame: 100, inFrame: 300, outFrame: 360 },
  ]);
  const after = edit(before, [{ type: "video-move", clipId: "a", startFrame: 270 }]);
  assert.deepEqual(
    after.captions.find((caption) => caption.id === "gap"),
    before.captions.find((caption) => caption.id === "gap"),
  );
  assert.deepEqual(
    after.captions
      .filter((caption) => caption.text === "跨画面和空隙")
      .map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    [
      [90, 210],
      [330, 360],
    ],
  );
  assert.deepEqual(after.audioClips, before.audioClips);
  const added = edit(after, [{ type: "add", assetId: "video-a", inFrame: 0, outFrame: 30 }]);
  assert.deepEqual(added.captions, after.captions);
  assert.deepEqual(added.audioClips, after.audioClips);
});

test("free trim anchors source frames without moving neighbours and rejects collisions", () => {
  const before = edit(gappedFixture(), [{ type: "video-move", clipId: "a", startFrame: 90 }]);
  const trimmed = edit(before, [{ type: "trim", clipId: "a", inFrame: 45, outFrame: 120 }]);
  assert.deepEqual(positions(trimmed), [
    ["a", 105, 180],
    ["c", 180, 270],
    ["b", 360, 450],
  ]);
  const extended = edit(trimmed, [{ type: "trim", clipId: "a", inFrame: 0, outFrame: 120 }]);
  assert.deepEqual(positions(extended), [
    ["a", 60, 180],
    ["c", 180, 270],
    ["b", 360, 450],
  ]);
  const out = edit(trimmed, [{ type: "trim", clipId: "a", inFrame: 45, outFrame: 90 }]);
  assert.deepEqual(positions(out), [
    ["a", 105, 150],
    ["c", 180, 270],
    ["b", 360, 450],
  ]);
  assert.deepEqual(out.audioClips, before.audioClips);
  assert.throws(
    () => edit(trimmed, [{ type: "trim", clipId: "a", inFrame: 45, outFrame: 150 }]),
    /重叠/,
  );
  assert.throws(
    () => edit(freeFixture(), [{ type: "trim", clipId: "a", inFrame: 0, outFrame: 120 }]),
    /开始时间/,
  );
});

test("free splitting gives the right half its exact timeline position without touching captions or audio", () => {
  const before = gappedFixture();
  const after = edit(before, [{ type: "split", clipId: "b", atFrame: 45 }]);
  const halves = after.clips.filter((clip) => clip.assetId === "video-b");
  assert.deepEqual(
    halves.map(({ startFrame, inFrame, outFrame }) => [startFrame, inFrame, outFrame]),
    [
      [360, 0, 45],
      [405, 45, 90],
    ],
  );
  assert.equal(timelineDuration(after), 450);
  assert.deepEqual(after.captions, before.captions);
  assert.deepEqual(after.audioClips, before.audioClips);
});

test("removing a free clip leaves the gap and bounds independent tracks only at the new sequence end", () => {
  const before = edit(gappedFixture(), [
    { type: "audio-add", assetId: "music", startFrame: 240, inFrame: 100, outFrame: 280 },
    { type: "audio-add", assetId: "music", startFrame: 400, inFrame: 0, outFrame: 30 },
    {
      type: "caption",
      caption: { id: "late-gap", startFrame: 300, endFrame: 330, text: "尾部空隙" },
    },
  ]);
  const after = edit(before, [{ type: "remove", clipId: "b" }]);
  assert.deepEqual(positions(after), [
    ["a", 0, 90],
    ["c", 180, 270],
  ]);
  assert.equal(timelineDuration(after), 270);
  assert.deepEqual(
    after.audioClips!.map(({ startFrame, inFrame, outFrame }) => [startFrame, inFrame, outFrame]),
    [
      [0, 10, 280],
      [240, 100, 130],
    ],
  );
  assert.equal(
    after.captions.some((caption) => caption.id === "late-gap"),
    false,
  );
  const empty = edit(after, [
    { type: "remove", clipId: "c" },
    { type: "remove", clipId: "a" },
  ]);
  assert.equal(timelineDuration(empty), 0);
  assert.deepEqual(empty.audioClips, []);
  assert.deepEqual(empty.captions, []);
});

test("free additions append after max end or fill an explicit empty range atomically", () => {
  const before = gappedFixture();
  const appended = edit(before, [{ type: "add", assetId: "video-a", inFrame: 0, outFrame: 30 }]);
  assert.equal(appended.clips.at(-1)!.startFrame, 450);
  assert.equal(timelineDuration(appended), 480);
  const inserted = edit(before, [
    { type: "add", assetId: "video-a", inFrame: 0, outFrame: 30, startFrame: 120 },
  ]);
  assert.equal(inserted.clips[1]!.startFrame, 120);
  assert.equal(timelineDuration(inserted), 450);
  assert.throws(
    () =>
      edit(before, [
        { type: "add", assetId: "video-a", inFrame: 0, outFrame: 30, startFrame: 170 },
      ]),
    /重叠/,
  );
  assert.throws(
    () => edit(fixture(), [{ type: "add", assetId: "video-a", outFrame: 30, startFrame: 300 }]),
    /关闭主序列磁性/,
  );
  for (const startFrame of [null, -1, 0.5, NaN, Infinity, MAX_FRAMES])
    assert.throws(() =>
      applyOperations(
        before,
        [{ type: "add", assetId: "video-a", outFrame: 30, startFrame }],
        before.revision,
      ),
    );
});

test("reenabling magnetic mode closes gaps, clears positions and leaves legacy editing usable", () => {
  const before = gappedFixture();
  const after = edit(before, [{ type: "settings", timelineMode: "magnetic" }]);
  assert.equal(after.timelineMode, "magnetic");
  assert.deepEqual(positions(after), [
    ["a", 0, 90],
    ["c", 90, 180],
    ["b", 180, 270],
  ]);
  assert.ok(after.clips.every((clip) => !Object.hasOwn(clip, "startFrame")));
  assert.deepEqual(
    after.captions.find((caption) => caption.id === "caption-b"),
    { id: "caption-b", startFrame: 195, endFrame: 255, text: "B 字幕" },
  );
  const moved = edit(after, [{ type: "move", clipId: "b", toIndex: 0 }]);
  assert.equal(moved.clips[0]!.id, "b");
});

test("invalid, overlapping, stale and wrong-mode operations fail without changing the source", () => {
  const before = gappedFixture();
  const snapshot = structuredClone(before);
  for (const startFrame of [-1, 0.5, NaN, Infinity, MAX_FRAMES, 60, 200])
    assert.throws(() => edit(before, [{ type: "video-move", clipId: "b", startFrame }]));
  assert.throws(() => edit(before, [{ type: "move", clipId: "b", toIndex: 0 }]), /自由时间轴/);
  assert.throws(
    () => edit(fixture(), [{ type: "video-move", clipId: "b", startFrame: 360 }]),
    /关闭主序列磁性/,
  );
  assert.throws(
    () =>
      applyOperations(
        before,
        [{ type: "video-move", clipId: "b", startFrame: 500 }],
        before.revision - 1,
      ),
    /工程已更新/,
  );
  assert.throws(
    () =>
      edit(before, [
        { type: "video-move", clipId: "b", startFrame: 600 },
        { type: "video-move", clipId: "a", startFrame: 200 },
      ]),
    /重叠/,
  );
  assert.deepEqual(before, snapshot);
});

test("portable free timelines normalize missing positions and order while rejecting malformed placement", () => {
  const before = gappedFixture();
  assert.deepEqual(validateProject({ ...before, clips: [...before.clips].reverse() }), before);
  const mixed = validateProject({ ...fixture(), timelineMode: "free" });
  assert.deepEqual(positions(mixed), positions(fixture()));
  for (const startFrame of [-1, 1.5, MAX_FRAMES, "30", null])
    assert.throws(() =>
      validateProject({
        ...before,
        clips: [{ ...before.clips[0], startFrame }, ...before.clips.slice(1)],
      }),
    );
  assert.throws(() => validateProject({ ...before, timelineMode: "unknown" }));
  assert.throws(() => validateProject({ ...before, timelineMode: undefined }), /磁性时间轴/);
});

test("narration duration includes gaps; placement changes invalidate approval snapshots", () => {
  const before = gappedFixture();
  const narrated = updateNarrationScript(before, "第一句。第二句。");
  assert.equal(Math.max(...narrated.captions.map((caption) => caption.endFrame)), 450);
  const noCaptions = { ...before, captions: [] };
  const moved = edit(noCaptions, [{ type: "video-move", clipId: "b", startFrame: 600 }]);
  assert.notEqual(narrationSnapshot(noCaptions), narrationSnapshot(moved));
});
