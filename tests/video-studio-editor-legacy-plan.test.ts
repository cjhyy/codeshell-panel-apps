import assert from "node:assert/strict";
import test from "node:test";
import { validateProject } from "../apps/video-studio/src/model";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { projectLegacyView } from "../apps/video-studio/src/editor/legacy-adapter";
import { applyEditorOperations } from "../apps/video-studio/src/editor/operations";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTextStyle,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import { sequenceDuration, validateEditorDocument } from "../apps/video-studio/src/editor/validation";
import { snapToFrame } from "../apps/video-studio/src/editor/time";
import { translateLegacyOperations } from "../apps/video-studio/src/editor/legacy-plan";
import {
  parseEditorProposal,
  planFifteenSecondDraft,
  proposalActor,
  reviewEditorProposal,
} from "../apps/video-studio/src/editor/proposal";
import type { SessionIdentity } from "../apps/video-studio/src/editor/session";
import type {
  EditorDocument,
  EditorSequence,
  MediaClip,
  TextClip,
} from "../apps/video-studio/src/editor/types";

const T = 240000;
const F = 8000;
const EXTRA = 1001; // Real media: every clip is 1001 ticks longer than a whole old frame.
let counter = 0;
const idFactory = (kind: string) => `${kind}-plan-${++counter}`;

function legacy(timelineMode: "magnetic" | "free" = "magnetic") {
  return validateProject({
    schemaVersion: 1,
    id: "plan-project",
    name: "方案测试",
    revision: 6,
    width: 1280,
    height: 720,
    fps: 30,
    timelineMode,
    assets: [
      { id: "video", name: "实拍.mp4", kind: "video", durationFrames: 600, width: 1280, height: 720 },
      { id: "second", name: "空镜.mp4", kind: "video", durationFrames: 600, width: 1280, height: 720 },
    ],
    clips: [
      { id: "a", assetId: "video", inFrame: 0, outFrame: 90, volume: 1 },
      { id: "b", assetId: "video", inFrame: 100, outFrame: 190, volume: 1 },
      { id: "c", assetId: "second", inFrame: 0, outFrame: 60, volume: 1 },
    ],
    captions: [
      { id: "cap-early", text: "开场字幕", startFrame: 10, endFrame: 40 },
      { id: "cap-late", text: "结尾字幕", startFrame: 200, endFrame: 230 },
    ],
  });
}
const sequenceOf = (doc: EditorDocument) =>
  doc.sequences.find((item) => item.id === doc.activeSequenceId)!;
const clip = (doc: EditorDocument, id: string) =>
  sequenceOf(doc).clips.find((item) => item.id === id);
const mainTrack = (doc: EditorDocument) =>
  sequenceOf(doc)
    .clips.filter((item) => item.trackId === "track-video-main")
    .sort((x, y) => x.start - y.start)
    .map((item) => [item.id, item.start, item.duration]);
function media(id: string, trackId: string, assetId: string, start: number, duration: number) {
  return {
    id,
    kind: "media",
    label: id,
    trackId,
    assetId,
    start,
    duration,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: duration, source: duration },
      ],
    },
    audio: defaultAudioMix(),
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  } as MediaClip;
}
function text(id: string, trackId: string, start: number, duration: number, role: TextClip["role"]) {
  return {
    id,
    kind: "text",
    role,
    label: id,
    trackId,
    start,
    duration,
    text: id,
    style: defaultTextStyle(),
    words: [],
    transform: defaultTransform(),
    color: defaultColorAdjustment(),
    blendMode: "normal",
  } as TextClip;
}
function edit(doc: EditorDocument, change: (sequence: EditorSequence) => void): EditorDocument {
  const next = structuredClone(doc);
  change(sequenceOf(next));
  return validateEditorDocument(next);
}

