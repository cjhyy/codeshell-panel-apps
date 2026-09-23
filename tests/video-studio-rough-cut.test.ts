import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyOperations,
  createProject,
  timelineDuration,
  validateProject,
  type Project,
  type RoughCut,
} from "../apps/video-studio/src/model.ts";
import {
  createRoughCut,
  exportRoughCutsCsv,
  invertRoughCuts,
  splitRoughCut,
} from "../apps/video-studio/src/rough-cut.ts";
import { publishProductionAssets } from "../apps/video-studio/src/voiceover.ts";

function fixture(): Project {
  return validateProject({
    ...createProject("粗剪测试"),
    assets: [
      { id: "video-a", name: "原片 A", kind: "video", durationFrames: 1800 },
      { id: "video-b", name: "原片 B", kind: "video", durationFrames: 900 },
      { id: "audio-a", name: "原声", kind: "audio", durationFrames: 600 },
      { id: "image-a", name: "封面", kind: "image", durationFrames: 300 },
    ],
    clips: [{ id: "existing", assetId: "video-b", inFrame: 0, outFrame: 600, volume: 0.5 }],
    captions: [{ id: "caption-a", startFrame: 30, endFrame: 60, text: "现有字幕" }],
  });
}

function cut(
  id: string,
  inFrame: number,
  outFrame: number,
  extra: Partial<RoughCut> = {},
): RoughCut {
  return { id, assetId: "video-a", inFrame, outFrame, name: "保留片段", enabled: true, ...extra };
}

test("rough cuts preserve legacy projects and roundtrip independently from the finished edit", () => {
  const legacy = fixture();
  assert.equal(legacy.roughCuts, undefined);
  const project = validateProject({
    ...legacy,
    roughCuts: [
      cut("rough-cut-1", 150, 300, { name: '开场, "重点"\n第二行' }),
      cut("rough-cut-2", 600, 900, { name: "", enabled: false }),
      cut("rough-cut-3", 30, 90, { assetId: "audio-a" }),
    ],
  });
  const restored = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored, project);
  assert.deepEqual(restored.clips, legacy.clips);
  assert.deepEqual(restored.captions, legacy.captions);
  assert.equal(timelineDuration(restored), timelineDuration(legacy));
  restored.roughCuts![0]!.name = "独立副本";
  assert.notEqual(restored.roughCuts![0]!.name, project.roughCuts![0]!.name);
});

test("rough cut schema rejects invalid sources, ranges, fields and duplicate IDs across all sources", () => {
  const project = fixture();
  const valid = cut("rough-cut-1", 0, 30);
  for (const extra of [
    { id: "" },
    { assetId: "missing" },
    { assetId: "image-a" },
    { inFrame: -1 },
    { inFrame: 0.5 },
    { inFrame: 30 },
    { outFrame: 0 },
    { outFrame: 1801 },
    { outFrame: Infinity },
    { name: "字".repeat(201) },
    { name: "标题\u0000" },
    { name: 123 },
    { enabled: "yes" },
    { sourcePath: "/private/original.mp4" },
  ]) {
    assert.throws(() => validateProject({ ...project, roughCuts: [{ ...valid, ...extra }] }));
  }
  assert.throws(() =>
    validateProject({
      ...project,
      roughCuts: [valid, { ...valid, assetId: "video-b" }],
    }),
  );
  const thousand = Array.from({ length: 1000 }, (_, index) => cut(`cut-${index}`, 0, 30));
  assert.equal(validateProject({ ...project, roughCuts: thousand }).roughCuts?.length, 1000);
  assert.throws(() =>
    validateProject({ ...project, roughCuts: [...thousand, cut("extra", 0, 30)] }),
  );
});

