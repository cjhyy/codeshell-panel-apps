import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  handleServiceRequest,
  readServiceInput,
} from "../../../apps/video-download/app/tools/service.mjs";
import { main } from "../../../apps/video-download/app/tools/video-download.mjs";
import { ungroupedExitConfirmed } from "../../../apps/video-download/app/tools/download-runtime.mjs";
import {
  createCliStore,
  getCliJob,
  listCliJobs,
  requestCliCancellation,
} from "../../../apps/video-download/app/tools/cli-store.mjs";
import { parseDownloadRequest } from "../../../apps/video-download/app/tools/download.mjs";

const serviceEntry = fileURLToPath(
  new URL("../../../apps/video-download/app/tools/service.mjs", import.meta.url),
);
const supported = process.platform !== "win32";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(operation, predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await operation();
    if (predicate(value)) return value;
    await pause(60);
  }
  assert.fail("owned service fixture did not settle");
}
async function fixture(t, { delay = 500 } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mimi-service-")));
  const project = join(root, "project"),
    home = join(root, "home"),
    bin = join(root, "bin"),
    events = join(root, "events");
  for (const path of [project, home, bin]) await mkdir(path, { mode: 0o700 });
  await writeFile(
    join(bin, "yt-dlp"),
    `#!${process.execPath}
const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);
if(args.includes('--version')){console.log('2026.10.15');process.exit(0);}
if(args.includes('--help')){console.log('--js-runtimes');process.exit(0);}
const target=args.at(-1), name=new URL(target).pathname.slice(1).replace(/[^a-z0-9]/gi,'_')||'fixture';
fs.appendFileSync(process.env.MIMI_EVENTS,JSON.stringify({kind:'start',name,at:Date.now()})+'\\n');
process.stdout.write('progress: 25%\\n');
const timer=setTimeout(()=>{fs.writeFileSync(path.join(process.cwd(),name+'.mp4'),'fixture media '+name);fs.appendFileSync(process.env.MIMI_EVENTS,JSON.stringify({kind:'done',name,at:Date.now()})+'\\n');process.exit(0);},Number(process.env.MIMI_DELAY));
process.on('SIGTERM',()=>{clearTimeout(timer);fs.appendFileSync(process.env.MIMI_EVENTS,JSON.stringify({kind:'cancel',name,at:Date.now()})+'\\n');process.exit(0);});
`,
    { mode: 0o700 },
  );
  await writeFile(
    join(bin, "ffmpeg"),
    `#!${process.execPath}\nconsole.log('ffmpeg version fixture');\n`,
    { mode: 0o700 },
  );
  const env = {
    PATH: bin,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: root,
    MIMI_EVENTS: events,
    MIMI_DELAY: String(delay),
    LANG: "C.UTF-8",
  };
  const request = (name, extra = {}) => ({
    action: "submit",
    requestKey: `fixture:${name}`,
    source: "panel",
    request: { url: `https://example.invalid/${name}` },
    ...extra,
  });
  const call = (input) => handleServiceRequest(input, { cwd: project, env });
  const invoke = (input, extraArgs = [], raw, executable = serviceEntry) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [executable, ...extraArgs], {
        cwd: project,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("service entry timeout"));
      }, 15_000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timer);
        try {
          resolve({ ...JSON.parse(stdout), exitCode: code, stderr });
        } catch {
          reject(new Error(stdout + stderr));
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(raw ?? JSON.stringify(input));
    });
  const log = async () =>
    (await readFile(events, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  const finish = (id) =>
    until(
      () => getCliJob(project, id),
      (job) => ["completed", "failed", "cancelled", "interrupted"].includes(job.status),
    );
  t.after(async () => {
    const jobs = (await listCliJobs(project, { includeArchived: true }).catch(() => ({ jobs: [] })))
      .jobs;
    for (const job of jobs)
      if (["queued", "running", "pending"].includes(job.status)) {
        await requestCliCancellation(project, job.id);
        await finish(job.id);
      }
    // Terminal receipt precedes the worker's confirmed slot/lock release.
    for (const job of jobs) {
      const lock = join(project, ".mimi-download-cli", "jobs", job.id, ".worker.lock");
      await until(
        () => stat(lock).catch(() => null),
        (value) => !value,
      );
    }
    await rm(root, { recursive: true, force: true });
  });
  return { root, project, home, bin, env, events, request, call, invoke, log, finish };
}

test("service validates complete input before state changes and read-only calls create nothing", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.call({ action: "list" })).result.jobs, []);
  assert.deepEqual((await f.call({ action: "queue" })).result, {
    revision: 0,
    paused: false,
    maxConcurrent: 2,
    active: 0,
    stalled: 0,
  });
  for (const input of [
    { action: "submit", requestKey: "x", request: { url: "file:///bad" } },
    f.request("bad", { project: f.root }),
    f.request("bad", { executablePath: "/bin/sh" }),
    f.request("bad", { requestKey: "x".repeat(161) }),
    f.request("bad", { requestKey: "bad\nkey" }),
    f.request("bad", { source: "host" }),
    f.request("bad", { start: "false" }),
    f.request("bad", { request: { url: "https://example.invalid/x", outputDirectory: null } }),
    f.request("bad", { request: { url: "https://example.invalid/x", outputDirectory: f.home } }),
    f.request("bad", { request: { url: "https://example.invalid/x", code: "process.exit()" } }),
    { action: "configure", expectedRevision: 0, paused: false, maxConcurrent: 5 },
    { action: "list", limit: 1001 },
    { action: "status", id: "../../escape" },
    { action: "retry", id: randomUUID() },
    { action: "unknown" },
  ]) {
    const result = await f.call(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.format, "mimi-download.service");
    assert.equal(typeof result.error.code, "string");
    assert.deepEqual(await readdir(f.project), []);
  }
  await assert.rejects(
    readServiceInput(Readable.from([Buffer.alloc(32769)])),
    (error) => error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    readServiceInput(Readable.from([Buffer.from([0xff])])),
    (error) => error.code === "INVALID_INPUT",
  );
  const extraArgs = await f.invoke({ action: "list" }, ["--project", f.root]);
  assert.equal(extraArgs.ok, false);
  assert.deepEqual(await readdir(f.project), []);
});

