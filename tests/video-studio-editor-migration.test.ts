import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProject,
  createDemoProject,
  timelineClips,
  validateProject,
} from "../apps/video-studio/src/model";
import {
  migrateLegacyProject,
  readEditorDocument,
} from "../apps/video-studio/src/editor/migration";
import { frameToTicks, sourceTimeAt, ticksToSeconds } from "../apps/video-studio/src/editor/time";
import { validateEditorDocument } from "../apps/video-studio/src/editor/validation";
import type { MediaClip, TextClip } from "../apps/video-studio/src/editor/types";

const rate = { numerator: 30, denominator: 1 };
const ticks = (frame: number) => frameToTicks(frame, rate);

test("migration preserves every picture's source time, duration, volume and gaps without mutating v1", () => {
  const old = createDemoProject();
  old.timelineMode = "free";
  old.clips = old.clips.map((clip, index) => ({
    ...clip,
    inFrame: 15,
    startFrame: [30, 300, 900][index],
    volume: index / 2,
  }));
  old.captions = [];
  const legacy = validateProject(old);
  const original = structuredClone(legacy);
  const next = migrateLegacyProject(legacy);
  const sequence = next.sequences[0]!;
  assert.equal(next.schemaVersion, 2);
  assert.equal(next.id, old.id);
  assert.equal(next.revision, old.revision);
  assert.equal(sequence.timelineMode, "free");
  assert.deepEqual(sequence.frameRate, rate);
  for (const clip of timelineClips(legacy)) {
    const migrated = sequence.clips.find((value) => value.id === clip.id) as MediaClip;
    assert.equal(migrated.start, ticks(clip.startFrame));
    assert.equal(migrated.duration, ticks(clip.endFrame - clip.startFrame));
    assert.equal(migrated.audio.volume, clip.volume);
    for (const localFrame of [0, 12, clip.outFrame - clip.inFrame - 1])
      assert.equal(
        sourceTimeAt(migrated.timeMap, ticks(localFrame)),
        ticks(clip.inFrame + localFrame),
      );
  }
  assert.deepEqual(legacy, original);
  assert.deepEqual(migrateLegacyProject(legacy), next, "migration is deterministic");
});

test("media resource references and voice recipes survive migration while audio gets separate instances", () => {
  const legacy = createDemoProject();
  legacy.assets.push({
    id: "voice",
    name: "我的声音",
    kind: "audio",
    durationFrames: 900,
    mediaId: `asset-${"a".repeat(64)}`,
    speech: { text: "真实旁白", voiceId: "my-voice", engine: "audio8", rate: 1 },
  });
  legacy.audioClips = [
    {
      id: "voice-first",
      assetId: "voice",
      inFrame: 30,
      outFrame: 120,
      startFrame: 60,
      volume: 0.8,
    },
    {
      id: "voice-second",
      assetId: "voice",
      inFrame: 180,
      outFrame: 270,
      startFrame: 75,
      volume: 0.4,
    },
  ];
  const next = migrateLegacyProject(legacy);
  const asset = next.assets.find((value) => value.id === "voice")!;
  assert.equal(asset.resourceId, legacy.assets.at(-1)!.mediaId);
  assert.deepEqual(asset.metadata?.speech, legacy.assets.at(-1)!.speech);
  const first = next.sequences[0]!.clips.find((clip) => clip.id === "voice-first") as MediaClip;
  const second = next.sequences[0]!.clips.find((clip) => clip.id === "voice-second") as MediaClip;
  assert.notEqual(first.trackId, second.trackId);
  assert.equal(first.assetId, second.assetId);
  assert.equal(sourceTimeAt(first.timeMap, 0), ticks(30));
  assert.equal(sourceTimeAt(second.timeMap, 0), ticks(180));
  assert.equal(ticksToSeconds(second.start), 2.5);
});

