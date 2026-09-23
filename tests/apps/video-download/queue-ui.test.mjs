import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const appDirectory = resolve(root, "apps/video-download/app");
const artifacts = resolve(root, "artifacts/video-download/queue-ui");
const firstUrl = "https://www.youtube.com/watch?v=queue-first";
const secondUrl = "https://www.youtube.com/watch?v=queue-second";
const thirdUrl = "https://www.youtube.com/watch?v=queue-third";
let browser;
let server;
let baseUrl;

before(async () => {
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const path = resolve(appDirectory, `.${pathname.replace(/\/$/, "/index.html")}`);
    if (!path.startsWith(appDirectory + sep)) return response.writeHead(403).end();
    try {
      const body = await readFile(path);
      response.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".png": "image/png",
          }[extname(path)] || "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

// The actual page and event handlers run unchanged. Only the authorized Host bridge
// is replaced: no yt-dlp process, remote request, credential, or real directory is used.
async function openPanel(t, width = 1280, projectDirectoryError = "", concurrency = 1, ai = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text())) {
      errors.push(message.text());
    }
  });
  await context.route("**/*", (route) => {
    if (
      route
        .request()
        .url()
        .startsWith(baseUrl + "/")
    )
      return route.continue();
    errors.push(`Unexpected network request: ${route.request().url()}`);
    return route.abort();
  });
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "The download panel must not throw or request remote resources");
  });
  await page.addInitScript(
    ({ projectDirectoryError, ai }) => {
      const fixtureUuid = crypto.randomUUID.bind(crypto);
      if (ai.noRandomUuid) Object.defineProperty(crypto, "randomUUID", { value: undefined });
      const handlers = {};
      let nextProcess = 0;
      window.__panelTools = {};
      window.__calls = [];
      window.__downloads = [];
      window.__taskModels = ai.models || { models: [], defaultModel: "" };
      window.__taskModelsError = ai.error || "";
      window.__agentTasks = {};
      window.__holdAnalysisStart = false;
      window.__analysisStartError = "";
      window.__rejectAnalysisCancel = false;
      window.__holdAnalysisCancel = false;
      window.__heldSpawns = {};
      window.__holdNextDownload = false;
      window.__unavailable = new Set(ai.unavailable || []);
      window.__cookieAccounts = [];
      window.__cookieAuthorizationCount = 0;
      window.__denyCookieAuthorization = false;
      window.__rejectCancellation = false;
      window.__holdCancellation = false;
      window.__nextDirectory = {
        handle: "directory-second",
        name: "Second folder",
        path: "/fixture/second",
      };
      window.__emit = (name, payload) => {
        for (const handler of handlers[name] || []) handler(structuredClone(payload));
      };
      window.__hostStorage = {};
      window.__hostStorageRevision = 0;
      const storageSnapshot = (key) =>
        Object.hasOwn(window.__hostStorage, key)
          ? {
              exists: true,
              value: structuredClone(window.__hostStorage[key]),
              revision: "sha256:" + String(window.__hostStorageRevision).padStart(64, "0"),
            }
          : { exists: false, value: null, revision: null };
      if (ai.durable) {
        window.__nativeJobs = JSON.parse(localStorage.getItem("fixture-native-jobs") || "{}");
        window.__nativeQueue = JSON.parse(
          localStorage.getItem("fixture-native-queue") ||
            '{"revision":0,"paused":false,"maxConcurrent":2}',
        );
      }
      window.codeshellPanel = {
        getContext: async () => ({
          apiVersion: 10,
          theme: "light",
          ...(ai.durable
            ? {
                cwd: "/fixture/project",
                availableMethods: [
                  "tasks.find",
                  ...(ai.taskCookies ? ["credentials.cookies.listForTask"] : []),
                  ...(ai.processCookies ? ["credentials.cookies.authorizeProcess"] : []),
                ],
                capabilities: {
                  process: { cookieCredentials: ai.processCookies === true },
                  tasks: {
                    directoryBookmarks: true,
                    queueControl: true,
                    maxConcurrent: 2,
                    cookieCredentials: ai.taskCookies === true,
                  },
                },
              }
            : {}),
          ...(ai.versionedStorage
            ? {
                cwd: "/fixture/project",
                availableMethods: ["storage.getSnapshot", "storage.compareAndSet"],
              }
            : {}),
        }),
        registerTool(name, handler) {
          window.__panelTools[name] = handler;
          return () => {};
        },
        on(name, handler) {
          (handlers[name] ||= []).push(handler);
          return () => {};
        },
        async call(method, args = {}) {
          window.__calls.push({ method, args: structuredClone(args) });
          if (ai.durable && method.startsWith("tasks.")) {
            const persist = () => {
              localStorage.setItem("fixture-native-jobs", JSON.stringify(window.__nativeJobs));
              localStorage.setItem("fixture-native-queue", JSON.stringify(window.__nativeQueue));
            };
            if (method === "tasks.queue.get") return structuredClone(window.__nativeQueue);
            if (method === "tasks.queue.set") {
              const saved = args.expectedRevision === window.__nativeQueue.revision;
              if (saved)
                window.__nativeQueue = {
                  revision: args.expectedRevision + 1,
                  paused: args.paused,
                  maxConcurrent: args.maxConcurrent,
                };
              persist();
              return { saved, queue: structuredClone(window.__nativeQueue) };
            }
            if (method === "tasks.list")
              return Object.values(window.__nativeJobs)
                .slice(args.offset, args.offset + args.limit)
                .map(({ input, result, ...job }) => structuredClone(job));
            if (method === "tasks.find")
              return structuredClone(
                Object.values(window.__nativeJobs).find(
                  (job) => job.requestKey === args.requestKey,
                ) || null,
              );
            if (method === "tasks.get") return structuredClone(window.__nativeJobs[args.id]);
            if (method === "tasks.start") {
              const job = {
                id: fixtureUuid(),
                entry: { name: args.entry },
                input: args.input,
                requestKey: args.requestKey,
                sequence: 1,
                status: "queued",
              };
              window.__nativeJobs[job.id] = job;
              persist();
              if (window.__loseNativeStart) {
                window.__loseNativeStart = false;
                throw new Error("start reply lost");
              }
              return structuredClone(job);
            }
            const job = window.__nativeJobs[args.id];
            if (method === "tasks.cancel") job.status = "cancelled";
            else if (method === "tasks.retry") job.status = "queued";
            else throw new Error(method);
            job.sequence++;
            persist();
            return structuredClone(job);
          }
          if (ai.versionedStorage && method === "storage.getSnapshot")
            return storageSnapshot(args.key);
          if (ai.versionedStorage && method === "storage.compareAndSet") {
            if (storageSnapshot(args.key).revision !== args.expectedRevision)
              return { updated: false, snapshot: storageSnapshot(args.key) };
            window.__hostStorage[args.key] = structuredClone(args.value);
            window.__hostStorageRevision++;
            return { updated: true, snapshot: storageSnapshot(args.key) };
          }
          if (method === "agent.task.models") {
            if (window.__taskModelsError) throw new Error(window.__taskModelsError);
            return structuredClone(window.__taskModels);
          }
          if (method === "agent.task.list") return [];
          if (method === "agent.task.start") {
            if (window.__analysisStartError) throw new Error(window.__analysisStartError);
            const task = {
              id: `analysis-${Object.keys(window.__agentTasks).length + 1}`,
              key: args.key,
              status: "running",
            };
            window.__agentTasks[task.id] = task;
            if (window.__holdAnalysisStart)
              return new Promise((resolve) => {
                window.__releaseAnalysisStart = () => resolve(structuredClone(task));
              });
            return structuredClone(task);
          }
          if (method === "agent.task.get") return structuredClone(window.__agentTasks[args.id]);
          if (method === "agent.task.cancel") {
            if (window.__rejectAnalysisCancel) throw new Error("Fixture cancellation unavailable");
            const task = window.__agentTasks[args.id];
            task.status = "cancelling";
            if (!window.__holdAnalysisCancel)
              setTimeout(() => {
                task.status = "cancelled";
                window.__emit("agent.task.changed", task);
              }, 10);
            return structuredClone(task);
          }
          if (method === "filesystem.getKnownDirectory") {
            if (args.name !== "project")
              throw new Error(`Unexpected known directory: ${args.name}`);
            if (projectDirectoryError) throw new Error(projectDirectoryError);
            return {
              handle: "directory-first",
              name: "Project",
              path: "/fixture/project",
              ...(ai.durable ? { bookmark: "11111111-1111-4111-8111-111111111111" } : {}),
            };
          }
          if (method === "filesystem.pickDirectory") return structuredClone(window.__nextDirectory);
          if (method === "filesystem.openDirectory") return { opened: true };
          if (
            method === "credentials.cookies.list" ||
            method === "credentials.cookies.listForTask"
          ) {
            return { accounts: structuredClone(window.__cookieAccounts) };
          }
          if (method === "credentials.cookies.authorizeProcess") {
            window.__cookieAuthorizationCount += 1;
            return window.__denyCookieAuthorization
              ? { authorized: false, cancelled: true }
              : {
                  authorized: true,
                  fileArgumentHandle: `cookie-file-${window.__cookieAuthorizationCount}`,
                };
          }
          if (method === "process.find") {
            if (window.__unavailable.has(args.name)) return { available: false, name: args.name };
            return {
              available: true,
              name: args.name,
              handle: `executable-${args.name}`,
              path: `/fixture/bin/${args.name}`,
            };
          }
          if (method === "process.spawn") {
            const processId = `process-${++nextProcess}`;
            const result = { processId, executable: args.executableHandle };
            const isVersion = args.args.includes("--version") || args.args.includes("-version");
            const isRelease = args.executableHandle === "executable-curl";
            if (isVersion || isRelease) {
              setTimeout(() => {
                window.__emit("process.output", {
                  processId,
                  stream: "stdout",
                  text:
                    window.__brokenExecutable === args.executableHandle
                      ? "invalid tool output\n"
                      : isVersion
                        ? args.args.includes("-version")
                          ? "ffmpeg version 8.1.1\n"
                          : "2026.09.17\n"
                        : '{"tag_name":"2026.09.17"}\n',
                });
                window.__emit("process.exit", {
                  processId,
                  code: window.__brokenExecutable === args.executableHandle ? 1 : 0,
                });
              }, 0);
            } else {
              window.__downloads.push({ ...structuredClone(args), processId });
              if (window.__holdNextDownload) {
                window.__holdNextDownload = false;
                return new Promise((resolve) => {
                  window.__heldSpawns[processId] = () => {
                    delete window.__heldSpawns[processId];
                    resolve(result);
                  };
                });
              }
            }
            return result;
          }
          if (method === "process.cancel") {
            if (window.__rejectCancellation) throw new Error("Fixture cancellation unavailable");
            if (window.__holdCancellation) return { cancelled: true };
            setTimeout(
              () => window.__emit("process.exit", { processId: args.processId, code: null }),
              0,
            );
            return { cancelled: true };
          }
          throw new Error(`Unexpected mock Host call: ${method}`);
        },
      };
    },
    { projectDirectoryError, ai },
  );
  await page.goto(baseUrl);
  await page.waitForFunction((projectDirectoryError) => {
    return (
      window.__panelTools?.get_video_download_context &&
      (projectDirectoryError
        ? document.querySelector("#runtime-badge span").textContent === "请选择保存目录"
        : document.querySelector("#installed-ytdlp-version").textContent === "2026.09.17") &&
      !document.querySelector("#refresh-versions").disabled
    );
  }, projectDirectoryError);
  if (concurrency !== null)
    await page.locator("#queue-concurrency").selectOption(String(concurrency));
  return page;
}

