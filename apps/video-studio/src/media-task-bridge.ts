import { randomId } from "./ids.js";
import type { PanelBridge } from "./host";
import type { MediaJob } from "./production";
import { createPanelRuntime, taskValue, runtimeCancelled } from "./sdk/panel-runtime";
import { isExternalMedia, isResourceId } from "./external-media";
import { canonicalRenderMediaJob, isCanonicalRenderTask } from "./editor/render-media-job";

type Recipe = { id: string; action: string; type: string };
type State = { cwd: string; key: string; revision: number; recipes: Recipe[] };
const JOURNAL = "video-studio-native-media-v1";
function journalRecipes(stored: any): Recipe[] {
  const invalid = () => {
    throw new Error("媒体任务记录格式不兼容或已损坏，原记录已保留；请检查项目备份后重新打开面板");
  };
  if (
    !stored ||
    !Number.isSafeInteger(stored.revision) ||
    stored.revision < 0 ||
    !Object.hasOwn(stored, "data") ||
    (stored.revision === 0) !== (stored.data === null)
  )
    invalid();
  if (stored.data === null) return [];
  const data = stored.data;
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    data.schemaVersion !== 1 ||
    Object.keys(data).some((key) => !["schemaVersion", "recipes"].includes(key)) ||
    !Array.isArray(data.recipes) ||
    data.recipes.length > 500
  )
    invalid();
  const ids = new Set<string>();
  return data.recipes.map((recipe: any) => {
    if (
      !recipe ||
      typeof recipe !== "object" ||
      Array.isArray(recipe) ||
      Object.keys(recipe).some((key) => !["id", "action", "type"].includes(key)) ||
      ["id", "action", "type"].some(
        (key) => typeof recipe[key] !== "string" || !recipe[key].trim() || recipe[key].length > 256,
      ) ||
      ids.has(recipe.id)
    )
      invalid();
    ids.add(recipe.id);
    return { id: recipe.id, action: recipe.action, type: recipe.type };
  });
}
const REQUIRED = [
  "tasks.start",
  "tasks.find",
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
// Setup mutates an installed runtime; its old success is not proof that the
// model still exists. Other ordinary actions publish immutable media/analysis
// results, which remain reusable. Library/CLI operations use separate protocols.
const REPEATABLE_MAINTENANCE = new Set(["tts-setup"]);
const MAX_PENDING_LOCAL_RECOVERIES = 2;
const clone = (value: any) => structuredClone(value);
// JSON values only; stable object ordering makes equivalent UI requests share
// one Host receipt across windows and reloads. Array order remains semantic.
export function canonicalMediaRequest(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalMediaRequest(item ?? null)).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalMediaRequest(value[key])}`).join(",")}}`;
}
async function mediaRequestHash(value: any) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(canonicalMediaRequest(JSON.parse(JSON.stringify(value)))))))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
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
export function createMediaTaskBridge(raw: PanelBridge, options: {
  confirmRecovery?(message: string): Promise<boolean>;
} = {}): { bridge: PanelBridge; dispose(): void } {
  const sdk = createPanelRuntime(raw),
    listeners = new Set<(value: any) => void>();
  let disposed = false,
    state: State | undefined,
    pendingState: Promise<State> | undefined;
  let statusCache: { at: number; value: any } | undefined,
    voicesCache: { at: number; value: any } | undefined;
  let statusPending: Promise<any> | undefined, voicesPending: Promise<any> | undefined;
  let statusPendingFresh = false;
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
      const recipes = journalRecipes(stored);
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
    return { ...job, type,
      reviewRequired: ["failed", "cancelled"].includes(job.status) && (job.recovery === "manual" || job.error?.retryable === false),
      ...(result === undefined ? {} : { result }) } as MediaJob;
  }
  async function publicConnections() {
    const capabilities = await sdk.discover();
    return capabilities.availableMethods?.includes("credentials.connections.list")
      ? sdk.call("credentials.connections.list", {})
      : { connections: [], defaults: {} };
  }
  async function start(action: string, params: any = {}, hidden = false) {
    // Freeze caller-owned objects before the first asynchronous boundary. The
    // exact canonical wire input, not just the intent key, must survive recovery.
    params = JSON.parse(canonicalMediaRequest(params));
    await sdk.requireMethods(REQUIRED);
    const scope = await current(),
      ids = new Set<string>();
    if (params.assetId !== undefined) ids.add(assetId(params.assetId));
    if (params.referenceAssetId !== undefined) ids.add(assetId(params.referenceAssetId));
    if (action === "render") {
      for (const clip of [...(params.project?.clips ?? []), ...(params.project?.audioClips ?? [])])
        ids.add(assetId(params.sources?.[clip.assetId] ?? clip.assetId));
    }
    const resources = [...ids].sort().map((id, i) => ({ assetId: id, path: `inputs/source-${i}.bin` }));
    const inputs = Object.fromEntries(resources.map((r) => [r.assetId, r.path]));
    const request: any = {
      action,
      params,
      inputs,
      scopeKey: scope.key,
      ...(hidden ? { jobId: `media-${randomId()}` } : {}),
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
    const hash = await mediaRequestHash({ action, request, resources, connectionIds });
    const executionRevision = String((await raw.getContext()).capabilities?.tasks?.executionRevision ?? "legacy-unknown");
    const revisionHash = (await mediaRequestHash(executionRevision)).slice(0, 16);
    const intentKey = `media-intent-${hash}`, recovery = connectionIds.length ? "manual" : "retry";
    let intent: any, intentRevision = 0;
    let requestKey = `media-probe:${hash}`;
    const pendingUnknown = () => new Error("原媒体请求可能仍在提交，也可能未受理或回执已被清理，未重复发起。未知付费请求、旧格式或跨版本请求无法安全重发；可查询原任务和已有结果，等待不会自动解除该限制。");
    const wireInput = (attempt: number) => JSON.parse(canonicalMediaRequest({
      entry: "media-runtime", recovery,
      input: { request: { ...request, jobId: request.jobId ?? `media-${hash}-${attempt}` }, resources,
        directoryArguments: [
          { argumentName: "--job-dir", directory: "job" },
          { argumentName: "--runtime-dir", directory: "app-data", path: "runtime/media" },
        ],
        ...(connectionIds.length ? { connectionIds, connectionArgument: "--connections-file" } : {}),
      },
    }));
    async function sameExecution() {
      const context = await raw.getContext();
      if (disposed || context.cwd !== scope.cwd) throw runtimeCancelled();
      if (String(context.capabilities?.tasks?.executionRevision ?? "legacy-unknown") !== executionRevision)
        throw new Error("面板执行版本已改变，原媒体请求未重新提交");
    }
    const intentCall = (method: string, params: unknown) =>
      sdk.call(method, params, undefined, sameExecution);
    async function adoptPrepared(value: any, revision: number) {
      if (value?.phase !== "pending" || value.executionRevision !== executionRevision || executionRevision === "legacy-unknown" ||
          value.submission !== "ready" || value.wireDigest !== await mediaRequestHash(wireInput(value.attempt))) throw pendingUnknown();
      intent = value; intentRevision = revision; requestKey = value.requestKey;
    }
    const unknown = () => new Error("上次媒体请求回执尚未确认，未重复发起，不能自动重试。请检查任务列表及远端结果后恢复；重新打开后仍会先查询原请求。");
    async function findIntent(value: any) {
      let found = await sdk.call("tasks.find", { requestKey: value.requestKey });
      // find is revision-scoped, but get can read a retained old-revision receipt.
      if (!found && value.jobId) found = await sdk.call("tasks.get", { id: value.jobId }).catch(() => null);
      await same(scope);
      if (found && (found as any).requestKey !== value.requestKey)
        throw new Error("媒体回执与原请求不匹配，已保留意图，未重复执行");
      return found;
    }
    async function confirm(message: string, declined = unknown()) {
      if (!await options.confirmRecovery?.(message)) throw declined;
      await same(scope);
    }
    if (!hidden) {
      // A single CAS record retains the latest attempt. Never delete an intent:
      // unknown/manual outcomes require the user to inspect results explicitly.
      for (let collision = 0; collision < 3; collision++) {
        const saved = await intentCall("media.document.get", { key: intentKey }) as any;
        await same(scope);
        const old = saved.data;
        if (old !== null) {
          const valid = old.recovery === recovery && (old.schemaVersion === 1
            ? old.requestKey === `media-v1:${hash}` && Object.keys(old).every(key => ["schemaVersion", "requestKey", "recovery"].includes(key))
            : old.schemaVersion === 2 && Number.isSafeInteger(old.attempt) && old.attempt > 0 && old.attempt < Number.MAX_SAFE_INTEGER &&
              typeof old.executionRevision === "string" && old.executionRevision.length > 0 && old.executionRevision.length <= 1024 &&
              ["pending", "accepted", "rejected"].includes(old.phase) &&
              (old.submission === undefined || ["ready", "sent"].includes(old.submission)) &&
              (old.wireDigest === undefined || typeof old.wireDigest === "string" && /^[a-f0-9]{64}$/.test(old.wireDigest)) &&
              (old.localRecoveries === undefined || Number.isSafeInteger(old.localRecoveries) && old.localRecoveries >= 0 && old.localRecoveries <= MAX_PENDING_LOCAL_RECOVERIES) &&
              (old.dispatchToken === undefined || typeof old.dispatchToken === "string" && old.dispatchToken.length <= 128) &&
              (old.createdAt === undefined || Number.isSafeInteger(old.createdAt) && old.createdAt >= 0) &&
              (old.jobId === undefined || typeof old.jobId === "string") &&
              old.requestKey === `media-v2:${(await mediaRequestHash(old.executionRevision)).slice(0, 16)}:${hash}:${old.attempt}`);
          if (!valid) throw new Error("媒体任务意图记录无效，已保留原记录；请检查后再操作");
        }
        const existing: any = old ? await findIntent(old) : await sdk.call("tasks.find", { requestKey: `media-v1:${hash}` });
        await same(scope);
        if (existing && !["failed", "cancelled", "interrupted"].includes(existing.status)) {
          // A pending intent with a newly found receipt is acknowledgement recovery,
          // including a setup that finished while its start response was lost.
          // Recover this operation before offering a distinct maintenance attempt.
          if (old?.phase === "pending") {
            await intentCall("media.document.set", { key: intentKey, baseRevision: saved.revision,
              data: { ...old, phase: "accepted", jobId: existing.id }, label: "媒体任务回执" }).catch(() => {});
            await same(scope);
            return normalize(existing, scope, false);
          }
          if (existing.status !== "succeeded" || !REPEATABLE_MAINTENANCE.has(action))
            return normalize(existing, scope, false);
          await confirm("上次配音引擎安装已成功。本次将重新检查、修复并验证引擎，可能重新下载模型。确认再次运行吗？",
            new Error("已保留原安装回执，未再次运行"));
        }
        else if (existing && (recovery === "manual" || existing.error?.retryable === false))
          await confirm("原媒体任务已经结束。请先检查已有结果及远端计费；确认要创建一个新的处理请求吗？这可能再次计费。");
        else if (old && !existing && old.phase !== "rejected") {
          if (old.phase === "pending" || old.schemaVersion === 1) {
            if (old.executionRevision !== executionRevision || executionRevision === "legacy-unknown" ||
                old.wireDigest !== await mediaRequestHash(wireInput(old.attempt))) throw pendingUnknown();
            if (old.submission === "ready") {
              await adoptPrepared(old, saved.revision);
              break;
            }
            // Host can evict any terminal receipt at maxJobs, with no minimum
            // retention time. A missing receipt is NEVER safe paid retry proof.
            // Explicit local retry is bounded and may run again after eviction;
            // retained/preparing work still uses the identical Host key+digest.
            if (old.submission !== "sent" || recovery !== "retry" ||
                (old.localRecoveries ?? 0) >= MAX_PENDING_LOCAL_RECOVERIES) throw pendingUnknown();
            await confirm("原本地任务的回执未找到：可能未受理，也可能已完成并清理记录。将使用原请求重新提交；若记录已清理，本地工作可能再次运行。本请求不含付费连接，最多允许两次这样的恢复。确认恢复吗？", pendingUnknown());
            const ready = { ...old, submission: "ready", localRecoveries: (old.localRecoveries ?? 0) + 1 };
            try {
              const recovered = await intentCall("media.document.set", { key: intentKey, baseRevision: saved.revision,
                data: ready, label: "恢复原本地媒体请求" }) as any;
              await adoptPrepared(ready, recovered.revision);
              break;
            } catch (error) {
              const actual = await intentCall("media.document.get", { key: intentKey }) as any;
              await sameExecution();
              const found = actual.data ? await findIntent(actual.data) : null;
              if (found) return normalize(found, scope, false);
              // A competing recovery owns its CAS; do not consume another slot.
              if (actual.data?.requestKey !== old.requestKey || actual.data?.localRecoveries !== ready.localRecoveries) throw error;
              await adoptPrepared(actual.data, actual.revision);
              break;
            }
          }
          // A revision change or retention expiry is not proof that paid work did
          // not run. A normal Host receipt may be gone; explicit recovery remains.
          await confirm("未找到上次媒体请求回执（面板可能已升级或任务记录已过期）。请先核查任务列表、已有产物和远端结果。确认原请求不会再执行，并创建新请求吗？这可能再次计费。");
        }
        const attempt = Number.isSafeInteger(old?.attempt) ? old.attempt + 1 : old ? 2 : 1;
        requestKey = `media-v2:${revisionHash}:${hash}:${attempt}`;
        intent = { schemaVersion: 2, requestKey, recovery, executionRevision, attempt, phase: "pending", createdAt: Date.now(),
          submission: "ready", wireDigest: await mediaRequestHash(wireInput(attempt)), localRecoveries: 0 };
        try {
          const committed = await intentCall("media.document.set", { key: intentKey, baseRevision: saved.revision,
            data: intent, label: "媒体任务意图" }) as any;
          intentRevision = committed.revision;
          break;
        } catch (error) {
          // A conflict/lost CAS receipt belongs to the winner. Query it; never
          // overwrite or remove the other window's intent to force admission.
          const actual = await intentCall("media.document.get", { key: intentKey }) as any;
          await same(scope);
          if (actual.data?.requestKey === requestKey && actual.revision > saved.revision) {
            const found = await findIntent(actual.data);
            if (found) return normalize(found, scope, false);
            await adoptPrepared(actual.data, actual.revision);
            break;
          }
          if (actual.revision === saved.revision) throw error;
          const found = actual.data ? await findIntent(actual.data) : null;
          if (found) return normalize(found, scope, false);
          throw actual.data?.phase === "pending" ? pendingUnknown() : unknown();
        }
      }
    }
    await sameExecution();
    const wire = wireInput(intent?.attempt ?? 1);
    if (!hidden) {
      if (!intent || intent.submission !== "ready" || intent.wireDigest !== await mediaRequestHash(wire)) throw pendingUnknown();
      const claimed = { ...intent, submission: "sent", dispatchToken: randomId() };
      try {
        const saved = await intentCall("media.document.set", { key: intentKey, baseRevision: intentRevision,
          data: claimed, label: "提交原媒体请求" }) as any;
        intentRevision = saved.revision;
      } catch (error) {
        const actual = await intentCall("media.document.get", { key: intentKey }) as any;
        await sameExecution();
        if (canonicalMediaRequest(actual.data) !== canonicalMediaRequest(claimed)) {
          const found = actual.data ? await findIntent(actual.data) : null;
          if (found) return normalize(found, scope, false);
          throw pendingUnknown();
        }
        // This exact invocation has not called start yet: a lost claim ACK is
        // recoverable. Other windows can only observe sent, not steal this claim.
        intentRevision = actual.revision;
      }
      intent = claimed;
    }
    let job;
    try {
      job = await sdk.start({ ...wire, requestKey }, sameExecution);
    } catch (error: any) {
      const existing = await sdk.call("tasks.find", { requestKey }).catch(() => null);
      await same(scope);
      if (existing) job = taskValue(existing);
      else {
        // Read-only probes have no persisted intent. Preserve their actionable
        // native error after checking for an accepted receipt; never claim that
        // an intent was saved or silently submit a replacement in this call.
        if (hidden) throw error;
        // Only explicit pre-admission validation/capacity errors prove rejection.
        // Transport/timeout/revocation messages never authorize another attempt.
        const rejected = ["PARAMS_TOO_LARGE", "TASK_QUEUE_FULL", "TASK_CAPACITY"].includes(error?.code) ||
          ["too many queued tool jobs for this workspace", "tool job capacity reached with unfinished tasks"].includes(error?.message);
        if (rejected) {
          // A known pre-admission rejection may restore the same request, not a
          // new attempt. Retry the CAS write once after a lost/conflicting ACK.
          for (let write = 0; write < 2; write++) {
            try {
              const actual = await intentCall("media.document.get", { key: intentKey }) as any;
              await sameExecution();
              if (actual.data?.requestKey !== requestKey || actual.data?.dispatchToken !== intent.dispatchToken || actual.data?.phase !== "pending") break;
              await intentCall("media.document.set", { key: intentKey, baseRevision: actual.revision,
                data: { ...actual.data, submission: "ready", rejection: String(error.code ?? error.message) }, label: "原媒体请求未受理" });
              break;
            } catch { /* No successful proof write means sent remains conservative. */ }
          }
        }
        if (rejected) throw error;
        throw new Error("媒体任务回执未确认，意图已保存，未自动重发。请求可能未受理或回执已被清理；请检查原任务及结果，本地任务可在同版本下确认有限恢复，未知付费请求不能重发", { cause: error });
      }
    }
    if (hidden) return normalize(job, scope, false);
    // If this acknowledgement write is lost, the original requestKey still finds
    // the task. A CAS conflict must never modify another attempt's record.
    await intentCall("media.document.set", { key: intentKey, baseRevision: intentRevision,
      data: { ...intent, phase: "accepted", jobId: job.id }, label: "媒体任务回执" }).catch(() => {});
    await same(scope);
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
  /** Older Hosts kept media jobs themselves; ask only a Host that still lists that method. */
  const advertised = async (method: string) => {
    const context = await sdk.discover().catch(() => undefined);
    return Array.isArray(context?.availableMethods) && context.availableMethods.includes(method);
  };
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
        // “重新检测” asks for a fresh probe after the user installs local tools.
        if (params.fresh !== true && statusCache && Date.now() - statusCache.at < 30000)
          return clone(statusCache.value);
        // Restoring the editor discovers Host support without running local tools.
        if (params.probe === false)
          return {
            persistent: true,
            runtimeChecked: false,
            ffmpeg: { available: false },
            transcription: { available: false },
            hyperframes: { available: false },
          };
        // A fresh request runs after, not instead of, a probe that may predate the user's fix.
        if (!statusPending || (params.fresh === true && !statusPendingFresh)) {
          const previous = statusPending;
          const current: Promise<any> = (previous?.catch(() => undefined) ?? Promise.resolve())
            .then(() => completed("status"))
            .then((value) => {
              statusCache = { at: Date.now(), value };
              return value;
            })
            .finally(() => {
              if (statusPending !== current) return;
              statusPending = undefined;
              statusPendingFresh = false;
            });
          statusPending = current;
          statusPendingFresh = params.fresh === true;
        }
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
        if (params.inspect !== false && !preparation?.inspection && !isExternalMedia(params.id)) {
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
        const legacy = (
          (await advertised("media.jobs.list"))
            ? await sdk.call("media.jobs.list", params).catch(() => ({ jobs: [] }))
            : { jobs: [] }
        ) as any;
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
        } catch (error) {
          if (method !== "media.jobs.retry") {
            if (!(await advertised(method))) throw error;
            return sdk.call(method, params);
          }
          if (!(await advertised("media.jobs.recipe"))) throw error;
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
          if (!isCanonicalRenderTask(native) && (native.recovery === "manual" || native.error?.retryable === false || native.status === "cancelled")) {
            const request = taskRequest(native);
            if (!request || isCanonicalRenderTask(native)) throw new Error("请核查已有结果后重新创建此任务");
            return start(request.action, request.params);
          }
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
