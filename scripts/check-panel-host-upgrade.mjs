import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { repositoryRoot } from "./panel-projects.mjs";

if (process.argv.length < 3 || process.argv.length > 4)
  throw Error("Usage: node scripts/check-panel-host-upgrade.mjs <built-server-package-directory> [report.json]");
const serverRoot = resolve(process.argv[2]);
assert.equal(JSON.parse(await readFile(join(serverRoot, "package.json"), "utf8")).name, "@cjhyy/code-shell-server");
await readFile(join(serverRoot, "dist/panels/runtime-services.js"));
await readFile(resolve(serverRoot, "../core/dist/panel-apps/index.js"));
const sandbox = await mkdtemp(join(tmpdir(), "panel-host-upgrade-"));
try {
  const guard = join(sandbox, "deny-network.mjs");
  await writeFile(guard, `
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
const blocked = () => { throw Error("Panel upgrade gate forbids network access"); };
globalThis.fetch = blocked;
http.request = http.get = https.request = https.get = blocked;
net.connect = net.createConnection = tls.connect = blocked;
syncBuiltinESMExports();
`);
  const home = join(sandbox, "home");
  await mkdir(home);
  const report = join(sandbox, "report.json");
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(guard).href,
    join(repositoryRoot, "scripts/panel-host-upgrade.mjs"), serverRoot, sandbox, report], {
    cwd: repositoryRoot,
    // No real Host state, provider credentials or Git credential environment.
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, LANG: "C.UTF-8",
      PANEL_TEST_CHROMIUM_EXECUTABLE: chromium.executablePath() },
    encoding: "utf8", timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "real Host package upgrade/rollback gate failed");
  const contents = await readFile(report, "utf8");
  if (process.argv[3]) {
    await writeFile(resolve(process.argv[3]), contents, { flag: "wx" });
    console.log(`Report: ${resolve(process.argv[3])}`);
  }
  console.log("PASS: reviewed old-package install, pinned project upgrade and rollback for all six Panels (controlled local Host)");
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
