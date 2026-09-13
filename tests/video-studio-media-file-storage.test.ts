import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { persistMediaFile } from "../apps/video-studio/src/media-file-storage";
import type { PanelBridge } from "../apps/video-studio/src/host";
import type { Asset } from "../apps/video-studio/src/model";

const METHODS = [
  "resources.upload.begin",
  "resources.upload.write",
  "resources.upload.finish",
  "resources.upload.cancel",
];
function source(length = 70_001) {
  const bytes = Uint8Array.from({ length }, (_, i) => (i * 17) % 256);
  const file = new File([bytes], "原素材.mp4", { type: "video/mp4", lastModified: 900 });
  const asset: Asset = {
    id: randomUUID(),
    name: "保留工程名称",
    kind: "video",
    durationFrames: 90,
    width: 1920,
    height: 1080,
    lastModified: 123,
  };
  return { bytes, file, asset };
}
function fixture(
  options: {
    methods?: string[];
    chunk?: number;
    after?(method: string, result: any): void;
    failure?: string;
    structured?: boolean;
  } = {},
) {
  const sessionId = `upload-${randomUUID()}`;
  const calls: { method: string; params: any }[] = [];
  const chunks: Buffer[] = [];
  let expectedBytes = 0;
  let receivedBytes = 0;
  let nextSequence = 0;
  const view = () => ({
    sessionId,
    state: "uploading",
    receivedBytes,
    nextSequence,
    maxChunkBytes: options.chunk ?? 32768,
    maxFileBytes: 1024 * 1024,
  });
  const invoke = async (method: string, params: any) => {
    calls.push({ method, params });
    assert.ok(METHODS.includes(method), `Must not call native or tasks: ${method}`);
    if (options.failure === method) throw new Error("Host private path /private/example");
    let result: any;
    if (method === "resources.upload.begin") {
      assert.equal(params.mimeType, "video/mp4");
      expectedBytes = params.expectedBytes;
      result = view();
    } else if (method === "resources.upload.write") {
      assert.equal(params.sessionId, sessionId);
      assert.equal(params.sequence, nextSequence);
      assert.equal(params.offset, receivedBytes);
      const chunk = Buffer.from(params.dataBase64, "base64");
      assert.ok(chunk.length > 0 && chunk.length <= Math.min(32768, options.chunk ?? 32768));
      assert.equal(chunk.toString("base64"), params.dataBase64);
      chunks.push(chunk);
      receivedBytes += chunk.length;
      nextSequence++;
      result = view();
    } else if (method === "resources.upload.finish") {
      assert.equal(params.sessionId, sessionId);
      assert.equal(receivedBytes, expectedBytes);
      const sha256 = createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
      result = {
        asset: { id: `asset-${sha256}`, bytes: receivedBytes, sha256, mimeType: "video/mp4" },
      };
    } else result = { cancelled: true };
    options.after?.(method, result);
    return result;
  };
  const bridge = {
    // Deliberately no cwd, native entry, media status, or task capability.
    getContext: async () => ({ availableMethods: options.methods ?? METHODS }),
    call: options.structured
      ? async () => {
          throw Error("callResult must be preferred");
        }
      : invoke,
    ...(options.structured
      ? {
          callResult: async (method: string, params: any) => ({
            ok: true as const,
            value: await invoke(method, params),
          }),
        }
      : {}),
    registerTool: () => () => {},
    on: () => {
      throw Error("File uploads must not subscribe to task events");
    },
  } as unknown as PanelBridge;
  return { bridge, calls, chunks };
}

test("desktop source bytes persist in ordered bounded chunks and retain the project UUID and metadata", async () => {
  const input = source();
  const before = structuredClone(input.asset);
  const upload = fixture({ structured: true });
  const progress: number[] = [];
  const result = await persistMediaFile(upload.bridge, input.file, input.asset, {
    progress: (fraction) => progress.push(fraction),
  });
  assert.deepEqual(Buffer.concat(upload.chunks), Buffer.from(input.bytes));
  assert.deepEqual(
    upload.calls.map((c) => c.method),
    [METHODS[0], METHODS[1], METHODS[1], METHODS[1], METHODS[2]],
  );
  assert.equal(result.id, before.id);
  assert.equal(result.lastModified, 123);
  assert.equal(result.name, before.name);
  assert.equal(result.durationFrames, 90);
  assert.equal(result.size, input.file.size);
  assert.equal(result.mediaId, `asset-${createHash("sha256").update(input.bytes).digest("hex")}`);
  assert.deepEqual(input.asset, before, "The caller asset is never mutated");
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.slice(1).every((value, i) => value >= progress[i]!));
});