test(
  "pending/start preserves manual queue intent, public metadata and launch idempotence",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t);
    const input = f.request("pending", {
      start: false,
      title: "A\n title",
      request: {
        url: "https://example.invalid/pending",
        copySuffix: "1234abcd",
        configuration: { format: "720" },
      },
    });
    const pending = (await f.invoke(input)).result;
    assert.equal(pending.status, "pending");
    assert.equal(pending.title, "A  title");
    assert.equal(pending.source, "panel");
    assert.equal(pending.configuration.format, "720");
    assert.equal(pending.requestKey, input.requestKey);
    assert.deepEqual(await f.log(), []);
    assert.equal(
      (await f.call({ action: "start", id: pending.id })).error.code,
      "INVALID_ARGUMENT",
    );
    const starts = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.invoke({ action: "start", id: pending.id, expectedAttempt: 1 }),
      ),
    );
    assert.ok(
      starts.every(
        (result) => result.ok && result.result.id === pending.id && result.result.attempt === 1,
      ),
    );
    const done = await f.finish(pending.id);
    assert.equal(done.status, "completed");
    assert.equal((await f.log()).filter((event) => event.kind === "start").length, 1);
    const store = await createCliStore(f.project);
    assert.equal((await store.read(done.id)).request.copySuffix, "1234abcd");
    await store.update(done.id, (record) => ({
      ...record,
      workerToken: "private-test-token",
      secret: "private-extra",
      files: record.files.map((file) => ({ ...file, secret: "private-file" })),
    }));
    const publicResult = JSON.stringify((await f.call({ action: "status", id: done.id })).result);
    assert.ok(
      !/private-test-token|private-extra|private-file|workerToken|requestDigest|"request"/.test(
        publicResult,
      ),
    );
  },
);

test(
  "concurrent cross-process submit and a lost reply cannot duplicate a download",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t, { delay: 900 });
    const input = f.request("same");
    const responses = await Promise.all(Array.from({ length: 12 }, () => f.invoke(input)));
    assert.ok(responses.every((response) => response.ok));
    assert.equal(new Set(responses.map((response) => response.result.id)).size, 1);
    const id = responses[0].result.id;
    await f.finish(id);
    const replay = await f.invoke(input);
    assert.equal(replay.result.id, id);
    assert.equal(replay.result.attempt, 1);
    assert.equal((await f.log()).filter((event) => event.kind === "start").length, 1);
    assert.equal(
      (await f.call({ ...input, request: { url: "https://example.invalid/different" } })).error
        .code,
      "REQUEST_CONFLICT",
    );
    assert.equal((await f.call({ ...input, source: "chat" })).error.code, "REQUEST_CONFLICT");
    assert.equal((await listCliJobs(f.project)).jobs.length, 1);
  },
);

test(
  "a committed but unlaunched submission stays queued until explicit retry",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      store = await createCliStore(f.project, { create: true });
    const input = f.request("unlaunched");
    const record = (
      await store.createOrGet(
        parseDownloadRequest({ action: "download", url: input.request.url }),
        join(f.project, "downloads"),
        { requestKey: input.requestKey, source: "panel" },
      )
    ).record;
    assert.equal((await f.call(input)).result.id, record.id);
    await pause(300);
    assert.deepEqual(await f.log(), []);
    const retry = await f.call({ action: "retry", id: record.id, expectedAttempt: 1 });
    assert.equal(retry.ok, true);
    assert.equal(retry.result.attempt, 2);
    const done = await f.finish(record.id);
    assert.equal(done.status, "completed");
    const repeated = await f.call({ action: "retry", id: record.id, expectedAttempt: 1 });
    assert.equal(repeated.result.attempt, 2);
    assert.equal((await f.log()).filter((event) => event.kind === "start").length, 1);
    assert.equal(
      (await f.call({ action: "retry", id: record.id, expectedAttempt: 9 })).error.code,
      "ATTEMPT_CONFLICT",
    );
  },
);

test(
  "check persists inventory states and archive preserves files and old schema records",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      submitted = (await f.call(f.request("inventory"))).result;
    const done = await f.finish(submitted.id);
    const checked = (await f.call({ action: "check", id: done.id })).result;
    assert.equal(checked.files[0].status, "present");
    assert.ok(Number.isSafeInteger(checked.files[0].modifiedAt));
    assert.ok(checked.checkedAt);
    await writeFile(checked.files[0].path, "changed bytes");
    for (let index = 0; index < 2; index++)
      assert.equal(
        (await f.call({ action: "check", id: done.id })).result.files[0].status,
        "changed",
      );
    await rm(checked.files[0].path);
    assert.equal(
      (await f.call({ action: "check", id: done.id })).result.files[0].status,
      "missing",
    );
    await writeFile(checked.files[0].path, "preserved after archive");
    const archived = (await f.call({ action: "archive", id: done.id })).result;
    assert.ok(archived.archivedAt);
    assert.equal(await readFile(checked.files[0].path, "utf8"), "preserved after archive");
    assert.deepEqual((await f.call({ action: "list" })).result.jobs, []);
    assert.equal((await f.call({ action: "list", includeArchived: true })).result.jobs.length, 1);
    assert.equal((await f.call({ action: "status", id: done.id })).result.id, done.id);
    const store = await createCliStore(f.project);
    const old = await store.create(
      { action: "download", url: "https://example.invalid/old", configuration: { format: "best" } },
      join(f.project, "downloads"),
    );
    await store.update(old.id, (record) => {
      const { source, requestKey, ...legacy } = record;
      return { ...legacy, status: "completed" };
    });
    assert.equal((await getCliJob(f.project, old.id)).source, "cli");
    assert.equal((await getCliJob(f.project, old.id)).configuration.format, "best");
    const pending = (await f.call(f.request("archive-pending", { start: false }))).result;
    assert.equal((await f.call({ action: "archive", id: pending.id })).ok, true);
    assert.equal(
      (await f.call({ action: "start", id: pending.id, expectedAttempt: 1 })).error.code,
      "JOB_ARCHIVED",
    );
  },
);

