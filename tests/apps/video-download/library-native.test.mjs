import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  handleLibraryRequest,
  MAX_CHECK_FILES,
  MAX_REQUEST_BYTES,
  openCommand,
  parseLibraryRequest,
  readLibraryInput,
} from "../../../apps/video-download/app/tools/library.mjs";

const entry = fileURLToPath(
  new URL("../../../apps/video-download/app/tools/library.mjs", import.meta.url),
);

async function fixture(t) {
  const temporary = await fs.mkdtemp(join(tmpdir(), "download-library-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const cwd = join(temporary, "downloads");
  await fs.mkdir(cwd);
  return { temporary, cwd };
}

async function check(cwd, files, options = {}) {
  return (await handleLibraryRequest({ action: "check", files }, { cwd, ...options })).files;
}

function mockSpawn(calls, failure = false) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => {
      if (failure) child.emit("error", new Error("private system error"));
      else {
        child.emit("spawn");
        child.emit("close", 0);
      }
    });
    return child;
  };
}

test("checks real local media, records bounded metadata, and detects deletion and empty files", async (t) => {
  const { cwd } = await fixture(t);
  const path = join(cwd, "video.mp4");
  await fs.writeFile(path, "example media fixture");
  const [present] = await check(cwd, [{ path: "video.mp4" }]);
  assert.deepEqual(present, {
    path: "video.mp4",
    status: "present",
    bytes: 21,
    modifiedAt: Math.trunc((await fs.stat(path)).mtimeMs),
  });
  assert.equal(
    (await check(cwd, [{ path, bytes: present.bytes, modifiedAt: present.modifiedAt }]))[0].status,
    "present",
  );
  await fs.unlink(path);
  assert.deepEqual((await check(cwd, [{ path: "video.mp4" }]))[0], {
    path: "video.mp4",
    status: "missing",
  });
  await fs.writeFile(path, "");
  assert.equal((await check(cwd, [{ path }]))[0].status, "empty");
});

test("detects size changes and same-size replacements by recorded modification time", async (t) => {
  const { cwd } = await fixture(t);
  const path = join(cwd, "video.webm");
  await fs.writeFile(path, "first");
  await fs.utimes(path, 1_700_000_000, 1_700_000_000);
  const [before] = await check(cwd, [{ path: "video.webm" }]);
  await fs.writeFile(path, "after");
  await fs.utimes(path, 1_700_000_001, 1_700_000_001);
  assert.equal(
    (
      await check(cwd, [{ path: before.path, bytes: before.bytes, modifiedAt: before.modifiedAt }])
    )[0].status,
    "changed",
  );
  await fs.writeFile(path, "different size");
  assert.equal(
    (await check(cwd, [{ path: before.path, bytes: before.bytes }]))[0].status,
    "changed",
  );
});

test("rejects directories, traversal, sibling prefixes, URLs and unsupported file types", async (t) => {
  const { cwd, temporary } = await fixture(t);
  await fs.mkdir(join(cwd, "directory.mp4"));
  await fs.writeFile(join(temporary, "private.mp4"), "private content");
  await fs.mkdir(`${cwd}-sibling`);
  await fs.writeFile(join(`${cwd}-sibling`, "private.mp4"), "private content");
  await fs.writeFile(join(cwd, "page.html"), "<script>forbidden</script>");
  const inputs = [
    "directory.mp4",
    "../private.mp4",
    join(`${cwd}-sibling`, "private.mp4"),
    "https://example.com/video.mp4",
    "file:///private.mp4",
    "page.html",
    "C:video.mp4",
    "bad\nvideo.mp4",
  ];
  const results = await check(
    cwd,
    inputs.map((path) => ({ path })),
  );
  assert.equal(results.length, inputs.length);
  for (const [index, result] of results.entries()) {
    assert.equal(result.path, inputs[index]);
    assert.equal(result.status, "unavailable");
    assert.equal("bytes" in result, false);
    assert.equal("modifiedAt" in result, false);
  }
});

