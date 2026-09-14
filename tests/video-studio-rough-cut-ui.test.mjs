import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";
import { installGenericMediaTaskMock } from "./helpers/video-studio-generic-task.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "panels/video-studio/app");
const artifacts = resolve(root, "artifacts/video-studio");
const errors = [];
let browser;
let server;
let url;
let directory;
let sourcePath;
const managedSources = new Map();

before(async () => {
  if (process.env.VIDEO_STUDIO_SKIP_BUILD !== "1") {
    const [project] = selectProjects(await discoverProjects(), "video-studio");
    await buildProject(project);
  }
  directory = await mkdtemp(join(tmpdir(), "video-studio-rough-cut-ui-"));
  sourcePath = join(directory, "rough-cut-source.mp4");
  const generated = spawnSync(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30:duration=6",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=6",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      sourcePath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    generated.status,
    0,
    `FFmpeg must create actual playable source media: ${generated.stderr}`,
  );
  for (const [path, mimeType] of [
    [sourcePath, "video/mp4"],
    [resolve(root, "tests/fixtures/static-tone.wav"), "audio/wav"],
  ]) {
    const bytes = await readFile(path);
    managedSources.set(`/media/asset-${createHash("sha256").update(bytes).digest("hex")}`, {
      bytes,
      mimeType,
    });
  }
  await mkdir(artifacts, { recursive: true });
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const path = resolve(output, "." + pathname.replace(/\/$/, "/index.html"));
    if (!path.startsWith(output + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const managed = managedSources.get(pathname);
      const bytes = managed?.bytes ?? (await readFile(path));
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end =
        range && range[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
      const body = bytes.subarray(start, end + 1);
      response.writeHead(range ? 206 : 200, {
        "Content-Type":
          managed?.mimeType ??
          {
            ".html": "text/html",
            ".css": "text/css",
            ".mjs": "text/javascript",
            ".mp3": "audio/mpeg",
          }[extname(path)] ??
          "application/octet-stream",
        "Content-Length": body.length,
        "Accept-Ranges": "bytes",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
});

after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
  assert.deepEqual(errors, [], "The rough cut workflow must not raise browser or CSP errors");
});

async function openPage() {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text()))
      errors.push(message.text());
  });
  // Only persistence and tool registration are supplied by this bridge. Actual
  // media decoding, playback, marking, edits and downloads run in the browser.
  await page.addInitScript(installGenericMediaTaskMock);
  await page.addInitScript(() => {
    window.__roughCutTools = {};
    window.codeshellPanel = {
      getContext: async () => ({ cwd: "/isolated/rough-cut-ui", theme: "dark" }),
      registerTool(name, handler) {
        window.__roughCutTools[name] = handler;
        return () => {};
      },
      on: () => () => {},
      async call(method, params = {}) {
        if (method === "media.status") return { persistent: false };
        if (method === "media.document.get")
          return JSON.parse(
            localStorage.getItem(`document:${params.key}`) ?? '{"revision":0,"data":null}',
          );
        if (method === "media.document.set") {
          const previous = JSON.parse(
            localStorage.getItem(`document:${params.key}`) ?? '{"revision":0}',
          );
          if (params.baseRevision !== previous.revision)
            throw new Error("Document revision changed");
          const saved = { revision: previous.revision + 1, data: params.data };
          localStorage.setItem(`document:${params.key}`, JSON.stringify(saved));
          return saved;
        }
        if (method === "storage.get") return JSON.parse(localStorage.getItem(params.key) ?? "null");
        if (method === "storage.set") {
          localStorage.setItem(params.key, JSON.stringify(params.value));
          return true;
        }
        throw new Error(`Unexpected rough cut bridge call: ${method}`);
      },
    };
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__roughCutTools?.read_video_project);
  return page;
}

const state = (page) => page.evaluate(() => window.__roughCutTools.read_video_project());
const saved = (page) =>
  page.waitForFunction(() => document.querySelector("#save-state")?.textContent === "已自动保存");

