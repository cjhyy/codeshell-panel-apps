import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";
import {
  enterLegacyProduction,
  readSavedEditorDocument,
} from "./helpers/video-studio-editor-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const evidence =
  process.env.VIDEO_STUDIO_EXACT_EVIDENCE ??
  resolve(root, "artifacts/video-studio/exact-browser-duration");
let directory, browser, server, origin, audioPath, videoPath, tinyPath;
const seed = {
  schemaVersion: 1,
  id: "exact-browser",
  name: "精确素材测试",
  revision: 0,
  width: 160,
  height: 90,
  fps: 30,
  assets: [],
  clips: [],
  captions: [],
};

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "video-exact-browser-"));
  audioPath = resolve(directory, "non-frame.wav");
  videoPath = resolve(directory, "seven-ntsc-frames.mp4");
  tinyPath = resolve(directory, "one-sample.wav");
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-af",
    "atrim=end_sample=1",
    "-c:a",
    "pcm_s16le",
    tinyPath,
  ]);
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-af",
    "atrim=end_sample=10003,aeval='if(gte(n,9600),val(0),0)'",
    "-c:a",
    "pcm_s16le",
    audioPath,
  ]);
  const source = (
    await run("ffmpeg", ["-v", "error", "-i", audioPath, "-f", "f32le", "pipe:1"], {
      encoding: "buffer",
    })
  ).stdout;
  const sourceSamples = new Float32Array(
    source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
  );
  assert.equal(sourceSamples.length, 10003);
  assert.ok(sourceSamples.subarray(0, 9600).every((value) => value === 0));
  assert.ok(
    sourceSamples.subarray(9600).some((value) => Math.abs(value) > 0.01),
    "The real fixture must contain a non-frame tail tone",
  );
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=160x90:r=30000/1001",
    "-vf",
    "drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='eq(n,6)'",
    "-frames:v",
    "7",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-video_track_timescale",
    "30000",
    "-movie_timescale",
    "30000",
    videoPath,
  ]);
  const [project] = selectProjects(await discoverProjects(), "video-studio");
  const output = resolve(directory, "package");
  await buildProject({ ...project, output }, { log: false });
  const app = resolve(output, "app");
  server = createServer(async (request, response) => {
    const path = resolve(
      app,
      "." + new URL(request.url, "http://localhost").pathname.replace(/\/$/, "/index.html"),
    );
    if (!path.startsWith(app + sep)) return response.writeHead(403).end();
    try {
      response.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".mjs": "text/javascript",
            ".css": "text/css",
            ".mp3": "audio/mpeg",
          }[extname(path)] ?? "application/octet-stream",
      });
      response.end(await readFile(path));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
});

