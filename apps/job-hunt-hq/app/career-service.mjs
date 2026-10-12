import {
  careerRecordId,
  CAREER_RECORD_MAX_BYTES,
  normalizeCareerLibrary,
  upsertCareerSource,
  upsertCareerEpisode,
  upsertCareerQa,
} from "./career-library-model.mjs";
import {
  compareCareerLibrarySnapshots,
  createCareerLibrarySnapshot,
  prepareCareerLibraryVersion,
} from "./career-library-version-model.mjs";
import { readCareerLibraryVersion, writeCareerLibraryVersion } from "./career-library-version-store.mjs";
import { readCareerUpdate, careerUpdatePreviewToken } from "./career-update-io.mjs";
import { prepareCareerUpdate } from "./career-update-model.mjs";

const COLLECTIONS = { sources: "sourceMaterials", episodes: "careerEpisodes", qa: "careerQa" };
const MODES = ["source", "episode", "qa", "library_version", "career_update"];
const UPSERT = { source: upsertCareerSource, episode: upsertCareerEpisode, qa: upsertCareerQa };
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const missing = (error) => /ENOENT|no such file|file not found/i.test(error?.message || "");
const text = (value, maximum) => typeof value === "string" ? value.trim().slice(0, maximum) : "";

function object(value, name, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name}必须是对象`);
  if (allowed && Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${name}包含不支持的字段`);
}

function versions(current) { return current.careerLibraryVersions || []; }

// The older record model normalizes the complete library for its own checks.
// Restore untouched records and extension fields instead of projecting that
// normalized view back over the caller's complete persisted document.
function preserveOriginalRecords(current, baseline, next) {
  const result = { ...next };
  for (const [kind, field] of Object.entries(COLLECTIONS)) {
    const originals = new Map((current[field] || []).map(record => [record.id, record]));
    const normalized = new Map(baseline[field].map(record => [record.id, record]));
    result[field] = next[field].map(record => {
      const original = originals.get(record.id), before = normalized.get(record.id);
      if (!original || !before) return record;
      if (equal(before, record)) return structuredClone(original);
      const restored = { ...structuredClone(original), ...record };
      for (const key of Object.keys(before)) {
        if (Object.hasOwn(original, key) && equal(before[key], record[key])) restored[key] = structuredClone(original[key]);
      }
      const restoreContent = candidate => Object.fromEntries(Object.entries(candidate).map(([key, value]) => {
        if (Object.hasOwn(original, key) && equal(before[key], value)) return [key, structuredClone(original[key])];
        if (original.pendingRevision && equal(before.pendingRevision?.content?.[key], value)
          && Object.hasOwn(original.pendingRevision.content, key)) return [key, structuredClone(original.pendingRevision.content[key])];
        return [key, value];
      }));
      if (restored.pendingRevision) restored.pendingRevision = { ...restored.pendingRevision, content: restoreContent(restored.pendingRevision.content) };
      const history = kind === "sources" ? "history" : "revisions";
      restored[history] = record[history].map((entry, index) => {
        if (index < (original[history]?.length || 0)) return structuredClone(original[history][index]);
        if (entry.reason === "superseded_proposal" && original.pendingRevision) return { ...entry, content: structuredClone(original.pendingRevision.content) };
        return { ...entry, content: restoreContent(entry.content) };
      });
      if (new TextEncoder().encode(JSON.stringify(restored)).byteLength > CAREER_RECORD_MAX_BYTES) throw new Error("这条资料及其修订历史超过单记录安全容量；原资料未被修改");
      return restored;
    });
  }
  return result;
}

