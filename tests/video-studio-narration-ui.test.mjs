import {
  enterLegacyProduction,
  readSavedEditorDocument,
} from "./helpers/video-studio-editor-fixture.mjs";
import { installGenericMediaTaskMock } from "./helpers/video-studio-generic-task.mjs";
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
const artifacts = resolve(root, "artifacts/video-studio/narration-ui");
const pictureId = `asset-${"a".repeat(64)}`;
const recordingId = `asset-${"b".repeat(64)}`;
const otherId = `asset-${"c".repeat(64)}`;
const transcript = [
  { start: 1, end: 4, text: "先整理拍下来的画面。" },
  { start: 5, end: 9, text: "确认想说的话，再录下自己的声音。" },
  { start: 20, end: 23, text: "这句结尾必须完整保留。" },
];
const script = transcript.map((segment) => segment.text).join("\n");
const titleCaption = { id: "editor-title", startFrame: 15, endFrame: 45, text: "保留的作品标题" };
const seed = {
  schemaVersion: 1,
  id: "narration-ui-project",
  name: "先审稿后本人录音验收",
  revision: 0,
  width: 1920,
  height: 1080,
  fps: 30,
  assets: [
    {
      id: "picture",
      name: "已导入画面.png",
      kind: "image",
      mediaId: pictureId,
      durationFrames: 900,
      width: 1,
      height: 1,
      mimeType: "image/png",
      size: 68,
    },
    {
      id: "personal-recording",
      name: "本人录下的口播.mp3",
      kind: "audio",
      mediaId: recordingId,
      durationFrames: 720,
      mimeType: "audio/mpeg",
    },
    {
      id: "other-audio",
      name: "未选择的其他声音.mp3",
      kind: "audio",
      mediaId: otherId,
      durationFrames: 720,
      mimeType: "audio/mpeg",
      size: 384865,
    },
  ],
  clips: [{ id: "picture-clip", assetId: "picture", inFrame: 0, outFrame: 300, volume: 1 }],
  audioClips: [],
  captions: [titleCaption],
};
const sheet = {
  stage: "review",
  brief: "用已导入的画面和想法先做十秒草稿，确认后由本人配音。",
  outline: "先整理素材，再录本人讲解，保留完整结尾。",
  sources: [
    { assetId: "picture", role: "image", note: "已导入的测试图片，用于验证画面时长。" },
    { assetId: "personal-recording", role: "voice", note: "用户明确选择的本人录音。" },
  ],
  nextSteps: ["用户确认草稿后录音，再按真实转写完成字幕与画面"],
  blockers: [],
};
let browser, server, url, buildDirectory, output;
const errors = [];

