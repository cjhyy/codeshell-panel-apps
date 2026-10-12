import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCareerLibrary,
  upsertCareerSource,
  upsertCareerEpisode,
  upsertCareerQa,
  applyCareerPendingRevision,
  searchCareerLibrary,
  migrateCareerLibrary,
  syncLegacyCareerQa,
  careerRecordId,
  CAREER_RECORD_MAX_BYTES,
} from "../../../apps/job-hunt-hq/app/career-library-model.mjs";

const first = "2026-10-12T00:00:00.000Z";
const later = "2026-10-12T01:00:00.000Z";
const user = { actor: "user", confirm: true, now: first };
const agent = { actor: "agent", now: later };
const material = { provider: "slack", connectionId: "work-a", externalId: "C1:123.45", title: "方案讨论", url: "https://slack.example/archives/C1/p12345", author: "本人", occurredAt: first, fetchedAt: first, excerpt: "为支持离线恢复，讨论采用本地日志。" };

function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
}

function reviewedLibrary() {
  let state = upsertCareerSource({ retained: { note: "unrelated state" } }, material, user);
  const sourceId = state.sourceMaterials[0].id;
  state = upsertCareerEpisode(state, {
    title: "离线恢复方案", project: "个人工作台", myRole: "负责方案选择与实现",
    background: "断网后需要继续使用", problem: "远端请求不可用", actions: ["实现本地日志"],
    alternatives: ["仅依赖远端重试", "本地日志"], decision: "采用本地日志", reason: "能离线恢复",
    tradeoffs: "承担本地同步复杂度", results: "断网后可以恢复", retrospective: "需要验证合并冲突",
    sourceIds: [sourceId], tags: ["可靠性"],
  }, user);
  const episodeId = state.careerEpisodes[0].id;
  state = upsertCareerQa(state, { episodeId, category: "decision", question: "为什么选择这个方案？", answer: "离线可恢复比节省本地状态更重要。", sourceIds: [sourceId] }, user);
  return state;
}

test("agent ingestion is draft, preserves provider provenance and has stable natural identity", () => {
  const state = upsertCareerSource({}, { ...material, status: "confirmed", confirmedBy: "user", version: 900, history: [{ status: "confirmed" }] }, agent);
  const source = state.sourceMaterials[0];
  assert.equal(source.status, "draft");
  assert.equal(source.confirmedBy, "");
  assert.equal(source.version, 1);
  assert.deepEqual(source.history, []);
  assert.equal(source.author, "本人");
  assert.equal(source.connectionId, "work-a");
  assert.ok(source.contentHash);
  const repeated = upsertCareerSource(state, { ...material, fetchedAt: later }, agent);
  assert.equal(repeated.sourceMaterials.length, 1);
  assert.equal(repeated.sourceMaterials[0].id, source.id);
  assert.equal(repeated.sourceMaterials[0].version, 1);
  assert.equal(repeated.sourceMaterials[0].history.length, 0);
  assert.equal(repeated.sourceMaterials[0].fetchedAt, later);
  assert.equal(upsertCareerSource(state, { ...material, id: "foreign-new-id" }, agent).sourceMaterials.length, 1);
  assert.equal(careerRecordId("sources", { ...material, id: "foreign-new-id" }, state), source.id);
  assert.notEqual(upsertCareerSource({}, { ...material, connectionId: "work-b" }, agent).sourceMaterials[0].id, source.id);
});

test("all mutations return independent normalized entities and preserve unrelated state", () => {
  const original = freeze(reviewedLibrary());
  const before = JSON.stringify(original);
  const next = upsertCareerEpisode(original, { id: original.careerEpisodes[0].id, results: "本人补充的新结果" }, { actor: "user", now: later });
  assert.equal(JSON.stringify(original), before);
  assert.equal(next.retained.note, "unrelated state");
  assert.notEqual(next.careerEpisodes, original.careerEpisodes);
  assert.equal(next.careerEpisodes[0].status, "draft");
  assert.equal(next.careerEpisodes[0].version, 2);
  assert.equal(next.careerEpisodes[0].revisions[0].content.results, "断网后可以恢复");
  assert.equal(next.careerQa[0].status, "needs_review");
});

