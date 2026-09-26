import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareResumePdfTask, createResumePdfTasks, resumePdfReceipt, supportsResumePdfTasks } from "../../../apps/job-hunt-hq/app/resume-pdf-tasks.mjs";
import { normalizeResumeRecord, resumeExportStatus } from "../../../apps/job-hunt-hq/app/resume-model.mjs";

const source = { html: "<main>公开简历</main>", resumeId: "resume-a", updatedAt: "2026-09-27T00:00:00Z" };
function fixture() {
  const calls = [], jobs = new Map();
  const state = { loseStart: false, rejectStart: false, active: true, onCall: null };
  const call = async (method, args) => {
    calls.push({ method, args: structuredClone(args) });
    await state.onCall?.(method, args);
    if (method === "tasks.find") return structuredClone([...jobs.values()].find((job) => job.requestKey === args.requestKey) || null);
    if (method === "tasks.start") {
      if (state.rejectStart) throw new Error("connection lost");
      const job = { id: `job-${jobs.size}`, requestKey: args.requestKey, entry: { name: args.entry }, input: structuredClone(args.input), status: "queued", createdAt: "2026-09-27T00:00:01Z" };
      jobs.set(job.id, job);
      if (state.loseStart) throw new Error("response lost");
      return structuredClone(job);
    }
    if (method === "tasks.get") return structuredClone(jobs.get(args.id));
    if (method === "tasks.list") return [...jobs.values()].slice(args.offset, args.offset + args.limit).map(({ input, result, ...summary }) => summary);
    if (method === "tasks.cancel") { jobs.get(args.id).status = "cancelled"; return {}; }
    if (method === "tasks.retry") { jobs.get(args.id).status = "queued"; return {}; }
    if (method === "resources.open") return args;
    throw new Error(method);
  };
  const options = { call, check: () => { if (!state.active) throw new Error("project changed"); } };
  return { tasks: createResumePdfTasks(options), options, jobs, calls, state };
}

test("source snapshots produce stable keys and changed content gets a distinct key", async () => {
  const first = await prepareResumePdfTask(source);
  assert.deepEqual(first, await prepareResumePdfTask({ ...source }));
  assert.notEqual(first.requestKey, (await prepareResumePdfTask({ ...source, html: "<main>编辑后</main>" })).requestKey);
  assert.notEqual(first.requestKey, (await prepareResumePdfTask({ ...source, resumeId: "other" })).requestKey);
  assert.equal(first.input.request.source.resumeId, source.resumeId);
  assert.equal(first.recovery, "retry");
});

test("concurrent clicks and a lost response converge on one accepted task", async () => {
  const f = fixture(); f.state.loseStart = true;
  const prepared = await prepareResumePdfTask(source);
  const [a, b] = await Promise.all([f.tasks.submit(prepared), f.tasks.submit(prepared)]);
  assert.equal(a.id, b.id);
  assert.equal(f.calls.filter((call) => call.method === "tasks.start").length, 1);
  const reopened = createResumePdfTasks(f.options);
  assert.equal((await reopened.submit(await prepareResumePdfTask(source))).id, a.id);
  assert.equal(f.jobs.size, 1);
});

test("an uncertain start with no accepted record is not automatically replayed", async () => {
  const f = fixture(); f.state.rejectStart = true;
  await assert.rejects(f.tasks.submit(await prepareResumePdfTask(source)), /connection lost/);
  assert.deepEqual(f.calls.map((call) => call.method), ["tasks.find", "tasks.start", "tasks.find"]);
});

test("switching project during lookup cannot start work in the new project", async () => {
  const f = fixture();
  f.state.onCall = (method) => { if (method === "tasks.find") f.state.active = false; };
  await assert.rejects(f.tasks.submit(await prepareResumePdfTask(source)), /project changed/);
  assert.equal(f.calls.some((call) => call.method === "tasks.start"), false);
});

test("history reload, explicit cancel and retry use the original task", async () => {
  const f = fixture();
  const job = await f.tasks.submit(await prepareResumePdfTask(source));
  const reopened = createResumePdfTasks(f.options);
  assert.equal((await reopened.list()).jobs[0].id, job.id);
  assert.equal((await reopened.cancel(job.id)).status, "cancelled");
  assert.equal((await reopened.list()).jobs[0].status, "cancelled");
  assert.equal(f.calls.filter((call) => call.method === "tasks.retry").length, 0);
  assert.equal((await reopened.retry(job.id)).status, "queued");
  f.jobs.get(job.id).status = "interrupted";
  f.jobs.get(job.id).readOnly = true;
  await assert.rejects(reopened.retry(job.id), /历史任务不能重试/);
  assert.equal(f.jobs.size, 1);
});

test("only captured PDF artifacts can be opened and keep the source version", async () => {
  const f = fixture();
  const job = await f.tasks.submit(await prepareResumePdfTask(source));
  await assert.rejects(f.tasks.open(job.id), /尚未生成/);
  const stored = f.jobs.get(job.id);
  stored.status = "succeeded";
  stored.completedAt = "2026-09-27T00:01:00Z";
  stored.result = { artifacts: [{ role: "pdf", mimeType: "application/pdf", bytes: 100, sha256: "a".repeat(64), assetId: "asset-a" }] };
  assert.throws(() => resumePdfReceipt(stored), /完整的项目文件回执/);
  stored.result.artifacts[0].asset = { id: "asset-a" };
  const receipt = resumePdfReceipt(stored);
  assert.equal(receipt.resumeId, source.resumeId);
  assert.equal(receipt.sourceUpdatedAt, source.updatedAt);
  assert.deepEqual(await f.tasks.open(job.id), { assetId: "asset-a" });
});

test("a matching key with a different saved source is rejected", async () => {
  const f = fixture();
  const prepared = await prepareResumePdfTask(source);
  const job = await f.tasks.submit(prepared);
  f.jobs.get(job.id).input.request.html = "other";
  await assert.rejects(f.tasks.submit(prepared), /不匹配/);
  assert.equal(f.calls.filter((call) => call.method === "tasks.start").length, 1);
});

test("feature availability uses advertised methods rather than the API number", () => {
  assert.equal(supportsResumePdfTasks({ apiVersion: 99 }), false);
  assert.equal(supportsResumePdfTasks({ availableMethods: ["tasks.start", "tasks.find", "tasks.get", "tasks.list", "tasks.cancel", "tasks.retry", "resources.open"] }), true);
});

test("saved cloud receipts survive normalization and an edited source stays stale", () => {
  const receipt = { path: "resume.pdf", assetId: "asset-" + "a".repeat(64), taskId: "job-a", size: 100,
    exportedAt: "2026-09-27T00:03:00Z", sourceUpdatedAt: "2026-09-27T00:00:00Z" };
  const record = normalizeResumeRecord({ versionId: "resume-a", kind: "base", markdown: "# Public",
    updatedAt: "2026-09-27T00:02:00Z", pdfExports: [receipt] });
  assert.deepEqual(record.pdfExports, [receipt]);
  assert.equal(resumeExportStatus(record).fresh, false);
  assert.equal(resumeExportStatus({ ...record, updatedAt: receipt.sourceUpdatedAt }).fresh, true);
  // Legacy desktop receipts remain compatible with the former timestamp rule.
  const { assetId, taskId, sourceUpdatedAt, ...legacy } = receipt;
  assert.equal(resumeExportStatus({ ...record, pdfExports: [legacy] }).fresh, true);
});
