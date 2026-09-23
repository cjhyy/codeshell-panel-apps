import {
  copyClips,
  pasteClips,
  groupClips,
  splitClip,
  trimClip,
  ungroupClips,
  type ClipClipboard,
} from "./clip-edits";
import { duplicateClipsInPlace, planCutClips } from "./clipboard-edits";
import { planMarkerEdit, type MarkerEditRequest } from "./marker-edits";
import { createExportSubmissions } from "./export-submissions";
import type { ExportProfile } from "./export-settings";
import {
  defaultTransform,
  defaultColorAdjustment,
  defaultAudioMix,
  defaultTextStyle,
} from "./defaults";
import { applyEditorOperations, type EditorOperation } from "./operations";
import type { EditorSession, SessionIdentity } from "./session";
import {
  planClipTiming,
  planMagneticMove,
  planMagneticRemove,
  planTimelineArrangement,
  planTransition,
} from "./timing-edits";
import type { EditorDocument } from "./types";
import type { SeparationController } from "./separation-controller";
import type { AudioEnhancementController } from "./audio-enhancement-controller";
import { validateAudioEnhancementSettings } from "./audio-enhancement";
import type { EditorSyncUI, EditorSyncRequest } from "./sync-ui";
import type { EditorPortableUI, EditorPortableRequest } from "./portable-ui";
import type { createEditorTaskBridge } from "./task-bridge";
import {
  planCreateCompound,
  planCreateSequence,
  planDuplicateSequence,
  planNestSequence,
  planRemoveSequence,
  planRenameSequence,
  planUnpackCompound,
  type SequenceIdFactory,
} from "./sequence-edits";
import {
  planAddCaptions,
  planCaptionStyle,
  planCaptionText,
  planCaptionTranslation,
  planDetachCaptions,
  planSrtImport,
  planTranscriptCaptions,
  validateCaptionTranscript,
} from "./captions";
import { planCaptionPreset } from "./caption-presets";
import {
  planCreateMulticam,
  planMulticamCut,
  planMulticamSwitches,
  planRecordMulticamSwitches,
  planUpdateMulticamAngles,
} from "./multicam-edits";

