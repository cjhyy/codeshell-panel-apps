import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOperations,
  createDemoProject,
  validateProject,
  type EditOperation,
  type Project,
} from "../apps/video-studio/src/model.ts";
import {
  renderWorkflowSummary,
  validateVideoWorkflow,
  type VideoWorkflow,
} from "../apps/video-studio/src/workflow.ts";

function fixture(): Project {
  const project = createDemoProject();
  project.assets.push({ id: "voice-1", kind: "audio", name: "我的口播", durationFrames: 300 });
  project.audioClips = [
    { id: "speech-1", assetId: "voice-1", startFrame: 60, inFrame: 30, outFrame: 210, volume: 0.8 },
  ];
  project.script = "原始口播文稿。";
  return validateProject(project);
}

function workflow(): VideoWorkflow {
  return {
    stage: "initialized",
    brief: "把已经拍好的素材剪成一分钟的工作记录。",
    outline: "先给出结果，再展示过程，最后补充下一步。",
    sources: [
      {
        assetId: "demo-intro",
        role: "main",
        note: "开头介绍；需要试听原声。",
        inFrame: 30,
        outFrame: 120,
      },
      { assetId: "demo-city", role: "broll", note: "作为过程画面；尚未选片。" },
      { assetId: "voice-1", role: "voice", note: "保持本人声音。", inFrame: 30, outFrame: 210 },
    ],
    nextSteps: ["转写口播并标记可用段落。", "把选片按叙事顺序排列，再检查实际声音。"],
    blockers: ["结尾素材是否够用，仍需检查。"],
  };
}

test("workflow round trips as detached optional project metadata without changing legacy JSON", () => {
  const legacy = fixture();
  assert.equal(Object.hasOwn(validateProject(legacy), "workflow"), false);
  assert.equal(JSON.stringify(validateProject(legacy)), JSON.stringify(legacy));
  const input = workflow();
  const project = validateProject({ ...legacy, workflow: input });
  assert.deepEqual(project.workflow, input);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  project.workflow!.sources[0]!.note = "单独修改副本。";
  project.workflow!.nextSteps.push("重新审阅。");
  project.workflow!.blockers[0] = "另一条缺项。";
  assert.equal(input.sources[0]!.note, "开头介绍；需要试听原声。");
  assert.equal(input.nextSteps.length, 2);
  assert.equal(input.blockers[0], "结尾素材是否够用，仍需检查。");
});

test("workflow operations use the normal revision and undo snapshot without changing edits or media", () => {
  const before = fixture(),
    snapshot = structuredClone(before),
    plan = workflow();
  const after = applyOperations(before, [{ type: "workflow", workflow: plan }], before.revision);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.workflow, plan);
  for (const key of ["assets", "clips", "audioClips", "captions", "script"] as const) {
    assert.deepEqual(after[key], before[key]);
  }
  assert.deepEqual(before, snapshot);
  plan.sources[0]!.inFrame = 0;
  assert.equal(after.workflow!.sources[0]!.inFrame, 30);
  // The existing project history keeps a full validated snapshot; no new undo store is needed.
  const restored = validateProject(snapshot);
  assert.deepEqual(restored, before);
  assert.equal(Object.hasOwn(restored, "workflow"), false);
  const updated = applyOperations(
    after,
    [{ type: "workflow", workflow: { ...workflow(), stage: "selects" } }],
    after.revision,
  );
  assert.equal(updated.workflow!.stage, "selects");
  assert.deepEqual(validateProject(structuredClone(after)).workflow, workflow());
});

test("foreign sources and stale revisions reject a whole patch atomically", () => {
  const project = fixture(),
    snapshot = JSON.stringify(project);
  const foreign = workflow();
  foreign.sources[0]!.assetId = "other-project-asset";
  assert.throws(
    () =>
      applyOperations(
        project,
        [
          { type: "volume", clipId: "clip-1", volume: 0 },
          { type: "workflow", workflow: foreign },
        ],
        project.revision,
      ),
    /不属于当前工程/,
  );
  assert.throws(
    () =>
      applyOperations(project, [{ type: "workflow", workflow: workflow() }], project.revision + 1),
    /工程已更新/,
  );
  assert.equal(JSON.stringify(project), snapshot);
});

test("source ranges are optional pairs of bounded half-open integer source frames", () => {
  const project = fixture();
  const invalidRanges = [
    { inFrame: 0 },
    { outFrame: 30 },
    { inFrame: 0, outFrame: undefined },
    { inFrame: undefined, outFrame: undefined },
    { inFrame: null, outFrame: 30 },
    { inFrame: -1, outFrame: 30 },
    { inFrame: 0.5, outFrame: 30 },
    { inFrame: 0, outFrame: 30.5 },
    { inFrame: 30, outFrame: 30 },
    { inFrame: 31, outFrame: 30 },
    { inFrame: 0, outFrame: 181 },
    { inFrame: 0, outFrame: Infinity },
    { inFrame: NaN, outFrame: 30 },
  ];
  for (const range of invalidRanges) {
    const plan = {
      ...workflow(),
      sources: [{ assetId: "demo-intro", role: "main", note: "选片说明", ...range }],
    };
    assert.throws(() => validateProject({ ...project, workflow: plan }));
    assert.throws(() =>
      applyOperations(
        project,
        [
          { type: "settings", name: "不应保存" },
          { type: "workflow", workflow: plan } as EditOperation,
        ],
        project.revision,
      ),
    );
  }
  assert.equal(project.name, "从想法，到成片。");
  assert.equal(project.revision, 0);
  const allowed = validateVideoWorkflow(
    {
      ...workflow(),
      sources: [
        { assetId: "demo-intro", role: "main", note: "完整源范围", inFrame: 0, outFrame: 180 },
        { assetId: "demo-intro", role: "hold", note: "同一素材可记录不同用途或候选段落。" },
      ],
    },
    project.assets,
  );
  assert.equal(allowed.sources[0]!.outFrame, 180);
  assert.equal(Object.hasOwn(allowed.sources[1]!, "inFrame"), false);
});

