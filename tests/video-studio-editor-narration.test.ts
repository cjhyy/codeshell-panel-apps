import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createProject, validateProject, type Project } from "../apps/video-studio/src/model";
import { narrationFingerprint } from "../apps/video-studio/src/narration";
import {
  editorNarrationFingerprint,
  hasEditorNarrationApproval,
  narrationApprovalIssue,
  narrationOnEditorBasis,
  narrationDraftClipIds,
  planApproveNarration,
  planBindNarrationRecording,
  planNarrationAlignment,
  planNarrationPhase,
  planNarrationScript,
  readNarration,
  reconcileDraftRunEdit,
  reconcileNarrationRunEdit,
  recordedNarrationClipIds,
} from "../apps/video-studio/src/editor/narration-edits";
import { narrationDependencies } from "../apps/video-studio/src/editor/production-guard";
import {
  planAddCaptions,
  planCaptionText,
  planTranscriptCaptions,
} from "../apps/video-studio/src/editor/captions";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { applyEditorOperations, type EditorOperation } from "../apps/video-studio/src/editor/operations";
import { setClipSpeed } from "../apps/video-studio/src/editor/clip-edits";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { sequenceDuration, validateEditorDocument } from "../apps/video-studio/src/editor/validation";
import { reconcileEditorProduction } from "../apps/video-studio/src/editor/production-guard";
import type {
  EditorDocument,
  JsonData,
  MediaClip,
  SequenceClip,
  TextClip,
} from "../apps/video-studio/src/editor/types";

const T = 240000;
const FRAME = 8008; // 30000/1001
const SCRIPT = "先看拍到的画面。\n再说清楚想表达的事。\n最后留下完整的结尾。";

function media(
  id: string,
  trackId: string,
  assetId: string,
  start: number,
  duration: number,
  source = 0,
): MediaClip {
  return {
    id,
    trackId,
    start,
    duration,
    assetId,
    label: id,
    kind: "media",
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
    audio: defaultAudioMix(),
    timeMap: {
      points: [
        { time: 0, source },
        { time: duration, source: source + duration },
      ],
    },
  };
}
function text(id: string, trackId: string, start: number, duration: number, role: TextClip["role"], value: string): TextClip {
  return {
    id,
    trackId,
    start,
    duration,
    label: role === "title" ? "标题" : "字幕",
    kind: "text",
    role,
    text: value,
    style: defaultTextStyle(),
    words: [],
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  };
}
/** Real footage: off-frame source lengths and placements, a picture-in-picture track, a title track. */
function realMedia(narration?: Record<string, JsonData>): EditorDocument {
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: T,
    id: "narration-real-media",
    name: "实拍口播",
    revision: 4,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [
      { id: "camera", name: "实拍画面", kind: "video", duration: 10_000_123, width: 640, height: 360 },
      { id: "take", name: "本人录音", kind: "audio", duration: 12 * T + 777 },
      { id: "retake", name: "重录", kind: "audio", duration: 12 * T + 555 },
      { id: "camera-take", name: "对着镜头录的口播", kind: "video", duration: 12 * T + 999, width: 640, height: 360 },
      { id: "music", name: "背景音乐", kind: "audio", duration: 30 * T },
      { id: "photo", name: "照片", kind: "image", duration: 0, width: 4, height: 4 },
      {
        id: "tts",
        name: "合成配音",
        kind: "audio",
        duration: 4 * T,
        metadata: { speech: { text: "合成的配音", voiceId: "v", engine: "tts", rate: 1 } },
      },
    ],
    sequences: [
      {
        id: "main",
        name: "主时间线",
        width: 640,
        height: 360,
        frameRate: { numerator: 30000, denominator: 1001 },
        background: "#000000",
        timelineMode: "free",
        tracks: [
          createTrack("v1", "video", "画面"),
          createTrack("v2", "video", "画中画"),
          createTrack("t1", "text", "字幕"),
          createTrack("t2", "text", "标题"),
          createTrack("a1", "audio", "口播"),
        ],
        clips: [
          media("camera-main", "v1", "camera", 1_234_567, 10_000_123),
          media("camera-overlay", "v2", "camera", 0, 2_400_011),
          text("existing-caption", "t1", 2_000_001, 500_003, "subtitle", "实拍里的现有字幕"),
          text("title", "t2", 0, 400_000, "title", "片头标题"),
        ],
        transitions: [],
        markers: [],
      },
    ],
    ...(narration ? { production: { script: "旧文稿", narration } } : {}),
  });
}
const apply = (doc: EditorDocument, operations: EditorOperation[]) =>
  applyEditorOperations(doc, operations, doc.revision);
const main = (doc: EditorDocument) => doc.sequences.find((item) => item.id === "main")!;
const subtitles = (doc: EditorDocument, sequenceId = "main") =>
  doc.sequences
    .find((item) => item.id === sequenceId)!
    .clips.filter((clip): clip is TextClip => clip.kind === "text" && clip.role === "subtitle")
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
async function approved(doc = realMedia({ phase: "review", captionBasis: "draft", draftCaptionIds: [] })) {
  const drafted = apply(doc, planNarrationScript(doc, "main", SCRIPT));
  return apply(drafted, await planApproveNarration(drafted));
}
async function recorded(bind = "take") {
  const doc = await approved();
  return apply(doc, await planBindNarrationRecording(doc, bind));
}
const place = (doc: EditorDocument, clip: MediaClip) =>
  apply(doc, [{ type: "clip.add", sequenceId: "main", clip }]);