/** Real footage: off-frame main clips, captions bound to them and a picture-in-picture track. */
function realMedia(): EditorDocument {
  const base = migrateLegacyProject(
    validateProject({
      ...legacy(),
      clips: [
        { id: "a", assetId: "video", inFrame: 0, outFrame: 240, volume: 1 },
        { id: "b", assetId: "video", inFrame: 250, outFrame: 490, volume: 1 },
        { id: "c", assetId: "second", inFrame: 0, outFrame: 240, volume: 1 },
      ],
      captions: [],
    }),
  );
  const length = 240 * F + EXTRA;
  return edit(base, (sequence) => {
    sequence.frameRate = { numerator: 30000, denominator: 1001 };
    for (const [index, id] of ["a", "b", "c"].entries()) {
      const item = sequence.clips.find((value) => value.id === id) as MediaClip;
      const source = item.timeMap.points[0]!.source;
      item.start = index * length;
      item.duration = length;
      item.timeMap = {
        points: [
          { time: 0, source },
          { time: length, source: source + length },
        ],
      };
    }
    const b = sequence.clips.find((value) => value.id === "b") as MediaClip;
    const c = sequence.clips.find((value) => value.id === "c") as MediaClip;
    const bound = (id: string, owner: MediaClip, start: number, end: number) => ({
      ...text(id, "track-captions", start, end - start, "subtitle"),
      sourceBinding: {
        clipId: owner.id,
        sourceStart: owner.timeMap.points[0]!.source + start - owner.start,
        sourceEnd: owner.timeMap.points[0]!.source + end - owner.start,
      },
    });
    sequence.tracks.splice(1, 0, createTrack("track-overlay", "video", "画中画"));
    sequence.clips.push(
      bound("cap-crossing", b, 3_000_000, 3_800_000),
      bound("cap-after", c, 4_000_000, 4_500_000),
      media("overlay", "track-overlay", "second", 0, 4_000_003),
    );
  });
}

/** Whole-frame main track with an overlay track (and its transition) plus a title. */
function multitrack(timelineMode: "magnetic" | "free" = "magnetic"): EditorDocument {
  return edit(migrateLegacyProject(legacy(timelineMode)), (sequence) => {
    sequence.tracks.splice(
      1,
      0,
      createTrack("track-overlay", "video", "画中画"),
      createTrack("track-title", "text", "标题"),
    );
    sequence.clips.push(
      media("overlay-1", "track-overlay", "second", 0, 60 * F),
      media("overlay-2", "track-overlay", "second", 50 * F, 60 * F),
      text("title", "track-title", 0, 45 * F, "title"),
    );
    sequence.transitions.push({
      id: "overlay-dissolve",
      fromClipId: "overlay-1",
      toClipId: "overlay-2",
      start: 50 * F,
      duration: 10 * F,
      kind: "dissolve",
    });
  });
}
const identity = (doc: EditorDocument): SessionIdentity => ({
  documentId: doc.id,
  generation: 1,
  revision: doc.revision,
});
const apply = (doc: EditorDocument, operations: Parameters<typeof applyEditorOperations>[1]) =>
  applyEditorOperations(doc, operations, doc.revision);

test("the 15 second draft ends real off-frame footage exactly at the frame-snapped limit", () => {
  const doc = realMedia();
  assert.equal(projectLegacyView(doc).timelineComplete, false);
  assert.equal(projectLegacyView(doc).project.clips.length, 0, "The old view cannot show it");
  const limit = snapToFrame(15 * T, { numerator: 30000, denominator: 1001 });
  assert.equal(limit, 3_603_600);
  const plan = planFifteenSecondDraft(doc, "sequence-main", idFactory);
  assert.ok(plan.labels.length >= 2);
  const after = apply(doc, plan.operations);
  const length = 240 * F + EXTRA;
  assert.deepEqual(mainTrack(after), [
    ["a", 0, length],
    ["b", length, limit - length],
  ]);
  const crossing = clip(after, "cap-crossing")!;
  assert.equal(crossing.start, 3_000_000);
  assert.equal(crossing.start + crossing.duration, limit, "Bound captions are trimmed");
  assert.equal(clip(after, "cap-after"), undefined, "Captions of removed clips go with them");
  const overlay = clip(after, "overlay")!;
  assert.deepEqual([overlay.start, overlay.duration], [0, limit], "Other tracks end at the limit too");
  assert.equal(sequenceDuration(sequenceOf(after)), limit, "The draft is a 15 second video");
  assert.throws(
    () => planFifteenSecondDraft(after, "sequence-main", idFactory),
    /不超过 15 秒/,
  );
});

