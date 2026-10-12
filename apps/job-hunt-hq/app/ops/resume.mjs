import {
  baseResumeRecords,
  collectResumeRecords,
  deriveResumeVariantChanges,
  mergeResumeQaQuestions,
  normalizeClaimEvidence,
  normalizeResumeCategory,
  normalizeResumeQaQuestions,
  normalizeResumeStyle,
  resumeEvidenceCoverage,
  resumeQaCounts,
  resumeRecordId,
  selectBaseResume,
  updateResumeQaAnswer,
} from "../resume-model.mjs";
import { assertPlainObject, cleanText, cleanTextList, clone, operationRuntime } from "./common.mjs";

function resumeRecords(snapshot) {
  return collectResumeRecords(snapshot.resume, snapshot.versions, {
    profileTarget: snapshot.profile?.target,
    profileRole: snapshot.profile?.role,
  });
}

function provenance(ctx) {
  return {
    ...(cleanText(ctx.source, 40) ? { source: cleanText(ctx.source, 40) } : {}),
    ...(cleanText(ctx.sessionId, 100) ? { sessionId: cleanText(ctx.sessionId, 100) } : {}),
  };
}

function updateWorkflowProvenance(snapshot, ctx, now) {
  const traceId = cleanText(ctx.traceId, 100);
  if (!traceId || !Array.isArray(snapshot.workflowRuns)) return;
  snapshot.workflowRuns = snapshot.workflowRuns.map((run) =>
    run?.traceId === traceId || run?.id === traceId
      ? { ...run, ...provenance(ctx), updatedAt: now }
      : run,
  );
}

function archiveCurrentResume(snapshot, uid) {
  const resume = snapshot.resume || {};
  if (!resume.markdown) return;
  const versionId = resume.versionId || resume.id || uid("resume");
  const version = {
    id: versionId,
    versionId,
    parentVersionId: resume.parentVersionId || "",
    revisionReason: resume.revisionReason || "",
    kind: resume.kind,
    category: resume.category,
    baseResumeId: resume.baseResumeId || "",
    jobId: resume.jobId,
    title: resume.title,
    markdown: resume.markdown,
    style: normalizeResumeStyle(resume.style),
    pdfExports: Array.isArray(resume.pdfExports) ? resume.pdfExports : [],
    claimEvidence: resume.claimEvidence || [],
    candidateQuestions: resume.candidateQuestions || [],
    variantChanges: resume.variantChanges || [],
    notes: resume.notes || [],
    updatedAt: resume.updatedAt,
    ...provenance(resume),
  };
  snapshot.versions = [
    version,
    ...(snapshot.versions || []).filter((item) => item.id !== version.id),
  ].slice(0, 30);
}

export function saveCandidateContext(snapshot, args = {}, ctx = {}) {
  assertPlainObject(args, "save_candidate_context");
  assertPlainObject(args.profile, "profile");
  if (!Array.isArray(args.repositories) || !Array.isArray(args.work_history)) {
    throw new Error("repositories 和 work_history 必须是数组");
  }
  const { now, uid } = operationRuntime(ctx);
  const next = clone(snapshot) || {};
  const previousProfile = next.profile || {};
  const publicProfile = (profile) =>
    JSON.stringify({
      name: profile.name,
      role: profile.role,
      contact: profile.contact,
      target: profile.target,
      summary: profile.summary,
    });
  next.profile = {
    name: cleanText(args.profile.name, 100) || "姓名待确认",
    role: cleanText(args.profile.role, 120) || "目标职位待确认",
    contact: cleanText(args.profile.contact, 300),
    target: cleanText(args.profile.target, 500),
    summary: cleanText(args.profile.summary, 3000),
    photoDataUrl: previousProfile.photoDataUrl || "",
    photoName: previousProfile.photoName || "",
  };
  if (publicProfile(previousProfile) !== publicProfile(next.profile)) {
    if (next.resume?.markdown) Object.assign(next.resume, { updatedAt: now, ...provenance(ctx) });
    next.versions = (next.versions || []).map((item) =>
      item.markdown ? { ...item, updatedAt: now, ...provenance(ctx) } : item,
    );
  }
  next.repos = args.repositories.slice(0, 30).map((repo, index) => {
    assertPlainObject(repo, `repositories[${index}]`);
    if (!cleanText(repo.name, 100) || !cleanText(repo.summary, 3000)) {
      throw new Error(`repositories[${index}] 缺少 name 或 summary`);
    }
    return {
      id: cleanText(repo.id, 100) || uid("repo"),
      name: cleanText(repo.name, 100),
      path: cleanText(repo.path, 1000),
      tech: cleanText(repo.tech, 500),
      summary: cleanText(repo.summary, 3000),
    };
  });
  next.experiences = args.work_history.slice(0, 30).map((experience, index) => {
    assertPlainObject(experience, `work_history[${index}]`);
    if (!cleanText(experience.company, 100) || !cleanText(experience.role, 120)) {
      throw new Error(`work_history[${index}] 缺少 company 或 role`);
    }
    return {
      id: cleanText(experience.id, 100) || uid("exp"),
      company: cleanText(experience.company, 100),
      role: cleanText(experience.role, 120),
      period: cleanText(experience.period, 100),
      achievements: cleanTextList(experience.achievements, 20, 1000),
    };
  });
  next.updatedAt = now;
  updateWorkflowProvenance(next, ctx, now);
  return {
    snapshot: next,
    result: {
      saved: true,
      projectSaved: true,
      repositories: next.repos.length,
      workHistory: next.experiences.length,
    },
  };
}