test("does not follow an escaping directory symlink, even for a missing target", async (t) => {
  const { cwd, temporary } = await fixture(t);
  const outside = join(temporary, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(join(outside, "private.mp4"), "private");
  await fs.symlink(outside, join(cwd, "linked"), process.platform === "win32" ? "junction" : "dir");
  const results = await check(cwd, [
    { path: "linked/private.mp4" },
    { path: "linked/missing.mp4" },
  ]);
  assert.deepEqual(
    results.map(({ status }) => status),
    ["unavailable", "unavailable"],
  );
  assert(results.every(({ error }) => error === "symbolic-link-not-allowed"));
});

test(
  "rejects both external and internal file symlinks",
  { skip: process.platform === "win32" },
  async (t) => {
    const { cwd, temporary } = await fixture(t);
    await fs.writeFile(join(temporary, "outside.mp4"), "private");
    await fs.writeFile(join(cwd, "inside.mp4"), "local");
    await fs.symlink(join(temporary, "outside.mp4"), join(cwd, "outside-link.mp4"));
    await fs.symlink(join(cwd, "inside.mp4"), join(cwd, "inside-link.mp4"));
    const results = await check(cwd, [{ path: "outside-link.mp4" }, { path: "inside-link.mp4" }]);
    assert(results.every(({ status }) => status === "unavailable"));
  },
);

test("permission errors and an unavailable authorized directory are never reported as deleted files", async (t) => {
  const { cwd } = await fixture(t);
  const deniedFs = {
    ...fs,
    lstat: async () => {
      throw Object.assign(new Error("private filename must not leak"), { code: "EACCES" });
    },
  };
  const [denied] = await check(cwd, [{ path: "video.mp4" }], { fs: deniedFs });
  assert.deepEqual(denied, { path: "video.mp4", status: "unavailable", error: "file-unavailable" });
  const [offline] = await check(join(cwd, "offline"), [{ path: "video.mp4" }]);
  assert.deepEqual(offline, {
    path: "video.mp4",
    status: "unavailable",
    error: "authorized-directory-unavailable",
  });
});

test("opening uses fixed platform commands and literal argv without a shell", async (t) => {
  const { cwd } = await fixture(t);
  const filename = "-R $(touch injected) 'quoted'.mp4";
  const path = join(cwd, filename);
  await fs.writeFile(path, "media");
  const calls = [];
  const spawnProcess = mockSpawn(calls);
  const result = await handleLibraryRequest(
    { action: "open", files: [{ path: filename }] },
    { cwd, platform: "darwin", spawnProcess },
  );
  assert.equal(result.files[0].status, "present");
  assert.deepEqual(calls, [
    {
      command: "/usr/bin/open",
      args: ["--", await fs.realpath(path)],
      options: { shell: false, stdio: "ignore", windowsHide: true },
    },
  ]);
  assert.equal(
    await fs.stat(join(cwd, "injected")).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.deepEqual(openCommand("reveal", "/downloads/file.mp4", { platform: "darwin" }), {
    command: "/usr/bin/open",
    args: ["-R", "--", "/downloads/file.mp4"],
  });
  assert.deepEqual(openCommand("reveal", "/downloads/file.mp4", { platform: "linux" }), {
    command: "/usr/bin/xdg-open",
    args: ["/downloads"],
  });
  assert.deepEqual(
    openCommand("open", "C:\\Downloads\\file.mp4", {
      platform: "win32",
      windowsRoot: "C:\\Windows",
    }),
    { command: "C:\\Windows\\explorer.exe", args: ["C:\\Downloads\\file.mp4"] },
  );
  assert.deepEqual(
    openCommand("reveal", "C:\\Downloads\\file.mp4", {
      platform: "win32",
      windowsRoot: "C:\\Windows",
    }),
    { command: "C:\\Windows\\explorer.exe", args: ["/select,C:\\Downloads\\file.mp4"] },
  );
});

test("check never opens files and open/reveal refuse missing, empty, changed and rejected files", async (t) => {
  const { cwd } = await fixture(t);
  await fs.writeFile(join(cwd, "video.mp4"), "media");
  await fs.writeFile(join(cwd, "empty.mp4"), "");
  const calls = [];
  const options = { cwd, platform: "darwin", spawnProcess: mockSpawn(calls) };
  await handleLibraryRequest({ action: "check", files: [{ path: "video.mp4" }] }, options);
  for (const action of ["play", "open", "reveal"]) {
    for (const file of [
      { path: "missing.mp4" },
      { path: "empty.mp4" },
      { path: "video.mp4", bytes: 999 },
      { path: "../outside.mp4" },
    ]) {
      const result = await handleLibraryRequest({ action, files: [file] }, options);
      assert.notEqual(result.files[0].status, "present");
    }
  }
  assert.equal(calls.length, 0);
});

test("open failures produce only a bounded public error", async (t) => {
  const { cwd } = await fixture(t);
  await fs.writeFile(join(cwd, "video.mp4"), "media");
  const result = await handleLibraryRequest(
    { action: "reveal", files: [{ path: "video.mp4" }] },
    { cwd, platform: "darwin", spawnProcess: mockSpawn([], true) },
  );
  assert.equal(result.files[0].status, "present");
  assert.equal(result.files[0].error, "unable-to-open-file");
  assert.equal(JSON.stringify(result).includes("private system error"), false);
});

test("an opener must finish successfully; spawning alone cannot report success", async (t) => {
  const { cwd } = await fixture(t);
  await fs.writeFile(join(cwd, "video.mp4"), "media");
  for (const code of [0, 1, null]) {
    let child, started;
    const spawned = new Promise((resolve) => {
      started = resolve;
    });
    let settled = false;
    const request = handleLibraryRequest(
      { action: "reveal", files: [{ path: "video.mp4" }] },
      {
        cwd,
        platform: "darwin",
        spawnProcess() {
          child = new EventEmitter();
          queueMicrotask(() => {
            child.emit("spawn");
            started();
          });
          return child;
        },
      },
    ).then((result) => {
      settled = true;
      return result;
    });
    await spawned;
    assert.equal(settled, false);
    child.emit("close", code);
    const result = await request;
    assert.equal(result.files[0].status, "present");
    assert.equal(result.files[0].error, code === 0 ? undefined : "unable-to-open-file");
  }
});

test("macOS playback uses existing compatible players and keeps system open separate", async (t) => {
  const { cwd } = await fixture(t);
  const path = join(cwd, "download.mp4");
  await fs.writeFile(path, "media");
  for (const installed of [[], ["Google Chrome"], ["VLC", "Google Chrome"], ["IINA", "VLC"]]) {
    const calls = [];
    const playerFs = {
      ...fs,
      async stat(path, ...args) {
        if (path.startsWith("/Applications/")) {
          return {
            isDirectory: () => installed.some((app) => path === `/Applications/${app}.app`),
          };
        }
        return fs.stat(path, ...args);
      },
    };
    const options = { cwd, fs: playerFs, platform: "darwin", spawnProcess: mockSpawn(calls) };
    const result = await handleLibraryRequest({ action: "play", files: [{ path }] }, options);
    assert.equal(result.files[0].player, installed[0] || "系统播放器");
    assert.deepEqual(
      calls[0].args,
      installed.length
        ? ["-a", `/Applications/${installed[0]}.app`, "--", await fs.realpath(path)]
        : ["--", await fs.realpath(path)],
    );
    await handleLibraryRequest({ action: "open", files: [{ path }] }, options);
    assert.deepEqual(calls[1].args, ["--", await fs.realpath(path)]);
  }
});

test("validates action, file count, fields and metadata before touching the filesystem", async () => {
  const invalid = [
    null,
    { action: "execute", files: [] },
    { action: "open", files: [] },
    { action: "reveal", files: [{ path: "a.mp4" }, { path: "b.mp4" }] },
    {
      action: "check",
      files: Array.from({ length: MAX_CHECK_FILES + 1 }, () => ({ path: "a.mp4" })),
    },
    { action: "check", files: [{ path: "x.mp4", bytes: -1 }] },
    { action: "check", files: [{ path: "x.mp4", modifiedAt: 1.5 }] },
    { action: "check", files: [{ path: "x.mp4", command: "touch marker" }] },
    { action: "check", files: [], command: "touch marker" },
  ];
  for (const value of invalid) assert.throws(() => parseLibraryRequest(value), /^Error: invalid-/);
  assert.deepEqual(parseLibraryRequest({ action: "check", files: [] }), {
    action: "check",
    files: [],
  });
  await assert.rejects(
    readLibraryInput(Readable.from([Buffer.alloc(MAX_REQUEST_BYTES + 1)])),
    /request-too-large/,
  );
  await assert.rejects(readLibraryInput(Readable.from(["{invalid"])), /invalid-json/);
});

test("the native CLI reads stdin and emits exactly one JSON result without side effects", async (t) => {
  const { cwd } = await fixture(t);
  await fs.writeFile(join(cwd, "subtitles.zh.vtt"), "WEBVTT\n");
  const run = (input) => spawnSync(process.execPath, [entry], { cwd, input, encoding: "utf8" });
  const good = run(
    JSON.stringify({
      action: "check",
      files: [{ path: "subtitles.zh.vtt" }, { path: "missing.mp4" }],
    }),
  );
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stderr, "");
  assert.equal(good.stdout.trim().split("\n").length, 1);
  assert.deepEqual(
    JSON.parse(good.stdout).files.map(({ status }) => status),
    ["present", "missing"],
  );
  const malformed = run("not-json");
  assert.equal(malformed.status, 1);
  assert.deepEqual(JSON.parse(malformed.stdout), { files: [], error: "invalid-json" });
  const oversized = run(" ".repeat(MAX_REQUEST_BYTES + 1));
  assert.equal(oversized.status, 1);
  assert.deepEqual(JSON.parse(oversized.stdout), { files: [], error: "request-too-large" });
});

test("the platform opener planner also refuses URLs, relative paths and executable extensions", () => {
  for (const file of [
    "https://example.com/video.mp4",
    "../video.mp4",
    "/downloads/command.sh",
    "/downloads/video\n.mp4",
  ]) {
    assert.throws(() => openCommand("open", file, { platform: "darwin" }), /invalid-file-path/);
  }
  assert.throws(
    () => openCommand("open", "C:\\Downloads\\video.mp4:stream.mp4", { platform: "win32" }),
    /invalid-file-path/,
  );
});
