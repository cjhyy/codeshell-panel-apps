// Opt-in real model acceptance. Uses only the pinned public JFK fixture, never user audio.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const options = new Map();
const names = ["--server", "--model", "--fixture", "--output"];
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index],
    value = process.argv[index + 1];
  if (!names.includes(key) || !value || value.startsWith("--") || options.has(key))
    throw new Error(
      `Usage: node scripts/verify-job-hunt-whisper.mjs ${names.map((name) => `${name} PATH`).join(" ")}`,
    );
  options.set(key, resolve(value));
}
if (options.size !== names.length) throw new Error(`Required: ${names.join(", ")}`);
const entry = fileURLToPath(
  new URL("../apps/job-hunt-hq/app/tools/interview-transcribe.mjs", import.meta.url),
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const modelHash = hash(await readFile(options.get("--model")));
const fixtureHash = hash(await readFile(options.get("--fixture")));
assert.equal(
  modelHash,
  "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
  "Use the documented tiny.en model",
);
assert.equal(
  fixtureHash,
  "59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e",
  "Use the public JFK fixture; this acceptance must not send personal audio",
);
const root = options.get("--output");
await mkdir(dirname(root), { recursive: true });
await mkdir(root); // Refuse to reuse or overwrite an earlier acceptance directory.

async function run(command, args, input) {
  const child = spawn(command, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  let out = "",
    err = "";
  child.stdout.on("data", (value) => {
    out += value;
  });
  child.stderr.on("data", (value) => {
    err += value;
  });
  child.stdin.on("error", () => {}); // Exit/error below owns early child failure.
  child.stdin.end(input);
  const timeout = setTimeout(() => child.kill("SIGKILL"), 150000);
  try {
    const [code, signal] = await once(child, "exit");
    assert.equal(code, 0, `${command} failed (${signal ?? code}): ${out}\n${err}`);
    return out;
  } finally {
    clearTimeout(timeout);
  }
}
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((done) => socket.close(done));
const log = createWriteStream(join(root, "provider.log"));
const server = spawn(
  options.get("--server"),
  [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--inference-path",
    "/v1/audio/transcriptions",
    "--model",
    options.get("--model"),
    "--convert",
    "--no-gpu",
    "--threads",
    "4",
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
let spawnError;
server.on("error", (error) => {
  spawnError = error;
});
const stopped = new Promise((done) => server.once("close", done));
async function stop() {
  if (server.exitCode === null && server.signalCode === null && !spawnError) server.kill("SIGTERM");
  const timeout = setTimeout(() => server.kill("SIGKILL"), 5000);
  try {
    await stopped;
  } finally {
    clearTimeout(timeout);
  }
}
const connection = {
  id: "acceptance-local-whisper",
  catalogId: "local-whisper-cpp",
  model: "tiny.en",
  baseUrl: `http://127.0.0.1:${port}/v1`,
  tag: "audio",
  entry: { tag: "audio" },
  adapterKind: "openai",
  hasCredentials: true,
  apiKey: "",
};
const selection = {
  id: connection.id,
  fingerprint: hash(
    JSON.stringify([connection.id, connection.catalogId, connection.model, connection.baseUrl]),
  ).slice(0, 32),
};
const connectionsFile = join(root, "connection.json");
const results = [];
const invoke = async (input, directory) =>
  JSON.parse(
    (
      await run(
        process.execPath,
        [entry, "--job-dir", directory, "--connections-file", connectionsFile],
        JSON.stringify(input),
      )
    ).trim(),
  );
try {
  await writeFile(connectionsFile, JSON.stringify({ connections: [connection] }), { mode: 0o600 });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error("Model server exited; inspect provider.log");
    try {
      ready = (
        await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
      ).ok;
    } catch {}
    if (ready) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.ok(ready, "The real model server must become ready");
  const webm = join(root, "fixture.webm");
  await run("ffmpeg", [
    "-nostdin",
    "-y",
    "-i",
    options.get("--fixture"),
    "-c:a",
    "libopus",
    "-b:a",
    "48k",
    webm,
  ]);
  for (const [format, file, mimeType] of [
    ["wav", options.get("--fixture"), "audio/wav"],
    ["webm", webm, "audio/webm"],
  ]) {
    const bytes = await readFile(file),
      directory = join(root, `job-${format}`);
    await mkdir(join(directory, "inputs"), { recursive: true });
    await copyFile(file, join(directory, "inputs/recording.bin"));
    const input = {
      action: "interview-transcribe",
      assetId: `asset-${hash(bytes)}`,
      mimeType,
      language: "en",
      connection: selection,
      source: {
        questionId: "public-jfk-fixture",
        practiceSessionId: "real-model-acceptance",
        answerHash: hash(""),
      },
    };
    const started = Date.now(),
      result = await invoke(input, directory);
    assert.equal(result.type, "result");
    assert.match(result.result.text.toLowerCase(), /ask not/);
    assert.match(result.result.text.toLowerCase(), /country/);
    assert.equal(result.result.assetId, input.assetId);
    assert.deepEqual(result.result.source, input.source);
    assert.deepEqual(result.result.connection, selection);
    results.push({
      format,
      bytes: bytes.length,
      input,
      directory,
      result,
      elapsedMs: Date.now() - started,
    });
  }
  await stop();
  for (const item of results) {
    assert.deepEqual(
      await invoke(item.input, item.directory),
      item.result,
      "Saved result must reopen with provider offline",
    );
    assert.equal(
      hash(await readFile(join(item.directory, "inputs/recording.bin"))),
      item.input.assetId.slice(6),
    );
  }
  const evidence = {
    format: "codeshell.real-interview-provider-acceptance.v1",
    verifiedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    provider: {
      repository: "https://github.com/ggml-org/whisper.cpp",
      model: "tiny.en",
      modelSha256: modelHash,
      serverSha256: hash(await readFile(options.get("--server"))),
      cpuOnly: true,
    },
    panelEntrySha256: hash(await readFile(entry)),
    fixtureSha256: fixtureHash,
    results: results.map(({ format, bytes, result, elapsedMs }) => ({
      format,
      bytes,
      text: result.result.text,
      elapsedMs,
    })),
    cachedResultsRecoveredWithProviderStopped: true,
    originalAudioPreserved: true,
    limits:
      "Native CLI and local HTTP provider only; no Host grant, cloud UI, Chinese accuracy, physical microphone or target deployment acceptance.",
  };
  await writeFile(join(root, "acceptance.json"), JSON.stringify(evidence, null, 2));
  console.log(
    `PASS: actual WAV/WebM inference, selected connection, offline result recovery and original-byte preservation. Evidence: ${join(root, "acceptance.json")}`,
  );
} finally {
  await stop();
  await new Promise((done) => log.end(done));
}