const readState = (page) => page.evaluate(() => window.__panelTools.get_video_download_context());
const downloads = (page) => page.evaluate(() => structuredClone(window.__downloads));
const row = (page, id) => page.locator(`.queue-item[data-queue-id="${id}"]`);
const action = (page, id, name) =>
  page.locator(`[data-queue-id="${id}"][data-queue-action="${name}"]`);
const taskRow = (page, id) => page.locator(`.task-overview-item[data-task-id="${id}"]`);
const taskAction = (page, id, name) => taskRow(page, id).locator(`[data-task-action="${name}"]`);

async function downloadForm(page) {
  if (!(await page.locator("#url-input").isVisible())) {
    await page.locator('[data-tab="download"]').click();
  }
}

async function addDownload(page, url, { start = true } = {}) {
  await downloadForm(page);
  const before = (await readState(page)).queue.length;
  await page.locator("#url-input").fill(url);
  await page.locator(start ? "#download-button" : "#enqueue-button").click();
  await page.waitForFunction(
    (count) => document.querySelectorAll(".queue-item").length === count,
    before + 1,
  );
  return (await readState(page)).queue.at(-1);
}

async function waitForDownloads(page, count) {
  await page.waitForFunction((count) => window.__downloads.length === count, count);
  return downloads(page);
}

async function completeDownload(
  page,
  processId,
  { code = 0, title = "下载测试视频", error = "" } = {},
) {
  await page.evaluate(
    ({ processId, code, title, error }) => {
      window.__emit("process.output", {
        processId,
        stream: code === 0 ? "stdout" : "stderr",
        text:
          code === 0
            ? `meta:${title}\nprogress:100.0%|3.2MiB/s|00:00\nfile:/fixture/${processId}.mp4\n`
            : `${error || "ERROR: HTTP Error 403: Forbidden"}\n`,
      });
      window.__emit("process.exit", { processId, code });
    },
    { processId, code, title, error },
  );
}

async function waitForStatus(page, id, status) {
  await page.waitForFunction(
    ({ id, status }) => {
      return document.querySelector(`.queue-item[data-queue-id="${id}"]`)?.dataset.state === status;
    },
    { id, status },
  );
  assert.equal(
    await row(page, id).getAttribute("data-state"),
    status,
    `Queue row must match the context: ${JSON.stringify((await readState(page)).queue)}`,
  );
}

async function setToggle(page, id, checked) {
  const input = page.locator(`#${id}`);
  if ((await input.isChecked()) !== checked) await input.locator("..").click();
  assert.equal(await input.isChecked(), checked);
}

test("downloads stay serial and each queued item keeps its original settings and directory", async (t) => {
  const page = await openPanel(t);
  assert.deepEqual((await readState(page)).destination, {
    name: "Project",
    path: "/fixture/project",
  });
  assert.deepEqual(
    await page.evaluate(() =>
      window.__calls
        .filter(({ method }) => method === "filesystem.getKnownDirectory")
        .map(({ args }) => args),
    ),
    [{ name: "project" }],
    "The default comes from the bound project grant, without requesting the user's Downloads folder",
  );
  const first = await addDownload(page, firstUrl);
  const [firstProcess] = await waitForDownloads(page, 1);
  await waitForStatus(page, first.id, "running");
  await downloadForm(page);
  for (const id of ["url-input", "quality-select", "choose-directory", "download-button"]) {
    assert.equal(
      await page.locator(`#${id}`).isDisabled(),
      false,
      `${id} stays usable during download`,
    );
  }

  await page.locator("#url-input").fill(secondUrl);
  await page.locator("#quality-select").selectOption("720");
  await setToggle(page, "playlist-toggle", true);
  await page.locator("#playlist-items").fill("2-4,8");
  await setToggle(page, "subtitle-toggle", true);
  await page.locator("#subtitle-mode").selectOption("manual");
  await page.locator("#subtitle-language-preset").selectOption("en");
  await setToggle(page, "subtitle-embed", false);
  await page.locator("#choose-directory").click();
  await page.locator("#download-button").click();
  const second = (await readState(page)).queue[1];
  assert.equal(second.url, secondUrl);
  assert.equal(second.status, "queued");
  assert.equal(second.format, "720");
  assert.equal(second.destination.path, "/fixture/second");
  assert.equal((await downloads(page)).length, 1, "Adding an item does not start a second process");

  await page.locator('[data-tab="task"]').click();
  await page.locator("#open-directory").click();
  assert.equal(
    await page.evaluate(
      () => window.__calls.find(({ method }) => method === "filesystem.openDirectory").args.handle,
    ),
    "directory-first",
    "The running task opens its own directory instead of the newest queued destination",
  );

  await downloadForm(page);
  await page.locator("#url-input").fill(thirdUrl);
  await page.locator("#quality-select").selectOption("audio");
  await setToggle(page, "playlist-toggle", false);
  await page.evaluate(() => {
    window.__nextDirectory = { handle: "directory-third", name: "Other", path: "/fixture/other" };
  });
  await page.locator("#choose-directory").click();
  await completeDownload(page, firstProcess.processId);
  const [, secondProcess] = await waitForDownloads(page, 2);
  await waitForStatus(page, first.id, "completed");
  await waitForStatus(page, second.id, "running");
  assert.equal(secondProcess.directoryHandle, "directory-second");
  assert.equal(secondProcess.args.at(-1), secondUrl);
  assert.equal(secondProcess.args[secondProcess.args.indexOf("--format") + 1], "bv*+ba/b");
  assert.equal(secondProcess.args[secondProcess.args.indexOf("--format-sort") + 1], "res:720");
  assert.equal(secondProcess.args[secondProcess.args.indexOf("--playlist-items") + 1], "2-4,8");
  assert.equal(secondProcess.args[secondProcess.args.indexOf("--sub-langs") + 1], "en.*");
  assert.ok(secondProcess.args.includes("--yes-playlist"));
  assert.ok(secondProcess.args.includes("--write-subs"));
  for (const argument of [
    "--extract-audio",
    "--write-auto-subs",
    "--embed-subs",
    "--no-playlist",
  ]) {
    assert.ok(
      !secondProcess.args.includes(argument),
      `${argument} must not leak from another configuration`,
    );
  }
  await completeDownload(page, secondProcess.processId);
  await waitForStatus(page, second.id, "completed");
  assert.equal((await downloads(page)).length, 2);
  await page.locator('[data-tab="task"]').click();
  await page.locator("#open-directory").click();
  assert.equal(
    await page.evaluate(
      () =>
        window.__calls.filter(({ method }) => method === "filesystem.openDirectory").at(-1).args
          .handle,
    ),
    "directory-second",
    "The completed task keeps its own directory after the form changes",
  );
});

test("an unavailable project grant requires a chosen directory instead of silently using Downloads", async (t) => {
  const page = await openPanel(t, 620, "unsupported known directory");
  assert.equal((await readState(page)).destination, null);
  assert.match(await page.locator("#destination-path").textContent(), /选择项目目录/);
  await page.locator("#url-input").fill(firstUrl);
  assert.equal(await page.locator("#download-button").isDisabled(), true);
  assert.equal((await downloads(page)).length, 0);
  await page.locator("#choose-directory").click();
  assert.equal((await readState(page)).destination.path, "/fixture/second");
  await page.locator("#download-button").click();
  const [started] = await waitForDownloads(page, 1);
  assert.equal(started.directoryHandle, "directory-second");
});

test("pause, remove, resume, cancel and clear keep unfinished work intact", async (t) => {
  const page = await openPanel(t);
  const first = await addDownload(page, firstUrl);
  await waitForDownloads(page, 1);
  const second = await addDownload(page, secondUrl);
  const third = await addDownload(page, thirdUrl);
  await page.locator("#queue-pause").click();
  await waitForStatus(page, first.id, "paused");
  await waitForStatus(page, second.id, "paused");
  await action(page, third.id, "remove").click();
  assert.equal(await row(page, third.id).count(), 0);
  assert.equal(
    await page.locator("#queue-clear").isDisabled(),
    true,
    "Paused tasks are unfinished",
  );
  await page.locator("#queue-restore").click();
  const [, resumed] = await waitForDownloads(page, 2);
  await completeDownload(page, resumed.processId);
  await waitForStatus(page, first.id, "completed");
  const [, , secondProcess] = await waitForDownloads(page, 3);
  await page.locator("#queue-clear").click();
  assert.equal(await row(page, first.id).count(), 0);
  assert.equal(await row(page, second.id).count(), 1);
  const fourth = await addDownload(page, "https://www.youtube.com/watch?v=queue-fourth");
  await action(page, second.id, "cancel").click();
  await waitForStatus(page, second.id, "cancelled");
  await waitForDownloads(page, 4);
  await waitForStatus(page, fourth.id, "running");
  assert.ok((await downloads(page)).every((item) => item.args.at(-1) !== thirdUrl));
  await page.locator("#queue-clear").click();
  assert.equal(await row(page, second.id).count(), 0);
  assert.equal(await row(page, fourth.id).count(), 1);
});

test("failed entries preserve their error as the queue advances and can be retried", async (t) => {
  const page = await openPanel(t);
  const first = await addDownload(page, firstUrl);
  const [firstProcess] = await waitForDownloads(page, 1);
  await downloadForm(page);
  await page.locator("#quality-select").selectOption("audio");
  const second = await addDownload(page, secondUrl);
  await completeDownload(page, firstProcess.processId, { code: 1 });
  const [, secondProcess] = await waitForDownloads(page, 2);
  await waitForStatus(page, first.id, "failed");
  await waitForStatus(page, second.id, "running");
  const failedState = await readState(page);
  const failed = failedState.queue.find((item) => item.id === first.id);
  assert.equal(failedState.configuration.format, "audio");
  assert.equal(failedState.lastFailure.configuration.format, "best");
  assert.ok(secondProcess.args.includes("--extract-audio"));
  assert.ok(failed.error, "Starting another item must not erase the failed entry's diagnostic");
  assert.ok((await row(page, first.id).innerText()).includes(failed.error));
  await action(page, first.id, "retry").click();
  assert.equal(
    (await downloads(page)).length,
    2,
    "Retry joins the queue instead of running concurrently",
  );
  await completeDownload(page, secondProcess.processId);
  const [, , retriedProcess] = await waitForDownloads(page, 3);
  assert.equal(retriedProcess.args.at(-1), firstUrl);
  assert.equal(retriedProcess.directoryHandle, firstProcess.directoryHandle);
  assert.deepEqual(retriedProcess.args, firstProcess.args);
  await completeDownload(page, retriedProcess.processId);
  await page.waitForFunction(() => {
    return [...document.querySelectorAll(".queue-item")].every(
      (item) => item.dataset.state === "completed",
    );
  });
});

