const FIELDS = {
  sources: ["id", "title", "provider", "externalId", "url", "author", "occurredAt", "fetchedAt", "excerpt", "contentHash", "localRef"],
  episodes: ["id", "title", "project", "repoId", "experienceId", "background", "problem", "myRole", "actions", "alternatives", "decision", "reason", "tradeoffs", "results", "retrospective", "tags", "sourceIds"],
  qa: ["id", "episodeId", "category", "question", "answer", "draftAnswer", "sourceIds"],
};

// A project-local editing buffer, never a source of confirmed facts. Preserve
// complete text within the editor's limits rather than compacting prose.
export function normalizeCareerDraft(value) {
  if (!value || typeof value !== "object" || !FIELDS[value.kind] || !value.record || typeof value.record !== "object") return null;
  const record = {};
  for (const field of FIELDS[value.kind]) {
    const item = value.record[field];
    if (typeof item === "string") record[field] = item.slice(0, 16000);
    else if (Array.isArray(item)) record[field] = item.filter(entry => typeof entry === "string").slice(0, 40).map(entry => entry.slice(0, 1000));
  }
  record.status = "draft";
  return { kind: value.kind, id: String(value.id || "").slice(0, 100), record, dirty: value.dirty === true, updatedAt: String(value.updatedAt || "").slice(0, 80) };
}
