function text(value) {
  return String(value || "").trim();
}

export function interviewSetJobIds(set = {}) {
  const ids = Array.isArray(set.jobIds) ? set.jobIds : [];
  const unique = [...new Set(ids.map(text).filter(Boolean))];
  if (unique.length) return unique;
  const single = text(set.jobId);
  return single ? [single] : [];
}

export function interviewSetScope(set = {}) {
  if (set.sourceMode === "aggregate" || interviewSetJobIds(set).length > 1) {
    return "aggregate";
  }
  return "single";
}

export function resolveInterviewGenerationJobs({
  scope = "single",
  jobs = [],
  selectedJobId = "",
  selectedJobIds = [],
  maximum = 8,
} = {}) {
  const available = Array.isArray(jobs) ? jobs : [];
  const byId = new Map(available.map((job) => [text(job?.id), job]));
  if (scope !== "aggregate") {
    const selected = byId.get(text(selectedJobId)) || available[0] || null;
    return selected ? [selected] : [];
  }
  const requested = [...new Set((selectedJobIds || []).map(text).filter(Boolean))]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, Math.max(2, Number(maximum) || 8));
  if (requested.length >= 2) return requested;
  return available.slice(0, Math.max(2, Number(maximum) || 8));
}

export function aggregateKeywordFrequency(jobs = [], extractKeywords = () => []) {
  const counts = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const keywords = new Set(extractKeywords(job).map(text).filter(Boolean));
    for (const keyword of keywords) counts.set(keyword, (counts.get(keyword) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((left, right) => right.count - left.count || left.keyword.localeCompare(right.keyword));
}

export function prioritizeInterviewSetRotation(nextSet, existingSets = [], mockSessions = []) {
  const activeSetIds = new Set(
    (Array.isArray(mockSessions) ? mockSessions : [])
      .filter((session) => session?.status === "in_progress")
      .map((session) => text(session.interviewSetId))
      .filter(Boolean),
  );
  const seen = new Set();
  const candidates = [nextSet, ...(Array.isArray(existingSets) ? existingSets : [])].filter(
    (set) => {
      const id = text(set?.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    },
  );
  const nextId = text(nextSet?.id);
  const head = nextId ? candidates.find((set) => text(set.id) === nextId) : null;
  const rest = candidates.filter((set) => text(set.id) !== nextId);
  return [
    head,
    ...rest.filter((set) => activeSetIds.has(text(set.id))),
    ...rest.filter((set) => !activeSetIds.has(text(set.id))),
  ].filter(Boolean);
}

export function inProgressMocksOrphanedBySetRotation(
  mockSessions = [],
  existingSets = [],
  retainedSets = [],
) {
  const existingSetIds = new Set(
    (Array.isArray(existingSets) ? existingSets : []).map((set) => text(set?.id)).filter(Boolean),
  );
  const retainedSetIds = new Set(
    (Array.isArray(retainedSets) ? retainedSets : []).map((set) => text(set?.id)).filter(Boolean),
  );
  return (Array.isArray(mockSessions) ? mockSessions : [])
    .filter(
      (session) =>
        session?.status === "in_progress" &&
        existingSetIds.has(text(session.interviewSetId)) &&
        !retainedSetIds.has(text(session.interviewSetId)),
    )
    .map((session) => text(session.id))
    .filter(Boolean);
}

export function prioritizeMockSessionHistory(nextSession, existingSessions = [], maximum = 80) {
  const seen = new Set();
  const candidates = [nextSession, ...(Array.isArray(existingSessions) ? existingSessions : [])]
    .filter((session) => {
      const id = text(session?.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  const nextId = text(nextSession?.id);
  const head = nextId ? candidates.find((session) => text(session.id) === nextId) : null;
  const rest = candidates.filter((session) => text(session.id) !== nextId);
  const limit = Math.max(1, Math.min(80, Math.floor(Number(maximum) || 80)));
  return [
    head,
    ...rest.filter((session) => session.status === "in_progress"),
    ...rest.filter((session) => session.status !== "in_progress"),
  ]
    .filter(Boolean)
    .slice(0, limit);
}

export function inProgressMocksDroppedByHistoryRotation(existingSessions = [], retained = []) {
  const retainedIds = new Set(
    (Array.isArray(retained) ? retained : []).map((session) => text(session?.id)).filter(Boolean),
  );
  return (Array.isArray(existingSessions) ? existingSessions : [])
    .filter(
      (session) =>
        session?.status === "in_progress" && !retainedIds.has(text(session.id)),
    )
    .map((session) => text(session.id))
    .filter(Boolean);
}
