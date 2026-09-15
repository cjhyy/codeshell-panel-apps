import { access, lstat, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function listFiles(directory, root = directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    const path = join(directory, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Symlinks are not supported: ${path}`);
    if (info.isDirectory()) files.push(...(await listFiles(path, root)));
    else if (info.isFile()) files.push(relative(root, path).split(sep).join("/"));
    else throw new Error(`Unsupported file type: ${path}`);
  }
  return files;
}

export async function discoverProjects(root = repositoryRoot) {
  const projects = [];
  for (const collection of ["apps", "templates"]) {
    const directory = join(root, collection);
    if (!(await exists(directory))) continue;
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      if (!entry.isDirectory()) continue;
      const source = join(directory, entry.name);
      const manifestFile = join(source, ".codeshell-panel/panel.json");
      if (!(await exists(manifestFile))) continue;
      const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
      const configFile = join(source, "panel.build.json");
      const hasConfig = await exists(configFile);
      const config = hasConfig ? JSON.parse(await readFile(configFile, "utf8")) : null;
      if (hasConfig) {
        if (
          !config ||
          typeof config !== "object" ||
          Array.isArray(config) ||
          Object.keys(config).some((key) => !["entry", "nativeEntries"].includes(key)) ||
          typeof config.entry !== "string" ||
          !/^src\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:ts|tsx|js|mjs)$/.test(config.entry) ||
          config.entry.split("/").includes("..")
        ) {
          throw new Error(`${configFile}: expected { "entry": "src/main.ts" }`);
        }
        if (
          config.nativeEntries !== undefined &&
          (!config.nativeEntries ||
            typeof config.nativeEntries !== "object" ||
            Array.isArray(config.nativeEntries) ||
            Object.entries(config.nativeEntries).some(
              ([name, entry]) =>
                !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
                typeof entry !== "string" ||
                !/^native\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:ts|js|mjs)$/.test(entry) ||
                entry.split("/").includes(".."),
            ))
        )
          throw new Error(`${configFile}: invalid nativeEntries`);
      }
      const output = config ? join(root, "panels", entry.name) : source;
      if (projects.some((project) => project.output === output)) {
        throw new Error(`Duplicate Panel App output: ${output}`);
      }
      projects.push({
        name: basename(source),
        source,
        output,
        manifest,
        config,
        mode: config ? "source" : "native",
      });
    }
  }
  return projects;
}

export function selectProjects(projects, name) {
  if (!name) return projects;
  const selected = projects.filter(
    (project) => project.name === name || project.manifest.id === name,
  );
  if (selected.length !== 1) throw new Error(`Unknown or ambiguous Panel App: ${name}`);
  return selected;
}

export function readArguments(args, allowed = []) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--app" || key === "--port") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
      options[key.slice(2)] = value;
    } else if (allowed.includes(key)) options[key.slice(2)] = true;
    else throw new Error(`Unknown option: ${key}`);
  }
  return options;
}
