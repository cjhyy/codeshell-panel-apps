import { installGenericMediaTaskMock } from "./helpers/video-studio-generic-task.mjs";
import {
  enterLegacyProduction,
  readSavedLegacyProject,
} from "./helpers/video-studio-editor-fixture.mjs";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = resolve(root, "artifacts/video-studio/workflow-ui");
const sourceId = `asset-${"d".repeat(64)}`;
const seed = {
  schemaVersion: 1,
  id: "workflow-ui-project",
  name: "多素材制作流程验收",
  revision: 0,
  width: 1920,
  height: 1080,
  fps: 30,
  assets: [
    { id: "picture", name: "主线画面", kind: "demo", durationFrames: 600 },
    {
      id: "original-voice",
      name: "原声口播.mp3",
      kind: "audio",
      mediaId: sourceId,
      durationFrames: 720,
      mimeType: "audio/mpeg",
      size: 384865,
    },
  ],
  clips: [{ id: "picture-clip", assetId: "picture", inFrame: 0, outFrame: 600, volume: 1 }],
  audioClips: [
    {
      id: "voice-clip",
      assetId: "original-voice",
      inFrame: 0,
      outFrame: 300,
      startFrame: 60,
      volume: 0.8,
    },
  ],
  captions: [{ id: "caption", startFrame: 60, endFrame: 150, text: "保留原声，整理制作顺序。" }],
};
const sheet = {
  stage: "initialized",
  brief: "用现有画面和自己的口播制作一条 20 秒横屏短片，保留真实原声。",
  outline: "先说明主题，再呈现过程，最后给出结尾；需要核实的画面保留为待审。",
  sources: [
    {
      assetId: "picture",
      role: "main",
      note: "测试画面，尚未做内容观察。",
      inFrame: 0,
      outFrame: 600,
    },
    {
      assetId: "original-voice",
      role: "voice",
      note: "已有音频准备结果，正式制作时读取真实转写。",
    },
  ],
  nextSteps: ["核对画面与转写", "挑选内容并粗剪", "检查原声、字幕和完整结尾后导出"],
  blockers: ["画面内容尚未审阅"],
};
let browser, server, url, buildDirectory, output;
const errors = [];

before(async () => {
  const [project] = selectProjects(await discoverProjects(), "video-studio");
  buildDirectory = await mkdtemp(resolve(tmpdir(), "video-workflow-ui-"));
  const isolatedOutput = resolve(buildDirectory, "package");
  await buildProject({ ...project, output: isolatedOutput }, { log: false });
  output = resolve(isolatedOutput, "app");
  await mkdir(artifacts, { recursive: true });
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const path = pathname.startsWith("/media/")
      ? resolve(output, "demo-narration.mp3")
      : resolve(output, "." + pathname.replace(/\/$/, "/index.html"));
    if (!path.startsWith(output + sep)) return response.writeHead(403).end();
    try {
      response.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".mjs": "text/javascript",
            ".css": "text/css",
            ".mp3": "audio/mpeg",
          }[extname(path)] || "application/octet-stream",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      response.end(await readFile(path));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (buildDirectory) await rm(buildDirectory, { recursive: true, force: true });
  assert.deepEqual(errors, [], "The actual app must not throw runtime errors or violate CSP");
});

