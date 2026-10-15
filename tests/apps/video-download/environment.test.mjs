import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRuntimeExecutable, getEnvironment, main } from "../../../apps/video-download/app/tools/environment.mjs";

const NOW = Date.parse("2026-10-15T00:00:00Z");
const HOUR = 60 * 60 * 1000;
const entry = fileURLToPath(new URL("../../../apps/video-download/app/tools/environment.mjs", import.meta.url));
const supported = process.platform !== "win32";
const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const networkDenied = () => { throw new Error("Unlisted network request"); };

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mimi-environment-")));
  const project = join(root, "project"), home = join(root, "home"), bin = join(root, "bin");
  for (const directory of [project, home, bin]) await mkdir(directory, { mode: 0o700 });
  const executable = (name) => join(bin, name + (process.platform === "win32" ? ".exe" : ""));
  for (const name of ["yt-dlp", "ffmpeg"]) await writeFile(executable(name), "fixture binary", { mode: 0o700 });
  const env = { PATH: bin, HOME: home, USERPROFILE: home, LANG: "C.UTF-8" };
  const calls = [];
  const probe = async (path, args, options) => {
    calls.push({ path, args, env: options.env });
    return args[0] === "-version" ? "ffmpeg version 8.0 fixture" : "2026.10.15\n";
  };
  const options = { env, probe, fetcher: networkDenied, now: NOW };
  const cache = join(project, ".mimi-download-cli", "environment");
  const read = async (name = "local.json") => JSON.parse(await readFile(join(cache, name), "utf8"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, project, home, bin, env, executable, calls, options, cache, read };
}

async function withExecutable(f, name, source) {
  await writeFile(f.executable(name), `#!${process.execPath}\n${source}\n`, { mode: 0o700 });
}

async function until(path, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await lstat(path).catch(() => null)) return;
    await pause(20);
  }
  assert.fail(`fixture file was not created: ${path}`);
}

test("environment cache reuses local versions without spawning or networking", async (t) => {
  const f = await fixture(t);
  const first = await getEnvironment(f.project, f.options);
  assert.equal(first.format, "mimi-download.environment");
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.ok, true);
  assert.equal(first.result.ready, true);
  assert.equal(first.result.cached, false);
  assert.equal(first.result.dependencies["yt-dlp"].path, f.executable("yt-dlp"));
  assert.equal(first.result.node.path, process.execPath);
  assert.equal(first.result.node.version, process.versions.node);
  const second = await getEnvironment(f.project, { ...f.options, now: NOW + 1000 });
  assert.equal(second.result.cached, true);
  assert.equal(second.result.checkedAt, first.result.checkedAt);
  assert.equal(f.calls.length, 2);
  assert.equal(second.result.latest, undefined);
  if (supported) {
    assert.equal((await lstat(f.cache)).mode & 0o077, 0);
    assert.equal((await lstat(join(f.cache, "local.json"))).mode & 0o077, 0);
  }
});

test("explicit refresh and elapsed local TTL run probes again", async (t) => {
  const f = await fixture(t);
  await getEnvironment(f.project, f.options);
  assert.equal((await getEnvironment(f.project, { ...f.options, refresh: true })).result.cached, false);
  assert.equal(f.calls.length, 4);
  assert.equal((await getEnvironment(f.project, { ...f.options, now: NOW + 6 * HOUR })).result.cached, false);
  assert.equal(f.calls.length, 6);
});

test("file replacement, removal, appearance and mode changes invalidate cached identity", async (t) => {
  const f = await fixture(t);
  await getEnvironment(f.project, f.options);
  const replacement = join(f.bin, "replacement");
  await writeFile(replacement, "new fixture binary", { mode: 0o700 });
  await rename(replacement, f.executable("yt-dlp"));
  assert.equal((await getEnvironment(f.project, f.options)).result.cached, false);
  await rm(f.executable("ffmpeg"));
  const removed = await getEnvironment(f.project, f.options);
  assert.equal(removed.result.cached, false);
  assert.equal(removed.result.ready, false);
  assert.deepEqual(removed.result.dependencies.ffmpeg, { available: false, path: null, version: null, error: "not-found" });
  await writeFile(f.executable("ffmpeg"), "returned", { mode: 0o700 });
  assert.equal((await getEnvironment(f.project, f.options)).result.ready, true);
  if (supported) {
    await chmod(f.executable("ffmpeg"), 0o600);
    assert.equal((await getEnvironment(f.project, f.options)).result.dependencies.ffmpeg.available, false);
  }
});

