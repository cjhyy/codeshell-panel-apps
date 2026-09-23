import type { Project } from "./model";

/** User approval is written by the panel, never by an Agent edit operation. */
export interface NarrationState {
  phase: "draft" | "review" | "approved" | "recorded" | "aligned";
  captionBasis: "draft" | "recording";
  draftCaptionIds: string[];
  approvedScript?: string;
  approvedFingerprint?: string;
  /** Coordinator-owned work checkpoint; it never replaces the user's draft approval. */
  alignmentFingerprint?: string;
  recordingAssetId?: string;
  /** "editor": the fingerprints hash the editor document's narration dependencies. Absent on
   * approvals saved by older versions, which hashed the 30 fps compatibility view. */
  fingerprintBasis?: "editor";
}

const approvedPhases = new Set<NarrationState["phase"]>(["approved", "recorded", "aligned"]);
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) throw new Error(`${label}格式不正确`);
  return value;
}

/** Validated, normalized narration script text (the panel's editable copy). */
export function normalizeNarrationScript(value: unknown): string {
  return script(value).replace(/\r\n?/g, "\n").trim();
}

function script(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 10000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new Error("已确认文稿必须是非空文本，最多 10000 个字符");
  return value;
}

/** Strict portable data validation; removed temporary caption IDs remain useful provenance. */
export function validateNarration(
  value: unknown,
  assets: readonly { id: string; kind: string }[],
): NarrationState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("口播制作状态必须是对象");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("口播制作状态必须是普通数据对象");
  const data = value as Record<string, unknown>;
  const allowed = [
    "phase",
    "captionBasis",
    "draftCaptionIds",
    "approvedScript",
    "approvedFingerprint",
    "alignmentFingerprint",
    "recordingAssetId",
    "fingerprintBasis",
  ];
  for (const key of Reflect.ownKeys(data))
    if (typeof key !== "string" || !allowed.includes(key))
      throw new Error(`口播制作状态包含未知字段：${String(key)}`);
  if (
    typeof data.phase !== "string" ||
    !["draft", "review", "approved", "recorded", "aligned"].includes(data.phase)
  )
    throw new Error("口播制作阶段不受支持");
  if (data.captionBasis !== "draft" && data.captionBasis !== "recording")
    throw new Error("口播字幕依据不受支持");
  if (data.captionBasis === "recording" && data.phase !== "aligned")
    throw new Error("真实录音字幕只能用于已对齐阶段");
  if (!Array.isArray(data.draftCaptionIds) || data.draftCaptionIds.length > 1000)
    throw new Error("临时字幕 ID 必须是最多 1000 项的数组");
  const draftCaptionIds = Array.from(data.draftCaptionIds, (id) => identifier(id, "临时字幕 ID"));
  if (new Set(draftCaptionIds).size !== draftCaptionIds.length)
    throw new Error("临时字幕 ID 不能重复");
  const result: NarrationState = {
    phase: data.phase as NarrationState["phase"],
    captionBasis: data.captionBasis,
    draftCaptionIds,
  };
  if (approvedPhases.has(result.phase)) {
    result.approvedScript = script(data.approvedScript);
    if (
      typeof data.approvedFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(data.approvedFingerprint)
    )
      throw new Error("已确认草稿指纹必须是 SHA-256");
    result.approvedFingerprint = data.approvedFingerprint;
  } else if (Object.hasOwn(data, "approvedScript") || Object.hasOwn(data, "approvedFingerprint"))
    throw new Error("待审阅草稿不能保留已确认状态");
  if (Object.hasOwn(data, "alignmentFingerprint")) {
    if (
      !["recorded", "aligned"].includes(result.phase) ||
      typeof data.alignmentFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(data.alignmentFingerprint)
    )
      throw new Error("对齐工作指纹仅用于已录音或已对齐阶段，且必须是 SHA-256");
    result.alignmentFingerprint = data.alignmentFingerprint;
  }
  if (Object.hasOwn(data, "recordingAssetId")) {
    const id = identifier(data.recordingAssetId, "本人录音素材 ID");
    const asset = assets.find((item) => item.id === id);
    if (!asset || (asset.kind !== "audio" && asset.kind !== "video"))
      throw new Error("本人录音必须引用当前工程的音频或视频素材");
    result.recordingAssetId = id;
  }
  if (["recorded", "aligned"].includes(result.phase) && !result.recordingAssetId)
    throw new Error("此阶段需要已保存的本人录音素材");
  if (Object.hasOwn(data, "fingerprintBasis")) {
    if (data.fingerprintBasis !== "editor") throw new Error("口播确认指纹依据不受支持");
    result.fingerprintBasis = "editor";
  }
  return result;
}

