import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  createDesktopFolderSource,
  type FolderEntry,
} from "../apps/video-studio/src/folder-source";
import type { PanelBridge } from "../apps/video-studio/src/host";

const METHODS = [
  "filesystem.pickDirectory",
  "process.find",
  "process.resolveEntry",
  "process.spawn",
  "process.get",
  "process.cancel",
  "resources.capture",
];
const sample: FolderEntry = {
  path: "访谈/镜头 01.mp4",
  name: "镜头 01.mp4",
  bytes: 12345,
  lastModified: 1700000000000,
  mimeType: "video/mp4",
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture(
  options: {
    methods?: string[];
    output?: string;
    pages?: any[];
    modify?(method: string, response: any, params: any): unknown | Promise<unknown>;
    structured?: boolean;
  } = {},
) {
  const directory = randomUUID(),
    executable = randomUUID(),
    entry = randomUUID(),
    processId = randomUUID();
  const calls: { method: string; params: any }[] = [];
  let pageIndex = 0;
  const stdout = options.output ?? JSON.stringify({ files: [sample], skipped: 2 });
  const outputEvent = (text = stdout, sequence = 1, stream = "stdout") => ({
    event: "process.output",
    sequence,
    payload: { processId, stream, text },
  });
  const exitEvent = (sequence = 2) => ({
    event: "process.exit",
    sequence,
    payload: { processId, code: 0, signal: null },
  });
  const page = (events = [outputEvent(), exitEvent()], fields = {}) => ({
    found: true,
    processId,
    status: "exited",
    code: 0,
    signal: null,
    sequence: events.at(-1)?.sequence ?? 0,
    nextSequence: events.at(-1)?.sequence ?? 0,
    events,
    hasMore: false,
    truncated: false,
    cancelRequested: false,
    ...fields,
  });
  const invoke = async (method: string, params: any) => {
    calls.push({ method, params });
    let response: any;
    switch (method) {
      case "filesystem.pickDirectory":
        response = { handle: directory, name: "素材目录", path: "/private/user/source" };
        break;
      case "process.find":
        response = { available: true, handle: executable, name: params.name };
        break;
      case "process.resolveEntry":
        response = { handle: entry, name: "folder-scan", sha256: "a".repeat(64) };
        break;
      case "process.spawn":
        response = { processId, executable: "node" };
        break;
      case "process.get":
        response = options.pages?.[pageIndex++] ?? page();
        break;
      case "process.cancel":
        response = { cancelled: true };
        break;
      case "resources.capture":
        response = {
          asset: {
            id: `asset-${"b".repeat(64)}`,
            sha256: "b".repeat(64),
            bytes: sample.bytes,
            mimeType: sample.mimeType,
            name: sample.name,
            createdAt: 1,
          },
        };
        break;
      default:
        throw Error(`Unexpected interface ${method}`);
    }
    return options.modify ? options.modify(method, response, params) : response;
  };
  const bridge = {
    getContext: async () => ({
      availableMethods: options.methods ?? METHODS,
      capabilities: {
        bridge: { maxCallsPerWindow: 1000, maxTransferCallsPerWindow: 1000, rateWindowMs: 1000 },
      },
    }),
    call: options.structured
      ? async () => {
          throw Error("callResult should be preferred");
        }
      : invoke,
    ...(options.structured
      ? {
          callResult: async (method: string, params: unknown) => ({
            ok: true,
            value: await invoke(method, params),
          }),
        }
      : {}),
    registerTool: () => () => {},
    on: () => () => {},
  } as unknown as PanelBridge;
  const source = createDesktopFolderSource(bridge);
  return { source, calls, directory, executable, entry, processId, page, outputEvent, exitEvent };
}
async function opened(f: ReturnType<typeof fixture>) {
  assert.equal(await f.source.available(), true);
  const selected = await f.source.pick();
  assert.deepEqual(selected, { handle: f.directory, name: "素材目录" });
  return selected!.handle;
}

test("directory grants stay in the open Panel and only the reviewed entry can scan or capture", async () => {
  const f = fixture({ structured: true });
  try {
    const handle = await opened(f);
    const found = await f.source.scan(handle);
    assert.deepEqual(found, { files: [sample], skipped: 2 });
    const captured = await f.source.capture(handle, { ...found.files[0]! });
    assert.equal(captured.id, `asset-${captured.sha256}`);
    assert.equal(captured.bytes, sample.bytes);
    assert.deepEqual(f.calls.find((c) => c.method === "process.resolveEntry")?.params, {
      name: "folder-scan",
      executableHandle: f.executable,
    });
    assert.deepEqual(f.calls.find((c) => c.method === "process.spawn")?.params, {
      executableHandle: f.executable,
      entryHandle: f.entry,
      directoryHandle: handle,
      args: [],
    });
    assert.deepEqual(f.calls.find((c) => c.method === "resources.capture")?.params, {
      directoryHandle: handle,
      path: sample.path,
      name: sample.name,
      mimeType: sample.mimeType,
      expectedBytes: sample.bytes,
    });
    assert.ok(!JSON.stringify(f.calls).includes("/private/user/source"));
    assert.ok(!f.calls.some((c) => /^tasks\.|storage\.|filesystem\.getKnown/.test(c.method)));
    await f.source.scan(handle);
    assert.equal(f.calls.filter((c) => c.method === "process.find").length, 1);
    assert.equal(
      f.calls.filter((c) => c.method === "process.resolveEntry").length,
      1,
      "Periodic scans reuse this session's reviewed entry without exhausting grants",
    );
  } finally {
    f.source.dispose();
  }
});

test("availability uses discovered methods and missing permissions never request a directory", async () => {
  const f = fixture({ methods: METHODS.filter((method) => method !== "resources.capture") });
  try {
    assert.equal(await f.source.available(), false);
    await assert.rejects(f.source.pick(), /权限/);
    assert.deepEqual(f.calls, []);
  } finally {
    f.source.dispose();
  }
});
test("cancelled folder selection is not a reusable grant", async () => {
  const f = fixture({
    modify: (method, response) =>
      method === "filesystem.pickDirectory" ? { cancelled: true } : response,
  });
  try {
    assert.equal(await f.source.pick(), undefined);
    await assert.rejects(f.source.scan(f.directory), /重新选择/);
    assert.equal(f.calls.length, 1);
  } finally {
    f.source.dispose();
  }
});
test("scan handles must come from this instance, not storage or another Panel", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.source.scan(randomUUID()), /重新选择/);
    await assert.rejects(f.source.capture(f.directory, sample), /重新选择/);
    assert.deepEqual(f.calls, []);
  } finally {
    f.source.dispose();
  }
});
test("nodejs is a fixed fallback when node is unavailable", async () => {
  const f = fixture({
    modify: (method, response, params) =>
      method === "process.find" && params.name === "node"
        ? { available: false, name: "node" }
        : response,
  });
  try {
    await f.source.scan(await opened(f));
    assert.deepEqual(
      f.calls.filter((c) => c.method === "process.find").map((c) => c.params),
      [{ name: "node" }, { name: "nodejs" }],
    );
  } finally {
    f.source.dispose();
  }
});
test("missing Node has a precise fallback message and does not spawn", async () => {
  const f = fixture({
    modify: (method, response) => (method === "process.find" ? { available: false } : response),
  });
  try {
    await assert.rejects(f.source.scan(await opened(f)), /未找到 Node.js/);
    assert.ok(!f.calls.some((c) => c.method === "process.spawn"));
  } finally {
    f.source.dispose();
  }
});

