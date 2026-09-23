import assert from "node:assert/strict";
import test from "node:test";
import { createProject, validateProject } from "../apps/video-studio/src/model";
import { ProductionController } from "../apps/video-studio/src/production";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import {
  editorClipIdForLegacyAudio,
  projectLegacyView,
} from "../apps/video-studio/src/editor/legacy-adapter";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import {
  createTrack,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import {
  canonicalVoiceoverReceipt,
  captureReplaceTarget,
  planPublishVoiceover,
  resolveReplaceTarget,
  verifyReplaceTarget,
  type VoiceoverPublication,
} from "../apps/video-studio/src/editor/voiceover-publication";
import { resolveLegacyClipId } from "../apps/video-studio/src/editor/legacy-aliases";
import type { EditorDocument, MediaClip } from "../apps/video-studio/src/editor/types";
import { validateEditorDocument } from "../apps/video-studio/src/editor/validation";

const T = 240000,
  source = `asset-${"a".repeat(64)}`,
  resultId = `asset-${"b".repeat(64)}`;
function fixture() {
  const legacy = validateProject({
    ...createProject(),
    assets: [
      { id: "picture", kind: "image", name: "画面", durationFrames: 300 },
      { id: "voice", kind: "audio", name: "原配音", durationFrames: 120, mediaId: source },
    ],
    clips: [{ id: "picture-clip", assetId: "picture", inFrame: 0, outFrame: 300, volume: 1 }],
    audioClips: [
      { id: "voice-clip", assetId: "voice", inFrame: 0, outFrame: 90, startFrame: 30, volume: 0.2 },
    ],
  });
  const doc = migrateLegacyProject(legacy),
    seq = doc.sequences[0]!,
    clip = seq.clips.find((c) => c.kind === "media" && c.assetId === "voice") as MediaClip;
  clip.audio.volume = {
    keyframes: [
      { time: 0, value: 0.2 },
      { time: T, value: 0.8 },
      { time: 3 * T, value: 0.4 },
    ],
  };
  clip.audio.pan = 0.3;
  clip.audio.fadeIn = 8000;
  clip.audio.fadeOut = 16000;
  clip.audio.pitchSemitones = 3;
  return { doc, seq, clip };
}
function raw(seconds = 4) {
  return {
    asset: {
      id: resultId,
      sha256: "b".repeat(64),
      name: "新配音",
      mimeType: "audio/wav",
      bytes: 384044,
    },
    inspection: {
      kind: "audio",
      durationSeconds: seconds,
      audio: { sampleRate: 48000, channels: 1 },
    },
    speech: { text: "实际生成的文案", voiceId: "voice", engine: "macos-say", rate: 1 },
  };
}
function context(): VoiceoverPublication {
  const { doc, seq, clip } = fixture();
  return {
    jobId: "job-tts",
    origin: { sequenceId: seq.id, revision: doc.revision },
    placement: { startFrame: 1, replaceTarget: captureReplaceTarget(doc, seq.id, clip.id) },
  };
}
function legacyContext(): VoiceoverPublication {
  const { doc, seq } = fixture(),
    view = projectLegacyView(doc, seq.id);
  return {
    jobId: "job-tts",
    origin: { sequenceId: seq.id, revision: doc.revision },
    placement: { startFrame: 0, replaceClip: structuredClone(view.project.audioClips![0]!) },
  };
}
/** Real footage: the voice source is not a whole number of 30 fps frames. */
function offFrame(doc: EditorDocument, clip: MediaClip, duration = 3 * T + 777) {
  doc.assets.find((a) => a.id === clip.assetId)!.duration = duration;
  clip.duration = duration;
  clip.timeMap = {
    points: [
      { time: 0, source: 0 },
      { time: duration, source: duration },
    ],
  };
  return validateEditorDocument(doc);
}
const ids = () => {
  let n = 0;
  return () => `generated-${++n}`;
};
test("native voiceover uses actual subframe duration and keeps genuine speech recipe", () => {
  const result = canonicalVoiceoverReceipt(raw(192005 / 48000));
  assert.equal(result.asset.duration, 4 * T + 25);
  assert.deepEqual(result.asset.metadata!.speech, raw().speech);
  assert.throws(() =>
    canonicalVoiceoverReceipt({ ...raw(), asset: { ...raw().asset, sha256: "c".repeat(64) } }),
  );
  assert.throws(() => canonicalVoiceoverReceipt(raw(NaN)));
});
test("same-duration replacement keeps the original clip identity, exact timing, every audio animation and track properties", () => {
  const { doc, seq, clip } = fixture(),
    before = structuredClone(doc);
  seq.tracks.find((t) => t.id === clip.trackId)!.volume = 0.7;
  const plan = planPublishVoiceover(doc, canonicalVoiceoverReceipt(raw()), context(), ids()),
    next = applyEditorOperations(doc, plan.operations, doc.revision),
    replaced = next.sequences[0]!.clips.find((c) => c.id === clip.id) as MediaClip;
  assert.equal(plan.placed, true);
  assert.deepEqual(replaced, { ...clip, assetId: resultId });
  assert.deepEqual(next.sequences[0]!.tracks, doc.sequences[0]!.tracks);
  assert.equal(next.sequences[0]!.clips.length, before.sequences[0]!.clips.length);
  const replay = planPublishVoiceover(next, canonicalVoiceoverReceipt(raw()), context(), ids());
  assert.equal(replay.placed, true);
  assert.deepEqual(replay.operations, []);
});
test("different length, stale identity, locked target and missing old origin retain only the new source", () => {
  for (const mode of ["duration", "stale", "locked", "origin"]) {
    const { doc, seq, clip } = fixture(),
      request = context(),
      before = structuredClone(doc.sequences);
    let result = canonicalVoiceoverReceipt(raw());
    if (mode === "duration") result = canonicalVoiceoverReceipt(raw(4 + 1 / 48000));
    if (mode === "stale") doc.revision++;
    if (mode === "locked") seq.tracks.find((t) => t.id === clip.trackId)!.locked = true;
    if (mode === "origin") delete request.origin;
    const prior = structuredClone(doc.sequences),
      plan = planPublishVoiceover(doc, result, request),
      next = applyEditorOperations(doc, plan.operations, doc.revision);
    assert.equal(plan.placed, false);
    assert.match(plan.notice, /素材库/);
    assert.deepEqual(next.sequences, prior);
    assert.equal(next.assets.length, 3);
  }
});
test("bound subtitles preserve text, words and source provenance instead of deletion or rebinding", () => {
  const { doc, seq, clip } = fixture();
  seq.tracks.push(createTrack("captions", "text"));
  seq.clips.push({
    id: "subtitle",
    trackId: "captions",
    kind: "text",
    role: "subtitle",
    label: "字幕",
    start: clip.start,
    duration: T,
    text: "旧文案",
    style: defaultTextStyle(),
    words: [{ text: "旧文案", start: 0, end: T }],
    sourceBinding: {
      clipId: clip.id,
      sourceStart: 0,
      sourceEnd: T,
      provenance: { path: [], assetId: "voice", start: 0, end: T },
    },
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  });
  const before = structuredClone(seq),
    plan = planPublishVoiceover(doc, canonicalVoiceoverReceipt(raw()), context()),
    next = applyEditorOperations(doc, plan.operations, doc.revision);
  assert.equal(plan.placed, false);
  assert.match(plan.notice, /字幕/);
  assert.deepEqual(next.sequences[0], before);
});
test("new placement uses original sequence and precise available ticks, survives replay and never follows later active selection", () => {
  const { doc, seq } = fixture();
  seq.clips[0]!.duration += 1001;
  (seq.clips[0] as MediaClip).timeMap.points[1]!.time += 1001;
  (seq.clips[0] as MediaClip).timeMap.points[1]!.source += 1001;
  doc.assets[0]!.duration += 1001;
  const request = {
      jobId: "job-new",
      origin: { sequenceId: seq.id, revision: doc.revision },
      placement: { startFrame: 0 },
    },
    plan = planPublishVoiceover(doc, canonicalVoiceoverReceipt(raw(12)), request, ids()),
    next = applyEditorOperations(doc, plan.operations, doc.revision),
    added = next.sequences[0]!.clips.find((c) => c.id === "voice-job-new") as MediaClip;
  assert.equal(added.duration, 10 * T + 1001);
  assert.equal(next.assets[2]!.duration, 12 * T);
  assert.match(plan.notice, /超过画面/);
  assert.deepEqual(
    planPublishVoiceover(next, canonicalVoiceoverReceipt(raw(12)), request).operations,
    [],
  );
  const stale = structuredClone(doc);
  stale.revision++;
  const late = planPublishVoiceover(stale, canonicalVoiceoverReceipt(raw()), request);
  assert.equal(late.placed, false);
  assert.ok(late.operations.every((op) => op.type === "asset.add"));
});
function productionBridge(jobs: any[], initial: any = null) {
  const state: { saved: any; revision: number } = { saved: initial, revision: initial ? 1 : 0 };
  const bridge: any = {
    getContext: async () => ({}),
    on: () => () => {},
    async call(method: string, args: any) {
      if (method === "media.status")
        return {
          persistent: true,
          ffmpeg: { available: true },
          transcription: { available: false },
          hyperframes: { available: false },
          tts: { available: true },
        };
      if (method === "media.document.get") return { data: state.saved, revision: state.revision };
      if (method === "media.document.set") {
        assert.equal(args.baseRevision, state.revision);
        state.saved = structuredClone(args.data);
        return { revision: ++state.revision };
      }
      if (method === "media.jobs.list") return { jobs };
      if (method === "media.jobs.get") return jobs.find((job) => job.id === args.id);
      if (method === "media.tts") return jobs[0];
      throw new Error(method);
    },
  };
  return { bridge, state };
}
const ttsJob = (id: string) => ({
  id,
  type: "tts",
  status: "succeeded",
  createdAt: 1,
  updatedAt: 1,
  attempt: 1,
  result: raw(),
});
test("canonical production callback persists origin and the editor target before completion, retries failed publication and never calls legacy replacement", async () => {
  const { doc, seq, clip } = fixture(),
    view = projectLegacyView(doc, seq.id),
    target = captureReplaceTarget(doc, seq.id, clip.id),
    { bridge, state } = productionBridge([ttsJob("job-tts")]);
  let fail = true,
    publishes = 0,
    captured = 0,
    verified = 0;
  const callbacks = {
    getProject: () => view.project,
    publishAssets: async () => assert.fail("must bypass legacy"),
    captureVoiceoverOrigin: () => {
      captured++;
      return { sequenceId: seq.id, revision: doc.revision };
    },
    verifyReplaceTarget: (value: any) => {
      verified++;
      assert.deepEqual(value, target);
      return true;
    },
    publishVoiceover: async (projectId: string, result: any, request: VoiceoverPublication) => {
      publishes++;
      assert.equal(projectId, doc.id);
      assert.equal(result.asset.duration, 4 * T);
      assert.deepEqual(request.origin, { sequenceId: seq.id, revision: doc.revision });
      assert.deepEqual(request.placement!.replaceTarget, target);
      assert.equal(request.placement!.replaceClip, undefined);
      if (fail) throw new Error("保存失败");
    },
    changed() {},
  };
  const controller = new ProductionController(bridge, callbacks);
  try {
    await controller.initialize();
    await controller.createVoiceover(
      { text: "真实文案" },
      { startFrame: 0, attach: true, replaceTarget: structuredClone(target) },
    );
    assert.equal(verified, 1);
    await assert.rejects(controller.refresh(), /保存失败/);
    assert.equal(captured, 1);
    const persisted = Object.values(state.saved.bindings)[0] as any;
    assert.deepEqual(persisted.replaceTarget, target);
    assert.notEqual(persisted.consumed, true);
    controller.dispose();
    fail = false;
    const restored = new ProductionController(bridge, callbacks);
    try {
      await restored.initialize();
      await restored.refresh();
      assert.ok(publishes >= 2);
      assert.equal(captured, 1);
      assert.equal(
        Object.values(state.saved.bindings).some((b: any) => b.consumed),
        true,
      );
    } finally {
      restored.dispose();
    }
  } finally {
    controller.dispose();
  }
});
test("a replacement target the editor no longer recognizes is rejected before synthesis is queued", async () => {
  const { doc, seq, clip } = fixture(),
    view = projectLegacyView(doc, seq.id),
    target = captureReplaceTarget(doc, seq.id, clip.id),
    { bridge } = productionBridge([ttsJob("job-tts")]);
  const calls: string[] = [];
  const traced: any = { ...bridge, call: (m: string, a: any) => (calls.push(m), bridge.call(m, a)) };
  for (const verify of [() => false, undefined]) {
    const controller = new ProductionController(traced, {
      getProject: () => view.project,
      publishAssets: async () => {},
      ...(verify ? { verifyReplaceTarget: verify } : {}),
      changed() {},
    });
    try {
      await controller.initialize();
      await assert.rejects(
        controller.createVoiceover(
          { text: "修改文案" },
          { startFrame: 0, attach: true, replaceTarget: target },
        ),
        /原配音已被调整/,
      );
      assert.equal(calls.includes("media.tts"), false);
    } finally {
      controller.dispose();
    }
  }
});
test("saved job bindings accept the editor target and the earlier frame snapshot, and hand both to the editor", async () => {
  const { doc, seq, clip } = fixture(),
    view = projectLegacyView(doc, seq.id),
    target = captureReplaceTarget(doc, seq.id, clip.id),
    legacy = structuredClone(view.project.audioClips![0]!);
  const binding = (jobId: string, extra: object) => ({
    jobId,
    projectId: doc.id,
    purpose: "tts",
    attachAudio: true,
    startFrame: 30,
    voiceoverOrigin: { sequenceId: seq.id, revision: doc.revision },
    ...extra,
  });
  const documentWith = (bindings: Record<string, object>) => ({
    schemaVersion: 1,
    bindings,
    auto: null,
  });
  const received: VoiceoverPublication[] = [];
  const callbacks = {
    getProject: () => view.project,
    publishAssets: async () => assert.fail("must bypass legacy"),
    publishVoiceover: async (_: string, __: any, request: VoiceoverPublication) => {
      received.push(structuredClone(request));
    },
    changed() {},
  };
  const { bridge, state } = productionBridge(
    [ttsJob("job-native"), ttsJob("job-legacy")],
    documentWith({
      "job-native": binding("job-native", { replaceTarget: target }),
      "job-legacy": binding("job-legacy", { replaceClip: legacy }),
    }),
  );
  const controller = new ProductionController(bridge, callbacks);
  try {
    await controller.initialize();
    assert.equal(controller.error, "");
    await controller.refresh();
  } finally {
    controller.dispose();
  }
  assert.deepEqual(
    received.map((r) => [r.jobId, r.placement]).sort(),
    [
      ["job-legacy", { startFrame: 30, replaceClip: legacy }],
      ["job-native", { startFrame: 30, replaceTarget: target }],
    ],
  );
  assert.ok(Object.values(state.saved.bindings).every((b: any) => b.consumed));
  for (const invalid of [
    { replaceTarget: { ...target, duration: 0 } },
    { replaceTarget: { ...target, timeMap: { points: [{ time: 0, source: 0 }] } } },
    { replaceTarget: { ...target, extra: true } },
    { replaceTarget: target, replaceClip: legacy },
    { replaceTarget: target, attachAudio: false },
  ]) {
    const { bridge: other } = productionBridge(
      [],
      documentWith({ "job-bad": binding("job-bad", invalid) }),
    );
    const rejected = new ProductionController(other, callbacks);
    try {
      await rejected.initialize();
      assert.match(rejected.error, /制作任务记录无法恢复/, JSON.stringify(Object.keys(invalid)));
    } finally {
      rejected.dispose();
    }
  }
});

test("identical imported bytes keep existing metadata while a distinct generated recipe stays replayable", () => {
  const { doc } = fixture(),
    result = canonicalVoiceoverReceipt(raw());
  doc.assets.push({ ...structuredClone(result.asset), metadata: { sourcePath: "original.wav" } });
  const plan = planPublishVoiceover(doc, result, { jobId: "job-library" }, ids()),
    next = applyEditorOperations(doc, plan.operations, doc.revision);
  assert.equal(next.assets.length, 4);
  assert.equal(next.assets[2]!.metadata!.sourcePath, "original.wav");
  assert.deepEqual(next.assets[3]!.metadata!.speech, result.asset.metadata!.speech);
  assert.notEqual(next.assets[3]!.id, result.asset.id);
  assert.deepEqual(planPublishVoiceover(next, result, { jobId: "job-library" }).operations, []);
});

test("real footage voice whose length is not a whole old frame is replaced in place from the editor target", () => {
  const { doc, seq, clip } = fixture(),
    real = offFrame(doc, clip),
    realClip = real.sequences[0]!.clips.find((c) => c.id === clip.id) as MediaClip;
  assert.equal(
    projectLegacyView(real, seq.id).clips.some((c) => c.clipId === clip.id),
    false,
    "the old frame view cannot see this voice",
  );
  const request: VoiceoverPublication = {
    jobId: "job-real",
    origin: { sequenceId: seq.id, revision: real.revision },
    placement: { startFrame: 1, replaceTarget: captureReplaceTarget(real, seq.id, clip.id) },
  };
  const result = canonicalVoiceoverReceipt(raw((3 * T + 777) / T));
  assert.equal(result.asset.duration, 3 * T + 777);
  const plan = planPublishVoiceover(real, result, request, ids()),
    next = applyEditorOperations(real, plan.operations, real.revision);
  assert.equal(plan.placed, true, plan.notice);
  assert.match(plan.notice, /已替换配音/);
  assert.deepEqual(
    next.sequences[0]!.clips.find((c) => c.id === clip.id),
    { ...realClip, assetId: resultId },
  );
  assert.equal(next.sequences[0]!.clips.length, real.sequences[0]!.clips.length);
  const replay = planPublishVoiceover(next, result, request, ids());
  assert.equal(replay.placed, true);
  assert.deepEqual(replay.operations, []);
});

test("a voiceover on a second audio track of a multitrack sequence is replaced without touching the first", () => {
  const { doc, seq, clip } = fixture();
  doc.assets.push({
    id: "second-voice",
    name: "第二段配音",
    kind: "audio",
    duration: 4 * T,
    resourceId: `asset-${"c".repeat(64)}`,
    fingerprint: "c".repeat(64),
    metadata: { speech: { text: "第二段", voiceId: "voice", engine: "macos-say", rate: 1 } },
  });
  seq.tracks.push(createTrack("a2", "audio", "第二条配音"));
  const second: MediaClip = {
    ...structuredClone(clip),
    id: "second-voice-clip",
    trackId: "a2",
    assetId: "second-voice",
    start: 1_234_567,
    duration: 2 * T + 13,
    timeMap: {
      points: [
        { time: 0, source: 5 },
        { time: 2 * T + 13, source: 2 * T + 18 },
      ],
    },
  };
  second.audio.volume = 0.6;
  seq.clips.push(second);
  const checked = validateEditorDocument(doc),
    first = structuredClone(checked.sequences[0]!.clips.find((c) => c.id === clip.id));
  const request: VoiceoverPublication = {
      jobId: "job-second",
      origin: { sequenceId: seq.id, revision: checked.revision },
      placement: {
        startFrame: 0,
        replaceTarget: captureReplaceTarget(checked, seq.id, "second-voice-clip"),
      },
    },
    plan = planPublishVoiceover(checked, canonicalVoiceoverReceipt(raw()), request, ids()),
    next = applyEditorOperations(checked, plan.operations, checked.revision);
  assert.equal(plan.placed, true, plan.notice);
  const clips = next.sequences[0]!.clips;
  assert.deepEqual(clips.find((c) => c.id === "second-voice-clip"), {
    ...checked.sequences[0]!.clips.find((c) => c.id === "second-voice-clip"),
    assetId: resultId,
  });
  assert.deepEqual(clips.find((c) => c.id === clip.id), first);
  assert.deepEqual(next.sequences[0]!.tracks, checked.sequences[0]!.tracks);
});

test("a saved frame snapshot still finds its clip through the old ID alias and replaces it", () => {
  const { doc, seq, clip } = fixture(),
    request = legacyContext(),
    legacyId = request.placement!.replaceClip!.id;
  // A later edit gave the canonical clip a different ID; only the alias remembers the old one.
  clip.id = "canonical-voice";
  doc.production = {
    ...(doc.production ?? {}),
    legacyAliases: [
      { sequenceId: seq.id, collection: "audioClips", legacyId, clipId: "canonical-voice" },
    ],
  };
  const aliased = validateEditorDocument(doc);
  assert.equal(resolveLegacyClipId(aliased, seq.id, "audioClips", legacyId), "canonical-voice");
  assert.equal(resolveLegacyClipId(aliased, seq.id, "audioClips", "missing"), undefined);
  assert.equal(
    resolveReplaceTarget(aliased, request.placement!.replaceClip!, seq.id)?.id,
    "canonical-voice",
  );
  const plan = planPublishVoiceover(aliased, canonicalVoiceoverReceipt(raw()), request, ids()),
    next = applyEditorOperations(aliased, plan.operations, aliased.revision);
  assert.equal(plan.placed, true, plan.notice);
  assert.equal(
    (next.sequences[0]!.clips.find((c) => c.id === "canonical-voice") as MediaClip).assetId,
    resultId,
  );
  const replay = planPublishVoiceover(next, canonicalVoiceoverReceipt(raw()), request, ids());
  assert.deepEqual(replay.operations, []);
  assert.equal(replay.placed, true);
});

test("a moved, trimmed, re-timed, re-tracked or deleted original keeps the new voice in the library only", () => {
  const edits: Array<[string, (doc: EditorDocument, clip: MediaClip) => void]> = [
    ["moved", (_, c) => void (c.start += 1)],
    [
      "trimmed",
      (_, c) => {
        c.duration -= 8000;
        c.timeMap.points[1] = { time: c.duration, source: c.duration };
        c.audio.volume = 0.2;
      },
    ],
    [
      "slipped",
      (_, c) => {
        c.timeMap.points[0]!.source += 8000;
        c.timeMap.points[1]!.source += 8000;
      },
    ],
    [
      "re-tracked",
      (d, c) => {
        d.sequences[0]!.tracks.push(createTrack("a9", "audio", "另一条音轨"));
        c.trackId = "a9";
      },
    ],
    [
      "deleted",
      (d, c) => void (d.sequences[0]!.clips = d.sequences[0]!.clips.filter((x) => x.id !== c.id)),
    ],
  ];
  for (const legacy of [false, true])
    for (const [name, edit] of edits) {
      // Frame snapshots never recorded a track, exactly as before.
      if (legacy && name === "re-tracked") continue;
      const { doc, clip } = fixture(),
        request = legacy ? legacyContext() : context();
      edit(doc, clip);
      const edited = validateEditorDocument(doc),
        prior = structuredClone(edited.sequences),
        plan = planPublishVoiceover(edited, canonicalVoiceoverReceipt(raw()), request, ids()),
        next = applyEditorOperations(edited, plan.operations, edited.revision);
      assert.equal(plan.placed, false, `${name} ${legacy}`);
      assert.match(plan.notice, /原配音已移动、裁剪或删除，未自动替换/, `${name} ${legacy}`);
      assert.match(plan.notice, /素材库/);
      assert.deepEqual(next.sequences, prior);
      assert.ok(next.assets.some((a) => a.resourceId === resultId));
    }
});

test("capturing a target requires a sound clip on an audio track", () => {
  const { doc, seq, clip } = fixture();
  assert.deepEqual(captureReplaceTarget(doc, seq.id, clip.id), {
    sequenceId: seq.id,
    clipId: clip.id,
    trackId: clip.trackId,
    assetId: "voice",
    start: clip.start,
    duration: clip.duration,
    timeMap: clip.timeMap,
  });
  const picture = seq.clips.find((c) => c.kind === "media" && c.assetId === "picture")!;
  assert.throws(() => captureReplaceTarget(doc, seq.id, picture.id), /配音/);
  assert.throws(() => captureReplaceTarget(doc, seq.id, "missing"), /配音/);
  assert.throws(() => captureReplaceTarget(doc, "missing", clip.id), /配音/);
});

test("a video clip sharing the old ID never stands in for the selected voice", () => {
  const { doc, seq, clip } = fixture(),
    picture = seq.clips.find((c) => c.kind === "media" && c.assetId === "picture")!;
  // The voice was renamed; its old audio ID now equals the picture clip's own ID.
  clip.id = "voice-canon";
  doc.production = {
    ...(doc.production ?? {}),
    legacyAliases: [
      { sequenceId: seq.id, collection: "audioClips", legacyId: picture.id, clipId: "voice-canon" },
    ],
  };
  const aliased = validateEditorDocument(doc),
    view = projectLegacyView(aliased, seq.id);
  assert.ok(view.clips.some((c) => c.collection === "clips" && c.legacyId === picture.id));
  assert.equal(editorClipIdForLegacyAudio(view, picture.id), "voice-canon");
  assert.equal(editorClipIdForLegacyAudio(view, "missing"), undefined);
  assert.equal(resolveLegacyClipId(aliased, seq.id, "audioClips", picture.id), "voice-canon");
});

test("time maps compare point by point, independent of how the saved record ordered its fields", () => {
  const { doc, seq, clip } = fixture(),
    target = captureReplaceTarget(doc, seq.id, clip.id);
  target.timeMap = {
    points: target.timeMap.points.map(({ time, source }) => ({ source, time }) as any),
  };
  assert.equal(resolveReplaceTarget(doc, target, seq.id)?.id, clip.id);
  target.timeMap.points[1]!.source += 1;
  assert.equal(resolveReplaceTarget(doc, target, seq.id), undefined);
});

test("a locked voice track is refused when choosing and before generation", () => {
  const { doc, seq, clip } = fixture(),
    target = captureReplaceTarget(doc, seq.id, clip.id);
  assert.equal(verifyReplaceTarget(doc, target), true);
  assert.equal(verifyReplaceTarget(doc, { ...target, start: target.start + 1 }), false);
  assert.equal(verifyReplaceTarget(doc, { ...target, sequenceId: "other" }), false);
  seq.tracks.find((t) => t.id === clip.trackId)!.locked = true;
  assert.throws(() => captureReplaceTarget(doc, seq.id, clip.id), /锁定/);
  assert.throws(() => verifyReplaceTarget(doc, target), /锁定/);
});

/** The editor callback: plan against the current document and apply it as one edit. */
function editorPublisher(start: EditorDocument) {
  const state = { doc: start, notices: [] as string[] };
  return {
    state,
    publishVoiceover: async (_: string, result: any, request: VoiceoverPublication) => {
      const plan = planPublishVoiceover(state.doc, result, request, ids());
      if (plan.operations.length)
        state.doc = applyEditorOperations(state.doc, plan.operations, state.doc.revision);
      state.notices.push(plan.notice);
    },
  };
}
test("a stored frame-snapshot job completes through the alias and replaces the renamed voice", async () => {
  const { doc, seq, clip } = fixture(),
    legacy = structuredClone(projectLegacyView(doc, seq.id).project.audioClips![0]!);
  clip.id = "canonical-voice";
  doc.production = {
    ...(doc.production ?? {}),
    legacyAliases: [
      { sequenceId: seq.id, collection: "audioClips", legacyId: legacy.id, clipId: "canonical-voice" },
    ],
  };
  const aliased = validateEditorDocument(doc),
    before = structuredClone(aliased.sequences[0]!.clips.find((c) => c.id === "canonical-voice")),
    editor = editorPublisher(aliased),
    { bridge, state } = productionBridge([ttsJob("job-old")], {
      schemaVersion: 1,
      auto: null,
      bindings: {
        "job-old": {
          jobId: "job-old",
          projectId: aliased.id,
          purpose: "tts",
          attachAudio: true,
          startFrame: legacy.startFrame,
          voiceoverOrigin: { sequenceId: seq.id, revision: aliased.revision },
          replaceClip: legacy,
        },
      },
    });
  const controller = new ProductionController(bridge, {
    getProject: () => projectLegacyView(editor.state.doc, seq.id).project,
    publishAssets: async () => assert.fail("must bypass legacy"),
    publishVoiceover: editor.publishVoiceover,
    changed() {},
  });
  try {
    await controller.initialize();
    await controller.refresh();
  } finally {
    controller.dispose();
  }
  const after = editor.state.doc;
  assert.equal(after.revision, aliased.revision + 1);
  assert.deepEqual(
    after.sequences[0]!.clips.find((c) => c.id === "canonical-voice"),
    { ...before, assetId: resultId },
  );
  assert.match(editor.state.notices.join("\n"), /已替换配音/);
  assert.ok(Object.values(state.saved.bindings).every((b: any) => b.consumed));
});

test("two regenerations of the same voice give one replacement and keep the other in the library", async () => {
  const { doc, seq, clip } = fixture(),
    target = captureReplaceTarget(doc, seq.id, clip.id),
    otherId = `asset-${"f".repeat(64)}`,
    second = ttsJob("job-second");
  second.createdAt = second.updatedAt = 2;
  second.result = {
    ...raw(),
    asset: { ...raw().asset, id: otherId, sha256: "f".repeat(64), name: "另一版配音" },
  };
  const binding = (jobId: string) => ({
      jobId,
      projectId: doc.id,
      purpose: "tts",
      attachAudio: true,
      startFrame: 30,
      voiceoverOrigin: { sequenceId: seq.id, revision: doc.revision },
      replaceTarget: target,
    }),
    editor = editorPublisher(doc),
    { bridge } = productionBridge([ttsJob("job-first"), second], {
      schemaVersion: 1,
      auto: null,
      bindings: { "job-first": binding("job-first"), "job-second": binding("job-second") },
    });
  const controller = new ProductionController(bridge, {
    getProject: () => projectLegacyView(editor.state.doc, seq.id).project,
    publishAssets: async () => assert.fail("must bypass legacy"),
    publishVoiceover: editor.publishVoiceover,
    changed() {},
  });
  try {
    await controller.initialize();
    await controller.refresh();
  } finally {
    controller.dispose();
  }
  const after = editor.state.doc,
    replaced = after.sequences[0]!.clips.find((c) => c.id === clip.id) as MediaClip;
  assert.equal(after.revision, doc.revision + 2, "one replacement, one library addition");
  assert.ok([resultId, otherId].includes(replaced.assetId));
  assert.equal(after.sequences[0]!.clips.length, doc.sequences[0]!.clips.length);
  assert.deepEqual(
    after.assets.filter((a) => [resultId, otherId].includes(a.resourceId!)).length,
    2,
    "both voices are kept",
  );
  assert.equal(editor.state.notices.filter((n) => /已替换配音/.test(n)).length, 1);
  assert.equal(editor.state.notices.filter((n) => /未替换原配音.*素材库/.test(n)).length, 1);
});
