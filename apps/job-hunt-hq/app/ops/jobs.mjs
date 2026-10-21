import { normalizeJobApplication } from "../application-model.mjs";
import { assessJobOpportunity, normalizeJdCompleteness, upsertJobDiscovery } from "../job-opportunities.mjs";
import { JOB_PROVIDERS } from "./context.mjs";
import { assertPlainObject, cleanText, cleanTextList, clone, operationRuntime } from "./common.mjs";

export function normalizeSourceId(sourceId, sourceLabel = "", providers = JOB_PROVIDERS) {
  const catalog = [...providers, ...["recruiter", "referral", "message", "project-file", "other"].map(id => ({ id, label: id, domain: "" }))];
  const explicit = String(sourceId || "").trim().toLowerCase();
  if (catalog.some(item => item.id === explicit)) return explicit;
  const label = String(sourceLabel || "").toLowerCase();
  for (const [id, tokens] of [["recruiter", ["猎头"]], ["referral", ["朋友", "内推"]], ["message", ["聊天", "邮件"]], ["project-file", ["项目文件", "jd 文件"]]])
    if (tokens.some(token => label.includes(token))) return id;
  return catalog.find(item => label.includes(item.id) || label.includes(item.label.toLowerCase()) || (item.domain && label.includes(item.domain.split("/")[0])))?.id || "other";
}
export function normalizeJobUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|spm|track|ref|source)/i.test(key)) url.searchParams.delete(key);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch { return ""; }
}
export const jobMetadataKey = job => [String(job.sourceId || normalizeSourceId("", job.source)), job.company, job.title, job.location].map(value => String(value || "").trim().toLowerCase()).join("|");
export const jobDedupeKey = job => normalizeJobUrl(job.url) ? `url:${normalizeJobUrl(job.url)}` : jobMetadataKey(job);

export function normalizeJobVerification(value, job = {}) {
  const input = value && typeof value === "object" ? value : {};
  const allowed = ["verified_live", "unverified", "closed", "unreachable", "login_required", "changed_pending_review"];
  const checkedUrl = normalizeJobUrl(input.checkedUrl);
  const checkedAt = cleanText(input.lastCheckedAt, 80);
  const evidenceExcerpt = cleanText(input.evidenceExcerpt, 1000);
  const method = cleanText(input.method, 80);
  let state = allowed.includes(input.state) ? input.state : "unverified";
  // This is an Agent evidence receipt, never a network verification by this CLI.
  if (state === "verified_live" && (!checkedUrl || checkedUrl !== normalizeJobUrl(job.url) || !Number.isFinite(Date.parse(checkedAt)) || !evidenceExcerpt || !["official", "ats"].includes(input.sourceKind) || !["browser-visible", "ats-api", "page-read"].includes(method))) state = "unverified";
  return { state, lastCheckedAt: checkedAt, checkedUrl, method, sourceKind: cleanText(input.sourceKind, 40), evidenceExcerpt, notes: cleanText(input.notes, 2000) };
}
export function normalizeIncomingOpportunity(job, index, ctx, label = "jobs") {
  const { now, uid } = operationRuntime(ctx);
  assertPlainObject(job, `${label}[${index}]`);
  if (
    typeof job.company !== "string" ||
    !job.company.trim() ||
    typeof job.title !== "string" ||
    !job.title.trim()
  ) {
    throw new Error(`${label}[${index}] 缺少 company 或 title`);
  }
  const url = normalizeJobUrl(job.url);
  const sourceId = normalizeSourceId(job.source_id ?? job.sourceId, job.source, ctx.providerCatalog);
  const description = cleanText(job.description, 20000);
  const jdCompleteness = normalizeJdCompleteness(
    job.jd_completeness ?? job.jdCompleteness,
    description,
  );
  return normalizeJobApplication({
    id: cleanText(job.id, 100) || uid("agent-job"),
    company: job.company.trim().slice(0, 80),
    title: job.title.trim().slice(0, 120),
    location: cleanText(job.location, 80),
    salary: cleanText(job.salary, 80),
    source: cleanText(job.source, 40) || "Agent 搜索",
    sourceId,
    url,
    publishedAt: cleanText(job.published_at ?? job.publishedAt, 80),
    employmentType: cleanText(job.employment_type ?? job.employmentType, 80),
    description,
    jdCompleteness,
    verificationNotes: cleanText(job.verification_notes ?? job.verificationNotes, 2000),
    fetchedAt: cleanText(job.fetched_at ?? job.fetchedAt, 80) || now,
    ...(job.verification ? { verification: normalizeJobVerification(job.verification, { url }) } : {}),
    match: Number.isInteger(job.match) ? Math.min(100, Math.max(0, job.match)) : null,
    status: "inbox",
    createdAt: cleanText(job.created_at ?? job.createdAt, 80) || now,
    updatedAt: now,
    sample: false,
  });
}

