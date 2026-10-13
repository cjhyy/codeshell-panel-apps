import test from "node:test";
import assert from "node:assert/strict";
import { prepareResumeDraft, prepareResumeQaAnswer, RESUME_HISTORY_LIMIT } from "../../../apps/job-hunt-hq/app/resume-service.mjs";
import { upsertCareerQa, upsertCareerSource, upsertCareerEpisode } from "../../../apps/job-hunt-hq/app/career-library-model.mjs";

const first = "2026-10-13T00:00:00.000Z";
const later = "2026-10-13T01:00:00.000Z";
const claims = [
  "设计可恢复的保存流程，让每次修改都有清晰的来源，并在保存失败时保留输入。",
  "通过分阶段发布验证迁移、恢复和版本之间的关联，明确记录每次选择的理由和适用范围。",
  "实现本地日志与冲突检测，帮助用户核对真实结果，并在断网后继续整理项目资料。",
];
const markdown = "# Synthetic Candidate\n\n## 项目经验\n\n" + claims.map(claim => `- ${claim}`).join("\n");
const options = { now: first, versionId: "resume-new", questionIdFactory: (_item, index) => `question-${index + 1}` };

function args(overrides = {}) {
  return {
    resume_kind: "base", category: "工程", title: "Synthetic Resume", markdown,
    claim_evidence: claims.map(claim => ({ claim, status: "verified", importance: "core", why_it_matters: "说明本人判断与实现", sources: [{ kind: "user", label: "本人说明", locator: "user:synthetic-fixture", evidence: "已保存的合成原话" }], interview_questions: [{ question: "为什么选择这个方案？", focus: "判断和取舍" }] })),
    candidate_questions: ["为什么选择本地日志？", "本人承担哪些职责？", "后来如何验证结果？"].map(question => ({ category: "decision", priority: "high", question, why: "补充本人实际决策" })),
    notes: ["待本人复核公开表述"], ...overrides,
  };
}

