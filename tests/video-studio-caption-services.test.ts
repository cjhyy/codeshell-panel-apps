import assert from "node:assert/strict";
import test from "node:test";
import { createCaptionServices } from "../apps/video-studio/src/editor/caption-services";
import { migrateLegacyProject } from "../apps/video-studio/src/editor/migration";
import { createProject } from "../apps/video-studio/src/model";
import type { PanelBridge } from "../apps/video-studio/src/host";
const resourceId = `asset-${"a".repeat(64)}`;
const signal = () => new AbortController().signal;
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture(
  call: (method: string, args: any) => unknown,
  settings: { timeoutMs?: number } = {},
) {
  const doc = migrateLegacyProject(createProject());
  doc.assets = [{ id: "audio", kind: "audio", name: "原声", duration: 2400000, resourceId }];
  const before = structuredClone(doc),
    calls: Array<{ method: string; args: any }> = [];
  const listeners = new Map<string, Set<(value: any) => void>>();
  const panel: PanelBridge = {
    getContext: async () => ({
      availableMethods: ["agent.task.start", "agent.task.get", "agent.task.cancel"],
      capabilities: { bridge: { maxCallsPerWindow: 10000 } },
    }),
    registerTool: () => () => {},
    on(event, listener) {
      const list = listeners.get(event) ?? new Set();
      listeners.set(event, list);
      list.add(listener);
      return () => {
        list.delete(listener);
      };
    },
    call: async (method, args) => {
      calls.push({ method, args: structuredClone(args) });
      return call(method, args);
    },
  };
  const services = createCaptionServices({
    panel,
    read: () => doc,
    resolveResource: async (asset) => asset.resourceId!,
    assertTranscriptionReady: () => {},
    pollIntervalMs: 1,
    ...settings,
  });
  return { services, calls, doc, before, listeners };
}
test("caption services reuse a completed empty transcript, preserve true source seconds and immutable revision", async () => {
  const f = fixture((method, args) => {
    assert.equal(method, "media.transcript");
    return {
      assetId: resourceId,
      total: args.limit === 1 ? 0 : 1,
      offset: args.offset,
      revision: "transcript-content-a",
      segments:
        args.limit === 1
          ? []
          : [
              {
                start: 0.123,
                end: 1.777,
                text: "真实词",
                words: [{ start: 0.2, end: 0.8, text: "真实" }],
              },
            ],
    };
  });
  try {
    await f.services.prepare({ assetIds: ["audio"], signal: signal() });
    const page = await f.services.transcript({
      assetId: "audio",
      offset: 0,
      limit: 100,
      signal: signal(),
    });
    assert.equal(page.assetId, "audio");
    assert.equal(page.revision, "transcript-content-a");
    assert.equal(page.segments[0]!.start, 0.123);
    assert.equal(page.segments[0]!.words![0]!.start, 0.2);
    assert.deepEqual(f.doc, f.before);
    assert.equal(
      f.calls.some((call) => call.method === "media.transcribe"),
      false,
    );
    f.doc.assets[0]!.resourceId = `asset-${"b".repeat(64)}`;
    await assert.rejects(
      f.services.transcript({ assetId: "audio", offset: 0, limit: 100, signal: signal() }),
      /声音源已变化/,
    );
  } finally {
    f.services.dispose();
  }
});
test("an absent transcript starts real ASR and waits for the exact native task before returning pages", async () => {
  let done = false;
  const f = fixture((method, args) => {
    if (method === "media.transcript") {
      if (!done) throw Error("请先准备这条素材的真实分析或转写");
      return {
        assetId: resourceId,
        total: 1,
        offset: 0,
        segments: [{ start: 0, end: 1, text: "识别结果" }],
        revision: "immutable",
      };
    }
    if (method === "media.transcribe") {
      assert.deepEqual(args, { assetId: resourceId, language: "auto" });
      return { id: "asr-one", status: "queued" };
    }
    if (method === "media.jobs.get") {
      assert.equal(args.id, "asr-one");
      done = true;
      return { id: "asr-one", status: "succeeded" };
    }
    throw Error(method);
  });
  try {
    await f.services.prepare({ assetIds: ["audio"], signal: signal() });
    const result = await f.services.transcript({
      assetId: "audio",
      offset: 0,
      limit: 100,
      signal: signal(),
    });
    assert.equal(result.segments[0]!.text, "识别结果");
    assert.deepEqual(f.doc, f.before);
  } finally {
    f.services.dispose();
  }
});
test("ASR transport errors never launch extra transcription, and a late start receipt is cancelled", async () => {
  const broken = fixture(() => {
    throw Error("permission denied");
  });
  try {
    await assert.rejects(
      broken.services.prepare({ assetIds: ["audio"], signal: signal() }),
      /permission denied/,
    );
    assert.equal(broken.calls.length, 1);
  } finally {
    broken.services.dispose();
  }
  let finish: (value: unknown) => void = () => {};
  const f = fixture((method) => {
    if (method === "media.transcript") throw Error("请先准备这条素材的真实分析或转写");
    if (method === "media.transcribe")
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (method === "media.jobs.cancel") return { id: "late-asr", status: "cancelled" };
    throw Error(method);
  });
  const own = new AbortController();
  const request = f.services.prepare({ assetIds: ["audio"], signal: own.signal });
  while (!f.calls.some((call) => call.method === "media.transcribe")) await turn();
  own.abort();
  finish({ id: "late-asr", status: "running" });
  await assert.rejects(request, { name: "AbortError" });
  assert.ok(
    f.calls.some((call) => call.method === "media.jobs.cancel" && call.args.id === "late-asr"),
  );
  f.services.dispose();
});
test("translation uses the configured model without tools and reorders by immutable caption IDs", async () => {
  const f = fixture((method, args) => {
    assert.equal(method, "agent.task.start");
    assert.deepEqual(args.toolNames, []);
    assert.equal(args.model, undefined);
    assert.equal(args.maxTurns, 1);
    assert.match(args.prompt, /untrusted data/);
    return {
      id: "translation",
      status: "completed",
      result: { text: '```json\n[{"id":"b","text":"世界"},{"id":"a","text":"你好"}]\n```' },
    };
  });
  try {
    const result = await f.services.translate({
      language: "中文",
      items: [
        { id: "a", text: "Hello" },
        { id: "b", text: "world" },
      ],
      signal: signal(),
    });
    assert.deepEqual(result, [
      { id: "a", text: "你好" },
      { id: "b", text: "世界" },
    ]);
    assert.deepEqual(f.doc, f.before);
  } finally {
    f.services.dispose();
  }
});
test("malformed, missing and duplicate translated rows fail without retry or editor writes", async () => {
  for (const text of [
    "not json",
    "[]",
    '[{"id":"a","text":"好"},{"id":"a","text":"好"}]',
    '[{"id":"a","text":"好","operations":[]},{"id":"b","text":"好"}]',
  ]) {
    const f = fixture(() => ({ id: "translation", status: "completed", result: { text } }));
    try {
      await assert.rejects(
        f.services.translate({
          language: "中文",
          items: [
            { id: "a", text: "Hello" },
            { id: "b", text: "world" },
          ],
          signal: signal(),
        }),
        /翻译结果/,
      );
      assert.equal(f.calls.length, 1);
      assert.deepEqual(f.doc, f.before);
    } finally {
      f.services.dispose();
    }
  }
});
test("translation splits escaped text by actual request size and rejects overlong single rows before starting", async () => {
  const f = fixture((method, args) => {
    assert.equal(method, "agent.task.start");
    assert.ok(args.prompt.length <= 18000);
    const rows = JSON.parse(args.prompt.split("Subtitle data: ")[1]);
    return {
      id: `translation-${args.key}`,
      status: "completed",
      result: { text: JSON.stringify(rows.map((row: any) => ({ id: row.id, text: "译文" }))) },
    };
  });
  try {
    const items = Array.from({ length: 8 }, (_, i) => ({ id: String(i), text: '"\\'.repeat(700) }));
    const result = await f.services.translate({ language: "中文", items, signal: signal() });
    assert.equal(result.length, 8);
    assert.ok(f.calls.length > 1);
    const count = f.calls.length;
    await assert.rejects(
      f.services.translate({
        language: "中文",
        items: [{ id: "huge", text: "a".repeat(19000) }],
        signal: signal(),
      }),
      /单条字幕过长/,
    );
    assert.equal(f.calls.length, count);
  } finally {
    f.services.dispose();
  }
});
test("cancel or dispose during a translation start cancels only its late task and releases listeners", async () => {
  for (const dispose of [false, true]) {
    let finish: (value: unknown) => void = () => {};
    const f = fixture((method) => {
      if (method === "agent.task.start")
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (method === "agent.task.cancel") return { id: "late-translation", status: "cancelled" };
      throw Error(method);
    });
    const own = new AbortController(),
      pending = f.services.translate({
        language: "中文",
        items: [{ id: "a", text: "Hi" }],
        signal: own.signal,
      });
    while (!f.calls.length) await turn();
    dispose ? f.services.dispose() : own.abort();
    finish({ id: "late-translation", status: "running" });
    await assert.rejects(pending, { name: "AbortError" });
    assert.deepEqual(
      f.calls.filter((call) => call.method === "agent.task.cancel").map((call) => call.args.id),
      ["late-translation"],
    );
    assert.ok([...f.listeners.values()].every((list) => !list.size));
    f.services.dispose();
  }
});
test("translation rejects unrelated task polls and timeout requests cancellation without restarting", async () => {
  for (const timeout of [false, true]) {
    const f = fixture(
      (method) => {
        if (method === "agent.task.start") return { id: "mine", status: "running" };
        if (method === "agent.task.get")
          return { id: timeout ? "mine" : "other", status: "running" };
        if (method === "agent.task.cancel") return { id: "mine", status: "cancelled" };
        throw Error(method);
      },
      timeout ? { timeoutMs: 4 } : {},
    );
    try {
      await assert.rejects(
        f.services.translate({
          language: "中文",
          items: [{ id: "a", text: "Hi" }],
          signal: signal(),
        }),
        timeout ? /超时/ : /身份/,
      );
      assert.equal(f.calls.filter((call) => call.method === "agent.task.start").length, 1);
      assert.deepEqual(
        f.calls.filter((call) => call.method === "agent.task.cancel").map((call) => call.args.id),
        ["mine"],
      );
      assert.ok([...f.listeners.values()].every((list) => !list.size));
    } finally {
      f.services.dispose();
    }
  }
});