before(async () => {
  const [project] = selectProjects(await discoverProjects(), "video-studio");
  buildDirectory = await mkdtemp(resolve(tmpdir(), "video-narration-ui-"));
  const isolatedOutput = resolve(buildDirectory, "package");
  await buildProject({ ...project, output: isolatedOutput }, { log: false });
  output = resolve(isolatedOutput, "app");
  await mkdir(artifacts, { recursive: true });
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const picture = pathname === `/media/${pictureId}`;
    const path = pathname.startsWith("/media/")
      ? resolve(output, "demo-narration.mp3")
      : resolve(output, "." + pathname.replace(/\/$/, "/index.html"));
    if (!path.startsWith(output + sep)) return response.writeHead(403).end();
    try {
      response.writeHead(200, {
        "Content-Type": picture
          ? "image/png"
          : {
              ".html": "text/html",
              ".mjs": "text/javascript",
              ".css": "text/css",
              ".mp3": "audio/mpeg",
            }[extname(path)] || "application/octet-stream",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      response.end(
        picture
          ? Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              "base64",
            )
          : await readFile(path),
      );
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
  assert.deepEqual(errors, [], "Actual app bundles must not throw or violate CSP");
});

// Host jobs, ASR, Agent responses and durable documents are explicit fixtures.
// Actual main/tool handlers, approval hashes, persistence and browser media decoding run unchanged.
// This suite tests coordination, not ASR quality or encoded MP4 output.
async function openPage({ transcriptionAvailable = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text()))
      errors.push(message.text());
  });
  await page.addInitScript(installGenericMediaTaskMock);
  await page.addInitScript(
    ({ seed, pictureId, recordingId, transcript, transcriptionAvailable }) => {
      const documents = JSON.parse(localStorage.getItem("narration-documents") || "null") || {
        "video-studio-current": { revision: 1, data: seed },
      };
      const jobs = JSON.parse(localStorage.getItem("narration-jobs") || "{}");
      const tasks = JSON.parse(localStorage.getItem("narration-tasks") || "{}");
      const prepared = JSON.parse(localStorage.getItem("narration-prepared") || "{}");
      const storage = JSON.parse(localStorage.getItem("narration-storage") || "{}");
      window.__panelTools = {};
      window.__events = {};
      window.__calls = [];
      window.__taskCalls = [];
      window.__documents = documents;
      window.__deviceRequests = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        window.__deviceRequests += 1;
        throw new Error("This test must never request a real recording device");
      };
      const persist = () => {
        localStorage.setItem("narration-documents", JSON.stringify(documents));
        localStorage.setItem("narration-jobs", JSON.stringify(jobs));
        localStorage.setItem("narration-tasks", JSON.stringify(tasks));
        localStorage.setItem("narration-prepared", JSON.stringify(prepared));
        localStorage.setItem("narration-storage", JSON.stringify(storage));
      };
      const asset = (id) => {
        const source = seed.assets.find((entry) => entry.mediaId === id);
        if (!source) throw Error("Unknown fixture source " + id);
        return {
          id,
          name: source.name,
          mimeType: source.mimeType,
          bytes: source.size ?? 384865,
          createdAt: 1,
        };
      };
      const preparation = (id) => ({
        assetId: id,
        inspection:
          id === pictureId
            ? { kind: "image", width: 1, height: 1 }
            : {
                kind: "audio",
                durationSeconds: 24,
                audio: { codec: "mp3", channels: 1, sampleRate: 48000 },
              },
        ...(prepared[id]
          ? { transcription: { status: "available", source: "explicit-asr-fixture" } }
          : {}),
      });
      const startJob = (type, input) => {
        const job = {
          id: `job-narration-${type}-${crypto.randomUUID()}`,
          type,
          status: "queued",
          attempt: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          fixtureInput: structuredClone(input),
        };
        jobs[job.id] = job;
        persist();
        return structuredClone(job);
      };
      window.__completePreparation = (id) => {
        const job = jobs[id];
        if (job?.type !== "prepare") throw Error("Expected a preparation job");
        const selectedId = job.fixtureInput.assetId;
        prepared[selectedId] = true;
        job.status = "succeeded";
        job.updatedAt = Date.now();
        job.result = preparation(selectedId);
        persist();
        window.__events["media.job.changed"]?.(structuredClone(job));
      };
      window.__completeTask = () => {
        const id = documents["video-studio-production"].data.auto.taskId;
        tasks[id].status = "completed";
        persist();
        window.__events["agent.task.changed"]?.(structuredClone(tasks[id]));
      };
      window.codeshellPanel = {
        getContext: async () => ({ cwd: "/isolated/narration-ui", theme: "dark" }),
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
              transcription: { available: transcriptionAvailable },
              hyperframes: { available: true },
              tts: { available: false, voices: [], models: [] },
            };
          if (method === "media.tts.voices") return { available: false, voices: [], models: [] };
          if (method === "storage.get") return structuredClone(storage[args.key] ?? null);
          if (method === "storage.set") {
            storage[args.key] = structuredClone(args.value);
            persist();
            return true;
          }
          if (method === "media.document.get")
            return structuredClone(documents[args.key] ?? { revision: 0, data: null });
          if (method === "media.document.set") {
            if ((documents[args.key]?.revision ?? 0) !== args.baseRevision)
              throw Error("Mock document revision conflict");
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
            return { asset: asset(args.id), preparation: preparation(args.id) };
          if (method === "media.jobs.list")
            return {
              jobs: Object.values(jobs).map(({ result, ...job }) => structuredClone(job)),
            };
          if (method === "media.jobs.get") return structuredClone(jobs[args.id]);
          if (method === "media.jobs.cancel") {
            jobs[args.id].status = "cancelled";
            persist();
            return structuredClone(jobs[args.id]);
          }
          if (method === "media.prepare")
            return {
              jobs: args.assetIds.map((assetId) =>
                startJob("prepare", { assetId, transcribe: args.transcribe }),
              ),
            };
          if (method === "media.transcript") {
            if (args.assetId !== recordingId || !prepared[args.assetId])
              throw Error("Selected recording has no actual preparation result");
            const offset = args.offset ?? 0;
            return {
              assetId: args.assetId,
              total: transcript.length,
              offset,
              segments: structuredClone(
                transcript.slice(offset, offset + Math.min(args.limit ?? 50, 2)),
              ),
            };
          }
          if (method === "media.render")
            throw Error("Canonical export must not use legacy media.render");
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
    { seed, pictureId, recordingId, transcript, transcriptionAvailable },
  );
  await page.goto(`${url}/?legacyWorkspace=1`);
  await enterLegacyProduction(page);
  await page.waitForFunction(
    (id) => window.__panelTools?.read_video_project().preparation[id],
    recordingId,
  );
  await page.locator('[data-tab="ai"]').click();
  return { page, context };
}

