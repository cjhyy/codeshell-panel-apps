import { installGenericMediaTaskMock } from "./helpers/video-studio-generic-task.mjs";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";
import { installLocalVoiceProcessMock } from "./helpers/video-studio-local-voice-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "panels/video-studio/app");
const artifacts = resolve(root, "artifacts/video-studio");
const sourceId = "asset-" + "a".repeat(64),
  sampleId = "asset-" + "b".repeat(64),
  extractedId = "asset-" + "c".repeat(64);
let browser, server, url;
const errors = [];
before(async () => {
  if (process.env.VIDEO_STUDIO_SKIP_BUILD !== "1") {
    const [project] = selectProjects(await discoverProjects(), "video-studio");
    await buildProject(project);
  }
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
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'",
      });
      response.end(await readFile(path));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  assert.deepEqual(errors, [], "No app runtime or CSP errors");
});

async function pageWithHost({ width = 1440, installed = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 960 } });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text()))
      errors.push(message.text());
  });
  await page.addInitScript(installGenericMediaTaskMock);
  await page.addInitScript(installLocalVoiceProcessMock, {
    outputAssetId: sampleId,
    durationSeconds: 24,
    installed,
  });
  await page.addInitScript(() => {
    window.__deviceRequests = [];
    window.__deviceRequestUrls = [];
    window.__capturedTracks = [];
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__deviceRequests.push(structuredClone(constraints));
      window.__deviceRequestUrls.push(location.href);
      // The desktop permission boundary rejects a Panel URL with a fragment.
      // Keep this guard around the real browser acquisition, not a fake stream.
      if (location.hash) throw new DOMException("Panel URL contains a hash", "NotAllowedError");
      const stream = await acquire(constraints);
      window.__capturedTracks.push(...stream.getTracks());
      return stream;
    };
  });
  // Jobs, installation and Agent calls are simulated at the Host boundary;
  // the full controller/UI run unchanged and audio playback decodes a real MP3.
  // This suite checks integration, not the naturalness of model-generated speech.
  await page.addInitScript(
    ({ sourceId, sampleId, extractedId }) => {
      const initial = {
        schemaVersion: 1,
        id: "voice-preparation-project",
        name: "本人声音准备",
        revision: 0,
        width: 1280,
        height: 720,
        fps: 30,
        assets: [
          {
            id: "reference-project-asset",
            mediaId: sourceId,
            name: "本人参考录音.mp3",
            kind: "audio",
            durationFrames: 720,
          },
        ],
        clips: [],
        captions: [],
      };
      const documents = JSON.parse(
        localStorage.getItem("voice-test-documents") ||
          JSON.stringify({ "video-studio-current": { revision: 1, data: initial } }),
      );
      const storage = JSON.parse(localStorage.getItem("voice-test-storage") || "{}");
      const jobs = JSON.parse(localStorage.getItem("voice-test-jobs") || "{}");
      const inputs = JSON.parse(localStorage.getItem("voice-test-inputs") || "{}");
      const tasks = JSON.parse(localStorage.getItem("voice-test-tasks") || "{}");
      let installed = localStorage.getItem("voice-test-installed") === "yes";
      window.__panelTools = {};
      window.__events = {};
      window.__calls = [];
      window.__documents = documents;
      window.__failVoiceSave = false;
      const persist = () => {
        for (const [key, value] of Object.entries({ documents, storage, jobs, inputs, tasks }))
          localStorage.setItem(`voice-test-${key}`, JSON.stringify(value));
        localStorage.setItem("voice-test-installed", installed ? "yes" : "no");
      };
      const asset = (id) => ({
        id,
        name:
          id === sourceId
            ? "本人参考录音.mp3"
            : id === sampleId
              ? "Audio8 真实试听.mp3"
              : "提取参考.mp3",
        mimeType: "audio/mpeg",
        bytes: 384865,
        createdAt: 1,
      });
      const preparation = (id) => ({
        assetId: id,
        inspection: {
          kind: "audio",
          durationSeconds: id === extractedId ? 5 : 24,
          audio: { codec: "mp3", sampleRate: 48000, channels: 1 },
        },
        preparedAt: 1,
      });
      const catalog = () => ({
        available: installed,
        defaultModelId: "audio8-tts",
        voices: [],
        models: ["audio8-tts", "qwen3-tts"].map((id) => ({
          id,
          name: id === "audio8-tts" ? "Audio8 · 本人声音" : "Qwen3-TTS · 本人声音",
          provider: id,
          available: installed,
          installable: true,
          state: installed ? "ready" : "not-installed",
          mode: "offline",
          supportsVoiceCloning: true,
          maxTextLength: 2000,
          defaultVoiceId: "reference",
          voices: [{ id: "reference", name: "本人参考声音", language: "zh-CN" }],
        })),
      });
      const start = (type, input) => {
        const task = {
          id: `job-${type}-${Object.keys(jobs).length + 1}`,
          type,
          status: "queued",
          attempt: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        jobs[task.id] = task;
        inputs[task.id] = structuredClone(input);
        persist();
        return structuredClone(task);
      };
      window.__completeVoiceJob = (type, failure = "") => {
        const task = Object.values(jobs).find(
          (job) => job.type === type && job.status === "queued",
        );
        if (!task) throw Error("No queued job " + type);
        task.status = failure ? "failed" : "succeeded";
        task.updatedAt++;
        if (failure) task.error = { code: "TEST_FAILURE", message: failure, retryable: true };
        else if (type === "tts-setup") {
          installed = true;
          task.result = { providerId: "audio8-tts", available: true };
        } else if (type === "audio-extract")
          task.result = {
            asset: asset(extractedId),
            inspection: preparation(extractedId).inspection,
          };
        else {
          const input = inputs[task.id];
          task.result = {
            asset: asset(sampleId),
            inspection: preparation(sampleId).inspection,
            speech: {
              text: input.text,
              modelId: input.modelId,
              engine: "audio8-tts",
              voiceId: "reference",
              rate: input.rate,
              referenceAssetId: input.referenceAssetId,
              referenceText: input.referenceText,
            },
          };
        }
        persist();
        window.__events["media.job.changed"]?.(structuredClone(task));
      };
      window.codeshellPanel = {
        getContext: async () => ({ cwd: "/isolated/audio8-ui", theme: "dark" }),
        registerTool(name, fn) {
          window.__panelTools[name] = fn;
          return () => {};
        },
        on(name, fn) {
          window.__events[name] = fn;
          return () => {};
        },
        async call(method, args = {}) {
          window.__calls.push({ method, args: structuredClone(args) });
          if (method === "media.status")
            return {
              persistent: true,
              ffmpeg: { available: true },
              transcription: { available: false },
              hyperframes: { available: true },
              tts: catalog(),
            };
          if (method === "media.tts.voices") return catalog();
          if (method === "media.tts.setup" || method === "media.tts")
            throw Error("Local engines must use the generic process boundary");
          if (method === "media.audio.extract") return start("audio-extract", args);
          if (method === "storage.get") return structuredClone(storage[args.key] ?? null);
          if (method === "storage.set") {
            if (window.__failVoiceSave && (
              args.key.startsWith("video-studio-voice-preparation") ||
              args.key === "video-studio-voice-library-v1"
            ))
              throw Error("声音保存失败：模拟磁盘已满");
            storage[args.key] = structuredClone(args.value);
            persist();
            return true;
          }
          if (method === "media.document.get")
            return structuredClone(documents[args.key] ?? { revision: 0, data: null });
          if (method === "media.document.set") {
            if (
              window.__failExtractedPublication &&
              args.key === "video-studio-current" &&
              args.data.assets?.some((item) => item.mediaId === extractedId)
            )
              throw Error("参考录音已截取，工程保存失败：模拟磁盘已满");
            if ((documents[args.key]?.revision ?? 0) !== args.baseRevision)
              throw Error("Document revision conflict");
            const next = {
              revision: args.baseRevision + 1,
              data: structuredClone(args.data),
              updatedAt: Date.now(),
            };
            documents[args.key] = next;
            persist();
            return structuredClone(next);
          }
          if (method === "media.document.versions") return [];
          if (method === "media.jobs.list")
            return {
              jobs: Object.values(jobs).map(({ result, ...job }) => job),
              total: Object.keys(jobs).length,
            };
          if (method === "media.jobs.get") return structuredClone(jobs[args.id]);
          if (method === "media.assets.get")
            return { asset: asset(args.id), preparation: preparation(args.id) };
          if (method === "agent.task.start") {
            const task = { id: "agent-voice-init", status: "running" };
            tasks[task.id] = task;
            persist();
            return task;
          }
          if (method === "agent.task.get") return structuredClone(tasks[args.id]);
          if (method === "agent.task.cancel") {
            tasks[args.id].status = "cancelled";
            persist();
            return structuredClone(tasks[args.id]);
          }
          if (method === "media.jobs.cancel") {
            jobs[args.id].status = "cancelled";
            persist();
            return structuredClone(jobs[args.id]);
          }
          throw Error("Unexpected Host method: " + method);
        },
      };
      // Install fault injection before the real Panel bridge captures its call function.
      const genericCall = window.codeshellPanel.call.bind(window.codeshellPanel);
      window.codeshellPanel.call = async (method, args) => {
        if (method === "resources.upload.begin" && window.__failReferenceUpload)
          throw Error("参考录音上传失败：模拟磁盘已满");
        return genericCall(method, args);
      };
    },
    { sourceId, sampleId, extractedId },
  );
  await page.goto(url);
  await page.waitForFunction(
    () => window.__panelTools.read_video_project?.().project.id === "voice-preparation-project",
  );
  return page;
}
const project = (page) => page.evaluate(() => window.__panelTools.read_video_project().project);
const call = (page, method) =>
  page.evaluate((method) => window.__calls.filter((item) => item.method === method), method);