test("the service cannot check/start/retry output paths outside its authorized cwd", async (t) => {
  const f = await fixture(t),
    store = await createCliStore(f.project, { create: true });
  const record = await store.create(
    { action: "download", url: "https://example.invalid/external", configuration: {} },
    f.home,
    { pending: true },
  );
  await writeFile(join(f.home, "external.mp4"), "outside project");
  assert.equal(
    (await f.call({ action: "start", id: record.id, expectedAttempt: 1 })).error.code,
    "OUTSIDE_PROJECT",
  );
  await store.update(record.id, (value) => ({
    ...value,
    status: "completed",
    files: [{ path: join(f.home, "external.mp4"), bytes: 15 }],
  }));
  for (const action of ["check", "retry"])
    assert.equal(
      (
        await f.call({
          action,
          id: record.id,
          ...(action === "retry" ? { expectedAttempt: 1 } : {}),
        })
      ).error.code,
      "OUTSIDE_PROJECT",
    );
  assert.equal((await f.call({ action: "status", id: record.id })).ok, true);
  assert.equal((await f.call({ action: "archive", id: record.id })).ok, true);
  assert.equal(await readFile(join(f.home, "external.mp4"), "utf8"), "outside project");
  if (supported) {
    await symlink(f.home, join(f.project, "linked"));
    const rejected = await f.call(
      f.request("symlink", {
        request: {
          url: "https://example.invalid/symlink",
          outputDirectory: join(f.project, "linked", "child"),
        },
      }),
    );
    assert.equal(rejected.error.code, "UNSAFE_PATH");
    await rm(join(f.project, "linked"));
  }
});

test(
  "durable queue pause, FIFO admission, concurrency and cancellation work without a daemon",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t, { delay: 1500 });
    const configured = await f.call({
      action: "configure",
      expectedRevision: 0,
      paused: true,
      maxConcurrent: 1,
    });
    assert.equal(configured.result.revision, 1);
    assert.equal(
      (await f.call({ action: "configure", expectedRevision: 0, paused: false, maxConcurrent: 4 }))
        .error.code,
      "QUEUE_CONFLICT",
    );
    const first = (await f.call(f.request("first"))).result;
    await pause(20);
    const second = (await f.call(f.request("second"))).result;
    const cancelled = (await f.call(f.request("cancel-waiting"))).result;
    await pause(500);
    assert.deepEqual(await f.log(), []);
    assert.equal((await getCliJob(f.project, first.id)).status, "queued");
    assert.equal((await f.call({ action: "archive", id: first.id })).error.code, "JOB_BUSY");
    await f.call({ action: "cancel", id: cancelled.id });
    assert.equal((await f.finish(cancelled.id)).status, "cancelled");
    await f.call({ action: "configure", expectedRevision: 1, paused: false, maxConcurrent: 1 });
    await f.finish(first.id);
    await f.finish(second.id);
    const events = await f.log();
    assert.deepEqual(
      events.filter((event) => event.kind === "start").map((event) => event.name),
      ["first", "second"],
    );
    assert.ok(
      events.find((event) => event.kind === "start" && event.name === "second").at >=
        events.find((event) => event.kind === "done" && event.name === "first").at,
    );
    assert.equal((await f.call({ action: "queue" })).result.maxConcurrent, 1);
    await until(
      () => f.call({ action: "queue" }),
      (value) => value.result.active === 0,
    );
    const readOnly = await main(["queue", "--project", f.project]);
    assert.equal(readOnly.result.revision, 2);
  },
);

test(
  "an unconfirmed stale slot is retained and cannot admit another network operation",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      store = await createCliStore(f.project, { create: true });
    const id = randomUUID(),
      token = randomUUID();
    await writeFile(
      join(store.directory, "queue.json"),
      JSON.stringify({
        schemaVersion: 1,
        revision: 4,
        paused: false,
        maxConcurrent: 1,
        slots: [{ id, attempt: 1, token, pid: 2147483647 }],
      }),
      { mode: 0o600 },
    );
    const task = (await f.call(f.request("blocked"))).result;
    await pause(800);
    assert.deepEqual(await f.log(), []);
    assert.equal((await f.call({ action: "queue" })).result.active, 1);
    await f.call({ action: "cancel", id: task.id });
    assert.equal((await f.finish(task.id)).status, "cancelled");
    assert.equal((await f.call({ action: "queue" })).result.active, 1);
    await assert.rejects(store.releaseSlot(id, 1, token), (error) => error.code === "JOB_BUSY");
  },
);

test(
  "concurrent retries use the expected attempt as a durable receipt",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t, { delay: 700 });
    const original = (await f.call(f.request("retry-once"))).result;
    await f.finish(original.id);
    await until(
      () =>
        stat(join(f.project, ".mimi-download-cli", "jobs", original.id, ".worker.lock")).catch(
          () => null,
        ),
      (value) => !value,
    );
    const retries = await Promise.all(
      Array.from({ length: 10 }, () =>
        f.invoke({ action: "retry", id: original.id, expectedAttempt: 1 }),
      ),
    );
    assert.ok(retries.every((value) => value.ok && value.result.attempt === 2));
    assert.equal((await f.finish(original.id)).status, "completed");
    assert.equal(
      (await f.invoke({ action: "retry", id: original.id, expectedAttempt: 1 })).result.attempt,
      2,
    );
    assert.equal((await f.log()).filter((event) => event.kind === "start").length, 2);
  },
);

test(
  "the default queue admits two workers and a cancelled worker releases only after exit",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t, { delay: 2000 });
    await f.call({ action: "configure", expectedRevision: 0, paused: true, maxConcurrent: 2 });
    const jobs = [];
    for (const name of ["parallel-one", "parallel-two", "parallel-three", "parallel-four"]) {
      jobs.push((await f.call(f.request(name))).result);
      await pause(20);
    }
    const writes = await Promise.all([
      f.call({ action: "configure", expectedRevision: 1, paused: false, maxConcurrent: 2 }),
      f.call({ action: "configure", expectedRevision: 1, paused: false, maxConcurrent: 2 }),
    ]);
    assert.equal(writes.filter((value) => value.ok).length, 1);
    assert.equal(writes.find((value) => !value.ok).error.code, "QUEUE_CONFLICT");
    const initial = await until(
      f.log,
      (events) => events.filter((event) => event.kind === "start").length >= 2,
    );
    assert.deepEqual(
      initial
        .filter((event) => event.kind === "start")
        .slice(0, 2)
        .map((event) => event.name)
        .sort(),
      ["parallel_one", "parallel_two"],
    );
    assert.equal((await f.call({ action: "queue" })).result.active, 2);
    await f.call({ action: "cancel", id: jobs[0].id });
    assert.equal((await f.finish(jobs[0].id)).status, "cancelled");
    for (const job of jobs.slice(1)) assert.equal((await f.finish(job.id)).status, "completed");
    const events = await f.log();
    let active = 0,
      peak = 0;
    for (const event of events) {
      active += event.kind === "start" ? 1 : -1;
      peak = Math.max(peak, active);
    }
    assert.equal(peak, 2);
    assert.equal(active, 0);
    assert.ok(
      events.find((event) => event.kind === "start" && event.name === "parallel_three").at >=
        events.find((event) => event.kind === "cancel" && event.name === "parallel_one").at,
    );
  },
);