test("actual execution environment is bound to the cache without persisting secrets", async (t) => {
  const f = await fixture(t);
  const env = { ...f.env, FIXTURE_SECRET: "do-not-persist-credential-value" };
  await getEnvironment(f.project, { ...f.options, env });
  const changed = await getEnvironment(f.project, { ...f.options, env: { ...env, LANG: "changed" } });
  assert.equal(changed.result.cached, false);
  assert.equal(f.calls.length, 4);
  const persisted = await readFile(join(f.cache, "local.json"), "utf8");
  assert.equal(persisted.includes(env.FIXTURE_SECRET), false);
  assert.equal(persisted.includes("FIXTURE_SECRET"), false);
});

test("PATH takes precedence over explicit managed bin and relative entries are ignored", async (t) => {
  const f = await fixture(t);
  const other = join(f.root, "other-bin");
  await mkdir(other, { mode: 0o700 });
  const second = join(other, "yt-dlp" + (supported ? "" : ".exe"));
  await writeFile(second, "second", { mode: 0o700 });
  assert.equal(await findRuntimeExecutable("yt-dlp", { env: f.env, binDirectory: other }), f.executable("yt-dlp"));
  assert.equal(await findRuntimeExecutable("yt-dlp", { env: { PATH: `relative${delimiter}${other}` } }), second);
  assert.equal(await findRuntimeExecutable("yt-dlp", { env: { PATH: "relative" }, binDirectory: other }), second);
  await assert.rejects(findRuntimeExecutable("../yt-dlp", { env: f.env }), { code: "INVALID_EXECUTABLE" });
});

test("switching PATH order or tool symlink target invalidates the runtime snapshot", { skip: !supported }, async (t) => {
  const f = await fixture(t);
  const other = join(f.root, "other");
  await mkdir(other, { mode: 0o700 });
  await writeFile(join(other, "yt-dlp"), "different", { mode: 0o700 });
  await getEnvironment(f.project, f.options);
  assert.equal((await getEnvironment(f.project, { ...f.options, env: { ...f.env, PATH: `${other}${delimiter}${f.bin}` } })).result.cached, false);
  await rm(f.executable("yt-dlp"));
  await symlink(join(other, "yt-dlp"), f.executable("yt-dlp"));
  const linked = await getEnvironment(f.project, f.options);
  assert.equal(linked.result.dependencies["yt-dlp"].path, join(other, "yt-dlp"));
});

test("corrupt, oversized and obsolete schema metadata is safely rebuilt", async (t) => {
  const f = await fixture(t);
  await getEnvironment(f.project, f.options);
  const path = join(f.cache, "local.json");
  for (const content of ["not-json", "x".repeat(20 * 1024), JSON.stringify({ ...await f.read(), schemaVersion: 999 })]) {
    await writeFile(path, content);
    assert.equal((await getEnvironment(f.project, f.options)).result.cached, false);
    assert.equal((await f.read()).schemaVersion, 1);
  }
  assert.equal(f.calls.length, 8);
});

test("cached executable paths and unsupported dependency fields are never trusted", async (t) => {
  const f = await fixture(t);
  await getEnvironment(f.project, f.options);
  const record = await f.read();
  record.dependencies["yt-dlp"].path = join(f.root, "malicious-program");
  record.node = { path: join(f.root, "malicious-node") };
  await writeFile(join(f.cache, "local.json"), JSON.stringify(record));
  const result = await getEnvironment(f.project, f.options);
  assert.equal(result.result.cached, false);
  assert.equal(result.result.node.path, process.execPath);
  assert.equal(result.result.dependencies["yt-dlp"].path, f.executable("yt-dlp"));
  assert.equal(f.calls.some((call) => call.path.includes("malicious")), false);
});

test("symlinked cache directories and linked cache files are rejected without touching targets", { skip: !supported }, async (t) => {
  const f = await fixture(t);
  const external = join(f.root, "external");
  await mkdir(external, { mode: 0o700 });
  const data = join(f.project, ".mimi-download-cli");
  await symlink(external, data);
  await assert.rejects(getEnvironment(f.project, f.options), { code: "UNSAFE_PATH" });
  await rm(data);
  await getEnvironment(f.project, f.options);
  const externalFile = join(external, "external.json");
  await writeFile(externalFile, "preserve this file", { mode: 0o600 });
  const local = join(f.cache, "local.json");
  await rm(local);
  await symlink(externalFile, local);
  await assert.rejects(getEnvironment(f.project, f.options), { code: "UNSAFE_CACHE" });
  assert.equal(await readFile(externalFile, "utf8"), "preserve this file");
  await rm(local);
  await link(externalFile, local);
  await assert.rejects(getEnvironment(f.project, f.options), { code: "UNSAFE_CACHE" });
  assert.equal(await readFile(externalFile, "utf8"), "preserve this file");
});

