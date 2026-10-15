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
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  handleServiceRequest,
  readServiceInput,
} from "../../../apps/video-download/app/tools/service.mjs";
import { main } from "../../../apps/video-download/app/tools/video-download.mjs";
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
    assert.equal(
      await readFile(marker, "utf8"),
    pathToFileURL(adapter).href,
    );
  },
);
