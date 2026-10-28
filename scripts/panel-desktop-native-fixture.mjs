// Private Desktop acceptance runtime only. Never used by an installed Panel.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, get } from "node:http";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
const digest = value => createHash("sha256").update(value).digest("hex");
const profile = "(version 1) (allow default) (deny network*)";

export function requireNativeNetworkBoundary(platform = process.platform) {
  assert.equal(platform, "darwin", "Desktop NativeEntry fixture requires macOS sandbox-exec deny(network*); no enforceable boundary is configured for this platform");
}

function run(command, args, env, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", failure;
    const timer = setTimeout(() => {
      failure = new Error(`Owned NativeEntry self-test timed out: ${command}`);
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.once("error", error => { failure = error; });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else resolve({ code, signal, stdout, stderr, pid: child.pid, exited: true });
    });
  });
}

/** The wrapper contains absolute paths, so Host safeProcessEnv need not inherit any guard variable. */
export async function preparePanelDesktopNativeFixture({ directory, binDirectory, nodeExecutable, environment }) {
  requireNativeNetworkBoundary();
  assert.ok(isAbsolute(nodeExecutable), "NativeEntry fixture requires an absolute, independently verified Node executable");
  const realNode = await realpath(nodeExecutable);
  const nodeSha256 = digest(await readFile(realNode));
  const runtime = join(directory, "native-fixture");
  await mkdir(runtime, { mode: 0o700 });
  await mkdir(binDirectory, { recursive: true, mode: 0o700 });
  const receiptFile = join(runtime, "executions.jsonl");
  const traceFile = join(runtime, "trace.mjs");
  const policyFile = join(runtime, "network.sb");
  await writeFile(policyFile, profile + "\n", { mode: 0o600 });
  // Observe without attaching a stdin data listener, which would consume input
  // before the real entry starts its async iterator. No request content is saved.
  await writeFile(traceFile, `import children from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
const log = value => appendFileSync(${JSON.stringify(receiptFile)}, JSON.stringify({ at: Date.now(), pid: process.pid, ppid: process.ppid, ...value }) + "\\n", { mode: 0o600 });
const entry = process.argv[1];
const entrySha256 = entry ? createHash("sha256").update(readFileSync(entry)).digest("hex") : null;
log({ event: "entry-start", entry, entrySha256, nodeOptionsPresent: process.env.NODE_OPTIONS !== undefined });
process.once("exit", code => log({ event: "entry-exit", entry, code }));
const emit = process.stdin.emit;
let input = "";
process.stdin.emit = function (event, ...args) {
  if (event === "data" && input.length < 32768) input += String(args[0]);
  if (event === "end") {
    try { const value = JSON.parse(input); log({ event: "entry-request", entry, action: value.action, includeLatest: value.includeLatest }); }
    catch { log({ event: "entry-request", entry, json: false }); }
  }
  return emit.call(this, event, ...args);
};
const spawn = children.spawn;
children.spawn = function (command, args, options) {
  const child = spawn.call(this, command, args, options);
  log({ event: "child-start", childPid: child.pid, command, args });
  child.once("close", (code, signal) => log({ event: "child-exit", childPid: child.pid, command, code, signal }));
  return child;
};
syncBuiltinESMExports();
`, { mode: 0o600 });
  const wrapper = join(binDirectory, "node");
  await writeFile(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${shellQuote(policyFile)} ${shellQuote(realNode)} --import ${shellQuote(pathToFileURL(traceFile).href)} "$@"\n`, { mode: 0o700 });
  for (const [name, version] of Object.entries({ "yt-dlp": "2026.10.12", ffmpeg: "ffmpeg version 8.0-fixture" }))
    await writeFile(join(binDirectory, name), `#!/bin/sh\ncase "$*" in *--version*|*-version*) echo ${shellQuote(version)}; exit 0;; esac\necho 'Desktop acceptance denies native media/provider work' >&2\nexit 77\n`, { mode: 0o700 });
  for (const name of ["curl", "wget"])
    await writeFile(join(binDirectory, name), "#!/bin/sh\necho 'Desktop acceptance denies live native network clients' >&2\nexit 77\n", { mode: 0o700 });

  // A live loopback listener provides a positive control. EPERM (rather than a
  // missing network route, DNS failure or closed port) proves kernel denial.
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.end("positive-control"); });
  const selfTestFile = join(runtime, "self-test.mjs");
  const selfTestEnv = Object.fromEntries(["HOME", "TMPDIR", "PATH", "LANG"].flatMap(key => environment[key] === undefined ? [] : [[key, environment[key]]]));
  let selfTest;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = server.address().port;
    await new Promise((resolve, reject) => get(`http://127.0.0.1:${port}`, response => { response.resume(); response.once("end", resolve); }).once("error", reject));
    assert.equal(requests, 1);
    const probes = `import assert from "node:assert/strict";
import net from "node:net";
const netCode = await new Promise(resolve => {
  const socket = net.connect({ host: "127.0.0.1", port: ${port} });
  socket.setTimeout(1500, () => { socket.destroy(); resolve("TIMEOUT"); });
  socket.once("connect", () => { socket.destroy(); resolve("CONNECTED"); });
  socket.once("error", error => resolve(error.code));
});
let fetchCode;
try { await fetch("http://127.0.0.1:${port}", { signal: AbortSignal.timeout(1500) }); fetchCode = "CONNECTED"; }
catch (error) { fetchCode = error.cause?.code || error.code || error.name; }
assert.equal(netCode, "EPERM"); assert.equal(fetchCode, "EPERM");
`;
    await writeFile(selfTestFile, `${probes}
import { spawnSync } from "node:child_process";
const descendant = spawnSync(${JSON.stringify(realNode)}, ["--input-type=module", "-e", ${JSON.stringify(probes + 'console.log(JSON.stringify({netCode,fetchCode,nodeOptionsPresent:process.env.NODE_OPTIONS !== undefined}));')}], { env: {}, encoding: "utf8", timeout: 4000 });
assert.equal(descendant.status, 0, descendant.stderr);
const curl = spawnSync("/usr/bin/curl", ["--noproxy", "*", "--verbose", "--connect-timeout", "2", "http://127.0.0.1:${port}"], { env: {}, encoding: "utf8", timeout: 4000 });
assert.notEqual(curl.status, 0); assert.match(curl.stderr, /Operation not permitted/i);
console.log(JSON.stringify({ netCode, fetchCode, nodeOptionsPresent: process.env.NODE_OPTIONS !== undefined, descendant: JSON.parse(descendant.stdout), nativeChild: { code: curl.status, signal: curl.signal, denied: /Operation not permitted/i.test(curl.stderr), stderr: curl.stderr } }));
`, { mode: 0o600 });
    const execution = await run(wrapper, [selfTestFile], selfTestEnv);
    assert.equal(execution.code, 0, `NativeEntry OS network boundary failed self-test: ${execution.stderr}`);
    const receipt = JSON.parse(execution.stdout);
    assert.equal(receipt.nodeOptionsPresent, false);
    assert.equal(receipt.descendant.nodeOptionsPresent, false);
    assert.equal(requests, 1, "sandboxed probes reached the positive-control HTTP server");
    selfTest = { ...receipt, pid: execution.pid, exited: execution.exited, positiveControlRequests: requests };
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  return {
    wrapper, receiptFile, selfTest,
    boundary: { kind: "macos-sandbox-exec", policy: profile, realNode, nodeSha256,
      fixtureModuleSha256: digest(await readFile(new URL(import.meta.url))),
      traceSha256: digest(await readFile(traceFile)), selfTestScriptSha256: digest(await readFile(selfTestFile)),
      wrapperSha256: digest(await readFile(wrapper)), descendants: "kernel-inherited deny(network*)" },
    async receipts() {
      return (await readFile(receiptFile, "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw error; })).trim().split("\n").filter(Boolean).map(JSON.parse);
    },
  };
}

/** Keep the full structured refusal; no inference that every execution is startup work. */
export async function waitForPanelDesktopIdle({ id, operation, onBusy = () => {}, nativeReceipts = async () => [], timeoutMs = 30_000, pollMs = 100 }) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    const result = await operation();
    if (result.ok || !/还有正在提交、排队或运行的任务/.test(result.error)) return result;
    const observation = { id, at: Date.now(), attempt: ++attempt, result: structuredClone(result), nativeReceipts: await nativeReceipts() };
    await onBusy(observation);
    if (Date.now() >= deadline)
      throw new Error(`${id} Panel change remained BUSY: ${JSON.stringify(observation)}`);
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
