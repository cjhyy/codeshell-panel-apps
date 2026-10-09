import assert from "node:assert/strict";
import test from "node:test";
import { createBridgeTraffic } from "../apps/video-studio/src/sdk/bridge-traffic";
import { createWorkspaceDocumentBridge } from "../apps/video-studio/src/workspace-document-bridge";

// Match the public Host binding fields. Both project directories may be
// /workspace; projectId/environmentId are not part of the real Host contract.
function fixture() {
  let time = 0,
    sessionId = "session-a",
    armed = false,
    contextReads = 0;
  let onContextRead = () => {};
  const listeners = new Set<(value: unknown) => void>();
  const calls: Array<{ method: string; sessionId: string }> = [];
  const raw = {
    async getContext() {
      contextReads++;
      calls.push({ method: "context.get", sessionId });
      onContextRead();
      return {
        appId: "video-studio",
        cwd: "/workspace",
        sessionId,
        host: "hub",
        availableMethods: ["workspace.list", "workspace.readText", "workspace.writeText"],
        capabilities: {
          bridge: { rateWindowMs: 1000, maxCallsPerWindow: 2, maxTransferCallsPerWindow: 2 },
        },
      };
    },
    async call(method: string) {
      calls.push({ method, sessionId });
      return { accepted: true };
    },
    registerTool() { return () => {}; },
    on(name: string, listener: (value: unknown) => void) {
      if (name === "context.changed") listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  function changeBinding() {
    sessionId = "session-b";
    for (const listener of listeners) listener({ cwd: "/workspace", sessionId, host: "hub" });
    // Returning to A must not revive an admitted call that was waiting on quota.
    sessionId = "session-a";
    for (const listener of listeners) listener({ cwd: "/workspace", sessionId, host: "hub" });
  }
  const traffic = createBridgeTraffic(raw, {
    now: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
      if (armed) {
        armed = false;
        changeBinding();
      }
    },
    beforeDispatch: () => documents.assertActive(),
  });
  const documents = createWorkspaceDocumentBridge(traffic.bridge);
  return {
    documents, traffic, calls,
    arm() { armed = true; },
    armAfterNextContextRead() {
      const before = contextReads;
      onContextRead = () => {
        if (contextReads > before) {
          onContextRead = () => {};
          armed = true;
        }
      };
    },
    get time() { return time; },
  };
}

for (const method of ["workspace.writeText", "tasks.start", "context.get", "resources.read"]) {
  test(`binding invalidation during quota admission prevents final ${method} dispatch`, async () => {
    const f = fixture();
    try {
      await f.documents.getContext();
      // Fill the separate transfer bucket before delaying another resource read.
      if (method === "resources.read") await f.documents.call(method, { id: "old-resource" });
      const before = f.calls.length;
      if (method === "workspace.writeText") {
        // Let the mutation's fresh context read finish, then switch bindings
        // while the actual file write is queued behind that context request.
        f.armAfterNextContextRead();
      } else f.arm();
      await assert.rejects(
        method === "context.get"
          ? f.documents.getContext()
          : f.documents.call(method, {
              path: "old-project.json", content: "old draft", entry: "media-runtime", id: "old-resource",
            }),
        /项目或存储权限已改变/,
      );
      const admitted = f.calls.slice(before);
      assert.deepEqual(
        admitted.map((call) => call.method),
        method === "workspace.writeText" ? ["context.get"] : [],
        "the real Host must never receive the stale queued request",
      );
      assert.ok(f.time >= 1000, "the scenario must exercise the real admission wait");
      const finalCount = f.calls.length;
      await assert.rejects(f.documents.call("tasks.start", {}), /重新打开视频面板/);
      assert.equal(f.calls.length, finalCount, "A -> B -> A leaves the old bridge invalid");
    } finally {
      f.traffic.dispose();
    }
  });
}
