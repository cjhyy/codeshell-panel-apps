const A_SHARE_SYMBOL = /^(SH|SZ)(\d{6})$/u;
const MAX_DIRECTORY_ITEMS = 6_500;

function cleanText(value, maximum = 80) {
  return typeof value === "string"
    ? value
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, maximum)
    : "";
}

function inferredExchange(code) {
  if (/^(6|9)/u.test(code)) return "SH";
  if (/^(0|2|3)/u.test(code)) return "SZ";
  return null;
}

export function canonicalAShareSymbol(value) {
  const raw = cleanText(value, 24).toUpperCase().replace(/\s+/gu, "");
  const match = /^(SH|SZ)?(\d{6})$/u.exec(raw);
  if (!match) return null;
  const exchange = inferredExchange(match[2]);
  if (!exchange || (match[1] && match[1] !== exchange)) return null;
  return `${exchange}${match[2]}`;
}

export function parseAShareStockDirectory(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_DIRECTORY_ITEMS) {
    throw new Error("A 股名称目录结构无效");
  }
  const seen = new Set();
  return Object.freeze(value.map((item) => {
    const symbol = canonicalAShareSymbol(item?.symbol);
    const name = cleanText(item?.name, 40);
    if (!symbol || !name || seen.has(symbol)) throw new Error("A 股名称目录条目无效或重复");
    seen.add(symbol);
    return Object.freeze({ symbol, name });
  }));
}

function normalizedName(value) {
  return cleanText(value, 80).toLocaleUpperCase("zh-CN").replace(/\s+/gu, "");
}

function candidateResult(matches, code = "ambiguous") {
  return Object.freeze({
    ok: false,
    code,
    candidates: Object.freeze(matches.slice(0, 6)),
  });
}

export function resolveAShareStock(value, directoryInput = []) {
  const input = cleanText(value, 80);
  if (!input) return candidateResult([], "empty");
  const directory = Array.isArray(directoryInput) ? directoryInput : [];
  const codeTokens = [...input.toUpperCase().matchAll(/(?:(SH|SZ)\s*)?(\d{6})/gu)];
  if (codeTokens.length > 1) return candidateResult([], "multiple-codes");
  if (codeTokens.length === 1) {
    const symbol = canonicalAShareSymbol(`${codeTokens[0][1] ?? ""}${codeTokens[0][2]}`);
    if (!symbol) return candidateResult([], "invalid-symbol");
    const match = directory.find((item) => item.symbol === symbol);
    return Object.freeze({ ok: true, symbol, name: match?.name ?? "", matchedBy: "symbol" });
  }
  const query = normalizedName(input);
  const rows = directory.map((item) => ({ item, name: normalizedName(item.name) }));
  const exact = rows.filter((row) => row.name === query).map((row) => row.item);
  if (exact.length === 1) {
    return Object.freeze({ ok: true, ...exact[0], matchedBy: "exact-name" });
  }
  if (exact.length > 1) return candidateResult(exact);
  const prefix = rows.filter((row) => row.name.startsWith(query)).map((row) => row.item);
  if (prefix.length === 1) {
    return Object.freeze({ ok: true, ...prefix[0], matchedBy: "prefix-name" });
  }
  if (prefix.length > 1) return candidateResult(prefix);
  const partial = rows.filter((row) => row.name.includes(query)).map((row) => row.item);
  if (partial.length === 1) {
    return Object.freeze({ ok: true, ...partial[0], matchedBy: "partial-name" });
  }
  if (partial.length > 1) return candidateResult(partial);
  return candidateResult([], directory.length ? "not-found" : "directory-unavailable");
}

export function aShareResolutionMessage(result) {
  if (result?.ok) return "";
  if (result?.code === "empty") return "请输入股票名称或六位代码";
  if (result?.code === "multiple-codes") return "一次只能输入一只股票";
  if (result?.code === "invalid-symbol") return "A 股代码与交易所前缀不一致";
  if (result?.code === "directory-unavailable") {
    return "股票名称目录尚未就绪，请先刷新市场首页，或暂时输入六位代码";
  }
  if (result?.code === "ambiguous" && result.candidates?.length) {
    return `名称不唯一，请选择：${result.candidates.map((item) => `${item.name} ${item.symbol.slice(2)}`).join("、")}`;
  }
  return "未找到这只 A 股，请检查名称或输入六位代码";
}

export const A_SHARE_STOCK_DIRECTORY_LIMIT = MAX_DIRECTORY_ITEMS;
