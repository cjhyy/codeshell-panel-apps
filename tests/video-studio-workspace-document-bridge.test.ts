import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createWorkspaceDocumentBridge } from "../apps/video-studio/src/workspace-document-bridge";
import { createBridgeTraffic } from "../apps/video-studio/src/sdk/bridge-traffic";
import { createMediaTaskBridge } from "../apps/video-studio/src/media-task-bridge";
import { ProductionController } from "../apps/video-studio/src/production";
import { createProject } from "../apps/video-studio/src/model";
import videoManifest from "../apps/video-studio/.codeshell-panel/panel.json";
const hash = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const sourceId = `asset-${"a".repeat(64)}`;
function cloud() {
  const files = new Map<string, string>(),
    jobs = new Map<string, any>(),
    calls: any[] = [];
  const state = {
    projectId: "a" as string | undefined,
    sessionId: "session-a",
    desktop: false,
    afterRead: undefined as undefined | (() => void),
  };
  const raw = {
    async getContext() {
      return {
        cwd: "/workspace",
        projectId: state.projectId,
        ...(videoManifest.permissions.includes("context.session")
          ? { sessionId: state.sessionId }
          : {}),
        host: "hub",
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

test("real Host session bindings distinguish cloud projects sharing /workspace", async () => {
  assert.ok(
    videoManifest.permissions.includes("context.session"),
    "Host session IDs require this reviewed permission",
  );
  const f = cloud();
  f.state.projectId = undefined; // Published Host contexts have no projectId.
  const bridge = createWorkspaceDocumentBridge(f.raw);
  await bridge.getContext();
  f.state.sessionId = "session-b";
  await assert.rejects(
    bridge.call("workspace.writeText", {
      path: "must-not-write.json",
      content: "old draft",
      expectedModifiedAt: null,
    }),
    /项目或存储权限已改变/,
  );
  assert.equal(f.calls.length, 0);
  f.state.sessionId = "session-a";
  await assert.rejects(
    bridge.call("workspace.writeText", {
      path: "must-not-revive.json",
      content: "old draft",
      expectedModifiedAt: null,
    }),
    /项目或存储权限已改变/,
  );
  assert.equal(f.calls.length, 0);
});

test("observed binding changes remain invalid after switching back and stop task dispatch", async () => {
  const f = cloud();
  let changed: (payload: unknown) => void = () => {};
  const bridge = createWorkspaceDocumentBridge({
    ...f.raw,
    on(name, listener) {
      if (name === "context.changed") changed = listener;
      return () => {};
    },
  });
  await bridge.getContext();
  changed({ visible: false, busy: true });
  changed({ visible: true, busy: false });
  await bridge.call("workspace.list", { path: "." });
  changed({ cwd: "/workspace", sessionId: "session-b" });
  changed({ cwd: "/workspace", sessionId: "session-a" });
  const before = f.calls.length;
  await assert.rejects(bridge.call("tasks.start", { entry: "media-runtime" }), /重新打开视频面板/);
  await assert.rejects(bridge.getContext(), /重新打开视频面板/);
  assert.equal(f.calls.length, before);
});

test("a stale initial context cannot bind the editor after a newer context event", async () => {
  const f = cloud();
  let changed: (payload: unknown) => void = () => {};
  let finish: (value: Awaited<ReturnType<typeof f.raw.getContext>>) => void = () => {};
  const old = await f.raw.getContext();
  const bridge = createWorkspaceDocumentBridge({
    ...f.raw,
    getContext: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    on(name, listener) {
      if (name === "context.changed") changed = listener;
      return () => {};
    },
  });
  const discovery = bridge.getContext();
  changed({ cwd: "/workspace", sessionId: "session-b" });
  finish(old);
  await assert.rejects(discovery, /重新打开视频面板/);
  await assert.rejects(
    bridge.call("workspace.writeText", {
      path: "must-not-write.json",
      content: "old",
      expectedModifiedAt: null,
    }),
    /重新打开视频面板/,
  );
  assert.equal(f.calls.length, 0);
});

test("a result completed after a binding change is not published to the next project", async () => {
  const f = cloud();
  let changed: (payload: unknown) => void = () => {},
    finish: () => void = () => {};
  const bridge = createWorkspaceDocumentBridge({
    ...f.raw,
    on(name, listener) {
      if (name === "context.changed") changed = listener;
      return () => {};
    },
    call: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { assets: [] };
    },
  });
  await bridge.getContext();
  const reading = bridge.call("resources.list", {});
  changed({ sessionId: "session-b" });
  finish();
  await assert.rejects(reading, /重新打开视频面板/);
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

test("a project change after the final read prevents publishing a stale document to the UI", async () => {
  const f = cloud(),
    bridge = createWorkspaceDocumentBridge(f.raw);
  await bridge.call("media.document.set", {
    key: "draft",
    baseRevision: 0,
    data: { saved: 1 },
    label: "first",
  });
  const original = f.raw.call;
  f.raw.call = async (method, params) => {
    const result = await original(method, params);
    if (method === "workspace.readText" && params.path.includes("/parts/")) f.state.projectId = "b";
    return result;
  };
  await assert.rejects(bridge.call("media.document.get", { key: "draft" }), /项目或存储权限已改变/);
  assert.ok([...f.files.keys()].every((key) => key.startsWith("a:")));
});

test("multiple modules and fresh context checks share the actual Host admission budget", async () => {
  let clock = 0,
    projectId = "a";
  const calls: Array<{ time: number; method: string }> = [];
  const stamp = (method: string) => {
    const inWindow = calls.filter((call) => call.time > clock - 1000);
    assert.ok(inWindow.length < 4, "actual Host quota must not be exceeded by combined consumers");
    calls.push({ time: clock, method });
  };
  const traffic = createBridgeTraffic(
    {
      async getContext() {
        stamp("context.get");
        return {
          projectId,
          capabilities: {
            bridge: {
              rateWindowMs: 1000,
              maxCallsPerWindow: 4,
            },
          },
        };
      },
      async call(method) {
        stamp(method);
        return projectId;
      },
      on() {
        return () => {};
      },
      registerTool() {
        return () => {};
      },
    } as any,
    {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    },
  );
  const first = (await traffic.bridge.getContext()) as any;
  assert.equal(first.projectId, "a");
  projectId = "b";
  const values = await Promise.all([
    traffic.bridge.call("workspace.readText", { path: "a" }),
    traffic.bridge.getContext(),
    traffic.bridge.call("tasks.list"),
    traffic.bridge.getContext(),
    traffic.bridge.call("workspace.writeText", { path: "b", content: "saved" }),
  ]);
  assert.equal((values[1] as any).projectId, "b");
  assert.equal((values[3] as any).projectId, "b");
  assert.equal(calls.filter((call) => call.method === "workspace.writeText").length, 1);
  assert.ok(clock >= 2000);
  traffic.dispose();
});

test("only explicit pre-dispatch rate refusals can replay; uncertain writes never repeat", async () => {
  let clock = 0,
    accepted = 0,
    attempts = 0;
  const traffic = createBridgeTraffic(
    {
      async getContext() {
        return {};
      },
      async call() {
        throw new Error("callResult expected");
      },
      async callResult() {
        attempts++;
        if (attempts === 1)
          return { ok: false, error: { code: "RATE_LIMITED", message: "wait", retryAfterMs: 50 } };
        accepted++;
        return { ok: true, value: "saved" };
      },
      on() {
        return () => {};
      },
      registerTool() {
        return () => {};
      },
    } as any,
    {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    },
  );
  assert.equal(await traffic.bridge.call("workspace.writeText", {}), "saved");
  assert.equal(accepted, 1);
  assert.equal(attempts, 2);
  assert.equal(clock, 50);
  traffic.dispose();
  let writes = 0;
  const uncertain = createBridgeTraffic({
    async getContext() {
      return {};
    },
    async call() {
      writes++;
      throw new Error("reply lost after commit");
    },
    on() {
      return () => {};
    },
    registerTool() {
      return () => {};
    },
  });
  await assert.rejects(uncertain.bridge.call("workspace.writeText", {}), /reply lost/);
  assert.equal(writes, 1);
  uncertain.dispose();
});

test("cancellation bypasses queued mutations and disposal prevents their dispatch", async () => {
  let release!: () => void;
  const calls: any[] = [];
  const traffic = createBridgeTraffic(
    {
      async getContext() {
        return { capabilities: { bridge: { rateWindowMs: 1000, maxCallsPerWindow: 2 } } };
      },
      async call(method, params) {
        calls.push({ method, params });
        return true;
      },
      on() {
        return () => {};
      },
      registerTool() {
        return () => {};
      },
    } as any,
    {
      now: () => 0,
      sleep: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    },
  );
  const pending = traffic.bridge.call("workspace.writeText", { path: "old", content: "original" });
  const refused = assert.rejects(pending, /取消/);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  await traffic.bridge.call("tasks.cancel", { id: "running" });
  assert.deepEqual(calls, [{ method: "tasks.cancel", params: { id: "running" } }]);
  traffic.dispose();
  release();
  await refused;
  assert.equal(calls.length, 1);
});