export function formalJdMarkdown(job) {
  return [
    `# ${job.title || "岗位 JD"}`,
    "",
    `- 公司：${job.company || "待确认"}`,
    `- 地点：${job.location || "未注明"}`,
    `- 薪资：${job.salary || "未注明"}`,
    `- 来源：${job.source || "未注明"}`,
    `- 原始链接：${job.url || "无（聊天、猎头或文件来源）"}`,
    `- 发布时间：${job.publishedAt || "未注明"}`,
    `- 获取时间：${job.fetchedAt || job.updatedAt || "未注明"}`,
    "",
    "## 完整 JD",
    "",
    String(job.description || "").trim(),
    "",
    "## 核验说明",
    "",
    job.verificationNotes || "已通过完整 JD 门槛；在招状态仍须独立核验。",
    "",
  ].join("\n");
}


/** Pure routing; adapters persist immutable JD documents before committing the snapshot. */
export function prepareJobOpportunities(snapshot, args = {}, ctx = {}) {
  assertPlainObject(args, "save_job_opportunities");
  if (!Array.isArray(args.jobs) || args.jobs.length < 1 || args.jobs.length > 12) throw new Error("jobs 必须包含 1–12 个职位");
  const next = clone(snapshot);
  const incoming = args.jobs.map((job, index) => normalizeIncomingOpportunity(job, index, { ...ctx, providerCatalog: [...JOB_PROVIDERS, ...(snapshot.customProviders || [])] }));
  const routed = upsertJobDiscovery(next.jobs || [], next.jobLeads || [], incoming, { dedupeKey: jobDedupeKey, metadataKey: jobMetadataKey });
  next.jobs = routed.jobs.slice(0, 80); next.jobLeads = routed.leads.slice(0, 160);
  if (routed.insertedJobs[0]) next.selectedJobId = routed.insertedJobs[0].id;
  const find = (items, source) => items.find(item => jobDedupeKey(item) === jobDedupeKey(source) || jobMetadataKey(item) === jobMetadataKey(source));
  const formalJobs = [...new Set(incoming.filter(job => assessJobOpportunity(job).isFormal).map(job => find(next.jobs, job)).filter(Boolean))];
  return { snapshot: next, formalJobs, result: {
    inboxAdded: routed.insertedJobs.length, jobsUpdated: routed.updatedJobs,
    leadsAdded: routed.insertedLeads.length, leadsUpdated: routed.updatedLeads, promoted: routed.promoted.length,
    unchanged: routed.unchangedJobs + routed.unchangedLeads, selectedJobId: next.selectedJobId,
    totalJobs: next.jobs.length, totalLeads: next.jobLeads.length,
    savedJobs: incoming.map(job => find(next.jobs, job)).filter(Boolean).map(job => ({ id: job.id, company: job.company, title: job.title, jdPath: job.jdPath || "" })),
    savedLeads: incoming.map(job => find(next.jobLeads, job)).filter(Boolean).map(job => ({ id: job.id, company: job.company, title: job.title, missingFields: job.missingFields })),
  } };
}

export async function saveJobOpportunities(snapshot, args = {}, ctx = {}) {
  const operation = prepareJobOpportunities(snapshot, args, ctx);
  for (const job of operation.formalJobs) {
    const content = `${formalJdMarkdown(job)}\n`;
    const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
    const hash = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
    const safeId = job.id.normalize("NFKC").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100) || "job";
    job.jdPath = `career-data/jd/jobs/${safeId}-${hash}.md`;
    ctx.scope.check();
    let existing;
    try { existing = await ctx.scope.call("workspace.readText", { path: job.jdPath }); }
    catch (error) { if (error.code !== "ENOENT" && !/\bENOENT\b|no such file|file not found/i.test(String(error.message))) throw error; }
    if (existing && existing.content !== content) throw new Error("不可变 JD 文件内容冲突");
    if (!existing) {
      try { await ctx.scope.call("workspace.writeText", { path: job.jdPath, content, expectedModifiedAt: null }); }
      catch (error) {
        if (error.code !== "REVISION_CONFLICT") throw error;
        const concurrent = await ctx.scope.call("workspace.readText", { path: job.jdPath });
        if (concurrent.content !== content) throw error;
      }
    }
    ctx.scope.check();
  }
  for (const item of operation.result.savedJobs) item.jdPath = operation.snapshot.jobs.find(job => job.id === item.id).jdPath || "";
  delete operation.formalJobs;
  return operation;
}

