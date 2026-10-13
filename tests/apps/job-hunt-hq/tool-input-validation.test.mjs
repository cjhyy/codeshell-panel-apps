import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validatePanelToolInput } from "../../../apps/job-hunt-hq/app/tool-input-validation.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../../apps/job-hunt-hq/.codeshell-panel/panel.json", import.meta.url), "utf8"));
const schemas = new Map(manifest.agent.tools.map(({ name, inputSchema }) => [name, inputSchema]));
const validate = (name, input) => validatePanelToolInput(schemas.get(name), input);
const candidate = (input) => validate("save_candidate_context", input);

function resume() {
  return {
    resume_kind: "base",
    category: "engineering",
    title: "Synthetic base resume",
    markdown: `# Synthetic candidate\n\n${"Evidence-backed work. ".repeat(5)}`,
    claim_evidence: [{
      claim: "Evidence-backed work.",
      status: "needs_review",
      importance: "core",
      why_it_matters: "Shows relevant experience.",
      sources: [{ kind: "user", label: "Current chat", locator: "chat:synthetic", evidence: "The candidate described this work." }],
      interview_questions: [{ question: "What did you own?" }],
    }],
    candidate_questions: ["ownership", "decision", "impact"].map((category) => ({
      category, priority: "high", question: `What was your ${category}?`, why: "Confirm the factual detail.",
    })),
  };
}

test("all four public tool schemas enforce strict top-level fields without mutating input", () => {
  const examples = new Map([
    ["get_job_search_context", { scope: "summary", limit: 3 }],
    ["save_candidate_context", { qa: { question: "What did you decide?", answer: "The candidate's original wording." } }],
    ["save_resume_draft", resume()],
    ["save_resume_qa_answer", { resume_id: "resume-one", question_id: "question-one", status: "answered", answer: "My actual answer.", source_refs: [] }],
  ]);
  for (const [name, input] of examples) {
    const before = structuredClone(input);
    assert.equal(schemas.get(name).additionalProperties, false);
    assert.equal(validate(name, input), input);
    assert.deepEqual(input, before);
    assert.throws(() => validate(name, { ...input, injected: true }), /unknown field injected/, name);
    assert.throws(() => validate(name, []), name);
    assert.throws(() => validate(name, null), name);
  }
});

test("context queries reject unbounded catalogs, invalid identities and camelCase transport fields", () => {
  const valid = { scope: "career_qa", qa_id: "career-qa-one", version_id: "career-version-one", status: "draft", cursor: 0, limit: 50 };
  assert.equal(validate("get_job_search_context", valid), valid);
  for (const patch of [
    { scope: "everything" }, { cursor: -1 }, { cursor: 1.5 }, { cursor: 10001 },
    { limit: 0 }, { limit: 51 }, { limit: "3" }, { qa_id: "" },
    { version_id: "../other.json" }, { search: "x".repeat(201) }, { jobId: "job-one" },
  ]) assert.throws(() => validate("get_job_search_context", { ...valid, ...patch }));
});

test("candidate modes are exclusive and career records cannot impersonate reviewed facts", () => {
  for (const input of [
    { profile: {}, repositories: [], work_history: [] },
    { source: { provider: "file", excerpt: "A synthetic original source." } },
    { episode: { title: "Synthetic decision", actions: ["Compared options"] }, confirmation: "I confirm the factual details." },
    { qa: { question: "Why this option?", answer: "My actual reason.", draftAnswer: "Alternative wording.", status: "draft" } },
  ]) assert.equal(candidate(input), input);

  for (const input of [
    {}, { profile: {}, repositories: [] },
    { source: { provider: "file" }, qa: { question: "Mixed mode" } },
    { qa: { question: "Mixed mode" }, profile: {} },
    { source: { provider: "file", actor: "user" } },
    { episode: { title: "Decision", status: "confirmed" } },
    { qa: { question: "Question", pendingRevision: {} } },
    { qa: { question: "Question" }, confirm: true },
    { source: { provider: "file" }, confirmation: "" },
    { episode: { title: "Decision", actions: "An action" } },
    { qa: { question: "Question", sourceIds: [""] } },
  ]) assert.throws(() => candidate(input), JSON.stringify(input));
});

