import { parseProposal } from "../host";
import { compileEditorSteps } from "./agent-tools";
import { legacyOperationLabel, translateLegacyOperations } from "./legacy-plan";
import { applyEditorOperations, type EditorOperation } from "./operations";
import type { SequenceIdFactory } from "./sequence-edits";
import type { SessionIdentity } from "./session";
import { snapToFrame, TICKS_PER_SECOND } from "./time";
import type { EditorClip, EditorDocument, EditorSequence } from "./types";
import { sequenceDuration } from "./validation";

/** Where a reviewed plan came from. Automatic production keeps its own apply path. */
export type ProposalOrigin = "local" | "import" | "agent" | "automatic";
/** A plan compiled against one exact editor document version, waiting for the user. */
export interface EditorProposal {
  title: string;
  explanation: string;
  origin: ProposalOrigin;
  identity: SessionIdentity;
  sequenceId: string;
  labels: string[];
  operations: EditorOperation[];
  projectId?: string;
  requestToken?: string;
}
export interface ProposalContext {
  document: EditorDocument;
  identity: SessionIdentity;
  origin: ProposalOrigin;
  idFactory: SequenceIdFactory;
  /** Sequence the old frame view shows; defaults to the active sequence. */
  sequenceId?: string;
}
export interface EditorProposalReview {
  title: string;
  explanation: string;
  origin: ProposalOrigin;
  labels: string[];
  operationCount: number;
  /** The project changed after the plan was made; it is never rebased. */
  stale: boolean;
  /** End of the reviewed sequence in seconds, before and after applying. */
  before: number;
  after: number | null;
  tracks: Array<{
    trackId: string;
    name: string;
    kind: string;
    before: number;
    after: number | null;
  }>;
}

const FIFTEEN_SECONDS = 15 * TICKS_PER_SECOND;
const secondsText = (tick: number) => (tick / TICKS_PER_SECOND).toFixed(2);
const sameIdentity = (a: SessionIdentity, b: SessionIdentity) =>
  a.documentId === b.documentId && a.generation === b.generation && a.revision === b.revision;
