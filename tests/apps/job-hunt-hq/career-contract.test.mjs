import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PanelAppManifest, validateToolArgsStrict } from "@cjhyy/code-shell-core";
import {
  buildJobSearchContext,
  jobSearchContextJsonBytes,
  JOB_SEARCH_CONTEXT_MAX_BYTES,
} from "../../../apps/job-hunt-hq/app/job-search-context-model.mjs";

const manifest = JSON.parse(
  await readFile(
    new URL("../../../apps/job-hunt-hq/.codeshell-panel/panel.json", import.meta.url),
    "utf8",
  ),
);
const tools = new Map(manifest.agent.tools.map((tool) => [tool.name, tool]));

function fixture() {
  return {
    project: { name: "Synthetic career project" },
    sourceMaterials: [
      {
        id: "source-one",
        provider: "slack",
        author: "Synthetic Author",
        excerpt: "A".repeat(900) + "PRIVATE_SOURCE_END",
        status: "draft",
        updatedAt: "2026-10-12",
      },
      {
        id: "source-two",
        provider: "github",
        excerpt: "Distinct evidence",
        status: "archived",
        updatedAt: "2026-10-11",
      },
    ],
    careerEpisodes: [
      {
        id: "episode-one",
        title: "Workflow recovery",
        project: "Project One",
        myRole: "Implemented recovery",
        sourceIds: ["source-one"],
        tags: ["reliability"],
        status: "confirmed",
      },
      { id: "episode-two", title: "Other project", sourceIds: ["source-two"], status: "draft" },
    ],
    careerQa: [
      {
        id: "qa-one",
        episodeId: "episode-one",
        question: "Why choose this recovery mechanism?",
        category: "decision",
        answer: "B".repeat(900) + "PRIVATE_ANSWER_END",
        draftAnswer: "PRIVATE_AI_DRAFT",
        sourceIds: ["source-one"],
        status: "confirmed",
      },
      {
        id: "qa-two",
        episodeId: "episode-two",
        question: "What did you own?",
        sourceIds: ["source-two"],
        status: "draft",
      },
    ],
    questionBank: [{ id: "practice-one", question: "UNRELATED_PRACTICE_SECRET" }],
    resumes: [{ id: "resume-one", markdown: "UNRELATED_RESUME_SECRET" }],
  };
}

test("career Agent schemas cannot impersonate user confirmation", () => {
  assert.equal(manifest.version, "5.0.0");
  assert.equal(manifest.agent.tools.length, 16);
  PanelAppManifest.parse(manifest);
  const tool = tools.get("save_candidate_context");
  assert.equal(tool.readOnly, false);
  const schema = tool.inputSchema;
  for (const field of ["source", "episode", "qa"]) {
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties[field].additionalProperties, false);
    assert.deepEqual(schema.properties[field].properties.status.enum, ["draft"]);
    for (const key of ["actor", "confirm", "confirmedBy", "confirmedAt", "pendingRevision"]) {
      assert.equal(Object.hasOwn(schema.properties, key), false);
      assert.equal(Object.hasOwn(schema.properties[field].properties, key), false);
    }
  }
  const episode = schema.properties.episode;
  assert.equal(episode.properties.actions.type, "array");
  assert.equal(episode.properties.alternatives.type, "array");
  assert.equal(episode.properties.sourceIds.maxItems, 40);
  const qa = schema.properties.qa;
  assert.equal(qa.properties.answer.maxLength, 12000);
  assert.equal(qa.properties.draftAnswer.maxLength, 12000);
});

