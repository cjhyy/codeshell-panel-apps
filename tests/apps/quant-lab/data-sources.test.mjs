import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from "node:assert/strict";
import test from "node:test";
import { parseDataSourceConfig } from "../../../apps/quant-lab/app/data-source-config.mjs";
import {
  fetchEastmoneyIndustryDirectory,
  fetchEastmoneyIndustryMembers,
  parseStandardIndustries,
  resolveIndustryProvider,
  readProviderJson,
  isPublicSourceAddress,
} from "../../../apps/quant-lab/app/tools/industry-providers.mjs";

const now = new Date("2026-09-21T05:00:00Z");
function store() {
  const records = new Map();
  return {
    records,
    readSnapshot: async ({ stream, scope }) => records.get(`${stream}:${scope}`) ?? null,
    writeSnapshot: async ({ stream, scope, snapshot }) =>
      records.set(`${stream}:${scope}`, structuredClone(snapshot)),
  };
}
const industries = {
  data: { total: 1, diff: [{ f12: "BK0001", f14: "机械设备", f3: 2, f6: 1000 }] },
};

test("configuration rejects credentials, private literals and unsupported capabilities", () => {
  assert.equal(parseDataSourceConfig().industry, "auto");
  assert.deepEqual(parseDataSourceConfig({ industry: "eastmoney", label: "旧配置", endpoint: "invalid" }), { version: 1, industry: "eastmoney", endpoint: "", label: "" });
  for (const endpoint of [
    "http://example.com/a",
    "https://u:p@example.com/a",
    "https://localhost/a",
    "https://127.0.0.1/a",
    "https://example.com/a?token=secret",
  ]) {
    assert.throws(() =>
      parseDataSourceConfig({ industry: "standard-json", label: "我的数据", endpoint }),
    );
  }
  assert.throws(() => parseDataSourceConfig({ industry: "unknown" }));
  for (const ip of ["127.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "::1", "fc00::1"])
    assert.equal(isPublicSourceAddress(ip), false);
});
test("custom endpoint DNS, HTTP failure and JSON are checked before use", async () => {
  let fetched = false;
  await assert.rejects(
    readProviderJson("https://example.com/data", {
      custom: true,
      resolveHost: async () => [{ address: "127.0.0.1" }],
      fetchImpl: async () => {
        fetched = true;
      },
    }),
    /公开网络/,
  );
  assert.equal(fetched, false);
  await assert.rejects(
    readProviderJson("https://example.com/data", {
      fetchImpl: async () => new Response("", { status: 429 }),
    }),
    { code: "SOURCE_HTTP_429" },
  );
  await assert.rejects(readProviderJson("https://example.com/data", {
    fetchImpl: async () => { throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }); },
  }), { code: "SOURCE_NETWORK_ECONNRESET" });
});
test("Eastmoney pagination validates completeness and keeps its own taxonomy IDs", async () => {
  assert.deepEqual(
    (await fetchEastmoneyIndustryDirectory(async () => industries)).map((r) => r.id),
    ["new_emBK0001"],
  );
  assert.deepEqual(
    (
      await fetchEastmoneyIndustryMembers("new_emBK0001", async (url) => {
        assert.equal(url.searchParams.get("fs"), "b:BK0001");
        return { data: { total: 1, diff: [{ f12: "603298", f13: 1 }] } };
      })
    ).symbols,
    ["SH603298"],
  );
  await assert.rejects(
    fetchEastmoneyIndustryDirectory(async () => ({
      data: { total: 2, diff: industries.data.diff },
    })),
    /重复|不完整/,
  );
});
test("source failure switches complete taxonomy, caches independently, and retains failure evidence", async () => {
  const memory = store();
  let sinaCalls = 0,
    emCalls = 0;
  const opts = {
    ...memory,
    persistent: true,
    marketDate: "2026-09-21",
    provisional: true,
    now,
    config: { industry: "auto" },
    continueScan: true,
    fetchSina: async () => {
      sinaCalls++;
      throw Object.assign(new Error("HTTP 456"), { code: "SOURCE_HTTP", status: 456 });
    },
    readJson: async () => {
      emCalls++;
      return industries;
    },
  };
  const result = await resolveIndustryProvider(opts);
  assert.equal(result.industryProvider.id, "eastmoney");
  assert.equal(result.industryProvider.fallback, true);
  assert.equal(result.industries[0].id, "new_emBK0001");
  assert(result.sourceErrors.some((e) => e.errorCode === "SOURCE_HTTP_456"));
  await resolveIndustryProvider(opts);
  assert.equal(sinaCalls, 1);
  assert.equal(emCalls, 1);
  assert(memory.records.has("a-share-industry-directory-sina:global"));
  assert(memory.records.has("a-share-industry-directory-eastmoney:global"));
});
test("standard JSON rejects stale or malformed members, and cache returns the same identities", async () => {
  const payload = {
    schemaVersion: 1,
    asOf: now.toISOString(),
    industries: [{ id: "machinery", name: "机械设备", symbols: ["SH603298"] }],
  };
  assert.throws(() =>
    parseStandardIndustries({ ...payload, asOf: "2026-08-01" }, "0123456789abcdef", now),
  );
  assert.throws(() =>
    parseStandardIndustries(
      { ...payload, industries: [{ id: "x", name: "x", symbols: ["BAD"] }] },
      "0123456789abcdef",
      now,
    ),
  );
  const memory = store();
  let requests = 0;
  const opts = {
    ...memory,
    persistent: true,
    marketDate: "2026-09-21",
    provisional: true,
    now,
    config: {
      industry: "standard-json",
      endpoint: "https://example.com/industry.json",
      label: "自定义分类",
    },
    quotes: [{ symbol: "SH603298", changePercent: 2, amount: 100 }],
    readJson: async () => {
      requests++;
      return payload;
    },
  };
  const first = await resolveIndustryProvider(opts);
  const second = await resolveIndustryProvider(opts);
  assert.equal(requests, 1);
  assert.equal(first.industries[0].changePercent, 2);
  assert.deepEqual((await second.fetchMembers(second.industries[0].id)).symbols, ["SH603298"]);
  assert(second.industries[0].id.startsWith("new_j"));
});

