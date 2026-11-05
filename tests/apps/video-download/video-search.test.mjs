import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  normalizeVideoSearchUrl,
  normalizeVideoSearchCandidates,
  parseVideoSearchPlan,
  rankVideoSearchCandidates,
} from "../../../apps/video-download/app/video-search.js";
import {
  readSearchArchive,
  writeSearchArchive,
} from "../../../apps/video-download/app/video-search-archive.js";

const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const biliUrl = "https://www.bilibili.com/video/BV1xx411c7mD/";
const candidates = [
  {
    title: "Blender 建模基础",
    url: videoUrl,
    platform: "youtube",
    author: "真实作者",
    duration: 1200,
  },
  {
    title: "从零开始 Blender",
    url: biliUrl,
    platform: "bilibili",
    author: "教程作者",
    duration: 900,
  },
];

test("accepts canonical individual videos and rejects unsafe or deceptive targets", () => {
  assert.equal(normalizeVideoSearchUrl("https://youtu.be/dQw4w9WgXcQ?si=tracking").url, videoUrl);
  assert.equal(normalizeVideoSearchUrl("https://m.youtube.com/shorts/dQw4w9WgXcQ").url, videoUrl);
  assert.equal(normalizeVideoSearchUrl(`${biliUrl}?spm_id_from=search`).url, biliUrl);
  for (const url of [
    "javascript:alert(1)",
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://yоutube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com@evil.example/watch?v=dQw4w9WgXcQ",
    "https://name:password@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://localhost/video",
    "https://127.0.0.1/video",
    "https://2130706433/video",
    "https://[::1]/video",
    "https://www.youtube.com/results?search_query=blender",
    "https://www.bilibili.com/search?keyword=blender",
    "https://www.youtube.com/playlist?list=test",
    "https://www.youtube.com/@author",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "https://b23.tv/unknown",
  ])
    assert.equal(normalizeVideoSearchUrl(url), null, url);
});

test("planner respects selected scope, bounds text, and cannot introduce additional platforms", () => {
  const plan = parseVideoSearchPlan(
    JSON.stringify({
      queries: [
        { platform: "youtube", query: "Beginner blender" },
        { platform: "bilibili", query: "Blender 入门" },
        { platform: "other", query: "unsafe" },
      ],
      criteria: ["中文", null],
      summary: "筛选基础教程",
    }),
    ["bilibili"],
  );
  assert.deepEqual(plan.queries, [{ platform: "bilibili", query: "Blender 入门" }]);
  assert.deepEqual(plan.criteria, ["中文"]);
  assert.throws(() => parseVideoSearchPlan('{"queries":[]}', ["youtube"]));
  assert.throws(() => parseVideoSearchPlan("I found a video from memory", ["youtube"]));
});

test("candidate metadata comes from platform records and ranking only maps existing IDs", () => {
  const normalized = normalizeVideoSearchCandidates([
    ...candidates,
    { ...candidates[0], url: videoUrl + "&tracking=1" },
    { title: "Fake", url: "https://evil.example/video", platform: "youtube" },
    { ...candidates[0], platform: "bilibili" },
  ]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].sourceUrl, videoUrl);
  const ranked = rankVideoSearchCandidates(
    JSON.stringify({
      selected: [
        {
          id: "v2",
          title: "AI invented title",
          url: "https://evil.example/watch",
          sourceUrl: "https://evil.example/",
          reason: "主题符合",
        },
        { id: "unknown", reason: "invented" },
        { id: "v2", reason: "duplicate" },
      ],
    }),
    normalized,
  );
  assert.equal(ranked.candidates.length, 1);
  assert.equal(ranked.candidates[0].url, biliUrl);
  assert.equal(ranked.candidates[0].sourceUrl, biliUrl);
  assert.equal(ranked.candidates[0].title, candidates[1].title);
  assert.equal(ranked.candidates[0].reason, "主题符合");
  assert.throws(() => rankVideoSearchCandidates('{"selected":[{"id":"invented"}]}', normalized));
});

test("saved searches remain project-scoped and discard invented or unsafe video URLs", () => {
  const snapshot = writeSearchArchive(
    [
      {
        id: "search-one",
        query: "Blender basics",
        platforms: ["youtube"],
        modelId: "custom-model",
        createdAt: Date.now(),
        status: "ready",
        summary: "Two choices",
        candidates: [candidates[0], { title: "Invented", url: "https://evil.example/video" }],
      },
    ],
    "custom-model",
    "/project/a",
    normalizeVideoSearchCandidates,
  );
  assert.equal(snapshot.records[0].candidates.length, 1);
  assert.equal(snapshot.records[0].candidates[0].url, videoUrl);
  assert.equal(snapshot.records[0].candidates[0].evidence, "historical");
  assert.equal(
    readSearchArchive(snapshot, "/project/b", normalizeVideoSearchCandidates).records.length,
    0,
  );
  assert.equal(
    readSearchArchive(snapshot, "/project/a", normalizeVideoSearchCandidates).modelId,
    "custom-model",
  );
});

