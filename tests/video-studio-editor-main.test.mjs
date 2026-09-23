import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";
import { installGenericMediaTaskMock } from "./helpers/video-studio-generic-task.mjs";

const seed = {
  schemaVersion: 1,
  id: "editor-main-project",
  name: "旧工程迁移测试",
  revision: 7,
  width: 640,
  height: 360,
  fps: 30,
  timelineMode: "free",
  script: "保留原始文稿。",
  assets: [
    { id: "demo", name: "示例画面", kind: "demo", durationFrames: 300, width: 640, height: 360 },
  ],
  clips: [{ id: "picture", assetId: "demo", inFrame: 0, outFrame: 300, startFrame: 0, volume: 1 }],
  captions: [{ id: "caption", text: "原始字幕", startFrame: 0, endFrame: 60 }],
};
let browser, server, url, directory;
before(async () => {
  const [project] = selectProjects(await discoverProjects(), "video-studio");
  directory = await mkdtemp(resolve(tmpdir(), "video-editor-main-"));
  const isolatedOutput = resolve(directory, "package");
  await buildProject({ ...project, output: isolatedOutput }, { log: false });
  const output = resolve(isolatedOutput, "app");
  server = createServer(async (request, response) => {
    const path = resolve(
      output,
      "." + new URL(request.url, "http://localhost").pathname.replace(/\/$/, "/index.html"),
    );
    if (!path.startsWith(output + sep)) return response.writeHead(403).end();
    try {
      const bytes = await readFile(path);
      response.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".mjs": "text/javascript",
            ".css": "text/css",
            ".mp3": "audio/mpeg",
          }[extname(path)] ?? "application/octet-stream",
      });
      response.end(bytes);
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
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function openPage(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  const page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.fixtureMediaRequests = [];
  if (options.mediaResources)
    await page.route("**/media/*", async (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      const media = options.mediaResources[id];
      if (!media) return route.fulfill({ status: 404 });
      page.fixtureMediaRequests.push(id);
      return route.fulfill({ status: 200, contentType: media.mimeType, body: media.bytes });
    });
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  // Voiceover jobs run through the real tasks/resources contract of the media task bridge.
  if (options.voiceover || options.automatic)
    await page.addInitScript(installGenericMediaTaskMock);
  await page.addInitScript(
    ({ seed, options }) => {
      const records = JSON.parse(localStorage.getItem("editor-main-host") ?? "null") ?? {
        "video-studio-current": [{ revision: 1, updatedAt: 1, label: "原始 V1", data: seed }],
        ...options.records,
      };
      const preferences = JSON.parse(localStorage.getItem("editor-main-preferences") ?? "{}");
      let failCurrent = false;
      const calls = [],
        attempted = [],
        tools = {},
        events = {};
      const persist = () => {
        localStorage.setItem("editor-main-host", JSON.stringify(records));
        localStorage.setItem("editor-main-preferences", JSON.stringify(preferences));
      };
      persist();
      window.__mainHost = {
        calls,
        attempted,
        tools,
        events,
        current: () => {
          const value = records["video-studio-current"][0].data;
          return structuredClone(
            value.format === "video-studio-packed-document" ? value.data : value,
          );
        },
        records: () => structuredClone(records),
        fail: (value) => {
          failCurrent = value;
        },
        latestStorageRevision: () => records["video-studio-current"][0].revision,
      };
      window.codeshellPanel = {
        getContext: async () => ({
          cwd: "/isolated/editor-main",
          theme: "dark",
          visible: true,
          capabilities: {
            bridge: {
              maxCallsPerWindow: 10000,
              maxTransferCallsPerWindow: 10000,
              rateWindowMs: 1000,
            },
          },
          availableMethods: [
            "storage.get",
            "storage.set",
            "media.document.get",
            "media.document.set",
            "media.document.versions",
            ...(options.nativeTasks
              ? ["tasks.start", "tasks.get", "tasks.list", "tasks.cancel", "resources.get"]
              : []),
            ...(options.fullNativeAccess
              ? [
                  "tasks.start",
                  "tasks.get",
                  "tasks.list",
                  "tasks.cancel",
                  "tasks.retry",
                  "resources.get",
                  "resources.read",
                  "resources.list",
                  "process.find",
                  "process.resolveEntry",
                  "process.spawn",
                  "process.cancel",
                  "filesystem.getKnownDirectory",
                ]
              : []),
            ...(options.translation
              ? ["agent.task.start", "agent.task.get", "agent.task.cancel"]
              : []),
          ],
        }),
        registerTool: (name, handler) => {
          tools[name] = handler;
          return () => {
            delete tools[name];
          };
        },
        on: (name, handler) => {
          (events[name] ??= []).push(handler);
          return () => {};
        },
        call: async (method, args = {}) => {
          calls.push({ method, args: structuredClone(args) });
          if (method === "tasks.list" && (options.nativeTasks || options.fullNativeAccess))
            return [];
          if (method === "tasks.start" && options.holdNativeStart)
            return new Promise(() => {});
          if (method === "media.jobs.list" && options.fullNativeAccess) return { jobs: [] };
          if (method === "resources.get" && options.fullNativeAccess)
            return { asset: structuredClone(options.mediaMetadata[args.id ?? args.assetId]) };
          if (method === "agent.task.start" && options.translation) {
            const rows = JSON.parse(args.prompt.split("Subtitle data: ")[1]);
            return {
              id: "caption-translation-main",
              status: "completed",
              result: {
                text: JSON.stringify(
                  rows.map((row) => ({ id: row.id, text: `Translation: ${row.text}` })),
                ),
              },
            };
          }
          if (options.automatic) {
            // A persistent media service and an agent task host; the agent itself is the test.
            const auto = (window.__autoHost ??= { starts: [] });
            if (method === "media.status")
              return {
                persistent: true,
                ffmpeg: { available: true },
                transcription: { available: false },
                hyperframes: { available: false },
                tts: { available: false },
              };
            if (method === "media.jobs.list") return { jobs: [], total: 0 };
            if (method === "agent.task.start") {
              auto.starts.push(structuredClone(args));
              return { id: `auto-task-${auto.starts.length}`, status: "running" };
            }
            if (method === "agent.task.get") return { id: args.id, status: "running" };
            if (method === "agent.task.cancel") return { id: args.id, status: "cancelled" };
          }
          if (options.voiceover) {
            const voice = (window.__voiceHost ??= { jobs: {}, requests: [] });
            if (method === "media.status")
              return {
                persistent: true,
                ffmpeg: { available: true },
                transcription: { available: false },
                hyperframes: { available: false },
                tts: { available: true, engine: "macos-say", defaultVoiceId: "tingting" },
              };
            if (method === "media.tts.voices")
              return {
                available: true,
                engine: "macos-say",
                defaultModelId: "macos-say",
                voices: [{ id: "tingting", name: "Tingting", language: "zh_CN" }],
                models: [
                  {
                    id: "macos-say",
                    name: "macOS 系统配音",
                    provider: "Apple",
                    available: true,
                    voices: [{ id: "tingting", name: "Tingting", language: "zh_CN" }],
                    defaultVoiceId: "tingting",
                  },
                ],
              };
            if (method === "media.tts") {
              voice.requests.push(structuredClone(args));
              const job = {
                id: "job-voice-replace",
                type: "tts",
                status: "queued",
                attempt: 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              voice.jobs[job.id] = job;
              return structuredClone(job);
            }
            if (method === "media.jobs.list")
              return { jobs: Object.values(voice.jobs), total: Object.keys(voice.jobs).length };
            if (method === "media.jobs.get") return structuredClone(voice.jobs[args.id]);
            if (method === "media.assets.get" && options.voiceover.assets?.[args.id])
              return { asset: structuredClone(options.voiceover.assets[args.id]) };
          }
          if (method === "storage.get") return structuredClone(preferences[args.key] ?? null);
          if (method === "storage.set") {
            preferences[args.key] = structuredClone(args.value);
            persist();
            return true;
          }
          if (method === "media.document.get") {
            if (options.failRead && args.key === "video-studio-current")
              throw Error("工程读取暂时失败");
            const found =
              args.revision === undefined
                ? records[args.key]?.[0]
                : records[args.key]?.find((value) => value.revision === args.revision);
            if (!found && args.revision !== undefined) throw Error("历史版本不存在");
            return structuredClone(found ?? { revision: 0, data: null });
          }
          if (method === "media.document.versions")
            return structuredClone(
              (records[args.key] ?? []).map(({ data, ...version }) => version),
            );
          if (method === "media.document.set") {
            attempted.push(structuredClone(args));
            if (failCurrent && args.key === "video-studio-current") throw Error("模拟磁盘保存失败");
            if ((records[args.key]?.[0].revision ?? 0) !== args.baseRevision)
              throw Error("Media document changed in another window");
            const receipt = {
              revision: args.baseRevision + 1,
              updatedAt: Date.now(),
              label: args.label,
            };
            records[args.key] = [
              { ...receipt, data: structuredClone(args.data) },
              ...(records[args.key] ?? []),
            ].slice(0, 20);
            persist();
            return receipt;
          }
          throw Error(`Host fixture does not implement ${method}`);
        },
      };
    },
    {
      seed: options.missingAudio
        ? {
            ...seed,
            assets: [
              ...seed.assets,
              { id: "missing-audio", name: "离线原声.wav", kind: "audio", durationFrames: 300 },
            ],
          }
        : (options.seed ?? seed),
      options: { ...options, mediaResources: undefined },
    },
  );
  await page.goto(url);
  if (!options.failRead) {
    await page
      .locator("#editor-workspace")
      .waitFor({ state: "visible" })
      .catch(async (error) => {
        throw new Error(
          `${error.message}\n${(await page.locator("body").innerText()).slice(0, 8000)}`,
        );
      });
    await page.waitForFunction(() => window.__mainHost.tools.read_video_project);
    await waitSaved(page);
    await settle(page);
  }
  return page;
}
const action = (page, name) => page.locator(`#editor-workspace [data-ew-action="${name}"]`);
async function clickEditorAction(page, name) {
  const control = action(page, name);
  if (!(await control.isVisible()))
    await control.locator("xpath=ancestor::details[1]").locator("summary").click();
  await control.click();
}
const oldAction = (page, name) => page.locator(`#studio [data-action="${name}"]`);
const settle = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const saved = (page) => page.evaluate(() => window.__mainHost.current());
async function waitSaved(page) {
  await page.waitForFunction(
    () =>
      document.querySelector("[data-ew-save]")?.textContent === "已保存" &&
      window.__mainHost.current().schemaVersion === 2,
  );
  return saved(page);
}
async function property(page, label, value) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(String(value));
  await field.press("Tab");
  return waitSaved(page);
}
async function production(page, tab = "ai") {
  await page.locator(`#studio .rail [data-tab="${tab}"]`).click();
  await page.locator("#studio").waitFor({ state: "visible" });
}
async function returnEditor(page) {
  await page.locator('#studio .rail [data-tab="media"]').click();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
}
const shapeFrom = (doc) =>
  doc.sequences.flatMap((sequence) => sequence.clips).find((clip) => clip.kind === "shape");

// Real built main, EditorSession, legacy adapter, IndexedDB-capable browser and media document CAS.
// The Host is a storage boundary fixture; no native engine or model is executed here.
test("main retains the original studio shell and material actions add canonical layers through the existing topbar", async (t) => {
  const page = await openPage(t, { nativeTasks: true });
  for (const selector of [
    "#studio .topbar",
    "#studio .rail",
    "#studio .library-panel",
    "#studio .workspace > #editor-workspace",
    "#editor-workspace .ew-tools",
    "#editor-workspace .ew-viewer",
    "#editor-workspace .ew-properties",
    "#editor-workspace [data-ew-timeline]",
  ])
    assert.equal(await page.locator(selector).isVisible(), true, `${selector} remains visible`);
  assert.deepEqual(await page.locator("#studio .rail [data-tab]").allTextContents(), [
    "素材",
    "粗剪",
    "录制",
    "口播",
    "字幕",
    "配音",
    "AI 制作",
    "任务",
  ]);
  assert.equal(await page.locator("#editor-workspace .ew-header").isVisible(), false);
  assert.equal(await page.locator("#editor-workspace .ew-library").isVisible(), false);
  assert.equal(await page.locator('[data-ew-action="production"]:visible').count(), 0);
  assert.equal(
    await page.locator("#studio .workspace").evaluate((node) => getComputedStyle(node).display),
    "grid",
  );
  assert.equal(
    await page.locator("#studio .topbar").evaluate((node) => getComputedStyle(node).display),
    "flex",
  );

  await page.locator("#project-name").fill("原工作台里的完整多轨工程");
  await page.locator("#project-name").press("Tab");
  const before = await waitSaved(page);
  assert.equal(before.name, "原工作台里的完整多轨工程");
  const sequenceBefore = before.sequences.find(
    (sequence) => sequence.id === before.activeSequenceId,
  );
  const originalIds = new Set(sequenceBefore.clips.map((clip) => clip.id));
  await page.locator('[data-add-asset="demo"]').click();
  const first = await waitSaved(page);
  await page.locator('[data-add-asset="demo"]').click();
  const second = await waitSaved(page);
  const sequence = second.sequences.find((sequence) => sequence.id === second.activeSequenceId);
  const inserted = sequence.clips.filter((clip) => !originalIds.has(clip.id));
  assert.equal(first.revision, before.revision + 1);
  assert.equal(second.revision, first.revision + 1);
  assert.equal(inserted.length, 2);
  assert.ok(
    inserted.every((clip) => clip.kind === "media" && clip.assetId === "demo" && clip.start === 0),
  );
  assert.equal(
    new Set(inserted.map((clip) => clip.trackId)).size,
    2,
    "Repeated material + creates overlapping layers in independent tracks",
  );
  assert.ok(
    inserted.every(
      (clip) => clip.trackId !== sequenceBefore.clips.find((clip) => clip.id === "picture").trackId,
    ),
  );
  for (const original of sequenceBefore.clips)
    assert.deepEqual(
      sequence.clips.find((clip) => clip.id === original.id),
      original,
    );
  assert.equal(
    await page.locator(`[data-et-clip="${inserted[1].id}"]`).getAttribute("aria-selected"),
    "true",
  );

  await oldAction(page, "export").click();
  const dialog = page.locator("#editor-workspace .ew-dialog[open]");
  await dialog.waitFor({ state: "visible" });
  assert.equal(await dialog.locator("h2").textContent(), "导出视频");
  assert.equal(
    await dialog.locator(`input[name="sequences"][value="${sequence.id}"]`).isChecked(),
    true,
  );
  await dialog.locator("[data-ew-close]").click();
  assert.deepEqual(
    await saved(page),
    second,
    "Opening canonical export from the original topbar does not edit the project",
  );
});

test("export history stays in the topbar across page changes and never covers the timeline at startup", async (t) => {
  const page = await openPage(t, { nativeTasks: true });
  const before = await waitSaved(page);
  const history = page.locator(".topbar .editor-export-jobs-trigger");
  const popover = page.getByRole("dialog", { name: "导出任务", exact: true });
  assert.equal(await history.count(), 1);
  assert.equal(await popover.isVisible(), false);
  assert.equal(await history.getAttribute("aria-expanded"), "false");
  await history.click();
  assert.equal(await popover.isVisible(), true);
  assert.equal(await popover.getByText("暂无导出任务", { exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "关闭导出任务", exact: true }).press("Escape");
  assert.equal(await popover.isVisible(), false);
  for (const tab of ["jobs", "recording", "media"]) {
    await production(page, tab);
    assert.equal(await history.count(), 1);
    assert.equal(await history.isVisible(), true);
    assert.equal(await popover.isVisible(), false);
  }
  await history.click();
  await page.getByRole("button", { name: "关闭导出任务", exact: true }).press("Delete");
  assert.deepEqual(await saved(page), before, "Task controls must not edit the timeline");
  await page.getByRole("button", { name: "关闭导出任务", exact: true }).click();
});

test("main rail and original-source previews retain the mounted canonical canvas, timeline, selection and document", async (t) => {
  const page = await openPage(t);
  await clickEditorAction(page, "rectangle");
  const before = await property(page, "旋转（度）", 19);
  const shape = shapeFrom(before);
  await page.locator("[data-ew-seek]").fill("240000");
  await settle(page);
  const playhead = await page.locator("[data-ew-seek]").inputValue();
  await page.evaluate(() => {
    window.__mountedEditorNodes = [
      document.querySelector("#studio .workspace"),
      document.querySelector("#editor-workspace"),
      document.querySelector("[data-ew-canvas]"),
      document.querySelector("[data-ew-timeline]"),
    ];
  });
  for (const tab of ["ai", "transcript", "jobs", "recording"]) {
    await production(page, tab);
    assert.equal(await page.locator("#editor-workspace").isVisible(), true);
    assert.equal(await page.locator("#editor-workspace .ew-viewer").isVisible(), true);
    assert.equal(await page.locator("#editor-workspace [data-ew-timeline]").isVisible(), true);
    assert.equal(
      await page.locator(`#studio .rail [data-tab="${tab}"]`).getAttribute("aria-pressed"),
      "true",
    );
    await page.locator('[data-library-view="assets"]').click();
    assert.equal(await page.locator('[data-asset="demo"]').isVisible(), true);
    assert.equal(await page.locator("#editor-workspace [data-ew-timeline]").isVisible(), true);
    await page.locator('[data-library-view="feature"]').click();
    assert.deepEqual(await saved(page), before);
    await returnEditor(page);
    assert.equal(
      await page.locator(`[data-et-clip="${shape.id}"]`).getAttribute("aria-selected"),
      "true",
    );
    assert.equal(await page.getByLabel("旋转（度）", { exact: true }).inputValue(), "19");
    assert.equal(await page.locator("[data-ew-seek]").inputValue(), playhead);
  }
  await page.locator('[data-asset="demo"] .asset-thumbnail').click();
  assert.equal(await page.locator("#editor-workspace").isVisible(), true);
  assert.equal(await page.locator("#editor-workspace [data-ew-timeline]").isVisible(), true);
  assert.equal(await page.locator("#editor-workspace .ew-tools").isVisible(), true);
  assert.equal(await page.locator("#studio .timeline-panel").isVisible(), false);
  assert.equal(await page.locator("#editor-workspace .ew-viewer").isVisible(), false);
  assert.equal(await page.locator("#editor-workspace .ew-properties").isVisible(), false);
  assert.equal(
    await page.locator('#studio .viewer-panel[aria-label="原素材预览"]').isVisible(),
    true,
  );
  assert.equal(await page.locator("#studio #preview").isVisible(), true);
  assert.deepEqual(await saved(page), before);
  await page.locator(`[data-et-clip="${shape.id}"]`).click();
  assert.equal(await page.locator("#editor-workspace .ew-viewer").isVisible(), true);
  assert.equal(await page.locator("#editor-workspace .ew-properties").isVisible(), true);
  assert.equal(await page.locator("#studio .viewer-panel").isVisible(), false);
  assert.equal(await page.locator("#studio .timeline-panel").isVisible(), false);
  assert.equal(await page.locator("#studio .workspace.editor-source-mode").count(), 0);
  assert.equal(
    await page.locator(`[data-et-clip="${shape.id}"]`).getAttribute("aria-selected"),
    "true",
  );
  assert.deepEqual(
    await saved(page),
    before,
    "Returning through the canonical timeline is a view-only action",
  );
  await page.locator('[data-asset="demo"] .asset-thumbnail').click();
  await oldAction(page, "return-composition").click();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(`[data-et-clip="${shape.id}"]`).getAttribute("aria-selected"),
    "true",
  );
  assert.deepEqual(await saved(page), before);
  assert.deepEqual(
    await page.evaluate(() => {
      const current = [
        document.querySelector("#studio .workspace"),
        document.querySelector("#editor-workspace"),
        document.querySelector("[data-ew-canvas]"),
        document.querySelector("[data-ew-timeline]"),
      ];
      return current.map(
        (node, index) => node.isConnected && node === window.__mountedEditorNodes[index],
      );
    }),
    [true, true, true, true],
  );
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.deepEqual(await saved(page), before);
});

test("workspace dividers resize the fixed editor and keep their sizes across tabs and reload", async (t) => {
  const page = await openPage(t);
  const width = (selector) => page.locator(selector).evaluate((element) => element.getBoundingClientRect().width);
  const height = (selector) => page.locator(selector).evaluate((element) => element.getBoundingClientRect().height);
  const originalLibrary = await width(".library-panel");
  const originalTimeline = await height("[data-ew-timeline]");
  const divider = page.locator('[data-resize-pane="library"]');
  const bounds = await divider.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 60);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 64, bounds.y + 60, { steps: 4 });
  await page.mouse.up();
  assert.ok((await width(".library-panel")) >= originalLibrary + 50);
  await page.locator('[data-resize-pane="timeline"]').focus();
  await page.keyboard.press("ArrowUp");
  assert.ok((await height("[data-ew-timeline]")) >= originalTimeline + 10);
  const resizedLibrary = await width(".library-panel");
  const resizedTimeline = await height("[data-ew-timeline]");
  await production(page, "voiceover");
  assert.equal(await page.locator("[data-ew-timeline]").isVisible(), true);
  assert.ok(Math.abs((await width(".library-panel")) - resizedLibrary) <= 1);
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.ok(Math.abs((await width(".library-panel")) - resizedLibrary) <= 1);
  assert.ok(Math.abs((await height("[data-ew-timeline]")) - resizedTimeline) <= 1);
});

