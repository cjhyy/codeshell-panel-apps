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
  approveNarration,
  bindNarrationRecording,
  hasNarrationApproval,
  narrationFingerprint,
  narrationSnapshot,
  reconcileNarrationEdit,
  updateNarrationScript,
  validateNarration,
  type NarrationState,
} from "../apps/video-studio/src/narration.ts";

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
  const approved = await approveNarration(project);
  assert.equal(approved.revision, project.revision + 1);
  assert.equal(approved.narration!.phase, "approved");
  assert.equal(approved.narration!.approvedScript, project.script);
  assert.equal(approved.narration!.approvedFingerprint, await narrationFingerprint(project));
  assert.equal(await hasNarrationApproval(approved), true);
  assert.equal(await hasNarrationApproval(project), false);
  assert.equal(project.narration!.phase, "review");
  assert.equal(Object.hasOwn(project.narration!, "approvedScript"), false);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(approved))), approved);
});

test("approval captures stable input before awaiting its digest and requires a reviewable draft", async () => {
  const project = fixture();
  const original = structuredClone(project);
  const pending = approveNarration(project);
  project.script = "用户刚修改了文稿。";
  const approved = await pending;
  assert.equal(approved.script, original.script);
  assert.equal(approved.narration!.approvedScript, original.script);
  assert.equal(await hasNarrationApproval(approved), true);
  assert.equal(project.script, "用户刚修改了文稿。");
  for (const phase of ["draft", "approved"] as const) {
    const invalid = structuredClone(phase === "approved" ? approved : original);
    invalid.narration!.phase = phase;
    await assert.rejects(approveNarration(invalid), /先完成草稿/);
  }
  const empty = createProject();
  empty.narration = { phase: "review", captionBasis: "draft", draftCaptionIds: [] };
  await assert.rejects(approveNarration(empty), /非空文本/);
  empty.script = "文稿已有，画面还没有。";
  await assert.rejects(approveNarration(empty), /安排草稿画面/);
});

test("recording binding stores the exact full original without changing media, cuts or captions", async () => {
  const approved = await approveNarration(fixture());
  const before = structuredClone(approved);
  const bound = await bindNarrationRecording(approved, "my-take");
  assert.equal(bound.narration!.phase, "recorded");
  assert.equal(bound.narration!.recordingAssetId, "my-take");
  assert.equal(bound.narration!.captionBasis, "draft");
  assert.equal(bound.revision, approved.revision + 1);
  assert.equal(await hasNarrationApproval(bound), true);
  for (const key of ["assets", "clips", "audioClips", "captions", "script"] as const)
    assert.deepEqual(bound[key], approved[key]);
  assert.equal(bound.assets.find((asset) => asset.id === "my-take")!.durationFrames, 3000);
  assert.deepEqual(approved, before);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(bound))), bound);
  const fromVideo = structuredClone(approved);
  fromVideo.assets.push({
    id: "camera-take",
    kind: "video",
    name: "摄像机口播",
    durationFrames: 3600,
  });
  assert.equal(
    (await bindNarrationRecording(fromVideo, "camera-take")).narration!.recordingAssetId,
    "camera-take",
  );
});

test("foreign, image and synthesized recordings or stale approval cannot be selected", async () => {
  const approved = await approveNarration(fixture());
  approved.assets.push(
    { id: "photo", name: "照片", kind: "image", durationFrames: 150 },
    {
      id: "tts-take",
      name: "机器旁白",
      kind: "audio",
      durationFrames: 90,
      speech: { text: "合成声音", voiceId: "voice-1", engine: "test", rate: 1 },
    },
  );
  const before = structuredClone(approved);
  await assert.rejects(bindNarrationRecording(approved, "other-project-take"), /当前工程/);
  await assert.rejects(bindNarrationRecording(approved, "photo"), /当前工程/);
  await assert.rejects(bindNarrationRecording(approved, "tts-take"), /合成配音/);
  assert.deepEqual(approved, before);
  const changed = structuredClone(approved);
  changed.script = "这是已经改动的新稿。";
  assert.equal(await hasNarrationApproval(changed), false);
  await assert.rejects(bindNarrationRecording(changed, "my-take"), /重新确认/);
});

