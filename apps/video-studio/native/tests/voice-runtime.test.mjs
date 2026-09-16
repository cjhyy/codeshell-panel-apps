import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const native = fileURLToPath(new URL("../", import.meta.url));
let root, cli, module, queueRunner;
const scopeKey = "a".repeat(64);
const request = { action: "status", engine: "audio8-tts", scopeKey, jobId: "status" };
before(async () => {
  root = await mkdtemp(join(tmpdir(), "video-voice-runtime-"));
  cli = join(root, "cli.mjs");
  module = join(root, "runtime.mjs");
  queueRunner = join(root, "queue.mjs");
  for (const [entry, outfile] of [
    ["voice-cli.ts", cli],
    ["voice-runtime.ts", module],
  ]) {
    const bundled = await build({
      entryPoints: [join(native, entry)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      metafile: true,
      logLevel: "silent",
    });
    for (const output of Object.values(bundled.metafile.outputs))
      assert.ok(output.imports.every((item) => item.path.startsWith("node:")));
  }
  await build({
    stdin: {
      contents: `
import { acquireVoiceQueue } from ${JSON.stringify(join(native, "queue.ts"))};
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
try {
  const release = await acquireVoiceQueue(process.argv[2], controller.signal, async () => console.log('waiting'));
  console.log('entered');
  await new Promise(resolve => setTimeout(resolve, Number(process.argv[3])));
  await release();
  console.log('released');
} catch { console.log('cancelled'); }
`,
      loader: "ts",
      resolveDir: native,
    },
    outfile: queueRunner,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    logLevel: "silent",
  });
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

function child(args, options = {}) {
  const process = spawn(globalThis.process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  let stdout = "",
    stderr = "";
  process.stdout.on("data", (data) => {
    stdout += data;
  });
  process.stderr.on("data", (data) => {
    stderr += data;
  });
  const done = new Promise((resolve, reject) => {
    process.once("error", reject);
    process.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { process, done, text: () => stdout };
}
async function waitFor(predicate) {
  const deadline = Date.now() + 8000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for native test process");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
const events = (text) =>
  text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
async function invoke(data, directory, env) {
  return child([cli, JSON.stringify(data)], { cwd: directory, env }).done;
}

test("reviewed CLI accepts a library request split across bounded arguments", async () => {
  const appData = join(root, "reviewed-library");
  await mkdir(appData);
  const json = JSON.stringify({ action: "library", operation: "list" });
  const result = await child([cli, json.slice(0, 17), json.slice(17)], { cwd: appData }).done;
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(events(result.stdout), [{ type: "result", result: [] }]);
  assert.deepEqual(await readdir(appData), ["voices"]);
});

test("the standalone ESM imports without executing and status is a read-only offline operation", async () => {
  assert.equal(typeof (await import(pathToFileURL(module).href)).runCli, "function");
  const appData = join(root, "read-only");
  await mkdir(appData);
  const result = await invoke(request, appData);
  assert.equal(result.code, 0);
  const output = events(result.stdout);
  assert.equal(output.length, 1);
  assert.equal(output[0].result.id, "audio8-tts");
  assert.equal(output[0].result.available, false);
  assert.equal(output[0].result.installed, false);
  const supportedPlatform = process.platform === "darwin" && process.arch === "arm64";
  const supportedHost = supportedPlatform && totalmem() >= 4 * 1024 ** 3;
  assert.equal(output[0].result.state, supportedHost ? "not-installed" : "unavailable");
  if (!supportedPlatform) assert.match(output[0].result.reason, /Apple Silicon Mac/);
  else if (!supportedHost) assert.match(output[0].result.reason, /至少需要 4 GB 内存/);
  assert.deepEqual(await readdir(appData), []);
  assert.ok(!result.stdout.includes(appData));
  assert.equal(result.stderr, "");
  const runtime = join(appData, "runtime", "audio8-tts");
  await mkdir(runtime, { recursive: true });
  await writeFile(
    join(runtime, "failure.json"),
    JSON.stringify({ reason: `旧错误包含本地路径 ${appData}/private` }),
  );
  const failed = await invoke(request, appData);
  assert.equal(failed.code, 0);
  assert.ok(!failed.stdout.includes(appData));
  const failedStatus = events(failed.stdout)[0].result;
  if (supportedHost) {
    assert.equal(failedStatus.state, "failed");
    assert.match(failedStatus.reason, /重新准备/);
  } else {
    // Platform requirements take precedence over stale installation errors.
    assert.equal(failedStatus.state, "unavailable");
    assert.equal(failedStatus.reason, output[0].result.reason);
  }
});

test("task identifiers, runtime overrides, traversal and symlink references cannot escape the task", async () => {
  const appData = join(root, "invalid");
  await mkdir(appData);
  for (const changes of [
    { scopeKey: "../outside" },
    { jobId: "../outside" },
    { runtimeDir: "/outside" },
    { referenceFile: "../private.wav" },
    { referenceFile: "output.wav" },
    { engine: "other" },
  ]) {
    const result = await invoke({ ...request, ...changes }, appData);
    assert.equal(result.code, 1);
    assert.equal(events(result.stdout)[0].type, "error");
    assert.ok(!result.stdout.includes(appData));
  }
  assert.deepEqual(await readdir(appData), []);
  const job = join(appData, "jobs", scopeKey, "symlink");
  await mkdir(job, { recursive: true });
  const outside = join(root, "private-reference.wav");
  await writeFile(outside, "private");
  await symlink(outside, join(job, "reference.bin"));
  const result = await invoke(
    {
      ...request,
      action: "generate",
      jobId: "symlink",
      referenceFile: "reference.bin",
      text: "你好",
      referenceText: "你好",
    },
    appData,
  );
  assert.equal(result.code, 1);
  assert.match(events(result.stdout).at(-1).message, /当前声音任务/);
  assert.ok(!result.stdout.includes(root));
  assert.equal(await readFile(outside, "utf8"), "private");
});

test("different native processes serialize, and cancelling a waiter releases only its own ticket", async () => {
  const queue = join(root, "queue");
  const first = child([queueRunner, queue, "1500"]);
  await waitFor(() => first.text().includes("entered"));
  const second = child([queueRunner, queue, "0"]);
  await waitFor(() => second.text().includes("waiting"));
  second.process.kill("SIGTERM");
  assert.match((await second.done).stdout, /cancelled/);
  const third = child([queueRunner, queue, "0"]);
  await waitFor(() => third.text().includes("waiting"));
  assert.ok(!third.text().includes("entered"));
  assert.match((await first.done).stdout, /released/);
  assert.match((await third.done).stdout, /entered/);
  assert.deepEqual(await readdir(queue), []);
  const crashed = child([queueRunner, queue, "30000"]);
  await waitFor(() => crashed.text().includes("entered"));
  crashed.process.kill("SIGKILL");
  await crashed.done;
  assert.match((await child([queueRunner, queue, "0"]).done).stdout, /entered/);
  assert.deepEqual(await readdir(queue), []);
});

test(
  "Host process-group cancellation terminates the installer and clears native queue ownership",
  {
    skip: process.platform !== "darwin" || process.arch !== "arm64",
  },
  async () => {
    const appData = join(root, "cancel");
    const bin = join(root, "bin");
    await mkdir(appData);
    await mkdir(bin);
    for (const name of ["ffmpeg", "ffprobe"]) {
      await writeFile(join(bin, name), "#!/bin/sh\nexit 0\n");
      await chmod(join(bin, name), 0o700);
    }
    await writeFile(
      join(bin, "uv"),
      "#!/bin/sh\nprintf '%s' \"$$\" > installer.pid\nexec /bin/sleep 30\n",
    );
    await chmod(join(bin, "uv"), 0o700);
    const running = child([cli, JSON.stringify({ ...request, action: "setup", jobId: "cancel" })], {
      cwd: appData,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      detached: true,
    });
    await waitFor(async () =>
      Boolean(await readFile(join(appData, "installer.pid")).catch(() => null)),
    );
    const installerPid = Number(await readFile(join(appData, "installer.pid"), "utf8"));
    process.kill(-running.process.pid, "SIGTERM");
    const result = await running.done;
    assert.equal(result.code, 1);
    assert.match(events(result.stdout).at(-1).message, /取消/);
    assert.throws(() => process.kill(installerPid, 0), { code: "ESRCH" });
    assert.deepEqual(await readdir(join(appData, "runtime", ".queues", "audio8-tts")), []);
    assert.ok(!result.stdout.includes(appData));
  },
);

const installed = process.env.VIDEO_STUDIO_TEST_AUDIO8_RUNTIME;
const referencePath = process.env.VIDEO_STUDIO_TEST_AUDIO8_REFERENCE;
const referenceText = process.env.VIDEO_STUDIO_TEST_AUDIO8_TRANSCRIPT;
test(
  "the shipped bundle reuses an installed Audio8 runtime and returns a task-local 48 kHz WAV",
  {
    skip: !installed || !referencePath || !referenceText,
    timeout: 90000,
  },
  async () => {
    const appData = join(root, "real");
    const runtime = join(appData, "runtime", "audio8-tts");
    const actual = join(resolve(installed), "audio8-tts");
    await mkdir(runtime, { recursive: true });
    // Borrow only existing, hash-verified resources. No model or Python package download.
    for (const name of ["code", "model", "venv"])
      await symlink(join(actual, name), join(runtime, name));
    for (const name of ["runtime.json", "runner.py"])
      await copyFile(join(actual, name), join(runtime, name));
    const job = join(appData, "jobs", scopeKey, "real");
    await mkdir(job, { recursive: true });
    await copyFile(referencePath, join(job, "reference.bin"));
    const result = await invoke(
      {
        ...request,
        action: "generate",
        jobId: "real",
        referenceFile: "reference.bin",
        referenceText,
        text: "你好，这是面板本地声音克隆测试。保留完整的句尾。",
        rate: 1.1,
      },
      appData,
    );
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const speech = events(result.stdout).at(-1).result;
    assert.equal(speech.file, "output.wav");
    assert.equal(speech.engine, "audio8-tts");
    assert.equal(speech.sampleRate, 48000);
    assert.equal(speech.channels, 1);
    assert.equal(speech.rate, 1.1);
    assert.ok(speech.durationSeconds > 2);
    assert.equal((await readFile(join(job, speech.file))).length, speech.bytes);
    assert.deepEqual(await readdir(join(job, "work")), []);
    assert.deepEqual(await readdir(join(job, "rendered")), []);
    assert.ok(!result.stdout.includes(root));
    assert.ok(!result.stdout.includes(installed));
  },
);
