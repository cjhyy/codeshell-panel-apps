import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { commitNativeProjectSnapshot, supportsNativeProjectCommit } from "../../../apps/job-hunt-hq/app/native-project-commit.mjs";

const content = JSON.stringify({ schemaVersion: 2, profile: { name: "临时测试" } });
const revision = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const methods = ["workspace.writeText", "filesystem.getKnownDirectory", "process.find",
  "process.resolveEntry", "process.spawn", "process.write", "process.end", "process.get"];

function fixture(override = () => undefined) {
  const calls = [], staged = new Map(), processes = new Map();
  let active = true, nextId = 0;
  const host = {
    calls, staged, processes,
    deactivate() { active = false; },
    scope: { check() { if (!active) throw Object.assign(Error("project changed"), { code: "PROJECT_CHANGED" }); },
      async call(method, input) {
        calls.push({ method, input });
        const response = await override(method, input, host);
        if (response !== undefined) return response;
        if (method === "workspace.writeText") {
          assert.equal(input.expectedModifiedAt, null);
          assert.match(input.path, /^career-data\/panel-commits\/g-[a-f0-9]{32}\.json$/);
          assert.equal(staged.has(input.path), false);
          staged.set(input.path, input.content);
          return { path: input.path, size: Buffer.byteLength(input.content), modifiedAt: 10, revision: revision(input.content) };
        }
        if (method === "filesystem.getKnownDirectory") {
          assert.deepEqual(input, { name: "project" });
          return { handle: "directory-handle", path: "/private/temporary-project", name: "temporary-project" };
        }
        if (method === "process.find") {
          assert.deepEqual(input, { name: "node" });
          return { available: true, name: "node", handle: "executable-handle" };
        }
        if (method === "process.resolveEntry") {
          assert.deepEqual(input, { name: "job-hunt-cli", executableHandle: "executable-handle" });
          return { handle: "entry-handle", name: "job-hunt-cli", sha256: "a".repeat(64) };
        }
        if (method === "process.spawn") {
          assert.deepEqual(input, { executableHandle: "executable-handle", entryHandle: "entry-handle",
            directoryHandle: "directory-handle", args: [], stdin: "pipe" });
          const processId = `process-${++nextId}`;
          processes.set(processId, {});
          return { processId, executable: "node" };
        }
        if (method === "process.write") {
          assert.ok(Buffer.byteLength(input.text) < 16 * 1024);
          processes.get(input.processId).request = JSON.parse(input.text);
          return { bytesWritten: Buffer.byteLength(input.text), totalBytes: Buffer.byteLength(input.text) };
        }
        if (method === "process.end") {
          processes.get(input.processId).ended = true;
          return { ended: true, totalBytes: 200 };
        }
        if (method === "process.get") return host.receipt(input);
        assert.fail(`unexpected method: ${method}`);
      },
    },
    receipt({ processId, afterSequence = 0, limit = 128 }, changes = {}) {
      const process = processes.get(processId);
      assert.equal(process.ended, true);
      assert.equal(process.request.operation, "snapshot.commit");
      const source = staged.get(process.request.input.path);
      const result = { path: "job-hunt-panel.json", size: Buffer.byteLength(source), modifiedAt: 123.5, revision: revision(source) };
      const stdout = JSON.stringify(changes.response || { ok: true, result });
      const middle = Math.floor(stdout.length / 2);
      const events = [
        { event: "process.output", sequence: 1, payload: { processId, stream: "stdout", text: stdout.slice(0, middle), sequence: 1 } },
        { event: "process.output", sequence: 2, payload: { processId, stream: "stdout", text: stdout.slice(middle) + "\n", sequence: 2 } },
        { event: "process.exit", sequence: 3, payload: { processId, code: 0, signal: null, sequence: 3 } },
      ].filter(event => event.sequence > afterSequence).slice(0, limit);
      const nextSequence = events.at(-1)?.sequence ?? afterSequence;
      return { found: true, processId, status: "exited", code: 0, signal: null, startedAt: 1, exitedAt: 2,
        cancelRequested: false, sequence: 3, nextSequence, events, truncated: false, hasMore: nextSequence < 3,
        ...changes.receipt };
    },
  };
  return host;
}

