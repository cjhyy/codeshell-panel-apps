import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { renameSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type * as Scanner from "../apps/video-studio/native/folder-scan";

let temporary: string, cli: string, api: typeof Scanner;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "video-folder-scan-"));
  cli = join(temporary, "folder-scan.mjs");
  const { build } = createRequire(resolve("package.json"))("esbuild");
  await build({
    entryPoints: [resolve("apps/video-studio/native/folder-scan.ts")],
    outfile: cli,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  api = await import(pathToFileURL(cli).href);
});
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});
async function folder() {
  return mkdtemp(join(temporary, "sources-"));
}
async function file(root: string, path: string, data = "source") {
  const full = join(root, path);
  await mkdir(resolve(full, ".."), { recursive: true });
  await writeFile(full, data);
  return full;
}
async function rejectsSafely(work: Promise<unknown>, root: string, pattern?: RegExp) {
  await assert.rejects(work, (error: Error) => {
    assert.doesNotMatch(error.message, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test("recursive scans preserve distinct same-name files, metadata, MIME and deterministic relative paths without writing", async () => {
  const root = await folder();
  const paths = ["b/clip.MP4", "a/clip.MP4", "录音/我的声音.wav", "cover.JPEG", "empty.webm"];
  for (const path of paths) await file(root, path, path === "empty.webm" ? "" : path);
  const sameTime = new Date("2026-01-02T03:04:05.000Z");
  for (const path of paths) await utimes(join(root, path), sameTime, sameTime);
  const before = await Promise.all(
    paths.map(async (path) => ({
      path,
      bytes: await readFile(join(root, path)),
      stat: await stat(join(root, path)),
    })),
  );
  const first = await api.scanFolder(root);
  assert.deepEqual(await api.scanFolder(root), first);
  assert.deepEqual(
    first.files.map((row) => row.path),
    paths.filter((path) => path !== "empty.webm").sort(),
  );
  assert.equal(first.skipped, 1);
  assert.equal(first.files.filter((row) => row.name === "clip.MP4").length, 2);
  assert.ok(!first.files.some((row) => row.path === "empty.webm"));
  assert.equal(first.files.find((row) => row.name === "cover.JPEG")!.mimeType, "image/jpeg");
  for (const row of first.files) {
    assert.equal(row.lastModified, sameTime.getTime());
    assert.ok(!row.path.startsWith("/") && !row.path.includes("\\"));
    assert.equal(row.bytes, Buffer.byteLength(row.path === "empty.webm" ? "" : row.path));
  }
  for (const item of before) {
    assert.deepEqual(await readFile(join(root, item.path)), item.bytes);
    assert.equal((await stat(join(root, item.path))).mtimeMs, item.stat.mtimeMs);
  }
});

test("hidden and dependency trees, unsupported files and symlinks never become sources", async (t) => {
  const root = await folder(),
    outside = await folder();
  await file(root, "clip.mp4");
  for (const path of [
    ".git/a.mp4",
    ".hidden/a.mp4",
    "node_modules/a.mp4",
    ".secret.wav",
    "notes.txt",
  ])
    await file(root, path);
  await file(outside, "private.mp4");
  let links = 0;
  try {
    await symlink(
      outside,
      join(root, "outside"),
      process.platform === "win32" ? "junction" : "dir",
    );
    links++;
    await symlink(join(outside, "private.mp4"), join(root, "linked.mp4"), "file");
    links++;
  } catch (error: any) {
    if (!["EPERM", "EACCES"].includes(error.code)) throw error;
    t.diagnostic(
      "This account cannot create all symlink fixtures; directory/file checks still run where supported.",
    );
  }
  const result = await api.scanFolder(root);
  assert.deepEqual(
    result.files.map((row) => row.path),
    ["clip.mp4"],
  );
  assert.equal(result.skipped, 5 + links);
});

test("the selected root must be a real directory, and errors never expose its absolute path", async (t) => {
  const root = await folder();
  const source = await file(root, "clip.mp4");
  await rejectsSafely(api.scanFolder(source), root, /真实的素材文件夹/);
  await rejectsSafely(api.scanFolder(join(root, "missing")), root, /扫描失败/);
  const link = join(root, "alias");
  try {
    await symlink(root, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error: any) {
    if (!["EPERM", "EACCES"].includes(error.code)) throw error;
    t.diagnostic("Symlink-root fixture requires symlink privilege.");
    return;
  }
  await rejectsSafely(api.scanFolder(link), root, /符号链接/);
});

for (const change of ["overwrite", "remove", "replace-root", "replace-ancestor"] as const)
  test(`a real ${change} during traversal rejects the complete scan instead of returning stale sources`, async () => {
    const root = await folder();
    const source = await file(root, "nested/clip.mp4", "before");
    let changed = false;
    await rejectsSafely(
      api.scanFolder(root, {
        onProgress({ files }) {
          if (!files || changed) return;
          changed = true;
          if (change === "overwrite") writeFileSync(source, "longer, unfinished version");
          else if (change === "remove") unlinkSync(source);
          else if (change === "replace-root") {
            renameSync(root, `${root}-old`);
            mkdirSync(root);
            mkdirSync(join(root, "nested"));
            writeFileSync(source, "replacement");
          } else {
            renameSync(join(root, "nested"), join(root, "old"));
            mkdirSync(join(root, "nested"));
            writeFileSync(source, "replacement");
          }
        },
      }),
      root,
      /变化|扫描失败|替换/,
    );
    assert.equal(changed, true);
  });

test(
  "unreadable selected media fails rather than disappearing from a successful scan",
  { skip: process.platform === "win32" || process.getuid?.() === 0 },
  async () => {
    const root = await folder(),
      source = await file(root, "locked.mp4");
    await chmod(source, 0);
    try {
      await rejectsSafely(api.scanFolder(root), root, /权限|读取/);
    } finally {
      await chmod(source, 0o600);
    }
  },
);

test("1000 media files succeed but a 1001st file rejects without truncation", async () => {
  const root = await folder();
  for (let i = 0; i < 1000; i++) await file(root, `${String(i).padStart(4, "0")}.mp4`, "x");
  assert.equal((await api.scanFolder(root)).files.length, 1000);
  await file(root, "overflow.mp4", "x");
  await rejectsSafely(api.scanFolder(root), root, /超过 1000/);
});

for (const bound of ["maxEntries", "maxDirectories", "maxDepth", "maxOutputBytes"] as const)
  test(`${bound} is a hard error, including traversed non-media entries`, async () => {
    const root = await folder();
    await file(root, "a/b/clip.mp4");
    await file(root, "notes.txt");
    await rejectsSafely(api.scanFolder(root, { limits: { [bound]: 1 } }), root, /上限/);
  });

test("limits cannot be raised beyond the bounded process-output and scan budgets", async () => {
  const root = await folder();
  assert.equal(api.FOLDER_SCAN_LIMITS.maxOutputBytes, 192 * 1024);
  for (const limits of [
    { maxFiles: 1001 },
    { maxOutputBytes: 192 * 1024 + 1 },
    { maxDepth: NaN },
    { extra: 1 },
  ])
    await rejectsSafely(api.scanFolder(root, { limits } as any), root, /限制无效/);
});

for (const [kind, path] of [
  ["segment", `${"a".repeat(237)}.mp4`],
  ["total length", [...Array(5).fill("x".repeat(210)), "clip.mp4"].join("/")],
  ["depth", [...Array(16).fill("d"), "clip.mp4"].join("/")],
])
  test(`resource capture ${kind} limit rejects unusable relative paths`, async (t) => {
    const root = await folder();
    try {
      await file(root, path!);
    } catch (error: any) {
      if (error.code !== "ENAMETOOLONG") throw error;
      t.skip("The filesystem rejects this path before it can reach the scanner.");
      return;
    }
    await rejectsSafely(api.scanFolder(root), root, /路径超过保存上限/);
  });

test("cancellation stops a partial scan and leaves source bytes intact", async () => {
  const root = await folder(),
    source = await file(root, "clip.mp4");
  const controller = new AbortController();
  await rejectsSafely(
    api.scanFolder(root, {
      signal: controller.signal,
      onProgress() {
        controller.abort();
      },
    }),
    root,
    /已取消/,
  );
  assert.equal(await readFile(source, "utf8"), "source");
  await rejectsSafely(api.scanFolder(root, { signal: controller.signal }), root, /已取消/);
});

test("the built entry emits one complete JSON for cwd, emits safe errors without stdout, and importing it never starts a scan", async () => {
  const root = await folder();
  await file(root, "clip.mp4");
  const imported = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(pathToFileURL(cli).href)}); process.stdout.write('imported');`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "imported");
  const success = spawnSync(process.execPath, [cli], { cwd: root, encoding: "utf8" });
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, "");
  assert.deepEqual(JSON.parse(success.stdout), await api.scanFolder(root));
  assert.equal(success.stdout.trim().split("\n").length, 1);
  const invalid = spawnSync(process.execPath, [cli, root], { cwd: root, encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /不接受额外路径/);
  assert.ok(!invalid.stderr.includes(root));
});

test("empty in-progress sources are skipped and discovered after bytes arrive", async () => {
  const root = await folder(),
    path = await file(root, "incoming.mp4", "");
  assert.deepEqual(await api.scanFolder(root), { files: [], skipped: 1 });
  await writeFile(path, "completed bytes");
  const result = await api.scanFolder(root);
  assert.equal(result.files[0]!.path, "incoming.mp4");
  assert.equal(result.files[0]!.bytes, 15);
  assert.equal(result.skipped, 0);
});

test("oversized sparse media stays in the scan so capture can explain its limit without blocking other sources", async () => {
  const root = await folder(),
    path = await file(root, "large.mp4", "");
  const limit = 20 * 1024 ** 3;
  await truncate(path, limit);
  assert.equal((await api.scanFolder(root)).files[0]!.bytes, limit);
  await truncate(path, limit + 1);
  await file(root, "small.wav");
  const result = await api.scanFolder(root);
  assert.equal(result.files.find((source) => source.path === "large.mp4")!.bytes, limit + 1);
  assert.equal(result.files.length, 2);
});

test("output budget includes the CLI trailing newline", async () => {
  const root = await folder(),
    empty = { files: [], skipped: 0 };
  const bytes = Buffer.byteLength(JSON.stringify(empty));
  await rejectsSafely(
    api.scanFolder(root, { limits: { maxOutputBytes: bytes } }),
    root,
    /输出上限/,
  );
  assert.deepEqual(await api.scanFolder(root, { limits: { maxOutputBytes: bytes + 1 } }), empty);
});
