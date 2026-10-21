// Refresh only the native entries owned by this business task; never install/release.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
for (const app of ["job-hunt-hq", "quant-lab"]) {
  const root = new URL(`../apps/${app}/`, import.meta.url);
  const path = new URL(".codeshell-panel/panel.json", root);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  for (const entry of Object.values(manifest.nativeEntries || {})) {
    const hash = createHash("sha256").update(await readFile(new URL(entry.entry, root))).digest("hex");
    if (process.argv.includes("--check")) {
      if (entry.sha256 !== hash) throw new Error(`${app}: stale native hash: ${entry.entry}`);
    } else entry.sha256 = hash;
  }
  if (!process.argv.includes("--check")) await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
}
console.log("✓ Job/Quant native entry hashes match");
