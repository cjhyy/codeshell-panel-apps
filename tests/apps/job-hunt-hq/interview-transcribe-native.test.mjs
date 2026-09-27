import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { transcribeInterview } from "../../../apps/job-hunt-hq/app/tools/interview-transcribe.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function fixture(t, handler) {
  const root = await mkdtemp(join(tmpdir(), "interview-stt-"));
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    requests.push({
      url: req.url,
      authorization: req.headers.authorization,
      body: Buffer.concat(chunks).toString(),
    });
    await handler?.(req, res, requests);
    if (!handler)
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ text: "这是我的实际练习回答。" }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  });
  const connection = {
    id: "selected-audio",
    catalogId: "openai-transcribe",
    tag: "audio",
    entry: { tag: "audio" },
    adapterKind: "openai",
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    model: "fixture-transcribe",
    apiKey: "synthetic-private-key",
    hasCredentials: true,
  };
  const bytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100, 11)]);
  const audioPath = join(root, "recording.webm");
  await writeFile(audioPath, bytes);
  const directory = join(root, "job");
  await mkdir(directory);
  const request = {
    action: "interview-transcribe",
    assetId: `asset-${hash(bytes)}`,
    mimeType: "audio/webm",
    language: "zh",
    connection: {
      id: connection.id,
      fingerprint: hash(
        JSON.stringify([connection.id, connection.catalogId, connection.model, connection.baseUrl]),
      ).slice(0, 32),
    },
    source: {
      questionId: "question-1",
      practiceSessionId: "session-1",
      answerHash: hash("已有键盘回答"),
    },
  };
  const options = { audioPath, directory, connections: { connections: [connection] } };
  return { root, requests, request, options, connection };
}

test("selected audio connection receives multipart bytes; durable result survives re-entry without another paid call", async (t) => {
  const f = await fixture(t);
  const result = await transcribeInterview(f.request, f.options);
  assert.equal(result.text, "这是我的实际练习回答。");
  assert.deepEqual(result.source, f.request.source);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "/v1/audio/transcriptions");
  assert.equal(f.requests[0].authorization, "Bearer synthetic-private-key");
  assert.match(f.requests[0].body, /name="model"\r\n\r\nfixture-transcribe/);
  assert.match(f.requests[0].body, /name="language"\r\n\r\nzh/);
  assert.doesNotMatch(f.requests[0].body, /question-1|已有键盘回答/);
  assert.equal(JSON.stringify(result).includes(f.connection.apiKey), false);
  assert.deepEqual(await transcribeInterview(f.request, f.options), result);
  assert.equal(f.requests.length, 1);
  assert.equal(
    (await readFile(join(f.options.directory, "interview-transcript.json"), "utf8")).includes(
      f.connection.apiKey,
    ),
    false,
  );
});

test("provider failure hides response secrets and a later task re-entry does not repeat the request", async (t) => {
  const f = await fixture(t, (_req, res) =>
    res.writeHead(401).end("synthetic-private-key /private/config secret"),
  );
  await assert.rejects(
    transcribeInterview(f.request, f.options),
    (error) => /401/.test(error.message) && !/private|secret/.test(error.message),
  );
  await assert.rejects(transcribeInterview(f.request, f.options), /此前转写可能已发送/);
  assert.equal(f.requests.length, 1);
});

test("abort during actual HTTP preserves the original and refuses automatic network replay", async (t) => {
  const f = await fixture(t, () => {});
  const abort = new AbortController();
  const pending = transcribeInterview(f.request, { ...f.options, signal: abort.signal });
  while (!f.requests.length) await new Promise((done) => setTimeout(done, 5));
  abort.abort();
  await assert.rejects(pending, /取消或超时/);
  assert.equal(`asset-${hash(await readFile(f.options.audioPath))}`, f.request.assetId);
  await assert.rejects(transcribeInterview(f.request, f.options), /未自动重复请求/);
  assert.equal(f.requests.length, 1);
});

test("changed connection, wrong source hash and unsupported media stop before sending audio", async (t) => {
  const f = await fixture(t);
  for (const request of [
    { ...f.request, assetId: `asset-${"0".repeat(64)}` },
    { ...f.request, mimeType: "audio/wav" },
    { ...f.request, connection: { ...f.request.connection, fingerprint: "0".repeat(32) } },
    { ...f.request, source: { ...f.request.source, path: "/private" } },
  ])
    await assert.rejects(transcribeInterview(request, f.options));
  assert.equal(f.requests.length, 0);
  await transcribeInterview(f.request, f.options);
  assert.equal(f.requests.length, 1);
});

test("redirects and oversized responses are refused without leaking provider details", async (t) => {
  let redirected = false;
  const f = await fixture(t, (_req, res) => {
    if (!redirected) res.writeHead(302, { Location: "http://127.0.0.1:9/private" }).end();
    else res.writeHead(200).end("x".repeat(70 * 1024));
  });
  await assert.rejects(transcribeInterview(f.request, f.options), /连接失败/);
  redirected = true;
  const directory = join(f.root, "explicit-new-task");
  await mkdir(directory);
  await assert.rejects(transcribeInterview(f.request, { ...f.options, directory }), /超过大小限制/);
  assert.equal(f.requests.length, 2);
});

test("native CLI returns bounded task output with source identity and no selected credentials", async (t) => {
  const f = await fixture(t);
  const config = join(f.root, "connections.json");
  await writeFile(config, JSON.stringify(f.options.connections));
  await mkdir(join(f.options.directory, "inputs"));
  await writeFile(
    join(f.options.directory, "inputs/recording.bin"),
    await readFile(f.options.audioPath),
  );
  const child = spawn(
    process.execPath,
    [
      "apps/job-hunt-hq/app/tools/interview-transcribe.mjs",
      "--connections-file",
      config,
      "--job-dir",
      f.options.directory,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "",
    errors = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (errors += chunk));
  const ended = new Promise((done, reject) => {
    child.on("error", reject);
    child.on("close", done);
  });
  child.stdin.end(JSON.stringify(f.request));
  assert.equal(await ended, 0, errors);
  const value = JSON.parse(output);
  assert.equal(value.type, "result");
  assert.equal(value.result.source.questionId, "question-1");
  assert.equal((output + errors).includes(f.connection.apiKey), false);
});

test("a Host-approved local connection without a key omits the authorization header", async (t) => {
  const f = await fixture(t);
  f.connection.apiKey = "";
  await transcribeInterview(f.request, f.options);
  assert.equal(f.requests[0].authorization, undefined);
});