test("terminal receipts drain all cursor pages and preserve split Unicode JSON", async () => {
  let f: ReturnType<typeof fixture>;
  const encoded = JSON.stringify({ files: [sample], skipped: 0 });
  const split = encoded.indexOf("镜头") + 1;
  f = fixture({
    modify: (method, response, params) => {
      if (method !== "process.get") return response;
      if (params.afterSequence === 0)
        return f.page([f.outputEvent(encoded.slice(0, split))], { sequence: 3, hasMore: true });
      assert.equal(params.afterSequence, 1);
      assert.equal(params.limit, 128);
      return f.page([f.outputEvent(encoded.slice(split), 2), f.exitEvent(3)]);
    },
  });
  try {
    assert.deepEqual(await f.source.scan(await opened(f)), { files: [sample], skipped: 0 });
    assert.equal(f.calls.filter((c) => c.method === "process.get").length, 2);
  } finally {
    f.source.dispose();
  }
});

for (const [label, change] of [
  ["truncated output", (page: any) => ({ ...page, truncated: true })],
  ["missing receipt", (page: any) => ({ found: false, processId: page.processId })],
  ["nonzero exit", (page: any) => ({ ...page, code: 2 })],
  ["signalled exit", (page: any) => ({ ...page, signal: "SIGTERM" })],
  ["lost event sequence", (page: any) => ({ ...page, events: page.events.slice(1) })],
  ["invalid cursor", (page: any) => ({ ...page, nextSequence: 1 })],
  ["false hasMore", (page: any) => ({ ...page, hasMore: true })],
  ["unknown status", (page: any) => ({ ...page, status: "succeeded" })],
] as const)
  test(`${label} cannot publish even otherwise valid scan output`, async () => {
    const f = fixture({
      modify: (method, response) => (method === "process.get" ? change(response) : response),
    });
    try {
      await assert.rejects(f.source.scan(await opened(f)));
      assert.equal(f.calls.at(-1)?.method, "process.cancel");
      await assert.rejects(f.source.capture(f.directory, sample), /扫描清单/);
    } finally {
      f.source.dispose();
    }
  });

