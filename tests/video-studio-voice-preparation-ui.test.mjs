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
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  assert.deepEqual(errors, [], "No app runtime or CSP errors");
});

async function pageWithHost() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
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
            if (window.__failVoiceSave && args.key.startsWith("video-studio-voice-preparation"))
              throw Error("声音保存失败：模拟磁盘已满");
            storage[args.key] = structuredClone(args.value);
            persist();
            return true;
          }
          if (method === "media.document.get")
            return structuredClone(documents[args.key] ?? { revision: 0, data: null });
          if (method === "media.document.set") {
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
      await audio.evaluate((audio) => audio.play());
      await page.waitForFunction(
        () => document.querySelector('audio[aria-label="本人声音真实试听"]')?.currentTime > 0,
      );
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
      await page.locator(".voice-preparation-recipes").waitFor();
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
      assert.equal(await page.locator(".voice-preparation-recipes").count(), 0);
      assert.equal(await page.locator("#voice-prep-model").inputValue(), "");
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
      assert.deepEqual(after.clips, before.clips);
      assert.deepEqual(after.audioClips, before.audioClips);
      assert.equal((await call(page, "media.tts")).length, 0);
    } finally {
      await page.close();
    }
  },
);