test(
  "initialization uses the chosen Audio8 reference, prepares a real sample without a track, and restores a confirmed recipe",
  { timeout: 60_000 },
  async () => {
    const page = await pageWithHost();
    try {
      await page.locator('[data-tab="ai"]').click();
      await page.locator("#voice-prep-model").selectOption("audio8-tts");
      assert.equal(await page.locator('[data-action="voice-prep-sample"]').isDisabled(), true);
      assert.match(await page.locator(".voice-preparation").textContent(), /声音：尚未验证/);
      await page.locator("#voice-prep-reference").selectOption("reference-project-asset");
      await page.locator("#voice-prep-transcript").fill("这是我本人录下的参考声音。");
      await page.locator("#voice-prep-sample").fill("你好，这是我的自然中文声音。");
      await page.locator('[data-action="initialize-video"]').click();
      await page.waitForFunction(
        () => window.__documents["video-studio-production"]?.data.auto?.phase === "agent",
      );
      const auto = await page.evaluate(
        () => window.__documents["video-studio-production"].data.auto,
      );
      assert.equal(auto.mode, "initialize");
      assert.deepEqual(auto.voice, {
        modelId: "audio8-tts",
        referenceAssetId: "reference-project-asset",
        referenceText: "这是我本人录下的参考声音。",
        sampleText: "你好，这是我的自然中文声音。",
      });
      const before = await project(page);
      await page.locator('[data-action="voice-prep-setup"]').click();
      await page.waitForFunction(() =>
        window.__voiceRuntimeRequests.some((request) => request.action === "setup"),
      );
      assert.deepEqual(
        await page.evaluate(
          () =>
            window.__genericHostCalls.find(
              (call) =>
                call.method === "tasks.start" && call.args.input.request.action === "tts-setup",
            ).args.input.request.params,
        ),
        { providerId: "audio8-tts" },
      );
      assert.equal((await call(page, "media.tts.setup")).length, 0);
      assert.equal(await page.locator('[data-action="voice-prep-setup"]').isDisabled(), true);
      assert.equal(await page.locator("#voice-prep-model").isDisabled(), true);
      await page.locator('[data-action="voice-prep-setup"]').evaluate((button) => button.click());
      assert.equal(
        await page.evaluate(
          () => window.__voiceRuntimeRequests.filter((r) => r.action === "setup").length,
        ),
        1,
      );
      await page.evaluate(() => window.__completeLocalVoice("setup"));
      await page.waitForFunction(
        () => !document.querySelector('[data-action="voice-prep-sample"]')?.disabled,
      );
      await page.locator('[data-action="voice-prep-sample"]').click();
      await page.waitForFunction(() =>
        window.__voiceRuntimeRequests.some((request) => request.action === "generate"),
      );
      assert.deepEqual(
        await page.evaluate(
          () =>
            window.__genericHostCalls.find(
              (call) =>
                call.method === "tasks.start" && call.args.input.request.action === "tts-clone",
            ).args.input.request.params,
        ),
        {
          modelId: "audio8-tts",
          voiceId: "reference",
          text: "你好，这是我的自然中文声音。",
          rate: 1,
          referenceAssetId: sourceId,
          referenceText: "这是我本人录下的参考声音。",
        },
      );
      assert.equal((await call(page, "media.tts")).length, 0);
      assert.equal(await page.locator('[data-action="voice-prep-sample"]').isDisabled(), true);
      assert.equal(await page.locator("#voice-prep-reference").isDisabled(), true);
      await page.locator('[data-action="voice-prep-sample"]').evaluate((button) => button.click());
      assert.equal(
        await page.evaluate(
          () => window.__voiceRuntimeRequests.filter((r) => r.action === "generate").length,
        ),
        1,
      );
      await page.evaluate(() => window.__completeLocalVoice("generate"));
      await page.locator('audio[aria-label="本人声音真实试听"]').waitFor();
      const after = await project(page);
      assert.equal(after.assets.length, before.assets.length + 1);
      assert.deepEqual(after.clips, before.clips);
      assert.deepEqual(after.audioClips, before.audioClips);
      assert.ok(
        await page.evaluate(
          () =>
            window.__nativeCaptures.length === 1 &&
            window.__genericHostCalls.some((call) => call.method === "tasks.get"),
        ),
        "The local WAV is published through the generic task artifact capture contract",
      );
      const audio = page.locator('audio[aria-label="本人声音真实试听"]');
      const original = page.locator("#voice-prep-reference-audio");
      await original.evaluate((element) => element.play());
      await page.waitForFunction(
        () => document.querySelector("#voice-prep-reference-audio")?.currentTime > 0,
      );
      await audio.evaluate((audio) => audio.play());
      await page.waitForFunction(
        () => document.querySelector('audio[aria-label="本人声音真实试听"]')?.currentTime > 0,
      );
      assert.equal(
        await original.evaluate((element) => element.paused),
        true,
        "The generated sample pauses the original recording",
      );
      await original.evaluate((element) => element.play());
      assert.equal(
        await audio.evaluate((element) => element.paused),
        true,
        "The original recording pauses the generated sample",
      );
      await original.evaluate((element) => element.pause());
      await audio.evaluate((audio) => audio.pause());
      await page.locator("#voice-prep-confirmed").check();
      await page.locator("#voice-prep-name").fill("我的自然中文");
      await page.evaluate(() => {
        window.__failVoiceSave = true;
      });
      await page.locator('[data-action="voice-prep-save"]').click();
      assert.equal(await page.locator(".voice-preparation-recipes").count(), 0);
      assert.match(await page.locator(".voice-preparation").textContent(), /模拟磁盘已满/);
      await page.evaluate(() => {
        window.__failVoiceSave = false;
      });
      await page.locator('[data-action="voice-prep-save"]').click();
      await page.locator("#voiceover-model").waitFor();
      assert.equal(await page.locator("#voiceover-model").inputValue(), "audio8-tts");
      assert.equal(
        await page.locator("#voiceover-reference").inputValue(),
        "reference-project-asset",
      );
      assert.equal(
        await page.locator("#voiceover-reference-text").inputValue(),
        "这是我本人录下的参考声音。",
      );
      await page.locator("#voiceover-text").fill("这是确认声线后，准备生成的完整视频旁白。");
      assert.equal(
        await page.locator("#voiceover-text").inputValue(),
        "这是确认声线后，准备生成的完整视频旁白。",
      );
      await page.reload();
      await page.locator('[data-tab="ai"]').click();
      await page.locator(".voice-preparation-recipes").waitFor();
      assert.equal(await page.locator("#voice-prep-model").inputValue(), "audio8-tts");
      assert.equal(
        await page.locator("#voice-prep-transcript").inputValue(),
        "这是我本人录下的参考声音。",
      );
      await page.locator('[data-action="voice-prep-use"]').click();
      assert.equal(await page.locator("#voiceover-model").inputValue(), "audio8-tts");
      assert.equal(
        await page.locator("#voiceover-reference").inputValue(),
        "reference-project-asset",
      );
      await page.locator(".voice-preparation-disclosure > summary").click();
      await audio.waitFor();
      await audio.evaluate((audio) => audio.play());
      await page.locator('[data-action="voice-prep-retry"]').click();
      await page.waitForFunction(() => {
        const audio = document.querySelector('audio[aria-label="本人声音真实试听"]');
        return audio && !audio.paused && audio.currentTime > 0.3;
      });
      await audio.evaluate((audio) => audio.pause());
      await page.locator(".voice-preparation h3").click();
      await page.screenshot({
        path: resolve(artifacts, "audio8-voice-preparation.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 640, height: 960 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.locator(".voice-preparation-disclosure > summary").click();
      await page.screenshot({
        path: resolve(artifacts, "audio8-voice-preparation-mobile.png"),
        fullPage: true,
      });
      await page.locator('[data-action="new"]').click();
      await page.waitForFunction(
        () => window.__panelTools.read_video_project().project.id !== "voice-preparation-project",
      );
      await page.locator('[data-tab="ai"]').click();
      await page.locator(".voice-preparation-recipes").waitFor();
      assert.equal(await page.locator("#voice-prep-model").inputValue(), "");
      const newProject = await project(page);
      await page.locator('[data-action="voice-prep-use"]').click();
      await page.waitForFunction(() =>
        window.__panelTools.read_video_project().project.assets.some((asset) =>
          asset.kind === "audio" && asset.mediaId === "asset-" + "a".repeat(64)),
      ).catch(async (error) => {
        console.error("Voice reuse state:", await page.locator(".voice-preparation").textContent());
        console.error("Voice reuse calls:", await page.evaluate(() => window.__calls.slice(-8)));
        throw error;
      });
      const reusedProject = await project(page);
      assert.equal(reusedProject.id, newProject.id);
      assert.deepEqual(reusedProject.clips, newProject.clips);
      assert.deepEqual(reusedProject.audioClips, newProject.audioClips);
      assert.equal(await page.locator("#voiceover-reference-text").inputValue(), "这是我本人录下的参考声音。");
      assert.equal(await page.locator("#voiceover-model").inputValue(), "audio8-tts");
    } finally {
      await page.close();
    }
  },
);

test(
  "rough-cut reference action extracts the chosen source range and only selects the resulting saved audio",
  { timeout: 30_000 },
  async () => {
    const page = await pageWithHost();
    try {
      await page.locator('[data-rough-source="reference-project-asset"]').click();
      await page.locator("#roughcut-in").fill("1");
      await page.locator("#roughcut-out").fill("6");
      const before = await project(page);
      await page.locator('[data-action="roughcut-reference"]').click();
      assert.deepEqual((await call(page, "media.audio.extract"))[0].args, {
        assetId: sourceId,
        inFrame: 30,
        outFrame: 180,
        fps: 30,
      });
      assert.deepEqual(
        await project(page),
        before,
        "A requested range is not yet a real extracted file",
      );
      await page.evaluate(() => window.__completeVoiceJob("audio-extract"));
      await page.waitForFunction(
        () =>
          document.querySelector("#voice-prep-reference")?.value &&
          document.querySelector("#voice-prep-reference")?.value !== "reference-project-asset",
      );
      const after = await project(page);
      const extracted = after.assets.find((asset) => asset.mediaId === extractedId);
      assert.ok(extracted);
      assert.equal(await page.locator("#voice-prep-reference").inputValue(), extracted.id);
      assert.equal(await page.locator("#voiceover-reference").inputValue(), extracted.id);
      assert.equal(await page.locator("#voice-prep-transcript").inputValue(), "");
      const recording = page.locator(`[data-voice-reference-asset="${extracted.id}"]`);
      assert.match(await recording.textContent(), new RegExp(extracted.name));
      assert.match(await recording.textContent(), /5\.0 秒 · 已保存到素材库/);
      const original = page.locator("#voice-prep-reference-audio");
      await original.evaluate((element) => element.play());
      await page.waitForFunction(
        () => document.querySelector("#voice-prep-reference-audio")?.currentTime > 0,
      );
      assert.equal(await page.locator('audio[aria-label="本人声音真实试听"]').count(), 0);
      await page.locator('[data-action="voice-prep-show-reference"]').click();
      await page.locator(`[data-preview-asset="${extracted.id}"]`).waitFor();
      assert.equal(await page.locator('[data-tab="media"].active').count(), 1);
      assert.equal(await page.locator("#preview").getAttribute("aria-label"), "原素材画面");
      assert.equal(await page.locator(`[data-select-media="${extracted.id}"]`).isChecked(), true);
      assert.deepEqual(after.clips, before.clips);
      assert.deepEqual(after.audioClips, before.audioClips);
      assert.equal((await call(page, "media.tts")).length, 0);
    } finally {
      await page.close();
    }
  },
);

test(
  "a completed extraction without a saved asset exposes recovery and ending preparation, then saves its original result",
  { timeout: 30_000 },
  async () => {
    const page = await pageWithHost();
    try {
      await page.locator('[data-rough-source="reference-project-asset"]').click();
      await page.locator("#roughcut-in").fill("1");
      await page.locator("#roughcut-out").fill("6");
      const before = await project(page);
      await page.locator('[data-action="roughcut-reference"]').click();
      await page.waitForFunction(() => {
        const records = JSON.parse(localStorage.getItem("voice-test-storage") || "{}");
        return (
          records["video-studio-voice-preparation-voice-preparation-project"]?.pending?.kind ===
          "extract"
        );
      });
      await page.evaluate(() => {
        window.__failExtractedPublication = true;
        window.__completeVoiceJob("audio-extract");
      });
      const recover = page.locator('[data-action="voice-prep-recover-extract"]');
      await recover.waitFor();
      assert.equal(await recover.isEnabled(), true);
      assert.equal(
        await page.locator('[data-action="voice-prep-dismiss-extract"]').isEnabled(),
        true,
      );
      assert.match(
        await page.locator(".voice-guide-progress").textContent(),
        /录音已截取，尚未保存到当前工程/,
      );
      assert.equal(await page.locator("#voice-prep-model").isDisabled(), true);
      assert.deepEqual(
        await project(page),
        before,
        "A completed task has not yet published its asset",
      );
      assert.equal(
        await page.evaluate(
          () =>
            Object.values(JSON.parse(localStorage.getItem("voice-test-jobs"))).find(
              (job) => job.type === "audio-extract",
            )?.status,
        ),
        "succeeded",
      );
      await recover.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector(".voice-preparation [role=alert]")
            ?.textContent.includes("模拟磁盘已满"),
      );
      assert.equal(await recover.isEnabled(), true, "A failed save leaves recovery available");
      await page.evaluate(() => {
        window.__failExtractedPublication = false;
      });
      await recover.click();
      await page.waitForFunction(
        (mediaId) => {
          const current = window.__panelTools.read_video_project().project;
          const asset = current.assets.find((item) => item.mediaId === mediaId);
          return asset && document.querySelector("#voice-prep-reference")?.value === asset.id;
        },
        extractedId,
      );
      const after = await project(page);
      const extracted = after.assets.find((asset) => asset.mediaId === extractedId);
      assert.equal(await page.locator("#voiceover-reference").inputValue(), extracted.id);
      assert.equal(await page.locator("#voice-prep-model").isEnabled(), true);
      assert.equal(await recover.count(), 0);
      assert.deepEqual(after.clips, before.clips);
      assert.deepEqual(after.audioClips, before.audioClips);
      assert.equal((await call(page, "media.audio.extract")).length, 1);
      assert.equal(
        await page.evaluate(
          () =>
            window.__genericHostCalls.filter(
              (item) =>
                item.method === "tasks.start" && item.args.input.request.action === "audio-extract",
            ).length,
        ),
        1,
        "Recovery reuses the completed task instead of extracting another recording",
      );
      assert.equal(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("voice-test-storage"))[
              "video-studio-voice-preparation-voice-preparation-project"
            ].pending,
        ),
        undefined,
      );
      const durable = await page.evaluate(() => window.__documents["video-studio-current"].data);
      assert.ok(durable.assets.some((asset) => asset.mediaId === extractedId));
    } finally {
      await page.close();
    }
  },
);