test("preparation, new assets, labels and workflow metadata do not revoke approval", async () => {
  const approved = await approveNarration(fixture());
  const metadata = structuredClone(approved);
  metadata.revision += 9;
  metadata.name = "改了工程名称";
  metadata.assets[0]!.thumbnailId = "thumb-1";
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
  assert.equal(await hasNarrationApproval(reconciled), true);
  assert.equal(await narrationFingerprint(reconciled), approved.narration!.approvedFingerprint);
  reconciled.assets[0]!.name = "副本修改";
  assert.notEqual(metadata.assets[0]!.name, reconciled.assets[0]!.name);
});

test("script, picture, voice, subtitle and layout edits revoke every approved phase", async () => {
  const approved = await bindNarrationRecording(await approveNarration(fixture()), "my-take");
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
      assert.equal(await hasNarrationApproval(reconciled), false);
      assert.equal(original.narration!.phase, phase);
      assert.equal(reconciled.revision, next.revision);
    }
  }
});

test("reconfirmation reuses the original recording and explicit alignment does not auto-approve changed content", async () => {
  const bound = await bindNarrationRecording(await approveNarration(fixture()), "my-take");
  const edited = structuredClone(bound);
  edited.script = "重新确认后的新文稿。";
  edited.revision++;
  const reviewed = reconcileNarrationEdit(bound, edited);
  const approvedAgain = await approveNarration(reviewed);
  assert.equal(approvedAgain.narration!.recordingAssetId, "my-take");
  assert.equal(await hasNarrationApproval(approvedAgain), true);
  assert.notEqual(
    approvedAgain.narration!.approvedFingerprint,
    bound.narration!.approvedFingerprint,
  );
  const alignment = structuredClone(bound);
  alignment.audioClips!.push({
    id: "own-voice",
    assetId: "my-take",
    startFrame: 0,
    inFrame: 0,
    outFrame: 300,
    volume: 1,
  });
  alignment.narration!.phase = "aligned";
  alignment.narration!.captionBasis = "recording";
  const accepted = reconcileNarrationEdit(bound, alignment, true);
  assert.equal(accepted.narration!.phase, "aligned");
  assert.equal(accepted.narration!.approvedFingerprint, bound.narration!.approvedFingerprint);
  assert.equal(await hasNarrationApproval(accepted), false);
  const otherProject = fixture();
  assert.deepEqual(reconcileNarrationEdit(bound, otherProject), otherProject);
});