export const EDITOR_AGENT_LIMITS = Object.freeze({
  inputBytes: 256 * 1024,
  responseBytes: 48 * 1024,
  pageItems: 100,
  steps: 100,
  operations: 1000,
});
export interface EditorAgentAuthorization {
  kind: "edit" | "export";
  identity: SessionIdentity;
  before: EditorDocument;
  after?: EditorDocument;
  steps?: readonly Record<string, unknown>[];
  sequenceId?: string;
  /** The current automatic-production request this edit belongs to. Only timeline edits and
   * the clipboard accept one; without it the host applies its general automatic-work lock. */
  grant?: EditorAgentGrant;
}
export interface EditorAgentGrant {
  projectId: string;
  requestToken: string;
}
export interface EditorAgentContext {
  session(): EditorSession;
  /** Mandatory domain guard: current recording/automatic-work locks and approval invalidation.
   * Host-granted tool permission already authorizes the requested edit; no extra request token.
   * Returned coordinator-owned annotations join the same durable transaction. */
  authorize(
    request: EditorAgentAuthorization,
  ): void | EditorOperation[] | Promise<void | EditorOperation[]>;
  /** Synchronous recheck of the same request immediately before its durable save, so a run
   * stopped or replaced while the edit was being authorized cannot publish it. */
  assertStillAuthorized?(request: EditorAgentAuthorization): void;
  /** Aborts once the request's automatic run ends, so a save still waiting for storage is dropped. */
  requestSignal?(request: EditorAgentAuthorization): AbortSignal | undefined;
  exportSequence?(
    request: {
      identity: SessionIdentity;
      document: EditorDocument;
      sequenceId: string;
      profile: ExportProfile;
    },
    options?: { signal: AbortSignal },
  ): Promise<{ jobId: string }>;
  cancelExport?(jobId: string): Promise<unknown>;
  /** Uses the existing Host SDK task reader. Return a bounded page of task records/results. */
  readJobs?(request: { jobIds?: string[]; offset: number; limit: number }): Promise<unknown>;
  idFactory?: SequenceIdFactory;
  /** Shared controller; processing produces a candidate and only explicit apply edits the session. */
  separation?: SeparationController;
  enhancement?: AudioEnhancementController;
  sync?: Pick<EditorSyncUI, "getState" | "execute" | "inspectConflict">;
  portable?: Pick<EditorPortableUI, "getState" | "execute" | "readCandidate">;
  alignMulticam?: ReturnType<typeof createEditorTaskBridge>["startMulticamAlignment"];
  cancelAlignment?(jobId: string, documentId: string): Promise<unknown>;
}
const encoder = new TextEncoder();
const size = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
function json(value: unknown, max = EDITOR_AGENT_LIMITS.inputBytes): any {
  let count = 0;
  const parents = new Set<object>();
  const copy = (item: unknown, depth: number): any => {
    if (++count > 100000 || depth > 64) throw new Error("工具输入结构过大");
    if (item === null || typeof item === "boolean" || typeof item === "string") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (!item || typeof item !== "object" || parents.has(item))
      throw new Error("工具参数必须是有限 JSON 数据");
    const array = Array.isArray(item),
      prototype = Object.getPrototypeOf(item),
      keys = Reflect.ownKeys(item);
    if (
      array
        ? prototype !== Array.prototype || keys.length !== item.length + 1
        : prototype !== Object.prototype && prototype !== null
    )
      throw new Error("工具参数须为普通对象或完整数组");
    parents.add(item);
    const result: any = array ? [] : {};
    for (const key of keys) {
      if (array && key === "length") continue;
      if (
        typeof key !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(key) ||
        (array && !/^(0|[1-9]\d*)$/.test(key))
      )
        throw new Error("工具参数含不安全字段");
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!descriptor.enumerable || !("value" in descriptor))
        throw new Error("工具参数不能包含访问器");
      result[key] = copy(descriptor.value, depth + 1);
    }
    parents.delete(item);
    return result;
  };
  const result = copy(value, 0);
  if (size(result) > max) throw new Error(`工具输入超过 ${max} 字节，请拆分请求`);
  return result;
}
function object(value: any, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("工具参数必须是对象");
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new Error(`工具参数包含未知字段：${key}`);
  return value;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${label}须为 ${min} 至 ${max} 的整数`);
  return value;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value))
    throw new Error("标识符无效");
  return value;
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 2000)
    throw new Error("选择须包含 1 至 2000 个片段 ID");
  const result = value.map(id);
  if (new Set(result).size !== result.length) throw new Error("选择不能含重复 ID");
  return result;
}
function identity(value: unknown): SessionIdentity {
  const data = object(value, ["documentId", "generation", "revision"]);
  return {
    documentId: id(data.documentId),
    generation: integer(data.generation, 1, Number.MAX_SAFE_INTEGER, "会话代数"),
    revision: integer(data.revision, 0, Number.MAX_SAFE_INTEGER, "版本"),
  };
}
function grant(value: unknown): EditorAgentGrant | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("自动制作授权须为 {projectId, requestToken} 对象");
  const data = object(value, ["projectId", "requestToken"]);
  for (const key of ["projectId", "requestToken"])
    if (typeof data[key] !== "string" || !data[key] || data[key].length > 128)
      throw new Error("自动制作授权须包含当前 projectId 和 requestToken");
  return { projectId: data.projectId, requestToken: data.requestToken };
}
/** Sound processing, sync, packages, alignment and editor export stay outside automatic runs;
 * their export goes through the production render tool, which the run tracks to completion. */
function rejectGrant(value: unknown): void {
  if (value && typeof value === "object" && Object.hasOwn(value, "grant"))
    throw new Error("此功能在自动制作中不可用；自动制作中只能用授权进行时间线编辑与剪贴板操作");
}
function sameIdentity(
  session: EditorSession,
  expected: SessionIdentity,
  requireReady = true,
): void {
  const current = session.getState().identity;
  if (
    current.documentId !== expected.documentId ||
    current.generation !== expected.generation ||
    current.revision !== expected.revision
  )
    throw new Error("工程身份或版本已变化，请重新读取并重新规划，不能只替换版本号重放");
  if (requireReady && session.getState().phase !== "ready")
    throw new Error("工程正在保存、切换或关闭，请稍后重读");
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
const pointer = (base: string, key: string) =>
  `${base}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
/** Every omitted large value has an exact expansion path; no clip/word/keyframe is silently truncated. */
function readPage(
  root: unknown,
  pathValue: unknown,
  offsetValue: unknown,
  limitValue: unknown,
  format: unknown = "tree",
) {
  if (!["tree", "json"].includes(format as string)) throw new Error("读取格式无效");
  const path = pathValue ?? "";
  if (typeof path !== "string" || path.length > 4096 || (path && !path.startsWith("/")))
    throw new Error("path 须为工具返回的 JSON pointer");
  let value: any = root;
  for (const encoded of path ? path.slice(1).split("/") : []) {
    if (/~(?![01])/u.test(encoded)) throw new Error("JSON pointer 转义无效");
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (
      ["__proto__", "constructor", "prototype"].includes(key) ||
      !value ||
      typeof value !== "object" ||
      !Object.hasOwn(value, key) ||
      (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))
    )
      throw new Error("读取路径不存在或不安全");
    value = value[key];
  }
  if (format === "json") value = JSON.stringify(value);
  const offset = integer(offsetValue ?? 0, 0, Number.MAX_SAFE_INTEGER, "分页偏移"),
    limit = integer(limitValue ?? 20, 1, EDITOR_AGENT_LIMITS.pageItems, "分页数量");
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (typeof value === "string") {
    if (offset > value.length || (offset && /[\uDC00-\uDFFF]/.test(value[offset] ?? "")))
      throw new Error("字符串分页偏移越界或切断字符");
    let end = Math.min(value.length, offset + 4096);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
    return {
      path,
      type,
      unit: "utf16",
      offset,
      total: value.length,
      value: value.slice(offset, end),
      nextOffset: end < value.length ? end : null,
    };
  }
  if (!value || typeof value !== "object") {
    if (offset) throw new Error("标量没有此分页位置");
    return { path, type, value, nextOffset: null };
  }
  const keys = Object.keys(value);
  if (offset > keys.length) throw new Error("分页偏移超出范围");
  const entries: any[] = [];
  const budget =
    EDITOR_AGENT_LIMITS.responseBytes -
    4096 -
    size({ path, type, offset, total: keys.length, nextOffset: keys.length });
  let consumed = 0;
  for (const key of keys.slice(offset, offset + limit)) {
    const child = value[key],
      entryPath = pointer(path, key),
      bytes = size(child);
    let entry =
      entryPath.length > 4096 || size({ key, path: entryPath }) > budget / 2
        ? {
            index: offset + consumed,
            keyPreview: key.slice(0, 100),
            keyLength: key.length,
            expanded: false,
            readAs: "json",
          }
        : bytes < 16000
          ? { key, path: entryPath, value: child }
          : {
              key,
              path: entryPath,
              expanded: false,
              type: Array.isArray(child) ? "array" : typeof child,
              total: typeof child === "string" ? child.length : Object.keys(child).length,
            };
    if (size(entries) + size(entry) > budget) {
      if (entries.length) break;
      entry = { key, path: entryPath, expanded: false, type: typeof child, total: bytes };
    }
    entries.push(entry);
    consumed++;
  }
  return {
    path,
    type,
    offset,
    total: keys.length,
    entries,
    nextOffset: offset + consumed < keys.length ? offset + consumed : null,
  };
}
function rawOperations(value: unknown): EditorOperation[] {
  if (!Array.isArray(value) || !value.length || value.length > EDITOR_AGENT_LIMITS.operations)
    throw new Error("操作批次须包含 1 至 1000 项");
  for (const op of value) {
    if (!op || typeof op !== "object" || Array.isArray(op)) throw new Error("编辑操作必须是对象");
    if (["project.production", "asset.add", "asset.remove"].includes(op.type))
      throw new Error("制作审批与素材导入/删除须使用对应流程，不能由通用编辑工具重写");
    if (op.type === "asset.update") object(op.patch, ["name"]);
    if (
      op.type === "clip.update" &&
      ["text", "words", "translation"].some((key) => Object.hasOwn(op.patch ?? {}, key))
    )
      throw new Error("文字、词时间与翻译请使用字幕 planner，保留同一清理和来源规则");
    if (op.type === "track.update" && Object.hasOwn(op.patch ?? {}, "locked"))
      throw new Error("AI 编辑不能绕过轨道锁，请使用轨道锁定控件");
    if (
      op.type === "clip.update" &&
      [
        "start",
        "duration",
        "timeMap",
        "trackId",
        "groupId",
        "linkGroupId",
        "sourceBinding",
        "assetId",
        "sequenceId",
        "angles",
        "switches",
        "audioAngleId",
      ].some((key) => Object.hasOwn(op.patch ?? {}, key))
    )
      throw new Error("片段时间、来源、轨道或绑定编辑须使用同一时间线 planner");
    if (["clip.move", "clip.remove", "transition.add", "transition.remove"].includes(op.type))
      throw new Error("移动、删除、转场须使用 planner，保证磁吸与绑定规则一致");
    if (op.type === "sequence.update" && Object.hasOwn(op.patch ?? {}, "timelineMode"))
      throw new Error("时间线排列须使用 arrange planner");
  }
  return value as EditorOperation[];
}
function plan(
  document: EditorDocument,
  raw: Record<string, unknown>,
  factory: NonNullable<EditorAgentContext["idFactory"]>,
): EditorOperation[] {
  const kind = raw.kind;
  if (kind === "operations") return rawOperations(object(raw, ["kind", "operations"]).operations);
  if (kind === "sequence") return planSequenceStep(document, raw, factory);
  if (kind === "captions") return planCaptionsStep(document, raw, factory);
  if (kind === "multicam") return planMulticamStep(document, raw, factory);
  if (kind === "marker") {
    const step = object(raw, ["kind", "sequenceId", "action"]);
    return planMarkerEdit(document, id(step.sequenceId), step.action as MarkerEditRequest)
      .operations;
  }
  const keys: Record<string, string[]> = {
    split: ["clipId", "time"],
    trim: ["clipId", "localStart", "localEnd"],
    timing: ["clipIds", "action", "options"],
    move: ["clipIds", "options"],
    remove: ["clipIds"],
    transition: ["fromClipId", "toClipId", "options"],
    arrange: ["options"],
    group: ["clipIds"],
    ungroup: ["clipIds"],
    duplicate: ["clipIds"],
  };
  if (typeof kind !== "string" || !Object.hasOwn(keys, kind)) throw new Error("未知编辑 planner");
  const step = object(raw, ["kind", "sequenceId", ...keys[kind]!]),
    sequenceId = id(step.sequenceId);
  const tick = (value: unknown) => integer(value, 0, Number.MAX_SAFE_INTEGER, "时间刻度");
  if (kind === "split")
    return splitClip(document, sequenceId, id(step.clipId), tick(step.time), factory);
  if (kind === "trim")
    return trimClip(
      document,
      sequenceId,
      id(step.clipId),
      tick(step.localStart),
      tick(step.localEnd),
    );
  if (kind === "duplicate")
    return duplicateClipsInPlace(document, sequenceId, ids(step.clipIds), { idFactory: factory });
  if (kind === "group")
    return groupClips(document, sequenceId, ids(step.clipIds), factory("group"));
  if (kind === "ungroup") return ungroupClips(document, sequenceId, ids(step.clipIds));
  if (kind === "timing") {
    const action = object(step.action, [
      "kind",
      "rate",
      "preservePitch",
      "timeMap",
      "time",
      "duration",
    ]);
    const actionKeys: Record<string, string[]> = {
      speed: ["rate", "preservePitch"],
      map: ["timeMap"],
      reverse: [],
      freeze: ["time", "duration"],
      "keep-left": ["time"],
      "keep-right": ["time"],
    };
    if (!Object.hasOwn(actionKeys, action.kind)) throw new Error("未知时间编辑");
    object(action, ["kind", ...actionKeys[action.kind]!]);
    const options = object(step.options ?? {}, ["ripple", "removeTransitions", "detachCaptions"]);
    for (const value of Object.values(options))
      if (typeof value !== "boolean") throw new Error("时间编辑选项须为布尔值");
    if (action.preservePitch !== undefined && typeof action.preservePitch !== "boolean")
      throw new Error("preservePitch 须为布尔值");
    return planClipTiming(document, sequenceId, ids(step.clipIds), action as any, options);
  }
  const sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("序列不存在");
  if (kind === "move") {
    const options = object(step.options, ["delta", "trackId", "anchorClipId", "direction"]),
      selected = ids(step.clipIds);
    integer(options.delta, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "移动刻度");
    if (options.direction !== undefined && !["previous", "next"].includes(options.direction))
      throw new Error("移动方向无效");
    if (sequence.timelineMode === "magnetic")
      return planMagneticMove(document, sequenceId, selected, options as any);
    if (options.direction !== undefined)
      throw new Error("自由时间线请使用精确 delta，不能隐式磁吸重排");
    return [
      {
        type: "clip.move",
        sequenceId,
        clipIds: selected,
        delta: options.delta,
        ...(options.trackId === undefined ? {} : { trackId: id(options.trackId) }),
      },
    ];
  }
  if (kind === "remove") {
    if (sequence.timelineMode === "magnetic")
      return planMagneticRemove(document, sequenceId, ids(step.clipIds));
    const chosen = new Set(ids(step.clipIds));
    for (;;) {
      const previous = chosen.size,
        members = sequence.clips.filter((clip) => chosen.has(clip.id));
      const groups = new Set(members.map((clip) => clip.groupId).filter(Boolean)),
        links = new Set(members.map((clip) => clip.linkGroupId).filter(Boolean));
      for (const clip of sequence.clips)
        if (
          (clip.groupId && groups.has(clip.groupId)) ||
          (clip.linkGroupId && links.has(clip.linkGroupId))
        )
          chosen.add(clip.id);
      if (chosen.size === previous) break;
    }
    return [{ type: "clip.remove", sequenceId, clipIds: [...chosen] }];
  }
  if (kind === "transition") {
    const options = object(step.options, ["id", "kind", "duration", "placement", "remove"]);
    if (options.remove !== undefined && typeof options.remove !== "boolean")
      throw new Error("remove 须为布尔值");
    if (options.placement !== undefined && !["ripple", "overlap"].includes(options.placement))
      throw new Error("转场放置方式无效");
    return planTransition(
      document,
      sequenceId,
      id(step.fromClipId),
      id(step.toClipId),
      options as any,
    );
  }
  const options = object(step.options, ["mode", "trackId", "compact"]);
  if (options.compact !== undefined && typeof options.compact !== "boolean")
    throw new Error("compact 须为布尔值");
  return planTimelineArrangement(document, sequenceId, options as any);
}

