import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyOperations,
  createProject,
  timelineDuration,
  validateProject,
  type Project,
} from "../apps/video-studio/src/model.ts";
import {
  findSpokenCandidates,
  buildSpokenEditPlan,
  type SpokenCandidate,
} from "../apps/video-studio/src/spoken-edit.ts";
function fixture(): Project {
  const project = createProject("口播测试");
  project.assets = [
    { id: "talk", name: "口播", kind: "video", durationFrames: 600 },
    { id: "music", name: "音乐", kind: "audio", durationFrames: 600 },
  ];
  project.clips = [{ id: "a", assetId: "talk", inFrame: 30, outFrame: 330, volume: 0.7 }];
  project.audioClips = [
    { id: "music-a", assetId: "music", inFrame: 0, outFrame: 300, startFrame: 0, volume: 0.2 },
  ];
  project.captions = [{ id: "c", startFrame: 120, endFrame: 180, text: "这一句保留" }];
  return validateProject(project);
}
test("real detector pauses retain breathing padding and map source offset to picture; words require timestamps", () => {
  const project = fixture();
  const candidates = findSpokenCandidates(project, [
    {
      assetId: "talk",
      silence: [
        { start: 2, end: 4 },
        { start: 5, end: 5.8 },
      ],
      transcript: [
        { start: 4.2, end: 5, text: "嗯，", words: [{ start: 4.3, end: 4.6, text: "嗯" }] },
        { start: 6, end: 8, text: "嗯，我们继续讲重要的正文。" },
        { start: 8, end: 10, text: "然后就是这句话。" },
      ],
    },
  ]);
  assert.equal(candidates.length, 3);
  const pause = candidates.find((c) => c.kind === "pause")!;
  assert.deepEqual(
    [
      pause.sourceStartFrame,
      pause.sourceEndFrame,
      pause.timelineStartFrame,
      pause.timelineEndFrame,
    ],
    [65, 115, 35, 85],
  );
  assert.equal(candidates.find((c) => c.precision === "word")?.actionable, true);
  const approximate = candidates.find((c) => c.precision === "segment")!;
  assert.equal(approximate.actionable, false);
  assert.match(approximate.reason, /缺少词时间戳/);
  assert.throws(() => buildSpokenEditPlan(project, candidates, [approximate.id]), /没有足够精确/);
});
test("selected disjoint source intervals atomically cut video, original audio and subtitles without changing originals", () => {
  const project = fixture(),
    before = structuredClone(project);
  const candidates = findSpokenCandidates(project, [
    {
      assetId: "talk",
      silence: [
        { start: 2, end: 4 },
        { start: 7, end: 9 },
      ],
    },
  ]);
  const plan = buildSpokenEditPlan(
    project,
    candidates,
    candidates.map((c) => c.id),
  );
  const next = applyOperations(project, plan.operations, plan.baseRevision);
  assert.equal(plan.removedFrames, 100);
  assert.equal(next.revision, project.revision + 1);
  assert.equal(timelineDuration(next), 200);
  assert.deepEqual(
    next.clips.map((c) => [c.inFrame, c.outFrame, c.volume]),
    [
      [30, 65, 0.7],
      [115, 215, 0.7],
      [265, 330, 0.7],
    ],
  );
  assert.deepEqual(
    next.audioClips!.map((c) => [c.inFrame, c.outFrame, c.startFrame]),
    [
      [0, 35, 0],
      [85, 185, 35],
      [235, 300, 135],
    ],
  );
  assert.deepEqual(
    next.captions.map((c) => [c.startFrame, c.endFrame]),
    [[70, 130]],
  );
  assert.deepEqual(project, before);
});
test("independent narration cuts corresponding picture time and retains the correct narration source intervals", () => {
  const project = fixture();
  project.audioClips = [
    { id: "narration", assetId: "music", inFrame: 60, outFrame: 240, startFrame: 30, volume: 1 },
  ];
  const candidates = findSpokenCandidates(project, [
    { assetId: "music", silence: [{ start: 3, end: 5 }] },
  ]);
  assert.equal(candidates[0]!.track, "audio");
  assert.deepEqual([candidates[0]!.timelineStartFrame, candidates[0]!.timelineEndFrame], [65, 115]);
  const plan = buildSpokenEditPlan(project, candidates, [candidates[0]!.id]);
  const next = applyOperations(project, plan.operations, project.revision);
  assert.deepEqual(
    next.audioClips!.map((c) => [c.inFrame, c.outFrame, c.startFrame]),
    [
      [60, 95, 30],
      [145, 240, 65],
    ],
  );
  assert.equal(timelineDuration(next), 250);
});
test("stale, tampered and tiny-fragment candidates fail before editing; overlapping candidates are counted once", () => {
  const project = fixture();
  const candidates = findSpokenCandidates(project, [
    {
      assetId: "talk",
      silence: [
        { start: 2, end: 4 },
        { start: 3, end: 5 },
      ],
    },
  ]);
  const plan = buildSpokenEditPlan(
    project,
    candidates,
    candidates.map((c) => c.id),
  );
  assert.equal(plan.removedFrames, 80);
  assert.throws(
    () => buildSpokenEditPlan({ ...project, revision: 1 }, candidates, [candidates[0]!.id]),
    /工程已更新/,
  );
  const forged = { ...candidates[0]!, timelineStartFrame: 100 };
  assert.throws(() => buildSpokenEditPlan(project, [forged], [forged.id]), /源时间映射/);
  const tiny = { ...candidates[0]!, sourceStartFrame: 33, timelineStartFrame: 3 };
  assert.throws(() => buildSpokenEditPlan(project, [tiny], [tiny.id]), /不足 0.2 秒/);
});
test("only exact adjacent repeated sentences become review candidates and partial words are not suggested", () => {
  const project = fixture();
  const candidates = findSpokenCandidates(project, [
    {
      assetId: "talk",
      transcript: [
        { start: 0.8, end: 1.3, text: "嗯", words: [{ start: 0.8, end: 1.1, text: "嗯" }] },
        { start: 2, end: 3, text: "这是完整的一句话。" },
        { start: 3.5, end: 4.5, text: "这是完整的一句话！" },
        { start: 5, end: 6, text: "这是完整的下一句话。" },
        { start: 7, end: 8, text: "嗯" },
      ],
    },
  ]);
  assert.deepEqual(
    candidates.map((c) => [c.kind, c.precision]),
    [
      ["repetition", "segment"],
      ["filler", "segment"],
    ],
  );
  assert.match(candidates[0]!.reason, /强调或识别错误/);
});
test("one spoken selection spanning two picture clips removes matching sources on each side", () => {
  const project = fixture();
  project.clips = [
    { id: "a", assetId: "talk", inFrame: 0, outFrame: 150, volume: 1 },
    { id: "b", assetId: "talk", inFrame: 300, outFrame: 450, volume: 1 },
  ];
  project.audioClips = [
    { id: "narration", assetId: "music", inFrame: 0, outFrame: 300, startFrame: 0, volume: 1 },
  ];
  const candidates = findSpokenCandidates(project, [
    { assetId: "music", silence: [{ start: 4, end: 6 }] },
  ]);
  const plan = buildSpokenEditPlan(project, candidates, [candidates[0]!.id]);
  const next = applyOperations(project, plan.operations, project.revision);
  assert.deepEqual(
    next.clips.map((c) => [c.inFrame, c.outFrame]),
    [
      [0, 125],
      [325, 450],
    ],
  );
  assert.equal(timelineDuration(next), 250);
});

test("leading and trailing detector silence trims cleanly without creating tiny silent fragments", () => {
  const project = fixture();
  const candidates = findSpokenCandidates(project, [
    {
      assetId: "talk",
      silence: [
        { start: 0, end: 3 },
        { start: 9, end: 12 },
      ],
    },
  ]);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((candidate) => candidate.actionable));
  const plan = buildSpokenEditPlan(
    project,
    candidates,
    candidates.map((candidate) => candidate.id),
  );
  const next = applyOperations(project, plan.operations, project.revision);
  assert.deepEqual(
    next.clips.map((clip) => [clip.inFrame, clip.outFrame]),
    [[85, 275]],
  );
});