test("indexed results stay visibly unverified after ranking and archive reload", () => {
  const [candidate] = normalizeVideoSearchCandidates([
    { ...candidates[1], evidence: "search-index" },
  ]);
  assert.equal(candidate.evidence, "search-index");
  const ranked = rankVideoSearchCandidates(JSON.stringify({ selected: [{ id: candidate.id }] }), [
    candidate,
  ]);
  assert.equal(ranked.candidates[0].evidence, "search-index");
  const archive = writeSearchArchive(
    [
      {
        id: "index-one",
        query: "Blender AI",
        platforms: ["bilibili"],
        candidates: ranked.candidates,
      },
    ],
    "model",
    "/project/a",
    normalizeVideoSearchCandidates,
  );
  assert.equal(archive.records[0].candidates[0].evidence, "historical-index");
  assert.equal(
    readSearchArchive(archive, "/project/a", normalizeVideoSearchCandidates).records[0]
      .candidates[0].evidence,
    "historical-index",
  );
});

let browser;
let server;
let baseUrl;
const appDirectory = resolve(
  fileURLToPath(new URL("../../../apps/video-download/app/", import.meta.url)),
);
before(async () => {
  server = createServer(async (request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        '<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/video-search.css"><link rel="stylesheet" href="/panel-select.css"><link rel="stylesheet" href="/workspace.css"><body><main id="search"></main><script src="/panel-select.js"></script></body></html>',
      );
      return;
    }
    const file = resolve(appDirectory, `.${new URL(request.url, "http://localhost").pathname}`);
    if (!file.startsWith(appDirectory + sep)) return response.writeHead(403).end();
    try {
      response.writeHead(200, {
        "Content-Type":
          { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" }[
            extname(file)
          ] || "application/octet-stream",
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      done();
    });
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function openSearch(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: options.width || 1000, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(baseUrl) ? route.continue() : route.abort(),
  );
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(baseUrl);
  await page.evaluate(
    async ({ candidates, options }) => {
      window.calls = [];
      window.queued = [];
      window.previewed = [];
      window.lookupCalls = [];
      window.plan = {
        queries: [
          { platform: "youtube", query: "Blender beginner" },
          { platform: "bilibili", query: "Blender 中文入门" },
        ],
        criteria: ["入门", "中文"],
        summary: "分别查询两个平台",
      };
      window.ranking = {
        selected: [
          {
            id: "v2",
            reason: "中文基础教程",
            url: "https://evil.example/video",
            title: "伪造标题",
          },
          { id: "v1", reason: "基础建模教程" },
        ],
        summary: "根据检索到的标题和时长匹配，未读取视频正文。",
      };
      window.taskNumber = 0;
      window.archiveSnapshot = null;
      window.accountCatalog = {
        youtube: [{ id: "youtube-account", label: "YouTube 已保存账号", revision: "a".repeat(64) }],
        bilibili: [{ id: "bilibili-account", label: "B 站已保存账号", revision: "b".repeat(64) }],
      };
      window.panelMock = {
        async call(method, args) {
          window.calls.push({ method, args });
          if (method === "agent.task.models")
            return {
              defaultModel: "model-a",
              models: options.models || [
                { id: "model-a", label: "可用模型", provider: "已配置连接" },
              ],
            };
          if (method === "agent.task.list") return [];
          if (method === "agent.task.start") {
            const phase = args.key.includes("planning") ? "planning" : "ranking";
            const task = {
              id: `task-${++window.taskNumber}`,
              key: args.key,
              updatedAt: Date.now(),
              status: options.hold === phase ? "running" : "completed",
              result: {
                text:
                  options.badRank && phase === "ranking"
                    ? '{"selected":[{"id":"fake"}]}'
                    : JSON.stringify(phase === "planning" ? window.plan : window.ranking),
              },
            };
            window.lastTask = task;
            if (options.holdStart && phase === "planning") {
              return new Promise((resolve) => {
                window.releaseStart = () => resolve(task);
              });
            }
            return task;
          }
          if (method === "agent.task.get") return window.lastTask;
          if (method === "agent.task.cancel") {
            if (window.rejectCancel) throw new Error("取消请求失败");
            return {};
          }
          if (method === "external.open") return {};
          if (options.accounts) {
            if (method === "credentials.cookies.listForTask")
              return {
                accounts:
                  window.accountCatalog[args.url.includes("bilibili") ? "bilibili" : "youtube"],
              };
            if (method === "credentials.cookies.authorizeProcess") {
              if (options.holdAuthorization)
                await new Promise((resolve) => {
                  window.releaseAuthorization = resolve;
                });
              return options.denyAuthorization
                ? { authorized: false, cancelled: true }
                : { authorized: true, fileArgumentHandle: `sealed-${args.credentialId}` };
            }
          }
          if (options.nodeOnly) {
            if (method === "process.find")
              return args.name === "node"
                ? { available: true, handle: "node-fixture" }
                : { available: false };
            if (method === "process.resolveEntry") return { handle: "search-entry" };
            if (method === "process.spawn") {
              window.sourceInput = "";
              return { processId: "source-process" };
            }
            if (method === "process.write") {
              window.sourceInput += args.text;
              return {};
            }
            if (method === "process.end") return {};
            if (method === "process.get")
              return {
                found: true,
                processId: "source-process",
                status: "exited",
                code: 0,
                hasMore: false,
                events: [
                  {
                    sequence: 1,
                    event: "process.output",
                    payload: {
                      stream: "stdout",
                      text: JSON.stringify({
                        source: "search-index",
                        candidates: candidates
                          .filter(
                            (item) => item.platform === JSON.parse(window.sourceInput).platform,
                          )
                          .map((item) => ({ ...item, evidence: "search-index" })),
                      }),
                    },
                  },
                ],
              };
          }
          throw new Error(`Unexpected ${method}`);
        },
      };
      const { mountVideoSearch } = await import("/video-search.js");
      window.mountOptions = {
        panel: window.panelMock,
        container: document.querySelector("#search"),
        async prepareSearch() {
          window.calls.push({ method: "search.preflight" });
          if (options.holdPreflight)
            await new Promise((resolve) => {
              window.releasePreflight = resolve;
            });
          if (options.preflightFailure) throw new Error("没有可用的检索工具");
          return { source: "owned-fixture" };
        },
        archiveStorage: {
          async load() {
            return { scope: "/fixture/project", value: window.archiveSnapshot };
          },
          async save(snapshot) {
            window.archiveSnapshot = structuredClone(snapshot);
          },
        },
        async searchCandidates(request) {
          window.lookupCalls.push({
            query: request.query,
            platforms: request.platforms,
            limit: request.limit,
          });
          if (options.lookupFailure) throw new Error("平台暂不可用");
          if (options.holdLookup)
            await new Promise((resolve) => {
              window.releaseLookup = resolve;
            });
          return {
            candidates: candidates
              .filter((candidate) => request.platforms.includes(candidate.platform))
              .map((candidate) =>
                options.indexed && candidate.platform === "bilibili"
                  ? { ...candidate, evidence: "search-index" }
                  : candidate,
              ),
            warnings: [],
          };
        },
        async onQueue(items) {
          window.queued.push(...items);
          return options.pendingQueue
            ? { added: 0, duplicates: 1, pending: 1 }
            : { added: items.length, duplicates: 0, pending: 0 };
        },
        async onPreview(candidate) {
          window.previewed.push(candidate);
        },
      };
      if (options.nodeOnly) {
        const { prepareVideoSearchSource, searchVideoPlatforms } =
          await import("/video-search-source.js");
        const { createLibraryProcess } = await import("/library-process.js");
        const auxiliary = createLibraryProcess(window.panelMock);
        const context = {
          availableMethods: [
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
          ],
        };
        window.mountOptions.prepareSearch = ({ signal }) =>
          prepareVideoSearchSource({
            panel: window.panelMock,
            context,
            auxiliary,
            signal,
            runtime: { ytDlp: null, directory: { handle: "project-directory" } },
          });
        window.mountOptions.searchCandidates = (request) =>
          searchVideoPlatforms(request, request.prepared, auxiliary);
      }
      if (options.accounts) {
        const { prepareVideoSearchSource, listVideoSearchAccounts } =
          await import("/video-search-source.js");
        const context = {
          availableMethods: [
            "agent.task.models",
            "agent.task.start",
            "agent.task.get",
            "agent.task.cancel",
            "process.find",
            "process.spawn",
            "process.get",
            "process.cancel",
            "credentials.cookies.listForTask",
            "credentials.cookies.authorizeProcess",
          ],
          capabilities: {
            tasks: { cookieCredentials: true },
            process: { cookieCredentials: true },
          },
        };
        window.mountOptions.listSearchAccounts = async (platform) => ({
          ...(await listVideoSearchAccounts({ context, panel: window.panelMock, platform })),
          canLogin: options.canLogin === true,
        });
        window.mountOptions.prepareSearch = (request) =>
          prepareVideoSearchSource({
            ...request,
            context,
            panel: window.panelMock,
            auxiliary: {},
            runtime: {
              ytDlp: { handle: "yt-dlp-fixture" },
              directory: { handle: "project-directory" },
            },
          });
      }
      if (options.hostPending) {
        window.pendingSnapshot = null;
        window.pendingWrites = [];
        window.mountOptions.pendingStorage = {
          async load() {
            return structuredClone(window.pendingSnapshot);
          },
          async save(snapshot) {
            if (window.failPending) throw new Error("storage unavailable");
            if (window.holdPending) {
              await new Promise((resolve) => {
                window.releasePending = resolve;
              });
              window.holdPending = false;
            }
            window.pendingSnapshot = structuredClone(snapshot);
            window.pendingWrites.push(structuredClone(snapshot));
          },
        };
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new Error("SecurityError");
          },
        });
      }
      window.search = mountVideoSearch(window.mountOptions);
      await window.search.ready;
    },
    { candidates, options },
  );
  await page.locator("[data-search-query]").fill("Blender 中文入门教程，20分钟左右");
  return page;
}

