import assert from "node:assert/strict";
import { test } from "node:test";
import { createHostAudioRecording } from "../apps/video-studio/src/host-audio-recording.ts";
import type { PanelBridge } from "../apps/video-studio/src/host.ts";

const asset = {
  id: `asset-${"a".repeat(64)}`,
  name: "recording.webm",
  mimeType: "audio/webm",
  bytes: 1000,
  createdAt: 10,
};
function fixture() {
  const state = {
    scope: "a:1",
    enabled: true,
    failed: false,
    saved: 0,
    published: [] as string[],
    assets: [asset],
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
