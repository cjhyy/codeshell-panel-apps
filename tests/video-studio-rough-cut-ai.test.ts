import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateToolArgsStrict } from "@cjhyy/code-shell-core";
import {
  createProject,
  validateProject,
  applyOperations,
  type Project,
} from "../apps/video-studio/src/model";
import {
  RoughCutAIController,
  buildRoughCutPrompt,
  type RoughCutAISnapshot,
} from "../apps/video-studio/src/rough-cut-ai";
import type { PanelBridge, PanelTask } from "../apps/video-studio/src/host";

function fixture(count = 2, audio = false) {
  let project = validateProject({
    ...createProject(),
    assets: Array.from({ length: count }, (_, i) => ({
      id: `source-${i}`,
      name: `原片 ${i}`,
      kind: audio ? "audio" : "video",
      durationFrames: 900,
      mediaId: `external-${String(i).padStart(64, "a")}`,
    })),
  });
  const tasks: PanelTask[] = [],
    starts: Record<string, unknown>[] = [],
    cancelled: string[] = [];
  let rejectStart = false,
    failPrepare = false,
    preparations = 0;
  const snapshots: (RoughCutAISnapshot | null)[] = [];
  const bridge = {
    call: async (method: string, value: unknown) => {
      const args = value as Record<string, unknown>;
      if (method === "agent.task.start") {
        if (rejectStart) throw new Error("连接暂时中断");
        starts.push(args);
        const task: PanelTask = { id: `task-${tasks.length}`, status: "running" };
        tasks.push(task);
        return task;
      }
      if (method === "agent.task.get") return tasks.find((task) => task.id === args.id);
      if (method === "agent.task.cancel") {
        cancelled.push(String(args.id));
        return { id: args.id, status: "cancelled" };
      }
      throw new Error(`Unexpected ${method}`);
    },
  } as PanelBridge;
  const controller = new RoughCutAIController(bridge, {
    project: () => project,
    assertReady() {},
    changed() {},
    persist: async (snapshot) => {
      snapshots.push(structuredClone(snapshot));
    },
    prepareAudio: async (_ids, signal) => {
      preparations++;
      assert.equal(signal.aborted, false);
      if (failPrepare) throw new Error("尚未配置 Whisper");
    },
  });
  const observe = (ids: string[]) => {
    for (const id of ids) {
      for (const seconds of [1.5, 15, 28.5])
        controller.recordFrame(controller.requestToken, id, seconds);
      controller.recordTranscript(controller.requestToken, id, {
        segments: [{ start: 14, end: 18, text: "真实录音内容" }],
      });
    }
  };
  const proposal = (ids: string[]) => ({
    projectId: project.id,
    requestToken: controller.requestToken,
    baseRevision: project.revision,
    title: "重点镜头",
    explanation: "根据实际关键帧初筛；动作边界仍需预览确认。",
    operations: [
      {
        type: "rough-cuts",
        cuts: ids.map((id) => ({
          id: `candidate-${id}`,
          assetId: id,
          inFrame: 420,
          outFrame: 570,
          name: "画面主体",
          enabled: true,
        })),
      },
    ],
  });
  return {
    controller,
    project: () => project,
    replace: (next: Project) => {
      project = next;
    },
    apply: (ops: ReturnType<RoughCutAIController["reviewOperations"]>) => {
      project = applyOperations(project, ops, project.revision);
    },
    observe,
    proposal,
    tasks,
    starts,
    cancelled,
    snapshots,
    rejectStart: (value: boolean) => {
      rejectStart = value;
    },
    failPrepare: (value: boolean) => {
      failPrepare = value;
    },
    preparations: () => preparations,
  };
}

