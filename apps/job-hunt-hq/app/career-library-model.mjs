// The private career library is the authority for personal facts. Resumes and
// interview answers are projections over it; importing material cannot confirm
// the candidate's contribution or replace something they already reviewed.
export const CAREER_LIBRARY_MIGRATION_VERSION = 1;
export const CAREER_LIBRARY_LIMITS = Object.freeze({ sources: 2000, episodes: 1000, qa: 5000 });
export const CAREER_RECORD_MAX_BYTES = 280 * 1024;
export const CAREER_RECORD_STATUSES = Object.freeze(["draft", "confirmed", "needs_review", "archived"]);
export const CAREER_QA_CATEGORIES = Object.freeze([
  "ownership", "scope", "impact", "decision", "collaboration", "failure", "context",
]);
const COLLECTIONS = { sources: "sourceMaterials", episodes: "careerEpisodes", qa: "careerQa" };
const PREFIXES = { sources: "career-source", episodes: "career-episode", qa: "career-qa" };
const REVISION_LIMIT = 40;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, maximum = 12000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function list(value, maximum = 40, length = 1000) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => text(item, length)).filter(Boolean))].slice(0, maximum);
}

function hash(value) {
  const input = String(value);
  let left = 2166136261;
  let right = 2246822507;
  for (let index = 0; index < input.length; index++) {
    left = Math.imul(left ^ input.charCodeAt(index), 16777619);
    right = Math.imul(right ^ input.charCodeAt(input.length - index - 1), 3266489909);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

function fingerprint(value) {
  return text(value).normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
}

function kindName(kind) {
  if (kind === "source" || kind === "sourceMaterials" || kind === "career_sources") return "sources";
  if (kind === "episode" || kind === "careerEpisodes" || kind === "career_episodes") return "episodes";
  if (kind === "careerQa" || kind === "career_qa") return "qa";
  if (Object.hasOwn(COLLECTIONS, kind)) return kind;
  throw new Error("经历资料类型必须是 sources、episodes 或 qa");
}

function status(value) {
  return CAREER_RECORD_STATUSES.includes(value) ? value : "draft";
}

function content(kind, value) {
  const input = object(value);
  const common = { legacyRefs: list(input.legacyRefs, 40, 500) };
  if (kind === "sources") {
    const excerpt = text(input.excerpt, 16000);
    return {
      provider: text(input.provider, 80).toLocaleLowerCase() || "manual",
      connectionId: text(input.connectionId, 240),
      externalId: text(input.externalId, 240),
      title: text(input.title || input.label, 240),
      url: text(input.url || input.locator, 2000),
      author: text(input.author, 240),
      occurredAt: text(input.occurredAt, 80),
      fetchedAt: text(input.fetchedAt, 80),
      excerpt,
      // This is an equality fingerprint, not a cryptographic integrity claim.
      // Connector-provided content hashes are retained when supplied.
      contentHash: text(input.contentHash, 240) || `content-${hash(excerpt)}`,
      localRef: text(input.localRef, 1000),
      ...common,
    };
  }
  if (kind === "episodes") {
    return {
      title: text(input.title, 240),
      project: text(input.project, 240),
      repoId: text(input.repoId, 100),
      experienceId: text(input.experienceId, 100),
      period: text(input.period, 240),
      background: text(input.background),
      problem: text(input.problem),
      myRole: text(input.myRole),
      actions: list(input.actions),
      alternatives: list(input.alternatives),
      decision: text(input.decision),
      reason: text(input.reason),
      tradeoffs: text(input.tradeoffs),
      results: text(input.results),
      retrospective: text(input.retrospective),
      tags: list(input.tags, 20, 120),
      sourceIds: list(input.sourceIds, 40, 100),
      ...common,
    };
  }
  return {
    episodeId: text(input.episodeId, 100),
    category: text(input.category, 80) || "context",
    question: text(input.question, 1200),
    answer: text(input.answer),
    draftAnswer: text(input.draftAnswer),
    sourceIds: list(input.sourceIds, 40, 100).sort(),
    ...common,
  };
}

function identity(kind, value) {
  const input = object(value);
  const explicit = text(input.identityKey, 1000);
  if (explicit) return explicit;
  if (kind === "sources") {
    const source = content(kind, input);
    return JSON.stringify([source.provider, source.connectionId, source.externalId || source.url || source.localRef || source.title, source.externalId || source.url || source.localRef ? "" : source.excerpt]);
  }
  if (kind === "episodes") {
    return JSON.stringify([text(input.repoId, 100), text(input.experienceId, 100), fingerprint(input.project), fingerprint(input.title), text(input.period, 240)]);
  }
  const episodeId = text(input.episodeId, 100);
  const parts = [episodeId, fingerprint(input.category || "context"), fingerprint(input.question)];
  // Unassigned questions from different material are different personal
  // records, even when their prompts use the same generic wording.
  if (!episodeId) parts.push(list(input.sourceIds, 40, 100).sort());
  return JSON.stringify(parts);
}

function stableId(kind, value) {
  return text(value.id, 100) || `${PREFIXES[kind]}-${hash(identity(kind, value))}`;
}

function sameIdentity(kind, left, right) {
  if (kind === "sources") {
    const a = content(kind, left);
    const b = content(kind, right);
    const anchorA = a.externalId || a.url || a.localRef;
    const anchorB = b.externalId || b.url || b.localRef;
    if (anchorA && anchorB) return a.provider === b.provider && a.connectionId === b.connectionId && anchorA === anchorB;
  }
  return identity(kind, left) === identity(kind, right);
}

export function careerRecordIdentity(kind, input = {}) {
  return identity(kindName(kind), object(input));
}

export function careerRecordId(kindInput, input = {}, state = {}) {
  const kind = kindName(kindInput);
  const records = normalizeCareerLibrary(state)[COLLECTIONS[kind]];
  const id = text(input.id, 100);
  const existing = records.find((record) => id && record.id === id) || records.find((record) => (!id || kind === "sources") && sameIdentity(kind, record, input));
  return existing?.id || stableId(kind, input);
}

function semanticContent(kind, record) {
  const result = content(kind, record);
  // A later read time is not a change to the underlying evidence.
  if (kind === "sources") {
    delete result.fetchedAt;
    delete result.title;
  }
  return JSON.stringify(result);
}

function normalizeRevision(kind, value) {
  const input = object(value);
  return {
    version: Math.max(1, Math.floor(Number(input.version) || 1)),
    status: status(input.status),
    actor: input.actor === "user" ? "user" : "agent",
    recordedAt: text(input.recordedAt || input.updatedAt, 80),
    reason: text(input.reason, 240),
    content: content(kind, input.content || input),
  };
}

function normalizeRecord(kind, value) {
  const input = object(value);
  const pending = object(input.pendingRevision);
  const revisionField = kind === "sources" ? "history" : "revisions";
  return {
    id: stableId(kind, input),
    identityKey: text(input.identityKey, 1000),
    ...content(kind, input),
    status: status(input.status),
    version: Math.max(1, Math.floor(Number(input.version) || 1)),
    createdAt: text(input.createdAt, 80),
    updatedAt: text(input.updatedAt, 80),
    confirmedAt: text(input.confirmedAt, 80),
    confirmedBy: input.confirmedBy === "user" ? "user" : "",
    lastConfirmedAt: text(input.lastConfirmedAt, 80) || (input.confirmedBy === "user" ? text(input.confirmedAt, 80) : ""),
    reviewReason: text(input.reviewReason, 500),
    [revisionField]: (Array.isArray(input[revisionField]) ? input[revisionField] : []).map((item) => normalizeRevision(kind, item)),
    pendingRevision: pending.content ? {
      status: "draft",
      actor: pending.actor === "user" ? "user" : "agent",
      createdAt: text(pending.createdAt, 80),
      baseVersion: Math.max(1, Math.floor(Number(pending.baseVersion) || 1)),
      version: Math.max(1, Math.floor(Number(pending.version) || 1)),
      content: content(kind, pending.content),
    } : null,
  };
}

export function normalizeCareerLibrary(input = {}) {
  const state = object(input);
  const result = {};
  for (const [kind, field] of Object.entries(COLLECTIONS)) {
    const seen = new Set();
    result[field] = (Array.isArray(state[field]) ? state[field] : []).filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => normalizeRecord(kind, item)).filter((record) => {
      if (seen.has(record.id)) return false;
      seen.add(record.id);
      return true;
    });
  }
  return result;
}

function withLibrary(state) {
  return { ...object(state), ...normalizeCareerLibrary(state) };
}

function revision(kind, record, actor, now, reason = "edited") {
  return { version: record.version, status: record.status, actor, recordedAt: now, reason, content: content(kind, record) };
}

function remember(kind, record, entry) {
  const field = kind === "sources" ? "history" : "revisions";
  if (record[field].length >= REVISION_LIMIT) throw new Error("这条资料已保存 40 次修订；请先导出历史并建立归档副本，原资料与当前输入均未被覆盖");
  return { ...record, [field]: [...record[field], entry] };
}

function assertRecordBudget(record) {
  if (new TextEncoder().encode(JSON.stringify(record)).byteLength > CAREER_RECORD_MAX_BYTES) throw new Error("这条资料及其修订历史超过单记录安全容量；请先导出历史或拆分经历，原资料与当前输入均未被覆盖");
}

function assertReferences(state, kind, record) {
  if (kind !== "sources") {
    const ids = new Set(state.sourceMaterials.map((source) => source.id));
    if (record.sourceIds.some((id) => !ids.has(id))) throw new Error("sourceIds 包含不存在的来源，请先保存材料来源");
  }
  if (kind === "qa" && record.episodeId && !state.careerEpisodes.some((episode) => episode.id === record.episodeId)) throw new Error("episodeId 不存在，请先保存经历事件");
}

function isReviewed(record) {
  const revisions = record.history || record.revisions || [];
  return record.status === "confirmed" || record.confirmedBy === "user" || Boolean(record.lastConfirmedAt) || revisions.some((item) => item.status === "confirmed");
}

function invalidateSourceDependents(state, sourceId, now) {
  const episodeIds = new Set(state.careerEpisodes.filter((item) => item.sourceIds.includes(sourceId)).map((item) => item.id));
  for (const kind of ["episodes", "qa"]) {
    const field = COLLECTIONS[kind];
    state[field] = state[field].map((record) => {
      if (record.status !== "confirmed" || !(record.sourceIds.includes(sourceId) || (kind === "qa" && episodeIds.has(record.episodeId)))) return record;
      const next = {
        ...record,
        status: "needs_review", confirmedAt: "", confirmedBy: "", updatedAt: now,
        lastConfirmedAt: record.lastConfirmedAt || record.confirmedAt || now,
        reviewReason: `来源 ${sourceId} 有新的内容版本，请重新核验`,
      };
      return next;
    });
  }
  return state;
}

function invalidateEpisodeDependents(state, episodeId, now) {
  state.careerQa = state.careerQa.map((record) => {
    if (record.episodeId !== episodeId || record.status !== "confirmed") return record;
    const next = {
      ...record,
      status: "needs_review", confirmedAt: "", confirmedBy: "", updatedAt: now,
      lastConfirmedAt: record.lastConfirmedAt || record.confirmedAt || now,
      reviewReason: "关联经历有新修订，请重新核验这条回答",
    };
    return next;
  });
  return state;
}

function upsert(kind, stateInput, value, options = {}) {
  const input = object(value);
  const state = withLibrary(stateInput);
  const field = COLLECTIONS[kind];
  const actor = options.actor === "user" ? "user" : "agent";
  const now = text(options.now, 80) || new Date().toISOString();
  let existing = state[field].find((item) => input.id && item.id === text(input.id, 100));
  if (!existing && (!input.id || kind === "sources")) existing = state[field].find((item) => sameIdentity(kind, item, input));
  const merged = { ...existing, ...input };
  if (kind === "sources" && !Object.hasOwn(input, "contentHash") && Object.hasOwn(input, "excerpt")) merged.contentHash = "";
  // The caller may be transcribing the person's actual words from this chat.
  // Keep that answer independent of an AI expression draft. Trust is carried
  // by status/pending review, never inferred merely from which field was used.
  let next = normalizeRecord(kind, { ...merged, id: existing?.id || stableId(kind, input) });
  if (kind === "sources" && !next.externalId && !next.url && !next.localRef && !next.excerpt) throw new Error("材料需要 externalId、url、localRef 或实际内容");
  if (kind === "episodes" && !next.title) throw new Error("经历事件需要 title");
  if (kind === "qa" && !next.question) throw new Error("经历问答需要 question");
  assertReferences(state, kind, next);
  const changed = !existing || semanticContent(kind, next) !== semanticContent(kind, existing);
  const wantsArchive = actor === "user" && input.status === "archived";
  const wantsConfirm = actor === "user" && (options.confirm === true || input.status === "confirmed");
  if (existing && wantsArchive) {
    if (JSON.stringify(content(kind, next)) !== JSON.stringify(content(kind, existing))) throw new Error("归档只修改状态；请先单独保存正文修改，当前内容未被覆盖");
    // Archiving is always available, including at the revision/content limit.
    // Keep the complete accepted text, history and pending proposal in place.
    const archived = {
      ...existing, status: "archived", confirmedAt: "", confirmedBy: "", updatedAt: now,
      lastConfirmedAt: existing.lastConfirmedAt || existing.confirmedAt || (existing.status === "confirmed" ? now : ""),
    };
    state[field] = state[field].map((item) => item.id === existing.id ? archived : item);
    if (existing.status !== "archived" && kind === "sources") invalidateSourceDependents(state, existing.id, now);
    if (existing.status !== "archived" && kind === "episodes") invalidateEpisodeDependents(state, existing.id, now);
    return state;
  }
  if (wantsConfirm && kind === "qa" && !next.answer) throw new Error("确认经历问答前请填写本人的实际回答");
  if (wantsConfirm && kind !== "sources" && next.sourceIds.some((id) => {
    const source = state.sourceMaterials.find((item) => item.id === id);
    return source?.pendingRevision || source?.status === "archived";
  })) throw new Error("请先审核来源的待审修订或撤回状态，再确认相关经历或回答");
  if (wantsConfirm && kind === "qa") {
    const episode = state.careerEpisodes.find((item) => item.id === next.episodeId);
    if (episode?.pendingRevision || episode?.status === "archived") throw new Error("请先审核关联经历的待审修订或撤回状态，再确认回答");
  }
  if (existing?.status === "archived" && actor !== "user") return state;

  const revisionField = kind === "sources" ? "history" : "revisions";
  if (existing && actor === "agent" && changed && existing[revisionField].some((entry) => entry.reason === "rejected_proposal" && semanticContent(kind, entry.content) === semanticContent(kind, next))) {
    if (kind === "sources") state[field] = state[field].map((item) => item.id === existing.id ? { ...item, fetchedAt: next.fetchedAt || item.fetchedAt } : item);
    return state;
  }

  if (existing && actor === "agent" && changed && isReviewed(existing)) {
    if (existing.pendingRevision && semanticContent(kind, existing.pendingRevision.content) === semanticContent(kind, next)) {
      if (kind === "sources") state[field] = state[field].map((item) => item.id === existing.id ? { ...item, fetchedAt: next.fetchedAt || item.fetchedAt } : item);
      return state;
    }
    const saved = existing.pendingRevision ? remember(kind, existing, {
      version: existing.pendingRevision.version, status: "draft", actor: "agent", recordedAt: now,
      reason: "superseded_proposal", content: existing.pendingRevision.content,
    }) : existing;
    next = {
      ...saved,
      ...(kind === "sources" ? { fetchedAt: next.fetchedAt || existing.fetchedAt } : {}),
      ...(kind === "qa" ? { draftAnswer: next.draftAnswer } : {}),
      pendingRevision: { status: "draft", actor, createdAt: now, baseVersion: existing.version, version: existing.version + 1, content: content(kind, next) },
    };
  } else if (existing && !changed && actor === "agent") {
    next = { ...existing, ...(kind === "sources" ? { fetchedAt: next.fetchedAt || existing.fetchedAt } : {}) };
  } else {
    if ((!existing || existing.status === "archived") && !wantsArchive && !options.migration && state[field].filter((record) => record.status !== "archived").length >= CAREER_LIBRARY_LIMITS[kind]) throw new Error("经历资料库已达到活跃资料安全容量，请先归档旧资料；不会自动删除事实");
    next = {
      ...next,
      [revisionField]: existing ? existing[revisionField] : [],
      version: existing ? existing.version + (changed ? 1 : 0) : 1,
      createdAt: existing?.createdAt || now,
      updatedAt: changed || !existing || actor === "user" ? now : existing.updatedAt,
      status: wantsArchive ? "archived" : wantsConfirm ? "confirmed" : actor === "user" && input.status === "needs_review" ? "needs_review" : "draft",
      confirmedAt: wantsConfirm && !wantsArchive ? now : "",
      confirmedBy: wantsConfirm && !wantsArchive ? "user" : "",
      lastConfirmedAt: wantsConfirm ? now : existing?.lastConfirmedAt || existing?.confirmedAt || (existing?.status === "confirmed" ? now : ""),
      reviewReason: "",
      pendingRevision: null,
    };
    if (existing && changed) next = remember(kind, next, revision(kind, existing, actor, now));
    if (existing?.pendingRevision) next = remember(kind, next, { version: existing.pendingRevision.version, status: "draft", actor, recordedAt: now, reason: "reviewed_proposal", content: existing.pendingRevision.content });
  }
  // Metadata-only confirmation/review changes add at most a small fixed amount
  // beyond the content budget and remain safely below the project shard limit.
  if (!existing || changed || existing.pendingRevision) assertRecordBudget(next);
  state[field] = existing ? state[field].map((item) => item.id === existing.id ? next : item) : [...state[field], next];
  const withdrawnConfirmation = existing?.status === "confirmed" && next.status !== "confirmed";
  if (existing && (changed || withdrawnConfirmation || (wantsArchive && existing.status !== "archived")) && kind === "sources") invalidateSourceDependents(state, existing.id, now);
  if (existing && (changed || withdrawnConfirmation || (wantsArchive && existing.status !== "archived")) && kind === "episodes") invalidateEpisodeDependents(state, existing.id, now);
  return state;
}

export const upsertCareerSource = (state, input, options) => upsert("sources", state, input, options);
export const upsertCareerEpisode = (state, input, options) => upsert("episodes", state, input, options);
export const upsertCareerQa = (state, input, options) => upsert("qa", state, input, options);

export function applyCareerPendingRevision(stateInput, kindInput, id, options = {}) {
  if (options.actor !== "user") throw new Error("只有本人可以采用或保留经历资料修订");
  const kind = kindName(kindInput);
  const state = withLibrary(stateInput);
  const field = COLLECTIONS[kind];
  const record = state[field].find((item) => item.id === id);
  if (!record?.pendingRevision) throw new Error("这条资料没有待审修订");
  const now = text(options.now, 80) || new Date().toISOString();
  if (options.confirm !== true) {
    const next = remember(kind, record, {
      version: record.pendingRevision.version, status: "draft", actor: "user", recordedAt: now,
      reason: "rejected_proposal", content: record.pendingRevision.content,
    });
    assertRecordBudget(next);
    state[field] = state[field].map((item) => item.id === id ? { ...next, ...(kind === "qa" ? { draftAnswer: "" } : {}), pendingRevision: null } : item);
    return state;
  }
  const proposed = { ...record.pendingRevision.content };
  // A reviewed expression is still separate from the candidate's factual
  // answer. Changing that fact requires an explicit edit to the answer field.
  return upsert(kind, state, { id, ...proposed }, { ...options, actor: "user", confirm: true, now });
}

function catalogSummary(kind, record) {
  const common = { id: record.id, status: record.status, version: record.version, updatedAt: record.updatedAt, pendingRevision: Boolean(record.pendingRevision), legacyRefCount: record.legacyRefs.length };
  if (kind === "sources") return { ...common, title: record.title, provider: record.provider, externalId: record.externalId, url: record.url, author: record.author, occurredAt: record.occurredAt, excerpt: record.excerpt.slice(0, 500) };
  if (kind === "episodes") return { ...common, title: record.title, project: record.project, myRole: record.myRole.slice(0, 300), period: record.period, tags: record.tags.slice(0, 8), sourceIds: record.sourceIds.slice(0, 8), sourceCount: record.sourceIds.length, background: record.background.slice(0, 500) };
  return { ...common, episodeId: record.episodeId, category: record.category, question: record.question, answer: record.answer.slice(0, 500), draftAnswer: record.draftAnswer.slice(0, 500), sourceIds: record.sourceIds.slice(0, 8), sourceCount: record.sourceIds.length };
}

export function searchCareerLibrary(input = {}, query = {}) {
  const kind = kindName(query.kind || "qa");
  const records = normalizeCareerLibrary(input)[COLLECTIONS[kind]];
  const id = text(query.id, 100);
  const limit = Math.max(1, Math.min(50, Math.floor(Number(query.limit) || 25)));
  const cursor = Math.max(0, Math.floor(Number(query.cursor) || 0));
  if (id) {
    const found = records.find((record) => record.id === id);
    return { kind, items: found ? [found] : [], total: found ? 1 : 0, cursor: 0, nextCursor: null };
  }
  const search = fingerprint(text(query.search, 500));
  const filtered = records.filter((record) => {
    if (query.status && !["all", "active"].includes(query.status) && record.status !== query.status) return false;
    if ((!query.status || query.status === "active") && record.status === "archived") return false;
    if (query.episodeId && kind === "qa" && record.episodeId !== query.episodeId) return false;
    if (query.sourceId && kind !== "sources" && !record.sourceIds.includes(query.sourceId)) return false;
    return !search || fingerprint(JSON.stringify([content(kind, record), record.pendingRevision?.content])).includes(search);
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  const items = [];
  let bytes = 0;
  for (const record of filtered.slice(cursor, cursor + limit)) {
    const item = catalogSummary(kind, record);
    const itemBytes = new TextEncoder().encode(JSON.stringify(item)).byteLength;
    if (items.length && bytes + itemBytes > 160 * 1024) break;
    items.push(item);
    bytes += itemBytes;
  }
  return { kind, items, total: filtered.length, cursor, nextCursor: cursor + items.length < filtered.length ? cursor + items.length : null };
}

export const queryCareerLibrary = searchCareerLibrary;

function demo(value) {
  const input = object(value);
  return input.sample === true || input.demo === true || input.isDemo === true || ["sample", "demo"].includes(input.origin);
}

function legacyQuestionRef(resume, question, index = 0) {
  return `resume:${text(resume.versionId || resume.id, 100) || "unversioned"}:question:${text(question.id, 100) || `index-${index}`}`;
}

function linkedLegacyQa(state, resume, question, index) {
  const explicitId = text(question.careerQaId || question.career_qa_id, 100);
  if (explicitId) {
    const record = state.careerQa.find((item) => item.id === explicitId);
    if (!record) throw new Error(`简历问答关联的长期经历问答不存在：${explicitId}`);
    return record;
  }
  const ref = legacyQuestionRef(resume, question, index);
  return state.careerQa.find((item) => item.legacyRefs.includes(ref));
}

// This bridge runs at legacy write boundaries, independently of the one-time
// migration. A resume carries a stable careerQaId; regenerating a resume cannot
// replay a stale answer over an answer reviewed later in the private library.
export function syncLegacyCareerQa(stateInput = {}, resumeInput = {}, options = {}) {
  let state = withLibrary(stateInput);
  const resume = object(resumeInput);
  const projectedQuestions = Array.isArray(resume.candidateQuestions) ? resume.candidateQuestions : [];
  const questions = [...projectedQuestions];
  // Resume projections cap their visible prompts. Preserve every incoming
  // generated prompt in the library before that projection window drops it.
  for (const question of Array.isArray(options.additionalQuestions) ? options.additionalQuestions : []) {
    if (!questions.some((item) => (question?.id && item?.id === question.id) || fingerprint(item?.question) === fingerprint(question?.question))) questions.push(question);
  }
  if (demo(state) || demo(resume) || (state.profile?.name === "林默" && String(state.profile?.contact || "").includes("linmo@example.com"))) return state;
  if (questions.length && !text(resume.versionId || resume.id, 100)) throw new Error("同步经历问答前简历版本需要稳定 ID");
  const targetedId = text(options.questionId, 100);
  if (targetedId && !questions.some((item) => text(item?.id, 100) === targetedId)) throw new Error("需要同步的简历问答不存在");
  const predecessor = object(options.predecessor);
  const oldQuestions = Array.isArray(predecessor.candidateQuestions) ? predecessor.candidateQuestions : [];
  const actor = options.actor === "user" ? "user" : "agent";
  const now = text(options.now, 80) || new Date().toISOString();
  const makeSource = (ref, title, excerpt) => {
    const id = `${PREFIXES.sources}-${hash(`legacy:${ref}`)}`;
    if (!state.sourceMaterials.some((item) => item.id === id)) state = upsertCareerSource(state, {
      id, provider: "legacy", externalId: ref, title, excerpt,
      localRef: `job-hunt-panel.json#${ref}`, legacyRefs: [ref],
    }, { actor: "agent", now });
    return careerRecordId("sources", { id, provider: "legacy", externalId: ref }, state);
  };
  const linkedQuestions = questions.map((question, index) => {
    if (!question || demo(question) || !text(question.question, 1200)) return question;
    let existing = linkedLegacyQa(state, resume, question, index);
    if (!existing && oldQuestions.length) {
      const previousIndex = oldQuestions.findIndex((item) =>
        (question.id && item.id === question.id) ||
        (fingerprint(item.question) === fingerprint(question.question) &&
          fingerprint(item.category || "context") === fingerprint(question.category || "context") &&
          fingerprint(item.relatedClaim) === fingerprint(question.relatedClaim)));
      if (previousIndex >= 0) existing = linkedLegacyQa(state, predecessor, oldQuestions[previousIndex], previousIndex);
    }
    // Reusing an existing question only adds its stable projection link. Answer
    // changes must come from an explicit legacy answer action, not draft carry.
    if (existing && (!targetedId || question.id !== targetedId)) return { ...question, careerQaId: existing.id };
    const ref = legacyQuestionRef(resume, question, index);
    const evidence = (Array.isArray(resume.claimEvidence) ? resume.claimEvidence : []).find((item) => fingerprint(item.claim) === fingerprint(question.relatedClaim));
    const sourceIds = [...new Set([
      ...(existing?.sourceIds || []),
      ...(existing ? [] : [makeSource(ref, question.question, text(question.answer) || text(question.why))]),
      ...list(evidence?.sourceIds, 40, 100).filter((id) => state.sourceMaterials.some((item) => item.id === id)),
      ...list(question.sourceRefs, 8, 500).map((sourceRef) => makeSource(sourceRef, "简历问答记录来源", sourceRef)),
    ])];
    if (sourceIds.length > 40) throw new Error("这条经历问答的关联来源超过 40 条，请先合并来源；原回答未被覆盖");
    const episodeIds = list(evidence?.episodeIds, 40, 100).filter((id) => state.careerEpisodes.some((item) => item.id === id));
    for (const source of Array.isArray(evidence?.sources) ? evidence.sources : []) {
      const episode = state.careerEpisodes.find((item) => source.kind === "repo" ? item.repoId && item.repoId === source.locator : source.kind === "experience" && item.experienceId && item.experienceId === source.locator);
      if (episode && !episodeIds.includes(episode.id)) episodeIds.push(episode.id);
    }
    const id = existing?.id || `${PREFIXES.qa}-${hash(`legacy:${ref}`)}`;
    const answer = text(question.answer);
    const targeted = Boolean(targetedId && question.id === targetedId);
    const qaInput = existing ? { id, sourceIds } : {
      id, question: question.question, category: question.category,
      episodeId: episodeIds.length === 1 ? episodeIds[0] : "", sourceIds, legacyRefs: [ref],
    };
    // New projection content has not been reviewed as a library fact, even if
    // an old resume marks it answered. Explicit user answer saves can confirm.
    if (targeted) Object.assign(qaInput, { answer, ...(actor === "user" ? { draftAnswer: "" } : {}) });
    else qaInput.draftAnswer = answer;
    state = upsertCareerQa(state, qaInput, { actor: targeted ? actor : "agent", confirm: targeted && actor === "user" && options.confirm === true && question.status === "answered", now });
    return { ...question, careerQaId: id };
  });
  const projectedLinks = linkedQuestions.slice(0, projectedQuestions.length);
  const linkedResume = { ...resume, candidateQuestions: projectedLinks };
  const resumeId = text(resume.versionId || resume.id, 100);
  const sameResume = (item) => item === resumeInput || (resumeId && text(item?.versionId || item?.id, 100) === resumeId);
  if (sameResume(state.resume)) state.resume = linkedResume;
  if (Array.isArray(state.versions)) state.versions = state.versions.map((item) => sameResume(item) ? { ...item, candidateQuestions: projectedLinks.map((question) => question && typeof question === "object" ? { ...question } : question) } : item);
  return state;
}

// Legacy arrays stay intact. The new drafts retain explicit references to the
// originals rather than upgrading an old summary or an AI answer to a fact.
export function migrateCareerLibrary(stateInput = {}) {
  let state = withLibrary(stateInput);
  if (Number(state.careerLibraryMigrationVersion) >= CAREER_LIBRARY_MIGRATION_VERSION) return state;
  const demoState = demo(state) || (state.profile?.name === "林默" && String(state.profile?.contact || "").includes("linmo@example.com"));
  if (demoState) return { ...state, careerLibraryMigrationVersion: CAREER_LIBRARY_MIGRATION_VERSION };
  const now = text(state.updatedAt, 80) || "";
  const options = { actor: "agent", migration: true, now: now || "1970-01-01T00:00:00.000Z" };
  const migrations = new Map();
  const makeLegacySource = (ref, title, excerpt) => {
    const sourceId = `${PREFIXES.sources}-${hash(`legacy:${ref}`)}`;
    if (!state.sourceMaterials.some((item) => item.id === sourceId)) state = upsertCareerSource(state, { id: sourceId, provider: "legacy", externalId: ref, title, excerpt, localRef: `job-hunt-panel.json#${ref}`, legacyRefs: [ref] }, options);
    return careerRecordId("sources", { id: sourceId, provider: "legacy", externalId: ref }, state);
  };
  for (const [field, kind] of [["repos", "repo"], ["experiences", "experience"]]) {
    for (const [index, item] of (Array.isArray(state[field]) ? state[field] : []).entries()) {
      if (!item || typeof item !== "object" || demo(item)) continue;
      const ref = `${kind}:${text(item.id, 100) || `index-${index}`}`;
      const title = text(item.name || [item.company, item.role].filter(Boolean).join(" · "), 240) || "待归档经历";
      const sourceId = makeLegacySource(ref, title, text(item.summary) || list(item.achievements, 40, 1000).join("\n"));
      const episodeId = `${PREFIXES.episodes}-${hash(`legacy:${ref}`)}`;
      migrations.set(ref, episodeId);
      if (!state.careerEpisodes.some((episode) => episode.id === episodeId)) state = upsertCareerEpisode(state, {
        id: episodeId, title, project: text(item.name || item.company, 240),
        ...(kind === "repo" ? { repoId: text(item.id, 100) } : { experienceId: text(item.id, 100) }),
        period: text(item.period, 240), background: text(item.summary),
        results: list(item.achievements, 40, 1000).join("\n"),
        sourceIds: [sourceId], tags: ["待归档", "历史迁移"], legacyRefs: [ref],
      }, options);
    }
  }
  for (const [index, resume] of [state.resume, ...(Array.isArray(state.versions) ? state.versions : [])].entries()) {
    if (!resume || demo(resume)) continue;
    const resumeId = text(resume.versionId || resume.id, 100) || `index-${index}`;
    for (const [questionIndex, item] of (Array.isArray(resume.candidateQuestions) ? resume.candidateQuestions : []).entries()) {
      if (!item || demo(item) || !text(item.question, 1200)) continue;
      const ref = `resume:${resumeId}:question:${text(item.id, 100) || `index-${questionIndex}`}`;
      const qaId = `${PREFIXES.qa}-${hash(`legacy:${ref}`)}`;
      if (state.careerQa.some((qa) => qa.id === qaId)) continue;
      const sourceIds = [makeLegacySource(ref, item.question, text(item.answer) || text(item.why))];
      for (const sourceRef of list(item.sourceRefs, 8, 500)) sourceIds.push(makeLegacySource(sourceRef, "历史问答来源", sourceRef));
      const related = text(item.relatedClaim);
      const evidence = (Array.isArray(resume.claimEvidence) ? resume.claimEvidence : []).find((claim) => fingerprint(claim.claim) === fingerprint(related));
      const episodeIds = (Array.isArray(evidence?.sources) ? evidence.sources : []).map((source) => migrations.get(`${source.kind}:${source.locator}`)).filter(Boolean);
      state = upsertCareerQa(state, { id: qaId, episodeId: episodeIds.length === 1 ? episodeIds[0] : "", category: text(item.category, 80), question: item.question, draftAnswer: text(item.answer), sourceIds: [...new Set(sourceIds)], legacyRefs: [ref] }, options);
    }
  }
  return { ...state, careerLibraryMigrationVersion: CAREER_LIBRARY_MIGRATION_VERSION };
}