test(
  "file drop keeps seven NTSC frames and exports the real last picture after cold reopen",
  { timeout: 60000 },
  async (t) => {
    const page = await open(t);
    await page.evaluate(
      (base64) => {
        const bytes = Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([bytes], "seven-ntsc-frames.mp4", { type: "video/mp4", lastModified: 1 }),
        );
        document
          .querySelector("#studio")
          .dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
      },
      (await readFile(videoPath)).toString("base64"),
    );
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent.includes("已导入 1 个素材"),
    );
    assert.equal((await readSavedEditorDocument(page)).assets[0].duration, 56056);
    await page.reload();
    await enterLegacyProduction(page);
    await page.getByRole("button", { name: "画布与帧率", exact: true }).click();
    await page.locator('dialog[open] select[name="rate"]').selectOption("30000/1001");
    await page.locator("dialog[open]").getByRole("button", { name: "保存", exact: true }).click();
    await page.locator("[data-add-asset]").click();
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    const before = await readSavedEditorDocument(page);
    assert.equal(before.sequences[0].clips[0].duration, 56056);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出视频", exact: true }).click();
    await page.getByRole("button", { name: "开始导出", exact: true }).click();
    const download = await downloading;
    await mkdir(evidence, { recursive: true });
    const path = resolve(evidence, "seven-ntsc-frames.webm");
    await download.saveAs(path);
    const { stdout } = await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        path,
        "-vf",
        "reverse",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      { encoding: "buffer" },
    );
    const center = (45 * 160 + 80) * 3;
    assert.ok(
      stdout[center + 2] > stdout[center] + 150,
      `The actual encoded last frame must be blue: ${[...stdout.subarray(center, center + 3)]}`,
    );
    assert.deepEqual(
      await readSavedEditorDocument(page),
      before,
      "WebM must not rewrite the immutable editor snapshot",
    );
  },
);
after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function open(t, legacySeed = seed) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  await page.addInitScript((seed) => {
    if (!localStorage.getItem("exact-duration-seeded")) {
      localStorage.setItem("video-studio-project-v1", JSON.stringify(seed));
      localStorage.setItem("exact-duration-seeded", "1");
    }
  }, legacySeed);
  await page.route("**/*", (route) => {
    const target = new URL(route.request().url());
    return target.origin === origin || ["blob:", "data:"].includes(target.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await page.goto(origin);
  await enterLegacyProduction(page);
  await page
    .locator("#editor-workspace")
    .waitFor({ state: "visible" })
    .catch(async (error) => {
      console.error(
        "exact fixture boot",
        await page.locator("#save-state").getAttribute("title"),
        await page.locator("body").innerText(),
        errors,
      );
      throw error;
    });
  return page;
}

test(
  "file chooser preserves decoded non-frame audio duration through cold reopening",
  { timeout: 60000 },
  async (t) => {
    const page = await open(t);
    await page.locator("#media-input").setInputFiles(audioPath);
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent.includes("已导入 1 个素材"),
    );
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    const doc = await readSavedEditorDocument(page);
    assert.equal(
      doc.assets[0].duration,
      10003 * 5,
      "10003 actual 48 kHz samples must survive instead of six 30 fps frames",
    );
    await page.reload();
    await enterLegacyProduction(page);
    await page.locator("#editor-workspace").waitFor({ state: "visible" });
    assert.equal((await readSavedEditorDocument(page)).assets[0].duration, 50015);
    await page.locator("[data-add-asset]").click();
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    const placed = await readSavedEditorDocument(page);
    assert.equal(placed.sequences[0].clips[0].duration, 50015);
    assert.deepEqual(placed.sequences[0].clips[0].timeMap.points, [
      { time: 0, source: 0 },
      { time: 50015, source: 50015 },
    ]);
    const downloading = page.waitForEvent("download");
    await page.evaluate(() => {
      window.__exportAudio = [];
      window.__exportTracks = [];
      const create = AudioContext.prototype.createMediaElementSource;
      AudioContext.prototype.createMediaElementSource = function (media) {
        window.__exportAudio.push({ context: this, media });
        return create.call(this, media);
      };
      const destination = AudioContext.prototype.createMediaStreamDestination;
      AudioContext.prototype.createMediaStreamDestination = function () {
        const result = destination.call(this);
        window.__exportTracks.push(...result.stream.getTracks());
        return result;
      };
      const capture = HTMLCanvasElement.prototype.captureStream;
      HTMLCanvasElement.prototype.captureStream = function (...args) {
        const result = capture.apply(this, args);
        window.__exportTracks.push(...result.getTracks());
        return result;
      };
      const stop = MediaRecorder.prototype.stop;
      MediaRecorder.prototype.stop = function () {
        window.__exportStop = window.__exportAudio.map(({ context, media }) => ({
          currentTime: media.currentTime,
          duration: media.duration,
          ended: media.ended,
          contextTime: context.currentTime,
          baseLatency: context.baseLatency,
        }));
        return stop.call(this);
      };
    });
    await page.getByRole("button", { name: "导出视频", exact: true }).click();
    await page.getByRole("button", { name: "开始导出", exact: true }).click();
    const download = await downloading;
    await mkdir(evidence, { recursive: true });
    const path = resolve(evidence, "non-frame-audio.webm");
    await download.saveAs(path);
    const { stdout } = await run(
      "ffmpeg",
      ["-v", "error", "-i", path, "-f", "f32le", "-ar", "48000", "-ac", "1", "pipe:1"],
      { encoding: "buffer" },
    );
    const samples = new Float32Array(
      stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength),
    );
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value ** 2, 0) / samples.length);
    const stop = await page.evaluate(() => window.__exportStop);
    assert.ok(
      rms > 0.001,
      `The actual non-frame source tail must be audible: rms=${rms}, samples=${samples.length}, stop=${JSON.stringify(stop)}`,
    );
    assert.ok(
      Math.abs(samples.length / 48000 - 10003 / 48000) < 0.15,
      `Real-time encoder packet/frame tail tolerance: ${samples.length}`,
    );
    assert.equal(
      (await readSavedEditorDocument(page)).assets[0].duration,
      50015,
      "Export must never rewrite source timing",
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__exportAudio.every(
            ({ context, media }) => context.state === "closed" && !media.hasAttribute("src"),
          ) && window.__exportTracks.every((track) => track.readyState === "ended"),
      ),
      true,
      "All actual export decoders, contexts and capture tracks must be released",
    );
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator("[data-add-asset]").click();
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    assert.equal((await readSavedEditorDocument(page)).sequences[0].clips[1].start, 50015);
    const twice = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出视频", exact: true }).click();
    await page.getByRole("button", { name: "开始导出", exact: true }).click();
    const twicePath = resolve(evidence, "two-non-frame-audio-tails.webm");
    await (await twice).saveAs(twicePath);
    const twicePcm = (
      await run(
        "ffmpeg",
        ["-v", "error", "-i", twicePath, "-f", "f32le", "-ar", "48000", "-ac", "1", "pipe:1"],
        { encoding: "buffer" },
      )
    ).stdout;
    const twiceSamples = new Float32Array(
      twicePcm.buffer.slice(twicePcm.byteOffset, twicePcm.byteOffset + twicePcm.byteLength),
    );
    let bursts = 0,
      previousSound = -4801;
    for (let index = 0; index < twiceSamples.length; index++)
      if (Math.abs(twiceSamples[index]) > 0.005) {
        if (index - previousSound > 4800) bursts++;
        previousSound = index;
      }
    assert.equal(
      bursts,
      2,
      "The real mix must retain the tail of both consecutive uses of one source",
    );
  },
);

