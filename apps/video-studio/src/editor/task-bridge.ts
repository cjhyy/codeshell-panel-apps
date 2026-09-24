import {
  createPanelRuntime,
  runtimeCancelled,
  taskValue,
  type RuntimeBridge,
  type RuntimeJob,
} from "../sdk/panel-runtime";
import { isResourceId } from "../external-media";
import { createTrack, defaultAudioMix, defaultColorAdjustment, defaultTransform } from "./defaults";
import { validateEditorDocument } from "./validation";
import {
  validatePortableProjectManifest,
  remapPortableProjectResources,
  type PortableProjectManifest,
} from "./portable-project";
import { validateExportProfile, type ExportProfile } from "./export-settings";
import type { EditorSourceInspection } from "./import-media";
import { decodeEditorWaveform, WAVEFORM_LIMITS, type EditorWaveform } from "./waveform";
import type { Tick } from "./time";
import type { EditorAsset, EditorDocument } from "./types";
import type { MulticamAlignment, MulticamAlignmentOptions } from "./multicam-edits";

/** Fixed installed example audio; ordinary resources always take precedence. */
export const EDITOR_DEMO_NARRATION_SHA =
  "a57af26cc6bec773097f739da61e222548d72a5edc4fcaf377276696e7da3d40";
export function isEditorDemoNarration(asset: EditorAsset): boolean {
  return (
    asset.id === "demo-narration-v1" &&
    asset.name === "示例旁白 · 从想法，到成片。" &&
    asset.kind === "audio" &&
    asset.duration === 24 * 240000 &&
    asset.metadata?.mimeType === "audio/mpeg" &&
    !asset.resourceId
  );
}

export const EDITOR_TASK_LIMITS = Object.freeze({
  resourcesPerTask: 128,
  inputBytes: 2 * 1024 * 1024,
  documentBytes: 32 * 1024 * 1024,
  chunkBytes: 512 * 1024,
  snapshotResources: 10000,
  proxiesPerTask: 120,
});
export interface EditorTaskSnapshot {
  kind?: "project";
  transferId: string;
  documentHash: string;
  documentId: string;
  revision: number;
  sequenceId: string;
  byteLength: number;
  chunkCount: number;
  resourceIds: string[];
  /** Browser-side project binding; never used as a filesystem authority. */
  workspaceKey: string;
}
export interface PreparedEditorAudio {
  documentHash: string;
  sequenceId: string;
  recipeHash: string;
  assetId: string;
}
export interface EditorStageOptions {
  /** Explicit continuation may retry a prior retryable failed/cancelled job with the same request key. */
  retryFailedTasks?: boolean;
  signal?: AbortSignal;
  /** Reuse this transfer after interruption; bytes and resource receipts are checked again. */
  transferId?: string;
  onTask?(job: RuntimeJob): void;
  onJobChanged?(job: RuntimeJob): void;
  onProgress?(progress: {
    phase: "resources" | "document" | "commit";
    completed: number;
    total: number;
  }): void;
  onSnapshot?(snapshot: EditorTaskSnapshot): void;
}

export interface EditorTaskArtifact {
  id: string;
  name?: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}
export interface EditorPrepareOptions extends EditorStageOptions {
  snapshot?: EditorTaskSnapshot;
}
export interface EditorAudioResult {
  snapshot: EditorTaskSnapshot;
  job: RuntimeJob;
  preparedAudio: PreparedEditorAudio;
  audioResource: EditorTaskArtifact;
  sampleCount: number;
  peak: number;
  samplesOverFullScale: number;
  report: EditorTaskArtifact;
  reused: boolean;
}
export interface EditorWaveformResult {
  waveform: EditorWaveform;
  artifact: EditorTaskArtifact;
  reused: boolean;
  reusedPcm: boolean;
}
export interface EditorWaveformOrigin {
  documentId: string;
  revision: number;
  sequenceId: string;
  assetId: string;
  documentHash: string;
}
export interface EditorAssetWaveformResult extends EditorWaveformResult {
  origin: EditorWaveformOrigin;
  /** Only an original sequence snapshot may be reused for export. */
  snapshot?: EditorTaskSnapshot;
  /** A separate read-only source analysis document, never written to EditorSession. */
  analysisSnapshot?: EditorTaskSnapshot;
}
export interface EditorSourceVideoResult {
  resourceId: string;
  sourceHash: string;
  proxy: EditorTaskArtifact;
  recipe: EditorVideoSource["recipe"];
}
export interface EditorVideoSource {
  assetId: string;
  proxy: EditorTaskArtifact;
  recipe: { width: number; height: number; sha256: string; [key: string]: unknown };
}
export interface EditorProjectImportReceipt {
  transferId: string;
  bundleHash: string;
  sourceResourceId: string;
  manifest: EditorTaskArtifact;
  mediaCount: number;
  workspaceKey: string;
}
export interface EditorProjectImportOptions extends EditorStageOptions {
  receipt?: EditorProjectImportReceipt;
  onImportReceipt?(receipt: EditorProjectImportReceipt): void | Promise<void>;
}
export interface EditorTaskBridgeOptions {
  onTask?(job: RuntimeJob): void;
  onJobChanged?(job: RuntimeJob): void;
  onProgress?: EditorStageOptions["onProgress"];
}

export async function editorSha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/** Only the chosen sequence's reference closure is shipped. Production annotations carry no file authority. */
export function editorTaskDocument(
  value: unknown,
  sequenceId: string,
): { document: EditorDocument; resourceIds: string[] } {
  const document = validateEditorDocument(value),
    sequences = new Map(document.sequences.map((sequence) => [sequence.id, sequence]));
  if (!sequences.has(sequenceId)) throw new Error("所选导出序列不存在");
  const sequenceIds = new Set<string>(),
    assetIds = new Set<string>();
  const visit = (id: string) => {
    if (sequenceIds.has(id)) return;
    sequenceIds.add(id);
    for (const clip of sequences.get(id)!.clips) {
      if (clip.kind === "sequence") visit(clip.sequenceId);
      else if (clip.kind === "media") assetIds.add(clip.assetId);
      else if (clip.kind === "multicam")
        clip.angles.forEach((angle) => assetIds.add(angle.assetId));
    }
  };
  visit(sequenceId);
  document.sequences = document.sequences.filter((sequence) => sequenceIds.has(sequence.id));
  document.assets = document.assets.filter((asset) => assetIds.has(asset.id));
  document.activeSequenceId = sequenceId;
  const resourceIds = new Set<string>();
  for (const asset of document.assets) {
    if (asset.kind === "demo" || isEditorDemoNarration(asset)) continue;
    const id = asset.resourceId ?? asset.id;
    if (!isResourceId(id)) throw new Error(`素材「${asset.name}」尚未保存为可用于本地任务的资源`);
    asset.resourceId = id;
    resourceIds.add(id);
  }
  if (resourceIds.size > EDITOR_TASK_LIMITS.snapshotResources)
    throw new Error(
      `单个导出快照最多包含 ${EDITOR_TASK_LIMITS.snapshotResources} 个资源，请拆分序列`,
    );
  return { document, resourceIds: [...resourceIds].sort() };
}

