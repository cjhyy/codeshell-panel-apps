import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyOperations,
  createProject,
  validateProject,
  type Project,
} from "../apps/video-studio/src/model";
import {
  createRoughCutUI,
  parseRoughCutTime,
  roughCutTimecode,
} from "../apps/video-studio/src/rough-cut-ui";
import {
  RoughCutAIController,
  type RoughCutAISnapshot,
} from "../apps/video-studio/src/rough-cut-ai";
import type { PanelBridge, PanelTask } from "../apps/video-studio/src/host";

function fixture() {
  let project = validateProject({
    ...createProject(),
    assets: [
      { id: "source-a", kind: "video", name: "原片 A.mp4", durationFrames: 900 },
      { id: "source-b", kind: "video", name: "原片 B.mp4", durationFrames: 600 },
      { id: "still", kind: "image", name: "静态照片", durationFrames: 90 },
    ],
  });
  let sourceId = "source-a",
    frame = 0;
  let changed = 0;
  let rejectEdits = false;
  const history: Project[] = [];
  const messages: string[] = [],
    downloads: { name: string; contents: string }[] = [];
  const plays: [number | undefined, number | undefined][] = [];
  const tasks: PanelTask[] = [];
  const startAttempts: Record<string, unknown>[] = [];
  const snapshots: (RoughCutAISnapshot | null)[] = [];
  let startError = "";
  const ai = new RoughCutAIController(
    {
      call: async (method: string, value: unknown) => {
        const args = value as Record<string, unknown>;
        if (method === "agent.task.start") {
          startAttempts.push(structuredClone(args));
          const maxTurns = args.maxTurns === undefined ? 8 : Number(args.maxTurns);
          if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 20)
            throw new Error("agent.task.start maxTurns must be an integer from 1 to 20");
          if (startError) throw new Error(startError);
          const task: PanelTask = { id: `rough-cut-${tasks.length}`, status: "running" };
          tasks.push(task);
          return task;
        }
        if (method === "agent.task.get") return tasks.find((task) => task.id === args.id);
        if (method === "agent.task.cancel") {
          const task = tasks.find((task) => task.id === args.id);
          if (task) task.status = "cancelled";
          return task;
        }
        throw new Error(`Unexpected rough-cut control bridge call: ${method}`);
      },
    } as PanelBridge,
    {
      project: () => project,
      assertReady() {},
      changed: () => {
        changed++;
      },
      persist: async (snapshot) => {
        snapshots.push(structuredClone(snapshot));
      },
    },
  );
  const ui = createRoughCutUI({
    ai,
    project: () => project,
    assetId: () => sourceId,
    frame: () => frame,
    playing: () => false,
    available: () => true,
    changed: () => {
      changed++;
    },
    edit: (ops) => {
      if (rejectEdits) throw new Error("请等待当前制作完成");
      history.push(structuredClone(project));
      project = applyOperations(project, ops, project.revision);
    },
    appendToTimeline: (ops) => {
      if (rejectEdits) throw new Error("请等待当前制作完成");
      history.push(structuredClone(project));
      project = applyOperations(project, ops, project.revision);
    },
    selectAsset: async (id) => {
      sourceId = id;
    },
    seek: async (next) => {
      frame = next;
    },
    play: async (start, end) => {
      plays.push([start, end]);
    },
    toast: (message) => {
      messages.push(message);
    },
    downloadCsv: (name, contents) => {
      downloads.push({ name, contents });
    },
  });
  const input = (field: string, value: string) =>
    ui.input({
      dataset: { roughcutField: field },
      value,
      setCustomValidity() {},
    } as unknown as HTMLInputElement);
  return {
    ui,
    input,
    ai,
    tasks,
    startAttempts,
    snapshots,
    rejectStart: (message: string) => {
      startError = message;
    },
    finishAI: async () => {
      const state = ai.state;
      const ids = state.assetIds.slice(state.completed, state.completed + 3);
      const assets = ids.map((id) => project.assets.find((asset) => asset.id === id)!);
      for (const asset of assets)
        for (const ratio of [0.05, 0.5, 0.95])
          ai.recordFrame(ai.requestToken, asset.id, (asset.durationFrames * ratio) / 30);
      ai.accept({
        projectId: project.id,
        requestToken: ai.requestToken,
        baseRevision: project.revision,
        title: "画面初筛",
        explanation: "基于已查看的关键帧生成候选，保留段需预览确认。",
        operations: [
          {
            type: "rough-cuts",
            cuts: assets.map((asset) => ({
              id: `candidate-${asset.id}`,
              assetId: asset.id,
              inFrame: Math.floor(asset.durationFrames * 0.45),
              outFrame: Math.floor(asset.durationFrames * 0.6),
              name: `候选 ${asset.name}`,
              enabled: true,
            })),
          },
        ],
      });
      const task = tasks.find((task) => task.id === ai.state.task!.id)!;
      task.status = "completed";
      await ai.handleTask(task);
    },
    project: () => project,
    replaceProject: (next: Project) => {
      project = validateProject(next);
    },
    source: () => sourceId,
    undo: () => {
      project = validateProject({ ...history.pop()!, revision: project.revision + 1 });
    },
    rejectEdits: () => {
      rejectEdits = true;
    },
    frame: () => frame,
    setFrame: (next: number) => {
      frame = next;
    },
    setSource: (id: string) => {
      sourceId = id;
      ui.setAsset(id);
    },
    changed: () => changed,
    messages,
    downloads,
    plays,
  };
}

