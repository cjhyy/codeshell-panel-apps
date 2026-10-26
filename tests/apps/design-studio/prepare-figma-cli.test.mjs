import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareFigmaInput,
  HOST_READ_TEXT_BYTES,
} from "../../../apps/design-studio/app/tools/prepare-figma.mjs";
import { prepareFigmaImport } from "../../../apps/design-studio/app/figma-bridge.mjs";
import {
  createDesignSidecarPlan,
  DESIGN_SIDECAR_PART_BYTES,
  readDesignSidecar,
} from "../../../apps/design-studio/app/design-sidecar.mjs";

const cli = fileURLToPath(
  new URL("../../../apps/design-studio/app/tools/prepare-figma.mjs", import.meta.url),
);
const sha256 = async (text) => createHash("sha256").update(text).digest("hex");
const figma = (characters = "Hello") => ({
  name: "完整 Figma 来源",
  version: "original-version",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [{ id: "0:1", type: "CANVAS", children: [{ id: "1:1", type: "TEXT", characters }] }],
  },
  components: { "original:component": { key: "kept-without-normalization" } },
});
const largeSource = () => `${JSON.stringify(figma("保留路径🌈".repeat(80000)), null, 2)}\n`;

async function fixture(t, source = JSON.stringify(figma())) {
  const project = await mkdtemp(join(tmpdir(), "prepare-figma-test-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const input = join(project, "input.json");
  await writeFile(input, source);
  return { project, input, output: "designs/imported.figma-source.json" };
}

async function restored(project, output) {
  return readDesignSidecar({
    path: output,
    call: async (_method, { path }) => ({ content: await readFile(join(project, path), "utf8") }),
    sha256,
  });
}

function runCli(args, { stdin = "", cwd } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      signal: AbortSignal.timeout(15000),
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        assert.equal(stderr, "");
        assert.equal(stdout.trim().split("\n").length, 1);
        resolveResult({ code, result: JSON.parse(stdout) });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(stdin);
  });
}

test("plugin wire JSON survives CLI preparation byte-for-byte and imports relative geometry and typography", async (t) => {
  const raw = { sourceUrl: "https://example.com/", nodes: [{ type: "FRAME", id: "plugin-root", name: "Raw plugin", x: 40, y: 50,
    width: 500, height: 300, children: [{ type: "TEXT", id: "plugin-label", name: "Label", x: 20, y: 30, width: 200, height: 40,
      characters: "Hello plugin", fontName: { family: "Inter", style: "Bold" }, fontSize: 24, lineHeight: { unit: "PIXELS", value: 30 } }] }] };
  const source = JSON.stringify(raw, null, 2) + "\n", f = await fixture(t, source);
  const response = await runCli(["--project", f.project, "--input", f.input, "--output", f.output]);
  assert.equal(response.code, 0);
  const preserved = await restored(f.project, f.output);
  assert.equal(preserved.content, source);
  const imported = await prepareFigmaImport(preserved.content, { sha256Bytes: async bytes => createHash("sha256").update(bytes).digest("hex") });
  const label = imported.document.nodes.find(node => node.type === "text");
  assert.deepEqual([label.x, label.y, label.fontSize, label.fontWeight, label.lineHeight], [60, 80, 24, 700, 30]);
});

test("a UTF-8 source above the Host 480 KiB limit round-trips every byte through SHA checked 350 KiB parts", async (t) => {
  const source = largeSource();
  const request = await fixture(t, source);
  assert.ok(Buffer.byteLength(source) > HOST_READ_TEXT_BYTES);
  const result = await prepareFigmaInput(request);
  assert.equal(result.mode, "sidecar");
  assert.equal(result.bytes, Buffer.byteLength(source));
  assert.equal(result.sha256, await sha256(source));
  assert.equal(result.nodeCount, 3);
  assert.equal(result.createdPartCount, result.partCount);
  const primary = await readFile(join(request.project, request.output), "utf8");
  assert.ok(Buffer.byteLength(primary) < HOST_READ_TEXT_BYTES);
  const manifest = JSON.parse(primary);
  assert.equal(manifest.sha256, result.sha256);
  assert.ok(manifest.parts.length >= 2);
  for (const part of manifest.parts) {
    const bytes = await readFile(join(request.project, part.path));
    assert.ok(bytes.length <= DESIGN_SIDECAR_PART_BYTES);
    assert.equal(bytes.length, part.bytes);
    assert.equal(await sha256(bytes), part.sha256);
  }
  assert.equal((await restored(request.project, request.output)).content, source);
  assert.deepEqual(await readFile(request.input, "utf8"), source);
});