test("all legacy subtitle presets retain text, source-independent time, typography and effects", () => {
  for (const preset of ["classic", "bold", "minimal"] as const) {
    const legacy = createDemoProject();
    legacy.captionStyle = preset;
    const next = migrateLegacyProject(legacy);
    const captions = next.sequences[0]!.clips.filter(
      (clip): clip is TextClip => clip.kind === "text",
    );
    assert.equal(captions.length, legacy.captions.length);
    for (let index = 0; index < captions.length; index++) {
      const before = legacy.captions[index]!;
      const after = captions[index]!;
      assert.equal(after.text, before.text);
      assert.equal(after.start, ticks(before.startFrame));
      assert.equal(after.duration, ticks(before.endFrame - before.startFrame));
      assert.equal(after.style.layout, "caption-stack");
      assert.equal(
        after.style.fontWeight,
        preset === "bold" ? 800 : preset === "minimal" ? 500 : 600,
      );
      assert.equal(after.style.strokeWidth > 0, preset === "bold");
      assert.equal(after.style.shadow.blur > 0, preset === "minimal");
    }
  }
});

test("empty project migrates and changing output rate leaves all source times untouched", () => {
  const empty = migrateLegacyProject(createProject());
  assert.equal(empty.sequences.length, 1);
  assert.equal(empty.sequences[0]!.clips.length, 0);
  assert.deepEqual(readEditorDocument(empty), empty);
  const next = migrateLegacyProject(createDemoProject());
  const before = structuredClone(next.sequences[0]!.clips);
  next.sequences[0]!.frameRate = { numerator: 60000, denominator: 1001 };
  assert.deepEqual(validateEditorDocument(next).sequences[0]!.clips, before);
});

test("legacy cross-list ID collisions remain unique and no source media or subtitle is lost", () => {
  const legacy = createDemoProject();
  legacy.assets.push({ id: "voice", name: "旁白", kind: "audio", durationFrames: 90 });
  legacy.audioClips = [
    {
      id: legacy.clips[0]!.id,
      assetId: "voice",
      inFrame: 0,
      outFrame: 90,
      startFrame: 0,
      volume: 1,
    },
  ];
  legacy.captions[0]!.id = legacy.clips[0]!.id;
  const next = migrateLegacyProject(legacy);
  const clips = next.sequences[0]!.clips;
  assert.equal(clips.length, legacy.clips.length + 1 + legacy.captions.length);
  assert.equal(new Set(clips.map((clip) => clip.id)).size, clips.length);
  assert.equal(clips.filter((clip) => clip.kind === "media" && clip.assetId === "voice").length, 1);
  assert.equal(clips.filter((clip) => clip.kind === "text").length, legacy.captions.length);
});

test("invalid v1 documents cannot bypass validation through the migration router", () => {
  const legacy = createDemoProject();
  assert.throws(() => readEditorDocument({ ...legacy, fps: 60 }));
  assert.throws(() =>
    readEditorDocument({ ...legacy, clips: [{ ...legacy.clips[0], assetId: "missing" }] }),
  );
  assert.throws(() => readEditorDocument({ ...legacy, schemaVersion: 99 }));
});

test("an audio-only legacy main sequence stays audible with the same length", () => {
  const old = createProject();
  old.assets = [{ id: "audio", name: "原始声音", kind: "audio", durationFrames: 180 }];
  old.clips = [{ id: "audio-main", assetId: "audio", inFrame: 30, outFrame: 180, volume: 0.6 }];
  const next = migrateLegacyProject(old);
  const sequence = next.sequences[0]!;
  const clip = sequence.clips[0] as MediaClip;
  assert.equal(sequence.tracks.find((track) => track.id === clip.trackId)?.kind, "audio");
  assert.equal(clip.duration, ticks(150));
  assert.equal(clip.audio.volume, 0.6);
});

// Captured by the real installed 0.5.16 validateProject; its schemaVersion is still 1.
import installedFixture from "./fixtures/video-studio/project-0.5.16.json";
import { evaluateFrame } from "../apps/video-studio/src/editor/evaluate";
import { sequenceDuration } from "../apps/video-studio/src/editor/validation";
import { EditorSession, type EditorSessionStorage } from "../apps/video-studio/src/editor/session";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import {
  planClipTiming,
  planMagneticMove,
  planMagneticRemove,
  planTimelineArrangement,
} from "../apps/video-studio/src/editor/timing-edits";
import {
  planDuplicateSequence,
  planCreateCompound,
} from "../apps/video-studio/src/editor/sequence-edits";

