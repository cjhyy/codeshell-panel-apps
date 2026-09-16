import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import * as yazl from "yazl";
import * as yauzl from "yauzl";
const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const signal = () => new AbortController().signal;
let temp,
  api,
  tone,
  video,
  index = 0;
before(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "portable-project-")));
  const module = join(temp, "api.mjs");
  await build({
    stdin: {
      contents: `export * from ${JSON.stringify(join(root, "apps/video-studio/native/editor-runtime/bundle.ts"))}; export * from ${JSON.stringify(join(root, "apps/video-studio/src/editor/portable-project.ts"))}; export * from ${JSON.stringify(join(root, "apps/video-studio/src/editor/defaults.ts"))}; export * from ${JSON.stringify(join(root, "apps/video-studio/src/editor/validation.ts"))};`,
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: module,
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
  });
  api = await import(pathToFileURL(module).href);
  tone = join(temp, "tone.wav");
  video = join(temp, "source.mp4");
  for (const args of [
    [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=2",
      "-c:a",
      "pcm_s16le",
      tone,
    ],
    [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=32x32:rate=30000/1001:duration=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ],
  ]) {
    const result = spawnSync("ffmpeg", ["-nostdin", "-v", "error", ...args], { timeout: 30000 });
    assert.equal(result.status, 0, result.stderr?.toString());
  }
});
after(async () => {
  await rm(temp, { recursive: true, force: true });
});
function document() {
  const transform = api.defaultTransform();
  transform.x = {
    keyframes: [
      {
        time: 0,
        value: -0.2,
        easing: { type: "cubic-bezier", x1: 0.2, y1: 0.7, x2: 0.6, y2: 0.9 },
      },
      { time: 480000, value: 0.2 },
    ],
  };
  const visual = { transform, color: api.defaultColorAdjustment(), blendMode: "normal" };
  const media = (id, assetId, trackId = "v") => ({
    id,
    kind: "media",
    assetId,
    trackId,
    start: 0,
    duration: 480000,
    label: id,
    ...structuredClone(visual),
    audio: api.defaultAudioMix(),
    timeMap: {
      points: [
        { time: 0, source: 470000 },
        { time: 240000, source: 10000 },
        { time: 480000, source: 10000 },
      ],
    },
  });
  const doc = {
    schemaVersion: 2,
    timebase: 240000,
    id: "portable-full",
    name: "跨设备剪辑 · 原始工程",
    revision: 19,
    assets: [
      {
        id: "a",
        name: "同源镜头一",
        kind: "video",
        duration: 480000,
        width: 32,
        height: 32,
        resourceId: "external-first",
        metadata: { note: "原始元数据保留" },
      },
      {
        id: "b",
        name: "同源镜头二",
        kind: "video",
        duration: 480000,
        width: 32,
        height: 32,
        resourceId: "external-second",
      },
      {
        id: "sound",
        name: "未使用的原始声音",
        kind: "audio",
        duration: 480000,
        resourceId: "external-sound",
      },
    ],
    sequences: [
      {
        id: "child",
        name: "内层",
        width: 32,
        height: 32,
        frameRate: { numerator: 30000, denominator: 1001 },
        background: "#000000",
        timelineMode: "free",
        tracks: [api.createTrack("v", "video"), api.createTrack("t", "text")],
        clips: [
          media("clip-a", "a"),
          {
            id: "sub",
            kind: "text",
            trackId: "t",
            start: 0,
            duration: 480000,
            label: "字幕",
            ...structuredClone(visual),
            role: "subtitle",
            text: "精确 字幕",
            style: api.defaultTextStyle(),
            words: [
              { text: "精确", start: 0, end: 200001 },
              { text: "字幕", start: 200001, end: 480000 },
            ],
            sourceBinding: { clipId: "clip-a", sourceStart: 10000, sourceEnd: 470000 },
            translation: { original: "Exact captions", language: "zh", mode: "bilingual" },
          },
        ],
        transitions: [],
        markers: [],
      },
      {
        id: "main",
        name: "成片",
        width: 64,
        height: 64,
        frameRate: { numerator: 24000, denominator: 1001 },
        background: "#000000",
        timelineMode: "free",
        tracks: [api.createTrack("v", "video"), api.createTrack("v2", "video")],
        clips: [
          {
            ...media("nested", "a"),
            kind: "sequence",
            assetId: undefined,
            sequenceId: "child",
            timeMap: {
              points: [
                { time: 0, source: 0 },
                { time: 480000, source: 480000 },
              ],
            },
          },
          {
            ...media("multi", "b", "v2"),
            kind: "multicam",
            assetId: undefined,
            angles: [
              { id: "one", name: "一", assetId: "a", offset: 0 },
              { id: "two", name: "二", assetId: "b", offset: 0 },
            ],
            switches: [
              { time: 0, angleId: "one" },
              { time: 200001, angleId: "two" },
            ],
            audioAngleId: "one",
          },
        ],
        transitions: [],
        markers: [],
      },
    ],
    activeSequenceId: "main",
    exportProfiles: [],
    production: { draft: { title: "完整保留" } },
  };
  return api.validateEditorDocument(JSON.parse(JSON.stringify(doc)));
}
async function context() {
  const workDir = join(temp, `job-${++index}`);
  await mkdir(workDir);
  return { workDir, sourceRoots: [temp], signal: signal() };
}
const resolver = async (asset) => ({ path: asset.id === "sound" ? tone : video });
async function archive(path, entries, options = {}) {
  const zip = new yazl.ZipFile(),
    chunks = [];
  const ended = new Promise((resolve, reject) => {
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.on("end", resolve);
    zip.outputStream.on("error", reject);
    zip.on("error", reject);
  });
  for (const entry of entries)
    zip.addBuffer(entry.data, entry.name, { compress: false, ...options, ...entry.options });
  zip.end({ forceZip64Format: options.forceZip64Format });
  await ended;
  await writeFile(path, Buffer.concat(chunks));
}
async function packed(ctx = undefined) {
  ctx ??= await context();
  const doc = document();
  const result = await api.exportPortableProject({
    ...ctx,
    document: doc,
    outputPath: join(ctx.workDir, "project.mimiproject"),
    resolveAsset: resolver,
  });
  return { ...result, ctx, doc };
}
async function modifiedBundle(mutator, zipOptions = {}) {
  const { manifest, ctx } = await packed(),
    path = join(ctx.workDir, "modified.zip");
  const entries = [{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) }];
  for (const item of manifest.media)
    entries.push({
      name: `media/${item.sha256}`,
      data: await readFile(item.assetIds.includes("sound") ? tone : video),
    });
  await mutator(entries, manifest);
  await archive(path, entries, zipOptions);
  return { path, ctx, manifest };
}