test("public cache directories and public records fail closed", { skip: !supported }, async (t) => {
  const f = await fixture(t);
  await getEnvironment(f.project, f.options);
  await chmod(f.cache, 0o755);
  await assert.rejects(getEnvironment(f.project, f.options), { code: "UNSAFE_PATH" });
  await chmod(f.cache, 0o700);
  await chmod(join(f.cache, "local.json"), 0o644);
  await assert.rejects(getEnvironment(f.project, f.options), { code: "UNSAFE_CACHE" });
});

test("concurrent writers leave one coherent private snapshot and do not remove each other's files", async (t) => {
  const f = await fixture(t);
  const probe = async (...args) => { await pause(30); return f.options.probe(...args); };
  const results = await Promise.all(Array.from({ length: 12 }, () => getEnvironment(f.project, { ...f.options, probe })));
  assert.equal(results.every((value) => value.result.ready), true);
  const calls = f.calls.length;
  assert.equal((await getEnvironment(f.project, f.options)).result.cached, true);
  assert.equal(f.calls.length, calls);
  assert.equal((await f.read()).format, "mimi-download.environment");
});

test("latest lookup uses one fixed official endpoint and an independent 24 hour TTL", async (t) => {
  const f = await fixture(t);
  const requests = [];
  const fetcher = async (url, options) => {
    assert.equal(url, "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest");
    assert.equal(options.redirect, "error");
    assert.equal(options.method, "GET");
    assert.ok(options.signal instanceof AbortSignal);
    requests.push(url);
    return new Response(JSON.stringify({ tag_name: "2026.10.14", draft: false, prerelease: false }));
  };
  const options = { ...f.options, includeLatest: true, fetcher };
  const first = await getEnvironment(f.project, options);
  assert.equal(first.result.latest.version, "2026.10.14");
  assert.equal(first.result.latest.cached, false);
  const second = await getEnvironment(f.project, { ...options, now: NOW + 7 * HOUR });
  assert.equal(second.result.cached, false);
  assert.equal(second.result.latest.cached, true);
  assert.equal(requests.length, 1);
  await getEnvironment(f.project, { ...options, now: NOW + 25 * HOUR });
  assert.equal(requests.length, 2);
  await getEnvironment(f.project, { ...options, now: NOW + 25 * HOUR, refresh: true });
  assert.equal(requests.length, 3);
});

test("latest network failure is cached and never downgrades local readiness", async (t) => {
  const f = await fixture(t);
  let requests = 0;
  const options = { ...f.options, includeLatest: true, fetcher: () => { requests++; throw new Error("provider token=do-not-save"); } };
  const result = await getEnvironment(f.project, options);
  assert.equal(result.result.ready, true);
  assert.equal(result.result.latest.version, null);
  assert.equal(result.result.latest.error, "latest-unavailable");
  assert.equal((await getEnvironment(f.project, options)).result.latest.cached, true);
  assert.equal(requests, 1);
  assert.equal((await readFile(join(f.cache, "latest.json"), "utf8")).includes("do-not-save"), false);
  const localOnly = await getEnvironment(f.project, { ...f.options, fetcher: networkDenied });
  assert.equal(localOnly.result.latest, undefined);
});

test("untrusted latest response data and oversized bodies are rejected", async (t) => {
  const f = await fixture(t);
  for (const data of [{ tag_name: "../../run-me" }, { tag_name: "2026.10.15", prerelease: true }, { tag_name: "2026.10.15", draft: true }]) {
    const result = await getEnvironment(f.project, { ...f.options, refresh: true, includeLatest: true,
      fetcher: async () => new Response(JSON.stringify(data)) });
    assert.equal(result.result.ready, true);
    assert.equal(result.result.latest.error, "latest-unavailable");
  }
  const result = await getEnvironment(f.project, { ...f.options, refresh: true, includeLatest: true,
    fetcher: async () => new Response("x".repeat(30 * 1024)) });
  assert.equal(result.result.latest.error, "latest-unavailable");
});

test("failed version probes return bounded generic errors without raw tool output", async (t) => {
  const f = await fixture(t);
  const result = await getEnvironment(f.project, { ...f.options, probe: async () => { throw new Error("secret-cookie-value"); } });
  assert.equal(result.result.ready, false);
  assert.equal(result.result.dependencies.ffmpeg.error, "probe-failed");
  assert.equal(JSON.stringify(result).includes("secret-cookie-value"), false);
  assert.equal(JSON.stringify(await f.read()).includes("secret-cookie-value"), false);
});