test("native commits require real advertised methods and granted permissions", () => {
  assert.equal(supportsNativeProjectCommit({ availableMethods: methods }), true);
  assert.equal(supportsNativeProjectCommit({ availableMethods: methods, permissions: ["process", "workspace.write"] }), true);
  for (const method of methods) assert.equal(supportsNativeProjectCommit({ availableMethods: methods.filter(value => value !== method) }), false);
  for (const context of [{ apiVersion: 99 }, { availableMethods: [] }, { availableMethods: methods, permissions: [] },
    { availableMethods: methods, permissions: ["workspace.write"] }]) assert.equal(supportsNativeProjectCommit(context), false);
});

test("snapshot content is staged create-only and sent through the reviewed stdin entry", async () => {
  const host = fixture();
  const result = await commitNativeProjectSnapshot({ content, expectedRevision: `sha256:${"b".repeat(64)}`, expectedModifiedAt: 12, scope: host.scope });
  assert.deepEqual(result, { path: "job-hunt-panel.json", size: Buffer.byteLength(content), modifiedAt: 123.5, revision: revision(content) });
  assert.deepEqual(host.calls.map(call => call.method), methods);
  const request = host.processes.get("process-1").request;
  assert.deepEqual(request, { operation: "snapshot.commit", input: { path: [...host.staged.keys()][0], expectedRevision: `sha256:${"b".repeat(64)}`, expectedModifiedAt: 12 } });
  assert.equal(JSON.stringify(request).includes(content), false);
  assert.equal(JSON.stringify(request).includes("temporary-project"), false);
});

test("create-only revision and legacy modification-time guards remain distinct", async () => {
  for (const [guards, expected] of [
    [{}, { expectedRevision: null }],
    [{ expectedRevision: null, expectedModifiedAt: null }, { expectedRevision: null, expectedModifiedAt: null }],
    [{ expectedModifiedAt: 0 }, { expectedModifiedAt: 0 }],
    [{ expectedModifiedAt: 12 }, { expectedModifiedAt: 12 }],
  ]) {
    const host = fixture();
    await commitNativeProjectSnapshot({ content, ...guards, scope: host.scope });
    const { path, ...actual } = host.processes.get("process-1").request.input;
    assert.ok(path); assert.deepEqual(actual, expected);
  }
});

test("one epoch cache avoids redundant handle discovery without caching commits", async () => {
  const host = fixture(), handleCache = {};
  await commitNativeProjectSnapshot({ content, scope: host.scope, handleCache });
  await commitNativeProjectSnapshot({ content, scope: { ...host.scope }, handleCache });
  assert.equal(host.calls.filter(call => call.method === "process.find").length, 1);
  assert.equal(host.calls.filter(call => call.method === "process.spawn").length, 2);
  assert.equal(host.staged.size, 2);
  await commitNativeProjectSnapshot({ content, scope: host.scope, handleCache: {} });
  assert.equal(host.calls.filter(call => call.method === "process.find").length, 2);
});

test("failed handle discovery is not retained in the epoch cache", async () => {
  let missing = true;
  const host = fixture(method => method === "process.find" && missing ? { available: false, name: "node" } : undefined);
  const handleCache = {};
  await assert.rejects(commitNativeProjectSnapshot({ content, scope: host.scope, handleCache }), { code: "NODE_UNAVAILABLE" });
  assert.equal(host.calls.some(call => call.method === "process.spawn"), false);
  missing = false;
  await commitNativeProjectSnapshot({ content, scope: host.scope, handleCache });
  assert.equal(host.calls.filter(call => call.method === "process.find").length, 2);
});

test("sequence cursors drain fragmented output before accepting an exit receipt", async () => {
  const host = fixture((method, input, owner) => method === "process.get" ? owner.receipt({ ...input, limit: 1 }) : undefined);
  await commitNativeProjectSnapshot({ content, scope: host.scope });
  assert.deepEqual(host.calls.filter(call => call.method === "process.get").map(call => call.input.afterSequence), [0, 1, 2]);
});

