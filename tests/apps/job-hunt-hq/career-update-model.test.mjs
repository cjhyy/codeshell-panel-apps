import test from "node:test";
import assert from "node:assert/strict";
import { CAREER_UPDATE_MAX_BYTES, parseCareerUpdate, prepareCareerUpdate } from "../../../apps/job-hunt-hq/app/career-update-model.mjs";
import { upsertCareerSource, upsertCareerEpisode, upsertCareerQa } from "../../../apps/job-hunt-hq/app/career-library-model.mjs";

const first = "2026-10-12T00:00:00.000Z";
const later = "2026-10-12T01:00:00.000Z";
const last = "2026-10-12T02:00:00.000Z";
const source = { id: "career-source-original", provider: "slack", connectionId: "work-a", externalId: "C1:123.45", url: "https://slack.example/archives/C1/p12345", excerpt: "本人讨论断网后的恢复方案。" };
const episode = { id: "career-episode-original", title: "离线恢复选择", sourceIds: [source.id], reason: "离线继续使用更重要", results: "本地恢复成功" };
const qa = { id: "career-qa-original", episodeId: episode.id, sourceIds: [source.id], category: "decision", question: "你为什么选择这个方案？", answer: "我负责实现了本地恢复。", draftAnswer: "" };

function document(overrides = {}) {
  return { format: "codeshell.career-update", schemaVersion: 1, version: { id: "career-version-session-1", title: "本次会话整理" }, sources: [{ ...source }], episodes: [], qa: [], ...overrides };
}

function parse(value) {
  return parseCareerUpdate(JSON.stringify(value));
}

