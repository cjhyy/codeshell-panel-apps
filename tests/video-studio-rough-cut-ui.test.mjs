import {
  enterLegacyProduction,
  readSavedLegacyProject,
  readSavedEditorDocument,
  legacyProjectFromDocument,
} from "./helpers/video-studio-editor-fixture.mjs";
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
let output = resolve(root, "panels/video-studio/app");
const artifacts = resolve(root, "artifacts/video-studio");
const errors = [];
let browser;
let server;
let url;
let directory;
let sourcePath;
const managedSources = new Map();

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "video-studio-rough-cut-ui-"));
  if (process.env.VIDEO_STUDIO_SKIP_BUILD !== "1") {
    const [project] = selectProjects(await discoverProjects(), "video-studio");
    const isolatedOutput = join(directory, "package");
    await buildProject({ ...project, output: isolatedOutput }, { log: false });
    output = join(isolatedOutput, "app");
  }
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

async function openPage(viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({
    viewport,
    acceptDownloads: true,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text()))
      errors.push(message.text());
  });
  // Resource storage, project persistence and AI calls use boundary fixtures.
  // Media decoding, playback, marking, edits and downloads run in the browser.
  const installRoughCutBridge = () => {
    window.__roughCutTools = {};
    window.__roughCutAgentTasks = [];
    const listeners = new Map();
    window.__roughCutEmit = (event, value) => {
      for (const listener of listeners.get(event) || []) listener(value);
    };
    window.codeshellPanel = {
      getContext: async () => ({ cwd: "/isolated/rough-cut-ui", theme: "dark" }),
      registerTool(name, handler) {
        window.__roughCutTools[name] = handler;
        return () => {};
      },
      on(event, listener) {
        const entries = listeners.get(event) || new Set();
        entries.add(listener);
        listeners.set(event, entries);
        return () => entries.delete(listener);
      },
      async call(method, params = {}) {
        if (method === "agent.task.start") {
          const maxTurns = params.maxTurns === undefined ? 8 : Number(params.maxTurns);
          if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 20)
            throw new Error("agent.task.start maxTurns must be an integer from 1 to 20");
          const task = {
            id: `roughcut-ai-${window.__roughCutAgentTasks.length}`,
            status: "running",
            params,
          };
          window.__roughCutAgentTasks.push(task);
          return task;
        }
        if (method === "agent.task.get")
          return window.__roughCutAgentTasks.find((task) => task.id === params.id);
        if (method === "agent.task.cancel") {
          const task = window.__roughCutAgentTasks.find((task) => task.id === params.id);
          if (task) task.status = "cancelled";
          return task || { id: params.id, status: "cancelled" };
        }
        if (method === "media.status") return { persistent: false };
        if (method === "media.document.get")
          return JSON.parse(
            localStorage.getItem(`document:${params.key}`) ?? '{"revision":0,"data":null}',
          );
        if (method === "media.document.set") {
          if (params.key === "video-studio-current" && window.__roughCutRejectProjectSave)
            throw new Error("模拟工程文档写入失败");
          if (
            params.key.startsWith("video-studio-roughcut-ai-") &&
            params.data === null &&
            window.__roughCutRejectDraftClear
          )
            throw new Error("模拟 AI 草稿清理失败");
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
    // This fixture supplies real browser media plus resource/storage and AI boundaries.
    // It does not implement the editor's native source-proxy processor.
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
    content: `(${installGenericMediaTaskMock.toString()})();(${installRoughCutBridge.toString()})();`,
  });
  await page.goto(`${url}/?legacyWorkspace=1`);
  await enterLegacyProduction(page);
  await page.waitForFunction(() => window.__roughCutTools?.read_video_project);
  return page;
}

const state = (page) => page.evaluate(() => window.__roughCutTools.read_video_project());
const saved = (page) =>
  page.waitForFunction(() => document.querySelector("#save-state")?.textContent === "已自动保存");

async function disclosure(page, name, expanded = true) {
  const toggle = page.locator(`[data-action="roughcut-${name}-toggle"]`);
  if ((await toggle.getAttribute("aria-expanded")) !== String(expanded)) await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"), String(expanded));
  assert.equal(
    await page.locator(`#roughcut-${name}-panel`).evaluate((element) => element.hidden),
    !expanded,
  );
}
async function openAI(page) {
  await disclosure(page, "ai");
}
async function openUniform(page) {
  await disclosure(page, "bulk");
  if (!(await page.locator(".roughcut-uniform").evaluate((element) => element.open)))
    await page.locator(".roughcut-uniform summary").click();
}

async function importedVideoQueue() {
  const page = await openPage();
  const bytes = await readFile(sourcePath);
  await page.locator("#media-input").setInputFiles([
    { name: "旅行一.mp4", mimeType: "video/mp4", buffer: bytes },
    { name: "旅行二.mp4", mimeType: "video/mp4", buffer: bytes },
  ]);
  await page.waitForFunction(
    () => window.__roughCutTools.read_video_project().project.assets.length === 2,
  );
  await saved(page);
  const project = (await state(page)).project;
  for (const asset of project.assets)
    await page.locator(`[data-select-media="${asset.id}"]`).check();
  await page.locator('[data-action="batch-roughcut"]').click();
  assert.equal(
    await page.locator('[data-action="roughcut-bulk-toggle"]').getAttribute("aria-expanded"),
    "true",
    "Explicit batch entry opens its secondary controls",
  );
  assert.equal(
    await page.locator('[data-action="roughcut-ai-toggle"]').getAttribute("aria-expanded"),
    "false",
    "Batch entry still leaves AI as an explicit choice",
  );
  assert.equal(await page.evaluate(() => window.__roughCutAgentTasks.length), 0);
  return { page, assets: project.assets };
}

