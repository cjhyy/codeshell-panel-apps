// Panel-owned speech workflow. The Host supplies only the selected sealed connection
// and the authorized immutable resource; credentials never enter task input or output.
import { createHash } from "node:crypto";
import { open, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_AUDIO = 16 * 1024 * 1024;
const MAX_RESPONSE = 64 * 1024;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const failure = (message) => new Error(message);
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
function bounded(value, max, empty = false) {
  return (
    typeof value === "string" &&
    (empty || value.trim()) &&
    value.length <= max &&
    !/[\r\n\0]/.test(value)
  );
}
export function validateTranscriptionRequest(input) {
  if (
    !object(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          "action",
          "assetId",
          "mimeType",
          "language",
          "connection",
          "source",
          "jobId",
          "scopeKey",
        ].includes(key),
    ) ||
    input.action !== "interview-transcribe" ||
    typeof input.assetId !== "string" ||
    !/^asset-[a-f0-9]{64}$/.test(input.assetId) ||
    !["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"].includes(input.mimeType) ||
    !/^[a-z]{2,3}$/.test(input.language) ||
    !object(input.connection) ||
    Object.keys(input.connection).some((key) => !["id", "fingerprint"].includes(key)) ||
    !bounded(input.connection.id, 200) ||
    !/^[a-f0-9]{32}$/.test(input.connection.fingerprint) ||
    !object(input.source) ||
    Object.keys(input.source).some(
      (key) => !["questionId", "practiceSessionId", "answerHash"].includes(key),
    ) ||
    !bounded(input.source.questionId, 100) ||
    !bounded(input.source.practiceSessionId, 100, true) ||
    !/^[a-f0-9]{64}$/.test(input.source.answerHash)
  )
    throw failure("语音转写请求无效，请重新选择录音与题目。");
  return {
    action: input.action,
    assetId: input.assetId,
    mimeType: input.mimeType,
    language: input.language,
    connection: { ...input.connection },
    source: { ...input.source },
  };
}
function selectedConnection(value, selection) {
  if (!object(value) || !Array.isArray(value.connections) || value.connections.length !== 1)
    throw failure("请明确选择一个语音转写连接。");
  const connection = value.connections[0];
  if (
    !object(connection) ||
    connection.id !== selection.id ||
    connection.tag !== "audio" ||
    connection.entry?.tag !== "audio" ||
    connection.adapterKind !== "openai" ||
    !bounded(connection.model, 200) ||
    connection.hasCredentials !== true ||
    !bounded(connection.apiKey, 8192, true) ||
    typeof connection.catalogId !== "string" ||
    typeof connection.baseUrl !== "string" ||
    digest(
      JSON.stringify([connection.id, connection.catalogId, connection.model, connection.baseUrl]),
    ).slice(0, 32) !== selection.fingerprint
  )
    throw failure("语音连接已变化或不支持此转写方式，请刷新连接后重新提交。");
  let url;
  try {
    url = new URL(connection.baseUrl);
  } catch {
    throw failure("语音连接地址无效。");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw failure("语音连接须使用 HTTPS；本机服务可使用回环 HTTP。");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/audio/transcriptions`;
  return { url, key: connection.apiKey, model: connection.model };
}
async function immutable(path, bytes) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}
function audioMatches(bytes, mimeType) {
  return mimeType === "audio/webm"
    ? bytes.subarray(0, 4).toString("hex") === "1a45dfa3"
    : mimeType === "audio/ogg"
      ? bytes.subarray(0, 4).toString() === "OggS"
      : mimeType === "audio/mp4"
        ? bytes.subarray(4, 8).toString() === "ftyp"
        : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE";
}
async function responseJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw failure("转写服务没有返回文字，录音仍保留。");
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > MAX_RESPONSE) throw failure("转写结果超过大小限制，录音仍保留。");
      chunks.push(part.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw failure("转写服务返回了无法读取的结果，录音仍保留。");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export async function transcribeInterview(
  input,
  { audioPath, connections, directory, signal, fetchImpl = fetch } = {},
) {
  const request = validateTranscriptionRequest(input);
  const { url, key, model } = selectedConnection(connections, request.connection);
  const root = await realpath(directory);
  const file = await realpath(audioPath);
  const info = await stat(file);
  if (!info.isFile() || info.size < 12 || info.size > MAX_AUDIO)
    throw failure("录音大小无效或超过 16 MiB，原文件仍保留。");
  const bytes = await readFile(file);
  if (`asset-${digest(bytes)}` !== request.assetId || !audioMatches(bytes, request.mimeType))
    throw failure("录音内容与项目回执不匹配，请重新选择原始文件。");
  const requestHash = digest(JSON.stringify(request));
  const resultPath = join(root, "interview-transcript.json");
  const receipt = (value) => {
    if (
      value?.requestHash !== requestHash ||
      value?.format !== "codeshell.interview-transcript.v1" ||
      typeof value.text !== "string" ||
      !value.text.trim() ||
      value.text.length > 6000
    )
      throw failure("已保存的转写回执不匹配，请保留任务并检查原结果。");
    return {
      text: value.text,
      assetId: request.assetId,
      source: request.source,
      connection: request.connection,
      language: request.language,
    };
  };
  try {
    return receipt(JSON.parse(await readFile(resultPath, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (signal?.aborted) throw failure("转写已取消，录音仍保留。");
  // A crash, timeout or lost response is not proof the provider did nothing.
  // Re-entering this task must never repeat a possibly charged network call.
  try {
    await immutable(
      join(root, "interview-transcription-requested.json"),
      JSON.stringify({ requestHash }),
    );
  } catch (error) {
    if (error.code === "EEXIST")
      throw failure("此前转写可能已发送，未自动重复请求。请检查任务结果；确认后可新建转写。");
    throw failure("无法记录转写请求，未发送录音，请检查项目存储。");
  }
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120000)]);
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: request.mimeType }),
    `recording.${request.mimeType.split("/")[1]}`,
  );
  form.append("model", model);
  form.append("response_format", "json");
  form.append("language", request.language);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      body: form,
      redirect: "error",
      signal: deadline,
    });
  } catch {
    throw failure(
      deadline.aborted
        ? "转写已取消或超时，未自动重试；录音仍保留。"
        : "转写连接失败，未自动重试；请检查已有结果，录音仍保留。",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw failure(
      `语音转写服务返回 ${response.status}，未自动重试；请检查连接和额度，录音仍保留。`,
    );
  }
  let payload;
  try {
    payload = await responseJson(response);
  } catch (error) {
    if (deadline.aborted) throw failure("转写已取消或超时，未自动重试；录音仍保留。");
    throw failure(
      error.message.startsWith("转写")
        ? error.message
        : "转写结果读取失败，未自动重试；录音仍保留。",
    );
  }
  if (deadline.aborted) throw failure("转写已取消或超时，未自动重试；录音仍保留。");
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text || text.length > 6000)
    throw failure("转写没有清晰文字或超过 6000 字，请保留录音后检查。");
  const value = { format: "codeshell.interview-transcript.v1", requestHash, text };
  try {
    await immutable(resultPath, JSON.stringify(value));
  } catch {
    throw failure("转写已返回但结果写入失败，未自动重复请求，请检查项目存储。");
  }
  return receipt(value);
}
async function main() {
  const controller = new AbortController();
  for (const name of ["SIGINT", "SIGTERM"]) process.once(name, () => controller.abort());
  const argument = (name) => {
    const index = process.argv.indexOf(name);
    if (index < 0 || !process.argv[index + 1]) throw failure("转写任务缺少授权文件或目录。");
    return process.argv[index + 1];
  };
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 16384) throw failure("转写任务输入过大。");
      chunks.push(chunk);
    }
    let connections;
    try {
      connections = JSON.parse(await readFile(argument("--connections-file"), "utf8"));
    } catch {
      throw failure("无法读取所选语音连接，请重新确认授权。");
    }
    const result = await transcribeInterview(JSON.parse(Buffer.concat(chunks).toString()), {
      audioPath: join(argument("--job-dir"), "inputs/recording.bin"),
      directory: argument("--job-dir"),
      connections,
      signal: controller.signal,
    });
    process.stdout.write(JSON.stringify({ type: "result", result }) + "\n");
  } catch (error) {
    // Filesystem/provider details may contain private paths or credentials.
    const message =
      typeof error?.message === "string" &&
      /^(语音|转写|录音|已保存|此前|无法记录|无法读取所选)/.test(error.message)
        ? error.message
        : "语音转写失败，原始录音仍保留，请检查任务与连接。";
    process.stdout.write(JSON.stringify({ type: "error", message }) + "\n");
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
