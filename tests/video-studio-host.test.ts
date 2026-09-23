import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createProjectStore,
  createProjectArchiveStore,
  parseProposal,
  parseTaskResultJson,
} from "../apps/video-studio/src/host.ts";
import { createProject, type Project } from "../apps/video-studio/src/model.ts";

test("failed or malformed restoration protects the original store from later saves", async () => {
  for (const original of [false, 0, "", { schemaVersion: 99 }, new Error("storage offline")]) {
    let writes = 0;
    const store = createProjectStore({
      async read() {
        if (original instanceof Error) throw original;
        return original;
      },
      async write() {
        writes += 1;
      },
    });
    await assert.rejects(store.load());
    await assert.rejects(store.save(createProject()), /阻止自动覆盖/);
    await assert.rejects(store.save(createProject()), /阻止自动覆盖/);
    assert.equal(writes, 0);
  }
});

test("save before restore still checks existing data, and invalid projects never write", async () => {
  let writes = 0;
  const store = createProjectStore({
    async read() {
      return { corrupt: true };
    },
    async write() {
      writes += 1;
    },
  });
  await assert.rejects(store.save(createProject()), /阻止自动覆盖/);
  await assert.rejects(store.save({ ...createProject(), fps: 24 } as unknown as Project));
  assert.equal(writes, 0);
});

test("autosaves serialize snapshots and recover after a failed write", async () => {
  const saved: Project[] = [];
  let releaseFirst!: () => void;
  const firstWrite = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let attempts = 0;
  const store = createProjectStore({
    async read() {
      return null;
    },
    async write(project) {
      attempts += 1;
      if (attempts === 1) {
        await firstWrite;
        throw new Error("quota exceeded");
      }
      saved.push(project);
    },
  });
  assert.equal(await store.load(), null);
  const first = createProject("首次保存");
  const second = createProject("第二次保存");
  const pendingFirst = store.save(first);
  const rejected = assert.rejects(pendingFirst, /quota exceeded/);
  const pendingSecond = store.save(second);
  second.name = "排队后修改";
  releaseFirst();
  await rejected;
  await pendingSecond;
  assert.equal(attempts, 2);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]!.name, "第二次保存");
  const restored = (await store.load())!;
  restored.name = "修改加载结果";
  assert.equal((await store.load())!.name, "第二次保存");
});

test("valid restored projects are detached from storage and caller mutations", async () => {
  const original = createProject("已保存");
  const store = createProjectStore({
    async read() {
      return original;
    },
    async write() {},
  });
  const restored = (await store.load())!;
  restored.name = "本地更改";
  original.name = "适配器更改";
  assert.equal((await store.load())!.name, "已保存");
});

test("proposals preserve request identity and detach reviewed operations", () => {
  const source = {
    projectId: "project-123",
    requestToken: "request-123",
    baseRevision: 7,
    title: "精简方案",
    explanation: "待审阅",
    operations: [{ type: "remove", clipId: "clip-1" }],
  };
  const proposal = parseProposal(source);
  source.operations[0]!.clipId = "clip-2";
  assert.deepEqual(proposal.operations, [{ type: "remove", clipId: "clip-1" }]);
  assert.equal(proposal.projectId, "project-123");
  assert.equal(proposal.requestToken, "request-123");
  assert.deepEqual(
    parseProposal(parseTaskResultJson("```json\n" + JSON.stringify(proposal) + "\n```")),
    proposal,
  );
});

test("proposal parsing rejects malformed identities, revisions and outer fields", () => {
  const base = {
    baseRevision: 0,
    title: "方案",
    operations: [{ type: "remove", clipId: "clip-1" }],
  };
  for (const input of [
    [],
    null,
    { ...base, baseRevision: -1 },
    { ...base, baseRevision: Infinity },
    { ...base, baseRevision: Number.MAX_SAFE_INTEGER },
    { ...base, operations: [] },
    { ...base, projectId: "" },
    { ...base, requestToken: "token\ncommand" },
    { ...base, title: "多\n行" },
    { ...base, explanation: "\u0000" },
    { ...base, arbitrary: true },
  ])
    assert.throws(() => parseProposal(input));
  assert.throws(() => parseTaskResultJson("x".repeat(1_000_001)));
});

