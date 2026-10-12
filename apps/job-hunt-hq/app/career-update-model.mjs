import {
  CAREER_QA_CATEGORIES,
  careerRecordIdentity,
  normalizeCareerLibrary,
  upsertCareerSource,
  upsertCareerEpisode,
  upsertCareerQa,
} from "./career-library-model.mjs";
import { compareCareerLibrarySnapshots, createCareerLibrarySnapshot } from "./career-library-version-model.mjs";

export const CAREER_UPDATE_MAX_BYTES = 128 * 1024;
const KINDS = { sources: "sourceMaterials", episodes: "careerEpisodes", qa: "careerQa" };
const IDS = {
  sources: /^career-source-[A-Za-z0-9_-]{1,80}$/,
  episodes: /^career-episode-[A-Za-z0-9_-]{1,80}$/,
  qa: /^career-qa-[A-Za-z0-9_-]{1,80}$/,
  version: /^career-version-[A-Za-z0-9_-]{1,80}$/,
};
const SOURCE_FIELDS = {
  id: 100, provider: 80, title: 240, connectionId: 240, externalId: 240, url: 2000,
  author: 240, occurredAt: 80, fetchedAt: 80, excerpt: 16000, contentHash: 240, localRef: 1000,
};
const EPISODE_FIELDS = {
  id: 100, title: 240, project: 240, period: 240, repoId: 100, experienceId: 100,
  background: 12000, problem: 12000, myRole: 12000, decision: 12000, reason: 12000,
  tradeoffs: 12000, results: 12000, retrospective: 12000,
};
const QA_FIELDS = { id: 100, episodeId: 100, category: 80, question: 1200, answer: 12000, draftAnswer: 12000 };
const REQUIRED = { sources: ["id", "provider"], episodes: ["id", "title"], qa: ["id", "question"] };
const UPSERT = { sources: upsertCareerSource, episodes: upsertCareerEpisode, qa: upsertCareerQa };

function fail(path, reason) {
  throw new Error(`经历资料 JSON ${path}：${reason}；原资料未被修改`);
}

function strictObject(value, fields, required, path) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(path, "必须是 JSON 对象");
  if (Object.getOwnPropertySymbols(value).length) fail(path, "不接受非 JSON 属性");
  for (const key of Object.keys(value)) if (!fields.includes(key)) fail(`${path}.${key}`, "未知字段");
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "缺少必填字段");
}

function string(value, maximum, path, required = false, pattern = null) {
  if (typeof value !== "string") fail(path, "必须是字符串");
  // The career model stores UTF-16 strings. Reject overlong input before its
  // normalizer could slice an astral character or silently truncate a fact.
  if (value.length > maximum) fail(path, `超过 ${maximum} 字符`);
  if (required && !value.trim()) fail(path, "不能为空或仅为空白");
  if (pattern && !pattern.test(value)) fail(path, "ID 格式无效");
}

function list(value, maximum, itemLength, path, required = false, pattern = null) {
  if (!Array.isArray(value)) fail(path, "必须是数组");
  if (value.length > maximum) fail(path, `最多 ${maximum} 项`);
  for (let index = 0; index < value.length; index++) string(value[index], itemLength, `${path}[${index}]`, required, pattern);
}

function record(value, kind, index) {
  const path = `${kind}[${index}]`;
  const fields = kind === "sources" ? SOURCE_FIELDS : kind === "episodes" ? EPISODE_FIELDS : QA_FIELDS;
  const arrays = kind === "episodes" ? ["actions", "alternatives", "tags", "sourceIds"] : kind === "qa" ? ["sourceIds"] : [];
  strictObject(value, [...Object.keys(fields), ...arrays, "status"], REQUIRED[kind], path);
  for (const [key, maximum] of Object.entries(fields)) {
    if (Object.hasOwn(value, key)) string(value[key], maximum, `${path}.${key}`, REQUIRED[kind].includes(key), key === "id" ? IDS[kind] : null);
  }
  if (Object.hasOwn(value, "status") && value.status !== "draft") fail(`${path}.status`, "只允许 draft，JSON 更新不能确认或归档事实");
  if (kind === "sources" && !["externalId", "url", "localRef", "excerpt"].some((key) => typeof value[key] === "string" && value[key].trim())) fail(path, "材料需要 externalId、url、localRef 或实际摘录 excerpt");
  if (kind !== "sources" && Object.hasOwn(value, "sourceIds")) list(value.sourceIds, 40, 100, `${path}.sourceIds`, true, IDS.sources);
  if (kind === "episodes") {
    for (const key of ["actions", "alternatives"]) if (Object.hasOwn(value, key)) list(value[key], 40, 1000, `${path}.${key}`);
    if (Object.hasOwn(value, "tags")) list(value.tags, 20, 120, `${path}.tags`, true);
  }
  if (kind === "qa") {
    if (value.episodeId !== undefined && value.episodeId !== "" && !IDS.episodes.test(value.episodeId)) fail(`${path}.episodeId`, "ID 格式无效");
    if (value.category !== undefined && !CAREER_QA_CATEGORIES.includes(value.category)) fail(`${path}.category`, "不支持的问答分类");
  }
}

