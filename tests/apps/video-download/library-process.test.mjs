import assert from "node:assert/strict";
import test from "node:test";
import { createLibraryProcess } from "../../../apps/video-download/app/library-process.js";

function event(sequence, stream, text) {
  return { sequence, event: "process.output", payload: { processId: "helper-1", stream, text } };
}
function receipt(events, overrides = {}) {
  return {
    found: true,
    processId: "helper-1",
    status: "exited",
    code: 0,
    events,
    truncated: false,
    hasMore: false,
    sequence: events.at(-1)?.sequence || 0,
    nextSequence: events.at(-1)?.sequence || 0,
    ...overrides,
  };
}
function fixture(handlers = {}) {
  const calls = [];
  const busy = [];
  const panel = {
    async call(method, params) {
      calls.push({ method, params });
      if (handlers[method]) return handlers[method](params);
      if (method === "process.spawn") return { processId: "helper-1" };
      if (method === "process.cancel") return { cancelled: true };
      if (method === "process.find") return { available: true, handle: "node-handle" };
      if (method === "process.resolveEntry") return { handle: "entry-handle" };
      if (method === "process.write" || method === "process.end") return { ok: true };
      if (method === "process.get") return receipt([]);
      throw new Error(`Unexpected method ${method}`);
    },
  };
  const process = createLibraryProcess(panel, { onBusy: (value) => busy.push(value) });
  return { process, calls, busy };
}
const args = { executableHandle: "node-handle", directoryHandle: "directory-handle" };

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("retained receipts recover output even when a process exits before spawn resolves", async () => {
  const starting = deferred();
  const app = fixture({
    "process.spawn": () => starting.promise,
    "process.get": () =>
      receipt([
        event(1, "stdout", "first\n"),
        event(2, "stderr", "warning\n"),
        { sequence: 3, event: "process.exit", payload: { code: 0 } },
      ]),
  });
  const run = app.process.run(args);
  assert.equal(app.process.busy, true);
  assert.equal(app.process.ignores({ processId: "helper-1" }), true);
  starting.resolve({ processId: "helper-1" });
  assert.deepEqual(await run, { code: 0, stdout: "first\n", stderr: "warning\n" });
  assert.equal(app.process.ignores({ processId: "helper-1" }), true);
  assert.equal(app.process.ignores({ processId: "unrelated" }), false);
  assert.equal(app.process.busy, false);
  assert.deepEqual(app.busy, [true, false]);
  assert.equal(app.calls.filter(({ method }) => method === "process.cancel").length, 0);
});

test("receipt pages preserve per-stream output order and advance the exact cursor", async () => {
  const app = fixture({
    "process.get": ({ afterSequence }) =>
      afterSequence === 0
        ? receipt([event(1, "stdout", "A"), event(2, "stderr", "1")], {
            hasMore: true,
            sequence: 5,
          })
        : receipt([
            event(3, "stdout", "B"),
            event(4, "stderr", "2"),
            { sequence: 5, event: "process.exit", payload: { code: 0 } },
          ]),
  });
  assert.deepEqual(await app.process.run(args), { code: 0, stdout: "AB", stderr: "12" });
  assert.deepEqual(
    app.calls
      .filter(({ method }) => method === "process.get")
      .map(({ params }) => params.afterSequence),
    [0, 2],
  );
});

test("an abort while spawn is pending cancels the returned process and releases busy state", async () => {
  const starting = deferred();
  const controller = new AbortController();
  const app = fixture({ "process.spawn": () => starting.promise });
  const run = app.process.run({ ...args, signal: controller.signal });
  controller.abort();
  starting.resolve({ processId: "helper-1" });
  await assert.rejects(run, /已取消/);
  assert.equal(app.process.busy, false);
  assert.deepEqual(
    app.calls
      .filter(({ method }) => method === "process.cancel")
      .map(({ params }) => params.processId),
    ["helper-1"],
  );
  assert.equal(
    app.calls.some(({ method }) => method === "process.get"),
    false,
  );
});

test("an already aborted signal does not start a process", async () => {
  const controller = new AbortController();
  controller.abort();
  const app = fixture();
  await assert.rejects(app.process.run({ ...args, signal: controller.signal }), /已取消/);
  assert.equal(app.calls.length, 0);
  assert.equal(app.process.busy, false);
});

test("truncated, missing, mismatched and out-of-order receipts fail closed and cancel the helper", async () => {
  const receipts = [
    receipt([], { truncated: true }),
    { found: false, processId: "helper-1" },
    receipt([], { processId: "other" }),
    receipt([event(2, "stdout", "gap")]),
    receipt([event(1, "stdout", "A"), event(1, "stdout", "duplicate")]),
  ];
  for (const response of receipts) {
    const app = fixture({ "process.get": () => response });
    await assert.rejects(app.process.run(args), /不完整|顺序异常/);
    assert.equal(
      app.calls.some(({ method }) => method === "process.cancel"),
      true,
    );
    assert.equal(app.process.busy, false);
  }
});

test("timeouts and oversized output cancel the helper without leaking busy state", async () => {
  const timeout = fixture();
  await assert.rejects(timeout.process.run({ ...args, timeout: -1 }), /超时/);
  assert.equal(
    timeout.calls.some(({ method }) => method === "process.cancel"),
    true,
  );
  const oversized = fixture({
    "process.get": () => receipt([event(1, "stdout", "x".repeat(4_000_001))]),
  });
  await assert.rejects(oversized.process.run(args), /过大/);
  assert.equal(oversized.process.busy, false);
});