/** What the coordinator records after a verified alignment. */
async function markAligned(doc: EditorDocument) {
  const narration = {
    ...readNarration(doc)!,
    phase: "aligned",
    captionBasis: "recording",
    alignmentFingerprint: await editorNarrationFingerprint(doc),
    fingerprintBasis: "editor",
  };
  return apply(doc, [
    { type: "project.production", data: { ...doc.production, narration } as Record<string, JsonData> },
  ]);
}

test("a script edit on real off-frame media spans the real sequence on its own frame grid", () => {
  const doc = realMedia({ phase: "review", captionBasis: "draft", draftCaptionIds: [] });
  const next = apply(doc, planNarrationScript(doc, "main", SCRIPT));
  const state = readNarration(next)!;
  assert.equal(next.production!.script, SCRIPT);
  assert.equal(state.phase, "review");
  assert.equal(state.captionBasis, "draft");
  const drafts = subtitles(next).filter((clip) => state.draftCaptionIds.includes(clip.id));
  assert.deepEqual(
    drafts.map((clip) => clip.text),
    ["先看拍到的画面。", "再说清楚想表达的事。", "最后留下完整的结尾。"],
  );
  assert.deepEqual(state.draftCaptionIds, drafts.map((clip) => clip.id));
  assert.ok(drafts.every((clip) => clip.id.startsWith("draft-narration-")));
  const duration = sequenceDuration(main(doc));
  assert.equal(duration, 1_234_567 + 10_000_123);
  assert.equal(drafts[0]!.start, 0);
  assert.equal(drafts.at(-1)!.start + drafts.at(-1)!.duration, duration);
  for (const [index, clip] of drafts.entries()) {
    assert.equal(clip.start % FRAME, 0, "Every draft starts on the sequence frame grid");
    if (index < drafts.length - 1) {
      assert.equal((clip.start + clip.duration) % FRAME, 0);
      assert.equal(clip.start + clip.duration, drafts[index + 1]!.start);
    }
  }
  assert.equal(sequenceDuration(main(next)), duration, "Drafts never lengthen the picture");
  assert.deepEqual(
    subtitles(next).find((clip) => clip.id === "existing-caption"),
    subtitles(doc).find((clip) => clip.id === "existing-caption"),
  );
  assert.equal(main(next).clips.filter((clip) => clip.kind === "media").length, 2);

  // A second edit replaces only its own drafts; the phase follows the draft state.
  const again = apply(next, planNarrationScript(next, "main", "只剩一句新的文案。"));
  const replaced = readNarration(again)!;
  assert.equal(replaced.draftCaptionIds.length, 1);
  assert.deepEqual(
    subtitles(again).map((clip) => clip.text).sort(),
    ["只剩一句新的文案。", "实拍里的现有字幕"].sort(),
  );
  const drafting = realMedia({ phase: "draft", captionBasis: "draft", draftCaptionIds: [] });
  assert.equal(
    readNarration(apply(drafting, planNarrationScript(drafting, "main", SCRIPT)))!.phase,
    "draft",
  );
});

test("an empty timeline keeps the script with no invented captions", () => {
  const doc = realMedia({ phase: "draft", captionBasis: "draft", draftCaptionIds: [] });
  main(doc).clips = [];
  const empty = validateEditorDocument(doc);
  const next = apply(empty, planNarrationScript(empty, "main", SCRIPT));
  assert.equal(next.production!.script, SCRIPT);
  assert.deepEqual(readNarration(next)!.draftCaptionIds, []);
  assert.equal(subtitles(next).length, 0);
});

test("an aliased old draft caption is recognized and replaced on the next script edit", () => {
  const doc = realMedia({
    phase: "review",
    captionBasis: "draft",
    draftCaptionIds: ["draft-narration-1"],
  });
  // A picture clip already owned the old caption ID, so the frame view stored an alias.
  main(doc).clips.push(
    media("draft-narration-1", "v2", "camera", 30 * T, T),
    text("draft-narration-1-legacy-1", "t1", 0, T, "subtitle", "旧的临时字幕"),
  );
  doc.production!.legacyAliases = [
    {
      sequenceId: "main",
      clipId: "draft-narration-1-legacy-1",
      collection: "captions",
      legacyId: "draft-narration-1",
    },
  ];
  const old = validateEditorDocument(doc);
  assert.deepEqual([...narrationDraftClipIds(old, "main")], ["draft-narration-1-legacy-1"]);
  const next = apply(old, planNarrationScript(old, "main", SCRIPT));
  const clips = main(next).clips;
  assert.equal(clips.some((clip) => clip.id === "draft-narration-1-legacy-1"), false);
  assert.equal(clips.find((clip) => clip.id === "draft-narration-1")?.kind, "media");
  const state = readNarration(next)!;
  assert.equal(state.draftCaptionIds.length, 3);
  assert.ok(state.draftCaptionIds.every((id) => clips.some((clip) => clip.id === id)));
});