test("proposal diagnostics identify the invalid field without relaxing validation", () => {
  const base = {
    baseRevision: 0,
    title: "没有符合目标的保留段",
    explanation: "已检查原片，当前没有需要保留的内容",
    operations: [{ type: "rough-cuts", cuts: [] }],
  };
  for (const baseRevision of [undefined, null, "0", -1, 0.5, Number.MAX_SAFE_INTEGER])
    assert.throws(() => parseProposal({ ...base, baseRevision }), /baseRevision.*非负整数/);
  for (const title of [undefined, null, "", "  ", "多\n行", "长".repeat(201)])
    assert.throws(() => parseProposal({ ...base, title }), /title.*单行非空文本/);
  for (const operations of [undefined, null, {}, [], Array(101).fill(base.operations[0])])
    assert.throws(() => parseProposal({ ...base, operations }), /operations.*1–100/);
  assert.deepEqual(parseProposal(base), base, "Zero candidates still use one explicit operation");
});

test("project archives retain ten distinct IDs in most recently saved order", async () => {
  let stored: Project[] = [];
  const archive = createProjectArchiveStore(
    {
      async read() {
        return stored;
      },
      async write(projects) {
        stored = projects;
      },
    },
    async () => null,
  );
  const projects = Array.from({ length: 12 }, (_, index) => createProject(`工程 ${index}`));
  for (const project of projects) await archive.archive(project);
  assert.deepEqual(
    (await archive.list()).map((project) => project.id),
    projects
      .slice(2)
      .reverse()
      .map((project) => project.id),
  );
  const updated = { ...projects[7]!, name: "更新名称", revision: 3 };
  await archive.archive(updated);
  updated.name = "外部后续修改";
  const recent = await archive.list();
  assert.equal(recent.length, 10);
  assert.equal(recent[0]!.id, projects[7]!.id);
  assert.equal(recent[0]!.name, "更新名称");
  assert.equal(recent[0]!.revision, 3);
  assert.equal(new Set(recent.map((project) => project.id)).size, 10);
  recent[0]!.name = "修改返回列表";
  stored[0]!.name = "修改适配器返回值";
  assert.equal((await archive.list())[0]!.name, "更新名称");
});

test("archive writes serialize snapshots, and a failed write preserves stored and cached projects", async () => {
  const original = createProject("原始工程");
  let stored = [original];
  let release!: () => void;
  let attempts = 0;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const archive = createProjectArchiveStore(
    {
      async read() {
        return stored;
      },
      async write(projects) {
        attempts += 1;
        if (attempts === 1) {
          await waiting;
          throw new Error("disk full");
        }
        stored = projects;
      },
    },
    async () => null,
  );
  await archive.list();
  const first = createProject("保存失败的工程");
  const rejected = assert.rejects(archive.archive(first), /disk full/);
  release();
  await rejected;
  assert.deepEqual(stored, [original]);
  assert.deepEqual(await archive.list(), [original]);
  const second = createProject("第二份工程");
  const third = createProject("第三份工程");
  const pendingSecond = archive.archive(second);
  const pendingThird = archive.archive(third);
  third.name = "入队后改名";
  await Promise.all([pendingSecond, pendingThird]);
  assert.deepEqual(
    (await archive.list()).map((project) => project.name),
    ["第三份工程", "第二份工程", "原始工程"],
  );
  assert.equal(first.name, "保存失败的工程");
});

