export const DEFAULT_BASE_RESUME_CATEGORY = "通用方向";
export const DEFAULT_RESUME_STYLE = Object.freeze({
  template: "editorial",
  density: "comfortable",
});
export const RESUME_TEMPLATE_IDS = ["editorial", "minimal", "technical"];
export const RESUME_DENSITY_IDS = ["comfortable", "compact"];
export const RESUME_EVIDENCE_SOURCE_KINDS = [
  "experience",
  "repository",
  "commit",
  "file",
  "user",
  "other",
];
export const RESUME_CLAIM_IMPORTANCE = ["core", "supporting"];

function boundedText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

export function normalizeResumeClaim(value) {
  return boundedText(value, 800)
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractResumeClaims(markdown) {
  const claims = [];
  const seen = new Set();
  let section = "";
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const heading = line.match(/^\s*##\s+(.+)$/);
    if (heading) {
      section = normalizeResumeClaim(heading[1]);
      continue;
    }
    const isBullet = /^\s*[-*+]\s+\S/.test(line);
    const isSummaryClaim = /^(专业概述|职业概述|个人简介|professional summary|summary|profile)$/i.test(
      section,
    ) && line.trim() && !/^\s*#/.test(line);
    const isCapabilityClaim = /^(核心能力|专业能力|能力概览|技能|技能清单|技术栈|core skills|technical skills|skills|competencies|expertise)$/i.test(
      section,
    ) && line.trim() && !/^\s*#/.test(line);
    if (!isBullet && !isSummaryClaim && !isCapabilityClaim) continue;
    const claim = normalizeResumeClaim(line);
    const key = claim.toLocaleLowerCase();
    if (!claim || seen.has(key)) continue;
    seen.add(key);
    claims.push(claim);
  }
  return claims;
}

export function normalizeEvidenceSource(source) {
  const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const kind = RESUME_EVIDENCE_SOURCE_KINDS.includes(input.kind) ? input.kind : "other";
  return {
    kind,
    label: boundedText(input.label, 160),
    locator: boundedText(input.locator, 500),
    evidence: boundedText(input.evidence || input.detail || input.summary, 800),
  };
}

export function normalizeInterviewQuestion(item) {
  const input =
    item && typeof item === "object" && !Array.isArray(item)
      ? item
      : { question: item };
  return {
    question: boundedText(input.question, 500),
    focus: boundedText(input.focus || input.why, 240),
  };
}

export function normalizeClaimEvidence(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const input = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      return {
        claim: normalizeResumeClaim(input.claim),
        status: input.status === "verified" ? "verified" : "needs_review",
        importance: RESUME_CLAIM_IMPORTANCE.includes(input.importance)
          ? input.importance
          : "supporting",
        whyItMatters: boundedText(input.whyItMatters || input.why_it_matters, 400),
        sources: Array.isArray(input.sources)
          ? input.sources.map(normalizeEvidenceSource).filter((source) => source.label && source.locator).slice(0, 8)
          : [],
        interviewQuestions: Array.isArray(input.interviewQuestions || input.interview_questions)
          ? (input.interviewQuestions || input.interview_questions)
              .map(normalizeInterviewQuestion)
              .filter((question) => question.question)
              .slice(0, 4)
          : [],
        improvement: boundedText(input.improvement || input.improvement_suggestion, 800),
      };
    })
    .filter((item) => item.claim && item.sources.length)
    .slice(0, 120);
}

export function resumeClaimStrength(evidence) {
  if (!evidence?.sources?.length) return "missing";
  if (evidence.status !== "verified") return "needs_review";
  const explainedSources = evidence.sources.filter((source) => source.evidence);
  if (!explainedSources.length) return "referenced";
  if (
    explainedSources.some((source) =>
      ["experience", "repository", "commit", "file"].includes(source.kind),
    )
  ) {
    return "strong";
  }
  return "supported";
}