function validateDocument(value) {
  strictObject(value, ["format", "schemaVersion", "version", ...Object.keys(KINDS)], ["format", "schemaVersion", "version", ...Object.keys(KINDS)], "document");
  if (value.format !== "codeshell.career-update") fail("format", "必须是 codeshell.career-update");
  if (value.schemaVersion !== 1) fail("schemaVersion", "只支持版本 1");
  strictObject(value.version, ["id", "title", "summary"], ["id", "title"], "version");
  string(value.version.id, 100, "version.id", true, IDS.version);
  string(value.version.title, 240, "version.title", true);
  if (Object.hasOwn(value.version, "summary")) string(value.version.summary, 2000, "version.summary");
  let total = 0;
  for (const kind of Object.keys(KINDS)) {
    if (!Array.isArray(value[kind])) fail(kind, "必须是数组");
    if (value[kind].length > 25) fail(kind, "每批最多 25 条");
    total += value[kind].length;
    for (let index = 0; index < value[kind].length; index++) record(value[kind][index], kind, index);
  }
  if (!total) fail("document", "至少需要一条材料、经历或问答");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > CAREER_UPDATE_MAX_BYTES) fail("document", "UTF-8 大小超过 128 KiB");
  return structuredClone(value);
}

function rejectDuplicateKeys(text) {
  // JSON.parse proves the grammar first. This second pass only retains object
  // keys, including decoded escape sequences, which JSON.parse would overwrite.
  let offset = 0;
  const whitespace = () => { while (/\s/.test(text[offset] || "") && offset < text.length) offset++; };
  const quoted = () => {
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === "\\") offset++;
      else if (character === '"') break;
    }
    return JSON.parse(text.slice(start, offset));
  };
  const visit = (depth) => {
    if (depth > 64) fail("document", "嵌套层级过深");
    whitespace();
    if (text[offset] === "{") {
      offset++;
      whitespace();
      const keys = new Set();
      while (text[offset] !== "}") {
        const key = quoted();
        if (keys.has(key)) fail(key, "重复 JSON 属性");
        keys.add(key);
        whitespace();
        offset++;
        visit(depth + 1);
        whitespace();
        if (text[offset] === ",") { offset++; whitespace(); } else break;
      }
      offset++;
    } else if (text[offset] === "[") {
      offset++;
      whitespace();
      while (text[offset] !== "]") {
        visit(depth + 1);
        whitespace();
        if (text[offset] === ",") offset++; else break;
        whitespace();
      }
      offset++;
    } else if (text[offset] === '"') quoted();
    else while (offset < text.length && !/[\s,\]}]/.test(text[offset])) offset++;
  };
  visit(0);
}

export function parseCareerUpdate(text) {
  if (typeof text !== "string") fail("document", "需要原始 JSON 字符串");
  if (new TextEncoder().encode(text).byteLength > CAREER_UPDATE_MAX_BYTES) fail("document", "UTF-8 大小超过 128 KiB");
  let document;
  try { document = JSON.parse(text); } catch { fail("document", "不是有效的严格 JSON"); }
  rejectDuplicateKeys(text);
  return validateDocument(document);
}

function sourceIdentity(source) {
  return careerRecordIdentity("sources", { ...source, identityKey: "" });
}

function protectSourceIdentity(existing, input) {
  if (existing.provider !== input.provider.trim().toLocaleLowerCase()) fail(`sources.${input.id}.provider`, "已有材料的 provider 不可更换");
  for (const field of ["connectionId", "externalId", "url", "localRef"]) {
    if (existing[field] && Object.hasOwn(input, field) && existing[field] !== input[field].trim()) fail(`sources.${input.id}.${field}`, "已有材料的账号或定位不可更换；请使用新的材料 ID");
  }
}

function rejectArchived(record, kind) {
  if (record?.status === "archived") fail(`${kind}.${record.id}`, "已归档资料不可通过 JSON 更新复活");
}

