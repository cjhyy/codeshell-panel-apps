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
  symlink,
  stat,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { build } from "esbuild";
const root = fileURLToPath(new URL("../", import.meta.url)),
  hash = (data) => createHash("sha256").update(data).digest("hex");
let temp, api, cli, source, shared, base, baseSnapshot, left, right, leftSnapshot, rightSnapshot;
let counter = 0;
const banner = {
  js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
};
const deviceA = "11111111-1111-4111-8111-111111111111",
  deviceB = "22222222-2222-4222-8222-222222222222";
const document = (name) => ({
  schemaVersion: 2,
  timebase: 240000,
  id: "synced-project",
  name,
  revision: 0,
  assets: [
    {
      id: "original-wave",
      name: "原声音",
      kind: "audio",
      duration: 10,
      resourceId: "asset-origin",
      metadata: { mimeType: "audio/wav", sourcePath: "/original-machine/voice.wav" },
    },
  ],
  sequences: [
    {
      id: "sequence",
      name: "主序列",
      width: 64,
      height: 64,
      frameRate: { numerator: 24000, denominator: 1001 },
      background: "#000000",
      timelineMode: "free",
      tracks: [],
      clips: [],
      transitions: [],
      markers: [],
    },
  ],
  activeSequenceId: "sequence",
  exportProfiles: [],
});
async function folder(name) {
  const path = join(temp, name);
  await mkdir(path, { recursive: true });
  return path;
}
async function pack(doc) {
  const work = await folder(`pack-${++counter}`);
  return api.exportPortableProject({
    document: doc,
    workDir: work,
    sourceRoots: [temp],
    outputPath: join(work, "project.mimiproject"),
    signal: new AbortController().signal,
    resolveAsset: async () => ({ path: source }),
  });
}
async function snapshot(bundle, parents = [], note = "", deviceId = deviceA) {
  return api.createSnapshot({
    projectId: "synced-project",
    bundle: { sha256: bundle.sha256, bytes: bundle.bytes },
    parents,
    deviceId,
    createdAt: "2026-09-16T00:00:00.000Z",
    note,
  });
}
async function stage(directory, bundle) {
  const token = randomUUID(),
    path = join(directory, api.snapshotIncomingPath(token));
  await mkdir(dirname(path), { recursive: true });
  await copyFile(bundle.path, path);
  return token;
}
function command(directory, request, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: directory,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (out += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (err += chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      try {
        resolve({ code, ...JSON.parse(out), stderr: err });
      } catch (cause) {
        reject(Error(`bad CLI ${code}: ${out} ${err}`, { cause }));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
async function publish(directory, bundle, snapshotValue) {
  const token = await stage(directory, bundle),
    response = await command(directory, {
      action: "publish",
      snapshot: snapshotValue,
      incomingToken: token,
    });
  assert.equal(response.ok, true, JSON.stringify(response));
  return { token, response };
}
const history = (directory, after = null, inventory = null) =>
  command(directory, { action: "history", projectId: "synced-project", after, inventory });
before(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "editor-sync-runtime-")));
  shared = await folder("shared");
  const module = join(temp, "api.mjs");
  await build({
    stdin: {
      contents: `export * from './apps/video-studio/native/editor-runtime/bundle.ts';export * from './apps/video-studio/native/editor-sync/provider.ts';export * from './apps/video-studio/src/editor/snapshot-sync.ts';export * from './apps/video-studio/src/editor/sync-bridge.ts';`,
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
  cli = join(temp, "editor-sync.mjs");
  await build({
    entryPoints: [join(root, "apps/video-studio/native/editor-sync.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: cli,
    banner,
  });
  source = join(temp, "source.wav");
  const wav = Buffer.alloc(48);
  wav.write("RIFF");
  wav.writeUInt32LE(40, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(4, 40);
  wav.writeInt16LE(1000, 44);
  wav.writeInt16LE(-2000, 46);
  await writeFile(source, wav);
  base = await pack(document("共同起点"));
  baseSnapshot = await snapshot(base);
  await publish(shared, base, baseSnapshot);
});
after(async () => {
  await rm(temp, { recursive: true, force: true });
});
test("two actual native clients concurrently publish siblings in one selected directory without clobber", async () => {
  left = await pack(document("设备 A 修改"));
  right = await pack({ ...document("共同起点"), production: { note: "设备 B 添加了备注" } });
  leftSnapshot = await snapshot(left, [baseSnapshot.id], "left", deviceA);
  rightSnapshot = await snapshot(right, [baseSnapshot.id], "right", deviceB);
  const [a, b] = await Promise.all([
    publish(shared, left, leftSnapshot),
    publish(shared, right, rightSnapshot),
  ]);
  assert.equal(a.response.ok, true);
  assert.equal(b.response.ok, true);
  const listing = await history(shared);
  assert.equal(listing.ok, true);
  const graph = api.analyzeSnapshotGraph(listing.value.entries.map((value) => value.snapshot));
  assert.deepEqual(graph.heads, [leftSnapshot.id, rightSnapshot.id].sort());
  assert.equal(api.snapshotRelationship(graph, leftSnapshot.id, rightSnapshot.id).kind, "conflict");
  for (const item of [base, left, right])
    assert.equal(
      hash(await readFile(join(shared, api.snapshotBundlePath(item.sha256)))),
      item.sha256,
    );
});
test("retry the same publication receipt after native cleanup does not duplicate media or lose history", async () => {
  const token = randomUUID(),
    response = await command(shared, {
      action: "publish",
      snapshot: leftSnapshot,
      incomingToken: token,
    });
  assert.equal(response.ok, true, JSON.stringify(response));
  const listing = await history(shared);
  assert.equal(listing.value.total, 3);
  assert.equal((await readdir(join(shared, "mimi-sync/v1/bundles"))).length, 3);
});
test("explicit reviewed merge publishes a two-parent child while retaining both originals", async () => {
  const plan = api.planSnapshotMerge(document("共同起点"), document("设备 A 修改"), {
      ...document("共同起点"),
      production: { note: "设备 B 添加了备注" },
    }),
    merged = api.resolveSnapshotMerge(plan, {}),
    bundle = await pack(merged),
    record = await snapshot(bundle, [leftSnapshot.id, rightSnapshot.id], "两边审核合并");
  await publish(shared, bundle, record);
  const listing = await history(shared),
    graph = api.analyzeSnapshotGraph(listing.value.entries.map((value) => value.snapshot));
  assert.deepEqual(graph.heads, [record.id]);
  assert.equal(graph.snapshots.length, 4);
  const pulled = await command(shared, {
    action: "pull",
    projectId: "synced-project",
    snapshotId: record.id,
  });
  assert.equal(pulled.ok, true, JSON.stringify(pulled));
  const imported = await api.importPortableProject({
    inputPath: join(shared, pulled.value.bundle.path),
    workDir: await folder("roundtrip"),
    sourceRoots: [temp],
    signal: new AbortController().signal,
  });
  assert.equal(imported.document.name, "设备 A 修改");
  assert.equal(imported.document.production.note, "设备 B 添加了备注");
  assert.equal(imported.document.assets[0].metadata.sourcePath, "/original-machine/voice.wav");
  assert.deepEqual(await readFile(imported.media[0].path), await readFile(source));
});
test("external clients may propagate child JSON before parents and bundles; restoring missing bytes completes recovery", async () => {
  const replica = await folder("replica-device-B"),
    recordPath = await api.snapshotRecordPath(leftSnapshot);
  await mkdir(dirname(join(replica, recordPath)), { recursive: true });
  await copyFile(join(shared, recordPath), join(replica, recordPath));
  let listing = await history(replica);
  assert.equal(listing.value.entries[0].bundleState, "missing");
  assert.equal(
    api.analyzeSnapshotGraph(listing.value.entries.map((item) => item.snapshot)).complete,
    false,
  );
  let result = await command(replica, {
    action: "pull",
    projectId: "synced-project",
    snapshotId: leftSnapshot.id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MISSING_OBJECT");
  const parentPath = await api.snapshotRecordPath(baseSnapshot);
  await copyFile(join(shared, parentPath), join(replica, parentPath));
  await mkdir(dirname(join(replica, api.snapshotBundlePath(left.sha256))), { recursive: true });
  await copyFile(left.path, join(replica, api.snapshotBundlePath(left.sha256)));
  listing = await history(replica);
  assert.equal(
    api.analyzeSnapshotGraph(listing.value.entries.map((item) => item.snapshot)).complete,
    true,
  );
  result = await command(replica, {
    action: "pull",
    projectId: "synced-project",
    snapshotId: leftSnapshot.id,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  await rm(join(replica, api.snapshotBundlePath(left.sha256)));
  await publish(replica, left, leftSnapshot);
  assert.equal(
    (
      await command(replica, {
        action: "pull",
        projectId: "synced-project",
        snapshotId: leftSnapshot.id,
      })
    ).ok,
    true,
  );
});
test("missing parent cannot publish an orphan from local UI; malformed ZIP cannot create a snapshot", async () => {
  const isolated = await folder("isolated"),
    token = await stage(isolated, left),
    result = await command(isolated, {
      action: "publish",
      snapshot: leftSnapshot,
      incomingToken: token,
    });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MISSING_PARENT");
  const invalid = join(temp, "not-a-zip");
  await writeFile(invalid, "not a project ZIP");
  const bundle = { path: invalid, sha256: hash(await readFile(invalid)), bytes: 17 },
    record = await snapshot(bundle, [], "badzip");
  bundle.bytes = (await stat(invalid)).size;
  record.bundle.bytes = bundle.bytes;
  const validRecord = await snapshot(bundle, [], "badzip");
  const copy = await stage(isolated, bundle),
    bad = await command(isolated, {
      action: "publish",
      snapshot: validRecord,
      incomingToken: copy,
    });
  assert.equal(bad.ok, false);
  assert.equal((await history(isolated)).value.total, 0);
});
test("bad hashes, symlinks, poisoned immutable destinations and arbitrary JSON paths are rejected", async () => {
  const isolated = await folder("poisoned");
  await publish(isolated, base, baseSnapshot);
  const original = join(isolated, api.snapshotBundlePath(base.sha256)),
    data = await readFile(original);
  data[50] ^= 1;
  await writeFile(original, data);
  const failed = await command(isolated, {
    action: "pull",
    projectId: "synced-project",
    snapshotId: baseSnapshot.id,
  });
  assert.equal(failed.error.code, "BUNDLE_HASH_MISMATCH");
  const token = await stage(isolated, base),
    blocked = await command(isolated, {
      action: "publish",
      snapshot: baseSnapshot,
      incomingToken: token,
    });
  assert.equal(blocked.error.code, "IMMUTABLE_CONFLICT");
  assert.deepEqual(await readFile(original), data);
  const linkRoot = await folder("links");
  await mkdir(join(linkRoot, "mimi-sync"));
  await symlink(join(shared, "mimi-sync/v1"), join(linkRoot, "mimi-sync/v1"));
  assert.equal((await history(linkRoot)).ok, false);
  assert.equal(
    (
      await command(isolated, {
        action: "history",
        projectId: "synced-project",
        after: null,
        inventory: null,
        path: temp,
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await command(
        isolated,
        { action: "history", projectId: "synced-project", after: null, inventory: null },
        ["--root", temp],
      )
    ).ok,
    false,
  );
});
test("history reports damaged records and refuses a changing pagination inventory rather than skipping records", async () => {
  const directory = await folder("pages"),
    snapshots = [];
  for (let i = 0; i < 70; i++) {
    const record = await snapshot(base, [], `item-${i}`);
    snapshots.push(record);
    const path = join(directory, await api.snapshotRecordPath(record));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, api.snapshotCanonical(record));
  }
  const first = await history(directory);
  assert.equal(first.value.entries.length, 64);
  assert.equal(first.value.total, 70);
  const second = await history(directory, first.value.nextAfter, first.value.inventory);
  assert.equal(second.value.entries.length, 6);
  assert.equal(second.value.nextAfter, null);
  const extra = await snapshot(base, [], "extra");
  await writeFile(
    join(directory, await api.snapshotRecordPath(extra)),
    api.snapshotCanonical(extra),
  );
  assert.equal(
    (await history(directory, first.value.nextAfter, first.value.inventory)).error.code,
    "INVENTORY_CHANGED",
  );
  const bad = snapshots[0];
  await writeFile(
    join(directory, await api.snapshotRecordPath(bad)),
    JSON.stringify({ ...bad, note: "corrupted" }),
  );
  const refreshed = await history(directory);
  let issues = refreshed.value.issues;
  if (refreshed.value.nextAfter)
    issues = issues.concat(
      (await history(directory, refreshed.value.nextAfter, refreshed.value.inventory)).value.issues,
    );
  assert.ok(
    issues.some((issue) => issue.snapshotId === bad.id && issue.code === "SNAPSHOT_HASH_MISMATCH"),
  );
});
test("abort before work and discard affect only a named incoming transfer, never immutable history", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    api.runSyncRequest(
      shared,
      { action: "history", projectId: "synced-project", after: null, inventory: null },
      controller.signal,
    ),
  );
  const one = await stage(shared, base),
    two = await stage(shared, left);
  assert.equal((await command(shared, { action: "discard-incoming", token: one })).ok, true);
  await assert.rejects(stat(join(shared, api.snapshotIncomingPath(one))), { code: "ENOENT" });
  await stat(join(shared, api.snapshotIncomingPath(two)));
  assert.equal((await command(shared, { action: "discard-incoming", token: one })).ok, true);
  assert.equal((await history(shared)).value.total, 4);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function host(directory) {
  const handle = randomUUID(),
    executable = randomUUID(),
    entry = randomUUID(),
    processes = new Map(),
    resources = new Map(),
    calls = [],
    errors = [];
  const value = {
    cwd: "/same-authorized-workspace",
    calls,
    processes,
    resources,
    beforeMaterialize: undefined,
    beforeSpawn: undefined,
    corruptPage: false,
    materializations: 0,
    captures: 0,
    getContext: async () => ({
      cwd: value.cwd,
      availableMethods: [
        "filesystem.pickDirectory",
        "process.find",
        "process.resolveEntry",
        "process.spawn",
        "process.get",
        "process.cancel",
        "process.write",
        "process.end",
        "resources.materialize",
        "resources.capture",
        "resources.get",
      ],
      capabilities: {
        bridge: {
          maxParamsBytes: 65536,
          maxCallsPerWindow: 100000,
          maxTransferCallsPerWindow: 100000,
          rateWindowMs: 1000,
        },
      },
    }),
    on: () => () => {},
    async call(method, params) {
      calls.push({ method, params: structuredClone(params) });
      if (method === "filesystem.pickDirectory")
        return { handle, name: "用户选择的共享目录", path: "/untrusted-display-path" };
      if (method === "process.find") return { available: true, name: "node", handle: executable };
      if (method === "process.resolveEntry") {
        assert.equal(params.name, "editor-sync");
        assert.equal(params.executableHandle, executable);
        return { name: "editor-sync", handle: entry, sha256: hash(await readFile(cli)) };
      }
      if (method === "process.spawn") {
        assert.deepEqual(params, {
          executableHandle: executable,
          entryHandle: entry,
          directoryHandle: handle,
          args: [],
          stdin: "pipe",
        });
        await value.beforeSpawn?.();
        const processId = randomUUID(),
          child = spawn(process.execPath, [cli], {
            cwd: directory,
            stdio: ["pipe", "pipe", "pipe"],
          }),
          record = {
            processId,
            child,
            status: "running",
            sequence: 0,
            events: [],
            stdinBytes: 0,
            cancelRequested: false,
          };
        processes.set(processId, record);
        const event = (kind, payload) => {
          record.events.push({ sequence: ++record.sequence, event: kind, payload });
        };
        for (const stream of ["stdout", "stderr"])
          child[stream].setEncoding("utf8").on("data", (text) => {
            for (let offset = 0; offset < text.length; offset += 16384)
              event("process.output", { stream, text: text.slice(offset, offset + 16384) });
          });
        child.on("error", (cause) => errors.push(cause));
        child.on("close", (code, signal) => {
          record.status = "exited";
          record.code = code;
          record.signal = signal;
          event("process.exit", { code, signal });
        });
        return { processId };
      }
      if (method === "process.write") {
        const record = processes.get(params.processId),
          bytes = Buffer.byteLength(params.text);
        assert.ok(bytes <= 16 * 1024);
        await new Promise((resolve, reject) =>
          record.child.stdin.write(params.text, (error) => (error ? reject(error) : resolve())),
        );
        record.stdinBytes += bytes;
        return { bytesWritten: bytes, totalBytes: record.stdinBytes };
      }
      if (method === "process.end") {
        const record = processes.get(params.processId);
        record.child.stdin.end();
        return { ended: true, totalBytes: record.stdinBytes };
      }
      if (method === "process.get") {
        const record = processes.get(params.processId),
          events = record.events
            .filter((event) => event.sequence > params.afterSequence)
            .slice(0, params.limit),
          next = events.at(-1)?.sequence ?? params.afterSequence;
        return {
          found: true,
          processId: record.processId,
          truncated: value.corruptPage,
          status: record.status,
          nextSequence: next,
          sequence: record.sequence,
          hasMore: next < record.sequence,
          events,
          code: record.code,
          signal: record.signal,
          cancelRequested: record.cancelRequested,
        };
      }
      if (method === "process.cancel") {
        const record = processes.get(params.processId);
        if (record) {
          record.cancelRequested = true;
          record.child.kill("SIGTERM");
        }
        return { cancelled: true };
      }
      if (method === "resources.get") {
        assert.deepEqual(Object.keys(params), ["assetId"]);
        return { asset: resources.get(params.assetId)?.asset };
      }
      if (method === "resources.materialize") {
        assert.equal(params.directoryHandle, handle);
        assert.ok(/^mimi-sync\/v1\/incoming\/[a-f0-9-]+\.mimiproject$/.test(params.path));
        value.materializations++;
        await value.beforeMaterialize?.();
        const resource = resources.get(params.assetId),
          path = join(directory, params.path);
        await mkdir(dirname(path), { recursive: true });
        await copyFile(resource.path, path, 1);
        return {
          assetId: params.assetId,
          path: params.path,
          sha256: resource.asset.sha256,
          bytes: resource.asset.bytes,
        };
      }
      if (method === "resources.capture") {
        assert.equal(params.directoryHandle, handle);
        assert.equal(params.path, api.snapshotBundlePath(params.expectedSha256));
        const path = join(directory, params.path),
          data = await readFile(path);
        assert.equal(hash(data), params.expectedSha256);
        assert.equal(data.length, params.expectedBytes);
        const asset = {
          id: `asset-${hash(data)}`,
          sha256: hash(data),
          bytes: data.length,
          mimeType: "application/zip",
        };
        resources.set(asset.id, { asset, path });
        value.captures++;
        return { asset };
      }
      throw Error(`Unexpected method ${method}`);
    },
    add(bundle) {
      const asset = {
        id: `asset-${bundle.sha256}`,
        bytes: bundle.bytes,
        sha256: bundle.sha256,
        mimeType: "application/zip",
      };
      resources.set(asset.id, { asset, path: bundle.path });
      return asset;
    },
    async stop() {
      for (const record of processes.values())
        if (record.status !== "exited") record.child.kill("SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(errors, []);
    },
  };
  return value;
}
test("SDK bridge selects transient handle, publishes through actual native CLI, and captures a verified receiving resource", async () => {
  const directory = await folder("bridge-client"),
    panel = host(directory),
    bridge = api.createEditorSyncBridge(panel),
    grant = await bridge.pickDirectory();
  assert.deepEqual(grant, { handle: grant.handle, name: "用户选择的共享目录" });
  assert.equal(Object.hasOwn(grant, "path"), false);
  const asset = panel.add(base);
  let receipt;
  const published = await bridge.publish(
    grant,
    { snapshot: baseSnapshot, bundle: asset },
    {
      onReceipt: async (value) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.equal(panel.materializations, 0);
        receipt = value;
      },
    },
  );
  assert.equal(published.snapshot.id, baseSnapshot.id);
  assert.ok(receipt);
  assert.equal(panel.materializations, 1);
  const listing = await bridge.history(grant, "synced-project");
  assert.deepEqual(listing.graph.heads, [baseSnapshot.id]);
  const pulled = await bridge.readSnapshot(grant, "synced-project", baseSnapshot.id);
  assert.equal(pulled.bundle.id, asset.id);
  assert.equal(panel.captures, 1);
  await bridge.publish(grant, { snapshot: baseSnapshot, bundle: asset, receipt });
  assert.equal(panel.materializations, 1);
  await bridge.discardPublication(grant, receipt);
  assert.equal((await bridge.history(grant, "synced-project")).graph.snapshots.length, 1);
  bridge.dispose();
  await panel.stop();
});
test("durable receipt must finish saving before any materialization; failed save can resume an absent incoming file", async () => {
  const directory = await folder("bridge-receipt"),
    panel = host(directory),
    bridge = api.createEditorSyncBridge(panel),
    grant = await bridge.pickDirectory(),
    asset = panel.add(base);
  let receipt;
  await assert.rejects(
    bridge.publish(
      grant,
      { snapshot: baseSnapshot, bundle: asset },
      {
        onReceipt: async (value) => {
          receipt = value;
          throw Error("CAS storage rejected");
        },
      },
    ),
    /CAS storage/,
  );
  assert.equal(panel.materializations, 0);
  assert.equal(panel.calls.filter((call) => call.method === "process.spawn").length, 0);
  const result = await bridge.publish(grant, { snapshot: baseSnapshot, bundle: asset, receipt });
  assert.equal(result.snapshot.id, baseSnapshot.id);
  assert.equal(panel.materializations, 1);
  bridge.dispose();
  await panel.stop();
});
test("partial incoming recovery uses a fresh token and exact original resource without overwriting mismatched bytes", async () => {
  const directory = await folder("bridge-partial"),
    panel = host(directory),
    bridge = api.createEditorSyncBridge(panel),
    grant = await bridge.pickDirectory(),
    asset = panel.add(base),
    token = randomUUID(),
    receipt = { snapshot: baseSnapshot, token, bundle: asset, supersededTokens: [] };
  const old = join(directory, api.snapshotIncomingPath(token));
  await mkdir(dirname(old), { recursive: true });
  await writeFile(old, "partial cloud transfer");
  let saved;
  const result = await bridge.publish(
    grant,
    { snapshot: baseSnapshot, bundle: asset, receipt },
    {
      onReceipt: async (value) => {
        saved = value;
      },
    },
  );
  assert.notEqual(result.receipt.token, token);
  assert.deepEqual(saved.supersededTokens, [token]);
  assert.equal((await readFile(old)).toString(), "partial cloud transfer");
  assert.equal(panel.materializations, 1);
  await bridge.discardPublication(grant, result.receipt);
  await assert.rejects(stat(old), { code: "ENOENT" });
  bridge.dispose();
  await panel.stop();
});
test("cancel during materialization retains a resumable receipt and rejects concurrent operations", async () => {
  const directory = await folder("bridge-cancel"),
    panel = host(directory),
    bridge = api.createEditorSyncBridge(panel),
    grant = await bridge.pickDirectory(),
    asset = panel.add(base),
    gate = deferred(),
    entered = deferred(),
    controller = new AbortController();
  let receipt;
  panel.beforeMaterialize = async () => {
    entered.resolve();
    await gate.promise;
  };
  const pending = bridge.publish(
    grant,
    { snapshot: baseSnapshot, bundle: asset },
    {
      signal: controller.signal,
      onReceipt: (value) => {
        receipt = value;
      },
    },
  );
  await entered.promise;
  await assert.rejects(bridge.history(grant, "synced-project"), { code: "SYNC_BUSY" });
  controller.abort();
  gate.resolve();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal((await bridge.history(grant, "synced-project")).graph.snapshots.length, 0);
  panel.beforeMaterialize = undefined;
  await bridge.publish(grant, { snapshot: baseSnapshot, bundle: asset, receipt });
  assert.equal(panel.materializations, 1);
  bridge.dispose();
  await panel.stop();
});
test("late spawn after disposal is stopped, foreign grants and a changed workspace are rejected", async () => {
  const directory = await folder("bridge-dispose"),
    panel = host(directory),
    bridge = api.createEditorSyncBridge(panel),
    grant = await bridge.pickDirectory();
  await assert.rejects(bridge.history({ ...grant, handle: randomUUID() }, "synced-project"), {
    code: "DIRECTORY_GRANT_EXPIRED",
  });
  panel.cwd = "/different-workspace";
  await assert.rejects(bridge.history(grant, "synced-project"), { code: "WORKSPACE_CHANGED" });
  panel.cwd = "/same-authorized-workspace";
  const gate = deferred(),
    entered = deferred();
  panel.beforeSpawn = async () => {
    entered.resolve();
    await gate.promise;
  };
  const pending = bridge.history(grant, "synced-project");
  await entered.promise;
  bridge.dispose();
  gate.resolve();
  await assert.rejects(pending, { name: "AbortError" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(panel.calls.some((call) => call.method === "process.cancel"));
  await panel.stop();
});
test("lost process output and forged resume identity fail instead of displaying an incomplete history", async () => {
  const directory = await folder("bridge-output"),
    panel = host(directory),
    bridge = api.createEditorSyncBridge(panel),
    grant = await bridge.pickDirectory(),
    asset = panel.add(base);
  panel.corruptPage = true;
  await assert.rejects(bridge.history(grant, "synced-project"), { code: "INVALID_SYNC_RESPONSE" });
  panel.corruptPage = false;
  await assert.rejects(
    bridge.publish(grant, {
      snapshot: baseSnapshot,
      bundle: asset,
      receipt: {
        snapshot: baseSnapshot,
        token: randomUUID(),
        bundle: { ...asset, id: `asset-${"f".repeat(64)}` },
        supersededTokens: [],
      },
    }),
    { code: "RECEIPT_MISMATCH" },
  );
  assert.equal(panel.materializations, 0);
  bridge.dispose();
  await panel.stop();
});
