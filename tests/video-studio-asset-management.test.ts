import assert from "node:assert/strict";
import test from "node:test";
import { assetRemovalUsage, removeAssets } from "../apps/video-studio/src/asset-management";
import {
  createDemoProject,
  createProject,
  validateProject,
  type Project,
} from "../apps/video-studio/src/model";
import { narrationFingerprint } from "../apps/video-studio/src/narration";

/** An approval as older versions saved it: a SHA-256 of the 30 fps compatibility view. */
async function legacyApprove(project: Project, recordingAssetId?: string): Promise<Project> {
  const next = validateProject(structuredClone(project));
  next.narration = {
    ...next.narration!,
    phase: recordingAssetId ? "recorded" : "approved",
    captionBasis: "draft",
    approvedScript: next.script!,
    approvedFingerprint: await narrationFingerprint(next),
    ...(recordingAssetId ? { recordingAssetId } : {}),
  };
  return validateProject(next);
}
/** The old-basis approval check on this compatibility module's own project data. */
async function hasNarrationApproval(project: Project): Promise<boolean> {
  const state = project.narration;
  if (
    !state?.approvedFingerprint ||
    !["approved", "recorded", "aligned"].includes(state.phase) ||
    state.approvedScript !== project.script
  )
    return false;
  const expected =
    state.phase !== "approved" && state.alignmentFingerprint
      ? state.alignmentFingerprint
      : state.approvedFingerprint;
  return expected === (await narrationFingerprint(project));
}

function fixture(): Project {
  const project = createProject("素材删除测试");
  project.assets = ["a", "b", "c"].map((id) => ({
    id,
    name: `${id}.mp4`,
    kind: "video",
    durationFrames: 90,
    mediaId: `external-${id.repeat(64)}`,
  }));
  project.assets.push(
    { id: "music", name: "音乐", kind: "audio", durationFrames: 300 },
    { id: "voice", name: "本人录音", kind: "audio", durationFrames: 180 },
    { id: "unused", name: "未使用图片", kind: "image", durationFrames: 150 },
  );
  project.clips = ["a", "b", "c"].map((assetId) => ({
    id: `clip-${assetId}`,
    assetId,
    inFrame: 0,
    outFrame: 90,
    volume: 1,
  }));
  project.audioClips = [
    { id: "music-track", assetId: "music", inFrame: 10, outFrame: 280, startFrame: 0, volume: 0.5 },
    { id: "voice-track", assetId: "voice", inFrame: 30, outFrame: 60, startFrame: 120, volume: 1 },
  ];
  project.captions = [
    { id: "before", startFrame: 0, endFrame: 30, text: "前段" },
    { id: "removed", startFrame: 100, endFrame: 150, text: "中段" },
    { id: "spanning", startFrame: 60, endFrame: 210, text: "横跨删除区间" },
    { id: "after", startFrame: 210, endFrame: 270, text: "后段" },
  ];
  project.roughCuts = ["b", "c"].map((assetId) => ({
    id: `rough-${assetId}`,
    assetId,
    inFrame: 10,
    outFrame: 70,
    name: "保留",
    enabled: true,
  }));
  project.workflow = {
    stage: "rough-cut",
    brief: "讲好故事",
    outline: "先后顺序",
    nextSteps: ["审阅"],
    blockers: [],
    sources: ["b", "c"].map((assetId) => ({ assetId, role: "main", note: "原片" })),
  };
  return validateProject(project);
}

test("demo assets can be deleted individually or together without changing the original project", () => {
  const before = createDemoProject();
  const snapshot = structuredClone(before);
  const removed = removeAssets(before, [before.assets[0]!.id]);
  assert.equal(removed.assets.length, 2);
  assert.equal(removed.clips.length, 2);
  assert.equal(removed.revision, before.revision + 1);
  assert.deepEqual(before, snapshot);
  const empty = removeAssets(
    before,
    before.assets.map((asset) => asset.id),
  );
  assert.deepEqual(empty.assets, []);
  assert.deepEqual(empty.clips, []);
  assert.deepEqual(empty.audioClips, []);
  assert.deepEqual(empty.captions, []);
  assert.equal(empty.revision, before.revision + 1);
  assert.deepEqual(validateProject(empty), empty);
});

test("deleting a used original ripples subtitles and surviving audio source offsets together", () => {
  const before = fixture();
  const snapshot = structuredClone(before);
  const next = removeAssets(before, ["b"]);
  assert.deepEqual(
    next.clips.map((clip) => clip.assetId),
    ["a", "c"],
  );
  assert.deepEqual(next.captions, [
    { id: "before", startFrame: 0, endFrame: 30, text: "前段" },
    { id: "spanning", startFrame: 60, endFrame: 120, text: "横跨删除区间" },
    { id: "after", startFrame: 120, endFrame: 180, text: "后段" },
  ]);
  assert.deepEqual(
    next.audioClips!.map(({ assetId, inFrame, outFrame, startFrame }) => ({
      assetId,
      inFrame,
      outFrame,
      startFrame,
    })),
    [
      { assetId: "music", inFrame: 10, outFrame: 100, startFrame: 0 },
      { assetId: "music", inFrame: 190, outFrame: 280, startFrame: 90 },
    ],
  );
  assert.deepEqual(
    next.roughCuts!.map((cut) => cut.assetId),
    ["c"],
  );
  assert.deepEqual(
    next.workflow!.sources.map((source) => source.assetId),
    ["c"],
  );
  assert.equal(next.workflow!.brief, before.workflow!.brief);
  assert.deepEqual(assetRemovalUsage(before, ["b"]), {
    assetIds: ["b"],
    assetCount: 1,
    clipCount: 1,
    audioClipCount: 0,
    roughCutCount: 1,
    removedFrames: 90,
    affectedCaptionCount: 3,
    affectedAudioClipCount: 2,
    workflowSourceCount: 1,
    narrationRecording: false,
    used: true,
  });
  assert.equal(
    next.assets.find((asset) => asset.id === "a")!.mediaId,
    `external-${"a".repeat(64)}`,
  );
  assert.deepEqual(before, snapshot);
  assert.deepEqual(validateProject(next), next);
});

