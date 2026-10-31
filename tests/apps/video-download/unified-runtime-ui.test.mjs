import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../", import.meta.url));
// During parallel integration the application may be served from the task's
// integration checkout; normal repository checks use this checkout's own app.
const appDirectory = resolve(
  process.env.VIDEO_DOWNLOAD_UI_APP_DIRECTORY || resolve(root, "apps/video-download/app"),
);
const chatId = "12345678-1234-4567-8901-123456789abc";
const hostId = "12345678-1234-4567-8901-123456789def";
const videoUrl = "https://www.youtube.com/watch?v=shared-fixture";
let server, browser, baseUrl;

before(async () => {
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const path = resolve(appDirectory, `.${pathname.replace(/\/$/, "/index.html")}`);
    if (!path.startsWith(appDirectory + sep)) return response.writeHead(403).end();
    try {
      const body = await readFile(path);
      response
        .writeHead(200, {
          "Content-Type":
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".mjs": "text/javascript",
              ".css": "text/css",
              ".png": "image/png",
            }[extname(path)] || "application/octet-stream",
        })
        .end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
});

async function openPanel(t, { width = 1100, height = 1000, denyNode = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    if (
      route
        .request()
        .url()
        .startsWith(baseUrl + "/")
    )
      return route.continue();
    errors.push(`Unexpected external request: ${route.request().url()}`);
    return route.abort();
  });
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "The real panel must not throw or contact external services");
  });
  await page.addInitScript(
    ({ chatId, hostId, videoUrl, denyNode }) => {
      const handlers = {},
        processes = new Map();
      let nextProcess = 0,
        nextJob = 0;
      const originalInterval = window.setInterval.bind(window);
      // Exercise normal polling while keeping this offline integration gate short.
      window.setInterval = (callback, delay, ...args) =>
        originalInterval(callback, delay === 5000 ? 300 : delay, ...args);
      window.__calls = [];
      window.__denyNode = denyNode;
      window.__serviceCalls = [];
      window.__environmentCalls = [];
      window.__tools = {};
      window.__jobs = JSON.parse(localStorage.getItem("fixture.shared.jobs") || "{}");
      window.__queue = JSON.parse(
        localStorage.getItem("fixture.shared.queue") ||
          '{"revision":0,"paused":false,"maxConcurrent":2,"active":0}',
      );
      window.__hostJobs = JSON.parse(localStorage.getItem("fixture.host.jobs") || "{}");
      window.__hostQueue = { revision: 0, paused: false, maxConcurrent: 2 };
      window.__cookies = [];
      window.__storage = JSON.parse(localStorage.getItem("fixture.host.storage") || "{}");
      window.__files = {};
      window.__fileStatus = "present";
      window.__lostSubmit = false;
      window.__hideJobsReads = 0;
      window.__holdList = false;
      const persist = () => {
        localStorage.setItem("fixture.shared.jobs", JSON.stringify(window.__jobs));
        localStorage.setItem("fixture.shared.queue", JSON.stringify(window.__queue));
        localStorage.setItem("fixture.host.jobs", JSON.stringify(window.__hostJobs));
        localStorage.setItem("fixture.host.storage", JSON.stringify(window.__storage));
      };
      window.__chatJob = (overrides = {}) => ({
        id: chatId,
        status: "running",
        attempt: 1,
        source: "chat",
        url: videoUrl,
        title: "Chat fixture video",
        configuration: { format: "1080" },
        outputDirectory: "/fixture/project/downloads",
        createdAt: 100,
        updatedAt: 200,
        progress: { stage: "download", fraction: 0.42, message: "正在下载聊天视频。" },
        files: [],
        ...overrides,
      });
      window.__addChatJob = (overrides) => {
        window.__jobs[chatId] = window.__chatJob(overrides);
        persist();
      };
      window.__emit = (name, payload) => {
        for (const handler of handlers[name] || []) handler(structuredClone(payload));
      };
      const emitProcess = (id, event, payload) => {
        const record = processes.get(id);
        record.events.push({
          sequence: record.events.length + 1,
          event,
          payload: { processId: id, ...payload },
        });
        if (event === "process.exit") {
          record.status = "exited";
          record.code = payload.code;
        }
        window.__emit(event, { processId: id, ...payload });
      };
      const finish = (id, result, code = 0) => {
        emitProcess(id, "process.output", {
          stream: "stdout",
          text: typeof result === "string" ? result : JSON.stringify(result),
        });
        emitProcess(id, "process.exit", { code });
      };
      const envelope = (result) => ({
        format: "mimi-download.service",
        schemaVersion: 1,
        ok: true,
        result,
      });
      const service = (input) => {
        window.__serviceCalls.push(structuredClone(input));
        if (input.action === "list") {
          const jobs = Object.values(window.__jobs).filter((record) => !record.archivedAt);
          const result = {
            jobs: window.__hideJobsReads-- > 0 ? [] : jobs,
            truncated: false,
            queue: window.__queue,
          };
          return envelope(result);
        }
        if (input.action === "queue") return envelope(window.__queue);
        if (input.action === "configure") {
          assertQueueRevision(input.expectedRevision);
          window.__queue = {
            ...window.__queue,
            revision: input.expectedRevision + 1,
            paused: input.paused,
            maxConcurrent: input.maxConcurrent,
          };
          persist();
          return envelope(window.__queue);
        }
        if (input.action === "submit") {
          const existing = Object.values(window.__jobs).find(
            (record) => record.requestKey === input.requestKey,
          );
          if (existing) return envelope(existing);
          const id = `00000000-0000-4000-8000-${String(++nextJob).padStart(12, "0")}`;
          const record = {
            ...window.__chatJob(),
            id,
            source: input.source,
            title: input.title || "Panel fixture video",
            url: input.request.url,
            configuration: input.request.configuration,
            requestKey: input.requestKey,
            outputDirectory: input.request.outputDirectory || "/fixture/project/downloads",
            status: input.start === false ? "pending" : "queued",
            progress: { fraction: 0, message: "等待后台下载。" },
          };
          window.__jobs[id] = record;
          persist();
          return envelope(record);
        }
        const record = window.__jobs[input.id];
        if (!record) throw new Error("Unknown shared task");
        if (["retry", "start"].includes(input.action) && input.expectedAttempt !== record.attempt)
          throw new Error("Attempt conflict");
        if (input.action === "cancel") record.cancelRequestedAt = Date.now();
        else if (input.action === "retry") {
          record.attempt++;
          record.status = "queued";
          record.files = [];
          delete record.finishedAt;
          delete record.cancelRequestedAt;
        } else if (input.action === "start") record.status = "queued";
        else if (input.action === "check") {
          record.files = record.files.map((file) => ({
            ...file,
            status: "present",
            modifiedAt: 1000,
          }));
          record.checkedAt = Date.now();
        } else if (input.action === "archive") record.archivedAt = Date.now();
        else throw new Error(`Unexpected service action: ${input.action}`);
        record.updatedAt = Date.now();
        persist();
        return envelope(record);
      };
      function assertQueueRevision(revision) {
        if (revision !== window.__queue.revision) throw new Error("Queue revision conflict");
      }
      const methods = [
        "process.resolveEntry",
        "process.find",
        "storage.get",
        "storage.set",
        "tasks.find",
        "credentials.cookies.listForTask",
        "credentials.cookies.list",
        "resources.capture",
        "resources.open",
      ];
      window.codeshellPanel = {
        async getContext() {
          return {
            apiVersion: 14,
            cwd: "/fixture/project",
            host: "fixture",
            appId: "video-download",
            sessionId: "fixture-session",
            theme: "light",
            availableMethods: methods,
            projectScope: {
              version: 1,
              environmentId: "fixture-host",
              projectId: "fixture-project",
              rootId: "fixture-root",
            },
            capabilities: {
              tasks: {
                directoryBookmarks: true,
                queueControl: true,
                maxConcurrent: 4,
                cookieCredentials: true,
              },
            },
          };
        },
        on(name, handler) {
          (handlers[name] ||= []).push(handler);
          return () => {};
        },
        registerTool(name, handler) {
          window.__tools[name] = handler;
          return () => {};
        },
        async call(method, args = {}) {
          window.__calls.push({ method, args: structuredClone(args) });
          if (method === "agent.task.models") return { models: [], defaultModel: "" };
          if (method === "agent.task.list") return [];
          if (method === "storage.get") return structuredClone(window.__storage[args.key] || null);
          if (method === "storage.set") {
            window.__storage[args.key] = structuredClone(args.value);
            persist();
            return true;
          }
          if (method === "filesystem.getKnownDirectory") {
            if (args.name !== "project") throw new Error("Unreviewed directory");
            return {
              handle: "project-grant",
              name: "Project",
              path: "/fixture/project",
              bookmark: "11111111-1111-4111-8111-111111111111",
            };
          }
          if (method === "filesystem.pickDirectory") throw new Error("Unexpected directory picker");
          if (method === "filesystem.openDirectory") return { opened: true };
          if (method.startsWith("credentials.cookies.list"))
            return { accounts: structuredClone(window.__cookies) };
          if (method === "process.find")
            return {
              available: true,
              handle: `executable-${args.name}`,
              path: `/fixture/bin/${args.name}`,
            };
          if (method === "process.resolveEntry") {
            if (
              !["download-service", "download-environment", "download-library"].includes(args.name)
            )
              throw new Error("Unreviewed native entry");
            return { handle: `entry-${args.name}` };
          }
          if (method === "process.spawn") {
            if (window.__denyNode)
              throw Object.assign(new Error("User denied running node"), {
                code: "OPERATION_FAILED",
              });
            if (!args.entryHandle || args.stdin !== "pipe")
              throw new Error("Unexpected direct process execution");
            const processId = `helper-${++nextProcess}`;
            processes.set(processId, {
              input: "",
              args: structuredClone(args),
              events: [],
              status: "running",
              code: null,
            });
            return { processId };
          }
          if (method === "process.write") {
            processes.get(args.processId).input += args.text;
            return { written: args.text.length };
          }
          if (method === "process.end") {
            const record = processes.get(args.processId),
              input = JSON.parse(record.input);
            if (record.args.entryHandle === "entry-download-service") {
              if (input.action === "list" && window.__holdList) {
                window.__holdList = false;
                window.__releaseList = () => {
                  delete window.__releaseList;
                  finish(args.processId, service(input));
                };
                return { ended: true };
              }
              const result = service(input);
              if (input.action === "submit" && window.__lostSubmit) {
                window.__lostSubmit = false;
                finish(args.processId, "lost receipt");
              } else finish(args.processId, result);
            } else if (record.args.entryHandle === "entry-download-environment") {
              window.__environmentCalls.push(input);
              finish(args.processId, {
                format: "mimi-download.environment",
                schemaVersion: 1,
                ok: true,
                result: {
                  cached: true,
                  checkedAt: "2026-10-15T08:00:00.000Z",
                  ready: true,
                  dependencies: {
                    "yt-dlp": window.__environmentFailure
                      ? { available: false, version: null, error: window.__environmentFailure }
                      : {
                          available: true,
                          version: "2026.09.17",
                          path: "/fixture/bin/yt-dlp",
                        },
                    ffmpeg: { available: true, version: "8.1.1", path: "/fixture/bin/ffmpeg" },
                  },
                  ...(input.includeLatest
                    ? { latest: { version: "2026.09.17", cached: true } }
                    : {}),
                },
              });
            } else {
              if (!Array.isArray(input.files)) throw new Error("Invalid library request");
              finish(args.processId, {
                files: input.files.map((file) => ({
                  ...file,
                  bytes: file.bytes || 123,
                  modifiedAt: window.__fileStatus === "changed" ? 1001 : file.modifiedAt || 1000,
                  status: window.__fileStatus,
                })),
              });
            }
            return { ended: true };
          }
          if (method === "process.get") {
            const record = processes.get(args.processId);
            const events = record.events.filter(
              (event) => event.sequence > (args.afterSequence || 0),
            );
            return {
              found: true,
              processId: args.processId,
              status: record.status,
              code: record.code,
              events,
              hasMore: false,
              truncated: false,
              sequence: record.events.length,
            };
          }
          if (method === "process.cancel")
            throw new Error("The view must never cancel shared workers");
          if (method === "tasks.queue.get") return structuredClone(window.__hostQueue);
          if (method === "tasks.queue.set") {
            window.__hostQueue = {
              revision: args.expectedRevision + 1,
              paused: args.paused,
              maxConcurrent: args.maxConcurrent,
            };
            return { saved: true, queue: structuredClone(window.__hostQueue) };
          }
          if (method === "tasks.find")
            return structuredClone(
              Object.values(window.__hostJobs).find(
                (record) => record.requestKey === args.requestKey,
              ) || null,
            );
          if (method === "tasks.list")
            return structuredClone(
              Object.values(window.__hostJobs).slice(args.offset, args.offset + args.limit),
            );
          if (method === "tasks.get") return structuredClone(window.__hostJobs[args.id]);
          if (method === "tasks.start") {
            const record = {
              id: hostId,
              entry: { name: args.entry },
              requestKey: args.requestKey,
              input: structuredClone(args.input),
              status: "queued",
              sequence: 1,
            };
            window.__hostJobs[hostId] = record;
            persist();
            return structuredClone(record);
          }
          if (method === "tasks.cancel") {
            window.__hostJobs[args.id].status = "cancelled";
            window.__hostJobs[args.id].sequence++;
            persist();
            return structuredClone(window.__hostJobs[args.id]);
          }
          if (method === "resources.capture") return { asset: { id: `asset-${"a".repeat(64)}` } };
          if (method === "resources.open") return { opened: true };
          throw new Error(`Unexpected Host call: ${method}`);
        },
      };
    },
    { chatId, hostId, videoUrl, denyNode },
  );
  await page.goto(baseUrl);
  if (denyNode)
    await page.waitForFunction(
      () => document.querySelector("#shared-refresh")?.textContent === "手动重试",
    );
  else await ready(page);
  return page;
}

