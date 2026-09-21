import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { lookup } from "node:dns/promises";
import { parseDataSourceConfig } from "../data-source-config.mjs";
import { fetchIndustries } from "./build-market-pulse.mjs";
import { fetchAllQuotesForNode, readLimitedResponseText } from "./screen-a-shares.mjs";
import { selectionIndustryDirectory } from "./selection-source-cache.mjs";
import { readLocalSnapshot, writeLocalSnapshot } from "./local-snapshot-store.mjs";

const fail = (code, message) => Object.assign(new Error(message), { code });
const EM_ORIGIN = "https://17.push2.eastmoney.com";
const TTL = 7 * 86400000;
export function industryProviderKey(config) {
  const parsed = parseDataSourceConfig(config);
  return parsed.industry === "standard-json"
    ? `json-${createHash("sha256").update(parsed.endpoint).digest("hex").slice(0, 16)}`
    : parsed.industry;
}
export function isPublicSourceAddress(address) {
  if (address.includes(":")) return /^(2|3)/i.test(address); // IPv6 global unicast only.
  const p = address.split(".").map(Number);
  return (
    p.length === 4 &&
    p.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) &&
    ![0, 10, 127].includes(p[0]) &&
    p[0] < 224 &&
    !(p[0] === 169 && p[1] === 254) &&
    !(p[0] === 172 && p[1] >= 16 && p[1] <= 31) &&
    !(p[0] === 192 && p[1] === 168) &&
    !(p[0] === 100 && p[1] >= 64 && p[1] <= 127) &&
    !(p[0] === 198 && [18, 19].includes(p[1]))
  );
}
export async function readProviderJson(
  url,
  { fetchImpl = fetch, resolveHost = lookup, custom = false } = {},
) {
  if (custom) {
    parseDataSourceConfig({ industry: "standard-json", endpoint: String(url), label: "校验" });
    const addresses = await resolveHost(new URL(url).hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => !isPublicSourceAddress(address)))
      throw fail("SOURCE_URL_UNSAFE", "自定义接口必须解析到公开网络地址");
  }
  let response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(12000),
      redirect: "error",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    const reason = String(error?.cause?.code ?? error?.code ?? error?.name ?? "FAILED")
      .replace(/[^A-Za-z0-9_]/g, "_").toUpperCase().slice(0, 64);
    throw fail(`SOURCE_NETWORK_${reason}`, "数据源网络连接失败或超时");
  }
  if (!response.ok)
    throw Object.assign(fail(`SOURCE_HTTP_${response.status}`, `HTTP ${response.status}`), {
      status: response.status,
    });
  try {
    return JSON.parse(await readLimitedResponseText(response, 2 * 1024 * 1024));
  } catch (error) {
    if (error.code) throw error;
    throw fail("SOURCE_JSON_INVALID", "来源没有返回有效 JSON");
  }
}
export function eastmoneyIndustryUrl(page = 1, board = null) {
  const url = new URL("/api/qt/clist/get", EM_ORIGIN);
  for (const [key, value] of Object.entries({
    pn: page,
    pz: 100,
    po: 1,
    np: 1,
    fltt: 2,
    invt: 2,
    fid: "f12",
    fs: board ? `b:${board}` : "m:90+s:4+f:!50",
    fields: "f12,f13,f14,f3,f6",
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
  }))
    url.searchParams.set(key, value);
  return url;
}
async function emPages(board, readJson) {
  const rows = [],
    seen = new Set();
  let total = null;
  for (let page = 1; page <= (board ? 20 : 3); page++) {
    const data = (await readJson(eastmoneyIndustryUrl(page, board)))?.data;
    if (
      !data ||
      !Number.isInteger(data.total) ||
      data.total < 1 ||
      data.total > (board ? 2000 : 256) ||
      !Array.isArray(data.diff)
    )
      throw fail("INDUSTRY_RESPONSE_INVALID", "东方财富行业数据结构或总数无效");
    if (total != null && total !== data.total)
      throw fail("INDUSTRY_RESPONSE_CHANGED", "分页期间成分数量变化，请重试");
    total = data.total;
    for (const row of data.diff) {
      if (typeof row.f12 !== "string" || seen.has(row.f12))
        throw fail("INDUSTRY_PAGE_REPEAT", "行业分页重复或代码无效");
      seen.add(row.f12);
      rows.push(row);
    }
    if (rows.length === total) return rows;
    if (!data.diff.length || rows.length > total) break;
  }
  throw fail("INDUSTRY_COVERAGE_LOW", "行业分页不完整，未使用部分结果");
}
export async function fetchEastmoneyIndustryDirectory(readJson = readProviderJson) {
  return (await emPages(null, readJson)).map((row) => {
    if (
      !/^BK\d{4}$/.test(row.f12) ||
      typeof row.f14 !== "string" ||
      !row.f14.trim() ||
      typeof row.f3 !== "number" ||
      !Number.isFinite(row.f3) ||
      typeof row.f6 !== "number" ||
      !Number.isFinite(row.f6) ||
      row.f6 < 0
    )
      throw fail("INDUSTRY_RESPONSE_INVALID", "东方财富行业字段无效");
    return {
      id: `new_em${row.f12}`,
      name: row.f14,
      count: 0,
      changePercent: row.f3,
      amount: row.f6,
    };
  });
}
export async function fetchEastmoneyIndustryMembers(id, readJson = readProviderJson) {
  if (!/^new_emBK\d{4}$/.test(id)) throw fail("INDUSTRY_ID_INVALID", "东方财富行业代码无效");
  const rows = await emPages(id.slice(6), readJson);
  const symbols = rows.map((row) => {
    if (![0, 1].includes(row.f13) || !/^\d{6}$/.test(row.f12))
      throw fail("INDUSTRY_MEMBER_INVALID", "成分股票代码无效");
    return `${row.f13 === 1 ? "SH" : "SZ"}${row.f12}`;
  });
  return { symbols, complete: true, nextPage: 1, reason: null };
}
export function parseStandardIndustries(value, namespace, now = new Date()) {
  const date = Date.parse(value?.asOf);
  if (
    value?.schemaVersion !== 1 ||
    !Number.isFinite(date) ||
    date > now.getTime() ||
    now.getTime() - date > TTL ||
    !Array.isArray(value.industries) ||
    !value.industries.length ||
    value.industries.length > 256
  )
    throw fail("INDUSTRY_JSON_INVALID", "标准行业 JSON 结构或日期无效（最多保留 7 天）");
  const ids = new Set();
  const industries = value.industries.map((row) => {
    if (
      !/^[A-Za-z0-9]{1,20}$/.test(row?.id) ||
      ids.has(row.id) ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      row.name.length > 40 ||
      !Array.isArray(row.symbols) ||
      !row.symbols.length ||
      row.symbols.length > 2000 ||
      new Set(row.symbols).size !== row.symbols.length ||
      row.symbols.some((s) => !/^(SH6\d{5}|SZ[03]\d{5})$/.test(s))
    )
      throw fail("INDUSTRY_JSON_INVALID", "行业代码、名称或成分列表无效");
    ids.add(row.id);
    return {
      id: `new_j${namespace}${row.id}`,
      name: row.name,
      count: row.symbols.length,
      symbols: row.symbols,
    };
  });
  return { asOf: value.asOf, industries };
}

