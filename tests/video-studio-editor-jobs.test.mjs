import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

let browser, source, css;
const assetId = `asset-${"d".repeat(64)}`;
const job = (id, createdAt, status = "succeeded", extra = {}) => ({
  id,
  status,
  attempt: 1,
  createdAt,
  updatedAt: createdAt,
  entry: { name: "editor-runtime" },
  input: { request: { action: "render", sequenceId: id } },
  ...(status === "succeeded" ? { result: { verified: true, video: { id: assetId } } } : {}),
  ...extra,
});
before(async () => {
  const bundle = await build({
    stdin: {
      contents: `export { EditorExportJobs } from './apps/video-studio/src/editor/jobs-ui';`,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "editor",
    platform: "browser",
    target: "chrome120",
  });
  source = bundle.outputFiles[0].text;
  css = (
    await Promise.all(
      ["style.css", "editor-workspace.css"].map((name) =>
        readFile(new URL(`../apps/video-studio/public/${name}`, import.meta.url), "utf8"),
      ),
    )
  ).join("\n");
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});
async function fixture(t, specifications = [], options = {}) {
  const page = await browser.newPage({ viewport: { width: options.width ?? 1000, height: 800 } }),
    uncaught = [];
  page.setDefaultTimeout(4000);
  page.on("pageerror", (error) => uncaught.push(error.message));
  t.after(async () => {
    await page.close();
    assert.deepEqual(uncaught, []);
  });
  await page.setContent(
    '<!doctype html><body><header id="toolbar"><button data-export>导出</button></header><main><button>编辑器</button></main></body>',
  );
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: source });
  await page.evaluate(
    ({ specifications, options }) => {
      const jobs = new Map(specifications.map((job) => [job.id, structuredClone(job)])),
        calls = [],
        errors = [],
        subscribers = new Set(),
        held = new Map(),
        pending = new Map();
      let panel;
      const bridge = {
        getContext: async () => ({
          availableMethods: [
            "tasks.list",
            "tasks.get",
            "tasks.cancel",
            "tasks.retry",
            "media.export",
            "media.reveal",
          ],
          capabilities: {
            bridge: {
              maxCallsPerWindow: 10000,
              maxTransferCallsPerWindow: 10000,
              rateWindowMs: 1000,
            },
          },
        }),
        on: (event, listener) => {
          if (event === "tasks.changed") subscribers.add(listener);
          return () => subscribers.delete(listener);
        },
        call: async (method, args) => {
          calls.push({ method, args: structuredClone(args) });
          const requestedJob =
            method === "tasks.get" ? structuredClone(jobs.get(args.id)) : undefined;
          if (held.get(method))
            await new Promise((resolve, reject) => {
              pending.set(method, { resolve, reject });
            });
          if (method === "tasks.list")
            return [...jobs.values()]
              .slice(args.offset, args.offset + args.limit)
              .map(({ id, entry, status, createdAt }) => ({ id, entry, status, createdAt }));
          if (method === "tasks.get") {
            const value = requestedJob;
            if (!value) throw Error("任务已不存在");
            return structuredClone(value);
          }
          if (method === "tasks.cancel") {
            const value = { ...jobs.get(args.id), status: "cancelled", updatedAt: Date.now() };
            jobs.set(args.id, value);
            return structuredClone(value);
          }
          if (method === "tasks.retry") {
            const value = {
              ...jobs.get(args.id),
              status: "queued",
              attempt: jobs.get(args.id).attempt + 1,
              updatedAt: Date.now(),
              error: undefined,
            };
            delete value.error;
            jobs.set(args.id, value);
            return structuredClone(value);
          }
          if (["media.export", "media.reveal"].includes(method)) return { saved: true };
          throw Error(`Unexpected host mutation ${method}`);
        },
      };
      const finished = [];
      panel = new editor.EditorExportJobs(bridge, (error) => errors.push(String(error)), {
        onFinished: (job) => finished.push({ id: job.id, status: job.status }),
      });
      panel.mountTrigger(
        document.querySelector("#toolbar"),
        document.querySelector("[data-export]"),
      );
      window.fixture = {
        calls,
        errors,
        finished,
        track: (id) => panel.track(structuredClone(jobs.get(id)), id),
        load: () => panel.loadMore(),
        remount: () =>
          panel.mountTrigger(
            document.querySelector("#toolbar"),
            document.querySelector("[data-export]"),
          ),
        hold: (method) => held.set(method, true),
        release: (method) => {
          held.delete(method);
          pending.get(method)?.resolve();
          pending.delete(method);
        },
        reject: (method) => {
          held.delete(method);
          pending.get(method)?.reject(new Error("迟到的连接失败"));
          pending.delete(method);
        },
        pending: (method) => pending.has(method),
        notify: (id, patch) => {
          jobs.set(id, { ...jobs.get(id), ...structuredClone(patch) });
          for (const listener of subscribers) listener({ id });
        },
        publish: (id, patch) => {
          jobs.set(id, { ...jobs.get(id), ...structuredClone(patch) });
          panel.track(structuredClone(jobs.get(id)), id);
        },
        dispose: () => panel.dispose(),
        watchers: () => subscribers.size,
      };
      if (options.holdGet) fixture.hold("tasks.get");
      if (options.track) fixture.track(options.track);
    },
    { specifications, options },
  );
  return page;
}
const row = (page, id) => page.locator(`[data-job-id="${id}"]`);
const more = (page) => page.getByRole("button", { name: /加载.*任务/ });
const settle = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function open(page) {
  await page.getByRole("button", { name: /^导出记录/ }).click();
}
const calls = (page, method) =>
  page.evaluate((method) => fixture.calls.filter((call) => call.method === method), method);