test("saved video and audio reopen without starting native proxies, waveforms or voice probes", async (t) => {
  const videoPath = resolve(directory, "quiet-startup.mp4");
  await promisify(execFile)("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=30:d=2",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    videoPath,
  ]);
  const video = await readFile(videoPath),
    audio = await readFile(new URL("./fixtures/static-tone.wav", import.meta.url));
  const resourceId = (bytes) => `asset-${createHash("sha256").update(bytes).digest("hex")}`;
  const videoId = resourceId(video),
    audioId = resourceId(audio);
  const original = {
    ...seed,
    id: "saved-real-media",
    name: "已保存的视频与旁白",
    assets: [
      {
        id: "saved-video",
        name: "画面.mp4",
        kind: "video",
        durationFrames: 60,
        width: 160,
        height: 90,
        mediaId: videoId,
        mimeType: "video/mp4",
        size: video.length,
      },
      {
        id: "saved-audio",
        name: "旁白.wav",
        kind: "audio",
        durationFrames: 60,
        mediaId: audioId,
        mimeType: "audio/wav",
        size: audio.length,
      },
    ],
    clips: [
      {
        id: "saved-picture",
        assetId: "saved-video",
        inFrame: 0,
        outFrame: 60,
        startFrame: 0,
        volume: 1,
      },
    ],
    audioClips: [
      {
        id: "saved-voice",
        assetId: "saved-audio",
        inFrame: 0,
        outFrame: 60,
        startFrame: 0,
        volume: 1,
      },
    ],
  };
  const page = await openPage(t, {
    seed: original,
    fullNativeAccess: true,
    holdNativeStart: true,
    mediaMetadata: {
      [videoId]: {
        id: videoId,
        sha256: videoId.slice(6),
        bytes: video.length,
        mimeType: "video/mp4",
        name: "画面.mp4",
        createdAt: 1,
      },
      [audioId]: {
        id: audioId,
        sha256: audioId.slice(6),
        bytes: audio.length,
        mimeType: "audio/wav",
        name: "旁白.wav",
        createdAt: 1,
      },
    },
    mediaResources: {
      [videoId]: { mimeType: "video/mp4", bytes: video },
      [audioId]: { mimeType: "audio/wav", bytes: audio },
    },
  });
  const verifyQuietRestore = async () => {
    await page.locator("#editor-workspace").waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      window.__mainHost.calls.some((call) => call.method === "tasks.list"),
    );
    await waitSaved(page);
    await page.waitForFunction(
      () => document.querySelectorAll("canvas[data-et-media-state]").length >= 2,
    );
    assert.ok(page.fixtureMediaRequests.includes(videoId), "Saved video is opened in the browser");
    assert.ok(page.fixtureMediaRequests.includes(audioId), "Saved audio is opened in the browser");
    await settle(page);
    const nativeCalls = await page.evaluate(() =>
      window.__mainHost.calls.filter((call) =>
        ["tasks.start", "process.spawn"].includes(call.method),
      ),
    );
    assert.deepEqual(nativeCalls, [], "Opening a saved project must not request native execution");
    const document = await saved(page);
    assert.equal(document.id, original.id);
    assert.equal(document.revision, original.revision);
    assert.deepEqual(
      document.assets.map((asset) => asset.resourceId),
      [videoId, audioId],
    );
    assert.equal(
      document.sequences
        .flatMap((sequence) => sequence.clips)
        .filter((clip) => clip.kind === "media").length,
      2,
    );
    return document;
  };
  const restored = await verifyQuietRestore();
  page.fixtureMediaRequests.length = 0;
  await page.reload();
  assert.deepEqual(await verifyQuietRestore(), restored);
  await page.locator('[data-ew-action="play"]').click();
  await page.waitForFunction(() =>
    window.__mainHost.calls.some((call) => call.method === "tasks.start"),
  );
  await settle(page);
  assert.deepEqual(
    await page.evaluate(() => window.__mainHost.calls
      .filter((call) => call.method === "tasks.start")
      .map((call) => call.args.input.request.action)),
    ["stage-status"],
    "Optional timeline media must not duplicate source preparation while Play is still preparing",
  );
  assert.deepEqual(await saved(page), restored, "Starting preview never changes the saved edit");
});