// Provider-scoped storage keeps classifications, retries, and member evidence separate.
export async function resolveIndustryProvider(options) {
  const {
    root,
    persistent,
    marketDate,
    provisional,
    now,
    seedSnapshots = [],
    quotes = [],
  } = options;
  const config = parseDataSourceConfig(options.config);
  const read = options.readSnapshot ?? readLocalSnapshot,
    write = options.writeSnapshot ?? writeLocalSnapshot;
  const requested = config.industry === "auto" ? ["sina", "eastmoney"] : [config.industry];
  const attempts = [];
  let fallback = null;
  for (const id of requested) {
    const key = id === "standard-json" ? industryProviderKey(config) : id;
    const cachedRead = (params) => read({ ...params, stream: `${params.stream}-${key}` });
    const cachedWrite = (params) => write({ ...params, stream: `${params.stream}-${key}` });
    let standard;
    const directory = await selectionIndustryDirectory({
      ...options,
      seedSnapshots: seedSnapshots.filter((s) => (s.industryProvider?.id ?? "sina") === key),
      readSnapshot: cachedRead,
      writeSnapshot: cachedWrite,
      fetchIndustries: async () => {
        if (id === "sina") return (options.fetchSina ?? fetchIndustries)();
        if (id === "eastmoney") return fetchEastmoneyIndustryDirectory(options.readJson);
        standard = parseStandardIndustries(
          await (options.readJson ?? readProviderJson)(config.endpoint, { custom: true }),
          key.slice(5),
          now,
        );
        if (persistent)
          await write({
            root,
            stream: "industry-standard",
            scope: key.slice(5),
            snapshot: { ...standard, marketDate, generatedAt: now.toISOString(), session: { phase: provisional ? "intraday" : "close", provisional } },
          });
        return standard.industries.map(({ symbols, ...row }) => ({
          ...row,
          changePercent: null,
          amount: null,
        }));
      },
    });
    if (directory.available && persistent && id !== "standard-json") {
      const circuit = await (
        options.readCircuit ??
        (async () => {
          try {
            return JSON.parse(
              await readFile(
                resolve(
                  root,
                  "selection-sector-scan/v1",
                  marketDate,
                  provisional ? "intraday" : "close",
                  key,
                  "progress-global.json",
                ),
                "utf8",
              ),
            );
          } catch {
            return null;
          }
        })
      )(key);
      if (
        circuit?.marketDate === marketDate &&
        circuit.provisional === provisional &&
        /403|429|456|THROTTL/i.test(circuit.memberSourceReason ?? "") &&
        (circuit.memberSourceRetry?.exhausted ||
          Date.parse(circuit.memberSourceRetry?.nextRetryAt) > now.getTime())
      ) {
        directory.available = false;
        directory.pending = !circuit.memberSourceRetry.exhausted;
        directory.nextRetryAt = circuit.memberSourceRetry.nextRetryAt;
        directory.sourceErrors = [
          ...directory.sourceErrors,
          {
            source: "industries",
            errorCode: circuit.memberSourceReason,
            message: "行业成分接口受限，尝试独立备用分类",
          },
        ];
      }
    }
    attempts.push(...directory.sourceErrors.map((e) => ({ ...e, source: `industries:${key}` })));
    const selected = {
      ...directory,
      industryProvider: {
        id: key,
        label: id === "sina" ? "新浪行业" : id === "eastmoney" ? "东方财富二级行业" : config.label,
        url:
          id === "sina"
            ? "https://vip.stock.finance.sina.com.cn/mkt/"
            : id === "eastmoney"
              ? "https://quote.eastmoney.com/center/boardlist.html#industry_board_2"
              : new URL(config.endpoint).origin,
        fallback: requested.length > 1 && id !== requested[0],
      },
      sourceErrors: attempts.slice(),
    };
    selected.fetchMembers = async (node, settings = {}) => {
      if (id === "standard-json") {
        const stored =
          standard ?? (await read({ root, stream: "industry-standard", scope: key.slice(5) }));
        const parsed = parseStandardIndustries(
          {
            schemaVersion: 1,
            ...stored,
            industries: stored?.industries?.map((r) => ({
              ...r,
              id: r.id.replace(`new_j${key.slice(5)}`, ""),
            })),
          },
          key.slice(5),
          now,
        );
        const row = parsed.industries.find((item) => item.id === node);
        if (!row) throw fail("INDUSTRY_MEMBER_INVALID", "当前来源没有这个行业");
        return { symbols: row.symbols, complete: true, nextPage: 1, reason: null };
      }
      // Membership identities need a daily check, not a refetch on every quote tick.
      const scope = createHash("sha256").update(`${key}:${node}`).digest("hex").slice(0, 16);
      const saved = persistent
        ? await read({ root, stream: "industry-members", scope }).catch(() => null)
        : null;
      if (saved?.marketDate === marketDate && saved.node === node && saved.complete === true)
        return saved;
      const value =
        id === "sina"
          ? await (options.fetchSinaMembers ?? fetchAllQuotesForNode)(node, settings)
          : await fetchEastmoneyIndustryMembers(node, options.readJson);
      if (persistent && value.complete)
        await write({
          root,
          stream: "industry-members",
          scope,
          snapshot: { ...value, node, marketDate, generatedAt: now.toISOString(), session: { phase: provisional ? "intraday" : "close", provisional } },
        });
      return value;
    };
    if (id === "standard-json" && directory.available) {
      // Reuse the standard membership identity with today's quotes; never reuse old returns.
      const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));
      selected.industries = await Promise.all(
        directory.industries.map(async (row) => {
          const members = (await selected.fetchMembers(row.id)).symbols
            .map((s) => quoteMap.get(s))
            .filter(Boolean);
          return {
            ...row,
            changePercent: members.length
              ? members.reduce((sum, q) => sum + q.changePercent, 0) / members.length
              : null,
            amount: members.length ? members.reduce((sum, q) => sum + q.amount, 0) : null,
          };
        }),
      );
    }
    fallback ??= selected;
    if (directory.available) return selected;
  }
  return { ...fallback, sourceErrors: attempts };
}
