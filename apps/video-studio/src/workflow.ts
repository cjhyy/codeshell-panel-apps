/** Portable planning data. A stage describes the plan, never proof that work ran. */
export type VideoWorkflowStage =
  | "initialized"
  | "selects"
  | "rough-cut"
  | "sound"
  | "captions"
  | "review";

export type VideoSourceRole = "main" | "broll" | "voice" | "music" | "image" | "hold";

export interface VideoWorkflowSource {
  assetId: string;
  role: VideoSourceRole;
  note: string;
  /** Optional selected source interval at 30 fps, half open: [inFrame, outFrame). */
  inFrame?: number;
  outFrame?: number;
}

export interface VideoWorkflow {
  stage: VideoWorkflowStage;
  brief: string;
  outline: string;
  sources: VideoWorkflowSource[];
  nextSteps: string[];
  blockers: string[];
}

/** Validation only needs source identity and real duration; it has no model dependency. */
export interface WorkflowAsset {
  id: string;
  durationFrames: number;
  name?: string;
}

const STAGES: Record<VideoWorkflowStage, string> = {
  initialized: "整理需求",
  selects: "挑选素材",
  "rough-cut": "编排粗剪",
  sound: "处理声音",
  captions: "整理字幕",
  review: "成片审阅",
};

const ROLES: Record<VideoSourceRole, string> = {
  main: "主线画面",
  broll: "补充画面",
  voice: "口播／旁白",
  music: "背景音乐",
  image: "图片",
  hold: "暂不使用",
};

function record(
  value: unknown,
  label: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label}必须是普通数据对象`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      throw new Error(`${label}包含未知字段：${String(key)}`);
    }
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  ) {
    throw new Error(`${label}必须是非空文本，最多 ${max} 个字符`);
  }
  return value;
}

function list(value: unknown, min: number, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${label}必须是数组，包含 ${min} 到 ${max} 项`);
  }
  return Array.from(value);
}

function frame(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label}必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}

/** Validate and detach untrusted planning data; never interpret its text as instructions. */
export function validateVideoWorkflow(
  value: unknown,
  assets: readonly WorkflowAsset[],
): VideoWorkflow {
  const data = record(value, "制作单", [
    "stage",
    "brief",
    "outline",
    "sources",
    "nextSteps",
    "blockers",
  ]);
  if (typeof data.stage !== "string" || !Object.hasOwn(STAGES, data.stage)) {
    throw new Error("制作单阶段不受支持");
  }
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const sources = list(data.sources, 0, 100, "制作单素材").map((value) => {
    const source = record(value, "制作单素材", ["assetId", "role", "note", "inFrame", "outFrame"]);
    const assetId = source.assetId;
    if (typeof assetId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(assetId)) {
      throw new Error("制作单素材 ID 格式不正确");
    }
    const asset = byId.get(assetId);
    if (!asset) throw new Error(`制作单引用了不属于当前工程的素材：${assetId}`);
    if (typeof source.role !== "string" || !Object.hasOwn(ROLES, source.role)) {
      throw new Error("制作单素材用途不受支持");
    }
    const result: VideoWorkflowSource = {
      assetId,
      role: source.role as VideoSourceRole,
      note: text(source.note, 800, "制作单素材说明"),
    };
    const hasIn = Object.hasOwn(source, "inFrame"),
      hasOut = Object.hasOwn(source, "outFrame");
    if (hasIn !== hasOut) throw new Error("素材源范围必须同时提供入点和出点");
    if (hasIn) {
      if (!Number.isSafeInteger(asset.durationFrames) || asset.durationFrames < 1) {
        throw new Error("制作单素材缺少有效的真实时长");
      }
      result.inFrame = frame(source.inFrame, 0, asset.durationFrames - 1, "制作单素材入点");
      result.outFrame = frame(
        source.outFrame,
        result.inFrame + 1,
        asset.durationFrames,
        "制作单素材出点",
      );
    }
    return result;
  });
  return {
    stage: data.stage as VideoWorkflowStage,
    brief: text(data.brief, 2000, "制作目标"),
    outline: text(data.outline, 4000, "叙事安排"),
    sources,
    nextSteps: list(data.nextSteps, 1, 12, "后续步骤").map((value) => text(value, 500, "后续步骤")),
    blockers: list(data.blockers, 0, 12, "缺项").map((value) => text(value, 500, "缺项")),
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function plainText(value: string): string {
  return escapeHtml(value).replace(/\r\n?|\n/g, "<br>");
}

function timecode(value: number): string {
  const seconds = Math.floor(value / 30);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, value % 30]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/** Read-only UI: every source name and note is escaped, without clickable commands or paths. */
export function renderWorkflowSummary(
  workflow?: VideoWorkflow,
  assets: readonly WorkflowAsset[] = [],
): string {
  if (!workflow) {
    return `<details class="workflow-summary"><summary>制作单 · 尚未建立</summary><p>先整理目标和素材，再确定叙事顺序与后续步骤。</p></details>`;
  }
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const included = new Set(workflow.sources.map((source) => source.assetId));
  const unlisted = assets.filter((asset) => !included.has(asset.id)).length;
  const sources = workflow.sources
    .map((source) => {
      const name = byId.get(source.assetId)?.name ?? source.assetId;
      const range =
        source.inFrame === undefined || source.outFrame === undefined
          ? "尚未选定源范围"
          : `源范围 [${timecode(source.inFrame)}, ${timecode(source.outFrame)}) · 30 fps`;
      return `<li><strong>${escapeHtml(name)}</strong> · ${ROLES[source.role]}<br>${range}<br>${plainText(source.note)}</li>`;
    })
    .join("");
  const nextSteps = workflow.nextSteps.map((step) => `<li>${plainText(step)}</li>`).join("");
  const blockers = workflow.blockers.map((blocker) => `<li>${plainText(blocker)}</li>`).join("");
  return `<details class="workflow-summary"><summary>制作单 · ${STAGES[workflow.stage]}</summary>
<p>制作单记录计划；素材处理、剪辑和导出以实际结果为准。</p>
${unlisted ? `<p>当前有 ${unlisted} 份素材尚未列入制作单；继续前会核对新增和待审内容。</p>` : ""}
<h3>制作目标</h3><p>${plainText(workflow.brief)}</p>
<h3>叙事安排</h3><p>${plainText(workflow.outline)}</p>
<h3>素材用途与选片范围</h3>${sources ? `<ul>${sources}</ul>` : "<p>尚未分配素材用途。</p>"}
<h3>后续步骤</h3><ol>${nextSteps}</ol>
<h3>缺项</h3>${blockers ? `<ul>${blockers}</ul>` : "<p>制作单暂未记录缺项，仍需实际检查成片。</p>"}
</details>`;
}