test("Cookie retry authorizes the original account again and denied authorization does not restart", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__cookieAccounts = [
      { id: "account-original", label: "Original fixture account", health: "healthy" },
      { id: "account-next", label: "Next fixture account", health: "healthy" },
    ];
  });
  await page.locator("#url-input").fill(firstUrl);
  await page.locator("#cookie-refresh").click();
  await page.locator("#cookie-select").selectOption("account-original");
  await page.locator("#download-button").click();
  const [firstProcess] = await waitForDownloads(page, 1);
  const first = (await readState(page)).queue[0];
  assert.deepEqual(firstProcess.fileArgumentHandles, ["cookie-file-1"]);
  await completeDownload(page, firstProcess.processId, { code: 1 });
  await waitForStatus(page, first.id, "failed");

  await downloadForm(page);
  await page.locator("#url-input").fill(secondUrl);
  await page.locator("#cookie-refresh").click();
  await page.locator("#cookie-select").selectOption("account-next");
  await action(page, first.id, "retry").click();
  const [, retriedProcess] = await waitForDownloads(page, 2);
  const authorizations = await page.evaluate(() =>
    window.__calls.filter(({ method }) => method === "credentials.cookies.authorizeProcess"),
  );
  assert.equal(authorizations.length, 2);
  for (const { args } of authorizations) {
    assert.deepEqual(args, {
      credentialId: "account-original",
      url: "https://youtube.com/",
      executableHandle: "executable-yt-dlp",
    });
  }
  assert.deepEqual(retriedProcess.fileArgumentHandles, ["cookie-file-2"]);
  assert.deepEqual(retriedProcess.args, firstProcess.args);
  assert.equal(await page.locator("#cookie-select").inputValue(), "account-next");

  await completeDownload(page, retriedProcess.processId, { code: 1 });
  await waitForStatus(page, first.id, "failed");
  await page.evaluate(() => {
    window.__denyCookieAuthorization = true;
  });
  await action(page, first.id, "retry").click();
  await page.waitForFunction((id) => {
    const item = document.querySelector(`.queue-item[data-queue-id="${id}"]`);
    return (
      item?.querySelector(".queue-error")?.textContent.includes("已取消使用 Cookie") &&
      !item.querySelector('[data-queue-action="retry"]').disabled
    );
  }, first.id);
  assert.equal(
    (await downloads(page)).length,
    2,
    "Denied authorization must not reuse the old Cookie file",
  );
  assert.equal((await readState(page)).queue.find((item) => item.id === first.id).status, "failed");
  assert.equal(await page.evaluate(() => window.__cookieAuthorizationCount), 3);
});

test("cancellation while spawn is pending cancels that process before advancing the queue", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__holdNextDownload = true;
  });
  const first = await addDownload(page, firstUrl);
  const [firstProcess] = await waitForDownloads(page, 1);
  const second = await addDownload(page, secondUrl);
  await action(page, first.id, "cancel").click();
  assert.equal((await readState(page)).download.status, "cancelling");
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter(({ method }) => method === "process.cancel").length,
    ),
    0,
    "Cancellation waits for the Host's process identity",
  );
  await page.evaluate((id) => window.__heldSpawns[id](), firstProcess.processId);
  await waitForStatus(page, first.id, "cancelled");
  const [, secondProcess] = await waitForDownloads(page, 2);
  await waitForStatus(page, second.id, "running");
  const cancelled = await page.evaluate(() =>
    window.__calls.filter(({ method }) => method === "process.cancel"),
  );
  assert.deepEqual(
    cancelled.map(({ args }) => args.processId),
    [firstProcess.processId],
  );
  await completeDownload(page, secondProcess.processId);
  await waitForStatus(page, second.id, "completed");
});

test("a rejected deferred cancellation leaves the process running and the next item waiting", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__holdNextDownload = true;
    window.__rejectCancellation = true;
  });
  const first = await addDownload(page, firstUrl);
  const [firstProcess] = await waitForDownloads(page, 1);
  const second = await addDownload(page, secondUrl);
  await action(page, first.id, "cancel").click();
  assert.equal((await readState(page)).download.status, "cancelling");
  await page.evaluate((id) => window.__heldSpawns[id](), firstProcess.processId);
  await page.waitForFunction((id) => {
    return (
      window.__calls.some(({ method }) => method === "process.cancel") &&
      !document.querySelector(`[data-queue-id="${id}"][data-queue-action="cancel"]`).disabled
    );
  }, first.id);
  await waitForStatus(page, first.id, "running");
  await waitForStatus(page, second.id, "queued");
  assert.equal((await readState(page)).download.status, "running");
  assert.equal(
    (await downloads(page)).length,
    1,
    "Failed cancellation must not start a concurrent download",
  );
  await completeDownload(page, firstProcess.processId);
  const [, secondProcess] = await waitForDownloads(page, 2);
  await waitForStatus(page, first.id, "completed");
  await completeDownload(page, secondProcess.processId);
  await waitForStatus(page, second.id, "completed");
});

test("an exit before spawn resolves cannot attach the old process identity to the next download", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__holdNextDownload = true;
  });
  const first = await addDownload(page, firstUrl);
  const [firstProcess] = await waitForDownloads(page, 1);
  const second = await addDownload(page, secondUrl);
  await completeDownload(page, firstProcess.processId);
  await waitForStatus(page, first.id, "completed");
  const [, secondProcess] = await waitForDownloads(page, 2);
  await waitForStatus(page, second.id, "running");
  await page.evaluate((id) => window.__heldSpawns[id](), firstProcess.processId);
  await page.evaluate((processId) => {
    window.__emit("process.output", {
      processId,
      stream: "stderr",
      text: "late output from old process\n",
    });
    window.__emit("process.exit", { processId, code: 1 });
  }, firstProcess.processId);
  await waitForStatus(page, second.id, "running");
  await completeDownload(page, secondProcess.processId);
  await waitForStatus(page, second.id, "completed");
  assert.equal(
    (await readState(page)).queue.find((item) => item.id === first.id).status,
    "completed",
  );
  assert.equal((await downloads(page)).length, 2);
});

for (const width of [340, 620, 1280]) {
  test(`queue stays visible in every tab with no horizontal overflow at ${width}px`, async (t) => {
    const page = await openPanel(t, width);
    const first = await addDownload(page, firstUrl);
    const [firstProcess] = await waitForDownloads(page, 1);
    await page.evaluate(({ processId }) => {
      window.__emit("process.output", {
        processId,
        stream: "stdout",
        text: `meta:${"LongVideoTitle".repeat(25)}\nprogress:47.1%|3.2MiB/s|00:30\n`,
      });
    }, firstProcess);
    await addDownload(page, `https://www.youtube.com/watch?v=${"pending-video-".repeat(28)}`);
    for (const tab of ["download", "task", "history"]) {
      await page.locator(`[data-tab="${tab}"]`).click();
      assert.equal(await page.locator("#queue-list").isVisible(), true);
      assert.equal(await row(page, first.id).isVisible(), true);
      const dimensions = await page.evaluate(() => ({
        viewport: innerWidth,
        page: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        queue: document.querySelector("#queue-list").getBoundingClientRect().toJSON(),
      }));
      assert.ok(dimensions.page <= width, JSON.stringify({ tab, ...dimensions }));
      assert.ok(dimensions.body <= width, JSON.stringify({ tab, ...dimensions }));
      assert.ok(
        dimensions.queue.left >= 0 && dimensions.queue.right <= width,
        JSON.stringify(dimensions),
      );
    }
    await page.locator('[data-tab="download"]').click();
    await page.screenshot({ path: resolve(artifacts, `queue-${width}.png`), fullPage: true });
  });
}

test("default concurrency starts three downloads and refills an out-of-order completion", async (t) => {
  const page = await openPanel(t, 1280, "", null);
  assert.equal(await page.locator("#queue-concurrency").inputValue(), "3");
  await page
    .locator("#url-input")
    .fill([firstUrl, secondUrl, thirdUrl, "https://youtu.be/fourth"].join("\n"));
  await page.locator("#download-button").click();
  const processes = await waitForDownloads(page, 3);
  const state = await readState(page);
  assert.equal(state.runningCount, 3);
  assert.deepEqual(
    state.queue.map((item) => item.status),
    ["running", "running", "running", "queued"],
  );
  await completeDownload(page, processes[1].processId, { title: "第二个先完成" });
  await waitForDownloads(page, 4);
  assert.deepEqual(
    (await readState(page)).queue.map((item) => item.status),
    ["running", "completed", "running", "running"],
  );
  await page.screenshot({ path: resolve(artifacts, "concurrent-downloads.png"), fullPage: true });
});

test("interleaved download chunks retain each task's title, progress, log and files", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  const first = await addDownload(page, firstUrl);
  const second = await addDownload(page, secondUrl);
  const [a, b] = await waitForDownloads(page, 2);
  await page.evaluate(
    ([a, b]) => {
      const output = (id, text) =>
        window.__emit("process.output", { processId: id, stream: "stdout", text });
      output(a, "meta:Alpha\nprogress:2");
      output(b, "meta:Beta\nprogress:7");
      output(a, "5%|1MiB/s|00:12\nalpha-only\n");
      output(b, "5%|2MiB/s|00:04\nbeta-only\n");
    },
    [a.processId, b.processId],
  );
  const state = await readState(page);
  assert.deepEqual(
    state.queue.map((item) => [item.title, item.percent]),
    [
      ["Alpha", 25],
      ["Beta", 75],
    ],
  );
  await action(page, second.id, "open").click();
  assert.match(await page.locator("#task-log").textContent(), /beta-only/);
  assert.doesNotMatch(await page.locator("#task-log").textContent(), /alpha-only/);
  assert.equal(await page.locator("#task-title").textContent(), "Beta");
  await action(page, first.id, "open").click();
  assert.match(await page.locator("#task-log").textContent(), /alpha-only/);
  assert.doesNotMatch(await page.locator("#task-log").textContent(), /beta-only/);
  await completeDownload(page, b.processId, { title: "Beta" });
  await completeDownload(page, a.processId, { title: "Alpha" });
  await waitForStatus(page, first.id, "completed");
  await waitForStatus(page, second.id, "completed");
  const history = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find((key) => key.startsWith("video-download.library.v2:")),
        ),
      ).history,
  );
  assert.deepEqual(history.map((item) => [item.title, item.files[0].path]).sort(), [
    ["Alpha", `/fixture/${a.processId}.mp4`],
    ["Beta", `/fixture/${b.processId}.mp4`],
  ]);
});

test("cancelling a non-selected concurrent task leaves the others running and permits retry", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  const first = await addDownload(page, firstUrl);
  const second = await addDownload(page, secondUrl);
  const [a, b] = await waitForDownloads(page, 2);
  await action(page, first.id, "open").click();
  await action(page, second.id, "cancel").click();
  await waitForStatus(page, second.id, "cancelled");
  await waitForStatus(page, first.id, "running");
  const cancelled = await page.evaluate(() =>
    window.__calls
      .filter((call) => call.method === "process.cancel")
      .map((call) => call.args.processId),
  );
  assert.deepEqual(cancelled, [b.processId]);
  await action(page, second.id, "retry").click();
  const all = await waitForDownloads(page, 3);
  await completeDownload(page, all[2].processId);
  await waitForStatus(page, second.id, "completed");
  await waitForStatus(page, first.id, "running");
  await completeDownload(page, a.processId);
  await waitForStatus(page, first.id, "completed");
  const history = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find((key) => key.startsWith("video-download.library.v2:")),
        ),
      ).history,
  );
  assert.equal(history.filter((item) => item.queueId === second.id).length, 1);
});

