import assert from "node:assert/strict";
import test from "node:test";
import {
  detectSpokenRanges,
  findEditorSpokenCandidates,
  locateSourceRange,
  planEditorSpokenEdit,
  planSpokenCuts,
  type EditorSpokenCandidate,
} from "../apps/video-studio/src/editor/spoken-edits";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { EditorHistory } from "../apps/video-studio/src/editor/history";
import { projectLegacyView } from "../apps/video-studio/src/editor/legacy-adapter";
import { reconcileEditorProduction } from "../apps/video-studio/src/editor/production-guard";
import type { SessionIdentity } from "../apps/video-studio/src/editor/session";
import type {
  EditorDocument,
  EditorSequence,
  MediaClip,
  TextClip,
} from "../apps/video-studio/src/editor/types";
import {
  sequenceDuration,
  validateEditorDocument,
} from "../apps/video-studio/src/editor/validation";
import type { SpokenSource } from "../apps/video-studio/src/spoken-edit";

const T = 240000;
const TALK = 10 * T + 1234; // Real media: not a whole number of 30 fps frames.
const FILLER = { start: 1_032_000, end: 1_104_000 }; // 4.3 s – 4.6 s in the source.
const fillerSource: SpokenSource = {
  assetId: "talk",
  transcript: [{ start: 4.2, end: 5, text: "嗯", words: [{ start: 4.3, end: 4.6, text: "嗯" }] }],
};