function restoreOriginalRecords(original, baseline, next) {
  const result = { ...original };
  for (const [kind, field] of Object.entries(KINDS)) {
    const beforeById = new Map(baseline[field].map((item) => [item.id, item]));
    const originalById = new Map((original[field] || []).map((item) => [item.id, item]));
    result[field] = next[field].map((item) => {
      const before = beforeById.get(item.id);
      const old = originalById.get(item.id);
      if (!before || !old) return item;
      // Preserve unrelated records verbatim, including future extension fields.
      if (JSON.stringify(before) === JSON.stringify(item)) return old;
      const restored = { ...old, ...item };
      const history = kind === "sources" ? "history" : "revisions";
      restored[history] = item[history].map((entry, index) => {
        if (index < (old[history]?.length || 0)) return old[history][index];
        if (entry.reason === "superseded_proposal" && old.pendingRevision) return { ...entry, content: structuredClone(old.pendingRevision.content) };
        return entry;
      });
      if (JSON.stringify(before.pendingRevision) === JSON.stringify(item.pendingRevision)) restored.pendingRevision = old.pendingRevision ?? null;
      return restored;
    });
  }
  return result;
}

export function prepareCareerUpdate(state = {}, input, options = {}) {
  const document = validateDocument(input);
  // A malformed or duplicate existing record must never disappear through the
  // career normalizer's deduplication during an otherwise incremental update.
  createCareerLibrarySnapshot(state);
  const baseline = normalizeCareerLibrary(state);
  const sourceIdMap = {};
  const canonicalIds = new Set();
  const identities = new Set();
  for (const kind of Object.keys(KINDS)) {
    const seen = new Set();
    for (const record of document[kind]) {
      if (seen.has(record.id)) fail(`${kind}.${record.id}`, "同一批次 ID 重复");
      seen.add(record.id);
    }
  }
  for (const source of document.sources) {
    const exact = baseline.sourceMaterials.find((item) => item.id === source.id);
    if (exact) protectSourceIdentity(exact, source);
    const merged = { ...exact, ...source };
    const identity = sourceIdentity(merged);
    const matches = baseline.sourceMaterials.filter((item) => sourceIdentity(item) === identity);
    if (matches.length > 1 || (exact && matches.some((item) => item.id !== exact.id))) fail(`sources.${source.id}`, "材料身份与现有多条记录冲突");
    const existing = exact || matches[0];
    if (existing) protectSourceIdentity(existing, source);
    rejectArchived(existing, "sources");
    const id = existing?.id || source.id;
    if (!IDS.sources.test(id)) fail(`sources.${source.id}`, "匹配到不兼容的旧材料 ID，请先迁移材料");
    if (canonicalIds.has(id) || identities.has(identity)) fail(`sources.${source.id}`, "同一批次材料身份重复或存在歧义");
    identities.add(identity);
    canonicalIds.add(id);
    sourceIdMap[source.id] = id;
  }
  document.sources = document.sources.map((source) => ({ ...source, id: sourceIdMap[source.id] }));
  const sourceIds = new Set([...baseline.sourceMaterials.map((item) => item.id), ...Object.values(sourceIdMap)]);
  const episodeIds = new Set([...baseline.careerEpisodes.map((item) => item.id), ...document.episodes.map((item) => item.id)]);
  for (const kind of ["episodes", "qa"]) {
    document[kind] = document[kind].map((record) => {
      const existing = baseline[KINDS[kind]].find((item) => item.id === record.id);
      rejectArchived(existing, kind);
      const next = { ...record };
      if (record.sourceIds) next.sourceIds = record.sourceIds.map((id) => sourceIdMap[id] || id);
      for (const id of next.sourceIds || existing?.sourceIds || []) if (!sourceIds.has(id)) fail(`${kind}.${record.id}.sourceIds`, `来源不存在：${id}`);
      const episodeId = Object.hasOwn(next, "episodeId") ? next.episodeId : existing?.episodeId;
      if (kind === "qa" && episodeId && !episodeIds.has(episodeId)) fail(`qa.${record.id}.episodeId`, `经历不存在：${episodeId}`);
      return next;
    });
  }
  let next = { ...state, ...baseline };
  for (const kind of Object.keys(KINDS)) for (const record of document[kind]) next = UPSERT[kind](next, record, { actor: "agent", now: options.now });
  const updated = restoreOriginalRecords(state, baseline, next);
  const counts = Object.fromEntries(Object.keys(KINDS).map((kind) => [kind, document[kind].length]));
  counts.total = counts.sources + counts.episodes + counts.qa;
  return {
    state: updated, document, sourceIdMap,
    ids: Object.fromEntries(Object.keys(KINDS).map((kind) => [kind, document[kind].map((record) => record.id)])),
    counts, comparison: compareCareerLibrarySnapshots(state, updated),
  };
}
