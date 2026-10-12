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

test("published Host accepts four candidate write modes and rejects mixed or incomplete modes", () => {
  const name = "save_candidate_context";
  const schema = tools.get(name).inputSchema;
  for (const input of [
    { source: { provider: "file", excerpt: "Synthetic source" } },
    { episode: { title: "Synthetic episode", actions: ["Verified action"] } },
    { qa: { question: "What was the decision?", draftAnswer: "Draft wording" } },
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
  ])
    assert.notEqual(validateToolArgsStrict(name, input, schema), null);
});

test("read schema advertises separate career scopes and exact opaque IDs", () => {
  const schema = tools.get("get_job_search_context").inputSchema.properties;
  for (const scope of ["career_sources", "career_episodes", "career_qa"])
    assert(schema.scope.enum.includes(scope));
  for (const field of ["source_id", "episode_id", "qa_id"])
    assert.equal(schema[field].maxLength, 100);
  for (const status of ["draft", "confirmed", "needs_review", "archived"])
    assert(schema.status.enum.includes(status));
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
