import {
  hydrateProjectSnapshotDocuments,
  nextSnapshotShardGeneration,
  projectSnapshotShardDescriptors,
} from "./snapshot-sharding-model.mjs";

const FORMAT = "codeshell.job-hunt.snapshot-backup";
const PREFIX = "career-data/panel-backups/";
const GENERATION = /^g-[0-9a-f]{32}$/;
const CHUNK_CHARACTERS = 48 * 1024;
const MAX_PARTS = 4096;
export const MAX_SNAPSHOT_BACKUP_BYTES = 128 * 1024 * 1024;
const bytes = (text) => new TextEncoder().encode(text).byteLength;
const partPath = (generation, part) =>
  `${PREFIX}${generation}/part-${String(part + 1).padStart(4, "0")}.txt`;

async function digest(text) {
  if (!globalThis.crypto?.subtle) throw new Error("完整快照备份需要安全连接的校验能力");
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateBundle(bundle) {
  if (
    bundle?.format !== FORMAT ||
    bundle.version !== 1 ||
    typeof bundle.root !== "string" ||
    !Array.isArray(bundle.shards)
  )
    throw new Error("快照备份格式无效");
  const root = JSON.parse(bundle.root);
  if (![1, 2].includes(root?.schemaVersion)) throw new Error("快照备份根版本不受支持");
  const descriptors = projectSnapshotShardDescriptors(root);
  if (bundle.shards.length !== descriptors.length) throw new Error("快照备份分片数量不完整");
  const paths = new Set(descriptors.map((item) => item.path));
  const documents = new Map();
  for (const shard of bundle.shards) {
    if (!paths.delete(shard?.path) || typeof shard.content !== "string")
      throw new Error("快照备份含重复或无关分片");
    documents.set(shard.path, JSON.parse(shard.content));
  }
  return { root, hydrated: hydrateProjectSnapshotDocuments(root, documents) };
}

/** Capture original file text, including fields unknown to this Panel version. */
export async function createSnapshotBackup(
  previousSnapshot,
  { scope, beforeOperation = async () => {}, reason = "migration" },
) {
  scope.check();
  const root = JSON.parse(previousSnapshot.content);
  const shards = [];
  let operation = 0;
  const call = async (method, params) => {
    await beforeOperation(operation++);
    scope.check();
    const result = await scope.call(method, params);
    scope.check();
    return result;
  };
  let sourceBytes = bytes(previousSnapshot.content);
  for (const descriptor of projectSnapshotShardDescriptors(root)) {
    const result = await call("workspace.readText", { path: descriptor.path });
    if (typeof result?.content !== "string") throw new Error("无法读取原始快照分片");
    sourceBytes += bytes(result.content);
    if (sourceBytes > MAX_SNAPSHOT_BACKUP_BYTES) throw new Error("快照备份超过 128 MiB 上限");
    shards.push({ path: descriptor.path, content: result.content });
  }
  const bundle = { format: FORMAT, version: 1, root: previousSnapshot.content, shards };
  validateBundle(bundle);
  const source = JSON.stringify(bundle);
  const size = bytes(source);
  if (size > MAX_SNAPSHOT_BACKUP_BYTES) throw new Error("快照备份超过 128 MiB 上限");
  const sha256 = await digest(source);
  scope.check();
  const generation = nextSnapshotShardGeneration();
  let part = 0;
  for (let start = 0; start < source.length; ) {
    let end = Math.min(source.length, start + CHUNK_CHARACTERS);
    // Keep surrogate pairs together across real UTF-8 file boundaries.
    const last = source.charCodeAt(end - 1);
    if (end < source.length && last >= 0xd800 && last <= 0xdbff) end--;
    if (part >= MAX_PARTS) throw new Error("快照备份分块数量超出上限");
    await call("workspace.writeText", {
      path: partPath(generation, part++),
      content: source.slice(start, end),
      expectedModifiedAt: null,
    });
    start = end;
  }
  const manifest = {
    format: FORMAT,
    version: 1,
    generation,
    createdAt: new Date().toISOString(),
    reason,
    sha256,
    bytes: size,
    parts: part,
  };
  const path = `${PREFIX}${generation}/manifest.json`;
  // This is the only completion marker. Partial generations remain invisible
  // to a future recovery browser, and no original file has been changed.
  await call("workspace.writeText", {
    path,
    content: JSON.stringify(manifest),
    expectedModifiedAt: null,
  });
  return { path, manifest };
}

/** Reconstruct and verify every byte without changing any project file. */
export async function readSnapshotBackup(path, { scope, beforeOperation = async () => {} }) {
  const match = /^career-data\/panel-backups\/(g-[0-9a-f]{32})\/manifest\.json$/.exec(path);
  if (!match) throw new Error("快照备份路径无效");
  let operation = 0;
  const read = async (file) => {
    await beforeOperation(operation++);
    scope.check();
    const result = await scope.call("workspace.readText", { path: file });
    scope.check();
    if (typeof result?.content !== "string") throw new Error("快照备份文件缺失");
    return result.content;
  };
  const manifest = JSON.parse(await read(path));
  if (
    manifest?.format !== FORMAT ||
    manifest.version !== 1 ||
    !GENERATION.test(manifest.generation) ||
    manifest.generation !== match[1] ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes < 1 ||
    manifest.bytes > MAX_SNAPSHOT_BACKUP_BYTES ||
    !Number.isSafeInteger(manifest.parts) ||
    manifest.parts < 1 ||
    manifest.parts > MAX_PARTS
  ) {
    throw new Error("快照备份索引无效");
  }
  const contents = [];
  let actualBytes = 0;
  for (let part = 0; part < manifest.parts; part++) {
    const content = await read(partPath(manifest.generation, part));
    actualBytes += bytes(content);
    if (!content || actualBytes > manifest.bytes) throw new Error("快照备份长度不匹配");
    contents.push(content);
  }
  const source = contents.join("");
  if (actualBytes !== manifest.bytes || (await digest(source)) !== manifest.sha256)
    throw new Error("快照备份内容校验失败");
  scope.check();
  const bundle = JSON.parse(source);
  return { manifest, bundle, ...validateBundle(bundle) };
}
