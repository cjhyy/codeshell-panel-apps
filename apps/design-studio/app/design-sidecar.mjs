import { isSafeDesignPath } from "./document.mjs";
import { splitDesignSource } from "./document-bundle.mjs";

export const MAX_DESIGN_SIDECAR_BYTES = 64 * 1024 * 1024;
export const DESIGN_SIDECAR_PART_BYTES = 350 * 1024;
const HASH = /^[0-9a-f]{64}$/u;
const encode = (value) => new TextEncoder().encode(value);
const suffixes = new Set([".figma-source.json", ".prototype.json", ".comments.json"]);

export function designSidecarPath(path, suffix) {
  if (!isSafeDesignPath(path) || !suffixes.has(suffix)) throw Error("设计附属文件路径无效");
  return path.replace(/\.codesign\.json$/u, suffix);
}

export function isMissingDesignSidecar(error) {
  return (
    ["ENOENT", "NOT_FOUND", "WORKSPACE_PATH_NOT_FOUND", "FILE_NOT_FOUND"].includes(
      error?.code ?? error?.error?.code,
    ) ||
    /^(?:file (?:not found|missing)|文件不存在|ENOENT: no such file or directory)(?:$|[,：:\s])/iu.test(
      error?.message ?? "",
    )
  );
}

export async function createDesignSidecarPlan(content, { sha256 }) {
  const bytes = typeof content === "string" ? encode(content).length : 0;
  if (!bytes || bytes > MAX_DESIGN_SIDECAR_BYTES) throw Error("设计附属文件必须是 1 B–64 MiB 文本");
  if (bytes <= DESIGN_SIDECAR_PART_BYTES) return { primarySource: content, parts: [] };
  const hash = await sha256(content);
  if (!HASH.test(hash)) throw Error("设计附属文件摘要无效");
  const parts = [];
  for (const [index, part] of splitDesignSource(content, DESIGN_SIDECAR_PART_BYTES).entries()) {
    const digest = await sha256(part.content);
    if (!HASH.test(digest)) throw Error("设计附属分片摘要无效");
    parts.push({
      path: `designs/codesign-data/attachments/${hash}/${index + 1}-${digest}.txt`,
      content: part.content,
      bytes: part.bytes,
      sha256: digest,
    });
  }
  return {
    primarySource: JSON.stringify({
      format: "codeshell.design.sidecar",
      version: 1,
      bytes,
      sha256: hash,
      parts: parts.map(({ path, bytes: partBytes, sha256: digest }) => ({
        path,
        bytes: partBytes,
        sha256: digest,
      })),
    }),
    parts,
  };
}

export async function readDesignSidecar({ path, call, check = () => {}, sha256 }) {
  check();
  const result = await call("workspace.readText", { path });
  check();
  if (typeof result?.content !== "string") throw Error("设计附属文件读取失败");
  let manifest;
  try {
    manifest = JSON.parse(result.content);
  } catch {
    return result;
  }
  if (manifest?.format !== "codeshell.design.sidecar") return result;
  if (
    manifest.version !== 1 ||
    !HASH.test(manifest.sha256) ||
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes <= DESIGN_SIDECAR_PART_BYTES ||
    manifest.bytes > MAX_DESIGN_SIDECAR_BYTES ||
    !Array.isArray(manifest.parts) ||
    manifest.parts.length < 2 ||
    manifest.parts.length > 256
  ) {
    throw Error("设计附属分片清单无效");
  }
  const contents = [],
    paths = new Set();
  let total = 0;
  for (const [index, part] of manifest.parts.entries()) {
    const expectedPath = `designs/codesign-data/attachments/${manifest.sha256}/${index + 1}-${part.sha256}.txt`;
    if (
      !HASH.test(part.sha256) ||
      part.path !== expectedPath ||
      paths.has(part.path) ||
      !Number.isSafeInteger(part.bytes) ||
      part.bytes < 1 ||
      part.bytes > DESIGN_SIDECAR_PART_BYTES
    ) {
      throw Error("设计附属分片路径或大小无效");
    }
    paths.add(part.path);
    total += part.bytes;
    if (total > manifest.bytes) throw Error("设计附属分片大小不匹配");
    check();
    let entry;
    try {
      entry = await call("workspace.readText", { path: part.path });
    } catch (error) {
      check();
      throw Object.assign(new Error(`设计附属分片无法读取：${part.path}`, { cause: error }), {
        code: "SIDECAR_INCOMPLETE",
      });
    }
    check();
    if (
      typeof entry?.content !== "string" ||
      encode(entry.content).length !== part.bytes ||
      (await sha256(entry.content)) !== part.sha256
    )
      throw Error("设计附属分片校验失败");
    check();
    contents.push(entry.content);
  }
  const content = contents.join("");
  if (total !== manifest.bytes || (await sha256(content)) !== manifest.sha256)
    throw Error("设计附属文件摘要不匹配");
  check();
  return { ...result, content };
}

export async function writeDesignSidecar({
  path,
  content,
  expectedRevision,
  expectedModifiedAt,
  call,
  check = () => {},
  sha256,
}) {
  const plan = await createDesignSidecarPlan(content, { sha256 });
  check();
  for (const part of plan.parts) {
    check();
    try {
      await call("workspace.writeText", {
        path: part.path,
        content: part.content,
        expectedModifiedAt: null,
      });
    } catch (error) {
      check();
      let existing;
      try {
        existing = await call("workspace.readText", { path: part.path });
      } catch {
        check();
        throw error;
      }
      check();
      if (existing?.content !== part.content) throw Error("设计附属分片内容冲突");
    }
    check();
  }
  const result = await call("workspace.writeText", {
    path,
    content: plan.primarySource,
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    ...(expectedModifiedAt !== undefined ? { expectedModifiedAt } : {}),
  });
  check();
  return result;
}
