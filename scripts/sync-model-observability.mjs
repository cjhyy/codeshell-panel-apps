import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./panel-projects.mjs";

const source = join(repositoryRoot, "shared/model-observability.mjs");
const target = join(repositoryRoot, "apps/job-hunt-hq/app/model-observability.mjs");
if (process.argv.includes("--check"))
  assert.deepEqual(
    await readFile(target),
    await readFile(source),
    "Job Hunt model observer differs from shared source",
  );
else await copyFile(source, target);
