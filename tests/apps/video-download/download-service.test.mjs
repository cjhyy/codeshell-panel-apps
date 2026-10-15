import assert from "node:assert/strict";
import test from "node:test";
import { createDownloadService } from "../../../apps/video-download/app/download-service.js";

const id = "12345678-1234-4567-8901-123456789abc";
const otherId = "12345678-1234-4567-8901-123456789def";
const job = (overrides = {}) => ({
  id,
  status: "running",
  url: "https://example.com/video",
  attempt: 1,
  ...overrides,
});
const queue = (overrides = {}) => ({
  revision: 1,
  paused: false,
  maxConcurrent: 2,
  active: 0,
  ...overrides,
});
const response = (result, overrides = {}) => ({
  code: 0,
  stdout: JSON.stringify({
    format: "mimi-download.service",
    schemaVersion: 1,
    ok: true,
    result,
    ...overrides,
  }),
});
const failure = (code = "JOB_BUSY") =>
  response(undefined, { ok: false, error: { code, message: "任务仍在运行。" } });
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function until(predicate) {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("Fixture condition was not reached");
}
function fixture({ run, call, changed } = {}) {
  const calls = [],
    runs = [],
    changes = [],
    errors = [];
  let context = { cwd: "/project", host: "fixture", appId: "video-download" },
    invalidated = false;
  const service = createDownloadService({
    panel: {
      async call(method, input) {
        calls.push({ method, input });
        if (call) {
          const result = await call(method, input);
          if (result !== undefined) return result;
        }
        if (method === "process.find") return { available: true, handle: "node-handle" };
        if (method === "process.resolveEntry") return { handle: "service-entry" };
        if (method === "filesystem.getKnownDirectory")
          return { handle: "project-grant", path: "/project" };
        throw new Error(`Unexpected Host method: ${method}`);
      },
    },
    processes: {
      async run(input) {
        runs.push(input);
        if (run) return run(input, runs.length);
        return response(input.input.action === "list" ? { jobs: [], queue: queue() } : job());
      },
    },
    getContext: () => context,
    assertCurrent() {
      if (invalidated)
        throw Object.assign(new Error("project changed"), { code: "PROJECT_CHANGED" });
    },
    onChanged(records, result) {
      changes.push({ records, result });
      changed?.(records, result);
    },
    onError(value) {
      errors.push(value);
    },
  });
  return {
    service,
    calls,
    runs,
    changes,
    errors,
    setContext(next) {
      context = next;
    },
    invalidate() {
      invalidated = true;
    },
  };
}

test("opening a client has no side effects; observing immediately reads the reviewed service in the authorized project", async (t) => {
  const app = fixture();
  t.after(() => app.service.destroy());
  assert.deepEqual(app.calls, []);
  assert.deepEqual(app.runs, []);
  await app.service.startObserving({ intervalMs: 60_000 });
  assert.deepEqual(app.calls, [
    { method: "process.find", input: { name: "node" } },
    {
      method: "process.resolveEntry",
      input: { name: "download-service", executableHandle: "node-handle" },
    },
    { method: "filesystem.getKnownDirectory", input: { name: "project" } },
  ]);
  assert.deepEqual(app.runs[0], {
    executableHandle: "node-handle",
    entryHandle: "service-entry",
    directoryHandle: "project-grant",
    input: { action: "list" },
    timeout: 30_000,
  });
  assert.deepEqual(app.service.records, []);
  assert.deepEqual(app.service.queue, queue());
  assert.equal(app.changes.length, 1);
});

test("an empty project keeps discovering tasks submitted by Chat without panel-created work", async (t) => {
  let reads = 0;
  const app = fixture({
    run: () => response({ jobs: ++reads === 1 ? [] : [job()], queue: queue() }),
  });
  t.after(() => app.service.destroy());
  await app.service.startObserving({ intervalMs: 5 });
  await until(() => app.service.records.length === 1);
  assert(app.runs.length >= 2);
  assert(app.runs.every(({ input }) => input.action === "list"));
});