const readState = (page) => page.evaluate(() => window.__panelTools.read_video_project());
const hostCalls = (page, names) =>
  page.evaluate((names) => window.__calls.filter(({ method }) => names.includes(method)), names);
async function callTool(page, name, args = {}) {
  return page.evaluate(
    async ({ name, args }) => {
      const state = window.__panelTools.read_video_project();
      return window.__panelTools[name]({
        projectId: state.project.id,
        requestToken: state.requestToken,
        baseRevision: state.project.revision,
        ...args,
      });
    },
    { name, args },
  );
}
const apply = (page, operations, title = "口播流程测试修改") =>
  callTool(page, "apply_video_edit", { title, operations });
const review = (page, value = sheet) => apply(page, [{ type: "workflow", workflow: value }]);

async function beginDraft(page) {
  await page.locator("#ai-prompt").fill("用这些素材和我的想法写文案、剪草稿。我确认后再自己录音。");
  await page.locator('[data-action="ask-draft"]').click();
  await page.waitForFunction(() => window.__panelTools.read_video_project().requestToken);
  assert.equal((await readState(page)).workflowMode, "draft");
}

async function finishDraft(page) {
  await callTool(page, "set_video_script", { text: script, finish: false });
  await apply(
    page,
    transcript.map((segment, index) => ({
      type: "caption",
      caption: {
        id: `draft-narration-${index + 1}`,
        startFrame: index * 90,
        endFrame: index * 90 + 85,
        text: segment.text,
      },
    })),
  );
  await review(page);
  await page.waitForFunction(
    () => window.__documents["video-studio-production"].data.auto.phase === "done",
  );
  await page.evaluate(() => window.__completeTask());
  assert.equal((await readState(page)).requestToken, null);
}

async function approveAndBind(page) {
  await page.locator('[data-action="approve-draft"]').click();
  await page.locator("#recording-script").waitFor();
  assert.equal(await page.locator("#recording-script").inputValue(), script);
  assert.equal(await page.evaluate(() => window.__deviceRequests), 0);
  await page.locator('[data-tab="ai"]').click();
  await page.locator("#narration-recording-asset").selectOption("personal-recording");
  await page.locator('[data-action="bind-narration-recording"]').click();
  await page.waitForFunction(
    () => window.__panelTools.read_video_project().project.narration?.phase === "recorded",
  );
}

