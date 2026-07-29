import {
  MAX_DESIGN_BUNDLE_PART_BYTES,
  splitDesignSource,
} from "./document-bundle.mjs";

export const DESIGN_RESOURCE_KINDS = Object.freeze(["image", "font"]);
export const MAX_DESIGN_RESOURCES = 2_048;
export const MAX_DESIGN_RESOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_DESIGN_RESOURCE_PARTS = 4_096;

const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);
const FONT_MIMES = new Set([
  "font/woff2",
  "font/woff",
  "font/ttf",
  "font/otf",
  "application/font-woff",
  "application/x-font-ttf",
  "application/x-font-opentype",
]);

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function assertExactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} 包含未知字段：${key}`);
  }
}

function decodeBase64(base64) {
  if (typeof base64 !== "string" || !BASE64.test(base64)) {
    throw new Error("资源内容不是规范 Base64");
  }
  let binary;
  try {
    binary = globalThis.atob(base64);
  } catch {
    throw new Error("资源内容不是有效 Base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function designResourcePartPath(descriptor, index) {
  const normalized = normalizeDesignResourceDescriptor(descriptor);
  if (!Number.isInteger(index) || index < 0 || index >= normalized.partCount) {
    throw new Error("资源分片序号无效");
  }
  const folder = normalized.kind === "image" ? "images" : "fonts";
  return `designs/codesign-data/${folder}/${normalized.sha256.slice(0, 16)}/${normalized.sha256}-${String(index + 1).padStart(4, "0")}.txt`;
}

export function normalizeDesignResourceDescriptor(value, index = 0) {
  const font = value?.kind === "font";
  assertExactKeys(
    value,
    new Set([
      "id",
      "kind",
      "mime",
      "bytes",
      "sha256",
      "partCount",
      ...(font ? ["family", "weight", "style"] : []),
    ]),
    `资源 ${index + 1}`,
  );
  if (
    typeof value.id !== "string" ||
    !SAFE_ID.test(value.id) ||
    !DESIGN_RESOURCE_KINDS.includes(value.kind)
  ) {
    throw new Error(`资源 ${index + 1} 的 ID 或类型无效`);
  }
  const allowedMimes = value.kind === "image" ? IMAGE_MIMES : FONT_MIMES;
  if (typeof value.mime !== "string" || !allowedMimes.has(value.mime.toLowerCase())) {
    throw new Error(`资源 ${value.id} 的 MIME 类型无效`);
  }
  if (
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > MAX_DESIGN_RESOURCE_BYTES ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    !Number.isInteger(value.partCount) ||
    value.partCount < 1 ||
    value.partCount > MAX_DESIGN_RESOURCE_PARTS
  ) {
    throw new Error(`资源 ${value.id} 的大小、摘要或分片数无效`);
  }
  const descriptor = {
    id: value.id,
    kind: value.kind,
    mime: value.mime.toLowerCase(),
    bytes: value.bytes,
    sha256: value.sha256,
    partCount: value.partCount,
  };
  if (font) {
    if (
      typeof value.family !== "string" ||
      !value.family.trim() ||
      value.family.length > 120 ||
      /[\u0000-\u001f\u007f]/u.test(value.family) ||
      !Number.isInteger(value.weight) ||
      value.weight < 1 ||
      value.weight > 1_000 ||
      !["normal", "italic", "oblique"].includes(value.style)
    ) {
      throw new Error(`字体资源 ${value.id} 的字体元数据无效`);
    }
    Object.assign(descriptor, {
      family: value.family,
      weight: value.weight,
      style: value.style,
    });
  }
  return descriptor;
}

export function normalizeDesignResources(value = []) {
  if (!Array.isArray(value) || value.length > MAX_DESIGN_RESOURCES) {
    throw new Error(`设计资源必须是最多 ${MAX_DESIGN_RESOURCES} 项的数组`);
  }
  const ids = new Set();
  return value.map((resource, index) => {
    const normalized = normalizeDesignResourceDescriptor(resource, index);
    if (ids.has(normalized.id)) throw new Error(`资源 ID 重复：${normalized.id}`);
    ids.add(normalized.id);
    return normalized;
  });
}

export async function createDesignResourcePersistencePlan({
  id,
  kind,
  mime,
  base64,
  family,
  weight = 400,
  style = "normal",
  sha256Bytes,
}) {
  if (typeof sha256Bytes !== "function") throw new Error("资源存储需要 SHA-256 能力");
  const bytes = decodeBase64(base64);
  if (bytes.length < 1 || bytes.length > MAX_DESIGN_RESOURCE_BYTES) {
    throw new Error(`资源大小必须是 1 到 ${MAX_DESIGN_RESOURCE_BYTES} 字节`);
  }
  const digest = await sha256Bytes(bytes);
  const parts = splitDesignSource(base64);
  const descriptor = normalizeDesignResourceDescriptor({
    id,
    kind,
    mime,
    bytes: bytes.length,
    sha256: digest,
    partCount: parts.length,
    ...(kind === "font" ? { family, weight, style } : {}),
  });
  return {
    descriptor,
    parts: parts.map((part, index) => ({
      path: designResourcePartPath(descriptor, index),
      content: part.content,
      bytes: part.bytes,
    })),
  };
}

export async function resolveDesignResource({ descriptor, readText, sha256Bytes }) {
  const normalized = normalizeDesignResourceDescriptor(descriptor);
  if (typeof readText !== "function" || typeof sha256Bytes !== "function") {
    throw new Error("读取资源缺少文件读取或摘要能力");
  }
  const contents = [];
  for (let index = 0; index < normalized.partCount; index += 1) {
    const result = await readText(designResourcePartPath(normalized, index));
    const content = typeof result === "string" ? result : result?.content;
    if (
      typeof content !== "string" ||
      byteLength(content) < 1 ||
      byteLength(content) > MAX_DESIGN_BUNDLE_PART_BYTES
    ) {
      throw new Error(`资源 ${normalized.id} 的分片 ${index + 1} 无效`);
    }
    contents.push(content);
  }
  const base64 = contents.join("");
  const bytes = decodeBase64(base64);
  if (bytes.length !== normalized.bytes) {
    throw new Error(`资源 ${normalized.id} 重组后的字节数无效`);
  }
  if ((await sha256Bytes(bytes)) !== normalized.sha256) {
    throw new Error(`资源 ${normalized.id} 的摘要校验失败`);
  }
  return {
    descriptor: normalized,
    bytes,
    base64,
    dataUrl: `data:${normalized.mime};base64,${base64}`,
  };
}

export class DesignResourceCache {
  constructor({ resources = [], readText, sha256Bytes }) {
    this.resources = new Map(
      normalizeDesignResources(resources).map((resource) => [resource.id, resource]),
    );
    this.readText = readText;
    this.sha256Bytes = sha256Bytes;
    this.loaded = new Map();
  }

  descriptor(resourceId) {
    return this.resources.get(resourceId) ?? null;
  }

  loadedResourceIds() {
    return [...this.loaded.keys()];
  }

  retain(resourceIds) {
    const retained = new Set(resourceIds);
    for (const resourceId of this.loaded.keys()) {
      if (!retained.has(resourceId)) this.loaded.delete(resourceId);
    }
  }

  async load(resourceId) {
    if (this.loaded.has(resourceId)) return this.loaded.get(resourceId);
    const descriptor = this.descriptor(resourceId);
    if (!descriptor) throw new Error(`资源不存在：${resourceId}`);
    const pending = resolveDesignResource({
      descriptor,
      readText: this.readText,
      sha256Bytes: this.sha256Bytes,
    });
    this.loaded.set(resourceId, pending);
    try {
      return await pending;
    } catch (error) {
      this.loaded.delete(resourceId);
      throw error;
    }
  }
}