export function saveJobResearch(snapshot, args = {}, ctx = {}) {
  assertPlainObject(args, "save_job_research");
  const { now, uid } = operationRuntime(ctx);
  const next = clone(snapshot);
    const job = next.jobs.find((item) => item.id === args.job_id);
    if (!job) throw new Error("job_id 不存在，请先保存或读取岗位");
    assertPlainObject(args.company, "company");
    assertPlainObject(args.interview_intel, "interview_intel");
    if (!cleanText(args.company.official_name, 100) || !cleanText(args.company.summary, 5000)) {
      throw new Error("company 缺少 official_name 或 summary");
    }
    if (
      !Array.isArray(args.reviews) ||
      !Array.isArray(args.risks) ||
      !Array.isArray(args.sources)
    ) {
      throw new Error("reviews、risks 和 sources 必须是数组");
    }
    const sentimentValues = ["positive", "mixed", "negative", "unknown"];
    const confidenceValues = ["high", "medium", "low"];
    const sourceKinds = ["official", "job", "review", "interview", "news", "other"];
    const questionOrigins = ["reported", "predicted"];
    const reviews = args.reviews.slice(0, 50).map((review, index) => {
      assertPlainObject(review, `reviews[${index}]`);
      if (
        !cleanText(review.source, 120) ||
        !cleanText(review.summary, 3000) ||
        !sentimentValues.includes(review.sentiment) ||
        !confidenceValues.includes(review.confidence)
      ) {
        throw new Error(`reviews[${index}] 缺少来源、摘要、情绪或可信度`);
      }
      return {
        source: cleanText(review.source, 120),
        title: cleanText(review.title, 200),
        url: cleanText(review.url, 1000),
        publishedAt: cleanText(review.published_at, 80),
        sentiment: review.sentiment,
        summary: cleanText(review.summary, 3000),
        pros: cleanTextList(review.pros, 15, 500),
        cons: cleanTextList(review.cons, 15, 500),
        confidence: review.confidence,
      };
    });
    const questions = Array.isArray(args.interview_intel.questions)
      ? args.interview_intel.questions.slice(0, 30).map((question, index) => {
          assertPlainObject(question, `interview_intel.questions[${index}]`);
          const prompt = cleanText(question.question, 1000);
          const sourceUrl = cleanText(question.source_url, 1000);
          if (
            prompt.length < 8 ||
            !questionOrigins.includes(question.origin) ||
            (question.origin === "reported" && !sourceUrl)
          ) {
            throw new Error(`interview_intel.questions[${index}] 缺少问题或有效 origin`);
          }
          return {
            question: prompt,
            category: cleanText(question.category, 100),
            origin: question.origin,
            sourceUrl,
          };
        })
      : [];
    const sources = args.sources.slice(0, 60).map((source, index) => {
      assertPlainObject(source, `sources[${index}]`);
      if (
        !sourceKinds.includes(source.kind) ||
        !cleanText(source.title, 300) ||
        !cleanText(source.url, 1000) ||
        !cleanText(source.accessed_at, 80)
      ) {
        throw new Error(`sources[${index}] 缺少类型、标题、URL 或访问时间`);
      }
      return {
        kind: source.kind,
        title: cleanText(source.title, 300),
        publisher: cleanText(source.publisher, 200),
        url: cleanText(source.url, 1000),
        publishedAt: cleanText(source.published_at, 80),
        accessedAt: cleanText(source.accessed_at, 80),
        notes: cleanText(source.notes, 1000),
      };
    });
    const existing = next.jobResearch.find((report) => report.jobId === job.id);
    const report = {
      id: existing?.id || uid("research"),
      jobId: job.id,
      updatedAt: now,
      sample: false,
      company: {
        officialName: cleanText(args.company.official_name, 100),
        website: cleanText(args.company.website, 1000),
        careersUrl: cleanText(args.company.careers_url, 1000),
        summary: cleanText(args.company.summary, 5000),
        industry: cleanText(args.company.industry, 200),
        stage: cleanText(args.company.stage, 200),
        size: cleanText(args.company.size, 200),
        locations: cleanTextList(args.company.locations, 20, 300),
        products: cleanTextList(args.company.products, 30, 500),
        techSignals: cleanTextList(args.company.tech_signals, 30, 300),
        hiringSignals: cleanTextList(args.company.hiring_signals, 30, 500),
      },
      reviews,
      interviewIntel: {
        summary: cleanText(args.interview_intel.summary, 5000),
        process: cleanTextList(args.interview_intel.process, 20, 500),
        themes: cleanTextList(args.interview_intel.themes, 30, 300),
        questions,
      },
      risks: cleanTextList(args.risks, 30, 1000),
      sources,
    };

  next.jobResearch = [report, ...next.jobResearch.filter(item => item.jobId !== job.id)].slice(0, 80);
  next.selectedJobId = job.id;
  return { snapshot: next, result: { saved: true, jobId: job.id, researchId: report.id, reviewCount: reviews.length, sourceCount: sources.length } };
}
