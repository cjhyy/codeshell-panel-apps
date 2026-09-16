import assert from "node:assert/strict";
import { test } from "node:test";
import { createProject, validateProject, type Project } from "../apps/video-studio/src/model";
import {
  captionSourceAssetIds,
  transcriptCaptions,
  type PreparedMedia,
  type ProductionController,
  type TranscriptSegment,
} from "../apps/video-studio/src/production";
import { createProductionUI } from "../apps/video-studio/src/production-ui";

const mediaId = (letter: string) => `asset-${letter.repeat(64)}`;
function project(changes: Partial<Project> = {}): Project {
  return validateProject({
    ...createProject(),
    assets: [
      { id: "video", name: "画面", kind: "video", durationFrames: 900, mediaId: mediaId("a") },
      { id: "voice", name: "旁白", kind: "audio", durationFrames: 600, mediaId: mediaId("b") },
      { id: "silent", name: "无声画面", kind: "video", durationFrames: 600, mediaId: mediaId("c") },
      { id: "image", name: "图片", kind: "image", durationFrames: 600, mediaId: mediaId("d") },
      { id: "local", name: "临时录音", kind: "audio", durationFrames: 600 },
    ],
    clips: [{ id: "picture", assetId: "video", inFrame: 0, outFrame: 600, volume: 0 }],
    audioClips: [
      { id: "narration", assetId: "voice", inFrame: 30, outFrame: 180, startFrame: 90, volume: 1 },
    ],
    ...changes,
  });
}

type TranscriptPage = { offset: number; total: number; segments: TranscriptSegment[] };
function session(
  initial: Project,
  transcript: (id: string, offset: number) => Promise<TranscriptPage>,
  enabled = true,
) {
  let current = initial;
  let commits = 0;
  const messages: string[] = [];
  const actions = createProductionUI(
    { enabled, preparations: new Map(), transcript } as unknown as ProductionController,
    {
      project: () => current,
      commit(next) {
        current = next;
        commits++;
      },
      replace: async (next) => {
        current = next;
      },
      restoreMedia: async () => {},
      toast: (message) => messages.push(message),
      render: () => {},
    },
  );
  return {
    actions,
    current: () => current,
    commits: () => commits,
    messages,
    change: (value: Project) => {
      current = value;
    },
  };
}
const page = (segments: TranscriptSegment[], offset = 0): TranscriptPage => ({
  offset,
  total: segments.length,
  segments,
});

test("caption sources include independent voice, skip muted, silent and temporary sources, and request repeated sources once", () => {
  const value = project({
    clips: [
      { id: "picture", assetId: "video", inFrame: 0, outFrame: 300, volume: 0 },
      { id: "silent-picture", assetId: "silent", inFrame: 0, outFrame: 150, volume: 1 },
      { id: "image-picture", assetId: "image", inFrame: 0, outFrame: 150, volume: 1 },
    ],
    audioClips: [
      { id: "voice-one", assetId: "voice", inFrame: 0, outFrame: 90, startFrame: 0, volume: 1 },
      {
        id: "voice-two",
        assetId: "voice",
        inFrame: 90,
        outFrame: 180,
        startFrame: 120,
        volume: 0.5,
      },
      { id: "temporary", assetId: "local", inFrame: 0, outFrame: 90, startFrame: 210, volume: 1 },
    ],
  });
  const preparations = new Map<string, PreparedMedia>([
    [mediaId("c"), { assetId: mediaId("c"), inspection: { kind: "video", durationSeconds: 20 } }],
  ]);
  assert.deepEqual(captionSourceAssetIds(value, preparations), ["voice"]);
});

test("subtitle placement preserves independent narration inside a free timeline gap and repeated source occurrences", () => {
  const value = project({
    timelineMode: "free",
    clips: [
      { id: "picture", assetId: "video", inFrame: 0, outFrame: 300, startFrame: 300, volume: 0 },
    ],
    audioClips: [
      { id: "first", assetId: "voice", inFrame: 30, outFrame: 90, startFrame: 90, volume: 1 },
      { id: "repeat", assetId: "voice", inFrame: 30, outFrame: 90, startFrame: 420, volume: 1 },
      { id: "muted", assetId: "voice", inFrame: 30, outFrame: 90, startFrame: 510, volume: 0 },
    ],
  });
  const result = transcriptCaptions(value, "voice", [{ start: 1, end: 3, text: "画面前的旁白" }]);
  assert.deepEqual(
    result.map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    [
      [90, 150],
      [420, 480],
    ],
  );
  assert.notEqual(result[0]!.id, result[1]!.id);
  assert.equal(
    transcriptCaptions(value, "video", [{ start: 0, end: 2, text: "已静音原声" }]).length,
    0,
  );
});