test("main restores 0.5.16 multitrack without the optional old demo upgrade blocking task setup", async (t) => {
  const original = JSON.parse(
    await readFile(new URL("./fixtures/video-studio/project-0.5.16.json", import.meta.url), "utf8"),
  );
  const page = await openPage(t, { seed: original, nativeTasks: true });
  const doc = await waitSaved(page);
  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.id, original.id);
  assert.equal(doc.revision, original.revision);
  assert.equal(doc.sequences[0].magneticTrackId, "video-main");
  assert.equal(
    doc.sequences[0].clips.filter((clip) => clip.kind === "media").length,
    original.clips.length + original.audioClips.length,
  );
  assert.equal(
    await page.evaluate(() => window.__mainHost.calls.some((call) => call.method === "tasks.list")),
    true,
  );
  const backup = await page.evaluate(
    () =>
      Object.entries(window.__mainHost.records()).find(([key]) =>
        key.startsWith("video-studio-legacy-"),
      )?.[1][0].data.data,
  );
  assert.deepEqual(backup, original);
  await clickEditorAction(page, "rectangle");
  const edited = await waitSaved(page);
  assert.ok(shapeFrom(edited));
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.deepEqual(await saved(page), edited);
});
test("main migrates V1, preserves its exact backup, and retains v2 properties through 字幕 page edits and reload", async (t) => {
  const page = await openPage(t);
  await clickEditorAction(page, "rectangle");
  let doc = await waitSaved(page);
  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.revision, seed.revision + 1);
  const backup = await page.evaluate(
    () =>
      Object.entries(window.__mainHost.records()).find(([key]) =>
        key.startsWith("video-studio-legacy-"),
      )?.[1][0].data.data,
  );
  assert.deepEqual(backup, seed, "Migration preserves exact old JSON, including omissions");
  doc = await property(page, "水平位置（%）", 27);
  doc = await property(page, "旋转（度）", 17);
  const shape = shapeFrom(doc);
  assert.equal(shape.transform.x, 0.27);
  assert.equal(shape.transform.rotation, 17);
  const revision = doc.revision;
  await production(page);
  await page.locator('#studio [data-tab="transcript"]').click();
  const panel = page.locator("#studio .library-panel .editor-captions");
  await panel.getByLabel("新字幕文字", { exact: true }).fill("字幕页添加的新字幕");
  await panel.getByRole("button", { name: "在播放头添加字幕", exact: true }).click();
  const added = (d) =>
    d.sequences
      .flatMap((s) => s.clips)
      .filter((c) => c.kind === "text" && c.text === "字幕页添加的新字幕");
  await page.waitForFunction(
    () =>
      window.__mainHost
        .current()
        .sequences.some((s) => s.clips.some((c) => c.text === "字幕页添加的新字幕")),
  );
  doc = await waitSaved(page);
  assert.equal(doc.revision, revision + 1, "Adding a caption dispatches exactly once");
  assert.deepEqual(shapeFrom(doc), shape);
  assert.equal(added(doc).length, 1);
  const row = panel.locator(`[data-caption-id="${added(doc)[0].id}"]`);
  await row.getByLabel("开始（秒）").fill("2");
  await row.getByLabel("结束（秒）").fill("3");
  assert.deepEqual(
    await row.locator("input[type=number]").evaluateAll((inputs) =>
      inputs.map((input) => input.checkValidity()),
    ),
    [true, true],
    "Whole seconds must pass the real input constraints",
  );
  await row.getByRole("button", { name: "保存时间", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__mainHost
        .current()
        .sequences.some((s) =>
          s.clips.some((c) => c.text === "字幕页添加的新字幕" && c.start === 480000),
        ),
  );
  doc = await waitSaved(page);
  assert.equal(doc.revision, revision + 2, "The timing edit is its own single step");
  assert.deepEqual(
    [added(doc)[0].start, added(doc)[0].duration],
    [480000, 240000],
  );
  await returnEditor(page);
  await clickEditorAction(page, "undo");
  doc = await waitSaved(page);
  assert.equal(added(doc)[0].start, 0, "Undo restores the caption at the playhead");
  await clickEditorAction(page, "undo");
  doc = await waitSaved(page);
  assert.deepEqual(shapeFrom(doc), shape);
  assert.equal(added(doc).length, 0);
  await clickEditorAction(page, "redo");
  await clickEditorAction(page, "redo");
  doc = await waitSaved(page);
  assert.equal(added(doc)[0].start, 480000);
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.deepEqual(await saved(page), doc);
  await page.locator(`[data-et-clip="${shape.id}"]`).click();
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), "27");
  assert.equal(await page.getByLabel("旋转（度）", { exact: true }).inputValue(), "17");
});

test("main save failure retains advanced edits and retries without a duplicate commit", async (t) => {
  const page = await openPage(t);
  await clickEditorAction(page, "ellipse");
  const before = await waitSaved(page),
    shape = shapeFrom(before);
  await page.evaluate(() => window.__mainHost.fail(true));
  const input = page.getByLabel("水平缩放（%）", { exact: true });
  await input.fill("45");
  await input.press("Tab");
  await page.waitForFunction(
    () => document.querySelector("[data-ew-save]").textContent === "保存失败",
  );
  assert.deepEqual(await saved(page), before);
  assert.equal(await input.inputValue(), "45");
  await page.evaluate(() => window.__mainHost.fail(false));
  await clickEditorAction(page, "retry-save");
  const after = await waitSaved(page);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(shapeFrom(after).transform.scaleX, 0.45);
  assert.equal(shapeFrom(after).id, shape.id);
  await clickEditorAction(page, "undo");
  assert.deepEqual(shapeFrom(await waitSaved(page)), shape);
});

test("main restores a same-ID historical v2 document with monotonic revision and preserved properties", async (t) => {
  const page = await openPage(t);
  await clickEditorAction(page, "rectangle");
  await waitSaved(page);
  const target = await property(page, "水平位置（%）", 37);
  const targetStorageRevision = await page.evaluate(() =>
    window.__mainHost.latestStorageRevision(),
  );
  const changed = await property(page, "水平位置（%）", 64);
  await production(page);
  await oldAction(page, "versions").first().click();
  await page.locator(`[data-version="${targetStorageRevision}"]`).click();
  await page
    .waitForFunction(
      (previous) =>
        window.__mainHost.current().revision > previous &&
        window.__mainHost
          .current()
          .sequences.some((s) => s.clips.some((c) => c.kind === "shape" && c.transform.x === 0.37)),
      changed.revision,
    )
    .catch(async (error) => {
      throw new Error(
        error.message +
          "\n" +
          JSON.stringify(
            await page.evaluate(() => ({
              toast: document.querySelector("#toast").textContent,
              revision: window.__mainHost.current().revision,
              calls: window.__mainHost.calls
                .slice(-8)
                .map(({ method, args }) => ({ method, key: args.key, revision: args.revision })),
            })),
          ),
      );
    });
  const restored = await saved(page);
  assert.equal(restored.id, target.id);
  assert.ok(restored.revision > changed.revision);
  assert.deepEqual(shapeFrom(restored), shapeFrom(target));
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.deepEqual(await saved(page), restored);
});

