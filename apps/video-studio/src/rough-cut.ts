import {
  timelineDuration,
  type Asset,
  type EditOperation,
  type Project,
  type RoughCut,
} from "./model";

export const MAX_ROUGH_CUTS = 1000;
const MAX_FRAMES = 24 * 60 * 60 * 30;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function source(
  assets: readonly Asset[],
  assetId: unknown,
  assetsById?: ReadonlyMap<string, Asset>,
): Asset {
  if (typeof assetId !== "string" || !IDENTIFIER.test(assetId))
    throw new Error("粗剪素材 ID 格式不正确");
  const asset = assetsById ? assetsById.get(assetId) : assets.find((item) => item.id === assetId);
  if (!asset || !["video", "audio"].includes(asset.kind))
    throw new Error("粗剪只能引用当前工程的视频或音频素材");
  if (
    !Number.isSafeInteger(asset.durationFrames) ||
    asset.durationFrames <= 0 ||
    asset.durationFrames > MAX_FRAMES
  )
    throw new Error("粗剪素材时长无效");
  return asset;
}

function sourceRange(asset: Asset, inFrame: unknown, outFrame: unknown): void {
  if (
    typeof inFrame !== "number" ||
    typeof outFrame !== "number" ||
    !Number.isSafeInteger(inFrame) ||
    !Number.isSafeInteger(outFrame) ||
    inFrame < 0 ||
    outFrame <= inFrame ||
    outFrame > asset.durationFrames
  )
    throw new Error("粗剪范围须为源素材内有效的整数帧，入点须早于出点");
}

/** Used by the project validator; type-only model imports avoid a runtime cycle. */
export function validateRoughCuts(value: unknown, assets: readonly Asset[]): RoughCut[] {
  if (!Array.isArray(value) || value.length > MAX_ROUGH_CUTS)
    throw new Error(`粗剪片段必须是数组，最多 ${MAX_ROUGH_CUTS} 项`);
  const used = new Set<string>();
  // This validation also runs after each operation in an atomic edit batch.
  // Index once so a large marker list does not rescan the entire media library.
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return Array.from(value, (item: unknown) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
    )
      throw new Error("粗剪片段须为普通数据对象");
    const cut = item as Record<string, unknown>;
    for (const key of Object.keys(cut))
      if (!["id", "assetId", "inFrame", "outFrame", "name", "enabled"].includes(key))
        throw new Error(`粗剪片段包含未知字段：${key}`);
    if (typeof cut.id !== "string" || !IDENTIFIER.test(cut.id))
      throw new Error("粗剪片段 ID 格式不正确");
    if (used.has(cut.id)) throw new Error(`粗剪片段 ID 重复：${cut.id}`);
    used.add(cut.id);
    const asset = source(assets, cut.assetId, assetsById);
    sourceRange(asset, cut.inFrame, cut.outFrame);
    if (
      typeof cut.name !== "string" ||
      cut.name.length > 200 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(cut.name)
    )
      throw new Error("粗剪片段名称须为文本，最多 200 个字符");
    if (typeof cut.enabled !== "boolean") throw new Error("粗剪片段启用状态须为布尔值");
    return {
      id: cut.id,
      assetId: asset.id,
      inFrame: cut.inFrame as number,
      outFrame: cut.outFrame as number,
      name: cut.name,
      enabled: cut.enabled,
    };
  });
}

function cutsOf(project: Project): RoughCut[] {
  if (project.fps !== 30) throw new Error("粗剪当前只支持 30 fps 工程");
  return validateRoughCuts(project.roughCuts ?? [], project.assets);
}

function nextCutId(cuts: readonly RoughCut[]): string {
  const used = new Set(cuts.map((cut) => cut.id));
  let index = 1;
  while (used.has(`rough-cut-${index}`)) index++;
  return `rough-cut-${index}`;
}

