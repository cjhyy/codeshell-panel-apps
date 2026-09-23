import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createProject, validateProject, type Project } from "../apps/video-studio/src/model";
import {
  captionSourceAssetIds,
  transcriptCaptions,
  type PreparedMedia,
  type TranscriptSegment,
} from "../apps/video-studio/src/production";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { EditorSession } from "../apps/video-studio/src/editor/session";
import { createCaptionController } from "../apps/video-studio/src/editor/caption-controller";
import {
  listCaptions,
  planAddCaption,
  planCaptionText,
} from "../apps/video-studio/src/editor/captions";
import type { EditorOperation } from "../apps/video-studio/src/editor/operations";

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
/** The 字幕 page path: the shared caption controller over the migrated v2 document. */
async function session(
  t: TestContext,
  initial: Project,
  transcript: (id: string, offset: number) => Promise<TranscriptPage>,
  enabled = true,
) {
  let stored = migrateLegacyProject(initial),
    revision = 1,
    writes = 0;
  const editor = await EditorSession.open(
    {
      read: async () => ({ data: stored, revision }),
      write: async (doc, base) => {
        assert.equal(base, revision);
        writes++;
        stored = structuredClone(doc);
        return { revision: ++revision };
      },
      backupLegacy: async () => {},
    },
    { autosaveDelayMs: 60000 },
  );
  const controller = createCaptionController({
    session: () => editor,
    apply: (ops, identity, label) => editor.dispatchDurable(ops, identity, label, "user"),
    transcript: async ({ assetId, offset }) => ({ assetId, ...(await transcript(assetId, offset)) }),
  });
  controller.setCapabilities({ canTranscribe: enabled, canTranslate: false });
  t.after(async () => {
    controller.dispose();
    await editor.close({ save: false });
  });
  const sequenceId = editor.read().activeSequenceId;
  return {
    editor,
    controller,
    sequenceId,
    writes: () => writes,
    captions: () => listCaptions(editor.read(), sequenceId),
    async generate(assetIds?: string[]) {
      await controller.generate({ sequenceId, ...(assetIds ? { assetIds } : {}) });
      if (controller.getState().candidate?.operations.length) await controller.apply();
    },
    async apply(operations: EditorOperation[]) {
      await editor.dispatchDurable(operations, editor.getState().identity, "测试修改");
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

test("subtitle generation requests independent voice without transcribing a muted source and stays idempotent", async (t) => {
  const calls: string[] = [];
  const transcript = [{ start: 1, end: 3, text: "独立旁白" }];
  const editor = await session(t, project(), async (id) => {
    calls.push(id);
    return page(transcript);
  });
  assert.deepEqual(
    editor.controller.sources(editor.sequenceId).map((source) => source.assetId),
    ["voice"],
    "The muted picture offers no transcript source",
  );
  await editor.generate();
  assert.deepEqual(calls, ["voice"]);
  assert.equal(editor.captions()[0]!.start, 90 * 8000);
  const id = editor.captions()[0]!.id;
  await editor.apply(planCaptionText(editor.editor.read(), editor.sequenceId, id, "校对后的旁白"));
  const writes = editor.writes();
  await editor.controller.generate({ sequenceId: editor.sequenceId });
  assert.equal(editor.controller.getState().candidate!.operations.length, 0);
  assert.equal(editor.controller.getState().candidate!.skipped, 1);
  assert.match(editor.controller.getState().message, /已保留 1 条既有字幕/);
  assert.equal(editor.writes(), writes);
  assert.equal(editor.captions()[0]!.text, "校对后的旁白");
});

test("regeneration follows a moved narration caption while retaining corrected text and manual titles", async (t) => {
  const editor = await session(t, project(), async () =>
    page([{ start: 1, end: 3, text: "原识别" }]),
  );
  await editor.generate();
  const caption = editor.captions()[0]!;
  await editor.apply(planCaptionText(editor.editor.read(), editor.sequenceId, caption.id, "已校对"));
  // Moving the narration moves its bound subtitle with it.
  await editor.apply([
    { type: "clip.move", sequenceId: editor.sequenceId, clipIds: ["narration"], delta: 150 * 8000 },
  ]);
  await editor.apply(
    planAddCaption(editor.editor.read(), editor.sequenceId, {
      start: 0,
      duration: 30 * 8000,
      text: "手动标题",
    }),
  );
  await editor.generate();
  const generated = editor.captions().find((clip) => clip.id === caption.id)!;
  assert.deepEqual(
    [generated.start, generated.start + generated.duration, generated.text],
    [240 * 8000, 300 * 8000, "已校对"],
  );
  assert.ok(editor.captions().some((clip) => clip.text === "手动标题"));
  assert.equal(editor.captions().length, 2);
});

test("duplicate audible placements yield one subtitle per identical time and text; repeated pages publish nothing", async (t) => {
  const value = project({
    audioClips: [
      { id: "one", assetId: "voice", inFrame: 30, outFrame: 90, startFrame: 0, volume: 1 },
      { id: "two", assetId: "voice", inFrame: 30, outFrame: 90, startFrame: 0, volume: 1 },
    ],
  });
  const editor = await session(t, value, async () => page([{ start: 1, end: 3, text: "相同时间只显示一次" }]));
  await editor.generate();
  assert.equal(editor.captions().length, 1);
  const repeated = await session(t, value, async (_id, offset) => ({
    offset,
    total: 2,
    segments: [{ start: 1, end: 3, text: "相同时间只显示一次" }],
  }));
  await assert.rejects(repeated.generate(), /重复段落/);
  assert.equal(repeated.captions().length, 0);
  assert.equal(repeated.writes(), 0);
});

test("an empty transcript adds nothing for its source without discarding available subtitles; a failed read publishes nothing", async (t) => {
  const value = project({
    clips: [{ id: "picture", assetId: "video", inFrame: 0, outFrame: 600, volume: 1 }],
  });
  const editor = await session(t, value, async (id) =>
    id === "video" ? page([]) : page([{ start: 1, end: 2, text: "可用旁白" }]),
  );
  await editor.generate();
  assert.deepEqual(
    editor.captions().map((clip) => clip.text),
    ["可用旁白"],
  );
  const silent = await session(t, value, async () => page([]));
  await silent.controller.generate({ sequenceId: silent.sequenceId });
  assert.ok(
    silent.controller.getState().candidate!.notices.some((notice) => /没有识别到语音/.test(notice)),
  );
  const failed = await session(t, value, async (id) => {
    if (id === "video") throw new Error("ENOENT: transcript not found");
    return page([{ start: 1, end: 2, text: "可用旁白" }]);
  });
  await assert.rejects(failed.generate(), /ENOENT/);
  assert.equal(failed.captions().length, 0);
  assert.equal(failed.writes(), 0);
});

test("incomplete transcript pagination aborts the whole batch instead of publishing partial captions", async (t) => {
  const editor = await session(t, project(), async (_id, offset) => ({
    offset,
    total: 2,
    segments: offset === 0 ? [{ start: 1, end: 2, text: "不能只保存这句" }] : [],
  }));
  await assert.rejects(editor.generate(), /分页不完整/);
  assert.equal(editor.captions().length, 0);
  assert.equal(editor.writes(), 0);
  assert.equal(editor.controller.getState().candidate, undefined);
});

test("unavailable transcription and all-muted timelines do not read transcripts or mutate the project", async (t) => {
  const read = async (): Promise<TranscriptPage> => {
    assert.fail("must not request a transcript");
  };
  const unavailable = await session(t, project(), read, false);
  await assert.rejects(unavailable.generate(), /没有接入真实语音转写/);
  const muted = await session(t, project({ audioClips: [] }), read);
  await assert.rejects(muted.generate(), /可听见的声音来源/);
  assert.equal(unavailable.writes() + muted.writes(), 0);
});