test("main rejects a failed restore without replacing its current document", async (t) => {
  const page = await openPage(t);
  await clickEditorAction(page, "rectangle");
  const current = await property(page, "水平位置（%）", 31);
  const incoming = structuredClone(current);
  incoming.revision = 0;
  incoming.name = "不得激活的版本";
  shapeFrom(incoming).transform.x = 0.88;
  await page.evaluate(() => window.__mainHost.fail(true));
  await page.locator("#project-input").setInputFiles({
    name: "restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(incoming)),
  });
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("模拟磁盘保存失败"),
  );
  assert.deepEqual(await saved(page), current);
  assert.equal(await page.locator("#project-name").inputValue(), current.name);
  await page.locator(`[data-et-clip="${shapeFrom(current).id}"]`).click();
  assert.equal(await page.getByLabel("水平位置（%）", { exact: true }).inputValue(), "31");
});

test("main initial read failure never writes an empty replacement over unreadable data", async (t) => {
  const page = await openPage(t, { failRead: true });
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("原有工程无法恢复"),
  );
  assert.equal(await page.locator("#editor-workspace").count(), 0);
  assert.deepEqual(await saved(page), seed);
  assert.equal(
    await page.evaluate(
      () => window.__mainHost.attempted.filter((c) => c.key === "video-studio-current").length,
    ),
    0,
  );
  assert.equal(await page.locator("#save-state").textContent(), "恢复失败");
});

test("manual legacy rough-cut markers and assembly preserve an advanced layer and remain single-step undoable", async (t) => {
  // Range editing of an offline source is supported; source decoding is outside this metadata test.
  const page = await openPage(t, { missingAudio: true });
  await clickEditorAction(page, "rectangle");
  const before = await property(page, "旋转（度）", 23),
    shape = shapeFrom(before);
  await production(page);
  await page.locator('#studio [data-tab="roughcut"]').click();
  await page.locator("#roughcut-source").selectOption("missing-audio");
  await page.locator("#roughcut-in").fill("00:00:01:00");
  await page.locator("#roughcut-in").press("Tab");
  await page.locator("#roughcut-out").fill("00:00:03:00");
  await page.locator("#roughcut-out").press("Tab");
  await page.locator('[data-roughcut-field="name"]').fill("保留中间两秒");
  await oldAction(page, "roughcut-save").click();
  await page.waitForFunction(
    (revision) => window.__mainHost.current().revision > revision,
    before.revision,
  );
  const marked = await waitSaved(page);
  assert.equal(marked.revision, before.revision + 1);
  assert.deepEqual(shapeFrom(marked), shape);
  assert.deepEqual(
    marked.production.roughCuts.map(({ assetId, inFrame, outFrame, name }) => ({
      assetId,
      inFrame,
      outFrame,
      name,
    })),
    [{ assetId: "missing-audio", inFrame: 30, outFrame: 90, name: "保留中间两秒" }],
  );
  await oldAction(page, "roughcut-append").click();
  await page.waitForFunction(
    (revision) => window.__mainHost.current().revision > revision,
    marked.revision,
  );
  const assembled = await waitSaved(page);
  assert.equal(assembled.revision, marked.revision + 1);
  const audio = assembled.sequences
    .flatMap((s) => s.clips)
    .find((c) => c.kind === "media" && c.assetId === "missing-audio");
  assert.ok(audio);
  assert.equal(audio.duration, 480000);
  assert.deepEqual(audio.timeMap.points, [
    { time: 0, source: 240000 },
    { time: 480000, source: 720000 },
  ]);
  assert.deepEqual(shapeFrom(assembled), shape);
  await returnEditor(page);
  await clickEditorAction(page, "undo");
  const undone = await waitSaved(page);
  assert.deepEqual(undone.sequences, marked.sequences);
  assert.deepEqual(undone.production, marked.production);
});

test("main exposes canonical agent edits with exact frame rate, durable save and shared undo", async (t) => {
  const page = await openPage(t);
  const result = await page.evaluate(async () => {
    const tools = window.__mainHost.tools;
    const current = tools.read_video_project({ editor: { view: "project" } });
    const saved = window.__mainHost.current();
    const sequenceId = tools.read_video_project({
      editor: { view: "project", path: "/activeSequenceId" },
    }).page.value;
    const result = await tools.apply_video_edit({
      editor: {
        identity: current.identity,
        label: "AI 更新帧率与工程名称",
        steps: [
          {
            kind: "operations",
            operations: [
              {
                type: "sequence.update",
                sequenceId,
                patch: { frameRate: { numerator: 30000, denominator: 1001 } },
              },
              { type: "project.rename", name: "精确 NTSC 工程" },
            ],
          },
        ],
      },
    });
    return {
      registered: Object.keys(tools),
      previous: current.identity,
      result,
      frameRate: tools.read_video_project({
        editor: { view: "project", identity: result.identity, path: "/sequences/0/frameRate" },
      }),
      document: window.__mainHost.current(),
    };
  });
  for (const name of ["read_video_project", "apply_video_edit", "render_video_project"])
    assert.ok(result.registered.includes(name));
  assert.equal(result.result.identity.revision, result.previous.revision + 1);
  assert.equal(result.document.name, "精确 NTSC 工程");
  assert.deepEqual(result.document.sequences[0].frameRate, { numerator: 30000, denominator: 1001 });
  assert.equal(result.frameRate.timebase, 240000);
  assert.deepEqual(
    result.frameRate.page.entries.map(({ key, value }) => [key, value]),
    [
      ["numerator", 30000],
      ["denominator", 1001],
    ],
  );
  assert.equal(await page.locator("#project-name").inputValue(), "精确 NTSC 工程");
  await clickEditorAction(page, "undo");
  const restored = await waitSaved(page);
  assert.equal(restored.name, seed.name);
  assert.deepEqual(restored.sequences[0].frameRate, { numerator: 30, denominator: 1 });
  await clickEditorAction(page, "redo");
  await waitSaved(page);
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.equal((await saved(page)).name, "精确 NTSC 工程");
});

test("main agent candidate save failure leaves canonical state unchanged and requires a fresh identity after manual edits", async (t) => {
  const page = await openPage(t);
  const before = await saved(page);
  const result = await page.evaluate(async () => {
    const tools = window.__mainHost.tools,
      identity = tools.read_video_project({ editor: { view: "project" } }).identity;
    const request = {
      identity,
      label: "AI 候选",
      steps: [{ kind: "operations", operations: [{ type: "project.rename", name: "未保存候选" }] }],
    };
    window.__mainHost.fail(true);
    let message;
    try {
      await tools.apply_video_edit({ editor: request });
    } catch (error) {
      message = String(error);
    }
    window.__mainHost.fail(false);
    return { message, identity, state: tools.read_video_project({ editor: { view: "project" } }) };
  });
  assert.match(result.message, /模拟磁盘保存失败/);
  assert.deepEqual(result.state.identity, result.identity);
  assert.deepEqual(await saved(page), before);
  assert.equal(await page.locator("#project-name").inputValue(), seed.name);
  await clickEditorAction(page, "rectangle");
  const edited = await waitSaved(page);
  const stale = await page.evaluate(async (identity) => {
    try {
      await window.__mainHost.tools.apply_video_edit({
        editor: {
          identity,
          label: "旧候选",
          steps: [
            { kind: "operations", operations: [{ type: "project.rename", name: "过期覆盖" }] },
          ],
        },
      });
      return "accepted";
    } catch (error) {
      return String(error);
    }
  }, result.identity);
  assert.match(stale, /版本已变化/);
  assert.deepEqual(await saved(page), edited);
});

test("main subtitle workbench reviews SRT, retries failed durable save, and shares undo and reload", async (t) => {
  const page = await openPage(t),
    before = await saved(page);
  await clickEditorAction(page, "captions");
  const dialog = page.getByRole("region", { name: "字幕工作台" });
  await dialog.waitFor({ state: "visible" });
  assert.equal(
    await page.locator('#studio .rail [data-tab="transcript"]').getAttribute("aria-pressed"),
    "true",
    "更多工具 → 语音字幕 opens the shared 字幕 page",
  );
  assert.equal(await page.locator("dialog.editor-captions").count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "生成所选声音字幕" }).isDisabled(), true);
  assert.equal(await dialog.getByRole("button", { name: "预览翻译" }).isDisabled(), true);
  await dialog.locator("[data-caption-srt-input]").setInputFiles({
    name: "字幕.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from("1\n00:00:03,123 --> 00:00:04,987\n新导入字幕\n"),
  });
  await dialog.locator(".ec-candidate").filter({ hasText: "新导入字幕" }).waitFor();
  assert.deepEqual(await saved(page), before);
  await page.evaluate(() => window.__mainHost.fail(true));
  await dialog.getByRole("button", { name: "应用预览", exact: true }).click();
  await dialog.locator(".ec-status").filter({ hasText: "模拟磁盘保存失败" }).waitFor();
  assert.deepEqual(await saved(page), before);
  assert.equal(
    await dialog.getByRole("button", { name: "应用预览", exact: true }).isEnabled(),
    true,
  );
  await page.evaluate(() => window.__mainHost.fail(false));
  await dialog.getByRole("button", { name: "应用预览", exact: true }).click();
  await dialog.locator(".ec-status").filter({ hasText: "字幕已保存" }).waitFor();
  const changed = await waitSaved(page),
    imported = changed.sequences[0].clips.find((clip) => clip.text === "新导入字幕");
  assert.equal(imported.start, 749520);
  assert.equal(imported.duration, 447360);
  await returnEditor(page);
  await clickEditorAction(page, "undo");
  assert.equal(
    (await waitSaved(page)).sequences[0].clips.some((clip) => clip.text === "新导入字幕"),
    false,
  );
  await clickEditorAction(page, "redo");
  await waitSaved(page);
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  await clickEditorAction(page, "captions");
  assert.deepEqual(
    await page
      .getByRole("region", { name: "字幕工作台" })
      .getByRole("textbox", { name: "字幕文字", exact: true })
      .evaluateAll((inputs) => inputs.map((input) => input.value)),
    ["原始字幕", "新导入字幕"],
  );
  assert.equal(
    (await saved(page)).sequences[0].clips.find((clip) => clip.text === "新导入字幕").start,
    749520,
  );
});

