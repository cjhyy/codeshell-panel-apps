export const JOB_SEARCH_CONTEXT_MAX_BYTES = 224 * 1024;
export const INTERVIEW_CONTEXT_MAX_BYTES = 64 * 1024;
export const INTERVIEW_PRACTICE_CONTEXT_MAX_BYTES = 64 * 1024;
export const JOB_SEARCH_CONTEXT_SCOPES = Object.freeze([
  "summary",
  "candidate",
  "jobs",
  "job",
  "resumes",
  "resume",
  "questions",
  "interviews",
  "interview",
  "practice",
  "discovery",
  "intake",
]);

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function recordId(value) {
  return text(value?.versionId || value?.id);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function boundedTextList(value, limit, maxLength) {
  return list(value)
    .slice(0, limit)
    .map((item) => text(item).slice(0, maxLength))
    .filter(Boolean);
}

function page(items, cursor, limit, summarize) {
  const start = Math.min(cursor, items.length);
  const selected = items.slice(start, start + limit).map(summarize);
  const nextCursor = start + selected.length;
  return {
    items: selected,
    total: items.length,
    cursor: start,
    limit,
    nextCursor: nextCursor < items.length ? nextCursor : null,
  };
}

function jobSummary(job) {
  return {
    id: text(job?.id),
    company: text(job?.company),
    title: text(job?.title),
    location: text(job?.location),
    salary: text(job?.salary),
    source: text(job?.source),
    status: text(job?.status),
    match: Number.isFinite(job?.match) ? job.match : null,
    jdCompleteness: text(job?.jdCompleteness),
    updatedAt: text(job?.updatedAt),
  };
}

function resumeSummary(resume) {
  return {
    id: recordId(resume),
    title: text(resume?.title),
    kind: text(resume?.kind),
    category: text(resume?.category),
    baseResumeId: text(resume?.baseResumeId),
    jobId: text(resume?.jobId),
    claimCount: list(resume?.claimEvidence).length,
    candidateQuestionCount: list(resume?.candidateQuestions).length,
    updatedAt: text(resume?.updatedAt),
  };
}

function interviewQuestionSummary(question) {
  const reviews = list(question?.practiceReviews);
  const latestReview = reviews[0] || null;
  return {
    id: text(question?.id),
    question: text(question?.question),
    category: text(question?.category),
    type: text(question?.type),
    difficulty: text(question?.difficulty),
    competency: text(question?.competency),
    tags: list(question?.tags),
    status: text(question?.status),
    origin: text(question?.origin),
    sourceRefCount: list(question?.sourceRefs).length,
    practiceAttemptCount: list(question?.practiceAttempts).length,
    practiceReviewCount: reviews.length,
    latestScore: Number.isFinite(latestReview?.overallScore) ? latestReview.overallScore : null,
    lastPracticedAt: text(question?.lastPracticedAt),
    updatedAt: text(question?.updatedAt),
  };
}

function interviewQuestionIndexMatches(question, query) {
  const status = text(query.status) || "active";
  const statusMatches =
    status === "all" ||
    (status === "active" && text(question?.status) !== "archived") ||
    (status === "practiced" &&
      Boolean(list(question?.practiceAttempts).length || list(question?.practiceReviews).length)) ||
    text(question?.status) === status;
  if (!statusMatches) return false;
  const search = text(query.search).toLocaleLowerCase();
  if (!search) return true;
  return [question?.question, question?.category, question?.competency, ...list(question?.tags)]
    .map(text)
    .join(" ")
    .toLocaleLowerCase()
    .includes(search);
}

function practiceQuestionDetail(question) {
  return {
    id: text(question?.id),
    question: text(question?.question).slice(0, 2000),
    category: text(question?.category).slice(0, 200),
    competency: text(question?.competency).slice(0, 300),
    type: text(question?.type),
    difficulty: text(question?.difficulty),
    priority: text(question?.priority),
    status: text(question?.status),
    origin: text(question?.origin),
    tags: boundedTextList(question?.tags, 20, 120),
    sourceRefs: boundedTextList(question?.sourceRefs, 30, 500),
    answerPoints: boundedTextList(question?.answerPoints, 10, 800),
    recommendedAnswer: text(question?.recommendedAnswer).slice(0, 6000),
    followUps: boundedTextList(question?.followUps, 10, 800),
    notes: text(question?.notes).slice(0, 2000),
    jobIds: boundedTextList(question?.jobIds, 20, 100),
    sourceSetIds: boundedTextList(question?.sourceSetIds, 20, 100),
    practiceAttemptCount: list(question?.practiceAttempts).length,
    practiceReviewCount: list(question?.practiceReviews).length,
    lastPracticedAt: text(question?.lastPracticedAt),
    revision: Number(question?.revision) || 1,
    updatedAt: text(question?.updatedAt),
  };
}

function sourceMatchesRecord(record, sourceRefs) {
  const recordTokens = [
    record?.id,
    record?.name,
    record?.company,
    record?.title,
    record?.role,
    record?.repository,
    record?.url,
    record?.path,
  ]
    .map(text)
    .filter((value) => value.length >= 2)
    .map((value) => value.toLocaleLowerCase());
  const sources = sourceRefs.map((value) => text(value).toLocaleLowerCase());
  return recordTokens.some((token) => sources.some((source) => source.includes(token)));
}

function repositoryEvidenceSummary(repository) {
  return {
    id: text(repository?.id),
    name: text(repository?.name),
    url: text(repository?.url),
    path: text(repository?.path),
    summary: text(repository?.summary).slice(0, 1500),
    technologies: list(repository?.technologies ?? repository?.techStack).slice(0, 12),
    highlights: list(repository?.highlights ?? repository?.achievements)
      .slice(0, 5)
      .map((item) => text(item).slice(0, 500)),
  };
}

function workEvidenceSummary(experience) {
  return {
    id: text(experience?.id),
    company: text(experience?.company),
    title: text(experience?.title || experience?.role),
    period: text(experience?.period || experience?.dates),
    summary: text(experience?.summary).slice(0, 1500),
    achievements: list(experience?.achievements)
      .slice(0, 5)
      .map((item) => text(item).slice(0, 500)),
  };
}

function compactCandidateEvidence(input, sourceRefs) {
  const repositories = list(input.repositories);
  const workHistory = list(input.workHistory);
  const matchingRepositories = repositories.filter((item) => sourceMatchesRecord(item, sourceRefs));
  const matchingWork = workHistory.filter((item) => sourceMatchesRecord(item, sourceRefs));
  return {
    profile: {
      name: text(input.profile?.name),
      role: text(input.profile?.role),
      target: text(input.profile?.target),
      summary: text(input.profile?.summary).slice(0, 3000),
    },
    repositories: (matchingRepositories.length ? matchingRepositories : repositories.slice(0, 2))
      .slice(0, 2)
      .map(repositoryEvidenceSummary),
    workHistory: (matchingWork.length ? matchingWork : workHistory.slice(0, 2))
      .slice(0, 2)
      .map(workEvidenceSummary),
    selection:
      matchingRepositories.length || matchingWork.length ? "source-matched" : "bounded-fallback",
  };
}

function interviewResearchSummary(research) {
  const company = research?.company && typeof research.company === "object" ? research.company : {};
  const intel =
    research?.interviewIntel && typeof research.interviewIntel === "object"
      ? research.interviewIntel
      : {};
  return {
    id: text(research?.id),
    jobId: text(research?.jobId),
    company: {
      officialName: text(company.officialName || research?.companyName),
      summary: text(company.summary).slice(0, 1200),
      industry: text(company.industry).slice(0, 500),
      techSignals: list(company.techSignals)
        .slice(0, 8)
        .map((item) => text(item).slice(0, 400)),
      hiringSignals: list(company.hiringSignals)
        .slice(0, 8)
        .map((item) => text(item).slice(0, 400)),
    },
    interviewIntel: {
      summary: text(intel.summary).slice(0, 1200),
      process: list(intel.process)
        .slice(0, 6)
        .map((item) => text(item).slice(0, 500)),
      themes: list(intel.themes)
        .slice(0, 10)
        .map((item) => text(item).slice(0, 300)),
    },
    risks: list(research?.risks)
      .slice(0, 8)
      .map((item) => (typeof item === "string" ? item.slice(0, 500) : item)),
    sourceCount: list(research?.sources).length,
    updatedAt: text(research?.updatedAt),
  };
}

function preparationPlanSummary(plan) {
  return {
    id: text(plan?.id),
    jobId: text(plan?.jobId),
    title: text(plan?.title),
    summary: text(plan?.summary).slice(0, 1200),
    priorityCount: list(plan?.priorities).length,
    updatedAt: text(plan?.updatedAt),
  };
}

function recentPracticeRecords(records, practiceSessionId, limit = 3) {
  const candidates = practiceSessionId
    ? list(records).filter((item) => text(item?.practiceSessionId) === practiceSessionId)
    : list(records);
  return candidates
    .map((item, index) => ({
      item,
      index,
      timestamp: Date.parse(text(item?.updatedAt || item?.createdAt)),
    }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : -1;
      const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : -1;
      return rightTime - leftTime || left.index - right.index;
    })
    .slice(0, limit)
    .map(({ item }) => item);
}

function interviewQuestionDetail(question, practiceSessionId = "", practiceRecordLimit = 1) {
  const practiceAttempts = practiceRecordLimit
    ? recentPracticeRecords(question?.practiceAttempts, practiceSessionId, practiceRecordLimit)
    : [];
  const practiceReviews = practiceRecordLimit
    ? recentPracticeRecords(question?.practiceReviews, practiceSessionId, practiceRecordLimit)
    : [];
  return {
    ...practiceQuestionDetail(question),
    practiceAttempts,
    practiceReviews,
    practiceHistory: {
      attemptCount: list(question?.practiceAttempts).length,
      reviewCount: list(question?.practiceReviews).length,
      returnedAttemptCount: practiceAttempts.length,
      returnedReviewCount: practiceReviews.length,
      filter: practiceRecordLimit
        ? practiceSessionId
          ? `practiceSessionId:${practiceSessionId};latest:${practiceRecordLimit}`
          : `latest:${practiceRecordLimit}`
        : "counts-only",
    },
  };
}

function interviewSetSummary(set) {
  return {
    id: text(set?.id),
    title: text(set?.title),
    mode: text(set?.mode),
    difficulty: text(set?.difficulty),
    jobId: text(set?.jobId),
    jobIds: list(set?.jobIds),
    questionCount: list(set?.questions).length,
    createdAt: text(set?.createdAt),
    updatedAt: text(set?.updatedAt),
  };
}

function interviewSetDetail(set) {
  return {
    ...interviewSetSummary(set),
    sourceMode: text(set?.sourceMode),
    questions: list(set?.questions).map((question) => ({
      id: text(question?.id),
      bankQuestionId: text(question?.bankQuestionId || question?.id),
      question: text(question?.question),
      category: text(question?.category),
      type: text(question?.type),
      difficulty: text(question?.difficulty),
    })),
  };
}

function mockSessionSummary(session) {
  return {
    id: text(session?.id),
    title: text(session?.title),
    status: text(session?.status),
    interviewSetId: text(session?.interviewSetId),
    jobId: text(session?.jobId || session?.targetJobId),
    questionCount: list(session?.questionIds).length,
    answeredCount: list(session?.answeredQuestionIds).length,
    reviewedCount: list(session?.reviewedQuestionIds).length,
    startedAt: text(session?.startedAt),
    completedAt: text(session?.completedAt),
  };
}

function leadSummary(lead) {
  return {
    id: text(lead?.id),
    company: text(lead?.company),
    title: text(lead?.title),
    source: text(lead?.source),
    status: text(lead?.status),
    missingFields: list(lead?.missingFields),
    updatedAt: text(lead?.updatedAt),
  };
}

function intakeSummary(item) {
  return {
    id: text(item?.id),
    originalName: text(item?.originalName),
    sourcePath: text(item?.sourcePath),
    sourceKind: text(item?.sourceKind),
    status: text(item?.status),
    jobIds: list(item?.jobIds),
    updatedAt: text(item?.updatedAt),
  };
}

function baseEnvelope(input, scope) {
  return {
    scope,
    project: input.project,
    sessionId: input.sessionId || null,
    projectStatePath: input.projectStatePath,
    activeTraceId: input.activeTraceId || null,
    selected: {
      jobId: input.selectedJobId || "",
      baseResumeId: input.selectedBaseResumeId || "",
      interviewSetId: input.selectedInterviewSetId || "",
    },
  };
}

function policies(input) {
  return {
    evidencePolicy: input.evidencePolicy,
    collectionPolicy: input.collectionPolicy,
    applicationPolicy: input.applicationPolicy,
  };
}

function exact(items, id, label, getId = (item) => text(item?.id)) {
  const item = items.find((candidate) => getId(candidate) === id);
  if (!item) throw new Error(`未找到${label}：${id}`);
  return item;
}

function setJobIds(set, session) {
  return unique([
    text(set?.jobId),
    ...list(set?.jobIds).map(text),
    text(session?.jobId || session?.targetJobId),
  ]);
}

export function jobSearchContextJsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
}

