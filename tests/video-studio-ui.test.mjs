import {
  enterLegacyProduction,
  readSavedEditorDocument,
  readSavedLegacyProject,
  legacyProjectFromDocument,
  pristineLegacyDemoProject,
  waitForProjectSwitch,
} from "./helpers/video-studio-editor-fixture.mjs";
import { installGenericMediaTaskMock } from "./helpers/video-studio-generic-task.mjs";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";
import { installLocalVoiceProcessMock } from "./helpers/video-studio-local-voice-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let output, buildDirectory;
const screenshots = resolve(root, "artifacts/video-studio");
let browser;
let server;
let url;
const errors = [];

before(async () => {
  const [project] = selectProjects(await discoverProjects(), "video-studio");
  buildDirectory = await mkdtemp(resolve(tmpdir(), "video-studio-main-legacy-ui-"));
  const isolatedOutput = resolve(buildDirectory, "package");
  await buildProject({ ...project, output: isolatedOutput }, { log: false });
  output = resolve(isolatedOutput, "app");
  await mkdir(screenshots, { recursive: true });
  server = createServer(async (request, response) => {
    if (
      ["c", "d", "e", "f"].some((letter) => request.url === "/media/asset-" + letter.repeat(64))
    ) {
      response.writeHead(200, { "Content-Type": "audio/mpeg" });
      response.end(await readFile(resolve(output, "demo-narration.mp3")));
      return;
    }
    if (request.url.startsWith("/media/")) {
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7m8AAAAASUVORK5CYII=",
          "base64",
        ),
      );
      return;
    }
    const path = resolve(
      output,
      "." + new URL(request.url, "http://localhost").pathname.replace(/\/$/, "/index.html"),
    );
    if (!path.startsWith(output + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      response.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".css": "text/css",
            ".mjs": "text/javascript",
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
  assert.deepEqual(errors, [], "No runtime errors or CSP violations");
});

async function pageWithBridge(mock = false, generic = true) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text()))
      errors.push(message.text());
  });
  if (mock) {
    if (generic) await page.addInitScript(installGenericMediaTaskMock);
    await page.addInitScript(() => {
      const storage = {};
      window.__panelTools = {};
      window.__taskCallbacks = {};
      window.__taskCalls = [];
      window.__taskCancels = [];
      window.__tasks = {};
      window.codeshellPanel = {
        getContext: async () => ({ cwd: "/test/video-project", theme: "dark" }),
        registerTool(name, handler) {
          window.__panelTools[name] = handler;
          return () => {};
        },
        on(name, handler) {
          window.__taskCallbacks[name] = handler;
          return () => {};
        },
        async call(method, params) {
          if (method === "media.document.get")
            return storage[`document:${params.key}`] || { revision: 0, data: null };
          if (method === "media.document.set") {
            if (params.key === "video-studio-recent-v2" && window.__holdArchive) {
              window.__archiveStarted = true;
              await new Promise((resolve) => {
                window.__releaseArchive = resolve;
              });
            }
            const previous = storage[`document:${params.key}`] || { revision: 0 };
            if (params.baseRevision !== previous.revision)
              throw new Error("Document revision changed");
            const saved = { revision: previous.revision + 1, data: structuredClone(params.data) };
            storage[`document:${params.key}`] = saved;
            return saved;
          }
          if (method === "storage.get") return storage[params.key] || null;
          if (method === "storage.set") {
            if (params.key === "video-studio-recent-v2" && window.__holdArchive) {
              window.__archiveStarted = true;
              await new Promise((resolve) => {
                window.__releaseArchive = resolve;
              });
            }
            storage[params.key] = structuredClone(params.value);
            return true;
          }
          if (method === "agent.task.start") {
            window.__taskCalls.push(params);
            await new Promise((resolve) => setTimeout(resolve, 150));
            const task = { id: "task-" + window.__taskCalls.length, status: "running" };
            window.__tasks[task.id] = task;
            return task;
          }
          if (method === "agent.task.get") return window.__tasks[params.id];
          if (method === "agent.task.cancel") {
            window.__taskCancels.push(params.id);
            return { id: params.id, status: "cancelled" };
          }
          throw new Error("Unexpected host call: " + method);
        },
      };
    });
  }
  await page.goto(`${url}/?legacyWorkspace=1`);
  await enterLegacyProduction(page);
  await page.locator("#studio .workspace").waitFor();
  return page;
}

const readProject = async (page) =>
  (await page.evaluate(() => window.__panelTools?.read_video_project().project ?? null)) ??
  (await readSavedLegacyProject(page));
async function saved(page) {
  await page.waitForFunction(
    () => document.querySelector("#save-state")?.textContent === "已自动保存",
  );
}
async function demo(page) {
  await saved(page);
  const previous = await readProject(page);
  await page.locator('[data-action="demo"]:visible').first().click();
  await waitForProjectSwitch(page, previous?.id, readProject);
  // These older tests exercise the production page's frame-based controls.
  // Canonical Material editing is covered by editor-main/workspace/timeline suites.
  await page.locator('[data-tab="ai"]').click();
}

test("an explicit native media failure keeps its cause visible and blocks automatic production", async () => {
  const page = await pageWithBridge(true);
  try {
    const initial = await readProject(page);
    const nativeStatusCount = () =>
      page.evaluate(
        () =>
          window.__genericHostCalls.filter(
            (call) =>
              call.method === "tasks.start" && call.args.input?.request?.action === "status",
          ).length,
      );
    assert.equal(
      await nativeStatusCount(),
      0,
      "Opening Material must not start a native capability probe",
    );
    await page.locator('[data-tab="ai"]').click();
    await page.locator("#ai-prompt").fill("检查素材并制作一个短片");
    await page.locator('[data-action="ask-ai"]:enabled').first().click();
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent.includes("Unexpected host call: media.status"),
    );
    assert.ok(
      (await nativeStatusCount()) > 0,
      "The user's production action checks native availability",
    );
    assert.match(await page.locator("#toast").textContent(), /Unexpected host call: media.status/);
    assert.equal(
      await page.evaluate(() => window.__taskCalls.length),
      0,
      "A failed native check must not submit an automatic Agent task",
    );
    assert.deepEqual(
      await readProject(page),
      initial,
      "A failed capability check must not edit the project",
    );
    const checked = await nativeStatusCount();
    await page.locator('[data-tab="jobs"]').click();
    await page.waitForFunction(
      (count) =>
        window.__genericHostCalls.filter(
          (call) => call.method === "tasks.start" && call.args.input?.request?.action === "status",
        ).length > count,
      checked,
    );
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent.includes("Unexpected host call: media.status"),
    );
    assert.equal(await page.evaluate(() => window.__taskCalls.length), 0);
  } finally {
    await page.close();
  }
});

test("an older Host without generic task capabilities explains the upgrade while preserving local editing", async () => {
  const page = await pageWithBridge(true, false);
  try {
    await page.locator('[data-tab="ai"]').click();
    await page.waitForFunction(() =>
      document.body.textContent.includes("缺少通用本地任务或资源接口"),
    );
    assert.match(await page.locator(".library-panel > .host-required").textContent(), /更新主程序/);
    await page.locator('[data-tab="media"]').click();
    await demo(page);
    assert.ok((await readProject(page)).clips.length > 0);
  } finally {
    await page.close();
  }
});

test("timeline activation without pointer coordinates stays inside the selected clip", async () => {
  const page = await pageWithBridge(true);
  try {
    await demo(page);
    const original = await readProject(page);
    let start = 0;
    for (const clip of original.clips) {
      // Find and activate the clip in one page task. A locator evaluate resolves the element and
      // runs the callback in two round trips, so a background render in between would click a
      // detached, already replaced clip.
      await page.locator(`#studio [data-clip="${clip.id}"]`).waitFor({ state: "attached" });
      await page.evaluate(
        (id) => document.querySelector(`#studio [data-clip="${CSS.escape(id)}"]`).click(),
        clip.id,
      );
      const state = await page.evaluate(() => window.__panelTools.read_video_project());
      assert.equal(state.selectedClipId, clip.id);
      assert.equal(state.playheadFrame, start);
      assert.match(await page.locator("#time-current").textContent(), /^\d{2}:\d{2}:\d{2}:\d{2}$/);
      start += clip.outFrame - clip.inFrame;
    }
    assert.deepEqual(
      await readProject(page),
      original,
      "Selecting a clip does not edit the project",
    );
    assert.doesNotMatch(await page.locator("#toast").textContent(), /时间码/);
  } finally {
    await page.close();
  }
});

test("a background render keeps keyboard focus on a timeline clip, so Enter still selects it", async () => {
  const page = await pageWithBridge(true);
  try {
    await demo(page);
    const project = await readProject(page);
    const targets = [
      ["data-clip", project.clips[1].id],
      ["data-audio-clip", project.audioClips[0].id],
    ];
    for (const [attribute, id] of targets) {
      const selector = `#studio [${attribute}="${id}"]`;
      await page.locator(selector).waitFor({ state: "attached" });
      await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        element.dataset.beforeRender = "true";
        element.focus();
      }, selector);
      // A background refresh (here: the panel becoming visible again) re-renders the timeline.
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      assert.equal(
        await page.evaluate(
          ({ selector }) => {
            const active = document.activeElement;
            return active?.matches(selector) && !active.dataset.beforeRender;
          },
          { selector },
        ),
        true,
        `${attribute} focus moves to the re-rendered clip`,
      );
      await page.keyboard.press("Enter");
      const state = await page.evaluate(() => window.__panelTools.read_video_project());
      assert.equal(state.selectedClipId, id);
    }
  } finally {
    await page.close();
  }
});

test("late media loading preserves an unapplied source trim draft", async () => {
  const page = await pageWithBridge();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/demo-narration.mp3", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await demo(page);
    const firstClip = (await readProject(page)).clips[0];
    await page.locator(`[data-clip="${firstClip.id}"]`).click();
    await page.locator("#trim-out").fill("3");
    release();
    await page.waitForFunction(
      () => document.querySelector("#toast")?.textContent === "已打开有声示例，点击播放即可试听",
    );
    assert.equal(await page.locator("#trim-out").inputValue(), "3");
    await page.getByRole("button", { name: "应用裁剪", exact: true }).click();
    await saved(page);
    assert.equal((await readProject(page)).clips[0].outFrame, 90);
  } finally {
    release();
    await page.close();
  }
});