test("version and JSON update modes require the correct branch-specific fields", () => {
  for (const input of [
    { library_version: { action: "preview" } },
    { library_version: { action: "save", id: "career-version-test", title: "Conversation one" } },
    { career_update: { action: "preview", path: "career-data/updates/chat-one.json" } },
    { career_update: { action: "apply", path: "career-data/updates/chat-one.json", preview_token: "a".repeat(64) } },
  ]) assert.equal(candidate(input), input);
  for (const input of [
    { library_version: { action: "save" } },
    { library_version: { action: "preview", id: "career-version-test" } },
    { library_version: { action: "save", title: "Version", id: "career-version-../escape" } },
    { library_version: { action: "save", title: "Version" }, confirmation: "Confirmed" },
    { career_update: { action: "preview", path: "career-data/updates/chat-one.json", preview_token: "a".repeat(64) } },
    { career_update: { action: "apply", path: "career-data/updates/chat-one.json" } },
    { career_update: { action: "apply", path: "career-data/updates/chat-one.json", preview_token: "A".repeat(64) } },
    { career_update: { action: "preview", path: "career-data/updates/../outside.json" } },
    { career_update: { action: "preview", path: "career-data/updates/chat-one.json", actor: "user" } },
  ]) assert.throws(() => candidate(input), JSON.stringify(input));
});

test("resume nested evidence and private questions enforce the manifest contract", () => {
  const input = resume();
  assert.equal(validate("save_resume_draft", input), input);
  for (const invalid of [
    { ...input, markdown: "too short" },
    { ...input, resume_kind: "unknown" },
    { ...input, claim_evidence: [] },
    { ...input, candidate_questions: input.candidate_questions.slice(0, 2) },
    { ...input, claim_evidence: [{ ...input.claim_evidence[0], verified: true }] },
    { ...input, claim_evidence: [{ ...input.claim_evidence[0], sources: [{ ...input.claim_evidence[0].sources[0], actor: "user" }] }] },
    { ...input, claim_evidence: [{ ...input.claim_evidence[0], sources: [{ kind: "user", label: "Chat", locator: "chat:one" }] }] },
    { ...input, candidate_questions: [{ ...input.candidate_questions[0], category: "general-interview-practice" }, ...input.candidate_questions.slice(1)] },
    { ...input, candidate_questions: [{ ...input.candidate_questions[0], careerQaId: "qa-one" }, ...input.candidate_questions.slice(1)] },
  ]) assert.throws(() => validate("save_resume_draft", invalid));
});

test("private answer writes require explicit bounded answer and evidence references", () => {
  const input = { resume_id: "resume-one", question_id: "question-one", status: "needs_source", answer: "I do not remember the number.", source_refs: [], suggested_change: "Keep this unresolved." };
  assert.equal(validate("save_resume_qa_answer", input), input);
  for (const invalid of [
    { ...input, answer: "" }, { ...input, answer: "a".repeat(3001) },
    { ...input, status: "confirmed" }, { ...input, source_refs: Array(9).fill("chat:one") },
    { ...input, source_refs: [""] }, { ...input, source_refs: null },
    Object.fromEntries(Object.entries(input).filter(([key]) => key !== "question_id")),
  ]) assert.throws(() => validate("save_resume_qa_answer", invalid));
});

test("nullable unions, exclusive alternatives and excluded combinations match schema semantics", () => {
  const union = { type: ["string", "null"], maxLength: 2 };
  for (const input of [null, "😀😀"]) assert.equal(validatePanelToolInput(union, input), input);
  for (const input of [1, [], {}, "😀😀😀"]) assert.throws(() => validatePanelToolInput(union, input));
  const alternatives = { anyOf: [{ type: "integer", minimum: 1 }, { type: "string", pattern: "^saved-" }] };
  for (const input of [1, "saved-one"]) assert.equal(validatePanelToolInput(alternatives, input), input);
  for (const input of [0, 1.5, "other", false]) assert.throws(() => validatePanelToolInput(alternatives, input));
  assert.throws(() => validatePanelToolInput({ oneOf: [{ type: "number" }, { type: "integer" }] }, 1), /exactly one/);
  assert.equal(validatePanelToolInput({ oneOf: [{ type: "number" }, { type: "integer" }] }, 1.5), 1.5);
  assert.throws(() => validatePanelToolInput({ type: "object", not: { required: ["confirmation"] } }, { confirmation: "yes" }), /excluded combination/);
  assert.throws(() => validatePanelToolInput({ type: "number" }, Infinity), /expected number/);
  assert.throws(() => validatePanelToolInput({ type: "number" }, NaN), /expected number/);
});
