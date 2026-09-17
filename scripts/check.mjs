import { spawnSync } from "node:child_process";
import { repositoryRoot } from "./panel-projects.mjs";
import { suites } from "../tests/suites.mjs";

let testsOnly = false;
let selectedSuite;
for (let index = 0; index < process.argv.slice(2).length; index += 1) {
  const argument = process.argv[index + 2];
  if (argument === "--tests-only") testsOnly = true;
  else if (argument === "--suite") selectedSuite = process.argv[++index + 2];
  else throw new Error(`Unknown option: ${argument}`);
}
if (selectedSuite !== undefined && !suites.some((suite) => suite.id === selectedSuite)) {
  throw new Error(`Unknown suite: ${selectedSuite}. Available: ${suites.map((suite) => suite.id).join(", ")}`);
}
if (process.argv.includes("--suite") && !selectedSuite) throw new Error("--suite requires a name");

function run(arguments_) {
  const child = spawnSync(process.execPath, arguments_, { cwd: repositoryRoot, stdio: "inherit" });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}

if (!testsOnly) {
  console.log("Checking source types and committed build output");
  run(["scripts/sync-panel-select.mjs", "--check"]);
  run(["node_modules/typescript/bin/tsc", "--project", "tsconfig.json"]);
  run(["scripts/build-panels.mjs", "--check"]);
}
for (const suite of suites) {
  if (selectedSuite && selectedSuite !== suite.id) continue;
  console.log(`\n${suite.label}`);
  for (const command of suite.commands) run(command);
}
