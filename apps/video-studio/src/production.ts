import { validateProject, type Asset, type AudioClip, type Project } from "./model";
import type { PanelBridge } from "./host";
import type { RuntimeJob } from "./sdk/panel-runtime";
import { canonicalRenderMediaJob } from "./editor/render-media-job";
import {
  canonicalVoiceoverReceipt,
  type CanonicalVoiceoverResult,
  type VoiceoverOrigin,
  type VoiceoverPublication,
} from "./editor/voiceover-publication";
import { audioEnhancementReceipt, type AudioEnhancementResult } from "./editor/audio-enhancement";

export type TranscriptionUnavailableReason =
  | "executable-missing"
  | "model-missing"
  | "executable-failed";
const TRANSCRIPTION_REASONS: readonly TranscriptionUnavailableReason[] = [
  "executable-missing",
  "model-missing",
  "executable-failed",
];
const TRANSCRIPTION_NEEDS: Record<TranscriptionUnavailableReason | "unknown", [string, string]> = {
  unknown: [
    "需要安装 openai-whisper（whisper 命令）并准备 base 模型 ~/.cache/whisper/base.pt",
    "安装后",
  ],
  "executable-missing": ["未找到 whisper 命令，需要安装 openai-whisper", "安装后"],
  "model-missing": ["缺少 base 模型 ~/.cache/whisper/base.pt", "准备好模型后"],
  "executable-failed": ["whisper 无法运行，请检查 openai-whisper 安装", "修复后"],
};
/**
 * User-facing readiness copy naming the missing piece when the native status reports it.
 * `next` says how the blocked flow continues; the default suits flows an SRT import unblocks.
 */
export function transcriptionSetupMessage(
  reason?: TranscriptionUnavailableReason,
  next = "或先导入 SRT",
): string {
  const [need, after] = TRANSCRIPTION_NEEDS[reason ?? "unknown"];
  return `本机语音转写未就绪：${need}。${after}点“重新检测”${next ? `，${next}` : ""}。`;
}
export const TRANSCRIPTION_SETUP_MESSAGE = transcriptionSetupMessage();
function transcriptionStatus(value: unknown): ProductionStatus["transcription"] {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const reason = TRANSCRIPTION_REASONS.find((item) => item === raw.reason);
  return {
    available: raw.available === true,
    ...(typeof raw.engine === "string" ? { engine: raw.engine } : {}),
    ...(raw.available !== true && reason ? { reason } : {}),
  };
}

export interface ProductionStatus {
  persistent: boolean;
  /** False until an explicit production action checks local native tools. */
  runtimeChecked?: boolean;
  ffmpeg: { available: boolean };
  transcription: {
    available: boolean;
    engine?: string;
    /** Present only when unavailable and the native status names the missing piece. */
    reason?: TranscriptionUnavailableReason;
  };
  hyperframes: { available: boolean; version?: string };
  tts?: { available: boolean; engine?: string; defaultVoiceId?: string; reason?: string };
}
export interface VoiceCatalog {
  available: boolean;
  engine?: string;
  defaultVoiceId?: string;
  reason?: string;
  voices: { id: string; name: string; language: string }[];
  defaultModelId?: string;
  models?: VoiceModel[];
}
export interface VoiceModel {
  installable?: boolean;
  mode?: string;
  state?: string;
  id: string;
  name: string;
  provider: string;
  available: boolean;
  reason?: string;
  voices: { id: string; name: string; language: string }[];
  defaultVoiceId?: string;
  maxTextLength?: number;
  supportsInstructions?: boolean;
  supportsVoiceCloning?: boolean;
}
export interface VoiceRequest {
  text: string;
  modelId?: string;
  instructions?: string;
  voiceId?: string;
  rate?: number;
  /** Project asset ID; converted to a managed media ID before crossing the Host bridge. */
  referenceAssetId?: string;
  referenceText?: string;
}
export interface VoicePreparation {
  modelId: string;
  referenceAssetId?: string;
  referenceText?: string;
  inFrame?: number;
  outFrame?: number;
  sampleText?: string;
}
/** Persist the user's selection separately from the editable film. Missing references remain actionable. */
export function validateVoicePreparation(value: unknown): VoicePreparation {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error("初始化声音配置无效");
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).some(
      (key) =>
        ![
          "modelId",
          "referenceAssetId",
          "referenceText",
          "inFrame",
          "outFrame",
          "sampleText",
        ].includes(key),
    ) ||
    typeof raw.modelId !== "string" ||
    !raw.modelId.trim() ||
    raw.modelId.length > 256 ||
    (raw.referenceAssetId !== undefined &&
      (typeof raw.referenceAssetId !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(raw.referenceAssetId))) ||
    (raw.referenceText !== undefined &&
      (typeof raw.referenceText !== "string" || Array.from(raw.referenceText).length > 1000)) ||
    (raw.sampleText !== undefined &&
      (typeof raw.sampleText !== "string" ||
        !raw.sampleText.trim() ||
        Array.from(raw.sampleText.trim()).length > 120)) ||
    (raw.inFrame !== undefined) !== (raw.outFrame !== undefined) ||
    (raw.inFrame !== undefined &&
      (!raw.referenceAssetId ||
        !Number.isSafeInteger(raw.inFrame) ||
        !Number.isSafeInteger(raw.outFrame) ||
        Number(raw.inFrame) < 0 ||
        Number(raw.outFrame) <= Number(raw.inFrame) ||
        Number(raw.outFrame) > 2592000))
  )
    throw new Error("初始化声音配置或参考区间无效");
  return structuredClone(raw) as unknown as VoicePreparation;
}
export interface AssetPublication {
  audioPlacement?: {
    clipId: string;
    assetId: string;
    startFrame: number;
    volume: number;
    replaceClip?: AudioClip;
  };
  enhancement?: { jobId: string; assetId: string; sourceMediaId: string; baseRevision: number };
  label?: string;
}
export interface ManagedAsset {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  createdAt: number;
}
export interface MediaJob {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  createdAt: number;
  updatedAt: number;
  attempt: number;
  progress?: { fraction?: number; stage?: string; message?: string };
  error?: { code: string; message: string; retryable: boolean };
  result?: unknown;
}
export interface PreparedMedia {
  assetId: string;
  inspection: {
    kind: "video" | "audio" | "image";
    durationSeconds: number | null;
    video?: { displayWidth: number; displayHeight: number; width: number; height: number };
    audio?: unknown;
  };
  proxy?: { asset: ManagedAsset };
  thumbnail?: { asset: ManagedAsset };
  silence?: unknown;
  scenes?: unknown;
  waveform?: unknown;
  transcription?: unknown;
}
export interface TranscriptSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
  words?: { start: number; end: number; text: string; probability?: number }[];
}
export interface AutoProduction {
  projectId: string;
  prompt: string;
  mode?: "produce" | "initialize" | "workflow" | "draft" | "narration";
  phase: "preparing" | "agent" | "waiting" | "done" | "failed";
  attempts: number;
  taskId?: string;
  requestToken?: string;
  message?: string;
  startedAt: number;
  runId?: string;
  preparationJobIds?: string[];
  voice?: VoicePreparation;
}
interface JobBinding {
  jobId?: string;
  createdAt?: number;
  projectId: string;
  purpose:
    | "import"
    | "prepare"
    | "transcribe"
    | "scene"
    | "render"
    | "tts"
    | "enhance"
    | "setup"
    | "reference";
  sourceRevision?: number;
  voiceoverOrigin?: VoiceoverOrigin;
  referenceRange?: [number, number];
  referenceResultId?: string;
  attachAudio?: boolean;
  startFrame?: number;
  replaceClip?: AudioClip;
  assetId?: string;
  consumed?: boolean;
}
interface ProductionDocument {
  schemaVersion: 1;
  bindings: Record<string, JobBinding>;
  auto: AutoProduction | null;
  renderSubmissions?: RenderSubmission[];
}
export interface RenderSubmissionReceipt {
  accepted: true;
  operationId: string;
  projectId: string;
  revision: number;
  status: "preparing" | "cancelling" | "submitted" | "failed" | "interrupted";
  createdAt: number;
  updatedAt: number;
  jobId?: string;
  error?: string;
}
interface RenderSubmission extends RenderSubmissionReceipt {
  requestToken: string;
}
export interface CanonicalRenderOptions {
  signal?: AbortSignal;
  assertCurrent?(): void;
}
export interface ProductionCallbacks {
  getProject(): Project;
  publishAssets(projectId: string, assets: Asset[], options?: AssetPublication): Promise<void>;
  /** Canonical editors receive the precise native receipt, never a 30 fps placement projection. */
  publishAudioEnhancement?(
    projectId: string,
    result: AudioEnhancementResult,
    context: {
      jobId: string;
      asset: Asset;
      baseRevision?: number;
    },
  ): Promise<void>;
  /** Return the real generic editor-runtime render job for the complete canonical document. */
  renderCanonical?(project: Project, options?: CanonicalRenderOptions): Promise<RuntimeJob>;
  captureVoiceoverOrigin?(): VoiceoverOrigin;
  publishVoiceover?(
    projectId: string,
    result: CanonicalVoiceoverResult,
    context: VoiceoverPublication,
  ): Promise<void>;
  inspectImportedAsset?(asset: ManagedAsset): Promise<PreparedMedia["inspection"]>;
  changed(): void;
}

