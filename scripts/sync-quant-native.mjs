import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = new URL("../apps/quant-lab/", import.meta.url);
const path = new URL(".codeshell-panel/panel.json", root);
const manifest = JSON.parse(await readFile(path, "utf8"));
const entries = Object.fromEntries(["fetch-holding-quotes", "build-market-pulse", "build-a-share-selection", "fetch-us-stock", "fetch-a-share-stock", "fetch-market-data", "initialize-a-share-history"].map((name) => [name, name]));
entries["quant-market-service"] = "market-service";
entries["quant-history-batch"] = "history-batch";
manifest.nativeEntries = Object.fromEntries(await Promise.all(Object.entries(entries).map(async ([name, file]) => {
  const entry = `app/tools/${file}.mjs`;
  return [name, { entry, sha256: createHash("sha256").update(await readFile(new URL(entry, root))).digest("hex") }];
})));
const output = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (output !== await readFile(path, "utf8")) throw new Error(`Run node scripts/sync-quant-native.mjs (${fileURLToPath(path)})`);
} else await writeFile(path, output);
