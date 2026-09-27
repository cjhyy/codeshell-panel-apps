const ENTRY = "interview-transcribe";
const methods = [
  "resources.recordAudio",
  "resources.list",
  "resources.get",
  "resources.open",
  "tasks.start",
  "tasks.find",
  "tasks.get",
  "tasks.list",
  "tasks.cancel",
  "credentials.connections.list",
];
export const supportsInterviewAudioTasks = (context) =>
  methods.every((method) => context?.availableMethods?.includes(method));
export async function audioAnswerHash(answer) {
  if (!globalThis.crypto?.subtle) throw new Error("项目录音转写需要 HTTPS 安全连接。");
  const value = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(answer)));
  return [...new Uint8Array(value)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function audioConnections(value) {
  if (!Array.isArray(value?.connections)) throw new Error("语音连接列表无效，请刷新。");
  return value.connections
    .filter(
      (c) =>
        c?.tag === "audio" &&
        c.entry?.tag === "audio" &&
        c.adapterKind === "openai" &&
        c.hasCredentials === true &&
        typeof c.id === "string" &&
        c.id.length <= 200 &&
        typeof c.model === "string" &&
        c.model &&
        c.model.length <= 200 &&
        /^[a-f0-9]{32}$/.test(c.fingerprint),
    )
    .map((c) => ({
      id: c.id,
      fingerprint: c.fingerprint,
      model: c.model,
      name: String(c.providerName || c.entry.displayName || c.id).slice(0, 200),
    }));
}
export function audioResource(value) {
  if (
    !value ||
    typeof value.id !== "string" ||
    !/^asset-[a-f0-9]{64}$/.test(value.id) ||
    !["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"].includes(value.mimeType) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 12 ||
    value.bytes > 16 * 1024 * 1024 ||
    typeof value.name !== "string"
  )
    throw new Error("请选择 16 MiB 以内的项目录音文件。");
  return { id: value.id, name: value.name, mimeType: value.mimeType, bytes: value.bytes };
}
export async function prepareInterviewAudio({
  asset,
  connection,
  questionId,
  practiceSessionId = "",
  answer = "",
  language = "zh",
  nonce = "",
}) {
  asset = audioResource(asset);
  if (
    typeof questionId !== "string" ||
    !questionId ||
    questionId.length > 100 ||
    typeof practiceSessionId !== "string" ||
    practiceSessionId.length > 100 ||
    typeof answer !== "string" ||
    answer.length > 6000 ||
    !/^[a-z]{2,3}$/.test(language) ||
    !connection ||
    typeof connection.id !== "string" ||
    !connection.id ||
    connection.id.length > 200 ||
    !/^[a-f0-9]{32}$/.test(connection.fingerprint) ||
    typeof nonce !== "string" ||
    nonce.length > 100
  )
    throw new Error("请打开一道练习题并选择语音转写连接。");
  const request = {
    action: ENTRY,
    assetId: asset.id,
    mimeType: asset.mimeType,
    language,
    connection: { id: connection.id, fingerprint: connection.fingerprint },
    source: { questionId, practiceSessionId, answerHash: await audioAnswerHash(answer) },
  };
  return {
    entry: ENTRY,
    recovery: "manual",
    requestKey: `interview-audio:${await audioAnswerHash(JSON.stringify([request, nonce]))}`,
    input: {
      request,
      resources: [{ assetId: asset.id, path: "inputs/recording.bin" }],
      directoryArguments: [{ argumentName: "--job-dir", directory: "job" }],
      connectionIds: [connection.id],
      connectionArgument: "--connections-file",
    },
  };
}
function own(job, prepared) {
  const request = job?.input?.request;
  if (
    !job ||
    job.entry?.name !== ENTRY ||
    request?.action !== ENTRY ||
    !request.source?.questionId ||
    !/^asset-[a-f0-9]{64}$/.test(request.assetId) ||
    (prepared && JSON.stringify(request) !== JSON.stringify(prepared.input.request))
  )
    throw new Error("转写任务与原录音或题目不匹配。");
  return job;
}
export function interviewTranscript(job) {
  own(job);
  if (job.status !== "succeeded") return null;
  const result = job.result?.result ?? job.result;
  if (
    !result ||
    result.assetId !== job.input.request.assetId ||
    JSON.stringify(result.source) !== JSON.stringify(job.input.request.source) ||
    JSON.stringify(result.connection) !== JSON.stringify(job.input.request.connection) ||
    typeof result.text !== "string" ||
    !result.text.trim() ||
    result.text.length > 6000
  )
    throw new Error("转写结果回执不完整，请保留原录音并刷新任务。");
  return result;
}
export function createInterviewAudioTasks({ call, check = () => {} }) {
  const pending = new Map(),
    cache = new Map();
  const invoke = async (method, args) => {
    check();
    const value = await call(method, args);
    check();
    return value;
  };
  async function get(id) {
    const job = own(await invoke("tasks.get", { id }));
    cache.set(id, job);
    return job;
  }
  return {
    get,
    async connections() {
      return audioConnections(await invoke("credentials.connections.list", {}));
    },
    async record() {
      const result = await invoke("resources.recordAudio", {
        maxDurationSeconds: 120,
        maxBytes: 16 * 1024 * 1024,
      });
      return result?.cancelled ? null : audioResource(result?.asset);
    },
    async resources(offset = 0) {
      const page = await invoke("resources.list", { offset, limit: 50 });
      if (!Array.isArray(page?.assets) || !Number.isSafeInteger(page.total) || page.total < 0)
        throw new Error("项目录音列表无法读取，请刷新。");
      return {
        assets: page.assets
          .filter(
            (a) =>
              ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"].includes(a?.mimeType) &&
              a.bytes <= 16 * 1024 * 1024,
          )
          .map(audioResource),
        nextOffset: offset + page.assets.length < page.total ? offset + page.assets.length : null,
      };
    },
    async open(assetId) {
      return invoke("resources.open", { assetId });
    },
    submit(prepared) {
      if (
        prepared?.entry !== ENTRY ||
        prepared.recovery !== "manual" ||
        !/^interview-audio:[a-f0-9]{64}$/.test(prepared.requestKey)
      )
        return Promise.reject(new Error("转写请求无效。"));
      if (pending.has(prepared.requestKey)) return pending.get(prepared.requestKey);
      const input = structuredClone(prepared);
      const operation = (async () => {
        const existing = await invoke("tasks.find", { requestKey: input.requestKey });
        if (existing) return own(existing, input);
        const resource = audioResource(
          (await invoke("resources.get", { id: input.input.request.assetId }))?.asset,
        );
        if (resource.mimeType !== input.input.request.mimeType)
          throw new Error("原始录音类型已变化，请刷新。");
        try {
          return own(await invoke("tasks.start", input), input);
        } catch (error) {
          check();
          const accepted = await invoke("tasks.find", { requestKey: input.requestKey }).catch(
            () => null,
          );
          check();
          if (accepted) return own(accepted, input);
          throw error;
        }
      })();
      pending.set(input.requestKey, operation);
      void operation.finally(() => pending.delete(input.requestKey)).catch(() => {});
      return operation;
    },
    async list(offset = 0) {
      const page = await invoke("tasks.list", { offset, limit: 20 });
      if (!Array.isArray(page)) throw new Error("转写任务列表无法读取。");
      const jobs = [];
      for (const summary of page) {
        if (summary.entry?.name !== ENTRY) continue;
        const stored = cache.get(summary.id);
        jobs.push(
          stored && stored.sequence === summary.sequence && stored.status === summary.status
            ? own({ ...stored, ...summary })
            : await get(summary.id),
        );
      }
      return { jobs, nextOffset: page.length === 20 ? offset + 20 : null };
    },
    async cancel(id) {
      const job = await get(id);
      if (!["queued", "running", "cancelling"].includes(job.status)) return job;
      await invoke("tasks.cancel", { id });
      return get(id);
    },
  };
}
