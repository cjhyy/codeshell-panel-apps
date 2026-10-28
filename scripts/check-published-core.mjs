// Release/CI gate: deliberately ignores the cross-repository development override.
// Read-only directory previews exercise the actual pinned Host installer contract.
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PanelAppManifest, previewLocalPanelApp } from "@cjhyy/code-shell-core";
import { discoverProjects, repositoryRoot } from "./panel-projects.mjs";

const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(repositoryRoot, "package-lock.json"), "utf8"));
const name = "@cjhyy/code-shell-core";
const pin = manifest.devDependencies[name];
assert.match(pin, /^\d+\.\d+\.\d+$/u, "Host dependency must use an exact published version");
const locked = lock.packages[`node_modules/${name}`];
assert.equal(lock.packages[""].devDependencies[name], pin, "root lock must match Host pin");
assert.equal(locked.version, pin, "installed Host lock must match pin");
assert.match(locked.resolved, /^https:\/\/registry\.npmjs\.org\/@cjhyy\/code-shell-core\/-\/code-shell-core-\d+\.\d+\.\d+\.tgz$/u, "release checks require the published registry artifact");
assert.match(locked.integrity, /^sha512-/u, "Host artifact must have an integrity hash");
let directory = dirname(await realpath(fileURLToPath(import.meta.resolve(name)))), packagePath, installed;
while (dirname(directory) !== directory) {
  const candidate = join(directory, "package.json");
  const value = await readFile(candidate, "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (value?.name === name) { packagePath = candidate; installed = value; break; }
  directory = dirname(directory);
}
assert(installed, "the resolved Host entry must belong to its actual package");
assert.equal(installed.version, pin, "actual installed Host version must match pin");
const failures = [];
for (const project of await discoverProjects()) {
  const label = relative(repositoryRoot, project.output);
  try {
    PanelAppManifest.parse(JSON.parse(await readFile(join(project.output, ".codeshell-panel/panel.json"), "utf8")));
    await previewLocalPanelApp({ kind: "dir", path: project.output });
    console.log(`PASS ${label}: Core ${pin} strict manifest and installation preview`);
  } catch (error) {
    failures.push(label);
    console.error(`FAIL ${label}: ${error.message}`);
  }
}
console.log(JSON.stringify({ coreVersion: pin, corePackage: packagePath, developmentOverrideIgnored: Boolean(process.env.CODESHELL_PANEL_CORE_PACKAGE), failures }));
if (failures.length) process.exitCode = 1;