test(
  "a positive sub-frame source retains cache identity and exact placement after cold reopening",
  { timeout: 30000 },
  async (t) => {
    const page = await open(t);
    await page.locator("#media-input").setInputFiles(tinyPath);
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent.includes("已导入 1 个素材"),
    );
    assert.equal((await readSavedEditorDocument(page)).assets[0].duration, 5);
    await page.reload();
    await enterLegacyProduction(page);
    await page.locator("[data-add-asset]").click();
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    const document = await readSavedEditorDocument(page);
    assert.equal(document.assets[0].duration, 5);
    assert.equal(document.sequences[0].clips[0].duration, 5);
    assert.deepEqual(document.sequences[0].clips[0].timeMap.points, [
      { time: 0, source: 0 },
      { time: 5, source: 5 },
    ]);
  },
);

test(
  "failed exact-source document save leaves the old project intact and retry publishes once",
  { timeout: 30000 },
  async (t) => {
    const page = await open(t);
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    const before = await readSavedEditorDocument(page);
    assert.ok(before);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (this.name === "documents" && value.versions?.[0]?.label === "导入原始素材") {
          IDBObjectStore.prototype.put = put;
          throw new DOMException(
            "controlled exact-source document save failure",
            "QuotaExceededError",
          );
        }
        return put.call(this, value, ...args);
      };
    });
    await page.locator("#media-input").setInputFiles(audioPath);
    await page.waitForFunction(() =>
      document
        .querySelector("#toast")
        ?.textContent.includes("controlled exact-source document save failure"),
    );
    assert.deepEqual(await readSavedEditorDocument(page), before);
    assert.equal(await page.locator("[data-add-asset]").count(), 0);
    await page.reload();
    await enterLegacyProduction(page);
    assert.deepEqual(await readSavedEditorDocument(page), before);
    await page.locator("#media-input").setInputFiles(audioPath);
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent.includes("已导入 1 个素材"),
    );
    const document = await readSavedEditorDocument(page);
    assert.equal(document.assets.length, 1);
    assert.equal(document.assets[0].duration, 50015);
  },
);

