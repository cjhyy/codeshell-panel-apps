import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createProject, validateProject } from "../apps/video-studio/src/model";
import { approveNarration, bindNarrationRecording } from "../apps/video-studio/src/narration";
import {
  editorNarrationFingerprint,
  hasEditorNarrationApproval,
  narrationApprovalIssue,
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
import { planAddCaptions } from "../apps/video-studio/src/editor/captions";
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
  const old = migrateLegacyProject(await bindNarrationRecording(await approveNarration(legacy), "take"));
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
