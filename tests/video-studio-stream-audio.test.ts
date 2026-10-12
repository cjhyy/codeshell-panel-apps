import assert from "node:assert/strict";
import test from "node:test";
import {
  StreamingPreviewAudio,
  type PreviewPcmStream,
} from "../apps/video-studio/src/editor/stream-audio";
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture(read?: PreviewPcmStream["read"], sampleCount = 48000 * 3600, correction?: { pcm: PreviewPcmStream; destination: AudioNode }) {
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
        connect(destination: unknown) {
          (node as any).destination = destination;
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
      correction,
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


test("live gain schedules both PCM sources at one sample clock and cancels both on late reads", async () => {
  let finish: ((value: [Float32Array, Float32Array]) => void) | undefined;
  const destination = {} as AudioNode, reads: number[] = [];
  const pcm: PreviewPcmStream = { sampleRate: 48000, numberOfChannels: 2, sampleCount: 48000 * 3600,
    dispose() {}, read: async (start, count) => { reads.push(start); return new Promise((resolve) => { finish = resolve; }); } };
  const f = fixture(undefined, pcm.sampleCount, { pcm, destination });
  const pending = f.player.start();
  while (!finish) await turn();
  assert.equal(f.nodes.length, 0, "base must wait for the exact corresponding stem block");
  finish([new Float32Array(96000).fill(0.2), new Float32Array(96000).fill(-0.3)]);
  await pending; await turn();
  assert.equal(f.nodes.length, 2); assert.equal(f.nodes[0].startAt, f.nodes[1].startAt);
  assert.equal((f.nodes[1] as any).destination, destination);
  assert.ok(Math.abs(f.nodes[1].buffer.arrays[1][1] + 0.3) < 1e-7);
  assert.deepEqual(reads, [123, 96123]);
  f.own.abort(); finish!([new Float32Array(96000), new Float32Array(96000)]); await turn();
  assert.equal(f.nodes.length, 2); assert.ok(f.nodes.every((node) => node.stopped && !node.connected));
  assert.deepEqual(f.errors, []);
});

test("paired stream setup releases partially constructed nodes when either source setup fails", async () => {
  for (const stage of ["buffer", "source", "connect", "start"] as const) {
    const signalReads: AbortSignal[] = [], pcm: PreviewPcmStream = { sampleRate: 48000, numberOfChannels: 2, sampleCount: 1000,
      dispose() {}, async read(_start, count, signal) { signalReads.push(signal); return [new Float32Array(count), new Float32Array(count)]; } },
      f = fixture(pcm.read, 1000, { pcm, destination: {} as AudioNode });
    const createBuffer = f.context.createBuffer, createSource = f.context.createBufferSource;
    let buffers = 0, sources = 0;
    f.context.createBuffer = (...args) => {
      if (++buffers === 2 && stage === "buffer") throw new Error("second buffer failed");
      return createBuffer(...args);
    };
    f.context.createBufferSource = () => {
      if (++sources === 2 && stage === "source") throw new Error("second source failed");
      const node = createSource(), connect = node.connect, start = node.start, ordinal = sources;
      let started = false;
      node.connect = (destination) => { connect(destination); if (ordinal === 2 && stage === "connect") throw new Error("second connect failed"); };
      node.start = (at) => { if (ordinal === 2 && stage === "start") throw new Error("second start failed"); start(at); started = true; };
      node.stop = () => {
        node.stopped = true;
        if (!started) throw new DOMException("not started", "InvalidStateError");
      };
      return node;
    };
    await assert.rejects(f.player.start(), /second .* failed/);
    assert.ok(f.nodes.every((node) => node.stopped && !node.connected), `${stage}: partial nodes must be stopped and disconnected`);
    assert.ok(signalReads.every((signal) => signal.aborted));
    assert.deepEqual(f.errors, []);
  }
});

test("a failed paired PCM read aborts both sources and releases every scheduled node", async () => {
  for (const failedSide of ["base", "stem"]) {
    const signals: AbortSignal[] = [], pcm: PreviewPcmStream = { sampleRate: 48000, numberOfChannels: 2, sampleCount: 300000,
      dispose() {}, async read(start, count, signal) {
        signals.push(signal);
        if (failedSide === "stem" && start > 123) throw new Error("stem read failed");
        return [new Float32Array(count), new Float32Array(count)];
      } }, f = fixture(async (start, count, signal) => {
        signals.push(signal);
        if (failedSide === "base" && start > 123) throw new Error("base read failed");
        return [new Float32Array(count), new Float32Array(count)];
      }, pcm.sampleCount, { pcm, destination: {} as AudioNode });
    await f.player.start(); await turn();
    assert.equal(f.errors.length, 1);
    assert.match(String(f.errors[0]), new RegExp(failedSide));
    assert.equal(f.nodes.length, 2);
    assert.ok(f.nodes.every((node) => node.stopped && !node.connected));
    assert.ok(signals.every((signal) => signal.aborted));
  }
});
