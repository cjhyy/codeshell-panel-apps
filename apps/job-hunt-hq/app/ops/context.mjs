import { readCareerLibraryVersion } from "../career-library-version-store.mjs";
import { buildJobSearchContext } from "../job-search-context-model.mjs";
import { normalizeInterviewLibrary } from "../interview-bank-model.mjs";
import { resolveChannelVerificationForSession } from "../discovery-model.mjs";
import { JD_INBOX_PATH } from "../jd-intake-model.mjs";
import { collectResumeRecords } from "../resume-model.mjs";
import { assertPlainObject, cleanText, clone } from "./common.mjs";

export const JOB_PROVIDERS = Object.freeze([
  { id: "boss", label: "BOSS 直聘", domain: "zhipin.com", url: "https://www.zhipin.com" },
  {
    id: "linkedin",
    label: "LinkedIn",
    domain: "linkedin.com/jobs",
    url: "https://www.linkedin.com/jobs",
  },
  { id: "lagou", label: "拉勾", domain: "lagou.com", url: "https://www.lagou.com" },
  { id: "liepin", label: "猎聘", domain: "liepin.com", url: "https://www.liepin.com" },
  { id: "maimai", label: "脉脉", domain: "maimai.cn", url: "https://maimai.cn" },
  { id: "51job", label: "前程无忧", domain: "51job.com", url: "https://www.51job.com" },
  { id: "zhaopin", label: "智联招聘", domain: "zhaopin.com", url: "https://www.zhaopin.com" },
  { id: "official", label: "公司官网", domain: "company career pages" },
]);

export function jobSearchContextQuery(args = {}) {
  assertPlainObject(args, "get_job_search_context");
  return {
    scope: cleanText(args.scope, 40) || "summary",
    jobId: cleanText(args.job_id, 100),
    sourceId: cleanText(args.source_id, 100),
    episodeId: cleanText(args.episode_id, 100),
    qaId: cleanText(args.qa_id, 100),
    versionId: cleanText(args.version_id, 100),
    resumeId: cleanText(args.resume_id, 100),
    interviewSetId: cleanText(args.interview_set_id, 100),
    bankQuestionId: cleanText(args.bank_question_id, 100),
    mockSessionId: cleanText(args.mock_session_id, 100),
    practiceAttemptId: cleanText(args.practice_attempt_id, 100),
    status: cleanText(args.status, 40),
    search: cleanText(args.search, 200),
    cursor: Number.isInteger(args.cursor) ? args.cursor : 0,
    limit: Number.isInteger(args.limit) ? args.limit : 25,
  };
}

export function getJobSearchContext(snapshot, args = {}, ctx = {}) {
  if (args.version_id && ["career_sources", "career_episodes", "career_qa"].includes(args.scope) && !ctx.libraryVersion) {
    const version = (snapshot.careerLibraryVersions || []).find(item => item.id === args.version_id);
    if (!version) throw new Error("未找到知识库版本");
    return readCareerLibraryVersion(version, { scope: ctx.scope, beforeOperation: ctx.beforeOperation })
      .then(({ version, snapshot: historical }) => getJobSearchContext(
        { ...snapshot, sourceMaterials: historical.sourceMaterials, careerEpisodes: historical.careerEpisodes, careerQa: historical.careerQa },
        args, { ...ctx, libraryVersion: version },
      ));
  }
  const query = jobSearchContextQuery(args);
  const source = clone(snapshot) || {};
  const profile = source.profile || {};
  const providers = ctx.providerCatalog || [
    ...JOB_PROVIDERS,
    ...(Array.isArray(source.customProviders) ? source.customProviders : []),
  ];
  const library = normalizeInterviewLibrary(source.questionBank, source.interviewSets, {
    now: cleanText(ctx.now || source.updatedAt, 80) || "1970-01-01T00:00:00.000Z",
  });
  const result = buildJobSearchContext(
    {
      project: clone(ctx.project || {}),
      sessionId: ctx.sessionId || null,
      projectStatePath: ctx.projectStatePath || "job-hunt-panel.json",
      activeTraceId: ctx.traceId || null,
      selectedJobId: source.selectedJobId,
      selectedBaseResumeId: source.selectedBaseResumeId,
      selectedInterviewSetId: source.selectedInterviewSetId,
      jobs: source.jobs || [],
      jobLeads: source.jobLeads || [],
      jdInboxPath: JD_INBOX_PATH,
      jdIntakeItems: source.jdIntakeItems || [],
      profile,
      sourceMaterials: source.sourceMaterials || [],
      careerEpisodes: source.careerEpisodes || [],
      careerQa: source.careerQa || [],
      careerLibraryVersions: source.careerLibraryVersions || [],
      libraryVersion: ctx.libraryVersion || null,
      repositories: source.repos || [],
      workHistory: source.experiences || [],
      jobResearch: source.jobResearch || [],
      workflowRuns: source.workflowRuns || [],
      resumes: collectResumeRecords(source.resume, source.versions, {
        profileTarget: profile.target,
        profileRole: profile.role,
      }),
      questionBank: library.questionBank,
      interviewSets: library.interviewSets,
      mockSessions: source.mockInterviewSessions || [],
      preparationPlans: source.preparationPlans || [],
      interviewDebriefs: source.interviewDebriefs || [],
      workflowSelection: clone(ctx.workflowSelection || { jobIds: [], taskIds: [] }),
      discoveryPreferences: source.discoveryPreferences,
      channelVerifications: clone(
        ctx.channelVerifications ||
          providers.map((provider) =>
            resolveChannelVerificationForSession(
              provider.id,
              source.channelVerifications,
              ctx.sessionId,
            ),
          ),
      ),
      providerCatalog: clone(providers),
      evidencePolicy:
        "Read panel context first. Check the current project's CODESHELL.md once and follow it when present; its absence is not a blocker. Use only verifiable project evidence; never invent facts or metrics.",
      collectionPolicy:
        "Use public pages or the connected visible browser, preserve source attribution, and never bypass access controls. Never export cookies or replay authenticated recruiting-site requests outside the browser. Listing cards and partial descriptions are leads, not formal opportunities; only a complete JD with responsibilities and requirements is counted in opportunities.",
      applicationPolicy:
        "Update application progress only from an explicit user action or user-provided recruiting event. Resume generation and mock interviews are preparation, not proof of real application stages.",
    },
    query,
  );
  return { snapshot: source, result };
}
