import { prepareResumeDraft, prepareResumeQaAnswer } from "../resume-service.mjs";
import { runCareerCandidateOperation } from "../career-service.mjs";
import { assertPlainObject, cleanText, cleanTextList, clone, operationRuntime } from "./common.mjs";

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

export function saveCandidateContext(snapshot, args = {}, ctx = {}) {
  assertPlainObject(args, "save_candidate_context");
  if (["source", "episode", "qa", "library_version", "career_update"].some(key => Object.hasOwn(args, key))) {
    const runtime = operationRuntime(ctx);
    const input = args.library_version?.action === "save" && !args.library_version.id
      ? { ...args, library_version: { ...args.library_version, id: ctx.careerVersionId || runtime.uid("career-version") } }
      : args;
    return runCareerCandidateOperation(snapshot, input, {
      scope: ctx.scope, projectKey: ctx.projectKey || "", beforeOperation: ctx.beforeOperation,
      sessionId: ctx.sessionId || "", now: operationRuntime(ctx).now, expectedSnapshot: ctx.expectedSnapshot,
    }).then(({ state, result, changed }) => {
      if (changed) updateWorkflowProvenance(state, ctx, operationRuntime(ctx).now);
      return { snapshot: state, result, changed };
    });
  }
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
  const { now, uid } = operationRuntime(ctx);
  const { state: next, result } = prepareResumeDraft(snapshot, args, {
    now, versionId: uid("resume"), questionIdFactory: () => uid("resume-qa"),
  });
  Object.assign(next.resume, provenance(ctx));
  next.updatedAt = now;
  updateWorkflowProvenance(next, ctx, now);
  return { snapshot: next, result: { ...result, projectSaved: true } };
}

export function saveResumeQaAnswer(snapshot, args = {}, ctx = {}) {
  const { now } = operationRuntime(ctx);
  const { state: next, result } = prepareResumeQaAnswer(snapshot, args, { now });
  Object.assign(next.resume, provenance(ctx));
  next.updatedAt = now;
  updateWorkflowProvenance(next, ctx, now);
  return { snapshot: next, result: { ...result, projectSaved: true } };
}
