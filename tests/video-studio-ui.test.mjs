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
const output = resolve(root, "panels/video-studio/app");
const screenshots = resolve(root, "artifacts/video-studio");
let browser;
let server;
let url;
const errors = [];

before(async () => {
  const [project] = selectProjects(await discoverProjects(), "video-studio");
  await buildProject(project);
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
            if (params.key === "video-studio-recent-v1" && window.__holdArchive) {
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
            if (params.key === "video-studio-recent-v1" && window.__holdArchive) {
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
  await page.goto(url);
  await page.locator("#preview").waitFor();
  return page;
}

const readProject = (page) =>
  page.evaluate(
    () =>
      window.__panelTools?.read_video_project().project ||
      JSON.parse(localStorage.getItem("video-studio-project-v1")),
  );
async function saved(page) {
  await page.waitForFunction(
    () => document.querySelector("#save-state")?.textContent === "已自动保存",
  );
}
async function demo(page) {
  await page.getByRole("button", { name: "试试示例工程", exact: true }).click();
  await saved(page);
}

test("failed desktop media connection explains unavailable AI production without hiding the cause", async () => {
  const page = await pageWithBridge(true);
  try {
    await page.locator('[data-tab="ai"]').click();
    const notice = page.locator(".library-panel > .host-required");
    assert.match(await notice.textContent(), /媒体服务连接失败/);
    assert.match(await notice.textContent(), /Unexpected host call: media.status/);
    assert.equal(await page.locator('[data-action="ask-draft"]').isDisabled(), true);
    await page.locator('[data-tab="jobs"]').click();
    assert.match(
      await page.locator(".conflict").textContent(),
      /Unexpected host call: media.status/,
    );
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
      await page.locator(`[data-clip="${clip.id}"]`).evaluate((element) => element.click());
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
  const originalCaptions = (await readProject(page)).captions.length;
  await page.locator("#srt-input").setInputFiles({
    name: "test.srt",
    mimeType: "text/plain",
    buffer: Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n新增字幕 <script>alert(1)</script>\n"),
  });
  await saved(page);
  await page.waitForFunction(
    (n) => document.querySelectorAll(".transcript-item").length === n + 1,
    originalCaptions,
  );
  assert.equal(
    (await readProject(page)).captions.length,
    originalCaptions + 1,
    "SRT import appends unique captions",
  );
  const srtDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 SRT", exact: true }).click();
  const srt = await srtDownload;
  assert.match(await readFile(await srt.path(), "utf8"), /新增字幕/);

  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载工程 JSON", exact: true }).click();
  const json = JSON.parse(await readFile(await (await jsonDownload).path(), "utf8"));
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.clips.length, 3);
  const revision = json.revision;
  await page.reload();
  await page.locator("#revision").waitFor();
  assert.equal((await readProject(page)).revision, revision);

  await page.getByRole("button", { name: "新建工程", exact: true }).click();
  await saved(page);
  assert.equal((await readProject(page)).clips.length, 0);
  await page.getByRole("button", { name: "最近工程 / 打开工程", exact: true }).click();
  await page.locator(".recent-project").filter({ hasText: "从想法，到成片。" }).click();
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
  const page = await pageWithBridge(true);
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
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("工程"));
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
    await page.getByRole("button", { name: "撤销（⌘ Z）", exact: true }).click();
    await saved(page);
    assert.equal((await readProject(page)).assets.length, 0);
    await page.getByRole("button", { name: "重做（⌘ ⇧ Z）", exact: true }).click();
    await saved(page);
    assert.equal((await readProject(page)).assets[0].id, asset.id);
    await page.locator("[data-add-asset]").click();
    await saved(page);
    const before = await readProject(page);
    await page.reload();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".asset-card").length === 1 &&
        document.querySelectorAll(".asset-card.missing").length === 0,
    );
    assert.deepEqual(await readProject(page), before, "Restoring bytes must not edit the project");
    const pixel = await page
      .locator("#preview")
      .evaluate((canvas) => [
        ...canvas.getContext("2d").getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data,
      ]);
    assert.ok(pixel[0] > 200 && pixel[1] < 100, "Reconnected image is actually painted in preview");
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
    await page.goto(url);
    await page.locator("#preview").waitFor();
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
      { ...before, revision: before.revision + 1 },
      "Reconnection preserves IDs and ranges and saves one recovery revision",
    );
    await page.reload();
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(installGenericMediaTaskMock);
  await page.addInitScript(() => {
    const assetId = "asset-" + "a".repeat(64),
      videoId = "asset-" + "b".repeat(64);
    const asset = {
      id: assetId,
      name: "品牌画面.png",
      mimeType: "image/png",
      bytes: 68,
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
        if (method === "media.import") return job("import");
        if (method === "media.prepare") return { jobs: args.assetIds.map(() => job("prepare")) };
        if (method === "media.assets.get") return { asset, preparation };
        if (method === "media.jobs.list")
          return {
            total: Object.keys(jobs).length,
            jobs: Object.values(jobs).map(({ result, ...j }) => j),
          };
        if (method === "media.jobs.get") return structuredClone(jobs[args.id]);
        if (method === "media.render") {
          window.__renderInput = args;
          return job("render");
        }
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
        if (method === "agent.task.get") return JSON.parse(localStorage.getItem("test-agent-task"));
        if (method === "agent.task.cancel") return { id: args.id, status: "cancelled" };
        throw Error("Unexpected persistent host call: " + method);
      },
    };
  });
  await page.goto(url);
  await page.locator("#preview").waitFor();
  await page.getByRole("button", { name: "导入素材", exact: true }).first().click();
  await page.evaluate(() => window.__completeJob("import"));
  await page.waitForFunction(() =>
    Object.values(JSON.parse(localStorage.getItem("test-jobs"))).some((j) => j.type === "prepare"),
  );
  await page.evaluate(() => window.__completeJob("prepare"));
  await page.waitForFunction(
    () => window.__panelTools.read_video_project().project.assets.length === 1,
  );
  await page.locator('[data-tab="media"]').click();
  await page.locator("[data-add-asset]").click();
  await saved(page);
  assert.equal((await readProject(page)).assets[0].mediaId, "asset-" + "a".repeat(64));
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
    await window.__panelTools.render_video_project({
      projectId: state.project.id,
      requestToken: state.requestToken,
      baseRevision: state.project.revision,
    });
    window.__completeJob("render");
  });
  await page.locator('[data-tab="jobs"]').click();
  await page.getByRole("button", { name: "保存 MP4", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__exports), ["asset-" + "b".repeat(64)]);
  await page.reload();
  await page.locator("#preview").waitFor();
  await page.waitForFunction(
    () => window.__panelTools.read_video_project().missingAssetIds.length === 0,
  );
  assert.equal((await readProject(page)).id, current.id);
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
  await page.locator("#preview").waitFor();
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
  const legacy = {
    ...project,
    revision: 0,
    assets: project.assets.filter((asset) => asset.kind === "demo"),
    audioClips: [],
  };
  await page.locator("#project-input").setInputFiles({
    name: "legacy-demo.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
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
  await page.addInitScript(() => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    window.__panelTools = {};
    window.codeshellPanel = {
      getContext: async () => ({ cwd: "/test/delayed-restore" }),
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
          return {
            revision: 0,
            data:
              args.key === "video-studio-current"
                ? JSON.parse(localStorage.getItem("video-studio-project-v1"))
                : null,
          };
        if (method === "media.jobs.list") {
          window.__releaseRestore = release;
          await gate;
          return { total: 0, jobs: [] };
        }
        throw Error("Unexpected restore method: " + method);
      },
    };
  });
  await page.reload();
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
  await page.goto(url);
  await page.locator("#preview").waitFor();
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
  assert.deepEqual(binding.replaceClip, initial.audioClips[0]);
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
    await page.goto(url);
    await page.locator("#preview").waitFor();
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
    await page.locator("#preview").waitFor();
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
        (binding) => binding.replaceClip,
      ),
    );
    assert.equal(replacementBinding.attachAudio, true);
    assert.deepEqual(replacementBinding.replaceClip, initial.audioClips[0]);
    await page.locator('[data-action="new"]').click();
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
