import { createVoiceWavFixture } from "./helpers/video-studio-voice-wav.mjs";
import { installGenericMediaTaskMock } from "./helpers/video-studio-generic-task.mjs";
import {
  enterLegacyProduction,
  readSavedLegacyProject,
} from "./helpers/video-studio-editor-fixture.mjs";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let output, directory;
const artifacts = resolve(root, "artifacts/video-studio/capabilities-ui");
const sourceId = "asset-" + "e".repeat(64);
let sampleId, sample;
let browser, server, url;
const errors = [];

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "video-studio-capabilities-ui-"));
  const [project] = selectProjects(await discoverProjects(), "video-studio");
  const isolatedOutput = resolve(directory, "package");
  await buildProject({ ...project, output: isolatedOutput }, { log: false });
  output = resolve(isolatedOutput, "app");
  sample = await createVoiceWavFixture(resolve(output, "demo-narration.mp3"), directory);
  sampleId = sample.asset.id;
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
          pathname === `/media/${sampleId}`
            ? "audio/wav"
            : {
                ".html": "text/html",
                ".mjs": "text/javascript",
                ".css": "text/css",
                ".mp3": "audio/mpeg",
              }[extname(path)] || "application/octet-stream",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      response.end(pathname === `/media/${sampleId}` ? sample.bytes : await readFile(path));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
  assert.deepEqual(errors, [], "The full app must not throw runtime errors or violate its CSP");
});

async function isolatedPage(mockHost = false, width = 1440) {
  const context = await browser.newContext({
    viewport: { width, height: 960 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text()))
      errors.push(message.text());
  });
  await page.addInitScript(installGenericMediaTaskMock);
  await page.addInitScript(() => {
    window.__deviceRequests = [];
    window.__capturedTracks = [];
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__deviceRequests.push(constraints);
      const stream = await acquire(constraints);
      window.__capturedTracks.push(...stream.getTracks());
      return stream;
    };
  });
  if (mockHost) await installMockHost(page);
  await page.goto(url);
  await enterLegacyProduction(page);
  await page.locator("#preview").waitFor();
  return { context, page };
}