test("mobile search explicitly selects per-platform accounts and authorizes before AI without exposing account metadata", async (t) => {
  const page = await openSearch(t, { accounts: true, hostPending: true, width: 390 });
  assert.equal(await page.locator('[data-search-account="bilibili"]').inputValue(), "");
  assert.equal(await page.locator('[data-search-account="youtube"]').inputValue(), "");
  assert.match(
    await page.locator("[data-search-account-help]").textContent(),
    /执行此项目的桌面 Host/,
  );
  await page.locator("[data-search-scope]").selectOption("bilibili");
  assert.equal(await page.locator('[data-search-account-row="youtube"]').isVisible(), false);
  await page.locator('[data-search-account="bilibili"]').selectOption({ label: "B 站已保存账号" });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "ready");
  const calls = await page.evaluate(() => window.calls);
  const authorization = calls.find(
    (call) => call.method === "credentials.cookies.authorizeProcess",
  );
  assert.deepEqual(authorization.args, {
    credentialId: "bilibili-account",
    revision: "b".repeat(64),
    url: "https://www.bilibili.com/",
    executableHandle: "yt-dlp-fixture",
  });
  assert.ok(
    calls.indexOf(authorization) < calls.findIndex((call) => call.method === "agent.task.start"),
  );
  const requests = calls.filter((call) => call.method === "agent.task.start");
  assert.equal(requests.length, 2);
  assert.doesNotMatch(JSON.stringify(requests), /bilibili-account|sealed-|bbbbbbbb/);
  assert.deepEqual(await page.evaluate(() => window.lookupCalls.map((call) => call.platforms)), [
    ["bilibili"],
  ]);
  const writes = await page.evaluate(() => window.pendingWrites.filter(Boolean));
  assert.ok(writes.some((saved) => saved.accounts.bilibili?.id === "bilibili-account"));
  assert.doesNotMatch(JSON.stringify(writes), /sealed-/);
  assert.doesNotMatch(
    await page.evaluate(() => JSON.stringify(window.archiveSnapshot)),
    /bilibili-account|sealed-/,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test("refused account authorization stops before AI and requires explicit anonymous selection to retry", async (t) => {
  const page = await openSearch(t, { accounts: true, denyAuthorization: true, canLogin: true });
  assert.match(
    await page.locator("[data-search-account-help]").textContent(),
    /下载页重新登录并保存/,
  );
  await page.locator("[data-search-scope]").selectOption("bilibili");
  await page.locator('[data-search-account="bilibili"]').selectOption({ label: "B 站已保存账号" });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "error");
  assert.match(await page.locator("[data-search-status]").textContent(), /未获准.*不会改为匿名/);
  assert.equal(await page.evaluate(() => window.taskNumber), 0);
  assert.equal(await page.evaluate(() => window.lookupCalls.length), 0);
  assert.notEqual(await page.locator('[data-search-account="bilibili"]').inputValue(), "");
  await page.locator('[data-search-account="bilibili"]').selectOption("");
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "ready");
  assert.equal(await page.evaluate(() => window.taskNumber), 2);
});