test("approval depends on the picture, timing and every subtitle, not on preparation, labels or decorative titles", async () => {
  const doc = await approved();
  const state = readNarration(doc)!;
  assert.equal(state.phase, "approved");
  assert.equal(state.fingerprintBasis, "editor");
  assert.equal(state.approvedScript, SCRIPT);
  assert.equal(
    state.approvedFingerprint,
    createHash("sha256").update(narrationDependencies(doc)).digest("hex"),
  );
  assert.equal(await editorNarrationFingerprint(doc), state.approvedFingerprint);
  assert.equal(await hasEditorNarrationApproval(doc), true);
  assert.equal(await narrationApprovalIssue(doc), null);

  const unchanged: Array<[string, (value: EditorDocument) => void]> = [
    ["preparation", (value) => (value.assets[0]!.metadata = { proxyId: "proxy-1", thumbnailId: "thumb" })],
    ["asset fingerprint", (value) => (value.assets[0]!.fingerprint = "a".repeat(64))],
    ["labels", (value) => (main(value).clips[0]!.label = "改过的名字")],
    ["decorative title", (value) => main(value).clips.push(text("extra-title", "t2", T, T, "title", "新标题"))],
    ["picture transform", (value) => ((main(value).clips[0] as MediaClip).transform.rotation = 4)],
  ];
  for (const [name, change] of unchanged) {
    const next = structuredClone(doc);
    change(next);
    assert.equal(narrationDependencies(validateEditorDocument(next)), narrationDependencies(doc), name);
    assert.equal(await hasEditorNarrationApproval(validateEditorDocument(next)), true, name);
  }
  const changed: Array<[string, (value: EditorDocument) => EditorDocument]> = [
    ["picture-in-picture", (value) => place(value, media("pip-2", "v2", "camera", 20 * T, T))],
    ["speed", (value) => apply(value, setClipSpeed(value, "main", "camera-main", 2))],
    [
      "title-track subtitle",
      (value) => apply(value, planAddCaptions(value, "main", [{ start: T, end: 2 * T, text: "标题轨字幕", trackId: "t2" }], { idFactory: () => "t2-sub" })),
    ],
    [
      "script",
      (value) => apply(value, [{ type: "project.production", data: { ...value.production, script: "改稿" } }]),
    ],
    [
      "canvas",
      (value) => apply(value, [{ type: "sequence.update", sequenceId: "main", patch: { width: 360, height: 640 } }]),
    ],
  ];
  for (const [name, change] of changed) {
    const next = change(doc);
    assert.notEqual(narrationDependencies(next), narrationDependencies(doc), name);
    assert.equal(await hasEditorNarrationApproval(next), false, name);
  }
  assert.match(
    (await narrationApprovalIssue(changed[0]![1](doc)))!,
    /重新确认/,
  );
});

test("old approvals stay valid on a complete old view and ask for reconfirmation otherwise", async () => {
  const legacy = validateProject({
    ...createProject("旧口播"),
    id: "old-narration",
    revision: 3,
    script: "旧工程确认过的文稿。",
    assets: [
      { id: "picture", name: "画面", kind: "video", durationFrames: 300 },
      { id: "take", name: "本人录音", kind: "audio", durationFrames: 300 },
    ],
    clips: [{ id: "picture-1", assetId: "picture", inFrame: 0, outFrame: 300, volume: 1 }],
    captions: [{ id: "draft-narration-1", startFrame: 0, endFrame: 300, text: "旧工程确认过的文稿。" }],
    narration: { phase: "review", captionBasis: "draft", draftCaptionIds: ["draft-narration-1"] },
  });
  // As older versions saved it: a SHA-256 of the 30 fps view, then the take chosen.
  const saved: Project = structuredClone(legacy);
  saved.narration = {
    ...saved.narration!,
    phase: "recorded",
    approvedScript: saved.script!,
    approvedFingerprint: await narrationFingerprint(legacy),
    recordingAssetId: "take",
  };
  const old = migrateLegacyProject(validateProject(saved));
  const state = readNarration(old)!;
  assert.equal(state.fingerprintBasis, undefined);
  assert.equal(await hasEditorNarrationApproval(old), true);
  // The next coordinator write moves the approval to the editor basis.
  const upgraded = apply(old, await planBindNarrationRecording(old, "take"));
  assert.equal(readNarration(upgraded)!.fingerprintBasis, "editor");
  assert.equal(await hasEditorNarrationApproval(upgraded), true);

  // Real footage the old view cannot show: an old fingerprint can no longer be verified.
  const partial = structuredClone(old);
  const sequence = partial.sequences[0]!;
  sequence.frameRate = { numerator: 30000, denominator: 1001 };
  const picture = sequence.clips.find((clip) => clip.kind === "media") as MediaClip;
  picture.start = 1234;
  const unverifiable = validateEditorDocument(partial);
  assert.equal(await hasEditorNarrationApproval(unverifiable), false);
  assert.match((await narrationApprovalIssue(unverifiable))!, /工程已变化，请重新确认文稿/);
});

test("replacing a recording removes the old take and its captions, keeping the user's approval", async () => {
  const doc = await recorded();
  assert.equal(readNarration(doc)!.phase, "recorded");
  assert.equal(readNarration(doc)!.recordingAssetId, "take");
  const placed = place(doc, media("take-1", "a1", "take", 1_234_567, 12 * T + 777));
  const checkpoint = apply(placed, await reconcileNarrationRunEdit(doc, placed));
  const aligned = await markAligned(
    apply(
      checkpoint,
      planNarrationAlignment(checkpoint, "main", [{ start: 1, end: 3, text: "说过的第一句。" }]).operations,
    ),
  );
  assert.equal(recordedNarrationClipIds(aligned, "main").size, 1);
  assert.equal(await hasEditorNarrationApproval(aligned), true);
  const replaced = apply(aligned, await planBindNarrationRecording(aligned, "retake"));
  const state = readNarration(replaced)!;
  assert.equal(state.phase, "recorded");
  assert.equal(state.recordingAssetId, "retake");
  assert.equal(state.approvedFingerprint, readNarration(doc)!.approvedFingerprint);
  assert.match(state.alignmentFingerprint!, /^[a-f0-9]{64}$/);
  assert.equal(main(replaced).clips.some((clip) => clip.kind === "media" && clip.assetId === "take"), false);
  assert.equal(recordedNarrationClipIds(replaced, "main").size, 0);
  assert.deepEqual(replaced.assets, aligned.assets, "Both takes stay in the library");
  assert.equal(await hasEditorNarrationApproval(replaced), true);
  await assert.rejects(planBindNarrationRecording(replaced, "camera-missing"), /本人录音|视频/);
});