test("only a user action confirms personal facts; normal editing withdraws confirmation", () => {
  let state = upsertCareerEpisode({}, { title: "项目事件", myRole: "本人负责实现", status: "confirmed", confirmedBy: "user" });
  assert.equal(state.careerEpisodes[0].status, "draft");
  const id = state.careerEpisodes[0].id;
  state = upsertCareerEpisode(state, { id }, user);
  assert.equal(state.careerEpisodes[0].status, "confirmed");
  assert.equal(state.careerEpisodes[0].confirmedBy, "user");
  state = upsertCareerEpisode(state, { id, reason: "新补充的原因" }, { actor: "user", now: later });
  assert.equal(state.careerEpisodes[0].status, "draft");
  assert.equal(state.careerEpisodes[0].confirmedAt, "");
  state = upsertCareerEpisode(state, { id }, { ...user, now: later });
  assert.equal(state.careerEpisodes[0].status, "confirmed");
  assert.ok(state.careerEpisodes[0].revisions.some((revision) => revision.status === "confirmed"));
});

test("reviewed episode text survives AI proposals, which can be accepted or rejected explicitly", () => {
  const original = reviewedLibrary();
  const id = original.careerEpisodes[0].id;
  const proposed = upsertCareerEpisode(original, { id, myRole: "AI 推断本人主导全部工作", results: "AI 建议结果", status: "confirmed" }, agent);
  const record = proposed.careerEpisodes[0];
  assert.equal(record.myRole, original.careerEpisodes[0].myRole);
  assert.equal(record.status, "confirmed");
  assert.equal(record.pendingRevision.status, "draft");
  assert.equal(record.pendingRevision.content.myRole, "AI 推断本人主导全部工作");
  assert.equal(proposed.careerQa[0].status, "needs_review");
  assert.throws(() => applyCareerPendingRevision(proposed, "episodes", id, agent), /只有本人/);
  const kept = applyCareerPendingRevision(proposed, "episodes", id, { actor: "user", confirm: false, now: later });
  assert.equal(kept.careerEpisodes[0].myRole, original.careerEpisodes[0].myRole);
  assert.equal(kept.careerEpisodes[0].pendingRevision, null);
  assert.equal(kept.careerEpisodes[0].revisions.at(-1).reason, "rejected_proposal");
  const repeated = upsertCareerEpisode(kept, { id, myRole: "AI 推断本人主导全部工作", results: "AI 建议结果" }, agent);
  assert.equal(repeated.careerEpisodes[0].pendingRevision, null, "a rejected extraction does not keep returning unchanged");
  const adopted = applyCareerPendingRevision(proposed, "episodes", id, { ...user, now: later });
  assert.equal(adopted.careerEpisodes[0].myRole, "AI 推断本人主导全部工作");
  assert.equal(adopted.careerEpisodes[0].status, "confirmed");
  assert.equal(adopted.careerEpisodes[0].version, 2);
  assert.equal(adopted.careerEpisodes[0].pendingRevision, null);
});

test("a changed source invalidates direct and episode-linked confirmations without replacing reviewed material", () => {
  let state = reviewedLibrary();
  const sourceId = state.sourceMaterials[0].id;
  const episodeId = state.careerEpisodes[0].id;
  state = upsertCareerQa(state, { episodeId, question: "本人具体做了什么？", answer: "实现了日志恢复。", sourceIds: [] }, user);
  const changed = upsertCareerSource(state, { ...material, excerpt: "更新讨论：实际改为远端恢复。", fetchedAt: later }, agent);
  assert.equal(changed.sourceMaterials.length, 1);
  assert.equal(changed.sourceMaterials[0].excerpt, material.excerpt);
  assert.equal(changed.sourceMaterials[0].pendingRevision.content.excerpt, "更新讨论：实际改为远端恢复。");
  assert.equal(changed.careerEpisodes[0].status, "needs_review");
  assert.ok(changed.careerQa.every((qa) => qa.status === "needs_review"));
  assert.throws(() => upsertCareerEpisode(changed, { id: episodeId }, user), /先审核来源/);
  const repeated = upsertCareerSource(changed, { ...material, excerpt: "更新讨论：实际改为远端恢复。", fetchedAt: later }, agent);
  assert.equal(repeated.sourceMaterials[0].history.length, changed.sourceMaterials[0].history.length);
  assert.equal(repeated.careerEpisodes[0].revisions.length, changed.careerEpisodes[0].revisions.length);
  const accepted = applyCareerPendingRevision(changed, "sources", sourceId, { ...user, now: later });
  assert.equal(accepted.sourceMaterials[0].version, 2);
  assert.ok(accepted.sourceMaterials[0].history.some((item) => item.content.excerpt === material.excerpt));
  assert.equal(accepted.careerEpisodes[0].status, "needs_review");
});

