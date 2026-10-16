import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { incrementCount } from "../templates/starter/app/counter.mjs";

const execute = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "starter-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, "installed");
  await cp(new URL("../templates/starter", import.meta.url), packageRoot, { recursive: true });
  const project = join(root, "项目 with spaces");
  await mkdir(project);
  return {
    root, project, packageRoot,
    async run(args, entry = join(packageRoot, "app/tools/starter.mjs")) {
      try {
        const { stdout, stderr } = await execute(process.execPath, [entry, ...args], {
          cwd: project, env: { HOME: root, PATH: "" }, timeout: 5000,
        });
        assert.equal(stderr, "");
        assert.equal(stdout.trim().split("\n").length, 1);
        return { status: 0, ...JSON.parse(stdout) };
      } catch (error) {
        if (!error.stdout) throw error;
        assert.equal(error.stderr, "");
        assert.equal(error.stdout.trim().split("\n").length, 1);
        return { status: error.code, ...JSON.parse(error.stdout) };
      }
    },
  };
}

test("copied Starter package discovers operations and reads local context without Host or dev dependencies", async (t) => {
  const { run, project, packageRoot } = await fixture(t);
  const ops = await run(["ops"]);
  assert.equal(ops.ok, true);
  assert.deepEqual(ops.result.operations.map((op) => op.name), ["context", "counter"]);
  const context = await run(["context", "--project", "."]);
  assert.equal(context.ok, true);
  assert.equal(context.result.root, await realpath(project));
  assert.equal(context.result.persistence, "none");
  const manifest = JSON.parse(await readFile(join(packageRoot, ".codeshell-panel/panel.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(manifest.agent.skills, ["agent/skills/project-runtime/SKILL.md"]);
});

test("counter CLI reuses panel behavior, handles spaces and symbolic executable aliases", async (t) => {
  const { run, project, root, packageRoot } = await fixture(t);
  await writeFile(join(project, "input file.json"), JSON.stringify({ value: 8, amount: 3 }));
  const alias = join(root, "starter alias.mjs");
  await symlink(join(packageRoot, "app/tools/starter.mjs"), alias);
  const response = await run(["counter", "--input-file", "input file.json"], alias);
  assert.equal(response.ok, true);
  assert.equal(response.result.value, incrementCount(8, 3));
});

test("invalid commands, duplicate options, malformed or oversized input fail as structured JSON", async (t) => {
  const { run, project } = await fixture(t);
  for (const args of [["missing"], ["ops", "--project", "."], ["counter"],
    ["context", "--project", ".", "--project", "."]]) {
    const response = await run(args);
    assert.equal(response.ok, false);
    assert.equal(response.status, 2);
    assert.equal(response.error.code, "INVALID_ARGUMENT");
  }
  for (const content of ["{", " ".repeat(16 * 1024 + 1),
    JSON.stringify({ value: Number.MAX_SAFE_INTEGER, amount: 1 }),
    JSON.stringify({ value: 1, extra: true }), JSON.stringify({ value: -1 }),
    JSON.stringify({ amount: 1 })]) {
    await writeFile(join(project, "bad.json"), content);
    const response = await run(["counter", "--input-file", "bad.json"]);
    assert.equal(response.ok, false);
    assert.equal(response.status, 2);
    assert.equal(response.error.code, "INVALID_ARGUMENT");
  }
});