test("main translation preview uses the Host model and applies bilingual subtitles only after review", async (t) => {
  const page = await openPage(t, { translation: true }),
    before = await saved(page);
  await clickEditorAction(page, "captions");
  const dialog = page.getByRole("region", { name: "字幕工作台" });
  await dialog.getByRole("button", { name: "预览翻译", exact: true }).click();
  await dialog.locator(".ec-candidate").filter({ hasText: "Translation: 原始字幕" }).waitFor();
  assert.deepEqual(await saved(page), before);
  const requests = await page.evaluate(() =>
    window.__mainHost.calls.filter((call) => call.method === "agent.task.start"),
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].args.toolNames, []);
  await dialog.getByRole("button", { name: "应用预览", exact: true }).click();
  await dialog.locator(".ec-status").filter({ hasText: "字幕已保存" }).waitFor();
  const result = await waitSaved(page),
    caption = result.sequences[0].clips.find((clip) => clip.kind === "text");
  assert.equal(caption.text, "原始字幕\nTranslation: 原始字幕");
  await page.screenshot({ path: "/tmp/video-studio-caption-workbench-main.png", fullPage: true });
  await clickEditorAction(page, "undo");
  assert.equal(
    (await waitSaved(page)).sequences[0].clips.find((clip) => clip.kind === "text").text,
    "原始字幕",
  );
});

const T = 240000;
const visual = () => ({
  transform: {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
    fit: "contain",
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
  },
  color: {
    exposure: 0,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    hue: 0,
    curves: [],
    hsl: [],
  },
  blendMode: "normal",
});
const track = (id, kind, name) => ({
  id,
  kind,
  name,
  locked: false,
  hidden: false,
  muted: false,
  volume: 1,
  pan: 0,
});
const picture = (id, trackId, start, duration) => ({
  id,
  trackId,
  start,
  duration,
  label: id,
  kind: "media",
  assetId: "camera",
  ...visual(),
  audio: { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, pitchSemitones: 0, preservePitch: true },
  timeMap: {
    points: [
      { time: 0, source: 0 },
      { time: duration, source: duration },
    ],
  },
});
/** Real footage: off-frame source length and placement plus a second picture track. */
const realMediaSeed = {
  schemaVersion: 2,
  timebase: T,
  id: "caption-real-media",
  name: "实拍字幕",
  revision: 3,
  activeSequenceId: "main",
  exportProfiles: [],
  assets: [
    { id: "camera", name: "实拍画面", kind: "demo", duration: 10_000_123, width: 640, height: 360 },
  ],
  sequences: [
    {
      id: "main",
      name: "主时间线",
      width: 640,
      height: 360,
      frameRate: { numerator: 30000, denominator: 1001 },
      background: "#000000",
      timelineMode: "free",
      tracks: [
        track("v1", "video", "画面"),
        track("v2", "video", "画中画"),
        track("t1", "text", "字幕"),
      ],
      clips: [
        picture("camera-main", "v1", 1_234_567, 10_000_123),
        picture("camera-overlay", "v2", 0, 2_400_011),
        {
          id: "existing-caption",
          trackId: "t1",
          start: 2_000_001,
          duration: 500_003,
          label: "字幕",
          kind: "text",
          role: "subtitle",
          text: "实拍里的现有字幕",
          style: {
            layout: "box",
            fontFamily: "system-ui",
            fontSize: 48,
            fontWeight: 600,
            italic: false,
            color: "#ffffff",
            strokeColor: "#000000",
            strokeWidth: 0,
            background: "#00000000",
            backgroundRadius: 0,
            padding: 0,
            align: "center",
            lineHeight: 1.4,
            letterSpacing: 0,
            maxWidth: 0.85,
            highlightColor: "#ffe46b",
            shadow: { color: "#00000000", blur: 0, x: 0, y: 0 },
            animation: "none",
          },
          words: [],
          ...visual(),
        },
      ],
      transitions: [],
      markers: [],
    },
  ],
};
test("字幕 page edits real off-frame multitrack footage without the old view, and 语音字幕 shows the same rows", async (t) => {
  const page = await openPage(t, { seed: realMediaSeed });
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => window.__toasts.push(document.querySelector("#toast").textContent)).observe(
      document.querySelector("#toast"),
      { childList: true, characterData: true, subtree: true },
    );
  });
  await page.locator('#studio .rail [data-tab="transcript"]').click();
  const panel = page.locator("#studio .library-panel #caption-panel-host > .editor-captions");
  await panel.waitFor({ state: "visible" });
  const texts = () =>
    panel
      .getByRole("textbox", { name: "字幕文字", exact: true })
      .evaluateAll((inputs) => inputs.map((input) => input.value));
  assert.deepEqual(await texts(), ["实拍里的现有字幕"]);
  assert.match(await page.locator(".statusbar").innerText(), /1 条字幕/);
  await panel.getByLabel("新字幕文字", { exact: true }).fill("播放头新字幕");
  await panel.getByRole("button", { name: "在播放头添加字幕", exact: true }).click();
  await page.waitForFunction(() =>
    window.__mainHost.current().sequences[0].clips.some((clip) => clip.text === "播放头新字幕"),
  );
  await panel.locator("[data-caption-srt-input]").setInputFiles({
    name: "实拍.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from("1\n00:00:07,001 --> 00:00:08,002\n导入的实拍字幕\n"),
  });
  await panel.locator(".ec-candidate").filter({ hasText: "导入的实拍字幕" }).waitFor();
  await panel.getByRole("button", { name: "应用预览", exact: true }).click();
  await panel.locator(".ec-status").filter({ hasText: "字幕已保存" }).waitFor();
  const doc = await waitSaved(page),
    clips = doc.sequences[0].clips;
  assert.equal(clips.find((clip) => clip.id === "existing-caption").start, 2_000_001);
  assert.equal(clips.find((clip) => clip.text === "导入的实拍字幕").start, 1_680_240);
  assert.equal(clips.find((clip) => clip.id === "camera-main").start, 1_234_567);
  assert.equal(clips.filter((clip) => clip.kind === "media").length, 2);
  assert.deepEqual(await texts(), ["播放头新字幕", "导入的实拍字幕", "实拍里的现有字幕"]);
  await panel.getByRole("button", { name: "全选字幕", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "导出所选 SRT", exact: true }).click();
  const download = await downloadPromise;
  const srt = await readFile(await download.path(), "utf8");
  assert.match(srt, /00:00:08,333 --> 00:00:10,417\n实拍里的现有字幕/);
  assert.match(srt, /00:00:07,001 --> 00:00:08,002\n导入的实拍字幕/);
  assert.match(await page.locator(".statusbar").innerText(), /3 条字幕/);
  await returnEditor(page);
  await clickEditorAction(page, "captions");
  assert.equal(
    await page.locator('#studio .rail [data-tab="transcript"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.deepEqual(await texts(), ["播放头新字幕", "导入的实拍字幕", "实拍里的现有字幕"]);
  assert.equal(await page.locator(".editor-captions").count(), 1, "One shared caption panel");
  const toasts = await page.evaluate(() => window.__toasts.join("\n"));
  assert.doesNotMatch(toasts, /旧视图|失败|无效|不能/);
});

test("口播 page cuts a pause from real off-frame multitrack media on the editor document", async (t) => {
  const audio = await readFile(new URL("./fixtures/static-tone.wav", import.meta.url));
  const voiceId = `asset-${createHash("sha256").update(audio).digest("hex")}`;
  const talk = 10 * T + 1234;
  const spokenSeed = {
    ...realMediaSeed,
    id: "spoken-real-media",
    name: "实拍口播",
    assets: [
      ...realMediaSeed.assets,
      { id: "voice", name: "实拍口播.wav", kind: "audio", duration: talk, resourceId: voiceId },
    ],
    sequences: [
      {
        ...realMediaSeed.sequences[0],
        tracks: [...realMediaSeed.sequences[0].tracks, track("a1", "audio", "口播")],
        clips: [
          ...realMediaSeed.sequences[0].clips,
          {
            ...picture("voice-clip", "a1", 0, talk),
            assetId: "voice",
          },
        ],
      },
    ],
  };
  const page = await openPage(t, {
    seed: spokenSeed,
    fullNativeAccess: true,
    holdNativeStart: true,
    mediaMetadata: {
      [voiceId]: {
        id: voiceId,
        sha256: voiceId.slice(6),
        bytes: audio.length,
        mimeType: "audio/wav",
        name: "实拍口播.wav",
        createdAt: 1,
      },
    },
    mediaResources: { [voiceId]: { mimeType: "audio/wav", bytes: audio } },
    // Finished preparation: real detector silence, no transcript yet.
    records: {
      [`video-studio-prepared-${voiceId}`]: [
        {
          revision: 1,
          updatedAt: 1,
          label: "准备完成",
          data: { assetId: voiceId, silence: { intervals: [{ start: 2, end: 4 }] } },
        },
      ],
    },
  });
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => window.__toasts.push(document.querySelector("#toast").textContent)).observe(
      document.querySelector("#toast"),
      { childList: true, characterData: true, subtree: true },
    );
  });
  // The media service has restored its job list once the production controller is ready.
  await page.waitForFunction(() =>
    window.__mainHost.calls.some((call) => call.method === "media.jobs.list"),
  );
  const before = await saved(page);
  await page.locator('#studio .rail [data-tab="spoken"]').click();
  const panel = page.locator("#studio .library-panel");
  await panel.locator("#spoken-asset").waitFor({ state: "visible" });
  assert.deepEqual(await panel.locator("#spoken-asset option").allTextContents(), ["实拍口播.wav"]);
  await panel.getByRole("button", { name: "读取已有结果", exact: true }).click();
  await panel.locator(".spoken-candidate").first().waitFor();
  await panel.getByRole("button", { name: "勾选长停顿", exact: true }).click();
  assert.match(await panel.locator("#spoken-selection").textContent(), /1 项.*1\.67 秒/);
  await panel.getByRole("button", { name: "应用所选删减", exact: true }).click();
  await page.waitForFunction(
    (revision) => window.__mainHost.current().revision > revision,
    before.revision,
  );
  const after = await waitSaved(page);
  assert.equal(await panel.getByRole("alert").count(), 0);
  const clips = after.sequences[0].clips,
    removed = 2 * T - 80000;
  const voice = clips
    .filter((clip) => clip.trackId === "a1")
    .sort((a, b) => a.start - b.start)
    .map((clip) => [clip.start, clip.start + clip.duration, clip.timeMap.points[0].source]);
  assert.deepEqual(voice, [
    [0, 2 * T + 40000, 0],
    [2 * T + 40000, talk - removed, 4 * T - 40000],
  ]);
  // The whole program loses the pause: the overlay is cut, later picture and text move up.
  assert.equal(clips.find((clip) => clip.id === "camera-main").start, 1_234_567 - removed);
  assert.equal(clips.find((clip) => clip.id === "existing-caption").start, 2_000_001 - removed);
  assert.deepEqual(
    clips
      .filter((clip) => clip.trackId === "v2")
      .sort((a, b) => a.start - b.start)
      .map((clip) => [clip.start, clip.start + clip.duration]),
    [
      [0, 2 * T + 40000],
      [2 * T + 40000, 2_400_011 - removed],
    ],
  );
  const toasts = await page.evaluate(() => window.__toasts.join("\n"));
  assert.match(toasts, /已删去 1\.67 秒/);
  assert.doesNotMatch(toasts, /旧视图|失败|无效/);
  await panel.getByRole("button", { name: "撤销上次编辑", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__mainHost.current().sequences[0].clips.filter((c) => c.trackId === "a1").length === 1,
  );
});