test(
  "draft guards stop before narration; user approval persists and manual edits invalidate it",
  { timeout: 40_000 },
  async () => {
    const { page, context } = await openPage();
    try {
      await beginDraft(page);
      const task = await page.evaluate(() => window.__taskCalls[0]);
      assert.equal(task.skill, "video-studio:narration-workflow");
      assert.ok(task.skills.includes("video-studio:video-production"));
      const before = (await readState(page)).project;
      for (const [name, args] of [
        ["create_video_voiceover", { text: "不得自动替换本人声音" }],
        ["render_video_project", {}],
        [
          "propose_video_edit",
          {
            title: "不能绕过阶段",
            operations: [{ type: "volume", clipId: "picture-clip", volume: 0 }],
          },
        ],
        ["set_video_script", { text: "文稿不能提前结束草稿任务", finish: true }],
      ])
        await assert.rejects(callTool(page, name, args));
      await assert.rejects(review(page), /文稿|文案|草稿/);
      assert.deepEqual((await readState(page)).project, before);
      await finishDraft(page);
      const draft = (await readState(page)).project;
      assert.equal(draft.narration.phase, "review");
      assert.equal(draft.narration.captionBasis, "draft");
      assert.equal(draft.narration.approvedFingerprint, undefined);
      assert.equal(draft.narration.draftCaptionIds.length, 3);
      assert.equal(await page.locator("#narration-script").inputValue(), script);
      assert.match(await page.locator(".narration-caption-basis").innerText(), /临时|估算/);
      assert.deepEqual(await hostCalls(page, ["media.tts", "media.render"]), []);
      await page.locator('[data-action="approve-draft"]').click();
      await page.locator("#recording-script").waitFor();
      const approved = (await readState(page)).project;
      assert.equal(approved.narration.phase, "approved");
      assert.equal(approved.narration.approvedScript, script);
      assert.match(approved.narration.approvedFingerprint, /^[a-f0-9]{64}$/);
      assert.equal(await page.evaluate(() => window.__deviceRequests), 0);
      await page.reload();
      await enterLegacyProduction(page);
      await page.waitForFunction(() => window.__panelTools?.read_video_project().project.narration);
      await page.locator('[data-tab="ai"]').click();
      assert.deepEqual((await readState(page)).project.narration, approved.narration);
      assert.deepEqual(await hostCalls(page, ["agent.task.start", "media.prepare"]), []);
      await page.locator("#narration-script").fill(script + "\n这是用户补充的新意思。");
      assert.equal(await page.locator('[data-action="record-narration"]').isDisabled(), true);
      await page.locator('[data-action="save-narration-script"]').click();
      await page
        .waitForFunction(
          () => window.__panelTools.read_video_project().project.narration.phase === "review",
        )
        .catch(async (error) => {
          throw new Error(
            error.message +
              "\n" +
              JSON.stringify(
                await page.evaluate(() => ({
                  toast: document.querySelector("#toast").textContent,
                  project: window.__panelTools.read_video_project().project,
                })),
              ),
          );
        });
      const changed = (await readState(page)).project;
      assert.equal(changed.narration.approvedFingerprint, undefined);
      assert.equal(changed.narration.approvedScript, undefined);
      assert.deepEqual(changed.assets, approved.assets);
      assert.deepEqual(changed.clips, approved.clips);
      assert.deepEqual(
        changed.captions.find((caption) => caption.id === titleCaption.id),
        titleCaption,
      );
      const updatedDraft = changed.captions.filter((caption) =>
        changed.narration.draftCaptionIds.includes(caption.id),
      );
      assert.equal(
        updatedDraft.map((caption) => caption.text).join(""),
        (script + "这是用户补充的新意思。").replace(/\n/g, ""),
      );
      assert.equal(changed.narration.captionBasis, "draft");
      assert.ok(
        updatedDraft.every((caption) => caption.startFrame >= 0 && caption.endFrame <= 300),
      );
      assert.equal(await page.evaluate(() => window.__deviceRequests), 0);
      await page.screenshot({
        path: resolve(artifacts, "draft-review-after-edit.png"),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  },
);

test(
  "selected recording preparation preserves approval; truncated speech is rejected before real caption alignment and export",
  { timeout: 45_000 },
  async () => {
    const { page, context } = await openPage();
    try {
      const initialDocument = await readSavedEditorDocument(page);
      const sourceClip = initialDocument.sequences[0].clips.find(
        (clip) => clip.id === "picture-clip",
      );
      await page.evaluate(
        async ({ sequenceId, clipId, transform, color }) => {
          const tools = window.__panelTools;
          const identity = tools.read_video_project({ editor: { view: "project" } }).identity;
          await tools.apply_video_edit({
            editor: {
              identity,
              label: "保留新版画面属性",
              steps: [
                {
                  kind: "operations",
                  operations: [
                    { type: "clip.update", sequenceId, clipId, patch: { transform, color } },
                  ],
                },
              ],
            },
          });
        },
        {
          sequenceId: initialDocument.activeSequenceId,
          clipId: sourceClip.id,
          transform: { ...sourceClip.transform, rotation: 17, scaleX: 0.83 },
          color: { ...sourceClip.color, exposure: 0.4 },
        },
      );
      await beginDraft(page);
      await finishDraft(page);
      await approveAndBind(page);
      const beforePreparation = (await readState(page)).project;
      await page.locator('[data-action="align-narration"]').click();
      await page.waitForFunction(
        () =>
          window.__documents["video-studio-production"].data.auto.preparationJobIds?.length === 1,
      );
      const preparations = await hostCalls(page, ["media.prepare"]);
      assert.equal(preparations.length, 1);
      assert.deepEqual(preparations[0].args.assetIds, [recordingId]);
      assert.equal(preparations[0].args.transcribe, true);
      assert.equal(await page.evaluate(() => window.__taskCalls.length), 1);
      await page.evaluate(() => {
        const id = window.__documents["video-studio-production"].data.auto.preparationJobIds[0];
        window.__completePreparation(id);
      });
      await page.waitForFunction(
        () =>
          window.__taskCalls.length === 2 && window.__panelTools.read_video_project().requestToken,
      );
      const afterPreparation = await readState(page);
      assert.equal(afterPreparation.workflowMode, "narration");
      assert.equal(afterPreparation.project.narration.phase, "recorded");
      assert.equal(
        afterPreparation.project.narration.approvedFingerprint,
        beforePreparation.narration.approvedFingerprint,
      );
      assert.ok(afterPreparation.project.revision > beforePreparation.revision);
      assert.equal(afterPreparation.project.narration.recordingAssetId, "personal-recording");
      for (const [name, args] of [
        ["render_video_project", {}],
        ["create_video_voiceover", { text: "不能合成人声" }],
        ["set_video_script", { text: "不能修改已确认文稿", finish: false }],
      ])
        await assert.rejects(callTool(page, name, args));
      await apply(page, [
        {
          type: "audio-add",
          assetId: "personal-recording",
          inFrame: 0,
          outFrame: 300,
          startFrame: 0,
          volume: 1,
        },
      ]);
      const truncated = (await readState(page)).project;
      await assert.rejects(review(page), /完整|尾句|说话/);
      assert.deepEqual((await readState(page)).project, truncated, "failed completion is atomic");
      assert.deepEqual(await hostCalls(page, ["media.render", "media.tts"]), []);
      await apply(page, [{ type: "trim", clipId: "picture-clip", inFrame: 0, outFrame: 780 }]);
      const extended = (await readState(page)).project;
      assert.equal(extended.narration.phase, "recorded");
      assert.match(extended.narration.alignmentFingerprint, /^[a-f0-9]{64}$/);
      assert.notEqual(
        extended.narration.alignmentFingerprint,
        extended.narration.approvedFingerprint,
      );
      const audioId = extended.audioClips[0].id;
      await apply(page, [{ type: "audio-trim", clipId: audioId, inFrame: 0, outFrame: 720 }]);
      await apply(page, [{ type: "audio-move", clipId: audioId, startFrame: 30 }]);
      assert.equal((await readState(page)).project.narration.phase, "recorded");
      await review(page);
      const aligned = (await readState(page)).project;
      assert.equal(aligned.narration.phase, "aligned");
      assert.equal(aligned.narration.captionBasis, "recording");
      assert.equal(aligned.narration.approvedScript, script);
      assert.equal(aligned.audioClips[0].outFrame, 720);
      assert.deepEqual(
        aligned.captions.find((caption) => caption.id === titleCaption.id),
        titleCaption,
      );
      assert.equal(
        aligned.captions.filter((caption) => caption.id.startsWith("draft-narration-")).length,
        0,
      );
      const actual = aligned.captions.filter((caption) =>
        caption.id.startsWith("recorded-narration-"),
      );
      assert.deepEqual(
        actual.map(({ text, startFrame, endFrame }) => ({ text, startFrame, endFrame })),
        transcript.map((segment) => ({
          text: segment.text,
          startFrame: segment.start * 30 + 30,
          endFrame: segment.end * 30 + 30,
        })),
      );
      const transcriptCalls = await hostCalls(page, ["media.transcript"]);
      assert.ok(
        transcriptCalls.some((call) => call.args.offset === 2),
        "completion reads all ASR pages, including the late ending",
      );
      await page.screenshot({
        path: resolve(artifacts, "real-recording-aligned.png"),
        fullPage: true,
      });
      const receipt = await callTool(page, "render_video_project");
      assert.equal(receipt.accepted, true);
      assert.equal(receipt.status, "preparing");
      assert.equal(receipt.jobId, undefined, "Admission never fabricates a native job ID");
      await page.waitForFunction(async (operationId) => {
        const state = await window.__panelTools.read_video_project({
          view: "jobs",
          jobIds: [operationId],
        });
        return state.operations?.[0]?.jobId;
      }, receipt.operationId);
      const job = await page.evaluate(async (operationId) => {
        const state = await window.__panelTools.read_video_project({
          view: "jobs",
          jobIds: [operationId],
        });
        return state.jobs.find((job) => job.id === state.operations[0].jobId);
      }, receipt.operationId);
      assert.equal(job.type, "render");
      assert.deepEqual(await hostCalls(page, ["media.render"]), []);
      const canonical = await readSavedEditorDocument(page);
      const requests = await page.evaluate(() => window.__editorRenderRequests);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].document.schemaVersion, 2);
      assert.equal(requests[0].document.id, canonical.id);
      assert.equal(requests[0].document.revision, canonical.revision);
      assert.deepEqual(requests[0].document.sequences, canonical.sequences);
      const renderedSource = requests[0].document.sequences[0].clips.find(
        (clip) => clip.id === "picture-clip",
      );
      assert.equal(renderedSource.transform.rotation, 17);
      assert.equal(renderedSource.transform.scaleX, 0.83);
      assert.equal(renderedSource.color.exposure, 0.4);
      assert.equal(
        requests[0].document.assets.find((asset) => asset.id === "personal-recording").resourceId,
        recordingId,
      );
      const starts = await page.evaluate(() =>
        window.__genericHostCalls
          .filter((call) => call.method === "tasks.start" && call.args.entry === "editor-runtime")
          .map((call) => call.args),
      );
      assert.deepEqual(
        starts
          .map((args) => args.input.request.action)
          .filter((action) =>
            ["stage-status", "stage-resources", "stage-document", "commit", "render"].includes(
              action,
            ),
          ),
        ["stage-status", "stage-resources", "stage-document", "commit", "render"],
      );
      for (const args of starts.filter(
        (args) => args.input.request.transferId === requests[0].request.transferId,
      )) {
        assert.match(args.input.request.transferId, /^editor-[a-f0-9-]{36}$/);
        assert.equal(args.recovery, "retry");
        if (args.input.request.documentHash)
          assert.equal(args.input.request.documentHash, requests[0].request.documentHash);
      }
      await page.evaluate(
        (id) =>
          window.__completeEditorRender(id, {
            id: `asset-${"e".repeat(64)}`,
            sha256: "e".repeat(64),
            name: "Host导出结果状态夹具.mp4",
            mimeType: "video/mp4",
            bytes: 1024,
          }),
        job.id,
      );
      await page.evaluate(() => window.__completeTask());
      await page.waitForFunction(
        () => window.__documents["video-studio-production"].data.auto.phase === "done",
      );
      await page.locator('[data-tab="ai"]').click();
      await page.locator("#narration-recording-asset").selectOption("other-audio");
      await page.locator('[data-action="bind-narration-recording"]').click();
      await page.waitForFunction(
        () =>
          window.__panelTools.read_video_project().project.narration.recordingAssetId ===
          "other-audio",
      );
      const replacement = (await readState(page)).project;
      assert.equal(replacement.narration.phase, "recorded");
      assert.equal(
        replacement.narration.approvedFingerprint,
        aligned.narration.approvedFingerprint,
      );
      assert.notEqual(
        replacement.narration.alignmentFingerprint,
        aligned.narration.alignmentFingerprint,
      );
      assert.deepEqual(
        replacement.assets,
        aligned.assets,
        "replacing a take retains both source files",
      );
      assert.equal(
        replacement.audioClips.filter((clip) => clip.assetId === "personal-recording").length,
        0,
        "the previous take cannot keep playing below the replacement",
      );
      assert.equal(
        replacement.captions.some((caption) => caption.id.startsWith("recorded-narration-")),
        false,
      );
      assert.deepEqual(
        replacement.captions.find((caption) => caption.id === titleCaption.id),
        titleCaption,
      );
      assert.equal(await page.evaluate(() => window.__deviceRequests), 0);
    } finally {
      await context.close();
    }
  },
);

test(
  "missing transcription keeps the approved draft and selected recording without fake captions or export",
  { timeout: 35_000 },
  async () => {
    const { page, context } = await openPage({ transcriptionAvailable: false });
    try {
      await beginDraft(page);
      await finishDraft(page);
      await approveAndBind(page);
      const before = (await readState(page)).project;
      await page.locator('[data-action="align-narration"]').click();
      await page.waitForFunction(() =>
        document.body.textContent.includes(
          "点“重新检测”，再重试本人录音对齐；录音和草稿已保留。",
        ) && document.body.textContent.includes("本机语音转写未就绪"),
      );
      const after = (await readState(page)).project;
      assert.deepEqual(after, before);
      assert.equal(after.narration.phase, "recorded");
      assert.equal(after.narration.captionBasis, "draft");
      assert.deepEqual(
        await hostCalls(page, ["media.prepare", "media.transcript", "media.render", "media.tts"]),
        [],
      );
      assert.equal(await page.evaluate(() => window.__taskCalls.length), 1);
      assert.equal(await page.evaluate(() => window.__deviceRequests), 0);
    } finally {
      await context.close();
    }
  },
);