// Only the bridge directory/jobs/transcript/agent are mocked below. Media playback uses actual MP3 originals and a decoded WAV result.
// This suite does not claim to test ASR/LLM/TTS quality; Host processor suites cover generation.
async function installMockHost(page) {
  await page.addInitScript(
    ({ sourceId, sampleId, sampleReceipt }) => {
      const documents = JSON.parse(localStorage.getItem("capability-documents") || "{}");
      const storage = JSON.parse(localStorage.getItem("capability-storage") || "{}");
      const jobs = {};
      const tasks = {};
      window.__panelTools = {};
      window.__events = {};
      window.__calls = [];
      window.__taskCalls = [];
      window.__jobInputs = {};
      const persist = () => {
        localStorage.setItem("capability-documents", JSON.stringify(documents));
        localStorage.setItem("capability-storage", JSON.stringify(storage));
      };
      const voice = { id: "zf_xiaobei", name: "Kokoro 小北（目录模拟）", language: "zh-CN" };
      const alternate = { id: "zf_xiaoni", name: "Kokoro 小妮（目录模拟）", language: "zh-CN" };
      const catalog = () => ({
        available: true,
        engine: "unavailable",
        voices: [],
        defaultModelId: "kokoro",
        models: [
          {
            id: "edge-tts",
            name: "Edge 在线声音（目录模拟）",
            provider: "Edge",
            available: false,
            installable: true,
            state: "not-installed",
            reason: "需要安装验证",
            maxTextLength: 6000,
            supportsInstructions: false,
            voices: [],
          },
          {
            id: "kokoro",
            name: "Kokoro 本地声音（目录模拟）",
            provider: "Kokoro",
            available: true,
            installable: true,
            state: "ready",
            mode: "offline",
            maxTextLength: 6000,
            supportsInstructions: false,
            voices: [voice, alternate],
            defaultVoiceId: voice.id,
          },
        ],
      });
      const asset = (id) =>
        id === sampleId
          ? structuredClone(sampleReceipt.asset)
          : {
              id,
              name: id === sourceId ? "原声旁白.mp3" : "试听结果.mp3",
              mimeType: "audio/mpeg",
              bytes: 384865,
              createdAt: 1,
            };
      const preparation = (id) => ({
        assetId: id,
        inspection:
          id === sampleId
            ? structuredClone(sampleReceipt.inspection)
            : {
                kind: "audio",
                durationSeconds: 24,
                audio: { codec: "mp3", sampleRate: 48000, channels: 1 },
              },
        preparedAt: 1,
      });
      const startJob = (type, input) => {
        const job = {
          id: `job-mock-${type}-${crypto.randomUUID()}`,
          type,
          status: "queued",
          attempt: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        jobs[job.id] = job;
        window.__jobInputs[job.id] = structuredClone(input);
        return structuredClone(job);
      };
      window.__completeSpeech = () => {
        const job = Object.values(jobs).find(
          (job) => job.type === "tts-managed" && job.status === "queued",
        );
        if (!job) throw Error("Expected one queued speech request");
        const input = window.__jobInputs[job.id];
        job.status = "succeeded";
        job.updatedAt = Date.now();
        job.result = {
          asset: structuredClone(sampleReceipt.asset),
          inspection: structuredClone(sampleReceipt.inspection),
          speech: {
            text: input.text,
            modelId: input.modelId,
            engine: "kokoro",
            voiceId: input.voiceId,
            rate: input.rate,
          },
        };
        window.__events["media.job.changed"]?.(structuredClone(job));
      };
      window.codeshellPanel = {
        getContext: async () => ({ cwd: "/isolated/capabilities-ui", theme: "dark" }),
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
              tts: catalog(),
            };
          if (method === "media.tts.voices") return catalog();
          if (method === "media.tts.setup") return startJob("tts-setup", args);
          if (method === "media.tts") return startJob("tts-managed", args);
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
            const result = {
              revision: args.baseRevision + 1,
              data: structuredClone(args.data),
              updatedAt: Date.now(),
              label: args.label,
            };
            documents[args.key] = result;
            persist();
            return structuredClone(result);
          }
          if (method === "media.document.versions") return [];
          if (method === "media.jobs.list")
            return {
              total: Object.keys(jobs).length,
              jobs: Object.values(jobs).map(({ result, ...job }) => job),
            };
          if (method === "media.jobs.get") return structuredClone(jobs[args.id]);
          if (method === "media.jobs.cancel") {
            jobs[args.id].status = "cancelled";
            return structuredClone(jobs[args.id]);
          }
          if (method === "media.assets.get")
            return { asset: asset(args.id), preparation: preparation(args.id) };
          if (method === "media.transcript")
            return {
              assetId: args.assetId,
              total: 2,
              offset: args.offset || 0,
              segments: args.offset
                ? []
                : [
                    { start: 0, end: 4, text: "从想法到成片，保留真实的声音。" },
                    { start: 5, end: 10, text: "我们整理素材，也整理表达。" },
                  ],
            };
          if (method === "media.analysis")
            return {
              assetId: args.assetId,
              kind: "silence",
              total: 0,
              offset: 0,
              detector: "test-fixture",
              intervals: [],
            };
          if (method === "agent.task.start") {
            window.__taskCalls.push(structuredClone(args));
            const task = { id: `mock-agent-${window.__taskCalls.length}`, status: "running" };
            tasks[task.id] = task;
            return task;
          }
          if (method === "agent.task.get") return structuredClone(tasks[args.id]);
          if (method === "agent.task.cancel") return { id: args.id, status: "cancelled" };
          throw Error("Unexpected mock Host call: " + method);
        },
      };
    },
    { sourceId, sampleId, sampleReceipt: { asset: sample.asset, inspection: sample.inspection } },
  );
}

async function saved(page) {
  await page.waitForFunction(
    () => document.querySelector("#save-state")?.textContent === "已自动保存",
  );
}
const readProject = async (page) =>
  (await page.evaluate(() => window.__panelTools?.read_video_project().project ?? null)) ??
  (await readSavedLegacyProject(page));
const click = (page, name) => page.getByRole("button", { name, exact: true }).click();
async function loadDemo(page) {
  await click(page, "试试示例工程");
  await saved(page);
}

