import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const appDirectory = resolve(root, "apps/video-download/app");
const firstUrl = "https://www.youtube.com/watch?v=library-first";
const secondUrl = "https://www.youtube.com/watch?v=library-second";
const otherSiteUrl = "https://www.bilibili.com/video/BVfixture";
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
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
});

// Real page/module/event behavior with a synthetic API 14 Host. Host storage is
// backed by this isolated browser context's localStorage so reload tests model
// a new Panel lifetime without touching accounts, real files or remote services.
async function openPanel(t, { width = 1100, colorScheme = "light", concurrency = 1 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
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
    errors.push(`Unexpected remote resource: ${route.request().url()}`);
    return route.abort();
  });
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "Library actions must not throw or request real remote resources");
  });
  await page.addInitScript(() => {
    const handlers = {};
    const records = new Map();
    let nextProcess = 0;
    window.__panelTools = {};
    window.__calls = [];
    window.__downloads = [];
    window.__fileActions = [];
    window.__cookieAccounts = JSON.parse(localStorage.getItem("fixture.cookieAccounts") || "[]");
    window.__authorizations = [];
    window.__denyCookieAuthorization = false;
    window.__failStorage = false;
    window.__holdNextNative = false;
    window.__heldNativeSpawns = {};
    window.__inspectionPayload = null;
    window.__inspectionPayloadByUrl = {};
    window.__inspectionFailureByUrl = {};
    window.__holdInspection = false;
    window.__holdInspectionSpawn = false;
    window.__holdNextDownload = false;
    window.__rejectInspectionCancel = false;
    window.__nativeRequests = [];
    window.__fileMap = JSON.parse(localStorage.getItem("fixture.files") || "{}");
    window.__searchPayload = { entries: [] };
    window.__nextDirectory = {
      handle: "directory-other",
      name: "Other",
      path: "/fixture/other",
      bookmark: "a0123456-1234-4567-8901-123456789abc",
    };
    window.__restoreDirectoryUnavailable = localStorage.getItem("fixture.legacyHost") === "true";
    window.__setFiles = (files) => {
      Object.assign(window.__fileMap, files);
      localStorage.setItem("fixture.files", JSON.stringify(window.__fileMap));
    };
    window.__emit = (event, payload) => {
      const record = records.get(payload.processId);
      if (record) {
        record.events.push({
          sequence: record.events.length + 1,
          event,
          payload: structuredClone(payload),
        });
        if (event === "process.exit") {
          record.status = "exited";
          record.code = payload.code;
        }
      }
      for (const handler of handlers[event] || []) handler(structuredClone(payload));
    };
    const finish = (processId, text, code = 0) => {
      if (text) window.__emit("process.output", { processId, stream: "stdout", text });
      window.__emit("process.exit", { processId, code });
    };
    const fileResult = (file) => {
      const actual = window.__fileMap[file.path] || { status: "missing" };
      let status = actual.status;
      if (
        status === "present" &&
        ((file.bytes !== undefined && file.bytes !== (actual.bytes ?? 100)) ||
          (file.modifiedAt !== undefined && file.modifiedAt !== (actual.modifiedAt ?? 1000)))
      )
        status = "changed";
      return {
        path: file.path,
        status,
        ...(["present", "changed", "empty"].includes(status)
          ? { bytes: actual.bytes ?? 100, modifiedAt: actual.modifiedAt ?? 1000 }
          : {}),
      };
    };
    window.codeshellPanel = {
      getContext: async () => ({
        apiVersion: 14,
        theme: "light",
        workspace: { root: "/fixture/project", trusted: true },
        projectPath: "/fixture/project",
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
        if (method === "storage.get")
          return JSON.parse(localStorage.getItem(`fixture.storage.${args.key}`) || "null");
        if (method === "storage.set") {
          if (window.__failStorage) throw new Error("Fixture storage is unavailable");
          localStorage.setItem(`fixture.storage.${args.key}`, JSON.stringify(args.value));
          return true;
        }
        if (method === "agent.task.models") return { models: [], defaultModel: "" };
        if (method === "agent.task.list") return [];
        if (method === "filesystem.getKnownDirectory") {
          if (args.name !== "project") throw new Error(`Unexpected known directory: ${args.name}`);
          return { handle: "directory-project", name: "Project", path: "/fixture/project" };
        }
        if (method === "filesystem.pickDirectory") return structuredClone(window.__nextDirectory);
        if (method === "filesystem.restoreDirectory") {
          if (window.__restoreDirectoryUnavailable) throw new Error("unknown Panel App method");
          if (args.bookmark !== window.__nextDirectory.bookmark)
            throw new Error("invalid bookmark");
          return structuredClone(window.__nextDirectory);
        }
        if (method === "filesystem.openDirectory") return { opened: true };
        if (method === "credentials.cookies.list")
          return { accounts: structuredClone(window.__cookieAccounts) };
        if (method === "credentials.cookies.authorizeProcess") {
          window.__authorizations.push(structuredClone(args));
          return window.__denyCookieAuthorization
            ? { authorized: false, cancelled: true }
            : {
                authorized: true,
                fileArgumentHandle: `cookie-grant-${Date.now()}-${window.__authorizations.length}`,
              };
        }
        if (method === "process.find")
          return {
            available: true,
            name: args.name,
            handle: `executable-${args.name}`,
            path: `/fixture/bin/${args.name}`,
          };
        if (method === "process.resolveEntry") {
          if (args.name !== "download-library") throw new Error("Unreviewed entry");
          return { handle: "entry-download-library" };
        }
        if (method === "process.spawn") {
          const processId = `process-${++nextProcess}`;
          records.set(processId, {
            status: "running",
            code: null,
            events: [],
            input: "",
            args: structuredClone(args),
          });
          const argv = args.args || [];
          if (args.entryHandle) {
            if (args.entryHandle !== "entry-download-library" || args.stdin !== "pipe")
              throw new Error("Invalid native entry invocation");
            if (window.__holdNextNative) {
              window.__holdNextNative = false;
              return new Promise((resolveSpawn) => {
                window.__heldNativeSpawns[processId] = () => {
                  delete window.__heldNativeSpawns[processId];
                  resolveSpawn({ processId });
                };
              });
            }
          } else if (argv.includes("--version") || args.executableHandle === "executable-curl") {
            setTimeout(
              () =>
                finish(
                  processId,
                  argv.includes("--version") ? "2026.09.17\n" : '{"tag_name":"2026.09.17"}\n',
                ),
              0,
            );
          } else if (argv.some((arg) => /^ytsearch/.test(arg))) {
            setTimeout(() => finish(processId, JSON.stringify(window.__searchPayload) + "\n"), 0);
          } else if (argv.includes("--dump-single-json") || argv.includes("--dump-json")) {
            const sourceUrl = argv.at(-1);
            if (window.__holdInspection) {
              window.__heldInspection = { processId, url: sourceUrl };
              if (window.__holdInspectionSpawn)
                return new Promise((resolve) => {
                  window.__releaseInspectionSpawn = () => resolve({ processId });
                });
              return { processId };
            }
            const payload = Object.hasOwn(window.__inspectionPayloadByUrl, sourceUrl)
              ? window.__inspectionPayloadByUrl[sourceUrl]
              : window.__inspectionPayload;
            if (window.__inspectionFailureByUrl[sourceUrl]) {
              setTimeout(() => {
                window.__emit("process.output", {
                  processId,
                  stream: "stderr",
                  text: `ERROR: ${window.__inspectionFailureByUrl[sourceUrl]}`,
                });
                finish(processId, "", 1);
              }, 0);
              return { processId, executable: args.executableHandle };
            }
            setTimeout(
              () =>
                finish(
                  processId,
                  JSON.stringify(
                    payload || {
                      id: "fixture-video",
                      title: `Fixture video ${sourceUrl}`,
                      webpage_url: sourceUrl,
                      duration: 60,
                      formats: [],
                    },
                  ) + "\n",
                ),
              0,
            );
          } else {
            window.__downloads.push({ ...structuredClone(args), processId });
            if (window.__holdNextDownload) {
              window.__holdNextDownload = false;
              return new Promise((resolve) => {
                window.__releaseDownloadSpawn = () => resolve({ processId });
              });
            }
          }
          return { processId, executable: args.executableHandle };
        }
        if (method === "process.write") {
          const record = records.get(args.processId);
          if (!record) throw new Error("Unknown process");
          record.input += args.text;
          return { written: args.text.length };
        }
        if (method === "process.end") {
          const record = records.get(args.processId);
          if (!record) throw new Error("Unknown process");
          const request = JSON.parse(record.input);
          if (
            request.files.some((file) =>
              Object.keys(file).some((key) => !["path", "bytes", "modifiedAt"].includes(key)),
            )
          ) {
            throw new Error("Native request must not include persisted status or runtime handles");
          }
          window.__nativeRequests.push({
            ...request,
            directoryHandle: record.args.directoryHandle,
          });
          const files = request.files.map(fileResult);
          if (request.action !== "check" && files.every(({ status }) => status === "present")) {
            if (window.__failFileOpen) files[0].error = "unable-to-open-file";
            else {
              if (request.action === "play") files[0].player = "Google Chrome";
              window.__fileActions.push({
                action: request.action,
                files,
                directoryHandle: record.args.directoryHandle,
              });
            }
          }
          finish(args.processId, JSON.stringify({ files }) + "\n");
          return { ended: true };
        }
        if (method === "process.get") {
          const record = records.get(args.processId);
          if (!record) return { found: false, processId: args.processId };
          const events = record.events
            .filter(({ sequence }) => sequence > (args.afterSequence || 0))
            .slice(0, args.limit || 128);
          const nextSequence = events.at(-1)?.sequence || args.afterSequence || 0;
          return {
            found: true,
            processId: args.processId,
            status: record.status,
            code: record.code,
            events,
            sequence: record.events.length,
            nextSequence,
            hasMore: nextSequence < record.events.length,
            truncated: false,
          };
        }
        if (method === "process.cancel") {
          if (window.__rejectInspectionCancel) throw new Error("暂时无法取消");
          setTimeout(() => finish(args.processId, "", null), 0);
          return { cancelled: true };
        }
        throw new Error(`Unexpected mock Host call: ${method}`);
      },
    };
  });
  await page.goto(baseUrl);
  await ready(page);
  if (concurrency !== null)
    await page.locator("#queue-concurrency").selectOption(String(concurrency));
  return page;
}