async function ready(page) {
  await page.waitForFunction(
    () =>
      window.__tools.get_video_download_context &&
      document.querySelector("#installed-ytdlp-version")?.textContent === "2026.09.17" &&
      !document.querySelector("#refresh-versions").disabled &&
      !document.querySelector("#shared-queue-controls").hidden,
  );
}
async function addDownload(page, { saveOnly = false } = {}) {
  await page.locator('[data-tab="download"]').click();
  await page.locator("#url-input").fill(videoUrl);
  await page.locator(saveOnly ? "#enqueue-button" : "#download-button").click();
}
const sharedCalls = (page, action) =>
  page.evaluate(
    (action) => window.__serviceCalls.filter((input) => input.action === action),
    action,
  );
const hostCalls = (page, method) =>
  page.evaluate((method) => window.__calls.filter((call) => call.method === method), method);

test("a timed-out version check is distinct from a missing tool and refresh can recover", async (t) => {
  const page = await openPanel(t);
  await page.locator("#environment-details > summary").click();
  for (const [failure, status, setup] of [
    ["timeout", "下载器检查超时", /yt-dlp 检查超时.*刷新环境/],
    ["not-found", "需要安装", /缺少 yt-dlp/],
  ]) {
    await page.evaluate((failure) => {
      window.__environmentFailure = failure;
    }, failure);
    await page.locator("#refresh-versions").click();
    await page.waitForFunction(
      (status) => document.querySelector("#environment-status").textContent === status,
      status,
    );
    assert.match(await page.locator("#setup-status").textContent(), setup);
    if (failure === "timeout") {
      assert.equal(await page.locator("#installed-ytdlp-version").textContent(), "检查超时");
      assert.doesNotMatch(await page.locator("#setup-status").textContent(), /缺少|未安装/);
    }
  }
  await page.evaluate(() => {
    window.__environmentFailure = "";
  });
  await page.locator("#refresh-versions").click();
  await ready(page);
  assert.equal(await page.locator("#environment-status").textContent(), "✓ 最新稳定版");
  assert.ok(
    await page.evaluate(() =>
      window.__environmentCalls.some((input) => input.action === "refresh"),
    ),
  );
});