test("upload honors a smaller advertised chunk budget", async () => {
  const input = source(19);
  const upload = fixture({ chunk: 7 });
  await persistMediaFile(upload.bridge, input.file, input.asset);
  assert.deepEqual(
    upload.chunks.map((c) => c.length),
    [7, 7, 5],
  );
});

test("missing upload permissions fail without native calls or an IndexedDB fallback", async () => {
  const input = source(12);
  const upload = fixture({ methods: METHODS.slice(0, 3) });
  await assert.rejects(persistMediaFile(upload.bridge, input.file, input.asset), (error: any) => {
    assert.match(error.message, /权限|上传接口/);
    assert.doesNotMatch(error.message, /更新主程序|升级桌面/);
    return true;
  });
  assert.deepEqual(upload.calls, []);
});

for (const method of [METHODS[1]!, METHODS[2]!])
  test(`${method} failure cancels the active upload and does not leak Host paths`, async () => {
    const input = source(12);
    const upload = fixture({ failure: method });
    await assert.rejects(
      persistMediaFile(upload.bridge, input.file, input.asset),
      (error: Error) => {
        assert.match(error.message, /持久保存失败/);
        assert.doesNotMatch(error.message, /private\/example/);
        return true;
      },
    );
    assert.equal(upload.calls.at(-1)?.method, METHODS[3]);
    if (method === METHODS[1]) assert.ok(!upload.calls.some((c) => c.method === METHODS[2]));
  });

for (const stage of [METHODS[0]!, METHODS[1]!, METHODS[2]!])
  test(`changing project during ${stage} rejects publication and cancels`, async () => {
    const input = source();
    let current = true;
    const upload = fixture({
      after: (method) => {
        if (method === stage) current = false;
      },
    });
    await assert.rejects(
      persistMediaFile(upload.bridge, input.file, input.asset, {
        isCurrent: () => current,
      }),
      { name: "AbortError" },
    );
    assert.equal(upload.calls.at(-1)?.method, METHODS[3]);
    const work = upload.calls.filter((c) => c.method !== METHODS[3]);
    assert.equal(work.at(-1)?.method, stage);
  });