const referenceWave = () => {
  // A self-generated 4-second tone exercises actual file decoding and durable upload.
  // It is not a user's voice and is never sent to an inference service by this suite.
  const sampleRate = 16000,
    frames = sampleRate * 4;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    bytes.writeInt16LE(
      Math.round(2000 * Math.sin((i * 2 * Math.PI * 220) / sampleRate)),
      44 + i * 2,
    );
  return { name: "隔离测试参考.wav", mimeType: "audio/wav", buffer: bytes };
};
async function createMyVoice(page) {
  await page.locator('[data-tab="voiceover"]').click();
  await page.locator('[data-action="voice-prep-start"]').click();
  await page.getByRole("heading", { name: "1. 提供本人录音", exact: true }).waitFor();
  // Wait for the controller's debounced publication/catalog refresh to settle before geometry checks.
  await page.waitForFunction(() => {
    const markup = document.querySelector(".library-panel")?.innerHTML;
    const previous = window.__voiceGuideSettled;
    if (!previous || previous.markup !== markup) {
      window.__voiceGuideSettled = { markup, since: performance.now() };
      return false;
    }
    return performance.now() - previous.since >= 200;
  });
}

test(
  "original MP3 and imported WAV preview before model setup, survive refresh and locate their saved assets",
  { timeout: 45_000 },
  async () => {
    const page = await pageWithHost();
    try {
      const before = await project(page);
      await page.locator("[data-media-filter]").selectOption("video");
      await page.locator("#asset-search").fill("不会匹配本人录音");
      await createMyVoice(page);
      await page.locator("#voice-prep-reference").selectOption("reference-project-asset");
      const original = page.locator("#voice-prep-reference-audio");
      await original.waitFor();
      assert.match(
        await page.locator(".voice-preparation-reference").textContent(),
        /本人参考录音.mp3/,
      );
      assert.match(
        await page.locator(".voice-preparation-reference").textContent(),
        /24\.0 秒 · 已保存到素材库/,
      );
      await original.evaluate((element) => element.play());
      await page.waitForFunction(
        () => document.querySelector("#voice-prep-reference-audio")?.currentTime > 0.2,
      );
      const initialPlayer = await original.elementHandle();
      await page.locator('[data-action="voice-prep-retry"]').click();
      await page.waitForFunction(() => {
        const audio = document.querySelector("#voice-prep-reference-audio");
        return audio && !audio.paused && audio.currentTime > 0.3;
      });
      assert.equal(await initialPlayer.evaluate((element) => element.isConnected), true);
      assert.equal(await page.evaluate(() => window.__voiceRuntimeRequests.length), 0);
      await page.locator('[data-action="voice-prep-show-reference"]').click();
      assert.equal(await page.locator('[data-tab="media"].active').count(), 1);
      assert.equal(await page.locator("[data-media-filter]").inputValue(), "all");
      assert.equal(await page.locator("#asset-search").inputValue(), "");
      await page.locator('[data-preview-asset="reference-project-asset"]').waitFor();
      assert.equal(
        await page.locator('[data-select-media="reference-project-asset"]').isChecked(),
        true,
      );
      assert.equal(await initialPlayer.evaluate((element) => element.paused), true);
      await page.locator('[data-tab="voiceover"]').click();
      const chooser = page.waitForEvent("filechooser");
      await page.locator('[data-action="voice-reference-import"]').click();
      await (await chooser).setFiles(referenceWave());
      await page.waitForFunction(() => {
        const selected = document.querySelector("#voice-prep-reference")?.value;
        return selected && selected !== "reference-project-asset";
      });
      const imported = (await project(page)).assets.find(
        (asset) => asset.name === "隔离测试参考.wav",
      );
      assert.ok(imported);
      await original.waitFor();
      assert.equal(await original.getAttribute("data-reference-asset"), imported.id);
      const waveUrl = await original.getAttribute("src");
      assert.ok(
        waveUrl.startsWith("blob:"),
        "The just-imported original uses its connected local decoder URL",
      );
      await original.evaluate((element) => element.play());
      await page.waitForFunction(
        () => document.querySelector("#voice-prep-reference-audio")?.currentTime > 0.2,
      );
      const wavePlayer = await original.elementHandle();
      assert.ok(
        Math.abs((await original.evaluate((element) => element.duration)) - 4) < 0.1,
        "The player decodes the real four-second WAV, not the managed MP3 fallback fixture",
      );
      await page.locator('[data-action="voice-prep-retry"]').click();
      assert.equal(
        await wavePlayer.evaluate((element) => element.isConnected && !element.paused),
        true,
      );
      await page.locator("#voice-prep-reference").selectOption("reference-project-asset");
      assert.equal(await wavePlayer.evaluate((element) => element.paused), true);
      await original.waitFor();
      assert.equal(await original.getAttribute("data-reference-asset"), "reference-project-asset");
      assert.notEqual(await original.getAttribute("src"), waveUrl);
      assert.equal(
        await original.evaluate((element) => element.paused && element.currentTime === 0),
        true,
      );
      assert.equal(await page.evaluate(() => window.__voiceRuntimeRequests.length), 0);
      assert.equal(await page.locator('audio[aria-label="本人声音真实试听"]').count(), 0);
      const after = await project(page);
      assert.deepEqual(after.clips, before.clips);
      assert.deepEqual(after.audioClips, before.audioClips);
    } finally {
      await page.close();
    }
  },
);