for (const width of [390, 1280])
  test(`Chat tasks appear automatically in the shared task list and history at ${width}px`, async (t) => {
    const page = await openPanel(t, { width });
    await page.evaluate(() => window.__addChatJob());
    await page.locator('[data-tab="task"]').click();
    const row = page.locator(`[data-task-id="cli:${chatId}"]`);
    await row.waitFor();
    assert.equal(await page.locator("#task-title").textContent(), "Chat fixture video");
    assert.match(await row.innerText(), /Chat fixture video.*42%/s);
    await mkdir(resolve(root, "artifacts/video-download/unified-runtime"), { recursive: true });
    await page.screenshot({
      path: resolve(root, `artifacts/video-download/unified-runtime/tasks-${width}.png`),
      fullPage: true,
    });
    await row.locator('[data-task-action="open"]').click();
    assert.equal(await page.locator("#task-title").textContent(), "Chat fixture video");
    assert.match(await page.locator("#task-status").textContent(), /下载/);
    await page.evaluate(() =>
      window.__addChatJob({
        status: "completed",
        finishedAt: 300,
        progress: { fraction: 1, message: "下载完成。" },
        files: [{ path: "/fixture/project/downloads/chat.mp4", bytes: 123, status: "present" }],
      }),
    );
    await page.locator('[data-tab="history"]').click();
    const history = page.locator(`.history-item[data-history-id="cli:${chatId}"]`);
    await history.waitFor();
    assert.match(await history.textContent(), /聊天/);
    assert.equal(await page.locator("#cli-jobs").count(), 0);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.equal((await hostCalls(page, "tasks.start")).length, 0);
    await page.screenshot({
      path: resolve(root, `artifacts/video-download/unified-runtime/history-${width}.png`),
      fullPage: true,
    });
  });