async function ready(page) {
  await page.waitForFunction(
    () =>
      window.__panelTools?.get_video_download_context &&
      document.querySelector("#installed-ytdlp-version")?.textContent === "2026.09.17" &&
      !document.querySelector("#refresh-versions")?.disabled,
  );
}
const readState = (page) => page.evaluate(() => window.__panelTools.get_video_download_context());
const downloads = (page) => page.evaluate(() => structuredClone(window.__downloads));
async function downloadForm(page) {
  if (!(await page.locator("#url-input").isVisible()))
    await page.locator('[data-tab="download"]').click();
}
async function addDownload(page, url = firstUrl) {
  await downloadForm(page);
  await page.locator("#url-input").fill(url);
  await page.locator("#download-button").click();
}
async function completeDownload(page, processId, files = [`/fixture/project/${processId}.mp4`]) {
  await page.evaluate(
    ({ processId, files }) => {
      window.__setFiles(
        Object.fromEntries(
          files.map((path) => [path, { status: "present", bytes: 100, modifiedAt: 1000 }]),
        ),
      );
      window.__emit("process.output", {
        processId,
        stream: "stdout",
        text: `meta:Fixture video\nprogress:100.0%|2MiB/s|00:00\n${files.map((path) => `file:${path}\nfiles:[]\n`).join("")}`,
      });
      window.__emit("process.exit", { processId, code: 0 });
    },
    { processId, files },
  );
  await page.waitForFunction(() => document.querySelector('.queue-item[data-state="completed"]'));
}

// Remaining integration cases below target the public controls introduced by the
// library UI. Native security and process-receipt behavior have independent tests.
test("batch paste deduplicates video aliases and adds each unique link once", async (t) => {
  const page = await openPanel(t);
  await downloadForm(page);
  await page
    .locator("#url-input")
    .fill(`${firstUrl}\nhttps://youtu.be/library-first?si=duplicate\n${secondUrl}`);
  assert.match(await page.locator("#batch-status").textContent(), /已合并 1 条重复链接/);
  assert.match(await page.locator("#download-list-count").textContent(), /2 条链接/);
  await page.locator("#download-button").click();
  await page.waitForFunction(() => document.querySelectorAll(".queue-item").length === 2);
  const state = await readState(page);
  assert.equal(state.queue.length, 2);
  assert.equal((await downloads(page)).length, 1, "Batch input must keep sequential execution");
  assert.match(await page.locator("#batch-status").textContent(), /重复|2|两/);
});

test("one failed link does not hide another batch link's verified information", async (t) => {
  const page = await openPanel(t);
  await page.evaluate((url) => {
    window.__inspectionFailureByUrl[url] = "Second video unavailable";
  }, secondUrl);
  await page.locator("#url-input").fill(`${firstUrl}\n${secondUrl}`);
  await page.locator("#inspect-button").click();
  await page.waitForFunction(() =>
    document.querySelector("#inspect-status")?.textContent?.includes("已获取 1/2 条"),
  );
  assert.equal(await page.locator("#download-list-items article").count(), 2);
  assert.match(
    await page.locator("#download-list-items article").first().textContent(),
    /Fixture video/,
  );
  assert.match(
    await page.locator("#download-list-items article").last().textContent(),
    /Second video unavailable.*获取失败/,
  );
  assert.equal(await page.locator("#download-button").isEnabled(), true);
  await page.locator("#download-button").click();
  await page.waitForFunction(() => document.querySelectorAll(".queue-item").length === 2);
  assert.equal((await readState(page)).queue.length, 2);
});

test("failed batch inspections identify every attempted link", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(
    ({ firstUrl, secondUrl }) => {
      window.__inspectionFailureByUrl[firstUrl] = "First video unavailable";
      window.__inspectionFailureByUrl[secondUrl] = "Second video unavailable";
    },
    { firstUrl, secondUrl },
  );
  await page.locator("#url-input").fill(`${firstUrl}\n${secondUrl}`);
  await page.locator("#inspect-button").click();
  await page.waitForFunction(() =>
    document.querySelector("#inspect-status")?.textContent?.includes("已获取 0/2 条；2 条失败"),
  );
  const rows = page.locator("#download-list-items article");
  assert.equal(await rows.count(), 2);
  assert.match(await rows.first().textContent(), /First video unavailable.*获取失败/);
  assert.match(await rows.last().textContent(), /Second video unavailable.*获取失败/);
  assert.equal(
    await page.locator("#page-download").isVisible(),
    true,
    "Inspection failures must stay beside the links",
  );
});

