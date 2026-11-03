import test from "node:test";
import assert from "node:assert/strict";
import { createNotesController } from "../../../apps/quant-lab/app/modules/notes-ui.mjs";
import { createNote, createEmptyNotes, serializeNotes } from "../../../apps/quant-lab/app/notes.mjs";
import { normalizeNewsItem, parseNewsSubscriptions, mergeNewsCache, emptyNewsCache, buildNewsFeed } from "../../../apps/quant-lab/app/news-feed.mjs";

class Element {
  constructor() { this.children = []; this.dataset = {}; this.value = ""; this.textContent = ""; this.listeners = new Map(); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  setAttribute() {} focus() {}
}
const at = "2026-08-26T13:00:00.000Z";
const subscriptions = parseNewsSubscriptions(JSON.stringify({ format: "codeshell.news-subscriptions", version: 1,
  enabledSources: ["eastmoney-stock"], symbols: [{ symbol: "SH600519", market: "cn", origins: ["watch"] }], secContact: null, updatedAt: at }));
const item = normalizeNewsItem({ id: "em:local", sourceId: "em:local", title: "本地资讯更新", url: "https://finance.eastmoney.com/a/local.html",
  source: "eastmoney-stock", market: "cn", symbol: "SH600519", association: "confirmed", sourceTier: 2,
  publishedAt: at, fetchedAt: at, availableAt: at, stale: false, form: null, kind: "news" });
const feed = buildNewsFeed(mergeNewsCache(emptyNewsCache(at), [{ source: "eastmoney-stock", status: "ok", items: [item] }], subscriptions, at), subscriptions, at);
const newsId = feed.items[0].id;
const ledger = { format: "codeshell.portfolio-transactions", version: 1, baseCurrency: "CNY",
  accounts: [{ id: "cn", name: "Fixture", broker: "fixture", currencies: ["CNY"] }],
  instruments: [{ id: "cn-stock", type: "stock", market: "cn", currency: "CNY", symbol: "SH600519", name: "贵州茅台", aliases: [] }],
  transactions: [{ id: "present", type: "buy", accountId: "cn", instrumentId: "cn-stock", tradeDate: "2026-08-26", quantity: "1", price: "10", commission: "0", tax: "0", otherFees: "0", createdAt: at }] };
const links = [
  { type: "news", newsItemId: newsId, fingerprint: "fnv1a32:11111111" },
  { type: "news", newsItemId: "deleted-news", fingerprint: "fnv1a32:22222222" },
  { type: "transaction", transactionId: "present" },
  { type: "transaction", transactionId: "deleted-transaction" },
];
const journal = links => serializeNotes({ ...createEmptyNotes(at), updatedAt: at,
  entries: [createNote({ title: "冷开笔记", body: "当前项目本地关联", tags: [], links }, { id: "local-note", now: at })] });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture({ noteLinks = links, feedSource = JSON.stringify(feed), feedKind = "file", block, initialContext } = {}) {
  const elements = new Map(), calls = [], files = new Map([
    ["portfolio/journal.json", journal(noteLinks)], ["portfolio/transactions.json", JSON.stringify(ledger)], ["data/news/feed.json", feedSource],
  ]);
  let epoch = 1;
  let liveContext = initialContext ?? { ledger: null, holdings: null, rules: [], news: null, unavailableSources: { ledger: true, rules: true } };
  const byId = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  byId("notes-filter-link").value = "all";
  const controller = createNotesController({ root: { querySelector: selector => byId(selector.slice(1)) }, currentEpoch: () => epoch,
    context: () => liveContext, now: () => new Date(at),
    hostCall: async (method, params, intent) => {
      calls.push({ method, params, intent });
      if (block?.method === method && block?.path === params.path) { block.entered.resolve(); await block.release.promise; }
      if (method === "workspace.list") return { entries: [...files.keys()].filter(path => path.slice(0, path.lastIndexOf("/")) === params.path).map(path => ({ kind: path === "data/news/feed.json" ? feedKind : "file", path })) };
      if (method === "workspace.readText") return { content: files.get(params.path), modifiedAt: 1 };
      throw new Error(`unexpected side effect ${method}`);
    },
  });
  return { controller, elements, calls, files, setContext(value) { liveContext = value; }, switchProject() { epoch++; controller.reset(); } };
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
const linkedRows = f => descendants(f.elements.get("notes-list")).filter(node => node.className === "notes-resolved-link");
async function withDom(run) {
  const original = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  try { await run(); } finally { globalThis.document = original; }
}

test("cold Notes resolves existing local news as changed and distinguishes genuinely deleted news/transactions", () => withDom(async () => {
  const f = fixture(); await f.controller.load();
  const rows = linkedRows(f);
  assert.deepEqual(rows.map(row => row.textContent.split(" · ")[0]), ["关联内容有更新", "原关联已不存在", "关联有效", "原关联已不存在"]);
  assert.match(rows[0].title, new RegExp(`当前指纹 ${feed.items[0].fingerprint}`));
  assert.deepEqual(f.calls.filter(call => call.method === "workspace.readText").map(call => call.params.path).sort(), ["data/news/feed.json", "portfolio/journal.json", "portfolio/transactions.json"]);
  assert.ok(f.calls.every(call => ["workspace.list", "workspace.readText"].includes(call.method)), "no hidden module, native collector or write is started");
  assert.ok(f.calls.filter(call => call.intent).every(call => call.intent.owner === "notes-references" && call.intent.signal));
}));

test("Notes without links reads only its journal, and invalid referenced files never mean deleted", () => withDom(async () => {
  const plain = fixture({ noteLinks: [] }); await plain.controller.load();
  assert.deepEqual(plain.calls.map(call => call.params.path), ["portfolio", "portfolio/journal.json"]);
  assert.deepEqual(plain.controller.facts(), { status: "unavailable", reason: "ledger-not-available", source: "portfolio/transactions.json" });
  assert.equal(plain.elements.get("notes-count").textContent, "1 条 · 交易关联待核对", "an unread ledger must not be reported as zero transactions");
  const broken = fixture({ noteLinks: [links[0]], feedSource: "{" }); await broken.controller.load();
  assert.match(linkedRows(broken)[0].textContent, /^关联暂不可核对/u);
  assert.doesNotMatch(linkedRows(broken)[0].textContent, /已不存在/u);
  assert.match(broken.elements.get("notes-live").textContent, /部分关联暂不可核对/u);
  assert.equal(broken.controller.state.readError, null, "an unrelated damaged feed must not freeze the valid journal");
  const directory = fixture({ noteLinks: [links[0]], feedKind: "directory" }); await directory.controller.load();
  assert.match(linkedRows(directory)[0].textContent, /^关联暂不可核对/u, "a directory replacing the reference source is corruption, not confirmed deletion");
  const rule = fixture({ noteLinks: [{ type: "rule", ruleId: "review-due", evidenceAsOf: at }] }); await rule.controller.load();
  assert.match(linkedRows(rule)[0].textContent, /^关联暂不可核对/u, "a hidden, uncomputed rule is not a deleted rule");
  assert.deepEqual(rule.calls.map(call => call.params.path), ["portfolio", "portfolio/journal.json"], "rule links do not trigger hidden history loading");
}));

test("a live controller resetting behind the reference-read barrier cannot replace verified local links with unconfirmed absence", () => withDom(async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ initialContext: { ledger, news: feed, rules: [], unavailableSources: { ledger: false, rules: true } },
    block: { method: "workspace.readText", path: "data/news/feed.json", entered, release } });
  const pending = f.controller.load(); await entered.promise;
  // A holdings reload/reset clears its object before its new base read settles;
  // News reset similarly clears feed but has not confirmed the file is absent.
  f.setContext({ ledger: null, news: null, rules: [], unavailableSources: { ledger: true, rules: true } });
  release.resolve(); await pending;
  assert.deepEqual(linkedRows(f).map(row => row.textContent.split(" · ")[0]), ["关联内容有更新", "原关联已不存在", "关联有效", "原关联已不存在"]);
  f.setContext({ ledger: { transactions: [], instruments: [] }, news: null, rules: [], unavailableSources: { ledger: true, rules: true } });
  f.controller.render();
  assert.match(linkedRows(f)[2].textContent, /^关联有效/u, "a form's provisional empty ledger is not an authoritative absence");
  f.setContext({ ledger: null, news: null, rules: [], unavailableSources: { ledger: false, news: false, rules: true } });
  f.controller.render();
  assert.ok(linkedRows(f).every(row => row.textContent.startsWith("原关联已不存在")), "an explicitly confirmed missing source may replace the local reference snapshot");
}));

for (const method of ["workspace.list", "workspace.readText"]) test(`pending Notes reference ${method} cannot publish into another project`, () => withDom(async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ noteLinks: [links[0]], block: { method, path: method === "workspace.list" ? "data/news" : "data/news/feed.json", entered, release } });
  const pending = f.controller.load(); await entered.promise;
  f.switchProject(); release.resolve(); await pending;
  assert.equal(f.controller.state.document, null);
  assert.equal(f.elements.get("notes-list").children.length, 0);
  assert.equal(f.calls.find(call => call.intent)?.intent.signal.aborted, true);
  if (method === "workspace.list") assert.equal(f.calls.some(call => call.params.path === "data/news/feed.json"), false);
}));