function state(overrides = {}) {
  return {
    profile: { name: "Synthetic Candidate", target: "工程" }, jobs: [], versions: [],
    sourceMaterials: [], careerEpisodes: [], careerQa: [], careerLibraryVersions: [], careerLibraryMigrationVersion: 1,
    resume: { versionId: "resume-old", kind: "base", category: "工程", title: "Old", markdown, style: { template: "minimal", density: "compact" }, pdfExports: [{ path: "resume-old.pdf" }], claimEvidence: [], candidateQuestions: [], notes: ["原有备注"], updatedAt: first },
    selectedJobId: "selected-before", selectedBaseResumeId: "resume-old", activeView: "dashboard",
    resumeDraft: { resumeVersionId: "resume-manual", markdown: "本地未同步手工草稿", updatedAt: first },
    futureRootExtension: { nested: ["preserve me"] }, ...overrides,
  };
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test("base draft preparation runs without DOM or IO, archives the complete current version and preserves extensions", () => {
  const original = state();
  original.resume.futureResumeField = { note: "keep in archive" };
  const before = JSON.stringify(original);
  const input = freeze(args());
  const plan = prepareResumeDraft(freeze(original), input, options);
  assert.equal(JSON.stringify(original), before);
  assert.equal(plan.state.resume.versionId, "resume-new");
  assert.equal(plan.state.resume.parentVersionId, "resume-old");
  assert.equal(plan.state.resume.revisionReason, "Agent 更新 Base Resume");
  assert.equal(plan.state.versions[0].versionId, "resume-old");
  assert.equal(plan.state.versions[0].markdown, original.resume.markdown);
  assert.deepEqual(plan.state.versions[0].futureResumeField, { note: "keep in archive" });
  assert.deepEqual(plan.state.resume.style, original.resume.style);
  assert.deepEqual(plan.state.resume.pdfExports, []);
  assert.equal(plan.state.versions[0].pdfExports[0].path, "resume-old.pdf");
  assert.deepEqual(plan.state.futureRootExtension, original.futureRootExtension);
  assert.notEqual(plan.state.futureRootExtension, original.futureRootExtension);
  assert.deepEqual(plan.state.resumeDraft, original.resumeDraft);
  assert.equal(plan.state.activeView, "dashboard");
  assert.equal(plan.state.selectedJobId, "selected-before");
  assert.equal(plan.state.selectedBaseResumeId, "resume-new");
  assert.deepEqual(plan.state.resume.candidateQuestions.map(question => question.id), ["question-1", "question-2", "question-3"]);
  assert.ok(plan.state.resume.candidateQuestions.every(question => question.careerQaId));
  assert.equal(plan.state.careerQa.length, 3);
  assert.ok(plan.state.careerQa.every(question => question.status === "draft"));
  assert.equal(plan.result.resumeId, "resume-new");
  assert.equal(plan.result.versionId, "resume-new");
  assert.equal(plan.result.evidenceCoverage, "3/3");
  assert.equal(plan.result.verifiedClaimCount, 3);
  assert.equal(plan.result.completePointCount, 3);
  assert.equal(plan.result.openCandidateQuestionCount, 3);
  assert.equal(plan.result.projectSaved, undefined);
});

test("empty projects create their first base with injected IDs and default style", () => {
  const plan = prepareResumeDraft({}, args(), options);
  assert.deepEqual(plan.state.versions, []);
  assert.equal(plan.state.resume.parentVersionId, "");
  assert.equal(plan.state.resume.revisionReason, "");
  assert.deepEqual(plan.state.resume.style, { template: "editorial", density: "comfortable" });
  assert.equal(plan.state.sourceMaterials.length, 3);
  assert.deepEqual(prepareResumeDraft({}, args(), options), plan);
});

test("variants require a valid job and base, inherit base category and derive a reviewable difference", () => {
  const original = state({ jobs: [{ id: "job-a", status: "inbox", description: "本地恢复与可靠性工程" }, { id: "job-b", status: "applied" }] });
  const updatedClaims = [...claims];
  updatedClaims[0] = "设计可恢复的保存流程，并通过回放日志验证每次修改的恢复结果，保留完整的来源记录。";
  const incoming = args({ resume_kind: "variant", job_id: "job-a", base_resume_id: "resume-old", category: "传入分类应被 Base 覆盖", markdown: "# Synthetic Candidate\n\n## 项目经验\n\n" + updatedClaims.map(claim => `- ${claim}`).join("\n") });
  incoming.claim_evidence[0].claim = updatedClaims[0];
  const plan = prepareResumeDraft(freeze(original), freeze(incoming), options);
  assert.equal(plan.state.resume.kind, "variant");
  assert.equal(plan.state.resume.category, "工程");
  assert.equal(plan.state.resume.baseResumeId, "resume-old");
  assert.equal(plan.state.resume.jobId, "job-a");
  assert.equal(plan.state.jobs[0].status, "tailoring");
  assert.equal(plan.state.jobs[1].status, "applied");
  assert.equal(plan.state.selectedJobId, "job-a");
  assert.equal(plan.state.selectedBaseResumeId, "resume-old");
  assert.ok(plan.state.resume.variantChanges.some(change => change.status === "pending" && change.after === updatedClaims[0]));
  assert.equal(original.jobs[0].status, "inbox");
});

test("base/variant references and minimum title/markdown reject invalid combinations without changing the caller", () => {
  const original = freeze(state({ jobs: [{ id: "job-a" }] }));
  const before = JSON.stringify(original);
  const cases = [
    [args({ job_id: "missing" }), /job_id 不存在/],
    [args({ job_id: "job-a" }), /Base Resume 不能/],
    [args({ resume_kind: "variant" }), /有效 job_id/],
    [args({ resume_kind: "variant", job_id: "job-a" }), /有效 base_resume_id/],
    [args({ title: " " }), /title/], [args({ markdown: "short" }), /80 字符/],
  ];
  for (const [incoming, pattern] of cases) assert.throws(() => prepareResumeDraft(original, incoming, options), pattern);
  assert.equal(JSON.stringify(original), before);
});

test("the complete exact-claim evidence and core-priority checks remain shared business rules", () => {
  const cases = [];
  cases.push([args({ claim_evidence: [] }), /claim_evidence 为必填/]);
  const missingClaim = args(); missingClaim.claim_evidence.pop(); cases.push([missingClaim, /逐字匹配/]);
  const rewrittenClaim = args(); rewrittenClaim.claim_evidence[0].claim += "新增字词"; cases.push([rewrittenClaim, /逐字匹配/]);
  const missingDetail = args(); missingDetail.claim_evidence[0].sources[0].evidence = ""; cases.push([missingDetail, /证据内容/]);
  const missingWhy = args(); missingWhy.claim_evidence[0].why_it_matters = ""; cases.push([missingWhy, /重点说明/]);
  const missingFollowup = args(); missingFollowup.claim_evidence[0].interview_questions = []; cases.push([missingFollowup, /面试追问/]);
  const insufficientCore = args(); insufficientCore.claim_evidence[0].importance = "supporting"; cases.push([insufficientCore, /至少标记 3/]);
  const tooFewQuestions = args(); tooFewQuestions.candidate_questions.pop(); cases.push([tooFewQuestions, /至少需要 3/]);
  const emptyAnswer = args(); emptyAnswer.candidate_questions[0].status = "answered"; cases.push([emptyAnswer, /必须保留实际回答/]);
  for (const [incoming, pattern] of cases) assert.throws(() => prepareResumeDraft({}, freeze(incoming), options), pattern);
  const many = args();
  many.markdown = "## 项目经验\n\n" + Array.from({ length: 7 }, (_, index) => `- ${claims[index % 3]} 场景${index + 1}。`).join("\n");
  many.claim_evidence = Array.from({ length: 7 }, (_, index) => ({ ...many.claim_evidence[0], claim: `${claims[index % 3]} 场景${index + 1}。` }));
  assert.throws(() => prepareResumeDraft({}, many, options), /最多 6 条/);
});

test("career evidence references must exist and unconfirmed or pending facts downgrade verification", () => {
  for (const field of ["source_ids", "episode_ids", "qa_ids"]) {
    const incoming = args(); incoming.claim_evidence[0][field] = ["missing"];
    assert.throws(() => prepareResumeDraft({}, incoming, options), /不存在的记录 missing/);
  }
  const user = { actor: "user", confirm: true, now: first };
  let original = upsertCareerSource(state(), { id: "s", provider: "user", excerpt: "合成原话" }, user);
  original = upsertCareerEpisode(original, { id: "e", title: "合成经历", sourceIds: ["s"] }, user);
  original = upsertCareerQa(original, { id: "q", question: "选择原因？", answer: "本人原话", episodeId: "e", sourceIds: ["s"] }, user);
  const incoming = args();
  incoming.claim_evidence[0].source_ids = ["s"];
  incoming.claim_evidence[1].episode_ids = ["e"];
  incoming.claim_evidence[2].qa_ids = ["q"];
  assert.equal(prepareResumeDraft(original, incoming, options).result.verifiedClaimCount, 3);
  original.sourceMaterials[0].pendingRevision = { content: { excerpt: "待审原话" } };
  original.careerEpisodes[0].status = "draft";
  original.careerQa[0].status = "archived";
  const plan = prepareResumeDraft(freeze(original), incoming, options);
  assert.ok(plan.state.resume.claimEvidence.every(item => item.status === "needs_review"));
  assert.equal(plan.result.verifiedClaimCount, 0);
});

test("legacy Source locators and normalized nested aliases stay compatible without pretending to re-read originals", () => {
  const incoming = args();
  incoming.claim_evidence = incoming.claim_evidence.map(item => ({ claim: item.claim, status: item.status, importance: item.importance, whyItMatters: item.why_it_matters, sources: item.sources, interviewQuestions: item.interview_questions }));
  const plan = prepareResumeDraft({}, incoming, options);
  assert.equal(plan.result.verifiedClaimCount, 3);
  assert.equal(plan.state.resume.claimEvidence[0].sources[0].locator, "user:synthetic-fixture");
  assert.equal(plan.state.resume.claimEvidence[0].sourceIds, undefined);
});

test("saving a later version preserves previous answered QA and its reviewed career fact", () => {
  let original = prepareResumeDraft({}, args(), { ...options, versionId: "resume-first" }).state;
  const question = original.resume.candidateQuestions[0];
  original = prepareResumeQaAnswer(original, { resume_id: "resume-first", question_id: question.id, status: "answered", answer: "本人聊天中的真实原因", source_refs: ["user:fixture"] }, { now: later }).state;
  const careerQaId = original.resume.candidateQuestions[0].careerQaId;
  original = upsertCareerQa(original, { id: careerQaId, answer: "库里后来本人核对的原因" }, { actor: "user", confirm: true, now: later });
  const incoming = args(); incoming.candidate_questions[0].answer = "AI 试图回放旧答案"; incoming.candidate_questions[0].status = "answered";
  const plan = prepareResumeDraft(freeze(original), incoming, { ...options, versionId: "resume-second", now: later });
  assert.equal(plan.state.resume.candidateQuestions[0].answer, "本人聊天中的真实原因");
  assert.equal(plan.state.resume.candidateQuestions[0].status, "answered");
  assert.equal(plan.state.resume.candidateQuestions[0].careerQaId, careerQaId);
  assert.equal(plan.state.careerQa.find(item => item.id === careerQaId).answer, "库里后来本人核对的原因");
  assert.equal(plan.state.careerQa.find(item => item.id === careerQaId).pendingRevision, null);
  assert.equal(plan.state.careerQa.length, original.careerQa.length);
  assert.equal(plan.state.resume.parentVersionId, "resume-first");
});

test("every generated question reaches the career library even when the resume carry-over window is full", () => {
  const previousQuestions = Array.from({ length: 4 }, (_, index) => ({ id: `old-${index}`, question: `已回答问题${index}`, category: "context", priority: "high", why: "保留历史", status: "answered", answer: `原话${index}`, sourceRefs: ["user:fixture"] }));
  const original = state(); original.resume.candidateQuestions = previousQuestions;
  const incoming = args({ candidate_questions: Array.from({ length: 12 }, (_, index) => ({ question: `新生成的问题${index}`, category: "context", priority: "high", why: "完整沉淀" })) });
  const plan = prepareResumeDraft(original, incoming, options);
  assert.equal(plan.state.resume.candidateQuestions.length, 12);
  assert.equal(plan.state.careerQa.length, 16);
  assert.ok(plan.state.careerQa.some(item => item.question === "新生成的问题11"));
});

test("history capacity refuses a 31st archive while replacing an already archived active ID loses no history", () => {
  const original = state({ versions: Array.from({ length: RESUME_HISTORY_LIMIT }, (_, index) => ({ versionId: `history-${index}`, markdown: "# Historical", kind: "base", category: "old", retained: index })) });
  const before = JSON.stringify(original);
  assert.throws(() => prepareResumeDraft(freeze(original), args(), options), /30 个历史简历版本/);
  assert.equal(JSON.stringify(original), before);
  const existing = structuredClone(original); existing.versions[0] = structuredClone(existing.resume);
  const plan = prepareResumeDraft(existing, args(), options);
  assert.equal(plan.state.versions.length, 30);
  assert.deepEqual(plan.state.versions.slice(1), existing.versions.slice(1));
  assert.equal(plan.state.versions[0].versionId, "resume-old");
});

test("a supplied version ID cannot overwrite active or historical records, including empty historical records", () => {
  assert.throws(() => prepareResumeDraft(state(), args(), { ...options, versionId: "resume-old" }), /已存在/);
  assert.throws(() => prepareResumeDraft(state({ versions: [{ versionId: "reserved-empty" }] }), args(), { ...options, versionId: "reserved-empty" }), /已存在/);
});

test("QA answer preparation targets the active question, preserves public Markdown and never confirms the career answer", () => {
  const original = prepareResumeDraft({}, args(), options).state;
  const before = JSON.stringify(original);
  const questionId = original.resume.candidateQuestions[0].id;
  const incoming = freeze({ resume_id: "resume-new", question_id: questionId, status: "answered", answer: "我负责实现日志恢复，保留范围不确定性。", source_refs: ["user:resume-qa:synthetic"], suggested_change: "补充个人职责" });
  const plan = prepareResumeQaAnswer(freeze(original), incoming, { now: later });
  assert.equal(JSON.stringify(original), before);
  assert.equal(plan.state.resume.markdown, original.resume.markdown);
  assert.deepEqual(plan.state.versions, original.versions);
  assert.equal(plan.state.resume.candidateQuestions[0].answeredAt, later);
  assert.equal(plan.state.resume.candidateQuestions[0].suggestedChange, "补充个人职责");
  const career = plan.state.careerQa.find(item => item.id === plan.state.resume.candidateQuestions[0].careerQaId);
  assert.equal(career.answer, incoming.answer);
  assert.equal(career.status, "draft");
  assert.equal(plan.result.answeredCount, 1);
  assert.equal(plan.result.remainingCount, 2);
  assert.equal(plan.result.projectSaved, undefined);
});

test("QA validation rejects a wrong resume/question, empty answer and answered without sources", () => {
  const original = freeze(prepareResumeDraft({}, args(), options).state);
  const valid = { resume_id: "resume-new", question_id: "question-1", status: "answered", answer: "本人回答", source_refs: ["user:fixture"] };
  for (const [patch, pattern] of [
    [{ resume_id: "other" }, /当前正在查看/], [{ question_id: "other" }, /不属于当前/],
    [{ status: "open" }, /status/], [{ answer: " " }, /answer/], [{ source_refs: [] }, /至少需要一个 Source/],
  ]) assert.throws(() => prepareResumeQaAnswer(original, { ...valid, ...patch }, { now: later }), pattern);
  for (const status of ["needs_source", "skipped"]) assert.doesNotThrow(() => prepareResumeQaAnswer(original, { ...valid, status, source_refs: [] }, { now: later }));
});

test("a new answer proposal protects a reviewed career answer and invalidates current and historical dependent claims", () => {
  let original = prepareResumeDraft({}, args(), options).state;
  const careerQaId = original.resume.candidateQuestions[0].careerQaId;
  original = upsertCareerQa(original, { id: careerQaId, answer: "原先已经审核的本人事实" }, { actor: "user", confirm: true, now: first });
  original.resume.claimEvidence[0].qaIds = [careerQaId];
  original.versions = [{ versionId: "historical", markdown, claimEvidence: structuredClone(original.resume.claimEvidence) }];
  const before = JSON.stringify(original);
  const plan = prepareResumeQaAnswer(freeze(original), { resume_id: "resume-new", question_id: "question-1", status: "needs_source", answer: "聊天补充的新原话", source_refs: [] }, { now: later });
  const career = plan.state.careerQa.find(item => item.id === careerQaId);
  assert.equal(career.answer, "原先已经审核的本人事实");
  assert.equal(career.pendingRevision.content.answer, "聊天补充的新原话");
  assert.equal(plan.state.resume.claimEvidence[0].status, "needs_review");
  assert.equal(plan.state.versions[0].claimEvidence[0].status, "needs_review");
  assert.equal(JSON.stringify(original), before);
});

test("QA capacity failure and legacy oversized facts fail before mutating any caller-owned state", () => {
  let original = prepareResumeDraft({}, args(), options).state;
  const careerQaId = original.resume.candidateQuestions[0].careerQaId;
  original = upsertCareerQa(original, { id: careerQaId, answer: "已审核事实" }, { actor: "user", confirm: true, now: first });
  original = upsertCareerQa(original, { id: careerQaId, answer: "前次待审" }, { actor: "agent", now: later });
  const career = original.careerQa.find(item => item.id === careerQaId);
  career.revisions = Array.from({ length: 40 }, () => ({ version: 1, status: "confirmed", actor: "user", recordedAt: first, reason: "edited", content: { question: "旧问题", answer: "旧事实" } }));
  const before = JSON.stringify(original);
  const incoming = { resume_id: "resume-new", question_id: "question-1", status: "needs_source", answer: "另一次待审", source_refs: [] };
  assert.throws(() => prepareResumeQaAnswer(freeze(original), incoming, { now: later }), /40 次修订/);
  assert.equal(JSON.stringify(original), before);
  const oversized = structuredClone(original); oversized.careerQa.find(item => item.id === careerQaId).revisions = [];
  oversized.careerQa.find(item => item.id === careerQaId).answer = "x".repeat(13000) + "ORIGINAL_END";
  assert.throws(() => prepareResumeQaAnswer(freeze(oversized), incoming, { now: later }), /超出现有字段容量/);
  assert.ok(oversized.careerQa.find(item => item.id === careerQaId).answer.endsWith("ORIGINAL_END"));
});

test("draft writes reject astral text beyond storage capacity before normalizing any incoming fact", () => {
  const oversized = maximum => "😀".repeat(Math.floor(maximum / 2) + 1);
  const cases = [
    ["title", 120], ["markdown", 50000], ["category", 80], ["job_id", 80], ["base_resume_id", 100],
    ["claim_evidence.0.claim", 800], ["claim_evidence.0.why_it_matters", 400],
    ["claim_evidence.0.improvement", 800], ["claim_evidence.0.sources.0.label", 160],
    ["claim_evidence.0.sources.0.locator", 500], ["claim_evidence.0.sources.0.evidence", 800],
    ["claim_evidence.0.interview_questions.0.question", 500], ["claim_evidence.0.interview_questions.0.focus", 240],
    ["candidate_questions.0.id", 100], ["candidate_questions.0.question", 600], ["candidate_questions.0.why", 500],
    ["candidate_questions.0.related_claim", 800], ["candidate_questions.0.answer", 3000],
    ["candidate_questions.0.suggested_change", 1000], ["candidate_questions.0.answered_at", 80], ["notes.0", 300],
  ];
  const original = freeze(state()), before = JSON.stringify(original);
  for (const [path, maximum] of cases) {
    const incoming = args();
    const parts = path.split(".");
    const parent = parts.slice(0, -1).reduce((value, key) => value[key], incoming);
    parent[parts.at(-1)] = oversized(maximum);
    assert.ok([...parent[parts.at(-1)]].length <= maximum, "the transport's code-point limit permits this input");
    const inputBefore = JSON.stringify(incoming);
    assert.throws(() => prepareResumeDraft(original, freeze(incoming), options), /超出现有字段容量/, path);
    assert.equal(JSON.stringify(incoming), inputBefore, path);
    assert.equal(JSON.stringify(original), before, path);
  }
  for (const [record, field, maximum] of [
    ["claim", "source_ids", 100], ["claim", "episode_ids", 100], ["claim", "qa_ids", 100],
    ["question", "source_hints", 300], ["question", "source_refs", 500],
  ]) {
    const incoming = args();
    (record === "claim" ? incoming.claim_evidence[0] : incoming.candidate_questions[0])[field] = [oversized(maximum)];
    assert.throws(() => prepareResumeDraft(original, incoming, options), /超出现有字段容量/, field);
  }
  const aliases = args();
  aliases.claim_evidence[0].whyItMatters = oversized(400);
  assert.throws(() => prepareResumeDraft(original, aliases, options), /whyItMatters.*超出现有字段容量/);
  delete aliases.claim_evidence[0].whyItMatters;
  aliases.candidate_questions[0].sourceRefs = [oversized(500)];
  assert.throws(() => prepareResumeDraft(original, aliases, options), /sourceRefs\[0\].*超出现有字段容量/);
});

test("QA writes reject oversized astral answers, references and suggested wording without changing the active version", () => {
  const original = freeze(prepareResumeDraft({}, args(), options).state);
  const before = JSON.stringify(original);
  const valid = { resume_id: "resume-new", question_id: "question-1", status: "answered", answer: "本人原话", source_refs: ["user:fixture"] };
  for (const [field, maximum] of [["resume_id", 100], ["question_id", 100], ["answer", 3000], ["suggested_change", 1000], ["source_refs", 500]]) {
    const value = "😀".repeat(maximum / 2 + 1);
    const incoming = freeze({ ...valid, [field]: field === "source_refs" ? [value] : value });
    assert.throws(() => prepareResumeQaAnswer(original, incoming, { now: later }), /超出现有字段容量/, field);
    assert.equal(JSON.stringify(original), before);
  }
});

test("boundary-size astral content is kept verbatim and an unrelated legacy snapshot is not revalidated", () => {
  const prefix = `${markdown}\n\n## 附注\n\n`;
  const room = 50000 - prefix.length;
  const incoming = args({ title: "😀".repeat(60), category: "😀".repeat(40),
    markdown: prefix + "😀".repeat(Math.floor(room / 2)) + (room % 2 ? "x" : "") });
  incoming.claim_evidence[0].sources[0].evidence = "😀".repeat(400);
  incoming.claim_evidence[0].interview_questions[0].focus = "😀".repeat(120);
  incoming.candidate_questions[0].why = "😀".repeat(250);
  incoming.notes = ["😀".repeat(150)];
  const legacy = state();
  legacy.resume.markdown = "😀".repeat(30000) + "LEGACY_RESUME_END";
  legacy.careerQa = [{ id: "legacy-unrelated", question: "Unrelated legacy fact", answer: "😀".repeat(6500) + "LEGACY_FACT_END", status: "draft", extension: { preserve: true } }];
  const plan = prepareResumeDraft(freeze(legacy), freeze(incoming), options);
  assert.equal(plan.state.resume.title, incoming.title);
  assert.equal(plan.state.resume.category, incoming.category);
  assert.equal(plan.state.resume.markdown, incoming.markdown);
  assert.equal(plan.result.characterCount, 50000);
  assert.equal(plan.state.resume.claimEvidence[0].sources[0].evidence, incoming.claim_evidence[0].sources[0].evidence);
  assert.equal(plan.state.resume.candidateQuestions[0].why, incoming.candidate_questions[0].why);
  assert.deepEqual(plan.state.resume.notes, incoming.notes);
  assert.equal(plan.state.versions[0].markdown, legacy.resume.markdown);
  assert.deepEqual(plan.state.careerQa.find(item => item.id === "legacy-unrelated"), legacy.careerQa[0]);
  const answer = "😀".repeat(1500), source = "😀".repeat(250), suggested = "😀".repeat(500);
  const answered = prepareResumeQaAnswer(plan.state, { resume_id: "resume-new", question_id: "question-1", status: "answered", answer,
    source_refs: [source], suggested_change: suggested }, { now: later });
  assert.equal(answered.state.resume.candidateQuestions[0].answer, answer);
  assert.deepEqual(answered.state.resume.candidateQuestions[0].sourceRefs, [source]);
  assert.equal(answered.state.resume.candidateQuestions[0].suggestedChange, suggested);
  assert.equal(answered.state.versions[0].markdown, legacy.resume.markdown);
  assert.deepEqual(answered.state.careerQa.find(item => item.id === "legacy-unrelated"), legacy.careerQa[0]);
});
