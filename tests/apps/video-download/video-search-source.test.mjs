import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLibraryProcess,
  ENVIRONMENT_NOT_CONFIRMED_MESSAGE,
  EXECUTION_NOT_CONFIRMED_MESSAGE,
} from "../../../apps/video-download/app/library-process.js";
import { normalizeVideoSearchUrl } from "../../../apps/video-download/app/video-search.js";
import {
  listVideoSearchAccounts,
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

const cookieMethods = ["credentials.cookies.listForTask", "credentials.cookies.authorizeProcess"];
const selectedAccounts = {
  bilibili: { id: "bilibili-account", revision: "a".repeat(64) },
  youtube: { id: "youtube-account", revision: "b".repeat(64) },
};
const cookieUrls = {
  bilibili: "https://www.bilibili.com/",
  youtube: "https://www.youtube.com/",
};

function cookieSourceFixture() {
  const calls = [];
  const input = {
    context: {
      availableMethods: [...methods, ...cookieMethods],
      capabilities: {
        tasks: { cookieCredentials: true },
        process: { cookieCredentials: true },
      },
    },
    runtime: { ytDlp: { handle: "yt-dlp" }, directory: { handle: "directory" } },
    accounts: structuredClone(selectedAccounts),
    panel: {
      async call(method, args) {
        calls.push({ method, args });
        const platform = Object.keys(cookieUrls).find((key) => cookieUrls[key] === args.url);
        assert.ok(platform, "account requests must use a fixed platform root URL");
        if (method === "credentials.cookies.listForTask")
          return { accounts: [{ ...selectedAccounts[platform], health: "ready" }] };
        if (method === "credentials.cookies.authorizeProcess")
          return { authorized: true, fileArgumentHandle: `${platform}-cookie-handle` };
        assert.fail(`unexpected preflight request: ${method}`);
      },
    },
    auxiliary: {
      async prepareSearch() {},
      async run() {
        assert.fail("preflight must not spawn a process");
      },
      async search() {
        assert.fail("preflight must not query a source");
      },
    },
  };
  return { input, calls };
}

test("search account discovery exposes only bounded metadata and omits unusable credentials", async () => {
  const { input } = cookieSourceFixture();
  const account = {
    ...selectedAccounts.bilibili,
    health: "ready",
    label: "账号".repeat(100),
    cookies: "private-cookie-value",
    path: "/private/cookies.txt",
    fileArgumentHandle: "not-authorized-for-this-query",
  };
  input.panel.call = async (method, args) => {
    assert.equal(method, "credentials.cookies.listForTask");
    assert.deepEqual(args, { url: cookieUrls.bilibili });
    return {
      accounts: [
        account,
        { ...account, id: "corrupted", health: "corrupted" },
        { ...account, id: "bad-revision", revision: "invalid" },
        { ...account, id: "" },
        { ...account, id: "x".repeat(257) },
      ],
    };
  };
  assert.deepEqual(await listVideoSearchAccounts({ ...input, platform: "bilibili" }), {
    supported: true,
    accounts: [{ ...selectedAccounts.bilibili, label: account.label.slice(0, 160) }],
  });
  assert.deepEqual(
    await listVideoSearchAccounts({
      ...input,
      context: { availableMethods: methods },
      platform: "bilibili",
      panel: {
        call() {
          assert.fail("old Hosts must not receive Cookie requests");
        },
      },
    }),
    { supported: false, accounts: [] },
  );
});

test("platform account discovery uses www origins so saved bare-domain and www-domain logins both match", async () => {
  const { input } = cookieSourceFixture();
  for (const platform of ["youtube", "bilibili"]) {
    const root = `${platform}.com`;
    input.panel.call = async (method, { url }) => {
      assert.equal(method, "credentials.cookies.listForTask");
      assert.equal(url, `https://www.${root}/`);
      // Match the Host vault's domain-bound account discovery.
      const host = new URL(url).hostname;
      return {
        accounts: [root, `www.${root}`]
          .filter((domain) => host === domain || host.endsWith(`.${domain}`))
          .map((domain) => ({ id: domain, label: domain, revision: "a".repeat(64) })),
      };
    };
    const listed = await listVideoSearchAccounts({ ...input, platform });
    assert.deepEqual(
      listed.accounts.map(({ id }) => id),
      [root, `www.${root}`],
    );
  }
});

test("selected search accounts authorize each exact revision and platform before any process", async () => {
  const { input, calls } = cookieSourceFixture();
  const prepared = await prepareVideoSearchSource(input);
  assert.deepEqual(prepared.fileArgumentHandles, {
    bilibili: ["bilibili-cookie-handle"],
    youtube: ["youtube-cookie-handle"],
  });
  for (const platform of Object.keys(selectedAccounts)) {
    assert.deepEqual(
      calls.filter(({ args }) => args.url === cookieUrls[platform]),
      [
        { method: "credentials.cookies.listForTask", args: { url: cookieUrls[platform] } },
        {
          method: "credentials.cookies.authorizeProcess",
          args: {
            credentialId: selectedAccounts[platform].id,
            url: cookieUrls[platform],
            revision: selectedAccounts[platform].revision,
            executableHandle: "yt-dlp",
          },
        },
      ],
    );
  }
  assert.equal(calls.length, 4);
});

test("only selected platforms authorize accounts and anonymous old Hosts still prepare", async () => {
  const { input, calls } = cookieSourceFixture();
  await assert.rejects(prepareVideoSearchSource({ ...input, platforms: ["bilibili"] }));
  assert.deepEqual(calls, []);
  const prepared = await prepareVideoSearchSource({
    ...input,
    platforms: ["bilibili"],
    accounts: { bilibili: input.accounts.bilibili },
  });
  assert.deepEqual(prepared.fileArgumentHandles, { bilibili: ["bilibili-cookie-handle"] });
  assert.ok(calls.every(({ args }) => args.url === cookieUrls.bilibili));
  const anonymous = await prepareVideoSearchSource({
    ...input,
    context: { availableMethods: methods },
    accounts: {},
    panel: {
      call() {
        assert.fail("anonymous lookup must not request Cookie grants");
      },
    },
  });
  assert.equal(anonymous.ytDlp.handle, "yt-dlp");
  assert.equal(anonymous.nodeAvailable, true);
  assert.ok(!anonymous.fileArgumentHandles || !Object.keys(anonymous.fileArgumentHandles).length);
});

test("selected accounts require versioned Host capabilities and a usable yt-dlp", async () => {
  for (const missing of cookieMethods) {
    const { input, calls } = cookieSourceFixture();
    input.context.availableMethods = input.context.availableMethods.filter(
      (name) => name !== missing,
    );
    await assert.rejects(prepareVideoSearchSource(input));
    assert.deepEqual(calls, []);
  }
  for (const kind of ["tasks", "process"]) {
    const { input, calls } = cookieSourceFixture();
    input.context.capabilities[kind].cookieCredentials = false;
    await assert.rejects(prepareVideoSearchSource(input));
    assert.deepEqual(calls, []);
  }
  for (const ytDlp of [null, { handle: "yt-dlp", verified: false }]) {
    const { input } = cookieSourceFixture();
    input.runtime.ytDlp = ytDlp;
    let authorizations = 0;
    input.panel.call = async (method) => {
      if (method === "process.find") return { available: false };
      authorizations++;
      assert.fail("a missing local search tool cannot authorize an account");
    };
    await assert.rejects(prepareVideoSearchSource(input), /yt-dlp|下载器|检索工具/);
    assert.equal(authorizations, 0);
  }
});

test("missing, changed, corrupted and malformed account revisions fail before authorization", async () => {
  const variants = [
    [],
    [{ ...selectedAccounts.bilibili, id: "another-account", health: "ready" }],
    [{ ...selectedAccounts.bilibili, revision: "c".repeat(64), health: "ready" }],
    [{ ...selectedAccounts.bilibili, revision: "invalid", health: "ready" }],
    [{ ...selectedAccounts.bilibili, health: "corrupted" }],
  ];
  for (const accounts of variants) {
    const { input } = cookieSourceFixture();
    input.platforms = ["bilibili"];
    input.accounts = { bilibili: input.accounts.bilibili };
    input.panel.call = async (method) => {
      assert.equal(method, "credentials.cookies.listForTask");
      return { accounts };
    };
    await assert.rejects(prepareVideoSearchSource(input));
  }
  for (const revision of [undefined, "invalid", "A".repeat(64)]) {
    const { input, calls } = cookieSourceFixture();
    input.platforms = ["bilibili"];
    input.accounts = { bilibili: input.accounts.bilibili };
    input.accounts.bilibili.revision = revision;
    await assert.rejects(prepareVideoSearchSource(input));
    assert.ok(calls.every(({ method }) => method !== "credentials.cookies.authorizeProcess"));
  }
});

test("refused or invalid account authorization cannot silently become an anonymous search", async () => {
  for (const authorization of [
    { authorized: false },
    { authorized: false, invalid: true },
    { authorized: true },
    { authorized: true, fileArgumentHandle: "" },
  ]) {
    const { input } = cookieSourceFixture();
    input.platforms = ["bilibili"];
    input.accounts = { bilibili: input.accounts.bilibili };
    const call = input.panel.call;
    input.panel.call = (method, args) =>
      method === "credentials.cookies.authorizeProcess" ? authorization : call(method, args);
    await assert.rejects(prepareVideoSearchSource(input));
  }
});

test("cancellation rejects a late account grant and cannot authorize another platform", async () => {
  const { input } = cookieSourceFixture();
  const controller = new AbortController();
  let resolveAuthorization, authorizationStarted;
  const pending = new Promise((resolve) => {
    resolveAuthorization = resolve;
  });
  const started = new Promise((resolve) => {
    authorizationStarted = resolve;
  });
  let authorizations = 0;
  const call = input.panel.call;
  input.panel.call = (method, args) => {
    if (method !== "credentials.cookies.authorizeProcess") return call(method, args);
    assert.equal(++authorizations, 1);
    authorizationStarted();
    return pending;
  };
  const prepared = prepareVideoSearchSource({ ...input, signal: controller.signal });
  const assertion = assert.rejects(prepared, /已取消/);
  await started;
  controller.abort();
  resolveAuthorization({ authorized: true, fileArgumentHandle: "late-cookie-handle" });
  await assertion;
  assert.equal(authorizations, 1);
});

test("account search and Bilibili missing-title details receive only their platform Cookie handle", async () => {
  const { input } = cookieSourceFixture();
  const prepared = await prepareVideoSearchSource(input);
  const runs = [];
  const result = await searchVideoPlatforms(
    { query: "owned query", platforms: ["youtube", "bilibili"], limit: 1 },
    prepared,
    {
      async run(request) {
        runs.push(request);
        const url = request.args.at(-1);
        if (url.startsWith("ytsearch"))
          return {
            code: 0,
            stdout: JSON.stringify({ entries: [{ id: "dQw4w9WgXcQ", title: "YouTube title" }] }),
          };
        if (url.startsWith("bilisearch"))
          return {
            code: 0,
            stdout: JSON.stringify({
              entries: [{ url: "http://www.bilibili.com/video/av528990022" }],
            }),
          };
        assert.equal(url, "https://www.bilibili.com/video/av528990022/");
        return { code: 0, stdout: JSON.stringify({ title: "Bilibili title" }) };
      },
      async search() {
        assert.fail("a selected account must never use anonymous Node lookup");
      },
    },
  );
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    runs.map(({ fileArgumentHandles }) => fileArgumentHandles),
    [["youtube-cookie-handle"], ["bilibili-cookie-handle"], ["bilibili-cookie-handle"]],
  );
  for (const { args } of runs) {
    assert.ok(!args.includes("--cookies"), "only the Host may materialize the Cookie file");
    assert.doesNotMatch(JSON.stringify(args), /cookie-handle|account/);
  }
});

