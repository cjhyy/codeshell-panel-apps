import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createProject, validateProject, type Project } from "../apps/video-studio/src/model";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { EditorSession } from "../apps/video-studio/src/editor/session";
import {
  createCaptionController,
  type CaptionControllerContext,
} from "../apps/video-studio/src/editor/caption-controller";
import { listCaptions } from "../apps/video-studio/src/editor/captions";
import type { EditorDocument } from "../apps/video-studio/src/editor/types";

// The 字幕 page generates transcript captions through the shared caption controller;
// these cases keep the guarantees of the former frame-based “从文稿生成字幕” action.
const T = 240000;
const media = (letter: string) => "asset-" + letter.repeat(64);
function project(): Project {
  return validateProject({
    ...createProject(),
    assets: [
      {
        id: "chapter",
        name: "章节",
        kind: "video",
        durationFrames: 30,
        mediaId: media("a"),
        scene: { kind: "hyperframes", sourceHash: "a".repeat(64), params: { title: "章节" } },
      },
      { id: "speech", name: "口播", kind: "video", durationFrames: 90, mediaId: media("b") },
      { id: "broll", name: "无声画面", kind: "video", durationFrames: 60, mediaId: media("c") },
      { id: "pending", name: "待转写口播", kind: "audio", durationFrames: 60, mediaId: media("d") },
    ],
    clips: [
      { id: "c1", assetId: "chapter", inFrame: 0, outFrame: 30, volume: 1 },
      { id: "c2", assetId: "speech", inFrame: 0, outFrame: 90, volume: 1 },
      { id: "c3", assetId: "broll", inFrame: 0, outFrame: 60, volume: 1 },
      { id: "c4", assetId: "pending", inFrame: 0, outFrame: 60, volume: 1 },
    ],
  });
}
function document(): EditorDocument {
  const doc = migrateLegacyProject(project());
  // Inspection found no audio stream in the silent B-roll.
  doc.assets.find((asset) => asset.id === "broll")!.metadata = { editorInspection: {} };
  return doc;
}
async function captions(
  t: TestContext,
  transcript: NonNullable<CaptionControllerContext["transcript"]>,
) {
  let stored = document(),
    revision = 1;
  const session = await EditorSession.open(
    {
      read: async () => ({ data: stored, revision }),
      write: async (doc, base) => {
        assert.equal(base, revision);
        stored = structuredClone(doc);
        return { revision: ++revision };
      },
      backupLegacy: async () => {},
    },
    { autosaveDelayMs: 60000 },
  );
  const controller = createCaptionController({
    session: () => session,
    apply: (ops, identity, label) => session.dispatchDurable(ops, identity, label, "user"),
    transcript,
  });
  controller.setCapabilities({ canTranscribe: true, canTranslate: false });
  t.after(async () => {
    controller.dispose();
    await session.close({ save: false });
  });
  return { session, controller, sequenceId: session.read().activeSequenceId };
}

test("transcript captions skip silent clips, read every page and land on the edited timeline", async (t) => {
  const calls: Array<[string, number]> = [];
  const h = await captions(t, async ({ assetId, offset }) => {
    calls.push([assetId, offset]);
    assert.equal(assetId, "speech");
    return {
      assetId,
      total: 2,
      offset,
      segments:
        offset === 0
          ? [{ start: 0, end: 1, text: "第一句" }]
          : [{ start: 1, end: 2, text: "第二句" }],
    };
  });
  const sources = h.controller.sources(h.sequenceId).map((source) => source.assetId);
  assert.equal(sources.includes("broll"), false, "Silent media offers no transcript source");
  assert.ok(sources.includes("speech") && sources.includes("pending"));
  await h.controller.generate({ sequenceId: h.sequenceId, assetIds: ["speech"] });
  assert.deepEqual(calls, [
    ["speech", 0],
    ["speech", 1],
  ]);
  assert.equal(listCaptions(h.session.read(), h.sequenceId).length, 0, "Preview only");
  await h.controller.apply();
  assert.deepEqual(
    listCaptions(h.session.read(), h.sequenceId).map((c) => [c.start, c.duration, c.text]),
    [
      [1 * T, T, "第一句"],
      [2 * T, T, "第二句"],
    ],
  );
  await h.controller.generate({ sequenceId: h.sequenceId, assetIds: ["speech"] });
  assert.equal(h.controller.getState().candidate!.skipped, 2, "Existing captions are kept");
});

test("transcript fetch errors and concurrent edits never publish a partial or stale subtitle batch", async (t) => {
  const failed = await captions(t, async () => {
    throw Error("Host unavailable");
  });
  const before = failed.session.read();
  await assert.rejects(
    failed.controller.generate({ sequenceId: failed.sequenceId, assetIds: ["speech"] }),
    /Host unavailable/,
  );
  assert.deepEqual(failed.session.read(), before);
  assert.equal(failed.controller.getState().candidate, undefined);
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = await captions(t, async ({ assetId, offset }) => {
    await waiting;
    return { assetId, offset, total: 1, segments: [{ start: 0, end: 1, text: "旧文稿" }] };
  });
  const operation = h.controller.generate({ sequenceId: h.sequenceId, assetIds: ["speech"] });
  await h.session.dispatchDurable(
    [{ type: "project.rename", name: "手动改名" }],
    h.session.getState().identity,
    "改名",
  );
  release();
  await assert.rejects(operation, /取消|工程已变化/);
  assert.equal(h.session.read().name, "手动改名");
  assert.equal(listCaptions(h.session.read(), h.sequenceId).length, 0);
  assert.equal(h.controller.getState().phase, "stale");
});

test("replacing the project with a modified same-ID copy invalidates pending transcript captions", async (t) => {
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = await captions(t, async ({ assetId, offset }) => {
    await waiting;
    return { assetId, offset, total: 1, segments: [{ start: 0, end: 1, text: "旧工程文稿" }] };
  });
  const operation = h.controller.generate({ sequenceId: h.sequenceId, assetIds: ["speech"] });
  const reopened = structuredClone(h.session.read());
  reopened.name = "重新打开的备份";
  await h.session.replace(reopened);
  release();
  await assert.rejects(operation, /取消|工程已变化/);
  assert.equal(h.session.read().name, "重新打开的备份");
  assert.equal(listCaptions(h.session.read(), h.sequenceId).length, 0);
  assert.equal(h.controller.getState().candidate, undefined);
});