test("concurrent refresh requests coalesce and never overlap service calls", async (t) => {
  const read = deferred();
  const app = fixture({ run: () => read.promise });
  t.after(() => app.service.destroy());
  const first = app.service.refresh(),
    second = app.service.refresh();
  assert.equal(first, second);
  await until(() => app.runs.length === 1);
  read.resolve(response({ jobs: [job()], queue: queue() }));
  await Promise.all([first, second]);
  assert.equal(app.runs.length, 1);
  assert.equal(app.changes.length, 1);
});

test("queue state falls back to one serialized read and configure sends the expected revision", async (t) => {
  const app = fixture({
    run: ({ input }) =>
      response(
        input.action === "list"
          ? { jobs: [] }
          : queue(
              input.action === "configure" ? { revision: 2, paused: true, maxConcurrent: 3 } : {},
            ),
      ),
  });
  t.after(() => app.service.destroy());
  await app.service.refresh();
  assert.deepEqual(
    app.runs.map(({ input }) => input.action),
    ["list", "queue"],
  );
  await app.service.configure({ expectedRevision: 1, paused: true, maxConcurrent: 3 });
  assert.deepEqual(app.runs.at(-1).input, {
    action: "configure",
    expectedRevision: 1,
    paused: true,
    maxConcurrent: 3,
  });
  assert.deepEqual(app.service.queue, queue({ revision: 2, paused: true, maxConcurrent: 3 }));
  await app.service.getQueue();
  assert.equal(app.runs.at(-1).input.action, "queue");
});

test("task mutations route IDs and attempts without inferring worker completion", async (t) => {
  const app = fixture({
    run: ({ input }) =>
      response(
        job({
          status: input.action === "archive" ? "completed" : "running",
          ...(input.action === "cancel" ? { cancelRequestedAt: 10 } : {}),
          ...(input.action === "archive" ? { archivedAt: 20 } : {}),
        }),
      ),
  });
  t.after(() => app.service.destroy());
  const cancelled = await app.service.cancel(id);
  assert.equal(cancelled.status, "running", "a cancellation request is not a worker exit receipt");
  assert.equal(app.service.records[0].status, "running");
  await app.service.retry(id, 2);
  await app.service.start(id, 3);
  await app.service.check(id);
  await app.service.archive(id);
  assert.deepEqual(
    app.runs.map(({ input }) => input),
    [
      { action: "cancel", id },
      { action: "retry", id, expectedAttempt: 2 },
      { action: "start", id, expectedAttempt: 3 },
      { action: "check", id },
      { action: "archive", id },
    ],
  );
  assert.deepEqual(app.service.records, []);
  assert.equal(app.calls.filter(({ method }) => method === "process.find").length, 1);
});

test("panel submission snapshots media fields and retains save-only and copy settings", async (t) => {
  const gate = deferred();
  const app = fixture({
    run: ({ input }) =>
      input.action === "list" ? gate.promise : response(job({ status: "pending" })),
  });
  t.after(() => app.service.destroy());
  const refresh = app.service.refresh();
  await until(() => app.runs.length === 1);
  const configuration = {
    format: "720",
    subtitles: true,
    cookieAccount: "must-not-cross",
    handle: "grant",
  };
  const submitted = app.service.submit({
    requestKey: "panel:request",
    source: "panel",
    start: false,
    title: "Saved title",
    request: {
      url: "https://example.com/video",
      configuration,
      outputDirectory: "/project/downloads",
      copySuffix: "1234abcd",
      nativeTaskId: "must-not-cross",
      fileArgumentHandles: ["secret"],
    },
  });
  configuration.format = "audio";
  gate.resolve(response({ jobs: [], queue: queue() }));
  await Promise.all([refresh, submitted]);
  assert.deepEqual(app.runs[1].input, {
    action: "submit",
    requestKey: "panel:request",
    source: "panel",
    start: false,
    title: "Saved title",
    request: {
      url: "https://example.com/video",
      configuration: { format: "720", subtitles: true },
      outputDirectory: "/project/downloads",
      copySuffix: "1234abcd",
    },
  });
});

