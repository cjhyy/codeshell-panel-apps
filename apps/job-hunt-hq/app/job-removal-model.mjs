function recordId(record = {}) {
  return String(record.versionId || record.id || "").trim();
}

function linkedToJob(record, jobId) {
  return String(record?.jobId || "") === jobId;
}

export function jobRemovalPreview(state = {}, jobId = "") {
  const id = String(jobId || "").trim();
  const job = Array.isArray(state.jobs)
    ? state.jobs.find((item) => String(item?.id || "") === id)
    : null;
  if (!job) return null;
  const counts = {
    research: (state.jobResearch || []).filter((item) => linkedToJob(item, id)).length,
    resumes:
      (linkedToJob(state.resume, id) ? 1 : 0) +
      (state.versions || []).filter((item) => linkedToJob(item, id)).length,
    interviewSets: (state.interviewSets || []).filter((item) => linkedToJob(item, id)).length,
    preparationPlans: (state.preparationPlans || []).filter((item) => linkedToJob(item, id)).length,
    interviewDebriefs: (state.interviewDebriefs || []).filter((item) => linkedToJob(item, id)).length,
  };
  return {
    job,
    counts,
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

  const interviewSets = (state.interviewSets || []).filter((item) => !linkedToJob(item, id));
  const selectedInterviewSetId = interviewSets.some(
    (item) => item.id === state.selectedInterviewSetId,
  )
    ? state.selectedInterviewSetId
    : interviewSets[0]?.id || "";

  return {
    next: {
      ...state,
      jobs,
      selectedJobId:
        state.selectedJobId === id ? jobs[0]?.id || "" : state.selectedJobId,
      workflowJobIds: (state.workflowJobIds || []).filter((item) => item !== id),
      jobResearch: (state.jobResearch || []).filter((item) => !linkedToJob(item, id)),
      resume,
      selectedBaseResumeId,
      versions,
      interviewSets,
      selectedInterviewSetId,
      preparationPlans: (state.preparationPlans || []).filter(
        (item) => !linkedToJob(item, id),
      ),
      interviewDebriefs: (state.interviewDebriefs || []).filter(
        (item) => !linkedToJob(item, id),
      ),
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
