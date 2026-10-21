import { readFile, writeFile } from "node:fs/promises";
const source = await readFile(new URL("../shared/observation-runner.mjs", import.meta.url), "utf8");
for (const app of ["job-hunt-hq", "quant-lab"]) {
  const path = new URL(`../apps/${app}/app/tools/observation-runner.mjs`, import.meta.url);
  if (process.argv.includes("--check")) {
    if (await readFile(path, "utf8") !== source) throw new Error(`${app}: observation-runner copy differs`);
  } else await writeFile(path, source);
}
console.log("✓ Observation runner installable copies match");