test("the 15 second draft also works on a free main track and keeps the review honest", () => {
  const doc = multitrack("free");
  const plan = planFifteenSecondDraft(
    edit(doc, (sequence) => {
      const c = sequence.clips.find((item) => item.id === "c")!;
      c.start = 460 * F; // a gap before the last clip, beyond 15 s
    }),
    "sequence-main",
    idFactory,
  );
  const before = edit(doc, (sequence) => {
    sequence.clips.find((item) => item.id === "c")!.start = 460 * F;
  });
  const after = apply(before, plan.operations);
  assert.deepEqual(mainTrack(after), [
    ["a", 0, 90 * F],
    ["b", 90 * F, 90 * F],
  ]);
  const proposal = parseEditorProposal(
    { title: "精简", explanation: "", editor: { steps: [{ kind: "remove", sequenceId: "sequence-main", clipIds: ["c"] }] } },
    { document: before, identity: identity(before), origin: "import", idFactory },
  );
  const review = reviewEditorProposal(proposal, before, identity(before));
  assert.equal(review.stale, false);
  assert.equal(review.before, (460 * F + 60 * F) / T);
  assert.equal(review.after, 230 * F / T, "Only the removed picture shortens the sequence end");
  const main = review.tracks.find((item) => item.trackId === "track-video-main")!;
  assert.deepEqual([main.before, main.after], [3, 2]);
  const stale = reviewEditorProposal(proposal, before, { ...identity(before), revision: 99 });
  assert.equal(stale.stale, true);
  assert.equal(stale.after, null, "A stale proposal is never silently rebased");
});

test("legacy trim, remove and move on mapped clips leave extra tracks, titles and transitions alone", () => {
  const doc = multitrack();
  assert.equal(projectLegacyView(doc).timelineComplete, false);
  const operations = translateLegacyOperations(
    doc,
    "sequence-main",
    [
      { type: "trim", clipId: "b", inFrame: 110, outFrame: 190 },
      { type: "remove", clipId: "a" },
      { type: "move", clipId: "c", toIndex: 0 },
    ],
    idFactory,
  );
  const after = apply(doc, operations);
  assert.deepEqual(mainTrack(after), [
    ["c", 0, 60 * F],
    ["b", 60 * F, 80 * F],
  ]);
  assert.deepEqual(clip(after, "b")!.kind === "media" && clip(after, "b").timeMap.points[0], {
    time: 0,
    source: 110 * F,
  });
  for (const id of ["overlay-1", "overlay-2", "title"])
    assert.deepEqual(clip(after, id), clip(doc, id), `${id} stays where it was`);
  // Captions the old view shows go with their picture, as in the old sequence.
  assert.equal(clip(after, "cap-early"), undefined, "Its picture was removed");
  assert.deepEqual([clip(after, "cap-late")!.start, clip(after, "cap-late")!.duration], [20 * F, 30 * F]);
  assert.deepEqual(sequenceOf(after).transitions, sequenceOf(doc).transitions);
});

test("legacy plans name clips that the current project cannot map explicitly", () => {
  const doc = multitrack();
  for (const clipId of ["overlay-1", "title", "missing"])
    assert.throws(
      () =>
        translateLegacyOperations(doc, "sequence-main", [{ type: "remove", clipId }], idFactory),
      /无法对应.*新版方案格式/,
    );
});

