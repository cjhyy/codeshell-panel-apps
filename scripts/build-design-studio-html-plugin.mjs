import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build, version as esbuildVersion } from "esbuild";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = resolve(root, "third-party/html2figma-plugin");
const output = resolve(root, "apps/design-studio/app/html-to-figma-plugin");
const check = process.argv.includes("--check");
assert(
  process.argv.slice(2).every((arg) => arg === "--check"),
  "Usage: node scripts/build-design-studio-html-plugin.mjs [--check]",
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
for (const directory of [vendor, resolve(root, "third-party/html2figma")]) {
  const inventory = JSON.parse(await readFile(resolve(directory, "sources.json"), "utf8"));
  assert.equal(inventory.upstreamCommit, "ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c");
  assert.equal(hash(JSON.stringify(inventory.files)), inventory.sourceTreeSha256);
  for (const item of inventory.files) {
    assert(
      /^[a-zA-Z0-9_./-]+$/u.test(item.path) &&
        !item.path.split("/").some((p) => ["", ".", ".."].includes(p)),
    );
    const bytes = await readFile(resolve(directory, "upstream", item.path));
    assert.equal(bytes.length, item.bytes);
    assert.equal(hash(bytes), item.sha256, item.path);
  }
}
// Check the browser runtime against its independently pinned source build too.
execFileSync(process.execPath, [resolve(root, "scripts/build-html2figma-browser.mjs"), "--check"], {
  cwd: root,
  stdio: "pipe",
});
const aliases = {
  "@html2figma/shared/utils": resolve(
    root,
    "third-party/html2figma/upstream/packages/shared/utils.ts",
  ),
  "@html2figma/shared/css-utils": resolve(
    root,
    "third-party/html2figma/upstream/packages/shared/css-utils.ts",
  ),
  "@html2figma/shared": resolve(vendor, "integration/shared.ts"),
};
const common = {
  absWorkingDir: root,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  write: false,
  metafile: true,
  legalComments: "inline",
  alias: aliases,
  logLevel: "silent",
};
const capture = await build({
  ...common,
  entryPoints: [resolve(vendor, "integration/capture.ts")],
});
const ui = await build({
  ...common,
  define: { __CAPTURE_RUNTIME__: JSON.stringify(capture.outputFiles[0].text) },
  entryPoints: [resolve(vendor, "integration/ui.ts")],
});
const code = await build({
  ...common,
  entryPoints: [resolve(vendor, "integration/code.ts")],
  inject: [resolve(vendor, "integration/sandbox-globals.ts")],
});
const runtimeInputs = new Set();
for (const result of [ui, code, capture]) {
  for (const value of Object.values(result.metafile.outputs))
    assert.equal(value.imports.length, 0, "Plugin must be self-contained");
  for (const path of Object.keys(result.metafile.inputs)) {
    assert(!path.includes("node_modules/"), `Unexpected runtime dependency: ${path}`);
    runtimeInputs.add(path);
  }
}
const sourceTemplate = await readFile(resolve(vendor, "integration/ui.html"), "utf8");
const manifest = {
  name: "CodeShell HTML to Figma",
  api: "1.0.0",
  editorType: ["figma"],
  main: "code.js",
  ui: "ui.html",
  documentAccess: "dynamic-page",
  networkAccess: { allowedDomains: ["none"] },
};
const files = new Map([
  ["manifest.json", JSON.stringify(manifest, null, 2) + "\n"],
  [
    "code.js",
    "/*! html2figma FigmaService/adapter; MIT. See NOTICE.md. */\n" + code.outputFiles[0].text,
  ],
  [
    "ui.html",
    sourceTemplate.replace(
      "/*__BUNDLE__*/",
      ui.outputFiles[0].text.replace(/<\/script/giu, "<\\/script"),
    ),
  ],
  ["README.md", await readFile(resolve(vendor, "integration/README.md"), "utf8")],
  ["NOTICE.md", await readFile(resolve(vendor, "NOTICE.md"), "utf8")],
]);
const receipt = {
  format: "codeshell.html2figma.plugin-build",
  version: 1,
  upstreamCommit: "ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c",
  esbuildVersion,
  runtimeInputs: [...runtimeInputs].sort(),
  outputs: [...files].map(([path, bytes]) => ({
    path,
    bytes: Buffer.byteLength(bytes),
    sha256: hash(bytes),
  })),
};
files.set("build.json", JSON.stringify(receipt, null, 2) + "\n");
if (!check) await mkdir(output, { recursive: true });
for (const [path, bytes] of files) {
  const destination = resolve(output, path);
  if (check)
    assert.equal(await readFile(destination, "utf8"), bytes, `Stale generated plugin file ${path}`);
  else await writeFile(destination, bytes);
}
console.log(
  `HTML to Figma plugin ${check ? "verified" : "built"}: ${relative(root, output)} (${receipt.outputs.reduce((n, item) => n + item.bytes, 0)} bytes)`,
);