export function saveResumeDraft(snapshot, args = {}, ctx = {}) {
  assertPlainObject(args, "save_resume_draft");
  const { now, uid } = operationRuntime(ctx);
  const next = clone(snapshot) || {};
  const requestedJobId = cleanText(args.job_id, 80);
  const resumeKind =
    args.resume_kind === "base" || args.resume_kind === "variant"
      ? args.resume_kind
      : requestedJobId
        ? "variant"
        : "base";
  const job = requestedJobId ? (next.jobs || []).find((item) => item.id === requestedJobId) : null;
  if (requestedJobId && !job) throw new Error("job_id 不存在，请先读取面板上下文");
  if (resumeKind === "base" && requestedJobId) throw new Error("Base Resume 不能绑定 job_id");
  if (resumeKind === "variant" && !job) throw new Error("岗位定制版必须提供有效 job_id");
  const records = resumeRecords(next);
  const selectedBase = selectBaseResume(records, next.selectedBaseResumeId);
  const category = normalizeResumeCategory(
    args.category,
    selectedBase?.category || next.profile?.target || next.profile?.role,
  );
  const requestedBaseResumeId = cleanText(args.base_resume_id, 100);
  const base =
    resumeKind === "variant"
      ? baseResumeRecords(records).find((item) => resumeRecordId(item) === requestedBaseResumeId)
      : null;
  if (resumeKind === "variant" && !base) {
    throw new Error("请先保存 Base Resume，并传入有效 base_resume_id 后再生成岗位定制版");
  }
  if (
    typeof args.title !== "string" ||
    !args.title.trim() ||
    typeof args.markdown !== "string" ||
    args.markdown.trim().length < 80
  ) {
    throw new Error("title 和至少 80 字符的 markdown 为必填");
  }
  const markdown = args.markdown.trim().slice(0, 50000);
  const claimEvidence = normalizeClaimEvidence(args.claim_evidence);
  const incomingQuestions = normalizeResumeQaQuestions(
    Array.isArray(args.candidate_questions)
      ? args.candidate_questions.map((item) => ({
          ...item,
          id: cleanText(item?.id, 100) || uid("resume-qa"),
        }))
      : [],
  );
  const predecessor = records.find((record) =>
    resumeKind === "base"
      ? record.kind === "base" &&
        record.category.toLocaleLowerCase() === category.toLocaleLowerCase()
      : record.kind === "variant" && record.jobId === requestedJobId,
  );
  const candidateQuestions = mergeResumeQaQuestions(
    predecessor?.candidateQuestions,
    incomingQuestions,
  );
  const evidenceCoverage = resumeEvidenceCoverage(markdown, claimEvidence);
  if (!claimEvidence.length)
    throw new Error("claim_evidence 为必填；每条简历能力与成果都必须关联 Source");
  if (!evidenceCoverage.total) throw new Error("简历至少需要一条可映射的专业概述、能力或成果表述");
  if (evidenceCoverage.missing.length) {
    throw new Error(
      `以下简历表述缺少逐字匹配的 Source：${evidenceCoverage.missing.slice(0, 3).join("；")}`,
    );
  }
  if (evidenceCoverage.missingDetails.length) {
    throw new Error(
      `以下简历表述缺少重点说明、证据内容或面试追问：${evidenceCoverage.missingDetails.slice(0, 3).join("；")}`,
    );
  }
  const minimumCoreClaims = Math.min(3, evidenceCoverage.total);
  if (evidenceCoverage.core < minimumCoreClaims)
    throw new Error(`至少标记 ${minimumCoreClaims} 条 importance=core 的核心重点`);
  if (evidenceCoverage.core > 6)
    throw new Error("核心重点最多 6 条；请把其余要点标为 supporting，避免重点失焦");
  if (candidateQuestions.length < 3)
    throw new Error("candidate_questions 至少需要 3 个针对真实信息缺口的候选人自问 QA");
  if (candidateQuestions.some((question) => question.status === "answered" && !question.answer)) {
    throw new Error("状态为 answered 的 candidate_questions 必须保留实际回答");
  }
  archiveCurrentResume(next, uid);
  if (resumeKind === "variant") next.selectedJobId = requestedJobId;
  if (job) job.status = "tailoring";
  const versionId = uid("resume");
  next.resume = {
    kind: resumeKind,
    category: resumeKind === "variant" ? base.category : category,
    baseResumeId: resumeKind === "variant" ? resumeRecordId(base) : "",
    jobId: resumeKind === "variant" ? requestedJobId : "",
    versionId,
    parentVersionId: resumeRecordId(predecessor),
    revisionReason: predecessor
      ? resumeKind === "base"
        ? "Agent 更新 Base Resume"
        : "Agent 更新岗位版"
      : "",
    title: args.title.trim().slice(0, 120),
    markdown,
    style: normalizeResumeStyle(next.resume?.style),
    pdfExports: [],
    claimEvidence,
    candidateQuestions,
    variantChanges: [],
    notes: Array.isArray(args.notes)
      ? args.notes.map((note) => String(note).slice(0, 300)).slice(0, 12)
      : [],
    updatedAt: now,
    ...provenance(ctx),
  };
  if (resumeKind === "variant")
    next.resume.variantChanges = deriveResumeVariantChanges(base, next.resume, job);
  next.selectedBaseResumeId = resumeKind === "base" ? versionId : resumeRecordId(base);
  next.updatedAt = now;
  updateWorkflowProvenance(next, ctx, now);
  return {
    snapshot: next,
    result: {
      saved: true,
      resumeKind,
      category: next.resume.category,
      baseResumeId: next.resume.baseResumeId || null,
      jobId: requestedJobId || null,
      title: next.resume.title,
      updatedAt: now,
      characterCount: markdown.length,
      evidenceCoverage: `${evidenceCoverage.supported}/${evidenceCoverage.total}`,
      completePointCount: evidenceCoverage.complete,
      corePointCount: evidenceCoverage.core,
      strongEvidenceCount: evidenceCoverage.strong,
      verifiedClaimCount: evidenceCoverage.verified,
      candidateQuestionCount: candidateQuestions.length,
      openCandidateQuestionCount: resumeQaCounts(next.resume).open,
      projectSaved: true,
    },
  };
}