export function createRoughCut(
  project: Project,
  assetId: string,
  inFrame: number,
  outFrame: number,
  name?: string,
): RoughCut {
  const cuts = cutsOf(project);
  const asset = source(project.assets, assetId);
  const cut: RoughCut = {
    id: nextCutId(cuts),
    assetId: asset.id,
    inFrame,
    outFrame,
    name: name ?? `片段 ${cuts.filter((item) => item.assetId === assetId).length + 1}`,
    enabled: true,
  };
  return validateRoughCuts([...cuts, cut], project.assets).at(-1)!;
}

export type UniformRoughCutRule =
  | { mode: "trim"; headFrames: number; tailFrames: number }
  | { mode: "keep"; durationFrames: number; position: "start" | "middle" | "end" };

/** New review candidates only. Existing manual markers and the timeline are never replaced. */
export function planUniformRoughCuts(
  project: Project,
  assetIds: string[],
  rule: UniformRoughCutRule,
): { cuts: RoughCut[]; skippedIds: string[]; shorterIds: string[] } {
  if (!assetIds.length || assetIds.length > 1000 || new Set(assetIds).size !== assetIds.length)
    throw new Error("请选择 1–1000 份不重复的素材");
  const validFrames = (value: number) =>
    Number.isSafeInteger(value) && value >= 0 && value <= MAX_FRAMES;
  if (rule.mode === "trim") {
    if (!validFrames(rule.headFrames) || !validFrames(rule.tailFrames))
      throw new Error("片头和片尾长度须为有效的非负时长");
  } else if (rule.mode === "keep") {
    if (
      !validFrames(rule.durationFrames) ||
      rule.durationFrames < 1 ||
      !["start", "middle", "end"].includes(rule.position)
    )
      throw new Error("请输入大于零的保留时长，并选择保留位置");
  } else throw new Error("请选择去片头片尾或保留指定时长");
  const cuts: RoughCut[] = [],
    skippedIds: string[] = [],
    shorterIds: string[] = [];
  for (const id of assetIds) {
    const asset = source(project.assets, id);
    let inFrame: number, outFrame: number;
    if (rule.mode === "trim") {
      inFrame = rule.headFrames;
      outFrame = asset.durationFrames - rule.tailFrames;
      if (outFrame <= inFrame) {
        skippedIds.push(id);
        continue;
      }
    } else {
      const length = Math.min(rule.durationFrames, asset.durationFrames);
      if (length < rule.durationFrames) shorterIds.push(id);
      inFrame =
        rule.position === "end"
          ? asset.durationFrames - length
          : rule.position === "middle"
            ? Math.floor((asset.durationFrames - length) / 2)
            : 0;
      outFrame = inFrame + length;
    }
    cuts.push({
      id: `batch-cut-${crypto.randomUUID()}`,
      assetId: id,
      inFrame,
      outFrame,
      name:
        rule.mode === "trim"
          ? "统一去片头片尾"
          : `保留${{ start: "开头", middle: "中间", end: "结尾" }[rule.position]} ${(rule.durationFrames / 30).toFixed(2)} 秒`,
      enabled: true,
    });
  }
  validateRoughCuts([...(project.roughCuts ?? []), ...cuts], project.assets);
  return { cuts, skippedIds, shorterIds };
}

/** Replace this source's selections with the complement of its enabled union. */
export function invertRoughCuts(project: Project, assetId: string): RoughCut[] {
  const cuts = cutsOf(project);
  const asset = source(project.assets, assetId);
  const intervals = cuts
    .filter((cut) => cut.assetId === assetId && cut.enabled)
    .sort((left, right) => left.inFrame - right.inFrame || left.outFrame - right.outFrame);
  const gaps: { inFrame: number; outFrame: number }[] = [];
  let cursor = 0;
  for (const cut of intervals) {
    if (cut.inFrame > cursor) gaps.push({ inFrame: cursor, outFrame: cut.inFrame });
    cursor = Math.max(cursor, cut.outFrame);
  }
  if (cursor < asset.durationFrames) gaps.push({ inFrame: cursor, outFrame: asset.durationFrames });
  const replacements: RoughCut[] = [];
  for (const gap of gaps) {
    replacements.push({
      id: nextCutId([...cuts, ...replacements]),
      assetId,
      ...gap,
      name: `反选片段 ${replacements.length + 1}`,
      enabled: true,
    });
  }
  const others = cuts.filter((cut) => cut.assetId !== assetId);
  const first = cuts.findIndex((cut) => cut.assetId === assetId);
  const insertion =
    first < 0
      ? others.length
      : cuts.slice(0, first).filter((cut) => cut.assetId !== assetId).length;
  others.splice(insertion, 0, ...replacements);
  return validateRoughCuts(others, project.assets);
}