test("account refresh never silently adopts a replaced login and preflight requires reselection", async (t) => {
  const page = await openSearch(t, { accounts: true });
  await page.locator("[data-search-scope]").selectOption("bilibili");
  await page.locator('[data-search-account="bilibili"]').selectOption({ label: "B 站已保存账号" });
  const oldSelection = await page.locator('[data-search-account="bilibili"]').inputValue();
  await page.evaluate(() => {
    window.accountCatalog.bilibili[0].revision = "c".repeat(64);
  });
  await page.locator("[data-search-account-refresh]").click();
  await page.waitForFunction(
    () => !document.querySelector("[data-search-account-refresh]").disabled,
  );
  assert.equal(await page.locator('[data-search-account="bilibili"]').inputValue(), oldSelection);
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "error");
  assert.match(
    await page.locator("[data-search-status]").textContent(),
    /账号已变化或不可用.*先刷新并重新选择/,
  );
  assert.equal(await page.evaluate(() => window.taskNumber), 0);
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter((call) => call.method === "credentials.cookies.authorizeProcess")
          .length,
    ),
    0,
  );
  await page.locator('[data-search-account="bilibili"]').selectOption({ label: "B 站已保存账号" });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "ready");
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.find((call) => call.method === "credentials.cookies.authorizeProcess").args
          .revision,
    ),
    "c".repeat(64),
  );
});

