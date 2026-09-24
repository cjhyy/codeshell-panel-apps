import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDurableDownloads } from "../../../apps/video-download/app/durable-downloads.js";
import {
  serializeLibrary,
  restoreLibrary,
} from "../../../apps/video-download/app/download-library.js";

function fixture() {
  const jobs = new Map(),
    calls = [],
    records = [],
    errors = [];
  let queue = { revision: 0, paused: false, maxConcurrent: 2 },
    saved,
    loseStart = false;
  const panel = {
    async call(method, args) {
      calls.push({ method, args });
      if (method === "tasks.queue.get") return structuredClone(queue);
      if (method === "tasks.queue.set") {
        if (queue.revision !== args.expectedRevision) return { saved: false, queue };
        queue = {
          revision: queue.revision + 1,
          paused: args.paused,
          maxConcurrent: args.maxConcurrent,
        };
        return { saved: true, queue };
      }
      if (method === "tasks.find")
        return structuredClone(
          [...jobs.values()].find((job) => job.requestKey === args.requestKey) || null,
        );
      if (method === "tasks.get") return structuredClone(jobs.get(args.id));
      if (method === "tasks.list")
        return [...jobs.values()]
          .slice(args.offset, args.offset + args.limit)
          .map(({ input, result, ...summary }) => structuredClone(summary));
      if (method === "tasks.start") {
        const job = {
          id: randomUUID(),
          requestKey: args.requestKey,
          input: args.input,
          entry: { name: args.entry },
          status: "queued",
          sequence: 1,
        };
        jobs.set(job.id, job);
        if (loseStart) {
          loseStart = false;
          throw new Error("reply lost");
        }
        return structuredClone(job);
      }
      const job = jobs.get(args.id);
      if (method === "tasks.cancel") {
        job.status = "cancelled";
        job.sequence++;
        return structuredClone(job);
      }
      if (method === "tasks.retry") {
        job.status = "queued";
        job.sequence++;
        return structuredClone(job);
      }
      throw new Error(method);
    },
  };
  const options = {
    panel,
    items: () => records,
    requestDelay: 0,
    save: async () => {
      saved = serializeLibrary({ queue: records, history: [] }, "/project");
    },
    changed() {},
    queueChanged() {},
    failed(error) {
      errors.push(error);
    },
  };
  const add = () => {
    const item = {
      queueId: randomUUID(),
      url: "https://example.com/" + records.length,
      configuration: { format: "best" },
      directory: { path: "/project", bookmark: randomUUID() },
      status: "queued",
    };
    records.push(item);
    return item;
  };
  return {
    jobs,
    calls,
    records,
    errors,
    add,
    options,
    controller: createDurableDownloads(options),
    saved: () => saved,
    loseReply() {
      loseStart = true;
    },
    compete() {
      queue = { ...queue, revision: queue.revision + 1, paused: true };
    },
  };
}

test("package history is displayed and a same-sequence read-only change blocks retry without replacing the task", async () => {
  const f = fixture();
  const item = f.add();
  await f.controller.pump();
  const job = f.jobs.get(item.nativeTaskId);
  job.package = { version: "1.2.0", packageDigest: "a".repeat(64) };
  job.status = "failed";
  job.error = { message: "Original failure", retryable: true };
  job.sequence++;
  await f.controller.refresh();
  assert.deepEqual(item.nativePackage, job.package);
  const sequence = item.nativeSequence;
  // An upgrade changes permission to retry, not the stored task's sequence.
  job.readOnly = true;
  await f.controller.refresh();
  assert.equal(item.nativeSequence, sequence);
  assert.equal(item.nativeRetryBlocked, true);
  await assert.rejects(f.controller.resume(item), /仅可查看/);
  assert.equal(f.calls.filter(({ method }) => method === "tasks.retry").length, 0);
  assert.equal(f.jobs.size, 1);
  await f.options.save();
  assert.deepEqual(restoreLibrary(f.saved(), "/project").queue[0].nativePackage, job.package);
  job.readOnly = false;
  await f.controller.refresh();
  assert.equal(item.nativeRetryBlocked, false);
  await f.controller.resume(item);
  assert.equal(f.jobs.size, 1);
  assert.equal(f.calls.filter(({ method }) => method === "tasks.retry").length, 1);
});

