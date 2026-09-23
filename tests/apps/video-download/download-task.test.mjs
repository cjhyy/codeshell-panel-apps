import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
  symlink,
  link,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseDownloadRequest,
  downloadArguments,
  collectDownloadArtifacts,
  runDownload,
  publishDownloadArtifacts,
} from "../../../apps/video-download/app/tools/download.mjs";

const request = {
  action: "download",
  url: "https://example.com/video",
  configuration: { format: "best" },
};
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "download-task-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "media"));
  return root;
}
function fakeSpawn(run) {
  const calls = [];
  return {
    calls,
    spawn(name, args, options) {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = (signal) => {
        child.killed = signal;
        setImmediate(() => child.emit("close", null));
        return true;
      };
      calls.push({ name, args, options, child });
      setImmediate(async () => {
        if (name === "ffmpeg") child.emit("close", 0);
        else await run(child, options);
      });
      return child;
    },
  };
}

test("download requests reject source code, raw flags, paths, unsafe URLs and malformed options", () => {
  for (const value of [
    { ...request, args: ["--exec", "command"] },
    { ...request, output: "/tmp/escape" },
    { ...request, url: "file:///etc/passwd" },
    { ...request, url: "https://name:secret@example.com/video" },
    { ...request, url: "https://example.com/\nvideo" },
    { ...request, configuration: { format: "--exec" } },
    { ...request, configuration: { playlistItems: "1 --exec=command" } },
    { ...request, configuration: { playlistEnd: 501 } },
    { ...request, configuration: { subtitles: "yes" } },
    { ...request, configuration: { subtitleLanguages: "en;command" } },
    { ...request, configuration: { cookiePath: "/secret" } },
  ])
    assert.throws(() => parseDownloadRequest(value));
  assert.equal(
    parseDownloadRequest({ ...request, jobId: "host-id", scopeKey: "host-scope" }).url,
    request.url,
  );
});

test("reviewed options handle quality, playlist and subtitles without browser argv", () => {
  const args = downloadArguments(
    {
      ...request,
      configuration: {
        format: "1080",
        playlist: true,
        playlistItems: "1-3,7",
        subtitles: true,
        subtitleMode: "both",
        subtitleLanguages: "zh.*,en.*",
        embedSubtitles: true,
      },
    },
    true,
  );
  assert.deepEqual(args.slice(-2), ["--", request.url]);
  for (const name of [
    "--ignore-config",
    "--no-simulate",
    "--write-subs",
    "--write-auto-subs",
    "--embed-subs",
  ])
    assert.ok(args.includes(name));
  assert.equal(args[args.indexOf("--format-sort") + 1], "res:1080");
  assert.equal(args[args.indexOf("--playlist-items") + 1], "1-3,7");
  assert.throws(
    () => downloadArguments({ ...request, configuration: { format: "audio" } }, false),
    /FFmpeg/,
  );
  assert.ok(downloadArguments(request, false).includes("best[ext=mp4]/best"));
});

test("artifact inventory streams exact bytes and ignores unfinished fragments", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "media", "one.mp4"), "complete video fixture");
  await writeFile(join(root, "media", "one.en.vtt"), "WEBVTT\n");
  await writeFile(join(root, "media", "two.mp4.part"), "partial");
  const artifacts = await collectDownloadArtifacts(root);
  assert.equal(artifacts.length, 2);
  const video = artifacts.find((item) => item.name === "one.mp4");
  assert.equal(video.bytes, Buffer.byteLength("complete video fixture"));
  assert.equal(video.sha256, createHash("sha256").update("complete video fixture").digest("hex"));
  assert.equal(video.assetId, `asset-${video.sha256}`);
  assert.equal(video.file, "media/one.mp4");
});

for (const kind of ["symlink", "hardlink", "empty", "subtitle-only"]) {
  test(`artifact capture rejects ${kind} output`, async (t) => {
    const root = await fixture(t);
    await writeFile(join(root, "outside"), "private bytes");
    if (kind === "symlink") await symlink(join(root, "outside"), join(root, "media", "one.mp4"));
    if (kind === "hardlink") await link(join(root, "outside"), join(root, "media", "one.mp4"));
    if (kind === "empty") await writeFile(join(root, "media", "one.mp4"), "");
    if (kind === "subtitle-only") await writeFile(join(root, "media", "one.vtt"), "WEBVTT\n");
    await assert.rejects(
      collectDownloadArtifacts(root),
      (error) => error.code === (kind === "subtitle-only" ? "NO_MEDIA" : "UNSAFE_OUTPUT"),
    );
  });
}