for (const scenario of [
  { name: "desktop", viewport: { width: 1440, height: 1000 }, entry: "source" },
  { name: "390px", viewport: { width: 390, height: 844 }, entry: "sidebar" },
]) {
  test(
    `${scenario.name} ordinary rough-cut entry shows manual I/O in the first screen and keeps AI optional`,
    { timeout: 60_000 },
    async () => {
      const page = await openPage(scenario.viewport);
      try {
        await page.locator("#media-input").setInputFiles(sourcePath);
        await page.waitForFunction(
          () => window.__roughCutTools.read_video_project().project.assets.length === 1,
        );
        await saved(page);
        const before = (await state(page)).project;
        const video = before.assets[0];
        if (scenario.entry === "source")
          await page.locator(`[data-rough-source="${video.id}"]`).click();
        else await page.locator('[data-tab="roughcut"]').click();
        assert.equal(await page.locator("#roughcut-source").inputValue(), video.id);
        assert.equal(await page.locator("#roughcut-bulk-panel").isVisible(), false);
        assert.equal(await page.locator("#roughcut-ai-panel").isVisible(), false);
        assert.equal(
          await page.locator('[data-action="roughcut-bulk-toggle"]').getAttribute("aria-expanded"),
          "false",
        );
        assert.equal(
          await page.locator('[data-action="roughcut-ai-toggle"]').getAttribute("aria-expanded"),
          "false",
        );
        const library = await page.locator(".library-panel").boundingBox();
        for (const selector of [
          "#roughcut-in",
          "#roughcut-out",
          '[data-action="roughcut-mark-in"]',
          '[data-action="roughcut-mark-out"]',
        ]) {
          const bounds = await page.locator(selector).boundingBox();
          assert.ok(
            bounds &&
              bounds.x >= 0 &&
              bounds.x + bounds.width <= scenario.viewport.width + 1 &&
              bounds.y >= Math.max(0, library.y) &&
              bounds.y + bounds.height <=
                Math.min(scenario.viewport.height, library.y + library.height) + 1,
            `${selector} must be usable before any scrolling at ${scenario.name}`,
          );
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        assert.equal(await page.evaluate(() => window.__roughCutAgentTasks.length), 0);
        assert.deepEqual((await state(page)).project, before);
        await page.waitForFunction(() => {
          const toast = document.querySelector("#toast");
          return !toast || getComputedStyle(toast).opacity === "0";
        });
        await page.screenshot({
          path: resolve(artifacts, `rough-cut-manual-${scenario.name}.png`),
        });
        await openAI(page);
        assert.equal(await page.locator("#roughcut-bulk-panel").isVisible(), false);
        assert.equal(
          await page.locator('[data-roughcut-field="ai-scope"]').inputValue(),
          "current",
        );
        await page.locator("#roughcut-ai-panel").scrollIntoViewIfNeeded();
        for (const selector of [
          '[data-roughcut-field="ai-scope"]',
          '[data-action="roughcut-ai-start"]',
        ]) {
          const bounds = await page.locator(selector).boundingBox();
          assert.ok(
            bounds && bounds.x >= 0 && bounds.x + bounds.width <= scenario.viewport.width + 1,
          );
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await page.screenshot({ path: resolve(artifacts, `rough-cut-ai-${scenario.name}.png`) });
        assert.equal(
          await page.evaluate(() => window.__roughCutAgentTasks.length),
          0,
          "Opening optional controls never starts a model task",
        );
        await page.locator("#roughcut-in").fill("1");
        await page.locator("#roughcut-out").fill("2");
        await page.locator('[data-action="roughcut-save"]').click();
        await saved(page);
        assert.equal(
          await page.locator('[data-action="roughcut-bulk-toggle"]').getAttribute("aria-expanded"),
          "false",
          "Saving a manual mark keeps the chosen disclosure state",
        );
        assert.equal(
          await page.locator('[data-action="roughcut-ai-toggle"]').getAttribute("aria-expanded"),
          "true",
        );
        assert.equal(await page.evaluate(() => window.__roughCutAgentTasks.length), 0);
        await page.locator('[data-tab="media"]').click();
        await page.locator(`[data-rough-source="${video.id}"]`).click();
        assert.equal(
          await page.locator("#roughcut-bulk-panel").isVisible(),
          false,
          "A new ordinary entry returns to the current source workflow",
        );
        assert.equal(
          await page.locator('[data-action="roughcut-ai-toggle"]').getAttribute("aria-expanded"),
          "false",
        );
        assert.equal(
          (await state(page)).project.roughCuts.length,
          1,
          "Changing entry mode preserves manual work",
        );
      } finally {
        await page.close();
      }
    },
  );
}

test(
  "uniform batch review previews actual source ranges, discards safely and saves both sources atomically",
  { timeout: 60_000 },
  async () => {
    const { page, assets } = await importedVideoQueue();
    try {
      const before = (await state(page)).project;
      await openUniform(page);
      await page.locator('[data-roughcut-field="batch-head"]').fill("1");
      await page.locator('[data-roughcut-field="batch-tail"]').fill("2");
      await page.locator('[data-action="roughcut-batch-plan"]').click();
      assert.equal(
        await page.locator('[data-roughcut-candidates="batch"] .roughcut-candidate-row').count(),
        2,
      );
      assert.deepEqual((await state(page)).project, before);
      await page.locator('[data-action="roughcut-candidate-preview"]').first().click();
      await page.waitForFunction(
        () => Number(document.querySelector("[data-roughcut-scrub]")?.value) > 35,
      );
      await page.locator('[data-action="roughcut-play"]').click();
      assert.deepEqual((await state(page)).project, before);
      await page.locator('[data-action="roughcut-batch-discard"]').click();
      assert.equal(await page.locator('[data-roughcut-candidates="batch"]').count(), 0);
      assert.deepEqual((await state(page)).project, before);
      await openUniform(page);
      await page.locator('[data-action="roughcut-batch-plan"]').click();
      await page.locator('[data-action="roughcut-batch-save"]').click();
      await saved(page);
      const result = (await state(page)).project;
      assert.deepEqual(
        result.roughCuts.map((cut) => [cut.assetId, cut.inFrame, cut.outFrame]),
        assets.map((asset) => [asset.id, 30, 120]),
      );
      assert.equal(result.revision, before.revision + 1);
      assert.deepEqual(result.clips, []);
      await page
        .locator('[data-action="undo"]:visible,[data-ew-action="undo"]:visible')
        .first()
        .click();
      await saved(page);
      assert.equal((await state(page)).project.roughCuts?.length ?? 0, 0);
    } finally {
      await page.close();
    }
  },
);

test(
  "failed AI proposal preserves its original connection error across reload and supports retry or discard",
  { timeout: 60_000 },
  async () => {
    const { page } = await importedVideoQueue();
    try {
      const before = (await state(page)).project;
      await openAI(page);
      await page.locator('[data-roughcut-field="ai-scope"]').selectOption("current");
      await page.locator('[data-action="roughcut-ai-start"]').click();
      await page.waitForFunction(() => window.__roughCutAgentTasks.length === 1);
      await page.evaluate(() => {
        const current = window.__roughCutTools.read_video_project();
        const task = window.__roughCutAgentTasks[0];
        task.status = "completed";
        task.result = {
          text: JSON.stringify({
            projectId: current.project.id,
            requestToken: current.requestToken,
            baseRevision: null,
            title: "稳定画面候选保留段（未生成）",
            explanation: "Panel 工具返回 unknown session，无法读取工程或取得当前 baseRevision。",
            operations: [{ type: "rough-cuts", cuts: [] }],
          }),
        };
        window.__roughCutEmit("agent.task.changed", task);
      });
      await page.waitForFunction(() =>
        Object.keys(localStorage).some(
          (key) =>
            key.startsWith("document:video-studio-roughcut-ai-") &&
            JSON.parse(localStorage.getItem(key)).data?.state.phase === "failed",
        ),
      );
      await page.reload();
      await enterLegacyProduction(page);
      await page.waitForFunction(() => window.__roughCutTools?.read_video_project);
      await page.locator('[data-tab="roughcut"]').click();
      await openAI(page);
      await page.waitForFunction(() =>
        document.querySelector(".roughcut-ai-status")?.textContent.includes("unknown session"),
      );
      assert.match(
        await page.locator("#roughcut-ai-panel").textContent(),
        /本次分析失败，尚未生成候选段/,
      );
      assert.equal(await page.locator('[data-action="roughcut-ai-start"]').isDisabled(), true);
      assert.equal(await page.locator('[data-action="roughcut-ai-save"]').count(), 0);
      assert.deepEqual((await state(page)).project, before);
      assert.equal(await page.evaluate(() => window.__roughCutAgentTasks.length), 0);
      await page.locator("#roughcut-ai-panel").scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(artifacts, "rough-cut-ai-connection-failure.png") });
      await page.locator('[data-action="roughcut-ai-retry"]').click();
      await page.waitForFunction(() => window.__roughCutAgentTasks.length === 1);
      await page.locator('[data-action="roughcut-ai-cancel"]').click();
      await page.locator('[data-action="roughcut-ai-discard"]').click();
      assert.equal(await page.locator('[data-action="roughcut-ai-start"]').isDisabled(), false);
      assert.deepEqual((await state(page)).project, before);
    } finally {
      await page.close();
    }
  },
);

