import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, lstat, writeFile, link, unlink } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 2 && args[0] === "--output"),
  "Usage: node scripts/package-design-studio.mjs [--output directory]",
);
assert.equal(
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim(),
  "",
  "Package a clean, verified commit; commit source and generated output first.",
);
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const panelRoot = resolve(root, "apps/design-studio");
const manifest = JSON.parse(
  await readFile(resolve(panelRoot, ".codeshell-panel/panel.json"), "utf8"),
);
const output = resolve(root, args[1] ?? `artifacts/design-studio-${manifest.version}`);
await mkdir(output, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixedDate = new Date("2000-01-01T00:00:00Z");

async function inventory(directory, prefix = "") {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    const path = resolve(directory, entry.name),
      name = `${prefix}${entry.name}`;
    assert(!(await lstat(path)).isSymbolicLink(), `Package cannot contain a symlink: ${path}`);
    if (entry.isDirectory()) files.push(...(await inventory(path, `${name}/`)));
    else if (entry.isFile()) files.push({ name, bytes: await readFile(path) });
    else throw Error(`Unsupported package entry: ${path}`);
  }
  return files;
}

async function archive(name, files) {
  const destination = resolve(output, name),
    temporary = `${destination}.${process.pid}.tmp`;
  const zip = new yazl.ZipFile();
  for (const file of files)
    zip.addBuffer(file.bytes, file.name, { mtime: fixedDate, mode: 0o100644 });
  const stream = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
  try {
    await new Promise((done, fail) => {
      stream.on("close", done);
      stream.on("error", fail);
      zip.outputStream.on("error", fail);
      zip.outputStream.pipe(stream);
      zip.end();
    });
    await link(temporary, destination); // create-only publication
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  const bytes = await readFile(destination);
  return {
    file: name,
    bytes: bytes.length,
    sha256: hash(bytes),
    entries: files.map((file) => ({
      path: file.name,
      bytes: file.bytes.length,
      sha256: hash(file.bytes),
    })),
  };
}

const panelFiles = [];
for (const folder of [".codeshell-panel", "agent", "app"]) {
  for (const file of await inventory(resolve(panelRoot, folder), `${folder}/`)) {
    panelFiles.push({ ...file, name: `design-studio/${file.name}` });
  }
}
panelFiles.push({
  name: "design-studio/README.md",
  bytes: await readFile(resolve(panelRoot, "README.md")),
});
const pluginFiles = (await inventory(resolve(panelRoot, "app/html-to-figma-plugin"))).map(
  (file) => ({ ...file, name: `html-to-figma-plugin/${file.name}` }),
);
const archives = [
  await archive(`design-studio-${manifest.version}.zip`, panelFiles),
  await archive(`codeshell-html-to-figma-${manifest.version}.zip`, pluginFiles),
];
const receipt = {
  format: "codeshell.design-studio.release",
  version: 1,
  panelVersion: manifest.version,
  sourceCommit: commit,
  sourceDirectory: relative(root, panelRoot),
  archives,
};
await writeFile(resolve(output, "release.json"), JSON.stringify(receipt, null, 2) + "\n", {
  flag: "wx",
});
await writeFile(
  resolve(output, "SHA256SUMS"),
  archives.map((item) => `${item.sha256}  ${item.file}`).join("\n") + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify(
    {
      output,
      version: manifest.version,
      sourceCommit: commit,
      archives: archives.map(({ entries, ...item }) => item),
    },
    null,
    2,
  ),
);