test("panel public downloads and save-only drafts use the same service store without Host task admission", async (t) => {
  const page = await openPanel(t);
  await addDownload(page, { saveOnly: true });
  await page.waitForFunction(() =>
    Object.values(window.__jobs).some((job) => job.status === "pending"),
  );
  const [submitted] = await sharedCalls(page, "submit");
  assert.equal(submitted.start, false);
  assert.equal(submitted.source, "panel");
  assert.equal((await hostCalls(page, "tasks.start")).length, 0);
  assert.equal(
    await page.evaluate(() => window.__storage["video-download.library.v2"]?.queue.length || 0),
    0,
  );
  await page.locator('[data-tab="task"]').click();
  await page.locator('[data-task-action="start"]').click();
  await page.waitForFunction(() =>
    Object.values(window.__jobs).some((job) => job.status === "queued"),
  );
  const [started] = await sharedCalls(page, "start");
  assert.equal(started.expectedAttempt, 1);
  await page.reload();
  await ready(page);
  assert.equal(await page.locator(".task-overview-item").count(), 1);
  assert.equal(
    (await sharedCalls(page, "submit")).length,
    0,
    "reopen observes existing work without admitting it again",
  );
  assert.equal(
    await page.evaluate(() => window.__environmentCalls.every((input) => input.action === "get")),
    true,
  );
});

