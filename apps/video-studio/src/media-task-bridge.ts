import type { PanelBridge } from "./host";
import type { MediaJob } from "./production";
import { createPanelRuntime, taskValue, runtimeCancelled } from "./sdk/panel-runtime";
import { isExternalMedia, isResourceId } from "./external-media";
import { canonicalRenderMediaJob, isCanonicalRenderTask } from "./editor/render-media-job";

type Recipe = { id: string; action: string; type: string };
type State = { cwd: string; key: string; revision: number; recipes: Recipe[] };
const JOURNAL = "video-studio-native-media-v1";
const REQUIRED = [
  "tasks.start",
  "tasks.get",
  "tasks.list",
  "tasks.cancel",
  "tasks.retry",
  "resources.get",
  "resources.read",
];
const direct: Record<string, string> = {
  "media.transcribe": "transcribe",
  "media.audio.extract": "audio-extract",
  "media.audio.enhance": "audio-enhance",
  "media.scene": "scene",
  "media.render": "render",
};
const MEDIA_ACTIONS = new Set([
  "status",
  "voices",
  "import",
  "inspect",
  "prepare",
  "proxy",
  "thumbnail",
  "waveform",
  "silence",
  "scenes",
  "transcribe",
  "render",
  "tts",
  "tts-clone",
  "tts-setup",
  "audio-extract",
  "audio-enhance",
  "scene",
]);
function ownedTask(job: any) {
  return (
    isCanonicalRenderTask(job) ||
    (job?.entry?.name === "media-runtime" && MEDIA_ACTIONS.has(taskRequest(job)?.action))
  );
}
const clone = (value: any) => structuredClone(value);
function taskRequest(job: any) {
  return job.input?.request ?? job.input?.input?.request;
}
function assetId(value: unknown): string {
  if (!isResourceId(value)) throw new Error("请选择当前工程中的有效素材");
  return value;
}
function arrayResult(value: any): any[] {
  return Array.isArray(value) ? value : (value?.jobs ?? value?.tasks ?? []);
}

