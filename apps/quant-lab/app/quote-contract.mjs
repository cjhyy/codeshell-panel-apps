export const QUOTE_READ_FORMATS = Object.freeze(["quant.quotes/2"]);
export const QUOTE_WRITE_FORMATS = Object.freeze(["quant.quotes/2"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
function decimal(value) {
  if (typeof value !== "number" && !(typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value))) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) >= 1e21) return null;
  const result = number.toFixed(8).replace(/\.?0+$/u, "");
  return result === "-0" || !result ? "0" : result;
}
function marketDay(instant, market) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: market === "cn" ? "Asia/Shanghai" : "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}
export function normalizeQuoteV2(quote, { market, symbol, now = new Date() }) {
  if (!["cn", "us"].includes(market) || quote?.symbol !== symbol || decimal(quote.price) === null || !(Number(quote.price) > 0) || !Number.isFinite(Date.parse(quote.asOf)) || Date.parse(quote.asOf) > now.getTime() + 60_000) throw new Error("报价身份、价格或时间无效");
  const marketDate = quote.marketDate ?? marketDay(quote.asOf, market);
  const priceBasis = quote.priceBasis ?? "raw";
  const session = ["regular", "pre", "post", "closed", "halted"].includes(quote.session) ? quote.session : "unknown";
  const currency = quote.currency ?? (market === "cn" ? "CNY" : "USD");
  const previousClose = decimal(quote.previousClose);
  // Tencent's previous close is a supplier reference for this trading session;
  // referenceDate is the applicability date of that supplier session reference,
  // not an invented previous trading day.
  const referenceDate = datePattern.test(quote.referenceDate ?? "") ? quote.referenceDate : market === "cn" && previousClose ? marketDate : null;
  const referenceBasis = quote.referenceBasis ?? (market === "cn" && previousClose ? "supplier-session-reference" : null);
  const sourcePct = decimal(quote.changePercent);
  const pct = previousClose && Number(previousClose) > 0 ? (Number(quote.price) / Number(previousClose) - 1) * 100 : null;
  const validReference = previousClose && Number(previousClose) > 0 && priceBasis === "raw" && referenceBasis === "supplier-session-reference" && referenceDate === marketDate && session !== "halted" && marketDate === marketDay(now, market) && marketDate === marketDay(quote.asOf, market) && currency === (market === "cn" ? "CNY" : "USD") && (quote.changePercent == null || sourcePct !== null && Math.abs(Number(sourcePct) - pct) <= 0.025);
  return Object.freeze({ market, symbol, currency, price: decimal(quote.price), asOf: new Date(quote.asOf).toISOString(), marketDate, session, priceBasis,
    previousClose: validReference ? previousClose : null, referenceDate: validReference ? referenceDate : null,
    referenceBasis: validReference ? referenceBasis : null, dayChange: validReference ? decimal(Number(quote.price) - Number(previousClose)) : null,
    dayChangePct: validReference ? decimal(pct) : null, source: quote.source ?? (market === "cn" ? "腾讯证券" : "Yahoo Finance"), fetchedAt: now.toISOString(), status: "ok", reason: validReference ? null : "reference-unavailable-or-incompatible" });
}
export function isQuoteV2(value) {
  const numeric = (input) => typeof input === "string" && input.length <= 64 && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(input) && Number.isFinite(Number(input));
  const instant = (input) => typeof input === "string" && Number.isFinite(Date.parse(input));
  const date = (input) => typeof input === "string" && datePattern.test(input) && instant(`${input}T00:00:00Z`) && new Date(`${input}T00:00:00Z`).toISOString().slice(0, 10) === input;
  if (!value || !["cn", "us"].includes(value.market) || typeof value.symbol !== "string" || !/^[A-Z0-9.^=-]{1,32}$/u.test(value.symbol)
    || !numeric(value.price) || Number(value.price) <= 0 || !instant(value.asOf) || !instant(value.fetchedAt) || !date(value.marketDate)
    || value.currency !== (value.market === "cn" ? "CNY" : "USD") || !["regular", "pre", "post", "closed", "halted", "unknown"].includes(value.session)
    || !["raw", "qfq", "hfq"].includes(value.priceBasis) || value.status !== "ok" || typeof value.source !== "string" || value.source.length < 1 || value.source.length > 256) return false;
  const reference = [value.previousClose, value.referenceDate, value.referenceBasis, value.dayChange, value.dayChangePct];
  if (reference.every((field) => field === null)) return typeof value.reason === "string" && value.reason.length > 0 && value.reason.length <= 256;
  if (!numeric(value.previousClose) || Number(value.previousClose) <= 0 || !numeric(value.dayChange) || !numeric(value.dayChangePct)
    || value.referenceBasis !== "supplier-session-reference" || !date(value.referenceDate) || value.referenceDate !== value.marketDate
    || value.marketDate !== marketDay(value.asOf, value.market) || value.marketDate !== marketDay(value.fetchedAt, value.market)
    || value.priceBasis !== "raw" || value.session === "halted" || value.reason !== null) return false;
  const delta = Number(value.price) - Number(value.previousClose);
  return Math.abs(Number(value.dayChange) - delta) <= 1e-7 && Math.abs(Number(value.dayChangePct) - delta / Number(value.previousClose) * 100) <= 1e-7;
}
