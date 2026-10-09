import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createHostAudioRecording,
  hostVideoCapabilities,
  type HostVideoCapabilities,
} from "../apps/video-studio/src/host-audio-recording.ts";
import type { PanelBridge } from "../apps/video-studio/src/host.ts";

const asset = {
  id: `asset-${"a".repeat(64)}`,
  name: "recording.webm",
  mimeType: "audio/webm",
  bytes: 1000,
  createdAt: 10,
};
function fixture(capabilities?: HostVideoCapabilities, videoEnabled = Boolean(capabilities)) {
  const state = {
    scope: "a:1",
    enabled: true,
    failed: false,
    saved: 0,
    published: [] as string[],
    assets: [asset],
    audioOnly: false,
  };
  const calls: { method: string; params: any }[] = [];
  const handlers = new Map<string, (params: any) => unknown>();
  const bridge = {
    call: async (method: string, params: any) => {
      calls.push({ method, params });
      if (handlers.has(method)) return handlers.get(method)!(params);
      if (method === "resources.recordAudio" || method === "resources.get") return { asset };
      if (method === "resources.list") return { assets: state.assets, total: state.assets.length };
      if (method === "resources.open") return { opened: true };
      throw new Error(`Unexpected call: ${method}`);
    },
  } as PanelBridge;
  let ui!: ReturnType<typeof createHostAudioRecording>;
  const create = () =>
    createHostAudioRecording({
      bridge: () => bridge,
      enabled: () => state.enabled,
      videoCapabilities: () => capabilities,
      videoEnabled: () => videoEnabled,
      audioOnly: () => state.audioOnly,
      scope: () => state.scope,
      maxDurationSeconds: () => 600,
      description: () => "录音",
      saveLabel: () => "保存到素材库",
      imported: (id) => state.published.includes(id),
      changed() {},
      publish: async (value, _name, check) => {
        check();
        if (state.failed) throw new Error("保存工程失败");
        state.published.push(value.id);
      },
      saved() {
        assert.equal(ui.busy, false);
        state.saved++;
      },
    });
  ui = create();
  return {
    state,
    calls,
    handlers,
    get ui() {
      return ui;
    },
    reopen() {
      ui.dispose();
      ui = create();
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

test("capture returns durable project audio without automatically attaching, and explicit attach is separate", async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  await f.ui.capture();
  assert.deepEqual(f.calls, [
    { method: "resources.recordAudio", params: { maxDurationSeconds: 600 } },
  ]);
  assert.deepEqual(f.ui.snapshot().assets, [asset]);
  assert.equal(f.state.published.length, 0);
  await f.ui.publish(asset.id);
  assert.deepEqual(f.state.published, [asset.id]);
  assert.equal(f.state.saved, 1);
});

test("failed document attachment retains the resource for download, explicit retry, and page reopen", async () => {
  const f = fixture();
  await f.ui.capture();
  f.state.failed = true;
  await assert.rejects(f.ui.publish(asset.id), /保存工程失败/);
  assert.deepEqual(f.ui.snapshot().assets, [asset]);
  await f.ui.open(asset.id);
  assert.deepEqual(f.calls.at(-1), { method: "resources.open", params: { assetId: asset.id } });
  f.reopen();
  await f.ui.refresh();
  assert.deepEqual(f.ui.snapshot().assets, [asset]);
  f.state.failed = false;
  await f.ui.publish(asset.id);
  assert.equal(f.calls.filter((call) => call.method === "resources.recordAudio").length, 1);
  assert.equal(f.state.saved, 1);
});

test("a lost capture reply does not record again and refresh recovers committed audio", async () => {
  const f = fixture();
  f.handlers.set("resources.recordAudio", () => {
    throw new Error("reply lost");
  });
  await assert.rejects(f.ui.capture(), /reply lost/);
  assert.equal(f.calls.length, 1);
  await f.ui.refresh();
  assert.deepEqual(f.ui.snapshot().assets, [asset]);
  assert.equal(f.calls.filter((call) => call.method === "resources.recordAudio").length, 1);
});

test("pending recording blocks navigation and concurrent starts; a late old-project reply never populates the new project", async () => {
  const f = fixture(),
    pending = deferred<unknown>();
  f.handlers.set("resources.recordAudio", () => pending.promise);
  const capture = f.ui.capture();
  assert.throws(() => f.ui.assertSafeToLeave(), /先结束/);
  await assert.rejects(f.ui.capture(), /先完成/);
  f.state.scope = "b:1";
  pending.resolve({ asset });
  await assert.rejects(capture, /工程已切换/);
  assert.deepEqual(f.ui.snapshot().assets, []);
  assert.equal(f.state.saved, 0);
  assert.equal(f.calls.length, 1);
});

test("source validation that completes after a project generation change cannot attach", async () => {
  const f = fixture(),
    pending = deferred<unknown>();
  await f.ui.refresh();
  f.handlers.set("resources.get", () => pending.promise);
  const attaching = f.ui.publish(asset.id);
  f.state.scope = "a:2";
  pending.resolve({ asset });
  await assert.rejects(attaching, /工程已切换/);
  assert.deepEqual(f.state.published, []);
});

test("project file pagination preserves audio even when the first page only contains images", async () => {
  const f = fixture();
  f.handlers.set("resources.list", ({ offset }) => ({
    total: 2,
    assets: offset === 0 ? [{ mimeType: "image/png" }] : [asset],
  }));
  await f.ui.refresh();
  assert.equal(f.ui.snapshot().hasMore, true);
  assert.deepEqual(f.ui.snapshot().assets, []);
  await f.ui.refresh(true);
  assert.equal(f.ui.snapshot().hasMore, false);
  assert.deepEqual(f.ui.snapshot().assets, [asset]);
  assert.equal(f.calls.at(-1)?.params.offset, 1);
});

test("cancelled capture and unavailable capability do not create records or invoke attachment", async () => {
  const f = fixture();
  f.handlers.set("resources.recordAudio", () => ({ cancelled: true }));
  await f.ui.capture();
  assert.deepEqual(f.ui.snapshot().assets, []);
  f.state.enabled = false;
  await assert.rejects(f.ui.capture(), /没有工作台录音/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.saved, 0);
});

test("rendered source names and scripts cannot insert active markup", async () => {
  const f = fixture();
  f.state.assets = [{ ...asset, name: '<img src=x onerror="bad">.wav' }];
  await f.ui.refresh();
  const markup = f.ui.render('<script>alert("bad")</script>');
  assert.doesNotMatch(markup, /<img|<script>/);
  assert.match(markup, /&lt;img/);
  assert.match(markup, /&lt;script/);
});

const videoCapabilities = {
  camera: true,
  screen: true,
  microphone: true,
  systemAudio: true,
  maxDurationSeconds: 1200,
  maxBytes: 200 * 1024 * 1024,
};
const videoAsset = { ...asset, id: `asset-${"b".repeat(64)}`, mimeType: "video/webm" };
test("trusted video capture uses discovered modes, explicit durable attachment and actual audio receipt", async () => {
  const f = fixture(videoCapabilities);
  f.handlers.set("resources.recordVideo", (params) => ({
    asset: videoAsset,
    capture: { source: params.source, microphone: true, systemAudio: false },
  }));
  await f.ui.action("rec-host-mode:screen");
  await f.ui.capture();
  assert.deepEqual(f.calls[0], {
    method: "resources.recordVideo",
    params: {
      source: "screen",
      microphone: true,
      systemAudio: true,
      maxDurationSeconds: 600,
      maxBytes: 200 * 1024 * 1024,
    },
  });
  assert.match(f.ui.snapshot().notice, /系统声音未录入/);
  assert.equal(f.state.published.length, 0);
  f.handlers.set("resources.get", () => ({ asset: videoAsset }));
  await f.ui.publish(videoAsset.id);
  assert.deepEqual(f.state.published, [videoAsset.id]);
  assert.match(f.ui.snapshot().notice, /视频已加入/);
});
test("camera-only devices hide screen, voice reference only offers microphone and cannot attach video", async () => {
  const f = fixture({ ...videoCapabilities, screen: false, systemAudio: false });
  assert.deepEqual(f.ui.modes(), ["microphone", "camera"]);
  assert.throws(() => f.ui.setMode("screen"), /没有所选/);
  f.state.audioOnly = true;
  assert.deepEqual(f.ui.modes(), ["microphone"]);
  assert.throws(() => f.ui.setMode("camera"), /没有所选/);
  f.handlers.set("resources.list", () => ({ assets: [videoAsset, asset], total: 2 }));
  await f.ui.refresh();
  assert.deepEqual(f.ui.snapshot().assets, [asset]);
});
test("unavailable device APIs still allow recovery of previously saved videos without a new capture", async () => {
  const f = fixture({
    ...videoCapabilities,
    camera: false,
    screen: false,
    microphone: false,
    systemAudio: false,
  });
  assert.deepEqual(f.ui.modes(), []);
  f.handlers.set("resources.list", () => ({ assets: [videoAsset], total: 1 }));
  await f.ui.refresh();
  assert.deepEqual(f.ui.snapshot().assets, [videoAsset]);
  await assert.rejects(f.ui.capture(), /没有所选/);
  assert.equal(f.calls.length, 1);
});
test("lost video reply is recovered on reopen; stale scope receipt and malformed capture cannot attach", async () => {
  const f = fixture(videoCapabilities);
  f.handlers.set("resources.recordVideo", () => {
    throw new Error("video reply lost");
  });
  f.ui.setMode("camera");
  await assert.rejects(f.ui.capture(), /video reply lost/);
  f.handlers.set("resources.list", () => ({ assets: [videoAsset], total: 1 }));
  f.reopen();
  await f.ui.refresh();
  assert.deepEqual(f.ui.snapshot().assets, [videoAsset]);
  assert.equal(f.calls.filter((c) => c.method === "resources.recordVideo").length, 1);
  const pending = deferred<unknown>();
  f.handlers.set("resources.recordVideo", () => pending.promise);
  f.ui.setMode("screen");
  const capturing = f.ui.capture();
  f.state.scope = "b:1";
  pending.resolve({
    asset: videoAsset,
    capture: { source: "screen", microphone: false, systemAudio: false },
  });
  await assert.rejects(capturing, /工程已切换/);
  assert.deepEqual(f.ui.snapshot().assets, []);
  f.handlers.set("resources.recordVideo", () => ({
    asset: videoAsset,
    capture: { source: "camera" },
  }));
  f.ui.setMode("camera");
  await assert.rejects(f.ui.capture(), /视频采集回执无效/);
});
test("video capabilities require bounded limits and booleans", () => {
  assert.deepEqual(hostVideoCapabilities(videoCapabilities), videoCapabilities);
  for (const patch of [
    { camera: 1 },
    { maxBytes: Infinity },
    { maxDurationSeconds: 1201 },
    { maxBytes: 0 },
  ])
    assert.throws(() => hostVideoCapabilities({ ...videoCapabilities, ...patch }), /能力回执无效/);
});

test("failed device capability discovery keeps durable video recovery available", async () => {
  const f = fixture(undefined,true);
  f.handlers.set("resources.list",()=>({assets:[videoAsset],total:1}));
  await f.ui.refresh();
  assert.deepEqual(f.ui.snapshot().assets,[videoAsset]);
  assert.deepEqual(f.ui.modes(),["microphone"]);
  assert.doesNotMatch(f.ui.render(""), /rec-host-mode:camera|rec-host-mode:screen/);
});