test("legacy package history is not inferred and manually reviewed failures do not retry", async () => {
  const f = fixture();
  const item = f.add();
  await f.controller.pump();
  const job = f.jobs.get(item.nativeTaskId);
  job.status = "interrupted";
  job.error = { message: "Review new input", retryable: false };
  job.sequence++;
  await f.controller.refresh();
  assert.equal(item.nativePackage, undefined);
  assert.equal(item.nativeRetryBlocked, true);
  await assert.rejects(f.controller.resume(item), /Review new input/);
  assert.equal(f.calls.filter(({ method }) => method === "tasks.retry").length, 0);
});

test("the entire requested queue is admitted without waiting for running slots", async () => {
  const f = fixture();
  for (let n = 0; n < 10; n++) f.add();
  await f.controller.pump();
  assert.equal(f.jobs.size, 10);
  assert.ok(f.records.every((item) => item.nativeTaskId));
  assert.ok(
    f.calls
      .filter((call) => call.method === "tasks.start")
      .every(({ args }) => args.input.directoryArguments[1].directory === "bookmark"),
  );
  await f.controller.pump();
  assert.equal(f.jobs.size, 10);
});

test("a lost start reply attaches to the accepted task without another execution", async () => {
  const f = fixture(),
    item = f.add();
  f.loseReply();
  await f.controller.pump();
  assert.equal(f.errors.length, 0);
  assert.equal(f.jobs.size, 1);
  assert.equal(item.nativeTaskId, [...f.jobs.keys()][0]);
  assert.equal(f.calls.filter((call) => call.method === "tasks.start").length, 1);
});

test("reopening reconciles running and completed tasks and their verified files", async () => {
  const f = fixture();
  f.add();
  await f.controller.pump();
  const saved = restoreLibrary(f.saved(), "/project");
  f.records.splice(0, f.records.length, ...saved.queue);
  const job = [...f.jobs.values()][0];
  job.status = "succeeded";
  job.sequence++;
  job.result = { artifacts: [{ published: { path: "video.mp4" }, bytes: 123, assetId: `asset-${"a".repeat(64)}` }] };
  const reopened = createDurableDownloads(f.options);
  await reopened.refresh();
  assert.equal(f.records[0].status, "completed");
  assert.deepEqual(f.records[0].files, [{ path: "video.mp4", bytes: 123, status: "present", assetId: `asset-${"a".repeat(64)}` }]);
  assert.equal(f.calls.filter((call) => call.method === "tasks.start").length, 1);
});

test("unconfirmed persisted keys are queried on reopen and never automatically resubmitted", async () => {
  const f = fixture(),
    item = f.add();
  item.nativeRequestKey = `download:${item.queueId}`;
  await f.controller.refresh();
  await f.controller.pump();
  assert.equal(item.status, "interrupted");
  assert.equal(f.jobs.size, 0);
  await f.controller.resume(item);
  assert.equal(f.jobs.size, 1);
});

test("per-item pause uses cancellation and an explicit resume retains its task ID", async () => {
  const f = fixture(),
    item = f.add();
  await f.controller.pump();
  const id = item.nativeTaskId;
  await f.controller.stop(item, true);
  assert.equal(item.status, "paused");
  await f.controller.resume(item);
  assert.equal(item.status, "queued");
  assert.equal(item.nativeTaskId, id);
  assert.equal(f.jobs.size, 1);
});

test("queue settings reject a stale device and report current Host state", async () => {
  const f = fixture();
  await f.controller.refresh();
  f.compete();
  await assert.rejects(f.controller.configure(false, 1), /另一设备/);
  assert.equal(f.calls.filter((call) => call.method === "tasks.queue.set").length, 1);
});

test("credentials, missing grants and failed durable saves cannot start anonymous work", async () => {
  const f = fixture(),
    item = f.add();
  item.cookieCredentialId = "selected-account";
  await f.controller.pump();
  assert.equal(f.jobs.size, 0);
  assert.match(item.error, /账号授权/);
  delete item.cookieCredentialId;
  item.status = "queued";
  delete item.directory.bookmark;
  await f.controller.pump();
  assert.equal(f.jobs.size, 0);
  item.directory.bookmark = randomUUID();
  item.status = "queued";
  const broken = createDurableDownloads({
    ...f.options,
    save: async () => {
      throw new Error("save failed");
    },
  });
  await broken.pump();
  assert.equal(f.jobs.size, 0);
});

test("closing a controller detaches without cancelling accepted background work", async () => {
  const f = fixture();
  f.add();
  await f.controller.pump();
  f.controller.close();
  await assert.rejects(f.controller.refresh(), /关闭/);
  assert.equal(f.calls.filter((call) => call.method === "tasks.cancel").length, 0);
  assert.equal([...f.jobs.values()][0].status, "queued");
});