/** Panel-owned media workflows over domain-neutral durable tasks and immutable resources. */
export function createMediaTaskBridge(raw: PanelBridge): { bridge: PanelBridge; dispose(): void } {
  const sdk = createPanelRuntime(raw),
    listeners = new Set<(value: any) => void>();
  let disposed = false,
    state: State | undefined,
    pendingState: Promise<State> | undefined;
  let statusCache: { at: number; value: any } | undefined,
    voicesCache: { at: number; value: any } | undefined;
  let statusPending: Promise<any> | undefined, voicesPending: Promise<any> | undefined;
  let writes = Promise.resolve();
  let analysisCache: { scopeKey: string; assetId: string; value: Promise<any> } | undefined;
  const processed = new Set<string>(),
    preparation = new Map<string, any>(),
    documentWrites = new Map<string, Promise<unknown>>();
  async function current() {
    if (disposed) throw runtimeCancelled();
    const context = await raw.getContext(),
      cwd = context.cwd;
    if (typeof cwd !== "string" || !cwd) throw new Error("请先将视频面板绑定到当前工程");
    if (state?.cwd === cwd) return state;
    pendingState ??= (async () => {
      const key = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cwd))),
      )
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      const stored = (await sdk.call("media.document.get", { key: JOURNAL })) as any;
      if (disposed || (await raw.getContext()).cwd !== cwd) throw runtimeCancelled();
      const recipes =
        stored.data?.schemaVersion === 1 && Array.isArray(stored.data.recipes)
          ? stored.data.recipes
              .filter(
                (r: any) =>
                  r &&
                  typeof r.id === "string" &&
                  typeof r.action === "string" &&
                  typeof r.type === "string",
              )
              .slice(-500)
          : [];
      state = { cwd, key, revision: stored.revision, recipes };
      preparation.clear();
      processed.clear();
      return state;
    })().finally(() => {
      pendingState = undefined;
    });
    return pendingState;
  }
  async function same(scope: State) {
    if (disposed || (await raw.getContext()).cwd !== scope.cwd) throw runtimeCancelled();
  }
  async function remember(scope: State, recipe: Recipe) {
    const work = writes
      .catch(() => {})
      .then(async () => {
        await same(scope);
        const recipes = [...scope.recipes.filter((r) => r.id !== recipe.id), recipe].slice(-500);
        const saved = (await sdk.call("media.document.set", {
          key: JOURNAL,
          baseRevision: scope.revision,
          data: { schemaVersion: 1, recipes },
          label: "本地媒体任务",
        })) as any;
        await same(scope);
        scope.revision = saved.revision;
        scope.recipes = recipes;
      });
    writes = work;
    await work;
  }
  async function updatePreparation(scope: State, id: string, patch: any) {
    const key = `video-studio-prepared-${assetId(id)}`;
    const work = (documentWrites.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await same(scope);
        const old = (await sdk.call("media.document.get", { key })) as any;
        const value = { ...(old.data ?? {}), ...patch, assetId: id, preparedAt: Date.now() };
        await sdk.call("media.document.set", {
          key,
          baseRevision: old.revision,
          data: value,
          label: "素材处理结果",
        });
        await same(scope);
        preparation.set(id, value);
      });
    documentWrites.set(key, work);
    await work;
  }
  async function prepared(id: string) {
    const scope = await current();
    assetId(id);
    if (preparation.has(id)) return preparation.get(id);
    const saved = (await sdk.call("media.document.get", {
      key: `video-studio-prepared-${id}`,
    })) as any;
    await same(scope);
    preparation.set(id, saved.data ?? null);
    return saved.data;
  }
  function mediaType(action: string, params: any) {
    if (action === "tts" || action === "tts-clone")
      return params.modelId === "audio8-tts" || params.modelId === "qwen3-tts"
        ? "tts-clone"
        : params.modelId === "edge-tts" || params.modelId === "kokoro"
          ? "tts-managed"
          : params.modelId && params.modelId !== "macos-say"
            ? "tts-online"
            : "tts";
    return action;
  }
  async function normalize(jobValue: any, scope: State, save = true): Promise<MediaJob> {
    const job = taskValue(jobValue);
    if (!ownedTask(job)) throw new Error("此任务不属于视频面板的媒体处理或成片导出");
    if (isCanonicalRenderTask(job)) return canonicalRenderMediaJob(job);
    const request = taskRequest(job),
      remembered = scope.recipes.find((r) => r.id === job.id);
    const action = remembered?.action ?? request?.action,
      type = remembered?.type ?? mediaType(action ?? "media", request?.params ?? {});
    const result = job.result?.result ?? job.result;
    if (
      save &&
      job.status === "succeeded" &&
      result &&
      !processed.has(`${job.id}:${job.attempt}`)
    ) {
      if (action === "prepare") await updatePreparation(scope, result.assetId, result);
      else if (action === "inspect")
        await updatePreparation(scope, result.assetId, { inspection: result.inspection });
      else if (action === "transcribe")
        await updatePreparation(scope, result.assetId, { transcription: result });
      else if (action === "silence" || action === "scenes" || action === "waveform")
        await updatePreparation(scope, result.assetId, { [action]: result });
      else if (result.asset?.id && result.inspection)
        await updatePreparation(scope, result.asset.id, { inspection: result.inspection });
      processed.add(`${job.id}:${job.attempt}`);
      if (action === "tts-setup") {
        voicesCache = undefined;
        statusCache = undefined;
      }
    }
    return { ...job, type, ...(result === undefined ? {} : { result }) } as MediaJob;
  }
  async function publicConnections() {
    const capabilities = await sdk.discover();
    return capabilities.availableMethods?.includes("credentials.connections.list")
      ? sdk.call("credentials.connections.list", {})
      : { connections: [], defaults: {} };
  }
  async function start(action: string, params: any = {}, hidden = false) {
    await sdk.requireMethods(REQUIRED);
    const scope = await current(),
      ids = new Set<string>();
    if (params.assetId !== undefined) ids.add(assetId(params.assetId));
    if (params.referenceAssetId !== undefined) ids.add(assetId(params.referenceAssetId));
    if (action === "render") {
      for (const clip of [...(params.project?.clips ?? []), ...(params.project?.audioClips ?? [])])
        ids.add(assetId(params.sources?.[clip.assetId] ?? clip.assetId));
    }
    const resources = [...ids].map((id, i) => ({ assetId: id, path: `inputs/source-${i}.bin` }));
    const inputs = Object.fromEntries(resources.map((r) => [r.assetId, r.path]));
    const request: any = {
      action,
      params,
      inputs,
      scopeKey: scope.key,
      jobId: `media-${crypto.randomUUID()}`,
    };
    const connectionIds: string[] = [];
    if (action === "status" || action === "voices")
      request.publicConnections = await publicConnections();
    else if (action === "tts" && String(params.modelId).startsWith("speech-")) {
      const configs = (await publicConnections()) as any;
      for (const c of configs.connections ?? []) {
        const hash =
          typeof c.fingerprint === "string" && /^[a-f0-9]{32}$/.test(c.fingerprint)
            ? c.fingerprint
            : Array.from(
                new Uint8Array(
                  await crypto.subtle.digest(
                    "SHA-256",
                    new TextEncoder().encode(
                      JSON.stringify([c.id, c.catalogId, c.model, c.baseUrl]),
                    ),
                  ),
                ),
              )
                .map((v) => v.toString(16).padStart(2, "0"))
                .join("")
                .slice(0, 32);
        if (`speech-${hash}` === params.modelId) connectionIds.push(c.id);
      }
      if (connectionIds.length !== 1) throw new Error("配音连接已变化，请刷新模型列表后重新选择");
    }
    await same(scope);
    const job = await sdk.start({
      entry: "media-runtime",
      input: {
        request,
        resources,
        directoryArguments: [
          { argumentName: "--job-dir", directory: "job" },
          { argumentName: "--runtime-dir", directory: "app-data", path: "runtime/media" },
        ],
        ...(connectionIds.length
          ? { connectionIds, connectionArgument: "--connections-file" }
          : {}),
      },
      recovery: connectionIds.length ? "manual" : "retry",
    });
    const recipe = { id: job.id, action, type: hidden ? "internal" : mediaType(action, params) };
    try {
      await remember(scope, recipe);
    } catch (error) {
      throw new Error(`任务已创建（${job.id}），但任务记录保存失败；请在任务列表查看后重试保存`, {
        cause: error,
      });
    }
    return normalize(job, scope, false);
  }
  async function completed(action: string, params: any = {}) {
    const job = await start(action, params, true),
      scope = await current();
    const done = await sdk.wait(job.id);
    await same(scope);
    if (done.status !== "succeeded") throw new Error(done.error?.message ?? "本地媒体检查未完成");
    return (await normalize(done, scope)).result;
  }
  async function catalog() {
    if (voicesCache && Date.now() - voicesCache.at < 30000) return clone(voicesCache.value);
    voicesPending ??= completed("voices")
      .then((value) => {
        voicesCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        voicesPending = undefined;
      });
    return clone(await voicesPending);
  }
  async function readJson(id: string) {
    const scope = await current();
    if (analysisCache?.scopeKey !== scope.key || analysisCache.assetId !== id) {
      const cached = { scopeKey: scope.key, assetId: id, value: loadJson(id) };
      analysisCache = cached;
      cached.value.catch(() => {
        if (analysisCache === cached) analysisCache = undefined;
      });
    }
    const value = await analysisCache.value;
    await same(scope);
    return value;
  }
  async function loadJson(id: string) {
    let offset = 0,
      total = 0;
    const pieces: Uint8Array[] = [];
    do {
      const part = (await sdk.call("resources.read", {
        assetId: assetId(id),
        offset,
        length: 32768,
      })) as any;
      if (
        part.assetId !== id ||
        part.offset !== offset ||
        typeof part.dataBase64 !== "string" ||
        typeof part.eof !== "boolean" ||
        !Number.isSafeInteger(part.totalBytes) ||
        part.totalBytes < 1 ||
        part.totalBytes > 32 * 1024 * 1024 ||
        (total && total !== part.totalBytes)
      )
        throw new Error("媒体分析文件读取不完整");
      total = part.totalBytes;
      const bytes = Uint8Array.from(atob(part.dataBase64), (c) => c.charCodeAt(0));
      if (
        !bytes.length ||
        bytes.length > 32768 ||
        offset + bytes.length > total ||
        part.eof !== (offset + bytes.length === total)
      )
        throw new Error("媒体分析文件读取不完整");
      pieces.push(bytes);
      offset += bytes.length;
    } while (offset < total);
    const data = new Uint8Array(total);
    let at = 0;
    for (const bytes of pieces) {
      data.set(bytes, at);
      at += bytes.length;
    }
    return JSON.parse(new TextDecoder().decode(data));
  }
  async function analysis(params: any, transcript: boolean) {
    const state = await prepared(assetId(params.assetId));
    const value = transcript ? state?.transcription : state?.[params.kind];
    const artifact = transcript ? value?.transcript : value?.analysis;
    if (!value) throw new Error("请先准备这条素材的真实分析或转写");
    const data = artifact?.asset?.id ? await readJson(artifact.asset.id) : value;
    const field = transcript ? "segments" : params.kind === "silence" ? "intervals" : "cuts",
      rows = data[field];
    if (!Array.isArray(rows)) throw new Error("没有可用的真实分析结果，请重新准备素材");
    const offset = params.offset ?? 0,
      limit = params.limit ?? (transcript ? 50 : 100);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("分析分页参数无效");
    const page: any[] = [];
    let bytes = 1024;
    for (const row of rows.slice(offset, offset + limit)) {
      const size = new TextEncoder().encode(JSON.stringify(row)).length;
      if (bytes + size > 192 * 1024) break;
      page.push(clone(row));
      bytes += size;
    }
    return {
      assetId: params.assetId,
      ...(transcript
        ? {
            engine: data.engine,
            language: data.language,
            // Analysis artifacts are immutable, content-addressed resources. A legacy
            // inline transcript receives the same stable content stamp on every page.
            revision:
              artifact?.asset?.id ??
              Array.from(
                new Uint8Array(
                  await crypto.subtle.digest(
                    "SHA-256",
                    new TextEncoder().encode(JSON.stringify(data)),
                  ),
                ),
                (byte) => byte.toString(16).padStart(2, "0"),
              ).join(""),
          }
        : { kind: params.kind, detector: data.detector }),
      total: rows.length,
      offset,
      nextOffset: offset + page.length,
      [field]: page,
    };
  }
  let events = Promise.resolve();
  const eventSequences = new Map<string, number>();
  function receiveTask(value: any) {
    const incoming = value?.job ?? value;
    if (disposed || typeof incoming?.id !== "string") return;
    events = events
      .catch(() => {})
      .then(async () => {
        const scope = await current();
        if (incoming.scope?.projectPath && incoming.scope.projectPath !== scope.cwd) return;
        const sequence = Number(incoming.sequence) || 0;
        if (sequence && sequence <= (eventSequences.get(incoming.id) ?? -1)) return;
        const known = scope.recipes.find((recipe) => recipe.id === incoming.id);
        if (known?.type === "internal") return;
        const terminal = !["queued", "running", "cancelling"].includes(incoming.status);
        const complete = await sdk.call("tasks.get", { id: incoming.id });
        if (!ownedTask(complete)) return;
        const request = taskRequest(complete);
        if (!known && (!request || ["status", "voices", "inspect"].includes(request.action)))
          return;
        const job = await normalize(complete, scope, terminal);
        await same(scope);
        if (sequence) eventSequences.set(incoming.id, sequence);
        listeners.forEach((listener) => listener(job));
      })
      .catch(() => {
        /* Durable polling retains failures without publishing partial results. */
      });
  }
  const unsubscribes = [
    raw.on("tasks.changed", receiveTask),
    raw.on("media.job.changed", (value) => {
      if (!disposed) listeners.forEach((listener) => listener(value));
    }),
    raw.on("context.changed", () => {
      state = undefined;
      statusCache = undefined;
      voicesCache = undefined;
      preparation.clear();
      eventSequences.clear();
      analysisCache = undefined;
      void sdk.discover(true).catch(() => {});
    }),
  ];
  const bridge: PanelBridge = {
    getContext: () => raw.getContext(),
    registerTool: (name, handler) => raw.registerTool(name, handler),
    on(event, listener) {
      if (event !== "media.job.changed") return raw.on(event, listener);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async call(method, rawParams) {
      const params = (rawParams ?? {}) as any;
      if (method === "media.status") {
        await sdk.requireMethods(REQUIRED);
        if (statusCache && Date.now() - statusCache.at < 30000) return clone(statusCache.value);
        statusPending ??= completed("status")
          .then((value) => {
            statusCache = { at: Date.now(), value };
            return value;
          })
          .finally(() => {
            statusPending = undefined;
          });
        return clone(await statusPending);
      }
      if (method === "media.tts.voices") return catalog();
      if (method === "media.tts.providers")
        return { providers: ((await catalog()) as any).models.filter((m: any) => m.installable) };
      if (method === "media.tts.setup") return start("tts-setup", params);
      if (method === "media.tts") {
        const modelId = params.modelId ?? ((await catalog()) as any).defaultModelId;
        return start(modelId === "audio8-tts" || modelId === "qwen3-tts" ? "tts-clone" : "tts", {
          ...params,
          modelId,
        });
      }
      if (direct[method]) return start(direct[method]!, params);
      if (method === "media.prepare") {
        if (
          !Array.isArray(params.assetIds) ||
          !params.assetIds.length ||
          params.assetIds.length > 100
        )
          throw new Error("请选择 1–100 条素材");
        const jobs = [];
        for (const id of params.assetIds)
          jobs.push(
            await start("prepare", {
              assetId: assetId(id),
              transcribe: params.transcribe === true,
            }),
          );
        return { jobs };
      }
      if (method === "media.assets.list") return sdk.call("resources.list", params);
      if (method === "media.assets.read") return sdk.call("resources.read", params);
      if (method === "media.assets.get") {
        const fetched = (await sdk.call("resources.get", { id: assetId(params.id) })) as any;
        let preparation = await prepared(params.id);
        if (!preparation?.inspection && !isExternalMedia(params.id)) {
          const inspected = await completed("inspect", { assetId: params.id });
          preparation = {
            ...(preparation ?? {}),
            inspection: (inspected as any).inspection,
            assetId: params.id,
          };
        }
        return { asset: fetched.asset, preparation };
      }
      if (method === "media.recording.finish") {
        const result = (await sdk.call(method, params)) as any;
        if (!result.inspection && result.asset?.id)
          result.inspection = (
            (await completed("inspect", { assetId: result.asset.id })) as any
          ).inspection;
        return result;
      }
      if (method === "media.transcript") return analysis(params, true);
      if (method === "media.analysis") {
        if (!["silence", "scenes"].includes(params.kind))
          throw new Error("请选择有效的素材分析类型");
        return analysis(params, false);
      }
      if (method === "media.jobs.list") {
        const scope = await current(),
          incoming = arrayResult(
            await sdk.call("tasks.list", {
              offset: params.offset ?? 0,
              limit: Math.min(50, params.limit ?? 50),
            }),
          );
        const jobs: MediaJob[] = [];
        for (let job of incoming) {
          const known = scope.recipes.find((r) => r.id === job.id);
          if (known?.type === "internal") continue;
          job = await sdk.call("tasks.get", { id: job.id });
          if (!ownedTask(job)) continue;
          const request = taskRequest(job);
          if (!known && (!request || ["status", "voices", "inspect"].includes(request.action)))
            continue;
          jobs.push(await normalize(job, scope, false));
        }
        const legacy = (await sdk
          .call("media.jobs.list", params)
          .catch(() => ({ jobs: [] }))) as any;
        jobs.push(...(legacy.jobs ?? []));
        return {
          total: jobs.length,
          jobs: jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, params.limit ?? 50),
        };
      }
      if (["media.jobs.get", "media.jobs.cancel", "media.jobs.retry"].includes(method)) {
        const scope = await current();
        let native: any;
        try {
          native = await sdk.call("tasks.get", { id: params.id });
        } catch {
          if (method !== "media.jobs.retry") return sdk.call(method, params);
          const recipe = (await sdk.call("media.jobs.recipe", { id: params.id })) as any;
          if (
            !recipe ||
            typeof recipe.type !== "string" ||
            !recipe.params ||
            recipe.type === "import"
          )
            throw new Error("此旧任务需要重新选择素材后创建");
          const action =
            recipe.type === "tts-managed" || recipe.type === "tts-online" ? "tts" : recipe.type;
          const input = { ...recipe.params };
          if (recipe.type === "tts-managed") {
            input.modelId = input.providerId;
            delete input.providerId;
          }
          return start(action, input);
        }
        if (!ownedTask(native)) throw new Error("此任务不属于视频面板的媒体处理或成片导出");
        await same(scope);
        if (method === "media.jobs.cancel") native = await sdk.cancel(params.id);
        if (method === "media.jobs.retry") {
          if (native.recovery === "manual" || native.error?.retryable === false)
            throw new Error("此任务需要先检查已有结果，再重新创建，不能自动重试");
          native = await sdk.retry(params.id);
        }
        if (!taskRequest(native) || !(native as any).entry)
          native = await sdk.call("tasks.get", { id: params.id });
        await same(scope);
        return normalize(native, scope);
      }
      return sdk.call(method, params);
    },
  };
  return {
    bridge,
    dispose() {
      disposed = true;
      analysisCache = undefined;
      sdk.dispose();
      unsubscribes.forEach((fn) => fn());
      listeners.clear();
    },
  };
}
