import { splitDesignSource } from "./document-bundle.mjs";

export const MAX_INLINE_RECOVERY_BYTES = 180 * 1024;
export const RECOVERY_POINTER_FORMAT = "codeshell.design.recovery-pointer";

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

export function recoveryPartPath(sha256, index) {
  if (
    typeof sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(sha256) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= 4_096
  ) {
    throw new Error("恢复日志分片参数无效");
  }
  return `designs/codesign-data/recovery/${sha256.slice(0, 16)}/${sha256}-${String(index + 1).padStart(4, "0")}.txt`;
}

export async function createRecoveryPersistencePlan({
  snapshot,
  sha256,
  inlineByteLimit = MAX_INLINE_RECOVERY_BYTES,
}) {
  if (typeof sha256 !== "function") throw new Error("恢复日志需要 SHA-256 能力");
  const source = `${JSON.stringify(snapshot)}\n`;
  const bytes = byteLength(source);
  if (bytes <= inlineByteLimit) {
    return { mode: "inline", value: snapshot, bytes, parts: [] };
  }
  const digest = await sha256(source);
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error("恢复日志摘要无效");
  }
  const split = splitDesignSource(source);
  return {
    mode: "external",
    bytes,
    parts: split.map((part, index) => ({
      path: recoveryPartPath(digest, index),
      content: part.content,
      bytes: part.bytes,
    })),
    value: {
      format: RECOVERY_POINTER_FORMAT,
      version: 1,
      workspaceRoot: snapshot.workspaceRoot,
      path: snapshot.path,
      sha256: digest,
      bytes,
      partCount: split.length,
    },
  };
}

export async function resolveRecoveryPersistence({ value, readText, sha256 }) {
  if (value?.format !== RECOVERY_POINTER_FORMAT) return value;
  if (
    value.version !== 1 ||
    typeof value.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    !Number.isInteger(value.partCount) ||
    value.partCount < 1 ||
    value.partCount > 4_096 ||
    typeof readText !== "function" ||
    typeof sha256 !== "function"
  ) {
    throw new Error("恢复日志指针无效");
  }
  const contents = [];
  for (let index = 0; index < value.partCount; index += 1) {
    const result = await readText(recoveryPartPath(value.sha256, index));
    const content = typeof result === "string" ? result : result?.content;
    if (typeof content !== "string" || content.length < 1) {
      throw new Error(`恢复日志分片 ${index + 1} 无效`);
    }
    contents.push(content);
  }
  const source = contents.join("");
  if (byteLength(source) !== value.bytes || (await sha256(source)) !== value.sha256) {
    throw new Error("恢复日志内容校验失败");
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("恢复日志不是有效 JSON");
  }
}