for (const [label, payload] of [
  ["absolute path", { files: [{ ...sample, path: "/tmp/a.mp4", name: "a.mp4" }], skipped: 0 }],
  ["parent traversal", { files: [{ ...sample, path: "../a.mp4", name: "a.mp4" }], skipped: 0 }],
  ["windows path", { files: [{ ...sample, path: "C:\\a.mp4", name: "a.mp4" }], skipped: 0 }],
  [
    "reserved Windows component",
    { files: [{ ...sample, path: "CON/a.mp4", name: "a.mp4" }], skipped: 0 },
  ],
  ["mismatched name", { files: [{ ...sample, name: "other.mp4" }], skipped: 0 }],
  ["unsafe bytes", { files: [{ ...sample, bytes: Number.MAX_SAFE_INTEGER + 1 }], skipped: 0 }],
  ["negative date", { files: [{ ...sample, lastModified: -1 }], skipped: 0 }],
  ["nonmedia MIME", { files: [{ ...sample, mimeType: "text/javascript" }], skipped: 0 }],
  ["duplicate file", { files: [sample, sample], skipped: 0 }],
  [
    "too many files",
    {
      files: Array.from({ length: 1001 }, (_, i) => ({
        ...sample,
        path: `${i}.mp4`,
        name: `${i}.mp4`,
      })),
      skipped: 0,
    },
  ],
  ["invalid skipped", { files: [], skipped: "1" }],
  ["injected fields", { files: [], skipped: 0, command: "arbitrary" }],
] as const)
  test(`${label} is rejected before any file capture`, async () => {
    const f = fixture({ output: JSON.stringify(payload) });
    try {
      await assert.rejects(f.source.scan(await opened(f)));
      assert.ok(!f.calls.some((c) => c.method === "resources.capture"));
    } finally {
      f.source.dispose();
    }
  });

test("output byte budget stops oversized JSON across individually bounded events", async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture({
    modify: (method, response) =>
      method === "process.get"
        ? f.page([
            ...Array.from({ length: 13 }, (_, i) => f.outputEvent("x".repeat(16384), i + 1)),
            f.exitEvent(14),
          ])
        : response,
  });
  try {
    await assert.rejects(f.source.scan(await opened(f)), /超过限制/);
  } finally {
    f.source.dispose();
  }
});
test("a capture accepts only unchanged entries from the last successful scan", async () => {
  const f = fixture();
  try {
    await f.source.scan(await opened(f));
    for (const input of [
      { ...sample, bytes: 77 },
      { ...sample, lastModified: 33 },
      { ...sample, path: "other.mp4", name: "other.mp4" },
    ])
      await assert.rejects(f.source.capture(f.directory, input), /扫描清单/);
    assert.ok(!f.calls.some((c) => c.method === "resources.capture"));
  } finally {
    f.source.dispose();
  }
});
for (const field of ["id", "sha256", "bytes", "mimeType", "name"])
  test(`capture validates returned ${field}`, async () => {
    const f = fixture({
      modify: (method, response) =>
        method === "resources.capture"
          ? { asset: { ...response.asset, [field]: field === "bytes" ? 1 : "wrong" } }
          : response,
    });
    try {
      await f.source.scan(await opened(f));
      await assert.rejects(f.source.capture(f.directory, sample), /身份与大小检查/);
    } finally {
      f.source.dispose();
    }
  });

