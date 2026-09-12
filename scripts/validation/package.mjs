import assert from "node:assert/strict";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { repositoryRoot } from "../panel-projects.mjs";
import { assertHostSafeSchemaPatterns } from "./schema-pattern.mjs";

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
  const root = join(repositoryRoot, packagePath);
  const rootRealPath = await realpath(root);
  const manifestPath = join(root, ".codeshell-panel", "panel.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert(
    manifest.schemaVersion === 1 || manifest.schemaVersion === 2,
    `${packagePath}: schemaVersion must be 1 or 2`,
  );
  assert.match(manifest.id, /^[a-z][a-z0-9-]{0,63}$/, `${packagePath}: invalid id`);
  assert.equal(typeof manifest.version, "string", `${packagePath}: version is required`);
  assert.equal(typeof manifest.title?.default, "string", `${packagePath}: title is required`);
  assert.match(manifest.entry, /^app\/[^/].*\.html$/, `${packagePath}: entry must be below app/`);
  assert(Array.isArray(manifest.permissions), `${packagePath}: permissions must be an array`);
  const declaredSkillRoots = new Set();
  if (manifest.schemaVersion === 2 && manifest.agent) {
    assert(Array.isArray(manifest.agent.tools), `${packagePath}: agent.tools must be an array`);
    assert(Array.isArray(manifest.agent.skills), `${packagePath}: agent.skills must be an array`);
    const toolNames = new Set();
    for (const tool of manifest.agent.tools) {
      assert.match(tool.name, /^[a-z][a-z0-9_]{0,63}$/, `${packagePath}: invalid tool name`);
      assert(!toolNames.has(tool.name), `${packagePath}: duplicate tool ${tool.name}`);
      toolNames.add(tool.name);
      assert.equal(typeof tool.description, "string", `${packagePath}: tool description required`);
      assert.equal(tool.inputSchema?.type, "object", `${packagePath}: tool schema must be object`);
      assertHostSafeSchemaPatterns(tool.inputSchema, packagePath, tool.name);
      assert.equal(typeof tool.readOnly, "boolean", `${packagePath}: tool readOnly required`);
    }
    for (const skill of manifest.agent.skills) {
      assert.match(
        skill,
        /^agent\/skills\/[a-z][a-z0-9-]{0,63}\/SKILL\.md$/,
        `${packagePath}: invalid Skill path`,
      );
      const skillInfo = await stat(join(root, ...skill.split("/")));
      assert(skillInfo.isFile(), `${packagePath}: declared Skill is not a file`);
      assert(skillInfo.size <= 256 * 1024, `${packagePath}: declared Skill exceeds 256 KiB`);
      declaredSkillRoots.add(skill.slice(0, -"/SKILL.md".length));
    }
  }

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
  return { id: manifest.id, files: files.length, root, manifest, html, packagePath };
}