test("recorded captions follow the take through speed changes, nested sequences and every instance", async () => {
  const doc = await recorded();
  const segments = [
    { start: 1, end: 3, text: "第一句。" },
    { start: 5, end: 6.5, text: "第二句。" },
  ];
  // Two instances on two audio tracks, one of them at double speed.
  let placed = apply(doc, [
    { type: "track.add", sequenceId: "main", track: createTrack("a2", "audio", "口播二") },
  ]);
  placed = place(placed, media("take-1", "a1", "take", 0, 12 * T + 777));
  placed = place(placed, media("take-2", "a2", "take", 2 * T, 8 * T));
  placed = apply(placed, setClipSpeed(placed, "main", "take-2", 2));
  const plan = planNarrationAlignment(placed, "main", segments);
  const aligned = apply(placed, plan.operations);
  const owned = subtitles(aligned).filter((clip) => recordedNarrationClipIds(aligned, "main").has(clip.id));
  const at = (clipId: string) =>
    owned
      .filter((clip) => clip.sourceBinding?.clipId === clipId)
      .map((clip) => [clip.start, clip.start + clip.duration, clip.text]);
  assert.deepEqual(at("take-1"), [
    [T, 3 * T, "第一句。"],
    [5 * T, 6.5 * T, "第二句。"],
  ]);
  assert.deepEqual(at("take-2"), [
    [2 * T + T / 2, 2 * T + 1.5 * T, "第一句。"],
    [2 * T + 2.5 * T, 2 * T + 3.25 * T, "第二句。"],
  ]);
  assert.ok(owned.every((clip) => clip.sourceBinding?.provenance?.assetId === "take"));
  assert.ok(owned.every((clip) => clip.id.startsWith("recorded-narration-")));
  assert.equal(new Set(owned.map((clip) => clip.id)).size, owned.length);
  assert.equal(narrationDraftClipIds(aligned, "main").size, 0, "Drafts are replaced");
  assert.ok(subtitles(aligned).some((clip) => clip.id === "existing-caption"));

  // The take inside a nested sequence.
  const nested = structuredClone(doc);
  const child = {
    ...structuredClone(main(nested)),
    id: "child",
    name: "子序列",
    tracks: [createTrack("ca", "audio", "口播")],
    clips: [media("inner-take", "ca", "take", T, 12 * T + 777)],
  };
  const owner = {
    ...media("nested", "v2", "camera", 2 * T, 13 * T),
    kind: "sequence",
    sequenceId: "child",
  } as unknown as SequenceClip & { assetId?: string };
  delete owner.assetId;
  nested.sequences.push(child);
  main(nested).clips = main(nested).clips.filter((clip) => clip.id !== "camera-overlay");
  main(nested).clips.push(owner);
  const nestedDoc = validateEditorDocument(nested);
  const nestedAligned = apply(nestedDoc, planNarrationAlignment(nestedDoc, "main", segments).operations);
  assert.deepEqual(
    subtitles(nestedAligned)
      .filter((clip) => clip.sourceBinding?.clipId === "nested")
      .map((clip) => [clip.start, clip.start + clip.duration]),
    [
      [4 * T, 6 * T],
      [8 * T, 9.5 * T],
    ],
  );
});

test("alignment refuses a take whose speech is not fully kept, with the original guidance", async () => {
  const doc = await recorded();
  const trimmed = place(doc, media("take-1", "a1", "take", 0, 5 * T));
  const frozen = structuredClone(trimmed);
  assert.throws(
    () => planNarrationAlignment(trimmed, "main", [{ start: 4, end: 6, text: "被截掉的尾句。" }]),
    /未完整保留.*补足画面和音轨/,
  );
  assert.deepEqual(trimmed, frozen);
  assert.throws(
    () => planNarrationAlignment(doc, "main", [{ start: 1, end: 2, text: "还没放进时间线。" }]),
    /独立音轨并开启声音/,
  );
  const onCamera = await recorded("camera-take");
  const onPicture = place(onCamera, media("take-on-picture", "v2", "camera-take", 20 * T, 12 * T));
  assert.throws(
    () => planNarrationAlignment(onPicture, "main", [{ start: 1, end: 2, text: "画面轨上的声音" }]),
    /独立音轨并开启声音/,
  );
});

