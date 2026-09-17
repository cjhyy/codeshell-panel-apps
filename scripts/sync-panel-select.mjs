import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./panel-projects.mjs";

const check = process.argv.includes("--check");
const appDirectories = [
  "apps/design-studio/app",
  "apps/job-hunt-hq/app",
  "apps/quant-lab/app",
  "apps/video-download/app",
  "apps/video-studio/public",
];

for (const asset of ["panel-select.css", "panel-select.js"]) {
  const source = join(repositoryRoot, "shared", asset);
  const expected = await readFile(source);
  for (const directory of appDirectories) {
    const target = join(repositoryRoot, directory, asset);
    if (check) {
      assert.deepEqual(await readFile(target), expected, `${directory}/${asset} differs from shared/${asset}`);
    } else {
      await copyFile(source, target);
    }
  }
}