test("editing, transcript ripple, undo, proposal review, portable downloads and restore", async () => {
  const page = await pageWithBridge();
  await demo(page);
  assert.equal((await readProject(page)).clips.length, 3);
  assert.equal((await readProject(page)).audioClips.length, 1, "Demo has actual narration");
  await page.locator('[data-tab="voiceover"]').click();
  await page.locator("#voiceover-text").fill("自定义文案需要实际配音能力。");
  assert.equal(
    await page.getByRole("button", { name: "生成配音并加入音轨", exact: true }).isDisabled(),
    true,
  );
  assert.match(
    await page.locator(".voiceover-section .host-required").textContent(),
    /浏览器可听内置示例旁白/,
  );
  await page.locator('[data-tab="media"]').click();
  await page.screenshot({ path: resolve(screenshots, "studio-desktop.png"), fullPage: true });
  await page.locator('[data-tab="ai"]').click();

  const firstClip = (await readProject(page)).clips[0];
  await page.locator(`[data-clip="${firstClip.id}"]`).click();
  await page.locator("#trim-out").fill("3");
  await page.getByRole("button", { name: "应用裁剪", exact: true }).click();
  await saved(page);
  let project = await readProject(page);
  assert.equal(project.clips[0].outFrame, 90);
  assert.equal(project.captions[1].startFrame, 120);
  await page.getByRole("button", { name: "撤销（⌘ Z）", exact: true }).click();
  await saved(page);
  assert.equal((await readProject(page)).clips[0].outFrame, 180);

  await page.locator('[data-tab="ai"]').click();
  assert.equal(
    await page.getByRole("button", { name: "开始全流程制作", exact: true }).isDisabled(),
    true,
  );
  assert.match(
    await page.locator(".library-panel > .host-required").textContent(),
    /CodeShell.*自动制作和后台 MP4/,
  );
  await page.getByRole("button", { name: "创建规则草案", exact: true }).click();
  assert.equal((await readProject(page)).clips.length, 3, "Review does not mutate the project");
  const review = await page.locator(".proposal-card").innerText();
  assert.match(review, /15 秒精简版/);
  assert.match(review, /主画面\s*3\s*→\s*2/, "The review counts clips per track");
  assert.match(review, /保留「.+」到 15\.00 秒/);
  assert.match(review, /删除主画面轨 15\.00 秒之后的 1 个片段/);
  assert.match(review, /截断其他轨道 15\.00 秒之后的 \d+ 个片段/, "Narration and captions end too");
  assert.match(review, /\n15\.00s\n/, "The whole video becomes 15 seconds");
  await page.screenshot({ path: resolve(screenshots, "studio-ai-review.png"), fullPage: true });
  await page.getByRole("button", { name: "应用方案", exact: true }).click();
  await saved(page);
  project = await readProject(page);
  assert.equal(
    project.clips.reduce((sum, clip) => sum + clip.outFrame - clip.inFrame, 0),
    450,
  );
  assert.equal(project.clips.length, 2);
  await page.getByRole("button", { name: "撤销（⌘ Z）", exact: true }).click();
  await saved(page);
  assert.equal((await readProject(page)).clips.length, 3);

  await page.getByRole("button", { name: "创建规则草案", exact: true }).click();
  await page.getByRole("button", { name: "后移", exact: true }).click();
  await saved(page);
  assert.equal(
    await page.getByRole("button", { name: "应用方案", exact: true }).isDisabled(),
    true,
    "Manual edits stale the proposal",
  );
  await page.getByRole("button", { name: "撤销（⌘ Z）", exact: true }).click();
  await saved(page);

  await page.locator('[data-tab="transcript"]').click();
  const captionPanel = page.locator(".library-panel #caption-panel-host > .editor-captions");
  const originalCaptions = (await readProject(page)).captions.length;
  assert.equal(await captionPanel.locator(".ec-row").count(), originalCaptions);
  await captionPanel.locator("[data-caption-srt-input]").setInputFiles({
    name: "test.srt",
    mimeType: "text/plain",
    // Between the demo's first two captions: a cue over an existing one would be skipped.
    buffer: Buffer.from("1\n00:00:05,500 --> 00:00:06,500\n新增字幕 <script>alert(1)</script>\n"),
  });
  await captionPanel.getByRole("button", { name: "应用预览", exact: true }).click();
  await page.waitForFunction(
    (n) => document.querySelectorAll(".library-panel .ec-row").length === n + 1,
    originalCaptions,
  );
  await saved(page);
  assert.equal(
    (await readProject(page)).captions.length,
    originalCaptions + 1,
    "SRT import appends unique captions",
  );
  await captionPanel.getByRole("button", { name: "全选字幕", exact: true }).click();
  const srtDownload = page.waitForEvent("download");
  await captionPanel.getByRole("button", { name: "导出所选 SRT", exact: true }).click();
  const srt = await srtDownload;
  const srtText = await readFile(await srt.path(), "utf8");
  assert.match(srtText, /00:00:05,500 --> 00:00:06,500\n新增字幕 <script>alert\(1\)<\/script>/);
  assert.equal(srtText.match(/-->/g).length, originalCaptions + 1);

  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载工程 JSON", exact: true }).click();
  const json = JSON.parse(await readFile(await (await jsonDownload).path(), "utf8"));
  assert.equal(json.schemaVersion, 2);
  assert.equal((await legacyProjectFromDocument(json)).clips.length, 3);
  const revision = json.revision;
  await page.reload();
  await enterLegacyProduction(page);
  await page.locator("#revision").waitFor();
  const reopened = await readProject(page);
  assert.equal(reopened.revision, revision);

  await page.getByRole("button", { name: "新建工程", exact: true }).click();
  await waitForProjectSwitch(page, reopened.id, readProject);
  assert.equal((await readProject(page)).clips.length, 0);
  await page.getByRole("button", { name: "最近工程 / 打开工程", exact: true }).click();
  await page.locator(".recent-project").filter({ hasText: "从想法，到成片。" }).click();
  await page.waitForFunction(
    () => document.querySelector("#project-name")?.value === "从想法，到成片。",
  );
  await saved(page);
  assert.equal(
    (await readProject(page)).clips.length,
    3,
    "Switching project archives the previous project",
  );

  await page.setViewportSize({ width: 480, height: 920 });
  await page.screenshot({ path: resolve(screenshots, "studio-narrow.png"), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "Narrow layout must not overflow horizontally",
  );
  await page.close();
});

test("real Agent bridge contract rejects stale results and submits one task", async () => {
  // A Host with the Agent bridge but without native media interfaces uses the
  // reviewed edit-plan flow. The persistent-media case covers full production.
  const page = await pageWithBridge(true, false);
  await demo(page);
  await page.locator('[data-tab="ai"]').click();
  await page.locator("#ai-prompt").fill("调整开头音量到一半");
  await page.locator('[data-action="ask-ai"]:enabled').evaluate((button) => {
    button.click();
    button.click();
  });
  await page.waitForFunction(
    () => window.__taskCalls.length === 1 && Object.keys(window.__tasks).length === 1,
  );
  assert.equal(await page.evaluate(() => window.__taskCalls.length), 1);
  const request = await page.evaluate(() => window.__panelTools.read_video_project());
  assert.ok(request.requestToken);
  const candidate = {
    projectId: request.project.id,
    requestToken: request.requestToken,
    baseRevision: request.project.revision,
    title: "降低开场音量",
    explanation: "基于用户明确要求",
    operations: [{ type: "volume", clipId: request.project.clips[0].id, volume: 0.5 }],
  };
  await page.evaluate((proposal) => window.__panelTools.propose_video_edit(proposal), candidate);
  assert.equal((await readProject(page)).clips[0].volume, 1);
  await page.getByRole("button", { name: "应用方案", exact: true }).click();
  await saved(page);
  assert.equal((await readProject(page)).clips[0].volume, 0.5);
  const stale = await page.evaluate(async (proposal) => {
    try {
      await window.__panelTools.propose_video_edit(proposal);
      return false;
    } catch {
      return true;
    }
  }, candidate);
  assert.equal(stale, true);
  await page.evaluate(() =>
    window.__taskCallbacks["agent.task.changed"]({
      id: "task-1",
      status: "completed",
      result: { text: "no repeated proposal" },
    }),
  );
  await page.evaluate(() =>
    window.__taskCallbacks["agent.task.changed"]({
      id: "task-1",
      status: "completed",
      result: { text: "no repeated proposal" },
    }),
  );
  assert.equal((await readProject(page)).clips[0].volume, 0.5);
  await page.getByRole("button", { name: "新建工程", exact: true }).click();
  await saved(page);
  const wrongProject = await page.evaluate(async (proposal) => {
    try {
      await window.__panelTools.propose_video_edit(proposal);
      return false;
    } catch {
      return true;
    }
  }, candidate);
  assert.equal(wrongProject, true);
  await page.close();
});

test("malformed portable project never replaces the current editable project", async () => {
  const page = await pageWithBridge();
  await demo(page);
  const original = await readProject(page);
  await page.locator("#project-input").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":1,"clips":[]}'),
  });
  await page.waitForFunction(() =>
    /工程|文档|schema|版本|未知字段/.test(document.querySelector("#toast")?.textContent ?? ""),
  );
  assert.deepEqual(await readProject(page), original);
  await page.close();
});

test("import is undoable and original media automatically reconnects after reopening", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "video-studio-ui-"));
  const fixture = resolve(directory, "still.png");
  const page = await pageWithBridge();
  try {
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 80;
      canvas.height = 40;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#db5823";
      ctx.fillRect(0, 0, 80, 40);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await writeFile(fixture, Buffer.from(png, "base64"));
    await page.locator("#media-input").setInputFiles(fixture);
    await page.waitForFunction(() => document.querySelectorAll(".asset-card").length === 1);
    await saved(page);
    const asset = (await readProject(page)).assets[0];
    assert.equal(asset.width, 80);
    assert.equal(asset.height, 40);
    await page.locator('[data-ew-action="undo"]').click();
    await saved(page);
    assert.equal((await readProject(page)).assets.length, 0);
    await page.locator('[data-ew-action="redo"]').click();
    await saved(page);
    assert.equal((await readProject(page)).assets[0].id, asset.id);
    await page.locator("[data-add-asset]").click();
    await saved(page);
    const before = await readProject(page);
    await page.reload();
    await enterLegacyProduction(page);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".asset-card").length === 1 &&
        document.querySelectorAll(".asset-card.missing").length === 0,
    );
    assert.deepEqual(await readProject(page), before, "Restoring bytes must not edit the project");
    const pixel = await page
      .locator("#preview:visible, [data-ew-canvas]:visible")
      .evaluate((canvas) => [
        ...canvas.getContext("2d").getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data,
      ]);
    assert.ok(pixel[0] > 200 && pixel[1] < 100, "Reconnected image is actually painted in preview");
  } finally {
    await page.close();
    await rm(directory, { recursive: true, force: true });
  }
});

/** Visible text nodes written only in Latin capitals (eyebrows, badges, media types). */
const latinLabels = (page) =>
  page.evaluate(() => {
    const allowed = new Set(["MP4", "SRT", "WAV", "MP3", "MOV", "PNG", "JPG", "AAC", "MIMI", "AI", "FPS"]);
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      const parent = node.parentElement;
      if (!text || !parent || parent.closest("script,style,kbd,code,[hidden]")) continue;
      if (!parent.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      if (/[\u3400-\u9fff]/.test(text)) continue;
      const words = text.match(/\b[A-Z]{3,}\b/g) ?? [];
      if (words.some((word) => !allowed.has(word))) found.push(text);
    }
    return found;
  });