test("small REST files stay single-file and relative inputs resolve against the explicit project", async (t) => {
  const source = `${JSON.stringify(figma(), null, 2)}\n`;
  const request = await fixture(t, source);
  const result = await runCli(
    ["--input", "input.json", "--output", request.output, "--project", request.project],
    { cwd: tmpdir() },
  );
  assert.equal(result.code, 0);
  assert.equal(result.result.mode, "single");
  assert.equal(result.result.inputPath, await realpath(request.input));
  assert.equal(await readFile(join(request.project, request.output), "utf8"), source);
  assert.equal(result.result.partCount, 0);
});

test("structured request stdin and raw Figma stdin both emit one JSON receipt", async (t) => {
  const request = await fixture(t);
  const first = await runCli([], { stdin: JSON.stringify(request) });
  assert.equal(first.code, 0);
  const output = "designs/from-stdin.figma-source.json";
  const second = await runCli(["--input", "-", "--output", output, "--project", request.project], {
    stdin: JSON.stringify(figma()),
  });
  assert.equal(second.code, 0);
  assert.equal(second.result.inputPath, null);
  assert.deepEqual(JSON.parse(await readFile(join(request.project, output), "utf8")), figma());
});

test("explicit Figma LinkAction envelopes preserve every official response field", async (t) => {
  const data = {
    nodes: { "0:1": { document: figma().document.children[0] } },
    components: figma().components,
    lastModified: "2026-10-16",
  };
  const request = await fixture(
    t,
    JSON.stringify({ kind: "action_result", provider: "figma", data }),
  );
  const result = await prepareFigmaInput(request);
  assert.equal(result.nodeCount, 2);
  assert.deepEqual(JSON.parse((await restored(request.project, request.output)).content), data);
});

test("a second basename safely reuses identical immutable chunks while existing roots are never overwritten", async (t) => {
  const request = await fixture(t, largeSource());
  const first = await prepareFigmaInput(request);
  const before = await readFile(join(request.project, request.output));
  await assert.rejects(prepareFigmaInput(request), { code: "OUTPUT_EXISTS" });
  assert.deepEqual(await readFile(join(request.project, request.output)), before);
  const second = await prepareFigmaInput({
    ...request,
    output: "designs/another.figma-source.json",
  });
  assert.equal(second.createdPartCount, 0);
  assert.equal(second.reusedPartCount, first.partCount);
  assert.equal((await restored(request.project, second.outputPath)).content, largeSource());
});

test("a conflicting chunk fails preflight without publishing a root or other chunks, preserving existing bytes", async (t) => {
  const source = largeSource();
  const request = await fixture(t, source);
  const plan = await createDesignSidecarPlan(source, { sha256 });
  const last = plan.parts.at(-1);
  await mkdir(dirname(join(request.project, last.path)), { recursive: true });
  await writeFile(join(request.project, last.path), "existing unrelated data");
  await assert.rejects(prepareFigmaInput(request), { code: "PART_CONFLICT" });
  assert.equal(await readFile(join(request.project, last.path), "utf8"), "existing unrelated data");
  assert.deepEqual(await readdir(dirname(join(request.project, last.path))), [
    last.path.split("/").at(-1),
  ]);
  await assert.rejects(readFile(join(request.project, request.output)), { code: "ENOENT" });
  assert.equal(await readFile(request.input, "utf8"), source);
});

test("invalid JSON, summary-only, missing node trees and truncated sources produce no output directories", async (t) => {
  const sources = [
    "{partial",
    "[]",
    JSON.stringify({ name: "metadata", pages: [{ id: "0:1" }] }),
    JSON.stringify({ document: {} }),
    JSON.stringify({ ...figma(), truncated: true }),
    JSON.stringify({ kind: "action_result", provider: "figma", data: { nodes: { "0:1": null } } }),
  ];
  for (const source of sources) {
    const request = await fixture(t, source);
    await assert.rejects(prepareFigmaInput(request));
    assert.equal(await readFile(request.input, "utf8"), source);
    assert.deepEqual(await readdir(request.project), ["input.json"]);
  }
});

