import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const appDirectory = resolve(root, "apps/video-download/app");
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
            ".mjs": "text/javascript",
            ".css": "text/css",
          }[extname(path)] || "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

// Only the Host bridge is simulated. Every spawned command is recorded and answered by a
// small fixture environment: no real installer, network request, or executable runs.
async function openSetupPanel(t, environment) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
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
    errors.push(`Unexpected network request: ${route.request().url()}`);
    return route.abort();
  });
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "The setup flow must not throw or request remote resources");
  });
  await page.addInitScript((environment) => {
    const handlers = {};
    let nextProcess = 0;
    const processes = new Map();
    const available = new Set(environment.available);
    window.__spawns = [];
    window.__panelTools = {};
    window.__environmentCalls = [];
    let ytDlpVersion = environment.ytDlpVersion;
    window.__setupEnvironment = { directoryError: "", incomplete: false };
    const emit = (name, payload) => {
      for (const handler of handlers[name] || []) handler(structuredClone(payload));
    };
    window.__emit = emit;
    const finish = (processId, { code = 0, stdout = "", stderr = "" }) => {
      const record = processes.get(processId);
      const events = [
        ...(stdout ? [{ event: "process.output", payload: { stream: "stdout", text: stdout } }] : []),
        ...(stderr ? [{ event: "process.output", payload: { stream: "stderr", text: stderr } }] : []),
        { event: "process.exit", payload: { code } },
      ];
      record.events = events.map((event, index) => ({
        ...event,
        sequence: index + 1,
        payload: { processId, ...event.payload },
      }));
      record.status = "exited";
      record.code = code;
      for (const event of record.events) emit(event.event, event.payload);
    };
    const respond = (args) => {
      const name = args.executableHandle.replace(/^executable-/, "");
      if (name === "yt-dlp" && args.args.includes("--version"))
        return { code: 0, stdout: `${ytDlpVersion}\n` };
      if (name === "yt-dlp" && args.args.includes("-U")) {
        ytDlpVersion = "2026.09.17";
        return { code: 0, stdout: `Updated yt-dlp to ${ytDlpVersion}\n` };
      }
      if (name === "ffmpeg") return { code: 0, stdout: "ffmpeg version 8.1.1\n" };
      if (name === "curl") {
        if (environment.githubRateLimited)
          return { code: 22, stderr: "curl: (22) The requested URL returned error: 403\n" };
        return { code: 0, stdout: '{"tag_name":"2026.09.17","assets":[]}\n' };
      }
      if (name === "brew" && args.args.join(" ") === "install ffmpeg") {
        available.add("ffmpeg");
        return { code: 0, stdout: "installed ffmpeg\n" };
      }
      return { code: 1, stderr: `fixture has no response for ${name} ${args.args.join(" ")}\n` };
    };
    function assertServiceEntry(entry) {
      if (entry !== "entry-download-service") throw new Error(`Unexpected native entry: ${entry}`);
    }
    window.codeshellPanel = {
      getContext: async () => ({
        apiVersion: environment.native ? 14 : 10,
        theme: "light",
        ...(environment.native ? { availableMethods: ["process.resolveEntry"] } : {}),
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
        if (method === "agent.task.models") return { models: [], defaultModel: "" };
        if (method === "agent.task.list") return [];
        if (method === "process.info")
          return { platform: environment.platform, arch: "arm64", libc: "" };
        if (method === "filesystem.getKnownDirectory") {
          if (args.name === "project") {
            if (window.__setupEnvironment.directoryError)
              throw new Error(window.__setupEnvironment.directoryError);
            return { handle: "directory-project", name: "Project", path: "/fixture/project" };
          }
          if (args.name === "user-bin")
            return { handle: "directory-user-bin", name: "bin", path: "/fixture/user-bin" };
          throw new Error(`Unexpected known directory: ${args.name}`);
        }
        if (method === "process.find") {
          if (!available.has(args.name) && !(environment.native && args.name === "node"))
            return { available: false, name: args.name };
          return {
            available: true,
            name: args.name,
            handle: `executable-${args.name}`,
            path: `/fixture/bin/${args.name}`,
          };
        }
        if (method === "process.resolveEntry") return { handle: `entry-${args.name}` };
        if (method === "process.spawn") {
          const processId = `process-${++nextProcess}`;
          window.__spawns.push({ ...structuredClone(args), processId });
          processes.set(processId, { args, input: "", events: [], status: "running", code: null });
          if (!args.entryHandle) setTimeout(() => finish(processId, respond(args)), 0);
          return { processId, executable: args.executableHandle };
        }
        if (method === "process.write") {
          processes.get(args.processId).input += args.text;
          return { written: args.text.length };
        }
        if (method === "process.end") {
          const record = processes.get(args.processId);
          const input = JSON.parse(record.input);
          let result;
          if (record.args.entryHandle === "entry-download-environment") {
            window.__environmentCalls.push(input);
            result = {
              format: "mimi-download.environment",
              schemaVersion: 1,
              ok: true,
              result: {
                cached: input.action !== "refresh",
                dependencies: {
                  "yt-dlp": { available: true, version: ytDlpVersion },
                  ffmpeg: window.__setupEnvironment.incomplete
                    ? { available: false, error: "probe-failed" }
                    : { available: true, version: "8.1.1" },
                },
                ...(input.includeLatest ? { latest: { version: "2026.09.17" } } : {}),
              },
            };
          } else {
            assertServiceEntry(record.args.entryHandle);
            result = {
              format: "mimi-download.service",
              schemaVersion: 1,
              ok: true,
              result: {
                jobs: [],
                truncated: false,
                queue: { revision: 0, paused: false, maxConcurrent: 2, active: 0 },
              },
            };
          }
          finish(args.processId, { stdout: JSON.stringify(result) });
          return { ended: true };
        }
        if (method === "process.get") {
          const record = processes.get(args.processId);
          return {
            found: true,
            processId: args.processId,
            status: record.status,
            code: record.code,
            events: record.events.filter((event) => event.sequence > (args.afterSequence || 0)),
            hasMore: false,
            truncated: false,
          };
        }
        if (method === "process.cancel") return { cancelled: true };
        throw new Error(`Unexpected mock Host call: ${method}`);
      },
    };
  }, environment);
  await page.goto(baseUrl);
  await page.waitForFunction(
    () =>
      window.__panelTools?.get_video_download_context &&
      !document.querySelector("#setup-update-button").disabled,
  );
  return page;
}

