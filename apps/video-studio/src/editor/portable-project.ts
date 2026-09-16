import type { EditorDocument } from "./types";
import { validateEditorDocument } from "./validation";

/** Public, transport-independent format. A ZIP path is always derived from this digest. */
export const PORTABLE_PROJECT_FORMAT = "mimi-video-project";
export const PORTABLE_PROJECT_VERSION = 1;
export const PORTABLE_PROJECT_EXTENSION = ".mimiproject";
export const PORTABLE_PROJECT_MIME = "application/zip";
export const MAX_PORTABLE_MEDIA = 10_000;
export interface PortableMedia {
  sha256: string;
  bytes: number;
  assetIds: string[];
}
export interface PortableProjectManifest {
  format: typeof PORTABLE_PROJECT_FORMAT;
  formatVersion: typeof PORTABLE_PROJECT_VERSION;
  document: EditorDocument;
  media: PortableMedia[];
}
export class PortableProjectError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues: ReadonlyArray<{ assetId?: string; sha256?: string; message: string }> = [],
  ) {
    super(message);
    this.name = "PortableProjectError";
  }
}
const invalid = (message: string): never => {
  throw new PortableProjectError("INVALID_BUNDLE", message);
};
function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label}必须是对象`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) invalid(`${label}必须是普通对象`);
  const own = Reflect.ownKeys(value as object);
  if (own.length !== keys.length || keys.some((key) => !own.includes(key)))
    invalid(`${label}字段缺失或不支持`);
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (
      typeof key !== "string" ||
      !keys.includes(key) ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    )
      invalid(`${label}不能包含额外字段或访问器`);
  }
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string, minimum = 0): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < minimum ||
    value.length > MAX_PORTABLE_MEDIA
  )
    invalid(`${label}项数无效（最多 ${MAX_PORTABLE_MEDIA}）`);
  const list = value as unknown[];
  if (Reflect.ownKeys(list).length !== list.length + 1) invalid(`${label}不能有空洞或额外属性`);
  for (let i = 0; i < list.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(list, String(i));
    if (!descriptor?.enumerable || !("value" in descriptor)) invalid(`${label}不能有空洞或访问器`);
  }
  return list;
}
export function portableMediaPath(sha256: string): string {
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) invalid("素材 SHA-256 无效");
  return `media/${sha256}`;
}
/** Returns an isolated validated copy; unknown fields and incomplete bundles are rejected. */
export function validatePortableProjectManifest(value: unknown): PortableProjectManifest {
  const data = object(value, ["format", "formatVersion", "document", "media"], "工程包清单");
  if (data.format !== PORTABLE_PROJECT_FORMAT) invalid("不是 Mimi 视频工程包");
  if (data.formatVersion !== PORTABLE_PROJECT_VERSION)
    throw new PortableProjectError(
      "UNSUPPORTED_BUNDLE_VERSION",
      `不支持的工程包版本：${String(data.formatVersion)}`,
    );
  const document = validateEditorDocument(data.document);
  if (document.assets.length > MAX_PORTABLE_MEDIA)
    invalid(`工程最多包含 ${MAX_PORTABLE_MEDIA} 个素材`);
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  const hashes = new Set<string>(),
    bound = new Set<string>();
  const media = array(data.media, "素材清单").map((value): PortableMedia => {
    const item = object(value, ["sha256", "bytes", "assetIds"], "素材记录");
    portableMediaPath(item.sha256 as string);
    const sha256 = item.sha256 as string;
    if (hashes.has(sha256)) invalid(`素材摘要重复：${sha256}`);
    hashes.add(sha256);
    if (!Number.isSafeInteger(item.bytes) || (item.bytes as number) < 1)
      invalid("素材大小必须是正整数");
    const assetIds = array(item.assetIds, "素材引用", 1).map((id) => {
      if (typeof id !== "string") invalid("素材引用必须是 ID");
      const asset = assets.get(id as string);
      if (!asset || asset.kind === "demo" || bound.has(id as string))
        invalid(`素材引用无效或重复：${String(id)}`);
      if (asset!.fingerprint && asset!.fingerprint !== sha256)
        invalid(`素材摘要与工程不一致：${id}`);
      bound.add(id as string);
      return id as string;
    });
    return { sha256, bytes: item.bytes as number, assetIds };
  });
  const missing = document.assets.filter((asset) => asset.kind !== "demo" && !bound.has(asset.id));
  if (missing.length)
    throw new PortableProjectError(
      "MISSING_MEDIA",
      "工程包没有包含全部原始素材",
      missing.map((asset) => ({ assetId: asset.id, message: `缺少素材：${asset.name}` })),
    );
  return {
    format: PORTABLE_PROJECT_FORMAT,
    formatVersion: PORTABLE_PROJECT_VERSION,
    document,
    media,
  };
}
/** Call only after the receiving Host has published every verified media file. Asset/clip IDs stay stable. */
export function remapPortableProjectResources(
  value: unknown,
  resources: ReadonlyArray<{ sha256: string; resourceId: string }>,
): EditorDocument {
  const manifest = validatePortableProjectManifest(value),
    mappings = new Map<string, string>();
  for (const value of array(resources, "接收设备素材映射")) {
    const item = object(value, ["sha256", "resourceId"], "接收设备素材映射");
    portableMediaPath(item.sha256 as string);
    if (
      typeof item.resourceId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(item.resourceId)
    )
      invalid("接收设备资源 ID 无效");
    if (mappings.has(item.sha256 as string)) invalid("接收设备素材映射重复");
    mappings.set(item.sha256 as string, item.resourceId as string);
  }
  if (
    mappings.size !== manifest.media.length ||
    manifest.media.some((item) => !mappings.has(item.sha256))
  )
    invalid("必须先发布并映射全部工程包素材");
  const assets = new Map(manifest.document.assets.map((asset) => [asset.id, asset]));
  for (const media of manifest.media)
    for (const assetId of media.assetIds) {
      const asset = assets.get(assetId)!;
      asset.resourceId = mappings.get(media.sha256)!;
      asset.fingerprint = media.sha256;
    }
  return validateEditorDocument(manifest.document);
}
