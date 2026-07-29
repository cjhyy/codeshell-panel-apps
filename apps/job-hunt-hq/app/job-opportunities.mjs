export const JD_COMPLETENESS_LABELS = {
  full: "完整 JD",
  partial: "部分 JD",
  listing_only: "列表信息",
};

const JD_COMPLETENESS_RANK = {
  listing_only: 0,
  partial: 1,
  full: 2,
};

export function normalizeJdCompleteness(value, description = "", existingRecord = false) {
  const normalized = String(value || "").trim();
  if (normalized in JD_COMPLETENESS_RANK) return normalized;
  if (!description) return "listing_only";
  return existingRecord ? "full" : "partial";
}

export function upsertJobOpportunities(
  existingJobs,
  incomingJobs,
  { dedupeKey, metadataKey },
) {
  const inserted = [];
  let updated = 0;
  let unchanged = 0;

  for (const job of incomingJobs) {
    const current = existingJobs.find(
      (candidate) =>
        dedupeKey(candidate) === dedupeKey(job) ||
        metadataKey(candidate) === metadataKey(job),
    );
    if (!current) {
      inserted.push(job);
      continue;
    }

    const currentCompleteness = normalizeJdCompleteness(
      current.jdCompleteness,
      current.description,
      true,
    );
    const isStronger =
      JD_COMPLETENESS_RANK[job.jdCompleteness] >=
      JD_COMPLETENESS_RANK[currentCompleteness];
    const next = {
      ...current,
      company: job.company || current.company,
      title: job.title || current.title,
      location: job.location || current.location,
      salary: job.salary || current.salary,
      source: job.source || current.source,
      sourceId: job.sourceId || current.sourceId,
      url: job.url || current.url,
      publishedAt: job.publishedAt || current.publishedAt,
      employmentType: job.employmentType || current.employmentType,
      description:
        isStronger && job.description ? job.description : current.description || job.description,
      jdCompleteness: isStronger ? job.jdCompleteness : currentCompleteness,
      verificationNotes: job.verificationNotes || current.verificationNotes || "",
      fetchedAt: job.fetchedAt || current.fetchedAt || "",
      match: Number.isInteger(job.match) ? job.match : current.match,
      updatedAt: job.updatedAt,
      sample: false,
    };
    if (JSON.stringify(next) === JSON.stringify(current)) {
      unchanged += 1;
      continue;
    }
    Object.assign(current, next);
    updated += 1;
  }

  return {
    jobs: [...inserted, ...existingJobs],
    inserted,
    updated,
    unchanged,
  };
}
