import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { runMediaProcess } from "../apps/video-studio/native/process-runner";

const node = process.execPath;
const script = (source: string) => ["-e", source];
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
function dead(pid: number) {
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}

test(
  "streamed stdin delivers every byte and waits for normal producer cleanup",
  { timeout: 10000 },
  async () => {
    const expected = createHash("sha256");
    const backing = Buffer.alloc(65539, 47);
    const chunk = backing.subarray(2, 65538);
    for (let index = 0; index < 128; index++) expected.update(chunk);
    let cleaned = false;
    const result = await runMediaProcess(
      node,
      script(`
    const { createHash } = require('node:crypto');
    const hash = createHash('sha256'); let count = 0;
    process.stdin.on('data', chunk => { hash.update(chunk); count += chunk.length; });
    process.stdin.on('end', () => process.stdout.write(JSON.stringify({ count, hash: hash.digest('hex') })));
  `),
      {
        signal: new AbortController().signal,
        input: async function* (signal) {
          try {
            assert.equal(signal.aborted, false);
            yield new Uint8Array();
            for (let index = 0; index < 128; index++) yield chunk;
          } finally {
            await delay(20);
            cleaned = true;
          }
        },
      },
    );
    assert.deepEqual(JSON.parse(result.stdout.toString()), {
      count: 128 * 65536,
      hash: expected.digest("hex"),
    });
    assert.equal(cleaned, true);
  },
);

test(
  "a paused subprocess applies backpressure to the input producer",
  { timeout: 10000 },
  async () => {
    let produced = 0;
    let countAtReady = -1;
    let stdout = "";
    await runMediaProcess(
      node,
      script(`
    process.stdout.write('ready\\n');
    setTimeout(() => {
      let count = 0;
      process.stdin.on('data', chunk => { count += chunk.length; });
      process.stdin.on('end', () => process.stdout.write(String(count)));
    }, 200);
  `),
      {
        signal: new AbortController().signal,
        onStdout(chunk) {
          stdout += chunk.toString();
          if (countAtReady < 0 && stdout.includes("ready")) countAtReady = produced;
        },
        input: async function* () {
          const chunk = new Uint8Array(1024 * 1024);
          for (let index = 0; index < 32; index++) {
            produced++;
            yield chunk;
          }
        },
      },
    );
    assert.ok(
      countAtReady >= 1 && countAtReady < 32,
      `producer outran the subprocess: ${countAtReady}`,
    );
    assert.equal(produced, 32);
    assert.equal(stdout, `ready\n${32 * 1024 * 1024}`);
  },
);

test(
  "producer failures stop the child and await asynchronous iterator cleanup",
  { timeout: 5000 },
  async () => {
    const ready = deferred<number>();
    let cleaned = false;
    const sourceFailure = new Error("Frame renderer failed at frame 2");
    const running = runMediaProcess(
      node,
      script(`
    process.stdout.write(String(process.pid)); process.stdin.resume(); setInterval(() => {}, 1000);
  `),
      {
        signal: new AbortController().signal,
        onStdout(chunk) {
          ready.resolve(Number(chunk.toString()));
        },
        input: async function* () {
          try {
            await ready.promise;
            yield new Uint8Array([1, 2, 3]);
            throw sourceFailure;
          } finally {
            await delay(30);
            cleaned = true;
          }
        },
      },
    );
    await assert.rejects(running, (error) => error === sourceFailure);
    assert.equal(cleaned, true);
    dead(await ready.promise);
  },
);

test(
  "an early successful exit aborts a waiting producer and cannot report complete input",
  { timeout: 5000 },
  async () => {
    const outer = new AbortController();
    let inner: AbortSignal | undefined;
    let cleaned = false;
    const running = runMediaProcess(node, script("process.exit(0)"), {
      signal: outer.signal,
      input: async function* (signal) {
        inner = signal;
        try {
          await aborted(signal);
        } finally {
          await delay(30);
          cleaned = true;
        }
      },
    });
    await assert.rejects(running, /exited before all media input was written/);
    assert.notEqual(inner, outer.signal);
    assert.equal(inner?.aborted, true);
    assert.equal(outer.signal.aborted, false);
    assert.equal(cleaned, true);
  },
);

test(
  "early encoder failure retains the subprocess diagnostic after input cleanup",
  { timeout: 5000 },
  async () => {
    let cleaned = false;
    const running = runMediaProcess(
      node,
      script("process.stderr.write('encoder unavailable'); process.exit(7)"),
      {
        signal: new AbortController().signal,
        input: async function* (signal) {
          try {
            await aborted(signal);
          } finally {
            cleaned = true;
          }
        },
      },
    );
    await assert.rejects(running, /exited with code 7: encoder unavailable/);
    assert.equal(cleaned, true);
  },
);

test(
  "cancellation waits for both a blocked producer and the process to stop",
  { timeout: 5000 },
  async () => {
    const controller = new AbortController();
    const ready = deferred<number>();
    const sourceReady = deferred();
    let cleaned = false;
    const running = runMediaProcess(
      node,
      script("process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)"),
      {
        signal: controller.signal,
        onStdout(chunk) {
          ready.resolve(Number(chunk.toString()));
        },
        input: async function* (signal) {
          sourceReady.resolve();
          try {
            await aborted(signal);
          } finally {
            await delay(50);
            cleaned = true;
          }
        },
      },
    );
    await Promise.all([ready.promise, sourceReady.promise]);
    controller.abort();
    await assert.rejects(running, { name: "AbortError" });
    assert.equal(cleaned, true);
    dead(await ready.promise);
  },
);

