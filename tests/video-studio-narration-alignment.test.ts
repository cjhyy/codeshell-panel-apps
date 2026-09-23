import assert from "node:assert/strict";
import { test } from "node:test";
import { createProject, validateProject, type Project } from "../apps/video-studio/src/model.ts";
import { buildNarrationAlignment } from "../apps/video-studio/src/narration-alignment.ts";

function fixture(durationFrames = 300): Project {
  return validateProject({
    ...createProject("先剪草稿，再录本人声音"),
    revision: 7,
    script: "这是已经确认的草稿文案。",
    assets: [
      { id: "picture", name: "实拍镜头", kind: "video", durationFrames: 900 },
      { id: "recording", name: "本人录音", kind: "audio", durationFrames: 360 },
      { id: "music", name: "配乐", kind: "audio", durationFrames: 900 },
    ],
    clips: [
      { id: "picture-1", assetId: "picture", inFrame: 0, outFrame: durationFrames, volume: 0 },
    ],
    audioClips: [
      {
        id: "voice-1",
        assetId: "recording",
        inFrame: 0,
        outFrame: Math.min(durationFrames, 360),
        startFrame: 0,
        volume: 1,
      },
    ],
    captions: [
      { id: "title", startFrame: 0, endFrame: 30, text: "我的旅行" },
      { id: "draft-1", startFrame: 0, endFrame: 150, text: "临时文案字幕" },
      { id: "unowned", startFrame: 180, endFrame: 210, text: "地点标注" },
    ],
    narration: {
      phase: "recorded",
      captionBasis: "draft",
      draftCaptionIds: ["draft-1"],
      approvedScript: "这是已经确认的草稿文案。",
      approvedFingerprint: "a".repeat(64),
      recordingAssetId: "recording",
    },
  });
}
const realSegments = [
  { start: 0.25, end: 4.5, text: "这是我实际录下的开场。" },
  { start: 10, end: 12, text: "这句结尾比草稿多了两秒。" },
];
const recordedCaptions = (project: Project) =>
  project.captions.filter((caption) => caption.id.startsWith("recorded-narration-"));

test("a 10 second draft cannot silently truncate the final sentence of a 12 second recording", () => {
  const before = fixture(),
    frozen = structuredClone(before);
  assert.throws(() => buildNarrationAlignment(before, realSegments), /未完整保留.*补足画面和音轨/);
  assert.deepEqual(before, frozen);

  const extended = structuredClone(before);
  extended.clips.push({
    id: "picture-2",
    assetId: "picture",
    inFrame: 300,
    outFrame: 360,
    volume: 0,
  });
  extended.audioClips![0]!.outFrame = 360;
  const next = buildNarrationAlignment(extended, realSegments);
  assert.deepEqual(
    recordedCaptions(next).map(({ startFrame, endFrame, text }) => ({
      startFrame,
      endFrame,
      text,
    })),
    [
      { startFrame: 7, endFrame: 135, text: realSegments[0]!.text },
      { startFrame: 300, endFrame: 360, text: realSegments[1]!.text },
    ],
  );
  assert.equal(
    next.captions.some((caption) => caption.id === "draft-1"),
    false,
  );
  assert.deepEqual(next.clips, extended.clips);
  assert.deepEqual(next.audioClips, extended.audioClips);
  assert.deepEqual(next.assets, extended.assets);
  assert.deepEqual(next.narration, extended.narration);
  assert.equal(next.script, extended.script);
  assert.equal(next.revision, extended.revision);
});

test("silent tracks, unrelated tracks and main picture audio never stand in for independent narration", () => {
  const muted = fixture(360);
  muted.audioClips![0]!.volume = 0;
  assert.throws(() => buildNarrationAlignment(muted, realSegments), /独立音轨并开启声音/);
  const unrelated = fixture(360);
  unrelated.audioClips![0]!.assetId = "music";
  assert.throws(() => buildNarrationAlignment(unrelated, realSegments), /独立音轨并开启声音/);
  const pictureOnly = fixture(360);
  pictureOnly.assets.find((asset) => asset.id === "recording")!.kind = "video";
  pictureOnly.clips[0]!.assetId = "recording";
  pictureOnly.clips[0]!.volume = 1;
  pictureOnly.audioClips = [];
  assert.throws(() => buildNarrationAlignment(pictureOnly, realSegments), /独立音轨并开启声音/);
});

test("the same retained source range maps separately into every audible timeline instance", () => {
  const before = fixture();
  before.audioClips = [
    { id: "later", assetId: "recording", inFrame: 30, outFrame: 90, startFrame: 180, volume: 0.7 },
    { id: "earlier", assetId: "recording", inFrame: 30, outFrame: 90, startFrame: 60, volume: 1 },
    { id: "muted", assetId: "recording", inFrame: 30, outFrame: 90, startFrame: 0, volume: 0 },
  ];
  const segments = [{ start: 1.2, end: 2.4, text: "同一段录音，在两处使用。" }];
  const next = buildNarrationAlignment(before, segments);
  assert.deepEqual(
    recordedCaptions(next).map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    [
      [66, 102],
      [186, 222],
    ],
  );
  assert.equal(new Set(recordedCaptions(next).map((caption) => caption.id)).size, 2);
  const reordered = { ...before, audioClips: [...before.audioClips].reverse() };
  assert.deepEqual(
    recordedCaptions(buildNarrationAlignment(reordered, segments)),
    recordedCaptions(next),
  );
});