test("aborted and uncertain process probes never publish a local cache", async (t) => {
  const f = await fixture(t);
  for (const code of ["CANCELLED", "PROCESS_UNCONFIRMED"]) {
    await assert.rejects(getEnvironment(f.project, { ...f.options,
      probe: async () => { throw Object.assign(new Error("stopped"), { code }); } }), { code });
    assert.equal(await lstat(join(f.cache, "local.json")).catch(() => null), null);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(getEnvironment(f.project, { ...f.options, signal: controller.signal }), { code: "CANCELLED" });
});

test("default probe actually runs isolated executable fixtures and cache avoids subsequent launches", { skip: !supported }, async (t) => {
  const f = await fixture(t);
  const log = join(f.root, "version-calls");
  for (const name of ["yt-dlp", "ffmpeg"]) await withExecutable(f, name,
    `require('node:fs').appendFileSync(process.env.FIXTURE_LOG,${JSON.stringify(name + "\n")}); console.log(${JSON.stringify(name === "yt-dlp" ? "2026.10.15" : "ffmpeg version 8.0 fixture")});`);
  const options = { ...f.options, env: { ...f.env, FIXTURE_LOG: log }, probe: undefined };
  assert.equal((await getEnvironment(f.project, options)).result.ready, true);
  assert.equal((await getEnvironment(f.project, options)).result.cached, true);
  assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 2);
});

test("timeout waits for the owned version process to stop before recording the failure", { skip: !supported }, async (t) => {
  const f = await fixture(t);
  const stopped = join(f.root, "stopped");
  await withExecutable(f, "yt-dlp", `process.on('SIGTERM',()=>setTimeout(()=>{require('node:fs').writeFileSync(process.env.FIXTURE_STOPPED,'stopped');process.exit(0)},30));setInterval(()=>{},1000);`);
  await withExecutable(f, "ffmpeg", "console.log('ffmpeg version 8.0');");
  const result = await getEnvironment(f.project, { ...f.options, probe: undefined, probeTimeout: 2000,
    env: { ...f.env, FIXTURE_STOPPED: stopped } });
  assert.equal(result.result.ready, false);
  assert.equal(result.result.dependencies["yt-dlp"].error, "timeout");
  assert.equal(await readFile(stopped, "utf8"), "stopped");
});

test("cancellation waits for the owned version process and leaves no successful cache", { skip: !supported }, async (t) => {
  const f = await fixture(t);
  const started = join(f.root, "started"), stopped = join(f.root, "stopped");
  await withExecutable(f, "yt-dlp", `require('node:fs').writeFileSync(process.env.FIXTURE_STARTED,'started');process.on('SIGTERM',()=>setTimeout(()=>{require('node:fs').writeFileSync(process.env.FIXTURE_STOPPED,'stopped');process.exit(0)},30));setInterval(()=>{},1000);`);
  const controller = new AbortController();
  const result = getEnvironment(f.project, { ...f.options, probe: undefined, signal: controller.signal,
    env: { ...f.env, FIXTURE_STARTED: started, FIXTURE_STOPPED: stopped } });
  const rejection = assert.rejects(result, { code: "CANCELLED" });
  await until(started);
  controller.abort();
  await rejection;
  assert.equal(await readFile(stopped, "utf8"), "stopped");
  assert.equal(await lstat(join(f.cache, "local.json")).catch(() => null), null);
});

test("native stdin entry uses actual cwd project and emits the shared envelope", { skip: !supported }, async (t) => {
  const f = await fixture(t);
  await withExecutable(f, "yt-dlp", "console.log('2026.10.15');");
  await withExecutable(f, "ffmpeg", "console.log('ffmpeg version 8.0');");
  const result = await new Promise((done, reject) => {
    const child = spawn(process.execPath, [entry], { cwd: f.project, env: f.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => { try { assert.equal(code, 0, stderr + stdout); done(JSON.parse(stdout)); } catch (error) { reject(error); } });
    child.stdin.end(JSON.stringify({ action: "get" }));
  });
  assert.equal(result.format, "mimi-download.environment");
  assert.equal(result.result.ready, true);
  assert.equal((await f.read()).format, result.format);
});

test("request contract rejects paths, handles, unsupported actions and invalid flags", async (t) => {
  const f = await fixture(t);
  for (const input of [null, [], {}, { action: "install" }, { action: "get", path: "/private" },
    { action: "get", includeLatest: "yes" }, { action: "get", entry: "opaque-handle" }])
    await assert.rejects(main(input, { project: f.project, ...f.options }), { code: "INVALID_ARGUMENT" });
  assert.equal((await main({ action: "get" }, { project: f.project, ...f.options })).result.ready, true);
  assert.equal((await main({ action: "refresh" }, { project: f.project, ...f.options })).result.cached, false);
});
