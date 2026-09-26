export const PROJECT_SNAPSHOT_WRITE_LIMIT_BYTES = 384 * 1024;
export const PROJECT_SNAPSHOT_SAFE_BYTES = 360 * 1024;
export const PROJECT_SNAPSHOT_SHARD_TARGET_BYTES = 300 * 1024;
export const PROJECT_SNAPSHOT_MAX_SHARDS = 128;
export const PROJECT_SNAPSHOT_SHARD_FIELDS = [
  "jdIntakeItems",
  "jobLeads",
  "jobs",
  "repos",
  "experiences",
  "jobResearch",
  "workflowRuns",
  "resume",
  "versions",
  "questionBank",
  "interviewSets",
  "mockInterviewSessions",
  "preparationPlans",
  "interviewDebriefs",
];

// A practice set is a selection over the canonical question bank, not another
// copy of that bank. Runtime normalization hydrates the display fields from
// bankQuestionId, so only the stable local identity and the set-specific reason
// belong in the durable snapshot.
export const PROJECT_SNAPSHOT_SET_QUESTION_FIELDS = ["id", "bankQuestionId", "why"];

const ARRAY_FIELDS = new Set(PROJECT_SNAPSHOT_SHARD_FIELDS.filter((field) => field !== "resume"));

export function snapshotJsonBytes(value, pretty = false) {
  const json = `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`;
  return new TextEncoder().encode(json).byteLength;
}

function jsonDocument(value, pretty = false) {
  return `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function compactInterviewSetQuestion(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    id: typeof source.id === "string" ? source.id : "",
    bankQuestionId: typeof source.bankQuestionId === "string" ? source.bankQuestionId : "",
    why: typeof source.why === "string" ? source.why : "",
  };
}

/**
 * Remove materialized question-bank fields from practice sets before writing.
 * The in-memory model intentionally stays fully hydrated for rendering and
 * backwards compatibility; only the project representation is normalized.
 */
export function compactProjectSnapshotPayload(value) {
  const payload = clone(value) || {};
  payload.interviewSets = (Array.isArray(payload.interviewSets) ? payload.interviewSets : []).map(
    (set) => {
      const source = set && typeof set === "object" && !Array.isArray(set) ? set : {};
      return {
        ...source,
        questions: (Array.isArray(source.questions) ? source.questions : []).map(
          compactInterviewSetQuestion,
        ),
      };
    },
  );
  return payload;
}

export function projectSnapshotStorageNeedsMigration(rootInput, hydratedInput = rootInput) {
  const root =
    rootInput && typeof rootInput === "object" && !Array.isArray(rootInput) ? rootInput : {};
  const hydrated =
    hydratedInput && typeof hydratedInput === "object" && !Array.isArray(hydratedInput)
      ? hydratedInput
      : {};
  const hasMaterializedSetQuestion = (
    Array.isArray(hydrated.interviewSets) ? hydrated.interviewSets : []
  ).some((set) =>
    (Array.isArray(set?.questions) ? set.questions : []).some((question) =>
      Object.keys(question || {}).some(
        (field) => !PROJECT_SNAPSHOT_SET_QUESTION_FIELDS.includes(field),
      ),
    ),
  );
  const oversizedDirectRoot =
    !root.artifactStorage && snapshotJsonBytes(root) > PROJECT_SNAPSHOT_SAFE_BYTES;
  return hasMaterializedSetQuestion || oversizedDirectRoot;
}

function isSemanticDefault(value) {
  return (
    value === "" ||
    value === false ||
    value === 0 ||
    value === null ||
    (Array.isArray(value) && value.length === 0) ||
    (value && typeof value === "object" && Object.keys(value).length === 0)
  );
}

function semanticSnapshotValue(value, depth = 0) {
  if (Array.isArray(value)) return value.map((item) => semanticSnapshotValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (depth === 0 && ["updatedAt", "artifactStorage"].includes(key)) continue;
    const normalized = semanticSnapshotValue(value[key], depth + 1);
    // Older schema-v2 snapshots omit newly introduced defaults. Treat a
    // missing default and its explicit normalized form as the same value,
    // while still detecting non-empty -> empty user edits.
    if (isSemanticDefault(normalized)) continue;
    result[key] = normalized;
  }
  return result;
}

export function projectSnapshotSemanticKey(value) {
  return JSON.stringify(semanticSnapshotValue(value));
}

export function projectSnapshotsSemanticallyEqual(left, right) {
  return projectSnapshotSemanticKey(left) === projectSnapshotSemanticKey(right);
}

function hasFieldData(field, value) {
  if (ARRAY_FIELDS.has(field)) return Array.isArray(value) && value.length > 0;
  return Boolean(value && typeof value === "object" && String(value.markdown || "").trim());
}

const IMMUTABLE_GENERATION = /^g-[0-9a-f]{32}$/;

export function nextSnapshotShardGeneration() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `g-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function generationSchemaVersion(generation) {
  if (generation === "a" || generation === "b") return 1;
  if (typeof generation === "string" && IMMUTABLE_GENERATION.test(generation)) return 2;
  throw new Error("项目快照分片代号无效");
}

function shardPath(generation, field, part) {
  return `career-data/panel-shards/${generation}/${field}-${String(part).padStart(3, "0")}.json`;
}

function arrayShardValues(field, values, generation, targetBytes) {
  const parts = [];
  let current = [];
  const source = Array.isArray(values) ? values : [];
  for (const item of source) {
    const candidate = [...current, item];
    const envelope = {
      schemaVersion: generationSchemaVersion(generation),
      generation,
      field,
      kind: "array",
      part: parts.length + 1,
      total: 1,
      items: candidate,
    };
    if (current.length && snapshotJsonBytes(envelope) > targetBytes) {
      parts.push(current);
      current = [item];
      continue;
    }
    current = candidate;
  }
  if (current.length) parts.push(current);
  return parts;
}

function fieldShardDocuments(field, value, generation, targetBytes) {
  if (ARRAY_FIELDS.has(field)) {
    const parts = arrayShardValues(field, value, generation, targetBytes);
    return parts.map((items, index) => {
      const payload = {
        schemaVersion: generationSchemaVersion(generation),
        generation,
        field,
        kind: "array",
        part: index + 1,
        total: parts.length,
        items,
      };
      const content = jsonDocument(payload);
      const bytes = new TextEncoder().encode(content).byteLength;
      if (bytes > PROJECT_SNAPSHOT_SAFE_BYTES) {
        throw new Error(`${field} 中存在无法安全分片的超大记录（${bytes} bytes）`);
      }
      return { payload, content, bytes, count: items.length };
    });
  }
  const payload = {
    schemaVersion: generationSchemaVersion(generation),
    generation,
    field,
    kind: "value",
    part: 1,
    total: 1,
    value,
  };
  const content = jsonDocument(payload);
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes > PROJECT_SNAPSHOT_SAFE_BYTES) {
    throw new Error(`${field} 无法放入单个安全分片（${bytes} bytes）`);
  }
  return [{ payload, content, bytes, count: 1 }];
}

