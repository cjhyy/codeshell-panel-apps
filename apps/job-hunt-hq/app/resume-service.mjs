import {
  baseResumeRecords, collectResumeRecords, deriveResumeVariantChanges, mergeResumeQaQuestions,
  normalizeClaimEvidence, normalizeResumeCategory, normalizeResumeQaQuestions, normalizeResumeStyle,
  resumeEvidenceCoverage, resumeQaCounts, resumeRecordId, selectBaseResume, updateResumeQaAnswer,
} from "./resume-model.mjs";
import { normalizeCareerLibrary, syncLegacyCareerQa } from "./career-library-model.mjs";

export const RESUME_HISTORY_LIMIT = 30;
const CAREER_COLLECTIONS = ["sourceMaterials", "careerEpisodes", "careerQa"];

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} 参数格式不正确`);
}

function text(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function workingState(input) {
  object(input, "state");
  const state = structuredClone(input);
  state.resume = state.resume && typeof state.resume === "object" && !Array.isArray(state.resume) ? state.resume : {};
  for (const field of ["jobs", "versions", ...CAREER_COLLECTIONS]) state[field] = Array.isArray(state[field]) ? state[field] : [];
  return state;
}

function records(state) {
  return collectResumeRecords(state.resume, state.versions, { profileTarget: state.profile?.target, profileRole: state.profile?.role });
}

function archiveCurrentResume(state) {
  if (!state.resume.markdown) return;
  const versionId = resumeRecordId(state.resume) || id("resume");
  const remaining = state.versions.filter((item) => resumeRecordId(item) !== versionId);
  // The UI used to rotate the oldest entry out silently. A shared writer must
  // not delete history or a Base still referenced by another resume.
  if (remaining.length >= RESUME_HISTORY_LIMIT) throw new Error("已保存 30 个历史简历版本；请先导出并整理旧版，当前简历与输入均未被覆盖");
  state.versions = [{
    ...state.resume, id: versionId, versionId,
    parentVersionId: state.resume.parentVersionId || "", revisionReason: state.resume.revisionReason || "",
    style: normalizeResumeStyle(state.resume.style),
    pdfExports: Array.isArray(state.resume.pdfExports) ? state.resume.pdfExports : [],
    claimEvidence: state.resume.claimEvidence || [], candidateQuestions: state.resume.candidateQuestions || [],
    variantChanges: state.resume.variantChanges || [], notes: state.resume.notes || [],
  }, ...remaining];
}

function preserveCareerDetails(previous, next) {
  const normalized = normalizeCareerLibrary(previous);
  for (const field of CAREER_COLLECTIONS) {
    const beforeById = new Map((previous[field] || []).map((record) => [record.id, record]));
    const normalizedById = new Map(normalized[field].map((record) => [record.id, record]));
    next[field] = next[field].map((record) => {
      const before = beforeById.get(record.id);
      const baseline = normalizedById.get(record.id);
      if (!before || !baseline) return record;
      if (JSON.stringify(record) === JSON.stringify(baseline)) return structuredClone(before);
      const restored = { ...before, ...record };
      // CLI callers may open older projects without the UI's normalizer. Fail
      // before persisting a touched record if normalization truncated its facts.
      for (const [key, value] of Object.entries(before)) {
        if (typeof value === "string" && typeof baseline[key] === "string" && value.trim().length > baseline[key].length) throw new Error(`经历记录 ${record.id} 的 ${key} 超出现有字段容量；原资料与输入均未被覆盖`);
        if (Array.isArray(value) && Array.isArray(baseline[key]) && value.length > baseline[key].length) throw new Error(`经历记录 ${record.id} 的 ${key} 超出现有字段容量；原资料与输入均未被覆盖`);
        if (JSON.stringify(record[key]) === JSON.stringify(baseline[key])) restored[key] = structuredClone(value);
      }
      const history = field === "sourceMaterials" ? "history" : "revisions";
      restored[history] = record[history].map((revision, index) => {
        if (index < (before[history]?.length || 0)) return structuredClone(before[history][index]);
        if (revision.reason === "superseded_proposal" && before.pendingRevision) return { ...revision, content: structuredClone(before.pendingRevision.content) };
        return revision;
      });
      return restored;
    });
  }
  return next;
}

function invalidateDependentEvidence(previous, next) {
  const changed = new Set(CAREER_COLLECTIONS.flatMap((field) => (next[field] || []).filter((record) => {
    const before = (previous[field] || []).find((item) => item.id === record.id);
    return before && (before.version !== record.version || before.status !== record.status || JSON.stringify(before.pendingRevision) !== JSON.stringify(record.pendingRevision));
  }).map((record) => record.id)));
  for (const resume of [next.resume, ...next.versions]) {
    for (const evidence of resume.claimEvidence || []) {
      if ([...(evidence.sourceIds || []), ...(evidence.episodeIds || []), ...(evidence.qaIds || [])].some((recordId) => changed.has(recordId))) evidence.status = "needs_review";
    }
  }
  return next;
}

function syncCareer(previous, state, options) {
  return invalidateDependentEvidence(previous, preserveCareerDetails(previous, syncLegacyCareerQa(state, state.resume, options)));
}

// This checks the existing resume contract and exact evidence mapping. It does
// not read source documents or independently verify their factual meaning.
// Transport adapters own strict JSON Schema validation, persistence and CAS;
// UI adapters also own local editor drafts, selection rendering and Trace.
export function prepareResumeDraft(input = {}, args = {}, options = {}) {
  object(args, "save_resume_draft");
  let state = workingState(input);
  const requestedJobId = text(args.job_id, 80);
  const resumeKind = ["base", "variant"].includes(args.resume_kind) ? args.resume_kind : requestedJobId ? "variant" : "base";
  const job = requestedJobId ? state.jobs.find((item) => item.id === requestedJobId) : null;
  if (requestedJobId && !job) throw new Error("job_id 不存在，请先读取面板上下文");
  if (resumeKind === "base" && requestedJobId) throw new Error("Base Resume 不能绑定 job_id");
  if (resumeKind === "variant" && !job) throw new Error("岗位定制版必须提供有效 job_id");
  const resumeRecords = records(state);
  const selectedBase = selectBaseResume(resumeRecords, state.selectedBaseResumeId);
  const category = normalizeResumeCategory(args.category, selectedBase?.category || state.profile?.target || state.profile?.role);
  const requestedBaseResumeId = text(args.base_resume_id, 100);
  const base = resumeKind === "variant" ? baseResumeRecords(resumeRecords).find((item) => resumeRecordId(item) === requestedBaseResumeId) : null;
  if (resumeKind === "variant" && !base) throw new Error("请先保存 Base Resume，并传入有效 base_resume_id 后再生成岗位定制版");
  if (typeof args.title !== "string" || !args.title.trim() || typeof args.markdown !== "string" || args.markdown.trim().length < 80) throw new Error("title 和至少 80 字符的 markdown 为必填");
  const markdown = args.markdown.trim().slice(0, 50000);
  const claimEvidence = normalizeClaimEvidence(args.claim_evidence);
  for (const claim of claimEvidence) {
    for (const [field, collection] of [["sourceIds", "sourceMaterials"], ["episodeIds", "careerEpisodes"], ["qaIds", "careerQa"]]) {
      for (const recordId of claim[field] || []) {
        const record = state[collection].find((item) => item.id === recordId);
        if (!record) throw new Error(`claim_evidence 的 ${field} 引用了不存在的记录 ${recordId}`);
        if (record.status !== "confirmed" || record.pendingRevision) claim.status = "needs_review";
      }
    }
  }
  const incomingCandidateQuestions = normalizeResumeQaQuestions(Array.isArray(args.candidate_questions) ? args.candidate_questions.map((item, index) => ({
    ...item, id: text(item?.id, 100) || text(options.questionIdFactory?.(item, index), 100) || id("resume-qa"),
  })) : []);
  const predecessor = resumeRecords.find((record) => resumeKind === "base"
    ? record.kind === "base" && record.category.toLocaleLowerCase() === category.toLocaleLowerCase()
    : record.kind === "variant" && record.jobId === requestedJobId);
  const candidateQuestions = mergeResumeQaQuestions(predecessor?.candidateQuestions, incomingCandidateQuestions);
  const coverage = resumeEvidenceCoverage(markdown, claimEvidence);
  if (!claimEvidence.length) throw new Error("claim_evidence 为必填；每条简历能力与成果都必须关联 Source");
  if (!coverage.total) throw new Error("简历至少需要一条可映射的专业概述、能力或成果表述");
  if (coverage.missing.length) throw new Error(`以下简历表述缺少逐字匹配的 Source：${coverage.missing.slice(0, 3).join("；")}`);
  if (coverage.missingDetails.length) throw new Error(`以下简历表述缺少重点说明、证据内容或面试追问：${coverage.missingDetails.slice(0, 3).join("；")}`);
  const minimumCore = Math.min(3, coverage.total);
  if (coverage.core < minimumCore) throw new Error(`至少标记 ${minimumCore} 条 importance=core 的核心重点`);
  if (coverage.core > 6) throw new Error("核心重点最多 6 条；请把其余要点标为 supporting，避免重点失焦");
  if (candidateQuestions.length < 3) throw new Error("candidate_questions 至少需要 3 个针对真实信息缺口的候选人自问 QA");
  if (candidateQuestions.some((question) => question.status === "answered" && !question.answer)) throw new Error("状态为 answered 的 candidate_questions 必须保留实际回答");
  const now = text(options.now, 80) || new Date().toISOString();
  const versionId = text(options.versionId, 100) || id("resume");
  if ([state.resume, ...state.versions].some((record) => resumeRecordId(record) === versionId)) throw new Error(`简历版本 ${versionId} 已存在；请使用新的版本 ID，原版未被覆盖`);
  archiveCurrentResume(state);
  if (resumeKind === "variant") state.selectedJobId = requestedJobId;
  if (job) job.status = "tailoring";
  state.resume = {
    kind: resumeKind, category: resumeKind === "variant" ? base.category : category,
    baseResumeId: resumeKind === "variant" ? resumeRecordId(base) : "", jobId: resumeKind === "variant" ? requestedJobId : "",
    versionId, parentVersionId: resumeRecordId(predecessor),
    revisionReason: predecessor ? resumeKind === "base" ? "Agent 更新 Base Resume" : "Agent 更新岗位版" : "",
    title: args.title.trim().slice(0, 120), markdown, style: normalizeResumeStyle(state.resume.style), pdfExports: [],
    claimEvidence, candidateQuestions, variantChanges: [],
    notes: Array.isArray(args.notes) ? args.notes.map((note) => String(note).slice(0, 300)).slice(0, 12) : [], updatedAt: now,
  };
  state = syncCareer(input, state, { actor: "agent", predecessor, additionalQuestions: incomingCandidateQuestions, now });
  if (resumeKind === "variant") state.resume.variantChanges = deriveResumeVariantChanges(base, state.resume, job);
  state.selectedBaseResumeId = resumeKind === "base" ? versionId : resumeRecordId(base);
  return {
    state,
    result: {
      saved: true, resumeId: versionId, versionId, resumeKind, category: state.resume.category,
      baseResumeId: state.resume.baseResumeId || null, jobId: requestedJobId || null, title: state.resume.title,
      updatedAt: now, characterCount: state.resume.markdown.length, evidenceCoverage: `${coverage.supported}/${coverage.total}`,
      completePointCount: coverage.complete, corePointCount: coverage.core, strongEvidenceCount: coverage.strong,
      verifiedClaimCount: coverage.verified, candidateQuestionCount: candidateQuestions.length,
      openCandidateQuestionCount: resumeQaCounts(state.resume).open,
    },
  };
}

export function prepareResumeQaAnswer(input = {}, args = {}, options = {}) {
  object(args, "save_resume_qa_answer");
  let state = workingState(input);
  const resumeId = text(args.resume_id, 100);
  const questionId = text(args.question_id, 100);
  if (!resumeId || resumeId !== resumeRecordId(state.resume)) throw new Error("resume_id 必须指向当前正在查看的简历版本");
  const questions = normalizeResumeQaQuestions(state.resume.candidateQuestions);
  const question = questions.find((item) => item.id === questionId);
  if (!question) throw new Error("question_id 不属于当前简历版本");
  const status = text(args.status, 40);
  const answer = text(args.answer, 3000);
  const sourceRefs = Array.isArray(args.source_refs) ? args.source_refs.map((item) => text(item, 500)).filter(Boolean).slice(0, 8) : [];
  if (!["answered", "needs_source", "skipped"].includes(status) || !answer) throw new Error("status 和候选人的实际 answer 为必填");
  if (status === "answered" && !sourceRefs.length) throw new Error("标记 answered 时至少需要一个 Source；用户明确确认可使用 user:resume-qa:<id>");
  const now = text(options.now, 80) || new Date().toISOString();
  const updated = updateResumeQaAnswer(questions, { questionId, status, answer, sourceRefs, suggestedChange: args.suggested_change, answeredAt: now });
  state.resume = { ...state.resume, candidateQuestions: updated.questions };
  state = syncCareer(input, state, { actor: "agent", questionId, now });
  const counts = resumeQaCounts(state.resume);
  return { state, result: { saved: true, resumeId, questionId, status, answeredCount: counts.answered, remainingCount: counts.open + counts.needsSource } };
}
