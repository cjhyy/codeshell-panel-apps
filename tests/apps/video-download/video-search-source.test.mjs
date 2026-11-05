import assert from "node:assert/strict";
import { test } from "node:test";
import { createLibraryProcess } from "../../../apps/video-download/app/library-process.js";
import { normalizeVideoSearchUrl } from "../../../apps/video-download/app/video-search.js";
import {
  prepareVideoSearchSource,
  searchVideoPlatforms,
} from "../../../apps/video-download/app/video-search-source.js";

const methods = [
  "agent.task.models",
  "agent.task.start",
  "agent.task.get",
  "agent.task.cancel",
  "process.find",
  "process.resolveEntry",
  "process.spawn",
  "process.get",
  "process.cancel",
  "process.write",
  "process.end",
];
const candidate = {
  title: "Observed source",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  platform: "youtube",
  evidence: "search-index",
};

test("real-shaped flat Bilibili HTTP entries fetch missing titles only over canonical HTTPS", async () => {
  // Shape recorded from yt-dlp 2026.08.19 bilisearch2; titles are intentionally absent.
  const entries = [
    { url: "http://www.bilibili.com/video/av114703728709136", id: "114703728709136" },
    { url: "http://www.bilibili.com/video/av528990022", id: "528990022" },
  ];
  const detailUrls = [];
  const result = await searchVideoPlatforms(
    { query: "Blender 中文 入门 教程", platforms: ["bilibili"], limit: 2 },
    {
      directory: { handle: "directory" },
      ytDlp: { handle: "yt-dlp" },
      nodeAvailable: false,
    },
    {
      async run({ args }) {
        if (args.at(-1).startsWith("bilisearch"))
          return { code: 0, stdout: JSON.stringify({ entries }) };
        detailUrls.push(args.at(-1));
        assert.ok(args.includes("--skip-download"));
        return {
          code: 0,
          stdout: JSON.stringify({
            title: `Fixture title ${detailUrls.length}`,
            uploader: "Fixture author",
            duration: 120,
          }),
        };
      },
      async search() {
        assert.fail("successful local results must not use the fallback");
      },
    },
  );
  const canonical = entries.map(({ id }) => `https://www.bilibili.com/video/av${id}/`);
  assert.deepEqual(detailUrls, canonical);
  assert.deepEqual(
    result.candidates.map(({ url }) => url),
    canonical,
  );
  assert.deepEqual(
    result.candidates.map(({ title }) => title),
    ["Fixture title 1", "Fixture title 2"],
  );
  assert.ok(result.candidates.every(({ evidence }) => evidence === "platform-search"));
  assert.deepEqual(result.warnings, []);
  for (const { url } of entries)
    assert.equal(
      normalizeVideoSearchUrl(url),
      null,
      "public and AI URL validation must remain HTTPS-only",
    );
});

test("HTTP normalization in the yt-dlp adapter rejects foreign hosts, credentials, ports and non-video paths", async () => {
  const urls = [
    "http://www.bilibili.com.evil.example/video/av528990022",
    "http://www.bilibili.com@evil.example/video/av528990022",
    "http://user:secret@www.bilibili.com/video/av528990022",
    "http://www.bilibili.com:8080/video/av528990022",
    "http://www.bilibili.com:80/video/av528990022",
    "http://%77ww.bilibili.com/video/av528990022",
    "http://www.bilibili.com./video/av528990022",
    "http://www.bilibili.com/bangumi/play/ep123",
    "http://www.bilibili.com/video/av528990022/extra",
    "http://www.bilibili.com/video/not-a-video",
    "http://www.bilibili.com/other/../video/av528990022",
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "http://www.bilibili.com\\@evil.example/video/av528990022",
    "http://www.bili\nbili.com/video/av528990022",
    "http://127.0.0.1/video/av528990022",
  ];
  for (const url of urls) {
    let calls = 0;
    const result = await searchVideoPlatforms(
      { query: "owned fixture", platforms: ["bilibili"], limit: 1 },
      {
        directory: { handle: "directory" },
        ytDlp: { handle: "yt-dlp" },
        nodeAvailable: false,
      },
      {
        async run() {
          assert.equal(++calls, 1, `must not request metadata for ${url}`);
          return { code: 0, stdout: JSON.stringify({ entries: [{ url, id: "528990022" }] }) };
        },
      },
    );
    assert.deepEqual(result.candidates, [], url);
    assert.equal(calls, 1);
  }
});

test("Node source searches without yt-dlp through real auxiliary process receipts", async () => {
  const calls = [],
    inputs = [];
  const panel = {
    async call(method, args) {
      calls.push({ method, args });
      if (method === "process.find")
        return args.name === "node" ? { available: true, handle: "node" } : { available: false };
      if (method === "process.resolveEntry") return { handle: "search-entry" };
      if (method === "process.spawn") return { processId: "search-process" };
      if (method === "process.write") {
        inputs.push(args.text);
        return {};
      }
      if (method === "process.end") return {};
      if (method === "process.get")
        return {
          found: true,
          processId: "search-process",
          status: "exited",
          code: 0,
          hasMore: false,
          events: [
            {
              sequence: 1,
              event: "process.output",
              payload: {
                stream: "stdout",
                text: JSON.stringify({ source: "search-index", candidates: [candidate] }),
              },
            },
          ],
        };
      throw new Error(`Unexpected call: ${method}`);
    },
  };
  const auxiliary = createLibraryProcess(panel);
  const prepared = await prepareVideoSearchSource({
    panel,
    auxiliary,
    context: { availableMethods: methods },
    runtime: { ytDlp: null, directory: { handle: "directory" } },
  });
  assert.equal(prepared.ytDlp, null);
  assert.equal(prepared.nodeAvailable, true);
  assert.equal(
    calls.some(({ method }) => method === "process.spawn"),
    false,
    "preflight must not start a process",
  );
  const result = await searchVideoPlatforms(
    { query: "owned query", platforms: ["youtube"], limit: 1 },
    prepared,
    auxiliary,
  );
  assert.deepEqual(result.candidates, [candidate]);
  assert.match(result.warnings[0], /公开搜索索引/);
  assert.deepEqual(JSON.parse(inputs.join("")), {
    platform: "youtube",
    query: "owned query",
    limit: 1,
  });
  assert.equal(calls.filter(({ method }) => method === "process.spawn").length, 1);
  assert.equal(
    calls.find(({ method }) => method === "process.spawn").args.entryHandle,
    "search-entry",
  );
});

