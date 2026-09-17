import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--suite" && args[1] === "quant-lab")) {
  throw new Error("Usage: node scripts/test-quant-lab.mjs [--suite quant-lab]");
}

const workflows = [
  "panel-host-calls", "portfolio", "portfolio-rules", "portfolio-data", "today", "news", "notes",
  "history-data", "market-data-sources", "market-insights", "stock-screener", "market-pulse",
  "a-share-selection", "a-share-stock-detail", "us-stock-detail", "a-share-history",
];
const tests = (await readdir(join(root, "tests/apps/quant-lab")))
  .filter((name) => name.endsWith(".test.mjs")).sort()
  .map((name) => `tests/apps/quant-lab/${name}`);
const commands = workflows.map((name) => [`scripts/quant-lab-${name}.mjs`]);
commands.push(["--test", ...tests]);
for (const command of commands) {
  const result = spawnSync(process.execPath, command, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