import { projectLegacyView } from "../apps/video-studio/src/editor/legacy-adapter";

function installed() {
  return structuredClone(installedFixture);
}

test("0.5.16 retains declared layer order, track states, normalized transforms and audio tails", () => {
  const raw = installed(),
    original = structuredClone(raw),
    doc = migrateLegacyProject(raw),
    seq = doc.sequences[0]!;
  assert.deepEqual(raw, original);
  assert.deepEqual(migrateLegacyProject(raw), doc);
  assert.equal(seq.magneticTrackId, "video-main");
  assert.equal(seq.timelineMode, "magnetic");
  assert.deepEqual(
    seq.tracks.slice(0, -1).map((track) => ({
      id: track.id,
      kind: track.kind,
      name: track.name,
      hidden: track.hidden,
      muted: track.muted,
      locked: track.locked,
    })),
    raw.tracks.map((track) => ({
      id: track.id,
      kind: track.kind,
      name: track.name,
      hidden: !!track.hidden,
      muted: !!track.muted,
      locked: !!track.locked,
    })),
  );
  assert.equal(
    seq.tracks.at(-1)!.id,
    "track-captions-text",
    "caption track never collides with a declared ID",
  );
  const media = (id: string) => seq.clips.find((clip) => clip.id === id) as MediaClip;
  assert.equal(
    media("main-b").start,
    ticks(60),
    "overlay entries do not advance the main magnetic cursor",
  );
  assert.equal(media("overlay-a").start, ticks(15));
  assert.deepEqual(
    [
      media("overlay-a").transform.x,
      media("overlay-a").transform.y,
      media("overlay-a").transform.scaleX,
      media("overlay-a").transform.scaleY,
      media("overlay-a").transform.opacity,
    ],
    [0.25, -0.125, 0.5, 0.5, 0.6],
  );
  assert.equal(sequenceDuration(seq), ticks(230));
  assert.equal(media("tail").start, ticks(110));
  assert.equal(sourceTimeAt(media("tail").timeMap, ticks(110)), ticks(200));
  assert.equal(doc.assets[0]!.metadata?.sourcePath, raw.assets[0]!.sourcePath);
  assert.deepEqual(doc.production?.roughCuts, raw.roughCuts);
  assert.equal(doc.production?.script, raw.script);
});

test("0.5.16 preview and export evaluation preserve hidden-picture sound and muted audio independently", () => {
  const doc = migrateLegacyProject(installed()),
    seq = doc.sequences[0]!;
  const first = evaluateFrame(doc, seq.id, ticks(20));
  assert.deepEqual(
    first.layers.map((layer) => ("clipId" in layer ? layer.clipId : layer.kind)),
    ["main-a", "overlay-a"],
  );
  assert.deepEqual(
    first.audio
      .filter((audio) => audio.gain > 0)
      .map((audio) => [audio.clipId, audio.sourceTime, audio.gain]),
    [
      ["main-a", ticks(20), 0.7],
      ["hidden-a", ticks(50), 0.8],
    ],
  );
  const later = evaluateFrame(doc, seq.id, ticks(220));
  assert.deepEqual(
    later.audio
      .filter((audio) => audio.gain > 0)
      .map((audio) => [audio.clipId, audio.sourceTime, audio.gain]),
    [["tail", ticks(200), 0.9]],
  );
  assert.equal(later.layers.length, 1);
  assert.equal(later.layers[0]!.kind, "text");
});