export function resumeEvidenceCoverage(markdown, claimEvidence) {
  const claims = extractResumeClaims(markdown);
  const evidenceByClaim = new Map(
    normalizeClaimEvidence(claimEvidence).map((item) => [
      normalizeResumeClaim(item.claim).toLocaleLowerCase(),
      item,
    ]),
  );
  const mapped = claims.map((claim) => ({
    claim,
    evidence: evidenceByClaim.get(claim.toLocaleLowerCase()) || null,
    strength: resumeClaimStrength(evidenceByClaim.get(claim.toLocaleLowerCase()) || null),
  }));
  const supported = mapped.filter((item) => item.evidence?.sources.length).length;
  const verified = mapped.filter((item) => item.evidence?.status === "verified").length;
  const explained = mapped.filter(
    (item) =>
      item.evidence?.sources.length &&
      item.evidence.sources.every((source) => Boolean(source.evidence)),
  ).length;
  const questionsReady = mapped.filter(
    (item) => item.evidence?.interviewQuestions?.length,
  ).length;
  const prioritized = mapped.filter(
    (item) => item.evidence?.whyItMatters && item.evidence?.importance,
  ).length;
  const strong = mapped.filter((item) => item.strength === "strong").length;
  return {
    total: claims.length,
    supported,
    verified,
    explained,
    questionsReady,
    prioritized,
    strong,
    core: mapped.filter((item) => item.evidence?.importance === "core").length,
    complete: mapped.filter(
      (item) =>
        item.evidence?.sources.length &&
        item.evidence.sources.every((source) => Boolean(source.evidence)) &&
        item.evidence.whyItMatters &&
        item.evidence.interviewQuestions.length,
    ).length,
    missing: mapped.filter((item) => !item.evidence).map((item) => item.claim),
    missingDetails: mapped
      .filter(
        (item) =>
          item.evidence &&
          (!item.evidence.whyItMatters ||
            !item.evidence.interviewQuestions.length ||
            item.evidence.sources.some((source) => !source.evidence)),
      )
      .map((item) => item.claim),
    mapped,
  };
}

export function normalizeResumeKind(value, jobId = "") {
  if (value === "base" || value === "variant") return value;
  return String(jobId || "").trim() ? "variant" : "base";
}

export function normalizeResumeCategory(value, fallback = DEFAULT_BASE_RESUME_CATEGORY) {
  const category = String(value || "").trim().slice(0, 80);
  return category || String(fallback || DEFAULT_BASE_RESUME_CATEGORY).trim().slice(0, 80);
}

export function normalizeResumeStyle(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    template: RESUME_TEMPLATE_IDS.includes(input.template)
      ? input.template
      : DEFAULT_RESUME_STYLE.template,
    density: RESUME_DENSITY_IDS.includes(input.density)
      ? input.density
      : DEFAULT_RESUME_STYLE.density,
  };
}

function normalizePdfExports(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      return {
        path: boundedText(source.path, 512),
        exportedAt: boundedText(source.exportedAt, 80),
        size: Number.isSafeInteger(source.size) && source.size >= 0 ? source.size : 0,
      };
    })
    .filter((item) => item.path.toLowerCase().endsWith(".pdf"))
    .slice(0, 12);
}

export function resumeRecordId(record) {
  return String(record?.versionId || record?.id || "").trim();
}

export function normalizeResumeRecord(record, options = {}) {
  const source = record && typeof record === "object" && !Array.isArray(record) ? record : {};
  const jobId = String(source.jobId || "").trim().slice(0, 80);
  const kind = normalizeResumeKind(source.kind, jobId);
  const fallbackCategory = options.profileTarget || options.profileRole || DEFAULT_BASE_RESUME_CATEGORY;
  return {
    ...source,
    kind,
    category: normalizeResumeCategory(source.category, fallbackCategory),
    baseResumeId:
      kind === "variant" ? String(source.baseResumeId || "").trim().slice(0, 100) : "",
    jobId: kind === "variant" ? jobId : "",
    style: normalizeResumeStyle(source.style),
    pdfExports: normalizePdfExports(source.pdfExports),
    claimEvidence: normalizeClaimEvidence(source.claimEvidence),
  };
}

export function collectResumeRecords(active, versions, options = {}) {
  const records = [];
  const seen = new Set();
  for (const candidate of [active, ...(Array.isArray(versions) ? versions : [])]) {
    if (!candidate?.markdown) continue;
    const record = normalizeResumeRecord(candidate, options);
    const id = resumeRecordId(record);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    records.push(record);
  }
  return records;
}

export function baseResumeRecords(records) {
  return records
    .filter((record) => record.kind === "base")
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

export function selectBaseResume(records, preferredId = "") {
  const bases = baseResumeRecords(records);
  return bases.find((record) => resumeRecordId(record) === preferredId) || bases[0] || null;
}

export function isSupportedResumePhoto(value) {
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(String(value || ""));
}