test("cancelling a pending process.get sends one cancellation and discards partial output", async () => {
  const waiting = deferred<any>(),
    controller = new AbortController();
  const f = fixture({
    modify: (method, response) => (method === "process.get" ? waiting.promise : response),
  });
  try {
    const pending = f.source.scan(await opened(f), controller.signal);
    while (!f.calls.some((c) => c.method === "process.get")) await Promise.resolve();
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(f.calls.filter((c) => c.method === "process.cancel").length, 1);
    waiting.resolve(f.page());
    await assert.rejects(f.source.capture(f.directory, sample), /扫描清单/);
  } finally {
    f.source.dispose();
  }
});
test("a spawn completing after cancellation is still stopped and never read", async () => {
  const waiting = deferred<any>(),
    controller = new AbortController();
  const f = fixture({
    modify: (method, response) => (method === "process.spawn" ? waiting.promise : response),
  });
  try {
    const pending = f.source.scan(await opened(f), controller.signal);
    while (!f.calls.some((c) => c.method === "process.spawn")) await Promise.resolve();
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    f.source.dispose();
    waiting.resolve({ processId: f.processId });
    await setImmediate();
    assert.equal(f.calls.filter((c) => c.method === "process.cancel").length, 1);
    assert.ok(!f.calls.some((c) => c.method === "process.get"));
  } finally {
    f.source.dispose();
  }
});
test("dispose cancels a running scan and invalidates all session grants", async () => {
  const waiting = deferred<any>();
  const f = fixture({
    modify: (method, response) => (method === "process.get" ? waiting.promise : response),
  });
  const pending = f.source.scan(await opened(f));
  while (!f.calls.some((c) => c.method === "process.get")) await Promise.resolve();
  f.source.dispose();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(await f.source.available(), false);
  assert.equal(f.calls.filter((c) => c.method === "process.cancel").length, 1);
  await assert.rejects(f.source.scan(f.directory), { name: "AbortError" });
  waiting.resolve(f.page());
});
test("scan timeout stops the process instead of returning partial success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const waiting = deferred<any>();
  const f = fixture({
    modify: (method, response) => (method === "process.get" ? waiting.promise : response),
  });
  try {
    const pending = f.source.scan(await opened(f));
    while (!f.calls.some((c) => c.method === "process.get")) await Promise.resolve();
    t.mock.timers.tick(60_001);
    await assert.rejects(pending, /扫描超时/);
    assert.equal(f.calls.filter((c) => c.method === "process.cancel").length, 1);
    waiting.resolve(f.page());
  } finally {
    f.source.dispose();
    t.mock.timers.reset();
  }
});
test("a capture completing after cancellation is never returned for publication", async () => {
  const waiting = deferred<any>(),
    controller = new AbortController();
  let saved: unknown;
  const f = fixture({
    modify: (method, response) => {
      if (method === "resources.capture") {
        saved = response;
        return waiting.promise;
      }
      return response;
    },
  });
  try {
    await f.source.scan(await opened(f));
    const pending = f.source.capture(f.directory, sample, controller.signal);
    while (!f.calls.some((c) => c.method === "resources.capture")) await Promise.resolve();
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    waiting.resolve(saved);
  } finally {
    f.source.dispose();
  }
});
test("raw Host failures never expose their private paths, even with a Chinese prefix", async () => {
  const f = fixture({
    modify: (method, response) => {
      if (method === "process.get") throw Error("文件夹扫描 /private/user/secret.mp4 failed");
      return response;
    },
  });
  try {
    await assert.rejects(f.source.scan(await opened(f)), (error: Error) => {
      assert.doesNotMatch(error.message, /private|secret/);
      return true;
    });
  } finally {
    f.source.dispose();
  }
});

