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
      startFrame: 0,
      volume: 1,
      replaceClip: structuredClone(original),
    },
  };
}

test("regenerating selected speech replaces one clip atomically and preserves its position and gain", () => {
  const before = project(),
    saved = structuredClone(before),
    request = options();
  const publication = publishProductionAssets(before, [generated()], request);
  const next = publication.project!;
  assert.equal(next.revision, 8);
  assert.deepEqual(before, saved, "publication must not mutate the current project");
  assert.deepEqual(
    request.audioPlacement!.replaceClip,
    original,
    "the captured target stays immutable",
  );
  assert.deepEqual(next.audioClips, [
    bed,
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
  assert.match(publication.notice!, /已替换.*位置和音量/);
});

test("long regenerated speech retains its full source and reports the actual visual tail limit", () => {
  const publication = publishProductionAssets(project(), [generated(400)], options());
  const next = publication.project!;
  assert.equal(next.assets.find((asset) => asset.id === "new-speech")!.durationFrames, 400);
  assert.equal(next.audioClips!.length, 2);
  assert.deepEqual(next.audioClips![1], {
    id: "voice-job-new",
    assetId: "new-speech",
    inFrame: 0,
    outFrame: 240,
    startFrame: 60,
    volume: 0.35,
  });
  assert.match(publication.notice!, /原配音已替换.*13\.3 秒.*画面只剩 8\.0 秒.*句尾/);
});

test("every independently edited snapshot field prevents a stale TTS result from replacing current audio", () => {
  const edits: Partial<AudioClip>[] = [
    { id: "renamed-clip" },
    { assetId: "music" },
    { inFrame: 11 },
    { outFrame: 110 },
    { startFrame: 90 },
    { volume: 0.7 },
  ];
  for (const edit of edits) {
    const current = project();
    Object.assign(current.audioClips![1]!, edit);
    const valid = validateProject(current),
      priorAudio = structuredClone(valid.audioClips);
    const publication = publishProductionAssets(valid, [generated()], options());
    assert.deepEqual(publication.project!.audioClips, priorAudio, JSON.stringify(edit));
    assert.equal(
      publication.project!.assets.some((asset) => asset.id === "new-speech"),
      true,
    );
    assert.match(publication.notice!, /已被修改或删除.*保留在素材库.*未替换/);
    assert.equal(publication.project!.revision, valid.revision + 1);
  }
});

test("deleted target and concurrent second regeneration publish sources without overlaying another voice", () => {
  const removed = project();
  removed.audioClips = [bed];
  const deletion = publishProductionAssets(removed, [generated()], options());
  assert.deepEqual(deletion.project!.audioClips, [bed]);
  assert.match(deletion.notice!, /未替换/);

  const first = publishProductionAssets(project(), [generated()], options()).project!;
  const second = publishProductionAssets(first, [{ ...generated(), id: "new-speech-2" }], {
    audioPlacement: {
      ...options().audioPlacement!,
      clipId: "voice-job-second",
      assetId: "new-speech-2",
    },
  });
  assert.deepEqual(second.project!.audioClips, first.audioClips);
  assert.equal(
    second.project!.assets.filter((asset) => asset.id.startsWith("new-speech")).length,
    2,
  );
  assert.match(second.notice!, /未替换/);
});

test("completed replacement replay is idempotent and preserves subsequent user edits or deletion", () => {
  const first = publishProductionAssets(project(), [generated()], options()).project!;
  assert.deepEqual(publishProductionAssets(first, [generated()], options()), { project: null });
  const edited = structuredClone(first);
  Object.assign(edited.audioClips![1]!, {
    startFrame: 90,
    inFrame: 20,
    outFrame: 100,
    volume: 0.8,
  });
  edited.revision++;
  assert.deepEqual(publishProductionAssets(edited, [generated()], options()), { project: null });
  assert.deepEqual(edited.audioClips![1], {
    id: "voice-job-new",
    assetId: "new-speech",
    startFrame: 90,
    inFrame: 20,
    outFrame: 100,
    volume: 0.8,
  });
  edited.audioClips = [bed];
  assert.deepEqual(publishProductionAssets(edited, [generated()], options()), { project: null });
  assert.deepEqual(edited.audioClips, [bed]);
});

test("ordinary new speech still adds one audio clip and empty pictures retain the full source only", () => {
  const request = options();
  delete request.audioPlacement!.replaceClip;
  const first = publishProductionAssets(project(), [generated()], request);
  assert.equal(first.project!.audioClips!.length, 3);
  assert.deepEqual(first.project!.audioClips!.at(-1), {
    id: "voice-job-new",
    assetId: "new-speech",
    inFrame: 0,
    outFrame: 150,
    startFrame: 0,
    volume: 1,
  });
  assert.match(first.notice!, /已加入/);
  assert.deepEqual(publishProductionAssets(first.project!, [generated()], request), {
    project: null,
  });
  const empty = publishProductionAssets(createProject(), [generated()], request);
  assert.deepEqual(empty.project!.audioClips, []);
  assert.equal(empty.project!.assets[0]!.durationFrames, 150);
  assert.match(empty.notice!, /先添加或延长画面/);
});

test("invalid replacement results fail atomically and require a distinct job result identity", () => {
  const before = project(),
    saved = structuredClone(before);
  const sameId = options();
  sameId.audioPlacement!.clipId = original.id;
  assert.throws(() => publishProductionAssets(before, [generated()], sameId), /独立的结果编号/);
  for (const asset of [{ ...generated(), kind: "image" as const }, generated(0)])
    assert.throws(
      () => publishProductionAssets(before, [asset], options()),
      /配音素材|素材时长|片段出点/,
    );
  assert.deepEqual(before, saved);
});