test(
  "reconnecting an old rounded source never extends its saved asset or clip",
  { timeout: 30000 },
  async (t) => {
    const bytes = await readFile(audioPath);
    const legacy = structuredClone(seed);
    legacy.assets = [
      {
        id: "historical-sound",
        name: "non-frame.wav",
        kind: "audio",
        durationFrames: 6,
        size: bytes.length,
        lastModified: 1,
        mimeType: "audio/wav",
      },
    ];
    legacy.audioClips = [
      {
        id: "historical-clip",
        assetId: "historical-sound",
        startFrame: 0,
        inFrame: 0,
        outFrame: 6,
        volume: 1,
      },
    ];
    const page = await open(t, legacy);
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    const before = await readSavedEditorDocument(page);
    assert.equal(before.assets[0].duration, 48000);
    await page.evaluate((base64) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(atob(base64), (value) => value.charCodeAt(0))], "non-frame.wav", {
          type: "audio/wav",
          lastModified: 1,
        }),
      );
      document
        .querySelector("#studio")
        .dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
    }, bytes.toString("base64"));
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent.includes("重连 1 个素材"),
    );
    assert.deepEqual(await readSavedEditorDocument(page), before);
    await page.reload();
    await enterLegacyProduction(page);
    assert.deepEqual(await readSavedEditorDocument(page), before);
  },
);

test(
  "fractional rough-cut audio retains its full tail, picture, current timeline preview and one undo",
  { timeout: 30000 },
  async (t) => {
    const page = await open(t);
    await page.locator("#media-input").setInputFiles([videoPath, audioPath]);
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent.includes("已导入 2 个素材"),
    );
    const sources = (await readSavedEditorDocument(page)).assets;
    const video = sources.find((asset) => asset.kind === "video"),
      audio = sources.find((asset) => asset.kind === "audio");
    await page.locator(`[data-add-asset="${video.id}"]`).click();
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    const before = await readSavedEditorDocument(page),
      picture = before.sequences[0].clips[0];
    await page.locator(`[data-rough-source="${audio.id}"]`).click();
    for (const [frame, key] of [
      [0, "i"],
      [5, "o"],
    ]) {
      await page.locator("[data-roughcut-scrub]").evaluate((element, frame) => {
        element.value = String(frame);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }, frame);
      await page.locator("[data-roughcut-panel] h2").click();
      await page.keyboard.press(key);
    }
    await page.locator('[data-roughcut-field="name"]').fill("保留精确末尾声音");
    await page.locator('[data-action="roughcut-save"]').click();
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    const marked = await readSavedEditorDocument(page);
    await page.locator('[data-action="roughcut-append"]').click();
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    const placed = await readSavedEditorDocument(page),
      sequence = placed.sequences[0];
    const clip = sequence.clips.find((clip) => clip.assetId === audio.id);
    assert.ok(clip);
    assert.equal(clip.start, 0);
    assert.equal(clip.duration, 50015);
    assert.deepEqual(clip.timeMap.points, [
      { time: 0, source: 0 },
      { time: 50015, source: 50015 },
    ]);
    assert.deepEqual(
      sequence.clips.find((clip) => clip.id === picture.id),
      picture,
    );
    await page
      .locator(".roughcut-placed")
      .getByRole("button", { name: "查看成片", exact: true })
      .click();
    const target = page.locator(`[data-et-clip="${clip.id}"]`);
    await target.click();
    await page.locator("[data-ew-seek]").fill("0");
    await page.waitForFunction(() => {
      const canvas = document.querySelector("[data-ew-canvas]"),
        context = canvas.getContext("2d");
      const pixel = context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return pixel[0] > pixel[2] + 150;
    });
    assert.equal(await target.getAttribute("aria-selected"), "true");
    await page.locator(`[data-et-clip="${picture.id}"]`).focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator(`[data-et-clip="${picture.id}"]`).getAttribute("aria-selected"),
      "true",
    );
    await page.locator('[data-ew-action="undo"]').click();
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    const undone = await readSavedEditorDocument(page);
    assert.deepEqual(undone.sequences, marked.sequences);
    assert.deepEqual(undone.assets, marked.assets);
    assert.deepEqual(
      undone.production,
      marked.production,
      "Undoing insertion retains the reusable source mark",
    );
  },
);

