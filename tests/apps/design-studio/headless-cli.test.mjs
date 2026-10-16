import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import { createDesignIndexPersistencePlan } from "../../../apps/design-studio/app/document-index.mjs";
import { createDesignPersistencePlan } from "../../../apps/design-studio/app/document-bundle.mjs";
import { createDesignResourcePersistencePlan } from "../../../apps/design-studio/app/resource-store.mjs";

const sourcePackage = fileURLToPath(new URL("../../../apps/design-studio/", import.meta.url));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const rectangle = (id = "card", extra = {}) => ({
  id,
  type: "rectangle",
  name: id,
  x: 20,
  y: 20,
  width: 160,
  height: 120,
  fill: "#111111",
  stroke: "transparent",
  strokeWidth: 0,
  opacity: 1,
  rotation: 0,
  cornerRadius: 0,
  visible: true,
  locked: false,
  ...extra,
});
const document = (name = "Fixture", nodes = [rectangle()]) => ({
  format: "codeshell.design",
  version: 3,
  name,
  canvas: { width: 800, height: 600, background: "#ffffff" },
  tokens: { colors: [] },
  activePageId: "page-one",
  pages: [
    { id: "page-one", name: "One", children: nodes },
    { id: "page-two", name: "Two", children: [rectangle("other", { fill: "#ff0000" })] },
  ],
});
let requestId = 0;
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "design-headless-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project"),
    installed = join(root, "installed"),
    home = join(root, "home");
  await Promise.all([
    mkdir(project),
    mkdir(home),
    cp(sourcePackage, installed, { recursive: true }),
  ]);
  const cli = join(installed, "app/tools/design-studio.mjs");
  const invoke = async (args, options = {}) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: project,
      env: { HOME: home, PATH: "" },
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    const stdout = [],
      stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    const code = await new Promise((done, reject) => {
      child.on("error", reject);
      child.on("close", done);
    }).finally(() => clearTimeout(timer));
    const output = Buffer.concat(stdout).toString("utf8");
    assert.equal(Buffer.concat(stderr).toString("utf8"), "");
    assert.equal(output.trim().split("\n").length, 1, output.slice(0, 300));
    return { code, value: JSON.parse(output), output };
  };
  const run = async (operation, request) => {
    const path = join(root, `request-${requestId++}.json`);
    await writeFile(path, JSON.stringify(request));
    return invoke(["run", operation, "--project", project, "--input-file", path]);
  };
  const put = async (path, content) => {
    const absolute = join(project, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  };
  return { root, project, installed, run, invoke, put };
}
const path = "designs/design.codesign.json";

test("installed package discovers CLI schemas without a webview, dependencies or project writes", async (t) => {
  const f = await fixture(t),
    result = await f.invoke(["ops"]);
  assert.equal(result.code, 0);
  assert.equal(result.value.ok, true);
  assert.deepEqual(
    result.value.result.map((op) => op.name),
    ["inspect", "read", "validate", "svg", "frontend", "brief", "compare", "create", "edit"],
  );
  assert.deepEqual(await readdir(f.project), []);
});

test("create, read, CAS edit and zero-warning validation persist actual reopenable v3 source", async (t) => {
  const f = await fixture(t);
  const created = await f.run("create", { path, document: document() });
  assert.equal(created.code, 0);
  const saved = await readFile(join(f.project, path), "utf8");
  assert.equal(created.value.result.revision, hash(saved));
  assert.equal(normalizeDesignDocument(JSON.parse(saved)).name, "Fixture");
  const inspected = await f.run("inspect", { path });
  assert.equal(inspected.value.result.pages.length, 2);
  assert.equal(inspected.value.result.nodeCount, 2);
  assert.equal(inspected.value.result.storageMode, "single");
  const read = await f.run("read", { path, node_id: "other" });
  assert.equal(read.value.result.pageId, "page-two");
  assert.equal(read.value.result.node.fill, "#ff0000");
  const revision = inspected.value.result.revision;
  await f.put("designs/design.prototype.json", "preserved companion");
  const edited = await f.run("edit", {
    path,
    expected_revision: revision,
    document: document("Edited"),
  });
  assert.equal(edited.code, 0);
  assert.notEqual(edited.value.result.revision, revision);
  assert.equal((await f.run("read", { path })).value.result.document.name, "Edited");
  assert.equal(
    await readFile(join(f.project, "designs/design.prototype.json"), "utf8"),
    "preserved companion",
  );
  const audit = await f.run("validate", { path });
  assert.equal(audit.value.result.valid, true);
  assert.equal(audit.value.result.issueCount, 0);
  assert.equal(audit.value.result.canonical, true);
  const stale = await f.run("edit", {
    path,
    expected_revision: revision,
    document: document("Stale"),
  });
  assert.equal(stale.code, 3);
  assert.equal(stale.value.error.code, "REVISION_CONFLICT");
  assert.equal((await f.run("inspect", { path })).value.result.name, "Edited");
});