async function runSetup(page) {
  const before = await page.evaluate(() => window.__spawns.length);
  await page.locator("#setup-update-button").click();
  await page.waitForFunction(
    () => document.querySelector("#setup-update-label").textContent !== "取消安装 / 更新",
  );
  const spawns = await page.evaluate(() => structuredClone(window.__spawns));
  return spawns.slice(before).map((spawn) => ({
    tool: spawn.executableHandle.replace(/^executable-/, ""),
    args: spawn.args,
  }));
}

test("setup keeps a newer nightly yt-dlp instead of replacing it with the stable release", async (t) => {
  const page = await openSetupPanel(t, {
    platform: "darwin",
    available: ["yt-dlp", "curl", "brew", "chmod", "mv"],
    ytDlpVersion: "2026.09.20.123456",
  });
  const spawns = await runSetup(page);
  assert.equal(
    spawns.some((spawn) => spawn.tool === "yt-dlp" && spawn.args.includes("-U")),
    false,
    `A newer nightly must not be self-updated: ${JSON.stringify(spawns)}`,
  );
  assert.equal(
    spawns.some((spawn) => spawn.args.some((arg) => /releases\/download/.test(arg))),
    false,
    `The stable binary must not be downloaded over a newer nightly: ${JSON.stringify(spawns)}`,
  );
  assert.ok(
    spawns.some((spawn) => spawn.tool === "brew"),
    "Missing ffmpeg is still installed",
  );
  assert.doesNotMatch(await page.locator("#setup-help").textContent(), /初始化失败/);
});

test("a GitHub release outage still installs missing ffmpeg when yt-dlp already works", async (t) => {
  const page = await openSetupPanel(t, {
    platform: "darwin",
    available: ["yt-dlp", "curl", "brew"],
    ytDlpVersion: "2026.09.17",
    githubRateLimited: true,
  });
  const spawns = await runSetup(page);
  assert.ok(
    spawns.some((spawn) => spawn.tool === "brew" && spawn.args.join(" ") === "install ffmpeg"),
    `ffmpeg installation must not depend on the yt-dlp release lookup: ${JSON.stringify(spawns)}`,
  );
  const help = await page.locator("#setup-help").textContent();
  assert.doesNotMatch(help, /初始化失败/);
  assert.match(await page.locator("#setup-result").textContent(), /未能查询 yt-dlp 最新版/);
});

test("a GitHub release outage still fails setup when yt-dlp itself is missing", async (t) => {
  const page = await openSetupPanel(t, {
    platform: "darwin",
    available: ["curl", "brew"],
    ytDlpVersion: "2026.09.17",
    githubRateLimited: true,
  });
  const spawns = await runSetup(page);
  assert.equal(
    spawns.some((spawn) => spawn.tool === "brew"),
    false,
  );
  assert.match(await page.locator("#setup-help").textContent(), /初始化失败/);
});