test("AI rejects unseen sources, shallow single-frame evidence, off-range picks and non-rough-cut edits", async () => {
  const f = fixture();
  await f.controller.start(["source-0", "source-1"]);
  assert.throws(() => f.controller.accept(f.proposal(["source-0"])), /关键帧/);
  f.controller.recordFrame(f.controller.requestToken, "source-0", 15);
  assert.throws(() => f.controller.accept(f.proposal(["source-0"])), /关键帧/);
  f.observe(["source-0"]);
  assert.throws(() => f.controller.accept(f.proposal(["source-0"])), /原片 1/);
  f.observe(["source-1"]);
  const offRange = f.proposal(["source-0"]);
  offRange.operations[0]!.cuts[0]!.inFrame = 210;
  offRange.operations[0]!.cuts[0]!.outFrame = 240;
  assert.throws(() => f.controller.accept(offRange), /候选保留段内/);
  assert.throws(
    () =>
      f.controller.accept({
        ...f.proposal([]),
        operations: [{ type: "remove", clipId: "existing" }],
      }),
    /只接受/,
  );
  const old = { ...f.proposal(["source-0"]), requestToken: "expired" };
  assert.throws(() => f.controller.accept(old), /过期/);
  f.controller.accept(f.proposal(["source-0", "source-1"]));
  assert.equal(f.project().roughCuts?.length ?? 0, 0);
  await f.controller.handleTask({ ...f.tasks[0]!, status: "completed" });
  assert.equal(f.controller.state.phase, "review");
  assert.equal(f.controller.state.cuts.length, 2);
  assert.equal(f.project().clips.length, 0);
});

test("AI processes every selected asset across batches, preserves previous drafts on retry and saves only reviewed choices", async () => {
  const f = fixture(14);
  const ids = f.project().assets.map((asset) => asset.id);
  await f.controller.start(ids);
  f.observe(ids.slice(0, 6));
  f.controller.accept(f.proposal(ids.slice(0, 6)));
  await f.controller.handleTask({ ...f.tasks[0]!, status: "completed" });
  assert.equal(f.controller.state.completed, 6);
  assert.equal(f.starts.length, 2);
  assert.throws(() => f.controller.accept(f.proposal(["source-0"])), /本批未选择/);
  await f.controller.handleTask({ ...f.tasks[1]!, status: "failed", error: "模型暂时不可用" });
  assert.equal(f.controller.state.phase, "failed");
  assert.equal(f.controller.state.cuts.length, 6);
  await f.controller.retry();
  f.observe(ids.slice(6, 12));
  f.controller.accept(f.proposal(ids.slice(6, 12)));
  await f.controller.handleTask({ ...f.tasks[2]!, status: "completed" });
  assert.equal(f.controller.state.completed, 12);
  f.observe(ids.slice(12));
  f.controller.accept(f.proposal(ids.slice(12)));
  await f.controller.handleTask({ ...f.tasks[3]!, status: "completed" });
  assert.equal(f.controller.state.completed, 14);
  assert.equal(f.controller.state.cuts.length, 14);
  const selection = f.controller.state.cuts.filter((_, i) => i % 2 === 0).map((cut) => cut.id);
  const project = f.project();
  f.replace(
    applyOperations(
      project,
      [
        {
          type: "rough-cuts",
          cuts: [
            {
              id: "manual",
              assetId: "source-0",
              inFrame: 0,
              outFrame: 30,
              name: "手动标记",
              enabled: true,
            },
          ],
        },
      ],
      project.revision,
    ),
  );
  f.apply(f.controller.reviewOperations(selection));
  await f.controller.didSave(selection);
  assert.equal(f.project().roughCuts!.length, 8);
  assert.equal(f.project().roughCuts![0]!.id, "manual");
  assert.equal(f.project().clips.length, 0);
  assert.equal(f.controller.state.cuts.length, 7);
});