test("SVG/HTML exports, PRD parsing and saved-design comparison use the shared domains", async (t) => {
  const f = await fixture(t);
  await f.run("create", { path, document: document() });
  const svg = await f.run("svg", { path, page_id: "page-two", output: "designs/page.svg" });
  assert.equal(svg.code, 0);
  assert.match(await readFile(join(f.project, "designs/page.svg"), "utf8"), /#ff0000/);
  const repeat = await f.run("svg", { path, output: "designs/page.svg" });
  assert.equal(repeat.code, 3);
  const html = await f.run("frontend", { path, page_id: "page-two" });
  assert.match(html.value.result.content, /<!doctype html>/i);
  assert.match(html.value.result.content, /#ff0000/);
  await f.put(
    "PRD.md",
    "# Product\n\n## Goals\n- Help people find saved work\n\n## Requirements\n- Search the catalog\n",
  );
  const brief = await f.run("brief", { path: "PRD.md" });
  assert.equal(brief.code, 0);
  assert.equal(brief.value.result.title, "Product");
  assert.match(JSON.stringify(brief.value.result), /Search the catalog/);
  await f.run("create", { path: "designs/copy.codesign.json", document: document() });
  const same = await f.run("compare", { path, actual_path: "designs/copy.codesign.json" });
  assert.equal(same.value.result.passed, true);
  const changed = document();
  changed.pages[0].children[0].x += 20;
  await f.run("create", { path: "designs/changed.codesign.json", document: changed });
  const comparison = await f.run("compare", { path, actual_path: "designs/changed.codesign.json" });
  assert.equal(comparison.value.result.passed, false);
  assert.equal(comparison.value.result.maximumGeometryDelta, 20);
});

test("concurrent creators and editors have one winner and preserve the committed JSON", async (t) => {
  const f = await fixture(t);
  const created = await Promise.all(
    ["A", "B"].map((name) => f.run("create", { path, document: document(name) })),
  );
  assert.deepEqual(created.map((item) => item.code).sort(), [0, 3]);
  const revision = (await f.run("inspect", { path })).value.result.revision;
  const edited = await Promise.all(
    ["C", "D"].map((name) =>
      f.run("edit", { path, expected_revision: revision, document: document(name) }),
    ),
  );
  assert.deepEqual(edited.map((item) => item.code).sort(), [0, 3]);
  const winner = edited.find((item) => item.code === 0);
  assert.equal(hash(await readFile(join(f.project, path))), winner.value.result.revision);
  assert(["C", "D"].includes((await f.run("inspect", { path })).value.result.name));
  assert(!(await readdir(f.project)).some((name) => name.endsWith(".lock")));
});

test("Host-compatible file lock and revision check preserve a concurrent external write", async (t) => {
  const f = await fixture(t);
  const created = await f.run("create", { path, document: document() });
  const lock = join(
    f.project,
    "designs",
    `.codeshell-workspace-write-${hash("design.codesign.json")}.lock`,
  );
  await mkdir(lock);
  const pending = f.run("edit", {
    path,
    expected_revision: created.value.result.revision,
    document: document("CLI"),
  });
  await new Promise((done) => setTimeout(done, 150));
  const external = serializeDesignDocument(normalizeDesignDocument(document("Host")));
  await f.put(path, external);
  await rm(lock, { recursive: true });
  const edited = await pending;
  assert.equal(edited.code, 3);
  assert.equal(await readFile(join(f.project, path), "utf8"), external);
});

test("large saves publish verified indexed parts before the root and support bounded subtree reads", async (t) => {
  const f = await fixture(t);
  const large = document(
    "Large",
    Array.from({ length: 650 }, (_, index) =>
      rectangle(`node-${index}`, { notes: "x".repeat(1900) }),
    ),
  );
  const created = await f.run("create", { path, document: large });
  assert.equal(created.code, 0);
  assert.equal(created.value.result.storageMode, "indexed");
  assert(created.value.result.createdPartCount > 1);
  const index = JSON.parse(await readFile(join(f.project, path), "utf8"));
  assert.equal(index.format, "codeshell.design.index");
  assert.equal((await f.run("inspect", { path })).value.result.nodeCount, 651);
  const all = await f.run("read", { path });
  assert.equal(all.value.error.code, "RESULT_TOO_LARGE");
  const node = await f.run("read", { path, node_id: "node-10", max_depth: 0 });
  assert.equal(node.code, 0);
  assert.equal(node.value.result.node.id, "node-10");
  const revision = created.value.result.revision;
  large.name = "Large edited";
  const edited = await f.run("edit", { path, document: large, expected_revision: revision });
  assert.equal(edited.code, 0);
  assert.equal(edited.value.result.createdPartCount, 0);
  assert(edited.value.result.reusedPartCount > 1);
  // A valid path with corrupted bytes cannot be accepted as an indexed page.
  const descriptor = index.pages[0];
  const part = `designs/codesign-data/pages/${descriptor.sha256.slice(0, 16)}/${descriptor.sha256}-0001.txt`;
  await f.put(part, "corrupt");
  assert.equal((await f.run("inspect", { path })).value.ok, false);
});

test("immutable collision preflight and malformed documents leave no published root or new parts", async (t) => {
  const f = await fixture(t);
  const large = document(
    "Collision",
    Array.from({ length: 200 }, (_, index) =>
      rectangle(`node-${index}`, { notes: "x".repeat(1900) }),
    ),
  );
  const plan = await createDesignIndexPersistencePlan({
    document: normalizeDesignDocument(large),
    sha256: async (source) => hash(source),
  });
  await f.put(plan.parts.at(-1).path, "different immutable bytes");
  const collision = await f.run("create", { path, document: large });
  assert.equal(collision.value.error.code, "CONTENT_CONFLICT");
  await assert.rejects(readFile(join(f.project, path)), { code: "ENOENT" });
  await assert.rejects(readFile(join(f.project, plan.parts[0].path)), { code: "ENOENT" });
  const malformed = document();
  malformed.pages[0].children[0].unexpected = true;
  const invalid = await f.run("create", { path, document: malformed });
  assert.equal(invalid.code, 2);
  assert.equal(invalid.value.error.code, "INVALID_DESIGN");
});

test("resource verification works from the installed package and refuses altered or symlinked parts", async (t) => {
  const f = await fixture(t);
  const resource = await createDesignResourcePersistencePlan({
    id: "pixel",
    kind: "image",
    mime: "image/png",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    sha256Bytes: async (bytes) => hash(bytes),
  });
  for (const part of resource.parts) await f.put(part.path, part.content);
  const design = document();
  design.resources = [resource.descriptor];
  const created = await f.run("create", { path, document: design });
  assert.equal(created.code, 0);
  const part = resource.parts[0],
    absolute = join(f.project, part.path);
  await f.put(part.path, "AA==");
  assert.equal((await f.run("inspect", { path })).value.ok, false);
  await rm(absolute);
  const outside = join(f.root, "outside.txt");
  await writeFile(outside, part.content);
  await symlink(outside, absolute);
  const linked = await f.run("inspect", { path });
  assert.equal(linked.value.error.code, "UNSAFE_PATH");
  assert.equal(await readFile(outside, "utf8"), part.content);
});

test("legacy bundle sources reopen and migrate to the current indexed storage format", async (t) => {
  const f = await fixture(t);
  const design = document(
    "Legacy",
    Array.from({ length: 180 }, (_, index) =>
      rectangle(`node-${index}`, { notes: "x".repeat(1900) }),
    ),
  );
  const source = serializeDesignDocument(normalizeDesignDocument(design));
  const plan = createDesignPersistencePlan({ source, name: design.name, sha256: hash(source) });
  assert.equal(plan.mode, "bundle");
  for (const part of plan.parts) await f.put(part.path, part.content);
  await f.put(path, plan.primarySource);
  const inspected = await f.run("inspect", { path });
  assert.equal(inspected.value.result.storageMode, "bundle");
  design.name = "Migrated";
  const edited = await f.run("edit", {
    path,
    document: design,
    expected_revision: inspected.value.result.revision,
  });
  assert.equal(edited.code, 0);
  assert.equal(edited.value.result.storageMode, "indexed");
  assert.equal((await f.run("inspect", { path })).value.result.name, "Migrated");
});

test("path traversal, symlink parents, unknown arguments, invalid UTF-8 and oversized input fail as JSON", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "../outside.codesign.json",
    "designs/../outside.codesign.json",
    "designs/.secret.codesign.json",
    "/tmp/design.codesign.json",
  ])
    assert.equal(
      (await f.run("create", { path, document: document() })).value.error.code,
      "UNSAFE_PATH",
    );
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await symlink(outside, join(f.project, "designs"));
  assert.equal(
    (await f.run("create", { path, document: document() })).value.error.code,
    "UNSAFE_PATH",
  );
  assert.deepEqual(await readdir(outside), []);
  assert.equal((await f.run("inspect", { path, unexpected: true })).code, 2);
  const invalid = join(f.root, "invalid.json");
  await writeFile(invalid, Buffer.from([0xff]));
  assert.equal(
    (await f.invoke(["run", "inspect", "--input-file", invalid])).value.error.code,
    "INVALID_UTF8",
  );
  const large = join(f.root, "large.json");
  await writeFile(large, Buffer.alloc(16 * 1024 * 1024 + 1, 32));
  assert.equal(
    (await f.invoke(["run", "inspect", "--input-file", large])).value.error.code,
    "INPUT_TOO_LARGE",
  );
});

test(
  "FIFO request input is rejected without blocking before the regular-file check",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t),
      fifo = join(f.root, "request.fifo");
    execFileSync("mkfifo", [fifo]);
    const result = await f.invoke(["run", "inspect", "--input-file", fifo]);
    assert.equal(result.code, 1);
    assert.equal(result.value.error.code, "INVALID_FILE");
  },
);
