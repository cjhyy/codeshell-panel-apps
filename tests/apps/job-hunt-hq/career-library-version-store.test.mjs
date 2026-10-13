import test from "node:test";
import assert from "node:assert/strict";
import { createCareerLibrarySnapshot, prepareCareerLibraryVersion } from "../../../apps/job-hunt-hq/app/career-library-version-model.mjs";
import { readCareerLibraryVersion, writeCareerLibraryVersion } from "../../../apps/job-hunt-hq/app/career-library-version-store.mjs";

function fixture() {
  const files = new Map();
  let active = true, failAt = "";
  const scope = { check() { if (!active) throw Error("project switched"); }, async call(method, args) {
    scope.check();
    if (args.path === failAt) throw Error("disk unavailable");
    if (method === "workspace.readText") { if (!files.has(args.path)) throw Error("ENOENT"); return { content: files.get(args.path) }; }
    assert.equal(method, "workspace.writeText"); assert.equal(args.expectedModifiedAt, null);
    if (files.has(args.path)) throw Error("already exists");
    files.set(args.path, args.content); return {};
  } };
  return { files, scope, deactivate() { active = false; }, fail(path) { failAt = path; } };
}
const metadata = { id: "career-version-test", title: "一次聊天的整理", summary: "保留本人原话与待核对内容", createdAt: "2026-10-12T00:00:00Z", sessionId: "test-session", updateSha256: "a".repeat(64) };
function largeSnapshot() {
  return createCareerLibrarySnapshot({
    sourceMaterials: Array.from({ length: 30 }, (_, n) => ({ id: `s-${n}`, provider: "manual", excerpt: "真实材料".repeat(3000), status: "draft", history: [] })),
    careerEpisodes: [{ id: "episode", title: "异步决策", reason: "让任务与窗口独立", sourceIds: ["s-0"], status: "confirmed", pendingRevision: { content: { reason: "后续讨论的理由" } } }],
    careerQa: [{ id: "qa", question: "为什么？", answer: "本人聊天原话", draftAnswer: "AI表达", status: "draft" }],
    resume: { markdown: "PUBLIC RESUME IS NOT THE LIBRARY" },
  });
}

test("saved chat versions reopen exact facts and pending text after live records change", async () => {
  const host = fixture(), source = largeSnapshot();
  const { version, snapshot } = prepareCareerLibraryVersion(source, metadata);
  const saved = await writeCareerLibraryVersion(version, snapshot, host);
  assert.ok(host.files.size > 1, "large library must use immutable shards");
  const current = structuredClone(source); current.careerQa[0].answer = "后来的回答"; current.careerEpisodes[0].status = "archived";
  const historical = await readCareerLibraryVersion(saved, host);
  assert.equal(historical.snapshot.careerQa[0].answer, "本人聊天原话");
  assert.equal(historical.snapshot.careerEpisodes[0].pendingRevision.content.reason, "后续讨论的理由");
  assert.equal(historical.snapshot.resume, undefined);
  assert.match(saved.sha256, /^[0-9a-f]{64}$/);
  assert.equal(historical.version.updateSha256, metadata.updateSha256);
  await assert.rejects(writeCareerLibraryVersion(version, snapshot, host), /already exists/);
  assert.deepEqual((await readCareerLibraryVersion(saved, host)).snapshot, source);
});

test("a partial version write is not a completed version and cannot replace existing history", async () => {
  const host = fixture(); const prepared = prepareCareerLibraryVersion(largeSnapshot(), metadata);
  host.fail(prepared.version.path);
  await assert.rejects(writeCareerLibraryVersion(prepared.version, prepared.snapshot, host), /disk unavailable/);
  assert.equal(host.files.has(prepared.version.path), false);
  assert.equal(host.files.has("job-hunt-panel.json"), false);
});

test("changed history content and changed project scope fail closed", async () => {
  const host = fixture(); const prepared = prepareCareerLibraryVersion({ careerQa: [{ id: "q", question: "为何？", answer: "原话" }] }, metadata);
  const saved = await writeCareerLibraryVersion(prepared.version, prepared.snapshot, host);
  await assert.rejects(readCareerLibraryVersion({ ...saved, updateSha256: "b".repeat(64) }, host), /清单无效/);
  const manifest = JSON.parse(host.files.get(saved.path)); manifest.root.careerQa[0].answer = "被篡改"; host.files.set(saved.path, JSON.stringify(manifest));
  await assert.rejects(readCareerLibraryVersion(saved, host), /校验失败/);
  host.deactivate(); await assert.rejects(readCareerLibraryVersion(saved, host), /project switched/);
});
