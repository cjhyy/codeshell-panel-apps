import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, lstat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const moduleUrl = new URL("../scripts/verify-release-zip.mjs", import.meta.url);
const manifestPath = ".codeshell-panel/panel.json";
const manifest = Buffer.from(
  JSON.stringify({ id: "fixture", version: "1.2.3", entry: "app/index.html" }),
);
const base = {
  [manifestPath]: manifest,
  "app/index.html": Buffer.from("hello"),
  "README.md": Buffer.from("readme"),
};
const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

async function fixture({ built = false, missingGenerated = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "panel-release-zip-test-"));
  git(root, ["init", "-q"]);
  const dir = built ? "panels/fixture" : "apps/fixture";
  const files = { ...base };
  if (built)
    files["app/build-manifest.json"] = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        files: Object.fromEntries(
          Object.entries(files).map(([name, bytes]) => [
            name,
            createHash("sha256").update(bytes).digest("hex"),
          ]),
        ),
      }),
    );
  const stored = missingGenerated ? "apps/fixture" : dir;
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(join(root, stored, name, ".."), { recursive: true });
    await writeFile(join(root, stored, name), bytes);
  }
  if (built) {
    await mkdir(join(root, "apps/fixture"), { recursive: true });
    await writeFile(join(root, "apps/fixture/panel.build.json"), '{"entry":"src/main.ts"}');
    await mkdir(join(root, "apps/fixture/.codeshell-panel"), { recursive: true });
    await writeFile(join(root, "apps/fixture", manifestPath), manifest);
  } else {
    await writeFile(join(root, dir, "dev-only.txt"), "not shipped by the packager");
  }
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  ]);
  git(root, ["tag", "fixture-v1.2.3"]);
  return { root, dir, files };
}

async function archive(root, files, { wrapped = true, compress = false, forceZip64 = false } = {}) {
  const zip = new yazl.ZipFile();
  for (const [name, bytes] of Object.entries(files))
    zip.addBuffer(bytes, `${wrapped ? "fixture/" : ""}${name}`, { compress, mode: 0o100644 });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.on("end", resolve);
    zip.outputStream.on("error", reject);
  });
  zip.end({ forceZip64Format: forceZip64 });
  await done;
  const path = join(root, "input.zip");
  await writeFile(path, Buffer.concat(chunks), { mode: 0o600 });
  return path;
}

async function verify(f, zip, extra = {}) {
  const { verifyReleaseZip } = await import(moduleUrl);
  return verifyReleaseZip({ repoRoot: f.root, tag: "fixture-v1.2.3", dir: f.dir, zip, ...extra });
}

async function rejected(f, zip, code, extra = {}) {
  await assert.rejects(verify(f, zip, extra), (error) => error.code === code);
}

// Mutate writer-produced fixtures: production never contains a ZIP parser/writer.
function central(bytes) {
  const positions = [];
  for (let i = 0; i < bytes.length - 46; i++)
    if (bytes.readUInt32LE(i) === 0x02014b50) positions.push(i);
  return positions;
}
async function mutate(path, change) {
  const bytes = await readFile(path);
  change(bytes, central(bytes));
  await writeFile(path, bytes);
}

for (const wrapped of [false, true])
  test(`identical ${wrapped ? "single root" : "flat"} installable contents; tag, not dirty checkout`, async () => {
    const f = await fixture();
    const zip = await archive(f.root, f.files, { wrapped });
    await writeFile(join(f.root, f.dir, "app/index.html"), "dirty worktree must be ignored");
    const before = await readFile(zip),
      info = await lstat(zip);
    const report = await verify(f, zip);
    assert.equal(report.status, "equal");
    assert.equal(report.exitCode, 0);
    assert.equal(report.files.length, 3);
    assert.deepEqual(report.differences, []);
    assert.deepEqual(report.scope.excludedTagPaths, ["dev-only.txt"]);
    assert.equal(report.tagCommit, git(f.root, ["rev-parse", "HEAD"]).trim());
    assert.deepEqual(await readFile(zip), before);
    assert.equal((await lstat(zip)).mtimeMs, info.mtimeMs);
  });

for (const change of ["extra", "missing", "changed"])
  test(`reports ${change} business bytes`, async () => {
    const f = await fixture(),
      files = { ...f.files };
    if (change === "extra") files["app/extra.js"] = Buffer.from("extra");
    if (change === "missing") delete files["app/index.html"];
    if (change === "changed") files["app/index.html"] = Buffer.from("HELLO");
    const report = await verify(f, await archive(f.root, files));
    assert.equal(report.status, "different");
    assert.equal(report.exitCode, 1);
    assert.equal(report.differences[0].kind, change);
  });

