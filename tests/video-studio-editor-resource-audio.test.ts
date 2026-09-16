import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  readFloatWaveHeader,
  loadEditorPreviewAudio,
} from "../apps/video-studio/src/editor/resource-audio";

function wave(samples = 5000, extensible = true): Uint8Array {
  const fmtLength = extensible ? 40 : 16,
    offset = 12 + 8 + fmtLength + 8;
  const bytes = new Uint8Array(offset + samples * 8),
    view = new DataView(bytes.buffer);
  const tag = (at: number, value: string) =>
    [...value].forEach((c, index) => (bytes[at + index] = c.charCodeAt(0)));
  tag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, fmtLength, true);
  view.setUint16(20, extensible ? 65534 : 3, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 384000, true);
  view.setUint16(32, 8, true);
  view.setUint16(34, 32, true);
  if (extensible) {
    view.setUint16(36, 22, true);
    view.setUint16(38, 32, true);
    view.setUint32(40, 3, true);
    bytes.set([3, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113], 44);
  }
  tag(offset - 8, "data");
  view.setUint32(offset - 4, samples * 8, true);
  for (let sample = 0; sample < samples; sample++) {
    view.setFloat32(offset + sample * 8, sample / samples, true);
    view.setFloat32(offset + sample * 8 + 4, -sample / samples, true);
  }
  return bytes;
}
class SampleBuffer {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly length: number;
  readonly duration: number;
  private channels: Float32Array[];
  constructor(options: { numberOfChannels: number; sampleRate: number; length: number }) {
    this.numberOfChannels = options.numberOfChannels;
    this.sampleRate = options.sampleRate;
    this.length = options.length;
    this.duration = this.length / this.sampleRate;
    this.channels = Array.from(
      { length: this.numberOfChannels },
      () => new Float32Array(this.length),
    );
  }
  getChannelData(channel: number) {
    return this.channels[channel]!;
  }
}
function setup(bytes = wave()) {
  const sha256 = createHash("sha256").update(bytes).digest("hex"),
    resource = { id: `asset-${sha256}`, bytes: bytes.length, sha256, mimeType: "audio/wav" };
  const reads: any[] = [];
  const bridge = {
    getContext: async () => ({
      availableMethods: ["resources.read"],
      capabilities: { bridge: { maxCallsPerWindow: 10000 } },
    }),
    call: async (method: string, params: any) => {
      assert.equal(method, "resources.read");
      reads.push(params);
      assert(params.length <= 32768);
      const part = bytes.subarray(params.offset, params.offset + params.length);
      return {
        assetId: resource.id,
        offset: params.offset,
        totalBytes: bytes.length,
        eof: params.offset + part.length === bytes.length,
        dataBase64: Buffer.from(part).toString("base64"),
      };
    },
    on: () => () => {},
  };
  return { bridge, resource, reads };
}
const identity = { documentId: "doc", revision: 3, sequenceId: "seq", sampleCount: 5000 };