test("damaged submission and queue receipts fail closed without starting or replacing work", async (t) => {
  const f = await fixture(t),
    input = f.request("damaged", { start: false });
  const created = (await f.call(input)).result;
  const store = await createCliStore(f.project);
  await rm(join(store.jobsDirectory, created.id, "task.json"));
  const replay = await f.call(input);
  assert.equal(replay.error.code, "SUBMISSION_UNCERTAIN");
  assert.equal(replay.error.jobId, created.id);
  assert.deepEqual(await f.log(), []);
  assert.equal((await f.call({ action: "list" })).result.warnings[0].id, created.id);
  const queuePath = join(store.directory, "queue.json"),
    damaged = '{"schemaVersion":1,"slots":"damaged"}';
  await writeFile(queuePath, damaged, { mode: 0o600 });
  assert.equal(
    (await f.call({ action: "configure", expectedRevision: 0, paused: false, maxConcurrent: 2 }))
      .error.code,
    "INVALID_QUEUE",
  );
  assert.equal(await readFile(queuePath, "utf8"), damaged);
});

test(
  "chat CLI and the panel service operate on the same record and archive",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t);
    const input = join(f.root, "chat.json");
    await writeFile(
      input,
      JSON.stringify({
        url: "https://example.invalid/chat",
        copySuffix: "face1234",
        title: "Chat title",
      }),
    );
    const args = [
      "download",
      "--project",
      f.project,
      "--input-file",
      input,
      "--request-key",
      "chat-stable",
      "--source",
      "chat",
    ];
    const created = (await main(args, { env: f.env })).result;
    assert.equal(created.status, "completed");
    assert.equal(created.source, "chat");
    assert.equal(created.copySuffix, "face1234");
    assert.equal((await main(args, { env: f.env })).result.id, created.id);
    assert.equal((await f.log()).filter((event) => event.kind === "start").length, 1);
    assert.equal((await f.call({ action: "list" })).result.jobs[0].id, created.id);
    assert.equal(
      (await main(["archive", "--project", f.project, "--job", created.id])).result.id,
      created.id,
    );
    assert.deepEqual((await f.call({ action: "list" })).result.jobs, []);
    const malicious = join(f.root, "queue.json");
    await writeFile(
      malicious,
      JSON.stringify({ action: "submit", request: { url: "https://example.invalid/unexpected" } }),
    );
    await assert.rejects(
      main(["queue", "--project", f.project, "--input-file", malicious]),
      (error) => error.code === "INVALID_ARGUMENT",
    );
  },
);

test(
  "a copied installable service launches its own package-local worker adapter",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      installed = join(f.root, "installed-tools"),
      marker = join(f.root, "installed-worker");
    await cp(
      fileURLToPath(new URL("../../../apps/video-download/app/tools/", import.meta.url)),
      installed,
      { recursive: true },
    );
    const adapter = join(installed, "video-download.mjs");
    await writeFile(
      adapter,
      `import { writeFileSync } from 'node:fs';\nif(process.argv.includes('_worker'))writeFileSync(${JSON.stringify(marker)},import.meta.url);\n` +
        (await readFile(adapter, "utf8")),
    );
    const response = await f.invoke(
      f.request("installed"),
      [],
      undefined,
      join(installed, "service.mjs"),
    );
    assert.equal(response.ok, true);
    assert.equal((await f.finish(response.result.id)).status, "completed");
    assert.equal(await readFile(marker, "utf8"), pathToFileURL(adapter).href);
  },
);

test(
  "project-only scope is sealed before a detached worker first reads its mutable record",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      installed = join(f.root, "delayed-tools"),
      barrier = join(f.root, "worker-barrier");
    await cp(
      fileURLToPath(new URL("../../../apps/video-download/app/tools/", import.meta.url)),
      installed,
      { recursive: true },
    );
    await writeFile(barrier, "wait");
    const adapter = join(installed, "video-download.mjs");
    await writeFile(
      adapter,
      `import { access as barrierAccess } from 'node:fs/promises';\nif(process.argv.includes('_worker'))while(await barrierAccess(${JSON.stringify(barrier)}).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,20));\n` +
        (await readFile(adapter, "utf8")),
    );
    const response = await f.invoke(
      f.request("sealed-initial"),
      [],
      undefined,
      join(installed, "service.mjs"),
    );
    assert.equal(response.ok, true);
    const store = await createCliStore(f.project);
    await store.update(response.result.id, (record) => ({
      ...record,
      outputDirectory: f.home,
      source: "cli",
    }));
    await rm(barrier);
    const stopped = await f.finish(response.result.id);
    assert.equal(stopped.status, "failed");
    assert.equal(stopped.error.code, "INPUT_CHANGED");
    assert.deepEqual(await f.log(), []);
    assert.deepEqual(await readdir(f.home), []);
    await until(() => f.call({ action: "queue" }), (value) => value.result.active === 0);
  },
);

test(
  "paused queues have no worker and resume revalidates output authority before reservation",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t);
    await f.call({ action: "configure", expectedRevision: 0, paused: true, maxConcurrent: 1 });
    const submitted = (await f.call(f.request("sealed-waiting"))).result;
    const store = await createCliStore(f.project);
    assert.equal((await store.read(submitted.id)).workerToken, undefined);
    assert.equal(await stat(join(store.jobsDirectory, submitted.id, ".worker.lock")).catch(() => null), null);
    await store.update(submitted.id, (record) => ({
      ...record,
      outputDirectory: f.home,
      source: "cli",
      request: { ...record.request, url: "https://example.invalid/replaced-request" },
    }));
    await f.call({ action: "configure", expectedRevision: 1, paused: false, maxConcurrent: 1 });
    // Resume cannot turn mutable source labels into an external-directory grant.
    assert.equal((await getCliJob(f.project, submitted.id)).status, "queued");
    assert.equal((await store.getQueue()).active, 0);
    assert.deepEqual(await f.log(), []);
    assert.deepEqual(await readdir(f.home), []);
    await f.call({ action: "cancel", id: submitted.id });
    await assert.rejects(
      main(["jobs", "--project", f.project, "--restricted-output", "project"]),
      (error) => error.code === "INVALID_ARGUMENT",
    );
  },
);