function expectDisclosure(
  ui: ReturnType<typeof createRoughCutUI>,
  kind: "bulk" | "ai",
  expanded: boolean,
) {
  const markup = ui.render();
  const region = new RegExp(`id="roughcut-${kind}-panel"[^>]*`);
  const panel = markup.match(region)?.[0];
  assert.ok(panel, `${kind} remains available as a secondary tool`);
  assert.equal(/\bhidden\b/.test(panel), !expanded);
  assert.match(
    markup,
    new RegExp(`data-action="roughcut-${kind}-toggle"[^>]*aria-expanded="${expanded}"`),
  );
}

function expectScope(ui: ReturnType<typeof createRoughCutUI>, scope: "current" | "queue") {
  const select = ui
    .render()
    .match(/<select[^>]*data-roughcut-field="ai-scope"[^>]*>[\s\S]*?<\/select>/)?.[0];
  assert.ok(select, "AI exposes an explicit current-source or selected-queue choice");
  assert.match(select, new RegExp(`<option\\s+value="${scope}"[^>]*\\bselected\\b`));
}

function expectAIStartDisabled(ui: ReturnType<typeof createRoughCutUI>, disabled: boolean) {
  const button = ui.render().match(/<button[^>]*data-action="roughcut-ai-start"[^>]*>/)?.[0];
  assert.ok(button, "AI start remains visible with its current availability");
  assert.equal(/\bdisabled\b/.test(button), disabled);
}

function promptedIds(start: Record<string, unknown>): string[] {
  return JSON.parse(String(start.prompt).split("本批素材数据：")[1]!).map(
    (asset: { id: string }) => asset.id,
  );
}

test("ordinary source mode puts manual controls first and explicit batch mode opens only batch tools", async () => {
  const f = fixture();
  const before = f.project();
  expectDisclosure(f.ui, "bulk", false);
  expectDisclosure(f.ui, "ai", false);
  expectScope(f.ui, "current");
  const markup = f.ui.render();
  for (const control of [
    "roughcut-source",
    "roughcut-mark-in",
    "roughcut-mark-out",
    "roughcut-save",
    "roughcut-append",
    "roughcut-csv",
  ])
    assert.ok(
      markup.indexOf(control) < markup.indexOf("roughcut-ai-toggle"),
      `${control} precedes optional AI tools`,
    );
  assert.ok(markup.indexOf("roughcut-ai-toggle") < markup.indexOf("roughcut-bulk-toggle"));
  await f.ui.action("roughcut-ai-toggle");
  expectDisclosure(f.ui, "ai", true);
  expectDisclosure(f.ui, "bulk", false);
  f.ui.setMode("batch");
  expectDisclosure(f.ui, "bulk", true);
  expectDisclosure(f.ui, "ai", false);
  expectScope(f.ui, "queue");
  await f.ui.action("roughcut-ai-toggle");
  expectDisclosure(f.ui, "ai", true);
  f.ui.setMode("single");
  expectDisclosure(f.ui, "bulk", false);
  expectDisclosure(f.ui, "ai", false);
  expectScope(f.ui, "current");
  assert.equal(f.startAttempts.length, 0, "Entry and disclosure choices never start an AI task");
  assert.deepEqual(f.project(), before, "Disclosure and entry mode changes never edit the project");
});

