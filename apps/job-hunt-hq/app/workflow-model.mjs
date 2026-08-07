export const CAREER_WORKFLOW_STEP_IDS = [
  "materials",
  "base",
  "inbox",
  "preparation",
  "followup",
];

export function resolveCareerCurrentStep({
  projectReady = false,
  hasBase = false,
  totalJobs = 0,
  inboxCount = 0,
  eligibleCount = 0,
  followupCount = 0,
} = {}) {
  if (!projectReady) return "materials";
  if (!hasBase) return "base";
  if (totalJobs < 1) return "inbox";
  if (inboxCount > 0) return "inbox";
  if (followupCount > 0) return "followup";
  if (eligibleCount > 0) return "preparation";
  return "inbox";
}

export function resolveDashboardFocusKind({
  bootstrapState = "missing",
  hasBase = false,
  inboxCount = 0,
  hasNextApplication = false,
  eligibleCount = 0,
  selectedCount = 0,
  selectedTaskCount = 0,
  missingJobTaskCount = 0,
} = {}) {
  if (bootstrapState !== "ready") return "project";
  if (!hasBase) return "foundation";
  if (inboxCount > 0) return "inbox";
  if (hasNextApplication) return "followup";
  if (eligibleCount < 1) return "discovery";
  if (selectedCount < 1 || selectedTaskCount < 1 || missingJobTaskCount > 0) return "compose";
  return "run";
}
