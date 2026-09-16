import assert from "node:assert/strict";
import test from "node:test";
import {
  StreamingPreviewAudio,
  type PreviewPcmStream,
} from "../apps/video-studio/src/editor/stream-audio";
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture(read?: PreviewPcmStream["read"], sampleCount = 48000 * 3600) {
  const nodes: any[] = [],
    reads: Array<{ start: number; count: number; signal: AbortSignal }> = [],
    errors: unknown[] = [];
  const context = {
    currentTime: 0,
    destination: {},
    createBuffer(_channels: number, count: number, rate: number) {
      assert.equal(count <= 96000, true);
      assert.equal(rate, 48000);
      const arrays = [new Float32Array(count), new Float32Array(count)];
      return { getChannelData: (channel: number) => arrays[channel], arrays };
    },
    createBufferSource() {
      const node = {
        buffer: undefined as any,
        startAt: 0,
        stopped: false,
        connected: false,
        connect() {
          node.connected = true;
        },
        disconnect() {
          node.connected = false;
        },
        start(at: number) {
          node.startAt = at;
        },
        stop() {
          node.stopped = true;
        },
      };
      nodes.push(node);
      return node;
    },
  };
  const pcm: PreviewPcmStream = {
    sampleRate: 48000,
    numberOfChannels: 2,
    sampleCount,
    dispose() {},
    read: async (start, count, signal) => {
      reads.push({ start, count, signal });
      return read
        ? read(start, count, signal)
        : [
            Float32Array.from({ length: count }, (_, i) => ((start + i) % 2 ? 0.75 : 1.25)),
            new Float32Array(count).fill(-0.25),
          ];
    },
  };
  const own = new AbortController(),
    player = new StreamingPreviewAudio(
      context as unknown as AudioContext,
      pcm,
      123,
      own.signal,
      (error) => errors.push(error),
    );
  return { player, context, nodes, reads, errors, own };
}
test("hour-long streamed PCM keeps a six-second lookahead, exact stereo samples and an audio clock", async () => {
  const f = fixture();
  try {
    await f.player.start();
    await turn();
    assert.equal(f.nodes.length, 3);
    assert.equal(f.reads.length, 3);
    assert.deepEqual(
      f.reads.map((read) => read.start),
      [123, 96123, 192123],
    );
    assert.equal(f.nodes[0].buffer.arrays[0][0], 0.75);
    assert.equal(f.nodes[0].buffer.arrays[0][1], 1.25);
    assert.equal(f.nodes[0].buffer.arrays[1][4], -0.25);
    assert.equal(f.nodes[1].startAt, f.nodes[0].startAt + 2);
    assert.equal(f.nodes[2].startAt, f.nodes[1].startAt + 2);
    f.context.currentTime = f.nodes[0].startAt + 1.125;
    assert.equal(f.player.sample, 123 + 54000);
    assert.equal(f.player.buffering, false);
    f.context.currentTime = f.nodes[1].startAt + 0.5;
    assert.equal(f.player.sample, 123 + 120000);
    assert.equal(f.nodes[0].connected, false);
    assert.deepEqual(f.errors, []);
  } finally {
    f.player.stop();
  }
  assert.ok(f.nodes.every((node) => !node.connected));
});
test("slow PCM reads freeze at the last heard sample then resume without skipping or replaying a range", async () => {
  let finish: ((value: [Float32Array, Float32Array]) => void) | undefined;
  const f = fixture(async (start, count) =>
    start === 123
      ? [new Float32Array(count), new Float32Array(count)]
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  try {
    await f.player.start();
    while (!finish) await turn();
    f.context.currentTime = 9;
    assert.equal(f.player.sample, 96123);
    assert.equal(f.player.buffering, true);
    const pending = finish;
    finish = undefined;
    pending([new Float32Array(96000), new Float32Array(96000)]);
    await turn();
    assert.equal(f.nodes[1].startAt, 9.035);
    assert.equal(f.reads[1]!.start, 96123);
    f.context.currentTime = 9.535;
    assert.equal(f.player.sample, 120123);
    assert.equal(f.player.buffering, false);
  } finally {
    f.player.stop();
    finish?.([new Float32Array(96000), new Float32Array(96000)]);
    await turn();
  }
});
test("cancelling playback aborts a pending PCM block and a late result cannot start a node", async () => {
  let finish: ((value: [Float32Array, Float32Array]) => void) | undefined;
  const f = fixture(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.player.start();
  while (!finish) await turn();
  f.own.abort();
  assert.equal(f.reads[0]!.signal.aborted, true);
  finish([new Float32Array(96000), new Float32Array(96000)]);
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(f.nodes.length, 0);
  assert.deepEqual(f.errors, []);
});
test("invalid or incomplete chunks stop audio and final partial chunks end on the exact last sample", async () => {
  const invalid = fixture(async () => [new Float32Array(3), new Float32Array(3)]);
  await assert.rejects(invalid.player.start(), /不完整/);
  assert.equal(invalid.nodes.length, 0);
  const f = fixture(undefined, 100123);
  try {
    await f.player.start();
    await turn();
    assert.deepEqual(
      f.reads.map((read) => read.count),
      [96000, 4000],
    );
    f.context.currentTime = f.nodes[1].startAt + 4000 / 48000 + 1;
    assert.equal(f.player.sample, 100123);
    assert.equal(f.player.buffering, false);
  } finally {
    f.player.stop();
  }
});