test("single-source AI ignores an earlier multi-selection and preserves manual drafts and queue order", async () => {
  const f = fixture();
  f.ui.setQueue(["source-b", "source-a"]);
  f.ui.setMode("single");
  f.input("in", "2");
  f.input("out", "4");
  f.input("ai-goal", "仅保留当前原片里的主体镜头");
  const before = structuredClone(f.project());
  expectScope(f.ui, "current");
  expectAIStartDisabled(f.ui, false);
  await f.ui.action("roughcut-ai-start");
  assert.deepEqual(promptedIds(f.startAttempts[0]!), ["source-a"]);
  assert.match(String(f.startAttempts[0]!.prompt), /仅保留当前原片里的主体镜头/);
  assert.deepEqual(f.ai.state.assetIds, ["source-a"]);
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 60, outFrame: 120 });
  const markup = f.ui.render();
  assert.ok(
    markup.indexOf('data-roughcut-queue-row="source-b"') <
      markup.indexOf('data-roughcut-queue-row="source-a"'),
    "Single-source AI must not replace the selected queue or its order",
  );
  assert.deepEqual(f.project(), before, "AI start must not save marks or change the timeline");

  await f.finishAI();
  expectAIStartDisabled(f.ui, true);
  await f.ui.action("roughcut-ai-start");
  assert.equal(f.startAttempts.length, 1, "Unreviewed single-source candidates cannot be replaced");
  assert.deepEqual(f.project(), before);
  const candidate = f.ai.state.cuts[0]!;
  await f.ui.action("roughcut-candidate-preview", candidate.id);
  assert.deepEqual(f.plays.at(-1), [candidate.inFrame, candidate.outFrame]);
  expectScope(f.ui, "current");
  await f.ui.action("roughcut-ai-save");
  assert.equal(f.project().revision, before.revision + 1);
  assert.deepEqual(
    f.project().roughCuts!.map((cut) => cut.assetId),
    ["source-a"],
  );
  assert.deepEqual(
    f.project().clips,
    before.clips,
    "Reviewed AI ranges still await timeline insertion",
  );
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 60, outFrame: 120 });
  f.undo();
  assert.deepEqual(f.project().roughCuts ?? [], before.roughCuts ?? []);
});