test("identical reingestion cannot undo a user title or confirmation", () => {
  let state = upsertCareerSource({}, material, user);
  state = upsertCareerSource(state, { id: state.sourceMaterials[0].id, title: "本人整理的标题" }, user);
  const repeated = upsertCareerSource(state, { ...material, fetchedAt: later }, agent);
  assert.equal(repeated.sourceMaterials[0].title, "本人整理的标题");
  assert.equal(repeated.sourceMaterials[0].status, "confirmed");
  assert.equal(repeated.sourceMaterials[0].pendingRevision, null);
});

test("withdrawing source or episode confirmation invalidates dependent facts even without text changes", () => {
  let state = reviewedLibrary();
  const episodeId = state.careerEpisodes[0].id;
  state = upsertCareerQa(state, { episodeId, question: "只关联经历的回答", answer: "本人实际行动", sourceIds: [] }, user);
  for (const status of ["draft", "needs_review", "archived"]) {
    const source = upsertCareerSource(state, { id: state.sourceMaterials[0].id, status }, { actor: "user", now: later });
    assert.equal(source.careerEpisodes[0].status, "needs_review");
    assert.ok(source.careerQa.every((item) => item.status === "needs_review"));
    const episode = upsertCareerEpisode(state, { id: episodeId, status }, { actor: "user", now: later });
    assert.ok(episode.careerQa.every((item) => item.status === "needs_review"));
  }
});

test("AI answer suggestions stay separate from the person's answer and preserve revisions", () => {
  const state = reviewedLibrary();
  const qa = state.careerQa[0];
  const proposed = upsertCareerQa(state, { id: qa.id, answer: "AI 的新回答", status: "confirmed" }, agent);
  assert.equal(proposed.careerQa[0].answer, qa.answer);
  assert.equal(proposed.careerQa[0].draftAnswer, "AI 的新回答");
  const accepted = applyCareerPendingRevision(proposed, "qa", qa.id, user);
  assert.equal(accepted.careerQa[0].answer, qa.answer);
  assert.equal(accepted.careerQa[0].draftAnswer, "AI 的新回答");
  assert.equal(accepted.careerQa[0].status, "confirmed");
  assert.equal(accepted.careerQa[0].pendingRevision, null);
  assert.equal(accepted.careerQa[0].revisions.at(-1).content.answer, qa.answer);
  const fresh = upsertCareerQa({}, { question: "为什么？", answer: "模型推断" }, agent);
  assert.equal(fresh.careerQa[0].answer, "");
  assert.equal(fresh.careerQa[0].draftAnswer, "模型推断");
  assert.equal(fresh.careerQa[0].status, "draft");
  assert.throws(() => upsertCareerQa(fresh, { id: fresh.careerQa[0].id }, user), /实际回答/);
});

test("the same wording remains distinct across episodes and repeat extraction is idempotent", () => {
  let state = upsertCareerEpisode({}, { title: "项目 A 的选择" }, agent);
  state = upsertCareerEpisode(state, { title: "项目 B 的选择" }, agent);
  const [a, b] = state.careerEpisodes;
  const question = { category: "decision", question: "为什么选择这个方案？", draftAnswer: "建议答案" };
  state = upsertCareerQa(state, { ...question, episodeId: a.id }, agent);
  state = upsertCareerQa(state, { ...question, episodeId: b.id }, agent);
  state = upsertCareerQa(state, { ...question, episodeId: a.id }, agent);
  assert.equal(state.careerQa.length, 2);
  assert.notEqual(state.careerQa[0].id, state.careerQa[1].id);
  assert.equal(state.careerQa[0].version, 1);
  assert.equal(state.careerQa[0].revisions.length, 0);
});