test("cancel waits for worker truth and retry/check/archive target the shared record", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => window.__addChatJob());
  await page.locator('[data-tab="task"]').click();
  const row = page.locator(`[data-task-id="cli:${chatId}"]`);
  await row.locator('[data-task-action="cancel"]').click();
  await page.waitForFunction(() => window.__jobs[Object.keys(window.__jobs)[0]].cancelRequestedAt);
  assert.equal(await row.getAttribute("data-state"), "running");
  assert.match(
    await row.locator(".task-overview-status").textContent(),
    /正在取消.*等待进程退出/,
    "an acknowledged cancel request must be visible while worker exit is still unconfirmed",
  );
  assert.equal(await row.locator('[data-task-action="cancel"]').isDisabled(), true);
  const queuedRow = page.locator(`[data-queue-id="cli:${chatId}"].queue-item`);
  assert.equal(await queuedRow.locator('[data-queue-action="cancel"]').isDisabled(), true);
  assert.equal((await hostCalls(page, "tasks.cancel")).length, 0);
  await page.evaluate(() => window.__addChatJob({ status: "cancelled", finishedAt: 300 }));
  await page.locator('[data-tab="history"]').click();
  const history = page.locator(`.history-item[data-history-id="cli:${chatId}"]`);
  await history.waitFor();
  assert.equal(
    await row.count(),
    0,
    "cancelled CLI work moves out of active tasks and into history",
  );
  await history.locator('[data-history-shortcut="retry"]').click();
  await page.waitForFunction(() => window.__jobs[Object.keys(window.__jobs)[0]].attempt === 2);
  await page.locator("#page-task").waitFor({ state: "visible" });
  await row.waitFor();
  assert.equal(await row.getAttribute("data-state"), "queued");
  assert.deepEqual((await sharedCalls(page, "retry"))[0], {
    action: "retry",
    id: chatId,
    expectedAttempt: 1,
  });
  await page.evaluate(() =>
    window.__addChatJob({
      status: "completed",
      attempt: 2,
      finishedAt: 400,
      files: [{ path: "/fixture/project/downloads/chat.mp4", bytes: 123 }],
    }),
  );
  await page.locator('[data-tab="history"]').click();
  await history.waitFor();
  assert.equal(
    await row.count(),
    0,
    "completed CLI work stays in history until explicitly archived",
  );
  await history.locator(".history-menu summary").click();
  await history.locator('[data-history-action="check"]').click();
  await page.waitForFunction(() => window.__serviceCalls.some((input) => input.action === "check"));
  await history.locator(".history-menu summary").click();
  await history.locator('[data-history-action="delete"]').click();
  await history.waitFor({ state: "detached" });
  assert.equal((await sharedCalls(page, "archive"))[0].id, chatId);
  assert.equal(
    await page.evaluate(() => window.__jobs[Object.keys(window.__jobs)[0]].files.length),
    1,
  );
  await page.reload();
  await ready(page);
  assert.equal(
    await page.locator(".history-item").count(),
    0,
    "archived records do not reappear on scanning or reload",
  );
});

test("Chat can cancel a shared task by ID without selecting its details", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => window.__addChatJob());
  await page.locator(`[data-task-id="cli:${chatId}"]`).waitFor({ state: "attached" });
  const result = await page.evaluate(async (id) => {
    try {
      return await window.__tools.cancel_video_download({ queueId: `cli:${id}` });
    } catch (error) {
      return {
        error: error.message,
        context: await window.__tools.get_video_download_context(),
        jobs: window.__jobs,
      };
    }
  }, chatId);
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.queueId, `cli:${chatId}`);
  assert.equal((await sharedCalls(page, "cancel"))[0].id, chatId);
  assert.equal((await hostCalls(page, "tasks.cancel")).length, 0);
});

test("a lost submission reply retains its correlation key until the caller can confirm the accepted task", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__lostSubmit = true;
    window.__hideJobsReads = 1000;
  });
  await addDownload(page);
  await page.waitForFunction(() =>
    document.querySelector("#form-error").textContent.includes("核对"),
  );
  assert.equal((await sharedCalls(page, "submit")).length, 1);
  await page.locator("#download-button").click();
  await page.waitForFunction(
    () => window.__serviceCalls.filter((input) => input.action === "submit").length === 2,
  );
  await page.evaluate(() => {
    window.__hideJobsReads = 0;
  });
  const calls = await sharedCalls(page, "submit");
  assert.equal(
    calls[0].requestKey,
    calls[1].requestKey,
    "an uncertain accepted request must not acquire a new admission key",
  );
  assert.equal(await page.evaluate(() => Object.keys(window.__jobs).length), 1);
  assert.equal((await hostCalls(page, "tasks.start")).length, 0);
});