test("retrying failed metadata preserves successful links and only rechecks failures", async (t) => {
  const page = await openPanel(t);
  await page.evaluate((url) => {
    window.__inspectionFailureByUrl[url] = "connection reset by peer";
  }, secondUrl);
  await page.locator("#url-input").fill(`${firstUrl}\n${secondUrl}`);
  await page.locator("#inspect-button").click();
  await page.waitForFunction(() =>
    document.querySelector("#inspect-status").textContent.includes("已获取 1/2 条"),
  );
  assert.match(
    await page.locator("#download-list-items article").last().textContent(),
    /视频来源连接中断或超时/,
  );
  assert.equal(await page.locator("#download-list-actions").isVisible(), false);
  await page.evaluate((url) => {
    delete window.__inspectionFailureByUrl[url];
  }, secondUrl);
  await page.locator("#retry-inspect").click();
  await page.waitForFunction(
    () => document.querySelector("#inspect-status").textContent === "已获取 2/2 条视频信息。",
  );
  assert.equal(await page.locator("#retry-inspect").isVisible(), false);
  const calls = await page.evaluate(() =>
    window.__calls
      .filter(
        (call) => call.method === "process.spawn" && call.args.args?.includes("--dump-single-json"),
      )
      .map((call) => call.args.args.at(-1)),
  );
  assert.deepEqual(calls, [firstUrl, secondUrl, secondUrl]);
});

for (const pendingSpawn of [false, true]) {
  test(`metadata cancellation stops the batch, including pending spawn: ${pendingSpawn}`, async (t) => {
    const page = await openPanel(t);
    await page.evaluate((pending) => {
      window.__holdInspection = true;
      window.__holdInspectionSpawn = pending;
    }, pendingSpawn);
    await page.locator("#url-input").fill(`${firstUrl}\n${secondUrl}`);
    await page.locator("#inspect-button").click();
    await page.waitForFunction(() => window.__heldInspection);
    await page.locator("#cancel-inspect").click();
    if (pendingSpawn) {
      assert.equal(await page.locator("#url-input").isDisabled(), true);
      await page.evaluate(() => window.__releaseInspectionSpawn());
    }
    await page.waitForFunction(() =>
      document.querySelector("#inspect-status").textContent.includes("已取消获取"),
    );
    assert.equal(await page.locator("#url-input").isEnabled(), true);
    assert.equal(await page.locator("#cancel-inspect").isVisible(), false);
    assert.equal(
      await page.evaluate(
        () =>
          window.__calls.filter(
            (call) =>
              call.method === "process.spawn" && call.args.args?.includes("--dump-single-json"),
          ).length,
      ),
      1,
    );
    assert.equal((await downloads(page)).length, 0);
  });
}

test("rejected metadata cancellation keeps the query active and allows retry", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__holdInspection = true;
    window.__rejectInspectionCancel = true;
  });
  await page.locator("#url-input").fill(firstUrl);
  await page.locator("#inspect-button").click();
  await page.waitForFunction(() => window.__heldInspection);
  await page.locator("#cancel-inspect").click();
  await page.waitForFunction(() =>
    document.querySelector("#inspect-status").textContent.includes("取消未成功"),
  );
  assert.equal(await page.locator("#url-input").isDisabled(), true);
  await page.evaluate(() => {
    window.__rejectInspectionCancel = false;
  });
  await page.locator("#cancel-inspect").click();
  await page.waitForFunction(() =>
    document.querySelector("#inspect-status").textContent.includes("已取消获取"),
  );
  assert.equal(await page.locator("#download-button").isEnabled(), true);
});

test("batch metadata and three live downloads keep separate output, completion and history", async (t) => {
  const page = await openPanel(t, { concurrency: 3 });
  const thirdUrl = "https://www.youtube.com/watch?v=library-third";
  const newUrl = "https://www.youtube.com/watch?v=library-new";
  await addDownload(page, [firstUrl, secondUrl, thirdUrl].join("\n"));
  await page.waitForFunction(() => window.__downloads.length === 3);
  const [first, second] = await downloads(page);
  await downloadForm(page);
  await page.evaluate(() => {
    window.__holdInspection = true;
    window.__holdInspectionSpawn = true;
  });
  await page.locator("#url-input").fill(`${newUrl}\n${otherSiteUrl}`);
  assert.equal(await page.locator("#inspect-button").isEnabled(), true);
  await page.locator("#inspect-button").click();
  await page.waitForFunction(() => window.__heldInspection);
  const inspection = await page.evaluate(() => window.__heldInspection);
  await page.evaluate((processId) => {
    window.__emit("process.output", {
      processId,
      stream: "stdout",
      text: "meta:正在下载的视频\nprogress:45%|2MiB/s|00:10\n仅下载日志\n",
    });
  }, second.processId);
  await completeDownload(page, first.processId);
  assert.equal((await readState(page)).runningCount, 2);
  const running = (await readState(page)).queue.find((item) => item.url === secondUrl);
  assert.equal(running.percent, 45);
  assert.equal(running.title, "正在下载的视频");
  assert.equal((await readState(page)).inspection.status, "running");
  // Finishing a download must not claim an unreceived inspection ID or skip
  // the completed file's check. Metadata may also finish before its own receipt.
  await page.evaluate(
    ({ first, inspection, newUrl }) => {
      window.__emit("process.output", {
        processId: first,
        stream: "stdout",
        text: "late download noise\n",
      });
      window.__holdInspection = false;
      window.__emit("process.output", {
        processId: inspection.processId,
        stream: "stdout",
        text:
          JSON.stringify({
            id: "new-video",
            title: "新链接解析成功",
            webpage_url: newUrl,
            duration: 90,
            formats: [],
          }) + "\n",
      });
      window.__emit("process.exit", { processId: inspection.processId, code: 0 });
    },
    { first: first.processId, inspection, newUrl },
  );
  await page.waitForFunction(() =>
    document.querySelector("#inspect-status").textContent.includes("已获取 2/2 条"),
  );
  await page.evaluate(() => window.__releaseInspectionSpawn());
  await page.waitForFunction(() => !document.querySelector("#download-button").disabled);
  const history = await page.evaluate(
    () => JSON.parse(localStorage.getItem("fixture.storage.video-download.library.v2")).history,
  );
  assert.equal(history[0].files[0].status, "present");
  assert.equal(history[0].checkError || "", "");
  assert.equal((await readState(page)).runningCount, 2);
  await page.locator("#download-button").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".queue-item").length === 5 && window.__downloads.length === 4,
  );
  const state = await readState(page);
  assert.equal(state.queue.find((item) => item.url === newUrl).title, "新链接解析成功");
  assert.equal(
    state.queue.find((item) => item.url === otherSiteUrl).title,
    `Fixture video ${otherSiteUrl}`,
  );
  assert.equal(state.runningCount, 3);
});

test("inspection waits for a pending download receipt without stealing its early progress", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__holdNextDownload = true;
  });
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  const [download] = await downloads(page);
  await downloadForm(page);
  await page.locator("#url-input").fill(secondUrl);
  await page.locator("#inspect-button").click();
  assert.equal(await page.locator("#cancel-inspect").isVisible(), true);
  await page.evaluate((processId) => {
    window.__emit("process.output", {
      processId,
      stream: "stdout",
      text: "meta:下载任务\nprogress:37%|1MiB/s|00:15\n",
    });
  }, download.processId);
  assert.equal((await readState(page)).queue[0].percent, 37);
  assert.equal(
    await page.evaluate(
      () =>
        window.__calls.filter(
          (call) =>
            call.method === "process.spawn" && call.args.args?.includes("--dump-single-json"),
        ).length,
    ),
    0,
  );
  await page.evaluate(() => window.__releaseDownloadSpawn());
  await page.waitForFunction(
    () => document.querySelector("#inspect-status").dataset.state === "ready",
  );
  assert.equal((await readState(page)).inspected.title, `Fixture video ${secondUrl}`);
  assert.equal((await readState(page)).queue[0].title, "下载任务");
  assert.equal((await readState(page)).queue[0].status, "running");
});

