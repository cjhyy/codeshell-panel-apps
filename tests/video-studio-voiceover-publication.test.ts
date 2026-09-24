import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProject,
  validateProject,
  type Asset,
  type AudioClip,
  type Project,
} from "../apps/video-studio/src/model.ts";
import type { AssetPublication } from "../apps/video-studio/src/production.ts";
import { publishProductionAssets } from "../apps/video-studio/src/voiceover.ts";

const original: AudioClip = {
  id: "original-voice",
  assetId: "old-speech",
  inFrame: 10,
  outFrame: 100,
  startFrame: 60,
  volume: 0.35,
};
const bed: AudioClip = {
  id: "music-bed",
  assetId: "music",
  inFrame: 0,
  outFrame: 300,
  startFrame: 0,
  volume: 0.2,
};
function project(): Project {
  return validateProject({
    ...createProject("配音改稿"),
    revision: 7,
    assets: [
      { id: "picture", name: "画面", kind: "image", durationFrames: 300 },
      { id: "old-speech", name: "原配音", kind: "audio", durationFrames: 200 },
      { id: "music", name: "音乐", kind: "audio", durationFrames: 300 },
    ],
    clips: [{ id: "picture-clip", assetId: "picture", inFrame: 0, outFrame: 300, volume: 1 }],
    audioClips: [bed, original],
  });
}
function generated(durationFrames = 150): Asset {
  return { id: "new-speech", name: "修改文案后的配音", kind: "audio", durationFrames };
}
function options(): AssetPublication {
  return {
    audioPlacement: {
      clipId: "voice-job-new",
      assetId: "new-speech",
      startFrame: 60,
      volume: 0.35,
    },
  };
}

// In-place replacement of an existing voice belongs to the editor document; see
// video-studio-editor-voiceover-publication.test.ts. This legacy path only adds new speech.
test("new speech is one atomic revision that keeps the current project and prior sources intact", () => {
  const before = project(),
    saved = structuredClone(before),
    request = options();
  const publication = publishProductionAssets(before, [generated()], request);
  const next = publication.project!;
  assert.equal(next.revision, 8);
  assert.deepEqual(before, saved, "publication must not mutate the current project");
  assert.deepEqual(next.audioClips, [
    bed,
    original,
    {
      id: "voice-job-new",
      assetId: "new-speech",
      inFrame: 0,
      outFrame: 150,
      startFrame: 60,
      volume: 0.35,
    },
  ]);
  assert.equal(
    next.assets.some((asset) => asset.id === "old-speech"),
    true,
    "the previous source remains available for reuse/history",
  );
  assert.match(publication.notice!, /已加入/);
});

test("long speech retains its full source and reports the actual visual tail limit", () => {
  const publication = publishProductionAssets(project(), [generated(400)], options());
  const next = publication.project!;
  assert.equal(next.assets.find((asset) => asset.id === "new-speech")!.durationFrames, 400);
  assert.equal(next.audioClips!.length, 3);
  assert.deepEqual(next.audioClips![2], {
    id: "voice-job-new",
    assetId: "new-speech",
    inFrame: 0,
    outFrame: 240,
    startFrame: 60,
    volume: 0.35,
  });
  assert.match(publication.notice!, /13\.3 秒.*画面只剩 8\.0 秒.*句尾/);
});

test("completed placement replay is idempotent and preserves subsequent user edits or deletion", () => {
  const first = publishProductionAssets(project(), [generated()], options()).project!;
  assert.deepEqual(publishProductionAssets(first, [generated()], options()), { project: null });
  const edited = structuredClone(first);
  Object.assign(edited.audioClips![2]!, {
    startFrame: 90,
    inFrame: 20,
    outFrame: 100,
    volume: 0.8,
  });
  edited.revision++;
  assert.deepEqual(publishProductionAssets(edited, [generated()], options()), { project: null });
  assert.deepEqual(edited.audioClips![2], {
    id: "voice-job-new",
    assetId: "new-speech",
    startFrame: 90,
    inFrame: 20,
    outFrame: 100,
    volume: 0.8,
  });
});

test("empty pictures retain the full source only", () => {
  const request = options();
  request.audioPlacement!.startFrame = 0;
  request.audioPlacement!.volume = 1;
  const empty = publishProductionAssets(createProject(), [generated()], request);
  assert.deepEqual(empty.project!.audioClips, []);
  assert.equal(empty.project!.assets[0]!.durationFrames, 150);
  assert.match(empty.notice!, /先添加或延长画面/);
});

test("invalid results fail atomically", () => {
  const before = project(),
    saved = structuredClone(before);
  for (const asset of [{ ...generated(), kind: "image" as const }, generated(0)])
    assert.throws(
      () => publishProductionAssets(before, [asset], options()),
      /配音素材|素材时长|片段出点/,
    );
  assert.deepEqual(before, saved);
});