test(
  "standalone CLI keeps explicit external outputs while service restrictions ignore source labels",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      input = join(f.root, "external-cli.json");
    await writeFile(
      input,
      JSON.stringify({ url: "https://example.invalid/external-cli", outputDirectory: f.home }),
    );
    const result = (
      await main(
        [
          "download",
          "--project",
          f.project,
          "--input-file",
          input,
          "--source",
          "panel",
          "--background",
        ],
        { env: f.env },
      )
    ).result;
    const completed = await f.finish(result.id);
    assert.equal(completed.status, "completed");
    assert.equal(await readFile(completed.files[0].path, "utf8"), "fixture media external_cli");
    assert.equal(
      (
        await f.call(
          f.request("restricted-label", {
            source: "cli",
            request: { url: "https://example.invalid/restricted-label", outputDirectory: f.home },
          }),
        )
      ).error.code,
      "OUTSIDE_PROJECT",
    );
  },
);

test(
  "FIFO orders freshly started pending tasks and retries by queued time",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t, { delay: 600 }),
      input = join(f.root, "old.json");
    await writeFile(input, JSON.stringify({ url: "https://example.invalid/old-retry" }));
    const oldRetry = (
      await main(["download", "--project", f.project, "--input-file", input], { env: f.env })
    ).result;
    const oldPending = (await f.call(f.request("old-pending", { start: false }))).result;
    await f.call({ action: "configure", expectedRevision: 0, paused: true, maxConcurrent: 1 });
    const recent = (await f.call(f.request("recent-queued"))).result;
    await pause(30);
    const started = (await f.call({ action: "start", id: oldPending.id, expectedAttempt: 1 }))
      .result;
    await pause(30);
    const retried = (await f.call({ action: "retry", id: oldRetry.id, expectedAttempt: 1 })).result;
    assert.ok(started.queuedAt > recent.queuedAt);
    assert.ok(retried.queuedAt > started.queuedAt);
    await f.call({ action: "configure", expectedRevision: 1, paused: false, maxConcurrent: 1 });
    for (const job of [recent, started, retried])
      assert.equal((await f.finish(job.id)).status, "completed");
    assert.deepEqual(
      (await f.log()).filter((event) => event.kind === "start").map((event) => event.name),
      ["old_retry", "recent_queued", "old_pending", "old_retry"],
    );
  },
);

test(
  "incomplete sibling records do not poison admission or release an unconfirmed slot",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      store = await createCliStore(f.project, { create: true });
    const empty = randomUUID(),
      damaged = randomUUID();
    for (const id of [empty, damaged]) await mkdir(join(store.jobsDirectory, id), { mode: 0o700 });
    await writeFile(join(store.jobsDirectory, damaged, "task.json"), "{invalid", { mode: 0o600 });
    const normal = (await f.call(f.request("beside-damaged"))).result;
    assert.equal((await f.finish(normal.id)).status, "completed");
    const listed = (await f.call({ action: "list" })).result;
    assert.deepEqual(
      new Set(listed.warnings.map((warning) => warning.id)),
      new Set([empty, damaged]),
    );
    await until(
      () => f.call({ action: "queue" }),
      (value) => value.result.active === 0,
    );
    await writeFile(
      join(store.directory, "queue.json"),
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        paused: false,
        maxConcurrent: 1,
        slots: [{ id: damaged, attempt: 1, token: randomUUID(), pid: 2147483647 }],
      }),
      { mode: 0o600 },
    );
    const blocked = (await f.call(f.request("blocked-by-damaged-slot"))).result;
    await pause(600);
    assert.equal((await f.log()).filter((event) => event.kind === "start").length, 1);
    assert.equal((await f.call({ action: "queue" })).result.active, 1);
    await f.call({ action: "cancel", id: blocked.id });
    assert.equal((await f.finish(blocked.id)).status, "cancelled");
    assert.equal((await f.call({ action: "queue" })).result.active, 1);
  },
);

test("simulated Windows leader confirmation rejects implicit probe and output-limit termination", () => {
  const closed = { closed: true, signalFailed: false, terminationRequested: false };
  assert.equal(ungroupedExitConfirmed(closed, { platform: "win32" }), true);
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    // A probe/output limit can kill the leader without aborting the worker's
    // controller. Its close receipt still cannot prove descendants exited.
    assert.equal(
      ungroupedExitConfirmed(
        { ...closed, terminationRequested: true, lastSignal: signal },
        { platform: "win32", cancelled: false },
      ),
      false,
    );
  }
  assert.equal(ungroupedExitConfirmed(closed, { platform: "win32", cancelled: true }), false);
  assert.equal(ungroupedExitConfirmed({ ...closed, closed: false }, { platform: "win32" }), false);
  assert.equal(
    ungroupedExitConfirmed({ ...closed, signalFailed: true }, { platform: "win32" }),
    false,
  );
  assert.equal(ungroupedExitConfirmed(closed, { platform: "linux" }), false);
});

test("atomic record replacement remains readable during concurrent snapshots", async (t) => {
  const f = await fixture(t),
    store = await createCliStore(f.project, { create: true });
  const record = await store.create(
    { action: "download", url: "https://example.invalid/snapshots", configuration: {} },
    join(f.project, "downloads"),
    { pending: true },
  );
  const writer = (async () => {
    for (let index = 0; index < 120; index++)
      await store.update(record.id, (current) => ({
        ...current,
        title: String(index),
        updatedAt: Date.now(),
      }));
  })();
  const readers = Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let index = 0; index < 150; index++) {
        const snapshot = await getCliJob(f.project, record.id);
        assert.equal(snapshot.id, record.id);
        assert.ok(snapshot.title === "" || /^\d+$/u.test(snapshot.title));
      }
    }),
  );
  await Promise.all([writer, readers]);
});