test("metadata failure, retry and cancellation affect only inspection during a download", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  const [download] = await downloads(page);
  await downloadForm(page);
  await page.evaluate((url) => {
    window.__inspectionFailureByUrl[url] = "connection reset by peer";
  }, secondUrl);
  await page.locator("#url-input").fill(secondUrl);
  await page.locator("#inspect-button").click();
  await page.waitForFunction(
    () => document.querySelector("#inspect-status").dataset.state === "error",
  );
  assert.equal((await readState(page)).queue[0].status, "running");
  await page.evaluate(() => {
    window.__holdInspection = true;
    window.__holdInspectionSpawn = true;
  });
  await page.locator("#retry-inspect").click();
  await page.waitForFunction(() => window.__heldInspection);
  await page.locator("#cancel-inspect").click();
  await page.evaluate(() => window.__releaseInspectionSpawn());
  await page.waitForFunction(() =>
    document.querySelector("#inspect-status").textContent.includes("已取消获取"),
  );
  const cancellations = await page.evaluate(() =>
    window.__calls
      .filter((call) => call.method === "process.cancel")
      .map((call) => call.args.processId),
  );
  assert.equal(cancellations.includes(download.processId), false);
  assert.equal(cancellations.length, 1);
  assert.equal((await readState(page)).queue[0].status, "running");
  assert.equal(await page.locator("#inspect-button").isEnabled(), true);
});

test("save-only tasks survive reopening, stay deduplicated and require explicit start", async (t) => {
  const page = await openPanel(t);
  await page.locator("#url-input").fill(firstUrl);
  await page.locator("#enqueue-button").click();
  await page.waitForFunction(() => document.querySelector('.queue-item[data-state="pending"]'));
  const saved = (await readState(page)).queue[0];
  await page.reload();
  await ready(page);
  assert.equal((await downloads(page)).length, 0);
  assert.equal((await readState(page)).queue[0].status, "pending");
  await page.locator("#url-input").fill(firstUrl);
  await page.locator("#enqueue-button").click();
  assert.equal((await readState(page)).queue.length, 1);
  assert.equal((await downloads(page)).length, 0);
  await page.locator("#download-button").click();
  await page.waitForFunction(() => window.__downloads.length === 1);
  assert.equal((await readState(page)).queue[0].id, saved.id);
  assert.equal((await readState(page)).queue[0].status, "running");
});

test("saving another copy preserves the save-only choice through duplicate review", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  await completeDownload(page, (await downloads(page))[0].processId);
  await downloadForm(page);
  await page.waitForFunction(() => !document.querySelector("#enqueue-button").disabled);
  await page.locator("#enqueue-button").click();
  await page.waitForFunction(() => !document.querySelector("#duplicate-review").hidden);
  await page.locator('[data-duplicate-action="copy"]').click();
  await page.waitForFunction(() => document.querySelector('.queue-item[data-state="pending"]'));
  assert.equal((await downloads(page)).length, 1);
  const pending = (await readState(page)).queue.find((item) => item.status === "pending");
  await page.locator(`[data-queue-id="${pending.id}"][data-queue-action="resume"]`).click();
  await page.waitForFunction(() => window.__downloads.length === 2);
  assert.match((await downloads(page))[1].args.join(" "), /copy-/);
});

test("Chat can inspect a new URL while a download is running", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  const result = await page.evaluate(
    (url) => window.__panelTools.inspect_video({ url }),
    secondUrl,
  );
  assert.equal(result.status, "ready");
  assert.equal(result.inspected.title, `Fixture video ${secondUrl}`);
  assert.equal((await readState(page)).queue[0].status, "running");
  assert.equal((await readState(page)).runningCount, 1);
});

test("mixed-site batch inspection works when no Cookie account is selected", async (t) => {
  const page = await openPanel(t);
  await page.locator("#url-input").fill(`${firstUrl}\n${otherSiteUrl}`);
  await page.locator("#inspect-button").click();
  await page.waitForFunction(() =>
    document.querySelector("#inspect-status")?.textContent?.includes("已获取 2/2 条"),
  );
  const inspections = await page.evaluate(() =>
    window.__calls.filter(
      (call) => call.method === "process.spawn" && call.args.args?.includes("--dump-single-json"),
    ),
  );
  assert.deepEqual(
    inspections.map((entry) => entry.args.args.at(-1)),
    [firstUrl, otherSiteUrl],
  );
  assert.equal(await page.locator("#download-list-items article").count(), 2);
});

for (const playlist of [false, true]) {
  test(`batch links inspect each video and preserve distinct titles when queued (playlist=${playlist})`, async (t) => {
    const page = await openPanel(t);
    if (playlist) await page.locator("#playlist-toggle").locator("..").click();
    await page.evaluate(
      ({ firstUrl, secondUrl }) => {
        window.__inspectionPayloadByUrl[firstUrl] = {
          id: "first",
          title: "First video",
          webpage_url: firstUrl,
          duration: 90,
          formats: [{ height: 1080, vcodec: "avc1", acodec: "none" }],
        };
        window.__inspectionPayloadByUrl[secondUrl] = {
          id: "second",
          title: "Second video",
          webpage_url: secondUrl,
          duration: 120,
          formats: [{ height: 2160, vcodec: "avc1", acodec: "none" }],
        };
      },
      { firstUrl, secondUrl },
    );
    await page.locator("#url-input").fill(`${firstUrl}\n${secondUrl}`);
    assert.match(await page.locator("#download-list-count").textContent(), /2 条链接/);
    assert.equal(await page.locator("#download-list-items article").count(), 2);
    assert.equal(await page.locator("#inspect-button").isEnabled(), true);
    assert.equal(await page.locator("#inspect-button").textContent(), "获取全部视频信息");
    assert.match(await page.locator("#inspect-status").textContent(), /逐条核对/);
    await page.locator("#inspect-button").click();
    await page.waitForFunction(() =>
      document.querySelector("#inspect-status")?.textContent?.includes("已获取 2/2 条"),
    );
    const inspections = await page.evaluate(() =>
      window.__calls.filter(
        (call) => call.method === "process.spawn" && call.args.args?.includes("--dump-single-json"),
      ),
    );
    assert.deepEqual(
      inspections.map((entry) => entry.args.args.at(-1)),
      [firstUrl, secondUrl],
    );
    assert.ok(
      inspections.every((entry) =>
        entry.args.args.includes(playlist ? "--yes-playlist" : "--no-playlist"),
      ),
    );
    assert.match(await page.locator("#inspect-status").textContent(), /已获取 2\/2 条/);
    assert.match(await page.locator("#download-list-count").textContent(), /2 条链接/);
    assert.equal(await page.locator("#download-list-items article").count(), 2);
    assert.deepEqual(await page.locator("#download-list-items article strong").allTextContents(), [
      "First video",
      "Second video",
    ]);
    assert.match(await page.locator("#quality-help").textContent(), /分别使用实际可用的画质/);
    assert.equal(await page.locator('#quality-select option[value="2160"]').count(), 1);
    assert.equal((await readState(page)).queue.length, 0);
    await page.locator("#download-button").click();
    await page.waitForFunction(() => document.querySelectorAll(".queue-item").length === 2);
    const queue = (await readState(page)).queue;
    assert.deepEqual(
      queue.map((item) => item.url),
      [firstUrl, secondUrl],
    );
    assert.deepEqual(
      queue.map((item) => item.title),
      ["First video", "Second video"],
    );
  });
}

