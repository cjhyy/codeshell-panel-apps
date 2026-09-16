import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
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

test("bundled CommonJS native dependencies can require Node builtins after source files are removed", async (t) => {
  const { root, source } = await fixture(t);
  const manifestPath = join(source, ".codeshell-panel/panel.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.permissions.push("process");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await mkdir(join(source, "native"));
  await writeFile(
    join(source, "native/helper.cjs"),
    'const os = require("node:os"); module.exports = () => os.platform();',
  );
  await writeFile(
    join(source, "native/worker.ts"),
    'import platform from "./helper.cjs"; export const result = platform();',
  );
  await writeFile(
    join(source, "panel.build.json"),
    JSON.stringify({ entry: "src/main.ts", nativeEntries: { worker: "native/worker.ts" } }),
  );
  const project = (await discoverProjects(root))[0];
  await buildProject(project, { log: false });
  await rm(source, { recursive: true });
  const tool = await import(pathToFileURL(join(project.output, "app/tools/worker.mjs")).href);
  assert.equal(tool.result, process.platform);
  await validateBuiltPackage(project.output);
});

test("reviewed browser runtimes share deterministic bytes with independent native tools", async (t) => {
  const { root, source } = await fixture(t);
  const manifestPath = join(source, ".codeshell-panel/panel.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.permissions.push("process");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await mkdir(join(source, "native"));
  await writeFile(
    join(source, "src/runtime.ts"),
    'import { value } from "./feature.mjs"; globalThis.result = value;',
  );
  await writeFile(
    join(source, "native/worker.ts"),
    'export { source, sha256 } from "panel-browser:renderer";',
  );
  const config = {
    entry: "src/main.ts",
    nativeEntries: { worker: "native/worker.ts" },
    browserEntries: { renderer: "src/runtime.ts" },
  };
  await writeFile(join(source, "panel.build.json"), JSON.stringify(config));
  const project = (await discoverProjects(root))[0];
  await buildProject(project, { log: false });
  const browser = await readFile(join(project.output, "app/runtimes/renderer.mjs"), "utf8");
  const tool = await import(pathToFileURL(join(project.output, "app/tools/worker.mjs")));
  assert.equal(tool.source, browser);
  assert.equal(tool.sha256, createHash("sha256").update(browser).digest("hex"));
  assert(browser.includes("value = 42"));
  await buildProject(project, { check: true, log: false });
  await writeFile(
    join(source, "src/runtime.ts"),
    'import fs from "node:fs"; globalThis.result = fs;',
  );
  await assert.rejects(buildProject(project, { log: false }), /Could not resolve "node:fs"/);
  assert.equal(await readFile(join(project.output, "app/runtimes/renderer.mjs"), "utf8"), browser);
  await writeFile(join(source, "src/runtime.ts"), "import(globalThis.moduleUrl);");
  await assert.rejects(buildProject(project, { log: false }), /must not have runtime imports/);
  await writeFile(join(source, "src/runtime.ts"), "globalThis.result = 1;");
  await mkdir(join(source, "public/runtimes"));
  await writeFile(join(source, "public/runtimes/renderer.mjs"), "// shadow");
  await assert.rejects(
    buildProject(project, { log: false }),
    /shadows a generated browser runtime/,
  );
  await rm(join(source, "public/runtimes"), { recursive: true });
  await writeFile(
    join(source, "panel.build.json"),
    JSON.stringify({ ...config, browserEntries: { renderer: "src/../secret.ts" } }),
  );
  await assert.rejects(discoverProjects(root), /invalid browserEntries/);
  await writeFile(
    join(source, "panel.build.json"),
    JSON.stringify({ ...config, browserEntries: {} }),
  );
  await assert.rejects(
    buildProject((await discoverProjects(root))[0], { log: false }),
    /Undeclared browser runtime/,
  );
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
    /unsupported (?:installed )?asset extension/i,
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
    /native entry hash does not match/,
  );
});

function manifestIssue(path, code) {
  return (error) => {
    assert(
      error.issues?.some((issue) => issue.path.join(".") === path && issue.code === code),
      `Expected ${code} at ${path || "manifest root"}: ${error.message}`,
    );
    return true;
  };
}

const sampleTool = (index = 0) => ({
  name: `sample_${index}`,
  description: "Read the sample",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  readOnly: true,
});

async function agentPackage(t) {
  const f = await fixture(t);
  await buildProject(f.project, { log: false });
  const manifestPath = join(f.project.output, ".codeshell-panel/panel.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.schemaVersion = 2;
  manifest.agent = { tools: [sampleTool()], skills: [] };
  return { ...f, manifestPath, manifest };
}
test("package validation accepts released Host limits and optional defaults", async (t) => {
  const { project, manifestPath, manifest } = await agentPackage(t);
  manifest.version = "v".repeat(80);
  manifest.title = { default: "t".repeat(80), en: "English", "zh-CN": "中文" };
  manifest.description = "d".repeat(500);
  manifest.agent.tools = Array.from({ length: 16 }, (_, index) => ({
    ...sampleTool(index),
    description: "d".repeat(500),
  }));
  for (let index = 0; index < 8; index++) {
    const skill = `agent/skills/skill-${index}/SKILL.md`;
    await mkdir(join(project.output, `agent/skills/skill-${index}`), { recursive: true });
    await writeFile(join(project.output, skill), "Read-only sample instructions.");
    manifest.agent.skills.push(skill);
  }
  await writeFile(manifestPath, JSON.stringify(manifest));
  await validateBuiltPackage(project.output);
  await rm(join(project.output, "agent"), { recursive: true });
  delete manifest.permissions;
  manifest.agent = { tools: [{ ...sampleTool(), readOnly: undefined }] };
  await writeFile(manifestPath, JSON.stringify(manifest));
  const checked = await validatePackage(project.output);
  assert.deepEqual(checked.manifest.permissions, []);
  assert.deepEqual(checked.manifest.agent.skills, []);
  assert.equal(checked.manifest.agent.tools[0].readOnly, false);
});

test("package checks reject manifests the released Host cannot install", async (t) => {
  const { project, manifestPath, manifest } = await agentPackage(t);
  const cases = [
    [
      "17 tools",
      (m) => {
        m.agent.tools = Array.from({ length: 17 }, (_, i) => sampleTool(i));
      },
      "agent.tools",
      "too_big",
    ],
    [
      "overlong tool description",
      (m) => {
        m.agent.tools[0].description = "d".repeat(501);
      },
      "agent.tools.0.description",
      "too_big",
    ],
    [
      "empty tool description",
      (m) => {
        m.agent.tools[0].description = "";
      },
      "agent.tools.0.description",
      "too_small",
    ],
    [
      "9 skills",
      (m) => {
        m.agent.skills = Array.from({ length: 9 }, (_, i) => `agent/skills/skill-${i}/SKILL.md`);
      },
      "agent.skills",
      "too_big",
    ],
    [
      "duplicate skills",
      (m) => {
        m.agent.skills = ["agent/skills/sample/SKILL.md", "agent/skills/sample/SKILL.md"];
      },
      "agent.skills.1",
      "custom",
    ],
    [
      "unknown root field",
      (m) => {
        m.backend = "script.mjs";
      },
      "",
      "unrecognized_keys",
    ],
    [
      "schema v1 agent",
      (m) => {
        m.schemaVersion = 1;
      },
      "",
      "unrecognized_keys",
    ],
    [
      "unknown title locale",
      (m) => {
        m.title.fr = "Titre";
      },
      "title",
      "unrecognized_keys",
    ],
    [
      "unknown agent field",
      (m) => {
        m.agent.hooks = [];
      },
      "agent",
      "unrecognized_keys",
    ],
    [
      "unknown tool field",
      (m) => {
        m.agent.tools[0].handler = "worker";
      },
      "agent.tools.0",
      "unrecognized_keys",
    ],
    [
      "invalid readOnly",
      (m) => {
        m.agent.tools[0].readOnly = "yes";
      },
      "agent.tools.0.readOnly",
      "invalid_type",
    ],
    [
      "duplicate tools",
      (m) => {
        m.agent.tools.push(sampleTool());
      },
      "agent.tools.1.name",
      "custom",
    ],
    [
      "empty version",
      (m) => {
        m.version = "";
      },
      "version",
      "too_small",
    ],
    [
      "overlong version",
      (m) => {
        m.version = "v".repeat(81);
      },
      "version",
      "too_big",
    ],
    [
      "overlong title",
      (m) => {
        m.title.default = "t".repeat(81);
      },
      "title.default",
      "too_big",
    ],
    [
      "overlong description",
      (m) => {
        m.description = "d".repeat(501);
      },
      "description",
      "too_big",
    ],
    [
      "invalid icon",
      (m) => {
        m.icon = "video-camera";
      },
      "icon",
      "invalid_enum_value",
    ],
    [
      "invalid placement",
      (m) => {
        m.placement = "left-dock";
      },
      "placement",
      "invalid_literal",
    ],
    [
      "invalid singleton",
      (m) => {
        m.singleton = "true";
      },
      "singleton",
      "invalid_type",
    ],
    [
      "unsafe entry",
      (m) => {
        m.entry = "app/../app/index.html";
      },
      "entry",
      "custom",
    ],
    [
      "unknown permission",
      (m) => {
        m.permissions = ["filesystem.everything"];
      },
      "permissions.0",
      "invalid_enum_value",
    ],
    [
      "duplicate permission",
      (m) => {
        m.permissions.push("context.workspace");
      },
      "permissions",
      "custom",
    ],
    [
      "too many permissions",
      (m) => {
        m.permissions = Array(17).fill("context.workspace");
      },
      "permissions",
      "too_big",
    ],
    [
      "workspace prerequisite",
      (m) => {
        m.permissions = ["resources"];
      },
      "permissions",
      "custom",
    ],
    [
      "session prerequisite",
      (m) => {
        m.permissions = ["agent.submitPrompt"];
      },
      "permissions",
      "custom",
    ],
    [
      "automation prerequisites",
      (m) => {
        m.permissions = ["context.workspace", "automations.manage"];
      },
      "permissions",
      "custom",
    ],
    [
      "null permissions",
      (m) => {
        m.permissions = null;
      },
      "permissions",
      "invalid_type",
    ],
    [
      "null tools",
      (m) => {
        m.agent.tools = null;
      },
      "agent.tools",
      "invalid_type",
    ],
    [
      "null skills",
      (m) => {
        m.agent.skills = null;
      },
      "agent.skills",
      "invalid_type",
    ],
    [
      "17 native entries",
      (m) => {
        m.permissions.push("process");
        m.nativeEntries = Object.fromEntries(
          Array.from({ length: 17 }, (_, i) => [
            `worker-${i}`,
            { entry: `app/tools/worker-${i}.mjs`, sha256: "a".repeat(64) },
          ]),
        );
      },
      "nativeEntries",
      "custom",
    ],
    [
      "unknown native entry field",
      (m) => {
        m.permissions.push("process");
        m.nativeEntries = {
          worker: { entry: "app/tools/worker.mjs", sha256: "a".repeat(64), command: "node" },
        };
      },
      "nativeEntries.worker",
      "unrecognized_keys",
    ],
    [
      "unsafe native entry",
      (m) => {
        m.permissions.push("process");
        m.nativeEntries = { worker: { entry: "app/tools/../worker.mjs", sha256: "a".repeat(64) } };
      },
      "nativeEntries.worker.entry",
      "invalid_string",
    ],
  ];
  for (const [name, change, path, code] of cases) {
    await t.test(name, async () => {
      const changed = structuredClone(manifest);
      change(changed);
      await writeFile(manifestPath, JSON.stringify(changed));
      await assert.rejects(validatePackage(project.output), manifestIssue(path, code));
    });
  }
});

test("tool schemas validate the Host subset instead of only compiling regexes", async (t) => {
  const { project, manifestPath, manifest } = await agentPackage(t);
  const valid = {
    type: "object",
    $defs: { "choice/name": { type: "string", enum: ["first", "second"] } },
    properties: {
      choice: { $ref: "#/$defs/choice~1name" },
      nested: { $ref: "#" },
      flags: { type: "array", items: { type: "boolean" }, uniqueItems: true },
      reserved: false,
    },
    required: ["choice"],
    additionalProperties: false,
    // Literal data with a field named pattern is not a schema pattern.
    default: { pattern: "a+b+" },
    allOf: [true, { if: { required: ["flags"] }, then: { maxProperties: 3 } }],
  };
  manifest.agent.tools[0].inputSchema = valid;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await validatePackage(project.output);
  const cases = [
    ["unsupported keyword", { format: "date-time" }, /Unsupported JSON Schema keyword 'format'/i],
    [
      "external ref",
      { $ref: "https://example.test/schema" },
      /Unsupported or unresolved JSON Schema reference/i,
    ],
    [
      "unresolved ref",
      { $ref: "#/$defs/missing" },
      /Unsupported or unresolved JSON Schema reference/i,
    ],
    [
      "invalid type",
      { properties: { value: { type: ["string", "string"] } } },
      /Invalid JSON Schema type/i,
    ],
    ["empty type", { properties: { value: { type: [] } } }, /Invalid JSON Schema type/i],
    [
      "tuple items",
      { properties: { value: { type: "array", items: [{ type: "string" }] } } },
      /Invalid JSON Schema/i,
    ],
    ["duplicate required", { required: ["value", "value"] }, /Invalid JSON Schema required-list/i],
    ["invalid required", { required: [1] }, /Invalid JSON Schema required-list/i],
    ["empty branch", { oneOf: [] }, /Invalid JSON Schema oneOf/i],
    ["invalid properties", { properties: [] }, /Invalid JSON Schema properties/i],
    ["invalid child", { properties: { value: 4 } }, /Invalid JSON Schema/i],
    ["invalid limits", { maxProperties: 1.5 }, /Invalid JSON Schema maxProperties/i],
    ["invalid multiple", { multipleOf: 0 }, /Invalid JSON Schema multipleOf/i],
    ["invalid examples", { examples: "example" }, /Invalid JSON Schema examples/i],
    ["invalid flag", { readOnly: "true" }, /Invalid JSON Schema readOnly/i],
    [
      "duplicate deep enum",
      {
        enum: [
          { a: 1, b: 2 },
          { b: 2, a: 1 },
        ],
      },
      /Invalid JSON Schema enum/i,
    ],
    [
      "unsafe regex",
      { properties: { value: { type: "string", pattern: "^(a+)+$" } } },
      /Invalid JSON Schema pattern/i,
    ],
    ["node budget", { default: Array(20_000).fill(0) }, /JSON value-size limit/],
  ];
  let nested = true;
  for (let index = 0; index < 65; index++) nested = { not: nested };
  cases.push(["depth budget", { not: nested }, /depth limit/]);
  for (const [name, schema, expected] of cases) {
    await t.test(name, async () => {
      manifest.agent.tools[0].inputSchema = { type: "object", ...schema };
      await writeFile(manifestPath, JSON.stringify(manifest));
      await assert.rejects(validatePackage(project.output), expected);
    });
  }
});

test("a Host-incompatible manifest fails the build before replacing the last package", async (t) => {
  const { project, source } = await fixture(t);
  await buildProject(project, { log: false });
  const previous = await readFile(join(project.output, ".codeshell-panel/panel.json"), "utf8");
  const manifest = JSON.parse(previous);
  manifest.schemaVersion = 2;
  manifest.agent = {
    tools: Array.from({ length: 17 }, (_, index) => sampleTool(index)),
    skills: [],
  };
  await writeFile(join(source, ".codeshell-panel/panel.json"), JSON.stringify(manifest));
  await assert.rejects(
    buildProject(project, { log: false }),
    manifestIssue("agent.tools", "too_big"),
  );
  assert.equal(
    await readFile(join(project.output, ".codeshell-panel/panel.json"), "utf8"),
    previous,
  );
});

test("installation preflight enforces file and Skill limits beyond the manifest schema", async (t) => {
  const { project, manifestPath, manifest } = await agentPackage(t);
  const previous = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const asset = join(project.output, "app/oversized.wav");
  await writeFile(asset, Buffer.alloc(16 * 1024 * 1024 + 1));
  await assert.rejects(validateBuiltPackage(project.output), /Panel App file is too large/);
  await rm(asset);
  const skill = "agent/skills/sample/SKILL.md";
  manifest.agent.skills = [skill];
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(validatePackage(project.output), /declared Panel App skill is missing/);
  await mkdir(join(project.output, "agent/skills/sample"), { recursive: true });
  await writeFile(join(project.output, skill), "s".repeat(256 * 1024 + 1));
  await assert.rejects(validatePackage(project.output), /no larger than 256 KiB/);
  await rm(join(project.output, "agent"), { recursive: true });
  await writeFile(manifestPath, previous);
  await validateBuiltPackage(project.output);
});
