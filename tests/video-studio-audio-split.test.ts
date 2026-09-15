import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyOperations,
  createProject,
  timelineDuration,
  validateProject,
  type EditOperation,
  type Project,
} from "../apps/video-studio/src/model.ts";

function fixture(): Project {
  const project = createProject("独立音轨切分");
  project.assets = [
    { id: "video", name: "画面", kind: "video", durationFrames: 900 },
    { id: "voice", name: "旁白", kind: "audio", durationFrames: 900 },
  ];
  project.clips = [{ id: "picture", assetId: "video", inFrame: 30, outFrame: 630, volume: 0.5 }];
  project.audioClips = [
    { id: "audio-1", assetId: "voice", inFrame: 120, outFrame: 390, startFrame: 90, volume: 0.7 },
    { id: "audio-2", assetId: "video", inFrame: 0, outFrame: 600, startFrame: 0, volume: 0.2 },
  ];
  project.captions = [
    { id: "subtitle", startFrame: 120, endFrame: 300, text: "跨切分点的完整字幕" },
  ];
  return validateProject(project);
}

test("audio-split preserves source playback and all other timeline content", () => {
  const project = fixture();
  const snapshot = structuredClone(project);
  const after = applyOperations(
    project,
    [{ type: "audio-split", clipId: "audio-1", atFrame: 210 }],
    0,
  );
  const [left, right, untouched] = after.audioClips!;
  assert.deepEqual(left, { ...project.audioClips![0]!, outFrame: 210 });
  assert.deepEqual(right, {
    ...project.audioClips![0]!,
    id: right!.id,
    inFrame: 210,
    startFrame: 180,
  });
  assert.equal(left!.startFrame + left!.outFrame - left!.inFrame, right!.startFrame);
  assert.equal(right!.startFrame + right!.outFrame - right!.inFrame, 360);
  assert.equal(new Set(after.audioClips!.map((clip) => clip.id)).size, 3);
  assert.match(right!.id, /^audio-/);
  assert.deepEqual(untouched, project.audioClips![1]);
  assert.deepEqual(after.clips, project.clips);
  assert.deepEqual(after.captions, project.captions);
  assert.equal(timelineDuration(after), timelineDuration(project));
  assert.equal(after.revision, 1);
  assert.deepEqual(project, snapshot);
});

test("audio-split accepts one-frame sides and keeps sequential splits contiguous", () => {
  const project = fixture();
  const after = applyOperations(
    project,
    [
      { type: "audio-split", clipId: "audio-1", atFrame: 389 },
      { type: "audio-split", clipId: "audio-1", atFrame: 121 },
    ],
    0,
  );
  assert.deepEqual(
    after
      .audioClips!.slice(0, 3)
      .map(({ inFrame, outFrame, startFrame }) => [inFrame, outFrame, startFrame]),
    [
      [120, 121, 90],
      [121, 389, 91],
      [389, 390, 359],
    ],
  );
  assert.equal(new Set(after.audioClips!.map((clip) => clip.id)).size, 4);
  assert.equal(after.revision, 1);
  assert.throws(
    () => applyOperations(after, [{ type: "audio-split", clipId: "audio-1", atFrame: 121 }], 1),
    /音轨分割位置/,
  );
});

test("audio-split rejects empty, out-of-range and malformed splits atomically", () => {
  const project = fixture();
  const snapshot = structuredClone(project);
  const invalid: unknown[] = [
    ...[120, 390, 90, 450, -1, 210.5, NaN, Infinity, "210", null, undefined].map((atFrame) => ({
      type: "audio-split",
      clipId: "audio-1",
      atFrame,
    })),
    { type: "audio-split", clipId: "picture", atFrame: 210 },
    { type: "audio-split", clipId: "missing", atFrame: 210 },
    { type: "audio-split", clipId: "audio-1", atFrame: 210, startFrame: 0 },
  ];
  for (const operation of invalid) {
    assert.throws(() =>
      applyOperations(
        project,
        [{ type: "audio-volume", clipId: "audio-2", volume: 0 }, operation as EditOperation],
        0,
      ),
    );
    assert.deepEqual(project, snapshot);
  }
  assert.throws(
    () =>
      applyOperations(
        project,
        [
          { type: "audio-split", clipId: "audio-1", atFrame: 210 },
          { type: "audio-remove", clipId: "missing" },
        ],
        0,
      ),
    /音轨不存在/,
  );
  assert.deepEqual(project, snapshot);
  assert.throws(
    () => applyOperations(project, [{ type: "audio-split", clipId: "audio-1", atFrame: 210 }], 1),
    /工程已更新/,
  );
  assert.deepEqual(project, snapshot);
});

test("audio-split enforces the audio clip limit in every intermediate patch state", () => {
  const project = fixture();
  project.audioClips = Array.from({ length: 63 }, (_, index) => ({
    ...project.audioClips![0]!,
    id: `audio-${index + 1}`,
  }));
  const after = applyOperations(
    project,
    [{ type: "audio-split", clipId: "audio-1", atFrame: 210 }],
    0,
  );
  assert.equal(after.audioClips!.length, 64);
  assert.equal(new Set(after.audioClips!.map((clip) => clip.id)).size, 64);
  const snapshot = structuredClone(after);
  assert.throws(
    () =>
      applyOperations(
        after,
        [
          { type: "audio-split", clipId: "audio-2", atFrame: 210 },
          { type: "audio-remove", clipId: "audio-3" },
        ],
        1,
      ),
    /最多 64/,
  );
  assert.deepEqual(after, snapshot);
});

test("both agent edit contracts expose audio-split with integer source frames", () => {
  const manifest = JSON.parse(
    readFileSync("apps/video-studio/.codeshell-panel/panel.json", "utf8"),
  );
  for (const name of ["propose_video_edit", "apply_video_edit"]) {
    const tool = manifest.agent.tools.find((entry: { name: string }) => entry.name === name);
    const fields = tool.inputSchema.properties.operations.items.properties;
    assert.ok(fields.type.enum.includes("audio-split"), `${name} accepts audio-split`);
    assert.deepEqual(fields.atFrame, { type: "integer", minimum: 1 });
  }
});