test("playlist mode inspects a mixed batch and retries only the failed link", async (t) => {
  const page = await openPanel(t);
  const playlistUrl = "https://www.youtube.com/playlist?list=fixture-playlist";
  await page.evaluate(
    ({ playlistUrl, secondUrl }) => {
      window.__inspectionPayloadByUrl[playlistUrl] = {
        _type: "playlist",
        title: "A complete playlist",
        playlist_count: 3,
        entries: [1, 2, 3].map((index) => ({ id: `episode-${index}`, title: `Episode ${index}` })),
      };
      window.__inspectionFailureByUrl[secondUrl] = "connection reset by peer";
    },
    { playlistUrl, secondUrl },
  );
  await page.locator("#playlist-toggle").locator("..").click();
  await page.locator("#url-input").fill(`${playlistUrl}\n${secondUrl}`);
  await page.locator("#inspect-button").click();
  await page.waitForFunction(() =>
    document.querySelector("#inspect-status").textContent.includes("已获取 1/2 条；1 条失败"),
  );
  const rows = page.locator("#download-list-items article");
  assert.match(await rows.first().textContent(), /A complete playlist.*播放列表.*3 个视频/);
  assert.match(await rows.last().textContent(), /视频来源连接中断或超时.*获取失败/);
  await page.evaluate((url) => {
    delete window.__inspectionFailureByUrl[url];
  }, secondUrl);
  await page.locator("#retry-inspect").click();
  await page.waitForFunction(
    () => document.querySelector("#inspect-status").textContent === "已获取 2/2 条视频信息。",
  );
  assert.equal(await page.locator("#playlist-toggle").isChecked(), true);
  assert.deepEqual(
    await page.evaluate(() =>
      window.__calls
        .filter(
          (call) =>
            call.method === "process.spawn" && call.args.args?.includes("--dump-single-json"),
        )
        .map((call) => call.args.args.at(-1)),
    ),
    [playlistUrl, secondUrl, secondUrl],
  );
  assert.equal((await downloads(page)).length, 0);
});

test("large playlist batches explain the preview limit and retain every download link", async (t) => {
  const page = await openPanel(t);
  await page.locator("#playlist-toggle").locator("..").click();
  await page
    .locator("#url-input")
    .fill(
      Array.from(
        { length: 11 },
        (_, index) => `https://www.youtube.com/playlist?list=fixture-${index}`,
      ).join("\n"),
    );
  assert.equal(await page.locator("#inspect-button").textContent(), "获取前 10 条视频信息");
  await page.locator("#inspect-button").click();
  await page.waitForFunction(() =>
    document.querySelector("#inspect-status").textContent.includes("已获取 10/11 条视频信息"),
  );
  assert.match(
    await page.locator("#inspect-status").textContent(),
    /最多预览 10 条.*其余 1 条将在下载时获取信息/,
  );
  assert.equal(await page.locator("#download-list-items article").count(), 11);
  assert.equal(
    await page.locator('#download-list-items article[data-state="verified"]').count(),
    10,
  );
  assert.equal((await downloads(page)).length, 0);
});

test("reloading restores pending work paused and only an explicit restore action can start it", async (t) => {
  const page = await openPanel(t);
  await addDownload(page, `${firstUrl}\n${secondUrl}`);
  await page.waitForFunction(() => document.querySelectorAll(".queue-item").length === 2);
  await page.waitForFunction(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("fixture.storage."))
      .some((key) => JSON.parse(localStorage.getItem(key))?.queue?.length === 2),
  );
  await page.reload();
  await ready(page);
  await page.waitForFunction(() => document.querySelectorAll(".queue-item").length === 2);
  assert.equal(
    (await downloads(page)).length,
    0,
    "Reload cannot reuse revoked handles or silently restart downloads",
  );
  assert.equal((await readState(page)).queuePaused, true);
  assert.equal(await page.locator("#queue-restore").isVisible(), true);
  await page.locator("#queue-restore").click();
  await page.waitForFunction(() => window.__downloads.length === 1);
  assert.equal((await downloads(page))[0].directoryHandle, "directory-project");
});

test("a verified existing download requires a visible duplicate decision instead of another process", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  const [first] = await downloads(page);
  await completeDownload(page, first.processId);
  await addDownload(page);
  await page.waitForFunction(() => !document.querySelector("#duplicate-review").hidden);
  assert.equal((await downloads(page)).length, 1);
  assert((await page.locator("#duplicate-review button").count()) > 0);
  assert(
    await page.evaluate(() => window.__nativeRequests.some(({ action }) => action === "check")),
  );
});

test("a deleted historical output permits a new download after checking the actual file", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  const [first] = await downloads(page);
  const path = `/fixture/project/${first.processId}.mp4`;
  await completeDownload(page, first.processId, [path]);
  await page.evaluate((path) => window.__setFiles({ [path]: { status: "missing" } }), path);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 2);
  assert.equal(await page.locator("#duplicate-review").isVisible(), false);
  assert(
    await page.evaluate(
      (path) =>
        window.__nativeRequests.some(
          ({ action, files }) =>
            action === "check" && files.some(({ path: candidate }) => candidate === path),
        ),
      path,
    ),
  );
});

test("the same video can be downloaded to a different selected output directory", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  await completeDownload(page, (await downloads(page))[0].processId);
  await downloadForm(page);
  await page.locator("#choose-directory").click();
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 2);
  assert.equal((await downloads(page))[1].directoryHandle, "directory-other");
  assert.equal(await page.locator("#duplicate-review").isVisible(), false);
});

test("selected download directory restores a fresh grant without another picker after reload", async (t) => {
  const page = await openPanel(t);
  await page.locator("#choose-directory").click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("fixture.storage.video-download.library.v2") || "null")
        ?.directoryPreference?.path === "/fixture/other",
  );
  await page.reload();
  await page.locator("#restore-directory").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#destination-path").textContent(), "/fixture/other");
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((call) => call.method === "filesystem.pickDirectory").length,
    ),
    0,
  );
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((call) => call.method === "filesystem.restoreDirectory").length,
    ),
    1,
  );
});

test("older Hosts still offer manual re-selection for remembered directories", async (t) => {
  const page = await openPanel(t);
  await page.locator("#choose-directory").click();
  await page.evaluate(() => localStorage.setItem("fixture.legacyHost", "true"));
  await page.reload();
  await page.locator("#restore-directory").waitFor({ state: "visible" });
  assert.match(await page.locator("#destination-path").textContent(), /\/fixture\/other/);
  assert.equal(await page.locator("#download-button").isDisabled(), true);
  await page.locator("#restore-directory").click();
  await page.locator("#restore-directory").waitFor({ state: "hidden" });
});

test("historical media and subtitles have separate file actions and missing files never launch", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  const files = [
    "/fixture/project/part-one.mp4",
    "/fixture/project/part-two.webm",
    "/fixture/project/part-one.zh.vtt",
  ];
  await completeDownload(page, (await downloads(page))[0].processId, files);
  await page.locator('[data-tab="history"]').click();
  const openSecond = page.locator('[data-history-action="open"][data-file-index="1"]');
  await page.locator(".history-files summary").click();
  await openSecond.click();
  await page.waitForFunction(() => window.__fileActions.some(({ action }) => action === "open"));
  assert.deepEqual(
    await page.evaluate(() =>
      window.__fileActions.find(({ action }) => action === "open").files.map(({ path }) => path),
    ),
    [files[1]],
  );
  await page.locator('[data-history-action="reveal"][data-file-index="2"]').click();
  await page.waitForFunction(() => window.__fileActions.some(({ action }) => action === "reveal"));
  assert.deepEqual(
    await page.evaluate(() =>
      window.__fileActions.find(({ action }) => action === "reveal").files.map(({ path }) => path),
    ),
    [files[2]],
  );
  await page.evaluate((path) => window.__setFiles({ [path]: { status: "missing" } }), files[1]);
  await page.locator("#history-check").click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".history-file")].some(
      (line) => line.textContent.includes("part-two.webm") && line.textContent.includes("已删除"),
    ),
  );
  assert.match(await page.locator("#history-list").innerText(), /缺失|已删除|不存在/);
  assert.equal(await page.locator(".history-files").evaluate((node) => node.open), true);
  await openSecond.click();
  await page.waitForFunction(() =>
    document.querySelector("#history-list").textContent.includes("暂时无法访问"),
  );
  assert.equal(
    await page.evaluate(() => window.__fileActions.length),
    2,
    "Missing files must not launch an OS opener",
  );
  await page.locator("#history-filter").selectOption("missing");
  assert.equal(await page.locator(".history-item").count(), 1);
});