function planMulticamStep(
  document: EditorDocument,
  raw: Record<string, unknown>,
  factory: SequenceIdFactory,
): EditorOperation[] {
  const step = object(raw, ["kind", "sequenceId", "action"]),
    sequenceId = id(step.sequenceId),
    action = object(step.action, [
      "kind",
      "clipId",
      "assetIds",
      "at",
      "name",
      "offsets",
      "audioAssetId",
      "trackId",
      "angles",
      "audioAngleId",
      "trimToCommonRange",
      "switches",
      "time",
      "angleId",
      "start",
      "end",
      "cuts",
    ]);
  const tick = (value: unknown) => integer(value, 0, Number.MAX_SAFE_INTEGER, "时间刻度");
  if (action.kind === "create") {
    object(action, ["kind", "assetIds", "at", "name", "offsets", "audioAssetId", "trackId"]);
    return planCreateMulticam(document, sequenceId, {
      assetIds: ids(action.assetIds),
      at: tick(action.at),
      name: action.name,
      ...(action.offsets === undefined
        ? {}
        : { offsets: object(action.offsets, Object.keys(action.offsets ?? {})) }),
      ...(action.audioAssetId === undefined ? {} : { audioAssetId: id(action.audioAssetId) }),
      ...(action.trackId === undefined ? {} : { trackId: id(action.trackId) }),
      idFactory: factory,
    });
  }
  const clipId = id(action.clipId);
  if (action.kind === "angles") {
    object(action, ["kind", "clipId", "angles", "audioAngleId", "trimToCommonRange"]);
    if (action.trimToCommonRange !== undefined && typeof action.trimToCommonRange !== "boolean")
      throw new Error("trimToCommonRange 须为布尔值");
    if (action.angles !== undefined) {
      if (!Array.isArray(action.angles)) throw new Error("机位须为数组");
      action.angles.forEach((angle: unknown) => object(angle, ["id", "name", "assetId", "offset"]));
    }
    return planUpdateMulticamAngles(
      document,
      sequenceId,
      clipId,
      {
        ...(action.angles === undefined ? {} : { angles: action.angles }),
        ...(action.audioAngleId === undefined ? {} : { audioAngleId: id(action.audioAngleId) }),
      },
      { trimToCommonRange: action.trimToCommonRange },
    );
  }
  if (action.kind === "cut") {
    object(action, ["kind", "clipId", "time", "angleId"]);
    return planMulticamCut(document, sequenceId, clipId, tick(action.time), id(action.angleId));
  }
  if (action.kind === "switches" || action.kind === "record") {
    object(
      action,
      action.kind === "switches"
        ? ["kind", "clipId", "switches"]
        : ["kind", "clipId", "start", "end", "cuts"],
    );
    const cuts = action.kind === "switches" ? action.switches : action.cuts;
    if (!Array.isArray(cuts) || !cuts.length || cuts.length > 2000)
      throw new Error("切点须包含 1 至 2000 项");
    for (const cut of cuts) object(cut, ["time", "angleId"]);
    return action.kind === "switches"
      ? planMulticamSwitches(document, sequenceId, clipId, cuts)
      : planRecordMulticamSwitches(
          document,
          sequenceId,
          clipId,
          tick(action.start),
          tick(action.end),
          cuts,
        );
  }
  throw new Error("未知多机位编辑");
}