// LLM, media jobs and persistence are local bridge fixtures. The actual app bundles,
// tool guards, project validation, storage adapter and browser audio decoding run unchanged.
async function openPage({ host = true, width = 1440, workflow } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text()))
      errors.push(message.text());
  });
  await page.addInitScript(installGenericMediaTaskMock);
  await page.addInitScript(
    ({ seed, sourceId, host, workflow }) => {
      const initial = { ...seed, ...(workflow ? { workflow } : {}) };
      if (!host) {
        if (!localStorage.getItem("video-studio-project-v1"))
          localStorage.setItem("video-studio-project-v1", JSON.stringify(initial));
        return;
      }
      const documents = JSON.parse(localStorage.getItem("workflow-documents") || "null") || {
        "video-studio-current": { revision: 1, data: initial },
      };
      const storage = {};
      const jobs = JSON.parse(localStorage.getItem("workflow-jobs") || "{}");
      const tasks = JSON.parse(localStorage.getItem("workflow-tasks") || "{}");
      window.__panelTools = {};
      window.__events = {};
      window.__calls = [];
      window.__taskCalls = [];
      window.__documents = documents;
      const persist = () => {
        localStorage.setItem("workflow-documents", JSON.stringify(documents));
        localStorage.setItem("workflow-jobs", JSON.stringify(jobs));
        localStorage.setItem("workflow-tasks", JSON.stringify(tasks));
      };
      const asset = {
        id: sourceId,
        name: "原声口播.mp3",
        mimeType: "audio/mpeg",
        bytes: 384865,
        createdAt: 1,
      };
      const preparation = {
        assetId: sourceId,
        inspection: {
          kind: "audio",
          durationSeconds: 24,
          audio: { channels: 1, sampleRate: 48000 },
        },
        transcription: { status: "available", source: "test-fixture" },
      };
      window.__completePreparation = (id) => {
        const job = jobs[id];
        if (!job || job.type !== "prepare") throw Error("Expected a preparation job");
        job.status = "succeeded";
        job.updatedAt = Date.now();
        job.result = structuredClone(preparation);
        persist();
        window.__events["media.job.changed"]?.(structuredClone(job));
      };
      window.__completeTask = (id) => {
        const task = tasks[id];
        if (!task) throw Error("Expected a task");
        task.status = "completed";
        persist();
        window.__events["agent.task.changed"]?.(structuredClone(task));
      };
      window.codeshellPanel = {
        getContext: async () => ({ cwd: "/isolated/workflow-ui", theme: "dark" }),
        registerTool(name, handler) {
          window.__panelTools[name] = handler;
          return () => {};
        },
        on(name, handler) {
          window.__events[name] = handler;
          return () => {};
        },
        async call(method, args = {}) {
          window.__calls.push({ method, args: structuredClone(args) });
          if (method === "media.status")
            return {
              persistent: true,
              ffmpeg: { available: true },
              transcription: { available: true },
              hyperframes: { available: true },
              tts: { available: true },
            };
          if (method === "storage.get") return storage[args.key] ?? null;
          if (method === "storage.set") {
            storage[args.key] = structuredClone(args.value);
            return true;
          }
          if (method === "media.document.get")
            return structuredClone(documents[args.key] ?? { revision: 0, data: null });
          if (method === "media.document.set") {
            if ((documents[args.key]?.revision ?? 0) !== args.baseRevision)
              throw Error("Mock revision conflict");
            documents[args.key] = {
              revision: args.baseRevision + 1,
              data: structuredClone(args.data),
              label: args.label,
            };
            persist();
            return structuredClone(documents[args.key]);
          }
          if (method === "media.document.versions") return [];
          if (method === "media.assets.get")
            return { asset: structuredClone(asset), preparation: structuredClone(preparation) };
          if (method === "media.jobs.list")
            return { jobs: Object.values(jobs).map(({ result, ...job }) => structuredClone(job)) };
          if (method === "media.jobs.get") return structuredClone(jobs[args.id]);
          if (method === "media.prepare") {
            const created = args.assetIds.map(() => {
              const job = {
                id: `job-prepare-${crypto.randomUUID()}`,
                type: "prepare",
                status: "queued",
                attempt: 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              jobs[job.id] = job;
              return structuredClone(job);
            });
            persist();
            return { jobs: created };
          }
          if (method === "agent.task.start") {
            window.__taskCalls.push(structuredClone(args));
            const task = { id: `task-${crypto.randomUUID()}`, status: "running" };
            tasks[task.id] = task;
            persist();
            return structuredClone(task);
          }
          if (method === "agent.task.get") return structuredClone(tasks[args.id]);
          if (method === "agent.task.cancel") {
            tasks[args.id].status = "cancelled";
            persist();
            return structuredClone(tasks[args.id]);
          }
          throw Error("Unexpected mock Host call: " + method);
        },
      };
    },
    { seed, sourceId, host, workflow },
  );
  await page.goto(url);
  await enterLegacyProduction(page);
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  if (host)
    await page.waitForFunction(
      (id) => window.__panelTools?.read_video_project().preparation[id],
      sourceId,
    );
  await page.locator('[data-tab="ai"]').click();
  return { page, context };
}