test(
  "full browser app records camera and microphone, stores a Blob, restores after reload and exports audible WebM",
  { timeout: 45_000 },
  async () => {
    const { page, context } = await isolatedPage();
    try {
      assert.equal(await page.evaluate(() => window.__deviceRequests.length), 0);
      await page.locator('[data-tab="recording"]').click();
      await page.locator("#recording-mode").selectOption("camera");
      await click(page, "3 秒后开始录制");
      await page.getByRole("button", { name: "暂停", exact: true }).waitFor();
      await page.waitForTimeout(1400);
      await click(page, "结束录制");
      await page.getByText("录制已完成，设备已释放", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            window.__capturedTracks.length >= 2 &&
            window.__capturedTracks.every((track) => track.readyState === "ended"),
        ),
        true,
      );
      await page.locator("#recording-name").fill("隔离测试摄像头录制");
      await click(page, "保存到素材库");
      await page
        .waitForFunction(() =>
          document.querySelector("#toast")?.textContent.includes("录制已保存到素材库"),
        )
        .catch(async (error) => {
          console.error(
            "Recording publication did not complete",
            await page.evaluate(() => ({
              toast: document.querySelector("#toast")?.textContent,
              save: document.querySelector("#save-state")?.textContent,
              recording:
                document.querySelector(".recording-panel")?.textContent ??
                document.querySelector(".library-panel")?.textContent,
            })),
          );
          throw error;
        });
      await saved(page);
      assert.equal((await readSavedLegacyProject(page)).assets.length, 1);
      const asset = (await readProject(page)).assets[0];
      assert.equal(asset.kind, "video");
      assert.ok(asset.durationFrames >= 30 && asset.durationFrames < 120, JSON.stringify(asset));
      const cached = await page.evaluate(
        (id) =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open("mimi-studio-recordings", 1);
            request.onsuccess = () => {
              const db = request.result;
              const read = db
                .transaction("recordings", "readonly")
                .objectStore("recordings")
                .get(id);
              read.onsuccess = () => {
                const entry = read.result;
                resolve({
                  bytes: entry?.blob?.size,
                  name: entry?.name,
                  blob: entry?.blob instanceof Blob,
                });
                db.close();
              };
              read.onerror = () => reject(read.error);
            };
            request.onerror = () => reject(request.error);
          }),
        asset.id,
      );
      assert.equal(cached.blob, true);
      assert.ok(cached.bytes > 1000);
      assert.equal(cached.name, "隔离测试摄像头录制.webm");
      await page.locator('[data-tab="media"]').click();
      await page.locator("[data-add-asset]").click();
      await saved(page);
      const before = await readProject(page);
      assert.equal(before.clips[0].assetId, asset.id);
      await page.reload();
      await enterLegacyProduction(page);
      await page.locator("#preview").waitFor();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".asset-card").length === 1 &&
          document.querySelectorAll(".asset-card.missing").length === 0,
      );
      assert.equal((await readProject(page)).clips[0].assetId, asset.id);
      assert.equal(
        await page.evaluate(() => window.__deviceRequests.length),
        0,
        "Restoring a recording never asks to reacquire a device",
      );
      const download = page.waitForEvent("download").catch(async (error) => {
        console.error(
          "Recorded video export did not finish",
          await page.evaluate(() => ({
            toast: document.querySelector("#toast")?.textContent,
            export: document.querySelector("#export-dialog")?.textContent,
            save: document.querySelector("#save-state")?.textContent,
          })),
        );
        throw error;
      });
      await click(page, "导出视频");
      await click(page, "开始导出");
      const file = await download;
      assert.match(file.suggestedFilename(), /\.webm$/);
      const bytes = await readFile(await file.path());
      assert.ok(bytes.length > 5000);
      await file.saveAs(resolve(artifacts, "recording-restored-export.webm"));
      const media = await page.evaluate(async (data) => {
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        const context = new AudioContext();
        const video = document.createElement("video");
        const url = URL.createObjectURL(new Blob([bytes], { type: "video/webm" }));
        try {
          const audio = await context.decodeAudioData(bytes.buffer.slice(0));
          const samples = audio.getChannelData(0);
          video.src = url;
          await new Promise((resolve, reject) => {
            video.onloadedmetadata = resolve;
            video.onerror = reject;
          });
          return {
            duration: audio.duration,
            rms: Math.sqrt(samples.reduce((sum, sample) => sum + sample ** 2, 0) / samples.length),
            width: video.videoWidth,
            height: video.videoHeight,
          };
        } finally {
          await context.close();
          video.removeAttribute("src");
          video.load();
          URL.revokeObjectURL(url);
        }
      }, bytes.toString("base64"));
      assert.ok(media.rms > 0.001, JSON.stringify(media));
      assert.ok(Math.abs(media.duration - asset.durationFrames / 30) < 0.35, JSON.stringify(media));
      assert.equal(media.width, before.width);
      assert.equal(media.height, before.height);
    } finally {
      await context.close();
    }
  },
);