test("粗剪 加入成片 places real off-frame media at the playhead of a multitrack project in order, one undo each", async (t) => {
  const take = 10 * T + 1234,
    at = 90 * 8008; // A whole 29.97 fps frame, so the playhead is not snapped.
  const roughSeed = {
    ...realMediaSeed,
    id: "rough-cut-real-media",
    name: "实拍粗剪",
    assets: [
      ...realMediaSeed.assets,
      { id: "take", name: "实拍原片.mp4", kind: "video", duration: take, width: 640, height: 360 },
    ],
    production: {
      roughCuts: [
        { id: "keep-tail", assetId: "take", inFrame: 30, outFrame: 300, name: "保留结尾", enabled: true },
      ],
    },
  };
  const page = await openPage(t, { seed: roughSeed });
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => window.__toasts.push(document.querySelector("#toast").textContent)).observe(
      document.querySelector("#toast"),
      { childList: true, characterData: true, subtree: true },
    );
  });
  await page.locator("[data-ew-seek]").fill(String(at));
  const before = await saved(page);
  await page.locator('#studio .rail [data-tab="roughcut"]').click();
  await page.locator("#roughcut-source").selectOption("take");
  const anchor = page.locator('.roughcut-batch [data-roughcut-field="append-anchor"]');
  assert.equal(await anchor.inputValue(), "end", "成片末尾 is the default");
  await anchor.selectOption("playhead");
  await oldAction(page, "roughcut-append").click();
  await page.waitForFunction(
    (revision) => window.__mainHost.current().revision > revision,
    before.revision,
  );
  const placed = await waitSaved(page);
  assert.equal(placed.revision, before.revision + 1, "The whole placement is one edit");
  const sequence = placed.sequences[0];
  const added = sequence.clips.filter((clip) => clip.assetId === "take");
  assert.equal(added.length, 1);
  assert.equal(added[0].start, at, "The cut lands at the composition playhead");
  assert.equal(added[0].duration, take - 30 * 8000);
  assert.deepEqual(added[0].timeMap.points, [
    { time: 0, source: 30 * 8000 },
    { time: take - 30 * 8000, source: take },
  ]);
  assert.ok(
    !["v1", "v2"].includes(added[0].trackId),
    "Occupied picture tracks are never overlapped; a free track is added",
  );
  for (const id of ["camera-main", "camera-overlay", "existing-caption"])
    assert.deepEqual(
      sequence.clips.find((clip) => clip.id === id),
      before.sequences[0].clips.find((clip) => clip.id === id),
    );
  assert.deepEqual(placed.production.roughCuts, before.production.roughCuts);
  // The composition returns with the new clip selected and the playhead after the placed run.
  const end = at + take - 30 * 8000;
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(`[data-et-clip="${added[0].id}"]`).getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.locator("[data-ew-seek]").inputValue(), String(end));

  // A second 加入 continues after the first, even after marker saves in between.
  await page.locator('#studio .rail [data-tab="roughcut"]').click();
  await page.locator("#roughcut-source").selectOption("take");
  assert.equal(await anchor.inputValue(), "playhead", "The last choice is remembered");
  let revision = (await saved(page)).revision;
  await page.locator('[data-roughcut-field="enabled"][data-cut-id="keep-tail"]').uncheck();
  await page.waitForFunction((value) => window.__mainHost.current().revision > value, revision);
  await page.locator("#roughcut-in").fill("00:00:01:00");
  await page.locator("#roughcut-in").press("Tab");
  await page.locator("#roughcut-out").fill("00:00:02:00");
  await page.locator("#roughcut-out").press("Tab");
  await page.locator('[data-roughcut-field="name"]').fill("第二段");
  revision = (await saved(page)).revision;
  await oldAction(page, "roughcut-save").click();
  await page.waitForFunction((value) => window.__mainHost.current().revision > value, revision);
  revision = (await waitSaved(page)).revision;
  await oldAction(page, "roughcut-append").click();
  await page.waitForFunction((value) => window.__mainHost.current().revision > value, revision);
  const afterSecond = await waitSaved(page);
  assert.equal(afterSecond.revision, revision + 1);
  const twice = afterSecond.sequences[0];
  const second = twice.clips.find(
    (clip) => clip.assetId === "take" && clip.id !== added[0].id,
  );
  assert.equal(second.start, end, "The next placement follows the previous one");
  assert.equal(second.duration, 30 * 8000);
  for (const a of twice.clips)
    for (const b of twice.clips)
      if (a.id < b.id && a.trackId === b.trackId)
        assert.ok(a.start + a.duration <= b.start || b.start + b.duration <= a.start);
  await returnEditor(page);
  await clickEditorAction(page, "undo");
  const undone = await waitSaved(page);
  assert.deepEqual(undone.sequences, placed.sequences, "One undo removes one placement");
  assert.equal(undone.production.roughCuts.length, 2, "Undo keeps the saved marks");
  const toasts = await page.evaluate(() => window.__toasts.join("\n"));
  assert.match(toasts, /已按列表顺序加入 1 个视频片段/);
  assert.doesNotMatch(toasts, /旧视图|失败|无效|不能/);
});

test("配音 replaces a generated voice on a second audio track of real off-frame footage in place, one undo", async (t) => {
  const voiceLength = 3 * T + 777,
    oldVoice = `asset-${"d".repeat(64)}`,
    newVoice = `asset-${"e".repeat(64)}`,
    speech = { text: "原来的配音文案。", voiceId: "tingting", engine: "macos-say", modelId: "macos-say", rate: 1 };
  const voiceSeed = {
    ...realMediaSeed,
    id: "voiceover-real-media",
    name: "实拍配音",
    assets: [
      ...realMediaSeed.assets,
      { id: "room", name: "现场声.wav", kind: "audio", duration: 10_000_123 },
      { id: "voice", name: "配音.wav", kind: "audio", duration: voiceLength, resourceId: oldVoice, fingerprint: "d".repeat(64), metadata: { speech } },
    ],
    sequences: [
      {
        ...realMediaSeed.sequences[0],
        tracks: [
          ...realMediaSeed.sequences[0].tracks,
          track("a1", "audio", "现场声"),
          track("a2", "audio", "配音"),
        ],
        clips: [
          ...realMediaSeed.sequences[0].clips,
          { ...picture("room-clip", "a1", 0, 10_000_123), assetId: "room" },
          {
            ...picture("voice-clip", "a2", 1_234_567, voiceLength),
            assetId: "voice",
            audio: { volume: 0.6, pan: -0.2, fadeIn: 8000, fadeOut: 16000, pitchSemitones: 0, preservePitch: true },
          },
        ],
      },
    ],
  };
  const page = await openPage(t, {
    seed: voiceSeed,
    voiceover: {
      assets: {
        [oldVoice]: { id: oldVoice, sha256: "d".repeat(64), bytes: 44, mimeType: "audio/wav", name: "配音.wav", createdAt: 1 },
      },
    },
  });
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => window.__toasts.push(document.querySelector("#toast").textContent)).observe(
      document.querySelector("#toast"),
      { childList: true, characterData: true, subtree: true },
    );
  });
  const before = await saved(page);
  await page.locator('[data-et-clip="voice-clip"]').click();
  const edit = page
    .locator("#editor-workspace")
    .getByRole("button", { name: "修改文案 / 重新配音", exact: true });
  await edit.click();
  assert.equal(await page.locator("#voiceover-text").inputValue(), speech.text);
  await page.waitForFunction(() => document.querySelector("#voiceover-voice")?.value === "tingting");
  await page.locator("#voiceover-text").fill("修改后的配音文案。");
  await page.getByRole("button", { name: "重新生成并替换配音", exact: true }).click();
  await page.waitForFunction(() => window.__voiceHost?.requests.length === 1);
  assert.equal(await page.evaluate(() => window.__voiceHost.requests[0].text), "修改后的配音文案。");
  const binding = await page.evaluate(
    () =>
      Object.values(window.__mainHost.records()["video-studio-production"][0].data.bindings).find(
        (item) => item.purpose === "tts",
      ),
  );
  assert.deepEqual(binding.replaceTarget, {
    sequenceId: "main",
    clipId: "voice-clip",
    trackId: "a2",
    assetId: "voice",
    start: 1_234_567,
    duration: voiceLength,
    timeMap: {
      points: [
        { time: 0, source: 0 },
        { time: voiceLength, source: voiceLength },
      ],
    },
  });
  assert.deepEqual((await saved(page)).sequences, before.sequences, "Nothing changes until the voice is ready");
  await page.evaluate(
    ({ newVoice, seconds }) => {
      const job = window.__voiceHost.jobs["job-voice-replace"];
      Object.assign(job, {
        status: "succeeded",
        updatedAt: Date.now(),
        result: {
          asset: { id: newVoice, sha256: newVoice.slice(6), name: "新配音.wav", mimeType: "audio/wav", bytes: 384044, createdAt: 2 },
          inspection: { kind: "audio", durationSeconds: seconds, audio: { sampleRate: 48000, channels: 1 } },
          speech: { text: "修改后的配音文案。", voiceId: "tingting", engine: "macos-say", modelId: "macos-say", rate: 1 },
        },
      });
      for (const listener of window.__mainHost.events["media.job.changed"] ?? []) listener(structuredClone(job));
    },
    { newVoice, seconds: voiceLength / T },
  );
  await page.waitForFunction(
    () =>
      window.__mainHost.current().sequences[0].clips.find((clip) => clip.id === "voice-clip").assetId !==
      "voice",
    undefined,
    { timeout: 15000 },
  );
  const replaced = await waitSaved(page);
  assert.equal(replaced.revision, before.revision + 1, "The replacement is one edit");
  const replacedClip = replaced.sequences[0].clips.find((clip) => clip.id === "voice-clip");
  const asset = replaced.assets.find((item) => item.id === replacedClip.assetId);
  assert.equal(asset.resourceId, newVoice);
  assert.equal(asset.duration, voiceLength);
  assert.deepEqual(
    { ...replacedClip, assetId: "voice" },
    before.sequences[0].clips.find((clip) => clip.id === "voice-clip"),
    "Same clip identity, exact ticks, volume, pan and fades",
  );
  for (const clip of before.sequences[0].clips.filter((clip) => clip.id !== "voice-clip"))
    assert.deepEqual(replaced.sequences[0].clips.find((item) => item.id === clip.id), clip);
  assert.ok(replaced.assets.some((item) => item.id === "voice"), "The old voice stays in the library");
  const toasts = await page.evaluate(() => window.__toasts.join("\n"));
  assert.match(toasts, /已替换配音/);
  assert.doesNotMatch(toasts, /移动、裁剪或删除|未自动替换|未替换|失败|无效/);
  await returnEditor(page);
  await clickEditorAction(page, "undo");
  await page.waitForFunction(
    () =>
      window.__mainHost.current().sequences[0].clips.find((clip) => clip.id === "voice-clip").assetId ===
      "voice",
  );
  const undone = await waitSaved(page);
  assert.deepEqual(undone.sequences, before.sequences, "One undo restores the original voice");
});

