// Test-only pinned, architecture-independent Python zipapp. Not a Panel installer.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const version = "2026.08.19";
const sha256 = "1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6";
const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/yt-dlp`;
assert.equal(process.argv.length, 3, "Pass a new fixture output directory");
const output = resolve(process.argv[2]);
await mkdir(output); // Never overwrite an existing fixture or user directory.
const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
assert.ok(response.ok, `Fixture download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
assert.ok(bytes.length > 0 && bytes.length < 20 * 1024 * 1024);
assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256);
await writeFile(join(output, "yt-dlp"), bytes, { flag: "wx", mode: 0o755 });
await writeFile(
  join(output, "fixture.json"),
  JSON.stringify({ version, sha256, url }, null, 2) + "\n",
  { flag: "wx" },
);
console.log(`Verified download fixture ${version}: ${sha256}`);