test("cancel prevents late task results and read evidence from entering a restarted batch", async () => {
  const f = fixture(7);
  await f.controller.start(f.project().assets.map((asset) => asset.id));
  const token = f.controller.requestToken;
  const proposal = f.proposal(["source-0"]);
  await f.controller.cancel();
  assert.deepEqual(f.cancelled, ["task-0"]);
  assert.throws(() => f.controller.accept(proposal), /过期/);
  await f.controller.handleTask({
    ...f.tasks[0]!,
    status: "completed",
    result: { text: JSON.stringify(proposal) },
  });
  assert.equal(f.controller.state.completed, 0);
  await f.controller.retry();
  for (const asset of f.project().assets)
    for (const seconds of [1.5, 15, 28.5]) f.controller.recordFrame(token, asset.id, seconds);
  assert.throws(() => f.controller.accept(f.proposal(["source-0"])), /关键帧/);
  assert.equal(f.starts.length, 2);
});

test("audio preparation must succeed and selections require actual corresponding transcript ranges", async () => {
  const f = fixture(1, true);
  f.failPrepare(true);
  await f.controller.start(["source-0"]);
  assert.equal(f.starts.length, 0);
  assert.match(f.controller.state.message, /Whisper/);
  f.failPrepare(false);
  await f.controller.retry();
  assert.equal(f.preparations(), 2);
  assert.throws(() => f.controller.accept(f.proposal(["source-0"])), /真实转写/);
  f.controller.recordTranscript(f.controller.requestToken, "source-0", {
    segments: [{ start: 0, end: 1, text: "别处的句子" }],
  });
  assert.throws(() => f.controller.accept(f.proposal(["source-0"])), /对应的真实转写/);
  f.observe(["source-0"]);
  f.controller.accept(f.proposal(["source-0"]));
});

test("review refuses a replaced external source and a different project", async () => {
  const f = fixture(1);
  await f.controller.start(["source-0"]);
  f.observe(["source-0"]);
  f.controller.accept(f.proposal(["source-0"]));
  await f.controller.handleTask({ ...f.tasks[0]!, status: "completed" });
  const ids = f.controller.state.cuts.map((cut) => cut.id);
  const before = f.project();
  f.replace({
    ...before,
    assets: before.assets.map((asset) => ({ ...asset, durationFrames: 901 })),
  });
  assert.throws(() => f.controller.reviewOperations(ids), /素材或原片时长已改变/);
  f.replace({ ...before, id: "another-project" });
  assert.throws(() => f.controller.reviewOperations(ids), /工程已切换/);
});

test("JSON fallback still passes the same evidence gate and never edits a timeline", async () => {
  const f = fixture(1);
  await f.controller.start(["source-0"]);
  const result = JSON.stringify(f.proposal(["source-0"]));
  await f.controller.handleTask({ ...f.tasks[0]!, status: "completed", result: { text: result } });
  assert.equal(f.controller.state.phase, "failed");
  assert.equal(f.controller.state.cuts.length, 0);
  assert.equal(f.project().roughCuts?.length ?? 0, 0);
  assert.match(
    buildRoughCutPrompt("p", "t", f.project().assets, "剪出重点"),
    /静态关键帧只支持画面初筛/,
  );
});

test("persisted queue resumes after stopping the old task and retains reviewed drafts across a reload", async () => {
  const f = fixture(7);
  const ids = f.project().assets.map((asset) => asset.id);
  await f.controller.start(ids);
  f.observe(ids.slice(0, 6));
  f.controller.accept(f.proposal(ids.slice(0, 6)));
  await f.controller.handleTask({ ...f.tasks[0]!, status: "completed" });
  const snapshot = f.snapshots.at(-1)!;
  assert.equal(snapshot!.state.completed, 6);
  assert.equal(snapshot!.state.task!.id, "task-1");
  assert.equal(snapshot!.state.cuts.length, 6);
  const restored = fixture(7);
  restored.replace(f.project());
  assert.equal(await restored.controller.restore(snapshot), true);
  assert.deepEqual(restored.cancelled, ["task-1"]);
  assert.equal(restored.controller.state.phase, "cancelled");
  assert.equal(restored.controller.state.cuts.length, 6);
  assert.equal(restored.controller.requestToken, "");
  await restored.controller.retry();
  assert.throws(() => restored.controller.accept(restored.proposal(["source-6"])), /关键帧/);
  restored.observe(["source-6"]);
  restored.controller.accept(restored.proposal(["source-6"]));
  await restored.controller.handleTask({ ...restored.tasks[0]!, status: "completed" });
  const selected = restored.controller.state.cuts.map((cut) => cut.id);
  restored.apply(restored.controller.reviewOperations(selected));
  // A project save can survive while the following draft checkpoint is interrupted.
  // Restore reconciles identical candidate IDs against the already committed project.
  const savedProject = restored.project();
  const recovery = fixture(7);
  recovery.replace(savedProject);
  await recovery.controller.restore(restored.snapshots.at(-1));
  assert.equal(recovery.controller.state.cuts.length, 0);
  await recovery.controller.reset();
  assert.equal(recovery.controller.state.phase, "idle");
  assert.equal(recovery.controller.state.assetIds.length, 0);
});