test("background worker launches fixed executables and returns resources only after success", async (t) => {
  const root = await fixture(t),
    updates = [];
  const fake = fakeSpawn(async (child, options) => {
    await writeFile(join(options.cwd, "fixture.mp4"), "media bytes");
    child.stderr.write("progress: 50.0%\nprivate https://example.com/?token=secret\n");
    child.emit("close", 0);
  });
  const result = await runDownload(request, {
    jobDir: root,
    spawnProcess: fake.spawn,
    progress: (value) => updates.push(value),
  });
  assert.equal(result.kind, "video-download");
  assert.equal(result.artifacts.length, 1);
  assert.deepEqual(
    fake.calls.map((call) => call.name),
    ["ffmpeg", "yt-dlp"],
  );
  assert.ok(fake.calls.every((call) => call.options.shell === false));
  assert.ok(updates.some((update) => update.fraction === 0.5));
  assert.ok(!JSON.stringify(updates).includes("secret"));
});

test("partial provider failure never publishes stale files as success or leaks stderr", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "media", "old.mp4"), "old output");
  const fake = fakeSpawn(async (child) => {
    child.stderr.write("token=supersecret\n");
    child.emit("close", 1);
  });
  await assert.rejects(
    runDownload(request, { jobDir: root, spawnProcess: fake.spawn }),
    (error) => error.code === "DOWNLOAD_FAILED" && !error.message.includes("supersecret"),
  );
});

test("cancellation waits for the subprocess exit and does not publish its output", async (t) => {
  const root = await fixture(t),
    controller = new AbortController();
  let launched;
  const ready = new Promise((resolve) => {
    launched = resolve;
  });
  const fake = fakeSpawn(async () => launched());
  const pending = runDownload(request, {
    jobDir: root,
    signal: controller.signal,
    spawnProcess: fake.spawn,
  });
  await ready;
  controller.abort(new Error("cancelled"));
  await assert.rejects(pending, /cancelled/);
  assert.equal(fake.calls.at(-1).child.killed, "SIGTERM");
});

test("publication copies verified files and an explicit retry reuses matching bytes", async (t) => {
  const root = await fixture(t),
    output = join(root, "selected");
  await mkdir(output);
  await writeFile(join(root, "media", "one.mp4"), "verified download");
  const artifacts = await collectDownloadArtifacts(root);
  const first = await publishDownloadArtifacts(root, output, artifacts);
  assert.equal(await readFile(join(output, "one.mp4"), "utf8"), "verified download");
  assert.deepEqual(first[0].published, { path: "one.mp4", reused: false });
  const again = await publishDownloadArtifacts(root, output, artifacts);
  assert.deepEqual(again[0].published, { path: "one.mp4", reused: true });
  assert.ok(!JSON.stringify(again).includes(output));
  assert.deepEqual(await readdir(output), ["one.mp4"]);
});

for (const collision of ["different-content", "symbolic-link", "directory"]) {
  test(`publication refuses ${collision} at the destination without overwriting it`, async (t) => {
    const root = await fixture(t),
      output = join(root, "selected");
    await mkdir(output);
    await writeFile(join(root, "media", "one.mp4"), "verified download");
    const artifacts = await collectDownloadArtifacts(root);
    const target = join(output, "one.mp4");
    if (collision === "different-content") await writeFile(target, "keep my file");
    else if (collision === "symbolic-link") await symlink(join(root, "media", "one.mp4"), target);
    else await mkdir(target);
    await assert.rejects(
      publishDownloadArtifacts(root, output, artifacts),
      (error) => error.code === "OUTPUT_CONFLICT",
    );
    if (collision === "different-content")
      assert.equal(await readFile(target, "utf8"), "keep my file");
    assert.deepEqual(await readdir(output), ["one.mp4"]);
  });
}

test("publication rejects source replacement, traversal and already-cancelled work", async (t) => {
  const root = await fixture(t),
    output = join(root, "selected");
  await mkdir(output);
  await writeFile(join(root, "media", "one.mp4"), "original");
  const artifacts = await collectDownloadArtifacts(root);
  await writeFile(join(root, "media", "one.mp4"), "replaced");
  await assert.rejects(
    publishDownloadArtifacts(root, output, artifacts),
    (error) => error.code === "OUTPUT_CHANGED",
  );
  await assert.rejects(
    publishDownloadArtifacts(root, output, [
      { ...artifacts[0], name: "../escape", file: "media/../escape" },
    ]),
    (error) => error.code === "UNSAFE_OUTPUT",
  );
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(
    publishDownloadArtifacts(root, output, artifacts, controller.signal),
    /cancelled/,
  );
  assert.deepEqual(await readdir(output), []);
});