/** Return a new state; accepted public claims become stale when their facts change. */
export function invalidateCareerEvidenceState(previous, next) {
  const changedIds = new Set(Object.values(COLLECTIONS).flatMap(field => {
    const before = new Map((previous[field] || []).map(record => [record.id, record]));
    return (next[field] || []).filter(record => {
      const old = before.get(record.id);
      return old && (old.version !== record.version || old.status !== record.status || !equal(old.pendingRevision, record.pendingRevision));
    }).map(record => record.id);
  }));
  const invalidate = resume => {
    if (!resume || !Array.isArray(resume.claimEvidence)) return resume;
    return { ...resume, claimEvidence: resume.claimEvidence.map(evidence =>
      [...(evidence.sourceIds || []), ...(evidence.episodeIds || []), ...(evidence.qaIds || [])].some(id => changedIds.has(id))
        ? { ...evidence, status: "needs_review" } : evidence) };
  };
  return { ...next, ...(next.resume ? { resume: invalidate(next.resume) } : {}),
    ...(Array.isArray(next.versions) ? { versions: next.versions.map(invalidate) } : {}) };
}

/** UI history and headless reads share the same immutable snapshot comparison. */
export async function previewCareerLibrary(current, id = "", { scope, beforeOperation } = {}) {
  scope.check();
  const index = versions(current);
  const version = id ? index.find(item => item.id === id) : null;
  if (id && !version) throw new Error("未找到知识库版本");
  const snapshot = version
    ? (await readCareerLibraryVersion(version, { scope, beforeOperation })).snapshot
    : createCareerLibrarySnapshot(current);
  scope.check();
  const base = version ? index.find(item => item.id === version.baseVersionId) : index.at(-1);
  if (version?.baseVersionId && !base) throw new Error("前一版索引缺失，不能可靠比较版本");
  const previous = base
    ? (await readCareerLibraryVersion(base, { scope, beforeOperation })).snapshot
    : createCareerLibrarySnapshot({});
  scope.check();
  return { version, snapshot, comparison: compareCareerLibrarySnapshots(previous, snapshot) };
}

function previewReceipt(current, { comparison }) {
  return { saved: false, preview: true, baseVersionId: versions(current).at(-1)?.id || "",
    counts: comparison.counts, unresolved: comparison.unresolved,
    changes: comparison.changes.slice(0, 50).map(change => ({ kind: change.kind, id: change.id, type: change.type,
      title: text(change.after?.title || change.after?.question || change.after?.url || change.before?.title || change.before?.question, 240),
      beforeStatus: change.before?.status || null, afterStatus: change.after?.status || null })),
    totalChanges: comparison.changes.length, changesTruncated: comparison.changes.length > 50,
    message: "预览未保存。知识库版本包含经历、决策、问答和待核对标记；需要时另行生成简历。" };
}

async function storeVersion(current, input, { scope, beforeOperation, sessionId, now }) {
  const index = versions(current);
  const snapshot = createCareerLibrarySnapshot(current);
  const existing = input.id && index.find(item => item.id === input.id);
  if (existing) {
    const historical = await readCareerLibraryVersion(existing, { scope, beforeOperation });
    if (!equal(historical.snapshot, snapshot) || existing.title !== input.title.trim() || existing.summary !== (input.summary || "").trim()) throw new Error("这个版本ID已保存另一份内容，请使用新的版本ID；历史内容没有覆盖");
    return { version: existing, state: current };
  }
  const base = index.at(-1);
  const previousSnapshot = base
    ? (await readCareerLibraryVersion(base, { scope, beforeOperation })).snapshot
    : createCareerLibrarySnapshot({});
  scope.check();
  const prepared = prepareCareerLibraryVersion(current, {
    id: input.id || `career-version-${crypto.randomUUID()}`, title: input.title, summary: input.summary || "",
    createdAt: input.createdAt || now, sessionId, baseVersionId: base?.id || "",
    ...(input.updateSha256 ? { updateSha256: input.updateSha256 } : {}),
  }, { versions: index, previousSnapshot });
  if (!prepared.comparison.changes.length) throw new Error("当前没有新的知识库改动，可以继续在聊天中补充。");
  let saved;
  try {
    const recovered = await readCareerLibraryVersion(prepared.version, { scope, beforeOperation });
    if (!equal(recovered.snapshot, snapshot) || recovered.version.title !== prepared.version.title || recovered.version.summary !== prepared.version.summary || recovered.version.baseVersionId !== prepared.version.baseVersionId || recovered.version.updateSha256 !== prepared.version.updateSha256) throw new Error("这个版本ID已保存另一份内容，请使用新的版本ID；历史内容没有覆盖");
    saved = recovered.version;
  } catch (error) {
    scope.check();
    if (!missing(error)) throw error;
    saved = await writeCareerLibraryVersion(prepared.version, prepared.snapshot, { scope, beforeOperation });
  }
  return { version: saved, state: { ...current, careerLibraryVersions: [...index, saved] } };
}