test("a granted run edit checkpoints the recording work and refuses edits to the confirmed basis", async () => {
  const doc = await recorded();
  const placed = place(doc, media("take-1", "a1", "take", 1_234_567, 12 * T + 777));
  const [annotation, ...rest] = await reconcileNarrationRunEdit(doc, placed);
  assert.equal(rest.length, 0);
  assert.equal(annotation!.type, "project.production");
  const checkpoint = apply(placed, [annotation!]);
  const state = readNarration(checkpoint)!;
  assert.equal(state.phase, "recorded");
  assert.equal(state.captionBasis, "draft");
  assert.equal(state.approvedFingerprint, readNarration(doc)!.approvedFingerprint);
  assert.equal(state.alignmentFingerprint, await editorNarrationFingerprint(placed));
  assert.equal(await hasEditorNarrationApproval(checkpoint), true);

  // Transform-only edits leave the narration untouched.
  const turned = structuredClone(checkpoint);
  (main(turned).clips.find((clip) => clip.id === "camera-main") as MediaClip).transform.rotation = 3;
  assert.deepEqual(await reconcileNarrationRunEdit(checkpoint, validateEditorDocument(turned)), []);

  const refused: Array<[string, EditorDocument, RegExp]> = [
    [
      "canvas",
      apply(checkpoint, [{ type: "sequence.update", sequenceId: "main", patch: { width: 360, height: 640 } }]),
      /已确认的草稿与本人录音失效/,
    ],
    [
      "script",
      apply(checkpoint, [{ type: "project.production", data: { ...checkpoint.production, script: "改过" } }]),
      /不能改写已确认文案/,
    ],
    [
      "narration",
      apply(checkpoint, [
        {
          type: "project.production",
          data: { ...checkpoint.production, narration: { ...(checkpoint.production!.narration as object), phase: "aligned", captionBasis: "recording" } },
        },
      ]),
      /口播确认状态/,
    ],
    [
      "recording",
      apply(checkpoint, [{ type: "asset.update", assetId: "take", patch: { duration: 13 * T } }] as EditorOperation[]),
      /已确认的草稿与本人录音失效/,
    ],
  ];
  for (const [name, after, pattern] of refused)
    await assert.rejects(reconcileNarrationRunEdit(checkpoint, after), pattern, name);

  // An edit after alignment returns to the recorded checkpoint.
  const aligned = apply(
    checkpoint,
    planNarrationAlignment(checkpoint, "main", [{ start: 1, end: 3, text: "第一句。" }]).operations,
  );
  const alignedState = { ...readNarration(aligned)!, phase: "aligned", captionBasis: "recording" } as const;
  const markedAligned = apply(aligned, [
    {
      type: "project.production",
      data: {
        ...aligned.production,
        narration: { ...alignedState, alignmentFingerprint: await editorNarrationFingerprint(aligned) },
      },
    },
  ]);
  const moved = place(markedAligned, media("pip-3", "v2", "camera", 25 * T, T));
  const back = apply(moved, await reconcileNarrationRunEdit(markedAligned, moved));
  assert.equal(readNarration(back)!.phase, "recorded");
  assert.equal(readNarration(back)!.captionBasis, "draft");
});

test("subtitles a draft run adds join its temporary captions; the phase coordinator keeps the ids", async () => {
  const doc = realMedia({ phase: "draft", captionBasis: "draft", draftCaptionIds: [] });
  const added = apply(doc, planAddCaptions(doc, "main", [{ start: 0, end: T, text: "草稿字幕" }], { idFactory: () => "agent-caption" }));
  const [annotation] = await reconcileDraftRunEdit(doc, added);
  const next = apply(added, [annotation!]);
  assert.deepEqual(readNarration(next)!.draftCaptionIds, ["agent-caption"]);
  assert.deepEqual([...narrationDraftClipIds(next, "main")], ["agent-caption"]);
  await assert.rejects(
    reconcileDraftRunEdit(
      doc,
      apply(doc, [
        { type: "project.production", data: { ...doc.production, narration: { phase: "review", captionBasis: "draft", draftCaptionIds: [] } } },
      ]),
    ),
    /口播确认状态/,
  );
  const review = apply(next, planNarrationPhase(next, "review"));
  assert.equal(readNarration(review)!.phase, "review");
  assert.deepEqual(readNarration(review)!.draftCaptionIds, ["agent-caption"]);
});

test("batch captions keep exact requested IDs and refuse collisions without writing", () => {
  const doc = realMedia();
  const operations = planAddCaptions(doc, "main", [
    { id: "draft-narration-9", start: 0, end: T, text: "第一条" },
    { id: "draft-narration-10", start: T, end: 2 * T, text: "第二条" },
  ]);
  const next = apply(doc, operations);
  assert.deepEqual(
    subtitles(next).filter((clip) => clip.id.startsWith("draft-narration-")).map((clip) => clip.id),
    ["draft-narration-9", "draft-narration-10"],
  );
  assert.throws(
    () => planAddCaptions(next, "main", [{ id: "draft-narration-9", start: 0, end: T, text: "重复" }]),
    /ID/,
  );
  assert.throws(
    () => planAddCaptions(doc, "main", [{ start: 60 * T, end: 61 * T, text: "画面之外" }]),
    /画面/,
  );
});

test("narration dependencies order IDs by code unit, whatever the locale", () => {
  const doc = place(
    place(realMedia(), media("clip-a", "v2", "camera", 25 * T, T)),
    media("clip-B", "v2", "camera", 20 * T, T),
  );
  const dependencies = narrationDependencies(doc);
  // Locale-aware collation puts "clip-a" first; code units put "B" (U+0042) before "a" (U+0061).
  assert.ok(
    dependencies.indexOf('"id":"clip-B"') < dependencies.indexOf('"id":"clip-a"'),
    "Clips sort by code unit",
  );
  const reordered = structuredClone(doc);
  main(reordered).clips.reverse();
  assert.equal(narrationDependencies(validateEditorDocument(reordered)), dependencies);
});

/** A 字幕-page caption from the take's real transcript, then corrected by hand. */
function userTranscriptCaption(doc: EditorDocument) {
  const plan = planTranscriptCaptions(
    doc,
    "main",
    new Map([["take", [{ start: 1, end: 3, text: "说过的第一句" }]]]),
    { idFactory: () => "unused" },
  );
  const generated = apply(doc, plan.operations);
  const clip = subtitles(generated).find((item) => item.sourceBinding?.provenance?.assetId === "take")!;
  return {
    doc: apply(generated, planCaptionText(generated, "main", clip.id, "说过的第一句（手改）")),
    id: clip.id,
  };
}