export function assertJobSearchContextSize(value) {
  const bytes = jobSearchContextJsonBytes(value);
  if (bytes > JOB_SEARCH_CONTEXT_MAX_BYTES) {
    throw new Error(
      `定向上下文仍有 ${bytes} bytes，超过 ${JOB_SEARCH_CONTEXT_MAX_BYTES} bytes 预算；请缩小 scope、ID 或分页范围`,
    );
  }
  return value;
}

function assertInterviewPracticeContextSize(value) {
  const bytes = jobSearchContextJsonBytes(value);
  if (bytes > INTERVIEW_PRACTICE_CONTEXT_MAX_BYTES) {
    throw new Error(
      `单题练习上下文仍有 ${bytes} bytes，超过 ${INTERVIEW_PRACTICE_CONTEXT_MAX_BYTES} bytes 预算；请减少题目 Source 或候选人证据长度`,
    );
  }
  return value;
}

function assertInterviewContextSize(value) {
  const bytes = jobSearchContextJsonBytes(value);
  if (bytes > INTERVIEW_CONTEXT_MAX_BYTES) {
    throw new Error(
      `整场面试当前页仍有 ${bytes} bytes，超过 ${INTERVIEW_CONTEXT_MAX_BYTES} bytes 预算；请使用 cursor 分页或用 bank_question_id 读取单题`,
    );
  }
  return value;
}