const nativeEnvironment = {
  platform: "darwin",
  available: ["yt-dlp", "ffmpeg", "curl", "brew"],
  ytDlpVersion: "2026.09.16",
  native: true,
};

async function assertRecheckFailed(page, message) {
  assert.match(await page.locator("#setup-help").textContent(), message);
  assert.equal(await page.locator("#setup-result").isHidden(), true);
  assert.doesNotMatch(await page.locator("#setup-status").textContent(), /已就绪/);
  assert.doesNotMatch(await page.locator("#setup-progress").textContent(), /下载环境复检完成/);
  assert.equal(await page.locator('#setup-progress [data-state="failed"]').count() > 0, true);
}

test("a directory bookmark error fails post-install recheck and permits a successful retry", async (t) => {
  const page = await openSetupPanel(t, nativeEnvironment);
  await page.evaluate(() => {
    window.__setupEnvironment.directoryError = "Invalid Panel directory bookmarks";
  });
  await runSetup(page);
  assert.match(await page.locator("#setup-progress").textContent(), /验证 yt-dlp 版本完成/);
  await assertRecheckFailed(page, /下载环境复检失败：Invalid Panel directory bookmarks/);
  assert.equal(await page.locator("#setup-update-button").isEnabled(), true);

  await page.evaluate(() => {
    window.__setupEnvironment.directoryError = "";
  });
  await runSetup(page);
  assert.doesNotMatch(await page.locator("#setup-help").textContent(), /失败/);
  assert.match(await page.locator("#setup-result").textContent(), /本地安装 \/ 更新完成/);
  assert.match(await page.locator("#setup-progress").textContent(), /下载环境复检完成/);
  assert.equal(
    await page.evaluate(() => window.__environmentCalls.some((input) => input.action === "refresh")),
    true,
    "Post-install verification must refresh the environment rather than reuse its cached result",
  );
});

test("a completed installer cannot report success when dependency verification remains incomplete", async (t) => {
  const page = await openSetupPanel(t, nativeEnvironment);
  await page.evaluate(() => {
    window.__setupEnvironment.incomplete = true;
  });
  await runSetup(page);
  await assertRecheckFailed(page, /下载环境复检未通过：ffmpeg 尚未就绪/);
});

test("AI setup completion preserves a failed recheck and suppresses its claimed success", async (t) => {
  const page = await openSetupPanel(t, nativeEnvironment);
  await page.evaluate(() => {
    window.__setupEnvironment.directoryError = "Invalid Panel directory bookmarks";
    window.__emit("agent.task.changed", {
      id: "setup-fixture",
      key: "setup",
      status: "completed",
      result: { reason: "completed", text: "下载环境已全部初始化成功。" },
    });
  });
  await page.waitForFunction(() =>
    document.querySelector("#setup-help").textContent.includes("下载环境复检失败"),
  );
  await assertRecheckFailed(page, /Invalid Panel directory bookmarks/);
  assert.doesNotMatch(await page.locator("#setup-card").textContent(), /下载环境已全部初始化成功/);
});

for (const failure of ["directory error", "incomplete dependency"]) {
  test(`manual refresh removes an earlier successful setup receipt after ${failure}`, async (t) => {
    const page = await openSetupPanel(t, nativeEnvironment);
    await runSetup(page);
    assert.match(await page.locator("#setup-result").textContent(), /本地安装 \/ 更新完成/);
    assert.match(await page.locator("#setup-progress").textContent(), /下载环境复检完成/);

    await page.evaluate((failure) => {
      if (failure === "directory error")
        window.__setupEnvironment.directoryError = "Invalid Panel directory bookmarks";
      else window.__setupEnvironment.incomplete = true;
    }, failure);
    await page.locator("#refresh-versions").click();
    await page.waitForFunction(() =>
      !document.querySelector("#refresh-versions").disabled &&
      document.querySelector("#setup-result").hidden,
    );
    assert.doesNotMatch(await page.locator("#setup-status").textContent(), /已就绪/);
    assert.doesNotMatch(await page.locator("#setup-progress").textContent(), /下载环境复检完成/);
    if (failure === "directory error")
      assert.match(await page.locator("#setup-help").textContent(), /Invalid Panel directory bookmarks/);
    else {
      assert.match(await page.locator("#setup-status").textContent(), /ffmpeg 检查失败/);
      assert.doesNotMatch(await page.locator("#setup-status").textContent(), /缺少|未安装/);
    }
  });
}
