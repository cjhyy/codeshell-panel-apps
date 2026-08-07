export const APPLICATION_STAGE_LABELS = {
  inbox: "待筛选",
  saved: "感兴趣",
  tailoring: "准备中",
  applied: "已投递",
  screening: "招聘沟通",
  interviewing: "面试中",
  offer: "Offer",
  rejected: "未通过",
  withdrawn: "已撤回",
  archived: "已归档",
};

export const APPLICATION_STAGE_IDS = Object.keys(APPLICATION_STAGE_LABELS);

const APPLICATION_STAGE_SET = new Set(APPLICATION_STAGE_IDS);
const FINAL_STAGE_SET = new Set(["rejected", "withdrawn", "archived"]);
const WORKFLOW_ELIGIBLE_STAGE_SET = new Set([
  "saved",
  "tailoring",
  "applied",
  "screening",
  "interviewing",
  "offer",
]);

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

export function normalizeApplicationStage(value) {
  const stage = text(value, 30);
  return APPLICATION_STAGE_SET.has(stage) ? stage : "inbox";
}

export function isWorkflowEligibleStage(value) {
  return WORKFLOW_ELIGIBLE_STAGE_SET.has(normalizeApplicationStage(value));
}

function normalizeHistoryItem(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const stage = normalizeApplicationStage(item.stage ?? item.status);
  return {
    id: text(item.id, 100) || `application-event-${index + 1}`,
    stage,
    previousStage: text(item.previousStage, 30),
    note: text(item.note, 2000),
    nextAction: text(item.nextAction, 500),
    nextActionAt: text(item.nextActionAt, 80),
    occurredAt: text(item.occurredAt, 80),
    source: ["user", "agent", "system"].includes(item.source) ? item.source : "user",
  };
}

export function normalizeJobApplication(job = {}) {
  const source = job && typeof job === "object" && !Array.isArray(job) ? job : {};
  const application =
    source.application && typeof source.application === "object" && !Array.isArray(source.application)
      ? source.application
      : {};
  const history = Array.isArray(application.history)
    ? application.history
        .map(normalizeHistoryItem)
        .filter(Boolean)
        .slice(0, 30)
    : [];
  const legacyUntriagedAgentJob =
    /^agent-job-/.test(text(source.id, 100)) &&
    source.status === "saved" &&
    !text(source.statusUpdatedAt, 80) &&
    history.length === 0;
  const stage = legacyUntriagedAgentJob ? "inbox" : normalizeApplicationStage(source.status);
  return {
    ...source,
    status: stage,
    statusUpdatedAt: text(source.statusUpdatedAt, 80),
    application: {
      nextAction: text(application.nextAction, 500),
      nextActionAt: text(application.nextActionAt, 80),
      history,
    },
  };
}

export function updateApplicationProgress(job, patch = {}, meta = {}) {
  const current = normalizeJobApplication(job);
  const requestedStage = text(patch.status ?? patch.stage, 30);
  const stage = requestedStage ? normalizeApplicationStage(requestedStage) : current.status;
  const nextAction = Object.hasOwn(patch, "nextAction")
    ? text(patch.nextAction, 500)
    : current.application.nextAction;
  const nextActionAt = Object.hasOwn(patch, "nextActionAt")
    ? text(patch.nextActionAt, 80)
    : current.application.nextActionAt;
  const note = text(patch.note, 2000);
  const occurredAt = text(patch.occurredAt, 80) || text(meta.now, 80) || new Date().toISOString();
  const stageChanged = stage !== current.status;
  const nextActionChanged = nextAction !== current.application.nextAction;
  const nextActionAtChanged = nextActionAt !== current.application.nextActionAt;
  const changed = stageChanged || nextActionChanged || nextActionAtChanged || Boolean(note);
  if (!changed) return { job: current, event: null, changed: false };

  const event = {
    id: text(meta.eventId, 100) || `application-event-${Date.now().toString(36)}`,
    stage,
    previousStage: current.status,
    note,
    nextAction,
    nextActionAt,
    occurredAt,
    source: ["user", "agent", "system"].includes(meta.source) ? meta.source : "user",
  };
  return {
    changed: true,
    event,
    job: {
      ...current,
      status: stage,
      statusUpdatedAt: stageChanged ? occurredAt : current.statusUpdatedAt,
      application: {
        nextAction,
        nextActionAt,
        history: [event, ...current.application.history].slice(0, 30),
      },
    },
  };
}

export function applicationStatusMatchesFilter(status, filter) {
  const stage = normalizeApplicationStage(status);
  if (!filter || filter === "all") return true;
  if (filter === "active") return isWorkflowEligibleStage(stage);
  if (filter === "interview") return stage === "screening" || stage === "interviewing";
  if (filter === "closed") return FINAL_STAGE_SET.has(stage);
  return stage === filter;
}