test("legacy additions and production notes still apply while the old view is incomplete", () => {
  const doc = multitrack();
  const workflow = {
    stage: "rough-cut" as const,
    brief: "三十秒短片",
    outline: "开场与结尾",
    sources: [{ assetId: "video", role: "main" as const, note: "主镜头" }],
    nextSteps: ["整理字幕"],
    blockers: [],
  };
  const operations = translateLegacyOperations(
    doc,
    "sequence-main",
    [
      { type: "add", assetId: "second", inFrame: 30, outFrame: 60 },
      { type: "workflow", workflow },
      { type: "settings", name: "新名字" },
    ],
    idFactory,
  );
  const after = apply(doc, operations);
  const added = sequenceOf(after).clips.filter(
    (item) => !sequenceOf(doc).clips.some((old) => old.id === item.id),
  );
  assert.equal(added.length, 1);
  assert.equal(added[0]!.trackId, "track-video-main");
  assert.equal(added[0]!.start, 240 * F, "Appended at the end of the main track");
  assert.equal(added[0]!.duration, 30 * F);
  assert.deepEqual(after.production?.workflow, workflow);
  assert.equal(after.name, "新名字");
  for (const id of ["a", "b", "c", "overlay-1", "overlay-2", "title"])
    assert.deepEqual(clip(after, id), clip(doc, id));
});

test("legacy volume and free-timeline moves translate to the matching clip", () => {
  const doc = multitrack("free");
  const after = apply(
    doc,
    translateLegacyOperations(
      doc,
      "sequence-main",
      [
        { type: "volume", clipId: "a", volume: 0.5 },
        { type: "video-move", clipId: "c", startFrame: 400 },
      ],
      idFactory,
    ),
  );
  assert.equal((clip(after, "a") as MediaClip).audio.volume, 0.5);
  assert.equal(clip(after, "c")!.start, 400 * F);
  assert.equal(clip(after, "b")!.start, 90 * F);
});

test("complete old views keep the old caption ripple", () => {
  const doc = migrateLegacyProject(legacy());
  assert.equal(projectLegacyView(doc).timelineComplete, true);
  const after = apply(
    doc,
    translateLegacyOperations(
      doc,
      "sequence-main",
      [{ type: "trim", clipId: "a", inFrame: 0, outFrame: 60 }],
      idFactory,
    ),
  );
  assert.equal(clip(after, "b")!.start, 60 * F);
  assert.equal(clip(after, "cap-late")!.start, 170 * F, "Captions after the cut move up");
});

test("proposal input: stale legacy revisions are refused, editor steps compile, identities must match", () => {
  const doc = multitrack();
  const context = { document: doc, identity: identity(doc), origin: "import" as const, idFactory };
  assert.throws(
    () =>
      parseEditorProposal(
        {
          baseRevision: doc.revision - 1,
          title: "旧方案",
          operations: [{ type: "remove", clipId: "a" }],
        },
        context,
      ),
    /已更新|重新生成/,
  );
  const legacyProposal = parseEditorProposal(
    {
      baseRevision: doc.revision,
      title: "删除开场",
      explanation: "按要求删除",
      operations: [{ type: "remove", clipId: "a" }],
    },
    context,
  );
  assert.equal(legacyProposal.origin, "import");
  assert.deepEqual(legacyProposal.identity, identity(doc));
  assert.equal(legacyProposal.labels.length, 1);
  assert.match(legacyProposal.labels[0]!, /移除/);
  assert.deepEqual(mainTrack(apply(doc, legacyProposal.operations)), [
    ["b", 0, 90 * F],
    ["c", 90 * F, 60 * F],
  ]);

  const editorProposal = parseEditorProposal(
    {
      title: "新版方案",
      explanation: "删除第二段并裁短第一段",
      editor: {
        steps: [
          { kind: "remove", sequenceId: "sequence-main", clipIds: ["b"] },
          {
            kind: "timing",
            sequenceId: "sequence-main",
            clipIds: ["a"],
            action: { kind: "keep-left", time: 30 * F },
          },
        ],
      },
    },
    context,
  );
  assert.equal(editorProposal.labels.length, 2);
  assert.deepEqual(mainTrack(apply(doc, editorProposal.operations)), [
    ["a", 0, 30 * F],
    ["c", 30 * F, 60 * F],
  ]);
  assert.throws(
    () =>
      parseEditorProposal(
        {
          title: "旧身份",
          editor: {
            identity: { ...identity(doc), revision: doc.revision + 1 },
            steps: [{ kind: "remove", sequenceId: "sequence-main", clipIds: ["b"] }],
          },
        },
        context,
      ),
    /已改变|重新/,
  );
  assert.throws(
    () => parseEditorProposal({ title: "空方案", editor: { steps: [] } }, context),
    /1 至 100/,
  );
});