test("download worker publishes through its Host directory and copy variants have distinct stable names", async (t) => {
  const root = await fixture(t),
    output = join(root, "selected");
  await mkdir(output);
  const fake = fakeSpawn(async (child) => {
    await writeFile(join(root, "media", "one.mp4"), "downloaded");
    child.emit("close", 0);
  });
  const result = await runDownload(request, {
    jobDir: root,
    outputDir: output,
    spawnProcess: fake.spawn,
  });
  assert.equal(result.artifacts[0].published.path, "one.mp4");
  assert.equal(await readFile(join(output, "one.mp4"), "utf8"), "downloaded");
  const template = (value) => {
    const args = downloadArguments(value, true);
    return args[args.indexOf("--output") + 1];
  };
  assert.equal(template(request), template(request));
  assert.notEqual(template(request), template({ ...request, configuration: { format: "720" } }));
  assert.match(template({ ...request, copySuffix: "aabbccdd" }), /_copy-aabbccdd/);
  assert.throws(() => parseDownloadRequest({ ...request, copySuffix: "../escape" }));
  assert.equal(
    parseDownloadRequest({ ...request, configuration: { playlistEnd: null } }).configuration
      .playlistEnd,
    0,
  );
});

test("background authenticated downloads consume only the Host private file and keep it out of artifacts", async (t) => {
  const root = await fixture(t);
  const custody = await fixture(t);
  const cookiesFile = join(custody, "cookies.txt");
  await writeFile(
    cookiesFile,
    "# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t0\tsession\tprivate-cookie\n",
    { mode: 0o600 },
  );
  const child = fakeSpawn(async (process, options) => {
    await writeFile(join(options.cwd, "video.mp4"), "video output");
    process.emit("close", 0);
  });
  const result = await runDownload(
    { ...request, useSavedLogin: true },
    { jobDir: root, cookiesFile, spawnProcess: child.spawn },
  );
  const args = child.calls.find((call) => call.name === "yt-dlp").args;
  assert.equal(args[args.indexOf("--cookies") + 1], cookiesFile);
  assert.ok(args.indexOf("--cookies") < args.indexOf("--"));
  assert.ok(!JSON.stringify(result).includes("private-cookie"));
  assert.ok(!JSON.stringify(result).includes(cookiesFile));
  assert.equal(result.artifacts.length, 1);
  assert.match(await readFile(cookiesFile, "utf8"), /private-cookie/); // Host owns cleanup.
});

for (const kind of ["missing", "anonymous", "inside-task", "symlink", "hardlink", "public-mode"]) {
  test(`background Cookie input rejects ${kind} before launching a program`, async (t) => {
    if (kind === "public-mode" && process.platform === "win32") return t.skip("POSIX modes");
    const root = await fixture(t),
      custody = await fixture(t);
    let cookiesFile = join(kind === "inside-task" ? root : custody, "cookies.txt");
    await writeFile(cookiesFile, "private-cookie", {
      mode: kind === "public-mode" ? 0o644 : 0o600,
    });
    if (["symlink", "hardlink"].includes(kind)) {
      const alias = join(custody, "alias.txt");
      await (kind === "symlink" ? symlink : link)(cookiesFile, alias);
      cookiesFile = alias;
    }
    if (kind === "missing") cookiesFile = undefined;
    let spawned = false;
    await assert.rejects(
      runDownload(
        { ...request, useSavedLogin: kind !== "anonymous" },
        {
          jobDir: root,
          cookiesFile,
          spawnProcess() {
            spawned = true;
            throw new Error("must not launch");
          },
        },
      ),
      (error) => error.code === "COOKIE_UNAVAILABLE" && !error.message.includes(custody),
    );
    assert.equal(spawned, false);
  });
}

test("browser JSON cannot supply a cookie file and account downloads require HTTPS", () => {
  for (const value of [
    { ...request, cookiesFile: "/private/cookie" },
    { ...request, useSavedLogin: "true" },
    { ...request, useSavedLogin: true, url: "http://example.com/video" },
  ])
    assert.throws(() => parseDownloadRequest(value));
  assert.throws(() => downloadArguments({ ...request, useSavedLogin: true }, true), /不匹配/);
});
