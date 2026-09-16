import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFile } from "node:fs/promises";
import { validateToolArgsStrict } from "@cjhyy/code-shell-core";
import {
  createEditorAgentTools,
  registerEditorAgentTools,
  EDITOR_AGENT_LIMITS,
  type EditorAgentContext,
} from "../apps/video-studio/src/editor/agent-tools";
import { reconcileEditorProduction } from "../apps/video-studio/src/editor/production-guard";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { EditorSession, EditorStorageConflictError } from "../apps/video-studio/src/editor/session";
import type { EditorDocument, MediaClip, TextClip } from "../apps/video-studio/src/editor/types";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import { createSeparationController } from "../apps/video-studio/src/editor/separation-controller";
import type { createAudioSeparationBridge } from "../apps/video-studio/src/editor/separation-bridge";
import { evaluateFrame } from "../apps/video-studio/src/editor/evaluate";
import type { MulticamClip } from "../apps/video-studio/src/editor/types";
import { createExportSubmissions } from "../apps/video-studio/src/editor/export-submissions";

const T = 240000,
  sequenceId = "sequence-main";
function fixture(): EditorDocument {
  const doc = migrateLegacyProject({
    schemaVersion: 1,
    id: "project",
    name: "AI编辑",
    revision: 4,
    width: 1920,
    height: 1080,
    fps: 30,
    assets: [
      { id: "video", name: "原片", kind: "video", durationFrames: 300 },
      { id: "voice", name: "本人声音", kind: "audio", durationFrames: 300 },
    ],
    clips: [
      { id: "a", assetId: "video", inFrame: 0, outFrame: 90, volume: 1 },
      { id: "b", assetId: "video", inFrame: 90, outFrame: 180, volume: 1 },
    ],
    audioClips: [
      { id: "voice-clip", assetId: "voice", inFrame: 0, outFrame: 90, startFrame: 0, volume: 1 },
    ],
    captions: [{ id: "caption", text: "真实字幕", startFrame: 30, endFrame: 60 }],
  });
  doc.sequences[0]!.frameRate = { numerator: 30000, denominator: 1001 };
  doc.sequences[0]!.timelineMode = "free";
  return doc;
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function harness(
  t: TestContext,
  doc = fixture(),
  overrides: Partial<EditorAgentContext> = {},
) {
  const state = {
    data: structuredClone(doc),
    revision: 10,
    writes: [] as EditorDocument[],
    fail: false,
    wait: undefined as undefined | ReturnType<typeof gate>,
  };
  const session = await EditorSession.open(
    {
      read: async () => ({ data: state.data, revision: state.revision }),
      backupLegacy: async () => {},
      write: async (next, base) => {
        state.writes.push(structuredClone(next));
        await state.wait?.promise;
        if (state.fail) throw new Error("保存失败");
        if (base !== state.revision) throw new EditorStorageConflictError();
        state.data = structuredClone(next);
        return { revision: ++state.revision };
      },
    },
    { autosaveDelayMs: 60000 },
  );
  t.after(() => session.close({ save: false }));
  let allocated = 0;
  const tools = createEditorAgentTools({
    session: () => session,
    authorize: (request) =>
      request.after ? reconcileEditorProduction(request.before, request.after) : undefined,
    idFactory: (kind) => `${kind}-generated-${++allocated}`,
    ...overrides,
  });
  const edit = (steps: unknown[], label = "AI调整") =>
    tools.apply_editor_edit({ identity: session.getState().identity, label, steps });
  return { state, session, tools, edit };
}
const raw = (...operations: unknown[]) => ({ kind: "operations", operations });
const video = (doc: EditorDocument, id = "a") =>
  doc.sequences[0]!.clips.find((clip) => clip.id === id) as MediaClip;

test("AI clipboard shares exact cut/paste graph, commits only after save, and in-place duplicate is one undo", async (t) => {
  const { tools, session, state, edit } = await harness(t),
    invoke = (clipboard: unknown) =>
      tools.apply_editor_edit({ identity: session.getState().identity, clipboard });
  const copied = (await invoke({ action: "copy", sequenceId, clipIds: ["a"] })) as any;
  assert.equal(state.writes.length, 0);
  state.fail = true;
  await assert.rejects(invoke({ action: "cut", sequenceId, clipIds: ["b"] }), /保存失败/);
  assert.equal(
    session.read().sequences[0]!.clips.filter((clip) => clip.kind === "media").length,
    3,
  );
  state.fail = false;
  const pasted = (await invoke({
    action: "paste",
    sequenceId,
    clipboardId: copied.clipboard.clipboardId,
    at: 10 * T,
  })) as any;
  assert.equal(pasted.addedClipIds.length, 1);
  assert.equal(video(session.read(), pasted.addedClipIds[0].clipId).timeMap.points[0]!.source, 0);
  await edit([{ kind: "duplicate", sequenceId, clipIds: ["a"] }]);
  const added = session.read().sequences[0]!.clips.at(-1)!;
  assert.equal(added.start, 0);
  assert.notEqual(added.trackId, video(session.read()).trackId);
  const count = session.read().sequences[0]!.tracks.length;
  session.undo(session.getState().identity);
  assert.equal(session.read().sequences[0]!.tracks.length, count - 1);
  await session.replace(session.read(), { identity: session.getState().identity });
  await assert.rejects(
    invoke({ action: "paste", sequenceId, clipboardId: copied.clipboard.clipboardId, at: 20 * T }),
    /剪贴板已变化/,
  );
});

test("AI clipboard rejects hidden parameters, source-only caption cut, and stale asynchronous authorization", async (t) => {
  const doc = fixture(),
    caption = doc.sequences[0]!.clips.find((clip): clip is TextClip => clip.kind === "text")!;
  caption.sourceBinding = { clipId: "a", sourceStart: T, sourceEnd: 2 * T };
  const pending = gate();
  const { tools, session, state } = await harness(t, doc, {
    authorize: async () => pending.promise,
  });
  const invoke = (clipboard: unknown) =>
    tools.apply_editor_edit({ identity: session.getState().identity, clipboard });
  await assert.rejects(invoke({ action: "copy", sequenceId, clipIds: ["a"], at: 2 }), /未知字段/);
  await assert.rejects(
    invoke({ action: "cut", sequenceId, clipIds: [caption.id] }),
    /同时选择来源/,
  );
  const copied = (await invoke({ action: "copy", sequenceId, clipIds: ["a"] })) as any;
  assert.equal(copied.clipboard.clipCount, 2);
  const applying = invoke({
    action: "paste",
    sequenceId,
    clipboardId: copied.clipboard.clipboardId,
    at: 10 * T,
  });
  await Promise.resolve();
  session.dispatch(
    [{ type: "project.rename", name: "并发修改" }],
    session.getState().identity,
    "改名",
  );
  pending.resolve();
  await assert.rejects(applying, /版本已变化/);
  assert.equal(state.writes.length, 0);
});

test("v2 read pages reconstruct every large keyframe, escaped metadata key and Unicode string without 30fps projection", async (t) => {
  const doc = fixture();
  video(doc).transform.rotation = {
    keyframes: Array.from({ length: 2000 }, (_, i) => ({ time: i * 100, value: i % 360 })),
  };
  doc.production = { ...doc.production, "name/with~escapes": "旁白🙂".repeat(6000) };
  const { tools } = await harness(t, doc),
    identity = tools.read_editor_project().identity;
  function check(result: unknown) {
    assert.ok(
      new TextEncoder().encode(JSON.stringify(result)).length <= EDITOR_AGENT_LIMITS.responseBytes,
    );
  }
  async function expand(path = ""): Promise<any> {
    let result = tools.read_editor_project({ identity, path, limit: 7 });
    check(result);
    if (result.page.type === "string") {
      let text = result.page.value as string;
      while (result.page.nextOffset !== null) {
        result = tools.read_editor_project({ identity, path, offset: result.page.nextOffset });
        check(result);
        text += result.page.value;
      }
      return text;
    }
    if (!("entries" in result.page)) return result.page.value;
    const value: any = result.page.type === "array" ? [] : {};
    for (;;) {
      for (const item of result.page.entries!)
        value[item.key] = "value" in item ? item.value : await expand(item.path);
      if (result.page.nextOffset === null) return value;
      result = tools.read_editor_project({
        identity,
        path,
        limit: 7,
        offset: result.page.nextOffset,
      });
      check(result);
    }
  }
  assert.deepEqual(await expand(), doc);
  assert.equal(
    tools.read_editor_project({ path: "/sequences/0/frameRate/numerator" }).page.value,
    30000,
  );
  assert.throws(() => tools.read_editor_project({ path: "/sequences/01" }), /路径/);
  assert.throws(() => tools.read_editor_project({ path: "/production/__proto__" }), /路径/);
  assert.throws(() => tools.read_editor_project({ path: "/production/bad~2key" }), /转义/);
  assert.throws(() => tools.read_editor_project({ path: "/assets", offset: 3 }), /偏移/);
});

test("raw edits and split form one durable agent revision and one undo, preserving NTSC ticks and keyframes", async (t) => {
  const doc = fixture();
  video(doc).transform.x = {
    keyframes: [
      { time: 0, value: 0 },
      { time: 3 * T, value: 1 },
    ],
  };
  const h = await harness(t, doc),
    actors: string[] = [],
    dispatch = h.session.dispatchDurable.bind(h.session);
  h.session.dispatchDurable = (ops, identity, label, actor, signal) => {
    actors.push(actor!);
    return dispatch(ops, identity, label, actor, signal);
  };
  const response = await h.edit([
    raw({ type: "project.rename", name: "已调整" }),
    { kind: "split", sequenceId, clipId: "a", time: 8008 },
  ]);
  assert.equal(response.identity.revision, doc.revision + 1);
  assert.deepEqual(actors, ["agent"]);
  assert.equal(response.addedClipIds.length, 1);
  assert.equal(video(h.state.data).duration, 8008);
  assert.deepEqual(h.state.data.sequences[0]!.frameRate, doc.sequences[0]!.frameRate);
  assert.ok(typeof video(h.state.data, response.addedClipIds[0]!.clipId).transform.x === "object");
  h.session.undo();
  const undone = h.session.read();
  assert.deepEqual({ ...undone, revision: doc.revision }, doc);
  assert.equal(h.session.getState().canUndo, false);
});

test("failed saves keep the exact document/history/candidate reusable and retry commits once", async (t) => {
  const h = await harness(t),
    before = h.session.read(),
    args = {
      identity: h.session.getState().identity,
      label: "保存候选",
      steps: [raw({ type: "project.rename", name: "新版" })],
    };
  h.state.fail = true;
  await assert.rejects(h.tools.apply_editor_edit(args), /保存失败/);
  assert.deepEqual(h.session.read(), before);
  assert.equal(h.session.getState().canUndo, false);
  h.state.fail = false;
  await h.tools.apply_editor_edit(args);
  assert.equal(h.session.read().revision, before.revision + 1);
  await assert.rejects(h.tools.apply_editor_edit(args), /身份或版本/);
});

test("prototype/accessor/unknown inputs, resource rewrites, approval edits and hidden track unlocking never write", async (t) => {
  const h = await harness(t);
  let called = false;
  const accessor = {
    get steps() {
      called = true;
      return [];
    },
  };
  await assert.rejects(h.tools.apply_editor_edit(accessor), /访问器/);
  assert.equal(called, false);
  for (const operation of [
    { type: "project.production", data: { narration: { phase: "approved" } } },
    { type: "asset.add", asset: {} },
    { type: "asset.remove", assetId: "voice" },
    { type: "asset.update", assetId: "video", patch: { resourceId: "forged" } },
    { type: "track.update", sequenceId, trackId: "track-video-main", patch: { locked: false } },
    { type: "clip.update", sequenceId, clipId: "a", patch: { timeMap: { points: [] } } },
    { type: "project.rename", name: "bad", unexpected: true },
  ])
    await assert.rejects(h.edit([raw(operation)]));
  await assert.rejects(h.edit([raw({ type: "project.rename", name: "x".repeat(300000) })]), /字节/);
  await assert.rejects(
    h.edit([{ kind: "arrange", sequenceId, options: { mode: "free", compact: "true" } }]),
    /布尔/,
  );
  await assert.rejects(
    h.tools.apply_editor_edit(JSON.parse('{"__proto__":{},"steps":[]}')),
    /不安全/,
  );
  assert.equal(h.state.writes.length, 0);
});

test("free movement follows group/link and source captions, preserves gaps, and rejects locked captions atomically", async (t) => {
  const doc = fixture(),
    seq = doc.sequences[0]!;
  video(doc, "b").start = 5 * T;
  video(doc).linkGroupId = "sound";
  video(doc, "voice-clip").linkGroupId = "sound";
  (seq.clips.find((clip) => clip.id === "caption") as TextClip).sourceBinding = {
    clipId: "a",
    sourceStart: T,
    sourceEnd: 2 * T,
  };
  const h = await harness(t, doc);
  await h.edit([{ kind: "move", sequenceId, clipIds: ["a"], options: { delta: 8008 } }]);
  assert.equal(video(h.session.read()).start, 8008);
  assert.equal(video(h.session.read(), "b").start, 5 * T);
  assert.equal(
    h.session.read().sequences[0]!.clips.find((clip) => clip.id === "caption")!.start,
    T + 8008,
  );
  const locked = fixture();
  locked.sequences[0]!.tracks.find((track) => track.kind === "text")!.locked = true;
  (locked.sequences[0]!.clips.find((clip) => clip.id === "caption") as TextClip).sourceBinding = {
    clipId: "a",
    sourceStart: T,
    sourceEnd: 2 * T,
  };
  const bad = await harness(t, locked);
  await assert.rejects(
    bad.edit([
      raw({ type: "project.rename", name: "不能部分保存" }),
      { kind: "move", sequenceId, clipIds: ["a"], options: { delta: 8008 } },
    ]),
    /锁定/,
  );
  assert.deepEqual(bad.session.read(), locked);
  assert.equal(bad.state.writes.length, 0);
});

test("magnetic move/remove and timing planners preserve order and use explicit ripple choices", async (t) => {
  const doc = fixture();
  doc.sequences[0]!.timelineMode = "magnetic";
  const h = await harness(t, doc);
  await h.edit([
    { kind: "move", sequenceId, clipIds: ["a"], options: { delta: 0, direction: "next" } },
  ]);
  assert.equal(video(h.session.read(), "a").start, 3 * T);
  await h.edit([
    {
      kind: "timing",
      sequenceId,
      clipIds: ["b"],
      action: { kind: "speed", rate: 2, preservePitch: true },
      options: { ripple: true },
    },
  ]);
  assert.equal(video(h.session.read(), "a").start, 1.5 * T);
  await h.edit([{ kind: "remove", sequenceId, clipIds: ["b"] }]);
  assert.equal(video(h.session.read(), "a").start, 0);
});

test("transition planner adds a valid overlap instead of raw temporal patches", async (t) => {
  const h = await harness(t);
  await h.edit([
    {
      kind: "transition",
      sequenceId,
      fromClipId: "a",
      toClipId: "b",
      options: { id: "crossfade", kind: "dissolve", duration: T / 2, placement: "ripple" },
    },
  ]);
  assert.equal(h.session.read().sequences[0]!.transitions.length, 1);
  await assert.rejects(
    h.edit([{ kind: "timing", sequenceId, clipIds: ["a"], action: { kind: "reverse" } }]),
    /转场/,
  );
});

test("domain guard denies active recording/automatic locks and stale async authorization cannot commit", async (t) => {
  let blocked = true;
  const pause = gate();
  const h = await harness(t, fixture(), {
    authorize: async () => {
      if (blocked) throw new Error("正在录制，旧制作流程锁定");
      await pause.promise;
    },
  });
  await assert.rejects(h.edit([raw({ type: "project.rename", name: "x" })]), /录制/);
  blocked = false;
  const pending = h.edit([raw({ type: "project.rename", name: "旧计划" })]);
  h.session.dispatch([{ type: "project.rename", name: "用户修改" }], h.session.getState().identity);
  pause.resolve();
  await assert.rejects(pending, /身份或版本/);
  assert.equal(h.session.read().name, "用户修改");
});

test("same-ID replacement invalidates old reads and writes even when a caller supplies a newer revision", async (t) => {
  const h = await harness(t),
    previous = h.session.getState().identity;
  await h.session.replace(fixture());
  const forged = { ...previous, revision: h.session.getState().identity.revision };
  assert.throws(() => h.tools.read_editor_project({ identity: forged }), /身份或版本/);
  await assert.rejects(
    h.tools.apply_editor_edit({
      identity: forged,
      label: "旧任务",
      steps: [raw({ type: "project.rename", name: "旧" })],
    }),
    /身份或版本/,
  );
});

test("narration guard preserves visual edits, invalidates caption/audio/timing changes and retains previous approval provenance", async (t) => {
  const doc = fixture();
  doc.production = {
    ...doc.production,
    script: "真实口播",
    narration: {
      phase: "aligned",
      captionBasis: "recording",
      draftCaptionIds: ["caption"],
      recordingAssetId: "voice",
      approvedScript: "真实口播",
      approvedFingerprint: "a".repeat(64),
      alignmentFingerprint: "b".repeat(64),
    },
  };
  const h = await harness(t, doc);
  const prepared = structuredClone(doc);
  prepared.assets[0]!.fingerprint = "c".repeat(64);
  prepared.assets[0]!.metadata = { proxyId: "prepared", speech: { recipe: "existing-audio" } };
  prepared.sequences[0]!.clips.reverse();
  assert.deepEqual(reconcileEditorProduction(doc, prepared), []);
  const replaced = structuredClone(prepared);
  replaced.assets[0]!.fingerprint = "d".repeat(64);
  assert.equal(reconcileEditorProduction(prepared, replaced).length, 1);
  await h.edit([
    raw({
      type: "clip.update",
      sequenceId,
      clipId: "a",
      patch: {
        transform: { ...video(doc).transform, rotation: 5 },
        color: { ...video(doc).color, exposure: 1 },
      },
    }),
  ]);
  assert.deepEqual(h.session.read().production!.narration, doc.production.narration);
  await h.edit([
    {
      kind: "captions",
      sequenceId,
      action: { kind: "text", clipId: "caption", text: "改过的字幕" },
    },
  ]);
  const production = h.session.read().production!;
  assert.deepEqual(production.narration, {
    phase: "review",
    captionBasis: "draft",
    draftCaptionIds: ["caption"],
    recordingAssetId: "voice",
  });
  assert.equal((production.narrationPreviousApproval as any).approvedScript, "真实口播");
  h.session.undo();
  assert.deepEqual(h.session.read().production!.narration, doc.production.narration);
  const audioChanged = applyEditorOperations(
    doc,
    [
      {
        type: "clip.update",
        sequenceId,
        clipId: "voice-clip",
        patch: { audio: { ...video(doc, "voice-clip").audio, volume: 0.5 } },
      },
    ],
    doc.revision,
  );
  assert.equal(reconcileEditorProduction(doc, audioChanged).length, 1);
});

test("export flushes the exact v2 snapshot, returns promptly and later exposes the actual background job", async (t) => {
  let calls = 0,
    exported: any;
  const pending = gate();
  const h = await harness(t, fixture(), {
    authorize: () => {
      calls++;
    },
    exportSequence: async (request) => {
      exported = request;
      await pending.promise;
      return { jobId: "task-real-1" };
    },
  });
  h.session.dispatch(
    [{ type: "project.rename", name: "待自动保存" }],
    h.session.getState().identity,
  );
  const identity = h.session.getState().identity,
    sequence = h.session.read().sequences[0]!,
    profile = h.session.read().exportProfiles[0]!;
  const result = await h.tools.render_editor_sequence({
    identity,
    sequenceId,
    profileId: profile.id,
  });
  assert.equal(calls, 2);
  assert.equal(result.accepted, true);
  assert.equal(result.status, "preparing");
  assert.equal(result.jobId, undefined);
  const duplicate = await h.tools.render_editor_sequence({
    identity,
    sequenceId,
    profileId: profile.id,
  });
  assert.equal(duplicate.operationId, result.operationId);
  assert.deepEqual(exported.document, h.state.data);
  assert.equal(Object.isFrozen(exported.document.sequences[0].clips[0]), true);
  assert.deepEqual(exported.document.sequences[0].frameRate, sequence.frameRate);
  assert.equal(h.session.getState().dirty, false);
  pending.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const response = await h.tools.read_editor_jobs({ path: "/submissions", format: "json" });
  const submissions = JSON.parse(response.page.value as string);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].jobId, "task-real-1");
  assert.equal(submissions[0].status, "submitted");
});