test("changing concurrency respects active downloads and remembers the limit on reopen", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  await page
    .locator("#url-input")
    .fill([firstUrl, secondUrl, thirdUrl, "https://youtu.be/fourth"].join("\n"));
  await page.locator("#download-button").click();
  const [a, b] = await waitForDownloads(page, 2);
  await page.locator("#queue-concurrency").selectOption("1");
  await completeDownload(page, a.processId);
  await page.waitForFunction(
    async () => (await window.__panelTools.get_video_download_context()).runningCount === 1,
  );
  assert.equal((await downloads(page)).length, 2);
  await page.locator("#queue-concurrency").selectOption("4");
  await waitForDownloads(page, 4);
  assert.equal((await readState(page)).runningCount, 3);
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__panelTools?.get_video_download_context &&
      document.querySelector("#queue-concurrency").value === "4",
  );
  assert.equal((await readState(page)).maxConcurrent, 4);
  assert.equal((await readState(page)).runningCount, 0);
  assert.equal(
    (await downloads(page)).length,
    0,
    "Reopening must not auto-resume interrupted work",
  );
});

test("a completed queue entry clears history filters, highlights its record and supports keyboard navigation", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  const first = await addDownload(page, firstUrl);
  const second = await addDownload(page, secondUrl);
  const [a, b] = await waitForDownloads(page, 2);
  await completeDownload(page, b.processId, { title: "Record Beta" });
  await waitForStatus(page, second.id, "completed");
  await completeDownload(page, a.processId, { title: "Record Alpha" });
  await waitForStatus(page, first.id, "completed");
  await page.locator('[data-tab="history"]').click();
  await page.locator("#history-search").fill("no such title");
  await page.locator("#history-filter").selectOption("missing");
  await action(page, second.id, "open").click();
  const target = page.locator(`.history-item[data-history-id="${second.id}"]`);
  assert.equal(await target.isVisible(), true);
  assert.match(await target.getAttribute("class"), /history-highlight/);
  assert.equal(await page.locator("#history-search").inputValue(), "");
  assert.equal(await page.locator("#history-filter").inputValue(), "all");
  assert.equal(await target.evaluate((element) => element === document.activeElement), true);
  await action(page, first.id, "open").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".history-highlight").getAttribute("data-history-id"), first.id);
  await page.screenshot({ path: resolve(artifacts, "queue-history-jump.png"), fullPage: true });
  await page
    .locator(`.history-item[data-history-id="${first.id}"] .history-menu > summary`)
    .click();
  await page.locator(`[data-history-id="${first.id}"][data-history-action="delete"]`).click();
  await action(page, first.id, "open").click();
  assert.match(await page.locator("#history-jump-status").textContent(), /记录已被清除/);
});

test("the agent can cancel a specified task while another task is selected", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  const first = await addDownload(page, firstUrl);
  const second = await addDownload(page, secondUrl);
  await waitForDownloads(page, 2);
  await action(page, first.id, "open").click();
  const result = await page.evaluate(
    (queueId) => window.__panelTools.cancel_video_download({ queueId }),
    second.id,
  );
  assert.equal(result.cancelRequested, true);
  assert.equal(result.queueId, second.id);
  await waitForStatus(page, second.id, "cancelled");
  await waitForStatus(page, first.id, "running");
});

test("pause all stops active downloads, holds pending tasks and resumes up to the configured limit", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  await page.locator("#url-input").fill([firstUrl, secondUrl, thirdUrl].join("\n"));
  await page.locator("#download-button").click();
  const [a, b] = await waitForDownloads(page, 2);
  await page.locator("#queue-pause").click();
  await page.waitForFunction(
    () => document.querySelectorAll('.queue-item[data-state="paused"]').length === 3,
  );
  assert.equal((await downloads(page)).length, 2);
  assert.equal((await readState(page)).runningCount, 0);
  assert.deepEqual(
    await page.evaluate(() =>
      window.__calls
        .filter((call) => call.method === "process.cancel")
        .map((call) => call.args.processId),
    ),
    [a.processId, b.processId],
  );
  assert.equal(await page.locator("#queue-restore").textContent(), "全部继续");
  await page.locator("#queue-restore").click();
  const all = await waitForDownloads(page, 4);
  assert.equal((await readState(page)).runningCount, 2);
  assert.deepEqual(all[2].args, a.args);
  assert.deepEqual(all[3].args, b.args);
  await completeDownload(page, all[2].processId);
  await waitForDownloads(page, 5);
  assert.equal((await readState(page)).runningCount, 2);
});

test("an early concurrent exit and late receipt never steal an already running process", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  const first = await addDownload(page, firstUrl);
  const [a] = await waitForDownloads(page, 1);
  await page.evaluate(() => {
    window.__holdNextDownload = true;
  });
  const second = await addDownload(page, secondUrl);
  const [, b] = await waitForDownloads(page, 2);
  const third = await addDownload(page, thirdUrl);
  await page.evaluate(
    (processId) =>
      window.__emit("process.output", {
        processId,
        stream: "stdout",
        text: "meta:Still Alpha\nprogress:35%|1MiB/s|00:05\n",
      }),
    a.processId,
  );
  await completeDownload(page, b.processId, { title: "Early Beta" });
  const [, , c] = await waitForDownloads(page, 3);
  await page.evaluate((processId) => {
    window.__heldSpawns[processId]();
    window.__emit("process.output", { processId, stream: "stderr", text: "ERROR: obsolete\n" });
    window.__emit("process.exit", { processId, code: 1 });
  }, b.processId);
  const state = await readState(page);
  assert.deepEqual(
    state.queue.map((item) => item.status),
    ["running", "completed", "running"],
  );
  assert.equal(state.queue[0].title, "Still Alpha");
  assert.equal(state.queue[0].percent, 35);
  await completeDownload(page, c.processId);
  await completeDownload(page, a.processId);
  await waitForStatus(page, first.id, "completed");
  await waitForStatus(page, third.id, "completed");
  await waitForStatus(page, second.id, "completed");
});

test("retrying an early failure ignores that attempt's delayed spawn receipt", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  await page.evaluate(() => {
    window.__holdNextDownload = true;
  });
  const item = await addDownload(page, firstUrl);
  const [old] = await waitForDownloads(page, 1);
  await completeDownload(page, old.processId, { code: 1, error: "ERROR: first attempt failed" });
  await waitForStatus(page, item.id, "failed");
  await page.evaluate(() => {
    window.__holdNextDownload = true;
  });
  await action(page, item.id, "retry").click();
  const [, retry] = await waitForDownloads(page, 2);
  await page.evaluate((id) => window.__heldSpawns[id](), old.processId);
  await action(page, item.id, "cancel").click();
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((call) => call.method === "process.cancel").length,
    ),
    0,
  );
  await page.evaluate((id) => window.__heldSpawns[id](), retry.processId);
  await waitForStatus(page, item.id, "cancelled");
  assert.deepEqual(
    await page.evaluate(() =>
      window.__calls
        .filter((call) => call.method === "process.cancel")
        .map((call) => call.args.processId),
    ),
    [retry.processId],
  );
});

test("an individual pause frees one slot and resume keeps the original settings and filename", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  const first = await addDownload(page, firstUrl);
  const second = await addDownload(page, secondUrl);
  const third = await addDownload(page, thirdUrl);
  const [a, b] = await waitForDownloads(page, 2);
  await page.evaluate(
    (id) =>
      window.__emit("process.output", {
        processId: id,
        stream: "stdout",
        text: "meta:Alpha\nprogress:41%|1MiB/s|00:10\n",
      }),
    a.processId,
  );
  await action(page, first.id, "open").click();
  await page.locator("#pause-button").click();
  await waitForStatus(page, first.id, "paused");
  await waitForDownloads(page, 3);
  await waitForStatus(page, second.id, "running");
  await waitForStatus(page, third.id, "running");
  assert.match(await row(page, first.id).textContent(), /41%/);
  assert.equal((await readState(page)).queuePaused, false);
  assert.equal(
    await page.locator(".history-item").count(),
    0,
    "Pausing creates no terminal record",
  );
  await action(page, first.id, "open").click();
  assert.equal(await page.locator("#pause-button").textContent(), "继续下载");
  await page.locator("#pause-button").click();
  await waitForStatus(page, first.id, "queued");
  await completeDownload(page, b.processId);
  const all = await waitForDownloads(page, 4);
  assert.deepEqual(all[3].args, a.args);
  assert.equal(all[3].directoryHandle, a.directoryHandle);
  assert.ok(all[3].args.includes("--continue"));
});

test("resume remains disabled until pause is confirmed by process exit", async (t) => {
  const page = await openPanel(t);
  const first = await addDownload(page, firstUrl);
  const [a] = await waitForDownloads(page, 1);
  await page.evaluate(() => {
    window.__holdCancellation = true;
  });
  await action(page, first.id, "pause").click();
  await waitForStatus(page, first.id, "running");
  assert.match(await row(page, first.id).textContent(), /正在暂停/);
  assert.equal(await action(page, first.id, "pause").isDisabled(), true);
  assert.equal(await page.locator("#queue-restore").isDisabled(), true);
  await page.evaluate(
    (processId) => window.__emit("process.exit", { processId, code: null }),
    a.processId,
  );
  await waitForStatus(page, first.id, "paused");
  await action(page, first.id, "resume").click();
  await waitForDownloads(page, 2);
});

test("a failed pause stays visibly running and can be retried", async (t) => {
  const page = await openPanel(t);
  const first = await addDownload(page, firstUrl);
  await waitForDownloads(page, 1);
  const second = await addDownload(page, secondUrl);
  await page.evaluate(() => {
    window.__rejectCancellation = true;
  });
  await page.locator("#queue-pause").click();
  await page.waitForFunction(() =>
    document.querySelector("#queue-list").textContent.includes("暂停失败"),
  );
  await waitForStatus(page, first.id, "running");
  await waitForStatus(page, second.id, "paused");
  assert.equal((await downloads(page)).length, 1);
  await page.evaluate(() => {
    window.__rejectCancellation = false;
  });
  await page.locator("#queue-pause").click();
  await waitForStatus(page, first.id, "paused");
  assert.equal((await readState(page)).runningCount, 0);
});

test("pause while spawn is pending targets the late process and ignores its delayed output after resume", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__holdNextDownload = true;
  });
  const item = await addDownload(page, firstUrl);
  const [old] = await waitForDownloads(page, 1);
  await action(page, item.id, "pause").click();
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((call) => call.method === "process.cancel").length,
    ),
    0,
  );
  await page.evaluate((id) => window.__heldSpawns[id](), old.processId);
  await waitForStatus(page, item.id, "paused");
  await action(page, item.id, "resume").click();
  const [, resumed] = await waitForDownloads(page, 2);
  await completeDownload(page, old.processId, { code: 1, error: "ERROR: old paused process" });
  await waitForStatus(page, item.id, "running");
  await completeDownload(page, resumed.processId);
  await waitForStatus(page, item.id, "completed");
});

test("continuing one task after pause all leaves every other task paused", async (t) => {
  const page = await openPanel(t, 1280, "", 3);
  await page.locator("#url-input").fill([firstUrl, secondUrl, thirdUrl].join("\n"));
  await page.locator("#download-button").click();
  await waitForDownloads(page, 3);
  const state = await readState(page);
  await page.locator("#queue-pause").click();
  await page.waitForFunction(
    () => document.querySelectorAll('.queue-item[data-state="paused"]').length === 3,
  );
  await action(page, state.queue[1].id, "resume").click();
  await waitForDownloads(page, 4);
  assert.deepEqual(
    (await readState(page)).queue.map((item) => item.status),
    ["paused", "running", "paused"],
  );
  await page.screenshot({ path: resolve(artifacts, "pause-resume.png"), fullPage: true });
});