test("main pages and media cards label everything in Chinese, keeping only format names in Latin", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "video-studio-ui-"));
  const fixture = resolve(directory, "still.png");
  const page = await pageWithBridge();
  try {
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 80;
      canvas.height = 40;
      canvas.getContext("2d").fillRect(0, 0, 80, 40);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await writeFile(fixture, Buffer.from(png, "base64"));
    await page.locator('[data-tab="media"]').click();
    await page.locator("#media-input").setInputFiles(fixture);
    await page.waitForFunction(() => document.querySelectorAll(".asset-card").length === 1);
    await saved(page);
    await page.locator('[data-tab="media"]').click();
    const card = page.locator(".asset-card").first();
    assert.match(await card.textContent(), /图片\s*·\s*80×40/);
    const seen = {};
    for (const tab of ["media", "roughcut", "recording", "spoken", "transcript", "voiceover", "ai", "jobs"]) {
      await page.locator(`[data-tab="${tab}"]`).click();
      await page.waitForTimeout(150);
      const labels = await latinLabels(page);
      if (labels.length) seen[tab] = labels;
    }
    assert.deepEqual(seen, {});
  } finally {
    await page.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("original audio and rough-cut marks survive a complete browser restart", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "video-studio-persistent-cache-"));
  let context;
  const open = async () => {
    context = await chromium.launchPersistentContext(directory, {
      headless: true,
      viewport: { width: 1440, height: 960 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/?legacyWorkspace=1`);
    await enterLegacyProduction(page);
    await page.locator("#studio .workspace").waitFor();
    return page;
  };
  try {
    let page = await open();
    await page
      .locator("#media-input")
      .setInputFiles(resolve(root, "tests/fixtures/static-tone.wav"));
    await page.waitForFunction(() => document.querySelectorAll(".asset-card").length === 1);
    await saved(page);
    const asset = (await readProject(page)).assets[0];
    assert.equal(
      asset.mediaId,
      undefined,
      "This exercises browser File custody, not Host resources",
    );
    await page.locator(`[data-rough-source="${asset.id}"]`).click();
    await page.locator('[data-roughcut-field="name"]').fill("保留原声");
    await page.locator('[data-action="roughcut-save"]').click();
    await saved(page);
    const before = await readProject(page);
    assert.equal(before.roughCuts.length, 1);
    await context.close();
    context = undefined;

    page = await open();
    await page.locator(`[data-rough-source="${asset.id}"]`).click();
    await page.waitForFunction(() => !document.querySelector(".roughcut-notice"));
    assert.deepEqual(
      await readProject(page),
      before,
      "The same source ID and exact marks are restored",
    );
    await page.locator('[data-action="roughcut-play"]').click();
    await page.waitForFunction(
      () => Number(document.querySelector("[data-roughcut-scrub]")?.value) > 0,
    );
    await page.locator('[data-action="roughcut-play"]').click();
  } finally {
    await context?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy uncached media can reconnect without changing its saved identity", async () => {
  const page = await pageWithBridge();
  const fixture = resolve(root, "tests/fixtures/static-tone.wav");
  try {
    await page.locator("#media-input").setInputFiles(fixture);
    await page.waitForFunction(() => document.querySelectorAll(".asset-card").length === 1);
    await saved(page);
    const asset = (await readProject(page)).assets[0];
    await page.locator(`[data-rough-source="${asset.id}"]`).click();
    await page.locator('[data-roughcut-field="name"]').fill("旧工程保留段");
    await page.locator('[data-action="roughcut-save"]').click();
    await saved(page);
    const before = await readProject(page);
    await page.evaluate(
      (id) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("mimi-studio-recordings", 1);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction("recordings", "readwrite");
            transaction.objectStore("recordings").delete(id);
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
            transaction.onabort = transaction.onerror = () => {
              db.close();
              reject(transaction.error);
            };
          };
          request.onerror = () => reject(request.error);
        }),
      asset.id,
    );
    await page.reload();
    await enterLegacyProduction(page);
    await page.locator(`[data-rough-source="${asset.id}"]`).click();
    await page.locator(".roughcut-notice").waitFor();
    await page.locator("#media-input").setInputFiles(fixture);
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent.includes("重连 1 个素材"),
    );
    await saved(page);
    await page.locator(`[data-rough-source="${asset.id}"]`).click();
    await page.waitForFunction(() => !document.querySelector(".roughcut-notice"));
    assert.deepEqual(
      await readProject(page),
      before,
      "Restoring cached bytes preserves IDs and ranges without inventing a content revision",
    );
    await page.reload();
    await enterLegacyProduction(page);
    await page.locator(`[data-rough-source="${asset.id}"]`).click();
    await page.waitForFunction(() => !document.querySelector(".roughcut-notice"));
  } finally {
    await page.close();
  }
});

for (const failure of ["quota", "abort-after-put"]) {
  test(`failed original-file cache ${failure} never publishes a successful import`, async () => {
    const page = await pageWithBridge();
    const fixture = resolve(root, "tests/fixtures/static-tone.wav");
    try {
      await page.evaluate((failure) => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name !== "recordings") return put.apply(this, args);
          IDBObjectStore.prototype.put = put;
          if (failure === "quota") throw new DOMException("storage full", "QuotaExceededError");
          const request = put.apply(this, args);
          request.addEventListener("success", () => {
            window.__successfulPutBeforeAbort = true;
            this.transaction.abort();
          });
          return request;
        };
      }, failure);
      await page.locator("#media-input").setInputFiles(fixture);
      await page.waitForFunction(() =>
        document.querySelector("#toast")?.textContent.includes("素材尚未保存"),
      );
      assert.deepEqual(
        (await readProject(page))?.assets ?? [],
        [],
        "Metadata must wait for the Blob transaction to commit",
      );
      assert.equal(await page.locator(".asset-card").count(), 0);
      if (failure === "abort-after-put")
        assert.equal(
          await page.evaluate(() => window.__successfulPutBeforeAbort),
          true,
          "The real IndexedDB put succeeded before rollback",
        );
      else assert.match(await page.locator("#toast").textContent(), /空间不足/);

      await page.locator("#media-input").setInputFiles(fixture);
      await page.waitForFunction(() => document.querySelectorAll(".asset-card").length === 1);
      await saved(page);
      assert.equal(
        (await readProject(page)).assets.length,
        1,
        "Retry publishes only the durably saved source",
      );
    } finally {
      await page.close();
    }
  });
}

test("project switching blocks concurrent media import and export", async () => {
  const page = await pageWithBridge(true);
  try {
    await demo(page);
    await page.evaluate(() => {
      window.__holdArchive = true;
    });
    await page.getByRole("button", { name: "新建工程", exact: true }).click();
    await page.waitForFunction(() => window.__archiveStarted === true);
    await page.getByRole("button", { name: "导出视频", exact: true }).click();
    assert.equal(await page.locator("#export-dialog").evaluate((dialog) => dialog.open), false);
    await page.locator("#media-input").setInputFiles({
      name: "blocked.png",
      mimeType: "image/png",
      buffer: Buffer.from("not needed: operation must be rejected before decoding"),
    });
    await page.evaluate(() => {
      window.__holdArchive = false;
      window.__releaseArchive();
    });
    await page.waitForFunction(
      () => window.__panelTools.read_video_project().project.name === "未命名项目",
    );
    await saved(page);
    const project = await readProject(page);
    assert.equal(project.assets.length, 0);
    assert.equal(project.clips.length, 0);
  } finally {
    await page.close();
  }
});

test("persistent media, versioned automatic edits, real tool contract and reload recovery", async () => {
  const sourceBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7m8AAAAASUVORK5CYII=",
    "base64",
  );
  const { createHash } = await import("node:crypto");
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceId = `asset-${sourceHash}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(installGenericMediaTaskMock);
  await page.addInitScript(
    ({ sourceHash, sourceByteLength }) => {
      const assetId = `asset-${sourceHash}`,
        videoId = "asset-" + "b".repeat(64);
      const asset = {
        id: assetId,
        name: "品牌画面.png",
        mimeType: "image/png",
        bytes: sourceByteLength,
        sha256: sourceHash,
        createdAt: Date.now(),
      };
      const documents = JSON.parse(localStorage.getItem("test-documents") || "{}");
      const jobs = JSON.parse(localStorage.getItem("test-jobs") || "{}");
      window.__panelTools = {};
      window.__events = {};
      window.__taskCalls = [];
      window.__exports = [];
      const store = () => {
        localStorage.setItem("test-documents", JSON.stringify(documents));
        localStorage.setItem("test-jobs", JSON.stringify(jobs));
      };
      const job = (type) => {
        const value = {
          id: "job-" + crypto.randomUUID(),
          type,
          status: "queued",
          attempt: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        jobs[value.id] = value;
        store();
        return structuredClone(value);
      };
      const preparation = {
        assetId,
        inspection: {
          kind: "image",
          durationSeconds: null,
          video: { width: 1, height: 1, displayWidth: 1, displayHeight: 1 },
        },
        preparedAt: Date.now(),
      };
      window.__completeJob = (type) => {
        const value = Object.values(jobs).find((j) => j.type === type && j.status === "queued");
        if (!value) throw Error("No queued " + type);
        value.status = "succeeded";
        value.updatedAt = Date.now();
        value.result =
          type === "import"
            ? { assets: [asset] }
            : type === "prepare"
              ? preparation
              : type === "render"
                ? {
                    video: {
                      asset: { id: videoId, name: "成片.mp4", mimeType: "video/mp4", bytes: 12345 },
                    },
                  }
                : {};
        store();
        window.__events["media.job.changed"]?.(structuredClone(value));
        return value.id;
      };
      window.codeshellPanel = {
        getContext: async () => ({ cwd: "/test/persistent-video" }),
        registerTool(name, handler) {
          window.__panelTools[name] = handler;
          return () => {};
        },
        on(name, handler) {
          window.__events[name] = handler;
          return () => {};
        },
        async call(method, args = {}) {
          if (method === "media.status")
            return {
              persistent: true,
              ffmpeg: { available: true },
              transcription: { available: false },
              hyperframes: { available: true, version: "0.8.30" },
            };
          if (method === "storage.get") return null;
          if (method === "media.document.get") {
            const saved = documents[args.key];
            return saved ? structuredClone(saved) : { revision: 0, data: null };
          }
          if (method === "media.document.set") {
            const before = documents[args.key];
            if ((before?.revision ?? 0) !== args.baseRevision)
              throw Error("Document revision conflict");
            const saved = {
              revision: args.baseRevision + 1,
              data: structuredClone(args.data),
              updatedAt: Date.now(),
              label: args.label,
            };
            documents[args.key] = saved;
            store();
            return { revision: saved.revision, updatedAt: saved.updatedAt, label: args.label };
          }
          if (method === "media.document.versions") {
            const saved = documents[args.key];
            return saved
              ? [{ revision: saved.revision, updatedAt: saved.updatedAt, label: saved.label }]
              : [];
          }
          if (method === "media.import") throw Error("Import must use the native file importer");
          if (method === "media.prepare") return { jobs: args.assetIds.map(() => job("prepare")) };
          if (method === "media.assets.get") return { asset, preparation };
          if (method === "media.jobs.list")
            return {
              total: Object.keys(jobs).length,
              jobs: Object.values(jobs).map(({ result, ...j }) => j),
            };
          if (method === "media.jobs.get") return structuredClone(jobs[args.id]);
          if (method === "media.render")
            throw Error("Canonical export must not use legacy media.render");
          if (method === "media.export") {
            window.__exports.push(args.assetId);
            return { saved: true, name: "成片.mp4" };
          }
          if (method === "agent.task.start") {
            window.__taskCalls.push(args);
            const task = { id: "auto-task-1", status: "running" };
            localStorage.setItem("test-agent-task", JSON.stringify(task));
            return task;
          }
          if (method === "agent.task.get")
            return JSON.parse(localStorage.getItem("test-agent-task"));
          if (method === "agent.task.cancel") return { id: args.id, status: "cancelled" };
          throw Error("Unexpected persistent host call: " + method);
        },
      };
      // The shared fixture owns byte uploads, durable resources and export tasks.
      // This test adds only the reviewed source-inspection task it does not model.
      const generic = window.codeshellPanel;
      const inspectionJobs = JSON.parse(
        localStorage.getItem("test-source-inspection-tasks") || "{}",
      );
      const inspectionListeners = new Set();
      const saveInspectionJobs = () =>
        localStorage.setItem("test-source-inspection-tasks", JSON.stringify(inspectionJobs));
      window.__sourceInspectionRequests = [];
      window.__completeSourceInspection = () => {
        const value = Object.values(inspectionJobs).find((item) => item.status === "queued");
        if (!value) throw Error("No queued source inspection");
        value.status = "succeeded";
        value.updatedAt = Date.now();
        value.result = {
          result: {
            resourceId: assetId,
            sha256: sourceHash,
            bytes: sourceByteLength,
            kind: "image",
            duration: 0,
            width: 1,
            height: 1,
            mimeType: "image/png",
            inspection: {
              schemaVersion: 1,
              format: "png_pipe",
              timing: {
                origin: { numerator: "0", denominator: "1" },
                duration: { numerator: "0", denominator: "1" },
                tickRounding: "nearest",
                basis: "static-image",
              },
              video: { codec: "png", width: 1, height: 1 },
              compatibility: { preview: "static-image", export: "supported", limitations: [] },
            },
          },
          artifacts: [],
        };
        saveInspectionJobs();
        const { input, result, ...summary } = value;
        for (const listener of inspectionListeners) listener(structuredClone(summary));
      };
      window.codeshellPanel = {
        ...generic,
        on(event, listener) {
          const unsubscribe = generic.on(event, listener);
          if (event === "tasks.changed") inspectionListeners.add(listener);
          return () => {
            unsubscribe();
            inspectionListeners.delete(listener);
          };
        },
        async call(method, args = {}) {
          if (
            method === "tasks.start" &&
            args.entry === "editor-runtime" &&
            args.input?.request?.action === "inspect-source"
          ) {
            const request = args.input.request;
            if (
              args.recovery !== "retry" ||
              !/^editor-[a-f0-9-]{36}$/.test(request.transferId) ||
              JSON.stringify(request.resourceIds) !== JSON.stringify([assetId]) ||
              JSON.stringify(args.input.resources) !==
                JSON.stringify([{ assetId, path: "inputs/resource-0.bin" }])
            )
              throw Error("Invalid reviewed source inspection hand-off");
            const uploaded = await generic.call("resources.get", { id: assetId });
            if (uploaded.asset.sha256 !== sourceHash || uploaded.asset.bytes !== sourceByteLength)
              throw Error("Source inspection did not receive the uploaded original");
            window.__genericHostCalls.push({ method, args: structuredClone(args) });
            window.__sourceInspectionRequests.push(structuredClone(args));
            const value = {
              id: crypto.randomUUID(),
              status: "queued",
              attempt: 1,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              entry: { name: "editor-runtime", sha256: "a".repeat(64) },
              recovery: args.recovery,
              input: structuredClone(args.input),
            };
            inspectionJobs[value.id] = value;
            saveInspectionJobs();
            return structuredClone(value);
          }
          if (method === "tasks.get" && inspectionJobs[args.id])
            return structuredClone(inspectionJobs[args.id]);
          if (method === "tasks.list") {
            const values = await generic.call(method, args);
            return [
              ...values,
              ...Object.values(inspectionJobs).map(({ input, result, ...summary }) => summary),
            ];
          }
          return generic.call(method, args);
        },
      };
    },
    { sourceHash, sourceByteLength: sourceBytes.length },
  );
  await page.goto(`${url}/?legacyWorkspace=1`);
  await enterLegacyProduction(page);
  await page.locator("#studio .workspace").waitFor();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入素材", exact: true }).first().click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "品牌画面.png", mimeType: "image/png", buffer: sourceBytes });
  await page.waitForFunction(() => window.__sourceInspectionRequests.length === 1);
  assert.equal(
    (await readProject(page)).assets.length,
    0,
    "The original is uploaded before inspection, but not published before inspection succeeds",
  );
  assert.equal((await readSavedEditorDocument(page))?.assets.length ?? 0, 0);
  const upload = await page.evaluate(() => ({
    file: JSON.parse(localStorage.getItem("test-generic-resource-files"))[
      window.__sourceInspectionRequests[0].input.request.resourceIds[0]
    ],
    calls: window.__genericHostCalls.filter((call) => call.method.startsWith("resources.upload.")),
    request: window.__sourceInspectionRequests[0],
  }));
  assert.deepEqual(
    upload.calls.map((call) => call.method),
    ["resources.upload.begin", "resources.upload.write", "resources.upload.finish"],
  );
  assert.equal(upload.file.asset.id, sourceId);
  assert.equal(upload.file.asset.bytes, sourceBytes.length);
  assert.deepEqual(
    Buffer.concat(upload.file.chunks.map((chunk) => Buffer.from(chunk.dataBase64, "base64"))),
    sourceBytes,
  );
  assert.deepEqual(upload.request.input.resources, [
    { assetId: sourceId, path: "inputs/resource-0.bin" },
  ]);
  await page.evaluate(() => window.__completeSourceInspection());
  await page.waitForFunction(
    () => window.__panelTools.read_video_project().project.assets.length === 1,
  );
  await page.locator('[data-tab="media"]').click();
  await page.locator("[data-add-asset]").click();
  await saved(page);
  assert.equal((await readProject(page)).assets[0].mediaId, sourceId);
  const initialDocument = await readSavedEditorDocument(page);
  assert.equal(initialDocument.assets[0].resourceId, sourceId);
  assert.equal(
    initialDocument.assets[0].duration,
    0,
    "Static images retain their native timeless source metadata",
  );
  assert.equal(initialDocument.assets[0].fingerprint, sourceHash);
  assert.equal(
    initialDocument.assets[0].metadata.editorInspection.compatibility.preview,
    "static-image",
  );
  const initialClip = initialDocument.sequences[0].clips.find((clip) => clip.kind === "media");
  const advancedTransform = {
    ...initialClip.transform,
    rotation: 13,
    scaleX: {
      keyframes: [
        { time: 0, value: 0.6 },
        { time: initialClip.duration - 1, value: 1, easing: "ease-in" },
      ],
    },
  };
  await page.evaluate(
    async ({ sequenceId, clipId, transform }) => {
      const tools = window.__panelTools;
      const identity = tools.read_video_project({ editor: { view: "project" } }).identity;
      await tools.apply_video_edit({
        editor: {
          identity,
          label: "精确缩放动画",
          steps: [
            {
              kind: "operations",
              operations: [{ type: "clip.update", sequenceId, clipId, patch: { transform } }],
            },
          ],
        },
      });
    },
    {
      sequenceId: initialDocument.activeSequenceId,
      clipId: initialClip.id,
      transform: advancedTransform,
    },
  );
  await page.locator('[data-tab="ai"]').click();
  await page.locator("#ai-prompt").fill("做一个带字幕的介绍视频并导出");
  const preparationCount = await page.evaluate(
    () =>
      Object.values(JSON.parse(localStorage.getItem("test-jobs"))).filter(
        (job) => job.type === "prepare",
      ).length,
  );
  await page.getByRole("button", { name: "开始全流程制作", exact: true }).click();
  await page.waitForFunction(() => window.__taskCalls.length === 1);
  const request = await page.evaluate(() => window.__taskCalls[0]);
  assert.equal(request.skill, "video-studio:video-workflow");
  assert.equal(
    await page.evaluate(
      () =>
        Object.values(JSON.parse(localStorage.getItem("test-jobs"))).filter(
          (job) => job.type === "prepare",
        ).length,
    ),
    preparationCount,
    "prepared imported media should not be blindly submitted again",
  );
  assert.deepEqual(request.toolNames, ["Panel"]);
  assert.equal(request.maxTurns, 20);
  await page.evaluate(async () => {
    const current = window.__panelTools.read_video_project();
    await window.__panelTools.apply_video_edit({
      projectId: current.project.id,
      requestToken: current.requestToken,
      baseRevision: current.project.revision,
      title: "真实自动字幕",
      operations: [
        {
          type: "caption",
          caption: { id: "auto-caption", startFrame: 0, endFrame: 60, text: "从想法，到成片。" },
        },
      ],
    });
  });
  const current = await readProject(page);
  assert.equal(current.captions[0].text, "从想法，到成片。");
  await assert.rejects(
    page.evaluate(async () => {
      const current = window.__panelTools.read_video_project();
      await window.__panelTools.apply_video_edit({
        projectId: current.project.id,
        requestToken: current.requestToken,
        baseRevision: current.project.revision - 1,
        title: "过期结果",
        operations: [{ type: "settings", name: "不应覆盖" }],
      });
    }),
    /revision|版本|修订|过期|变化/,
  );
  assert.notEqual((await readProject(page)).name, "不应覆盖");
  await page.evaluate(async () => {
    const state = window.__panelTools.read_video_project();
    const receipt = await window.__panelTools.render_video_project({
      projectId: state.project.id,
      requestToken: state.requestToken,
      baseRevision: state.project.revision,
    });
    if (!receipt.accepted || receipt.jobId) throw Error("Expected an honest early export receipt");
    window.__renderOperation = receipt.operationId;
  });
  await page.waitForFunction(async () => {
    const state = await window.__panelTools.read_video_project({
      view: "jobs",
      jobIds: [window.__renderOperation],
    });
    return state.operations?.[0]?.jobId;
  });
  await page.evaluate(async () => {
    const state = await window.__panelTools.read_video_project({
      view: "jobs",
      jobIds: [window.__renderOperation],
    });
    await window.__completeEditorRender(state.operations[0].jobId, {
      id: `asset-${"b".repeat(64)}`,
      sha256: "b".repeat(64),
      name: "成片.mp4",
      mimeType: "video/mp4",
      bytes: 12345,
    });
  });
  const snapshots = await page.evaluate(() => window.__editorRenderRequests);
  assert.equal(snapshots.length, 1);
  const canonical = await readSavedEditorDocument(page);
  assert.deepEqual(
    snapshots[0].document.sequences,
    canonical.sequences,
    "Automatic rendering receives every canonical layer and animation",
  );
  assert.deepEqual(
    snapshots[0].document.sequences[0].clips.find((clip) => clip.id === initialClip.id).transform,
    advancedTransform,
  );
  await page.locator('[data-tab="jobs"]').click();
  await page.getByRole("button", { name: "保存 MP4", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__exports), ["asset-" + "b".repeat(64)]);
  await page.reload();
  await enterLegacyProduction(page);
  await page.locator("#studio .workspace").waitFor();
  await page.waitForFunction(
    () => window.__panelTools.read_video_project().missingAssetIds.length === 0,
  );
  assert.equal((await readProject(page)).id, current.id);
  assert.equal((await readProject(page)).assets[0].mediaId, sourceId);
  const reopenedDocument = await readSavedEditorDocument(page);
  assert.equal(reopenedDocument.assets[0].fingerprint, sourceHash);
  assert.deepEqual(
    reopenedDocument.sequences[0].clips.find((clip) => clip.id === initialClip.id).transform,
    advancedTransform,
  );
  assert.equal((await readProject(page)).captions[0].text, "从想法，到成片。");
  await page.locator('[data-tab="jobs"]').click();
  await page.getByRole("button", { name: "保存 MP4", exact: true }).waitFor();
  await page.close();
});

test("actual preview button sends narrated demo audio to speakers, including reopening a pristine legacy demo", async () => {
  const page = await pageWithBridge();
  await page.addInitScript(installGenericMediaTaskMock);
  await page.addInitScript(() => {
    window.__speakerTaps = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      const result = connect.call(this, destination, ...args);
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        connect.call(this, analyser);
        window.__speakerTaps.push(analyser);
      }
      return result;
    };
  });
  await page.reload();
  await enterLegacyProduction(page);
  await page.locator("#studio .workspace").waitFor();
  const hearAndPause = async () => {
    await page.waitForFunction(
      () =>
        document.querySelector("#time-current").textContent >= "00:00:00:16" &&
        window.__speakerTaps.some((analyser) => {
          const samples = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(samples);
          return (
            analyser.context.state === "running" &&
            Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length) > 0.01
          );
        }),
      undefined,
      { timeout: 6000 },
    );
    const time = await page.locator("#time-current").textContent();
    assert.notEqual(time, "00:00:00:00");
    await page.getByRole("button", { name: "播放 / 暂停（空格）", exact: true }).click();
  };
  const audible = async () => {
    await page.getByRole("button", { name: "回到开头", exact: true }).click();
    await page.getByRole("button", { name: "播放 / 暂停（空格）", exact: true }).click();
    await hearAndPause();
  };
  await page.locator('[data-tab="voiceover"]').click();
  await page.getByRole("button", { name: "听听示例工程", exact: true }).click();
  await hearAndPause();
  await audible();
  const project = await readProject(page);
  const legacy = { ...(await pristineLegacyDemoProject()), id: project.id };
  await page.locator("#project-input").setInputFiles({
    name: "legacy-demo.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await page.waitForFunction(() =>
    document.querySelector("#toast")?.textContent.includes("工程已打开"),
  );
  await saved(page);
  assert.equal(
    (await readProject(page)).audioClips.length,
    1,
    "Opening an untouched legacy demo must reconnect narration, not silently restore a mute example",
  );
  await page.waitForFunction(() => !document.querySelector(".warning-dot"));
  await audible();
  // A delayed Host restore must not rerender/stop playback started by the user.
  await page.addInitScript(installGenericMediaTaskMock);
  const restoredDocument = await readSavedEditorDocument(page);
  await page.addInitScript((document) => {
    let release;
    const documents = { "video-studio-current": { revision: 1, data: document } };
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    window.__panelTools = {};
    window.codeshellPanel = {
      // An older Host that still keeps its own media job list.
      getContext: async () => ({ cwd: "/test/delayed-restore", availableMethods: ["media.jobs.list"] }),
      registerTool: (name, handler) => {
        window.__panelTools[name] = handler;
        return () => {};
      },
      on: () => () => {},
      call: async (method, args = {}) => {
        if (method === "media.status")
          return {
            persistent: true,
            ffmpeg: { available: true },
            transcription: { available: false },
            hyperframes: { available: false },
          };
        if (method === "media.document.get")
          return documents[args.key] ?? { revision: 0, data: null };
        if (method === "media.document.set") {
          const previous = documents[args.key] ?? { revision: 0, data: null };
          if (previous.revision !== args.baseRevision) throw new Error("Document revision changed");
          return (documents[args.key] = {
            revision: previous.revision + 1,
            data: structuredClone(args.data),
          });
        }
        if (method === "media.jobs.list") {
          window.__releaseRestore = release;
          await gate;
          return { total: 0, jobs: [] };
        }
        throw Error("Unexpected restore method: " + method);
      },
    };
  }, restoredDocument);
  await page.reload();
  await enterLegacyProduction(page);
  await page.locator('[data-tab="ai"]').click();
  await page.waitForFunction(() => typeof window.__releaseRestore === "function");
  await page.getByRole("button", { name: "播放 / 暂停（空格）", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#time-current").textContent >= "00:00:01:00",
  );
  await page.evaluate(() => window.__releaseRestore());
  await page.waitForFunction(
    () => document.querySelector("#time-current").textContent >= "00:00:02:00",
    undefined,
    { timeout: 3000 },
  );
  await hearAndPause();
  await page.close();
});

test("voiceover form selects actual model voices, preserves editing, previews explicitly and submits safe replacement", async () => {
  const setup = await pageWithBridge();
  await demo(setup);
  const initial = await readProject(setup);
  await setup.close();
  const speechId = "asset-" + "d".repeat(64);
  initial.assets.push({
    id: "saved-voice",
    name: "已生成的配音",
    kind: "audio",
    durationFrames: 720,
    mediaId: speechId,
    mimeType: "audio/mpeg",
    speech: {
      text: "原来的配音文案。",
      modelId: "configured-speech",
      voiceId: "cloud-a",
      engine: "openai-compatible",
      instructions: "自然亲切",
      rate: 1.25,
    },
  });
  initial.audioClips = [
    {
      id: "old-voice-clip",
      assetId: "saved-voice",
      inFrame: 0,
      outFrame: 120,
      startFrame: 30,
      volume: 0.8,
    },
  ];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(installGenericMediaTaskMock);
  await page.addInitScript(
    ({ initial, speechId }) => {
      const models = [
        {
          id: "macos-say",
          name: "macOS 系统配音",
          provider: "Apple",
          available: true,
          voices: [
            { id: "tingting", name: "Tingting", language: "zh_CN" },
            { id: "daniel", name: "Daniel", language: "en_GB" },
          ],
          defaultVoiceId: "tingting",
        },
        {
          id: "configured-speech",
          name: "我的语音模型",
          provider: "已配置连接",
          available: true,
          voices: [
            { id: "cloud-a", name: "明亮", language: "und" },
            { id: "cloud-b", name: "Calm", language: "en-US" },
          ],
          defaultVoiceId: "cloud-a",
          supportsInstructions: true,
          maxTextLength: 4096,
        },
        {
          id: "unavailable",
          name: "另一条连接",
          provider: "已配置连接",
          available: false,
          reason: "连接缺少凭据",
          voices: [],
        },
      ];
      const documents = { "video-studio-current": { revision: 1, data: initial } };
      const jobs = {};
      let voicesRead = 0;
      window.__ttsRequests = [];
      window.__spoken = [];
      window.__cancelledPreviews = 0;
      window.__documents = documents;
      window.__panelTools = {};
      // This controls the browser speech adapter contract; the actual audio pipeline
      // and built-in narration are checked separately without these doubles.
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: class {
          constructor(text) {
            this.text = text;
          }
        },
      });
      Object.defineProperty(window, "speechSynthesis", {
        value: {
          getVoices: () => [
            { voiceURI: "browser-zh", name: "浏览器中文", lang: "zh-CN", default: true },
          ],
          addEventListener: () => {},
          removeEventListener: () => {},
          speak(value) {
            window.__spoken.push({
              text: value.text,
              voice: value.voice.voiceURI,
              rate: value.rate,
            });
            value.onstart?.();
          },
          cancel() {
            window.__cancelledPreviews++;
          },
        },
      });
      window.codeshellPanel = {
        getContext: async () => ({ cwd: "/test/voiceover-models" }),
        registerTool: (name, handler) => {
          window.__panelTools[name] = handler;
          return () => {};
        },
        on: () => () => {},
        call: async (method, args = {}) => {
          if (method === "media.status")
            return {
              persistent: true,
              ffmpeg: { available: true },
              transcription: { available: false },
              hyperframes: { available: false },
              tts: { available: true, engine: "macos-say", defaultVoiceId: "tingting" },
            };
          if (method === "media.document.get")
            return structuredClone(documents[args.key] ?? { revision: 0, data: null });
          if (method === "media.document.set") {
            if ((documents[args.key]?.revision ?? 0) !== args.baseRevision)
              throw Error("revision conflict");
            documents[args.key] = {
              revision: args.baseRevision + 1,
              data: structuredClone(args.data),
            };
            return { revision: args.baseRevision + 1 };
          }
          if (method === "media.assets.get")
            return {
              asset: {
                id: speechId,
                name: "已生成的配音.mp3",
                mimeType: "audio/mpeg",
                bytes: 12345,
              },
              preparation: {
                assetId: speechId,
                inspection: { kind: "audio", durationSeconds: 24, audio: { channels: 1 } },
              },
            };
          if (method === "media.jobs.list")
            return { jobs: Object.values(jobs), total: Object.keys(jobs).length };
          if (method === "media.jobs.get") return jobs[args.id];
          if (method === "media.tts.voices") {
            if (++voicesRead === 1) throw Error("读取声音暂时失败，请刷新");
            return {
              available: true,
              engine: "macos-say",
              voices: models[0].voices,
              models,
              defaultModelId: "configured-speech",
            };
          }
          if (method === "media.tts") {
            window.__ttsRequests.push(structuredClone(args));
            const job = {
              id: "job-tts-form",
              type: "tts-online",
              status: "queued",
              attempt: 1,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            jobs[job.id] = job;
            return structuredClone(job);
          }
          throw Error("Unexpected voice form call: " + method);
        },
      };
    },
    { initial, speechId },
  );
  await page.goto(`${url}/?legacyWorkspace=1`);
  await enterLegacyProduction(page);
  await page.locator("#studio .workspace").waitFor();
  await page.waitForFunction(
    () => window.__panelTools.read_video_project().missingAssetIds.length === 0,
  );
  await page.locator('[data-tab="voiceover"]').click();
  await page.locator(".conflict").filter({ hasText: "读取声音暂时失败" }).waitFor();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#voiceover-model").value === "configured-speech",
  );
  assert.equal(await page.locator("#voiceover-voice").inputValue(), "cloud-a");
  assert.match(await page.locator("#voiceover-voice").textContent(), /多语言/);
  await page.setViewportSize({ width: 642, height: 960 });
  const fieldLayout = await page.locator("#voiceover-model").evaluate((select) => ({
    direction: getComputedStyle(select.parentElement).flexDirection,
    field: select.getBoundingClientRect().width,
    label: select.parentElement.getBoundingClientRect().width,
  }));
  assert.equal(fieldLayout.direction, "column");
  assert.ok(
    Math.abs(fieldLayout.field - fieldLayout.label) < 2,
    "Narrow sidebar labels sit above full-width controls",
  );
  await page.screenshot({ path: resolve(screenshots, "voiceover-narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  assert.equal(await page.locator("#voiceover-instructions").count(), 1);
  assert.equal(
    await page.getByRole("button", { name: "生成配音并加入音轨", exact: true }).isDisabled(),
    true,
  );
  const editor = await page.locator("#voiceover-text").elementHandle();
  await page.locator("#voiceover-text").pressSequentially("这是可以继续修改的解说稿。");
  assert.equal(
    await editor.evaluate((element) => element.isConnected && element === document.activeElement),
    true,
    "Typing updates counters without replacing the focused editor",
  );
  assert.match(await page.locator("#voiceover-count").textContent(), /13 \/ 4096/);
  assert.equal(
    await page.getByRole("button", { name: "生成配音并加入音轨", exact: true }).isDisabled(),
    false,
  );
  const draft = await page.locator("#voiceover-text").inputValue();
  await page.getByRole("button", { name: "从字幕填入文案", exact: true }).click();
  assert.match(await page.locator("#voiceover-text").inputValue(), /从想法，到成片/);
  await page.getByRole("button", { name: "撤回导入", exact: true }).click();
  assert.equal(await page.locator("#voiceover-text").inputValue(), draft);
  await page.locator("#voiceover-model").selectOption("macos-say");
  assert.equal(await page.locator("#voiceover-voice").inputValue(), "tingting");
  assert.equal(await page.locator("#voiceover-instructions").count(), 0);
  await page.locator("#voiceover-language").selectOption("en");
  assert.equal(await page.locator("#voiceover-voice").inputValue(), "daniel");
  assert.match(await page.locator("#voiceover-voice").textContent(), /英语 · 英国/);
  await page.locator("#voiceover-model").selectOption("unavailable");
  assert.equal(
    await page.getByRole("button", { name: "生成配音并加入音轨", exact: true }).isDisabled(),
    true,
  );
  assert.match(
    await page.locator(".voiceover-section .host-required").textContent(),
    /连接缺少凭据/,
  );
  await page.locator("#voiceover-model").selectOption("browser-speech");
  assert.equal(
    await page.getByRole("button", { name: "生成配音并加入音轨", exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "浏览器读稿 · 非模型效果", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), [
    { text: draft, voice: "browser-zh", rate: 1 },
  ]);
  assert.match(await page.locator("#voiceover-preview-status").textContent(), /不会生成或保存音轨/);
  await page.getByRole("button", { name: "停止试听", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__cancelledPreviews), 1);
  assert.equal(
    await page.evaluate(() => window.__ttsRequests.length),
    0,
    "Browser preview never submits a generation job",
  );
  await page.locator('[data-tab="media"]').click();
  await page.locator('[data-tab="voiceover"]').click();
  assert.equal(
    await page.locator("#voiceover-text").inputValue(),
    draft,
    "Draft survives switching tabs",
  );
  await page.locator('[data-audio-clip="old-voice-clip"]').click();
  await page
    .getByRole("button", { name: "修改文案 / 重新配音", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(screenshots, "voiceover-track-editing.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "修改文案 / 重新配音", exact: true }).click();
  assert.equal(await page.locator("#voiceover-model").inputValue(), "configured-speech");
  assert.equal(await page.locator("#voiceover-voice").inputValue(), "cloud-a");
  assert.equal(await page.locator("#voiceover-text").inputValue(), "原来的配音文案。");
  assert.equal(await page.locator("#voiceover-instructions").inputValue(), "自然亲切");
  assert.equal(await page.locator("#voiceover-rate").inputValue(), "1.25");
  await page.locator("#voiceover-text").fill("修改后的配音文案。");
  await page.locator("#voiceover-instructions").fill("");
  await page.getByRole("button", { name: "重新生成并替换配音", exact: true }).click();
  await page.waitForFunction(() => window.__ttsRequests.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__ttsRequests[0]), {
    text: "修改后的配音文案。",
    modelId: "configured-speech",
    voiceId: "cloud-a",
    rate: 1.25,
    instructions: "",
  });
  const binding = await page.evaluate(
    () => Object.values(window.__documents["video-studio-production"].data.bindings)[0],
  );
  // The job remembers the exact editor clip, in ticks, rather than an old frame snapshot.
  assert.equal(binding.replaceClip, undefined);
  const { sequenceId, trackId, ...target } = binding.replaceTarget;
  assert.ok(sequenceId && trackId);
  assert.deepEqual(target, {
    clipId: "old-voice-clip",
    assetId: "saved-voice",
    start: 30 * 8000,
    duration: 120 * 8000,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: 120 * 8000, source: 120 * 8000 },
      ],
    },
  });
  assert.equal(
    (await readProject(page)).audioClips.length,
    1,
    "Submitting replacement keeps the original sound until success",
  );
  await page.close();
});

test("local voice cloning validates its own recording, uses real model preview, reloads its recipe and clears references on project change", async () => {
  const setup = await pageWithBridge();
  await demo(setup);
  const initial = await readProject(setup);
  await setup.close();
  const referenceId = "asset-" + "e".repeat(64);
  const speechId = "asset-" + "d".repeat(64);
  const referenceText = "这是我正常说话的声音，今天来试试新的配音。";
  const speech = {
    text: "上次保存的本人声音文案。",
    modelId: "qwen3-tts",
    engine: "qwen3-tts",
    voiceId: "reference",
    referenceAssetId: referenceId,
    referenceText,
    rate: 1,
  };
  initial.assets.push(
    {
      id: "my-reference",
      name: "本人参考录音",
      kind: "audio",
      durationFrames: 360,
      mediaId: referenceId,
      mimeType: "audio/mpeg",
    },
    {
      id: "too-short",
      name: "过短录音",
      kind: "audio",
      durationFrames: 89,
      mediaId: "asset-" + "f".repeat(64),
      mimeType: "audio/mpeg",
    },
    {
      id: "too-long",
      name: "过长录音",
      kind: "audio",
      durationFrames: 901,
      mediaId: "asset-" + "c".repeat(64),
      mimeType: "audio/mpeg",
    },
    {
      id: "saved-clone",
      name: "已保存的本人配音",
      kind: "audio",
      durationFrames: 240,
      mediaId: speechId,
      mimeType: "audio/mpeg",
      speech,
    },
  );
  initial.audioClips = [
    {
      id: "saved-clone-clip",
      assetId: "saved-clone",
      inFrame: 0,
      outFrame: 240,
      startFrame: 0,
      volume: 0.8,
    },
  ];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(installLocalVoiceProcessMock, {
    installed: true,
    outputAssetId: speechId,
    durationSeconds: 8,
  });
  await page.addInitScript(installGenericMediaTaskMock);
  await page.addInitScript(
    ({ initial }) => {
      const documents = JSON.parse(localStorage.getItem("clone-test-documents") || "null") || {
        "video-studio-current": { revision: 1, data: initial },
      };
      const storage = {};
      const jobs = JSON.parse(localStorage.getItem("clone-test-jobs") || "{}");
      window.__panelTools = {};
      window.__ttsRequests = [];
      window.__documents = documents;
      window.codeshellPanel = {
        getContext: async () => ({ cwd: "/test/local-clone" }),
        registerTool: (name, handler) => {
          window.__panelTools[name] = handler;
          return () => {};
        },
        on: () => () => {},
        async call(method, args = {}) {
          if (method === "media.status")
            return {
              persistent: true,
              ffmpeg: { available: true },
              transcription: { available: false },
              hyperframes: { available: false },
              tts: { available: true },
            };
          if (method === "media.document.get")
            return structuredClone(documents[args.key] || { revision: 0, data: null });
          if (method === "media.document.set") {
            assertRevision();
            function assertRevision() {
              if ((documents[args.key]?.revision || 0) !== args.baseRevision)
                throw Error("revision conflict");
            }
            documents[args.key] = {
              revision: args.baseRevision + 1,
              data: structuredClone(args.data),
            };
            localStorage.setItem("clone-test-documents", JSON.stringify(documents));
            return { revision: args.baseRevision + 1 };
          }
          if (method === "storage.get") return storage[args.key] || null;
          if (method === "storage.set") {
            storage[args.key] = structuredClone(args.value);
            return true;
          }
          if (method === "media.assets.get")
            return {
              asset: { id: args.id, name: "本人录音.mp3", mimeType: "audio/mpeg", bytes: 12345 },
              preparation: {
                assetId: args.id,
                inspection: { kind: "audio", durationSeconds: 12, audio: { channels: 1 } },
              },
            };
          if (method === "media.jobs.list")
            return { jobs: Object.values(jobs), total: Object.keys(jobs).length };
          if (method === "media.jobs.get") return jobs[args.id];
          if (method === "media.tts.voices")
            return {
              available: true,
              voices: [],
              defaultModelId: "qwen3-tts",
              models: [
                {
                  id: "qwen3-tts",
                  name: "Qwen3-TTS · 本人声音克隆",
                  provider: "本地 MLX",
                  available: true,
                  mode: "offline",
                  supportsVoiceCloning: true,
                  maxTextLength: 2000,
                  defaultVoiceId: "reference",
                  voices: [{ id: "reference", name: "我的参考录音", language: "und" }],
                },
              ],
            };
          if (method === "media.tts") {
            window.__ttsRequests.push(structuredClone(args));
            const job = {
              id: `job-clone-${Object.keys(jobs).length + 1}`,
              type: "tts-managed",
              status: "queued",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              attempt: 1,
            };
            jobs[job.id] = job;
            localStorage.setItem("clone-test-jobs", JSON.stringify(jobs));
            return structuredClone(job);
          }
          throw Error("Unexpected clone test call: " + method);
        },
      };
    },
    { initial },
  );
  try {
    await page.goto(`${url}/?legacyWorkspace=1`);
    await enterLegacyProduction(page);
    await page.locator("#studio .workspace").waitFor();
    await page.locator('[data-tab="voiceover"]').click();
    await page.waitForFunction(
      () => document.querySelector("#voiceover-model")?.value === "qwen3-tts",
    );
    const sample = page.locator('[data-action="sample-voiceover"]');
    const generate = page.locator('[data-action="create-voiceover"]');
    await page.locator("#voiceover-text").fill("新文案内容。".repeat(30));
    assert.equal(await sample.isDisabled(), true);
    assert.match(await page.locator("#voiceover-reference-status").textContent(), /请选择/);
    for (const id of ["too-short", "too-long"]) {
      await page.locator("#voiceover-reference").selectOption(id);
      await page.locator("#voiceover-reference-text").fill(referenceText);
      assert.equal(await sample.isDisabled(), true);
      assert.match(await page.locator("#voiceover-reference-status").textContent(), /3–30 秒/);
    }
    await page.locator("#voiceover-reference").selectOption("my-reference");
    assert.equal(
      await page.locator("#voiceover-reference-text").inputValue(),
      "",
      "Changing the source cannot retain a different recording's transcript",
    );
    assert.equal(await generate.isDisabled(), true);
    await page.locator("#voiceover-reference-text").fill(referenceText);
    assert.equal(await sample.isDisabled(), false);
    const draftEditor = await page.locator("#voiceover-text").elementHandle();
    const referenceEditor = await page.locator("#voiceover-reference-text").elementHandle();
    await page.locator('[data-action="voiceover-retry"]').click();
    await page.waitForFunction(
      () => !document.querySelector('[data-action="sample-voiceover"]')?.disabled,
    );
    for (const editor of [draftEditor, referenceEditor])
      assert.equal(
        await editor.evaluate(
          (element) => element.isConnected && document.getElementById(element.id) === element,
        ),
        true,
        "Refreshing the model catalog keeps the live text editor connected for input events",
      );
    await page.locator("#voiceover-reference-text").evaluate((element) => {
      element.value = "字".repeat(1001);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(await sample.isDisabled(), true);
    assert.match(await page.locator("#voiceover-reference-status").textContent(), /最多 1000 字/);
    await page.locator("#voiceover-reference-text").fill(referenceText);
    assert.equal(await sample.evaluate((element) => element.classList.contains("primary")), true);
    assert.equal(
      await page.locator('[data-action="preview-voiceover"]').isDisabled(),
      true,
      "Browser speech must not stand in for the cloned voice",
    );
    await page.locator("#voiceover-text").evaluate((element) => {
      element.value = "字".repeat(2001);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(await generate.isDisabled(), true);
    await page.locator("#voiceover-text").fill("新文案内容。".repeat(30));
    await sample.click();
    await page.waitForFunction(
      () =>
        window.__voiceRuntimeRequests.filter((request) => request.action === "generate").length ===
        1,
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
        voiceId: "reference",
        text: "新文案内容。".repeat(30).slice(0, 120),
        modelId: "qwen3-tts",
        rate: 1,
        referenceAssetId: referenceId,
        referenceText,
      },
    );
    const sampleBinding = await page.evaluate(
      () => Object.values(window.__documents["video-studio-production"].data.bindings)[0],
    );
    assert.equal(
      sampleBinding.attachAudio,
      false,
      "Short preview is saved as an asset without adding another voice to the timeline",
    );
    assert.deepEqual((await readProject(page)).audioClips, initial.audioClips);

    await page.reload();
    await enterLegacyProduction(page);
    await page.locator("#studio .workspace").waitFor();
    await page.locator('[data-tab="ai"]').click();
    await page.locator('[data-audio-clip="saved-clone-clip"]').click();
    await page.getByRole("button", { name: "修改文案 / 重新配音", exact: true }).click();
    assert.equal(await page.locator("#voiceover-reference").inputValue(), "my-reference");
    assert.equal(await page.locator("#voiceover-reference-text").inputValue(), referenceText);
    assert.equal(await page.locator("#voiceover-text").inputValue(), speech.text);
    await page.setViewportSize({ width: 642, height: 1100 });
    await page.screenshot({
      path: resolve(screenshots, "voice-cloning-narrow.png"),
      fullPage: true,
    });
    await page.locator('[data-action="sample-voiceover"]').scrollIntoViewIfNeeded();
    const previewControlsFit = await page.locator(".voiceover-preview-actions").evaluate((row) => {
      const bounds = row.getBoundingClientRect();
      return [...row.querySelectorAll("button")].every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
      });
    });
    assert.equal(previewControlsFit, true, "Browser preview controls remain inside a narrow panel");
    await page.screenshot({
      path: resolve(screenshots, "voice-cloning-preview.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole("button", { name: "重新生成并替换配音", exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__voiceRuntimeRequests.filter((request) => request.action === "generate").length ===
        1,
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
        voiceId: "reference",
        text: speech.text,
        modelId: "qwen3-tts",
        rate: 1,
        referenceAssetId: referenceId,
        referenceText,
      },
    );
    const replacementBinding = await page.evaluate(() =>
      Object.values(window.__documents["video-studio-production"].data.bindings).find(
        (binding) => binding.replaceTarget,
      ),
    );
    assert.equal(replacementBinding.attachAudio, true);
    assert.equal(replacementBinding.replaceClip, undefined);
    assert.equal(replacementBinding.replaceTarget.clipId, "saved-clone-clip");
    assert.equal(replacementBinding.replaceTarget.assetId, "saved-clone");
    assert.equal(replacementBinding.replaceTarget.duration, 240 * 8000);
    await page.locator('[data-action="new"]').click();
    // The voice job is still running, so the page asks before switching projects.
    const confirmNew = page.locator("#plan-dialog[open]");
    assert.match(await confirmNew.textContent(), /制作任务/);
    await confirmNew.getByRole("button", { name: "仍然新建", exact: true }).click();
    await page.waitForFunction(
      (oldId) => window.__panelTools.read_video_project().project.id !== oldId,
      initial.id,
    );
    await page.locator('[data-tab="voiceover"]').click();
    assert.equal(await page.locator("#voiceover-reference").inputValue(), "");
    assert.equal(await page.locator("#voiceover-reference-text").inputValue(), "");
    assert.equal(await page.locator('[data-action="sample-voiceover"]').isDisabled(), true);
    assert.equal(
      await page.evaluate(
        () =>
          window.__voiceRuntimeRequests.filter((request) => request.action === "generate").length,
      ),
      1,
      "Switching projects must never reuse the other project's voice reference",
    );
  } finally {
    await page.close();
  }
});

test("fine timeline editing splits the selected audio at the playhead and restores it with one undo", async () => {
  const page = await pageWithBridge(true);
  try {
    await demo(page);
    const original = await readProject(page);
    const audio = original.audioClips[0];
    await page.locator(`[data-audio-clip="${audio.id}"]`).click({ position: { x: 60, y: 12 } });
    assert.equal(
      await page.evaluate(() => window.__panelTools.read_video_project().selectedClipId),
      audio.id,
    );
    assert.equal(await page.locator('[data-action="split"]').isDisabled(), true);
    await page.keyboard.press("Shift+ArrowRight");
    await page.waitForFunction(
      () => window.__panelTools.read_video_project().playheadFrame === 150,
    );
    assert.equal(await page.locator('[data-action="split"]').isDisabled(), false);
    await page.keyboard.press("s");
    await saved(page);
    const edited = await readProject(page);
    assert.equal(edited.revision, original.revision + 1);
    assert.deepEqual(
      edited.clips,
      original.clips,
      "S on an audio selection does not split the video",
    );
    assert.deepEqual(edited.captions, original.captions);
    assert.equal(edited.audioClips.length, 2);
    assert.deepEqual(
      edited.audioClips.map(({ startFrame, inFrame, outFrame, volume, assetId }) => ({
        startFrame,
        inFrame,
        outFrame,
        volume,
        assetId,
      })),
      [
        { startFrame: 0, inFrame: 0, outFrame: 150, volume: audio.volume, assetId: audio.assetId },
        {
          startFrame: 150,
          inFrame: 150,
          outFrame: 720,
          volume: audio.volume,
          assetId: audio.assetId,
        },
      ],
    );
    await page.locator('[data-action="undo"]').click();
    await saved(page);
    const restored = await readProject(page);
    assert.equal(restored.revision, edited.revision + 1);
    assert.deepEqual(restored.audioClips, original.audioClips);
    assert.deepEqual(restored.clips, original.clips);
    assert.deepEqual(restored.captions, original.captions);
  } finally {
    await page.close();
  }
});

test("fine timeline editing moves and trims audio as single undo steps and Escape cancels delayed release", async () => {
  const page = await pageWithBridge(true);
  try {
    await demo(page);
    const audioId = (await readProject(page)).audioClips[0].id;
    const audio = () => page.locator(`[data-audio-clip="${audioId}"]`);
    await audio().click({ position: { x: 60, y: 12 } });
    await page.locator("#trim-in").fill("2");
    await page.locator("#trim-out").fill("10");
    await page.getByRole("button", { name: "应用裁剪", exact: true }).click();
    await saved(page);
    await page.locator('[data-action="toggle-snapping"]').click();
    assert.equal(
      await page.locator('[data-action="toggle-snapping"]').getAttribute("aria-pressed"),
      "false",
    );
    const prepared = await readProject(page);

    const startDrag = async (locator, deltaFrames) => {
      await locator.scrollIntoViewIfNeeded();
      const bounds = await locator.boundingBox();
      assert.ok(bounds);
      const zoom = Number(await page.locator("#timeline-zoom").inputValue());
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + (deltaFrames / 30) * zoom, y, { steps: 5 });
    };
    const drag = async (locator, deltaFrames) => {
      const before = await readProject(page);
      await startDrag(locator, deltaFrames);
      assert.deepEqual(
        await readProject(page),
        before,
        "Pointer moves only preview the pending edit",
      );
      assert.equal(await page.locator(".timeline-drag-guide:visible").count(), 1);
      await page.mouse.up();
      await saved(page);
      const after = await readProject(page);
      assert.equal(after.revision, before.revision + 1, "A completed drag creates one revision");
      assert.deepEqual(after.clips, before.clips);
      assert.deepEqual(after.captions, before.captions);
      return after;
    };
    const undoAndRedo = async (before, after) => {
      await page.locator('[data-action="undo"]').click();
      await saved(page);
      assert.deepEqual(
        (await readProject(page)).audioClips,
        before.audioClips,
        "One undo restores the whole drag",
      );
      await page.locator('[data-action="redo"]').click();
      await saved(page);
      assert.deepEqual((await readProject(page)).audioClips, after.audioClips);
    };

    const moved = await drag(audio(), 90);
    assert.deepEqual(moved.audioClips, [{ ...prepared.audioClips[0], startFrame: 90 }]);
    await undoAndRedo(prepared, moved);

    const beforeIn = await readProject(page);
    const trimmedIn = await drag(audio().locator('[data-trim="in"]'), 30);
    assert.deepEqual(trimmedIn.audioClips, [
      { ...beforeIn.audioClips[0], startFrame: 120, inFrame: 90 },
    ]);
    await undoAndRedo(beforeIn, trimmedIn);

    const beforeOut = await readProject(page);
    const trimmedOut = await drag(audio().locator('[data-trim="out"]'), -30);
    assert.deepEqual(trimmedOut.audioClips, [{ ...beforeOut.audioClips[0], outFrame: 270 }]);
    await undoAndRedo(beforeOut, trimmedOut);

    // Keep a video selected and place the playhead away from the audio start before cancelling.
    // Find and click in one page task so a background render cannot detach the clip in between.
    await page.locator(`[data-clip="${prepared.clips[0].id}"]`).waitFor({ state: "attached" });
    await page.evaluate(
      (id) => document.querySelector(`[data-clip="${CSS.escape(id)}"]`).click(),
      prepared.clips[0].id,
    );
    await page.keyboard.press("Shift+ArrowRight");
    await page.waitForFunction(
      () => window.__panelTools.read_video_project().playheadFrame === 150,
    );
    const beforeCancel = await page.evaluate(() => window.__panelTools.read_video_project());
    await startDrag(audio(), 60);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".timeline-drag-guide").count(), 0);
    await page.waitForTimeout(50);
    await page.mouse.up();
    const afterCancel = await page.evaluate(() => window.__panelTools.read_video_project());
    assert.deepEqual(afterCancel.project, beforeCancel.project);
    assert.equal(afterCancel.playheadFrame, beforeCancel.playheadFrame);
    assert.equal(afterCancel.selectedClipId, beforeCancel.selectedClipId);
    assert.equal(await page.locator(".dragging").count(), 0);
  } finally {
    await page.close();
  }
});

test("fine timeline editing keeps zoom anchored and updates split availability during keyboard navigation", async () => {
  const page = await pageWithBridge(true);
  try {
    await demo(page);
    const original = await readProject(page);
    const go = async (key, expected) => {
      await page.keyboard.press(key);
      await page.waitForFunction(
        (frame) => window.__panelTools.read_video_project().playheadFrame === frame,
        expected,
      );
    };
    const split = page.locator('[data-action="split"]');
    await go("Home", 0);
    assert.equal(await split.isDisabled(), true);
    await go("ArrowRight", 1);
    assert.equal(await split.isDisabled(), false);
    await go("Shift+ArrowRight", 151);
    await go("Shift+ArrowLeft", 1);
    await go("End", 719);
    await go("Home", 0);
    await go("ArrowDown", 180);
    assert.equal(await split.isDisabled(), true);
    await go("ArrowDown", 480);
    assert.equal(await split.isDisabled(), true);
    await go("ArrowUp", 180);
    await go("ArrowLeft", 179);
    assert.equal(await split.isDisabled(), false);

    const anchor = () =>
      page.evaluate(() => {
        const scroll = document.querySelector("#timeline-scroll");
        return (
          document.querySelector("#playhead").getBoundingClientRect().left -
          scroll.getBoundingClientRect().left
        );
      });
    const before = await anchor();
    await page.locator("#timeline-zoom").evaluate((input) => {
      input.value = "240";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.ok(
      Math.abs((await anchor()) - before) <= 1,
      "Zoom retains the playhead's screen position",
    );
    assert.equal(
      await page.evaluate(() => window.__panelTools.read_video_project().playheadFrame),
      179,
    );
    assert.equal(await split.isDisabled(), false);
    assert.match(await page.locator("#ruler").textContent(), /\d{2}:\d{2}:\d{2}/);
    await go("ArrowRight", 180);
    assert.equal(
      await split.isDisabled(),
      true,
      "Seeking updates the split button without a full render",
    );
    await go("ArrowRight", 181);
    assert.equal(await split.isDisabled(), false);
    const beforeContextClick = await page.evaluate(() => window.__panelTools.read_video_project());
    const scrollBounds = await page.locator("#timeline-scroll").boundingBox();
    assert.ok(scrollBounds);
    await page.mouse.click(scrollBounds.x + scrollBounds.width * 0.75, scrollBounds.y + 15, {
      button: "right",
    });
    const afterContextClick = await page.evaluate(() => window.__panelTools.read_video_project());
    assert.equal(
      afterContextClick.playheadFrame,
      beforeContextClick.playheadFrame,
      "Right-clicking the ruler must not seek",
    );
    assert.equal(afterContextClick.selectedClipId, beforeContextClick.selectedClipId);
    assert.deepEqual(
      await readProject(page),
      original,
      "Navigation and zoom never edit the project",
    );
    await page.screenshot({
      path: resolve(screenshots, "timeline-fine-editing.png"),
      fullPage: true,
    });
  } finally {
    await page.close();
  }
});

test("fine timeline editing fits an hour-long project and limits ruler labels while scrolling at full zoom", async () => {
  const page = await pageWithBridge(true);
  try {
    await demo(page);
    const project = await readProject(page);
    project.id = "fine-timeline-long-project";
    project.name = "一小时长片缩放测试";
    project.assets[0].durationFrames = 30 * 3600;
    project.clips = [{ ...project.clips[0], outFrame: 30 * 3600 }];
    await page.locator("#project-input").setInputFiles({
      name: "long-project.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.waitForFunction(
      (id) => window.__panelTools.read_video_project().project.id === id,
      project.id,
    );
    await saved(page);
    // Saving finishes before original-media recovery; the input clears only after replacement completes.
    await page.waitForFunction(() => document.querySelector("#project-input").value === "");
    const imported = await readProject(page);
    await page.locator('[data-action="fit-timeline"]').click();
    const fitted = await page.locator("#timeline-scroll").evaluate((scroll) => ({
      width: scroll.clientWidth,
      left: scroll.scrollLeft,
      zoom: Number(document.querySelector("#timeline-zoom").value),
      labels: document.querySelectorAll("#ruler > span").length,
    }));
    assert.ok(fitted.zoom < 12);
    assert.ok(3600 * fitted.zoom + 40 <= fitted.width + 1);
    assert.equal(fitted.left, 0);
    assert.ok(fitted.labels > 0 && fitted.labels < 100);

    await page.locator("#timeline-zoom").evaluate((input) => {
      input.value = "240";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(
      () =>
        Number(document.querySelector("#timeline-zoom").value) === 240 &&
        document.querySelector("#timeline-scroll").scrollWidth > 800000,
    );
    await page.locator("#timeline-scroll").evaluate((scroll) => {
      scroll.scrollLeft = scroll.scrollWidth - scroll.clientWidth;
      scroll.dispatchEvent(new Event("scroll"));
    });
    const ruler = await page.locator("#timeline-scroll").evaluate((scroll) => ({
      left: scroll.scrollLeft,
      width: scroll.clientWidth,
      positions: [...document.querySelectorAll("#ruler > span")].map((label) =>
        parseFloat(label.style.left),
      ),
    }));
    assert.ok(
      ruler.left > 800000,
      `Full-zoom ruler should reach the hour-long sequence end: ${JSON.stringify(ruler)}`,
    );
    assert.ok(ruler.positions.length > 0 && ruler.positions.length < 100);
    assert.ok(
      ruler.positions.every(
        (position) => position >= ruler.left - 8 && position <= ruler.left + ruler.width + 8,
      ),
    );
    await page.locator('[data-action="fit-timeline"]').click();
    assert.equal(await page.locator("#timeline-scroll").evaluate((scroll) => scroll.scrollLeft), 0);
    assert.deepEqual(await readProject(page), imported);
  } finally {
    await page.close();
  }
});

test("fine timeline editing extends a trimmed source left of timeline zero and restores it with one undo", async () => {
  const page = await pageWithBridge(true);
  try {
    await demo(page);
    const firstClip = (await readProject(page)).clips[0];
    await page.locator(`[data-clip="${firstClip.id}"]`).click();
    await page.locator("#trim-in").fill("2");
    await page.locator("#trim-out").fill("6");
    await page.getByRole("button", { name: "应用裁剪", exact: true }).click();
    await saved(page);
    await page.locator('[data-action="toggle-snapping"]').click();
    const before = await readProject(page);
    const clip = before.clips[0];
    assert.equal(clip.inFrame, 60);
    const handle = page.locator(`[data-clip="${clip.id}"] [data-trim="in"]`);
    await handle.scrollIntoViewIfNeeded();
    const bounds = await handle.boundingBox();
    assert.ok(bounds);
    const zoom = Number(await page.locator("#timeline-zoom").inputValue());
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - zoom, y, { steps: 5 });
    assert.deepEqual(await readProject(page), before);
    await page.mouse.up();
    await saved(page);
    const after = await readProject(page);
    assert.equal(after.revision, before.revision + 1);
    assert.deepEqual(after.clips[0], { ...clip, inFrame: 30 });
    assert.deepEqual(after.clips.slice(1), before.clips.slice(1));
    await page.locator('[data-action="undo"]').click();
    await saved(page);
    const restored = await readProject(page);
    assert.deepEqual(restored.clips, before.clips);
    assert.deepEqual(restored.audioClips, before.audioClips);
    assert.deepEqual(restored.captions, before.captions);
  } finally {
    await page.close();
  }
});

async function freeTimelineDemo(page) {
  await demo(page);
  await page.locator('[data-action="toggle-magnetic"]').click();
  await saved(page);
  await page.locator("#timeline-zoom").evaluate((input) => {
    input.value = "8";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator('[data-action="toggle-snapping"]').click();
}

async function beginFreeVideoDrag(page, id, deltaFrames) {
  const clip = page.locator(`[data-clip="${id}"]`);
  await clip.scrollIntoViewIfNeeded();
  const bounds = await clip.boundingBox();
  assert.ok(bounds);
  const zoom = Number(await page.locator("#timeline-zoom").inputValue());
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + 22;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (deltaFrames / 30) * zoom, y, { steps: 5 });
}

test("free timeline dragging keeps gaps, rejects collisions, cancels safely and saves one undo step", async () => {
  const page = await pageWithBridge(true);
  try {
    await freeTimelineDemo(page);
    const original = await readProject(page);
    const last = original.clips.at(-1);
    assert.equal(original.timelineMode, "free");
    assert.equal(await page.locator(`[data-clip="${last.id}"]`).getAttribute("draggable"), "false");
    await beginFreeVideoDrag(page, last.id, 90);
    await page.keyboard.press("n");
    assert.equal(
      await page.locator(".timeline-drag-guide").count(),
      1,
      "An ordinary UI refresh cannot cancel an active drag",
    );
    await page.keyboard.press("n");
    assert.deepEqual(
      await readProject(page),
      original,
      "Dragging previews geometry before committing",
    );
    await page.mouse.up();
    await saved(page);
    const moved = await readProject(page);
    assert.equal(moved.revision, original.revision + 1);
    assert.equal(moved.clips.at(-1).startFrame, last.startFrame + 90);
    assert.deepEqual(moved.clips.slice(0, -1), original.clips.slice(0, -1));
    assert.deepEqual(moved.audioClips, original.audioClips);
    assert.match(await page.locator(".timeline-hint").textContent(), /允许留空/);
    await page
      .locator("#ruler")
      .click({ position: { x: ((last.startFrame + 45) / 30) * 8, y: 12 } });
    await page.waitForFunction(
      (frame) => window.__panelTools.read_video_project().playheadFrame === frame,
      last.startFrame + 45,
    );
    const black = await page
      .locator("#preview:visible, [data-ew-canvas]:visible")
      .evaluate((canvas) => [...canvas.getContext("2d").getImageData(5, 5, 1, 1).data]);
    assert.deepEqual(black, [0, 0, 0, 255]);

    await beginFreeVideoDrag(page, last.id, -last.startFrame - 90);
    assert.equal(await page.locator(".drag-invalid").count(), 1);
    await page.mouse.up();
    assert.deepEqual(
      await readProject(page),
      moved,
      "An overlapping drop cannot overwrite another clip",
    );
    await beginFreeVideoDrag(page, last.id, 90);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(30);
    await page.mouse.up();
    assert.equal(await page.locator(".timeline-drag-guide").count(), 0);
    assert.deepEqual(await readProject(page), moved);
    await page.locator('[data-action="undo"]').click();
    await saved(page);
    const undone = await readProject(page);
    assert.deepEqual(undone.clips, original.clips);
    assert.deepEqual(undone.audioClips, original.audioClips);
    assert.deepEqual(undone.captions, original.captions);
  } finally {
    await page.close();
  }
});

test("free timeline positions survive reload, accept asset drops at the cursor, and compact reversibly", async () => {
  const page = await pageWithBridge();
  try {
    await freeTimelineDemo(page);
    const original = await readProject(page);
    const last = original.clips.at(-1);
    await page.locator(`[data-clip="${last.id}"]`).click({ position: { x: 20, y: 22 } });
    await page.locator("#video-start").fill("30");
    await page.locator("#video-start").press("Tab");
    await saved(page);
    const positioned = await readProject(page);
    assert.equal(positioned.clips.at(-1).startFrame, 900);
    await page.reload();
    await enterLegacyProduction(page);
    await page.locator("#revision").waitFor();
    assert.equal((await readSavedLegacyProject(page)).timelineMode, "free");
    assert.deepEqual((await readProject(page)).clips, positioned.clips);
    const canonical = await readSavedEditorDocument(page);
    const sequence = canonical.sequences.find((item) => item.id === canonical.activeSequenceId);
    const trackId = sequence.clips.find((clip) => clip.id === original.clips[0].id).trackId;
    await page.locator("[data-et-zoom]").evaluate((input) => {
      input.value = "1";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page
      .locator(`[data-asset="${original.clips[0].assetId}"]`)
      .dragTo(page.locator(`[data-et-lane="${trackId}"]`), { targetPosition: { x: 400, y: 25 } });
    await saved(page);
    const dropped = await readProject(page);
    assert.equal(dropped.clips.length, positioned.clips.length + 1);
    assert.equal(
      dropped.clips.at(-1).startFrame,
      1200,
      "A library drop uses its actual timeline position",
    );
    assert.deepEqual(dropped.clips.slice(0, -1), positioned.clips);
    await page.locator(".editor-timing summary").filter({ hasText: "时间线排列" }).click();
    await page.getByLabel("排列方式", { exact: true }).selectOption("magnetic");
    await saved(page);
    const compacted = await readSavedEditorDocument(page);
    const compactedSequence = compacted.sequences.find(
      (item) => item.id === compacted.activeSequenceId,
    );
    assert.equal(compactedSequence.timelineMode, "magnetic");
    let end = 0;
    for (const clip of compactedSequence.clips
      .filter((item) => item.trackId === trackId)
      .sort((a, b) => a.start - b.start)) {
      assert.equal(clip.start, end, "Compaction removes every gap on the selected picture track");
      end += clip.duration;
    }
    await page.locator('[data-ew-action="undo"]').click();
    await saved(page);
    const undone = await readProject(page);
    assert.equal(undone.timelineMode, "free");
    assert.deepEqual(undone.clips, dropped.clips);
    await page.locator(".et-scroll").evaluate((scroll) => {
      scroll.scrollLeft = 0;
    });
    await page.screenshot({ path: resolve(screenshots, "free-timeline-gaps.png") });
  } finally {
    await page.close();
  }
});