test("stdin is written in ordered Unicode-safe chunks and closed before reading the result", async () => {
  const prefixLength = '{"action":"check","files":[{"path":"'.length;
  const input = { action: "check", files: [{ path: `${"a".repeat(4095 - prefixLength)}😀.mp4` }] };
  const app = fixture();
  await app.process.run({ ...args, input, entryHandle: "reviewed-entry" });
  const writes = app.calls.filter(({ method }) => method === "process.write");
  assert(writes.length >= 2);
  assert.equal(writes.map(({ params }) => params.text).join(""), JSON.stringify(input));
  for (const { params } of writes) {
    assert.doesNotMatch(params.text, /^[\uDC00-\uDFFF]/);
    assert.doesNotMatch(params.text, /[\uD800-\uDBFF]$/);
  }
  assert.equal(app.calls[0].params.stdin, "pipe");
  assert.equal(app.calls[0].params.entryHandle, "reviewed-entry");
  assert(
    app.calls.findIndex(({ method }) => method === "process.end") <
      app.calls.findIndex(({ method }) => method === "process.get"),
  );
});

test("file checks reuse only the reviewed entry handles and parse the native JSON result", async () => {
  const files = [{ path: "video.mp4" }];
  const response = {
    files: [{ path: "video.mp4", status: "present", bytes: 10, modifiedAt: 100 }],
  };
  const app = fixture({
    "process.get": () => receipt([event(1, "stdout", JSON.stringify(response))]),
  });
  assert.deepEqual(await app.process.files({ handle: "dir" }, "check", files), response.files);
  assert.deepEqual(await app.process.files({ handle: "dir" }, "check", files), response.files);
  assert.equal(app.calls.filter(({ method }) => method === "process.find").length, 1);
  assert.equal(app.calls.filter(({ method }) => method === "process.resolveEntry").length, 1);
  assert.equal(
    app.calls.find(({ method }) => method === "process.resolveEntry").params.name,
    "download-library",
  );
});

test("video search runs only the reviewed native entry with bounded query input", async () => {
  const response = { candidates: [{ title: "Blender AI", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }], source: "platform-search" };
  const app = fixture({
    "process.get": () => receipt([event(1, "stdout", JSON.stringify(response))]),
  });
  assert.deepEqual(await app.process.search({ handle: "dir" }, "youtube", "Blender AI", 8), response);
  assert.equal(app.calls.find(({ method }) => method === "process.resolveEntry").params.name, "video-search");
  assert.equal(app.calls.find(({ method }) => method === "process.spawn").params.entryHandle, "entry-handle");
  assert.equal(app.calls.find(({ method }) => method === "process.write").params.text,
    JSON.stringify({ platform: "youtube", query: "Blender AI", limit: 8 }));
});

test("a failed native entry lookup can be retried instead of caching its rejection", async () => {
  let finds = 0;
  const app = fixture({
    "process.find": () =>
      ++finds === 1 ? { available: false } : { available: true, handle: "node" },
    "process.get": () =>
      receipt([
        event(1, "stdout", JSON.stringify({ files: [{ path: "video.mp4", status: "missing" }] })),
      ]),
  });
  await assert.rejects(
    app.process.files({ handle: "dir" }, "check", [{ path: "video.mp4" }]),
    /文件检查工具/,
  );
  assert.equal(
    (await app.process.files({ handle: "dir" }, "check", [{ path: "video.mp4" }]))[0].status,
    "missing",
  );
  assert.equal(finds, 2);
});

test("file results reject non-JSON, process errors, wrong counts and mismatched records", async () => {
  const invalid = [
    { stdout: "not-json", code: 0 },
    { stdout: JSON.stringify({ files: [], error: "failed" }), code: 1 },
    { stdout: JSON.stringify({ files: [] }), code: 0 },
    {
      stdout: JSON.stringify({
        files: [{ path: "another.mp4", status: "present", bytes: 20, modifiedAt: 100 }],
      }),
      code: 0,
    },
    { stdout: JSON.stringify({ files: [{ path: "video.mp4", status: "invented" }] }), code: 0 },
  ];
  for (const result of invalid) {
    const app = fixture({
      "process.get": () => receipt([event(1, "stdout", result.stdout)], { code: result.code }),
    });
    await assert.rejects(
      app.process.files({ handle: "dir" }, "check", [{ path: "video.mp4" }]),
      /结果|failed|失败/,
    );
  }
});

test("native stdin contains only path and stable metadata, never cached state or handles", async () => {
  const app = fixture({
    "process.get": () =>
      receipt([
        event(
          1,
          "stdout",
          JSON.stringify({
            files: [{ path: "video.mp4", status: "present", bytes: 10, modifiedAt: 100 }],
          }),
        ),
      ]),
  });
  await app.process.files({ handle: "dir" }, "check", [
    {
      path: "video.mp4",
      status: "present",
      bytes: 10,
      modifiedAt: 100,
      handle: "must-not-cross",
      error: "old error",
    },
  ]);
  const request = JSON.parse(
    app.calls
      .filter(({ method }) => method === "process.write")
      .map(({ params }) => params.text)
      .join(""),
  );
  assert.deepEqual(request, {
    action: "check",
    files: [{ path: "video.mp4", bytes: 10, modifiedAt: 100 }],
  });
});