test("pause all during resume authorization wins over the late preparation result", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__cookieAccounts = [{ id: "account-original", label: "Fixture", health: "healthy" }];
  });
  await page.locator("#url-input").fill(firstUrl);
  await page.locator("#cookie-refresh").click();
  await page.locator("#cookie-select").selectOption("account-original");
  await page.locator("#download-button").click();
  await waitForDownloads(page, 1);
  const first = (await readState(page)).queue[0];
  await action(page, first.id, "pause").click();
  await waitForStatus(page, first.id, "paused");
  await page.evaluate(() => {
    const call = window.codeshellPanel.call.bind(window.codeshellPanel);
    window.codeshellPanel.call = async (method, args) => {
      if (method === "credentials.cookies.authorizeProcess")
        await new Promise((resolve) => {
          window.__releaseResumeAuthorization = resolve;
        });
      return call(method, args);
    };
  });
  await page.locator("#queue-restore").click();
  await page.waitForFunction(() => typeof window.__releaseResumeAuthorization === "function");
  await page.locator("#queue-pause").click();
  await page.evaluate(() => window.__releaseResumeAuthorization());
  await page.waitForFunction(() => !document.querySelector("#queue-restore").disabled);
  await waitForStatus(page, first.id, "paused");
  assert.equal((await downloads(page)).length, 1);
  assert.equal((await readState(page)).queuePaused, true);
});

test("task overview shows every concurrent task, preserves focus and selects independent details", async (t) => {
  const page = await openPanel(t, 1280, "", null);
  await page.locator("#url-input").fill([firstUrl, secondUrl, thirdUrl].join("\n"));
  await page.locator("#download-button").click();
  const processes = await waitForDownloads(page, 3);
  const items = (await readState(page)).queue;
  await page.locator('[data-tab="task"]').click();
  assert.equal(await page.locator(".task-overview-item:visible").count(), 3);
  assert.equal(await page.locator("#task-overview-count").textContent(), "3 项");
  assert.match(await page.locator("#task-overview-summary").textContent(), /3 项下载中/);
  await taskAction(page, items[1].id, "open").focus();
  await page.evaluate((processes) => {
    processes.forEach(({ processId }, index) => {
      window.__emit("process.output", {
        processId,
        stream: "stdout",
        text: `meta:视频 ${index + 1}\nprogress:${(index + 1) * 25}%|${index + 1}MiB/s|00:12\n日志 ${index + 1}\n`,
      });
    });
  }, processes);
  for (let index = 0; index < 3; index++) {
    const card = taskRow(page, items[index].id);
    assert.equal(await card.locator(".task-overview-title").textContent(), `视频 ${index + 1}`);
    assert.equal(
      await card.locator(".task-overview-status").textContent(),
      `下载中 · ${(index + 1) * 25}%`,
    );
    assert.equal(
      await card.locator(".task-overview-metrics").textContent(),
      `${index + 1}MiB/s · 剩余 00:12`,
    );
    assert.equal(
      await card.locator(".task-overview-track span").evaluate((el) => el.style.width),
      `${(index + 1) * 25}%`,
    );
  }
  assert.equal(
    await taskAction(page, items[1].id, "open").evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#task-title").textContent(), "视频 2");
  assert.match(await page.locator("#task-log").textContent(), /日志 2/);
  assert.doesNotMatch(await page.locator("#task-log").textContent(), /日志 [13]/);
  assert.equal(await page.locator('.task-overview-open[aria-pressed="true"]').count(), 1);
  assert.equal(await taskAction(page, items[1].id, "open").getAttribute("aria-pressed"), "true");
  // A state update for another task must preserve the focused card and selection.
  await completeDownload(page, processes[0].processId, { title: "视频 1" });
  await waitForStatus(page, items[0].id, "completed");
  assert.equal(await taskRow(page, items[0].id).getAttribute("data-state"), "completed");
  assert.equal(
    await taskAction(page, items[1].id, "open").evaluate((el) => el === document.activeElement),
    true,
  );
  await taskAction(page, items[0].id, "open").click();
  assert.equal(
    await page.locator(".history-highlight").getAttribute("data-history-id"),
    items[0].id,
  );
  await page.locator('[data-tab="task"]').click();
  await taskAction(page, items[1].id, "pause").click();
  await waitForStatus(page, items[1].id, "paused");
  assert.equal(await taskRow(page, items[1].id).getAttribute("data-state"), "paused");
  assert.match(await taskRow(page, items[1].id).textContent(), /已暂停 · 50%/);
  assert.equal(await taskRow(page, items[2].id).getAttribute("data-state"), "running");
  await taskAction(page, items[1].id, "resume").click();
  const resumed = await waitForDownloads(page, 4);
  assert.equal(resumed[3].args.at(-1), secondUrl);
  await page.locator("#queue-clear").click();
  assert.equal(await taskRow(page, items[0].id).count(), 0);
  assert.equal(await page.locator(".task-overview-item").count(), 2);
  assert.equal(await page.locator("#task-overview-count").textContent(), "2 项");
});

for (const [width, colorScheme] of [
  [340, "light"],
  [620, "light"],
  [1280, "light"],
  [1280, "dark"],
]) {
  test(`task overview keeps three downloads accessible at ${width}px in ${colorScheme} mode`, async (t) => {
    const page = await openPanel(t, width, "", null);
    await page.emulateMedia({ colorScheme });
    await page.locator("#url-input").fill([firstUrl, secondUrl, thirdUrl].join("\n"));
    await page.locator("#download-button").click();
    const processes = await waitForDownloads(page, 3);
    await page.evaluate((processes) => {
      const titles = [
        "Blender 与 AI：从想法到三维模型的完整工作流",
        "AI 辅助建模：镜头、材质与灯光实战",
        "视频素材与参考管理 · " + "LongVideoTitle".repeat(12),
      ];
      processes.forEach(({ processId }, index) => {
        window.__emit("process.output", {
          processId,
          stream: "stdout",
          text: `meta:${titles[index]}\nprogress:${[25, 62, 81][index]}%|3.2MiB/s|00:30\n`,
        });
      });
    }, processes);
    await page.locator('[data-tab="task"]').click();
    assert.equal(await page.locator(".task-overview-item:visible").count(), 3);
    const dimensions = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      list: document.querySelector("#task-overview-list").getBoundingClientRect().toJSON(),
      cards: [...document.querySelectorAll(".task-overview-item")].map((el) =>
        el.getBoundingClientRect().toJSON(),
      ),
    }));
    assert.ok(dimensions.page <= width, JSON.stringify(dimensions));
    for (const card of dimensions.cards) {
      assert.ok(
        card.left >= dimensions.list.left && card.right <= dimensions.list.right,
        JSON.stringify(dimensions),
      );
      assert.ok(
        card.top >= dimensions.list.top && card.bottom <= dimensions.list.bottom,
        JSON.stringify(dimensions),
      );
    }
    for (const item of (await readState(page)).queue) {
      await taskAction(page, item.id, "open").click();
      assert.equal(await page.locator("#task-title").textContent(), item.title);
    }
    await page.locator("#task-overview-list").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(artifacts, `task-overview-${width}-${colorScheme}.png`),
      fullPage: true,
    });
  });
}

test("resolution choices prefer rather than require a height, so vertical and sparse formats still download", async (t) => {
  const page = await openPanel(t);
  await downloadForm(page);
  await page.locator("#quality-select").selectOption("1080");
  await addDownload(page, firstUrl);
  const [process] = await waitForDownloads(page, 1);
  const format = process.args[process.args.indexOf("--format") + 1];
  assert.doesNotMatch(format, /height/, "A height filter rejects 1080x1920 and has no fallback");
  assert.equal(format, "bv*+ba/b");
  // yt-dlp's res sort field uses the smaller dimension, so vertical 1080p stays 1080p.
  assert.equal(process.args[process.args.indexOf("--format-sort") + 1], "res:1080");
  assert.ok(process.args.includes("--merge-output-format"));
});

test("network retries pause between fragment attempts and keep yt-dlp's current user agent", async (t) => {
  const page = await openPanel(t);
  await addDownload(page, firstUrl);
  const [process] = await waitForDownloads(page, 1);
  const sleeps = process.args.flatMap((argument, index) =>
    argument === "--retry-sleep" ? [process.args[index + 1]] : [],
  );
  assert.ok(sleeps.includes("exp=1:30"), `HTTP retries back off: ${sleeps}`);
  assert.ok(sleeps.includes("fragment:exp=1:30"), `Fragment retries back off: ${sleeps}`);
  assert.equal(
    process.args.includes("--user-agent"),
    false,
    "A frozen 2021 browser UA is not sent",
  );
});

test("a saved task uses merged formats when ffmpeg becomes available before it starts", async (t) => {
  const page = await openPanel(t, 1280, "", 1, { unavailable: ["ffmpeg"] });
  await downloadForm(page);
  await page.locator("#quality-select").selectOption("1080");
  const saved = await addDownload(page, firstUrl, { start: false });
  await waitForStatus(page, saved.id, "pending");
  await page.evaluate(() => window.__unavailable.delete("ffmpeg"));
  await page.locator("#refresh-versions").click();
  await page.waitForFunction(() => {
    const button = document.querySelector("#refresh-versions");
    return (
      !button.disabled &&
      document.querySelector("#quality-select option[value=audio]:not([disabled])")
    );
  });
  await action(page, saved.id, "resume").click();
  const [process] = await waitForDownloads(page, 1);
  assert.equal(process.args[process.args.indexOf("--format") + 1], "bv*+ba/b");
  assert.ok(
    process.args.includes("--merge-output-format"),
    `Arguments are built when the task starts, not when it was saved: ${process.args}`,
  );
});

test("save-only queue items stay pending while explicit downloads start and complete", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  const saved = await addDownload(page, firstUrl, { start: false });
  assert.equal((await downloads(page)).length, 0);
  await waitForStatus(page, saved.id, "pending");
  assert.equal(await page.locator("#queue-restore").textContent(), "全部下载");
  assert.equal(await page.locator("#queue-pause").isDisabled(), true);
  const immediate = await addDownload(page, secondUrl);
  const [process] = await waitForDownloads(page, 1);
  assert.equal(process.args.at(-1), secondUrl);
  await completeDownload(page, process.processId);
  await waitForStatus(page, immediate.id, "completed");
  await waitForStatus(page, saved.id, "pending");
  assert.equal((await downloads(page)).length, 1);
  await page.locator("#queue-clear").click();
  assert.equal((await readState(page)).queue.length, 1);
  await action(page, saved.id, "resume").click();
  const started = await waitForDownloads(page, 2);
  assert.equal(started[1].args.at(-1), firstUrl);
});