test("0.5.16 implicit main tracks, independent audio tails and free overlay overlaps are accepted", () => {
  const raw: any = installed();
  raw.tracks = raw.tracks.filter((track: any) => !["video-main", "audio-main"].includes(track.id));
  const doc = migrateLegacyProject(raw);
  assert.equal(doc.sequences[0]!.tracks[0]!.id, "video-main");
  const tail: any = createProject();
  tail.assets = [{ id: "voice", name: "only voice", kind: "audio", durationFrames: 240 }];
  tail.audioClips = [
    { id: "tail", assetId: "voice", inFrame: 0, outFrame: 120, startFrame: 90, volume: 1 },
  ];
  tail.captions = [{ id: "caption", text: "尾部", startFrame: 180, endFrame: 210 }];
  assert.equal(sequenceDuration(migrateLegacyProject(tail).sequences[0]!), ticks(210));
  raw.timelineMode = "free";
  raw.clips.find((clip: any) => clip.id === "main-a").startFrame = 10;
  raw.clips.find((clip: any) => clip.id === "main-b").startFrame = 90;
  const free = migrateLegacyProject(raw).sequences[0]!;
  assert.equal(free.clips.find((clip) => clip.id === "main-b")!.start, ticks(90));
  assert.equal(free.clips.find((clip) => clip.id === "overlay-a")!.start, ticks(15));
});

test("0.5.16 reader rejects unknown extension fields, broken references and invalid track semantics", () => {
  const mutations: Array<(value: any) => void> = [
    (value) => (value.extra = true),
    (value) => (value.audioClips = null),
    (value) => (value.tracks[0].volume = 0.8),
    (value) => (value.clips[1].transform.rotation = 20),
    (value) => (value.clips[1].transform.scale = 5),
    (value) => (value.clips[1].trackId = "missing"),
    (value) => (value.clips[1].trackId = "audio-main"),
    (value) => delete value.clips[1].startFrame,
    (value) => (value.clips[0].startFrame = 0),
    (value) => (value.tracks[0].muted = "false"),
    (value) => (value.tracks[0].kind = "audio"),
    (value) => (value.audioClips[0].transform = { x: 0, y: 0, scale: 1, opacity: 1 }),
    (value) => (value.audioClips[0].id = value.clips[0].id),
    (value) => value.clips.push({ ...value.clips[1], id: "overlap" }),
  ];
  for (const mutation of mutations) {
    const raw = installed();
    mutation(raw);
    assert.throws(() => migrateLegacyProject(raw));
  }
  const raw = installed();
  Object.defineProperty(raw.clips[1], "transform", {
    enumerable: true,
    get() {
      throw new Error("accessor invoked");
    },
  });
  assert.throws(() => migrateLegacyProject(raw), /访问器/);
});

test("migrated main-only magnetism leaves overlay moves, deletes and trims at their explicit positions", () => {
  const doc = migrateLegacyProject(installed()),
    seq = doc.sequences[0]!;
  const run = (ops: ReturnType<typeof planMagneticRemove>) =>
    applyEditorOperations(doc, ops, doc.revision).sequences[0]!;
  const moved = run(
    planMagneticMove(doc, seq.id, ["overlay-a"], { delta: ticks(3), direction: "next" }),
  );
  assert.equal(moved.clips.find((clip) => clip.id === "overlay-a")!.start, ticks(18));
  assert.equal(moved.clips.find((clip) => clip.id === "main-b")!.start, ticks(60));
  const removed = run(planMagneticRemove(doc, seq.id, ["overlay-a"]));
  assert.equal(removed.clips.find((clip) => clip.id === "main-b")!.start, ticks(60));
  const primary = run(planMagneticRemove(doc, seq.id, ["main-a"]));
  assert.equal(primary.clips.find((clip) => clip.id === "main-b")!.start, 0);
  assert.equal(primary.clips.find((clip) => clip.id === "overlay-a")!.start, ticks(15));
  const trimmed = run(
    planClipTiming(doc, seq.id, ["overlay-a"], { kind: "keep-right", time: ticks(30) }),
  );
  assert.equal(trimmed.clips.find((clip) => clip.id === "main-b")!.start, ticks(60));
  const arranged = run(planTimelineArrangement(doc, seq.id, { mode: "magnetic", compact: true }));
  assert.equal(arranged.clips.find((clip) => clip.id === "overlay-a")!.start, ticks(15));
  assert.throws(
    () =>
      run([{ type: "track.remove", sequenceId: seq.id, trackId: "video-main", removeClips: true }]),
    /磁吸主轨/,
  );
});

