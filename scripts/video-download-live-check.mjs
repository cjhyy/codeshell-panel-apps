// Opt-in integration check: real yt-dlp/ffmpeg, loopback media, isolated storage.
// The test bridge replaces Host grants, model calls, and the remote version check.
// It never reads cookies or downloads third-party media.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const flags = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, i, all) => {
    if (i % 2 === 0) pairs.push([value, all[i + 1]]);
    return pairs;
  }, []),
);
const ytdlp = flags["--yt-dlp"];
const ffmpeg = flags["--ffmpeg"];
if (!ytdlp || !ffmpeg || !isAbsolute(ytdlp) || !isAbsolute(ffmpeg))
  throw new Error("Pass absolute --yt-dlp and --ffmpeg paths.");
const artifacts = resolve(
  flags["--output"] || join(root, "artifacts/video-download/live-pipeline"),
);
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "video-download-live-"));
const downloads = join(temporary, "downloads");
const alternate = join(temporary, "chosen-folder");
await mkdir(downloads);
await mkdir(alternate);
const sample = join(temporary, "sample.mp4");
const env = {
  ...process.env,
  PATH: `${dirname(ffmpeg)}${sep === "/" ? ":" : ";"}${process.env.PATH || ""}`,
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
};
execFileSync(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    sample,
  ],
  { env },
);
const media = await readFile(sample);
const probe = (file) =>
  JSON.parse(
    execFileSync(
      join(dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe"),
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      { env, encoding: "utf8" },
    ),
  );
const version = execFileSync(ytdlp, ["--version"], { encoding: "utf8", env }).trim();
const appRoot = join(root, "apps/video-download/app");
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname.startsWith("/media/") && pathname.endsWith(".mp4")) {
    response.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": media.length,
      "Accept-Ranges": "none",
    });
    response.end(request.method === "HEAD" ? undefined : media);
    return;
  }
  if (pathname === "/media/captions.vtt") {
    response.writeHead(200, { "Content-Type": "text/vtt" });
    response.end("WEBVTT\n\n00:00.000 --> 00:01.500\nVideo download integration check\n");
    return;
  }
  if (pathname === "/media/lesson.html") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      '<html><head><title>本地流程验证课程</title></head><body><video controls src="/media/lesson.mp4"><track kind="subtitles" src="/media/captions.vtt" srclang="en" label="English"></video></body></html>',
    );
    return;
  }
  const path = resolve(appRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!path.startsWith(appRoot + sep)) return response.writeHead(403).end();
  try {
    const content = await readFile(path);
    response.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".css": "text/css",
          ".png": "image/png",
        }[extname(path)] || "application/octet-stream",
    });
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
page.setDefaultTimeout(30_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const store = new Map(),
  processes = new Map();
let sequence = 0,
  delivery = Promise.resolve(),
  actualDownloads = 0,
  peakConcurrentDownloads = 0;
const paths = { "exe:yt-dlp": ytdlp, "exe:ffmpeg": ffmpeg, "exe:node": process.execPath };
const directories = { project: downloads, chosen: alternate };
const bookmarks = {
  project: "a0123456-1234-4567-8901-123456789abc",
  chosen: "b0123456-1234-4567-8901-123456789abc",
};
const directory = (handle) => ({
  handle,
  path: directories[handle],
  name: handle === "project" ? "流程验证" : "自选目录",
  bookmark: bookmarks[handle],
});
function emit(id, event, payload) {
  const record = processes.get(id);
  record.events.push({ sequence: record.events.length + 1, event, payload });
  if (event === "process.exit") {
    record.status = "exited";
    record.code = payload.code;
  }
  delivery = delivery
    .then(() =>
      page.evaluate(({ event, payload }) => window.__emit(event, payload), { event, payload }),
    )
    .catch((error) => errors.push(error.message));
}
await page.exposeFunction("__hostCall", async (method, args = {}) => {
  if (method === "storage.get") return store.get(args.key) ?? null;
  if (method === "storage.set") {
    store.set(args.key, structuredClone(args.value));
    return true;
  }
  if (method === "agent.task.models") return { models: [], defaultModel: "" };
  if (method === "agent.task.list") return [];
  if (method === "credentials.cookies.list") return { accounts: [] };
  if (method === "filesystem.getKnownDirectory") {
    assert.equal(args.name, "project");
    return directory("project");
  }
  if (method === "filesystem.pickDirectory") return directory("chosen");
  if (method === "filesystem.restoreDirectory") {
    const handle = Object.keys(bookmarks).find((key) => bookmarks[key] === args.bookmark);
    assert.ok(handle);
    return directory(handle);
  }
  if (method === "process.find")
    return {
      available: args.name === "curl" || Boolean(paths[`exe:${args.name}`]),
      handle: `exe:${args.name}`,
      name: args.name,
      path: paths[`exe:${args.name}`] || "/usr/bin/curl",
    };
  if (method === "process.resolveEntry") {
    assert.equal(args.name, "download-library");
    return { handle: "native:download-library" };
  }
  if (method === "process.spawn") {
    const id = `live-${++sequence}`;
    const record = { events: [], status: "running", code: null, child: null };
    processes.set(id, record);
    if (args.executableHandle === "exe:curl") {
      setTimeout(() => {
        emit(id, "process.output", {
          processId: id,
          stream: "stdout",
          text: JSON.stringify({ tag_name: version }),
        });
        emit(id, "process.exit", { processId: id, code: 0 });
      }, 0);
      return { processId: id };
    }
    assert.ok(directories[args.directoryHandle], "Unexpected directory grant");
    assert.ok(paths[args.executableHandle], "Unexpected executable grant");
    // Keep this loopback-only fixture independent of system proxy discovery.
    const argv = args.entryHandle
      ? [join(appRoot, "tools/library.mjs")]
      : args.executableHandle === "exe:yt-dlp"
        ? ["--proxy", "", ...args.args]
        : args.args;
    if (args.entryHandle) assert.equal(args.entryHandle, "native:download-library");
    if (
      args.executableHandle === "exe:yt-dlp" &&
      !argv.includes("--version") &&
      !argv.includes("--skip-download")
    ) {
      actualDownloads++;
      record.isDownload = true;
      peakConcurrentDownloads = Math.max(
        peakConcurrentDownloads,
        [...processes.values()].filter((item) => item.isDownload && item.status === "running")
          .length,
      );
    }
    const child = spawn(paths[args.executableHandle], argv, {
      cwd: directories[args.directoryHandle],
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    record.child = child;
    for (const stream of ["stdout", "stderr"])
      child[stream].on("data", (text) =>
        emit(id, "process.output", { processId: id, stream, text: text.toString() }),
      );
    child.on("close", (code) => emit(id, "process.exit", { processId: id, code }));
    child.on("error", (error) => errors.push(error.message));
    if (args.stdin !== "pipe") child.stdin.end();
    return { processId: id, executable: paths[args.executableHandle] };
  }
  if (method === "process.write") {
    processes.get(args.processId).child.stdin.write(args.text);
    return { written: args.text.length };
  }
  if (method === "process.end") {
    processes.get(args.processId).child.stdin.end();
    return { closed: true };
  }
  if (method === "process.cancel") {
    processes.get(args.processId).child.kill("SIGTERM");
    return { cancelled: true };
  }
  if (method === "process.get") {
    const record = processes.get(args.processId);
    const events = record.events
      .filter((event) => event.sequence > (args.afterSequence || 0))
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
  throw new Error(`Unexpected Host method: ${method}`);
});
await page.addInitScript((cwd) => {
  const handlers = {};
  window.__panelTools = {};
  window.__emit = (name, payload) => {
    for (const handler of handlers[name] || []) handler(payload);
  };
  window.codeshellPanel = {
    getContext: async () => ({ apiVersion: 14, cwd, theme: "light" }),
    registerTool: (name, handler) => {
      window.__panelTools[name] = handler;
      return () => {};
    },
    on: (name, handler) => {
      (handlers[name] ||= []).push(handler);
      return () => {};
    },
    call: (...args) => window.__hostCall(...args),
  };
}, downloads);
const checks = [];
const passed = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const waitReady = () =>
  page.waitForFunction(
    (version) =>
      window.__panelTools.get_video_download_context &&
      document.querySelector("#installed-ytdlp-version").textContent === version &&
      !document.querySelector("#refresh-versions").disabled,
    version,
  );
const waitCompleted = (count) =>
  page.waitForFunction(
    (count) => {
      const failed = document.querySelector('.queue-item[data-state="failed"]');
      if (failed) throw new Error(failed.textContent);
      return (
        document.querySelectorAll('.queue-item[data-state="completed"]').length >= count &&
        document.querySelector("#download-button").disabled === false
      );
    },
    count,
    { timeout: 180_000 },
  );
try {
  await page.goto(origin);
  await waitReady();
  const urls = [`${origin}/media/clip-a.mp4`, `${origin}/media/clip-b.mp4`];
  await page.locator("#url-input").fill(urls.join("\n"));
  await page.locator("#inspect-button").click();
  await page.waitForFunction(
    () => document.querySelector("#inspect-status").textContent.includes("已获取 2/2 条"),
    null,
    { timeout: 150_000 },
  );
  passed("real metadata for two independent media links");
  await page.locator("#download-button").click();
  await waitCompleted(2);
  const videoFiles = (await readdir(downloads)).filter((name) => name.endsWith(".mp4"));
  assert.equal(videoFiles.length, 2);
  for (const file of videoFiles) {
    assert.ok((await stat(join(downloads, file))).size > 1000);
    const metadata = probe(join(downloads, file));
    assert.ok(Number(metadata.format.duration) >= 1.9);
    assert.ok(metadata.streams.some((stream) => stream.codec_type === "video"));
    assert.ok(metadata.streams.some((stream) => stream.codec_type === "audio"));
  }
  assert.ok(peakConcurrentDownloads >= 2, "Both real yt-dlp downloads must overlap");
  passed("concurrent downloads produce two independent playable MP4 files");
  await page.locator(".queue-open").first().click();
  assert.equal(await page.locator(".history-highlight").count(), 1);
  assert.match(await page.locator("#history-jump-status").textContent(), /已定位/);
  passed("completed queue item opens and highlights its real download record");
  await page.locator('[data-tab="download"]').click();
  await writeFile(
    join(artifacts, "download-checkpoint.json"),
    JSON.stringify(
      {
        library: [...store.entries()],
        output: [...processes.values()].flatMap((record) =>
          record.events
            .filter((event) => event.event === "process.output")
            .map((event) => event.payload),
        ),
      },
      null,
      2,
    ),
  );
  await page.locator("#url-input").fill(urls[0]);
  await page.locator("#download-button").click();
  await page.locator("#duplicate-review").waitFor({ state: "visible" });
  assert.equal(actualDownloads, 2);
  await page.locator('[data-duplicate-action="skip"]').click();
  passed("duplicate check verifies the existing file and prevents an extra download");
  const deleted = videoFiles.find((name) => name.includes("clip-a"));
  assert.ok(deleted);
  await rm(join(downloads, deleted));
  await page.locator("#download-button").click();
  await waitCompleted(3);
  assert.ok((await stat(join(downloads, deleted))).size > 1000);
  passed("deleted output can be downloaded again despite a retained history link");
  await page.locator("#quality-select").selectOption("audio");
  await page.locator("#download-button").click();
  await waitCompleted(4);
  const audioFiles = (await readdir(downloads)).filter((name) => name.endsWith(".mp3"));
  assert.equal(audioFiles.length, 1);
  assert.ok(
    probe(join(downloads, audioFiles[0])).streams.every((stream) => stream.codec_type === "audio"),
  );
  passed("audio-only mode runs real FFmpeg conversion and produces MP3");
  await page.locator("#quality-select").selectOption("best");
  await page.locator("#url-input").fill(`${origin}/media/lesson.html`);
  await page.getByText("同时下载字幕", { exact: true }).click();
  assert.equal(await page.locator("#subtitle-toggle").isChecked(), true);
  await page.locator("#subtitle-language-preset").selectOption("en");
  await page.locator("#download-button").click();
  await waitCompleted(5);
  assert.ok((await readdir(downloads)).some((name) => name.endsWith(".srt")));
  const subtitledFile = (await readdir(downloads)).find(
    (name) => name.includes("lesson") && name.endsWith(".mp4"),
  );
  assert.ok(subtitledFile);
  assert.ok(
    probe(join(downloads, subtitledFile)).streams.some(
      (stream) => stream.codec_type === "subtitle",
    ),
  );
  passed("HTML5 captions are downloaded and converted to SRT alongside the video");
  await page.locator("#choose-directory").click();
  await page.waitForFunction(
    () =>
      !document.querySelector("#choose-directory").disabled &&
      document.querySelector("#destination-path").textContent.includes("chosen-folder"),
  );
  await page.reload();
  await waitReady();
  assert.match(await page.locator("#destination-path").textContent(), /chosen-folder/);
  assert.equal(
    (await page.evaluate(() => window.__panelTools.get_video_download_context())).destination
      .reauthorizationRequired,
    undefined,
  );
  passed("chosen directory survives a panel reload");
  await page.locator('[data-tab="history"]').click();
  assert.equal(await page.locator(".history-item").count(), 5);
  await page.locator("#history-check").click();
  await page.waitForFunction(() => !document.querySelector("#history-check").disabled);
  assert.match(await page.locator("#history-list").textContent(), /上次检查文件存在/);
  passed("history survives reload and native file checks inspect real output files");
  await page.screenshot({ path: join(artifacts, "real-download-history.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    join(artifacts, "report.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        version,
        checks,
        actualDownloads,
        peakConcurrentDownloads,
        downloads,
        videoFiles,
        limitations: [
          "Loopback test media; no external platform availability claim",
          "Host grants and model calls use an isolated test bridge",
          "Remote version lookup is deterministic",
        ],
      },
      null,
      2,
    ),
  );
  console.log(`REPORT ${join(artifacts, "report.json")}`);
} catch (error) {
  await page.screenshot({ path: join(artifacts, "failure.png"), fullPage: true });
  await writeFile(
    join(artifacts, "failure.json"),
    JSON.stringify(
      {
        error: error.message,
        checks,
        errors,
        library: [...store.entries()],
        state: await page.evaluate(() => window.__panelTools?.get_video_download_context?.()),
        stderr: [...processes.values()]
          .map((record) =>
            record.events
              .filter((event) => event.payload?.stream === "stderr")
              .map((event) => event.payload.text)
              .join(""),
          )
          .filter(Boolean),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  for (const record of processes.values())
    if (record.status !== "exited") record.child?.kill("SIGTERM");
  await delivery;
  await browser.close();
  await new Promise((done) => server.close(done));
}