test(
  "new navigation remains reachable without horizontal page overflow at narrow and wide sizes",
  { timeout: 25_000 },
  async () => {
    const { page, context } = await isolatedPage();
    try {
      for (const width of [390, 620, 900, 1440]) {
        await page.setViewportSize({ width, height: 960 });
        for (const tab of [
          "media",
          "recording",
          "spoken",
          "transcript",
          "voiceover",
          "ai",
          "jobs",
        ]) {
          const button = page.locator(`[data-tab="${tab}"]`);
          await button.click();
          assert.equal(await button.getAttribute("aria-pressed"), "true");
          const layout = await page.evaluate(() => ({
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
            rail: document.querySelector(".rail").getBoundingClientRect().toJSON(),
          }));
          assert.ok(
            layout.scroll <= layout.width + 1,
            `${width}/${tab}: ${JSON.stringify(layout)}`,
          );
          assert.ok(layout.rail.left >= 0 && layout.rail.right <= layout.width + 1);
        }
        await page.screenshot({
          path: resolve(artifacts, `navigation-${width}.png`),
          fullPage: true,
        });
      }
      assert.equal(await page.evaluate(() => window.__deviceRequests.length), 0);
    } finally {
      await context.close();
    }
  },
);

test(
  "mock Host directory: install queues the selected engine and real-result audition never adds an audio clip",
  { timeout: 25_000 },
  async () => {
    const { page, context } = await isolatedPage(true);
    let releaseMedia = () => {};
    try {
      await loadDemo(page);
      const before = await readProject(page);
      await page.locator('[data-tab="voiceover"]').click();
      await page.locator("#voiceover-model").selectOption("edge-tts");
      await click(page, "安装并验证引擎");
      await page.waitForFunction(() =>
        window.__calls.some((call) => call.method === "media.tts.setup"),
      );
      assert.deepEqual(
        await page.evaluate(
          () => window.__calls.find((call) => call.method === "media.tts.setup").args,
        ),
        { providerId: "edge-tts" },
      );
      await page.locator('[data-tab="voiceover"]').click();
      await page.locator("#voiceover-model").selectOption("kokoro");
      await page.locator("#voiceover-voice").selectOption("zf_xiaoni");
      await page.locator("#voiceover-rate").selectOption("1.25");
      const text = "这是所选模型生成的试听文案。".repeat(20);
      await page.locator("#voiceover-text").fill(text);
      await click(page, "试听所选声音 · 前 120 字");
      const request = await page.evaluate(
        () => window.__calls.find((call) => call.method === "media.tts").args,
      );
      assert.equal(request.modelId, "kokoro");
      assert.equal(request.voiceId, "zf_xiaoni");
      assert.equal(request.rate, 1.25);
      assert.equal(request.text, Array.from(text).slice(0, 120).join(""));
      // Pause the library's first real metadata load to exercise a result arriving while
      // the user opens its separate audition element. No media implementation is mocked.
      let firstMediaRequest = true;
      const mediaReady = new Promise((resolve) => {
        releaseMedia = resolve;
      });
      await page.route(`**/media/${sampleId}`, async (route) => {
        if (firstMediaRequest) {
          firstMediaRequest = false;
          await mediaReady;
        }
        await route.continue();
      });
      await page.evaluate(() => window.__completeSpeech());
      await page.waitForFunction(
        (id) =>
          window.__panelTools
            .read_video_project()
            .project.assets.some((asset) => asset.mediaId === id),
        sampleId,
      );
      await saved(page);
      const after = await readProject(page);
      assert.deepEqual(
        after.audioClips,
        before.audioClips,
        "Audition publishes the asset only; no overlapping narration is inserted",
      );
      assert.deepEqual(after.clips, before.clips);
      assert.equal(
        after.assets.find((asset) => asset.mediaId === sampleId).speech.voiceId,
        "zf_xiaoni",
      );
      await page.locator('[data-tab="jobs"]').click();
      await page.locator(`[data-job-action="play"][data-asset-id="${sampleId}"]`).click();
      await page.locator(".result-audio").waitFor();
      releaseMedia();
      await page.waitForFunction(() => {
        const documents = JSON.parse(localStorage.getItem("capability-documents"));
        return Object.values(documents["video-studio-production"]?.data.bindings ?? {}).some(
          (binding) => binding.purpose === "tts" && binding.consumed,
        );
      });
      assert.equal(
        await page.locator(".result-audio").count(),
        1,
        "Completing asset decoding must preserve the user's open audition dialog",
      );
      await page.waitForFunction(() => {
        const audio = document.querySelector(".result-audio");
        return audio && audio.currentTime > 0.15 && !audio.paused && !audio.muted;
      });
      assert.match(await page.locator(".result-audio").getAttribute("src"), new RegExp(sampleId));
      assert.deepEqual((await readProject(page)).audioClips, before.audioClips);
      await page.screenshot({
        path: resolve(artifacts, "selected-voice-sample.png"),
        fullPage: true,
      });
    } finally {
      releaseMedia();
      await context.close();
    }
  },
);