test(
  "creating a voice at 390px opens a guided microphone recording without requesting devices until Start",
  { timeout: 45_000 },
  async () => {
    const page = await pageWithHost({ width: 390 });
    try {
      const unchangedUrl = page.url();
      await page.evaluate(() => {
        history.replaceState({ voiceGuideRecovery: "preserved" }, "", "#voice-guide-model");
      });
      await page.reload();
      await page.waitForFunction(
        () => window.__panelTools.read_video_project?.().project.id === "voice-preparation-project",
      );
      assert.equal(
        page.url(),
        unchangedUrl,
        "Reload repairs the legacy guide URL before media use",
      );
      assert.deepEqual(
        await page.evaluate(() => history.state),
        { voiceGuideRecovery: "preserved" },
        "Repairing a known guide fragment preserves existing history state",
      );
      const before = await project(page);
      assert.equal(await page.evaluate(() => window.__deviceRequests.length), 0);
      await createMyVoice(page);
      for (const name of ["1. 提供本人录音", "2. 准备模型", "3. 试听并保存"])
        await page.getByRole("heading", { name, exact: true }).waitFor();
      for (const target of ["reference", "model", "preview"]) {
        const button = page.locator(`[data-action="voice-prep-goto"][data-id="${target}"]`);
        assert.equal(await button.getAttribute("type"), "button");
        for (const interaction of ["click", "Enter", "Space"]) {
          if (interaction === "click") await button.click();
          else await button.press(interaction);
          assert.equal(
            page.url(),
            unchangedUrl,
            `${target} navigation via ${interaction} keeps the Panel URL`,
          );
          assert.equal(
            await page
              .locator(`#voice-guide-${target}`)
              .evaluate((element) => document.activeElement === element),
            true,
            "Step navigation also moves keyboard focus to its destination",
          );
        }
      }
      assert.equal(await page.locator("#voice-prep-model").inputValue(), "audio8-tts");
      assert.equal(
        await page.evaluate(() => window.__voiceRuntimeRequests.length),
        0,
        "Creating a guide does not install a model or generate speech without the next user action",
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      for (const action of [
        "voice-reference-record",
        "voice-reference-import",
        "voice-reference-video",
      ]) {
        const button = page.locator(`[data-action="${action}"]`);
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox();
        assert.ok(
          box && box.x >= 0 && box.x + box.width <= 390,
          `${action} fits the narrow screen`,
        );
      }
      await page.locator(".voice-preparation h3").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(artifacts, "voice-guide-first-create-390.png"),
        fullPage: true,
      });
      await page.locator('[data-action="voice-reference-record"]').click();
      assert.equal(await page.locator("#recording-mode").inputValue(), "microphone");
      assert.equal(await page.locator("#recording-mode").isDisabled(), true);
      const referenceText = await page.locator("#recording-script").inputValue();
      assert.ok(referenceText.length > 30, "The optional reading prompt is ready before recording");
      assert.equal(
        await page.evaluate(() => window.__deviceRequests.length),
        0,
        "Opening the recording step never acquires a microphone or starts a recording",
      );
      await page.locator('[data-action="rec-start"]').click();
      await page.locator('[data-action="rec-pause"]').waitFor();
      await page.waitForTimeout(3300);
      await page.locator('[data-action="rec-finish"]').click();
      await page.locator('[data-action="rec-save"]').waitFor();
      assert.equal(await page.evaluate(() => window.__deviceRequests.length), 1);
      assert.deepEqual(await page.evaluate(() => window.__deviceRequestUrls), [unchangedUrl]);
      assert.equal(await page.evaluate(() => window.__deviceRequests[0].video), false);
      assert.equal(
        await page.evaluate(() =>
          window.__capturedTracks.every((track) => track.readyState === "ended"),
        ),
        true,
      );
      await page.locator("#recording-name").fill("声音引导录制测试");
      await page.locator('[data-action="rec-save"]').click();
      await page.waitForFunction(
        () =>
          document.querySelector("#voice-prep-reference")?.value &&
          document.querySelector("#voice-prep-reference")?.value !== "reference-project-asset",
      );
      const after = await project(page);
      const selected = after.assets.find(
        (asset) => !before.assets.some((old) => old.id === asset.id),
      );
      assert.ok(
        selected && selected.kind === "audio" && /^asset-[a-f0-9]{64}$/.test(selected.mediaId),
      );
      assert.ok(
        selected.durationFrames >= 90 && selected.durationFrames <= 300,
        JSON.stringify(selected),
      );
      assert.equal(await page.locator("#voice-prep-reference").inputValue(), selected.id);
      assert.equal(
        await page.locator("#voice-prep-transcript").inputValue(),
        "",
        "A suggested reading prompt is not evidence of what the recording actually says",
      );
      assert.equal(await page.locator('[data-action="voice-prep-sample"]').isDisabled(), true);
      assert.deepEqual(after.clips, before.clips);
      assert.deepEqual(after.audioClips, before.audioClips);
      assert.equal(await page.evaluate(() => window.__voiceRuntimeRequests.length), 0);
      await page.locator('[data-action="voice-prep-reference-text"]').click();
      assert.equal(
        await page.locator("#voice-prep-transcript").inputValue(),
        referenceText,
        "Only the explicit confirmation fills the optional reading prompt into the transcript",
      );
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector("#toast")).opacity === "0",
      );
      await page.screenshot({
        path: resolve(artifacts, "voice-guide-recording-return-390.png"),
        fullPage: true,
      });
    } finally {
      await page.close();
    }
  },
);