test("script saves and alignment keep the user's own 字幕-page captions from the take", async () => {
  const doc = place(await recorded(), media("take-1", "a1", "take", 0, 12 * T + 777));
  const { doc: corrected, id } = userTranscriptCaption(doc);
  assert.equal(recordedNarrationClipIds(corrected, "main").size, 0, "Not the workflow's captions");
  const saved = apply(corrected, planNarrationScript(corrected, "main", SCRIPT));
  assert.equal(subtitles(saved).find((clip) => clip.id === id)?.text, "说过的第一句（手改）");

  const plan = planNarrationAlignment(corrected, "main", [
    { start: 1, end: 3, text: "说过的第一句" },
    { start: 5, end: 6, text: "第二句" },
  ]);
  const aligned = apply(corrected, plan.operations);
  assert.equal(subtitles(aligned).find((clip) => clip.id === id)?.text, "说过的第一句（手改）");
  assert.equal(plan.keptUserCaptions, 1);
  const owned = subtitles(aligned).filter((clip) => recordedNarrationClipIds(aligned, "main").has(clip.id));
  assert.deepEqual(
    owned.map((clip) => [clip.start, clip.text]),
    [[5 * T, "第二句"]],
    "No duplicate over the user's caption",
  );
});

test("a recorded run refuses edits to the user's subtitles and synthetic voices, but may rearrange pictures", async () => {
  const doc = await recorded();
  const placed = place(doc, media("take-1", "a1", "take", 1_234_567, 12 * T + 777));
  const checkpoint = apply(placed, await reconcileNarrationRunEdit(doc, placed));
  const refused: Array<[string, EditorDocument, RegExp]> = [
    [
      "subtitle text",
      apply(checkpoint, planCaptionText(checkpoint, "main", "existing-caption", "被自动改掉")),
      /用户自己的字幕/,
    ],
    [
      "subtitle removal",
      apply(checkpoint, [{ type: "clip.remove", sequenceId: "main", clipIds: ["existing-caption"] }]),
      /用户自己的字幕/,
    ],
    [
      "synthetic voice",
      place(checkpoint, media("tts-1", "a1", "tts", 30 * T, 4 * T)),
      /合成配音/,
    ],
  ];
  for (const [name, after, pattern] of refused)
    await assert.rejects(reconcileNarrationRunEdit(checkpoint, after), pattern, name);
  const draftId = readNarration(checkpoint)!.draftCaptionIds[0]!;
  const withoutDraft = apply(checkpoint, [{ type: "clip.remove", sequenceId: "main", clipIds: [draftId] }]);
  assert.equal((await reconcileNarrationRunEdit(checkpoint, withoutDraft)).length, 1);
  const moved = apply(checkpoint, [
    { type: "clip.move", sequenceId: "main", clipIds: ["camera-overlay"], delta: 30 * T },
  ]);
  assert.equal((await reconcileNarrationRunEdit(checkpoint, moved)).length, 1);

  // Without a chosen take the run cannot checkpoint.
  const unbound = await approved();
  await assert.rejects(
    reconcileNarrationRunEdit(unbound, place(unbound, media("take-1", "a1", "take", 0, T))),
    /请先选择本人录音/,
  );
});

test("an old approval moves to the editor basis with a fresh fingerprint", async () => {
  const doc = await approved();
  const state = readNarration(doc)!;
  const { fingerprintBasis: _basis, ...previous } = state;
  const old = apply(doc, [
    {
      type: "project.production",
      data: {
        ...doc.production,
        narration: { ...previous, approvedFingerprint: "b".repeat(64) } as never,
      },
    },
  ]);
  // Not verifiable (partial old view), so it stays as it was.
  assert.equal((await narrationOnEditorBasis(old, readNarration(old)!)).fingerprintBasis, undefined);
  assert.deepEqual(await narrationOnEditorBasis(doc, state), state);
});

test("stale temporary caption IDs never block subtitles a draft run adds", async () => {
  const stale = Array.from({ length: 999 }, (_, index) => `gone-${index}`);
  const doc = realMedia({ phase: "draft", captionBasis: "draft", draftCaptionIds: stale });
  const added = apply(
    doc,
    planAddCaptions(doc, "main", [
      { id: "new-1", start: 0, end: T, text: "一" },
      { id: "new-2", start: T, end: 2 * T, text: "二" },
    ]),
  );
  const next = apply(added, await reconcileDraftRunEdit(doc, added));
  assert.deepEqual(readNarration(next)!.draftCaptionIds, ["new-1", "new-2"]);
});