test("silence may be trimmed, but an omitted spoken retake or a gap inside speech must be retained first", () => {
  const before = fixture();
  before.audioClips = [
    { id: "first", assetId: "recording", inFrame: 30, outFrame: 90, startFrame: 0, volume: 1 },
    { id: "second", assetId: "recording", inFrame: 150, outFrame: 210, startFrame: 60, volume: 1 },
  ];
  const segments = [
    { start: 1.5, end: 2.5, text: "开场" },
    { start: 5, end: 7, text: "重说一次的结尾" },
  ];
  const next = buildNarrationAlignment(before, segments);
  assert.deepEqual(
    recordedCaptions(next).map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    [
      [15, 45],
      [60, 120],
    ],
  );
  assert.throws(
    () =>
      buildNarrationAlignment(before, [
        ...segments,
        { start: 3.5, end: 4.5, text: "中间说过的内容" },
      ]),
    /未完整保留/,
  );
  assert.throws(
    () => buildNarrationAlignment(before, [{ start: 2, end: 6, text: "横跨剪切处的说话内容" }]),
    /未完整保留/,
  );
});

test("only owned draft and prior generated narration captions are replaced, with idempotent replay", () => {
  const before = fixture(360);
  before.captions.push({
    id: "recorded-narration-old",
    startFrame: 0,
    endFrame: 30,
    text: "之前的正式字幕",
  });
  const frozen = structuredClone(before);
  const next = buildNarrationAlignment(before, realSegments);
  assert.deepEqual(
    next.captions.filter((caption) => !caption.id.startsWith("recorded-narration-")),
    before.captions.filter((caption) => ["title", "unowned"].includes(caption.id)),
  );
  assert.deepEqual(buildNarrationAlignment(next, realSegments), next);
  assert.deepEqual(before, frozen);
});

test("ASR ending at most one frame past measured duration clamps to the actual final frame", () => {
  const before = fixture(360);
  const next = buildNarrationAlignment(before, [{ start: 11, end: 12 + 1 / 30, text: "最后一句" }]);
  assert.equal(recordedCaptions(next)[0]!.endFrame, 360);
  assert.throws(
    () => buildNarrationAlignment(before, [{ start: 11, end: 12.04, text: "超出真实时长" }]),
    /真实时间无效/,
  );
});

test("missing, malformed or fabricated transcript timing is rejected without script-based fallback", () => {
  const before = fixture(360);
  for (const segments of [
    [],
    [{ start: 1, end: 1, text: "零时长" }],
    [{ start: -0.1, end: 1, text: "负数时间" }],
    [{ start: Number.NaN, end: 1, text: "非数字" }],
    [{ start: 0, end: Number.POSITIVE_INFINITY, text: "无穷大" }],
    [{ start: 0, end: 1, text: " " }],
    [{ start: 0, end: 1, text: "坏\u0000文字" }],
    [{ start: 12, end: 12.01, text: "素材之外" }],
  ])
    assert.throws(() => buildNarrationAlignment(before, segments), /真实转写|真实时间无效/);
});

test("foreign, missing, visual-only and synthesized recording assets cannot authorize narration captions", () => {
  for (const assetId of [undefined, "foreign"]) {
    const before = fixture(360);
    before.narration!.recordingAssetId = assetId;
    assert.throws(() => buildNarrationAlignment(before, realSegments), /本人录音/);
  }
  const visual = fixture(360);
  visual.assets.find((asset) => asset.id === "recording")!.kind = "image";
  assert.throws(() => buildNarrationAlignment(visual, realSegments), /本人录音/);
  const tts = fixture(360);
  tts.assets.find((asset) => asset.id === "recording")!.speech = {
    text: "合成",
    voiceId: "voice",
    engine: "tts",
    rate: 1,
  };
  assert.throws(() => buildNarrationAlignment(tts, realSegments), /合成配音/);
});

test("a draft caption already deleted in the caption panel does not block recorded alignment", () => {
  const before = fixture(360);
  before.captions = before.captions.filter((caption) => caption.id !== "draft-1");
  assert.deepEqual(before.narration!.draftCaptionIds, ["draft-1"]);
  const next = buildNarrationAlignment(validateProject(before), [realSegments[0]!]);
  assert.deepEqual(next.captions.map((caption) => caption.id).sort(), [
    "recorded-narration-1-1",
    "title",
    "unowned",
  ]);
  assert.equal(recordedCaptions(next).length, 1);
  assert.deepEqual(
    next.captions.filter((caption) => !caption.id.startsWith("recorded-narration-")),
    before.captions,
  );
});