async function updateOperation(current, input, options) {
  const { scope, projectKey, beforeOperation } = options;
  object(input, "career_update", ["action", "path", "preview_token"]);
  if (!["preview", "apply"].includes(input.action)) throw new Error("career_update.action必须是preview或apply");
  if (input.action === "preview" && Object.hasOwn(input, "preview_token")) throw new Error("preview不使用preview_token");
  if (input.action === "apply" && (typeof input.preview_token !== "string" || !/^[0-9a-f]{64}$/.test(input.preview_token))) throw new Error("apply需要最近一次preview返回的preview_token");
  if (typeof projectKey !== "string" || !projectKey.trim()) throw new Error("JSON更新需要稳定的projectKey");
  if (current.careerDraft?.dirty) throw new Error("请先保存或退出未保存的手工编辑，再接收聊天整理的JSON");
  await beforeOperation?.(0);
  scope.check();
  const artifact = await readCareerUpdate(input.path, { scope });
  const { document, sha256 } = artifact;
  const assertSameUpdate = version => {
    if (version.updateSha256 !== sha256 || version.title !== document.version.title.trim() || version.summary !== (document.version.summary || "").trim()) throw new Error("这个版本ID已用于另一份内容，请为新的JSON使用新版本ID；历史没有覆盖");
  };
  const existing = versions(current).find(item => item.id === document.version.id);
  if (existing) assertSameUpdate(existing);
  if (input.action === "preview") {
    const preview_token = await careerUpdatePreviewToken(artifact, current, projectKey);
    scope.check();
    if (existing) return { state: current, result: { saved: false, preview: true, alreadyApplied: true, path: artifact.path, preview_token,
      libraryVersion: existing, message: "这份JSON已经保存；重复接收会返回原版本，后续编辑会保留。" } };
    const plan = prepareCareerUpdate(current, document, { now: options.now });
    return { state: current, result: { ...previewReceipt(current, plan), path: artifact.path, preview_token,
      version: document.version, incoming: plan.counts,
      message: "JSON已校验，尚未写入。apply会一次保存这些增量和命名知识库版本，保留已有资料与待核对标记。" } };
  }
  if (existing) {
    const historical = await readCareerLibraryVersion(existing, { scope, beforeOperation });
    assertSameUpdate(historical.version);
    return { state: current, result: updateReceipt(existing, artifact.path, true) };
  }
  if (await careerUpdatePreviewToken(artifact, current, projectKey) !== input.preview_token) throw new Error("JSON或知识库已变化，请重新preview后再apply；已有资料未改动");
  scope.check();
  let now = options.now;
  try {
    const orphan = await readCareerLibraryVersion(document.version, { scope, beforeOperation });
    assertSameUpdate(orphan.version);
    now = orphan.version.createdAt;
  } catch (error) {
    scope.check();
    if (!missing(error)) throw error;
  }
  const plan = prepareCareerUpdate(current, document, { now });
  const stored = await storeVersion(plan.state, { ...document.version, createdAt: now, updateSha256: sha256 }, { ...options, now });
  return { state: stored.state, result: updateReceipt(stored.version, artifact.path, false) };
}

function updateReceipt(version, path, idempotent) {
  return { saved: true, projectSaved: true, idempotent, path, libraryVersion: version,
    message: idempotent ? "这份JSON已保存为此版本，后续编辑已保留。" : "已接收JSON并保存知识库新版本，可直接在面板查看；未生成简历。" };
}

