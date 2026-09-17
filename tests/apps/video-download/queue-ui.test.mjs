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
async function openPanel(t, width = 1280, projectDirectoryError = "") {
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

test("pause, remove, resume, cancel and clear only affect the selected queue entries", async (t) => {
  const page = await openPanel(t);
  const first = await addDownload(page, firstUrl);
  const [firstProcess] = await waitForDownloads(page, 1);
  const second = await addDownload(page, secondUrl);
  const third = await addDownload(page, thirdUrl);
  await page.locator("#queue-pause").click();
  await action(page, third.id, "remove").click();
  assert.equal(await row(page, third.id).count(), 0);
  assert.equal(
    (await readState(page)).queue.some((item) => item.id === third.id),
    false,
  );
  await completeDownload(page, firstProcess.processId);
  await waitForStatus(page, first.id, "completed");
  await waitForStatus(page, second.id, "queued");
  assert.equal(
    (await downloads(page)).length,
    1,
    "Paused queues must not advance after completion",
  );
  await page.locator("#queue-clear").click();
  assert.equal(await row(page, first.id).count(), 0);
  assert.equal(await row(page, second.id).count(), 1, "Clear keeps pending work");

  await page.locator("#queue-pause").click();
  const [, secondProcess] = await waitForDownloads(page, 2);
  const fourth = await addDownload(page, "https://www.youtube.com/watch?v=queue-fourth");
  await action(page, second.id, "cancel").click();
  await waitForStatus(page, second.id, "cancelled");
  const [, , fourthProcess] = await waitForDownloads(page, 3);
  await waitForStatus(page, fourth.id, "running");
  const cancelled = await page.evaluate(() =>
    window.__calls.filter(({ method }) => method === "process.cancel"),
  );
  assert.deepEqual(
    cancelled.map(({ args }) => args.processId),
    [secondProcess.processId],
  );
  assert.ok((await downloads(page)).every((item) => item.args.at(-1) !== thirdUrl));
  await page.locator("#queue-clear").click();
  assert.equal(await row(page, second.id).count(), 0);
  assert.equal(await row(page, fourth.id).count(), 1, "Clear keeps the running download");
  await completeDownload(page, fourthProcess.processId);
  await waitForStatus(page, fourth.id, "completed");
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
