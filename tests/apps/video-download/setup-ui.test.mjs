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
          { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(path)] ||
          "application/octet-stream",
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
    const available = new Set(environment.available);
    window.__spawns = [];
    window.__panelTools = {};
    const emit = (name, payload) => {
      for (const handler of handlers[name] || []) handler(structuredClone(payload));
    };
    const respond = (args) => {
      const name = args.executableHandle.replace(/^executable-/, "");
      if (name === "yt-dlp" && args.args.includes("--version"))
        return { code: 0, stdout: `${environment.ytDlpVersion}\n` };
      if (name === "yt-dlp" && args.args.includes("-U"))
        return { code: 0, stdout: `Updated yt-dlp to ${environment.ytDlpVersion}\n` };
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
        if (method === "agent.task.models") return { models: [], defaultModel: "" };
        if (method === "agent.task.list") return [];
        if (method === "process.info")
          return { platform: environment.platform, arch: "arm64", libc: "" };
        if (method === "filesystem.getKnownDirectory") {
          if (args.name === "project")
            return { handle: "directory-project", name: "Project", path: "/fixture/project" };
          if (args.name === "user-bin")
            return { handle: "directory-user-bin", name: "bin", path: "/fixture/user-bin" };
          throw new Error(`Unexpected known directory: ${args.name}`);
        }
        if (method === "process.find") {
          if (!available.has(args.name)) return { available: false, name: args.name };
          return {
            available: true,
            name: args.name,
            handle: `executable-${args.name}`,
            path: `/fixture/bin/${args.name}`,
          };
        }
        if (method === "process.spawn") {
          const processId = `process-${++nextProcess}`;
          window.__spawns.push({ ...structuredClone(args), processId });
          const { code, stdout = "", stderr = "" } = respond(args);
          setTimeout(() => {
            if (stdout) emit("process.output", { processId, stream: "stdout", text: stdout });
            if (stderr) emit("process.output", { processId, stream: "stderr", text: stderr });
            emit("process.exit", { processId, code });
          }, 0);
          return { processId, executable: args.executableHandle };
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
