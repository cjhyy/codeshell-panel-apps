import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import { createFolderImport, validateFolderDocument } from "../apps/video-studio/src/folder-import";
import type { CapturedFolderAsset, FolderEntry } from "../apps/video-studio/src/folder-source";
import { FolderCaptureTimeoutError } from "../apps/video-studio/src/folder-source";
import { createProject, type Asset, type Project } from "../apps/video-studio/src/model";

const controllers = new Set<ReturnType<typeof createFolderImport>>();
afterEach(() => {
  for (const controller of controllers) controller.dispose();
  controllers.clear();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const pause = (ms = 1) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, message = "condition did not settle") {
  const deadline = Date.now() + 1500;
  while (!check() && Date.now() < deadline) await pause(2);
  assert.ok(check(), message);
}
function file(path: string, lastModified = 10, bytes = 100): FolderEntry {
  return { path, name: path.split("/").at(-1)!, bytes, lastModified, mimeType: "video/mp4" };
}
function resource(entry: FolderEntry): CapturedFolderAsset {
  const sha256 = createHash("sha256")
    .update(`${entry.path}:${entry.bytes}:${entry.lastModified}`)
    .digest("hex");
  return {
    id: `asset-${sha256}`,
    sha256,
    name: entry.name,
    bytes: entry.bytes,
    mimeType: entry.mimeType,
  };
}
function fixture(options: { intervalMs?: number; settleMs?: number } = {}) {
  let project = createProject("文件夹测试");
  project.id = "folder-project";
  let identity = "folder-project:1",
    ready = true,
    available = true,
    disposed = false;
  const store = new Map<string, unknown>();
  const writes: { key: string; value: any }[] = [];
  const scans: { handle: string; signal?: AbortSignal }[] = [];
  const captures: FolderEntry[] = [];
  const publications: FolderEntry[] = [];
  const listings = new Map<string, FolderEntry[]>();
  const picks: { handle: string; name: string }[] = [];
  const hooks: {
    pick?: () => Promise<{ handle: string; name: string } | undefined>;
    scan?: (
      handle: string,
      signal?: AbortSignal,
    ) => Promise<{ files: FolderEntry[]; skipped: number }>;
    capture?: (entry: FolderEntry, signal?: AbortSignal) => Promise<CapturedFolderAsset>;
    publish?: (entry: FolderEntry, current: () => boolean) => Promise<void>;
    write?: (key: string, value: any) => Promise<void>;
  } = {};
  const source = {
    available: async () => available,
    pick: async () => (hooks.pick ? hooks.pick() : picks.shift()),
    scan: async (handle: string, signal?: AbortSignal) => {
      scans.push({ handle, signal });
      return hooks.scan
        ? hooks.scan(handle, signal)
        : { files: structuredClone(listings.get(handle) ?? []), skipped: 0 };
    },
    capture: async (_handle: string, entry: FolderEntry, signal?: AbortSignal) => {
      captures.push(structuredClone(entry));
      return hooks.capture ? hooks.capture(entry, signal) : resource(entry);
    },
    dispose: () => {
      disposed = true;
    },
  };
  const controller = createFolderImport(
    source,
    {
      project: () => project,
      identity: () => identity,
      ready: () => ready,
      read: async (key) => structuredClone(store.get(key)),
      write: async (key, value) => {
        const snapshot = structuredClone(value);
        await hooks.write?.(key, snapshot);
        store.set(key, snapshot);
        writes.push({ key, value: snapshot });
      },
      publish: async (asset, entry, current) => {
        publications.push(structuredClone(entry));
        await hooks.publish?.(entry, current);
        assert.ok(current(), "a stale file must not be published");
        const existing = project.assets.find((item) => item.mediaId === asset.id);
        if (existing) return existing;
        const published: Asset = {
          id: `source-${project.assets.length + 1}`,
          name: entry.name,
          kind: "video",
          durationFrames: 90,
          size: entry.bytes,
          lastModified: entry.lastModified,
          mediaId: asset.id,
        };
        project = {
          ...project,
          revision: project.revision + 1,
          assets: [...project.assets, published],
        };
        return published;
      },
      changed: () => {},
    },
    { settleMs: options.settleMs ?? 0, intervalMs: options.intervalMs ?? 60_000 },
  );
  controllers.add(controller);
  return {
    controller,
    hooks,
    listings,
    picks,
    store,
    writes,
    scans,
    captures,
    publications,
    get project() {
      return project;
    },
    get disposed() {
      return disposed;
    },
    setReady(value: boolean) {
      ready = value;
    },
    setAvailable(value: boolean) {
      available = value;
    },
    setProject(value: Project, nextIdentity = `${value.id}:2`) {
      project = value;
      identity = nextIdentity;
    },
    document() {
      return store.get(`video-studio-folders-${project.id}`) as any;
    },
    id(index = 0): string {
      return this.document().folders[index].id;
    },
    async connect(entries: FolderEntry[], name = "素材目录", automatic = false) {
      const handle = `ephemeral-grant-${picks.length + listings.size}`;
      listings.set(handle, entries);
      picks.push({ handle, name });
      await controller.connect(automatic);
      return handle;
    },
  };
}

test("repeated scans skip successful files while nested names retain independent resources", async () => {
  const f = fixture();
  await f.controller.load();
  const entries = [file("甲/同名.mp4"), file("乙/同名.mp4")];
  await f.connect(entries);
  assert.equal(f.project.assets.length, 2);
  assert.notEqual(f.project.assets[0]!.mediaId, f.project.assets[1]!.mediaId);
  await f.controller.scan(f.id());
  await f.controller.scan(f.id());
  assert.equal(f.captures.length, 2);
  assert.equal(f.publications.length, 2);
  assert.deepEqual(
    f.document().folders[0].receipts.map((r: any) => r.path),
    entries.map((e) => e.path),
  );
  assert.deepEqual(f.project.clips, []);
});

test("capture and publication failures retry only failed files, preserving successful imports", async () => {
  const f = fixture();
  await f.controller.load();
  let captureFails = true,
    publishFails = true;
  f.hooks.capture = async (entry) => {
    if (entry.path === "capture.mp4" && captureFails) throw Error("temporary capture failure");
    return resource(entry);
  };
  f.hooks.publish = async (entry) => {
    if (entry.path === "publish.mp4" && publishFails) throw Error("temporary project save failure");
  };
  await f.connect([file("good.mp4"), file("capture.mp4"), file("publish.mp4")]);
  assert.equal(f.project.assets.length, 1);
  assert.match(f.controller.render(), /2 个失败/);
  captureFails = false;
  publishFails = false;
  await f.controller.scan(f.id());
  assert.equal(f.project.assets.length, 3);
  assert.equal(f.captures.filter((e) => e.path === "good.mp4").length, 1);
  assert.equal(f.publications.filter((e) => e.path === "good.mp4").length, 1);
  assert.equal(f.document().folders[0].receipts.length, 3);
  await f.controller.scan(f.id());
  assert.equal(f.project.assets.length, 3);
});

test("a slow original save shows its size and changes stage only after capture finishes", async () => {
  const f = fixture();
  const copied = deferred<CapturedFolderAsset>(),
    published = deferred<void>();
  await f.controller.load();
  f.hooks.capture = () => copied.promise;
  f.hooks.publish = () => published.promise;
  const entry = file("原片.mp4", 10, 1_500_000_000);
  const pending = f.connect([entry]);
  await until(() => f.captures.length === 1);
  assert.match(f.controller.render(), /正在保存原片 1\/1 · 1.50 GB（本轮共 1.50 GB）/);
  assert.equal(f.project.assets.length, 0);
  copied.resolve(resource(entry));
  await until(() => f.publications.length === 1);
  assert.match(f.controller.render(), /正在读取预览并保存工程 1\/1/);
  assert.equal(f.project.assets.length, 0);
  published.resolve();
  await pending;
  assert.equal(f.project.assets.length, 1);
  assert.match(f.controller.render(), /已导入 1 个/);
});

test("an uncertain capture timeout stops later copies and pauses automatic retry", async () => {
  const f = fixture({ intervalMs: 10 });
  await f.controller.load();
  f.hooks.capture = async (entry) => {
    if (entry.path === "large.mp4") throw new FolderCaptureTimeoutError();
    return resource(entry);
  };
  await f.connect([file("good.mp4"), file("large.mp4"), file("later.mp4")], "原片", true);
  assert.equal(f.project.assets.length, 1);
  assert.deepEqual(
    f.captures.map((entry) => entry.path),
    ["good.mp4", "large.mp4"],
  );
  assert.match(f.controller.render(), /已停止本轮导入/);
  assert.match(f.controller.render(), /后台可能仍在复制/);
  assert.match(f.controller.render(), /检查失败，自动导入已暂停/);
  assert.doesNotMatch(f.controller.render(), /点击立即检查重试/);
  const scans = f.scans.length;
  await pause(40);
  assert.equal(f.scans.length, scans);
  assert.equal(f.document().folders[0].receipts.length, 1);
});

test("modified files add a new source without changing clips or the old source", async () => {
  const f = fixture();
  await f.controller.load();
  const handle = await f.connect([file("原片.mp4")]);
  const previous = structuredClone(f.project.assets[0]!);
  const edited = structuredClone(f.project);
  edited.clips = [{ id: "clip", assetId: previous.id, inFrame: 10, outFrame: 80, volume: 0.5 }];
  edited.audioClips = [];
  f.setProject(edited, "folder-project:1");
  const clips = structuredClone(edited.clips);
  f.listings.set(handle, [file("原片.mp4", 20, 120)]);
  await f.controller.scan(f.id());
  assert.equal(f.project.assets.length, 2);
  assert.deepEqual(f.project.assets[0], previous);
  assert.deepEqual(f.project.clips, clips);
  assert.deepEqual(f.project.audioClips, []);
  assert.equal(f.document().folders[0].receipts.length, 1);
  assert.equal(f.document().folders[0].receipts[0].assetId, f.project.assets[1]!.id);
});

test("files still changing between the two scans wait until a later stable scan", async () => {
  const f = fixture();
  await f.controller.load();
  let n = 0;
  f.hooks.scan = async () => ({ files: [file("写入中.mp4", ++n, 100)], skipped: 0 });
  const handle = await f.connect([file("写入中.mp4")]);
  assert.equal(f.project.assets.length, 0);
  assert.match(f.controller.render(), /仍在写入/);
  f.hooks.scan = undefined;
  await f.controller.scan(f.id());
  assert.equal(f.project.assets.length, 1);
  assert.equal(f.scans.filter((item) => item.handle === handle).length, 4);
});

test("a late picker from an old project never creates a new project folder or scans it", async () => {
  const f = fixture();
  await f.controller.load();
  const picked = deferred<{ handle: string; name: string }>();
  f.hooks.pick = () => picked.promise;
  const pending = f.controller.connect(true);
  assert.equal(f.controller.busy, true);
  const next = createProject("另一个工程");
  next.id = "other";
  f.setProject(next);
  await f.controller.load();
  picked.resolve({ handle: "old-grant", name: "旧目录" });
  await pending;
  assert.equal(f.scans.length, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(f.project.assets.length, 0);
  assert.doesNotMatch(f.controller.render(), /旧目录/);
});

test("switching project during capture aborts and rejects late old-file publication", async () => {
  const f = fixture();
  await f.controller.load();
  const captured = deferred<CapturedFolderAsset>();
  let signal: AbortSignal | undefined;
  f.hooks.capture = async (entry, abort) => {
    signal = abort;
    return captured.promise;
  };
  const pending = f.connect([file("旧原片.mp4")]);
  await until(() => f.captures.length === 1);
  const next = createProject("新工程");
  next.id = "new-project";
  f.setProject(next);
  await f.controller.load();
  assert.equal(signal?.aborted, true);
  captured.resolve(resource(file("旧原片.mp4")));
  await pending;
  assert.equal(f.publications.length, 0);
  assert.equal(f.project.assets.length, 0);
  assert.equal(f.store.has("video-studio-folders-new-project"), false);
  assert.doesNotMatch(f.controller.render(), /旧原片/);
});

test("cancel stops current work, retains prior successful files and lets failed files retry", async () => {
  const f = fixture();
  await f.controller.load();
  const captured = deferred<CapturedFolderAsset>();
  let signal: AbortSignal | undefined;
  f.hooks.capture = async (entry, abort) => {
    if (entry.path === "second.mp4") {
      signal = abort;
      return captured.promise;
    }
    return resource(entry);
  };
  const pending = f.connect([file("first.mp4"), file("second.mp4")]);
  await until(() => f.captures.length === 2);
  await f.controller.action("folder-cancel");
  assert.equal(signal?.aborted, true);
  captured.resolve(resource(file("second.mp4")));
  await pending;
  assert.equal(f.project.assets.length, 1);
  assert.equal(f.document().folders[0].receipts.length, 1);
  assert.match(f.controller.render(), /已停止本次检查/);
  f.hooks.capture = undefined;
  await f.controller.scan(f.id());
  assert.equal(f.project.assets.length, 2);
  assert.equal(f.captures.filter((entry) => entry.path === "first.mp4").length, 1);
});

test("reopening keeps receipts but requires a new grant and never stores handles", async () => {
  const f = fixture();
  await f.controller.load();
  const handle = await f.connect([file("保留.mp4")]);
  const id = f.id();
  assert.ok(!JSON.stringify(f.writes).includes(handle));
  await f.controller.load();
  assert.match(f.controller.render(), /待重新连接/);
  await assert.rejects(f.controller.scan(id), /重新连接/);
  assert.equal(f.document().folders[0].receipts.length, 1);
  assert.equal(f.project.assets.length, 1);
  f.picks.push({ handle: "fresh-grant", name: "重连目录" });
  f.listings.set("fresh-grant", [file("保留.mp4")]);
  await f.controller.action("folder-reconnect", id);
  assert.equal(
    f.captures.length,
    2,
    "A new grant must rescan rather than trust an old name/receipt",
  );
  assert.equal(
    f.project.assets.length,
    1,
    "Host content identity prevents duplicate source insertion",
  );
  assert.equal(f.id(), id);
  assert.ok(!JSON.stringify(f.writes).includes("fresh-grant"));
});

test("paused and removed folders stop automatic scanning without deleting imported assets", async () => {
  const f = fixture({ intervalMs: 10 });
  await f.controller.load();
  const handle = await f.connect([file("初始.mp4")], "暂停目录", true);
  await f.controller.action("folder-toggle", f.id());
  f.listings.set(handle, [file("初始.mp4"), file("新增.mp4")]);
  const scans = f.scans.length;
  await pause(35);
  assert.equal(f.scans.length, scans);
  assert.equal(f.project.assets.length, 1);
  await f.controller.action("folder-scan", f.id());
  assert.equal(f.project.assets.length, 2);
  await f.controller.action("folder-remove", f.id());
  await pause(35);
  assert.equal(f.document().folders.length, 0);
  assert.equal(f.project.assets.length, 2);
  assert.doesNotMatch(f.controller.render(), /class="folder-connection"/);
});

test("every connected automatic folder gets checked rather than starving after the first folder", async () => {
  const f = fixture({ intervalMs: 12 });
  await f.controller.load();
  const first = await f.connect([], "目录甲", true),
    second = await f.connect([], "目录乙", true);
  f.listings.set(first, [file("甲.mp4")]);
  f.listings.set(second, [file("乙.mp4")]);
  await until(
    () => f.project.assets.length === 2,
    "both automatic folders must receive newly added files",
  );
  assert.deepEqual(f.project.assets.map((asset) => asset.name).sort(), ["乙.mp4", "甲.mp4"].sort());
});

test("the asset limit permits exactly 1000 and rejects a later addition without partial publication", async () => {
  const f = fixture();
  await f.controller.load();
  const seed = structuredClone(f.project);
  seed.assets = Array.from({ length: 999 }, (_, i) => ({
    id: `seed-${i}`,
    name: `${i}.mp4`,
    kind: "video",
    durationFrames: 30,
  }));
  f.setProject(seed, "folder-project:1");
  const handle = await f.connect([file("最后.mp4")]);
  assert.equal(f.project.assets.length, 1000);
  f.listings.set(handle, [file("最后.mp4"), file("超出.mp4")]);
  await f.controller.scan(f.id());
  assert.equal(f.project.assets.length, 1000);
  assert.equal(f.captures.length, 1);
  assert.match(f.controller.render(), /最多保存 1000 个素材/);
});

test("invalid stored records are preserved and cannot be overwritten by connecting", async () => {
  const f = fixture();
  const key = "video-studio-folders-folder-project";
  f.store.set(key, {
    schemaVersion: 1,
    projectId: "folder-project",
    folders: [{ id: "bad", name: "损坏", automatic: true, receipts: [{ path: "../outside.mp4" }] }],
  });
  const before = structuredClone(f.store.get(key));
  await f.controller.load();
  await assert.rejects(f.controller.connect(true), /持续连接需要桌面/);
  assert.deepEqual(f.store.get(key), before);
  assert.equal(f.writes.length, 0);
  assert.match(f.controller.render(), /记录无法恢复/);
});

test("folder record validation strips transient authorization and rejects oversized histories", () => {
  const doc = {
    schemaVersion: 1,
    projectId: "p",
    folders: [
      {
        id: "folder",
        name: "素材",
        automatic: true,
        handle: "secret-grant",
        absolutePath: "/private/path",
        receipts: [
          {
            path: "sub/a.mp4",
            bytes: 12,
            lastModified: 34,
            assetId: "asset-a",
            handle: "secret-file",
          },
        ],
      },
    ],
  };
  assert.equal(JSON.stringify(validateFolderDocument(doc, "p")).includes("secret"), false);
  assert.equal(JSON.stringify(validateFolderDocument(doc, "p")).includes("/private"), false);
  assert.throws(() =>
    validateFolderDocument(
      {
        ...doc,
        folders: Array.from({ length: 9 }, (_, i) => ({ ...doc.folders[0], id: `folder-${i}` })),
      },
      "p",
    ),
  );
  assert.throws(() =>
    validateFolderDocument(
      {
        ...doc,
        folders: [
          {
            ...doc.folders[0],
            receipts: Array.from({ length: 1001 }, (_, i) => ({
              ...doc.folders[0]!.receipts[0],
              path: `${i}.mp4`,
            })),
          },
        ],
      },
      "p",
    ),
  );
});

test("concurrent scans are coalesced and an unavailable editor delays automatic work", async () => {
  const f = fixture({ intervalMs: 10 });
  await f.controller.load();
  const handle = await f.connect([], "自动目录", true);
  f.setReady(false);
  const before = f.scans.length;
  f.listings.set(handle, [file("等待编辑.mp4")]);
  await pause(30);
  assert.equal(f.scans.length, before);
  assert.equal(f.project.assets.length, 0);
  f.setReady(true);
  await until(() => f.project.assets.length === 1 && !f.controller.busy);
  await f.controller.action("folder-toggle", f.id());
  const blocked = deferred<{ files: FolderEntry[]; skipped: number }>();
  f.hooks.scan = () => blocked.promise;
  const first = f.controller.scan(f.id());
  await until(() => f.controller.busy);
  const started = f.scans.length;
  await f.controller.scan(f.id());
  assert.equal(f.scans.length, started, "Only one listing process can be in progress");
  await f.controller.action("folder-cancel");
  blocked.resolve({ files: [], skipped: 0 });
  await first;
  assert.equal(f.controller.busy, false);
});

test("a failed receipt write leaves published sources intact and retries converge by resource identity", async () => {
  const f = fixture();
  await f.controller.load();
  let fail = true;
  f.hooks.write = async (_key, value) => {
    if (fail && value.folders.some((folder: any) => folder.receipts.length))
      throw Error("receipt store temporarily unavailable");
  };
  await f.connect([file("已保存原片.mp4")]);
  const published = structuredClone(f.project.assets[0]);
  assert.equal(f.project.assets.length, 1);
  assert.match(f.controller.render(), /1 个失败/);
  assert.equal(f.document().folders[0].receipts.length, 0);
  fail = false;
  await f.controller.scan(f.id());
  assert.equal(f.project.assets.length, 1);
  assert.deepEqual(f.project.assets[0], published);
  assert.equal(f.document().folders[0].receipts[0].assetId, published!.id);
  const captures = f.captures.length;
  await f.controller.scan(f.id());
  assert.equal(f.captures.length, captures);
});

test("disposing a pending scan aborts work and cannot publish later or retain its timer", async () => {
  const f = fixture({ intervalMs: 10 });
  await f.controller.load();
  const blocked = deferred<{ files: FolderEntry[]; skipped: number }>();
  let signal: AbortSignal | undefined;
  f.hooks.scan = async (_handle, abort) => {
    signal = abort;
    return blocked.promise;
  };
  const pending = f.connect([file("迟到素材.mp4")], "关闭目录", true);
  await until(() => f.scans.length === 1);
  f.controller.dispose();
  assert.equal(f.disposed, true);
  assert.equal(signal?.aborted, true);
  blocked.resolve({ files: [file("迟到素材.mp4")], skipped: 0 });
  await pending;
  const scans = f.scans.length;
  await pause(30);
  assert.equal(f.scans.length, scans);
  assert.equal(f.publications.length, 0);
});

test("at most eight connections are admitted and a cancelled picker does not change records", async () => {
  const f = fixture();
  await f.controller.load();
  await f.controller.connect(true);
  assert.equal(f.writes.length, 0);
  for (let i = 0; i < 8; i++) await f.connect([], `目录${i}`);
  const before = structuredClone(f.document());
  await assert.rejects(f.controller.connect(true), /最多保留 8 个/);
  assert.deepEqual(f.document(), before);
  assert.equal(f.controller.busy, false);
});

test("a failed automatic scan stays suspended until a successful manual retry restores watching", async () => {
  const f = fixture({ intervalMs: 10 });
  await f.controller.load();
  f.hooks.scan = async () => {
    throw Error("execution permission declined");
  };
  const handle = await f.connect([], "需重新授权目录", true);
  assert.match(f.controller.render(), /检查失败，自动导入已暂停/);
  assert.equal(
    f.document().folders[0].automatic,
    true,
    "Keep the user's preference without repeating denied work",
  );
  const failedScans = f.scans.length;
  await pause(40);
  assert.equal(
    f.scans.length,
    failedScans,
    "No new execution attempt or permission prompt occurs automatically",
  );
  f.hooks.scan = undefined;
  await f.controller.action("folder-scan", f.id());
  assert.doesNotMatch(f.controller.render(), /检查失败，自动导入已暂停/);
  f.listings.set(handle, [file("恢复后新增.mp4")]);
  await until(() => f.project.assets.length === 1 && !f.controller.busy);
  assert.equal(f.project.assets[0]!.name, "恢复后新增.mp4");
});