for (const bytes of [0, 20 * 1024 ** 3 + 1])
  test(`a ${bytes}-byte entry does not block scanning other files but cannot be captured`, async () => {
    const excluded = { ...sample, bytes };
    const f = fixture({ output: JSON.stringify({ files: [excluded], skipped: 0 }) });
    try {
      const found = await f.source.scan(await opened(f));
      assert.equal(found.files[0]?.bytes, bytes);
      await assert.rejects(f.source.capture(f.directory, excluded), /为空|20 GiB/);
      assert.ok(!f.calls.some((call) => call.method === "resources.capture"));
    } finally {
      f.source.dispose();
    }
  });
for (const message of [
  "素材数量超过 1000 个，请选择更小的素材文件夹。",
  "素材相对路径超过保存上限，请选择更靠近素材的子文件夹或缩短文件名。",
  "扫描期间素材或目录已变化，请等待文件写入完成后重试。",
])
  test(`the scanner's reviewed explanation remains actionable: ${message}`, async () => {
    let f: ReturnType<typeof fixture>;
    f = fixture({
      modify: (method, response) =>
        method === "process.get"
          ? f.page([f.outputEvent(message + "\n", 1, "stderr"), f.exitEvent()], { code: 1 })
          : response,
    });
    try {
      await assert.rejects(f.source.scan(await opened(f)), { message });
    } finally {
      f.source.dispose();
    }
  });
test("unrecognized stderr is not exposed even when it begins with a safe scanner message", async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture({
    modify: (method, response) =>
      method === "process.get"
        ? f.page(
            [
              f.outputEvent(
                "文件夹已发生变化，请重新扫描。\n/private/user/recording.mp4",
                1,
                "stderr",
              ),
              f.exitEvent(),
            ],
            { code: 1 },
          )
        : response,
  });
  try {
    await assert.rejects(f.source.scan(await opened(f)), (error: Error) => {
      assert.doesNotMatch(error.message, /private|recording/);
      return true;
    });
  } finally {
    f.source.dispose();
  }
});

test("a split emoji at the exact output byte budget does not cause a false truncation error", async () => {
  const emojiFile = { ...sample, path: "访谈/😀.mp4", name: "😀.mp4" };
  const json = JSON.stringify({ files: [emojiFile], skipped: 0 });
  const text = json + " ".repeat(192 * 1024 - Buffer.byteLength(json) - 1) + "\n";
  const boundary = text.indexOf("😀") + 1;
  const chunks = [text.slice(0, boundary)];
  for (let offset = boundary; offset < text.length; offset += 16384)
    chunks.push(text.slice(offset, offset + 16384));
  let f: ReturnType<typeof fixture>;
  f = fixture({
    modify: (method, response) =>
      method === "process.get"
        ? f.page([
            ...chunks.map((chunk, i) => f.outputEvent(chunk, i + 1)),
            f.exitEvent(chunks.length + 1),
          ])
        : response,
  });
  try {
    const found = await f.source.scan(await opened(f));
    assert.deepEqual(found.files, [emojiFile]);
  } finally {
    f.source.dispose();
  }
});

test("repeatedly declining execution keeps the reviewed entry for an explicit retry", async () => {
  let attempts = 0;
  const f = fixture({
    modify: (method, response) => {
      if (method === "process.spawn" && ++attempts <= 2) throw Error("User denied running node");
      return response;
    },
  });
  try {
    const handle = await opened(f);
    await assert.rejects(f.source.scan(handle), /无法扫描文件夹/);
    await assert.rejects(f.source.scan(handle), /无法扫描文件夹/);
    assert.deepEqual(await f.source.scan(handle), { files: [sample], skipped: 2 });
    assert.equal(f.calls.filter((call) => call.method === "process.find").length, 1);
    assert.equal(f.calls.filter((call) => call.method === "process.resolveEntry").length, 1);
    assert.equal(f.calls.filter((call) => call.method === "process.spawn").length, 3);
  } finally {
    f.source.dispose();
  }
});