test(
  "importing a reference file selects the persisted audio and an installed engine without an installation task",
  { timeout: 30_000 },
  async () => {
    const page = await pageWithHost({ installed: true });
    try {
      await createMyVoice(page);
      const before = await project(page);
      const chooserPromise = page.waitForEvent("filechooser");
      await page.locator('[data-action="voice-reference-import"]').click();
      await (await chooserPromise).setFiles(referenceWave());
      await page.waitForFunction(
        () =>
          document.querySelector("#voice-prep-reference")?.value &&
          document.querySelector("#voice-prep-reference")?.value !== "reference-project-asset",
      );
      const after = await project(page);
      const imported = after.assets.find(
        (asset) => !before.assets.some((old) => old.id === asset.id),
      );
      assert.equal(imported?.name, "隔离测试参考.wav");
      assert.equal(imported?.durationFrames, 120);
      assert.match(imported?.mediaId, /^asset-[a-f0-9]{64}$/);
      assert.equal(await page.locator("#voice-prep-reference").inputValue(), imported.id);
      assert.equal(await page.locator("#voice-prep-transcript").inputValue(), "");
      assert.ok(
        await page.evaluate(
          () =>
            window.__genericHostCalls.filter((call) => call.method === "resources.upload.write")
              .length > 1,
        ),
      );
      assert.equal(await page.evaluate(() => window.__voiceRuntimeRequests.length), 0);
      await page.locator("#voice-prep-transcript").fill("这是用户核对后提供的参考录音逐字稿。");
      await page.locator("#voice-prep-sample").fill("你好，欢迎收看今天的视频。");
      await page.locator('[data-action="voice-prep-sample"]').click();
      await page.waitForFunction(() =>
        window.__voiceRuntimeRequests.some((request) => request.action === "generate"),
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.__voiceRuntimeRequests.filter((request) => request.action === "setup").length,
        ),
        0,
      );
      assert.equal(await page.locator('[data-action="voice-prep-sample"]').isDisabled(), true);
      await page.locator('[data-action="voice-prep-sample"]').evaluate((button) => button.click());
      assert.equal(
        await page.evaluate(
          () =>
            window.__voiceRuntimeRequests.filter((request) => request.action === "generate").length,
        ),
        1,
      );
      await page.evaluate(() => window.__completeLocalVoice("generate"));
      await page.locator('audio[aria-label="本人声音真实试听"]').waitFor();
      assert.equal(await page.locator('[data-action="voice-prep-save"]').isDisabled(), true);
      await page.locator("#voice-prep-confirmed").check();
      await page.locator("#voice-prep-name").fill("已确认的示例声线");
      await page.locator('[data-action="voice-prep-save"]').click();
      await page.locator("#voiceover-text").waitFor();
      assert.equal(await page.locator("#voiceover-reference").inputValue(), imported.id);
      assert.equal(
        await page.locator("#voiceover-reference-text").inputValue(),
        "这是用户核对后提供的参考录音逐字稿。",
      );
      await page
        .locator("#voiceover-text")
        .fill("这里填写完整视频旁白，已保存的声音将直接用于配音。");
      assert.equal(await page.locator("#voiceover-model").inputValue(), "audio8-tts");
      const finished = await project(page);
      assert.deepEqual(finished.clips, before.clips);
      assert.deepEqual(finished.audioClips, before.audioClips);
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector("#toast")).opacity === "0",
      );
      await page.screenshot({
        path: resolve(artifacts, "voice-guide-saved-ready-for-narration.png"),
        fullPage: true,
      });
      await page.locator('[data-tab="jobs"]').click();
      const cloneJob = page.locator(".job-card.succeeded").filter({ hasText: "本人声音配音" });
      await cloneJob.locator('[data-job-action="play"]').waitFor();
      assert.match(await cloneJob.locator('[data-job-action="save"]').innerText(), /保存音频/);
      assert.equal(await cloneJob.locator('[data-job-action="save"]').isEnabled(), true);
      await cloneJob.locator('[data-job-action="play"]').click();
      const resultAudio = page.locator("#plan-dialog[open] audio.result-audio");
      await resultAudio.waitFor();
      assert.equal(
        await page.locator("#plan-dialog[open] video").count(),
        0,
        "A tts-clone result uses an audio player, not an empty video surface",
      );
      assert.ok((await resultAudio.getAttribute("src")).endsWith(`/media/${sampleId}`));
      assert.equal(
        await page
          .locator("#plan-dialog[open]")
          .getByRole("button", { name: "保存音频", exact: true })
          .isEnabled(),
        true,
      );
      await resultAudio.evaluate((audio) => audio.play());
      await page.waitForFunction(
        () => document.querySelector("#plan-dialog audio")?.currentTime > 0,
      );
      await page.locator('#plan-dialog [data-action="close-dialog"]').click();
    } finally {
      await page.close();
    }
  },
);

