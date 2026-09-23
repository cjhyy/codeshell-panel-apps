import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  applyOperations,
  createDemoProject,
  createProject,
  validateProject,
  type Project,
} from "../apps/video-studio/src/model.ts";
import {
  narrationFingerprint,
  narrationSnapshot,
  reconcileNarrationEdit,
  validateNarration,
  type NarrationState,
} from "../apps/video-studio/src/narration.ts";
import { hasEditorNarrationApproval } from "../apps/video-studio/src/editor/narration-edits.ts";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration.ts";

/** An approval as older versions saved it: a SHA-256 of the 30 fps compatibility view. */
async function legacyApprove(project: Project, recordingAssetId?: string): Promise<Project> {
  const next = validateProject(structuredClone(project));
  next.narration = {
    ...next.narration!,
    phase: recordingAssetId ? "recorded" : "approved",
    captionBasis: "draft",
    approvedScript: next.script!,
    approvedFingerprint: await narrationFingerprint(next),
    ...(recordingAssetId ? { recordingAssetId } : {}),
  };
  return validateProject(next);
}
/** The product's check of an old approval, through the editor document. */
const approvedNow = (project: Project) => hasEditorNarrationApproval(migrateLegacyProject(project));
function fixture(): Project {
  const project = createDemoProject();
  project.script = "今天从海边出发，走进老街。";
  project.assets.push({
    id: "my-take",
    kind: "audio",
    name: "本人完整口播",
    durationFrames: 3000,
  });
  project.narration = {
    phase: "review",
    captionBasis: "draft",
    draftCaptionIds: ["caption-1", "caption-2", "caption-3"],
  };
  return validateProject(project);
}

test("legacy projects stay byte-equivalent and optional narration round trips detached", () => {
  const legacy = createDemoProject();
  assert.equal(Object.hasOwn(validateProject(legacy), "narration"), false);
  assert.equal(JSON.stringify(validateProject(legacy)), JSON.stringify(legacy));
  const project = fixture();
  const restored = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored, project);
  restored.narration!.draftCaptionIds.push("removed-caption-still-tracked");
  assert.equal(project.narration!.draftCaptionIds.length, 3);
  assert.doesNotThrow(() => validateProject(restored));
});

test("approval uses actual SHA-256 over canonical editing content", async () => {
  const project = fixture();
  const snapshot = narrationSnapshot(project);
  assert.equal(
    await narrationFingerprint(project),
    createHash("sha256").update(snapshot).digest("hex"),
  );
  const reordered = structuredClone(project);
  reordered.clips = reordered.clips.map(({ volume, outFrame, inFrame, assetId, id }) => ({
    volume,
    outFrame,
    inFrame,
    assetId,
    id,
  }));
  assert.equal(narrationSnapshot(reordered), snapshot);
  reordered.captionStyle = "classic";
  assert.equal(narrationSnapshot(reordered), snapshot);
  // An approval saved on this basis by older versions is still honored through the editor.
  const approved = await legacyApprove(project);
  assert.equal(await approvedNow(approved), true);
  assert.equal(await approvedNow(project), false);
  assert.equal(project.narration!.phase, "review");
  assert.equal(Object.hasOwn(project.narration!, "approvedScript"), false);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(approved))), approved);
});

test("preparation, new assets, labels and workflow metadata do not revoke approval", async () => {
  const approved = await legacyApprove(fixture());
  const metadata = structuredClone(approved);
  metadata.revision += 9;
  metadata.name = "改了工程名称";
  metadata.assets[0]!.thumbnailId = `asset-${"c".repeat(64)}`;
  metadata.assets.push({ id: "new-take", name: "新的口播", kind: "audio", durationFrames: 600 });
  metadata.workflow = {
    stage: "rough-cut",
    brief: "旅行记录",
    outline: "从海边到老街。",
    sources: [],
    nextSteps: ["录制已确认文稿。"],
    blockers: [],
  };
  const reconciled = reconcileNarrationEdit(approved, metadata);
  assert.deepEqual(reconciled, metadata);
  assert.equal(await approvedNow(reconciled), true);
  assert.equal(await narrationFingerprint(reconciled), approved.narration!.approvedFingerprint);
  reconciled.assets[0]!.name = "副本修改";
  assert.notEqual(metadata.assets[0]!.name, reconciled.assets[0]!.name);
});