test("dangling links are rejected and archive retains content without AI resurrection", () => {
  const state = reviewedLibrary();
  assert.throws(() => upsertCareerEpisode(state, { title: "错误来源", sourceIds: ["missing"] }, agent), /sourceIds/);
  assert.throws(() => upsertCareerQa(state, { question: "错误经历", episodeId: "missing" }, agent), /episodeId/);
  const id = state.careerEpisodes[0].id;
  const archived = upsertCareerEpisode(state, { id, status: "archived" }, { actor: "user", now: later });
  assert.equal(archived.careerEpisodes[0].status, "archived");
  assert.equal(archived.careerEpisodes[0].background, state.careerEpisodes[0].background);
  assert.equal(searchCareerLibrary(archived, { kind: "episodes" }).total, 0);
  assert.equal(searchCareerLibrary(archived, { kind: "episodes", status: "active" }).total, 0);
  assert.equal(searchCareerLibrary(archived, { kind: "episodes", id }).items[0].status, "archived");
  assert.equal(upsertCareerEpisode(archived, { id, results: "AI 重新采集" }, agent).careerEpisodes[0].status, "archived");
  assert.equal(archived.careerQa[0].status, "needs_review");
  const withdrawn = upsertCareerSource(state, { id: state.sourceMaterials[0].id, status: "archived" }, { actor: "user", now: later });
  assert.equal(withdrawn.careerEpisodes[0].status, "needs_review");
  assert.equal(withdrawn.careerQa[0].status, "needs_review");
  assert.throws(() => upsertCareerEpisode(withdrawn, { id }, user), /撤回状态/);
});

test("catalog queries are filtered, paginated and concise while exact reads retain private history", () => {
  let state = reviewedLibrary();
  const episodeId = state.careerEpisodes[0].id;
  for (let index = 0; index < 55; index++) state = upsertCareerQa(state, { episodeId, question: `经历追问 ${index}`, draftAnswer: "长答案".repeat(1000), sourceIds: state.careerEpisodes[0].sourceIds }, agent);
  const page = searchCareerLibrary(state, { kind: "qa", search: "经历追问", status: "active", limit: 500 });
  assert.equal(page.items.length, 50);
  assert.equal(page.total, 55);
  assert.equal(page.nextCursor, 50);
  assert.ok(page.items.every((item) => item.draftAnswer.length === 500 && !Object.hasOwn(item, "revisions")));
  const tail = searchCareerLibrary(state, { kind: "qa", search: "经历追问", cursor: page.nextCursor });
  assert.equal(tail.items.length, 5);
  assert.equal(tail.nextCursor, null);
  assert.equal(searchCareerLibrary(state, { kind: "qa", episodeId: "unrelated" }).total, 0);
  assert.equal(searchCareerLibrary(state, { kind: "qa", sourceId: "unrelated" }).total, 0);
  assert.equal(searchCareerLibrary(state, { kind: "qa", id: state.careerQa[1].id }).items[0].draftAnswer.length, 3000);
  assert.equal(searchCareerLibrary(state, { kind: "qa", id: "missing" }).total, 0);
});

test("legacy migration retains original data and every resume-version answer as unconfirmed material", () => {
  const original = freeze({ updatedAt: first, profile: { name: "真实候选人" },
    repos: [{ id: "repo-1", name: "个人项目", path: "https://github.example/me/project", summary: "旧项目简介", extra: { preserved: true } }],
    experiences: [{ id: "exp-1", company: "公司", role: "工程师", period: "2024–2026", achievements: ["旧成果"] }],
    resume: { versionId: "resume-1", candidateQuestions: [{ id: "qa-1", category: "decision", question: "为什么这样选？", answer: "当时的实际原因", status: "answered", sourceRefs: ["slack:thread-1"] }] },
    versions: [{ versionId: "resume-2", candidateQuestions: [{ id: "qa-1", question: "为什么这样选？", answer: "另一个版本的补充", status: "answered" }] }],
  });
  const migrated = migrateCareerLibrary(original);
  assert.deepEqual(migrated.repos, original.repos);
  assert.deepEqual(migrated.experiences, original.experiences);
  assert.deepEqual(migrated.resume, original.resume);
  assert.equal(migrated.careerEpisodes.length, 2);
  assert.equal(migrated.careerQa.length, 2);
  assert.ok(migrated.careerQa.every((item) => item.status === "draft" && !item.answer && item.draftAnswer && item.legacyRefs.length));
  assert.equal(migrated.careerQa[0].episodeId, "");
  assert.ok(migrated.careerEpisodes.every((item) => item.status === "draft" && item.tags.includes("待归档")));
  assert.deepEqual(migrateCareerLibrary(migrated), migrated);
  assert.equal(original.careerLibraryMigrationVersion, undefined);
});

