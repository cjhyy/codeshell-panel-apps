import { questionBankCurationGaps } from "./interview-bank-model.mjs";

function recordId(record = {}) {
  return String(record.versionId || record.id || "").trim();
}

function linkedToJob(record, jobId) {
  return (
    String(record?.jobId || "") === jobId ||
    (Array.isArray(record?.jobIds) && record.jobIds.some((id) => String(id) === jobId))
  );
}

function interviewSetAfterJobRemoval(set = {}, jobId = "") {
  if (!linkedToJob(set, jobId)) return set;
  const remainingJobIds = [
    ...new Set(
      [
        ...(Array.isArray(set.jobIds) ? set.jobIds : []),
        set.jobId,
      ]
        .map((id) => String(id || "").trim())
        .filter((id) => id && id !== jobId),
    ),
  ];
  if (!remainingJobIds.length) return null;
  const sourceMode =
    set.sourceMode === "aggregate" && remainingJobIds.length === 1
      ? "jd"
      : set.sourceMode || "jd";
  return {
    ...set,
    sourceMode,
    jobId: sourceMode === "aggregate" ? "" : remainingJobIds[0],
    jobIds: remainingJobIds,
  };
}

export function jobRemovalPreview(state = {}, jobId = "") {
  const id = String(jobId || "").trim();
  const job = Array.isArray(state.jobs)
    ? state.jobs.find((item) => String(item?.id || "") === id)
    : null;
  if (!job) return null;
  const reScopedInterviewSetIds = new Set(
    (state.interviewSets || [])
      .filter((set) => linkedToJob(set, id) && interviewSetAfterJobRemoval(set, id))
      .map((set) => set.id),
  );
  const removedInterviewSetIds = new Set(
    (state.interviewSets || [])
      .filter((set) => linkedToJob(set, id) && !interviewSetAfterJobRemoval(set, id))
      .map((set) => set.id),
  );
  const counts = {
    research: (state.jobResearch || []).filter((item) => linkedToJob(item, id)).length,
    resumes:
      (linkedToJob(state.resume, id) ? 1 : 0) +
      (state.versions || []).filter((item) => linkedToJob(item, id)).length,
    interviewSets: removedInterviewSetIds.size,
    mockInterviewSessions: (state.mockInterviewSessions || []).filter((session) =>
      removedInterviewSetIds.has(session.interviewSetId),
    ).length,
    preparationPlans: (state.preparationPlans || []).filter((item) => linkedToJob(item, id)).length,
    interviewDebriefs: (state.interviewDebriefs || []).filter((item) => linkedToJob(item, id))
      .length,
  };
  return {
    job,
    counts,
    adjustments: {
      interviewSetsReScoped: reScopedInterviewSetIds.size,
    },
    linkedArtifactCount: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

export function removeJobAndLinkedArtifacts(state = {}, jobId = "", emptyResume = {}) {
  const preview = jobRemovalPreview(state, jobId);
  if (!preview) return { next: state, removed: null };
  const id = String(jobId);
  const jobs = (state.jobs || []).filter((item) => String(item?.id || "") !== id);
  let versions = (state.versions || []).filter((item) => !linkedToJob(item, id));
  let resume = state.resume;
  let selectedBaseResumeId = state.selectedBaseResumeId || "";

  if (linkedToJob(state.resume, id)) {
    const preferredBase = versions.find(
      (item) => item.kind === "base" && recordId(item) === state.selectedBaseResumeId,
    );
    const fallbackBase = preferredBase || versions.find((item) => item.kind === "base");
    if (fallbackBase) {
      const fallbackId = recordId(fallbackBase);
      resume = { ...structuredClone(fallbackBase), versionId: fallbackId };
      selectedBaseResumeId = fallbackId;
      versions = versions.filter((item) => recordId(item) !== fallbackId);
    } else {
      resume = {
        ...structuredClone(emptyResume),
        style: structuredClone(state.resume?.style || emptyResume.style || {}),
      };
      selectedBaseResumeId = "";
    }
  }

  const interviewSets = (state.interviewSets || [])
    .map((item) => interviewSetAfterJobRemoval(item, id))
    .filter(Boolean);
  const retainedInterviewSetIds = new Set(interviewSets.map((item) => item.id));
  const removedDebriefSourceRefs = new Set(
    (state.interviewDebriefs || [])
      .filter((item) => linkedToJob(item, id))
      .map((item) => `real-interview:${item.id}`),
  );
  const interviewDebriefs = (state.interviewDebriefs || []).filter(
    (item) => !linkedToJob(item, id),
  );
  const selectedInterviewSetId = interviewSets.some(
    (item) => item.id === state.selectedInterviewSetId,
  )
    ? state.selectedInterviewSetId
    : interviewSets[0]?.id || "";

  return {
    next: {
      ...state,
      jobs,
      selectedJobId: state.selectedJobId === id ? jobs[0]?.id || "" : state.selectedJobId,
      workflowJobIds: (state.workflowJobIds || []).filter((item) => item !== id),
      jobResearch: (state.jobResearch || []).filter((item) => !linkedToJob(item, id)),
      resume,
      selectedBaseResumeId,
      versions,
      interviewSets,
      questionBank: (state.questionBank || []).map((item) => {
        const nextQuestion = {
          ...item,
          jobIds: (item.jobIds || []).filter((itemJobId) => itemJobId !== id),
          sourceSetIds: (item.sourceSetIds || []).filter((setId) =>
            retainedInterviewSetIds.has(setId),
          ),
          sourceRefs: (item.sourceRefs || []).filter(
            (sourceRef) => !removedDebriefSourceRefs.has(sourceRef),
          ),
        };
        if (
          ["ready", "mastered"].includes(nextQuestion.status) &&
          questionBankCurationGaps(nextQuestion).length
        ) {
          nextQuestion.status = "inbox";
        }
        return nextQuestion;
      }),
      mockInterviewSessions: (state.mockInterviewSessions || []).filter((item) =>
        retainedInterviewSetIds.has(item.interviewSetId),
      ),
      selectedInterviewSetId,
      preparationPlans: (state.preparationPlans || []).filter((item) => !linkedToJob(item, id)),
      interviewDebriefs,
      jdIntakeItems: (state.jdIntakeItems || []).map((item) => {
        const jobIds = (item.jobIds || []).filter((itemJobId) => itemJobId !== id);
        if (jobIds.length === (item.jobIds || []).length) return item;
        return {
          ...item,
          jobIds,
          status: item.status === "imported" && !jobIds.length ? "needs_review" : item.status,
          summary:
            item.status === "imported" && !jobIds.length
              ? "此前关联的岗位已从岗位池删除；原始 JD 来源仍保留"
              : item.summary,
        };
      }),
    },
    removed: preview,
  };
}
