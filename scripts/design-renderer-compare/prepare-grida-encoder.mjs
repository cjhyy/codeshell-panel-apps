/**
 * Prepare Grida's unpublished JSON -> FlatBuffers encoder for the comparison.
 *
 * The renderer is npm @grida/canvas-wasm@0.91.0-canary.22. Its public API only
 * accepts FlatBuffers, while @grida/io and @grida/format are private workspace
 * packages. This uses a pinned official source commit near that npm release;
 * it does not claim that the commit is the exact source of the npm artifact.
 * Downloaded source, compiler, dependencies and output stay in ignored artifacts.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build, version as esbuildVersion } from "esbuild";

const run = promisify(execFile);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_COMMIT = "f0e2aeab23575fb9c2970d5f55275f1679c87155";
const SCHEMA_VERSION = "0.91.0-beta+20260311";
const SOURCE_BASE = `https://raw.githubusercontent.com/gridaco/grida/${SOURCE_COMMIT}/`;
const SOURCE_HASHES = {
  "packages/grida-canvas-io/format.ts": "c89dfa073b10b04215c624ba049e14cd12d048e07d6af8f127d0546e053d129e",
  "packages/grida-canvas-schema/index.ts": "6a9231677f53c8a6f51dc5b30f7a00cea6e4c684ffed0a4693da4386a4af5df9",
  "packages/grida-canvas-schema/grida.ts": "1d626347b38199aed9b88bd59d1b24503f71087d556e1146165d73be5157a18d",
  "packages/grida-canvas-cg/index.ts": "99eeab87f84170007fff8337ad05bdc0dbb27c982eebbb6101e842aa10437cc1",
  "packages/grida-canvas-cg/lib.ts": "b9ad382477395494ba9178a630782eee96e8cbc9aad693b247281ff6d4320a07",
  "packages/grida-canvas-color/index.ts": "e733b4e1b8e02a8e2f7c9249929829c63962279518783a65b4136942845d9f27",
  "packages/grida-canvas-color/lib.ts": "fef20ca070023de30267db2042b53f0b849e6ddd0005461ebcbc6edd870fbf4c",
  "packages/grida-canvas-color/color-parse.ts": "9ff7fde459d4d8d42ca65f8d91e21bb1f909d43b4f98a75680eab4aa228a91b3",
  "packages/grida-canvas-color/color-name.ts": "849c8a3ef57faa799b48326273768ca3cfe4968c300dd9a7b1c7324571172d0b",
  "packages/grida-format/src/index.ts": "5bde7ad5778cecd8143d912e3d336ce1b3a8d8d3ea2c74e8e4ab8046e87f1c2b",
  "format/grida.fbs": "ec10bea7312407398bc8cbcbe663018de2d930b4cc3aa554137a29ca7255d755",
  "bin/activate-flatc": "647033d1911fce604d79ad64f076c39f97f49a7ddc067a94db4bb77c6e9b621a",
  LICENSE: "43070e2d4e532684de521b885f385d0841030efa2b1a20bafb76133a5e1379c1",
};
const FLATBUFFERS_TARBALL = "https://registry.npmjs.org/flatbuffers/-/flatbuffers-25.9.23.tgz";
const FLATBUFFERS_INTEGRITY = "MI1qs7Lo4Syw0EOzUl0xjs2lsoeqFku44KpngfIduHBYvzm8h2+7K8YMQh1JtVVVrUvhLpNwqVi4DERegUJhPQ==";

const digest = (bytes, algorithm = "sha256") =>
  createHash(algorithm).update(bytes).digest(algorithm === "sha512" ? "base64" : "hex");

async function verifiedDownload(url, path, expected, algorithm = "sha256") {
  let bytes;
  try {
    bytes = await readFile(path);
    if (digest(bytes, algorithm) === expected) return bytes;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > 5 * 1024 * 1024) throw new Error(`Source download too large: ${url}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024 || digest(bytes, algorithm) !== expected)
    throw new Error(`Source integrity mismatch: ${url}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, bytes);
  await rename(`${path}.tmp`, path);
  return bytes;
}

export async function prepareGridaEncoder({
  outputDirectory = join(REPOSITORY_ROOT, "artifacts/design-renderer-compare/vendor/grida"),
  preparationDirectory = join(REPOSITORY_ROOT, "artifacts/design-renderer-compare/encoder-source"),
} = {}) {
  outputDirectory = resolve(outputDirectory);
  preparationDirectory = resolve(preparationDirectory);
  const sourceDirectory = join(preparationDirectory, SOURCE_COMMIT);
  await mkdir(outputDirectory, { recursive: true });
  const sources = await Promise.all(Object.entries(SOURCE_HASHES).map(async ([path, sha256]) => {
    const bytes = await verifiedDownload(`${SOURCE_BASE}${path}`, join(sourceDirectory, path), sha256);
    return { path, sha256, bytes: bytes.length, url: `${SOURCE_BASE}${path}` };
  }));

  // The official bootstrap pins FlatBuffers 25.12.19 binaries by SHA-256 and
  // checks the executable version. Confine its cache to ignored task artifacts.
  const generatedDirectory = join(sourceDirectory, "packages/grida-format/src");
  await run("python3", [join(sourceDirectory, "bin/activate-flatc"), "--", "--ts",
    "--ts-no-import-ext", "-o", generatedDirectory, join(sourceDirectory, "format/grida.fbs")], {
    env: { ...process.env, GRIDA_CACHE_DIR: join(preparationDirectory, "compiler-cache") },
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });

  const runtimeDirectory = join(preparationDirectory, "flatbuffers-25.9.23");
  const runtimeTarball = join(preparationDirectory, "flatbuffers-25.9.23.tgz");
  await verifiedDownload(FLATBUFFERS_TARBALL, runtimeTarball, FLATBUFFERS_INTEGRITY, "sha512");
  await mkdir(runtimeDirectory, { recursive: true });
  await run("tar", ["-xzf", runtimeTarball, "-C", runtimeDirectory], { timeout: 30_000 });
  const runtimePackage = JSON.parse(await readFile(join(runtimeDirectory, "package/package.json"), "utf8"));
  if (runtimePackage.name !== "flatbuffers" || runtimePackage.version !== "25.9.23")
    throw new Error("Unexpected FlatBuffers runtime package");

  const aliases = {
    "@grida/schema": join(sourceDirectory, "packages/grida-canvas-schema/index.ts"),
    "@grida/cg": join(sourceDirectory, "packages/grida-canvas-cg/index.ts"),
    "@grida/color": join(sourceDirectory, "packages/grida-canvas-color/index.ts"),
    "@grida/format": join(sourceDirectory, "packages/grida-format/src/index.ts"),
    flatbuffers: join(runtimeDirectory, "package", runtimePackage.module),
  };
  const result = await build({
    stdin: {
      contents: `import { format } from ${JSON.stringify(join(sourceDirectory, "packages/grida-canvas-io/format.ts"))};\nexport const schemaVersion = ${JSON.stringify(SCHEMA_VERSION)};\nexport function encode(document) { return format.document.encode.toFlatbuffer(document, schemaVersion); }\n`,
      resolveDir: sourceDirectory,
      sourcefile: "grida-encoder-entry.mjs",
      loader: "js",
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
    minify: true,
    legalComments: "inline",
    metafile: true,
    alias: aliases,
    logLevel: "silent",
    banner: { js: `/* Grida JSON encoder: ${SOURCE_COMMIT}; Apache-2.0. See grida-encoder.metadata.json and GRIDA-ENCODER-LICENSE.txt. */` },
  });
  const code = result.outputFiles[0].contents;
  const modulePath = join(outputDirectory, "grida-encoder.mjs");
  await writeFile(`${modulePath}.tmp`, code);
  await rename(`${modulePath}.tmp`, modulePath);
  await writeFile(join(outputDirectory, "GRIDA-ENCODER-LICENSE.txt"), await readFile(join(sourceDirectory, "LICENSE")));
  await writeFile(join(outputDirectory, "FLATBUFFERS-LICENSE.txt"), await readFile(join(runtimeDirectory, "package/LICENSE")));

  // Verify the prepared module produces a genuine GRID FlatBuffer, rather than
  // accidentally shipping the JSON input or a renderer-specific SVG shortcut.
  const { encode } = await import(`${pathToFileURL(modulePath).href}?sha256=${digest(code)}`);
  const probe = encode({
    nodes: { main: { type: "scene", id: "main", name: "Encoder probe", active: true,
      locked: false, constraints: { children: "multiple" }, guides: [], edges: [] } },
    links: { main: [] }, scenes_ref: ["main"], properties: {}, images: {}, bitmaps: {},
  });
  if (!(probe instanceof Uint8Array) || Buffer.from(probe.subarray(4, 8)).toString() !== "GRID")
    throw new Error("Prepared Grida encoder failed the FlatBuffers smoke check");

  const metadata = {
    rendererPackage: "@grida/canvas-wasm@0.91.0-canary.22",
    encoderSource: { repository: "https://github.com/gridaco/grida", commit: SOURCE_COMMIT,
      license: "Apache-2.0", schemaVersion: SCHEMA_VERSION,
      relationship: "Official source near the npm release; exact npm-build source provenance is unverified." },
    sources,
    compiler: { version: "25.12.19", bootstrap: "bin/activate-flatc",
      binaryIntegrity: "Pinned platform-specific SHA-256 hashes in the verified official bootstrap" },
    dependencies: [{ name: "flatbuffers", version: "25.9.23", license: runtimePackage.license,
      tarball: FLATBUFFERS_TARBALL, integrity: `sha512-${FLATBUFFERS_INTEGRITY}` }],
    build: { esbuildVersion, platform: "neutral", format: "esm", target: "es2022",
      inputFiles: Object.keys(result.metafile.inputs).length },
    output: { file: "grida-encoder.mjs", bytes: (await stat(modulePath)).size, sha256: digest(code) },
    smokeCheck: { format: "GRID", bytes: probe.byteLength, scenes: 1 },
  };
  const metadataPath = join(outputDirectory, "grida-encoder.metadata.json");
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return { modulePath, metadataPath, ...metadata };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) throw new Error("Usage: node prepare-grida-encoder.mjs [output-directory]");
  prepareGridaEncoder(arguments_[0] ? { outputDirectory: arguments_[0] } : {})
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
