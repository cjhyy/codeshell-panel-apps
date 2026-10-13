import test from "node:test";
import assert from "node:assert/strict";
import { readCareerUpdate, careerUpdatePreviewToken } from "../../../apps/job-hunt-hq/app/career-update-io.mjs";
import { createCareerLibrarySnapshot } from "../../../apps/job-hunt-hq/app/career-library-version-model.mjs";

const path = "career-data/updates/session.json";
const document = { format: "codeshell.career-update", schemaVersion: 1,
  version: { id: "career-version-io", title: "一次聊天的交接" }, sources: [], episodes: [],
  qa: [{ id: "career-qa-io", question: "为什么？", answer: "本人回答" }] };
function fixture() {
  let active = true, calls = 0;
  const scope = { check() { if (!active) throw Error("project changed"); }, async call(method, args) {
    calls++; assert.equal(method, "workspace.readText"); assert.equal(args.path, path);
    return { content: JSON.stringify(document) };
  } };
  return { scope, deactivate() { active = false; }, get calls() { return calls; } };
}

test("JSON intake reads only the bounded update directory and rejects incomplete text", async () => {
  const host = fixture();
  for (const invalid of ["job-hunt-panel.json", "career-data/updates/../panel.json", "/career-data/updates/session.json", "career-data/updates/sub/session.json", "career-data/updates/a.json?x"]) await assert.rejects(readCareerUpdate(invalid, host), /更新文件/);
  assert.equal(host.calls, 0);
  const artifact = await readCareerUpdate(path, host);
  assert.equal(artifact.document.qa[0].answer, "本人回答"); assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(readCareerUpdate(path, { scope: { check() {}, async call() { return { truncated: true, content: JSON.stringify(document) }; } } }), /完整读取/);
});

test("JSON preview tokens bind exact bytes, every library field, versions and project", async () => {
  const artifact = await readCareerUpdate(path, fixture());
  const current = { ...createCareerLibrarySnapshot({}), careerLibraryVersions: [] };
  const token = await careerUpdatePreviewToken(artifact, current, "project-a");
  assert.equal(await careerUpdatePreviewToken(artifact, structuredClone(current), "project-a"), token);
  for (const [nextArtifact, nextState, projectKey] of [
    [{ ...artifact, sha256: "a".repeat(64) }, current, "project-a"],
    [artifact, { ...current, careerQa: [{ id: "q", answer: "新事实" }] }, "project-a"],
    [artifact, { ...current, careerLibraryVersions: [{ id: "saved" }] }, "project-a"],
    [artifact, current, "project-b"],
  ]) assert.notEqual(await careerUpdatePreviewToken(nextArtifact, nextState, projectKey), token);
});

test("JSON intake checks project scope again after asynchronous file reads", async () => {
  const host = fixture();
  host.scope.call = async () => { host.deactivate(); return { content: JSON.stringify(document) }; };
  await assert.rejects(readCareerUpdate(path, host), /project changed/);
});

test("Host byte revisions preserve BOM changes that are absent from decoded text", async () => {
  const host = fixture();
  host.scope.call = async () => ({ content: JSON.stringify(document), revision: `sha256:${"a".repeat(64)}` });
  const before = await readCareerUpdate(path, host);
  host.scope.call = async () => ({ content: JSON.stringify(document), revision: `sha256:${"b".repeat(64)}` });
  const after = await readCareerUpdate(path, host);
  assert.equal(before.sha256, "a".repeat(64)); assert.equal(after.sha256, "b".repeat(64));
  host.scope.call = async () => ({ content: JSON.stringify(document), size: 128 * 1024 + 1 });
  await assert.rejects(readCareerUpdate(path, host), /128 KiB/);
});