function planSequenceStep(
  document: EditorDocument,
  raw: Record<string, unknown>,
  factory: SequenceIdFactory,
): EditorOperation[] {
  const step = object(raw, ["kind", "sequenceId", "action"]),
    action = object(step.action, [
      "kind",
      "name",
      "width",
      "height",
      "frameRate",
      "background",
      "activate",
      "childSequenceId",
      "at",
      "trackId",
      "clipIds",
      "clipId",
    ]);
  if (action.activate !== undefined && typeof action.activate !== "boolean")
    throw new Error("activate 须为布尔值");
  if (action.kind === "create") {
    if (step.sequenceId !== undefined) throw new Error("新建序列不能指定既有 sequenceId");
    object(action, ["kind", "name", "width", "height", "frameRate", "background", "activate"]);
    object(action.frameRate, ["numerator", "denominator"]);
    return planCreateSequence(document, {
      name: action.name,
      width: action.width,
      height: action.height,
      frameRate: action.frameRate,
      background: action.background,
      activate: action.activate,
      idFactory: factory,
    }).operations;
  }
  const sequenceId = id(step.sequenceId);
  switch (action.kind) {
    case "rename":
      object(action, ["kind", "name"]);
      return planRenameSequence(document, sequenceId, action.name).operations;
    case "duplicate":
      object(action, ["kind", "name", "activate"]);
      return planDuplicateSequence(document, sequenceId, {
        name: action.name,
        activate: action.activate,
        idFactory: factory,
      }).operations;
    case "nest":
      object(action, ["kind", "childSequenceId", "at", "trackId"]);
      return planNestSequence(document, sequenceId, id(action.childSequenceId), {
        at: integer(action.at, 0, Number.MAX_SAFE_INTEGER, "嵌套起点"),
        ...(action.trackId === undefined ? {} : { trackId: id(action.trackId) }),
        idFactory: factory,
      }).operations;
    case "compound":
      object(action, ["kind", "clipIds", "name"]);
      return planCreateCompound(document, sequenceId, ids(action.clipIds), {
        name: action.name,
        idFactory: factory,
      }).operations;
    case "unpack":
      object(action, ["kind", "clipId"]);
      return planUnpackCompound(document, sequenceId, id(action.clipId), {
        idFactory: factory,
      }).operations;
    case "remove":
      object(action, ["kind"]);
      return planRemoveSequence(document, sequenceId).operations;
    default:
      throw new Error("未知序列编辑");
  }
}