const readState = (page) => page.evaluate(() => window.__panelTools.read_video_project());
const hostCalls = (page, names) =>
  page.evaluate((names) => window.__calls.filter(({ method }) => names.includes(method)), names);
async function beginInitialization(page) {
  await page.locator("#ai-prompt").fill("整理这批素材，保存制作单，保留现有剪辑和原声。");
  await page.locator('[data-action="initialize-video"]').click();
  await page.waitForFunction(
    () => window.__documents["video-studio-production"]?.data.auto?.taskId,
  );
}
async function applySheet(page, value = sheet, extra = []) {
  return page.evaluate(
    async ({ value, extra }) => {
      const state = window.__panelTools.read_video_project();
      return window.__panelTools.apply_video_edit({
        projectId: state.project.id,
        requestToken: state.requestToken,
        baseRevision: state.project.revision,
        title: "保存制作单",
        operations: [{ type: "workflow", workflow: value }, ...extra],
      });
    },
    { value, extra },
  );
}

test(
  "initialization rejects media changes, saves its sheet, restores it and routes the next full workflow",
  { timeout: 30_000 },
  async () => {
    const { page, context } = await openPage();
    try {
      const before = (await readState(page)).project;
      await beginInitialization(page);
      const request = await page.evaluate(() => window.__taskCalls[0]);
      assert.equal(request.skill, "video-studio:video-init");
      assert.ok(request.skills.includes("video-studio:video-workflow"));
      assert.deepEqual(await hostCalls(page, ["media.prepare", "media.transcribe"]), []);
      const blocked = await page.evaluate(async () => {
        const state = window.__panelTools.read_video_project();
        const identity = {
          projectId: state.project.id,
          requestToken: state.requestToken,
          baseRevision: state.project.revision,
        };
        const mutations = [
          ["enhance_video_audio", { assetId: "original-voice" }],
          ["set_video_script", { text: "未经授权的新文稿", finish: true }],
          ["create_video_voiceover", { text: "未经授权的旁白" }],
          ["create_video_scene", { title: "未经授权的片头" }],
          ["render_video_project", {}],
          ["finish_video_tts_setup", { jobId: "job-unrelated" }],
          ["propose_video_edit", { title: "不能绕过模式", operations: [] }],
        ];
        const outcomes = [];
        for (const [name, args] of mutations) {
          try {
            await window.__panelTools[name]({ ...identity, ...args });
            outcomes.push({ name, rejected: false });
          } catch {
            outcomes.push({ name, rejected: true });
          }
        }
        return outcomes;
      });
      assert.equal(blocked.length, 7);
      assert.ok(blocked.every(({ rejected }) => rejected));
      await assert.rejects(
        applySheet(page, sheet, [
          { type: "trim", clipId: "picture-clip", inFrame: 0, outFrame: 300 },
        ]),
      );
      await assert.rejects(applySheet(page, { ...sheet, stage: "rough-cut" }));
      assert.deepEqual((await readState(page)).project, before);
      assert.deepEqual(
        await hostCalls(page, ["media.tts", "media.scene", "media.render", "media.audio.enhance"]),
        [],
      );
      const result = await applySheet(page);
      assert.equal(result.applied, true);
      await page.waitForFunction(
        () => window.__documents["video-studio-production"].data.auto.phase === "done",
      );
      const after = await readState(page);
      assert.equal(after.requestToken, null);
      assert.equal(after.project.revision, before.revision + 1);
      assert.deepEqual(after.project.workflow, sheet);
      for (const key of ["assets", "clips", "audioClips", "captions"])
        assert.deepEqual(after.project[key], before[key]);
      assert.deepEqual(await readSavedLegacyProject(page), after.project);
      await page.evaluate(() =>
        window.__completeTask(window.__documents["video-studio-production"].data.auto.taskId),
      );
      await page.reload();
      await enterLegacyProduction(page);
      await page.waitForFunction(() => window.__panelTools?.read_video_project().project.workflow);
      await page.locator('[data-tab="ai"]').click();
      await page.locator("details.workflow-summary summary").click();
      assert.ok(
        await page
          .locator("details.workflow-summary")
          .innerText()
          .then((text) => text.includes(sheet.brief)),
      );
      const restored = await readState(page);
      assert.deepEqual(restored.project.workflow, sheet);
      assert.equal(restored.requestToken, null);
      assert.deepEqual(await hostCalls(page, ["agent.task.start"]), []);
      await page.screenshot({
        path: resolve(artifacts, "initialized-workflow-desktop.png"),
        fullPage: true,
      });
      await page.locator('[data-action="ask-ai"]').click();
      await page.waitForFunction(() => window.__taskCalls.length === 1);
      assert.equal(
        await page.evaluate(() => window.__taskCalls[0].skill),
        "video-studio:video-workflow",
      );
      assert.deepEqual(await hostCalls(page, ["media.prepare", "media.transcribe"]), []);
      assert.deepEqual((await readState(page)).project.workflow, sheet);
      assert.equal(
        await page.locator("details.workflow-summary").evaluate((node) => node.open),
        true,
        "starting background work keeps the production sheet readable",
      );
    } finally {
      await context.close();
    }
  },
);