test("batch removal is one revision and removes both picture and direct audio references", () => {
  const before = fixture();
  const next = removeAssets(before, ["b", "voice", "b", "unused"]);
  assert.equal(next.revision, before.revision + 1);
  assert.deepEqual(
    next.assets.map((asset) => asset.id),
    ["a", "c", "music"],
  );
  assert.ok(next.audioClips!.every((clip) => clip.assetId === "music"));
  assert.equal(assetRemovalUsage(before, ["b", "voice", "b", "unused"]).assetCount, 3);
  assert.equal(assetRemovalUsage(before, ["b", "voice"]).audioClipCount, 1);
  assert.equal(before.assets.length, 6);
  const unused = removeAssets(before, ["unused"]);
  assert.deepEqual(unused.clips, before.clips);
  assert.deepEqual(unused.audioClips, before.audioClips);
  assert.deepEqual(unused.captions, before.captions);
  assert.equal(assetRemovalUsage(before, ["unused"]).used, false);
});

test("empty requests detach without a revision and invalid selections fail atomically", () => {
  const before = fixture();
  const snapshot = structuredClone(before);
  const next = removeAssets(before, []);
  assert.deepEqual(next, before);
  assert.notEqual(next, before);
  assert.notEqual(next.assets, before.assets);
  assert.equal(assetRemovalUsage(before, []).used, false);
  for (const ids of [["b", "unknown"], ["../b"], [null], new Array(1), Array(1001).fill("b"), null])
    assert.throws(() => removeAssets(before, ids as any));
  assert.deepEqual(before, snapshot);
});

test("deleting a narration recording clears its approval and owned captions, retaining script and other subtitles", async () => {
  const draft = fixture();
  draft.script = "保留我的文稿。";
  draft.captions.push({
    id: "recorded-narration-1",
    startFrame: 30,
    endFrame: 60,
    text: "本人真实字幕",
  });
  draft.narration = {
    phase: "review",
    captionBasis: "draft",
    draftCaptionIds: ["removed-draft-provenance"],
  };
  const recorded = await legacyApprove(draft, "voice");
  recorded.narration!.phase = "aligned";
  recorded.narration!.captionBasis = "recording";
  assert.equal(await hasNarrationApproval(recorded), true);
  const next = removeAssets(recorded, ["voice"]);
  assert.deepEqual(next.narration, {
    phase: "review",
    captionBasis: "draft",
    draftCaptionIds: ["removed-draft-provenance"],
  });
  assert.equal(next.script, recorded.script);
  assert.deepEqual(next.clips, recorded.clips);
  assert.deepEqual(
    next.captions,
    recorded.captions.filter((caption) => !caption.id.startsWith("recorded-narration-")),
  );
  assert.equal(await hasNarrationApproval(next), false);
  assert.equal(assetRemovalUsage(recorded, ["voice"]).narrationRecording, true);
  assert.equal(assetRemovalUsage(recorded, ["voice"]).affectedCaptionCount, 1);
  assert.deepEqual(validateProject(next), next);
});

test("unrelated unused assets retain narration approval while picture deletion requires review", async () => {
  const draft = fixture();
  draft.script = "口播文稿。";
  draft.narration = { phase: "review", captionBasis: "draft", draftCaptionIds: [] };
  const approved = await legacyApprove(draft);
  const unused = removeAssets(approved, ["unused"]);
  assert.deepEqual(unused.narration, approved.narration);
  assert.equal(await hasNarrationApproval(unused), true);
  const edited = removeAssets(approved, ["b"]);
  assert.equal(edited.narration!.phase, "review");
  assert.equal(await hasNarrationApproval(edited), false);
  const empty = removeAssets(approved, ["a", "b", "c"]);
  assert.equal(empty.narration!.phase, "draft");
  assert.deepEqual(validateProject(empty), empty);
});

test("one asset used by more than a protocol batch of clips can still be removed in one revision", () => {
  const before = createProject();
  before.assets = [{ id: "repeated", name: "反复使用的示例", kind: "demo", durationFrames: 1 }];
  before.clips = Array.from({ length: 1001 }, (_, index) => ({
    id: `clip-${index}`,
    assetId: "repeated",
    inFrame: 0,
    outFrame: 1,
    volume: 1,
  }));
  const next = removeAssets(before, ["repeated"]);
  assert.equal(next.revision, 1);
  assert.deepEqual(next.assets, []);
  assert.deepEqual(next.clips, []);
});
