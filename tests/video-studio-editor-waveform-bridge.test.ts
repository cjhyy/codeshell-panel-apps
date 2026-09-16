import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  createTrack,
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
} from "../apps/video-studio/src/editor/defaults";
import {
  createEditorTaskBridge,
  EDITOR_DEMO_NARRATION_SHA,
} from "../apps/video-studio/src/editor/task-bridge";
import type { RuntimeBridge, RuntimeJob } from "../apps/video-studio/src/sdk/panel-runtime";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture(fault?: string) {
  const sourceHash = fault === "builtin" ? EDITOR_DEMO_NARRATION_SHA : "a".repeat(64),
    sourceId = `asset-${sourceHash}`,
    peaks = Buffer.alloc(20000 * 6);
  for (let i = 0; i < 20000; i++) {
    peaks.writeInt16LE(-16000, i * 6);
    peaks.writeInt16LE(16000, i * 6 + 2);
    peaks.writeInt16LE(10000, i * 6 + 4);
  }
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      sourceHash,
      sampleRate: 48000,
      channels: 2,
      hasAudio: true,
      sampleCount: 19200000,
      samplesPerBin: 960,
      peakScale: 1,
      peaksBase64: peaks.toString("base64"),
    }),
  );
  const artifact = {
    id: `asset-${sha(bytes)}`,
    sha256: sha(bytes),
    bytes: bytes.length,
    mimeType: "application/json",
  };
  const calls: { method: string; params: any }[] = [];
  let cwd = "/original",
    stagedDocument: any;
  const job: RuntimeJob = {
    id: "wave-job",
    status: "succeeded",
    attempt: 1,
    createdAt: 0,
    updatedAt: 0,
    result: {
      result: {
        resourceId: sourceId,
        sourceHash,
        recipeHash: "b".repeat(64),
        waveform: artifact,
        reused: true,
        reusedPcm: false,
      },
    },
  };
  const raw: RuntimeBridge = {
    getContext: async () => ({
      cwd,
      availableMethods: [
        "tasks.start",
        "tasks.get",
        "tasks.cancel",
        "tasks.retry",
        "resources.get",
        "resources.read",
      ],
      capabilities: {
        bridge: { maxCallsPerWindow: 10000 },
        tasks: { maxInputBytes: 2 * 1024 * 1024 },
      },
    }),
    on: () => () => {},
    async call(method, params: any) {
      calls.push({ method, params });
      if (method === "tasks.start") {
        const request = params.input.request;
        if (request.action === "prepare-source-video") {
          const proxy = {
            id: `asset-${"b".repeat(64)}`,
            sha256: "b".repeat(64),
            mimeType: "video/mp4",
            bytes: 1000,
          };
          job.result = {
            result: {
              resourceId: sourceId,
              sourceHash,
              proxy,
              recipe: {
                mimeType: "video/mp4",
                sourceHash: fault === "proxy-identity" ? "f".repeat(64) : sourceHash,
                sha256: proxy.sha256,
                recipeHash: "c".repeat(64),
                width: 64,
                height: 48,
                frameCount: 30,
                sourceOriginSeconds: 0,
                color: { space: "bt709", primaries: "bt709", transfer: "bt709", range: "tv" },
              },
            },
          };
        } else if (request.action === "stage-status")
          job.result = { result: { resourceIds: [], chunks: [] } };
        else if (request.action === "stage-document") {
          stagedDocument = JSON.parse(Buffer.from(request.dataBase64, "base64").toString());
          job.result = { result: {} };
        } else if (request.action === "commit")
          job.result = {
            result: { documentHash: request.documentHash, sequenceId: request.sequenceId },
          };
        else if (request.action === "analyze-asset-waveform")
          job.result = {
            result: {
              documentHash: request.documentHash,
              sequenceId: request.sequenceId,
              assetId: request.assetIds[0],
              origin: stagedDocument.production?.waveformAnalysisOrigin ?? {
                documentId: stagedDocument.id,
                revision: stagedDocument.revision,
                sequenceId: stagedDocument.activeSequenceId,
                assetId: request.assetIds[0],
                documentHash: request.documentHash,
              },
              resourceId: sourceId,
              sourceHash,
              recipeHash: "b".repeat(64),
              waveform: artifact,
              reused: true,
              reusedPcm: false,
            },
          };
        return job as any;
      }
      if (method === "tasks.get") return job as any;
      if (method === "resources.read") {
        const chunk = Buffer.from(bytes.subarray(params.offset, params.offset + params.length));
        if (fault === "digest" && params.offset === 0) chunk[0] = 0;
        if (fault === "workspace") cwd = "/other";
        return {
          assetId: fault === "identity" ? sourceId : artifact.id,
          totalBytes: artifact.bytes,
          offset: params.offset,
          eof: params.offset + chunk.length === bytes.length,
          dataBase64: chunk.toString("base64"),
        } as any;
      }
      throw new Error(`Unexpected method ${method}`);
    },
  };
  return { bridge: createEditorTaskBridge(raw), calls, sourceId, bytes };
}
test("waveform bridge materializes only the requested source and verifies bounded artifact chunks", async () => {
  const f = fixture();
  try {
    const result = await f.bridge.analyzeWaveform(f.sourceId, { sourceDuration: 96000000 });
    assert.equal(result.waveform.data.length, 60000);
    assert.equal(result.reused, true);
    const start = f.calls.find((call) => call.method === "tasks.start")!.params;
    assert.deepEqual(start.input.resources, [
      { assetId: f.sourceId, path: "inputs/resource-0.bin" },
    ]);
    assert.equal(start.input.request.action, "analyze-waveform");
    const reads = f.calls.filter((call) => call.method === "resources.read");
    assert.ok(reads.length > 1);
    assert.ok(reads.every((call) => call.params.length <= 32768));
  } finally {
    f.bridge.dispose();
  }
});
for (const fault of ["digest", "identity", "workspace"])
  test(`waveform bridge rejects ${fault} changes without publishing a waveform`, async () => {
    const f = fixture(fault);
    try {
      await assert.rejects(f.bridge.analyzeWaveform(f.sourceId, { sourceDuration: 96000000 }));
    } finally {
      f.bridge.dispose();
    }
  });
