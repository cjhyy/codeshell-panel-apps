/* Download/build only the pinned experimental renderer into ignored artifacts. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, copyFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build, version as esbuildVersion } from "esbuild";
import { GRIDA_PACKAGE } from "./grida-adapter.mjs";
import { prepareGridaEncoder } from "./prepare-grida-encoder.mjs";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes)
  .digest(algorithm === "sha512" ? "base64" : "hex");

export async function prepareGrida({ outputDirectory = join(root,
  "artifacts/design-renderer-compare/vendor/grida") } = {}) {
  const cache = join(root, "artifacts/design-renderer-compare/vendor");
  const archive = join(cache, `grida-canvas-wasm-${GRIDA_PACKAGE.version}.tgz`);
  const expected = GRIDA_PACKAGE.integrity.slice("sha512-".length);
  await mkdir(cache, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  let bytes;
  try { bytes = await readFile(archive); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const tarball = `https://registry.npmjs.org/@grida/canvas-wasm/-/canvas-wasm-${GRIDA_PACKAGE.version}.tgz`;
  if (!bytes || hash(bytes, "sha512") !== expected) {
    const response = await fetch(tarball, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw Error(`Grida download failed: ${response.status}`);
    if (Number(response.headers.get("content-length")) > 10 * 1024 * 1024)
      throw Error("Grida tarball exceeded the pinned download budget");
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 10 * 1024 * 1024 || hash(bytes, "sha512") !== expected)
      throw Error("Grida package integrity mismatch");
    await writeFile(archive, bytes);
  }
  const extraction = join(cache, `unpacked-${GRIDA_PACKAGE.version}`);
  await mkdir(extraction, { recursive: true });
  await run("tar", ["-xzf", archive, "-C", extraction]);
  const packageRoot = join(extraction, "package");
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (manifest.version !== GRIDA_PACKAGE.version || manifest.license !== GRIDA_PACKAGE.license)
    throw Error("Unexpected Grida package identity or license");
  const wasm = await readFile(join(packageRoot, "dist/grida_canvas_wasm.wasm"));
  if (wasm.length !== GRIDA_PACKAGE.wasmBytes || hash(wasm) !== GRIDA_PACKAGE.wasmSha256)
    throw Error("Grida WASM integrity mismatch");
  const entry = join(packageRoot, "dist/index.js");
  await build({ stdin: { contents: `import runtime from ${JSON.stringify(entry)};\nexport const init = runtime.default;\nexport const version = runtime.version;`,
    resolveDir: packageRoot, sourcefile: "grida-runtime-entry.mjs", loader: "js" },
    outfile: join(outputDirectory, "grida-runtime.mjs"), bundle: true, format: "esm",
    platform: "browser", target: "es2022", external: ["node:*"], logLevel: "silent" });
  await copyFile(join(packageRoot, "dist/grida_canvas_wasm.wasm"), join(outputDirectory, "grida_canvas_wasm.wasm"));
  await copyFile(join(packageRoot, "LICENSE"), join(outputDirectory, "GRIDA-LICENSE.txt"));
  const encoder = await prepareGridaEncoder({ outputDirectory });
  const receipt = { package: GRIDA_PACKAGE, tarball, tarballBytes: bytes.length,
    esbuildVersion, runtimeSha256: hash(await readFile(join(outputDirectory, "grida-runtime.mjs"))),
    wasmHostFileBudget: 16 * 1024 * 1024, wasmExceedsCurrentHostBudget: true,
    encoderMetadata: encoder.metadataPath,
    outputDirectory, productionInstalled: false };
  await writeFile(join(outputDirectory, "grida-package.metadata.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw Error("Usage: node prepare-grida.mjs [output-directory]");
  prepareGrida(process.argv[2] ? { outputDirectory: resolve(process.argv[2]) } : {})
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