test("legacy trims and splits reach off-frame main clips through their old IDs", () => {
  const doc = realMedia();
  const length = 240 * F + EXTRA;
  const after = apply(
    doc,
    translateLegacyOperations(
      doc,
      "sequence-main",
      [
        { type: "trim", clipId: "b", inFrame: 260, outFrame: 400 },
        { type: "split", clipId: "a", atFrame: 120 },
      ],
      idFactory,
    ),
  );
  const main = mainTrack(after);
  assert.equal(main.length, 4);
  assert.deepEqual(main[0], ["a", 0, 120 * F]);
  assert.deepEqual(main[1]!.slice(1), [120 * F, length - 120 * F]);
  assert.deepEqual(main[2], ["b", length, 140 * F]);
  assert.deepEqual(main[3], ["c", length + 140 * F, length]);
  assert.equal((clip(after, "b") as MediaClip).timeMap.points[0]!.source, 260 * F);
  assert.deepEqual(clip(after, "overlay"), clip(doc, "overlay"));
});

test("the 15 second draft also ends narration, loose captions and titles at the limit", () => {
  const withExtras = (locked = false) =>
    edit(realMedia(), (sequence) => {
      sequence.tracks.push(
        { ...createTrack("track-voice", "audio", "旁白"), muted: true },
        { ...createTrack("track-title", "text", "标题"), hidden: true, locked },
      );
      sequence.clips.push(
        { ...media("voice", "track-voice", "video", 0, 4_500_000) },
        text("loose-caption", "track-captions", 3_500_000, 200_000, "subtitle"),
        text("late-title", "track-title", 4_000_000, 200_000, "title"),
      );
    });
  const doc = withExtras();
  const limit = 3_603_600;
  const plan = planFifteenSecondDraft(doc, "sequence-main", idFactory);
  assert.ok(plan.labels.some((label) => /截断其他轨道 15\.0\d 秒之后的 \d+ 个片段/.test(label)));
  const after = apply(doc, plan.operations);
  assert.equal(sequenceDuration(sequenceOf(after)), limit);
  assert.equal(clip(after, "voice")!.duration, limit);
  assert.equal(clip(after, "loose-caption")!.start + clip(after, "loose-caption")!.duration, limit);
  assert.equal(clip(after, "late-title"), undefined);
  assert.equal(clip(after, "cap-after"), undefined, "Bound captions still follow their owner");
  assert.throws(
    () => planFifteenSecondDraft(withExtras(true), "sequence-main", idFactory),
    /标题.*锁定/,
  );
});

/** Old v1 project with independent narration and a caption across a cut, migrated whole. */
function narrated() {
  return migrateLegacyProject(
    validateProject({
      ...legacy(),
      assets: [
        ...legacy().assets,
        { id: "voice-asset", name: "旁白.wav", kind: "audio", durationFrames: 600 },
      ],
      audioClips: [
        { id: "voice", assetId: "voice-asset", inFrame: 0, outFrame: 200, startFrame: 20, volume: 1 },
      ],
      captions: [
        { id: "cap-early", text: "开场字幕", startFrame: 10, endFrame: 40 },
        { id: "cap-span", text: "跨越剪辑点", startFrame: 80, endFrame: 110 },
        { id: "cap-late", text: "结尾字幕", startFrame: 200, endFrame: 230 },
      ],
    }),
  );
}
const withTitle = (doc: EditorDocument) =>
  edit(doc, (sequence) => {
    sequence.tracks.push(createTrack("track-title", "text", "标题"));
    sequence.clips.push(text("title", "track-title", 0, 45 * F, "title"));
  });
