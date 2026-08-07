export const JD_COMPLETENESS_LABELS = {
  full: "完整 JD",
  partial: "部分 JD",
  listing_only: "列表线索",
};

export const JD_FORMAL_MIN_TEXT_LENGTH = 240;

const JD_COMPLETENESS_RANK = {
  listing_only: 0,
  partial: 1,
  full: 2,
};

const RESPONSIBILITY_PATTERN =
  /(?:岗位|工作|职位|主要)?(?:职责|责任|内容)|你将|负责|参与|主导|推动|what you(?:'|’)ll do|responsibilit|duties/iu;
const REQUIREMENT_PATTERN =
  /(?:任职|岗位|职位|基本|资格)?(?:要求|条件|资格)|我们希望|我们需要|must have|requirements?|qualifications?|who you are/iu;

function normalizedDescription(value) {
  return String(value || "")
    .replace(/\s+/gu, " ")
    .trim();
}

function jobMatch(existing, incoming, { dedupeKey, metadataKey }) {
  return existing.find(
    (candidate) =>
      dedupeKey(candidate) === dedupeKey(incoming) ||
      metadataKey(candidate) === metadataKey(incoming),
  );
}

export function normalizeJdCompleteness(value, description = "", existingRecord = false) {
  const normalized = String(value || "").trim();
  if (normalized in JD_COMPLETENESS_RANK) return normalized;
  if (!description) return "listing_only";
  return existingRecord ? "full" : "partial";
}

/**
 * A formal opportunity must contain the complete visible JD, not merely a
 * search-result card or a long marketing paragraph. Missing location, salary,
 * or URL remains useful metadata debt but does not reject a recruiter-forwarded
 * JD whose responsibilities and requirements are complete.
 */
export function assessJobOpportunity(job) {
  const description = normalizedDescription(job?.description);
  const declaredCompleteness = normalizeJdCompleteness(
    job?.jdCompleteness ?? job?.jd_completeness,
    description,
  );
  const descriptionLength = Array.from(description).length;
  const hasResponsibilities = RESPONSIBILITY_PATTERN.test(description);
  const hasRequirements = REQUIREMENT_PATTERN.test(description);
  const missingFields = [];

  if (declaredCompleteness !== "full") missingFields.push("来源尚未确认是完整 JD");
  if (descriptionLength < JD_FORMAL_MIN_TEXT_LENGTH) missingFields.push("JD 正文过短");
  if (!hasResponsibilities) missingFields.push("缺少岗位职责");
  if (!hasRequirements) missingFields.push("缺少任职要求");

  const evidenceGaps = [];
  if (!String(job?.url || "").trim()) evidenceGaps.push("缺少原始链接");
  if (!String(job?.publishedAt ?? job?.published_at ?? "").trim()) {
    evidenceGaps.push("缺少发布时间");
  }

  return {
    isFormal: missingFields.length === 0,
    declaredCompleteness,
    descriptionLength,
    hasResponsibilities,
    hasRequirements,
    missingFields,
    evidenceGaps,
  };
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
    const current = jobMatch(existingJobs, job, { dedupeKey, metadataKey });
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
      jdQuality: job.jdQuality || current.jdQuality,
      jdPath: job.jdPath || current.jdPath || "",
      missingFields: job.missingFields || current.missingFields || [],
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

/**
 * Route discovery results into two stores:
 * - jobs: formal, complete JDs eligible for triage and downstream work;
 * - leads: listing-only or partial results waiting for detail-page completion.
 *
 * A complete result promotes the matching lead without changing its stable ID.
 */
export function upsertJobDiscovery(
  existingJobs,
  existingLeads,
  incomingJobs,
  { dedupeKey, metadataKey },
) {
  const jobs = existingJobs.map((job) => ({ ...job }));
  let leads = existingLeads.map((lead) => ({ ...lead }));
  const formalIncoming = [];
  const leadIncoming = [];
  let ignoredWeaker = 0;

  for (const incoming of incomingJobs) {
    const assessment = assessJobOpportunity(incoming);
    const quality = {
      checkedAt: incoming.fetchedAt || incoming.updatedAt || "",
      descriptionLength: assessment.descriptionLength,
      hasResponsibilities: assessment.hasResponsibilities,
      hasRequirements: assessment.hasRequirements,
      evidenceGaps: assessment.evidenceGaps,
    };
    if (assessment.isFormal) {
      const matchingLead = jobMatch(leads, incoming, { dedupeKey, metadataKey });
      formalIncoming.push({
        ...incoming,
        id: matchingLead?.id || incoming.id,
        jdCompleteness: "full",
        missingFields: [],
        jdQuality: quality,
      });
      leads = leads.filter((lead) => lead !== matchingLead);
      continue;
    }

    if (jobMatch(jobs, incoming, { dedupeKey, metadataKey })) {
      ignoredWeaker += 1;
      continue;
    }
    leadIncoming.push({
      ...incoming,
      jdCompleteness:
        assessment.declaredCompleteness === "full"
          ? "partial"
          : assessment.declaredCompleteness,
      missingFields: assessment.missingFields,
      evidenceGaps: assessment.evidenceGaps,
      jdQuality: quality,
      status: "lead",
    });
  }

  const jobResult = upsertJobOpportunities(jobs, formalIncoming, {
    dedupeKey,
    metadataKey,
  });
  const leadResult = upsertJobOpportunities(leads, leadIncoming, {
    dedupeKey,
    metadataKey,
  });
  const promoted = formalIncoming.filter((incoming) =>
    existingLeads.some(
      (lead) =>
        dedupeKey(lead) === dedupeKey(incoming) ||
        metadataKey(lead) === metadataKey(incoming),
    ),
  );

  return {
    jobs: jobResult.jobs,
    leads: leadResult.jobs,
    insertedJobs: jobResult.inserted,
    updatedJobs: jobResult.updated,
    unchangedJobs: jobResult.unchanged + ignoredWeaker,
    insertedLeads: leadResult.inserted,
    updatedLeads: leadResult.updated,
    unchangedLeads: leadResult.unchanged,
    promoted,
  };
}
