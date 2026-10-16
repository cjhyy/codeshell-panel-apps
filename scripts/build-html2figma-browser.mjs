import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { build, version as esbuildVersion } from "esbuild";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = resolve(repositoryRoot, "third-party/html2figma");
const sourceRoot = resolve(vendorRoot, "upstream");
const outputPath = resolve(repositoryRoot, "apps/design-studio/app/vendor/html2figma-browser.mjs");
const noticePath = resolve(repositoryRoot, "apps/design-studio/app/vendor/html2figma-NOTICE.md");
const provenancePath = resolve(vendorRoot, "build.json");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((argument) => argument !== "--check"))
  throw new Error("Usage: node scripts/build-html2figma-browser.mjs [--check]");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sources = JSON.parse(await readFile(resolve(vendorRoot, "sources.json"), "utf8"));
if (
  sources.format !== "codeshell.vendor.sources" ||
  sources.version !== 1 ||
  sources.upstreamCommit !== "ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c" ||
  !Array.isArray(sources.files) ||
  sha256(JSON.stringify(sources.files)) !== sources.sourceTreeSha256
)
  throw new Error("Invalid html2figma source inventory");
const sourcePaths = new Set();
for (const file of sources.files) {
  if (
    typeof file.path !== "string" ||
    !/^[a-zA-Z0-9_./-]+$/u.test(file.path) ||
    file.path.split("/").some((part) => !part || part === "." || part === "..") ||
    sourcePaths.has(file.path)
  )
    throw new Error("Unsafe or duplicate html2figma source path");
  const bytes = await readFile(resolve(sourceRoot, file.path));
  if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
    throw new Error(`Vendored source differs from its recorded upstream bytes: ${file.path}`);
  sourcePaths.add(file.path);
}

// Each call creates a fresh lexical realm. No host globals are patched, and no
// shared current-window variable can leak between concurrent iframe captures.
const globals = [
  "Node", "Element", "HTMLElement", "HTMLImageElement", "HTMLInputElement",
  "HTMLSelectElement", "HTMLTextAreaElement", "HTMLCanvasElement", "HTMLVideoElement",
  "SVGElement", "Text", "Range", "DOMRect", "DOMParser", "XMLSerializer", "DOMMatrix",
];
const define = Object.fromEntries(globals.map((name) => [name, `realm.${name}`]));
define.window = "realm";
define.document = "realm.document";
const result = await build({
  absWorkingDir: repositoryRoot,
  entryPoints: [relative(repositoryRoot, resolve(vendorRoot, "integration/entry.ts"))],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "html2figmaCore",
  target: "es2022",
  tsconfigRaw: { compilerOptions: { alwaysStrict: true, useDefineForClassFields: true } },
  write: false,
  metafile: true,
  sourcemap: false,
  legalComments: "inline",
  define,
  alias: {
    "@html2figma/shared/utils": resolve(sourceRoot, "packages/shared/utils.ts"),
    "@html2figma/shared/css-utils": resolve(sourceRoot, "packages/shared/css-utils.ts"),
    "@html2figma/shared": resolve(vendorRoot, "integration/shared.ts"),
  },
});
for (const input of Object.keys(result.metafile.inputs)) {
  const path = resolve(repositoryRoot, input);
  if (
    !path.startsWith(`${vendorRoot}/integration/`) &&
    !(path.startsWith(`${sourceRoot}/`) && sourcePaths.has(relative(sourceRoot, path)))
  )
    throw new Error(`Unexpected html2figma runtime dependency: ${input}`);
}
if (Object.keys(result.metafile.outputs).some((key) => result.metafile.outputs[key].imports.length))
  throw new Error("html2figma runtime must not contain external imports");
const provenance = {
  engine: "html2figma",
  upstreamCommit: sources.upstreamCommit,
  sourceTreeSha256: sources.sourceTreeSha256,
  integrationVersion: 1,
};
const body = `/*! html2figma browser runtime; MIT declared upstream. See html2figma-NOTICE.md. */
function createRuntime(realm) {
${result.outputFiles[0].text}
return html2figmaCore;
}

export const HTML2FIGMA_PROVENANCE = Object.freeze(${JSON.stringify(provenance)});

export function convertToDesignDSL(root, options = {}) {
  const realm = root?.ownerDocument?.defaultView;
  if (!realm || !(root instanceof realm.Element) || root.ownerDocument !== realm.document)
    throw new TypeError("html2figma requires an Element with its own live document realm");
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("html2figma options must be an object");
  const maxDepth = options.maxDepth ?? 100;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 100)
    throw new RangeError("html2figma maxDepth must be an integer from 0 to 100");
  const runtime = createRuntime(realm);
  return runtime.convert(root, { includeRawStyles: options.includeRawStyles !== false, maxDepth });
}
`;
const notice = await readFile(resolve(vendorRoot, "NOTICE.md"), "utf8");
const buildReceipt = {
  ...provenance,
  esbuildVersion,
  output: relative(repositoryRoot, outputPath),
  bytes: Buffer.byteLength(body),
  sha256: sha256(body),
  notice: { output: relative(repositoryRoot, noticePath), bytes: Buffer.byteLength(notice), sha256: sha256(notice) },
  runtimeInputs: Object.keys(result.metafile.inputs).sort(),
};
const receipt = `${JSON.stringify(buildReceipt, null, 2)}\n`;
if (check) {
  if ((await readFile(outputPath, "utf8")) !== body || (await readFile(noticePath, "utf8")) !== notice || (await readFile(provenancePath, "utf8")) !== receipt)
    throw new Error("Committed html2figma runtime is stale; run node scripts/build-html2figma-browser.mjs");
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body);
  await writeFile(noticePath, notice);
  await writeFile(provenancePath, receipt);
}
console.log(`html2figma browser ${check ? "verified" : "built"}: ${buildReceipt.sha256}`);