test("cancelling while account confirmation is pending ignores a late grant without AI or lookup", async (t) => {
  const page = await openSearch(t, { accounts: true, holdAuthorization: true });
  await page.locator('[data-search-account="bilibili"]').selectOption({ label: "B 站已保存账号" });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => typeof window.releaseAuthorization === "function");
  assert.equal(await page.locator('[data-search-account="bilibili"]').isDisabled(), true);
  await page.locator("[data-search-cancel]").click();
  await page.evaluate(() => window.releaseAuthorization());
  await page.waitForFunction(() => window.search.getState().status === "cancelled");
  assert.equal(await page.evaluate(() => window.taskNumber), 0);
  assert.equal(await page.evaluate(() => window.lookupCalls.length), 0);
});

test("planning recovery retains account identity but gets a fresh authorization before platform lookup", async (t) => {
  const page = await openSearch(t, { accounts: true, hold: "planning", hostPending: true });
  await page.locator("[data-search-scope]").selectOption("bilibili");
  await page.locator('[data-search-account="bilibili"]').selectOption({ label: "B 站已保存账号" });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(
    () => Boolean(window.search.getState().taskId) && window.pendingSnapshot?.taskId,
  );
  await page.evaluate(async () => {
    const active = window.lastTask;
    window.search.destroy();
    const call = window.panelMock.call;
    window.panelMock.call = async (method, args) =>
      method === "agent.task.list" ? [active] : call(method, args);
    const { mountVideoSearch } = await import("/video-search.js");
    window.search = mountVideoSearch(window.mountOptions);
    await window.search.ready;
    window.search.handleTaskChanged({ ...active, status: "completed", updatedAt: Date.now() + 1 });
  });
  await page.waitForFunction(() => window.search.getState().status === "ready");
  const calls = await page.evaluate(() => window.calls);
  assert.equal(calls.filter((call) => call.method === "agent.task.start").length, 2);
  const authorizations = calls.filter(
    (call) => call.method === "credentials.cookies.authorizeProcess",
  );
  assert.equal(authorizations.length, 2);
  assert.deepEqual(authorizations[1].args, authorizations[0].args);
  assert.deepEqual(await page.evaluate(() => window.search.getState().accounts), {
    bilibili: { id: "bilibili-account", revision: "b".repeat(64) },
  });
});

test("malformed pending platforms with account metadata cannot leave search initialization disabled", async (t) => {
  for (const platforms of [42, {}]) {
    const page = await openSearch(t, { accounts: true, hostPending: true });
    await page.evaluate(async (platforms) => {
      window.search.destroy();
      window.pendingSnapshot = {
        query: "old query",
        platforms,
        accounts: { bilibili: { id: "bilibili-account", revision: "b".repeat(64) } },
      };
      const { mountVideoSearch } = await import("/video-search.js");
      window.search = mountVideoSearch(window.mountOptions);
      await window.search.ready;
    }, platforms);
    await page.locator("[data-search-query]").fill("新的公开视频查询");
    assert.equal(await page.locator("[data-search-start]").isDisabled(), false);
    assert.equal(await page.locator('[data-search-account="bilibili"]').inputValue(), "");
    await page.locator("[data-search-start]").click();
    await page.waitForFunction(() => window.search.getState().status === "ready");
    assert.equal(
      await page.evaluate(
        () =>
          window.calls.filter((call) => call.method === "credentials.cookies.authorizeProcess")
            .length,
      ),
      0,
    );
  }
});

test("two AI stages use zero tools and result actions preserve real platform evidence", async (t) => {
  const page = await openSearch(t, { pendingQueue: true });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "ready");
  assert.equal(await page.locator(".video-search-result").count(), 2);
  assert.equal(
    await page.locator(".video-search-result h3").first().textContent(),
    candidates[1].title,
  );
  const starts = await page.evaluate(() =>
    window.calls.filter((call) => call.method === "agent.task.start"),
  );
  assert.equal(starts.length, 2);
  assert.equal(
    await page.evaluate(() => {
      const calls = window.calls.map((call) => call.method);
      return calls.indexOf("search.preflight") < calls.indexOf("agent.task.start");
    }),
    true,
    "source preflight must finish before the first model request",
  );
  for (const call of starts) assert.deepEqual(call.args.toolNames, []);
  assert.deepEqual(await page.evaluate(() => window.lookupCalls.map((call) => call.platforms)), [
    ["youtube"],
    ["bilibili"],
  ]);
  await page.locator('[data-action="source"]').first().click();
  await page.waitForFunction(() => window.calls.some((call) => call.method === "external.open"));
  assert.equal(
    (await page.evaluate(() => window.calls.find((call) => call.method === "external.open"))).args
      .url,
    biliUrl,
  );
  await page.locator('[data-action="preview"]').first().click();
  await page.waitForFunction(() => window.previewed.length === 1);
  assert.equal((await page.evaluate(() => window.previewed[0])).url, biliUrl);
  await page.locator("[data-search-select-all]").check();
  await page.locator("[data-search-queue]").click();
  await page.waitForFunction(() => window.queued.length === 2);
  assert.match(
    await page.locator("[data-search-status]").textContent(),
    /1 条已在队列中.*1 条已存在文件/,
  );
});

