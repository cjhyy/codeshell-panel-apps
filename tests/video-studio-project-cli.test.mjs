import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "video-studio-cli-")),
    project = join(root, "project"),
    installed = join(root, "installed"),
    home = join(root, "home");
  await Promise.all([
    mkdir(project),
    mkdir(home),
    cp("panels/video-studio", installed, { recursive: true }),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = join(installed, "app/tools/video-studio.mjs"),
    env = { PATH: "", HOME: home };
  const decode = (child) => {
    assert.equal(child.error, undefined);
    assert.equal(child.stderr, "");
    const lines = child.stdout.trim().split("\n");
    assert.equal(lines.length, 1, "one structured stdout receipt");
    assert.ok(Buffer.byteLength(child.stdout) <= 64 * 1024 + 1);
    return { status: child.status, ...JSON.parse(lines[0]) };
  };
  const input = async (value) => {
    const path = join(root, `request-${randomUUID()}.json`);
    await writeFile(path, JSON.stringify(value));
    return path;
  };
  const args = (command, inputFile) => [
    cli,
    command,
    ...(command === "ops" ? [] : ["--project", project]),
    ...(inputFile ? ["--input-file", inputFile] : []),
  ];
  const run = async (command, value) =>
    decode(
      spawnSync(
        process.execPath,
        args(command, value === undefined ? undefined : await input(value)),
        {
          cwd: project,
          env,
          encoding: "utf8",
          timeout: 10000,
        },
      ),
    );
  const runAsync = async (command, value) => {
    const inputFile = await input(value);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args(command, inputFile), { cwd: project, env });
      const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (status) => {
        clearTimeout(timeout);
        try {
          resolve(decode({ status, stdout, stderr }));
        } catch (error) {
          reject(error);
        }
      });
    });
  };
  return {
    root,
    project,
    installed,
    cli,
    env,
    input,
    args,
    run,
    runAsync,
    decode,
    bytes: () => readFile(join(project, "video-studio-cli.json")),
    document: async () =>
      JSON.parse(await readFile(join(project, "video-studio-cli.json"), "utf8")),
  };
}

test("relocated installed CLI discovers commands and Skill without a project, credentials or PATH", async (t) => {
  const f = await fixture(t),
    result = await f.run("ops");
  assert.equal(result.status, 0);
  assert.equal(result.ok, true);
  assert.equal(result.result.format, "codeshell.video-studio.cli");
  assert.deepEqual(
    result.result.commands.map((item) => item.name),
    [
      "init",
      "inspect",
      "validate",
      "edit",
      "plan",
      "import",
      "export",
      "add-media",
      "render",
      "voices",
      "setup-voice",
      "voiceover",
      "transcribe",
      "frames",
    ],
  );
  assert.deepEqual(await readdir(f.project), []);
  const manifest = JSON.parse(
    await readFile(join(f.installed, ".codeshell-panel/panel.json"), "utf8"),
  );
  assert.ok(manifest.agent.skills.includes("agent/skills/project-runtime/SKILL.md"));
  const skill = await readFile(join(f.installed, "agent/skills/project-runtime/SKILL.md"), "utf8");
  assert.match(skill, /app\/tools\/video-studio\.mjs/);
  assert.match(skill, /bundled-video-studio-cli-not-found/);
});