/**
 * Plan one career operation without DOM or project-root writes. Immutable
 * history may be created first. The caller must CAS-commit returned state before
 * publishing a success receipt, and adopt nothing when that commit fails.
 * options.expectedSnapshot is an internal UI save guard, never an Agent field.
 */
export async function runCareerCandidateOperation(current, args, options = {}) {
  object(current, "current");
  object(args, "save_candidate_context", [...MODES, "confirmation", "trace_id"]);
  const selected = MODES.filter(key => Object.hasOwn(args, key));
  if (selected.length !== 1) throw new Error("每次仅使用一个经历库操作，不能与全量候选人资料混合");
  const mode = selected[0], input = args[mode];
  object(input, mode);
  const hasConfirmation = Object.hasOwn(args, "confirmation");
  if (hasConfirmation && !UPSERT[mode]) throw new Error("confirmation只用于单条来源、经历或问答事实");
  if (hasConfirmation && (typeof args.confirmation !== "string" || !args.confirmation.trim() || args.confirmation.length > 1000)) throw new Error("confirmation必须是本轮聊天中用户明确核实该条事实的原话（最多1000字）");
  const settings = { ...options, sessionId: options.sessionId || "", now: options.now || new Date().toISOString() };
  settings.scope.check();
  let operation;
  if (UPSERT[mode]) {
    // Confirmation is an adapter-supplied quote, never record-controlled actor
    // metadata. Public adapters still validate the complete advertised schema.
    for (const key of ["actor", "confirm", "confirmation", "confirmedAt", "confirmedBy"]) {
      if (Object.hasOwn(input, key)) throw new Error("不能在记录中传入确认元数据");
    }
    if (Object.hasOwn(input, "status") && input.status !== "draft") throw new Error("Agent记录status只允许draft");
    createCareerLibrarySnapshot(current);
    const baseline = normalizeCareerLibrary(current);
    const next = preserveOriginalRecords(current, baseline, UPSERT[mode](current, input,
      { actor: hasConfirmation ? "user" : "agent", confirm: hasConfirmation, now: settings.now }));
    const kind = { source: "sources", episode: "episodes", qa: "qa" }[mode];
    const saved = next[COLLECTIONS[kind]].find(record => record.id === careerRecordId(kind, input, next));
    operation = { state: next, result: { saved: true, projectSaved: true, [mode]: saved } };
  } else if (mode === "library_version") {
    object(input, mode, ["action", "id", "title", "summary"]);
    if (input.action === "preview") {
      if (Object.hasOwn(input, "id")) throw new Error("preview不使用版本ID；id仅用于save幂等保存");
      operation = { state: current, result: previewReceipt(current, await previewCareerLibrary(current, "", settings)) };
    } else {
      if (input.action !== "save") throw new Error("library_version.action必须是preview或save");
      if (current.careerDraft?.dirty) throw new Error("请先保存或退出未保存的手工编辑，再保存知识库版本");
      if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 240) throw new Error("保存知识库版本需要1–240字的title");
      if (input.summary !== undefined && (typeof input.summary !== "string" || input.summary.length > 2000)) throw new Error("版本summary最多2000字");
      if (settings.expectedSnapshot && !equal(settings.expectedSnapshot, createCareerLibrarySnapshot(current))) throw new Error("知识库已有新的改动，请重新预览后保存；当前内容与旧版本均已保留");
      const stored = await storeVersion(current, input, settings);
      operation = { state: stored.state, result: { saved: true, projectSaved: true, libraryVersion: stored.version,
        message: "已保存独立知识库版本；待核对事实与待审修订标记保持原样，未生成简历。" } };
    }
  } else operation = await updateOperation(current, input, settings);
  settings.scope.check();
  const state = operation.state === current ? current : invalidateCareerEvidenceState(current, operation.state);
  return { state, result: operation.result, changed: !equal(current, state) };
}