test("shared history opens only a checked project-relative resource and retains its page preview cache", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() =>
    window.__addChatJob({
      status: "completed",
      finishedAt: 300,
      files: [{ path: "/fixture/project/downloads/chat.mp4", bytes: 123, status: "present" }],
    }),
  );
  await page.locator('[data-tab="history"]').click();
  const history = page.locator(`.history-item[data-history-id="cli:${chatId}"]`);
  await history.locator('[data-history-shortcut="play"]').click();
  await page.waitForFunction(() => window.__calls.some((call) => call.method === "resources.open"));
  const [capture] = await hostCalls(page, "resources.capture");
  assert.deepEqual(capture.args, {
    directoryHandle: "project-grant",
    path: "downloads/chat.mp4",
    expectedBytes: 123,
  });
  await new Promise((done) => setTimeout(done, 180));
  await history.locator('[data-history-shortcut="play"]').click();
  await page.waitForFunction(
    () => window.__calls.filter((call) => call.method === "resources.open").length === 2,
  );
  assert.equal((await hostCalls(page, "resources.capture")).length, 1);
  assert.equal(
    (await hostCalls(page, "process.spawn")).every((call) => call.args.entryHandle),
    true,
  );
});

test("a changed CLI file drops its cached preview and cannot open until it passes a fresh check", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() =>
    window.__addChatJob({
      status: "completed",
      finishedAt: 300,
      files: [{ path: "/fixture/project/downloads/chat.mp4", bytes: 123, status: "present" }],
    }),
  );
  await page.locator('[data-tab="history"]').click();
  const history = page.locator(`.history-item[data-history-id="cli:${chatId}"]`);
  await history.locator('[data-history-shortcut="play"]').click();
  await page.waitForFunction(
    () => window.__calls.filter((call) => call.method === "resources.open").length === 1,
  );
  await page.evaluate(() => {
    window.__fileStatus = "changed";
  });
  await history.locator('[data-history-shortcut="play"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#history-action-status").textContent.includes("变化"),
  );
  assert.equal((await hostCalls(page, "resources.open")).length, 1);
  assert.equal((await hostCalls(page, "resources.capture")).length, 1);
  await page.evaluate(() => {
    window.__fileStatus = "present";
  });
  if (!(await history.locator(".history-files").evaluate((node) => node.open)))
    await history.locator(".history-row-heading").click();
  await history.locator('[data-history-action="open"]').click();
  await page.waitForFunction(
    () => window.__calls.filter((call) => call.method === "resources.open").length === 2,
  );
  assert.equal(
    (await hostCalls(page, "resources.capture")).length,
    2,
    "a changed file cannot reuse the earlier asset reference",
  );
});

test("polling preserves an open history menu and its keyboard focus", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() =>
    window.__addChatJob({
      status: "completed",
      finishedAt: 300,
      files: [{ path: "/fixture/project/downloads/chat.mp4", bytes: 123, status: "present" }],
    }),
  );
  await page.locator('[data-tab="history"]').click();
  const history = page.locator(`.history-item[data-history-id="cli:${chatId}"]`);
  await history.locator(".history-menu summary").click();
  await history.locator('[data-history-action="delete"]').focus();
  const reads = (await sharedCalls(page, "list")).length;
  await page.waitForFunction(
    (reads) => window.__serviceCalls.filter((input) => input.action === "list").length >= reads + 2,
    reads,
  );
  assert.equal(await history.locator(".history-menu").evaluate((node) => node.open), true);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.historyAction), "delete");
  await page.keyboard.press("Escape");
  assert.equal(await history.locator(".history-menu").evaluate((node) => node.open), false);
  assert.equal(
    await page.evaluate(() => document.activeElement.matches(".history-menu > summary")),
    true,
  );
});

test("Cookie downloads retain the authorized Host task channel alongside shared public records", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__cookies = [
      { id: "youtube-account", label: "Fixture YouTube", revision: "a".repeat(64), cookieCount: 4 },
    ];
    window.__addChatJob();
  });
  await page.locator("#url-input").fill(videoUrl);
  await page.locator("#download-options > summary").click();
  await page.locator("#cookie-refresh").click();
  await page.locator("#cookie-select").selectOption("youtube-account");
  await page.locator("#download-button").click();
  await page.waitForFunction(() => window.__calls.some((call) => call.method === "tasks.start"));
  const [start] = await hostCalls(page, "tasks.start");
  assert.equal(start.args.input.request.useSavedLogin, true);
  assert.equal(start.args.input.cookieArgument.credentialId, "youtube-account");
  assert.equal(start.args.input.cookieArgument.revision, "a".repeat(64));
  assert.equal((await sharedCalls(page, "submit")).length, 0);
  await page.locator('[data-tab="task"]').click();
  assert.equal(await page.locator(".task-overview-item").count(), 2);
});

test("shared queue changes from another caller refresh controls and never alter the Host queue", async (t) => {
  const page = await openPanel(t);
  await page.locator('[data-tab="task"]').click();
  await page.evaluate(() => {
    window.__queue = { revision: 5, paused: true, maxConcurrent: 4, active: 0 };
  });
  await page.waitForFunction(() => document.querySelector("#shared-concurrency").value === "4");
  assert.equal(await page.locator("#shared-queue-toggle").textContent(), "继续队列");
  await page.locator("#shared-queue-toggle").click();
  await page.waitForFunction(() => window.__queue.paused === false);
  assert.equal((await sharedCalls(page, "configure"))[0].expectedRevision, 5);
  assert.equal((await hostCalls(page, "tasks.queue.set")).length, 0);
});