test("bounded listings retain older active work before recent terminal history", async (t) => {
  const f = await fixture(t),
    store = await createCliStore(f.project, { create: true });
  const pending = await store.create(
    { action: "download", url: "https://example.invalid/old-pending", configuration: {} },
    join(f.project, "downloads"),
    { pending: true },
  );
  const queued = await store.create(
    { action: "download", url: "https://example.invalid/old-queued", configuration: {} },
    join(f.project, "downloads"),
  );
  await store.update(pending.id, (record) => ({ ...record, createdAt: 1 }));
  await store.update(queued.id, (record) => ({ ...record, createdAt: 2 }));
  for (let index = 0; index < 6; index++) {
    const terminal = await store.create(
      { action: "download", url: `https://example.invalid/history-${index}`, configuration: {} },
      join(f.project, "downloads"),
    );
    await store.update(terminal.id, (record) => ({
      ...record,
      status: "completed",
      createdAt: 100 + index,
    }));
  }
  const listed = await listCliJobs(f.project, { limit: 2 });
  assert.deepEqual(new Set(listed.jobs.map((job) => job.id)), new Set([pending.id, queued.id]));
  assert.equal(listed.truncated, true);
});

test("ten queued records create only two real IPC workers; crashes retain exact slots and reads never pump", { timeout: 20_000 }, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mimi-pump-ipc-")));
  const store = await createCliStore(root, { create: true }), workers = [];
  t.after(async () => {
    for (const owned of workers) {
      if (owned.child.exitCode === null && owned.child.signalCode === null) owned.child.kill("SIGKILL");
      await owned.exited;
    }
    await rm(root, { recursive: true, force: true });
  });
  for (let i = 0; i < 10; i++) {
    const record = await store.create({ action: "download", url: `https://example.invalid/${i}`, configuration: {} }, join(root, "downloads"));
    await store.update(record.id, (value) => ({ ...value, queuedAt: i + 1 }));
  }
  const launch = async (record, slot) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../../helpers/download-slot-worker.mjs", import.meta.url)),
      root, record.id, String(record.attempt), slot.token, "fixture-boot-a"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    const ready = new Promise((resolve, reject) => {
      child.once("message", (message) => message.type === "claimed" ? resolve(message) : reject(new Error("bad IPC")));
      child.once("error", reject);
      child.once("exit", () => reject(new Error("worker exited before claim")));
    });
    workers.push({ child, ready, exited, record, slot });
  };
  await store.pump(launch, { bootId: "fixture-boot-a" });
  await Promise.all(workers.map((owned) => owned.ready));
  assert.equal(workers.length, 2);
  assert.equal((await store.getQueue()).active, 2);
  const all = await listCliJobs(root);
  assert.equal(all.jobs.filter((job) => job.status === "running").length, 2);
  assert.equal(all.jobs.filter((job) => job.status === "queued").length, 8);
  await store.pump(launch, { bootId: "fixture-boot-a" });
  assert.equal(workers.length, 2, "additional pumps do not create waiting workers");
  const first = workers[0];
  first.child.kill("SIGKILL");
  await first.exited;
  const queuePath = join(store.directory, "queue.json"), before = await readFile(queuePath);
  const diagnostic = await store.diagnoseSlots();
  assert.equal(diagnostic.stalled, 1);
  assert.equal(diagnostic.slots.find((slot) => slot.id === first.record.id).pidState, "absent");
  await main(["doctor", "--slots", "--project", root]);
  await getCliJob(root, first.record.id);
  await listCliJobs(root);
  assert.deepEqual(await readFile(queuePath), before);
  await store.pump(launch, { bootId: "fixture-boot-a" });
  assert.equal(workers.length, 2, "dead PID is not a process-tree exit proof");
  await assert.rejects(store.recoverSlot({ ...first.slot, token: randomUUID(), confirmed: true }), { code: "SLOT_CONFLICT" });
  assert.deepEqual(await readFile(queuePath), before);
  const recovered = await main(["recover-slot", "--project", root, "--job", first.slot.id,
    "--attempt", String(first.slot.attempt), "--token", first.slot.token, "--confirm"]);
  assert.equal(recovered.ok, true);
  assert.equal((await store.read(first.record.id)).status, "interrupted");
  assert.equal((await store.getQueue()).active, 1);
  await assert.rejects(store.recoverSlot({ ...workers[1].slot, confirmed: true }), { code: "JOB_BUSY" });
  // The other captured child is killed and awaited before simulated boot identity
  // changes. Injection exercises the decision, never kills unrelated processes.
  workers[1].child.kill("SIGKILL");
  await workers[1].exited;
  const queue = await store.getQueue();
  await store.configureQueue({ expectedRevision: queue.revision, paused: true, maxConcurrent: 2 });
  await store.pump(launch, { bootId: "fixture-boot-b" });
  assert.equal((await store.getQueue()).active, 0);
  assert.equal((await store.read(workers[1].record.id)).status, "interrupted");
  assert.equal(workers.length, 2);
});

test("expired starting tokens are fenced before replacement and queued age is not runtime age", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mimi-starting-cas-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await createCliStore(root, { create: true });
  const record = await store.create({ action: "download", url: "https://example.invalid/late", configuration: {} }, join(root, "downloads"));
  await store.update(record.id, (value) => ({ ...value, createdAt: 1, heartbeatAt: 1, updatedAt: 1 }));
  assert.equal((await getCliJob(root, record.id)).status, "queued");
  let oldSlot, newSlot;
  await store.pump(async (_, slot) => { oldSlot = slot; }, { now: 1, bootId: "same-boot" });
  await store.pump(async (_, slot) => { newSlot = slot; }, { now: 60_002, bootId: "same-boot" });
  assert.notEqual(oldSlot.token, newSlot.token);
  await assert.rejects(store.admitWorker(record.id, 1, oldSlot.token), { code: "WORKER_REJECTED" });
  assert.equal(await store.admitWorker(record.id, 1, newSlot.token), true);
  await assert.rejects(store.admitWorker(record.id, 1, newSlot.token), { code: "WORKER_REJECTED" });
  await store.releaseSlot(record.id, 1, newSlot.token);
});