test("uses committed generated package, excludes development source", async () => {
  const f = await fixture({ built: true });
  assert.equal((await verify(f, await archive(f.root, f.files))).status, "equal");
  await rejected(f, join(f.root, "input.zip"), "PACKAGE_DIR", { dir: "apps/fixture" });
});
test("absent tag generated output is explicitly incomplete, never equal", async () => {
  const f = await fixture({ built: true, missingGenerated: true });
  const report = await verify(f, await archive(f.root, f.files));
  assert.equal(report.status, "incomplete");
  assert.equal(report.exitCode, 1);
  assert.equal(report.scope.complete, false);
  assert.match(report.scope.reason, /generated/);
  assert.equal(report.files.filter((file) => file.tagSha256).length, 0);
});
test("partial generated tag and identically partial ZIP cannot claim equality", async () => {
  const f = await fixture({ built: true });
  git(f.root, ["rm", `${f.dir}/app/index.html`]);
  git(f.root, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "partial generated output",
  ]);
  git(f.root, ["tag", "-d", "fixture-v1.2.3"]);
  git(f.root, ["tag", "fixture-v1.2.3"]);
  const files = { ...f.files };
  delete files["app/index.html"];
  const report = await verify(f, await archive(f.root, files));
  assert.equal(report.status, "incomplete");
  assert.equal(report.scope.complete, false);
  assert.ok(report.scope.generatedIssues.some((issue) => issue.path === "app/index.html"));
});
test("Unicode case aliases are rejected", async () => {
  const f = await fixture();
  const zip = await archive(f.root, {
    ...f.files,
    "app/σ.txt": Buffer.from("x"),
    "app/ς.txt": Buffer.from("y"),
  });
  await rejected(f, zip, "ZIP_INVALID");
});

for (const field of ["id", "version"])
  test(`manifest ${field} mismatch is a difference`, async () => {
    const f = await fixture(),
      files = { ...f.files };
    files[manifestPath] = Buffer.from(
      JSON.stringify({ ...JSON.parse(manifest), [field]: "wrong" }),
    );
    const report = await verify(f, await archive(f.root, files));
    assert.equal(report.exitCode, 1);
    assert.ok(report.manifestMismatches.includes(field));
  });
test("missing or malformed manifest is invalid", async () => {
  const f = await fixture();
  await rejected(f, await archive(f.root, { "app/index.html": Buffer.from("a") }), "MANIFEST");
  await rejected(
    f,
    await archive(f.root, { ...f.files, [manifestPath]: Buffer.from("{") }),
    "MANIFEST",
  );
});

for (const bad of ["../x", "/root", "a\\b", "./x", "a//b", "a/../b", "C:/x", "a./x"])
  test(`rejects ZIP path ${JSON.stringify(bad)}`, async () => {
    const f = await fixture();
    const zip = await archive(
      f.root,
      { ...f.files, ["x".repeat(bad.length)]: Buffer.from("bad") },
      { wrapped: false },
    );
    await mutate(zip, (bytes, positions) => {
      const pos = positions.at(-1),
        local = bytes.readUInt32LE(pos + 42);
      Buffer.from(bad).copy(bytes, pos + 46);
      Buffer.from(bad).copy(bytes, local + 30);
    });
    await rejected(f, zip, "ZIP_INVALID");
  });