test("saved batches support individual start and download-all with the configured limit", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  await page.locator("#url-input").fill([firstUrl, secondUrl, thirdUrl].join("\n"));
  assert.match(await page.locator("#download-button").textContent(), /立即下载 · 3 条/);
  assert.equal(await page.locator("#enqueue-button").textContent(), "加入队列 · 3 条");
  await page.locator("#enqueue-button").click();
  await page.waitForFunction(
    () => document.querySelectorAll('.queue-item[data-state="pending"]').length === 3,
  );
  const items = (await readState(page)).queue;
  assert.equal((await downloads(page)).length, 0);
  await page.locator('[data-tab="task"]').click();
  await taskAction(page, items[1].id, "resume").click();
  await waitForDownloads(page, 1);
  assert.deepEqual(
    (await readState(page)).queue.map((item) => item.status),
    ["pending", "running", "pending"],
  );
  await page.locator("#queue-restore").click();
  const [a, b] = await waitForDownloads(page, 2);
  assert.deepEqual(
    (await readState(page)).queue.map((item) => item.status),
    ["running", "running", "queued"],
  );
  await completeDownload(page, a.processId);
  const all = await waitForDownloads(page, 3);
  assert.equal(all[2].args.at(-1), thirdUrl);
  assert.notEqual(a.processId, b.processId);
});

test("immediate download starts an existing pending item instead of creating a duplicate", async (t) => {
  const page = await openPanel(t);
  const saved = await addDownload(page, firstUrl, { start: false });
  await page.locator("#download-button").click();
  await waitForDownloads(page, 1);
  const state = await readState(page);
  assert.equal(state.queue.length, 1);
  assert.equal(state.queue[0].id, saved.id);
  assert.equal(state.queue[0].status, "running");
});

test("immediate download after pause-all leaves earlier tasks paused", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  const first = await addDownload(page, firstUrl);
  await waitForDownloads(page, 1);
  await page.locator("#queue-pause").click();
  await waitForStatus(page, first.id, "paused");
  const next = await addDownload(page, secondUrl);
  await waitForDownloads(page, 2);
  await waitForStatus(page, first.id, "paused");
  await waitForStatus(page, next.id, "running");
});

test("continue all never restarts completed or cancelled downloads", async (t) => {
  const page = await openPanel(t, 1280, "", 3);
  await page.locator("#url-input").fill([firstUrl, secondUrl, thirdUrl].join("\n"));
  await page.locator("#download-button").click();
  const [a, b, c] = await waitForDownloads(page, 3);
  const items = (await readState(page)).queue;
  await completeDownload(page, a.processId);
  await waitForStatus(page, items[0].id, "completed");
  await action(page, items[1].id, "cancel").click();
  await waitForStatus(page, items[1].id, "cancelled");
  await page.locator("#queue-pause").click();
  await waitForStatus(page, items[2].id, "paused");
  await page.locator("#queue-restore").click();
  const all = await waitForDownloads(page, 4);
  assert.equal(all[3].args.at(-1), thirdUrl);
  assert.deepEqual(
    (await readState(page)).queue.map((item) => item.status),
    ["completed", "cancelled", "running"],
  );
});

const analysisModels = {
  defaultModel: "custom/model",
  models: [
    {
      id: "custom/model",
      providerId: "custom",
      provider: "外部 Provider",
      model: "model",
      label: "分析模型",
    },
  ],
};
const analysisStarts = (page) =>
  page.evaluate(() => window.__calls.filter((call) => call.method === "agent.task.start"));
async function finishAnalysis(page, id, text) {
  await page.evaluate(
    ({ id, text }) => {
      const task = {
        id,
        key: "error-analysis",
        status: "completed",
        result: { reason: "completed", text },
      };
      window.__agentTasks[id] = task;
      window.__emit("agent.task.changed", task);
    },
    { id, text },
  );
}

test("AI error analysis remains available while another video downloads and uses the chosen Provider", async (t) => {
  const page = await openPanel(t, 1280, "", 2, { models: analysisModels });
  const first = await addDownload(page, firstUrl);
  const second = await addDownload(page, secondUrl);
  const processes = await waitForDownloads(page, 2);
  await completeDownload(page, processes[1].processId, {
    code: 1,
    error: "ERROR: HTTP 403 token=fixture-secret",
  });
  await waitForStatus(page, second.id, "failed");
  await page.locator('[data-tab="task"]').click();
  assert.equal(await page.locator("#analyze-error-button").isEnabled(), true);
  await page.locator("#analyze-error-button").click();
  await page.waitForFunction(
    () => document.querySelector("#analyze-error-label").textContent === "AI 分析中…",
  );
  const [request] = await analysisStarts(page);
  assert.equal(request.args.model, "custom/model");
  assert.deepEqual(request.args.toolNames, []);
  assert.match(request.args.prompt, /HTTP 403/);
  assert.doesNotMatch(request.args.prompt, /fixture-secret/);
  await finishAnalysis(page, "analysis-1", "请重新登录并保存账号后重试。");
  await page.waitForFunction(() => !document.querySelector("#error-analysis-result").hidden);
  assert.equal(
    await page.locator("#error-analysis-result").textContent(),
    "请重新登录并保存账号后重试。",
  );
  assert.equal(await page.locator("#analyze-error-button").isEnabled(), true);
  assert.equal((await readState(page)).queue.find((job) => job.id === first.id).status, "running");
  assert.equal((await downloads(page)).length, 2);
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((call) => call.method === "process.cancel").length,
    ),
    0,
  );
});

test("AI analysis blocks duplicate starts and ignores replies belonging to an earlier error", async (t) => {
  const page = await openPanel(t, 1280, "", 2, { models: analysisModels });
  const first = await addDownload(page, firstUrl);
  const second = await addDownload(page, secondUrl);
  const processes = await waitForDownloads(page, 2);
  await completeDownload(page, processes[1].processId, { code: 1 });
  await waitForStatus(page, second.id, "failed");
  await page.locator('[data-tab="task"]').click();
  await page.evaluate(() => {
    window.__holdAnalysisStart = true;
  });
  await page.locator("#analyze-error-button").click();
  assert.equal(await page.locator("#analyze-error-label").textContent(), "正在启动分析…");
  await page.locator("#analyze-error-button").dispatchEvent("click");
  assert.equal((await analysisStarts(page)).length, 1);
  // Editing the form clears its error, but must retain ownership of the AI request.
  await downloadForm(page);
  await page.locator("#url-input").fill(thirdUrl);
  await completeDownload(page, processes[0].processId, {
    code: 1,
    error: "ERROR: new network failure",
  });
  await waitForStatus(page, first.id, "failed");
  await page.locator('[data-tab="task"]').click();
  assert.equal(await page.locator("#analyze-error-button").isEnabled(), false);
  assert.match(await page.locator("#error-analysis-help").textContent(), /上一条错误/);
  await page.evaluate(() => {
    window.__holdAnalysisStart = false;
    window.__releaseAnalysisStart();
  });
  await page.waitForFunction(() => window.__calls.some((call) => call.method === "agent.task.get"));
  await finishAnalysis(page, "analysis-1", "旧错误的建议");
  await page.waitForFunction(() => !document.querySelector("#analyze-error-button").disabled);
  assert.equal(await page.locator("#error-analysis-result").isVisible(), false);
  await page.locator("#analyze-error-button").click();
  await page.waitForFunction(
    () => window.__calls.filter((call) => call.method === "agent.task.get").length === 2,
  );
  await finishAnalysis(page, "analysis-1", "重复到达的旧建议");
  assert.equal(await page.locator("#error-analysis-result").isVisible(), false);
  await finishAnalysis(page, "analysis-2", "新错误的建议");
  await page.waitForFunction(
    () => document.querySelector("#error-analysis-result").textContent === "新错误的建议",
  );
});

for (const error of ["", "Fixture model connection unavailable"]) {
  test(`AI analysis explains ${error ? "unavailable" : "missing"} models and recovers without reopening`, async (t) => {
    const page = await openPanel(t, 1280, "", 1, { error });
    const job = await addDownload(page, firstUrl);
    const [process] = await waitForDownloads(page, 1);
    await completeDownload(page, process.processId, { code: 1 });
    await waitForStatus(page, job.id, "failed");
    assert.equal(await page.locator("#analyze-error-button").isEnabled(), false);
    assert.match(
      await page.locator("#error-analysis-help").textContent(),
      error ? /模型列表读取失败.*刷新模型/ : /没有可用的 AI 模型.*刷新模型/,
    );
    await page.evaluate((models) => {
      window.__taskModels = models;
      window.__taskModelsError = "";
    }, analysisModels);
    await page.locator("#refresh-analysis-models").click();
    await page.waitForFunction(() => !document.querySelector("#analyze-error-button").disabled);
    assert.equal(await page.locator("#refresh-analysis-models").isVisible(), false);
    await page.evaluate(() => {
      window.__analysisStartError = "Fixture Provider unavailable";
    });
    await page.locator("#analyze-error-button").click();
    await page.waitForFunction(() =>
      document.querySelector("#error-analysis-help").textContent.includes("分析失败"),
    );
    assert.equal(await page.locator("#analyze-error-button").isEnabled(), true);
    await page.evaluate(() => {
      window.__analysisStartError = "";
    });
    await page.locator("#analyze-error-button").click();
    await page.waitForFunction(
      () => document.querySelector("#analyze-error-label").textContent === "AI 分析中…",
    );
    await finishAnalysis(page, "analysis-1", "连接已恢复");
    await page.waitForFunction(
      () => document.querySelector("#error-analysis-result").textContent === "连接已恢复",
    );
  });
}

async function nameDownload(page, processId, title) {
  await page.evaluate(
    ({ processId, title }) =>
      window.__emit("process.output", { processId, stream: "stdout", text: `meta:${title}\n` }),
    { processId, title },
  );
}

test("error cards identify their video and operation, stay dismissed and reopen from the matching task", async (t) => {
  const page = await openPanel(t, 1280, "", 3, { models: analysisModels });
  const first = await addDownload(page, firstUrl);
  const second = await addDownload(page, secondUrl);
  const third = await addDownload(page, thirdUrl);
  const processes = await waitForDownloads(page, 3);
  await nameDownload(page, processes[0].processId, "Blender 入门：基础建模");
  await nameDownload(page, processes[1].processId, "AI 剪辑：素材整理");
  await completeDownload(page, processes[0].processId, {
    code: 1,
    error: "ERROR: first video needs login",
  });
  await waitForStatus(page, first.id, "failed");
  await completeDownload(page, processes[1].processId, {
    code: 1,
    error: "ERROR: second video network failed",
  });
  await waitForStatus(page, second.id, "failed");
  assert.equal(await page.locator("#error-analysis-title").textContent(), "下载失败");
  assert.equal(await page.locator("#error-source-title").textContent(), "AI 剪辑：素材整理");
  assert.equal(await page.locator("#error-source-url").textContent(), secondUrl);
  assert.match(await page.locator("#error-source-time").textContent(), /发生于/);
  assert.match(await page.locator("#error-summary").textContent(), /second video network failed/);
  await page.locator("#dismiss-error").click();
  assert.equal(await page.locator("#error-analysis").isVisible(), false);
  assert.equal((await readState(page)).lastFailure, null);
  await page.evaluate(
    (processId) =>
      window.__emit("process.output", {
        processId,
        stream: "stdout",
        text: "progress:32%|1MiB/s|00:20\n",
      }),
    processes[2].processId,
  );
  assert.equal(await page.locator("#error-analysis").isVisible(), false);
  assert.equal((await readState(page)).queue.length, 3);
  await action(page, first.id, "details").click();
  assert.equal(await page.locator("#error-source-title").textContent(), "Blender 入门：基础建模");
  assert.equal((await readState(page)).lastFailure.queueId, first.id);
  assert.match(await page.locator("#error-summary").textContent(), /first video needs login/);
  await page.locator("#error-task-link").click();
  assert.equal(await page.locator("#task-title").textContent(), "Blender 入门：基础建模");
  for (const width of [1280, 340]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.locator("#dismiss-error").isVisible(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: resolve(artifacts, `error-context-${width}.png`),
      fullPage: true,
    });
    await page
      .locator("#error-analysis")
      .screenshot({ path: resolve(artifacts, `error-card-${width}.png`) });
  }
  await taskAction(page, second.id, "details").click();
  assert.equal(await page.locator("#error-source-url").textContent(), secondUrl);
  await action(page, third.id, "details").click();
  assert.equal(await page.locator("#error-analysis").isVisible(), false);
  await action(page, first.id, "details").click();
  await action(page, first.id, "retry").click();
  await waitForDownloads(page, 4);
  assert.equal(await page.locator("#error-analysis").isVisible(), false);
});

