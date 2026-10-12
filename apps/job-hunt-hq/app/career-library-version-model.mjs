export const CAREER_LIBRARY_VERSION_LIMIT = 100;
export const CAREER_LIBRARY_SNAPSHOT_SCHEMA_VERSION = 1;

const KINDS = { sources: "sourceMaterials", episodes: "careerEpisodes", qa: "careerQa" };
const VERSION_ID = /^career-version-[A-Za-z0-9_-]{1,80}$/;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function versionId(value, optional = false) {
  if (optional && (value === undefined || value === null || value === "")) return "";
  if (typeof value !== "string" || !VERSION_ID.test(value)) throw new Error("经历问答库版本 ID 无效；需要 career-version- 加 1–80 位字母、数字、下划线或连字符");
  return value;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function jsonClone(value) {
  // Validate before cloning so a JSON write cannot silently omit an undefined,
  // non-finite or non-JSON value from the supposedly complete historical copy.
  const ancestors = new Set();
  const validate = (item) => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object" || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)) throw new Error("经历问答库包含无法完整保存为 JSON 的内容，原资料未被覆盖");
    if (ancestors.has(item)) throw new Error("经历问答库存在循环引用，原资料未被覆盖");
    ancestors.add(item);
    for (const child of Array.isArray(item) ? item : Object.values(item)) validate(child);
    ancestors.delete(item);
  };
  validate(value);
  return structuredClone(value);
}

export function createCareerLibrarySnapshot(stateInput = {}) {
  const input = object(stateInput);
  const snapshot = { schemaVersion: CAREER_LIBRARY_SNAPSHOT_SCHEMA_VERSION };
  for (const field of Object.values(KINDS)) {
    const records = input[field] === undefined ? [] : input[field];
    if (!Array.isArray(records)) throw new Error(`${field} 必须是完整记录数组`);
    const ids = new Set();
    for (const record of records) {
      if (!record || Array.isArray(record) || typeof record !== "object" || typeof record.id !== "string" || !record.id || record.id.length > 100) throw new Error(`${field} 中的记录缺少稳定 ID`);
      if (ids.has(record.id)) throw new Error(`${field} 中存在重复 ID：${record.id}`);
      ids.add(record.id);
    }
    snapshot[field] = jsonClone(records);
  }
  return freeze(snapshot);
}

function unresolvedCounts(snapshot) {
  const counts = { sources: 0, episodes: 0, qa: 0, total: 0, pending: 0 };
  for (const [kind, field] of Object.entries(KINDS)) {
    for (const record of snapshot[field]) {
      if (record.status === "archived") continue;
      if (record.pendingRevision) counts.pending++;
      if (record.status !== "confirmed" || record.pendingRevision || (kind === "qa" && !text(record.answer, 12000))) counts[kind]++;
    }
    counts.total += counts[kind];
  }
  return counts;
}

function snapshotCounts(snapshot) {
  const unresolved = unresolvedCounts(snapshot);
  const counts = Object.fromEntries(Object.entries(KINDS).map(([kind, field]) => [kind, snapshot[field].length]));
  return { ...counts, total: counts.sources + counts.episodes + counts.qa, unresolved: unresolved.total, pending: unresolved.pending };
}

function normalizeCounts(input) {
  return Object.fromEntries(["sources", "episodes", "qa", "total", "unresolved", "pending"].map((key) => {
    const value = Number(object(input)[key]);
    return [key, Number.isFinite(value) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))) : 0];
  }));
}

export function normalizeCareerLibraryVersion(input = {}) {
  const value = object(input);
  const id = versionId(value.id);
  const path = `career-data/library-versions/${id}.json`;
  if (value.path !== undefined && value.path !== path) throw new Error("经历问答库版本路径必须与版本 ID 精确对应");
  const createdAt = text(value.createdAt, 80);
  if (createdAt && !Number.isFinite(Date.parse(createdAt))) throw new Error("经历问答库版本创建时间无效");
  const hasHash = value.sha256 !== undefined && value.sha256 !== "";
  const sha256 = hasHash ? value.sha256 : "";
  if (hasHash && (typeof sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(sha256))) throw new Error("经历问答库版本 SHA-256 无效");
  return {
    id, title: text(value.title, 240) || "经历与问答库版本", summary: text(value.summary, 3000),
    createdAt, sessionId: text(value.sessionId, 200), baseVersionId: versionId(value.baseVersionId, true),
    path, counts: normalizeCounts(value.counts), status: "saved", ...(sha256 ? { sha256: sha256.toLowerCase() } : {}),
  };
}

export function normalizeCareerLibraryVersions(input = []) {
  if (!Array.isArray(input)) throw new Error("经历问答库版本索引必须是数组");
  const seen = new Set();
  return input.map((item) => {
    const version = normalizeCareerLibraryVersion(item);
    if (seen.has(version.id)) throw new Error(`经历问答库版本 ID 重复：${version.id}`);
    seen.add(version.id);
    return version;
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function compareCareerLibrarySnapshots(previousInput = {}, nextInput = {}) {
  const previous = createCareerLibrarySnapshot(previousInput);
  const next = createCareerLibrarySnapshot(nextInput);
  const changes = [];
  const counts = { added: 0, updated: 0, archived: 0 };
  for (const [kind, field] of Object.entries(KINDS)) {
    const beforeById = new Map(previous[field].map((record) => [record.id, record]));
    const afterById = new Map(next[field].map((record) => [record.id, record]));
    const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
    for (const id of ids) {
      const before = beforeById.get(id) || null;
      const after = afterById.get(id) || null;
      if (before && after && JSON.stringify(canonical(before)) === JSON.stringify(canonical(after))) continue;
      const type = !before ? "added" : !after || (before.status !== "archived" && after.status === "archived") ? "archived" : "updated";
      counts[type]++;
      changes.push({ kind, id, type, before, after, ...(!after ? { missing: true } : {}) });
    }
  }
  return freeze({ changes, counts, unresolved: unresolvedCounts(next) });
}

export function prepareCareerLibraryVersion(stateInput = {}, metadataInput = {}, options = {}) {
  const state = object(stateInput);
  const versions = normalizeCareerLibraryVersions(options.versions === undefined ? state.careerLibraryVersions || [] : options.versions);
  const id = versionId(object(metadataInput).id);
  if (versions.some((version) => version.id === id)) throw new Error(`经历问答库版本 ${id} 已存在；不得覆盖原版，请先核对现有文件或使用新 ID`);
  if (versions.length >= CAREER_LIBRARY_VERSION_LIMIT) throw new Error("已保存 100 个经历问答库版本；不会自动删除旧版，请先导出或另建项目保存后续版本");
  const snapshot = createCareerLibrarySnapshot(state);
  const version = normalizeCareerLibraryVersion({ ...object(metadataInput), createdAt: object(metadataInput).createdAt || new Date().toISOString(), counts: snapshotCounts(snapshot) });
  if (version.baseVersionId && !versions.some((item) => item.id === version.baseVersionId)) throw new Error("经历问答库基础版本不存在，请先读取并选择已保存版本");
  return freeze({ version, snapshot, comparison: compareCareerLibrarySnapshots(options.previousSnapshot || {}, snapshot) });
}
