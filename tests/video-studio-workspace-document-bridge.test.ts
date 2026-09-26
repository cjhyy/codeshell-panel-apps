import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createWorkspaceDocumentBridge } from "../apps/video-studio/src/workspace-document-bridge";
import { createMediaTaskBridge } from "../apps/video-studio/src/media-task-bridge";
import { ProductionController } from "../apps/video-studio/src/production";
import { createProject } from "../apps/video-studio/src/model";
const hash = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const sourceId = `asset-${"a".repeat(64)}`;
function cloud() {
  const files = new Map<string, string>(),
    jobs = new Map<string, any>(),
    calls: any[] = [];
  const state = {
    projectId: "a",
    desktop: false,
    afterRead: undefined as undefined | (() => void),
  };
  const raw = {
    async getContext() {
      return {
        cwd: "/workspace",
        projectId: state.projectId,
        availableMethods: [
          "workspace.list",
          "workspace.readText",
          "workspace.writeText",
          "tasks.start",
          "tasks.get",
          "tasks.list",
          "tasks.cancel",
          "tasks.retry",
          "resources.get",
          "resources.read",
          ...(state.desktop
            ? ["media.document.get", "media.document.set", "media.document.versions"]
            : []),
        ],
        capabilities: { bridge: { maxCallsPerWindow: 100000 } },
      };
    },
    on() {
      return () => {};
    },
    registerTool() {
      return () => {};
    },
    async call(method: string, p: any = {}) {
      calls.push({ method, p: structuredClone(p), project: state.projectId });
      const prefix = state.projectId + ":",
        key = prefix + p.path;
      if (method === "workspace.list")
        return {
          path: p.path,
          truncated: false,
          entries: [...files.keys()]
            .filter((k) => k.startsWith(key + "/") && !k.slice(key.length + 1).includes("/"))
            .map((k) => ({ path: k.slice(prefix.length), kind: "file" })),
        };
      if (method === "workspace.readText") {
        if (!files.has(key)) throw new Error("ENOENT");
        const content = files.get(key)!;
        state.afterRead?.();
        return { path: p.path, content, revision: hash(content) };
      }
      if (method === "workspace.writeText") {
        if (
          p.expectedModifiedAt === null
            ? files.has(key)
            : hash(files.get(key) ?? "") !== p.expectedRevision
        )
          throw new Error("workspace file changed");
        files.set(key, p.content);
        return { path: p.path, revision: hash(p.content) };
      }
      if (method.startsWith("media.document")) {
        if (state.desktop) return { native: true, revision: 2, data: { native: true } };
        throw new Error("Unsupported Host method: " + method);
      }
      if (method === "credentials.connections.list") return { connections: [] };
      if (method === "tasks.start") {
        const request = p.input.request;
        const job = {
          id: randomUUID(),
          status: "succeeded",
          attempt: 1,
          createdAt: 1,
          updatedAt: 1,
          entry: { name: p.entry },
          input: p.input,
          result: {
            result: {
              assetId: request.params.assetId,
              inspection: { kind: "audio", durationSeconds: 2 },
              waveform: { peaks: [0.1] },
            },
            artifacts: [],
          },
        };
        jobs.set(job.id, job);
        return structuredClone(job);
      }
      if (method === "tasks.get") return structuredClone(jobs.get(p.id));
      if (method === "tasks.list")
        return [...jobs.values()].map(({ input, result, ...job }) => job);
      if (method === "resources.get")
        return {
          asset: {
            id: p.id,
            name: "source.wav",
            mimeType: "audio/wav",
            bytes: 4,
            sha256: "a".repeat(64),
          },
        };
      throw new Error("Unexpected method: " + method);
    },
  };
  return { raw, state, files, jobs, calls };
}
test("cloud preparation needs a document adapter and retains task recipe/results after reopening", async () => {
  const f = cloud(),
    unsupported = createMediaTaskBridge(f.raw);
  await assert.rejects(
    unsupported.bridge.call("media.prepare", { assetIds: [sourceId] }),
    /Unsupported Host method: media.document.get/,
  );
  unsupported.dispose();
  const first = createMediaTaskBridge(createWorkspaceDocumentBridge(f.raw));
  try {
    const job: any = await first.bridge.call("media.prepare", { assetIds: [sourceId] });
    assert.equal(job.jobs[0].status, "succeeded");
    assert.equal(f.jobs.size, 1);
  } finally {
    first.dispose();
  }
  assert.ok([...f.files.keys()].some((p) => p.includes("video-studio-native-media-v1/index.json")));
  const second = createMediaTaskBridge(createWorkspaceDocumentBridge(f.raw));
  try {
    const values: any = await second.bridge.call("media.jobs.list", {});
    const jobs = Array.isArray(values) ? values : values.jobs;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "succeeded");
    await second.bridge.call("media.jobs.get", { id: jobs[0].id });
    assert.equal(f.jobs.size, 1, "Restoring task results never starts another task");
    assert.ok([...f.files.keys()].some((p) => p.includes("video-studio-prepared-")));
  } finally {
    second.dispose();
  }
});
test("cloud production controller can persist and reopen its document without native media document methods", async () => {
  const f = cloud();
  for (let i = 0; i < 2; i++) {
    const media = createMediaTaskBridge(createWorkspaceDocumentBridge(f.raw));
    const production = new ProductionController(media.bridge, {
      getProject: () => createProject(),
      changed: () => {},
    } as any);
    try {
      await production.initialize();
      assert.equal(production.enabled, true);
      assert.equal(production.error, "");
      await production.setAuto(null);
    } finally {
      production.dispose();
      media.dispose();
    }
  }
  assert.ok([...f.files.keys()].some((p) => p.includes("video-studio-production/index.json")));
});
test("workspace documents advertise supported methods, preserve native desktop authority and reject stale revisions", async () => {
  const f = cloud(),
    a = createWorkspaceDocumentBridge(f.raw),
    b = createWorkspaceDocumentBridge(f.raw);
  assert.ok((await a.getContext()).availableMethods!.includes("media.document.versions"));
  await a.call("media.document.set", {
    key: "draft",
    baseRevision: 0,
    data: { saved: 1 },
    label: "first",
  });
  assert.deepEqual(((await b.call("media.document.get", { key: "draft" })) as any).data, {
    saved: 1,
  });
  await assert.rejects(
    b.call("media.document.set", {
      key: "draft",
      baseRevision: 0,
      data: { saved: 2 },
      label: "stale",
    }),
    /another|changed|冲突/i,
  );
  assert.equal(((await b.call("media.document.versions", { key: "draft" })) as any).length, 1);
  const native = cloud();
  native.state.desktop = true;
  assert.equal(
    (
      (await createWorkspaceDocumentBridge(native.raw).call("media.document.get", {
        key: "draft",
      })) as any
    ).native,
    true,
  );
  assert.equal(native.files.size, 0);
});
test("changing cloud projects with the same cwd stops an old document operation before it can publish", async () => {
  const f = cloud(),
    a = createWorkspaceDocumentBridge(f.raw);
  await a.call("media.document.set", {
    key: "draft",
    baseRevision: 0,
    data: { saved: 1 },
    label: "first",
  });
  f.state.afterRead = () => {
    f.state.projectId = "b";
  };
  await assert.rejects(
    a.call("media.document.set", {
      key: "draft",
      baseRevision: 1,
      data: { saved: 2 },
      label: "old",
    }),
    /项目或存储权限已改变/,
  );
  assert.ok([...f.files.keys()].every((k) => k.startsWith("a:")));
  f.state.afterRead = undefined;
  const b = createWorkspaceDocumentBridge(f.raw);
  assert.deepEqual(await b.call("media.document.get", { key: "draft" }), {
    revision: 0,
    data: null,
  });
});
test("a changed storage capability cannot silently choose another backend for an open document", async () => {
  const f = cloud(),
    a = createWorkspaceDocumentBridge(f.raw);
  await a.getContext();
  f.state.desktop = true;
  await assert.rejects(
    a.call("media.document.set", {
      key: "draft",
      baseRevision: 0,
      data: { saved: 1 },
      label: "first",
    }),
    /项目或存储权限已改变/,
  );
  assert.equal(f.files.size, 0);
});

test("queued document writes capture their original inputs before asynchronous discovery", async () => {
  const f = cloud(),
    getContext = f.raw.getContext;
  let release!: () => void;
  const waiting = new Promise<void>((done) => {
    release = done;
  });
  f.raw.getContext = async () => {
    await waiting;
    return getContext();
  };
  const bridge = createWorkspaceDocumentBridge(f.raw),
    input = { key: "draft", baseRevision: 0, data: { saved: 1 }, label: "first" };
  const saving = bridge.call("media.document.set", input);
  input.baseRevision = 9;
  input.data.saved = 2;
  release();
  await saving;
  assert.deepEqual(((await bridge.call("media.document.get", { key: "draft" })) as any).data, {
    saved: 1,
  });
});
