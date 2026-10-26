import { audioLaneNeedsSource, compileAudioPlan } from "./audio-plan";
import type { EditorDocument } from "./types";

export type EditorPreviewScope = { kind: "audio" } | { kind: "video"; assetIds: string[] };

/** Native independently validates this scope; a caller-supplied reduced resource
 * list never becomes authority for a complete project or export. */
export function validateEditorPreviewScope(value: unknown): EditorPreviewScope {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error("预览资源范围无效");
  const scope = value as Record<string, unknown>, keys = Reflect.ownKeys(scope);
  if (scope.kind === "audio" && keys.length === 1) return { kind: "audio" };
  if (scope.kind !== "video" || keys.some((key) => key !== "kind" && key !== "assetIds") ||
      !Array.isArray(scope.assetIds) || !scope.assetIds.length || scope.assetIds.length > 10000 ||
      new Set(scope.assetIds).size !== scope.assetIds.length ||
      scope.assetIds.some((id) => typeof id !== "string" || !id || id.length > 128))
    throw new Error("预览资源范围无效");
  return { kind: "video", assetIds: [...scope.assetIds] as string[] };
}

/** `document` is the already validated canonical sequence reference closure. */
export function editorPreviewResourceIds(
  document: EditorDocument,
  sequenceId: string,
  scope: EditorPreviewScope,
): string[] {
  scope = validateEditorPreviewScope(scope);
  const ids = scope.kind === "audio"
    ? new Set(compileAudioPlan(document, sequenceId).lanes.filter(audioLaneNeedsSource).map((lane) => lane.assetId))
    : new Set(scope.assetIds);
  if (scope.kind === "video" && scope.assetIds.some((id) =>
    !document.assets.some((asset) => asset.id === id && asset.kind === "video")))
    throw new Error("预览视频不属于当前序列的素材闭包");
  return [...new Set(document.assets.filter((asset) => ids.has(asset.id))
    .flatMap((asset) => asset.resourceId ? [asset.resourceId] : []))].sort();
}
