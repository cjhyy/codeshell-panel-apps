import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build } from "esbuild";
import { repositoryRoot } from "./panel-projects.mjs";

const files = process.argv.slice(2);
if (!files.length || files.some((file) => !file.endsWith(".test.ts"))) {
  throw new Error("Usage: node scripts/run-typescript-tests.mjs tests/example.test.ts [...]");
}
const temporary = await mkdtemp(join(tmpdir(), "codeshell-panel-tests-"));
let status = 1;
try {
  const entryPoints = Object.fromEntries(files.map((file, index) => [
    `${index}-${basename(file, ".ts")}`, resolve(repositoryRoot, file),
  ]));
  await build({
    absWorkingDir: repositoryRoot,
    entryPoints,
    outdir: temporary,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: "inline",
    logLevel: "silent",
  });
  // Run ordinary ESM on Node 20; do not rely on newer Node TypeScript stripping.
  const child = spawnSync(process.execPath, [
    "--enable-source-maps", "--test",
    ...Object.keys(entryPoints).map((name) => join(temporary, `${name}.mjs`)),
  ], { cwd: repositoryRoot, stdio: "inherit" });
  if (child.error) throw child.error;
  status = child.status ?? 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
process.exitCode = status;