/** Inspect an authorized original with the browser, without starting a native processor. */
export async function inspectImportedAsset(
  asset: ManagedAsset,
  isCurrent: () => boolean = () => true,
): Promise<PreparedMedia["inspection"]> {
  if (!/^(?:asset|external)-[a-f0-9]{64}$/.test(asset.id)) throw new Error("导入素材编号无效");
  const kind = asset.mimeType.startsWith("image/")
    ? "image"
    : asset.mimeType.startsWith("audio/")
      ? "audio"
      : asset.mimeType.startsWith("video/")
        ? "video"
        : undefined;
  if (!kind || typeof document === "undefined") throw new Error("浏览器无法直接预览此原片");
  const element = kind === "image" ? new Image() : document.createElement(kind);
  const media = element instanceof HTMLMediaElement ? element : undefined;
  if (media) media.preload = "auto";
  try {
    return await new Promise<PreparedMedia["inspection"]>((resolve, reject) => {
      let loaded = false,
        seekingEnd = false,
        settled = false;
      const listeners = ["load", "loadeddata", "durationchange", "seeked"];
      const finish = (value?: PreparedMedia["inspection"], error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(cancelCheck);
        for (const event of listeners) element.removeEventListener(event, inspect);
        element.removeEventListener("error", failed);
        error ? reject(error) : resolve(value!);
      };
      const failed = () => finish(undefined, new Error("浏览器无法直接预览此原片，可尝试预处理"));
      const inspect = (event: Event) => {
        if (!isCurrent()) return finish(undefined, new Error("工程已切换，原片待返回原工程恢复"));
        if (event.type === "load" || event.type === "loadeddata") loaded = true;
        if (!loaded) return;
        if (element instanceof HTMLImageElement) {
          if (!element.naturalWidth || !element.naturalHeight) return failed();
          finish({
            kind: "image",
            durationSeconds: null,
            video: {
              width: element.naturalWidth,
              height: element.naturalHeight,
              displayWidth: element.naturalWidth,
              displayHeight: element.naturalHeight,
            },
          });
          return;
        }
        const duration =
          Number.isFinite(element.duration) && element.duration > 0
            ? element.duration
            : event.type === "seeked" && element.currentTime > 0 && element.currentTime < 1e10
              ? element.currentTime
              : undefined;
        if (duration !== undefined) {
          finish({
            kind,
            durationSeconds: duration,
            ...(element instanceof HTMLVideoElement
              ? {
                  video: {
                    width: element.videoWidth,
                    height: element.videoHeight,
                    displayWidth: element.videoWidth,
                    displayHeight: element.videoHeight,
                  },
                }
              : {}),
          });
        } else if (!seekingEnd) {
          seekingEnd = true;
          // Recorded WebM can omit Duration; asking the decoder for its end recovers it.
          try {
            element.currentTime = 1e10;
          } catch {
            failed();
          }
        }
      };
      const timeout = setTimeout(
        () => finish(undefined, new Error("原片预览读取超时，可尝试预处理")),
        15000,
      );
      const cancelCheck = setInterval(() => {
        if (!isCurrent()) finish(undefined, new Error("工程已切换，原片待返回原工程恢复"));
      }, 100);
      for (const event of listeners) element.addEventListener(event, inspect);
      element.addEventListener("error", failed, { once: true });
      try {
        element.src = `/media/${encodeURIComponent(asset.id)}`;
      } catch {
        failed();
      }
    });
  } finally {
    media?.pause();
    element.removeAttribute("src");
    media?.load();
  }
}
const active = (job: MediaJob) => job.status === "queued" || job.status === "running";
export const mediaUrl = (id: string) => new URL(`/media/${id}`, location.href).href;
const emptyStatus = (): ProductionStatus => ({
  persistent: false,
  ffmpeg: { available: false },
  transcription: { available: false },
  hyperframes: { available: false },
});