test("script, picture, voice, subtitle and layout edits revoke every approved phase", async () => {
  const approved = await legacyApprove(fixture(), "my-take");
  const changes: Array<(project: Project) => void> = [
    (project) => {
      project.script += "新增一句。";
    },
    (project) => {
      project.clips[0]!.inFrame += 1;
    },
    (project) => {
      project.clips.reverse();
    },
    (project) => {
      project.clips[0]!.volume = 0;
    },
    (project) => {
      project.audioClips!.push({
        id: "voice-new",
        assetId: "my-take",
        startFrame: 0,
        inFrame: 0,
        outFrame: 90,
        volume: 1,
      });
    },
    (project) => {
      project.captions[0]!.text += "修改";
    },
    (project) => {
      project.captions[0]!.endFrame -= 1;
    },
    (project) => {
      project.captionStyle = "bold";
    },
    (project) => {
      project.width = 720;
    },
    (project) => {
      project.height = 1280;
    },
  ];
  for (const phase of ["approved", "recorded", "aligned"] as const) {
    const original = structuredClone(approved);
    original.narration!.phase = phase;
    original.narration!.captionBasis = phase === "aligned" ? "recording" : "draft";
    for (const change of changes) {
      const next = structuredClone(original);
      change(next);
      next.revision++;
      const reconciled = reconcileNarrationEdit(original, next);
      assert.equal(reconciled.narration!.phase, "review");
      assert.equal(reconciled.narration!.captionBasis, "draft");
      assert.equal(Object.hasOwn(reconciled.narration!, "approvedScript"), false);
      assert.equal(Object.hasOwn(reconciled.narration!, "approvedFingerprint"), false);
      assert.deepEqual(reconciled.narration!.draftCaptionIds, original.narration!.draftCaptionIds);
      assert.equal(reconciled.narration!.recordingAssetId, "my-take");
      assert.equal(await approvedNow(reconciled), false);
      assert.equal(original.narration!.phase, phase);
      assert.equal(reconciled.revision, next.revision);
    }
  }
});

test("strict narration validation rejects unknown properties, malformed state and out-of-project sources", () => {
  const project = fixture();
  const review = project.narration!;
  const recorded: NarrationState = {
    ...review,
    phase: "recorded",
    approvedScript: project.script,
    approvedFingerprint: "a".repeat(64),
    recordingAssetId: "my-take",
  };
  const invalid: unknown[] = [
    null,
    [],
    "recorded",
    Object.create({ phase: "review" }),
    { ...review, phase: "done" },
    { ...review, captionBasis: "estimated" },
    { ...review, captionBasis: "recording" },
    { ...review, approvedScript: "偷偷确认" },
    { ...review, approvedFingerprint: undefined },
    { ...review, alignmentFingerprint: "a".repeat(64) },
    { ...review, unknown: true },
    { ...review, [Symbol("secret")]: true },
    { ...review, draftCaptionIds: ["same", "same"] },
    { ...review, draftCaptionIds: ["../title"] },
    { ...review, draftCaptionIds: ["x".repeat(129)] },
    { ...review, draftCaptionIds: Array.from({ length: 1001 }, (_, index) => `caption-${index}`) },
    { ...review, draftCaptionIds: null },
    { ...review, recordingAssetId: undefined },
    { ...review, recordingAssetId: "foreign" },
    { ...recorded, approvedScript: " " },
    { ...recorded, approvedScript: "x".repeat(10001) },
    { ...recorded, approvedScript: "不允许\u0001字符" },
    { ...recorded, approvedFingerprint: "a".repeat(63) },
    { ...recorded, approvedFingerprint: "z".repeat(64) },
    { ...recorded, alignmentFingerprint: undefined },
    { ...recorded, alignmentFingerprint: "a".repeat(63) },
    { ...recorded, phase: "approved", alignmentFingerprint: "a".repeat(64) },
    { ...recorded, recordingAssetId: undefined },
    { ...recorded, phase: "aligned", recordingAssetId: "demo-intro" },
    { ...recorded, phase: "aligned", captionBasis: "unverified" },
  ];
  for (const state of invalid) {
    assert.throws(() => validateNarration(state, project.assets));
    assert.throws(() => validateProject({ ...project, narration: state }));
  }
  assert.doesNotThrow(() => validateNarration(recorded, project.assets));
  assert.doesNotThrow(() =>
    validateNarration({ ...recorded, phase: "aligned", captionBasis: "recording" }, project.assets),
  );
  assert.doesNotThrow(() => validateNarration({ ...review, draftCaptionIds: [] }, project.assets));
});

test("Agent operations cannot write approval state directly or smuggle it into settings", () => {
  const project = fixture();
  const before = structuredClone(project);
  for (const operation of [
    { type: "narration", narration: { phase: "approved" } },
    { type: "settings", narration: { phase: "approved" } },
  ])
    assert.throws(() => applyOperations(project, [operation as never], project.revision));
  assert.deepEqual(project, before);
});
