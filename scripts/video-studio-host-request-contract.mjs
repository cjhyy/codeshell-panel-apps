import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const terminal = new Set(["succeeded", "failed", "cancelled", "interrupted"]);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function deferred() {
  let resolveValue;
  const promise = new Promise(resolve => { resolveValue = resolve; });
  return { promise, resolve: resolveValue };
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Host request contract stalled: ${label}`)), 15_000);
    })]);
  } finally { clearTimeout(timer); }
}

// Explicit cross-repository acceptance: import only the supplied Host's built
// modules. Nothing is built or changed there. Executors below are fake callbacks;
// storage, reservations, request digests, pruning and event barriers are real.
export async function verifyVideoStudioHostRequests(hostRoot) {
  const builtRoot = join(hostRoot, "packages/server/dist/panels");
  const { PanelToolJobService, toolJobLimits } = await import(pathToFileURL(join(builtRoot, "tool-jobs.js")));
  const { panelBridgeFailure } = await import(pathToFileURL(join(builtRoot, "bridge-contract.js")));
  const directory = await mkdtemp(join(tmpdir(), "video-studio-host-request-"));
  const services = new Set(), releases = new Set(), report = {};
  const projectPath = join(directory, "project");
  await mkdir(projectPath, { mode: 0o700 });
  const scope = { appId: "video-studio", projectPath, revision: "fixture-revision-1" };
  const request = {
    entry: { name: "media-runtime", sha256: "a".repeat(64) },
    input: { request: { action: "tts", params: { text: "offline contract", modelId: "fixture" } }, resources: [] },
    recovery: "manual", requestKey: "fixture-original-key",
  };
  function service(name, options = {}) {
    const events = new Map(), waiters = new Map();
    const instance = new PanelToolJobService({
      rootDir: join(directory, name),
      isAuthorized: candidate => candidate.appId === scope.appId && candidate.projectPath === projectPath,
      execute: async () => ({ fixture: true }),
      ...options,
      onEvent(job) {
        if (terminal.has(job.status)) {
          events.set(job.id, job);
          waiters.get(job.id)?.resolve(job);
        }
      },
    });
    services.add(instance);
    return { instance, finished(id) {
      if (events.has(id)) return Promise.resolve(events.get(id));
      let waiter = waiters.get(id);
      if (!waiter) { waiter = deferred(); waiters.set(id, waiter); }
      return bounded(waiter.promise, `terminal receipt ${id}`);
    } };
  }
  async function close(instance) {
    await bounded(instance.shutdown(), "owned service shutdown");
    services.delete(instance);
  }
  function barrier() {
    const value = deferred(); releases.add(value.resolve); return value;
  }
  let failure;
  try {
    const entered = barrier(), release = barrier();
    let preparations = 0, executions = 0;
    const shared = service("concurrent", {
      prepareInput: async (_scope, input) => {
        preparations++; entered.resolve(); await release.promise; return input;
      },
      execute: async () => { executions++; return { fixture: true }; },
    });
    const first = shared.instance.start(scope, request);
    await bounded(entered.promise, "first preparation admitted");
    assert.equal(await shared.instance.find(scope, request.requestKey), null,
      "find must not pretend a preparing reservation is a committed receipt");
    const second = shared.instance.start(scope, structuredClone(request));
    // The conflicting start queues after the duplicate. Its rejection is the
    // serial barrier proving both calls reached real admission before release.
    await assert.rejects(shared.instance.start(scope, { ...request, input: { changed: true } }), /different input/);
    assert.equal(preparations, 1);
    release.resolve();
    const [one, two] = await bounded(Promise.all([first, second]), "shared preparation completion");
    assert.equal(one.id, two.id);
    assert.equal((await shared.finished(one.id)).status, "succeeded");
    assert.equal(executions, 1);
    const retained = await shared.instance.start(scope, request);
    assert.equal(retained.id, one.id);
    assert.equal(executions, 1, "retained committed receipt must reuse the original execution");
    report.preparing = { starts: 2, preparations, executions, identicalReceipt: true, differentDigestRejected: true };
    // Host revision is part of scope. Panel policy must block an unknown request
    // crossing revisions: the generic Host intentionally treats it as distinct.
    const changedScope = { ...scope, revision: "fixture-revision-2" };
    const nextRevision = await shared.instance.start(changedScope, request);
    assert.notEqual(nextRevision.id, one.id);
    await shared.finished(nextRevision.id);
    assert.equal(executions, 2);
    assert.equal((await shared.instance.find(scope, request.requestKey)).id, one.id);
    assert.equal((await shared.instance.find(changedScope, request.requestKey)).id, nextRevision.id);
    report.revision = { distinctHostExecutions: 2, unknownPanelRequestMustNotCrossRevision: true };
    await close(shared.instance);

    let prepareFailures = true, failedPreparations = 0, acceptedExecutions = 0;
    const failedEntered = barrier(), failedRelease = barrier();
    const retriable = service("failed-preparation", {
      prepareInput: async (_scope, input) => {
        failedPreparations++; failedEntered.resolve(); await failedRelease.promise;
        if (prepareFailures) throw new Error("fixture input preparation failed");
        return input;
      },
      execute: async () => { acceptedExecutions++; return { fixture: true }; },
    });
    const failed = retriable.instance.start(scope, request);
    const result = failed.then(value => ({ value }), error => ({ error }));
    await bounded(failedEntered.promise, "failed preparation admitted");
    assert.equal(await retriable.instance.find(scope, request.requestKey), null);
    failedRelease.resolve();
    const outcome = await bounded(result, "failed preparation settled");
    assert.equal(outcome.error?.message, "fixture input preparation failed");
    assert.equal(outcome.error?.code, undefined, "ordinary preparation errors have no admission-proof code");
    assert.equal(panelBridgeFailure(outcome.error).__codeshellPanelError.code, "OPERATION_FAILED");
    assert.equal(await retriable.instance.find(scope, request.requestKey), null);
    assert.deepEqual(await retriable.instance.list(scope), []);
    assert.equal(acceptedExecutions, 0);
    prepareFailures = false;
    const resumed = await retriable.instance.start(scope, structuredClone(request));
    assert.equal((await retriable.finished(resumed.id)).status, "succeeded");
    assert.equal(failedPreparations, 2);
    assert.equal(acceptedExecutions, 1);
    report.preparationFailure = { attempts: 2, executions: 1, sameKeyCanBeReadmitted: true,
      publicFailureCode: "OPERATION_FAILED", publicAdmissionProof: false };
    await close(retriable.instance);

    // Prove the retention counterexample at the actual, unmodified Host limit.
    // A real first execution supplies a valid durable record template. Only the
    // unrelated, already-terminal fillers are seeded; Host load and pruning are
    // exercised normally, without touching private in-memory maps or limits.
    let paidExecutions = 0, ticks = 1000;
    const countExecute = async job => {
      if (job.requestKey === request.requestKey) paidExecutions++;
      return { fixture: true };
    };
    const original = service("retention", { execute: countExecute, now: () => ++ticks });
    const accepted = await original.instance.start(scope, request);
    await original.finished(accepted.id);
    // Simulate a dropped response while retaining the committed Host record.
    const found = await original.instance.find(scope, request.requestKey);
    assert.equal(found.id, accepted.id);
    assert.equal((await original.instance.start(scope, request)).id, accepted.id);
    assert.equal(paidExecutions, 1);
    await close(original.instance);
    const jobsRoot = join(directory, "retention");
    const template = JSON.parse(await readFile(join(jobsRoot, accepted.id, "job.json"), "utf8"));
    assert.equal(template.status, "succeeded");
    assert.equal(template.requestDigest, digest({ entry: request.entry, input: request.input, recovery: request.recovery }));
    assert.equal(toolJobLimits.maxJobs, 2000, "review retention contract if Host capacity changes");
    for (let index = 1; index < toolJobLimits.maxJobs; index++) {
      const id = randomUUID(), input = { filler: index };
      const completedAt = template.completedAt + index;
      const seeded = { ...template, id, requestKey: `fixture-terminal-${index}`, input,
        requestDigest: digest({ entry: request.entry, input, recovery: request.recovery }),
        createdAt: completedAt, updatedAt: completedAt, startedAt: completedAt, completedAt };
      const path = join(jobsRoot, id);
      await mkdir(path, { mode: 0o700 });
      await writeFile(join(path, "job.json"), JSON.stringify(seeded), { mode: 0o600, flag: "wx" });
    }
    ticks = template.completedAt + toolJobLimits.maxJobs + 1000;
    const reopened = service("retention", { execute: countExecute, now: () => ++ticks });
    await reopened.instance.initialize();
    assert.equal((await reopened.instance.list(scope)).length, toolJobLimits.maxJobs);
    assert.equal((await reopened.instance.find(scope, request.requestKey)).id, accepted.id);
    const unrelated = await reopened.instance.start(scope, { ...request, requestKey: "fixture-prune-trigger" });
    await reopened.finished(unrelated.id);
    assert.equal(await reopened.instance.find(scope, request.requestKey), null,
      "real maxJobs pruning removes the old terminal request key");
    await assert.rejects(readFile(join(jobsRoot, accepted.id, "job.json")), { code: "ENOENT" });
    const duplicate = await reopened.instance.start(scope, structuredClone(request));
    await reopened.finished(duplicate.id);
    assert.notEqual(duplicate.id, accepted.id);
    assert.equal(paidExecutions, 2, "same scope/key/input executes again after the terminal receipt is pruned");
    report.retention = { maxJobs: toolJobLimits.maxJobs, terminalFillers: toolJobLimits.maxJobs - 1,
      originalReceiptPruned: true, sameKeyExecutions: paidExecutions,
      unknownPendingIsNotPermanentlyIdempotent: true };
    report.lostAcknowledgement = { retainedReceiptRecovered: true, executionsBeforePruning: 1 };
    await close(reopened.instance);
    report.builtArtifacts = Object.fromEntries(await Promise.all([
      "tool-jobs.js", "tool-jobs-storage.js", "bridge-contract.js",
    ].map(async name => [name, createHash("sha256").update(await readFile(join(builtRoot, name))).digest("hex")])));
  } catch (error) { failure = error; }
  finally {
    for (const release of releases) release();
    const shutdowns = await Promise.allSettled([...services].map(instance => close(instance)));
    const errors = shutdowns.filter(result => result.status === "rejected").map(result => result.reason);
    if (!errors.length) await rm(directory, { recursive: true, force: true });
    else failure = new AggregateError([...(failure ? [failure] : []), ...errors],
      `Owned Host fixture shutdown failed; retained ${directory}`);
  }
  if (failure) throw failure;
  return { ...report, providerCalls: 0, nativeProcesses: 0, ownedFixtureRemoved: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/video-studio-host-request-contract.mjs /absolute/path/to/built/host");
  console.log(`PASS real Host media request contract ${JSON.stringify(await verifyVideoStudioHostRequests(resolve(process.argv[2])))}`);
}
