import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules/canvaskit-wasm");
const target = join(root, "apps/design-studio/app/canvas/vendor");
const check = process.argv.includes("--check");
const hashes = {
  "canvaskit.js": "443777592179808354031cf411d8d43cac9f6b98d1227123c5c22d401b0fbf7f",
  "canvaskit.wasm": "25ebed8e60158c5854f8dc807b936daca21354f8bfb6a2231266b0a93812f301",
};
const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
assert.equal(pkg.version, "0.42.0");
if (!check) await mkdir(target, { recursive: true });
const inventory = {
  package: "canvaskit-wasm",
  version: pkg.version,
  license: "BSD-3-Clause",
  files: {},
};
for (const [name, expected] of Object.entries(hashes)) {
  const bytes = await readFile(join(source, "bin", name));
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest, expected, `Upstream ${name} hash changed`);
  inventory.files[name] = { sha256: digest, bytes: bytes.length };
  if (check)
    assert.deepEqual(
      await readFile(join(target, name)),
      bytes,
      `${name} differs from pinned package`,
    );
  else await writeFile(join(target, name), bytes);
}
const license = await readFile(join(source, "LICENSE"));
const metadata = JSON.stringify(inventory, null, 2) + "\n";
if (check) {
  assert.deepEqual(await readFile(join(target, "LICENSE.md")), license);
  assert.equal(await readFile(join(target, "runtime.json"), "utf8"), metadata);
} else {
  await writeFile(join(target, "LICENSE.md"), license);
  await writeFile(join(target, "runtime.json"), metadata);
}
console.log(`CanvasKit ${pkg.version}: pinned assets ${check ? "verified" : "prepared"}`);