test("standard ZIP roundtrip preserves complex full document and deduplicates identical original bytes", async () => {
  const { ctx, doc, path, manifest, sha256, bytes } = await packed();
  assert.equal(sha256, hash(await readFile(path)));
  assert.equal(bytes, (await readFile(path)).length);
  assert.equal(manifest.media.length, 2);
  assert.ok(manifest.media.some((item) => item.assetIds.join() === "a,b"));
  const independent = spawnSync("python3", [
    "-c",
    "import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))",
    path,
  ]);
  assert.equal(independent.status, 0, independent.stderr?.toString());
  assert.equal(JSON.parse(independent.stdout).length, 3);
  const imported = await api.importPortableProject({ ...ctx, inputPath: path });
  assert.deepEqual(imported.document, doc);
  for (const item of imported.media) {
    assert.equal(hash(await readFile(item.path)), item.sha256);
    assert.equal((await readFile(item.path)).length, item.bytes);
    assert.ok(item.path.startsWith(imported.directory + "/media/"));
  }
  const received = api.remapPortableProjectResources(
    imported.manifest,
    imported.media.map((item) => ({ sha256: item.sha256, resourceId: `asset-${item.sha256}` })),
  );
  assert.deepEqual(received.sequences, doc.sequences);
  assert.deepEqual(received.production, doc.production);
  assert.equal(received.assets[0].resourceId, received.assets[1].resourceId);
  assert.notEqual(received.assets[0].resourceId, doc.assets[0].resourceId);
});
test("ZIP64 and independent deflated ZIP input are supported", async () => {
  const { ctx, path } = await modifiedBundle(async () => {}, {
    forceZip64Format: true,
    compress: true,
  });
  const bytes = await readFile(path);
  assert.ok(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])));
  assert.equal((await api.importPortableProject({ ...ctx, inputPath: path })).media.length, 2);
  const pythonPath = join(ctx.workDir, "python.zip");
  const result = spawnSync("python3", [
    "-c",
    "import zipfile,sys; a=zipfile.ZipFile(sys.argv[1]); b=zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED); [b.writestr(n,a.read(n)) for n in a.namelist()]; b.close()",
    path,
    pythonPath,
  ]);
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.equal(
    (await api.importPortableProject({ ...ctx, inputPath: pythonPath })).media.length,
    2,
  );
});
test("preflight lists all unavailable originals, refuses empty files, and publishes no incomplete ZIP", async () => {
  const ctx = await context(),
    outputPath = join(ctx.workDir, "missing.zip"),
    empty = join(ctx.workDir, "empty.bin");
  await writeFile(empty, "");
  await assert.rejects(
    api.exportPortableProject({
      ...ctx,
      document: document(),
      outputPath,
      resolveAsset: async (asset) =>
        asset.id === "sound" ? { path: empty } : Promise.reject(new Error("原文件已离线")),
    }),
    (error) => error.code === "MISSING_MEDIA" && error.issues.length === 3,
  );
  assert.deepEqual(await readdir(ctx.workDir), ["empty.bin"]);
});
test("forged SHA, source fingerprint, missing ZIP media, unknown versions and unlisted blobs reject", async () => {
  const ctx = await context(),
    doc = document();
  doc.assets[0].fingerprint = "f".repeat(64);
  await assert.rejects(
    api.exportPortableProject({
      ...ctx,
      document: doc,
      outputPath: join(ctx.workDir, "bad.zip"),
      resolveAsset: resolver,
    }),
    { code: "MISSING_MEDIA" },
  );
  for (const [mutate, expected] of [
    [
      (entries) => {
        entries[1].data = Buffer.alloc(entries[1].data.length, 0x70);
      },
      "HASH_MISMATCH",
    ],
    [
      (entries) => {
        entries.pop();
      },
      "MISSING_MEDIA",
    ],
    [
      (entries, manifest) => {
        manifest.formatVersion = 999;
        entries[0].data = Buffer.from(JSON.stringify(manifest));
      },
      "UNSUPPORTED_BUNDLE_VERSION",
    ],
    [
      (entries) => {
        entries.push({ name: `media/${"c".repeat(64)}`, data: Buffer.from("extra") });
      },
      "INVALID_BUNDLE",
    ],
  ]) {
    const { path, ctx } = await modifiedBundle(mutate);
    await assert.rejects(api.importPortableProject({ ...ctx, inputPath: path }), {
      code: expected,
    });
    assert.equal(
      (await readdir(ctx.workDir)).filter((name) => name.startsWith("bundle-import-")).length,
      0,
    );
  }
});
test("duplicate entries, symlinks, traversal, absolute names and local-header tricks are rejected without extraction", async () => {
  const changes = [
    async (entries) => entries.push(entries[1]),
    async (entries) => {
      entries[1].options = { mode: 0o120777 };
    },
  ];
  for (const mutate of changes) {
    const { path, ctx } = await modifiedBundle(mutate);
    await assert.rejects(api.importPortableProject({ ...ctx, inputPath: path }), /重复|符号链接/);
  }
  for (const name of ["../evilxx.bin", "/evilxxx.bin", "..\\evilx.bin"]) {
    const { path, ctx } = await modifiedBundle(async () => {}),
      bytes = await readFile(path);
    assert.ok(Buffer.byteLength(name) <= 13);
    // Replace both manifest names to bypass writer filename protections and exercise the reader.
    let at = -1;
    while ((at = bytes.indexOf("manifest.json", at + 1)) >= 0)
      Buffer.from(name.padEnd(13, "x")).copy(bytes, at);
    await writeFile(path, bytes);
    await assert.rejects(api.importPortableProject({ ...ctx, inputPath: path }));
  }
  const { path, ctx } = await modifiedBundle(async () => {}),
    bytes = await readFile(path);
  bytes[30] = "x".charCodeAt(0);
  await writeFile(path, bytes);
  await assert.rejects(api.importPortableProject({ ...ctx, inputPath: path }), /本地头/);
});
test("CRC damage, inflated sizes, decompression ratio and entry/disk budgets fail clearly", async () => {
  const { path, ctx } = await modifiedBundle(async () => {}),
    bytes = await readFile(path);
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes[central + 16] ^= 1;
  await writeFile(path, bytes);
  await assert.rejects(api.importPortableProject({ ...ctx, inputPath: path }), /CRC/);
  const normal = await packed();
  for (const limits of [
    { maxMedia: 1 },
    { maxTotalBytes: 100 },
    { maxManifestBytes: 10 },
    { maxArchiveBytes: 100 },
    { maxFileBytes: 10 },
  ])
    await assert.rejects(
      api.importPortableProject({ ...normal.ctx, inputPath: normal.path, limits }),
      { code: "LIMIT_EXCEEDED" },
    );
  const deflated = await modifiedBundle(
    async (entries) => {
      entries[1].data = Buffer.alloc(100000, 0);
    },
    { compress: true },
  );
  await assert.rejects(
    api.importPortableProject({
      ...deflated.ctx,
      inputPath: deflated.path,
      limits: { maxCompressionRatio: 5 },
    }),
    { code: "LIMIT_EXCEEDED" },
  );
});
test("declared decompressed size and malformed archives cannot bypass actual byte validation", async () => {
  const altered = await modifiedBundle(async () => {}, { compress: true });
  const data = await readFile(altered.path);
  const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  data.writeUInt32LE(data.readUInt32LE(central + 24) + 1, central + 24);
  await writeFile(altered.path, data);
  await assert.rejects(api.importPortableProject({ ...altered.ctx, inputPath: altered.path }), {
    code: "INVALID_ZIP",
  });
  for (const content of [Buffer.alloc(0), Buffer.from("not a ZIP"), data.subarray(0, 20)]) {
    const ctx = await context(),
      path = join(ctx.workDir, "invalid.zip");
    await writeFile(path, content);
    await assert.rejects(api.importPortableProject({ ...ctx, inputPath: path }));
    assert.deepEqual(await readdir(ctx.workDir), ["invalid.zip"]);
  }
});
test("output byte limits fail while streaming and leave no partial ZIP", async () => {
  const ctx = await context();
  await assert.rejects(
    api.exportPortableProject({
      ...ctx,
      document: document(),
      outputPath: join(ctx.workDir, "limited.zip"),
      resolveAsset: resolver,
      limits: { maxArchiveBytes: 100 },
    }),
    { code: "LIMIT_EXCEEDED" },
  );
  assert.deepEqual(await readdir(ctx.workDir), []);
});