test(
  "a reference picker opened in the previous project cannot import or select audio in a new project",
  { timeout: 30_000 },
  async () => {
    const page = await pageWithHost({ installed: true });
    try {
      await createMyVoice(page);
      const chooserPromise = page.waitForEvent("filechooser");
      await page.locator('[data-action="voice-reference-import"]').click();
      const chooser = await chooserPromise;
      await page.locator('[data-action="new"]').click();
      await page.waitForFunction(
        () => window.__panelTools.read_video_project().project.id !== "voice-preparation-project",
      );
      const fresh = await project(page);
      await chooser.setFiles(referenceWave());
      await page
        .locator("#toast")
        .filter({ hasText: /工程已切换/ })
        .waitFor();
      await page.locator('[data-tab="voiceover"]').click();
      assert.deepEqual((await project(page)).assets, fresh.assets);
      assert.equal((await project(page)).assets.length, 0);
      assert.equal(await page.locator("#voice-prep-reference").count(), 0);
      assert.equal(
        await page.evaluate(
          () =>
            window.__genericHostCalls.filter((call) => call.method === "resources.upload.begin")
              .length,
        ),
        0,
      );
      const staleWrites = await page.evaluate(
        (id) =>
          window.__calls.filter(
            (call) =>
              call.method === "storage.set" &&
              call.args.key === `video-studio-voice-preparation-${id}` &&
              call.args.value?.selection?.referenceAssetId,
          ),
        fresh.id,
      );
      assert.deepEqual(
        staleWrites,
        [],
        "The old picker never writes a reference selection into a different project",
      );
    } finally {
      await page.close();
    }
  },
);

