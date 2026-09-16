import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  copyFile,
  rm,
  readdir,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const scope = "d".repeat(64),
  transfer = () => `editor-${randomUUID()}`;
const banner = {
  js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
};
let temp,
  api,
  cli,
  runtimeDir,
  sources,
  sourceDocument,
  sequenceTransfer,
  exported,
  imported,
  importTransfer;
let counter = 0;
function wave(index) {
  const data = Buffer.alloc(48);
  data.write("RIFF");
  data.writeUInt32LE(40, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(48000, 24);
  data.writeUInt32LE(96000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(4, 40);
  data.writeInt16LE(index, 44);
  data.writeInt16LE(-index, 46);
  return data;
}
before(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "portable-task-runtime-")));
  runtimeDir = join(temp, "app-data");
  await mkdir(runtimeDir);
  await mkdir(join(temp, "tools"));
  const module = join(temp, "api.mjs");
  await build({
    stdin: {
      contents: `export * from './apps/video-studio/native/editor-runtime/runtime.ts';export * from './apps/video-studio/src/editor/portable-project.ts';export * from './apps/video-studio/src/editor/task-bridge.ts';`,
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: module,
    banner,
  });
  api = await import(pathToFileURL(module).href);
  cli = join(temp, "tools", "editor-runtime.mjs");
  await build({
    stdin: {
      contents: `import {runEditorCli} from './apps/video-studio/native/editor-runtime/cli.ts';await runEditorCli({runtimeSource:'',runtimeSha:'${"0".repeat(64)}'});`,
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: cli,
    banner,
  });
  await copyFile(
    join(root, "apps/video-studio/public/demo-narration.mp3"),
    join(temp, "demo-narration.mp3"),
  );
  sources = new Map();
  const assets = [];
  for (let index = 0; index < 129; index++) {
    const data = wave(index + 1),
      id = `asset-${hash(data)}`,
      path = join(temp, `sound-${index}.wav`);
    await writeFile(path, data);
    sources.set(id, path);
    assets.push({
      id: `audio-${index}`,
      resourceId: id,
      fingerprint: hash(data),
      name: `真实声音 ${index}`,
      kind: "audio",
      duration: 10,
      metadata: { mimeType: "audio/wav", sourcePath: `/original-device/sound-${index}.wav` },
    });
  }
  assets.push({
    id: "demo-narration-v1",
    name: "示例旁白 · 从想法，到成片。",
    kind: "audio",
    duration: 24 * 240000,
    metadata: { mimeType: "audio/mpeg" },
  });
  sourceDocument = {
    schemaVersion: 2,
    timebase: 240000,
    id: "native-portable",
    name: "全部序列和素材",
    revision: 8,
    assets,
    sequences: ["first", "unused"].map((id) => ({
      id,
      name: id,
      width: 64,
      height: 64,
      frameRate: { numerator: 24000, denominator: 1001 },
      background: "#000000",
      timelineMode: "free",
      tracks: [],
      clips: [],
      transitions: [],
      markers: [],
    })),
    activeSequenceId: "first",
    exportProfiles: [],
    production: { note: "完整工程注释".repeat(200000) },
  };
});
after(async () => {
  await rm(temp, { recursive: true, force: true });
});
async function job(request, paths = [], useCli = false, signal = new AbortController().signal) {
  const jobDir = join(temp, `job-${++counter}`);
  await mkdir(jobDir);
  await mkdir(join(jobDir, "inputs"));
  for (let index = 0; index < paths.length; index++)
    await copyFile(paths[index], join(jobDir, "inputs", `resource-${index}.bin`));
  let response;
  if (useCli) {
    const result = spawnSync(
      process.execPath,
      [cli, "--job-dir", jobDir, "--runtime-dir", runtimeDir],
      {
        input: JSON.stringify({ ...request, scopeKey: scope, jobId: `job-${counter}` }),
        timeout: 120000,
        maxBuffer: 4 * 1024 ** 2,
      },
    );
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const lines = result.stdout
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(lines.every((line) => Buffer.byteLength(JSON.stringify(line)) < 240 * 1024));
    response = lines.find((line) => line.type === "result").result;
  } else
    response = await api.runEditorRequest(request, {
      jobDir,
      runtimeDir,
      scopeKey: scope,
      jobId: `job-${counter}`,
      signal,
      runtimeSource: "",
      runtimeSha: "0".repeat(64),
      builtinNarrationPath: join(temp, "demo-narration.mp3"),
      reportProgress: () => {},
    });
  assert.ok(response.artifacts.length <= 128);
  for (const artifact of response.artifacts) {
    const bytes = await readFile(join(jobDir, artifact.file));
    assert.equal(hash(bytes), artifact.sha256);
    assert.equal(bytes.length, artifact.bytes);
  }
  return { ...response, jobDir };
}
async function stage(doc, id, project = true) {
  const prepared = project
      ? api.editorProjectDocument(doc)
      : api.editorTaskDocument(doc, doc.activeSequenceId),
    data = Buffer.from(JSON.stringify(prepared.document));
  for (let index = 0; index < prepared.resourceIds.length; index += 128) {
    const batch = prepared.resourceIds.slice(index, index + 128);
    await job(
      { action: "stage-resources", transferId: id, resourceIds: batch },
      batch.map((id) => sources.get(id)),
    );
  }
  const chunkCount = Math.ceil(data.length / (512 * 1024));
  for (let index = 0; index < chunkCount; index++)
    await job({
      action: "stage-document",
      transferId: id,
      documentHash: hash(data),
      chunkIndex: index,
      chunkCount,
      dataBase64: data.subarray(index * 512 * 1024, (index + 1) * 512 * 1024).toString("base64"),
    });
  const committed = await job({
    action: project ? "commit-project" : "commit",
    transferId: id,
    documentHash: hash(data),
    sequenceId: doc.activeSequenceId,
    chunkCount,
    byteLength: data.length,
  });
  return { transferId: id, documentHash: hash(data), sequenceId: doc.activeSequenceId, committed };
}
test("actual CLI exports complete project across 128+1 input batches and includes fixed installed narration", async () => {
  sequenceTransfer = await stage(sourceDocument, transfer());
  assert.equal(sequenceTransfer.committed.result.kind, "project");
  assert.equal(sequenceTransfer.committed.result.resourceCount, 129);
  exported = await job(
    {
      action: "export-project",
      transferId: sequenceTransfer.transferId,
      documentHash: sequenceTransfer.documentHash,
      sequenceId: "first",
    },
    [],
    true,
  );
  assert.equal(exported.result.mediaCount, 130);
  assert.equal(exported.artifacts.length, 1);
  const path = join(exported.jobDir, exported.artifacts[0].file);
  assert.ok((await readFile(path)).length > 2 * 1024 ** 2);
  const python = spawnSync("python3", [
    "-c",
    "import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);m=json.loads(z.read('manifest.json'));assert len(m['document']['sequences'])==2;assert len(m['media'])==130;assert z.testzip() is None",
    path,
  ]);
  assert.equal(python.status, 0, python.stderr?.toString());
});
test("actual CLI import publishes only a manifest receipt, then resumes without original ZIP and publishes 120+10 originals", async () => {
  importTransfer = transfer();
  const path = join(exported.jobDir, exported.artifacts[0].file);
  imported = await job(
    {
      action: "import-project",
      transferId: importTransfer,
      resourceIds: [exported.result.bundle.id],
    },
    [path],
    true,
  );
  assert.equal(imported.result.mediaCount, 130);
  assert.equal(imported.artifacts.length, 1);
  assert.ok(imported.result.manifest.bytes > 2 * 1024 ** 2);
  await rm(join(imported.jobDir, "inputs"), { recursive: true });
  const resumed = await job(
    {
      action: "project-import-status",
      transferId: importTransfer,
      bundleHash: imported.result.bundleHash,
    },
    [],
    true,
  );
  assert.deepEqual(resumed.result.manifest, imported.result.manifest);
  const published = [];
  for (const batchIndex of [0, 1]) {
    const page = await job(
      {
        action: "publish-project-media",
        transferId: importTransfer,
        bundleHash: imported.result.bundleHash,
        batchIndex,
      },
      [],
      true,
    );
    assert.equal(page.artifacts.length, batchIndex ? 10 : 120);
    published.push(...page.result.media);
  }
  const manifest = JSON.parse(
    await readFile(join(imported.jobDir, imported.artifacts[0].file), "utf8"),
  );
  const restored = api.remapPortableProjectResources(
    manifest,
    published.map((item) => ({ sha256: item.sha256, resourceId: item.id })),
  );
  assert.deepEqual(restored.sequences, sourceDocument.sequences);
  assert.deepEqual(restored.production, sourceDocument.production);
  assert.equal(restored.assets[129].resourceId, `asset-${api.EDITOR_DEMO_NARRATION_SHA}`);
  assert.equal(restored.assets[0].metadata.sourcePath, "/original-device/sound-0.wav");
});
test("later publication reads only its small verified page and media, not the large manifest or previous files", async () => {
  const base = join(runtimeDir, "scopes", scope, "transfers", importTransfer, "portable-import"),
    receipt = JSON.parse(await readFile(join(base, "receipt.json"), "utf8"));
  const manifestPath = join(base, receipt.directory, "manifest.json"),
    originalManifest = await readFile(manifestPath);
  const pageZero = JSON.parse(await readFile(join(base, receipt.directory, "page-0.json"), "utf8"));
  const first = join(base, receipt.directory, "media", pageZero[0].sha256),
    originalFirst = await readFile(first);
  await rm(manifestPath);
  await rm(first);
  try {
    const page = await job({
      action: "publish-project-media",
      transferId: importTransfer,
      bundleHash: imported.result.bundleHash,
      batchIndex: 1,
    });
    assert.equal(page.artifacts.length, 10);
    await assert.rejects(
      job({
        action: "publish-project-media",
        transferId: importTransfer,
        bundleHash: imported.result.bundleHash,
        batchIndex: 0,
      }),
    );
  } finally {
    await writeFile(manifestPath, originalManifest);
    await writeFile(first, originalFirst);
  }
});
test("sequence-only snapshots cannot masquerade as complete bundles, and import receipt identities cannot switch", async () => {
  const only = await stage(sourceDocument, transfer(), false);
  await assert.rejects(
    job({
      action: "export-project",
      transferId: only.transferId,
      documentHash: only.documentHash,
      sequenceId: only.sequenceId,
    }),
    { code: "SNAPSHOT_MISMATCH" },
  );
  await assert.rejects(
    job({
      action: "project-import-status",
      transferId: importTransfer,
      bundleHash: "a".repeat(64),
    }),
    { code: "IMPORT_MISMATCH" },
  );
  const rejected = spawnSync(
    process.execPath,
    [cli, "--job-dir", exported.jobDir, "--runtime-dir", runtimeDir],
    {
      input: JSON.stringify({
        action: "import-project",
        transferId: transfer(),
        resourceIds: [exported.result.bundle.id],
        path: "/tmp/arbitrary.zip",
        jobId: "path-test",
        scopeKey: scope,
      }),
      maxBuffer: 1024 ** 2,
    },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stdout.toString(), /INVALID_REQUEST/);
});
test("cancellation publishes no partial batch and releasing receipt leaves Host outputs intact", async () => {
  await assert.rejects(
    job(
      {
        action: "publish-project-media",
        transferId: importTransfer,
        bundleHash: imported.result.bundleHash,
        batchIndex: 1,
      },
      [],
      false,
      AbortSignal.abort(),
    ),
    { name: "AbortError" },
  );
  const released = await job({
    action: "discard-project-import",
    transferId: importTransfer,
    bundleHash: imported.result.bundleHash,
  });
  assert.equal(released.result.discarded, true);
  assert.ok((await readFile(join(imported.jobDir, imported.artifacts[0].file))).length > 0);
  await assert.rejects(
    job({
      action: "project-import-status",
      transferId: importTransfer,
      bundleHash: imported.result.bundleHash,
    }),
    { code: "IMPORT_DISCARDED" },
  );
});
