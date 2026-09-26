export const PANEL_LOCAL_STORAGE_TARGET_BYTES = 220 * 1024;

const LOCAL_FIELDS = [
  "selectedJobId",
  "selectedInterviewSetId",
  "selectedBaseResumeId",
  "workflowJobIds",
  "workflowTaskIds",
  "activeView",
  "statusFilter",
  "jobFilter",
  "jobSourceFilter",
  "interviewCategoryFilter",
  "interviewWorkspaceMode",
  "resumeWorkspaceMode",
  "dataWorkspaceMode",
  "interviewBankSearch",
  "interviewBankStatusFilter",
  "interviewBankTypeFilter",
  "sessionTraceFilter",
];

function boundedText(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function compactValue(value, depth = 0) {
  if (depth > 3) return null;
  if (typeof value === "string") return boundedText(value, 1000);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => compactValue(item, depth + 1));
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, item]) => [boundedText(key, 80), compactValue(item, depth + 1)]),
  );
}

function compactTrace(activity) {
  const target = activity?.target && typeof activity.target === "object" ? activity.target : {};
  const outcome =
    activity?.outcome && typeof activity.outcome === "object" ? activity.outcome : null;
  return {
    id: boundedText(activity?.id, 100),
    target: {
      kind: boundedText(target.kind, 40),
      title: boundedText(target.title, 500),
      detail: boundedText(target.detail, 1000),
      payload: compactValue(target.payload || {}),
    },
    instruction: boundedText(activity?.instruction, 2000),
    requestPrompt: boundedText(activity?.requestPrompt, 12000),
    parentTraceId: boundedText(activity?.parentTraceId, 100),
    externalTraceId: boundedText(activity?.externalTraceId, 100),
    workspace: boundedText(activity?.workspace, 2000),
    status: boundedText(activity?.status, 20),
    outcome: outcome
      ? {
          status: boundedText(outcome.status, 20),
          summary: boundedText(outcome.summary, 2000),
          outputRefs: Array.isArray(outcome.outputRefs)
            ? outcome.outputRefs.slice(0, 12).map((item) => boundedText(item, 500))
            : [],
          error: boundedText(outcome.error, 2000),
          completedAt: boundedText(outcome.completedAt, 80),
        }
      : null,
    feedback: boundedText(activity?.feedback, 20),
    artifacts: Array.isArray(activity?.artifacts)
      ? activity.artifacts.slice(0, 12).map((artifact) => ({
          kind: boundedText(artifact?.kind, 40),
          id: boundedText(artifact?.id, 120),
          label: boundedText(artifact?.label, 160),
        }))
      : [],
    events: Array.isArray(activity?.events)
      ? activity.events.slice(-40).map((event) => ({
          id: boundedText(event?.id, 100),
          kind: boundedText(event?.kind, 20),
          label: boundedText(event?.label, 160),
          detail: boundedText(event?.detail, 1000),
          at: boundedText(event?.at, 80),
        }))
      : [],
    createdAt: boundedText(activity?.createdAt, 80),
    startedAt: boundedText(activity?.startedAt, 80),
    completedAt: boundedText(activity?.completedAt, 80),
    updatedAt: boundedText(activity?.updatedAt, 80),
  };
}

function compactInterviewDraft(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return {
      questionId: "",
      practiceSessionId: "",
      answer: "",
      inputMode: "typed",
      updatedAt: "",
    };
  }
  return {
    questionId: boundedText(draft.questionId, 100),
    practiceSessionId: boundedText(draft.practiceSessionId, 100),
    answer: String(draft.answer || "").slice(0, 6000),
    inputMode: ["typed", "voice", "mixed"].includes(draft.inputMode)
      ? draft.inputMode
      : "typed",
    updatedAt: boundedText(draft.updatedAt, 80),
  };
}

function compactResumeDraft(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return {
      resumeVersionId: "",
      parentVersionId: "",
      markdown: "",
      updatedAt: "",
    };
  }
  return {
    resumeVersionId: boundedText(draft.resumeVersionId, 100),
    parentVersionId: boundedText(draft.parentVersionId, 100),
    markdown: String(draft.markdown || "").slice(0, 50_000),
    ...(draft.textOnly === true ? { textOnly: true } : {}),
    updatedAt: boundedText(draft.updatedAt, 80),
  };
}

export function encodedJsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function compactPanelLocalState(state, maxBytes = PANEL_LOCAL_STORAGE_TARGET_BYTES) {
  const source = state && typeof state === "object" ? state : {};
  const payload = { localStateVersion: 2 };
  for (const field of LOCAL_FIELDS) {
    if (source[field] !== undefined) payload[field] = compactValue(source[field]);
  }
  payload.sessionActivity = Array.isArray(source.sessionActivity)
    ? source.sessionActivity.slice(0, 24).map(compactTrace)
    : [];
  payload.interviewDraft = compactInterviewDraft(source.interviewDraft);
  payload.resumeDraft = compactResumeDraft(source.resumeDraft);

  if (encodedJsonBytes(payload) <= maxBytes) return payload;
  payload.sessionActivity = payload.sessionActivity.map((activity) => ({
    ...activity,
    requestPrompt: activity.requestPrompt.slice(0, 4000),
    events: activity.events.slice(-16).map((event) => ({
      ...event,
      detail: event.detail.slice(0, 300),
    })),
  }));
  while (payload.sessionActivity.length > 8 && encodedJsonBytes(payload) > maxBytes) {
    payload.sessionActivity.pop();
  }
  if (encodedJsonBytes(payload) <= maxBytes) return payload;

  payload.sessionActivity = payload.sessionActivity.map((activity, index) => ({
    ...activity,
    requestPrompt: index < 3 ? activity.requestPrompt.slice(0, 2000) : "",
    events: activity.events.slice(-8),
  }));
  while (payload.sessionActivity.length && encodedJsonBytes(payload) > maxBytes) {
    payload.sessionActivity.pop();
  }
  return payload;
}