test("replacing a take inside a nested sequence used elsewhere is refused; an exclusive one is cleaned up", async () => {
  const base = realMedia({ phase: "review", captionBasis: "draft", draftCaptionIds: [] });
  const withChild = async (shared: boolean) => {
    const doc = structuredClone(base);
    doc.sequences.push({
      ...structuredClone(main(doc)),
      id: "child",
      name: "子序列",
      tracks: [createTrack("cv", "video", "画面"), createTrack("ca", "audio", "口播")],
      clips: [
        media("inner-picture", "cv", "camera", 0, 10 * T),
        media("inner-take", "ca", "take", 0, 12 * T + 777),
      ],
    });
    const owner = (id: string) => {
      const clip = { ...media(id, "v2", "camera", 30 * T, 10 * T), kind: "sequence", sequenceId: "child" } as unknown as SequenceClip & { assetId?: string };
      delete clip.assetId;
      return clip;
    };
    main(doc).clips.push(owner("nested"));
    if (shared)
      doc.sequences.push({
        ...structuredClone(main(base)),
        id: "other",
        name: "另一条时间线",
        tracks: [createTrack("ov", "video", "画面")],
        clips: [{ ...owner("elsewhere"), trackId: "ov", start: 0 }],
      });
    const confirmed = await approved(validateEditorDocument(doc));
    return apply(confirmed, await planBindNarrationRecording(confirmed, "take"));
  };
  await assert.rejects(planBindNarrationRecording(await withChild(true), "retake"), /其他时间线/);
  const exclusive = await withChild(false);
  const replaced = apply(exclusive, await planBindNarrationRecording(exclusive, "retake"));
  assert.deepEqual(
    replaced.sequences.find((item) => item.id === "child")!.clips.map((clip) => clip.id),
    ["inner-picture"],
  );
});

// Ported from the old frame-based coordinators (approve, bind, script edits).

test("confirmation takes a stable reviewed draft with a script and picture", async () => {
  const drafted = (() => {
    const doc = realMedia({ phase: "review", captionBasis: "draft", draftCaptionIds: [] });
    return apply(doc, planNarrationScript(doc, "main", SCRIPT));
  })();
  const input = structuredClone(drafted);
  const pending = planApproveNarration(input);
  input.production!.script = "用户刚修改了文稿。";
  const state = readNarration(apply(drafted, await pending))!;
  assert.equal(state.approvedScript, SCRIPT, "The digest covers the draft as it was asked for");
  for (const phase of ["draft", "approved"]) {
    const other = structuredClone(drafted);
    (other.production!.narration as Record<string, JsonData>).phase = phase;
    if (phase === "approved")
      Object.assign(other.production!.narration as object, {
        approvedScript: SCRIPT,
        approvedFingerprint: "a".repeat(64),
      });
    await assert.rejects(planApproveNarration(validateEditorDocument(other)), /先完成草稿/);
  }
  const noScript = structuredClone(drafted);
  noScript.production!.script = "";
  await assert.rejects(planApproveNarration(noScript), /非空文本/);
  const noPicture = structuredClone(drafted);
  main(noPicture).clips = main(noPicture).clips.filter((clip) => clip.kind !== "media");
  await assert.rejects(planApproveNarration(validateEditorDocument(noPicture)), /安排草稿画面/);
});

test("choosing a take changes nothing else; missing, still, synthetic or stale choices are refused", async () => {
  const doc = await approved();
  const bound = apply(doc, await planBindNarrationRecording(doc, "take"));
  assert.deepEqual(bound.sequences, doc.sequences);
  assert.deepEqual(bound.assets, doc.assets);
  assert.equal(bound.production!.script, doc.production!.script);
  assert.equal(await hasEditorNarrationApproval(bound), true);
  assert.equal(
    readNarration(apply(doc, await planBindNarrationRecording(doc, "camera-take")))!.recordingAssetId,
    "camera-take",
  );
  await assert.rejects(planBindNarrationRecording(doc, "other-project-take"), /当前工程/);
  await assert.rejects(planBindNarrationRecording(doc, "photo"), /当前工程/);
  await assert.rejects(planBindNarrationRecording(doc, "tts"), /合成配音/);
  const changed = apply(doc, [
    { type: "project.production", data: { ...doc.production, script: "这是已经改动的新稿。" } },
  ]);
  await assert.rejects(planBindNarrationRecording(changed, "take"), /重新确认/);
});

test("checkpoints survive rebinding the same take; a user edit revokes them and reconfirming starts clean", async () => {
  const doc = await recorded();
  const placed = place(doc, media("take-1", "a1", "take", 0, 12 * T + 777));
  const checkpoint = apply(placed, await reconcileNarrationRunEdit(doc, placed));
  const rebound = apply(checkpoint, await planBindNarrationRecording(checkpoint, "take"));
  assert.equal(readNarration(rebound)!.alignmentFingerprint, readNarration(checkpoint)!.alignmentFingerprint);
  assert.equal(readNarration(rebound)!.approvedFingerprint, readNarration(doc)!.approvedFingerprint);
  assert.equal(await hasEditorNarrationApproval(rebound), true);

  const edited = apply(checkpoint, planCaptionText(checkpoint, "main", "existing-caption", "用户手工改了字幕。"));
  assert.equal(await hasEditorNarrationApproval(edited), false);
  const reviewed = apply(edited, reconcileEditorProduction(checkpoint, edited));
  const review = readNarration(reviewed)!;
  assert.equal(review.phase, "review");
  for (const key of ["approvedScript", "approvedFingerprint", "alignmentFingerprint"])
    assert.equal(Object.hasOwn(review, key), false);
  assert.equal(review.recordingAssetId, "take");
  const again = readNarration(apply(reviewed, await planApproveNarration(reviewed)))!;
  assert.equal(again.phase, "approved");
  assert.equal(again.recordingAssetId, "take");
  assert.equal(Object.hasOwn(again, "alignmentFingerprint"), false);
  assert.notEqual(again.approvedFingerprint, readNarration(doc)!.approvedFingerprint);
});

