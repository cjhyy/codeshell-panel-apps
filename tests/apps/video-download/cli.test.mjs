import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import {
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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../../../apps/video-download/app/tools/video-download.mjs";
import {
  createCliStore,
  getCliJob,
  listCliJobs,
  requestCliCancellation,
} from "../../../apps/video-download/app/tools/cli-store.mjs";

const entry = fileURLToPath(
  new URL("../../../apps/video-download/app/tools/video-download.mjs", import.meta.url),
);
const supported = process.platform !== "win32";
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function until(operation, predicate, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await operation();
    if (predicate(result)) return result;
    await pause(80);
  }
  assert.fail("fixture operation did not settle before its deadline");
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mimi-cli-test-")));
  const project = join(root, "project"),
    home = join(root, "home"),
    bin = join(root, "bin"),
    exitFile = join(root, "download-exited");
  for (const directory of [project, home, bin]) await mkdir(directory, { mode: 0o700 });
  const fake = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2026.10.15'); process.exit(0); }
if (args.includes('--help')) { console.log(process.env.MIMI_TEST_OLD_YTDLP?'old version help':'--js-runtimes RUNTIME[:PATH]'); process.exit(0); }
if (process.env.MIMI_TEST_ARGS_FILE) fs.appendFileSync(process.env.MIMI_TEST_ARGS_FILE,JSON.stringify(args)+'\\n');
const target = args.at(-1);
if (args.includes('--dump-single-json')) {
  if (target.startsWith('ytsearch') || target.startsWith('bilisearch')) {
    const youtube = target.startsWith('ytsearch');
    console.log(JSON.stringify({entries:[{id:youtube?'abcdefghijk':'BV1234567890',title:'Fixture video',uploader:'Fixture author',duration:42,webpage_url:youtube?'https://www.youtube.com/watch?v=abcdefghijk':'https://www.bilibili.com/video/BV1234567890/'}]}));
  } else console.log(JSON.stringify({id:'fixture',title:'Fixture video',duration:42,uploader:'Fixture author',formats:[{height:720},{height:1080}]}));
  process.exit(0);
}
if (target.includes('failed')) { console.error('upstream private token=never-persist-this'); process.exit(1); }
if(process.env.MIMI_TEST_NESTED_CHECK){const nested=require('node:child_process').spawnSync('ffmpeg',['-version'],{encoding:'utf8'});if(nested.status!==0||!nested.stdout.includes('fixture'))process.exit(9);}
if(process.env.MIMI_TEST_GRANDCHILD_FILE){const nested=require('node:child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.env.MIMI_TEST_GRANDCHILD_FILE+'.ready','ready');setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(process.env.MIMI_TEST_GRANDCHILD_FILE,String(nested.pid));}
let timer;
const partial=path.join(process.cwd(),'fixture.mp4.part'), resume=fs.existsSync(partial);
fs.writeFileSync(partial,'retained partial bytes');
fs.writeFileSync(process.env.MIMI_TEST_STARTED_FILE,target);
const done = () => { fs.writeFileSync(path.join(process.cwd(),'fixture.mp4'),'real fixture media bytes');fs.unlinkSync(partial);if(resume)fs.writeFileSync(process.env.MIMI_TEST_EXIT_FILE,'resumed'); process.stdout.write('progress: 100%\\n'); process.exit(0); };
process.on('SIGTERM',()=>{clearTimeout(timer);setTimeout(()=>{fs.writeFileSync(process.env.MIMI_TEST_EXIT_FILE,'terminated');process.exit(0);},200);});
process.stdout.write('progress: 25%\\n');
timer=setTimeout(done,target.includes('slow')&&!resume?30000:target.includes('moderate')?1800:20);
`;
  await writeFile(join(bin, "yt-dlp"), fake, { mode: 0o700 });
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
    MIMI_TEST_EXIT_FILE: exitFile,
    MIMI_TEST_STARTED_FILE: join(root, "started"),
    MIMI_TEST_ARGS_FILE: join(root, "arguments"),
    LANG: "C.UTF-8",
  };
  const request = async (value, name = "input.json") => {
    const path = join(root, name);
    await writeFile(path, JSON.stringify(value));
    return path;
  };
  const processes = new Set();
  const invoke = (args, { expected = 0, extraEnv = {} } = {}) =>
    new Promise((resolveCommand, reject) => {
      const child = spawn(process.execPath, [entry, ...args], {
        env: { ...env, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
      });
      processes.add(child);
      let stdout = "",
        stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("CLI fixture timed out"));
      }, 18_000);
      child.stdout.on("data", (text) => {
        stdout += text;
      });
      child.stderr.on("data", (text) => {
        stderr += text;
      });
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timer);
        processes.delete(child);
        try {
          assert.equal(code, expected, stdout + stderr);
          resolveCommand({ json: JSON.parse(stdout), stdout, stderr, code });
        } catch (error) {
          reject(error);
        }
      });
    });
  t.after(async () => {
    for (const child of processes) child.kill("SIGTERM");
    const { jobs } = await listCliJobs(project).catch(() => ({ jobs: [] }));
    for (const job of jobs)
      if (["queued", "running"].includes(job.status)) {
        await requestCliCancellation(project, job.id);
        await until(
          () => getCliJob(project, job.id),
          (value) => !["queued", "running"].includes(value.status),
        );
      }
    await rm(root, { recursive: true, force: true });
  });
  return { root, project, home, bin, env, exitFile, request, invoke };
}

test("ops and read-only empty listing do not create project state; explicit project/input limits are enforced", async (t) => {
  const f = await fixture(t);
  assert.ok((await main(["ops"])).result.commands.includes("download"));
  assert.deepEqual((await listCliJobs(f.project)).jobs, []);
  assert.deepEqual(await readdir(f.project), []);
  await assert.rejects(
    main([
      "download",
      "--project",
      f.project,
      "--input-file",
      await f.request({ url: "file:///bad" }),
    ]),
    /HTTP|网址/,
  );
  assert.deepEqual(await readdir(f.project), []);
  await assert.rejects(main(["jobs"]), (error) => error.code === "INVALID_ARGUMENT");
  await assert.rejects(
    main(["status", "--project", f.project, "--job", "../../escape"]),
    (error) => error.code === "INVALID_JOB",
  );
  const large = join(f.root, "large.json");
  await writeFile(large, " ".repeat(33 * 1024));
  await assert.rejects(
    main(["inspect", "--project", f.project, "--input-file", large]),
    (error) => error.code === "INVALID_INPUT",
  );
  assert.deepEqual(await readdir(f.project), []);
});

test(
  "doctor/inspect/search run local fixtures with no Host data or model credentials",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      base = ["--project", f.project];
    const doctor = await f.invoke(["doctor", ...base]);
    assert.equal(doctor.json.result.dependencies["yt-dlp"].available, true);
    assert.equal(doctor.json.result.dependencies.ffmpeg.available, true);
    assert.equal(
      doctor.json.result.javascriptRuntime.enabled,
      Number(process.versions.node.split(".")[0]) >= 22,
    );
    const inspect = await f.invoke([
      "inspect",
      ...base,
      "--input-file",
      await f.request({ url: "https://example.invalid/video" }),
    ]);
    assert.equal(inspect.json.result.title, "Fixture video");
    assert.deepEqual(inspect.json.result.resolutions, [1080, 720]);
    const search = await f.invoke([
      "search",
      ...base,
      "--input-file",
      await f.request({ query: "fixture", platform: "both", limit: 2 }),
    ]);
    assert.equal(search.json.result.candidates.length, 2);
    assert.ok(search.json.result.candidates.every((row) => row.evidence === "platform-search"));
    const invocations = (await readFile(f.env.MIMI_TEST_ARGS_FILE, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.ok(
      invocations.every(
        (args) =>
          args.includes("--js-runtimes") === Number(process.versions.node.split(".")[0]) >= 22,
      ),
    );
    assert.deepEqual(await readdir(f.project), []);
    assert.deepEqual(await readdir(f.home), []);
  },
);

test("search reuses bounded public sources when local platform lookup is unavailable", async (t) => {
  const f = await fixture(t);
  const requests = [];
  const result = await main(
    [
      "search",
      "--project",
      f.project,
      "--input-file",
      await f.request({ query: "fixture", platform: "bilibili", limit: 1 }),
    ],
    {
      env: { PATH: "" },
      fetcher: async (url) => {
        requests.push(String(url));
        return new Response(
          "<rss><channel><item><title>Indexed fixture</title><link>https://www.bilibili.com/video/BV1234567890/</link></item></channel></rss>",
          { status: 200 },
        );
      },
    },
  );
  assert.equal(result.result.candidates[0].evidence, "search-index");
  assert.ok(requests.every((url) => url.startsWith("https://www.bing.com/search?")));
});

test(
  "explicit bin directory reaches yt-dlp subprocesses and older engines omit unsupported JS flags",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t);
    const args = [
      "download",
      "--project",
      f.project,
      "--bin-dir",
      f.bin,
      "--input-file",
      await f.request({ url: "https://example.invalid/video", configuration: { format: "audio" } }),
    ];
    const response = await f.invoke(args, {
      extraEnv: { PATH: "", MIMI_TEST_NESTED_CHECK: "1", MIMI_TEST_OLD_YTDLP: "1" },
    });
    assert.equal(response.json.result.status, "completed");
    const invocation = JSON.parse(
      (await readFile(f.env.MIMI_TEST_ARGS_FILE, "utf8")).trim().split("\n").at(-1),
    );
    assert.equal(invocation.includes("--js-runtimes"), false);
    assert.equal(invocation.includes("--extract-audio"), true);
  },
);

test(
  "foreground download records verified real paths and check detects removed files; retry creates a new attempt",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      base = ["--project", f.project];
    const downloaded = await f.invoke([
      "download",
      ...base,
      "--input-file",
      await f.request({ url: "https://example.invalid/video", configuration: { format: "1080" } }),
    ]);
    const record = downloaded.json.result;
    assert.equal(record.status, "completed");
    assert.equal(record.attempt, 1);
    assert.equal(await readFile(record.files[0].path, "utf8"), "real fixture media bytes");
    assert.match(record.files[0].sha256, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(record).includes("assetId"));
    assert.ok(!JSON.stringify(record).includes("workerToken"));
    assert.ok(downloaded.stderr.includes('"type":"progress"'));
    assert.equal(
      (await f.invoke(["check", ...base, "--job", record.id])).json.result.files[0].status,
      "present",
    );
    await rm(record.files[0].path);
    assert.equal(
      (await f.invoke(["check", ...base, "--job", record.id])).json.result.files[0].status,
      "missing",
    );
    const retried = (await f.invoke(["retry", ...base, "--job", record.id])).json.result;
    assert.equal(retried.id, record.id);
    assert.equal(retried.attempt, 2);
    assert.equal(retried.status, "completed");
    assert.equal((await listCliJobs(f.project)).jobs.length, 1);
    for (const path of [
      join(f.project, ".mimi-download-cli"),
      join(f.project, ".mimi-download-cli", "jobs", record.id),
    ])
      assert.equal((await stat(path)).mode & 0o077, 0);
    assert.equal(
      (await stat(join(f.project, ".mimi-download-cli", "jobs", record.id, "task.json"))).mode &
        0o077,
      0,
    );
  },
);

test(
  "background work survives initiating CLI exit and cancellation waits for the real downloader exit",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      base = ["--project", f.project];
    const submission = await f.invoke([
      "download",
      ...base,
      "--background",
      "--input-file",
      await f.request({ url: "https://example.invalid/slow" }),
    ]);
    const id = submission.json.result.id;
    assert.equal(submission.json.result.background, true);
    await until(
      () => getCliJob(f.project, id),
      (value) => value.status === "running",
    );
    await until(
      () => readFile(f.env.MIMI_TEST_STARTED_FILE, "utf8").catch(() => ""),
      (value) => value.endsWith("slow"),
    );
    assert.equal(
      (await f.invoke(["retry", ...base, "--job", id], { expected: 1 })).json.error.code,
      "JOB_BUSY",
    );
    const cancelled = (await f.invoke(["cancel", ...base, "--job", id])).json.result;
    assert.ok(cancelled.cancelRequestedAt);
    const done = await until(
      () => getCliJob(f.project, id),
      (value) => value.status === "cancelled",
    );
    assert.equal(await readFile(f.exitFile, "utf8"), "terminated");
    assert.deepEqual(done.files, []);
    await until(
      () =>
        stat(join(f.project, ".mimi-download-cli", "jobs", id, ".worker.lock")).catch(() => null),
      (value) => value === null,
    );
    assert.equal(
      await readFile(
        join(f.project, ".mimi-download-cli", "jobs", id, "work", "media", "fixture.mp4.part"),
        "utf8",
      ),
      "retained partial bytes",
    );
    const resumed = (await f.invoke(["retry", ...base, "--job", id])).json.result;
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.attempt, 2);
    assert.equal(await readFile(f.exitFile, "utf8"), "resumed");
  },
);

test(
  "a detached worker completes and an ordinary SIGTERM cooperatively stops a foreground owned child",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      base = ["--project", f.project];
    const launched = (
      await f.invoke([
        "download",
        ...base,
        "--background",
        "--input-file",
        await f.request({ url: "https://example.invalid/moderate" }),
      ])
    ).json.result;
    const done = await until(
      () => getCliJob(f.project, launched.id),
      (row) => row.status === "completed",
    );
    assert.equal(await readFile(done.files[0].path, "utf8"), "real fixture media bytes");
    await rm(f.env.MIMI_TEST_STARTED_FILE);
    const input = await f.request({ url: "https://example.invalid/slow" });
    const child = spawn(process.execPath, [entry, "download", ...base, "--input-file", input], {
      env: f.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (text) => {
      stdout += text;
    });
    child.stderr.resume();
    t.after(() => {
      if (child.exitCode === null) child.kill("SIGTERM");
    });
    const exit = new Promise((resolveExit) => child.once("close", (code) => resolveExit(code)));
    await until(
      () => listCliJobs(f.project),
      (value) => value.jobs.some((row) => row.url.endsWith("slow") && row.status === "running"),
    );
    await until(
      () => readFile(f.env.MIMI_TEST_STARTED_FILE, "utf8").catch(() => ""),
      (value) => value.endsWith("slow"),
    );
    child.kill("SIGTERM");
    assert.equal(await exit, 1);
    assert.equal(JSON.parse(stdout).result.status, "cancelled");
    assert.equal(await readFile(f.exitFile, "utf8"), "terminated");
  },
);

test(
  "failed downloads retain their task ID without leaking upstream diagnostics",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t);
    const failed = await f.invoke(
      [
        "download",
        "--project",
        f.project,
        "--input-file",
        await f.request({ url: "https://example.invalid/failed" }),
      ],
      { expected: 1 },
    );
    assert.equal(failed.json.result.status, "failed");
    assert.ok(!failed.stdout.includes("never-persist-this"));
    assert.equal((await getCliJob(f.project, failed.json.result.id)).status, "failed");
  },
);

test(
  "task stores reject symlink directories/inputs and listing remains read-only",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      outside = join(f.root, "outside");
    await mkdir(outside, { mode: 0o700 });
    await symlink(outside, join(f.project, ".mimi-download-cli"));
    await assert.rejects(listCliJobs(f.project), (error) => error.code === "UNSAFE_PATH");
    await assert.rejects(
      createCliStore(f.project, { create: true }),
      (error) => error.code === "UNSAFE_PATH",
    );
    assert.deepEqual(await readdir(outside), []);
    const input = await f.request({ url: "https://example.invalid/video" }),
      alias = join(f.root, "alias.json");
    await symlink(input, alias);
    await assert.rejects(
      main(["inspect", "--project", f.project, "--input-file", alias]),
      (error) => error.code === "INVALID_INPUT",
    );
  },
);

test("expired heartbeat is a read-only interrupted view and retry never replaces a live worker", async (t) => {
  const f = await fixture(t),
    store = await createCliStore(f.project, { create: true });
  const record = await store.create(
    { action: "download", url: "https://example.invalid/video", configuration: {} },
    join(f.project, "downloads"),
  );
  await store.update(record.id, (value) => ({
    ...value,
    status: "running",
    heartbeatAt: Date.now() - 60_000,
  }));
  const release = await store.claimWorker(record.id, 1, "fixture-owner");
  const before = await readFile(join(store.jobsDirectory, record.id, "task.json"));
  assert.equal((await getCliJob(f.project, record.id)).status, "interrupted");
  assert.equal((await listCliJobs(f.project)).jobs[0].status, "interrupted");
  assert.deepEqual(await readFile(join(store.jobsDirectory, record.id, "task.json")), before);
  await assert.rejects(
    main(["retry", "--project", f.project, "--job", record.id]),
    (error) => error.code === "JOB_BUSY",
  );
  await release();
  await store.update(record.id, (value) => ({ ...value, status: "cancelled" }));
});

test("a short record lock from a confirmed dead writer is recovered without deleting an unknown lock", async (t) => {
  const f = await fixture(t),
    store = await createCliStore(f.project, { create: true });
  const record = await store.create(
    { action: "download", url: "https://example.invalid/video", configuration: {} },
    join(f.project, "downloads"),
  );
  const exited = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const pid = exited.pid;
  await new Promise((resolveExit) => exited.once("close", resolveExit));
  assert.throws(
    () => process.kill(pid, 0),
    (error) => error.code === "ESRCH",
  );
  const lock = join(store.jobsDirectory, record.id, ".write.lock");
  await mkdir(lock, { mode: 0o700 });
  await writeFile(join(lock, "owner.json"), JSON.stringify({ pid }), { mode: 0o600 });
  const stopped = await Promise.all(
    Array.from({ length: 8 }, () => requestCliCancellation(f.project, record.id)),
  );
  assert.ok(stopped.every((value) => value.cancelRequestedAt));
  assert.equal(await stat(lock).catch(() => null), null);
  await store.update(record.id, (value) => ({ ...value, status: "cancelled" }));
});

test(
  "a killed detached worker cannot be retried while its owned downloader process group survives",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      store = await createCliStore(f.project, { create: true });
    const record = await store.create(
      { action: "download", url: "https://example.invalid/video", configuration: {} },
      join(f.project, "downloads"),
    );
    const marker = join(f.root, "orphan-started");
    const leader = spawn(
      process.execPath,
      [
        "-e",
        `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(marker)},String(child.pid));setInterval(()=>{},1000);`,
      ],
      { detached: true, stdio: "ignore" },
    );
    const closed = new Promise((resolveExit) => leader.once("close", resolveExit));
    const releaseGroup = () => {
      try {
        process.kill(-leader.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    t.after(releaseGroup);
    await until(
      () => readFile(marker, "utf8").catch(() => ""),
      (value) => /^\d+$/.test(value),
    );
    const lock = join(store.jobsDirectory, record.id, ".worker.lock");
    await mkdir(lock, { mode: 0o700 });
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({ pid: leader.pid, detachedGroup: true, attempt: 1, token: "owned-fixture" }),
      { mode: 0o600 },
    );
    leader.kill("SIGKILL");
    await closed;
    assert.throws(
      () => process.kill(leader.pid, 0),
      (error) => error.code === "ESRCH",
    );
    assert.doesNotThrow(() => process.kill(-leader.pid, 0));
    await store.update(record.id, (value) => ({ ...value, heartbeatAt: Date.now() - 60_000 }));
    await assert.rejects(
      store.verifyNoWorker(record.id),
      (error) => error.code === "JOB_BUSY" && /进程组/u.test(error.message),
    );
    assert.equal((await store.read(record.id)).attempt, 1);
    releaseGroup();
    await store.update(record.id, (value) => ({ ...value, status: "cancelled" }));
  },
);

test(
  "cancellation confirms a real stubborn downloader grandchild before releasing retry ownership",
  { skip: !supported },
  async (t) => {
    const f = await fixture(t),
      base = ["--project", f.project],
      marker = join(f.root, "grandchild");
    const submitted = await f.invoke(
      [
        "download",
        ...base,
        "--background",
        "--input-file",
        await f.request({ url: "https://example.invalid/slow" }),
      ],
      { extraEnv: { MIMI_TEST_GRANDCHILD_FILE: marker } },
    );
    const id = submitted.json.result.id;
    await until(
      () => readFile(marker + ".ready", "utf8").catch(() => ""),
      (value) => value === "ready",
    );
    const grandchildPid = Number(await readFile(marker, "utf8"));
    assert.doesNotThrow(() => process.kill(grandchildPid, 0));
    t.after(() => {
      try {
        process.kill(grandchildPid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    });
    await f.invoke(["cancel", ...base, "--job", id]);
    const final = await until(
      () => getCliJob(f.project, id),
      (value) => ["cancelled", "interrupted"].includes(value.status),
    );
    const lock = join(f.project, ".mimi-download-cli", "jobs", id, ".worker.lock");
    if (final.status === "cancelled") {
      assert.throws(
        () => process.kill(grandchildPid, 0),
        (error) => error.code === "ESRCH",
      );
      await until(
        () => stat(lock).catch(() => null),
        (value) => value === null,
      );
      const retried = await f.invoke(["retry", ...base, "--job", id]);
      assert.equal(retried.json.result.status, "completed");
      assert.equal(retried.json.result.attempt, 2);
    } else {
      assert.equal(final.error.code, "PROCESS_TREE_UNCONFIRMED");
      assert.ok(await stat(lock));
      const refused = await f.invoke(["retry", ...base, "--job", id], { expected: 1 });
      assert.equal(refused.json.error.code, "JOB_BUSY");
      assert.equal((await getCliJob(f.project, id)).attempt, 1);
    }
  },
);

test("an absent crashed worker group never proves detached child receipts were captured", async (t) => {
  const f = await fixture(t),
    store = await createCliStore(f.project, { create: true });
  const record = await store.create(
    { action: "download", url: "https://example.invalid/video", configuration: {} },
    join(f.project, "downloads"),
  );
  const leader = spawn(process.execPath, ["-e", "process.exit(0)"], {
    detached: supported,
    stdio: "ignore",
  });
  await new Promise((resolveExit) => leader.once("close", resolveExit));
  const lock = join(store.jobsDirectory, record.id, ".worker.lock");
  await mkdir(lock, { mode: 0o700 });
  await writeFile(
    join(lock, "owner.json"),
    JSON.stringify({
      pid: leader.pid,
      detachedGroup: true,
      attempt: 1,
      token: "crashed-before-child-receipt",
    }),
    { mode: 0o600 },
  );
  await store.update(record.id, (current) => ({ ...current, heartbeatAt: Date.now() - 60_000 }));
  await assert.rejects(store.verifyNoWorker(record.id), (error) => error.code === "JOB_BUSY");
  assert.ok(await stat(lock));
  assert.equal((await store.read(record.id)).attempt, 1);
  await store.update(record.id, (current) => ({ ...current, status: "interrupted" }));
});