test(
  "mock transcript and agent: polishing saves the editable script while preserving original sound and cuts",
  { timeout: 25_000 },
  async () => {
    const { page, context } = await isolatedPage(true);
    try {
      await loadDemo(page);
      const source = await readProject(page);
      const original = source.assets.find((asset) => asset.kind === "audio");
      original.id = "original-spoken-audio";
      original.name = "原声旁白.mp3";
      original.mediaId = sourceId;
      delete original.builtin;
      source.audioClips[0].assetId = original.id;
      await page.locator("#project-input").setInputFiles({
        name: "original-audio.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(source)),
      });
      await page.waitForFunction(
        () =>
          window.__panelTools.read_video_project().project.audioClips[0]?.assetId ===
          "original-spoken-audio",
      );
      await saved(page);
      const before = await readProject(page);
      await page.locator('[data-tab="spoken"]').click();
      await click(page, "读取已有结果");
      await page.locator(".spoken-transcript summary").waitFor();
      // Native inspection/document completion also schedules a background refresh.
      // Open the disclosure after those updates settle, as a user would, without
      // forcing a click through a replaced or offscreen control.
      await page.waitForFunction(() => {
        const markup = document.querySelector(".library-panel")?.innerHTML;
        const previous = window.__stableSpokenFixture;
        if (!previous || previous.markup !== markup) {
          window.__stableSpokenFixture = { markup, since: performance.now() };
          return false;
        }
        return performance.now() - previous.since >= 200;
      });
      await page.locator(".spoken-transcript summary").click();
      await click(page, "让 AI 提供文稿建议");
      await page.waitForFunction(() => window.__taskCalls.length === 1);
      const prompt = await page.evaluate(() => window.__taskCalls[0]);
      assert.match(JSON.stringify(prompt), /set_video_script/);
      assert.match(JSON.stringify(prompt), /不改变原声/);
      const rewritten = "从想法到成片，让真实的声音把故事讲清楚。\n整理素材，也整理表达。";
      await page.evaluate(async (text) => {
        const state = window.__panelTools.read_video_project();
        await window.__panelTools.set_video_script({
          projectId: state.project.id,
          requestToken: state.requestToken,
          baseRevision: state.project.revision,
          text,
          finish: true,
        });
      }, rewritten);
      await saved(page);
      assert.equal(await page.locator("#voiceover-text").inputValue(), rewritten);
      const after = await readProject(page);
      assert.equal(after.script, rewritten);
      assert.deepEqual(after.assets, before.assets);
      assert.deepEqual(after.clips, before.clips);
      assert.deepEqual(after.audioClips, before.audioClips);
      assert.deepEqual(after.captions, before.captions);
      assert.equal(
        await page.evaluate(
          () =>
            window.__calls.filter((call) =>
              ["media.tts", "media.render", "media.audio.enhance"].includes(call.method),
            ).length,
        ),
        0,
      );
      await page.reload();
      await enterLegacyProduction(page);
      await page.locator("#preview").waitFor();
      assert.equal((await readProject(page)).script, rewritten);
      assert.deepEqual((await readProject(page)).audioClips, before.audioClips);
    } finally {
      await context.close();
    }
  },
);