test("pause during an unresolved submission waits for its ID and cancels that exact task", async () => {
  const f = fixture(),
    item = f.add();
  let accepted, release;
  const started = new Promise((done) => {
    accepted = done;
  });
  const gate = new Promise((done) => {
    release = done;
  });
  const original = f.options.panel.call;
  f.options.panel.call = async (method, args) => {
    const result = await original(method, args);
    if (method === "tasks.start") {
      accepted();
      await gate;
    }
    return result;
  };
  const pumping = f.controller.pump();
  await started;
  const stopping = f.controller.stop(item, true);
  release();
  await Promise.all([pumping, stopping]);
  assert.equal(item.status, "paused");
  assert.equal([...f.jobs.values()][0].status, "cancelled");
  assert.equal(f.jobs.size, 1);
});

test("a save conflict after admission preserves the actual Host state", async () => {
  const f = fixture(),
    item = f.add();
  let writes = 0;
  const controller = createDurableDownloads({
    ...f.options,
    save: async () => {
      if (++writes > 1) throw new Error("other device saved");
    },
  });
  await controller.pump();
  assert.equal(f.jobs.size, 1);
  assert.equal(item.status, "queued");
  assert.ok(item.nativeTaskId);
  assert.equal(f.errors.length, 1);
});

test("a project edit conflict cannot prevent cancelling an already admitted task", async () => {
  const f = fixture(),
    item = f.add();
  await f.controller.pump();
  const controller = createDurableDownloads({
    ...f.options,
    save: async () => {
      throw new Error("other device saved");
    },
  });
  await controller.stop(item, false);
  assert.equal([...f.jobs.values()][0].status, "cancelled");
  assert.equal(item.status, "cancelled");
  assert.match(f.errors[0].message, /任务已停止/);
});

test("live progress advances in sequence and stale events cannot regress a task", async () => {
  const f = fixture(),
    item = f.add();
  await f.controller.pump();
  const job = [...f.jobs.values()][0];
  f.controller.observe({ ...job, status: "running", sequence: 3, progress: { fraction: 0.5 } });
  assert.equal(item.status, "running");
  assert.equal(item.percent, 50);
  f.controller.observe({ ...job, status: "queued", sequence: 2 });
  assert.equal(item.status, "running");
  assert.equal(item.percent, 50);
});

test("a lost queue update reply reads actual settings without replaying the change", async () => {
  const f = fixture();
  const original = f.options.panel.call;
  f.options.panel.call = async (method, args) => {
    const value = await original(method, args);
    if (method === "tasks.queue.set") throw new Error("reply lost");
    return value;
  };
  let observed;
  const controller = createDurableDownloads({
    ...f.options,
    queueChanged: (value) => {
      observed = value;
    },
  });
  await controller.refresh();
  await assert.rejects(controller.configure(true, 1), /未确认/);
  assert.equal(observed.paused, true);
  assert.equal(observed.maxConcurrent, 1);
  assert.equal(f.calls.filter((call) => call.method === "tasks.queue.set").length, 1);
});

test("account references persist and a retry reuses the immutable authenticated job after a lost reply", async () => {
  const f = fixture();
  const item = f.add();
  Object.assign(item, {
    cookieCredentialId: "saved-account",
    cookieCredentialRevision: "a".repeat(64),
    cookieCredentialUrl: "https://example.com/",
  });
  f.loseReply();
  await f.controller.pump();
  assert.equal(f.jobs.size, 1);
  const job = f.jobs.get(item.nativeTaskId);
  assert.equal(job.input.request.useSavedLogin, true);
  assert.deepEqual(job.input.cookieArgument, {
    argumentName: "--cookies-file",
    credentialId: "saved-account",
    revision: "a".repeat(64),
    url: "https://example.com/",
  });
  assert.equal(f.saved().queue[0].cookieCredentialRevision, "a".repeat(64));
  const restored = restoreLibrary(f.saved(), "/project").queue[0];
  assert.equal(restored.cookieCredentialId, "saved-account");
  assert.equal(restored.cookieCredentialRevision, "a".repeat(64));
  assert.equal(restored.cookieCredentialUrl, "https://example.com/");
  job.status = "failed";
  job.sequence++;
  await f.controller.refresh();
  item.cookieCredentialId = "different-form-selection";
  await f.controller.resume(item);
  assert.equal(f.jobs.size, 1);
  assert.equal(job.input.cookieArgument.credentialId, "saved-account");
  assert.equal(f.calls.filter((call) => call.method === "tasks.start").length, 1);
});