test("an asset change on the 字幕 page never rewrites the panel in place and keeps unsaved text", async (t) => {
  const page = await openPage(t);
  await page.locator('#studio .rail [data-tab="transcript"]').click();
  const draft = page.getByLabel("新字幕文字", { exact: true });
  await draft.fill("还没添加的字幕");
  await draft.focus();
  // Rewriting .library-panel in place empties #caption-panel-host until something re-renders;
  // background imports and job results defer that re-render while their save is pending.
  await page.evaluate(() => {
    window.__rewrites = 0;
    new MutationObserver((records) => (window.__rewrites += records.length)).observe(
      document.querySelector("#studio .library-panel"),
      { childList: true },
    );
  });
  await page.evaluate(async () => {
    const tools = window.__mainHost.tools,
      current = tools.read_video_project({ editor: { view: "project" } });
    await tools.apply_video_edit({
      editor: {
        identity: current.identity,
        label: "改素材名",
        steps: [
          {
            kind: "operations",
            operations: [{ type: "asset.update", assetId: "demo", patch: { name: "改名的画面" } }],
          },
        ],
      },
    });
  });
  const doc = await waitSaved(page);
  assert.equal(doc.assets[0].name, "改名的画面");
  assert.equal(await page.evaluate(() => window.__rewrites), 0);
  assert.equal(
    await page.locator("#studio .library-panel #caption-panel-host > .editor-captions").count(),
    1,
  );
  assert.equal(await draft.inputValue(), "还没添加的字幕");
  assert.equal(await draft.evaluate((node) => node === document.activeElement), true);
});

test("main mounts sequence management into the shared project, copy and rename survive reload", async (t) => {
  const page = await openPage(t);
  await clickEditorAction(page, "sequences");
  const section = page.getByRole("region", { name: "序列与复合片段" });
  await section.getByRole("textbox", { name: "副本名称", exact: true }).fill("短视频副本");
  await section.getByRole("button", { name: "复制完整序列", exact: true }).click();
  await page.waitForFunction(() => window.__mainHost.current().sequences?.length === 2);
  await waitSaved(page);
  assert.equal(await page.locator("[data-ew-sequence] option:checked").textContent(), "短视频副本");
  await section.getByRole("textbox", { name: "序列名称", exact: true }).fill("独立短版");
  await section.getByRole("button", { name: "重命名序列", exact: true }).click();
  await page.waitForFunction(() =>
    window.__mainHost.current().sequences?.some((seq) => seq.name === "独立短版"),
  );
  await waitSaved(page);
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  const result = await saved(page);
  assert.equal(result.sequences.length, 2);
  assert.equal(result.sequences.find((seq) => seq.id === result.activeSequenceId).name, "独立短版");
  assert.notDeepEqual(
    result.sequences[0].clips.map((clip) => clip.id),
    result.sequences[1].clips.map((clip) => clip.id),
  );
});

test("main mounts the open-format sync dialog with its bundled styles and never replaces on open", async (t) => {
  const page = await openPage(t, { nativeTasks: true }),
    before = await saved(page);
  await clickEditorAction(page, "sync-project");
  const dialog = page.getByRole("dialog", { name: "工程同步", exact: true });
  await dialog.waitFor({ state: "visible" });
  assert.match(await dialog.innerText(), /\.mimiproject/);
  const style = await dialog.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    maxWidth: getComputedStyle(element).maxWidth,
    classes: element.className,
  }));
  assert.equal(style.classes, "editor-sync-dialog");
  assert.notEqual(style.maxWidth, "none");
  assert.ok(style.width > 500 && style.width < 1280);
  assert.deepEqual(await saved(page), before);
  assert.equal(
    (
      await page.evaluate(() =>
        window.__mainHost.calls.filter((call) => call.method === "tasks.start"),
      )
    ).length,
    0,
  );
  assert.ok(await page.locator('link[href="./main.css"]').count());
});

test("main exposes sync through its existing AI tool and reports missing transport without editing", async (t) => {
  const page = await openPage(t, { nativeTasks: true }),
    before = await saved(page);
  const result = await page.evaluate(async () => {
    const tools = window.__mainHost.tools,
      identity = tools.read_video_project({ editor: { view: "project" } }).identity;
    const state = await tools.apply_video_edit({
      editor: { identity, sync: { action: "status" } },
    });
    const accepted = await tools.apply_video_edit({
      editor: {
        identity,
        sync: { action: "connect", requestId: "486e638f-78ab-47da-bc34-b4874970a936" },
      },
    });
    return { state, accepted };
  });
  assert.equal(result.state.sync.connected, false);
  assert.equal(result.accepted.sync.accepted, true);
  assert.ok(result.accepted.sync.operationId);
  await page.waitForFunction(async () => {
    const tools = window.__mainHost.tools,
      identity = tools.read_video_project({ editor: { view: "project" } }).identity;
    const state = await tools.apply_video_edit({
      editor: { identity, sync: { action: "status" } },
    });
    return state.sync.operation?.status === "failed";
  });
  assert.deepEqual(await saved(page), before);
});

test("main lazily opens multicam monitoring and releases it when returning to production", async (t) => {
  const page = await openPage(t),
    before = await saved(page);
  assert.equal(await page.getByRole("region", { name: "多机位剪辑", exact: true }).count(), 0);
  await clickEditorAction(page, "multicam");
  const section = page.getByRole("region", { name: "多机位剪辑", exact: true });
  await section.waitFor({ state: "visible" });
  assert.match(await section.innerText(), /创建机位组/);
  await page.screenshot({ path: "/tmp/video-studio-multicam-main.png", fullPage: true });
  await production(page);
  assert.equal(await section.isVisible(), false);
  await returnEditor(page);
  assert.equal(await section.isVisible(), true);
  await clickEditorAction(page, "multicam");
  assert.equal(await section.isVisible(), false);
  assert.deepEqual(await saved(page), before);
});