test("export preparation cancellation reaches its signal and does not invent a native job", async (t) => {
  let observed: AbortSignal | undefined;
  const h = await harness(t, fixture(), {
    exportSequence: async (_request, options) => {
      observed = options!.signal;
      await new Promise((_resolve, reject) =>
        observed!.addEventListener(
          "abort",
          () => reject(new DOMException("已取消", "AbortError")),
          { once: true },
        ),
      );
      return { jobId: "unreachable" };
    },
  });
  const identity = h.session.getState().identity;
  const receipt = await h.tools.render_editor_sequence({
    identity,
    sequenceId,
    profileId: h.session.read().exportProfiles[0]!.id,
    requestId: "cancel-preparing",
  });
  const cancelling = await h.tools.render_editor_sequence({
    identity,
    action: "cancel",
    operationId: receipt.operationId,
  });
  assert.equal(cancelling.status, "cancelling");
  assert.equal(observed?.aborted, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const response = await h.tools.read_editor_jobs({ path: "/submissions", format: "json" });
  const [submission] = JSON.parse(response.page.value as string);
  assert.equal(submission.status, "cancelled");
  assert.equal(submission.jobId, undefined);
});

test("export failed preparations are queryable and stable request IDs cannot target new edits", async (t) => {
  let submissions = 0;
  const h = await harness(t, fixture(), {
    exportSequence: async () => {
      submissions++;
      throw new Error("素材离线");
    },
  });
  const args = {
    identity: h.session.getState().identity,
    sequenceId,
    profileId: h.session.read().exportProfiles[0]!.id,
    requestId: "export-retry",
  };
  const accepted = await h.tools.render_editor_sequence(args);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const retry = await h.tools.render_editor_sequence(args);
  assert.equal(retry.operationId, accepted.operationId);
  assert.equal(retry.status, "failed");
  assert.equal(retry.error, "素材离线");
  assert.equal(submissions, 1);
  await h.edit([raw({ type: "project.rename", name: "新版本" })]);
  await assert.rejects(
    h.tools.render_editor_sequence({ ...args, identity: h.session.getState().identity }),
    /requestId/,
  );
});
test("export cancellation racing a real submission cancels only the returned native job", async () => {
  const pending = gate(),
    cancelled: string[] = [],
    controller = createExportSubmissions();
  const identity = { documentId: "doc", generation: 1, revision: 4 };
  const receipt = controller.accept(
    { identity, sequenceId: "main", profileId: "mp4" },
    async () => {
      await pending.promise;
      return { jobId: "actual-native-job" };
    },
    async (jobId) => {
      cancelled.push(jobId);
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.throws(
    () => controller.cancel(receipt.operationId, { ...identity, generation: 2 }),
    /当前工程/,
  );
  controller.cancel(receipt.operationId, identity);
  pending.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(cancelled, ["actual-native-job"]);
  assert.equal(controller.list()[0]!.status, "cancelled");
  assert.equal(controller.list()[0]!.jobId, "actual-native-job");
});

test("failed export flush and changed authorization submit no native job", async (t) => {
  let exports = 0,
    checks = 0;
  const h = await harness(t, fixture(), {
    authorize: () => {
      if (++checks === 2) throw new Error("录制已开始");
    },
    exportSequence: async () => {
      exports++;
      return { jobId: "never" };
    },
  });
  const args = () => ({
    identity: h.session.getState().identity,
    sequenceId,
    profileId: h.session.read().exportProfiles[0]!.id,
  });
  h.session.dispatch([{ type: "project.rename", name: "pending" }], h.session.getState().identity);
  h.state.fail = true;
  await assert.rejects(h.tools.render_editor_sequence(args()), /保存失败/);
  assert.equal(exports, 0);
  h.state.fail = false;
  checks = 0;
  await assert.rejects(h.tools.render_editor_sequence(args()), /录制已开始/);
  assert.equal(exports, 0);
});

test("native task reading is delegated once and exposes large actual results through bounded expansion", async (t) => {
  const requests: unknown[] = [];
  const h = await harness(t, fixture(), {
    readJobs: async (request) => {
      requests.push(request);
      return {
        jobs: [{ id: "task-1", status: "succeeded", result: { text: "真实结果".repeat(10000) } }],
        total: 1,
      };
    },
  });
  const response = await h.tools.read_editor_jobs({
    jobIds: ["task-1"],
    path: "/jobs/0/result/text",
  });
  assert.equal(requests.length, 1);
  assert.equal(response.page.type, "string");
  assert.notEqual(response.page.nextOffset, null);
  assert.ok(
    new TextEncoder().encode(JSON.stringify(response)).length <= EDITOR_AGENT_LIMITS.responseBytes,
  );
});

test("core handler registration remains complete and removes partial registrations on failure", async (t) => {
  const h = await harness(t),
    names: string[] = [],
    disposed: string[] = [];
  const context: EditorAgentContext = { session: () => h.session, authorize: () => {} };
  const dispose = registerEditorAgentTools(
    {
      registerTool: (name) => {
        names.push(name);
        return () => disposed.push(name);
      },
    },
    context,
  );
  assert.deepEqual(names, [
    "read_editor_project",
    "apply_editor_edit",
    "render_editor_sequence",
    "read_editor_jobs",
  ]);
  dispose();
  dispose();
  assert.equal(disposed.length, 4);
  let count = 0;
  assert.throws(
    () =>
      registerEditorAgentTools(
        {
          registerTool: () => {
            if (++count === 2) throw new Error("bridge failed");
            return () => {
              count--;
            };
          },
        },
        context,
      ),
    /bridge failed/,
  );
  assert.equal(count, 1);
});

test("oversized metadata keys remain fully readable through bounded serialized pages", async (t) => {
  const doc = fixture(),
    key = "键/🙂".repeat(5000);
  doc.production = { ...doc.production, [key]: { preserved: "完整值" } };
  const h = await harness(t, doc),
    identity = h.session.getState().identity;
  const tree = h.tools.read_editor_project({ identity, path: "/production" });
  assert.ok(tree.page.entries?.some((entry: any) => entry.readAs === "json"));
  assert.ok(
    new TextEncoder().encode(JSON.stringify(tree)).length <= EDITOR_AGENT_LIMITS.responseBytes,
  );
  let offset = 0,
    encoded = "";
  for (;;) {
    const result = h.tools.read_editor_project({
      identity,
      path: "/production",
      format: "json",
      offset,
    });
    assert.ok(
      new TextEncoder().encode(JSON.stringify(result)).length <= EDITOR_AGENT_LIMITS.responseBytes,
    );
    encoded += result.page.value;
    if (result.page.nextOffset === null) break;
    offset = result.page.nextOffset;
  }
  assert.deepEqual(JSON.parse(encoded), doc.production);
});

test("bulk additions return bounded actual IDs with explicit total and continuation signal", async (t) => {
  const doc = fixture(),
    h = await harness(t, doc);
  const original = doc.sequences[0]!.clips.find((clip) => clip.id === "caption")!;
  const operations = Array.from({ length: 120 }, (_, index) => ({
    type: "clip.add",
    sequenceId,
    clip: { ...structuredClone(original), id: `new-${index}-${"x".repeat(110)}` },
  }));
  const result = await h.edit([raw(...operations)]);
  assert.equal(result.addedClipIds.length, 100);
  assert.equal(result.addedClipCount, 120);
  assert.equal(result.addedClipIdsComplete, false);
  assert.equal(h.session.read().sequences[0]!.clips.length, doc.sequences[0]!.clips.length + 120);
  assert.ok(
    new TextEncoder().encode(JSON.stringify(result)).length <= EDITOR_AGENT_LIMITS.responseBytes,
  );
  h.session.undo();
  assert.equal(h.session.read().sequences[0]!.clips.length, doc.sequences[0]!.clips.length);
});

test("Host schemas discover v2 within the existing 16 tools and reject mixed legacy/editor requests", async (t) => {
  const manifest = JSON.parse(
    await readFile("apps/video-studio/.codeshell-panel/panel.json", "utf8"),
  );
  const h = await harness(t),
    identity = h.session.getState().identity;
  assert.equal(manifest.agent.tools.length, 16);
  const schemas = Object.fromEntries(
    manifest.agent.tools.map((tool: any) => [tool.name, tool.inputSchema]),
  );
  const examples: Record<string, unknown> = {
    read_video_project: { editor: { view: "project", documentView: "defaults", identity } },
    apply_video_edit: {
      editor: {
        identity,
        label: "精剪",
        steps: [{ kind: "split", sequenceId, clipId: "a", time: 8008 }],
      },
    },
    render_video_project: {
      editor: { identity, sequenceId, profileId: h.session.read().exportProfiles[0]!.id },
    },
  };
  for (const [name, args] of Object.entries(examples)) {
    assert.equal(validateToolArgsStrict(name, args as any, schemas[name]), null, name);
    assert.notEqual(
      validateToolArgsStrict(name, { ...(args as any), requestToken: "legacy" }, schemas[name]),
      null,
    );
    assert.notEqual(
      validateToolArgsStrict(
        name,
        { editor: { ...(args as any).editor, unexpected: 1 } },
        schemas[name],
      ),
      null,
    );
  }
  assert.equal(
    validateToolArgsStrict(
      "read_video_project",
      { editor: { view: "jobs", jobIds: ["actual-job"], format: "json" } },
      schemas.read_video_project,
    ),
    null,
  );
  assert.equal(
    validateToolArgsStrict("read_video_project", { view: "voices" }, schemas.read_video_project),
    null,
  );
  assert.equal(
    validateToolArgsStrict(
      "render_video_project",
      { projectId: "project", baseRevision: 4, requestToken: "old" },
      schemas.render_video_project,
    ),
    null,
  );
  for (const editor of [
    { identity, sequenceId, profileId: "mp4", requestId: "logical-render-1" },
    { identity, action: "cancel", operationId: "export-real-receipt" },
  ])
    assert.equal(
      validateToolArgsStrict("render_video_project", { editor }, schemas.render_video_project),
      null,
    );
  assert.notEqual(
    validateToolArgsStrict(
      "read_video_project",
      { editor: { view: "defaults" } },
      schemas.read_video_project,
    ),
    null,
  );
});

test("agent sequence planners preserve nested ID independence and share durable undo with UI edits", async (t) => {
  const h = await harness(t),
    before = h.session.read();
  await h.edit([
    {
      kind: "sequence",
      sequenceId,
      action: { kind: "compound", clipIds: ["a", "b"], name: "段落" },
    },
  ]);
  const compounded = h.session.read(),
    parent = compounded.sequences.find((item) => item.id === sequenceId)!,
    compound = parent.clips.find((item) => item.kind === "sequence")!;
  assert.equal(compound.kind, "sequence");
  assert.equal(compounded.sequences.length, 2);
  assert.equal(compound.duration, 6 * T);
  await h.edit([
    {
      kind: "sequence",
      sequenceId,
      action: { kind: "duplicate", name: "另一版本", activate: false },
    },
  ]);
  const copied = h.session.read(),
    copiedParent = copied.sequences.find((item) => item.name === "另一版本")!;
  assert.equal(copied.sequences.length, 4);
  assert.equal(copied.activeSequenceId, sequenceId);
  const copiedCompound = copiedParent.clips.find((item) => item.kind === "sequence")!;
  assert.equal(copiedCompound.kind, "sequence");
  assert.notEqual(copiedCompound.sequenceId, compound.sequenceId);
  assert.notEqual(copiedCompound.id, compound.id);
  assert.deepEqual(copied.assets, before.assets);
  h.session.undo();
  assert.deepEqual({ ...h.session.read(), revision: compounded.revision }, compounded);
  await h.edit([{ kind: "sequence", sequenceId, action: { kind: "unpack", clipId: compound.id } }]);
  const unpacked = h.session.read().sequences.find((item) => item.id === sequenceId)!;
  assert.equal(
    unpacked.clips.filter((item) => item.kind === "media" && item.assetId === "video").length,
    2,
  );
  h.session.undo();
  h.session.undo();
  assert.deepEqual({ ...h.session.read(), revision: before.revision }, before);
});

test("agent captions use source seconds, preserve source bindings and original words across translation, then explicitly detach", async (t) => {
  const h = await harness(t);
  const generated = await h.edit([
    {
      kind: "captions",
      sequenceId,
      action: {
        kind: "from-transcripts",
        assetIds: ["voice"],
        wordHighlight: true,
        transcripts: [
          {
            assetId: "voice",
            segments: [
              {
                text: "你好 世界",
                start: 0.1,
                end: 1.9,
                words: [
                  { text: "你好", start: 0.1, end: 0.9 },
                  { text: "世界", start: 1.1, end: 1.9 },
                ],
              },
            ],
          },
        ],
      },
    },
  ]);
  assert.equal(generated.addedClipCount, 1);
  const clipId = generated.addedClipIds[0]!.clipId,
    caption = () =>
      h.session.read().sequences[0]!.clips.find((clip) => clip.id === clipId) as TextClip,
    original = caption();
  assert.equal(original.start, T / 10);
  assert.equal(original.sourceBinding?.clipId, "voice-clip");
  assert.equal(original.words.length, 2);
  assert.equal(original.style.animation, "word-highlight");
  await h.edit([
    {
      kind: "captions",
      sequenceId,
      action: {
        kind: "translate",
        clipIds: [clipId],
        language: "en",
        mode: "bilingual",
        translations: [{ id: clipId, text: "Hello world" }],
      },
    },
    {
      kind: "captions",
      sequenceId,
      action: { kind: "style", clipIds: [clipId], patch: { fontSize: 60, color: "#ffffff" } },
    },
  ]);
  assert.equal(caption().text, "你好 世界\nHello world");
  assert.deepEqual(caption().words, original.words);
  assert.deepEqual(caption().sourceBinding, original.sourceBinding);
  assert.equal(caption().style.fontFamily, original.style.fontFamily);
  const translated = caption();
  const steps = [
    { kind: "captions", sequenceId, action: { kind: "detach", clipIds: [clipId] } },
    { kind: "captions", sequenceId, action: { kind: "text", clipId, text: "自由字幕" } },
  ];
  h.state.fail = true;
  await assert.rejects(h.edit(steps), /保存失败/);
  assert.deepEqual(caption(), translated);
  h.state.fail = false;
  await h.edit(steps);
  assert.equal(caption().sourceBinding, undefined);
  assert.equal(caption().translation, undefined);
  assert.equal(caption().words.length, 0);
  assert.equal(caption().style.animation, "none");
  h.session.undo();
  assert.deepEqual(caption(), translated);
});

test("sequence and caption AI schemas match supported planners and invalid or locked edits never write", async (t) => {
  const h = await harness(t),
    manifest = JSON.parse(await readFile("apps/video-studio/.codeshell-panel/panel.json", "utf8")),
    schema = manifest.agent.tools.find((item: any) => item.name === "apply_video_edit").inputSchema,
    validate = (step: unknown) =>
      validateToolArgsStrict(
        "apply_video_edit",
        { editor: { identity: h.session.getState().identity, label: "同源编辑", steps: [step] } },
        schema,
      );
  const good = [
    {
      kind: "sequence",
      action: {
        kind: "create",
        name: "竖屏",
        width: 1080,
        height: 1920,
        frameRate: { numerator: 30000, denominator: 1001 },
      },
    },
    { kind: "sequence", sequenceId, action: { kind: "nest", childSequenceId: "child", at: 8008 } },
    { kind: "sequence", sequenceId, action: { kind: "duplicate", activate: false } },
    {
      kind: "captions",
      sequenceId,
      action: { kind: "import-srt", text: "1\n00:00:00,001 --> 00:00:01,002\n原文\n" },
    },
    {
      kind: "captions",
      sequenceId,
      action: {
        kind: "style",
        clipIds: ["caption"],
        patch: {
          background: "#000000",
          italic: true,
          shadow: { color: "#000000", blur: 3, x: 2, y: 2 },
        },
      },
    },
    {
      kind: "captions",
      sequenceId,
      action: {
        kind: "from-transcripts",
        transcripts: [{ assetId: "voice", segments: [{ text: "真实识别", start: 0, end: 1 }] }],
      },
    },
  ];
  for (const step of good) assert.equal(validate(step), null, JSON.stringify(step));
  const bad = [
    { ...good[0], sequenceId },
    { kind: "sequence", sequenceId, action: { kind: "duplicate", activate: "false" } },
    { kind: "sequence", sequenceId, action: { kind: "unpack", clipId: "a", at: 0 } },
    {
      kind: "captions",
      sequenceId,
      action: { kind: "style", clipIds: ["caption"], patch: { sourceBinding: null } },
    },
    {
      kind: "captions",
      sequenceId,
      action: {
        kind: "from-transcripts",
        transcripts: [
          { assetId: "voice", segments: [{ text: "文字", start: 0, end: 1, invented: true }] },
        ],
      },
    },
  ];
  for (const step of bad) {
    assert.notEqual(validate(step), null);
    await assert.rejects(h.edit([step]));
  }
  assert.equal(h.state.writes.length, 0);
  const doc = fixture();
  doc.sequences[0]!.tracks.find((track) => track.id === "track-video-main")!.locked = true;
  doc.sequences[0]!.tracks.find((track) => track.kind === "text")!.locked = true;
  const locked = await harness(t, doc);
  await assert.rejects(
    locked.edit([
      { kind: "sequence", sequenceId, action: { kind: "compound", clipIds: ["a"], name: "锁轨" } },
    ]),
    /锁/,
  );
  await assert.rejects(
    locked.edit([
      { kind: "captions", sequenceId, action: { kind: "text", clipId: "caption", text: "改动" } },
    ]),
    /锁/,
  );
  assert.equal(locked.state.writes.length, 0);
  await h.edit([good[0]]);
  assert.equal(h.session.read().sequences.length, 2);
  const newId = h.session.read().activeSequenceId;
  await h.edit([{ kind: "sequence", sequenceId: newId, action: { kind: "remove" } }]);
  assert.equal(h.session.read().activeSequenceId, sequenceId);
  await h.edit([good[3]]);
  const imported = h.session
    .read()
    .sequences[0]!.clips.find((clip) => clip.kind === "text" && clip.text === "原文")!;
  assert.equal(imported.start, 240);
  assert.equal(imported.duration, 1001 * 240);
});

test("agent separation returns a real task receipt, applies only its reviewed candidate, and shares one durable undo", async (t) => {
  const doc = fixture(),
    assetId = `asset-${"a".repeat(64)}`,
    done = gate(),
    calls: string[] = [];
  doc.assets.find((asset) => asset.id === "voice")!.resourceId = assetId;
  const processed = {
    sourceResourceId: assetId,
    sourceSha256: "a".repeat(64),
    modelId: "uvr-mdx-kara-2-v1",
    modelSha256: "bf32e15105a09c0f7dddd2b67346146334d6f3ecb399ed7638eba2ab07cbf5f4",
    sampleRate: 44100,
    sampleCount: 441000,
    durationSeconds: 10,
    stems: {
      vocals: {
        assetId: `asset-${"b".repeat(64)}`,
        sha256: "b".repeat(64),
        bytes: 3528080,
        mimeType: "audio/wav",
      },
      instrumental: {
        assetId: `asset-${"c".repeat(64)}`,
        sha256: "c".repeat(64),
        bytes: 3528080,
        mimeType: "audio/wav",
      },
    },
  };
  const controller = createSeparationController({
    session: () => h.session,
    guard() {},
    apply: (ops, identity, label) => h.session.dispatchDurable(ops, identity, label),
    bridge: {
      separate: async (_id, _duration, options) => {
        calls.push("start");
        options!.onTask!({
          id: "separation-real-receipt",
          status: "running",
          attempt: 1,
          createdAt: 1,
          updatedAt: 1,
        });
        await done.promise;
        return structuredClone(processed);
      },
      list: async () => ({ jobs: [], nextOffset: 0, complete: true }),
      dispose() {},
    } as unknown as ReturnType<typeof createAudioSeparationBridge>,
  });
  t.after(() => controller.dispose());
  const h = await harness(t, doc, { separation: controller }),
    invoke = (request: unknown, identity = h.session.getState().identity) =>
      h.tools.apply_editor_edit({ identity, separation: request });
  const accepted = (await invoke({ action: "start", sequenceId, clipId: "voice-clip" })) as any;
  assert.equal(accepted.separation.taskId, "separation-real-receipt");
  assert.equal(accepted.separation.status, "submitted");
  assert.equal(controller.getState().phase, "running");
  assert.equal(h.state.writes.length, 0);
  await assert.rejects(invoke({ action: "apply", mode: "vocals" }), /请先/);
  await assert.rejects(invoke({ action: "cancel", jobId: "different-job" }), /任务已变化/);
  done.resolve();
  for (let i = 0; i < 10 && controller.getState().phase !== "preview"; i++) await Promise.resolve();
  assert.equal(controller.getState().phase, "preview");
  const state = (await invoke({ action: "status" })) as any;
  assert.equal(state.separation.candidate.result.sourceResourceId, assetId);
  await assert.rejects(invoke({ action: "apply", mode: "vocals", clipId: "a" }), /未知字段/);
  h.state.fail = true;
  await assert.rejects(invoke({ action: "apply", mode: "vocals" }), /保存失败/);
  assert.deepEqual(h.session.read(), doc);
  h.state.fail = false;
  const identity = h.session.getState().identity;
  await invoke({ action: "apply", mode: "both" });
  assert.equal(h.session.read().assets.length, doc.assets.length + 2);
  assert.equal(video(h.session.read(), "voice-clip").audio.volume, 0);
  assert.deepEqual(calls, ["start"]);
  await assert.rejects(
    invoke({ action: "start", sequenceId, clipId: "voice-clip" }, identity),
    /身份或版本/,
  );
  h.session.undo();
  assert.deepEqual({ ...h.session.read(), revision: doc.revision }, doc);
});

test("separation is a strict alternative in the existing Host tool, with explicit install and no mixed edit batch", async (t) => {
  const h = await harness(t),
    manifest = JSON.parse(await readFile("apps/video-studio/.codeshell-panel/panel.json", "utf8")),
    schema = manifest.agent.tools.find((tool: any) => tool.name === "apply_video_edit").inputSchema,
    identity = h.session.getState().identity;
  for (const request of [
    { action: "setup" },
    { action: "status" },
    { action: "refresh" },
    { action: "start", sequenceId, clipId: "voice-clip" },
    { action: "resume", sequenceId, clipId: "voice-clip", jobId: "actual-job" },
    { action: "jobs", sequenceId, clipId: "voice-clip", offset: 50 },
    { action: "apply", mode: "both" },
    { action: "cancel", jobId: "actual-job" },
  ])
    assert.equal(
      validateToolArgsStrict(
        "apply_video_edit",
        { editor: { identity, separation: request } },
        schema,
      ),
      null,
    );
  for (const editor of [
    {
      identity,
      separation: { action: "start", sequenceId, clipId: "voice-clip" },
      label: "mixed",
      steps: [],
    },
    { identity, separation: { action: "setup", url: "https://invalid.example/model" } },
    { identity, separation: { action: "apply", mode: "both", resourceId: "forged" } },
    { identity, separation: { action: "cancel" } },
  ])
    assert.notEqual(validateToolArgsStrict("apply_video_edit", { editor }, schema), null);
  await assert.rejects(
    h.tools.apply_editor_edit({ identity, separation: { action: "setup" } }),
    /尚未连接/,
  );
  assert.equal(h.state.writes.length, 0);
});

test("agent multicam planners record editable picture cuts while the master audio remains continuous", async (t) => {
  const doc = fixture();
  doc.assets.push({ ...structuredClone(doc.assets[0]!), id: "side", name: "侧面机位" });
  const h = await harness(t, doc),
    schema = JSON.parse(
      await readFile("apps/video-studio/.codeshell-panel/panel.json", "utf8"),
    ).agent.tools.find((tool: any) => tool.name === "apply_video_edit").inputSchema,
    create = {
      kind: "multicam",
      sequenceId,
      action: {
        kind: "create",
        assetIds: ["video", "side"],
        name: "访谈",
        at: 20 * T,
        offsets: { side: -T },
        audioAssetId: "video",
      },
    };
  assert.equal(
    validateToolArgsStrict(
      "apply_video_edit",
      { editor: { identity: h.session.getState().identity, label: "创建机位", steps: [create] } },
      schema,
    ),
    null,
  );
  const created = (await h.edit([create])) as any,
    clipId = created.addedClipIds[0].clipId,
    read = () =>
      h.session.read().sequences[0]!.clips.find((item) => item.id === clipId) as MulticamClip,
    original = read(),
    [front, side] = original.angles;
  assert.equal(original.duration, 9 * T);
  const steps = [
    {
      kind: "multicam",
      sequenceId,
      action: {
        kind: "record",
        clipId,
        start: 0,
        end: T,
        cuts: [
          { time: 0, angleId: front!.id },
          { time: 8008, angleId: side!.id },
        ],
      },
    },
    {
      kind: "multicam",
      sequenceId,
      action: { kind: "cut", clipId, time: 2 * T, angleId: front!.id },
    },
  ];
  assert.equal(
    validateToolArgsStrict(
      "apply_video_edit",
      { editor: { identity: h.session.getState().identity, label: "剪辑机位", steps } },
      schema,
    ),
    null,
  );
  const before = h.session.read();
  await h.edit(steps);
  assert.deepEqual(
    read().switches.map((item) => item.time),
    [0, 8008, 2 * T],
  );
  assert.equal(read().audioAngleId, front!.id);
  const frame = evaluateFrame(h.session.read(), sequenceId, 21 * T);
  assert.equal((frame.layers[0] as any).assetId, "side");
  assert.equal((frame.layers[0] as any).sourceTime, T);
  assert.equal(frame.audio[0]!.assetId, "video");
  assert.equal(frame.audio[0]!.sourceTime, 2 * T);
  const count = h.state.writes.length;
  await assert.rejects(
    h.edit([
      {
        kind: "multicam",
        sequenceId,
        action: { kind: "angles", clipId, trimToCommonRange: "true" },
      },
    ]),
    /布尔/,
  );
  await assert.rejects(
    h.edit([
      {
        kind: "multicam",
        sequenceId,
        action: { kind: "cut", clipId, time: T, angleId: "missing" },
      },
    ]),
  );
  assert.equal(h.state.writes.length, count);
  h.session.undo();
  assert.deepEqual({ ...h.session.read(), revision: before.revision }, before);
});

test("sync AI routes bounded state and accepted operations to the same reviewed workflow with exact identity", async (t) => {
  const calls: unknown[] = [],
    operationId = "c5f425b6-c8ac-4eb9-9f65-af90103696b5",
    sync = {
      getState: (options: unknown) => {
        calls.push(options);
        return {
          projectId: "project",
          stateProjectId: null,
          connected: false,
          operation: null,
          review: null,
        };
      },
      execute: (request: unknown, identity: unknown) => {
        calls.push({ request, identity });
        return {
          accepted: true,
          operationId,
          operation: { id: operationId, action: "connect", status: "running", message: "已接受" },
        };
      },
    } as unknown as NonNullable<EditorAgentContext["sync"]>;
  const h = await harness(t, fixture(), { sync }),
    identity = h.session.getState().identity;
  const result = (await h.tools.apply_editor_edit({
    identity,
    sync: { action: "status", limit: 7 },
  })) as any;
  assert.equal(result.sync.connected, false);
  assert.deepEqual(calls[0], { offset: 0, limit: 7 });
  const request = { action: "connect", requestId: "38c7bf2f-f554-4c3a-9ecf-f4053281b06e" };
  const started = (await h.tools.apply_editor_edit({ identity, sync: request })) as any;
  assert.equal(started.sync.operationId, operationId);
  assert.deepEqual(calls[1], { request, identity });
  assert.equal(h.state.writes.length, 0);
  await assert.rejects(
    h.tools.apply_editor_edit({ identity, sync: { action: "status", path: "/secret" } }),
    /未知字段/,
  );
  await h.edit([raw({ type: "project.rename", name: "changed" })]);
  await assert.rejects(h.tools.apply_editor_edit({ identity, sync: request }), /身份或版本/);
  assert.equal(calls.length, 2);
});

test("AI alignment submits a frozen source mapping, returns task receipt without editing, and guards async stale requests", async (t) => {
  const calls: unknown[] = [],
    authorized = gate();
  let waiting = false;
  const h = await harness(t, fixture(), {
    authorize: async () => {
      if (waiting) await authorized.promise;
    },
    alignMulticam: async (document, assets, reference, options) => {
      calls.push({ document: structuredClone(document), assets, reference, options });
      return {
        jobId: "real-align-job",
        documentId: "project",
        revision: 4,
        documentHash: "a".repeat(64),
        referenceAssetId: reference,
        assets: assets.map((assetId) => ({ assetId, resourceId: `asset-${"b".repeat(64)}` })),
      };
    },
  });
  const identity = h.session.getState().identity,
    request = {
      action: "start",
      requestId: "editor-alignment-request",
      assetIds: ["video", "side"],
      referenceAssetId: "video",
    };
  const started = (await h.tools.apply_editor_edit({ identity, alignment: request })) as any;
  assert.equal(started.alignment.jobId, "real-align-job");
  assert.equal(started.alignment.status, "submitted");
  assert.deepEqual((calls[0] as any).options, {
    transferId: request.requestId,
    windowSeconds: 30,
    maxOffsetSeconds: 10,
  });
  assert.deepEqual((calls[0] as any).document, fixture());
  assert.equal(h.state.writes.length, 0);
  await assert.rejects(
    h.tools.apply_editor_edit({ identity, alignment: { ...request, windowSeconds: 181 } }),
    /分析秒数/,
  );
  waiting = true;
  const stale = h.tools.apply_editor_edit({ identity, alignment: request });
  h.session.dispatch([{ type: "project.rename", name: "midway edit" }], identity);
  authorized.resolve();
  await assert.rejects(stale, /身份或版本/);
  assert.equal(calls.length, 1);
});

test("Host tool discovers isolated sync and sound alignment request alternatives", async (t) => {
  const h = await harness(t),
    manifest = JSON.parse(await readFile("apps/video-studio/.codeshell-panel/panel.json", "utf8")),
    schema = manifest.agent.tools.find((tool: any) => tool.name === "apply_video_edit").inputSchema,
    identity = h.session.getState().identity,
    requestId = "d58daef5-aeb1-4efb-8cd7-a3d16c569ca2";
  for (const request of [
    { sync: { action: "status", limit: 50 } },
    { sync: { action: "connect", requestId } },
    { sync: { action: "preview", requestId, snapshotId: "a".repeat(64) } },
    {
      sync: {
        action: "choose",
        requestId,
        reviewId: requestId,
        conflictKey: "sequence:main",
        choice: "left",
      },
    },
    { sync: { action: "cancel", operationId: requestId } },
    { alignment: { action: "start", requestId, assetIds: ["a", "b"], referenceAssetId: "a" } },
    { alignment: { action: "cancel", jobId: "actual-job" } },
  ])
    assert.equal(
      validateToolArgsStrict("apply_video_edit", { editor: { identity, ...request } }, schema),
      null,
    );
  for (const request of [
    { sync: { action: "publish" } },
    { sync: { action: "cancel", requestId } },
    { sync: { action: "connect", requestId, directoryHandle: "forged" } },
    { alignment: { action: "start", requestId, assetIds: ["a"], referenceAssetId: "a" } },
    { sync: { action: "status" }, separation: { action: "status" } },
  ])
    assert.notEqual(
      validateToolArgsStrict("apply_video_edit", { editor: { identity, ...request } }, schema),
      null,
    );
});

test("AI sound enhancement uses the shared candidate controller and never accepts separation setup or raw derived resources", async (t) => {
  const calls: unknown[] = [],
    state = { phase: "idle", message: "ready", taskId: undefined as string | undefined };
  const controller = {
    getState: () => structuredClone(state),
    startInBackground: async (sequence: string, clip: string, settings: unknown) => {
      calls.push({ sequence, clip, settings });
      state.phase = "running";
      state.taskId = "real-enhance-task";
      return { taskId: state.taskId };
    },
    apply: async () => {
      calls.push("apply");
      state.phase = "idle";
    },
  } as unknown as NonNullable<EditorAgentContext["enhancement"]>;
  const h = await harness(t, fixture(), { enhancement: controller }),
    identity = h.session.getState().identity,
    settings = { preset: "balanced", denoise: true, normalize: false },
    request = { action: "start", sequenceId, clipId: "voice-clip", settings };
  const response = (await h.tools.apply_editor_edit({ identity, enhancement: request })) as any;
  assert.equal(response.enhancement.taskId, "real-enhance-task");
  assert.equal(response.enhancement.status, "submitted");
  assert.deepEqual(calls, [{ sequence: sequenceId, clip: "voice-clip", settings }]);
  await assert.rejects(
    h.tools.apply_editor_edit({ identity, enhancement: { action: "setup" } }),
    /未知/,
  );
  await assert.rejects(
    h.tools.apply_editor_edit({
      identity,
      enhancement: { ...request, settings: { ...settings, modelPath: "/invalid" } },
    }),
    /设置无效/,
  );
  await assert.rejects(
    h.tools.apply_editor_edit({ identity, enhancement: { action: "apply", assetId: "forged" } }),
    /未知字段/,
  );
  await h.tools.apply_editor_edit({ identity, enhancement: { action: "apply" } });
  assert.equal(calls.at(-1), "apply");
  const schema = JSON.parse(
    await readFile("apps/video-studio/.codeshell-panel/panel.json", "utf8"),
  ).agent.tools.find((tool: any) => tool.name === "apply_video_edit").inputSchema;
  assert.equal(
    validateToolArgsStrict(
      "apply_video_edit",
      { editor: { identity, enhancement: request } },
      schema,
    ),
    null,
  );
  assert.notEqual(
    validateToolArgsStrict(
      "apply_video_edit",
      { editor: { identity, enhancement: { action: "setup" } } },
      schema,
    ),
    null,
  );
});

test("AI conflict reads bind the exact review and preserve full JSON chunks instead of summaries", async (t) => {
  const reviewId = "5bc7be1b-c07b-4c5f-9288-46fcb5c82f8b",
    received: unknown[] = [],
    context = {
      inspectConflict: async (request: unknown, identity: unknown) => {
        received.push({ request, identity });
        return {
          reviewId,
          conflictKey: "sequence:main",
          side: "left",
          present: true,
          encoding: "json-utf16",
          offset: 0,
          limit: 4096,
          length: 20000,
          text: '{"present":true,"value":',
          nextOffset: 23,
        };
      },
    } as unknown as NonNullable<EditorAgentContext["sync"]>;
  const h = await harness(t, fixture(), { sync: context }),
    identity = h.session.getState().identity,
    request = {
      action: "inspect",
      expectedReviewId: reviewId,
      conflictKey: "sequence:main",
      side: "left",
      offset: 0,
    };
  const result = (await h.tools.apply_editor_edit({ identity, sync: request })) as any;
  assert.equal(result.sync.reviewId, reviewId);
  assert.equal(result.sync.nextOffset, 23);
  assert.equal(result.sync.length, 20000);
  assert.deepEqual(received[0], {
    identity,
    request: { expectedReviewId: reviewId, conflictKey: "sequence:main", side: "left", offset: 0 },
  });
  const schema = JSON.parse(
    await readFile("apps/video-studio/.codeshell-panel/panel.json", "utf8"),
  ).agent.tools.find((tool: any) => tool.name === "apply_video_edit").inputSchema;
  assert.equal(
    validateToolArgsStrict("apply_video_edit", { editor: { identity, sync: request } }, schema),
    null,
  );
  assert.notEqual(
    validateToolArgsStrict(
      "apply_video_edit",
      { editor: { identity, sync: { action: "apply", requestId: reviewId } } },
      schema,
    ),
    null,
  );
  assert.equal(h.state.writes.length, 0);
});

test("markers and keyword emphasis use shared planners and strict manifest exposes clipboard and portable requests", async (t) => {
  const h = await harness(t),
    subtitle = h.session.read().sequences[0]!.clips.find((clip) => clip.kind === "text")!;
  await h.edit([
    {
      kind: "marker",
      sequenceId,
      action: {
        action: "add",
        marker: {
          id: "review-range",
          time: 8008,
          duration: 16016,
          name: "检查",
          note: "精确 NTSC 范围",
          color: "#ffcc00",
        },
      },
    },
    {
      kind: "captions",
      sequenceId,
      action: {
        kind: "style",
        clipIds: [subtitle.id],
        patch: { keywords: [{ text: "真实", color: "#ffcc00" }] },
      },
    },
  ]);
  assert.equal(h.session.read().sequences[0]!.markers[0]!.time, 8008);
  assert.deepEqual(
    (h.session.read().sequences[0]!.clips.find((clip) => clip.id === subtitle.id) as TextClip).style
      .keywords,
    [{ text: "真实", color: "#ffcc00" }],
  );
  h.session.undo(h.session.getState().identity);
  assert.equal(h.session.read().sequences[0]!.markers.length, 0);
  const manifest = JSON.parse(
      await readFile("apps/video-studio/.codeshell-panel/panel.json", "utf8"),
    ),
    schema = manifest.agent.tools.find((tool: any) => tool.name === "apply_video_edit").inputSchema,
    identity = h.session.getState().identity;
  for (const request of [
    { clipboard: { action: "copy", sequenceId, clipIds: ["a"] } },
    { clipboard: { action: "paste", sequenceId, clipboardId: "clipboard-real", at: 10 * T } },
    {
      portable: {
        action: "import",
        requestId: "import-real",
        resourceId: `asset-${"a".repeat(64)}`,
      },
    },
    { portable: { action: "inspect", pendingId: "review-real", path: "/sequences", limit: 10 } },
    {
      sync: {
        action: "keep-current",
        requestId: "00000000-0000-4000-8000-000000000001",
        expectedApplyId: "00000000-0000-4000-8000-000000000002",
      },
    },
    { label: "原位复制", steps: [{ kind: "duplicate", sequenceId, clipIds: ["a"] }] },
    {
      label: "范围标记",
      steps: [
        { kind: "marker", sequenceId, action: { action: "remove", markerId: "review-range" } },
      ],
    },
  ])
    assert.equal(
      validateToolArgsStrict("apply_video_edit", { editor: { identity, ...request } }, schema),
      null,
      JSON.stringify(request),
    );
  for (const portable of [
    { action: "import", requestId: "x", resourceId: "x", path: "/private/file" },
    { action: "apply", requestId: "x" },
    { action: "inspect", pendingId: "x", limit: 9000 },
  ])
    assert.notEqual(
      validateToolArgsStrict("apply_video_edit", { editor: { identity, portable } }, schema),
      null,
    );
});

test("agent portable inspection is paged and asynchronous authorization cannot import into a stale identity", async (t) => {
  const wait = gate(),
    calls: any[] = [];
  const h = await harness(t, fixture(), {
    portable: {
      getState: () => ({ busy: false, pending: null }) as any,
      readCandidate: (pendingId) => {
        assert.equal(pendingId, "candidate-real");
        return fixture();
      },
      execute: (request, identity) => {
        calls.push({ request, identity });
        return { accepted: true, operationId: request.requestId };
      },
    },
    authorize: async () => wait.promise,
  });
  const inspect = (await h.tools.apply_editor_edit({
    identity: h.session.getState().identity,
    portable: {
      action: "inspect",
      pendingId: "candidate-real",
      path: "/sequences/0/clips",
      limit: 2,
    },
  })) as any;
  assert.equal(inspect.page.entries.length, 2);
  assert.notEqual(inspect.page.nextOffset, null);
  const pending = h.tools.apply_editor_edit({
    identity: h.session.getState().identity,
    portable: { action: "export", requestId: "portable-export" },
  });
  h.session.dispatch([{ type: "project.rename", name: "已修改" }], h.session.getState().identity);
  wait.resolve();
  await assert.rejects(pending, /版本已变化/);
  assert.equal(calls.length, 0);
});

test("AI text edits cannot leave stale timed words or translation, including free title layers", async (t) => {
  const doc = fixture(),
    clip = doc.sequences[0]!.clips.find((item): item is TextClip => item.kind === "text")!;
  clip.role = "title";
  clip.text = "old";
  clip.words = [{ text: "old", start: 0, end: clip.duration }];
  clip.style.animation = "word-highlight";
  const h = await harness(t, doc);
  await assert.rejects(
    h.edit([raw({ type: "clip.update", sequenceId, clipId: clip.id, patch: { text: "new" } })]),
    /字幕 planner/,
  );
  await h.edit([
    { kind: "captions", sequenceId, action: { kind: "text", clipId: clip.id, text: "new" } },
  ]);
  const result = h.session
    .read()
    .sequences[0]!.clips.find((item): item is TextClip => item.id === clip.id)!;
  assert.equal(result.text, "new");
  assert.deepEqual(result.words, []);
  assert.equal(result.style.animation, "none");
  h.session.undo();
  assert.deepEqual(
    (h.session.read().sequences[0]!.clips.find((item) => item.id === clip.id) as TextClip).words,
    clip.words,
  );
});