test("published Host accepts five candidate write modes and rejects mixed or incomplete modes", () => {
  const name = "save_candidate_context";
  const schema = tools.get(name).inputSchema;
  for (const input of [
    { source: { provider: "file", excerpt: "Synthetic source" } },
    { episode: { title: "Synthetic episode", actions: ["Verified action"] } },
    { qa: { question: "What was the decision?", draftAnswer: "Draft wording" } },
    { library_version: { action: "preview" } },
    { library_version: { action: "save", title: "Recovery decision discussion" } },
    {
      library_version: {
        action: "save",
        id: "career-version-recovery",
        title: "Recovery decision discussion",
        summary: "Preserve open questions and pending changes.",
      },
    },
    { profile: {}, repositories: [], work_history: [] },
  ])
    assert.equal(validateToolArgsStrict(name, input, schema), null);
  for (const input of [
    {},
    { profile: {}, repositories: [] },
    { source: { provider: "file" }, episode: { title: "Episode" } },
    { source: { provider: "file" }, profile: {} },
    { source: { provider: "file", status: "confirmed" } },
    { episode: { title: "Episode", actor: "user" } },
    { qa: { question: "Question" }, confirm: true },
    { qa: { question: "Question" }, actor: "user" },
    { library_version: { action: "publish", title: "Invalid action" } },
    { library_version: { action: "save" } },
    { library_version: { action: "save", title: "" } },
    { library_version: { action: "save", title: "Title", id: "../../version" } },
    { library_version: { action: "preview", id: "career-version-recovery" } },
    { library_version: { action: "preview" }, qa: { question: "Question" } },
    { library_version: { action: "save", title: "Title" }, profile: {} },
  ])
    assert.notEqual(validateToolArgsStrict(name, input, schema), null);
});

test("explicit chat confirmation is bounded and exclusive to one career record mode", () => {
  const name = "save_candidate_context";
  const schema = tools.get(name).inputSchema;
  assert.equal(schema.properties.confirmation.maxLength, 1000);
  for (const input of [
    { source: { provider: "slack", excerpt: "My message" } },
    { episode: { title: "Recovery decision" } },
    { qa: { question: "Why recovery?", answer: "I needed safe retries." } },
  ]) {
    assert.equal(
      validateToolArgsStrict(name, { ...input, confirmation: "I confirm these exact facts." }, schema),
      null,
    );
  }
  for (const input of [
    { confirmation: "I confirm." },
    { qa: { question: "Question" }, confirmation: "" },
    { qa: { question: "Question" }, confirmation: "A".repeat(1001) },
    { qa: { question: "Question", confirmation: "I confirm." } },
    { profile: {}, repositories: [], work_history: [], confirmation: "I confirm." },
    { library_version: { action: "preview" }, confirmation: "I confirm." },
    { library_version: { action: "save", title: "Title" }, confirmation: "I confirm." },
  ])
    assert.notEqual(validateToolArgsStrict(name, input, schema), null);
});

test("strict Host schemas accept source titles and exact connected-account identity", () => {
  const name = "save_candidate_context";
  const schema = tools.get(name).inputSchema;
  const fields = schema.properties.source.properties;
  assert.equal(fields.title.maxLength, 240);
  assert.equal(fields.connectionId.maxLength, 240);
  const source = {
    provider: "slack",
    title: "Cache decision discussion",
    connectionId: "opaque-linked-workspace-one",
    externalId: "channel-thread-message-id",
    excerpt: "The source text actually read.",
  };
  assert.equal(validateToolArgsStrict(name, { source }, schema), null);
  for (const field of ["title", "connectionId"])
    assert.notEqual(
      validateToolArgsStrict(name, { source: { ...source, [field]: "A".repeat(241) } }, schema),
      null,
    );
});

test("read schema advertises separate career scopes and exact opaque IDs", () => {
  const schema = tools.get("get_job_search_context").inputSchema.properties;
  for (const scope of ["career_sources", "career_episodes", "career_qa", "career_versions"])
    assert(schema.scope.enum.includes(scope));
  for (const field of ["source_id", "episode_id", "qa_id", "version_id"])
    assert.equal(schema[field].maxLength, 100);
  for (const status of ["draft", "confirmed", "needs_review", "archived"])
    assert(schema.status.enum.includes(status));
});