export function saveResumeQaAnswer(snapshot, args = {}, ctx = {}) {
  assertPlainObject(args, "save_resume_qa_answer");
  const { now } = operationRuntime(ctx);
  const next = clone(snapshot) || {};
  const resumeId = cleanText(args.resume_id, 100);
  const questionId = cleanText(args.question_id, 100);
  if (!resumeId || resumeId !== resumeRecordId(next.resume)) {
    throw new Error("resume_id 必须指向当前正在查看的简历版本");
  }
  const questions = normalizeResumeQaQuestions(next.resume.candidateQuestions);
  const question = questions.find((item) => item.id === questionId);
  if (!question) throw new Error("question_id 不属于当前简历版本");
  const status = cleanText(args.status, 40);
  const answer = cleanText(args.answer, 3000);
  const sourceRefs = cleanTextList(args.source_refs, 8, 500);
  if (!["answered", "needs_source", "skipped"].includes(status) || !answer) {
    throw new Error("status 和候选人的实际 answer 为必填");
  }
  if (status === "answered" && !sourceRefs.length) {
    throw new Error("标记 answered 时至少需要一个 Source；用户明确确认可使用 user:resume-qa:<id>");
  }
  next.resume.candidateQuestions = updateResumeQaAnswer(questions, {
    questionId: question.id,
    status,
    answer,
    sourceRefs,
    suggestedChange: args.suggested_change,
    answeredAt: now,
  }).questions;
  Object.assign(next.resume, provenance(ctx));
  next.updatedAt = now;
  updateWorkflowProvenance(next, ctx, now);
  const counts = resumeQaCounts(next.resume);
  return {
    snapshot: next,
    result: {
      saved: true,
      resumeId,
      questionId: question.id,
      status,
      answeredCount: counts.answered,
      remainingCount: counts.open + counts.needsSource,
      projectSaved: true,
    },
  };
}