test("the batch AI shortcut targets only the selected ordered queue and keeps current-source AI independent", async () => {
  const f = fixture();
  f.ui.setQueue(["source-b", "source-a"]);
  const before = structuredClone(f.project());
  await f.ui.action("roughcut-ai-queue");
  expectScope(f.ui, "queue");
  expectDisclosure(f.ui, "ai", true);
  expectDisclosure(f.ui, "bulk", false);
  assert.equal(f.startAttempts.length, 0, "The batch shortcut opens controls without running AI");
  await f.ui.action("roughcut-ai-start");
  assert.deepEqual(promptedIds(f.startAttempts[0]!), ["source-b", "source-a"]);
  const token = f.ai.requestToken;
  const running = structuredClone(f.ai.state);
  f.input("ai-scope", "current");
  f.setSource("source-b");
  f.ui.setMode("single");
  expectScope(f.ui, "current");
  expectAIStartDisabled(f.ui, true);
  assert.match(
    f.ui.render().match(/data-roughcut-ai-target[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "",
    /原片 B\.mp4/,
  );
  assert.match(
    f.ui.render().match(/data-roughcut-ai-job-target[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "",
    /2 份素材：原片 B\.mp4.*原片 A\.mp4/,
    "The saved task's targets remain clear when the next-run scope changes",
  );
  await f.ui.action("roughcut-ai-start");
  assert.equal(f.startAttempts.length, 1);
  assert.equal(f.ai.requestToken, token);
  assert.deepEqual(
    f.ai.state,
    running,
    "Changing input scope or source must not retarget active work",
  );
  await f.finishAI();
  const review = structuredClone(f.ai.state);
  f.input("ai-scope", "queue");
  const candidate = f.ai.state.cuts.find((cut) => cut.assetId === "source-a")!;
  await f.ui.action("roughcut-candidate-preview", candidate.id);
  expectScope(f.ui, "queue");
  assert.equal(f.source(), "source-a");
  assert.deepEqual(f.ai.state, review, "Candidate preview retains both sources' review results");
  assert.deepEqual(f.project(), before);
});

test("AI with no current video or audio and AI with an empty queue never fall back to all sources", async () => {
  const f = fixture();
  const before = structuredClone(f.project());
  for (const id of ["missing", "still"]) {
    f.setSource(id);
    f.ui.setMode("single");
    expectAIStartDisabled(f.ui, true);
    await f.ui.action("roughcut-ai-start");
  }
  f.setSource("source-a");
  f.ui.setQueue([]);
  f.input("ai-scope", "queue");
  expectAIStartDisabled(f.ui, true);
  await f.ui.action("roughcut-ai-start");
  assert.equal(f.startAttempts.length, 0);
  assert.deepEqual(f.ai.state.assetIds, []);
  assert.deepEqual(f.project(), before);
  f.input("ai-scope", "current");
  expectAIStartDisabled(f.ui, false);
  await f.ui.action("roughcut-ai-start");
  assert.deepEqual(promptedIds(f.startAttempts[0]!), ["source-a"]);
});

test("restored zero-of-four AI progress survives scope changes until retry or explicit discard", async () => {
  const f = fixture();
  const queue = ["source-b", "source-a", "source-c", "source-d"];
  f.replaceProject({
    ...f.project(),
    assets: [
      ...f.project().assets,
      ...["source-c", "source-d"].map((id) => ({
        id,
        kind: "video" as const,
        name: `${id}.mp4`,
        durationFrames: 900,
      })),
    ],
  });
  const before = structuredClone(f.project());
  f.ui.setQueue(queue);
  f.ui.setMode("batch");
  f.rejectStart("agent.task.start maxTurns must be an integer from 1 to 20");
  await f.ui.action("roughcut-ai-start");
  assert.equal(f.ai.state.phase, "failed");
  assert.equal(f.ai.state.completed, 0);
  assert.equal(f.ai.state.cuts.length, 0);
  assert.equal(f.tasks.length, 0);
  expectAIStartDisabled(f.ui, true);
  await f.ui.action("roughcut-ai-start");
  assert.equal(f.startAttempts.length, 1, "A failed zero-result queue also cannot be replaced");
  const checkpoint = f.snapshots.at(-1)!;
  assert.ok(checkpoint);
  assert.equal(checkpoint.state.phase, "preparing");
  await f.ai.restore(checkpoint);
  assert.equal(f.ai.state.phase, "cancelled");
  const restored = structuredClone(f.ai.state);
  f.ui.setQueue(["source-a"]);
  f.setSource("source-a");
  f.ui.setMode("single");
  await f.ui.action("roughcut-ai-toggle");
  expectDisclosure(f.ui, "bulk", false);
  expectAIStartDisabled(f.ui, true);
  assert.match(f.ui.render(), /data-action="roughcut-ai-retry"/);
  assert.match(f.ui.render(), /data-action="roughcut-ai-discard"/);
  await f.ui.action("roughcut-ai-start");
  assert.equal(f.startAttempts.length, 1, "A zero-result saved queue is still unfinished work");
  assert.deepEqual(f.ai.state, restored);
  f.rejectStart("");
  await f.ui.action("roughcut-ai-retry");
  assert.deepEqual(
    f.ai.state.assetIds,
    queue,
    "Retry uses saved targets, not the newly displayed scope",
  );
  assert.deepEqual(promptedIds(f.startAttempts[1]!), queue.slice(0, 3));
  await f.ui.action("roughcut-ai-cancel");
  expectAIStartDisabled(f.ui, true);
  await f.ui.action("roughcut-ai-discard");
  expectAIStartDisabled(f.ui, false);
  await f.ui.action("roughcut-ai-start");
  assert.deepEqual(promptedIds(f.startAttempts[2]!), ["source-a"]);
  assert.deepEqual(
    f.project(),
    before,
    "Recovery, cancellation and discard never edit the project",
  );
});

test("optional tools keep their disclosure through source and draft updates and reset with the project", async () => {
  const f = fixture();
  f.ui.setMode("batch");
  await f.ui.action("roughcut-ai-toggle");
  f.input("in", "1");
  f.input("out", "2");
  await f.ui.action("roughcut-save");
  f.ui.setQueue(["source-a", "source-b"]);
  await f.ui.action("roughcut-queue-next");
  expectDisclosure(f.ui, "bulk", true);
  expectDisclosure(f.ui, "ai", true);
  await f.ui.action("roughcut-batch-plan");
  const candidate = f.ui
    .render()
    .match(/data-roughcut-field="candidate-enabled" data-id="([^"]+)"/)?.[1];
  assert.ok(candidate);
  f.ui.input({
    dataset: { roughcutField: "candidate-enabled", id: candidate },
    checked: false,
  } as unknown as HTMLInputElement);
  expectDisclosure(f.ui, "bulk", true);
  expectDisclosure(f.ui, "ai", true);
  await f.ui.action("roughcut-bulk-toggle");
  expectDisclosure(f.ui, "bulk", false);
  expectDisclosure(f.ui, "ai", true);
  await f.ui.action("roughcut-bulk-toggle");
  expectDisclosure(f.ui, "ai", true);
  const changed = { ...f.project(), id: "different-project" };
  f.replaceProject(changed);
  expectDisclosure(f.ui, "bulk", false);
  expectDisclosure(f.ui, "ai", false);
  f.ui.setMode("batch");
  await f.ui.action("roughcut-ai-toggle");
  f.ui.setAsset("");
  expectDisclosure(f.ui, "bulk", false);
  expectDisclosure(f.ui, "ai", false);
  assert.deepEqual(f.project(), changed, "Resetting optional controls retains saved marks");
});

test("uniform trimming drafts preserve manual I/O and require review before atomic save", async () => {
  const f = fixture();
  f.input("in", "2");
  f.input("out", "4");
  f.input("batch-head", "1.5");
  f.input("batch-tail", "2");
  await f.ui.action("roughcut-batch-plan");
  assert.equal(f.project().roughCuts?.length ?? 0, 0);
  assert.equal(f.project().clips.length, 0);
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 60, outFrame: 120 });
  assert.match(f.ui.render(), /统一裁剪候选 · 2 段/);
  await f.ui.action("roughcut-batch-save");
  assert.deepEqual(
    f.project().roughCuts!.map((cut) => [cut.assetId, cut.inFrame, cut.outFrame]),
    [
      ["source-a", 45, 840],
      ["source-b", 45, 540],
    ],
  );
  assert.equal(f.project().clips.length, 0);
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 60, outFrame: 120 });
  f.undo();
  assert.equal(f.project().roughCuts?.length ?? 0, 0);
});