test("waveform bridge rejects impossible duration before a task starts", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.bridge.analyzeWaveform(f.sourceId, { sourceDuration: Infinity }));
    assert.equal(f.calls.length, 0);
  } finally {
    f.bridge.dispose();
  }
});

test("single-source video bridge sends exactly one source and verifies proxy source identity", async () => {
  const f = fixture();
  try {
    const result = await f.bridge.prepareSourceVideo(f.sourceId, { sourceDuration: 240000 });
    assert.equal(result.recipe.width, 64);
    const jobs = f.calls.filter((call) => call.method === "tasks.start");
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.params.input.request.action, "prepare-source-video");
    assert.equal(jobs[0]!.params.input.resources.length, 1);
  } finally {
    f.bridge.dispose();
  }
  const stale = fixture("proxy-identity");
  try {
    await assert.rejects(
      stale.bridge.prepareSourceVideo(stale.sourceId, { sourceDuration: 240000 }),
      /兼容画面回执/,
    );
  } finally {
    stale.bridge.dispose();
  }
});

test("builtin asset waveform bridge stages the canonical sequence and never gives the Host a synthetic resource or file path", async () => {
  const f = fixture("builtin"),
    asset = {
      id: "demo-narration-v1",
      name: "示例旁白 · 从想法，到成片。",
      kind: "audio",
      duration: 24 * 240000,
      metadata: { mimeType: "audio/mpeg" },
    };
  const document = {
    schemaVersion: 2,
    timebase: 240000,
    id: "builtin-doc",
    name: "Builtin",
    revision: 0,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: [asset],
    sequences: [
      {
        id: "main",
        name: "Main",
        width: 64,
        height: 48,
        frameRate: { numerator: 30, denominator: 1 },
        background: "#000000",
        timelineMode: "free",
        tracks: [createTrack("a", "audio")],
        clips: [
          {
            id: "clip",
            kind: "media",
            label: "旁白",
            assetId: asset.id,
            trackId: "a",
            start: 0,
            duration: asset.duration,
            timeMap: {
              points: [
                { time: 0, source: 0 },
                { time: asset.duration, source: asset.duration },
              ],
            },
            audio: defaultAudioMix(),
            transform: defaultTransform(),
            color: defaultColorAdjustment(),
            blendMode: "normal",
          },
        ],
        transitions: [],
        markers: [],
      },
    ],
  };
  try {
    const full = structuredClone(document);
    const sequence = full.sequences[0]!;
    sequence.tracks.push(createTrack("v", "video"));
    for (let i = 0; i < 118; i++) {
      const id = `camera-${i}`;
      (full.assets as any[]).push({
        id,
        resourceId: `asset-${i.toString(16).padStart(64, "0")}`,
        kind: "video",
        name: id,
        duration: 240000,
        width: 64,
        height: 48,
      });
      const clip = {
        ...structuredClone(sequence.clips[0]!),
        id,
        assetId: id,
        trackId: "v",
        start: i * 240000,
        duration: 240000,
        timeMap: {
          points: [
            { time: 0, source: 0 },
            { time: 240000, source: 240000 },
          ],
        },
      };
      sequence.clips.push(clip);
    }
    const large = await f.bridge.analyzeAssetWaveform(full, "main", asset.id);
    assert.equal(large.origin.documentId, full.id);
    assert.equal(
      f.calls
        .filter((call) => call.method === "tasks.start")
        .some((call) => call.params.input.resources.length > 0),
      false,
    );
    const firstChunk = f.calls.find(
      (call) =>
        call.method === "tasks.start" && call.params.input.request.action === "stage-document",
    )!.params.input.request.dataBase64;
    const analysisDocument = JSON.parse(Buffer.from(firstChunk, "base64").toString());
    assert.equal(analysisDocument.assets.length, 1);
    assert.equal(analysisDocument.sequences.length, 1);
    const original = JSON.stringify(document);
    const result = await f.bridge.analyzeAssetWaveform(document, "main", asset.id);
    assert.equal(result.waveform.sourceHash, EDITOR_DEMO_NARRATION_SHA);
    assert.equal(result.snapshot, undefined);
    assert.equal(result.analysisSnapshot!.sequenceId, "waveform-source");
    assert.notEqual(result.analysisSnapshot!.documentId, document.id);
    assert.equal(result.origin.documentId, document.id);
    assert.equal(JSON.stringify(document), original);
    await assert.rejects(
      f.bridge.prepareAudioForPreview(document, "main", { snapshot: result.analysisSnapshot }),
      /快照与当前工程/,
    );
    const jobs = f.calls.filter((call) => call.method === "tasks.start");
    assert.ok(jobs.some((call) => call.params.input.request.action === "commit"));
    const analyze = jobs.find(
      (call) => call.params.input.request.action === "analyze-asset-waveform",
    )!;
    assert.deepEqual(analyze.params.input.request.assetIds, [asset.id]);
    assert.deepEqual(analyze.params.input.resources, []);
    assert.ok(jobs.every((call) => call.params.input.resources.length === 0));
    const supplied = await f.bridge.stage(document, "main");
    const reused = await f.bridge.analyzeAssetWaveform(document, "main", asset.id, {
      snapshot: supplied,
    });
    assert.equal(reused.snapshot, supplied);
    assert.equal(reused.analysisSnapshot, undefined);
  } finally {
    f.bridge.dispose();
  }
});