test("a healthy directory cannot hide a blocked constituent source", async () => {
  const memory = store();
  const result = await resolveIndustryProvider({
    ...memory,
    persistent: true,
    marketDate: "2026-09-21",
    provisional: true,
    now,
    config: { industry: "auto" },
    fetchSina: async () => [{ id: "new_test", name: "新浪分类", count: 1 }],
    readJson: async () => industries,
    readCircuit: async (key) =>
      key === "sina"
        ? {
            marketDate: "2026-09-21",
            provisional: true,
            memberSourceReason: "SOURCE_HTTP_456",
            memberSourceRetry: { exhausted: false, nextRetryAt: "2026-09-21T05:15:00Z" },
          }
        : null,
  });
  assert.equal(result.industryProvider.id, "eastmoney");
  assert(result.sourceErrors.some((e) => e.errorCode === "SOURCE_HTTP_456"));
});

test('real disk snapshot contract supports standard and built-in membership caches', async () => {
 const root=await mkdtemp(join(tmpdir(),'quant-provider-'));
 try {
 const common={root,persistent:true,marketDate:'2026-09-21',provisional:true,now};
 const custom={...common,config:{industry:'standard-json',endpoint:'https://example.com/data',label:'标准行业'},
   readJson:async()=>({schemaVersion:1,asOf:now.toISOString(),industries:[{id:'test',name:'测试',symbols:['SH603298']}]})};
 const first=await resolveIndustryProvider(custom);assert.equal(first.available,true);
 const second=await resolveIndustryProvider({...custom,readJson:async()=>assert.fail('should reuse actual disk cache')});
 assert.deepEqual((await second.fetchMembers(second.industries[0].id)).symbols,['SH603298']);
 const em=await resolveIndustryProvider({...common,config:{industry:'eastmoney'},readJson:async(url)=>url.searchParams.get('fs').startsWith('b:')?{data:{total:1,diff:[{f12:'603298',f13:1}]}}:industries});
 await em.fetchMembers(em.industries[0].id);
 const cached=await resolveIndustryProvider({...common,config:{industry:'eastmoney'},readJson:async()=>assert.fail('should reuse member and directory cache')});
 assert.deepEqual((await cached.fetchMembers(cached.industries[0].id)).symbols,['SH603298']);
 } finally {await rm(root,{recursive:true,force:true});}
});
