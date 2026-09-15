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

const maxTurnsError = "agent.task.start maxTurns must be an integer from 1 to 20";

function promptedAssetIds(start: Record<string, unknown>): string[] {
  return JSON.parse(String(start.prompt).split("本批素材数据：")[1]!).map(
    (asset: { id: string }) => asset.id,
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function delayedLaunchFixture(
  options: { failFirstCancel?: boolean; rejectFirstLaunch?: boolean } = {},
) {
  const project = fixture(2).project();
  const startSeen = deferred(),
    deliverStart = deferred(),
    cancelSeen = deferred(),
    stopped = deferred();
  const tasks: (PanelTask & { key: string })[] = [];
  const starts: Record<string, unknown>[] = [];
  const cancelled: string[] = [];
  const controller = new RoughCutAIController(
    {
      call: async (method: string, args: Record<string, unknown>) => {
        if (method === "agent.task.start") {
          assert.equal(args.maxTurns, 20);
          starts.push(args);
          if (options.rejectFirstLaunch && starts.length === 1) {
            startSeen.resolve();
            await deliverStart.promise;
            throw new Error("AI 任务暂时不可用");
          }
          // Match Host ownership: a task exists before its start response arrives,
          // and another request with the same active key receives that same task.
          let task = tasks.find(
            (item) =>
              item.key === args.key && ["queued", "running", "cancelling"].includes(item.status),
          );
          if (!task) {
            task = { id: `delayed-${tasks.length}`, key: String(args.key), status: "running" };
            tasks.push(task);
          }
          if (starts.length === 1) {
            startSeen.resolve();
            await deliverStart.promise;
          }
          return structuredClone(task);
        }
        const task = tasks.find((item) => item.id === args.id);
        assert.ok(task);
        if (method === "agent.task.cancel") {
          cancelled.push(task.id);
          task.status = "cancelling";
          cancelSeen.resolve();
          if (options.failFirstCancel && cancelled.length === 1)
            throw new Error("取消确认暂时中断");
          return structuredClone(task);
        }
        if (method === "agent.task.get") {
          if (task.status === "cancelling") {
            await stopped.promise;
            task.status = "cancelled";
          }
          return structuredClone(task);
        }
        throw new Error(`Unexpected ${method}`);
      },
    } as PanelBridge,
    { project: () => project, assertReady() {}, changed() {} },
  );
  return {
    controller,
    project,
    tasks,
    starts,
    cancelled,
    startSeen,
    deliverStart,
    cancelSeen,
    stopped,
  };
}

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
    startAttempts: Record<string, unknown>[] = [],
    cancelled: string[] = [];
  let rejectStart = false,
    failPrepare = false,
    preparations = 0;
  let legacyMaxTurns: number | undefined;
  const snapshots: (RoughCutAISnapshot | null)[] = [];
  const bridge = {
    call: async (method: string, value: unknown) => {
      const args = value as Record<string, unknown>;
      if (method === "agent.task.start") {
        // Reproduce the old request only when explicitly requested by a recovery
        // test. Every normal controller request faces the actual Host constraint.
        const submitted =
          legacyMaxTurns === undefined ? args : { ...args, maxTurns: legacyMaxTurns };
        startAttempts.push(structuredClone(submitted));
        const maxTurns = submitted.maxTurns === undefined ? 8 : Number(submitted.maxTurns);
        if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 20)
          throw new Error(maxTurnsError);
        if (rejectStart) throw new Error("连接暂时中断");
        starts.push(submitted);
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
    startAttempts,
    cancelled,
    snapshots,
    rejectStart: (value: boolean) => {
      rejectStart = value;
    },
    legacyMaxTurns: (value: number | undefined) => {
      legacyMaxTurns = value;
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

test("a persisted 0/4 Host parameter failure retries with compliant turns and processes both batches", async () => {
  const failed = fixture(4);
  const ids = failed.project().assets.map((asset) => asset.id);
  failed.legacyMaxTurns(32);
  await failed.controller.start(ids);
  assert.equal(failed.controller.state.phase, "failed");
  assert.equal(failed.controller.state.completed, 0);
  assert.ok(failed.controller.state.message.includes(maxTurnsError));
  assert.match(failed.controller.state.message, /已完成 0\/4 份/);
  assert.equal(
    failed.starts.length,
    0,
    "The Host rejects an invalid request before creating a task",
  );
  assert.equal(failed.startAttempts[0]!.maxTurns, 32);
  // The failed launch leaves its pre-launch queue checkpoint in actual storage.
  const checkpoint = failed.snapshots.at(-1)!;
  assert.equal(checkpoint!.state.phase, "preparing");
  assert.equal(checkpoint!.state.completed, 0);
  assert.deepEqual(checkpoint!.state.assetIds, ids);
  assert.equal(checkpoint!.state.task, null);
  const restored = fixture(4);
  restored.replace(failed.project());
  assert.equal(await restored.controller.restore(checkpoint), true);
  assert.match(restored.controller.state.message, /已恢复 0\/4/);
  assert.equal(restored.starts.length, 0, "Restoration does not start or bill a new task");
  assert.deepEqual(restored.cancelled, []);
  await restored.controller.retry();
  assert.equal(restored.controller.state.phase, "running");
  assert.deepEqual(promptedAssetIds(restored.starts[0]!), ids.slice(0, 3));
  restored.observe(ids.slice(0, 3));
  restored.controller.accept(restored.proposal(ids.slice(0, 3)));
  await restored.controller.handleTask({ ...restored.tasks[0]!, status: "completed" });
  assert.equal(restored.controller.state.completed, 3);
  assert.deepEqual(promptedAssetIds(restored.starts[1]!), ids.slice(3));
  restored.observe(ids.slice(3));
  restored.controller.accept(restored.proposal(ids.slice(3)));
  await restored.controller.handleTask({ ...restored.tasks[1]!, status: "completed" });
  assert.deepEqual(
    restored.startAttempts.map((args) => args.maxTurns),
    [20, 20],
  );
  assert.deepEqual(
    restored.starts.flatMap(promptedAssetIds),
    ids,
    "Retry analyzes each original source exactly once, including the final partial batch",
  );
  assert.equal(restored.controller.state.phase, "review");
  assert.equal(restored.controller.state.completed, 4);
  assert.equal(restored.controller.state.cuts.length, 4);
  assert.equal(restored.project().roughCuts?.length ?? 0, 0);
  assert.equal(restored.project().clips.length, 0);
});

test("AI processes every selected asset across batches, preserves previous drafts on restored retry and saves only reviewed choices", async () => {
  const initial = fixture(7);
  let f = initial;
  const ids = f.project().assets.map((asset) => asset.id);
  await f.controller.start(ids);
  f.observe(ids.slice(0, 3));
  f.controller.accept(f.proposal(ids.slice(0, 3)));
  // The next request is rejected like the older Panel, after a complete first batch.
  f.legacyMaxTurns(32);
  await f.controller.handleTask({ ...f.tasks[0]!, status: "completed" });
  assert.equal(f.controller.state.completed, 3);
  assert.equal(f.starts.length, 1);
  assert.deepEqual(promptedAssetIds(f.startAttempts[1]!), ids.slice(3, 6));
  assert.equal(f.controller.state.phase, "failed");
  assert.equal(f.controller.state.cuts.length, 3);
  assert.match(f.controller.state.message, /已完成 3\/7 份/);
  const completedCuts = f.controller.state.cuts;
  const checkpoint = f.snapshots.at(-1)!;
  f = fixture(7);
  f.replace(initial.project());
  assert.equal(await f.controller.restore(checkpoint), true);
  assert.equal(f.starts.length, 0);
  assert.equal(f.controller.state.completed, 3);
  assert.deepEqual(f.controller.state.cuts, completedCuts);
  await f.controller.retry();
  assert.throws(() => f.controller.accept(f.proposal(["source-0"])), /本批未选择/);
  assert.throws(() => f.controller.accept(f.proposal(ids.slice(3, 6))), /关键帧/);
  f.observe(ids.slice(3, 6));
  f.controller.accept(f.proposal(ids.slice(3, 6)));
  await f.controller.handleTask({ ...f.tasks[0]!, status: "completed" });
  assert.equal(f.controller.state.completed, 6);
  f.observe(ids.slice(6));
  f.controller.accept(f.proposal(ids.slice(6)));
  await f.controller.handleTask({ ...f.tasks[1]!, status: "completed" });
  assert.equal(f.controller.state.completed, 7);
  assert.equal(f.controller.state.cuts.length, 7);
  assert.deepEqual(f.controller.state.cuts.slice(0, 3), completedCuts);
  assert.deepEqual(
    [...initial.starts, ...f.starts].flatMap(promptedAssetIds),
    ids,
    "Completed sources are not restarted and every remaining source is processed",
  );
  assert.deepEqual(
    f.startAttempts.map((args) => args.maxTurns),
    [20, 20],
  );
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
  assert.equal(f.project().roughCuts!.length, 5);
  assert.equal(f.project().roughCuts![0]!.id, "manual");
  assert.equal(f.project().clips.length, 0);
  assert.equal(f.controller.state.cuts.length, 3);
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

test("cancel waits for a delayed start response and confirmed stop before the same Host task key can be reused", async () => {
  const f = delayedLaunchFixture();
  const before = structuredClone(f.project);
  const starting = f.controller.start(["source-0"]);
  await f.startSeen.promise;
  assert.equal(f.tasks.length, 1, "The Host already owns a task whose response is delayed");
  assert.equal(f.controller.state.task, null);
  let cancellationFinished = false;
  const cancelling = f.controller.cancel().then(() => {
    cancellationFinished = true;
  });
  const duplicateCancellation = f.controller.cancel();
  assert.equal(f.controller.state.starting, true);
  await assert.rejects(() => f.controller.start(["source-1"]), /启动或停止完成/);
  await assert.rejects(() => f.controller.retry(), /启动或停止完成/);
  await assert.rejects(() => f.controller.discard(), /确认任务停止/);
  await assert.rejects(() => f.controller.restore(f.controller.snapshot()), /等待任务停止/);
  assert.equal(f.starts.length, 1);
  assert.equal(cancellationFinished, false);
  f.deliverStart.resolve();
  await f.cancelSeen.promise;
  await starting;
  assert.equal(f.controller.state.starting, true);
  assert.equal(cancellationFinished, false, "An acknowledged cancel still needs terminal status");
  await assert.rejects(() => f.controller.retry(), /启动或停止完成/);
  await assert.rejects(() => f.controller.discard(), /确认任务停止/);
  f.stopped.resolve();
  await Promise.all([cancelling, duplicateCancellation]);
  assert.equal(f.controller.state.starting, false);
  assert.equal(f.controller.state.task?.status, "cancelled");
  assert.deepEqual(f.cancelled, ["delayed-0"], "Repeated cancellation shares one owned stop");
  await f.controller.discard();
  await f.controller.start(["source-1"]);
  assert.deepEqual(f.starts.map(promptedAssetIds), [["source-0"], ["source-1"]]);
  assert.equal(f.tasks.length, 2, "The new request receives a fresh task after key release");
  assert.equal(f.controller.state.task?.id, "delayed-1");
  assert.equal(f.tasks[1]!.status, "running");
  assert.deepEqual(f.cancelled, ["delayed-0"], "A stale start cannot cancel the new task");
  assert.deepEqual(f.project, before);
});

test("a failed cancellation of a late start retains its task until retry confirms it stopped", async () => {
  const f = delayedLaunchFixture({ failFirstCancel: true });
  const starting = f.controller.start(["source-0"]);
  await f.startSeen.promise;
  const cancelling = f.controller.cancel();
  const rejected = assert.rejects(cancelling, /取消确认暂时中断/);
  f.deliverStart.resolve();
  await Promise.all([starting, rejected]);
  assert.equal(f.controller.state.starting, false);
  assert.equal(f.controller.state.task?.id, "delayed-0");
  await assert.rejects(() => f.controller.start(["source-1"]), /尚未确认停止/);
  await assert.rejects(() => f.controller.discard(), /确认任务停止/);
  assert.equal(f.starts.length, 1);
  const retrying = f.controller.retry();
  assert.equal(f.controller.state.starting, true);
  await assert.rejects(() => f.controller.discard(), /确认任务停止/);
  f.stopped.resolve();
  await retrying;
  assert.deepEqual(f.cancelled, ["delayed-0", "delayed-0"]);
  assert.deepEqual(f.starts.map(promptedAssetIds), [["source-0"], ["source-0"]]);
  assert.equal(f.controller.state.task?.id, "delayed-1");
  assert.equal(f.tasks[1]!.status, "running");
  assert.equal(f.project.clips.length, 0);
});

test("cancelling a launch that is rejected waits for the response without inventing a task to stop", async () => {
  const f = delayedLaunchFixture({ rejectFirstLaunch: true });
  const starting = f.controller.start(["source-0"]);
  await f.startSeen.promise;
  const cancelling = f.controller.cancel();
  assert.equal(f.controller.state.starting, true);
  await assert.rejects(() => f.controller.start(["source-1"]), /启动或停止完成/);
  await assert.rejects(() => f.controller.discard(), /确认任务停止/);
  f.deliverStart.resolve();
  await Promise.all([starting, cancelling]);
  assert.equal(f.controller.state.starting, false);
  assert.equal(f.controller.state.task, null);
  assert.deepEqual(f.cancelled, []);
  assert.equal(f.tasks.length, 0);
  await f.controller.discard();
  await f.controller.start(["source-1"]);
  assert.equal(f.tasks.length, 1);
  assert.equal(f.controller.state.phase, "running");
  assert.deepEqual(f.controller.state.assetIds, ["source-1"]);
});

test("reset retains ownership of a delayed launch until cancellation reaches a terminal state", async () => {
  const f = delayedLaunchFixture();
  const starting = f.controller.start(["source-0"]);
  await f.startSeen.promise;
  let resetFinished = false;
  const resetting = f.controller.reset().then(() => {
    resetFinished = true;
  });
  assert.equal(f.controller.state.starting, true);
  assert.deepEqual(f.controller.state.assetIds, ["source-0"]);
  await assert.rejects(() => f.controller.start(["source-1"]), /启动或停止完成/);
  f.deliverStart.resolve();
  await f.cancelSeen.promise;
  await starting;
  assert.equal(resetFinished, false);
  assert.equal(f.controller.state.starting, true);
  f.stopped.resolve();
  await resetting;
  assert.equal(f.controller.state.phase, "idle");
  assert.equal(f.controller.state.task, null);
  assert.deepEqual(f.controller.state.assetIds, []);
  assert.deepEqual(f.cancelled, ["delayed-0"]);
  assert.equal(f.tasks[0]!.status, "cancelled");
  await f.controller.start(["source-1"]);
  assert.equal(f.controller.state.task?.id, "delayed-1");
  assert.equal(f.tasks[1]!.status, "running");
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
  const f = fixture(4);
  const ids = f.project().assets.map((asset) => asset.id);
  await f.controller.start(ids);
  f.observe(ids.slice(0, 3));
  f.controller.accept(f.proposal(ids.slice(0, 3)));
  await f.controller.handleTask({ ...f.tasks[0]!, status: "completed" });
  const snapshot = f.snapshots.at(-1)!;
  assert.equal(snapshot!.state.completed, 3);
  assert.equal(snapshot!.state.task!.id, "task-1");
  assert.equal(snapshot!.state.cuts.length, 3);
  const restored = fixture(4);
  restored.replace(f.project());
  assert.equal(await restored.controller.restore(snapshot), true);
  assert.deepEqual(restored.cancelled, ["task-1"]);
  assert.equal(restored.controller.state.phase, "cancelled");
  assert.equal(restored.controller.state.cuts.length, 3);
  assert.equal(restored.controller.requestToken, "");
  await restored.controller.retry();
  assert.throws(() => restored.controller.accept(restored.proposal(["source-3"])), /关键帧/);
  restored.observe(["source-3"]);
  restored.controller.accept(restored.proposal(["source-3"]));
  await restored.controller.handleTask({ ...restored.tasks[0]!, status: "completed" });
  const selected = restored.controller.state.cuts.map((cut) => cut.id);
  restored.apply(restored.controller.reviewOperations(selected));
  // A project save can survive while the following draft checkpoint is interrupted.
  // Restore reconciles identical candidate IDs against the already committed project.
  const savedProject = restored.project();
  const recovery = fixture(4);
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