function productionDocument(value: unknown): ProductionDocument {
  const bad = () => {
    throw new Error("制作任务记录无法恢复，已保留原数据");
  };
  const plain = (value: unknown): value is Record<string, unknown> =>
    Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    );
  const text = (value: unknown, max = 256): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= max;
  if (
    !plain(value) ||
    value.schemaVersion !== 1 ||
    !plain(value.bindings) ||
    Object.keys(value).some(
      (key) => !["schemaVersion", "bindings", "auto", "renderSubmissions"].includes(key),
    )
  )
    return bad();
  const bindings: Record<string, JobBinding> = {};
  if (value.renderSubmissions !== undefined) {
    if (!Array.isArray(value.renderSubmissions) || value.renderSubmissions.length > 100)
      return bad();
    const ids = new Set<string>();
    for (const item of value.renderSubmissions) {
      if (
        !plain(item) ||
        Object.keys(item).some(
          (key) =>
            ![
              "accepted",
              "operationId",
              "projectId",
              "revision",
              "status",
              "createdAt",
              "updatedAt",
              "jobId",
              "error",
              "requestToken",
            ].includes(key),
        ) ||
        item.accepted !== true ||
        !text(item.operationId, 128) ||
        !/^render-[a-f0-9-]{36}$/.test(item.operationId) ||
        ids.has(item.operationId) ||
        !text(item.projectId, 128) ||
        !text(item.requestToken, 256) ||
        ![item.revision, item.createdAt, item.updatedAt].every(
          (n) => Number.isSafeInteger(n) && Number(n) >= 0,
        ) ||
        Number(item.updatedAt) < Number(item.createdAt) ||
        !["preparing", "cancelling", "submitted", "failed", "interrupted"].includes(
          String(item.status),
        ) ||
        (item.status === "submitted" && !item.jobId) ||
        (item.jobId !== undefined &&
          (!text(item.jobId, 128) ||
            !/^(?:job-[a-zA-Z0-9-]+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(
              item.jobId,
            ))) ||
        (item.error !== undefined && !text(item.error, 2000))
      )
        return bad();
      ids.add(item.operationId);
    }
  }
  if (Object.keys(value.bindings).length > 4000) return bad();
  for (const [key, raw] of Object.entries(value.bindings)) {
    if (
      !plain(raw) ||
      Object.keys(raw).some(
        (key) =>
          ![
            "jobId",
            "createdAt",
            "projectId",
            "purpose",
            "assetId",
            "consumed",
            "attachAudio",
            "startFrame",
            "replaceClip",
            "sourceRevision",
            "voiceoverOrigin",
            "referenceRange",
            "referenceResultId",
          ].includes(key),
      )
    )
      return bad();
    if (raw.voiceoverOrigin !== undefined) {
      const origin = raw.voiceoverOrigin;
      if (
        raw.purpose !== "tts" ||
        !plain(origin) ||
        Object.keys(origin).some((key) => !["sequenceId", "revision"].includes(key)) ||
        !text(origin.sequenceId, 128) ||
        !Number.isSafeInteger(origin.revision) ||
        Number(origin.revision) < 0
      )
        return bad();
    }
    if (raw.replaceClip !== undefined) {
      const clip = raw.replaceClip;
      if (
        !plain(clip) ||
        Object.keys(clip).some(
          (key) => !["id", "assetId", "inFrame", "outFrame", "startFrame", "volume"].includes(key),
        ) ||
        !text(clip.id, 128) ||
        !text(clip.assetId, 128) ||
        ![clip.inFrame, clip.outFrame, clip.startFrame].every(
          (n) => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 2592000,
        ) ||
        Number(clip.outFrame) <= Number(clip.inFrame) ||
        typeof clip.volume !== "number" ||
        !Number.isFinite(clip.volume) ||
        clip.volume < 0 ||
        clip.volume > 2 ||
        raw.purpose !== "tts" ||
        raw.attachAudio !== true
      )
        return bad();
    }
    const jobId = raw.jobId ?? key;
    if (
      !text(jobId) ||
      !/^(?:job-[a-zA-Z0-9-]+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(
        jobId,
      ) ||
      !text(raw.projectId, 128) ||
      ![
        "import",
        "prepare",
        "transcribe",
        "scene",
        "render",
        "tts",
        "enhance",
        "setup",
        "reference",
      ].includes(raw.purpose as string) ||
      (raw.referenceRange !== undefined &&
        (raw.purpose !== "reference" ||
          !Array.isArray(raw.referenceRange) ||
          raw.referenceRange.length !== 2 ||
          !raw.referenceRange.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 2592000) ||
          raw.referenceRange[1] <= raw.referenceRange[0])) ||
      (raw.referenceResultId !== undefined &&
        (raw.purpose !== "reference" ||
          typeof raw.referenceResultId !== "string" ||
          !/^asset-[a-f0-9]{64}$/.test(raw.referenceResultId))) ||
      (raw.sourceRevision !== undefined &&
        (raw.purpose !== "enhance" ||
          !Number.isSafeInteger(raw.sourceRevision) ||
          Number(raw.sourceRevision) < 0)) ||
      (raw.consumed !== undefined && typeof raw.consumed !== "boolean") ||
      (raw.attachAudio !== undefined && typeof raw.attachAudio !== "boolean") ||
      (raw.startFrame !== undefined &&
        (!Number.isSafeInteger(raw.startFrame) ||
          Number(raw.startFrame) < 0 ||
          Number(raw.startFrame) > 2592000)) ||
      (raw.assetId !== undefined &&
        (typeof raw.assetId !== "string" ||
          !/^(?:asset|external)-[a-f0-9]{64}$/.test(raw.assetId))) ||
      (raw.createdAt !== undefined &&
        (!Number.isSafeInteger(raw.createdAt) || Number(raw.createdAt) < 0))
    )
      return bad();
    const bindingKey = `${jobId}:${raw.projectId}`;
    if (Object.hasOwn(bindings, bindingKey)) return bad();
    bindings[bindingKey] = { ...raw, jobId } as unknown as JobBinding;
  }
  const auto = value.auto;
  if (auto !== null) {
    if (
      !plain(auto) ||
      Object.keys(auto).some(
        (key) =>
          ![
            "projectId",
            "prompt",
            "phase",
            "attempts",
            "taskId",
            "requestToken",
            "message",
            "startedAt",
            "runId",
            "preparationJobIds",
            "mode",
            "voice",
          ].includes(key),
      ) ||
      !text(auto.projectId, 128) ||
      !text(auto.prompt, 16000) ||
      (auto.mode !== undefined &&
        !["produce", "initialize", "workflow", "draft", "narration"].includes(
          auto.mode as string,
        )) ||
      !["preparing", "agent", "waiting", "done", "failed"].includes(auto.phase as string) ||
      !Number.isSafeInteger(auto.attempts) ||
      Number(auto.attempts) < 0 ||
      Number(auto.attempts) > 3 ||
      !Number.isSafeInteger(auto.startedAt) ||
      Number(auto.startedAt) < 0 ||
      ["taskId", "requestToken", "runId"].some(
        (key) => auto[key] !== undefined && !text(auto[key]),
      ) ||
      (auto.message !== undefined &&
        (typeof auto.message !== "string" || auto.message.length > 4000)) ||
      (auto.preparationJobIds !== undefined &&
        (!Array.isArray(auto.preparationJobIds) ||
          auto.preparationJobIds.length > 1000 ||
          auto.preparationJobIds.some(
            (id) =>
              !text(id) ||
              !/^(?:job-[a-zA-Z0-9-]+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(
                id,
              ),
          )))
    )
      return bad();
    if (auto.voice !== undefined) {
      try {
        validateVoicePreparation(auto.voice);
      } catch {
        return bad();
      }
    }
  }
  return structuredClone({
    schemaVersion: 1,
    bindings,
    auto,
    ...(value.renderSubmissions === undefined
      ? {}
      : { renderSubmissions: value.renderSubmissions }),
  } as ProductionDocument);
}

/** Host jobs and durable intent live separately from the editable timeline. */
export class ProductionController {
  status = emptyStatus();
  jobs: MediaJob[] = [];
  preparations = new Map<string, PreparedMedia>();
  error = "";
  private document: ProductionDocument = { schemaVersion: 1, bindings: {}, auto: null };
  private documentRevision = 0;
  private writeQueue = Promise.resolve();
  private refreshQueue = Promise.resolve();
  private statusPending?: Promise<void>;
  private statusPendingFresh = false;
  private documentFailed = false;
  private disposed = false;
  private refreshScheduled = false;
  private assetRequests = new Map<string, number>();
  private consuming = new Set<JobBinding>();
  private renderControllers = new Map<string, AbortController>();
  private timer?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;
  constructor(
    private bridge: PanelBridge | undefined,
    private callbacks: ProductionCallbacks,
  ) {}
  get auto(): AutoProduction | null {
    return this.document.auto ? structuredClone(this.document.auto) : null;
  }
  get enabled(): boolean {
    return this.status.persistent;
  }
  get currentJobs(): MediaJob[] {
    const id = this.callbacks.getProject().id;
    return this.jobs.filter((j) => this.bindingFor(j.id, id));
  }
  private bindingFor(jobId: string, projectId: string): JobBinding | undefined {
    return this.document.bindings[`${jobId}:${projectId}`];
  }
  get pendingJobs(): MediaJob[] {
    return this.currentJobs.filter(active);
  }
  get renderSubmissions(): RenderSubmissionReceipt[] {
    return (this.document.renderSubmissions ?? [])
      .filter((item) => item.projectId === this.callbacks.getProject().id)
      .map(({ requestToken: _token, ...receipt }) => structuredClone(receipt));
  }
  get hasPendingRenderSubmission(): boolean {
    return this.renderSubmissions.some((item) => ["preparing", "cancelling"].includes(item.status));
  }
  /** Includes request admission, result publication and its durable consumption receipt. */
  get hasPendingAssetPublication(): boolean {
    const projectId = this.callbacks.getProject().id;
    const assetBinding = (binding: JobBinding) =>
      binding.projectId === projectId && ["import", "prepare"].includes(binding.purpose);
    if ((this.assetRequests.get(projectId) ?? 0) > 0 || [...this.consuming].some(assetBinding))
      return true;
    const jobs = new Map(this.jobs.map((job) => [job.id, job]));
    return Object.values(this.document.bindings).some((binding) => {
      if (!assetBinding(binding) || binding.consumed) return false;
      const job = jobs.get(binding.jobId!);
      return !job || active(job) || job.status === "succeeded";
    });
  }
  get latestExport(): ManagedAsset | undefined {
    const job = this.currentJobs.find((j) => j.type === "render" && j.status === "succeeded");
    return (job?.result as { video?: { asset?: ManagedAsset } } | undefined)?.video?.asset;
  }
  async initialize(): Promise<void> {
    if (!this.bridge) return;
    try {
      const status = (await this.bridge.call("media.status", { probe: false })) as ProductionStatus;
      if (!status?.persistent) {
        this.error = "当前 CodeShell 尚未提供持久媒体服务。请更新桌面应用后重新打开视频工作台。";
        return;
      }
      this.status = { ...status, transcription: transcriptionStatus(status.transcription) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.error = `媒体服务连接失败：${reason}。请检查当前项目的素材与本地工具权限，再重新打开面板；工程与原片保存不依赖制作引擎。`;
      return;
    }
    try {
      const saved = (await this.bridge.call("media.document.get", {
        key: "video-studio-production",
      })) as { revision: number; data: ProductionDocument | null };
      if (!Number.isSafeInteger(saved.revision) || saved.revision < 0)
        throw new Error("制作任务修订号无效，已保留原数据");
      this.documentRevision = saved.revision;
      if (saved.data !== null) {
        this.document = productionDocument(saved.data);
        for (const item of this.document.renderSubmissions ?? [])
          if (["preparing", "cancelling"].includes(item.status)) {
            item.status = "interrupted";
            item.error =
              "导出准备曾中断，未自动重复提交。请先检查已有后台任务，再发起新的制作请求。";
            item.updatedAt = Date.now();
          }
      }
    } catch (error) {
      this.documentFailed = true;
      this.error = String(error);
    }
    this.unsubscribe = this.bridge.on("media.job.changed", () => {
      void this.refresh().catch((error) => this.reportError(error));
    });
    this.timer = setInterval(() => {
      if (
        this.jobs.some(active) ||
        Object.values(this.document.bindings).some(
          (binding) => !binding.consumed && binding.projectId === this.callbacks.getProject().id,
        ) ||
        this.auto?.phase === "preparing" ||
        this.auto?.phase === "waiting"
      )
        void this.refresh().catch((error) => this.reportError(error));
    }, 4000);
  }
  dispose(): void {
    this.disposed = true;
    for (const controller of this.renderControllers.values()) controller.abort();
    clearInterval(this.timer);
    this.unsubscribe?.();
  }
  /** `fresh` skips the short status cache, e.g. after the user installs local tools. */
  async refreshStatus(options: { fresh?: boolean } = {}): Promise<void> {
    if (!this.enabled || this.disposed) return;
    // A fresh request runs after, not instead of, a probe that may predate the user's fix.
    if (this.statusPending && (!options.fresh || this.statusPendingFresh))
      return this.statusPending;
    const previous = this.statusPending;
    const current: Promise<void> = (async () => {
      await previous?.catch(() => {});
      const status = (await this.requireHost().call("media.status", {
        probe: true,
        ...(options.fresh ? { fresh: true } : {}),
      })) as ProductionStatus;
      if (!status?.persistent) throw new Error("当前 CodeShell 尚未提供持久媒体服务");
      this.status = {
        ...status,
        transcription: transcriptionStatus(status.transcription),
        runtimeChecked: true,
      };
      this.callbacks.changed();
    })().finally(() => {
      if (this.statusPending !== current) return;
      this.statusPending = undefined;
      this.statusPendingFresh = false;
    });
    this.statusPending = current;
    this.statusPendingFresh = options.fresh === true;
    await current;
  }
  private async ensureRuntime(): Promise<void> {
    if (this.status.runtimeChecked === false) await this.refreshStatus();
  }
  private requireHost(): PanelBridge {
    if (!this.bridge || !this.enabled) throw new Error("此功能需要新版 CodeShell 的持久媒体工作台");
    if (this.documentFailed) throw new Error(this.error || "制作记录恢复失败，已阻止覆盖");
    return this.bridge;
  }
  private reportError(error: unknown): void {
    this.error = error instanceof Error ? error.message : String(error);
    this.callbacks.changed();
  }
  private async persist(): Promise<void> {
    const snapshot = productionDocument(this.document);
    const operation = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const saved = (await this.requireHost().call("media.document.set", {
          key: "video-studio-production",
          baseRevision: this.documentRevision,
          data: snapshot,
          label: "制作任务进度",
        })) as { revision: number };
        this.documentRevision = saved.revision;
      });
    this.writeQueue = operation;
    await operation;
  }
  async setAuto(value: AutoProduction | null): Promise<void> {
    const previous = this.document.auto;
    const snapshot = value ? structuredClone(value) : null;
    this.document.auto = snapshot;
    try {
      await this.persist();
    } catch (error) {
      if (this.document.auto === snapshot) this.document.auto = previous;
      throw error;
    }
    this.callbacks.changed();
  }
  private async track(job: MediaJob, binding: JobBinding): Promise<MediaJob> {
    this.document.bindings[`${job.id}:${binding.projectId}`] = {
      ...binding,
      jobId: job.id,
      createdAt: job.createdAt,
    };
    // Keep unfinished work; completed bindings are bounded to protect metadata.
    const finished = Object.keys(this.document.bindings).filter(
      (id) => this.document.bindings[id]!.consumed,
    );
    for (const id of finished.slice(0, Math.max(0, finished.length - 160)))
      delete this.document.bindings[id];
    await this.persist();
    this.jobs = [job, ...this.jobs.filter((item) => item.id !== job.id)];
    this.callbacks.changed();
    this.scheduleRefresh();
    return job;
  }
  private scheduleRefresh(): void {
    if (this.refreshScheduled || this.disposed) return;
    this.refreshScheduled = true;
    queueMicrotask(() => {
      void this.refresh()
        .catch((error) => this.reportError(error))
        .finally(() => {
          this.refreshScheduled = false;
        });
    });
  }
  private beginAssetRequest(projectId: string): () => void {
    this.assetRequests.set(projectId, (this.assetRequests.get(projectId) ?? 0) + 1);
    return () => {
      const remaining = (this.assetRequests.get(projectId) ?? 1) - 1;
      if (remaining) this.assetRequests.set(projectId, remaining);
      else this.assetRequests.delete(projectId);
    };
  }
  async importFiles(): Promise<{ job?: MediaJob; cancelled?: boolean }> {
    const projectId = this.callbacks.getProject().id;
    const finish = this.beginAssetRequest(projectId);
    try {
      const result = (await this.requireHost().call("media.import", {})) as
        | MediaJob
        | { cancelled: true };
      if ("cancelled" in result) return result;
      return { job: await this.track(result, { projectId, purpose: "import" }) };
    } finally {
      finish();
    }
  }
  async importRecording(
    blob: Blob,
    name: string,
    progress?: (fraction: number) => void,
  ): Promise<Asset> {
    const host = this.requireHost(),
      projectId = this.callbacks.getProject().id;
    const upload = (await host.call("media.recording.begin", {
      mimeType: blob.type,
      name,
      expectedBytes: blob.size,
    })) as { sessionId: string; maxChunkBytes: number };
    try {
      let sequence = 0;
      for (let offset = 0; offset < blob.size; offset += upload.maxChunkBytes) {
        if (this.disposed || this.callbacks.getProject().id !== projectId)
          throw new Error("录制保存期间工程已切换");
        const bytes = new Uint8Array(
          await blob.slice(offset, offset + upload.maxChunkBytes).arrayBuffer(),
        );
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        await host.call("media.recording.write", {
          sessionId: upload.sessionId,
          sequence: sequence++,
          offset,
          dataBase64: btoa(binary),
        });
        progress?.(Math.min(1, (offset + bytes.length) / blob.size));
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const result = (await host.call("media.recording.finish", {
        sessionId: upload.sessionId,
      })) as { asset: ManagedAsset; inspection: PreparedMedia["inspection"] };
      if (this.disposed || this.callbacks.getProject().id !== projectId)
        throw new Error("录制已保存在媒体库，当前工程已切换");
      const asset = preparedAsset(
        result.asset,
        { assetId: result.asset.id, inspection: result.inspection },
        this.callbacks.getProject(),
      );
      await this.callbacks.publishAssets(projectId, [asset], { label: "保存录制原片" });
      // The original is already durable. A preparation failure must not make
      // the user upload that recording again or lose its stable identity.
      await this.prepare([asset.id]).catch((error) => this.reportError(error));
      return asset;
    } catch (error) {
      await host.call("media.recording.cancel", { sessionId: upload.sessionId }).catch(() => {});
      throw error;
    }
  }
  async setupTts(providerId: string): Promise<MediaJob> {
    const projectId = this.callbacks.getProject().id;
    const auto = this.auto;
    if (
      auto?.projectId === projectId &&
      auto.mode === "initialize" &&
      auto.phase === "agent" &&
      auto.voice &&
      providerId !== auto.voice.modelId
    )
      throw new Error("初始化只能准备用户选定的声音引擎");
    const job = (await this.requireHost().call("media.tts.setup", { providerId })) as MediaJob;
    return this.track(job, { projectId, purpose: "setup" });
  }
  async extractReference(assetId: string, inFrame: number, outFrame: number): Promise<MediaJob> {
    const project = this.callbacks.getProject();
    const source = project.assets.find((asset) => asset.id === assetId);
    if (!source?.mediaId || !["audio", "video"].includes(source.kind))
      throw new Error("请选择当前工程中已保存的音频或视频参考素材");
    if (
      !Number.isSafeInteger(inFrame) ||
      !Number.isSafeInteger(outFrame) ||
      inFrame < 0 ||
      outFrame <= inFrame ||
      outFrame > source.durationFrames
    )
      throw new Error("参考区间须为源素材内有效的整数帧");
    const seconds = (outFrame - inFrame) / project.fps;
    if (seconds < 3 || seconds > 30) throw new Error("请选择 3–30 秒的清晰人声作为参考");
    const selection = this.initializationVoice();
    if (
      selection &&
      (selection.referenceAssetId !== assetId ||
        selection.inFrame !== inFrame ||
        selection.outFrame !== outFrame)
    )
      throw new Error("初始化只能提取用户选定的参考录音区间");
    let job: MediaJob;
    try {
      job = (await this.requireHost().call("media.audio.extract", {
        assetId: source.mediaId,
        inFrame,
        outFrame,
        fps: 30,
      })) as MediaJob;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Unsupported media method: media.audio.extract")
        throw new Error(
          "当前桌面版本还不支持参考片段提取，请更新 CodeShell 桌面应用和视频面板后重试",
          { cause: error },
        );
      throw error;
    }
    return this.track(job, {
      projectId: project.id,
      purpose: "reference",
      assetId: source.mediaId,
      referenceRange: [inFrame, outFrame],
    });
  }
  private initializationVoice(): VoicePreparation | undefined {
    const auto = this.auto;
    if (
      auto?.projectId !== this.callbacks.getProject().id ||
      auto.mode !== "initialize" ||
      auto.phase !== "agent"
    )
      return undefined;
    if (!auto.voice) throw new Error("本次初始化未选择声音准备，请先选择声音配置");
    return auto.voice;
  }
  /** A separate bounded tool keeps initialization from generating full narration or placing tracks. */
  async prepareVoice(params: VoiceRequest): Promise<MediaJob> {
    if (typeof params.modelId !== "string" || !params.modelId.trim())
      throw new Error("请先选择试听模型");
    if (
      typeof params.text !== "string" ||
      !params.text.trim() ||
      Array.from(params.text.trim()).length > 120
    )
      throw new Error("声音准备只生成 1–120 字的短试听");
    const selection = this.initializationVoice();
    if (selection) {
      if (
        params.modelId !== selection.modelId ||
        (selection.sampleText && params.text.trim() !== selection.sampleText.trim())
      )
        throw new Error("初始化试听须使用用户选定的声音模型与试听文稿");
      if (["qwen3-tts", "audio8-tts"].includes(selection.modelId)) {
        const project = this.callbacks.getProject();
        const reference = project.assets.find((asset) => asset.id === params.referenceAssetId);
        const original = project.assets.find((asset) => asset.id === selection.referenceAssetId);
        const extracted =
          selection.inFrame !== undefined &&
          Object.values(this.document.bindings).some((binding) => {
            return (
              binding.projectId === project.id &&
              binding.purpose === "reference" &&
              binding.assetId === original?.mediaId &&
              binding.referenceRange?.[0] === selection.inFrame &&
              binding.referenceRange?.[1] === selection.outFrame &&
              binding.referenceResultId === reference?.mediaId
            );
          });
        if (
          !reference ||
          !(
            extracted ||
            (selection.inFrame === undefined && reference.id === selection.referenceAssetId)
          ) ||
          params.referenceText?.trim() !== selection.referenceText?.trim()
        )
          throw new Error("初始化试听只能使用用户选定的录音和实际逐字稿；选段须先提取成音频素材");
      }
    }
    return this.createVoiceover(params, { startFrame: 0, attach: false });
  }
  async enhanceAudio(
    assetId: string,
    settings: { preset?: "light" | "balanced"; denoise?: boolean; normalize?: boolean } = {},
    attach = true,
  ): Promise<MediaJob> {
    const current = this.callbacks.getProject();
    const projectId = current.id,
      sourceRevision = current.revision,
      managed = this.managedId(assetId);
    const job = (await this.requireHost().call("media.audio.enhance", {
      assetId: managed,
      ...settings,
    })) as MediaJob;
    return this.track(job, {
      projectId,
      purpose: "enhance",
      assetId: managed,
      ...(attach ? { sourceRevision } : {}),
    });
  }
  managedId(panelId: string): string {
    const asset = this.callbacks.getProject().assets.find((item) => item.id === panelId);
    if (!asset?.mediaId) throw new Error("素材尚未持久导入，请通过导入素材重新选择原文件");
    return asset.mediaId;
  }
  async prepare(assetIds: string[], transcribe = false): Promise<{ jobs: MediaJob[] }> {
    const projectId = this.callbacks.getProject().id;
    const ids = [...new Set(assetIds.map((id) => this.managedId(id)))];
    if (!ids.length) return { jobs: [] };
    const finish = this.beginAssetRequest(projectId);
    try {
      await this.ensureRuntime();
      if (transcribe && !this.status.transcription.available)
        throw new Error(transcriptionSetupMessage(this.status.transcription.reason));
      const result = (await this.requireHost().call("media.prepare", {
        assetIds: ids,
        transcribe,
      })) as { jobs: MediaJob[] };
      for (const [i, job] of result.jobs.entries())
        await this.track(job, { projectId, purpose: "prepare", assetId: ids[i] });
      return result;
    } finally {
      finish();
    }
  }
  async transcribe(assetIds: string[]): Promise<{ jobs: MediaJob[] }> {
    await this.ensureRuntime();
    if (!this.status.transcription.available)
      throw new Error(transcriptionSetupMessage(this.status.transcription.reason));
    const projectId = this.callbacks.getProject().id;
    const ids = [...new Set(assetIds.map((id) => this.managedId(id)))];
    const jobs: MediaJob[] = [];
    for (const id of ids) {
      const job = (await this.requireHost().call("media.transcribe", {
        assetId: id,
        language: "auto",
      })) as MediaJob;
      jobs.push(await this.track(job, { projectId, purpose: "transcribe", assetId: id }));
    }
    return { jobs };
  }
  async createScene(params: Record<string, unknown>): Promise<MediaJob> {
    await this.ensureRuntime();
    if (!this.status.hyperframes.available)
      throw new Error("HyperFrames 尚未就绪，请检查本机运行环境");
    const project = this.callbacks.getProject();
    const job = (await this.requireHost().call("media.scene", {
      params: { kind: "chapter", width: project.width, height: project.height, ...params },
    })) as MediaJob;
    return this.track(job, { projectId: project.id, purpose: "scene" });
  }
  async voices(): Promise<VoiceCatalog> {
    const result = (await this.requireHost().call("media.tts.voices", {})) as VoiceCatalog;
    if (!result || typeof result.available !== "boolean" || !Array.isArray(result.voices))
      throw new Error("音色列表无效，请更新 CodeShell 后重试");
    this.status.tts = {
      available: result.available,
      engine: result.engine,
      defaultVoiceId: result.defaultVoiceId,
      reason: result.reason,
    };
    return result;
  }
  async createVoiceover(
    params: VoiceRequest,
    placement?: { startFrame: number; attach: boolean; replaceClip?: AudioClip },
  ): Promise<MediaJob> {
    const host = this.requireHost();
    if (!this.status.tts?.available)
      throw new Error(this.status.tts?.reason || "本机文字配音尚未就绪");
    if (typeof params.text !== "string" || !params.text.trim() || params.text.length > 5000)
      throw new Error("请输入 1–5000 字的配音文稿");
    if (
      params.modelId !== undefined &&
      (typeof params.modelId !== "string" || !params.modelId.trim() || params.modelId.length > 256)
    )
      throw new Error("请选择有效的配音模型");
    if (
      params.instructions !== undefined &&
      (typeof params.instructions !== "string" || params.instructions.length > 2000)
    )
      throw new Error("配音风格说明不能超过 2000 字");
    if (
      params.rate !== undefined &&
      (!Number.isFinite(params.rate) || params.rate < 0.5 || params.rate > 2)
    )
      throw new Error("配音速度必须在 0.5 到 2 之间");
    if (
      placement &&
      (!Number.isSafeInteger(placement.startFrame) ||
        placement.startFrame < 0 ||
        placement.startFrame > 2592000)
    )
      throw new Error("配音位置无效");
    const currentProject = this.callbacks.getProject();
    const projectId = currentProject.id;
    const voiceoverOrigin = structuredClone(this.callbacks.captureVoiceoverOrigin?.());
    const placementBinding = placement
      ? { attachAudio: placement.attach, startFrame: placement.startFrame }
      : {};
    const replaceClip = placement?.replaceClip ? structuredClone(placement.replaceClip) : undefined;
    if (replaceClip) {
      const current = currentProject.audioClips?.find((clip) => clip.id === replaceClip.id);
      if (
        !placement?.attach ||
        !current ||
        !(["id", "assetId", "inFrame", "outFrame", "startFrame", "volume"] as const).every(
          (key) => current[key] === replaceClip[key],
        )
      )
        throw new Error("原配音已被调整，请重新选择后再生成");
    }
    let referenceAssetId: string | undefined;
    if (params.modelId === "qwen3-tts" || params.modelId === "audio8-tts") {
      if (params.voiceId !== undefined && params.voiceId !== "reference")
        throw new Error("本人声音克隆请使用参考录音音色");
      if (typeof params.referenceAssetId !== "string" || !params.referenceAssetId)
        throw new Error("请选择已保存的本人参考录音");
      const reference = currentProject.assets.find((asset) => asset.id === params.referenceAssetId);
      if (!reference || reference.kind !== "audio" || !reference.mediaId)
        throw new Error("参考录音须先保存到当前工程的素材库");
      const seconds = reference.durationFrames / currentProject.fps;
      if (seconds < 3 || seconds > 30) throw new Error("请录制或导入一段 3–30 秒的本人清晰录音");
      if (
        typeof params.referenceText !== "string" ||
        !params.referenceText.trim() ||
        Array.from(params.referenceText).length > 1000
      )
        throw new Error("请填写与参考录音一致的逐字稿，最多 1000 字");
      if (Array.from(params.text.trim()).length > 2000)
        throw new Error("本人声音配音每次最多 2000 字，请分段生成");
      referenceAssetId = reference.mediaId;
    } else if (params.referenceAssetId !== undefined || params.referenceText !== undefined) {
      throw new Error("只有本人声音克隆模型可以使用参考录音");
    }
    const job = (await host.call("media.tts", {
      ...params,
      text: params.text.trim(),
      ...(referenceAssetId
        ? { referenceAssetId, referenceText: params.referenceText!.trim() }
        : {}),
    })) as MediaJob;
    return this.track(job, {
      projectId,
      purpose: "tts",
      ...(voiceoverOrigin ? { voiceoverOrigin: structuredClone(voiceoverOrigin) } : {}),
      ...placementBinding,
      ...(replaceClip ? { replaceClip } : {}),
    });
  }
  /** Admission is small and immediate; a receipt is never presented as a native MediaJob. */
  startRender(project: Project, requestToken: string): RenderSubmissionReceipt {
    this.requireHost();
    if (typeof requestToken !== "string" || !requestToken || requestToken.length > 256)
      throw new Error("导出请求标识无效");
    const snapshot = validateProject(project),
      submissions = (this.document.renderSubmissions ??= []);
    const existing = submissions.find(
      (item) =>
        item.projectId === snapshot.id &&
        item.revision === snapshot.revision &&
        item.requestToken === requestToken,
    );
    if (existing)
      return this.renderSubmissions.find((item) => item.operationId === existing.operationId)!;
    while (submissions.length >= 100) {
      const index = submissions.findIndex(
        (item) =>
          ["failed", "interrupted"].includes(item.status) ||
          (item.status === "submitted" &&
            item.jobId &&
            this.bindingFor(item.jobId, item.projectId)),
      );
      if (index < 0) throw new Error("导出准备任务过多，请等待或取消已有准备后继续");
      submissions.splice(index, 1);
    }
    const auto = this.auto,
      controller = new AbortController(),
      now = Date.now();
    const item: RenderSubmission = {
      accepted: true,
      operationId: `render-${crypto.randomUUID()}`,
      projectId: snapshot.id,
      revision: snapshot.revision,
      requestToken,
      status: "preparing",
      createdAt: now,
      updatedAt: now,
    };
    const assertCurrent = () => {
      const current = this.callbacks.getProject(),
        latest = this.auto;
      if (this.disposed || controller.signal.aborted) throw new Error("导出准备已取消");
      if (current.id !== snapshot.id || current.revision !== snapshot.revision)
        throw new Error("导出准备期间工程已变化，请重新读取后导出");
      if (
        auto?.requestToken === requestToken &&
        (latest?.projectId !== auto.projectId ||
          latest?.runId !== auto.runId ||
          latest?.requestToken !== requestToken ||
          !["agent", "waiting"].includes(latest.phase))
      )
        throw new Error("原自动制作请求已结束或取消，未继续提交导出");
    };
    assertCurrent();
    submissions.push(item);
    this.renderControllers.set(item.operationId, controller);
    const receipt = this.renderSubmissions.find((value) => value.operationId === item.operationId)!;
    void (async () => {
      try {
        // Persist intent before any native preparation. A reload can never silently resubmit it.
        await this.persist();
        assertCurrent();
        const job = await this.render(snapshot, {
          signal: controller.signal,
          assertCurrent,
          onJob: (job) => {
            item.jobId = job.id;
            item.status = "submitted";
            item.updatedAt = Date.now();
          },
        });
        if (controller.signal.aborted)
          await this.requireHost().call("media.jobs.cancel", { id: job.id });
      } catch (error) {
        item.status = item.jobId ? "submitted" : "failed";
        item.error =
          (error instanceof Error ? error.message : String(error)).slice(0, 2000) || "导出准备失败";
        item.updatedAt = Date.now();
        if (item.jobId && controller.signal.aborted)
          await this.requireHost()
            .call("media.jobs.cancel", { id: item.jobId })
            .catch(() => {});
        await this.persist().catch(() => {});
        if (!this.disposed) this.reportError(error);
      } finally {
        this.renderControllers.delete(item.operationId);
        if (!this.disposed) {
          this.callbacks.changed();
          this.scheduleRefresh();
        }
      }
    })();
    this.callbacks.changed();
    return receipt;
  }
  async render(
    project: Project,
    options: CanonicalRenderOptions & { onJob?(job: MediaJob): void } = {},
  ): Promise<MediaJob> {
    const assertCurrent = () => {
      options.assertCurrent?.();
      if (options.signal?.aborted || this.disposed) throw new Error("导出准备已取消");
      const current = this.callbacks.getProject();
      if (current.id !== project.id || current.revision !== project.revision)
        throw new Error("工程已变化，请重新读取后导出");
    };
    assertCurrent();
    if (this.callbacks.renderCanonical) {
      const snapshot = validateProject(project);
      const job = canonicalRenderMediaJob(
        await this.callbacks.renderCanonical(snapshot, { signal: options.signal, assertCurrent }),
      );
      options.onJob?.(job);
      return this.track(job, { projectId: snapshot.id, purpose: "render" });
    }
    await this.ensureRuntime();
    assertCurrent();
    if (!this.status.ffmpeg.available) throw new Error("本机 FFmpeg 尚未就绪");
    const used = new Set([...project.clips, ...(project.audioClips ?? [])].map((c) => c.assetId));
    const sources: Record<string, string> = {};
    for (const id of used) {
      const asset = project.assets.find((a) => a.id === id)!;
      if (!asset.mediaId)
        throw new Error(`“${asset.name}”没有持久素材，示例或浏览器素材请使用 WebM 导出`);
      sources[id] = asset.mediaId;
    }
    const job = (await this.requireHost().call("media.render", {
      project: validateProject(project),
      sources,
    })) as MediaJob;
    options.onJob?.(job);
    return this.track(job, { projectId: project.id, purpose: "render" });
  }
  cancelRenderSubmissions(requestToken: string): void {
    for (const item of this.document.renderSubmissions ?? []) {
      if (item.requestToken !== requestToken || !["preparing", "cancelling"].includes(item.status))
        continue;
      const controller = this.renderControllers.get(item.operationId);
      if (controller) {
        item.status = "cancelling";
        item.updatedAt = Date.now();
        controller.abort();
      }
    }
    this.callbacks.changed();
  }
  async cancel(id: string): Promise<void> {
    const submission = this.document.renderSubmissions?.find(
      (item) => item.operationId === id && item.projectId === this.callbacks.getProject().id,
    );
    if (submission) {
      this.renderControllers.get(id)?.abort();
      if (submission.jobId) return this.cancel(submission.jobId);
      submission.status = this.renderControllers.has(id) ? "cancelling" : "interrupted";
      submission.error = "正在取消导出准备";
      submission.updatedAt = Date.now();
      await this.persist();
      this.callbacks.changed();
      return;
    }
    await this.requireHost().call("media.jobs.cancel", { id });
    await this.refresh();
  }
  async retry(id: string): Promise<MediaJob | undefined> {
    const retried = (await this.requireHost().call("media.jobs.retry", { id })) as
      | MediaJob
      | undefined;
    for (const [key, binding] of Object.entries(this.document.bindings)) {
      if (binding.jobId !== id) continue;
      binding.consumed = false;
      if (retried?.id && retried.id !== id) {
        delete this.document.bindings[key];
        this.document.bindings[`${retried.id}:${binding.projectId}`] = {
          ...binding,
          jobId: retried.id,
          createdAt: retried.createdAt,
        };
      }
    }
    await this.persist();
    await this.refresh();
    return retried;
  }
  async exportAsset(id: string): Promise<unknown> {
    return this.requireHost().call("media.export", { assetId: id });
  }
  async revealAsset(id: string): Promise<unknown> {
    return this.requireHost().call("media.reveal", { assetId: id });
  }
  async transcript(
    assetId: string,
    offset = 0,
    limit = 50,
  ): Promise<{ assetId: string; total: number; offset: number; segments: TranscriptSegment[] }> {
    const result = (await this.requireHost().call("media.transcript", {
      assetId: this.managedId(assetId),
      offset,
      limit,
    })) as { total: number; offset: number; segments: TranscriptSegment[] };
    return { ...result, assetId };
  }
  async analysis(assetId: string, kind: string, offset = 0, limit = 50): Promise<unknown> {
    return this.requireHost().call("media.analysis", {
      assetId: this.managedId(assetId),
      kind,
      offset,
      limit,
    });
  }
  async waitForJobs(
    jobIds?: string[],
  ): Promise<{ jobs: MediaJob[]; operations?: RenderSubmissionReceipt[] }> {
    if (
      jobIds?.some(
        (id) =>
          id.startsWith("render-") || this.renderSubmissions.some((item) => item.jobId === id),
      ) ||
      this.hasPendingRenderSubmission
    ) {
      const operations = this.renderSubmissions.filter(
        (item) =>
          !jobIds ||
          jobIds.includes(item.operationId) ||
          Boolean(item.jobId && jobIds.includes(item.jobId)),
      );
      if (
        jobIds?.some(
          (id) => id.startsWith("render-") && !operations.some((item) => item.operationId === id),
        )
      )
        throw new Error("导出受理记录不属于当前工程或不存在");
      const actualIds = new Set([
        ...(jobIds ?? []),
        ...operations.flatMap((item) => (item.jobId ? [item.jobId] : [])),
      ]);
      this.scheduleRefresh();
      return {
        jobs: this.currentJobs.filter((job) => !jobIds || actualIds.has(job.id)).slice(0, 50),
        operations: operations.slice(0, 50),
      };
    }
    await this.refresh();
    const selected = () =>
      jobIds ? this.jobs.filter((j) => jobIds.includes(j.id)) : this.currentJobs;
    const before = JSON.stringify(selected().map((j) => [j.id, j.status, j.updatedAt]));
    if (selected().some(active)) {
      for (let i = 0; i < 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        await this.refresh();
        if (JSON.stringify(selected().map((j) => [j.id, j.status, j.updatedAt])) !== before) break;
      }
    }
    return { jobs: selected().slice(0, 50) };
  }
  async refresh(): Promise<void> {
    if (!this.enabled || this.documentFailed || this.disposed) return;
    const operation = this.refreshQueue.catch(() => {}).then(() => this.refreshNow());
    this.refreshQueue = operation;
    return operation;
  }
  /** Re-publish the owned durable result; recovering a save never starts extraction again. */
  async recoverReference(jobId: string): Promise<void> {
    const host = this.requireHost();
    const projectId = this.callbacks.getProject().id;
    const operation = this.refreshQueue
      .catch(() => {})
      .then(async () => {
        const binding = this.bindingFor(jobId, projectId);
        if (!binding || binding.purpose !== "reference")
          throw new Error("这条录音提取任务不属于当前工程，未保存旧工程的结果。");
        const job = (await host.call("media.jobs.get", { id: jobId })) as MediaJob;
        if (job.id !== jobId || job.status !== "succeeded")
          throw new Error("录音提取尚未成功完成，请先刷新任务状态。");
        await this.publishReference(binding, job.result);
        await this.consume(binding);
        this.jobs = [job, ...this.jobs.filter((item) => item.id !== job.id)];
        this.callbacks.changed();
      });
    this.refreshQueue = operation;
    return operation;
  }
  private async publishReference(binding: JobBinding, value: unknown): Promise<void> {
    const project = this.callbacks.getProject();
    if (this.disposed || project.id !== binding.projectId)
      throw new Error("工程已切换，未保存旧工程的参考录音。");
    const result = value as Record<string, any> | undefined;
    const managed = result?.asset as ManagedAsset | undefined;
    if (
      !managed ||
      !/^asset-[a-f0-9]{64}$/.test(managed.id) ||
      !managed.mimeType?.startsWith("audio/") ||
      result?.inspection?.kind !== "audio" ||
      !Number.isFinite(result.inspection.durationSeconds) ||
      result.inspection.durationSeconds < 3 ||
      result.inspection.durationSeconds > 30 ||
      (binding.referenceResultId && binding.referenceResultId !== managed.id)
    )
      throw new Error("参考提取未返回有效且一致的 3–30 秒音频。");
    const preparation = { assetId: managed.id, inspection: result.inspection };
    const asset = preparedAsset(managed, preparation, project);
    this.preparations.set(managed.id, preparation);
    await this.callbacks.publishAssets(binding.projectId, [asset], { label: "保存声音参考选段" });
    if (this.disposed || this.callbacks.getProject().id !== binding.projectId)
      throw new Error("工程已切换，参考录音任务仍保留，可返回原工程恢复保存。");
    binding.referenceResultId = managed.id;
  }
  private async refreshNow(): Promise<void> {
    if (this.disposed) return;
    const host = this.requireHost();
    const list = (await host.call("media.jobs.list", { limit: 50 })) as { jobs: MediaJob[] };
    const projectId = this.callbacks.getProject().id;
    const bindings = Object.values(this.document.bindings).filter(
      (binding) => binding.projectId === projectId,
    );
    const latestRender = bindings
      .filter((binding) => binding.purpose === "render")
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
    const ids = new Set([
      ...list.jobs.map((j) => j.id),
      ...bindings.filter((binding) => !binding.consumed).map((binding) => binding.jobId!),
      ...(latestRender ? [latestRender.jobId!] : []),
    ]);
    const jobs: MediaJob[] = [];
    for (const id of ids) {
      const listed = list.jobs.find((j) => j.id === id);
      const old = this.jobs.find((j) => j.id === id);
      const binding = this.bindingFor(id, projectId);
      const unchanged =
        old &&
        listed &&
        old.status === listed.status &&
        old.attempt === listed.attempt &&
        old.updatedAt === listed.updatedAt;
      const needsResult =
        binding &&
        listed?.status === "succeeded" &&
        (!binding.consumed || binding.purpose === "render");
      if (!listed || (needsResult && (!unchanged || old.result === undefined))) {
        jobs.push((await host.call("media.jobs.get", { id })) as MediaJob);
      } else
        jobs.push({
          ...listed,
          ...(unchanged && old.result !== undefined ? { result: old.result } : {}),
        });
    }
    this.jobs = jobs.sort((a, b) => b.createdAt - a.createdAt);
    for (const job of this.jobs) {
      const binding = this.bindingFor(job.id, projectId);
      if (!binding || binding.consumed || binding.projectId !== this.callbacks.getProject().id)
        continue;
      if (job.status === "failed" || job.status === "cancelled") {
        if (
          binding.purpose === "prepare" &&
          this.callbacks.getProject().assets.some((asset) => asset.mediaId === binding.assetId)
        )
          this.error = `原片已保留在素材库，可直接剪辑。预处理${job.status === "cancelled" ? "已取消" : "失败"}${job.error?.message ? `：${job.error.message}` : ""}；可在任务页重试。`;
        await this.consume(binding);
        continue;
      }
      if (job.status !== "succeeded") continue;
      const result = job.result as Record<string, any>;
      if (binding.purpose === "import") {
        const assets = result.assets as ManagedAsset[];
        const current = () => !this.disposed && this.callbacks.getProject().id === projectId;
        for (const asset of assets) {
          if (!current()) break;
          if (this.callbacks.getProject().assets.some((source) => source.mediaId === asset.id))
            continue;
          let inspection: PreparedMedia["inspection"];
          try {
            inspection = await (this.callbacks.inspectImportedAsset
              ? this.callbacks.inspectImportedAsset(asset)
              : inspectImportedAsset(asset, current));
          } catch {
            // Formats the browser cannot decode can still use the existing native proxy path.
            continue;
          }
          if (!current()) break;
          await this.callbacks.publishAssets(
            projectId,
            [preparedAsset(asset, { assetId: asset.id, inspection }, this.callbacks.getProject())],
            { label: "原片已持久保存" },
          );
        }
        if (!current()) continue;
        const originalsSaved = assets.every((asset) =>
          this.callbacks.getProject().assets.some((source) => source.mediaId === asset.id),
        );
        const pending = assets.filter(
          (asset) =>
            !Object.values(this.document.bindings).some(
              (known) =>
                known.projectId === projectId &&
                known.purpose === "prepare" &&
                known.assetId === asset.id,
            ),
        );
        // Restore completed imports without creating new native tasks on entry.
        if (!originalsSaved && pending.length && this.status.runtimeChecked === false) continue;
        if (originalsSaved && !this.status.ffmpeg.available) {
          this.error =
            this.status.runtimeChecked === false
              ? "原片已保留在素材库，可直接剪辑。使用制作功能时再检查本地工具并准备代理和分析。"
              : "原片已保留在素材库，可直接剪辑。预处理工具尚未就绪，准备好后可继续生成代理和分析。";
        } else if (pending.length && this.status.runtimeChecked !== false) {
          let prepared: { jobs: MediaJob[] } | undefined;
          try {
            prepared = (await host.call("media.prepare", {
              assetIds: pending.map((asset) => asset.id),
              transcribe: false,
            })) as { jobs: MediaJob[] };
          } catch (error) {
            if (!originalsSaved) throw error;
            this.error = `原片已保留在素材库，可直接剪辑。预处理未能启动：${error instanceof Error ? error.message : String(error)}`;
          }
          for (const [i, child] of (prepared?.jobs ?? []).entries())
            await this.track(child, {
              projectId: binding.projectId,
              purpose: "prepare",
              assetId: pending[i]!.id,
            });
        }
      } else if (binding.purpose === "prepare") {
        const preparation = result as PreparedMedia;
        const fetched = (await host.call("media.assets.get", { id: preparation.assetId })) as {
          asset: ManagedAsset;
        };
        if (this.disposed || this.callbacks.getProject().id !== projectId) continue;
        this.preparations.set(preparation.assetId, preparation);
        await this.callbacks.publishAssets(projectId, [
          preparedAsset(fetched.asset, preparation, this.callbacks.getProject()),
        ]);
      } else if (binding.purpose === "scene") {
        const asset = result.asset as ManagedAsset;
        const previous = this.callbacks.getProject().assets.find((a) => a.mediaId === asset.id);
        await this.callbacks.publishAssets(projectId, [
          {
            id: previous?.id ?? asset.id,
            name: asset.name,
            kind: "video",
            mediaId: asset.id,
            size: asset.bytes,
            mimeType: asset.mimeType,
            durationFrames: Math.max(1, Math.round(result.durationSeconds * 30)),
            width: result.width,
            height: result.height,
            scene: {
              kind: "hyperframes",
              sourceHash: result.scene.contentHash,
              params: result.scene.params,
            },
          },
        ]);
      } else if (binding.purpose === "reference") {
        await this.publishReference(binding, result);
      } else if (binding.purpose === "enhance") {
        const managed = result.asset as ManagedAsset;
        const asset = preparedAsset(
          managed,
          { assetId: managed.id, inspection: result.inspection },
          this.callbacks.getProject(),
        );
        if (this.callbacks.publishAudioEnhancement) {
          await this.callbacks.publishAudioEnhancement(projectId, audioEnhancementReceipt(result), {
            jobId: job.id,
            asset,
            ...(binding.sourceRevision === undefined
              ? {}
              : { baseRevision: binding.sourceRevision }),
          });
        } else {
          await this.callbacks.publishAssets(projectId, [asset], {
            label: "原声优化完成",
            ...(binding.sourceRevision !== undefined && binding.assetId
              ? {
                  enhancement: {
                    jobId: job.id,
                    assetId: asset.id,
                    sourceMediaId: binding.assetId,
                    baseRevision: binding.sourceRevision,
                  },
                }
              : {}),
          });
        }
      } else if (binding.purpose === "setup") {
        this.status = (await host.call("media.status", {
          probe: this.status.runtimeChecked !== false,
        })) as ProductionStatus;
      } else if (binding.purpose === "tts") {
        const managed = result.asset as ManagedAsset;
        const previous = this.callbacks
          .getProject()
          .assets.find((asset) => asset.mediaId === managed.id);
        const asset: Asset = {
          id: previous?.id ?? managed.id,
          name: managed.name,
          kind: "audio",
          mediaId: managed.id,
          mimeType: managed.mimeType,
          size: managed.bytes,
          durationFrames: Math.max(1, Math.round(result.inspection.durationSeconds * 30)),
          speech: result.speech,
        };
        this.preparations.set(managed.id, {
          assetId: managed.id,
          inspection: result.inspection,
          transcription: { source: "synthesized-speech", text: result.speech.text },
        });
        if (this.callbacks.publishVoiceover) {
          await this.callbacks.publishVoiceover(projectId, canonicalVoiceoverReceipt(result), {
            jobId: job.id,
            ...(binding.voiceoverOrigin ? { origin: binding.voiceoverOrigin } : {}),
            ...(binding.attachAudio
              ? {
                  placement: {
                    startFrame: binding.startFrame ?? 0,
                    ...(binding.replaceClip ? { replaceClip: binding.replaceClip } : {}),
                  },
                }
              : {}),
          });
        } else
          await this.callbacks.publishAssets(projectId, [asset], {
            label: "文字配音完成",
            ...(binding.attachAudio
              ? {
                  audioPlacement: {
                    clipId: `voice-${job.id}`,
                    assetId: asset.id,
                    startFrame: binding.startFrame ?? 0,
                    volume: 1,
                    ...(binding.replaceClip ? { replaceClip: binding.replaceClip } : {}),
                  },
                }
              : {}),
          });
      } else if (binding.purpose === "transcribe" && binding.assetId) {
        const preparation = this.preparations.get(binding.assetId);
        if (preparation)
          this.preparations.set(binding.assetId, { ...preparation, transcription: result });
      }
      // Publish first. If decoding/save fails, an unconsumed durable job remains
      // available for retry; a completion can never silently lose its asset.
      await this.consume(binding);
    }
    this.callbacks.changed();
  }
  private async consume(binding: JobBinding): Promise<void> {
    this.consuming.add(binding);
    binding.consumed = true;
    try {
      await this.persist();
    } catch (error) {
      binding.consumed = false;
      throw error;
    } finally {
      this.consuming.delete(binding);
    }
  }
  async restorePreparation(project: Project): Promise<void> {
    if (!this.enabled) return;
    for (const asset of project.assets) {
      if (!asset.mediaId) continue;
      try {
        const value = (await this.requireHost().call("media.assets.get", {
          id: asset.mediaId,
          inspect: false,
        })) as { preparation?: PreparedMedia };
        if (value.preparation) this.preparations.set(asset.mediaId, value.preparation);
      } catch (error) {
        this.error = String(error);
      }
    }
  }
}

export function preparedAsset(
  managed: ManagedAsset,
  prepared: PreparedMedia,
  project: Project,
): Asset {
  const previous = project.assets.find((a) => a.mediaId === managed.id);
  const inspection = prepared.inspection;
  const video = inspection.video;
  return {
    ...previous,
    id: previous?.id ?? managed.id,
    name: previous?.name ?? managed.name,
    kind: inspection.kind,
    mediaId: managed.id,
    proxyId: prepared.proxy?.asset.id,
    thumbnailId: prepared.thumbnail?.asset.id,
    size: managed.bytes,
    mimeType: managed.mimeType,
    durationFrames:
      inspection.kind === "image"
        ? (previous?.durationFrames ?? 150)
        : Math.max(1, Math.round((inspection.durationSeconds ?? 5) * 30)),
    ...(video
      ? { width: video.displayWidth || video.width, height: video.displayHeight || video.height }
      : {}),
  };
}