test("closing the view leaves an observed shared worker running without cancellation", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => window.__addChatJob());
  await page.waitForFunction(() => document.querySelectorAll(".task-overview-item").length === 1);
  const before = await page.evaluate(() => window.__serviceCalls.length);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await new Promise((done) => setTimeout(done, 180));
  assert.equal(
    await page.evaluate(() => window.__jobs[Object.keys(window.__jobs)[0]].status),
    "running",
  );
  assert.equal((await sharedCalls(page, "cancel")).length, 0);
  assert.equal((await hostCalls(page, "tasks.cancel")).length, 0);
  assert.equal((await hostCalls(page, "process.cancel")).length, 0);
  assert.equal(await page.evaluate(() => window.__serviceCalls.length), before);
});

test("a late service read after project invalidation never publishes another project's tasks", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__holdList = true;
  });
  await page.locator('[data-tab="task"]').click();
  await page.locator("#shared-refresh").click();
  await page.waitForFunction(() => window.__releaseList);
  await page.evaluate(() => {
    window.__emit("context.changed", { cwd: "/fixture/other-project" });
    window.__addChatJob();
    window.__releaseList();
  });
  await page.locator("#project-binding-notice").waitFor();
  await new Promise((done) => setTimeout(done, 220));
  assert.equal(await page.locator(".task-overview-item").count(), 0);
  assert.equal((await sharedCalls(page, "submit")).length, 0);
  assert.equal((await hostCalls(page, "tasks.start")).length, 0);
});

test("polling preserves a focused active-task action in the download sidebar", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => window.__addChatJob());
  const row = page.locator(`.queue-item[data-queue-id="cli:${chatId}"]`);
  const cancel = row.locator('[data-queue-action="cancel"]');
  await cancel.waitFor();
  await cancel.focus();
  await cancel.evaluate((node) => {
    window.__focusedSidebarAction = node;
  });
  const reads = (await sharedCalls(page, "list")).length;
  await page.waitForFunction(
    (reads) => window.__serviceCalls.filter((input) => input.action === "list").length >= reads + 2,
    reads,
  );
  assert.equal(
    await cancel.evaluate((node) => node === window.__focusedSidebarAction),
    true,
    "incoming progress must reuse the keyboard target instead of rebuilding the active queue row",
  );
  assert.equal(
    await cancel.evaluate((node) => node === document.activeElement),
    true,
    "polling must leave the user's focused action in place",
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    window.__serviceCalls.some((input) => input.action === "cancel"),
  );
  assert.equal((await sharedCalls(page, "cancel")).length, 1);
});

