import { HISTORY_DATA_SOURCES } from "./market-data-sources.mjs";

export const DATA_SOURCE_CAPABILITIES = Object.freeze({
  realtime: "实时行情",
  daily: "历史日线",
  adjustmentFactors: "复权因子",
  industries: "行业分类",
  members: "行业成分",
});
export const DATA_SOURCE_CATALOG = Object.freeze([
  {
    id: "sina",
    label: "新浪财经",
    capabilities: ["realtime", "industries", "members"],
    access: "免密钥",
    taxonomy: "新浪行业",
  },
  {
    id: "eastmoney",
    label: "东方财富",
    capabilities: ["realtime", "daily", "industries", "members"],
    access: "免密钥",
    taxonomy: "东方财富二级行业",
  },
  { id: "tencent", label: "腾讯行情", capabilities: ["realtime", "daily"], access: "免密钥" },
  ...HISTORY_DATA_SOURCES.filter(
    (source) => !["tencent-ifzq", "eastmoney-kline"].includes(source.id),
  ).map((source) => ({
    id: source.id,
    label: source.label,
    capabilities: Object.keys(source.capabilities).filter(
      (key) => source.capabilities[key] !== "unavailable",
    ),
    access: source.auth.type === "none" ? "免密钥" : "需要凭证",
    taxonomy: source.id === "tushare-pro" ? "当前仅接入日线和复权因子" : "",
  })),
  {
    id: "standard-json",
    label: "标准 JSON 接口",
    capabilities: ["industries", "members"],
    access: "自定义 HTTPS 地址",
    taxonomy: "独立分类口径",
  },
]);

export function parseDataSourceConfig(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("数据源配置无效");
  const industry = value.industry ?? "auto";
  if (!["auto", "sina", "eastmoney", "standard-json"].includes(industry))
    throw new Error("不支持的行业数据源");
  const endpoint = industry === "standard-json" ? String(value.endpoint ?? "").trim() : "";
  const label = String(industry === "standard-json" ? value.label ?? "" : "")
    .trim()
    .slice(0, 40);
  if (endpoint) {
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error("请填写完整 HTTPS 地址");
    }
    if (
      endpoint.length > 1500 ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") ||
      url.hostname.endsWith(".local") ||
      /^[\d.]+$/.test(url.hostname) ||
      url.hostname.includes(":") ||
      [...url.searchParams.keys()].some((key) =>
        /token|secret|password|key|authorization/i.test(key),
      )
    ) {
      throw new Error("请使用公开 HTTPS 域名；密钥不能写入地址");
    }
  }
  if (industry === "standard-json" && (!endpoint || !label))
    throw new Error("请填写自定义来源名称和接口地址");
  return Object.freeze({ version: 1, industry, endpoint, label });
}

export const STANDARD_INDUSTRY_EXAMPLE = Object.freeze({
  schemaVersion: 1,
  asOf: "2026-09-21T00:00:00Z",
  industries: [{ id: "machinery", name: "机械设备", symbols: ["SH603298"] }],
});