test("stopping AI analysis waits for its task to stop and leaves video downloads running", async (t) => {
  const page = await openPanel(t, 1280, "", 2, { models: analysisModels });
  const first = await addDownload(page, firstUrl);
  const second = await addDownload(page, secondUrl);
  const processes = await waitForDownloads(page, 2);
  await completeDownload(page, processes[1].processId, { code: 1 });
  await waitForStatus(page, second.id, "failed");
  await page.locator('[data-tab="task"]').click();
  await page.locator("#analyze-error-button").click();
  await page.waitForFunction(
    () => document.querySelector("#analyze-error-label").textContent === "AI 分析中…",
  );
  await page.evaluate(() => {
    window.__holdAnalysisCancel = true;
  });
  await page.locator("#cancel-error-analysis").click();
  assert.equal(await page.locator("#analyze-error-button").isEnabled(), false);
  assert.match(await page.locator("#analyze-error-label").textContent(), /正在停止/);
  assert.deepEqual(
    await page.evaluate(() =>
      window.__calls.filter((call) => call.method === "agent.task.cancel").map((call) => call.args),
    ),
    [{ id: "analysis-1" }],
  );
  await page.evaluate(() =>
    window.__emit("agent.task.changed", {
      id: "analysis-1",
      key: "error-analysis",
      status: "cancelled",
    }),
  );
  await page.waitForFunction(() => !document.querySelector("#analyze-error-button").disabled);
  assert.match(await page.locator("#error-analysis-help").textContent(), /AI 分析已停止/);
  assert.equal(await page.locator("#error-analysis").isVisible(), true);
  assert.equal((await readState(page)).queue.find((job) => job.id === first.id).status, "running");
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((call) => call.method === "process.cancel").length,
    ),
    0,
  );
});

test("closing an error during AI creation cancels its late receipt and stays closed", async (t) => {
  const page = await openPanel(t, 1280, "", 1, { models: analysisModels });
  const first = await addDownload(page, firstUrl);
  const [process] = await waitForDownloads(page, 1);
  await completeDownload(page, process.processId, { code: 1 });
  await waitForStatus(page, first.id, "failed");
  await page.evaluate(() => {
    window.__holdAnalysisStart = true;
  });
  await page.locator("#analyze-error-button").click();
  assert.equal(await page.locator("#dismiss-error").textContent(), "停止并关闭");
  await page.locator("#dismiss-error").click();
  assert.match(await page.locator("#analyze-error-label").textContent(), /正在停止/);
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((call) => call.method === "agent.task.cancel").length,
    ),
    0,
  );
  await page.evaluate(() => window.__releaseAnalysisStart());
  await page.waitForFunction(() => document.querySelector("#error-analysis").hidden);
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((call) => call.method === "agent.task.cancel").length,
    ),
    1,
  );
  await finishAnalysis(page, "analysis-1", "停止后迟到的回复");
  assert.equal(await page.locator("#error-analysis").isVisible(), false);
  await action(page, first.id, "details").click();
  assert.equal(await page.locator("#error-analysis-result").isVisible(), false);
  assert.match(await page.locator("#error-analysis-help").textContent(), /已停止/);
});

test("failed AI cancellation keeps a retryable stop control instead of pretending the task stopped", async (t) => {
  const page = await openPanel(t, 1280, "", 1, { models: analysisModels });
  const first = await addDownload(page, firstUrl);
  const [process] = await waitForDownloads(page, 1);
  await completeDownload(page, process.processId, { code: 1 });
  await waitForStatus(page, first.id, "failed");
  await page.locator("#analyze-error-button").click();
  await page.waitForFunction(
    () => document.querySelector("#analyze-error-label").textContent === "AI 分析中…",
  );
  await page.evaluate(() => {
    window.__rejectAnalysisCancel = true;
  });
  await page.locator("#dismiss-error").click();
  await page.waitForFunction(() =>
    document.querySelector("#error-analysis-help").textContent.includes("停止分析失败"),
  );
  assert.equal(await page.locator("#cancel-error-analysis").isEnabled(), true);
  assert.equal(await page.locator("#analyze-error-button").isEnabled(), false);
  await page.evaluate(() => {
    window.__rejectAnalysisCancel = false;
  });
  await page.locator("#dismiss-error").click();
  await page.waitForFunction(() => document.querySelector("#error-analysis").hidden);
});

test("saved failed tasks recover their own error details after reopening without showing a stale banner", async (t) => {
  const page = await openPanel(t, 1280, "", 1, { models: analysisModels });
  const job = await addDownload(page, firstUrl);
  const [process] = await waitForDownloads(page, 1);
  await nameDownload(page, process.processId, "重新打开后可查看的错误");
  await completeDownload(page, process.processId, {
    code: 1,
    error: "ERROR: saved task network failure",
  });
  await waitForStatus(page, job.id, "failed");
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector("#installed-ytdlp-version").textContent === "2026.09.17" &&
      !document.querySelector("#refresh-versions").disabled,
  );
  assert.equal(await page.locator("#error-analysis").isVisible(), false);
  await action(page, job.id, "details").click();
  assert.equal(await page.locator("#error-source-title").textContent(), "重新打开后可查看的错误");
  assert.equal(await page.locator("#error-source-url").textContent(), firstUrl);
  assert.match(await page.locator("#error-summary").textContent(), /saved task network failure/);
  assert.equal((await readState(page)).lastFailure.queueId, job.id);
});

test("successful retry replaces failure and history navigation highlights expire without returning on refresh", async (t) => {
  const page = await openPanel(t, 1280, "", 2);
  const first = await addDownload(page, firstUrl);
  const second = await addDownload(page, secondUrl);
  const [a, b] = await waitForDownloads(page, 2);
  await completeDownload(page, a.processId, { code: 1 });
  await waitForStatus(page, first.id, "failed");
  await action(page, first.id, "retry").click();
  const resumed = (await waitForDownloads(page, 3))[2];
  await completeDownload(page, resumed.processId, {
    title: "Getting started - Blender for complete beginners",
  });
  await waitForStatus(page, first.id, "completed");
  assert.equal((await readState(page)).queue.find((job) => job.id === first.id).error, null);
  assert.equal(await page.locator("#error-analysis").isVisible(), false);
  await action(page, first.id, "open").click();
  assert.equal(await page.locator(".history-item").count(), 1);
  assert.match(await page.locator(".history-status").textContent(), /已完成/);
  assert.equal(await page.locator(".history-highlight").count(), 1);
  await page.screenshot({ path: resolve(artifacts, "history-locate-neutral.png"), fullPage: true });
  await page.waitForFunction(() => !document.querySelector(".history-highlight"), null, {
    timeout: 4500,
  });
  assert.equal(await page.locator("#history-jump-status").textContent(), "");
  await completeDownload(page, b.processId, { title: "Another completed video" });
  await waitForStatus(page, second.id, "completed");
  assert.equal(await page.locator(".history-highlight").count(), 0);
  await action(page, first.id, "open").click();
  await page.locator("#history-search").fill("Getting started");
  assert.equal(await page.locator(".history-highlight").count(), 0);
  await action(page, first.id, "open").click();
  await page.locator('[data-tab="download"]').click();
  await page.locator('[data-tab="history"]').click();
  assert.equal(await page.locator(".history-highlight").count(), 0);
  assert.equal(await page.locator("#history-jump-status").textContent(), "");
  await page.screenshot({ path: resolve(artifacts, "history-locate-cleared.png"), fullPage: true });
});

for (const name of ["yt-dlp", "ffmpeg"]) {
  test(`a broken ${name} is not ready and rechecking after repair restores readiness`, async (t) => {
    const page = await openPanel(t);
    if (name === "ffmpeg") await page.locator("#quality-select").selectOption("audio");
    await page.evaluate((name) => {
      window.__brokenExecutable = `executable-${name}`;
    }, name);
    const failed = await page.evaluate(() =>
      window.__panelTools.refresh_video_download_dependencies(),
    );
    assert.equal(failed.ready, false);
    assert.equal(name === "yt-dlp" ? failed.ytDlp : failed.ffmpeg, false);
    assert.notEqual(await page.locator("#runtime-badge").getAttribute("data-state"), "ready");
    assert.match(await page.locator("#version-comparison").textContent(), /无法正常运行/);
    await page.locator("#url-input").fill(firstUrl);
    if (name === "yt-dlp") {
      assert.equal(await page.locator("#download-button").isDisabled(), true);
      assert.equal(await page.locator("#inspect-button").isDisabled(), true);
    } else {
      assert.equal(await page.locator("#quality-select").inputValue(), "best");
      assert.equal(
        await page
          .locator('#quality-select option[value="audio"]')
          .evaluate((option) => option.disabled),
        true,
      );
    }
    await page.evaluate(() => {
      window.__brokenExecutable = "";
    });
    const repaired = await page.evaluate(() =>
      window.__panelTools.refresh_video_download_dependencies(),
    );
    assert.equal(repaired.ready, true);
    assert.equal(await page.locator("#runtime-badge").getAttribute("data-state"), "ready");
    assert.equal(await page.locator("#download-button").isDisabled(), false);
  });
}

test("an unavailable release server does not mark working local tools broken", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__brokenExecutable = "executable-curl";
  });
  const result = await page.evaluate(() =>
    window.__panelTools.refresh_video_download_dependencies(),
  );
  assert.equal(result.ready, true);
  assert.match(result.versions.error, /GitHub/);
  assert.equal(await page.locator("#runtime-badge").getAttribute("data-state"), "ready");
});

for (const width of [390, 1440]) {
  test(`another device's queue edit is preserved and blocks downloads at ${width}px`, async (t) => {
    const page = await openPanel(t, width, "", 1, { versionedStorage: true });
    await page.waitForFunction(
      () => window.__hostStorage["video-download.library.v2"]?.maxConcurrent === 1,
    );
    await page.evaluate(() => {
      window.__hostStorage["video-download.library.v2"] = {
        scope: "/fixture/project",
        marker: "phone draft",
      };
      window.__hostStorageRevision++;
    });
    await downloadForm(page);
    await page.locator("#url-input").fill(firstUrl);
    await page.locator("#download-button").click();
    await page.waitForFunction(() =>
      document.querySelector("#library-status").textContent.includes("其他页面或设备"),
    );
    assert.equal((await downloads(page)).length, 0, "an unsaved queue must not start downloading");
    assert.equal(
      await page.evaluate(() => window.__hostStorage["video-download.library.v2"].marker),
      "phone draft",
    );
    assert.match(await page.locator("#library-status").textContent(), /重新打开面板/);
    const count = await page.evaluate(
      () => window.__calls.filter((call) => call.method === "storage.compareAndSet").length,
    );
    await page.locator("#download-button").click();
    assert.equal(
      await page.evaluate(
        () => window.__calls.filter((call) => call.method === "storage.compareAndSet").length,
      ),
      count,
    );
  });
}

