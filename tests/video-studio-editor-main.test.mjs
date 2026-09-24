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
import { fileURLToPath } from "node:url";
import { buildProject } from "../scripts/build-panels.mjs";
import { discoverProjects, selectProjects } from "../scripts/panel-projects.mjs";
import { installGenericMediaTaskMock } from "./helpers/video-studio-generic-task.mjs";
import { build as esbuild } from "esbuild";

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
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 960 },
  });
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
        getContext: async () => {
          // Tests can hold context discovery to keep a media import in progress.
          if (window.__holdContext)
            await new Promise((resolve) => (window.__releaseContext = resolve));
          return {
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
          };
        },
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
          if (options.exportHistory && method === "tasks.list")
            return options.exportHistory
              .slice(args.offset, args.offset + args.limit)
              .map(({ id, entry, status, createdAt }) => ({ id, entry, status, createdAt }));
          if (options.exportHistory && method === "tasks.get") {
            const found = options.exportHistory.find((job) => job.id === args.id);
            if (!found) throw Error("任务已不存在");
            return structuredClone(found);
          }
          if (method === "tasks.list" && (options.nativeTasks || options.fullNativeAccess))
            return [];
          if (method === "tasks.start" && options.holdNativeStart)
            return new Promise(() => {});
          // The real Host copies each original inside tasks.start(stage-resources) and only
          // then returns a job; model a copy that is still running after a fresh status read.
          if (options.holdNativeCopy && method === "tasks.start") {
            if (args.input.request.action !== "stage-status") return new Promise(() => {});
            const job = {
              id: `status-${calls.length}`,
              // "status" keeps the fresh status read running, as a slow hash of saved originals.
              status: options.holdNativeCopy === "status" ? "running" : "succeeded",
              attempt: 1,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              // A staging job's progress must never be shown as the preview percentage.
              progress: { stage: "prepare-video", fraction: 0.42 },
              result: { result: { resourceIds: [], chunks: [] } },
            };
            (window.__nativeJobs ??= {})[job.id] = job;
            return structuredClone(job);
          }
          if (options.holdNativeCopy && method === "tasks.get")
            return structuredClone(window.__nativeJobs[args.id]);
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
  const picture = sequenceBefore.clips.find((clip) => clip.id === "picture");
  assert.ok(inserted.every((clip) => clip.kind === "media" && clip.assetId === "demo"));
  assert.deepEqual(
    inserted.map((clip) => [clip.trackId, clip.start]),
    [
      [picture.trackId, picture.start + picture.duration],
      [picture.trackId, picture.start + picture.duration + inserted[0].duration],
    ],
    "Repeated material + continues the main picture track instead of covering it",
  );
  assert.equal(sequence.tracks.length, sequenceBefore.tracks.length, "No new track");
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