function reviewedLibrary() {
  const user = { actor: "user", confirm: true, now: first };
  let state = upsertCareerSource({ retained: { note: "unrelated state" }, careerLibraryVersions: [{ id: "career-version-previous" }] }, source, user);
  state = upsertCareerEpisode(state, episode, user);
  return upsertCareerQa(state, qa, user);
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test("strict JSON parses only the versioned incremental envelope and preserves original chat words", () => {
  const input = document({ episodes: [{ ...episode, actions: ["实现本地日志"], alternatives: ["远端重试"], tags: ["可靠性"] }], qa: [{ ...qa, draftAnswer: "本人建议的面试表达" }] });
  assert.deepEqual(parse(input), input);
  const result = prepareCareerUpdate({}, input, { now: first });
  assert.deepEqual(result.counts, { sources: 1, episodes: 1, qa: 1, total: 3 });
  assert.deepEqual(result.ids, { sources: [source.id], episodes: [episode.id], qa: [qa.id] });
  assert.equal(result.state.careerQa[0].answer, qa.answer);
  assert.equal(result.state.careerQa[0].draftAnswer, "本人建议的面试表达");
  assert.ok(result.state.sourceMaterials.every((record) => record.status === "draft"));
  assert.ok(result.state.careerEpisodes.every((record) => record.status === "draft"));
  assert.ok(result.state.careerQa.every((record) => record.status === "draft"));
  assert.deepEqual(result.comparison.counts, { added: 3, updated: 0, archived: 0 });
  assert.equal(result.comparison.unresolved.total, 3);
});

test("unknown fields and confirmation metadata are rejected at every scope", () => {
  const invalid = [
    document({ actor: "user" }), document({ confirmation: "我已确认" }),
    document({ version: { id: "career-version-ok", title: "标题", path: "arbitrary.json" } }),
    document({ version: { id: "career-version-ok", title: "标题", updateSha256: "a".repeat(64) } }),
    document({ sources: [{ ...source, history: [] }] }),
    document({ sources: [{ ...source, confirmedBy: "user" }] }),
    document({ sources: [{ ...source, status: "confirmed" }] }),
    document({ sources: [], episodes: [{ ...episode, actor: "user" }] }),
    document({ sources: [], episodes: [{ ...episode, status: "archived" }] }),
    document({ sources: [], qa: [{ ...qa, revisions: [] }] }),
    document({ sources: [], qa: [{ ...qa, pendingRevision: {} }] }),
  ];
  for (const input of invalid) assert.throws(() => parse(input), /未知字段|只允许 draft/);
});

test("required fields, types, categories and safe IDs are validated without coercion", () => {
  const invalid = [
    {}, document({ format: "codeshell.other" }), document({ schemaVersion: "1" }),
    document({ qa: undefined }), document({ episodes: {} }),
    document({ sources: [], episodes: [], qa: [] }),
    document({ version: { id: "career-version-../escape", title: "标题" } }),
    document({ version: { id: "career-version-ok", title: " " } }),
    document({ sources: [{ id: source.id, provider: "slack" }] }),
    document({ sources: [{ ...source, provider: " " }] }),
    document({ sources: [{ id: source.id, provider: "slack", excerpt: " \n " }] }),
    document({ sources: [{ ...source, id: "career-source-../../source" }] }),
    document({ sources: [{ ...source, excerpt: null }] }),
    document({ sources: [{ ...source, occurredAt: 123 }] }),
    document({ sources: [], episodes: [{ id: episode.id, title: "\n\t" }] }),
    document({ sources: [], episodes: [{ ...episode, sourceIds: ["other-source"] }] }),
    document({ sources: [], episodes: [{ ...episode, actions: "one" }] }),
    document({ sources: [], qa: [{ ...qa, question: " " }] }),
    document({ sources: [], qa: [{ ...qa, category: "generic-algorithm" }] }),
    document({ sources: [], qa: [{ ...qa, episodeId: "../episode" }] }),
  ];
  for (const input of invalid) assert.throws(() => parse(input), /经历资料 JSON/);
  assert.doesNotThrow(() => parse(document({ sources: [], qa: [{ id: qa.id, question: qa.question, episodeId: "" }] })));
  assert.throws(() => prepareCareerUpdate({}, document({ sources: [{ ...source, title: undefined }] })), /必须是字符串/);
});

test("field and collection limits reject oversized facts instead of silently truncating them", () => {
  const invalid = [
    document({ sources: [{ ...source, excerpt: "x".repeat(16001) }] }),
    document({ sources: [{ ...source, excerpt: "😀".repeat(8001) }] }),
    document({ sources: [{ ...source, url: "x".repeat(2001) }] }),
    document({ sources: Array.from({ length: 26 }, (_, index) => ({ ...source, id: `career-source-${index}` })) }),
    document({ sources: [], episodes: [{ ...episode, reason: "x".repeat(12001) }] }),
    document({ sources: [], episodes: [{ ...episode, actions: ["x".repeat(1001)] }] }),
    document({ sources: [], episodes: [{ ...episode, alternatives: Array(41).fill("option") }] }),
    document({ sources: [], episodes: [{ ...episode, tags: Array(21).fill("tag") }] }),
    document({ sources: [], qa: [{ ...qa, answer: "x".repeat(12001) }] }),
    document({ sources: [], qa: [{ ...qa, question: "x".repeat(1201) }] }),
    document({ version: { id: "career-version-ok", title: "标题", summary: "x".repeat(2001) } }),
  ];
  for (const input of invalid) assert.throws(() => parse(input), /超过|最多/);
});

test("128 KiB is a UTF-8 document limit including raw whitespace", () => {
  const raw = JSON.stringify(document());
  const remaining = CAREER_UPDATE_MAX_BYTES - Buffer.byteLength(raw);
  assert.doesNotThrow(() => parseCareerUpdate(`${raw}${" ".repeat(remaining)}`));
  assert.throws(() => parseCareerUpdate(`${raw}${" ".repeat(remaining + 1)}`), /128 KiB/);
  const multibyte = document({ sources: Array.from({ length: 4 }, (_, index) => ({ id: `career-source-${index}`, provider: "user", excerpt: "汉".repeat(12000) })) });
  assert.ok(JSON.stringify(multibyte).length < CAREER_UPDATE_MAX_BYTES);
  assert.throws(() => parse(multibyte), /128 KiB/);
  assert.throws(() => prepareCareerUpdate({}, multibyte), /128 KiB/);
});

test("duplicate JSON keys including escaped aliases cannot conceal an earlier value", () => {
  const raw = JSON.stringify(document());
  assert.throws(() => parseCareerUpdate(raw.replace('"schemaVersion":1', '"schemaVersion":99,"schemaVersion":1')), /重复 JSON 属性/);
  assert.throws(() => parseCareerUpdate(raw.replace('"provider":"slack"', '"provider":"evil","provi\\u0064er":"slack"')), /重复 JSON 属性/);
  assert.throws(() => parseCareerUpdate(`\`\`\`json\n${raw}\n\`\`\``), /严格 JSON/);
  assert.throws(() => parseCareerUpdate(`${raw} trailing`), /严格 JSON/);
  assert.throws(() => parseCareerUpdate(`\uFEFF${raw}`), /严格 JSON/);
  assert.doesNotThrow(() => parse(document({ sources: [{ ...source, excerpt: '包含 "provider": 两次及反斜杠 \\ 的原文' }] })));
});

test("stable source identities remap all incoming references to the existing material", () => {
  const original = upsertCareerSource({}, source, { actor: "agent", now: first });
  const alias = "career-source-new-chat-alias";
  const input = freeze(document({ sources: [{ ...source, id: alias }], episodes: [{ ...episode, sourceIds: [alias] }], qa: [{ ...qa, sourceIds: [alias] }] }));
  const result = prepareCareerUpdate(freeze(original), input, { now: later });
  assert.deepEqual(result.sourceIdMap, { [alias]: source.id });
  assert.deepEqual(result.ids.sources, [source.id]);
  assert.equal(result.document.sources[0].id, source.id);
  assert.deepEqual(result.document.episodes[0].sourceIds, [source.id]);
  assert.deepEqual(result.document.qa[0].sourceIds, [source.id]);
  assert.deepEqual(result.state.careerEpisodes[0].sourceIds, [source.id]);
  assert.deepEqual(result.state.careerQa[0].sourceIds, [source.id]);
  assert.equal(result.state.sourceMaterials.length, 1);
  assert.equal(input.sources[0].id, alias);
  assert.equal(original.sourceMaterials[0].version, 1);
});

test("duplicate IDs and ambiguous natural material identities reject the whole batch", () => {
  const original = reviewedLibrary();
  const before = JSON.stringify(original);
  const invalid = [
    document({ sources: [{ ...source }, { ...source, excerpt: "another" }] }),
    document({ sources: [{ ...source }, { ...source, id: "career-source-alias" }] }),
    document({ sources: [], episodes: [{ ...episode }, { ...episode }] }),
    document({ sources: [], qa: [{ ...qa }, { ...qa }] }),
  ];
  for (const input of invalid) assert.throws(() => prepareCareerUpdate(freeze(original), input), /重复|歧义/);
  assert.equal(JSON.stringify(original), before);
  const corrupt = { ...original, sourceMaterials: [...original.sourceMaterials, { ...original.sourceMaterials[0], id: "career-source-duplicate-identity" }] };
  assert.throws(() => prepareCareerUpdate(corrupt, document({ sources: [{ ...source, id: "career-source-alias" }] })), /冲突/);
});

test("same prompt or episode title with different explicit IDs remains distinct", () => {
  const input = document({ episodes: [{ ...episode }, { ...episode, id: "career-episode-another" }], qa: [{ ...qa }, { ...qa, id: "career-qa-another" }] });
  const result = prepareCareerUpdate({}, input, { now: first });
  assert.equal(result.state.careerEpisodes.length, 2);
  assert.equal(result.state.careerQa.length, 2);
});

test("known source IDs cannot be hijacked across providers, accounts or locators", () => {
  const original = reviewedLibrary();
  for (const [field, value] of Object.entries({ provider: "github", connectionId: "work-b", externalId: "C1:999", url: "https://elsewhere.example/new", localRef: "new-file.json" })) {
    const state = field === "localRef" ? { ...original, sourceMaterials: [{ ...original.sourceMaterials[0], localRef: "old-file.json" }] } : original;
    assert.throws(() => prepareCareerUpdate(state, document({ sources: [{ ...source, [field]: value }] })), /不可更换/);
  }
  assert.throws(() => prepareCareerUpdate(original, document({ sources: [{ ...source, connectionId: "" }] })), /不可更换/);
  assert.throws(() => prepareCareerUpdate(original, document({ sources: [{ ...source, id: "career-source-alias", url: "https://elsewhere.example/new" }] })), /不可更换/);
  assert.doesNotThrow(() => prepareCareerUpdate(original, document({ sources: [{ id: source.id, provider: "SLACK", excerpt: source.excerpt }] })));
  const separated = prepareCareerUpdate(original, document({ sources: [{ ...source, id: "career-source-other-account", connectionId: "work-b" }] }), { now: later });
  assert.equal(separated.state.sourceMaterials.length, 2);
});

test("known URL-only source can gain an opaque external ID and connection without changing its stable ID", () => {
  const urlOnly = { id: source.id, provider: source.provider, url: source.url, excerpt: source.excerpt };
  const original = upsertCareerSource({}, urlOnly, { actor: "agent", now: first });
  const result = prepareCareerUpdate(original, document(), { now: later });
  assert.equal(result.state.sourceMaterials.length, 1);
  assert.equal(result.state.sourceMaterials[0].id, source.id);
  assert.equal(result.state.sourceMaterials[0].externalId, source.externalId);
  assert.equal(result.state.sourceMaterials[0].connectionId, source.connectionId);
  assert.equal(result.state.sourceMaterials[0].history[0].content.url, source.url);
});

test("reviewed source, episode and factual answer retain their originals with visible pending revisions", () => {
  const original = freeze(reviewedLibrary());
  const before = JSON.stringify(original);
  const input = freeze(document({
    sources: [{ ...source, excerpt: "新增原始材料摘录。" }],
    episodes: [{ ...episode, results: "待本人核验的新结果" }],
    qa: [{ ...qa, answer: "本人在聊天补充的新原话。", draftAnswer: "AI 提供的独立表达草稿。" }],
  }));
  const result = prepareCareerUpdate(original, input, { now: later });
  assert.equal(JSON.stringify(original), before);
  assert.equal(result.state.sourceMaterials[0].excerpt, source.excerpt);
  assert.equal(result.state.sourceMaterials[0].pendingRevision.content.excerpt, "新增原始材料摘录。");
  assert.equal(result.state.careerEpisodes[0].results, episode.results);
  assert.equal(result.state.careerEpisodes[0].pendingRevision.content.results, "待本人核验的新结果");
  assert.equal(result.state.careerEpisodes[0].status, "needs_review");
  assert.equal(result.state.careerQa[0].answer, qa.answer);
  assert.equal(result.state.careerQa[0].pendingRevision.content.answer, "本人在聊天补充的新原话。");
  assert.equal(result.state.careerQa[0].draftAnswer, "AI 提供的独立表达草稿。");
  assert.equal(result.state.careerQa[0].status, "needs_review");
  assert.equal(result.comparison.unresolved.pending, 3);
  assert.deepEqual(result.comparison.counts, { added: 0, updated: 3, archived: 0 });
  const repeated = prepareCareerUpdate(freeze(result.state), input, { now: last });
  assert.deepEqual(repeated.state, result.state);
  assert.equal(repeated.comparison.changes.length, 0);
});

test("repeat batch at a later clock time changes no versions, histories, timestamps or records", () => {
  const input = document({ episodes: [{ ...episode }], qa: [{ ...qa }] });
  const firstPlan = prepareCareerUpdate({}, input, { now: first });
  const repeated = prepareCareerUpdate(freeze(firstPlan.state), freeze(input), { now: last });
  assert.deepEqual(repeated.state, firstPlan.state);
  assert.deepEqual(repeated.comparison.counts, { added: 0, updated: 0, archived: 0 });
  assert.equal(repeated.state.careerQa[0].updatedAt, first);
  assert.equal(repeated.state.sourceMaterials[0].history.length, 0);
  assert.equal(repeated.state.careerEpisodes[0].revisions.length, 0);
  assert.equal(repeated.state.careerQa[0].revisions.length, 0);
});

test("archived records cannot be changed or revived by exact IDs or natural source aliases", () => {
  let state = reviewedLibrary();
  state = upsertCareerSource(state, { id: source.id, status: "archived" }, { actor: "user", now: later });
  state = upsertCareerEpisode(state, { id: episode.id, status: "archived" }, { actor: "user", now: later });
  state = upsertCareerQa(state, { id: qa.id, status: "archived" }, { actor: "user", now: later });
  const invalid = [
    document(), document({ sources: [{ ...source, id: "career-source-alias" }] }),
    document({ sources: [], episodes: [{ ...episode }] }), document({ sources: [], qa: [{ ...qa }] }),
  ];
  const before = JSON.stringify(state);
  for (const input of invalid) assert.throws(() => prepareCareerUpdate(freeze(state), input), /已归档/);
  assert.equal(JSON.stringify(state), before);
});

test("missing material and episode references reject before applying any incoming record", () => {
  const state = freeze({ profile: { name: "Synthetic fixture" }, sourceMaterials: [], careerEpisodes: [], careerQa: [] });
  const before = JSON.stringify(state);
  const invalid = [
    document({ episodes: [{ ...episode, sourceIds: ["career-source-missing"] }] }),
    document({ qa: [{ ...qa, episodeId: "career-episode-missing" }] }),
    document({ qa: [{ ...qa, episodeId: "", sourceIds: ["career-source-missing"] }] }),
  ];
  for (const input of invalid) assert.throws(() => prepareCareerUpdate(state, input, { now: first }), /不存在/);
  assert.equal(JSON.stringify(state), before);
});

test("unmentioned records, full history, pending proposals and unrelated root fields survive incremental updates", () => {
  let state = reviewedLibrary();
  state = upsertCareerQa(state, { id: qa.id, draftAnswer: "上次待审表达" }, { actor: "agent", now: later });
  state.sourceMaterials[0].futureExtension = { retained: true };
  state.careerQa[0].pendingRevision.content.futureExtension = "完整保留待审原文";
  const input = document({ sources: [], episodes: [{ id: "career-episode-new", title: "新经历" }] });
  const oldSource = state.sourceMaterials[0];
  const oldEpisode = state.careerEpisodes[0];
  const oldQa = state.careerQa[0];
  const result = prepareCareerUpdate(freeze(state), input, { now: last });
  assert.equal(result.state.sourceMaterials[0], oldSource);
  assert.equal(result.state.careerEpisodes[0], oldEpisode);
  assert.equal(result.state.careerQa[0], oldQa);
  assert.equal(result.state.retained, state.retained);
  assert.equal(result.state.careerLibraryVersions, state.careerLibraryVersions);
  assert.deepEqual(result.comparison.counts, { added: 1, updated: 0, archived: 0 });
  assert.deepEqual(Object.keys(result.state).sort(), [...Object.keys(state), ""].filter(Boolean).sort());
});

test("superseded proposals retain their full original historical payload", () => {
  let state = reviewedLibrary();
  state = upsertCareerQa(state, { id: qa.id, answer: "第一条待审原话" }, { actor: "agent", now: later });
  state.careerQa[0].pendingRevision.content.futureExtension = "不应丢弃";
  const previous = structuredClone(state.careerQa[0].pendingRevision.content);
  const result = prepareCareerUpdate(freeze(state), document({ sources: [], qa: [{ ...qa, answer: "第二条待审原话" }] }), { now: last });
  const history = result.state.careerQa[0].revisions.find((entry) => entry.reason === "superseded_proposal");
  assert.deepEqual(history.content, previous);
  assert.equal(result.state.careerQa[0].answer, qa.answer);
  assert.equal(result.state.careerQa[0].pendingRevision.content.answer, "第二条待审原话");
});

test("a later capacity error leaves all earlier local batch writes and the input untouched", () => {
  const state = reviewedLibrary();
  state.careerQa[0].revisions = Array.from({ length: 40 }, () => ({ version: 1, status: "confirmed", actor: "user", recordedAt: first, reason: "edited", content: { ...qa } }));
  state.careerQa[0].pendingRevision = { status: "draft", actor: "agent", createdAt: later, baseVersion: 1, version: 2, content: { ...qa, answer: "old proposal" } };
  const before = JSON.stringify(state);
  const input = freeze(document({ sources: [{ id: "career-source-new", provider: "user", excerpt: "新材料" }], qa: [{ ...qa, answer: "new proposal" }] }));
  assert.throws(() => prepareCareerUpdate(freeze(state), input, { now: last }), /40 次修订/);
  assert.equal(JSON.stringify(state), before);
  assert.equal(input.sources[0].id, "career-source-new");
});

test("corrupt existing duplicate IDs are rejected rather than silently deduplicated", () => {
  const state = { sourceMaterials: [{ ...source }, { ...source }] };
  const before = JSON.stringify(state);
  assert.throws(() => prepareCareerUpdate(state, document()), /重复 ID/);
  assert.equal(JSON.stringify(state), before);
});
