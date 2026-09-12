import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductionUI } from "../apps/video-studio/src/production-ui";
import { createProject, validateProject, type Project } from "../apps/video-studio/src/model";
import type { ProductionController } from "../apps/video-studio/src/production";
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
function ui(initial: Project, transcript: (id: string, offset: number) => Promise<unknown>) {
  let current = initial;
  const messages: string[] = [];
  const controller = {
    preparations: new Map([
      [media("b"), { inspection: { audio: {} } }],
      [media("c"), { inspection: {} }],
      [media("d"), { inspection: { audio: {} } }],
    ]),
    transcript,
  } as unknown as ProductionController;
  const actions = createProductionUI(controller, {
    project: () => current,
    commit: (next) => {
      current = next;
    },
    replace: async (next) => {
      current = next;
    },
    restoreMedia: async () => {},
    toast: (message) => messages.push(message),
    render: () => {},
  });
  return {
    actions,
    current: () => current,
    messages,
    change: (value: Project) => {
      current = value;
    },
  };
}

test("caption import skips generated and silent clips, uses actual page lengths, and reports missing transcripts", async () => {
  const calls: Array<[string, number]> = [];
  const session = ui(project(), async (id, offset) => {
    calls.push([id, offset]);
    if (id === "pending") throw Error("ENOENT: transcript not found");
    assert.equal(id, "speech");
    return {
      total: 2,
      offset,
      segments:
        offset === 0
          ? [{ start: 0, end: 1, text: "第一句" }]
          : [{ start: 1, end: 2, text: "第二句" }],
    };
  });
  await session.actions.captionsFromTranscript();
  assert.deepEqual(calls, [
    ["speech", 0],
    ["speech", 1],
    ["pending", 0],
  ]);
  assert.deepEqual(
    session.current().captions.map((c) => [c.startFrame, c.endFrame, c.text]),
    [
      [30, 60, "第一句"],
      [60, 90, "第二句"],
    ],
  );
  assert.match(session.messages[0], /1 个素材尚无文稿/);
});

test("caption fetch errors and concurrent edits never publish a partial or stale subtitle batch", async () => {
  const initial = project();
  const failed = ui(initial, async () => {
    throw Error("Host unavailable");
  });
  await assert.rejects(failed.actions.captionsFromTranscript(), /Host unavailable/);
  assert.equal(failed.current(), initial);
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session = ui(initial, async (id) => {
    if (id === "pending") throw Error("ENOENT");
    await waiting;
    return { total: 1, offset: 0, segments: [{ start: 0, end: 1, text: "旧文稿" }] };
  });
  const operation = session.actions.captionsFromTranscript();
  session.change(validateProject({ ...initial, name: "手动改名", revision: initial.revision + 1 }));
  release();
  await assert.rejects(operation, /工程已变化/);
  assert.equal(session.current().name, "手动改名");
  assert.equal(session.current().captions.length, 0);
});

test("reopening a modified backup with the same identity rejects pending transcript captions", async () => {
  const initial = project();
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session = ui(initial, async (id) => {
    if (id === "pending") throw Error("ENOENT");
    await waiting;
    return { total: 1, offset: 0, segments: [{ start: 0, end: 1, text: "旧工程文稿" }] };
  });
  const operation = session.actions.captionsFromTranscript();
  const reopened = validateProject({ ...initial, name: "重新打开的备份" });
  assert.equal(reopened.id, initial.id);
  assert.equal(reopened.revision, initial.revision);
  session.change(reopened);
  release();
  await assert.rejects(operation, /工程已变化/);
  assert.equal(session.current(), reopened);
  assert.equal(session.current().captions.length, 0);
});