for (const width of [390, 760, 1280])
  test(`download defaults keep the primary action in the first viewport at ${width}px`, async (t) => {
    const page = await openPanel(t, { width, height: 900 });
    assert.equal(await page.locator("#download-options").evaluate((node) => node.open), false);
    assert.equal(await page.locator("#queue-settings").evaluate((node) => node.open), false);
    assert.match(
      await page.locator("#download-options-summary").innerText(),
      /播放列表.*字幕.*账号/,
    );
    await page.locator("#url-input").fill(videoUrl);
    const primary = page.locator("#download-button");
    assert.equal(await primary.isEnabled(), true);
    const box = await primary.boundingBox();
    assert.ok(
      box && box.y >= 0 && box.y + box.height <= 900,
      "a valid link's main action must fit the initial recording viewport",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.equal(await page.locator("#destination-name").isVisible(), true);
    assert.equal(await page.locator("#quality-select").isVisible(), true);
  });

test("enabled optional settings remain visible in their collapsed summary", async (t) => {
  const page = await openPanel(t);
  const options = page.locator("#download-options");
  await options.locator(":scope > summary").click();
  await page.locator("#playlist-toggle").locator("..").click();
  await page.locator("#subtitle-toggle").locator("..").click();
  await options.locator(":scope > summary").click();
  assert.equal(await options.evaluate((node) => node.open), false);
  assert.match(await page.locator("#download-options-summary").innerText(), /播放列表/);
  assert.match(await page.locator("#download-options-summary").innerText(), /字幕/);
  await page.locator("#url-input").fill(videoUrl);
  await page.locator("#download-button").click();
  await page.waitForFunction(() =>
    window.__serviceCalls.some((input) => input.action === "submit"),
  );
  const [submitted] = await sharedCalls(page, "submit");
  assert.equal(submitted.request.configuration.playlist, true);
  assert.equal(submitted.request.configuration.subtitles, true);
});

for (const width of [390, 1280])
  test(`task navigation shows each task once and keeps its Chat source visible at ${width}px`, async (t) => {
    const page = await openPanel(t, { width, height: 900 });
    await page.evaluate(() => window.__addChatJob());
    await page.locator("#queue-jump").click();
    await page.locator("#page-task").waitFor({ state: "visible" });
    const row = page.locator(`.task-overview-item[data-task-id="cli:${chatId}"]`);
    await row.waitFor();
    assert.equal(await page.locator("#queue-list").isVisible(), false);
    assert.equal(await page.locator("#shared-queue-controls").isVisible(), true);
    const source = row.locator(".task-overview-source");
    assert.equal(await source.isVisible(), true);
    assert.match(await source.innerText(), /聊天/);
    await page.evaluate(() =>
      window.__addChatJob({
        status: "completed",
        finishedAt: 300,
        files: [{ path: "/fixture/project/downloads/chat.mp4", bytes: 123, status: "present" }],
      }),
    );
    await page.locator('[data-tab="history"]').click();
    const historySource = page.locator(
      `.history-item[data-history-id="cli:${chatId}"] .history-source-label`,
    );
    await historySource.waitFor();
    assert.equal(await historySource.isVisible(), true);
    assert.match(await historySource.innerText(), /聊天/);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  });

test("an empty Tasks page offers an actionable start without an idle detail panel", async (t) => {
  const page = await openPanel(t);
  await page.locator("#queue-jump").click();
  await page.locator("#page-task").waitFor({ state: "visible" });
  assert.equal(await page.locator("#task-card").isVisible(), false);
  assert.equal(await page.locator("#task-overview-empty").isVisible(), true);
  await page.locator("#task-empty-add").click();
  assert.equal(await page.locator("#page-download").isVisible(), true);
  assert.equal(
    await page.locator("#url-input").evaluate((node) => node === document.activeElement),
    true,
  );
});

test("startup reuses queue state from the initial shared list", async (t) => {
  const page = await openPanel(t);
  assert.ok((await sharedCalls(page, "list")).length >= 1);
  assert.equal(
    (await sharedCalls(page, "queue")).length,
    0,
    "opening the panel must not spawn a redundant queue helper",
  );
});

test("declining startup Node confirmation pauses all automatic shared checks until manual retry", async (t) => {
  const page = await openPanel(t, { width: 390, height: 844, denyNode: true });
  await page.waitForTimeout(1000); // More than three actual polling intervals in this fixture.
  assert.equal((await hostCalls(page, "process.spawn")).length, 1);
  assert.deepEqual(await page.evaluate(() => window.__environmentCalls), []);
  assert.match(await page.locator("#shared-service-status").innerText(), /自动刷新已暂停/);
  await page.locator('[data-tab="task"]').click();
  await page.locator("#shared-refresh").click(); // A second explicit refusal stays paused.
  await page.waitForFunction(
    () =>
      document.querySelector("#shared-refresh").textContent === "手动重试" &&
      !document.querySelector("#shared-refresh").disabled,
  );
  await page.waitForTimeout(700);
  assert.equal((await hostCalls(page, "process.spawn")).length, 2);
  await page.evaluate(() => {
    window.__denyNode = false;
    window.__addChatJob({ status: "pending" });
    window.__queue.paused = true;
  });
  await page.locator("#shared-refresh").click();
  await ready(page);
  const reads = (await sharedCalls(page, "list")).length;
  await page.waitForFunction(
    (count) => window.__serviceCalls.filter((entry) => entry.action === "list").length > count,
    reads,
  );
  assert((await page.evaluate(() => window.__environmentCalls.length)) >= 1);
  assert.equal(await page.evaluate(() => window.__queue.paused), true);
  assert.equal(await page.evaluate((id) => window.__jobs[id].status, chatId), "pending");
  assert.deepEqual(await sharedCalls(page, "start"), []);
  assert.deepEqual(await sharedCalls(page, "configure"), []);
  assert.deepEqual(await sharedCalls(page, "submit"), []);
  assert.deepEqual(await hostCalls(page, "tasks.start"), []);
  assert.deepEqual(await hostCalls(page, "process.cancel"), []);

  // A later refusal preserves already displayed records, even across timer ticks.
  await page.evaluate(() => {
    window.__denyNode = true;
  });
  await page.waitForFunction(
    () => document.querySelector("#shared-refresh").textContent === "手动重试",
  );
  const stopped = (await hostCalls(page, "process.spawn")).length;
  await page.waitForTimeout(700);
  assert.equal((await hostCalls(page, "process.spawn")).length, stopped);
  assert.match(await page.locator("#task-overview-list").innerText(), /Chat fixture video/);
  await page.reload(); // The pause is per panel instance, never a persisted permission.
  await page.waitForFunction(
    () => document.querySelector("#shared-refresh").textContent === "手动重试",
  );
  assert.equal((await hostCalls(page, "process.spawn")).length, 1);
  assert.equal(await page.evaluate((id) => window.__jobs[id].status, chatId), "pending");
});