test("unavailable search tools fail preflight without starting a model task", async (t) => {
  const page = await openSearch(t, { preflightFailure: true });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "error");
  assert.match(
    await page.locator("[data-search-status]").textContent(),
    /查询准备失败.*没有可用的检索工具/,
  );
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.method === "agent.task.start").length,
    ),
    0,
  );
  assert.equal(await page.evaluate(() => window.lookupCalls.length), 0);
  assert.equal(await page.locator("[data-search-start]").isDisabled(), false);
});

test("the UI completes both AI stages using Node-only sources without yt-dlp", async (t) => {
  const page = await openSearch(t, { nodeOnly: true });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "ready");
  assert.equal(await page.locator(".video-search-result").count(), 2);
  const calls = await page.evaluate(() => window.calls);
  assert.equal(calls.filter((call) => call.method === "agent.task.start").length, 2);
  const starts = calls.filter((call) => call.method === "process.spawn");
  assert.equal(starts.length, 2);
  assert.ok(
    starts.every(
      (call) =>
        call.args.executableHandle === "node-fixture" && call.args.entryHandle === "search-entry",
    ),
  );
  assert.ok(
    calls.findIndex((call) => call.method === "process.resolveEntry") <
      calls.findIndex((call) => call.method === "agent.task.start"),
  );
  assert.ok(
    (await page.evaluate(() => window.search.getState().candidates)).every(
      (item) => item.evidence === "search-index",
    ),
  );
});

test("cancelling pending source discovery cannot start AI when discovery resolves late", async (t) => {
  const page = await openSearch(t, { holdPreflight: true });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "preparing");
  assert.equal(await page.locator("[data-search-start]").isDisabled(), true);
  await page.locator("[data-search-cancel]").click();
  await page.evaluate(() => window.releasePreflight());
  await page.waitForFunction(() => window.search.getState().status === "cancelled");
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.method === "agent.task.start").length,
    ),
    0,
  );
  assert.equal(await page.evaluate(() => window.lookupCalls.length), 0);
});

test("indexed links are labeled unverified in the live search and history", async (t) => {
  const page = await openSearch(t, { indexed: true });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "ready");
  assert.match(
    await page.locator(".video-search-result").first().textContent(),
    /公开搜索索引.*页面可访问性待确认/,
  );
  await page.waitForFunction(() => window.archiveSnapshot?.records?.length);
  const archive = await page.evaluate(() => window.archiveSnapshot);
  assert.equal(
    archive.records[0].candidates.find((item) => item.platform === "bilibili").evidence,
    "historical-index",
  );
});

test("failed platform searches do not display model memory as results", async (t) => {
  const page = await openSearch(t, { lookupFailure: true });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "error");
  assert.equal(await page.locator(".video-search-result").count(), 0);
  assert.match(await page.locator("[data-search-status]").textContent(), /未能取得可核验/);
  assert.equal(
    (await page.evaluate(() => window.calls.filter((call) => call.method === "agent.task.start")))
      .length,
    1,
  );
});

test("invalid AI ranking retains real candidates and never fabricated IDs", async (t) => {
  const page = await openSearch(t, { badRank: true, width: 320 });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "ready");
  const status = await page.locator("[data-search-status]").textContent();
  assert.match(status, /AI 筛选未完成，保留真实平台结果/);
  assert.doesNotMatch(status, /平台检索(?:失败|未完成)/);
  assert.equal(await page.locator(".video-search-result").count(), 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
});

test("cancelling AI planning ignores its late result and performs no platform query", async (t) => {
  const page = await openSearch(t, { hold: "planning" });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().taskId);
  const task = await page.evaluate(() => window.lastTask);
  await page.locator("[data-search-cancel]").click();
  await page.evaluate(
    (task) =>
      window.search.handleTaskChanged({ ...task, status: "completed", updatedAt: Date.now() + 1 }),
    task,
  );
  assert.equal((await page.evaluate(() => window.search.getState())).status, "cancelled");
  assert.equal((await page.evaluate(() => window.lookupCalls)).length, 0);
  assert.equal(
    (await page.evaluate(() => window.calls.filter((call) => call.method === "agent.task.cancel")))
      .length,
    1,
  );
});

