import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { repositoryRoot } from "./panel-projects.mjs";
import { cleanupUpgradeFixture, runOwnedUpgradeWorker } from "./panel-upgrade-process.mjs";
import { parseUpgradeOptions } from "./panel-upgrade-options.mjs";

const options = parseUpgradeOptions(process.argv.slice(2));
const serverRoot = resolve(options.serverRoot);
assert.equal(JSON.parse(await readFile(join(serverRoot, "package.json"), "utf8")).name, "@cjhyy/code-shell-server");
await readFile(join(serverRoot, "dist/panels/runtime-services.js"));
await readFile(resolve(serverRoot, "../core/dist/panel-apps/index.js"));
const sandbox = await mkdtemp(join(tmpdir(), "panel-host-upgrade-"));
let worker;
let ownedChild;
let failure;
let reportContents;
let shutdown;
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
  worker = await runOwnedUpgradeWorker({ args: ["--import", pathToFileURL(guard).href,
    join(repositoryRoot, "scripts/panel-host-upgrade.mjs"), serverRoot, sandbox, report,
    ...(options.appId ? [options.appId] : [])],
    cwd: repositoryRoot,
    // No real Host state, provider credentials or Git credential environment.
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, LANG: "C.UTF-8",
      PANEL_TEST_CHROMIUM_EXECUTABLE: chromium.executablePath() },
    onChild: child => { ownedChild = child; },
  });
  if (worker.stdout) process.stdout.write(worker.stdout);
  if (worker.stderr) process.stderr.write(worker.stderr);
  if (worker.errors.length === 0) {
    reportContents = JSON.parse(await readFile(report, "utf8"));
    reportContents.gateScriptsSHA256 = Object.fromEntries(await Promise.all([
      "check-panel-host-upgrade.mjs", "panel-host-upgrade.mjs", "panel-upgrade-scenarios.mjs", "panel-upgrade-process.mjs", "panel-upgrade-starter-assets.mjs", "panel-upgrade-options.mjs",
    ].map(async file => [file, createHash("sha256").update(await readFile(join(repositoryRoot, "scripts", file))).digest("hex")])));
  }
} catch (error) {
  failure = error;
  // An unexpected harness exception must never turn an already launched
  // worker into the "no process started" cleanup path.
  if (!worker && ownedChild) worker = { errors: [], exited: false, spawnFailed: false, receipt: null };
} finally {
  shutdown = await cleanupUpgradeFixture({ sandbox, worker, failure });
}
reportContents.workerShutdown = shutdown;
if (options.reportPath) {
  await writeFile(resolve(options.reportPath), JSON.stringify(reportContents, null, 2) + "\n", { flag: "wx" });
  console.log(`Report: ${resolve(options.reportPath)}`);
}
console.log(`PASS: owned worker ${shutdown.pid} exited after closing ${shutdown.browsersClosed}/${shutdown.browsersOpened} Chromium instances; private HOME removed`);
console.log(`PASS: reviewed old-package install, global update, project restore and rollback for ${options.appId ? `${options.appId} only (${reportContents.cases.length} historical cases; partial catalog)` : "all six Panels"} (controlled local Host)`);
