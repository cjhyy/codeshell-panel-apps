import assert from "node:assert/strict";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["apps/design-studio", "apps/quant-lab", "templates/starter"];
const forbiddenNames = new Set([
  ".claude-plugin",
  ".codex-plugin",
  ".codeshell-plugin",
  ".mcp.json",
  "agents",
  "commands",
  "hooks",
  "skills",
]);
const allowedExtensions = new Set([
  ".html",
  ".js",
  ".mjs",
  ".md",
  ".css",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
]);

async function walk(directory, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const info = await lstat(absolute);
    const localPath = relative(root, absolute).split(sep).join("/");
    assert(!info.isSymbolicLink(), `${localPath}: symlinks are not allowed`);
    assert(
      !forbiddenNames.has(entry.name),
      `${localPath}: Agent Plugin content is not allowed`,
    );
    if (info.isDirectory()) files.push(...(await walk(absolute, root)));
    else {
      assert(info.isFile(), `${localPath}: unsupported file type`);
      files.push(localPath);
    }
  }
  return files;
}

async function validatePackage(packagePath) {
  const root = join(repositoryRoot, packagePath);
  const rootRealPath = await realpath(root);
  const manifestPath = join(root, ".codeshell-panel", "panel.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.equal(
    manifest.schemaVersion,
    1,
    `${packagePath}: schemaVersion must be 1`,
  );
  assert.match(
    manifest.id,
    /^[a-z][a-z0-9-]{0,63}$/,
    `${packagePath}: invalid id`,
  );
  assert.equal(
    typeof manifest.version,
    "string",
    `${packagePath}: version is required`,
  );
  assert.equal(
    typeof manifest.title?.default,
    "string",
    `${packagePath}: title is required`,
  );
  assert.match(
    manifest.entry,
    /^app\/[^/].*\.html$/,
    `${packagePath}: entry must be below app/`,
  );
  assert(
    Array.isArray(manifest.permissions),
    `${packagePath}: permissions must be an array`,
  );

  const entry = resolve(root, ...manifest.entry.split("/"));
  const entryRealPath = await realpath(entry);
  assert(
    entryRealPath.startsWith(`${rootRealPath}${sep}`),
    `${packagePath}: entry escapes its package`,
  );
  assert(
    (await stat(entryRealPath)).isFile(),
    `${packagePath}: entry is not a file`,
  );

  const files = await walk(root);
  for (const file of files) {
    if (
      file === ".codeshell-panel/panel.json" ||
      file === "README.md" ||
      file === "LICENSE"
    ) {
      continue;
    }
    assert(
      file.startsWith("app/"),
      `${packagePath}/${file}: assets must live under app/`,
    );
    assert(
      allowedExtensions.has(extname(file).toLowerCase()),
      `${packagePath}/${file}: unsupported asset extension`,
    );
  }

  const html = await readFile(entry, "utf8");
  assert(
    !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html),
    `${packagePath}: inline scripts are not allowed`,
  );
  return { id: manifest.id, files: files.length };
}

const results = [];
for (const packagePath of packages)
  results.push(await validatePackage(packagePath));

const geometry = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/geometry.mjs"))
);
assert.deepEqual(
  geometry.selectionBounds([
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 20, y: 10, width: 5, height: 5 },
  ]),
  { x: 0, y: 0, width: 25, height: 15 },
);

const quant = await import(
  pathToFileURL(join(repositoryRoot, "apps/quant-lab/app/engine.mjs"))
);
const bars = quant.generateDemoBars(260);
const run = quant.runBacktest(bars, {
  strategy: { type: "sma-cross", fast: 20, slow: 50 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 8,
});
assert.equal(run.equity.length, 260);
assert(Number.isFinite(run.metrics.finalEquity));

for (const result of results) {
  console.log(`✓ ${result.id}: ${result.files} files`);
}
console.log("✓ Design Studio geometry smoke test");
console.log("✓ Quant Lab engine smoke test");