test("cancelling local search prevents ranking and ignores late native results", async (t) => {
  const page = await openSearch(t, { holdLookup: true });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => Boolean(window.releaseLookup));
  await page.locator("[data-search-cancel]").click();
  await page.evaluate(() => window.releaseLookup());
  await page.waitForFunction(() => window.search.getState().status === "cancelled");
  assert.equal(
    (await page.evaluate(() => window.calls.filter((call) => call.method === "agent.task.start")))
      .length,
    1,
  );
  assert.equal(await page.locator(".video-search-result").count(), 0);
});

test("cancel before task.start resolves cancels the late task without using its result", async (t) => {
  const page = await openSearch(t, { holdStart: true, hold: "planning" });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => Boolean(window.releaseStart));
  await page.locator("[data-search-cancel]").click();
  await page.evaluate(() => window.releaseStart());
  await page.waitForFunction(() =>
    window.calls.some((call) => call.method === "agent.task.cancel"),
  );
  assert.equal((await page.evaluate(() => window.lookupCalls)).length, 0);
  assert.equal((await page.evaluate(() => window.search.getState())).status, "cancelled");
});

test("failed cancellation keeps the task visible and allows retry instead of starting duplicates", async (t) => {
  const page = await openSearch(t, { hold: "planning" });
  await page.evaluate(() => {
    window.rejectCancel = true;
  });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => Boolean(window.search.getState().taskId));
  await page.locator("[data-search-cancel]").click();
  await page.waitForFunction(() => window.search.getState().status === "cancel-error");
  assert.equal(await page.locator("[data-search-start]").isDisabled(), true);
  assert.equal(await page.locator("[data-search-cancel]").textContent(), "重试取消");
  await page.evaluate(() => {
    window.rejectCancel = false;
  });
  await page.locator("[data-search-cancel]").click();
  await page.waitForFunction(() => window.search.getState().status === "cancelled");
  assert.equal(
    (await page.evaluate(() => window.calls.filter((call) => call.method === "agent.task.start")))
      .length,
    1,
  );
});

test("remount reattaches pending planning without creating a duplicate AI task", async (t) => {
  const page = await openSearch(t, { hold: "planning" });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => Boolean(window.search.getState().taskId));
  await page.evaluate(async () => {
    const active = window.lastTask;
    window.search.destroy();
    const originalCall = window.panelMock.call;
    window.panelMock.call = async (method, args) =>
      method === "agent.task.list" ? [active] : originalCall(method, args);
    const { mountVideoSearch } = await import("/video-search.js");
    window.search = mountVideoSearch(window.mountOptions);
    await window.search.ready;
  });
  assert.equal((await page.evaluate(() => window.search.getState())).status, "planning");
  assert.equal(
    (await page.evaluate(() => window.calls.filter((call) => call.method === "agent.task.start")))
      .length,
    1,
  );
  await page.evaluate(() =>
    window.search.handleTaskChanged({
      ...window.lastTask,
      status: "completed",
      updatedAt: Date.now() + 1,
    }),
  );
  await page.waitForFunction(() => window.search.getState().status === "ready");
  assert.equal(
    (await page.evaluate(() => window.calls.filter((call) => call.method === "agent.task.start")))
      .length,
    2,
  );
  assert.equal((await page.evaluate(() => window.lookupCalls)).length, 2);
});

test("custom Provider search saves results, supports deletion, and can be searched again", async (t) => {
  const page = await openSearch(t, {
    models: [
      { id: "model-a", label: "Default model", provider: "Built-in", providerId: "built-in" },
      { id: "model-b", label: "External model", provider: "External", providerId: "external" },
    ],
  });
  await page.locator("[data-search-provider]").selectOption("external");
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(
    () =>
      window.search.getState().status === "ready" && window.archiveSnapshot?.records.length === 1,
  );
  assert.equal(
    await page.evaluate(
      () => window.calls.find((call) => call.method === "agent.task.start").args.model,
    ),
    "model-b",
  );
  assert.equal(await page.locator(".video-search-library-item").count(), 1);
  await page.locator('[data-library-action="view"]').click();
  assert.match(await page.locator("[data-search-status]").textContent(), /保存的结果/);
  await page.locator('[data-action="remove"]').first().click();
  await page.waitForFunction(() => window.archiveSnapshot.records[0].candidates.length === 1);
  await page.evaluate(async () => {
    window.search.destroy();
    const { mountVideoSearch } = await import("/video-search.js");
    window.search = mountVideoSearch(window.mountOptions);
    await window.search.ready;
  });
  assert.equal(await page.locator(".video-search-library-item").count(), 1);
  assert.equal(await page.locator("[data-search-model]").inputValue(), "model-b");
  await page.locator('[data-library-action="redo"]').click();
  await page.waitForFunction(
    () =>
      window.search.getState().status === "ready" && window.archiveSnapshot.records.length === 2,
  );
  await page.locator('[data-library-action="delete"]').first().click();
  await page.waitForFunction(() => window.archiveSnapshot.records.length === 1);
  await page.locator("[data-search-clear-history]").click();
  await page.waitForFunction(() => window.archiveSnapshot.records.length === 0);
  const fromChat = await page.evaluate(() =>
    window.search.startFromChat({
      query: "Blender animation tutorials",
      platform: "youtube",
      providerId: "external",
    }),
  );
  assert.equal(fromChat.status, "started");
  await page.waitForFunction(
    () =>
      window.search.getState().status === "ready" && window.archiveSnapshot.records.length === 1,
  );
  const found = await page.evaluate(() => window.search.history());
  assert.equal(found[0].query, "Blender animation tutorials");
  assert.equal(found[0].candidates.length, 1);
  assert.deepEqual(await page.evaluate((id) => window.search.deleteRecord(id), found[0].id), {
    deleted: true,
  });
  assert.equal(await page.locator(".video-search-library-item").count(), 0);
});