test("named library version context returns bounded metadata without snapshot or working facts", () => {
  const input = fixture();
  input.careerLibraryVersions = Array.from({ length: 60 }, (_, index) => ({
    id: `career-version-${index}`,
    title: `Decision ${index}`,
    summary: "中".repeat(2000),
    createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    sessionId: "chat-one",
    baseVersionId: index ? `career-version-${index - 1}` : "",
    path: `career-data/library-versions/career-version-${index}.json`,
    status: "saved",
    counts: { sources: 1, episodes: 1, qa: 2, total: 4, unresolved: 1, pending: 1 },
    sha256: "a".repeat(64),
    snapshot: { sourceMaterials: [{ excerpt: "PRIVATE_INLINE_SNAPSHOT".repeat(1000) }] },
    unexpected: "PRIVATE_UNEXPECTED_FIELD",
  }));
  const before = JSON.stringify(input);
  const result = buildJobSearchContext(input, { scope: "career_versions", limit: 50 });
  assert.equal(result.careerLibraryVersions.total, 60);
  assert.equal(result.careerLibraryVersions.items.length, 25);
  assert.equal(result.careerLibraryVersions.nextCursor, 25);
  assert.equal(result.careerLibraryVersions.items[0].id, "career-version-59");
  assert.equal(result.careerLibraryVersions.items[0].sha256, "a".repeat(64));
  assert(jobSearchContextJsonBytes(result) <= JOB_SEARCH_CONTEXT_MAX_BYTES);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|UNRELATED_/);
  assert.equal(JSON.stringify(input), before);
  const second = buildJobSearchContext(input, {
    scope: "career_versions",
    cursor: result.careerLibraryVersions.nextCursor,
    limit: 25,
  });
  assert.equal(second.careerLibraryVersions.items[0].id, "career-version-34");
  const exact = buildJobSearchContext(input, {
    scope: "career_versions",
    version_id: "career-version-4",
  });
  assert.equal(exact.careerLibraryVersions.items.length, 1);
  assert.equal(exact.careerLibraryVersions.items[0].title, "Decision 4");
  assert.deepEqual(exact.careerLibraryVersions.items[0].counts, {
    sources: 1, episodes: 1, qa: 2, total: 4, unresolved: 1, pending: 1,
  });
  assert.doesNotMatch(JSON.stringify(exact), /PRIVATE_|UNRELATED_/);
  const searched = buildJobSearchContext(input, { scope: "career_versions", search: "Decision 59" });
  assert.equal(searched.careerLibraryVersions.total, 1);
  assert.throws(
    () => buildJobSearchContext(input, { scope: "career_versions", versionId: "career-version-absent" }),
    /未找到经历库版本/,
  );
});

test("historical career reads identify the loaded version and never silently fall back to current data", () => {
  const input = fixture();
  const libraryVersion = {
    id: "career-version-past",
    title: "Prior discussion",
    createdAt: "2026-10-11",
    counts: { sources: 2, episodes: 2, qa: 2, total: 6, unresolved: 1, pending: 0 },
    snapshot: { private: "PRIVATE_UNBOUNDED_SNAPSHOT" },
  };
  for (const scope of ["career_sources", "career_episodes", "career_qa"]) {
    assert.throws(
      () => buildJobSearchContext(input, { scope, versionId: libraryVersion.id }),
      /历史快照未加载/,
    );
    assert.throws(
      () => buildJobSearchContext({ ...input, libraryVersion }, { scope, version_id: "career-version-other" }),
      /历史快照未加载/,
    );
    const result = buildJobSearchContext({ ...input, libraryVersion }, { scope, version_id: libraryVersion.id });
    assert.equal(result.historical, true);
    assert.equal(result.libraryVersion.id, libraryVersion.id);
    assert.equal(result.filters.versionId, libraryVersion.id);
    assert.equal(Object.hasOwn(result.libraryVersion, "snapshot"), false);
  }
  const current = buildJobSearchContext(input, { scope: "career_qa" });
  assert.equal(Object.hasOwn(current, "libraryVersion"), false);
  assert.equal(Object.hasOwn(current, "historical"), false);
});

