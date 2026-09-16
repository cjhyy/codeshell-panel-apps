import assert from "node:assert/strict";
import test from "node:test";
import {
  EditorSourcePreviews,
  type SourceVideoPreview,
} from "../apps/video-studio/src/editor/source-previews";
import type { EditorAsset } from "../apps/video-studio/src/editor/types";
const asset = (id = "video"): EditorAsset => ({
  id,
  name: id,
  kind: "video",
  resourceId: `resource-${id}`,
  duration: 56056,
  width: 320,
  height: 180,
});
const result = (id: string) =>
  ({
    resourceId: id,
    sourceHash: "a".repeat(64),
    proxy: {
      id: "asset-" + "b".repeat(64),
      sha256: "b".repeat(64),
      bytes: 12,
      mimeType: "video/mp4",
    },
    recipe: { width: 320, height: 180 },
  }) as SourceVideoPreview;
function fixture() {
  const calls: Array<{
    resourceId: string;
    signal?: AbortSignal;
    finish(): void;
    fail(error: Error): void;
  }> = [];
  const cache = new EditorSourcePreviews({
    prepareSourceVideo: (resourceId, options) =>
      new Promise((resolve, reject) =>
        calls.push({
          resourceId,
          signal: options.signal,
          finish: () => resolve(result(resourceId)),
          fail: reject,
        }),
      ),
  });
  return { cache, calls };
}
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
test("timeline and player share the same proxy while one cancellation leaves the other consumer active", async () => {
  const { cache, calls } = fixture(),
    a = new AbortController(),
    b = new AbortController();
  const first = cache.prepare(asset(), a.signal),
    second = cache.prepare(asset(), b.signal);
  await turn();
  assert.equal(calls.length, 1);
  a.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(calls[0]!.signal!.aborted, false);
  calls[0]!.finish();
  const prepared = await second;
  assert.equal(prepared.resourceId, "resource-video");
  prepared.proxy.id = "changed-by-caller";
  assert.notEqual(
    (await cache.prepare(asset(), new AbortController().signal)).proxy.id,
    "changed-by-caller",
  );
  assert.equal(calls.length, 1);
  cache.dispose();
});
test("all consumers cancelling aborts shared work and late completion cannot replace newer preparation", async () => {
  const { cache, calls } = fixture(),
    controller = new AbortController();
  const first = cache.prepare(asset(), controller.signal);
  await turn();
  controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(calls[0]!.signal!.aborted, true);
  const second = cache.prepare(asset(), new AbortController().signal);
  await turn();
  assert.equal(calls.length, 2);
  calls[0]!.finish();
  await turn();
  calls[1]!.finish();
  await second;
  await cache.prepare(asset(), new AbortController().signal);
  assert.equal(calls.length, 2);
  cache.dispose();
});
test("native preparation concurrency is bounded and a cancelled queued source never starts", async () => {
  const { cache, calls } = fixture(),
    controllers = Array.from({ length: 5 }, () => new AbortController());
  const requests = controllers.map((controller, i) =>
    cache.prepare(asset(String(i)), controller.signal),
  );
  await turn();
  assert.equal(calls.length, 2);
  controllers[2]!.abort();
  await assert.rejects(requests[2]!, { name: "AbortError" });
  calls[0]!.finish();
  await turn();
  assert.equal(calls.length, 3);
  assert.equal(calls[2]!.resourceId, "resource-3");
  calls[1]!.finish();
  await turn();
  assert.equal(calls.length, 4);
  assert.equal(calls[3]!.resourceId, "resource-4");
  calls[2]!.finish();
  calls[3]!.finish();
  await Promise.all(requests.filter((_, i) => i !== 2));
  cache.dispose();
});
test("duration or resource changes require new preparation and dispose rejects queued consumers", async () => {
  const { cache, calls } = fixture();
  const first = cache.prepare(asset(), new AbortController().signal);
  await turn();
  calls[0]!.finish();
  await first;
  const second = cache.prepare({ ...asset(), duration: 64000 }, new AbortController().signal);
  await turn();
  assert.equal(calls.length, 2);
  calls[1]!.finish();
  await second;
  const active = [0, 1, 2].map((i) =>
    cache.prepare(asset(String(i)), new AbortController().signal),
  );
  await turn();
  cache.dispose();
  await assert.rejects(active[2]!, { name: "AbortError" });
  calls[2]!.fail(new DOMException("aborted", "AbortError"));
  calls[3]!.fail(new DOMException("aborted", "AbortError"));
  await Promise.all(
    active.slice(0, 2).map((request) => assert.rejects(request, { name: "AbortError" })),
  );
  await assert.rejects(cache.prepare(asset(), new AbortController().signal), {
    name: "AbortError",
  });
});
