import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { cp, readFile } from "node:fs/promises";
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
  await new Promise(done => server.listen(0, "127.0.0.1", done));
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
  await page.waitForFunction(() => !document.querySelector(".app-shell").inert && document.querySelector("#draft-storage-status").textContent !== "正在连接草稿存储…");
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