function media(
  id: string,
  trackId: string,
  assetId: string,
  start: number,
  points: Array<{ time: number; source: number }>,
): MediaClip {
  return {
    id,
    kind: "media",
    label: id,
    trackId,
    start,
    duration: points.at(-1)!.time,
    assetId,
    timeMap: { points },
    audio: defaultAudioMix(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
}
const straight = (sourceStart: number, duration: number) => [
  { time: 0, source: sourceStart },
  { time: duration, source: sourceStart + duration },
];
function document(sequence: Partial<EditorSequence>, extra: Partial<EditorDocument> = {}) {
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: T,
    id: "spoken-project",
    name: "口播精剪",
    revision: 4,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [
      { id: "talk", name: "口播原片", kind: "video", duration: TALK, width: 1920, height: 1080 },
      { id: "clean", name: "优化声音", kind: "audio", duration: TALK },
      { id: "broll", name: "空镜", kind: "video", duration: 20 * T, width: 1920, height: 1080 },
      { id: "music", name: "音乐", kind: "audio", duration: 30 * T },
      { id: "outro", name: "片尾", kind: "video", duration: 5 * T, width: 1920, height: 1080 },
    ],
    sequences: [
      {
        id: "main",
        name: "主序列",
        width: 1920,
        height: 1080,
        frameRate: { numerator: 30, denominator: 1 },
        timelineMode: "free",
        background: "#000000",
        tracks: [createTrack("v1", "video")],
        clips: [],
        transitions: [],
        markers: [],
        ...sequence,
      },
    ],
    ...extra,
  });
}
function subtitle(): TextClip {
  return {
    id: "sub",
    kind: "text",
    label: "字幕",
    trackId: "t1",
    start: 4 * T,
    duration: T,
    role: "subtitle",
    text: "我们嗯继续",
    style: defaultTextStyle(),
    words: [
      { text: "我们", start: 0, end: 72000 },
      { text: "嗯", start: 72000, end: 144000 },
      { text: "继续", start: 144000, end: T },
    ],
    sourceBinding: { clipId: "talk-v", sourceStart: 4 * T, sourceEnd: 5 * T },
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
}
function multitrack(extra: Partial<EditorDocument> = {}): EditorDocument {
  const video = media("talk-v", "v1", "talk", 0, straight(0, TALK)),
    voice = media("talk-a", "a2", "clean", 0, straight(0, TALK));
  video.audio.volume = 0;
  video.linkGroupId = "voice";
  voice.linkGroupId = "voice";
  return document(
    {
      tracks: [
        createTrack("v1", "video", "口播"),
        createTrack("v2", "video", "空镜"),
        createTrack("a2", "audio", "优化声音"),
        createTrack("a3", "audio", "音乐"),
        createTrack("t1", "text", "字幕"),
      ],
      clips: [
        video,
        voice,
        media("broll", "v2", "broll", 3 * T, straight(0, 4 * T)),
        media("music", "a3", "music", 0, straight(0, 12 * T)),
        subtitle(),
      ],
      markers: [
        { id: "m0", time: T, duration: 0, name: "开头", note: "", color: "#ff0000" },
        { id: "m1", time: 6 * T, duration: 0, name: "重点", note: "", color: "#00ff00" },
      ],
    },
    extra,
  );
}
const identityOf = (doc: EditorDocument, generation = 2): SessionIdentity => ({
  documentId: doc.id,
  generation,
  revision: doc.revision,
});
function ids() {
  let next = 0;
  return (kind: string) => `${kind}-new-${++next}`;
}
const clips = (doc: EditorDocument) => doc.sequences[0]!.clips;
const byId = (doc: EditorDocument, id: string) => clips(doc).find((clip) => clip.id === id)!;
const onTrack = (doc: EditorDocument, trackId: string) =>
  clips(doc)
    .filter((clip) => clip.trackId === trackId)
    .sort((a, b) => a.start - b.start);
const span = (clip: { start: number; duration: number }) => [
  clip.start,
  clip.start + clip.duration,
];
const firstSource = (clip: unknown) => (clip as MediaClip).timeMap.points[0]!.source;
function fillerCandidate(doc: EditorDocument, identity = identityOf(doc)): EditorSpokenCandidate {
  const found = findEditorSpokenCandidates(doc, "main", identity, [fillerSource]).find(
    (candidate) => candidate.kind === "filler",
  );
  assert.ok(found, "filler candidate is found");
  return found;
}
function cut(
  doc: EditorDocument,
  options: { scope?: "program" | "linked" } = {},
  candidates = [fillerCandidate(doc)],
) {
  return planEditorSpokenEdit(
    doc,
    identityOf(doc),
    candidates,
    candidates.map((candidate) => candidate.id),
    { ...options, idFactory: ids() },
  );
}

test("real media outside the old frame view is found and cut; later clips move by the exact tick length", () => {
  const doc = document({
    clips: [
      media("talk-a", "v1", "talk", 0, straight(0, TALK)),
      media("tail", "v1", "broll", TALK, straight(0, 2 * T)),
    ],
  });
  assert.equal(projectLegacyView(doc).timelineComplete, false);
  const candidate = fillerCandidate(doc);
  assert.equal(candidate.actionable, true);
  assert.equal(candidate.precision, "word");
  assert.deepEqual(candidate.occurrence.source, FILLER);
  assert.deepEqual(candidate.occurrence.timeline, [FILLER]);
  assert.equal(candidate.occurrence.ownerClipId, "talk-a");
  const plan = cut(doc);
  assert.equal(plan.removed, 72000);
  assert.equal(plan.sequenceId, "main");
  assert.deepEqual(plan.candidateIds, [candidate.id]);
  const after = applyEditorOperations(doc, plan.operations, doc.revision);
  assert.equal(after.revision, doc.revision + 1);
  const pieces = onTrack(after, "v1");
  assert.deepEqual(pieces.map(span), [
    [0, FILLER.start],
    [FILLER.start, TALK - 72000],
    [TALK - 72000, TALK - 72000 + 2 * T],
  ]);
  assert.equal(firstSource(pieces[1]), FILLER.end);
  assert.equal(byId(after, "tail").start, TALK - 72000);
  assert.equal(sequenceDuration(after.sequences[0]!), sequenceDuration(doc.sequences[0]!) - 72000);
});

test("multitrack cut splits linked enhanced audio, B-roll, music, bound subtitle and markers in sync as one undo entry", () => {
  const doc = multitrack(),
    snapshot = structuredClone(doc),
    history = new EditorHistory(doc);
  const plan = cut(doc);
  assert.equal(plan.removed, 72000);
  history.apply(plan.operations, history.revision, plan.title);
  const after = history.read();
  const cutAt = FILLER.start,
    rest = TALK - 72000;
  for (const track of ["v1", "a2"]) {
    const [left, right] = onTrack(after, track);
    assert.deepEqual(
      [span(left!), span(right!)],
      [
        [0, cutAt],
        [cutAt, rest],
      ],
    );
    assert.equal(firstSource(right), FILLER.end);
  }
  // The right halves remain linked to each other, never to the untouched left halves.
  const [videoLeft, videoRight] = onTrack(after, "v1"),
    [voiceLeft, voiceRight] = onTrack(after, "a2");
  assert.equal(videoLeft!.linkGroupId, "voice");
  assert.equal(voiceLeft!.linkGroupId, "voice");
  assert.ok(videoRight!.linkGroupId && videoRight!.linkGroupId !== "voice");
  assert.equal(videoRight!.linkGroupId, voiceRight!.linkGroupId);
  assert.deepEqual(onTrack(after, "v2").map(span), [
    [3 * T, cutAt],
    [cutAt, 7 * T - 72000],
  ]);
  assert.equal(firstSource(onTrack(after, "v2")[1]), FILLER.end - 3 * T);
  assert.deepEqual(onTrack(after, "a3").map(span), [
    [0, cutAt],
    [cutAt, 12 * T - 72000],
  ]);
  const captions = onTrack(after, "t1") as TextClip[];
  assert.deepEqual(
    captions.map((caption) => [caption.text, ...span(caption), caption.sourceBinding?.clipId]),
    [
      ["我们", 4 * T, cutAt, videoLeft!.id],
      ["继续", cutAt, 5 * T - 72000, videoRight!.id],
    ],
  );
  assert.deepEqual(
    after.sequences[0]!.markers.map((marker) => [marker.id, marker.time]),
    [
      ["m0", T],
      ["m1", 6 * T - 72000],
    ],
  );
  assert.equal(sequenceDuration(after.sequences[0]!), 12 * T - 72000);
  assert.equal(history.canUndo, true);
  history.undo();
  assert.deepEqual(history.read(), { ...snapshot, revision: snapshot.revision + 2 });
  assert.equal(history.canUndo, false);
  assert.deepEqual(doc, snapshot);
});

test("scope linked ripples only the spoken clip and its linked tracks", () => {
  const doc = multitrack(),
    plan = cut(doc, { scope: "linked" }),
    after = applyEditorOperations(doc, plan.operations, doc.revision);
  assert.equal(plan.removed, 72000);
  assert.deepEqual(byId(after, "broll"), byId(doc, "broll"));
  assert.deepEqual(byId(after, "music"), byId(doc, "music"));
  assert.equal(onTrack(after, "v2").length, 1);
  assert.equal(onTrack(after, "a3").length, 1);
  assert.deepEqual(onTrack(after, "v1").map(span), [
    [0, FILLER.start],
    [FILLER.start, TALK - 72000],
  ]);
  assert.deepEqual(onTrack(after, "a2").map(span), onTrack(after, "v1").map(span));
  assert.deepEqual(after.sequences[0]!.markers, doc.sequences[0]!.markers);
});

test("speed and reverse clips map source moments to their actual timeline ticks", () => {
  const fast = document({
    clips: [
      media("fast", "v1", "talk", 0, [
        { time: 0, source: 0 },
        { time: 5 * T, source: 10 * T },
      ]),
    ],
  });
  const fastCandidate = fillerCandidate(fast);
  assert.deepEqual(fastCandidate.occurrence.timeline, [
    { start: FILLER.start / 2, end: FILLER.end / 2 },
  ]);
  const fastPlan = cut(fast, {}, [fastCandidate]);
  assert.equal(fastPlan.removed, 36000);
  const fastAfter = applyEditorOperations(fast, fastPlan.operations, fast.revision);
  assert.deepEqual(onTrack(fastAfter, "v1").map(span), [
    [0, FILLER.start / 2],
    [FILLER.start / 2, 5 * T - 36000],
  ]);
  assert.equal(firstSource(onTrack(fastAfter, "v1")[1]), FILLER.end);

  const reverse = document({
    clips: [
      media("reverse", "v1", "talk", 0, [
        { time: 0, source: 10 * T },
        { time: 10 * T, source: 0 },
      ]),
    ],
  });
  const reverseCandidate = fillerCandidate(reverse);
  const expected = { start: 10 * T - FILLER.end + 1, end: 10 * T - FILLER.start + 1 };
  assert.deepEqual(reverseCandidate.occurrence.timeline, [expected]);
  const reversePlan = cut(reverse, {}, [reverseCandidate]);
  assert.equal(reversePlan.removed, 72000);
  const reverseAfter = applyEditorOperations(reverse, reversePlan.operations, reverse.revision);
  const [left, right] = onTrack(reverseAfter, "v1");
  assert.deepEqual(
    [span(left!), span(right!)],
    [
      [0, expected.start],
      [expected.start, 10 * T - 72000],
    ],
  );
  assert.equal(firstSource(right), 10 * T - expected.end);
});

test("transitions, locked tracks, tiny leftovers and stale identities fail before any edit", () => {
  const withTransition = multitrack();
  const main = withTransition.sequences[0]!;
  main.clips.push(media("outro", "v1", "outro", TALK - T / 2, straight(0, 2 * T)));
  main.transitions.push({
    id: "fade",
    fromClipId: "talk-v",
    toClipId: "outro",
    start: TALK - T / 2,
    duration: T / 2,
    kind: "dissolve",
  });
  const transitionDoc = validateEditorDocument(withTransition),
    transitionSnapshot = structuredClone(transitionDoc);
  assert.throws(() => cut(transitionDoc), /转场/);
  assert.deepEqual(transitionDoc, transitionSnapshot);

  const locked = multitrack();
  locked.sequences[0]!.tracks.find((track) => track.id === "a3")!.locked = true;
  assert.throws(() => cut(locked), /音乐.*锁定/);
  // Only the spoken and linked tracks ripple here, so the locked music bed is left alone.
  assert.equal(cut(locked, { scope: "linked" }).removed, 72000);

  const misaligned = multitrack();
  const stray = misaligned.sequences[0]!.clips.find((clip) => clip.id === "sub")!;
  stray.start = 9.5 * T; // Bound to talk-v but running past its end.
  assert.throws(() => cut(validateEditorDocument(misaligned)), /请先修正字幕时间/);

  const doc = multitrack();
  assert.throws(
    () => planSpokenCuts(doc, "main", [{ start: 24000, end: 96000 }], { idFactory: ids() }),
    /不足 0\.2 秒/,
  );
  // B-roll starting just before the cut would keep a 0.04 s sliver.
  assert.throws(
    () =>
      planSpokenCuts(doc, "main", [{ start: 3 * T + 10000, end: 3 * T + 100000 }], {
        idFactory: ids(),
      }),
    /不足 0\.2 秒/,
  );
  assert.throws(
    () => planSpokenCuts(doc, "main", [{ start: 0, end: 12 * T }], { idFactory: ids() }),
    /不能删除整条/,
  );

  const candidate = fillerCandidate(doc);
  assert.throws(
    () =>
      planEditorSpokenEdit(
        doc,
        { ...identityOf(doc), revision: doc.revision + 1 },
        [candidate],
        [candidate.id],
        { idFactory: ids() },
      ),
    /工程已更新/,
  );
  assert.throws(
    () =>
      planEditorSpokenEdit(doc, identityOf(doc, 3), [candidate], [candidate.id], {
        idFactory: ids(),
      }),
    /工程已更新/,
  );
  const forged = {
    ...candidate,
    occurrence: { ...candidate.occurrence, timeline: [{ start: 2 * T, end: 3 * T }] },
  };
  assert.throws(
    () => planEditorSpokenEdit(doc, identityOf(doc), [forged], [forged.id], { idFactory: ids() }),
    /源时间映射/,
  );
  assert.throws(
    () => planEditorSpokenEdit(doc, identityOf(doc), [candidate], [], { idFactory: ids() }),
    /请先勾选/,
  );
});

test("approved narration moves to review and the bound subtitle source ranges tighten", () => {
  const doc = multitrack({
    production: {
      narration: {
        phase: "approved",
        captionBasis: "recording",
        draftCaptionIds: [],
        recordingAssetId: "clean",
        approvedScript: "我们嗯继续",
      },
    },
  });
  const plan = cut(doc),
    after = applyEditorOperations(doc, plan.operations, doc.revision);
  const guard = reconcileEditorProduction(doc, after);
  assert.equal(guard.length, 1);
  const production = (guard[0] as { data: Record<string, any> }).data;
  assert.equal(production.narration.phase, "review");
  assert.equal(production.narration.recordingAssetId, "clean");
  assert.equal(production.narrationPreviousApproval.phase, "approved");
  const captions = onTrack(after, "t1") as TextClip[];
  assert.deepEqual(
    captions.map((caption) => [
      caption.sourceBinding!.sourceStart,
      caption.sourceBinding!.sourceEnd,
    ]),
    [
      [4 * T, FILLER.start],
      [FILLER.end, 5 * T],
    ],
  );
});

test("detection keeps pauses, word fillers, segment-only fillers and repetitions honest", () => {
  const detections = detectSpokenRanges({
    assetId: "talk",
    silence: [
      { start: 2, end: 4 },
      { start: 5, end: 5.8 },
    ],
    transcript: [
      { start: 4.2, end: 5, text: "嗯，", words: [{ start: 4.3, end: 4.6, text: "嗯" }] },
      { start: 6, end: 8, text: "嗯，我们继续讲重要的正文。" },
      { start: 8, end: 9, text: "这是完整的一句话。" },
      { start: 9.5, end: 10, text: "这是完整的一句话！" },
    ],
  });
  assert.deepEqual(
    detections.map((item) => [item.kind, item.precision, item.actionable, item.source]),
    [
      ["pause", "detector", true, { start: 2 * T, end: 4 * T }],
      ["filler", "word", true, FILLER],
      ["filler", "segment", false, { start: 6 * T, end: 8 * T }],
      ["repetition", "segment", true, { start: 9.5 * T, end: 10 * T }],
    ],
  );
  assert.match(detections[2]!.reason, /缺少词时间戳/);
  assert.match(detections[3]!.reason, /强调或识别错误/);
});

test("pause candidates keep breathing room inside the clip but not at its outer edges", () => {
  const doc = document({
    clips: [media("talk-a", "v1", "talk", 2 * T, straight(T, 9 * T))],
  });
  const candidates = findEditorSpokenCandidates(doc, "main", identityOf(doc), [
    {
      assetId: "talk",
      silence: [
        { start: 0, end: 3 },
        { start: 5, end: 7 },
        { start: 9.5, end: 12 },
      ],
    },
  ]);
  assert.deepEqual(
    candidates.map((candidate) => [candidate.occurrence.source, candidate.actionable]),
    [
      [{ start: T, end: 3 * T - 40000 }, true],
      [{ start: 5 * T + 40000, end: 7 * T - 40000 }, true],
      [{ start: 9.5 * T + 40000, end: 10 * T }, true],
    ],
  );
  assert.deepEqual(candidates[0]!.occurrence.timeline, [{ start: 2 * T, end: 4 * T - 40000 }]);
  // A word the clip plays only partly is never suggested.
  const partial = findEditorSpokenCandidates(doc, "main", identityOf(doc), [
    {
      assetId: "talk",
      transcript: [
        { start: 0.8, end: 1.3, text: "嗯", words: [{ start: 0.8, end: 1.1, text: "嗯" }] },
      ],
    },
  ]);
  assert.deepEqual(partial, []);
});

test("moments inside nested sequences are located but must be trimmed inside that sequence", () => {
  const doc = document({});
  const main = doc.sequences[0]!;
  doc.sequences.push({
    ...structuredClone(main),
    id: "inner",
    name: "内层",
    clips: [media("inner-talk", "v1", "talk", 0, straight(0, TALK))],
  });
  main.clips.push({
    id: "nest",
    kind: "sequence",
    label: "嵌套",
    trackId: "v1",
    start: T,
    duration: TALK,
    sequenceId: "inner",
    timeMap: { points: straight(0, TALK) },
    audio: defaultAudioMix(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  });
  const nested = validateEditorDocument(doc);
  const occurrences = locateSourceRange(nested, "main", "talk", FILLER);
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0]!.ownerClipId, "nest");
  assert.deepEqual(occurrences[0]!.timeline, [{ start: FILLER.start + T, end: FILLER.end + T }]);
  const candidate = fillerCandidate(nested);
  assert.equal(candidate.actionable, false);
  assert.match(candidate.reason, /请在对应序列内精剪/);
  assert.throws(
    () =>
      planEditorSpokenEdit(nested, identityOf(nested), [candidate], [candidate.id], {
        idFactory: ids(),
      }),
    /没有足够精确|请在对应序列内精剪/,
  );
});