test("the real runtime spawns two workers for ten queued downloads behind a filesystem readiness barrier", { skip: !supported, timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.bin, "yt-dlp"), `#!${process.execPath}
const fs=require('node:fs'), args=process.argv.slice(2);
if(args.includes('--version')){console.log('2026.10.15');process.exit(0);}
if(args.includes('--help')){console.log('--js-runtimes');process.exit(0);}
const marker=process.env.MIMI_EVENTS+'.ready-'+process.pid;
fs.writeFileSync(marker,JSON.stringify({pid:process.pid,worker:process.ppid}));
process.on('SIGTERM',()=>process.exit(0));
setInterval(()=>{},1000);
`, { mode: 0o700 });
  await f.call({ action: "configure", expectedRevision: 0, paused: true, maxConcurrent: 2 });
  const jobs = [];
  for (let i = 0; i < 10; i++) jobs.push((await f.call(f.request(`barrier-${i}`))).result);
  const store = await createCliStore(f.project);
  assert.equal((await store.getQueue()).active, 0);
  assert.equal((await Promise.all(jobs.map((job) => store.read(job.id)))).filter((job) => job.workerToken).length, 0);
  await f.call({ action: "configure", expectedRevision: 1, paused: false, maxConcurrent: 2 });
  // Downloaders stay at this explicit barrier until cancellation. Polling only
  // observes the receipt; no duration-based assumption lets the assertion pass.
  const names = await until(async () => (await readdir(f.root))
    .filter((name) => name.startsWith("events.ready-")), (names) => names.length >= 2);
  assert.equal(names.length, 2);
  const records = await Promise.all(jobs.map((job) => store.read(job.id)));
  assert.equal(records.filter((job) => job.workerToken).length, 2);
  const locks = await Promise.all(jobs.map((job) => stat(join(store.jobsDirectory, job.id, ".worker.lock")).catch(() => null)));
  assert.equal(locks.filter(Boolean).length, 2, "there are no worker processes parked on the eight waiting records");
  const diagnostic = await store.diagnoseSlots();
  assert.equal(diagnostic.active, 2);
  const downloaderParents = await Promise.all(names.map(async (name) => JSON.parse(await readFile(join(f.root, name), "utf8")).worker));
  assert.deepEqual(new Set(diagnostic.slots.map((slot) => slot.pid)), new Set(downloaderParents));
  await f.call({ action: "configure", expectedRevision: 2, paused: true, maxConcurrent: 2 });
  for (const job of jobs) await f.call({ action: "cancel", id: job.id });
  for (const job of jobs) assert.equal((await f.finish(job.id)).status, "cancelled");
});

async function legacyWaiter(root, record, token, workers) {
  const module = new URL("../../fixtures/video-download-0.24.1/cli-store.mjs", import.meta.url).href;
  assert.equal(createHash("sha256").update(await readFile(new URL(module))).digest("hex"), "8bed5d8ad61a80ed0c8e7f3351bae71b57dac73986b4690b6f20c2497ecc06ed", "immutable actual 0.24.1 source");
  const source = `import { createCliStore } from ${JSON.stringify(module)};
const store = await createCliStore(${JSON.stringify(root)}), id=${JSON.stringify(record.id)}, token=${JSON.stringify(token)};
const release = await store.claimWorker(id,1,token);
process.on('message',async command=>{try {
 if(command==='admit') process.send({type:'admitted',value:await store.admitWorker(id,1,token)});
 if(command==='release'){await store.releaseSlot(id,1,token);await release();process.send({type:'released'});process.disconnect();}
}catch(error){process.send({type:'error',code:error.code,message:error.message});}});
process.send({type:'ready',pid:process.pid});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const exited = new Promise(resolveExit => child.once("exit", resolveExit));
  workers.push({ child, exited });
  const ready = await new Promise((resolveReady, reject) => {
    child.once("message", resolveReady); child.once("error", reject);
    child.once("exit", () => reject(new Error("legacy fixture exited before ready")));
  });
  assert.equal(ready.type, "ready");
  return { child, exited, send: command => new Promise(resolveMessage => { child.once("message", resolveMessage); child.send(command); }) };
}

test("0.24.1 waiting workers read new starting slots, keep capacity, and exact orphan recovery unblocks retry", { timeout: 20_000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mimi-old-waiter-"))), workers = [];
  t.after(async () => { for (const owned of workers) { if (owned.child.exitCode === null && owned.child.signalCode === null) owned.child.kill("SIGKILL"); await owned.exited; } await rm(root, { recursive: true, force: true }); });
  const store = await createCliStore(root, { create: true });
  const request = index => ({ action: "download", url: `https://example.invalid/upgrade-${index}`, configuration: {} });
  const old = await store.create(request(0), join(root, "downloads")), token = randomUUID();
  await store.update(old.id, record => ({ ...record, workerToken: token }));
  const waiter = await legacyWaiter(root, old, token, workers);
  for (let i = 1; i < 10; i++) await store.create(request(i), join(root, "downloads"));
  const reservations = [];
  await store.pump(async (record, slot) => reservations.push({ record, slot }));
  assert.equal(reservations.length, 1, "the existing legacy waiter consumes the other FIFO slot without another spawn");
  assert.deepEqual(await waiter.send("admit"), { type: "admitted", value: true }, "real 0.24.1 parser accepts the new starting slot instead of INVALID_QUEUE");
  assert.equal((await store.getQueue()).active, 2);
  assert.deepEqual(await waiter.send("release"), { type: "released" });
  await waiter.exited;
  await store.update(old.id, ({ workerToken, ...record }) => ({ ...record, status: "completed" }));
  await store.pump(async (record, slot) => reservations.push({ record, slot }));
  assert.equal(reservations.length, 2);
  const orphan = await store.create(request(10), join(root, "downloads")), orphanToken = randomUUID();
  await store.update(orphan.id, record => ({ ...record, workerToken: orphanToken }));
  const orphanWaiter = await legacyWaiter(root, orphan, orphanToken, workers);
  const diagnostic = await store.diagnoseSlots();
  assert.equal(diagnostic.orphanWorkers[0].pidState, "present");
  assert.equal(diagnostic.orphanWorkers[0].token, orphanToken);
  assert.deepEqual(await orphanWaiter.send("admit"), { type: "admitted", value: false });
  await assert.rejects(store.recoverSlot({ id: orphan.id, attempt: 1, token: orphanToken, confirmed: true }), { code: "JOB_BUSY" });
  orphanWaiter.child.kill("SIGKILL"); await orphanWaiter.exited;
  const before = await readFile(join(store.jobsDirectory, orphan.id, ".worker.lock", "owner.json"));
  assert.equal((await store.diagnoseSlots()).orphanWorkers[0].pidState, "absent");
  assert.deepEqual(await readFile(join(store.jobsDirectory, orphan.id, ".worker.lock", "owner.json")), before, "doctor is pure read");
  await assert.rejects(store.recoverSlot({ id: orphan.id, attempt: 1, token: randomUUID(), confirmed: true }), { code: "SLOT_CONFLICT" });
  await store.recoverSlot({ id: orphan.id, attempt: 1, token: orphanToken, confirmed: true });
  await store.verifyNoWorker(orphan.id);
  assert.equal((await store.read(orphan.id)).status, "interrupted");
  assert.equal((await store.diagnoseSlots()).orphanWorkers.length, 0);
  assert.equal((await store.getQueue()).active, 2, "recovering an orphan never releases somebody else's slots");
});