test("workflow documentation agrees with the conversational version and confirmation tool schemas", async () => {
  const base = new URL("../../../apps/job-hunt-hq/agent/skills/job-hunt-workflow/", import.meta.url);
  const documents = await Promise.all(
    ["SKILL.md", "references/workflows.md", "references/data-contract.md"].map((path) =>
      readFile(new URL(path, base), "utf8"),
    ),
  );
  for (const content of documents) {
    assert.match(content, /library_version/);
    assert.match(content, /career_versions/);
    assert.match(content, /confirmation/);
    assert.doesNotMatch(content, /Only a direct Panel user action can confirm|Even when a\s+user expresses agreement in chat, ask them to use the Panel/);
  }
  const examples = [...documents[2].matchAll(/```json\n(\{"library_version"[^\n]+\})\n```/g)];
  assert.equal(examples.length, 2);
  for (const [, source] of examples)
    assert.equal(
      validateToolArgsStrict("save_candidate_context", JSON.parse(source), tools.get("save_candidate_context").inputSchema),
      null,
    );
});

test("resume claims can retain bounded stable references to confirmed career facts", () => {
  const claim = tools.get("save_resume_draft").inputSchema.properties.claim_evidence.items;
  for (const field of ["source_ids", "episode_ids", "qa_ids"]) {
    assert.equal(claim.properties[field].type, "array");
    assert.equal(claim.properties[field].maxItems, 40);
    assert.equal(claim.properties[field].items.maxLength, 100);
  }
  assert.equal(claim.additionalProperties, false);
  const question = tools.get("save_resume_draft").inputSchema.properties.candidate_questions.items;
  assert.equal(question.properties.career_qa_id.type, "string");
  assert.equal(question.properties.career_qa_id.maxLength, 100);
});

test("summary gives career counts without exposing source bodies or factual answers", () => {
  const result = buildJobSearchContext(fixture());
  assert.equal(result.counts.sourceMaterials, 2);
  assert.equal(result.counts.careerEpisodes, 2);
  assert.equal(result.counts.careerQa, 2);
  assert(result.availableScopes.includes("career_qa"));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|UNRELATED_/);
});

test("career source catalogs are bounded summaries and exact IDs retrieve full current content", () => {
  const input = fixture();
  const catalog = buildJobSearchContext(input, { scope: "career_sources", limit: 1 });
  assert.equal(catalog.sourceMaterials.total, 1);
  assert.equal(catalog.sourceMaterials.items[0].id, "source-one");
  assert.doesNotMatch(JSON.stringify(catalog), /PRIVATE_SOURCE_END|PRIVATE_ANSWER_END|UNRELATED_/);
  const detail = buildJobSearchContext(input, { scope: "career_sources", sourceId: "source-one" });
  assert.equal(detail.sourceMaterials.items[0].excerpt, input.sourceMaterials[0].excerpt);
  assert.equal(detail.sourceMaterials.items.length, 1);
  assert.doesNotMatch(JSON.stringify(detail), /PRIVATE_ANSWER_END|UNRELATED_/);
  const archived = buildJobSearchContext(input, {
    scope: "career_sources",
    source_id: "source-two",
  });
  assert.equal(archived.sourceMaterials.items[0].status, "archived");
  assert.throws(
    () => buildJobSearchContext(input, { scope: "career_sources", sourceId: "absent" }),
    /未找到/,
  );
});

test("episode and factual QA reads filter relationships without importing practice context", () => {
  const input = fixture();
  const episodes = buildJobSearchContext(input, {
    scope: "career_episodes",
    sourceId: "source-one",
    search: "reliability",
    status: "confirmed",
  });
  assert.deepEqual(
    episodes.careerEpisodes.items.map((item) => item.id),
    ["episode-one"],
  );
  const related = buildJobSearchContext(input, {
    scope: "career_qa",
    episode_id: "episode-one",
    source_id: "source-one",
  });
  assert.deepEqual(
    related.careerQa.items.map((item) => item.id),
    ["qa-one"],
  );
  const exact = buildJobSearchContext(input, {
    scope: "career_qa",
    qa_id: "qa-one",
    episode_id: "episode-one",
  });
  assert.equal(exact.careerQa.items[0].answer, input.careerQa[0].answer);
  assert.equal(exact.careerQa.items[0].draftAnswer, "PRIVATE_AI_DRAFT");
  assert.doesNotMatch(JSON.stringify(exact), /UNRELATED_/);
  assert.throws(
    () =>
      buildJobSearchContext(input, {
        scope: "career_qa",
        qaId: "qa-one",
        episodeId: "episode-two",
      }),
    /未找到/,
  );
});