/**
 * Keep small projects human-readable in one file. Large projects move only
 * the biggest requested fields into bounded immutable shard files until the root
 * index is safely below the Host write ceiling.
 */
export function prepareProjectSnapshotDocuments(payload, rootDefaults = {}, options = {}) {
  const safeBytes = Math.min(
    PROJECT_SNAPSHOT_SAFE_BYTES,
    Math.max(32 * 1024, Number(options.safeBytes) || PROJECT_SNAPSHOT_SAFE_BYTES),
  );
  const targetBytes = Math.min(
    safeBytes - 1024,
    Math.max(16 * 1024, Number(options.shardTargetBytes) || PROJECT_SNAPSHOT_SHARD_TARGET_BYTES),
  );
  const generation = options.generation ?? nextSnapshotShardGeneration();
  generationSchemaVersion(generation);
  const directRoot = clone(payload) || {};
  delete directRoot.artifactStorage;
  const directContent = jsonDocument(directRoot, true);
  if (new TextEncoder().encode(directContent).byteLength <= safeBytes) {
    return { root: directRoot, rootContent: directContent, shards: [], generation: "" };
  }
  const compactDirectContent = jsonDocument(directRoot);
  if (new TextEncoder().encode(compactDirectContent).byteLength <= safeBytes) {
    return {
      root: directRoot,
      rootContent: compactDirectContent,
      shards: [],
      generation: "",
    };
  }

  const root = clone(directRoot);
  const candidates = PROJECT_SNAPSHOT_SHARD_FIELDS.filter((field) =>
    hasFieldData(field, root[field]),
  )
    .map((field) => ({ field, bytes: snapshotJsonBytes(root[field]) }))
    .sort((left, right) => right.bytes - left.bytes || left.field.localeCompare(right.field));
  const shards = [];

  for (const { field } of candidates) {
    const documents = fieldShardDocuments(field, root[field], generation, targetBytes);
    root[field] = clone(rootDefaults[field] ?? (ARRAY_FIELDS.has(field) ? [] : {}));
    for (const [index, document] of documents.entries()) {
      const path = shardPath(generation, field, index + 1);
      shards.push({
        path,
        field,
        kind: document.payload.kind,
        part: index + 1,
        total: documents.length,
        count: document.count,
        bytes: document.bytes,
        content: document.content,
        payload: document.payload,
      });
    }
    if (shards.length > PROJECT_SNAPSHOT_MAX_SHARDS) {
      throw new Error(
        `项目数据需要超过 ${PROJECT_SNAPSHOT_MAX_SHARDS} 个安全分片；请先归档过量历史记录`,
      );
    }
    root.artifactStorage = {
      schemaVersion: generationSchemaVersion(generation),
      generation,
      shards: shards.map(({ content: _content, payload: _payload, ...descriptor }) => descriptor),
    };
    if (snapshotJsonBytes(root) <= safeBytes) break;
  }

  if (!root.artifactStorage || snapshotJsonBytes(root) > safeBytes) {
    throw new Error(
      `项目快照索引仍超过安全写入上限（${snapshotJsonBytes(root)} bytes）；请先归档超大材料`,
    );
  }
  return {
    root,
    rootContent: jsonDocument(root),
    shards,
    generation,
  };
}

