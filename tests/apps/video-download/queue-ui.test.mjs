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
async function openPanel(t, width = 1280, projectDirectoryError = "", concurrency = 1) {
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
    ({ projectDirectoryError }) => {
      const handlers = {};
      let nextProcess = 0;
      window.__panelTools = {};
      window.__calls = [];
      window.__downloads = [];
      window.__heldSpawns = {};
      window.__holdNextDownload = false;
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
      window.codeshellPanel = {
        getContext: async () => ({ apiVersion: 10, theme: "light" }),
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
          if (method === "agent.task.models") return { models: [], defaultModel: "" };
          if (method === "agent.task.list") return [];
          if (method === "filesystem.getKnownDirectory") {
            if (args.name !== "project")
              throw new Error(`Unexpected known directory: ${args.name}`);
            if (projectDirectoryError) throw new Error(projectDirectoryError);
            return { handle: "directory-first", name: "Project", path: "/fixture/project" };
          }
          if (method === "filesystem.pickDirectory") return structuredClone(window.__nextDirectory);
          if (method === "filesystem.openDirectory") return { opened: true };
          if (method === "credentials.cookies.list") {
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
            const isVersion = args.args.includes("--version");
            const isRelease = args.executableHandle === "executable-curl";
            if (isVersion || isRelease) {
              setTimeout(() => {
                window.__emit("process.output", {
                  processId,
                  stream: "stdout",
                  text: isVersion ? "2026.09.17\n" : '{"tag_name":"2026.09.17"}\n',
                });
                window.__emit("process.exit", { processId, code: 0 });
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
    { projectDirectoryError },
  );
  await page.goto(baseUrl);
  await page.waitForFunction((projectDirectoryError) => {
    return (
      window.__panelTools?.get_video_download_context &&
      (projectDirectoryError
        ? document.querySelector("#runtime-badge").dataset.state === "ready"
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

async function downloadForm(page) {
  if (!(await page.locator("#url-input").isVisible())) {
    await page.locator('[data-tab="download"]').click();
  }
}

async function addDownload(page, url) {
  await downloadForm(page);
  const before = (await readState(page)).queue.length;
  await page.locator("#url-input").fill(url);
  await page.locator("#download-button").click();
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
  assert.match(secondProcess.args[secondProcess.args.indexOf("--format") + 1], /height<=720/);
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
