import type { PanelBridge } from "./host";
import { createPanelRuntime } from "./sdk/panel-runtime";

export type ImportMode = "reference" | "copy";
export interface ExternalReference {
  id: string;
  kind: "external";
  name: string;
  mimeType: string;
  bytes: number;
  lastModified: number;
  createdAt: number;
  state: "available" | "missing" | "changed";
}
export const isExternalMedia = (id: unknown): id is string =>
  typeof id === "string" && /^external-[a-f0-9]{64}$/.test(id);
export const isResourceId = (id: unknown): id is string =>
  typeof id === "string" && /^(?:asset|external)-[a-f0-9]{64}$/.test(id);

export function externalReference(value: unknown): ExternalReference {
  const ref = value as ExternalReference;
  if (
    !ref ||
    !isExternalMedia(ref.id) ||
    ref.kind !== "external" ||
    typeof ref.name !== "string" ||
    !ref.name ||
    ref.name.length > 240 ||
    /[\\/\x00-\x1f\x7f]/.test(ref.name) ||
    typeof ref.mimeType !== "string" ||
    !/^(audio|video|image)\/[a-z0-9!#$&^_.+-]+$/.test(ref.mimeType) ||
    !Number.isSafeInteger(ref.bytes) ||
    ref.bytes < 1 ||
    !Number.isSafeInteger(ref.lastModified) ||
    ref.lastModified < 0 ||
    !Number.isSafeInteger(ref.createdAt) ||
    ref.createdAt < 0 ||
    !["available", "missing", "changed"].includes(ref.state)
  )
    throw new Error("原文件引用信息无效，请重新选择素材。");
  // Persist only reviewed public fields, never a Host locator or file authority.
  return {
    id: ref.id,
    kind: "external",
    name: ref.name,
    mimeType: ref.mimeType,
    bytes: ref.bytes,
    lastModified: ref.lastModified,
    createdAt: ref.createdAt,
    state: ref.state,
  };
}

export function createExternalMediaAccess(panel: PanelBridge | undefined) {
  const runtime = panel ? createPanelRuntime(panel) : undefined;
  async function available() {
    if (!runtime) return false;
    const context = await runtime.discover();
    return ["resources.references.pick", "resources.references.get"].every((method) =>
      context.availableMethods?.includes(method),
    );
  }
  async function pick(id?: string): Promise<ExternalReference[]> {
    if (!runtime || !(await available()))
      throw new Error("当前 CodeShell 尚不支持引用原文件，请更新桌面后使用，或明确选择复制保存。");
    if (id !== undefined && !isExternalMedia(id)) throw new Error("原文件引用编号无效");
    const value: any = await runtime.call("resources.references.pick", {
      multiple: !id,
      ...(id ? { id } : {}),
      filters: [
        {
          name: "视频、音频和图片",
          extensions: [
            "mp4",
            "mov",
            "m4v",
            "mkv",
            "webm",
            "avi",
            "wav",
            "mp3",
            "m4a",
            "aac",
            "flac",
            "ogg",
            "png",
            "jpg",
            "jpeg",
            "webp",
            "gif",
          ],
        },
      ],
    });
    if (value?.cancelled) return [];
    if (
      !Array.isArray(value?.references) ||
      value.references.length > 1000 ||
      (id && value.references.length > 1)
    )
      throw new Error("原文件选择结果无效");
    const result = value.references.map(externalReference);
    if (result.some((ref: ExternalReference) => ref.state !== "available" || (id && ref.id !== id)))
      throw new Error("原文件已变化，未替换已保存素材。请作为新素材导入。");
    return result;
  }
  async function get(id: string): Promise<ExternalReference> {
    if (!runtime || !isExternalMedia(id)) throw new Error("原文件引用编号无效");
    const value: any = await runtime.call("resources.references.get", { id });
    const ref = externalReference(value?.reference);
    if (ref.id !== id) throw new Error("原文件引用身份不一致");
    return ref;
  }
  return { available, pick, get, dispose: () => runtime?.dispose() };
}
