import assert from "node:assert/strict";
import { test } from "node:test";
import { createProject, validateProject, type Project } from "../apps/video-studio/src/model";
import { planNarrationAlignment } from "../apps/video-studio/src/editor/narration-edits";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import type { EditorDocument, TextClip } from "../apps/video-studio/src/editor/types";

// Ported from the old frame-based alignment: the same projects, now aligned on the editor
// document. Times are exact ticks (1/240000 s); one old frame is 8000 ticks.
const F = 8000;
function legacy(durationFrames = 300): Project {
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
const fixture = (durationFrames = 300) => migrateLegacyProject(legacy(durationFrames));
const align = (doc: EditorDocument, segments: { start: number; end: number; text: string }[]) =>
  applyEditorOperations(
    doc,
    planNarrationAlignment(doc, doc.activeSequenceId, segments).operations,
    doc.revision,
  );
const subtitles = (doc: EditorDocument) =>
  doc.sequences[0]!.clips
    .filter((clip): clip is TextClip => clip.kind === "text" && clip.role === "subtitle")
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
const recordedCaptions = (doc: EditorDocument) =>
  subtitles(doc).filter((caption) => caption.id.startsWith("recorded-narration-"));
const media = (doc: EditorDocument) => doc.sequences[0]!.clips.filter((clip) => clip.kind === "media");
const realSegments = [
  { start: 0.25, end: 4.5, text: "这是我实际录下的开场。" },
  { start: 10, end: 12, text: "这句结尾比草稿多了两秒。" },
];

test("a 10 second draft cannot silently truncate the final sentence of a 12 second recording", () => {
  const before = fixture(),
    frozen = structuredClone(before);
  assert.throws(() => align(before, realSegments), /未完整保留.*补足画面和音轨/);
  assert.deepEqual(before, frozen);

  const project = legacy();
  project.clips.push({ id: "picture-2", assetId: "picture", inFrame: 300, outFrame: 360, volume: 0 });
  project.audioClips![0]!.outFrame = 360;
  const extended = migrateLegacyProject(project);
  const next = align(extended, realSegments);
  assert.deepEqual(
    recordedCaptions(next).map(({ start, duration, text }) => ({ start, end: start + duration, text })),
    [
      { start: 60_000, end: 135 * F, text: realSegments[0]!.text },
      { start: 300 * F, end: 360 * F, text: realSegments[1]!.text },
    ],
  );
  assert.equal(
    subtitles(next).some((caption) => caption.text === "临时文案字幕"),
    false,
  );
  assert.deepEqual(media(next), media(extended));
  assert.deepEqual(next.assets, extended.assets);
  assert.deepEqual(next.production, extended.production);
});

test("silent tracks, unrelated tracks and main picture audio never stand in for independent narration", () => {
  const muted = legacy(360);
  muted.audioClips![0]!.volume = 0;
  assert.throws(() => align(migrateLegacyProject(muted), realSegments), /独立音轨并开启声音/);
  const unrelated = legacy(360);
  unrelated.audioClips![0]!.assetId = "music";
  assert.throws(() => align(migrateLegacyProject(unrelated), realSegments), /独立音轨并开启声音/);
  const pictureOnly = legacy(360);
  pictureOnly.assets.find((asset) => asset.id === "recording")!.kind = "video";
  pictureOnly.clips[0]!.assetId = "recording";
  pictureOnly.clips[0]!.volume = 1;
  pictureOnly.audioClips = [];
  assert.throws(() => align(migrateLegacyProject(pictureOnly), realSegments), /独立音轨并开启声音/);
});

test("the same retained source range maps separately into every audible timeline instance", () => {
  const project = legacy();
  project.audioClips = [
    { id: "later", assetId: "recording", inFrame: 30, outFrame: 90, startFrame: 180, volume: 0.7 },
    { id: "earlier", assetId: "recording", inFrame: 30, outFrame: 90, startFrame: 60, volume: 1 },
    { id: "muted", assetId: "recording", inFrame: 30, outFrame: 90, startFrame: 0, volume: 0 },
  ];
  const segments = [{ start: 1.2, end: 2.4, text: "同一段录音，在两处使用。" }];
  const next = align(migrateLegacyProject(project), segments);
  assert.deepEqual(
    recordedCaptions(next).map(({ start, duration }) => [start / F, (start + duration) / F]),
    [
      [66, 102],
      [186, 222],
    ],
  );
  assert.equal(new Set(recordedCaptions(next).map((caption) => caption.id)).size, 2);
  const reordered = { ...project, audioClips: [...project.audioClips].reverse() };
  assert.deepEqual(
    recordedCaptions(align(migrateLegacyProject(reordered), segments)),
    recordedCaptions(next),
  );
});

test("silence may be trimmed, but an omitted spoken retake or a gap inside speech must be retained first", () => {
  const project = legacy();
  project.audioClips = [
    { id: "first", assetId: "recording", inFrame: 30, outFrame: 90, startFrame: 0, volume: 1 },
    { id: "second", assetId: "recording", inFrame: 150, outFrame: 210, startFrame: 60, volume: 1 },
  ];
  const before = migrateLegacyProject(project);
  const segments = [
    { start: 1.5, end: 2.5, text: "开场" },
    { start: 5, end: 7, text: "重说一次的结尾" },
  ];
  const next = align(before, segments);
  assert.deepEqual(
    recordedCaptions(next).map(({ start, duration }) => [start / F, (start + duration) / F]),
    [
      [15, 45],
      [60, 120],
    ],
  );
  assert.throws(
    () => align(before, [...segments, { start: 3.5, end: 4.5, text: "中间说过的内容" }]),
    /未完整保留/,
  );
  assert.throws(
    () => align(before, [{ start: 2, end: 6, text: "横跨剪切处的说话内容" }]),
    /未完整保留/,
  );
});

test("only owned draft and prior generated narration captions are replaced, with idempotent replay", () => {
  const project = legacy(360);
  project.captions.push({
    id: "recorded-narration-old",
    startFrame: 0,
    endFrame: 30,
    text: "之前的正式字幕",
  });
  const before = migrateLegacyProject(project),
    frozen = structuredClone(before);
  const next = align(before, realSegments);
  assert.deepEqual(
    subtitles(next).filter((caption) => !caption.id.startsWith("recorded-narration-")),
    subtitles(before).filter((caption) => ["title", "unowned"].includes(caption.id)),
  );
  assert.deepEqual(subtitles(align(next, realSegments)), subtitles(next));
  assert.deepEqual(before, frozen);
});

test("ASR ending at most one frame past measured duration clamps to the actual final frame", () => {
  const before = fixture(360);
  const next = align(before, [{ start: 11, end: 12 + 1 / 30, text: "最后一句" }]);
  const [caption] = recordedCaptions(next);
  assert.equal(caption!.start + caption!.duration, 360 * F);
  assert.throws(
    () => align(before, [{ start: 11, end: 12.04, text: "超出真实时长" }]),
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
    assert.throws(() => align(before, segments), /真实转写|真实时间无效/);
});

test("foreign, missing, visual-only and synthesized recording assets cannot authorize narration captions", () => {
  const narration = (doc: EditorDocument) => doc.production!.narration as Record<string, unknown>;
  for (const assetId of [undefined, "foreign"]) {
    const before = fixture(360);
    if (assetId) narration(before).recordingAssetId = assetId;
    else delete narration(before).recordingAssetId;
    assert.throws(() => align(before, realSegments), /本人录音/);
  }
  const visual = legacy(360);
  visual.assets.push({ id: "still", name: "静帧", kind: "image", durationFrames: 150, width: 4, height: 4 });
  const still = migrateLegacyProject(visual);
  narration(still).recordingAssetId = "still";
  assert.throws(() => align(still, realSegments), /本人录音/);
  const tts = fixture(360);
  tts.assets.find((asset) => asset.id === "recording")!.metadata = {
    speech: { text: "合成", voiceId: "voice", engine: "tts", rate: 1 },
  };
  assert.throws(() => align(tts, realSegments), /合成配音/);
});

test("a draft caption already deleted in the caption panel does not block recorded alignment", () => {
  const project = legacy(360);
  project.captions = project.captions.filter((caption) => caption.id !== "draft-1");
  const before = migrateLegacyProject(project);
  assert.deepEqual((before.production!.narration as { draftCaptionIds: string[] }).draftCaptionIds, [
    "draft-1",
  ]);
  const next = align(before, [realSegments[0]!]);
  assert.deepEqual(subtitles(next).map((caption) => caption.id).sort(), [
    "recorded-narration-1-1",
    "title",
    "unowned",
  ]);
  assert.equal(recordedCaptions(next).length, 1);
  assert.deepEqual(
    subtitles(next).filter((caption) => !caption.id.startsWith("recorded-narration-")),
    subtitles(before),
  );
});