test("play and reveal still work during a background file check", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  await completeDownload(page, (await downloads(page))[0].processId);
  await page.locator('[data-tab="history"]').click();
  await page.evaluate(() => {
    window.__holdNextNative = true;
  });
  await page.locator("#history-check").click();
  await page.waitForFunction(() => Object.keys(window.__heldNativeSpawns).length === 1);
  for (const action of ["play", "reveal"]) {
    await page.locator(`[data-history-shortcut="${action}"]`).click();
    await page.waitForFunction(
      (action) => window.__fileActions.some((item) => item.action === action),
      action,
    );
    await page.waitForFunction(() =>
      document.querySelector("#history-action-status").textContent.startsWith("已"),
    );
  }
  await page.evaluate(() => {
    for (const release of Object.values(window.__heldNativeSpawns)) release();
  });
  await page.waitForFunction(() => !document.querySelector("#history-check").disabled);
  assert.equal(await page.locator(".history-error").count(), 0);
});

test("failed playback names the opening problem and a successful retry clears it", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  await completeDownload(page, (await downloads(page))[0].processId);
  await page.locator('[data-tab="history"]').click();
  await page.evaluate(() => {
    window.__failFileOpen = true;
  });
  await page.locator('[data-history-shortcut="play"]').click();
  await page.waitForFunction(() =>
    document.querySelector(".history-error")?.textContent.includes("播放器未能打开"),
  );
  assert.equal(await page.locator('[data-history-shortcut="retry"]').count(), 0);
  await page.evaluate(() => {
    window.__failFileOpen = false;
  });
  await page.locator('[data-history-shortcut="play"]').click();
  await page.waitForFunction(() => !document.querySelector(".history-error"));
  assert.match(await page.locator("#history-action-status").textContent(), /Google Chrome/);
});

test("a restored task opens its folder using a fresh directory grant", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  await page.reload();
  await ready(page);
  await page.locator('[data-tab="task"]').click();
  await page.locator('[data-task-action="open"]').first().click();
  await page.locator("#open-directory").click();
  await page.waitForFunction(() =>
    window.__calls.some((call) => call.method === "filesystem.openDirectory"),
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.__calls
        .filter((call) => call.method === "filesystem.openDirectory")
        .map((call) => call.args),
    ),
    [{ handle: "directory-project" }],
  );
  assert.equal(
    await page.evaluate(() =>
      window.__calls.some((call) => call.method === "filesystem.pickDirectory"),
    ),
    false,
  );
});

test("a storage failure rolls back newly added work and never starts its download", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__failStorage = true;
  });
  await addDownload(page);
  await page.waitForFunction(() =>
    document.querySelector("#library-status").textContent.includes("未能保存"),
  );
  assert.equal((await downloads(page)).length, 0);
  assert.equal((await readState(page)).queue.length, 0);
  assert.equal((await readState(page)).queuePaused, true);
});

test("restoring a Cookie download asks for its original account again and honors denial", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__cookieAccounts = [
      { id: "original-account", label: "Fixture account", health: "ready" },
    ];
    localStorage.setItem("fixture.cookieAccounts", JSON.stringify(window.__cookieAccounts));
  });
  await page.locator("#url-input").fill(firstUrl);
  await page.locator("#cookie-refresh").click();
  await page.locator("#cookie-select").selectOption("original-account");
  await page.locator("#download-button").click();
  await page.waitForFunction(() => window.__downloads.length === 1);
  assert.equal(await page.evaluate(() => window.__authorizations.length), 1);
  await page.reload();
  await ready(page);
  assert.equal((await downloads(page)).length, 0);
  await page.evaluate(() => {
    window.__denyCookieAuthorization = true;
  });
  await page.locator("#queue-restore").click();
  await page.waitForFunction(
    () =>
      window.__authorizations.length === 1 &&
      document.querySelector("#queue-list").textContent.includes("已取消使用 Cookie"),
  );
  assert.equal((await downloads(page)).length, 0);
  assert.equal(
    await page.evaluate(() => window.__authorizations[0].credentialId),
    "original-account",
  );
  await page.evaluate(() => {
    window.__denyCookieAuthorization = false;
  });
  await page.locator("#queue-restore").click();
  await page.waitForFunction(() => window.__downloads.length === 1);
  assert.equal(await page.evaluate(() => window.__authorizations.length), 2);
});

test("a pending file-check spawn does not swallow the running download's output and exit", async (t) => {
  const page = await openPanel(t);
  await addDownload(page, firstUrl);
  await page.waitForFunction(() => window.__downloads.length === 1);
  await completeDownload(page, (await downloads(page))[0].processId);
  await addDownload(page, secondUrl);
  await page.waitForFunction(() => window.__downloads.length === 2);
  const second = (await downloads(page))[1];
  await page.locator('[data-tab="history"]').click();
  await page.evaluate(() => {
    window.__holdNextNative = true;
  });
  await page.locator("#history-check").click();
  await page.waitForFunction(() => Object.keys(window.__heldNativeSpawns).length === 1);
  await completeDownload(page, second.processId);
  await page.waitForFunction(
    () => document.querySelectorAll('.queue-item[data-state="completed"]').length === 2,
  );
  await page.evaluate(() => {
    for (const release of Object.values(window.__heldNativeSpawns)) release();
  });
  await page.waitForFunction(() => !document.querySelector("#history-check").disabled);
  assert.deepEqual(
    (await readState(page)).queue.map(({ status }) => status),
    ["completed", "completed"],
  );
});

test("playlist checkboxes produce the selected episode range and reject an empty selection", async (t) => {
  const page = await openPanel(t);
  await page.evaluate(() => {
    window.__inspectionPayload = {
      _type: "playlist",
      title: "Fixture playlist",
      playlist_count: 3,
      entries: [1, 2, 3].map((index) => ({
        id: `episode-${index}`,
        title: `Episode ${index}`,
        playlist_index: index,
        duration: 60,
      })),
    };
  });
  await page.locator("#url-input").fill("https://youtube.com/playlist?list=fixture-series");
  if (!(await page.locator("#playlist-toggle").isChecked()))
    await page.locator("#playlist-toggle").locator("..").click();
  await page.locator("#inspect-button").click();
  await page.waitForFunction(
    () => document.querySelectorAll('#download-list-items input[type="checkbox"]').length === 3,
  );
  await page.locator("#playlist-select-none").click();
  await page.locator("#download-button").click();
  assert.equal((await downloads(page)).length, 0);
  assert.match(await page.locator("#form-error").textContent(), /至少选择一集/);
  await page.getByRole("checkbox", { name: "下载第 1 集：Episode 1" }).check();
  await page.getByRole("checkbox", { name: "下载第 3 集：Episode 3" }).check();
  await page.locator("#download-button").click();
  await page.waitForFunction(() => window.__downloads.length === 1);
  const argv = (await downloads(page))[0].args;
  assert.equal(argv[argv.indexOf("--playlist-items") + 1], "1,3");
});