test("Host path allowlists, symlinks, output confinement and exclusive publication protect unrelated files", async () => {
  const ctx = await context(),
    alias = join(ctx.workDir, "alias.mp4");
  await symlink(video, alias);
  await assert.rejects(
    api.exportPortableProject({
      ...ctx,
      document: document(),
      outputPath: join(ctx.workDir, "bad.zip"),
      resolveAsset: async () => ({ path: alias }),
    }),
    { code: "MISSING_MEDIA" },
  );
  await assert.rejects(
    api.exportPortableProject({
      ...ctx,
      sourceRoots: [ctx.workDir],
      document: document(),
      outputPath: join(ctx.workDir, "bad.zip"),
      resolveAsset: resolver,
    }),
    { code: "MISSING_MEDIA" },
  );
  await assert.rejects(
    api.exportPortableProject({
      ...ctx,
      document: document(),
      outputPath: join(temp, "outside.zip"),
      resolveAsset: resolver,
    }),
    { code: "INVALID_FILE" },
  );
  const existing = join(ctx.workDir, "existing.zip");
  await writeFile(existing, "keep");
  await assert.rejects(
    api.exportPortableProject({
      ...ctx,
      document: document(),
      outputPath: existing,
      resolveAsset: resolver,
    }),
    { code: "OUTPUT_EXISTS" },
  );
  assert.equal(await readFile(existing, "utf8"), "keep");
  const packedSource = await packed(),
    linkPath = join(ctx.workDir, "linked.zip");
  await symlink(packedSource.path, linkPath);
  await assert.rejects(api.importPortableProject({ ...ctx, inputPath: linkPath }), /符号链接/);
});
test("cancellation and source changes during packing remove every partial output", async () => {
  for (const phase of ["checking", "packing"]) {
    const ctx = await context(),
      controller = new AbortController();
    await assert.rejects(
      api.exportPortableProject({
        ...ctx,
        signal: controller.signal,
        document: document(),
        outputPath: join(ctx.workDir, "cancel.zip"),
        resolveAsset: resolver,
        onProgress: (p) => {
          if (p.phase === phase) controller.abort();
        },
      }),
      { name: "AbortError" },
    );
    assert.deepEqual(await readdir(ctx.workDir), []);
  }
  const ctx = await context(),
    mutable = join(ctx.workDir, "mutable.mp4");
  await writeFile(mutable, await readFile(video));
  await assert.rejects(
    api.exportPortableProject({
      ...ctx,
      document: document(),
      outputPath: join(ctx.workDir, "changed.zip"),
      resolveAsset: async (asset) => ({ path: asset.id === "sound" ? tone : mutable }),
      onProgress: (progress) => {
        if (progress.phase === "checking" && progress.completed === progress.total)
          writeFileSync(mutable, "changed");
      },
    }),
    { code: "HASH_MISMATCH" },
  );
  assert.deepEqual(await readdir(ctx.workDir), ["mutable.mp4"]);
});
test("cancelled unpack removes already-verified files and returns no partial document", async () => {
  const { ctx, path } = await packed(),
    controller = new AbortController();
  await assert.rejects(
    api.importPortableProject({
      ...ctx,
      signal: controller.signal,
      inputPath: path,
      onProgress: () => controller.abort(),
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(await readdir(ctx.workDir), ["project.mimiproject"]);
});
