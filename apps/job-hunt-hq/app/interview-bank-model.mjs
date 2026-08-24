const QUESTION_TYPES = new Set([
  "behavioral",
  "technical",
  "system_design",
  "project_deep_dive",
  "resume_probe",
  "scenario",
  "role_knowledge",
  "other",
]);

const QUESTION_STATUSES = new Set(["inbox", "ready", "mastered", "archived"]);
const QUESTION_ORIGINS = new Set(["generated", "session", "manual", "real_interview", "imported"]);

// v1 allowed 20 sets × 30 questions. Keep the canonical bank large enough to
// migrate that worst case without silently discarding a unique legacy prompt.
export const QUESTION_BANK_LIMIT = 600;

function text(value, maximum = 1000) {
  return String(value ?? "")
    .trim()
    .slice(0, maximum);
}

function list(value, maximumItems, maximumLength) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item, maximumLength)).filter(Boolean))].slice(
        0,
        maximumItems,
      )
    : [];
}

function score(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function normalizePracticeAttempt(input = {}) {
  const createdAt = text(input.createdAt, 80);
  return {
    id: text(input.id, 100) || `attempt-${stableHash(JSON.stringify(input))}`,
    answer: text(input.answer, 6000),
    inputMode: ["typed", "voice", "mixed"].includes(input.inputMode) ? input.inputMode : "typed",
    practiceSessionId: text(input.practiceSessionId, 100),
    interviewSetId: text(input.interviewSetId, 100),
    createdAt,
    updatedAt: text(input.updatedAt, 80) || createdAt,
  };
}

function attempts(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map(normalizePracticeAttempt)
    .filter((item) => {
      if (!item.answer || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 40);
}

function normalizePracticeReview(input = {}) {
  const dimensions =
    input.dimensions && typeof input.dimensions === "object" && !Array.isArray(input.dimensions)
      ? input.dimensions
      : {};
  const normalizedDimensions = {
    evidence: score(dimensions.evidence),
    structure: score(dimensions.structure),
    depth: score(dimensions.depth),
    relevance: score(dimensions.relevance),
  };
  const dimensionAverage = Math.round(
    Object.values(normalizedDimensions).reduce((total, value) => total + value, 0) / 4,
  );
  return {
    id: text(input.id, 100) || `review-${stableHash(JSON.stringify(input))}`,
    answerSummary: text(input.answerSummary, 1600),
    overallScore: score(input.overallScore ?? dimensionAverage),
    dimensions: normalizedDimensions,
    strengths: list(input.strengths, 5, 400),
    improvements: list(input.improvements, 3, 500),
    optimizedAnswer: text(input.optimizedAnswer, 3000),
    followUp: text(input.followUp, 600),
    practiceSessionId: text(input.practiceSessionId, 100),
    practiceAttemptId: text(input.practiceAttemptId, 100),
    traceId: text(input.traceId, 100),
    createdAt: text(input.createdAt, 80),
  };
}

function reviews(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map(normalizePracticeReview)
    .filter((item) => {
      const key = item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function union(...values) {
  return [...new Set(values.flat().filter(Boolean))];
}

function stableHash(value, seed = 2166136261) {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeQuestionForFingerprint(value) {
  return text(value, 1200)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{Sm}#%&@]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

export function interviewQuestionFingerprint(value) {
  const normalized = normalizeQuestionForFingerprint(
    typeof value === "string" ? value : value?.question,
  );
  return normalized
    ? `q-${stableHash(normalized)}-${stableHash([...normalized].reverse().join(""), 2246822507)}`
    : "";
}

export function normalizeInterviewQuestionSourceRefs(value, options = {}) {
  const origin = text(options.origin, 40);
  const references = list(value, 16, 500);
  if (origin !== "session") return references;
  const anchor = text(options.traceId, 100) || text(options.sessionId, 100);
  const stableSessionRef = anchor ? `session:${anchor}` : "session:current";
  const normalized = references.map((reference) =>
    /^session:current$/i.test(reference) ? stableSessionRef : reference,
  );
  if (!normalized.some((reference) => /^session:/i.test(reference))) {
    normalized.unshift(stableSessionRef);
  }
  return list(normalized, 16, 500);
}

export function inferInterviewQuestionType(category, question = "") {
  const value = `${category} ${question}`.toLocaleLowerCase();
  if (/行为|协作|冲突|失败|复盘|star|behavior/.test(value)) return "behavioral";
  if (/系统设计|架构|design|architecture/.test(value)) return "system_design";
  if (/项目|commit|源码|取舍|深挖/.test(value)) return "project_deep_dive";
  if (/简历|经历|个人贡献|归属|材料|证据|量化|可信|能力差距|resume|evidence|metric/.test(value)) {
    return "resume_probe";
  }
  if (/场景|假设|如果|scenario/.test(value)) return "scenario";
  if (/业务|岗位|行业|产品|role/.test(value)) return "role_knowledge";
  if (/技术|算法|基础|react|typescript|node|前端|后端|数据库|网络/.test(value)) {
    return "technical";
  }
  return "other";
}

export function normalizeInterviewBankQuestion(input = {}, options = {}) {
  const question = text(input.question, 1200);
  const fingerprint = interviewQuestionFingerprint(question);
  const now = text(options.now, 80) || new Date().toISOString();
  const category = text(input.category, 80) || "待分类";
  const type = QUESTION_TYPES.has(input.type)
    ? input.type
    : inferInterviewQuestionType(category, question);
  const origin = QUESTION_ORIGINS.has(input.origin) ? input.origin : options.origin || "generated";
  const hasExplicitStatus = QUESTION_STATUSES.has(input.status);
  const requiresCuration = ["session", "imported", "real_interview"].includes(origin);
  const status = requiresCuration ? "inbox" : hasExplicitStatus ? input.status : "ready";
  const normalized = {
    id: text(input.id, 100) || `bank-${fingerprint || stableHash(`${question}-${now}`)}`,
    fingerprint,
    fingerprintAliases: list(
      [
        ...(Array.isArray(input.fingerprintAliases ?? input.fingerprint_aliases)
          ? (input.fingerprintAliases ?? input.fingerprint_aliases)
          : []),
        input.fingerprint,
      ],
      20,
      100,
    ).filter((item) => item !== fingerprint),
    question,
    category,
    competency: text(input.competency, 120),
    type,
    difficulty: ["基础", "进阶", "挑战"].includes(input.difficulty) ? input.difficulty : "进阶",
    priority: ["high", "medium", "low"].includes(input.priority) ? input.priority : "medium",
    status,
    origin: QUESTION_ORIGINS.has(origin) ? origin : "generated",
    tags: list(input.tags, 16, 80),
    sourceRefs: list(input.sourceRefs ?? input.evidenceRefs, 16, 500),
    answerPoints: list(input.answerPoints, 12, 500),
    recommendedAnswer: text(input.recommendedAnswer, 5000),
    followUps: list(input.followUps, 10, 800),
    notes: text(input.notes, 3000),
    jobIds: list(input.jobIds, 12, 100),
    sourceSetIds: list(input.sourceSetIds, 20, 100),
    practiceAttempts: attempts(input.practiceAttempts),
    practiceReviews: reviews(input.practiceReviews),
    lastPracticedAt: text(input.lastPracticedAt, 80),
    revision: Math.max(1, Math.floor(Number(input.revision) || 1)),
    createdAt: text(input.createdAt, 80) || now,
    updatedAt: text(input.updatedAt, 80) || now,
  };
  if (["ready", "mastered"].includes(status) && questionBankCurationGaps(normalized).length) {
    normalized.status = "inbox";
  }
  return normalized;
}

function mergeBankQuestion(current, incoming) {
  const incomingIsUserCurated = incoming.origin === "manual";
  const currentIsUserCurated = current.origin === "manual";
  const preferredCurated = (() => {
    if (currentIsUserCurated && !incomingIsUserCurated) return current;
    if (incomingIsUserCurated && !currentIsUserCurated) return incoming;
    if (!currentIsUserCurated) return null;
    const currentRevision = Number(current.revision) || 1;
    const incomingRevision = Number(incoming.revision) || 1;
    if (incomingRevision !== currentRevision) {
      return incomingRevision > currentRevision ? incoming : current;
    }
    const currentUpdatedAt = Date.parse(String(current.updatedAt || ""));
    const incomingUpdatedAt = Date.parse(String(incoming.updatedAt || ""));
    if (Number.isFinite(currentUpdatedAt) || Number.isFinite(incomingUpdatedAt)) {
      return (Number.isFinite(incomingUpdatedAt) ? incomingUpdatedAt : -1) >
        (Number.isFinite(currentUpdatedAt) ? currentUpdatedAt : -1)
        ? incoming
        : current;
    }
    return current;
  })();
  const supplemental = preferredCurated === current ? incoming : current;
  const realInterviewSupplement = supplemental.origin === "real_interview";
  const preferredFingerprint = preferredCurated
    ? preferredCurated.fingerprint || supplemental.fingerprint
    : current.fingerprint || incoming.fingerprint;
  return {
    ...current,
    fingerprint: preferredFingerprint,
    fingerprintAliases: union(current.fingerprintAliases, incoming.fingerprintAliases, [
      current.fingerprint,
      incoming.fingerprint,
    ])
      .filter((item) => item !== preferredFingerprint)
      .slice(0, 20),
    question: preferredCurated?.question || current.question,
    category: preferredCurated
      ? preferredCurated.category
      : current.category === "待分类"
        ? incoming.category
        : current.category,
    competency: preferredCurated
      ? preferredCurated.competency
      : current.competency || incoming.competency,
    type: preferredCurated
      ? preferredCurated.type
      : current.type === "other"
        ? incoming.type
        : current.type,
    difficulty: preferredCurated?.difficulty || current.difficulty,
    priority: preferredCurated?.priority || current.priority,
    status: preferredCurated
      ? preferredCurated.status
      : current.status === "archived"
        ? "archived"
        : current.status,
    // Source refs record every later sighting. Keep the first canonical
    // origin here so a real-interview duplicate cannot turn an existing
    // ready/archived item into a schema-invalid real_interview record without
    // also changing its curation status.
    origin: preferredCurated ? "manual" : current.origin,
    tags: preferredCurated
      ? union(preferredCurated.tags, realInterviewSupplement ? supplemental.tags : []).slice(0, 16)
      : union(current.tags, incoming.tags).slice(0, 16),
    sourceRefs: union(current.sourceRefs, incoming.sourceRefs).slice(0, 16),
    answerPoints: preferredCurated
      ? union(
          preferredCurated.answerPoints,
          realInterviewSupplement ? supplemental.answerPoints : [],
        ).slice(0, 12)
      : union(current.answerPoints, incoming.answerPoints).slice(0, 12),
    recommendedAnswer: preferredCurated
      ? preferredCurated.recommendedAnswer
      : current.recommendedAnswer || incoming.recommendedAnswer,
    followUps: preferredCurated
      ? union(
          preferredCurated.followUps,
          realInterviewSupplement ? supplemental.followUps : [],
        ).slice(0, 10)
      : union(current.followUps, incoming.followUps).slice(0, 10),
    notes: preferredCurated ? preferredCurated.notes : current.notes || incoming.notes,
    jobIds: union(current.jobIds, incoming.jobIds).slice(0, 12),
    sourceSetIds: union(current.sourceSetIds, incoming.sourceSetIds).slice(0, 20),
    practiceAttempts: attempts([...current.practiceAttempts, ...incoming.practiceAttempts]),
    practiceReviews: reviews([...current.practiceReviews, ...incoming.practiceReviews]),
    lastPracticedAt: [current.lastPracticedAt, incoming.lastPracticedAt].sort().at(-1) || "",
    updatedAt: preferredCurated
      ? preferredCurated.updatedAt
      : [current.updatedAt, incoming.updatedAt].sort().at(-1) || current.updatedAt,
    revision: preferredCurated
      ? Math.max(1, Number(preferredCurated.revision) || 1)
      : Math.max(Number(current.revision) || 1, Number(incoming.revision) || 1),
  };
}

export function interviewBankQuestionsFromDebrief(debrief = {}, options = {}) {
  const now = text(options.now, 80) || new Date().toISOString();
  const debriefId = text(debrief.id, 100);
  const jobId = text(debrief.jobId, 100);
  return (Array.isArray(debrief.questions) ? debrief.questions : [])
    .map((item) => {
      const notes = [
        item?.reportedFeedback ? `面试方反馈：${text(item.reportedFeedback, 1200)}` : "",
        item?.analysis ? `复盘分析：${text(item.analysis, 1200)}` : "",
      ].filter(Boolean);
      return normalizeInterviewBankQuestion(
        {
          question: item?.question,
          category: "真实面试",
          difficulty: "进阶",
          priority: "high",
          status: "inbox",
          origin: "real_interview",
          sourceRefs: debriefId ? [`real-interview:${debriefId}`] : ["real-interview:user-report"],
          answerPoints: item?.betterAnswerPoints,
          notes: notes.join("\n"),
          jobIds: jobId ? [jobId] : [],
          createdAt: now,
          updatedAt: now,
        },
        { now, origin: "real_interview" },
      );
    })
    .filter((item) => item.question.length >= 8)
    .slice(0, 30);
}

/**
 * Migrate legacy set-only questions into a canonical, deduplicated bank while
 * keeping the set question IDs stable for existing practice-review calls.
 */
export function normalizeInterviewLibrary(questionBank = [], interviewSets = [], options = {}) {
  const now = text(options.now, 80) || new Date().toISOString();
  const bank = [];
  const byId = new Map();
  const byFingerprint = new Map();
  const canonicalInputIds = new Set(
    (Array.isArray(questionBank) ? questionBank : []).map((item) => text(item?.id, 100)),
  );

  const add = (candidate) => {
    if (!candidate.question) return null;
    const candidateFingerprints = [candidate.fingerprint, ...candidate.fingerprintAliases].filter(
      Boolean,
    );
    const existing =
      byId.get(candidate.id) ||
      candidateFingerprints.map((fingerprint) => byFingerprint.get(fingerprint)).find(Boolean);
    if (existing) {
      const merged = mergeBankQuestion(existing, candidate);
      Object.assign(existing, merged);
      // A duplicate can arrive with a legacy/local ID. Keep that ID as an
      // in-memory lookup alias so later set questions still resolve to the
      // canonical item even when their wording has drifted.
      if (candidate.id) byId.set(candidate.id, existing);
      for (const fingerprint of [existing.fingerprint, ...existing.fingerprintAliases]) {
        if (fingerprint) byFingerprint.set(fingerprint, existing);
      }
      return existing;
    }
    bank.push(candidate);
    byId.set(candidate.id, candidate);
    for (const fingerprint of candidateFingerprints) byFingerprint.set(fingerprint, candidate);
    return candidate;
  };

  for (const item of Array.isArray(questionBank) ? questionBank : []) {
    add(normalizeInterviewBankQuestion(item, { now, origin: item?.origin }));
  }

  const sets = (Array.isArray(interviewSets) ? interviewSets : []).slice(0, 20).map((set) => {
    const setSource = set && typeof set === "object" && !Array.isArray(set) ? set : {};
    const setId =
      text(setSource.id, 100) ||
      `set-${stableHash(`${text(setSource.title, 200)}-${text(setSource.createdAt, 80)}`)}`;
    const setJobIds = list(set?.jobIds ?? (set?.jobId ? [set.jobId] : []), 12, 100);
    const questions = (Array.isArray(setSource.questions) ? setSource.questions : [])
      .slice(0, 30)
      .map((question, questionIndex) => {
        const linkedBankQuestionId = text(question?.bankQuestionId, 100);
        const candidate = normalizeInterviewBankQuestion(
          {
            ...question,
            id: linkedBankQuestionId,
            origin: question?.origin || "generated",
            jobIds: union(setJobIds, list(question?.jobIds, 12, 100)),
            sourceSetIds: union([setId], list(question?.sourceSetIds, 20, 100)),
          },
          { now, origin: "generated" },
        );
        const authoritative = linkedBankQuestionId ? byId.get(linkedBankQuestionId) : null;
        const saved =
          authoritative && canonicalInputIds.has(linkedBankQuestionId)
            ? Object.assign(authoritative, {
                jobIds: union(authoritative.jobIds, candidate.jobIds).slice(0, 12),
                sourceSetIds: union(authoritative.sourceSetIds, candidate.sourceSetIds).slice(
                  0,
                  20,
                ),
              })
            : add(candidate);
        return {
          id:
            text(question?.id, 100) ||
            `set-question-${stableHash(`${setId}-${saved?.id || questionIndex}`)}`,
          bankQuestionId: saved?.id || "",
          question: saved?.question || text(question?.question, 1200),
          category: saved?.category || text(question?.category, 80) || "待分类",
          competency: saved ? saved.competency : text(question?.competency, 120),
          type: saved
            ? saved.type
            : inferInterviewQuestionType(question?.category, question?.question),
          tags: saved ? saved.tags : list(question?.tags, 16, 80),
          difficulty: saved ? saved.difficulty : question?.difficulty || "进阶",
          why: text(question?.why, 1200),
          sourceRefs: saved?.sourceRefs || list(question?.sourceRefs, 16, 500),
          evidenceRefs: saved?.sourceRefs || list(question?.evidenceRefs, 16, 500),
          answerPoints: saved?.answerPoints || list(question?.answerPoints, 12, 500),
          recommendedAnswer: saved
            ? saved.recommendedAnswer
            : text(question?.recommendedAnswer, 5000),
          followUps: saved?.followUps || list(question?.followUps, 10, 800),
          practiceAttempts: saved?.practiceAttempts || attempts(question?.practiceAttempts),
          practiceReviews: saved?.practiceReviews || reviews(question?.practiceReviews),
        };
      });
    const jobId = text(setSource.jobId, 100);
    const sourceMode = ["jd", "aggregate", "commits", "mixed"].includes(setSource.sourceMode)
      ? setSource.sourceMode
      : setJobIds.length > 1
        ? "aggregate"
        : jobId
          ? "jd"
          : "commits";
    return {
      id: setId,
      jobId: sourceMode === "aggregate" ? "" : jobId,
      jobIds: union(setJobIds, jobId ? [jobId] : []).slice(0, 12),
      sourceMode,
      title: text(setSource.title, 200) || "面试练习题单",
      mode: text(setSource.mode, 40) || "balanced",
      difficulty: ["基础", "进阶", "挑战"].includes(setSource.difficulty)
        ? setSource.difficulty
        : "进阶",
      createdAt: text(setSource.createdAt, 80) || now,
      questions,
    };
  });

  // Archived questions are the only records eligible for automatic eviction.
  // This lets curation free capacity without silently discarding an active or
  // practiced question when the 600-item snapshot limit is reached.
  const retainedIds = new Set(
    bank
      .map((item, index) => ({ item, index }))
      .sort(
        (left, right) =>
          Number(left.item.status === "archived") - Number(right.item.status === "archived") ||
          left.index - right.index,
      )
      .slice(0, QUESTION_BANK_LIMIT)
      .map(({ item }) => item.id),
  );
  const retainedSetIds = new Set(sets.map((item) => item.id));
  const cappedBank = bank
    .filter((item) => retainedIds.has(item.id))
    .map((item) => ({
      ...item,
      sourceSetIds: item.sourceSetIds.filter((setId) => retainedSetIds.has(setId)),
    }));
  const retainedQuestionIds = new Set(cappedBank.map((item) => item.id));
  const consistentSets = sets.map((set) => ({
    ...set,
    questions: (set.questions || []).filter((question) =>
      retainedQuestionIds.has(question.bankQuestionId),
    ),
  }));
  return { questionBank: cappedBank, interviewSets: consistentSets };
}

export function canonicalizeMockSessionQuestionIds(
  session = {},
  interviewSets = [],
  questionBank = [],
) {
  const bankIds = new Set((Array.isArray(questionBank) ? questionBank : []).map((item) => item.id));
  const sets = Array.isArray(interviewSets) ? interviewSets : [];
  const selectedSet = sets.find((item) => item.id === session.interviewSetId) || null;
  const localCandidates = new Map();
  for (const set of sets) {
    for (const question of Array.isArray(set?.questions) ? set.questions : []) {
      if (!question?.id || !bankIds.has(question.bankQuestionId)) continue;
      const candidates = localCandidates.get(question.id) || new Set();
      candidates.add(question.bankQuestionId);
      localCandidates.set(question.id, candidates);
    }
  }
  const resolveId = (rawId) => {
    const id = text(rawId, 100);
    if (!id) return "";
    if (bankIds.has(id)) return id;
    const scoped = (selectedSet?.questions || []).find(
      (question) => question.id === id || question.bankQuestionId === id,
    )?.bankQuestionId;
    if (scoped && bankIds.has(scoped)) return scoped;
    const candidates = localCandidates.get(id);
    return candidates?.size === 1 ? [...candidates][0] : "";
  };
  const questionIds = [
    ...new Set(list(session.questionIds, 40, 100).map(resolveId).filter(Boolean)),
  ];
  const questionIdSet = new Set(questionIds);
  const reviewedQuestionIds = [
    ...new Set(list(session.reviewedQuestionIds, 40, 100).map(resolveId).filter(Boolean)),
  ].filter((id) => questionIdSet.has(id));
  const answeredQuestionIds = [
    ...new Set(
      [...list(session.answeredQuestionIds, 40, 100), ...list(session.reviewedQuestionIds, 40, 100)]
        .map(resolveId)
        .filter(Boolean),
    ),
  ].filter((id) => questionIdSet.has(id));
  return { questionIds, answeredQuestionIds, reviewedQuestionIds };
}

export function questionBankStats(questionBank = []) {
  const visible = questionBank.filter((item) => item.status !== "archived");
  return {
    total: visible.length,
    inbox: visible.filter((item) => item.status === "inbox").length,
    ready: visible.filter((item) => item.status === "ready").length,
    mastered: visible.filter((item) => item.status === "mastered").length,
    practiced: visible.filter(
      (item) => item.practiceAttempts?.length || item.practiceReviews?.length,
    ).length,
    needsWork: visible.filter(questionNeedsWork).length,
  };
}

export function latestQuestionPracticeReview(question = {}) {
  const attempts = Array.isArray(question.practiceReviews) ? question.practiceReviews : [];
  return (
    attempts
      .map((review, index) => ({
        review,
        index,
        timestamp: Date.parse(String(review?.createdAt || "")),
      }))
      .sort((left, right) => {
        const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : -1;
        const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : -1;
        return rightTime - leftTime || left.index - right.index;
      })[0]?.review || null
  );
}

export function latestQuestionPracticeAttempt(question = {}) {
  const savedAttempts = Array.isArray(question.practiceAttempts) ? question.practiceAttempts : [];
  return (
    savedAttempts
      .map((attempt, index) => ({
        attempt,
        index,
        timestamp: Date.parse(String(attempt?.updatedAt || attempt?.createdAt || "")),
      }))
      .sort((left, right) => {
        const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : -1;
        const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : -1;
        return rightTime - leftTime || left.index - right.index;
      })[0]?.attempt || null
  );
}

export function questionNeedsWork(question = {}, threshold = 70) {
  const latest = latestQuestionPracticeReview(question);
  if (!latest || !["ready", "mastered"].includes(question.status)) return false;
  return score(latest.overallScore) < Math.max(1, Math.min(100, Number(threshold) || 70));
}

export function questionBankCurationGaps(question = {}) {
  const gaps = [];
  if (text(question.question, 1200).length < 8) gaps.push("清晰题干");
  if (!text(question.category, 80) || text(question.category, 80) === "待分类") {
    gaps.push("分类");
  }
  if (!text(question.competency, 120)) gaps.push("评估能力");
  if (!list(question.sourceRefs ?? question.evidenceRefs, 16, 500).length) {
    gaps.push("Source");
  }
  return gaps;
}

const INTERVIEW_COMPETENCY_FALLBACKS = Object.freeze({
  behavioral: "协作沟通、冲突处理与复盘能力",
  technical: "技术原理、问题定位与工程实践",
  system_design: "系统边界、架构取舍与可靠性设计",
  project_deep_dive: "个人贡献、技术决策与结果表达",
  resume_probe: "经历归属、证据可信度与结果表达",
  scenario: "场景分析、风险判断与方案取舍",
  role_knowledge: "岗位理解、业务判断与价值表达",
  other: "问题分析、结构化表达与岗位相关性",
});

export function inferInterviewQuestionCompetency(question = {}) {
  const explicit = text(question.competency, 120);
  if (explicit) return explicit;
  const category = text(question.category, 80);
  const type = QUESTION_TYPES.has(question.type)
    ? question.type
    : inferInterviewQuestionType(category, question.question);
  const typeFallback = INTERVIEW_COMPETENCY_FALLBACKS[type] || INTERVIEW_COMPETENCY_FALLBACKS.other;
  if (!category || category === "待分类") return typeFallback;
  return `${category}：${typeFallback}`.slice(0, 120);
}

export function repairableInterviewQuestions(questionBank = []) {
  return questionBank
    .filter((question) => question?.status === "inbox")
    .map((question) => ({
      question,
      competency: inferInterviewQuestionCompetency(question),
      gaps: questionBankCurationGaps(question),
    }))
    .filter(
      (entry) =>
        entry.competency &&
        entry.gaps.length === 1 &&
        entry.gaps[0] === "评估能力" &&
        questionBankCurationGaps({ ...entry.question, competency: entry.competency }).length === 0,
    );
}

function timestamp(value) {
  const parsed = Date.parse(text(value, 80));
  return Number.isFinite(parsed) ? parsed : -1;
}

export function interviewQuestionLearningSchedule(question = {}, options = {}) {
  const review = latestQuestionPracticeReview(question);
  const attempt = latestQuestionPracticeAttempt(question);
  const latestScore = review ? score(review.overallScore) : null;
  const learningState = !attempt && !review
    ? "unseen"
    : latestScore === null
      ? "awaiting_review"
      : latestScore < 70
        ? "weak"
        : latestScore < 80
          ? "developing"
          : "strong";
  const reviewCount = Array.isArray(question.practiceReviews)
    ? question.practiceReviews.length
    : 0;
  const baseIntervalDays =
    learningState === "unseen"
      ? 0
      : learningState === "weak"
        ? latestScore < 60
          ? 1
          : 2
        : learningState === "awaiting_review"
          ? 3
          : learningState === "developing"
            ? 4
            : 10;
  const growth = latestScore !== null && latestScore >= 70
    ? 1 + Math.min(2, Math.max(0, reviewCount - 1) * 0.35)
    : 1;
  const intervalDays = Math.min(45, Math.max(0, Math.round(baseIntervalDays * growth)));
  const practicedAt = Math.max(
    timestamp(review?.createdAt),
    timestamp(attempt?.updatedAt || attempt?.createdAt),
    timestamp(question.lastPracticedAt),
  );
  const parsedNow = Date.parse(text(options.now, 80));
  const now = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  if (learningState === "unseen") {
    return {
      state: learningState,
      latestScore,
      intervalDays,
      practicedAt: "",
      nextReviewAt: "",
      due: true,
      daysUntilReview: 0,
    };
  }
  if (practicedAt < 0) {
    const due = learningState !== "strong";
    return {
      state: learningState,
      latestScore,
      intervalDays,
      practicedAt: "",
      nextReviewAt: "",
      due,
      daysUntilReview: due ? 0 : null,
    };
  }
  const nextReview = practicedAt + intervalDays * 86_400_000;
  const daysUntilReview = Math.ceil((nextReview - now) / 86_400_000);
  return {
    state: learningState,
    latestScore,
    intervalDays,
    practicedAt: new Date(practicedAt).toISOString(),
    nextReviewAt: new Date(nextReview).toISOString(),
    due: nextReview <= now,
    daysUntilReview,
  };
}

export function interviewPracticeQueue(questionBank = [], options = {}) {
  const preferredIds = new Set(
    Array.isArray(options.preferredQuestionIds) ? options.preferredQuestionIds : [],
  );
  const limit = Math.max(1, Math.min(40, Math.floor(Number(options.limit) || 10)));
  return questionBank
    .filter((question) => ["ready", "mastered"].includes(question?.status))
    .map((question, index) => {
      const review = latestQuestionPracticeReview(question);
      const attempt = latestQuestionPracticeAttempt(question);
      const latestScore = review ? score(review.overallScore) : null;
      const learning = interviewQuestionLearningSchedule(question, { now: options.now });
      const learningRank =
        learning.due && learning.state === "weak"
          ? 0
          : learning.due && learning.state !== "unseen"
            ? 1
            : learning.state === "unseen"
              ? 2
              : learning.state === "weak"
                ? 3
                : question.status === "ready"
                  ? 4
                  : 5;
      return {
        question,
        latestScore,
        weak: latestScore !== null && latestScore < 70,
        newQuestion: !attempt,
        learning,
        due: learning.due,
        nextReviewAt: learning.nextReviewAt,
        index,
        preferred: preferredIds.has(question.id),
        learningRank,
      };
    })
    .sort(
      (left, right) =>
        left.learningRank - right.learningRank ||
        Number(right.preferred) - Number(left.preferred) ||
        ({ high: 0, medium: 1, low: 2 }[left.question.priority] ?? 9) -
          ({ high: 0, medium: 1, low: 2 }[right.question.priority] ?? 9) ||
        timestamp(left.question.lastPracticedAt) - timestamp(right.question.lastPracticedAt) ||
        left.index - right.index,
    )
    .slice(0, limit);
}

export function resumableMockSessions(mockSessions = []) {
  return mockSessions
    .filter((session) => {
      if (session?.status !== "in_progress") return false;
      const progress = mockSessionProgress(session);
      return progress.answeredCount > 0 && progress.answeredCount < progress.questionCount;
    })
    .sort(
      (left, right) =>
        timestamp(right.updatedAt || right.startedAt) - timestamp(left.updatedAt || left.startedAt),
    );
}

export function questionBankPage(items = [], visibleLimit = 60) {
  const source = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(QUESTION_BANK_LIMIT, Math.floor(Number(visibleLimit) || 60)));
  const pageItems = source.slice(0, limit);
  return {
    items: pageItems,
    shownCount: pageItems.length,
    totalCount: source.length,
    remainingCount: Math.max(0, source.length - pageItems.length),
    hasMore: pageItems.length < source.length,
  };
}

export function mockSessionScoreSummary(
  questionBank = [],
  reviewedQuestionIds = [],
  practiceSessionId = "",
) {
  const ids = new Set(list(reviewedQuestionIds, 40, 100));
  const completedReviews = questionBank
    .filter((item) => ids.has(item.id))
    .map((item) => {
      const attempts = Array.isArray(item.practiceReviews) ? item.practiceReviews : [];
      return practiceSessionId
        ? attempts.find((review) => review?.practiceSessionId === practiceSessionId)
        : attempts.find((review) => !review?.practiceSessionId);
    })
    .filter(Boolean);
  const dimensionKeys = ["evidence", "structure", "depth", "relevance"];
  const average = (values) =>
    values.length
      ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
      : 0;
  return {
    reviewedCount: completedReviews.length,
    averageScore: average(completedReviews.map((review) => Number(review.overallScore) || 0)),
    dimensions: Object.fromEntries(
      dimensionKeys.map((key) => [
        key,
        average(completedReviews.map((review) => Number(review.dimensions?.[key]) || 0)),
      ]),
    ),
  };
}

export function normalizeMockSessionScoreSummary(value = {}, fallback = {}) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const safeFallback =
    fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const source = candidate && Object.keys(candidate).length ? candidate : safeFallback;
  const dimensions =
    source.dimensions && typeof source.dimensions === "object" ? source.dimensions : {};
  return {
    reviewedCount: Math.max(0, Math.min(40, Math.floor(Number(source.reviewedCount) || 0))),
    averageScore: score(source.averageScore),
    dimensions: {
      evidence: score(dimensions.evidence),
      structure: score(dimensions.structure),
      depth: score(dimensions.depth),
      relevance: score(dimensions.relevance),
    },
  };
}

export function mockSessionProgress(session = {}) {
  const scoreSummary = normalizeMockSessionScoreSummary(session.scoreSummary);
  const reviewedCount = Math.max(
    scoreSummary.reviewedCount,
    list(session.reviewedQuestionIds, 40, 100).length,
  );
  const questionCount = Math.max(
    list(session.answeredQuestionIds, 40, 100).length,
    reviewedCount,
    list(session.questionIds, 40, 100).length,
    Math.max(0, Math.min(40, Math.floor(Number(session.questionCount) || 0))),
  );
  return {
    answeredCount: Math.max(reviewedCount, list(session.answeredQuestionIds, 40, 100).length),
    reviewedCount,
    questionCount,
  };
}

export function resolveMockSessionScoreSummary(stored, computed, status = "in_progress") {
  const saved = normalizeMockSessionScoreSummary(stored);
  const live = normalizeMockSessionScoreSummary(computed);
  if (["completed", "abandoned"].includes(status) && saved.reviewedCount > 0) {
    return saved;
  }
  return live.reviewedCount ? live : saved;
}

export function mockSessionReviewTargetError(session, bankQuestionId, interviewSetId = "") {
  if (!session) return "practice_session_id 不存在，请先读取面板上下文";
  if (!(session.questionIds || []).includes(bankQuestionId)) {
    return "bank_question_id 不属于这场模拟面试";
  }
  if (interviewSetId && session.interviewSetId !== interviewSetId) {
    return "interview_set_id 与这场模拟面试不一致";
  }
  if (
    session.status !== "in_progress" &&
    !(session.answeredQuestionIds || []).includes(bankQuestionId)
  ) {
    return "这场模拟已经结束，且该题没有已保存回答，不能补写评分";
  }
  return "";
}

export function updateInterviewBankQuestion(questionBank, questionId, patch, now) {
  let updated = null;
  const next = questionBank.map((item) => {
    if (item.id !== questionId) return item;
    updated = normalizeInterviewBankQuestion(
      {
        ...item,
        ...patch,
        id: item.id,
        fingerprintAliases: union(item.fingerprintAliases, [item.fingerprint]),
        createdAt: item.createdAt,
        revision: (Number(item.revision) || 1) + 1,
        updatedAt: now || new Date().toISOString(),
      },
      { now: now || new Date().toISOString(), origin: patch.origin || item.origin },
    );
    return updated;
  });
  return { questionBank: next, updated };
}

export function syncInterviewSetsFromBank(interviewSets, questionBank) {
  const byId = new Map(questionBank.map((item) => [item.id, item]));
  return interviewSets.map((set) => ({
    ...set,
    questions: (set.questions || []).map((question) => {
      const bank = byId.get(question.bankQuestionId);
      if (!bank) return question;
      return {
        ...question,
        question: bank.question,
        category: bank.category,
        competency: bank.competency,
        type: bank.type,
        tags: bank.tags,
        difficulty: bank.difficulty,
        sourceRefs: bank.sourceRefs,
        evidenceRefs: bank.sourceRefs,
        answerPoints: bank.answerPoints,
        recommendedAnswer: bank.recommendedAnswer,
        followUps: bank.followUps,
        practiceAttempts: bank.practiceAttempts,
        practiceReviews: bank.practiceReviews,
      };
    }),
  }));
}