test("repeated checks keep replaced files changed and re-downloads use a distinct output name", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  const path = "/fixture/project/replaced.mp4";
  await completeDownload(page, (await downloads(page))[0].processId, [path]);
  await page.evaluate(
    (path) => window.__setFiles({ [path]: { status: "present", bytes: 200, modifiedAt: 2000 } }),
    path,
  );
  await page.locator('[data-tab="history"]').click();
  for (let index = 0; index < 2; index++) {
    await page.locator("#history-check").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("#history-check").disabled &&
        document.querySelector("#history-list").textContent.includes("已变化"),
    );
  }
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 2);
  const started = await downloads(page);
  assert.notEqual(
    started[0].args[started[0].args.indexOf("--output") + 1],
    started[1].args[started[1].args.indexOf("--output") + 1],
  );
});

test("yt-dlp final subtitle paths are retained alongside the primary video", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  const processId = (await downloads(page))[0].processId;
  assert.ok(
    (await downloads(page))[0].args.includes(
      "after_move:files:%(requested_subtitles.:.filepath|[])j",
    ),
  );
  await page.evaluate((processId) => {
    const media = "/fixture/project/video.mp4";
    const subtitle = "/fixture/project/video.zh.srt";
    window.__setFiles({ [media]: { status: "present" }, [subtitle]: { status: "present" } });
    window.__emit("process.output", {
      processId,
      stream: "stdout",
      text: `file:${media}\nfiles:${JSON.stringify([subtitle])}\n`,
    });
    window.__emit("process.exit", { processId, code: 0 });
  }, processId);
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("fixture.storage.video-download.library.v2")).history[0]
        ?.files.length === 2,
  );
  await page.locator('[data-tab="history"]').click();
  assert.match(await page.locator("#history-list").textContent(), /video\.zh\.srt/);
});

test("the download keyboard shortcut cannot enqueue an old link from the AI search tab", async (t) => {
  const page = await openPanel(t);
  await page.locator("#url-input").fill(firstUrl);
  await page.locator('[data-tab="search"]').click();
  await page.locator("[data-search-query]").fill("学习基础建模");
  await page.keyboard.press("Control+Enter");
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal((await readState(page)).queue.length, 0);
  assert.equal((await downloads(page)).length, 0);
});

for (const [width, colorScheme] of [
  [340, "light"],
  [620, "light"],
  [1280, "light"],
  [1280, "dark"],
]) {
  test(`polished workspace supports the full navigation at ${width}px in ${colorScheme}`, async (t) => {
    const page = await openPanel(t, { width, colorScheme });
    const artifacts = resolve(root, "artifacts/video-download/interface");
    await mkdir(artifacts, { recursive: true });
    assert.equal(await page.locator("#environment-details").evaluate((node) => node.open), false);
    await page.evaluate(
      ({ firstUrl, secondUrl }) => {
        for (const [url, title, duration] of [
          [firstUrl, "Blender 入门：从基础形状到第一个模型", 1080],
          [secondUrl, "用 AI 辅助剪辑：完整工作流演示", 720],
        ])
          window.__inspectionPayloadByUrl[url] = {
            id: url,
            title,
            webpage_url: url,
            duration,
            uploader: "演示频道",
            upload_date: "20260918",
            formats: [{ height: 1080, vcodec: "avc1", acodec: "none" }],
          };
      },
      { firstUrl, secondUrl },
    );
    await page.locator("#url-input").fill(`${firstUrl}\n${secondUrl}`);
    await page.locator("#inspect-button").click();
    await page.waitForFunction(() =>
      document.querySelector("#inspect-status").textContent.includes("已获取 2/2 条"),
    );
    assert.equal(await page.locator("#download-list-actions").isVisible(), false);
    await page.locator("#download-button").click();
    await page.waitForFunction(() => window.__downloads.length === 1);
    const [process] = await downloads(page);
    await page.evaluate(
      (id) =>
        window.__emit("process.output", {
          processId: id,
          stream: "stdout",
          text: "meta:Blender 入门：从基础形状到第一个模型\nprogress:47.1%|3.2MiB/s|00:30\n",
        }),
      process.processId,
    );
    await page.waitForFunction(() => {
      const track = document.querySelector(".queue-progress");
      const fill = track?.querySelector("span");
      return (
        track &&
        fill &&
        Math.abs(fill.getBoundingClientRect().width / track.getBoundingClientRect().width - 0.471) <
          0.02
      );
    });
    for (const tab of ["download", "task", "search", "history"]) {
      await page.locator(`[data-tab="${tab}"]`).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.locator("#queue-list").isVisible(), true);
      assert.equal(await page.locator(".tab-page:not([hidden])").count(), 1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `${tab} overflows`);
      await page.screenshot({
        path: resolve(artifacts, `${tab}-${width}-${colorScheme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.locator("#queue-jump").click();
    assert.equal(
      await page.locator("#queue-section").evaluate((node) => document.activeElement === node),
      true,
    );
    const queueBounds = await page.locator("#queue-section").boundingBox();
    assert.ok(queueBounds.y >= 0 && queueBounds.y + Math.min(queueBounds.height, 100) <= 1000);
    await page.locator('[data-tab="task"]').click();
    await page.locator("#task-add-download").click();
    assert.equal(
      await page.locator("#url-input").evaluate((node) => document.activeElement === node),
      true,
    );
    await page.locator("#open-video-search").click();
    assert.equal(await page.locator("#page-search").isVisible(), true);
  });
}

test("concurrent exits keep independent native inventories and persist both completed records", async (t) => {
  const page = await openPanel(t, { concurrency: 2 });
  await page.locator("#url-input").fill(`${firstUrl}\n${secondUrl}`);
  await page.locator("#download-button").click();
  await page.waitForFunction(() => window.__downloads.length === 2);
  const [a, b] = await downloads(page);
  await page.evaluate(
    ([a, b]) => {
      window.__setFiles({
        "/fixture/project/alpha.mp4": { status: "present", bytes: 111, modifiedAt: 1000 },
        "/fixture/project/beta.mp4": { status: "present", bytes: 222, modifiedAt: 2000 },
      });
      for (const [processId, title, path] of [
        [b, "Beta", "beta"],
        [a, "Alpha", "alpha"],
      ]) {
        window.__emit("process.output", {
          processId,
          stream: "stdout",
          text: `meta:${title}\nfile:/fixture/project/${path}.mp4\nfiles:[]\n`,
        });
        window.__emit("process.exit", { processId, code: 0 });
      }
    },
    [a.processId, b.processId],
  );
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem("fixture.storage.video-download.library.v2"));
    return (
      saved?.history.length === 2 &&
      saved.history.every((item) => item.files[0]?.status === "present")
    );
  });
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fixture.storage.video-download.library.v2")),
  );
  assert.deepEqual(
    saved.history.map((item) => [item.title, item.files[0].bytes, item.files[0].path]).sort(),
    [
      ["Alpha", 111, "/fixture/project/alpha.mp4"],
      ["Beta", 222, "/fixture/project/beta.mp4"],
    ],
  );
  assert.equal((await readState(page)).runningCount, 0);
  assert.equal((await readState(page)).queuePaused, false);
  await page.reload();
  await ready(page);
  assert.equal(await page.locator("#queue-concurrency").inputValue(), "2");
  await page.locator('[data-tab="history"]').click();
  assert.equal(await page.locator(".history-item").count(), 2);
});

async function seedHistoryList(page) {
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  await completeDownload(page, (await downloads(page))[0].processId);
  await page.waitForFunction(() => !document.querySelector("#download-button").disabled);
  await page.evaluate(() => {
    const key = "fixture.storage.video-download.library.v2";
    const snapshot = JSON.parse(localStorage.getItem(key));
    const base = snapshot.history[0];
    const rows = [
      [
        "Blender 与 AI：从想法到三维模型的完整工作流",
        "1080",
        ["Blender-AI.mp4", "Blender-AI.zh.srt"],
        "completed",
      ],
      ["用 AI 辅助剪辑，让素材整理变得更简单", "2160", ["AI-editing.mp4"], "completed"],
      ["创作者访谈：灵感、工具和日常创作", "audio", ["creator-interview.mp3"], "completed"],
      [
        "材质与灯光练习 · 把参考变成自己的作品",
        "best",
        ["materials.webm", "materials.en.srt"],
        "completed",
      ],
      ["本地文件已移走的示例记录", "720", ["moved-video.mp4"], "completed"],
      ["视频下载失败后，仍可按原设置重试", "best", [], "failed"],
    ];
    snapshot.history = rows.map(([title, format, names, status], index) => ({
      ...base,
      queueId: `history-demo-${index}`,
      title,
      status,
      url: `https://www.youtube.com/watch?v=history-demo-${index}`,
      configuration: { ...base.configuration, format },
      finishedAt: Date.now() - index * 1000 * 60 * 75,
      error: status === "failed" ? "网络连接中断，请稍后重试。" : "",
      files: names.map((name, fileIndex) => ({
        path: `/fixture/project/${name}`,
        status: index === 4 ? "missing" : "present",
        bytes: fileIndex ? 12804 : 86350240 + index * 20000000,
        modifiedAt: 1000,
      })),
    }));
    snapshot.queue = [];
    window.__setFiles(
      Object.fromEntries(
        snapshot.history.flatMap((item) => item.files.map((file) => [file.path, file])),
      ),
    );
    localStorage.setItem(key, JSON.stringify(snapshot));
  });
  await page.reload();
  await ready(page);
  await page.locator('[data-tab="history"]').click();
}