for (const kind of [
  "duplicate",
  "case",
  "symlink",
  "special",
  "volume-label",
  "encrypted",
  "descriptor",
  "crc",
  "local-name",
  "local-extra",
  "zip64",
  "overlap",
  "truncated",
])
  test(`rejects ${kind}`, async () => {
    const f = await fixture();
    const zip = await archive(
      f.root,
      { ...f.files, "app/other.html": Buffer.from("hello") },
      { wrapped: false, forceZip64: kind === "zip64" },
    );
    await mutate(zip, (bytes, positions) => {
      const p = positions.at(-1),
        local = bytes.readUInt32LE(p + 42);
      if (kind === "duplicate" || kind === "case") {
        const name = kind === "case" ? "app/INDEX.html" : "app/index.html";
        Buffer.from(name).copy(bytes, p + 46);
        Buffer.from(name).copy(bytes, local + 30);
      }
      if (kind === "symlink" || kind === "special")
        bytes.writeUInt32LE(((kind === "symlink" ? 0xa1ff : 0x11ff) << 16) >>> 0, p + 38);
      if (kind === "volume-label") bytes.writeUInt32LE(8, p + 38);
      if (kind === "encrypted") bytes.writeUInt16LE(bytes.readUInt16LE(p + 8) | 1, p + 8);
      if (kind === "descriptor") {
        bytes.writeUInt16LE(bytes.readUInt16LE(p + 8) | 8, p + 8);
        bytes.writeUInt16LE(bytes.readUInt16LE(local + 6) | 8, local + 6);
      }
      if (kind === "crc") {
        bytes[local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)] ^= 1;
      }
      if (kind === "local-name") bytes[local + 30] ^= 1;
      if (kind === "local-extra") {
        // addBuffer normally has no local extra; claim malformed bytes as extra.
        bytes.writeUInt16LE(3, local + 28);
      }
      if (kind === "overlap") bytes.writeUInt32LE(bytes.readUInt32LE(positions[0] + 42), p + 42);
    });
    if (kind === "truncated") await writeFile(zip, (await readFile(zip)).subarray(0, 60));
    await rejected(f, zip, "ZIP_INVALID");
  });
test("exact annotated tag wins over a same-named branch", async () => {
  const f = await fixture(),
    zip = await archive(f.root, f.files),
    original = git(f.root, ["rev-parse", "HEAD"]).trim();
  git(f.root, ["tag", "-d", "fixture-v1.2.3"]);
  git(f.root, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "tag",
    "-am",
    "annotated fixture",
    "fixture-v1.2.3",
  ]);
  await writeFile(join(f.root, f.dir, "app/index.html"), "branch-only changed bytes");
  git(f.root, ["add", "."]);
  git(f.root, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "branch",
  ]);
  git(f.root, ["branch", "fixture-v1.2.3"]);
  const report = await verify(f, zip);
  assert.equal(report.tagCommit, original);
  assert.notEqual(report.tagObject, original);
  assert.equal(report.status, "equal");
});

for (const [limit, value] of Object.entries({
  maxArchiveBytes: 30,
  maxEntries: 2,
  maxFileBytes: 4,
  maxCompressedFileBytes: 4,
  maxTotalBytes: 5,
  maxCompressedTotalBytes: 5,
  maxManifestBytes: 5,
  maxMetadataBytes: 10,
  maxRatio: 1,
}))
  test(`enforces ${limit}`, async () => {
    const f = await fixture();
    const zip = await archive(
      f.root,
      { ...f.files, "app/big.js": Buffer.alloc(5000, 65) },
      { compress: true },
    );
    await rejected(f, zip, "LIMIT_EXCEEDED", { limits: { [limit]: value } });
  });
test("inflated bytes cannot lie about their central-directory size", async () => {
  const f = await fixture();
  const zip = await archive(
    f.root,
    { ...f.files, "app/big.js": Buffer.alloc(10000, 65) },
    { compress: true },
  );
  await mutate(zip, (bytes, positions) => bytes.writeUInt32LE(1, positions.at(-1) + 24));
  await rejected(f, zip, "ZIP_INVALID");
});
test("rejects ZIP source symlink", async () => {
  const f = await fixture(),
    zip = await archive(f.root, f.files),
    link = join(f.root, "link.zip");
  await symlink(zip, link);
  await rejected(f, link, "INPUT");
});
test("rejects Git symlinks in the shipped inventory", async () => {
  const f = await fixture(),
    zip = await archive(f.root, f.files);
  await symlink("index.html", join(f.root, f.dir, "app/link"));
  git(f.root, ["add", "."]);
  git(f.root, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "link",
  ]);
  git(f.root, ["tag", "fixture-v1.2.4"]);
  await rejected(f, zip, "GIT_TREE", { tag: "fixture-v1.2.4" });
});
for (const tag of [
  "--help",
  "HEAD",
  "fixture-v1.2.3^{tree}",
  "fixture-v1.2.3:app",
  "fixture-v1.2.3;echo secret",
])
  test(`rejects non-exact release tag ${JSON.stringify(tag)}`, async () => {
    const f = await fixture();
    await rejected(f, await archive(f.root, f.files), "ARGUMENT", { tag });
  });
test("CLI gives one safe JSON receipt and invalid-input exit 2", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(moduleUrl), "--tag", "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "error");
  assert.equal(result.stderr, "");
  assert.ok(!result.stdout.includes("--help"));
});