test("float WAV inspector accepts standard and extensible stereo without changing sample values", () => {
  for (const extensible of [false, true]) {
    const bytes = wave(5000, extensible);
    const header = readFloatWaveHeader(bytes.subarray(0, 128), bytes.length);
    assert.equal(header.sampleCount, 5000);
    assert.equal(header.dataBytes, 40000);
    assert.equal(header.dataOffset, extensible ? 68 : 44);
  }
});
test("float WAV inspector rejects incomplete containers, wrong format/rate and non-whole samples", () => {
  const original = wave();
  assert.throws(() => readFloatWaveHeader(original, original.length + 1), /完整/);
  for (const [at, value] of [
    [24, 44100],
    [44, 1],
    [64, 39999],
  ]) {
    const bytes = original.slice();
    new DataView(bytes.buffer).setUint32(at, value, true);
    assert.throws(() => readFloatWaveHeader(bytes, bytes.length));
  }
  assert.throws(() => readFloatWaveHeader(original.subarray(0, 40), original.length), /文件头/);
});
test("resource audio copies stereo PCM across bounded chunks with exact identity and headroom", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "AudioBuffer");
  Object.defineProperty(globalThis, "AudioBuffer", { value: SampleBuffer, configurable: true });
  try {
    const bytes = wave();
    new DataView(bytes.buffer).setFloat32(68, 1.5, true);
    const { bridge, resource, reads } = setup(bytes),
      progress: number[] = [];
    const result = await loadEditorPreviewAudio(
      bridge,
      resource,
      identity,
      new AbortController().signal,
      (value) => progress.push(value),
    );
    assert.equal(result.buffer.sampleRate, 48000);
    assert.equal(result.buffer.length, 5000);
    assert.equal(result.revision, 3);
    assert.equal(result.buffer.getChannelData(0)[0], 1.5);
    assert.equal(result.buffer.getChannelData(1)[4999], Math.fround(-4999 / 5000));
    assert.equal(reads.length, 3);
    assert.equal(progress.at(-1), 1);
  } finally {
    if (original) Object.defineProperty(globalThis, "AudioBuffer", original);
    else delete (globalThis as any).AudioBuffer;
  }
});
test("resource audio rejects stale receipts, truncated data, sample mismatches and cancellation", async () => {
  const { bridge, resource } = setup();
  await assert.rejects(
    loadEditorPreviewAudio(
      bridge,
      { ...resource, sha256: "0".repeat(64) },
      identity,
      new AbortController().signal,
    ),
    /无效/,
  );
  await assert.rejects(
    loadEditorPreviewAudio(
      bridge,
      resource,
      { ...identity, sampleCount: 4999 },
      new AbortController().signal,
    ),
    /时长/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadEditorPreviewAudio(bridge, resource, identity, controller.signal), {
    name: "AbortError",
  });
  await assert.rejects(
    loadEditorPreviewAudio(
      {
        ...bridge,
        call: async (method, params) => ({
          ...(await bridge.call(method, params)),
          totalBytes: 12,
        }),
      },
      resource,
      identity,
      new AbortController().signal,
    ),
    /身份/,
  );
  await assert.rejects(
    loadEditorPreviewAudio(
      {
        ...bridge,
        call: async (method, params) => ({
          ...(await bridge.call(method, params)),
          dataBase64: "",
        }),
      },
      resource,
      identity,
      new AbortController().signal,
    ),
    /不完整/,
  );
});

