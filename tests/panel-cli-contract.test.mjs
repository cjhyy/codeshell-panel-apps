import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const packages = [
  ["apps/design-studio", "design-studio", "design-studio.mjs", "project-runtime"],
  ["apps/job-hunt-hq", "job-hunt-hq", "job-hunt.mjs", "project-runtime"],
  ["apps/quant-lab", "quant-lab", "quant-lab.mjs", "project-runtime"],
  ["apps/video-download", "video-download", "video-download.mjs", "video-download-cli"],
  ["panels/video-studio", "video-studio", "video-studio.mjs", "project-runtime"],
  ["templates/starter", "starter-panel", "starter.mjs", "project-runtime"],
];

for (const [source, id, executable, skillId] of packages) {
  test(`${id}: installed package discovers its CLI without a webview or development dependencies`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "panel-cli-contract-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const installed = join(root, "installed package"),
      project = join(root, "empty project");
    await cp(new URL(`../${source}`, import.meta.url), installed, { recursive: true });
    await mkdir(project);
    const manifest = JSON.parse(
      await readFile(join(installed, ".codeshell-panel/panel.json"), "utf8"),
    );
    assert.equal(manifest.id, id);
    const skillPath = `agent/skills/${skillId}/SKILL.md`;
    assert.ok(manifest.agent.skills.includes(skillPath), "Runtime Skill must be declared");
    const skill = await readFile(join(installed, skillPath), "utf8");
    assert.ok(
      skill.includes(`app/tools/${executable}`),
      "Runtime Skill must locate its bundled CLI",
    );

    // Test only discovery: no provider, model, external executable or project
    // mutation is needed. Reject accidental JavaScript networking in the child.
    const guard = join(root, "offline.cjs");
    await writeFile(
      guard,
      `
      const deny = () => { throw new Error("CLI discovery must be offline"); };
      for (const name of ["http", "https"]) {
        const api = require("node:" + name); api.request = api.get = deny;
      }
      const net = require("node:net"); net.connect = net.createConnection = deny;
      net.Socket.prototype.connect = deny;
      require("node:tls").connect = deny;
      globalThis.fetch = deny;
      require("node:module").syncBuiltinESMExports();
    `,
    );
    const { stdout, stderr } = await execute(
      process.execPath,
      ["--require", guard, join(installed, "app/tools", executable), "ops"],
      {
        cwd: project,
        env: { HOME: root, PATH: "" },
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      },
    );
    assert.equal(stderr, "");
    assert.equal(stdout.trim().split("\n").length, 1, "stdout must contain one JSON receipt");
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    assert.ok(result.result && typeof result.result === "object");
    assert.deepEqual(await readdir(project), [], "ops must not initialize project state");
  });
}
