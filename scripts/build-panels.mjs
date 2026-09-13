import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build, version as esbuildVersion } from "esbuild";
import { init, parse } from "es-module-lexer";
import { validatePackage } from "./validation/package.mjs";
import {
  discoverProjects,
  exists,
  listFiles,
  readArguments,
  selectProjects,
} from "./panel-projects.mjs";

const assetExtensions = new Set([
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
  ".mp3",
  ".wav",
]);

function inside(root, path) {
  const relation = relative(root, path);
  return relation !== ".." && !relation.startsWith(`..${sep}`) && !relation.startsWith(sep);
}

async function assertLocalAsset(root, from, specifier) {
  const path = resolve(dirname(from), specifier.split(/[?#]/, 1)[0]);
  assert(inside(root, path), `Asset escapes app/: ${specifier}`);
  assert(await exists(path), `Missing installed asset: ${specifier} (from ${from})`);
}

// Validate the actual installation closure, including copied native Node tools.
// Node builtins are permitted only below app/tools; browser imports must be local.
export async function validateBuiltPackage(directory) {
  await validatePackage(directory);
  await init;
  const manifest = JSON.parse(
    await readFile(join(directory, ".codeshell-panel/panel.json"), "utf8"),
  );
  assert(
    /^app\/[^/]+\.html$/.test(manifest.entry),
    "Built manifest entry must be directly below app/",
  );
  const app = join(directory, "app");
  assert(inside(app, resolve(directory, manifest.entry)), "Manifest entry escapes app/");
  assert(
    await exists(join(directory, manifest.entry)),
    `Missing manifest entry: ${manifest.entry}`,
  );
  for (const file of await listFiles(app)) {
    const path = join(app, file);
    const extension = extname(file).toLowerCase();
    assert(assetExtensions.has(extension), `Unsupported installed asset extension: ${file}`);
    if ([".mjs", ".js"].includes(extension)) {
      const source = await readFile(path, "utf8");
      const checked = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
      assert.equal(checked.status, 0, `${file}: ${checked.stderr}`);
      const [imports] = parse(source);
      for (const imported of imports) {
        // import.meta has no dependency; non-literal imports cannot be audited.
        if (imported.d === -2) continue;
        assert(imported.n, `${file}: runtime imports must have a literal path`);
        if (file.startsWith("tools/") && imported.n.startsWith("node:")) continue;
        assert(/^\.\.?\//.test(imported.n), `${file}: external import ${imported.n}`);
        await assertLocalAsset(app, path, imported.n);
      }
    }
    if (extension === ".html") {
      const html = await readFile(path, "utf8");
      assert(
        !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html),
        `${file}: inline scripts are not allowed`,
      );
      for (const match of html.matchAll(
        /<(?:script|link|img|source|video|audio)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi,
      )) {
        const reference = match[1];
        if (/^(?:data:|blob:|#)/i.test(reference)) continue;
        assert(
          !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(reference),
          `${file}: asset must be relative: ${reference}`,
        );
        await assertLocalAsset(app, path, reference);
      }
    }
    if (extension === ".css") {
      const css = await readFile(path, "utf8");
      for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
        if (/^(?:data:|#)/i.test(match[1])) continue;
        assert(
          !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(match[1]),
          `${file}: CSS asset must be relative`,
        );
        await assertLocalAsset(app, path, match[1]);
      }
    }
  }
}

async function fileDigests(directory) {
  const files = {};
  if (!(await exists(directory))) return files;
  for (const file of await listFiles(directory)) {
    files[file] = createHash("sha256")
      .update(await readFile(join(directory, file)))
      .digest("hex");
  }
  return files;
}

async function stageProject(project, directory) {
  const publicRoot = join(project.source, "public");
  assert(await exists(publicRoot), `${project.name}: public/ is required`);
  // Never follow symlinks into an unrelated workspace or leak them into a release.
  await listFiles(publicRoot);
  await listFiles(join(project.source, "src"));
  await mkdir(join(directory, "app"), { recursive: true });
  await cp(publicRoot, join(directory, "app"), { recursive: true });
  assert(
    !(await exists(join(directory, "app/build-manifest.json"))),
    "public/build-manifest.json is reserved for the generated file inventory",
  );
  await mkdir(join(directory, ".codeshell-panel"), { recursive: true });
  await cp(
    join(project.source, ".codeshell-panel/panel.json"),
    join(directory, ".codeshell-panel/panel.json"),
  );
  for (const file of ["README.md", "LICENSE", "LICENSE.md"]) {
    if (await exists(join(project.source, file)))
      await cp(join(project.source, file), join(directory, file));
  }
  for (const skill of project.manifest.agent?.skills ?? []) {
    assert(
      /^agent\/skills\/[a-z0-9-]+\/SKILL\.md$/.test(skill),
      `Invalid declared Skill: ${skill}`,
    );
    const folder = dirname(skill);
    await listFiles(join(project.source, folder));
    await cp(join(project.source, folder), join(directory, folder), { recursive: true });
  }
  const nativeModules = new Map();
  if (Object.keys(project.config.nativeEntries ?? {}).length)
    await listFiles(join(project.source, "native"));
  for (const [name, entry] of Object.entries(project.config.nativeEntries ?? {})) {
    const result = await build({
      absWorkingDir: project.source,
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      legalComments: "inline",
      charset: "utf8",
      write: false,
      logLevel: "silent",
    });
    const source = result.outputFiles[0].text;
    const destination = join(directory, "app/tools", `${name}.mjs`);
    assert(!(await exists(destination)), `public/ shadows a generated native tool: ${name}`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, source);
    nativeModules.set(name, { source, sha256: createHash("sha256").update(source).digest("hex") });
  }
  if (nativeModules.size) {
    assert(
      project.manifest.permissions?.includes("process"),
      "Native tool entries require process permission",
    );
    const manifest = structuredClone(project.manifest);
    manifest.nativeEntries = Object.fromEntries(
      [...nativeModules].map(([name, tool]) => [
        name,
        { entry: `app/tools/${name}.mjs`, sha256: tool.sha256 },
      ]),
    );
    await writeFile(
      join(directory, ".codeshell-panel/panel.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  }
  const bundle = await build({
    absWorkingDir: project.source,
    entryPoints: { main: project.config.entry },
    outdir: join(directory, "app"),
    outExtension: { ".js": ".mjs" },
    chunkNames: "chunks/[name]-[hash]",
    assetNames: "assets/[name]-[hash]",
    bundle: true,
    splitting: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    // Host's asset allowlist excludes .map; inline maps keep source debugging
    // available without changing the installation contract or emitting .ts.
    sourcemap: "inline",
    sourcesContent: true,
    minify: false,
    legalComments: "inline",
    charset: "utf8",
    metafile: true,
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "panel-native-source",
        setup(build) {
          build.onResolve({ filter: /^panel-native:/ }, ({ path }) => ({
            path: path.slice(13),
            namespace: "panel-native",
          }));
          build.onLoad({ filter: /.*/, namespace: "panel-native" }, ({ path }) => {
            const native = nativeModules.get(path);
            if (!native) throw new Error(`Undeclared native tool: ${path}`);
            return {
              contents: `export const source = ${JSON.stringify(native.source)}; export const sha256 = ${JSON.stringify(native.sha256)};`,
              loader: "js",
            };
          });
        },
      },
    ],
  });
  for (const output of bundle.outputFiles) {
    assert(inside(join(directory, "app"), output.path), "Build output escapes app/");
    assert(
      !(await exists(output.path)),
      `public/ shadows a generated asset: ${relative(directory, output.path)}`,
    );
    await mkdir(dirname(output.path), { recursive: true });
    await writeFile(output.path, output.contents);
  }
  await validateBuiltPackage(directory);
  const files = await fileDigests(directory);
  await writeFile(
    join(directory, "app/build-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        builder: `esbuild@${esbuildVersion}`,
        entry: project.config.entry,
        files,
      },
      null,
      2,
    )}\n`,
  );
}

export async function buildProject(project, { check = false, log = true } = {}) {
  if (project.mode === "native") {
    if (log) console.log(`• ${project.name}: native app/ (no build required)`);
    return;
  }
  const parent = dirname(project.output);
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(join(parent, `.panel-build-${project.name}-`));
  const staged = join(temporary, "package");
  const backup = join(temporary, "previous");
  try {
    await stageProject(project, staged);
    if (check) {
      const rebuilt = join(temporary, "repeated");
      await stageProject(project, rebuilt);
      const expected = await fileDigests(staged);
      assert.deepEqual(
        await fileDigests(rebuilt),
        expected,
        `${project.name}: non-deterministic output`,
      );
      assert.deepEqual(
        await fileDigests(project.output),
        expected,
        `${project.name}: committed package is stale; run npm run build -- --app ${project.name}`,
      );
      if (log) console.log(`✓ ${project.name}: deterministic, committed package matches source`);
      return;
    }
    const hadOutput = await exists(project.output);
    if (hadOutput) await rename(project.output, backup);
    try {
      await rename(staged, project.output);
    } catch (error) {
      if (hadOutput) await rename(backup, project.output);
      throw error;
    }
    if (log) console.log(`✓ ${project.name}: built panels/${project.name}/ (install this folder)`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = readArguments(process.argv.slice(2), ["--check"]);
  const projects = selectProjects(await discoverProjects(), options.app);
  for (const project of projects) await buildProject(project, { check: options.check });
}