test("search examples, stages, history filtering and new queries keep saved results intact", async (t) => {
  const page = await openSearch(t, { width: 620 });
  await page.locator("[data-search-example]").first().click();
  assert.match(await page.locator("[data-search-query]").inputValue(), /Blender/);
  assert.equal(await page.evaluate(() => window.lookupCalls.length), 0);
  await page.locator("[data-search-query]").press("Control+Enter");
  await page.waitForFunction(() => window.archiveSnapshot?.records.length === 1);
  assert.equal(await page.locator('.search-stages li[data-state="done"]').count(), 3);
  await page.locator("[data-search-library-query]").fill("没有这个主题");
  assert.equal(await page.locator(".video-search-library-item").count(), 0);
  await page.locator("[data-search-library-query]").fill("Blender");
  assert.equal(await page.locator(".video-search-library-item").count(), 1);
  const artifacts = resolve(appDirectory, "../../../artifacts/video-download/interface");
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({
    path: resolve(artifacts, "search-results-620-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.locator("[data-search-new]").click();
  assert.equal(await page.locator("[data-search-query]").inputValue(), "");
  assert.equal(await page.locator(".video-search-result").count(), 0);
  assert.equal(await page.locator(".video-search-library-item").count(), 1);
  assert.equal(await page.locator("[data-search-stages]").isVisible(), false);
  await page.locator('[data-library-action="view"]').click();
  assert.equal(await page.locator(".video-search-result").count(), 2);
  assert.equal(await page.locator("[data-search-plan]").isVisible(), false);
});

for (const completed of [false, true]) {
  test(`Host storage recovers ${completed ? "completed" : "running"} planning without localStorage or a duplicate request`, async (t) => {
    const page = await openSearch(t, { hold: "planning", hostPending: true });
    await page.locator("[data-search-start]").click();
    await page.waitForFunction(() => Boolean(window.pendingSnapshot?.taskId));
    await page.evaluate(async (completed) => {
      const task = { ...window.lastTask, ...(completed ? { status: "completed" } : {}) };
      window.search.destroy();
      const original = window.panelMock.call;
      window.panelMock.call = (method, args) =>
        method === "agent.task.list" ? [task] : original(method, args);
      const { mountVideoSearch } = await import("/video-search.js");
      window.search = mountVideoSearch(window.mountOptions);
      await window.search.ready;
      if (!completed)
        window.search.handleTaskChanged({
          ...task,
          status: "completed",
          updatedAt: Date.now() + 1,
        });
    }, completed);
    await page.waitForFunction(
      () => window.search.getState().status === "ready" && window.pendingSnapshot === null,
    );
    const starts = await page.evaluate(() =>
      window.calls.filter(({ method }) => method === "agent.task.start"),
    );
    assert.equal(starts.filter(({ args }) => args.key.includes("planning")).length, 1);
    assert.equal(starts.length, 2);
    assert.equal((await page.evaluate(() => window.lookupCalls)).length, 2);
  });
}

test("a delayed recovery write cannot resurrect a completed search", async (t) => {
  const page = await openSearch(t, { hostPending: true });
  await page.evaluate(() => {
    window.holdPending = true;
  });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "ready");
  await page.evaluate(() => window.releasePending());
  await page.waitForFunction(
    () => window.pendingWrites.length > 1 && window.pendingWrites.at(-1) === null,
  );
  assert.equal(await page.evaluate(() => window.pendingSnapshot), null);
});

test("failed recovery storage is visible and does not discard current search results", async (t) => {
  const page = await openSearch(t, { hostPending: true });
  await page.evaluate(() => {
    window.failPending = true;
  });
  await page.locator("[data-search-start]").click();
  await page.waitForFunction(() => window.search.getState().status === "ready");
  assert.equal(await page.locator("[data-search-recovery-status]").isVisible(), true);
  assert.match(
    await page.locator("[data-search-recovery-status]").textContent(),
    /storage unavailable/,
  );
  assert.equal(await page.locator(".video-search-result").count(), 2);
});
