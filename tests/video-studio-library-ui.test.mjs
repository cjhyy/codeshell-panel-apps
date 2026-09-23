import {
  enterLegacyProduction,
  readSavedEditorDocument,
} from "./helpers/video-studio-editor-fixture.mjs";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";
import { installGenericMediaTaskMock } from "./helpers/video-studio-generic-task.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let output;
const artifacts = resolve(root, "artifacts/video-studio");
const resources = new Map();
const errors = [];
let browser, server, url, directory;
let fixtures;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "video-studio-library-ui-"));
  const [project] = selectProjects(await discoverProjects(), "video-studio");
  const isolatedOutput = join(directory, "package");
  await buildProject({ ...project, output: isolatedOutput }, { log: false });
  output = join(isolatedOutput, "app");
  const video = join(directory, "library-source.mp4");
  const made = spawnSync(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30:duration=6",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      video,
    ],
    { encoding: "utf8" },
  );
  assert.equal(made.status, 0, `The library fixture must be a real playable video: ${made.stderr}`);
  fixtures = [
    { name: "Library-Zulu.mp4", mimeType: "video/mp4", buffer: await readFile(video) },
    {
      name: "Library-Alpha.wav",
      mimeType: "audio/wav",
      buffer: await readFile(resolve(root, "tests/fixtures/static-tone.wav")),
    },
    {
      name: "Library-Bravo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7m8AAAAASUVORK5CYII=",
        "base64",
      ),
    },
  ];
  for (const fixture of fixtures)
    resources.set(
      `/media/asset-${createHash("sha256").update(fixture.buffer).digest("hex")}`,
      fixture,
    );
  await mkdir(artifacts, { recursive: true });
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url || "/", "http://fixture").pathname;
      const asset = resources.get(pathname);
      const path = resolve(output, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!path.startsWith(output + sep)) {
        response.writeHead(403).end();
        return;
      }
      const bytes = asset?.buffer ?? (await readFile(path));
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
      if (start > end || start >= bytes.length) {
        response.writeHead(416).end();
        return;
      }
      response.writeHead(range ? 206 : 200, {
        "Content-Type":
          asset?.mimeType ??
          ({
            ".html": "text/html",
            ".css": "text/css",
            ".mjs": "text/javascript",
            ".mp3": "audio/mpeg",
          }[extname(path)] ||
            "application/octet-stream"),
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      });
      response.end(bytes.subarray(start, end + 1));
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
  assert.deepEqual(errors, [], "Library changes must not produce browser or CSP errors");
});

async function openPage(viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text()))
      errors.push(message.text());
  });
  const installLibraryBridge = () => {
    window.__libraryTools = {};
    window.__libraryHostCalls = [];
    window.codeshellPanel = {
      getContext: async () => ({ cwd: "/isolated/library-ui", theme: "dark" }),
      registerTool(name, handler) {
        window.__libraryTools[name] = handler;
        return () => {};
      },
      on: () => () => {},
      async call(method, params = {}) {
        window.__libraryHostCalls.push({ method, params: structuredClone(params) });
        if (method === "media.status") return { persistent: false };
        if (method === "media.document.get")
          return JSON.parse(
            localStorage.getItem(`document:${params.key}`) ?? '{"revision":0,"data":null}',
          );
        if (method === "media.document.set") {
          if (params.key === "video-studio-current" && window.__libraryFailProjectSave)
            throw new Error("模拟素材删除保存失败");
          const previous = JSON.parse(
            localStorage.getItem(`document:${params.key}`) ?? '{"revision":0}',
          );
          if (previous.revision !== params.baseRevision)
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
        throw new Error(`Unexpected library Host call: ${method}`);
      },
    };
    // This fixture supplies resource storage and persistence. Browser decoders
    // exercise real media; no native source-proxy or waveform processor is installed.
    const readContext = window.codeshellPanel.getContext.bind(window.codeshellPanel);
    window.codeshellPanel.getContext = async () => {
      const context = await readContext();
      return {
        ...context,
        availableMethods: context.availableMethods.filter((method) => !method.startsWith("tasks.")),
      };
    };
  };
  await page.addInitScript({
    content: `(${installGenericMediaTaskMock.toString()})();(${installLibraryBridge.toString()})();`,
  });
  await page.goto(`${url}/?legacyWorkspace=1`);
  await ready(page);
  return page;
}
const ready = async (page) => {
  await enterLegacyProduction(page);
  await page.locator(".asset-list").waitFor();
  await page.waitForFunction(() => {
    if (!window.__libraryTools?.read_video_project) return false;
    const raw = JSON.parse(localStorage.getItem("document:video-studio-current") || "null")?.data;
    const stored = raw?.format === "video-studio-packed-document" ? raw.data : raw;
    const project = window.__libraryTools.read_video_project().project;
    return !stored || (project.id === stored.id && project.revision === stored.revision);
  });
};
const state = (page) => page.evaluate(() => window.__libraryTools.read_video_project());
const canonical = (page) => readSavedEditorDocument(page);
const selectedClipIds = (page) =>
  page
    .locator('[data-et-clip][aria-selected="true"]')
    .evaluateAll((elements) => elements.map((element) => element.dataset.etClip));