function validateShardPayload(descriptor, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return (
    payload.schemaVersion === descriptor.schemaVersion &&
    payload.generation === descriptor.generation &&
    payload.field === descriptor.field &&
    payload.kind === descriptor.kind &&
    payload.part === descriptor.part &&
    payload.total === descriptor.total &&
    (payload.kind === "array"
      ? Array.isArray(payload.items) && payload.items.length === descriptor.count
      : payload.kind === "value" && descriptor.count === 1)
  );
}

export function projectSnapshotShardDescriptors(rootInput) {
  const storage = rootInput?.artifactStorage;
  if (!storage) return [];
  if (
    !(
      (storage.schemaVersion === 1 && ["a", "b"].includes(storage.generation)) ||
      (storage.schemaVersion === 2 &&
        typeof storage.generation === "string" &&
        IMMUTABLE_GENERATION.test(storage.generation))
    ) ||
    !Array.isArray(storage.shards) ||
    storage.shards.length === 0 ||
    storage.shards.length > PROJECT_SNAPSHOT_MAX_SHARDS
  ) {
    throw new Error("项目快照分片索引无效");
  }
  const seenPaths = new Set();
  return storage.shards.map((descriptor) => {
    const field = String(descriptor?.field || "");
    const kind = descriptor?.kind;
    const part = Number(descriptor?.part);
    const total = Number(descriptor?.total);
    const path = String(descriptor?.path || "");
    const valid =
      PROJECT_SNAPSHOT_SHARD_FIELDS.includes(field) &&
      kind === (ARRAY_FIELDS.has(field) ? "array" : "value") &&
      Number.isInteger(part) &&
      Number.isInteger(total) &&
      part >= 1 &&
      total >= part &&
      total <= PROJECT_SNAPSHOT_MAX_SHARDS &&
      path === shardPath(storage.generation, field, part) &&
      !seenPaths.has(path);
    if (!valid) throw new Error(`项目快照分片索引项无效：${path || field || "unknown"}`);
    seenPaths.add(path);
    return { ...descriptor, field, kind, part, total, path };
  });
}

export function hydrateProjectSnapshotDocuments(rootInput, documentsByPath = new Map()) {
  const root = clone(rootInput) || {};
  const storage = root.artifactStorage;
  if (!storage) return root;
  const descriptors = projectSnapshotShardDescriptors(root);
  const grouped = new Map();
  for (const descriptor of descriptors) {
    const payload =
      documentsByPath instanceof Map
        ? documentsByPath.get(descriptor.path)
        : documentsByPath?.[descriptor.path];
    if (
      !validateShardPayload(
        { ...descriptor, generation: storage.generation, schemaVersion: storage.schemaVersion },
        payload,
      )
    ) {
      throw new Error(`项目快照分片无效或缺失：${descriptor.path}`);
    }
    const items = grouped.get(descriptor.field) || [];
    items.push({ descriptor, payload });
    grouped.set(descriptor.field, items);
  }
  for (const [field, entries] of grouped) {
    const ordered = entries.sort((left, right) => left.descriptor.part - right.descriptor.part);
    const total = ordered[0]?.descriptor.total || 0;
    if (
      !PROJECT_SNAPSHOT_SHARD_FIELDS.includes(field) ||
      ordered.length !== total ||
      ordered.some((entry, index) => entry.descriptor.part !== index + 1)
    ) {
      throw new Error(`项目快照分片序列不完整：${field}`);
    }
    root[field] =
      ordered[0].descriptor.kind === "array"
        ? ordered.flatMap((entry) => entry.payload.items)
        : clone(ordered[0].payload.value);
  }
  return root;
}