async function importedPage() {
  const page = await openPage();
  await page
    .locator("#media-input")
    .setInputFiles([sourcePath, resolve(root, "tests/fixtures/static-tone.wav")]);
  await page.waitForFunction(
    () => window.__roughCutTools.read_video_project().project.assets.length === 2,
  );
  await saved(page);
  const project = (await state(page)).project;
  const video = project.assets.find((asset) => asset.kind === "video");
  const audio = project.assets.find((asset) => asset.kind === "audio");
  assert.equal(video.durationFrames, 180, "The imported source has six seconds of real video");
  assert.ok(audio.durationFrames > 0, "The existing real WAV fixture is decoded");
  await page.locator(`[data-add-asset="${video.id}"]`).click();
  await saved(page);
  const clip = page.locator("[data-clip]").first();
  await clip.click({ position: { x: 45, y: 20 } });
  assert.ok((await state(page)).playheadFrame > 0);
  return { page, video, audio };
}

async function seekSource(page, frame) {
  await page.locator("[data-roughcut-scrub]").evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, frame);
  await page.waitForFunction(
    (value) => document.querySelector("[data-roughcut-scrub]")?.value === String(value),
    frame,
  );
  // Native form fields deliberately own their keys. Move focus out before
  // exercising the source editor's keyboard shortcuts.
  await page.locator("[data-roughcut-panel] h2").click();
}

async function markRange(page, inFrame, outFrame, name, shortcut = false) {
  await seekSource(page, inFrame);
  await page.keyboard.press("i");
  await seekSource(page, outFrame - 1);
  await page.keyboard.press("o");
  await page.locator('[data-roughcut-field="name"]').fill(name);
  if (shortcut) {
    await page.locator("[data-roughcut-panel] h2").click();
    await page.keyboard.press("+");
  } else await page.locator('[data-action="roughcut-save"]').click();
  await saved(page);
}

async function download(page, selector) {
  const pending = page.waitForEvent("download");
  await page.locator(selector).click();
  const item = await pending;
  assert.equal(await item.failure(), null);
  return { name: item.suggestedFilename(), bytes: await readFile(await item.path()) };
}