test(
  "single-source AI ignores the previous multi-selection and reviews only that source through real frame tools",
  { timeout: 60_000 },
  async () => {
    const { page, assets } = await importedVideoQueue();
    try {
      await page.locator('[data-tab="media"]').click();
      const current = assets[1];
      await page.locator(`[data-rough-source="${current.id}"]`).click();
      await openAI(page);
      assert.equal(await page.locator("#roughcut-bulk-panel").isVisible(), false);
      assert.equal(await page.locator('[data-roughcut-field="ai-scope"]').inputValue(), "current");
      assert.match(await page.locator("[data-roughcut-ai-target]").textContent(), /旅行二/);
      assert.doesNotMatch(await page.locator("[data-roughcut-ai-target]").textContent(), /旅行一/);
      const before = (await state(page)).project;
      await page.locator('[data-roughcut-field="ai-goal"]').fill("只挑这份素材的主体镜头");
      await page.locator("#roughcut-ai-panel").scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(artifacts, "rough-cut-ai-current.png") });
      await page.locator('[data-action="roughcut-ai-start"]').click();
      await page.waitForFunction(
        () =>
          window.__roughCutAgentTasks.length === 1 &&
          window.__roughCutTools.read_video_project().requestToken,
      );
      const submitted = await page.evaluate(() => window.__roughCutAgentTasks[0].params);
      assert.deepEqual(
        JSON.parse(submitted.prompt.split("本批素材数据：")[1]).map((asset) => asset.id),
        [current.id],
      );
      assert.equal(submitted.maxTurns, 20);
      assert.match(submitted.prompt, /只挑这份素材的主体镜头/);
      const token = (await state(page)).requestToken;
      await page.locator('[data-roughcut-field="ai-scope"]').selectOption("queue");
      await page.locator("#roughcut-source").selectOption(assets[0].id);
      assert.equal(await page.locator('[data-action="roughcut-ai-start"]').isDisabled(), true);
      assert.equal((await state(page)).requestToken, token);
      assert.match(
        await page.locator("[data-roughcut-ai-job-target]").textContent(),
        /1 份素材：旅行二/,
      );
      await page.evaluate(async (assetId) => {
        for (const seconds of [0.3, 3, 5.7]) {
          const frame = await window.__roughCutTools.inspect_video_frame({ assetId, seconds });
          if (frame.kind !== "image" || atob(frame.data).length < 1000)
            throw new Error("No decoded frame");
        }
        const state = window.__roughCutTools.read_video_project();
        await window.__roughCutTools.propose_video_edit({
          projectId: state.project.id,
          requestToken: state.requestToken,
          baseRevision: state.project.revision,
          title: "单素材画面初筛",
          explanation: "已查看当前原片的真实关键帧，候选先预览确认。",
          operations: [
            {
              type: "rough-cuts",
              cuts: [
                {
                  id: "single-candidate",
                  assetId,
                  inFrame: 60,
                  outFrame: 120,
                  name: "主体镜头",
                  enabled: true,
                },
              ],
            },
          ],
        });
        const task = window.__roughCutAgentTasks[0];
        task.status = "completed";
        window.__roughCutEmit("agent.task.changed", task);
      }, current.id);
      await page.waitForFunction(
        () => document.querySelector('[data-action="roughcut-ai-save"]')?.disabled === false,
      );
      assert.equal(
        await page.locator('[data-roughcut-candidates="ai"] .roughcut-candidate-row').count(),
        1,
      );
      assert.deepEqual((await state(page)).project, before);
      await page.locator('[data-action="roughcut-candidate-preview"]').click();
      assert.equal(await page.locator("#roughcut-source").inputValue(), current.id);
      assert.equal(await page.locator('[data-roughcut-field="ai-scope"]').inputValue(), "queue");
      await page.locator('[data-action="roughcut-ai-save"]').click();
      await saved(page);
      const result = (await state(page)).project;
      assert.deepEqual(
        result.roughCuts.map((cut) => [cut.assetId, cut.inFrame, cut.outFrame]),
        [[current.id, 60, 120]],
      );
      assert.deepEqual(result.clips, []);
      await page.locator('[data-action="roughcut-ai-select-queue"]').click();
      assert.equal(
        await page.locator('[data-roughcut-field="queue-enabled"]:checked').count(),
        2,
        "Single analysis preserves the previous multi-selection",
      );
      await page.locator('[data-action="roughcut-ai-queue"]').click();
      assert.equal(await page.locator("#roughcut-ai-panel").isVisible(), true);
      assert.equal(
        await page.evaluate(() => window.__roughCutAgentTasks.length),
        1,
        "Multi-source shortcut only opens the configuration",
      );
    } finally {
      await page.close();
    }
  },
);