test(
  "cancellation unblocks a pending pipe write and returns the iterator",
  { timeout: 5000 },
  async () => {
    const controller = new AbortController();
    const ready = deferred<number>();
    let cleaned = false;
    const running = runMediaProcess(
      node,
      script("process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)"),
      {
        signal: controller.signal,
        onStdout(chunk) {
          ready.resolve(Number(chunk.toString()));
        },
        input: async function* () {
          try {
            yield new Uint8Array(16 * 1024 * 1024);
          } finally {
            await delay(30);
            cleaned = true;
          }
        },
      },
    );
    await ready.promise;
    controller.abort();
    await assert.rejects(running, { name: "AbortError" });
    assert.equal(cleaned, true);
    dead(await ready.promise);
  },
);

test(
  "a broken pipe stops input without an unhandled EPIPE or leaked child",
  { timeout: 5000 },
  async () => {
    const ready = deferred<number>();
    let cleaned = false;
    let signal: AbortSignal | undefined;
    const running = runMediaProcess(
      node,
      script(`
    require('node:fs').closeSync(0); process.stdout.write(String(process.pid)); setInterval(() => {}, 1000);
  `),
      {
        signal: new AbortController().signal,
        onStdout(chunk) {
          ready.resolve(Number(chunk.toString()));
        },
        input: async function* (inner) {
          signal = inner;
          try {
            await ready.promise;
            yield new Uint8Array(16 * 1024 * 1024);
          } finally {
            await delay(20);
            cleaned = true;
          }
        },
      },
    );
    await assert.rejects(running, /EPIPE|exited with code/);
    assert.equal(signal?.aborted, true);
    assert.equal(cleaned, true);
    dead(await ready.promise);
  },
);

test(
  "even a rejecting custom iterator is returned, and malformed chunks are rejected",
  { timeout: 5000 },
  async () => {
    for (const invalidChunk of [false, true]) {
      let returned = false;
      const sourceFailure = new Error("custom iterator rejected next");
      const running = runMediaProcess(
        node,
        script("process.stdin.resume(); setInterval(() => {}, 1000)"),
        {
          signal: new AbortController().signal,
          input: () => ({
            [Symbol.asyncIterator]() {
              return {
                async next(): Promise<IteratorResult<Uint8Array>> {
                  if (invalidChunk)
                    return { done: false, value: "not bytes" as unknown as Uint8Array };
                  throw sourceFailure;
                },
                async return() {
                  await delay(20);
                  returned = true;
                  return { done: true as const, value: undefined };
                },
              };
            },
          }),
        },
      );
      await assert.rejects(
        running,
        invalidChunk ? /must yield Uint8Array/ : (error) => error === sourceFailure,
      );
      assert.equal(returned, true);
    }
  },
);

test("spawn failure aborts and cleans an already-created producer", { timeout: 5000 }, async () => {
  let cleaned = false;
  const running = runMediaProcess("/this/media-encoder-does-not-exist", [], {
    signal: new AbortController().signal,
    input: async function* (signal) {
      try {
        await aborted(signal);
      } finally {
        await delay(20);
        cleaned = true;
      }
    },
  });
  await assert.rejects(running, { code: "ENOENT" });
  assert.equal(cleaned, true);
});

test(
  "pre-cancelled calls never invoke input and calls without input retain ignored stdin",
  { timeout: 5000 },
  async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await assert.rejects(
      runMediaProcess(node, script("process.exit(99)"), {
        signal: controller.signal,
        input: async function* () {
          called = true;
        },
      }),
      { name: "AbortError" },
    );
    assert.equal(called, false);
    const result = await runMediaProcess(
      node,
      script(`
    process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('input ended'));
    process.stderr.write('diagnostic');
  `),
      { signal: new AbortController().signal },
    );
    assert.equal(result.stdout.toString(), "input ended");
    assert.equal(result.stderr, "diagnostic");
  },
);

test(
  "progress callback failure aborts the producer and preserves the original failure",
  { timeout: 5000 },
  async () => {
    const callbackFailure = new Error("export progress persistence failed");
    let cleaned = false;
    const running = runMediaProcess(
      node,
      script(`
    process.stderr.write('out_time_us=500000\\n'); setInterval(() => {}, 1000);
  `),
      {
        signal: new AbortController().signal,
        durationSeconds: 1,
        progressStream: "stderr",
        async onProgress() {
          await delay(10);
          throw callbackFailure;
        },
        input: async function* (signal) {
          try {
            await aborted(signal);
          } finally {
            await delay(20);
            cleaned = true;
          }
        },
      },
    );
    await assert.rejects(running, (error) => error === callbackFailure);
    assert.equal(cleaned, true);
  },
);

test(
  "cancellation waits for forceful termination when a subprocess ignores SIGTERM",
  { timeout: 5000 },
  async () => {
    const controller = new AbortController();
    const ready = deferred<number>();
    let cleaned = false;
    const running = runMediaProcess(
      node,
      script(`
    process.on('SIGTERM', () => {}); process.stdout.write(String(process.pid)); setInterval(() => {}, 1000);
  `),
      {
        signal: controller.signal,
        onStdout(chunk) {
          ready.resolve(Number(chunk.toString()));
        },
        input: async function* (signal) {
          try {
            await aborted(signal);
          } finally {
            cleaned = true;
          }
        },
      },
    );
    await ready.promise;
    controller.abort();
    await assert.rejects(running, { name: "AbortError" });
    assert.equal(cleaned, true);
    dead(await ready.promise);
  },
);