function planCaptionsStep(
  document: EditorDocument,
  raw: Record<string, unknown>,
  factory: SequenceIdFactory,
): EditorOperation[] {
  const step = object(raw, ["kind", "sequenceId", "action"]),
    sequenceId = id(step.sequenceId),
    action = object(step.action, [
      "kind",
      "text",
      "trackId",
      "clipId",
      "clipIds",
      "patch",
      "language",
      "mode",
      "translations",
      "transcripts",
      "assetIds",
      "wordHighlight",
      "preset",
      "start",
      "end",
    ]);
  switch (action.kind) {
    case "add":
      object(action, ["kind", "text", "start", "end", "trackId"]);
      return planAddCaptions(
        document,
        sequenceId,
        [
          {
            text: action.text as string,
            start: action.start as number,
            end: action.end as number,
            ...(action.trackId === undefined ? {} : { trackId: id(action.trackId) }),
          },
        ],
        { idFactory: () => factory("clip") },
      );
    case "import-srt":
      object(action, ["kind", "text", "trackId"]);
      return planSrtImport(document, sequenceId, action.text, {
        ...(action.trackId === undefined ? {} : { trackId: id(action.trackId) }),
        idFactory: () => factory("clip"),
      }).operations;
    case "from-transcripts": {
      object(action, ["kind", "transcripts", "trackId", "assetIds", "wordHighlight"]);
      if (action.wordHighlight !== undefined && typeof action.wordHighlight !== "boolean")
        throw new Error("wordHighlight 须为布尔值");
      if (
        !Array.isArray(action.transcripts) ||
        !action.transcripts.length ||
        action.transcripts.length > 2000
      )
        throw new Error("请选择真实转写来源");
      const transcripts = new Map();
      for (const value of action.transcripts) {
        const item = object(value, ["assetId", "segments"]),
          assetId = id(item.assetId);
        if (transcripts.has(assetId)) throw new Error("转写来源不能重复");
        if (!document.assets.some((asset) => asset.id === assetId))
          throw new Error("转写素材不存在");
        if (!Array.isArray(item.segments)) throw new Error("转写段落须为数组");
        for (const segment of item.segments) {
          object(segment, ["id", "start", "end", "text", "words"]);
          if (segment.words !== undefined) {
            if (!Array.isArray(segment.words)) throw new Error("转写词须为数组");
            for (const word of segment.words) object(word, ["text", "start", "end", "probability"]);
          }
        }
        transcripts.set(assetId, validateCaptionTranscript(item.segments));
      }
      return planTranscriptCaptions(document, sequenceId, transcripts, {
        ...(action.trackId === undefined ? {} : { trackId: id(action.trackId) }),
        ...(action.assetIds === undefined ? {} : { assetIds: ids(action.assetIds) }),
        wordHighlight: action.wordHighlight,
        idFactory: () => factory("clip"),
      }).operations;
    }
    case "text":
      object(action, ["kind", "clipId", "text"]);
      return planCaptionText(document, sequenceId, id(action.clipId), action.text);
    case "style":
      object(action, ["kind", "clipIds", "patch"]);
      return planCaptionStyle(
        document,
        sequenceId,
        ids(action.clipIds),
        object(action.patch, [...Object.keys(defaultTextStyle()), "keywords"]),
      );
    case "translate":
      object(action, ["kind", "clipIds", "language", "mode", "translations"]);
      if (!Array.isArray(action.translations)) throw new Error("译文须为数组");
      for (const translation of action.translations) object(translation, ["id", "text"]);
      return planCaptionTranslation(
        document,
        sequenceId,
        ids(action.clipIds),
        action.language,
        action.mode,
        action.translations,
      ).operations;
    case "detach":
      object(action, ["kind", "clipIds"]);
      return planDetachCaptions(document, sequenceId, ids(action.clipIds));
    case "preset":
      object(action, ["kind", "preset"]);
      return planCaptionPreset(document, sequenceId, action.preset);
    default:
      throw new Error("未知字幕编辑");
  }
}

/**
 * Compile planner steps (the apply_editor_edit step schema) into one operation list.
 * Each step is planned against the draft left by the previous steps, so later steps
 * see earlier ripples; the result is checked as one transaction on the input document.
 */
export function compileEditorSteps(
  document: EditorDocument,
  steps: unknown,
  factory: SequenceIdFactory,
): EditorOperation[] {
  if (!Array.isArray(steps) || !steps.length || steps.length > EDITOR_AGENT_LIMITS.steps)
    throw new Error("编辑须包含 1 至 100 个步骤");
  let draft = document;
  const operations: EditorOperation[] = [];
  for (const raw of json(steps)) {
    const batch = plan(draft, object(raw, Object.keys(raw ?? {})), factory);
    if (operations.length + batch.length > EDITOR_AGENT_LIMITS.operations)
      throw new Error("展开后的编辑超过 1000 项，请拆分范围");
    draft = applyEditorOperations(draft, batch, draft.revision);
    operations.push(...batch);
  }
  return operations;
}