test("word-level captions exclude words outside trimmed audio instead of repeating the uncut sentence", () => {
  const value = project({
    audioClips: [
      { id: "voice", assetId: "voice", inFrame: 30, outFrame: 60, startFrame: 120, volume: 1 },
    ],
  });
  const result = transcriptCaptions(value, "voice", [
    {
      start: 0,
      end: 3,
      text: "删除保留删除",
      words: [
        { start: 0, end: 1, text: "删除" },
        { start: 1, end: 2, text: "保留" },
        { start: 2, end: 3, text: "删除" },
      ],
    },
  ]);
  assert.deepEqual(
    result.map(({ startFrame, endFrame, text }) => [startFrame, endFrame, text]),
    [[120, 150, "保留"]],
  );
  assert.deepEqual(
    transcriptCaptions(value, "voice", [
      {
        start: 0,
        end: 3,
        text: "静音里的完整句子",
        words: [{ start: 2, end: 3, text: "没有播放" }],
      },
    ]),
    [],
  );
});

test("subtitle generation requests independent voice without transcribing a muted source and stays idempotent", async () => {
  const calls: string[] = [];
  const transcript = [{ start: 1, end: 3, text: "独立旁白" }];
  const editor = session(project(), async (id) => {
    calls.push(id);
    return page(transcript);
  });
  await editor.actions.captionsFromTranscript();
  assert.deepEqual(calls, ["voice"]);
  assert.equal(editor.current().captions[0]!.startFrame, 90);
  const corrected = validateProject({
    ...editor.current(),
    captions: editor.current().captions.map((caption) => ({ ...caption, text: "校对后的旁白" })),
  });
  editor.change(corrected);
  await editor.actions.captionsFromTranscript();
  assert.equal(editor.commits(), 1);
  assert.equal(editor.current(), corrected);
  assert.equal(editor.current().captions[0]!.text, "校对后的旁白");
  assert.match(editor.messages.at(-1)!, /保留已校对/);
});

test("regeneration updates a moved narration caption time while retaining corrected text and manual titles", async () => {
  const editor = session(project(), async () => page([{ start: 1, end: 3, text: "原识别" }]));
  await editor.actions.captionsFromTranscript();
  editor.change(
    validateProject({
      ...editor.current(),
      audioClips: editor.current().audioClips!.map((clip) => ({ ...clip, startFrame: 240 })),
      captions: [
        { ...editor.current().captions[0]!, text: "已校对" },
        { id: "manual-title", startFrame: 0, endFrame: 30, text: "手动标题" },
      ],
    }),
  );
  await editor.actions.captionsFromTranscript();
  const generated = editor
    .current()
    .captions.find((caption) => caption.id.startsWith("transcript-"))!;
  assert.deepEqual(
    [generated.startFrame, generated.endFrame, generated.text],
    [240, 300, "已校对"],
  );
  assert.ok(editor.current().captions.some((caption) => caption.id === "manual-title"));
  assert.equal(editor.current().captions.length, 2);
});

test("duplicate transcript pages and duplicate audible placements yield one subtitle per identical time and text", async () => {
  const value = project({
    audioClips: [
      { id: "one", assetId: "voice", inFrame: 30, outFrame: 90, startFrame: 0, volume: 1 },
      { id: "two", assetId: "voice", inFrame: 30, outFrame: 90, startFrame: 0, volume: 1 },
    ],
  });
  const editor = session(value, async (_id, offset) => ({
    offset,
    total: 2,
    segments: [{ start: 1, end: 3, text: "相同时间只显示一次" }],
  }));
  await editor.actions.captionsFromTranscript();
  assert.equal(editor.current().captions.length, 1);
});

test("missing and empty transcripts are reported without discarding available subtitles", async () => {
  const value = project({
    clips: [{ id: "picture", assetId: "video", inFrame: 0, outFrame: 600, volume: 1 }],
  });
  for (const missing of ["error", "empty"]) {
    const editor = session(value, async (id) => {
      if (id === "video") {
        if (missing === "error") throw new Error("ENOENT: transcript not found");
        return page([]);
      }
      return page([{ start: 1, end: 2, text: "可用旁白" }]);
    });
    await editor.actions.captionsFromTranscript();
    assert.equal(editor.current().captions.length, 1);
    assert.match(editor.messages.at(-1)!, /1 个素材尚无文稿/);
  }
});

test("incomplete transcript pagination aborts the whole batch instead of publishing partial captions", async () => {
  const initial = project();
  const editor = session(initial, async (_id, offset) => ({
    offset,
    total: 2,
    segments: offset === 0 ? [{ start: 1, end: 2, text: "不能只保存这句" }] : [],
  }));
  await assert.rejects(editor.actions.captionsFromTranscript(), /分页不完整/);
  assert.equal(editor.current(), initial);
  assert.equal(editor.commits(), 0);
});

test("unavailable desktop and all-muted timelines do not read transcripts or mutate the project", async () => {
  const read = async () => {
    assert.fail("must not request a transcript");
  };
  const unavailable = session(project(), read, false);
  await assert.rejects(unavailable.actions.captionsFromTranscript(), /桌面视频工作台/);
  const muted = session(project({ audioClips: [] }), read);
  await assert.rejects(muted.actions.captionsFromTranscript(), /开启音量/);
  assert.equal(unavailable.commits() + muted.commits(), 0);
});