test("an independent narration cuts every picture clip at its moments, latest first, in one transaction", () => {
  const doc = document({
    tracks: [createTrack("v1", "video"), createTrack("a1", "audio", "旁白")],
    clips: [
      media("pic-a", "v1", "broll", 0, straight(0, 5 * T)),
      media("pic-b", "v1", "broll", 5 * T, straight(10 * T, 5 * T)),
      media("voice", "a1", "clean", 0, straight(0, TALK)),
    ],
  });
  const candidates = findEditorSpokenCandidates(doc, "main", identityOf(doc), [
    {
      assetId: "clean",
      silence: [
        { start: 1, end: 3 },
        { start: 4, end: 6 },
      ],
    },
  ]);
  assert.deepEqual(
    candidates.map((candidate) => candidate.occurrence.timeline),
    [[{ start: T + 40000, end: 3 * T - 40000 }], [{ start: 4 * T + 40000, end: 6 * T - 40000 }]],
  );
  const plan = cut(doc, {}, candidates),
    after = applyEditorOperations(doc, plan.operations, doc.revision);
  const removed = 2 * (2 * T - 80000);
  assert.equal(plan.removed, removed);
  assert.equal(plan.title, "口播精剪 · 2 项");
  assert.deepEqual(onTrack(after, "v1").map(span), [
    [0, T + 40000],
    [T + 40000, 2.5 * T],
    [2.5 * T, 10 * T - removed],
  ]);
  // pic-a keeps its middle; pic-b loses its head to the second pause.
  assert.deepEqual(
    onTrack(after, "v1").map((clip) => firstSource(clip)),
    [0, 3 * T - 40000, 10 * T + T - 40000],
  );
  assert.equal(sequenceDuration(after.sequences[0]!), TALK - removed);
});