const saved = (page) =>
  page.waitForFunction(() => document.querySelector("#save-state")?.textContent === "已自动保存");
const visibleIds = (page) =>
  page
    .locator(".asset-list [data-asset]")
    .evaluateAll((cards) => cards.map((card) => card.dataset.asset));

async function demoPage(viewport) {
  const page = await openPage(viewport);
  await page.locator('[data-action="demo"]').first().click();
  await page.waitForFunction(() =>
    window.__libraryTools
      .read_video_project()
      .project.assets.some((asset) => asset.kind === "demo"),
  );
  await saved(page);
  return page;
}
async function mixedPage(viewport) {
  const page = await demoPage(viewport);
  await page.locator("#media-input").setInputFiles(fixtures);
  await page.waitForFunction(
    () =>
      window.__libraryTools
        .read_video_project()
        .project.assets.filter((asset) => asset.name.startsWith("Library-")).length === 3,
  );
  await saved(page);
  return page;
}
async function menu(page, id) {
  await page.locator(`[data-action="media-menu"][data-id="${id}"]`).click();
  await page.locator("#media-context-menu").waitFor({ state: "visible" });
  return page.locator("#media-context-menu");
}
async function assertNoResourceDeletion(page) {
  const calls = await page.evaluate(() => [
    ...window.__libraryHostCalls,
    ...(window.__genericHostCalls || []),
  ]);
  assert.ok(
    !calls.some((call) =>
      /^(?:resources\.(?:delete|remove|references\.(?:delete|remove))|media\.assets\.(?:delete|remove)|workspace\.(?:delete|remove))$/.test(
        call.method,
      ),
    ),
    "Removing project entries must never delete managed resources or original files",
  );
}

test(
  "timeline menu deletes the pointed video segment, preserves assets and restores with one undo",
  { timeout: 60_000 },
  async () => {
    const page = await demoPage();
    try {
      const before = (await state(page)).project;
      const [first, second] = before.clips;
      await page.locator(`[data-et-clip="${first.id}"]`).click();
      const beforeMenu = await page.locator("[data-ew-seek]").inputValue();
      await page.locator(`[data-et-clip="${second.id}"]`).click({
        button: "right",
        position: { x: 20, y: 20 },
      });
      const context = page.locator("#timeline-context-menu");
      await context.waitFor({ state: "visible" });
      assert.deepEqual(await selectedClipIds(page), [second.id]);
      assert.equal(await page.locator("[data-ew-seek]").inputValue(), beforeMenu);
      assert.deepEqual((await state(page)).project, before);
      assert.match(await context.textContent(), /素材库与原文件保留，可撤销/);
      await context.locator('[data-timeline-menu-action="remove"]').click();
      await saved(page);
      const changed = (await state(page)).project;
      assert.deepEqual(
        changed.clips.map((clip) => clip.id),
        before.clips.filter((clip) => clip.id !== second.id).map((clip) => clip.id),
        "A previously selected clip must never replace the right-click target",
      );
      assert.deepEqual(changed.assets, before.assets);
      for (const asset of before.assets)
        assert.equal(await page.locator(`[data-asset="${asset.id}"]`).count(), 1);
      await page.locator('[data-ew-action="undo"]').click();
      await saved(page);
      const undone = (await state(page)).project;
      for (const field of ["assets", "clips", "audioClips", "captions"])
        assert.deepEqual(undone[field], before[field]);
      await assertNoResourceDeletion(page);

      // A right-button gesture on a trim edge opens the menu without editing the source range.
      const edge = page.locator(`[data-et-clip="${second.id}"] [data-et-edge="right"]`);
      // Media restoration can redraw after undo; hover retries until the live edge is stable.
      await edge.hover();
      const rect = await edge.boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down({ button: "right" });
      await page.mouse.move(rect.x - 60, rect.y + rect.height / 2, { steps: 3 });
      await page.mouse.up({ button: "right" });
      await context.waitFor({ state: "visible" });
      assert.deepEqual((await state(page)).project, undone);
      await page.keyboard.press("Escape");
      assert.equal(await context.count(), 0);
      assert.equal(
        await page
          .locator(`[data-et-clip="${second.id}"]`)
          .evaluate((element) => element === document.activeElement),
        true,
      );
    } finally {
      await page.close();
    }
  },
);