export function buildJobSearchContext(input, query = {}) {
  const scope = text(query.scope) || "summary";
  if (!JOB_SEARCH_CONTEXT_SCOPES.includes(scope)) {
    throw new Error(`不支持的求职上下文 scope：${scope}`);
  }
  const cursor = Number.isInteger(query.cursor) ? Math.max(0, query.cursor) : 0;
  const limit = Number.isInteger(query.limit) ? Math.min(50, Math.max(1, query.limit)) : 25;
  const jobs = list(input.jobs);
  const resumes = list(input.resumes);
  const questionBank = list(input.questionBank);
  const interviewSets = list(input.interviewSets);
  const mockSessions = list(input.mockSessions);
  const envelope = baseEnvelope(input, scope);
  let result;

  switch (scope) {
    case "candidate":
      result = {
        ...envelope,
        profile: input.profile,
        repositories: list(input.repositories),
        workHistory: list(input.workHistory),
        resumeIndex: page(resumes, cursor, limit, resumeSummary),
        ...policies(input),
      };
      break;
    case "jobs":
      result = {
        ...envelope,
        jobs: page(jobs, cursor, limit, jobSummary),
        ...policies(input),
      };
      break;
    case "job": {
      const jobId = text(query.jobId || input.selectedJobId);
      if (!jobId) throw new Error("scope=job 需要 job_id，或先在面板选择一个岗位");
      const job = exact(jobs, jobId, "岗位");
      result = {
        ...envelope,
        job,
        research: list(input.jobResearch).filter((item) => text(item?.jobId) === jobId),
        resumeIndex: resumes.filter((item) => text(item?.jobId) === jobId).map(resumeSummary),
        interviewSetIndex: interviewSets
          .filter((set) => setJobIds(set).includes(jobId))
          .map(interviewSetSummary),
        preparationPlans: list(input.preparationPlans).filter(
          (item) => text(item?.jobId) === jobId,
        ),
        interviewDebriefs: list(input.interviewDebriefs).filter(
          (item) => text(item?.jobId) === jobId,
        ),
        ...policies(input),
      };
      break;
    }
    case "resumes":
      result = {
        ...envelope,
        resumes: page(resumes, cursor, limit, resumeSummary),
        ...policies(input),
      };
      break;
    case "resume": {
      const resumeId = text(query.resumeId || input.selectedBaseResumeId);
      if (!resumeId) throw new Error("scope=resume 需要 resume_id，或先在面板选择一份基础简历");
      const resume = exact(resumes, resumeId, "简历", recordId);
      const baseResume = text(resume?.baseResumeId)
        ? resumes.find((item) => recordId(item) === text(resume.baseResumeId)) || null
        : null;
      const job = text(resume?.jobId)
        ? jobs.find((item) => text(item?.id) === text(resume.jobId)) || null
        : null;
      result = {
        ...envelope,
        resume,
        baseResume,
        job,
        ...policies(input),
      };
      break;
    }
    case "questions": {
      const filtered = questionBank.filter((question) =>
        interviewQuestionIndexMatches(question, query),
      );
      result = {
        ...envelope,
        questions: page(filtered, cursor, limit, interviewQuestionSummary),
        filters: {
          status: text(query.status) || "active",
          search: text(query.search),
        },
        ...policies(input),
      };
      break;
    }
    case "interviews":
      result = {
        ...envelope,
        questionBank: page(questionBank, cursor, limit, interviewQuestionSummary),
        interviewSets: page(interviewSets, cursor, limit, interviewSetSummary),
        mockSessions: page(mockSessions, cursor, limit, mockSessionSummary),
        ...policies(input),
      };
      break;
    case "interview": {
      const requestedSessionId = text(query.mockSessionId);
      const session = requestedSessionId
        ? exact(mockSessions, requestedSessionId, "模拟面试场次")
        : null;
      const interviewSetId = text(
        query.interviewSetId || session?.interviewSetId || input.selectedInterviewSetId,
      );
      const requestedQuestionId = text(query.bankQuestionId);
      if (!interviewSetId && !requestedQuestionId) {
        throw new Error(
          "scope=interview 需要 interview_set_id、bank_question_id 或 mock_session_id",
        );
      }
      const interviewSet = interviewSetId ? exact(interviewSets, interviewSetId, "面试题单") : null;
      const referencedQuestionIds = unique(
        interviewSet
          ? list(interviewSet.questions).map((item) => text(item?.bankQuestionId || item?.id))
          : [requestedQuestionId],
      );
      if (
        interviewSet &&
        requestedQuestionId &&
        !referencedQuestionIds.includes(requestedQuestionId)
      ) {
        throw new Error(`面试题 ${requestedQuestionId} 不属于题单 ${interviewSetId}`);
      }
      const interviewPageLimit = requestedQuestionId ? 1 : Math.min(limit, 5);
      const selectedQuestionIds = requestedQuestionId
        ? [requestedQuestionId]
        : referencedQuestionIds.slice(cursor, cursor + interviewPageLimit);
      const practiceRecordLimit = requestedQuestionId || requestedSessionId ? 1 : 0;
      const questions = selectedQuestionIds.map((id) =>
        interviewQuestionDetail(
          exact(questionBank, id, "长期题目"),
          requestedSessionId,
          practiceRecordLimit,
        ),
      );
      const jobIds = interviewSet
        ? setJobIds(interviewSet, session)
        : unique([text(session?.jobId || session?.targetJobId), text(input.selectedJobId)]);
      result = {
        ...envelope,
        interviewSet: interviewSet ? interviewSetDetail(interviewSet) : null,
        questions,
        questionPage: {
          total: referencedQuestionIds.length,
          cursor: requestedQuestionId ? 0 : cursor,
          limit: interviewPageLimit,
          nextCursor:
            !requestedQuestionId && cursor + questions.length < referencedQuestionIds.length
              ? cursor + questions.length
              : null,
        },
        mockSession: session,
        jobs: jobs.filter((job) => jobIds.includes(text(job?.id))).map(jobSummary),
        candidateEvidence: compactCandidateEvidence(
          input,
          questions.flatMap((question) => list(question?.sourceRefs)),
        ),
        research: list(input.jobResearch)
          .filter((item) => jobIds.includes(text(item?.jobId)))
          .map(interviewResearchSummary),
        preparationPlans: list(input.preparationPlans).filter((item) =>
          jobIds.includes(text(item?.jobId)),
        ).slice(-3).map(preparationPlanSummary),
        ...policies(input),
      };
      return assertInterviewContextSize(result);
    }
    case "practice": {
      const requestedQuestionId = text(query.bankQuestionId);
      if (!requestedQuestionId) throw new Error("scope=practice 需要 bank_question_id");
      const question = exact(questionBank, requestedQuestionId, "长期题目");
      const requestedSetId = text(query.interviewSetId);
      const interviewSet = requestedSetId
        ? exact(interviewSets, requestedSetId, "面试题单")
        : interviewSets.find((set) =>
            list(set?.questions).some(
              (item) => text(item?.bankQuestionId || item?.id) === requestedQuestionId,
            ),
          ) || null;
      if (
        interviewSet &&
        !list(interviewSet.questions).some(
          (item) => text(item?.bankQuestionId || item?.id) === requestedQuestionId,
        )
      ) {
        throw new Error(`面试题 ${requestedQuestionId} 不属于题单 ${requestedSetId}`);
      }
      const requestedSessionId = text(query.mockSessionId);
      const session = requestedSessionId
        ? exact(mockSessions, requestedSessionId, "模拟面试场次")
        : null;
      if (session && !list(session.questionIds).map(text).includes(requestedQuestionId)) {
        throw new Error(`面试题 ${requestedQuestionId} 不属于模拟面试 ${requestedSessionId}`);
      }
      const requestedAttemptId = text(query.practiceAttemptId);
      const questionAttempts = list(question.practiceAttempts);
      const practiceAttempt = requestedAttemptId
        ? exact(questionAttempts, requestedAttemptId, "已保存回答")
        : recentPracticeRecords(questionAttempts, requestedSessionId, 1)[0] || null;
      if (
        practiceAttempt &&
        requestedSessionId &&
        text(practiceAttempt.practiceSessionId) !== requestedSessionId
      ) {
        throw new Error(
          `已保存回答 ${text(practiceAttempt.id)} 不属于模拟面试 ${requestedSessionId}`,
        );
      }
      const reviewsForAttempt = list(question.practiceReviews).filter((review) => {
        const reviewAttemptId = text(review?.practiceAttemptId);
        if (practiceAttempt?.id && reviewAttemptId) return reviewAttemptId === practiceAttempt.id;
        if (requestedSessionId) return text(review?.practiceSessionId) === requestedSessionId;
        return true;
      });
      const linkedJobIds = unique([
        ...list(question.jobIds).map(text),
        ...setJobIds(interviewSet, session),
        text(input.selectedJobId),
      ]);
      const sourceRefs = list(question.sourceRefs);
      result = {
        ...envelope,
        question: practiceQuestionDetail(question),
        practiceAttempt,
        recentReviews: recentPracticeRecords(reviewsForAttempt, requestedSessionId, 1),
        interviewSet: interviewSet ? interviewSetDetail(interviewSet) : null,
        mockSession: session ? mockSessionSummary(session) : null,
        jobs: jobs.filter((job) => linkedJobIds.includes(text(job?.id))).map(jobSummary),
        candidateEvidence: compactCandidateEvidence(input, sourceRefs),
        ...policies(input),
      };
      return assertInterviewPracticeContextSize(result);
    }
    case "discovery":
      result = {
        ...envelope,
        discoveryPreferences: input.discoveryPreferences,
        channelVerifications: list(input.channelVerifications),
        providerCatalog: list(input.providerCatalog),
        recentWorkflowRuns: list(input.workflowRuns).slice(-10),
        jobLeadIndex: page(list(input.jobLeads), cursor, limit, leadSummary),
        ...policies(input),
      };
      break;
    case "intake":
      result = {
        ...envelope,
        jdInboxPath: input.jdInboxPath,
        jdIntakeItems: page(list(input.jdIntakeItems), cursor, limit, intakeSummary),
        ...policies(input),
      };
      break;
    default:
      result = {
        ...envelope,
        counts: {
          jobs: jobs.length,
          jobLeads: list(input.jobLeads).length,
          jdIntakeItems: list(input.jdIntakeItems).length,
          repositories: list(input.repositories).length,
          workHistory: list(input.workHistory).length,
          resumes: resumes.length,
          interviewQuestions: questionBank.length,
          interviewSets: interviewSets.length,
          mockSessions: mockSessions.length,
          preparationPlans: list(input.preparationPlans).length,
          interviewDebriefs: list(input.interviewDebriefs).length,
        },
        selectedJob: jobs.find((job) => text(job?.id) === input.selectedJobId)
          ? jobSummary(jobs.find((job) => text(job?.id) === input.selectedJobId))
          : null,
        selectedBaseResume: resumes.find(
          (resume) => recordId(resume) === input.selectedBaseResumeId,
        )
          ? resumeSummary(resumes.find((resume) => recordId(resume) === input.selectedBaseResumeId))
          : null,
        selectedInterviewSet: interviewSets.find(
          (set) => text(set?.id) === input.selectedInterviewSetId,
        )
          ? interviewSetSummary(
              interviewSets.find((set) => text(set?.id) === input.selectedInterviewSetId),
            )
          : null,
        workflowSelection: input.workflowSelection,
        availableScopes: JOB_SEARCH_CONTEXT_SCOPES,
        usage:
          "先读 summary，再用 scope + 精确 ID 读取所需对象；列表使用 cursor/limit 分页。不要请求全量快照。",
        ...policies(input),
      };
      break;
  }

  return assertJobSearchContextSize(result);
}