test("creating a cut returns a distinct identity and never changes the source or timeline", () => {
  const project = fixture();
  project.roughCuts = [cut("rough-cut-1", 0, 30)];
  const before = structuredClone(project);
  const created = createRoughCut(project, "video-a", 150, 300, "好的一段");
  assert.equal(created.id, "rough-cut-2");
  assert.deepEqual(
    { ...created, id: "ignored" },
    {
      id: "ignored",
      assetId: "video-a",
      inFrame: 150,
      outFrame: 300,
      name: "好的一段",
      enabled: true,
    },
  );
  assert.deepEqual(project, before);
  for (const [assetId, from, to] of [
    ["missing", 0, 30],
    ["image-a", 0, 30],
    ["video-a", -1, 30],
    ["video-a", 30, 30],
    ["video-a", 0, 1801],
    ["audio-a", 0, 601],
  ] as const) {
    assert.throws(() => createRoughCut(project, assetId, from, to));
  }
});

test("rough cut replacement is atomic, does not edit existing tracks, and has a restorable undo snapshot", () => {
  const before = fixture();
  before.roughCuts = [cut("rough-cut-1", 0, 90)];
  const undo = JSON.parse(JSON.stringify(before));
  const cuts = [cut("rough-cut-2", 150, 300)];
  const after = applyOperations(before, [{ type: "rough-cuts", cuts }], before.revision);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.roughCuts, cuts);
  assert.deepEqual(after.clips, before.clips);
  assert.deepEqual(after.captions, before.captions);
  cuts[0]!.name = "更改输入对象";
  assert.equal(after.roughCuts![0]!.name, "保留片段");
  assert.throws(() =>
    applyOperations(
      before,
      [
        { type: "rough-cuts", cuts: [cut("rough-cut-3", 0, 30)] },
        { type: "remove", clipId: "not-a-clip" },
      ],
      before.revision,
    ),
  );
  assert.deepEqual(before, undo);
  assert.deepEqual(validateProject(undo), before);
  assert.throws(() => applyOperations(after, [{ type: "rough-cuts", cuts: [] }], before.revision));
});

test("inversion uses the enabled union, merges adjacent ranges and keeps other assets in order", () => {
  const project = fixture();
  const otherA = cut("other-a", 0, 30, { assetId: "video-b" });
  const otherB = cut("other-b", 30, 60, { assetId: "audio-a" });
  project.roughCuts = [
    otherA,
    cut("a", 150, 300),
    cut("b", 210, 450),
    otherB,
    cut("c", 450, 600),
    cut("disabled", 900, 1200, { enabled: false }),
  ];
  const before = structuredClone(project);
  const inverted = invertRoughCuts(project, "video-a");
  assert.deepEqual(
    inverted
      .filter((item) => item.assetId === "video-a")
      .map((item) => [item.inFrame, item.outFrame]),
    [
      [0, 150],
      [600, 1800],
    ],
  );
  assert.equal(inverted[0]?.id, otherA.id);
  assert.equal(inverted.at(-1)?.id, otherB.id);
  assert.deepEqual(
    inverted.filter((item) => item.assetId !== "video-a"),
    [otherA, otherB],
  );
  assert.ok(inverted.every((item) => item.enabled));
  assert.equal(new Set(inverted.map((item) => item.id)).size, inverted.length);
  assert.deepEqual(project, before);
  assert.doesNotThrow(() => validateProject({ ...project, roughCuts: inverted }));
});

test("inversion handles no selection, all-disabled selection and complete coverage", () => {
  const project = fixture();
  project.roughCuts = [cut("other", 0, 30, { assetId: "video-b" })];
  const whole = invertRoughCuts(project, "video-a");
  assert.deepEqual(
    whole.map(({ assetId, inFrame, outFrame }) => [assetId, inFrame, outFrame]),
    [
      ["video-b", 0, 30],
      ["video-a", 0, 1800],
    ],
  );
  project.roughCuts = [cut("disabled", 150, 300, { enabled: false })];
  assert.deepEqual(
    invertRoughCuts(project, "video-a").map(({ inFrame, outFrame }) => [inFrame, outFrame]),
    [[0, 1800]],
  );
  project.roughCuts = [cut("full", 0, 1800)];
  assert.deepEqual(invertRoughCuts(project, "video-a"), []);
});

