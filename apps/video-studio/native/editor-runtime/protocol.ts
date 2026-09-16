import { validateExportProfile } from "../../src/editor/export-settings.js";
import { EDITOR_TASK_LIMITS, type PreparedEditorAudio } from "../../src/editor/task-bridge.js";

export class EditorTaskError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "EditorTaskError";
  }
}
export interface EditorRequest {
  action:
    | "inspect-source"
    | "analyze-waveform"
    | "align-multicam"
    | "analyze-asset-waveform"
    | "prepare-source-video"
    | "stage-status"
    | "stage-resources"
    | "stage-document"
    | "commit"
    | "commit-project"
    | "export-project"
    | "import-project"
    | "project-import-status"
    | "publish-project-media"
    | "discard-project-import"
    | "prepare-audio"
    | "prepare-video"
    | "render"
    | "discard";
  transferId: string;
  sourceDuration?: number;
  alignment?: {
    referenceResourceId: string;
    windowSeconds: number;
    maxOffsetSeconds: number;
    sourceDurations: number[];
    sourceHashes?: Array<string | null>;
    origin?: {
      documentId: string;
      revision: number;
      documentHash: string;
      referenceAssetId: string;
      assets: Array<{ assetId: string; resourceId: string }>;
    };
  };
  bundleHash?: string;
  batchIndex?: number;
  documentHash?: string;
  sequenceId?: string;
  resourceIds?: string[];
  assetIds?: string[];
  chunkIndex?: number;
  chunkCount?: number;
  byteLength?: number;
  dataBase64?: string;
  profile?: ReturnType<typeof validateExportProfile>;
  preparedAudio?: PreparedEditorAudio;
}
export function record(value: unknown, keys: string[], label: string): Record<string, any> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.includes(key))
  )
    throw new EditorTaskError("INVALID_REQUEST", `${label}包含无效或不支持的字段`);
  return value as Record<string, any>;
}
export function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new EditorTaskError("INVALID_REQUEST", "内容校验编号无效");
  return value;
}
export function resourceId(value: unknown): string {
  if (typeof value !== "string" || !/^(?:asset|external)-[a-f0-9]{64}$/.test(value))
    throw new EditorTaskError("INVALID_REQUEST", "素材资源编号无效");
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    throw new EditorTaskError("INVALID_REQUEST", "请求数量或范围无效");
  return Number(value);
}
function id(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 128 || /[\x00-\x1f\x7f]/.test(value))
    throw new EditorTaskError("INVALID_REQUEST", "编辑器对象编号无效");
  return value;
}
function array(value: unknown, maximum: number, item: (value: unknown) => string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw new EditorTaskError("INVALID_REQUEST", "请求列表无效或超过上限");
  const list = value.map(item);
  if (new Set(list).size !== list.length)
    throw new EditorTaskError("INVALID_REQUEST", "请求列表存在重复项");
  return list;
}
export function validateEditorRequest(value: unknown): EditorRequest {
  const input = record(
    value,
    [
      "action",
      "transferId",
      "documentHash",
      "sequenceId",
      "resourceIds",
      "assetIds",
      "chunkIndex",
      "chunkCount",
      "byteLength",
      "dataBase64",
      "profile",
      "preparedAudio",
      "sourceDuration",
      "alignment",
      "bundleHash",
      "batchIndex",
    ],
    "编辑器任务",
  );
  const actions: Record<EditorRequest["action"], string[]> = {
    "inspect-source": ["resourceIds"],
    "analyze-waveform": ["resourceIds", "sourceDuration"],
    "align-multicam": ["resourceIds", "alignment"],
    "analyze-asset-waveform": ["documentHash", "sequenceId", "assetIds"],
    "prepare-source-video": ["resourceIds", "sourceDuration"],
    "stage-status": ["documentHash", "resourceIds"],
    "stage-resources": ["resourceIds"],
    "stage-document": ["documentHash", "chunkIndex", "chunkCount", "dataBase64"],
    commit: ["documentHash", "sequenceId", "chunkCount", "byteLength"],
    "commit-project": ["documentHash", "sequenceId", "chunkCount", "byteLength"],
    "export-project": ["documentHash", "sequenceId"],
    "import-project": ["resourceIds"],
    "project-import-status": ["bundleHash"],
    "publish-project-media": ["bundleHash", "batchIndex"],
    "discard-project-import": ["bundleHash"],
    "prepare-audio": ["documentHash", "sequenceId"],
    "prepare-video": ["documentHash", "sequenceId", "assetIds"],
    render: ["documentHash", "sequenceId", "profile", "preparedAudio"],
    discard: ["documentHash", "sequenceId"],
  };
  if (typeof input.action !== "string" || !Object.hasOwn(actions, input.action))
    throw new EditorTaskError("INVALID_REQUEST", "不支持此编辑器任务");
  const action = input.action as EditorRequest["action"];
  record(input, ["action", "transferId", ...actions[action]], "编辑器任务");
  if (typeof input.transferId !== "string" || !/^editor-[a-f0-9-]{36}$/.test(input.transferId))
    throw new EditorTaskError("INVALID_REQUEST", "编辑器传输编号无效");
  const result: EditorRequest = { action, transferId: input.transferId };
  if (actions[action].includes("bundleHash")) result.bundleHash = hash(input.bundleHash);
  if (action === "publish-project-media")
    result.batchIndex = integer(
      input.batchIndex,
      0,
      Math.ceil(EDITOR_TASK_LIMITS.snapshotResources / 120) - 1,
    );
  if (actions[action].includes("documentHash")) result.documentHash = hash(input.documentHash);
  if (actions[action].includes("sequenceId")) result.sequenceId = id(input.sequenceId);
  if (actions[action].includes("resourceIds"))
    result.resourceIds = array(input.resourceIds, EDITOR_TASK_LIMITS.resourcesPerTask, resourceId);
  if (
    ["inspect-source", "analyze-waveform", "prepare-source-video", "import-project"].includes(
      action,
    ) &&
    result.resourceIds!.length !== 1
  )
    throw new EditorTaskError("INVALID_REQUEST", "每个素材分析任务须提供一个资源");
  if (["analyze-waveform", "prepare-source-video"].includes(action))
    result.sourceDuration = integer(input.sourceDuration, 1, 86400 * 240000);
  if (action === "align-multicam") {
    const value = record(
      input.alignment,
      [
        "referenceResourceId",
        "windowSeconds",
        "maxOffsetSeconds",
        "sourceDurations",
        "sourceHashes",
        "origin",
      ],
      "机位同步参数",
    );
    if (result.resourceIds!.length < 2 || result.resourceIds!.length > 32)
      throw new EditorTaskError("INVALID_REQUEST", "机位同步需要 2 至 32 个资源");
    const referenceResourceId = resourceId(value.referenceResourceId),
      windowSeconds = integer(value.windowSeconds, 3, 180),
      maxOffsetSeconds = integer(value.maxOffsetSeconds, 0, 60);
    if (
      !result.resourceIds!.includes(referenceResourceId) ||
      maxOffsetSeconds >= windowSeconds - 2 ||
      !Array.isArray(value.sourceDurations) ||
      value.sourceDurations.length !== result.resourceIds!.length
    )
      throw new EditorTaskError("INVALID_REQUEST", "机位同步范围或基准无效");
    result.alignment = {
      referenceResourceId,
      windowSeconds,
      maxOffsetSeconds,
      sourceDurations: value.sourceDurations.map((duration: unknown) =>
        integer(duration, 1, 86400 * 240000),
      ),
    };
    if (value.sourceHashes !== undefined) {
      if (
        !Array.isArray(value.sourceHashes) ||
        value.sourceHashes.length !== result.resourceIds!.length
      )
        throw new EditorTaskError("INVALID_REQUEST", "素材指纹列表无效");
      result.alignment.sourceHashes = value.sourceHashes.map((value: unknown) =>
        value === null ? null : hash(value),
      );
    }
    if (value.origin !== undefined) {
      const origin = record(
        value.origin,
        ["documentId", "revision", "documentHash", "referenceAssetId", "assets"],
        "机位同步来源",
      );
      if (!Array.isArray(origin.assets) || origin.assets.length !== result.resourceIds!.length)
        throw new EditorTaskError("INVALID_REQUEST", "机位同步来源列表无效");
      const assets = origin.assets.map((raw: unknown, index: number) => {
        const asset = record(raw, ["assetId", "resourceId"], "机位素材映射");
        if (asset.resourceId !== result.resourceIds![index])
          throw new EditorTaskError("INVALID_REQUEST", "机位素材映射不匹配");
        return { assetId: id(asset.assetId), resourceId: resourceId(asset.resourceId) };
      });
      if (
        new Set(assets.map((asset: { assetId: string }) => asset.assetId)).size !== assets.length ||
        !assets.some(
          (asset: { assetId: string; resourceId: string }) =>
            asset.assetId === origin.referenceAssetId && asset.resourceId === referenceResourceId,
        )
      )
        throw new EditorTaskError("INVALID_REQUEST", "同步基准机位映射无效");
      result.alignment.origin = {
        documentId: id(origin.documentId),
        revision: integer(origin.revision, 0, Number.MAX_SAFE_INTEGER),
        documentHash: hash(origin.documentHash),
        referenceAssetId: id(origin.referenceAssetId),
        assets,
      };
    }
  }
  if (action === "stage-resources" && !result.resourceIds!.length)
    throw new EditorTaskError("INVALID_REQUEST", "请提供本批素材资源");
  if (["prepare-video", "analyze-asset-waveform"].includes(action)) {
    result.assetIds = array(input.assetIds, EDITOR_TASK_LIMITS.proxiesPerTask, id);
    if (action === "analyze-asset-waveform" && result.assetIds.length !== 1)
      throw new EditorTaskError("INVALID_REQUEST", "每次分析一个工程声音素材");
    if (!result.assetIds.length) throw new EditorTaskError("INVALID_REQUEST", "请提供视频素材");
  }
  if (action === "stage-document" || action === "commit" || action === "commit-project")
    result.chunkCount = integer(
      input.chunkCount,
      1,
      EDITOR_TASK_LIMITS.documentBytes / EDITOR_TASK_LIMITS.chunkBytes,
    );
  if (action === "stage-document") {
    result.chunkIndex = integer(input.chunkIndex, 0, result.chunkCount! - 1);
    if (
      typeof input.dataBase64 !== "string" ||
      input.dataBase64.length > Math.ceil(EDITOR_TASK_LIMITS.chunkBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.dataBase64) ||
      !input.dataBase64
    )
      throw new EditorTaskError("INVALID_REQUEST", "工程数据块无效或超过大小限制");
    result.dataBase64 = input.dataBase64;
  }
  if (action === "commit" || action === "commit-project")
    result.byteLength = integer(input.byteLength, 1, EDITOR_TASK_LIMITS.documentBytes);
  if (action === "render") {
    result.profile = validateExportProfile(input.profile);
    if (input.preparedAudio !== undefined) {
      const audio = record(
        input.preparedAudio,
        ["documentHash", "sequenceId", "recipeHash", "assetId"],
        "已准备声音",
      );
      result.preparedAudio = {
        documentHash: hash(audio.documentHash),
        sequenceId: id(audio.sequenceId),
        recipeHash: hash(audio.recipeHash),
        assetId: resourceId(audio.assetId),
      };
      if (
        !result.preparedAudio.assetId.startsWith("asset-") ||
        audio.documentHash !== result.documentHash ||
        audio.sequenceId !== result.sequenceId
      )
        throw new EditorTaskError("MIX_MISMATCH", "已准备声音与当前工程快照不一致");
    }
  }
  return result;
}