test("uniform trimming reports too-short sources and fixed length centers frame-exactly", async () => {
  const f = fixture();
  f.input("batch-head", "12");
  f.input("batch-tail", "10");
  await f.ui.action("roughcut-batch-plan");
  assert.match(f.ui.render(), /1 份素材去头尾后没有剩余，已跳过：原片 B.mp4/);
  await f.ui.action("roughcut-batch-discard");
  f.input("batch-mode", "keep");
  f.input("batch-length", "5.1");
  f.input("batch-position", "middle");
  await f.ui.action("roughcut-batch-plan");
  await f.ui.action("roughcut-batch-save");
  assert.deepEqual(
    f.project().roughCuts!.map((cut) => [cut.inFrame, cut.outFrame]),
    [
      [373, 526],
      [223, 376],
    ],
  );
  f.input("batch-length", "100");
  await f.ui.action("roughcut-batch-plan");
  assert.match(f.ui.render(), /2 份素材短于指定时长，候选保留整段/);
});

test("uniform review refuses source changes, preserves candidates on edit rejection, and clears on same-ID replacement", async () => {
  const f = fixture();
  await f.ui.action("roughcut-batch-plan");
  const before = f.project();
  f.replaceProject({
    ...before,
    assets: before.assets.map((asset) =>
      asset.id === "source-a" ? { ...asset, durationFrames: 901 } : asset,
    ),
  });
  await f.ui.action("roughcut-batch-save");
  assert.match(f.messages.at(-1)!, /时长已改变/);
  assert.equal(f.project().roughCuts?.length ?? 0, 0);
  await f.ui.action("roughcut-batch-plan");
  f.rejectEdits();
  await f.ui.action("roughcut-batch-save");
  assert.match(f.ui.render(), /统一裁剪候选 · 2 段/);
  f.ui.setAsset("");
  assert.doesNotMatch(f.ui.render(), /data-roughcut-candidates="batch"/);
});