test("the 任务 page lists video exports beside production tasks and opens their record", async (t) => {
  const exportJob = (id, status, extra = {}) => ({
    id,
    status,
    attempt: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    entry: { name: "editor-runtime", sha256: "e".repeat(64) },
    input: {
      request: { action: "render", sequenceId: "sequence-main", profile: { name: "自定义导出" } },
    },
    ...extra,
  });
  const page = await openPage(t, {
    nativeTasks: true,
    exportHistory: [
      exportJob("export-running", "running", { progress: { fraction: 0.4, message: "正在合成画面" } }),
      exportJob("export-failed", "failed", { error: { message: "磁盘空间不足" } }),
    ],
  });
  await production(page, "jobs");
  const exports = page.locator("#studio .export-job-list");
  await exports.locator("[data-export-job-id]").first().waitFor();
  const running = exports.locator('[data-export-job-id="export-running"]');
  assert.match(await running.textContent(), /视频导出 · 自定义导出/);
  assert.match(await running.textContent(), /进行中/);
  assert.equal(await running.locator("progress").getAttribute("value"), "40");
  assert.match(
    await exports.locator('[data-export-job-id="export-failed"]').textContent(),
    /失败.*磁盘空间不足/s,
  );
  assert.doesNotMatch(await exports.textContent(), /sequence-main/);
  await running.getByRole("button", { name: "在导出记录中查看" }).click();
  const record = page.getByRole("dialog", { name: "导出任务", exact: true });
  assert.equal(await record.isVisible(), true);
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

async function openCopyWait(t, holdNativeCopy) {
  const videoPath = resolve(directory, "copy-wait.mp4");
  await promisify(execFile)("ffmpeg", [
    ...["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi"],
    ...["-i", "color=c=green:s=160x90:r=30:d=1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p"],
    videoPath,
  ]);
  const video = await readFile(videoPath),
    videoId = `asset-${createHash("sha256").update(video).digest("hex")}`;
  const page = await openPage(t, {
    seed: {
      ...seed,
      id: "copy-wait",
      assets: [
        {
          id: "copied-video",
          name: "大原片.mp4",
          kind: "video",
          durationFrames: 30,
          width: 160,
          height: 90,
          mediaId: videoId,
          mimeType: "video/mp4",
          size: video.length,
        },
      ],
      clips: [
        { id: "copied", assetId: "copied-video", inFrame: 0, outFrame: 30, startFrame: 0, volume: 1 },
      ],
      captions: [],
    },
    fullNativeAccess: true,
    holdNativeCopy,
    mediaMetadata: {
      [videoId]: {
        id: videoId,
        sha256: videoId.slice(6),
        bytes: video.length,
        mimeType: "video/mp4",
        name: "大原片.mp4",
        createdAt: 1,
      },
    },
    mediaResources: { [videoId]: { mimeType: "video/mp4", bytes: video } },
  });
  await page.locator('[data-ew-action="play"]').click();
  return page;
}
test("a running staging job's progress is never shown as the fast-preview percentage", async (t) => {
  const page = await openCopyWait(t, "status");
  await page.waitForFunction(() =>
    window.__mainHost.calls.filter((call) => call.method === "tasks.get").length >= 2,
  );
  const status = await page.locator("[data-ew-preview-error]").textContent();
  assert.match(status, /正在读取和校验视频素材/);
  assert.doesNotMatch(status, /快速预览|42%/);
  await page.locator('[data-ew-action="play"]').click();
});
test("Play explains the Host's copy of new originals instead of claiming preview frames are being made", async (t) => {
  const page = await openCopyWait(t, true);
  await page.waitForFunction(() =>
    window.__mainHost.calls.some(
      (call) =>
        call.method === "tasks.start" && call.args.input.request.action === "stage-resources",
    ),
  );
  await settle(page);
  const status = await page.locator("[data-ew-preview-error]").textContent();
  assert.match(status, /正在把原始素材交给本地任务 · 已就绪 0\/1/);
  assert.match(status, /首次使用的素材需要完整复制一次原片/);
  assert.doesNotMatch(status, /快速预览|42%/);
  await page.locator('[data-ew-action="play"]').click();
  assert.equal(await page.locator("[data-ew-preview-error]").isVisible(), false);
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
/** Five tracks with clips: two pictures, captions and two sound tracks, as a docked panel shows them. */
const denseSeed = {
  ...realMediaSeed,
  id: "dense-layout",
  name: "一个名字很长、在窄面板里也要保持可见的多轨工程",
  assets: [
    ...realMediaSeed.assets,
    { id: "room", name: "现场声.wav", kind: "audio", duration: 10_000_123 },
    { id: "music", name: "音乐.wav", kind: "audio", duration: 10_000_123 },
  ],
  sequences: [
    {
      ...realMediaSeed.sequences[0],
      tracks: [
        ...realMediaSeed.sequences[0].tracks,
        track("a1", "audio", "现场声"),
        track("a2", "audio", "音乐"),
      ],
      clips: [
        ...realMediaSeed.sequences[0].clips,
        { ...picture("room-clip", "a1", 0, 2_400_011), assetId: "room" },
        { ...picture("music-clip", "a2", 0, 2_400_011), assetId: "music" },
      ],
    },
  ],
};
const rectOf = (page, selector) =>
  page.locator(selector).first().evaluate((element) => element.getBoundingClientRect().toJSON());
const inside = (inner, outer, slack = 0.5) =>
  inner.top >= outer.top - slack &&
  inner.bottom <= outer.bottom + slack &&
  inner.left >= outer.left - slack &&
  inner.right <= outer.right + slack;
const overlaps = (a, b) =>
  a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
const pageOverflow = (page) =>
  page.evaluate(() => ({
    width: document.documentElement.scrollWidth - innerWidth,
    height: document.documentElement.scrollHeight - innerHeight,
  }));

test("a docked 1280×900 workspace shows five tracks, reachable add-track buttons, the first media card and marked dividers", async (t) => {
  const page = await openPage(t, { seed: denseSeed, viewport: { width: 1280, height: 900 } });
  const viewport = { top: 0, left: 0, right: 1280, bottom: 900 };
  const body = await rectOf(page, "#editor-workspace .et-body");
  const heads = await page
    .locator("#editor-workspace [data-track-head]")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
  assert.equal(heads.length, 5);
  assert.equal(
    heads.filter((head) => inside(head, body) && inside(head, viewport)).length,
    5,
    `Every track row fits the default timeline: ${JSON.stringify({ body, heads })}`,
  );
  const add = page.getByRole("group", { name: "添加轨道", exact: true }).locator("button");
  assert.deepEqual(await add.allTextContents(), ["新建画面轨", "新建声音轨", "新建文字轨"]);
  for (const button of await add.all()) {
    const box = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { ...rect.toJSON(), hit: element.contains(hit) };
    });
    assert.ok(inside(box, body) && inside(box, viewport) && box.hit, JSON.stringify(box));
  }
  // More tracks than fit still leave the add buttons in the sticky track corner.
  for (let index = 0; index < 3; index++) {
    await page.locator('[data-et-action="track-audio"]').click();
    await waitSaved(page);
  }
  await page.locator("#editor-workspace .et-body").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await settle(page);
  const scrolled = await page
    .locator('[data-et-action="track-text"]')
    .evaluate((element) => element.getBoundingClientRect().toJSON());
  assert.ok(inside(scrolled, await rectOf(page, "#editor-workspace .et-body")), JSON.stringify(scrolled));

  const library = await rectOf(page, "#studio .library-panel");
  const card = await rectOf(page, "#studio .library-panel .asset-card");
  assert.ok(inside(card, library), `The first media card shows without scrolling: ${JSON.stringify({ card, library })}`);

  for (const [pane, cursor] of [
    ["library", "col-resize"],
    ["inspector", "col-resize"],
    ["timeline", "row-resize"],
  ]) {
    const divider = page.locator(`[data-resize-pane="${pane}"]`);
    const look = await divider.evaluate((element) => {
      const grip = getComputedStyle(element, "::before");
      return {
        cursor: getComputedStyle(element).cursor,
        grip: grip.backgroundColor,
        width: parseFloat(grip.width),
        height: parseFloat(grip.height),
        title: element.title,
      };
    });
    assert.equal(look.cursor, cursor);
    assert.notEqual(look.grip, "rgba(0, 0, 0, 0)", `${pane} divider shows a grip at rest`);
    assert.ok(look.width >= 3 && look.height >= 3, JSON.stringify(look));
    assert.match(look.title, /双击恢复默认/);
    await divider.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    assert.equal(await divider.evaluate((element) => element.matches(":focus-visible")), true);
    assert.notEqual(
      await divider.evaluate((element) => getComputedStyle(element).outlineStyle),
      "none",
      `${pane} divider shows a keyboard focus ring`,
    );
  }
  assert.deepEqual(await pageOverflow(page), { width: 0, height: 0 });
});

for (const width of [600, 800])
test(`a narrow ${width}×900 panel keeps preview and timeline on the first screen and switches library and inspector`, async (t) => {
  const page = await openPage(t, { seed: denseSeed, viewport: { width, height: 900 } });
  const screen = { top: 0, left: 0, right: width, bottom: 900 };
  const viewer = await rectOf(page, "#editor-workspace .ew-viewer");
  const timeline = await rectOf(page, "#editor-workspace [data-ew-timeline]");
  const status = await rectOf(page, "#studio .statusbar");
  const player = await rectOf(page, "#editor-workspace .ew-player");
  const tools = await rectOf(page, "#editor-workspace .ew-tools");
  assert.ok(inside(viewer, screen) && viewer.height >= 200, JSON.stringify(viewer));
  assert.ok(inside(timeline, screen) && timeline.height >= 220, JSON.stringify(timeline));
  assert.ok(!overlaps(status, timeline), `Status bar covers the timeline: ${JSON.stringify({ status, timeline })}`);
  assert.ok(!overlaps(player, timeline) && !overlaps(player, tools), JSON.stringify({ player, tools }));
  const clipBox = await rectOf(page, '[data-et-clip="camera-main"]');
  assert.ok(clipBox.top >= timeline.top && clipBox.bottom <= screen.bottom, JSON.stringify(clipBox));
  const name = await rectOf(page, "#project-name");
  assert.ok(inside(name, screen) && name.width >= 80, `Project name stays visible: ${JSON.stringify(name)}`);
  assert.equal(await page.locator("#studio .library-panel").isVisible(), false);
  assert.equal(await page.locator("#editor-workspace .ew-properties").isVisible(), false);
  assert.deepEqual(await pageOverflow(page), { width: 0, height: 0 });

  await page.locator('[data-et-clip="camera-main"]').click();
  const inspectorToggle = page.getByRole("button", { name: "属性", exact: true });
  await inspectorToggle.click();
  assert.equal(await inspectorToggle.getAttribute("aria-pressed"), "true");
  const inspector = await rectOf(page, "#editor-workspace .ew-properties");
  assert.ok(inside(inspector, screen) && inspector.height >= 200, JSON.stringify(inspector));
  assert.ok(!overlaps(inspector, await rectOf(page, "#editor-workspace [data-ew-timeline]")));
  const saved = await property(page, "水平位置（%）", 20);
  assert.equal(saved.sequences[0].clips.find((clip) => clip.id === "camera-main").transform.x, 0.2);

  await page.getByRole("button", { name: "素材", exact: true }).first().click();
  assert.equal(await page.locator("#studio .library-panel").isVisible(), true);
  assert.equal(await page.locator("#editor-workspace .ew-properties").isVisible(), false);
  assert.ok(inside(await rectOf(page, "#studio .library-panel .asset-card"), screen));
  // Folder import notes open from a visible toggle, not only a hover tooltip.
  const help = page.locator("#studio .library-panel .folder-help");
  assert.equal(await help.locator("p").first().isVisible(), false);
  await help.locator("summary").click();
  assert.equal(await help.locator("p").first().isVisible(), true);
  assert.ok(inside(await rectOf(page, "#studio .library-panel .folder-help p"), screen));
  await help.locator("summary").click();
  assert.equal(await help.locator("p").first().isVisible(), false);
  await page.locator("#studio .narrow-switch").getByRole("button", { name: "画面", exact: true }).click();
  assert.equal(await page.locator("#editor-workspace .ew-viewer").isVisible(), true);
  assert.equal(await page.locator("#studio .library-panel").isVisible(), false);

  // A rail page opens its controls in the side panel.
  await page.locator('#studio .rail [data-tab="transcript"]').click();
  assert.equal(await page.locator("#studio .library-panel").isVisible(), true);
  assert.equal(await page.locator("#editor-workspace [data-ew-timeline]").isVisible(), true);
  await returnEditor(page);

  for (const [size, height] of [
    [360, 800],
    [900, 900],
    [width, 900],
  ]) {
    await page.setViewportSize({ width: size, height });
    await settle(page);
    assert.deepEqual(await pageOverflow(page), { width: 0, height: 0 }, `${size}px`);
    assert.equal(await page.locator("#studio .narrow-switch").isVisible(), true, `${size}px`);
    const narrowTimeline = await rectOf(page, "#editor-workspace [data-ew-timeline]");
    assert.ok(narrowTimeline.top < height && narrowTimeline.bottom <= height + 0.5, `${size}px`);
    assert.ok(!overlaps(await rectOf(page, "#studio .statusbar"), narrowTimeline), `${size}px`);
    assert.ok(inside(await rectOf(page, "#editor-workspace .ew-viewer"), { top: 0, left: 0, right: size, bottom: height }));
    if (size === 360) {
      const column = await rectOf(page, "#editor-workspace .et-track-heads");
      assert.ok(
        column.width <= narrowTimeline.width * 0.4,
        `Track names take ${column.width}px of a ${narrowTimeline.width}px timeline`,
      );
      // Switches and order stay reachable in the slim track column.
      for (const name of ["锁定画面", "隐藏画面", "静音画面", "上移画面"]) {
        const control = await page.getByRole("button", { name, exact: true }).evaluate((element) => element.getBoundingClientRect().toJSON());
        assert.ok(inside(control, column), `${name}: ${JSON.stringify(control)}`);
      }
    }
  }
  // The full three-column workspace returns once it fits.
  await page.setViewportSize({ width: 1024, height: 900 });
  await settle(page);
  assert.equal(await page.locator("#studio .narrow-switch").isVisible(), false);
  for (const selector of ["#studio .library-panel", "#editor-workspace .ew-viewer", "#editor-workspace .ew-properties"])
    assert.equal(await page.locator(selector).isVisible(), true, selector);
  assert.deepEqual(await pageOverflow(page), { width: 0, height: 0 });
});

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
  // The production controller is ready once the media service has restored its saved tasks.
  await page.waitForFunction(() =>
    // It reads its saved task bindings once the media service reports itself available.
    window.__mainHost.calls.some(
      (call) => call.method === "media.document.get" && call.args.key === "video-studio-production",
    ),
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
  assert.equal(added[0].label, "保留结尾", "The placed clip carries the cut's name");
  // 粗剪 stays open for the next cut; 查看成片 shows the new clip selected, playhead after the run.
  const end = at + take - 30 * 8000;
  const notice = page.locator("#studio .roughcut-placed");
  await notice.waitFor({ state: "visible" });
  assert.match(await notice.textContent(), /已按列表顺序加入 1 个视频片段/);
  assert.equal(await page.locator("#roughcut-source").isVisible(), true, "Still on 粗剪");
  assert.equal(
    await page.locator('#studio .rail [data-tab="roughcut"]').getAttribute("aria-pressed"),
    "true",
  );
  await notice.getByRole("button", { name: "查看成片", exact: true }).click();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  assert.equal(
    await page.locator('#studio .rail [data-tab="media"]').getAttribute("aria-pressed"),
    "true",
  );
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
  assert.equal(second.label, "第二段");
  for (const a of twice.clips)
    for (const b of twice.clips)
      if (a.id < b.id && a.trackId === b.trackId)
        assert.ok(a.start + a.duration <= b.start || b.start + b.duration <= a.start);
  await returnEditor(page);
  await clickEditorAction(page, "undo");
  const undone = await waitSaved(page);
  assert.deepEqual(undone.sequences, placed.sequences, "One undo removes one placement");
  assert.equal(undone.production.roughCuts.length, 2, "Undo keeps the saved marks");
  // The placement result is the 粗剪 notice above; nothing technical or failed was announced.
  const toasts = await page.evaluate(() => window.__toasts.join("\n"));
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

test("real off-frame multitrack footage shows plain wording, its real frame rate and one AI request", async (t) => {
  const page = await openPage(t, { seed: { ...realMediaSeed, id: "plain-copy-real-media" } });
  const internal = /旧视图|新版时间线|浏览器演示|旧流程|Host\b/;
  for (const tab of ["media", "roughcut", "recording", "spoken", "transcript", "voiceover", "ai", "jobs"]) {
    await production(page, tab);
    await settle(page);
    const text = await page.locator("body").innerText();
    assert.doesNotMatch(text, internal, `The ${tab} page`);
    // Eyebrows, badges and media types read in Chinese; format names (MP4, SRT) may stay.
    assert.doesNotMatch(
      text,
      /\b(?:SOURCE|PREVIEW|A LITTLE HELP|RECORD|VOICEOVER|PRODUCTION|VIDEO|AUDIO|IMAGE|READY TO SHARE|CREATE A SCENE)\b/,
      `The ${tab} page`,
    );
  }
  // Connected without persistent media storage: one request button, and the rule draft stays.
  await production(page, "ai");
  assert.equal(await page.locator('#studio [data-action="ask-ai"]').count(), 1);
  assert.equal(
    await page.getByRole("button", { name: "创建规则草案", exact: true }).isVisible(),
    true,
  );
  // The header reads the active sequence's frame rate, not the old fixed 30 fps.
  await returnEditor(page);
  await page.locator('[data-asset="camera"] .asset-thumbnail').click();
  const heading = page.locator('#studio .viewer-panel[aria-label="原素材预览"] .panel-heading');
  await heading.waitFor({ state: "visible" });
  assert.match(await heading.innerText(), /29\.97 fps/);
  assert.doesNotMatch(await heading.innerText(), /\b30 fps/);
});

test("the AI 制作 inspector explains clips it cannot adjust instead of failing on click", async (t) => {
  const loud = {
    ...picture("loud-main", "v1", 0, 90 * 8000),
    audio: {
      volume: {
        keyframes: [
          { time: 0, value: 0.4 },
          { time: 90 * 8000, value: 1.4 },
        ],
      },
      pan: 0,
      fadeIn: 0,
      fadeOut: 0,
      pitchSemitones: 0,
      preservePitch: true,
    },
  };
  const inspectorSeed = {
    ...realMediaSeed,
    id: "inspector-reasons",
    name: "检查器说明",
    sequences: [
      {
        ...realMediaSeed.sequences[0],
        frameRate: { numerator: 30, denominator: 1 },
        clips: [loud, picture("camera-main", "v1", 1_234_567, 1_000_123)],
      },
    ],
  };
  const page = await openPage(t, { seed: inspectorSeed });
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => window.__toasts.push(document.querySelector("#toast").textContent)).observe(
      document.querySelector("#toast"),
      { childList: true, characterData: true, subtree: true },
    );
  });
  const before = await saved(page);
  const inspector = page.locator("#studio .inspector");

  // Real footage the old inspector cannot show: the reason instead of an empty prompt.
  await page.locator('[data-et-clip="camera-main"]').click();
  await production(page);
  const notice = inspector.locator("[data-inspector-issue]");
  await notice.waitFor({ state: "visible" });
  assert.match(await notice.innerText(), /包含变速或非整帧时间/);
  assert.equal(await inspector.getByRole("button", { name: "应用裁剪", exact: true }).count(), 0);

  // Volume automation: trimming stays available, the volume slider is disabled with its reason.
  await returnEditor(page);
  await page.locator('[data-et-clip="loud-main"]').click();
  await production(page);
  const volume = page.locator("#clip-volume");
  await volume.waitFor({ state: "visible" });
  assert.equal(await volume.isDisabled(), true);
  assert.match(
    await inspector.locator(".property-section").filter({ has: volume }).innerText(),
    /包含音量自动化或超过 200% 的音量/,
  );
  assert.equal(
    await inspector.getByRole("button", { name: "应用裁剪", exact: true }).isEnabled(),
    true,
  );
  assert.deepEqual(await saved(page), before, "Explaining never edits the project");
  const toasts = await page.evaluate(() => window.__toasts.join("\n"));
  assert.doesNotMatch(toasts, /旧视图|旧流程|新版/);
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

  // The clipboard carries the same grant: copy, then paste as one saved edit.
  const copied = await editorEdit(page, {
    clipboard: { action: "copy", sequenceId: "main", clipIds: ["existing-caption"] },
    grant,
  });
  assert.equal(copied.error, undefined);
  const pasted = await editorEdit(page, {
    clipboard: {
      action: "paste",
      sequenceId: "main",
      clipboardId: copied.result.clipboard.clipboardId,
      at: 3 * T,
    },
    grant,
  });
  assert.equal(pasted.error, undefined);
  assert.equal(pasted.result.addedClipCount, 1);
  const withPaste = await waitSaved(page);
  assert.equal(withPaste.revision, removed.revision + 1);
  assert.equal(withPaste.sequences[0].clips.length, 2);
  assert.equal(
    withPaste.sequences[0].clips.find((clip) => clip.id === pasted.result.addedClipIds[0].clipId)
      .start,
    3 * T,
  );

  // The host cancels the agent task: the run ends and its grant stops working.
  await page.evaluate(() =>
    window.__mainHost.events["agent.task.changed"].forEach((handler) =>
      handler({ id: "auto-task-1", status: "cancelled" }),
    ),
  );
  await page.waitForFunction(() => !window.__mainHost.tools.read_video_project().requestToken);
  const afterCancel = await editorEdit(page, {
    label: "取消后",
    steps: renameStep("不应保存"),
    grant,
  });
  assert.match(afterCancel.error, /不属于当前自动制作请求/);
  assert.deepEqual(await saved(page), withPaste);
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

const narrationScript = "先看拍到的实拍画面。\n再说清楚想表达的事。\n最后留下完整的结尾。";
const reviewSheet = {
  stage: "review",
  brief: "用实拍画面先做草稿，确认后由本人配音。",
  outline: "先看画面，再讲想法，保留完整结尾。",
  sources: [],
  nextSteps: ["用户确认草稿后录音，再按真实转写完成字幕与画面"],
  blockers: [],
};
async function legacyEdit(page, operations, title = "自动制作修改") {
  return page.evaluate(
    async ({ operations, title }) => {
      const tools = window.__mainHost.tools;
      const current = tools.read_video_project();
      try {
        return {
          result: await tools.apply_video_edit({
            projectId: current.project.id,
            requestToken: current.requestToken,
            baseRevision: current.project.revision,
            title,
            operations,
          }),
        };
      } catch (error) {
        return { error: error.message };
      }
    },
    { operations, title },
  );
}
async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() =>
      window.__toasts.push(document.querySelector("#toast").textContent),
    ).observe(document.querySelector("#toast"), {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
}
const draftIds = (doc) => doc.production.narration.draftCaptionIds;

test("an automatic draft on real footage saves the script, temporary captions and review on the editor document", async (t) => {
  const autoSeed = {
    ...realMediaSeed,
    id: "auto-draft-media",
    name: "草稿实拍",
    production: { narration: { phase: "draft", captionBasis: "draft", draftCaptionIds: [] } },
  };
  const page = await openPage(t, {
    seed: autoSeed,
    automatic: true,
    records: automaticRun(autoSeed.id, "draft"),
  });
  await page.waitForFunction(
    () => window.__mainHost.tools.read_video_project().requestToken === "request-draft",
  );
  const before = await saved(page);
  const scripted = await page.evaluate(async (text) => {
    const tools = window.__mainHost.tools;
    const current = tools.read_video_project();
    try {
      return {
        result: await tools.set_video_script({
          projectId: current.project.id,
          requestToken: current.requestToken,
          baseRevision: current.project.revision,
          text,
          finish: false,
        }),
      };
    } catch (error) {
      return { error: error.message };
    }
  }, narrationScript);
  assert.equal(scripted.error, undefined);
  const drafted = await waitSaved(page);
  assert.equal(drafted.revision, before.revision + 1, "Script and drafts are one save");
  assert.equal(drafted.production.script, narrationScript);
  assert.equal(drafted.production.narration.phase, "draft");
  const clips = (doc) => doc.sequences[0].clips;
  const drafts = clips(drafted).filter((clip) => draftIds(drafted).includes(clip.id));
  assert.deepEqual(
    drafts.map((clip) => clip.text),
    narrationScript.split("\n"),
  );
  assert.ok(drafts.every((clip) => clip.id.startsWith("draft-narration-")));
  const end = Math.max(...clips(before).map((clip) => clip.start + clip.duration));
  assert.equal(Math.max(...drafts.map((clip) => clip.start + clip.duration)), end);
  assert.deepEqual(
    clips(drafted).filter((clip) => clip.kind !== "text" || clip.role !== "subtitle"),
    clips(before).filter((clip) => clip.kind !== "text" || clip.role !== "subtitle"),
    "The picture and titles stay exact",
  );

  // An old-format temporary caption with a new ID, and a granted editor subtitle, both join
  // the drafts; old-format picture edits on real footage apply on the editor document.
  const legacy = await legacyEdit(page, [
    {
      type: "caption",
      caption: { id: "draft-narration-9", startFrame: 30, endFrame: 60, text: "补一句临时字幕" },
    },
    { type: "remove", clipId: "camera-main" },
  ]);
  assert.equal(legacy.error, undefined);
  const grant = { projectId: autoSeed.id, requestToken: "request-draft" };
  const granted = await editorEdit(page, {
    label: "草稿说明字幕",
    steps: [
      { kind: "captions", sequenceId: "main", action: { kind: "add", text: "编辑器加的字幕", start: 3 * T, end: 4 * T } },
    ],
    grant,
  });
  assert.equal(granted.error, undefined);
  const extended = await waitSaved(page);
  const added = granted.result.addedClipIds[0].clipId;
  assert.ok(draftIds(extended).includes("draft-narration-9"), JSON.stringify(draftIds(extended)));
  assert.ok(draftIds(extended).includes(added));
  assert.equal(clips(extended).find((clip) => clip.id === "draft-narration-9").start, 30 * 8000);
  assert.equal(clips(extended).some((clip) => clip.id === "camera-main"), false);

  // A storage failure is reported as itself, not as an old-view limitation.
  await page.evaluate(() => window.__mainHost.fail(true));
  const failed = await legacyEdit(page, [{ type: "settings", name: "草稿新名字" }], "草稿改名");
  assert.match(failed.error, /模拟磁盘保存失败/);
  assert.doesNotMatch(failed.error, /editor 分支|旧格式|旧视图/);
  await page.evaluate(() => window.__mainHost.fail(false));

  const completed = await legacyEdit(page, [{ type: "workflow", workflow: reviewSheet }], "提交草稿审阅");
  assert.equal(completed.error, undefined);
  const review = await waitSaved(page);
  assert.equal(review.production.narration.phase, "review");
  assert.equal(review.production.narration.captionBasis, "draft");
  assert.equal(review.production.workflow.stage, "review");
  await page.waitForFunction(() => !window.__mainHost.tools.read_video_project().requestToken);
  assert.equal(
    await page.evaluate(
      () => window.__mainHost.records()["video-studio-production"][0].data.auto.phase,
    ),
    "done",
  );

  // The temporary captions are visible on the 字幕 page, marked as such.
  await page.locator('#studio .rail [data-tab="transcript"]').click();
  const panel = page.locator("#studio .library-panel #caption-panel-host > .editor-captions");
  await panel.waitFor({ state: "visible" });
  for (const id of draftIds(review))
    assert.equal(
      await panel.locator(`[data-caption-id="${id}"] .ec-badge`).textContent(),
      "临时字幕",
      id,
    );
  assert.equal(
    await panel.locator('[data-caption-id="existing-caption"] .ec-badge').count(),
    0,
  );
});

/** The editor narration planners, so a seed is confirmed exactly as the panel would. */
async function editorNarrationModule() {
  const out = await esbuild({
    stdin: {
      contents: [
        'export * from "./apps/video-studio/src/editor/narration-edits.ts";',
        'export { applyEditorOperations } from "./apps/video-studio/src/editor/operations.ts";',
        'export { validateEditorDocument } from "./apps/video-studio/src/editor/validation.ts";',
      ].join("\n"),
      resolveDir: resolve("."),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`
  );
}
const takeId = `asset-${"f".repeat(64)}`;
const takeLength = 6 * T + 777;
const takeAsset = { id: "take", name: "本人录音.wav", kind: "audio", duration: takeLength, resourceId: takeId };
const retakeAsset = { id: "retake", name: "重录口播.wav", kind: "audio", duration: 5 * T + 123 };
function narrationSeed(id, extraClips = []) {
  return {
    ...realMediaSeed,
    id,
    name: "实拍本人口播",
    assets: [...realMediaSeed.assets, takeAsset, retakeAsset],
    sequences: [
      {
        ...realMediaSeed.sequences[0],
        tracks: [...realMediaSeed.sequences[0].tracks, track("a1", "audio", "口播")],
        clips: [...realMediaSeed.sequences[0].clips, ...extraClips],
      },
    ],
    production: {
      script: "旧的草稿文案。",
      narration: { phase: "review", captionBasis: "draft", draftCaptionIds: [] },
    },
  };
}
const takeClip = (id, start) => ({ ...picture(id, "a1", start, takeLength), assetId: "take" });

/** The old-view approval digest, so a seed carries an approval as older versions saved it. */
async function narrationModule() {
  const out = await esbuild({
    entryPoints: [resolve("apps/video-studio/src/narration.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`
  );
}

test("a recorded narration run accepts only granted edits that keep the recording valid", async (t) => {
  const { narrationFingerprint } = await narrationModule();
  const script = "按确认稿录好的口播。";
  const draft = {
    ...seed,
    id: "auto-narration",
    name: "本人口播",
    script,
    assets: [
      ...seed.assets,
      { id: "own-take", name: "本人录音.wav", kind: "audio", durationFrames: 300 },
    ],
    audioClips: [
      { id: "own-take-clip", assetId: "own-take", inFrame: 0, outFrame: 300, startFrame: 0, volume: 1 },
    ],
    narration: { phase: "review", captionBasis: "draft", draftCaptionIds: ["caption"] },
  };
  // Confirmed and recorded as older versions saved it: a digest of the 30 fps view.
  const narrated = {
    ...draft,
    revision: draft.revision + 2,
    narration: {
      phase: "recorded",
      captionBasis: "draft",
      draftCaptionIds: ["caption"],
      approvedScript: script,
      approvedFingerprint: await narrationFingerprint(draft),
      recordingAssetId: "own-take",
    },
  };
  const page = await openPage(t, {
    seed: narrated,
    automatic: true,
    records: automaticRun(narrated.id, "narration"),
  });
  await page.waitForFunction(
    () => window.__mainHost.tools.read_video_project().requestToken === "request-narration",
  );
  const before = await saved(page);
  assert.equal(before.production.narration.phase, "recorded");
  const sequence = before.sequences.find((item) => item.id === before.activeSequenceId);
  const grant = { projectId: narrated.id, requestToken: "request-narration" };
  const resized = await editorEdit(page, {
    label: "改成竖屏",
    steps: [
      {
        kind: "operations",
        operations: [
          {
            type: "sequence.update",
            sequenceId: sequence.id,
            patch: { width: 360, height: 640 },
          },
        ],
      },
    ],
    grant,
  });
  assert.match(resized.error, /已确认的草稿与本人录音失效/);
  assert.deepEqual(await saved(page), before, "The refused edit never saves");
  const picture = sequence.clips.find((clip) => clip.kind === "media" && clip.assetId === "demo");
  const turned = await editorEdit(page, {
    label: "画面微调",
    steps: [
      {
        kind: "operations",
        operations: [
          {
            type: "clip.update",
            sequenceId: sequence.id,
            clipId: picture.id,
            patch: { transform: { ...picture.transform, rotation: 3 } },
          },
        ],
      },
    ],
    grant,
  });
  assert.equal(turned.error, undefined);
  const after = await waitSaved(page);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.production.narration, before.production.narration);
});

test("a recorded narration run on real footage places the take with its grant, aligns real captions and may export", async (t) => {
  const N = await editorNarrationModule();
  const apply = (doc, operations) => N.applyEditorOperations(doc, operations, doc.revision);
  let seedDoc = N.validateEditorDocument(narrationSeed("narration-real-run"));
  seedDoc = apply(seedDoc, N.planNarrationScript(seedDoc, "main", narrationScript));
  seedDoc = apply(seedDoc, await N.planApproveNarration(seedDoc));
  seedDoc = apply(seedDoc, await N.planBindNarrationRecording(seedDoc, "take"));
  const transcript = [
    { start: 0.5, end: 2, text: "先看拍到的实拍画面。" },
    { start: 2.5, end: 4, text: "再说清楚想表达的事。" },
    { start: 4.5, end: 6, text: "最后留下完整的结尾。" },
  ];
  const page = await openPage(t, {
    seed: seedDoc,
    automatic: true,
    records: {
      ...automaticRun(seedDoc.id, "narration"),
      // The take's finished preparation, with its real transcript, as the media service saved it.
      [`video-studio-prepared-${takeId}`]: [
        {
          revision: 1,
          updatedAt: 1,
          label: "素材准备",
          data: { assetId: takeId, transcription: { source: "asr", segments: transcript } },
        },
      ],
    },
  });
  await page
    .waitForFunction(
      () => window.__mainHost.tools.read_video_project().requestToken === "request-narration",
    )
    .catch(async (error) => {
      throw new Error(
        `${error.message}\n${JSON.stringify(
          await page.evaluate(() => window.__mainHost.records()["video-studio-production"][0].data.auto),
        )}`,
      );
    });
  const before = await saved(page);
  assert.equal(before.production.narration.phase, "recorded");
  const grant = { projectId: seedDoc.id, requestToken: "request-narration" };
  const placed = await editorEdit(page, {
    label: "放入本人录音",
    steps: [
      {
        kind: "operations",
        operations: [{ type: "clip.add", sequenceId: "main", clip: takeClip("take-clip", 1_234_567) }],
      },
    ],
    grant,
  });
  assert.equal(placed.error, undefined);
  const checkpoint = await waitSaved(page);
  assert.equal(checkpoint.revision, before.revision + 1);
  const state = checkpoint.production.narration;
  assert.equal(state.phase, "recorded");
  assert.equal(state.approvedFingerprint, before.production.narration.approvedFingerprint);
  assert.match(state.alignmentFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(state.fingerprintBasis, "editor");

  const completed = await legacyEdit(page, [{ type: "workflow", workflow: reviewSheet }], "提交真实对齐");
  assert.equal(completed.error, undefined);
  const aligned = await waitSaved(page);
  assert.equal(aligned.production.narration.phase, "aligned");
  assert.equal(aligned.production.narration.captionBasis, "recording");
  const captions = aligned.sequences[0].clips.filter(
    (clip) => clip.kind === "text" && clip.role === "subtitle",
  );
  const recorded = captions
    .filter((clip) => clip.sourceBinding?.provenance?.assetId === "take")
    .sort((a, b) => a.start - b.start);
  assert.deepEqual(
    recorded.map((clip) => [clip.start, clip.start + clip.duration, clip.text]),
    transcript.map((segment) => [
      1_234_567 + segment.start * T,
      1_234_567 + segment.end * T,
      segment.text,
    ]),
  );
  assert.equal(
    captions.some((clip) => before.production.narration.draftCaptionIds.includes(clip.id)),
    false,
    "Temporary captions are replaced",
  );
  assert.ok(captions.some((clip) => clip.id === "existing-caption"));
  assert.equal(
    aligned.sequences[0].clips.find((clip) => clip.id === "take-clip").duration,
    takeLength,
  );
  const receipt = await page.evaluate(async () => {
    const tools = window.__mainHost.tools;
    const current = tools.read_video_project();
    try {
      return await tools.render_video_project({
        projectId: current.project.id,
        requestToken: current.requestToken,
        baseRevision: current.project.revision,
      });
    } catch (error) {
      return { error: error.message };
    }
  });
  assert.equal(receipt.error, undefined);
  assert.equal(receipt.accepted, true, "The aligned narration may be exported");
});

test("本人口播 panel actions save, confirm, choose and replace a take on real off-frame footage", async (t) => {
  const page = await openPage(t, {
    seed: narrationSeed("narration-real-panel", [takeClip("take-clip", 1_234_567)]),
  });
  await watchToasts(page);
  await production(page, "ai");
  await page.locator("#narration-script").fill(narrationScript);
  await page.locator('[data-action="save-narration-script"]').click();
  await page.waitForFunction(
    (text) => window.__mainHost.current().production?.script === text,
    narrationScript,
  );
  const drafted = await waitSaved(page);
  assert.equal(drafted.production.narration.phase, "review");
  const drafts = drafted.sequences[0].clips.filter((clip) =>
    drafted.production.narration.draftCaptionIds.includes(clip.id),
  );
  assert.deepEqual(
    drafts.map((clip) => clip.text),
    narrationScript.split("\n"),
  );

  await page.locator('[data-action="approve-draft"]').click();
  await page.locator("#recording-script").waitFor();
  assert.equal(await page.locator("#recording-script").inputValue(), narrationScript);
  const approved = await waitSaved(page);
  assert.equal(approved.production.narration.phase, "approved");
  assert.equal(approved.production.narration.fingerprintBasis, "editor");
  assert.match(approved.production.narration.approvedFingerprint, /^[a-f0-9]{64}$/);

  await production(page, "ai");
  await page.locator("#narration-recording-asset").selectOption("take");
  await page.locator('[data-action="bind-narration-recording"]').click();
  await page.waitForFunction(
    () => window.__mainHost.current().production?.narration?.recordingAssetId === "take",
  );
  const bound = await waitSaved(page);
  assert.equal(bound.production.narration.phase, "recorded");

  await page.locator("#narration-recording-asset").selectOption("retake");
  await page.locator('[data-action="bind-narration-recording"]').click();
  await page.waitForFunction(
    () => window.__mainHost.current().production?.narration?.recordingAssetId === "retake",
  );
  const replaced = await waitSaved(page);
  const state = replaced.production.narration;
  assert.equal(state.phase, "recorded");
  assert.equal(state.approvedFingerprint, approved.production.narration.approvedFingerprint);
  assert.match(state.alignmentFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(
    replaced.sequences[0].clips.some((clip) => clip.kind === "media" && clip.assetId === "take"),
    false,
    "The previous take no longer plays under the replacement",
  );
  assert.ok(replaced.assets.some((asset) => asset.id === "take"), "Both takes stay in the library");
  assert.equal(replaced.sequences[0].clips.find((clip) => clip.id === "camera-main").start, 1_234_567);
  const toasts = await page.evaluate(() => window.__toasts.join("\n"));
  assert.doesNotMatch(toasts, /失败|无效|旧视图|重新确认/);
});

test("an old confirmation the editor cannot verify explains itself and returns to review", async (t) => {
  const seed = narrationSeed("narration-old-approval");
  seed.production = {
    script: "旧工程确认过的文案。",
    narration: {
      phase: "approved",
      captionBasis: "draft",
      draftCaptionIds: [],
      approvedScript: "旧工程确认过的文案。",
      approvedFingerprint: "a".repeat(64),
    },
  };
  const page = await openPage(t, { seed });
  await production(page, "ai");
  const issue = page.locator(".narration-approval-issue");
  await issue.waitFor();
  assert.match(await issue.innerText(), /工程已变化，请重新确认文稿/);
  await page.locator('[data-action="return-narration-review"]').click();
  await page.waitForFunction(
    () => window.__mainHost.current().production?.narration?.phase === "review",
  );
  const reviewed = await waitSaved(page);
  assert.equal(reviewed.production.narration.approvedFingerprint, undefined);
  assert.equal(reviewed.production.script, "旧工程确认过的文案。");
  await page.locator('[data-action="approve-draft"]').waitFor();
  assert.equal(await page.locator('[data-action="approve-draft"]').isDisabled(), false);
  assert.equal(await issue.count(), 0);
});

test("the status bar counts the editor sequence's clips apart from its captions, also after reload", async (t) => {
  const page = await openPage(t, { seed: realMediaSeed });
  const counts = async () => ({
    clips: await page.locator("[data-studio-clip-count]").textContent(),
    captions: await page.locator("[data-studio-caption-count]").textContent(),
  });
  assert.deepEqual(await counts(), { clips: "2", captions: "1" });
  await page.reload();
  await page.locator("#editor-workspace").waitFor({ state: "visible" });
  await waitSaved(page);
  assert.deepEqual(await counts(), { clips: "2", captions: "1" });
  await clickEditorAction(page, "rectangle");
  await waitSaved(page);
  await page.waitForFunction(
    () => document.querySelector("[data-studio-clip-count]")?.textContent === "3",
  );
  assert.equal((await counts()).captions, "1");
});

test("one undo and redo set stays visible, and version history does not look like undo", async (t) => {
  const page = await openPage(t);
  const visible = (name) =>
    page.locator(`[data-action="${name}"]:visible, [data-ew-action="${name}"]:visible`).count();
  assert.equal(await visible("undo"), 1);
  assert.equal(await visible("redo"), 1);
  const undoGlyph = await action(page, "undo").locator("svg").innerHTML();
  const versions = oldAction(page, "versions");
  assert.equal(await versions.isVisible(), true);
  assert.notEqual(await versions.locator("svg").innerHTML(), undoGlyph);
  await page.locator('[data-asset="demo"] .asset-thumbnail').click();
  await page.locator('#studio .viewer-panel[aria-label="原素材预览"]').waitFor();
  assert.equal(await visible("undo"), 1, "Source preview keeps only the editor's undo");
  assert.equal(await visible("redo"), 1);
  assert.equal(
    await action(page, "undo").getAttribute("title"),
    "撤销（没有可撤销的操作）",
    "A disabled undo says why",
  );
});

test("新建工程 is labeled, opens at once when safe and asks in the page before leaving unsaved work", async (t) => {
  const page = await openPage(t);
  const create = oldAction(page, "new");
  assert.equal((await create.innerText()).trim(), "新建工程");
  assert.match(await create.getAttribute("title"), /新建工程/);
  const original = await saved(page);
  const dialogs = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.evaluate(() => window.__mainHost.fail(true));
  await page.locator("#project-name").fill("还没保存的名字");
  await page.locator("#project-name").press("Tab");
  await page.waitForFunction(
    () => document.querySelector("#save-state")?.textContent === "保存失败",
  );
  await create.click();
  const confirm = page.locator("#plan-dialog[open]");
  await confirm.waitFor();
  assert.match(await confirm.textContent(), /未保存的修改/);
  assert.equal(
    await page.locator(`#${await confirm.getAttribute("aria-labelledby")}`).textContent(),
    "新建工程？",
  );
  assert.equal(
    await confirm
      .getByRole("button", { name: "取消", exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
    "The safe choice has focus",
  );
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.locator("#plan-dialog[open]").count(), 0);
  assert.equal(await page.locator("#project-name").inputValue(), "还没保存的名字");
  assert.equal((await saved(page)).id, original.id);
  await page.evaluate(() => window.__mainHost.fail(false));
  await create.click();
  await confirm.getByRole("button", { name: "仍然新建", exact: true }).click();
  await page.waitForFunction((id) => window.__mainHost.current().id !== id, original.id);
  const next = await waitSaved(page);
  assert.equal(next.name, "未命名项目");
  assert.equal(await page.locator("#plan-dialog[open]").count(), 0);
  // A saved project with no running work opens the next one without asking.
  await create.click();
  await page.waitForFunction((id) => window.__mainHost.current().id !== id, next.id);
  assert.equal(await page.locator("#plan-dialog[open]").count(), 0);
  assert.deepEqual(dialogs, [], "No browser confirm dialog is used");
});

test("a new project's sequence takes the project name given at creation, existing sequences keep theirs", async (t) => {
  const page = await openPage(t);
  await page.locator("#project-name").fill("已有工程改名");
  await page.locator("#project-name").press("Tab");
  let doc = await waitSaved(page);
  assert.equal(doc.name, "已有工程改名");
  assert.equal(doc.sequences[0].name, "旧工程迁移测试", "An existing sequence keeps its name");
  await oldAction(page, "new").click();
  await page.waitForFunction((id) => window.__mainHost.current().id !== id, doc.id);
  doc = await waitSaved(page);
  assert.equal(doc.sequences[0].name, "未命名项目");
  await page.locator("#project-name").fill("周末探店");
  await page.locator("#project-name").press("Tab");
  await page.waitForFunction(() => window.__mainHost.current().name === "周末探店");
  doc = await waitSaved(page);
  assert.equal(doc.sequences[0].name, "周末探店");
  assert.equal(
    await page.locator("[data-ew-sequence] option:checked").textContent(),
    "周末探店",
  );
  await clickEditorAction(page, "rectangle");
  await waitSaved(page);
  await page.locator("#project-name").fill("加入画面后再改名");
  await page.locator("#project-name").press("Tab");
  await page.waitForFunction(() => window.__mainHost.current().name === "加入画面后再改名");
  doc = await waitSaved(page);
  assert.equal(doc.sequences[0].name, "周末探店", "Once edited, the sequence name is its own");
});

test("leaving a project clears its 口播 analysis and old notices", async (t) => {
  const audio = await readFile(new URL("./fixtures/static-tone.wav", import.meta.url));
  const voiceId = `asset-${createHash("sha256").update(audio).digest("hex")}`;
  const talk = 10 * T + 1234;
  const page = await openPage(t, {
    seed: {
      ...realMediaSeed,
      id: "spoken-leaving",
      name: "离开前的口播",
      assets: [
        ...realMediaSeed.assets,
        { id: "voice", name: "口播.wav", kind: "audio", duration: talk, resourceId: voiceId },
      ],
      sequences: [
        {
          ...realMediaSeed.sequences[0],
          tracks: [...realMediaSeed.sequences[0].tracks, track("a1", "audio", "口播")],
          clips: [
            ...realMediaSeed.sequences[0].clips,
            { ...picture("voice-clip", "a1", 0, talk), assetId: "voice" },
          ],
        },
      ],
    },
    fullNativeAccess: true,
    holdNativeStart: true,
    mediaMetadata: {
      [voiceId]: {
        id: voiceId,
        sha256: voiceId.slice(6),
        bytes: audio.length,
        mimeType: "audio/wav",
        name: "口播.wav",
        createdAt: 1,
      },
    },
    mediaResources: { [voiceId]: { mimeType: "audio/wav", bytes: audio } },
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
  await page.waitForFunction(() =>
    // It reads its saved task bindings once the media service reports itself available.
    window.__mainHost.calls.some(
      (call) => call.method === "media.document.get" && call.args.key === "video-studio-production",
    ),
  );
  const before = await saved(page);
  await page.locator('#studio .rail [data-tab="spoken"]').click();
  const panel = page.locator("#studio .library-panel");
  await panel.getByRole("button", { name: "读取已有结果", exact: true }).click();
  await panel.locator(".spoken-candidate").first().waitFor();
  assert.match(await panel.textContent(), /尚无文稿/);
  await oldAction(page, "new").click();
  await page.waitForFunction((id) => window.__mainHost.current().id !== id, before.id);
  await waitSaved(page);
  await settle(page);
  const text = await panel.textContent();
  assert.doesNotMatch(text, /尚无文稿|工程已更新|长停顿/);
  assert.equal(await panel.locator(".spoken-candidate").count(), 0);

  const toast = page.locator("#toast");
  await page.locator('#studio .rail [data-tab="media"]').click();
  await page.locator('#studio [data-action="demo"]:visible').first().click();
  await page.waitForFunction(() => document.querySelector("#toast.visible")?.textContent);
  const demoId = (await waitSaved(page)).id;
  await oldAction(page, "new").click();
  await page.waitForFunction((id) => window.__mainHost.current().id !== id, demoId);
  assert.equal(await toast.textContent(), "", "A notice about the old project leaves with it");
  assert.equal(await toast.evaluate((node) => node.classList.contains("visible")), false);
  await page.locator('#studio [data-action="demo"]:visible').first().click();
  await page.waitForFunction(() => document.querySelector("#toast.visible")?.textContent);
  await page.waitForFunction(() => !document.querySelector("#toast.visible"), undefined, {
    timeout: 8000,
  });
  await page.waitForFunction(() => document.querySelector("#toast").textContent === "", undefined, {
    timeout: 2000,
  });
});

test("disabled production buttons say why instead of staying silent", async (t) => {
  const page = await openPage(t);
  const reason = (name) =>
    page.locator(`#studio [data-action="${name}"]`).first().evaluate((node) => ({
      disabled: node.disabled || node.getAttribute("aria-disabled") === "true",
      title: node.getAttribute("title") ?? "",
    }));
  const announced = (name) =>
    page.locator(`#studio [data-action="${name}"]`).first().evaluate((node) => ({
      focusable: !node.disabled,
      ariaDisabled: node.getAttribute("aria-disabled"),
      description: document.getElementById(node.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    }));
  await production(page, "ai");
  for (const name of ["ask-draft", "initialize-video"]) {
    const value = await reason(name);
    assert.equal(value.disabled, true, name);
    assert.match(value.title, /CodeShell 桌面/, name);
  }
  const draft = await announced("ask-draft");
  assert.equal(draft.focusable, true);
  assert.equal(draft.ariaDisabled, "true");
  assert.match(draft.description, /CodeShell 桌面/);
  assert.equal((await reason("quick-plan")).disabled, false);
  assert.equal((await reason("quick-plan")).title, "", "An enabled button needs no reason");
  const before = await saved(page);
  await oldAction(page, "new").click();
  await page.waitForFunction((id) => window.__mainHost.current().id !== id, before.id);
  await waitSaved(page);
  assert.deepEqual(await reason("quick-plan"), {
    disabled: true,
    title: "主画面轨上还没有片段，先把素材加入时间轴",
  });
  assert.deepEqual(await reason("export"), {
    disabled: true,
    title: "时间轴上还没有片段，先加入素材再导出",
  });
  assert.deepEqual(await announced("export"), {
    focusable: true,
    ariaDisabled: "true",
    description: "时间轴上还没有片段，先加入素材再导出",
  });
  await oldAction(page, "export").focus();
  await page.keyboard.press("Enter");
  await settle(page);
  assert.equal(await page.locator("dialog[open]").count(), 0, "Unavailable export does nothing");
  assert.equal(await page.locator("#toast.visible").count(), 0);
  await production(page, "spoken");
  for (const name of ["spoken-prepare", "spoken-analyze"]) {
    const value = await reason(name).catch(() => null);
    if (!value) continue;
    assert.equal(value.disabled, true, name);
    assert.match(value.title, /先把口播素材加入时间轴/, name);
  }
  const undo = await reason("spoken-undo");
  if (undo.disabled) assert.equal(undo.title, "没有可撤销的编辑");
});

test("新建工程 waits for an import in progress and offers only 知道了", async (t) => {
  const page = await openPage(t);
  const before = await saved(page);
  await page.evaluate(() => (window.__holdContext = true));
  await page
    .locator("#media-input")
    .setInputFiles(fileURLToPath(new URL("./fixtures/static-tone.wav", import.meta.url)));
  await page.waitForFunction(() => typeof window.__releaseContext === "function");
  await oldAction(page, "new").click();
  const dialog = page.locator("#plan-dialog[open]");
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /素材正在导入/);
  assert.equal(await dialog.getByRole("button", { name: "仍然新建" }).count(), 0);
  const ok = dialog.getByRole("button", { name: "知道了", exact: true });
  assert.equal(await ok.evaluate((node) => node === document.activeElement), true);
  const labelledBy = await dialog.getAttribute("aria-labelledby");
  assert.equal(await page.locator(`#${labelledBy}`).evaluate((node) => node.tagName), "H2");
  await ok.click();
  assert.equal(await page.locator("#plan-dialog[open]").count(), 0);
  assert.equal((await saved(page)).id, before.id);
  await page.evaluate(() => {
    window.__holdContext = false;
    window.__releaseContext();
  });
});