export function createEditorAgentTools(context: EditorAgentContext) {
  if (typeof context.authorize !== "function") throw new Error("v2 工具必须连接制作与录制权限检查");
  const factory = context.idFactory ?? ((kind) => `${kind}-${crypto.randomUUID()}`);
  const exportSubmissions = createExportSubmissions();
  const current = (expected?: unknown) => {
    const session = context.session(),
      found = session.getState().identity;
    sameIdentity(session, expected === undefined ? found : identity(expected), false);
    return { session, identity: found, document: session.read() };
  };
  const recheck = (snapshot: ReturnType<typeof current>) => {
    if (context.session() !== snapshot.session) throw new Error("活动编辑会话已切换，请重新读取");
    sameIdentity(snapshot.session, snapshot.identity);
  };
  let clipboard:
    | { id: string; session: EditorSession; generation: number; payload: ClipClipboard }
    | undefined;
  const clipboardWorkflow = async (value: unknown) => {
    const args = object(json(value), ["identity", "clipboard", "grant"]),
      automatic = grant(args.grant),
      snapshot = current(identity(args.identity)),
      request = object(args.clipboard, [
        "action",
        "sequenceId",
        "clipIds",
        "clipboardId",
        "at",
        "trackId",
      ]);
    recheck(snapshot);
    if (
      clipboard &&
      (clipboard.session !== snapshot.session ||
        clipboard.generation !== snapshot.identity.generation)
    )
      clipboard = undefined;
    if (!["copy", "cut", "paste"].includes(request.action)) throw new Error("未知剪贴板动作");
    object(
      request,
      request.action === "paste"
        ? ["action", "sequenceId", "clipboardId", "at", "trackId"]
        : ["action", "sequenceId", "clipIds"],
    );
    const sequenceId = id(request.sequenceId);
    let operations: EditorOperation[] = [],
      next: typeof clipboard;
    if (request.action === "paste") {
      if (!clipboard || id(request.clipboardId) !== clipboard.id)
        throw new Error("剪贴板已变化或工程已切换，请重新复制");
      operations = pasteClips(snapshot.document, sequenceId, clipboard.payload, {
        at: integer(request.at, 0, Number.MAX_SAFE_INTEGER, "粘贴起点"),
        ...(request.trackId === undefined ? {} : { trackId: id(request.trackId) }),
        idFactory: factory,
      });
    } else {
      const selected = ids(request.clipIds),
        cut =
          request.action === "cut"
            ? planCutClips(snapshot.document, sequenceId, selected)
            : undefined,
        payload = cut?.payload ?? copyClips(snapshot.document, sequenceId, selected);
      operations = cut?.operations ?? [];
      next = {
        id: `clipboard-${crypto.randomUUID()}`,
        session: snapshot.session,
        generation: snapshot.identity.generation,
        payload,
      };
    }
    if (operations.length) {
      if (operations.length > EDITOR_AGENT_LIMITS.operations)
        throw new Error("展开后的编辑超过 1000 项，请拆分范围");
      const after = applyEditorOperations(
          snapshot.document,
          operations,
          snapshot.identity.revision,
        ),
        authorization = frozen<EditorAgentAuthorization>({
          kind: "edit",
          identity: snapshot.identity,
          before: structuredClone(snapshot.document),
          after,
          ...(automatic ? { grant: automatic } : {}),
        }),
        annotations = await context.authorize(authorization);
      recheck(snapshot);
      if (annotations) {
        if (
          !Array.isArray(annotations) ||
          annotations.length > 10 ||
          annotations.some((op) => op.type !== "project.production")
        )
          throw new Error("审批协调器只能补充制作状态");
        operations.push(...annotations);
      }
      context.assertStillAuthorized?.(authorization);
      await snapshot.session.dispatchDurable(
        operations,
        snapshot.identity,
        request.action === "cut" ? "剪切片段" : "粘贴片段",
        "agent",
        context.requestSignal?.(authorization),
      );
    }
    if (next) clipboard = next;
    const added = operations.flatMap((op) =>
      op.type === "clip.add" ? [{ sequenceId: op.sequenceId, clipId: op.clip.id }] : [],
    );
    return {
      identity: snapshot.session.getState().identity,
      applied: operations.length > 0,
      clipboard: {
        clipboardId: clipboard!.id,
        sequenceId: clipboard!.payload.sequenceId,
        clipCount: clipboard!.payload.document.sequences.find(
          (item) => item.id === clipboard!.payload.sequenceId,
        )!.clips.length,
      },
      addedClipIds: added.slice(0, 100),
      addedClipCount: added.length,
      addedClipIdsComplete: added.length <= 100,
    };
  };
  const audioWorkflow = async (value: unknown, domain: "separation" | "enhancement") => {
    const args = object(json(value), ["identity", domain]),
      snapshot = current(identity(args.identity)),
      request = object(args[domain], [
        "action",
        "sequenceId",
        "clipId",
        "jobId",
        "mode",
        "offset",
        "settings",
      ]),
      controller = domain === "separation" ? context.separation : context.enhancement;
    if (!controller) throw new Error("当前环境尚未连接声音处理器");
    const keys: Record<string, string[]> = {
      status: [],
      refresh: [],
      ...(domain === "separation" ? { setup: [] } : {}),
      start: ["sequenceId", "clipId", ...(domain === "enhancement" ? ["settings"] : [])],
      resume: ["sequenceId", "clipId", "jobId"],
      retry: ["sequenceId", "clipId", "jobId"],
      jobs: ["sequenceId", "clipId", "offset"],
      apply: domain === "separation" ? ["mode"] : [],
      cancel: ["jobId"],
    };
    if (typeof request.action !== "string" || !Object.hasOwn(keys, request.action))
      throw new Error("未知声音处理动作");
    object(request, ["action", ...keys[request.action]!]);
    const result = (data: unknown) => ({
      identity: snapshot.session.getState().identity,
      // Controller state uses optional undefined fields; the transport omits them.
      [domain]: json(JSON.parse(JSON.stringify(data)), EDITOR_AGENT_LIMITS.responseBytes - 1024),
    });
    if (request.action === "status") return result(controller.getState());
    if (request.action === "jobs") {
      const jobs = await controller.jobs(
        id(request.sequenceId),
        id(request.clipId),
        integer(request.offset ?? 0, 0, 100000, "任务偏移"),
      );
      recheck(snapshot);
      return result(jobs);
    }
    recheck(snapshot);
    const annotations = await context.authorize(
      frozen({
        kind: "edit",
        identity: snapshot.identity,
        before: structuredClone(snapshot.document),
      }),
    );
    if (annotations?.length) throw new Error("处理前仍需保存制作状态，请重新读取工程");
    recheck(snapshot);
    if (request.action === "apply") {
      if (domain === "separation") {
        if (!["vocals", "instrumental", "both"].includes(request.mode))
          throw new Error("请选择人声、伴奏或两者");
        await context.separation!.apply(request.mode);
      } else await context.enhancement!.apply();
      return result(controller.getState());
    }
    if (request.action === "cancel") {
      if (id(request.jobId) !== controller.getState().taskId)
        throw new Error("当前观察的任务已变化，请重新读取处理状态");
      if (!controller.cancel()) throw new Error("保存中的应用不能取消");
      return result(controller.getState());
    }
    const accepted =
      request.action === "setup"
        ? await context.separation!.installInBackground()
        : request.action === "refresh"
          ? await controller.refreshInBackground()
          : request.action === "start"
            ? domain === "separation"
              ? await context.separation!.startInBackground(
                  id(request.sequenceId),
                  id(request.clipId),
                )
              : await context.enhancement!.startInBackground(
                  id(request.sequenceId),
                  id(request.clipId),
                  validateAudioEnhancementSettings(request.settings),
                )
            : await controller.resumeInBackground(
                id(request.sequenceId),
                id(request.clipId),
                id(request.jobId),
                request.action === "retry",
              );
    return result({ ...accepted, status: "submitted", state: controller.getState() });
  };
  const portable = async (value: unknown) => {
    const args = object(json(value), ["identity", "portable"]),
      snapshot = current(identity(args.identity)),
      request = object(args.portable, [
        "action",
        "requestId",
        "resourceId",
        "pendingId",
        "path",
        "offset",
        "limit",
        "format",
      ]);
    if (!context.portable) throw new Error("当前环境尚未连接工程包交付");
    recheck(snapshot);
    if (request.action === "status") {
      object(request, ["action"]);
      return {
        identity: snapshot.identity,
        portable: json(context.portable.getState(), EDITOR_AGENT_LIMITS.responseBytes - 1024),
      };
    }
    if (request.action === "inspect") {
      object(request, ["action", "pendingId", "path", "offset", "limit", "format"]);
      return {
        identity: snapshot.identity,
        pendingId: id(request.pendingId),
        page: readPage(
          context.portable.readCandidate(id(request.pendingId)),
          request.path,
          request.offset,
          request.limit,
          request.format,
        ),
      };
    }
    object(request, ["action", "requestId", "resourceId", "pendingId"]);
    await context.authorize(
      frozen({
        kind: "edit",
        identity: snapshot.identity,
        before: structuredClone(snapshot.document),
      }),
    );
    recheck(snapshot);
    return {
      identity: snapshot.identity,
      portable: context.portable.execute(request as EditorPortableRequest, snapshot.identity),
    };
  };
  const sync = async (value: unknown) => {
    const args = object(json(value), ["identity", "sync"]),
      snapshot = current(identity(args.identity)),
      request = object(args.sync, [
        "action",
        "requestId",
        "snapshotId",
        "conflictKey",
        "choice",
        "operationId",
        "offset",
        "limit",
        "reviewId",
        "expectedReviewId",
        "side",
        "expectedApplyId",
      ]);
    if (!context.sync) throw new Error("当前环境尚未连接工程同步");
    if (request.action === "inspect") {
      object(request, ["action", "expectedReviewId", "conflictKey", "side", "offset", "limit"]);
      const { action: _action, ...inspection } = request;
      const result = await context.sync.inspectConflict(
        inspection as Parameters<EditorSyncUI["inspectConflict"]>[0],
        snapshot.identity,
      );
      recheck(snapshot);
      return {
        identity: snapshot.identity,
        sync: json(result, EDITOR_AGENT_LIMITS.responseBytes - 1024),
      };
    }
    if (request.action === "status") {
      object(request, ["action", "offset", "limit"]);
      const state = context.sync.getState({
        offset: integer(request.offset ?? 0, 0, 100000, "状态偏移"),
        limit: integer(request.limit ?? 20, 1, 50, "状态页大小"),
      });
      return {
        identity: snapshot.identity,
        sync: json(JSON.parse(JSON.stringify(state)), EDITOR_AGENT_LIMITS.responseBytes - 1024),
      };
    }
    recheck(snapshot);
    await context.authorize(
      frozen({
        kind: "edit",
        identity: snapshot.identity,
        before: structuredClone(snapshot.document),
      }),
    );
    recheck(snapshot);
    return {
      identity: snapshot.identity,
      sync: context.sync.execute(request as EditorSyncRequest, snapshot.identity),
    };
  };
  const align = async (value: unknown) => {
    const args = object(json(value), ["identity", "alignment"]),
      snapshot = current(identity(args.identity)),
      request = object(args.alignment, [
        "action",
        "requestId",
        "assetIds",
        "referenceAssetId",
        "windowSeconds",
        "maxOffsetSeconds",
        "jobId",
      ]);
    if (!["start", "cancel"].includes(request.action)) throw new Error("未知机位声音对齐动作");
    object(
      request,
      request.action === "cancel"
        ? ["action", "jobId"]
        : [
            "action",
            "requestId",
            "assetIds",
            "referenceAssetId",
            "windowSeconds",
            "maxOffsetSeconds",
          ],
    );
    recheck(snapshot);
    await context.authorize(
      frozen({
        kind: "edit",
        identity: snapshot.identity,
        before: structuredClone(snapshot.document),
      }),
    );
    recheck(snapshot);
    if (request.action === "cancel") {
      if (!context.cancelAlignment) throw new Error("当前环境未连接对齐任务取消");
      const status = await context.cancelAlignment(id(request.jobId), snapshot.identity.documentId);
      return {
        identity: snapshot.identity,
        alignment: {
          cancellationRequested: true,
          job: json(JSON.parse(JSON.stringify(status)), EDITOR_AGENT_LIMITS.responseBytes - 1024),
        },
      };
    }
    if (!context.alignMulticam) throw new Error("当前环境未连接真实声音对齐");
    const result = await context.alignMulticam(
      snapshot.document,
      ids(request.assetIds),
      id(request.referenceAssetId),
      {
        transferId: id(request.requestId),
        windowSeconds: integer(request.windowSeconds ?? 30, 3, 180, "分析秒数"),
        maxOffsetSeconds: integer(request.maxOffsetSeconds ?? 10, 0, 60, "最大偏移秒数"),
      },
    );
    return { identity: snapshot.identity, alignment: { ...result, status: "submitted" } };
  };
  const tools = {
    read_editor_project(value: unknown = {}) {
      const args = object(json(value), ["identity", "view", "path", "offset", "limit", "format"]),
        snapshot = current(args.identity),
        state = snapshot.session.getState();
      if (args.view !== undefined && !["document", "defaults"].includes(args.view))
        throw new Error("读取视图无效");
      const root =
        args.view === "defaults"
          ? {
              transform: defaultTransform(),
              color: defaultColorAdjustment(),
              audio: defaultAudioMix(),
              textStyle: defaultTextStyle(),
            }
          : snapshot.document;
      return {
        identity: snapshot.identity,
        timebase: 240000,
        schemaVersion: 2,
        state: {
          phase: state.phase,
          saveState: state.saveState,
          dirty: state.dirty,
          canUndo: state.canUndo,
          canRedo: state.canRedo,
        },
        page: readPage(root, args.path, args.offset, args.limit, args.format),
      };
    },
    async apply_editor_edit(value: unknown) {
      if (value && typeof value === "object" && Object.hasOwn(value, "clipboard"))
        return clipboardWorkflow(value);
      if (
        value &&
        typeof value === "object" &&
        ["separation", "enhancement", "sync", "portable", "alignment"].some((key) =>
          Object.hasOwn(value, key),
        )
      )
        rejectGrant(value);
      if (value && typeof value === "object" && Object.hasOwn(value, "separation"))
        return audioWorkflow(value, "separation");
      if (value && typeof value === "object" && Object.hasOwn(value, "enhancement"))
        return audioWorkflow(value, "enhancement");
      if (value && typeof value === "object" && Object.hasOwn(value, "sync")) return sync(value);
      if (value && typeof value === "object" && Object.hasOwn(value, "portable"))
        return portable(value);
      if (value && typeof value === "object" && Object.hasOwn(value, "alignment"))
        return align(value);
      const args = object(json(value), ["identity", "label", "steps", "grant"]),
        automatic = grant(args.grant),
        snapshot = current(identity(args.identity));
      recheck(snapshot);
      if (typeof args.label !== "string" || !args.label.trim() || args.label.length > 200)
        throw new Error("编辑说明须为 1 至 200 个字符");
      const operations = compileEditorSteps(snapshot.document, args.steps, factory);
      const after = applyEditorOperations(
        snapshot.document,
        operations,
        snapshot.identity.revision,
      );
      const authorization = frozen<EditorAgentAuthorization>({
        kind: "edit",
        identity: snapshot.identity,
        before: structuredClone(snapshot.document),
        after,
        steps: args.steps,
        ...(automatic ? { grant: automatic } : {}),
      });
      const annotations = await context.authorize(authorization);
      recheck(snapshot);
      if (annotations) {
        if (!Array.isArray(annotations) || annotations.length > 10)
          throw new Error("审批协调器返回的制作状态无效");
        for (const op of annotations)
          if (op.type !== "project.production") throw new Error("审批协调器只能补充制作状态");
        operations.push(...annotations);
      }
      context.assertStillAuthorized?.(authorization);
      const result = await snapshot.session.dispatchDurable(
        operations,
        snapshot.identity,
        args.label,
        "agent",
        context.requestSignal?.(authorization),
      );
      const addedClipIds = result.sequences.flatMap((seq) =>
        seq.clips
          .filter(
            (clip) =>
              !snapshot.document.sequences.some(
                (old) => old.id === seq.id && old.clips.some((item) => item.id === clip.id),
              ),
          )
          .map((clip) => ({ sequenceId: seq.id, clipId: clip.id })),
      );
      return {
        applied: result.revision !== snapshot.identity.revision,
        identity: snapshot.session.getState().identity,
        operationCount: operations.length,
        addedClipIds: addedClipIds.slice(0, EDITOR_AGENT_LIMITS.pageItems),
        addedClipCount: addedClipIds.length,
        addedClipIdsComplete: addedClipIds.length <= EDITOR_AGENT_LIMITS.pageItems,
      };
    },
    async render_editor_sequence(value: unknown) {
      rejectGrant(value);
      const args = object(json(value), [
          "identity",
          "sequenceId",
          "profileId",
          "requestId",
          "action",
          "operationId",
        ]),
        snapshot = current(identity(args.identity));
      if (args.action === "cancel") {
        object(args, ["identity", "action", "operationId"]);
        return exportSubmissions.cancel(id(args.operationId), snapshot.identity);
      }
      object(args, ["identity", "sequenceId", "profileId", "requestId"]);
      recheck(snapshot);
      const sequenceId = id(args.sequenceId),
        profileId = id(args.profileId);
      if (!snapshot.document.sequences.some((seq) => seq.id === sequenceId))
        throw new Error("导出序列不存在");
      const profile = snapshot.document.exportProfiles.find((item) => item.id === profileId);
      if (!profile) throw new Error("导出预设不存在，请读取 exportProfiles");
      if (!context.exportSequence) throw new Error("当前环境没有连接新版后台导出");
      const request = frozen({
        kind: "export" as const,
        identity: snapshot.identity,
        before: snapshot.document,
        sequenceId,
      });
      const authorize = async () => {
        const updates = await context.authorize(request);
        if (updates?.length) throw new Error("导出前仍需更新制作审批，请先完成相关编辑");
        recheck(snapshot);
      };
      await authorize();
      await snapshot.session.flush();
      recheck(snapshot);
      await authorize();
      const requestId = args.requestId === undefined ? undefined : id(args.requestId);
      return exportSubmissions.accept(
        {
          identity: snapshot.identity,
          sequenceId,
          profileId,
          ...(requestId ? { requestId } : {}),
        },
        (signal) => {
          recheck(snapshot);
          return context.exportSequence!(
            frozen({
              identity: snapshot.identity,
              document: snapshot.document,
              sequenceId,
              profile,
            }),
            { signal },
          );
        },
        context.cancelExport,
      );
    },
    async read_editor_jobs(value: unknown = {}) {
      const args = object(json(value), [
        "jobIds",
        "offset",
        "limit",
        "path",
        "pageOffset",
        "format",
      ]);
      const submissions = exportSubmissions.list();
      if (
        typeof args.path === "string" &&
        (args.path === "/submissions" || args.path.startsWith("/submissions/"))
      )
        return { page: readPage({ submissions }, args.path, args.pageOffset, 50, args.format) };
      if (!context.readJobs) throw new Error("当前环境没有连接后台任务读取");
      const jobIds = args.jobIds === undefined ? undefined : ids(args.jobIds);
      if (jobIds && jobIds.length > 50) throw new Error("单次最多查询 50 个任务");
      const result = await context.readJobs({
        ...(jobIds ? { jobIds } : {}),
        offset: integer(args.offset ?? 0, 0, 100000, "任务偏移"),
        limit: integer(args.limit ?? 20, 1, 50, "任务数量"),
      });
      return {
        page: readPage(
          { ...json(result, 16 * 1024 * 1024), submissions },
          args.path,
          args.pageOffset,
          50,
          args.format,
        ),
      };
    },
  };
  return tools;
}