test(
  "AI batch candidates require real decoded frame tools and await user review before saving",
  { timeout: 60_000 },
  async () => {
    const { page, assets } = await importedVideoQueue();
    try {
      const before = (await state(page)).project;
      await openAI(page);
      assert.equal(await page.locator('[data-roughcut-field="ai-scope"]').inputValue(), "queue");
      await page.locator("#roughcut-ai-panel").scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(artifacts, "rough-cut-ai-queue.png") });
      await page.locator('[data-roughcut-field="ai-goal"]').fill("保留有主体的中间段，先生成候选");
      await page.locator('[data-action="roughcut-ai-start"]').click();
      await page.waitForFunction(
        () =>
          window.__roughCutAgentTasks.length === 1 &&
          window.__roughCutTools.read_video_project().requestToken,
      );
      assert.match(
        await page.locator('[data-action="roughcut-ai-toggle"]').textContent(),
        /AI 分析中/,
      );
      const unseen = await page.evaluate(async () => {
        const state = window.__roughCutTools.read_video_project();
        try {
          await window.__roughCutTools.propose_video_edit({
            projectId: state.project.id,
            requestToken: state.requestToken,
            baseRevision: state.project.revision,
            title: "未观察的方案",
            explanation: "没有保留段的试探提交，必须先通过真实观察校验。",
            operations: [{ type: "rough-cuts", cuts: [] }],
          });
          return "unexpected acceptance";
        } catch (error) {
          return error.message;
        }
      });
      assert.match(unseen, /实际查看.*关键帧/);
      const inspected = await page.evaluate(
        async (ids) => {
          const results = [];
          for (const id of ids)
            for (const seconds of [0.3, 3, 5.7]) {
              const result = await window.__roughCutTools.inspect_video_frame({
                assetId: id,
                seconds,
              });
              results.push({
                kind: result.kind,
                width: result.width,
                height: result.height,
                bytes: atob(result.data).length,
                summary: result.summary,
              });
            }
          return results;
        },
        assets.map((asset) => asset.id),
      );
      assert.equal(inspected.length, 6);
      assert.ok(
        inspected.every(
          (result) =>
            result.kind === "image" &&
            result.width === 320 &&
            result.height === 180 &&
            result.bytes > 1000,
        ),
      );
      await page.evaluate(async () => {
        const state = window.__roughCutTools.read_video_project();
        await window.__roughCutTools.propose_video_edit({
          projectId: state.project.id,
          requestToken: state.requestToken,
          baseRevision: state.project.revision,
          title: "实际画面初筛",
          explanation: "已查看每份原片开头、中间和结尾的真实画面；连续动作边界待预览确认。",
          operations: [
            {
              type: "rough-cuts",
              cuts: state.project.assets.map((asset, index) => ({
                id: `proposed-${index}`,
                assetId: asset.id,
                inFrame: 60,
                outFrame: 120,
                name: "合成测试图主体",
                enabled: true,
              })),
            },
          ],
        });
        const task = window.__roughCutAgentTasks[0];
        task.status = "completed";
        window.__roughCutEmit("agent.task.changed", task);
      });
      await page.locator('[data-roughcut-candidates="ai"]').waitFor();
      await page.waitForFunction(
        () => !document.querySelector('[data-action="roughcut-ai-save"]')?.disabled,
      );
      assert.deepEqual((await state(page)).project, before);
      const candidateCheckbox = page.locator('[data-roughcut-field="candidate-enabled"]').first();
      await candidateCheckbox.uncheck();
      assert.equal(
        await page.locator('[data-action="roughcut-bulk-toggle"]').getAttribute("aria-expanded"),
        "true",
      );
      assert.equal(
        await page.locator('[data-action="roughcut-ai-toggle"]').getAttribute("aria-expanded"),
        "true",
      );
      await candidateCheckbox.check();
      await page.waitForFunction(() =>
        Object.keys(localStorage).some(
          (key) =>
            key.startsWith("document:video-studio-roughcut-ai-") &&
            JSON.parse(localStorage.getItem(key)).data?.state.phase === "review",
        ),
      );
      await page.reload();
      await enterLegacyProduction(page);
      await page.waitForFunction(() => window.__roughCutTools?.read_video_project);
      await page.locator('[data-tab="roughcut"]').click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-action="roughcut-ai-toggle"]')
          ?.textContent?.includes("2 段待审阅"),
      );
      await openAI(page);
      await page.locator('[data-roughcut-candidates="ai"]').waitFor();
      assert.match(
        await page.locator(".roughcut-ai-status").textContent(),
        /已恢复 2 个待审候选段/,
      );
      assert.deepEqual(
        (await state(page)).project,
        before,
        "Pending AI candidates survive reload without becoming edits",
      );
      assert.equal(
        await page.evaluate(() => window.__roughCutAgentTasks.length),
        0,
        "Restoring a review never starts a new model task",
      );
      await page.evaluate(() => {
        window.__roughCutRejectProjectSave = true;
      });
      await page.locator('[data-action="roughcut-ai-save"]').click();
      await page.waitForFunction(() =>
        document.querySelector("#toast")?.textContent?.includes("模拟工程文档写入失败"),
      );
      assert.deepEqual(
        (await state(page)).project,
        before,
        "A failed durable save does not commit or consume AI candidates",
      );
      assert.equal(
        await page.locator('[data-roughcut-candidates="ai"] .roughcut-candidate-row').count(),
        2,
      );
      await page.reload();
      await enterLegacyProduction(page);
      await page.waitForFunction(() => window.__roughCutTools?.read_video_project);
      await page.locator('[data-tab="roughcut"]').click();
      await openAI(page);
      await page.locator('[data-roughcut-candidates="ai"]').waitFor();
      assert.deepEqual((await state(page)).project, before);
      assert.equal(
        await page.locator('[data-roughcut-candidates="ai"] .roughcut-candidate-row').count(),
        2,
        "Both candidates remain durable when the project save fails",
      );
      await page.locator('[data-action="roughcut-candidate-preview"]').last().click();
      await page.waitForFunction(
        () => Number(document.querySelector("[data-roughcut-scrub]")?.value) > 65,
      );
      await page.locator('[data-action="roughcut-play"]').click();
      await page.screenshot({
        path: resolve(artifacts, "rough-cut-ai-review.png"),
        fullPage: true,
      });

      await page.setViewportSize({ width: 640, height: 960 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({
        path: resolve(artifacts, "rough-cut-ai-review-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator('[data-action="roughcut-ai-save"]').click();
      await saved(page);
      const result = (await state(page)).project;
      assert.equal(result.roughCuts.length, 2);
      assert.equal(result.revision, before.revision + 1);
      assert.deepEqual(result.clips, []);
      await disclosure(page, "bulk");
      await page.locator('[data-action="roughcut-queue-append"]').click();
      await saved(page);
      assert.equal((await state(page)).project.clips.length, 2);
    } finally {
      await page.close();
    }
  },
);

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
  const clip = page.locator("[data-et-clip]").first();
  await clip.click({ position: { x: 45, y: 20 } });
  await page.locator("[data-ew-seek]").fill("240000");
  await page.waitForFunction(
    () => window.__roughCutTools.read_video_project().playheadFrame === 30,
  );
  assert.equal((await state(page)).playheadFrame, 30);
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

async function expectPreviewFrame(page, assetId, sourceFrame) {
  // A second decoder supplies the expected pixels without moving the monitor's
  // decoder. Compare a small image so display scaling/JPEG rounding is harmless.
  const expected = await page.evaluate(
    async ({ assetId, sourceFrame }) => {
      const frame = await window.__roughCutTools.inspect_video_frame({
        assetId,
        seconds: sourceFrame / 30,
      });
      const image = new Image();
      image.src = `data:${frame.mediaType};base64,${frame.data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 23;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
    },
    { assetId, sourceFrame },
  );
  await page.waitForFunction(
    (expected) => {
      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 23;
      const context = canvas.getContext("2d");
      const monitor =
        document.querySelector(
          ".workspace.editor-mode:not(.editor-source-mode) [data-ew-canvas]",
        ) ?? document.querySelector("#preview");
      context.drawImage(monitor, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let difference = 0;
      for (let index = 0; index < pixels.length; index++)
        if (index % 4 !== 3) difference += Math.abs(pixels[index] - expected[index]);
      return difference / (canvas.width * canvas.height * 3) < 8;
    },
    expected,
    { timeout: 10_000 },
  );
}

async function expectTimelinePreview(page, clip, frame) {
  assert.equal(await page.locator("[data-ew-canvas]").isVisible(), true);
  assert.equal(await page.locator("[data-source-scrub],[data-roughcut-scrub]").count(), 0);
  const current = await state(page);
  assert.equal(
    current.playheadFrame,
    frame,
    "The new clip's beginning becomes the composition playhead",
  );
  assert.equal(current.selectedClipId, clip.id, "The inserted clip is selected for editing");
  const timelineClip = page.locator(`[data-et-clip="${clip.id}"]`);
  assert.equal(await page.locator("[data-ew-timeline]").isVisible(), true);
  assert.equal(await page.locator(".timeline-panel").isVisible(), false);
  assert.equal(await timelineClip.getAttribute("aria-selected"), "true");
  await page.waitForFunction((id) => {
    const viewport = document.querySelector(".et-scroll").getBoundingClientRect();
    const segment = document.querySelector(`[data-et-clip="${id}"]`).getBoundingClientRect();
    return segment.left >= viewport.left - 1 && segment.left < viewport.right - 1;
  }, clip.id);
  await timelineClip.locator("canvas.et-media-strip[data-et-media-state=ready]").waitFor();
  const pixels = await timelineClip.locator("canvas.et-media-strip").evaluate((canvas) => {
    const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    return bytes.some((value, index) => index % 4 !== 3 && value > 0);
  });
  assert.equal(pixels, true, "The source strip contains actual decoded video pixels");
  await expectPreviewFrame(page, clip.assetId, clip.inFrame);
}

test(
  "adding and dropping real media after source preview shows the inserted timeline clip and its thumbnails",
  { timeout: 60_000 },
  async () => {
    const page = await openPage();
    try {
      await page
        .locator("#media-input")
        .setInputFiles([sourcePath, resolve(root, "tests/fixtures/static-tone.wav")]);
      await page.waitForFunction(
        () => window.__roughCutTools.read_video_project().project.assets.length === 2,
      );
      await saved(page);
      const imported = (await state(page)).project.assets;
      const asset = imported.find((item) => item.kind === "video");
      const audio = imported.find((item) => item.kind === "audio");
      await page.locator("[data-et-zoom]").fill("2");
      assert.equal(await page.locator("[data-et-zoom]").inputValue(), "2");
      for (const insertion of ["first", "append", "menu", "drop"]) {
        const document = await readSavedEditorDocument(page);
        const sequence = document.sequences.find((item) => item.id === document.activeSequenceId);
        const end = Math.max(0, ...sequence.clips.map((clip) => clip.start + clip.duration));
        const insertionTime = Math.max(0, end - 8000);
        await page.locator("[data-ew-seek]").fill(String(insertionTime));
        let dropTrack;
        if (insertion === "drop") {
          await page.locator('[data-et-action="track-video"]').click();
          await saved(page);
          const withTrack = await readSavedEditorDocument(page);
          dropTrack = withTrack.sequences
            .find((item) => item.id === withTrack.activeSequenceId)
            .tracks.at(-1).id;
          await page.locator(".et-scroll").evaluate((element) => {
            element.scrollLeft = 0;
          });
        }
        if (insertion === "first") {
          await page.locator(`[data-preview-asset="${audio.id}"] .asset-preview-name`).click();
          assert.equal(await page.locator("[data-source-audio]").isVisible(), true);
          assert.equal(await page.locator(".timeline-panel").isVisible(), false);
        } else {
          await page.locator(`[data-preview-asset="${asset.id}"] .asset-thumbnail`).click();
          await page.locator("[data-source-scrub]").evaluate((input) => {
            input.value = "120";
            input.dispatchEvent(new Event("input", { bubbles: true }));
          });
          await expectPreviewFrame(page, asset.id, 120);
        }
        assert.equal(await page.locator("[data-ew-timeline]").isVisible(), true);
        const beforeDocument = await readSavedEditorDocument(page);
        const before = beforeDocument.sequences.find(
          (item) => item.id === beforeDocument.activeSequenceId,
        );
        if (insertion === "drop") {
          await page
            .locator(`[data-asset="${asset.id}"]`)
            .dragTo(page.locator(`[data-et-lane="${dropTrack}"]`), {
              targetPosition: { x: 60, y: 30 },
            });
        } else if (insertion === "menu") {
          await page.locator(`[data-action="media-menu"][data-id="${asset.id}"]`).click();
          await page.locator('#media-context-menu [data-action="add-media"]').click();
        } else await page.locator(`[data-add-asset="${asset.id}"]`).click();
        await saved(page);
        const canonical = await readSavedEditorDocument(page);
        const project = canonical.sequences.find((item) => item.id === canonical.activeSequenceId);
        assert.equal(project.clips.length, before.clips.length + 1);
        assert.equal(canonical.revision, beforeDocument.revision + 1);
        for (const original of before.clips)
          assert.deepEqual(
            project.clips.find((clip) => clip.id === original.id),
            original,
          );
        const clip = project.clips.find((clip) => !before.clips.some((old) => old.id === clip.id));
        assert.equal(clip.kind, "media");
        assert.equal(clip.assetId, asset.id);
        if (insertion === "drop") {
          assert.equal(clip.trackId, dropTrack);
          assert.equal(
            clip.start,
            144000,
            "A real drop at 60px and 100px/second uses the visible target time",
          );
        } else assert.equal(clip.start, insertionTime);
        assert.equal(await page.locator("[data-source-audio]").count(), 0);
        await expectTimelinePreview(
          page,
          { ...clip, inFrame: clip.timeMap.points[0].source / 8000 },
          Math.round(clip.start / 8000),
        ).catch(async (error) => {
          await page.screenshot({
            path: resolve(artifacts, "timeline-insert-failure.png"),
            fullPage: true,
          });
          throw new Error(
            `${insertion}: ${error.message}\n${JSON.stringify(await page.evaluate(() => ({ toast: document.querySelector("#toast")?.textContent, preview: document.querySelector("[data-ew-preview-error]")?.textContent, strips: [...document.querySelectorAll("canvas.et-media-strip")].map((canvas) => ({ state: canvas.dataset.etMediaState, message: canvas.title })), seek: document.querySelector("[data-ew-seek]")?.value, sourceMode: document.querySelector(".workspace")?.className })))}`,
          );
        });
        if (insertion !== "first") {
          await page.locator('[data-ew-action="undo"]').click();
          await saved(page);
          assert.deepEqual(
            (await readSavedEditorDocument(page)).sequences,
            beforeDocument.sequences,
            "Each insertion route has one complete undo",
          );
        }
      }
      await page.screenshot({
        path: resolve(artifacts, "timeline-insert-preview.png"),
        fullPage: true,
      });
    } finally {
      await page.close();
    }
  },
);

for (const recovery of ["retry", "reload", "new-draft"])
  test(
    `same-ID project replacement preserves its durable document after failed cleanup: ${recovery}`,
    { timeout: 60_000 },
    async () => {
      const { page } = await importedVideoQueue();
      try {
        const before = (await state(page)).project;
        await openAI(page);
        await page.locator('[data-action="roughcut-ai-start"]').click();
        await page.waitForFunction(
          () =>
            window.__roughCutAgentTasks.length === 1 &&
            window.__roughCutTools.read_video_project().requestToken,
        );
        await page.evaluate(async () => {
          let state = window.__roughCutTools.read_video_project();
          for (const asset of state.project.assets)
            for (const seconds of [0.3, 3, 5.7])
              await window.__roughCutTools.inspect_video_frame({ assetId: asset.id, seconds });
          state = window.__roughCutTools.read_video_project();
          await window.__roughCutTools.propose_video_edit({
            projectId: state.project.id,
            requestToken: state.requestToken,
            baseRevision: state.project.revision,
            title: "原工程的候选",
            explanation: "已查看开中尾的真实测试图。",
            operations: [
              {
                type: "rough-cuts",
                cuts: state.project.assets.map((asset, index) => ({
                  id: `same-id-${index}`,
                  assetId: asset.id,
                  inFrame: 60,
                  outFrame: 120,
                  name: "原工程候选",
                  enabled: true,
                })),
              },
            ],
          });
          const task = window.__roughCutAgentTasks[0];
          task.status = "completed";
          window.__roughCutEmit("agent.task.changed", task);
        });
        await page.locator('[data-roughcut-candidates="ai"]').waitFor();
        await page.waitForFunction(
          () => !document.querySelector('[data-action="roughcut-ai-save"]')?.disabled,
        );
        const replacement = { ...before, name: "同 ID 替换后的工程" };
        const file = {
          name: "replacement.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(replacement)),
        };
        await page.evaluate(() => {
          window.__roughCutRejectDraftClear = true;
        });
        await page.locator("#project-input").setInputFiles(file);
        await page.locator(".editor-cleanup-warning").waitFor();
        assert.match(
          await page.locator(".editor-cleanup-warning").textContent(),
          /模拟 AI 草稿清理失败/,
        );
        const replaced = (await state(page)).project;
        assert.equal(replaced.name, replacement.name);
        assert.ok(replaced.revision > before.revision);
        assert.equal((await readSavedLegacyProject(page)).name, replacement.name);
        assert.equal(
          await page.locator('[data-roughcut-candidates="ai"] .roughcut-candidate-row').count(),
          0,
        );
        const storedDraft = () =>
          page.evaluate(
            () =>
              Object.keys(localStorage)
                .filter((key) => key.startsWith("document:video-studio-roughcut-ai-"))
                .map((key) => JSON.parse(localStorage.getItem(key)))
                .find((record) => record.data)?.data ?? null,
          );
        const oldDraft = await storedDraft();
        assert.ok(
          oldDraft,
          "Failed cleanup leaves the old saved candidate record for a real retry",
        );
        if (recovery === "retry") {
          await page.evaluate(() => {
            window.__roughCutRejectDraftClear = false;
          });
          await page.locator("[data-retry-cleanup]").click();
          await page.locator(".editor-cleanup-warning").waitFor({ state: "detached" });
          assert.equal(await storedDraft(), null);
        } else if (recovery === "new-draft") {
          await page.locator('[data-tab="media"]').click();
          const asset = replaced.assets[0];
          await page.locator(`[data-rough-source="${asset.id}"]`).click();
          await openAI(page);
          await page.locator('[data-action="roughcut-ai-start"]').click();
          await page.waitForFunction(() => window.__roughCutAgentTasks.length === 2);
          const nextDraft = await storedDraft();
          assert.ok(nextDraft);
          assert.notDeepEqual(nextDraft, oldDraft);
          await page.evaluate(() => {
            window.__roughCutRejectDraftClear = false;
          });
          await page.locator("[data-retry-cleanup]").click();
          await page.locator(".editor-cleanup-warning").waitFor({ state: "detached" });
          assert.deepEqual(
            await storedDraft(),
            nextDraft,
            "Retrying old cleanup cannot erase the new generation's draft",
          );
          return;
        }
        await saved(page);
        assert.equal(await page.locator('[data-roughcut-candidates="ai"]').count(), 0);
        await page.reload();
        await enterLegacyProduction(page);
        await page.waitForFunction(() => window.__roughCutTools?.read_video_project);
        await page.locator('[data-tab="roughcut"]').click();
        assert.equal((await state(page)).project.name, replacement.name);
        assert.equal(
          await page.locator('[data-roughcut-candidates="ai"]').count(),
          0,
          "A restart must not resurrect the replaced document's old AI queue",
        );
        if (recovery === "reload")
          assert.deepEqual(
            await storedDraft(),
            oldDraft,
            "The epoch guard rejects the old candidates before a successful cleanup",
          );
      } finally {
        await page.close();
      }
    },
  );

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
      assert.equal(await page.locator("[data-ew-canvas]").isVisible(), true);
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
      assert.equal(await page.locator("[data-ew-canvas]").isVisible(), true);
      assert.equal(await page.locator("[data-source-audio]").count(), 0);
      assert.equal((await state(page)).playheadFrame, before.playheadFrame);
      assert.deepEqual((await state(page)).project, before.project);
      const canonicalBefore = await readSavedEditorDocument(page);
      const sequenceBefore = canonicalBefore.sequences.find(
        (item) => item.id === canonicalBefore.activeSequenceId,
      );
      await page.locator(`[data-add-asset="${video.id}"]`).click();
      await saved(page);
      const added = await readSavedEditorDocument(page);
      const sequenceAfter = added.sequences.find((item) => item.id === added.activeSequenceId);
      assert.equal(added.revision, canonicalBefore.revision + 1);
      assert.equal(sequenceAfter.clips.length, sequenceBefore.clips.length + 1);
      assert.deepEqual(sequenceAfter.clips.slice(0, -1), sequenceBefore.clips);
      assert.equal(sequenceAfter.clips.at(-1).assetId, video.id);
      assert.equal(sequenceAfter.clips.at(-1).start, before.playheadFrame * 8000);
      assert.notEqual(sequenceAfter.clips.at(-1).trackId, sequenceBefore.clips[0].trackId);
      assert.equal(await page.locator("[data-ew-canvas]").isVisible(), true);
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
      assert.equal(
        await page.locator('[data-action="roughcut-bulk-toggle"]').getAttribute("aria-expanded"),
        "true",
        "Internal source navigation preserves batch mode",
      );
      assert.equal(
        await page.locator('[data-action="roughcut-ai-toggle"]').getAttribute("aria-expanded"),
        "false",
      );
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
      await expectTimelinePreview(page, joined.clips[before.project.clips.length], 180);
      // Return from rough cutting to the visible timeline, then verify that
      // selecting a different clip changes real composition pixels.
      await page.locator(`[data-rough-source="${video.id}"]`).click();
      await seekSource(page, 90);
      await expectPreviewFrame(page, video.id, 90);
      const blueClip = joined.clips[before.project.clips.length];
      await page.locator('[data-action="return-composition"]').click();
      await page
        .locator(`[data-et-clip="${joined.clips[0].id}"]`)
        .click({ position: { x: 45, y: 20 } });
      await page.locator("[data-ew-seek]").fill("240000");
      await expectPreviewFrame(page, video.id, (await state(page)).playheadFrame);
      await page.locator(`[data-et-clip="${blueClip.id}"]`).click({ position: { x: 15, y: 20 } });
      await page.locator("[data-ew-seek]").fill(String(180 * 8000));
      assert.equal(await page.locator("[data-ew-canvas]").isVisible(), true);
      const selected = await state(page);
      assert.equal(selected.selectedClipId, blueClip.id);
      assert.ok(selected.playheadFrame >= 180 && selected.playheadFrame < 210);
      await expectPreviewFrame(page, second.id, selected.playheadFrame - 180);
      await page.screenshot({
        path: resolve(artifacts, "timeline-select-from-roughcut.png"),
        fullPage: true,
      });
      await page
        .locator('[data-action="undo"]:visible,[data-ew-action="undo"]:visible')
        .first()
        .click();
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
      await expectTimelinePreview(page, assembled.clips[1], 180);

      const json = await download(page, '[data-action="save-project"]');
      assert.deepEqual(
        (await legacyProjectFromDocument(JSON.parse(json.bytes.toString()))).roughCuts,
        assembled.roughCuts,
      );
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
      // Wait for the portable project's managed media to reconnect before
      // exercising duplicate import; an import must finish before editing.
      await page.waitForFunction(
        () => window.__roughCutTools.read_video_project().missingAssetIds.length === 0,
      );
      await page
        .locator("#media-input")
        .setInputFiles([sourcePath, resolve(root, "tests/fixtures/static-tone.wav")]);
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
      assert.equal(await page.locator("[data-ew-canvas]").isVisible(), true);
      assert.equal((await state(page)).playheadFrame, 0);
      assert.equal((await state(page)).selectedClipId, project.audioClips[0].id);
      const video = before.assets.find((asset) => asset.kind === "video");
      await page.locator(`[data-rough-source="${video.id}"]`).click();
      await seekSource(page, 90);
      await expectPreviewFrame(page, video.id, 90);
      await page.locator('[data-action="return-composition"]').click();
      await page.locator('[data-tab="ai"]').click();
      await page
        .locator(`[data-clip="${project.clips[0].id}"]`)
        .click({ position: { x: 45, y: 20 } });
      assert.ok((await state(page)).playheadFrame > 0);
      await page.locator(`[data-audio-clip="${project.audioClips[0].id}"]`).click();
      assert.equal(await page.locator("#preview").isVisible(), true);
      assert.equal((await state(page)).playheadFrame, 0);
      await expectPreviewFrame(page, video.id, 0);
      await page.locator('[data-tab="media"]').click();
      await page.locator(`[data-rough-source="${video.id}"]`).click();
      await seekSource(page, 90);
      await page.locator('[data-action="return-composition"]').click();
      await page.locator('[data-tab="ai"]').click();
      await page
        .locator(`[data-clip="${project.clips[0].id}"]`)
        .click({ position: { x: 45, y: 20 } });
      assert.ok((await state(page)).playheadFrame > 0);
      await page.locator(`[data-clip="${project.clips[0].id}"]`).focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#preview").isVisible(), true);
      assert.equal((await state(page)).playheadFrame, 0);
      assert.equal((await state(page)).selectedClipId, project.clips[0].id);
      await expectPreviewFrame(page, video.id, 0);
      await page
        .locator('[data-action="undo"]:visible,[data-ew-action="undo"]:visible')
        .first()
        .click();
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
