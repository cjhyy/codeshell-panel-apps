import { normalizeJobVerification } from "./ops/jobs.mjs";

const records = value => Array.isArray(value) ? value : [];
const esc = value => String(value ?? "未知").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]).replace(/([\\`*_[\]{}|#!])/g, "\\$1");
const cut = (value, max) => typeof value === "string" ? value.slice(0, max) : "";
const JOB_DISPLAY_CAPS = { id: 100, company: 80, title: 120, url: 1000, source: 40, fetchedAt: 80, publishedAt: 80 };
const VERIFICATION_DISPLAY_CAPS = { checkedUrl: 1000, lastCheckedAt: 80, method: 80, sourceKind: 40, evidenceExcerpt: 1000, notes: 300 };
const digestVerification = (verification, original) => ({
  verification: { state: verification.state, ...Object.fromEntries(Object.entries(VERIFICATION_DISPLAY_CAPS).map(([key, max]) => [key, cut(verification[key], max)])) },
  truncatedFields: Object.entries(VERIFICATION_DISPLAY_CAPS).filter(([key, max]) => [verification[key], original?.[key]].some(value => typeof value === "string" && value.length > max)).map(([key]) => `verification.${key}`),
});
const digestFields = item => ({ ...Object.fromEntries(Object.entries(JOB_DISPLAY_CAPS).map(([key, max]) => [key, cut(item[key], max) || (key === "id" ? "" : "未知")])), truncatedFields: Object.entries(JOB_DISPLAY_CAPS).filter(([key, max]) => typeof item[key] === "string" && item[key].length > max).map(([key]) => key) });
const digestSources = sources => records(sources).slice(0, 3).map(item => ({ kind: cut(item.kind, 40), title: cut(item.title, 120), url: cut(item.url, 500), accessedAt: cut(item.accessedAt, 80) }));
const digestChanges = changes => records(changes).slice(0, 5).map(item => ({ at: cut(item.at, 80), fields: Array.isArray(item.fields) ? item.fields.slice(0, 12).map(field => cut(field, 40)) : [], via: cut(item.via, 40) }));
const digestExclusion = item => item && typeof item === "object" ? { reasonCode: cut(item.reasonCode, 80), note: cut(item.note, 300), decidedAt: cut(item.decidedAt, 80), source: cut(item.source, 40) } : null;
const states = { verified_live: "有在招证据（Agent 提交，需复核）", unverified: "未核验", closed: "已关闭（已记录）", unreachable: "不可达", login_required: "需登录", changed_pending_review: "内容变化待复核" };

/** Literal evidence inventory, not a semantic suitability judgement. */
export function jobEvidenceComparison(job = {}, snapshot = {}, { maxEvidence = 12, maxRequirements = 20, maxQuote = 500, referenceChars = 3000 } = {}) {
  const evidence = [];
  for (const item of records(snapshot.careerEpisodes)) {
    if (item.status !== "confirmed") continue;
    for (const field of ["myRole", "actions", "decision", "reason", "tradeoffs", "results"]) {
      for (const quote of Array.isArray(item[field]) ? item[field] : [item[field]])
        if (typeof quote === "string" && quote.trim()) evidence.push({ kind: "careerEpisode", id: item.id, field, quote });
    }
  }
  for (const item of records(snapshot.careerQa))
    if (item.status === "confirmed" && typeof item.answer === "string" && item.answer.trim()) evidence.push({ kind: "careerQa", id: item.id, field: "answer", quote: item.answer });
  const visibleEvidence = evidence.slice(0, maxEvidence).map(item => ({ ...item, id: cut(item.id, 100), idTruncated: typeof item.id === "string" && item.id.length > 100, quote: item.quote.slice(0, maxQuote), quoteTruncated: item.quote.length > maxQuote }));
  let remaining = referenceChars;
  const lines = String(job.description || "").split(/\r?\n/).filter(line => line.trim());
  const requirements = lines.slice(0, maxRequirements).map(originalQuote => {
    const quote = originalQuote.slice(0, maxQuote);
    // Shared literal identifiers are navigation hints only. No synonyms, negation,
    // seniority inference or injected instructions are interpreted here.
    const terms = [...new Set(quote.match(/[A-Za-z][A-Za-z0-9+#.\-]{1,40}/g) || [])];
    const matches = visibleEvidence.flatMap(item => {
      const sharedTerms = terms.filter(term => new RegExp(`(^|[^a-zA-Z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-zA-Z0-9])`, "i").test(item.quote));
      if (!sharedTerms.length || remaining < item.quote.length) return [];
      remaining -= item.quote.length;
      return [{ ...item, sharedTerms }];
    });
    return { jd: { kind: "job", id: cut(job.id, 100), idTruncated: typeof job.id === "string" && job.id.length > 100, field: "description", quote, quoteTruncated: originalQuote.length > maxQuote }, state: matches.length ? "literal_overlap_needs_review" : "unknown", evidence: matches };
  });
  return {
    status: evidence.length ? "evidence_available" : "insufficient_profile", method: "literal-evidence-v1", score: null,
    explanation: evidence.length ? "仅列 JD 原文与已确认资料中的字面重合；并未判断满足要求。未找到不等于不具备。" : "无法个性化：没有明确已确认的候选人经历或问答；旧简历、Repo 介绍及未确认草稿均不作为本人事实。",
    requirements, evidence: visibleEvidence, omittedEvidence: Math.max(0, evidence.length - visibleEvidence.length), omittedJdLines: Math.max(0, lines.length - requirements.length),
    limits: { maxEvidence, maxRequirements, maxQuote, referenceChars, note: "原句截取为连续原文片段；字面引用达到预算后不再配对，未配对即未知，请读取完整资料复核。" },
    constraints: ["工作地点接受度", "薪资期望", "工作许可", "到岗时间"].map(kind => ({ kind, state: "unknown", candidate: null })),
    agentMatch: Number.isFinite(job.match) ? { value: job.match, label: "旧 Agent 提供，未核验；不是匹配概率" } : null,
  };
}

export function jobEvidenceMarkdown(comparison) {
  const lines = [comparison.explanation];
  if (comparison.agentMatch) lines.push(`旧 Agent 值 ${comparison.agentMatch.value}：${comparison.agentMatch.label}`);
  for (const item of comparison.requirements) {
    lines.push(`- JD [${esc(item.jd.id)} / description]：${esc(item.jd.quote)}`);
    if (!item.evidence.length) lines.push("  - 对照：未知，尚无可核对的字面证据。");
    for (const source of item.evidence) lines.push(`  - ${esc(source.kind)} [${esc(source.id)} / ${esc(source.field)}]：${esc(source.quote)}（字面重合：${esc(source.sharedTerms.join("、"))}，须人工复核）`);
  }
  if (comparison.evidence.length) {
    lines.push("已确认资料原句（尚未建立语义映射）：");
    for (const item of comparison.evidence) lines.push(`- ${esc(item.kind)} [${esc(item.id)} / ${esc(item.field)}]：${esc(item.quote)}`);
  }
  lines.push(comparison.limits.note);
  lines.push(`未知约束：${comparison.constraints.map(item => item.kind).join("、")}。`);
  if (comparison.omittedEvidence || comparison.omittedJdLines) lines.push(`已截取展示：另有 ${comparison.omittedEvidence} 条资料及 ${comparison.omittedJdLines} 行 JD，请读取完整上下文复核。`);
  return lines.join("\n");
}

export const JOB_DIGEST_BYTE_BUDGET = 256 * 1024;

export function buildJobResearchDigest(snapshot = {}, { now = new Date().toISOString(), since = "", limit = 20, format } = {}) {
  if (format !== undefined && !["json", "markdown"].includes(format)) throw new Error("不支持的摘要格式");
  if (!Number.isFinite(Date.parse(now)) || (since && !Number.isFinite(Date.parse(since))) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("摘要需要有效时间及 1–50 的 limit");
  const jobs = records(snapshot.jobs), leads = records(snapshot.jobLeads), research = records(snapshot.jobResearch);
  const rankedBase = jobs.map((job, sourceIndex) => {
    const bounded = digestVerification(normalizeJobVerification(job.verification, job), job.verification);
    const verification = bounded.verification;
    const report = research.find(item => item.jobId === job.id);
    const keys = [verification.state === "verified_live" ? "有可复核在招原文" : "尚需核对在招状态", report?.sources?.length ? "已有公司来源可复核" : "缺公司来源", "不按旧 Agent 分数排序"];
    const { id, ...display } = digestFields(job);
    display.truncatedFields.push(...bounded.truncatedFields);
    return { sourceIndex, jobId: id, ...display, verification, verificationLabel: states[verification.state], rankKeys: keys, changes: job.changeLog ? digestChanges(job.changeLog) : null, omittedChanges: Math.max(0, records(job.changeLog).length - 5), exclusion: digestExclusion(job.exclusion), research: report ? { id: cut(report.id, 100), updatedAt: cut(report.updatedAt, 80), summary: cut(report.company?.summary, 400), summaryTruncated: String(report.company?.summary || "").length > 400, sources: digestSources(report.sources), omittedSources: Math.max(0, records(report.sources).length - 3) } : null };
  }).sort((a, b) => Number(b.verification.state === "verified_live") - Number(a.verification.state === "verified_live") || Number(Boolean(b.research?.sources.length)) - Number(Boolean(a.research?.sources.length)) || String(a.jobId).localeCompare(String(b.jobId)));
  const displayed = rankedBase.slice(0, limit);
  const ranked = displayed.map(({ sourceIndex, ...item }) => ({ ...item, fit: jobEvidenceComparison(jobs[sourceIndex], snapshot, { maxEvidence: 6, maxRequirements: 6, maxQuote: 180, referenceChars: 720 }) }));
  const confirmedEvidence = jobEvidenceComparison({}, snapshot, { maxEvidence: 6, maxRequirements: 0, maxQuote: 180 }).evidence.map((item, index) => ({ evidenceId: `e${index + 1}`, ...item }));
  const evidenceId = item => confirmedEvidence.find(source => source.kind === item.kind && source.id === item.id && source.field === item.field && source.quote === item.quote)?.evidenceId;
  for (const job of ranked) {
    job.fit.evidence = job.fit.evidence.map(item => evidenceId(item));
    for (const requirement of job.fit.requirements) requirement.evidence = requirement.evidence.map(item => ({ evidenceId: evidenceId(item), sharedTerms: item.sharedTerms }));
  }
  const counts = { formal: jobs.length, leads: leads.length, companyResearch: research.length, withCompanySources: rankedBase.filter(item => item.research?.sources.length).length, verifiedLive: rankedBase.filter(item => item.verification.state === "verified_live").length, unverified: rankedBase.filter(item => item.verification.state === "unverified").length };
  const result = { format: "codeshell.job-research-digest", version: 1, generatedAt: now, window: { since: since || null, note: since ? "仅按已有时间记录显示变化；未记录的历史未知" : "当前快照概览；未推测新增数量" }, counts, limits: { sourcesPerCompany: 3, changesPerJob: 5, jobFieldChars: JOB_DISPLAY_CAPS, historyScope: "仅本次展示的岗位，未展示记录保持未知", note: "长字段为展示片段；完整资料请通过 get_job_search_context 按岗位ID读取。" }, confirmedEvidence, profile: { status: jobEvidenceComparison({}, snapshot, { maxEvidence: 1, maxRequirements: 0 }).status }, ranked, omittedJobs: Math.max(0, rankedBase.length - limit), leads: leads.slice(0, limit).map(item => ({ ...digestFields(item), missingFields: records(item.missingFields).slice(0, 20).map(field => cut(field, 80)), omittedMissingFields: Math.max(0, records(item.missingFields).length - 20) })), changes: displayed.flatMap(item => records(item.changes).filter(change => !since || Date.parse(change.at) >= Date.parse(since)).map(change => ({ jobId: item.jobId, ...change }))), excluded: displayed.filter(item => item.exclusion).map(item => ({ jobId: item.jobId, ...item.exclusion })), nextSteps: ["通过真实官网/ATS/浏览器读取岗位在招语义，保留 URL、访问时间和原文；HTTP 200 不能证明在招。", "补充并由本人确认经历/问答，再复核 JD 原句。", "公司来源不足时补充调研；岗位研究与投递独立。"], disclaimer: "CLI 仅结构化读写与报告，不自动抓取或核验网页；未投递、未联系任何人。线索不计为正式岗位。" };
  result.limits.totalByteBudget = JOB_DIGEST_BYTE_BUDGET;
  result.limits.byteBudgetScope = "UTF-8 JSON.stringify(report) plus standalone Markdown bytes";
  result.omittedLeads = Math.max(0, leads.length - result.leads.length);
  result.budgetOmittedJobs = 0;
  result.budgetOmittedLeads = 0;
  const renderMarkdown = () => {
  const md = ["# 岗位研究日报", `生成时间：${esc(now)}`, `正式岗位 ${counts.formal} · 待补全线索 ${counts.leads} · 公司调研 ${counts.companyResearch} · 有在招证据 ${counts.verifiedLive} · 未核验 ${counts.unverified}`, "\n## 资料与未知约束", result.profile.status === "insufficient_profile" ? "无法个性化：尚无明确已确认的候选人资料。" : "仅使用当前已确认的经历/问答；字面证据不代表满足岗位要求。", "工作地点接受度、薪资期望、许可及到岗时间：未知。", "\n## 建议复核顺序及依据"];
  for (const item of result.confirmedEvidence) md.push(`- [${item.evidenceId}] ${esc(item.kind)} [${esc(item.id)} / ${esc(item.field)}]：${esc(item.quote)}`);
  for (const job of result.ranked) {
    md.push(`### ${esc(job.company)} · ${esc(job.title)} [${esc(job.jobId)}]`, `来源：${esc(job.source)}；URL：${esc(job.url)}；获取：${esc(job.fetchedAt)}；发布：${esc(job.publishedAt)}`, `核验：${job.verificationLabel}；核验时间：${esc(job.verification.lastCheckedAt || "未知")}`, `核验原文：${esc(job.verification.evidenceExcerpt || "未知")}；核验 URL：${esc(job.verification.checkedUrl || "未知")}`, `复核依据：${job.rankKeys.join("；")}`, job.fit.explanation, `公司调研：${job.research ? `${esc(job.research.id)}，${esc(job.research.updatedAt)}` : "未知/未保存"}`);
    if (job.research) md.push(`已保存公司调研摘要（请复核来源）：${esc(job.research.summary || "未知")}${job.research.summaryTruncated ? "（摘要已截取，完整内容按岗位ID读取）" : ""}`);
    if (job.truncatedFields.length) md.push(`展示已截取：${job.truncatedFields.join("、")}；请在完整岗位记录中核对原文。`);
    if (job.research?.omittedSources) md.push(`另有 ${job.research.omittedSources} 条来源未展开；请按 jobId 读取完整公司报告。`);
    if (job.omittedChanges) md.push(`另有 ${job.omittedChanges} 条变化未展开。`);
    for (const source of records(job.research?.sources)) md.push(`- ${esc(source.title)}：${esc(source.url)}；访问：${esc(source.accessedAt || "未知")}`);
  }
  md.push("\n## 变化与排除", result.omittedJobs ? `另有 ${result.omittedJobs} 个岗位及其变化/排除记录未展开。` : "仅展示已有记录，不推断缺失历史。", result.changes.length ? result.changes.map(change => `- ${esc(change.jobId)}：${esc(JSON.stringify(change))}`).join("\n") : "变化记录未知；不能据此断言没有变化。", result.excluded.length ? result.excluded.map(item => `- ${esc(item.jobId)}：${esc(item.reasonCode || item.note || "原因未知")}`).join("\n") : "排除信息未知；没有自动规则筛除。", "\n## 待补全线索");
  for (const lead of result.leads) md.push(`- ${esc(lead.company)} · ${esc(lead.title)} [${esc(lead.id)}]：${esc(lead.url)}；获取 ${esc(lead.fetchedAt)}；缺少 ${esc(lead.missingFields.join("、") || "未知")}`);
  md.push("\n## 下一步", ...result.nextSteps.map(item => `- ${item}`), result.disclaimer);
  md.push(`展示省略：岗位 ${result.omittedJobs}，线索 ${result.omittedLeads}；其中总字节预算省略岗位 ${result.budgetOmittedJobs}，线索 ${result.budgetOmittedLeads}。`);
  return md.join("\n");
  };
  const bytes = value => new TextEncoder().encode(value).byteLength;
  for (;;) {
    result.markdown = renderMarkdown();
    if (bytes(JSON.stringify(result)) + bytes(result.markdown) <= JOB_DIGEST_BYTE_BUDGET) break;
    if (result.ranked.length) {
      result.ranked.pop(); result.omittedJobs++; result.budgetOmittedJobs++;
      const kept = displayed.slice(0, result.ranked.length);
      result.changes = kept.flatMap(item => records(item.changes).filter(change => !since || Date.parse(change.at) >= Date.parse(since)).map(change => ({ jobId: item.jobId, ...change })));
      result.excluded = kept.filter(item => item.exclusion).map(item => ({ jobId: item.jobId, ...item.exclusion }));
    } else if (result.leads.length) {
      result.leads.pop(); result.omittedLeads++; result.budgetOmittedLeads++;
    } else throw new Error("摘要固定内容超出字节预算");
  }
  if (format === "json") { const { markdown, ...json } = result; return json; }
  if (format === "markdown") return { format: result.format, version: result.version, counts, limits: result.limits, omittedJobs: result.omittedJobs, omittedLeads: result.omittedLeads, budgetOmittedJobs: result.budgetOmittedJobs, budgetOmittedLeads: result.budgetOmittedLeads, markdown: result.markdown };
  return result;
}