test(
  "synthetic camera recording saves decoded precision and reopens without acquiring devices",
  { timeout: 60000 },
  async (t) => {
    const page = await open(t);
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 90;
        const paint = canvas.getContext("2d");
        paint.fillStyle = "blue";
        paint.fillRect(0, 0, 160, 90);
        const audio = new AudioContext(),
          destination = audio.createMediaStreamDestination();
        const oscillator = audio.createOscillator(),
          gain = audio.createGain();
        gain.gain.value = 0.06;
        oscillator.connect(gain).connect(destination);
        await audio.resume();
        oscillator.start();
        const stream = canvas.captureStream(30000 / 1001);
        destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
        window.__syntheticCamera = { audio, tracks: stream.getTracks(), acquisitions: 1 };
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            stop();
            if (stream.getTracks().every((track) => track.readyState === "ended")) {
              oscillator.stop();
              void audio.close();
            }
          };
        }
        return stream;
      };
    });
    await page.locator('[data-tab="recording"]').click();
    await page.locator("#recording-mode").selectOption("camera");
    await page.getByRole("button", { name: "3 秒后开始录制", exact: true }).click();
    await page.getByRole("button", { name: "暂停", exact: true }).waitFor();
    await page.waitForTimeout(283);
    await page.getByRole("button", { name: "结束录制", exact: true }).click();
    await page.getByText("录制已完成，设备已释放", { exact: true }).waitFor();
    await page.locator("#recording-name").fill("精确合成摄像头");
    await page.getByRole("button", { name: "保存到素材库", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent.includes("录制已保存到素材库"),
    );
    const doc = await readSavedEditorDocument(page),
      asset = doc.assets[0];
    const decoded = await page.evaluate(async (id) => {
      const file = await new Promise((resolve, reject) => {
        const request = indexedDB.open("mimi-studio-recordings", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            transaction = db.transaction("recordings", "readonly"),
            read = transaction.objectStore("recordings").get(id);
          read.onsuccess = () => resolve(read.result.blob);
          read.onerror = () => reject(read.error);
          transaction.oncomplete = () => db.close();
        };
      });
      const url = URL.createObjectURL(file),
        video = document.createElement("video");
      video.muted = true;
      try {
        await new Promise((resolve, reject) => {
          video.onloadeddata = resolve;
          video.onerror = reject;
          video.src = url;
        });
        if (!Number.isFinite(video.duration))
          await new Promise((resolve, reject) => {
            video.onseeked = resolve;
            video.onerror = reject;
            video.currentTime = 1e10;
          });
        const duration = Number.isFinite(video.duration) ? video.duration : video.currentTime;
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return {
          duration,
          bytes: btoa(binary),
          stopped: window.__syntheticCamera.tracks.every((track) => track.readyState === "ended"),
          context: window.__syntheticCamera.audio.state,
        };
      } finally {
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      }
    }, asset.id);
    assert.equal(asset.duration, Math.round(decoded.duration * 240000));
    assert.notEqual(
      asset.duration % 8000,
      0,
      "Real MediaRecorder duration must not be rounded to a legacy frame",
    );
    assert.equal(decoded.stopped, true);
    assert.equal(decoded.context, "closed");
    await mkdir(evidence, { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      resolve(evidence, "synthetic-camera-original.webm"),
      Buffer.from(decoded.bytes, "base64"),
    );
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new Error("Restoration must never acquire a camera");
      };
    });
    await page.reload();
    await enterLegacyProduction(page);
    assert.equal((await readSavedEditorDocument(page)).assets[0].duration, asset.duration);
    await page.locator("[data-add-asset]").click();
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已自动保存",
    );
    assert.equal(
      (await readSavedEditorDocument(page)).sequences[0].clips[0].duration,
      asset.duration,
    );
  },
);