test("rough-cut time inputs round to frames and retain half-open endpoint precision", () => {
  for (const value of [0, 1, 29, 30, 1799, 1800, 108001])
    assert.equal(parseRoughCutTime(roughCutTimecode(value)), value);
  assert.equal(parseRoughCutTime("1.5"), 45);
  assert.equal(parseRoughCutTime("01:02.5"), 1875);
  assert.equal(parseRoughCutTime("01:02:03.5"), 111705);
  assert.equal(parseRoughCutTime("00:00:01:01"), 31);
  for (const value of ["", "-1", "1e9", "00:60:00:00", "00:00:00:30", "00:62", "oops"])
    assert.equal(parseRoughCutTime(value), undefined);
});

test("I/O retains the current O frame and successive saves add ranges instead of overwriting", async () => {
  const f = fixture();
  f.setFrame(30);
  await f.ui.action("roughcut-mark-in");
  f.setFrame(59);
  await f.ui.action("roughcut-mark-out");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 30, outFrame: 60 });
  await f.ui.action("roughcut-save");
  f.setFrame(90);
  await f.ui.action("roughcut-mark-in");
  f.setFrame(119);
  await f.ui.action("roughcut-mark-out");
  await f.ui.action("roughcut-save");
  assert.deepEqual(
    f.project().roughCuts!.map((cut) => [cut.inFrame, cut.outFrame]),
    [
      [30, 60],
      [90, 120],
    ],
  );
  const first = f.project().roughCuts![0]!;
  await f.ui.action("roughcut-select", first.id);
  f.input("name", "更精确的开场");
  f.input("out", "2.5");
  await f.ui.action("roughcut-save");
  assert.equal(f.project().roughCuts!.length, 2);
  assert.equal(f.project().roughCuts![0]!.outFrame, 75);
  assert.equal(f.project().roughCuts![0]!.name, "更精确的开场");
  assert.equal(f.project().clips.length, 0);
});

test("drafts are isolated by source and an explicit project reset clears same-id drafts", () => {
  const f = fixture();
  f.input("in", "3");
  f.input("out", "5");
  f.setSource("source-b");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 0, outFrame: 600 });
  f.input("in", "6");
  f.input("out", "8");
  f.setSource("source-a");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 90, outFrame: 150 });
  f.ui.setAsset("");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 0, outFrame: 900 });
  assert.equal(f.changed(), 0);
  assert.doesNotMatch(f.ui.render(), /<option value="still"/);
});

test("invalid bounds cannot save or preview; keyboard commands ignore editable controls", async () => {
  const f = fixture();
  f.input("in", "5");
  f.input("out", "3");
  assert.equal(f.ui.selectedRange(), undefined);
  await f.ui.action("roughcut-save");
  await f.ui.action("roughcut-preview");
  assert.equal((f.project().roughCuts ?? []).length, 0);
  assert.equal(f.plays.length, 0);
  const base = {
    key: "i",
    target: { closest: () => ({}) },
    preventDefault() {
      throw new Error("must not consume typing");
    },
  };
  assert.equal(f.ui.key(base as unknown as KeyboardEvent), false);
  assert.equal(await f.ui.action("split"), false);
  f.setFrame(0);
  await f.ui.action("roughcut-mark-in");
  f.setFrame(899);
  await f.ui.action("roughcut-mark-out");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 0, outFrame: 900 });
});