test(
  "a reference upload failure keeps the voice guide and lets the user choose the file again",
  { timeout: 30_000 },
  async () => {
    const page = await pageWithHost({ installed: true });
    try {
      await createMyVoice(page);
      const before = await project(page);
      await page.evaluate(() => {
        window.__failReferenceUpload = true;
      });
      let choosing = page.waitForEvent("filechooser");
      await page.locator('[data-action="voice-reference-import"]').click();
      await (await choosing).setFiles(referenceWave());
      await page
        .locator("#toast")
        .filter({ hasText: /素材持久保存失败，尚未加入工程/ })
        .waitFor();
      await page.getByRole("heading", { name: "1. 提供本人录音", exact: true }).waitFor();
      assert.equal(await page.locator('[data-action="voice-reference-import"]').isEnabled(), true);
      assert.deepEqual((await project(page)).assets, before.assets);
      assert.equal(await page.locator("#voice-prep-reference").inputValue(), "");
      assert.equal(await page.evaluate(() => window.__voiceRuntimeRequests.length), 0);
      await page.evaluate(() => {
        window.__failReferenceUpload = false;
      });
      choosing = page.waitForEvent("filechooser");
      await page.locator('[data-action="voice-reference-import"]').click();
      await (await choosing).setFiles(referenceWave());
      await page.waitForFunction(() =>
        Boolean(document.querySelector("#voice-prep-reference")?.value),
      );
      assert.equal(
        (await project(page)).assets.length,
        before.assets.length + 1,
        "Retrying the same file publishes one saved reference, without retaining the failed import",
      );
    } finally {
      await page.close();
    }
  },
);
