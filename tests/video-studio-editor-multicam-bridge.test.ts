import assert from "node:assert/strict";
import test from "node:test";
import { createEditorTaskBridge } from "../apps/video-studio/src/editor/task-bridge";
import { createTrack } from "../apps/video-studio/src/editor/defaults";
import type { EditorDocument } from "../apps/video-studio/src/editor/types";
import type { RuntimeBridge, RuntimeJob } from "../apps/video-studio/src/sdk/panel-runtime";
function fixture(fault?: string) {
  const ids = [`asset-${"a".repeat(64)}`, `asset-${"b".repeat(64)}`];
  const doc: EditorDocument = {
    schemaVersion: 2,
    timebase: 240000,
    id: "doc",
    name: "同步",
    revision: 4,
    activeSequenceId: "main",
    exportProfiles: [],
    assets: ids.map((resourceId, index) => ({
      id: `camera-${index}`,
      name: `机位 ${index}`,
      kind: "video",
      duration: 10 * 240000,
      width: 160,
      height: 90,
      resourceId,
    })),
    sequences: [
      {
        id: "main",
        name: "节目",
        width: 160,
        height: 90,
        frameRate: { numerator: 30, denominator: 1 },
        background: "#000000",
        timelineMode: "free",
        tracks: [createTrack("v", "video")],
        clips: [],
        transitions: [],
        markers: [],
      },
    ],
  };
  const calls: Array<{ method: string; params: any }> = [],
    jobs = new Map<string, RuntimeJob>();
  let cwd = "/editor",
    counter = 0;
  const raw: RuntimeBridge = {
    getContext: async () => ({
      cwd,
      availableMethods: [
        "tasks.start",
        "tasks.get",
        "tasks.cancel",
        "tasks.retry",
        "resources.get",
      ],
      capabilities: {
        bridge: { maxCallsPerWindow: 10000 },
        tasks: { maxInputBytes: 2 * 1024 * 1024 },
      },
    }),
    on: () => () => {},
    call: async (method, params: any) => {
      calls.push({ method, params });
      if (method === "tasks.start") {
        if (fault === "workspace") cwd = "/changed";
        const key = params.requestKey,
          existing = jobs.get(key);
        if (existing) return existing as any;
        const request = params.input.request,
          origin = structuredClone(request.alignment.origin),
          results = request.resourceIds.map((resourceId: string, index: number) => ({
            resourceId,
            sourceHash: resourceId.slice(6),
            offset: index ? 60000 : 0,
            confidence: 1,
            secondPeak: 0.2,
            overlapSeconds: 8,
            precisionTicks: 1200,
            reliable: true,
          }));
        if (fault === "hash") results[1].sourceHash = "f".repeat(64);
        if (fault === "range") results[1].offset = 999999999;
        if (fault === "origin") origin.revision++;
        const job: RuntimeJob = {
          id: `job-${++counter}`,
          status: fault === "running" ? "running" : "succeeded",
          attempt: 1,
          createdAt: 0,
          updatedAt: 0,
          result: {
            result: {
              referenceResourceId: request.alignment.referenceResourceId,
              reused: false,
              origin,
              results,
            },
          },
        };
        jobs.set(key, job);
        return job as any;
      }
      if (method === "tasks.get") {
        const job = [...jobs.values()].find(
          (job) => job.id === params.taskId || job.id === params.id,
        );
        return job as any;
      }
      return {} as any;
    },
  };
  return { doc, calls, jobs, bridge: createEditorTaskBridge(raw), ids };
}
test("alignment bridge sends only selected resources and exact readonly origin, maps native results to asset IDs", async () => {
  const f = fixture();
  try {
    const result = await f.bridge.alignMulticamSources(
      f.doc,
      ["camera-0", "camera-1"],
      "camera-0",
      { windowSeconds: 8, maxOffsetSeconds: 2 },
    );
    assert.equal(result.results[1]!.assetId, "camera-1");
    assert.equal(result.results[1]!.offset, 60000);
    assert.equal(result.revision, 4);
    const start = f.calls.find((c) => c.method === "tasks.start")!.params;
    assert.equal(start.input.resources.length, 2);
    assert.equal(start.input.request.alignment.origin.documentHash, result.documentHash);
    assert.equal(start.input.request.document, undefined);
    assert.deepEqual(
      start.input.request.alignment.origin.assets,
      f.doc.assets.map((a) => ({ assetId: a.id, resourceId: a.resourceId })),
    );
  } finally {
    f.bridge.dispose();
  }
});
test("background alignment returns without polling and repeated request identity uses the same Host request key and job", async () => {
  const f = fixture("running"),
    transferId = "editor-01234567-0123-4567-89ab-0123456789ab",
    tasks: string[] = [];
  try {
    const options = {
      windowSeconds: 8,
      maxOffsetSeconds: 2,
      transferId,
      onTask: (job: RuntimeJob) => tasks.push(job.id),
    };
    const first = await f.bridge.startMulticamAlignment(
        f.doc,
        ["camera-0", "camera-1"],
        "camera-0",
        options,
      ),
      again = await f.bridge.startMulticamAlignment(
        f.doc,
        ["camera-0", "camera-1"],
        "camera-0",
        options,
      );
    assert.equal(first.jobId, again.jobId);
    assert.equal(f.jobs.size, 1);
    assert.deepEqual(tasks, [first.jobId, first.jobId]);
    assert.equal(
      f.calls.some((c) => c.method === "tasks.get"),
      false,
    );
    assert.equal(
      f.calls.filter((c) => c.method === "tasks.start")[0]!.params.requestKey,
      f.calls.filter((c) => c.method === "tasks.start")[1]!.params.requestKey,
    );
    assert.equal(first.assets[1]!.resourceId, f.ids[1]);
    await assert.rejects(
      f.bridge.startMulticamAlignment(f.doc, ["camera-0", "camera-1"], "camera-0", {
        transferId: "invalid",
      }),
      /传输/,
    );
  } finally {
    f.bridge.dispose();
  }
});
for (const fault of ["hash", "range", "origin", "workspace"])
  test(`alignment refuses ${fault} mismatch`, async () => {
    const f = fixture(fault);
    try {
      await assert.rejects(
        f.bridge.alignMulticamSources(f.doc, ["camera-0", "camera-1"], "camera-0", {
          windowSeconds: 8,
          maxOffsetSeconds: 2,
        }),
      );
    } finally {
      f.bridge.dispose();
    }
  });
test("unimported/duplicate sources and invalid limits fail before a task starts", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.bridge.alignMulticamSources(f.doc, ["camera-0", "camera-1"], "camera-0", {
        windowSeconds: 8,
        maxOffsetSeconds: 7,
      }),
    );
    f.doc.assets[1]!.resourceId = f.doc.assets[0]!.resourceId;
    await assert.rejects(
      f.bridge.alignMulticamSources(f.doc, ["camera-0", "camera-1"], "camera-0"),
      /不同源文件/,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.bridge.dispose();
  }
});