function followers(doc: EditorDocument) {
  return sequenceOf(doc)
    .clips.filter((item) => item.trackId !== "track-video-main" && item.id !== "title")
    // The old view gives each extra narration piece its own track; compare placement only.
    .map((item) => [
      item.kind,
      item.start,
      item.duration,
      item.kind === "text" ? item.text : (item as MediaClip).timeMap.points[0]!.source,
    ])
    .sort((x, y) => String(x[0]).localeCompare(String(y[0])) || Number(x[1]) - Number(y[1]));
}

test("old edits move captions and narration the same way with or without an unrelated title", () => {
  const complete = narrated(),
    incomplete = withTitle(complete);
  assert.equal(projectLegacyView(complete).timelineComplete, true);
  assert.equal(projectLegacyView(incomplete).timelineComplete, false);
  const cases: Parameters<typeof translateLegacyOperations>[2][] = [
    [{ type: "trim", clipId: "a", inFrame: 0, outFrame: 60 }],
    [{ type: "trim", clipId: "b", inFrame: 110, outFrame: 190 }],
    [{ type: "remove", clipId: "a" }],
    [{ type: "move", clipId: "c", toIndex: 0 }],
    [
      { type: "trim", clipId: "a", inFrame: 30, outFrame: 90 },
      { type: "remove", clipId: "b" },
    ],
  ];
  for (const operations of cases) {
    const expected = apply(
      complete,
      translateLegacyOperations(complete, "sequence-main", operations, idFactory),
    );
    const actual = apply(
      incomplete,
      translateLegacyOperations(incomplete, "sequence-main", operations, idFactory),
    );
    const label = JSON.stringify(operations);
    assert.deepEqual(mainTrack(actual), mainTrack(expected), label);
    assert.deepEqual(followers(actual), followers(expected), label);
    assert.deepEqual(clip(actual, "title"), clip(incomplete, "title"), label);
  }
});

test("old moves reorder audio-only main clips like the old sequence", () => {
  const base = migrateLegacyProject(
    validateProject({
      ...legacy(),
      assets: [
        ...legacy().assets,
        { id: "voice-asset", name: "旁白.wav", kind: "audio", durationFrames: 600 },
      ],
      clips: [
        { id: "a", assetId: "video", inFrame: 0, outFrame: 90, volume: 1 },
        { id: "m", assetId: "voice-asset", inFrame: 0, outFrame: 60, volume: 1 },
        { id: "c", assetId: "second", inFrame: 0, outFrame: 60, volume: 1 },
      ],
      captions: [],
    }),
  );
  const positions = (doc: EditorDocument) =>
    ["a", "m", "c"].map((id) => [id, clip(doc, id)!.trackId, clip(doc, id)!.start]);
  for (const doc of [base, withTitle(base)]) {
    const after = apply(
      doc,
      translateLegacyOperations(
        doc,
        "sequence-main",
        [{ type: "move", clipId: "c", toIndex: 0 }],
        idFactory,
      ),
    );
    assert.deepEqual(positions(after), [
      ["a", "track-video-main", 60 * F],
      ["m", "track-audio-main", 150 * F],
      ["c", "track-video-main", 0],
    ]);
  }
});

test("an old plan can split a clip and then use the new piece's old ID", () => {
  for (const doc of [migrateLegacyProject(legacy()), multitrack()]) {
    const after = apply(
      doc,
      translateLegacyOperations(
        doc,
        "sequence-main",
        [
          { type: "split", clipId: "a", atFrame: 30 },
          { type: "remove", clipId: "clip-4" },
        ],
        idFactory,
      ),
    );
    assert.deepEqual(mainTrack(after), [
      ["a", 0, 30 * F],
      ["b", 30 * F, 90 * F],
      ["c", 120 * F, 60 * F],
    ]);
  }
});