test("failed account searches never fall back anonymously while another anonymous platform can", async () => {
  for (const localResult of [
    { code: 1, stderr: "fixture failure" },
    { code: 0, stdout: JSON.stringify({ entries: [] }) },
  ]) {
    const fallbackPlatforms = [];
    const result = await searchVideoPlatforms(
      { query: "owned query", platforms: ["bilibili", "youtube"] },
      {
        directory: { handle: "directory" },
        ytDlp: { handle: "yt-dlp" },
        nodeAvailable: true,
        fileArgumentHandles: { bilibili: ["bilibili-cookie-handle"] },
      },
      {
        async run(request) {
          assert.match(request.args.at(-1), /^bilisearch/);
          assert.deepEqual(request.fileArgumentHandles, ["bilibili-cookie-handle"]);
          return localResult;
        },
        async search(_directory, platform) {
          fallbackPlatforms.push(platform);
          return { source: "search-index", candidates: [candidate] };
        },
      },
    );
    assert.deepEqual(fallbackPlatforms, ["youtube"]);
    assert.deepEqual(result.candidates, [candidate]);
  }
});

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

test("refused node consent is reported once as missing permission, not as missing tools", async () => {
  const notConfirmed = () =>
    Object.assign(new Error(EXECUTION_NOT_CONFIRMED_MESSAGE), { code: "EXECUTION_NOT_CONFIRMED" });
  const result = await searchVideoPlatforms(
    { query: "owned query", platforms: ["youtube", "bilibili"] },
    { directory: { handle: "directory" }, ytDlp: null, nodeAvailable: true },
    {
      async run() {
        assert.fail("yt-dlp is not prepared");
      },
      async search() {
        throw notConfirmed();
      },
    },
  );
  assert.deepEqual(result, { candidates: [], warnings: [EXECUTION_NOT_CONFIRMED_MESSAGE] });
  assert.doesNotMatch(JSON.stringify(result), /安装 yt-dlp/);

  // An environment check that stopped at consent leaves yt-dlp unverified, not missing.
  const { input, calls } = cookieSourceFixture();
  input.runtime.ytDlp = {
    handle: "yt-dlp",
    verified: false,
    errorCode: "execution-not-confirmed",
  };
  await assert.rejects(prepareVideoSearchSource(input), {
    message: ENVIRONMENT_NOT_CONFIRMED_MESSAGE,
  });
  assert.deepEqual(calls, []);
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