test("AI 制作 rule drafts and imported plans review and apply on real off-frame multitrack footage", async (t) => {
  const planSeed = { ...realMediaSeed, id: "plan-real-media", name: "实拍方案" };
  const page = await openPage(t, { seed: planSeed });
  const watchToasts = () =>
    page.evaluate(() => {
      window.__toasts = [];
      new MutationObserver(() =>
        window.__toasts.push(document.querySelector("#toast").textContent),
      ).observe(document.querySelector("#toast"), {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
  await watchToasts();
  const before = await saved(page);
  await production(page);
  const card = page.locator("#proposal-panel .proposal-card");
  const quick = page.getByRole("button", { name: "创建规则草案", exact: true });
  assert.equal(await quick.isDisabled(), false, "Real footage on the main track can be drafted");
  await quick.click();
  await card.waitFor({ state: "visible" });
  assert.match(await card.innerText(), /15 秒精简版/);
  assert.match(await card.innerText(), /46\.81s/, "The review shows the current sequence end");
  assert.match(await card.innerText(), /15\.0\ds/, "…and the frame-snapped end after applying");
  assert.match(await card.innerText(), /保留「camera-main」/);
  assert.equal(
    await card.locator(".proposal-tracks").count(),
    0,
    "No track changes its clip count, so none is listed",
  );
  assert.deepEqual(await saved(page), before, "Reviewing does not edit the project");
  await page.getByRole("button", { name: "应用方案", exact: true }).click();
  await page.waitForFunction(
    (revision) => window.__mainHost.current().revision > revision,
    before.revision,
  );
  const trimmed = await waitSaved(page);
  assert.equal(trimmed.revision, before.revision + 1, "The whole draft is one edit");
  const clips = (doc) => Object.fromEntries(doc.sequences[0].clips.map((clip) => [clip.id, clip]));
  assert.equal(clips(trimmed)["camera-main"].start, 1_234_567);
  assert.equal(clips(trimmed)["camera-main"].duration, 3_603_600 - 1_234_567);
  for (const id of ["camera-overlay", "existing-caption"])
    assert.deepEqual(clips(trimmed)[id], clips(before)[id]);
  assert.equal(await card.count(), 0, "The applied draft leaves the review");
  await returnEditor(page);
  await clickEditorAction(page, "undo");
  assert.deepEqual((await waitSaved(page)).sequences, before.sequences, "One undo restores");
  await clickEditorAction(page, "redo");
  await waitSaved(page);
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.deepEqual((await saved(page)).sequences, trimmed.sequences, "The draft survives reload");
  await watchToasts();

  // An imported plan in the editor format goes through the same review and single undo.
  const beforeImport = await saved(page);
  await production(page);
  await oldAction(page, "paste-plan").click();
  await page.locator("#plan-json").fill(
    JSON.stringify({
      title: "去掉画中画",
      explanation: "只保留主画面",
      editor: { steps: [{ kind: "remove", sequenceId: "main", clipIds: ["camera-overlay"] }] },
    }),
  );
  await oldAction(page, "load-plan").click();
  await card.waitFor({ state: "visible" });
  assert.match(await card.innerText(), /去掉画中画/);
  assert.match(await card.innerText(), /删除「camera-overlay」/);
  assert.match(await card.innerText(), /画中画\s*1\s*→\s*0/);
  assert.doesNotMatch(await card.locator(".proposal-tracks").innerText(), /画面\s*1/);
  await page.getByRole("button", { name: "应用方案", exact: true }).click();
  await page.waitForFunction(
    (revision) => window.__mainHost.current().revision > revision,
    beforeImport.revision,
  );
  const imported = await waitSaved(page);
  assert.equal(imported.revision, beforeImport.revision + 1);
  assert.equal(clips(imported)["camera-overlay"], undefined);
  assert.deepEqual(clips(imported)["camera-main"], clips(beforeImport)["camera-main"]);
  await returnEditor(page);
  await clickEditorAction(page, "undo");
  assert.deepEqual((await waitSaved(page)).sequences, beforeImport.sequences);

  // A plan made before another edit is marked stale and cannot be applied.
  await production(page);
  await oldAction(page, "paste-plan").click();
  await page.locator("#plan-json").fill(
    JSON.stringify({
      title: "过期方案",
      editor: { steps: [{ kind: "remove", sequenceId: "main", clipIds: ["camera-overlay"] }] },
    }),
  );
  await oldAction(page, "load-plan").click();
  await card.waitFor({ state: "visible" });
  await page.evaluate(async () => {
    const tools = window.__mainHost.tools;
    const current = tools.read_video_project({ editor: { view: "project" } });
    await tools.apply_video_edit({
      editor: {
        identity: current.identity,
        label: "改名",
        steps: [{ kind: "operations", operations: [{ type: "project.rename", name: "改过的名字" }] }],
      },
    });
  });
  await card.locator(".conflict").waitFor({ state: "visible" });
  const apply = page.getByRole("button", { name: "应用方案", exact: true });
  assert.equal(await apply.isDisabled(), true);
  const staleBefore = await waitSaved(page);
  await apply.evaluate((button) => {
    button.disabled = false;
    button.click();
  });
  await page.waitForFunction(() => window.__toasts.some((text) => /过期/.test(text)));
  assert.deepEqual(await saved(page), staleBefore, "A stale plan never applies");
  const toasts = await page.evaluate(() => window.__toasts.join("\n"));
  assert.doesNotMatch(toasts, /旧视图/);
});

test("the AI 制作 inspector trims a main clip of a multitrack project the old view cannot fully show", async (t) => {
  const main = (id, start, duration, source) => ({
    ...picture(id, "v1", start, duration),
    timeMap: {
      points: [
        { time: 0, source },
        { time: duration, source: source + duration },
      ],
    },
  });
  const inspectorSeed = {
    ...realMediaSeed,
    id: "inspector-multitrack",
    name: "多轨检查器",
    sequences: [
      {
        ...realMediaSeed.sequences[0],
        frameRate: { numerator: 30, denominator: 1 },
        timelineMode: "magnetic",
        clips: [
          main("main-a", 0, 90 * 8000, 0),
          main("main-b", 90 * 8000, 90 * 8000, 100 * 8000),
          picture("camera-overlay", "v2", 0, 2_400_011),
        ],
      },
    ],
  };
  const page = await openPage(t, { seed: inspectorSeed });
  const before = await saved(page);
  await page.locator('[data-et-clip="main-a"]').click();
  await production(page);
  await page.locator("#trim-out").fill("2");
  await page.getByRole("button", { name: "应用裁剪", exact: true }).click();
  await page.waitForFunction(
    (revision) => window.__mainHost.current().revision > revision,
    before.revision,
  );
  const after = await waitSaved(page);
  const clips = Object.fromEntries(after.sequences[0].clips.map((clip) => [clip.id, clip]));
  assert.equal(clips["main-a"].duration, 60 * 8000);
  assert.equal(clips["main-b"].start, 60 * 8000, "The magnetic main track closes the gap");
  assert.deepEqual(
    clips["camera-overlay"],
    before.sequences[0].clips.find((clip) => clip.id === "camera-overlay"),
  );
  await returnEditor(page);
  await clickEditorAction(page, "undo");
  assert.deepEqual((await waitSaved(page)).sequences, before.sequences);
});

/** A saved automatic run that is waiting on its agent: the request token the agent was given. */
const automaticRun = (projectId, mode) => ({
  "video-studio-production": [
    {
      revision: 1,
      updatedAt: 1,
      label: "制作任务进度",
      data: {
        schemaVersion: 1,
        bindings: {},
        auto: {
          projectId,
          runId: `run-${mode}`,
          prompt: "把这段实拍做成成片",
          mode,
          phase: "agent",
          attempts: 1,
          startedAt: 1,
          requestToken: `request-${mode}`,
          taskId: `auto-task-${mode}`,
          message: "正在制作",
        },
      },
    },
  ],
});
const renameStep = (name) => [
  { kind: "operations", operations: [{ type: "project.rename", name }] },
];
async function editorEdit(page, editor) {
  return page.evaluate(async (editor) => {
    const tools = window.__mainHost.tools;
    const identity = tools.read_video_project({ editor: { view: "project" } }).identity;
    try {
      return { result: await tools.apply_video_edit({ editor: { identity, ...editor } }) };
    } catch (error) {
      return { error: error.message };
    }
  }, editor);
}

test("automatic production edits real multitrack footage through the editor with its request grant", async (t) => {
  const autoSeed = { ...realMediaSeed, id: "auto-real-media", name: "自动实拍" };
  const page = await openPage(t, { seed: autoSeed, automatic: true });
  await production(page);
  await page.locator("#ai-prompt").fill("把这段实拍做成一分钟成片");
  await page.getByRole("button", { name: "开始全流程制作", exact: true }).click();
  await page.waitForFunction(() => window.__mainHost.tools.read_video_project().requestToken);
  const start = await page.evaluate(() => window.__autoHost.starts[0]);
  assert.equal(start.skill, "video-studio:video-workflow");
  assert.ok(start.skills.includes("video-studio:editor-v2"), JSON.stringify(start.skills));
  assert.match(start.prompt, /editor\.grant/);
  assert.match(start.prompt, /render_video_project/);

  const read = await page.evaluate(() => {
    const tools = window.__mainHost.tools;
    return {
      legacy: tools.read_video_project(),
      editor: tools.read_video_project({ editor: { view: "project" } }).identity,
    };
  });
  assert.equal(read.legacy.legacyView.sequenceId, "main");
  assert.equal(read.legacy.legacyView.timelineComplete, false);
  assert.equal(read.legacy.legacyView.renderSafe, false);
  assert.ok(read.legacy.legacyView.restrictionCount >= 3);
  assert.ok(
    read.legacy.legacyView.restrictions.some(
      (item) => item.clipId === "camera-overlay" && item.excluded,
    ),
  );
  assert.deepEqual(read.legacy.editorIdentity, read.editor);
  const token = read.legacy.requestToken,
    grant = { projectId: autoSeed.id, requestToken: token };

  const before = await saved(page);
  const locked = await editorEdit(page, { label: "无授权", steps: renameStep("不应保存") });
  assert.match(locked.error, /自动制作正在处理/);
  for (const stale of [
    { ...grant, requestToken: "an-old-request" },
    { ...grant, projectId: "another-project" },
  ]) {
    const rejected = await editorEdit(page, {
      label: "过期授权",
      steps: renameStep("不应保存"),
      grant: stale,
    });
    assert.match(rejected.error, /不属于当前自动制作请求/);
  }
  assert.deepEqual(await saved(page), before, "Rejected edits never save");

  const granted = await editorEdit(page, {
    label: "自动去掉画中画",
    steps: [{ kind: "remove", sequenceId: "main", clipIds: ["camera-overlay"] }],
    grant,
  });
  assert.equal(granted.error, undefined);
  assert.equal(granted.result.applied, true);
  const edited = await waitSaved(page);
  assert.equal(edited.revision, before.revision + 1);
  const ids = (doc) => doc.sequences[0].clips.map((clip) => clip.id);
  assert.deepEqual(ids(edited), ["camera-main", "existing-caption"]);

  // The general editor stays locked for manual work during the run.
  await returnEditor(page);
  await page.locator('[data-add-asset="camera"]').click();
  await page.waitForFunction(() =>
    /自动制作正在处理/.test(document.querySelector("#toast")?.textContent ?? ""),
  );
  assert.deepEqual(await saved(page), edited);

  // Old-format automatic edits on real footage go through the translator, not the old view.
  const legacy = await page.evaluate(async () => {
    const tools = window.__mainHost.tools;
    const current = tools.read_video_project();
    try {
      return {
        result: await tools.apply_video_edit({
          projectId: current.project.id,
          requestToken: current.requestToken,
          baseRevision: current.project.revision,
          title: "删掉主画面",
          operations: [{ type: "remove", clipId: "camera-main" }],
        }),
      };
    } catch (error) {
      return { error: error.message };
    }
  });
  assert.equal(legacy.error, undefined);
  assert.equal(legacy.result.applied, true);
  const removed = await waitSaved(page);
  assert.deepEqual(ids(removed), ["existing-caption"]);
  assert.equal(removed.revision, edited.revision + 1);
});

test("automatic initialization never opens editor edits, even with its own grant", async (t) => {
  const autoSeed = { ...realMediaSeed, id: "auto-init-media", name: "初始化实拍" };
  const page = await openPage(t, {
    seed: autoSeed,
    automatic: true,
    records: automaticRun(autoSeed.id, "initialize"),
  });
  await page.waitForFunction(
    () => window.__mainHost.tools.read_video_project().requestToken === "request-initialize",
  );
  const before = await saved(page);
  const rejected = await editorEdit(page, {
    label: "初始化改名",
    steps: renameStep("不应保存"),
    grant: { projectId: autoSeed.id, requestToken: "request-initialize" },
  });
  assert.match(rejected.error, /初始化/);
  assert.deepEqual(await saved(page), before);
});

test("an automatic draft on real footage points old-format edits to the granted editor branch", async (t) => {
  const autoSeed = { ...realMediaSeed, id: "auto-draft-media", name: "草稿实拍" };
  const page = await openPage(t, {
    seed: autoSeed,
    automatic: true,
    records: automaticRun(autoSeed.id, "draft"),
  });
  await page.waitForFunction(
    () => window.__mainHost.tools.read_video_project().requestToken === "request-draft",
  );
  const before = await saved(page);
  const legacy = await page.evaluate(async () => {
    const tools = window.__mainHost.tools;
    const current = tools.read_video_project();
    try {
      await tools.apply_video_edit({
        projectId: current.project.id,
        requestToken: current.requestToken,
        baseRevision: current.project.revision,
        title: "草稿去掉主画面",
        operations: [{ type: "remove", clipId: "camera-main" }],
      });
    } catch (error) {
      return error.message;
    }
  });
  assert.match(legacy, /editor 分支/);
  assert.match(legacy, /grant/);
  assert.deepEqual(await saved(page), before);
  const granted = await editorEdit(page, {
    label: "草稿去掉画中画",
    steps: [{ kind: "remove", sequenceId: "main", clipIds: ["camera-overlay"] }],
    grant: { projectId: autoSeed.id, requestToken: "request-draft" },
  });
  assert.equal(granted.error, undefined);
  assert.equal((await waitSaved(page)).revision, before.revision + 1);
});