test(
  "timeline audio context menu supports keyboard deletion and undo inside a 390px viewport",
  { timeout: 60_000 },
  async () => {
    const page = await mixedPage({ width: 390, height: 844 });
    try {
      const audio = (await state(page)).project.assets.find(
        (asset) => asset.name === "Library-Alpha.wav",
      );
      // "+" would append after the narration, past what the old view shows; insert at 0 instead.
      await (await menu(page, audio.id)).locator('[data-action="insert-media-playhead"]').click();
      await saved(page);
      const before = (await state(page)).project;
      const beforeDocument = await canonical(page);
      // The 0.12 s tone is 3.6 frames at 30 fps: the import keeps its exact decoded length, so the
      // clip lives on the editor timeline (the old frame view cannot show a partial frame).
      assert.equal(
        beforeDocument.assets.find((asset) => asset.id === audio.id).duration,
        0.12 * 240000,
      );
      const audioClip = beforeDocument.sequences[0].clips.find(
        (clip) => clip.kind === "media" && clip.assetId === audio.id,
      );
      assert.ok(audioClip);
      assert.equal(audioClip.start, 0, "插入到播放头 keeps the playhead position");
      assert.equal(audioClip.duration, 0.12 * 240000);
      const target = page.locator(`[data-et-clip="${audioClip.id}"]`);
      const context = page.locator("#timeline-context-menu");
      await page.locator(`[data-et-clip="${before.clips[0].id}"]`).focus();
      await target.click({ button: "right" });
      await context.waitFor({ state: "visible" });
      assert.deepEqual(await selectedClipIds(page), [audioClip.id]);
      await context.locator('[data-timeline-menu-action="cancel"]').click();
      assert.deepEqual((await state(page)).project, before);

      for (const key of ["Shift+F10", "ContextMenu"]) {
        await target.focus();
        await page.keyboard.press(key);
        await context.waitFor({ state: "visible" });
        const bounds = await context.boundingBox();
        assert.ok(
          bounds.x >= 8 &&
            bounds.x + bounds.width <= 382 &&
            bounds.y >= 8 &&
            bounds.y + bounds.height <= 836,
        );
        assert.deepEqual(await selectedClipIds(page), [audioClip.id]);
        await page.keyboard.press("Escape");
        assert.equal(await target.evaluate((element) => element === document.activeElement), true);
      }
      await target.focus();
      await page.keyboard.press("Shift+F10");
      await context.waitFor({ state: "visible" });
      await page.screenshot({
        path: resolve(artifacts, "timeline-context-menu-390px.png"),
        fullPage: false,
      });
      assert.equal(
        await context
          .locator('[data-timeline-menu-action="remove"]')
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.keyboard.press("Enter");
      await saved(page);
      const changed = (await state(page)).project,
        changedDocument = await canonical(page);
      // Only the audio clip goes; every other clip and all assets stay exactly as they were.
      assert.deepEqual(
        changedDocument.sequences[0].clips,
        beforeDocument.sequences[0].clips.filter((clip) => clip.id !== audioClip.id),
      );
      assert.deepEqual(changedDocument.assets, beforeDocument.assets);
      assert.deepEqual(changed.assets, before.assets);
      await page.locator('[data-ew-action="undo"]').click();
      await saved(page);
      assert.deepEqual((await state(page)).project.audioClips, before.audioClips);
      assert.deepEqual(
        (await canonical(page)).sequences[0].clips.find((clip) => clip.id === audioClip.id),
        audioClip,
      );
      await assertNoResourceDeletion(page);
    } finally {
      await page.close();
    }
  },
);

async function backgroundChangesWhileDeleting(page, assetId) {
  const before = await canonical(page);
  // Exercise the real edit/commit callback while the modal is mounted, as a
  // background publication would; no production implementation is replaced.
  // Find and click in one page task so a background render cannot detach the button in between.
  await page.locator(`[data-add-asset="${assetId}"]`).waitFor({ state: "attached" });
  await page.evaluate(
    (id) => document.querySelector(`[data-add-asset="${CSS.escape(id)}"]`).click(),
    assetId,
  );
  await page.waitForFunction(
    (count) =>
      window.__libraryTools.read_video_project({
        editor: { view: "project", path: "/sequences/0/clips" },
      }).page.total ===
      count + 1,
    before.sequences[0].clips.length,
  );
  await page.locator("#media-input").setInputFiles([fixtures[2]]);
  await page.waitForFunction(() =>
    window.__libraryTools
      .read_video_project()
      .project.assets.some((asset) => asset.name === "Library-Bravo.png"),
  );
  await saved(page);
  return (await state(page)).project;
}

test(
  "replaced or revision-stale timeline menus cannot delete another selection",
  { timeout: 60_000 },
  async () => {
    const page = await demoPage();
    try {
      const before = (await state(page)).project;
      const [first, second] = before.clips;
      await page.locator(`[data-et-clip="${first.id}"]`).click({ button: "right" });
      const staleRemove = await page
        .locator('[data-timeline-menu-action="remove"]')
        .elementHandle();
      await page.locator(`[data-et-clip="${second.id}"]`).click({ button: "right" });
      await staleRemove.evaluate((button) => button.click());
      assert.equal(await page.locator("#timeline-context-menu").isVisible(), true);
      assert.deepEqual((await state(page)).project, before);
      assert.deepEqual(await selectedClipIds(page), [second.id]);
      const replacedRemove = await page
        .locator('[data-timeline-menu-action="remove"]')
        .elementHandle();
      await page.locator("#project-name").evaluate((input) => {
        input.value = "后台更新工程名";
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await saved(page);
      assert.equal(await page.locator("#timeline-context-menu").count(), 0);
      await replacedRemove.evaluate((button) => button.click());
      const after = (await state(page)).project;
      assert.equal(after.name, "后台更新工程名");
      assert.deepEqual(after.clips, before.clips);
      assert.deepEqual(after.assets, before.assets);
    } finally {
      await page.close();
    }
  },
);

test(
  "long timeline clips keep real covers through zoom, trimming and undo with fixed DOM size",
  { timeout: 60_000 },
  async () => {
    const page = await openPage();
    try {
      await page.locator("#media-input").setInputFiles(fixtures[0]);
      await page.waitForFunction(
        () => window.__libraryTools.read_video_project().project.assets.length === 1,
      );
      await saved(page);
      const asset = (await state(page)).project.assets[0];
      await page.locator(`[data-add-asset="${asset.id}"]`).click();
      await saved(page);
      const clip = (await state(page)).project.clips[0];
      const strip = page.locator(`[data-et-clip="${clip.id}"] .et-media-strip`);
      const zoom = async (value) => {
        await page.locator("[data-et-zoom]").evaluate((input, next) => {
          input.value = String(Math.log10(next));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
      };
      const coverReady = () =>
        page.waitForFunction((id) => {
          const canvas = document.querySelector(`[data-et-clip="${id}"] .et-media-strip`);
          if (!canvas || !canvas.width || !canvas.height || canvas.dataset.etMediaState !== "ready")
            return false;
          const pixels = canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data;
          let colorful = 0;
          for (let index = 0; index < pixels.length; index += 4)
            if (
              Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) -
                Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) >
              80
            )
              colorful++;
          return colorful > canvas.width * canvas.height * 0.05;
        }, clip.id);
      const assertCoveredTail = async () => {
        await coverReady();
        const pixels = PNG.sync.read(await strip.screenshot());
        assert.ok(pixels.width > 558, "The clip extends beyond the old eight-cover limit");
        let minimum = 255;
        let maximum = 0;
        // Source-time thumbnails now share one viewport-sized canvas. Keep the
        // original regression: media beyond the old eight-cover cutoff is decoded.
        for (let y = 5; y < 30; y++)
          for (let x = 4; x < 24; x++)
            for (let channel = 0; channel < 3; channel++) {
              const tail = pixels.data[(y * pixels.width + x + 528) * 4 + channel];
              minimum = Math.min(minimum, tail);
              maximum = Math.max(maximum, tail);
            }
        assert.ok(maximum - minimum > 60, "The tail visibly contains the decoded colorful cover");
        assert.equal(await strip.count(), 1);
        assert.equal(
          await strip.evaluate((element) => element.childElementCount),
          0,
          "Clip width does not allocate extra thumbnail elements",
        );
      };
      await zoom(100);
      await assertCoveredTail();
      await page.screenshot({
        path: resolve(artifacts, "timeline-cover-wide.png"),
        fullPage: true,
      });
      await zoom(12);
      await coverReady();
      const small = await strip.boundingBox();
      const actualScale = 10 ** Number(await page.locator("[data-et-zoom]").inputValue());
      assert.ok(small.width < 80, "Zooming out produces a narrow clip");
      assert.ok(
        Math.abs(small.width - 6 * actualScale) < 1,
        "The strip follows the actual logarithmic zoom control",
      );
      assert.equal(small.height, 32, "Source thumbnails retain their timeline strip height");
      assert.equal(await strip.count(), 1);
      await zoom(100);
      const edge = await page
        .locator(`[data-et-clip="${clip.id}"] [data-et-edge="right"]`)
        .boundingBox();
      await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
      await page.mouse.down();
      await page.mouse.move(edge.x + edge.width / 2 - 20, edge.y + edge.height / 2, { steps: 4 });
      await page.mouse.up();
      await saved(page);
      assert.equal((await state(page)).project.clips[0].outFrame, 174);
      await assertCoveredTail();
      await page.locator('[data-ew-action="undo"]').click();
      await saved(page);
      assert.equal((await state(page)).project.clips[0].outFrame, clip.outFrame);
      await assertCoveredTail();
    } finally {
      await page.close();
    }
  },
);

test(
  "used demo deletion supports cancellation, confirmation, undo and a durable reload",
  { timeout: 60_000 },
  async () => {
    const page = await demoPage();
    try {
      const before = (await state(page)).project;
      const asset = before.assets.find((item) => item.kind === "demo");
      assert.ok(before.clips.some((clip) => clip.assetId === asset.id));
      await (await menu(page, asset.id)).locator('[data-action="delete-media"]').click();
      const dialog = page.locator("#media-delete-dialog");
      await dialog.waitFor({ state: "visible" });
      assert.match(await dialog.textContent(), /片段|成片|时间轴/);
      await page.keyboard.press("Escape");
      assert.equal(await dialog.isVisible(), false);
      assert.deepEqual((await state(page)).project, before);
      await (await menu(page, asset.id)).locator('[data-action="delete-media"]').click();
      await dialog.locator('[data-action="confirm-delete-media"]').click();
      await page.waitForFunction(
        (id) =>
          !window.__libraryTools
            .read_video_project()
            .project.assets.some((asset) => asset.id === id),
        asset.id,
      );
      await saved(page);
      const removed = (await state(page)).project;
      assert.ok(!removed.clips.some((clip) => clip.assetId === asset.id));
      assert.equal(removed.assets.length, before.assets.length - 1);
      await page.locator('[data-ew-action="undo"]').click();
      await saved(page);
      assert.deepEqual((await state(page)).project.assets, before.assets);
      assert.deepEqual((await state(page)).project.clips, before.clips);
      await (await menu(page, asset.id)).locator('[data-action="delete-media"]').click();
      await dialog.locator('[data-action="confirm-delete-media"]').click();
      await saved(page);
      await page.reload();
      await ready(page);
      assert.ok(!(await state(page)).project.assets.some((item) => item.id === asset.id));
      assert.equal(await page.locator(`[data-select-media="${asset.id}"]`).count(), 0);
      await assertNoResourceDeletion(page);
    } finally {
      await page.close();
    }
  },
);

test(
  "large, small and list library views keep saved preferences across reload",
  { timeout: 60_000 },
  async () => {
    const page = await mixedPage();
    try {
      const before = (await state(page)).project;
      let largeCardWidth;
      for (const view of ["large", "small", "list"]) {
        await page.waitForFunction(
          () =>
            window.__libraryTools.read_video_project().missingAssetIds.length === 0 &&
            document.querySelectorAll(".asset-card.missing").length === 0,
        );
        await page.locator(`[data-action="media-view"][data-id="${view}"]`).click();
        assert.equal(await page.locator(".asset-list").getAttribute("data-view"), view);
        await page.locator(".asset-list [data-asset]").first().scrollIntoViewIfNeeded();
        const firstCard = await page.locator(".asset-list [data-asset]").nth(0).boundingBox();
        if (view === "large") largeCardWidth = firstCard.width;
        if (view === "small") {
          const secondCard = await page.locator(".asset-list [data-asset]").nth(1).boundingBox();
          assert.ok(
            firstCard.width < largeCardWidth * 0.6,
            "Small thumbnails are visibly narrower than large thumbnails",
          );
          assert.ok(
            Math.abs(firstCard.y - secondCard.y) < 1 && secondCard.x > firstCard.x,
            "The desktop small view places two cards in the same row",
          );
        }
        await page.screenshot({ path: resolve(artifacts, `library-${view}.png`), fullPage: true });
        await page.reload();
        await ready(page);
        await page.waitForFunction(
          (value) => document.querySelector(".asset-list")?.dataset.view === value,
          view,
        );
        assert.deepEqual(
          (await state(page)).project,
          before,
          "View preferences do not revise the video edit",
        );
      }
    } finally {
      await page.close();
    }
  },
);

test(
  "background edits preserve deletion review and require confirmation of the updated scope",
  { timeout: 60_000 },
  async () => {
    const page = await demoPage();
    try {
      const before = (await state(page)).project;
      const asset = before.assets.find((item) => item.kind === "demo");
      await (await menu(page, asset.id)).locator('[data-action="delete-media"]').click();
      const dialog = page.locator("#media-delete-dialog");
      await dialog.waitFor({ state: "visible" });
      const mountedDialog = await dialog.elementHandle();
      assert.match(await dialog.textContent(), /移除\s+1\s+个画面片段/);
      const changed = await backgroundChangesWhileDeleting(page, asset.id);
      assert.equal(
        await mountedDialog.evaluate((element) => element.isConnected && element.open),
        true,
        "A background commit keeps the same review dialog mounted",
      );
      assert.match(
        await dialog.textContent(),
        /移除\s+1\s+个画面片段/,
        "The displayed scope stays the one the user initially reviewed",
      );
      await dialog.locator('[data-action="confirm-delete-media"]').click();
      await page.waitForFunction(() =>
        document.querySelector("#toast")?.textContent?.includes("工程已更新"),
      );
      assert.equal(await dialog.isVisible(), true);
      assert.match(await dialog.textContent(), /移除\s+2\s+个画面片段/);
      assert.deepEqual(
        (await state(page)).project,
        changed,
        "The first confirmation refreshes the scope without deleting anything",
      );
      await dialog.locator('[data-action="confirm-delete-media"]').click();
      await dialog.waitFor({ state: "hidden" });
      await saved(page);
      const removed = (await state(page)).project;
      assert.ok(!removed.assets.some((item) => item.id === asset.id));
      assert.ok(
        (await canonical(page)).sequences.every(
          (sequence) =>
            !sequence.clips.some((clip) => clip.kind === "media" && clip.assetId === asset.id),
        ),
        "Deletion also removes the newly added overlay from the canonical sequence",
      );
      assert.ok(
        removed.assets.some((item) => item.name === "Library-Bravo.png"),
        "Content published during review survives the deletion",
      );
      assert.deepEqual(
        removed.clips.map((clip) => clip.id),
        changed.clips.filter((clip) => clip.assetId !== asset.id).map((clip) => clip.id),
      );
      await page.reload();
      await ready(page);
      assert.deepEqual((await state(page)).project, removed);
      await assertNoResourceDeletion(page);
    } finally {
      await page.close();
    }
  },
);

for (const dismissal of ["button", "Escape"]) {
  test(
    `cancelling deletion with ${dismissal} redraws background edits without removing media`,
    { timeout: 60_000 },
    async () => {
      const page = await demoPage();
      try {
        const before = (await state(page)).project;
        const beforeCanonical = await canonical(page);
        const asset = before.assets.find((item) => item.kind === "demo");
        await (await menu(page, asset.id)).locator('[data-action="delete-media"]').click();
        const dialog = page.locator("#media-delete-dialog");
        await dialog.waitFor({ state: "visible" });
        const changed = await backgroundChangesWhileDeleting(page, asset.id);
        const changedCanonical = await canonical(page);
        const imported = changed.assets.find((item) => item.name === "Library-Bravo.png");
        assert.equal(
          await page.locator(`[data-asset="${imported.id}"]`).count(),
          0,
          "Background commits defer library drawing until review ends",
        );
        if (dismissal === "Escape") await page.keyboard.press("Escape");
        else await dialog.locator('[data-action="close-dialog"]').last().click();
        await dialog.waitFor({ state: "hidden" });
        await page.locator(`[data-asset="${imported.id}"]`).waitFor();
        const added = changedCanonical.sequences[0].clips.filter(
          (clip) => !beforeCanonical.sequences[0].clips.some((previous) => previous.id === clip.id),
        );
        assert.equal(added.length, 1);
        assert.equal(await page.locator(`[data-et-clip="${added[0].id}"]`).isVisible(), true);
        assert.deepEqual(await canonical(page), changedCanonical);
        assert.deepEqual((await state(page)).project, changed);
        await assertNoResourceDeletion(page);
      } finally {
        await page.close();
      }
    },
  );
}

test(
  "type filtering and name or duration sorting apply to the visible selection only",
  { timeout: 60_000 },
  async () => {
    const page = await mixedPage();
    try {
      const project = (await state(page)).project;
      for (const kind of ["video", "audio", "image", "demo"]) {
        await page.locator("[data-media-filter]").selectOption(kind);
        const ids = await visibleIds(page);
        assert.ok(ids.length > 0);
        assert.ok(
          ids.every((id) => project.assets.find((asset) => asset.id === id)?.kind === kind),
          `The ${kind} filter must only show matching media`,
        );
      }
      await page.locator("[data-media-filter]").selectOption("all");
      await page.locator("#asset-search").fill("Library-");
      await page.locator("[data-media-sort]").selectOption("name");
      const named = project.assets
        .filter((asset) => asset.name.startsWith("Library-"))
        .sort((a, b) => a.name.localeCompare(b.name));
      assert.deepEqual(
        await visibleIds(page),
        named.map((asset) => asset.id),
      );
      await page.locator("[data-media-sort]").selectOption("duration");
      const durations = (await visibleIds(page)).map(
        (id) => project.assets.find((asset) => asset.id === id).durationFrames,
      );
      assert.deepEqual(
        durations,
        [...durations].sort((a, b) => b - a),
      );
      await page.locator("[data-media-sort]").selectOption("original");
      assert.deepEqual(
        await visibleIds(page),
        project.assets
          .filter((asset) => asset.name.startsWith("Library-"))
          .map((asset) => asset.id),
      );
      await page.locator('[data-action="select-media"]').click();
      const checked = await page
        .locator("[data-select-media]:checked")
        .evaluateAll((items) => items.map((item) => item.dataset.selectMedia));
      assert.deepEqual(new Set(checked), new Set(named.map((asset) => asset.id)));
      assert.deepEqual((await state(page)).project, project);
    } finally {
      await page.close();
    }
  },
);

test(
  "multi-select deletion includes images, preserves unrelated clips and never deletes the resources",
  { timeout: 60_000 },
  async () => {
    const page = await mixedPage();
    try {
      const before = (await state(page)).project;
      const imported = before.assets.filter((asset) => asset.name.startsWith("Library-"));
      assert.ok(imported.some((asset) => asset.kind === "image"));
      await page.locator("#asset-search").fill("Library-");
      await page.locator('[data-action="select-media"]').click();
      await page.locator('[data-action="delete-media"]').first().click();
      await page.waitForFunction(
        () =>
          !window.__libraryTools
            .read_video_project()
            .project.assets.some((asset) => asset.name.startsWith("Library-")),
      );
      await saved(page);
      assert.equal(
        await page.locator("#media-delete-dialog").isVisible(),
        false,
        "Unused assets do not need the used-clip confirmation",
      );
      const after = (await state(page)).project;
      assert.deepEqual(after.clips, before.clips);
      assert.deepEqual(after.audioClips, before.audioClips);
      assert.equal(after.assets.length, before.assets.length - imported.length);
      await page.reload();
      await ready(page);
      assert.ok(
        !(await state(page)).project.assets.some((asset) =>
          imported.some((item) => item.id === asset.id),
        ),
      );
      await assertNoResourceDeletion(page);
    } finally {
      await page.close();
    }
  },
);

test(
  "failed project persistence leaves an unused image available for a safe deletion retry",
  { timeout: 60_000 },
  async () => {
    const page = await mixedPage();
    try {
      const before = (await state(page)).project;
      const image = before.assets.find((asset) => asset.kind === "image");
      await page.evaluate(() => {
        window.__libraryFailProjectSave = true;
      });
      await (await menu(page, image.id)).locator('[data-action="delete-media"]').click();
      await page.waitForFunction(() =>
        document.querySelector("#toast")?.textContent?.includes("模拟素材删除保存失败"),
      );
      assert.deepEqual((await state(page)).project, before);
      await page.evaluate(() => {
        window.__libraryFailProjectSave = false;
      });
      await (await menu(page, image.id)).locator('[data-action="delete-media"]').click();
      await page.waitForFunction(
        (id) =>
          !window.__libraryTools
            .read_video_project()
            .project.assets.some((asset) => asset.id === id),
        image.id,
      );
      await saved(page);
      await assertNoResourceDeletion(page);
    } finally {
      await page.close();
    }
  },
);

async function checkContextMenu(viewport, artifact) {
  const page = await mixedPage(viewport);
  try {
    await page.locator('[data-action="media-view"][data-id="list"]').click();
    await page.locator("[data-media-filter]").selectOption("video");
    const before = await state(page);
    const asset = before.project.assets.find((item) => item.kind === "video");
    const card = page.locator(`.asset-list [data-asset="${asset.id}"]`);
    await card.scrollIntoViewIfNeeded();
    const box = await card.boundingBox();
    await card.click({
      button: "right",
      position: { x: Math.max(2, box.width - 5), y: Math.max(2, box.height - 5) },
    });
    const popup = page.locator("#media-context-menu");
    await popup.waitFor({ state: "visible" });
    const bounds = await popup.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= viewport.width + 1 &&
        bounds.y + bounds.height <= viewport.height + 1,
      "A pointer-opened menu stays inside the viewport",
    );
    assert.equal(
      await page.locator("#studio .workspace.editor-source-mode").count(),
      0,
      "Right-clicking must not switch or start the source preview",
    );
    // Narrow (≤900px) panels show the library in place of the preview; the menu must not swap it away.
    assert.equal(
      await page
        .locator(viewport.width > 900 ? "[data-ew-canvas]" : "#studio .library-panel")
        .isVisible(),
      true,
      "Right-clicking must not switch or start the source preview",
    );
    assert.deepEqual((await state(page)).project, before.project);
    assert.equal((await state(page)).playheadFrame, before.playheadFrame);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({ path: resolve(artifacts, artifact) });
    assert.equal(await popup.isVisible(), true, "The menu stays visible through browser painting");
    await page.keyboard.press("Escape");
    assert.equal(await popup.isVisible(), false);
    await menu(page, asset.id);
    await page.locator(".section-title h2").first().click();
    assert.equal(await popup.isVisible(), false);
    assert.equal(
      await page
        .locator(viewport.width > 900 ? "[data-ew-canvas]" : "#studio .library-panel")
        .isVisible(),
      true,
    );
    assert.equal(await page.locator("#studio .workspace.editor-source-mode").count(), 0);
    assert.deepEqual((await state(page)).project, before.project);
  } finally {
    await page.close();
  }
}

test(
  "desktop material context menus support Escape and outside clicks without preview side effects",
  { timeout: 60_000 },
  async () => {
    await checkContextMenu({ width: 1440, height: 1000 }, "library-menu-desktop.png");
  },
);

test(
  "material keyboard menus and deletion remain available beside the canonical timeline",
  { timeout: 60_000 },
  async () => {
    const page = await openPage();
    let releaseMedia;
    const mediaGate = new Promise((resolve) => {
      releaseMedia = resolve;
    });
    let markRequested;
    const mediaRequested = new Promise((resolve) => {
      markRequested = resolve;
    });
    await page.route("**/demo-narration.mp3", async (route) => {
      markRequested();
      await mediaGate;
      await route.continue();
    });
    try {
      await page.locator('[data-action="demo"]').first().click();
      await mediaRequested;
      await saved(page);
      const before = (await state(page)).project;
      const asset = before.assets.find((item) => item.kind === "demo");
      const card = page.locator(`.asset-list [data-asset="${asset.id}"]`);
      const popup = page.locator("#media-context-menu");
      await card.focus();
      const originalCard = await card.elementHandle();
      releaseMedia();
      await page.waitForFunction((element) => !element.isConnected, originalCard);
      assert.equal(
        await card.evaluate((element) => element === document.activeElement),
        true,
        "Finishing a background media restore preserves the focused material card",
      );
      for (const key of ["Shift+F10", "ContextMenu"]) {
        await card.focus();
        await page.keyboard.press(key);
        await popup.waitFor({ state: "visible" });
        await page.keyboard.press("Escape");
        await popup.waitFor({ state: "hidden" });
      }
      assert.equal(await page.locator("[data-ew-canvas]").isVisible(), true);
      await card.focus();
      await page.keyboard.press("Delete");
      const dialog = page.locator("#media-delete-dialog");
      await dialog.waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      assert.deepEqual((await state(page)).project, before);
      await card.focus();
      await page.keyboard.press("Backspace");
      await dialog.waitFor({ state: "visible" });
      await dialog.locator('[data-action="confirm-delete-media"]').click();
      await saved(page);
      assert.equal(
        (await canonical(page)).assets.some((item) => item.id === asset.id),
        false,
      );
      await page.locator('[data-ew-action="undo"]').click();
      await saved(page);
      assert.equal(
        (await canonical(page)).assets.some((item) => item.id === asset.id),
        true,
      );
      await assertNoResourceDeletion(page);
    } finally {
      releaseMedia();
      await page.close();
    }
  },
);

test(
  "390px material context menus stay within the viewport without starting playback",
  { timeout: 60_000 },
  async () => {
    await checkContextMenu({ width: 390, height: 844 }, "library-menu-mobile.png");
  },
);

test(
  "late media decoding and programmatic scroll keep an open context menu actionable",
  { timeout: 60_000 },
  async () => {
    const page = await openPage();
    let releaseMedia;
    const mediaGate = new Promise((resolve) => {
      releaseMedia = resolve;
    });
    let markRequested;
    const mediaRequested = new Promise((resolve) => {
      markRequested = resolve;
    });
    await page.route("**/demo-narration.mp3", async (route) => {
      markRequested();
      await mediaGate;
      await route.continue();
    });
    try {
      await page.locator('[data-action="demo"]').first().click();
      await mediaRequested;
      await saved(page);
      const before = (await state(page)).project;
      const asset = before.assets.find((item) => item.kind === "demo");
      const popup = await menu(page, asset.id);
      await page.locator(".library-panel").evaluate(async (element) => {
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      assert.equal(await popup.isVisible(), true);
      const originalCard = await page.locator(`[data-asset="${asset.id}"]`).elementHandle();
      releaseMedia();
      // Real audio decoding finishes restoreManagedMedia, which redraws the library.
      await page.waitForFunction((element) => !element.isConnected, originalCard);
      assert.equal(await popup.isVisible(), true, "A completed media restore keeps the menu open");
      await popup.locator('[data-action="delete-media"]').click();
      await page.locator("#media-delete-dialog").waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      assert.deepEqual((await state(page)).project, before);
      await assertNoResourceDeletion(page);
    } finally {
      releaseMedia();
      await page.close();
    }
  },
);