function plain(value: unknown, label: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label}必须是一个 JSON 对象`);
  return value as Record<string, unknown>;
}
function sequenceOf(document: EditorDocument, sequenceId: string): EditorSequence {
  const sequence = document.sequences.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error("方案对应的时间线不存在");
  return sequence;
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

/** Dry-run the operations on the exact document they were planned for. */
export function createEditorProposal(
  document: EditorDocument,
  proposal: EditorProposal,
): EditorProposal {
  if (
    proposal.identity.documentId !== document.id ||
    proposal.identity.revision !== document.revision
  )
    throw new Error("工程或版本已改变，请基于当前工程重新生成方案");
  if (!proposal.operations.length) throw new Error("方案没有需要应用的修改");
  sequenceOf(document, proposal.sequenceId);
  applyEditorOperations(document, proposal.operations, document.revision);
  return frozen(structuredClone(proposal));
}

function names(document: EditorDocument, sequenceId: unknown, ids: unknown): string {
  const sequence = document.sequences.find((item) => item.id === sequenceId);
  const list = (Array.isArray(ids) ? ids : [ids]).map((id) => {
    const clip = sequence?.clips.find((item) => item.id === id);
    return (
      clip?.label ||
      (clip?.kind === "media" && document.assets.find((asset) => asset.id === clip.assetId)?.name) ||
      "片段"
    );
  });
  return list.length > 3
    ? `「${list.slice(0, 3).join("」「")}」等 ${list.length} 个片段`
    : `「${list.join("」「")}」`;
}
/** A short Chinese description of one planner step for the review card. */
function stepLabel(document: EditorDocument, raw: unknown): string {
  const step = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const action = (step.action ?? {}) as Record<string, any>;
  switch (step.kind) {
    case "remove":
      return `删除${names(document, step.sequenceId, step.clipIds)}`;
    case "split":
      return `在 ${secondsText(step.time)} 秒切分${names(document, step.sequenceId, step.clipId)}`;
    case "trim":
      return `裁剪${names(document, step.sequenceId, step.clipId)}`;
    case "timing":
      if (action.kind === "keep-left")
        return `保留${names(document, step.sequenceId, step.clipIds)}到 ${secondsText(action.time)} 秒`;
      if (action.kind === "keep-right")
        return `保留${names(document, step.sequenceId, step.clipIds)}从 ${secondsText(action.time)} 秒开始的部分`;
      if (action.kind === "speed")
        return `把${names(document, step.sequenceId, step.clipIds)}调整为 ${action.rate} 倍速`;
      return `调整${names(document, step.sequenceId, step.clipIds)}的播放时间`;
    case "move":
      return `移动${names(document, step.sequenceId, step.clipIds)}`;
    case "transition":
      return step.options?.remove ? "移除转场" : "添加转场";
    case "arrange":
      return step.options?.mode === "free" ? "改为自由排列" : "改为磁吸排列";
    case "group":
      return `编组${names(document, step.sequenceId, step.clipIds)}`;
    case "ungroup":
      return `取消编组${names(document, step.sequenceId, step.clipIds)}`;
    case "duplicate":
      return `复制${names(document, step.sequenceId, step.clipIds)}`;
    case "captions":
      return "编辑字幕";
    case "sequence":
      return "编辑时间线";
    case "multicam":
      return "编辑多机位片段";
    case "marker":
      return "编辑时间线标记";
    case "operations":
      return `直接修改 ${Array.isArray(step.operations) ? step.operations.length : 0} 项`;
    default:
      return "剪辑操作";
  }
}

function text(value: unknown, label: string, max: number, multiline: boolean): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/ : /[\u0000-\u001f]/).test(value)
  )
    throw new Error(`${label}格式错误或过长`);
  return value;
}

/**
 * Read a reviewed-plan input. The editor format `{title, explanation, editor: {steps,
 * identity?}}` uses the same steps as apply_editor_edit; an included identity must match
 * exactly. The old frame format `{baseRevision, title, explanation, operations}` must name
 * the current revision and is translated clip by clip.
 */
export function parseEditorProposal(value: unknown, context: ProposalContext): EditorProposal {
  const data = plain(value, "剪辑方案");
  const { document, identity } = context;
  const sequenceId = context.sequenceId ?? document.activeSequenceId;
  if (!Object.hasOwn(data, "editor")) {
    const legacy = parseProposal(value);
    if (legacy.baseRevision !== document.revision)
      throw new Error(
        `工程已更新（当前修订 ${document.revision}，方案修订 ${legacy.baseRevision}），请重新生成方案`,
      );
    return createEditorProposal(document, {
      title: legacy.title,
      explanation: legacy.explanation,
      origin: context.origin,
      identity,
      sequenceId,
      labels: legacy.operations.map((op) => legacyOperationLabel(document, sequenceId, op)),
      operations: translateLegacyOperations(
        document,
        sequenceId,
        legacy.operations,
        context.idFactory,
      ),
      ...(legacy.projectId ? { projectId: legacy.projectId } : {}),
      ...(legacy.requestToken ? { requestToken: legacy.requestToken } : {}),
    });
  }
  for (const key of Object.keys(data))
    if (!["title", "explanation", "editor", "projectId", "requestToken"].includes(key))
      throw new Error(`方案包含未知字段：${key}`);
  const title = text(data.title, "方案 title", 200, false);
  if (!title.trim()) throw new Error("方案 title 必须是 1–200 个字符的单行非空文本");
  const explanation =
    data.explanation === undefined ? "" : text(data.explanation, "方案说明", 2000, true);
  const editor = plain(data.editor, "方案 editor");
  for (const key of Object.keys(editor))
    if (!["steps", "identity"].includes(key)) throw new Error(`方案 editor 包含未知字段：${key}`);
  if (editor.identity !== undefined) {
    const expected = plain(editor.identity, "方案工程身份") as unknown as SessionIdentity;
    if (!sameIdentity(expected, identity))
      throw new Error("工程或版本已改变，请基于当前工程重新生成方案");
  }
  const operations = compileEditorSteps(document, editor.steps, context.idFactory);
  // Review the sequence the steps edit; one plan changes one sequence.
  const targets = new Set(
    (editor.steps as unknown[]).flatMap((step) => {
      const value = (step as Record<string, unknown>)?.sequenceId;
      return typeof value === "string" ? [value] : [];
    }),
  );
  if (targets.size > 1) throw new Error("一份方案只能修改一条时间线，请拆分后分别导入");
  const result: EditorProposal = {
    title,
    explanation,
    origin: context.origin,
    identity,
    sequenceId: targets.size ? [...targets][0]! : sequenceId,
    labels: (editor.steps as unknown[]).map((step) => stepLabel(document, step)),
    operations,
  };
  for (const key of ["projectId", "requestToken"] as const) {
    const field = data[key];
    if (field === undefined) continue;
    if (typeof field !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(field))
      throw new Error(`方案 ${key} 格式不正确`);
    result[key] = field;
  }
  return createEditorProposal(document, result);
}

/** Before/after figures for the review card; a changed project marks the plan stale. */
export function reviewEditorProposal(
  proposal: EditorProposal,
  document: EditorDocument,
  identity: SessionIdentity,
): EditorProposalReview {
  // The caller passes the session's current identity together with its document.
  let stale = !sameIdentity(proposal.identity, identity);
  const before =
    document.sequences.find((item) => item.id === proposal.sequenceId) ??
    sequenceOf(document, document.activeSequenceId);
  let after: EditorSequence | undefined;
  if (!stale)
    try {
      after = sequenceOf(
        applyEditorOperations(document, proposal.operations, document.revision),
        before.id,
      );
    } catch {
      stale = true;
    }
  const count = (sequence: EditorSequence, trackId: string) =>
    sequence.clips.filter((clip) => clip.trackId === trackId).length;
  const tracks = [...before.tracks, ...(after?.tracks ?? [])]
    .filter((track, index, all) => all.findIndex((item) => item.id === track.id) === index)
    .map((track) => ({
      trackId: track.id,
      name: track.name,
      kind: track.kind,
      before: before.tracks.some((item) => item.id === track.id) ? count(before, track.id) : 0,
      after: after ? count(after, track.id) : null,
    }));
  return {
    title: proposal.title,
    explanation: proposal.explanation,
    origin: proposal.origin,
    labels: [...proposal.labels],
    operationCount: proposal.operations.length,
    stale,
    before: sequenceDuration(before) / TICKS_PER_SECOND,
    after: after ? sequenceDuration(after) / TICKS_PER_SECOND : null,
    tracks,
  };
}

/** The main picture track: the sequence's magnetic track, else its first picture track. */
export function mainTrackId(sequence: EditorSequence): string | undefined {
  if (
    sequence.magneticTrackId &&
    sequence.tracks.some((track) => track.id === sequence.magneticTrackId)
  )
    return sequence.magneticTrackId;
  return sequence.tracks.find((track) => track.kind === "video")?.id;
}

/**
 * Local rule: keep the first 15 seconds (snapped to the sequence frame rate) of the main
 * track. The clip crossing the limit keeps its left part (rippling on a magnetic track)
 * and every later main-track clip is removed; captions bound to them follow. Other tracks
 * are not touched.
 */
export function planFifteenSecondDraft(
  document: EditorDocument,
  sequenceId: string,
  idFactory: SequenceIdFactory,
): { operations: EditorOperation[]; labels: string[] } {
  const sequence = sequenceOf(document, sequenceId),
    trackId = mainTrackId(sequence);
  if (!trackId || !sequence.clips.some((clip) => clip.trackId === trackId))
    throw new Error("主画面轨还没有片段");
  const limit = snapToFrame(FIFTEEN_SECONDS, sequence.frameRate);
  let draft = document,
    removed = 0,
    kept = "";
  const operations: EditorOperation[] = [];
  const main = () =>
    sequenceOf(draft, sequenceId)
      .clips.filter((clip) => clip.trackId === trackId)
      .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  // A removed transition can shift the kept clip once; re-check until the track ends at the limit.
  for (let pass = 0; pass < 4; pass++) {
    const clips = main(),
      later = clips.filter((clip) => clip.start >= limit),
      crossing = clips.find((clip) => clip.start < limit && clip.start + clip.duration > limit);
    if (!later.length && !crossing) break;
    let batch: EditorOperation[];
    if (later.length) {
      batch = compileEditorSteps(
        draft,
        [{ kind: "remove", sequenceId, clipIds: later.map((clip) => clip.id) }],
        idFactory,
      );
      removed += later.length;
    } else {
      const current = sequenceOf(draft, sequenceId);
      kept ||= names(draft, sequenceId, crossing!.id);
      batch = compileEditorSteps(
        draft,
        [
          {
            kind: "timing",
            sequenceId,
            clipIds: [crossing!.id],
            action: { kind: "keep-left", time: limit },
            options: current.transitions.some(
              (item) => item.fromClipId === crossing!.id || item.toClipId === crossing!.id,
            )
              ? { removeTransitions: true }
              : {},
          },
        ],
        idFactory,
      );
    }
    draft = applyEditorOperations(draft, batch, draft.revision);
    operations.push(...batch);
  }
  if (main().some((clip) => clip.start + clip.duration > limit))
    throw new Error("主画面轨无法精确精简到 15 秒，请手动调整后重试");
  // Then every other track (hidden and muted included), so the whole video ends at the limit.
  // Captions bound to a clip handled here follow their owner.
  const others = (from: EditorDocument, test: (clip: EditorClip) => boolean) => {
    const current = sequenceOf(from, sequenceId);
    const chosen = current.clips.filter((clip) => clip.trackId !== trackId && test(clip));
    const ids = new Set(chosen.map((clip) => clip.id));
    return chosen.filter(
      (clip) => !(clip.kind === "text" && clip.sourceBinding && ids.has(clip.sourceBinding.clipId)),
    );
  };
  const later = others(draft, (clip) => clip.start >= limit),
    crossing = others(draft, (clip) => clip.start < limit && clip.start + clip.duration > limit);
  const current = sequenceOf(draft, sequenceId);
  for (const clip of [...later, ...crossing]) {
    const track = current.tracks.find((item) => item.id === clip.trackId)!;
    if (track.locked)
      throw new Error(`轨道「${track.name}」已锁定，无法截断 15 秒之后的内容，请先解锁后重试`);
  }
  const run = (batch: EditorOperation[]) => {
    draft = applyEditorOperations(draft, batch, draft.revision);
    operations.push(...batch);
  };
  if (later.length)
    run([{ type: "clip.remove", sequenceId, clipIds: later.map((clip) => clip.id) }]);
  const cut = others(
    draft,
    (clip) => clip.start < limit && clip.start + clip.duration > limit,
  );
  if (cut.length) {
    const ids = new Set(cut.map((clip) => clip.id)),
      joined = sequenceOf(draft, sequenceId).transitions.find(
        (item) => ids.has(item.fromClipId) || ids.has(item.toClipId),
      );
    if (joined) {
      const owner = sequenceOf(draft, sequenceId).clips.find((clip) => clip.id === joined.toClipId);
      const track = sequenceOf(draft, sequenceId).tracks.find((item) => item.id === owner?.trackId);
      throw new Error(`轨道「${track?.name ?? "画面"}」在 15 秒处有转场，请先移除这个转场后重试`);
    }
    run(
      compileEditorSteps(
        draft,
        [
          {
            kind: "timing",
            sequenceId,
            clipIds: cut.map((clip) => clip.id),
            action: { kind: "keep-left", time: limit },
            options: { ripple: false },
          },
        ],
        idFactory,
      ),
    );
  }
  if (!operations.length) throw new Error("当前序列不超过 15 秒，无需精简");
  if (sequenceDuration(sequenceOf(draft, sequenceId)) > limit)
    throw new Error("无法把整条视频精确精简到 15 秒，请手动调整后重试");
  const truncated = later.length + cut.length;
  const labels = [
    ...(kept ? [`保留${kept}到 ${secondsText(limit)} 秒`] : []),
    ...(removed ? [`删除主画面轨 ${secondsText(limit)} 秒之后的 ${removed} 个片段`] : []),
    ...(truncated ? [`截断其他轨道 ${secondsText(limit)} 秒之后的 ${truncated} 个片段`] : []),
  ];
  return { operations, labels };
}