test("coordinator alignment checkpoints resume without overwriting user approval and edits revoke both", async () => {
  const bound = await bindNarrationRecording(await approveNarration(fixture()), "my-take");
  const originalApproval = bound.narration!.approvedFingerprint;
  const alignment = structuredClone(bound);
  alignment.audioClips!.push({
    id: "own-voice",
    assetId: "my-take",
    startFrame: 0,
    inFrame: 0,
    outFrame: 300,
    volume: 1,
  });
  alignment.narration!.phase = "aligned";
  alignment.narration!.captionBasis = "recording";
  alignment.narration!.alignmentFingerprint = await narrationFingerprint(alignment);
  const checkpoint = reconcileNarrationEdit(bound, alignment, true);
  assert.equal(checkpoint.narration!.approvedFingerprint, originalApproval);
  assert.notEqual(checkpoint.narration!.alignmentFingerprint, originalApproval);
  assert.equal(await hasNarrationApproval(checkpoint), true);
  const recovered = validateProject(JSON.parse(JSON.stringify(checkpoint)));
  assert.equal(await hasNarrationApproval(recovered), true);
  const rebound = await bindNarrationRecording(recovered, "my-take");
  assert.equal(rebound.narration!.phase, "recorded");
  assert.equal(rebound.narration!.alignmentFingerprint, checkpoint.narration!.alignmentFingerprint);
  assert.equal(rebound.narration!.approvedFingerprint, originalApproval);
  assert.equal(await hasNarrationApproval(rebound), true);
  const changed = structuredClone(recovered);
  changed.captions[0]!.text = "用户手工改了字幕。";
  assert.equal(await hasNarrationApproval(changed), false);
  const reviewed = reconcileNarrationEdit(recovered, changed);
  for (const key of ["approvedScript", "approvedFingerprint", "alignmentFingerprint"])
    assert.equal(Object.hasOwn(reviewed.narration!, key), false);
  assert.equal(reviewed.narration!.recordingAssetId, "my-take");
  const reapproved = await approveNarration(reviewed);
  assert.equal(Object.hasOwn(reapproved.narration!, "alignmentFingerprint"), false);
  assert.equal(await hasNarrationApproval(reapproved), true);
  assert.equal(recovered.narration!.approvedFingerprint, originalApproval);
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

test("manual script edits replace only owned draft captions with complete estimated text", async () => {
  const original = await bindNarrationRecording(await approveNarration(fixture()), "my-take");
  const title = { id: "draft-narration-1", startFrame: 0, endFrame: 100, text: "用户独立标题" };
  original.captions.push(title);
  // The independent title existed when this draft was last checked.
  original.narration!.alignmentFingerprint = await narrationFingerprint(original);
  const before = structuredClone(original);
  const text = "  先去海边。\r\n\r\n然后慢慢走进老街，看看日常生活！  最后一起看夕阳。 ";
  const updated = updateNarrationScript(original, text);
  const owned = updated.captions.filter((caption) =>
    updated.narration!.draftCaptionIds.includes(caption.id),
  );
  assert.equal(updated.revision, original.revision + 1);
  assert.equal(updated.script, text.replace(/\r\n?/g, "\n").trim());
  assert.equal(updated.narration!.phase, "review");
  assert.equal(updated.narration!.captionBasis, "draft");
  assert.equal(updated.narration!.recordingAssetId, "my-take");
  assert.equal(owned.length, 3);
  assert.equal(owned[0]!.id, "draft-narration-2");
  assert.equal(
    owned
      .map((caption) => caption.text)
      .join("")
      .replace(/\s/g, ""),
    text.replace(/\s/g, ""),
  );
  assert.deepEqual(
    updated.captions.find((caption) => caption.id === title.id),
    title,
  );
  assert.equal(
    updated.captions.some((caption) => before.narration!.draftCaptionIds.includes(caption.id)),
    false,
  );
  assert.equal(owned[0]!.startFrame, 0);
  assert.equal(
    owned.at(-1)!.endFrame,
    updated.clips.reduce((sum, clip) => sum + clip.outFrame - clip.inFrame, 0),
  );
  for (const [index, caption] of owned.entries()) {
    assert.ok(caption.endFrame > caption.startFrame);
    if (index) assert.equal(caption.startFrame, owned[index - 1]!.endFrame);
  }
  for (const key of ["approvedScript", "approvedFingerprint", "alignmentFingerprint"])
    assert.equal(Object.hasOwn(updated.narration!, key), false);
  for (const key of ["assets", "clips", "audioClips"] as const)
    assert.deepEqual(updated[key], before[key]);
  assert.deepEqual(original, before);
  assert.deepEqual(validateProject(updated), updated);
});

test("editing an aligned script removes its recorded subtitles but keeps titles and original sound", async () => {
  const original = await bindNarrationRecording(await approveNarration(fixture()), "my-take");
  original.narration!.phase = "aligned";
  original.narration!.captionBasis = "recording";
  original.captions = [
    { id: "recorded-narration-1", startFrame: 0, endFrame: 100, text: "旧口播真实转写" },
    { id: "chapter-title", startFrame: 110, endFrame: 150, text: "独立章节标题" },
  ];
  original.audioClips = [
    { id: "voice", assetId: "my-take", startFrame: 0, inFrame: 0, outFrame: 300, volume: 1 },
  ];
  original.narration!.alignmentFingerprint = await narrationFingerprint(original);
  const updated = updateNarrationScript(original, "修改了说法，需要重新确认。再去录一遍。 ");
  assert.equal(updated.narration!.phase, "review");
  assert.equal(updated.narration!.captionBasis, "draft");
  assert.equal(
    updated.captions.some((caption) => caption.id.startsWith("recorded-narration-")),
    false,
  );
  assert.deepEqual(
    updated.captions.find((caption) => caption.id === "chapter-title"),
    original.captions[1],
  );
  assert.deepEqual(updated.audioClips, original.audioClips);
  assert.equal(await hasNarrationApproval(updated), false);
  assert.doesNotThrow(() => validateProject(updated));
});

test("script edits clear prior recorded subtitles after an intervening manual edit revoked alignment", async () => {
  const aligned = await bindNarrationRecording(await approveNarration(fixture()), "my-take");
  aligned.narration!.phase = "aligned";
  aligned.narration!.captionBasis = "recording";
  aligned.captions = [
    { id: "recorded-narration-1", startFrame: 0, endFrame: 100, text: "旧的真实口播字幕" },
    { id: "chapter-title", startFrame: 0, endFrame: 100, text: "需要保留的用户标题" },
  ];
  aligned.narration!.alignmentFingerprint = await narrationFingerprint(aligned);
  const edited = structuredClone(aligned);
  edited.clips[0]!.inFrame++;
  edited.revision++;
  const review = reconcileNarrationEdit(aligned, edited);
  assert.equal(review.narration!.phase, "review");
  assert.equal(review.narration!.captionBasis, "draft");
  assert.ok(review.captions.some((caption) => caption.id.startsWith("recorded-narration-")));
  const updated = updateNarrationScript(review, "现在重新写一段口播。让新文案对应新的草稿。 ");
  assert.equal(updated.narration!.phase, "review");
  assert.equal(
    updated.captions.some((caption) => caption.id.startsWith("recorded-narration-")),
    false,
  );
  assert.deepEqual(
    updated.captions.find((caption) => caption.id === "chapter-title"),
    aligned.captions[1],
  );
  assert.equal(
    updated.captions.filter((caption) => updated.narration!.draftCaptionIds.includes(caption.id))
      .length,
    2,
  );
  assert.doesNotThrow(() => validateProject(updated));
});

test("draft and empty timeline script edits remain unfinished without creating out-of-bounds subtitles", () => {
  const unfinished = fixture();
  unfinished.narration!.phase = "draft";
  const updated = updateNarrationScript(unfinished, "还在构思的内容。 ");
  assert.equal(updated.narration!.phase, "draft");
  assert.ok(updated.narration!.draftCaptionIds.length > 0);
  const empty = createProject();
  const saved = updateNarrationScript(empty, "只有文案，还没有素材。\n先不要生成越界字幕。");
  assert.equal(saved.narration!.phase, "draft");
  assert.equal(saved.narration!.captionBasis, "draft");
  assert.deepEqual(saved.captions, []);
  assert.deepEqual(saved.narration!.draftCaptionIds, []);
  assert.equal(saved.revision, empty.revision + 1);
  assert.doesNotThrow(() => validateProject(saved));
  const legacy = createDemoProject();
  const editedLegacy = updateNarrationScript(legacy, "已有画面，现在整理口播稿。 ");
  assert.equal(editedLegacy.narration!.phase, "review");
  for (const original of legacy.captions)
    assert.deepEqual(
      editedLegacy.captions.find((caption) => caption.id === original.id),
      original,
    );
});

test("estimated subtitle packing preserves long and many-sentence scripts within real frame limits", () => {
  for (const [text, frames] of [
    ["旅".repeat(10000), 3],
    ["🙂".repeat(4999), 3],
    ["走。".repeat(5000), 2000],
    ["开始。\n\n看看风景！ 结束。", 1],
  ] as const) {
    const project = fixture();
    project.clips = [{ ...project.clips[0]!, inFrame: 0, outFrame: frames }];
    project.assets.find((asset) => asset.id === project.clips[0]!.assetId)!.durationFrames =
      Math.max(frames, 180);
    project.captions = [];
    project.narration!.draftCaptionIds = [];
    const updated = updateNarrationScript(project, text);
    assert.ok(updated.captions.length > 0 && updated.captions.length <= 1000);
    assert.ok(
      updated.captions.every(
        (caption) => caption.text.length <= 4000 && caption.endFrame > caption.startFrame,
      ),
    );
    assert.equal(
      updated.captions
        .map((caption) => caption.text)
        .join("")
        .replace(/\s/g, ""),
      text.replace(/\s/g, ""),
    );
    assert.equal(updated.captions.at(-1)!.endFrame, frames);
    assert.ok(
      updated.captions.every((caption) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(caption.text)),
    );
    assert.doesNotThrow(() => validateProject(updated));
  }
});

test("invalid or unrepresentable script edits leave the current draft untouched", () => {
  const original = fixture();
  const before = structuredClone(original);
  for (const text of [" ", "x".repeat(10001), "不允许\u0001字符"])
    assert.throws(() => updateNarrationScript(original, text));
  assert.deepEqual(original, before);
  const tiny = fixture();
  tiny.clips = [{ ...tiny.clips[0]!, inFrame: 0, outFrame: 1 }];
  tiny.captions = [];
  const snapshot = structuredClone(tiny);
  assert.throws(() => updateNarrationScript(tiny, "字".repeat(4001)), /画面太短/);
  assert.deepEqual(tiny, snapshot);
});

test("explicit replacement recording removes only the old narration track and owned recorded subtitles", async () => {
  const original = await bindNarrationRecording(await approveNarration(fixture()), "my-take");
  original.assets.push(
    { id: "new-take", kind: "audio", name: "新录一遍", durationFrames: 900 },
    { id: "music", kind: "audio", name: "背景音乐", durationFrames: 600 },
  );
  original.audioClips = [
    { id: "old-voice-1", assetId: "my-take", startFrame: 0, inFrame: 20, outFrame: 120, volume: 1 },
    {
      id: "old-voice-2",
      assetId: "my-take",
      startFrame: 120,
      inFrame: 160,
      outFrame: 260,
      volume: 1,
    },
    { id: "music-track", assetId: "music", startFrame: 0, inFrame: 0, outFrame: 500, volume: 0.2 },
  ];
  original.captions = [
    { id: "recorded-narration-1", startFrame: 0, endFrame: 100, text: "旧的本人声音字幕" },
    { id: "title-preserved", startFrame: 0, endFrame: 100, text: "旅行中的一天" },
  ];
  original.narration!.phase = "aligned";
  original.narration!.captionBasis = "recording";
  original.narration!.alignmentFingerprint = await narrationFingerprint(original);
  const before = structuredClone(original);
  const replaced = await bindNarrationRecording(original, "new-take");
  assert.equal(replaced.narration!.recordingAssetId, "new-take");
  assert.equal(replaced.narration!.phase, "recorded");
  assert.equal(replaced.narration!.captionBasis, "draft");
  assert.deepEqual(replaced.audioClips, [before.audioClips![2]]);
  assert.deepEqual(replaced.captions, [before.captions[1]]);
  assert.deepEqual(replaced.clips, before.clips);
  assert.deepEqual(replaced.assets, before.assets);
  assert.equal(replaced.narration!.approvedFingerprint, before.narration!.approvedFingerprint);
  assert.notEqual(replaced.narration!.alignmentFingerprint, before.narration!.alignmentFingerprint);
  assert.equal(await hasNarrationApproval(replaced), true);
  assert.deepEqual(original, before);
  assert.doesNotThrow(() => validateProject(replaced));
  const reselected = await bindNarrationRecording(original, "my-take");
  assert.deepEqual(reselected.audioClips, before.audioClips);
  assert.deepEqual(reselected.captions, before.captions);
  assert.equal(reselected.narration!.alignmentFingerprint, before.narration!.alignmentFingerprint);
  assert.equal(await hasNarrationApproval(reselected), true);
});
