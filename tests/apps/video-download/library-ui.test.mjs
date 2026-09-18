import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const appDirectory = resolve(root, "apps/video-download/app");
const firstUrl = "https://www.youtube.com/watch?v=library-first";
const secondUrl = "https://www.youtube.com/watch?v=library-second";
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
async function openPanel(t) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
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
    window.__nativeRequests = [];
    window.__fileMap = JSON.parse(localStorage.getItem("fixture.files") || "{}");
    window.__searchPayload = { entries: [] };
    window.__nextDirectory = { handle: "directory-other", name: "Other", path: "/fixture/other", bookmark: "a0123456-1234-4567-8901-123456789abc" };
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
          if (args.bookmark !== window.__nextDirectory.bookmark) throw new Error("invalid bookmark");
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
            setTimeout(
              () =>
                finish(
                  processId,
                  JSON.stringify(
                    window.__inspectionPayload || {
                      id: "fixture-video",
                      title: "Fixture video",
                      webpage_url: argv.at(-1),
                      duration: 60,
                      formats: [],
                    },
                  ) + "\n",
                ),
              0,
            );
          } else {
            window.__downloads.push({ ...structuredClone(args), processId });
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
            window.__fileActions.push({
              action: request.action,
              files,
              directoryHandle: record.args.directoryHandle,
            });
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
          setTimeout(() => finish(args.processId, "", null), 0);
          return { cancelled: true };
        }
        throw new Error(`Unexpected mock Host call: ${method}`);
      },
    };
  });
  await page.goto(baseUrl);
  await ready(page);
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
        text: `meta:Fixture video\nprogress:100.0%|2MiB/s|00:00\n${files.map((path) => `file:${path}\n`).join("")}`,
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
  await addDownload(page, `${firstUrl}\nhttps://youtu.be/library-first?si=duplicate\n${secondUrl}`);
  await page.waitForFunction(() => document.querySelectorAll(".queue-item").length === 2);
  const state = await readState(page);
  assert.equal(state.queue.length, 2);
  assert.equal((await downloads(page)).length, 1, "Batch input must keep sequential execution");
  assert.match(await page.locator("#batch-status").textContent(), /重复|2|两/);
});

test("batch links can inspect the first video without implying every link was inspected", async (t) => {
  const page = await openPanel(t);
  await page.locator("#url-input").fill(`${firstUrl}\n${secondUrl}`);
  assert.equal(await page.locator("#inspect-button").isEnabled(), true);
  assert.equal(await page.locator("#inspect-button").textContent(), "获取首条视频信息");
  assert.match(await page.locator("#inspect-status").textContent(), /只预览第一条/);
  await page.locator("#inspect-button").click();
  await page.waitForFunction(() => document.querySelector("#inspect-status")?.dataset.state === "ready");
  const inspection = await page.evaluate(() =>
    window.__calls.find((call) => call.method === "process.spawn" && call.args.args?.includes("--dump-single-json")),
  );
  assert.equal(inspection.args.args.at(-1), firstUrl);
  assert.match(await page.locator("#inspect-status").textContent(), /其余 1 条/);
  assert.equal((await readState(page)).queue.length, 0);
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
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("fixture.storage.video-download.library.v2") || "null")?.directoryPreference?.path === "/fixture/other");
  await page.reload();
  await page.locator("#restore-directory").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#destination-path").textContent(), "/fixture/other");
  assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.method === "filesystem.pickDirectory").length), 0);
  assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.method === "filesystem.restoreDirectory").length), 1);
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
  await page.locator(".history-files summary").click();
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

test("yt-dlp moved-file inventory retains subtitle sidecars alongside the primary video", async (t) => {
  const page = await openPanel(t);
  await addDownload(page);
  await page.waitForFunction(() => window.__downloads.length === 1);
  const processId = (await downloads(page))[0].processId;
  await page.evaluate((processId) => {
    const media = "/fixture/project/video.mp4";
    const subtitle = "/fixture/project/video.zh.srt";
    window.__setFiles({ [media]: { status: "present" }, [subtitle]: { status: "present" } });
    window.__emit("process.output", {
      processId,
      stream: "stdout",
      text: `file:${media}\nfiles:${JSON.stringify({ [media]: media, [subtitle]: "" })}\n`,
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