test("missing sources, directory, and required Host capabilities fail before searching", async () => {
  let discoveryCalls = 0;
  const panel = {
    async call() {
      discoveryCalls++;
      return { available: false };
    },
  };
  const base = {
    panel,
    context: { availableMethods: methods },
    runtime: { directory: { handle: "directory" } },
    auxiliary: {
      async prepareSearch() {
        throw new Error("Node unavailable");
      },
    },
  };
  await assert.rejects(prepareVideoSearchSource(base), /没有可用的检索工具.*Node unavailable/);
  assert.equal(discoveryCalls, 1);
  await assert.rejects(prepareVideoSearchSource({ ...base, runtime: {} }), /项目目录/);
  await assert.rejects(
    prepareVideoSearchSource({
      ...base,
      context: { availableMethods: methods.filter((method) => method !== "agent.task.start") },
    }),
    /agent.task.start/,
  );
  assert.equal(discoveryCalls, 1, "failed capabilities and directory must not even probe tools");
});

test("yt-dlp-only Hosts retain platform lookup and do not require the Node adapter", async () => {
  const calls = [];
  const auxiliary = {
    async prepareSearch() {
      throw new Error("Node unavailable");
    },
    async run(input) {
      calls.push(input.args);
      return {
        code: 0,
        stdout: JSON.stringify({
          entries: [{ id: "dQw4w9WgXcQ", title: "Platform title", uploader: "Creator" }],
        }),
      };
    },
    async search() {
      throw new Error("Node must not run");
    },
  };
  const prepared = await prepareVideoSearchSource({
    panel: {},
    auxiliary,
    context: { availableMethods: methods.filter((method) => method !== "process.resolveEntry") },
    runtime: { ytDlp: { handle: "yt-dlp" }, directory: { handle: "directory" } },
  });
  const result = await searchVideoPlatforms(
    { query: "owned query", platforms: ["youtube"] },
    prepared,
    auxiliary,
  );
  assert.equal(prepared.nodeAvailable, false);
  assert.equal(result.candidates[0].evidence, "platform-search");
  assert.equal(result.candidates[0].url, candidate.url);
  assert.match(calls[0].at(-1), /^ytsearch8:/);
});

test("a known failed yt-dlp check cannot satisfy preflight, and cancellation stops discovery", async () => {
  const controller = new AbortController();
  const input = {
    panel: {},
    context: { availableMethods: methods },
    runtime: { ytDlp: { handle: "bad", verified: false }, directory: { handle: "directory" } },
    auxiliary: {
      async prepareSearch() {
        throw new Error("Node unavailable");
      },
    },
  };
  await assert.rejects(prepareVideoSearchSource(input), /没有可用的检索工具/);
  controller.abort();
  await assert.rejects(
    prepareVideoSearchSource({
      ...input,
      signal: controller.signal,
      auxiliary: {
        prepareSearch() {
          assert.fail("must not discover after cancellation");
        },
      },
    }),
    /已取消/,
  );
});

test("platform failures keep the reviewed error formatter and fall back to Node evidence", async () => {
  let formatted = false;
  const result = await searchVideoPlatforms(
    { query: "owned query", platforms: ["bilibili"] },
    {
      directory: { handle: "directory" },
      ytDlp: { handle: "yt-dlp" },
      nodeAvailable: true,
    },
    {
      async run() {
        return { code: 1, stderr: "private upstream detail" };
      },
      async search() {
        return {
          source: "search-index",
          candidates: [
            {
              ...candidate,
              platform: "bilibili",
              url: "https://www.bilibili.com/video/BV1xx411c7mD/",
            },
          ],
        };
      },
    },
    (_stderr, operation, code) => {
      formatted = operation === "平台检索" && code === 1;
      return "Reviewed source failure";
    },
  );
  assert.equal(formatted, true);
  assert.equal(result.candidates[0].evidence, "search-index");
  assert.doesNotMatch(JSON.stringify(result), /private upstream detail/);
});

test("an existing exclusive operation prevents discovery before any model request", async () => {
  await assert.rejects(
    prepareVideoSearchSource({
      context: { availableMethods: methods },
      runtime: { directory: { handle: "directory" } },
      panel: {
        call() {
          assert.fail("must not discover while setup owns the process lane");
        },
      },
      auxiliary: {
        assertAvailable() {
          throw new Error("请等待当前操作完成后再检查或搜索。");
        },
      },
    }),
    /请等待当前操作完成/,
  );
});
