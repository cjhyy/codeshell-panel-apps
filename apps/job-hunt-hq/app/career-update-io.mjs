import { parseCareerUpdate, CAREER_UPDATE_MAX_BYTES } from "./career-update-model.mjs";
import { createCareerLibrarySnapshot } from "./career-library-version-model.mjs";

const UPDATE_PATH = /^career-data\/updates\/[A-Za-z0-9_-]{1,100}\.json$/;

export async function careerUpdateDigest(value) {
  if (!globalThis.crypto?.subtle) throw new Error("知识库更新需要安全连接的校验能力");
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function readCareerUpdate(path, { scope } = {}) {
  if (typeof path !== "string" || !UPDATE_PATH.test(path)) throw new Error("更新文件必须位于当前项目 career-data/updates/<名称>.json，名称仅含字母、数字、下划线或连字符");
  scope.check();
  const file = await scope.call("workspace.readText", { path });
  scope.check();
  if (file.truncated) throw new Error("更新文件未完整读取，请拆成更小的 JSON 文件");
  if (file.size > CAREER_UPDATE_MAX_BYTES) throw new Error("更新文件超过128 KiB，请拆成更小的 JSON 文件");
  const document = parseCareerUpdate(file.content);
  // Host revisions hash the original bytes, including a UTF-8 BOM that its
  // decoder strips. Older hosts without revisions bind the decoded text.
  const sha256 = /^sha256:([0-9a-f]{64})$/.exec(file.revision || "")?.[1] || await careerUpdateDigest(file.content);
  scope.check();
  return { path, document, sha256 };
}

// The token binds the exact file and the entire working library/version index.
// No hidden in-memory preview session is needed; a repeated call cannot consume
// a stale preview after a file edit, new chat fact, or project switch.
export function careerUpdatePreviewToken(artifact, current, projectKey) {
  return careerUpdateDigest(JSON.stringify({ format: "codeshell.career-update-preview", projectKey,
    path: artifact.path, sha256: artifact.sha256,
    library: createCareerLibrarySnapshot(current), versions: current.careerLibraryVersions || [] }));
}