test("snapshot validation rejects tampered ownership, invalid completion and foreign candidates", async () => {
  const f = fixture(1);
  await f.controller.start(["source-0"]);
  await f.controller.cancel();
  const snapshot = f.controller.snapshot();
  await assert.rejects(
    () => f.controller.restore({ ...snapshot, state: { ...snapshot.state, completed: 2 } }),
    /格式无效/,
  );
  await assert.rejects(
    () => f.controller.restore({ ...snapshot, sources: [["source-0", "different-media"]] }),
    /素材或原片/,
  );
  assert.equal(
    await f.controller.restore({ ...snapshot, state: { ...snapshot.state, projectId: "foreign" } }),
    false,
  );
});

test("the shipped Panel tool accepts rough-cut candidates through the real Host argument validator", async () => {
  const manifest = JSON.parse(
    readFileSync("apps/video-studio/.codeshell-panel/panel.json", "utf8"),
  );
  const schema = manifest.agent.tools.find(
    (tool: { name: string }) => tool.name === "propose_video_edit",
  ).inputSchema;
  const f = fixture(1);
  await f.controller.start(["source-0"]);
  const proposal = f.proposal(["source-0"]);
  assert.equal(validateToolArgsStrict("propose_video_edit", proposal, schema), null);
  const malformed = structuredClone(proposal);
  (malformed.operations[0]!.cuts[0]! as unknown as Record<string, unknown>).inFrame = 1.5;
  assert.match(validateToolArgsStrict("propose_video_edit", malformed, schema)!, /inFrame/);
  (malformed.operations[0]!.cuts[0]! as unknown as Record<string, unknown>).inFrame = 0;
  (malformed.operations[0]!.cuts[0]! as unknown as Record<string, unknown>).unexpected = true;
  assert.match(validateToolArgsStrict("propose_video_edit", malformed, schema)!, /unexpected/);
});

test("restoring an in-flight task waits for actual cancellation and rejects reentrant resume", async () => {
  const f = fixture(1);
  await f.controller.start(["source-0"]);
  const snapshot = f.controller.snapshot();
  const calls: string[] = [];
  let released = false;
  const controller = new RoughCutAIController(
    {
      call: async (method: string, args: { id?: string }) => {
        calls.push(method);
        if (method === "agent.task.cancel") return { id: args.id, status: "cancelling" };
        if (method === "agent.task.get")
          return { id: args.id, status: released ? "cancelled" : "cancelling" };
        throw new Error("Must not start a new task during restoration");
      },
    } as PanelBridge,
    { project: f.project, assertReady() {}, changed() {} },
  );
  const restoring = controller.restore(snapshot);
  assert.equal(controller.busy, true);
  await assert.rejects(() => controller.retry(), /没有可继续/);
  await assert.rejects(() => controller.start(["source-0"]), /正在进行/);
  released = true;
  await restoring;
  assert.deepEqual(calls, ["agent.task.cancel", "agent.task.get"]);
  assert.equal(controller.state.task!.status, "cancelled");
  assert.equal(controller.state.phase, "cancelled");
});