/** Entire project library and all sequences, with no legacy timing or resource-identity rewrite. */
export function editorProjectDocument(value: unknown): {
  document: EditorDocument;
  resourceIds: string[];
} {
  const document = validateEditorDocument(value),
    resources = new Set<string>();
  if (document.assets.length > EDITOR_TASK_LIMITS.snapshotResources)
    throw new Error("完整工程最多包含 10000 个素材");
  for (const asset of document.assets) {
    if (asset.kind === "demo" || isEditorDemoNarration(asset)) continue;
    const id = asset.resourceId ?? asset.id;
    if (!isResourceId(id))
      throw new Error(`素材「${asset.name}」缺少已保存的原始资源，无法生成完整工程包`);
    resources.add(id);
  }
  return { document, resourceIds: [...resources].sort() };
}

function transferId(value: unknown): string {
  if (typeof value !== "string" || !/^editor-[a-f0-9-]{36}$/.test(value))
    throw new Error("编辑器传输编号无效");
  return value;
}
function resultOf(job: RuntimeJob): any {
  if (job.status !== "succeeded")
    throw Object.assign(new Error(job.error?.message ?? "编辑器任务未完成"), {
      taskId: job.id,
      ...(job.error?.code ? { code: job.error.code } : {}),
      retryable: job.error?.retryable === true,
    });
  return job.result?.result ?? job.result;
}
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192)
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}