test("invalid UTF-8 and sources beyond the existing Figma 16 MiB bound fail without modifying the source", async (t) => {
  const request = await fixture(t, Buffer.from([0xff, 0xfe, 0xff]));
  await assert.rejects(prepareFigmaInput(request), { code: "INVALID_UTF8" });
  assert.deepEqual(await readFile(request.input), Buffer.from([0xff, 0xfe, 0xff]));
  await truncate(request.input, 16 * 1024 * 1024 + 1);
  await assert.rejects(prepareFigmaInput(request), { code: "INPUT_TOO_LARGE" });
  assert.deepEqual(await readdir(request.project), ["input.json"]);
});

test("output traversal, absolute, hidden and non-design paths are rejected before writes", async (t) => {
  const request = await fixture(t);
  for (const output of [
    "../escape.figma-source.json",
    "designs/../escape.figma-source.json",
    "designs/.private/file.figma-source.json",
    resolve(request.project, "designs/absolute.figma-source.json"),
    "designs/a\\file.figma-source.json",
    "other/file.figma-source.json",
    "designs/design.codesign.json",
  ])
    await assert.rejects(prepareFigmaInput({ ...request, output }), { code: "UNSAFE_OUTPUT" });
  assert.deepEqual(await readdir(request.project), ["input.json"]);
});

test("symlinked output ancestors, leaf targets and chunk targets cannot escape or replace other files", async (t) => {
  const request = await fixture(t, largeSource());
  const outside = await mkdtemp(join(tmpdir(), "prepare-figma-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(request.project, "designs"));
  await assert.rejects(prepareFigmaInput(request), { code: "UNSAFE_OUTPUT" });
  assert.deepEqual(await readdir(outside), []);
  await rm(join(request.project, "designs"));
  await mkdir(join(request.project, "designs"));
  await symlink(join(outside, "must-not-create"), join(request.project, request.output));
  await assert.rejects(prepareFigmaInput(request), { code: "OUTPUT_EXISTS" });
  await rm(join(request.project, request.output));
  const plan = await createDesignSidecarPlan(largeSource(), { sha256 });
  const part = plan.parts[0];
  await mkdir(dirname(join(request.project, part.path)), { recursive: true });
  await writeFile(join(outside, "existing"), "preserved");
  await symlink(join(outside, "existing"), join(request.project, part.path));
  await assert.rejects(prepareFigmaInput(request), { code: "UNSAFE_OUTPUT" });
  assert.equal(await readFile(join(outside, "existing"), "utf8"), "preserved");
  await assert.rejects(readFile(join(request.project, request.output)), { code: "ENOENT" });
});

test("concurrent create-only publishers leave exactly one complete root and verified shared chunks", async (t) => {
  const request = await fixture(t, largeSource());
  const args = ["--input", request.input, "--output", request.output, "--project", request.project];
  const results = await Promise.all([runCli(args), runCli(args)]);
  assert.deepEqual(results.map((item) => item.code).sort(), [0, 1]);
  assert.equal(results.find((item) => item.code === 1).result.error.code, "OUTPUT_EXISTS");
  assert.equal((await restored(request.project, request.output)).content, largeSource());
  const manifest = JSON.parse(await readFile(join(request.project, request.output), "utf8"));
  assert.ok(
    (await readdir(dirname(join(request.project, manifest.parts[0].path)))).every(
      (name) => !name.startsWith(".prepare-figma-"),
    ),
  );
});

test("argument errors are structured and do not touch the project", async (t) => {
  const request = await fixture(t);
  const result = await runCli([
    "--input",
    request.input,
    "--output",
    request.output,
    "--force",
    "true",
  ]);
  assert.equal(result.code, 1);
  assert.equal(result.result.ok, false);
  assert.equal(result.result.error.code, "INVALID_ARGUMENT");
  assert.deepEqual(await readdir(request.project), ["input.json"]);
});
