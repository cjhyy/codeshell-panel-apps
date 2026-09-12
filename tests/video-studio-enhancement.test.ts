import assert from "node:assert/strict";
import { test } from "node:test";
import { createProject, validateProject, type Asset } from "../apps/video-studio/src/model.ts";
import { publishProductionAssets } from "../apps/video-studio/src/voiceover.ts";
const sourceMediaId = "asset-" + "c".repeat(64);
const result: Asset = { id: "enhanced", name: "优化原声", kind: "audio", durationFrames: 300 };
function fixture() {
  return validateProject({
    ...createProject(),
    revision: 4,
    assets: [
      {
        id: "source",
        name: "我的原片",
        kind: "video",
        durationFrames: 300,
        mediaId: sourceMediaId,
      },
    ],
    clips: [
      { id: "c1", assetId: "source", inFrame: 30, outFrame: 120, volume: 0.4 },
      { id: "c2", assetId: "source", inFrame: 180, outFrame: 270, volume: 1 },
    ],
  });
}
const options = {
  enhancement: { jobId: "job-test", assetId: "enhanced", sourceMediaId, baseRevision: 4 },
};
test("enhanced original audio aligns every trimmed occurrence and mutes original exactly once", () => {
  const before = fixture(),
    frozen = structuredClone(before);
  const next = publishProductionAssets(before, [result], options).project!;
  assert.deepEqual(before, frozen);
  assert.deepEqual(
    next.clips.map((c) => c.volume),
    [0, 0],
  );
  assert.deepEqual(
    next.audioClips?.map((c) => [c.inFrame, c.outFrame, c.startFrame, c.volume]),
    [
      [30, 120, 0, 0.4],
      [180, 270, 90, 1],
    ],
  );
  assert.ok(next.assets.some((a) => a.id === "source"));
  assert.equal(publishProductionAssets(next, [result], options).project, null);
  assert.equal(next.revision, 5);
});
test("concurrent edits preserve current original sound and save the enhanced source only", () => {
  const before = fixture();
  before.revision++;
  const { project: next, notice } = publishProductionAssets(before, [result], options);
  assert.deepEqual(next!.clips, before.clips);
  assert.deepEqual(next!.audioClips, []);
  assert.match(notice!, /工程在处理期间已修改/);
  assert.ok(next!.assets.some((a) => a.id === "enhanced"));
});
test("shortened processing output fails atomically without muting original audio", () => {
  const before = fixture();
  assert.throws(
    () => publishProductionAssets(before, [{ ...result, durationFrames: 50 }], options),
    /长度/,
  );
  assert.equal(before.clips[0]!.volume, 0.4);
});
test("polished script survives portable project roundtrip without altering recorded speech", () => {
  const before = fixture();
  const next = validateProject(
    JSON.parse(JSON.stringify({ ...before, script: "这是更自然的口播文稿。" })),
  );
  assert.equal(next.script, "这是更自然的口播文稿。");
  assert.deepEqual(next.clips, before.clips);
  assert.throws(() => validateProject({ ...before, script: "\u0000invalid" }));
});