test("career catalogs paginate and active includes draft and confirmed but excludes archived", () => {
  const input = fixture();
  input.careerEpisodes.push({ id: "episode-archived", title: "Old", status: "archived" });
  const first = buildJobSearchContext(input, {
    scope: "career_episodes",
    status: "active",
    cursor: 0,
    limit: 1,
  });
  assert.equal(first.careerEpisodes.total, 2);
  assert.equal(first.careerEpisodes.nextCursor, 1);
  const second = buildJobSearchContext(input, {
    scope: "career_episodes",
    status: "active",
    cursor: first.careerEpisodes.nextCursor,
    limit: 1,
  });
  assert.equal(second.careerEpisodes.nextCursor, null);
  assert.notEqual(first.careerEpisodes.items[0].id, second.careerEpisodes.items[0].id);
  const all = buildJobSearchContext(input, { scope: "career_episodes", status: "all" });
  assert.equal(all.careerEpisodes.total, 3);
});

test("large exact career facts retain IDs and confirmation with explicit history and text limits", () => {
  const input = fixture();
  const narrative = Object.fromEntries(
    [
      "background",
      "problem",
      "myRole",
      "decision",
      "reason",
      "tradeoffs",
      "results",
      "retrospective",
    ].map((field) => [field, "中".repeat(12000)]),
  );
  input.careerEpisodes[0] = {
    ...input.careerEpisodes[0],
    ...narrative,
    actions: Array.from({ length: 40 }, (_, i) => `${i}${"中".repeat(999)}`),
    alternatives: Array.from({ length: 40 }, (_, i) => `${i}${"文".repeat(999)}`),
    revisions: Array.from({ length: 40 }, (_, i) => ({
      version: i + 1,
      status: "draft",
      actor: "agent",
      reason: "edited",
      content: narrative,
    })),
    pendingRevision: {
      version: 42,
      baseVersion: 41,
      content: { title: "Pending proposal", ...narrative },
    },
  };
  const before = JSON.stringify(input);
  const detail = buildJobSearchContext(input, {
    scope: "career_episodes",
    episodeId: "episode-one",
  });
  assert(jobSearchContextJsonBytes(detail) <= JOB_SEARCH_CONTEXT_MAX_BYTES);
  const record = detail.careerEpisodes.items[0];
  assert.equal(record.id, "episode-one");
  assert.equal(record.status, "confirmed");
  assert.equal(record.pendingRevision.status, "draft");
  assert.equal(record.revisions.length, 5);
  assert(record.revisions.every((revision) => !Object.hasOwn(revision, "content")));
  assert.equal(detail.contextDetail.omittedHistory[0].total, 40);
  assert(detail.contextDetail.truncatedFields.length > 0);
  assert(
    detail.contextDetail.truncatedFields.every(
      (field) => field.returnedCharacters < field.originalCharacters,
    ),
  );
  assert.equal(JSON.stringify(input), before, "reads must not mutate stored career facts");
});

test("legacy projects without a career library remain readable and report empty catalogs", () => {
  const summary = buildJobSearchContext({ jobs: [], resumes: [] });
  assert.equal(summary.counts.sourceMaterials, 0);
  assert.equal(summary.counts.careerEpisodes, 0);
  assert.equal(summary.counts.careerQa, 0);
  assert.equal(buildJobSearchContext({}, { scope: "career_qa" }).careerQa.total, 0);
});