test("a lost mutation receipt reads once and never replays the mutation", async (t) => {
  const app = fixture({
    run: ({ input }) => {
      if (input.action === "cancel") throw new Error("receipt lost");
      return response({ jobs: [job({ cancelRequestedAt: 10 })], queue: queue() });
    },
  });
  t.after(() => app.service.destroy());
  await assert.rejects(app.service.cancel(id), { code: "SERVICE_UNCERTAIN" });
  assert.deepEqual(
    app.runs.map(({ input }) => input.action),
    ["cancel", "list"],
  );
  assert.equal(app.service.records[0].cancelRequestedAt, 10);
  assert.equal(app.errors.length, 1);
});

test("an explicitly uncertain backend receipt is read back without being treated as rejected", async (t) => {
  const app = fixture({
    run: ({ input }) =>
      input.action === "cancel"
        ? { ...failure("SUBMISSION_UNCERTAIN"), code: 1 }
        : response({ jobs: [job({ cancelRequestedAt: 10 })], queue: queue() }),
  });
  t.after(() => app.service.destroy());
  await assert.rejects(app.service.cancel(id), { code: "SERVICE_UNCERTAIN" });
  assert.deepEqual(
    app.runs.map(({ input }) => input.action),
    ["cancel", "list"],
  );
  assert.equal(app.service.records[0].cancelRequestedAt, 10);
});

test("an explicit backend rejection is surfaced without resubmission or an unrelated recovery read", async (t) => {
  const app = fixture({ run: () => ({ ...failure("QUEUE_CONFLICT"), code: 1 }) });
  t.after(() => app.service.destroy());
  await assert.rejects(
    app.service.configure({ expectedRevision: 0, paused: false, maxConcurrent: 2 }),
    { code: "QUEUE_CONFLICT" },
  );
  assert.equal(app.runs.length, 1);
  assert.equal(app.service.queue, null);
});

test("mismatched mutation results are uncertain and a recovery list owns the visible truth", async (t) => {
  const app = fixture({
    run: ({ input }) =>
      response(
        input.action === "retry"
          ? job({ id: otherId })
          : { jobs: [job({ status: "queued", attempt: 2 })], queue: queue() },
      ),
  });
  t.after(() => app.service.destroy());
  await assert.rejects(app.service.retry(id, 1), { code: "SERVICE_UNCERTAIN" });
  assert.deepEqual(
    app.service.records.map((record) => [record.id, record.attempt]),
    [[id, 2]],
  );
});

test("a context change after a read blocks late records and every later mutation", async (t) => {
  const read = deferred();
  const app = fixture({ run: () => read.promise });
  t.after(() => app.service.destroy());
  const refreshing = app.service.refresh();
  await until(() => app.runs.length === 1);
  app.setContext({ cwd: "/other-project", host: "fixture", appId: "video-download" });
  read.resolve(response({ jobs: [job()], queue: queue() }));
  await assert.rejects(refreshing, { code: "PROJECT_CHANGED" });
  app.setContext({ cwd: "/project", host: "fixture", appId: "video-download" });
  await assert.rejects(app.service.cancel(id), { code: "PROJECT_CHANGED" });
  assert.deepEqual(app.service.records, []);
  assert.equal(app.changes.length, 0);
  assert.equal(app.runs.length, 1);
});