test("durable UI admits every item, recovers completed output on reload, and never restarts it", async (t) => {
  const page = await openPanel(t, 390, "", null, { durable: true });
  await page.locator("#url-input").fill(firstUrl + "\n" + secondUrl + "\n" + thirdUrl);
  await page.locator("#download-button").click();
  await page.waitForFunction(() => Object.keys(window.__nativeJobs).length === 3, null, {
    timeout: 15000,
  });
  assert.equal((await downloads(page)).length, 0);
  await page.waitForFunction(
    () =>
      document.querySelector("#library-status")?.textContent.includes("关闭页面后继续") ||
      [...document.querySelectorAll("p,span")].some((node) =>
        node.textContent.includes("关闭页面后继续"),
      ),
  );
  await page.evaluate(() => {
    for (const job of Object.values(window.__nativeJobs)) {
      job.status = "succeeded";
      job.sequence++;
      job.result = { artifacts: [{ published: { path: job.id + ".mp4" }, bytes: 1000 }] };
    }
    localStorage.setItem("fixture-native-jobs", JSON.stringify(window.__nativeJobs));
  });
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll('.queue-item[data-state="completed"]').length === 3,
    null,
    { timeout: 15000 },
  );
  const state = await readState(page);
  assert.equal(state.queue.length, 3);
  assert.ok(
    state.queue.every((item) => item.status === "completed"),
    JSON.stringify({
      queue: state.queue,
      calls: await page.evaluate(() =>
        window.__calls.filter((call) => call.method.startsWith("tasks.")),
      ),
    }),
  );
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((call) => call.method === "tasks.start").length,
    ),
    0,
  );
});

test("durable UI recovers a missing start reply and removes only after cancelling the Host job", async (t) => {
  const page = await openPanel(t, 1440, "", null, { durable: true });
  await page.evaluate(() => {
    window.__loseNativeStart = true;
  });
  const item = await addDownload(page, firstUrl);
  await page.waitForFunction(
    () => window.__calls.filter((call) => call.method === "tasks.find").length >= 2,
  );
  await action(page, item.id, "remove").click();
  await page.waitForFunction(() => Object.values(window.__nativeJobs)[0]?.status === "cancelled");
  assert.equal(await page.evaluate(() => Object.keys(window.__nativeJobs).length), 1);
  assert.equal((await downloads(page)).length, 0);
});

test("durable UI pause-all then resume-one leaves the other download stopped", async (t) => {
  const page = await openPanel(t, 390, "", null, { durable: true });
  const first = await addDownload(page, firstUrl);
  await addDownload(page, secondUrl);
  await page.waitForFunction(() => Object.keys(window.__nativeJobs).length === 2, null, {
    timeout: 15000,
  });
  await page.locator("#queue-pause").click();
  await page.waitForFunction(
    () =>
      Object.values(window.__nativeJobs).every((job) => job.status === "cancelled") &&
      document.querySelectorAll('.queue-item[data-state="paused"]').length === 2,
    null,
    { timeout: 15000 },
  );
  await action(page, first.id, "resume").click();
  await page.waitForFunction(
    () =>
      Object.values(window.__nativeJobs).filter((job) => job.status === "queued").length === 1 &&
      !window.__nativeQueue.paused,
    null,
    { timeout: 15000 },
  );
  assert.equal(
    Object.values(await page.evaluate(() => window.__nativeJobs)).filter(
      (job) => job.status === "cancelled",
    ).length,
    1,
  );
});

for (const width of [390, 1440]) {
  test(`background account downloads retain the original grant on retry and explicitly replace it at ${width}px`, async (t) => {
    const page = await openPanel(t, width, "", null, { durable: true, taskCookies: true });
    await page.evaluate(() => {
      window.__cookieAccounts = [
        { id: "original", label: "Original account", revision: "a".repeat(64) },
        { id: "replacement", label: "Replacement account", revision: "b".repeat(64) },
      ];
    });
    await page.locator("#url-input").fill(firstUrl);
    await page.locator("#cookie-refresh").click();
    await page.locator("#cookie-select").selectOption("original");
    assert.equal(await page.locator("#cookie-login").isDisabled(), true);
    await page.locator("#download-button").click();
    await page.waitForFunction(() => Object.keys(window.__nativeJobs).length === 1);
    const original = Object.values(await page.evaluate(() => window.__nativeJobs))[0];
    assert.equal(original.input.cookieArgument.credentialId, "original");
    assert.equal(original.input.cookieArgument.revision, "a".repeat(64));
    assert.equal(original.input.request.useSavedLogin, true);
    await page.evaluate(() => {
      const job = Object.values(window.__nativeJobs)[0];
      job.status = "failed";
      job.sequence++;
      localStorage.setItem("fixture-native-jobs", JSON.stringify(window.__nativeJobs));
    });
    await page.reload();
    await page.waitForSelector('.queue-item[data-state="failed"]');
    const row = page.locator('.queue-item[data-state="failed"]').first();
    await page.locator("#url-input").fill(firstUrl);
    await page.evaluate(() => {
      window.__cookieAccounts = [
        { id: "replacement", label: "Replacement account", revision: "b".repeat(64) },
      ];
    });
    await page.locator("#cookie-refresh").click();
    await page.locator("#cookie-select").selectOption("replacement");
    await row.locator('[data-queue-action="retry"]').click();
    await page.waitForFunction(() => window.__calls.some((call) => call.method === "tasks.retry"));
    assert.equal(
      Object.values(await page.evaluate(() => window.__nativeJobs))[0].input.cookieArgument
        .credentialId,
      "original",
    );
    await page.evaluate(() => {
      const job = Object.values(window.__nativeJobs)[0];
      job.status = "failed";
      job.sequence++;
      window.__emit("tasks.changed", structuredClone(job));
    });
    await page.waitForSelector('.queue-item[data-state="failed"]');
    await page.locator('[data-queue-action="retry-account"]').first().click();
    await page.waitForFunction(() => Object.keys(window.__nativeJobs).length === 2, null, {
      timeout: 15000,
    });
    const jobs = Object.values(await page.evaluate(() => window.__nativeJobs));
    assert.equal(
      jobs.find((job) => job.id !== original.id).input.cookieArgument.credentialId,
      "replacement",
    );
    assert.equal(
      jobs.find((job) => job.id === original.id).input.cookieArgument.credentialId,
      "original",
    );
    assert.equal((await downloads(page)).length, 0);
  });
}

test("denied background account submission never falls back to an anonymous or page process", async (t) => {
  const page = await openPanel(t, 390, "", null, { durable: true, taskCookies: true });
  await page.evaluate(() => {
    window.__cookieAccounts = [{ id: "private", label: "Private", revision: "a".repeat(64) }];
    const call = window.codeshellPanel.call.bind(window.codeshellPanel);
    window.codeshellPanel.call = async (method, args) => {
      if (method === "tasks.start") {
        window.__calls.push({ method, args });
        throw new Error("已取消账号授权");
      }
      return call(method, args);
    };
  });
  await page.locator("#url-input").fill(firstUrl);
  await page.locator("#cookie-refresh").click();
  await page.locator("#cookie-select").selectOption("private");
  await page.locator("#download-button").click();
  await page.waitForSelector('.queue-item[data-state="failed"]');
  const starts = await page.evaluate(() =>
    window.__calls.filter((call) => call.method === "tasks.start"),
  );
  assert.equal(starts.length, 1);
  assert.equal(starts[0].args.input.cookieArgument.credentialId, "private");
  assert.equal(Object.keys(await page.evaluate(() => window.__nativeJobs)).length, 0);
  assert.equal((await downloads(page)).length, 0);
});

test("an account changed after selection cannot be silently substituted at background admission", async (t) => {
  const page = await openPanel(t, 390, "", null, { durable: true, taskCookies: true });
  await page.evaluate(() => {
    window.__cookieAccounts = [{ id: "saved", label: "Saved account", revision: "a".repeat(64) }];
  });
  await page.locator("#url-input").fill(firstUrl);
  await page.locator("#cookie-refresh").click();
  await page.locator("#cookie-select").selectOption("saved");
  await page.evaluate(() => {
    window.__cookieAccounts[0].revision = "b".repeat(64);
  });
  await page.locator("#download-button").click();
  await page.waitForFunction(() => document.body.textContent.includes("原账号授权已变化"));
  assert.equal(Object.keys(await page.evaluate(() => window.__nativeJobs)).length, 0);
  assert.equal((await downloads(page)).length, 0);
  assert.equal(await page.locator("#cookie-select").inputValue(), "saved");
});

for (const width of [390, 1440]) {
  test(`saved-account metadata inspection remains usable with the download queue paused at ${width}px`, async (t) => {
    const page = await openPanel(t, width, "", null, {
      durable: true,
      taskCookies: true,
      processCookies: true,
    });
    await page.evaluate(() => {
      window.__nativeQueue.paused = true;
      window.__cookieAccounts = [{ id: "saved", label: "Saved account", revision: "a".repeat(64) }];
    });
    await page.locator("#url-input").fill(firstUrl);
    await page.locator("#cookie-refresh").click();
    await page.locator("#cookie-select").selectOption("saved");
    await page.locator("#inspect-button").click();
    await page.waitForFunction(() =>
      window.__downloads.some((call) => call.args.includes("--dump-single-json")),
    );
    const authorization = await page.evaluate(() =>
      window.__calls.find((call) => call.method === "credentials.cookies.authorizeProcess"),
    );
    assert.equal(authorization.args.revision, "a".repeat(64));
    await page.evaluate(() => {
      const query = window.__downloads.find((call) => call.args.includes("--dump-single-json"));
      if (query.fileArgumentHandles[0] !== "cookie-file-1")
        throw new Error("missing sealed account");
      window.__emit("process.output", {
        processId: query.processId,
        stream: "stdout",
        text: JSON.stringify({
          id: "fixture",
          title: "Account metadata fixture",
          duration: 10,
          formats: [],
        }),
      });
      window.__emit("process.exit", { processId: query.processId, code: 0 });
    });
    await page.waitForFunction(
      () => document.querySelector("#inspect-status").dataset.state === "ready",
    );
    assert.ok(await page.getByText("Account metadata fixture", { exact: true }).count());
    assert.equal(await page.evaluate(() => window.__nativeQueue.paused), true);
    assert.equal(
      await page.evaluate(
        () => window.__calls.filter((call) => call.method === "tasks.start").length,
      ),
      0,
    );
  });
}

test("LAN browsers without randomUUID can submit distinct durable downloads", async (t) => {
  const page = await openPanel(t, 390, "", 1, { durable: true, noRandomUuid: true });
  assert.equal(await page.evaluate(() => typeof crypto.randomUUID), "undefined");
  await addDownload(page, firstUrl);
  await addDownload(page, secondUrl);
  await page.waitForFunction(() => Object.keys(window.__nativeJobs).length === 2);
  const jobs = await page.evaluate(() => Object.values(window.__nativeJobs));
  const keys = jobs.map((job) => job.requestKey);
  assert.equal(new Set(keys).size, 2);
  for (const key of keys)
    assert.match(
      key,
      /^download:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
  assert.equal(await page.locator("#form-error").innerText(), "");
});