/** Fixed field ordering makes approval independent of object insertion order and preparation. */
export function narrationSnapshot(project: Project): string {
  const clip = (value: Project["clips"][number]) => ({
    id: value.id,
    assetId: value.assetId,
    inFrame: value.inFrame,
    outFrame: value.outFrame,
    volume: value.volume,
    ...(project.timelineMode === "free" && value.startFrame !== undefined
      ? { startFrame: value.startFrame }
      : {}),
  });
  return JSON.stringify({
    script: project.script ?? "",
    width: project.width,
    height: project.height,
    ...(project.timelineMode === "free" ? { timelineMode: "free" } : {}),
    clips: project.clips.map(clip),
    audioClips: (project.audioClips ?? []).map((value) => ({
      ...clip(value),
      startFrame: value.startFrame,
    })),
    captions: project.captions.map((value) => ({
      id: value.id,
      startFrame: value.startFrame,
      endFrame: value.endFrame,
      text: value.text,
    })),
    captionStyle: project.captionStyle ?? "classic",
  });
}

export async function narrationFingerprint(project: Project): Promise<string> {
  const bytes = new TextEncoder().encode(narrationSnapshot(project));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeTextCut(value: string, position: number): number {
  if (/^[\uDC00-\uDFFF]$/.test(value[position] ?? "")) return position - 1;
  return position;
}

/** Reflow when the draft has fewer frames than sentences; never drop the remaining text. */
function reflowDraftText(value: string, count: number): string[] {
  const result: string[] = [];
  let remaining = value.trim();
  for (let slots = count; remaining && slots > 0; slots--) {
    if (slots === 1) {
      if (remaining.length > 4000) throw new Error("画面太短，无法完整显示文稿，请先延长草稿画面");
      result.push(remaining);
      break;
    }
    const minimum = Math.max(1, remaining.length - (slots - 1) * 4000);
    const maximum = Math.min(4000, remaining.length - slots + 1);
    if (minimum > maximum) throw new Error("画面太短，无法完整显示文稿，请先延长草稿画面");
    const target = Math.min(maximum, Math.max(minimum, Math.ceil(remaining.length / slots)));
    const boundaries = [...remaining.slice(0, maximum).matchAll(/[\n。！？!?；;]|\.(?=\s)/g)]
      .map((match) => match.index! + match[0].length)
      .filter((position) => position >= minimum);
    const preferred = boundaries.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    let cut = preferred ?? safeTextCut(remaining, target);
    if (cut < minimum) cut = safeTextCut(remaining, Math.min(maximum, target + 1));
    if (cut < minimum || cut > maximum)
      throw new Error("画面太短，无法完整显示文稿，请先延长草稿画面");
    const part = remaining.slice(0, cut).trim();
    if (part) result.push(part);
    remaining = remaining.slice(cut).trim();
  }
  return result;
}

/** Estimated draft subtitle lines: sentences, reflowed into at most `duration` (≤ 1000) slots. */
export function draftTextSegments(value: string, duration: number): string[] {
  const normalized = value.replace(/[^\S\n]+/g, " ").trim();
  const result: string[] = [];
  for (const sentence of normalized.split(/(?<=[。！？!?；;])|(?<=\.)[ \t]+|\n+/u)) {
    let remaining = sentence.trim();
    while (remaining.length > 4000) {
      const cut = safeTextCut(remaining, 4000);
      result.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) result.push(remaining);
  }
  const limit = Math.min(1000, duration);
  return result.length > limit ? reflowDraftText(normalized, limit) : result;
}

/** Content edits revoke approval; preparation and recording imports do not change the draft. */
export function reconcileNarrationEdit(before: Project, next: Project): Project {
  const result = structuredClone(next);
  if (
    before.id !== next.id ||
    !before.narration ||
    !approvedPhases.has(before.narration.phase) ||
    narrationSnapshot(before) === narrationSnapshot(next)
  )
    return result;
  const state = next.narration ?? before.narration;
  result.narration = {
    phase: "review",
    captionBasis: "draft",
    draftCaptionIds: [...state.draftCaptionIds],
    ...(state.recordingAssetId ? { recordingAssetId: state.recordingAssetId } : {}),
  };
  return result;
}