test("empty exports and completed history stay out of the editing area until requested", async (t) => {
  const page = await fixture(t, [job("done", 1)]);
  assert.equal(await page.locator(".editor-export-jobs").isVisible(), false);
  await page.evaluate(() => fixture.load());
  assert.equal(await page.locator(".editor-export-jobs").isVisible(), false);
  assert.equal(await page.locator(".editor-export-jobs-badge").isVisible(), false);
  await page.evaluate(() => fixture.remount());
  assert.equal(await page.locator(".editor-export-jobs-trigger").count(), 1);
  assert.equal(
    await page
      .locator("[data-export]")
      .evaluate((node) =>
        node.previousElementSibling.classList.contains("editor-export-jobs-trigger"),
      ),
    true,
  );
  await open(page);
  assert.equal(await row(page, "done").isVisible(), true);
  await page.getByRole("button", { name: "关闭导出任务" }).click();
  assert.equal(await page.locator(".editor-export-jobs").isVisible(), false);
  assert.equal(
    await page
      .getByRole("button", { name: "导出记录", exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
});

test("an empty task history can be opened, closed with Escape and dismissed outside", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => fixture.load());
  assert.equal(await page.locator(".editor-export-jobs").isVisible(), false);
  await open(page);
  assert.equal(await page.getByText("暂无导出任务").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".editor-export-jobs").isVisible(), false);
  await open(page);
  await page.getByRole("button", { name: "编辑器", exact: true }).click();
  assert.equal(await page.locator(".editor-export-jobs").isVisible(), false);
  assert.equal(
    await page
      .getByRole("button", { name: "编辑器", exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
});

test("narrow screens keep the task view and sticky close control within the viewport", async (t) => {
  const page = await fixture(
    t,
    Array.from({ length: 12 }, (_, index) =>
      job(`long-export-${index}-${"very-long-sequence-name-".repeat(6)}`, index),
    ),
    { width: 360 },
  );
  await page.evaluate(() => fixture.load());
  const trigger = page.getByRole("button", { name: "导出记录", exact: true });
  assert.ok((await trigger.boundingBox()).width <= 40);
  await trigger.click();
  const view = page.locator(".editor-export-jobs");
  const bounds = await view.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 360);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 800);
  assert.equal(await view.evaluate((node) => node.scrollWidth > node.clientWidth), false);
  await view.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const close = page.getByRole("button", { name: "关闭导出任务" });
  const closeBounds = await close.boundingBox();
  assert.ok(
    closeBounds.y >= bounds.y && closeBounds.y + closeBounds.height <= bounds.y + bounds.height,
  );
  await close.click();
  assert.equal(await view.isVisible(), false);
});

test("task controls isolate editing shortcuts while preserving normal button keyboard activation", async (t) => {
  const page = await fixture(t, [job("done", 1)], { track: "done" });
  await page.evaluate(() => {
    window.editingKeys = [];
    document.addEventListener("keydown", (event) => window.editingKeys.push(event.key));
  });
  await page.keyboard.press("Delete");
  await page.keyboard.press("s");
  await page.keyboard.press("Control+z");
  assert.deepEqual(await page.evaluate(() => window.editingKeys), []);
  await page.keyboard.press("Tab");
  assert.equal(
    await row(page, "done")
      .getByRole("button", { name: "保存视频" })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press("Space");
  await page.waitForFunction(() => fixture.calls.some((call) => call.method === "media.export"));
  assert.equal((await calls(page, "media.export")).length, 1);
  assert.deepEqual(await page.evaluate(() => window.editingKeys), []);
});

test("progress updates preserve task action focus and completion keeps focus inside the open view", async (t) => {
  const page = await fixture(t, [job("focused", 1, "running")], { track: "focused" });
  await page.waitForFunction(() => fixture.watchers() === 1);
  await settle(page);
  await row(page, "focused").getByRole("button", { name: "取消", exact: true }).focus();
  await page.evaluate(() =>
    fixture.notify("focused", { updatedAt: 2, progress: { fraction: 0.4 } }),
  );
  await page.waitForFunction(
    () => document.querySelector('[data-job-id="focused"] progress').value === 0.4,
  );
  assert.equal(
    await row(page, "focused")
      .getByRole("button", { name: "取消", exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.evaluate(
    (assetId) =>
      fixture.notify("focused", {
        status: "succeeded",
        updatedAt: 3,
        result: { verified: true, video: { id: assetId } },
      }),
    assetId,
  );
  await row(page, "focused").getByRole("button", { name: "保存视频" }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "关闭导出任务" })
      .evaluate((node) => node === document.activeElement),
    true,
  );
});

test("an async task action cannot steal focus after the task view has been dismissed", async (t) => {
  const page = await fixture(t, [job("pending-focus", 1, "running")], { track: "pending-focus" });
  await settle(page);
  await page.evaluate(() => fixture.hold("tasks.cancel"));
  await row(page, "pending-focus").getByRole("button", { name: "取消", exact: true }).click();
  await page.waitForFunction(() => fixture.pending("tasks.cancel"));
  assert.equal(
    await page
      .getByRole("button", { name: "关闭导出任务" })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.getByRole("button", { name: "编辑器", exact: true }).click();
  await page.evaluate(() => fixture.release("tasks.cancel"));
  await page.waitForFunction(
    () => document.querySelector('[data-job-id="pending-focus"] output').textContent === "已取消",
  );
  assert.equal(await page.locator(".editor-export-jobs").isVisible(), false);
  assert.equal(
    await page
      .getByRole("button", { name: "编辑器", exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
});

test("active history stays collapsed and progress never reopens a dismissed task view", async (t) => {
  const page = await fixture(t, [job("active", 1, "running")]);
  await page.evaluate(() => fixture.load());
  await page.waitForFunction(() => fixture.watchers() === 1);
  assert.equal(await page.locator(".editor-export-jobs").isVisible(), false);
  assert.equal(
    await page.getByRole("button", { name: "导出记录，1 个任务进行中" }).isVisible(),
    true,
  );
  await open(page);
  await page.getByRole("button", { name: "关闭导出任务" }).click();
  await settle(page);
  await page.evaluate(
    (assetId) =>
      fixture.notify("active", {
        status: "succeeded",
        updatedAt: 2,
        result: { verified: true, video: { id: assetId } },
      }),
    assetId,
  );
  await page.waitForFunction(
    () => document.querySelector('[data-job-id="active"] output').textContent === "导出完成",
  );
  assert.equal(await page.locator(".editor-export-jobs").isVisible(), false);
  assert.equal(await page.locator(".editor-export-jobs-badge").isVisible(), false);
  assert.equal((await calls(page, "tasks.cancel")).length, 0);
  await open(page);
  assert.equal(
    await row(page, "active").getByRole("button", { name: "保存视频" }).isVisible(),
    true,
  );
});

test("a lost status connection offers refresh and resumes watching without another export", async (t) => {
  const page = await fixture(t, [job("disconnected", 1, "running")], {
    track: "disconnected",
    holdGet: true,
  });
  await page.waitForFunction(() => fixture.pending("tasks.get"));
  await page.evaluate(() => fixture.reject("tasks.get"));
  await row(page, "disconnected").getByRole("button", { name: "刷新状态" }).waitFor();
  assert.equal(
    await row(page, "disconnected").locator("output").textContent(),
    "状态暂未同步，请刷新查看",
  );
  assert.equal(await row(page, "disconnected").locator("progress").isVisible(), false);
  await row(page, "disconnected").getByRole("button", { name: "刷新状态" }).click();
  await page.waitForFunction(() => fixture.watchers() === 1);
  await settle(page);
  await page.evaluate(
    (assetId) =>
      fixture.notify("disconnected", {
        status: "succeeded",
        updatedAt: 2,
        result: { verified: true, video: { id: assetId } },
      }),
    assetId,
  );
  await row(page, "disconnected").getByRole("button", { name: "保存视频" }).waitFor();
  assert.equal((await calls(page, "tasks.start")).length, 0);
});

test("job history loads bounded pages without skipping preparations and keeps newest exports first", async (t) => {
  const entries = [
    job("newest", 100),
    ...Array.from({ length: 48 }, (_, i) =>
      job(`prepare-${i}`, 99 - i, "succeeded", { input: { request: { action: "prepare-video" } } }),
    ),
    job("middle", 30),
    job("oldest", 20),
  ];
  const page = await fixture(t, entries);
  await open(page);
  await more(page).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-job-id]").length === 2);
  assert.deepEqual(
    await page.locator("[data-job-id]").evaluateAll((rows) => rows.map((row) => row.dataset.jobId)),
    ["newest", "middle"],
  );
  assert.deepEqual(
    (await calls(page, "tasks.list")).map((c) => c.args),
    [{ offset: 0, limit: 50 }],
  );
  await more(page).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-job-id]").length === 3);
  assert.deepEqual(
    await page.locator("[data-job-id]").evaluateAll((rows) => rows.map((row) => row.dataset.jobId)),
    ["newest", "middle", "oldest"],
  );
  assert.deepEqual(
    (await calls(page, "tasks.list")).map((c) => c.args),
    [
      { offset: 0, limit: 50 },
      { offset: 50, limit: 50 },
    ],
  );
  assert.equal(await page.locator("[data-more]").isVisible(), false);
  assert.equal((await calls(page, "tasks.start")).length, 0);
});

test("failed history fetch preserves its cursor and can retry the same page", async (t) => {
  const page = await fixture(t, [job("only", 1)]);
  await page.evaluate(() => fixture.hold("tasks.list"));
  await open(page);
  await more(page).click();
  await page.waitForFunction(() => fixture.pending("tasks.list"));
  assert.equal(await more(page).isDisabled(), true);
  await page.evaluate(() => fixture.reject("tasks.list"));
  await page.waitForFunction(() => fixture.errors.length === 1);
  await more(page).click();
  await row(page, "only").waitFor();
  assert.deepEqual(
    (await calls(page, "tasks.list")).map((c) => c.args.offset),
    [0, 0],
  );
});

test("a watched export enables save and reveal only after a verified native result", async (t) => {
  const page = await fixture(t, [job("running", 1, "running", { progress: { fraction: 0.25 } })], {
    track: "running",
  });
  await page.waitForFunction(() => fixture.calls.some((c) => c.method === "tasks.get"));
  assert.equal(await row(page, "running").locator("progress").getAttribute("value"), "0.25");
  assert.equal(await row(page, "running").getByRole("button", { name: "保存视频" }).count(), 0);
  await settle(page);
  await page.evaluate(
    (assetId) =>
      fixture.notify("running", {
        status: "succeeded",
        updatedAt: 2,
        result: { result: { verified: true, video: { id: assetId } } },
      }),
    assetId,
  );
  await row(page, "running").getByRole("button", { name: "保存视频" }).waitFor();
  await row(page, "running").getByRole("button", { name: "保存视频" }).click();
  await row(page, "running").getByRole("button", { name: "在文件夹中显示" }).click();
  assert.deepEqual(
    (await calls(page, "media.export")).map((c) => c.args),
    [{ assetId }],
  );
  assert.deepEqual(
    (await calls(page, "media.reveal")).map((c) => c.args),
    [{ assetId }],
  );
  assert.equal(await row(page, "running").locator("output").textContent(), "导出完成");
  assert.equal(await row(page, "running").locator("progress").getAttribute("value"), "1");
});

test("unverified output and terminal nonretryable failures expose no unsafe actions", async (t) => {
  const page = await fixture(t, [
    job("unverified", 3, "succeeded", { result: { verified: false, video: { id: assetId } } }),
    job("bad-resource", 2, "succeeded", {
      result: { verified: true, video: { id: "/tmp/foreign.mp4" } },
    }),
    job("failed", 1, "failed", {
      error: { code: "BAD_INPUT", message: "素材已变化", retryable: false },
    }),
  ]);
  await open(page);
  await more(page).click();
  await row(page, "failed").waitFor();
  assert.equal(await page.getByRole("button", { name: "保存视频" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "重试", exact: true }).count(), 0);
  assert.equal(await row(page, "failed").locator("output").textContent(), "素材已变化");
  assert.equal(await row(page, "failed").locator("progress").isVisible(), false);
});

test("pending cancellation stays disabled across native progress notifications and submits once", async (t) => {
  const page = await fixture(t, [job("running", 1, "running")], { track: "running" });
  await settle(page);
  await page.evaluate(() => fixture.hold("tasks.cancel"));
  await row(page, "running").getByRole("button", { name: "取消", exact: true }).click();
  await page.waitForFunction(() => fixture.pending("tasks.cancel"));
  const gets = (await calls(page, "tasks.get")).length;
  await page.evaluate(() =>
    fixture.notify("running", { updatedAt: 2, progress: { fraction: 0.7 } }),
  );
  await page.waitForFunction(
    (count) => fixture.calls.filter((c) => c.method === "tasks.get").length > count,
    gets,
  );
  await settle(page);
  assert.equal(
    await row(page, "running").getByRole("button", { name: "取消", exact: true }).isDisabled(),
    true,
    "Polling must not recreate an enabled in-flight action",
  );
  assert.equal((await calls(page, "tasks.cancel")).length, 1);
  await page.evaluate(() => fixture.release("tasks.cancel"));
  await page.waitForFunction(
    () => document.querySelector('[data-job-id="running"] output').textContent === "已取消",
  );
  assert.equal(
    await row(page, "running").getByRole("button", { name: "取消", exact: true }).count(),
    0,
  );
});

test("retry uses the same durable job, tracks the new attempt and never starts a duplicate task", async (t) => {
  const page = await fixture(
    t,
    [
      job("retry", 1, "failed", {
        error: { code: "TRANSIENT", message: "暂时失败", retryable: true },
        recovery: "retry",
      }),
    ],
    { track: "retry" },
  );
  await row(page, "retry").getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction(() => fixture.calls.some((c) => c.method === "tasks.get"));
  await settle(page);
  await page.evaluate(
    (assetId) =>
      fixture.notify("retry", {
        status: "succeeded",
        attempt: 2,
        updatedAt: Date.now(),
        result: { verified: true, video: { id: assetId } },
      }),
    assetId,
  );
  await row(page, "retry").getByRole("button", { name: "保存视频" }).waitFor();
  assert.deepEqual(
    (await calls(page, "tasks.retry")).map((c) => c.args),
    [{ id: "retry" }],
  );
  assert.equal((await calls(page, "tasks.start")).length, 0);
  assert.equal(await page.locator('[data-job-id="retry"]').count(), 1);
});

test("disposing during history loading silences a late failure and removes the view", async (t) => {
  const page = await fixture(t, [job("done", 1)]);
  await page.evaluate(() => fixture.hold("tasks.list"));
  await open(page);
  await more(page).click();
  await page.waitForFunction(() => fixture.pending("tasks.list"));
  await page.evaluate(() => fixture.dispose());
  await page.evaluate(() => fixture.reject("tasks.list"));
  await settle(page);
  assert.equal(await page.locator(".editor-export-jobs").count(), 0);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("disposing a watched export stops local observation without cancelling durable work", async (t) => {
  const page = await fixture(t, [job("durable", 1, "running")], { track: "durable" });
  await page.waitForFunction(() => fixture.watchers() === 1);
  await page.evaluate(() => fixture.dispose());
  await page.waitForFunction(() => fixture.watchers() === 0);
  assert.equal((await calls(page, "tasks.cancel")).length, 0);
  assert.equal(await page.locator(".editor-export-jobs").count(), 0);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a late failed save after disposal does not report an error to the closed editor", async (t) => {
  const page = await fixture(t, [job("done", 1)], { track: "done" });
  await page.evaluate(() => fixture.hold("media.export"));
  await row(page, "done").getByRole("button", { name: "保存视频" }).click();
  await page.waitForFunction(() => fixture.pending("media.export"));
  await page.evaluate(() => fixture.dispose());
  await page.evaluate(() => fixture.reject("media.export"));
  await settle(page);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
});

test("a running snapshot returned after confirmed cancellation cannot revive a terminal task", async (t) => {
  const page = await fixture(t, [job("late", 1, "running")], { track: "late", holdGet: true });
  await page.waitForFunction(() => fixture.pending("tasks.get"));
  await row(page, "late").getByRole("button", { name: "取消", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-job-id="late"] output').textContent === "已取消",
  );
  await page.evaluate(() => fixture.release("tasks.get"));
  await settle(page);
  assert.equal(await row(page, "late").locator("output").textContent(), "已取消");
  assert.equal(
    await row(page, "late").getByRole("button", { name: "取消", exact: true }).count(),
    0,
  );
});

test("a late snapshot from an older attempt cannot undo a successful retry", async (t) => {
  const page = await fixture(
    t,
    [
      job("retry-late", 1, "failed", {
        error: { code: "TEMP", message: "第一次失败", retryable: true },
        recovery: "retry",
      }),
    ],
    { track: "retry-late" },
  );
  await row(page, "retry-late").getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-job-id="retry-late"] output').textContent === "等待导出",
  );
  await page.evaluate(() =>
    fixture.publish("retry-late", {
      status: "failed",
      attempt: 1,
      updatedAt: Date.now() + 1000,
      error: { code: "TEMP", message: "旧尝试迟到", retryable: true },
    }),
  );
  await settle(page);
  assert.equal(await row(page, "retry-late").locator("output").textContent(), "等待导出");
  assert.equal(
    await row(page, "retry-late").getByRole("button", { name: "重试", exact: true }).count(),
    0,
  );
  await page.evaluate(
    (assetId) =>
      fixture.notify("retry-late", {
        status: "succeeded",
        attempt: 2,
        updatedAt: Date.now() + 2000,
        result: { verified: true, video: { id: assetId } },
      }),
    assetId,
  );
  await row(page, "retry-late").getByRole("button", { name: "保存视频" }).waitFor();
  assert.equal((await calls(page, "tasks.retry")).length, 1);
});

test("finishing a watched export tells the panel once, so its readiness refreshes right away", async (t) => {
  const page = await fixture(t, [job("running", 1, "running"), job("done", 0)], {
    track: "running",
  });
  await page.waitForFunction(() => fixture.calls.some((c) => c.method === "tasks.get"));
  await page.evaluate(() => fixture.load());
  await settle(page);
  assert.deepEqual(await page.evaluate(() => fixture.finished), [], "History is not a completion");
  await page.evaluate(
    (assetId) =>
      fixture.notify("running", {
        status: "succeeded",
        updatedAt: 2,
        result: { result: { verified: true, video: { id: assetId } } },
      }),
    assetId,
  );
  await page.waitForFunction(() => fixture.finished.length === 1);
  await page.evaluate(() => fixture.publish("running", { updatedAt: 3 }));
  await settle(page);
  assert.deepEqual(await page.evaluate(() => fixture.finished), [
    { id: "running", status: "succeeded" },
  ]);
});

test("an export first seen already finished also refreshes readiness, once", async (t) => {
  const page = await fixture(t, [job("fast", 1)]);
  await page.evaluate(() => fixture.track("fast"));
  await settle(page);
  await page.evaluate(() => fixture.track("fast"));
  await settle(page);
  assert.deepEqual(await page.evaluate(() => fixture.finished), [
    { id: "fast", status: "succeeded" },
  ]);
});