test("CLI business errors are preserved only after the process has exited", async () => {
  const host = fixture((method, input, owner) => method === "process.get" ? owner.receipt(input, {
    response: { ok: false, error: { code: "REVISION_CONFLICT", message: "项目已有更新，请重新读取。" } }, receipt: { code: 1 },
  }) : undefined);
  await assert.rejects(commitNativeProjectSnapshot({ content, scope: host.scope }), error => {
    assert.equal(error.code, "REVISION_CONFLICT"); assert.equal(error.outcomeUnknown, false);
    assert.match(error.stagedPath, /^career-data\/panel-commits\//); return true;
  });
  assert.equal(host.calls.filter(call => call.method === "process.spawn").length, 1);
});

test("missing, truncated, reordered or mismatched receipts never trigger another mutation", async () => {
  for (const change of [
    { found: false }, { truncated: true }, { processId: "another-process" }, { events: [] },
    { events: [{ event: "process.output", sequence: 2, payload: { processId: "process-1", stream: "stdout", text: "{}" } }] },
    { nextSequence: 99 }, { hasMore: true }, { code: 1 }, { signal: "SIGTERM" },
    { events: [], nextSequence: 0, sequence: 1, hasMore: true },
  ]) {
    const host = fixture((method, input, owner) => method === "process.get" ? owner.receipt(input, { receipt: change }) : undefined);
    await assert.rejects(commitNativeProjectSnapshot({ content, scope: host.scope }), error => {
      assert.equal(error.outcomeUnknown, true); assert.equal(error.processId, "process-1"); return true;
    });
    assert.equal(host.calls.filter(call => call.method === "process.spawn").length, 1);
    assert.equal(host.calls.some(call => call.method === "process.cancel"), false);
  }
});

test("a success JSON with wrong bytes, revision, path or timestamp is uncertain", async () => {
  for (const change of [{ size: 1 }, { revision: `sha256:${"c".repeat(64)}` }, { path: "other.json" }, { modifiedAt: null }]) {
    const host = fixture((method, input, owner) => method === "process.get" ? owner.receipt(input, { response: { ok: true, result: {
      path: "job-hunt-panel.json", size: Buffer.byteLength(content), modifiedAt: 12, revision: revision(content), ...change,
    } } }) : undefined);
    await assert.rejects(commitNativeProjectSnapshot({ content, scope: host.scope }), { outcomeUnknown: true });
  }
});

test("lost spawn, stdin and process-get responses are not automatically resubmitted", async () => {
  for (const failedMethod of ["process.spawn", "process.write", "process.end", "process.get"]) {
    const host = fixture(method => { if (method === failedMethod) throw Error("transport interrupted"); });
    await assert.rejects(commitNativeProjectSnapshot({ content, scope: host.scope }), { outcomeUnknown: true });
    assert.equal(host.calls.filter(call => call.method === "process.spawn").length, 1);
    assert.equal(host.calls.filter(call => call.method === failedMethod).length, 1);
    assert.equal(host.calls.some(call => call.method === "process.cancel"), false);
  }
});

test("timeout leaves an uncertain outcome without cancelling a possible commit", async () => {
  const host = fixture((method, input) => method === "process.get" ? { found: true, processId: input.processId,
    status: "running", events: [], nextSequence: 0, sequence: 0, hasMore: false, truncated: false } : undefined);
  await assert.rejects(commitNativeProjectSnapshot({ content, scope: host.scope, timeoutMs: 2 }), { code: "COMMIT_TIMEOUT", outcomeUnknown: true });
  assert.equal(host.calls.filter(call => call.method === "process.spawn").length, 1);
  assert.equal(host.calls.some(call => call.method === "process.cancel"), false);
});

test("every asynchronous host step checks that the project is still current", async () => {
  for (const changedAfter of methods) {
    const host = fixture(method => { if (method === changedAfter) host.deactivate(); });
    await assert.rejects(commitNativeProjectSnapshot({ content, scope: host.scope }), { code: "PROJECT_CHANGED" });
    assert.equal(host.calls.at(-1).method, changedAfter);
  }
});

test("invalid inputs and oversized UTF-8 snapshots perform no host operations", async () => {
  const host = fixture();
  for (const invalid of [{ content: "" }, { content: "中".repeat(140_000) }, { expectedRevision: "preview:12" },
    { expectedModifiedAt: NaN }, { expectedModifiedAt: -1 }, { timeoutMs: 0 }, { handleCache: "shared" }])
    await assert.rejects(commitNativeProjectSnapshot({ content, scope: host.scope, ...invalid }));
  assert.equal(host.calls.length, 0);
});
