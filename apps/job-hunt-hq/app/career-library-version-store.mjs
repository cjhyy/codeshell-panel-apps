import { prepareProjectSnapshotDocuments, projectSnapshotShardDescriptors, hydrateProjectSnapshotDocuments } from "./snapshot-sharding-model.mjs";
import { createCareerLibrarySnapshot, normalizeCareerLibraryVersion } from "./career-library-version-model.mjs";

const FORMAT = "codeshell.job-hunt.career-library-version";
const fields = new Set(["sourceMaterials", "careerEpisodes", "careerQa"]);
async function digest(value) {
  if (!globalThis.crypto?.subtle) throw new Error("知识库版本需要安全连接的校验能力");
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, "0")).join("");
}
function scopedCalls(scope, beforeOperation = async () => {}) {
  let index = 0;
  return async (method, params) => {
    await beforeOperation(index++);
    scope.check();
    const result = await scope.call(method, params);
    scope.check();
    return result;
  };
}

export async function readCareerLibraryVersion(versionInput, { scope, beforeOperation } = {}) {
  const version = normalizeCareerLibraryVersion(versionInput);
  if (!version) throw new Error("知识库版本索引无效");
  const call = scopedCalls(scope, beforeOperation);
  const file = await call("workspace.readText", { path: version.path });
  const manifest = JSON.parse(file.content);
  if (manifest?.format !== FORMAT || manifest.schemaVersion !== 1 || manifest.version?.id !== version.id || manifest.version?.path !== version.path || !/^[0-9a-f]{64}$/.test(manifest.sha256 || "") || (version.sha256 && version.sha256 !== manifest.sha256)) throw new Error("知识库版本清单无效或已变化");
  const documents = new Map();
  for (const descriptor of projectSnapshotShardDescriptors(manifest.root)) {
    if (!fields.has(descriptor.field) || manifest.root.artifactStorage?.schemaVersion !== 2) throw new Error("知识库版本含无关或可变分片");
    const shard = await call("workspace.readText", { path: descriptor.path });
    documents.set(descriptor.path, JSON.parse(shard.content));
  }
  const snapshot = createCareerLibrarySnapshot(hydrateProjectSnapshotDocuments(manifest.root, documents));
  if (await digest(snapshot) !== manifest.sha256) throw new Error("知识库版本内容校验失败，历史内容未被采用");
  scope.check();
  return { version: { ...manifest.version, sha256: manifest.sha256 }, snapshot };
}

// A version is a separate, immutable knowledge artifact. Its completion marker
// is written after its create-only shards; attaching the marker to the current
// project happens in the caller's normal compare-and-save transaction.
export async function writeCareerLibraryVersion(versionInput, snapshotInput, { scope, beforeOperation } = {}) {
  const version = normalizeCareerLibraryVersion(versionInput);
  if (!version) throw new Error("知识库版本信息无效");
  const snapshot = createCareerLibrarySnapshot(snapshotInput);
  const sha256 = await digest(snapshot);
  scope.check();
  const completeVersion = { ...version, sha256 };
  const prepared = prepareProjectSnapshotDocuments(snapshot);
  const call = scopedCalls(scope, beforeOperation);
  for (const shard of prepared.shards) await call("workspace.writeText", { path: shard.path, content: shard.content, expectedModifiedAt: null });
  await call("workspace.writeText", {
    path: version.path,
    content: JSON.stringify({ format: FORMAT, schemaVersion: 1, version: completeVersion, sha256, root: prepared.root }),
    expectedModifiedAt: null,
  });
  return completeVersion;
}