test("plus saves and source navigation seeks frame-by-frame without changing composition", () => {
  const f = fixture();
  const event = (key: string, shiftKey = false) =>
    ({ key, shiftKey, target: null, preventDefault() {} }) as unknown as KeyboardEvent;
  assert.equal(f.ui.key(event("+")), true);
  assert.equal(f.project().roughCuts!.length, 1);
  assert.equal(f.ui.key(event("ArrowRight")), true);
  assert.equal(f.frame(), 1);
  assert.equal(f.ui.key(event("ArrowRight", true)), true);
  assert.equal(f.frame(), 31);
  assert.equal(f.ui.key(event("ArrowLeft")), true);
  assert.equal(f.frame(), 30);
  assert.equal(f.project().clips.length, 0);
});

test("current-source export and append honor enabled list order", async () => {
  const f = fixture();
  f.input("in", "1");
  f.input("out", "2");
  await f.ui.action("roughcut-save");
  f.input("in", "3");
  f.input("out", "4");
  await f.ui.action("roughcut-save");
  const second = f.project().roughCuts![1]!;
  await f.ui.action("roughcut-up", second.id);
  await f.ui.action("roughcut-csv");
  assert.match(f.downloads[0]!.contents, /^"3","4"/);
  await f.ui.action("roughcut-append");
  assert.deepEqual(
    f.project().clips.map((clip) => [clip.inFrame, clip.outFrame]),
    [
      [90, 120],
      [30, 60],
    ],
  );
});

test("undo reloads a changed saved baseline even while a selection has an unapplied draft", async () => {
  const f = fixture();
  f.input("in", "1");
  f.input("out", "2");
  await f.ui.action("roughcut-save");
  await f.ui.action("roughcut-select", f.project().roughCuts![0]!.id);
  f.input("out", "3");
  await f.ui.action("roughcut-save");
  f.input("out", "4");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 30, outFrame: 120 });
  f.undo();
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 30, outFrame: 60 });
});

test("a rejected commit preserves the marked draft instead of advancing to a new range", async () => {
  const f = fixture();
  f.input("in", "1");
  f.input("out", "2");
  f.input("name", "保留这份草稿");
  f.rejectEdits();
  await f.ui.action("roughcut-save");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 30, outFrame: 60 });
  assert.match(f.ui.render(), /保留这份草稿/);
  assert.equal((f.project().roughCuts ?? []).length, 0);
});

test("the selected source queue navigates in order while each source retains its unsaved draft", async () => {
  const f = fixture();
  const before = structuredClone(f.project());
  f.input("in", "3");
  f.input("out", "5");
  f.ui.setQueue(["source-b", "still", "source-b", "missing", "source-a"]);
  await f.ui.action("roughcut-queue-previous");
  assert.equal(f.source(), "source-b");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 0, outFrame: 600 });
  f.input("in", "6");
  f.input("out", "8");
  await f.ui.action("roughcut-queue-next");
  assert.equal(f.source(), "source-a");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 90, outFrame: 150 });
  const markup = f.ui.render();
  assert.ok(
    markup.indexOf('data-roughcut-queue-row="source-b"') <
      markup.indexOf('data-roughcut-queue-row="source-a"'),
  );
  assert.doesNotMatch(markup, /data-roughcut-queue-row="(?:still|missing)"/);
  f.ui.input({
    dataset: { roughcutField: "queue-enabled", assetId: "source-a" },
    checked: false,
  } as unknown as HTMLInputElement);
  await f.ui.action("roughcut-queue-next");
  assert.equal(f.source(), "source-b", "An unchecked current source can enter the selected queue");
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 180, outFrame: 240 });
  await f.ui.action("roughcut-queue-next");
  assert.equal(f.source(), "source-b", "Navigation stops at the end of the queue");
  assert.deepEqual(f.project(), before, "Queue navigation and selection never edit the project");
});

