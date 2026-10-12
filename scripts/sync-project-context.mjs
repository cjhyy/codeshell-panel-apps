import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./panel-projects.mjs";

const check = process.argv.includes("--check");
const asset = "project-context.mjs";
const source = join(repositoryRoot, "shared", asset);
const expected = await readFile(source);
for (const app of ["design-studio", "job-hunt-hq", "quant-lab"]) {
  const target = join(repositoryRoot, "apps", app, "app", asset);
  if (check) assert.deepEqual(await readFile(target), expected, `${app}/${asset} differs from shared/${asset}`);
  else await copyFile(source, target);
}