test("workflow schema rejects injected fields, oversized lists and malformed text atomically", () => {
  const project = fixture(),
    snapshot = JSON.stringify(project);
  const invalid = [
    null,
    [],
    new Date(),
    { ...workflow(), command: "execute" },
    JSON.parse(JSON.stringify(workflow()).replace('"stage":', '"__proto__":{},"stage":')),
    { ...workflow(), stage: "complete" },
    { ...workflow(), stage: "constructor" },
    { ...workflow(), brief: " " },
    { ...workflow(), brief: "a".repeat(2001) },
    { ...workflow(), outline: "a".repeat(4001) },
    { ...workflow(), outline: "bad\u0000text" },
    { ...workflow(), sources: Array(1) },
    { ...workflow(), sources: Array(101).fill(workflow().sources[0]) },
    { ...workflow(), sources: [{ ...workflow().sources[0], role: "constructor" }] },
    { ...workflow(), sources: [{ ...workflow().sources[0], note: "a".repeat(801) }] },
    { ...workflow(), sources: [{ ...workflow().sources[0], path: "/private/source.mp4" }] },
    { ...workflow(), nextSteps: [] },
    { ...workflow(), nextSteps: [""] },
    { ...workflow(), nextSteps: ["a".repeat(501)] },
    { ...workflow(), nextSteps: Array(13).fill("下一步") },
    { ...workflow(), blockers: null },
    { ...workflow(), blockers: [false] },
    { ...workflow(), blockers: Array(13).fill("缺项") },
  ];
  for (const plan of invalid) {
    assert.throws(() => validateProject({ ...project, workflow: plan }));
    assert.throws(() =>
      applyOperations(
        project,
        [
          { type: "settings", name: "不应保存" },
          { type: "workflow", workflow: plan } as EditOperation,
        ],
        project.revision,
      ),
    );
    assert.equal(JSON.stringify(project), snapshot);
  }
  assert.throws(
    () =>
      applyOperations(
        project,
        [{ type: "workflow", workflow: workflow(), command: "execute" } as EditOperation],
        project.revision,
      ),
    /未知字段/,
  );
  const bounds = validateVideoWorkflow(
    {
      ...workflow(),
      brief: "a".repeat(2000),
      outline: "a".repeat(4000),
      sources: Array.from({ length: 100 }, () => ({
        assetId: "demo-intro",
        role: "hold",
        note: "a".repeat(800),
      })),
      nextSteps: Array(12).fill("a".repeat(500)),
      blockers: Array(12).fill("a".repeat(500)),
    },
    project.assets,
  );
  assert.equal(bounds.sources.length, 100);
});

test("summary renders source selections and escapes all notes and names as read-only text", () => {
  const project = fixture();
  project.assets[0]!.name = '<img src=x onerror="alert(1)">';
  const plan = workflow();
  plan.brief = "<script>alert('brief')</script>";
  plan.outline = "第一行\n<a href='javascript:alert(1)'>第二行</a>";
  plan.sources[0]!.note = "<button onclick='run()'>运行命令</button> & 原片";
  plan.nextSteps = ['<iframe src="/private"></iframe>'];
  plan.blockers = ["<svg onload='bad()'>缺项</svg>"];
  const html = renderWorkflowSummary(validateVideoWorkflow(plan, project.assets), project.assets);
  for (const tag of ["<script", "<img", "<a ", "<button", "<iframe", "<svg", "<input", "<form"]) {
    assert.equal(html.includes(tag), false);
  }
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&#39;brief&#39;\)&lt;\/script&gt;/);
  assert.match(html, /&amp; 原片/);
  assert.match(html, /第一行<br>&lt;a/);
  assert.match(html, /源范围 \[00:00:01:00, 00:00:04:00\) · 30 fps/);
  assert.match(html, /尚未选定源范围/);
  assert.match(html, /以实际结果为准/);
  assert.match(renderWorkflowSummary(plan), /demo-intro/);
});

test("empty plan and review stage do not present planning metadata as completed production", () => {
  assert.match(renderWorkflowSummary(), /尚未建立/);
  const plan = { ...workflow(), stage: "review" as const, sources: [], blockers: [] };
  const html = renderWorkflowSummary(plan);
  assert.match(html, /成片审阅/);
  assert.match(html, /尚未分配素材用途/);
  assert.match(html, /仍需实际检查成片/);
  assert.equal(html.includes("已完成"), false);
  assert.equal(html.includes("已导出"), false);
});