test("batch insertion respects source order and enabled per-source order with one undo", async () => {
  const f = fixture();
  f.input("in", "1");
  f.input("out", "2");
  await f.ui.action("roughcut-save");
  const excluded = f.project().roughCuts![0]!;
  f.input("in", "3");
  f.input("out", "5");
  await f.ui.action("roughcut-save");
  await f.ui.action("roughcut-up", f.project().roughCuts![1]!.id);
  f.ui.input({
    dataset: { roughcutField: "enabled", cutId: excluded.id },
    checked: false,
  } as unknown as HTMLInputElement);
  f.setSource("source-b");
  f.input("in", "2");
  f.input("out", "3");
  await f.ui.action("roughcut-save");
  f.ui.setQueue(["source-b", "source-a"]);
  const before = structuredClone(f.project());
  assert.match(f.ui.render(), /统一加入 2 段到成片/);
  await f.ui.action("roughcut-queue-append");
  assert.deepEqual(
    f.project().clips.map((clip) => [clip.assetId, clip.inFrame, clip.outFrame]),
    [
      ["source-b", 60, 90],
      ["source-a", 90, 150],
    ],
  );
  assert.deepEqual(f.project().roughCuts, before.roughCuts);
  f.undo();
  assert.deepEqual(f.project().clips, before.clips);
  assert.deepEqual(f.project().roughCuts, before.roughCuts, "Undo preserves reusable source marks");
});

test("batch audio overflow or a rejected edit leaves all existing tracks and markers intact", async () => {
  const f = fixture();
  f.replaceProject({
    ...f.project(),
    assets: [
      ...f.project().assets,
      { id: "voice", name: "配音.wav", kind: "audio", durationFrames: 120 },
    ],
  });
  f.input("in", "0");
  f.input("out", "1");
  await f.ui.action("roughcut-save");
  f.setSource("voice");
  f.input("in", "0");
  f.input("out", "3");
  await f.ui.action("roughcut-save");
  f.ui.setQueue(["source-a", "voice"]);
  const before = structuredClone(f.project());
  await f.ui.action("roughcut-queue-append");
  assert.match(f.messages.at(-1)!, /音频选段超出画面时长/);
  assert.deepEqual(f.project(), before, "A late audio failure cannot partially append the video");
  f.ui.setQueue(["source-a"]);
  f.rejectEdits();
  await f.ui.action("roughcut-queue-append");
  assert.match(f.messages.at(-1)!, /请等待当前制作完成/);
  assert.deepEqual(f.project(), before);
});

test("queue selection and drafts reset across projects and explicit same-ID replacement", async () => {
  const f = fixture();
  assert.match(f.ui.render(), /id="roughcut-queue-picker"\s+hidden/);
  await f.ui.action("roughcut-queue-toggle");
  assert.doesNotMatch(f.ui.render(), /id="roughcut-queue-picker"\s+hidden/);
  f.ui.setQueue(["source-b"]);
  f.input("in", "3");
  f.input("out", "5");
  assert.doesNotMatch(f.ui.render(), /id="roughcut-queue-picker"\s+hidden/);
  const next = { ...f.project(), id: "another-project" };
  f.replaceProject(next);
  assert.deepEqual(f.ui.selectedRange(), { inFrame: 0, outFrame: 900 });
  assert.match(f.ui.render(), /id="roughcut-queue-picker"\s+hidden/);
  await f.ui.action("roughcut-queue-next");
  assert.equal(f.source(), "source-b", "A new project defaults to every eligible source");
  await f.ui.action("roughcut-queue-previous");
  assert.equal(f.source(), "source-a");
  f.ui.setQueue([]);
  await f.ui.action("roughcut-queue-append");
  assert.match(f.messages.at(-1)!, /请先为队列中的素材/);
  f.ui.setAsset("");
  await f.ui.action("roughcut-queue-next");
  assert.equal(f.source(), "source-b", "Same-ID project replacement also clears queue intent");
  await f.ui.action("roughcut-queue-clear");
  await f.ui.action("roughcut-queue-previous");
  assert.equal(f.source(), "source-b");
  await f.ui.action("roughcut-queue-all");
  await f.ui.action("roughcut-queue-previous");
  assert.equal(f.source(), "source-a");
  assert.equal(f.project().clips.length, 0);
});