test("saved desktop project and original audio restore even when the native engine cannot start", async () => {
  const { context, page } = await isolatedPage(true);
  try {
    await page.evaluate(
      async ({ sourceId }) => {
        const project = window.__panelTools.read_video_project().project;
        project.name = "原片恢复不依赖制作引擎";
        project.assets.push({
          id: "legacy-original-audio",
          name: "原声旁白.mp3",
          kind: "audio",
          mediaId: sourceId,
          mimeType: "audio/mpeg",
          durationFrames: 720,
          size: 384865,
        });
        const saved = await window.codeshellPanel.call("media.document.get", {
          key: "video-studio-current",
        });
        await window.codeshellPanel.call("media.document.set", {
          key: "video-studio-current",
          baseRevision: saved.revision,
          data: project,
        });
        localStorage.removeItem("video-studio-project-v1");
      },
      { sourceId },
    );
    await page.addInitScript(() => {
      const bridge = window.codeshellPanel;
      const call = bridge.call.bind(bridge);
      bridge.call = (method, params) => {
        if (method === "tasks.start") throw new Error("测试：本地工具暂不可用");
        return call(method, params);
      };
    });
    await page.reload();
    await enterLegacyProduction(page);
    await page.waitForFunction(
      () => window.__panelTools?.read_video_project().project.name === "原片恢复不依赖制作引擎",
    );
    await page.waitForFunction(
      () =>
        !window.__panelTools.read_video_project().missingAssetIds.includes("legacy-original-audio"),
    );
    await page.getByRole("button", { name: "任务", exact: true }).click();
    await page.getByText(/测试：本地工具暂不可用/).waitFor();
    assert.equal(
      await page.evaluate(() => window.__panelTools.read_video_project().capabilities.autoApply),
      false,
    );
    await page.locator("#project-name").fill("原片已恢复，工程继续保存");
    await page.locator("#project-name").blur();
    await saved(page);
    const stored = await readSavedLegacyProject(page);
    assert.equal(stored.name, "原片已恢复，工程继续保存");
    assert(
      stored.assets.some(
        (asset) => asset.id === "legacy-original-audio" && asset.mediaId === sourceId,
      ),
    );
  } finally {
    await context.close();
  }
});

test("workspace discovery failure cannot select a different saved project or overwrite storage", async () => {
  const { context, page } = await isolatedPage(true);
  try {
    const snapshot = await page.evaluate(async () => {
      const bridge = window.codeshellPanel;
      const project = window.__panelTools.read_video_project().project;
      const stored = await bridge.call("media.document.get", { key: "video-studio-current" });
      project.name = "文档中的真实工程";
      await bridge.call("media.document.set", {
        key: "video-studio-current",
        baseRevision: stored.revision,
        data: project,
        label: "已保存真实工程",
      });
      await bridge.call("storage.set", {
        key: "video-studio-project-v1",
        value: { ...project, name: "旧缓存工程" },
      });
      return {
        document: await bridge.call("media.document.get", { key: "video-studio-current" }),
        legacy: await bridge.call("storage.get", { key: "video-studio-project-v1" }),
      };
    });
    await page.addInitScript(() => {
      window.codeshellPanel.getContext = async () => {
        throw new Error("测试：工作区连接失败");
      };
    });
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "恢复失败",
    );
    assert.notEqual((await readProject(page)).name, "旧缓存工程");
    await page.locator("#project-name").fill("不应覆盖存档");
    await page.locator("#project-name").blur();
    await page.getByText("工程存储尚未连接，请重新打开面板后再编辑", { exact: true }).waitFor();
    assert.deepEqual(
      await page.evaluate(async () => ({
        document: await window.codeshellPanel.call("media.document.get", {
          key: "video-studio-current",
        }),
        legacy: await window.codeshellPanel.call("storage.get", { key: "video-studio-project-v1" }),
      })),
      snapshot,
    );
  } finally {
    await context.close();
  }
});
