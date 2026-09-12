import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { buildProject, validateBuiltPackage } from "../scripts/build-panels.mjs";
import { discoverProjects, listFiles, repositoryRoot } from "../scripts/panel-projects.mjs";
import { validatePackage } from "../scripts/validation/package.mjs";

async function fixture(t, entry = "src/main.ts") {
  const root = await mkdtemp(join(tmpdir(), "panel-build-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "apps/sample");
  for (const folder of [".codeshell-panel", "src", "public/tools"]) {
    await mkdir(join(source, folder), { recursive: true });
  }
  await writeFile(
    join(source, ".codeshell-panel/panel.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "sample",
      title: { default: "Sample" },
      version: "0.1.0",
      entry: "app/index.html",
      permissions: ["context.workspace"],
    }),
  );
  await writeFile(join(source, "panel.build.json"), JSON.stringify({ entry }));
  await writeFile(
    join(source, "public/index.html"),
    '<!doctype html><script type="module" src="./main.mjs"></script>',
  );
  await writeFile(
    join(source, "public/tools/info.mjs"),
    'import os from "node:os"; console.log(os.platform());',
  );
  await writeFile(join(source, "src/feature.mjs"), "export const value = 42;");
  await writeFile(
    join(source, entry),
    'const feature = await import("./feature.mjs"); document.title = String(feature.value);',
  );
  return { root, source, project: (await discoverProjects(root))[0] };
}

test("native tools bundle independently and expose their exact source/hash to the Panel", async (t) => {
  const { root, source } = await fixture(t);
  const sourceManifest = JSON.parse(
    await readFile(join(source, ".codeshell-panel/panel.json"), "utf8"),
  );
  sourceManifest.permissions.push("process");
  await writeFile(join(source, ".codeshell-panel/panel.json"), JSON.stringify(sourceManifest));
  await mkdir(join(source, "native"));
  await writeFile(
    join(source, "native/worker.ts"),
    'import { platform } from "node:os"; export function runCli(){return platform()}',
  );
  await writeFile(
    join(source, "panel.build.json"),
    JSON.stringify({ entry: "src/main.ts", nativeEntries: { worker: "native/worker.ts" } }),
  );
  await writeFile(
    join(source, "src/main.ts"),
    'import {source,sha256} from "panel-native:worker"; globalThis.nativeTool={source,sha256};',
  );
  const project = (await discoverProjects(root))[0];
  await buildProject(project, { log: false });
  const worker = await readFile(join(project.output, "app/tools/worker.mjs"), "utf8");
  const installed = JSON.parse(
    await readFile(join(project.output, ".codeshell-panel/panel.json"), "utf8"),
  );
  assert.deepEqual(installed.nativeEntries, {
    worker: {
      entry: "app/tools/worker.mjs",
      sha256: createHash("sha256").update(worker).digest("hex"),
    },
  });
  const browser = await readFile(join(project.output, "app/main.mjs"), "utf8");
  assert(browser.includes(createHash("sha256").update(worker).digest("hex")));
  assert(worker.includes('from "node:os"'));
  await buildProject(project, { check: true, log: false });
  await rm(source, { recursive: true });
  await validateBuiltPackage(project.output);
});

test("native tool entries reject path escapes and undeclared browser imports", async (t) => {
  const { root, source } = await fixture(t);
  await writeFile(
    join(source, "panel.build.json"),
    JSON.stringify({ entry: "src/main.ts", nativeEntries: { worker: "native/../secret.ts" } }),
  );
  await assert.rejects(discoverProjects(root), /invalid nativeEntries/);
  await writeFile(join(source, "panel.build.json"), JSON.stringify({ entry: "src/main.ts" }));
  await writeFile(
    join(source, "src/main.ts"),
    'import { source } from "panel-native:missing"; console.log(source);',
  );
  const project = (await discoverProjects(root))[0];
  await assert.rejects(buildProject(project, { log: false }), /Undeclared native tool/);
});

test("TypeScript builds an independent, deterministic ESM installation package", async (t) => {
  const { project, source } = await fixture(t);
  await buildProject(project, { log: false });
  const files = await listFiles(project.output);
  assert(files.includes("app/main.mjs"));
  assert(files.some((file) => file.startsWith("app/chunks/") && file.endsWith(".mjs")));
  assert(files.includes("app/build-manifest.json"));
  const installedManifest = JSON.parse(
    await readFile(join(project.output, ".codeshell-panel/panel.json"), "utf8"),
  );
  if (project.config.nativeEntries) {
    for (const name of Object.keys(project.config.nativeEntries)) {
      const declared = installedManifest.nativeEntries[name];
      assert.equal(declared.entry, `app/tools/${name}.mjs`);
      assert.equal(
        declared.sha256,
        createHash("sha256")
          .update(await readFile(join(project.output, declared.entry)))
          .digest("hex"),
      );
    }
  }
  assert(files.includes("app/tools/info.mjs"));
  assert(!files.some((file) => /src\/|public\/|\.ts$|\.map$|panel\.build\.json/.test(file)));
  assert.equal(
    await readFile(join(project.output, ".codeshell-panel/panel.json"), "utf8"),
    await readFile(join(source, ".codeshell-panel/panel.json"), "utf8"),
  );
  await buildProject(project, { check: true, log: false });
  await rm(source, { recursive: true });
  await validateBuiltPackage(project.output);
});

test("static MP3/WAV survive build, package validation and deterministic inventory checks", async (t) => {
  const { project, source } = await fixture(t);
  await writeFile(
    join(source, "public/index.html"),
    '<!doctype html><script type="module" src="./main.mjs"></script><audio controls src="./tone.mp3"></audio><audio><source src="./tone.wav" type="audio/wav"></audio>',
  );
  const audio = new Map();
  for (const extension of ["mp3", "wav"]) {
    const bytes = await readFile(new URL(`./fixtures/static-tone.${extension}`, import.meta.url));
    audio.set(extension, bytes);
    await writeFile(join(source, `public/tone.${extension}`), bytes);
  }
  await buildProject(project, { log: false });
  const inventory = JSON.parse(
    await readFile(join(project.output, "app/build-manifest.json"), "utf8"),
  );
  for (const [extension, bytes] of audio) {
    assert.deepEqual(await readFile(join(project.output, `app/tone.${extension}`)), bytes);
    assert.equal(
      inventory.files[`app/tone.${extension}`],
      createHash("sha256").update(bytes).digest("hex"),
    );
  }
  await validatePackage(relative(repositoryRoot, project.output));
  await buildProject(project, { check: true, log: false });
  await rm(join(source, "public/tone.mp3"));
  await assert.rejects(buildProject(project, { log: false }), /Missing installed asset/);
  await writeFile(join(source, "public/tone.mp3"), audio.get("mp3"));
  await writeFile(
    join(source, "public/active.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  await assert.rejects(
    buildProject(project, { log: false }),
    /Unsupported installed asset extension/,
  );
});

test("mjs source entry is supported and native app packages remain untouched", async (t) => {
  const { project, root } = await fixture(t, "src/main.mjs");
  await buildProject(project, { log: false });
  const native = join(root, "apps/native/.codeshell-panel");
  await mkdir(native, { recursive: true });
  await writeFile(join(native, "panel.json"), '{"id":"native","entry":"app/index.html"}');
  const nativeProject = (await discoverProjects(root)).find((entry) => entry.name === "native");
  assert.equal(nativeProject.mode, "native");
  assert.equal(nativeProject.output, join(root, "apps/native"));
  const before = await listFiles(nativeProject.output);
  await buildProject(nativeProject, { log: false });
  assert.deepEqual(await listFiles(nativeProject.output), before);
});

test("failed builds preserve the installable package and checks detect stale output", async (t) => {
  const { project, source } = await fixture(t);
  await buildProject(project, { log: false });
  const previous = await readFile(join(project.output, "app/main.mjs"), "utf8");
  await writeFile(join(source, "src/main.ts"), 'import fs from "node:fs"; console.log(fs);');
  await assert.rejects(buildProject(project, { log: false }), /Could not resolve "node:fs"/);
  assert.equal(await readFile(join(project.output, "app/main.mjs"), "utf8"), previous);
  await writeFile(join(source, "src/main.ts"), 'document.title = "updated";');
  await assert.rejects(
    buildProject(project, { check: true, log: false }),
    /committed package is stale/,
  );
  assert.equal(await readFile(join(project.output, "app/main.mjs"), "utf8"), previous);
});

test("package checks reject missing assets, import escapes, and public output collisions", async (t) => {
  const { project, source } = await fixture(t);
  await writeFile(
    join(source, "public/index.html"),
    '<script type="module" src="./missing.mjs"></script>',
  );
  await assert.rejects(buildProject(project, { log: false }), /Missing installed asset/);
  await writeFile(
    join(source, "public/index.html"),
    '<script type="module" src="./main.mjs"></script>',
  );
  await writeFile(join(source, "public/tools/info.mjs"), 'import "../../outside.mjs";');
  await assert.rejects(buildProject(project, { log: false }), /Asset escapes app/);
  await writeFile(join(source, "public/tools/info.mjs"), 'console.log("ok");');
  await writeFile(join(source, "public/main.mjs"), 'console.log("shadow");');
  await assert.rejects(buildProject(project, { log: false }), /public\/ shadows a generated asset/);
});

test("native entries require process permission and package validation rejects changed executable bytes", async (t) => {
  const { root, source } = await fixture(t);
  await mkdir(join(source, "native"));
  await writeFile(join(source, "native/worker.ts"), "export const ready = true;");
  await writeFile(
    join(source, "panel.build.json"),
    JSON.stringify({ entry: "src/main.ts", nativeEntries: { worker: "native/worker.ts" } }),
  );
  let project = (await discoverProjects(root))[0];
  await assert.rejects(buildProject(project, { log: false }), /process permission/);
  const manifestFile = join(source, ".codeshell-panel/panel.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.permissions.push("process");
  await writeFile(manifestFile, JSON.stringify(manifest));
  project = (await discoverProjects(root))[0];
  await buildProject(project, { log: false });
  await validatePackage(relative(repositoryRoot, project.output));
  await writeFile(join(project.output, "app/tools/worker.mjs"), "export const ready = false;");
  await assert.rejects(
    validatePackage(relative(repositoryRoot, project.output)),
    /native tool digest changed/,
  );
});