test("split preserves disabled state and names, covers the original range exactly and rejects empty sides", () => {
  const project = fixture();
  project.roughCuts = [cut("rough-cut-1", 150, 450, { name: "待定片段", enabled: false })];
  const before = structuredClone(project);
  const split = splitRoughCut(project, "rough-cut-1", 300);
  assert.deepEqual(
    split.map(({ inFrame, outFrame, name, enabled }) => ({ inFrame, outFrame, name, enabled })),
    [
      { inFrame: 150, outFrame: 300, name: "待定片段", enabled: false },
      { inFrame: 300, outFrame: 450, name: "待定片段", enabled: false },
    ],
  );
  assert.equal(split[0]?.id, "rough-cut-1");
  assert.notEqual(split[1]?.id, split[0]?.id);
  for (const atFrame of [149, 150, 450, 451, 299.5]) {
    assert.throws(() => splitRoughCut(project, "rough-cut-1", atFrame));
  }
  assert.throws(() => splitRoughCut(project, "unknown", 300));
  assert.deepEqual(project, before);
});

test("create, split and inversion cannot exceed the project-wide marker budget", () => {
  const project = fixture();
  project.roughCuts = Array.from({ length: 1000 }, (_, index) =>
    cut(`cut-${index}`, 0, 30, { assetId: "video-b" }),
  );
  const before = structuredClone(project);
  assert.throws(() => createRoughCut(project, "video-a", 30, 60), /1000/);
  assert.throws(() => splitRoughCut(project, "cut-0", 15), /1000/);
  assert.throws(() => invertRoughCuts(project, "video-a"), /1000/);
  assert.deepEqual(project, before);
});

test("LosslessCut CSV exports enabled ranges in seconds with escaped names and no header or foreign media", () => {
  const project = fixture();
  project.roughCuts = [
    cut("late", 300, 450, { name: "晚的在前" }),
    cut("hidden", 90, 120, { name: "不导出", enabled: false }),
    cut("early", 1, 31, { name: '开场, "重点"\n第二行' }),
    cut("foreign", 0, 60, { assetId: "video-b", name: "另一素材" }),
  ];
  const before = structuredClone(project);
  const csv = exportRoughCutsCsv(project, "video-a");
  assert.equal(csv, '"10","15","晚的在前"\r\n"0.033333","1.033333","开场, ""重点""\n第二行"\r\n');
  assert.equal(exportRoughCutsCsv(project, "audio-a"), "");
  assert.deepEqual(project, before);
});

test("identical names and source ranges remain distinct editable markers", () => {
  const project = fixture();
  project.roughCuts = [
    cut("same-a", 30, 60, { name: "同名" }),
    cut("same-b", 30, 60, { name: "同名" }),
  ];
  assert.equal(exportRoughCutsCsv(project, "video-a"), '"1","2","同名"\r\n"1","2","同名"\r\n');
});

test("media metadata publication preserves markers and incompatible source replacement fails without losing the saved edit", () => {
  const project = fixture();
  project.roughCuts = [cut("source-tail", 1500, 1800)];
  const original = structuredClone(project);
  const source = project.assets.find((asset) => asset.id === "video-a")!;
  const prepared = publishProductionAssets(project, [{ ...source, width: 1920, height: 1080 }]);
  assert.deepEqual(prepared.project!.roughCuts, project.roughCuts);
  assert.deepEqual(prepared.project!.clips, project.clips);
  assert.throws(
    () => publishProductionAssets(project, [{ ...source, durationFrames: 1700 }]),
    /粗剪范围/,
  );
  assert.throws(
    () =>
      validateProject({
        ...project,
        assets: project.assets.filter((asset) => asset.id !== source.id),
      }),
    /粗剪/,
  );
  assert.throws(() => publishProductionAssets(project, [{ ...source, kind: "image" }]), /粗剪/);
  assert.deepEqual(project, original);
});