test(
  "initialization cannot finish while preparation is pending and can save after its real publication path completes",
  { timeout: 25_000 },
  async () => {
    const { page, context } = await openPage();
    try {
      await beginInitialization(page);
      const jobId = await page.evaluate(async () => {
        const state = window.__panelTools.read_video_project();
        const result = await window.__panelTools.prepare_video_assets({
          projectId: state.project.id,
          requestToken: state.requestToken,
          assetIds: ["original-voice"],
        });
        return result.jobs[0].id;
      });
      const before = await readState(page);
      await assert.rejects(applySheet(page));
      assert.equal((await readState(page)).project.workflow, undefined);
      assert.equal((await readState(page)).requestToken, before.requestToken);
      assert.equal(
        await page.evaluate(() => window.__documents["video-studio-production"].data.auto.phase),
        "agent",
      );
      await page.evaluate((id) => window.__completePreparation(id), jobId);
      await page.waitForFunction(
        (id) =>
          Object.values(window.__documents["video-studio-production"].data.bindings).some(
            (binding) => binding.jobId === id && binding.consumed,
          ),
        jobId,
      );
      await applySheet(page);
      assert.equal((await readState(page)).requestToken, null);
      assert.deepEqual((await readState(page)).project.workflow, sheet);
      assert.equal(
        await page.evaluate(() => window.__documents["video-studio-production"].data.auto.phase),
        "done",
      );
      assert.equal((await hostCalls(page, ["media.prepare"])).length, 1);
    } finally {
      await context.close();
    }
  },
);

test(
  "browser preview shows the restored production sheet at 390px and disables unavailable initialization",
  { timeout: 20_000 },
  async () => {
    const narrow = {
      ...sheet,
      brief: sheet.brief + " 超长素材标记：" + "workflow-source-".repeat(30),
    };
    const { page, context } = await openPage({ host: false, width: 390, workflow: narrow });
    try {
      assert.equal(await page.locator('[data-action="initialize-video"]').isDisabled(), true);
      await page.locator("details.workflow-summary summary").click();
      assert.ok(
        (await page.locator("details.workflow-summary").innerText()).includes(narrow.brief),
      );
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        page: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      assert.ok(dimensions.page <= dimensions.width, JSON.stringify(dimensions));
      assert.ok(dimensions.body <= dimensions.width, JSON.stringify(dimensions));
      await page.screenshot({
        path: resolve(artifacts, "workflow-mobile-390.png"),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  },
);