for (const [width, colorScheme] of [
  [340, "light"],
  [620, "light"],
  [1280, "light"],
  [1280, "dark"],
]) {
  test(`compact history keeps file details and actions accessible at ${width}px in ${colorScheme}`, async (t) => {
    const page = await openPanel(t, { width, colorScheme });
    await seedHistoryList(page);
    const artifacts = resolve(root, "artifacts/video-download/history");
    await mkdir(artifacts, { recursive: true });
    assert.equal(await page.locator("#history-count").textContent(), "6 条记录 · 7 个文件");
    assert.equal(await page.locator(".history-files[open]").count(), 0);
    assert.equal(await page.locator('[data-history-action="delete"]:visible').count(), 0);
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      page: document.documentElement.scrollWidth,
      heights: [...document.querySelectorAll(".history-item")].map(
        (row) => row.getBoundingClientRect().height,
      ),
    }));
    assert.ok(dimensions.page <= width, JSON.stringify(dimensions));
    assert.ok(
      dimensions.heights.every((height) => height <= 112),
      JSON.stringify(dimensions),
    );
    await page.screenshot({
      path: resolve(artifacts, `history-${width}-${colorScheme}.png`),
      fullPage: true,
    });
    const first = page.locator('.history-item[data-history-id="history-demo-0"]');
    await first.locator(".history-row-heading").click();
    assert.equal(await first.locator(".history-file").count(), 2);
    assert.equal(await first.locator(".history-file-name").first().textContent(), "Blender-AI.mp4");
    assert.match(
      await first.locator(".history-detail-body").innerText(),
      /保存到 \/fixture\/project/,
    );
    const menu = first.locator(".history-menu");
    await menu.locator("summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await menu.evaluate((node) => node.open), true);
    await page.keyboard.press("Escape");
    assert.equal(await menu.evaluate((node) => node.open), false);
    assert.equal(
      await menu.locator("summary").evaluate((node) => node === document.activeElement),
      true,
    );
    await menu.locator("summary").click();
    await first.locator('[data-history-action="check"]').click();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '.history-item[data-history-id="history-demo-0"] [data-history-action="check"]',
        ).disabled,
    );
    assert.equal(await first.locator(".history-files").evaluate((node) => node.open), true);
    await menu.locator("summary").click();
    await page.locator("#history-search").click();
    assert.equal(await menu.evaluate((node) => node.open), false);
    await page.screenshot({
      path: resolve(artifacts, `history-expanded-${width}-${colorScheme}.png`),
      fullPage: true,
    });
    if (width === 1280 && colorScheme === "light") {
      await first.locator('[data-history-shortcut="play"]').click();
      await page.waitForFunction(() =>
        window.__fileActions.some((action) => action.action === "play"),
      );
      await first.locator('[data-history-shortcut="reveal"]').click();
      await page.waitForFunction(() =>
        window.__fileActions.some((action) => action.action === "reveal"),
      );
      assert.deepEqual(
        await page.evaluate(() => window.__fileActions.map((action) => action.files[0].path)),
        ["/fixture/project/Blender-AI.mp4", "/fixture/project/Blender-AI.mp4"],
      );
      await menu.locator("summary").click();
      await first.locator('[data-history-action="delete"]').click();
      await page.waitForFunction(() => document.querySelectorAll(".history-item").length === 5);
      assert.equal(
        await page.evaluate(() => window.__fileMap["/fixture/project/Blender-AI.mp4"].status),
        "present",
      );
    }
  });
}

test("paused tasks survive reload, block duplicates and resume without a second queue record", async (t) => {
  const page = await openPanel(t, { concurrency: 2 });
  await addDownload(page, firstUrl);
  await page.waitForFunction(() => window.__downloads.length === 1);
  const [old] = await downloads(page);
  await page.evaluate(
    (processId) =>
      window.__emit("process.output", {
        processId,
        stream: "stdout",
        text: "progress:38%|2MiB/s|00:12\n",
      }),
    old.processId,
  );
  await page.locator('[data-queue-action="pause"]').click();
  await page.waitForFunction(() => document.querySelector('.queue-item[data-state="paused"]'));
  await page.reload();
  await ready(page);
  const initial = await readState(page);
  assert.equal(initial.queue[0].status, "paused");
  assert.equal(initial.queue[0].percent, 38);
  assert.equal(initial.runningCount, 0);
  await addDownload(page, firstUrl);
  assert.equal((await readState(page)).queue.length, 1);
  assert.equal((await downloads(page)).length, 0);
  await page.locator('[data-queue-action="resume"]').click();
  await page.waitForFunction(() => window.__downloads.length === 1);
  const [resumed] = await downloads(page);
  assert.deepEqual(resumed.args, old.args);
  await completeDownload(page, resumed.processId);
  await page.locator('[data-tab="history"]').click();
  assert.equal(await page.locator(".history-item").count(), 1);
});

test("inspection errors identify the failing link and can be dismissed without a download task", async (t) => {
  const page = await openPanel(t);
  await page.evaluate((url) => {
    window.__inspectionFailureByUrl[url] = "ERROR: inspection network failure";
  }, firstUrl);
  await page.locator("#url-input").fill(firstUrl);
  await page.locator("#inspect-button").click();
  await page.waitForFunction(
    () => document.querySelector("#inspect-status").dataset.state === "error",
  );
  await page.locator('[data-tab="task"]').click();
  assert.equal(await page.locator("#error-analysis-title").textContent(), "获取视频信息失败");
  assert.equal(await page.locator("#error-source-url").textContent(), firstUrl);
  assert.equal(await page.locator("#error-task-link").isVisible(), false);
  await page.locator("#dismiss-error").click();
  assert.equal(await page.locator("#error-analysis").isVisible(), false);
  assert.equal((await readState(page)).queue.length, 0);
});