test("init preserves existing documents and inspect uses exact bounded editor-domain pages", async (t) => {
  const f = await fixture(t),
    missing = await f.run("inspect");
  assert.equal(missing.error.code, "PROJECT_NOT_INITIALIZED");
  const initialized = await f.run("init", {
    name: "初始工程",
    frameRate: { numerator: 30000, denominator: 1001 },
  });
  assert.equal(initialized.result.initialized, true);
  const first = await f.bytes();
  assert.equal((await f.run("init", { name: "不能覆盖" })).result.initialized, false);
  assert.deepEqual(await f.bytes(), first);
  const inspection = await f.run("inspect", { path: "/sequences/0/frameRate", format: "json" });
  assert.equal(inspection.result.revision, initialized.result.revision);
  assert.deepEqual(JSON.parse(inspection.result.page.value), {
    numerator: 30000,
    denominator: 1001,
  });
  const document = await f.document();
  document.production = { note: "💡".repeat(5000) };
  const documentFile = await f.input(document);
  const imported = await f.run("import", {
    expectedRevision: inspection.result.revision,
    documentFile,
  });
  let offset = 0,
    joined = "";
  do {
    const page = (
      await f.run("inspect", {
        path: "/production/note",
        format: "json",
        expectedRevision: imported.result.revision,
        offset,
      })
    ).result.page;
    assert.ok(page.value.length <= 4096);
    joined += page.value;
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(JSON.parse(joined), document.production.note);
  assert.equal((await f.run("validate")).result.valid, true);
  const unsafe = await f.run("inspect", { path: "/constructor" });
  assert.equal(unsafe.ok, false);
  assert.deepEqual(await f.document(), document);
});

test("edit shares the planner domain, commits once, rolls back invalid batches and rejects stale CAS", async (t) => {
  const f = await fixture(t),
    initialized = await f.run("init"),
    document = await f.document();
  const defaults = JSON.parse(
    (await f.run("inspect", { view: "defaults", format: "json" })).result.page.value,
  );
  const sequenceId = document.activeSequenceId,
    sequence = document.sequences[0],
    shape = {
      id: "shape-one",
      kind: "shape",
      trackId: sequence.tracks[0].id,
      start: 0,
      duration: 480000,
      label: "画面",
      shape: "rectangle",
      fill: "#ff0000",
      stroke: "#000000",
      strokeWidth: 0,
      transform: defaults.transform,
      color: defaults.color,
      blendMode: "normal",
    };
  const changed = await f.run("apply", {
    expectedRevision: initialized.result.revision,
    label: "添加画面和字幕",
    steps: [
      { kind: "operations", operations: [{ type: "clip.add", sequenceId, clip: shape }] },
      {
        kind: "captions",
        sequenceId,
        action: { kind: "add", text: "真实时间轴", start: 0, end: 480000 },
      },
    ],
  });
  assert.equal(changed.status, 0);
  assert.equal(changed.result.documentRevision, 1);
  assert.equal((await f.document()).sequences[0].clips.length, 2);
  const before = await f.bytes();
  const invalid = await f.run("edit", {
    expectedRevision: changed.result.revision,
    label: "原子失败",
    steps: [
      { kind: "operations", operations: [{ type: "project.rename", name: "不应保存" }] },
      { kind: "split", sequenceId, clipId: "missing", time: 100 },
    ],
  });
  assert.equal(invalid.ok, false);
  assert.deepEqual(await f.bytes(), before);
  const longError = await f.run("edit", {
    expectedRevision: changed.result.revision,
    label: "有界错误",
    steps: [{ kind: "sequence", action: { kind: "rename" }, ["x".repeat(100000)]: true }],
  });
  assert.equal(longError.ok, false);
  assert.ok(longError.error.message.length <= 1000);
  assert.deepEqual(await f.bytes(), before);
  const stale = await f.run("edit", {
    expectedRevision: initialized.result.revision,
    label: "过期",
    steps: [{ kind: "operations", operations: [{ type: "project.rename", name: "过期覆盖" }] }],
  });
  assert.equal(stale.status, 3);
  assert.equal(stale.error.code, "REVISION_CONFLICT");
  const plan = await f.run("plan", {
    expectedRevision: changed.result.revision,
    range: { start: 0, duration: 480000 },
  });
  assert.equal(plan.result.rendered, false);
  assert.equal(plan.result.frameCount, 60);
  assert.equal(plan.result.audio.fullSequenceSampleCount, 96000);
  assert.equal(plan.result.audio.requestedRangeSampleCount, 96000);
  assert.deepEqual(plan.result.requiredEncoders, ["libx264", "aac"]);
  const rational = await f.run("plan", {
    profile: { ...plan.result.profile, frameRate: { numerator: 30000, denominator: 1001 } },
  });
  assert.equal(rational.result.frameCount, 60);
  assert.equal(rational.result.encodedDurationSeconds, 2.002);
  assert.equal(rational.result.mediaChecked, false);
  const partial = await f.run("plan", { range: { start: 240000, duration: 240000 } });
  assert.equal(partial.result.frameCount, 30);
  assert.equal(partial.result.audio.requestedRangeSampleCount, 48000);
  assert.equal(partial.result.audio.fullSequenceSampleCount, 96000);
  assert.deepEqual(await f.bytes(), before);
});

test("simultaneous subprocess writers serialize and exactly one stale revision succeeds", async (t) => {
  const f = await fixture(t),
    initialized = await f.run("init");
  const request = (name) => ({
    expectedRevision: initialized.result.revision,
    label: name,
    steps: [{ kind: "operations", operations: [{ type: "project.rename", name }] }],
  });
  const writers = await Promise.all([
    f.runAsync("edit", request("first")),
    f.runAsync("edit", request("second")),
  ]);
  assert.deepEqual(writers.map((item) => item.status).sort(), [0, 3]);
  assert.equal(writers.find((item) => !item.ok).error.code, "REVISION_CONFLICT");
  const saved = await f.document();
  assert.equal(saved.revision, 1);
  assert.ok(["first", "second"].includes(saved.name));
  assert.deepEqual(
    (await readdir(f.project)).filter((name) => name.startsWith(".")),
    [],
  );
});

test("shared edit guard invalidates imported narration approval and refuses fabricated approval", async (t) => {
  const f = await fixture(t),
    initialized = await f.run("init"),
    document = await f.document();
  document.production = { script: "原文稿", narration: { phase: "approved" } };
  const documentFile = await f.input(document),
    imported = await f.run("import", {
      expectedRevision: initialized.result.revision,
      documentFile,
    });
  const edited = await f.run("edit", {
    expectedRevision: imported.result.revision,
    label: "改变画幅",
    steps: [
      {
        kind: "operations",
        operations: [
          {
            type: "sequence.update",
            sequenceId: document.activeSequenceId,
            patch: { width: 1280 },
          },
        ],
      },
    ],
  });
  assert.equal(edited.result.productionInvalidated, true);
  const saved = await f.document();
  assert.equal(saved.production.narration.phase, "review");
  assert.equal(saved.production.narrationPreviousApproval.phase, "approved");
  const before = await f.bytes(),
    rejected = await f.run("edit", {
      expectedRevision: edited.result.revision,
      label: "非法审批",
      steps: [
        {
          kind: "operations",
          operations: [{ type: "project.production", data: { narration: { phase: "approved" } } }],
        },
      ],
    });
  assert.equal(rejected.ok, false);
  assert.deepEqual(await f.bytes(), before);
});

test("an existing writer lock times out without clearing ownership or altering the project", async (t) => {
  const f = await fixture(t),
    initialized = await f.run("init"),
    before = await f.bytes(),
    lock = join(f.project, ".video-studio-cli-write.lock");
  await mkdir(lock);
  const rejected = await f.run("edit", {
    expectedRevision: initialized.result.revision,
    label: "等待锁",
    steps: [{ kind: "operations", operations: [{ type: "project.rename", name: "不能覆盖" }] }],
  });
  assert.equal(rejected.status, 4);
  assert.equal(rejected.error.code, "PROJECT_BUSY");
  assert.deepEqual(await readdir(lock), []);
  assert.deepEqual(await f.bytes(), before);
});

test("explicit schema-2 JSON exchange is validated, create-only and never a media/render receipt", async (t) => {
  const f = await fixture(t),
    initialized = await f.run("init");
  const exported = await f.run("export", {
    output: "exports/project-v2.json",
    expectedRevision: initialized.result.revision,
  });
  assert.equal(exported.result.mediaIncluded, false);
  const exportedFile = join(f.project, exported.result.output),
    json = await readFile(exportedFile);
  assert.deepEqual(JSON.parse(json), await f.document());
  assert.equal((await f.run("validate", { documentFile: exportedFile })).result.valid, true);
  assert.equal(
    (await f.run("export", { output: "exports/project-v2.json" })).error.code,
    "REVISION_CONFLICT",
  );
  assert.deepEqual(await readFile(exportedFile), json);
  const original = await f.bytes(),
    invalidFile = await f.input({ schemaVersion: 2 });
  assert.equal(
    (
      await f.run("import", {
        expectedRevision: initialized.result.revision,
        documentFile: invalidFile,
      })
    ).ok,
    false,
  );
  assert.deepEqual(await f.bytes(), original);
  const changed = JSON.parse(json);
  changed.name = "Explicit import";
  const changedFile = await f.input(changed);
  const imported = await f.run("import", {
    expectedRevision: initialized.result.revision,
    documentFile: changedFile,
  });
  assert.equal(imported.result.mediaCopied, false);
  assert.equal((await f.document()).name, changed.name);
  assert.equal((await f.run("export", { output: "../outside.json" })).error.code, "UNSAFE_PATH");
  assert.deepEqual(
    await readdir(f.root).then((names) => names.filter((name) => name === "outside.json")),
    [],
  );
});

test("symlinked state, output parents, malformed and oversized inputs preserve existing data", async (t) => {
  const f = await fixture(t),
    initialized = await f.run("init"),
    before = await f.bytes();
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await symlink(outside, join(f.project, "redirect"), "dir");
  assert.equal(
    (await f.run("export", { output: "redirect/escaped.json" })).error.code,
    "UNSAFE_PATH",
  );
  assert.deepEqual(await readdir(outside), []);
  const bad = join(f.root, "bad.json");
  await writeFile(bad, Buffer.from([0xff]));
  let raw = f.decode(
    spawnSync(process.execPath, f.args("edit", bad), {
      cwd: f.project,
      env: f.env,
      encoding: "utf8",
      timeout: 10000,
    }),
  );
  assert.equal(raw.error.code, "INVALID_INPUT");
  await writeFile(bad, "x".repeat(256 * 1024 + 1));
  raw = f.decode(
    spawnSync(process.execPath, f.args("edit", bad), {
      cwd: f.project,
      env: f.env,
      encoding: "utf8",
      timeout: 10000,
    }),
  );
  assert.equal(raw.error.code, "INPUT_LIMIT");
  await writeFile(bad, "{}");
  await truncate(bad, 32 * 1024 * 1024 + 1);
  assert.equal(
    (await f.run("import", { expectedRevision: initialized.result.revision, documentFile: bad }))
      .error.code,
    "INPUT_LIMIT",
  );
  assert.deepEqual(await f.bytes(), before);
  const state = join(f.project, "video-studio-cli.json"),
    target = join(outside, "state.json");
  await writeFile(target, before);
  await rm(state);
  await symlink(target, state);
  assert.equal((await f.run("init")).error.code, "UNSAFE_PATH");
  assert.deepEqual(await readFile(target), before);
  await rm(state);
  const malformed = "{ invalid project";
  await writeFile(state, malformed);
  assert.equal((await f.run("init")).error.code, "INVALID_INPUT");
  assert.equal(await readFile(state, "utf8"), malformed);
});

test(
  "FIFO JSON input rejects promptly without blocking on open",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t),
      fifo = join(f.root, "request.fifo");
    const made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    const started = Date.now(),
      raw = f.decode(
        spawnSync(process.execPath, f.args("edit", fifo), {
          cwd: f.project,
          env: f.env,
          encoding: "utf8",
          timeout: 2000,
        }),
      );
    assert.equal(raw.error.code, "INPUT_LIMIT");
    assert.ok(Date.now() - started < 2000);
    assert.deepEqual(await readdir(f.project), []);
  },
);
