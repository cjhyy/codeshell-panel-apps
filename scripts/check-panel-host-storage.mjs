import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot } from "./panel-projects.mjs";

if (process.argv.length !== 3)
  throw Error("Usage: node scripts/check-panel-host-storage.mjs <built-server-package-directory>");
const serverRoot = resolve(process.argv[2]);
assert.equal(JSON.parse(await readFile(join(serverRoot, "package.json"), "utf8")).name, "@cjhyy/code-shell-server");
await readFile(join(serverRoot, "dist/panels/runtime-services.js"));
const sandbox = await mkdtemp(join(tmpdir(), "panel-host-storage-gate-"));
try {
  const guardPath = join(sandbox, "deny-network.mjs");
  await writeFile(guardPath, `
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
const blocked = () => { throw Error("Host storage gate forbids network access"); };
globalThis.fetch = blocked;
http.request = http.get = https.request = https.get = blocked;
net.connect = net.createConnection = tls.connect = blocked;
syncBuiltinESMExports();
`);
  for (const script of ["design-studio-host-storage.mjs", "design-studio-portable-host.mjs", "job-hunt-host-draft-storage.mjs", "job-hunt-host-headless.mjs"]) {
    const isolatedHome = join(sandbox, script.replace(".mjs", ""));
    await mkdir(isolatedHome);
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(guardPath).href, join(repositoryRoot, "scripts", script), serverRoot], {
      cwd: repositoryRoot,
      // Do not pass provider tokens or the user's normal runtime state to children.
      env: { PATH: process.env.PATH, HOME: isolatedHome, TMPDIR: isolatedHome, LANG: "C.UTF-8", PANEL_TEST_ISOLATED_HOME: isolatedHome, PANEL_TEST_NETWORK_GUARD: guardPath },
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${script} failed`);
  }
  console.log("PASS: four real Host storage/runtime checks with temporary homes, temporary projects and denied network access");
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