test("archive checks failed autosave recovery before reading or changing archive storage", async () => {
  let reads = 0,
    writes = 0;
  const archive = createProjectArchiveStore(
    {
      async read() {
        reads += 1;
        return [];
      },
      async write() {
        writes += 1;
      },
    },
    async () => {
      throw new Error("cannot restore");
    },
  );
  await assert.rejects(archive.archive(createProject()), /阻止切换工程/);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test("malformed or duplicate archive data is preserved without writes", async () => {
  const project = createProject();
  for (const stored of [false, {}, Array(1), [project, project], Array(11).fill(project)]) {
    let writes = 0;
    const archive = createProjectArchiveStore(
      {
        async read() {
          return stored;
        },
        async write() {
          writes += 1;
        },
      },
      async () => null,
    );
    await assert.rejects(archive.list());
    await assert.rejects(archive.archive(createProject()));
    assert.equal(writes, 0);
  }
});

function captionHeavyProject(count: number): Project {
  const project = createProject(`字幕工程 ${count}`);
  project.assets = [{ id: "demo", name: "示例", kind: "demo", durationFrames: 30 }];
  project.clips = [{ id: "clip", assetId: "demo", inFrame: 0, outFrame: 30, volume: 1 }];
  project.captions = Array.from({ length: count }, (_, index) => ({
    id: `caption-${index}`,
    startFrame: 0,
    endFrame: 30,
    text: "字".repeat(4_000),
  }));
  return project;
}

test("archive budget counts UTF-8 bytes, evicts oldest snapshots, and rejects oversized single projects", async () => {
  let stored: Project[] = [];
  let writes = 0;
  const archive = createProjectArchiveStore(
    {
      async read() {
        return stored;
      },
      async write(projects) {
        writes += 1;
        stored = projects;
      },
    },
    async () => null,
  );
  const first = captionHeavyProject(8),
    second = captionHeavyProject(8);
  assert.ok(JSON.stringify([first, second]).length < 128 * 1024);
  assert.ok(new TextEncoder().encode(JSON.stringify([first, second])).byteLength > 128 * 1024);
  await archive.archive(first);
  await archive.archive(second);
  assert.deepEqual(
    (await archive.list()).map((project) => project.id),
    [second.id],
  );
  const before = structuredClone(stored);
  await assert.rejects(archive.archive(captionHeavyProject(12)), /下载工程 JSON 备份/);
  assert.equal(writes, 2);
  assert.deepEqual(stored, before);
  assert.deepEqual(await archive.list(), before);
});

test("archive reserves space for an existing autosave in the host's shared quota", async () => {
  let writes = 0;
  const current = captionHeavyProject(15);
  const archive = createProjectArchiveStore(
    {
      async read() {
        return [];
      },
      async write() {
        writes += 1;
      },
    },
    async () => current,
  );
  await assert.rejects(archive.archive(captionHeavyProject(8)), /可用空间/);
  assert.equal(writes, 0);
});

// Exercise the production singleton exports with a fresh module for each legacy-storage scenario.
async function persistentArchiveFixture(
  t: TestContext,
  options: {
    document?: unknown;
    legacy?: unknown;
    documentError?: boolean;
    failWrite?: boolean;
  } = {},
) {
  const { build } = createRequire(join(process.cwd(), "package.json"))("esbuild");
  const directory = await mkdtemp(join(tmpdir(), "video-studio-archive-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundled = await build({
    entryPoints: [join(process.cwd(), "apps/video-studio/src/host.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  const path = join(directory, "host.mjs");
  await writeFile(path, bundled.outputFiles[0].contents);
  const host = await import(pathToFileURL(path).href);
  const calls: { method: string; params: any }[] = [];
  let archiveDocument: unknown =
    options.document === undefined ? null : structuredClone(options.document);
  let revision = 7;
  let failWrite = Boolean(options.failWrite);
  host.setPanelBridge({
    async call(method: string, params: any) {
      calls.push({ method, params: structuredClone(params) });
      if (method === "media.document.get") {
        if (params.key === "video-studio-current") return { revision: 1, data: createProject() };
        assert.equal(params.key, "video-studio-recent-v1");
        if (options.documentError) throw Error("document unavailable");
        return { revision, data: structuredClone(archiveDocument) };
      }
      if (method === "storage.get") {
        assert.equal(params.key, "video-studio-recent-v1");
        if (options.legacy instanceof Error) throw options.legacy;
        return structuredClone(options.legacy ?? null);
      }
      if (method === "media.document.set") {
        assert.equal(params.key, "video-studio-recent-v1");
        assert.equal(params.baseRevision, revision);
        if (failWrite) {
          failWrite = false;
          throw Error("archive write failed");
        }
        archiveDocument = structuredClone(params.data);
        return { revision: ++revision };
      }
      throw Error(`Unexpected migration write or method: ${method}`);
    },
  });
  host.enablePersistentStorage(true);
  return { host, calls, document: () => structuredClone(archiveDocument) };
}

test(
  "an empty document archive reads legacy projects and the next archive migrates them without a queue deadlock",
  { timeout: 5000 },
  async (t) => {
    const original = createProject();
    original.name = "以前保存的工程";
    const f = await persistentArchiveFixture(t, { legacy: [original] });
    assert.deepEqual(await f.host.listArchivedProjects(), [original]);
    assert.equal(
      f.calls.filter((c) => c.method.endsWith(".set")).length,
      0,
      "Reading migration data must not overwrite either store",
    );
    const next = createProject();
    next.name = "新的工程";
    const writing = f.host.archiveProject(next);
    const reading = f.host.listArchivedProjects();
    await writing;
    assert.deepEqual(await reading, [next, original]);
    assert.deepEqual(f.document(), [next, original]);
    assert.equal(f.calls.filter((c) => c.method === "storage.get").length, 1);
    assert.equal(f.calls.filter((c) => c.method === "storage.set").length, 0);
  },
);

test(
  "archiving before listing still preserves legacy snapshots on the first durable write",
  { timeout: 5000 },
  async (t) => {
    const original = createProject();
    const next = createProject();
    const f = await persistentArchiveFixture(t, { legacy: [original] });
    await f.host.archiveProject(next);
    assert.deepEqual(f.document(), [next, original]);
    assert.deepEqual(await f.host.listArchivedProjects(), [next, original]);
  },
);

test("an existing document archive including an empty list never reads or restores stale legacy history", async (t) => {
  for (const document of [[], [createProject()]]) {
    const f = await persistentArchiveFixture(t, {
      document,
      legacy: new Error("Legacy cache must not be read"),
    });
    assert.deepEqual(await f.host.listArchivedProjects(), document);
    assert.equal(f.calls.filter((c) => c.method === "storage.get").length, 0);
  }
});

test("unreadable or malformed legacy archives protect both stores from subsequent writes", async (t) => {
  for (const legacy of [
    new Error("legacy storage unavailable"),
    { broken: true },
    [createProject(), { schemaVersion: 99 }],
  ]) {
    const f = await persistentArchiveFixture(t, { legacy });
    await assert.rejects(f.host.listArchivedProjects());
    await assert.rejects(f.host.archiveProject(createProject()));
    await assert.rejects(f.host.listArchivedProjects());
    assert.equal(f.calls.filter((c) => c.method.endsWith(".set")).length, 0);
    assert.equal(
      f.calls.filter((c) => c.method === "storage.get").length,
      1,
      "A failed legacy read stays protected in the cache",
    );
    assert.equal(f.document(), null);
  }
});

test("a failed document read never falls back to or overwrites legacy storage", async (t) => {
  const f = await persistentArchiveFixture(t, { documentError: true, legacy: [createProject()] });
  await assert.rejects(f.host.listArchivedProjects(), /document unavailable/);
  await assert.rejects(f.host.archiveProject(createProject()), /document unavailable/);
  assert.equal(
    f.calls.filter((c) => c.method === "storage.get" || c.method.endsWith(".set")).length,
    0,
  );
});

test("a failed migration write retains old snapshots for a later successful retry", async (t) => {
  const original = createProject();
  const next = createProject();
  const f = await persistentArchiveFixture(t, { legacy: [original], failWrite: true });
  await assert.rejects(f.host.archiveProject(next), /archive write failed/);
  assert.deepEqual(await f.host.listArchivedProjects(), [original]);
  assert.equal(f.document(), null);
  await f.host.archiveProject(next);
  assert.deepEqual(f.document(), [next, original]);
  assert.equal(f.calls.filter((c) => c.method === "storage.get").length, 1);
});