test("duplicating a migrated sequence remaps its scoped magnetic track along with clips", () => {
  const doc = migrateLegacyProject(installed());
  let counter = 0;
  const plan = planDuplicateSequence(doc, doc.activeSequenceId, {
    idFactory: (kind) => `${kind}-${++counter}`,
  });
  const copy = applyEditorOperations(doc, plan.operations, doc.revision).sequences.find(
    (seq) => seq.id === plan.sequenceId,
  )!;
  assert.notEqual(copy.magneticTrackId, "video-main");
  assert.equal(copy.tracks.find((track) => track.id === copy.magneticTrackId)!.name, "主画面");
});

test("Session backs up the exact 0.5.16 snapshot before v2 save and retains tracks across undo and reopen", async () => {
  const raw = installed();
  let stored: unknown = structuredClone(raw),
    version = 7;
  const events: string[] = [],
    backups: unknown[] = [];
  const storage: EditorSessionStorage = {
    async read() {
      return { data: structuredClone(stored), revision: version };
    },
    async backupLegacy(value) {
      events.push("backup");
      backups.push(structuredClone(value));
    },
    async write(value, base) {
      assert.equal(base, version);
      events.push("write");
      stored = structuredClone(value);
      return { revision: ++version };
    },
  };
  const session = await EditorSession.open(storage, { autosaveDelayMs: 60000 });
  try {
    const before = session.read();
    session.dispatch([{ type: "project.rename", name: "升级后编辑" }], before.revision);
    session.undo();
    await session.flush();
    assert.deepEqual(events, ["backup", "write"]);
    assert.deepEqual(backups, [raw]);
    assert.deepEqual(session.read().sequences, before.sequences);
    const reopened = await EditorSession.open(storage);
    try {
      assert.deepEqual(reopened.read().sequences, before.sequences);
    } finally {
      await reopened.close({ save: false });
    }
  } finally {
    await session.close({ save: false });
  }
});

test("migrated cross-track moves compact only the original main track and preserve overlay placement", () => {
  const doc = migrateLegacyProject(installed()),
    seq = doc.sequences[0]!;
  const moved = applyEditorOperations(
    doc,
    planMagneticMove(doc, seq.id, ["main-a"], { trackId: "overlay", delta: ticks(120) }),
    doc.revision,
  ).sequences[0]!;
  assert.equal(moved.clips.find((clip) => clip.id === "main-a")!.start, ticks(120));
  assert.equal(moved.clips.find((clip) => clip.id === "main-b")!.start, 0);
  assert.equal(moved.clips.find((clip) => clip.id === "overlay-a")!.start, ticks(15));
  const inserted = applyEditorOperations(
    doc,
    planMagneticMove(doc, seq.id, ["overlay-a"], { trackId: "video-main", delta: ticks(70) }),
    doc.revision,
  ).sequences[0]!;
  assert.equal(inserted.clips.find((clip) => clip.id === "overlay-a")!.start, ticks(60));
  assert.equal(inserted.clips.find((clip) => clip.id === "main-b")!.start, ticks(135));
});

test("compound copies and old production views retain the original main-track identity after layer reorder", () => {
  const raw = installed();
  [raw.tracks[0], raw.tracks[1]] = [raw.tracks[1]!, raw.tracks[0]!];
  const doc = migrateLegacyProject(raw),
    view = projectLegacyView(doc);
  assert.deepEqual(
    view.project.clips.map((clip) => clip.id),
    ["main-a", "main-b"],
  );
  let counter = 0;
  const plan = planCreateCompound(doc, doc.activeSequenceId, ["overlay-a"], {
    name: "叠加复合",
    idFactory: (kind) => `${kind}-${++counter}`,
  });
  const child = applyEditorOperations(doc, plan.operations, doc.revision).sequences.find(
    (seq) => seq.id === plan.createdSequenceId,
  )!;
  assert.equal(child.tracks.find((track) => track.id === child.magneticTrackId)!.name, "主画面");
});