test("script edits normalize the text and replace only owned captions, dropping the confirmation", async () => {
  // An unlisted caption that happens to use the draft name stays the user's.
  const fresh = realMedia({ phase: "review", captionBasis: "draft", draftCaptionIds: [] });
  const withTitle = await approved(
    apply(
      fresh,
      planAddCaptions(fresh, "main", [{ id: "draft-narration-1", start: 0, end: T, text: "用户独立字幕" }]),
    ),
  );
  const listed = apply(withTitle, await planBindNarrationRecording(withTitle, "take"));
  const text = "  先去海边。\r\n\r\n然后慢慢走进老街，看看日常生活！  最后一起看夕阳。 ";
  const next = apply(listed, planNarrationScript(listed, "main", text));
  const state = readNarration(next)!;
  assert.equal(next.production!.script, text.replace(/\r\n?/g, "\n").trim());
  assert.equal(state.phase, "review");
  assert.equal(state.recordingAssetId, "take");
  for (const key of ["approvedScript", "approvedFingerprint", "alignmentFingerprint"])
    assert.equal(Object.hasOwn(state, key), false);
  const owned = subtitles(next).filter((clip) => state.draftCaptionIds.includes(clip.id));
  assert.equal(owned.length, 3);
  assert.equal(owned[0]!.id, "draft-narration-2");
  assert.equal(owned.map((clip) => clip.text).join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
  assert.equal(subtitles(next).find((clip) => clip.id === "draft-narration-1")?.text, "用户独立字幕");
  assert.deepEqual(
    main(next).clips.filter((clip) => clip.kind === "media"),
    main(listed).clips.filter((clip) => clip.kind === "media"),
  );
});

test("editing the script after alignment, or after an edit revoked it, removes the recorded captions but keeps the take and titles", async () => {
  const doc = await recorded();
  const placed = place(doc, media("take-1", "a1", "take", 0, 12 * T + 777));
  const checkpoint = apply(placed, await reconcileNarrationRunEdit(doc, placed));
  const aligned = await markAligned(
    apply(checkpoint, planNarrationAlignment(checkpoint, "main", [{ start: 1, end: 3, text: "第一句。" }]).operations),
  );
  const moved = apply(aligned, [
    { type: "clip.move", sequenceId: "main", clipIds: ["camera-overlay"], delta: 30 * T },
  ]);
  const revoked = apply(moved, reconcileEditorProduction(aligned, moved));
  assert.equal(readNarration(revoked)!.phase, "review");
  for (const before of [aligned, revoked]) {
    const next = apply(before, planNarrationScript(before, "main", "修改了说法。再去录一遍。"));
    assert.equal(recordedNarrationClipIds(next, "main").size, 0);
    assert.ok(main(next).clips.some((clip) => clip.id === "take-1"));
    assert.ok(subtitles(next).some((clip) => clip.id === "existing-caption"));
    assert.equal(readNarration(next)!.phase, "review");
    assert.equal(readNarration(next)!.draftCaptionIds.length, 2);
  }
});

test("estimated caption packing keeps long and many-sentence scripts within the real frames", () => {
  for (const [text, frames] of [
    ["旅".repeat(10000), 3],
    ["🙂".repeat(4999), 3],
    ["走。".repeat(5000), 2000],
    ["开始。\n\n看看风景！ 结束。", 1],
  ] as const) {
    const doc = realMedia({ phase: "review", captionBasis: "draft", draftCaptionIds: [] });
    doc.assets.push({ id: "long", name: "长镜头", kind: "video", duration: frames * FRAME, width: 640, height: 360 });
    main(doc).clips = [media("short", "v1", "long", 0, frames * FRAME)];
    const short = validateEditorDocument(doc);
    const next = apply(short, planNarrationScript(short, "main", text));
    const captions = subtitles(next);
    assert.ok(captions.length > 0 && captions.length <= 1000);
    assert.ok(captions.every((clip) => clip.text.length <= 4000 && clip.duration > 0));
    assert.equal(captions.map((clip) => clip.text).join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
    assert.equal(captions.at(-1)!.start + captions.at(-1)!.duration, frames * FRAME);
    assert.ok(captions.every((clip) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(clip.text)));
  }
});

test("invalid or unrepresentable script edits are refused", () => {
  const doc = realMedia({ phase: "review", captionBasis: "draft", draftCaptionIds: [] });
  for (const text of [" ", "x".repeat(10001), "不允许\u0001字符"])
    assert.throws(() => planNarrationScript(doc, "main", text));
  const tiny = structuredClone(doc);
  main(tiny).clips = [media("tiny", "v1", "camera", 0, FRAME)];
  assert.throws(
    () => planNarrationScript(validateEditorDocument(tiny), "main", "字".repeat(4001)),
    /画面太短/,
  );
});

test("replacing a take keeps other sound; choosing the same take again changes nothing", async () => {
  let doc = await recorded();
  doc = place(doc, media("take-1", "a1", "take", 0, 5 * T, 0));
  doc = place(doc, media("take-2", "a1", "take", 5 * T, 5 * T, 6 * T));
  doc = apply(doc, [{ type: "track.add", sequenceId: "main", track: createTrack("a2", "audio", "音乐") }]);
  const placed = place(doc, media("music-1", "a2", "music", 0, 20 * T));
  const base = await recorded();
  const checkpoint = apply(placed, await reconcileNarrationRunEdit(base, placed));
  const same = await planBindNarrationRecording(checkpoint, "take");
  assert.deepEqual(apply(checkpoint, same).sequences, checkpoint.sequences);
  const replaced = apply(checkpoint, await planBindNarrationRecording(checkpoint, "retake"));
  assert.deepEqual(
    main(replaced).clips.filter((clip) => clip.kind === "media" && clip.trackId.startsWith("a")).map((clip) => clip.id),
    ["music-1"],
  );
});
