import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { cp, readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createNodeWorkspaceScope } from "../../../apps/job-hunt-hq/app/tools/node-workspace-scope.mjs";
import { hydrateProjectSnapshotDocuments, prepareProjectSnapshotDocuments, projectSnapshotShardDescriptors } from "../../../apps/job-hunt-hq/app/snapshot-sharding-model.mjs";
import { writeProjectSnapshotDocuments } from "../../../apps/job-hunt-hq/app/snapshot-storage.mjs";
import { normalizeResumeRecord } from "../../../apps/job-hunt-hq/app/resume-model.mjs";
import { candidateInput, cli, fileInventory, normalizeInvocation, resumeInput, run, snapshotPath, tempProject } from "./fixtures/headless-runtime.mjs";

const root = fileURLToPath(new URL("../../../apps/job-hunt-hq/app/", import.meta.url));
let browser, server, url;
before(async () => {
  server = createServer(async (request, response) => {
    const path = resolve(root, "." + new URL(request.url, "http://localhost").pathname.replace(/\/$/, "/index.html"));
    if (!path.startsWith(root.replace(/\/$/, "") + sep)) return response.writeHead(403).end();
    try {
      response.writeHead(200, { "Content-Type": ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" })[extname(path)] || "application/octet-stream" });
      response.end(await readFile(path));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise(done => server.close(done));
});

async function readSnapshot(project) {
  const root = JSON.parse(await readFile(join(project, snapshotPath), "utf8"));
  const documents = new Map();
  for (const descriptor of projectSnapshotShardDescriptors(root)) documents.set(descriptor.path, JSON.parse(await readFile(join(project, descriptor.path), "utf8")));
  const hydrated = hydrateProjectSnapshotDocuments(root, documents);
  // The index identifies physical immutable files; it is not business data.
  // Both paths are asserted to use shards below, while their generation names,
  // lengths and invocation metadata naturally differ.
  delete hydrated.artifactStorage;
  return hydrated;
}

async function panel(t, project) {
  const scope = await createNodeWorkspaceScope(project);
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route("**/*", route => route.request().url().startsWith(url + "/") ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  const host = { failWrites: false, calls: [], storage: new Map() };
  const storageSnapshot = key => {
    if (!host.storage.has(key)) return { exists: false, value: null, revision: null };
    const value = structuredClone(host.storage.get(key));
    return { exists: true, value, revision: "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex") };
  };
  await page.exposeFunction("__hostCall", async (method, params = {}) => {
    host.calls.push({ method, params: structuredClone(params) });
    if (method === "storage.getSnapshot") return storageSnapshot(params.key);
    if (method === "storage.compareAndSet") {
      const updated = storageSnapshot(params.key).revision === params.expectedRevision;
      if (updated) host.storage.set(params.key, structuredClone(params.value));
      return { updated, snapshot: storageSnapshot(params.key) };
    }
    if (method === "workspace.writeText" && host.failWrites) throw new Error("fixture write unavailable");
    if (method.startsWith("workspace.")) return scope.call(method, params);
    throw new Error(`Unexpected Host method: ${method}`);
  });
  await page.addInitScript(project => {
    const tools = {};
    const context = { cwd: project, sessionId: "fixture-session", trusted: true, busy: false, availableMethods: ["storage.getSnapshot", "storage.compareAndSet", "workspace.info", "workspace.list", "workspace.readText", "workspace.writeText"], projectScope: { version: 1, environmentId: "fixture", projectId: "fixture-project", rootId: "fixture-root" } };
    window.__headless = { tools, context };
    window.codeshellPanel = {
      getContext: async () => context,
      on() {},
      registerTool(name, handler) { tools[name] = handler; },
      call(method, params) { return window.__hostCall(method, params); },
    };
  }, project);
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector(".app-shell").inert && document.querySelector("#draft-storage-status").textContent !== "正在连接草稿存储…", { timeout: 20000 });
  return { page, host };
}
const invoke = (page, name, args) => page.evaluate(({ name, args }) => window.__headless.tools[name](args), { name, args });

for (const sharded of [false, true]) test(`registered Panel Tools and standalone CLI persist the same ${sharded ? "sharded" : "direct"} resume workflow`, async t => {
  const panelProject = await tempProject(t), cliProject = await tempProject(t);
  await cli(["init", "--project", panelProject]);
  if (sharded) {
    const scope = await createNodeWorkspaceScope(panelProject);
    const previousSnapshot = await scope.call("workspace.readText", { path: snapshotPath });
    const versions = Array.from({ length: 18 }, (_, index) => normalizeResumeRecord({
      versionId: `history-fixture-${index}`, title: `Historical fixture ${index}`,
      kind: "base", category: `Historical category ${index}`,
      markdown: "# Historical fixture\n\n## Experience\n\n- " + "Historical public fixture detail. ".repeat(800),
      updatedAt: "2025-01-01T00:00:00Z",
    }));
    const prepared = prepareProjectSnapshotDocuments({ ...JSON.parse(previousSnapshot.content), versions });
    assert.ok(prepared.shards.length > 1, "fixture must use actual shard files");
    await writeProjectSnapshotDocuments(prepared, { scope, previousSnapshot });
  }
  await cp(panelProject, cliProject, { recursive: true });
  const { page, host } = await panel(t, panelProject);
  for (const [name, args] of [["save_candidate_context", candidateInput], ["save_resume_draft", resumeInput]]) {
    const panelResult = await invoke(page, name, args);
    const cliResult = (await run(cliProject, name, args)).json;
    assert.equal(panelResult.projectSaved, true);
    assert.equal(cliResult.ok, true);
    if (sharded) for (const project of [panelProject, cliProject]) {
      assert.ok(JSON.parse(await readFile(join(project, snapshotPath), "utf8")).artifactStorage.shards.length > 1);
    }
    assert.deepEqual(normalizeInvocation(await readSnapshot(panelProject)), normalizeInvocation(await readSnapshot(cliProject)), name);
  }
  const panelBefore = await readSnapshot(panelProject), cliBefore = await readSnapshot(cliProject);
  assert.equal(panelBefore.resume.source, "panel");
  assert.equal(cliBefore.resume.source, "cli");
  assert.equal(panelBefore.resume.sessionId, "fixture-session");
  assert.equal(cliBefore.resume.sessionId, "fixture-session");
  const args = resume_id => ({ resume_id, question_id: "qa-decision", status: "answered", answer: "I chose immutable files to preserve concurrent readers.", source_refs: ["user:resume-qa:qa-decision"], suggested_change: "Candidate confirmed an immutable generation design." });
  await invoke(page, "save_resume_qa_answer", args(panelBefore.resume.versionId));
  await run(cliProject, "save_resume_qa_answer", args(cliBefore.resume.versionId));
  const panelAfter = await readSnapshot(panelProject), cliAfter = await readSnapshot(cliProject);
  assert.deepEqual(normalizeInvocation(panelAfter), normalizeInvocation(cliAfter), "QA answer equality includes private facts, evidence and current version references");
  assert.equal(panelAfter.resume.markdown, panelBefore.resume.markdown, "private answers do not silently rewrite the public resume");
  assert.equal(panelAfter.resume.candidateQuestions.find(item => item.id === "qa-decision").category, "decision");

  const revision = { ...resumeInput, title: "Fixture Revised Base Resume" };
  await invoke(page, "save_resume_draft", revision);
  await run(cliProject, "save_resume_draft", revision);
  const panelRevised = await readSnapshot(panelProject), cliRevised = await readSnapshot(cliProject);
  assert.deepEqual(normalizeInvocation(panelRevised), normalizeInvocation(cliRevised), "archived versions and lineage remain equal after another generation");
  assert.notEqual(panelRevised.resume.versionId, panelAfter.resume.versionId);
  assert.equal(panelRevised.resume.parentVersionId, panelAfter.resume.versionId);
  assert.ok(panelRevised.versions.some(record => record.versionId === panelAfter.resume.versionId));
  assert.equal(panelRevised.resume.candidateQuestions.find(item => item.id === "qa-decision").answer, args("").answer, "a new draft retains the candidate's confirmed answer");

  const beforeRead = await fileInventory(panelProject), priorWrites = host.calls.filter(item => item.method === "workspace.writeText").length;
  const panelRead = await invoke(page, "get_job_search_context", { scope: "candidate" });
  const cliRead = (await run(panelProject, "get_job_search_context", { scope: "candidate" })).json.result;
  const { project: cliMetadata, ...cliContext } = cliRead;
  const { project: panelMetadata, ...panelContext } = panelRead;
  assert.equal(cliMetadata.hasSnapshot, true);
  assert.equal(panelMetadata.hasSnapshot, true);
  assert.equal(Object.hasOwn(panelMetadata, "snapshotSemanticKey"), false, "private comparison bytes must not inflate bounded context reads");
  assert.deepEqual(cliContext, panelContext, "read-only context parity includes selections, policies and pagination; adapter project status is separate metadata");
  assert.deepEqual(await fileInventory(panelProject), beforeRead);
  assert.equal(host.calls.filter(item => item.method === "workspace.writeText").length, priorWrites);
});

test("CLI updates reload a clean Panel and preserve a dirty Panel through conflict", async t => {
  const project = await tempProject(t);
  await cli(["init", "--project", project]);
  await run(project, "save_candidate_context", candidateInput);
  await run(project, "save_resume_draft", resumeInput);
  const { page, host } = await panel(t, project);
  const updatedCandidate = { ...candidateInput, profile: { ...candidateInput.profile, name: "Externally Updated Candidate" } };
  await run(project, "save_candidate_context", updatedCandidate);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => document.querySelector("#profile-name").value === "Externally Updated Candidate");
  assert.equal((await invoke(page, "get_job_search_context", { scope: "candidate" })).profile.name, "Externally Updated Candidate");

  host.failWrites = true;
  await page.evaluate(() => {
    const editor = document.querySelector("#resume-editor");
    editor.value = "# Private unsaved local edit\n\nThis text must remain recoverable.";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector("#project-snapshot-error").textContent.includes("fixture write unavailable"));
  const winner = { ...candidateInput, profile: { ...candidateInput.profile, name: "CLI Winner" } };
  await run(project, "save_candidate_context", winner);
  const committed = await readFile(join(project, snapshotPath), "utf8");
  host.failWrites = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => document.querySelector("#project-snapshot-state").textContent.includes("发现外部更新"));
  assert.match(await page.locator("#resume-editor").inputValue(), /Private unsaved local edit/);
  await page.locator('.side-nav [data-view-target="materials"]').click();
  await page.locator('[data-data-workspace="sync"]').click();
  await page.evaluate(() => { document.querySelector("#project-details").open = true; });
  await page.locator("#save-project-snapshot").click();
  await page.locator("#toast").filter({ hasText: "仍未能写入项目" }).waitFor();
  await page.waitForFunction(() => document.querySelector("#project-snapshot-state").textContent.includes("发现外部更新"));
  assert.equal(await readFile(join(project, snapshotPath), "utf8"), committed);
  assert.equal((await readSnapshot(project)).profile.name, "CLI Winner");
});


for (const sharded of [false, true]) test(`career library Tools and CLI preserve the same ${sharded ? "sharded" : "direct"} facts, immutable versions and legacy resume state`, async t => {
  const panelProject = await tempProject(t), cliProject = await tempProject(t);
  await cli(["init", "--project", panelProject]);
  await run(panelProject, "save_candidate_context", candidateInput);
  await run(panelProject, "save_resume_draft", resumeInput);
  if (sharded) {
    const scope = await createNodeWorkspaceScope(panelProject);
    const previousSnapshot = await scope.call("workspace.readText", { path: snapshotPath });
    const root = await readSnapshot(panelProject);
    root.jobResearch = Array.from({ length: 30 }, (_, index) => ({ id: `unrelated-research-${index}`, report: "Preserved unrelated research. ".repeat(1600) }));
    const prepared = prepareProjectSnapshotDocuments(root);
    assert.ok(prepared.shards.length > 1);
    await writeProjectSnapshotDocuments(prepared, { scope, previousSnapshot });
  }
  await cp(panelProject, cliProject, { recursive: true });
  const original = await readSnapshot(panelProject);
  const { page } = await panel(t, panelProject);
  const facts = [
    { source: { id: "career-source-parity", provider: "slack", connectionId: "synthetic-connection", externalId: "synthetic-thread", title: "Synthetic source", excerpt: "Private synthetic source text." }, confirmation: "I confirm this synthetic source." },
    { episode: { id: "career-episode-parity", title: "Synthetic decision", decision: "Use immutable files", reason: "Protect readers", tradeoffs: "Extra files", sourceIds: ["career-source-parity"] }, confirmation: "I confirm this synthetic experience." },
    { qa: { id: "career-qa-parity", episodeId: "career-episode-parity", category: "decision", question: "Why immutable files?", answer: "My factual decision was to protect concurrent readers.", draftAnswer: "An independently editable expression.", sourceIds: ["career-source-parity"] }, confirmation: "I confirm this actual synthetic answer." },
  ];
  const equalState = async label => {
    const left = normalizeInvocation(await readSnapshot(panelProject));
    const right = normalizeInvocation(await readSnapshot(cliProject));
    // Integrity hashes cover timestamps. Both histories are verified by the
    // historical read below; equality here compares their complete domain data.
    for (const state of [left, right]) for (const version of state.careerLibraryVersions) delete version.sha256;
    assert.deepEqual(left, right, label);
    assert.equal(left.resume.markdown, original.resume.markdown, "private career changes never rewrite the public resume");
    assert.deepEqual(left.jobResearch, original.jobResearch, "unrelated shards survive every adapter write");
    if (sharded) for (const project of [panelProject, cliProject]) assert.ok(JSON.parse(await readFile(join(project, snapshotPath), "utf8")).artifactStorage.shards.length > 1);
  };
  for (const input of facts) {
    const tool = await invoke(page, "save_candidate_context", input);
    const command = (await run(cliProject, "save_candidate_context", input)).json;
    assert.equal(tool.projectSaved, true); assert.equal(command.ok, true);
    await equalState(Object.keys(input)[0]);
  }
  const beforePreview = await Promise.all([fileInventory(panelProject), fileInventory(cliProject)]);
  const previewInput = { library_version: { action: "preview" } };
  const toolPreview = await invoke(page, "save_candidate_context", previewInput);
  const cliPreview = (await run(cliProject, "save_candidate_context", previewInput)).json.result;
  assert.equal(toolPreview.preview, true); assert.equal(cliPreview.preview, true);
  assert.deepEqual(toolPreview.counts, cliPreview.counts);
  assert.deepEqual(await Promise.all([fileInventory(panelProject), fileInventory(cliProject)]), beforePreview, "version previews are byte-for-byte read-only");
  const versionInput = { library_version: { action: "save", id: "career-version-parity", title: "Synthetic conversational version" } };
  await invoke(page, "save_candidate_context", versionInput);
  await run(cliProject, "save_candidate_context", versionInput);
  await equalState("immutable named version");
  const historicalInput = { scope: "career_qa", qa_id: "career-qa-parity", version_id: "career-version-parity" };
  const toolHistory = await invoke(page, "get_job_search_context", historicalInput);
  const cliHistory = (await run(cliProject, "get_job_search_context", historicalInput)).json.result;
  assert.equal(toolHistory.historical, true); assert.equal(cliHistory.historical, true);
  assert.deepEqual(normalizeInvocation(toolHistory.careerQa), normalizeInvocation(cliHistory.careerQa));
  assert.equal(toolHistory.careerQa.items[0].answer, facts[2].qa.answer);

  const updatePath = "career-data/updates/parity.json";
  const update = { format: "codeshell.career-update", schemaVersion: 1,
    version: { id: "career-version-batch-parity", title: "Second synthetic discussion" }, sources: [], episodes: [],
    qa: [{ id: "career-qa-batch", question: "What remains unknown?", answer: "We have no measured production result.", draftAnswer: "An AI expression is not factual confirmation." }],
  };
  for (const project of [panelProject, cliProject]) {
    await mkdir(join(project, "career-data/updates"), { recursive: true });
    await writeFile(join(project, updatePath), JSON.stringify(update));
  }
  const beforeBatchPreview = await Promise.all([fileInventory(panelProject), fileInventory(cliProject)]);
  const batchInput = { career_update: { action: "preview", path: updatePath } };
  const toolBatch = await invoke(page, "save_candidate_context", batchInput);
  const cliBatch = (await run(cliProject, "save_candidate_context", batchInput)).json.result;
  assert.deepEqual(await Promise.all([fileInventory(panelProject), fileInventory(cliProject)]), beforeBatchPreview);
  await invoke(page, "save_candidate_context", { career_update: { action: "apply", path: updatePath, preview_token: toolBatch.preview_token } });
  await run(cliProject, "save_candidate_context", { career_update: { action: "apply", path: updatePath, preview_token: cliBatch.preview_token } });
  await equalState("JSON batch apply with version");
  const afterApply = await Promise.all([fileInventory(panelProject), fileInventory(cliProject)]);
  await invoke(page, "save_candidate_context", { career_update: { action: "apply", path: updatePath, preview_token: toolBatch.preview_token } });
  await run(cliProject, "save_candidate_context", { career_update: { action: "apply", path: updatePath, preview_token: cliBatch.preview_token } });
  assert.deepEqual(await Promise.all([fileInventory(panelProject), fileInventory(cliProject)]), afterApply, "successful apply replay never overwrites subsequent edits");

  const legacy = { ...candidateInput, profile: { ...candidateInput.profile, name: "Compatible complete candidate update" } };
  await invoke(page, "save_candidate_context", legacy);
  await run(cliProject, "save_candidate_context", legacy);
  await equalState("legacy complete candidate still preserves career library");
  const saved = await readSnapshot(cliProject);
  assert.equal(saved.careerQa.find(item => item.id === "career-qa-batch").status, "draft");
  assert.equal(saved.careerLibraryVersions.length, 2);
});

test("external CLI career facts reload a clean Panel but never overwrite an unsaved career editor", async t => {
  const project = await tempProject(t);
  await cli(["init", "--project", project]);
  const { page } = await panel(t, project);
  const source = { id: "career-source-external", provider: "manual", title: "External synthetic source", excerpt: "First durable fact." };
  await run(project, "save_candidate_context", { source });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator('[data-career-record="career-source-external"]').waitFor();
  const loaded = await invoke(page, "get_job_search_context", { scope: "career_sources", source_id: source.id });
  assert.equal(loaded.sourceMaterials.items[0].excerpt, source.excerpt);
  await page.locator('[data-career-record="career-source-external"]').click();
  await page.locator('[data-career-field="excerpt"]').fill("Unsaved private editor text must remain recoverable.");
  await run(project, "save_candidate_context", { source: { ...source, excerpt: "A competing CLI fact wins on disk." } });
  const winner = await fileInventory(project);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => document.querySelector("#project-snapshot-state").textContent.includes("发现外部更新"));
  assert.equal(await page.locator('[data-career-field="excerpt"]').inputValue(), "Unsaved private editor text must remain recoverable.");
  await page.locator('[data-career-action="save"]').click();
  await page.locator("#career-message").filter({ hasText: "保存失败" }).waitFor();
  assert.deepEqual(await fileInventory(project), winner, "the stale Panel cannot replace the CLI winner or its shards");
});

test("opening a migrated library and saving unrelated Tool or manual records preserves original oversized facts and extensions", async t => {
  const project = await tempProject(t);
  await cli(["init", "--project", project]);
  const scope = await createNodeWorkspaceScope(project);
  const previousSnapshot = await scope.call("workspace.readText", { path: snapshotPath });
  const originalSource = { id: "career-source-older-extended", provider: "manual", title: "Older raw source",
    excerpt: "Original long fact. ".repeat(1000), extension: { owner: "an-older-importer", verbatim: "Preserve this extension exactly." },
  };
  const prepared = prepareProjectSnapshotDocuments({ ...JSON.parse(previousSnapshot.content), careerLibraryMigrationVersion: 1, sourceMaterials: [originalSource] });
  await writeProjectSnapshotDocuments(prepared, { scope, previousSnapshot });
  const { page } = await panel(t, project);
  await invoke(page, "save_candidate_context", candidateInput);
  assert.deepEqual((await readSnapshot(project)).sourceMaterials, [originalSource]);
  await page.locator("#career-add").click();
  await page.locator('[data-career-field="title"]').fill("New manual synthetic source");
  await page.locator('[data-career-field="excerpt"]').fill("A separate new fact must not truncate older data.");
  await page.locator('[data-career-action="save"]').click();
  await page.locator("#career-message").filter({ hasText: "已保存" }).waitFor();
  assert.deepEqual((await readSnapshot(project)).sourceMaterials.find(item => item.id === originalSource.id), originalSource);
});

test("Tool and CLI reject schema-valid astral facts that exceed storage capacity without changing any project bytes", async t => {
  const project = await tempProject(t);
  await cli(["init", "--project", project]);
  const { page } = await panel(t, project);
  const input = { source: { provider: "manual", excerpt: "😀".repeat(8001) } };
  const before = await fileInventory(project);
  await assert.rejects(invoke(page, "save_candidate_context", input), /超过/);
  const command = await run(project, "save_candidate_context", input, { expectedExit: 2 });
  assert.match(command.json.error.message, /超过/);
  assert.deepEqual(await fileInventory(project), before);
});

for (const sharded of [false, true]) test(`shared job research CLI/Panel parity and evidence UI (${sharded ? "sharded" : "direct"})`, async t => {
  const { jobInput, researchInput, ctx } = await import("./fixtures/job-research-data.mjs");
  const { prepareJobOpportunities, saveJobResearch } = await import("../../../apps/job-hunt-hq/app/ops/jobs.mjs");
  const panelProject = await tempProject(t), cliProject = await tempProject(t);
  await cli(["init", "--project", panelProject]);
  const scope = await createNodeWorkspaceScope(panelProject);
  const previousSnapshot = await scope.call("workspace.readText", { path: snapshotPath });
  let snapshot = prepareJobOpportunities(JSON.parse(previousSnapshot.content), { jobs: [jobInput] }, ctx).snapshot;
  snapshot.jobs[0].status = "saved";
  snapshot.jobs[0].verification = { state: "verified_live", lastCheckedAt: ctx.now, checkedUrl: "https://example.invalid/jobs/1", sourceKind: "official", method: "browser-visible", evidenceExcerpt: "We are hiring TypeScript engineers." };
  snapshot.jobs[0].changeLog = [{ at: ctx.now, fields: ["description"], via: "save" }];
  snapshot.jobs[0].exclusion = { reasonCode: "location", note: "夹具排除标记" };
  snapshot = saveJobResearch(snapshot, researchInput, ctx).snapshot;
  if (sharded) snapshot.versions = Array.from({ length: 18 }, (_, index) => normalizeResumeRecord({ versionId: `history-jobs-${index}`, title: `History ${index}`, kind: "base", category: `History ${index}`, markdown: "# History\n\n" + "Public fixture evidence. ".repeat(900), updatedAt: "2025-01-01T00:00:00Z" }));
  await writeProjectSnapshotDocuments(prepareProjectSnapshotDocuments(snapshot), { scope, previousSnapshot });
  await cp(panelProject, cliProject, { recursive: true });
  const { page } = await panel(t, panelProject);
  const { id, ...input } = jobInput;
  for (const [name, args] of [["save_job_opportunities", { jobs: [input] }], ["save_job_research", researchInput]]) {
    assert.equal((await invoke(page, name, args)).projectSaved, true);
    assert.equal((await run(cliProject, name, args)).json.ok, true);
    assert.deepEqual(normalizeInvocation(await readSnapshot(panelProject)), normalizeInvocation(await readSnapshot(cliProject)), name);
  }
  // A later CLI receipt must survive browser normalization and the next Panel save.
  const receipt = { state: "verified_live", lastCheckedAt: ctx.now, checkedUrl: "https://example.invalid/jobs/1", sourceKind: "official", method: "browser-visible", evidenceExcerpt: "We are hiring TypeScript engineers." };
  await run(panelProject, "save_job_opportunities", { jobs: [{ ...input, verification: receipt }] });
  await page.reload();
  await page.waitForFunction(() => !document.querySelector(".app-shell").inert && document.querySelector("#draft-storage-status").textContent !== "正在连接草稿存储…", { timeout: 20000 });
  assert.equal((await invoke(page, "save_job_research", researchInput)).projectSaved, true);
  const saved = await readSnapshot(panelProject);
  assert.equal(saved.jobs[0].verification.state, "verified_live");
  assert.equal(saved.jobs[0].exclusion.reasonCode, "location");
  if (sharded) assert.ok(JSON.parse(await readFile(join(panelProject, snapshotPath), "utf8")).artifactStorage.shards.length > 0);
  await page.locator('[data-view-target="today"]').first().click();
  await page.locator("#open-job-digest").click();
  await page.locator("#today-job-digest").waitFor({ state: "visible" });
  assert.match(await page.locator("#today-job-digest").textContent(), /岗位研究日报/);
  assert.match(await page.locator("#today-job-digest").textContent(), /无法个性化/);
  await page.locator('.nav-item[data-view-target="dashboard"]').click();
  await page.locator('[data-view-target="research"]:visible').first().click();
  assert.match(await page.locator("#job-research-evidence").textContent(), /来源/);
  assert.match(await page.locator("#job-research-evidence").textContent(), /无法个性化/);
});