test(
  "production main rejects encoded output invalidated before its download continuation",
  { timeout: 30000 },
  async (t) => {
    const results = [];
    for (const mode of ["cancel", "hidden-without-event"]) {
      const page = await open(t);
      await page.locator("#media-input").setInputFiles(audioPath);
      await page.waitForFunction(() =>
        document.querySelector("#toast")?.textContent.includes("已导入 1 个素材"),
      );
      await page.locator("[data-add-asset]").click();
      await page.waitForFunction(
        () => document.querySelector("#save-state")?.textContent === "已自动保存",
      );
      const before = await readSavedEditorDocument(page),
        downloads = [];
      page.on("download", (download) => downloads.push(download));
      await page.evaluate((mode) => {
        const NativeBlob = Blob,
          events = [],
          nativeAbort = AbortController.prototype.abort,
          nativeClick = HTMLAnchorElement.prototype.click;
        let armed = true;
        window.__publicationFixture = { mode, events };
        AbortController.prototype.abort = function (...args) {
          events.push({ kind: "abort", time: performance.now() });
          return nativeAbort.apply(this, args);
        };
        HTMLAnchorElement.prototype.click = function (...args) {
          if (this.download.endsWith(".webm"))
            events.push({ kind: "download", time: performance.now(), name: this.download });
          return nativeClick.apply(this, args);
        };
        window.Blob = class extends NativeBlob {
          constructor(parts, options) {
            super(parts, options);
            if (
              armed &&
              options?.type?.startsWith("video/webm") &&
              parts.length &&
              parts.every((part) => part instanceof NativeBlob)
            ) {
              armed = false;
              window.__publicationFixture.encoded = this;
              events.push({ kind: "encoded", time: performance.now(), bytes: this.size });
              // This is the real final Blob, after the exporter's last check.
              // Its microtask runs before the awaiting production caller resumes.
              queueMicrotask(() => {
                events.push({ kind: "invalidate", time: performance.now() });
                if (mode === "cancel") {
                  const cancel = document.querySelector('[data-action="cancel-export"]');
                  window.__publicationFixture.cancelAvailable = Boolean(cancel);
                  cancel?.click();
                } else {
                  Object.defineProperty(document, "hidden", {
                    configurable: true,
                    get: () => true,
                  });
                  Object.defineProperty(document, "visibilityState", {
                    configurable: true,
                    get: () => "hidden",
                  });
                  // No notification: the caller must recheck actual visibility.
                }
                events.push({
                  kind: "invalidated",
                  time: performance.now(),
                  hidden: document.hidden,
                });
              });
            }
          }
        };
      }, mode);
      await page.getByRole("button", { name: "导出视频", exact: true }).click();
      await page.getByRole("button", { name: "开始导出", exact: true }).click();
      await page.waitForFunction(
        () =>
          window.__publicationFixture?.events.some((event) => event.kind === "invalidated") &&
          document.querySelector('[data-action="record"]')?.textContent === "重新导出",
      );
      const receipt = await page.evaluate(async () => ({
        mode: window.__publicationFixture.mode,
        events: window.__publicationFixture.events,
        cancelAvailable: window.__publicationFixture.cancelAvailable,
        encodedBytes: window.__publicationFixture.encoded.size,
        status: document.querySelector("#export-progress p").textContent,
      }));
      const anchor = receipt.events.find((event) => event.kind === "download");
      if (anchor) {
        await page.waitForEvent("download", { timeout: 1000 }).catch(() => {});
        assert.equal(
          downloads.length,
          1,
          "An actual browser download must accompany the recorded publication",
        );
        await mkdir(evidence, { recursive: true });
        const file = resolve(evidence, `publication-${mode}-unexpected.webm`);
        await downloads[0].saveAs(file);
        const { stdout } = await run(
          "ffmpeg",
          ["-v", "error", "-i", file, "-f", "f32le", "-ar", "48000", "-ac", "1", "pipe:1"],
          { encoding: "buffer" },
        );
        assert.ok(stdout.length > 0, "The unexpected download must contain actual decodable media");
        receipt.decodedPcmBytes = stdout.length;
      }
      receipt.downloadCount = downloads.length;
      receipt.unchanged =
        JSON.stringify(await readSavedEditorDocument(page)) === JSON.stringify(before);
      results.push(receipt);
      await mkdir(evidence, { recursive: true });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        resolve(evidence, `publication-${mode}.json`),
        JSON.stringify(receipt, null, 2),
      );
    }
    for (const receipt of results) {
      assert.ok(receipt.encodedBytes > 0);
      const encoded = receipt.events.find((event) => event.kind === "encoded"),
        invalidated = receipt.events.find((event) => event.kind === "invalidate"),
        downloaded = receipt.events.find((event) => event.kind === "download");
      assert.ok(encoded.time <= invalidated.time);
      if (receipt.mode === "cancel") {
        assert.equal(receipt.cancelAvailable, true);
        assert.ok(
          receipt.events.some((event) => event.kind === "abort" && event.time >= invalidated.time),
        );
      }
      if (downloaded) assert.ok(invalidated.time <= downloaded.time);
      assert.equal(receipt.unchanged, true);
      assert.equal(receipt.downloadCount, 0, JSON.stringify(receipt));
      assert.equal(downloaded, undefined, JSON.stringify(receipt));
      assert.match(receipt.status, /已取消/);
    }
  },
);