test("demo data and sample records never become personal facts during migration", () => {
  const seed = { profile: { name: "林默", contact: "linmo@example.com · 上海" }, repos: [{ name: "示例项目", summary: "示例" }], resume: { candidateQuestions: [{ question: "示例追问", answer: "示例" }] } };
  assert.deepEqual(normalizeCareerLibrary(migrateCareerLibrary(seed)), { sourceMaterials: [], careerEpisodes: [], careerQa: [] });
  const samples = migrateCareerLibrary({ repos: [{ id: "sample", name: "Sample", summary: "Demo", sample: true }], experiences: [{ company: "Demo", role: "Demo", demo: true }], resume: { sample: true, candidateQuestions: [{ question: "Demo" }] } });
  assert.equal(samples.careerEpisodes.length, 0);
  assert.equal(samples.careerQa.length, 0);
});

test("legacy answer writes continue after migration and AI updates preserve a reviewed career answer", () => {
  const original = { profile: { name: "候选人" }, resume: { versionId: "r1", candidateQuestions: [{ id: "q1", category: "decision", question: "为什么选择？", answer: "旧简历里的回答", status: "answered" }] } };
  let state = migrateCareerLibrary(original);
  const id = state.careerQa[0].id;
  state = upsertCareerQa(state, { id, answer: "后来本人复核的真实原因", draftAnswer: "" }, user);
  state = { ...state, resume: { ...state.resume, candidateQuestions: [{ ...state.resume.candidateQuestions[0], answer: "AI 根据旧入口补的答案" }] } };
  const before = JSON.stringify(freeze(state));
  const synced = syncLegacyCareerQa(state, state.resume, { ...agent, questionId: "q1" });
  assert.equal(JSON.stringify(state), before);
  assert.equal(synced.careerQa.length, 1);
  assert.equal(synced.careerQa[0].answer, "后来本人复核的真实原因");
  assert.equal(synced.careerQa[0].draftAnswer, "AI 根据旧入口补的答案");
  assert.equal(synced.careerQa[0].pendingRevision.content.draftAnswer, "AI 根据旧入口补的答案");
  assert.equal(synced.resume.candidateQuestions[0].careerQaId, id);
  const repeated = syncLegacyCareerQa(synced, synced.resume, { ...agent, questionId: "q1" });
  assert.deepEqual(repeated.careerQa, synced.careerQa);
});

test("new resume versions reuse an immediate predecessor QA without replaying old answers", () => {
  const predecessor = { versionId: "r1", candidateQuestions: [{ id: "q1", category: "decision", question: "为什么选择？", relatedClaim: "某次方案选择", answer: "旧投影回答", status: "answered" }] };
  let state = migrateCareerLibrary({ resume: predecessor, versions: [predecessor] });
  const id = state.careerQa[0].id;
  state = upsertCareerQa(state, { id, answer: "库里重新审核的答案", draftAnswer: "" }, user);
  const resume = { versionId: "r2", candidateQuestions: [{ ...predecessor.candidateQuestions[0], id: "new-projection-id" }, { id: "q2", category: "impact", question: "最终结果如何？", answer: "AI 建议效果", status: "answered" }] };
  state = { ...state, resume, versions: [...state.versions, resume] };
  const synced = syncLegacyCareerQa(state, resume, { ...agent, predecessor });
  assert.equal(synced.careerQa.length, 2);
  assert.equal(synced.resume.candidateQuestions[0].careerQaId, id);
  assert.equal(synced.versions.at(-1).candidateQuestions[0].careerQaId, id);
  assert.equal(synced.careerQa[0].answer, "库里重新审核的答案");
  assert.equal(synced.careerQa[0].draftAnswer, "");
  assert.equal(synced.careerQa[0].pendingRevision, null);
  assert.equal(synced.careerQa[1].status, "draft");
  assert.equal(synced.careerQa[1].answer, "");
  assert.equal(synced.careerQa[1].draftAnswer, "AI 建议效果");
  assert.deepEqual(syncLegacyCareerQa(synced, synced.resume, agent), synced);
});