/** Durable reviewed task transport. Closing this bridge does not cancel already queued exports. */
export function createEditorTaskBridge(raw: RuntimeBridge, defaults: EditorTaskBridgeOptions = {}) {
  const sdk = createPanelRuntime(raw);
  let disposed = false;
  const required = ["tasks.start", "tasks.get", "tasks.cancel", "tasks.retry", "resources.get"];
  async function workspace(): Promise<string> {
    if (disposed) throw runtimeCancelled();
    const context = await raw.getContext();
    if (typeof context.cwd !== "string" || !context.cwd)
      throw new Error("请先将视频面板绑定到工程");
    return editorSha256(new TextEncoder().encode(context.cwd));
  }
  async function same(key: string) {
    if (disposed || (await workspace()) !== key) throw runtimeCancelled();
  }
  async function start(
    request: Record<string, unknown>,
    resourceIds: string[],
    key: string,
    signal?: AbortSignal,
    beforeSubmit?: () => void,
  ): Promise<RuntimeJob> {
    await sdk.requireMethods(required);
    await same(key);
    if (signal?.aborted) throw runtimeCancelled();
    const context = await sdk.discover();
    const maximum = Math.min(
      EDITOR_TASK_LIMITS.inputBytes,
      Number(context.capabilities?.tasks?.maxInputBytes) || EDITOR_TASK_LIMITS.inputBytes,
    );
    const requestHash = await editorSha256(new TextEncoder().encode(JSON.stringify(request)));
    const input = {
      entry: "editor-runtime",
      recovery: "retry",
      ...(["stage-status", "project-import-status"].includes(String(request.action))
        ? {}
        : { requestKey: `editor-v2:${requestHash}` }),
      input: {
        request,
        resources: resourceIds.map((assetId, index) => ({
          assetId,
          path: `inputs/resource-${index}.bin`,
        })),
        directoryArguments: [
          { argumentName: "--job-dir", directory: "job" },
          { argumentName: "--runtime-dir", directory: "app-data", path: "runtime/editor-v2" },
        ],
      },
    };
    if (
      resourceIds.length > EDITOR_TASK_LIMITS.resourcesPerTask ||
      new TextEncoder().encode(JSON.stringify(input)).length > maximum
    )
      throw new Error("编辑器任务超过主程序资源或请求大小限制，请继续分批准备");
    await same(key);
    if (signal?.aborted) throw runtimeCancelled();
    beforeSubmit?.();
    const job = await sdk.start(input);
    // Preserve the real render receipt if cancellation/scope changes race task creation.
    // Its owner can then cancel that exact task instead of reporting an unknown outcome.
    if (request.action === "render") return job;
    if (signal?.aborted) {
      await sdk.cancel(job.id).catch(() => {});
      throw runtimeCancelled();
    }
    await same(key);
    return job;
  }
  async function complete(
    request: Record<string, unknown>,
    resourceIds: string[],
    key: string,
    options: EditorStageOptions = {},
  ) {
    let job = await start(request, resourceIds, key, options.signal);
    if (
      options.retryFailedTasks &&
      ["failed", "cancelled"].includes(job.status) &&
      job.error?.retryable
    ) {
      if (options.signal?.aborted) throw runtimeCancelled();
      job = await sdk.retry(job.id);
    }
    options.onTask?.(job);
    let cancelling: Promise<unknown> | undefined;
    const cancel = () => {
      cancelling ??= sdk.cancel(job.id).catch(() => {});
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    try {
      const done = await sdk.wait(job.id, {
        signal: options.signal,
        changed: options.onJobChanged ?? defaults.onJobChanged,
      });
      await same(key);
      return resultOf(done);
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      if (cancelling) await cancelling;
    }
  }
  async function stage(
    value: unknown,
    sequenceId: string,
    options: EditorStageOptions = {},
    project = false,
  ): Promise<EditorTaskSnapshot> {
    options = { ...defaults, ...options };
    const key = await workspace(),
      selected = project ? editorProjectDocument(value) : editorTaskDocument(value, sequenceId);
    const bytes = new TextEncoder().encode(JSON.stringify(selected.document));
    if (bytes.length > EDITOR_TASK_LIMITS.documentBytes)
      throw new Error("编辑器快照超过 32MiB，请拆分序列后导出");
    const snapshot: EditorTaskSnapshot = {
      ...(project ? { kind: "project" as const } : {}),
      transferId: transferId(options.transferId ?? `editor-${crypto.randomUUID()}`),
      documentHash: await editorSha256(bytes),
      documentId: selected.document.id,
      revision: selected.document.revision,
      sequenceId,
      byteLength: bytes.length,
      chunkCount: Math.ceil(bytes.length / EDITOR_TASK_LIMITS.chunkBytes),
      resourceIds: selected.resourceIds,
      workspaceKey: key,
    };
    options.onSnapshot?.(structuredClone(snapshot));
    let chunks: number[] = [];
    for (
      let startIndex = 0;
      startIndex < Math.max(1, snapshot.resourceIds.length);
      startIndex += EDITOR_TASK_LIMITS.resourcesPerTask
    ) {
      const batch = snapshot.resourceIds.slice(
        startIndex,
        startIndex + EDITOR_TASK_LIMITS.resourcesPerTask,
      );
      const status = await complete(
        {
          action: "stage-status",
          transferId: snapshot.transferId,
          documentHash: snapshot.documentHash,
          resourceIds: batch,
        },
        [],
        key,
        options,
      );
      if (
        !Array.isArray(status?.resourceIds) ||
        status.resourceIds.some((id: unknown) => !batch.includes(String(id))) ||
        !Array.isArray(status?.chunks)
      )
        throw new Error("素材准备状态无效");
      if (
        status.committedDocumentHash &&
        (status.committedDocumentHash !== snapshot.documentHash ||
          status.sequenceId !== sequenceId ||
          (status.kind === "project") !== project)
      )
        throw new Error("快照已提交，请为新修改建立新的快照");
      if (
        status.chunks.some(
          (index: unknown) =>
            !Number.isSafeInteger(index) ||
            Number(index) < 0 ||
            Number(index) >= snapshot.chunkCount,
        )
      )
        throw new Error("工程数据块状态无效");
      chunks = status.chunks;
      const missing = batch.filter((id) => !status.resourceIds.includes(id));
      // The Host copies every missing original inside tasks.start, before any job exists.
      if (missing.length)
        options.onProgress?.({
          phase: "resources",
          completed: startIndex + batch.length - missing.length,
          total: snapshot.resourceIds.length,
        });
      if (missing.length)
        await complete(
          { action: "stage-resources", transferId: snapshot.transferId, resourceIds: missing },
          missing,
          key,
          options,
        );
      options.onProgress?.({
        phase: "resources",
        completed: Math.min(snapshot.resourceIds.length, startIndex + batch.length),
        total: snapshot.resourceIds.length,
      });
    }
    for (let index = 0; index < snapshot.chunkCount; index++) {
      if (!chunks.includes(index))
        await complete(
          {
            action: "stage-document",
            transferId: snapshot.transferId,
            documentHash: snapshot.documentHash,
            chunkIndex: index,
            chunkCount: snapshot.chunkCount,
            dataBase64: base64(
              bytes.subarray(
                index * EDITOR_TASK_LIMITS.chunkBytes,
                (index + 1) * EDITOR_TASK_LIMITS.chunkBytes,
              ),
            ),
          },
          [],
          key,
          options,
        );
      options.onProgress?.({ phase: "document", completed: index + 1, total: snapshot.chunkCount });
    }
    const committed = await complete(
      {
        action: project ? "commit-project" : "commit",
        transferId: snapshot.transferId,
        documentHash: snapshot.documentHash,
        sequenceId,
        chunkCount: snapshot.chunkCount,
        byteLength: snapshot.byteLength,
      },
      [],
      key,
      options,
    );
    if (
      committed?.documentHash !== snapshot.documentHash ||
      committed.sequenceId !== sequenceId ||
      (committed.kind === "project") !== project
    )
      throw new Error("工程快照校验未完成");
    options.onProgress?.({ phase: "commit", completed: 1, total: 1 });
    return snapshot;
  }
  async function snapshotRequest(
    snapshot: EditorTaskSnapshot,
    action: string,
    extra: Record<string, unknown> = {},
    signal?: AbortSignal,
    beforeSubmit?: () => void,
  ) {
    transferId(snapshot.transferId);
    await same(snapshot.workspaceKey);
    return start(
      {
        action,
        transferId: snapshot.transferId,
        documentHash: snapshot.documentHash,
        sequenceId: snapshot.sequenceId,
        ...extra,
      },
      [],
      snapshot.workspaceKey,
      signal,
      beforeSubmit,
    );
  }
  async function selectedSnapshot(
    value: unknown,
    sequenceId: string,
    options: EditorPrepareOptions,
  ) {
    if (!options.snapshot) return stage(value, sequenceId, options);
    const snapshot = options.snapshot;
    await same(snapshot.workspaceKey);
    const selected = editorTaskDocument(value, sequenceId);
    const documentHash = await editorSha256(
      new TextEncoder().encode(JSON.stringify(selected.document)),
    );
    if (documentHash !== snapshot.documentHash || snapshot.sequenceId !== sequenceId)
      throw new Error("快照与当前工程修改不一致，请重新准备");
    return snapshot;
  }
  async function waitOwned(
    job: RuntimeJob,
    snapshot: EditorTaskSnapshot,
    options: EditorStageOptions,
  ) {
    if (
      options.retryFailedTasks &&
      ["failed", "cancelled"].includes(job.status) &&
      job.error?.retryable
    ) {
      if (options.signal?.aborted) throw runtimeCancelled();
      job = await sdk.retry(job.id);
    }
    (options.onTask ?? defaults.onTask)?.(job);
    let cancelling: Promise<unknown> | undefined;
    const cancel = () => {
      cancelling ??= sdk.cancel(job.id).catch(() => {});
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    try {
      const done = await sdk.wait(job.id, {
        signal: options.signal,
        changed: options.onJobChanged ?? defaults.onJobChanged,
      });
      await same(snapshot.workspaceKey);
      resultOf(done);
      return done;
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      if (cancelling) await cancelling;
    }
  }
  function artifact(value: any, mimeType?: string, maximum = 20 * 1024 ** 3): EditorTaskArtifact {
    if (
      !value ||
      typeof value.id !== "string" ||
      !/^asset-[a-f0-9]{64}$/.test(value.id) ||
      value.sha256 !== value.id.slice(6) ||
      !Number.isSafeInteger(value.bytes) ||
      value.bytes < 1 ||
      value.bytes > maximum ||
      typeof value.mimeType !== "string" ||
      (mimeType && value.mimeType !== mimeType)
    )
      throw new Error("工程包资源回执无效");
    return {
      id: value.id,
      sha256: value.sha256,
      bytes: value.bytes,
      mimeType: value.mimeType,
      ...(typeof value.name === "string" ? { name: value.name } : {}),
    };
  }
  async function readManifest(
    resource: EditorTaskArtifact,
    key: string,
    signal?: AbortSignal,
  ): Promise<PortableProjectManifest> {
    await sdk.requireMethods(["resources.read"]);
    const bytes = new Uint8Array(resource.bytes);
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      await same(key);
      const length = Math.min(32768, bytes.length - offset),
        part: any = await sdk.call(
          "resources.read",
          { assetId: resource.id, offset, length },
          signal,
        );
      if (
        part?.assetId !== resource.id ||
        part.offset !== offset ||
        part.totalBytes !== bytes.length ||
        typeof part.dataBase64 !== "string" ||
        part.dataBase64.length > Math.ceil(length / 3) * 4 ||
        part.eof !== (offset + length === bytes.length)
      )
        throw new Error("工程包清单资源或读取范围已变化");
      const decoded = atob(part.dataBase64);
      if (decoded.length !== length) throw new Error("工程包清单读取不完整");
      for (let i = 0; i < length; i++) bytes[offset + i] = decoded.charCodeAt(i);
    }
    await same(key);
    if (signal?.aborted) throw runtimeCancelled();
    if ((await editorSha256(bytes)) !== resource.sha256)
      throw new Error("工程包清单 SHA-256 校验失败");
    return validatePortableProjectManifest(
      JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)),
    );
  }
  async function readWaveformResult(
    result: any,
    resourceId: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<EditorWaveformResult> {
    const artifact = result?.waveform as EditorTaskArtifact;
    if (
      result?.resourceId !== resourceId ||
      !/^[a-f0-9]{64}$/.test(result?.sourceHash) ||
      (resourceId.startsWith("asset-") && resourceId !== `asset-${result.sourceHash}`) ||
      !artifact ||
      artifact.id !== `asset-${artifact.sha256}` ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      artifact.mimeType !== "application/json" ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 1 ||
      artifact.bytes > WAVEFORM_LIMITS.bytes ||
      typeof result.reused !== "boolean" ||
      typeof result.reusedPcm !== "boolean"
    )
      throw new Error("波形分析回执无效");
    await sdk.requireMethods(["resources.read"]);
    const bytes = new Uint8Array(artifact.bytes);
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      const length = Math.min(32768, bytes.length - offset);
      const part: any = await sdk.call(
        "resources.read",
        { assetId: artifact.id, offset, length },
        signal,
      );
      if (
        part?.assetId !== artifact.id ||
        part.offset !== offset ||
        part.totalBytes !== bytes.length ||
        typeof part.dataBase64 !== "string" ||
        part.dataBase64.length > Math.ceil(length / 3) * 4 ||
        part.eof !== (offset + length === bytes.length)
      )
        throw new Error("波形资源身份或读取范围已变化");
      const decoded = atob(part.dataBase64);
      if (decoded.length !== length) throw new Error("波形资源读取不完整");
      for (let i = 0; i < length; i++) bytes[offset + i] = decoded.charCodeAt(i);
    }
    await same(key);
    if (signal?.aborted) throw runtimeCancelled();
    if ((await editorSha256(bytes)) !== artifact.sha256) throw new Error("波形资源内容校验失败");
    const waveform = decodeEditorWaveform(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (waveform.sourceHash !== result.sourceHash) throw new Error("波形与素材身份不匹配");
    return { waveform, artifact, reused: result.reused, reusedPcm: result.reusedPcm };
  }
  async function multicamRequest(
    value: unknown,
    assetIds: string[],
    referenceAssetId: string,
    options: EditorStageOptions & Partial<MulticamAlignmentOptions>,
  ) {
    const document = validateEditorDocument(value);
    if (
      !Array.isArray(assetIds) ||
      assetIds.length < 2 ||
      assetIds.length > 32 ||
      new Set(assetIds).size !== assetIds.length ||
      !assetIds.includes(referenceAssetId)
    )
      throw new Error("请选择 2 至 32 个不同机位素材和一个基准机位");
    const assets = assetIds.map((id) => {
      const asset = document.assets.find((item) => item.id === id);
      if (!asset || asset.kind !== "video" || !asset.resourceId || !isResourceId(asset.resourceId))
        throw new Error("声音同步需要已导入的视频资源");
      return asset;
    });
    const resourceIds = assets.map((asset) => asset.resourceId!),
      referenceResourceId = assets.find((asset) => asset.id === referenceAssetId)!.resourceId!,
      windowSeconds = options.windowSeconds ?? 30,
      maxOffsetSeconds = options.maxOffsetSeconds ?? 10;
    if (new Set(resourceIds).size !== resourceIds.length)
      throw new Error("不同机位必须使用不同源文件");
    if (
      !Number.isSafeInteger(windowSeconds) ||
      windowSeconds < 3 ||
      windowSeconds > 180 ||
      !Number.isSafeInteger(maxOffsetSeconds) ||
      maxOffsetSeconds < 0 ||
      maxOffsetSeconds > 60 ||
      maxOffsetSeconds >= windowSeconds - 2
    )
      throw new Error("同步范围无效：分析 3 至 180 秒，最大偏移须小于分析时长减 2 秒");
    const documentHash = await editorSha256(new TextEncoder().encode(JSON.stringify(document))),
      key = await workspace();
    const origin = {
      documentId: document.id,
      revision: document.revision,
      documentHash,
      referenceAssetId,
      assets: assets.map((asset) => ({ assetId: asset.id, resourceId: asset.resourceId! })),
    };
    const request = {
      action: "align-multicam",
      transferId: transferId(options.transferId ?? `editor-${crypto.randomUUID()}`),
      resourceIds,
      alignment: {
        referenceResourceId,
        windowSeconds,
        maxOffsetSeconds,
        sourceDurations: assets.map((asset) => asset.duration),
        sourceHashes: assets.map((asset) => asset.fingerprint ?? null),
        origin,
      },
    };
    return {
      document,
      documentHash,
      assets,
      resourceIds,
      referenceResourceId,
      windowSeconds,
      maxOffsetSeconds,
      key,
      origin,
      request,
    };
  }
  const bridge = {
    stage,
    async stageProject(value: unknown, options: EditorStageOptions = {}) {
      const document = editorProjectDocument(value).document;
      return stage(
        document,
        document.activeSequenceId,
        { retryFailedTasks: true, ...options },
        true,
      );
    },
    async exportProjectBundle(
      value: unknown,
      options: EditorPrepareOptions = {},
    ): Promise<{ snapshot: EditorTaskSnapshot; job: RuntimeJob; bundle: EditorTaskArtifact }> {
      options = { retryFailedTasks: true, ...options };
      const document = editorProjectDocument(value).document;
      const snapshot = options.snapshot
        ? structuredClone(options.snapshot)
        : await bridge.stageProject(document, options);
      await same(snapshot.workspaceKey);
      if (
        snapshot.kind !== "project" ||
        snapshot.documentHash !==
          (await editorSha256(new TextEncoder().encode(JSON.stringify(document)))) ||
        snapshot.sequenceId !== document.activeSequenceId
      )
        throw new Error("完整工程快照与当前文档不一致");
      const job = await waitOwned(
          await snapshotRequest(snapshot, "export-project", {}, options.signal),
          snapshot,
          options,
        ),
        result = resultOf(job);
      if (result?.documentHash !== snapshot.documentHash || result.formatVersion !== 1)
        throw new Error("工程包导出回执与快照不一致");
      return { snapshot, job, bundle: artifact(result.bundle, "application/zip") };
    },
    async importProjectBundle(
      sourceResourceId: string,
      options: EditorProjectImportOptions = {},
    ): Promise<{
      document: EditorDocument;
      manifest: PortableProjectManifest;
      bundleHash: string;
      transferId: string;
      resources: EditorTaskArtifact[];
      receipt: EditorProjectImportReceipt;
    }> {
      options = { ...defaults, retryFailedTasks: true, ...options };
      if (!isResourceId(sourceResourceId)) throw new Error("工程包原始资源编号无效");
      const key = await workspace(),
        prior = options.receipt;
      if (
        prior &&
        (prior.workspaceKey !== key ||
          prior.sourceResourceId !== sourceResourceId ||
          (options.transferId && options.transferId !== prior.transferId))
      )
        throw new Error("工程包恢复回执不属于当前工程或资源");
      const id = transferId(
        prior?.transferId ?? options.transferId ?? `editor-${crypto.randomUUID()}`,
      );
      const result = await complete(
        prior
          ? { action: "project-import-status", transferId: id, bundleHash: prior.bundleHash }
          : { action: "import-project", transferId: id, resourceIds: [sourceResourceId] },
        prior ? [] : [sourceResourceId],
        key,
        options,
      );
      if (
        result?.transferId !== id ||
        result.sourceResourceId !== sourceResourceId ||
        !/^[a-f0-9]{64}$/.test(result.bundleHash) ||
        (sourceResourceId.startsWith("asset-") &&
          sourceResourceId !== `asset-${result.bundleHash}`) ||
        (prior && prior.bundleHash !== result.bundleHash) ||
        !Number.isSafeInteger(result.mediaCount) ||
        result.mediaCount < 0 ||
        result.mediaCount > EDITOR_TASK_LIMITS.snapshotResources
      )
        throw new Error("工程包导入回执无效");
      const receipt: EditorProjectImportReceipt = {
        transferId: id,
        sourceResourceId,
        bundleHash: result.bundleHash,
        manifest: artifact(result.manifest, "application/json", EDITOR_TASK_LIMITS.documentBytes),
        mediaCount: result.mediaCount,
        workspaceKey: key,
      };
      if (
        prior &&
        (prior.manifest.sha256 !== receipt.manifest.sha256 ||
          prior.manifest.bytes !== receipt.manifest.bytes ||
          prior.mediaCount !== receipt.mediaCount)
      )
        throw new Error("已校验的工程包清单发生变化");
      await options.onImportReceipt?.(structuredClone(receipt));
      const manifest = await readManifest(receipt.manifest, key, options.signal),
        resources: EditorTaskArtifact[] = [];
      if (manifest.media.length !== receipt.mediaCount)
        throw new Error("工程包素材总数与清单不一致");
      for (let startIndex = 0; startIndex < manifest.media.length; startIndex += 120) {
        const expected = manifest.media.slice(startIndex, startIndex + 120),
          batchIndex = startIndex / 120;
        const page = await complete(
          {
            action: "publish-project-media",
            transferId: id,
            bundleHash: receipt.bundleHash,
            batchIndex,
          },
          [],
          key,
          options,
        );
        if (
          page?.transferId !== id ||
          page.bundleHash !== receipt.bundleHash ||
          page.batchIndex !== batchIndex ||
          !Array.isArray(page.media) ||
          page.media.length !== expected.length
        )
          throw new Error("工程包素材批次回执不完整");
        for (let i = 0; i < expected.length; i++) {
          const source = artifact(page.media[i]);
          if (source.sha256 !== expected[i]!.sha256 || source.bytes !== expected[i]!.bytes)
            throw new Error("发布素材与工程包原始字节不一致");
          resources.push(source);
        }
        options.onProgress?.({
          phase: "resources",
          completed: resources.length,
          total: manifest.media.length,
        });
      }
      await same(key);
      if (options.signal?.aborted) throw runtimeCancelled();
      const document = remapPortableProjectResources(
        manifest,
        resources.map((item) => ({ sha256: item.sha256, resourceId: item.id })),
      );
      return {
        document,
        manifest,
        bundleHash: receipt.bundleHash,
        transferId: id,
        resources,
        receipt,
      };
    },
    async discardProjectImport(
      receipt: EditorProjectImportReceipt,
      options: EditorStageOptions = {},
    ) {
      await same(receipt.workspaceKey);
      return complete(
        {
          action: "discard-project-import",
          transferId: transferId(receipt.transferId),
          bundleHash: receipt.bundleHash,
        },
        [],
        receipt.workspaceKey,
        { ...defaults, ...options },
      );
    },
    async analyzeWaveform(
      resourceId: string,
      options: EditorStageOptions & { sourceDuration: Tick },
    ): Promise<EditorWaveformResult> {
      if (
        !isResourceId(resourceId) ||
        !Number.isSafeInteger(options.sourceDuration) ||
        options.sourceDuration < 1 ||
        options.sourceDuration > 86400 * 240000
      )
        throw new Error("波形素材编号或时长无效");
      const key = await workspace(),
        result = await complete(
          {
            action: "analyze-waveform",
            transferId: `editor-${crypto.randomUUID()}`,
            resourceIds: [resourceId],
            sourceDuration: options.sourceDuration,
          },
          [resourceId],
          key,
          { ...defaults, ...options },
        );
      return readWaveformResult(result, resourceId, key, options.signal);
    },
    async startMulticamAlignment(
      value: unknown,
      assetIds: string[],
      referenceAssetId: string,
      options: EditorStageOptions & Partial<MulticamAlignmentOptions> = {},
    ) {
      const { request, resourceIds, key, origin } = await multicamRequest(
        value,
        assetIds,
        referenceAssetId,
        options,
      );
      const job = await start(request, resourceIds, key, options.signal);
      (options.onTask ?? defaults.onTask)?.(job);
      return { jobId: job.id, ...origin };
    },
    async alignMulticamSources(
      value: unknown,
      assetIds: string[],
      referenceAssetId: string,
      options: EditorStageOptions & Partial<MulticamAlignmentOptions> = {},
    ): Promise<MulticamAlignment> {
      const {
        document,
        documentHash,
        assets,
        resourceIds,
        referenceResourceId,
        windowSeconds,
        maxOffsetSeconds,
        key,
        origin,
        request,
      } = await multicamRequest(value, assetIds, referenceAssetId, options);
      const result = await complete(request, resourceIds, key, { ...defaults, ...options });
      if (JSON.stringify(result?.origin) !== JSON.stringify(origin))
        throw new Error("机位同步来源与工程不一致");
      if (
        result?.referenceResourceId !== referenceResourceId ||
        typeof result.reused !== "boolean" ||
        !Array.isArray(result.results) ||
        result.results.length !== assets.length
      )
        throw new Error("机位同步返回了不匹配的结果");
      const seen = new Set<string>();
      const results = result.results.map((item: any) => {
        const asset = assets.find((asset) => asset.resourceId === item?.resourceId);
        if (
          !asset ||
          seen.has(asset.id) ||
          !Number.isSafeInteger(item.offset) ||
          Math.abs(item.offset) > maxOffsetSeconds * 240000 ||
          item.precisionTicks !== 1200 ||
          item.offset % 1200 !== 0 ||
          typeof item.reliable !== "boolean" ||
          ![item.confidence, item.secondPeak].every(
            (value) =>
              typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1,
          ) ||
          typeof item.overlapSeconds !== "number" ||
          !Number.isFinite(item.overlapSeconds) ||
          item.overlapSeconds < 0 ||
          item.overlapSeconds > windowSeconds ||
          !/^[a-f0-9]{64}$/.test(item.sourceHash) ||
          (asset.fingerprint !== undefined && asset.fingerprint !== item.sourceHash) ||
          (asset.resourceId!.startsWith("asset-") &&
            asset.resourceId !== `asset-${item.sourceHash}`) ||
          (item.reason !== undefined &&
            (typeof item.reason !== "string" || item.reason.length > 1000))
        )
          throw new Error("机位同步结果范围或素材校验无效");
        seen.add(asset.id);
        return {
          assetId: asset.id,
          offset: item.offset,
          confidence: item.confidence,
          secondPeak: item.secondPeak,
          overlapSeconds: item.overlapSeconds,
          precisionTicks: 1200 as const,
          reliable: item.reliable,
          ...(item.reason ? { reason: item.reason } : {}),
        };
      });
      const reference = results.find(
        (item: MulticamAlignment["results"][number]) => item.assetId === referenceAssetId,
      )!;
      if (reference.offset !== 0 || !reference.reliable) throw new Error("基准机位同步结果无效");
      return {
        documentId: document.id,
        revision: document.revision,
        documentHash,
        referenceAssetId,
        results,
        reused: result.reused,
      };
    },
    async analyzeAssetWaveform(
      value: unknown,
      sequenceId: string,
      assetId: string,
      options: EditorPrepareOptions = {},
    ): Promise<EditorAssetWaveformResult> {
      const document = editorTaskDocument(value, sequenceId).document,
        asset = document.assets.find((item) => item.id === assetId);
      if (!asset || !["audio", "video"].includes(asset.kind))
        throw new Error("请从当前序列选择声音或视频素材");
      const origin: EditorWaveformOrigin = {
        documentId: document.id,
        revision: document.revision,
        sequenceId,
        assetId,
        documentHash: await editorSha256(new TextEncoder().encode(JSON.stringify(document))),
      };
      const narrow = isEditorDemoNarration(asset) && !options.snapshot;
      let snapshot: EditorTaskSnapshot;
      if (narrow) {
        const analysisId = `waveform-analysis-${await editorSha256(new TextEncoder().encode(JSON.stringify(origin)))}`;
        const analysis: EditorDocument = {
          schemaVersion: 2,
          timebase: 240000,
          id: analysisId,
          name: "旁白波形分析",
          revision: 0,
          assets: [structuredClone(asset)],
          exportProfiles: [],
          activeSequenceId: "waveform-source",
          production: { waveformAnalysisOrigin: { ...origin } },
          sequences: [
            {
              id: "waveform-source",
              name: "声音素材",
              width: 64,
              height: 64,
              frameRate: { numerator: 30, denominator: 1 },
              background: "#000000",
              timelineMode: "free",
              tracks: [createTrack("waveform-audio", "audio")],
              clips: [
                {
                  id: "waveform-clip",
                  kind: "media",
                  label: asset.name,
                  assetId,
                  trackId: "waveform-audio",
                  start: 0,
                  duration: asset.duration,
                  timeMap: {
                    points: [
                      { time: 0, source: 0 },
                      { time: asset.duration, source: asset.duration },
                    ],
                  },
                  audio: defaultAudioMix(),
                  transform: defaultTransform(),
                  color: defaultColorAdjustment(),
                  blendMode: "normal",
                },
              ],
              transitions: [],
              markers: [],
            },
          ],
        };
        snapshot = await stage(analysis, analysis.activeSequenceId, options);
      } else snapshot = await selectedSnapshot(value, sequenceId, options);
      const job = await waitOwned(
          await snapshotRequest(
            snapshot,
            "analyze-asset-waveform",
            { assetIds: [assetId] },
            options.signal,
          ),
          snapshot,
          options,
        ),
        result = resultOf(job);
      if (
        result?.documentHash !== snapshot.documentHash ||
        result.sequenceId !== snapshot.sequenceId ||
        result.assetId !== assetId ||
        result.origin?.documentId !== origin.documentId ||
        result.origin.revision !== origin.revision ||
        result.origin.sequenceId !== origin.sequenceId ||
        result.origin.assetId !== origin.assetId ||
        result.origin.documentHash !== origin.documentHash
      )
        throw new Error("声音波形与当前工程分析来源不一致");
      const resourceId = isEditorDemoNarration(asset)
        ? `asset-${EDITOR_DEMO_NARRATION_SHA}`
        : (asset.resourceId ?? asset.id);
      return {
        ...(await readWaveformResult(result, resourceId, snapshot.workspaceKey, options.signal)),
        origin,
        ...(narrow ? { analysisSnapshot: snapshot } : { snapshot }),
      };
    },
    async prepareSourceVideo(
      resourceId: string,
      options: EditorStageOptions & { sourceDuration: Tick },
    ): Promise<EditorSourceVideoResult> {
      if (
        !isResourceId(resourceId) ||
        !Number.isSafeInteger(options.sourceDuration) ||
        options.sourceDuration < 1 ||
        options.sourceDuration > 86400 * 240000
      )
        throw new Error("视频素材编号或时长无效");
      const key = await workspace(),
        result = await complete(
          {
            action: "prepare-source-video",
            transferId: `editor-${crypto.randomUUID()}`,
            resourceIds: [resourceId],
            sourceDuration: options.sourceDuration,
          },
          [resourceId],
          key,
          { ...defaults, ...options },
        );
      const proxy = result?.proxy as EditorTaskArtifact,
        recipe = result?.recipe;
      if (
        result?.resourceId !== resourceId ||
        !/^[a-f0-9]{64}$/.test(result?.sourceHash) ||
        (resourceId.startsWith("asset-") && resourceId !== `asset-${result.sourceHash}`) ||
        !proxy ||
        proxy.id !== `asset-${proxy.sha256}` ||
        !/^[a-f0-9]{64}$/.test(proxy.sha256) ||
        proxy.mimeType !== "video/mp4" ||
        !Number.isSafeInteger(proxy.bytes) ||
        proxy.bytes < 1 ||
        proxy.bytes > 20 * 1024 ** 3 ||
        !recipe ||
        recipe.sourceHash !== result.sourceHash ||
        recipe.sha256 !== proxy.sha256 ||
        recipe.mimeType !== "video/mp4" ||
        !/^[a-f0-9]{64}$/.test(recipe.recipeHash) ||
        !Number.isSafeInteger(recipe.width) ||
        !Number.isSafeInteger(recipe.height) ||
        recipe.width < 1 ||
        recipe.width > 8192 ||
        recipe.height < 1 ||
        recipe.height > 8192 ||
        !Number.isSafeInteger(recipe.frameCount) ||
        recipe.frameCount < 1 ||
        !Number.isFinite(recipe.sourceOriginSeconds) ||
        recipe.color?.space !== "bt709" ||
        recipe.color?.primaries !== "bt709" ||
        recipe.color?.transfer !== "bt709" ||
        recipe.color?.range !== "tv"
      )
        throw new Error("单个素材的兼容画面回执无效");
      return { resourceId, sourceHash: result.sourceHash, proxy, recipe: structuredClone(recipe) };
    },
    async inspectSource(
      resourceId: string,
      options: EditorStageOptions = {},
    ): Promise<EditorSourceInspection> {
      if (!isResourceId(resourceId)) throw new Error("素材资源编号无效");
      const key = await workspace(),
        result = await complete(
          {
            action: "inspect-source",
            transferId: `editor-${crypto.randomUUID()}`,
            resourceIds: [resourceId],
          },
          [resourceId],
          key,
          { ...defaults, ...options },
        );
      if (
        !result ||
        result.resourceId !== resourceId ||
        !/^[a-f0-9]{64}$/.test(result.sha256) ||
        (resourceId.startsWith("asset-") && resourceId !== `asset-${result.sha256}`) ||
        !Number.isSafeInteger(result.bytes) ||
        result.bytes < 1 ||
        result.bytes > 20 * 1024 ** 3 ||
        !["video", "audio", "image"].includes(result.kind) ||
        !Number.isSafeInteger(result.duration) ||
        result.duration < (result.kind === "image" ? 0 : 1) ||
        result.duration > 24 * 60 * 60 * 240000 ||
        (result.kind !== "audio" &&
          (!Number.isSafeInteger(result.width) ||
            !Number.isSafeInteger(result.height) ||
            result.width < 1 ||
            result.height < 1 ||
            result.width > 8192 ||
            result.height > 8192)) ||
        typeof result.mimeType !== "string" ||
        !/^(?:image|audio|video)\/[a-z0-9!#$&^_.+-]+$/.test(result.mimeType) ||
        result.inspection?.schemaVersion !== 1 ||
        !Array.isArray(result.inspection?.compatibility?.limitations) ||
        !["supported", "unsupported"].includes(result.inspection?.compatibility?.export) ||
        !["native-proxy", "static-image", "prepared-audio", "unsupported"].includes(
          result.inspection?.compatibility?.preview,
        )
      )
        throw new Error("原生素材分析回执无效");
      return structuredClone(result) as EditorSourceInspection;
    },
    async prepareAudioForPreview(
      value: unknown,
      sequenceId: string,
      options: EditorPrepareOptions = {},
    ): Promise<EditorAudioResult> {
      const snapshot = await selectedSnapshot(value, sequenceId, options);
      const job = await waitOwned(
          await snapshotRequest(snapshot, "prepare-audio", {}, options.signal),
          snapshot,
          options,
        ),
        result = resultOf(job);
      if (
        result?.preparedAudio?.documentHash !== snapshot.documentHash ||
        result.preparedAudio.sequenceId !== sequenceId ||
        result.audio?.id !== result.preparedAudio.assetId ||
        !/^asset-[a-f0-9]{64}$/.test(result.audio.id) ||
        result.audio.sha256 !== result.audio.id.slice(6) ||
        !Number.isSafeInteger(result.audio.bytes) ||
        result.audio.bytes < 1 ||
        result.audio.mimeType !== "audio/wav" ||
        !Number.isSafeInteger(result.sampleCount) ||
        result.sampleCount < 0
      )
        throw new Error("已准备声音资源回执无效");
      return {
        snapshot,
        job,
        preparedAudio: result.preparedAudio,
        audioResource: result.audio,
        sampleCount: result.sampleCount,
        peak: result.peak,
        samplesOverFullScale: result.samplesOverFullScale,
        report: result.report,
        reused: result.reused === true,
      };
    },
    async startExport(
      value: unknown,
      sequenceId: string,
      profile: ExportProfile,
      options: EditorPrepareOptions & {
        preparedAudio?: PreparedEditorAudio;
        beforeSubmit?: () => void;
      } = {},
    ) {
      const snapshot = await selectedSnapshot(value, sequenceId, options),
        job = await bridge.render(snapshot, profile, options);
      (options.onTask ?? defaults.onTask)?.(job);
      return { snapshot, job };
    },
    async prepareVideoForPreview(
      value: unknown,
      sequenceId: string,
      options: EditorPrepareOptions = {},
    ): Promise<{ snapshot: EditorTaskSnapshot; sources: EditorVideoSource[] }> {
      // onTask/onJobChanged describe the video jobs; staging reports through onProgress.
      const snapshot = await selectedSnapshot(value, sequenceId, {
        ...options,
        onTask: undefined,
        onJobChanged: undefined,
      });
      const ids = editorTaskDocument(value, sequenceId)
          .document.assets.filter((asset) => asset.kind === "video")
          .map((asset) => asset.id),
        sources: EditorVideoSource[] = [];
      for (let index = 0; index < ids.length; index += EDITOR_TASK_LIMITS.proxiesPerTask) {
        const batch = ids.slice(index, index + EDITOR_TASK_LIMITS.proxiesPerTask),
          job = await waitOwned(
            await bridge.prepareVideo(snapshot, batch, options),
            snapshot,
            options,
          ),
          result = resultOf(job);
        if (
          result?.documentHash !== snapshot.documentHash ||
          result.sequenceId !== sequenceId ||
          !Array.isArray(result.sources) ||
          result.sources.length !== batch.length ||
          result.sources.some(
            (source: EditorVideoSource, i: number) =>
              source.assetId !== batch[i] ||
              !/^asset-[a-f0-9]{64}$/.test(source.proxy?.id) ||
              source.proxy.sha256 !== source.proxy.id.slice(6) ||
              !Number.isSafeInteger(source.proxy.bytes) ||
              source.proxy.bytes < 1 ||
              source.proxy.mimeType !== "video/mp4" ||
              !Number.isSafeInteger(source.recipe?.width) ||
              source.recipe.width < 1 ||
              !Number.isSafeInteger(source.recipe?.height) ||
              source.recipe.height < 1,
          )
        )
          throw new Error("已准备视频资源回执无效");
        sources.push(...result.sources);
      }
      return { snapshot, sources };
    },
    async prepareAudio(snapshot: EditorTaskSnapshot, options: { signal?: AbortSignal } = {}) {
      return snapshotRequest(snapshot, "prepare-audio", {}, options.signal);
    },
    async render(
      snapshot: EditorTaskSnapshot,
      profile: ExportProfile,
      options: {
        preparedAudio?: PreparedEditorAudio;
        signal?: AbortSignal;
        beforeSubmit?: () => void;
      } = {},
    ) {
      const prepared = options.preparedAudio;
      if (
        prepared &&
        (prepared.documentHash !== snapshot.documentHash ||
          prepared.sequenceId !== snapshot.sequenceId ||
          !/^asset-[a-f0-9]{64}$/.test(prepared.assetId) ||
          !/^[a-f0-9]{64}$/.test(prepared.recipeHash))
      )
        throw new Error("已准备的声音与当前工程快照不一致，请重新准备声音");
      return snapshotRequest(
        snapshot,
        "render",
        {
          profile: validateExportProfile(profile),
          ...(prepared ? { preparedAudio: prepared } : {}),
        },
        options.signal,
        options.beforeSubmit,
      );
    },
    /** Publish compatible video sources in bounded batches for the interactive preview as well. */
    async prepareVideo(
      snapshot: EditorTaskSnapshot,
      assetIds: string[],
      options: { signal?: AbortSignal } = {},
    ) {
      if (
        !Array.isArray(assetIds) ||
        assetIds.length < 1 ||
        assetIds.length > EDITOR_TASK_LIMITS.proxiesPerTask ||
        new Set(assetIds).size !== assetIds.length
      )
        throw new Error("每次最多准备 120 个不同视频素材");
      return snapshotRequest(snapshot, "prepare-video", { assetIds }, options.signal);
    },
    async status(snapshot: EditorTaskSnapshot, resourceIds: string[] = []) {
      if (resourceIds.length > EDITOR_TASK_LIMITS.resourcesPerTask)
        throw new Error("请分批读取素材准备状态");
      return complete(
        {
          action: "stage-status",
          transferId: transferId(snapshot.transferId),
          documentHash: snapshot.documentHash,
          resourceIds,
        },
        [],
        snapshot.workspaceKey,
      );
    },
    async discard(snapshot: EditorTaskSnapshot) {
      return snapshotRequest(snapshot, "discard");
    },
    async get(id: string) {
      return taskValue(await sdk.call("tasks.get", { id }));
    },
    wait: sdk.wait,
    cancel: sdk.cancel,
    retry: sdk.retry,
    result: resultOf,
    dispose() {
      disposed = true;
      sdk.dispose();
    },
  };
  return bridge;
}