test("off-frame clip edges count as unchanged when an old trim keeps them", () => {
  const doc = edit(realMedia(), (sequence) => {
    const b = sequence.clips.find((item) => item.id === "b") as MediaClip;
    b.timeMap = {
      points: [
        { time: 0, source: 2_000_500 },
        { time: b.duration, source: 2_000_500 + b.duration },
      ],
    };
  });
  const b = clip(doc, "b") as MediaClip;
  assert.deepEqual(
    translateLegacyOperations(
      doc,
      "sequence-main",
      [{ type: "trim", clipId: "b", inFrame: 250, outFrame: 490 }],
      idFactory,
    ),
    [],
  );
  const after = apply(
    doc,
    translateLegacyOperations(
      doc,
      "sequence-main",
      [{ type: "trim", clipId: "b", inFrame: 250, outFrame: 400 }],
      idFactory,
    ),
  );
  const trimmed = clip(after, "b") as MediaClip;
  assert.equal(trimmed.start, b.start);
  assert.equal(trimmed.timeMap.points[0]!.source, 2_000_500);
  assert.equal(trimmed.duration, 400 * F - 2_000_500);
});

test("retiming a bound caption through an old plan detaches its binding", () => {
  const doc = edit(multitrack(), (sequence) => {
    const caption = sequence.clips.find((item) => item.id === "cap-early") as TextClip;
    caption.sourceBinding = { clipId: "a", sourceStart: 10 * F, sourceEnd: 40 * F };
  });
  assert.ok((clip(doc, "cap-early") as TextClip).sourceBinding);
  const after = apply(
    doc,
    translateLegacyOperations(
      doc,
      "sequence-main",
      [{ type: "caption", caption: { id: "cap-early", startFrame: 100, endFrame: 130, text: "开场字幕" } }],
      idFactory,
    ),
  );
  const moved = clip(after, "cap-early") as TextClip;
  assert.equal(moved.start, 100 * F);
  assert.equal(moved.sourceBinding, undefined);
});

test("editor proposals review the sequence their steps edit and refuse mixed sequences", () => {
  const doc = edit(multitrack(), () => {});
  const two = validateEditorDocument({
    ...doc,
    sequences: [
      ...doc.sequences,
      {
        ...sequenceOf(doc),
        id: "second",
        name: "第二条",
        clips: [media("second-clip", "track-video-main", "second", 0, 30 * F)],
        transitions: [],
        markers: [],
      },
    ],
  });
  const context = { document: two, identity: identity(two), origin: "import" as const, idFactory };
  const proposal = parseEditorProposal(
    { title: "第二条", editor: { steps: [{ kind: "remove", sequenceId: "second", clipIds: ["second-clip"] }] } },
    context,
  );
  assert.equal(proposal.sequenceId, "second");
  assert.throws(
    () =>
      parseEditorProposal(
        {
          title: "两条",
          editor: {
            steps: [
              { kind: "remove", sequenceId: "second", clipIds: ["second-clip"] },
              { kind: "remove", sequenceId: "sequence-main", clipIds: ["a"] },
            ],
          },
        },
        context,
      ),
    /一条时间线/,
  );
});

test("the 15 second draft cuts a transition after the limit and explains one across it", () => {
  const shifted = (first: number, second: number) =>
    edit(multitrack(), (sequence) => {
      sequence.clips.find((item) => item.id === "overlay-1")!.start = first * F;
      sequence.clips.find((item) => item.id === "overlay-2")!.start = second * F;
      sequence.transitions[0]!.start = second * F;
    });
  const doc = shifted(420, 470);
  const after = apply(doc, planFifteenSecondDraft(doc, "sequence-main", idFactory).operations);
  assert.equal(sequenceDuration(sequenceOf(after)), 450 * F);
  assert.equal(clip(after, "overlay-2"), undefined);
  assert.deepEqual(sequenceOf(after).transitions, []);
  assert.throws(
    () => planFifteenSecondDraft(shifted(395, 445), "sequence-main", idFactory),
    /画中画.*转场/,
  );
});

test("only the local 15-second rule is saved as a user edit; imported and AI plans are agent edits", () => {
  assert.equal(proposalActor("local"), "user");
  assert.equal(proposalActor("import"), "agent");
  assert.equal(proposalActor("agent"), "agent");
  assert.equal(proposalActor("automatic"), "agent");
});