test("project invalidation during entry discovery prevents a native request", async (t) => {
  const resolveEntry = deferred();
  const app = fixture({
    call: (method) => (method === "process.resolveEntry" ? resolveEntry.promise : undefined),
  });
  t.after(() => app.service.destroy());
  const submitting = app.service.cancel(id);
  await until(() => app.calls.some(({ method }) => method === "process.resolveEntry"));
  app.invalidate();
  resolveEntry.resolve({ handle: "late-entry" });
  await assert.rejects(submitting, { code: "PROJECT_CHANGED" });
  assert.equal(app.runs.length, 0);
  assert.equal(
    app.calls.some(({ method }) => method === "filesystem.getKnownDirectory"),
    false,
  );
});

test("destroy discards late results and never calls process or task cancellation", async () => {
  const read = deferred();
  const app = fixture({ run: () => read.promise });
  const refreshing = app.service.refresh();
  await until(() => app.runs.length === 1);
  app.service.destroy();
  read.resolve(response({ jobs: [job()], queue: queue() }));
  await assert.rejects(refreshing, { code: "SERVICE_CLOSED" });
  assert.deepEqual(app.service.records, []);
  assert.deepEqual(app.changes, []);
  assert.deepEqual(app.errors, []);
  assert.equal(
    app.calls.some(({ method }) => /cancel/.test(method)),
    false,
  );
  await assert.rejects(app.service.startObserving(), { code: "SERVICE_CLOSED" });
});

test("queued mutations stay serialized and a destroyed client does not dispatch the next one", async () => {
  const first = deferred();
  const app = fixture({ run: () => first.promise });
  const cancelling = app.service.cancel(id),
    retrying = app.service.retry(id, 1);
  await until(() => app.runs.length === 1);
  app.service.destroy();
  first.resolve(response(job()));
  await assert.rejects(cancelling, { code: "SERVICE_CLOSED" });
  await assert.rejects(retrying, { code: "SERVICE_CLOSED" });
  assert.equal(app.runs.length, 1);
});

test("malformed service protocols and queue snapshots never replace cached records", async (t) => {
  const app = fixture({
    run: (_input, count) =>
      count === 1
        ? response({ jobs: [job()], queue: queue() })
        : response({ jobs: [], queue: queue({ maxConcurrent: 99 }) }),
  });
  t.after(() => app.service.destroy());
  await app.service.refresh();
  await assert.rejects(app.service.refresh(), { code: "SERVICE_INVALID_RECEIPT" });
  assert.equal(app.service.records.length, 1);
  assert.equal(app.service.queue.maxConcurrent, 2);
  for (const result of [
    { code: 0, stdout: "invalid-json" },
    response({ jobs: [{ id, status: "invented" }], queue: queue() }),
    { code: 1, stdout: response({ jobs: [], queue: queue() }).stdout },
    response({ jobs: [], queue: queue() }, { schemaVersion: 2 }),
  ]) {
    const invalid = fixture({ run: () => result });
    await assert.rejects(invalid.service.refresh(), { code: "SERVICE_INVALID_RECEIPT" });
    assert.deepEqual(invalid.service.records, []);
    invalid.service.destroy();
  }
});

test("missing Node can be repaired and invalid actions never reach a native process", async (t) => {
  let finds = 0;
  const app = fixture({
    call: (method) =>
      method === "process.find" && ++finds === 1 ? { available: false } : undefined,
  });
  t.after(() => app.service.destroy());
  await assert.rejects(app.service.refresh(), { code: "NODE_MISSING" });
  await app.service.refresh();
  assert.equal(app.runs.length, 1);
  for (const action of [
    () => app.service.cancel("../escape"),
    () => app.service.retry(id, 0),
    () => app.service.start(id),
    () => app.service.configure({ expectedRevision: 0, paused: true, maxConcurrent: 5 }),
    () => app.service.submit({ requestKey: "", request: {} }),
    () => app.service.startObserving({ intervalMs: 0 }),
  ])
    await assert.rejects(action(), { code: "INVALID_ARGUMENT" });
  assert.equal(app.runs.length, 1);
});
