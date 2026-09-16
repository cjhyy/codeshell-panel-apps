import assert from "node:assert/strict";
import test from "node:test";
import { createProject, validateProject } from "../apps/video-studio/src/model";
import { ProductionController } from "../apps/video-studio/src/production";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { projectLegacyView } from "../apps/video-studio/src/editor/legacy-adapter";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import {
  createTrack,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import {
  canonicalVoiceoverReceipt,
  planPublishVoiceover,
  type VoiceoverPublication,
} from "../apps/video-studio/src/editor/voiceover-publication";
import type { MediaClip } from "../apps/video-studio/src/editor/types";

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
  const { doc, seq } = fixture(),
    view = projectLegacyView(doc, seq.id);
  return {
    jobId: "job-tts",
    origin: { sequenceId: seq.id, revision: doc.revision },
    placement: { startFrame: 0, replaceClip: structuredClone(view.project.audioClips![0]!) },
  };
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
test("canonical production callback persists origin before completion, retries failed publication and never calls legacy replacement", async () => {
  const { doc, seq } = fixture(),
    view = projectLegacyView(doc, seq.id);
  let saved: any = null,
    revision = 0,
    fail = true,
    publishes = 0,
    captured = 0;
  const job = {
    id: "job-tts",
    type: "tts",
    status: "succeeded",
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
    result: raw(),
  };
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
      if (method === "media.document.get") return { data: saved, revision };
      if (method === "media.document.set") {
        assert.equal(args.baseRevision, revision);
        saved = structuredClone(args.data);
        return { revision: ++revision };
      }
      if (method === "media.jobs.list") return { jobs: [job] };
      if (method === "media.jobs.get" || method === "media.tts") return job;
      throw new Error(method);
    },
  };
  const callbacks = {
    getProject: () => view.project,
    publishAssets: async () => assert.fail("must bypass legacy"),
    captureVoiceoverOrigin: () => {
      captured++;
      return { sequenceId: seq.id, revision: doc.revision };
    },
    publishVoiceover: async (projectId: string, result: any, request: VoiceoverPublication) => {
      publishes++;
      assert.equal(projectId, doc.id);
      assert.equal(result.asset.duration, 4 * T);
      assert.deepEqual(request.origin, { sequenceId: seq.id, revision: doc.revision });
      assert.deepEqual(request.placement!.replaceClip, view.project.audioClips![0]);
      if (fail) throw new Error("保存失败");
    },
    changed() {},
  };
  const controller = new ProductionController(bridge, callbacks);
  try {
    await controller.initialize();
    await controller.createVoiceover(
      { text: "真实文案" },
      { startFrame: 0, attach: true, replaceClip: view.project.audioClips![0] },
    );
    await assert.rejects(controller.refresh(), /保存失败/);
    assert.equal(captured, 1);
    assert.equal(
      Object.values(saved.bindings).some((b: any) => b.consumed),
      false,
    );
    controller.dispose();
    fail = false;
    const restored = new ProductionController(bridge, callbacks);
    try {
      await restored.initialize();
      await restored.refresh();
      assert.ok(publishes >= 2);
      assert.equal(captured, 1);
      assert.equal(
        Object.values(saved.bindings).some((b: any) => b.consumed),
        true,
      );
    } finally {
      restored.dispose();
    }
  } finally {
    controller.dispose();
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