test(
  "clicking imported video previews and seeks its real frames without adding to an empty timeline",
  { timeout: 45_000 },
  async () => {
    const page = await openPage();
    try {
      await page.locator("#media-input").setInputFiles(sourcePath);
      await page.waitForFunction(
        () => window.__roughCutTools.read_video_project().project.assets.length === 1,
      );
      await saved(page);
      const before = await state(page);
      const video = before.project.assets[0];
      assert.deepEqual(before.project.clips, []);
      const card = page.locator(`[data-preview-asset="${video.id}"]`);
      await card.locator(".asset-thumbnail").focus();
      await page.keyboard.press("Space");
      assert.equal(await page.locator('[data-tab="media"].active').count(), 1);
      assert.equal(await page.locator("#preview").getAttribute("aria-label"), "原素材画面");
      assert.equal(await page.locator("[data-roughcut-panel]").count(), 0);
      await page.waitForFunction(() => {
        const canvas = document.querySelector("#preview");
        const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set();
        for (let offset = 0; offset < bytes.length; offset += 64)
          colors.add(`${bytes[offset]},${bytes[offset + 1]},${bytes[offset + 2]}`);
        return colors.size > 20;
      });
      const framePixels = () =>
        page.locator("#preview").evaluate((canvas) => {
          const pixels = canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data;
          return Array.from(pixels.filter((_, index) => index % 128 === 0));
        });
      const firstFrame = await framePixels();
      await page.locator("[data-source-scrub]").evaluate((input) => {
        input.value = "120";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.waitForFunction(
        () => document.querySelector("#time-current")?.textContent === "00:00:04:00",
      );
      await page.waitForFunction((initial) => {
        const canvas = document.querySelector("#preview");
        const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        return Array.from(pixels.filter((_, index) => index % 128 === 0)).some(
          (value, index) => value !== initial[index],
        );
      }, firstFrame);
      assert.deepEqual((await state(page)).project, before.project);
      assert.equal((await state(page)).playheadFrame, before.playheadFrame);
      await page.locator('.transport [data-action="play"]').click();
      await page.waitForFunction(
        () => Number(document.querySelector("[data-source-scrub]")?.value) > 123,
      );
      await page.locator('.transport [data-action="play"]').click();
      assert.deepEqual(
        (await state(page)).project,
        before.project,
        "Preview playback does not save an edit",
      );
      assert.equal((await state(page)).playheadFrame, before.playheadFrame);
      await page.screenshot({
        path: resolve(artifacts, "media-source-preview.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 640, height: 960 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({
        path: resolve(artifacts, "media-source-preview-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator('[data-action="return-composition"]').click();
      assert.equal(await page.locator("#preview").getAttribute("aria-label"), "当前剪辑画面");
      assert.equal(await page.locator("[data-source-scrub]").count(), 0);
      await card.locator(".asset-preview-name").click();
      assert.equal(await page.locator("#preview").getAttribute("aria-label"), "原素材画面");
      assert.equal(await page.locator('[data-tab="media"].active').count(), 1);
      assert.deepEqual(
        (await state(page)).project,
        before.project,
        "The filename also previews without insertion",
      );
    } finally {
      await page.close();
    }
  },
);

test(
  "image and WAV card previews preserve the composition playhead and the add button remains independent",
  { timeout: 45_000 },
  async () => {
    const { page, video, audio } = await importedPage();
    try {
      const png = Buffer.from(
        await page.evaluate(() => {
          const canvas = document.createElement("canvas");
          canvas.width = 80;
          canvas.height = 40;
          const context = canvas.getContext("2d");
          context.fillStyle = "#db5823";
          context.fillRect(0, 0, 40, 40);
          context.fillStyle = "#186bd9";
          context.fillRect(40, 0, 40, 40);
          return canvas.toDataURL("image/png").split(",")[1];
        }),
        "base64",
      );
      managedSources.set(`/media/asset-${createHash("sha256").update(png).digest("hex")}`, {
        bytes: png,
        mimeType: "image/png",
      });
      await page.locator("#media-input").setInputFiles({
        name: "preview-colors.png",
        mimeType: "image/png",
        buffer: png,
      });
      await page.waitForFunction(
        () => window.__roughCutTools.read_video_project().project.assets.length === 3,
      );
      await saved(page);
      const before = await state(page);
      const image = before.project.assets.find((asset) => asset.kind === "image");
      assert.ok(before.playheadFrame > 0);
      await page.locator(`[data-preview-asset="${image.id}"] .asset-thumbnail`).click();
      assert.equal(await page.locator('[data-tab="media"].active').count(), 1);
      assert.equal(await page.locator("#preview").getAttribute("aria-label"), "原素材画面");
      await page.waitForFunction(() => {
        const canvas = document.querySelector("#preview");
        const context = canvas.getContext("2d");
        const left = context.getImageData(canvas.width / 4, canvas.height / 2, 1, 1).data;
        const right = context.getImageData((canvas.width * 3) / 4, canvas.height / 2, 1, 1).data;
        return left[0] > 200 && left[1] < 110 && left[2] < 70 && right[0] < 60 && right[2] > 190;
      });
      assert.equal(await page.locator('.transport [data-action="play"]').isDisabled(), true);
      assert.deepEqual((await state(page)).project, before.project);
      assert.equal((await state(page)).playheadFrame, before.playheadFrame);
      await page.locator(`[data-preview-asset="${audio.id}"] .asset-preview-name`).click();
      assert.equal(await page.locator("[data-source-audio]").isVisible(), true);
      assert.match(await page.locator("[data-source-audio]").textContent(), /音频|声音|播放|试听/);
      assert.equal(await page.locator('.transport [data-action="play"]').isDisabled(), false);
      await page.locator('.transport [data-action="play"]').click();
      await page.waitForFunction(
        () => Number(document.querySelector("[data-source-scrub]")?.value) > 0,
      );
      await page.locator('[data-action="return-composition"]').click();
      assert.equal(await page.locator("#preview").getAttribute("aria-label"), "当前剪辑画面");
      assert.equal(await page.locator("[data-source-audio]").count(), 0);
      assert.equal((await state(page)).playheadFrame, before.playheadFrame);
      assert.deepEqual((await state(page)).project, before.project);
      await page.locator(`[data-add-asset="${video.id}"]`).click();
      await saved(page);
      const added = await state(page);
      assert.equal(added.project.revision, before.project.revision + 1);
      assert.equal(added.project.clips.length, before.project.clips.length + 1);
      assert.deepEqual(added.project.clips.slice(0, -1), before.project.clips);
      assert.equal(added.project.clips.at(-1).assetId, video.id);
      assert.equal(await page.locator("#preview").getAttribute("aria-label"), "当前剪辑画面");
      assert.equal(
        await page.locator("[data-source-scrub]").count(),
        0,
        "Clicking + must not bubble into source preview",
      );
    } finally {
      await page.close();
    }
  },
);

test(
  "selected video cards form an ordered rough-cut queue with independent drafts and one undoable insertion",
  { timeout: 60_000 },
  async () => {
    const { page, video } = await importedPage();
    try {
      const secondPath = join(directory, "second-source.mp4");
      const generated = spawnSync(
        "ffmpeg",
        [
          "-nostdin",
          "-hide_banner",
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=blue:size=320x180:rate=30:duration=4",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          secondPath,
        ],
        { encoding: "utf8" },
      );
      assert.equal(
        generated.status,
        0,
        `The second queue item must be real video: ${generated.stderr}`,
      );
      const bytes = await readFile(secondPath);
      managedSources.set(`/media/asset-${createHash("sha256").update(bytes).digest("hex")}`, {
        bytes,
        mimeType: "video/mp4",
      });
      await page.locator("#media-input").setInputFiles(secondPath);
      await page.waitForFunction(
        () => window.__roughCutTools.read_video_project().project.assets.length === 3,
      );
      await saved(page);
      const before = await state(page);
      const second = before.project.assets.find((asset) => asset.name === "second-source.mp4");
      assert.equal(second.durationFrames, 120);
      await page.locator(`[data-select-media="${second.id}"]`).check();
      await page.locator(`[data-select-media="${video.id}"]`).check();
      assert.equal(
        await page.locator("#preview").getAttribute("aria-label"),
        "当前剪辑画面",
        "Selecting cards must not trigger their preview handler",
      );
      assert.deepEqual((await state(page)).project, before.project);
      await page.locator('[data-action="batch-roughcut"]').click();
      assert.equal(
        await page.locator("#roughcut-source").inputValue(),
        video.id,
        "The initial queue follows the material list, not checkbox click order",
      );
      assert.equal(
        await page.locator('[data-action="roughcut-queue-toggle"]').getAttribute("aria-expanded"),
        "false",
      );
      await seekSource(page, 30);
      await page.keyboard.press("i");
      await seekSource(page, 59);
      await page.keyboard.press("o");
      await page.locator('[data-roughcut-field="name"]').fill("第一份的草稿");
      await page.locator('[data-action="roughcut-queue-next"]').click();
      assert.equal(await page.locator("#roughcut-source").inputValue(), second.id);
      await seekSource(page, 0);
      await page.keyboard.press("i");
      await seekSource(page, 29);
      await page.keyboard.press("o");
      await page.locator('[data-roughcut-field="name"]').fill("第二份的草稿");
      await page.locator('[data-action="roughcut-queue-previous"]').click();
      assert.equal(await page.locator("#roughcut-in").inputValue(), "00:00:01:00");
      assert.equal(await page.locator("#roughcut-out").inputValue(), "00:00:02:00");
      assert.equal(await page.locator('[data-roughcut-field="name"]').inputValue(), "第一份的草稿");
      assert.deepEqual(
        (await state(page)).project,
        before.project,
        "Switching sources preserves unsaved drafts without edits",
      );
      await page.locator('[data-action="roughcut-save"]').click();
      await saved(page);
      await page.locator('[data-action="roughcut-queue-next"]').click();
      assert.equal(await page.locator("#roughcut-in").inputValue(), "00:00:00:00");
      assert.equal(await page.locator("#roughcut-out").inputValue(), "00:00:01:00");
      assert.equal(await page.locator('[data-roughcut-field="name"]').inputValue(), "第二份的草稿");
      await page.locator('[data-action="roughcut-save"]').click();
      await saved(page);
      const marked = (await state(page)).project;
      assert.deepEqual(
        marked.roughCuts.map(({ assetId, inFrame, outFrame }) => [assetId, inFrame, outFrame]),
        [
          [video.id, 30, 60],
          [second.id, 0, 30],
        ],
      );
      assert.deepEqual(marked.clips, before.project.clips);
      await page.locator('[data-action="roughcut-queue-toggle"]').focus();
      await page.keyboard.press("Space");
      const firstCheckbox = page.locator(
        `[data-roughcut-field="queue-enabled"][data-asset-id="${video.id}"]`,
      );
      await firstCheckbox.uncheck();
      await firstCheckbox.check();
      assert.deepEqual(
        await page
          .locator("[data-roughcut-queue-row]")
          .evaluateAll((rows) =>
            rows
              .filter((row) => row.querySelector('input[type="checkbox"]')?.checked)
              .map((row) => row.dataset.roughcutQueueRow),
          ),
        [second.id, video.id],
      );
      assert.equal(
        await page.locator('[data-action="roughcut-queue-toggle"]').getAttribute("aria-expanded"),
        "true",
        "Editing queue selection must keep its picker open",
      );
      await page.screenshot({ path: resolve(artifacts, "rough-cut-queue.png"), fullPage: true });
      await page.setViewportSize({ width: 640, height: 960 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({
        path: resolve(artifacts, "rough-cut-queue-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator('[data-action="roughcut-queue-append"]').click();
      await saved(page);
      const joined = (await state(page)).project;
      assert.equal(joined.revision, marked.revision + 1, "All selected cuts are one edit");
      assert.deepEqual(joined.clips.slice(0, before.project.clips.length), before.project.clips);
      assert.deepEqual(
        joined.clips
          .slice(before.project.clips.length)
          .map(({ assetId, inFrame, outFrame }) => [assetId, inFrame, outFrame]),
        [
          [second.id, 0, 30],
          [video.id, 30, 60],
        ],
      );
      assert.deepEqual(joined.roughCuts, marked.roughCuts);
      await page.locator('.source-history [data-action="undo"]').click();
      await saved(page);
      const undone = (await state(page)).project;
      assert.deepEqual(
        undone.clips,
        before.project.clips,
        "One undo removes the whole queue insertion",
      );
      assert.deepEqual(undone.roughCuts, marked.roughCuts, "Undo keeps the saved source marks");
    } finally {
      await page.close();
    }
  },
);

test(
  "real source preview, I/O marks, invert/undo, ordered cuts and portable project survive a complete workflow",
  { timeout: 90_000 },
  async () => {
    const { page, video, audio } = await importedPage();
    try {
      const before = await state(page);
      await page.locator(`[data-rough-source="${video.id}"]`).click();
      assert.equal(await page.locator("#preview").getAttribute("aria-label"), "原素材画面");
      await seekSource(page, 30);
      await page.locator('[data-action="roughcut-play"]').click();
      await page.waitForFunction(
        () => Number(document.querySelector("[data-roughcut-scrub]")?.value) > 35,
      );
      await page.locator('[data-action="roughcut-play"]').click();
      assert.deepEqual(
        (await state(page)).project,
        before.project,
        "Source playback does not edit the composition",
      );
      assert.equal(
        (await state(page)).playheadFrame,
        before.playheadFrame,
        "Source playback has its own playhead",
      );
      const colors = await page.locator("#preview").evaluate((canvas) => {
        const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        const unique = new Set();
        for (let offset = 0; offset < data.length; offset += 64)
          unique.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
        return unique.size;
      });
      assert.ok(colors > 20, "The source preview actually decodes the colorful video fixture");
      await page.locator('[data-action="return-composition"]').click();
      assert.equal((await state(page)).playheadFrame, before.playheadFrame);
      await page.locator(`[data-rough-source="${audio.id}"]`).click();
      assert.equal(await page.locator("#roughcut-source").inputValue(), audio.id);
      await page.locator('[data-action="roughcut-play"]').click();
      await page.waitForFunction(
        () => Number(document.querySelector("[data-roughcut-scrub]")?.value) > 0,
      );
      assert.deepEqual(
        (await state(page)).project,
        before.project,
        "Previewing the real WAV does not add an audio track",
      );
      assert.equal((await state(page)).playheadFrame, before.playheadFrame);
      await page.locator("#roughcut-source").selectOption(video.id);

      await seekSource(page, 30);
      await page.keyboard.press("i");
      await seekSource(page, 59);
      await page.keyboard.press("o");
      assert.equal(await page.locator("#roughcut-in").inputValue(), "00:00:01:00");
      assert.equal(
        await page.locator("#roughcut-out").inputValue(),
        "00:00:02:00",
        "O includes the current source frame",
      );
      assert.deepEqual(
        (await state(page)).project,
        before.project,
        "Unsaved I/O marks are only a draft",
      );
      await page.locator('[data-roughcut-field="name"]').fill('开场, "重点"');
      await page.locator('[data-action="roughcut-save"]').click();
      await saved(page);
      // Saving a new range starts a fresh draft: the next + must append rather
      // than accidentally overwrite the first saved marker.
      await markRange(page, 90, 120, "结尾", true);
      const marked = await state(page);
      assert.deepEqual(
        marked.project.roughCuts.map(({ inFrame, outFrame, name }) => [inFrame, outFrame, name]),
        [
          [30, 60, '开场, "重点"'],
          [90, 120, "结尾"],
        ],
      );
      assert.deepEqual(marked.project.clips, before.project.clips);
      assert.equal(marked.playheadFrame, before.playheadFrame);
      const [first, second] = marked.project.roughCuts;

      await page.locator('[data-action="roughcut-invert"]').click();
      await saved(page);
      assert.deepEqual(
        (await state(page)).project.roughCuts.map(({ inFrame, outFrame }) => [inFrame, outFrame]),
        [
          [0, 30],
          [60, 90],
          [120, 180],
        ],
      );
      await page.locator('.source-history [data-action="undo"]').click();
      await saved(page);
      assert.deepEqual(
        (await state(page)).project.roughCuts,
        marked.project.roughCuts,
        "Undo restores the original marker IDs, names and ranges",
      );
      assert.deepEqual((await state(page)).project.clips, before.project.clips);

      await page.locator(`[data-action="roughcut-up"][data-id="${second.id}"]`).click();
      await saved(page);
      const ordered = (await state(page)).project;
      assert.deepEqual(
        ordered.roughCuts.map(({ id }) => id),
        [second.id, first.id],
      );
      assert.deepEqual(
        await page
          .locator("[data-roughcut-row]")
          .evaluateAll((rows) => rows.map((row) => row.dataset.roughcutRow)),
        [second.id, first.id],
      );

      await page.locator(`[data-action="roughcut-select"][data-id="${first.id}"]`).click();
      const name = page.locator('[data-roughcut-field="name"]');
      await name.fill("typing");
      for (const key of ["Backspace", "Delete", "i", "o", "b", "+"]) await name.press(key);
      assert.equal(await name.inputValue(), "typiniob+");
      assert.deepEqual(
        (await state(page)).project,
        ordered,
        "Editing a name cannot trigger marker, split or composition deletion shortcuts",
      );
      await page.locator("#roughcut-in").fill("1");
      await page.locator("#roughcut-in").press("Backspace");
      assert.deepEqual(
        (await state(page)).project,
        ordered,
        "Deleting an input value does not delete the selected composition clip",
      );
      // Reload the saved marker to discard this unsaved typing exercise.
      await page.locator(`[data-action="roughcut-select"][data-id="${first.id}"]`).click();

      const csv = await download(page, '[data-action="roughcut-csv"]');
      assert.equal(csv.name, "rough-cut-source-保留段.csv");
      assert.equal(csv.bytes.toString("utf8"), '"3","4","结尾"\r\n"1","2","开场, ""重点"""\r\n');
      await page.locator('[data-action="roughcut-append"]').click();
      await saved(page);
      const assembled = (await state(page)).project;
      assert.deepEqual(assembled.clips[0], before.project.clips[0]);
      assert.deepEqual(
        assembled.clips
          .slice(1)
          .map(({ assetId, inFrame, outFrame }) => [assetId, inFrame, outFrame]),
        [
          [video.id, 90, 120],
          [video.id, 30, 60],
        ],
        "Joining uses list order and exact source ranges",
      );
      assert.deepEqual(assembled.roughCuts, ordered.roughCuts);

      const json = await download(page, '[data-action="save-project"]');
      assert.deepEqual(JSON.parse(json.bytes.toString()).roughCuts, assembled.roughCuts);
      await page.locator('[data-action="new"]').click();
      await page.waitForFunction(
        () => window.__roughCutTools.read_video_project().project.assets.length === 0,
      );
      await page
        .locator("#project-input")
        .setInputFiles({ name: json.name, mimeType: "application/json", buffer: json.bytes });
      await saved(page);
      assert.deepEqual(
        (await state(page)).project,
        assembled,
        "Opening the downloaded JSON keeps markers and assembled clips intact",
      );
      await page
        .locator("#media-input")
        .setInputFiles([sourcePath, resolve(root, "tests/fixtures/static-tone.wav")]);
      await page.waitForFunction(
        () => window.__roughCutTools.read_video_project().missingAssetIds.length === 0,
      );
      assert.equal(
        (await state(page)).project.assets.length,
        2,
        "Reconnecting source files does not duplicate saved assets",
      );
      await page.locator(`[data-rough-source="${video.id}"]`).click();
      assert.equal(await page.locator("[data-roughcut-row]").count(), 2);
      await seekSource(page, 40);
      await page.waitForFunction(() => {
        const toast = document.querySelector("#toast");
        return !toast || getComputedStyle(toast).opacity === "0";
      });
      await page.screenshot({ path: resolve(artifacts, "rough-cut.png"), fullPage: true });
      await page.setViewportSize({ width: 640, height: 960 });
      await seekSource(page, 40);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        "The 640px editor must not overflow horizontally",
      );
      for (const selector of [
        "[data-roughcut-panel]",
        "#roughcut-source",
        ".roughcut-range-editor",
        ".roughcut-batch",
      ]) {
        const bounds = await page.locator(selector).boundingBox();
        assert.ok(
          bounds && bounds.x >= 0 && bounds.x + bounds.width <= 640.5,
          `${selector} remains within the narrow viewport`,
        );
      }
      await page.screenshot({ path: resolve(artifacts, "rough-cut-mobile.png"), fullPage: true });
    } finally {
      await page.close();
    }
  },
);

test(
  "audio source marks append to independent audio without changing the retained video",
  { timeout: 45_000 },
  async () => {
    const { page, audio } = await importedPage();
    try {
      const before = (await state(page)).project;
      await page.locator(`[data-rough-source="${audio.id}"]`).click();
      await markRange(page, 0, audio.durationFrames, "短提示音");
      await page.locator('[data-action="roughcut-append"]').click();
      await saved(page);
      const project = (await state(page)).project;
      assert.deepEqual(project.clips, before.clips);
      assert.deepEqual(
        project.audioClips.map(({ assetId, inFrame, outFrame, startFrame }) => [
          assetId,
          inFrame,
          outFrame,
          startFrame,
        ]),
        [[audio.id, 0, audio.durationFrames, 0]],
      );
      await page.locator('.source-history [data-action="undo"]').click();
      await saved(page);
      assert.equal((await state(page)).project.audioClips?.length ?? 0, 0);
      assert.equal(
        (await state(page)).project.roughCuts.length,
        1,
        "Undoing insertion preserves the reusable source mark",
      );
    } finally {
      await page.close();
    }
  },
);
