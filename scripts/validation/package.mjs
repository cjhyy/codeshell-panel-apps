import assert from "node:assert/strict";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { repositoryRoot } from "../panel-projects.mjs";
import { PanelAppManifest, previewLocalPanelApp } from "@cjhyy/code-shell-core";

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
  ".mp3",
  ".wav",
  ".woff",
  ".woff2",
  ".ttf",
]);
const allowedAgentExtensions = new Set([".md", ".json", ".png", ".jpg", ".jpeg", ".webp"]);
async function walk(directory, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const info = await lstat(absolute);
    const localPath = relative(root, absolute).split(sep).join("/");
    assert(!info.isSymbolicLink(), `${localPath}: symlinks are not allowed`);
    assert(
      localPath.includes("/") || !forbiddenNames.has(entry.name),
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

export async function validatePackage(packagePath) {
  const root = resolve(repositoryRoot, packagePath);
  const rootRealPath = await realpath(root);
  const manifestPath = join(root, ".codeshell-panel", "panel.json");
  // The pinned, published Host owns the installation contract, including tool
  // schemas, strict manifest fields and limits. Do not maintain a second schema.
  const manifest = PanelAppManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  assert.match(manifest.entry, /^app\/[^/].*\.html$/, `${packagePath}: entry must be below app/`);
  const declaredSkillRoots = new Set(
    (manifest.schemaVersion === 2 ? manifest.agent?.skills ?? [] : [])
      .map((skill) => skill.slice(0, -"/SKILL.md".length)),
  );

  const entry = resolve(root, ...manifest.entry.split("/"));
  const entryRealPath = await realpath(entry);
  assert(
    entryRealPath.startsWith(`${rootRealPath}${sep}`),
    `${packagePath}: entry escapes its package`,
  );
  assert((await stat(entryRealPath)).isFile(), `${packagePath}: entry is not a file`);

  const files = await walk(root);
  for (const file of files) {
    if (file === ".codeshell-panel/panel.json" || file === "README.md" || file === "LICENSE") {
      continue;
    }
    const declaredAgentAsset = [...declaredSkillRoots].some(
      (skillRoot) => file === skillRoot || file.startsWith(`${skillRoot}/`),
    );
    assert(
      file.startsWith("app/") || declaredAgentAsset,
      `${packagePath}/${file}: assets must live under app/ or a declared Skill`,
    );
    assert(
      (declaredAgentAsset ? allowedAgentExtensions : allowedExtensions).has(
        extname(file).toLowerCase(),
      ),
      `${packagePath}/${file}: unsupported asset extension`,
    );
  }

  const html = await readFile(entry, "utf8");
  assert(
    !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html),
    `${packagePath}: inline scripts are not allowed`,
  );
  // Directory preview is read-only: it validates the actual installable tree,
  // bounded file sizes and native-entry hashes without installing or executing it.
  await previewLocalPanelApp({ kind: "dir", path: root });
  return { id: manifest.id, files: files.length, root, manifest, html, packagePath };
}