function longWaveFixture(rf64 = false) {
  // A virtual 20-minute float WAV. Only requested byte ranges are allocated by this fixture.
  const sampleCount = (rf64 ? 4 * 3600 : 1200) * 48000,
    header = new Uint8Array(rf64 ? 80 : 44);
  const small = wave(1, false).subarray(0, 44),
    dataOffset = header.length;
  const total = dataOffset + sampleCount * 8,
    view = new DataView(header.buffer);
  if (rf64) {
    header.set(new TextEncoder().encode("RF64"));
    view.setUint32(4, 0xffffffff, true);
    header.set(new TextEncoder().encode("WAVEds64"), 8);
    view.setUint32(16, 28, true);
    view.setBigUint64(20, BigInt(total - 8), true);
    view.setBigUint64(28, BigInt(sampleCount * 8), true);
    view.setBigUint64(36, BigInt(sampleCount), true);
    header.set(small.subarray(12), 48);
    view.setUint32(76, 0xffffffff, true);
  } else {
    header.set(small);
    view.setUint32(4, total - 8, true);
    view.setUint32(40, sampleCount * 8, true);
  }
  const sha256 = "d".repeat(64),
    resource = { id: `asset-${sha256}`, sha256, bytes: total, mimeType: "audio/wav" };
  const reads: Array<{ offset: number; length: number }> = [];
  let bad = false;
  const bridge = {
    getContext: async () => ({
      availableMethods: ["resources.read"],
      capabilities: { bridge: { maxCallsPerWindow: 10000, maxTransferCallsPerWindow: 10000 } },
    }),
    on: () => () => {},
    call: async (_method: string, params: any) => {
      reads.push(params);
      assert.ok(params.length <= 32768);
      const buffer = new Uint8Array(params.length),
        data = new DataView(buffer.buffer);
      for (let i = 0; i < buffer.length; i++)
        if (params.offset + i < dataOffset) buffer[i] = header[params.offset + i]!;
      for (
        let absolute = Math.max(dataOffset, params.offset);
        absolute + 4 <= params.offset + buffer.length;
        absolute += 4
      ) {
        const word = (absolute - dataOffset) / 4,
          sample = Math.floor(word / 2);
        data.setFloat32(
          absolute - params.offset,
          bad ? NaN : ((word % 2 ? -1 : 1) * (sample % 1024)) / 512,
          true,
        );
      }
      return {
        assetId: resource.id,
        offset: params.offset,
        totalBytes: total,
        eof: params.offset + buffer.length === total,
        dataBase64: Buffer.from(buffer).toString("base64"),
      };
    },
  };
  return {
    bridge,
    resource,
    reads,
    sampleCount,
    header,
    corrupt: () => {
      bad = true;
    },
  };
}
test("twenty-minute audio prepares from one header read and seeks to exact PCM ranges without a full buffer", async () => {
  const f = longWaveFixture(),
    result = await loadEditorPreviewAudio(
      f.bridge,
      f.resource,
      { ...identity, sampleCount: f.sampleCount },
      new AbortController().signal,
    );
  assert.equal(result.buffer, undefined);
  assert.ok(result.stream);
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0]!.offset, 0);
  const sample = 1000 * 48000 + 17;
  try {
    const [left, right] = await result.stream.read(sample, 96000, new AbortController().signal);
    assert.equal(left.length, 96000);
    assert.equal(right.length, 96000);
    assert.equal(left[0], Math.fround((sample % 1024) / 512));
    assert.equal(right[95999], Math.fround(-((sample + 95999) % 1024) / 512));
    assert.equal(f.reads[1]!.offset, 44 + sample * 8);
    assert.ok(f.reads.reduce((sum, read) => sum + read.length, 0) < 1024 * 1024);
    await assert.rejects(result.stream.read(0, 192001, new AbortController().signal), /范围/);
    await assert.rejects(
      result.stream.read(f.sampleCount - 1, 2, new AbortController().signal),
      /范围/,
    );
    f.corrupt();
    await assert.rejects(result.stream.read(0, 8, new AbortController().signal), /无效采样/);
  } finally {
    result.stream.dispose();
  }
  await assert.rejects(result.stream.read(0, 8, new AbortController().signal), {
    name: "AbortError",
  });
});
test("disposing or cancelling a long PCM range rejects late reads instead of publishing their samples", async () => {
  for (const dispose of [true, false]) {
    const f = longWaveFixture();
    let finish: (() => void) | undefined;
    const bridge = {
      ...f.bridge,
      call: async (method: string, args: any) => {
        if (args.offset)
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        return f.bridge.call(method, args);
      },
    };
    const result = await loadEditorPreviewAudio(
      bridge,
      f.resource,
      { ...identity, sampleCount: f.sampleCount },
      new AbortController().signal,
    );
    const own = new AbortController(),
      pending = result.stream!.read(20, 20, own.signal);
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 0));
    dispose ? result.stream!.dispose() : own.abort();
    finish();
    await assert.rejects(pending, { name: "AbortError" });
    result.stream!.dispose();
  }
});
test("RF64 previews accept four-hour sample ranges above 4 GiB and reject corrupt 64-bit sizes", async () => {
  const f = longWaveFixture(true);
  assert.ok(f.resource.bytes > 0xffffffff);
  const result = await loadEditorPreviewAudio(
    f.bridge,
    f.resource,
    { ...identity, sampleCount: f.sampleCount },
    new AbortController().signal,
  );
  try {
    const start = f.sampleCount - 96000;
    const [left] = await result.stream!.read(start, 96000, new AbortController().signal);
    assert.equal(f.reads[1]!.offset, 80 + start * 8);
    assert.ok(f.reads[1]!.offset > 0xffffffff);
    assert.equal(left[0], Math.fround((start % 1024) / 512));
    assert.equal(left[95999], Math.fround(((start + 95999) % 1024) / 512));
  } finally {
    result.stream!.dispose();
  }
  for (const at of [20, 28, 36]) {
    const bytes = f.header.slice();
    new DataView(bytes.buffer).setBigUint64(at, 9007199254740992n, true);
    assert.throws(() => readFloatWaveHeader(bytes, f.resource.bytes), /无效/);
  }
  const missing = f.header.slice();
  missing[12] = 0;
  assert.throws(() => readFloatWaveHeader(missing, f.resource.bytes), /长度声明/);
});