test("explicit legacy user answers can confirm while unrelated resumes retain separate QAs", () => {
  let state = { careerLibraryMigrationVersion: 1, resume: { versionId: "r1", candidateQuestions: [{ id: "q1", question: "为什么选择？", answer: "本人补充的原因", status: "answered", sourceRefs: ["slack:thread-real-reference"] }] } };
  state = syncLegacyCareerQa(state, state.resume, { ...user, questionId: "q1" });
  const firstId = state.careerQa[0].id;
  assert.equal(state.careerQa[0].status, "confirmed");
  assert.equal(state.careerQa[0].answer, "本人补充的原因");
  assert.equal(state.careerQa[0].draftAnswer, "");
  assert.ok(state.careerQa[0].sourceIds.every((id) => state.sourceMaterials.some((item) => item.id === id)));
  const next = { versionId: "unrelated", candidateQuestions: [{ id: "q1", question: "为什么选择？", answer: "另一段经历原因", status: "answered" }] };
  state = syncLegacyCareerQa({ ...state, resume: next }, next, agent);
  assert.equal(state.careerQa.length, 2);
  assert.notEqual(state.resume.candidateQuestions[0].careerQaId, firstId);
  assert.equal(state.careerQa[1].status, "draft");
  const malformed = { ...next, candidateQuestions: [{ ...next.candidateQuestions[0], careerQaId: "missing" }] };
  assert.throws(() => syncLegacyCareerQa({ ...state, resume: malformed }, malformed, agent), /不存在/);
  assert.throws(() => syncLegacyCareerQa(state, next, { ...agent, questionId: "missing" }), /不存在/);
  assert.equal(syncLegacyCareerQa({ demo: true }, next, agent).careerQa.length, 0);
});

test("generated prompts omitted by the resume carry-over window are still stored in the career library", () => {
  const incoming = Array.from({ length: 12 }, (_, index) => ({ id: `q${index}`, question: `新生成的问题 ${index}`, category: "context" }));
  const resume = { versionId: "r1", candidateQuestions: incoming.slice(0, 8) };
  const synced = syncLegacyCareerQa({ resume, careerLibraryMigrationVersion: 1 }, resume, { ...agent, additionalQuestions: incoming });
  assert.equal(synced.resume.candidateQuestions.length, 8);
  assert.equal(synced.careerQa.length, 12);
  assert.ok(synced.resume.candidateQuestions.every((item) => item.careerQaId));
  assert.deepEqual(syncLegacyCareerQa(synced, synced.resume, { ...agent, additionalQuestions: incoming }), synced);
  assert.throws(() => syncLegacyCareerQa({ resume: { candidateQuestions: incoming } }, { candidateQuestions: incoming }, agent), /稳定 ID/);
});

test("normalization is deterministic and a full history fails before losing any old revision", () => {
  const input = { sourceMaterials: [{ ...material }], careerEpisodes: [{ title: "事件", actions: ["行动", "行动"] }], careerQa: [{ question: "追问", episodeId: "legacy" }] };
  assert.deepEqual(normalizeCareerLibrary(input), normalizeCareerLibrary(input));
  let state = upsertCareerEpisode({}, { title: "持续维护的事件" }, agent);
  const id = state.careerEpisodes[0].id;
  for (let index = 0; index < 40; index++) state = upsertCareerEpisode(state, { id, results: `第 ${index} 次结果` }, { actor: "user", now: later });
  freeze(state);
  const saved = JSON.stringify(state);
  assert.throws(() => upsertCareerEpisode(state, { id, results: "不能覆盖的下一次修订" }, { actor: "user", now: later }), /40 次修订/);
  assert.equal(JSON.stringify(state), saved);
  assert.equal(state.careerEpisodes.length, 1);
  assert.equal(state.careerEpisodes[0].revisions.length, 40);
  assert.equal(state.careerEpisodes[0].version, 41);
});

test("large revision histories fail in the pure model before exceeding a single project shard", () => {
  let state = upsertCareerSource({}, { ...material, excerpt: "原始中文材料".repeat(2500).slice(0, 16000) }, { actor: "user", now: first });
  const id = state.sourceMaterials[0].id;
  let failure;
  for (let index = 0; index < 20; index++) {
    freeze(state);
    const previous = JSON.stringify(state);
    try {
      state = upsertCareerSource(state, { id, excerpt: `${index}次材料`.repeat(4000).slice(0, 16000) }, { actor: "user", now: later });
      assert.ok(Buffer.byteLength(JSON.stringify(state.sourceMaterials[0])) <= CAREER_RECORD_MAX_BYTES);
    } catch (error) {
      failure = error;
      assert.equal(JSON.stringify(state), previous);
      break;
    }
  }
  assert.match(failure?.message || "", /单记录安全容量/);
  assert.ok(state.sourceMaterials[0].history.length > 0);
});
