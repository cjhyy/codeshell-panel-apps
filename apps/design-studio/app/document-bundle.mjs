import { MAX_DESIGN_DOCUMENT_BYTES } from "./document.mjs";

export const MAX_WORKSPACE_DESIGN_TEXT_BYTES = 384 * 1024;
export const MAX_DESIGN_BUNDLE_PART_BYTES = 360 * 1024;
export const MAX_DESIGN_BUNDLE_PARTS = 24;
export const DESIGN_BUNDLE_FORMAT = "codeshell.design.bundle";
export const DESIGN_BUNDLE_VERSION = 1;

const encoder = new TextEncoder();
const SAFE_NAME = /^[^\u0000-\u001f\u007f]+$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function byteLength(value) {
  return encoder.encode(value).length;
}

function assertExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} 包含未知字段：${key}`);
  }
}

function safeChunkEnd(source, requestedEnd) {
  if (requestedEnd >= source.length) return source.length;
  const previous = source.charCodeAt(requestedEnd - 1);
  const next = source.charCodeAt(requestedEnd);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? requestedEnd - 1
    : requestedEnd;
}

export function splitDesignSource(source, maxPartBytes = MAX_DESIGN_BUNDLE_PART_BYTES) {
  if (typeof source !== "string") throw new Error("设计源必须是 UTF-8 文本");
  if (!Number.isInteger(maxPartBytes) || maxPartBytes < 1024) {
    throw new Error("设计分片上限无效");
  }
  const parts = [];
  let start = 0;
  while (start < source.length) {
    let low = start + 1;
    let high = Math.min(source.length, start + maxPartBytes);
    let end = start;
    let bytes = 0;
    while (low <= high) {
      const requested = Math.floor((low + high) / 2);
      const candidateEnd = safeChunkEnd(source, requested);
      if (candidateEnd <= start) {
        low = requested + 1;
        continue;
      }
      const candidateBytes = byteLength(source.slice(start, candidateEnd));
      if (candidateBytes <= maxPartBytes) {
        end = candidateEnd;
        bytes = candidateBytes;
        low = requested + 1;
      } else {
        high = requested - 1;
      }
    }
    if (end <= start) throw new Error("设计源包含无法安全分片的文本");
    const content = source.slice(start, end);
    parts.push({ content, bytes });
    start = end;
  }
  return parts;
}

export function normalizeDesignBundleManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("设计分片清单必须是对象");
  }
  assertExactKeys(
    value,
    new Set([
      "format",
      "bundleVersion",
      "name",
      "documentFormat",
      "documentVersion",
      "bytes",
      "sha256",
      "parts",
    ]),
    "设计分片清单",
  );
  if (value.format !== DESIGN_BUNDLE_FORMAT || value.bundleVersion !== DESIGN_BUNDLE_VERSION) {
    throw new Error("设计分片清单格式或版本无效");
  }
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 120 ||
    !SAFE_NAME.test(value.name)
  ) {
    throw new Error("设计分片清单名称无效");
  }
  if (value.documentFormat !== "codeshell.design" || value.documentVersion !== 3) {
    throw new Error("设计分片清单必须引用 CodeShell Design v3");
  }
  if (
    !Number.isInteger(value.bytes) ||
    value.bytes <= MAX_WORKSPACE_DESIGN_TEXT_BYTES ||
    value.bytes > MAX_DESIGN_DOCUMENT_BYTES
  ) {
    throw new Error("设计分片清单总字节数无效");
  }
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) {
    throw new Error("设计分片清单摘要无效");
  }
  if (
    !Array.isArray(value.parts) ||
    value.parts.length < 2 ||
    value.parts.length > MAX_DESIGN_BUNDLE_PARTS
  ) {
    throw new Error(`设计分片清单必须包含 2–${MAX_DESIGN_BUNDLE_PARTS} 个分片`);
  }
  const expectedPrefix = `designs/codesign-data/${value.sha256.slice(0, 16)}/${value.sha256}-`;
  let totalBytes = 0;
  const parts = value.parts.map((part, index) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      throw new Error(`设计分片 ${index + 1} 无效`);
    }
    assertExactKeys(part, new Set(["path", "bytes"]), `设计分片 ${index + 1}`);
    const expectedPath = `${expectedPrefix}${String(index + 1).padStart(3, "0")}.txt`;
    if (part.path !== expectedPath) {
      throw new Error(`设计分片 ${index + 1} 路径无效`);
    }
    if (
      !Number.isInteger(part.bytes) ||
      part.bytes < 1 ||
      part.bytes > MAX_DESIGN_BUNDLE_PART_BYTES
    ) {
      throw new Error(`设计分片 ${index + 1} 字节数无效`);
    }
    totalBytes += part.bytes;
    return { path: part.path, bytes: part.bytes };
  });
  if (totalBytes !== value.bytes) throw new Error("设计分片清单字节数与分片不一致");
  return {
    format: DESIGN_BUNDLE_FORMAT,
    bundleVersion: DESIGN_BUNDLE_VERSION,
    name: value.name,
    documentFormat: "codeshell.design",
    documentVersion: 3,
    bytes: value.bytes,
    sha256: value.sha256,
    parts,
  };
}

export function createDesignPersistencePlan({ source, name, sha256 }) {
  if (typeof source !== "string") throw new Error("设计源必须是 UTF-8 文本");
  const bytes = byteLength(source);
  if (bytes > MAX_DESIGN_DOCUMENT_BYTES) {
    throw new Error(
      `设计文件为 ${(bytes / 1024 / 1024).toFixed(2)} MiB，超过 ${MAX_DESIGN_DOCUMENT_BYTES / 1024 / 1024} MiB 逻辑文档上限`,
    );
  }
  if (bytes <= MAX_WORKSPACE_DESIGN_TEXT_BYTES) {
    return {
      mode: "single",
      bytes,
      primarySource: source,
      parts: [],
    };
  }
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) {
    throw new Error("大设计文件需要有效的 SHA-256 摘要");
  }
  const split = splitDesignSource(source);
  if (split.length > MAX_DESIGN_BUNDLE_PARTS) {
    throw new Error(`设计文件需要 ${split.length} 个分片，超过 ${MAX_DESIGN_BUNDLE_PARTS} 个上限`);
  }
  const prefix = `designs/codesign-data/${sha256.slice(0, 16)}/${sha256}-`;
  const parts = split.map((part, index) => ({
    ...part,
    path: `${prefix}${String(index + 1).padStart(3, "0")}.txt`,
  }));
  const manifest = normalizeDesignBundleManifest({
    format: DESIGN_BUNDLE_FORMAT,
    bundleVersion: DESIGN_BUNDLE_VERSION,
    name,
    documentFormat: "codeshell.design",
    documentVersion: 3,
    bytes,
    sha256,
    parts: parts.map(({ path, bytes: partBytes }) => ({ path, bytes: partBytes })),
  });
  return {
    mode: "bundle",
    bytes,
    primarySource: `${JSON.stringify(manifest, null, 2)}\n`,
    manifest,
    parts,
  };
}

export async function resolveDesignPersistenceSource({
  primarySource,
  readText,
  sha256,
}) {
  if (typeof primarySource !== "string") throw new Error("设计源必须是 UTF-8 文本");
  let parsed;
  try {
    parsed = JSON.parse(primarySource);
  } catch {
    return { mode: "single", source: primarySource, bytes: byteLength(primarySource) };
  }
  if (parsed?.format !== DESIGN_BUNDLE_FORMAT) {
    return { mode: "single", source: primarySource, bytes: byteLength(primarySource) };
  }
  if (typeof readText !== "function" || typeof sha256 !== "function") {
    throw new Error("读取大设计文件缺少分片读取或摘要能力");
  }
  const manifest = normalizeDesignBundleManifest(parsed);
  const contents = [];
  for (const [index, part] of manifest.parts.entries()) {
    const result = await readText(part.path);
    const content = typeof result === "string" ? result : result?.content;
    if (typeof content !== "string" || byteLength(content) !== part.bytes) {
      throw new Error(`设计分片 ${index + 1} 内容或字节数无效`);
    }
    contents.push(content);
  }
  const source = contents.join("");
  if (byteLength(source) !== manifest.bytes) throw new Error("设计分片重组后的字节数无效");
  const actualSha256 = await sha256(source);
  if (actualSha256 !== manifest.sha256) throw new Error("设计分片摘要校验失败");
  return {
    mode: "bundle",
    source,
    bytes: manifest.bytes,
    manifest,
  };
}