export function splitRoughCut(project: Project, cutId: string, atFrame: number): RoughCut[] {
  const cuts = cutsOf(project);
  const index = cuts.findIndex((cut) => cut.id === cutId);
  const cut = cuts[index];
  if (!cut) throw new Error("要分割的粗剪片段不存在");
  if (!Number.isSafeInteger(atFrame) || atFrame <= cut.inFrame || atFrame >= cut.outFrame)
    throw new Error("粗剪分割位置须为入点与出点之间的整数源帧");
  const right: RoughCut = { ...cut, id: nextCutId(cuts), inFrame: atFrame };
  cuts.splice(index, 1, { ...cut, outFrame: atFrame }, right);
  return validateRoughCuts(cuts, project.assets);
}

/** Preflight the whole selection; the caller applies the returned batch atomically. */
export function roughCutOperations(project: Project, cutIds: string[]): EditOperation[] {
  const cuts = cutsOf(project);
  if (
    !Array.isArray(cutIds) ||
    cutIds.length > MAX_ROUGH_CUTS ||
    Array.from(cutIds).some((id) => typeof id !== "string") ||
    new Set(cutIds).size !== cutIds.length
  )
    throw new Error("粗剪片段选择须为不重复的 ID 列表");
  const byId = new Map(cuts.map((cut) => [cut.id, cut]));
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  let pictureEnd = timelineDuration(project);
  let audioEnd = (project.audioClips ?? []).reduce(
    (end, clip) => Math.max(end, clip.startFrame + clip.outFrame - clip.inFrame),
    0,
  );
  let pictureCount = project.clips.length;
  let audioCount = (project.audioClips ?? []).length;
  const operations: EditOperation[] = [];
  for (const id of cutIds) {
    const cut = byId.get(id);
    if (!cut) throw new Error(`粗剪片段不存在：${id}`);
    const asset = source(project.assets, cut.assetId, assetsById);
    const length = cut.outFrame - cut.inFrame;
    if (asset.kind === "video") {
      pictureEnd += length;
      if (++pictureCount > 2000 || pictureEnd > MAX_FRAMES)
        throw new Error("加入粗剪片段后超出画面数量或时长上限");
      operations.push({
        type: "add",
        assetId: asset.id,
        inFrame: cut.inFrame,
        outFrame: cut.outFrame,
      });
    } else {
      if (++audioCount > 64) throw new Error("加入粗剪片段后超过 64 条音轨上限");
      if (audioEnd + length > pictureEnd)
        throw new Error("音频选段超出画面时长，请先添加或延长画面");
      operations.push({
        type: "audio-add",
        assetId: asset.id,
        inFrame: cut.inFrame,
        outFrame: cut.outFrame,
        startFrame: audioEnd,
        volume: 1,
      });
      audioEnd += length;
    }
  }
  return operations;
}

/** LosslessCut-compatible seconds CSV, without a header; source list order is preserved. */
export function exportRoughCutsCsv(project: Project, assetId: string): string {
  const cuts = cutsOf(project);
  source(project.assets, assetId);
  const seconds = (frame: number) => (frame / project.fps).toFixed(6).replace(/\.?0+$/, "");
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return cuts
    .filter((cut) => cut.assetId === assetId && cut.enabled)
    .map(
      (cut) =>
        [seconds(cut.inFrame), seconds(cut.outFrame), cut.name].map(quote).join(",") + "\r\n",
    )
    .join("");
}