test("changed boot identity never clears a live PID or its worker lock, but confirmed death can recover", { timeout: 15_000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mimi-boot-live-"))), workers = [];
  t.after(async () => { for (const owned of workers) { if (owned.child.exitCode === null && owned.child.signalCode === null) owned.child.kill("SIGKILL"); await owned.exited; } await rm(root, { recursive: true, force: true }); });
  const store = await createCliStore(root, { create: true });
  const record = await store.create({ action: "download", url: "https://example.invalid/boot", configuration: {} }, join(root, "downloads"));
  let child, exited, ready;
  await store.pump(async (record, slot) => {
    child = spawn(process.execPath, [fileURLToPath(new URL("../../helpers/download-slot-worker.mjs", import.meta.url)), root, record.id, "1", slot.token, "boot-old"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    exited = new Promise(resolveExit => child.once("exit", resolveExit)); workers.push({ child, exited });
    ready = new Promise(resolveReady => child.once("message", resolveReady));
  }, { bootId: "boot-old" });
  await ready;
  const queuePath = join(store.directory, "queue.json"), lockPath = join(store.jobsDirectory, record.id, ".worker.lock", "owner.json");
  const queueBefore = await readFile(queuePath), lockBefore = await readFile(lockPath);
  await store.pump(async () => assert.fail("must not spawn"), { bootId: "boot-new" });
  assert.deepEqual(await readFile(queuePath), queueBefore);
  assert.deepEqual(await readFile(lockPath), lockBefore);
  child.kill("SIGKILL"); await exited;
  await store.pump(async () => assert.fail("interrupted work requires explicit retry"), { bootId: "boot-new" });
  assert.equal((await store.getQueue()).active, 0);
  assert.equal((await store.read(record.id)).status, "interrupted");
  await store.verifyNoWorker(record.id);
});

test("one malformed or unreadable slot stays occupied while unrelated free capacity progresses", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mimi-isolated-slot-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await createCliStore(root, { create: true });
  const bad = { id: "bad-owner", note: "retain evidence" };
  await writeFile(join(store.directory, "queue.json"), JSON.stringify({ schemaVersion: 1, revision: 0, paused: false, maxConcurrent: 2, slots: [bad] }), { mode: 0o600 });
  await store.create({ action: "download", url: "https://example.invalid/good", configuration: {} }, join(root, "downloads"));
  let started = 0;
  const result = await store.pump(async () => { started++; });
  assert.equal(started, 1);
  assert.equal(result.active, 2);
  assert.equal(result.warnings[0].code, "INVALID_SLOT");
  assert.deepEqual(JSON.parse(await readFile(join(store.directory, "queue.json"), "utf8")).slots[0], bad);
  assert.equal((await store.diagnoseSlots()).slots[0].invalid, true);
});

test("project-external queued work is visible and resumes only through explicit CLI output authorization", { timeout: 15_000 }, async t => {
  const f = await fixture(t, { delay: 20 }), outside = join(f.root, "external-output");
  await mkdir(outside);
  const store = await createCliStore(f.project, { create: true });
  const record = await store.create(parseDownloadRequest({ action: "download", url: "https://example.invalid/external-resume", configuration: {} }), outside);
  const listed = await f.call({ action: "list" });
  assert.equal(listed.result.queue.warnings[0].id, record.id);
  assert.equal(listed.result.queue.warnings[0].code, "OUTPUT_AUTHORIZATION_REQUIRED");
  const limited = await main(["pump", "--project", f.project], { env: f.env });
  assert.equal(limited.result.warnings[0].code, "OUTPUT_AUTHORIZATION_REQUIRED");
  assert.equal((await store.read(record.id)).workerToken, undefined);
  await main(["pump", "--project", f.project, "--allow-outside-project"], { env: f.env });
  await until(() => getCliJob(f.project, record.id), value => value.status === "completed");
  assert.equal((await f.log()).filter(event => event.kind === "start").length, 1);
  await until(() => store.getQueue(), queue => queue.active === 0);
});

test("competing pumps serialize on the real queue lock without manual-recovery errors or duplicate reservations", { timeout: 15_000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mimi-pump-compete-")));
  const store = await createCliStore(root, { create: true });
  await store.configureQueue({ expectedRevision: 0, paused: false, maxConcurrent: 1 });
  await store.create({ action: "download", url: "https://example.invalid/compete", configuration: {} }, join(root, "downloads"));
  const module = new URL("../../../apps/video-download/app/tools/cli-store.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import {createCliStore} from ${JSON.stringify(module)};
const store=await createCliStore(${JSON.stringify(root)});
await store.pump(async()=>{process.send('reserved');await new Promise(resolve=>process.once('message',resolve));});
process.send('done',()=>process.disconnect());`], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const exited = new Promise(resolveExit => child.once("exit", resolveExit));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; await rm(root, { recursive: true, force: true }); });
  assert.equal(await new Promise(resolveReady => child.once("message", resolveReady)), "reserved");
  let extraSpawns = 0;
  const competing = store.pump(async () => { extraSpawns++; });
  child.send("release");
  assert.equal((await competing).active, 1);
  assert.equal(extraSpawns, 0);
  await exited;
});
