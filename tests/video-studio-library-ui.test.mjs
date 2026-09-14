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
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";
import { installGenericMediaTaskMock } from "./helpers/video-studio-generic-task.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "panels/video-studio/app");
const artifacts = resolve(root, "artifacts/video-studio");
const resources = new Map();
const errors = [];
let browser, server, url, directory;
let fixtures;

before(async () => {
  if (process.env.VIDEO_STUDIO_SKIP_BUILD !== "1") {
    const [project] = selectProjects(await discoverProjects(), "video-studio");
    await buildProject(project);
  }
  directory = await mkdtemp(join(tmpdir(), "video-studio-library-ui-"));
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
  await page.addInitScript(installGenericMediaTaskMock);
  await page.addInitScript(() => {
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
  });
  await page.goto(url);
  await ready(page);
  return page;
}
const ready = async (page) => {
  await page.locator(".asset-list").waitFor();
  await page.waitForFunction(() => {
    if (!window.__libraryTools?.read_video_project) return false;
    const stored = JSON.parse(
      localStorage.getItem("document:video-studio-current") || "null",
    )?.data;
    const project = window.__libraryTools.read_video_project().project;
    return !stored || (project.id === stored.id && project.revision === stored.revision);
  });
};
const state = (page) => page.evaluate(() => window.__libraryTools.read_video_project());
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

async function backgroundChangesWhileDeleting(page, assetId) {
  const before = (await state(page)).project;
  // Exercise the real edit/commit callback while the modal is mounted, as a
  // background publication would; no production implementation is replaced.
  await page.locator(`[data-add-asset="${assetId}"]`).evaluate((element) => element.click());
  await page.waitForFunction(
    (count) => window.__libraryTools.read_video_project().project.clips.length === count + 1,
    before.clips.length,
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
      await page.locator('[data-action="undo"]').first().click();
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
        const asset = before.assets.find((item) => item.kind === "demo");
        await (await menu(page, asset.id)).locator('[data-action="delete-media"]').click();
        const dialog = page.locator("#media-delete-dialog");
        await dialog.waitFor({ state: "visible" });
        const changed = await backgroundChangesWhileDeleting(page, asset.id);
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
        assert.equal(await page.locator("[data-clip]").count(), changed.clips.length);
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
      await page.locator("#preview").getAttribute("aria-label"),
      "当前剪辑画面",
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
    assert.equal(await page.locator("#preview").getAttribute("aria-label"), "当前剪辑画面");
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