test("already stale files never begin storage and a final progress callback cannot publish into another project", async () => {
  const input = source(12);
  const untouched = fixture();
  await assert.rejects(
    persistMediaFile(untouched.bridge, input.file, input.asset, {
      isCurrent: () => false,
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(untouched.calls, []);
  const upload = fixture();
  let current = true;
  await assert.rejects(
    persistMediaFile(upload.bridge, input.file, input.asset, {
      isCurrent: () => current,
      progress: (fraction) => {
        if (fraction === 1) current = false;
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(upload.calls.at(-1)?.method, METHODS[3]);
});

for (const invalid of ["bytes", "id", "ack", "chunk"])
  test(`invalid ${invalid} response cannot publish a managed asset`, async () => {
    const input = source(12);
    const upload = fixture({
      after(method, result) {
        if (method === METHODS[2] && invalid === "bytes") result.asset.bytes++;
        if (method === METHODS[2] && invalid === "id") result.asset.id = `asset-${"a".repeat(64)}`;
        if (method === METHODS[1] && invalid === "ack") result.receivedBytes--;
        if (method === METHODS[0] && invalid === "chunk") result.maxChunkBytes = 0;
      },
    });
    await assert.rejects(persistMediaFile(upload.bridge, input.file, input.asset), /持久保存失败/);
    assert.equal(upload.calls.at(-1)?.method, METHODS[3]);
  });

test("browser-only files wait for the cache transaction before returning their unchanged identity", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const input = source(12);
  let stored: any;
  let complete: (() => void) | undefined;
  let closed = false;
  const transaction: any = {
    objectStore: () => ({
      put(value: any) {
        stored = value;
        queueMicrotask(() => {
          complete = () => transaction.oncomplete();
        });
        return {};
      },
    }),
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const request: any = {};
        queueMicrotask(() => {
          request.result = {
            transaction: () => transaction,
            close: () => {
              closed = true;
            },
          };
          request.onsuccess();
        });
        return request;
      },
    },
  });
  try {
    let returned = false;
    const operation = persistMediaFile(undefined, input.file, input.asset).then((value) => {
      returned = true;
      return value;
    });
    while (!complete) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(returned, false);
    assert.equal(stored.id, input.asset.id);
    assert.equal(stored.blob, input.file);
    complete();
    const result = await operation;
    assert.equal(result.id, input.asset.id);
    assert.equal(result.mediaId, undefined);
    assert.equal(result.lastModified, 123);
    assert.equal(closed, true);
  } finally {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

test("the UI upload fixture preserves acknowledged bytes across reload and rejects incomplete or out-of-order uploads", async () => {
  const { installGenericMediaTaskMock } = await import("./helpers/video-studio-generic-task.mjs");
  const originals = new Map(
    ["window", "localStorage"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
  const reopen = () => {
    const window: any = {
      codeshellPanel: {
        getContext: async () => ({}),
        on: () => () => {},
        call: async (method: string) => {
          throw Error(`Unexpected underlying Host call: ${method}`);
        },
      },
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: window });
    installGenericMediaTaskMock();
    return window.codeshellPanel;
  };
  try {
    let bridge = reopen();
    const methods = (await bridge.getContext()).availableMethods;
    assert.ok(METHODS.every((method) => methods.includes(method)));
    const bytes = Buffer.from([1, 2, 3, 4, 255]);
    const started = await bridge.call(METHODS[0], {
      name: "tiny.mp4",
      mimeType: "video/mp4",
      expectedBytes: bytes.length,
    });
    await assert.rejects(bridge.call(METHODS[2], { sessionId: started.sessionId }), /incomplete/);
    await assert.rejects(
      bridge.call(METHODS[1], {
        sessionId: started.sessionId,
        sequence: 1,
        offset: 0,
        dataBase64: bytes.toString("base64"),
      }),
      /in order/,
    );
    const request = {
      sessionId: started.sessionId,
      sequence: 0,
      offset: 0,
      dataBase64: bytes.toString("base64"),
    };
    const acknowledged = await bridge.call(METHODS[1], request);
    assert.equal(acknowledged.maxChunkBytes, 32768);
    assert.equal(acknowledged.receivedBytes, bytes.length);
    assert.equal(
      (await bridge.call(METHODS[1], request)).nextSequence,
      1,
      "Exact last-chunk retry is idempotent",
    );
    bridge = reopen();
    const finished = await bridge.call(METHODS[2], { sessionId: started.sessionId });
    assert.equal(finished.asset.id, `asset-${createHash("sha256").update(bytes).digest("hex")}`);
    bridge = reopen();
    assert.deepEqual(
      (await bridge.call("resources.get", { id: finished.asset.id })).asset,
      finished.asset,
    );
    const read = await bridge.call("resources.read", {
      assetId: finished.asset.id,
      offset: 1,
      length: 3,
    });
    assert.deepEqual(Buffer.from(read.dataBase64, "base64"), bytes.subarray(1, 4));
    assert.equal(read.eof, false);
    const cancelled = await bridge.call(METHODS[0], {
      name: "cancel.mp4",
      mimeType: "video/mp4",
      expectedBytes: bytes.length,
    });
    await bridge.call(METHODS[3], { sessionId: cancelled.sessionId });
    await assert.rejects(
      bridge.call(METHODS[1], { ...request, sessionId: cancelled.sessionId }),
      /no longer/,
    );
    assert.ok(
      (globalThis as any).window.__genericHostCalls.every(
        (call: any) => !call.method.startsWith("tasks."),
      ),
    );
  } finally {
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
